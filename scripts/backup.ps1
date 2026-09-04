# =============================================================================
# AI 数字化咨询中心 - 备份脚本
# 输出：
#   releases/docker-backup-YYYY-MM-DD/source/   ← 源代码（排除 node_modules 等）
#   releases/docker-backup-YYYY-MM-DD/docker/   ← Dockerfile / docker-compose / .dockerignore / DOCKER.md
#   releases/docker-backup-YYYY-MM-DD/MANIFEST.md
#   releases/docker-backup-YYYY-MM-DD/<package>.tar  ← 归档（可选，未开启）
# =============================================================================

param(
    [switch]$SkipArchive = $true
)

$ErrorActionPreference = "Stop"
$root = (& { $pwd = Get-Location; if ($pwd.Path.StartsWith('Microsoft.PowerShell.Core\FileSystem::')) { $pwd.Path.Substring('Microsoft.PowerShell.Core\FileSystem::'.Length) } else { $pwd.Path } })
$date = (Get-Date).ToString("yyyy-MM-dd")
$stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
$outDir = Join-Path $root "releases/docker-backup-$date"
$srcDir = Join-Path $outDir "source"
$dockerDir = Join-Path $outDir "docker"

if (Test-Path $outDir) {
    Write-Host "[WARN] $outDir 已存在，覆盖" -ForegroundColor Yellow
}
New-Item -ItemType Directory -Force -Path $srcDir | Out-Null
New-Item -ItemType Directory -Force -Path $dockerDir | Out-Null

# ============================================================
# 1. 收集源代码（排除项：node_modules / .venv / dist / 数据 / 日志等）
# ============================================================
$excludedDirs = @(
    'node_modules', '.venv', '.venv-vector', 'semantica-venv',
    'dist', 'releases', '.git', '__pycache__',
    'data\uploads', 'data\yoooclaw-mirror', 'data\certificates'
)
$excludedFilePatterns = @(
    '*.log', '*.tsbuildinfo', '*.bak', '*.bak.*',
    'debug_*.txt', 'preview*.txt', 'verify_*.txt',
    'inspect_*.json', 'inpect_result.json', 'verify_report.txt',
    'semantica.log', 'preview_stdout.txt', 'data_˵.md'
)
$excludedRootFiles = @('package-lock.json')

