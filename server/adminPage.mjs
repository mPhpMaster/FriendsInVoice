// The dashboard's HTML and browser script. English by default; the language button switches to Arabic
// (right to left) and the choice is remembered in this browser.

export const PAGE = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Friends in Voice admin</title>
<link rel="stylesheet" href="/admin/app.css">
</head>
<body>
<button class="lang ghost" data-lang-toggle>العربية</button>
<main id="login" hidden>
  <form id="login-form" class="card narrow">
    <h1>🛡️ <span data-i18n="title"></span></h1>
    <label for="password" data-i18n="password"></label>
    <input id="password" type="password" autocomplete="current-password" required>
    <button type="submit" data-i18n="login"></button>
    <p id="login-error" class="error" role="alert"></p>
  </form>
</main>
<main id="app" hidden>
  <header>
    <h1>🛡️ <span data-i18n="title"></span></h1>
    <div class="row"><span id="updated" class="muted"></span><button id="refresh" class="ghost" data-i18n="refresh"></button><button id="logout" class="ghost" data-i18n="logout"></button></div>
  </header>
  <p id="banner" class="banner" hidden data-i18n="maintenanceBanner"></p>
  <section id="tiles" class="tiles"></section>
  <nav class="tabs" id="tabs">
    <button data-tab="pairs" class="active" data-i18n="tabPairs"></button>
    <button data-tab="accounts" data-i18n="tabAccounts"></button>
    <button data-tab="codes" data-i18n="tabCodes"></button>
    <button data-tab="logs" data-i18n="tabLogs"></button>
    <button data-tab="control" data-i18n="tabControl"></button>
  </nav>
  <section class="card tab" id="tab-pairs"><h2 data-i18n="pairsTitle"></h2><div id="pairs"></div></section>
  <section class="card tab" id="tab-accounts" hidden>
    <div class="row space"><h2 data-i18n="tabAccounts"></h2><input id="account-search" type="search" data-i18n-placeholder="searchDiscordId"></div>
    <div id="accounts"></div>
    <div id="account-detail"></div>
  </section>
  <section class="card tab" id="tab-codes" hidden><h2 data-i18n="codesTitle"></h2><div id="codes"></div></section>
  <section class="card tab" id="tab-logs" hidden>
    <div class="row space"><h2 data-i18n="logsTitle"></h2><button id="clear-logs" class="ghost" data-i18n="clearLog"></button></div>
    <div id="logs"></div>
  </section>
  <section class="tab" id="tab-control" hidden>
    <div class="grid2">
      <div class="card"><h2 data-i18n="status"></h2><div id="server"></div></div>
      <div class="card"><h2 data-i18n="maintenance"></h2><p class="muted" data-i18n="maintenanceHelp"></p><button id="maintenance"></button></div>
      <div class="card"><h2 data-i18n="backup"></h2><p class="muted" data-i18n="backupHelp"></p><button id="backup" data-i18n="downloadBackup"></button></div>
      <div class="card"><h2 data-i18n="restart"></h2><p class="muted" data-i18n="restartHelp"></p><button id="restart" class="ghost" data-i18n="restartButton"></button></div>
      <div class="card"><h2 data-i18n="password"></h2>
        <form id="password-form" class="stack">
          <input id="pw-current" type="password" data-i18n-placeholder="currentPassword" autocomplete="current-password" required>
          <input id="pw-next" type="password" data-i18n-placeholder="newPassword" autocomplete="new-password" minlength="10" required>
          <button type="submit" data-i18n="change"></button>
        </form>
        <button id="sessions" class="ghost" data-i18n="signOutOthers"></button></div>
      <div class="card danger-zone"><h2 data-i18n="wipeTitle"></h2><p class="muted" data-i18n="wipeHelp"></p><button id="wipe" class="danger" data-i18n="wipeButton"></button></div>
    </div>
  </section>
  <p class="muted foot" data-i18n="footer"></p>
