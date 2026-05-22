// ============================================================
// DeepSeek Tool Agent - Native Messaging Host
// 由浏览器自动启动/关闭，无需手动操作
// ============================================================

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec: execCb } = require('child_process');
const util = require('util');

const execPromise = util.promisify(execCb);
const PORT = 3002;
const WORKSPACE_DIR = path.join(__dirname, '..', 'workspace');

function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith(WORKSPACE_DIR + path.sep) || resolved === WORKSPACE_DIR) return true;
  return false;
}

function normalizePath(filePath) {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    return resolved;
  }
  var normalized = filePath.replace(/^[/\\]*workspace[/\\]/i, '');
  return path.join(WORKSPACE_DIR, normalized);
}

let httpServer = null;
let isRunning = false;
var startedSent = false;

// ============================================================
// Native Messaging 协议：读取消息
// ============================================================
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

function readMessageSync() {
  const lengthBuffer = process.stdin.read(4);
  if (lengthBuffer === null) return null;

  const length = lengthBuffer.readInt32LE(0);
  if (length <= 0 || length > 1024 * 1024) return null;

  const messageBuffer = process.stdin.read(length);
  if (messageBuffer === null) return null;

  return JSON.parse(messageBuffer.toString('utf-8'));
}

// ============================================================
// Native Messaging 协议：发送消息（安全版本）
// ============================================================
function sendMessage(message) {
  try {
    if (process.stdout.writable === false) {
      nhLog('stdout 不可写，跳过发送: ' + message.type);
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

// ============================================================
// 工具执行器
// ============================================================
const TOOL_HANDLERS = {
  async read_file({ path: filePath }) {
    if (!filePath) throw new Error('缺少 path 参数');
    let resolvedPath = normalizePath(filePath);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    return { content, path: resolvedPath };
  },

  async write_file({ path: filePath, content }) {
    if (!filePath) throw new Error('缺少 path 参数');
    if (content === undefined) throw new Error('缺少 content 参数');
    let resolvedPath = normalizePath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, 'utf-8');
    return { path: resolvedPath };
  },

  async list_dir({ path: dirPath }) {
    if (!dirPath) throw new Error('缺少 path 参数');
    const resolvedPath = normalizePath(dirPath);
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
      let size = 0;
      try { if (entry.isFile()) { const stat = await fs.stat(path.join(resolvedPath, entry.name)); size = stat.size; } } catch {}
      return { name: entry.name, isDirectory: entry.isDirectory(), size };
    }));
    files.sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name); });
    return { files };
  },

  async exec_command({ command }) {
    if (!command) throw new Error('缺少 command 参数');
    const { stdout, stderr } = await execPromise(command, { timeout: 30000, maxBuffer: 1024 * 1024, cwd: WORKSPACE_DIR });
    return { stdout: stdout.substring(0, 50000), stderr: stderr.substring(0, 10000) };
  },

  async append_file({ path: filePath, content }) {
    if (!filePath) throw new Error('缺少 path 参数');
    if (content === undefined) throw new Error('缺少 content 参数');
    let resolvedPath = normalizePath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.appendFile(resolvedPath, content, 'utf-8');
    return { path: resolvedPath };
  },

  async search_files({ pattern, root }) {
    if (!pattern) throw new Error('缺少 pattern 参数');
    const searchRoot = root ? normalizePath(root) : WORKSPACE_DIR;
    const results = [];
    async function search(dir, depth = 0) {
      if (depth > 3) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) { if (!entry.name.startsWith('.')) await search(fullPath, depth + 1); }
          else if (new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(entry.name)) results.push(fullPath);
        }
      } catch {}
    }
    await search(searchRoot);
    return { files: results.slice(0, 100) };
  },

  async get_file_info({ path: filePath }) {
    if (!filePath) throw new Error('缺少 path 参数');
    const resolvedPath = normalizePath(filePath);
    const stat = await fs.stat(resolvedPath);
    return { info: { path: resolvedPath, size: stat.size, mtime: stat.mtime.toISOString(), birthtime: stat.birthtime.toISOString(), isDirectory: stat.isDirectory(), isFile: stat.isFile() } };
  }
};

