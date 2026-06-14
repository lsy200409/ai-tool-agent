// ============================================================
// AI Tool Agent - Native Messaging Host (Launcher Proxy)
// 由浏览器自动启动/关闭，负责启动 launcher.js 并桥接通信
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3002;
// 项目根目录：优先环境变量，其次 __dirname 相对路径
const PROJECT_ROOT = process.env.AI_TOOL_AGENT_HOME || path.resolve(__dirname, '..');
const LAUNCHER_SCRIPT = path.join(PROJECT_ROOT, 'server', 'launcher.js');
const WORKSPACE_DIR = path.join(PROJECT_ROOT, 'workspace');
const LOG_PATH = path.join(os.tmpdir(), 'ds-native-host.log');

let launcherProcess = null;
let isRunning = false;

function nhLog(msg) {
  const line = new Date().toISOString() + ' [NH] ' + msg + '\n';
  try { fs.appendFileSync(LOG_PATH, line); } catch(e) {}
}

// ============================================================
// HTTP 代理请求到 tool-server
// ============================================================
function proxyRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body || {});
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 60000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ success: false, error: 'Invalid JSON response from server' });
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error('代理请求失败: ' + err.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('代理请求超时'));
    });

    req.write(postData);
    req.end();
  });
}

// ============================================================
// 健康检查
// ============================================================
function checkHealth(timeoutMs) {
  timeoutMs = timeoutMs || 2000;
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/health`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ============================================================
// 启动 launcher.js
// ============================================================
async function startLauncher() {
  const alreadyRunning = await checkHealth(1000);
  if (alreadyRunning) {
    nhLog('tool-server 已在运行 (端口 ' + PORT + ')');
    return true;
  }

  nhLog('启动 launcher.js...');
  nhLog('Launcher 路径: ' + LAUNCHER_SCRIPT);

  try {
    fs.statSync(LAUNCHER_SCRIPT);
  } catch (e) {
    nhLog('launcher.js 不存在: ' + e.message);
    return false;
  }

  launcherProcess = spawn(process.execPath, [LAUNCHER_SCRIPT], {
    cwd: path.dirname(LAUNCHER_SCRIPT),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env }
  });

  launcherProcess.stdout.on('data', (data) => {
    nhLog('[Launcher] ' + data.toString().trim());
  });

  launcherProcess.stderr.on('data', (data) => {
    nhLog('[Launcher:ERR] ' + data.toString().trim());
  });

  launcherProcess.on('exit', (code, signal) => {
    nhLog('Launcher 进程退出 (code=' + code + ', signal=' + signal + ')');
    launcherProcess = null;
  });

  launcherProcess.on('error', (err) => {
    nhLog('Launcher 启动失败: ' + err.message);
    launcherProcess = null;
  });

  nhLog('等待 tool-server 就绪...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await checkHealth(1000)) {
      nhLog('tool-server 已就绪 (端口 ' + PORT + ')');
      return true;
    }
    if (!launcherProcess) {
      nhLog('Launcher 进程意外退出');
      return false;
    }
  }

  nhLog('tool-server 启动超时');
  return false;
}

// ============================================================
// 停止 launcher.js
// ============================================================
function stopLauncher() {
  if (launcherProcess) {
    nhLog('正在停止 launcher...');
    launcherProcess.kill('SIGTERM');
    launcherProcess = null;
  }
}

// ============================================================
// Native Messaging 协议 - 使用 data 事件缓冲模式
// 注意：直接用 node.exe 启动在 Windows 上会导致管道崩溃
// 必须通过 .bat 文件启动（见 setup-bat.js）
// ============================================================
let incomingBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  incomingBuffer = Buffer.concat([incomingBuffer, chunk]);
  processIncoming();
});

function processIncoming() {
  while (incomingBuffer.length >= 4) {
    const msgLen = incomingBuffer.readInt32LE(0);
    if (msgLen <= 0 || msgLen > 1024 * 1024) {
      nhLog('invalid msg len: ' + msgLen);
      incomingBuffer = incomingBuffer.slice(4);
      continue;
    }
    if (incomingBuffer.length < 4 + msgLen) break;
    const msgBuf = incomingBuffer.slice(4, 4 + msgLen);
    incomingBuffer = incomingBuffer.slice(4 + msgLen);
    try {
      handleMessage(JSON.parse(msgBuf.toString('utf-8')));
    } catch (e) {
      nhLog('JSON parse fail: ' + e.message);
    }
  }
}

function sendMessage(message) {
  try {
    const json = JSON.stringify(message);
    const header = Buffer.alloc(4);
    header.writeInt32LE(Buffer.byteLength(json), 0);
    process.stdout.write(header);
    process.stdout.write(json, 'utf-8');
    nhLog('sent: ' + json.substring(0, 100));
    return true;
  } catch (e) {
    nhLog('sendMessage 异常: ' + e.message);
    return false;
  }
}

// ============================================================
// 工具执行映射（native messaging tool → HTTP endpoint）
// ============================================================
const TOOL_ENDPOINTS = {
  read_file: '/api/read',
  write_file: '/api/write',
  list_dir: '/api/list',
  exec_command: '/api/exec',
  append_file: '/api/append',
  search_files: '/api/search',
  get_file_info: '/api/file-info'
};

async function handleExecuteTool(message) {
  const endpoint = TOOL_ENDPOINTS[message.tool];
  if (!endpoint) {
    return { success: false, error: '未知工具: ' + message.tool };
  }

  try {
    const result = await proxyRequest(endpoint, message.args);
    if (result && result.success !== false) {
      return { success: true, data: result };
    }
    return { success: false, error: (result && result.error) ? result.error : '服务器返回失败' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// 消息处理（事件驱动，由 processIncoming 调用）
// ============================================================
async function handleMessage(message) {
  nhLog('收到消息: ' + message.type);

  switch (message.type) {
    case 'ping':
      const healthy = await checkHealth(2000);
      sendMessage({ type: 'pong', running: healthy });
      break;

    case 'stop':
      nhLog('收到 stop 命令');
      stopLauncher();
      process.exit(0);

    case 'execute_tool':
      const result = await handleExecuteTool(message);
      sendMessage({ type: 'tool_result', ...result });
      break;

    case 'restart':
      nhLog('收到 restart 命令');
      stopLauncher();
      await new Promise(r => setTimeout(r, 1000));
      const restarted = await startLauncher();
      sendMessage({ type: 'restarted', success: restarted });
      break;

    default:
      nhLog('未知消息类型: ' + message.type);
      sendMessage({ type: 'unknown', message: '未知消息类型: ' + message.type });
  }
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  nhLog('=== Native Host (Launcher Proxy) 启动 ===');
  nhLog('Node: ' + process.version);
  nhLog('PID: ' + process.pid);
  nhLog('Launcher: ' + LAUNCHER_SCRIPT);

  process.stdin.on('end', () => {
    nhLog('stdin 已关闭（浏览器断开）');
    process.exit(0);
  });
  process.stdin.on('error', (e) => {
    nhLog('stdin 错误: ' + e.message);
  });

  // 立即发送 connect_ack
  sendMessage({
    type: 'connect_ack',
    status: 'alive',
    pid: process.pid,
    node: process.version,
    port: PORT
  });

  try { fs.mkdirSync(WORKSPACE_DIR, { recursive: true }); } catch (e) {}

  // 启动 launcher
  isRunning = await startLauncher();

  // 发送 started/start_failed
  sendMessage({
    type: isRunning ? 'started' : 'start_failed',
    port: PORT,
    workspace: WORKSPACE_DIR,
    mode: 'launcher_proxy',
    running: isRunning,
    launcherPid: launcherProcess ? launcherProcess.pid : null
  });
  nhLog('已发送 ' + (isRunning ? 'started' : 'start_failed') + ' 消息');

  // 消息循环由 process.stdin data 事件驱动（见上方 processIncoming）
  nhLog('等待消息...');
}

// ============================================================
// 启动入口
// ============================================================
process.stdin.resume();

main().catch(function(err) {
  nhLog('致命错误: ' + err.message + '\n' + (err.stack || '').substring(0, 1000));
  stopLauncher();
  process.exit(1);
});