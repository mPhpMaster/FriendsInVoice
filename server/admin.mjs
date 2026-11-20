// Admin dashboard for the guard server: /admin. Full control of the server's own data and settings: accounts,
// pairings, codes, event queues, the request log, maintenance mode, backup, password, restart and wipe.
// It never contacts Discord. Token hashes appear only in the backup file.
// Login: one password, stored only as an scrypt hash (ADMIN_PASSWORD_HASH, or a newer one set from the dashboard).

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

export function createAdmin({ store, passwordHash, version = "dev", dataFile, stats, now = Date.now, restart = () => process.exit(0) }) {
    const sessions = new Map();
    const attempts = new Map();
    const startedAt = now();
    const currentHash = () => store.settings?.adminPasswordHash || passwordHash;

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
                requestsLastHour: stats?.lastHour() ?? null, errorsLastHour: stats?.errorsLastHour() ?? null, sessions: sessions.size,
                passwordFromDashboard: !!store.settings?.adminPasswordHash },
            ...store.adminOverview(),
        };
    }

    async function api(method, action, request, response, token) {
        const body = method === "GET" || method === "DELETE" ? {} : await readJson(request);
        const [section, target, sub] = action;
        if (method === "GET" && section === "overview") return overview();
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
            if (!checkPassword(body.current, currentHash())) throw Object.assign(new Error("The current password is wrong."), { status: 403 });
            if (typeof body.next !== "string" || body.next.length < 10 || body.next.length > 200) throw Object.assign(new Error("The new password needs at least 10 characters."), { status: 400 });
            store.settings.adminPasswordHash = hashPassword(body.next);
            store.save();
            for (const other of sessions.keys()) if (other !== token) sessions.delete(other);
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
        if (!currentHash()) { send(response, 503, { error: "The admin dashboard is off. Set ADMIN_PASSWORD_HASH." }); return true; }
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
                if (!checkPassword(body.password, currentHash())) { send(response, 401, { error: "Wrong password." }); return true; }
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
            const result = await api(method, action, request, response, token);
            if (result !== undefined) send(response, 200, result);
        } catch (error) {
            if (!response.headersSent) send(response, error?.status ?? 500, { error: error?.status ? error.message : "Server error." });
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
    <div class="row"><span id="updated" class="muted"></span><button id="refresh" class="ghost">تحديث</button><button id="logout" class="ghost">خروج</button></div>
  </header>
  <p id="banner" class="banner" hidden>⚠️ وضع الصيانة شغّال: الـ API موقوف والإضافات ما تقدر تتصل.</p>
  <section id="tiles" class="tiles"></section>
  <nav class="tabs" id="tabs">
    <button data-tab="pairs" class="active">الربطات</button>
    <button data-tab="accounts">الحسابات</button>
    <button data-tab="codes">الأكواد</button>
    <button data-tab="logs">سجل الطلبات</button>
    <button data-tab="control">التحكم بالسيرفر</button>
  </nav>
  <section class="card tab" id="tab-pairs"><h2>الربطات (مالك ← حارس)</h2><div id="pairs"></div></section>
  <section class="card tab" id="tab-accounts" hidden>
    <div class="row space"><h2>الحسابات</h2><input id="account-search" type="search" placeholder="بحث بـ Discord ID"></div>
    <div id="accounts"></div>
    <div id="account-detail"></div>
  </section>
  <section class="card tab" id="tab-codes" hidden><h2>الأكواد المفتوحة</h2><div id="codes"></div></section>
  <section class="card tab" id="tab-logs" hidden>
    <div class="row space"><h2>آخر 300 طلب على الـ API</h2><button id="clear-logs" class="ghost">مسح السجل</button></div>
    <div id="logs"></div>
  </section>
  <section class="tab" id="tab-control" hidden>
    <div class="grid2">
      <div class="card"><h2>الحالة</h2><div id="server"></div></div>
      <div class="card"><h2>وضع الصيانة</h2><p class="muted">يوقف الـ API مؤقتاً (الإضافات تستلم 503 وتعيد المحاولة لاحقاً). اللوحة والصفحة الرئيسية تظل شغالة.</p>
        <button id="maintenance"></button></div>
      <div class="card"><h2>نسخة احتياطية</h2><p class="muted">ملف JSON بكل البيانات (يشمل هاشات التوكنات، فاحفظه بمكان آمن).</p>
        <button id="backup">تحميل نسخة احتياطية</button></div>
      <div class="card"><h2>إعادة تشغيل</h2><p class="muted">يحفظ البيانات ويعيد تشغيل الخدمة. الإضافات تعيد الاتصال تلقائياً.</p>
        <button id="restart" class="ghost">إعادة تشغيل السيرفر</button></div>
      <div class="card"><h2>كلمة السر</h2>
        <form id="password-form" class="stack">
          <input id="pw-current" type="password" placeholder="كلمة السر الحالية" autocomplete="current-password" required>
          <input id="pw-next" type="password" placeholder="كلمة السر الجديدة (10 خانات أو أكثر)" autocomplete="new-password" minlength="10" required>
          <button type="submit">تغيير</button>
        </form>
        <button id="sessions" class="ghost">تسجيل خروج كل الأجهزة الثانية</button></div>
      <div class="card danger-zone"><h2>حذف كل البيانات</h2><p class="muted">يحذف كل الحسابات والربطات والأكواد. الإضافات تسجّل من جديد، بس كل الحرّاس لازم يتربطون من أول.</p>
        <button id="wipe" class="danger">حذف كل شي</button></div>
    </div>
  </section>
  <p class="muted foot">اللوحة تتحكم ببيانات هذا السيرفر بس. ما تتصل بديسكورد، وما تعرض توكنات.</p>
</main>
<script src="/admin/app.js"></script>
</body>
</html>`;

const STYLE = `:root{color-scheme:dark;--bg:#111214;--panel:#1e1f22;--line:#2e3035;--text:#dbdee1;--muted:#949ba4;--brand:#5865f2;--ok:#23a55a;--bad:#f23f43;--warn:#f0b232}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 12px}h3{font-size:15px;margin:16px 0 8px}
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
.muted{color:var(--muted)}.error{color:var(--bad);min-height:1.5em;margin:0}.foot{text-align:center;font-size:13px}.danger-zone{border-color:#5c2427}`;

const SCRIPT = `"use strict";
const $ = id => document.getElementById(id);
const ACTIONS = { mute: "كتم", deafen: "صم", disconnect: "فصل" };
const ACTION_KEYS = Object.keys(ACTIONS);
let timer, data, tab = "pairs", selected = null;

async function api(method, path, body) {
  const response = await fetch("/admin/api/" + path, { method, credentials: "same-origin",
    headers: { "content-type": "application/json", "x-fiv-admin": "1" }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "login") { show(false); throw new Error(json.error || "401"); }
  if (!response.ok) throw new Error(json.error || ("HTTP " + response.status));
  return json;
}
const act = async (method, path, body, question) => {
  if (question && !confirm(question)) return false;
  try { await api(method, path, body); await load(); return true; } catch (e) { alert(e.message); return false; }
};

function show(loggedIn) {
  $("login").hidden = loggedIn; $("app").hidden = !loggedIn;
  clearInterval(timer);
  if (loggedIn) { load(); timer = setInterval(load, 15000); } else $("password").focus();
}

const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (cls) node.className = cls; return node; };
const btn = (text, cls, onClick) => { const b = el("button", text, cls); b.addEventListener("click", event => { event.stopPropagation(); onClick(); }); return b; };
const when = ms => ms ? new Date(ms).toLocaleString("ar", { dateStyle: "short", timeStyle: "medium" }) : "—";
function ago(ms) {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "قبل " + s + " ث"; if (s < 3600) return "قبل " + Math.round(s / 60) + " د";
  if (s < 86400) return "قبل " + Math.round(s / 3600) + " س"; return "قبل " + Math.round(s / 86400) + " يوم";
}
const code = value => el("code", value || "—");
const listening = on => { const span = el("span"); span.append(el("span", "", "dot" + (on ? " on" : "")), on ? "متصل" : "لا"); return span; };
const actionsText = list => list.map(a => ACTIONS[a] || a).join("، ");

function table(target, headers, rows, empty, onRow) {
  const box = typeof target === "string" ? $(target) : target; box.replaceChildren();
  if (!rows.length) { box.append(el("p", empty, "muted")); return; }
  const t = el("table"), head = el("tr");
  for (const h of headers) head.append(el("th", h));
  const thead = el("thead"); thead.append(head); t.append(thead);
  const tbody = el("tbody");
  rows.forEach((cells, index) => {
    const tr = el("tr", undefined, onRow ? "pick" : "");
    if (onRow) tr.addEventListener("click", () => onRow(index));
    for (const c of cells) { const td = el("td"); td.append(c instanceof Node ? c : document.createTextNode(String(c))); tr.append(td); }
    tbody.append(tr);
  });
  t.append(tbody); box.append(t);
}

function actionEditor(pair) {
  const wrap = el("span");
  const boxes = ACTION_KEYS.map(key => {
    const label = el("label", undefined, "check"), box = el("input"); box.type = "checkbox"; box.checked = pair.actions.includes(key);
    label.append(box, ACTIONS[key]); wrap.append(label); return [key, box];
  });
  wrap.append(btn("حفظ", "small", () => {
    const actions = boxes.filter(([, box]) => box.checked).map(([key]) => key);
    if (!actions.length) { alert("اختر صلاحية وحدة على الأقل، أو احذف الربط."); return; }
    act("PATCH", "pairs/" + pair.id, { actions });
  }));
  return wrap;
}

function renderPairs() {
  table("pairs", ["المالك", "الحارس", "الصلاحيات (عدّل واحفظ)", "المالك متصل", "من", ""], data.pairs.map(p => [code(p.ownerId), code(p.guardianId),
    actionEditor(p), listening(p.ownerListening), when(p.createdAt),
    btn("حذف", "danger small", () => act("DELETE", "pairs/" + p.id, null, "حذف هذا الربط؟ الحارس ما بيقدر يستخدمه بعدها."))]), "ما فيه ربطات.");
}

function renderCodes() {
  table("codes", ["الكود", "المالك", "الحارس", "الصلاحيات", "ينتهي", ""], data.codes.map(c => [code(c.code.slice(0, 4) + "-" + c.code.slice(4)),
    code(c.ownerId), code(c.guardianId), actionsText(c.actions), when(c.expiresAt),
    btn("إلغاء", "danger small", () => act("DELETE", "codes/" + c.code, null, "إلغاء هذا الكود؟"))]), "ما فيه أكواد مفتوحة.");
}

function renderAccounts() {
  const query = $("account-search").value.trim();
  const list = data.accounts.filter(a => !query || a.discordId.includes(query));
  table("accounts", ["Discord ID", "الربطات", "أحداث بالانتظار", "آخر ظهور", "متصل", "سجّل", ""], list.map(a => [code(a.discordId), a.pairs, a.queued,
    ago(a.lastSeen), listening(a.listening), when(a.createdAt),
    btn("حذف", "danger small", () => act("DELETE", "accounts/" + a.id, null, "حذف هذا الحساب وكل ربطاته؟ الإضافة بتسجّل من جديد بس الحرّاس لازم يتربطون من أول."))]),
    "ما فيه حسابات.", index => { selected = list[index].id; renderDetail(); });
  renderDetail();
}

async function renderDetail() {
  const box = $("account-detail"); box.replaceChildren();
  const account = data.accounts.find(a => a.id === selected);
  if (!account) { if (data.accounts.length) box.append(el("p", "اضغط على حساب لتشوف تفاصيله.", "muted")); return; }
  box.append(el("h3", "تفاصيل " + account.discordId));
  const info = el("div", undefined, "stack");
  const pk = el("div"); pk.append(el("span", "المفتاح العام: ", "muted"), el("code", account.publicKey, "wrap"));
  const internal = el("div"); internal.append(el("span", "المعرّف الداخلي: ", "muted"), code(account.id));
  info.append(internal, pk); box.append(info);
  const pairs = data.pairs.filter(p => p.owner === account.id || p.guardian === account.id);
  const pairBox = el("div"); box.append(el("h3", "ربطاته"), pairBox);
  table(pairBox, ["الدور", "الطرف الثاني", "الصلاحيات"], pairs.map(p => [p.owner === account.id ? "مالك" : "حارس",
    code(p.owner === account.id ? p.guardianId : p.ownerId), actionsText(p.actions)]), "ما عنده ربطات.");
  const head = el("div", undefined, "row space"); head.append(el("h3", "الأحداث بالانتظار"),
    btn("مسح الأحداث", "ghost small", () => act("DELETE", "accounts/" + account.id + "/events", null, "مسح كل الأحداث اللي تنتظر هذا الحساب؟")));
  const eventsBox = el("div"); box.append(head, eventsBox);
  try {
    const events = await api("GET", "accounts/" + account.id + "/events");
    const names = { command: "أمر حارس", pairs: "تغيير ربطات", refused: "رفض دعوة" };
    table(eventsBox, ["#", "النوع", "من", "الوقت", "ينتهي", "المحتوى"], events.map(e => [e.seq, names[e.type] || e.type, code(e.from || e.guardianId),
      when(e.at), when(e.expiresAt), e.encrypted ? "مشفّر (السيرفر ما يقدر يقراه)" : "—"]), "ما فيه أحداث.");
  } catch (e) { eventsBox.append(el("p", e.message, "error")); }
}

async function renderLogs() {
  let logs = [];
  try { logs = await api("GET", "logs"); } catch { return; }
  table("logs", ["الوقت", "IP", "الطلب", "الحالة", "المدة", "الحساب"], logs.map(l => [when(l.at), code(l.ip), code(l.method + " " + l.path),
    el("span", String(l.status), l.status < 400 ? "status-ok" : l.status < 500 ? "status-warn" : "status-bad"), l.ms + " ms", code(l.discordId)]), "ما فيه طلبات مسجّلة.");
}

function renderControl() {
  const s = data.server;
  table("server", ["", ""], [["الإصدار", s.version], ["Node", s.node], ["شغال من", ago(s.startedAt) + " (" + when(s.startedAt) + ")"],
    ["الذاكرة", s.memoryMb + " MB"], ["حجم البيانات", s.dataSize == null ? "—" : (s.dataSize / 1024).toFixed(1) + " KB"],
    ["طلبات آخر ساعة", s.requestsLastHour ?? "—"], ["أخطاء آخر ساعة", s.errorsLastHour ?? "—"], ["أحداث بالانتظار", data.queued],
    ["اتصالات مفتوحة الحين", data.waiting], ["جلسات اللوحة", s.sessions], ["كلمة السر", s.passwordFromDashboard ? "متغيّرة من اللوحة" : "من ملف السيرفر"]], "");
  const m = $("maintenance");
  m.textContent = data.settings.maintenance ? "إيقاف وضع الصيانة" : "تشغيل وضع الصيانة";
  m.className = data.settings.maintenance ? "on" : "ghost";
}

function render() {
  $("banner").hidden = !data.settings.maintenance;
  const live = data.accounts.filter(a => a.lastSeen && Date.now() - a.lastSeen < 86400000).length;
  const tiles = [["الحسابات", data.accounts.length], ["نشطة آخر 24 ساعة", live], ["الربطات", data.pairs.length],
    ["أكواد مفتوحة", data.codes.length], ["متصلين الحين", data.waiting], ["طلبات آخر ساعة", data.server.requestsLastHour ?? "—"]];
  $("tiles").replaceChildren(...tiles.map(([label, value]) => { const t = el("div", undefined, "tile"); t.append(el("b", String(value)), el("span", label)); return t; }));
  if (tab === "pairs") renderPairs();
  if (tab === "accounts") renderAccounts();
  if (tab === "codes") renderCodes();
  if (tab === "logs") renderLogs();
  if (tab === "control") renderControl();
  $("updated").textContent = "آخر تحديث " + new Date().toLocaleTimeString("ar");
}

async function load() {
  // don't redraw under the cursor while typing or ticking boxes
  const active = document.activeElement;
  if (data && active && ["INPUT", "SELECT"].includes(active.tagName) && active.id !== "account-search") return;
  try { data = await api("GET", "overview"); } catch { return; }
  render();
}

for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => {
  tab = b.dataset.tab;
  for (const other of document.querySelectorAll("#tabs button")) other.classList.toggle("active", other === b);
  for (const section of document.querySelectorAll(".tab")) section.hidden = section.id !== "tab-" + tab;
  if (data) render();
});
$("account-search").addEventListener("input", () => data && renderAccounts());
$("clear-logs").addEventListener("click", () => act("DELETE", "logs", null, "مسح سجل الطلبات؟"));
$("maintenance").addEventListener("click", () => act("POST", "settings", { maintenance: !data.settings.maintenance },
  data.settings.maintenance ? null : "تشغيل وضع الصيانة؟ الإضافات ما بتقدر تستخدم الحرّاس لين توقفه."));
$("backup").addEventListener("click", () => { location.href = "/admin/api/backup"; });
$("restart").addEventListener("click", async () => {
  if (!confirm("إعادة تشغيل السيرفر الحين؟")) return;
  try { await api("POST", "restart"); } catch {}
  $("updated").textContent = "يعيد التشغيل…"; setTimeout(load, 4000);
});
$("sessions").addEventListener("click", () => act("POST", "sessions", null, "تسجيل خروج كل الأجهزة الثانية من اللوحة؟"));
$("wipe").addEventListener("click", () => {
  const typed = prompt("هذا يحذف كل الحسابات والربطات والأكواد ولا يمكن التراجع. اكتب WIPE للتأكيد:");
  if (typed === "WIPE") act("POST", "wipe", { confirm: "WIPE" });
});
$("password-form").addEventListener("submit", async event => {
  event.preventDefault();
  try { await api("POST", "password", { current: $("pw-current").value, next: $("pw-next").value }); alert("تغيّرت كلمة السر. الأجهزة الثانية انطردت من اللوحة."); $("pw-current").value = $("pw-next").value = ""; load(); }
  catch (e) { alert(e.message === "The current password is wrong." ? "كلمة السر الحالية غلط." : e.message); }
});
$("login-form").addEventListener("submit", async event => {
  event.preventDefault(); $("login-error").textContent = "";
  try { await api("POST", "login", { password: $("password").value }); $("password").value = ""; show(true); }
  catch (e) { $("login-error").textContent = e.message === "Wrong password." ? "كلمة السر غلط." : e.message; }
});
$("logout").addEventListener("click", async () => { try { await api("POST", "logout"); } catch {} show(false); });
$("refresh").addEventListener("click", () => { data = null; load(); });
api("GET", "overview").then(() => show(true), () => show(false));
`;
