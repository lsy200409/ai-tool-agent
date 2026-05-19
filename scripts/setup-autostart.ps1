# DeepSeek Tool Agent - 自动启动设置脚本
# 以管理员身份运行此脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DeepSeek Tool Agent - 自动启动设置" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$extensionPath = "F:\桌面\web_free_agent\deepseek-tool-agent"

# ============================================================
# 方案 A: 添加到 Windows 启动项
# ============================================================
Write-Host "`n[方案 A] 添加到 Windows 启动项..." -ForegroundColor Yellow

$startupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$vbsPath = "$startupDir\DeepSeekToolServer.vbs"

$vbsContent = @"
' DeepSeek Tool Agent - 后台静默启动
CreateObject("WScript.Shell").Run "node `"$extensionPath\tool-server.js`"", 0, False
"@

$vbsContent | Out-File -FilePath $vbsPath -Encoding ASCII -Force
Write-Host "  ✓ 已创建: $vbsPath" -ForegroundColor Green

# ============================================================
# 方案 B: 创建任务计划程序（开机启动，崩溃自动重启）
# ============================================================
Write-Host "`n[方案 B] 创建计划任务（开机自启 + 崩溃重启）..." -ForegroundColor Yellow

$taskName = "DeepSeekToolAgent"
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$extensionPath\tool-server.js`"" -WorkingDirectory $extensionPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
    Write-Host "  ✓ 计划任务已创建: $taskName" -ForegroundColor Green
    Write-Host "  ✓ 每次开机自动启动，崩溃后自动重启" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ 创建计划任务失败（需要管理员权限）: $_" -ForegroundColor Yellow
    Write-Host "  ℹ 请以管理员身份运行此脚本" -ForegroundColor Yellow
}

# ============================================================
# 完成
# ============================================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "设置完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`n下次重启电脑后，服务器将自动启动。" -ForegroundColor Green
Write-Host "也可以手动启动测试：" -ForegroundColor White
Write-Host "  node `"$extensionPath\tool-server.js`"" -ForegroundColor Gray
Write-Host "`n按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")