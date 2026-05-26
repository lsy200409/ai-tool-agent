// ============================================================
// DeepSeek Tool Agent - Native Messaging Host (Launcher Proxy)
// 由浏览器自动启动/关闭，负责启动 launcher.js 并桥接通信
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const PORT = 3002;
const LAUNCHER_SCRIPT = path.join(__dirname, '..', 'server', 'launcher.js');
const WORKSPACE_DIR = path.join(__dirname, '..', 'workspace');
const LOG_PATH = path.join(os.tmpdir(), 'ds-native-host.log');

let launcherProcess = null;
let isRunning = false;
let daemonCleanup = null;

function nhLog(msg) {
  const line = new Date().toISOString() + ' [Proxy] ' + msg + '\n';
  console.error('[NativeHost] ' + msg);
  try { fs.appendFile(LOG_PATH, line); } catch(e) {}
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
    await fs.stat(LAUNCHER_SCRIPT);
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

  if (daemonCleanup) {
    clearInterval(daemonCleanup);
    daemonCleanup = null;
  }
}

// ============================================================
// Native Messaging 协议
// ============================================================
function readMessageSync() {
  const lengthBuffer = process.stdin.read(4);
  if (lengthBuffer === null) return null;

  const length = lengthBuffer.readInt32LE(0);
  if (length <= 0 || length > 1024 * 1024) return null;

  const messageBuffer = process.stdin.read(length);
  if (messageBuffer === null) return null;

  return JSON.parse(messageBuffer.toString('utf-8'));
}

function sendMessage(message) {
  try {
    if (process.stdout.writable === false) {
      nhLog('stdout 不可写，跳过发送: ' + (message ? message.type : 'null'));
      return false;
    }
    const json = JSON.stringify(message);
    const buffer = Buffer.from(json, 'utf-8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeInt32LE(buffer.length, 0);
    process.stdout.write(lengthBuffer);
    process.stdout.write(buffer);
    return true;
  } catch (e) {
    nhLog('sendMessage 异常: ' + e.message);
    return false;
  }
}

function readMessage() {
  return new Promise((resolve, reject) => {
    const chunk = process.stdin.read();
    if (chunk !== null) {
      process.stdin.unshift(chunk);
      try {
        const msg = readMessageSync();
        if (msg === null) {
          setTimeout(() => readMessage().then(resolve).catch(reject), 50);
          return;
        }
        resolve(msg);
      } catch (e) {
        reject(e);
      }
      return;
    }

    if (process.stdin.readableEnded || process.stdin.destroyed) {
      resolve(null);
      return;
    }

    process.stdin.once('readable', () => {
      try {
        const msg = readMessageSync();
        if (msg === null) {
          setTimeout(() => readMessage().then(resolve).catch(reject), 50);
          return;
        }
        resolve(msg);
      } catch (e) {
        reject(e);
      }
    });
  });
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

  sendMessage({
    type: 'connect_ack',
    status: 'alive',
    pid: process.pid,
    node: process.version,
    port: PORT
  });
  nhLog('已发送 connect_ack (立即响应，防止 Chrome 超时断开)');

  try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) {}

  isRunning = await startLauncher();

  sendMessage({
    type: isRunning ? 'started' : 'start_failed',
    port: PORT,
    workspace: WORKSPACE_DIR,
    mode: 'launcher_proxy',
    running: isRunning,
    launcherPid: launcherProcess ? launcherProcess.pid : null
  });
  nhLog('已发送 ' + (isRunning ? 'started' : 'start_failed') + ' 消息');

  let consecutiveNulls = 0;

  while (true) {
    if (process.stdin.readableEnded || process.stdin.destroyed) {
      nhLog('stdin 已结束，退出主循环');
      break;
    }

    try {
      const message = await readMessage();
      if (message === null) {
        consecutiveNulls++;
        if (consecutiveNulls > 15) {
          nhLog('连续15次 null，检查 stdin 状态');
          if (process.stdin.readableEnded || process.stdin.destroyed) break;
          consecutiveNulls = 0;
        }
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      consecutiveNulls = 0;

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
          return;

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
    } catch (err) {
      nhLog('消息处理错误: ' + err.message + '\n' + (err.stack || '').substring(0, 500));
      if (process.stdin.readableEnded || process.stdin.destroyed) break;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  nhLog('=== 进入守护模式 ===');
  nhLog('浏览器已断开，launcher 继续保持运行...');
  const IDLE_TIMEOUT = 30 * 60 * 1000;

  daemonCleanup = setInterval(async () => {
    try {
      if (process.stdin.readable && !process.stdin.readableEnded && !process.stdin.destroyed) {
        const msg = await readMessage();
        if (msg !== null) {
          nhLog('浏览器重连！收到: ' + msg.type);
          if (msg.type === 'stop') {
            nhLog('收到 stop 命令（守护模式）');
            stopLauncher();
            process.exit(0);
          }
        }
      }
    } catch (e) {}
  }, 3000);

  setTimeout(() => {
    nhLog('守护超时 (' + (IDLE_TIMEOUT / 1000 / 60) + ' 分钟)，退出');
    stopLauncher();
    process.exit(0);
  }, IDLE_TIMEOUT);
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