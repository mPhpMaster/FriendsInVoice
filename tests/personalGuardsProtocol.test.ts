import assert from "node:assert/strict";
import { test } from "node:test";

import { openGuardPayload, publicKeyString, sealGuardPayload, validatePublicKey } from "../friendsInVoice/personalGuardsCrypto";
import { inviteSummary, isGuardMessage, makeCommand, makeGrantNotice, newGuardNonce, parseGuardMessage, serializeWire } from "../friendsInVoice/personalGuardsProtocol";

const ownerId = "123456789012345678";
const guardianId = "234567890123456789";

async function pair() {
    return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

test("encrypted command hides the action and decrypts only for the owner", async () => {
    const guardian = await pair();
    const owner = await pair();
    const other = await pair();
    const wire = await sealGuardPayload(makeCommand(ownerId, "mute"), guardian, await publicKeyString(owner), guardianId, ownerId);
    const text = serializeWire(wire);
    assert.ok(!text.includes("mute"));
    assert.equal(parseGuardMessage(text)?.type, "sealed");
    const decoded = await openGuardPayload(wire, owner, guardianId, ownerId);
    assert.equal(decoded?.kind, "command");
    if (decoded?.kind === "command") assert.equal(decoded.action, "mute");
    assert.equal(await openGuardPayload(wire, other, guardianId, ownerId), null);
    assert.equal(await openGuardPayload(wire, owner, ownerId, guardianId), null);
    assert.equal(await openGuardPayload({ ...wire, ciphertext: (wire.ciphertext[0] === "A" ? "B" : "A") + wire.ciphertext.slice(1) }, owner, guardianId, ownerId), null);
});

test("encrypted grant carries a subset and an empty revocation", async () => {
    const owner = await pair();
    const guardian = await pair();
    const recipientKey = await publicKeyString(guardian);
    assert.equal(await validatePublicKey(recipientKey), true);
    for (const actions of [["mute", "disconnect"] as const, [] as const]) {
        const wire = await sealGuardPayload(makeGrantNotice(ownerId, [...actions]), owner, recipientKey, ownerId, guardianId);
        const decoded = await openGuardPayload(wire, guardian, ownerId, guardianId);
        assert.deepEqual(decoded?.kind === "grant" ? decoded.actions : null, actions);
    }
});

test("old plain-text and malformed messages are rejected", () => {
    assert.equal(parseGuardMessage("[FriendsInVoice Guard v1] {\"kind\":\"command\",\"action\":\"mute\"}"), null);
    assert.equal(parseGuardMessage("hello"), null);
    assert.equal(parseGuardMessage("[FriendsInVoice Guard v2] {}"), null);
});

test("owner invitation carries the allowed actions and binds later encrypted commands", async () => {
    const owner = await pair();
    const guardian = await pair();
    const nonce = newGuardNonce();
    assert.match(nonce, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
    const invite = serializeWire({ type: "invite", version: 3, publicKey: await publicKeyString(owner), actions: ["mute"], nonce });
    assert.equal(parseGuardMessage(invite)?.type, "invite");
    const command = makeCommand(ownerId, "mute", nonce);
    const wire = await sealGuardPayload(command, guardian, await publicKeyString(owner), guardianId, ownerId);
    const decoded = await openGuardPayload(wire, owner, guardianId, ownerId);
    assert.equal(decoded?.kind === "command" ? decoded.inviteNonce : null, nonce);
    assert.equal(parseGuardMessage(serializeWire({ type: "invite", version: 3, publicKey: await publicKeyString(owner), actions: ["unknown" as any], nonce })), null);
});

test("transport whitespace in encoded fields preserves invitation and authenticated command", async () => {
    const owner = await pair();
    const guardian = await pair();
    const inviteNonce = newGuardNonce();
    const publicKey = await publicKeyString(owner);
    const spaced = (value: string) => value.match(/.{1,19}/g)!.join(" \t\r\n");
    const invite = parseGuardMessage(serializeWire({ type: "invite", version: 3, publicKey: spaced(publicKey), actions: ["mute"], nonce: inviteNonce }));
    assert.equal(invite?.type, "invite");
    if (invite?.type !== "invite") throw new Error("Invitation was not parsed");
    assert.equal(invite.publicKey, publicKey);
    const command = makeCommand(ownerId, "mute", inviteNonce);
    const wire = await sealGuardPayload(command, guardian, publicKey, guardianId, ownerId);
    const parsed = parseGuardMessage(serializeWire({ ...wire, fromKey: spaced(wire.fromKey), iv: spaced(wire.iv), ciphertext: spaced(wire.ciphertext) }));
    assert.equal(parsed?.type, "sealed");
    if (parsed?.type !== "sealed") throw new Error("Command was not parsed");
    assert.deepEqual(await openGuardPayload(parsed, owner, guardianId, ownerId), command);
    assert.equal(await openGuardPayload({ ...parsed, ciphertext: (parsed.ciphertext[0] === "A" ? "B" : "A") + parsed.ciphertext.slice(1) }, owner, guardianId, ownerId), null);
});

test("normalization does not accept arbitrary punctuation or joined guard envelopes", () => {
    const wire = { type: "key" as const, version: 2 as const, publicKey: "A".repeat(87) };
    const message = serializeWire(wire);
    assert.equal(parseGuardMessage(serializeWire({ ...wire, publicKey: "A".repeat(86) + "." })), null);
    assert.equal(parseGuardMessage(message + message), null);
});

test("messages are one short masked link with the data in its fragment", async () => {
    const owner = await pair();
    const guardian = await pair();
    const nonce = newGuardNonce();
    const wire = { type: "invite" as const, version: 3 as const, publicKey: await publicKeyString(owner), actions: ["mute" as const, "deafen" as const], nonce };
    const text = serializeWire(wire, inviteSummary(["deafen", "mute"]));
    assert.match(text, /^🛡️ \[Personal Guard invite: mute microphone, deafen\]\(<https:\/\/github\.com\/mPhpMaster\/FriendsInVoice#fiv-guard=[A-Za-z0-9_-]+>\)$/);
    assert.ok(text.length < 400);
    assert.deepEqual(parseGuardMessage(text), wire);
    assert.equal(isGuardMessage(text), true);

    // a command's visible text must not reveal the action
    const sealed = await sealGuardPayload(makeCommand(ownerId, "disconnect", nonce), guardian, await publicKeyString(owner), guardianId, ownerId);
    const command = serializeWire(sealed, "Personal Guard action");
    assert.ok(!/disconnect|mute|deafen/i.test(command));
    assert.ok(command.length < 1000);
    assert.equal(parseGuardMessage(command)?.type, "sealed");
    // spacing inserted into the long encoded word is ignored
    assert.equal(parseGuardMessage(command.replace(/(fiv-guard=.{40})/, "$1 \n"))?.type, "sealed");
});

test("messages from before the link format still parse", async () => {
    const owner = await pair();
    const legacy = "[FriendsInVoice Guard v2] " + JSON.stringify({ type: "invite", version: 3, publicKey: await publicKeyString(owner), actions: ["mute"], nonce: newGuardNonce() });
    assert.equal(parseGuardMessage(legacy)?.type, "invite");
    assert.equal(isGuardMessage(legacy), true);
});

test("plain mentions of the format and broken links are ignored", () => {
    assert.equal(isGuardMessage("I use [FriendsInVoice Guard v2] sometimes"), false);
    assert.equal(parseGuardMessage("[🛡️ hi](<https://github.com/mPhpMaster/FriendsInVoice#fiv-guard=not*base64>)"), null);
    assert.equal(parseGuardMessage("[🛡️ hi](<https://github.com/mPhpMaster/FriendsInVoice#fiv-guard=e30>)"), null);
    assert.equal(parseGuardMessage("x".repeat(3001)), null);
});