function Should-SkipPath {
    param([string]$relPath)
    $parts = $relPath.Split([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    foreach ($d in $excludedDirs) {
        $dd = $d.Replace('\','/').Trim('/')
        $dp = $dd.Split('/')
        if ($dp.Length -le 1) {
            if ($parts -contains $dp[0]) { return $true }
        } else {
            for ($i=0; $i -le $parts.Length - $dp.Length; $i++) {
                $match = $true
                for ($j=0; $j -lt $dp.Length; $j++) {
                    if ($parts[$i+$j] -ne $dp[$j]) { $match = $false; break }
                }
                if ($match) { return $true }
            }
        }
    }
    foreach ($p in $excludedFilePatterns) {
        if ($relPath -like $p) { return $true }
    }
    $leaf = Split-Path -Leaf $relPath
    foreach ($r in $excludedRootFiles) {
        if ($leaf -eq $r.Replace('*','')) { return $true }
    }
    return $false
}

Write-Host "[1/4] 收集源代码到 $srcDir ..."
$counter = 0
# 把 UNC 前缀正规化为可比较的字符串
$rootTrimmed = $root.Trim()
if ($rootTrimmed.StartsWith('Microsoft.PowerShell.Core\FileSystem::')) {
    $rootTrimmed = $rootTrimmed.Substring('Microsoft.PowerShell.Core\FileSystem::'.Length)
}
$rootFull = $rootTrimmed.TrimEnd('\','/')
$srcRootFull = (Resolve-Path -LiteralPath $srcDir).ProviderPath
Get-ChildItem -Path $root -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $fullName = $_.FullName
    if ($fullName.Length -le $rootFull.Length -or -not $fullName.StartsWith($rootFull)) { return }
    $rel = $fullName.Substring($rootFull.Length).TrimStart('\','/')
    if (-not $rel) { return }
    if (Should-SkipPath $rel) { return }
    $dest = Join-Path $srcRootFull $rel
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    Copy-Item -LiteralPath $fullName -Destination $dest -Force
    $counter++
    if ($counter % 200 -eq 0) { Write-Host "    ...$counter files" }
}
Write-Host "    完成，$counter 个文件" -ForegroundColor Green

# ============================================================
# 2. 复制 Docker 部署支持文件
# ============================================================
Write-Host "[2/4] 收集 Docker 部署资源到 $dockerDir ..."
foreach ($f in @('Dockerfile','docker-compose.yml','.dockerignore','DOCKER.md')) {
    if (Test-Path (Join-Path $root $f)) {
        Copy-Item -Path (Join-Path $root $f) -Destination $dockerDir -Force
    }
}
Get-ChildItem -Path $dockerDir | ForEach-Object { Write-Host "    + $($_.Name)" }

# ============================================================
# 3. 生成 MANIFEST
# ============================================================
Write-Host "[3/4] 生成 MANIFEST.md ..."
$manifestPath = Join-Path $outDir "MANIFEST.md"
$totalFiles = (Get-ChildItem -Recurse -File -Path $srcDir).Count
$totalSize = (Get-ChildItem -Recurse -File -Path $srcDir | Measure-Object -Property Length -Sum).Sum
$totalSizeMB = [double]($totalSize) / 1MB
$totalSizeRounded = "{0:N2}" -f $totalSizeMB
$dockerFiles = (Get-ChildItem -File -Path $dockerDir | ForEach-Object { "  - docker/$($_.Name)" }) -join "`n"

$gitHead = (git -C $root rev-parse --short HEAD 2>$null)
if (-not $gitHead) { $gitHead = "unknown" }
$gitStatus = (& git -C $root status --short 2>$null)
if (-not $gitStatus) { $gitStatus = "(clean / no git)" }

$manifest = @"
# AI 数字化咨询中心 — 备份清单

- **备份日期**: $date
- **时间戳**:   $stamp
- **源主机**:   \\10.168.1.105\opt\ai-consulting-center
- **Git HEAD**: $gitHead
- **工作区状态**:
\`\`\`
$gitStatus
\`\`\`

## 总览

| 项 | 路径 | 内容 |
|----|------|------|
| 源代码 | \`source/\` | 排除 node_modules / .venv / dist / 数据 / 日志后保留 $totalFiles 个文件 |
| Docker 部署支持 | \`docker/\` | 可独立复制到新机器运行 |
| 归档（可选） | \`<package>.tar\` | 由 \`-Archive\` 开关生成 |

源代码总大小: $totalSizeRounded MB

## 源代码覆盖范围

- \`apps/server\` — Express + TypeScript 后端
- \`apps/web\` — React + Vite 前端
- \`data/migrations/*.sql\` — 35 个 SQL 迁移（不包含 data 上传 / 客户数据）
- \`deploy/ai-consulting-center.service\` — systemd unit（生产环境，可选）
- \`docs/\`, \`scripts/\`, \`templates/\`
- \`package.json\`, \`package-lock.json\`, 根级 \`tsconfig.json\`, \`.env.example\`, \`.gitignore\`, README / DEPLOYMENT / OPERATIONS

## 显式排除

- \`node_modules/\`（任一 apps/* 与根目录）
- \`.venv\`, \`.venv-vector\`, \`semantica-venv/\`
- \`dist/\`（前后端构建产物，可在目标机器上 \`npm run build\` 重新生成）
- \`data/uploads/\`, \`data/yoooclaw-mirror/\`, \`data/certificates/\`（含客户资料）
- 运行时数据：\`data/*.json\`（运行时由 Postgres 生成）
- 所有 \`*.log\`, \`*.tsbuildinfo\`, \`*.bak*\`, \`debug_*\`, \`preview*\`, \`verify_*\`, \`inspect_*.json\`

## Docker 部署

\`docker/\` 下文件清单：

$dockerFiles

### 立即部署

\`\`\`bash
cd <备份根目录>
cp .env.example ./config/.env             # 按需修改，chmod 600
docker compose up -d --build
\`\`\`

健康检查：\`curl http://localhost:3001/health\`

## 复盘（本备份做了什么）

1. 仅复制源码与部署所需的配置文件，不动数据。
2. 提供 Docker 化部署脚本，使本备份可在任何 Docker 环境上直接启动。
3. 系统 systemd 部署（\`.service\`、\`.env\`）作为可选并行方案保留。
4. 数据库迁移保留为 SQL 文件；容器启动时自动执行。
"@

Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

# ============================================================
# 4. 可选归档
# ============================================================
if (-not $SkipArchive) {
    Write-Host "[4/4] 生成 tar 归档 ..." -ForegroundColor Cyan
    $tarPath = Join-Path $outDir ("ai-consulting-center-source-{0}.tar" -f $stamp)
    & tar -cf $tarPath -C $outDir source docker MANIFEST.md
    Write-Host "    → $tarPath" -ForegroundColor Green
} else {
    Write-Host "[4/4] 跳过 tar 归档（用 -Archive 启用）"
}

Write-Host ""
Write-Host "备份完成：" -ForegroundColor Green
Write-Host "  $outDir"
