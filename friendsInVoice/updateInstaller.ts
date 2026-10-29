/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, type IpcMainInvokeEvent } from "electron";
import { readFileSync as readOriginalFileSync } from "original-fs";

import { selectReleaseAsset, validatePackage } from "./updatePackage";
import { vencordRootFromArchive } from "./updatePaths";
import type { ReleaseInfo, UpdateStatus } from "./updateTypes";
import { isNewer } from "./updateVersion";

const REPO = "mPhpMaster/FriendsInVoice";
const STATUS: UpdateStatus = { stage: "idle", message: "Ready to update." };
let busy = false;

function setStatus(stage: UpdateStatus["stage"], message: string, version?: string): void {
    Object.assign(STATUS, { stage, message, version });
}

export function getUpdateStatus(_: IpcMainInvokeEvent): UpdateStatus {
    return { ...STATUS };
}

async function getVencordRoot(): Promise<string> {
    const asar = join(process.resourcesPath, "app.asar");
    const contents = readOriginalFileSync(asar).toString("utf8");
    const { root, patcher } = vencordRootFromArchive(contents, process.platform);
    const packageFile = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (packageFile.name !== "vencord" || !existsSync(patcher)) throw new Error("The Vencord source directory was not found.");
    return root;
}

async function runBuild(root: string): Promise<void> {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    await new Promise<void>((done, fail) => {
        const env = { ...process.env, PATH: process.platform === "darwin" ? `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` : process.env.PATH };
        const child = spawn(command, ["build"], { cwd: root, env, windowsHide: true, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
        const timeout = setTimeout(() => child.kill(), 5 * 60 * 1000);
        let output = "";
        for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
            output = (output + String(chunk)).slice(-4000);
        });
        child.on("error", error => { clearTimeout(timeout); fail(error); });
        child.on("close", code => {
            clearTimeout(timeout);
            code === 0 ? done() : fail(new Error(`Vencord build failed (exit ${code}). ${output.slice(-800)}`));
        });
    });
}

async function fetchPackage(version: string): Promise<Map<string, Uint8Array>> {
    const releaseResponse = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "FriendsInVoice-Updater" },
        signal: AbortSignal.timeout(30_000)
    });
    if (!releaseResponse.ok) throw new Error(`GitHub release lookup failed (HTTP ${releaseResponse.status}).`);
    const release = await releaseResponse.json() as ReleaseInfo;
    const asset = selectReleaseAsset(release, version);
    const response = await fetch(asset.browser_download_url, {
        headers: { "User-Agent": "FriendsInVoice-Updater" }, signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok || !response.body) throw new Error(`ZIP download failed (HTTP ${response.status}).`);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        length += chunk.length;
        if (length > asset.size) { await response.body.cancel(); throw new Error("The ZIP download exceeded its declared size."); }
        chunks.push(chunk);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    setStatus("validating", "Validating the downloaded package…", version);
    return validatePackage(bytes, asset, version);
}

async function installFiles(root: string, files: Map<string, Uint8Array>, version: string): Promise<void> {
    const pluginsRoot = join(root, "src", "userplugins");
    const destination = join(pluginsRoot, "friendsInVoice");
    const current = await stat(destination).catch(() => null);
    if (!current?.isDirectory() || current.isSymbolicLink()) throw new Error("The installed plugin directory was not found.");
    const workspace = await mkdtemp(join(pluginsRoot, ".friends-in-voice-update-"));
    const staging = join(workspace, "new");
    const backup = join(workspace, "backup");
    let replaced = false;
    try {
        await mkdir(staging);
        for (const [name, content] of files) await writeFile(join(staging, name.slice("friendsInVoice/".length)), content);
        setStatus("installing", "Installing plugin source and preserving a backup…", version);
        await rename(destination, backup);
        try {
            await rename(staging, destination);
            replaced = true;
        } catch (error) {
            await rename(backup, destination);
            throw error;
        }
        setStatus("building", "Building Vencord. Discord will restart when this succeeds…", version);
        await runBuild(root);
    } catch (error) {
        if (replaced) {
            await rm(destination, { recursive: true, force: true });
            await rename(backup, destination);
            try { await runBuild(root); } catch { throw new Error(`Update failed and source was restored, but rebuilding the previous version also failed: ${String(error)}`); }
        }
        throw error;
    } finally {
        await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
}

export async function installUpdate(_: IpcMainInvokeEvent, version: string, installedVersion: string): Promise<UpdateStatus> {
    if (busy) return { ...STATUS };
    if (!["win32", "darwin", "linux"].includes(process.platform)) return { stage: "failed", message: "Automatic updates require Windows, macOS or Linux. Open the release page to update on this system.", version };
    if (!isNewer(version, installedVersion)) return { stage: "failed", message: "The selected version is not newer than the installed version.", version };
    busy = true;
    try {
        const root = await getVencordRoot();
        setStatus("downloading", `Downloading Friends in Voice v${version}…`, version);
        const files = await fetchPackage(version);
        await installFiles(root, files, version);
        setStatus("restarting", "Update installed. Restarting Discord…", version);
        setTimeout(() => { app.relaunch(); app.quit(); }, 1500);
    } catch (error) {
        setStatus("failed", `Update failed: ${error instanceof Error ? error.message : String(error)}`, version);
    } finally {
        busy = false;
    }
    return { ...STATUS };
}
