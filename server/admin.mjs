// Admin dashboard for the guard server: /admin. Shows server health, accounts, pairings and open codes, and
// can remove a pairing or an account. It never contacts Discord and never shows tokens or token hashes.
// Login: one password, stored only as an scrypt hash (ADMIN_PASSWORD_HASH). Without it the dashboard is off.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";

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

export function createAdmin({ store, passwordHash, version = "dev", dataFile, stats, now = Date.now }) {
    const sessions = new Map();
    const attempts = new Map();
    const startedAt = now();

    function session(request) {
        const token = cookies(request)[COOKIE];
        const expires = token && sessions.get(token);
        if (!expires || expires < now()) { if (token) sessions.delete(token); return null; }
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
                requestsLastHour: stats?.lastHour() ?? null, errorsLastHour: stats?.errorsLastHour() ?? null },
            ...store.adminOverview(),
        };
    }

    /** Returns true when the request was for the dashboard */
    return async function handle(request, response, url, ip, readBody) {
        const { pathname } = url;
        if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
        if (!passwordHash) { send(response, 503, { error: "The admin dashboard is off. Set ADMIN_PASSWORD_HASH." }); return true; }
        const method = request.method;
        if (method === "GET" && (pathname === "/admin" || pathname === "/admin/")) { send(response, 200, PAGE); return true; }
        if (method === "GET" && pathname === "/admin/app.js") { send(response, 200, SCRIPT, { "content-type": "text/javascript; charset=utf-8" }); return true; }
        if (method === "GET" && pathname === "/admin/app.css") { send(response, 200, STYLE, { "content-type": "text/css; charset=utf-8" }); return true; }
        if (!pathname.startsWith("/admin/api/")) { send(response, 404, { error: "Not found." }); return true; }
        // the page sends this header; a form or link from another site can't
        if (method !== "GET" && request.headers["x-fiv-admin"] !== "1") { send(response, 403, { error: "Missing header." }); return true; }
        const action = pathname.slice("/admin/api/".length).split("/");
        try {
            if (method === "POST" && action[0] === "login") {
                if (limited(ip)) { send(response, 429, { error: "Too many attempts. Try again in 15 minutes." }); return true; }
                const body = await readBody(request);
                if (!checkPassword(body.password, passwordHash)) { send(response, 401, { error: "Wrong password." }); return true; }
                attempts.delete(ip);
                const token = randomBytes(32).toString("base64url");
                sessions.set(token, now() + SESSION_TTL);
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
            if (method === "GET" && action[0] === "overview") { send(response, 200, overview()); return true; }
            if (method === "DELETE" && action[0] === "pairs" && action[1]) { store.adminDeletePair(action[1]); send(response, 200, { ok: true }); return true; }
            if (method === "DELETE" && action[0] === "accounts" && action[1]) { store.adminDeleteAccount(action[1]); send(response, 200, { ok: true }); return true; }
            send(response, 404, { error: "Not found." });
        } catch (error) {
            send(response, error?.status ?? 500, { error: error?.status ? error.message : "Server error." });
        }
        return true;
    };
}

const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>لوحة Friends in Voice</title>
<link rel="stylesheet" href="/admin/app.css">
</head>
<body>
<main id="login" hidden>
  <form id="login-form" class="card narrow">
    <h1>🛡️ لوحة Friends in Voice</h1>
    <label for="password">كلمة السر</label>
    <input id="password" type="password" autocomplete="current-password" required>
    <button type="submit">دخول</button>
    <p id="login-error" class="error" role="alert"></p>
  </form>
</main>
<main id="app" hidden>
  <header>
    <h1>🛡️ لوحة Friends in Voice</h1>
    <div class="head-actions"><span id="updated" class="muted"></span><button id="refresh" class="ghost">تحديث</button><button id="logout" class="ghost">خروج</button></div>
  </header>
  <section id="tiles" class="tiles"></section>
  <section class="card"><h2>الربطات (مالك ← حارس)</h2><div id="pairs"></div></section>
  <section class="card"><h2>الأكواد المفتوحة</h2><div id="codes"></div></section>
  <section class="card"><h2>الحسابات</h2><div id="accounts"></div></section>
  <section class="card"><h2>السيرفر</h2><div id="server"></div></section>
  <p class="muted foot">اللوحة تقرأ من هذا السيرفر بس. ما تتصل بديسكورد، وما تعرض أي توكن.</p>
</main>
<script src="/admin/app.js"></script>
</body>
</html>`;

const STYLE = `:root{color-scheme:dark;--bg:#111214;--panel:#1e1f22;--line:#2e3035;--text:#dbdee1;--muted:#949ba4;--brand:#5865f2;--ok:#23a55a;--bad:#f23f43}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 12px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:20px}
.head-actions{display:flex;gap:8px;align-items:center}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px;overflow-x:auto}
.narrow{max-width:360px;margin:15vh auto;display:flex;flex-direction:column;gap:10px}
input{background:var(--bg);border:1px solid var(--line);border-radius:6px;color:var(--text);padding:10px;font:inherit}
button{background:var(--brand);color:#fff;border:0;border-radius:6px;padding:9px 14px;font:inherit;cursor:pointer}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}button.danger{background:transparent;border:1px solid var(--bad);color:var(--bad);padding:4px 10px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}.tile b{display:block;font-size:26px}.tile span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:start;padding:8px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-weight:500}
code{font-family:ui-monospace,Consolas,monospace;font-size:13px;direction:ltr;unicode-bidi:embed}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-inline-end:6px}.dot.on{background:var(--ok)}
.muted{color:var(--muted)}.error{color:var(--bad);min-height:1.5em;margin:0}.foot{text-align:center;font-size:13px}`;

const SCRIPT = `"use strict";
const $ = id => document.getElementById(id);
const ACTIONS = { mute: "كتم", deafen: "صم", disconnect: "فصل" };
let timer;

