/**
 * @name FriendsInVoice
 * @author mPhpMaster
 * @description Voice rooms, friend alerts, encrypted Personal Guards, and smart DM replies for BetterDiscord.
 * @version 1.13.0
 * @website https://github.com/mPhpMaster/FriendsInVoice
 * @source https://github.com/mPhpMaster/FriendsInVoice
 */
// ../friendsInVoice/updateVersion.ts
function parseVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function isNewer(candidate, installed) {
  const a = parseVersion(candidate), b = parseVersion(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// src/alerts.js
var online = (status) => !!status && status !== "offline" && status !== "invisible";
var AlertService = class {
  constructor(api, bridge, data, openPage, version) {
    this.api = api;
    this.bridge = bridge;
    this.data = data;
    this.openPage = openPage;
    this.version = version;
    this.previousStatus = /* @__PURE__ */ new Map();
    this.previousVoice = /* @__PURE__ */ new Map();
    this.quietUntil = Date.now() + 15e3;
    this.notifiedVersion = null;
  }
  seed() {
    const settings = this.data.value;
    for (const id of /* @__PURE__ */ new Set([...settings.notifyOnline, ...settings.blacklist]))
      this.previousStatus.set(id, this.bridge.status(id));
    for (const id of settings.notifyVoice) this.previousVoice.set(id, this.bridge.voiceChannel(id));
  }
  reconnect() {
    this.quietUntil = Date.now() + 15e3;
    this.seed();
  }
  poll() {
    const settings = this.data.value;
    for (const id of /* @__PURE__ */ new Set([...settings.notifyOnline, ...settings.blacklist])) {
      const now = this.bridge.status(id);
      const before = this.previousStatus.get(id);
      this.previousStatus.set(id, now);
      if (Date.now() < this.quietUntil || before === void 0 || online(before) || !online(now)) continue;
      if (settings.blacklist.includes(id)) {
        this.api.UI.showNotice(`${this.bridge.name(id)} is online (Run Away list).`, {
          buttons: [{ label: "Go invisible", onClick: () => void this.bridge.setInvisible().catch((error) => this.api.UI.showToast(String(error), { type: "error" })) }]
        });
      }
      if (settings.notifyOnline.includes(id)) {
        this.api.UI.showNotice(`${this.bridge.name(id)} is online.`, {
          buttons: [{ label: "Open DM", onClick: () => void this.bridge.openDm(id).catch((error) => this.api.UI.showToast(String(error), { type: "error" })) }]
        });
        if (settings.notifyOnce) this.data.set("notifyOnline", settings.notifyOnline.filter((item) => item !== id));
      }
    }
    for (const id of settings.notifyVoice) {
      const now = this.bridge.voiceChannel(id);
      const before = this.previousVoice.get(id);
      this.previousVoice.set(id, now);
      if (Date.now() < this.quietUntil || before === void 0 || before || !now) continue;
      const room = this.bridge.channel(now);
      const place = room ? this.bridge.roomDescription(room) : null;
      this.api.UI.showNotice(`${this.bridge.name(id)} joined ${place?.roomName ?? "voice"}.`, {
        buttons: [{ label: "Show rooms", onClick: () => this.openPage("voice") }]
      });
    }
  }
  async checkUpdate(manual = false) {
    if (!manual && !this.data.value.checkForUpdates) return;
    try {
      const response = await this.api.Net.fetch("https://api.github.com/repos/mPhpMaster/FriendsInVoice/releases/latest", {
        headers: { Accept: "application/vnd.github+json" }
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
      const release = await response.json();
      const version = String(release.tag_name ?? "").replace(/^v/, "");
      const asset = release.assets?.find((item) => item.name === "FriendsInVoice.plugin.js");
      if (!isNewer(version, this.version) || !asset) {
        if (manual) this.api.UI.showToast(`BetterDiscord plugin is up to date (v${this.version}).`, { type: "success" });
        return;
      }
      if (!manual && this.notifiedVersion === version) return;
      this.notifiedVersion = version;
      const url = `https://github.com/mPhpMaster/FriendsInVoice/releases/tag/v${version}`;
      this.api.UI.showNotice(`FriendsInVoice BetterDiscord v${version} is available.`, {
        buttons: [{ label: "Open release", onClick: () => window.open(url, "_blank", "noopener,noreferrer") }]
      });
    } catch (error) {
      if (manual) this.api.UI.showToast(`Update check failed: ${String(error)}`, { type: "error" });
    }
  }
};

// src/data.js
var LISTS = ["watchlist", "notifyOnline", "blacklist", "notifyVoice", "hidden"];
var ACTIONS = ["mute", "deafen", "disconnect"];
var DEFAULTS = {
  watchlist: [],
  notifyOnline: [],
  blacklist: [],
  notifyVoice: [],
  hidden: [],
  notifyOnce: true,
  smartReplies: true,
  smartRepliesAi: false,
  anthropicApiKey: "",
  aiModel: "claude-opus-5-5",
  checkForUpdates: true,
  personalGuards: [],
  knownGuardGrants: [],
  guardPeerKeys: [],
  guardBlocks: [],
  guardReplay: []
};
var isId = (value) => typeof value === "string" && /^\d{17,20}$/.test(value);
var isAction = (value) => ACTIONS.includes(value);
function normalizeData(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const data = { ...DEFAULTS };
  for (const key of LISTS) data[key] = Array.isArray(source[key]) ? [...new Set(source[key].filter(isId))] : [];
  for (const key of ["notifyOnce", "smartReplies", "smartRepliesAi", "checkForUpdates"])
    if (typeof source[key] === "boolean") data[key] = source[key];
  for (const key of ["anthropicApiKey", "aiModel"])
    if (typeof source[key] === "string") data[key] = source[key].slice(0, 300);
  for (const key of ["personalGuards", "knownGuardGrants"])
    data[key] = Array.isArray(source[key]) ? source[key].filter((item) => isId(item?.userId) && Array.isArray(item.actions)).map((item) => ({ userId: item.userId, actions: ACTIONS.filter((action) => item.actions.includes(action)) })) : [];
  data.guardPeerKeys = Array.isArray(source.guardPeerKeys) ? source.guardPeerKeys.filter((item) => isId(item?.userId) && typeof item.publicKey === "string" && /^[A-Za-z0-9_-]{87}$/.test(item.publicKey)).map((item) => ({ userId: item.userId, publicKey: item.publicKey })) : [];
  data.guardBlocks = Array.isArray(source.guardBlocks) ? source.guardBlocks.filter((item) => isId(item?.userId) && Number.isSafeInteger(item.until) && item.until > Date.now()).map((item) => ({ userId: item.userId, until: item.until })) : [];
  data.guardReplay = Array.isArray(source.guardReplay) ? source.guardReplay.filter((item) => typeof item?.nonce === "string" && Number.isSafeInteger(item.createdAt) && Date.now() - item.createdAt < 3e5).map((item) => ({ nonce: item.nonce, createdAt: item.createdAt })) : [];
  return data;
}
var DataStore = class {
  constructor(api) {
    this.api = api;
    this.value = normalizeData(api.Data.load("settings"));
  }
  save() {
    this.api.Data.save("settings", this.value);
  }
  listHas(key, id) {
    return LISTS.includes(key) && this.value[key].includes(id);
  }
  toggleList(key, id) {
    if (!LISTS.includes(key) || !isId(id)) return false;
    this.value[key] = this.listHas(key, id) ? this.value[key].filter((item) => item !== id) : [...this.value[key], id];
    this.save();
    return true;
  }
  set(key, value) {
    if (!(key in DEFAULTS)) return false;
    const candidate = normalizeData({ ...this.value, [key]: value });
    this.value[key] = candidate[key];
    this.save();
    return true;
  }
  grant(id, actions) {
    if (!isId(id) || !Array.isArray(actions) || !actions.every(isAction)) return false;
    this.value.personalGuards = [
      ...this.value.personalGuards.filter((item) => item.userId !== id),
      { userId: id, actions: ACTIONS.filter((action) => actions.includes(action)) }
    ];
    this.save();
    return true;
  }
  revoke(id) {
    this.value.personalGuards = this.value.personalGuards.filter((item) => item.userId !== id);
    this.save();
  }
};

// src/discord.js
var VIEW_CHANNEL = 1n << 10n;
var CONNECT = 1n << 20n;
var MOVE_MEMBERS = 1n << 24n;
var CHANNEL_OBFUSCATED = 1 << 17;
var STATUSES = ["online", "idle", "dnd", "invisible"];
var IN_EXPORTS = { searchExports: true };
var DiscordBridge = class {
  constructor(api) {
    this.api = api;
    const webpack = api.Webpack;
    this.userStore = webpack.getStore("UserStore");
    this.channelStore = webpack.getStore("ChannelStore");
    this.voiceStore = webpack.getStore("VoiceStateStore");
    this.relationshipStore = webpack.getStore("RelationshipStore");
    this.presenceStore = webpack.getStore("PresenceStore");
    this.guildStore = webpack.getStore("GuildStore");
    this.memberStore = webpack.getStore("GuildMemberStore");
    this.permissionStore = webpack.getStore("PermissionStore");
    this.selectedChannelStore = webpack.getStore("SelectedChannelStore");
    this.messageStore = webpack.getStore("MessageStore");
    this.mediaStore = webpack.getStore("MediaEngineStore");
    this.dispatcher = webpack.getByKeys("subscribe", "unsubscribe", "dispatch", IN_EXPORTS);
    this.channelActions = webpack.getByKeys("openPrivateChannel");
    this.componentDispatch = webpack.getByKeys("dispatchToLastSubscribed", IN_EXPORTS);
    this.voiceActions = webpack.getByKeys("toggleSelfMute", "toggleSelfDeaf");
    this.voiceChannelActions = webpack.getByKeys("selectVoiceChannel", "selectChannel");
    this.profileActions = webpack.getByKeys("openUserProfileModal");
    if (!this.userStore || !this.channelStore || !this.voiceStore || !this.relationshipStore || !this.permissionStore || !this.dispatcher)
      throw new Error("Discord stores or dispatcher are unavailable in this client build.");
  }
  currentId() {
    return this.userStore.getCurrentUser()?.id ?? null;
  }
  user(id) {
    return this.userStore.getUser(id);
  }
  openProfile(id) {
    if (!this.profileActions?.openUserProfileModal) throw new Error("Discord's profile opener is unavailable.");
    this.profileActions.openUserProfileModal({ userId: id });
  }
  name(id, guildId = null) {
    const user = this.user(id);
    return this.relationshipStore.getNickname?.(id) ?? (guildId && this.memberStore?.getNick?.(guildId, id)) ?? user?.globalName ?? user?.username ?? id;
  }
  status(id) {
    return this.presenceStore?.getStatus?.(id) ?? "offline";
  }
  voiceState(id) {
    return this.voiceStore.getVoiceStateForUser?.(id) ?? null;
  }
  voiceChannel(id) {
    return this.voiceState(id)?.channelId ?? null;
  }
  // "Locked" without Connect; "Full" at the user limit unless you have Move Members:
  // https://docs.discord.com/developers/topics/voice-connections
  joinBlocker(channel) {
    if (!channel.guild_id) return null;
    if (!this.permissionStore.can(VIEW_CHANNEL, channel) || !this.permissionStore.can(CONNECT, channel)) return "Locked";
    const limit = channel.userLimit ?? 0;
    if (!limit || this.permissionStore.can(MOVE_MEMBERS, channel)) return null;
    return Object.keys(this.voiceStore.getVoiceStatesForChannel?.(channel.id) ?? {}).length >= limit ? "Full" : null;
  }
  // the voice channel this client is in; voiceChannel(me) can return a session on another device
  myVoiceChannel() {
    return this.selectedChannelStore?.getVoiceChannelId?.() ?? null;
  }
  sharesVoice(id) {
    const mine = this.myVoiceChannel();
    return !!mine && !!this.voiceStore.getVoiceStatesForChannel?.(mine)?.[id];
  }
  isDm(channel) {
    return !!channel?.isDM?.();
  }
  channel(id) {
    return this.channelStore.getChannel(id);
  }
  selectedChannel() {
    return this.selectedChannelStore?.getChannelId?.() ?? null;
  }
  async openDm(id) {
    if (!this.channelActions?.openPrivateChannel) throw new Error("Discord's DM opener is unavailable.");
    await this.channelActions.openPrivateChannel({ recipientIds: [id] });
    for (let attempt = 0; attempt < 25; attempt++) {
      const channel = this.channel(this.selectedChannel());
      if (this.isDm(channel) && channel.recipients?.includes(id)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The intended DM did not open. No text was inserted.");
  }
  async prepareDm(id, text) {
    await this.openDm(id);
    if (!this.componentDispatch?.dispatchToLastSubscribed)
      throw new Error("Discord's message composer is unavailable. Nothing was sent.");
    this.componentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { rawText: text, plainText: text });
  }
  insertReply(text) {
    if (!this.componentDispatch?.dispatchToLastSubscribed) throw new Error("Discord's message composer is unavailable.");
    this.componentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { rawText: text, plainText: text });
  }
  currentDm() {
    const id = this.selectedChannel();
    const channel = this.channel(id);
    return this.isDm(channel) ? channel : null;
  }
  lastIncomingDm() {
    const channel = this.currentDm();
    if (!channel) return null;
    const message = this.messageStore?.getLastMessage?.(channel.id);
    return message && message.author?.id !== this.currentId() && !message.author?.bot ? { channel, message } : null;
  }
  recentDmLines(channelId) {
    const messages = this.messageStore?.getMessages?.(channelId)?._array ?? [];
    return messages.filter((message) => message.content?.trim()).slice(-8).map((message) => ({ mine: message.author?.id === this.currentId(), content: message.content.slice(0, 500) }));
  }
  roomDescription(channel) {
    const guild = channel.guild_id && this.guildStore?.getGuild?.(channel.guild_id);
    if (guild) return { place: guild.name, roomName: channel.name === "___hidden___" || channel.flags & CHANNEL_OBFUSCATED ? "Private channel" : channel.name ?? "Voice", guildId: guild.id };
    if (this.isDm(channel)) return { place: "Direct call", roomName: this.name(channel.recipients?.[0]), guildId: null };
    return { place: "Group call", roomName: channel.name ?? "Group DM", guildId: null };
  }
  rooms(watchlist = [], hidden = []) {
    const friendIds = new Set(this.relationshipStore.getFriendIDs?.() ?? []);
    const me = this.currentId();
    const isHidden = (id) => id !== me && hidden.includes(id);
    const tracked = new Set([...friendIds, ...watchlist].filter((id) => !isHidden(id)));
    const byChannel = /* @__PURE__ */ new Map();
    for (const states of Object.values(this.voiceStore.getAllVoiceStates?.() ?? {})) {
      for (const state of Object.values(states ?? {})) {
        if (!state?.channelId || !state.userId || !this.user(state.userId)) continue;
        byChannel.set(state.channelId, [...byChannel.get(state.channelId) ?? [], state]);
      }
    }
    const result = [];
    for (const [channelId, members] of byChannel) {
      if (!members.some((state) => state.userId !== me && tracked.has(state.userId))) continue;
      const channel = this.channel(channelId);
      if (!channel) continue;
      const info = this.roomDescription(channel);
      result.push({
        channelId,
        ...info,
        blocker: this.joinBlocker(channel),
        hiddenCount: members.filter((state) => isHidden(state.userId)).length,
        members: members.filter((state) => !isHidden(state.userId)).map((state) => ({
          id: state.userId,
          name: this.name(state.userId, info.guildId),
          friend: friendIds.has(state.userId),
          watched: watchlist.includes(state.userId),
          mute: !!(state.mute || state.selfMute),
          deaf: !!(state.deaf || state.selfDeaf),
          stream: !!state.selfStream
        }))
      });
    }
    return result.sort((a, b) => a.place.localeCompare(b.place) || a.roomName.localeCompare(b.roomName));
  }
  applyGuardAction(action) {
    if (action === "disconnect") {
      const previous = this.myVoiceChannel();
      if (!previous || !this.voiceChannelActions?.selectVoiceChannel) return null;
      this.voiceChannelActions.selectVoiceChannel(null);
      return () => this.voiceChannelActions.selectVoiceChannel(previous);
    }
    if (action === "mute" || action === "deafen") {
      const method = action === "mute" ? "toggleSelfMute" : "toggleSelfDeaf";
      const check = action === "mute" ? "isSelfMute" : "isSelfDeaf";
      if (!this.voiceActions?.[method] || !this.mediaStore?.[check]) return null;
      const wasActive = this.mediaStore[check]();
      if (!wasActive) this.voiceActions[method]();
      return () => {
        if (!wasActive && this.mediaStore[check]()) this.voiceActions[method]();
      };
    }
    return null;
  }
  async setInvisible() {
    this.statusSetting ??= this.api.Webpack.getModule?.((item) => {
      try {
        return typeof item?.updateSetting === "function" && STATUSES.includes(item.getSetting?.());
      } catch {
        return false;
      }
    }, IN_EXPORTS);
    if (this.statusSetting?.updateSetting) return this.statusSetting.updateSetting("invisible");
    throw new Error("Discord's status control is unavailable in this build.");
  }
};

// ../friendsInVoice/personalGuardsProtocol.ts
var GUARD_ACTIONS = ["mute", "deafen", "disconnect"];
var GUARD_LABELS = {
  mute: "Mute microphone",
  deafen: "Deafen",
  disconnect: "Disconnect from voice"
};
var PREFIX = "[FriendsInVoice Guard v2] ";
var LINK = "https://github.com/mPhpMaster/FriendsInVoice#fiv-guard=";
var LINKED = /#fiv-guard=([A-Za-z0-9_\-\s]+)>?\)/;
var SNOWFLAKE = /^\d{17,20}$/;
var BASE64_URL = /^[A-Za-z0-9_-]+$/;
function isUserId(value) {
  return SNOWFLAKE.test(value);
}
function newGuardNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function makeCommand(ownerId, action, inviteNonce) {
  return { kind: "command", ownerId, action, createdAt: Date.now(), nonce: newGuardNonce(), ...inviteNonce ? { inviteNonce } : {} };
}
function makeGrantNotice(ownerId, actions) {
  return { kind: "grant", ownerId, actions: GUARD_ACTIONS.filter((action) => actions.includes(action)), createdAt: Date.now() };
}
function toBase64Url(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value) {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return null;
  }
}
function serializeWire(wire, summary = "Personal Guards message") {
  return `\u{1F6E1}\uFE0F [${summary}](<${LINK}${toBase64Url(JSON.stringify(wire))}>)`;
}
function guardJson(content) {
  if (content.length > 3e3) return null;
  const envelopes = content.split(PREFIX).length - 1 + content.split("#fiv-guard=").length - 1;
  if (envelopes !== 1) return null;
  if (content.startsWith(PREFIX)) return content.slice(PREFIX.length);
  const data = LINKED.exec(content)?.[1]?.replace(/\s/g, "");
  return data ? fromBase64Url(data) : null;
}
function parseGuardMessage(content) {
  const json = guardJson(content);
  if (!json) return null;
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const value = data;
  for (const field of ["publicKey", "fromKey", "iv", "ciphertext"]) {
    if (typeof value[field] === "string") value[field] = value[field].replace(/[ \t\r\n]/g, "");
  }
  if (value.version !== 2 && value.version !== 3) return null;
  if (value.type === "key" && value.version === 2 && typeof value.publicKey === "string" && value.publicKey.length === 87 && BASE64_URL.test(value.publicKey)) return value;
  if (value.type === "invite" && value.version === 3 && typeof value.publicKey === "string" && value.publicKey.length === 87 && BASE64_URL.test(value.publicKey) && typeof value.nonce === "string" && /^[a-f\d-]{36}$/i.test(value.nonce) && Array.isArray(value.actions) && value.actions.length > 0 && value.actions.every((action) => GUARD_ACTIONS.includes(action))) return value;
  if (value.type === "sealed" && value.version === 2 && typeof value.to === "string" && isUserId(value.to) && typeof value.fromKey === "string" && value.fromKey.length === 87 && BASE64_URL.test(value.fromKey) && typeof value.iv === "string" && value.iv.length === 16 && BASE64_URL.test(value.iv) && typeof value.ciphertext === "string" && value.ciphertext.length > 20 && BASE64_URL.test(value.ciphertext)) {
    return value;
  }
  return null;
}
function parseGuardPayload(value) {
  if (!value || typeof value !== "object") return null;
  const payload = value;
  if (typeof payload.ownerId !== "string" || !isUserId(payload.ownerId) || typeof payload.createdAt !== "number" || !Number.isSafeInteger(payload.createdAt)) return null;
  if (payload.kind === "command" && GUARD_ACTIONS.includes(payload.action) && typeof payload.nonce === "string" && /^[a-f\d-]{36}$/i.test(payload.nonce) && (payload.inviteNonce === void 0 || typeof payload.inviteNonce === "string" && /^[a-f\d-]{36}$/i.test(payload.inviteNonce)))
    return payload;
  if (payload.kind === "grant" && Array.isArray(payload.actions) && payload.actions.every((action) => GUARD_ACTIONS.includes(action))) return payload;
  return null;
}

// ../friendsInVoice/personalGuardsCrypto.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var DB_NAME = "FriendsInVoiceGuardKeys";
var keyPromise;
function toBase64Url2(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url2(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function buffer(bytes) {
  const value = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(value).set(bytes);
  return value;
}
function openKeyDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function loadOrCreateKeys() {
  const database = await openKeyDatabase();
  try {
    const saved = await new Promise((resolve, reject) => {
      const request = database.transaction("keys", "readonly").objectStore("keys").get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (saved?.privateKey && saved.publicKey) return saved;
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("keys", "readwrite");
      transaction.objectStore("keys").put(pair, "current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return pair;
  } finally {
    database.close();
  }
}
function getGuardKeys() {
  return keyPromise ??= loadOrCreateKeys().catch((error) => {
    keyPromise = void 0;
    throw error;
  });
}
async function publicKeyString(pair) {
  return toBase64Url2(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
}
async function validatePublicKey(value) {
  try {
    const bytes = fromBase64Url2(value);
    if (bytes.length !== 65 || bytes[0] !== 4) return false;
    await crypto.subtle.importKey("raw", buffer(bytes), { name: "ECDH", namedCurve: "P-256" }, false, []);
    return true;
  } catch {
    return false;
  }
}
async function sharedKey(pair, peerPublic, firstId, secondId) {
  const peer = await crypto.subtle.importKey("raw", buffer(fromBase64Url2(peerPublic)), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, pair.privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const info = encoder.encode([firstId, secondId].sort().join("|"));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: buffer(encoder.encode("FriendsInVoice Guard v2")), info: buffer(info) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
function additionalData(senderId, recipientId, senderKey) {
  return encoder.encode(`FriendsInVoice Guard v2|${senderId}|${recipientId}|${senderKey}`);
}
async function sealGuardPayload(payload, pair, peerPublic, senderId, recipientId) {
  const fromKey = await publicKeyString(pair);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sharedKey(pair, peerPublic, senderId, recipientId);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buffer(iv), additionalData: buffer(additionalData(senderId, recipientId, fromKey)) },
    key,
    buffer(encoder.encode(JSON.stringify(payload)))
  );
  return { type: "sealed", version: 2, to: recipientId, fromKey, iv: toBase64Url2(iv), ciphertext: toBase64Url2(new Uint8Array(ciphertext)) };
}
async function openGuardPayload(wire, pair, senderId, recipientId) {
  if (wire.to !== recipientId) return null;
  try {
    const key = await sharedKey(pair, wire.fromKey, senderId, recipientId);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buffer(fromBase64Url2(wire.iv)), additionalData: buffer(additionalData(senderId, recipientId, wire.fromKey)) },
      key,
      buffer(fromBase64Url2(wire.ciphertext))
    );
    return parseGuardPayload(JSON.parse(decoder.decode(plaintext)));
  } catch {
    return null;
  }
}

// src/guards.js
var MAX_COMMAND_AGE = 5 * 6e4;
var MAX_GRANT_AGE = 7 * 24 * 60 * 6e4;
var GuardService = class {
  constructor(api, bridge, data, openPage) {
    this.api = api;
    this.bridge = bridge;
    this.data = data;
    this.openPage = openPage;
    this.seen = /* @__PURE__ */ new Set();
    this.active = true;
  }
  stop() {
    this.active = false;
    this.seen.clear();
  }
  grantFor(id) {
    return this.data.value.personalGuards.find((item) => item.userId === id)?.actions ?? [];
  }
  knownFor(id) {
    return this.data.value.knownGuardGrants.find((item) => item.userId === id)?.actions ?? [];
  }
  keyFor(id) {
    return this.data.value.guardPeerKeys.find((item) => item.userId === id)?.publicKey;
  }
  setKey(id, publicKey) {
    this.data.value.guardPeerKeys = [...this.data.value.guardPeerKeys.filter((item) => item.userId !== id), { userId: id, publicKey }];
    this.data.save();
  }
  notify(title, content, action) {
    if (!this.active) return;
    this.api.UI.showNotice(`${title}: ${content}`, action ? { buttons: [{ label: "Open Personal Guards", onClick: action }] } : {});
  }
  async sendKey(id) {
    if (!this.active) return;
    try {
      const publicKey = await publicKeyString(await getGuardKeys());
      await this.bridge.prepareDm(id, serializeWire({ type: "key", version: 2, publicKey }));
      this.api.UI.showToast("Secure key draft is ready. Press Discord's Send button.", { type: "info" });
    } catch (error) {
      this.api.UI.showToast(String(error), { type: "error" });
    }
  }
  async sendGrant(id) {
    if (!this.active) return;
    const ownerId = this.bridge.currentId();
    const key = this.keyFor(id);
    if (!ownerId || !key) return this.api.UI.showToast("Ask this person to offer to guard you first.", { type: "warning" });
    try {
      const payload = makeGrantNotice(ownerId, this.grantFor(id));
      const wire = await sealGuardPayload(payload, await getGuardKeys(), key, ownerId, id);
      await this.bridge.prepareDm(id, serializeWire(wire));
      this.api.UI.showToast("Encrypted access draft is ready. Press Discord's Send button.", { type: "info" });
    } catch (error) {
      this.api.UI.showToast(String(error), { type: "error" });
    }
  }
  async sendCommand(id, action) {
    if (!this.active || !GUARD_ACTIONS.includes(action) || !this.knownFor(id).includes(action) || !this.bridge.sharesVoice(id)) return;
    const senderId = this.bridge.currentId();
    const key = this.keyFor(id);
    if (!senderId || !key) return this.api.UI.showToast("The owner's secure key is unavailable.", { type: "error" });
    try {
      const wire = await sealGuardPayload(makeCommand(id, action), await getGuardKeys(), key, senderId, id);
      await this.bridge.prepareDm(id, serializeWire(wire));
      this.api.UI.showToast("Encrypted action draft is ready. Press Discord's Send button.", { type: "info" });
    } catch (error) {
      this.api.UI.showToast(String(error), { type: "error" });
    }
  }
  revoke(id) {
    const hadKey = !!this.keyFor(id);
    this.data.revoke(id);
    if (hadKey) void this.sendGrant(id);
  }
  async onMessage(message) {
    if (!this.active || !message?.id || this.seen.has(message.id) || message.author?.bot) return;
    const wire = parseGuardMessage(message.content ?? "");
    if (!wire || !this.bridge.isDm(this.bridge.channel(message.channel_id))) return;
    this.seen.add(message.id);
    if (this.seen.size > 1e3) this.seen.clear();
    const me = this.bridge.currentId();
    const sender = message.author?.id;
    if (!me || !sender || sender === me) return;
    if (wire.type === "key") {
      if (!await validatePublicKey(wire.publicKey)) return;
      this.setKey(sender, wire.publicKey);
      this.notify("Personal Guards", `Secure key received from ${this.bridge.name(sender)}. Choose their permissions and prepare the access DM.`, () => this.openPage("guards"));
      return;
    }
    if (wire.to !== me) return;
    const pinned = this.keyFor(sender);
    let payload;
    try {
      payload = await openGuardPayload(wire, await getGuardKeys(), sender, me);
    } catch {
      return;
    }
    if (!payload) return;
    if (payload.kind === "grant") {
      if (payload.ownerId !== sender || Math.abs(Date.now() - payload.createdAt) > MAX_GRANT_AGE) return;
      this.setKey(sender, wire.fromKey);
      this.data.value.knownGuardGrants = [
        ...this.data.value.knownGuardGrants.filter((item) => item.userId !== sender),
        ...payload.actions.length ? [{ userId: sender, actions: [...payload.actions] }] : []
      ];
      this.data.save();
      this.notify("Personal Guards", `${this.bridge.name(sender)} updated your access.`, () => this.openPage("guards"));
      return;
    }
    if (payload.ownerId !== me || Math.abs(Date.now() - payload.createdAt) > MAX_COMMAND_AGE || !pinned || pinned !== wire.fromKey || !this.grantFor(sender).includes(payload.action) || !this.bridge.sharesVoice(sender) || this.data.value.guardBlocks.some((item) => item.userId === sender && item.until > Date.now()) || this.data.value.guardReplay.some((item) => item.nonce === payload.nonce)) return;
    const undo = this.bridge.applyGuardAction(payload.action);
    if (!undo) return;
    this.data.value.guardReplay = [
      ...this.data.value.guardReplay.filter((item) => Date.now() - item.createdAt < MAX_COMMAND_AGE),
      { nonce: payload.nonce, createdAt: Date.now() }
    ];
    this.data.save();
    this.api.UI.showNotice(`${this.bridge.name(sender)} applied ${GUARD_LABELS[payload.action]} to your account.`, {
      buttons: [
        { label: "Undo", onClick: () => undo() },
        { label: "Block 15 minutes", onClick: () => {
          this.data.value.guardBlocks = [
            ...this.data.value.guardBlocks.filter((item) => item.userId !== sender),
            { userId: sender, until: Date.now() + 15 * 6e4 }
          ];
          this.data.save();
        } }
      ]
    });
  }
};

// src/menu.js
function listItem(view, id, key, addText, removeText) {
  return {
    id: `fivbd-${key}`,
    label: view.data.listHas(key, id) ? removeText : addText,
    action: () => {
      view.data.toggleList(key, id);
      view.refresh();
    }
  };
}
function installUserMenu(api, view) {
  return api.ContextMenu.patch("user-context", (tree, props, instance) => {
    try {
      const user = props?.user ?? props?.contextMenuAPIArguments?.[0]?.user ?? instance?.props?.user ?? tree?.props?.user ?? tree?.props?.contextMenuAPIArguments?.[0]?.user ?? api.Utils?.findInTree?.(tree, (item) => !!item?.user?.id, { walkable: ["props", "children"] })?.user;
      const id = user?.id;
      if (!id || id === view.bridge.currentId()) return;
      const known = view.guards.knownFor(id);
      const available = view.bridge.sharesVoice(id) ? GUARD_ACTIONS.filter((action) => known.includes(action)) : [];
      const guardItems = [
        {
          id: "fivbd-add-guardian",
          label: view.data.value.personalGuards.some((item) => item.userId === id) ? "Manage guardian" : "Add as Guardian",
          action: () => {
            if (!view.data.value.personalGuards.some((item) => item.userId === id)) view.data.grant(id, []);
            view.open("guards");
          }
        },
        { id: "fivbd-offer-guard", label: "Offer to guard (prepare secure key DM)", action: () => void view.guards.sendKey(id) },
        ...available.map((action) => ({
          id: `fivbd-guard-${action}`,
          label: `Prepare ${GUARD_LABELS[action]} DM`,
          action: () => void view.guards.sendCommand(id, action)
        }))
      ];
      const items = api.ContextMenu.buildMenuChildren([{
        type: "group",
        items: [
          listItem(view, id, "watchlist", "Add to My List", "Remove from My List"),
          listItem(view, id, "notifyOnline", "Notify when online", "Stop online alerts"),
          listItem(view, id, "notifyVoice", "Notify when in voice", "Stop voice alerts"),
          listItem(view, id, "blacklist", "Add to Run Away", "Remove from Run Away"),
          listItem(view, id, "hidden", "Hide from In Voice", "Show in In Voice"),
          { type: "submenu", id: "fivbd-guards", label: "Personal Guards", items: guardItems }
        ]
      }]);
      const children = tree?.props?.children;
      if (Array.isArray(children)) children.push(...items);
      else if (children && tree.props) tree.props.children = [children, ...items];
    } catch (error) {
      api.Logger.error("Could not add FriendsInVoice user menu", error);
    }
  });
}

// ../friendsInVoice/smartReplyQuestionRules.ts
var QUESTION_RULES = [
  {
    en: /\b(how are (you|u)|how r u|hru|how'?s it going|how have you been|what'?s up)\b/,
    ar: /كيفك|كيف حالك|شلونك|شخبارك|ازيك|عامل ايه|شو اخبارك|وش اخبارك|شكو ماكو/,
    replies: { en: ["Doing okay, how about you?", "Thanks for asking! How are you?", "How have you been?", "What\u2019s new with you?"], ar: ["\u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647\u060C \u0648\u0627\u0646\u062A \u0643\u064A\u0641\u0643\u061F", "\u062A\u0633\u0644\u0645 \u0639\u0644\u0649 \u0633\u0624\u0627\u0644\u0643\u060C \u0648\u0634 \u0623\u062E\u0628\u0627\u0631\u0643\u061F", "\u0643\u064A\u0641 \u0623\u0645\u0648\u0631\u0643\u061F", "\u0648\u0634 \u0627\u0644\u062C\u062F\u064A\u062F \u0639\u0646\u062F\u0643\u061F"], eg: ["\u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647\u060C \u0625\u0646\u062A \u0639\u0627\u0645\u0644 \u0625\u064A\u0647\u061F", "\u062A\u0633\u0644\u0645\u060C \u0623\u062E\u0628\u0627\u0631\u0643 \u0625\u064A\u0647\u061F", "\u0625\u064A\u0647 \u0627\u0644\u062C\u062F\u064A\u062F \u0639\u0646\u062F\u0643\u061F"], lev: ["\u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647\u060C \u0648\u0625\u0646\u062A \u0643\u064A\u0641\u0643\u061F", "\u064A\u0633\u0644\u0645\u0648\u060C \u0634\u0648 \u0623\u062E\u0628\u0627\u0631\u0643\u061F", "\u0634\u0648 \u062C\u062F\u064A\u062F\u0643\u061F"], iq: ["\u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647\u060C \u0634\u0644\u0648\u0646\u0643 \u0625\u0646\u062A\u061F", "\u062A\u0633\u0644\u0645\u060C \u0634\u062E\u0628\u0627\u0631\u0643\u061F", "\u0634\u0646\u0648 \u0623\u062E\u0628\u0627\u0631\u0643\u061F"] }
  },
  {
    en: /\b(what are you doing|what r u doing|wyd|what you up to|whatcha doing)\b/,
    ar: /وش تسوي|ايش تسوي|شنو تسوي|شو (عم )?(تسوي|تعمل)|بتعمل ايه|شتسوي/,
    replies: { en: ["What are you up to?", "Just checking messages, you?", "Why, what's up?", "Anything interesting going on?"], ar: ["\u0623\u062A\u0635\u0641\u062D \u0627\u0644\u0631\u0633\u0627\u0626\u0644\u060C \u0648\u0627\u0646\u062A\u061F", "\u0648\u0634 \u0639\u0646\u062F\u0643\u061F", "\u0644\u064A\u0634\u060C \u0641\u064A\u0647 \u0634\u064A\u061F", "\u0648\u0634 \u0623\u062E\u0628\u0627\u0631\u0643\u061F"], eg: ["\u0628\u062A\u0635\u0641\u062D \u0627\u0644\u0631\u0633\u0627\u064A\u0644\u060C \u0648\u0625\u0646\u062A\u061F", "\u062E\u064A\u0631\u060C \u0641\u064A \u0625\u064A\u0647\u061F", "\u0625\u0646\u062A \u0628\u062A\u0639\u0645\u0644 \u0625\u064A\u0647\u061F"], lev: ["\u0639\u0645 \u0634\u0648\u0641 \u0627\u0644\u0631\u0633\u0627\u0626\u0644\u060C \u0648\u0625\u0646\u062A\u061F", "\u062E\u064A\u0631\u060C \u0634\u0648 \u0641\u064A\u061F", "\u0625\u0646\u062A \u0634\u0648 \u0639\u0645 \u062A\u0639\u0645\u0644\u061F"], iq: ["\u062F\u0627 \u0623\u0634\u0648\u0641 \u0627\u0644\u0631\u0633\u0627\u064A\u0644\u060C \u0648\u0625\u0646\u062A\u061F", "\u062E\u064A\u0631\u060C \u0634\u0643\u0648\u061F", "\u0625\u0646\u062A \u0634\u062A\u0633\u0648\u064A\u061F"] }
  },
  {
    en: /\b(where are you(?! from)|you there|u there|are you around|are you online)\b/,
    ar: /وينك|وين انت|فينك|انت فين|موجود|متواجد|انت هنا/,
    replies: { en: ["I'm here \u{1F44B}", "Did you need something?", "What's up?", "I just saw your message"], ar: ["\u0645\u0648\u062C\u0648\u062F \u{1F44B}", "\u062A\u062D\u062A\u0627\u062C \u0634\u064A\u061F", "\u0648\u0634 \u0641\u064A\u0647\u061F", "\u062A\u0648\u0646\u064A \u0634\u0641\u062A \u0631\u0633\u0627\u0644\u062A\u0643"], eg: ["\u0645\u0648\u062C\u0648\u062F \u{1F44B}", "\u0645\u062D\u062A\u0627\u062C \u062D\u0627\u062C\u0629\u061F", "\u0644\u0633\u0647 \u0634\u0627\u064A\u0641 \u0631\u0633\u0627\u0644\u062A\u0643"], lev: ["\u0645\u0648\u062C\u0648\u062F \u{1F44B}", "\u0628\u062F\u0643 \u0634\u064A\u061F", "\u0647\u0644\u0623 \u0634\u0641\u062A \u0631\u0633\u0627\u0644\u062A\u0643"], iq: ["\u0645\u0648\u062C\u0648\u062F \u{1F44B}", "\u062A\u062D\u062A\u0627\u062C \u0634\u064A\u061F", "\u0647\u0633\u0647 \u0634\u0641\u062A \u0631\u0633\u0627\u0644\u062A\u0643"] }
  },
  {
    en: /\b(what time|when (are we|do we|is it|should we|can we)|what day|which day)\b/,
    ar: /متي|امتي|شوكت|اي وقت|اي ساعه|الساعه كم|متي (نلتقي|نتقابل)|وقتاش/,
    replies: { en: ["What time works for you?", "Let me check my schedule", "Which day did you have in mind?", "Can we decide a time later?"], ar: ["\u0623\u064A \u0648\u0642\u062A \u064A\u0646\u0627\u0633\u0628\u0643\u061F", "\u062E\u0644\u064A\u0646\u064A \u0623\u062A\u0623\u0643\u062F \u0645\u0646 \u0648\u0642\u062A\u064A", "\u0623\u064A \u064A\u0648\u0645 \u062A\u0642\u0635\u062F\u061F", "\u0646\u062D\u062F\u062F \u0627\u0644\u0648\u0642\u062A \u0628\u0639\u062F\u064A\u0646\u061F"], eg: ["\u0625\u0645\u062A\u0649 \u064A\u0646\u0627\u0633\u0628\u0643\u061F", "\u0647\u0634\u0648\u0641 \u0645\u0648\u0627\u0639\u064A\u062F\u064A \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643", "\u062A\u0642\u0635\u062F \u064A\u0648\u0645 \u0625\u064A\u0647\u061F"], lev: ["\u0625\u064A\u0645\u062A\u0649 \u0628\u0646\u0627\u0633\u0628\u0643\u061F", "\u062E\u0644\u064A\u0646\u064A \u0634\u0648\u0641 \u0648\u0642\u062A\u064A \u0648\u0628\u0631\u062C\u0639\u0644\u0643", "\u0623\u064A \u064A\u0648\u0645 \u0642\u0635\u062F\u0643\u061F"], iq: ["\u0634\u0648\u0643\u062A \u064A\u0646\u0627\u0633\u0628\u0643\u061F", "\u062E\u0644\u064A \u0623\u062A\u0623\u0643\u062F \u0645\u0646 \u0648\u0642\u062A\u064A \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643", "\u0623\u064A \u064A\u0648\u0645 \u062A\u0642\u0635\u062F\u061F"] }
  },
  {
    en: /\b(where (should|can|do|are) we|where is (it|that|the)|what (place|location|address))\b/,
    ar: /وين (نروح|نلتقي|نتقابل|المكان)|فين (نروح|نتقابل|المكان)|شو (المكان|العنوان)|اي (مكان|روم)|شنو (المكان|العنوان)/,
    replies: { en: ["Which place do you mean?", "Can you send the location?", "Where would you prefer?", "Let me check the address"], ar: ["\u0623\u064A \u0645\u0643\u0627\u0646 \u062A\u0642\u0635\u062F\u061F", "\u0645\u0645\u0643\u0646 \u062A\u0631\u0633\u0644 \u0627\u0644\u0645\u0648\u0642\u0639\u061F", "\u0648\u064A\u0646 \u062A\u0641\u0636\u0644\u061F", "\u062E\u0644\u064A\u0646\u064A \u0623\u062A\u0623\u0643\u062F \u0645\u0646 \u0627\u0644\u0639\u0646\u0648\u0627\u0646"] }
  },
  {
    en: /\b(can|could|would|will) you (send|share|show|forward)|\b(where (is|are) (the |my )?(file|photo|picture|link|document))\b/,
    ar: /ممكن (ترسل|تبعت|تبعث|توريني)|تقدر (ترسل|تبعت)|وين (الملف|الصوره|الرابط)|فين (الملف|الصوره|اللينك)/,
    replies: { en: ["Which one do you mean?", "I can look for it", "Could you remind me which file?", "Let me check first"], ar: ["\u0623\u064A \u0648\u0627\u062D\u062F \u062A\u0642\u0635\u062F\u061F", "\u0623\u062F\u0648\u0631 \u0639\u0644\u064A\u0647 \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643", "\u0630\u0643\u0651\u0631\u0646\u064A \u0623\u064A \u0645\u0644\u0641\u061F", "\u062E\u0644\u064A\u0646\u064A \u0623\u062A\u0623\u0643\u062F \u0623\u0648\u0644"] }
  },
  {
    en: /\b(what do you (think|reckon)|your opinion|any thoughts|what should (i|we) do|do you recommend)\b/,
    ar: /وش رايك|ايش رايك|شو رايك|شنو رايك|رايك ايه|ايه رايك|بماذا تنصح|تنصحني بايه|وش تنصح/,
    replies: { en: ["Tell me a bit more first", "What options are you considering?", "I need more context to say", "What matters most to you?"], ar: ["\u0642\u0648\u0644\u064A \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644 \u0623\u0643\u062B\u0631", "\u0648\u0634 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0639\u0646\u062F\u0643\u061F", "\u0623\u062D\u062A\u0627\u062C \u0623\u0639\u0631\u0641 \u0627\u0644\u0633\u064A\u0627\u0642 \u0623\u0648\u0644", "\u0648\u0634 \u0627\u0644\u0623\u0647\u0645 \u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0643\u061F"], eg: ["\u0642\u0648\u0644\u064A \u062A\u0641\u0627\u0635\u064A\u0644 \u0623\u0643\u062A\u0631", "\u0625\u064A\u0647 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0639\u0646\u062F\u0643\u061F", "\u0645\u062D\u062A\u0627\u062C \u0623\u0641\u0647\u0645 \u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u0627\u0644\u0623\u0648\u0644"], lev: ["\u0627\u062D\u0643\u064A\u0644\u064A \u0623\u0643\u062A\u0631", "\u0634\u0648 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0639\u0646\u062F\u0643\u061F", "\u0628\u062F\u064A \u0623\u0641\u0647\u0645 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644 \u0623\u0648\u0644"], iq: ["\u0627\u062D\u062C\u064A\u0644\u064A \u062A\u0641\u0627\u0635\u064A\u0644 \u0623\u0643\u062B\u0631", "\u0634\u0646\u0648 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0639\u0646\u062F\u0643\u061F", "\u0623\u062D\u062A\u0627\u062C \u0623\u0641\u0647\u0645 \u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u0623\u0648\u0644"] }
  },
  {
    en: /\b(why (did|do|does|is|are|was|were|not)|how come)\b/,
    ar: /ليش|ليه|لماذا|علشان ايه|عشان ايه|ليش هيك/,
    replies: { en: ["What part do you mean?", "Can you tell me more?", "I\u2019m not sure yet; let me think", "What happened?"], ar: ["\u0623\u064A \u062C\u0632\u0621 \u062A\u0642\u0635\u062F\u061F", "\u0645\u0645\u0643\u0646 \u062A\u0648\u0636\u062D \u0623\u0643\u062B\u0631\u061F", "\u0645\u0627 \u0623\u062F\u0631\u064A \u0644\u0644\u062D\u064A\u0646\u060C \u062E\u0644\u064A\u0646\u064A \u0623\u0641\u0643\u0631", "\u0648\u0634 \u0635\u0627\u0631\u061F"] }
  },
  {
    en: /\b(how (do|can|should|would) (i|we)|how does (it|this)|how to)\b/,
    ar: /كيف (اسوي|اعمل|اقدر|نقدر|يشتغل)|ازاي (اعمل|اقدر)|شلون (اسوي|اقدر)|كيفيه/,
    replies: { en: ["What are you trying to do exactly?", "Show me where you're stuck", "Can you share more details?", "Let me look into it"], ar: ["\u0648\u0634 \u062A\u062D\u0627\u0648\u0644 \u062A\u0633\u0648\u064A \u0628\u0627\u0644\u0636\u0628\u0637\u061F", "\u0648\u0631\u0646\u064A \u0648\u064A\u0646 \u0639\u0644\u0642\u062A", "\u0645\u0645\u0643\u0646 \u062A\u0641\u0627\u0635\u064A\u0644 \u0623\u0643\u062B\u0631\u061F", "\u062E\u0644\u064A\u0646\u064A \u0623\u0631\u0627\u062C\u0639 \u0627\u0644\u0645\u0648\u0636\u0648\u0639"] }
  },
  {
    en: /\b(are you free|can you (talk|chat|call|join|play|meet)|want to (talk|chat|call|join|play|meet)|wanna (talk|chat|call|join|play|meet))\b/,
    ar: /فاضي|فاضيه|نقدر (نتكلم|نلعب|نتقابل)|تقدر (تتكلم|تلعب|تدخل)|بدك (نحكي|نلعب)|ممكن (نكلم|نتكلم|نلعب)/,
    replies: { en: ["What time?", "What did you have in mind?", "Can I get back to you?", "Maybe later?"], ar: ["\u0645\u062A\u0649\u061F", "\u0648\u0634 \u0641\u064A \u0628\u0627\u0644\u0643\u061F", "\u0623\u0631\u062F \u0639\u0644\u064A\u0643 \u0628\u0639\u062F \u0634\u0648\u064A\u061F", "\u0645\u0645\u0643\u0646 \u0628\u0639\u062F\u064A\u0646\u061F"], eg: ["\u0625\u0645\u062A\u0649\u061F", "\u0641\u064A \u0628\u0627\u0644\u0643 \u0625\u064A\u0647\u061F", "\u0623\u0631\u062F \u0639\u0644\u064A\u0643 \u0628\u0639\u062F \u0634\u0648\u064A\u0629\u061F"], lev: ["\u0625\u064A\u0645\u062A\u0649\u061F", "\u0634\u0648 \u0628\u0628\u0627\u0644\u0643\u061F", "\u0628\u0631\u062C\u0639\u0644\u0643 \u0628\u0639\u062F \u0634\u0648\u064A\u061F"], iq: ["\u0634\u0648\u0643\u062A\u061F", "\u0634\u0646\u0648 \u0628\u0628\u0627\u0644\u0643\u061F", "\u0623\u0631\u062F \u0639\u0644\u064A\u0643 \u0628\u0639\u062F \u0634\u0648\u064A\u0629\u061F"] }
  },
  {
    en: /\b(what (game|movie|show|song|music|food|restaurant) (should|do|would|can)|any (game|movie|show|song|food|restaurant) (ideas|recommendations|suggestions))\b/,
    ar: /وش (نلعب|نشوف|ناكل)|ايش (نلعب|نشوف|ناكل)|شو (نلعب|نحضر|ناكل)|شنو (نلعب|نشوف|ناكل)|ترشح (لعبه|فيلم|مسلسل|مطعم)|اقتراح (لعبه|فيلم|مطعم)/,
    replies: { en: ["What are you in the mood for?", "Any preferences?", "Want to pick from a few options?", "What did you enjoy recently?"], ar: ["\u0648\u0634 \u0646\u0641\u0633\u0643 \u0641\u064A\u0647\u061F", "\u0639\u0646\u062F\u0643 \u062A\u0641\u0636\u064A\u0644 \u0645\u0639\u064A\u0646\u061F", "\u0646\u062E\u062A\u0627\u0631 \u0645\u0646 \u0643\u0645 \u062E\u064A\u0627\u0631\u061F", "\u0648\u0634 \u0639\u062C\u0628\u0643 \u0622\u062E\u0631 \u0645\u0631\u0629\u061F"], eg: ["\u0646\u0641\u0633\u0643 \u0641\u064A \u0625\u064A\u0647\u061F", "\u0639\u0646\u062F\u0643 \u062A\u0641\u0636\u064A\u0644 \u0645\u0639\u064A\u0646\u061F", "\u0646\u062E\u062A\u0627\u0631 \u0645\u0646 \u0643\u0630\u0627 \u062D\u0627\u062C\u0629\u061F"], lev: ["\u0634\u0648 \u0639\u0628\u0627\u0644\u0643\u061F", "\u0639\u0646\u062F\u0643 \u0634\u064A \u0645\u0641\u0636\u0644\u061F", "\u0645\u0646\u062E\u062A\u0627\u0631 \u0645\u0646 \u0643\u0645 \u062E\u064A\u0627\u0631\u061F"], iq: ["\u0634\u0646\u0648 \u0628\u0628\u0627\u0644\u0643\u061F", "\u0639\u0646\u062F\u0643 \u0634\u064A \u062A\u0641\u0636\u0644\u0647\u061F", "\u0646\u062E\u062A\u0627\u0631 \u0645\u0646 \u0643\u0645 \u062E\u064A\u0627\u0631\u061F"] }
  }
];

// ../friendsInVoice/smartReplyRulesFirst.ts
var FIRST_RULES = [
  {
    en: /^(❤️|🤍|💙|💜|💚|🖤|♥️|😘|🥰|\s)+$/,
    ar: /^(❤️|🤍|💙|💜|💚|🖤|♥️|😘|🥰|\s)+$/,
    replies: { en: ["\u2764\uFE0F", "\u{1F90D}", "\u{1F979}\u2764\uFE0F", "\u{1F499}"], ar: ["\u2764\uFE0F", "\u{1F90D}", "\u{1F979}\u2764\uFE0F", "\u{1F499}"] }
  },
  {
    // condolences come first so nothing light-hearted is ever suggested
    ar: /الله يرحمه|الله يرحمها|الله يرحمهم|(^|\s)(توفي|توفيت|توفت|مات|ماتت)(\s|$)|عظم الله|البقاء لله|انا لله وانا اليه راجعون|انتقل الي رحمه/,
    en: /\b(passed away|condolences|funeral|rest in peace|my (mom|dad|mother|father|friend|grandma|grandpa|brother|sister) died|he died|she died|they died)\b/,
    replies: {
      en: ["I'm so sorry for your loss \u{1F90D}", "May they rest in peace", "My deepest condolences", "I'm here if you need anything \u{1F90D}", "Sending you strength"],
      ar: ["\u0627\u0644\u0644\u0647 \u064A\u0631\u062D\u0645\u0647 \u0648\u064A\u063A\u0641\u0631 \u0644\u0647 \u{1F90D}", "\u0639\u0638\u0645 \u0627\u0644\u0644\u0647 \u0623\u062C\u0631\u0643\u0645 \u0648\u0623\u062D\u0633\u0646 \u0639\u0632\u0627\u0643\u0645", "\u0625\u0646\u0627 \u0644\u0644\u0647 \u0648\u0625\u0646\u0627 \u0625\u0644\u064A\u0647 \u0631\u0627\u062C\u0639\u0648\u0646", "\u0627\u0644\u0644\u0647 \u064A\u0635\u0628\u0631\u0643\u0645 \u0648\u064A\u062C\u0628\u0631 \u0642\u0644\u0648\u0628\u0643\u0645", "\u0627\u0644\u0628\u0642\u0627\u0621 \u0644\u0644\u0647 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u062C\u0639\u0644 \u0645\u062B\u0648\u0627\u0647 \u0627\u0644\u062C\u0646\u0629"],
      eg: ["\u0627\u0644\u0628\u0642\u0627\u0621 \u0644\u0644\u0647 \u{1F90D}", "\u0631\u0628\u0646\u0627 \u064A\u0631\u062D\u0645\u0647 \u0648\u064A\u0635\u0628\u0631\u0643\u0645", "\u0625\u0646\u0627 \u0644\u0644\u0647 \u0648\u0625\u0646\u0627 \u0625\u0644\u064A\u0647 \u0631\u0627\u062C\u0639\u0648\u0646", "\u0634\u062F \u062D\u064A\u0644\u0643\u060C \u0631\u0628\u0646\u0627 \u064A\u0635\u0628\u0631\u0643", "\u0631\u0628\u0646\u0627 \u064A\u062C\u0639\u0644\u0647\u0627 \u0622\u062E\u0631 \u0627\u0644\u0623\u062D\u0632\u0627\u0646"],
      lev: ["\u0627\u0644\u0644\u0647 \u064A\u0631\u062D\u0645\u0647 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0635\u0628\u0631\u0643\u0646", "\u0625\u0646\u0627 \u0644\u0644\u0647 \u0648\u0625\u0646\u0627 \u0625\u0644\u064A\u0647 \u0631\u0627\u062C\u0639\u0648\u0646", "\u0627\u0644\u0639\u0648\u0636 \u0628\u0633\u0644\u0627\u0645\u062A\u0643", "\u0627\u0644\u0628\u0642\u064A\u0629 \u0628\u062D\u064A\u0627\u062A\u0643"],
      iq: ["\u0627\u0644\u0644\u0647 \u064A\u0631\u062D\u0645\u0647 \u{1F90D}", "\u0639\u0638\u0645 \u0627\u0644\u0644\u0647 \u0623\u062C\u0631\u0643\u0645", "\u0625\u0646\u0627 \u0644\u0644\u0647 \u0648\u0625\u0646\u0627 \u0625\u0644\u064A\u0647 \u0631\u0627\u062C\u0639\u0648\u0646", "\u0627\u0644\u0644\u0647 \u064A\u0635\u0628\u0631\u0643\u0645", "\u0627\u0644\u0628\u0642\u064A\u0629 \u0628\u062D\u064A\u0627\u062A\u0643\u0645"]
    }
  },
  {
    ar: /السلام عليكم|سلام عليكم/,
    en: /\b(assalam|salam|salaam) ?(u )?alaikum\b/,
    replies: {
      en: ["Wa alaikum assalam \u{1F44B}", "Wa alaikum assalam! How are you?", "Wa alaikum assalam, good to hear from you"],
      ar: ["\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u{1F44B}", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u0648\u0631\u062D\u0645\u0629 \u0627\u0644\u0644\u0647 \u0648\u0628\u0631\u0643\u0627\u062A\u0647", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0647\u0644\u0627 \u0648\u0627\u0644\u0644\u0647", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0643\u064A\u0641\u0643\u061F", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u062D\u064A\u0627\u0643 \u0627\u0644\u0644\u0647", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u064A\u0627 \u0647\u0644\u0627"],
      eg: ["\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u{1F44B}", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u0648\u0631\u062D\u0645\u0629 \u0627\u0644\u0644\u0647", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0625\u0632\u064A\u0643\u061F", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0645\u0646\u0648\u0631 \u{1F604}"],
      lev: ["\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u{1F44B}", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u0648\u0631\u062D\u0645\u0629 \u0627\u0644\u0644\u0647", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0643\u064A\u0641\u0643\u061F", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0623\u0647\u0644\u064A\u0646"],
      iq: ["\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u{1F44B}", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u0648\u0631\u062D\u0645\u0629 \u0627\u0644\u0644\u0647", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0634\u0644\u0648\u0646\u0643\u061F", "\u0648\u0639\u0644\u064A\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060C \u0647\u0644\u0627 \u0628\u064A\u0643"]
    }
  },
  {
    ar: /عيد ميلادي/,
    en: /\bit'?s my (birthday|bday)\b/,
    replies: {
      en: ["Happy birthday!! \u{1F389}\u{1F382}", "Happy birthday! Have an amazing day \u{1F973}", "HBD! \u{1F382} Wishing you the best", "Happy birthday! Many happy returns \u{1F388}"],
      ar: ["\u0643\u0644 \u0639\u0627\u0645 \u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F382}", "\u0639\u064A\u062F \u0645\u064A\u0644\u0627\u062F \u0633\u0639\u064A\u062F \u{1F389}", "\u0643\u0644 \u0639\u0627\u0645 \u0648\u0627\u0646\u062A \u0628\u0623\u0644\u0641 \u062E\u064A\u0631\u060C \u0639\u0642\u0628\u0627\u0644 \u0627\u0644\u0645\u064A\u0629 \u{1F973}", "\u064A\u0627 \u0647\u0644\u0627 \u0628\u0639\u064A\u062F \u0645\u064A\u0644\u0627\u062F\u0643 \u{1F382} \u0627\u0644\u0644\u0647 \u064A\u0633\u0639\u062F\u0643", "\u0639\u0633\u0627\u0643 \u0645\u0646 \u0639\u0648\u0627\u062F\u0647 \u{1F388}"],
      eg: ["\u0643\u0644 \u0633\u0646\u0629 \u0648\u0627\u0646\u062A \u0637\u064A\u0628 \u{1F382}", "\u0639\u064A\u062F \u0645\u064A\u0644\u0627\u062F \u0633\u0639\u064A\u062F \u{1F389}", "\u0643\u0644 \u0633\u0646\u0629 \u0648\u0627\u0646\u062A \u0637\u064A\u0628 \u064A\u0627 \u0628\u0627\u0634\u0627\u060C \u0639\u0642\u0628\u0627\u0644 \u0661\u0660\u0660 \u0633\u0646\u0629 \u{1F973}"],
      lev: ["\u0643\u0644 \u0639\u0627\u0645 \u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F382}", "\u0639\u064A\u062F \u0645\u064A\u0644\u0627\u062F \u0633\u0639\u064A\u062F \u{1F389}", "\u0643\u0644 \u0633\u0646\u0629 \u0648\u0627\u0646\u062A \u0633\u0627\u0644\u0645\u060C \u0639\u0642\u0628\u0627\u0644 \u0627\u0644\u0645\u064A\u0629 \u{1F973}"],
      iq: ["\u0643\u0644 \u0639\u0627\u0645 \u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F382}", "\u0639\u064A\u062F \u0645\u064A\u0644\u0627\u062F \u0633\u0639\u064A\u062F \u{1F389}", "\u0639\u064A\u062F \u0645\u064A\u0644\u0627\u062F \u0633\u0639\u064A\u062F \u0639\u064A\u0646\u064A\u060C \u0639\u0642\u0628\u0627\u0644 \u0627\u0644\u0645\u064A\u0629 \u{1F973}"]
    }
  },
  {
    ar: /عيد ميلاد سعيد|ميلاد سعيد|عيد ميلادك/,
    en: /\b(happy birthday|hbd|happy bday)\b/,
    replies: {
      en: ["Thank you so much! \u{1F973}", "Thanks!! \u2764\uFE0F", "Aww thank you \u{1F979}", "Thank you, appreciate it!", "You're the best, thanks! \u{1F382}"],
      ar: ["\u0627\u0644\u0644\u0647 \u064A\u0633\u0644\u0645\u0643\u060C \u0634\u0643\u0631\u0627\u064B \u{1F973}", "\u062A\u0633\u0644\u0645 \u0639\u0644\u0649 \u0627\u0644\u062A\u0647\u0646\u0626\u0629 \u2764\uFE0F", "\u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u064A\u0627 \u0631\u0628 \u{1F382}", "\u0634\u0643\u0631\u0627\u064B\u060C \u0645\u0627 \u062A\u0642\u0635\u0631 \u{1F979}", "\u0627\u0644\u0644\u0647 \u064A\u0633\u0639\u062F\u0643\u060C \u062A\u0633\u0644\u0645"],
      eg: ["\u0645\u064A\u0631\u0633\u064A \u0623\u0648\u064A \u{1F973}", "\u062A\u0633\u0644\u0645 \u064A\u0627 \u062D\u0628\u064A\u0628\u064A \u2764\uFE0F", "\u0648\u0627\u0646\u062A \u0637\u064A\u0628 \u{1F382}", "\u0631\u0628\u0646\u0627 \u064A\u062E\u0644\u064A\u0643 \u{1F979}"],
      lev: ["\u064A\u0633\u0644\u0645\u0648 \u0643\u062A\u064A\u0631 \u{1F973}", "\u062A\u0633\u0644\u0645 \u2764\uFE0F", "\u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F382}", "\u0627\u0644\u0644\u0647 \u064A\u062E\u0644\u064A\u0643 \u{1F979}"],
      iq: ["\u062A\u0633\u0644\u0645 \u0639\u064A\u0646\u064A \u{1F973}", "\u0627\u0644\u0644\u0647 \u064A\u062E\u0644\u064A\u0643 \u2764\uFE0F", "\u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F382}", "\u062A\u0633\u0644\u0645\u0644\u064A \u{1F979}"]
    }
  },
  {
    ar: /رمضان/,
    en: /\bramadan\b/,
    replies: {
      en: ["Ramadan Mubarak! \u{1F319}", "Ramadan Kareem to you too \u{1F319}", "Wishing you a blessed Ramadan", "May Allah accept your fasting \u{1F932}"],
      ar: ["\u0631\u0645\u0636\u0627\u0646 \u0643\u0631\u064A\u0645 \u{1F319}", "\u0627\u0644\u0644\u0647 \u0623\u0643\u0631\u0645\u060C \u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631", "\u0631\u0645\u0636\u0627\u0646 \u0645\u0628\u0627\u0631\u0643 \u0639\u0644\u064A\u0643 \u0648\u0639\u0644\u0649 \u0623\u0647\u0644\u0643 \u{1F319}", "\u0627\u0644\u0644\u0647 \u064A\u0628\u0644\u063A\u0646\u0627 \u0648\u0625\u064A\u0627\u0643", "\u0639\u0644\u064A\u0646\u0627 \u0648\u0639\u0644\u064A\u0643 \u064A\u062A\u0645 \u0628\u062E\u064A\u0631"],
      eg: ["\u0631\u0645\u0636\u0627\u0646 \u0643\u0631\u064A\u0645 \u{1F319}", "\u0627\u0644\u0644\u0647 \u0623\u0643\u0631\u0645", "\u0643\u0644 \u0633\u0646\u0629 \u0648\u0627\u0646\u062A \u0637\u064A\u0628 \u{1F319}"],
      lev: ["\u0631\u0645\u0636\u0627\u0646 \u0643\u0631\u064A\u0645 \u{1F319}", "\u0627\u0644\u0644\u0647 \u0623\u0643\u0631\u0645", "\u0643\u0644 \u0639\u0627\u0645 \u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F319}"],
      iq: ["\u0631\u0645\u0636\u0627\u0646 \u0643\u0631\u064A\u0645 \u{1F319}", "\u0627\u0644\u0644\u0647 \u0623\u0643\u0631\u0645", "\u0634\u0647\u0631 \u0645\u0628\u0627\u0631\u0643 \u0639\u0644\u064A\u0643 \u{1F319}"]
    }
  },
  {
    ar: /عيد مبارك|عيدك مبارك|عيدكم مبارك|كل عام وانت|كل سنه وانت|عساكم من عواده|عيد سعيد/,
    en: /\b(eid mubarak|happy eid)\b/,
    replies: {
      en: ["Eid Mubarak! \u{1F389}", "Eid Mubarak to you too! \u{1F319}", "Have a blessed Eid!", "Eid Mubarak to you and your family \u{1F90D}"],
      ar: ["\u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F389}", "\u0639\u064A\u062F\u0643 \u0645\u0628\u0627\u0631\u0643 \u{1F319}", "\u064A\u0646\u0639\u0627\u062F \u0639\u0644\u064A\u0643 \u0628\u0627\u0644\u062E\u064A\u0631 \u0648\u0627\u0644\u0635\u062D\u0629", "\u0627\u0644\u0644\u0647 \u064A\u062A\u0642\u0628\u0644 \u0645\u0646\u0627 \u0648\u0645\u0646\u0643\u0645", "\u0645\u0646 \u0627\u0644\u0639\u0627\u064A\u062F\u064A\u0646 \u0648\u0627\u0644\u0641\u0627\u064A\u0632\u064A\u0646", "\u0648\u0627\u0646\u062A \u0645\u0646 \u0623\u0647\u0644\u0647\u060C \u0639\u0633\u0627\u0643 \u0645\u0646 \u0639\u0648\u0627\u062F\u0647"],
      eg: ["\u0648\u0627\u0646\u062A \u0637\u064A\u0628 \u{1F389}", "\u0643\u0644 \u0633\u0646\u0629 \u0648\u0627\u0646\u062A \u0637\u064A\u0628", "\u0639\u064A\u062F \u0633\u0639\u064A\u062F \u0639\u0644\u064A\u0643 \u0648\u0639\u0644\u0649 \u0623\u0647\u0644\u0643 \u{1F319}"],
      lev: ["\u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F389}", "\u064A\u0646\u0639\u0627\u062F \u0639\u0644\u064A\u0643 \u{1F319}", "\u0643\u0644 \u0639\u0627\u0645 \u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631"],
      iq: ["\u0648\u0627\u0646\u062A \u0628\u062E\u064A\u0631 \u{1F389}", "\u0623\u064A\u0627\u0645\u0643 \u0633\u0639\u064A\u062F\u0629 \u{1F319}", "\u0639\u064A\u062F \u0633\u0639\u064A\u062F \u0639\u0644\u064A\u0643 \u0648\u0639\u0644\u0649 \u0623\u0647\u0644\u0643"]
    }
  },
  {
    ar: /جمعه مباركه/,
    en: /\b(jumma|jummah|jumu'?ah) mubarak\b/,
    replies: {
      en: ["Jumu'ah Mubarak! \u{1F90D}", "Jumu'ah Mubarak to you too", "May Allah bless your Friday \u{1F932}"],
      ar: ["\u062C\u0645\u0639\u0629 \u0645\u0628\u0627\u0631\u0643\u0629 \u0639\u0644\u064A\u0643 \u{1F90D}", "\u0639\u0644\u064A\u0646\u0627 \u0648\u0639\u0644\u064A\u0643", "\u0627\u0644\u0644\u0647 \u064A\u062A\u0642\u0628\u0644 \u0645\u0646\u0627 \u0648\u0645\u0646\u0643", "\u062C\u0645\u0639\u0629 \u0645\u0628\u0627\u0631\u0643\u0629\u060C \u0627\u0644\u0644\u0647 \u064A\u0633\u0639\u062F\u0643"]
    }
  },
  {
    ar: /مبروك|مبارك عليك|الف مبروك/,
    en: /\b(congrats|congratulations|congratz)\b/,
    replies: {
      en: ["Thank you! \u{1F64F}", "Thanks a lot! \u2764\uFE0F", "Appreciate it!", "Thank you, means a lot \u{1F979}", "Thanks so much! \u{1F389}"],
      ar: ["\u0627\u0644\u0644\u0647 \u064A\u0628\u0627\u0631\u0643 \u0641\u064A\u0643 \u{1F64F}", "\u064A\u0628\u0627\u0631\u0643 \u0641\u064A\u0643\u060C \u062A\u0633\u0644\u0645", "\u0634\u0643\u0631\u0627\u064B \u2764\uFE0F", "\u0627\u0644\u0644\u0647 \u064A\u0628\u0627\u0631\u0643 \u0641\u064A\u0643 \u0648\u0639\u0642\u0628\u0627\u0644\u0643", "\u062A\u0633\u0644\u0645\u060C \u0627\u0644\u0644\u0647 \u064A\u0633\u0639\u062F\u0643"],
      eg: ["\u0627\u0644\u0644\u0647 \u064A\u0628\u0627\u0631\u0643 \u0641\u064A\u0643 \u{1F64F}", "\u0645\u064A\u0631\u0633\u064A \u0623\u0648\u064A \u2764\uFE0F", "\u0639\u0642\u0628\u0627\u0644\u0643 \u064A\u0627 \u0631\u0628", "\u062A\u0633\u0644\u0645 \u064A\u0627 \u062D\u0628\u064A\u0628\u064A"],
      lev: ["\u0627\u0644\u0644\u0647 \u064A\u0628\u0627\u0631\u0643 \u0641\u064A\u0643 \u{1F64F}", "\u064A\u0633\u0644\u0645\u0648 \u2764\uFE0F", "\u0639\u0642\u0628\u0627\u0644\u0643", "\u062A\u0633\u0644\u0645 \u0643\u062A\u064A\u0631"],
      iq: ["\u0627\u0644\u0644\u0647 \u064A\u0628\u0627\u0631\u0643 \u0628\u064A\u0643 \u{1F64F}", "\u062A\u0633\u0644\u0645 \u0639\u064A\u0646\u064A \u2764\uFE0F", "\u0639\u0642\u0628\u0627\u0644\u0643", "\u0627\u0644\u0644\u0647 \u064A\u062E\u0644\u064A\u0643"]
    }
  },
  {
    ar: /نجحت|تخرجت|توظفت|انقبلت|خبر حلو|اخبار حلوه|تعينت/,
    en: /\b(i passed|i got the job|i got in|good news|i graduated|i did it)\b/,
    replies: {
      en: ["Congrats!! \u{1F389}", "That's awesome, well deserved \u{1F44F}", "So happy for you!", "Let's gooo! \u{1F973}", "Proud of you! \u{1F4AA}"],
      ar: ["\u0645\u0628\u0631\u0648\u0643! \u{1F389}", "\u0623\u0644\u0641 \u0645\u0628\u0631\u0648\u0643\u060C \u062A\u0633\u062A\u0627\u0647\u0644 \u{1F44F}", "\u0627\u0644\u0644\u0647 \u064A\u0628\u0627\u0631\u0643 \u0641\u064A\u0643 \u0648\u064A\u0648\u0641\u0642\u0643", "\u064A\u0627 \u0633\u0644\u0627\u0645! \u0641\u0631\u062D\u062A\u0644\u0643 \u0648\u0627\u0644\u0644\u0647 \u{1F973}", "\u0643\u0641\u0648! \u062A\u0633\u062A\u0627\u0647\u0644 \u0643\u0644 \u062E\u064A\u0631 \u{1F4AA}"],
      eg: ["\u0645\u0628\u0631\u0648\u0643! \u{1F389}", "\u0623\u0644\u0641 \u0645\u0628\u0631\u0648\u0643\u060C \u062A\u0633\u062A\u0627\u0647\u0644 \u{1F44F}", "\u0627\u0644\u0644\u0647 \u064A\u0646\u0648\u0631 \u064A\u0627 \u0628\u0627\u0634\u0627 \u{1F973}", "\u0641\u0631\u062D\u062A\u0644\u0643 \u0623\u0648\u064A"],
      lev: ["\u0645\u0628\u0631\u0648\u0643! \u{1F389}", "\u0623\u0644\u0641 \u0645\u0628\u0631\u0648\u0643\u060C \u0628\u062A\u0633\u062A\u0627\u0647\u0644 \u{1F44F}", "\u064A\u0627 \u0633\u0644\u0627\u0645! \u0627\u0646\u0628\u0633\u0637\u062A\u0644\u0643 \u0643\u062A\u064A\u0631 \u{1F973}", "\u0627\u0644\u0644\u0647 \u064A\u0648\u0641\u0642\u0643"],
      iq: ["\u0645\u0628\u0631\u0648\u0643! \u{1F389}", "\u0623\u0644\u0641 \u0645\u0628\u0631\u0648\u0643\u060C \u062A\u0633\u062A\u0627\u0647\u0644 \u{1F44F}", "\u0641\u0631\u062D\u062A\u0644\u064A \u0643\u0644\u0634 \u{1F973}", "\u0627\u0644\u0644\u0647 \u064A\u0648\u0641\u0642\u0643 \u0639\u064A\u0646\u064A"]
    }
  },
  {
    ar: /صباح الخير|صباحو|صباح النور|صباح الورد|صباح الفل/,
    en: /\b(good morning|gm|morning)\b/,
    replies: {
      en: ["Good morning! \u2600\uFE0F", "Morning! How'd you sleep?", "Good morning \u{1F60A} Have a nice day", "Morning! \u2615"],
      ar: ["\u0635\u0628\u0627\u062D \u0627\u0644\u0646\u0648\u0631 \u2600\uFE0F", "\u0635\u0628\u0627\u062D \u0627\u0644\u0648\u0631\u062F \u{1F338}", "\u0635\u0628\u0627\u062D \u0627\u0644\u062E\u064A\u0631\u060C \u0643\u064A\u0641\u0643 \u0627\u0644\u064A\u0648\u0645\u061F", "\u0635\u0628\u0627\u062D\u0643 \u0633\u0639\u0627\u062F\u0629 \u2600\uFE0F", "\u0635\u0628\u0627\u062D \u0627\u0644\u062E\u064A\u0631\u0627\u062A"],
      eg: ["\u0635\u0628\u0627\u062D \u0627\u0644\u0646\u0648\u0631 \u2600\uFE0F", "\u0635\u0628\u0627\u062D \u0627\u0644\u0641\u0644 \u{1F338}", "\u0635\u0628\u0627\u062D \u0627\u0644\u062E\u064A\u0631\u060C \u0639\u0627\u0645\u0644 \u0625\u064A\u0647 \u0627\u0644\u0646\u0647\u0627\u0631\u062F\u0647\u061F"],
      lev: ["\u0635\u0628\u0627\u062D \u0627\u0644\u0646\u0648\u0631 \u2600\uFE0F", "\u0635\u0628\u0627\u062D \u0627\u0644\u0648\u0631\u062F \u{1F338}", "\u0635\u0628\u0627\u062D\u0648\u060C \u0643\u064A\u0641\u0643 \u0627\u0644\u064A\u0648\u0645\u061F"],
      iq: ["\u0635\u0628\u0627\u062D \u0627\u0644\u0646\u0648\u0631 \u2600\uFE0F", "\u0635\u0628\u0627\u062D \u0627\u0644\u0648\u0631\u062F \u{1F338}", "\u0635\u0628\u0627\u062D \u0627\u0644\u062E\u064A\u0631\u060C \u0634\u0644\u0648\u0646\u0643 \u0627\u0644\u064A\u0648\u0645\u061F"]
    }
  },
  {
    ar: /مساء الخير|مسا الخير|مساء النور|مساء الورد|مساء الفل/,
    en: /\bgood (evening|afternoon)\b/,
    replies: {
      en: ["Good evening! \u{1F319}", "Evening! How was your day?", "Good evening \u{1F60A}"],
      ar: ["\u0645\u0633\u0627\u0621 \u0627\u0644\u0646\u0648\u0631 \u{1F319}", "\u0645\u0633\u0627\u0621 \u0627\u0644\u0648\u0631\u062F \u{1F338}", "\u0645\u0633\u0627\u0621 \u0627\u0644\u062E\u064A\u0631\u060C \u0643\u064A\u0641 \u0643\u0627\u0646 \u064A\u0648\u0645\u0643\u061F", "\u0645\u0633\u0627\u0621 \u0627\u0644\u062E\u064A\u0631\u0627\u062A"],
      eg: ["\u0645\u0633\u0627\u0621 \u0627\u0644\u0646\u0648\u0631 \u{1F319}", "\u0645\u0633\u0627\u0621 \u0627\u0644\u0641\u0644 \u{1F338}", "\u0645\u0633\u0627\u0621 \u0627\u0644\u062E\u064A\u0631\u060C \u064A\u0648\u0645\u0643 \u0643\u0627\u0646 \u0639\u0627\u0645\u0644 \u0625\u064A\u0647\u061F"],
      lev: ["\u0645\u0633\u0627\u0621 \u0627\u0644\u0646\u0648\u0631 \u{1F319}", "\u0645\u0633\u0627\u0621 \u0627\u0644\u0648\u0631\u062F \u{1F338}", "\u0645\u0633\u0627 \u0627\u0644\u062E\u064A\u0631\u060C \u0643\u064A\u0641 \u0643\u0627\u0646 \u0646\u0647\u0627\u0631\u0643\u061F"],
      iq: ["\u0645\u0633\u0627\u0621 \u0627\u0644\u0646\u0648\u0631 \u{1F319}", "\u0645\u0633\u0627\u0621 \u0627\u0644\u0648\u0631\u062F \u{1F338}", "\u0645\u0633\u0627\u0621 \u0627\u0644\u062E\u064A\u0631\u060C \u0634\u0644\u0648\u0646 \u0643\u0627\u0646 \u064A\u0648\u0645\u0643\u061F"]
    }
  },
  {
    ar: /وش تسوي|ايش تسوي|شنو تسوي|شو تسوي|وش تعمل|ايش تعمل|شو تعمل|شو عم تعمل|شو بتعمل|شو عم تساوي|بتعمل ايه|بتعملي ايه|شتسوي|شدتسوي|وش قاعد تسوي|شنو دتسوي/,
    en: /\b(what are you doing|what r u doing|wyd|what you up to|whatcha doing)\b/,
    replies: {
      en: ["Nothing much, you?", "Just gaming \u{1F3AE}", "Working a bit", "Just chilling \u{1F605}", "Bored, honestly \u{1F602}"],
      ar: ["\u0648\u0644\u0627 \u0634\u064A\u060C \u0627\u0646\u062A\u061F", "\u0642\u0627\u0639\u062F \u0623\u0644\u0639\u0628 \u{1F3AE}", "\u0623\u0634\u062A\u063A\u0644 \u0634\u0648\u064A", "\u0645\u0646\u0633\u062F\u062D \u0628\u0633 \u{1F605}", "\u0648\u0644\u0627 \u0634\u064A\u060C \u0637\u0641\u0634\u0627\u0646", "\u0623\u062A\u0627\u0628\u0639 \u0634\u064A\u060C \u0648\u0627\u0646\u062A\u061F"],
      eg: ["\u0648\u0644\u0627 \u062D\u0627\u062C\u0629\u060C \u0625\u0646\u062A\u061F", "\u0628\u0644\u0639\u0628 \u{1F3AE}", "\u0628\u0634\u062A\u063A\u0644 \u0634\u0648\u064A\u0629", "\u0642\u0627\u0639\u062F \u0643\u062F\u0647 \u{1F605}", "\u0632\u0647\u0642\u0627\u0646 \u0648\u0627\u0644\u0644\u0647"],
      lev: ["\u0648\u0644\u0627 \u0634\u064A\u060C \u0627\u0646\u062A\u061F", "\u0639\u0645 \u0625\u0644\u0639\u0628 \u{1F3AE}", "\u0639\u0645 \u0625\u0634\u062A\u063A\u0644 \u0634\u0648\u064A", "\u0642\u0627\u0639\u062F \u0647\u064A\u0643 \u{1F605}", "\u0636\u062C\u0631\u0627\u0646 \u0648\u0627\u0644\u0644\u0647"],
      iq: ["\u0648\u0644\u0627 \u0634\u064A\u060C \u0627\u0646\u062A\u061F", "\u062F\u0627 \u0623\u0644\u0639\u0628 \u{1F3AE}", "\u062F\u0627 \u0623\u0634\u062A\u063A\u0644 \u0634\u0648\u064A\u0629", "\u0643\u0627\u0639\u062F \u0628\u0633 \u{1F605}", "\u0636\u0627\u064A\u062C \u0648\u0627\u0644\u0644\u0647"]
    }
  },
  {
    // only when they're complimenting it, so "send your photo" isn't mistaken for praise
    ar: /(صورتك|بروفايلك|افتارك|البروفايل|الافتار|صوره البروفايل).{0,15}(حلو|حلوه|روعه|جميل|جميله|تجنن|كيوت|خرافي)|(حلو|حلوه|روعه|جميل|جميله|تجنن|كيوت|خرافي).{0,15}(صورتك|بروفايلك|افتارك|البروفايل|الافتار)/,
    en: /\b(nice|cool|cute|love|great|sick|fire) (pfp|profile pic|profile picture|avatar)\b|\byour (pfp|avatar|profile pic)\b.{0,15}\b(nice|cool|cute|great|fire)\b/,
    replies: {
      en: ["Thanks! \u{1F604}", "Haha thank you, yours is cool too", "Glad you like it!", "Thanks, took me ages to pick \u{1F602}"],
      ar: ["\u062A\u0633\u0644\u0645 \u{1F604} \u0639\u064A\u0648\u0646\u0643 \u0627\u0644\u062D\u0644\u0648\u0629", "\u0634\u0643\u0631\u0627\u064B\u060C \u0635\u0648\u0631\u062A\u0643 \u0623\u062D\u0644\u0649", "\u062D\u0644\u0648\u0629\u061F \u{1F604}", "\u062A\u0633\u0644\u0645\u060C \u0627\u062E\u062A\u0631\u062A\u0647\u0627 \u0645\u0646 \u0632\u0645\u0627\u0646", "\u0627\u0644\u0644\u0647 \u064A\u0633\u0644\u0645\u0643 \u2764\uFE0F"],
      eg: ["\u0645\u064A\u0631\u0633\u064A \u{1F604}", "\u062A\u0633\u0644\u0645\u060C \u0635\u0648\u0631\u062A\u0643 \u0623\u062D\u0644\u0649", "\u062D\u0644\u0648\u0629\u061F \u{1F604}"],
      lev: ["\u064A\u0633\u0644\u0645\u0648 \u{1F604}", "\u062A\u0633\u0644\u0645\u060C \u0635\u0648\u0631\u062A\u0643 \u0623\u062D\u0644\u0649", "\u062D\u0644\u0648\u0629\u061F \u{1F604}"],
      iq: ["\u062A\u0633\u0644\u0645 \u0639\u064A\u0646\u064A \u{1F604}", "\u0635\u0648\u0631\u062A\u0643 \u0623\u062D\u0644\u0649", "\u062D\u0644\u0648\u0629\u061F \u{1F604}"]
    }
  },
  {
    ar: /سهران|ما نمت|مو نايم|ما جاني نوم|ما جاني النوم|لسه صاحي|صاحي للحين|صاحي لهلق|مش جايلي نوم/,
    en: /\b(can'?t sleep|still up|still awake|staying up|up late|insomnia)\b/,
    replies: {
      en: ["Same, can't sleep either \u{1F605}", "Go to sleep, it's late!", "What's keeping you up?", "Night owls \u{1F319}"],
      ar: ["\u0648\u0627\u0646\u0627 \u0633\u0647\u0631\u0627\u0646 \u0628\u0639\u062F \u{1F605}", "\u0646\u0627\u0645 \u064A\u0627 \u0631\u062C\u0627\u0644\u060C \u0627\u0644\u0648\u0642\u062A \u0645\u062A\u0623\u062E\u0631", "\u0648\u0634 \u0645\u0633\u0647\u0631\u0643\u061F", "\u0633\u0647\u0631\u0627\u0646\u064A\u0646 \u0633\u0648\u0627 \u{1F319}", "\u0631\u0648\u062D \u0646\u0627\u0645\u060C \u0628\u0643\u0631\u0629 \u0639\u0646\u062F\u0643 \u064A\u0648\u0645"],
      eg: ["\u0648\u0627\u0646\u0627 \u0633\u0647\u0631\u0627\u0646 \u0643\u0645\u0627\u0646 \u{1F605}", "\u0646\u0627\u0645 \u064A\u0627 \u0639\u0645 \u0627\u0644\u0648\u0642\u062A \u0627\u062A\u0623\u062E\u0631", "\u0625\u064A\u0647 \u0627\u0644\u0644\u064A \u0645\u0633\u0647\u0631\u0643\u061F"],
      lev: ["\u0648\u0627\u0646\u0627 \u0633\u0647\u0631\u0627\u0646 \u0643\u0645\u0627\u0646 \u{1F605}", "\u0646\u0627\u0645 \u064A\u0627 \u0632\u0644\u0645\u0629 \u0635\u0627\u0631 \u0627\u0644\u0648\u0642\u062A \u0645\u062A\u0623\u062E\u0631", "\u0634\u0648 \u0645\u0633\u0647\u0631\u0643\u061F"],
      iq: ["\u0648\u0627\u0646\u0627 \u0647\u0645 \u0633\u0647\u0631\u0627\u0646 \u{1F605}", "\u0646\u0627\u0645 \u064A\u0645\u0639\u0648\u062F \u0635\u0627\u0631 \u0645\u062A\u0623\u062E\u0631", "\u0634\u0645\u0633\u0647\u0631\u0643\u061F"]
    }
  },
  {
    ar: /ساعدني|تساعدني|ممكن تساعد|محتاج مساعده|ابي مساعده|ابغي مساعده|فزعتك|فزعه|ممكن خدمه|عندي طلب|عايز مساعده|بدي مساعده|اريد مساعده/,
    en: /\b(help me|can you help|could you help|need (your |some )?help|a favou?r|do me a favou?r)\b/,
    replies: {
      en: ["Sure, what do you need?", "Of course, tell me", "Happy to help, what's up?", "Yeah, what's going on?"],
      ar: ["\u0623\u0643\u064A\u062F\u060C \u0648\u0634 \u062A\u062D\u062A\u0627\u062C\u061F", "\u062A\u0627\u0645\u0631\u060C \u0642\u0648\u0644", "\u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647\u060C \u0648\u0634 \u0627\u0644\u0633\u0627\u0644\u0641\u0629\u061F", "\u062D\u0627\u0636\u0631\u060C \u0628\u0633 \u0642\u0648\u0644\u064A \u0648\u0634 \u0627\u0644\u0645\u0637\u0644\u0648\u0628", "\u0623\u0628\u0634\u0631\u060C \u0648\u0634 \u0639\u0646\u062F\u0643\u061F"],
      eg: ["\u0623\u0643\u064A\u062F\u060C \u0645\u062D\u062A\u0627\u062C \u0625\u064A\u0647\u061F", "\u062A\u062D\u062A \u0623\u0645\u0631\u0643\u060C \u0642\u0648\u0644", "\u0637\u0628\u0639\u0627\u064B\u060C \u0641\u064A \u0625\u064A\u0647\u061F"],
      lev: ["\u0623\u0643\u064A\u062F\u060C \u0634\u0648 \u0628\u062F\u0643\u061F", "\u062A\u0643\u0631\u0645\u060C \u0627\u062D\u0643\u064A", "\u0623\u0643\u064A\u062F\u060C \u0634\u0648 \u0627\u0644\u0642\u0635\u0629\u061F"],
      iq: ["\u0623\u0643\u064A\u062F\u060C \u0634\u062A\u062D\u062A\u0627\u062C\u061F", "\u062A\u0627\u0645\u0631\u060C \u0643\u0648\u0644", "\u0623\u0643\u064A\u062F\u060C \u0634\u0646\u0648 \u0627\u0644\u0633\u0627\u0644\u0641\u0629\u061F"]
    }
  },
  {
    ar: /سلفني|اقرضني|فلوس|مصاري|محتاج مبلغ|عندك مبلغ|رجعلي فلوسي|دينك/,
    en: /\b(lend me|borrow|money|cash|pay me back|you owe me)\b/,
    replies: {
      en: ["How much do you need?", "I'm broke right now \u{1F605}", "Let me see what I can do", "Can we talk about it first?"],
      ar: ["\u0643\u0645 \u062A\u062D\u062A\u0627\u062C\u061F", "\u0648\u0627\u0644\u0644\u0647 \u0645\u0627 \u0645\u0639\u064A \u0627\u0644\u062D\u064A\u0646 \u{1F605}", "\u062E\u0644\u0646\u064A \u0623\u0634\u0648\u0641 \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643", "\u0645\u0645\u0643\u0646 \u0646\u062A\u0643\u0644\u0645 \u0641\u064A \u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u0623\u0648\u0644\u061F"],
      eg: ["\u0645\u062D\u062A\u0627\u062C \u0643\u0627\u0645\u061F", "\u0648\u0627\u0644\u0644\u0647 \u0645\u0641\u0644\u0633 \u062F\u0644\u0648\u0642\u062A\u064A \u{1F605}", "\u0647\u0634\u0648\u0641 \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643"],
      lev: ["\u0642\u062F\u064A\u0634 \u0628\u062F\u0643\u061F", "\u0648\u0627\u0644\u0644\u0647 \u0645\u0641\u0644\u0633 \u0647\u0644\u0642 \u{1F605}", "\u062E\u0644\u064A\u0646\u064A \u0634\u0648\u0641 \u0648\u0628\u0631\u062C\u0639\u0644\u0643"],
      iq: ["\u0634\u0643\u062F \u062A\u062D\u062A\u0627\u062C\u061F", "\u0648\u0627\u0644\u0644\u0647 \u0645\u0627\u0639\u0646\u062F\u064A \u0647\u0633\u0647 \u{1F605}", "\u062E\u0644\u064A \u0623\u0634\u0648\u0641 \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643"]
    }
  },
  {
    ar: /مباراه|ماتش|الدوري|ريال مدريد|برشلونه|الهلال|النصر|الاتحاد|الاهلي|الزمالك|ميسي|رونالدو|كوره|كره القدم|كاس العالم|هاتريك/,
    en: /\b(football|soccer|goal|messi|ronaldo|madrid|barca|premier league|champions league|world cup|hat ?trick)\b/,
    replies: {
      en: ["Did you watch the match? \u{1F525}", "Who do you support? \u26BD", "That game was crazy!", "Facts \u{1F410}", "Football is life \u26BD"],
      ar: ["\u0634\u0641\u062A \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629\u061F \u{1F525}", "\u0645\u064A\u0646 \u062A\u0634\u062C\u0639\u061F \u26BD", "\u0648\u0627\u0644\u0644\u0647 \u0643\u0627\u0646\u062A \u0645\u0628\u0627\u0631\u0627\u0629 \u0646\u0627\u0631", "\u0623\u0633\u0637\u0648\u0631\u0629 \u0641\u0639\u0644\u0627\u064B \u{1F410}", "\u0635\u062F\u0642\u062A \u26BD", "\u064A\u0627 \u0634\u064A\u062E \u0644\u0627 \u062A\u0630\u0643\u0631\u0646\u064A \u{1F602}"],
      eg: ["\u0634\u0641\u062A \u0627\u0644\u0645\u0627\u062A\u0634\u061F \u{1F525}", "\u0628\u062A\u0634\u062C\u0639 \u0645\u064A\u0646\u061F \u26BD", "\u0627\u0644\u0645\u0627\u062A\u0634 \u0643\u0627\u0646 \u0646\u0627\u0631", "\u0623\u0633\u0637\u0648\u0631\u0629 \u0641\u0639\u0644\u0627\u064B \u{1F410}"],
      lev: ["\u0634\u0641\u062A \u0627\u0644\u0645\u0627\u062A\u0634\u061F \u{1F525}", "\u0645\u064A\u0646 \u0628\u062A\u0634\u062C\u0639\u061F \u26BD", "\u0643\u0627\u0646 \u0645\u0627\u062A\u0634 \u0646\u0627\u0631", "\u0623\u0633\u0637\u0648\u0631\u0629 \u0639\u0646\u062C\u062F \u{1F410}"],
      iq: ["\u0634\u0641\u062A \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629\u061F \u{1F525}", "\u0645\u0646\u0648 \u062A\u0634\u062C\u0639\u061F \u26BD", "\u0643\u0627\u0646\u062A \u0645\u0628\u0627\u0631\u0627\u0629 \u0646\u0627\u0631", "\u0623\u0633\u0637\u0648\u0631\u0629 \u0635\u062F\u0643 \u{1F410}"]
    }
  },
  {
    ar: /فلم|فيلم|مسلسل|انمي|نتفلكس|حلقه|سيزون|الموسم الجديد/,
    en: /\b(movie|film|series|episode|season|netflix|anime)\b/,
    replies: {
      en: ["What's it called? \u{1F37F}", "Is it good?", "No spoilers! \u{1F602}", "I loved that one!", "Wanna watch it together?"],
      ar: ["\u0648\u0634 \u0627\u0633\u0645\u0647\u061F \u{1F37F}", "\u064A\u0633\u062A\u0627\u0647\u0644\u061F", "\u0634\u0641\u062A\u0647! \u062E\u0631\u0627\u0641\u064A", "\u0644\u0627 \u062A\u062D\u0631\u0642\u0647 \u0639\u0644\u064A \u{1F602}", "\u0646\u0634\u0648\u0641\u0647 \u0633\u0648\u0627\u061F"],
      eg: ["\u0627\u0633\u0645\u0647 \u0625\u064A\u0647\u061F \u{1F37F}", "\u062D\u0644\u0648\u061F", "\u0645\u062A\u062D\u0631\u0642\u0648\u0634 \u0639\u0644\u064A\u0627 \u{1F602}", "\u0646\u062A\u0641\u0631\u062C \u0639\u0644\u064A\u0647 \u0633\u0648\u0627\u061F"],
      lev: ["\u0634\u0648 \u0627\u0633\u0645\u0648\u061F \u{1F37F}", "\u062D\u0644\u0648\u061F", "\u0644\u0627 \u062A\u062D\u0631\u0642\u0644\u064A \u064A\u0627\u0647 \u{1F602}", "\u0645\u0646\u062D\u0636\u0631\u0648 \u0633\u0648\u0627\u061F"],
      iq: ["\u0634\u0646\u0648 \u0627\u0633\u0645\u0647\u061F \u{1F37F}", "\u064A\u0633\u062A\u0627\u0647\u0644\u061F", "\u0644\u0627 \u062A\u062D\u0631\u0643\u0647 \u0639\u0644\u064A \u{1F602}", "\u0646\u0634\u0648\u0641\u0647 \u0633\u0648\u0627\u061F"]
    }
  },
  {
    ar: /اغنيه|اغاني|موسيقي|سبوتيفاي|شيله|البوم/,
    en: /\b(song|music|spotify|playlist|album|listen to this)\b/,
    replies: {
      en: ["Banger! \u{1F3A7}", "What's it called?", "Send it to me", "Good taste \u{1F3B6}", "On repeat now \u{1F604}"],
      ar: ["\u062D\u0644\u0648\u0629! \u{1F3A7}", "\u0648\u0634 \u0627\u0633\u0645\u0647\u0627\u061F", "\u0623\u0631\u0633\u0644\u0647\u0627 \u0644\u064A", "\u0630\u0648\u0642\u0643 \u062D\u0644\u0648 \u{1F3B6}", "\u0635\u0627\u0631\u062A \u0639\u0644\u0649 \u0627\u0644\u062A\u0643\u0631\u0627\u0631 \u{1F604}"],
      eg: ["\u062D\u0644\u0648\u0629 \u0623\u0648\u064A \u{1F3A7}", "\u0627\u0633\u0645\u0647\u0627 \u0625\u064A\u0647\u061F", "\u0627\u0628\u0639\u062A\u0647\u0627\u0644\u064A", "\u0630\u0648\u0642\u0643 \u062D\u0644\u0648 \u{1F3B6}"],
      lev: ["\u062D\u0644\u0648\u0629 \u0643\u062A\u064A\u0631 \u{1F3A7}", "\u0634\u0648 \u0627\u0633\u0645\u0647\u0627\u061F", "\u0627\u0628\u0639\u062A\u0644\u064A \u064A\u0627\u0647\u0627", "\u0630\u0648\u0642\u0643 \u062D\u0644\u0648 \u{1F3B6}"],
      iq: ["\u062D\u0644\u0648\u0629 \u0643\u0644\u0634 \u{1F3A7}", "\u0634\u0646\u0648 \u0627\u0633\u0645\u0647\u0627\u061F", "\u062F\u0632\u0647\u0627 \u0625\u0644\u064A", "\u0630\u0648\u0642\u0643 \u062D\u0644\u0648 \u{1F3B6}"]
    }
  },
  {
    ar: /(^|\s)(حر|حار|الحر|حراره|رطوبه|شوب|نار)(\s|$|[؟?!.,])/,
    en: /\b(so hot|hot today|heatwave|boiling|burning up|sweating)\b/,
    replies: {
      en: ["Right?! It's boiling \u{1F975}", "Stay cool out there \u{1F975}", "AC on full blast \u{1F602}", "Drink lots of water!"],
      ar: ["\u0635\u062F\u0642 \u0648\u0627\u0644\u0644\u0647\u060C \u0646\u0627\u0631 \u{1F975}", "\u0627\u0644\u0644\u0647 \u064A\u0639\u064A\u0646 \u0639\u0644\u0649 \u0627\u0644\u062D\u0631", "\u0627\u0644\u0645\u0643\u064A\u0641 \u0639\u0644\u0649 \u0627\u0644\u0622\u062E\u0631 \u{1F602}", "\u062E\u0644\u0646\u0627 \u0628\u0627\u0644\u0628\u064A\u062A \u0623\u062D\u0633\u0646", "\u0627\u0634\u0631\u0628 \u0645\u0648\u064A\u0629 \u0643\u062B\u064A\u0631"],
      eg: ["\u0641\u0639\u0644\u0627\u064B \u0627\u0644\u062C\u0648 \u0646\u0627\u0631 \u{1F975}", "\u0631\u0628\u0646\u0627 \u064A\u0639\u064A\u0646 \u0639\u0644\u0649 \u0627\u0644\u062D\u0631", "\u0627\u0644\u062A\u0643\u064A\u064A\u0641 \u0639\u0644\u0649 \u0627\u0644\u0622\u062E\u0631 \u{1F602}"],
      lev: ["\u0639\u0646\u062C\u062F \u0634\u0648\u0628 \u{1F975}", "\u0627\u0644\u0644\u0647 \u064A\u0639\u064A\u0646 \u0639\u0627\u0644\u062D\u0631", "\u0627\u0644\u0645\u0643\u064A\u0641 \u0639\u0627\u0644\u0622\u062E\u0631 \u{1F602}"],
      iq: ["\u0635\u062F\u0643 \u0646\u0627\u0631 \u{1F975}", "\u0627\u0644\u0644\u0647 \u064A\u0639\u064A\u0646 \u0639\u0644\u0649 \u0627\u0644\u062D\u0631", "\u0627\u0644\u0645\u0628\u0631\u062F\u0629 \u0639\u0644\u0649 \u0627\u0644\u0622\u062E\u0631 \u{1F602}"]
    }
  },
  {
    ar: /(^|\s)(برد|البرد|بارد|مطر|المطر|امطار|ثلج|سقعه|صقيع)(\s|$|[؟?!.,])/,
    en: /\b(so cold|freezing|raining|rain|snow|snowing|chilly|stormy)\b/,
    replies: {
      en: ["Stay warm! \u2744\uFE0F", "Perfect weather to stay in \u{1F602}", "Love this weather \u2601\uFE0F", "Grab a blanket \u{1F9E3}"],
      ar: ["\u062A\u062F\u0641\u0649 \u0632\u064A\u0646 \u2744\uFE0F", "\u0623\u062D\u0644\u0649 \u062C\u0648 \u0644\u0644\u0628\u064A\u062A \u{1F602}", "\u0627\u0644\u0644\u0647 \u064A\u0639\u0637\u064A\u0646\u0627 \u062E\u064A\u0631\u0647 \u2601\uFE0F", "\u062C\u0648 \u0634\u0627\u0647\u064A \u0648\u0628\u0637\u0627\u0646\u064A\u0629 \u{1F9E3}", "\u0623\u062D\u0628 \u0647\u0627\u0644\u062C\u0648"],
      eg: ["\u0627\u062A\u062F\u0641\u0649 \u0643\u0648\u064A\u0633 \u2744\uFE0F", "\u0623\u062D\u0644\u0649 \u062C\u0648 \u0644\u0644\u0628\u064A\u062A \u{1F602}", "\u062C\u0648 \u0634\u0627\u064A \u0648\u0628\u0637\u0627\u0646\u064A\u0629 \u{1F9E3}"],
      lev: ["\u062A\u062F\u0641\u0649 \u0645\u0646\u064A\u062D \u2744\uFE0F", "\u0623\u062D\u0644\u0649 \u0637\u0642\u0633 \u0644\u0644\u0628\u064A\u062A \u{1F602}", "\u0637\u0642\u0633 \u0634\u0627\u064A \u0648\u062D\u0631\u0627\u0645 \u{1F9E3}"],
      iq: ["\u062A\u062F\u0641\u0649 \u0632\u064A\u0646 \u2744\uFE0F", "\u0623\u062D\u0644\u0649 \u062C\u0648 \u0644\u0644\u0628\u064A\u062A \u{1F602}", "\u062C\u0648 \u062C\u0627\u064A \u0648\u0628\u0637\u0627\u0646\u064A\u0629 \u{1F9E3}"]
    }
  },
  {
    ar: /(^|\s)(الجو|الطقس|غبار|عاصفه)(\s|$|[؟?!.,])/,
    en: /\b(weather|sunny|windy|dusty)\b/,
    replies: {
      en: ["Right? \u{1F605}", "The weather's been weird lately", "Hope it gets better!"],
      ar: ["\u0635\u062F\u0642 \u0648\u0627\u0644\u0644\u0647 \u{1F605}", "\u0627\u0644\u062C\u0648 \u0647\u0627\u0644\u0623\u064A\u0627\u0645 \u063A\u0631\u064A\u0628", "\u0627\u0644\u0644\u0647 \u064A\u0639\u0637\u064A\u0646\u0627 \u062E\u064A\u0631\u0647", "\u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647 \u064A\u062A\u062D\u0633\u0646"],
      eg: ["\u0641\u0639\u0644\u0627\u064B \u{1F605}", "\u0627\u0644\u062C\u0648 \u063A\u0631\u064A\u0628 \u0627\u0644\u064A\u0648\u0645\u064A\u0646 \u062F\u0648\u0644", "\u0631\u0628\u0646\u0627 \u064A\u0633\u062A\u0631"],
      lev: ["\u0639\u0646\u062C\u062F \u{1F605}", "\u0627\u0644\u0637\u0642\u0633 \u063A\u0631\u064A\u0628 \u0647\u0627\u0644\u0623\u064A\u0627\u0645", "\u0627\u0644\u0644\u0647 \u064A\u0633\u062A\u0631"],
      iq: ["\u0635\u062F\u0643 \u{1F605}", "\u0627\u0644\u062C\u0648 \u063A\u0631\u064A\u0628 \u0647\u0627\u0644\u0623\u064A\u0627\u0645", "\u0627\u0644\u0644\u0647 \u064A\u0633\u062A\u0631"]
    }
  },
  {
    ar: /مسافر|بسافر|السفر|سفره|المطار|طياره|رحله|اجازه|عطله/,
    en: /\b(travel|traveling|travelling|trip|vacation|holiday|flight|airport)\b/,
    replies: {
      en: ["Safe travels! \u2708\uFE0F", "Where are you going?", "Have fun! \u{1F334}", "Bring me something back \u{1F602}"],
      ar: ["\u0627\u0644\u0644\u0647 \u064A\u0648\u0635\u0644\u0643 \u0628\u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u2708\uFE0F", "\u0648\u064A\u0646 \u0631\u0627\u064A\u062D\u061F", "\u0627\u0633\u062A\u0645\u062A\u0639! \u{1F334}", "\u0644\u0627 \u062A\u0646\u0633\u0627\u0646\u0627 \u0645\u0646 \u0627\u0644\u0647\u062F\u0627\u064A\u0627 \u{1F602}", "\u062A\u0631\u0648\u062D \u0648\u062A\u0631\u062C\u0639 \u0628\u0627\u0644\u0633\u0644\u0627\u0645\u0629"],
      eg: ["\u062A\u0648\u0635\u0644 \u0628\u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u2708\uFE0F", "\u0631\u0627\u064A\u062D \u0641\u064A\u0646\u061F", "\u0627\u0646\u0628\u0633\u0637! \u{1F334}", "\u0645\u062A\u0646\u0633\u0627\u0634 \u0627\u0644\u0647\u062F\u0627\u064A\u0627 \u{1F602}"],
      lev: ["\u062A\u0648\u0635\u0644 \u0628\u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u2708\uFE0F", "\u0644\u0648\u064A\u0646 \u0631\u0627\u064A\u062D\u061F", "\u0627\u0646\u0628\u0633\u0637! \u{1F334}", "\u0644\u0627 \u062A\u0646\u0633\u0627\u0646\u0627 \u0645\u0646 \u0627\u0644\u0647\u062F\u0627\u064A\u0627 \u{1F602}"],
      iq: ["\u062A\u0648\u0635\u0644 \u0628\u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u2708\uFE0F", "\u0648\u064A\u0646 \u0631\u0627\u064A\u062D\u061F", "\u0627\u0633\u062A\u0627\u0646\u0633! \u{1F334}", "\u0644\u0627 \u062A\u0646\u0633\u0627\u0646\u0627 \u0645\u0646 \u0627\u0644\u0647\u062F\u0627\u064A\u0627 \u{1F602}"]
    }
  },
  {
    ar: /الويكند|الويك اند|نهايه الاسبوع|عندك شي|وش عندك بكره|فاضي|فاضيه|عندك وقت|انت فاضي/,
    en: /\b(weekend|any plans|plans (for|tonight|tomorrow)|are you free|you free|free (today|tonight|tomorrow))\b/,
    replies: {
      en: ["I'm free, what's up?", "Kinda busy, maybe later?", "Nothing planned, wanna hang out?", "Depends, why?"],
      ar: ["\u0648\u0627\u0644\u0644\u0647 \u0641\u0627\u0636\u064A\u060C \u0648\u0634 \u0639\u0646\u062F\u0643\u061F", "\u0639\u0646\u062F\u064A \u0634\u063A\u0644\u0627\u062A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0645\u0627 \u0639\u0646\u062F\u064A \u0634\u064A\u060C \u0646\u0637\u0644\u0639\u061F", "\u0639\u0644\u0649 \u062D\u0633\u0628\u060C \u0644\u064A\u0634\u061F"],
      eg: ["\u0641\u0627\u0636\u064A\u060C \u0639\u0646\u062F\u0643 \u0625\u064A\u0647\u061F", "\u0645\u0634\u063A\u0648\u0644 \u0634\u0648\u064A\u0629\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0648\u0644\u0627 \u062D\u0627\u062C\u0629\u060C \u0646\u062E\u0631\u062C\u061F", "\u0639\u0644\u0649 \u062D\u0633\u0628\u060C \u0644\u064A\u0647\u061F"],
      lev: ["\u0641\u0627\u0636\u064A\u060C \u0634\u0648 \u0639\u0646\u062F\u0643\u061F", "\u0645\u0634\u063A\u0648\u0644 \u0634\u0648\u064A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0645\u0627 \u0639\u0646\u062F\u064A \u0634\u064A\u060C \u0645\u0646\u0637\u0644\u0639\u061F", "\u062D\u0633\u0628\u060C \u0644\u064A\u0634\u061F"],
      iq: ["\u0641\u0627\u0631\u063A\u060C \u0634\u0639\u0646\u062F\u0643\u061F", "\u0645\u0634\u063A\u0648\u0644 \u0634\u0648\u064A\u0629\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0645\u0627\u0639\u0646\u062F\u064A \u0634\u064A\u060C \u0646\u0637\u0644\u0639\u061F", "\u062D\u0633\u0628\u060C \u0644\u064A\u0634\u061F"]
    }
  }
];

// ../friendsInVoice/smartReplyRulesSecond.ts
var SECOND_RULES = [
  {
    en: /\b(how are (you|u)|how r u|hru|how'?s it going|how have you been|what'?s up|whats up|sup)\b/,
    ar: /كيفك|كيف حالك|كيف الحال|شلونك|شلونكم|شخبارك|ايش اخبارك|شو اخبارك|وش اخبارك|كيف الاحوال|وش لونك|اخبارك|ازيك|ازيكم|عامل ايه|عامله ايه|شكو ماكو|كيفكم/,
    replies: {
      en: ["I'm good, thanks! You?", "All good here \u{1F604} How about you?", "Pretty busy, but fine!", "Doing great! What's up with you?", "Not bad, just chilling. You?", "Can't complain! You?"],
      ar: ["\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647 \u062A\u0645\u0627\u0645\u060C \u0648\u0627\u0646\u062A\u061F", "\u0628\u062E\u064A\u0631 \u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647\u060C \u0648\u0627\u0646\u062A \u0643\u064A\u0641\u0643\u061F", "\u062A\u0645\u0627\u0645\u060C \u0645\u0634\u063A\u0648\u0644 \u0634\u0648\u064A \u0628\u0633 \u{1F605}", "\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647\u060C \u0627\u0646\u062A \u0648\u0634 \u0623\u062E\u0628\u0627\u0631\u0643\u061F", "\u0628\u062E\u064A\u0631\u060C \u0637\u0645\u0646\u064A \u0639\u0646\u0643", "\u0632\u064A\u0646 \u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647\u060C \u0648\u0627\u0646\u062A\u061F", "\u062A\u0645\u0627\u0645 \u0627\u0644\u062A\u0645\u0627\u0645 \u{1F604}", "\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647 \u0639\u0644\u0649 \u0643\u0644 \u062D\u0627\u0644\u060C \u0648\u0627\u0646\u062A\u061F"],
      eg: ["\u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647 \u062A\u0645\u0627\u0645\u060C \u0648\u0627\u0646\u062A\u061F", "\u0643\u0648\u064A\u0633 \u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647\u060C \u0625\u0646\u062A \u0639\u0627\u0645\u0644 \u0625\u064A\u0647\u061F", "\u062A\u0645\u0627\u0645 \u064A\u0627 \u0628\u0627\u0634\u0627 \u{1F604}", "\u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647\u060C \u0645\u0627\u0634\u064A \u0627\u0644\u062D\u0627\u0644", "\u0628\u062E\u064A\u0631\u060C \u0637\u0645\u0646\u064A \u0639\u0644\u064A\u0643", "\u0632\u064A \u0627\u0644\u0641\u0644\u060C \u0648\u0627\u0646\u062A\u061F"],
      lev: ["\u0645\u0646\u064A\u062D \u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647\u060C \u0648\u0627\u0646\u062A\u061F", "\u062A\u0645\u0627\u0645\u060C \u0627\u0646\u062A \u0643\u064A\u0641\u0643\u061F", "\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647 \u0645\u0627\u0634\u064A \u0627\u0644\u062D\u0627\u0644", "\u0645\u0646\u064A\u062D\u060C \u0645\u0634\u063A\u0648\u0644 \u0634\u0648\u064A \u0628\u0633 \u{1F605}", "\u0643\u0644\u0648 \u062A\u0645\u0627\u0645\u060C \u0637\u0645\u0646\u064A \u0639\u0646\u0643", "\u0628\u062E\u064A\u0631\u060C \u0627\u0646\u062A \u0634\u0648 \u0623\u062E\u0628\u0627\u0631\u0643\u061F"],
      iq: ["\u0632\u064A\u0646 \u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647\u060C \u0648\u0627\u0646\u062A \u0634\u0644\u0648\u0646\u0643\u061F", "\u062A\u0645\u0627\u0645 \u0639\u064A\u0646\u064A\u060C \u0627\u0646\u062A \u0634\u0644\u0648\u0646\u0643\u061F", "\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647 \u0645\u0627\u0634\u064A \u0627\u0644\u062D\u0627\u0644", "\u0632\u064A\u0646\u060C \u0628\u0633 \u0645\u0634\u063A\u0648\u0644 \u0634\u0648\u064A\u0629 \u{1F605}", "\u0628\u062E\u064A\u0631\u060C \u0637\u0645\u0646\u064A \u0639\u0644\u064A\u0643", "\u0643\u0644\u0634 \u0632\u064A\u0646\u060C \u0648\u0627\u0646\u062A\u061F"]
    }
  },
  {
    en: /\b(hi+|hello|hey+|heya|yo|hiya|howdy)\b/,
    ar: /(^|\s)(مرحبا|مرحبتين|هلا|اهلا|هاي|هلو|يا هلا|اهلين)/,
    replies: {
      en: ["Hey! \u{1F44B}", "Hi, how are you?", "Hello! What's up?", "Hey hey \u{1F604}", "Hi! Good to hear from you", "Yo! \u{1F44B}"],
      ar: ["\u0647\u0644\u0627 \u{1F44B}", "\u0623\u0647\u0644\u064A\u0646\u060C \u0643\u064A\u0641\u0643\u061F", "\u0647\u0644\u0627 \u0648\u0627\u0644\u0644\u0647\u060C \u0648\u0634 \u0623\u062E\u0628\u0627\u0631\u0643\u061F", "\u0645\u0631\u062D\u0628\u0627! \u062D\u064A\u0627\u0643 \u{1F604}", "\u0647\u0644\u0627 \u0641\u064A\u0643", "\u064A\u0627 \u0647\u0644\u0627 \u0648\u0627\u0644\u0644\u0647", "\u0623\u0647\u0644\u0627\u064B \u0648\u0633\u0647\u0644\u0627\u064B", "\u0647\u0644\u0627 \u0628\u0627\u0644\u063A\u0627\u0644\u064A"],
      eg: ["\u0623\u0647\u0644\u0627\u064B \u{1F44B}", "\u0625\u0632\u064A\u0643\u061F", "\u0623\u0647\u0644\u0627\u064B \u064A\u0627 \u0628\u0627\u0634\u0627 \u{1F604}", "\u0623\u0647\u0644\u0627\u064B\u060C \u0639\u0627\u0645\u0644 \u0625\u064A\u0647\u061F", "\u064A\u0627 \u0623\u0647\u0644\u0627\u064B \u0648\u0633\u0647\u0644\u0627\u064B", "\u0645\u0646\u0648\u0631 \u{1F604}"],
      lev: ["\u0623\u0647\u0644\u064A\u0646 \u{1F44B}", "\u0645\u0631\u062D\u0628\u0627\u060C \u0643\u064A\u0641\u0643\u061F", "\u0647\u0644\u0627 \u0648\u0627\u0644\u0644\u0647\u060C \u0634\u0648 \u0627\u0644\u0623\u062E\u0628\u0627\u0631\u061F", "\u0623\u0647\u0644\u064A\u0646 \u0641\u064A\u0643 \u{1F604}", "\u064A\u0627 \u0647\u0644\u0627", "\u0645\u0631\u062D\u0628\u062A\u064A\u0646"],
      iq: ["\u0647\u0644\u0648 \u{1F44B}", "\u0647\u0644\u0627 \u0628\u064A\u0643\u060C \u0634\u0644\u0648\u0646\u0643\u061F", "\u0647\u0644\u0627 \u0639\u064A\u0646\u064A \u{1F604}", "\u0623\u0647\u0644\u0627\u064B \u0648\u0633\u0647\u0644\u0627\u064B\u060C \u0634\u0643\u0648 \u0645\u0627\u0643\u0648\u061F", "\u0647\u0644\u0627 \u0628\u0627\u0644\u063A\u0627\u0644\u064A", "\u0647\u0644\u0627 \u0648\u0627\u0644\u0644\u0647"]
    }
  },
  {
    ar: /وينك|(?<!من )وين انت|وينكم|انت فين|فينك|موجود|متواجد|صاحي|انت هنا/,
    en: /\b(where are you(?! from)|you there|u there|are you around|you up|are you online)\b/,
    replies: {
      en: ["I'm here, what's up?", "Yep, here! \u{1F44B}", "Here, tell me", "Just saw this, what's up?", "Here! Need something?"],
      ar: ["\u0645\u0648\u062C\u0648\u062F\u060C \u062A\u0641\u0636\u0644", "\u0647\u0646\u0627\u060C \u0648\u0634 \u062A\u0628\u064A\u061F", "\u0645\u0639\u0643\u060C \u0642\u0648\u0644", "\u062A\u0648\u0646\u064A \u0634\u0641\u062A \u0631\u0633\u0627\u0644\u062A\u0643\u060C \u0622\u0645\u0631", "\u0645\u0648\u062C\u0648\u062F\u060C \u0648\u0634 \u0639\u0646\u062F\u0643\u061F"],
      eg: ["\u0645\u0648\u062C\u0648\u062F\u060C \u0627\u062A\u0641\u0636\u0644", "\u0623\u064A\u0648\u0647 \u0645\u0639\u0627\u0643", "\u0647\u0646\u0627\u060C \u0639\u0627\u064A\u0632 \u0625\u064A\u0647\u061F", "\u0644\u0633\u0647 \u0634\u0627\u064A\u0641 \u0631\u0633\u0627\u0644\u062A\u0643\u060C \u0642\u0648\u0644"],
      lev: ["\u0645\u0648\u062C\u0648\u062F\u060C \u062A\u0641\u0636\u0644", "\u0647\u0648\u0646\u060C \u0634\u0648 \u0628\u062F\u0643\u061F", "\u0645\u0639\u0643\u060C \u0627\u062D\u0643\u064A", "\u0647\u0644\u0642 \u0634\u0641\u062A \u0631\u0633\u0627\u0644\u062A\u0643\u060C \u0642\u0648\u0644"],
      iq: ["\u0645\u0648\u062C\u0648\u062F\u060C \u062A\u0641\u0636\u0644", "\u0647\u0646\u0627\u060C \u0634\u062A\u0631\u064A\u062F\u061F", "\u0648\u064A\u0627\u0643\u060C \u0643\u0648\u0644", "\u0647\u0633\u0647 \u0634\u0641\u062A \u0631\u0633\u0627\u0644\u062A\u0643\u060C \u0623\u0645\u0631"]
    }
  },
  {
    ar: /رجعت|وصلت|توني جيت|انا جيت/,
    en: /\b(i'?m back|im back|i'?m home|made it home)\b/,
    replies: {
      en: ["Welcome back! \u{1F44B}", "Glad you made it!", "Finally \u{1F604}", "Hey, welcome back"],
      ar: ["\u062D\u064A \u0627\u0644\u0644\u0647 \u{1F44B}", "\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647 \u0639\u0644\u0649 \u0627\u0644\u0633\u0644\u0627\u0645\u0629", "\u0648\u0644\u0643\u0645 \u{1F604}", "\u0647\u0644\u0627 \u0628\u0643\u060C \u0646\u0648\u0631\u062A"],
      eg: ["\u062D\u0645\u062F \u0627\u0644\u0644\u0647 \u0639\u0644\u0649 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u{1F44B}", "\u0646\u0648\u0631\u062A \u{1F604}", "\u0623\u062E\u064A\u0631\u0627\u064B!"],
      lev: ["\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647 \u0639\u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u{1F44B}", "\u0623\u0647\u0644\u064A\u0646\u060C \u0646\u0648\u0631\u062A \u{1F604}", "\u0623\u062E\u064A\u0631\u0627\u064B!"],
      iq: ["\u0627\u0644\u062D\u0645\u062F\u0644\u0644\u0647 \u0639\u0644\u0649 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u{1F44B}", "\u0647\u0644\u0627 \u0628\u064A\u0643\u060C \u0646\u0648\u0631\u062A \u{1F604}", "\u0623\u062E\u064A\u0631\u0627\u064B!"]
    }
  },
  {
    ar: /اشتقتلك|اشتقت لك|وحشتني|مشتاقلك|توحشني|اشتقنا|اشتاقيتلك/,
    en: /\b(miss (you|u|ya)|missed (you|u))\b/,
    replies: {
      en: ["Miss you too! \u2764\uFE0F", "Aww, miss you more \u{1F97A}", "Same here! We should catch up", "Me too! When are you free?"],
      ar: ["\u0648\u0627\u0646\u0627 \u0623\u0643\u062B\u0631 \u2764\uFE0F", "\u0648\u0627\u0644\u0644\u0647 \u0648\u0627\u0646\u0627 \u0627\u0634\u062A\u0642\u062A\u0644\u0643", "\u0648\u062D\u0634\u062A\u0646\u064A \u0623\u0643\u062B\u0631 \u{1F97A}", "\u0644\u0627\u0632\u0645 \u0646\u0634\u0648\u0641\u0643 \u0642\u0631\u064A\u0628", "\u0648\u0627\u0646\u0627 \u0623\u0643\u062B\u0631 \u0648\u0627\u0644\u0644\u0647\u060C \u0645\u062A\u0649 \u0646\u0634\u0648\u0641\u0643\u061F"],
      eg: ["\u0648\u0627\u0646\u0627 \u0623\u0643\u062A\u0631 \u2764\uFE0F", "\u0648\u062D\u0634\u062A\u0646\u064A \u0623\u0648\u064A \u{1F97A}", "\u0644\u0627\u0632\u0645 \u0646\u062A\u0642\u0627\u0628\u0644 \u0642\u0631\u064A\u0628"],
      lev: ["\u0648\u0627\u0646\u0627 \u0623\u0643\u062A\u0631 \u2764\uFE0F", "\u0627\u0634\u062A\u0642\u062A\u0644\u0643 \u0643\u062A\u064A\u0631 \u{1F97A}", "\u0644\u0627\u0632\u0645 \u0646\u0634\u0648\u0641\u0643 \u0642\u0631\u064A\u0628"],
      iq: ["\u0648\u0627\u0646\u0627 \u0623\u0643\u062B\u0631 \u2764\uFE0F", "\u0627\u0634\u062A\u0627\u0642\u064A\u062A\u0644\u0643 \u0647\u0648\u0627\u064A\u0629 \u{1F97A}", "\u0644\u0627\u0632\u0645 \u0646\u0634\u0648\u0641\u0643 \u0642\u0631\u064A\u0628"]
    }
  },
  {
    ar: /احبك|بحبك/,
    en: /\b(love (you|u|ya)|ily)\b/,
    replies: {
      en: ["Love you too \u2764\uFE0F", "\u2764\uFE0F\u2764\uFE0F", "Aww \u{1F979}\u2764\uFE0F"],
      ar: ["\u0648\u0627\u0646\u0627 \u0623\u0643\u062B\u0631 \u2764\uFE0F", "\u2764\uFE0F\u2764\uFE0F", "\u064A\u0627 \u0639\u0645\u0631\u064A \u{1F979}"],
      eg: ["\u0648\u0627\u0646\u0627 \u0643\u0645\u0627\u0646 \u2764\uFE0F", "\u2764\uFE0F\u2764\uFE0F", "\u064A\u0627 \u062D\u0628\u064A\u0628\u064A \u{1F979}"],
      lev: ["\u0648\u0627\u0646\u0627 \u0643\u0645\u0627\u0646 \u2764\uFE0F", "\u2764\uFE0F\u2764\uFE0F", "\u062A\u0642\u0628\u0631\u0646\u064A \u{1F979}"],
      iq: ["\u0648\u0627\u0646\u0627 \u0647\u0645 \u2764\uFE0F", "\u2764\uFE0F\u2764\uFE0F", "\u064A\u0627 \u0639\u0645\u0631\u064A \u{1F979}"]
    }
  },
  {
    ar: /شكرا|مشكور|يعطيك العافيه|تسلم|يسلمو|الله يعطيك|ما قصرت|جزاك الله|ميرسي|متشكر/,
    en: /\b(thanks|thank you|thx|ty|tysm|appreciate it)\b/,
    replies: {
      en: ["You're welcome! \u{1F60A}", "Anytime!", "No problem \u{1F44D}", "Happy to help!", "Of course \u{1F64C}", "Don't mention it"],
      ar: ["\u0627\u0644\u0639\u0641\u0648 \u{1F64F}", "\u0627\u0644\u0644\u0647 \u064A\u0639\u0627\u0641\u064A\u0643", "\u062A\u0643\u0631\u0645\u060C \u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0645\u0627 \u0633\u0648\u064A\u062A \u0634\u064A \u{1F60A}", "\u0628\u0627\u0644\u062E\u062F\u0645\u0629 \u062F\u0627\u064A\u0645\u0627\u064B", "\u062D\u0627\u0636\u0631\u064A\u0646", "\u0648\u0644\u0648\u060C \u0648\u0627\u062C\u0628\u0646\u0627"],
      eg: ["\u0627\u0644\u0639\u0641\u0648 \u{1F64F}", "\u0639\u0644\u0649 \u0625\u064A\u0647 \u0628\u0633", "\u062A\u062D\u062A \u0623\u0645\u0631\u0643", "\u0648\u0644\u0627 \u064A\u0647\u0645\u0643 \u064A\u0627 \u0628\u0627\u0634\u0627", "\u0623\u064A \u062E\u062F\u0645\u0629 \u{1F60A}", "\u062F\u0647 \u0648\u0627\u062C\u0628\u064A"],
      lev: ["\u0648\u0644\u0648\u060C \u0627\u0644\u0639\u0641\u0648 \u{1F64F}", "\u064A\u0633\u0644\u0645\u0648\u060C \u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u062A\u0643\u0631\u0645 \u0639\u064A\u0646\u0643", "\u0645\u0627 \u0639\u0645\u0644\u062A \u0634\u064A \u{1F60A}", "\u0628\u0627\u0644\u062E\u062F\u0645\u0629 \u062F\u0627\u064A\u0645\u0627\u064B", "\u062A\u062F\u0644\u0644"],
      iq: ["\u0627\u0644\u0639\u0641\u0648 \u0639\u064A\u0646\u064A \u{1F64F}", "\u062A\u062F\u0644\u0644", "\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0647\u0630\u0627 \u0648\u0627\u062C\u0628\u064A", "\u0639\u0644\u0649 \u0631\u0627\u0633\u064A \u{1F60A}", "\u062A\u0627\u0645\u0631"]
    }
  },
  {
    ar: /الله يوفقك|الله يسعدك|الله يحفظك|الله يخليك|الله يجزاك|ربي يحفظك|ربي يسعدك|ربنا يخليك|ربنا يوفقك|الله يعافيك/,
    en: /\b(god bless|may god|bless you)\b/,
    replies: {
      en: ["Thank you, you too \u{1F932}", "Ameen, and you!", "That means a lot \u2764\uFE0F"],
      ar: ["\u0622\u0645\u064A\u0646 \u0648\u0625\u064A\u0627\u0643 \u{1F932}", "\u0648\u064A\u0627\u0643 \u064A\u0627 \u0631\u0628", "\u0627\u0644\u0644\u0647 \u064A\u0633\u0639\u062F\u0643 \u0623\u0643\u062B\u0631", "\u062A\u0633\u0644\u0645\u060C \u0648\u0627\u0646\u062A \u0643\u0630\u0644\u0643", "\u0627\u0644\u0644\u0647 \u064A\u062D\u0641\u0638\u0643"],
      eg: ["\u0648\u0627\u0646\u062A \u0643\u0645\u0627\u0646 \u064A\u0627 \u0631\u0628 \u{1F932}", "\u0631\u0628\u0646\u0627 \u064A\u062E\u0644\u064A\u0643", "\u062A\u0633\u0644\u0645 \u064A\u0627 \u062D\u0628\u064A\u0628\u064A"],
      lev: ["\u0648\u0627\u0646\u062A \u0643\u0645\u0627\u0646 \u{1F932}", "\u0627\u0644\u0644\u0647 \u064A\u062E\u0644\u064A\u0643", "\u062A\u0633\u0644\u0645"],
      iq: ["\u0648\u064A\u0627\u0643 \u064A\u0627 \u0631\u0628 \u{1F932}", "\u0627\u0644\u0644\u0647 \u064A\u062E\u0644\u064A\u0643", "\u062A\u0633\u0644\u0645 \u0639\u064A\u0646\u064A"]
    }
  },
  {
    ar: /بالتوفيق|حظ سعيد|حظ موفق|بالنجاح/,
    en: /\b(good luck|gl|best of luck)\b/,
    replies: {
      en: ["Thanks! \u{1F340}", "Thank you, I need it \u{1F605}", "Appreciate it!", "Thanks, fingers crossed \u{1F91E}"],
      ar: ["\u0627\u0644\u0644\u0647 \u064A\u0633\u0644\u0645\u0643 \u{1F90D}", "\u062A\u0633\u0644\u0645\u060C \u0648\u0627\u0646\u062A \u0643\u0630\u0644\u0643", "\u0622\u0645\u064A\u0646\u060C \u064A\u0627 \u0631\u0628", "\u0634\u0643\u0631\u0627\u064B\u060C \u0627\u062F\u0639\u064A\u0644\u064A \u{1F932}"],
      eg: ["\u062A\u0633\u0644\u0645 \u{1F90D}", "\u0631\u0628\u0646\u0627 \u064A\u0633\u062A\u0631\u0647\u0627 \u{1F605}", "\u0627\u062F\u0639\u064A\u0644\u064A \u{1F932}"],
      lev: ["\u064A\u0633\u0644\u0645\u0648 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0633\u062A\u0631\u0647\u0627 \u{1F605}", "\u0627\u062F\u0639\u064A\u0644\u064A \u{1F932}"],
      iq: ["\u062A\u0633\u0644\u0645 \u0639\u064A\u0646\u064A \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0633\u062A\u0631 \u{1F605}", "\u0627\u062F\u0639\u064A\u0644\u064A \u{1F932}"]
    }
  },
  {
    en: /\b(sorry|my bad|apologi[sz]e)\b/,
    ar: /اسف|سامحني|معلش|معليش|عذرا|المعذره|متزعلش|لا تزعل/,
    replies: {
      en: ["No worries!", "It's okay \u{1F60A}", "All good!", "Don't worry about it", "It happens!"],
      ar: ["\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0645\u0633\u0627\u0645\u062D \u{1F60A}", "\u0639\u0627\u062F\u064A \u0645\u0627 \u0635\u0627\u0631 \u0634\u064A", "\u0644\u0627 \u062A\u0634\u064A\u0644 \u0647\u0645", "\u0645\u0627 \u0639\u0644\u064A\u0643", "\u0648\u0644\u0627 \u0634\u064A\u060C \u0639\u0627\u062F\u064A"],
      eg: ["\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0645\u0634 \u0645\u0634\u0643\u0644\u0629 \u062E\u0627\u0644\u0635", "\u062D\u0635\u0644 \u062E\u064A\u0631 \u{1F60A}", "\u0639\u0627\u062F\u064A \u064A\u0627 \u0639\u0645", "\u0645\u062A\u0634\u063A\u0644\u0634 \u0628\u0627\u0644\u0643"],
      lev: ["\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0645\u0627 \u0641\u064A \u0634\u064A", "\u0645\u0633\u0627\u0645\u062D \u{1F60A}", "\u0639\u0627\u062F\u064A\u060C \u0635\u0627\u0631\u062A", "\u0644\u0627 \u062A\u062D\u0645\u0644 \u0647\u0645"],
      iq: ["\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0645\u0627\u0643\u0648 \u0634\u064A", "\u0639\u0627\u062F\u064A \u0639\u064A\u0646\u064A \u{1F60A}", "\u0645\u0633\u0627\u0645\u062D", "\u0644\u0627 \u062A\u0634\u064A\u0644 \u0647\u0645"]
    }
  },
  {
    en: /\b(vc|voice|call|join|hop on|get on)\b/,
    ar: /تعال|ادخل|روم|مكالمه|كول|نتكلم|نسولف|اتصل|ديسكورد|فوت|نحجي/,
    replies: {
      en: ["Joining now!", "Give me 5 minutes", "Can't right now, maybe later?", "On my way \u{1F3C3}", "Sure, which channel?", "Coming!"],
      ar: ["\u062C\u0627\u064A \u0627\u0644\u062D\u064A\u0646!", "\u0623\u0639\u0637\u0646\u064A \u0665 \u062F\u0642\u0627\u064A\u0642", "\u0645\u0627 \u0623\u0642\u062F\u0631 \u0627\u0644\u062D\u064A\u0646\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u062F\u0642\u064A\u0642\u0629 \u0648\u0623\u062F\u062E\u0644 \u{1F3C3}", "\u0623\u064A \u0631\u0648\u0645\u061F", "\u064A\u0644\u0627 \u062C\u0627\u064A", "\u0634\u0648\u064A \u0648\u0623\u062F\u062E\u0644"],
      eg: ["\u062C\u0627\u064A \u062D\u0627\u0644\u0627\u064B!", "\u062E\u0645\u0633 \u062F\u0642\u0627\u064A\u0642 \u0648\u062C\u0627\u064A", "\u0645\u0634 \u0647\u0642\u062F\u0631 \u062F\u0644\u0648\u0642\u062A\u064A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u062B\u0627\u0646\u064A\u0629 \u0648\u062F\u0627\u062E\u0644 \u{1F3C3}", "\u0623\u0646\u0647\u064A \u0631\u0648\u0645\u061F", "\u064A\u0644\u0627 \u062C\u0627\u064A"],
      lev: ["\u062C\u0627\u064A \u0647\u0644\u0642!", "\u0639\u0637\u064A\u0646\u064A \u0665 \u062F\u0642\u0627\u064A\u0642", "\u0645\u0627 \u0628\u0642\u062F\u0631 \u0647\u0644\u0642\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u062F\u0642\u064A\u0642\u0629 \u0648\u0628\u0641\u0648\u062A \u{1F3C3}", "\u0623\u064A \u0631\u0648\u0645\u061F", "\u064A\u0644\u0627 \u062C\u0627\u064A"],
      iq: ["\u062C\u0627\u064A \u0647\u0633\u0647!", "\u0627\u0646\u0637\u064A\u0646\u064A \u0665 \u062F\u0642\u0627\u064A\u0642", "\u0645\u0627 \u0623\u0643\u062F\u0631 \u0647\u0633\u0647\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u062F\u0642\u064A\u0642\u0629 \u0648\u0623\u062F\u062E\u0644 \u{1F3C3}", "\u064A\u0627 \u0631\u0648\u0645\u061F", "\u064A\u0644\u0627 \u062C\u0627\u064A"]
    }
  },
  {
    en: /\b(play|game|gaming|match|ranked|lobby)\b/,
    ar: /نلعب|تلعب|قيم|جيم|بابجي|فورت|ماين|فالو|روكيت|ببجي|كود/,
    replies: {
      en: ["Let's go! \u{1F3AE}", "Down, give me 5 min", "Not right now, later?", "What are we playing?", "I'm in \u{1F3AE}", "One more match? \u{1F604}"],
      ar: ["\u064A\u0644\u0627\u060C \u062C\u0627\u064A \u{1F3AE}", "\u0623\u0639\u0637\u0646\u064A \u0634\u0648\u064A \u0648\u0623\u0628\u062F\u0623", "\u0645\u0648 \u0627\u0644\u062D\u064A\u0646\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0648\u0634 \u0646\u0644\u0639\u0628\u061F", "\u0645\u0639\u0643 \u{1F3AE}", "\u064A\u0644\u0627 \u0628\u0633 \u0631\u0627\u0646\u0643\u062F \u{1F604}"],
      eg: ["\u064A\u0644\u0627 \u0628\u064A\u0646\u0627 \u{1F3AE}", "\u062B\u0648\u0627\u0646\u064A \u0648\u0623\u0641\u062A\u062D", "\u0645\u0634 \u062F\u0644\u0648\u0642\u062A\u064A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0647\u0646\u0644\u0639\u0628 \u0625\u064A\u0647\u061F", "\u0645\u0639\u0627\u0643 \u{1F3AE}"],
      lev: ["\u064A\u0644\u0627\u060C \u062C\u0627\u064A \u{1F3AE}", "\u0639\u0637\u064A\u0646\u064A \u0634\u0648\u064A", "\u0645\u0634 \u0647\u0644\u0642\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0634\u0648 \u0628\u062F\u0646\u0627 \u0646\u0644\u0639\u0628\u061F", "\u0645\u0639\u0643 \u{1F3AE}"],
      iq: ["\u064A\u0644\u0627\u060C \u062C\u0627\u064A \u{1F3AE}", "\u0627\u0646\u0637\u064A\u0646\u064A \u0634\u0648\u064A\u0629", "\u0645\u0648 \u0647\u0633\u0647\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0634\u0646\u0648 \u0646\u0644\u0639\u0628\u061F", "\u0648\u064A\u0627\u0643 \u{1F3AE}"]
    }
  },
  {
    ar: /جوعان|جعان|نتعشي|نتغدي|نفطر|مطعم|نطلع|طلعه|قهوه|كوفي|ناكل/,
    en: /\b(hungry|starving|dinner|lunch|breakfast|coffee|go out|hang out|grab food)\b/,
    replies: {
      en: ["I'm down! Where? \u{1F60B}", "Same, I'm starving \u{1F605}", "Sounds good!", "When?", "Not today, maybe tomorrow?"],
      ar: ["\u064A\u0644\u0627\u060C \u0648\u064A\u0646\u061F \u{1F60B}", "\u0648\u0627\u0646\u0627 \u062C\u0648\u0639\u0627\u0646 \u0648\u0627\u0644\u0644\u0647 \u{1F605}", "\u0641\u0643\u0631\u0629 \u062D\u0644\u0648\u0629!", "\u0645\u062A\u0649\u061F", "\u0645\u0648 \u0627\u0644\u064A\u0648\u0645\u060C \u0628\u0643\u0631\u0629\u061F", "\u0639\u0644\u0649 \u062D\u0633\u0627\u0628\u0643\u061F \u{1F604}"],
      eg: ["\u064A\u0644\u0627\u060C \u0641\u064A\u0646\u061F \u{1F60B}", "\u0648\u0627\u0646\u0627 \u062C\u0639\u0627\u0646 \u0648\u0627\u0644\u0644\u0647 \u{1F605}", "\u0641\u0643\u0631\u0629 \u062D\u0644\u0648\u0629!", "\u0625\u0645\u062A\u0649\u061F", "\u0645\u0634 \u0627\u0644\u0646\u0647\u0627\u0631\u062F\u0647\u060C \u0628\u0643\u0631\u0629\u061F"],
      lev: ["\u064A\u0644\u0627\u060C \u0648\u064A\u0646\u061F \u{1F60B}", "\u0648\u0627\u0646\u0627 \u062C\u0648\u0639\u0627\u0646 \u0643\u062A\u064A\u0631 \u{1F605}", "\u0641\u0643\u0631\u0629 \u062D\u0644\u0648\u0629!", "\u0625\u064A\u0645\u062A\u0649\u061F", "\u0645\u0634 \u0627\u0644\u064A\u0648\u0645\u060C \u0628\u0643\u0631\u0627\u061F"],
      iq: ["\u064A\u0644\u0627\u060C \u0648\u064A\u0646\u061F \u{1F60B}", "\u0648\u0627\u0646\u0627 \u062C\u0648\u0639\u0627\u0646 \u0648\u0627\u0644\u0644\u0647 \u{1F605}", "\u0641\u0643\u0631\u0629 \u062D\u0644\u0648\u0629!", "\u0634\u0648\u0643\u062A\u061F", "\u0645\u0648 \u0627\u0644\u064A\u0648\u0645\u060C \u0628\u0627\u062C\u0631\u061F"]
    }
  },
  {
    ar: /صوره|ورني|وريني|ارسلها|ابعتها|ابعتلي|ارسلي|سناب/,
    en: /\b(send (a |the )?(pic|photo|picture|screenshot)|show me|pic\?)\b/,
    replies: {
      en: ["One sec \u{1F4F8}", "Sending it now", "Which one?", "Later, I'll send it"],
      ar: ["\u0644\u062D\u0638\u0629 \u0623\u0631\u0633\u0644\u0647\u0627 \u{1F4F8}", "\u0627\u0644\u062D\u064A\u0646 \u0623\u0631\u0633\u0644\u0647\u0627", "\u0623\u064A \u0635\u0648\u0631\u0629\u061F", "\u0628\u0639\u062F\u064A\u0646 \u0623\u0631\u0633\u0644\u0647\u0627"],
      eg: ["\u062B\u0627\u0646\u064A\u0629 \u0623\u0628\u0639\u062A\u0647\u0627 \u{1F4F8}", "\u062D\u0627\u0644\u0627\u064B", "\u0623\u0646\u0647\u064A \u0635\u0648\u0631\u0629\u061F"],
      lev: ["\u0644\u062D\u0638\u0629 \u0628\u0628\u0639\u062A\u0647\u0627 \u{1F4F8}", "\u0647\u0644\u0642 \u0628\u0628\u0639\u062A\u0647\u0627", "\u0623\u064A \u0635\u0648\u0631\u0629\u061F"],
      iq: ["\u0644\u062D\u0638\u0629 \u0623\u062F\u0632\u0647\u0627 \u{1F4F8}", "\u0647\u0633\u0647 \u0623\u062F\u0632\u0647\u0627", "\u064A\u0627 \u0635\u0648\u0631\u0629\u061F"]
    }
  },
  {
    ar: /من وين انت|انت منين|كم عمرك|اسمك ايه|وش اسمك|شو اسمك|شنو اسمك|ممكن نتعرف|نتعرف/,
    en: /\b(where are you from|how old are you|what'?s your name|asl)\b/,
    replies: {
      en: ["Nice to meet you! What about you?", "Haha why do you ask? \u{1F604}", "Tell me about you first \u{1F604}"],
      ar: ["\u062A\u0634\u0631\u0641\u0646\u0627 \u{1F60A} \u0648\u0627\u0646\u062A\u061F", "\u0644\u064A\u0634 \u062A\u0633\u0623\u0644\u061F \u{1F604}", "\u0642\u0648\u0644 \u0639\u0646 \u0646\u0641\u0633\u0643 \u0623\u0648\u0644 \u{1F604}", "\u0623\u0647\u0644\u0627\u064B! \u0648\u0627\u0646\u062A \u0645\u0646 \u0648\u064A\u0646\u061F"],
      eg: ["\u0627\u062A\u0634\u0631\u0641\u0646\u0627 \u{1F60A} \u0648\u0627\u0646\u062A\u061F", "\u0628\u062A\u0633\u0623\u0644 \u0644\u064A\u0647\u061F \u{1F604}", "\u0642\u0648\u0644\u064A \u0639\u0646\u0643 \u0627\u0644\u0623\u0648\u0644 \u{1F604}"],
      lev: ["\u062A\u0634\u0631\u0641\u0646\u0627 \u{1F60A} \u0648\u0627\u0646\u062A\u061F", "\u0644\u064A\u0634 \u0639\u0645 \u062A\u0633\u0623\u0644\u061F \u{1F604}", "\u0627\u062D\u0643\u064A\u0644\u064A \u0639\u0646\u0643 \u0623\u0648\u0644 \u{1F604}"],
      iq: ["\u062A\u0634\u0631\u0641\u0646\u0627 \u{1F60A} \u0648\u0627\u0646\u062A\u061F", "\u0644\u064A\u0634 \u062A\u0633\u0623\u0644\u061F \u{1F604}", "\u0643\u0644\u064A \u0639\u0646 \u0646\u0641\u0633\u0643 \u0623\u0648\u0644 \u{1F604}"]
    }
  },
  {
    en: /\b(exam|test|quiz|study|studying|homework|assignment|work|shift|class|school|college|uni)\b/,
    ar: /اختبار|امتحان|مذاكره|اذاكر|ادرس|دوام|شغل|جامعه|مدرسه|واجب|بحث|كويز/,
    replies: {
      en: ["Good luck! \u{1F340}", "You got this \u{1F4AA}", "Hang in there!", "Hope it goes well!", "Don't stress too much \u{1F90D}"],
      ar: ["\u0628\u0627\u0644\u062A\u0648\u0641\u064A\u0642 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0639\u064A\u0646\u0643", "\u0634\u062F \u062D\u064A\u0644\u0643 \u{1F4AA}", "\u0631\u0643\u0632 \u0648\u0628\u062A\u0646\u062C\u062D \u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647", "\u0627\u0644\u0644\u0647 \u064A\u0633\u0647\u0644 \u0639\u0644\u064A\u0643", "\u0644\u0627 \u062A\u0636\u063A\u0637 \u0639\u0644\u0649 \u0646\u0641\u0633\u0643 \u{1F90D}"],
      eg: ["\u0628\u0627\u0644\u062A\u0648\u0641\u064A\u0642 \u{1F90D}", "\u0631\u0628\u0646\u0627 \u0645\u0639\u0627\u0643", "\u0634\u062F \u062D\u064A\u0644\u0643 \u{1F4AA}", "\u0647\u062A\u0639\u062F\u064A\u0647\u0627 \u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647"],
      lev: ["\u0628\u0627\u0644\u062A\u0648\u0641\u064A\u0642 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0642\u0648\u064A\u0643", "\u0634\u062F \u062D\u064A\u0644\u0643 \u{1F4AA}", "\u0631\u062D \u062A\u0645\u0631\u0642 \u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647"],
      iq: ["\u0628\u0627\u0644\u062A\u0648\u0641\u064A\u0642 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0639\u064A\u0646\u0643", "\u0634\u062F \u062D\u064A\u0644\u0643 \u{1F4AA}", "\u0631\u0627\u062D \u062A\u0639\u0628\u0631\u0647\u0627 \u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647"]
    }
  },
  {
    en: /\b(busy|brb|one sec|1 sec|wait|hold on|give me a (sec|min|minute))\b/,
    ar: /مشغول|بعدين|لحظه|ثواني|دقيقه|انتظر|استني|استناني/,
    replies: {
      en: ["Take your time \u{1F44D}", "No rush!", "Sure, I'll wait", "Okay, ping me when you're free"],
      ar: ["\u062E\u0630 \u0631\u0627\u062D\u062A\u0643 \u{1F44D}", "\u062A\u0645\u0627\u0645\u060C \u0623\u0646\u062A\u0638\u0631\u0643", "\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u062A\u0645\u0627\u0645\u060C \u0643\u0644\u0645\u0646\u064A \u0644\u0645\u0627 \u062A\u0641\u0636\u0649", "\u0639\u0644\u0649 \u0631\u0627\u062D\u062A\u0643"],
      eg: ["\u0628\u0631\u0627\u062D\u062A\u0643 \u{1F44D}", "\u062A\u0645\u0627\u0645\u060C \u0645\u0633\u062A\u0646\u064A\u0643", "\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0643\u0644\u0645\u0646\u064A \u0644\u0645\u0627 \u062A\u0641\u0636\u0649"],
      lev: ["\u062E\u0648\u062F \u0631\u0627\u062D\u062A\u0643 \u{1F44D}", "\u062A\u0645\u0627\u0645\u060C \u0646\u0627\u0637\u0631\u0643", "\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u0627\u062D\u0643\u064A\u0646\u064A \u0644\u0645\u0627 \u062A\u0641\u0636\u0649"],
      iq: ["\u0639\u0644\u0649 \u0631\u0627\u062D\u062A\u0643 \u{1F44D}", "\u062A\u0645\u0627\u0645\u060C \u0623\u0646\u062A\u0638\u0631\u0643", "\u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u062D\u0627\u062C\u064A\u0646\u064A \u0645\u0646 \u062A\u0641\u0636\u0649"]
    }
  },
  {
    en: /\b(tired|sick|sad|upset|exhausted|not feeling well|depressed)\b/,
    ar: /تعبان|مريض|زعلان|حزين|مضايق|مخنوق|مصدع|ضايج|مقهور/,
    replies: {
      en: ["Feel better soon \u{1F90D}", "Oh no, what happened?", "Get some rest!", "I'm here if you want to talk", "Sending hugs \u{1FAC2}"],
      ar: ["\u0633\u0644\u0627\u0645\u062A\u0643 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0634\u0641\u064A\u0643\u060C \u0627\u0631\u062A\u0627\u062D", "\u0648\u0634 \u0641\u064A\u0643\u061F \u0642\u0648\u0644\u064A", "\u0645\u0627 \u062A\u0634\u0648\u0641 \u0634\u0631", "\u0623\u0646\u0627 \u0645\u0648\u062C\u0648\u062F \u0644\u0648 \u062A\u0628\u064A \u062A\u0633\u0648\u0644\u0641", "\u0637\u0647\u0648\u0631 \u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647"],
      eg: ["\u0633\u0644\u0627\u0645\u062A\u0643 \u{1F90D}", "\u0623\u0644\u0641 \u0633\u0644\u0627\u0645\u0629\u060C \u0627\u0631\u062A\u0627\u062D", "\u0645\u0627\u0644\u0643\u061F \u0627\u062D\u0643\u064A\u0644\u064A", "\u0631\u0628\u0646\u0627 \u064A\u0634\u0641\u064A\u0643"],
      lev: ["\u0633\u0644\u0627\u0645\u062A\u0643 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0634\u0641\u064A\u0643\u060C \u0627\u0631\u062A\u0627\u062D", "\u0634\u0648 \u0628\u0643\u061F \u0627\u062D\u0643\u064A\u0644\u064A", "\u0645\u0627 \u062A\u0634\u0648\u0641 \u0634\u0631"],
      iq: ["\u0633\u0644\u0627\u0645\u062A\u0643 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u0634\u0627\u0641\u064A\u0643\u060C \u0627\u0631\u062A\u0627\u062D", "\u0634\u0628\u064A\u0643\u061F \u0627\u062D\u062C\u064A\u0644\u064A", "\u0645\u0627 \u062A\u0634\u0648\u0641 \u0634\u0631"]
    }
  },
  {
    en: /\b(bored|boring)\b/,
    ar: /طفشان|طفش|زهقان|ملل|مليت|ضجران/,
    replies: {
      en: ["Same \u{1F605} wanna play something?", "Hop in voice, let's talk", "Let's do something!", "Wanna watch something?"],
      ar: ["\u0648\u0627\u0646\u0627 \u0648\u0627\u0644\u0644\u0647 \u{1F605} \u0646\u0644\u0639\u0628 \u0634\u064A\u061F", "\u062A\u0639\u0627\u0644 \u0627\u0644\u0631\u0648\u0645 \u0646\u0633\u0648\u0644\u0641", "\u064A\u0644\u0627 \u0646\u0633\u0648\u064A \u0634\u064A!", "\u0646\u0634\u0648\u0641 \u0641\u0644\u0645\u061F"],
      eg: ["\u0648\u0627\u0646\u0627 \u0643\u0645\u0627\u0646 \u{1F605} \u0646\u0644\u0639\u0628 \u062D\u0627\u062C\u0629\u061F", "\u062A\u0639\u0627\u0644\u0649 \u0627\u0644\u0631\u0648\u0645 \u0646\u062A\u0643\u0644\u0645", "\u064A\u0644\u0627 \u0646\u0639\u0645\u0644 \u062D\u0627\u062C\u0629!"],
      lev: ["\u0648\u0627\u0646\u0627 \u0643\u0645\u0627\u0646 \u{1F605} \u0645\u0646\u0644\u0639\u0628 \u0634\u064A\u061F", "\u062A\u0639\u0627 \u0639\u0627\u0644\u0631\u0648\u0645 \u0646\u062D\u0643\u064A", "\u064A\u0644\u0627 \u0646\u0639\u0645\u0644 \u0634\u064A!"],
      iq: ["\u0648\u0627\u0646\u0627 \u0647\u0645 \u{1F605} \u0646\u0644\u0639\u0628 \u0634\u064A\u061F", "\u062A\u0639\u0627\u0644 \u0644\u0644\u0631\u0648\u0645 \u0646\u062D\u062C\u064A", "\u064A\u0644\u0627 \u0646\u0633\u0648\u064A \u0634\u064A!"]
    }
  },
  {
    en: /\b(sleep|sleeping|going to bed|sleepy|gonna sleep)\b/,
    ar: /نايم|بنام|رايح انام|نعسان|بروح انام|هنام/,
    replies: {
      en: ["Sleep well! \u{1F634}", "Good night \u{1F319}", "Get some rest, talk tomorrow", "Sweet dreams \u2728"],
      ar: ["\u0646\u0648\u0645 \u0627\u0644\u0639\u0648\u0627\u0641\u064A \u{1F634}", "\u062A\u0635\u0628\u062D \u0639\u0644\u0649 \u062E\u064A\u0631 \u{1F319}", "\u0631\u0648\u062D \u0646\u0627\u0645\u060C \u0646\u0643\u0645\u0644 \u0628\u0643\u0631\u0629", "\u0623\u062D\u0644\u0627\u0645 \u0633\u0639\u064A\u062F\u0629 \u2728"],
      eg: ["\u0646\u0648\u0645 \u0627\u0644\u0647\u0646\u0627 \u{1F634}", "\u062A\u0635\u0628\u062D \u0639\u0644\u0649 \u062E\u064A\u0631 \u{1F319}", "\u0631\u0648\u062D \u0646\u0627\u0645 \u0648\u0646\u0643\u0645\u0644 \u0628\u0643\u0631\u0629"],
      lev: ["\u0646\u0648\u0645 \u0627\u0644\u0647\u0646\u0627 \u{1F634}", "\u062A\u0635\u0628\u062D \u0639\u0644\u0649 \u062E\u064A\u0631 \u{1F319}", "\u0631\u0648\u062D \u0646\u0627\u0645\u060C \u0645\u0646\u0643\u0645\u0644 \u0628\u0643\u0631\u0627"],
      iq: ["\u0646\u0648\u0645 \u0627\u0644\u0639\u0648\u0627\u0641\u064A \u{1F634}", "\u062A\u0635\u0628\u062D \u0639\u0644\u0649 \u062E\u064A\u0631 \u{1F319}", "\u0631\u0648\u062D \u0646\u0627\u0645\u060C \u0646\u0643\u0645\u0644 \u0628\u0627\u062C\u0631"]
    }
  },
  {
    en: /\b(bye+|gn|good ?night|see (you|ya)|cya|ttyl|later|take care)\b/,
    ar: /باي|تصبح علي خير|مع السلامه|يلا سلام|اشوفك|نلتقي|في امان الله|بامان الله/,
    replies: {
      en: ["Bye! \u{1F44B}", "Good night! \u{1F319}", "See you later!", "Take care! \u{1F90D}", "Talk soon!"],
      ar: ["\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u{1F44B}", "\u0648\u0627\u0646\u062A \u0645\u0646 \u0623\u0647\u0644\u0647 \u{1F319}", "\u0646\u0634\u0648\u0641\u0643 \u0628\u0639\u062F\u064A\u0646!", "\u0641\u064A \u0623\u0645\u0627\u0646 \u0627\u0644\u0644\u0647 \u{1F90D}", "\u0627\u0644\u0644\u0647 \u064A\u062D\u0641\u0638\u0643", "\u0627\u0644\u0644\u0647 \u0645\u0639\u0643"],
      eg: ["\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u{1F44B}", "\u0648\u0627\u0646\u062A \u0645\u0646 \u0623\u0647\u0644\u0647 \u{1F319}", "\u0646\u062A\u0643\u0644\u0645 \u0628\u0639\u062F\u064A\u0646!", "\u0641\u064A \u0631\u0639\u0627\u064A\u0629 \u0627\u0644\u0644\u0647 \u{1F90D}", "\u0633\u0644\u0627\u0645 \u064A\u0627 \u0628\u0627\u0634\u0627"],
      lev: ["\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u{1F44B}", "\u0648\u0627\u0646\u062A \u0645\u0646 \u0623\u0647\u0644\u0648 \u{1F319}", "\u0645\u0646\u062D\u0643\u064A \u0628\u0639\u062F\u064A\u0646!", "\u0627\u0644\u0644\u0647 \u0645\u0639\u0643 \u{1F90D}", "\u064A\u0644\u0627 \u0628\u0627\u064A"],
      iq: ["\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u{1F44B}", "\u0648\u0627\u0646\u062A \u0645\u0646 \u0623\u0647\u0644\u0647 \u{1F319}", "\u0646\u062D\u062C\u064A \u0628\u0639\u062F\u064A\u0646!", "\u0627\u0644\u0644\u0647 \u0648\u064A\u0627\u0643 \u{1F90D}", "\u0628\u0623\u0645\u0627\u0646 \u0627\u0644\u0644\u0647"]
    }
  },
  {
    ar: /ان شاء الله|انشالله|انشاءالله|انشاالله/,
    en: /\b(inshallah|insha'?allah)\b/,
    replies: {
      en: ["Inshallah \u{1F932}", "Ameen", "Hopefully!"],
      ar: ["\u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647 \u{1F932}", "\u064A\u0627 \u0631\u0628", "\u0627\u0644\u0644\u0647 \u064A\u0643\u062A\u0628 \u0627\u0644\u0644\u064A \u0641\u064A\u0647 \u0627\u0644\u062E\u064A\u0631", "\u0622\u0645\u064A\u0646"],
      eg: ["\u0625\u0646 \u0634\u0627\u0621 \u0627\u0644\u0644\u0647 \u{1F932}", "\u064A\u0627 \u0631\u0628", "\u0631\u0628\u0646\u0627 \u064A\u0633\u0647\u0644"]
    }
  },
  {
    ar: /^(يلا|يالله|هيا|يلا بينا)/,
    en: /^(let'?s go|lets go|come on)\b/,
    replies: {
      en: ["Let's go! \u{1F525}", "Coming!", "One sec!"],
      ar: ["\u064A\u0644\u0627 \u{1F525}", "\u062C\u0627\u064A!", "\u062B\u0648\u0627\u0646\u064A \u0628\u0633"],
      eg: ["\u064A\u0644\u0627 \u0628\u064A\u0646\u0627 \u{1F525}", "\u062C\u0627\u064A!", "\u062B\u0627\u0646\u064A\u0629 \u0628\u0633"]
    }
  },
  {
    en: /\b(lol|lmao|lmfao|xd|ha(ha)+|rofl)\b|😂|🤣/,
    ar: /ههه+|خخخ+|😂|🤣/,
    replies: {
      en: ["\u{1F602}\u{1F602}", "lmao", "haha true", "\u{1F480}\u{1F480}", "I'm dead \u{1F602}", "Stoppp \u{1F602}"],
      ar: ["\u{1F602}\u{1F602}", "\u0647\u0647\u0647\u0647\u0647\u0647\u0647\u0647", "\u0648\u0627\u0644\u0644\u0647 \u0636\u062D\u0643\u062A\u0646\u064A \u{1F602}", "\u{1F480}\u{1F480}", "\u0647\u0647\u0647\u0647\u0647 \u0645\u0648 \u0637\u0628\u064A\u0639\u064A", "\u062E\u0644\u0627\u0635 \u0628\u0645\u0648\u062A \u0636\u062D\u0643 \u{1F602}"],
      eg: ["\u{1F602}\u{1F602}", "\u0647\u0647\u0647\u0647\u0647\u0647", "\u0645\u0648\u062A\u062A\u0646\u064A \u0645\u0646 \u0627\u0644\u0636\u062D\u0643 \u{1F602}", "\u0625\u0646\u062A \u0645\u0634 \u0637\u0628\u064A\u0639\u064A \u{1F602}", "\u{1F480}\u{1F480}"],
      lev: ["\u{1F602}\u{1F602}", "\u0647\u0647\u0647\u0647\u0647\u0647\u0647", "\u0641\u0637\u0633\u062A\u0646\u064A \u0636\u062D\u0643 \u{1F602}", "\u{1F480}\u{1F480}", "\u0634\u0648 \u0647\u0627\u062F \u{1F602}"],
      iq: ["\u{1F602}\u{1F602}", "\u0647\u0647\u0647\u0647\u0647\u0647", "\u0645\u0648\u062A\u062A\u0646\u064A \u{1F602}", "\u{1F480}\u{1F480}", "\u0634\u0646\u0648 \u0647\u0630\u0627 \u{1F602}"]
    }
  },
  {
    en: /\b(nice|cool|awesome|amazing|great|beautiful|perfect|fire|insane)\b|🔥|😍/,
    ar: /حلو|روعه|جميل|خرافي|كفو|يجنن|ابداع|رهيب|فخم|جامد|تحفه|حلوه/,
    replies: {
      en: ["Thanks! \u{1F604}", "Glad you like it!", "\u{1F525}\u{1F525}", "Right?! \u{1F604}", "Appreciate it!"],
      ar: ["\u0634\u0643\u0631\u0627\u064B \u2764\uFE0F", "\u062A\u0633\u0644\u0645 \u{1F604}", "\u0643\u0641\u0648 \u0648\u0627\u0644\u0644\u0647", "\u0635\u062D\u061F \u{1F604}", "\u0639\u064A\u0648\u0646\u0643 \u0627\u0644\u062D\u0644\u0648\u0629", "\u0627\u0644\u0644\u0647 \u064A\u0633\u0644\u0645\u0643"],
      eg: ["\u062A\u0633\u0644\u0645 \u{1F604}", "\u0645\u064A\u0631\u0633\u064A \u2764\uFE0F", "\u0635\u062D\u061F \u{1F604}", "\u062D\u0628\u064A\u0628\u064A \u0648\u0627\u0644\u0644\u0647"],
      lev: ["\u064A\u0633\u0644\u0645\u0648 \u2764\uFE0F", "\u062A\u0633\u0644\u0645 \u{1F604}", "\u0639\u064A\u0648\u0646\u0643 \u0627\u0644\u062D\u0644\u0648\u064A\u0646", "\u0635\u062D\u061F \u{1F604}"],
      iq: ["\u062A\u0633\u0644\u0645 \u0639\u064A\u0646\u064A \u2764\uFE0F", "\u0639\u064A\u0648\u0646\u0643 \u0627\u0644\u062D\u0644\u0648\u0629 \u{1F604}", "\u0635\u062D\u061F \u{1F604}"]
    }
  },
  {
    en: /https?:\/\//,
    ar: /https?:\/\//,
    replies: {
      en: ["Thanks for sharing!", "Checking it out \u{1F440}", "Nice!", "What is it about?", "I\u2019ll take a look"],
      ar: ["\u0634\u0643\u0631\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0631\u0627\u0628\u0637!", "\u0628\u0634\u0648\u0641\u0647 \u{1F440}", "\u062D\u0644\u0648!", "\u0639\u0646 \u0648\u0634 \u0627\u0644\u0631\u0627\u0628\u0637\u061F", "\u0628\u0634\u0648\u0641\u0647 \u0625\u0630\u0627 \u0641\u0636\u064A\u062A"],
      eg: ["\u0647\u0634\u0648\u0641\u0647 \u{1F440}", "\u0645\u064A\u0631\u0633\u064A!", "\u062D\u0644\u0648!"],
      lev: ["\u0631\u062D \u0634\u0648\u0641\u0647 \u{1F440}", "\u064A\u0633\u0644\u0645\u0648!", "\u062D\u0644\u0648!"],
      iq: ["\u0631\u0627\u062D \u0623\u0634\u0648\u0641\u0647 \u{1F440}", "\u062A\u0633\u0644\u0645!", "\u062D\u0644\u0648!"]
    }
  },
  {
    en: /^(ok|okay|k|kk|sure|alright|true|yes|yep|yeah|yup|bet|deal|fine)\b/,
    ar: /^(تمام|اوكي|اوك|طيب|ماشي|اكيد|صح|زين|ابشر|خلاص|اوكيه|تم|ايوه|ايوا)/,
    replies: {
      en: ["\u{1F44D}", "Great!", "Deal \u{1F91D}", "Perfect \u{1F44C}", "Sounds good"],
      ar: ["\u{1F44D}", "\u062A\u0645\u0627\u0645 \u{1F44C}", "\u0627\u062A\u0641\u0642\u0646\u0627", "\u062D\u0644\u0648 \u{1F44C}", "\u0623\u0628\u0634\u0631", "\u062A\u0645"],
      eg: ["\u{1F44D}", "\u062A\u0645\u0627\u0645 \u{1F44C}", "\u0627\u062A\u0641\u0642\u0646\u0627", "\u0645\u0627\u0634\u064A", "\u062D\u0644\u0648 \u0643\u062F\u0647"],
      lev: ["\u{1F44D}", "\u062A\u0645\u0627\u0645 \u{1F44C}", "\u0627\u062A\u0641\u0642\u0646\u0627", "\u0645\u0646\u064A\u062D", "\u0645\u0627\u0634\u064A \u0627\u0644\u062D\u0627\u0644"],
      iq: ["\u{1F44D}", "\u062A\u0645\u0627\u0645 \u{1F44C}", "\u0627\u062A\u0641\u0642\u0646\u0627", "\u0632\u064A\u0646", "\u0645\u0627\u0634\u064A"]
    }
  },
  {
    en: /^(no|nah|nope|can'?t|cannot)\b/,
    ar: /^(لا|لاء|مستحيل|ما اقدر|مو|مش|ما بقدر|ما اكدر)(\s|$)/,
    replies: {
      en: ["No worries!", "Alright, maybe later", "Okay \u{1F44D}", "All good"],
      ar: ["\u062A\u0645\u0627\u0645\u060C \u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u062E\u0644\u0627\u0635 \u0628\u0631\u0627\u062D\u062A\u0643", "\u0623\u0648\u0643\u064A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0645\u0627 \u0639\u0644\u064A\u0647"],
      eg: ["\u062A\u0645\u0627\u0645\u060C \u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u062E\u0644\u0627\u0635 \u0628\u0631\u0627\u062D\u062A\u0643", "\u0645\u0627\u0634\u064A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0645\u0641\u064A\u0634 \u0645\u0634\u0643\u0644\u0629"],
      lev: ["\u062A\u0645\u0627\u0645\u060C \u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u062E\u0644\u0635 \u0628\u0631\u0627\u062D\u062A\u0643", "\u0645\u0627\u0634\u064A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0645\u0627 \u0641\u064A \u0645\u0634\u0643\u0644\u0629"],
      iq: ["\u062A\u0645\u0627\u0645\u060C \u0648\u0644\u0627 \u064A\u0647\u0645\u0643", "\u062E\u0644\u0627\u0635 \u0628\u0631\u0627\u062D\u062A\u0643", "\u0645\u0627\u0634\u064A\u060C \u0628\u0639\u062F\u064A\u0646\u061F", "\u0645\u0627\u0643\u0648 \u0645\u0634\u0643\u0644\u0629"]
    }
  },
  {
    generic: true,
    en: /\?\s*$|^(what|when|where|why|how|who|which|can|could|do|does|did|is|are|will|would|should)\b/,
    ar: /[؟?]\s*$|(^|\s)(هل|متي|وين|ليش|كيف|شو|ايش|وش|مين|قديش|كم|ليه|ازاي|امتي|فين|شنو|شوكت|ليش)(\s|$)/,
    replies: {
      en: ["Could you give me a bit more context?", "Let me check and get back to you", "I\u2019m not sure yet", "What do you mean exactly?", "Can you tell me more?"],
      ar: ["\u0645\u0645\u0643\u0646 \u062A\u0648\u0636\u062D \u0623\u0643\u062B\u0631\u061F", "\u062E\u0644\u0646\u064A \u0623\u062A\u0623\u0643\u062F \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643", "\u0645\u0627 \u0639\u0646\u062F\u064A \u062C\u0648\u0627\u0628 \u0623\u0643\u064A\u062F \u0644\u0644\u062D\u064A\u0646", "\u0648\u0634 \u062A\u0642\u0635\u062F \u0628\u0627\u0644\u0636\u0628\u0637\u061F", "\u0642\u0648\u0644\u064A \u062A\u0641\u0627\u0635\u064A\u0644 \u0623\u0643\u062B\u0631"],
      eg: ["\u0645\u0645\u0643\u0646 \u062A\u0648\u0636\u062D \u0623\u0643\u062A\u0631\u061F", "\u0647\u0634\u0648\u0641 \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643", "\u0645\u0634 \u0645\u062A\u0623\u0643\u062F \u0644\u0633\u0647", "\u062A\u0642\u0635\u062F \u0625\u064A\u0647 \u0628\u0627\u0644\u0636\u0628\u0637\u061F"],
      lev: ["\u0645\u0645\u0643\u0646 \u062A\u0648\u0636\u062D \u0623\u0643\u062A\u0631\u061F", "\u062E\u0644\u064A\u0646\u064A \u0634\u0648\u0641 \u0648\u0628\u0631\u062C\u0639\u0644\u0643", "\u0645\u0634 \u0645\u062A\u0623\u0643\u062F \u0628\u0639\u062F", "\u0634\u0648 \u0642\u0635\u062F\u0643 \u0628\u0627\u0644\u0636\u0628\u0637\u061F"],
      iq: ["\u0645\u0645\u0643\u0646 \u062A\u0648\u0636\u062D \u0623\u0643\u062B\u0631\u061F", "\u062E\u0644\u064A \u0623\u0634\u0648\u0641 \u0648\u0623\u0631\u062F \u0639\u0644\u064A\u0643", "\u0645\u0627 \u0645\u062A\u0623\u0643\u062F \u0628\u0639\u062F", "\u0634\u0646\u0648 \u062A\u0642\u0635\u062F \u0628\u0627\u0644\u0636\u0628\u0637\u061F"]
    }
  }
];

// ../friendsInVoice/smartReplyEngine.ts
var RULES = [...FIRST_RULES, ...SECOND_RULES];
var FALLBACK = {
  en: ["\u{1F44D}", "Okay", "Got it!", "Haha", "Alright \u{1F44C}", "I see"],
  ar: ["\u{1F44D}", "\u062A\u0645\u0627\u0645", "\u0645\u0627\u0634\u064A", "\u0637\u064A\u0628", "\u0623\u0648\u0643\u064A \u{1F44C}", "\u0641\u0627\u0647\u0645 \u0639\u0644\u064A\u0643"],
  eg: ["\u{1F44D}", "\u062A\u0645\u0627\u0645", "\u0645\u0627\u0634\u064A", "\u0637\u0628", "\u0641\u0627\u0647\u0645\u0643"],
  lev: ["\u{1F44D}", "\u062A\u0645\u0627\u0645", "\u0645\u0627\u0634\u064A", "\u0637\u064A\u0628", "\u0641\u0647\u0645\u062A \u0639\u0644\u064A\u0643"],
  iq: ["\u{1F44D}", "\u062A\u0645\u0627\u0645", "\u0645\u0627\u0634\u064A", "\u0632\u064A\u0646", "\u0641\u0647\u0645\u062A \u0639\u0644\u064A\u0643"]
};
var DIALECT_MARKERS = [
  ["eg", /(^|[\s،,.!؟?])(ازيك|ازيكم|ازيكو|دلوقتي|عايز|عاوز|عايزه|ازاي|خالص|اوي|بقي|بتاع|عامل ايه|بتعمل ايه|يا عم|ياعم|امتي|كده|النهارده|هنا اهو|مفيش|معلش|طب)(?=$|[\s،,.!؟?])/],
  ["lev", /(^|[\s،,.!؟?])(هلق|منيح|منيحه|كتير|بدي|بدك|بدو|هيك|شو|عنجد|زلمه|ولك|تقبرني|مبلا|هون|منحكي|بحكي|عم)(?=$|[\s،,.!؟?])/],
  ["iq", /(^|[\s،,.!؟?])(شلونك|شلونكم|شكو|ماكو|اكو|هسه|هسا|كلش|شنو|اغاتي|يمعود|معود|شكد|شوكت|باجر|احجي|هواي|هوايه)(?=$|[\s،,.!؟?])/]
];
var isArabic = (text) => /[؀-ۿ]/.test(text);
function normalize(text) {
  return text.toLowerCase().replace(/[\u064b-\u065f\u0670\u200c\u200d]/g, "").replace(/[أإآ]/g, "\u0627").replace(/ة/g, "\u0647").replace(/ى/g, "\u064A").replace(/ـ/g, "").replace(/\s+/g, " ").trim();
}
function detectDialect(normalized) {
  let best = "ar", bestScore = 0;
  for (const [dialect, re] of DIALECT_MARKERS) {
    const score = (normalized.match(new RegExp(re.source, "g")) ?? []).length;
    if (score > bestScore) [best, bestScore] = [dialect, score];
  }
  return best;
}
function repliesFor(replies, lang, dialect) {
  if (lang === "en") return replies.en;
  return dialect !== "ar" && replies[dialect] || replies.ar;
}
function pick(list, count, seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ i, 16777619);
    const j = (h >>> 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}
function ruleReplies(content, hasAttachments, seed = "") {
  const text = normalize(content);
  const lang = isArabic(content) ? "ar" : "en";
  const dialect = lang === "ar" ? detectDialect(text) : "ar";
  if (!text) return hasAttachments ? pick(lang === "ar" ? ["\u0648\u0635\u0644\u062A\u0646\u064A \u{1F440}", "\u0648\u0634 \u0641\u064A\u0647\u0627\u061F", "\u0634\u0643\u0631\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629", "\u0628\u0634\u0648\u0641\u0647\u0627"] : ["Got it \u{1F440}", "What's in it?", "Thanks for sharing", "I'll take a look"], 3, seed) : pick(["\u2764\uFE0F", "\u{1F44D}", "\u{1F440}", "\u{1F90D}"], 3, seed);
  const condolence = RULES[1];
  const match = (rule2) => rule2[lang]?.test(text) ?? false;
  const question = RULES.find((candidate) => candidate.generic && match(candidate));
  const rule = match(condolence) ? condolence : QUESTION_RULES.find(match) ?? question ?? RULES.find((candidate) => !candidate.generic && match(candidate));
  const choices = repliesFor(rule?.replies ?? FALLBACK, lang, dialect);
  return pick([...new Set(choices)], Math.min(4, choices.length), seed || text);
}

// src/replies.js
var SYSTEM_PROMPT = `You suggest quick replies for a Discord direct message conversation.
Write 3 short, natural replies the user could send to the other person's latest message.
Reply in the same language and dialect, match the tone, and keep each reply under 15 words.
Return only the requested JSON object.`;
var ReplyService = class {
  constructor(api, bridge, data) {
    this.api = api;
    this.bridge = bridge;
    this.data = data;
  }
  current() {
    const item = this.bridge.lastIncomingDm();
    if (!item || !this.data.value.smartReplies) return null;
    return {
      channelId: item.channel.id,
      messageId: item.message.id,
      replies: ruleReplies(item.message.content ?? "", !!item.message.attachments?.length, item.message.id)
    };
  }
  async aiReplies() {
    if (!this.data.value.smartRepliesAi) throw new Error("Smarter replies are disabled in settings.");
    const apiKey = this.data.value.anthropicApiKey.trim();
    if (!apiKey) throw new Error("Add your Claude API key in plugin settings first.");
    const current = this.current();
    if (!current) throw new Error("Open a DM with a recent incoming message first.");
    const lines = this.bridge.recentDmLines(current.channelId);
    if (!lines.length) throw new Error("No DM text is available to suggest a reply.");
    const model = this.data.value.aiModel.trim() || "claude-opus-5-5";
    const response = await this.api.Net.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 1e3,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: {
          type: "object",
          properties: { replies: { type: "array", items: { type: "string" } } },
          required: ["replies"],
          additionalProperties: false
        } } },
        messages: [{ role: "user", content: `Conversation (most recent last):
${lines.map((line) => `${line.mine ? "Me" : "Them"}: ${line.content}`).join("\n")}` }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? `Claude returned HTTP ${response.status}.`);
    const text = (data.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("");
    const replies = JSON.parse(text).replies;
    if (!Array.isArray(replies)) throw new Error("Claude returned an unexpected response.");
    return replies.filter((reply) => typeof reply === "string" && reply.trim()).map((reply) => reply.trim()).slice(0, 3);
  }
};

// src/dom.js
function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(label, onClick, className = "") {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}
function paragraph(text, className = "") {
  return element("p", className, text);
}
function add(parent, ...children) {
  for (const child of children) if (child) parent.append(child);
  return parent;
}
function heading(text, level = 3) {
  return element(`h${level}`, "", text);
}

// src/settingsUi.js
var SWITCHES = [
  ["notifyOnce", "Remove an online alert after it fires once"],
  ["smartReplies", "Show built-in smart replies in the dashboard"],
  ["smartRepliesAi", "Enable the optional Claude reply button"],
  ["checkForUpdates", "Check GitHub for BetterDiscord plugin releases"]
];
function settingsPanel(view) {
  const root = element("div", "fivbd-setting");
  add(
    root,
    heading("FriendsInVoice settings", 2),
    paragraph("BetterDiscord settings are stored separately from Vencord settings. Personal Guards needs a fresh permission exchange on this client."),
    button("Open FriendsInVoice", () => view.open("voice"))
  );
  for (const [key, title] of SWITCHES) {
    const label = element("label");
    const input = element("input");
    input.type = "checkbox";
    input.checked = view.data.value[key];
    input.addEventListener("change", () => {
      view.data.set(key, input.checked);
      view.render();
    });
    add(label, input, element("span", "", title));
    root.append(label);
  }
  for (const [key, title, type] of [
    ["anthropicApiKey", "Claude API key (saved on this computer)", "password"],
    ["aiModel", "Claude model", "text"]
  ]) {
    const label = element("label");
    label.style.alignItems = "flex-start";
    label.style.flexDirection = "column";
    const input = element("input");
    input.type = type;
    input.value = view.data.value[key];
    input.autocomplete = "off";
    input.addEventListener("change", () => view.data.set(key, input.value.trim()));
    add(label, element("span", "", title), input);
    root.append(label);
  }
  root.append(button("Check for updates", () => void view.alerts.checkUpdate(true)));
  return root;
}

// src/style.js
var STYLE = `
.fivbd-launch{position:fixed;bottom:82px;left:76px;z-index:9000;padding:8px 11px;border-radius:10px;border:1px solid var(--border-subtle);background:var(--background-floating);color:var(--text-normal);cursor:pointer;box-shadow:0 4px 16px #0005}
.fivbd-shade{position:fixed;inset:0;z-index:10000;background:#0009;display:flex;align-items:center;justify-content:center;padding:18px}
.fivbd-panel{width:min(920px,100%);max-height:90vh;display:flex;flex-direction:column;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--border-subtle);border-radius:14px;box-shadow:0 18px 55px #0008;overflow:hidden}
.fivbd-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle)}
.fivbd-head h2{margin:0;font-size:19px}.fivbd-tabs{display:flex;flex-wrap:wrap;gap:5px;padding:10px 16px;border-bottom:1px solid var(--border-subtle)}
.fivbd-body{padding:16px 18px;overflow:auto;min-height:260px}.fivbd-foot{padding:10px 18px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;color:var(--text-muted)}
.fivbd-panel button,.fivbd-setting button{cursor:pointer;padding:6px 10px;border-radius:7px;border:1px solid var(--border-subtle);background:var(--background-secondary);color:var(--text-normal)}
.fivbd-panel button:disabled{cursor:not-allowed;opacity:.5}.fivbd-panel button:hover:not(:disabled){background:var(--background-mod-strong)}
.fivbd-panel .active{background:var(--brand-500);color:white}.fivbd-panel .danger{color:var(--status-danger,#f23f43)}
.fivbd-search,.fivbd-setting input{box-sizing:border-box;width:100%;max-width:440px;padding:8px;margin:0 0 14px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--input-background);color:var(--text-normal)}
.fivbd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:12px 0 20px}
.fivbd-card{padding:13px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--background-secondary)}
.fivbd-card h3{margin:0 0 7px;font-size:15px}.fivbd-card p{margin:5px 0;color:var(--text-muted)}
.fivbd-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.fivbd-person{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle)}
.fivbd-muted{color:var(--text-muted)}.fivbd-guard-options{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}.fivbd-guard-options label{display:flex;align-items:center;gap:4px}
.fivbd-empty{padding:20px;text-align:center;color:var(--text-muted)}.fivbd-setting{display:flex;flex-direction:column;gap:12px;padding:12px;color:var(--text-normal)}
.fivbd-setting label{display:flex;align-items:center;gap:7px}.fivbd-setting input[type=checkbox]{width:auto;margin:0}
`;

// ../friendsInVoice/personalGuardsOnboarding.ts
function ownerSetupStep(actions) {
  return actions.length ? "invite" : "choose";
}
function ownerSetupMessage(step) {
  switch (step) {
    case "choose":
      return "Choose the actions this person may use on your account.";
    case "invite":
      return "Invite this guardian, then press Discord's Send button in the DM. They accept without sending a reply.";
  }
}

// src/viewGuards.js
function identity(id, view) {
  const user = view.bridge.user(id);
  const label = `${view.bridge.name(id)}${user ? ` \xB7 @${user.username}` : ""} \xB7 ${id}`;
  return button(label, () => {
    try {
      view.bridge.openProfile(id);
    } catch (error) {
      view.error(error);
    }
  });
}
function ownerCard(id, view) {
  const { data, guards } = view;
  const actions = guards.grantFor(id);
  const card = element("section", "fivbd-card");
  add(card, identity(id, view), paragraph(ownerSetupMessage(ownerSetupStep(actions, !!guards.keyFor(id)))));
  const options = element("div", "fivbd-guard-options");
  for (const action of GUARD_ACTIONS) {
    const label = element("label");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.checked = actions.includes(action);
    checkbox.addEventListener("change", () => {
      const next = checkbox.checked ? [...actions, action] : actions.filter((item) => item !== action);
      data.grant(id, next);
      view.render();
    });
    add(label, checkbox, element("span", "", GUARD_LABELS[action]));
    options.append(label);
  }
  card.append(options);
  const controls = element("div", "fivbd-actions");
  const prepare = button("Prepare access DM", () => void guards.sendGrant(id));
  prepare.disabled = !actions.length || !guards.keyFor(id);
  add(controls, prepare, button("Revoke and remove", () => {
    guards.revoke(id);
    view.render();
  }, "danger"));
  card.append(controls);
  return card;
}
function accessCard(id, view) {
  const card = element("section", "fivbd-card");
  const together = view.bridge.sharesVoice(id);
  add(card, identity(id, view), paragraph(together ? "Choose one action, then press Send in the prepared DM." : "Join the same voice channel to use guard actions."));
  const controls = element("div", "fivbd-actions");
  for (const action of view.guards.knownFor(id)) {
    const item = button(GUARD_LABELS[action], () => void view.guards.sendCommand(id, action));
    item.disabled = !together || !view.guards.keyFor(id);
    controls.append(item);
  }
  controls.append(button("Renew secure setup", () => void view.guards.sendKey(id)));
  card.append(controls);
  return card;
}
function renderGuardsTab(parent, view) {
  add(
    parent,
    heading("Personal Guards", 2),
    paragraph("Right-click a person in Discord \u2192 Personal Guards \u2192 Add as Guardian. Choose exactly which actions they may use on your account."),
    paragraph("They right-click your profile \u2192 Offer to guard and press Send for their public key. Click the received-key notice, prepare the encrypted access DM, and press Send. No DM is sent automatically.")
  );
  const search = element("input", "fivbd-search");
  search.type = "search";
  search.placeholder = "Search guardians and access\u2026";
  const contents = element("div");
  function update() {
    contents.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const match = (id) => `${view.bridge.name(id)} ${view.bridge.user(id)?.username ?? ""} ${id}`.toLowerCase().includes(query);
    add(contents, heading("People who guard me"));
    const owners = element("div", "fivbd-grid");
    for (const item of view.data.value.personalGuards.filter((item2) => match(item2.userId))) owners.append(ownerCard(item.userId, view));
    contents.append(owners);
    if (!view.data.value.personalGuards.length) contents.append(paragraph("No guardians yet. Add someone from their Discord right-click menu.", "fivbd-empty"));
    contents.append(heading("Access others gave you"));
    const access = element("div", "fivbd-grid");
    for (const item of view.data.value.knownGuardGrants.filter((item2) => match(item2.userId))) access.append(accessCard(item.userId, view));
    contents.append(access);
    if (!view.data.value.knownGuardGrants.length) contents.append(paragraph("No access yet. Right-click an owner and choose Offer to guard.", "fivbd-empty"));
  }
  search.addEventListener("input", update);
  add(parent, search, contents);
  update();
}

// src/viewLists.js
var TAB_LISTS = {
  mine: [{ key: "watchlist", title: "My List", empty: "No people saved yet." }],
  alerts: [
    { key: "notifyOnline", title: "Notify when online", empty: "No online alerts yet." },
    { key: "notifyVoice", title: "Notify when in voice", empty: "No voice alerts yet." }
  ],
  runaway: [{ key: "blacklist", title: "Run Away", empty: "No people on your Run Away list." }]
};
function renderPicker(parent, view, key) {
  const { bridge, data } = view;
  const input = element("input", "fivbd-search");
  input.type = "search";
  input.placeholder = `Add a friend to ${key === "watchlist" ? "My List" : key === "blacklist" ? "Run Away" : "alerts"}\u2026`;
  input.setAttribute("aria-label", input.placeholder);
  const results = element("div", "fivbd-grid");
  function update() {
    results.replaceChildren();
    const query = input.value.trim().toLowerCase();
    if (!query) return;
    const ids = bridge.relationshipStore.getFriendIDs?.() ?? [];
    const matches = ids.filter((id) => !data.listHas(key, id) && `${bridge.name(id)} ${bridge.user(id)?.username ?? ""} ${id}`.toLowerCase().includes(query)).slice(0, 12);
    for (const id of matches) {
      const card = element("div", "fivbd-card");
      add(
        card,
        paragraph(`${bridge.name(id)} \xB7 ${bridge.user(id)?.username ?? id}`),
        button("Add", () => {
          data.toggleList(key, id);
          view.render();
        })
      );
      results.append(card);
    }
    if (!matches.length) results.append(paragraph("No matching friends found.", "fivbd-muted"));
  }
  input.addEventListener("input", update);
  add(parent, input, results);
}
function renderSection(parent, view, definition) {
  const { bridge, data } = view;
  parent.append(heading(definition.title));
  renderPicker(parent, view, definition.key);
  const ids = data.value[definition.key];
  if (!ids.length) {
    parent.append(paragraph(definition.empty, "fivbd-empty"));
    return;
  }
  const grid = element("div", "fivbd-grid");
  for (const id of ids) {
    const card = element("section", "fivbd-card");
    const room = bridge.voiceChannel(id);
    const channel = room && bridge.channel(room);
    add(
      card,
      heading(bridge.name(id)),
      paragraph(`@${bridge.user(id)?.username ?? id} \xB7 ${bridge.status(id)}`),
      paragraph(channel ? `${bridge.roomDescription(channel).roomName} \xB7 ${bridge.roomDescription(channel).place}` : "Not in a visible voice room")
    );
    const actions = element("div", "fivbd-actions");
    add(
      actions,
      button("Open DM", () => void bridge.openDm(id).catch((error) => view.error(error))),
      button("Remove", () => {
        data.toggleList(definition.key, id);
        view.render();
      }, "danger")
    );
    card.append(actions);
    grid.append(card);
  }
  parent.append(grid);
}
function renderListTab(parent, view, tab) {
  const definitions = TAB_LISTS[tab] ?? [];
  for (const definition of definitions) renderSection(parent, view, definition);
}

// src/viewReplies.js
function replyButton(text, view) {
  return button(text, () => {
    try {
      view.bridge.insertReply(text);
    } catch (error) {
      view.error(error);
    }
  });
}
function renderRepliesTab(parent, view) {
  add(
    parent,
    heading("Smart replies", 2),
    paragraph("Open a direct message with the other person's latest message. Click a suggestion to put it in Discord's message box; nothing is sent automatically.")
  );
  const current = view.replies.current();
  if (!current) {
    parent.append(paragraph("No recent incoming DM is selected, or smart replies are disabled.", "fivbd-empty"));
    return;
  }
  const suggestions = element("div", "fivbd-actions");
  for (const reply of current.replies) suggestions.append(replyButton(reply, view));
  parent.append(suggestions);
  if (view.data.value.smartRepliesAi) {
    const aiArea = element("div", "fivbd-actions");
    const ask = button("\u2728 Smarter replies", async () => {
      ask.disabled = true;
      ask.textContent = "Thinking\u2026";
      try {
        const replies = await view.replies.aiReplies();
        aiArea.replaceChildren();
        for (const reply of replies) aiArea.append(replyButton(reply, view));
        if (!replies.length) aiArea.append(paragraph("Claude returned no suggestions."));
      } catch (error) {
        view.error(error);
        ask.disabled = false;
        ask.textContent = "\u2728 Smarter replies";
      }
    });
    aiArea.append(ask);
    parent.append(aiArea);
    parent.append(paragraph("Only clicking Smarter replies sends up to eight recent DM lines to Anthropic.", "fivbd-muted"));
  }
}

// src/viewVoice.js
function renderVoiceTab(parent, view) {
  const input = element("input", "fivbd-search");
  input.type = "search";
  input.placeholder = "Search people, servers, or voice rooms\u2026";
  input.setAttribute("aria-label", input.placeholder);
  const results = element("div", "fivbd-grid");
  function update() {
    results.replaceChildren();
    const query = input.value.trim().toLowerCase();
    const rooms = view.bridge.rooms(view.data.value.watchlist, view.data.value.hidden).filter((room) => !query || `${room.place} ${room.roomName} ${room.members.map((member) => member.name).join(" ")}`.toLowerCase().includes(query));
    if (!rooms.length) {
      results.append(paragraph(query ? "Nothing matches your search." : "No friends in visible voice rooms.", "fivbd-empty"));
      return;
    }
    for (const room of rooms) {
      const card = element("section", "fivbd-card");
      add(card, element("h3", "", room.roomName), paragraph(room.place));
      for (const member of room.members) {
        const row = element("div", "fivbd-person");
        const flags = [member.mute && "muted", member.deaf && "deafened", member.stream && "streaming"].filter(Boolean).join(", ");
        add(
          row,
          element("span", "", `${member.name}${flags ? ` \xB7 ${flags}` : ""}`),
          button(member.watched ? "\u2605" : "\u2606", () => {
            view.data.toggleList("watchlist", member.id);
            update();
          })
        );
        card.append(row);
      }
      if (room.hiddenCount) card.append(paragraph(`\u{1F648} ${room.hiddenCount} hidden ${room.hiddenCount === 1 ? "person" : "people"}`, "fivbd-muted"));
      if (view.bridge.voiceChannel(view.bridge.currentId()) !== room.channelId && view.bridge.voiceChannelActions?.selectVoiceChannel) {
        const join = button(room.blocker ?? "Join voice", () => {
          try {
            view.bridge.voiceChannelActions.selectVoiceChannel(room.channelId);
          } catch (error) {
            view.error(error);
          }
        });
        join.disabled = !!room.blocker;
        card.append(join);
      }
      results.append(card);
    }
  }
  input.addEventListener("input", update);
  add(parent, input, results);
  update();
  renderHidden(parent, view);
}
function renderHidden(parent, view) {
  const ids = view.data.value.hidden;
  if (!ids.length) return;
  add(
    parent,
    element("h3", "", `\u{1F648} Hidden (${ids.length})`),
    paragraph("These people don't show up in In Voice. Show someone again here, or right-click them \u2192 Show in In Voice.", "fivbd-muted")
  );
  const list = element("div", "fivbd-grid");
  for (const id of ids) {
    const row = element("div", "fivbd-person");
    add(row, element("span", "", view.bridge.name(id)), button("Show", () => {
      view.data.toggleList("hidden", id);
      view.render();
    }));
    list.append(row);
  }
  parent.append(list);
}

// src/view.js
var TABS = [
  ["voice", "In Voice"],
  ["mine", "My List"],
  ["alerts", "Alerts"],
  ["runaway", "Run Away"],
  ["guards", "Personal Guards"],
  ["replies", "Smart replies"]
];
var Dashboard = class {
  constructor(api, bridge, data, version) {
    this.api = api;
    this.bridge = bridge;
    this.data = data;
    this.version = version;
    this.tab = "voice";
    this.shade = null;
    this.onKey = (event) => {
      if (event.key === "Escape") this.close();
    };
  }
  start() {
    this.api.DOM.addStyle(STYLE);
    this.launcher = button("\u{1F50A} Friends In Voice", () => this.open(), "fivbd-launch");
    document.body.append(this.launcher);
    document.addEventListener("keydown", this.onKey);
  }
  stop() {
    this.close();
    this.launcher?.remove();
    document.removeEventListener("keydown", this.onKey);
    this.api.DOM.removeStyle();
  }
  error(error) {
    this.api.UI.showToast(error instanceof Error ? error.message : String(error), { type: "error" });
  }
  open(tab = this.tab) {
    this.tab = TABS.some((item) => item[0] === tab) ? tab : "voice";
    if (!this.shade) {
      this.shade = element("div", "fivbd-shade");
      this.shade.addEventListener("click", (event) => {
        if (event.target === this.shade) this.close();
      });
      document.body.append(this.shade);
    }
    this.render();
  }
  close() {
    this.shade?.remove();
    this.shade = null;
  }
  refresh() {
    if (!this.shade || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    this.render();
  }
  render() {
    if (!this.shade) return;
    const oldBody = this.shade.querySelector(".fivbd-body");
    const scroll = oldBody?.scrollTop ?? 0;
    const panel = element("section", "fivbd-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Friends In Voice");
    const head = element("header", "fivbd-head");
    add(head, element("h2", "", "Friends In Voice"), button("\u2715", () => this.close()));
    const tabs = element("nav", "fivbd-tabs");
    for (const [id, title] of TABS) {
      const item = button(title, () => this.open(id), id === this.tab ? "active" : "");
      item.setAttribute("aria-current", id === this.tab ? "page" : "false");
      tabs.append(item);
    }
    const body = element("main", "fivbd-body");
    try {
      if (this.tab === "voice") renderVoiceTab(body, this);
      else if (["mine", "alerts", "runaway"].includes(this.tab)) renderListTab(body, this, this.tab);
      else if (this.tab === "guards") renderGuardsTab(body, this);
      else renderRepliesTab(body, this);
    } catch (error) {
      body.textContent = `This panel could not load: ${String(error)}`;
    }
    const foot = element("footer", "fivbd-foot");
    add(
      foot,
      element("span", "", `BetterDiscord \xB7 v${this.version}`),
      button("Check for updates", () => void this.alerts?.checkUpdate(true))
    );
    add(panel, head, tabs, body, foot);
    this.shade.replaceChildren(panel);
    body.scrollTop = scroll;
  }
};

// src/index.cjs
module.exports = class FriendsInVoice {
  constructor(meta) {
    this.version = meta?.version ?? "1.10.0";
    this.api = new globalThis.BdApi("FriendsInVoice");
    this.unsubscribers = [];
    this.started = false;
  }
  start() {
    if (this.started) return;
    try {
      this.data = new DataStore(this.api);
      this.bridge = new DiscordBridge(this.api);
      this.view = new Dashboard(this.api, this.bridge, this.data, this.version);
      this.guards = new GuardService(this.api, this.bridge, this.data, (tab) => this.view.open(tab));
      this.replies = new ReplyService(this.api, this.bridge, this.data);
      this.alerts = new AlertService(this.api, this.bridge, this.data, (tab) => this.view.open(tab), this.version);
      Object.assign(this.view, { guards: this.guards, replies: this.replies, alerts: this.alerts });
      this.view.start();
      this.unsubscribers.push(installUserMenu(this.api, this.view));
      const onMessage = (event) => void this.guards.onMessage(event?.message).catch((error) => this.api.Logger.error("Guard message failed", error));
      const onConnect = () => this.alerts.reconnect();
      this.bridge.dispatcher.subscribe("MESSAGE_CREATE", onMessage);
      this.bridge.dispatcher.subscribe("CONNECTION_OPEN", onConnect);
      this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("MESSAGE_CREATE", onMessage));
      this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("CONNECTION_OPEN", onConnect));
      this.alerts.seed();
      this.pollTimer = setInterval(() => {
        this.alerts.poll();
        this.view.refresh();
      }, 5e3);
      this.updateTimer = setInterval(() => void this.alerts.checkUpdate(), 6 * 60 * 60 * 1e3);
      this.started = true;
      void this.alerts.checkUpdate();
    } catch (error) {
      this.api.UI.showToast(`FriendsInVoice could not start: ${String(error)}`, { type: "error" });
      this.stop();
      throw error;
    }
  }
  stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.updateTimer);
    for (const unsubscribe of this.unsubscribers.splice(0).reverse()) {
      try {
        unsubscribe?.();
      } catch (error) {
        this.api.Logger.error("Cleanup failed", error);
      }
    }
    this.guards?.stop();
    this.view?.stop();
    this.started = false;
  }
  onSwitch() {
    this.view?.refresh();
  }
  getSettingsPanel() {
    return this.view ? settingsPanel(this.view) : document.createTextNode("Enable FriendsInVoice to view settings.");
  }
};
