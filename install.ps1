<#
.SYNOPSIS
    Installs (or uninstalls) the FriendsInVoice Vencord plugin.

.DESCRIPTION
    - If Vencord (built from source) isn't installed yet, it downloads and builds it, adds the plugin,
      patches Discord and opens it.
    - If Vencord is already installed, it only adds the plugin to it.
    - If the plugin is already installed, it asks whether to uninstall it (or update it instead).

    Custom plugins can't be added to the regular prebuilt Vencord, which is why Vencord is built from source.

.EXAMPLE
    .\install.ps1                          # auto-detect everything
    .\install.ps1 -VencordDir D:\Vencord   # use this Vencord source folder
    .\install.ps1 -Branch ptb              # Discord PTB instead of stable
    .\install.ps1 -DetectOnly              # just show what was found, change nothing
#>
param(
    [string]$VencordDir,
    [ValidateSet("stable", "ptb", "canary")]
    [string]$Branch = "stable",
    [switch]$DetectOnly
)

$ErrorActionPreference = "Stop"
# ---- the only plugin-specific lines ----
$PluginName = "friendsInVoice"   # folder name inside Vencord/src/userplugins
$DisplayName = "FriendsInVoice"  # name shown in Settings -> Vencord -> Plugins
# -----------------------------------------
$PluginSrc = Join-Path $PSScriptRoot $PluginName

function Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Ok($msg) { Write-Host $msg -ForegroundColor Green }
function Warn($msg) { Write-Host $msg -ForegroundColor Yellow }

function Ask($question, [bool]$defaultYes) {
    $hint = if ($defaultYes) { "[Y/n]" } else { "[y/N]" }
    $answer = Read-Host "$question $hint"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $defaultYes }
    return $answer.Trim().ToLower().StartsWith("y")
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

function Ensure-Tool($cmd, $wingetId) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { return }
    Info "Installing $cmd..."
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "$cmd could not be installed. Restart your PC and run the installer again."
    }
}

function Ensure-Tools {
    Ensure-Tool git "Git.Git"
    Ensure-Tool node "OpenJS.NodeJS.LTS"
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Info "Installing pnpm..."
        npm install -g pnpm
        Refresh-Path
    }
}

# ---------- Discord ----------

$DiscordFolder = @{ stable = "Discord"; ptb = "DiscordPTB"; canary = "DiscordCanary" }[$Branch]
$DiscordRoot = Join-Path $env:LOCALAPPDATA $DiscordFolder
$DiscordExe = @{ stable = "Discord.exe"; ptb = "DiscordPTB.exe"; canary = "DiscordCanary.exe" }[$Branch]

function Get-DiscordAppDir {
    Get-ChildItem $DiscordRoot -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Name -replace "^app-", "") } -Descending |
        Select-Object -First 1
}

# The folder Discord currently loads Vencord from (read from the patched app.asar), or $null.
function Get-PatchedVencordDir {
    $app = Get-DiscordAppDir
    if (-not $app) { return $null }
    $asar = Join-Path $app.FullName "resources\app.asar"
    if (-not (Test-Path $asar)) { return $null }
    $text = [IO.File]::ReadAllText($asar)
    $m = [regex]::Match($text, '([A-Za-z]:(?:\\\\[^"\\]+)+?)\\\\dist\\\\patcher\.js')
    if (-not $m.Success) { return $null }
    return $m.Groups[1].Value -replace '\\\\', '\'
}

function Restart-Discord {
    if (-not (Ask "Restart Discord now so the change takes effect?" $true)) {
        Warn "OK. Fully quit Discord (tray icon -> Quit) and open it again when you're ready."
        return
    }
    $procName = [IO.Path]::GetFileNameWithoutExtension($DiscordExe)
    Get-Process $procName -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    Start-Process (Join-Path $DiscordRoot "Update.exe") -ArgumentList "--processStart", $DiscordExe
    Ok "Discord is starting."
}

# ---------- Vencord ----------

