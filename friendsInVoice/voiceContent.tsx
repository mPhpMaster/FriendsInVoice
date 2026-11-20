/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { canonicalizeMatch } from "@utils/patches";
import { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy, wreq } from "@webpack";
import { ChannelRouter, ChannelStore, ContextMenuApi, GuildMemberStore, GuildStore, Menu, openUserProfileModal, PermissionsBits, PermissionStore, PresenceStore, React, RelationshipStore, SelectedChannelStore, showToast, useEffect, useMemo, useReducer, UserStore, UserUtils, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { inList, isOnline, openPrivateChannel,setPageOpen, settings, toggleInList } from ".";
import { namesLoaded, rememberUser, savedName, savedUser, subscribeNames } from "./nameCache";
const cl = classNameFactory("vc-fiv-");
const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");
export type ListKey = "watchlist" | "notifyOnline" | "blacklist" | "notifyVoice" | "hidden";// ---------- data ----------

export interface Member {
    user: User;
    name: string;
    isFriend: boolean;
    isWatched: boolean;
    isMe: boolean;
    /** on your Hidden list: still listed, but tagged and never a reason for the room */
    isHidden: boolean;
    muted: boolean;
    deafened: boolean;
    streaming: boolean;
}

export interface Room {
    channel: Channel;
    place: string;
    roomName: string;
    icon: string | null;
    members: Member[];
    reasons: Member[];
    hasFriend: boolean;
}

export function displayName(user: User, guildId: string | null) {
    return RelationshipStore.getNickname(user.id)
        ?? (guildId && GuildMemberStore.getNick(guildId, user.id))
        ?? (user as any).globalName
        ?? user.username;
}

// Discord sends channels you can't view with the name "___hidden___" and the CHANNEL_OBFUSCATED flag:
// https://docs.discord.com/developers/change-log (August 12, 2026)
const CHANNEL_OBFUSCATED = 1 << 17;
function isObfuscated(channel: Channel) {
    return channel.name === "___hidden___" || ((channel as any).flags & CHANNEL_OBFUSCATED) !== 0;
}

/** Server voice rooms you can't see (no View Channel) are left out everywhere: lists, the Log and alerts. */
export function canSeeChannel(channel: Channel | null | undefined): channel is Channel {
    if (!channel) return false;
    if (!channel.guild_id) return true;
    return !isObfuscated(channel) && PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel);
}

/** the voice room someone is in, or null when they aren't in one you can see */
export function visibleVoiceChannelId(userId: string): string | null {
    const id = VoiceStateStore.getVoiceStateForUser(userId)?.channelId;
    return id && canSeeChannel(ChannelStore.getChannel(id)) ? id : null;
}

