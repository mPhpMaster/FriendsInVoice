// A small in-memory stand-in for the Friends in Voice server's /v1 API, so the plugin tests don't need the
// server's code (it lives in a separate private repository). It follows the same rules the plugin relies on.

const ACTIONS = ["mute", "deafen", "disconnect"];

export function fakeGuardServer(base = "https://guards.test") {
    let next = 1;
    const accounts = new Map(), tokens = new Map(), pairs = new Map(), codes = new Map(), queues = new Map();
    const push = (account, event) => {
        const queue = queues.get(account) ?? { seq: 0, events: [] };
        queue.events.push({ ...event, seq: ++queue.seq, at: Date.now() });
        queues.set(account, queue);
    };
    const view = (pair, account) => {
        const owner = pair.owner === account, peer = accounts.get(owner ? pair.guardian : pair.owner);
        return { id: pair.id, role: owner ? "owner" : "guardian", peerId: peer.discordId, peerKey: peer.publicKey, actions: pair.actions, nonce: pair.nonce, createdAt: pair.createdAt };
    };
    const ok = body => ({ status: 200, body });
    const error = (status, message) => ({ status, body: { error: message } });

    async function transport({ method, url, token, body }) {
        if (!url.startsWith(base + "/v1/")) return error(404, "Not found.");
        const path = url.slice(base.length).split("?")[0];
        const query = new URL(url).searchParams;
        const parts = path.split("/").filter(Boolean).slice(1);
        if (method === "POST" && path === "/v1/register") {
            const account = `acct${next++}`, secret = `token${next++}`;
            accounts.set(account, { discordId: body.discordId, publicKey: body.publicKey });
            tokens.set(secret, account);
            return ok({ token: secret });
        }
        const account = tokens.get(token);
        if (!account) return error(401, "Unknown token.");
        const me = accounts.get(account);
        if (method === "GET" && path === "/v1/pairs") {
            return ok({ me: me.discordId, pairs: [...pairs.values()].filter(p => p.owner === account || p.guardian === account).map(p => view(p, account)),
                codes: [...codes.entries()].filter(([, c]) => c.owner === account).map(([code, c]) => ({ code, ...c, owner: undefined })) });
        }
        if (method === "GET" && path === "/v1/events") {
            const after = Number(query.get("after") ?? 0), queue = queues.get(account) ?? { seq: 0, events: [] };
            return ok({ last: queue.seq, events: queue.events.filter(event => event.seq > after) });
        }
        if (parts[0] === "codes") {
            if (method === "POST" && parts.length === 1) {
                if (!body.actions?.length || !body.actions.every(action => ACTIONS.includes(action))) return error(400, "Choose at least one action.");
                const code = `ABCD${String(next++).padStart(4, "2").slice(-4).replace(/[01]/g, "2")}`;
                codes.set(code, { owner: account, guardianId: body.guardianId, actions: ACTIONS.filter(a => body.actions.includes(a)), nonce: body.nonce, expiresAt: Date.now() + 600_000 });
                return ok({ code, expiresAt: codes.get(code).expiresAt });
            }
            const item = codes.get(parts[1]);
            if (method === "DELETE") { if (item?.owner === account) codes.delete(parts[1]); return ok({ ok: true }); }
            if (!item) return error(404, "This code is wrong or expired.");
            if (item.guardianId !== me.discordId) return error(403, "This code was made for a different Discord account.");
            if (method === "GET" && parts.length === 2) return ok({ ownerId: accounts.get(item.owner).discordId, actions: item.actions, expiresAt: item.expiresAt });
            codes.delete(parts[1]);
            if (parts[2] === "refuse") { push(item.owner, { type: "refused", guardianId: me.discordId }); return ok({ ok: true }); }
            const pair = { id: `pair${next++}`, owner: item.owner, guardian: account, actions: item.actions, nonce: item.nonce, createdAt: Date.now() };
            pairs.set(pair.id, pair);
            push(item.owner, { type: "pairs" });
            return ok(view(pair, account));
        }
        if (parts[0] === "pairs" && parts[1]) {
            const pair = pairs.get(parts[1]);
            if (!pair || (pair.owner !== account && pair.guardian !== account)) return error(404, "This guard pairing no longer exists.");
            if (method === "DELETE") { pairs.delete(pair.id); push(pair.owner === account ? pair.guardian : pair.owner, { type: "pairs" }); return ok({ ok: true }); }
            if (method === "PATCH") { pair.actions = body.actions; push(pair.guardian, { type: "pairs" }); return ok(view(pair, account)); }
            if (method === "POST" && parts[2] === "commands") {
                if (pair.guardian !== account) return error(403, "Only the guardian sends commands.");
                push(pair.owner, { type: "command", pairId: pair.id, from: me.discordId, wire: body.wire });
                return ok({ delivered: true });
            }
        }
        return error(404, "Not found.");
    }
    return { base, transport };
}
