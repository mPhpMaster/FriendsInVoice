# Friends in Voice web installer for Windows.
#   irm https://friendsinvoice.sarhsoft.com/install.ps1 | iex
# Downloads the newest release from GitHub into a temporary folder and runs its install.ps1,
# which adds the plugin to Vencord (and builds Vencord first if it isn't installed).

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host "Friends in Voice installer" -ForegroundColor Cyan
$release = Invoke-RestMethod "https://api.github.com/repos/mPhpMaster/FriendsInVoice/releases/latest" -Headers @{ "User-Agent" = "FriendsInVoice-installer" }
$asset = $release.assets | Where-Object { $_.name -like "FriendsInVoice-v*.zip" } | Select-Object -First 1
if (-not $asset) { throw "The newest release has no installer package. Try again later." }
Write-Host "Downloading $($release.tag_name)..." -ForegroundColor Cyan

$work = Join-Path ([IO.Path]::GetTempPath()) ("FriendsInVoice-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $zip = Join-Path $work "release.zip"
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath (Join-Path $work "release")
    $installer = Join-Path $work "release\install.ps1"
    if (-not (Test-Path $installer)) { throw "install.ps1 is missing from the release package." }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer @args
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
