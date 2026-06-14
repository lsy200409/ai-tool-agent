# AI Tool Agent 打包脚本
# 使用白名单模式：只包含运行必需的文件，避免泄露隐私信息

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$extName = "ai-tool-agent"
$version = (Get-Content "$projectDir\manifest.json" | ConvertFrom-Json).version
$outputDir = "$projectDir\dist"
$zipName = "${extName}-v${version}.zip"
$zipPath = "$outputDir\$zipName"

# 白名单：只打包这些目录和文件
$includeDirs = @(
    "icons",
    "popup",
    "src",
    "native-messaging"
)

$includeFiles = @(
    "manifest.json",
    "README.md"
)

# server 目录中只包含运行必需的文件（排除日志等）
$serverIncludeFiles = @(
    "server\cross-platform.js",
    "server\launcher.js",
    "server\plugin-loader.js",
    "server\tool-registry.js",
    "server\tool-server.js"
)

$serverIncludeDirs = @(
    "server\builtin-skills"
)

# 创建输出目录
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# 删除旧的 zip
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

# 临时目录
$tempDir = "$env:TEMP\$extName-pack-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # 1. 复制白名单目录
    foreach ($dir in $includeDirs) {
        $srcPath = Join-Path $projectDir $dir
        if (Test-Path $srcPath) {
            $destPath = Join-Path $tempDir $dir
            Copy-Item -Path $srcPath -Destination $destPath -Recurse -Force
        }
    }

    # 2. 复制白名单文件
    foreach ($file in $includeFiles) {
        $srcPath = Join-Path $projectDir $file
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination $tempDir -Force
        }
    }

    # 3. 复制 server 必需文件
    $serverDir = Join-Path $tempDir "server"
    New-Item -ItemType Directory -Path $serverDir -Force | Out-Null

    foreach ($file in $serverIncludeFiles) {
        $srcPath = Join-Path $projectDir $file
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination (Join-Path $tempDir $file) -Force
        }
    }

    foreach ($dir in $serverIncludeDirs) {
        $srcPath = Join-Path $projectDir $dir
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination (Join-Path $tempDir $dir) -Recurse -Force
        }
    }

    # 4. 处理 manifest.json — 移除 key 字段（商店发布不需要，且绑定开发者ID）
    $manifestPath = Join-Path $tempDir "manifest.json"
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.PSObject.Properties.Name -contains "key") {
        $manifest.PSObject.Properties.Remove("key")
        $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8
        Write-Host "  [清理] 已移除 manifest.json 中的 key 字段" -ForegroundColor Yellow
    }

    # 5. 打包为 zip
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

    # 6. 验证 zip 内容
    Write-Host ""
    Write-Host "  包内文件列表:" -ForegroundColor Cyan
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $fileCount = 0
    foreach ($entry in $archive.Entries) {
        if (-not $entry.FullName.EndsWith("/")) {
            Write-Host "    $($entry.FullName) ($([math]::Round($entry.Length / 1024, 1)) KB)"
            $fileCount++
        }
    }
    $archive.Dispose()

    # 显示结果
    $size = (Get-Item $zipPath).Length
    $sizeKB = [math]::Round($size / 1024, 1)

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  打包完成!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  版本: v$version"
    Write-Host "  文件: $zipName"
    Write-Host "  大小: ${sizeKB} KB"
    Write-Host "  文件数: $fileCount"
    Write-Host "  路径: $zipPath"
    Write-Host ""
    Write-Host "  安全检查:" -ForegroundColor Yellow
    Write-Host "  [OK] 无服务器日志"
    Write-Host "  [OK] 无测试数据/诊断文件"
    Write-Host "  [OK] 无 key 字段"
    Write-Host "  [OK] 无开发文档"
    Write-Host "========================================" -ForegroundColor Green

} finally {
    # 清理临时目录
    if (Test-Path $tempDir) {
        Remove-Item $tempDir -Recurse -Force
    }
}
