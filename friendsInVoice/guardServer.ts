/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Personal Guards talk to the Friends in Voice server instead of Discord: pairing uses a one-time code and
// commands travel end-to-end encrypted through the server. The plugin never reads DMs or adds reactions for
// guards, and it sends nothing to Discord in the background. Shared by the Vencord and BetterDiscord versions.

import { writeGuardSetting } from "./personalGuardsSettings";
import type { GuardAction, GuardGrant, GuardSealedWire, GuardsStore } from "./personalGuardsTypes";

export const DEFAULT_GUARD_SERVER = "https://friendsinvoice.sarhsoft.com";
const POLL_WAIT = 25_000;
const CODE_TEXT = /Friends in Voice guard code:\s*([A-HJ-NP-Z2-9]{4})-?([A-HJ-NP-Z2-9]{4})/;

export interface GuardRequest {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    token?: string;
    body?: unknown;
    timeoutMs: number;
}

export interface GuardResponse {
    status: number;
    body: any;
}

/** Sends one HTTPS request outside Discord's page (Vencord: native side; BetterDiscord: BdApi.Net). status 0 = network error */
export type GuardTransport = (request: GuardRequest) => Promise<GuardResponse>;

export interface GuardCredential {
    server: string;
    token: string;
    publicKey: string;
    /** the name and username last sent to the server, so they're only sent again when they change */
    profile?: string;
}

export interface GuardProfile {
    name?: string;
    username?: string;
}

export interface GuardCredentials {
    get(accountId: string): Promise<GuardCredential | undefined>;
    set(accountId: string, credential: GuardCredential | undefined): Promise<void>;
}

export interface ServerPair {
    id: string;
    role: "owner" | "guardian";
    peerId: string;
    peerKey: string;
    actions: GuardAction[];
    nonce: string;
    createdAt: number;
}

export interface ServerCode {
    code: string;
    guardianId: string;
    actions: GuardAction[];
    nonce: string;
    expiresAt: number;
}

export interface ServerPairs {
    me: string;
    pairs: ServerPair[];
    codes: ServerCode[];
}

export interface ServerEvent {
    seq: number;
    at: number;
    type: "pairs" | "refused" | "command";
    guardianId?: string;
    pairId?: string;
    from?: string;
    wire?: GuardSealedWire;
}

export interface CodeOffer {
    ownerId: string;
    actions: GuardAction[];
    expiresAt: number;
}

export class GuardServerError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

export function formatCode(code: string): string {
    return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeCode(value: string): string | null {
    const code = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
}

/** The line the owner sends their guardian (or the guardian pastes in) */
export function codeMessage(code: string): string {
    return `🛡️ Friends in Voice guard code: ${formatCode(code)}`;
}

export function codeFromText(text: string): string | null {
    const match = CODE_TEXT.exec(text ?? "");
    return match ? match[1] + match[2] : null;
}

function serverUrl(value: string): string {
    const url = (value || DEFAULT_GUARD_SERVER).trim().replace(/\/+$/, "");
    if (!/^https:\/\/[^/\s]+$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url))
        throw new GuardServerError(0, "The Personal Guards server address must start with https://.");
    return url;
}

export interface GuardClientOptions {
    transport: GuardTransport;
    credentials: GuardCredentials;
    server(): string;
    account(): string | undefined;
    publicKey(): Promise<string>;
    /** your own name and username, from what Discord already has loaded (no Discord requests) */
    profile?(): GuardProfile | undefined;
}

const clip = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : undefined;

/** the profile as it's sent to the server; undefined when there's nothing to send */
export function cleanProfile(profile: GuardProfile | undefined): GuardProfile | undefined {
    const name = clip(profile?.name), username = clip(profile?.username);
    if (!name && !username) return undefined;
    return { ...(name ? { name } : {}), ...(username ? { username } : {}) };
}

export class GuardServerClient {
    private registering = new Map<string, Promise<GuardCredential>>();

    constructor(private options: GuardClientOptions) { }