function Test-VencordSource($dir) {
    if (-not $dir) { return $false }
    $pkg = Join-Path $dir "package.json"
    if (-not (Test-Path $pkg)) { return $false }
    return (Get-Content $pkg -Raw) -match '"name"\s*:\s*"vencord"'
}

function Build-Vencord($dir) {
    Push-Location $dir
    try {
        if (-not (Test-Path (Join-Path $dir "node_modules"))) {
            Info "Installing Vencord's dependencies (first time only, takes a few minutes)..."
            pnpm install --frozen-lockfile
            if ($LASTEXITCODE) { throw "pnpm install failed." }
        }
        Info "Building Vencord..."
        pnpm build
        if ($LASTEXITCODE) { throw "pnpm build failed." }
    } finally { Pop-Location }
}

function Inject-Vencord($dir) {
    Info "Patching Discord ($Branch) to load Vencord from $dir..."
    Push-Location $dir
    try {
        pnpm inject -- -install -branch $Branch
        if ($LASTEXITCODE) { throw "Patching Discord failed." }
    } finally { Pop-Location }
}

# ---------- detect ----------

if (-not (Test-Path $DiscordRoot)) {
    throw "Discord ($Branch) isn't installed. Install it from https://discord.com/download and run this again."
}

$patchedDir = Get-PatchedVencordDir
if (-not $VencordDir) {
    if (Test-VencordSource $patchedDir) { $VencordDir = $patchedDir }
    else { $VencordDir = Join-Path $env:USERPROFILE "Vencord" }
}

$vencordInstalled = Test-VencordSource $VencordDir
$pluginDir = Join-Path $VencordDir "src\userplugins\$PluginName"
$pluginInstalled = $vencordInstalled -and (Test-Path $pluginDir)
$discordPatched = $patchedDir -and ((Resolve-Path $patchedDir -ErrorAction SilentlyContinue).Path -eq (Resolve-Path $VencordDir -ErrorAction SilentlyContinue).Path)

Write-Host ""
Write-Host "Discord ($Branch):        $DiscordRoot"
Write-Host "Vencord source folder:    $VencordDir $(if ($vencordInstalled) { '(installed)' } else { '(not installed yet)' })"
Write-Host "Discord loads Vencord:    $(if ($patchedDir) { $patchedDir } else { 'no (or the prebuilt Vencord)' })"
Write-Host "$DisplayName installed: $(if ($pluginInstalled) { 'yes' } else { 'no' })"
Write-Host ""

if ($DetectOnly) { return }

# ---------- plugin already installed: uninstall or update ----------

if ($pluginInstalled) {
    if (Ask "$DisplayName is already installed. Do you want to UNINSTALL it?" $false) {
        Info "Removing the plugin..."
        Remove-Item -Recurse -Force $pluginDir
        Ensure-Tools
        Build-Vencord $VencordDir
        Ok "$DisplayName was uninstalled. (Vencord itself is still installed.)"
        Restart-Discord
        return
    }

    if (-not (Ask "Update it to the version in this folder instead?" $true)) {
        Warn "Nothing changed."
        return
    }
}

# ---------- install ----------

Ensure-Tools

if (-not $vencordInstalled) {
    Info "Downloading Vencord to $VencordDir..."
    git clone https://github.com/Vendicated/Vencord.git $VencordDir
    if ($LASTEXITCODE) { throw "Downloading Vencord failed." }
}

Info "Adding $DisplayName to Vencord..."
New-Item -ItemType Directory -Force (Split-Path $pluginDir) | Out-Null
New-Item -ItemType Directory -Force $pluginDir | Out-Null
Copy-Item -Force (Join-Path $PluginSrc "*") $pluginDir

Build-Vencord $VencordDir

if (-not $discordPatched) { Inject-Vencord $VencordDir }

Write-Host ""
Ok "Done!"
Ok "After Discord opens: Settings -> Vencord -> Plugins, search '$DisplayName' and turn it on."
Ok "(If it was already on, it's updated now.)"
Restart-Discord
