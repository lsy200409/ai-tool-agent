@echo off
title DeepSeek Tool Agent - 启动器
echo ========================================
echo  DeepSeek Tool Agent - 智能启动器
echo ========================================
echo.
echo [1] 启动器模式（推荐）
echo     - 自动管理服务器进程
echo     - 服务器崩溃自动重启
echo     - 支持通过扩展面板重启
echo.
echo [2] 直接启动服务器模式
echo     - 快速启动，无额外功能
echo.
echo.
set /p choice=请选择启动模式 (1/2，默认1):

if "%choice%"=="2" goto direct
if "%choice%" neq "2" goto launcher

:launcher
echo.
echo 正在启动智能启动器...
echo.
node "%~dp0..\server\launcher.js"
pause
goto end

:direct
echo.
echo 正在启动服务器...
echo.
node "%~dp0..\server\tool-server.js"
pause

:end
