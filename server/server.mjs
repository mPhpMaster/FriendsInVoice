// FriendsInVoice Personal Guards server.
// Pairs two plugin installs with a one-time code and relays end-to-end encrypted guard commands between them,
// so the plugin never reads DMs, sends guard messages or adds reactions on Discord. No Discord tokens, no
// messages and no voice data reach this server. No dependencies: Node 18+ built-ins only.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";

export const ACTIONS = ["mute", "deafen", "disconnect"];
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_TTL = 10 * 60_000;
const COMMAND_TTL = 60_000;
const EVENT_TTL = 60 * 60_000;
const MAX_EVENTS = 100;
const MAX_WAIT = 25_000;
const ONLINE_WINDOW = 35_000;
const MAX_BODY = 8 * 1024;

const SNOWFLAKE = /^\d{17,20}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;
const NONCE = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const B64 = /^[A-Za-z0-9_-]+$/;

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

const sha256 = value => createHash("sha256").update(value).digest("hex");
const id = (bytes = 12) => randomBytes(bytes).toString("hex");
const cleanActions = value => Array.isArray(value) && value.length && value.every(action => ACTIONS.includes(action))
    ? ACTIONS.filter(action => value.includes(action)) : null;

export function normalizeCode(value) {
    const code = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return code.length === 8 && [...code].every(char => CODE_ALPHABET.includes(char)) ? code : null;
}

function newCode() {
    let code = "";
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return code;
}

function validWire(wire) {
    return !!wire && typeof wire === "object" && wire.type === "sealed" && wire.version === 2 &&
        SNOWFLAKE.test(wire.to) && PUBLIC_KEY.test(wire.fromKey) && typeof wire.iv === "string" && wire.iv.length === 16 && B64.test(wire.iv) &&
        typeof wire.ciphertext === "string" && wire.ciphertext.length > 20 && wire.ciphertext.length < 2000 && B64.test(wire.ciphertext);
}

/** In-memory state, saved to one JSON file. A few hundred users fit easily. */
export class GuardStore {
    constructor(file, now = Date.now) {
        this.file = file;
        this.now = now;
        this.accounts = {};
        this.pairs = {};
        this.codes = {};
        this.queues = new Map();
        this.waiters = new Map();
        this.lastPoll = new Map();
        this.lastSeen = new Map();
        if (file) {
            try {
                const saved = JSON.parse(readFileSync(file, "utf8"));
                Object.assign(this, { accounts: saved.accounts ?? {}, pairs: saved.pairs ?? {}, codes: saved.codes ?? {} });
            } catch { /* first start */ }
        }
    }

    save() {
        if (!this.file || this.saveTimer) return;
        this.saveTimer = setTimeout(() => this.flush(), 200);
        this.saveTimer.unref?.();
    }

    flush() {
        clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        if (!this.file) return;
        mkdirSync(dirname(this.file), { recursive: true });
        const temp = `${this.file}.tmp`;
        writeFileSync(temp, JSON.stringify({ accounts: this.accounts, pairs: this.pairs, codes: this.codes }), { mode: 0o600 });
        renameSync(temp, this.file);
    }

    sweep() {
        const now = this.now();
        let changed = false;
        for (const [code, item] of Object.entries(this.codes)) if (item.expiresAt <= now) { delete this.codes[code]; changed = true; }
        for (const [account, queue] of this.queues) {
            const kept = queue.events.filter(event => event.expiresAt > now);
            if (kept.length !== queue.events.length) queue.events = kept;
            if (!kept.length && !this.waiters.get(account)?.size) this.queues.delete(account);
        }
        if (changed) this.save();
    }

