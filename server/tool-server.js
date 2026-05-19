// ============================================================
// DeepSeek Tool Agent - 本地工具服务器
// 负责执行文件操作和命令（类似 OpenClaw 的 bash-tools）
// ============================================================

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { spawn, execSync, exec: execCb, execFile: execFileCb } = require('child_process');
const util = require('util');
const os = require('os');

const PORT = 3002;
const WORKSPACE_DIR = path.resolve(__dirname, '..', 'workspace');
const LOGS_DIR = path.join(__dirname, 'logs');
const execPromise = util.promisify(execCb);
const execFilePromise = util.promisify(execFileCb);

// 配置：允许写入的路径白名单（默认仅工作目录）
// 如需开放权限，修改此变量，或通过 /api/config 接口设置
let ALLOWED_WRITE_PATHS = [WORKSPACE_DIR];

// ============================================================
// 确保工作目录和日志目录存在
// ============================================================
async function ensureDirectories() {
  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
    await fs.mkdir(LOGS_DIR, { recursive: true });
    console.log(`[ToolServer] 工作目录: ${WORKSPACE_DIR}`);
    console.log(`[ToolServer] 日志目录: ${LOGS_DIR}`);
  } catch (e) {
    console.error(`[ToolServer] 无法创建目录: ${e.message}`);
  }
}

// ============================================================
// 文件日志
// ============================================================
async function appendLog(level, message, data) {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const logFile = path.join(LOGS_DIR, `tool-server-${dateStr}.log`);
    let logLine = `[${timeStr}] [${level}] ${message}`;
    if (data) {
      logLine += ` | data=${JSON.stringify(data).substring(0, 500)}`;
    }
    logLine += '\n';
    await fs.appendFile(logFile, logLine, 'utf-8');
  } catch {}
}

// ============================================================
// 检查路径是否允许写入
// ============================================================
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  for (const allowed of ALLOWED_WRITE_PATHS) {
    const allowedResolved = path.resolve(allowed);
    if (resolved.startsWith(allowedResolved + path.sep) || resolved === allowedResolved) {
      return true;
    }
  }
  return false;
}

const WINDOWS_UNSAFE_CMD_CHARS_RE = /[&|<>^%\r\n]/;

function resolveWindowsCommandShim(command) {
  if (process.platform !== 'win32') return command;
  const basename = path.basename(command).toLowerCase();
  if (path.extname(basename)) return command;
  const cmdCommands = ['pnpm', 'yarn', 'npm', 'npx'];
  if (cmdCommands.includes(basename)) return command + '.cmd';
  return command;
}

function escapeForCmdExe(arg) {
  if (WINDOWS_UNSAFE_CMD_CHARS_RE.test(arg)) {
    throw new Error('Unsafe cmd.exe argument: ' + JSON.stringify(arg));
  }
  if (!arg.includes(' ') && !arg.includes('"')) return arg;
  return '"' + arg.replace(/"/g, '""') + '"';
}

function buildCmdExeCommandLine(resolvedCommand, args) {
  return [escapeForCmdExe(resolvedCommand), ...args.map(escapeForCmdExe)].join(' ');
}

function isWindowsBatchCommand(resolvedCommand) {
  if (process.platform !== 'win32') return false;
  const ext = path.extname(resolvedCommand).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') return true;
  const base = path.basename(resolvedCommand).toLowerCase();
  const cmdBuiltins = [
    'echo', 'dir', 'type', 'cd', 'chdir', 'copy', 'del', 'erase',
    'md', 'mkdir', 'rd', 'rmdir', 'ren', 'rename', 'move',
    'cls', 'date', 'time', 'ver', 'vol', 'label',
    'pushd', 'popd', 'set', 'setlocal', 'endlocal',
    'if', 'for', 'goto', 'call', 'exit', 'pause',
    'assoc', 'ftype', 'path', 'prompt', 'title',
    'color', 'find', 'more', 'sort', 'break', 'rem',
    'shift', 'start', 'verify', 'where'
  ];
  return cmdBuiltins.indexOf(base) >= 0;
}

function normalizePath(filePath) {
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved)) {
      throw new Error(`路径权限受限: ${resolved}。仅允许操作工作区目录及其子目录。`);
    }
    return resolved;
  }
  var normalized = filePath.replace(/^[/\\]*workspace[/\\]/i, '');
  return path.join(WORKSPACE_DIR, normalized);
}

