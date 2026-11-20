import assert from "node:assert/strict";
import { test } from "node:test";

import { ownerSetupMessage, ownerSetupStep } from "../friendsInVoice/personalGuardsOnboarding";

test("owner chooses actions before inviting a guardian", () => {
    assert.equal(ownerSetupStep([]), "choose");
    assert.equal(ownerSetupStep(["mute"]), "invite");
    assert.equal(ownerSetupStep(["mute"], false, true), "waiting");
    assert.equal(ownerSetupStep(["mute"], true), "active");
});

test("each setup state gives a concrete next step", () => {
    assert.match(ownerSetupMessage("choose"), /Choose the actions/);
    assert.match(ownerSetupMessage("invite"), /invite code/);
    assert.match(ownerSetupMessage("waiting"), /10 minutes/);
});