</main>
<script src="/admin/app.js"></script>
</body>
</html>`;

export const SCRIPT = `"use strict";
const STRINGS = {
  en: {
    title: "Friends in Voice admin", password: "Password", login: "Log in", refresh: "Refresh", logout: "Log out",
    maintenanceBanner: "⚠️ Maintenance mode is on: the API is stopped and plugins can't connect.",
    tabPairs: "Pairings", tabAccounts: "Accounts", tabCodes: "Codes", tabLogs: "Request log", tabControl: "Server control",
    pairsTitle: "Pairings (owner → guardian)", searchDiscordId: "Search by Discord ID", codesTitle: "Open invite codes",
    logsTitle: "Last 300 API requests", clearLog: "Clear log", status: "Status", maintenance: "Maintenance mode",
    maintenanceHelp: "Pauses the API (plugins get 503 and retry later). This dashboard and the home page keep working.",
    backup: "Backup", backupHelp: "A JSON file with all data, including token hashes. Keep it somewhere safe.", downloadBackup: "Download backup",
    restart: "Restart", restartHelp: "Saves the data and restarts the service. Plugins reconnect by themselves.", restartButton: "Restart the server",
    currentPassword: "Current password", newPassword: "New password (10 characters or more)", change: "Change",
    signOutOthers: "Sign out all other devices", wipeTitle: "Delete all data",
    wipeHelp: "Deletes every account, pairing and code. Plugins register again, but every guard has to pair again.", wipeButton: "Delete everything",
    footer: "This dashboard controls this server's data only. It never contacts Discord and never shows tokens.",
    mute: "Mute", deafen: "Deafen", disconnect: "Disconnect",
    tiles: ["Accounts", "Active in 24 h", "Pairings", "Open codes", "Connected now", "Requests last hour"],
    owner: "Owner", guardian: "Guardian", actionsEdit: "Actions (edit and save)", ownerConnected: "Owner connected", since: "Since",
    save: "Save", delete: "Delete", cancel: "Cancel", connected: "Connected", no: "No", none: "—",
    pickOne: "Pick at least one action, or delete the pairing.",
    noPairs: "No pairings.", confirmDeletePair: "Delete this pairing? The guardian won't be able to use it any more.",
    code: "Code", actions: "Actions", expires: "Expires", noCodes: "No open codes.", confirmCancelCode: "Cancel this code?",
    pairsCol: "Pairings", queuedCol: "Queued events", lastSeen: "Last seen", registered: "Registered", noAccounts: "No accounts.",
    confirmDeleteAccount: "Delete this account and all its pairings? The plugin registers again, but its guards have to pair again.",
    clickAccount: "Click an account to see its details.", detailsOf: "Details of ", internalId: "Internal ID: ", publicKey: "Public key: ",
    itsPairings: "Its pairings", role: "Role", otherSide: "Other side", roleOwner: "Owner", roleGuardian: "Guardian", noPairsAccount: "No pairings.",
    queuedEvents: "Queued events", clearEvents: "Clear events", confirmClearEvents: "Clear every event waiting for this account?",
    type: "Type", from: "From", time: "Time", content: "Content", encrypted: "Encrypted (the server can't read it)", noEvents: "No events.",
    eventTypes: { command: "Guard command", pairs: "Pairings changed", refused: "Invite refused" },
    ip: "IP", request: "Request", statusCol: "Status", duration: "Duration", account: "Account", noLogs: "No requests logged yet.", confirmClearLog: "Clear the request log?",
    serverRows: ["Version", "Node", "Running since", "Memory", "Data size", "Requests last hour", "Errors last hour", "Queued events", "Open connections now", "Dashboard sessions", "Password"],
    passwordFromDashboard: "Changed in the dashboard", passwordFromFile: "From the server file",
    maintenanceOn: "Turn maintenance mode off", maintenanceOff: "Turn maintenance mode on",
    confirmMaintenance: "Turn on maintenance mode? Plugins can't use guards until you turn it off.",
    confirmRestart: "Restart the server now?", restarting: "Restarting…", confirmSignOut: "Sign out every other device from the dashboard?",
    wipePrompt: "This deletes every account, pairing and code and can't be undone. Type WIPE to confirm:",
    passwordChanged: "Password changed. Other devices were signed out.", wrongCurrent: "The current password is wrong.", wrongPassword: "Wrong password.",
    updated: "Updated ", ago: { s: "s ago", m: "min ago", h: "h ago", d: "d ago" }
  },
  ar: {
    title: "لوحة Friends in Voice", password: "كلمة السر", login: "دخول", refresh: "تحديث", logout: "خروج",
    maintenanceBanner: "⚠️ وضع الصيانة شغّال: الـ API موقوف والإضافات ما تقدر تتصل.",
    tabPairs: "الربطات", tabAccounts: "الحسابات", tabCodes: "الأكواد", tabLogs: "سجل الطلبات", tabControl: "التحكم بالسيرفر",
    pairsTitle: "الربطات (مالك ← حارس)", searchDiscordId: "بحث بـ Discord ID", codesTitle: "الأكواد المفتوحة",
    logsTitle: "آخر 300 طلب على الـ API", clearLog: "مسح السجل", status: "الحالة", maintenance: "وضع الصيانة",
    maintenanceHelp: "يوقف الـ API مؤقتاً (الإضافات تستلم 503 وتعيد المحاولة لاحقاً). اللوحة والصفحة الرئيسية تظل شغالة.",
    backup: "نسخة احتياطية", backupHelp: "ملف JSON بكل البيانات (يشمل هاشات التوكنات، فاحفظه بمكان آمن).", downloadBackup: "تحميل نسخة احتياطية",
    restart: "إعادة تشغيل", restartHelp: "يحفظ البيانات ويعيد تشغيل الخدمة. الإضافات تعيد الاتصال تلقائياً.", restartButton: "إعادة تشغيل السيرفر",
    currentPassword: "كلمة السر الحالية", newPassword: "كلمة السر الجديدة (10 خانات أو أكثر)", change: "تغيير",
    signOutOthers: "تسجيل خروج كل الأجهزة الثانية", wipeTitle: "حذف كل البيانات",
    wipeHelp: "يحذف كل الحسابات والربطات والأكواد. الإضافات تسجّل من جديد، بس كل الحرّاس لازم يتربطون من أول.", wipeButton: "حذف كل شي",
    footer: "اللوحة تتحكم ببيانات هذا السيرفر بس. ما تتصل بديسكورد، وما تعرض توكنات.",
    mute: "كتم", deafen: "صم", disconnect: "فصل",
    tiles: ["الحسابات", "نشطة آخر 24 ساعة", "الربطات", "أكواد مفتوحة", "متصلين الحين", "طلبات آخر ساعة"],
    owner: "المالك", guardian: "الحارس", actionsEdit: "الصلاحيات (عدّل واحفظ)", ownerConnected: "المالك متصل", since: "من",
    save: "حفظ", delete: "حذف", cancel: "إلغاء", connected: "متصل", no: "لا", none: "—",
    pickOne: "اختر صلاحية وحدة على الأقل، أو احذف الربط.",
    noPairs: "ما فيه ربطات.", confirmDeletePair: "حذف هذا الربط؟ الحارس ما بيقدر يستخدمه بعدها.",
    code: "الكود", actions: "الصلاحيات", expires: "ينتهي", noCodes: "ما فيه أكواد مفتوحة.", confirmCancelCode: "إلغاء هذا الكود؟",
    pairsCol: "الربطات", queuedCol: "أحداث بالانتظار", lastSeen: "آخر ظهور", registered: "سجّل", noAccounts: "ما فيه حسابات.",
    confirmDeleteAccount: "حذف هذا الحساب وكل ربطاته؟ الإضافة بتسجّل من جديد بس الحرّاس لازم يتربطون من أول.",
    clickAccount: "اضغط على حساب لتشوف تفاصيله.", detailsOf: "تفاصيل ", internalId: "المعرّف الداخلي: ", publicKey: "المفتاح العام: ",
    itsPairings: "ربطاته", role: "الدور", otherSide: "الطرف الثاني", roleOwner: "مالك", roleGuardian: "حارس", noPairsAccount: "ما عنده ربطات.",
    queuedEvents: "الأحداث بالانتظار", clearEvents: "مسح الأحداث", confirmClearEvents: "مسح كل الأحداث اللي تنتظر هذا الحساب؟",
    type: "النوع", from: "من", time: "الوقت", content: "المحتوى", encrypted: "مشفّر (السيرفر ما يقدر يقراه)", noEvents: "ما فيه أحداث.",
    eventTypes: { command: "أمر حارس", pairs: "تغيير ربطات", refused: "رفض دعوة" },
    ip: "IP", request: "الطلب", statusCol: "الحالة", duration: "المدة", account: "الحساب", noLogs: "ما فيه طلبات مسجّلة.", confirmClearLog: "مسح سجل الطلبات؟",
    serverRows: ["الإصدار", "Node", "شغال من", "الذاكرة", "حجم البيانات", "طلبات آخر ساعة", "أخطاء آخر ساعة", "أحداث بالانتظار", "اتصالات مفتوحة الحين", "جلسات اللوحة", "كلمة السر"],
    passwordFromDashboard: "متغيّرة من اللوحة", passwordFromFile: "من ملف السيرفر",
    maintenanceOn: "إيقاف وضع الصيانة", maintenanceOff: "تشغيل وضع الصيانة",
    confirmMaintenance: "تشغيل وضع الصيانة؟ الإضافات ما بتقدر تستخدم الحرّاس لين توقفه.",
    confirmRestart: "إعادة تشغيل السيرفر الحين؟", restarting: "يعيد التشغيل…", confirmSignOut: "تسجيل خروج كل الأجهزة الثانية من اللوحة؟",
    wipePrompt: "هذا يحذف كل الحسابات والربطات والأكواد ولا يمكن التراجع. اكتب WIPE للتأكيد:",
    passwordChanged: "تغيّرت كلمة السر. الأجهزة الثانية انطردت من اللوحة.", wrongCurrent: "كلمة السر الحالية غلط.", wrongPassword: "كلمة السر غلط.",
    updated: "آخر تحديث ", ago: { s: "ث", m: "د", h: "س", d: "يوم" }
  }
};
let lang = localStorage.getItem("fiv-lang") === "ar" ? "ar" : "en";
const T = () => STRINGS[lang];
const $ = id => document.getElementById(id);
const ACTION_KEYS = ["mute", "deafen", "disconnect"];
let timer, data, tab = "pairs", selected = null;

function applyLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = T().title;
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = T()[node.dataset.i18n];
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = T()[node.dataset.i18nPlaceholder];
  for (const node of document.querySelectorAll("[data-lang-toggle]")) node.textContent = lang === "ar" ? "English" : "العربية";
  if (data) render();
}
for (const node of document.querySelectorAll("[data-lang-toggle]")) node.addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  localStorage.setItem("fiv-lang", lang);
  applyLanguage();
});

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
  try { await api(method, path, body); await load(true); return true; } catch (e) { alert(e.message); return false; }
};

function show(loggedIn) {
  $("login").hidden = loggedIn; $("app").hidden = !loggedIn;
  clearInterval(timer);
  if (loggedIn) { load(true); timer = setInterval(load, 15000); } else $("password").focus();
}

const locale = () => lang === "ar" ? "ar" : "en-GB";
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (cls) node.className = cls; return node; };
const btn = (text, cls, onClick) => { const b = el("button", text, cls); b.addEventListener("click", event => { event.stopPropagation(); onClick(); }); return b; };
const when = ms => ms ? new Date(ms).toLocaleString(locale(), { dateStyle: "short", timeStyle: "medium" }) : "—";
function ago(ms) {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000), a = T().ago;
  const [n, unit] = s < 60 ? [s, a.s] : s < 3600 ? [Math.round(s / 60), a.m] : s < 86400 ? [Math.round(s / 3600), a.h] : [Math.round(s / 86400), a.d];
  return lang === "ar" ? "قبل " + n + " " + unit : n + " " + unit;
}
const code = value => el("code", value || "—");
const listening = on => { const span = el("span"); span.append(el("span", "", "dot" + (on ? " on" : "")), on ? T().connected : T().no); return span; };
const actionsText = list => list.map(a => T()[a] || a).join(lang === "ar" ? "، " : ", ");

