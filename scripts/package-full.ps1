# AI Tool Agent 完整分发打包脚本
# 包含：扩展 + 服务器 + 工作区 + 安装指南 + 截图

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$extName = "ai-tool-agent"
$version = (Get-Content "$projectDir\manifest.json" | ConvertFrom-Json).version
$outputDir = "$projectDir\dist"
$zipName = "${extName}-v${version}-full.zip"
$zipPath = "$outputDir\$zipName"

# 创建输出目录
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# 删除旧的 zip
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

# 临时目录
$tempDir = "$env:TEMP\$extName-full-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    Write-Host "  正在打包 AI Tool Agent v$version 完整分发版..." -ForegroundColor Cyan
    Write-Host ""

    # ===== 扩展文件 =====
    $extDirs = @("icons", "popup", "src", "native-messaging")
    foreach ($dir in $extDirs) {
        $srcPath = Join-Path $projectDir $dir
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination (Join-Path $tempDir $dir) -Recurse -Force
            Write-Host "  [扩展] $dir" -ForegroundColor Gray
        }
    }

    $extFiles = @("manifest.json")
    foreach ($file in $extFiles) {
        $srcPath = Join-Path $projectDir $file
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination $tempDir -Force
            Write-Host "  [扩展] $file" -ForegroundColor Gray
        }
    }

    # ===== 服务器文件 =====
    $serverDir = Join-Path $tempDir "server"
    New-Item -ItemType Directory -Path $serverDir -Force | Out-Null

    $serverFiles = @(
        "server\cross-platform.js",
        "server\launcher.js",
        "server\plugin-loader.js",
        "server\tool-registry.js",
        "server\tool-server.js"
    )
    foreach ($file in $serverFiles) {
        $srcPath = Join-Path $projectDir $file
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination (Join-Path $tempDir $file) -Force
            Write-Host "  [服务器] $file" -ForegroundColor Gray
        }
    }

    # 服务器内置技能
    $serverSkillDirs = @("server\builtin-skills")
    foreach ($dir in $serverSkillDirs) {
        $srcPath = Join-Path $projectDir $dir
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination (Join-Path $tempDir $dir) -Recurse -Force
            Write-Host "  [服务器] $dir" -ForegroundColor Gray
        }
    }

    # ===== 工作区 =====
    $workspaceDir = Join-Path $projectDir "workspace"
    if (Test-Path $workspaceDir) {
        # 只复制核心配置，不包含飞书技能（用户可从 GitHub 获取）
        $wsDest = Join-Path $tempDir "workspace"
        New-Item -ItemType Directory -Path $wsDest -Force | Out-Null

        # 配置文件
        $wsConfig = Join-Path $projectDir "workspace\config"
        if (Test-Path $wsConfig) {
            Copy-Item -Path $wsConfig -Destination (Join-Path $wsDest "config") -Recurse -Force
            Write-Host "  [工作区] config/" -ForegroundColor Gray
        }

        # 插件目录（只保留核心插件，排除数据文件）
        $wsPlugins = Join-Path $projectDir "workspace\plugins"
        if (Test-Path $wsPlugins) {
            $pluginsDest = Join-Path $wsDest "plugins"
            New-Item -ItemType Directory -Path $pluginsDest -Force | Out-Null
            # 只复制插件代码文件，不复制数据
            Get-ChildItem -Path $wsPlugins -Directory | ForEach-Object {
                $pluginName = $_.Name
                if ($pluginName -ne "daily_data" -and $pluginName -ne "study_data") {
                    Copy-Item -Path $_.FullName -Destination (Join-Path $pluginsDest $pluginName) -Recurse -Force
                }
            }
            Write-Host "  [工作区] plugins/" -ForegroundColor Gray
        }

        # 技能目录（只保留核心技能：code-review, docx, skill-creator）
        $wsSkills = Join-Path $projectDir "workspace\skills"
        if (Test-Path $wsSkills) {
            $skillsDest = Join-Path $wsDest "skills"
            New-Item -ItemType Directory -Path $skillsDest -Force | Out-Null
            $coreSkills = @("code-review", "docx", "skill-creator", "pdf", "pptx")
            foreach ($skill in $coreSkills) {
                $skillPath = Join-Path $wsSkills $skill
                if (Test-Path $skillPath) {
                    Copy-Item -Path $skillPath -Destination (Join-Path $skillsDest $skill) -Recurse -Force
                    Write-Host "  [工作区] skills/$skill" -ForegroundColor Gray
                }
            }
        }

        Write-Host "  [优化] 飞书技能已排除，用户可从 GitHub 获取" -ForegroundColor Yellow
    }

    # ===== 安装和启动脚本 =====
    $scriptFiles = @("setup.bat", "start-server.bat", "package.json")
    foreach ($file in $scriptFiles) {
        $srcPath = Join-Path $projectDir $file
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination $tempDir -Force
            Write-Host "  [脚本] $file" -ForegroundColor Gray
        }
    }

    # ===== 文档 =====
    $docFiles = @("INSTALL.md", "README.md", "LICENSE", "DISCLAIMER.md", "PRIVACY.md")
    foreach ($file in $docFiles) {
        $srcPath = Join-Path $projectDir $file
        if (Test-Path $srcPath) {
            Copy-Item -Path $srcPath -Destination $tempDir -Force
            Write-Host "  [文档] $file" -ForegroundColor Gray
        }
    }

    # ===== 截图 =====
    $screenshotsDir = Join-Path $projectDir "screenshots"
    if (Test-Path $screenshotsDir) {
        Copy-Item -Path $screenshotsDir -Destination (Join-Path $tempDir "screenshots") -Recurse -Force
        Write-Host "  [截图] screenshots/" -ForegroundColor Gray
    }

    # ===== 处理 manifest.json =====
    $manifestPath = Join-Path $tempDir "manifest.json"
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.PSObject.Properties.Name -contains "key") {
        $manifest.PSObject.Properties.Remove("key")
        $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8
        Write-Host "  [清理] 已移除 manifest.json 中的 key 字段" -ForegroundColor Yellow
    }

    # ===== 隐私检查 =====
    Write-Host ""
    Write-Host "  隐私检查..." -ForegroundColor Yellow

    $issues = @()
    Get-ChildItem -Path $tempDir -Recurse -File | ForEach-Object {
        $content = $null
        try { $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue } catch {}
        if ($content) {
            if ($content -match 'ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|sk-[a-zA-Z0-9]{48}') {
                $issues += "  [!] $($_.FullName) 包含 API Key"
            }
            if ($content -match "C:\\Users\\") {
                $issues += "  [!] $($_.FullName) 包含用户路径"
            }
        }
    }

    if ($issues.Count -gt 0) {
        Write-Host "  发现隐私问题:" -ForegroundColor Red
        $issues | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    } else {
        Write-Host "  [OK] 无隐私泄露" -ForegroundColor Green
    }

    # ===== 打包 =====
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

    # ===== 验证 =====
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

    $size = (Get-Item $zipPath).Length
    $sizeKB = [math]::Round($size / 1024, 1)
    $sizeMB = [math]::Round($size / 1024 / 1024, 2)

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  完整分发包打包完成!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  版本: v$version"
    Write-Host "  文件: $zipName"
    Write-Host "  大小: ${sizeMB} MB (${sizeKB} KB)"
    Write-Host "  文件数: $fileCount"
    Write-Host "  路径: $zipPath"
    Write-Host ""
    Write-Host "  包含内容:" -ForegroundColor Yellow
    Write-Host "    - 浏览器扩展 (manifest.json, src/, icons/, popup/)"
    Write-Host "    - 工具服务器 (server/)"
    Write-Host "    - 工作区配置 (workspace/)"
    Write-Host "    - 安装脚本 (setup.bat, start-server.bat)"
    Write-Host "    - 安装指南 (INSTALL.md)"
    Write-Host "    - 截图 (screenshots/)"
    Write-Host "    - 文档 (README.md, LICENSE, DISCLAIMER.md, PRIVACY.md)"
    Write-Host "========================================" -ForegroundColor Green

} finally {
    if (Test-Path $tempDir) {
        Remove-Item $tempDir -Recurse -Force
    }
}