// ============================================================
// 工具执行器（类似 OpenClaw 的 createExecTool）
// ============================================================
const TOOL_HANDLERS = {

  // read_file - 读取文件
  async read_file({ path: filePath }) {
    if (!filePath) throw new Error('缺少 path 参数');
    const resolvedPath = normalizePath(filePath);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    return { success: true, content, path: resolvedPath };
  },

  // write_file - 写入文件（默认仅允许写入工作目录）
  async write_file({ path: filePath, content }) {
    if (!filePath) throw new Error('缺少 path 参数');
    if (content === undefined) throw new Error('缺少 content 参数');
    const resolvedPath = normalizePath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, 'utf-8');
    await appendLog('INFO', `写入文件: ${resolvedPath}`, { size: content.length });
    return { success: true, path: resolvedPath };
  },

  // list_dir - 列出目录
  async list_dir({ path: dirPath }) {
    if (!dirPath) throw new Error('缺少 path 参数');
    const resolvedPath = normalizePath(dirPath);
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    
    const files = await Promise.all(entries.map(async entry => {
      const fullPath = path.join(resolvedPath, entry.name);
      let size = 0;
      try {
        if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          size = stat.size;
        }
      } catch {}
      
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size
      };
    }));
    
    // 排序：目录在前，文件在后
    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    
    return { success: true, files };
  },

  // exec_command - 执行命令（带 Windows 适配）
  async exec_command({ command }) {
    if (!command) throw new Error('缺少 command 参数');

    const isWin = process.platform === 'win32';

    try {
      let stdout, stderr;

      if (isWin) {
        const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [command];
        const rawCmd = parts[0] || command;
        const rawArgs = parts.slice(1).map(a => a.replace(/^"(.*)"$/, '$1'));

        const resolvedCommand = resolveWindowsCommandShim(rawCmd);
        const useCmdWrapper = isWindowsBatchCommand(resolvedCommand);

        if (useCmdWrapper) {
          const cmdLine = buildCmdExeCommandLine(resolvedCommand, rawArgs);
          const result = await execFilePromise(
            process.env.ComSpec || 'cmd.exe',
            ['/d', '/s', '/c', cmdLine],
            { timeout: 30000, maxBuffer: 1024 * 1024, windowsVerbatimArguments: true, cwd: WORKSPACE_DIR }
          );
          stdout = result.stdout;
          stderr = result.stderr;
        } else {
          const result = await execFilePromise(resolvedCommand, rawArgs, {
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            cwd: WORKSPACE_DIR
          });
          stdout = result.stdout;
          stderr = result.stderr;
        }
      } else {
        const result = await execPromise(command, {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          cwd: WORKSPACE_DIR
        });
        stdout = result.stdout;
        stderr = result.stderr;
      }

      return {
        success: true,
        stdout: (stdout || '').substring(0, 50000),
        stderr: (stderr || '').substring(0, 10000)
      };
    } catch (error) {
      return {
        success: true,
        stdout: (error.stdout || '').substring(0, 50000),
        stderr: (error.stderr || error.message || '').substring(0, 10000),
        exitCode: error.code || error.status || -1
      };
    }
  },

  // append_file - 追加到文件
  async append_file({ path: filePath, content }) {
    if (!filePath) throw new Error('缺少 path 参数');
    if (content === undefined) throw new Error('缺少 content 参数');
    const resolvedPath = normalizePath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.appendFile(resolvedPath, content, 'utf-8');
    await appendLog('INFO', `追加文件: ${resolvedPath}`, { size: content.length });
    return { success: true, path: resolvedPath };
  },

  // search_files - 搜索文件
  async search_files({ pattern, root }) {
    if (!pattern) throw new Error('缺少 pattern 参数');
    const searchRoot = root ? normalizePath(root) : WORKSPACE_DIR;
    const results = [];
    
    // 使用简单的递归搜索（限制深度为 3 层防止卡死）
    async function search(dir, depth = 0) {
      if (depth > 3) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.')) {
              await search(fullPath, depth + 1);
            }
          } else if (matchGlob(entry.name, pattern)) {
            results.push(fullPath);
          }
        }
      } catch {}
    }
    
    await search(searchRoot);
    return { success: true, files: results.slice(0, 100) };
  },

  // get_file_info - 获取文件信息
  async get_file_info({ path: filePath }) {
    if (!filePath) throw new Error('缺少 path 参数');
    const resolvedPath = normalizePath(filePath);
    const stat = await fs.stat(resolvedPath);
    
    return {
      success: true,
      info: {
        path: resolvedPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        birthtime: stat.birthtime.toISOString(),
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        permissions: stat.mode.toString(8).slice(-3)
      }
    };
  }
};

// ============================================================
// 启动器管理 - 在没有 launcher.js 时自行启动它
// ============================================================
let launcherProcess = null;

