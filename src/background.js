var SERVER_URL = 'http://localhost:3002';
chrome.storage.local.get(['dsConfig'], function(result) {
  if (result.dsConfig && result.dsConfig.serverUrl) {
    SERVER_URL = result.dsConfig.serverUrl;
  }
});
const NATIVE_HOST_NAME = 'com.deepseek.tool_agent';
const TARGET_API = 'https://chat.deepseek.com/api/v0/chat/completion';

let nativePort = null;
let isConnectedToNative = false;
let serverStatus = { running: false, mode: 'disconnected' };
let reconnectAttempts = 0;
var MAX_RECONNECT_ATTEMPTS = 3;
let lastReconnectDelay = 0;
let lastConnectAttempt = 0;
var CONNECT_COOLDOWN_MS = 5000;
let connectAttemptInProgress = false;

// 启动时从 session storage 恢复状态（防止 SW 休眠后全局变量丢失）
async function restoreState() {
  try {
    var stored = await chrome.storage.session.get(['serverStatus', 'reconnectAttempts']);
    if (stored.serverStatus) {
      serverStatus = stored.serverStatus;
    }
    if (stored.reconnectAttempts !== undefined) {
      reconnectAttempts = stored.reconnectAttempts;
    }
    // Bug修复：SW 重启后 nativePort 必然为 null，需验证恢复的状态是否仍然有效
    if (serverStatus.running) {
      var httpOk = await checkHttpServer();
      if (!httpOk) {
        // HTTP 服务已不可用，重置为断开状态
        serverStatus = { running: false, mode: 'disconnected' };
        reconnectAttempts = 0;
      } else {
        // HTTP 可用但 Native Host 连接已丢失，降级为 HTTP 模式
        serverStatus = { running: true, mode: 'http' };
      }
    }
  } catch(e) {
    // 恢复失败时重置为安全默认值，防止状态不一致
    serverStatus = { running: false, mode: 'disconnected' };
    reconnectAttempts = 0;
  }
}

// 保存关键状态到 session storage（防止 SW 休眠后全局变量丢失）
async function saveState() {
  try {
    await chrome.storage.session.set({
      serverStatus: serverStatus,
      reconnectAttempts: reconnectAttempts
    });
  } catch(e) {}
}

// ╔══════════════════════════════════════════════════════════════╗
// ║ TOOL_DEFINITIONS — 必须与以下文件保持同步:                    ║
// ║   • src/background.js (Service Worker)                      ║
// ║   • src/injected.js (MAIN World)                            ║
// ║   • src/tools/registry.js (ISOLATED World)                  ║
// ║ 修改时请同步更新所有三处！                                     ║
// ╚══════════════════════════════════════════════════════════════╝
const TOOL_DEFINITIONS = [
  { name: "read_file", description: "读取本地文件的内容", parameters: { path: "文件的绝对路径 (string)" } },
  { name: "write_file", description: "写入内容到本地文件（不存在则创建，存在则覆盖）", parameters: { path: "文件的绝对路径 (string)", content: "要写入的文件内容 (string)" } },
  { name: "list_dir", description: "列出指定目录下的所有文件和子目录", parameters: { path: "目录的绝对路径 (string)" } },
  { name: "exec_command", description: "在 Windows 系统上执行一条 cmd 命令并返回输出结果", parameters: { command: "要执行的命令 (string)" } },
  { name: "append_file", description: "追加内容到本地文件末尾", parameters: { path: "文件的绝对路径 (string)", content: "要追加的内容 (string)" } },
  { name: "search_files", description: "在指定目录中搜索文件名匹配模式的文件", parameters: { pattern: "文件名的通配符模式 (string)", root: "搜索的根目录 (string)" } },
  { name: "get_file_info", description: "获取文件的详细信息（大小、修改时间等）", parameters: { path: "文件的绝对路径 (string)" } }
];

