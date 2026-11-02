#!/usr/bin/env node
/*
 * FriendsInVoice repair (Windows, macOS, Linux).
 * Copyright (c) 2026 mPhpMaster
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Fixes the usual reasons Vencord stops building, so FriendsInVoice installs and updates again:
 *   1. a broken pnpm (for example corepack can't start the pnpm version Vencord asks for)
 *   2. Vencord updated itself but its new dependencies were never installed
 *   3. an old or half-copied FriendsInVoice folder
 *   4. another Vencord plugin that no longer builds (it is moved aside only if you say yes)
 *   5. Discord not loading this Vencord folder
 *
 * Usage: node repair.mjs [--vencord-dir <folder>] [--branch stable|ptb|canary] [--yes]
 * Normally started from repair.bat (Windows), repair.command (macOS) or repair.sh (Linux).
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const PLUGIN = "friendsInVoice";
const HERE = dirname(fileURLToPath(import.meta.url));
const WINDOWS = process.platform === "win32";

// ---------- pure helpers (tested in tests/repair.test.mjs) ----------

// Vencord's "build" script is a plain `node …` command; run it with node directly so pnpm can't get in the way.
export function directBuildArgs(script) {
    if (typeof script !== "string") return null;
    const parts = script.trim().split(/\s+/);
    if (parts[0] !== "node" || parts.length < 2) return null;
    const args = parts.slice(1);
    return args.every(arg => /^[\w./=:@+-]+$/.test(arg)) ? args : null;
}

// "pnpm@12.15.0+sha512.…" -> "12.15.0"
export function pnpmVersion(packageManager) {
    const match = /^pnpm@(\d[^+\s]*)/.exec(String(packageManager ?? ""));
    return match ? match[1] : "latest";
}

// Other userplugins named in a failed build's output, e.g. "src/userplugins/prayerTimesBreak/citySearch.tsx:11:9: ERROR".
export function brokenPlugins(output, own = PLUGIN) {
    const names = new Set();
    for (const match of String(output).matchAll(/src[\\/]+userplugins[\\/]+([^\\/\s:"'`]+)[\\/]/g)) {
        if (match[1] !== own && !match[1].startsWith(".")) names.add(match[1]);
    }
    return [...names];
}

// The Vencord folder a patched app.asar loads, or null.
export function vencordDirFromAsar(contents, platform) {
    if (platform === "win32") {
        const match = contents.match(/([A-Za-z]:(?:\\\\[^"\\\r\n]+)+?)\\\\dist\\\\patcher\.js/);
        return match ? win32.normalize(match[1].replace(/\\\\/g, "\\")) : null;
    }
    const match = contents.match(/(\/[^"'`\r\n]+)\/dist\/patcher\.js/);
    return match ? posix.normalize(match[1]) : null;
}

const DISCORD = {
    stable: { win: "Discord", mac: "Discord", linux: ["discord", "Discord"], exe: "Discord.exe", cmd: "discord" },
    ptb: { win: "DiscordPTB", mac: "Discord PTB", linux: ["discord-ptb", "DiscordPTB"], exe: "DiscordPTB.exe", cmd: "discord-ptb" },
    canary: { win: "DiscordCanary", mac: "Discord Canary", linux: ["discord-canary", "DiscordCanary"], exe: "DiscordCanary.exe", cmd: "discord-canary" }
};

// Folders that may hold Discord's app.asar, best first.
export function discordResourceDirs(platform, branch, env = process.env, home = homedir()) {
    const names = DISCORD[branch] ?? DISCORD.stable;
    if (platform === "win32") {
        const root = win32.join(env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local"), names.win);
        let apps = [];
        try { apps = readdirSync(root).filter(name => /^app-\d/.test(name)); } catch { }
        const key = name => name.slice(4).split(".").map(Number);
        apps.sort((a, b) => {
            const x = key(a), y = key(b);
            for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
            return 0;
        });
        return apps.map(app => win32.join(root, app, "resources"));
    }
    if (platform === "darwin") return [`/Applications/${names.mac}.app/Contents/Resources`, `${home}/Applications/${names.mac}.app/Contents/Resources`];
    const dirs = [];
    for (const n of names.linux) {
        for (const dir of [`/usr/share/${n}`, `/usr/lib/${n}`, `/opt/${n}`, `/usr/lib64/${n}`, `${home}/.local/share/${n}`,
            `/var/lib/flatpak/app/com.discordapp.${n}/current/active/files/${n}`,
            `${home}/.local/share/flatpak/app/com.discordapp.${n}/current/active/files/${n}`]) dirs.push(`${dir}/resources`);
    }
    return dirs;
}

// ---------- console ----------

const color = (code, text) => process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const info = text => console.log(color(36, text));
const ok = text => console.log(color(32, text));
const warn = text => console.log(color(33, text));
class Stop extends Error { }
const fail = text => { throw new Stop(text); };

let assumeYes = false;
async function ask(question, defaultYes = true) {
    if (assumeYes) return defaultYes;
    if (!process.stdin.isTTY) return defaultYes;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
        return answer ? answer.startsWith("y") : defaultYes;
    } finally { rl.close(); }
}
async function askText(question) {
    if (assumeYes || !process.stdin.isTTY) return "";
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(question)).trim().replace(/^"(.*)"$/, "$1"); } finally { rl.close(); }
}

// ---------- commands ----------

const ENV = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", COREPACK_ENABLE_STRICT: "0" };
if (process.platform === "darwin") ENV.PATH = `/opt/homebrew/bin:/usr/local/bin:${ENV.PATH ?? ""}`;

// Runs a command, showing its output live; returns { ok, output } with the output's tail for error checks.
function run(command, args, cwd, { capture = false, env = ENV } = {}) {
    const shell = WINDOWS && command !== process.execPath;
    const quoted = shell ? args.map(a => /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a) : args;
    const result = spawnSync(command, quoted, { cwd, env, shell, encoding: "utf8", stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit", maxBuffer: 64 * 1024 * 1024 });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (capture && output) process.stdout.write(output);
    return { ok: result.status === 0 && !result.error, output };
}

// ---------- steps ----------

function readPackage(dir) {
    try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { return null; }
}
const isVencord = dir => !!dir && readPackage(dir)?.name === "vencord";

function patchedVencordDir(branch) {
    for (const dir of discordResourceDirs(process.platform, branch)) {
        const asar = join(dir, "app.asar");
        if (!existsSync(asar)) continue;
        try { return vencordDirFromAsar(readFileSync(asar, "latin1"), process.platform); } catch { return null; }
    }
    return null;
}

async function findVencord(given, branch) {
    if (given) {
        const dir = resolve(given);
        if (!isVencord(dir)) fail(`${dir} is not a Vencord source folder.`);
        return dir;
    }
    const patched = patchedVencordDir(branch);
    if (isVencord(patched)) return patched;
    for (const dir of [join(homedir(), "Vencord"), WINDOWS ? "D:\\Vencord" : null, WINDOWS ? "C:\\Vencord" : null]) if (isVencord(dir)) return dir;
    const typed = await askText("Where is your Vencord source folder? (the folder with Vencord's package.json): ");
    if (typed && isVencord(resolve(typed))) return resolve(typed);
    fail("Vencord's source folder wasn't found. Run this again with --vencord-dir <folder>, or run the installer first.");
}

// Returns a function that runs pnpm with the given arguments, fixing pnpm first if it doesn't start.
function preparePnpm(vencord) {
    const version = pnpmVersion(readPackage(vencord)?.packageManager);
    const works = () => run("pnpm", ["--version"], vencord, { capture: true }).ok;
    if (works()) return { label: "pnpm", run: (args, capture) => run("pnpm", args, vencord, { capture }) };

    warn(`pnpm doesn't start. Repairing it (installing pnpm ${version} with npm)...`);
    run("corepack", ["disable", "pnpm"], vencord, { capture: true });
    run("npm", ["install", "-g", `pnpm@${version}`], vencord);
    if (works()) { ok("pnpm works again."); return { label: "pnpm", run: (args, capture) => run("pnpm", args, vencord, { capture }) }; }

    warn(`pnpm still doesn't start; using pnpm ${version} through npx for this repair.`);
    return { label: `npx pnpm@${version}`, run: (args, capture) => run("npx", ["--yes", `pnpm@${version}`, ...args], vencord, { capture }) };
}

function installPlugin(vencord) {
    const source = join(HERE, PLUGIN);
    const target = join(vencord, "src", "userplugins", PLUGIN);
    if (!existsSync(join(source, "index.tsx"))) {
        if (existsSync(join(target, "index.tsx"))) { warn("No friendsInVoice folder next to this file; keeping the installed copy."); return; }
        fail("The friendsInVoice folder isn't next to this file. Extract the whole ZIP and run repair from there.");
    }
    info("Putting a fresh copy of FriendsInVoice into Vencord...");
    mkdirSync(dirname(target), { recursive: true });
    const backup = mkdtempSync(join(tmpdir(), "friends-in-voice-repair-"));
    if (existsSync(target)) renameSync(target, join(backup, PLUGIN));
    cpSync(source, target, { recursive: true });
    ok(`Done. The previous copy, if any, is in ${backup}`);
}

function installDependencies(pnpm) {
    info(`Installing Vencord's dependencies with ${pnpm.label}...`);
    if (pnpm.run(["install", "--frozen-lockfile"]).ok) return;
    warn("That didn't work; trying again without --frozen-lockfile...");
    if (!pnpm.run(["install"]).ok) fail("Installing Vencord's dependencies failed (see the messages above).");
}

function build(vencord, pnpm) {
    info("Building Vencord...");
    const args = directBuildArgs(readPackage(vencord)?.scripts?.build);
    if (args) return run(process.execPath, args, vencord, { capture: true });
    return pnpm.run(["build"], true);
}

async function buildUntilItWorks(vencord, pnpm) {
    const disabled = join(vencord, "userplugins-disabled");
    for (let attempt = 0; attempt < 6; attempt++) {
        const result = build(vencord, pnpm);
        if (result.ok) { ok("Vencord built successfully."); return; }
        const others = brokenPlugins(result.output).filter(name => existsSync(join(vencord, "src", "userplugins", name)));
        if (!others.length) fail("Building Vencord failed (see the messages above).");
        for (const name of others) {
            warn(`\nThe Vencord plugin "${name}" doesn't build with this Vencord version, so nothing can be built.`);
            if (!await ask(`Move "${name}" out of the way (to ${join(disabled, name)}) so Vencord builds? You can move it back after updating it.`, true))
                fail(`Update or remove the "${name}" plugin, then run repair again.`);
            mkdirSync(disabled, { recursive: true });
            const destination = existsSync(join(disabled, name)) ? join(disabled, `${name}-${Date.now()}`) : join(disabled, name);
            renameSync(join(vencord, "src", "userplugins", name), destination);
            ok(`Moved to ${destination}`);
        }
    }
    fail("Building Vencord still fails after moving plugins aside.");
}

function sameDir(a, b) {
    try { return !!a && !!b && statSync(a).isDirectory() && resolve(a).toLowerCase() === resolve(b).toLowerCase(); } catch { return false; }
}

function linkDiscord(vencord, branch) {
    if (sameDir(patchedVencordDir(branch), vencord)) { ok("Discord already loads Vencord from this folder."); return; }
    info(`Patching Discord (${branch}) to load Vencord from ${vencord}...`);
    run(process.execPath, ["scripts/runInstaller.mjs", "--", "-install", "-branch", branch], vencord);
    if (!sameDir(patchedVencordDir(branch), vencord)) warn("Discord doesn't seem to load this Vencord folder yet. Run the installer (install.bat / install.command / install.sh) to patch it.");
}

async function restartDiscord(branch) {
    if (!await ask("Restart Discord now so the repair takes effect?", true)) { warn("Fully quit Discord and open it again when you're ready."); return; }
    const names = DISCORD[branch] ?? DISCORD.stable;
    if (WINDOWS) {
        spawnSync("taskkill", ["/IM", names.exe, "/F"], { stdio: "ignore" });
        const updater = join(process.env.LOCALAPPDATA ?? "", names.win, "Update.exe");
        if (existsSync(updater)) spawnSync("cmd", ["/c", "start", "", updater, "--processStart", names.exe], { stdio: "ignore" });
    } else if (process.platform === "darwin") {
        spawnSync("osascript", ["-e", `quit app "${names.mac}"`], { stdio: "ignore" });
        spawnSync("sleep", ["3"]);
        spawnSync("open", ["-a", names.mac], { stdio: "ignore" });
    } else {
        spawnSync("pkill", ["-x", names.cmd], { stdio: "ignore" });
        warn(`Open ${names.mac} again from your app menu.`);
        return;
    }
    ok("Discord is restarting.");
}

async function main(argv) {
    let vencordDir = "", branch = "stable";
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--vencord-dir" || arg === "-VencordDir") vencordDir = argv[++i] ?? "";
        else if (arg === "--branch" || arg === "-Branch") branch = argv[++i] ?? "stable";
        else if (arg === "--yes" || arg === "-y") assumeYes = true;
        else if (arg === "--help" || arg === "-h") { console.log("Usage: node repair.mjs [--vencord-dir <folder>] [--branch stable|ptb|canary] [--yes]"); return 0; }
    }
    if (!DISCORD[branch]) fail(`Unknown Discord branch "${branch}" (use stable, ptb or canary).`);
    if (Number(process.versions.node.split(".")[0]) < 18) fail(`Node.js ${process.versions.node} is too old. Install Node.js 22 or newer and run repair again.`);

    console.log("\nFriendsInVoice repair\n");
    const vencord = await findVencord(vencordDir, branch);
    ok(`Vencord source folder: ${vencord}`);
    const pnpm = preparePnpm(vencord);
    installPlugin(vencord);
    installDependencies(pnpm);
    await buildUntilItWorks(vencord, pnpm);
    linkDiscord(vencord, branch);
    console.log();
    ok("Repair finished. FriendsInVoice is installed and Vencord builds; updates from Discord will work again.");
    await restartDiscord(branch);
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
        console.error(color(31, `\n${error instanceof Stop ? error.message : error?.stack ?? error}`));
        process.exitCode = 1;
    });
}
