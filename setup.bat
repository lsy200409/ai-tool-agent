@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║     DeepSeek Tool Agent v2.6 — 一键安装脚本      ║
echo   ╚══════════════════════════════════════════════════╝
echo.

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

echo [1/6] 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   [X] 未找到 Node.js！
    echo.
    echo   请先安装 Node.js 18+：
    echo     https://nodejs.org/
    echo.
    echo   安装完成后重新运行此脚本。
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set "NODE_VER=%%i"
echo   [OK] Node.js %NODE_VER%

echo.
echo [2/6] 安装依赖...
if exist "node_modules\" (
    echo   [OK] node_modules 已存在，跳过安装
) else (
    call npm install --no-audit --no-fund 2>nul
    if %errorlevel% neq 0 (
        echo   [X] npm install 失败，请检查网络连接
        pause
        exit /b 1
    )
    echo   [OK] 依赖安装完成
)

echo.
echo [3/6] 检查 Chrome 浏览器...
set "CHROME_FOUND=0"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=1"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=1"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_FOUND=1"
if !CHROME_FOUND! equ 1 (
    echo   [OK] Chrome 已安装
) else (
    echo   [OK] 未检测到 Chrome，可尝试 Edge
)

echo.
echo [4/6] 注册 Native Messaging（可选，自动启动服务器）...
set "EXTENSION_ID=diaocpmadbepofacimmkigkkkeihnjio"
set "JSON_PATH=%PROJECT_DIR%native-messaging\com.deepseek.tool_agent.json"
set "NATIVE_HOST=%PROJECT_DIR%native-messaging\native-host.js"

for /f "delims=" %%i in ('node -e "console.log(process.execPath)"') do set "NODE_PATH=%%i"

(
echo {
echo     "name": "com.deepseek.tool_agent",
echo     "description": "DeepSeek Tool Agent - Native Messaging Host",
echo     "path": "!NODE_PATH:\=\\!",
echo     "type": "stdio",
echo     "allowed_origins": [
echo         "chrome-extension://!EXTENSION_ID!/"
echo     ],
echo     "args": [
echo         "!NATIVE_HOST:\=\\!"
echo     ]
echo }
) > "!JSON_PATH!"

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.tool_agent" /ve /t REG_SZ /d "!JSON_PATH!" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] Chrome Native Host 注册成功
) else (
    echo   [INFO] Chrome 注册表写入失败（可忽略，不影响使用）
)

reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.deepseek.tool_agent" /ve /t REG_SZ /d "!JSON_PATH!" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] Edge Native Host 注册成功
) else (
    echo   [INFO] Edge 注册表写入失败（可忽略，不影响使用）
)

echo.
echo [5/6] 创建启动脚本...
echo   [OK] start-server.bat 已就绪

echo.
echo [6/6] 启动工具服务器...
echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║  正在启动服务...                                  ║
echo   ║  工具服务器: http://localhost:3002                ║
echo   ║  按 Ctrl+C 停止服务                              ║
echo   ╚══════════════════════════════════════════════════╝
echo.

node server\launcher.js
pause