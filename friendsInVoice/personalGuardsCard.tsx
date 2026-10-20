/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import type { Channel, Message } from "@vencord/discord-types";
import { MessageStore, React, useMemo, UserStore, useStateFromStores } from "@webpack/common";

import { settings } from ".";
import { GUARD_LABELS, parseGuardMessage } from "./personalGuardsProtocol";
import { acceptGuardInvite, declineGuardInvite, guardDisplayName, inviteFromMessage } from "./personalGuardsRuntime";

const cl = classNameFactory("vc-fiv-");

/** The id of the newest invite this person sent in the channel, among the messages Discord has loaded */
function newestInviteId(channelId: string, authorId: string): string | null {
    const messages = MessageStore.getMessages(channelId)?._array ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.author?.id === authorId && parseGuardMessage(message.content ?? "")?.type === "invite") return message.id;
    }
    return null;
}

/** Shown under a Personal Guard invite in a DM, so it can be accepted whenever the guardian opens the chat */
export function GuardInviteCard({ message, channel }: { message: Message; channel: Channel; }) {
    const { knownGuardGrants, declinedGuardInvites } = settings.use(["knownGuardGrants", "declinedGuardInvites"]);
    const invite = useMemo(() => inviteFromMessage(message as any), [message.content, message.author?.id]);
    const newest = useStateFromStores([MessageStore], () => newestInviteId(channel.id, message.author?.id));
    if (!invite) return null;

    const allowed = invite.actions.map(action => GUARD_LABELS[action].toLowerCase()).join(", ");

    if (invite.userId === UserStore.getCurrentUser()?.id) {
        const guardianId = channel.recipients?.[0];
        return (
            <div className={cl("guard-invite", "guard-invite-sent")}>
                🛡️ {guardianId ? guardDisplayName(guardianId) : "They"} can accept this invite from this message, even if they're offline right now.
            </div>
        );
    }

    const ownerName = guardDisplayName(invite.userId);
    const grant = knownGuardGrants.find(item => item.userId === invite.userId);
    const accepted = grant?.inviteNonce === invite.nonce;
    const declined = declinedGuardInvites.includes(invite.nonce);
    const replaced = !accepted && newest !== null && newest !== message.id;

    if (replaced) {
        return <div className={cl("guard-invite", "guard-invite-sent")}>🛡️ {ownerName} sent a newer invite below; this one no longer works.</div>;
    }

    return (
        <div className={cl("guard-invite")}>
            <div className={cl("guard-invite-text")}>
                <strong>🛡️ {ownerName} invited you to be their Personal Guard.</strong>
                <span>
                    {accepted
                        ? `You accepted. While you're both in the same voice channel, right-click ${ownerName} to use: ${allowed}.`
                        : declined
                            ? "You declined this invite."
                            : grant
                                ? `You're already their guard from another invite. This one allows: ${allowed}.`
                                : `While you're both in the same voice channel, you'll be able to: ${allowed}.`}
                </span>
            </div>
            {!accepted && (
                <div className={cl("guard-invite-actions")}>
                    <Button size="small" variant="primary" onClick={() => void acceptGuardInvite(settings.store, invite.userId, invite)}>
                        {grant ? "Use this invite" : "Accept"}
                    </Button>
                    {!declined && (
                        <Button size="small" variant="secondary" onClick={() => declineGuardInvite(settings.store, invite.userId, invite.nonce)}>
                            Decline
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