// 工具定义一致性检查：确保 background.js 中的定义完整有效
// injected.js 和 registry.js 的定义必须与此处一致，由于跨世界隔离无法直接比较
function validateToolDefinitionsConsistency() {
  if (typeof TOOL_DEFINITIONS !== 'undefined') {
    console.log('[Background] TOOL_DEFINITIONS count:', TOOL_DEFINITIONS.length);
    TOOL_DEFINITIONS.forEach(function(t) {
      if (!t.name || !t.description) {
        console.warn('[Background] 工具定义不完整:', t.name);
      }
    });
  }
}
validateToolDefinitionsConsistency();

function buildSystemPrompt() {
  let prompt = `## 可用工具\n\n你可以通过调用以下工具来帮助用户操作本地文件。\n\n### 工具调用格式：\n<tool_call name="工具名称">\n{"参数名":"参数值"}\n</tool_call\n\n### 工具列表：\n`;
  TOOL_DEFINITIONS.forEach(t => {
    prompt += `\n#### ${t.name}\n${t.description}\n参数: ${JSON.stringify(t.parameters)}\n`;
  });
  prompt += `\n## 重要规则\n1. 当需要操作本地文件时，必须使用上述工具\n2. 每次只调用一个工具\n3. 等待工具执行结果后再决定下一步\n4. 文件路径请使用绝对路径`;
  return prompt;
}

// 统一工具执行器 — 所有工具都通过 /exec 端点执行，不再硬编码白名单
// 这样动态注册的插件管理、技能管理、MCP 等工具也能正常调用
async function fetchExec(toolName, args) {
  var data = await fetchJSON('/exec', { tool: toolName, args: args });
  return data;
}

async function fetchJSON(endpoint, body, retries) {
  retries = retries || 2;
  var lastErr = null;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      // 约束拦截（blocked）不是错误，直接返回
      if (data.blocked) return data;
      if (!data.success) {
        var errMsg = data.error ? (typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error))) : JSON.stringify(data);
        throw new Error(`服务器返回错误: ${errMsg} (HTTP ${response.status})`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(function(r) { setTimeout(r, 500 * (attempt + 1)); });
      }
    }
  }
  throw lastErr || new Error('请求失败');
}

function formatDirList(files, dirPath) {
  if (!files || files.length === 0) return `目录 "${dirPath}" 为空`;
  let result = `📁 目录: ${dirPath}\n${'='.repeat(50)}\n`;
  files.forEach(f => { result += `${f.isDirectory ? '📁' : '📄'} ${f.name}${f.size ? ` (${formatSize(f.size)})` : ''}\n`; });
  result += `\n共 ${files.length} 项`;
  return result;
}

