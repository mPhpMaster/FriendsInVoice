import { guardCommandRejection, reserveGuardCommand } from "../../friendsInVoice/personalGuardsCommandChecks.ts";
import { getGuardKeys, openGuardPayload, publicKeyString, sealGuardPayload, validatePublicKey } from "../../friendsInVoice/personalGuardsCrypto.ts";
import { GUARD_ACTIONS, GUARD_LABELS, inviteSummary, makeCommand, makeGrantNotice, newGuardNonce, parseGuardMessage, serializeWire } from "../../friendsInVoice/personalGuardsProtocol.ts";
import { saveGuardInvitation } from "../../friendsInVoice/personalGuardsSettings.ts";

import { ACCOUNT_KEYS } from "./data.js";
import { GuardAccountAccess } from "./guardAccount.js";

const MAX_GRANT_AGE = 7 * 24 * 60 * 60_000;

export class GuardService {
    constructor(api, bridge, data, openPage) {
        Object.assign(this, { api, bridge, data, openPage, active: true, seen: new Set() });
        this.account = new GuardAccountAccess(bridge, data, () => this.changed?.());
    }
    stop() { this.active = false; this.seen.clear(); this.account.stop(); }
    current() { return this.active && !this.data.loading && this.data.accountId === this.bridge.currentId() ? this.bridge.currentId() : null; }
    grantFor(id) { return this.data.value.personalGuards.find(item => item.userId === id)?.actions ?? []; }
    knownFor(id) { return this.data.value.knownGuardGrants.find(item => item.userId === id)?.actions ?? []; }
    keyFor(id) { return this.data.value.guardPeerKeys.find(item => item.userId === id)?.publicKey; }
    setKey(id, publicKey) {
        this.data.value.guardPeerKeys = [...this.data.value.guardPeerKeys.filter(item => item.userId !== id), { userId: id, publicKey }];
        this.data.save();
    }
    error(error) { if (this.active) this.api.UI.showToast(error instanceof Error ? error.message : String(error), { type: "error" }); }
    notify(title, content, action) {
        if (this.active) this.api.UI.showNotice(`${title}: ${content}`, action ? { buttons: [{ label: "Open Personal Guards", onClick: action }] } : {});
    }
    async invite(id) {
        const me = this.current();
        if (!me || !this.grantFor(id).length) return this.error("Choose at least one allowed action first.");
        try {
            const nonce = newGuardNonce();
            const publicKey = await publicKeyString(await getGuardKeys());
            if (this.current() !== me) throw new Error("Discord accounts changed. Try again.");
            const actions = [...this.grantFor(id)];
            await this.bridge.prepareDm(id, serializeWire({ type: "invite", version: 3, publicKey, actions, nonce }, inviteSummary(actions)));
            if (this.current() !== me) throw new Error("Discord accounts changed. Nothing was saved.");
            saveGuardInvitation(this.data.value, id, nonce);
            this.data.save();
            this.api.UI.showToast("Invitation ready. Press Enter to send it; they choose Accept or Refuse.", { type: "info" });
        } catch (error) { this.error(error); }
    }
    async decide(invite, accept) {
        try { await this.account.decide(invite, accept); }
        catch (error) { this.error(error); }
    }
    async removeAccess(id) {
        try { await this.account.remove(id); }
        catch (error) { this.error(error); }
    }
    // Existing key-based setups remain readable. New setup always uses an invitation.
    async sendGrant(id) {
        const ownerId = this.current();
        const key = this.keyFor(id);
        if (!ownerId || !key) return;
        try {
            const wire = await sealGuardPayload(makeGrantNotice(ownerId, this.grantFor(id)), await getGuardKeys(), key, ownerId, id);
            if (this.current() !== ownerId) return;
            await this.bridge.prepareDm(id, serializeWire(wire));
        } catch (error) { this.error(error); }
    }
    async sendCommand(id, action) {
        const senderId = this.current();
        if (!senderId || !GUARD_ACTIONS.includes(action)) return;
        try {
            const known = this.data.value.knownGuardGrants.find(item => item.userId === id);
            if (known?.inviteNonce && !await this.account.sync(id)) throw new Error("Accept the newest invitation in your DM before using this action.");
            if (this.current() !== senderId || !this.knownFor(id).includes(action) || !this.bridge.sharesVoice(id))
                throw new Error("This action requires allowed access and the same voice channel.");
            const grant = this.data.value.knownGuardGrants.find(item => item.userId === id);
            const key = this.keyFor(id);
            if (!key) throw new Error("The owner's secure key is unavailable.");
            const wire = await sealGuardPayload(makeCommand(id, action, grant?.inviteNonce), await getGuardKeys(), key, senderId, id);
            if (this.current() !== senderId) throw new Error("Discord accounts changed.");
            await this.bridge.prepareDm(id, serializeWire(wire));
            this.api.UI.showToast("One encrypted action is ready. Press Enter to send it.", { type: "info" });
        } catch (error) { this.error(error); }
    }
    revoke(id) { this.data.revoke(id); this.changed?.(); }
    async onMessage(message) {
        if (!this.current() || !message?.id || this.seen.has(message.id) || message.author?.bot) return;
        const wire = parseGuardMessage(message.content ?? "");
        const channel = this.bridge.channel(message.channel_id);
        const me = this.current(), sender = message.author?.id;
        if (!wire || !sender || sender === me || !this.bridge.isDm(channel) || channel.recipients?.length !== 1 || channel.recipients[0] !== sender) return;
        this.seen.add(message.id);
        if (this.seen.size > 1000) this.seen.clear();
        if (wire.type === "invite") {
            await this.account.sync(sender);
            if (this.current() !== me) return;
            const invite = this.data.value.pendingGuardInvites.find(item => item.userId === sender && item.nonce === wire.nonce);
            if (invite) this.api.UI.showNotice(`${this.bridge.name(sender)} invited you to be their Personal Guard.`, { buttons: [
                { label: "Accept", onClick: () => void this.decide(invite, true) },
                { label: "Refuse", onClick: () => void this.decide(invite, false) },
                { label: "View permissions", onClick: () => this.openPage("guards") }
            ] });
            return;
        }
        if (wire.type === "key") {
            if (await validatePublicKey(wire.publicKey) && this.current() === me) this.setKey(sender, wire.publicKey);
            return;
        }
        if (wire.to !== me) return;
        let payload;
        try { payload = await openGuardPayload(wire, await getGuardKeys(), sender, me); }
        catch { return this.error("Guard message could not be decrypted. Use the newest invitation."); }
        if (!payload || this.current() !== me) return;
        if (payload.kind === "grant") {
            if (payload.ownerId !== sender || Math.abs(Date.now() - payload.createdAt) > MAX_GRANT_AGE) return;
            if (this.data.value.knownGuardGrants.some(item => item.userId === sender && item.inviteNonce) ||
                this.data.value.pendingGuardInvites.some(item => item.userId === sender)) return;
            this.setKey(sender, wire.fromKey);
            this.data.value.knownGuardGrants = [...this.data.value.knownGuardGrants.filter(item => item.userId !== sender),
                ...(payload.actions.length ? [{ userId: sender, actions: [...payload.actions] }] : [])];
            this.data.save();
            this.changed?.();
            return;
        }
        const reason = guardCommandRejection(this.data.value, payload, { ownerId: me, senderId: sender, senderKey: wire.fromKey,
            pinnedKey: this.keyFor(sender), sharesVoice: this.bridge.sharesVoice(sender), now: Date.now() });
        if (reason) return this.error(reason);
        reserveGuardCommand(this.data.value, payload, sender, Date.now());
        this.data.save();
        try { await this.data.accounts.put(me, Object.fromEntries(ACCOUNT_KEYS.map(key => [key, this.data.value[key]]))); }
        catch { return this.error("Could not save the command receipt. Nothing was changed."); }
        if (this.current() !== me) return;
        const changed = guardCommandRejection({ ...this.data.value,
            guardReplay: this.data.value.guardReplay.filter(entry => entry.nonce !== payload.nonce) }, payload,
        { ownerId: me, senderId: sender, senderKey: wire.fromKey, pinnedKey: this.keyFor(sender), sharesVoice: this.bridge.sharesVoice(sender), now: Date.now() });
        if (changed) return this.error(changed);
        const undo = this.bridge.applyGuardAction(payload.action);
        if (!undo) return this.error("Discord's voice action is unavailable. Nothing was changed.");
        this.api.UI.showNotice(`${this.bridge.name(sender)} applied ${GUARD_LABELS[payload.action]} to your account.`, { buttons: [
            { label: "Undo", onClick: () => { if (this.current() === me) undo(); } },
            { label: "Block 15 minutes", onClick: () => {
                if (this.current() !== me) return;
                this.data.value.guardBlocks = [...this.data.value.guardBlocks.filter(item => item.userId !== sender), { userId: sender, until: Date.now() + 15 * 60_000 }];
                this.data.save();
            } }
        ] });
    }
}
