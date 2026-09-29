#Requires -Version 5.1
<#
.SYNOPSIS
    Launch Colonia (the browser city builder) on Windows.

.DESCRIPTION
    Two ways to play:
      -Play (default)  Opens dist\colonia.html directly in your default browser.
                       Builds it first if it is missing (needs Node.js).
      -Dev             Starts the local dev server (live source files) and opens
                       http://localhost:<Port>/ . Use this when editing the code.

    Requires PowerShell 7+ (warns on Windows PowerShell 5.x) and Node.js 18+
    for -Dev or when a build is needed.

.PARAMETER Dev
    Run the development server instead of the single-file build.

.PARAMETER Build
    Force a rebuild of dist\colonia.html before playing.

.PARAMETER Port
    Port for the dev server (default 8080).

.PARAMETER Flags
    Extra URL options, e.g. "debug=1&seed=42" (see README "Debug options").

.EXAMPLE
    .\scripts\run.ps1
    Play the built game.

.EXAMPLE
    .\scripts\run.ps1 -Dev -Port 9000 -Flags "debug=1"
    Dev server on port 9000 with the debug HUD.

.NOTES
    Built with Claude (Anthropic) using Claude Code.
    Made with ❤️ from your friendly hacker - er2oneousbit
#>
[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Build,
    [ValidateRange(1, 65535)][int]$Port = 8080,
    [string]$Flags = ''
)

$ErrorActionPreference = 'Stop'

# --- PowerShell version check (PS7+ recommended) -----------------------------
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Warning "You are running Windows PowerShell $($PSVersionTable.PSVersion). This script is written for PowerShell 7+ (pwsh)."
    Write-Warning "Install it with: winget install Microsoft.PowerShell   (continuing anyway)"
}

$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root 'dist\colonia.html'

function Test-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Error "Node.js was not found. Install Node 18+ from https://nodejs.org/ (or: winget install OpenJS.NodeJS.LTS)"
    }
    $ver = (& node --version).TrimStart('v')
    if ([int]($ver.Split('.')[0]) -lt 18) {
        Write-Error "Node $ver is too old. Colonia needs Node 18 or newer."
    }
}

function Invoke-Build {
    Test-Node
    Push-Location $Root
    try {
        if (-not (Test-Path (Join-Path $Root 'node_modules\esbuild'))) {
            Write-Host 'Installing build tools (npm install)...' -ForegroundColor Cyan
            npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
        }
        Write-Host 'Building dist\colonia.html ...' -ForegroundColor Cyan
        node scripts/build.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    }
    finally { Pop-Location }
}

try {
    if ($Dev) {
        Test-Node
        $url = "http://localhost:$Port/" + ($(if ($Flags) { "?$Flags" } else { '' }))
        Write-Host "Starting dev server on $url  (Ctrl+C to stop)" -ForegroundColor Green
        Start-Job -ScriptBlock { param($u) Start-Sleep -Seconds 1; Start-Process $u } -ArgumentList $url | Out-Null
        Push-Location $Root
        try { node scripts/serve.mjs --port $Port }
        finally { Pop-Location }
    }
    else {
        if ($Build -or -not (Test-Path $Dist)) { Invoke-Build }
        $target = (Resolve-Path $Dist).Path
        $uri = ([System.Uri]$target).AbsoluteUri + ($(if ($Flags) { "?$Flags" } else { '' }))
        Write-Host "Opening $uri" -ForegroundColor Green
        Start-Process $uri
    }
}
catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
