console.log('[Background] Service Worker 启动中...');

var SERVER_URL = 'http://localhost:3002';
chrome.storage.local.get(['dsConfig'], function(result) {
  if (result.dsConfig && result.dsConfig.serverUrl) {
    SERVER_URL = result.dsConfig.serverUrl;
    console.log('[Background] 使用配置的服务器地址: ' + SERVER_URL);
  }
});
const NATIVE_HOST_NAME = 'com.deepseek.tool_agent';
const TARGET_API = 'https://chat.deepseek.com/api/v0/chat/completion';

let nativePort = null;
let serverStatus = { running: false, mode: 'disconnected' };
let reconnectAttempts = 0;
var MAX_RECONNECT_ATTEMPTS = 3;
var lastConnectAttempt = 0;
var CONNECT_COOLDOWN_MS = 5000;

const TOOL_DEFINITIONS = [
  { name: "read_file", description: "读取本地文件的内容", parameters: { path: "文件的绝对路径 (string)" } },
  { name: "write_file", description: "写入内容到本地文件（不存在则创建，存在则覆盖）", parameters: { path: "文件的绝对路径 (string)", content: "要写入的文件内容 (string)" } },
  { name: "list_dir", description: "列出指定目录下的所有文件和子目录", parameters: { path: "目录的绝对路径 (string)" } },
  { name: "exec_command", description: "在 Windows 系统上执行一条 cmd 命令并返回输出结果", parameters: { command: "要执行的命令 (string)" } },
  { name: "append_file", description: "追加内容到本地文件末尾", parameters: { path: "文件的绝对路径 (string)", content: "要追加的内容 (string)" } },
  { name: "search_files", description: "在指定目录中搜索文件名匹配模式的文件", parameters: { pattern: "文件名的通配符模式 (string)", root: "搜索的根目录 (string)" } },
  { name: "get_file_info", description: "获取文件的详细信息（大小、修改时间等）", parameters: { path: "文件的绝对路径 (string)" } }
];

function buildSystemPrompt() {
  let prompt = `## 可用工具\n\n你可以通过调用以下工具来帮助用户操作本地文件。\n\n### 工具调用格式：\n<tool_call name="工具名称">\n{"参数名":"参数值"}\n</tool_call\n\n### 工具列表：\n`;
  TOOL_DEFINITIONS.forEach(t => {
    prompt += `\n#### ${t.name}\n${t.description}\n参数: ${JSON.stringify(t.parameters)}\n`;
  });
  prompt += `\n## 重要规则\n1. 当需要操作本地文件时，必须使用上述工具\n2. 每次只调用一个工具\n3. 等待工具执行结果后再决定下一步\n4. 文件路径请使用绝对路径`;
  return prompt;
}

const TOOL_EXECUTORS = {
  async read_file(args) { return await fetchExec('read_file', args); },
  async write_file(args) { return await fetchExec('write_file', args); },
  async list_dir(args) { return await fetchExec('list_dir', args); },
  async exec_command(args) { return await fetchExec('exec_command', args); },
  async append_file(args) { return await fetchExec('append_file', args); },
  async search_files(args) { return await fetchExec('search_files', args); },
  async get_file_info(args) { return await fetchExec('get_file_info', args); }
};

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
      if (!data.success) {
        var errMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : JSON.stringify(data);
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
  console.log('[DS-BG] ' + msg);
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

  // 如果 HTTP 服务已在运行，优先使用 HTTP 模式，不启动 Native Host
  checkHttpServer().then(function(httpOk) {
    if (httpOk && !nativePort) {
      bgLog('HTTP 服务已在运行，使用 HTTP 模式，不创建 Native Port');
      serverStatus = { running: true, mode: 'http' };
      notifyStatus();
      return;
    }
    doConnectNativeHost();
  }).catch(function() {
    doConnectNativeHost();
  });

  lastConnectAttempt = now;
}