function table(target, headers, rows, empty, onRow) {
  const box = typeof target === "string" ? $(target) : target; box.replaceChildren();
  if (!rows.length) { if (empty) box.append(el("p", empty, "muted")); return; }
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
    label.append(box, T()[key]); wrap.append(label); return [key, box];
  });
  wrap.append(btn(T().save, "small", () => {
    const actions = boxes.filter(([, box]) => box.checked).map(([key]) => key);
    if (!actions.length) { alert(T().pickOne); return; }
    act("PATCH", "pairs/" + pair.id, { actions });
  }));
  return wrap;
}

function renderPairs() {
  const t = T();
  table("pairs", [t.owner, t.guardian, t.actionsEdit, t.ownerConnected, t.since, ""], data.pairs.map(p => [code(p.ownerId), code(p.guardianId),
    actionEditor(p), listening(p.ownerListening), when(p.createdAt),
    btn(t.delete, "danger small", () => act("DELETE", "pairs/" + p.id, null, t.confirmDeletePair))]), t.noPairs);
}

function renderCodes() {
  const t = T();
  table("codes", [t.code, t.owner, t.guardian, t.actions, t.expires, ""], data.codes.map(c => [code(c.code.slice(0, 4) + "-" + c.code.slice(4)),
    code(c.ownerId), code(c.guardianId), actionsText(c.actions), when(c.expiresAt),
    btn(t.cancel, "danger small", () => act("DELETE", "codes/" + c.code, null, t.confirmCancelCode))]), t.noCodes);
}

