/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { openUserProfileModal, React, UserStore, useState } from "@webpack/common";

import { ownerSetupMessage, ownerSetupStep } from "./personalGuardsOnboarding";
import { GUARD_ACTIONS, GUARD_LABELS } from "./personalGuardsProtocol";
import { acceptGuardInvite, getGrant, guardDisplayName, type GuardsStore, hasGuardKey, revokeGuard, sendGuardCommand, sendGuardInvite, setGrant, sharesVoice } from "./personalGuardsRuntime";
import { removeGuardAccess, writeGuardSetting } from "./personalGuardsSettings";
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
        <p className={cl("guard-step")}>Access granted. Join the same voice channel, choose one action, then press Send in the DM.</p>
        <div className={cl("guard-controls")}>
            {grant.actions.map(action => <button key={action} disabled={!together || !hasGuardKey(store, ownerId)}
                onClick={() => void sendGuardCommand(store, ownerId, action)}>Send {GUARD_LABELS[action]}</button>)}
        </div>
        {!together && <small>Join the same voice channel to use guard actions.</small>}
        <div className={cl("guard-controls")}>
            <button className={cl("guard-danger")} title="Remove this saved access from your device" onClick={() => {
                removeGuardAccess(store, ownerId);
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
            <small>Right-click a person → Personal Guards → Add as Guardian. Choose their actions, invite them, and press Send in the DM. They accept here without sending a reply. Commands stay encrypted and your private key stays on this device.</small>
        </div>
        <input className={cl("search", "guard-search")} type="search" value={search} onChange={event => setSearch(event.currentTarget.value)}
            placeholder="Search guardians and access" aria-label="Search guardians and access" />
        <h3>People who guard me</h3>
        <div className={cl("guards-grid")}>
            {guardians.map(grant => <GuardianRow key={grant.userId} userId={grant.userId} store={store} refresh={refresh} />)}
        </div>
        {!store.personalGuards.length && <p className={cl("guard-empty")}>No guardians yet. Right-click a person in Discord and choose Personal Guards → Add as Guardian.</p>}
        {pending.length > 0 && <><h3>Invitations to guard others</h3><div className={cl("guards-grid")}>
            {pending.map(invite => <section className={cl("guard-card")} key={invite.userId}>
                <GuardIdentity userId={invite.userId} />
                <p className={cl("guard-step")}>Allowed: {invite.actions.map(action => GUARD_LABELS[action]).join(", ")}</p>
                <div className={cl("guard-controls")}>
                    <button onClick={() => { acceptGuardInvite(store, invite.userId); refresh(); }}>Accept invitation</button>
                    <button onClick={() => { writeGuardSetting(store, "pendingGuardInvites", store.pendingGuardInvites.filter(item => item.userId !== invite.userId)); refresh(); }}>Decline</button>
                </div>
            </section>)}
        </div></>}
        <h3>Access others gave you</h3>
        <div className={cl("guards-grid")}>
            {owners.map(grant => <AccessRow key={grant.userId} ownerId={grant.userId} store={store} refresh={refresh} />)}
        </div>
        {!store.knownGuardGrants.length && <p className={cl("guard-empty")}>No access yet. Ask the owner to invite you as a guardian, then accept the invitation here.</p>}
    </div>;
}
