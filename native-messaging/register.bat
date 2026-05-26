@echo off
chcp 65001 >nul
echo ============================================
echo  DeepSeek Tool Agent v2.6 — Native Host 注册
echo ============================================

set "JSON_PATH=%~dp0com.deepseek.tool_agent.json"
set "REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.tool_agent"

echo.
echo [1] 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js 未找到! 请安装 Node.js 并加入 PATH
    pause
    exit /b 1
)
echo ✅ Node.js 可用: 
node --version

echo.
echo [2] 检查 JSON 配置文件...
if not exist "%JSON_PATH%" (
    echo ❌ JSON 配置未找到: %JSON_PATH%
    pause
    exit /b 1
)
echo ✅ JSON 配置存在: %JSON_PATH%

echo.
echo [3] 注册 Native Messaging Host...
reg add "%REG_KEY%" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 注册成功!
) else (
    echo ❌ 注册失败! 请以管理员身份运行此脚本
    pause
    exit /b 1
)

echo.
echo [4] 验证注册...
reg query "%REG_KEY%" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 注册验证通过
) else (
    echo ❌ 注册验证失败
    pause
    exit /b 1
)

echo.
echo ============================================
echo  注册完成!
echo  1. 打开 Chrome → chrome://extensions/
echo  2. 刷新 DeepSeek Tool Agent 扩展 (点击刷新按钮)
echo  3. 刷新 DeepSeek 页面 (https://chat.deepseek.com)
echo ============================================
pause