function renderAccounts() {
  const t = T(), query = $("account-search").value.trim();
  const list = data.accounts.filter(a => !query || a.discordId.includes(query));
  table("accounts", ["Discord ID", t.pairsCol, t.queuedCol, t.lastSeen, t.connected, t.registered, ""], list.map(a => [code(a.discordId), a.pairs, a.queued,
    ago(a.lastSeen), listening(a.listening), when(a.createdAt),
    btn(t.delete, "danger small", () => act("DELETE", "accounts/" + a.id, null, t.confirmDeleteAccount))]),
    t.noAccounts, index => { selected = list[index].id; renderDetail(); });
  renderDetail();
}

async function renderDetail() {
  const t = T(), box = $("account-detail"); box.replaceChildren();
  const account = data.accounts.find(a => a.id === selected);
  if (!account) { if (data.accounts.length) box.append(el("p", t.clickAccount, "muted")); return; }
  box.append(el("h3", t.detailsOf + account.discordId));
  const info = el("div", undefined, "stack");
  const internal = el("div"); internal.append(el("span", t.internalId, "muted"), code(account.id));
  const pk = el("div"); pk.append(el("span", t.publicKey, "muted"), el("code", account.publicKey, "wrap"));
  info.append(internal, pk); box.append(info);
  const pairs = data.pairs.filter(p => p.owner === account.id || p.guardian === account.id);
  const pairBox = el("div"); box.append(el("h3", t.itsPairings), pairBox);
  table(pairBox, [t.role, t.otherSide, t.actions], pairs.map(p => [p.owner === account.id ? t.roleOwner : t.roleGuardian,
    code(p.owner === account.id ? p.guardianId : p.ownerId), actionsText(p.actions)]), t.noPairsAccount);
  const head = el("div", undefined, "row space"); head.append(el("h3", t.queuedEvents),
    btn(t.clearEvents, "ghost small", () => act("DELETE", "accounts/" + account.id + "/events", null, t.confirmClearEvents)));
  const eventsBox = el("div"); box.append(head, eventsBox);
  try {
    const events = await api("GET", "accounts/" + account.id + "/events");
    table(eventsBox, ["#", t.type, t.from, t.time, t.expires, t.content], events.map(e => [e.seq, t.eventTypes[e.type] || e.type, code(e.from || e.guardianId),
      when(e.at), when(e.expiresAt), e.encrypted ? t.encrypted : "—"]), t.noEvents);
  } catch (e) { eventsBox.append(el("p", e.message, "error")); }
}

