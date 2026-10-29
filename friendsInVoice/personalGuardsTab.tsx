/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { openUserProfileModal, React, UserStore, useState } from "@webpack/common";

import { ownerSetupMessage, ownerSetupStep } from "./personalGuardsOnboarding";
import { GUARD_ACTIONS, GUARD_LABELS } from "./personalGuardsProtocol";
import { acceptGuardInvite, declineGuardInvite, getGrant, guardDisplayName, type GuardsStore, hasGuardKey, removeGuardAccountAccess, revokeGuard, sendGuardCommand, sendGuardInvite, setGrant, sharesVoice } from "./personalGuardsRuntime";
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

function GuardianRow({ userId, store, refresh }: { userId: string; store: GuardsStore; refresh(): void; }) {
    const actions = getGrant(store, userId);
    const step = ownerSetupStep(actions);

    function update(next: GuardAction[]) {
        setGrant(store, userId, next);
        refresh();
    }

    return <section className={cl("guard-card")}>
        <GuardIdentity userId={userId} />
        <p className={cl("guard-step")}>{ownerSetupMessage(step)}</p>
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
            <button onClick={() => void sendGuardInvite(store, userId)} disabled={!actions.length}>Invite guardian</button>
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
    return <section className={cl("guard-card")}>
        <GuardIdentity userId={ownerId} />
        <p className={cl("guard-step")}>Access granted. In the same voice channel, right-click them (or use these buttons) and press Enter on the prepared message.</p>
        <div className={cl("guard-controls")}>
            {grant.actions.map(action => <button key={action} disabled={!together || !hasGuardKey(store, ownerId)}
                onClick={() => void sendGuardCommand(store, ownerId, action)}>Send {GUARD_LABELS[action]}</button>)}
        </div>
        {!together && <small>Join the same voice channel to use guard actions.</small>}
        <div className={cl("guard-controls")}>
            <button className={cl("guard-danger")} title="Remove this saved access from your device" onClick={() => {
                void removeGuardAccountAccess(ownerId);
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
    const pending = store.pendingGuardInvites.filter(item => matchesGuard(item.userId, query));

    return <div className={cl("guards-tab")}>
        <div className={cl("guards-intro")}>
            <h2>Personal Guards</h2>
            <p>Choose who can mute, deafen, or disconnect your own account while you share voice.</p>
            <small>Right-click a friend → Make Personal Guard…, choose what they may do, and press Enter on the prepared invite. They accept it from that DM message, even if they were offline. While you share voice they right-click you to use it. Commands stay encrypted and your private key stays on this device.</small>
        </div>
        <input className={cl("search", "guard-search")} type="search" value={search} onChange={event => setSearch(event.currentTarget.value)}
            placeholder="Search guardians and access" aria-label="Search guardians and access" />
        <h3>People who guard me</h3>
        <div className={cl("guards-grid")}>
            {guardians.map(grant => <GuardianRow key={grant.userId} userId={grant.userId} store={store} refresh={refresh} />)}
        </div>
        {!store.personalGuards.length && <p className={cl("guard-empty")}>No guardians yet. Right-click a friend in Discord and choose Make Personal Guard…</p>}
        {pending.length > 0 && <><h3>Invitations to guard others</h3><div className={cl("guards-grid")}>
            {pending.map(invite => <section className={cl("guard-card")} key={invite.userId}>
                <GuardIdentity userId={invite.userId} />
                <p className={cl("guard-step")}>Allowed: {invite.actions.map(action => GUARD_LABELS[action]).join(", ")}</p>
                <div className={cl("guard-controls")}>
                    <button onClick={() => { acceptGuardInvite(store, invite.userId); refresh(); }}>Accept invitation</button>
                    <button onClick={() => void declineGuardInvite(store, invite.userId, invite.nonce, invite)}>Refuse</button>
                </div>
            </section>)}
        </div></>}
        <h3>Access others gave you</h3>
        <div className={cl("guards-grid")}>
            {owners.map(grant => <AccessRow key={grant.userId} ownerId={grant.userId} store={store} refresh={refresh} />)}
        </div>
        {!store.knownGuardGrants.length && <p className={cl("guard-empty")}>No access yet. When someone invites you, accept it from their message in your DM.</p>}
    </div>;
}
