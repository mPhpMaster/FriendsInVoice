/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getUserSettingLazy } from "@api/UserSettings";
import { SelectedChannelStore, UserStore } from "@webpack/common";

import { settings } from ".";

// Discord's own status user setting (online, idle, dnd, invisible)
const StatusSetting = getUserSettingLazy<string>("status", "status")!;

export const statusOptions = (defaultValue: string) => [
    { label: "Online", value: "online", default: defaultValue === "online" },
    { label: "Idle", value: "idle", default: defaultValue === "idle" },
    { label: "Do Not Disturb", value: "dnd", default: defaultValue === "dnd" },
    { label: "Invisible", value: "invisible", default: defaultValue === "invisible" },
];

/** after joining or leaving voice, wait this long for things to settle before changing the status */
export const AUTO_STATUS_DELAY = 10_000;
/** at most this many automatic status changes in any minute */
export const AUTO_STATUS_PER_MINUTE = 3;

let pending: ReturnType<typeof setTimeout> | undefined;
const recentWrites: number[] = [];

/** set the status for being in or out of a call; only writes when it actually changes, and at most 3 times a minute */
export async function applyAutoStatus(inCall = !!SelectedChannelStore.getVoiceChannelId()) {
    if (!settings.store.autoStatus || !UserStore.getCurrentUser()) return;
    const wanted = inCall ? settings.store.statusInCall : settings.store.statusOutsideCall;
    if (StatusSetting.getSetting() === wanted) return;
    const now = Date.now();
    while (recentWrites.length && now - recentWrites[0] > 60_000) recentWrites.shift();
    if (recentWrites.length >= AUTO_STATUS_PER_MINUTE) {
        // try again once the minute is up, with whatever the call state is by then
        scheduleAutoStatus(60_000 - (now - recentWrites[0]) + 1000);
        return;
    }
    recentWrites.push(now);
    await StatusSetting.updateSetting(wanted);
}

function scheduleAutoStatus(delay: number) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = undefined; void applyAutoStatus(); }, delay);
}

export function cancelAutoStatus() {
    if (pending) clearTimeout(pending);
    pending = undefined;
}

export function onAutoStatusVoiceUpdates(voiceStates: { userId: string; channelId?: string | null; }[]) {
    if (!settings.store.autoStatus) return;
    const myId = UserStore.getCurrentUser()?.id;
    // quick channel hopping ends in one status change, for wherever you are 10 seconds after the last hop
    if (voiceStates.some(state => state.userId === myId)) scheduleAutoStatus(AUTO_STATUS_DELAY);
}
