/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Toggle Vencord": restarts Discord without Vencord, and makes a desktop shortcut that turns it back on.
// Vencord loads by replacing Discord's resources\app.asar with a tiny one that loads Vencord, and keeping
// Discord's own file as _app.asar. Turning it off swaps them back; turning it on swaps them again. The files
// can't be renamed while Discord runs, so a small PowerShell script does it after Discord closes.

import { spawn } from "child_process";
import { app, IpcMainInvokeEvent } from "electron";
import { mkdirSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

export const TOGGLE_SCRIPT = String.raw`# Friends in Voice: turn Vencord off or on for Discord, then start Discord again.
# Off: Discord runs as normal Discord. On: Vencord (and Friends in Voice) load again, even after a Discord update.
param([ValidateSet("enable", "disable")][string]$Mode = "enable", [string]$Exe = "Discord.exe", [string]$Root = "")
$ErrorActionPreference = "Stop"
if (-not $Root) { $Root = Join-Path $env:LOCALAPPDATA ([IO.Path]::GetFileNameWithoutExtension($Exe)) }
$name = [IO.Path]::GetFileNameWithoutExtension($Exe)
$backup = Join-Path $PSScriptRoot "vencord-$name-app.asar"

# wait for this Discord to close by itself, then make sure (only this one: PTB and Canary are left alone)
for ($i = 0; $i -lt 40 -and (Get-Process -Name $name -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$app = Get-ChildItem $Root -Directory -Filter "app-*" | Sort-Object { [version]($_.Name -replace '^app-', '') } -Descending | Select-Object -First 1
if (-not $app) { throw "Discord isn't installed in $Root." }
$res = Join-Path $app.FullName "resources"
$asar = Join-Path $res "app.asar"
$original = Join-Path $res "_app.asar"
$parked = Join-Path $res "app.asar.vencord"

if ($Mode -eq "disable") {
    # only when Vencord is really loaded here (Discord's own file is set aside as _app.asar)
    if (Test-Path $original) {
        if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
        Copy-Item $asar $backup -Recurse
        if (Test-Path $parked) { Remove-Item $parked -Recurse -Force }
        Rename-Item $asar "app.asar.vencord"
        Rename-Item $original "app.asar"
    }
} elseif (-not (Test-Path $original)) {
    # after a Discord update the new version folder has no parked copy: use the one saved when turning it off
    $source = if (Test-Path $parked) { $parked } elseif (Test-Path $backup) { $backup } else { $null }
    if ($source) {
        Rename-Item $asar "_app.asar"
        if ($source -eq $parked) { Rename-Item $parked "app.asar" } else { Copy-Item $backup $asar -Recurse }
    }
}

$update = Join-Path $Root "Update.exe"
if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", $Exe }
`;

function scriptPath() {
    return join(process.env.LOCALAPPDATA ?? app.getPath("userData"), "FriendsInVoice", "vencord-toggle.ps1");
}

function powershellArgs(file: string, mode: "enable" | "disable", exe: string, root: string) {
    return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file, "-Mode", mode, "-Exe", exe, "-Root", root];
}

/** A desktop shortcut that runs the script with -Mode enable, so Vencord can come back while it's off */
function shortcutScript(file: string, exe: string, root: string) {
    const quote = (value: string) => value.replace(/'/g, "''");
    const args = powershellArgs(file, "enable", exe, root).map(arg => arg.includes(" ") || arg.includes("\\") ? `"${arg}"` : arg).join(" ");
    return [
        "$shell = New-Object -ComObject WScript.Shell",
        `$link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '${quote(basename(exe, ".exe"))} + Vencord.lnk'))`,
        "$link.TargetPath = 'powershell.exe'",
        `$link.Arguments = '${quote(args)}'`,
        `$link.IconLocation = '${quote(join(root, "app.ico"))}'`,
        "$link.Description = 'Start Discord with Vencord and Friends in Voice again'",
        "$link.Save()",
    ].join("; ");
}

/** Closes Discord and starts it again without Vencord. Windows only for now. */
export async function disableVencord(_: IpcMainInvokeEvent) {
    if (process.platform !== "win32") return { ok: false, error: "Toggle Vencord works on Windows for now." };
    try {
        const exe = basename(process.execPath);
        // ...\Discord\app-1.0.9269\resources -> ...\Discord
        const root = dirname(dirname(process.resourcesPath));
        const file = scriptPath();
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, TOGGLE_SCRIPT, "utf8");
        const shortcut = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", shortcutScript(file, exe, root)], { windowsHide: true });
        await new Promise(resolve => { shortcut.on("exit", resolve); shortcut.on("error", resolve); setTimeout(resolve, 8000); });
        spawn("powershell.exe", powershellArgs(file, "disable", exe, root), { detached: true, stdio: "ignore", windowsHide: true }).unref();
        setTimeout(() => app.quit(), 500);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}
