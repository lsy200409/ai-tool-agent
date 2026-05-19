# ============================================================
# DeepSeek Tool Agent - Native Messaging 安装脚本
# 用法:
#   PowerShell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId "xxxxxxxx"
# 或以管理员身份运行并手动输入
# ============================================================

param(
    [string]$ExtensionId = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DeepSeek Tool Agent - Native Messaging 安装" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionPath = (Get-Item $scriptDir).Parent.FullName
$manifestPath = Join-Path $scriptDir "com.deepseek.tool_agent.json"
$nativeHostPath = Join-Path $scriptDir "native-host.js"

Write-Host "扩展目录: $extensionPath" -ForegroundColor Gray
Write-Host "Manifest:  $manifestPath" -ForegroundColor Gray
Write-Host "NativeHost:$nativeHostPath" -ForegroundColor Gray

# ============================================================
# 第〇步：检测 Node.js
# ============================================================
Write-Host "`n[0/5] 检测 Node.js..." -ForegroundColor Yellow

$nodePath = $null
try {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    Write-Host "  ✓ Node.js: $nodePath" -ForegroundColor Green
} catch {
    $possiblePaths = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Microsoft\WindowsApps\node.exe",
        "C:\Program Files\nodejs\node.exe"
    )
    foreach ($p in $possiblePaths) {
        if (Test-Path $p) {
            $nodePath = $p
            Write-Host "  ✓ Node.js: $nodePath" -ForegroundColor Green
            break
        }
    }
}

if (-not $nodePath) {
    Write-Host "  ✗ 未找到 Node.js！请先安装 Node.js: https://nodejs.org/" -ForegroundColor Red
    Write-Host "    安装后重新运行此脚本" -ForegroundColor Yellow
    exit 1
}

# ============================================================
# 第一步：获取扩展 ID
# ============================================================
Write-Host "`n[1/4] 获取扩展 ID..." -ForegroundColor Yellow

if ($ExtensionId -ne "") {
    Write-Host "  ✓ 使用命令行传入的扩展 ID: $ExtensionId" -ForegroundColor Green
} else {
    $ExtensionId = $null

    $edgeExtensionsDir = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Extensions"
    if (Test-Path $edgeExtensionsDir) {
        $folders = Get-ChildItem $edgeExtensionsDir -Directory -ErrorAction SilentlyContinue
        foreach ($folder in $folders) {
            $mf = Join-Path $folder.FullName "manifest.json"
            if (Test-Path $mf) {
                try {
                    $extManifest = Get-Content $mf -Raw | ConvertFrom-Json
                    if ($extManifest.name -eq "DeepSeek Tool Agent") {
                        $ExtensionId = $folder.Name
                        Write-Host "  ✓ 从 Edge 自动检测到: $ExtensionId" -ForegroundColor Green
                        break
                    }
                } catch {}
            }
        }
    }

    if (-not $ExtensionId) {
        $chromeExtensionsDir = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Extensions"
        if (Test-Path $chromeExtensionsDir) {
            $folders = Get-ChildItem $chromeExtensionsDir -Directory -ErrorAction SilentlyContinue
            foreach ($folder in $folders) {
                $mf = Join-Path $folder.FullName "manifest.json"
                if (Test-Path $mf) {
                    try {
                        $extManifest = Get-Content $mf -Raw | ConvertFrom-Json
                        if ($extManifest.name -eq "DeepSeek Tool Agent") {
                            $ExtensionId = $folder.Name
                            Write-Host "  ✓ 从 Chrome 自动检测到: $ExtensionId" -ForegroundColor Green
                            break
                        }
                    } catch {}
                }
            }
        }
    }

    if (-not $ExtensionId) {
        Write-Host ""
        Write-Host "  🔍 查看扩展 ID 的方法：" -ForegroundColor White
        Write-Host "  ┌─────────────────────────────────────────────────────────┐" -ForegroundColor Gray
        Write-Host "  │  1. 打开 edge://extensions/                            │" -ForegroundColor Gray
        Write-Host "  │  2. 开启「开发者模式」                                  │" -ForegroundColor Gray
        Write-Host "  │  3. 找到 DeepSeek Tool Agent 卡片                      │" -ForegroundColor Gray
        Write-Host "  │  4. 复制 32 位字母数字 ID                              │" -ForegroundColor Gray
        Write-Host "  └─────────────────────────────────────────────────────────┘" -ForegroundColor Gray
        Write-Host ""
        $ExtensionId = Read-Host "  ➤ 请输入扩展 ID"

        if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
            Write-Host "  ✗ 扩展 ID 不能为空！" -ForegroundColor Red
            exit 1
        }
    }
}

# ============================================================
# 第二步：生成 Native Messaging Manifest
# ============================================================
Write-Host "`n[2/5] 生成 Native Messaging Manifest..." -ForegroundColor Yellow

$manifestContent = @{
    name = "com.deepseek.tool_agent"
    description = "DeepSeek Tool Agent - 本地工具执行服务"
    path = $nodePath
    args = @($nativeHostPath)
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifestContent | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding utf8NoBOM
Write-Host "  ✓ path = $nodePath" -ForegroundColor Green
Write-Host "  ✓ args = [ `"$nativeHostPath`" ]" -ForegroundColor Green
Write-Host "  ✓ allowed_origins = chrome-extension://$ExtensionId/" -ForegroundColor Green

# ============================================================
# 第三步：注册到 Edge 注册表
# ============================================================
Write-Host "`n[3/5] 注册到注册表..." -ForegroundColor Yellow

$regPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.deepseek.tool_agent"

try {
    if (-not (Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }
    Set-ItemProperty -Path $regPath -Name "(Default)" -Value $manifestPath
    Write-Host "  ✓ Edge 注册表已更新" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Edge 注册表更新失败（请以管理员运行）" -ForegroundColor Yellow
    Write-Host "  ℹ 错误: $_" -ForegroundColor Gray
}

$chromeRegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.tool_agent"
try {
    if (-not (Test-Path $chromeRegPath)) {
        New-Item -Path $chromeRegPath -Force | Out-Null
    }
    Set-ItemProperty -Path $chromeRegPath -Name "(Default)" -Value $manifestPath
    Write-Host "  ✓ Chrome 注册表已更新" -ForegroundColor Green
} catch {
    Write-Host "  ℹ Chrome 注册表更新失败（可忽略）" -ForegroundColor Yellow
}

# ============================================================
# 第四步：验证
# ============================================================
Write-Host "`n[4/5] 验证..." -ForegroundColor Yellow

if (Test-Path $nativeHostPath) {
    Write-Host "  ✓ native-host.js 存在: $nativeHostPath" -ForegroundColor Green
} else {
    Write-Host "  ✗ native-host.js 不存在！" -ForegroundColor Red
    exit 1
}

# ============================================================
# 第五步：测试启动
# ============================================================
Write-Host "`n[5/5] 测试 Node.js 启动..." -ForegroundColor Yellow

try {
    $testResult = & $nodePath -e "console.log('ok')" 2>&1
    if ($testResult -match "ok") {
        Write-Host "  ✓ Node.js 可正常执行" -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠ Node.js 测试异常（可能仍可运行）" -ForegroundColor Yellow
}

# ============================================================
# 完成
# ============================================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "✅ 安装完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "接下来：" -ForegroundColor White
Write-Host "  1. 回到 edge://extensions/ → 刷新扩展 🔄" -ForegroundColor White
Write-Host "  2. 打开 DeepSeek 页面 → 服务器自动启动" -ForegroundColor White
Write-Host ""

if ($PSBoundParameters.ContainsKey('ExtensionId')) {
    exit 0
}

Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")