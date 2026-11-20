// Admin dashboard for the guard server: /admin. Full control of the server's own data and settings: accounts,
// pairings, codes, event queues, the request log, maintenance mode, backup, password, restart and wipe.
// It never contacts Discord. Token hashes appear only in the backup file.
// Login: one or more admins, each with a username and a password stored only as an scrypt hash. Until an admin is
// added in the dashboard, the single admin is "admin" with ADMIN_PASSWORD_HASH (made by install.sh).

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";

import { PAGE, SCRIPT } from "./adminPage.mjs";

const SESSION_TTL = 12 * 60 * 60_000;
const COOKIE = "fiv_admin";

export function hashPassword(password, salt = randomBytes(16)) {
    return `scrypt:${salt.toString("base64")}:${scryptSync(password, salt, 32).toString("base64")}`;
}

export function checkPassword(password, stored) {
    const [kind, salt, hash] = String(stored ?? "").split(":");
    if (kind !== "scrypt" || !salt || !hash || typeof password !== "string" || !password || password.length > 200) return false;
    const expected = Buffer.from(hash, "base64");
    const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
    return expected.length > 0 && timingSafeEqual(expected, actual);
}

function cookies(request) {
    return Object.fromEntries(String(request.headers.cookie ?? "").split(";").map(part => part.trim().split("=")).filter(([key]) => key));
}

function send(response, status, body, headers = {}) {
    const json = typeof body !== "string";
    response.writeHead(status, {
        "content-type": json ? "application/json; charset=utf-8" : headers["content-type"] ?? "text/html; charset=utf-8",
        "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        ...headers,
    });
    response.end(json ? JSON.stringify(body) : body);
}