    /** What the admin dashboard shows. Never includes token hashes. */
    adminOverview() {
        const now = this.now();
        const pairCount = account => Object.values(this.pairs).filter(pair => pair.owner === account || pair.guardian === account).length;
        const accounts = Object.entries(this.accounts).map(([account, item]) => ({
            id: account, discordId: item.discordId, createdAt: item.createdAt, lastSeen: this.lastSeen.get(account) ?? null,
            listening: this.online(account), pairs: pairCount(account),
        })).sort((a, b) => (b.lastSeen ?? b.createdAt) - (a.lastSeen ?? a.createdAt));
        const pairs = Object.values(this.pairs).map(pair => ({
            id: pair.id, ownerId: this.accounts[pair.owner]?.discordId, guardianId: this.accounts[pair.guardian]?.discordId,
            actions: pair.actions, createdAt: pair.createdAt, ownerListening: this.online(pair.owner),
        })).sort((a, b) => b.createdAt - a.createdAt);
        const codes = Object.entries(this.codes).filter(([, item]) => item.expiresAt > now).map(([code, item]) => ({
            code: `${code.slice(0, 2)}••-••${code.slice(6)}`, ownerId: this.accounts[item.owner]?.discordId, guardianId: item.guardianId,
            actions: item.actions, expiresAt: item.expiresAt,
        }));
        const queued = [...this.queues.values()].reduce((sum, queue) => sum + queue.events.filter(event => event.expiresAt > now).length, 0);
        const waiting = [...this.waiters.values()].reduce((sum, set) => sum + set.size, 0);
        return { accounts, pairs, codes, queued, waiting };
    }

    adminDeleteAccount(account) {
        if (!this.accounts[account]) throw new HttpError(404, "No such account.");
        for (const pair of Object.values(this.pairs)) if (pair.owner === account || pair.guardian === account) this.removePair(pair.id, account);
        for (const [code, item] of Object.entries(this.codes)) if (item.owner === account) delete this.codes[code];
        delete this.accounts[account];
        this.queues.delete(account);
        this.lastSeen.delete(account);
        this.save();
    }

    adminDeletePair(pairId) {
        if (!this.pairs[pairId]) throw new HttpError(404, "No such pairing.");
        this.removePair(pairId);
    }

    register(discordId, publicKey) {
        if (!SNOWFLAKE.test(discordId ?? "")) throw new HttpError(400, "Invalid Discord user ID.");
        if (!PUBLIC_KEY.test(publicKey ?? "")) throw new HttpError(400, "Invalid public key.");
        const token = randomBytes(32).toString("base64url");
        const account = id();
        this.accounts[account] = { discordId, publicKey, tokenHash: sha256(token), createdAt: this.now() };
        this.save();
        return { account, token };
    }

