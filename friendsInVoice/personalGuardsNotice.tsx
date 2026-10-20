/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { React, useEffect, UserStore, useState } from "@webpack/common";

import { guardDisplayName, type GuardEvent, type GuardsStore, subscribeGuardEvents } from "./personalGuardsRuntime";
import { writeGuardSetting } from "./personalGuardsSettings";
import type { GuardAction } from "./personalGuardsTypes";

const cl = classNameFactory("vc-fiv-");
const BLOCK_MINUTES = [5, 15, 30, 60, 120];
const NOTICE_TEXT: Record<GuardAction, string> = {
    mute: "muted your microphone.",
    deafen: "deafened you.",
    disconnect: "disconnected you from voice.",
};

function Notice({ event, store, dismiss }: { event: GuardEvent; store: GuardsStore; dismiss(): void; }) {
    const [minutes, setMinutes] = useState(15);
    const [blocked, setBlocked] = useState(false);

    const user = UserStore.getUser(event.guardianId);

    return <div className={cl("guard-notice")} role="alertdialog" aria-label="Personal Guard command">
        {user && <img className={cl("guard-notice-avatar")} src={user.getAvatarURL(undefined, 80)} alt="" />}
        <div className={cl("guard-notice-content")}>
            <div className={cl("guard-notice-header")}>
                <span className={cl("guard-notice-title")}>🛡️ Personal Guard</span>
                <button className={cl("guard-notice-close")} onClick={dismiss} aria-label="Dismiss notification">✕</button>
            </div>
            <p className={cl("guard-notice-text")}><strong>{guardDisplayName(event.guardianId)}</strong> {NOTICE_TEXT[event.action]}</p>
            <div className={cl("guard-notice-actions")}>
                <Button size="small" variant="primary" onClick={() => { event.undo(); dismiss(); }}>Undo</Button>
                <select aria-label="Block for" value={minutes} disabled={blocked} onChange={e => setMinutes(Number(e.currentTarget.value))}>
                    {BLOCK_MINUTES.map(value => <option key={value} value={value}>{value} min</option>)}
                </select>
                <Button size="small" variant="secondary" disabled={blocked} onClick={() => {
                    writeGuardSetting(store, "guardBlocks", [...store.guardBlocks.filter(item => item.userId !== event.guardianId)
                        .map(item => ({ userId: item.userId, until: item.until })),
                        { userId: event.guardianId, until: Date.now() + minutes * 60_000 }]);
                    setBlocked(true);
                }}>{blocked ? "Blocked" : "Block"}</Button>
            </div>
        </div>
    </div>;
}

export function GuardNotificationHost({ store }: { store: GuardsStore; }) {
    const [events, setEvents] = useState<GuardEvent[]>([]);
    useEffect(() => subscribeGuardEvents(event => setEvents(current => [...current, event].slice(-5))), []);
    return <div className={cl("guard-notices")}>
        {events.map(event => <Notice key={event.id} event={event} store={store}
            dismiss={() => setEvents(current => current.filter(item => item.id !== event.id))} />)}
    </div>;
}
