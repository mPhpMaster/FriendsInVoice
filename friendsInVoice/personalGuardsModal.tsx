/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, useState } from "@webpack/common";

import { settings } from ".";
import { GUARD_ACTIONS, GUARD_LABELS } from "./personalGuardsProtocol";
import { guardDisplayName, revokeGuard, sendGuardInvite, setGrant } from "./personalGuardsRuntime";
import type { GuardAction } from "./personalGuardsTypes";

const cl = classNameFactory("vc-fiv-");

function GuardModal({ userId, modalProps }: { userId: string; modalProps: RenderModalProps; }) {
    const existing = settings.store.personalGuards.find(grant => grant.userId === userId);
    const [actions, setActions] = useState<GuardAction[]>(existing?.actions ?? []);
    const name = guardDisplayName(userId);

    const toggle = (action: GuardAction) =>
        setActions(current => current.includes(action) ? current.filter(item => item !== action) : [...current, action]);

    return (
        <Modal
            {...modalProps}
            title={`Personal Guard: ${name}`}
            subtitle={`Choose what ${name} can do to your account while you're both in the same voice channel.`}
            actions={[
                ...(existing ? [{
                    text: "Remove guardian",
                    variant: "critical-primary",
                    onClick: () => { revokeGuard(settings.store, userId); modalProps.onClose(); },
                }] : []),
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                {
                    text: existing?.inviteNonce ? "Prepare updated invite" : "Prepare invite",
                    variant: "primary",
                    disabled: !actions.length,
                    onClick: () => {
                        setGrant(settings.store, userId, actions);
                        modalProps.onClose();
                        void sendGuardInvite(settings.store, userId);
                    },
                },
            ]}
        >
            <div className={cl("guard-modal")}>
                {GUARD_ACTIONS.map(action => (
                    <label key={action} className={cl("guard-modal-option")}>
                        <input type="checkbox" checked={actions.includes(action)} onChange={() => toggle(action)} />
                        {GUARD_LABELS[action]}
                    </label>
                ))}
                <p className={cl("guard-modal-note")}>
                    Your DM with {name} opens with the invite ready: press Enter to send it, and they accept it from that message.
                    Each time they use it you get a notice with Undo, and you can block them for a while.
                </p>
            </div>
        </Modal>
    );
}

export function openGuardModal(userId: string) {
    openModal(modalProps => <GuardModal userId={userId} modalProps={modalProps} />);
}