export function createAdmin({ store, passwordHash, version = "dev", dataFile, stats, now = Date.now, restart = () => process.exit(0) }) {
    const sessions = new Map();
    const attempts = new Map();
    const startedAt = now();
    const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
    const httpError = (status, message) => Object.assign(new Error(message), { status });

    /** The admins. Before any change in the dashboard: one "admin" using the server's password hash. */
    function admins() {
        if (Array.isArray(store.settings?.admins) && store.settings.admins.length) return store.settings.admins;
        const hash = store.settings?.adminPasswordHash || passwordHash;
        return hash ? [{ username: "admin", hash, createdAt: startedAt }] : [];
    }
    function saveAdmins(list) {
        store.settings.admins = list;
        delete store.settings.adminPasswordHash;
        store.save();
    }
    const findAdmin = name => admins().find(admin => admin.username.toLowerCase() === String(name ?? "").toLowerCase());
    function validPassword(password) {
        if (typeof password !== "string" || password.length < 10 || password.length > 200) throw httpError(400, "Passwords need at least 10 characters.");
        return password;
    }
    function endSessions(username, except) {
        for (const [token, item] of sessions) if (item.username.toLowerCase() === username.toLowerCase() && token !== except) sessions.delete(token);
    }

    function session(request) {
        const token = cookies(request)[COOKIE];
        const item = token && sessions.get(token);
        if (!item || item.expires < now() || !findAdmin(item.username)) { if (token) sessions.delete(token); return null; }
        return token;
    }

    function limited(ip) {
        const entry = attempts.get(ip);
        if (!entry || now() - entry.start > 15 * 60_000) { attempts.set(ip, { start: now(), count: 1 }); return false; }
        return ++entry.count > 10;
    }

    function overview() {
        let dataSize = null;
        try { dataSize = dataFile ? statSync(dataFile).size : null; } catch { /* not written yet */ }
        const memory = process.memoryUsage();
        return {
            server: { version, node: process.version, startedAt, now: now(), memoryMb: Math.round(memory.rss / 1048576), dataSize,
                requestsLastHour: stats?.lastHour() ?? null, errorsLastHour: stats?.errorsLastHour() ?? null, sessions: sessions.size,
                admins: admins().length },
            ...store.adminOverview(),
        };
    }

    async function api(method, action, request, response, token) {
        const [section, target, sub] = action;
        // the raw data can be large; everything else is small
        const body = method === "GET" || method === "DELETE" ? {} : await readJson(request, section === "raw" ? 20 * 1024 * 1024 : undefined);
        const me = sessions.get(token).username;
        if (method === "GET" && section === "overview") return { ...overview(), me };
        if (method === "GET" && section === "raw") return store.adminRaw();
        if (method === "POST" && section === "raw") return store.adminReplace(body.data);
        if (section === "admins") {
            const list = admins();
            if (method === "GET" && !target) return list.map(admin => ({ username: admin.username, createdAt: admin.createdAt, lastLogin: admin.lastLogin ?? null,
                sessions: [...sessions.values()].filter(item => item.username.toLowerCase() === admin.username.toLowerCase() && item.expires > now()).length,
                me: admin.username.toLowerCase() === me.toLowerCase() }));
            if (method === "POST" && !target) {
                if (!USERNAME.test(body.username ?? "")) throw httpError(400, "Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.");
                if (findAdmin(body.username)) throw httpError(409, "That admin already exists.");
                saveAdmins([...list, { username: body.username, hash: hashPassword(validPassword(body.password)), createdAt: now() }]);
                return { ok: true };
            }
            const admin = target && findAdmin(decodeURIComponent(target));
            if (!admin) throw httpError(404, "No such admin.");
            if (method === "PATCH") {
                const next = { ...admin };
                if (body.password !== undefined) next.hash = hashPassword(validPassword(body.password));
                if (body.username !== undefined && body.username !== admin.username) {
                    if (!USERNAME.test(body.username)) throw httpError(400, "Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.");
                    if (findAdmin(body.username)) throw httpError(409, "That admin already exists.");
                    next.username = body.username;
                    for (const item of sessions.values()) if (item.username.toLowerCase() === admin.username.toLowerCase()) item.username = body.username;
                }
                saveAdmins(list.map(item => item.username === admin.username ? next : item));
                if (body.password !== undefined) endSessions(next.username, token);
                return { ok: true };
            }
            if (method === "DELETE") {
                if (list.length === 1) throw httpError(400, "Keep at least one admin.");
                saveAdmins(list.filter(item => item.username !== admin.username));
                endSessions(admin.username);
                return { ok: true };
            }
        }
        if (method === "GET" && section === "logs") return stats?.recent?.() ?? [];
        if (method === "DELETE" && section === "logs") { stats?.clearLog?.(); return { ok: true }; }
        if (section === "accounts" && target) {
            if (method === "GET" && sub === "events") return store.adminEvents(target);
            if (method === "DELETE" && sub === "events") { store.adminClearEvents(target); return { ok: true }; }
            if (method === "DELETE" && !sub) { store.adminDeleteAccount(target); return { ok: true }; }
        }
        if (section === "pairs" && target) {
            if (method === "PATCH") { store.adminUpdatePair(target, body.actions); return { ok: true }; }
            if (method === "DELETE") { store.adminDeletePair(target); return { ok: true }; }
        }
        if (method === "DELETE" && section === "codes" && target) { store.adminCancelCode(target); return { ok: true }; }
        if (method === "POST" && section === "settings") { store.adminSetting("maintenance", body.maintenance); return { ok: true }; }
        if (method === "GET" && section === "backup") {
            send(response, 200, JSON.stringify(store.adminBackup(), null, 2), {
                "content-type": "application/json; charset=utf-8",
                "content-disposition": `attachment; filename="friendsinvoice-backup-${new Date(now()).toISOString().slice(0, 10)}.json"`,
            });
            return undefined;
        }
        if (method === "POST" && section === "password") {
            const admin = findAdmin(me);
            if (!checkPassword(body.current, admin?.hash)) throw httpError(403, "The current password is wrong.");
            const hash = hashPassword(validPassword(body.next));
            saveAdmins(admins().map(item => item.username === admin.username ? { ...item, hash } : item));
            endSessions(me, token);
            return { ok: true };
        }
        if (method === "POST" && section === "sessions") {
            for (const other of sessions.keys()) if (other !== token) sessions.delete(other);
            return { ok: true };
        }
        if (method === "POST" && section === "wipe") {
            if (body.confirm !== "WIPE") throw Object.assign(new Error("Type WIPE to confirm."), { status: 400 });
            store.adminWipe();
            return { ok: true };
        }
        if (method === "POST" && section === "restart") {
            store.flush();
            send(response, 200, { ok: true });
            setTimeout(restart, 300).unref?.();
            return undefined;
        }
        throw Object.assign(new Error("Not found."), { status: 404 });
    }

    let readJson;
    /** Returns true when the request was for the dashboard */
    return async function handle(request, response, url, ip, readBody) {
        readJson = readBody;
        const { pathname } = url;
        if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
        if (!admins().length) { send(response, 503, { error: "The admin dashboard is off. Set ADMIN_PASSWORD_HASH." }); return true; }
        const method = request.method;
        if (method === "GET" && (pathname === "/admin" || pathname === "/admin/")) { send(response, 200, PAGE); return true; }
        if (method === "GET" && pathname === "/admin/app.js") { send(response, 200, SCRIPT, { "content-type": "text/javascript; charset=utf-8" }); return true; }
        if (method === "GET" && pathname === "/admin/app.css") { send(response, 200, STYLE, { "content-type": "text/css; charset=utf-8" }); return true; }
        if (!pathname.startsWith("/admin/api/")) { send(response, 404, { error: "Not found." }); return true; }
        // the page sends this header; a form or link from another site can't
        if (method !== "GET" && request.headers["x-fiv-admin"] !== "1") { send(response, 403, { error: "Missing header." }); return true; }
        const action = pathname.slice("/admin/api/".length).split("/").filter(Boolean);
        try {
            if (method === "POST" && action[0] === "login") {
                if (limited(ip)) { send(response, 429, { error: "Too many attempts. Try again in 15 minutes." }); return true; }
                const body = await readBody(request);
                const admin = findAdmin(body.username || "admin");
                // check a hash even for an unknown name, so the answer takes the same time
                const valid = checkPassword(body.password, admin?.hash ?? hashPassword("x"));
                if (!admin || !valid) { send(response, 401, { error: "Wrong username or password." }); return true; }
                attempts.delete(ip);
                const token = randomBytes(32).toString("base64url");
                sessions.set(token, { expires: now() + SESSION_TTL, username: admin.username });
                if (Array.isArray(store.settings.admins)) { admin.lastLogin = now(); store.save(); }
                send(response, 200, { ok: true }, { "set-cookie": `${COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}` });
                return true;
            }
            const token = session(request);
            if (!token) { send(response, 401, { error: "Log in first." }); return true; }
            if (method === "POST" && action[0] === "logout") {
                sessions.delete(token);
                send(response, 200, { ok: true }, { "set-cookie": `${COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
                return true;
            }
            const result = await api(method, action, request, response, token);
            if (result !== undefined) send(response, 200, result);
        } catch (error) {
            if (!response.headersSent) send(response, error?.status ?? 500, { error: error?.status ? error.message : "Server error." });
        }
        return true;
    };
}

const STYLE = `:root{color-scheme:dark;--bg:#111214;--panel:#1e1f22;--line:#2e3035;--text:#dbdee1;--muted:#949ba4;--brand:#5865f2;--ok:#23a55a;--bad:#f23f43;--warn:#f0b232}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif}
main{max-width:1200px;margin:0 auto;padding:52px 16px 24px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 12px}h3{font-size:15px;margin:16px 0 8px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.space{justify-content:space-between}.stack{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px;overflow-x:auto}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}.grid2 .card{margin:0}
.narrow{max-width:360px;margin:15vh auto;display:flex;flex-direction:column;gap:10px}
input{background:var(--bg);border:1px solid var(--line);border-radius:6px;color:var(--text);padding:9px;font:inherit}
button{background:var(--brand);color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}button.small{padding:3px 10px;font-size:13px}
button.danger{background:transparent;border:1px solid var(--bad);color:var(--bad)}button.on{background:var(--warn);color:#111}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.tabs button{background:transparent;border:1px solid var(--line);color:var(--muted)}.tabs button.active{background:var(--panel);color:var(--text);border-color:var(--brand)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}.tile b{display:block;font-size:26px}.tile span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:start;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:middle}th{color:var(--muted);font-weight:500}
tr.pick{cursor:pointer}tr.pick:hover{background:#26282c}
code{font-family:ui-monospace,Consolas,monospace;font-size:13px;direction:ltr;unicode-bidi:embed}.wrap{white-space:normal;word-break:break-all}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-inline-end:6px}.dot.on{background:var(--ok)}
.status-ok{color:var(--ok)}.status-warn{color:var(--warn)}.status-bad{color:var(--bad)}
.banner{background:#3a2e10;border:1px solid var(--warn);color:var(--warn);border-radius:8px;padding:10px 14px}
label.check{display:inline-flex;gap:4px;align-items:center;margin-inline-end:10px}
.lang{position:fixed;top:12px;inset-inline-end:12px;z-index:5;padding:5px 12px;font-size:13px}
textarea#raw{width:100%;min-height:60vh;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:12px;font:13px/1.45 ui-monospace,Consolas,monospace;resize:vertical}
.button-like{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:8px 14px;cursor:pointer}.narrow-form{max-width:420px}
.muted{color:var(--muted)}.error{color:var(--bad);min-height:1.5em;margin:0}.foot{text-align:center;font-size:13px}.danger-zone{border-color:#5c2427}`;
