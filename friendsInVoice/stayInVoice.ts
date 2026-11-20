/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { findByPropsLazy } from "@webpack";
import { SelectedChannelStore } from "@webpack/common";

/** "Stay in voice" keeps you in a call while you're away, but only for this long */
export const STAY_IN_VOICE_LIMIT = 2 * 60 * 60_000;

const voiceChannelActions = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(id: string | null): void;
};
const EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
let lastActivity = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const touch = () => { lastActivity = Date.now(); };

/** Local only: watches your own mouse and keyboard and leaves the call after two hours without either. */
export function startStayInVoiceLimit() {
    stopStayInVoiceLimit();
    touch();
    for (const name of EVENTS) window.addEventListener(name, touch, { passive: true, capture: true });
    timer = setInterval(() => {
        if (Date.now() - lastActivity < STAY_IN_VOICE_LIMIT || !SelectedChannelStore.getVoiceChannelId()) return;
        voiceChannelActions.selectVoiceChannel(null);
        touch();
        showNotification({ title: "Friends in Voice", body: "You were away for 2 hours, so you left the call." });
    }, 60_000);
}

export function stopStayInVoiceLimit() {
    if (timer) clearInterval(timer);
    timer = undefined;
    for (const name of EVENTS) window.removeEventListener(name, touch, { capture: true });
}