function doConnectNativeHost() {
  if (nativePort) return;

  try {
    bgLog('connectNativeHost 开始 (attempt=' + reconnectAttempts + ')');
    bgLog('扩展ID: ' + (chrome.runtime.id || 'N/A'));

    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    bgLog('connectNative() 返回: port=true');
    reconnectAttempts = 0;

    nativePort.onMessage.addListener((message) => {
      bgLog('Native Host 消息: ' + JSON.stringify(message).substring(0, 200));

      switch (message.type) {
        case 'connect_ack':
          bgLog('Native Host 已响应 (alive), PID=' + message.pid + ', Node=' + message.node + ', 等待 launcher 就绪...');
          serverStatus = { running: false, mode: 'native_starting', pid: message.pid };
          notifyStatus();
          break;
        case 'started':
          serverStatus = {
            running: true,
            mode: message.mode || 'native',
            port: message.port,
            workspace: message.workspace,
            launcherPid: message.launcherPid
          };
          bgLog('✅ 服务器已启动 (端口: ' + message.port + ', 模式: ' + (message.mode || 'native') + ')');
          notifyStatus();
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
          bgLog('❌ Native Host 错误: ' + message.message);
          serverStatus = { running: false, mode: 'error', error: message.message };
          notifyStatus();
          break;
      }
    });

    nativePort.onDisconnect.addListener(() => {
      var discErr = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'none';
      bgLog('Native Host 断开 (error=' + discErr + ')');
      nativePort = null;

      // 断开后先检查 HTTP 服务是否仍在运行
      checkHttpServer().then(function(httpOk) {
        if (httpOk) {
          bgLog('HTTP 服务仍在运行，保持 running 状态 (HTTP模式)');
          serverStatus = { running: true, mode: 'http' };
          notifyStatus();
          return; // 不重连 Native Host
        }

        serverStatus = { running: false, mode: 'disconnected' };
        notifyStatus();

        var delay = Math.min(3000 * (reconnectAttempts + 1), 15000);
        reconnectAttempts++;
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          bgLog(reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ' 次重连，' + delay + 'ms 后尝试...');
          setTimeout(function() {
            if (!nativePort) connectNativeHost();
          }, delay);
        } else {
          bgLog('已达最大重连次数 (' + MAX_RECONNECT_ATTEMPTS + ')，停止自动重连。HTTP服务未运行，需手动启动或安装 Native Messaging');
        }
      });
    });

  } catch (error) {
    bgLog('❌ connectNative 异常: ' + error.message);
    nativePort = null;
    serverStatus = { running: false, mode: 'http_fallback', error: error.message };
    notifyStatus();

    reconnectAttempts++;
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      var delay = Math.min(3000 * reconnectAttempts, 15000);
      bgLog(reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ' 次重连，' + delay + 'ms 后尝试...');
      setTimeout(function() {
        if (!nativePort) connectNativeHost();
      }, delay);
    }
  }
}

function disconnectNativeHost() {
  if (nativePort) {
    try { nativePort.postMessage({ type: 'stop' }); } catch {}
    nativePort.disconnect();
    nativePort = null;
  }
}

async function executeTool(toolCall) {
  const { name, arguments: args } = toolCall;
  bgLog('执行工具: ' + name);

  const executor = TOOL_EXECUTORS[name];
  if (!executor) {
    const errorMsg = `未知工具: "${name}"。可用工具: ${Object.keys(TOOL_EXECUTORS).join(', ')}`;
    return { success: false, error: errorMsg };
  }

  try {
    const status = await checkServer();
    if (!status.running) {
      const errorMsg = '本地工具服务器未运行（端口 3002 无响应）';
      return { success: false, error: errorMsg, detail: { serverStatus: status } };
    }
    const result = await executor(args);
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
}

chrome.runtime.onInstalled.addListener(() => {
  bgLog('扩展已安装');
  chrome.storage.local.set({ toolEnabled: true });
});

chrome.runtime.onStartup.addListener(() => {
  bgLog('浏览器启动');
  reconnectAttempts = 0;
  lastConnectAttempt = 0;
  connectNativeHost();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  bgLog('收到消息: ' + request.action);

  switch (request.action) {
    case 'executeTool':
      executeTool(request.tool).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
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

      checkHttpServer().then(function(httpOk) {
        if (httpOk) {
          bgLog('HTTP 已在运行，直接返回成功');
          serverStatus = { running: true, mode: 'http' };
          sendResponse({ success: true, status: serverStatus });
          notifyStatus();
          return;
        }

        connectNativeHost();

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
      }).catch(function() {
        connectNativeHost();
        var maxWait = 35000;
        function checkAndRespond() {
          var elapsed = Date.now() - connStartTime;
          if (serverStatus.running || elapsed > maxWait) {
            sendResponse({ success: !!nativePort || serverStatus.running, status: serverStatus });
            notifyStatus();
          } else {
            setTimeout(checkAndRespond, 2000);
          }
        }
        setTimeout(checkAndRespond, 3000);
      });
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
              var timeout = setTimeout(function() {
                bgLog('restartServer: nativePort restart 超时');
                serverStatus = { running: false, mode: 'restarting' };
                notifyStatus();
                sendResult({ success: true, method: 'native_port', status: 'timeout_waiting' });
                resolve(true);
              }, 5000);
              var origListener = null;
              origListener = port.onMessage.addListener(function(msg) {
                if (msg.type === 'started' || msg.type === 'restarted') {
                  clearTimeout(timeout);
                  try { port.onMessage.removeListener(origListener); } catch(ex) {}
                  serverStatus = { running: !!msg.success, mode: msg.mode || 'native' };
                  notifyStatus();
                  sendResult({ success: true, method: 'native_port', data: msg });
                  resolve(true);
                }
              });
              resolve(true);
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
                    manualCommand: 'cd /d "F:\\桌面\\web_free_agent\\deepseek-tool-agent" && node server\\launcher.js'
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
                manualCommand: 'cd /d "F:\\桌面\\web_free_agent\\deepseek-tool-agent" && node server\\tool-server.js'
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

setTimeout(() => {
  bgLog('初始化完成，检测服务器状态...');
  checkHttpServer().then(function(httpOk) {
    if (httpOk) {
      bgLog('HTTP 服务已在运行，使用 HTTP 模式');
      serverStatus = { running: true, mode: 'http' };
      notifyStatus();
    } else {
      bgLog('HTTP 未运行，尝试连接 Native Host...');
      connectNativeHost();
    }
  }).catch(function() {
    connectNativeHost();
  });
}, 1000);

bgLog('Service Worker 初始化...');
