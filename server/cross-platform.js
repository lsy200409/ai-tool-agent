// ============================================================
// DeepSeek Tool Agent v0.1.1 — 跨平台适配层
//
// 统一 Windows/Linux/Mac/WSL2 差异:
//   - 路径规范化
//   - 命令适配 (cmd / powershell / bash / wsl)
//   - WSL2 检测与路径转换
//   - 权限检测
//   - 文件系统差异处理
// ============================================================

const os = require('os');
const path = require('path');
const fsp = require('fs').promises;
const { execSync } = require('child_process');

const PLATFORM = {
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  isMac: process.platform === 'darwin',
  platform: process.platform,
  arch: process.arch,
  homeDir: os.homedir(),
  tmpDir: os.tmpdir(),
  hostname: os.hostname(),
  eol: os.EOL,
  pathSep: path.sep,
  cpus: os.cpus().length,
  memoryMB: Math.round(os.totalmem() / (1024 * 1024))
};

// ============================================================
// WSL2 检测与适配
// ============================================================
const WSL = {
  _available: null,
  _distros: null,

  // 检测 WSL 是否可用（仅 Windows 有效）
  isAvailable() {
    if (!PLATFORM.isWindows) return false;
    if (this._available !== null) return this._available;
    try {
      execSync('wsl --list --quiet', { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      this._available = true;
    } catch (e) {
      this._available = false;
    }
    return this._available;
  },

  // 获取已安装的 WSL 发行版列表
  getDistros() {
    if (!PLATFORM.isWindows) return [];
    if (this._distros !== null) return this._distros;
    try {
      const output = execSync('wsl --list --quiet', { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      // WSL 输出可能含 BOM 和空行，需要清理
      this._distros = output.split('\n')
        .map(line => line.replace(/[\r\0\u0000-\u001F]/g, '').trim())
        .filter(line => line.length > 0);
    } catch (e) {
      this._distros = [];
    }
    return this._distros;
  },

  // 获取默认发行版名称
  getDefaultDistro() {
    const distros = this.getDistros();
    return distros.length > 0 ? distros[0] : 'Ubuntu';
  },

  // Windows 路径 → WSL 路径
  // C:\Users\test\file.txt → /mnt/c/Users/test/file.txt
  winToWsl(winPath) {
    // 已经是 WSL 路径
    if (winPath.startsWith('/mnt/')) return winPath;
    // 统一正斜杠
    const normalized = winPath.replace(/\\/g, '/');
    // 匹配盘符: C:/... → /mnt/c/...
    const driveMatch = normalized.match(/^([a-zA-Z]):(\/.*)/);
    if (driveMatch) {
      return '/mnt/' + driveMatch[1].toLowerCase() + driveMatch[2];
    }
    return normalized;
  },

  // WSL 路径 → Windows 路径
  // /mnt/c/Users/test/file.txt → C:\Users\test\file.txt
  wslToWin(wslPath) {
    // 匹配 /mnt/X/... → X:\...
    const mntMatch = wslPath.match(/^\/mnt\/([a-zA-Z])(\/.*)/);
    if (mntMatch) {
      return mntMatch[1].toUpperCase() + ':' + mntMatch[2].replace(/\//g, '\\');
    }
    return wslPath;
  },

  // 判断路径是否为 WSL 路径（/mnt/...）
  isWslPath(inputPath) {
    return /^\/mnt\/[a-zA-Z]\//.test(inputPath);
  },

  // 判断路径是否在 WSL 原生文件系统中（非 /mnt/）
  isWslNativePath(inputPath) {
    return inputPath.startsWith('/') && !inputPath.startsWith('/mnt/') && !inputPath.startsWith('/proc/') && !inputPath.startsWith('/sys/');
  },

  // 在 WSL 中执行命令
  // 返回 { command: string, shell: boolean } 供 execPromise 使用
  buildWslCommand(command, options) {
    const distro = (options && options.distro) || this.getDefaultDistro();
    const wslCwd = options && options.cwd ? this.winToWsl(options.cwd) : '';
    // 验证 distro 名称，防止命令注入（只允许字母数字、点、连字符）
    if (distro && !/^[a-zA-Z0-9._-]+$/.test(distro)) {
      throw new Error('无效的 WSL 发行版名称: ' + distro);
    }
    // 注意：不使用 chcp 65001 前缀，因为 cmd.exe 不认单引号，会导致 WSL_E_INVALIDARG
    // 编码问题通过 execOptions.encoding = 'utf-8' 在 Node.js 层面解决
    let wslCmd = 'wsl';
    if (distro) wslCmd += ' -d ' + distro;
    // --cd 参数：Linux 路径不含空格时直接拼接，含空格时用双引号包裹（cmd.exe 认双引号）
    if (wslCwd) {
      if (wslCwd.indexOf(' ') >= 0) {
        wslCmd += ' --cd "' + wslCwd + '"';
      } else {
        wslCmd += ' --cd ' + wslCwd;
      }
    }
    // 在 bash 内设置 LANG=C.UTF-8 确保输出为 UTF-8 编码
    // 使用 bash -c "..." 双引号格式（cmd.exe 能正确传递双引号给 wsl）
    var innerCmd = 'export LANG=C.UTF-8; ' + command;
    // 对双引号内的内容进行转义
    innerCmd = innerCmd.replace(/"/g, '\\"');
    wslCmd += ' -- bash -c "' + innerCmd + '"';
    return wslCmd;
  },

  // 获取 WSL 的 HOME 目录（Windows 路径格式）
  getWslHomeDir() {
    if (!this.isAvailable()) return null;
    try {
      const home = execSync('wsl -- bash -c "echo $HOME"', {
        encoding: 'utf-8', timeout: 5000, windowsHide: true
      }).trim();
      // 转换为 Windows 路径
      if (home.startsWith('/home/')) {
        return '\\\\wsl$\\' + this.getDefaultDistro() + home.replace(/\//g, '\\');
      }
      return this.wslToWin(home);
    } catch (e) {
      return null;
    }
  }
};

// Shell 参数转义
function escapeShellArg(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ============================================================
// 路径适配
// ============================================================
function normalizePathForPlatform(inputPath) {
  let result = inputPath;
  // 统一分隔符
  result = result.replace(/\\/g, '/');
  // 移除尾部斜线
  result = result.replace(/\/+$/, '');
  return result;
}

function resolveHomeDir(inputPath) {
  if (inputPath.startsWith('~')) {
    const homeDir = os.homedir().replace(/\\/g, '/');
    return homeDir + inputPath.substring(1);
  }
  return inputPath;
}

function isPathWithinWorkspace(filePath, workspaceDir) {
  const resolved = path.resolve(filePath);
  const wsResolved = path.resolve(workspaceDir);
  // 统一路径分隔符后再比较，避免 Windows 下混合分隔符导致误判
  const normalizedResolved = resolved.replace(/\\/g, '/').toLowerCase();
  const normalizedWs = wsResolved.replace(/\\/g, '/').toLowerCase();
  return normalizedResolved.startsWith(normalizedWs + '/') || normalizedResolved === normalizedWs;
}

// 解析路径，支持 WSL 路径格式
// /wsl$/Ubuntu/home/user → WSL 原生路径
// /mnt/c/Users/... → Windows 路径（通过 WSL 访问）
function resolvePathCrossPlatform(inputPath) {
  // WSL 网络路径: \\wsl$\Ubuntu\home\user → Windows 可访问的 UNC 路径
  if (/^\\\\wsl(\$|\.localhost)\\/.test(inputPath) || /^\/\/wsl(\$|\.localhost)\//.test(inputPath)) {
    return inputPath;
  }
  // /mnt/c/... 格式（用户输入 WSL 风格路径，转为 Windows 路径）
  if (WSL.isWslPath(inputPath)) {
    return WSL.wslToWin(inputPath);
  }
  return path.resolve(inputPath);
}

// ============================================================
// 命令适配
// ============================================================
function getShellConfig() {
  if (PLATFORM.isWindows) {
    return {
      shell: true,
      shellPath: 'powershell.exe',
      shellArgs: ['-NoProfile', '-NonInteractive', '-Command'],
      defaultCmd: 'powershell -NoProfile -Command'
    };
  }
  return {
    shell: true,
    shellPath: '/bin/bash',
    shellArgs: ['-c'],
    defaultCmd: '/bin/bash -c'
  };
}

function platformCommand(cmd) {
  if (PLATFORM.isWindows) {
    // PowerShell 适配: 将常用 Unix 命令映射到 PowerShell
    const unixToPs = {
      'ls ': 'Get-ChildItem ',
      'cat ': 'Get-Content ',
      'rm ': 'Remove-Item ',
      'cp ': 'Copy-Item ',
      'mv ': 'Move-Item ',
      'mkdir ': 'New-Item -ItemType Directory ',
      'touch ': 'New-Item -ItemType File ',
      'grep ': 'Select-String ',
      'find ': 'Get-ChildItem -Recurse -Filter '
    };
    // 仅对简单命令做转换
    for (const [unix, ps] of Object.entries(unixToPs)) {
      if (cmd.startsWith(unix)) return cmd.replace(unix, ps);
    }
  }
  return cmd;
}

// ============================================================
// 权限检测
// ============================================================
async function checkWritePermission(targetPath) {
  try {
    const testFile = path.join(targetPath, '.__ds_perm_test_' + Date.now());
    await fsp.writeFile(testFile, 'test', 'utf-8');
    await fsp.unlink(testFile);
    return true;
  } catch (e) {
    return false;
  }
}

async function getFileAttributesForPlatform(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    const result = {
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      isReadable: true,
      isWritable: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      permissions: stat.mode.toString(8).slice(-3)
    };

    // 检测可写性
    try {
      result.isWritable = await checkWritePermission(path.dirname(filePath));
    } catch (e) {
      result.isWritable = false;
    }

    return result;
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

// ============================================================
// 系统信息
// ============================================================
function getSystemInfo() {
  const info = {
    ...PLATFORM,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
    pid: process.pid
  };

  // 添加 WSL 信息
  if (PLATFORM.isWindows) {
    info.wslAvailable = WSL.isAvailable();
    if (info.wslAvailable) {
      info.wslDistros = WSL.getDistros();
      info.wslDefaultDistro = WSL.getDefaultDistro();
    }
  }

  return info;
}

module.exports = {
  PLATFORM,
  WSL,
  normalizePathForPlatform,
  resolveHomeDir,
  isPathWithinWorkspace,
  resolvePathCrossPlatform,
  getShellConfig,
  platformCommand,
  checkWritePermission,
  getFileAttributesForPlatform,
  getSystemInfo
};