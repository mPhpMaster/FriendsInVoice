/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import type { User } from "@vencord/discord-types";
import { Menu, UserStore } from "@webpack/common";

import { inList, selfMenuItems, settings, toggleInList } from ".";
import { openGuardModal } from "./personalGuardsModal";
import { GUARD_ACTIONS, GUARD_VERBS } from "./personalGuardsProtocol";
import { guardDisplayName, hasGuardKey, sendGuardCommand, sharesVoice } from "./personalGuardsRuntime";

export const UserContextPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;
    if (user.id === UserStore.getCurrentUser()?.id) {
        children.push(selfMenuItems());
        return;
    }

    const watched = inList("watchlist", user.id);
    const notifyVoice = inList("notifyVoice", user.id);
    const notify = inList("notifyOnline", user.id);
    const blocked = inList("blacklist", user.id);
    const known = settings.store.knownGuardGrants.find(grant => grant.userId === user.id);
    const actions = known && hasGuardKey(settings.store, user.id) && sharesVoice(user.id)
        ? GUARD_ACTIONS.filter(action => known.actions.includes(action)) : [];

    const isGuardian = settings.store.personalGuards.some(grant => grant.userId === user.id);
    const name = actions.length ? guardDisplayName(user.id) : "";

    children.push(<Menu.MenuGroup>
        {actions.map(action => <Menu.MenuItem key={action} id={`vc-fiv-guard-${action}`} label={`🛡️ ${GUARD_VERBS[action]} ${name}`}
            action={() => void sendGuardCommand(settings.store, user.id, action)} />)}
        <Menu.MenuItem id="vc-fiv-watch" label={watched ? "Remove from My list" : "Add to My list"}
            action={() => toggleInList("watchlist", user.id)} />
        <Menu.MenuItem id="vc-fiv-notify-voice" label={notifyVoice ? "Stop notifying me when in voice" : "Notify me when in voice"}
            action={() => toggleInList("notifyVoice", user.id)} />
        <Menu.MenuItem id="vc-fiv-notify" label={notify ? "Stop notifying me when online" : "Notify me when online"}
            action={() => toggleInList("notifyOnline", user.id)} />
        <Menu.MenuItem id="vc-fiv-blacklist" label={blocked ? "Remove from Run away" : "Add to Run away"}
            color={blocked ? undefined : "danger"} action={() => toggleInList("blacklist", user.id)} />
        <Menu.MenuItem id="vc-fiv-personal-guards" label={isGuardian ? "Personal Guard settings…" : "Make Personal Guard…"}
            action={() => openGuardModal(user.id)} />
    </Menu.MenuGroup>);
};
