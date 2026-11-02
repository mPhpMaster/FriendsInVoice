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
