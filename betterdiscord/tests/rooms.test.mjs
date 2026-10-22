import assert from "node:assert/strict";
import { test } from "node:test";

import { DiscordBridge } from "../src/discord.js";

const me = "111111111111111111";
const friend = "222222222222222222";
const guild = "333333333333333333";
const open = "444444444444444444";
const hidden = "555555555555555555";
const full = "666666666666666666";
const VIEW_CHANNEL = 1n << 10n;

function bridge({ canView = () => true, moveMembers = false } = {}) {
    const channels = {
        [open]: { id: open, guild_id: guild, name: "Open", isDM: () => false },
        [hidden]: { id: hidden, guild_id: guild, name: "___hidden___", isDM: () => false },
        [full]: { id: full, guild_id: guild, name: "Full", userLimit: 1, isDM: () => false }
    };
    // Discord's shape: { [guildId | "@me"]: { [userId]: VoiceState } }
    const voiceStates = { [guild]: { [friend]: { userId: friend, channelId: open } } };
    const stores = {
        UserStore: { getCurrentUser: () => ({ id: me }), getUser: id => ({ id, username: `user-${id}` }) },
        ChannelStore: { getChannel: id => channels[id] },
        VoiceStateStore: {
            getAllVoiceStates: () => voiceStates,
            getVoiceStateForUser: id => Object.values(voiceStates).map(states => states[id]).find(Boolean),
            getVoiceStatesForChannel: id => Object.fromEntries(Object.values(voiceStates).flatMap(Object.entries).filter(([, state]) => state.channelId === id))
        },
        RelationshipStore: { getFriendIDs: () => [friend], getNickname: () => null },
        PermissionStore: { can: (permission, channel) => permission === VIEW_CHANNEL ? canView(channel) : permission !== 1n << 24n || moveMembers },
        GuildStore: { getGuild: id => id === guild ? { id, name: "Guild" } : undefined }
    };
    const api = { Webpack: { getStore: name => stores[name], getByKeys: (...keys) => keys.includes("subscribe") ? { subscribe() {}, unsubscribe() {}, dispatch() {} } : null } };
    return { bridge: new DiscordBridge(api), voiceStates };
}

test("rooms are grouped by each voice state's channel, not by the guild key", () => {
    const { bridge: b } = bridge();
    const rooms = b.rooms([]);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].channelId, open);
    assert.deepEqual(rooms[0].members.map(member => member.id), [friend]);
    assert.equal(rooms[0].blocker, null);
});

test("rooms in channels the user can't view are shown as a locked private channel", () => {
    const { bridge: b, voiceStates } = bridge({ canView: channel => channel.id !== hidden });
    voiceStates[guild][friend].channelId = hidden;
    const [room] = b.rooms([]);
    assert.equal(room.roomName, "Private channel");
    assert.equal(room.blocker, "Locked");
    assert.equal(b.voiceChannel(friend), hidden);
});

test("a room at its user limit is Full unless the user has Move Members", () => {
    const { bridge: b, voiceStates } = bridge();
    voiceStates[guild][friend].channelId = full;
    assert.equal(b.rooms([])[0].blocker, "Full");
    assert.equal(bridge({ moveMembers: true }).bridge.joinBlocker({ id: full, guild_id: guild, userLimit: 1 }), null);
});

test("hidden people don't bring a room into the list or show up in one", () => {
    const { bridge: b, voiceStates } = bridge();
    assert.equal(b.rooms([], [friend]).length, 0);
    const other = "777777777777777777";
    voiceStates[guild][other] = { userId: other, channelId: open };
    const [room] = b.rooms([other], [friend]);
    assert.deepEqual(room.members.map(member => member.id), [other]);
    assert.equal(room.hiddenCount, 1);
});