async function renderLogs() {
  const t = T();
  let logs = [];
  try { logs = await api("GET", "logs"); } catch { return; }
  table("logs", [t.time, t.ip, t.request, t.statusCol, t.duration, t.account], logs.map(l => [when(l.at), code(l.ip), code(l.method + " " + l.path),
    el("span", String(l.status), l.status < 400 ? "status-ok" : l.status < 500 ? "status-warn" : "status-bad"), l.ms + " ms", code(l.discordId)]), t.noLogs);
}

function renderControl() {
  const t = T(), s = data.server, r = t.serverRows;
  const values = [s.version, s.node, ago(s.startedAt) + " (" + when(s.startedAt) + ")", s.memoryMb + " MB",
    s.dataSize == null ? "—" : (s.dataSize / 1024).toFixed(1) + " KB", s.requestsLastHour ?? "—", s.errorsLastHour ?? "—", data.queued,
    data.waiting, s.sessions, s.passwordFromDashboard ? t.passwordFromDashboard : t.passwordFromFile];
  table("server", ["", ""], r.map((label, i) => [label, values[i]]), "");
  const m = $("maintenance");
  m.textContent = data.settings.maintenance ? t.maintenanceOn : t.maintenanceOff;
  m.className = data.settings.maintenance ? "on" : "ghost";
}

function render() {
  $("banner").hidden = !data.settings.maintenance;
  const live = data.accounts.filter(a => a.lastSeen && Date.now() - a.lastSeen < 86400000).length;
  const values = [data.accounts.length, live, data.pairs.length, data.codes.length, data.waiting, data.server.requestsLastHour ?? "—"];
  $("tiles").replaceChildren(...T().tiles.map((label, i) => { const tile = el("div", undefined, "tile"); tile.append(el("b", String(values[i])), el("span", label)); return tile; }));
  if (tab === "pairs") renderPairs();
  if (tab === "accounts") renderAccounts();
  if (tab === "codes") renderCodes();
  if (tab === "logs") renderLogs();
  if (tab === "control") renderControl();
  $("updated").textContent = T().updated + new Date().toLocaleTimeString(locale());
}

async function load(force) {
  // the automatic refresh doesn't redraw under the cursor while typing or ticking boxes
  const active = document.activeElement;
  if (!force && data && active && ["INPUT", "SELECT"].includes(active.tagName) && active.id !== "account-search") return;
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
$("clear-logs").addEventListener("click", () => act("DELETE", "logs", null, T().confirmClearLog));
$("maintenance").addEventListener("click", () => act("POST", "settings", { maintenance: !data.settings.maintenance },
  data.settings.maintenance ? null : T().confirmMaintenance));
$("backup").addEventListener("click", () => { location.href = "/admin/api/backup"; });
$("restart").addEventListener("click", async () => {
  if (!confirm(T().confirmRestart)) return;
  try { await api("POST", "restart"); } catch {}
  $("updated").textContent = T().restarting; setTimeout(() => load(true), 4000);
});
$("sessions").addEventListener("click", () => act("POST", "sessions", null, T().confirmSignOut));
$("wipe").addEventListener("click", () => { if (prompt(T().wipePrompt) === "WIPE") act("POST", "wipe", { confirm: "WIPE" }); });
$("password-form").addEventListener("submit", async event => {
  event.preventDefault();
  try { await api("POST", "password", { current: $("pw-current").value, next: $("pw-next").value }); alert(T().passwordChanged); $("pw-current").value = $("pw-next").value = ""; load(true); }
  catch (e) { alert(e.message === "The current password is wrong." ? T().wrongCurrent : e.message); }
});
$("login-form").addEventListener("submit", async event => {
  event.preventDefault(); $("login-error").textContent = "";
  try { await api("POST", "login", { password: $("password").value }); $("password").value = ""; show(true); }
  catch (e) { $("login-error").textContent = e.message === "Wrong password." ? T().wrongPassword : e.message; }
});
$("logout").addEventListener("click", async () => { try { await api("POST", "logout"); } catch {} show(false); });
$("refresh").addEventListener("click", () => load(true));
applyLanguage();
api("GET", "overview").then(() => show(true), () => show(false));
`;
