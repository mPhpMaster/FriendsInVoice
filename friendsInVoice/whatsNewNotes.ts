/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turns the GitHub release notes into simple blocks the "What's new" window can draw.
// Shared by the Vencord plugin and the BetterDiscord port, so it uses no Discord or DOM code.

import { isNewer, parseVersion } from "./updateVersion";

export const RELEASES_URL = "https://api.github.com/repos/mPhpMaster/FriendsInVoice/releases?per_page=30";
const MAX_RELEASES = 5;

// how to update and how it was tested don't matter once the update is installed
const HIDDEN_SECTIONS = /^(update|verification)\b/i;

export interface Inline { text: string; bold?: boolean; code?: boolean; href?: string; }
export type Block =
    | { type: "heading"; parts: Inline[]; }
    | { type: "item"; parts: Inline[]; }
    | { type: "text"; parts: Inline[]; };
export interface ReleaseNotes { version: string; url: string; blocks: Block[]; }

export interface GitHubRelease {
    tag_name?: string;
    body?: string | null;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;

export function parseInline(text: string): Inline[] {
    const parts: Inline[] = [];
    let at = 0;
    for (const match of text.matchAll(INLINE)) {
        if (match.index! > at) parts.push({ text: text.slice(at, match.index) });
        if (match[1] !== undefined) parts.push(...parseInline(match[1]).map(part => ({ ...part, bold: true })));
        else if (match[2] !== undefined) parts.push({ text: match[2], code: true });
        else parts.push({ text: match[3], href: match[4] });
        at = match.index! + match[0].length;
    }
    if (at < text.length) parts.push({ text: text.slice(at) });
    return parts;
}

export function parseNotes(markdown: string): Block[] {
    const blocks: Block[] = [];
    let hidden = false;
    for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
            hidden = HIDDEN_SECTIONS.test(heading[1]);
            // every release in the window is already "what's new"
            if (!hidden && !/^what'?s new$/i.test(heading[1])) blocks.push({ type: "heading", parts: parseInline(heading[1]) });
            continue;
        }
        if (hidden) continue;
        const item = /^[-*]\s+(.*)$/.exec(line);
        blocks.push({ type: item ? "item" : "text", parts: parseInline(item ? item[1] : line) });
    }
    return blocks;
}

/**
 * The releases to show after updating from `seen` to `current`, newest first.
 * With no `seen` (the first version that has this window) only `current` is shown.
 */
export function pickReleases(releases: GitHubRelease[], seen: string | null, current: string): ReleaseNotes[] {
    const picked: ReleaseNotes[] = [];
    for (const release of releases) {
        const version = String(release.tag_name ?? "").replace(/^v/, "");
        if (release.draft || release.prerelease || !parseVersion(version) || isNewer(version, current)) continue;
        if (seen ? !isNewer(version, seen) : version !== current) continue;
        const blocks = parseNotes(release.body ?? "");
        if (!blocks.length) continue;
        picked.push({
            version,
            url: release.html_url ?? `https://github.com/mPhpMaster/FriendsInVoice/releases/tag/v${version}`,
            blocks
        });
    }
    return picked.sort((a, b) => isNewer(a.version, b.version) ? -1 : 1).slice(0, MAX_RELEASES);
}

/**
 * What to do when the plugin starts. `seen` is the version whose window was last shown on this Discord;
 * `usedBefore` says the plugin was already set up, so a missing `seen` means an update rather than a new install.
 */
export function whatsNewAction(seen: string | null, current: string, usedBefore: boolean): "show" | "remember" | "nothing" {
    if (seen === current) return "nothing";
    if (seen ? isNewer(current, seen) : usedBefore) return "show";
    return "remember";
}
