import { applyServerPairs, codeMessage, DEFAULT_GUARD_SERVER, GuardPoller, GuardServerClient, GuardServerError, normalizeCode, ownerNeedsEvents } from "../../friendsInVoice/guardServer.ts";
import { guardCommandRejection, reserveGuardCommand } from "../../friendsInVoice/personalGuardsCommandChecks.ts";
import { getGuardKeys, openGuardPayload, publicKeyString, sealGuardPayload, validatePublicKey } from "../../friendsInVoice/personalGuardsCrypto.ts";
import { GUARD_ACTIONS, GUARD_LABELS, makeCommand, newGuardNonce } from "../../friendsInVoice/personalGuardsProtocol.ts";

import { accountStore } from "./accountStore.js";
import { ACCOUNT_KEYS } from "./data.js";

/** BetterDiscord's Net.fetch runs outside Discord's page, so Discord never sees these requests */
export function netTransport(api) {
    return async ({ method, url, token, body, timeoutMs }) => {
        try {
            const response = await api.Net.fetch(url, {
                method, timeout: timeoutMs,
                headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            let data = null;
            try { data = await response.json(); } catch { data = null; }
            return { status: response.status, body: data };
        } catch (error) {
            return { status: 0, body: { error: String(error?.message ?? error) } };
        }
    };
}

export class GuardService {
    constructor(api, bridge, data, openPage, options = {}) {
        Object.assign(this, { api, bridge, data, openPage, active: true, seen: new Set(), refreshing: null });
        const meta = options.meta ?? accountStore("meta");
        this.client = new GuardServerClient({
            transport: options.transport ?? netTransport(api),
            credentials: {
                get: async id => (await meta.get(`guardServer_${id}`)) ?? undefined,
                set: (id, value) => meta.put(`guardServer_${id}`, value ?? null)
            },
            server: () => data.value.guardServer || DEFAULT_GUARD_SERVER,
            account: () => this.current() ?? undefined,
            publicKey: async () => publicKeyString(await getGuardKeys())
        });
        this.poller = new GuardPoller({
            client: this.client,
            shouldRun: () => options.poll !== false && !!this.current() && ownerNeedsEvents(this.data.value, !!this.bridge.myVoiceChannel()),
            onEvents: events => this.onEvents(events)
        });
    }
    stop() { this.active = false; this.seen.clear(); this.poller.reset(); }
    current() { return this.active && !this.data.loading && this.data.accountId === this.bridge.currentId() ? this.bridge.currentId() : null; }
    grantFor(id) { return this.data.value.personalGuards.find(item => item.userId === id)?.actions ?? []; }
    knownFor(id) { return this.data.value.knownGuardGrants.find(item => item.userId === id && item.pairId)?.actions ?? []; }
    keyFor(id) { return this.data.value.guardPeerKeys.find(item => item.userId === id)?.publicKey; }
    error(error) { if (this.active) this.api.UI.showToast(error instanceof Error ? error.message : String(error), { type: "error" }); }
    /** Voice changes only decide whether to listen for commands from the Friends in Voice server */
    listen() { this.poller.update(); }
    hasData() {
        const { value } = this.data;
        return value.personalGuards.length > 0 || value.knownGuardGrants.length > 0 || value.pendingGuardInvites.length > 0;
    }
    /** At start (only if you use Personal Guards), when the tab opens, after your changes and when the server says so */
    refresh(manual = false) {
        if (!this.current() || (!manual && !this.hasData())) { this.poller.update(); return Promise.resolve(false); }
        this.refreshing ??= (async () => {
            try {
                const me = this.current();
                const state = await this.client.listPairs();
                if (!me || this.current() !== me || state.me !== me) return false;
                applyServerPairs(this.data.value, state);
                this.data.save();
                this.changed?.();
                return true;
            } catch (error) {
                if (manual) this.error(error);
                return false;
            } finally {
                this.refreshing = null;
                this.poller.update();
            }
        })();
        return this.refreshing;
    }
    async start() { this.poller.reset(); await this.refresh(); }
    async onEvents(events) {
        let changed = false;
        for (const event of events) {
            if (event.type === "command") await this.onCommand(event);
            else changed = true;
            if (event.type === "refused" && event.guardianId) this.api.UI.showToast(`${this.bridge.name(event.guardianId)} refused your Personal Guard invitation.`, { type: "info" });
        }
        if (changed) await this.refresh(true);
    }
    setGrant(id, actions) {
        const current = this.data.value.personalGuards.find(item => item.userId === id);
        if (!this.data.grant(id, actions)) return;
        if (current?.pairId && actions.length) void this.client.updatePair(current.pairId, actions).catch(error => this.error(error));
    }
    async invite(id) {
        const actions = this.grantFor(id);
        if (!this.current() || !actions.length) return this.error("Choose at least one allowed action first.");
        try {
            const { code, expiresAt } = await this.client.createCode(id, actions, newGuardNonce());
            const current = this.data.value.personalGuards.find(item => item.userId === id);
            this.data.value.personalGuards = [...this.data.value.personalGuards.filter(item => item.userId !== id), { ...current, userId: id, actions, code, codeExpiresAt: expiresAt }];
            this.data.save();
            this.poller.update();
            this.changed?.();
            return { code, expiresAt };
        } catch (error) { this.error(error); }
    }
    async draftCode(id, code) {
        try { await this.bridge.prepareDm(id, codeMessage(code)); this.api.UI.showToast("Code ready in their DM. Press Enter to send it.", { type: "info" }); }
        catch (error) { this.error(error); }
    }
    async lookup(raw) {
        const code = normalizeCode(raw ?? "");
        if (!code) { this.error("A guard code has 8 letters and numbers, like ABCD-2345."); return null; }
        try { return { code, ...await this.client.showCode(code) }; }
        catch (error) { this.error(error); return null; }
    }
    async decide(code, accept) {
        try {
            if (accept) {
                const pair = await this.client.acceptCode(code);
                if (!await validatePublicKey(pair.peerKey)) throw new Error("The owner's secure key is invalid.");
            } else await this.client.refuseCode(code);
            await this.refresh(true);
            if (accept) this.api.UI.showToast("You're their Personal Guard now. In the same voice channel, right-click them to use it.", { type: "success" });
            return true;
        } catch (error) { this.error(error); return false; }
    }
    async removeAccess(id) {
        const grant = this.data.value.knownGuardGrants.find(item => item.userId === id);
        this.data.value.knownGuardGrants = this.data.value.knownGuardGrants.filter(item => item.userId !== id);
        this.data.save();
        this.changed?.();
        if (!grant?.pairId) return;
        try { await this.client.deletePair(grant.pairId); } catch (error) { this.error(error); }
        await this.refresh(true);
    }
    revoke(id) {
        const current = this.data.value.personalGuards.find(item => item.userId === id);
        this.data.revoke(id);
        if (current?.pairId) void this.client.deletePair(current.pairId).catch(() => { }).finally(() => void this.refresh(true));
        if (current?.code) void this.client.cancelCode(current.code).catch(() => { });
        this.poller.update();
        this.changed?.();
    }
    async sendCommand(id, action) {
        const senderId = this.current();
        if (!senderId || !GUARD_ACTIONS.includes(action)) return;
        try {
            const grant = this.data.value.knownGuardGrants.find(item => item.userId === id);
            if (!grant?.pairId || !grant.actions.includes(action)) throw new Error("No saved access for this action. Ask the owner for a new invite code.");
            if (!this.bridge.sharesVoice(id)) throw new Error("Join the same voice channel first.");
            const key = this.keyFor(id);
            if (!key) throw new Error("The owner's secure key is unavailable.");
            const wire = await sealGuardPayload(makeCommand(id, action, grant.inviteNonce), await getGuardKeys(), key, senderId, id);
            const { delivered } = await this.client.sendCommand(grant.pairId, wire);
            this.api.UI.showToast(delivered ? `Sent: ${GUARD_LABELS[action]}.` : `${this.bridge.name(id)}'s Friends in Voice isn't connected right now (they need v1.19 or newer).`,
                { type: delivered ? "success" : "warning" });
        } catch (error) {
            if (error instanceof GuardServerError && error.status === 404) void this.refresh(true);
            this.error(error);
        }
    }
    async onCommand(event) {
        const me = this.current();
        const seenKey = `${event.pairId}:${event.seq}:${event.at}`;
        if (!me || !event.wire || !event.from || this.seen.has(seenKey)) return;
        this.seen.add(seenKey);
        if (this.seen.size > 1000) this.seen.clear();
        const sender = event.from, { wire } = event;
        const grant = this.data.value.personalGuards.find(item => item.pairId === event.pairId);
        if (!grant || grant.userId !== sender || wire.to !== me) return;
        const pinned = this.keyFor(sender);
        if (!pinned || pinned !== wire.fromKey) return this.error("Guard command rejected: secure key does not match.");
        let payload;
        try { payload = await openGuardPayload(wire, await getGuardKeys(), sender, me); } catch { payload = null; }
        if (!payload || payload.kind !== "command" || this.current() !== me) return this.error("Guard command could not be verified.");
        const reason = guardCommandRejection(this.data.value, payload, { ownerId: me, senderId: sender, senderKey: wire.fromKey,
            pinnedKey: pinned, sharesVoice: this.bridge.sharesVoice(sender), now: Date.now() });
        if (reason) return this.error(reason);
        reserveGuardCommand(this.data.value, payload, sender, Date.now());
        this.data.save();
        try { await this.data.accounts.put(me, Object.fromEntries(ACCOUNT_KEYS.map(key => [key, this.data.value[key]]))); }
        catch { return this.error("Could not save the command receipt. Nothing was changed."); }
        if (this.current() !== me) return;
        const block = { label: "Block 15 minutes", onClick: () => {
            if (this.current() !== me) return;
            this.data.value.guardBlocks = [...this.data.value.guardBlocks.filter(item => item.userId !== sender), { userId: sender, until: Date.now() + 15 * 60_000 }];
            this.data.save();
        } };
        const run = () => {
            const undo = this.bridge.applyGuardAction(payload.action);
            if (!undo) { this.error("Discord's voice action is unavailable. Nothing was changed."); return; }
            this.api.UI.showNotice(`${this.bridge.name(sender)} applied ${GUARD_LABELS[payload.action]} to your account.`, { buttons: [
                { label: "Undo", onClick: () => { if (this.current() === me) undo(); } }, block
            ] });
        };
        if (this.data.value.autoAllowGuardCommands) return run();
        // Ask first: nothing changes on your account until you click Allow yourself, within a minute.
        const expiresAt = Date.now() + GUARD_REQUEST_TTL;
        let answered = false;
        this.api.UI.showNotice(`${this.bridge.name(sender)} wants to use ${GUARD_LABELS[payload.action]} on your account.`, { timeout: GUARD_REQUEST_TTL, buttons: [
            { label: "Allow", onClick: () => {
                if (answered || Date.now() > expiresAt || this.current() !== me) return;
                answered = true;
                if (!this.bridge.sharesVoice(sender)) return this.error("You're no longer in the same voice channel.");
                run();
            } }, block
        ] });
    }
}

/** a guard request nobody answered stops working after this long */
export const GUARD_REQUEST_TTL = 60_000;