async function api(method, path, body) {
  const response = await fetch("/admin/api/" + path, { method, credentials: "same-origin",
    headers: { "content-type": "application/json", "x-fiv-admin": "1" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "login") { show(false); throw new Error(data.error || "401"); }
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}

function show(loggedIn) {
  $("login").hidden = loggedIn; $("app").hidden = !loggedIn;
  clearInterval(timer);
  if (loggedIn) { load(); timer = setInterval(load, 15000); } else $("password").focus();
}

const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const when = ms => ms ? new Date(ms).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "—";
function ago(ms) {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "قبل " + s + " ث"; if (s < 3600) return "قبل " + Math.round(s / 60) + " د";
  if (s < 86400) return "قبل " + Math.round(s / 3600) + " س"; return "قبل " + Math.round(s / 86400) + " يوم";
}
const id = value => { const node = el("code", value || "—"); return node; };
const listening = on => { const span = el("span"); span.append(el("span", "", "dot" + (on ? " on" : "")), on ? "يستمع" : "لا"); return span; };

function table(target, headers, rows, empty) {
  const box = $(target); box.replaceChildren();
  if (!rows.length) { box.append(el("p", empty, "muted")); return; }
  const t = el("table"), head = el("tr");
  for (const h of headers) head.append(el("th", h));
  const thead = el("thead"); thead.append(head); t.append(thead);
  const tbody = el("tbody");
  for (const cells of rows) { const tr = el("tr"); for (const c of cells) { const td = el("td"); td.append(c instanceof Node ? c : document.createTextNode(String(c))); tr.append(td); } tbody.append(tr); }
  t.append(tbody); box.append(t);
}

function removeButton(label, question, path) {
  const b = el("button", label, "danger");
  b.addEventListener("click", async () => { if (!confirm(question)) return; try { await api("DELETE", path); load(); } catch (e) { alert(e.message); } });
  return b;
}

async function load() {
  let data;
  try { data = await api("GET", "overview"); } catch { return; }
  const live = data.accounts.filter(a => a.lastSeen && Date.now() - a.lastSeen < 86400000).length;
  const tiles = [["الحسابات", data.accounts.length], ["نشطة آخر 24 ساعة", live], ["الربطات", data.pairs.length],
    ["أكواد مفتوحة", data.codes.length], ["يستمعون الآن", data.waiting], ["طلبات آخر ساعة", data.server.requestsLastHour ?? "—"]];
  $("tiles").replaceChildren(...tiles.map(([label, value]) => { const t = el("div", undefined, "tile"); t.append(el("b", String(value)), el("span", label)); return t; }));
  table("pairs", ["المالك", "الحارس", "الصلاحيات", "المالك يستمع", "من", ""], data.pairs.map(p => [id(p.ownerId), id(p.guardianId),
    p.actions.map(a => ACTIONS[a] || a).join("، "), listening(p.ownerListening), when(p.createdAt),
    removeButton("حذف", "حذف هذا الربط؟ الحارس ما بيقدر يستخدمه بعدها.", "pairs/" + p.id)]), "ما فيه ربطات.");
  table("codes", ["الكود", "المالك", "الحارس", "الصلاحيات", "ينتهي"], data.codes.map(c => [id(c.code), id(c.ownerId), id(c.guardianId),
    c.actions.map(a => ACTIONS[a] || a).join("، "), when(c.expiresAt)]), "ما فيه أكواد مفتوحة.");
  table("accounts", ["Discord ID", "الربطات", "آخر ظهور", "يستمع", "سجّل", ""], data.accounts.map(a => [id(a.discordId), a.pairs, ago(a.lastSeen),
    listening(a.listening), when(a.createdAt), removeButton("حذف", "حذف هذا الحساب وكل ربطاته؟ لازم يسجّل البلقن من جديد.", "accounts/" + a.id)]), "ما فيه حسابات.");
  const s = data.server;
  table("server", ["الإصدار", "Node", "شغال من", "الذاكرة", "حجم البيانات", "أحداث بالانتظار", "أخطاء آخر ساعة"],
    [[s.version, s.node, ago(s.startedAt), s.memoryMb + " MB", s.dataSize == null ? "—" : (s.dataSize / 1024).toFixed(1) + " KB", data.queued, s.errorsLastHour ?? "—"]], "");
  $("updated").textContent = "آخر تحديث " + new Date().toLocaleTimeString("ar");
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault(); $("login-error").textContent = "";
  try { await api("POST", "login", { password: $("password").value }); $("password").value = ""; show(true); }
  catch (e) { $("login-error").textContent = e.message === "Wrong password." ? "كلمة السر غلط." : e.message; }
});
$("logout").addEventListener("click", async () => { try { await api("POST", "logout"); } catch {} show(false); });
$("refresh").addEventListener("click", load);
api("GET", "overview").then(() => show(true), () => show(false));
`;
