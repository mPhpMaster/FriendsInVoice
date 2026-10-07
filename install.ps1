# Installs Vencord from source with the FriendsInVoice plugin.
# Usage: install.bat                       (installs to %USERPROFILE%\Vencord)
#        install.ps1 -VencordDir D:\Vencord (use / update an existing Vencord source folder)
param(
    [string]$VencordDir = (Join-Path $env:USERPROFILE "Vencord"),
    [string]$Branch = "stable"
)

$ErrorActionPreference = "Stop"
$pluginSrc = Join-Path $PSScriptRoot "friendsInVoice"

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

function Ensure-Tool($cmd, $wingetId) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Installing $cmd..." -ForegroundColor Cyan
        winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
        Refresh-Path
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            throw "$cmd could not be installed. Restart your PC and run the installer again."
        }
    }
}

Ensure-Tool git "Git.Git"
Ensure-Tool node "OpenJS.NodeJS.LTS"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing pnpm..." -ForegroundColor Cyan
    npm install -g pnpm
    Refresh-Path
}

if (Test-Path (Join-Path $VencordDir ".git")) {
    Write-Host "Updating Vencord in $VencordDir..." -ForegroundColor Cyan
    git -C $VencordDir pull
} else {
    Write-Host "Downloading Vencord to $VencordDir..." -ForegroundColor Cyan
    git clone https://github.com/Vendicated/Vencord.git $VencordDir
}

$userplugins = Join-Path $VencordDir "src\userplugins"
New-Item -ItemType Directory -Force $userplugins | Out-Null
Copy-Item -Recurse -Force $pluginSrc $userplugins

Set-Location $VencordDir
Write-Host "Building Vencord (this takes a few minutes the first time)..." -ForegroundColor Cyan
pnpm install --frozen-lockfile
pnpm build

Write-Host ""
Write-Host "Patching Discord ($Branch)..." -ForegroundColor Cyan
pnpm inject -- -install -branch $Branch

Write-Host ""
Write-Host "Done! Fully quit Discord (tray icon -> Quit) and open it again," -ForegroundColor Green
Write-Host "then go to Settings -> Vencord -> Plugins, search 'FriendsInVoice' and turn it on." -ForegroundColor Green
