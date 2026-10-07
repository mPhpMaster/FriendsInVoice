/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { openPrivateChannel } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelRouter, ChannelStore, GuildMemberStore, GuildStore, Menu, PermissionsBits, PermissionStore, PresenceStore, React, ReactDOM, RelationshipStore, SelectedChannelStore, SelectedGuildStore, showToast, Tooltip, useEffect, useMemo, useReducer, UserStore, UserUtils, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

const VERSION = "1.1.0";
const REPO = "mPhpMaster/FriendsInVoice";

const cl = classNameFactory("vc-fiv-");

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");
const StatusSettings = getUserSettingLazy<string>("status", "status")!;

const settings = definePluginSettings({
    notifyOnce: {
        type: OptionType.BOOLEAN,
        description: "Remove someone from \"Notify me when online\" after their first notification",
        default: true,
    },
    checkForUpdates: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a new version of Friends in Voice is released",
        default: true,
    },
    watchlist: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    notifyOnline: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    blacklist: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
});

// ---------- lists ----------

type ListKey = "watchlist" | "notifyOnline" | "blacklist";

function inList(key: ListKey, id: string) {
    return settings.store[key].includes(id);
}

function toggleInList(key: ListKey, id: string) {
    const list = settings.store[key];
    settings.store[key] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    if (key !== "watchlist") lastStatus.set(id, PresenceStore.getStatus(id));
}

// ---------- online notifications ----------

const lastStatus = new Map<string, string>();
let quietUntil = 0;

const isOnline = (status?: string) => !!status && status !== "offline" && status !== "invisible";

function seedStatuses() {
    lastStatus.clear();
    for (const id of [...settings.store.notifyOnline, ...settings.store.blacklist]) {
        lastStatus.set(id, PresenceStore.getStatus(id));
    }
}

function nameOf(id: string) {
    const user = UserStore.getUser(id);
    return { user, name: user ? displayName(user, null) : "Someone" };
}

function notifyCameOnline(id: string) {
    const { user, name } = nameOf(id);
    showNotification({
        title: `${name} is online`,
        body: "Click to open your DM with them.",
        icon: user?.getAvatarURL(undefined, 128),
        onClick: () => {
            setPageOpen(false);
            openPrivateChannel(id);
        },
    });

    if (settings.store.notifyOnce) {
        settings.store.notifyOnline = settings.store.notifyOnline.filter(x => x !== id);
    }
}

function notifyBlacklisted(id: string) {
    const { user, name } = nameOf(id);
    showNotification({
        title: `🚫 ${name} is online`,
        body: "They're on your blacklist. Click to go invisible.",
        icon: user?.getAvatarURL(undefined, 128),
        onClick: async () => {
            await StatusSettings.updateSetting("invisible");
            showToast("Your status is now Invisible", "success");
        },
    });
}

function onPresenceChange() {
    const { notifyOnline, blacklist } = settings.store;
    if (!notifyOnline.length && !blacklist.length) return;

    for (const id of new Set([...notifyOnline, ...blacklist])) {
        const status = PresenceStore.getStatus(id);
        const prev = lastStatus.get(id);
        lastStatus.set(id, status);

        // presences arrive in bulk after (re)connecting, so don't treat those as "came online"
        if (Date.now() < quietUntil || prev === undefined) continue;
        if (isOnline(prev) || !isOnline(status)) continue;

        if (blacklist.includes(id)) notifyBlacklisted(id);
        if (notifyOnline.includes(id)) notifyCameOnline(id);
    }
}

// ---------- update check ----------

let notifiedVersion: string | null = null;
let updateTimer: ReturnType<typeof setInterval> | undefined;

function isNewer(a: string, b: string) {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
}

async function checkForUpdate(manual = false) {
    if (!manual && !settings.store.checkForUpdates) return;

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
            headers: { Accept: "application/vnd.github+json" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { tag_name, html_url } = await res.json();
        const latest = String(tag_name).replace(/^v/, "");

        if (!isNewer(latest, VERSION)) {
            if (manual) showToast(`Friends in Voice is up to date (v${VERSION})`, "success");
            return;
        }
        if (!manual && notifiedVersion === latest) return;
        notifiedVersion = latest;

        showNotification({
            title: `Friends in Voice v${latest} is out`,
            body: `You have v${VERSION}. Click to open the download page, then run install.bat from the new zip.`,
            permanent: true,
            onClick: () => VencordNative.native.openExternal(html_url),
        });
    } catch {
        if (manual) showToast("Couldn't check for updates", "failure");
    }
}

