/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sync across devices through the Friends in Voice server. Everything is encrypted on this computer with a key made
// from your sync passphrase, so the server (and its admin panel) only ever sees an unreadable blob. It never sees the
// passphrase, your Discord ID, names or the Log. Shared by the Vencord and BetterDiscord versions.

import type { GuardResponse, GuardTransport } from "./guardServer";

export const SYNC_LISTS = ["watchlist", "notifyOnline", "blacklist", "notifyVoice", "hidden"] as const;
export type SyncListKey = typeof SYNC_LISTS[number];

export interface SyncName { id: string; username: string; globalName?: string | null; avatar?: string | null; savedAt: number; }
export interface SyncLogEntry { time: number; kind: string; userId: string;[key: string]: unknown; }

export interface SyncData {
    /** each list with the time it last changed on any device */
    lists: Partial<Record<SyncListKey, { ids: string[]; changedAt: number; }>>;
    log: SyncLogEntry[];
    names: SyncName[];
}

export interface SyncKeys { blobId: string; proof: string; key: CryptoKey; }

const ITERATIONS = 200_000;
const MAX_LOG = 5000;
const MAX_NAMES = 5000;
const subtle = () => globalThis.crypto.subtle;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64url(text: string): Uint8Array {
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
}
const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** passphrase + Discord ID → where the blob lives, the write proof and the encryption key */
export async function deriveSyncKeys(passphrase: string, discordId: string): Promise<SyncKeys> {
    const base = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await subtle().deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(`fiv-sync:${discordId}`), iterations: ITERATIONS }, base, 96 * 8));
    const idPart = bits.slice(0, 32), writePart = bits.slice(32, 64), encPart = bits.slice(64, 96);
    return {
        blobId: hex(new Uint8Array(await subtle().digest("SHA-256", idPart))),
        proof: b64url(writePart),
        key: await subtle().importKey("raw", encPart, "AES-GCM", false, ["encrypt", "decrypt"]),
    };
}

export async function sealSync(data: SyncData, key: CryptoKey): Promise<string> {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data))));
    const out = new Uint8Array(iv.length + cipher.length);
    out.set(iv); out.set(cipher, iv.length);
    return b64url(out);
}

/** null when the passphrase is wrong or the blob is damaged */
export async function openSync(blob: string, key: CryptoKey): Promise<SyncData | null> {
    try {
        const bytes = fromB64url(blob);
        const plain = await subtle().decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
        return normalizeSync(JSON.parse(new TextDecoder().decode(plain)));
    } catch { return null; }
}

const isId = (value: unknown): value is string => typeof value === "string" && /^\d{17,20}$/.test(value);

export function normalizeSync(raw: any): SyncData {
    const lists: SyncData["lists"] = {};
    for (const key of SYNC_LISTS) {
        const list = raw?.lists?.[key];
        if (list && Array.isArray(list.ids) && Number.isFinite(list.changedAt)) lists[key] = { ids: [...new Set(list.ids.filter(isId))] as string[], changedAt: list.changedAt };
    }
    const log = (Array.isArray(raw?.log) ? raw.log : []).filter((entry: any) => Number.isFinite(entry?.time) && typeof entry.kind === "string" && isId(entry.userId));
    const names = (Array.isArray(raw?.names) ? raw.names : []).filter((name: any) => isId(name?.id) && typeof name.username === "string" && Number.isFinite(name.savedAt));
    return { lists, log, names };
}

const logId = (entry: SyncLogEntry) => `${entry.time}:${entry.userId}:${entry.kind}`;

/** Combines two copies: each list keeps the newer version, the Log keeps every entry once, names keep the newest. */
export function mergeSync(a: SyncData, b: SyncData): SyncData {
    const lists: SyncData["lists"] = {};
    for (const key of SYNC_LISTS) {
        const x = a.lists[key], y = b.lists[key];
        const pick = !x ? y : !y ? x : y.changedAt > x.changedAt ? y : x;
        if (pick) lists[key] = { ids: [...pick.ids], changedAt: pick.changedAt };
    }
    const log = new Map<string, SyncLogEntry>();
    for (const entry of [...a.log, ...b.log]) if (!log.has(logId(entry))) log.set(logId(entry), entry);
    const names = new Map<string, SyncName>();
    for (const name of [...a.names, ...b.names]) {
        const current = names.get(name.id);
        if (!current || name.savedAt > current.savedAt) names.set(name.id, name);
    }
    return {
        lists,
        log: [...log.values()].sort((x, y) => y.time - x.time).slice(0, MAX_LOG),
        names: [...names.values()].sort((x, y) => y.savedAt - x.savedAt).slice(0, MAX_NAMES),
    };
}

export class SyncError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

function failure(response: GuardResponse): SyncError {
    if (response.status === 0) return new SyncError(0, "Can't reach the Friends in Voice server.");
    if (response.status === 403) return new SyncError(403, "This sync passphrase doesn't match the one used before for this account.");
    if (response.status === 507) return new SyncError(507, "The Friends in Voice server is out of space for sync right now.");
    if (response.status === 429) return new SyncError(429, "The server asked to slow down. Sync will try again later.");
    return new SyncError(response.status, String(response.body?.error ?? `Sync failed (${response.status}).`));
}

/**
 * Pulls the server copy, merges it with this device's copy, and pushes the result when it changed.
 * Returns the merged data for this device to apply.
 */
export async function syncOnce(options: { transport: GuardTransport; server: string; keys: SyncKeys; local: SyncData; }): Promise<SyncData> {
    const { transport, server, keys } = options;
    const url = `${server.replace(/\/+$/, "")}/v1/sync/${keys.blobId}`;
    for (let attempt = 0; attempt < 3; attempt++) {
        const got = await transport({ method: "GET", url, timeoutMs: 20_000 });
        if (got.status !== 200 && got.status !== 404) throw failure(got);
        let remote: SyncData = { lists: {}, log: [], names: [] };
        const baseVersion = got.status === 200 ? Number(got.body?.version) || 0 : 0;
        if (got.status === 200 && typeof got.body?.data === "string") {
            const opened = await openSync(got.body.data, keys.key);
            if (!opened) throw new SyncError(403, "This sync passphrase can't open the saved copy.");
            remote = opened;
        }
        const merged = mergeSync(options.local, remote);
        if (got.status === 200 && JSON.stringify(merged) === JSON.stringify(mergeSync(remote, remote))) return merged;
        const put = await transport({ method: "PUT", url, body: { proof: keys.proof, baseVersion, data: await sealSync(merged, keys.key) }, timeoutMs: 30_000 });
        if (put.status === 200) return merged;
        if (put.status !== 409) throw failure(put);
        // another device saved in between: start again from its copy
    }
    throw new SyncError(409, "Another device kept saving at the same time. Sync will try again later.");
}

/** Deletes the server copy (for example after turning sync off). */
export async function deleteSync(options: { transport: GuardTransport; server: string; keys: SyncKeys; }) {
    const response = await options.transport({ method: "DELETE", url: `${options.server.replace(/\/+$/, "")}/v1/sync/${options.keys.blobId}`, body: { proof: options.keys.proof }, timeoutMs: 20_000 });
    if (response.status !== 200 && response.status !== 404) throw failure(response);
}
