/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { ChannelStore, ContextMenuApi, GuildStore, Menu, NavigationRouter, React, useEffect, useReducer, useState } from "@webpack/common";

import { setPageOpen, settings } from ".";
import { Avatar, joinRoom, openRoomChannel, personProps, useUser } from "./voiceContent";
import { ACCOUNT_KINDS, clearLog, getLog, LogEntry, LogRoom, MAX_ENTRIES, subscribeLog } from "./voiceLog";

const cl = classNameFactory("vc-fiv-");

type Filter = "friends" | "mylist" | "myroom" | "me" | "account";

const PAGE_SIZE = 50;

const FILTERS: { key: Filter; label: string; }[] = [
    { key: "friends", label: "Friends" },
    { key: "mylist", label: "My list" },
    { key: "myroom", label: "My room" },
    { key: "me", label: "Me" },
    { key: "account", label: "Friends & servers" },
];

export function useLog() {
    const [, force] = useReducer(x => x + 1, 0);
    useEffect(() => subscribeLog(force), []);
    return getLog();
}

// ---------- clicking rooms and servers ----------

// Right-clicking the real item in Discord's sidebar opens Discord's own menu for it, with everything it normally has.
// The sidebar only has the item while it's on screen (a server in a closed folder, or a channel of another server,
// isn't), so fall back to a small menu of our own then.
function openSidebarMenu(listItemId: string, e: React.MouseEvent) {
    const el = document.querySelector(`[data-list-item-id="${listItemId}"]`);
    if (!el) return false;
    const { clientX, clientY, screenX, screenY } = e;
    // after this right-click has finished, so it doesn't close the menu it opens
    setTimeout(() => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX, clientY, screenX, screenY })));
    return true;
}

function openRoomMenu(e: React.MouseEvent, room: LogRoom) {
    e.preventDefault();
    e.stopPropagation();
    if (openSidebarMenu(`channels___${room.id}`, e)) return;

    const channel = ChannelStore.getChannel(room.id);
    const guild = room.guildId ? GuildStore.getGuild(room.guildId) : null;
    const extraProps = { contextMenuAPIArguments: [{ channel, guild }] } as any; // lets Vencord plugins add their items
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu navId="channel-context" onClose={ContextMenuApi.closeContextMenu} {...extraProps}>
            {channel && <Menu.MenuItem id="vc-fiv-join" label="Join Voice" action={() => joinRoom(channel)} />}
            {channel && <Menu.MenuItem id="vc-fiv-open" label="Open Chat" action={() => openRoomChannel(channel)} />}
            {room.guildId && <Menu.MenuItem id="vc-fiv-copy-link" label="Copy Link" action={() => copyToClipboard(`https://discord.com/channels/${room.guildId}/${room.id}`)} />}
            <Menu.MenuItem id="vc-fiv-copy-channel-id" label="Copy Channel ID" action={() => copyToClipboard(room.id)} />
        </Menu.Menu>
    ));
}

function openGuild(guildId: string) {
    setPageOpen(false);
    NavigationRouter.transitionToGuild(guildId);
}

function openGuildMenu(e: React.MouseEvent, guildId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (openSidebarMenu(`guildsnav___${guildId}`, e)) return;

    const guild = GuildStore.getGuild(guildId);
    const extraProps = { contextMenuAPIArguments: [{ guild }] } as any;
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu navId="guild-context" onClose={ContextMenuApi.closeContextMenu} {...extraProps}>
            {guild && <Menu.MenuItem id="vc-fiv-open-guild" label="Open Server" action={() => openGuild(guildId)} />}
            <Menu.MenuItem id="vc-fiv-copy-guild-id" label="Copy Server ID" action={() => copyToClipboard(guildId)} />
        </Menu.Menu>
    ));
}

function RoomLink({ room }: { room: LogRoom; }) {
    const open = () => {
        const channel = ChannelStore.getChannel(room.id);
        if (channel) openRoomChannel(channel);
    };
    return (
        <span className={cl("log-room", "clickable")} title="Click to open · Right-click for options" onClick={open} onContextMenu={e => openRoomMenu(e, room)}>
            🔊 {room.roomName}
        </span>
    );
}

function PlaceLink({ room }: { room: LogRoom; }) {
    if (!room.guildId) return <span className={cl("log-place")}>{room.place}</span>;
    const { guildId } = room;
    return (
        <span className={cl("log-place", "clickable")} title="Click to open the server · Right-click for options" onClick={() => openGuild(guildId)} onContextMenu={e => openGuildMenu(e, guildId)}>
            {room.icon ? <img className={cl("log-guild-icon")} src={room.icon} alt="" /> : null}
            {room.place}
        </span>
    );
}

function Where({ room }: { room: LogRoom; }) {
    return <><RoomLink room={room} /> <span className={cl("muted")}>in</span> <PlaceLink room={room} /></>;
}

// ---------- rows ----------

const KIND_ICON: Record<LogEntry["kind"], string> = {
    join: "➡️", leave: "⬅️", move: "🔀",
    "friend-request": "📨", "friend-added": "🤝", "friend-removed": "💔", "server-removed": "🚪",
};