    private async credential(account: string, fresh = false): Promise<GuardCredential> {
        const server = serverUrl(this.options.server());
        const publicKey = await this.options.publicKey();
        const saved = fresh ? undefined : await this.options.credentials.get(account);
        if (saved && saved.server === server && saved.publicKey === publicKey) return saved;
        const key = `${account}|${server}|${publicKey}`;
        let work = this.registering.get(key);
        if (!work) {
            work = (async () => {
                const profile = this.profile(account);
                const response = await this.options.transport({ method: "POST", url: `${server}/v1/register`, body: { discordId: account, publicKey, ...profile }, timeoutMs: 15_000 });
                if (response.status !== 200 || typeof response.body?.token !== "string") throw this.failure(response);
                const credential: GuardCredential = { server, token: response.body.token, publicKey, ...(profile ? { profile: JSON.stringify(profile) } : {}) };
                await this.options.credentials.set(account, credential);
                return credential;
            })().finally(() => this.registering.delete(key));
            this.registering.set(key, work);
        }
        return work;
    }

    private profile(account: string): GuardProfile | undefined {
        return this.options.account() === account ? cleanProfile(this.options.profile?.()) : undefined;
    }

    /** Tells the server your current name and username when they changed since last time. Only for a device that
     * already uses the server: it never signs up a new device just for this. */
    async syncProfile(): Promise<boolean> {
        const account = this.options.account();
        if (!account) return false;
        const saved = await this.options.credentials.get(account);
        if (!saved || saved.server !== serverUrl(this.options.server())) return false;
        const profile = this.profile(account);
        const key = profile && JSON.stringify(profile);
        if (!profile || saved.profile === key) return false;
        await this.call("PATCH", "/v1/me", profile);
        const latest = await this.options.credentials.get(account);
        if (latest && this.options.account() === account) await this.options.credentials.set(account, { ...latest, profile: key });
        return true;
    }

    private failure(response: GuardResponse): GuardServerError {
        if (response.status === 0) return new GuardServerError(0, "Can't reach the Personal Guards server. Check your internet connection.");
        if (response.status === 429) return new GuardServerError(429, "The Personal Guards server asked to slow down. Try again in a minute.");
        return new GuardServerError(response.status, String(response.body?.error ?? `Personal Guards server error (${response.status}).`));
    }

    async call<T = any>(method: GuardRequest["method"], path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
        const account = this.options.account();
        if (!account) throw new GuardServerError(0, "Discord is still loading your account. Try again in a moment.");
        let credential = await this.credential(account);
        let response = await this.options.transport({ method, url: credential.server + path, token: credential.token, body, timeoutMs });
        if (response.status === 401) {
            credential = await this.credential(account, true);
            response = await this.options.transport({ method, url: credential.server + path, token: credential.token, body, timeoutMs });
        }
        if (this.options.account() !== account) throw new GuardServerError(0, "Discord accounts changed. Try again.");
        if (response.status !== 200) throw this.failure(response);
        return response.body as T;
    }

    listPairs() { return this.call<ServerPairs>("GET", "/v1/pairs"); }
    createCode(guardianId: string, actions: GuardAction[], nonce: string) {
        return this.call<{ code: string; expiresAt: number; }>("POST", "/v1/codes", { guardianId, actions, nonce });
    }
    showCode(code: string) { return this.call<CodeOffer>("GET", `/v1/codes/${code}`); }
    /** whether this device proved (with Discord's login page) that it belongs to its Discord account */
    me() { return this.call<{ discordId: string; verified: boolean; }>("GET", "/v1/me"); }
    /** the Discord login link that proves this device's account; nothing changes until you approve it there */
    startVerification() { return this.call<{ url: string; }>("POST", "/v1/oauth/start"); }
    /** open invites this person made for you (verified accounts only) */
    incomingCodes(ownerId: string) { return this.call<(CodeOffer & { code: string; })[]>("GET", `/v1/codes/incoming?from=${encodeURIComponent(ownerId)}`); }
    acceptCode(code: string) { return this.call<ServerPair>("POST", `/v1/codes/${code}/accept`); }
    refuseCode(code: string) { return this.call("POST", `/v1/codes/${code}/refuse`); }
    cancelCode(code: string) { return this.call("DELETE", `/v1/codes/${code}`); }
    updatePair(pairId: string, actions: GuardAction[]) { return this.call<ServerPair>("PATCH", `/v1/pairs/${pairId}`, { actions }); }
    deletePair(pairId: string) { return this.call("DELETE", `/v1/pairs/${pairId}`); }
    sendCommand(pairId: string, wire: GuardSealedWire) { return this.call<{ delivered: boolean; }>("POST", `/v1/pairs/${pairId}/commands`, { wire }); }
    events(after: number, wait: number) {
        return this.call<{ last: number; events: ServerEvent[]; }>("GET", `/v1/events?after=${after}&wait=${wait}`, undefined, wait + 15_000);
    }
}

