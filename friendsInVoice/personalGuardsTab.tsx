/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { openUserProfileModal, React, useEffect, UserStore, useState } from "@webpack/common";

import { formatCode } from "./guardServer";
import { GuardCodeEntry, openGuardCodeModal } from "./personalGuardsCodes";
import { ownerSetupMessage, ownerSetupStep } from "./personalGuardsOnboarding";
import { GUARD_ACTIONS, GUARD_LABELS } from "./personalGuardsProtocol";
import { createGuardCode, getGrant, guardDisplayName, type GuardsStore, hasGuardKey, removeGuardAccountAccess, revokeGuard, sendGuardCommand, setGrant, sharesVoice } from "./personalGuardsRuntime";
import { onGuardPairsChange, refreshGuardPairs } from "./personalGuardsServer";
import type { GuardAction } from "./personalGuardsTypes";

const cl = classNameFactory("vc-fiv-");

function GuardIdentity({ userId }: { userId: string; }) {
    const user = UserStore.getUser(userId);
    return <div className={cl("guard-title")}>
        {user && <img src={user.getAvatarURL(undefined, 64)} alt="" />}
        <span>
            <button className={cl("guard-person")} onClick={() => openUserProfileModal({ userId })}>
                <strong>{guardDisplayName(userId)}</strong>
                {user && <small>@{user.username}</small>}
                <small>{userId}</small>
            </button>
        </span>
    </div>;
}

function matchesGuard(userId: string, search: string): boolean {
    const user = UserStore.getUser(userId);
    return [guardDisplayName(userId), user?.username ?? "", userId]
        .some(value => value.toLowerCase().includes(search));
}

export async function inviteGuardian(store: GuardsStore, userId: string) {
    const result = await createGuardCode(store, userId);
    if (result) openGuardCodeModal(userId, result.code, result.expiresAt);
}

function GuardianRow({ userId, store, refresh }: { userId: string; store: GuardsStore; refresh(): void; }) {
    const grant = store.personalGuards.find(item => item.userId === userId);
    const actions = getGrant(store, userId);
    const open = grant?.code && (grant.codeExpiresAt ?? 0) > Date.now();
    const step = ownerSetupStep(actions, !!grant?.pairId, !!open);

    function update(next: GuardAction[]) {
        setGrant(store, userId, next);
        refresh();
    }

    return <section className={cl("guard-card")}>
        <GuardIdentity userId={userId} />
        <p className={cl("guard-step")}>{ownerSetupMessage(step)}</p>
        {open && <p className={cl("guard-step")}>Open code: <strong>{formatCode(grant!.code!)}</strong></p>}
        <div className={cl("guard-options")}>
            {GUARD_ACTIONS.map(action => <label key={action}>
                <input type="checkbox" checked={actions.includes(action)}
                    onChange={() => update(actions.includes(action) ? actions.filter(item => item !== action) : [...actions, action])} />
                {GUARD_LABELS[action]}
            </label>)}
            <label><input type="checkbox" checked={actions.length === GUARD_ACTIONS.length}
                onChange={() => update(actions.length === GUARD_ACTIONS.length ? [] : GUARD_ACTIONS)} />Select all</label>
        </div>
        <div className={cl("guard-controls")}>
            {!grant?.pairId && <button onClick={() => void inviteGuardian(store, userId).then(refresh)} disabled={!actions.length}>
                {open ? "New invite code" : "Get invite code"}
            </button>}
            <button className={cl("guard-danger")} onClick={() => {
                revokeGuard(store, userId);
                refresh();
            }}>Revoke and remove</button>
        </div>
    </section>;
}

function AccessRow({ ownerId, store, refresh }: { ownerId: string; store: GuardsStore; refresh(): void; }) {
    const grant = store.knownGuardGrants.find(item => item.userId === ownerId);
    if (!grant) return null;
    const together = sharesVoice(ownerId);
    const usable = !!grant.pairId && hasGuardKey(store, ownerId);
    return <section className={cl("guard-card")}>
        <GuardIdentity userId={ownerId} />
        <p className={cl("guard-step")}>{usable
            ? "Access granted. In the same voice channel, right-click them or use these buttons. It applies right away."
            : "This access came from an old DM invite and no longer works. Ask them for an invite code."}</p>
        {usable && <div className={cl("guard-controls")}>
            {grant.actions.map(action => <button key={action} disabled={!together}
                onClick={() => void sendGuardCommand(store, ownerId, action)}>{GUARD_LABELS[action]}</button>)}
        </div>}
        {usable && !together && <small>Join the same voice channel to use guard actions.</small>}
        <div className={cl("guard-controls")}>
            <button className={cl("guard-danger")} title="Stop being their guard" onClick={() => {
                void removeGuardAccountAccess(store, ownerId).then(refresh);
                refresh();
            }}>Remove access</button>
        </div>
    </section>;
}

export function PersonalGuardsTab({ store, refresh }: { store: GuardsStore; refresh(): void; }) {
    const [search, setSearch] = useState("");
    const query = search.trim().toLowerCase();
    const guardians = store.personalGuards.filter(item => matchesGuard(item.userId, query));
    const owners = store.knownGuardGrants.filter(item => matchesGuard(item.userId, query));

    // one read from the Friends in Voice server when the tab opens; nothing is read from Discord
    useEffect(() => {
        void refreshGuardPairs(true);
        return onGuardPairsChange(refresh);
    }, []);

    return <div className={cl("guards-tab")}>
        <div className={cl("guards-intro")}>
            <h2>Personal Guards</h2>
            <p>Choose who can mute, deafen, or disconnect your own account while you share voice.</p>
            <small>Right-click a friend → Make Personal Guard…, choose what they may do, and give them the invite code. They enter it here.
                Pairing and commands go through the Friends in Voice server, end-to-end encrypted, and never through Discord messages.
                Your private key stays on this device.</small>
        </div>
        <h3>Enter an invite code</h3>
        <GuardCodeEntry />
        <input className={cl("search", "guard-search")} type="search" value={search} onChange={event => setSearch(event.currentTarget.value)}
            placeholder="Search guardians and access" aria-label="Search guardians and access" />
        <h3>People who guard me</h3>
        <div className={cl("guards-grid")}>
            {guardians.map(grant => <GuardianRow key={grant.userId} userId={grant.userId} store={store} refresh={refresh} />)}
        </div>
        {!store.personalGuards.length && <p className={cl("guard-empty")}>No guardians yet. Right-click a friend in Discord and choose Make Personal Guard…</p>}
        <h3>Access others gave you</h3>
        <div className={cl("guards-grid")}>
            {owners.map(grant => <AccessRow key={grant.userId} ownerId={grant.userId} store={store} refresh={refresh} />)}
        </div>
        {!store.knownGuardGrants.length && <p className={cl("guard-empty")}>No access yet. When someone gives you an invite code, enter it above.</p>}
    </div>;
}