function formatTime(time: number) {
    const date = new Date(time);
    const clock = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return date.toDateString() === new Date().toDateString() ? clock : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${clock}`;
}

function LogRow({ entry }: { entry: LogEntry; }) {
    const user = useUser(entry.userId);
    const { from, to } = entry;
    const name = entry.isMe ? "You" : entry.userName;

    let what: React.ReactNode;
    if (entry.kind === "friend-request") what = <>sent you a friend request</>;
    else if (entry.kind === "friend-added") what = <>is now your friend</>;
    else if (entry.kind === "friend-removed") what = <span title="Discord doesn't say who removed the friendship, and being blocked looks the same">is no longer your friend <span className={cl("muted")}>(unfriended, blocked, or you removed them)</span></span>;
    else if (entry.kind === "server-removed") what = <>are no longer in <b>{from?.place ?? "a server"}</b> <span className={cl("muted")}>(kicked, banned, or you left)</span></>;
    else if (entry.kind === "join") what = <>joined <Where room={to!} /></>;
    else if (entry.kind === "leave") what = <>left <Where room={from!} /></>;
    else if (from && to && from.guildId === to.guildId) what = <>moved from <RoomLink room={from} /> to <RoomLink room={to} /> <span className={cl("muted")}>in</span> <PlaceLink room={to} /></>;
    else what = <>moved from {from ? <Where room={from} /> : "a room"} to {to ? <Where room={to} /> : "a room"}</>;

    return (
        <div className={cl("log-row", entry.myRoom && "log-myroom")}>
            <span className={cl("log-time")} title={new Date(entry.time).toLocaleString()}>
                {formatTime(entry.time)}
            </span>
            <span className={cl("log-kind")}>{KIND_ICON[entry.kind]}</span>
            <span className={cl("log-person", !entry.isMe && "clickable")} {...(entry.isMe ? {} : personProps(user))}>
                {user ? <Avatar user={user} size={20} /> : <div className={cl("avatar", "placeholder")} style={{ width: 20, height: 20 }} />}
                <b>{name}</b>
            </span>
            <span className={cl("log-what")}>{what}</span>
            {entry.myRoom && <span className={cl("pill", "pill-watch")}>YOUR ROOM</span>}
            {entry.isFriend && !entry.isMe && <span className={cl("pill", "pill-friend")}>FRIEND</span>}
        </div>
    );
}

// ---------- tab ----------

function matches(entry: LogEntry, filter: Filter, q: string, watchlist: string[]) {
    if ((filter === "account") !== ACCOUNT_KINDS.includes(entry.kind)) return false;
    if (filter === "friends" && !entry.isFriend) return false;
    if (filter === "mylist" && !watchlist.includes(entry.userId)) return false;
    if (filter === "myroom" && !entry.myRoom) return false;
    if (filter === "me" && !entry.isMe) return false;
    if (!q) return true;
    return [entry.userName, entry.from?.roomName, entry.from?.place, entry.to?.roomName, entry.to?.place]
        .some(text => text?.toLowerCase().includes(q));
}

export function LogTab() {
    const log = useLog();
    const { watchlist } = settings.use(["watchlist"]);
    const [filter, setFilter] = useState<Filter>("friends");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(0);
    const q = query.trim().toLowerCase();
    const shown = log.filter(e => matches(e, filter, q, watchlist));
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const current = Math.min(page, pages - 1);

    useEffect(() => setPage(0), [filter, q]);

    return (
        <>
            <div className={cl("log-toolbar")}>
                <input
                    className={cl("search")}
                    placeholder="Search people, servers or rooms…"
                    value={query}
                    onChange={e => setQuery(e.currentTarget.value)}
                />
                <div className={cl("log-filters")}>
                    {FILTERS.map(f => (
                        <span key={f.key} className={cl("log-filter", filter === f.key && "log-filter-active")} onClick={() => setFilter(f.key)}>{f.label}</span>
                    ))}
                    {log.length > 0 && <span className={cl("link", "log-clear")} onClick={clearLog}>Clear</span>}
                </div>
            </div>
            {shown.length === 0
                ? <div className={cl("empty")}>
                    {log.length
                        ? "Nothing matches."
                        : "Nothing yet. Every time a friend, someone on My list, or someone in your room joins, leaves or moves between voice rooms, it shows up here."}
                </div>
                : <div className={cl("log-list")}>{shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(e => <LogRow key={e.key} entry={e} />)}</div>}
            {pages > 1 && (
                <div className={cl("log-pages")}>
                    <span className={cl("log-filter", current === 0 && "log-page-off")} onClick={() => setPage(Math.max(0, current - 1))}>‹ Newer</span>
                    <span className={cl("muted")}>Page {current + 1} of {pages} · {shown.length} events</span>
                    <span className={cl("log-filter", current === pages - 1 && "log-page-off")} onClick={() => setPage(Math.min(pages - 1, current + 1))}>Older ›</span>
                </div>
            )}
            <div className={cl("muted", "log-hint")}>
                Click a person to message them, a room to open it, or a server to go to it. Right-click any of them for options.
                The log is saved on this computer and keeps the last {MAX_ENTRIES.toLocaleString()} events.
            </div>
        </>
    );
}
