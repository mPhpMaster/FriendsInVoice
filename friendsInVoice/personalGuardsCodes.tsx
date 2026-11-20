/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import type { Channel, Message, RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, UserStore, useState } from "@webpack/common";

import { settings } from ".";
import { codeFromText, type CodeOffer, formatCode } from "./guardServer";
import { GUARD_LABELS, isGuardMessage } from "./personalGuardsProtocol";
import { decideGuardCode, draftGuardCode, guardDisplayName, lookupGuardCode } from "./personalGuardsRuntime";

const cl = classNameFactory("vc-fiv-");

function CodeModal({ guardianId, code, expiresAt, modalProps }: { guardianId: string; code: string; expiresAt: number; modalProps: RenderModalProps; }) {
    const name = guardDisplayName(guardianId);
    const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
    return <Modal {...modalProps} title={`Invite code for ${name}`}
        subtitle={`Give ${name} this code. It works once, only for their account, for ${minutes} minutes.`}
        actions={[
            { text: "Copy code", variant: "secondary", onClick: () => void copyWithToast(formatCode(code), "Code copied") },
            { text: "Put it in their DM", variant: "secondary", onClick: () => { modalProps.onClose(); void draftGuardCode(guardianId, code); } },
            { text: "Done", variant: "primary", onClick: modalProps.onClose },
        ]}>
        <div className={cl("guard-modal")}>
            <div className={cl("guard-code")}>{formatCode(code)}</div>
            <p className={cl("guard-modal-note")}>
                They open Friends in Voice → Personal Guards → Enter a code, or click "Use this code" under your DM.
                You'll see it here as soon as they accept.
            </p>
        </div>
    </Modal>;
}

export function openGuardCodeModal(guardianId: string, code: string, expiresAt: number) {
    openModal(modalProps => <CodeModal guardianId={guardianId} code={code} expiresAt={expiresAt} modalProps={modalProps} />);
}

function OfferModal({ offer, modalProps }: { offer: CodeOffer & { code: string; }; modalProps: RenderModalProps; }) {
    const name = guardDisplayName(offer.ownerId);
    const [busy, setBusy] = useState(false);
    const decide = async (accept: boolean) => {
        setBusy(true);
        if (await decideGuardCode(offer.code, accept)) modalProps.onClose();
        else setBusy(false);
    };
    return <Modal {...modalProps} title={`Become ${name}'s Personal Guard?`}
        subtitle={`While you're both in the same voice channel, you'll be able to: ${offer.actions.map(action => GUARD_LABELS[action].toLowerCase()).join(", ")}.`}
        actions={[
            { text: "Refuse", variant: "secondary", disabled: busy, onClick: () => void decide(false) },
            { text: "Accept", variant: "primary", disabled: busy, onClick: () => void decide(true) },
        ]}>
        <div className={cl("guard-modal")}>
            <p className={cl("guard-modal-note")}>They get a notice with Undo each time you use it, and they can remove you at any time.</p>
        </div>
    </Modal>;
}

export async function openGuardCode(raw: string): Promise<boolean> {
    const offer = await lookupGuardCode(raw);
    if (!offer) return false;
    openModal(modalProps => <OfferModal offer={offer} modalProps={modalProps} />);
    return true;
}

export function GuardCodeEntry() {
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        setBusy(true);
        if (await openGuardCode(value)) setValue("");
        setBusy(false);
    };
    return <div className={cl("guard-code-entry")}>
        <input className={cl("search")} value={value} maxLength={12} placeholder="Enter a guard code, like ABCD-2345" aria-label="Guard code"
            onChange={event => setValue(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") void submit(); }} />
        <Button size="small" variant="primary" disabled={busy || value.replace(/[^A-Za-z0-9]/g, "").length !== 8} onClick={() => void submit()}>Use code</Button>
    </div>;
}

/** Shown under a DM message that carries a guard code. Rendering it reads nothing from Discord. */
export function GuardCodeCard({ message, channel }: { message: Message; channel: Channel; }) {
    const mine = message.author?.id === UserStore.getCurrentUser()?.id;
    const code = codeFromText(message.content ?? "");
    if (code) {
        if (mine) {
            const guardianId = channel.recipients?.[0];
            return <div className={cl("guard-invite", "guard-invite-sent")}>🛡️ {guardianId ? guardDisplayName(guardianId) : "They"} can use this code for 10 minutes.</div>;
        }
        const accepted = settings.store.knownGuardGrants.some(grant => grant.userId === message.author?.id);
        return <div className={cl("guard-invite")}>
            <div className={cl("guard-invite-text")}>
                <strong>🛡️ {guardDisplayName(message.author.id)} invited you to be their Personal Guard.</strong>
                <span>{accepted ? "You're already their guard. A new code replaces the old invitation." : "Click to see what they allow, then accept or refuse."}</span>
            </div>
            <div className={cl("guard-invite-actions")}>
                <Button size="small" variant="primary" onClick={() => void openGuardCode(code)}>Use this code</Button>
            </div>
        </div>;
    }
    if (isGuardMessage(message.content ?? ""))
        return <div className={cl("guard-invite", "guard-invite-sent")}>🛡️ Old Personal Guards message. Guards now pair with a code from Friends in Voice → Personal Guards.</div>;
    return null;
}