// ============================================================
// HTTP 服务器（用于扩展通信）
// ============================================================
function startHttpServer() {
  return new Promise((resolve, reject) => {
    httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

      try {
        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', version: '1.0.0', platform: process.platform }));
          return;
        }

        if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ success: false, error: 'Method not allowed' })); return; }

        const body = await parseBody(req);
        let result;
        switch (req.url) {
          case '/api/read': result = await TOOL_HANDLERS.read_file(body); break;
          case '/api/write': result = await TOOL_HANDLERS.write_file(body); break;
          case '/api/list': result = await TOOL_HANDLERS.list_dir(body); break;
          case '/api/exec': result = await TOOL_HANDLERS.exec_command(body); break;
          case '/api/append': result = await TOOL_HANDLERS.append_file(body); break;
          case '/api/search': result = await TOOL_HANDLERS.search_files(body); break;
          case '/api/file-info': result = await TOOL_HANDLERS.get_file_info(body); break;
          default: res.writeHead(404); res.end(JSON.stringify({ success: false, error: 'Unknown endpoint' })); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });

    httpServer.listen(PORT, () => {
      isRunning = true;
      nhLog('HTTP 服务器已启动: http://localhost:' + PORT);
      resolve();
    });

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        nhLog('端口 ' + PORT + ' 被占用，HTTP服务可能已在运行，继续使用现有服务');
        isRunning = true;
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

