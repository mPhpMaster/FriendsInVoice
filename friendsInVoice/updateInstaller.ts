/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app, type IpcMainInvokeEvent } from "electron";
import { readFileSync as readOriginalFileSync } from "original-fs";

import { selectReleaseAsset, validatePackage } from "./updatePackage";
import { brokenPlugins, directBuildArgs, pnpmVersion, vencordRootFromArchive } from "./updatePaths";
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

type CommandError = Error & { output?: string; code?: string; };

const REPAIR_HINT = "Run repair from the FriendsInVoice release ZIP (repair.bat on Windows, repair.command on macOS, repair.sh on Linux) to fix it.";

function runCommand(root: string, command: string, args: string[], shell: boolean, what = "Vencord build", minutes = 5, extraEnv: Record<string, string> = {}): Promise<void> {
    return new Promise<void>((done, fail) => {
        const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", ...extraEnv, PATH: process.platform === "darwin" ? `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` : process.env.PATH };
        const child = spawn(command, args, { cwd: root, env, windowsHide: true, shell, stdio: ["ignore", "pipe", "pipe"] });
        const timeout = setTimeout(() => child.kill(), minutes * 60 * 1000);
        let output = "";
        for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
            output = (output + String(chunk)).slice(-6000);
        });
        child.on("error", error => { clearTimeout(timeout); fail(error); });
        child.on("close", code => {
            clearTimeout(timeout);
            if (code === 0) return done();
            fail(Object.assign(new Error(`${what} failed (exit ${code}). ${output.slice(-800)}`), { output }));
        });
    });
}

async function readVencordPackage(root: string) {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
}

async function runBuild(root: string): Promise<void> {
    const args = directBuildArgs((await readVencordPackage(root))?.scripts?.build);
    if (args) {
        try {
            return await runCommand(root, "node", args, false);
        } catch (error) {
            // node isn't on Discord's PATH: let pnpm find it
            if ((error as CommandError)?.code !== "ENOENT") throw error;
        }
    }
    const windows = process.platform === "win32";
    return runCommand(root, windows ? "pnpm.cmd" : "pnpm", ["build"], windows);
}

// Vencord updates itself without installing its new dependencies. Install them with pnpm; if pnpm is broken
// (corepack can't start the version Vencord asks for), retry with a fresh corepack cache, then through npx.
async function installDependencies(root: string): Promise<void> {
    const windows = process.platform === "win32";
    const pnpm = windows ? "pnpm.cmd" : "pnpm";
    const args = ["install", "--frozen-lockfile"];
    try { return await runCommand(root, pnpm, args, windows, "Installing Vencord's dependencies", 10); } catch { }
    try {
        return await runCommand(root, pnpm, args, windows, "Installing Vencord's dependencies", 10, { COREPACK_HOME: join(tmpdir(), "friends-in-voice-corepack") });
    } catch { }
    const version = pnpmVersion((await readVencordPackage(root))?.packageManager);
    return runCommand(root, windows ? "npx.cmd" : "npx", ["--yes", `pnpm@${version}`, ...args], windows, "Installing Vencord's dependencies", 10);
}

function otherPluginError(error: unknown): Error | null {
    const others = brokenPlugins((error as CommandError)?.output ?? String(error));
    return others.length ? new Error(`Another Vencord plugin (${others.join(", ")}) doesn't build with your Vencord version, so Vencord can't be built. ${REPAIR_HINT}`) : null;
}

// Build; when that fails, install Vencord's dependencies and try once more. Name another plugin that breaks the build.
async function buildWithRepair(root: string, version?: string): Promise<void> {
    try {
        return await runBuild(root);
    } catch (error) {
        const other = otherPluginError(error);
        if (other) throw other;
        setStatus("building", "Installing Vencord's dependencies, then building again…", version);
        await installDependencies(root).catch(() => undefined);
    }
    try {
        await runBuild(root);
    } catch (error) {
        throw otherPluginError(error) ?? new Error(`${error instanceof Error ? error.message : String(error)} ${REPAIR_HINT}`);
    }
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
        await buildWithRepair(root, version);
    } catch (error) {
        if (replaced) {
            await rm(destination, { recursive: true, force: true });
            await rename(backup, destination);
            try { await buildWithRepair(root, version); } catch (rebuildError) { throw new Error(`Update failed and source was restored, but rebuilding the previous version also failed: ${String(rebuildError)}`); }
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
