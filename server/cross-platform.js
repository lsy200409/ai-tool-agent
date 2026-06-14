// ============================================================
// DeepSeek Tool Agent v0.1.1 — 跨平台适配层
//
// 统一 Windows/Linux/Mac 差异:
//   - 路径规范化
//   - 命令适配 (cmd / powershell / bash)
//   - 权限检测
//   - 文件系统差异处理
// ============================================================

const os = require('os');
const path = require('path');
const fsp = require('fs').promises;

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
  return resolved.startsWith(wsResolved + path.sep) || resolved === wsResolved;
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
  return {
    ...PLATFORM,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
    pid: process.pid
  };
}

module.exports = {
  PLATFORM,
  normalizePathForPlatform,
  resolveHomeDir,
  isPathWithinWorkspace,
  getShellConfig,
  platformCommand,
  checkWritePermission,
  getFileAttributesForPlatform,
  getSystemInfo
};