export function describeChannel(channel: Channel) {
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    if (guild) {
        return {
            place: guild.name,
            roomName: canSeeChannel(channel) ? channel.name : "Private channel",
            icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64` : null
        };
    }

    if (channel.isDM()) {
        const other = UserStore.getUser(channel.recipients?.[0]);
        return { place: "Direct call", roomName: other ? displayName(other, null) : "DM", icon: null };
    }

    return { place: "Group call", roomName: channel.name || "Group DM", icon: null };
}

function buildRoom(channel: Channel, states: any[], friendIds: Set<string>, watched: Set<string>, hidden: Set<string>, myId?: string): Room {
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
            isHidden: !isMe && hidden.has(user.id),
            muted: !!(s.mute || s.selfMute),
            deafened: !!(s.deaf || s.selfDeaf),
            streaming: !!s.selfStream
        });
    }

    const rank = (m: Member) => (m.isWatched ? 2 : 0) + (m.isFriend ? 1 : 0);
    members.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));

    const reasons = members.filter(m => !m.isMe && !m.isHidden && (m.isFriend || m.isWatched));
    return {
        channel,
        ...describeChannel(channel),
        members,
        reasons,
        hasFriend: reasons.some(m => m.isFriend)
    };
}

function collect(watchlist: string[], hiddenList: string[], extra: string | null) {
    const friendIds = new Set(RelationshipStore.getFriendIDs());
    const watched = new Set(watchlist);
    const hidden = new Set(hiddenList);
    const myId = UserStore.getCurrentUser()?.id;
    // hidden people don't bring a room into the list; the person the page was opened for always does
    const tracked = (id: string) => id === extra || (!hidden.has(id) && (friendIds.has(id) || watched.has(id)));

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
        if (!states.some(s => s.userId !== myId && tracked(s.userId))) continue;

        const channel = ChannelStore.getChannel(channelId);
        if (!canSeeChannel(channel)) continue;

        const room = buildRoom(channel, states, friendIds, watched, hidden, myId);
        allRooms.push(room);
        // hidden people too, so My list and "Where they are now" still find them
        for (const s of states) roomByUser.set(s.userId, room);
    }

    // the home page only lists rooms that have at least one friend in them
    const rooms = allRooms
        .filter(r => r.hasFriend)
        .sort((a, b) => b.reasons.length - a.reasons.length || a.place.localeCompare(b.place));

    return { rooms, roomByUser, friendIds };
}

export function useVoiceData(extra: string | null = null) {
    const { watchlist, hidden } = settings.use(["watchlist", "hidden"]);
    const voiceVersion = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStateVersion());
    const relVersion = useStateFromStores([RelationshipStore], () => RelationshipStore.getVersion());
    const myChannel = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getVoiceChannelId());
    const data = useMemo(() => collect(watchlist, hidden, extra), [voiceVersion, relVersion, watchlist, hidden, extra]);
    return { ...data, watchlist, myChannel };
}

function canJoin(channel: Channel) {
    if (!channel.guild_id) return true;
    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel) && PermissionStore.can(PermissionsBits.CONNECT, channel);
}

// a room at its user limit can only be joined with Move Members:
// https://docs.discord.com/developers/topics/voice-connections
function isFull(channel: Channel) {
    const limit = channel.userLimit ?? 0;
    if (!limit || PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) return false;
    return Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id) ?? {}).length >= limit;
}

export function joinRoom(channel: Channel) {
    if (!canJoin(channel)) {
        showToast({ text: "You don't have permission to join this room", variant: "critical" });
        return;
    }
    if (isFull(channel)) {
        showToast({ text: "This room is full", variant: "critical" });
        return;
    }
    selectVoiceChannel(channel.id);
}

export function openRoomChannel(channel: Channel) {
    setPageOpen(false);
    ChannelRouter.transitionToChannel(channel.id);
}

// ---------- small components ----------

// ---------- clicking people: left = DM, right = Discord's user menu ----------

// Discord lazy-loads its generic user context menu. Find the loader by the analytics name next to it
// (stable across builds, unlike module ids), load its chunks, and use the menu component directly.
const UserMenuLoaderRe = canonicalizeMatch(/Promise\.all\(\[((?:\i\.e\("?\w+"?\),?)+)\]\)\.then\(\i\.bind\(\i,"?(\w+)"?\)\);return \i=>\(0,\i\.jsx\)\(\i,\{\.\.\.\i,user:\i,[^}]{0,80}?\("UserGenericContextMenu"/);

let DiscordUserMenu: React.ComponentType<any> | null = null;

async function loadDiscordUserMenu() {
    if (DiscordUserMenu) return DiscordUserMenu;

    for (const factory of Object.values(wreq.m)) {
        const code = String(factory);
        if (!code.includes('"UserGenericContextMenu"')) continue;

        const match = code.match(UserMenuLoaderRe);
        if (!match) continue;

        await Promise.all(Array.from(match[1].matchAll(/\.e\("?(\w+)"?\)/g), c => wreq.e(c[1] as any)));
        const menu = (wreq(match[2] as any) as any)?.default;
        if (menu) return (DiscordUserMenu = menu);
    }

    throw new Error("Couldn't find Discord's user context menu");
}

// used if Discord's own menu can't be found (e.g. after a big Discord update)
function FallbackUserMenu({ user, onClose }: { user: User; onClose?(): void; }) {
    const extraProps = { contextMenuAPIArguments: [{ user }] } as any; // lets Vencord plugins (incl. this one) add their items
    return (
        <Menu.Menu navId="user-context" onClose={onClose ?? ContextMenuApi.closeContextMenu} {...extraProps}>
            <Menu.MenuItem id="vc-fiv-profile" label="Profile" action={() => openUserProfileModal({ userId: user.id })} />
            <Menu.MenuItem id="vc-fiv-message" label="Message" action={() => openDm(user.id)} />
            <Menu.MenuItem id="vc-fiv-copy-id" label="Copy User ID" action={() => copyToClipboard(user.id)} />
        </Menu.Menu>
    );
}

function openUserMenu(event: React.MouseEvent, user: User) {
    event.preventDefault();
    event.stopPropagation();

    ContextMenuApi.openContextMenuLazy(event, async () => {
        try {
            const UserMenu = await loadDiscordUserMenu();
            return (props: any) => <UserMenu {...props} user={user} />;
        } catch {
            return (props: any) => <FallbackUserMenu {...props} user={user} />;
        }
    });
}

function openDm(id: string) {
    setPageOpen(false);
    openPrivateChannel(id);
}

/** Props that make an element open a DM on click and Discord's user menu on right-click */
export function personProps(user: User | null | undefined) {
    if (!user) return {};
    return {
        role: "button",
        title: "Click to message · Right-click for options",
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); openDm(user.id); },
        onContextMenu: (e: React.MouseEvent) => openUserMenu(e, user),
    };
}

export function Avatar({ user, size = 22 }: { user: User; size?: number; }) {
    return <img className={cl("avatar")} style={{ width: size, height: size }} src={user.getAvatarURL(undefined, 64)} alt="" />;
}

// People Discord hasn't loaded: their saved name is used. Someone never seen before is fetched once (then saved),
// one at a time with a pause in between, at most 20 per session. Right-click → Refresh name fetches it again.
const MAX_PROFILE_FETCHES = 20;
const PROFILE_FETCH_GAP = 1500;
const requestedUsers = new Set<string>();
const profileQueue: string[] = [];
let profileTimer: ReturnType<typeof setTimeout> | undefined;

function fetchNextProfile() {
    profileTimer = undefined;
    const id = profileQueue.shift();
    if (!id) return;
    if (!UserStore.getUser(id) && !savedName(id)) UserUtils.getUser(id).then(rememberUser, () => { });
    if (profileQueue.length) profileTimer = setTimeout(fetchNextProfile, PROFILE_FETCH_GAP);
}

function queueProfile(id: string) {
    if (requestedUsers.has(id) || requestedUsers.size >= MAX_PROFILE_FETCHES) return;
    requestedUsers.add(id);
    profileQueue.push(id);
    if (!profileTimer) profileTimer = setTimeout(fetchNextProfile, PROFILE_FETCH_GAP);
}

export function useUser(id: string) {
    const loaded = useStateFromStores([UserStore], () => UserStore.getUser(id));
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => subscribeNames(rerender), []);
    useEffect(() => {
        if (loaded) { rememberUser(loaded); return; }
        // wait until the saved names are read, so nobody is fetched just because the list wasn't loaded yet
        if (!namesLoaded() || savedName(id)) return;
        queueProfile(id);
        // a row that scrolled away before its turn doesn't need the profile anymore
        return () => {
            const index = profileQueue.indexOf(id);
            if (index !== -1) { profileQueue.splice(index, 1); requestedUsers.delete(id); }
        };
    }, [id, loaded, namesLoaded()]);
    return loaded ?? savedUser(id);
}

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline" };

export function StatusDot({ id, withLabel }: { id: string; withLabel?: boolean; }) {
    const raw = useStateFromStores([PresenceStore], () => PresenceStore.getStatus(id));
    const status = isOnline(raw) ? raw : "offline";
    return (
        <span className={cl("status-wrap")}>
            <span className={cl("status", `status-${status}`)} title={STATUS_LABEL[status] ?? status} />
            {withLabel && <span className={cl("status-label")}>{STATUS_LABEL[status] ?? status}</span>}
        </span>
    );
}

export function StarButton({ userId }: { userId: string; }) {
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

export function MemberRow({ member }: { member: Member; }) {
    // read here, not in collect(), so the tag follows status changes while the page is open
    const status = useStateFromStores([PresenceStore], () => PresenceStore.getStatus(member.user.id));
    // Discord only reliably sends presence for friends, so only flag those
    const showsOffline = !member.isMe && member.isFriend && !isOnline(status);
    return (
        <div
            className={cl("member", (member.isFriend || member.isWatched) && "friend", !member.isMe && "clickable")}
            {...(member.isMe ? {} : personProps(member.user))}
        >
            <Avatar user={member.user} />
            <span className={cl("member-name")}>
                {member.name}{member.isMe && " (you)"}
            </span>
            {member.isWatched && <span className={cl("pill", "pill-watch")}>MY LIST</span>}
            {member.isFriend && <span className={cl("pill", "pill-friend")}>FRIEND</span>}
            {member.isHidden && <span className={cl("pill", "pill-hidden")} title="On your Hidden list. Right-click them → Show in In voice to bring them back">HIDDEN</span>}
            {showsOffline && <span className={cl("pill", "pill-offline")} title="Their status shows offline, but they're in this room">SHOWS OFFLINE</span>}
            {member.streaming && <span className={cl("pill", "pill-live")}>LIVE</span>}
            {member.deafened ? <span className={cl("tag")} title="Deafened">🔇</span>
                : member.muted && <span className={cl("tag")} title="Muted">🎙️✕</span>}
            {!member.isMe && <StarButton userId={member.user.id} />}
        </div>
    );
}

export function JoinButton({ channel, inThisRoom }: { channel: Channel; inThisRoom: boolean; }) {
    const joinable = canJoin(channel);
    const full = joinable && isFull(channel);
    return (
        <Button
            size="small"
            variant={inThisRoom ? "secondary" : "primary"}
            disabled={inThisRoom || !joinable || full}
            onClick={() => joinRoom(channel)}
        >
            {inThisRoom ? "Joined" : !joinable ? "Locked" : full ? "Full" : "Join"}
        </Button>
    );
}

export function RoomCard({ room, inThisRoom }: { room: Room; inThisRoom: boolean; }) {
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
                    <span key={m.user.id} className={cl("chip", !m.isFriend && "chip-watch", "clickable")} {...personProps(m.user)}>
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

export function AddPeople({ listKey, friendIds, placeholder }: { listKey: ListKey; friendIds: Set<string>; placeholder: string; }) {
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
                        <div key={u.id} className={cl("result")} onClick={() => { toggleInList(listKey, u.id); setQuery(""); }} onContextMenu={e => openUserMenu(e, u)}>
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