/** Copies the server's view of this account's pairs into the local store. The server is the source of truth. */
export function applyServerPairs(store: GuardsStore, state: ServerPairs, now = Date.now()): void {
    const owned = state.pairs.filter(pair => pair.role === "owner");
    const guarding = state.pairs.filter(pair => pair.role === "guardian");
    const codes = state.codes.filter(code => code.expiresAt > now);
    const ids = new Set([...store.personalGuards.map(grant => grant.userId), ...owned.map(pair => pair.peerId), ...codes.map(code => code.guardianId)]);
    const personal: GuardGrant[] = [];
    for (const userId of ids) {
        const local = store.personalGuards.find(grant => grant.userId === userId);
        const pair = owned.find(item => item.peerId === userId);
        const code = codes.find(item => item.guardianId === userId);
        personal.push({
            userId,
            actions: [...(pair?.actions ?? code?.actions ?? local?.actions ?? [])],
            ...(pair ? { pairId: pair.id, inviteNonce: pair.nonce } : {}),
            ...(code ? { code: code.code, codeExpiresAt: code.expiresAt } : {}),
        });
    }
    writeGuardSetting(store, "personalGuards", personal);
    writeGuardSetting(store, "knownGuardGrants", guarding.map(pair => ({ userId: pair.peerId, actions: [...pair.actions], inviteNonce: pair.nonce, pairId: pair.id })));
    const keyed = new Map(state.pairs.map(pair => [pair.peerId, pair.peerKey]));
    writeGuardSetting(store, "guardPeerKeys", [
        ...store.guardPeerKeys.filter(peer => !keyed.has(peer.userId)).map(peer => ({ userId: peer.userId, publicKey: peer.publicKey })),
        ...[...keyed].map(([userId, publicKey]) => ({ userId, publicKey })),
    ]);
    // invitations now arrive as codes; the DM-based ones can't be used any more
    if (store.pendingGuardInvites.length) writeGuardSetting(store, "pendingGuardInvites", []);
}

/** The owner's side needs to hear about commands only while it can act on them. */
export function ownerNeedsEvents(store: GuardsStore, inVoice: boolean, now = Date.now()): boolean {
    return store.personalGuards.some(grant => grant.code && (grant.codeExpiresAt ?? 0) > now) ||
        (inVoice && store.personalGuards.some(grant => grant.pairId));
}

export interface GuardPollerOptions {
    client: GuardServerClient;
    shouldRun(): boolean;
    onEvents(events: ServerEvent[]): Promise<void> | void;
    wait?(ms: number): Promise<void>;
}

/**
 * One long-poll request to the Friends in Voice server at a time, only while shouldRun() says so
 * (you own guards and are in voice, or an invite code is open). It never contacts Discord.
 */
export class GuardPoller {
    private running = false;
    private generation = 0;
    private after = 0;
    private wake?: () => void;

    constructor(private options: GuardPollerOptions) { }

    /** Call when something shouldRun() depends on changed */
    update() {
        if (this.options.shouldRun()) { if (!this.running) void this.loop(); }
        else if (this.running) { this.generation++; this.running = false; this.wake?.(); }
    }

    /** Account switch or plugin stop */
    reset() {
        this.generation++;
        this.running = false;
        this.after = 0;
        this.wake?.();
    }

    private sleep(ms: number) {
        if (this.options.wait) return this.options.wait(ms);
        return new Promise<void>(resolve => {
            const timer = setTimeout(done, ms);
            function done() { clearTimeout(timer); resolve(); }
            this.wake = done;
        });
    }

    private async loop() {
        const generation = ++this.generation;
        this.running = true;
        let failures = 0;
        while (generation === this.generation && this.options.shouldRun()) {
            try {
                const started = Date.now();
                const result = await this.options.client.events(this.after, POLL_WAIT);
                if (generation !== this.generation) break;
                this.after = result.last;
                failures = 0;
                if (result.events.length) await this.options.onEvents(result.events);
                // a proxy that answers at once must not turn this into a fast loop
                else if (Date.now() - started < 1000) await this.sleep(5000);
            } catch (error) {
                if (generation !== this.generation) break;
                failures++;
                const status = error instanceof GuardServerError ? error.status : 0;
                await this.sleep(status === 429 ? 60_000 : Math.min(5 * 60_000, 2000 * 2 ** Math.min(failures - 1, 8)));
            }
        }
        if (generation === this.generation) this.running = false;
    }
}
