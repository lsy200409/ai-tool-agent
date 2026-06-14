// Native Host 安装脚本
// 将 native-host.js 和 .bat 启动器部署到 C:\ProgramData\ai-tool-agent\
// 并注册到 Edge/Chrome Native Messaging

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGET_DIR = 'C:\\ProgramData\\ai-tool-agent';
const PROJECT_DIR = path.resolve(__dirname, '..');
const NODE_PATH = 'F:\\node\\node.exe';
const EXT_ID = 'diaocpmadbepofacimmkigkkkeihnjio';
const LOG_PATH = path.join(require('os').tmpdir(), 'ds-native-host.log');

console.log('=== Native Host 安装 ===');
console.log('项目目录: ' + PROJECT_DIR);
console.log('目标目录: ' + TARGET_DIR);

// 1. 创建目标目录
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  console.log('已创建: ' + TARGET_DIR);
}

// 2. 复制 native-host.js
const srcFile = path.join(PROJECT_DIR, 'native-messaging', 'native-host.js');
const dstFile = path.join(TARGET_DIR, 'native-host.js');
fs.copyFileSync(srcFile, dstFile);
console.log('已复制: native-host.js');

// 3. 创建 .bat 启动器
const batContent = '@echo off\r\n'
  + '"' + NODE_PATH + '" "' + dstFile + '"\r\n';

const batFile = path.join(TARGET_DIR, 'launch-host.bat');
fs.writeFileSync(batFile, batContent);
console.log('已创建: launch-host.bat');

// 4. 创建 manifest JSON
const manifest = {
  name: 'com.deepseek.tool_agent',
  description: 'AI Tool Agent - Native Messaging Host',
  path: batFile,
  type: 'stdio',
  allowed_origins: ['chrome-extension://' + EXT_ID + '/']
};

const manifestFile = path.join(TARGET_DIR, 'com.deepseek.tool_agent.json');
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log('已创建: com.deepseek.tool_agent.json');
console.log('  path: ' + batFile);

// 5. 注册到 Edge 和 Chrome
const regEntries = [
  {
    name: 'Edge',
    path: 'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.deepseek.tool_agent'
  },
  {
    name: 'Chrome',
    path: 'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.deepseek.tool_agent'
  }
];

for (const reg of regEntries) {
  try {
    execSync(`reg add "${reg.path.replace(/HKCU:/, 'HKCU\\')}" /ve /d "${manifestFile}" /f`, { stdio: 'pipe' });
    console.log('已注册: ' + reg.name);
  } catch (e) {
    // PowerShell 方式
    try {
      const psCmd = `New-Item -Path "${reg.path}" -Force | Set-ItemProperty -Name "(Default)" -Value "${manifestFile}"`;
      execSync(`powershell -Command "${psCmd}"`, { stdio: 'pipe' });
      console.log('已注册 (PS): ' + reg.name);
    } catch (e2) {
      console.log('注册失败: ' + reg.name + ' - 请手动注册');
      console.log('  reg add "' + reg.path + '" /ve /d "' + manifestFile + '" /f');
    }
  }
}

console.log('');
console.log('=== 安装完成 ===');
console.log('');
console.log('重要提示:');
console.log('1. 必须通过 .bat 文件启动（直接 node.exe 会导致管道崩溃）');
console.log('2. 重启浏览器后生效');
console.log('3. 日志文件: ' + LOG_PATH);
