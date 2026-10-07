/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelRouter, ChannelStore, GuildMemberStore, GuildStore, Menu, PermissionsBits, PermissionStore, React, ReactDOM, RelationshipStore, SelectedChannelStore, SelectedGuildStore, showToast, Tooltip, useEffect, useMemo, useReducer, UserStore, UserUtils, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

const cl = classNameFactory("vc-fiv-");

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

const settings = definePluginSettings({
    watchlist: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
});

// ---------- watchlist ----------

function isWatched(id: string) {
    return settings.store.watchlist.includes(id);
}

function toggleWatched(id: string) {
    const list = settings.store.watchlist;
    settings.store.watchlist = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
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
    hasWatched: boolean;
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

        members.push({
            user,
            name: displayName(user, channel.guild_id ?? null),
            isFriend: friendIds.has(user.id),
            isWatched: watched.has(user.id),
            isMe: user.id === myId,
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
        hasWatched: reasons.some(m => m.isWatched)
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

    const rooms: Room[] = [];
    const roomByUser = new Map<string, Room>();

    for (const [channelId, states] of statesByChannel) {
        if (!states.some(s => s.userId !== myId && (friendIds.has(s.userId) || watched.has(s.userId)))) continue;

        const channel = ChannelStore.getChannel(channelId);
        if (!channel) continue;

        const room = buildRoom(channel, states, friendIds, watched, myId);
        rooms.push(room);
        for (const m of room.members) roomByUser.set(m.user.id, room);
    }

    rooms.sort((a, b) =>
        Number(b.hasWatched) - Number(a.hasWatched)
        || b.reasons.length - a.reasons.length
        || a.place.localeCompare(b.place));

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

function StarButton({ userId }: { userId: string; }) {
    settings.use(["watchlist"]);
    const on = isWatched(userId);
    return (
        <span
            className={cl("star", on && "star-on")}
            title={on ? "Remove from My list" : "Add to My list"}
            onClick={e => { e.stopPropagation(); toggleWatched(userId); }}
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

function RoomHeader({ room, inThisRoom }: { room: Room; inThisRoom: boolean; }) {
    return (
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
    );
}

function RoomCard({ room, inThisRoom }: { room: Room; inThisRoom: boolean; }) {
    return (
        <div className={cl("card", inThisRoom && "current")}>
            <RoomHeader room={room} inThisRoom={inThisRoom} />
            <div className={cl("reason")}>
                <span className={cl("reason-label")}>Here because of:</span>
                {room.reasons.map(m => (
                    <span key={m.user.id} className={cl("chip", m.isWatched && "chip-watch")}>
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

// ---------- tabs ----------

function useUser(id: string) {
    const user = useStateFromStores([UserStore], () => UserStore.getUser(id));
    useEffect(() => {
        if (!user) UserUtils.getUser(id).catch(() => { });
    }, [id, user]);
    return user;
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
                    <div className={cl("person-name")}>{name}</div>
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

function AddPeople({ watchlist, friendIds }: { watchlist: string[]; friendIds: Set<string>; }) {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();

    const results = useMemo(() => {
        if (!q) return [];
        return [...friendIds]
            .filter(id => !watchlist.includes(id))
            .map(id => UserStore.getUser(id))
            .filter((u): u is User => u != null)
            .filter(u => displayName(u, null).toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
            .slice(0, 8);
    }, [q, watchlist, friendIds]);

    return (
        <div className={cl("add")}>
            <input
                className={cl("search")}
                placeholder="➕ Add a friend to My list — type a name…"
                value={query}
                onChange={e => setQuery(e.currentTarget.value)}
            />
            {results.length > 0 && (
                <div className={cl("results")}>
                    {results.map(u => (
                        <div key={u.id} className={cl("result")} onClick={() => { toggleWatched(u.id); setQuery(""); }}>
                            <Avatar user={u} size={24} />
                            <span className={cl("member-name")}>{displayName(u, null)}</span>
                            <span className={cl("result-user")}>@{u.username}</span>
                            <span className={cl("result-add")}>Add</span>
                        </div>
                    ))}
                </div>
            )}
            {q && results.length === 0 && <div className={cl("muted", "results-empty")}>No friends match “{query}”.</div>}
        </div>
    );
}

function MyListTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
    const { watchlist, roomByUser, friendIds, myChannel } = data;

    const sorted = [...watchlist].sort((a, b) => Number(roomByUser.has(b)) - Number(roomByUser.has(a)));

    return (
        <>
            <AddPeople watchlist={watchlist} friendIds={friendIds} />
            {watchlist.length === 0 && (
                <div className={cl("empty")}>
                    Your list is empty.<br />
                    Add people with the box above, the ☆ next to anyone in “All rooms”, or right-click a user → <b>Add to My list</b>.
                </div>
            )}
            <div className={cl("grid")}>
                {sorted.map(id => <WatchedCard key={id} id={id} room={roomByUser.get(id)} myChannel={myChannel} />)}
            </div>
        </>
    );
}

function AllRoomsTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
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

// ---------- page ----------

type Tab = "mine" | "all";

function getContentRect() {
    const nav = document.querySelector<HTMLElement>(`.${cl("server-button")}`)?.closest("nav");
    const r = nav?.getBoundingClientRect();
    return { left: r?.right ?? 72, top: r?.top ?? 0 };
}

function FriendsInVoicePage() {
    const data = useVoiceData();
    const [tab, setTab] = useState<Tab>(() => settings.store.watchlist.length ? "mine" : "all");
    const [rect, setRect] = useState(getContentRect);

    const guildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const [initialNav] = useState(() => `${guildId}/${channelId}`);

    // close when the user navigates somewhere else (e.g. clicks a server)
    useEffect(() => {
        if (`${guildId}/${channelId}` !== initialNav) setPageOpen(false);
    }, [guildId, channelId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPageOpen(false); };
        const onResize = () => setRect(getContentRect());
        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onResize);
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
                    <div className={cl("tab", tab === "mine" && "tab-active")} onClick={() => setTab("mine")}>
                        ⭐ My list <span className={cl("count")}>{watchedInVoice}/{data.watchlist.length}</span>
                    </div>
                    <div className={cl("tab", tab === "all" && "tab-active")} onClick={() => setTab("all")}>
                        All rooms <span className={cl("count")}>{data.rooms.length}</span>
                    </div>
                </div>
                <div className={cl("page-sub")}>{friendsInVoice} friend{friendsInVoice === 1 ? "" : "s"} in voice</div>
                <div className={cl("close")} onClick={() => setPageOpen(false)} title="Close (Esc)">✕</div>
            </div>
            <div className={cl("page-body")}>
                {tab === "mine" ? <MyListTab data={data} /> : <AllRoomsTab data={data} />}
                <div className={cl("note")}>
                    Discord only shares voice activity for servers you're also in, so people in servers you haven't joined won't show up.
                </div>
            </div>
        </div>
    );
}

// ---------- server list button ----------

const HEADSET_PATH = "M12 2a10 10 0 0 0-10 10v5a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H4.06A8 8 0 0 1 19.94 12H18a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-5A10 10 0 0 0 12 2Z";

function ServerListButton() {
    const open = usePageOpen();
    const { watchlist } = settings.use(["watchlist"]);

    const count = useStateFromStores([VoiceStateStore, RelationshipStore], () => {
        const ids = watchlist.length ? watchlist : RelationshipStore.getFriendIDs();
        let n = 0;
        for (const id of ids) {
            if (VoiceStateStore.getVoiceStateForUser(id)?.channelId) n++;
        }
        return n;
    }, [watchlist]);

    const label = watchlist.length ? `${count} from My list in voice` : `${count} friends in voice`;

    return (
        <>
            <Tooltip text={`Friends in Voice — ${label}`} position="right">
                {props => (
                    <div
                        {...props}
                        className={cl("server-button", open && "server-button-open")}
                        onClick={() => setPageOpen(!pageOpen)}
                        role="button"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d={HEADSET_PATH} /></svg>
                        {count > 0 && <span className={cl("badge", watchlist.length > 0 && "badge-watch")}>{count}</span>}
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
    const on = isWatched(user.id);

    children.push(
        <Menu.MenuItem
            id="vc-fiv-watch"
            label={on ? "Remove from My list (Friends in Voice)" : "Add to My list (Friends in Voice)"}
            action={() => toggleWatched(user.id)}
        />
    );
};

export default definePlugin({
    name: "FriendsInVoice",
    description: "A page showing which voice rooms your friends (or a list of people you pick) are in, who's with them, and one-click join",
    authors: [{ name: "mPhpMaster", id: 0n }],
    dependencies: ["ServerListAPI"],
    settings,

    contextMenus: {
        "user-context": UserContextPatch,
    },

    renderButton: ErrorBoundary.wrap(ServerListButton, { noop: true }),

    start() {
        addServerListElement(ServerListRenderPosition.Above, this.renderButton);
    },

    stop() {
        setPageOpen(false);
        removeServerListElement(ServerListRenderPosition.Above, this.renderButton);
    },
});
