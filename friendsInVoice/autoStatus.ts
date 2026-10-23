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

/** set the status for being in or out of a call; only writes when it actually changes */
export async function applyAutoStatus(inCall = !!SelectedChannelStore.getVoiceChannelId()) {
    if (!settings.store.autoStatus || !UserStore.getCurrentUser()) return;
    const wanted = inCall ? settings.store.statusInCall : settings.store.statusOutsideCall;
    if (StatusSetting.getSetting() !== wanted) await StatusSetting.updateSetting(wanted);
}

export function onAutoStatusVoiceUpdates(voiceStates: { userId: string; channelId?: string | null; }[]) {
    if (!settings.store.autoStatus) return;
    const myId = UserStore.getCurrentUser()?.id;
    const mine = voiceStates.find(state => state.userId === myId);
    if (mine) void applyAutoStatus(!!mine.channelId);
}
