<#
.SYNOPSIS
  Installs offhand (the MCP server plus the After Effects CEP panel) on Windows.

.DESCRIPTION
  One-liner (downloads and builds the latest main branch):

    irm https://raw.githubusercontent.com/Flare-0/offhand/main/scripts/setup-windows.ps1 | iex

  Or, from a clone, without arguments:

    powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1

  What it does:
    1. checks Node.js 20+ (and npm)
    2. fetches the source (unless it is already running from a clone)
    3. installs dependencies and builds the MCP server and the CEP panel
    4. copies the panel into %APPDATA%\Adobe\CEP\extensions\com.offhand.panel
    5. sets HKCU\Software\Adobe\CSXS.9-13\PlayerDebugMode = 1 (required for
       unsigned panels)
    6. prints the MCP client config to paste into your AI client

  Requires: Windows 10+, After Effects 2023 or newer, Node.js 20 or newer.
  No administrator rights are needed: everything is per-user.

.PARAMETER Dir
  Where to install offhand. Default: %LOCALAPPDATA%\offhand\app

.PARAMETER Ref
  Git ref to download when not running from a clone. Default: main

.PARAMETER SkipBuild
  Reuse the existing build instead of rebuilding.

.PARAMETER Yes
  Do not prompt. Useful for unattended installs.
#>
[CmdletBinding()]
param(
  [string]$Dir = "$env:LOCALAPPDATA\offhand\app",
  [string]$Ref = "main",
  [switch]$SkipBuild,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "    $Text" -ForegroundColor Yellow }
function Fail([string]$Text) {
  Write-Host "`noffhand setup failed: $Text" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  offhand - After Effects, at hand." -ForegroundColor Magenta
Write-Host "  Windows installer" -ForegroundColor DarkGray
Write-Host ""

# ---------------------------------------------------------------- prerequisites
Write-Step "Checking prerequisites"

if ($env:OS -ne "Windows_NT") {
  Fail "this script is for Windows. On macOS/Linux, clone the repo and run: npm install; npm run build; npm run build:extension; npm run install:cep"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail "Node.js was not found. Install Node 20+ (winget install OpenJS.NodeJS.LTS), then run this again."
}
$nodeVersion = (& node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
  Fail "Node.js 20 or newer is required (found $nodeVersion). Update with: winget upgrade OpenJS.NodeJS.LTS"
}
Write-Ok "Node.js $nodeVersion"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Fail "npm was not found next to Node.js. Reinstall Node.js 20+." }
Write-Ok "npm $(& npm --version)"

# ---------------------------------------------------------------- source
$fromClone = $false
$repoRoot = $null
if ($PSScriptRoot) {
  $candidate = Split-Path -Parent $PSScriptRoot
  if (Test-Path (Join-Path $candidate "package.json")) {
    $manifest = Get-Content (Join-Path $candidate "package.json") -Raw | ConvertFrom-Json
    if ($manifest.name -eq "offhand-mcp") {
      $fromClone = $true
      $repoRoot = $candidate
    }
  }
}

if ($fromClone) {
  Write-Step "Using the local checkout at $repoRoot"
} else {
  Write-Step "Downloading offhand ($Ref) to $Dir"
  if ((Test-Path $Dir) -and -not (Test-Path (Join-Path $Dir "package.json"))) {
    $items = Get-ChildItem $Dir -Force -ErrorAction SilentlyContinue
    if ($items) {
      Fail "$Dir already exists and does not look like an offhand install. Pass -Dir with an empty folder."
    }
  }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null

  $zip = Join-Path ([System.IO.Path]::GetTempPath()) ("offhand-" + [guid]::NewGuid().ToString("n") + ".zip")
  $extract = Join-Path ([System.IO.Path]::GetTempPath()) ("offhand-src-" + [guid]::NewGuid().ToString("n"))
  $url = "https://codeload.github.com/Flare-0/offhand/zip/refs/heads/$Ref"
  Write-Ok "GET $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  } catch {
    Fail "could not download $url. Check your connection, or clone the repo and run this script from there."
  }
  Expand-Archive -Path $zip -DestinationPath $extract -Force
  $inner = Get-ChildItem $extract -Directory | Select-Object -First 1
  if (-not $inner) { Fail "the downloaded archive was empty." }
  Copy-Item -Path (Join-Path $inner.FullName "*") -Destination $Dir -Recurse -Force
  Write-Ok "source unpacked"
  $repoRoot = $Dir
}