    authenticate(header) {
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "");
        if (!match) throw new HttpError(401, "Missing or invalid token.");
        const hash = Buffer.from(sha256(match[1]));
        for (const [account, item] of Object.entries(this.accounts)) {
            if (item.tokenHash.length === hash.length && timingSafeEqual(Buffer.from(item.tokenHash), hash)) {
                this.lastSeen.set(account, this.now());
                return account;
            }
        }
        throw new HttpError(401, "Unknown token. Register again.");
    }

    view(pair, account) {
        const owner = pair.owner === account;
        const peer = this.accounts[owner ? pair.guardian : pair.owner];
        return { id: pair.id, role: owner ? "owner" : "guardian", peerId: peer?.discordId, peerKey: peer?.publicKey,
            actions: pair.actions, nonce: pair.nonce, createdAt: pair.createdAt };
    }

    listPairs(account) {
        const pairs = Object.values(this.pairs).filter(pair => pair.owner === account || pair.guardian === account).map(pair => this.view(pair, account));
        const codes = Object.entries(this.codes).filter(([, item]) => item.owner === account)
            .map(([code, item]) => ({ code, guardianId: item.guardianId, actions: item.actions, nonce: item.nonce, expiresAt: item.expiresAt }));
        return { me: this.accounts[account].discordId, pairs, codes };
    }

    createCode(account, { guardianId, actions, nonce }) {
        const owner = this.accounts[account];
        const allowed = cleanActions(actions);
        if (!SNOWFLAKE.test(guardianId ?? "") || guardianId === owner.discordId) throw new HttpError(400, "Invalid guardian.");
        if (!allowed) throw new HttpError(400, "Choose at least one action.");
        if (!NONCE.test(nonce ?? "")) throw new HttpError(400, "Invalid nonce.");
        // one open code per guardian; a new invite replaces the old one
        for (const [code, item] of Object.entries(this.codes)) if (item.owner === account && item.guardianId === guardianId) delete this.codes[code];
        if (Object.values(this.codes).filter(item => item.owner === account).length >= 10) throw new HttpError(429, "Too many open invites. Wait for them to expire.");
        let code;
        do code = newCode(); while (this.codes[code]);
        const expiresAt = this.now() + CODE_TTL;
        this.codes[code] = { owner: account, guardianId, actions: allowed, nonce, expiresAt };
        this.save();
        return { code, expiresAt };
    }

    openCode(account, rawCode) {
        const code = normalizeCode(rawCode);
        const item = code && this.codes[code];
        if (!item || item.expiresAt <= this.now()) throw new HttpError(404, "This code is wrong or expired. Ask for a new one.");
        const me = this.accounts[account];
        if (item.owner === account) throw new HttpError(400, "This is your own invite code.");
        if (item.guardianId !== me.discordId) throw new HttpError(403, "This code was made for a different Discord account.");
        return { code, item };
    }

    showCode(account, rawCode) {
        const { item } = this.openCode(account, rawCode);
        return { ownerId: this.accounts[item.owner]?.discordId, actions: item.actions, expiresAt: item.expiresAt };
    }

    acceptCode(account, rawCode) {
        const { code, item } = this.openCode(account, rawCode);
        delete this.codes[code];
        for (const pair of Object.values(this.pairs)) {
            const sameGuardian = this.accounts[pair.guardian]?.discordId === this.accounts[account].discordId;
            if (pair.owner === item.owner && (pair.guardian === account || sameGuardian)) this.removePair(pair.id);
        }
        const pair = { id: id(), owner: item.owner, guardian: account, actions: item.actions, nonce: item.nonce, createdAt: this.now() };
        this.pairs[pair.id] = pair;
        this.push(pair.owner, { type: "pairs" });
        this.save();
        return this.view(pair, account);
    }

    refuseCode(account, rawCode) {
        const { code, item } = this.openCode(account, rawCode);
        delete this.codes[code];
        this.push(item.owner, { type: "refused", guardianId: this.accounts[account].discordId });
        this.save();
    }

    cancelCode(account, rawCode) {
        const code = normalizeCode(rawCode);
        if (code && this.codes[code]?.owner === account) { delete this.codes[code]; this.save(); }
    }

    pairFor(account, pairId) {
        const pair = this.pairs[pairId];
        if (!pair || (pair.owner !== account && pair.guardian !== account)) throw new HttpError(404, "This guard pairing no longer exists.");
        return pair;
    }

    updatePair(account, pairId, { actions }) {
        const pair = this.pairFor(account, pairId);
        if (pair.owner !== account) throw new HttpError(403, "Only the owner can change allowed actions.");
        const allowed = cleanActions(actions);
        if (!allowed) throw new HttpError(400, "Choose at least one action.");
        pair.actions = allowed;
        this.push(pair.guardian, { type: "pairs" });
        this.save();
        return this.view(pair, account);
    }

    removePair(pairId, by) {
        const pair = this.pairs[pairId];
        if (!pair) return;
        delete this.pairs[pairId];
        for (const account of [pair.owner, pair.guardian]) if (account !== by) this.push(account, { type: "pairs" });
        this.save();
    }

    deletePair(account, pairId) {
        this.removePair(this.pairFor(account, pairId).id, account);
    }

    command(account, pairId, wire) {
        const pair = this.pairFor(account, pairId);
        if (pair.guardian !== account) throw new HttpError(403, "Only the guardian sends commands.");
        const owner = this.accounts[pair.owner];
        if (!validWire(wire) || wire.to !== owner.discordId || wire.fromKey !== this.accounts[account].publicKey)
            throw new HttpError(400, "Invalid encrypted command.");
        this.push(pair.owner, { type: "command", pairId, from: this.accounts[account].discordId, wire }, COMMAND_TTL);
        return { delivered: this.online(pair.owner) };
    }

    online(account) {
        return !!this.waiters.get(account)?.size || this.now() - (this.lastPoll.get(account) ?? 0) < ONLINE_WINDOW;
    }

    queue(account) {
        let queue = this.queues.get(account);
        if (!queue) this.queues.set(account, queue = { seq: 0, events: [] });
        return queue;
    }

    push(account, event, ttl = EVENT_TTL) {
        if (!this.accounts[account]) return;
        const queue = this.queue(account);
        queue.events.push({ ...event, seq: ++queue.seq, at: this.now(), expiresAt: this.now() + ttl });
        if (queue.events.length > MAX_EVENTS) queue.events.splice(0, queue.events.length - MAX_EVENTS);
        for (const wake of this.waiters.get(account) ?? []) wake();
    }

    pending(account, after) {
        const now = this.now();
        const queue = this.queue(account);
        // a cursor from before a server restart is ahead of the new counter: start over
        const from = after > queue.seq ? 0 : after;
        return { last: queue.seq, events: queue.events.filter(event => event.seq > from && event.expiresAt > now)
            .map(({ expiresAt, ...event }) => event) };
    }

    /** Long poll: answers at once if events are waiting, otherwise after the first event or `wait` ms. */
    poll(account, after, wait, signal) {
        this.lastPoll.set(account, this.now());
        const ready = this.pending(account, after);
        if (ready.events.length || wait <= 0) return Promise.resolve(ready);
        return new Promise(resolve => {
            let waiters = this.waiters.get(account);
            if (!waiters) this.waiters.set(account, waiters = new Set());
            const finish = () => {
                clearTimeout(timer);
                waiters.delete(finish);
                signal?.removeEventListener?.("abort", finish);
                this.lastPoll.set(account, this.now());
                resolve(this.pending(account, after));
            };
            const timer = setTimeout(finish, Math.min(wait, MAX_WAIT));
            waiters.add(finish);
            signal?.addEventListener?.("abort", finish);
        });
    }
}