// ---------- page open state ----------

let pageOpen = false;
const pageListeners = new Set<() => void>();

function setPageOpen(open: boolean) {
    pageOpen = open;
    pageListeners.forEach(fn => fn());
}

function usePageOpen() {
    const [, force] = useReducer(x => x + 1, 0);
    useEffect(() => {
        pageListeners.add(force);
        return () => void pageListeners.delete(force);
    }, []);
    return pageOpen;
}

// ---------- data ----------

interface Member {
    user: User;
    name: string;
    isFriend: boolean;
    isWatched: boolean;
    isMe: boolean;
    showsOffline: boolean;
    muted: boolean;
    deafened: boolean;
    streaming: boolean;
}

interface Room {
    channel: Channel;
    place: string;
    roomName: string;
    icon: string | null;
    members: Member[];
    reasons: Member[];
    hasFriend: boolean;
}

function displayName(user: User, guildId: string | null) {
    return RelationshipStore.getNickname(user.id)
        ?? (guildId && GuildMemberStore.getNick(guildId, user.id))
        ?? (user as any).globalName
        ?? user.username;
}

function describeChannel(channel: Channel) {
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    if (guild) {
        return {
            place: guild.name,
            roomName: channel.name,
            icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64` : null
        };
    }

    if (channel.isDM()) {
        const other = UserStore.getUser(channel.recipients?.[0]);
        return { place: "Direct call", roomName: other ? displayName(other, null) : "DM", icon: null };
    }

    return { place: "Group call", roomName: channel.name || "Group DM", icon: null };
}

function buildRoom(channel: Channel, states: any[], friendIds: Set<string>, watched: Set<string>, myId?: string): Room {
    const members: Member[] = [];
    for (const s of states) {
        const user = UserStore.getUser(s.userId);
        if (!user) continue;

        const isMe = user.id === myId;
        members.push({
            user,
            name: displayName(user, channel.guild_id ?? null),
            isFriend: friendIds.has(user.id),
            isWatched: watched.has(user.id),
            isMe,
            // Discord only reliably sends presence for friends, so only flag those
            showsOffline: !isMe && friendIds.has(user.id) && !isOnline(PresenceStore.getStatus(user.id)),
            muted: !!(s.mute || s.selfMute),
            deafened: !!(s.deaf || s.selfDeaf),
            streaming: !!s.selfStream
        });
    }

    const rank = (m: Member) => (m.isWatched ? 2 : 0) + (m.isFriend ? 1 : 0);
    members.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));

    const reasons = members.filter(m => !m.isMe && (m.isFriend || m.isWatched));
    return {
        channel,
        ...describeChannel(channel),
        members,
        reasons,
        hasFriend: reasons.some(m => m.isFriend)
    };
}

function collect(watchlist: string[]) {
    const friendIds = new Set(RelationshipStore.getFriendIDs());
    const watched = new Set(watchlist);
    const myId = UserStore.getCurrentUser()?.id;

    const statesByChannel = new Map<string, any[]>();
    for (const states of Object.values(VoiceStateStore.getAllVoiceStates() ?? {})) {
        for (const state of Object.values(states ?? {}) as any[]) {
            if (!state?.channelId) continue;
            const list = statesByChannel.get(state.channelId) ?? [];
            list.push(state);
            statesByChannel.set(state.channelId, list);
        }
    }

    const allRooms: Room[] = [];
    const roomByUser = new Map<string, Room>();

    for (const [channelId, states] of statesByChannel) {
        if (!states.some(s => s.userId !== myId && (friendIds.has(s.userId) || watched.has(s.userId)))) continue;

        const channel = ChannelStore.getChannel(channelId);
        if (!channel) continue;

        const room = buildRoom(channel, states, friendIds, watched, myId);
        allRooms.push(room);
        for (const m of room.members) roomByUser.set(m.user.id, room);
    }

    // the home page only lists rooms that have at least one friend in them
    const rooms = allRooms
        .filter(r => r.hasFriend)
        .sort((a, b) => b.reasons.length - a.reasons.length || a.place.localeCompare(b.place));

    return { rooms, roomByUser, friendIds };
}

function useVoiceData() {
    const { watchlist } = settings.use(["watchlist"]);
    const voiceVersion = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStateVersion());
    const relVersion = useStateFromStores([RelationshipStore], () => RelationshipStore.getVersion());
    const myChannel = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getVoiceChannelId());
    const data = useMemo(() => collect(watchlist), [voiceVersion, relVersion, watchlist]);
    return { ...data, watchlist, myChannel };
}

function canJoin(channel: Channel) {
    if (!channel.guild_id) return true;
    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel) && PermissionStore.can(PermissionsBits.CONNECT, channel);
}

function joinRoom(channel: Channel) {
    if (!canJoin(channel)) {
        showToast("You don't have permission to join this room", "failure");
        return;
    }
    selectVoiceChannel(channel.id);
}

function openRoomChannel(channel: Channel) {
    setPageOpen(false);
    ChannelRouter.transitionToChannel(channel.id);
}

// ---------- small components ----------

function Avatar({ user, size = 22 }: { user: User; size?: number; }) {
    return <img className={cl("avatar")} style={{ width: size, height: size }} src={user.getAvatarURL(undefined, 64)} alt="" />;
}

function useUser(id: string) {
    const user = useStateFromStores([UserStore], () => UserStore.getUser(id));
    useEffect(() => {
        if (!user) UserUtils.getUser(id).catch(() => { });
    }, [id, user]);
    return user;
}

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline" };

function StatusDot({ id, withLabel }: { id: string; withLabel?: boolean; }) {
    const raw = useStateFromStores([PresenceStore], () => PresenceStore.getStatus(id));
    const status = isOnline(raw) ? raw : "offline";
    return (
        <span className={cl("status-wrap")}>
            <span className={cl("status", `status-${status}`)} title={STATUS_LABEL[status] ?? status} />
            {withLabel && <span className={cl("status-label")}>{STATUS_LABEL[status] ?? status}</span>}
        </span>
    );
}

function StarButton({ userId }: { userId: string; }) {
    settings.use(["watchlist"]);
    const on = inList("watchlist", userId);
    return (
        <span
            className={cl("star", on && "star-on")}
            title={on ? "Remove from My list" : "Add to My list"}
            onClick={e => { e.stopPropagation(); toggleInList("watchlist", userId); }}
        >
            {on ? "★" : "☆"}
        </span>
    );
}

function MemberRow({ member }: { member: Member; }) {
    return (
        <div className={cl("member", (member.isFriend || member.isWatched) && "friend")}>
            <Avatar user={member.user} />
            <span className={cl("member-name")}>
                {member.name}{member.isMe && " (you)"}
            </span>
            {member.isWatched && <span className={cl("pill", "pill-watch")}>MY LIST</span>}
            {member.isFriend && <span className={cl("pill", "pill-friend")}>FRIEND</span>}
            {member.showsOffline && <span className={cl("pill", "pill-offline")} title="Their status shows offline, but they're in this room">SHOWS OFFLINE</span>}
            {member.streaming && <span className={cl("pill", "pill-live")}>LIVE</span>}
            {member.deafened ? <span className={cl("tag")} title="Deafened">🔇</span>
                : member.muted && <span className={cl("tag")} title="Muted">🎙️✕</span>}
            {!member.isMe && <StarButton userId={member.user.id} />}
        </div>
    );
}

function JoinButton({ channel, inThisRoom }: { channel: Channel; inThisRoom: boolean; }) {
    const joinable = canJoin(channel);
    return (
        <Button
            size="small"
            variant={inThisRoom ? "secondary" : "primary"}
            disabled={inThisRoom || !joinable}
            onClick={() => joinRoom(channel)}
        >
            {inThisRoom ? "Joined" : joinable ? "Join" : "Locked"}
        </Button>
    );
}

function RoomCard({ room, inThisRoom }: { room: Room; inThisRoom: boolean; }) {
    return (
        <div className={cl("card", inThisRoom && "current")}>
            <div className={cl("room-header")}>
                {room.icon
                    ? <img className={cl("guild-icon")} src={room.icon} alt="" />
                    : <div className={cl("guild-icon", "placeholder")}>{room.place[0]}</div>}
                <div className={cl("room-title")} onClick={() => openRoomChannel(room.channel)} title="Open this channel">
                    <div className={cl("place")}>{room.place}</div>
                    <div className={cl("room-name")}>🔊 {room.roomName}</div>
                </div>
                <JoinButton channel={room.channel} inThisRoom={inThisRoom} />
            </div>
            <div className={cl("reason")}>
                <span className={cl("reason-label")}>Here because of:</span>
                {room.reasons.map(m => (
                    <span key={m.user.id} className={cl("chip", !m.isFriend && "chip-watch")}>
                        <Avatar user={m.user} size={18} />
                        {m.name}
                    </span>
                ))}
            </div>
            <div className={cl("members")}>
                {room.members.map(m => <MemberRow key={m.user.id} member={m} />)}
            </div>
        </div>
    );
}

function AddPeople({ listKey, friendIds, placeholder }: { listKey: ListKey; friendIds: Set<string>; placeholder: string; }) {
    const list = settings.use([listKey])[listKey];
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();

    const results = useMemo(() => {
        if (!q) return [];
        return [...friendIds]
            .filter(id => !list.includes(id))
            .map(id => UserStore.getUser(id))
            .filter((u): u is User => u != null)
            .filter(u => displayName(u, null).toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
            .slice(0, 8);
    }, [q, list, friendIds]);

    return (
        <div className={cl("add")}>
            <input
                className={cl("search")}
                placeholder={placeholder}
                value={query}
                onChange={e => setQuery(e.currentTarget.value)}
            />
            {results.length > 0 && (
                <div className={cl("results")}>
                    {results.map(u => (
                        <div key={u.id} className={cl("result")} onClick={() => { toggleInList(listKey, u.id); setQuery(""); }}>
                            <Avatar user={u} size={24} />
                            <span className={cl("member-name")}>{displayName(u, null)}</span>
                            <span className={cl("result-user")}>@{u.username}</span>
                            <StatusDot id={u.id} />
                            <span className={cl("result-add")}>Add</span>
                        </div>
                    ))}
                </div>
            )}
            {q && results.length === 0 && <div className={cl("muted", "results-empty")}>No friends match “{query}”.</div>}
        </div>
    );
}

// ---------- tabs ----------

function VoiceTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
    const { rooms, myChannel } = data;
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();

    const filtered = q
        ? rooms.filter(r =>
            r.place.toLowerCase().includes(q)
            || r.roomName.toLowerCase().includes(q)
            || r.members.some(m => m.name.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q)))
        : rooms;

    return (
        <>
            <input
                className={cl("search")}
                placeholder="Search people, servers or rooms…"
                value={query}
                onChange={e => setQuery(e.currentTarget.value)}
            />
            {filtered.length === 0 && (
                <div className={cl("empty")}>
                    {q ? "Nothing matches your search." : "None of your friends are in a voice room right now."}
                </div>
            )}
            <div className={cl("grid")}>
                {filtered.map(room => <RoomCard key={room.channel.id} room={room} inThisRoom={room.channel.id === myChannel} />)}
            </div>
        </>
    );
}

function WatchedCard({ id, room, myChannel }: { id: string; room?: Room; myChannel?: string | null; }) {
    const user = useUser(id);
    const name = user ? displayName(user, room?.channel.guild_id ?? null) : "Loading…";
    const others = room?.members.filter(m => m.user.id !== id) ?? [];
    const inThisRoom = !!room && room.channel.id === myChannel;

    return (
        <div className={cl("card", room && "card-active", inThisRoom && "current")}>
            <div className={cl("person")}>
                {user ? <Avatar user={user} size={40} /> : <div className={cl("avatar", "placeholder")} style={{ width: 40, height: 40 }} />}
                <div className={cl("person-info")}>
                    <div className={cl("person-name")}>{name} <StatusDot id={id} withLabel /></div>
                    {room
                        ? <div className={cl("person-where")} onClick={() => openRoomChannel(room.channel)}>
                            🔊 <b>{room.roomName}</b> · {room.place}
                        </div>
                        : <div className={cl("person-where", "muted")}>Not in a voice room you can see</div>}
                </div>
                {room && <JoinButton channel={room.channel} inThisRoom={inThisRoom} />}
                <StarButton userId={id} />
            </div>
            {room && others.length > 0 && (
                <div className={cl("with")}>
                    <div className={cl("with-label")}>With {others.length} other{others.length === 1 ? "" : "s"}:</div>
                    <div className={cl("members")}>
                        {others.map(m => <MemberRow key={m.user.id} member={m} />)}
                    </div>
                </div>
            )}
        </div>
    );
}

function MyListTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
    const { watchlist, roomByUser, friendIds, myChannel } = data;
    const sorted = [...watchlist].sort((a, b) => Number(roomByUser.has(b)) - Number(roomByUser.has(a)));

    return (
        <>
            <AddPeople listKey="watchlist" friendIds={friendIds} placeholder="➕ Add a friend to My list — type a name…" />
            {watchlist.length === 0 && (
                <div className={cl("empty")}>
                    Your list is empty.<br />
                    Add people with the box above, the ☆ next to anyone in “In voice”, or right-click a user → <b>Add to My list</b>.
                </div>
            )}
            <div className={cl("grid")}>
                {sorted.map(id => <WatchedCard key={id} id={id} room={roomByUser.get(id)} myChannel={myChannel} />)}
            </div>
        </>
    );
}

function AlertPerson({ id, listKey }: { id: string; listKey: ListKey; }) {
    const user = useUser(id);
    return (
        <div className={cl("alert-person")}>
            {user ? <Avatar user={user} size={28} /> : <div className={cl("avatar", "placeholder")} style={{ width: 28, height: 28 }} />}
            <span className={cl("member-name")}>{user ? displayName(user, null) : "Loading…"}</span>
            <StatusDot id={id} withLabel />
            <span className={cl("remove")} title="Remove" onClick={() => toggleInList(listKey, id)}>✕</span>
        </div>
    );
}

function AlertSection({ listKey, title, description, friendIds }: { listKey: ListKey; title: string; description: string; friendIds: Set<string>; }) {
    const list = settings.use([listKey])[listKey];
    return (
        <div className={cl("section")}>
            <div className={cl("section-title")}>{title} <span className={cl("count")}>{list.length}</span></div>
            <div className={cl("section-desc")}>{description}</div>
            <AddPeople listKey={listKey} friendIds={friendIds} placeholder="➕ Add a friend — type a name…" />
            {list.length === 0
                ? <div className={cl("muted", "section-empty")}>Nobody here yet. You can also right-click any user to add them.</div>
                : <div className={cl("alert-list")}>{list.map(id => <AlertPerson key={id} id={id} listKey={listKey} />)}</div>}
        </div>
    );
}

function AlertsTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
    const { notifyOnce } = settings.use(["notifyOnce"]);
    return (
        <div className={cl("sections")}>
            <AlertSection
                listKey="notifyOnline"
                title="🔔 Notify me when online"
                description={notifyOnce
                    ? "You get a notification the next time each of them comes online — click it to open your DM. They're removed from this list afterwards (change this in the plugin settings)."
                    : "You get a notification every time one of them comes online — click it to open your DM."}
                friendIds={data.friendIds}
            />
            <AlertSection
                listKey="blacklist"
                title="🚫 Blacklist"
                description="You get a notification every time one of them comes online — click it to switch your status to Invisible."
                friendIds={data.friendIds}
            />
        </div>
    );
}

// ---------- page ----------

type Tab = "voice" | "mine" | "alerts";

function getNav() {
    return document.querySelector<HTMLElement>(`.${cl("server-button")}`)?.closest("nav") ?? null;
}

function getContentRect() {
    const r = getNav()?.getBoundingClientRect();
    return { left: r?.right ?? 72, top: r?.top ?? 0 };
}

function FriendsInVoicePage() {
    const data = useVoiceData();
    const { notifyOnline, blacklist } = settings.use(["notifyOnline", "blacklist"]);
    const [tab, setTab] = useState<Tab>("voice");
    const [rect, setRect] = useState(getContentRect);

    const guildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const [initialNav] = useState(() => `${guildId}/${channelId}`);

    // close when the user navigates somewhere else
    useEffect(() => {
        if (`${guildId}/${channelId}` !== initialNav) setPageOpen(false);
    }, [guildId, channelId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPageOpen(false); };
        const onResize = () => setRect(getContentRect());

        // any click in the server list (Discord logo, a server, …) closes the page, even if the route doesn't change
        const nav = getNav();
        const onNavClick = (e: MouseEvent) => {
            if (!(e.target as Element | null)?.closest(`.${cl("server-button")}`)) setPageOpen(false);
        };

        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", onResize);
        nav?.addEventListener("click", onNavClick, true);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onResize);
            nav?.removeEventListener("click", onNavClick, true);
        };
    }, []);

    const friendsInVoice = new Set(data.rooms.flatMap(r => r.members.filter(m => m.isFriend && !m.isMe).map(m => m.user.id))).size;
    const watchedInVoice = data.watchlist.filter(id => data.roomByUser.has(id)).length;

    return (
        <div className={cl("page")} style={{ left: rect.left, top: rect.top }}>
            <div className={cl("page-header")}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d={HEADSET_PATH} /></svg>
                <div className={cl("page-title")}>Friends in Voice</div>
                <div className={cl("tabs")}>
                    <div className={cl("tab", tab === "voice" && "tab-active")} onClick={() => setTab("voice")}>
                        🔊 In voice <span className={cl("count")}>{data.rooms.length}</span>
                    </div>
                    <div className={cl("tab", tab === "mine" && "tab-active")} onClick={() => setTab("mine")}>
                        ⭐ My list <span className={cl("count")}>{watchedInVoice}/{data.watchlist.length}</span>
                    </div>
                    <div className={cl("tab", tab === "alerts" && "tab-active")} onClick={() => setTab("alerts")}>
                        🔔 Alerts <span className={cl("count")}>{notifyOnline.length + blacklist.length}</span>
                    </div>
                </div>
                <div className={cl("page-sub")}>{friendsInVoice} friend{friendsInVoice === 1 ? "" : "s"} in voice</div>
                <div className={cl("close")} onClick={() => setPageOpen(false)} title="Close (Esc)">✕</div>
            </div>
            <div className={cl("page-body")}>
                {tab === "voice" && <VoiceTab data={data} />}
                {tab === "mine" && <MyListTab data={data} />}
                {tab === "alerts" && <AlertsTab data={data} />}
                <div className={cl("note")}>
                    Discord only shares voice activity and online status for servers you're also in, so people in servers you haven't joined won't show up.
                    {" · "}v{VERSION}{" · "}
                    <span className={cl("link")} onClick={() => checkForUpdate(true)}>Check for updates</span>
                </div>
            </div>
        </div>
    );
}

// ---------- server list button ----------

const HEADSET_PATH = "M12 2a10 10 0 0 0-10 10v5a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H4.06A8 8 0 0 1 19.94 12H18a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-5A10 10 0 0 0 12 2Z";

function ServerListButton() {
    const open = usePageOpen();

    const count = useStateFromStores([VoiceStateStore, RelationshipStore], () => {
        let n = 0;
        for (const id of RelationshipStore.getFriendIDs()) {
            if (VoiceStateStore.getVoiceStateForUser(id)?.channelId) n++;
        }
        return n;
    });

    return (
        <>
            <Tooltip text={`Friends in Voice — ${count} friend${count === 1 ? "" : "s"} in voice`} position="right">
                {props => (
                    <div
                        {...props}
                        className={cl("server-button", open && "server-button-open")}
                        onClick={() => setPageOpen(!pageOpen)}
                        role="button"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d={HEADSET_PATH} /></svg>
                        {count > 0 && <span className={cl("badge")}>{count}</span>}
                    </div>
                )}
            </Tooltip>
            {open && ReactDOM.createPortal(
                <ErrorBoundary><FriendsInVoicePage /></ErrorBoundary>,
                document.body
            )}
        </>
    );
}

// ---------- context menu ----------

const UserContextPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;

    const watched = inList("watchlist", user.id);
    const notify = inList("notifyOnline", user.id);
    const blocked = inList("blacklist", user.id);

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-fiv-watch"
                label={watched ? "Remove from My list" : "Add to My list"}
                action={() => toggleInList("watchlist", user.id)}
            />
            <Menu.MenuItem
                id="vc-fiv-notify"
                label={notify ? "Stop notifying me when online" : "Notify me when online"}
                action={() => toggleInList("notifyOnline", user.id)}
            />
            <Menu.MenuItem
                id="vc-fiv-blacklist"
                label={blocked ? "Remove from blacklist" : "Add to blacklist"}
                color={blocked ? undefined : "danger"}
                action={() => toggleInList("blacklist", user.id)}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "FriendsInVoice",
    description: "A page showing which voice rooms your friends are in and one-click join, plus My list, online alerts and a blacklist",
    authors: [{ name: "mPhpMaster", id: 0n }],
    dependencies: ["ServerListAPI", "UserSettingsAPI"],
    settings,

    contextMenus: {
        "user-context": UserContextPatch,
    },

    flux: {
        CONNECTION_OPEN() {
            quietUntil = Date.now() + 15_000;
        },
    },

    renderButton: ErrorBoundary.wrap(ServerListButton, { noop: true }),

    start() {
        quietUntil = Date.now() + 15_000;
        seedStatuses();
        PresenceStore.addChangeListener(onPresenceChange);

        addServerListElement(ServerListRenderPosition.Above, this.renderButton);

        setTimeout(() => checkForUpdate(), 10_000);
        updateTimer = setInterval(() => checkForUpdate(), 6 * 60 * 60 * 1000);
    },

    stop() {
        setPageOpen(false);
        PresenceStore.removeChangeListener(onPresenceChange);
        clearInterval(updateTimer);
        removeServerListElement(ServerListRenderPosition.Above, this.renderButton);
    },
});