Push-Location $repoRoot
try {
  if (-not $SkipBuild) {
    Write-Step "Installing MCP server dependencies"
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed in $repoRoot" }

    Write-Step "Installing panel dependencies (bolt-cep)"
    & npm --prefix extension install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed in $repoRoot\extension" }

    Write-Step "Building the MCP server"
    & npm run build
    if ($LASTEXITCODE -ne 0) { Fail "npm run build failed" }

    Write-Step "Building the After Effects panel"
    & npm run build:extension
    if ($LASTEXITCODE -ne 0) { Fail "npm run build:extension failed" }
  } else {
    Write-Step "Skipping build (-SkipBuild)"
  }

  if (-not (Test-Path (Join-Path $repoRoot "extension\dist\cep\CSXS\manifest.xml"))) {
    Fail "the panel build is missing. Run without -SkipBuild."
  }

  Write-Step "Installing the panel into After Effects"
  & npm run install:cep
  if ($LASTEXITCODE -ne 0) { Fail "npm run install:cep failed" }
} finally {
  Pop-Location
}

# ---------------------------------------------------------------- verify
Write-Step "Verifying"

$extensionsDir = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$panelTarget = Join-Path $extensionsDir "com.offhand.panel"
if (-not (Test-Path (Join-Path $panelTarget "CSXS\manifest.xml"))) {
  Fail "the panel was not installed at $panelTarget"
}
Write-Ok "panel installed at $panelTarget"

$debugOk = $true
foreach ($version in @("9", "10", "11", "12", "13")) {
  $key = "HKCU:\Software\Adobe\CSXS.$version"
  try {
    $value = (Get-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction Stop).PlayerDebugMode
    if ($value -ne "1") { $debugOk = $false }
  } catch {
    $debugOk = $false
  }
}
if ($debugOk) { Write-Ok "PlayerDebugMode = 1 for CSXS 9-13" }
else { Write-Warn "some CSXS PlayerDebugMode keys are not set; the panel may not appear. Re-run npm run install:cep." }

$serverEntry = Join-Path $repoRoot "dist\cli.js"
if (-not (Test-Path $serverEntry)) { Fail "the MCP server build is missing at $serverEntry" }
Write-Ok "MCP server at $serverEntry"

$aeRunning = Get-Process AfterFX -ErrorAction SilentlyContinue
if ($aeRunning) {
  Write-Warn "After Effects is running. Restart it before the panel will appear."
}

# ---------------------------------------------------------------- next steps
$serverJsonPath = $serverEntry.Replace("\", "/")
Write-Host ""
Write-Host "  Installed." -ForegroundColor Green
Write-Host ""
Write-Host "  Next:" -ForegroundColor Cyan
Write-Host "    1. Restart After Effects."
Write-Host "    2. Open Window > Extensions > offhand. The panel shows 'listening'."
Write-Host "    3. Add this to your MCP client's config:"
Write-Host ""
Write-Host '       {'
Write-Host '         "mcp": {'
Write-Host '           "offhand": {'
Write-Host '             "type": "local",'
Write-Host "             `"command`": [`"node`", `"$serverJsonPath`"],"
Write-Host '             "enabled": true'
Write-Host '           }'
Write-Host '         }'
Write-Host '       }'
Write-Host ""
Write-Host "  Check the install any time with:" -ForegroundColor DarkGray
Write-Host "    node `"$serverJsonPath`" doctor" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Docs: https://github.com/Flare-0/offhand#readme" -ForegroundColor DarkGray
Write-Host ""
