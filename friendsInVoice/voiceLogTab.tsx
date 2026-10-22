/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { ChannelStore, ContextMenuApi, GuildStore, Menu, NavigationRouter, React, useEffect, useReducer, useState } from "@webpack/common";

import { setPageOpen } from ".";
import { Avatar, joinRoom, openRoomChannel, personProps, useUser } from "./voiceContent";
import { clearLog, getLog, LogEntry, LogRoom, subscribeLog } from "./voiceLog";

const cl = classNameFactory("vc-fiv-");

type Filter = "all" | "friends" | "myroom" | "me";

const FILTERS: { key: Filter; label: string; }[] = [
    { key: "all", label: "Everything" },
    { key: "friends", label: "Friends" },
    { key: "myroom", label: "My room" },
    { key: "me", label: "Me" },
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

const KIND_ICON = { join: "➡️", leave: "⬅️", move: "🔀" };

function LogRow({ entry }: { entry: LogEntry; }) {
    const user = useUser(entry.userId);
    const { from, to } = entry;
    const name = entry.isMe ? "You" : entry.userName;

    let what: React.ReactNode;
    if (entry.kind === "join") what = <>joined <Where room={to!} /></>;
    else if (entry.kind === "leave") what = <>left <Where room={from!} /></>;
    else if (from && to && from.guildId === to.guildId) what = <>moved from <RoomLink room={from} /> to <RoomLink room={to} /> <span className={cl("muted")}>in</span> <PlaceLink room={to} /></>;
    else what = <>moved from {from ? <Where room={from} /> : "a room"} to {to ? <Where room={to} /> : "a room"}</>;

    return (
        <div className={cl("log-row", entry.myRoom && "log-myroom")}>
            <span className={cl("log-time")} title={new Date(entry.time).toLocaleString()}>
                {new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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

function matches(entry: LogEntry, filter: Filter, q: string) {
    if (filter === "friends" && !entry.isFriend) return false;
    if (filter === "myroom" && !entry.myRoom) return false;
    if (filter === "me" && !entry.isMe) return false;
    if (!q) return true;
    return [entry.userName, entry.from?.roomName, entry.from?.place, entry.to?.roomName, entry.to?.place]
        .some(text => text?.toLowerCase().includes(q));
}

export function LogTab() {
    const log = useLog();
    const [filter, setFilter] = useState<Filter>("all");
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const shown = log.filter(e => matches(e, filter, q));

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
                        : "Nothing yet. Every time someone joins, leaves or moves between voice rooms in your servers, it shows up here, including people coming into and leaving your own room."}
                </div>
                : <div className={cl("log-list")}>{shown.map(e => <LogRow key={e.key} entry={e} />)}</div>}
            <div className={cl("muted", "log-hint")}>
                Click a person to message them, a room to open it, or a server to go to it. Right-click any of them for options.
                The log keeps the last 500 events until you restart Discord.
            </div>
        </>
    );
}