async function startLauncher() {
  const launcherScript = path.join(__dirname, 'launcher.js');
  
  try {
    await fs.access(launcherScript);
  } catch {
    return { success: false, error: `找不到启动器脚本: ${launcherScript}` };
  }

  if (launcherProcess) {
    return { success: true, message: '启动器已在运行中' };
  }

  try {
    launcherProcess = spawn(process.execPath, [launcherScript], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env }
    });

    launcherProcess.unref();

    launcherProcess.stdout.on('data', (data) => {
      process.stdout.write(`[Launcher Bootstrap] ${data}`);
    });

    launcherProcess.stderr.on('data', (data) => {
      process.stderr.write(`[Launcher Bootstrap] ${data}`);
    });

    launcherProcess.on('exit', (code) => {
      process.stdout.write(`[Launcher Bootstrap] 启动器进程已退出 (code=${code})\n`);
      launcherProcess = null;
    });

    launcherProcess.on('error', (err) => {
      process.stderr.write(`[Launcher Bootstrap] 启动器进程错误: ${err.message}\n`);
      launcherProcess = null;
    });

    return { success: true, message: '启动器已启动，等待就绪...', pid: launcherProcess.pid };
  } catch (err) {
    return { success: false, error: `启动启动器失败: ${err.message}` };
  }
}

// ============================================================
// 简单 glob 匹配
// ============================================================
function matchGlob(filename, pattern) {
  const regex = new RegExp(
    '^' + pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    + '$'
  );
  return regex.test(filename);
}

// ============================================================
// HTTP 服务器
// ============================================================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // 健康检查
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        version: '1.0.0',
        cwd: process.cwd(),
        platform: process.platform
      }));
      return;
    }

    // 解析 POST 请求体
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }

    const body = await parseBody(req);
    const urlPath = req.url;
    
    // 路由到对应的工具处理器
    let result;
    switch (urlPath) {
      case '/api/read':
        result = await TOOL_HANDLERS.read_file(body);
        break;
      case '/api/write':
        result = await TOOL_HANDLERS.write_file(body);
        break;
      case '/api/list':
        result = await TOOL_HANDLERS.list_dir(body);
        break;
      case '/api/exec':
        result = await TOOL_HANDLERS.exec_command(body);
        break;
      case '/api/append':
        result = await TOOL_HANDLERS.append_file(body);
        break;
      case '/api/search':
        result = await TOOL_HANDLERS.search_files(body);
        break;
      case '/api/file-info':
        result = await TOOL_HANDLERS.get_file_info(body);
        break;
      case '/api/log':
        await appendLog(body.level || 'INFO', body.message, body.data);
        result = { success: true };
        break;
      case '/api/config':
        if (body.action === 'get') {
          result = {
            success: true,
            workspace: WORKSPACE_DIR,
            logsDir: LOGS_DIR,
            allowedWritePaths: ALLOWED_WRITE_PATHS,
            platform: process.platform,
            port: PORT
          };
        } else if (body.action === 'set-workspace' && body.path) {
          const newPath = path.resolve(body.path);
          await fs.mkdir(newPath, { recursive: true });
          ALLOWED_WRITE_PATHS = [newPath];
          result = { success: true, workspace: newPath, message: '工作目录已更新' };
        } else if (body.action === 'open-permissions') {
          ALLOWED_WRITE_PATHS = [WORKSPACE_DIR, '/'];
          result = { success: true, message: '写入权限已开放，允许写入任何路径。可通过 /api/config 设置 action=restrict-permissions 恢复' };
        } else if (body.action === 'restrict-permissions') {
          ALLOWED_WRITE_PATHS = [WORKSPACE_DIR];
          result = { success: true, message: '写入权限已恢复，仅允许写入工作目录' };
        } else {
          result = { success: false, error: '未知操作，支持: get, set-workspace, open-permissions, restrict-permissions' };
        }
        break;
      case '/api/start-launcher':
        result = await startLauncher();
        break;
      default:
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: 'Unknown endpoint' }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));

  } catch (error) {
    console.error('[ToolServer] Error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
});

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================
// 启动服务器
// ============================================================
ensureDirectories().then(() => {
  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   DeepSeek Tool Agent - 本地工具服务器                       ║
║                                                              ║
║   Server: http://localhost:${PORT}                               ║
║   Workspace: ${WORKSPACE_DIR.padEnd(47)} ║
║   Logs: ${LOGS_DIR.padEnd(51)} ║
║                                                              ║
║   API Endpoints:                                              ║
║     POST /api/read       - 读取文件                          ║
║     POST /api/write      - 写入文件 (受权限控制)            ║
║     POST /api/list       - 列出目录                          ║
║     POST /api/exec       - 执行命令                          ║
║     POST /api/append     - 追加文件 (受权限控制)            ║
║     POST /api/search     - 搜索文件                          ║
║     POST /api/file-info  - 文件信息                          ║
║     POST /api/log        - 写入日志                          ║
║     POST /api/config     - 获取/修改配置                     ║
║     GET  /health         - 健康检查                          ║
║                                                              ║
║   权限说明:                                                   ║
║     默认仅允许写入 workspace/ 目录                            ║
║     如需开放权限, 调用: POST /api/config                     ║
║       {"action":"open-permissions"}                          ║
║                                                              ║
║   Press Ctrl+C to stop                                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
  });
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
});