function formatFileInfo(info) {
  return `📄 文件信息: ${info.path}\n${'='.repeat(50)}\n大小: ${formatSize(info.size)}\n修改时间: ${info.mtime}\n是否为目录: ${info.isDirectory ? '是' : '否'}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function bgLog(msg) {
}

async function checkHttpServer() {
  try {
    var fetchOpts = { method: 'GET' };
    try { fetchOpts.signal = AbortSignal.timeout(2000); } catch(e) {}
    var response = await fetch(`${SERVER_URL}/health`, fetchOpts);
    if (response.ok) return true;
  } catch(e) {}
  return false;
}

function connectNativeHost() {
  if (nativePort) {
    bgLog('已有 nativePort，跳过重复连接');
    return;
  }

  // 冷却检查：防止疯狂重连
  var now = Date.now();
  if (now - lastConnectAttempt < CONNECT_COOLDOWN_MS) {
    bgLog('冷却中，跳过连接（距上次 ' + Math.round((now - lastConnectAttempt)/1000) + 's）');
    return;
  }

  lastConnectAttempt = now;

  // 直接连接 Native Host，不先检查 HTTP
  // Service Worker 可能在异步等待期间休眠
  doConnectNativeHost();
}

function doConnectNativeHost() {
  return new Promise(function(resolve, reject) {
    if (nativePort) { resolve(true); return; }
    if (connectAttemptInProgress) { resolve(false); return; }
    connectAttemptInProgress = true;

    try {
      bgLog('connectNativeHost 开始 (attempt=' + reconnectAttempts + ')');
      bgLog('扩展ID: ' + (chrome.runtime.id || 'N/A'));
      bgLog('Native Host 名称: ' + NATIVE_HOST_NAME);

      nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

      // 检查 connectNative 是否立即失败
      var lastErr = chrome.runtime.lastError;
      if (lastErr) {
        bgLog('connectNative 立即错误: ' + lastErr.message);
        nativePort = null;
        connectAttemptInProgress = false;
        serverStatus = { running: false, mode: 'error', error: lastErr.message };
        notifyStatus();
        resolve(false);
        return;
      }

      bgLog('connectNative() 返回: port=' + !!nativePort);
      reconnectAttempts = 0;
      saveState(); // 重置重连计数后持久化
      var startupResolved = false;
      var startupTimeout = null; // Bug修复：保存超时定时器引用，成功时清除

      nativePort.onMessage.addListener((message) => {
        bgLog('Native Host 消息: ' + JSON.stringify(message).substring(0, 200));

        switch (message.type) {
          case 'connect_ack':
            bgLog('Native Host 已响应 (alive), PID=' + message.pid + ', Node=' + message.node + ', 等待 launcher 就绪...');
            serverStatus = { running: false, mode: 'native_starting', pid: message.pid };
            notifyStatus();
            break;
          case 'started':
            // Bug修复：服务器启动成功，清除启动超时定时器防止泄漏
            if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
            serverStatus = {
              running: true,
              mode: message.mode || 'native',
              port: message.port,
              workspace: message.workspace,
              launcherPid: message.launcherPid
            };
            bgLog('Native Host: 服务器已启动 (端口: ' + message.port + ')');
            notifyStatus();
            if (!startupResolved) { startupResolved = true; resolve(true); }
            break;
          case 'start_failed':
            if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
            serverStatus = { running: false, mode: 'error', error: message.error || '启动失败' };
            bgLog('Native Host: 服务器启动失败 - ' + (message.error || 'unknown'));
            notifyStatus();
            if (!startupResolved) { startupResolved = true; resolve(false); }
            break;
          case 'pong':
            serverStatus.running = message.running;
            notifyStatus();
            break;
          case 'restarted':
            serverStatus = { running: message.success, mode: 'launcher_proxy' };
            bgLog('服务器重启结果: ' + (message.success ? '成功' : '失败'));
            notifyStatus();
            break;
          case 'error':
            bgLog('Native Host 错误: ' + message.message);
            serverStatus = { running: false, mode: 'error', error: message.message };
            notifyStatus();
            if (!startupResolved) { startupResolved = true; resolve(false); }
            break;
        }
      });

      nativePort.onDisconnect.addListener(() => {
        var discErr = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'none';
        bgLog('Native Host 断开 (error=' + discErr + ')');
        // Bug修复：断开时清除启动超时定时器
        if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
        nativePort = null;
        isConnectedToNative = false; // 断开时重置连接标记
        connectAttemptInProgress = false;

        if (!startupResolved) { startupResolved = true; resolve(false); }

        // 断开后先检查 HTTP 服务是否仍在运行
        checkHttpServer().then(function(httpOk) {
          if (httpOk) {
            bgLog('HTTP 服务仍在运行，保持 running 状态 (HTTP模式)');
            serverStatus = { running: true, mode: 'http' };
            notifyStatus();
            // Bug修复：HTTP 运行但 Native Host 断开，延迟尝试重连 Native Host
            setTimeout(function() {
              if (!nativePort) {
                reconnectAttempts = 0;
                lastConnectAttempt = 0;
                connectNativeHost();
              }
            }, 5000);
            return;
          }

          serverStatus = { running: false, mode: 'disconnected' };
          notifyStatus();

          var delay = Math.min(3000 * (reconnectAttempts + 1), 15000);
          reconnectAttempts++;
          saveState(); // 重连计数变更后持久化
          if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            bgLog(reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ' 次重连，' + delay + 'ms 后尝试...');
            setTimeout(function() {
              if (!nativePort) connectNativeHost();
            }, delay);
          } else {
            bgLog('已达最大重连次数 (' + MAX_RECONNECT_ATTEMPTS + ')，停止自动重连。HTTP服务未运行，需手动启动或安装 Native Messaging');
          }
        }).catch(function() {
          serverStatus = { running: false, mode: 'disconnected' };
          notifyStatus();
        });
      });

      isConnectedToNative = true;
      connectAttemptInProgress = false;

      // 设置超时：60秒内没有 started/start_failed，视为失败
      // Bug修复：保存超时引用以便成功时清除
      startupTimeout = setTimeout(function() {
        if (!startupResolved) {
          bgLog('Native Host 启动超时 (60s)');
          startupResolved = true;
          resolve(false);
        }
      }, 60000);

    } catch(e) {
      connectAttemptInProgress = false;
      nativePort = null;
      bgLog('connectNativeHost 失败: ' + e.message);
      reject(e);
    }
  });
}

function disconnectNativeHost() {
  if (nativePort) {
    try { nativePort.postMessage({ type: 'stop' }); } catch {}
    nativePort.disconnect();
    nativePort = null;
  }
  isConnectedToNative = false; // 主动断开时重置连接标记
}

async function executeTool(toolCall) {
  const { name, arguments: args } = toolCall;
  bgLog('执行工具: ' + name);

  try {
    const status = await checkServer();
    if (!status.running) {
      const errorMsg = '本地工具服务器未运行（端口 3002 无响应）';
      return { success: false, error: errorMsg, detail: { serverStatus: status } };
    }
    // 统一走 /exec 端点，不再使用硬编码白名单
    const result = await fetchExec(name, args);
    // 约束拦截结果直接返回
    if (result.blocked) {
      bgLog('工具 ' + name + ' 被约束拦截: ' + (result.reason || ''));
      return { success: false, blocked: true, reason: result.reason, needsConfirmation: result.needsConfirmation, safetyLevel: result.safetyLevel, explanation: result.explanation, command: result.command, path: result.path };
    }
    bgLog('工具 ' + name + ' 执行成功');
    return { success: true, data: result };
  } catch (error) {
    const errorDetail = {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: (error.stack || '').split('\n').slice(0, 6).join('\n')
    };
    bgLog('工具 ' + name + ' 执行失败: ' + error.message);
    return { success: false, error: errorDetail.message, detail: errorDetail };
  }
}

async function checkServer() {
  if (nativePort && serverStatus.running) {
    return serverStatus;
  }

  try {
    var fetchOpts = { method: 'GET' };
    try { fetchOpts.signal = AbortSignal.timeout(3000); } catch(e) {}
    const response = await fetch(`${SERVER_URL}/health`, fetchOpts);
    if (response.ok) {
      serverStatus = { running: true, mode: 'http' };
      return serverStatus;
    }
  } catch {}

  if (nativePort) {
    try { nativePort.postMessage({ type: 'ping' }); } catch(e) { nativePort = null; }
    return serverStatus;
  }

  return { running: false, mode: 'disconnected' };
}

function notifyStatus() {
  try {
    chrome.runtime.sendMessage({ action: 'serverStatus', status: serverStatus }).catch(() => {});
  } catch(e) {}
  saveState(); // 状态变更时持久化
}

chrome.runtime.onInstalled.addListener(() => {
  bgLog('扩展已安装');
  chrome.storage.local.set({ toolEnabled: true });
});

chrome.runtime.onStartup.addListener(async () => {
  bgLog('浏览器启动');
  // Bug修复：先等待状态恢复完成再连接，防止状态不一致
  await restoreState();
  reconnectAttempts = 0;
  lastConnectAttempt = 0;
  connectNativeHost();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  bgLog('收到消息: ' + request.action);

  switch (request.action) {
    case 'executeTool':
      executeTool(request.tool).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message || String(e) }));
      return true;

    case 'checkServer':
      checkServer().then(s => sendResponse(s)).catch(() => sendResponse({ running: false, mode: 'error' }));
      return true;

    case 'toggleTool':
      chrome.storage.local.set({ toolEnabled: request.enabled });
      sendResponse({ success: true });
      break;

    case 'getStatus':
      sendResponse(serverStatus);
      break;

    case 'ping':
      sendResponse({ pong: true, timestamp: Date.now() });
      break;

    case 'log':
      fetch(SERVER_URL + '/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: request.level || 'INFO', message: request.message || '', data: { timestamp: request.timestamp } })
      }).catch(() => {});
      sendResponse({ success: true });
      break;

    case 'connectNativeHost':
      var connStartTime = Date.now();
      reconnectAttempts = 0;
      lastConnectAttempt = 0;
      bgLog('收到 connectNativeHost 请求');

      // 即使 HTTP 在运行，也要创建 Native Port 保持连接
      // 否则 Native Host 进程会因为浏览器断开而退出
      if (!nativePort) {
        connectNativeHost();
      }

      var maxWait = 35000;
      var pollInterval = 2000;
      var firstCheckDelay = 3000;
      var wasAcked = false;

      function checkAndRespond() {
        var elapsed = Date.now() - connStartTime;

        if (!wasAcked && serverStatus.mode === 'native_starting') {
          wasAcked = true;
          bgLog('Native Host 已确认连接，等待服务器启动... (elapsed=' + elapsed + 'ms)');
          setTimeout(checkAndRespond, 1500);
          return;
        }

        if (serverStatus.running) {
          bgLog('服务器就绪！elapsed=' + elapsed + 'ms');
          sendResponse({ success: true, status: serverStatus });
          notifyStatus();
          return;
        }

        if (elapsed > maxWait) {
          bgLog('连接超时 (' + elapsed + 'ms)，返回当前状态');
          var resultSuccess = !!nativePort || serverStatus.running;
          sendResponse({
            success: resultSuccess,
            status: serverStatus,
            message: resultSuccess ? '正在启动中...' : '无法连接 Native Host，请手动启动服务'
          });
          notifyStatus();
          return;
        }

        bgLog('仍在等待... elapsed=' + elapsed + 'ms, port=' + !!nativePort + ', running=' + serverStatus.running + ', mode=' + (serverStatus.mode || ''));
        setTimeout(checkAndRespond, pollInterval);
      }

      setTimeout(checkAndRespond, firstCheckDelay);
      return true;

    case 'restartServer':
      bgLog('收到 restartServer 请求');
      (function() {
        var resultSent = false;
        function sendResult(resp) {
          if (!resultSent) { resultSent = true; sendResponse(resp); }
        }

        function tryLauncherAPI() {
          return new Promise(function(resolve) {
            fetch('http://localhost:3003/api/launcher/restart', { method: 'POST' })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                bgLog('restartServer: Launcher API 成功');
                serverStatus = { running: true, mode: 'launcher' };
                notifyStatus();
                sendResult({ success: true, method: 'launcher_api', data: data });
                resolve(true);
              })
              .catch(function(e) {
                bgLog('restartServer: Launcher API 失败 - ' + (e.message || e));
                resolve(false);
              });
          });
        }

        function tryNativePort(port) {
          return new Promise(function(resolve) {
            if (!port) { resolve(false); return; }
            try {
              port.postMessage({ type: 'restart' });
              var restartResolved = false;
              var restartTimeout = null;
              var origListener = null;

              // Bug修复：统一清理函数，防止 listener 泄漏
              function cleanupListener() {
                if (restartTimeout) { clearTimeout(restartTimeout); restartTimeout = null; }
                if (origListener) { try { port.onMessage.removeListener(origListener); origListener = null; } catch(ex) {} }
              }

              restartTimeout = setTimeout(function() {
                if (!restartResolved) {
                  restartResolved = true;
                  bgLog('restartServer: nativePort restart 超时');
                  serverStatus = { running: false, mode: 'restarting' };
                  notifyStatus();
                  sendResult({ success: true, method: 'native_port', status: 'timeout_waiting' });
                  cleanupListener();
                  resolve(true);
                }
              }, 5000);

              origListener = function(msg) {
                if (msg.type === 'started' || msg.type === 'restarted') {
                  if (!restartResolved) {
                    restartResolved = true;
                    cleanupListener();
                    serverStatus = { running: !!msg.success, mode: msg.mode || 'native' };
                    notifyStatus();
                    sendResult({ success: true, method: 'native_port', data: msg });
                    resolve(true);
                  }
                } else if (msg.type === 'error') {
                  // Bug修复：处理 Native Host 返回的 error 消息
                  if (!restartResolved) {
                    restartResolved = true;
                    cleanupListener();
                    serverStatus = { running: false, mode: 'error', error: msg.message };
                    notifyStatus();
                    sendResult({ success: false, method: 'native_port', error: msg.message });
                    resolve(false);
                  }
                }
              };
              port.onMessage.addListener(origListener);
              // Bug修复：移除立即 resolve(true)，等待 restart 实际结果或超时
            } catch(e) {
              bgLog('restartServer: nativePort postMessage 失败 - ' + e.message);
              resolve(false);
            }
          });
        }

        function tryConnectAndRestart() {
          return new Promise(function(resolve) {
            try {
              var tempPort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
              tempPort.postMessage({ type: 'restart' });
              var responded = false;
              var msgHandler = function(msg) {
                responded = true;
                bgLog('restartServer: 临时端口收到消息 - ' + JSON.stringify(msg).substring(0, 200));
                if (msg.type === 'started' || msg.type === 'restarted') {
                  serverStatus = { running: !!msg.success, mode: msg.mode || 'native' };
                  notifyStatus();
                } else if (msg.type === 'error') {
                  serverStatus = { running: false, mode: 'error', error: msg.message };
                  notifyStatus();
                }
                sendResult({
                  success: msg.type !== 'error',
                  method: 'native_connect',
                  data: msg,
                  status: responded ? 'received' : 'disconnected'
                });
              };
              tempPort.onMessage.addListener(msgHandler);
              tempPort.onDisconnect.addListener(function() {
                var err = chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
                bgLog('restartServer: 临时端口断开 - ' + err + ' responded=' + responded);
                if (!responded) {
                  sendResult({
                    success: false,
                    method: 'native_connect',
                    error: err || 'Native Host 通信错误',
                    status: 'native_not_available',
                    help: 'native_register',
                    helpMessage: '请以管理员身份运行 native-messaging\\register.bat 注册 Native Host'
                  });
                }
                try { tempPort.disconnect(); } catch(ex) {}
              });
              setTimeout(function() {
                if (!responded) {
                  responded = true;
                  sendResult({ success: true, method: 'native_connect', status: 'waiting_for_response' });
                }
                try { tempPort.disconnect(); } catch(ex) {}
              }, 35000);
              resolve(true);
            } catch(e) {
              bgLog('restartServer: connectNative 异常 - ' + e.message);
              sendResult({
                success: false,
                method: 'none',
                error: e.message || 'Unknown error',
                status: 'all_methods_failed',
                help: 'native_register',
                helpMessage: '请以管理员身份运行 native-messaging\\register.bat 注册 Native Host，或手动执行 node server\\launcher.js'
              });
              resolve(true);
            }
          });
        }

        tryLauncherAPI().then(function(ok) {
          if (ok) return;
          if (nativePort) {
            tryNativePort(nativePort).then(function(ok2) {
              if (ok2) return;
              tryConnectAndRestart();
            });
          } else {
            tryConnectAndRestart();
          }
        });
      })();
      return true;
  }
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepAlive') {
    bgLog('KeepAlive 端口已连接');
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'ping') {
        try { port.postMessage({ type: 'pong', timestamp: Date.now() }); } catch(e) {}
      }
    });
    port.onDisconnect.addListener(() => {
      bgLog('KeepAlive 端口已断开');
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    bgLog('保活 alarm 触发');
    checkHttpServer().then(function(ok) {
      if (ok) {
        serverStatus = { running: true, mode: 'http' };
        notifyStatus();
      } else if (!nativePort && !serverStatus.running) {
        // Bug修复：重置 lastConnectAttempt 防止冷却检查阻止合法重连
        reconnectAttempts = 0;
        lastConnectAttempt = 0;
        connectNativeHost();
      }
      // HTTP 服务在运行但 Native Host 断开时，尝试重连 Native Host
      if (serverStatus.running && !nativePort) {
        bgLog('HTTP 服务运行中但 Native Host 断开，尝试重连 Native Host');
        // Bug修复：重置 lastConnectAttempt 防止冷却检查阻止合法重连
        reconnectAttempts = 0;
        lastConnectAttempt = 0;
        connectNativeHost();
      }
    });
  }
});

try {
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
} catch(e) {}

function startupServerRecovery() {
  bgLog('= SW 启动：恢复服务 =');

  // 直接尝试 Native Host 连接，不先检查 HTTP
  // 因为 Service Worker 可能在异步等待期间休眠
  bgLog('  直接连接 Native Host...');
  tryNativeStartup(0);
}

function tryNativeStartup(retryCount) {
  var MAX_RETRIES = 2;
  var now = Date.now();
  if (now - lastConnectAttempt < CONNECT_COOLDOWN_MS && retryCount > 0) {
    var delay = CONNECT_COOLDOWN_MS - (now - lastConnectAttempt);
    bgLog('  冷却中，' + delay + 'ms 后重试 (' + (retryCount+1) + '/' + (MAX_RETRIES+1) + ')');
    setTimeout(function() { tryNativeStartup(retryCount); }, delay + 100);
    return;
  }

  lastConnectAttempt = now;
  bgLog('  连接 Native Host (' + (retryCount+1) + '/' + (MAX_RETRIES+1) + ')...');

  doConnectNativeHost().then(function(success) {
    if (success) {
      bgLog('  Native Host 连接成功，等待服务器就绪...');
    } else if (retryCount < MAX_RETRIES) {
      bgLog('  Native Host 连接失败，准备重试...');
      setTimeout(function() { tryNativeStartup(retryCount + 1); }, 3000);
    } else {
      bgLog('  Native Host 连接失败 (已重试' + (MAX_RETRIES+1) + '次)');
      bgLog('  请手动启动: node server\\launcher.js 或双击 start-server.bat');
    }
  }).catch(function(err) {
    if (retryCount < MAX_RETRIES) {
      bgLog('  Native Host 异常: ' + err.message + '，准备重试...');
      setTimeout(function() { tryNativeStartup(retryCount + 1); }, 3000);
    } else {
      bgLog('  Native Host 异常 (已重试' + (MAX_RETRIES+1) + '次): ' + err.message);
    }
  });
}

// SW 启动时先恢复持久化状态，再启动服务恢复
// Bug修复：添加 .catch() 防止未处理的 Promise rejection
restoreState().then(function() {
  setTimeout(startupServerRecovery, 500);
}).catch(function(e) {
  bgLog('restoreState 失败: ' + (e && e.message || e));
  setTimeout(startupServerRecovery, 500);
});

bgLog('Service Worker 初始化完成，等待事件...');
