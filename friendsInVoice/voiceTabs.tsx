/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { React, useState } from "@webpack/common";

import { settings, toggleInList } from ".";
import { AddPeople, Avatar, displayName, JoinButton, ListKey,MemberRow, openRoomChannel, personProps, Room, RoomCard, StarButton, StatusDot, useUser, useVoiceData } from "./voiceContent";
const cl = classNameFactory("vc-fiv-");// ---------- tabs ----------

export function VoiceTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
    const { rooms, myChannel } = data;
    const { hidden } = settings.use(["hidden"]);
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
            {hidden.length > 0 && (
                <div className={cl("hidden-bar")}>
                    <span className={cl("reason-label")} title="Hidden people don't show up in In voice or count in the badge">🙈 Hidden</span>
                    {hidden.map(id => <HiddenChip key={id} id={id} />)}
                </div>
            )}
        </>
    );
}

function HiddenChip({ id }: { id: string; }) {
    const user = useUser(id);
    return (
        <span className={cl("chip", "chip-hidden", "clickable")} {...personProps(user)}>
            {user ? <Avatar user={user} size={18} /> : <span className={cl("avatar", "placeholder")} style={{ width: 18, height: 18 }} />}
            {user ? displayName(user, null) : "Loading…"}
            <span className={cl("chip-show")} title="Show in In voice again" onClick={e => { e.stopPropagation(); toggleInList("hidden", id); }}>✕</span>
        </span>
    );
}

export function WatchedCard({ id, room, myChannel }: { id: string; room?: Room; myChannel?: string | null; }) {
    const user = useUser(id);
    const name = user ? displayName(user, room?.channel.guild_id ?? null) : "Loading…";
    const others = room?.members.filter(m => m.user.id !== id) ?? [];
    const inThisRoom = !!room && room.channel.id === myChannel;

    return (
        <div className={cl("card", room && "card-active", inThisRoom && "current")}>
            <div className={cl("person")}>
                {user
                    ? <span className={cl("clickable")} {...personProps(user)}><Avatar user={user} size={40} /></span>
                    : <div className={cl("avatar", "placeholder")} style={{ width: 40, height: 40 }} />}
                <div className={cl("person-info")}>
                    <div className={cl("person-name", "clickable")} {...personProps(user)}>{name} <StatusDot id={id} withLabel /></div>
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

export function MyListTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
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
        <div className={cl("alert-person", "clickable")} {...personProps(user)}>
            {user ? <Avatar user={user} size={28} /> : <div className={cl("avatar", "placeholder")} style={{ width: 28, height: 28 }} />}
            <span className={cl("member-name")}>{user ? displayName(user, null) : "Loading…"}</span>
            <StatusDot id={id} withLabel />
            <span className={cl("remove")} title="Remove" onClick={e => { e.stopPropagation(); toggleInList(listKey, id); }}>✕</span>
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

export function AlertsTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
    const { notifyOnce } = settings.use(["notifyOnce"]);
    return (
        <div className={cl("sections")}>
            <AlertSection
                listKey="notifyVoice"
                title="🔊 Notify me when in voice"
                description="You get a notification every time one of them joins a voice room you can see, even if their status shows offline — click it to see where they are and who's with them."
                friendIds={data.friendIds}
            />
            <AlertSection
                listKey="notifyOnline"
                title="🔔 Notify me when online"
                description={notifyOnce
                    ? "You get a notification the next time each of them comes online — click it to open your DM. They're removed from this list afterwards (change this in the plugin settings)."
                    : "You get a notification every time one of them comes online — click it to open your DM."}
                friendIds={data.friendIds}
            />
        </div>
    );
}

export function RunAwayTab({ data }: { data: ReturnType<typeof useVoiceData>; }) {
    return (
        <div className={cl("sections")}>
            <AlertSection
                listKey="blacklist"
                title="🏃 Run away"
                description="You get a notification every time one of them comes online — click it to switch your status to Invisible. Right-click anyone → Add to Run away / Remove from Run away."
                friendIds={data.friendIds}
            />
        </div>
    );
}