class RateLimiter {
    constructor(limit, windowMs) { Object.assign(this, { limit, windowMs, hits: new Map() }); }
    take(key, now = Date.now()) {
        const hit = this.hits.get(key);
        if (!hit || now - hit.start > this.windowMs) { this.hits.set(key, { start: now, count: 1 }); return true; }
        return ++hit.count <= this.limit;
    }
    sweep(now = Date.now()) { for (const [key, hit] of this.hits) if (now - hit.start > this.windowMs) this.hits.delete(key); }
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        request.on("data", chunk => {
            size += chunk.length;
            if (size > MAX_BODY) { reject(new HttpError(413, "Request too large.")); request.destroy(); return; }
            chunks.push(chunk);
        });
        request.on("end", () => {
            if (!size) return resolve({});
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { reject(new HttpError(400, "Invalid JSON.")); }
        });
        request.on("error", reject);
    });
}

/** Requests and errors per minute for the last hour, for the dashboard */
export function createStats(now = Date.now) {
    const minutes = new Map();
    const bump = key => {
        const minute = Math.floor(now() / 60_000);
        const entry = minutes.get(minute) ?? { requests: 0, errors: 0 };
        entry[key]++;
        minutes.set(minute, entry);
        for (const old of minutes.keys()) if (old <= minute - 60) minutes.delete(old);
    };
    const sum = key => [...minutes.entries()].filter(([minute]) => minute > Math.floor(now() / 60_000) - 60).reduce((total, [, entry]) => total + entry[key], 0);
    return { request: () => bump("requests"), error: () => bump("errors"), lastHour: () => sum("requests"), errorsLastHour: () => sum("errors") };
}

