/**
 * DeepSeek Tool Agent - 启动器
 * 自动启动并监控 tool-server.js，崩溃时自动重启
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const SERVER_SCRIPT = path.join(__dirname, 'tool-server.js');
const HEALTH_CHECK_INTERVAL = 3000;
const RESTART_DELAY = 1000;
const MAX_RESTART_ATTEMPTS = 3;
const COOLDOWN_PERIOD = 10000;

let serverProcess = null;
let healthCheckTimer = null;
let isShuttingDown = false;
let consecutiveRestarts = 0;
let lastRestartTime = 0;
let totalRestarts = 0;
let launcherStartTime = Date.now();

const PORT = 3002;
const API_PORT = 3003;  // 启动器 API 端口

function log(msg, type = 'INFO') {
  const time = new Date().toTimeString().split(' ')[0];
  const symbols = { INFO: 'ℹ', WARN: '⚠', ERROR: '✖', SUCCESS: '✓', RESTART: '↻' };
  console.log(`[${time}] [${type}] ${symbols[type] || '•'} ${msg}`);
}

function getPidFile() {
  return path.join(__dirname, 'logs', 'server.pid');
}

function savePid() {
  if (serverProcess) {
    const pidFile = getPidFile();
    try {
      fs.mkdirSync(path.dirname(pidFile), { recursive: true });
      fs.writeFileSync(pidFile, String(serverProcess.pid));
    } catch (e) {}
  }
}

function removePid() {
  try {
    fs.unlinkSync(getPidFile());
  } catch (e) {}
}

function isServerRunning() {
  return new Promise((resolve) => {
    try {
      const req = http.get(`http://localhost:${PORT}/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.setTimeout(1000);
    } catch (e) {
      resolve(false);
    }
  });
}

async function startServer() {
  if (isShuttingDown) return false;

  const now = Date.now();
  if (now - lastRestartTime < COOLDOWN_PERIOD && consecutiveRestarts >= MAX_RESTART_ATTEMPTS) {
    log(`连续重启 ${MAX_RESTARTS} 次，进入冷却期，请检查服务器日志`, 'ERROR');
    return false;
  }

  if (serverProcess) {
    log('正在停止旧进程...', 'WARN');
    serverProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
  }

  log(`启动工具服务器: node "${path.basename(SERVER_SCRIPT)}"`, 'INFO');

  var spawnArgs = [SERVER_SCRIPT];

  serverProcess = spawn(process.execPath, spawnArgs, {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env }
  });

  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  serverProcess.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      log(`服务器进程退出 (code=${code}, signal=${signal})`, 'WARN');
      serverProcess = null;
      removePid();
      scheduleHealthCheck();
    }
  });

  serverProcess.on('error', (err) => {
    log(`服务器启动失败: ${err.message}`, 'ERROR');
    serverProcess = null;
  });

  consecutiveRestarts++;
  lastRestartTime = now;
  totalRestarts++;
  savePid();

  log(`等待服务器就绪...`, 'INFO');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const ready = await isServerRunning();
    if (ready) {
      log(`服务器已就绪 (PID: ${serverProcess.pid}, 重启次数: ${totalRestarts})`, 'SUCCESS');
      consecutiveRestarts = 0;
      return true;
    }
  }

  log(`服务器启动超时`, 'ERROR');
  return false;
}

async function restartServer() {
  log('收到重启请求', 'RESTART');
  await startServer();
}

function scheduleHealthCheck() {
  if (healthCheckTimer) {
    clearTimeout(healthCheckTimer);
  }
  healthCheckTimer = setTimeout(async () => {
    if (isShuttingDown) return;

    const running = await isServerRunning();
    if (!running && !serverProcess) {
      log('检测到服务器未运行，正在重启...', 'WARN');
      await startServer();
    } else if (running && !serverProcess) {
      log('检测到服务器在运行但进程已丢失', 'WARN');
      serverProcess = { pid: null };
    }

    scheduleHealthCheck();
  }, HEALTH_CHECK_INTERVAL);
}

function createLauncherApi() {
  const apiServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url.split('?')[0];

    if (url === '/api/launcher/status' && req.method === 'GET') {
      const running = await isServerRunning();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        running: true,
        serverRunning: running,
        serverPid: serverProcess ? serverProcess.pid : null,
        totalRestarts: totalRestarts,
        uptime: Math.floor((Date.now() - launcherStartTime) / 1000),
        launcherPid: process.pid,
        consecutiveRestarts: consecutiveRestarts,
        lastRestartTime: lastRestartTime
      }));
      return;
    }

    if (url === '/api/launcher/restart' && req.method === 'POST') {
      restartServer().then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '重启请求已提交' }));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
      return;
    }

    if (url === '/api/launcher/stop' && req.method === 'POST') {
      isShuttingDown = true;
      if (healthCheckTimer) clearTimeout(healthCheckTimer);
      if (serverProcess) serverProcess.kill('SIGTERM');
      removePid();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: '启动器已停止' }));
      setTimeout(() => process.exit(0), 500);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Unknown endpoint' }));
  });

  return apiServer;
}

function printBanner() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   DeepSeek Tool Agent - 启动器                                 ║
║   自动管理工具服务器进程                                        ║
║                                                                ║
║   Launcher API: http://localhost:${API_PORT}                        ║
║   Tool Server:  http://localhost:${PORT}                            ║
║                                                                ║
║   API Endpoints:                                              ║
║     GET  /api/launcher/status  - 获取状态                      ║
║     POST /api/launcher/restart - 重启服务器                   ║
║     POST /api/launcher/stop    - 停止启动器                    ║
║                                                                ║
║   Auto-restart: 崩溃自动重启 (最多${MAX_RESTART_ATTEMPTS}次连续)            ║
║   Health check: 每${HEALTH_CHECK_INTERVAL/1000}秒检测一次                         ║
║                                                                ║
║   Press Ctrl+C to stop                                         ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
}

async function main() {
  fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

  const launcherApi = createLauncherApi();
  launcherApi.listen(API_PORT, () => {
    printBanner();
    startServer().then(() => {
      scheduleHealthCheck();
    });
  });

  process.on('SIGINT', () => {
    log('正在停止...', 'WARN');
    isShuttingDown = true;
    if (healthCheckTimer) clearTimeout(healthCheckTimer);
    if (serverProcess) serverProcess.kill('SIGTERM');
    removePid();
    setTimeout(() => {
      launcherApi.close();
      process.exit(0);
    }, 500);
  });

  process.on('uncaughtException', (err) => {
    log(`未捕获异常: ${err.message}`, 'ERROR');
  });
}

main();