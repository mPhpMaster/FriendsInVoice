/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { posix, win32 } from "node:path";

export function vencordRootFromArchive(contents: string, platform: NodeJS.Platform): { root: string; patcher: string; } {
    const windows = platform === "win32";
    const match = windows ? contents.match(/require\("([^"\r\n]+dist\\\\patcher\.js)"\)/)
        : contents.match(/(\/[^"'`\r\n]+\/dist\/patcher\.js)/);
    if (!match) throw new Error("This Discord installation is not patched with Vencord source.");
    const patcher = windows ? JSON.parse(`"${match[1]}"`) as string : match[1];
    const paths = windows ? win32 : posix;
    if (!paths.isAbsolute(patcher) || /[\r\n\0]/.test(patcher)) throw new Error("The Vencord patcher path is invalid.");
    return { patcher, root: paths.resolve(paths.dirname(patcher), "..") };
}

// Vencord's "build" script is a plain `node …` command. Running it with node directly skips the pnpm launcher,
// which breaks on some Windows setups (a stale corepack shim fails with MODULE_NOT_FOUND before anything builds).
// Returns node's arguments, or null when the script needs a shell (quotes, &&, pipes, …) and must go through pnpm.
export function directBuildArgs(script: unknown): string[] | null {
    if (typeof script !== "string") return null;
    const parts = script.trim().split(/\s+/);
    if (parts[0] !== "node" || parts.length < 2) return null;
    const args = parts.slice(1);
    return args.every(arg => /^[\w.\/=:@+-]+$/.test(arg)) ? args : null;
}

// Other userplugins named in a failed build's output ("src/userplugins/<name>/file.tsx:11:9: ERROR …").
// Kept in sync with repair.mjs, which can't import TypeScript.
export function brokenPlugins(output: string, own = "friendsInVoice"): string[] {
    const names = new Set<string>();
    for (const match of output.matchAll(/src[\\/]+userplugins[\\/]+([^\\/\s:"'`]+)[\\/]/g)) {
        if (match[1] !== own && !match[1].startsWith(".")) names.add(match[1]);
    }
    return [...names];
}

// "pnpm@12.15.0+sha512.…" -> "12.15.0"
export function pnpmVersion(packageManager: unknown): string {
    const match = /^pnpm@(\d[^+\s]*)/.exec(String(packageManager ?? ""));
    return match ? match[1] : "latest";
}