export function createApp({ store = new GuardStore(null), version = "dev", admin, stats = createStats() } = {}) {
    const registerLimit = new RateLimiter(20, 60 * 60_000);
    const requestLimit = new RateLimiter(120, 60_000);
    const codeLimit = new RateLimiter(20, 10 * 60_000);
    const sweeper = setInterval(() => { store.sweep(); registerLimit.sweep(); requestLimit.sweep(); codeLimit.sweep(); }, 30_000);
    sweeper.unref?.();

    async function route(request, url, signal) {
        const { pathname } = url;
        const method = request.method;
        if (method === "GET" && (pathname === "/" || pathname === "/health")) return { ok: true, service: "FriendsInVoice Personal Guards", version };
        // behind Apache the last X-Forwarded-For entry is the one Apache added; earlier ones come from the client
        const ip = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").split(",").pop().trim();
        if (method === "POST" && pathname === "/v1/register") {
            if (!registerLimit.take(ip)) throw new HttpError(429, "Too many registrations. Try again later.");
            const body = await readBody(request);
            return store.register(body.discordId, body.publicKey);
        }
        if (!pathname.startsWith("/v1/")) throw new HttpError(404, "Not found.");
        const account = store.authenticate(request.headers.authorization);
        if (!requestLimit.take(account)) throw new HttpError(429, "Too many requests. Slow down.");
        const parts = pathname.split("/").filter(Boolean).slice(1);

        if (method === "GET" && parts[0] === "pairs" && parts.length === 1) return store.listPairs(account);
        if (method === "GET" && parts[0] === "events" && parts.length === 1) {
            const after = Math.max(0, Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0);
            const wait = Math.max(0, Math.min(MAX_WAIT, Number.parseInt(url.searchParams.get("wait") ?? "0", 10) || 0));
            return store.poll(account, after, wait, signal);
        }
        if (parts[0] === "codes") {
            if (method === "POST" && parts.length === 1) return store.createCode(account, await readBody(request));
            if (parts.length >= 2 && method !== "DELETE" && !codeLimit.take(account)) throw new HttpError(429, "Too many code attempts. Wait a few minutes.");
            if (method === "GET" && parts.length === 2) return store.showCode(account, parts[1]);
            if (method === "DELETE" && parts.length === 2) { store.cancelCode(account, parts[1]); return { ok: true }; }
            if (method === "POST" && parts.length === 3 && parts[2] === "accept") return store.acceptCode(account, parts[1]);
            if (method === "POST" && parts.length === 3 && parts[2] === "refuse") { store.refuseCode(account, parts[1]); return { ok: true }; }
        }
        if (parts[0] === "pairs" && parts.length >= 2) {
            if (method === "PATCH" && parts.length === 2) return store.updatePair(account, parts[1], await readBody(request));
            if (method === "DELETE" && parts.length === 2) { store.deletePair(account, parts[1]); return { ok: true }; }
            if (method === "POST" && parts.length === 3 && parts[2] === "commands") return store.command(account, parts[1], (await readBody(request)).wire);
        }
        throw new HttpError(404, "Not found.");
    }

    const server = createServer(async (request, response) => {
        const controller = new AbortController();
        response.on("close", () => controller.abort());
        let status = 200, body;
        try {
            const url = new URL(request.url ?? "/", "http://localhost");
            const ip = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").split(",").pop().trim();
            if (admin && await admin(request, response, url, ip, readBody)) return;
            stats.request();
            body = await route(request, url, controller.signal);
        } catch (error) {
            status = error instanceof HttpError ? error.status : 500;
            body = { error: error instanceof HttpError ? error.message : "Server error." };
            if (status >= 500) { stats.error(); console.error(error); }
        }
        if (response.writableEnded || response.destroyed) return;
        response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        response.end(JSON.stringify(body));
    });
    server.on("close", () => { clearInterval(sweeper); store.flush(); });
    return server;
}
