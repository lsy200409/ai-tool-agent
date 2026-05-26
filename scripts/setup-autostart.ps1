# DeepSeek Tool Agent - 自动启动设置脚本
# 方法1（推荐）：Native Messaging — 扩展自己启动服务
# 方法2（备用）：Windows 开机启动

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DeepSeek Tool Agent - 自动启动设置" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$extensionPath = "F:\桌面\web_free_agent\deepseek-tool-agent"
$nativeMessagingDir = Join-Path $extensionPath "native-messaging"
$installScript = Join-Path $nativeMessagingDir "install.ps1"

Write-Host ""
Write-Host "推荐方案：Native Messaging（网页插件自行启动服务）" -ForegroundColor Green
Write-Host "  - 打开 DeepSeek 页面 → 服务自动启动" -ForegroundColor Gray
Write-Host "  - 关闭浏览器 → 服务30分钟后自动停止" -ForegroundColor Gray
Write-Host "  - 支持崩溃自动重启（launcher.js）" -ForegroundColor Gray
Write-Host ""

$useNative = Read-Host "安装 Native Messaging? (Y/n，默认Y)"

if ($useNative -ne "n" -and $useNative -ne "N") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  [方法1] 安装 Native Messaging" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan

    if (Test-Path $installScript) {
        & $installScript
        Write-Host ""
        Write-Host "✅ Native Messaging 安装完成！" -ForegroundColor Green
        Write-Host ""
        Write-Host "使用方式：" -ForegroundColor White
        Write-Host "  1. 确保扩展已加载（开发模式）" -ForegroundColor Gray
        Write-Host "  2. 打开 chat.deepseek.com → 服务自动启动" -ForegroundColor Gray
        Write-Host "  3. 扩展面板会显示服务器连接状态" -ForegroundColor Gray
    } else {
        Write-Host "⚠ 未找到安装脚本: $installScript" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  [方法2] Windows 开机启动（备用）" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

$useWinStartup = Read-Host "添加到 Windows 启动项? (y/N，默认N)"

if ($useWinStartup -eq "y" -or $useWinStartup -eq "Y") {
    $startupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
    $vbsPath = "$startupDir\DeepSeekToolServer.vbs"

    $vbsContent = @"
' DeepSeek Tool Agent - 后台静默启动
CreateObject("WScript.Shell").Run "node `"$extensionPath\server\launcher.js`"", 0, False
"@

    $vbsContent | Out-File -FilePath $vbsPath -Encoding ASCII -Force
    Write-Host "  ✓ 已创建: $vbsPath" -ForegroundColor Green

    $taskName = "DeepSeekToolAgent"
    $action = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$extensionPath\server\launcher.js`"" -WorkingDirectory "$extensionPath\server"
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    try {
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
        Write-Host "  ✓ 计划任务已创建: $taskName" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠ 创建计划任务失败（需要管理员权限）" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "设置完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "快速验证：" -ForegroundColor White
Write-Host "  1. 刷新扩展 (edge://extensions/)" -ForegroundColor Gray
Write-Host "  2. 打开 chat.deepseek.com" -ForegroundColor Gray
Write-Host "  3. 查看扩展面板状态指示灯是否为绿色" -ForegroundColor Gray
Write-Host ""

Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")