function stopHttpServer() {
  return new Promise((resolve) => {
    if (httpServer) {
      httpServer.close(() => {
        isRunning = false;
        nhLog('HTTP 服务器已关闭');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ============================================================
// 日志
// ============================================================
const os = require('os');
const LOG_PATH = path.join(os.tmpdir(), 'ds-native-host.log');

function nhLog(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n';
  console.error('[NativeHost] ' + msg);
  try { fs.appendFile(LOG_PATH, line); } catch(e) {}
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  nhLog('=== Native Host 启动 ===');
  nhLog('Node: ' + process.version);
  nhLog('PID: ' + process.pid);
  nhLog('工作目录: ' + WORKSPACE_DIR);

  try { await fs.mkdir(WORKSPACE_DIR, { recursive: true }); } catch (e) { nhLog('mkdir 失败: ' + e.message); }

  // 启动 HTTP 服务器（端口被占用也算成功）
  try {
    await startHttpServer();
    nhLog('HTTP 服务就绪');
  } catch (err) {
    nhLog('HTTP 服务器启动失败: ' + err.message);
  }

  // 发送 started 消息（如果 stdout 还可写）
  startedSent = sendMessage({ type: 'started', port: PORT, workspace: WORKSPACE_DIR });
  nhLog(startedSent ? '已发送 started 消息到浏览器' : 'started 消息发送失败（stdin可能已关闭）');

  // 标记 stdin 状态
  var stdinClosed = false;
  process.stdin.on('end', function() {
    stdinClosed = true;
    nhLog('stdin 已关闭 (浏览器断开)');
  });
  process.stdin.on('error', function(e) {
    nhLog('stdin 错误: ' + e.message);
  });

  // ===== 主消息循环 =====
  var consecutiveNulls = 0;
  var mainLoopActive = true;

  while (mainLoopActive) {
    // 检查 stdin 是否彻底不可用
    if (process.stdin.readableEnded || process.stdin.destroyed) {
      nhLog('stdin 已结束，退出主循环，进入守护模式');
      break;
    }

    try {
      const message = await readMessage();
      if (message === null) {
        consecutiveNulls++;
        if (consecutiveNulls > 15) {
          nhLog('连续15次null读取，检查状态 readableEnded=' + process.stdin.readableEnded + ' destroyed=' + process.stdin.destroyed);
          if (process.stdin.readableEnded || process.stdin.destroyed) {
            break;
          }
          consecutiveNulls = 0;
        }
        await new Promise(function(r) { setTimeout(r, 300); });
        continue;
      }
      consecutiveNulls = 0;

      nhLog('收到消息: ' + message.type);

      switch (message.type) {
        case 'ping':
          sendMessage({ type: 'pong', running: isRunning });
          break;
        case 'stop':
          nhLog('收到 stop 命令，退出');
          await stopHttpServer();
          process.exit(0);
          break;
        case 'execute_tool':
          try {
            var handler = TOOL_HANDLERS[message.tool];
            if (!handler) {
              sendMessage({ type: 'tool_result', success: false, error: '未知工具: ' + message.tool });
            } else {
              var result = await handler(message.args);
              sendMessage({ type: 'tool_result', success: true, data: result });
            }
          } catch (err) {
            sendMessage({ type: 'tool_result', success: false, error: err.message });
          }
          break;
        default:
          nhLog('未知消息类型: ' + message.type);
          sendMessage({ type: 'unknown', message: '未知消息类型: ' + message.type });
      }
    } catch (err) {
      nhLog('消息处理错误: ' + err.message + '\n' + (err.stack || '').substring(0, 500));
      if (process.stdin.readableEnded || process.stdin.destroyed) break;
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }

  // ===== 守护模式：stdin 关闭后保持 HTTP 服务运行 =====
  nhLog('=== 进入守护模式 ===');
  nhLog('浏览器已断开连接，HTTP 服务器继续保持运行...');
  nhLog('守护超时: 10 分钟无活动后自动退出');

  var IDLE_TIMEOUT = 10 * 60 * 1000;
  var idleStart = Date.now();

  while (true) {
    // 尝试重新读取 stdin（浏览器可能重连）
    if (process.stdin.readable && !process.stdin.readableEnded && !process.stdin.destroyed) {
      try {
        var msg = await readMessage();
        if (msg !== null) {
          idleStart = Date.now();
          nhLog('浏览器重连！收到: ' + msg.type);
          switch (msg.type) {
            case 'ping':
              sendMessage({ type: 'pong', running: isRunning });
              break;
            case 'stop':
              nhLog('收到 stop 命令（守护模式）');
              await stopHttpServer();
              process.exit(0);
              break;
            default:
              sendMessage({ type: 'unknown', message: '未知消息类型: ' + msg.type });
          }
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    // 等待2秒后再次检查
    await new Promise(function(r) { setTimeout(r, 2000); });

    // 超时检查
    if (Date.now() - idleStart > IDLE_TIMEOUT) {
      nhLog('守护超时 (' + (IDLE_TIMEOUT / 1000) + 's 无活动)，退出');
      break;
    }

    // 每30秒心跳日志
    var idleSec = Math.round((Date.now() - idleStart) / 1000);
    if (idleSec % 30 < 3) {
      nhLog('守护中... HTTP=' + (isRunning ? '运行中' : '已停止') + ' 空闲=' + idleSec + 's PID=' + process.pid);
    }
  }

  nhLog('正在关闭 HTTP 服务器...');
  await stopHttpServer();
  nhLog('=== Native Host 正常退出 ===');
  process.exit(0);
}

// ============================================================
// 启动入口
// ============================================================
process.stdin.resume();

main().catch(function(err) {
  nhLog('致命错误: ' + err.message + '\n' + (err.stack || '').substring(0, 1000));
  // 即使出错也尝试进入守护模式（如果 HTTP 服务已启动）
  if (isRunning) {
    nhLog('主循环异常但HTTP服务仍在运行，进入守护模式...');
    var IDLE_TIMEOUT = 10 * 60 * 1000;
    var idleStart = Date.now();
    var guardInterval = setInterval(function() {
      if (Date.now() - idleStart > IDLE_TIMEOUT) {
        clearInterval(guardInterval);
        stopHttpServer().then(function() { process.exit(1); });
        return;
      }
      nhLog('异常守护中... 空闲=' + Math.round((Date.now() - idleStart)/1000) + 's');
    }, 15000);
  } else {
    process.exit(1);
  }
});
