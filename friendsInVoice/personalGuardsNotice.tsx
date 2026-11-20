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
const ASK_TEXT: Record<GuardAction, string> = {
    mute: "will mute your microphone",
    deafen: "will deafen you",
    disconnect: "will disconnect you from voice",
};
const NOTICE_TEXT: Record<GuardAction, string> = {
    mute: "muted your microphone.",
    deafen: "deafened you.",
    disconnect: "disconnected you from voice.",
};

function Notice({ event, store, dismiss }: { event: GuardEvent; store: GuardsStore; dismiss(): void; }) {
    const [minutes, setMinutes] = useState(15);
    const [blocked, setBlocked] = useState(false);
    const [undo, setUndo] = useState<(() => void) | undefined>(() => event.undo);
    const [busy, setBusy] = useState(false);
    const [left, setLeft] = useState(() => Math.max(0, Math.ceil(((event.autoAllowAt ?? Date.now()) - Date.now()) / 1000)));
    const asking = !undo;

    async function allowNow() {
        setBusy(true);
        const result = await event.allow?.();
        if (result) setUndo(() => result); else dismiss();
    }
    function refuse() {
        event.refuse?.();
        dismiss();
    }

    // count down, then it runs by itself (the runtime runs it too, even if this notice is gone)
    useEffect(() => {
        if (!asking || !event.autoAllowAt) return;
        const tick = setInterval(() => {
            const seconds = Math.max(0, Math.ceil((event.autoAllowAt! - Date.now()) / 1000));
            setLeft(seconds);
            if (seconds === 0) { clearInterval(tick); void allowNow(); }
        }, 250);
        return () => clearInterval(tick);
    }, [asking]);

    const user = UserStore.getUser(event.guardianId);

    return <div className={cl("guard-notice")} role="alertdialog" aria-label="Personal Guard command">
        {user && <img className={cl("guard-notice-avatar")} src={user.getAvatarURL(undefined, 80)} alt="" />}
        <div className={cl("guard-notice-content")}>
            <div className={cl("guard-notice-header")}>
                <span className={cl("guard-notice-title")}>🛡️ Personal Guard</span>
                <button className={cl("guard-notice-close")} onClick={dismiss} aria-label="Dismiss notification">✕</button>
            </div>
            <p className={cl("guard-notice-text")}><strong>{guardDisplayName(event.guardianId)}</strong> {asking ? `${ASK_TEXT[event.action]} in ${left} s.` : NOTICE_TEXT[event.action]}</p>
            <div className={cl("guard-notice-actions")}>
                {asking
                    ? <>
                        <Button size="small" variant="primary" disabled={busy} onClick={() => void allowNow()}>Allow now</Button>
                        <Button size="small" variant="secondary" disabled={busy} onClick={refuse}>Refuse</Button>
                    </>
                    : <Button size="small" variant="primary" onClick={() => { undo!(); dismiss(); }}>Undo</Button>}
                <select aria-label="Block for" value={minutes} disabled={blocked} onChange={e => setMinutes(Number(e.currentTarget.value))}>
                    {BLOCK_MINUTES.map(value => <option key={value} value={value}>{value} min</option>)}
                </select>
                <Button size="small" variant="secondary" disabled={blocked} onClick={() => {
                    writeGuardSetting(store, "guardBlocks", [...store.guardBlocks.filter(item => item.userId !== event.guardianId)
                        .map(item => ({ userId: item.userId, until: item.until })),
                        { userId: event.guardianId, until: Date.now() + minutes * 60_000 }]);
                    setBlocked(true);
                    // blocking someone also stops the request they just sent
                    if (asking) event.refuse?.();
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
