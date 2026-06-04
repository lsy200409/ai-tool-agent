@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo  DeepSeek Tool Agent v2.6 — Native Host 注册
echo ============================================

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "JSON_PATH=%SCRIPT_DIR%com.deepseek.tool_agent.json"
set "NATIVE_HOST_JS=%SCRIPT_DIR%native-host.js"
set "EXTENSION_ID=diaocpmadbepofacimmkigkkkeihnjio"

echo.
echo [1/5] 检测 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] Node.js 未找到！请安装 Node.js 并加入 PATH
    echo         下载: https://nodejs.org/
    pause
    exit /b 1
)
for /f "delims=" %%i in ('node -e "console.log(process.execPath)"') do set "NODE_PATH=%%i"
echo [ OK ] Node.js: %NODE_PATH%

echo.
echo [2/5] 检测项目路径...
pushd "%PROJECT_DIR%" >nul 2>&1
set "PROJECT_ABS=%CD%"
popd
if not exist "%NATIVE_HOST_JS%" (
    echo [FAIL] native-host.js 未找到: %NATIVE_HOST_JS%
    pause
    exit /b 1
)
echo [ OK ] 项目路径: %PROJECT_ABS%
echo [ OK ] Native Host: %NATIVE_HOST_JS%

echo.
echo [3/5] 生成 Native Messaging 配置...
(
echo {
echo     "name": "com.deepseek.tool_agent",
echo     "description": "DeepSeek Tool Agent - Native Messaging Host",
echo     "path": "%NODE_PATH:\=\\%",
echo     "type": "stdio",
echo     "allowed_origins": [
echo         "chrome-extension://%EXTENSION_ID%/"
echo     ],
echo     "args": [
echo         "%NATIVE_HOST_JS:\=\\%"
echo     ]
echo }
) > "%JSON_PATH%"
if %errorlevel% neq 0 (
    echo [FAIL] 配置写入失败！
    pause
    exit /b 1
)
echo [ OK ] 配置已生成: %JSON_PATH%
echo [ OK ]   node: %NODE_PATH%
echo [ OK ]   script: %NATIVE_HOST_JS%

echo.
echo [4/5] 注册到 Windows 注册表...
set "REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.tool_agent"
reg add "%REG_KEY%" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [ OK ] Chrome 注册成功
) else (
    echo [WARN] Chrome 注册失败，尝试以管理员运行此脚本
)

set "EDGE_REG_KEY=HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.deepseek.tool_agent"
reg add "%EDGE_REG_KEY%" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [ OK ] Edge 注册成功
) else (
    echo [WARN] Edge 注册失败（如不使用 Edge 可忽略）
)

echo.
echo [5/5] 验证...
reg query "%REG_KEY%" >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=2,*" %%a in ('reg query "%REG_KEY%" /ve 2^>nul ^| findstr /r "."') do set "REG_VAL=%%b"
    echo [ OK ] 注册表验证通过
    echo [ OK ] 指向: !REG_VAL!
) else (
    echo [FAIL] 注册表验证失败 - 请以管理员身份运行此脚本
    pause
    exit /b 1
)

echo.
echo ============================================
echo  注册完成！
echo ============================================
echo.
echo  接下来：
echo    1. 打开 Chrome → chrome://extensions/
echo    2. 找到 DeepSeek Tool Agent → 点击刷新按钮 
echo    3. 重新打开弹窗 → 点击 "启动服务"
echo.
echo  提示: 如果 Chrome 已打开，建议完全关闭后重新启动
echo.
pause