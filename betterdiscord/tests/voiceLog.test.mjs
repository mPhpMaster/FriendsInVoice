import assert from "node:assert/strict";
import { test } from "node:test";

import { VoiceLog } from "../src/voiceLog.js";

const me = "111111111111111111";
const friend = "222222222222222222";
const stranger = "333333333333333333";
const hiddenUser = "444444444444444444";
const guild = "555555555555555555";
const lobby = "666666666666666666";
const games = "777777777777777777";

const watched = "888888888888888888";

function setup({ saved = null } = {}) {
    const stored = { voiceLog: saved };
    const api = { Data: { load: key => stored[key], save: (key, value) => { stored[key] = value; } } };
    const channels = { [lobby]: { id: lobby, guild_id: guild, name: "Lobby" }, [games]: { id: games, guild_id: guild, name: "Games" } };
    let myRoom = lobby;
    const bridge = {
        voiceStore: { getAllVoiceStates: () => ({ [guild]: { [me]: { userId: me, channelId: lobby }, [friend]: { userId: friend, channelId: games } } }) },
        relationshipStore: { isFriend: id => id === friend, getMutableRelationships: () => new Map([[friend, 1]]) },
        guildStore: { getGuild: id => id === guild ? { id, name: "Guild" } : undefined, getGuilds: () => ({ [guild]: {} }) },
        currentId: () => me,
        myVoiceChannel: () => myRoom,
        channel: id => channels[id],
        name: id => `name-${id}`,
        roomDescription: channel => ({ place: "Guild", roomName: channel.name, guildId: channel.guild_id })
    };
    const log = new VoiceLog(bridge, { value: { hidden: [hiddenUser], watchlist: [watched] } }, api);
    log.quietUntil = 0;
    log.seed();
    return { log, stored, bridge, setMyRoom: id => { myRoom = id; } };
}

test("logs joins, moves and leaves with room and server names", () => {
    const { log } = setup();
    log.onUpdates([{ userId: friend, guildId: guild, channelId: lobby }]);
    log.onUpdates([{ userId: friend, guildId: guild, channelId: null }]);
    const [left, moved] = log.entries;
    assert.equal(moved.kind, "move");
    assert.equal(moved.from.roomName, "Games");
    assert.equal(moved.to.roomName, "Lobby");
    assert.equal(moved.myRoom, true);
    assert.equal(moved.isFriend, true);
    assert.equal(left.kind, "leave");
    assert.equal(left.from.place, "Guild");
    assert.equal(left.myRoom, true);
});

test("people joining or leaving my room are marked, even if they aren't friends", () => {
    const { log } = setup();
    log.onUpdates([{ userId: stranger, guildId: guild, channelId: lobby }]);
    assert.equal(log.entries[0].kind, "join");
    assert.equal(log.entries[0].myRoom, true);
    assert.equal(log.entries[0].isFriend, false);
});

test("my own moves use the previous room even when Discord repeats the channel as oldChannelId", () => {
    const { log, setMyRoom } = setup();
    setMyRoom(games);
    log.onUpdates([{ userId: me, guildId: guild, channelId: games, oldChannelId: games }]);
    assert.equal(log.entries[0].kind, "move");
    assert.equal(log.entries[0].isMe, true);
    assert.equal(log.entries[0].from.roomName, "Lobby");
});

test("hidden people, repeated states and the reconnect burst aren't logged", () => {
    const { log } = setup();
    log.onUpdates([{ userId: hiddenUser, guildId: guild, channelId: lobby }]);
    log.onUpdates([{ userId: friend, guildId: guild, channelId: games }]);
    log.reconnect();
    log.onUpdates([{ userId: stranger, guildId: guild, channelId: games }]);
    log.stop();
    assert.equal(log.entries.length, 0);
});

test("strangers outside my room aren't logged, My list people are", () => {
    const { log } = setup();
    log.onUpdates([{ userId: stranger, guildId: guild, channelId: games }]);
    log.onUpdates([{ userId: watched, guildId: guild, channelId: games }]);
    assert.deepEqual(log.entries.map(entry => entry.userId), [watched]);
});

test("the log is saved and loaded back after a restart", () => {
    const first = setup();
    first.log.onUpdates([{ userId: friend, guildId: guild, channelId: null }]);
    first.log.flush();
    assert.equal(first.stored.voiceLog.length, 1);
    const second = setup({ saved: first.stored.voiceLog });
    assert.equal(second.log.entries[0].kind, "leave");
    second.log.onUpdates([{ userId: friend, guildId: guild, channelId: lobby }]);
    assert.equal(second.log.entries[0].key > second.log.entries[1].key, true);
    second.log.stop();
});

test("friend requests, new friends, lost friends and lost servers are logged", () => {
    const { log, bridge } = setup();
    log.onRelationshipAdd({ id: stranger, type: 3 });
    log.onRelationshipAdd({ id: stranger, type: 1 });
    log.onRelationshipRemove({ id: friend, type: 1 });
    log.onGuildDelete({ id: guild, unavailable: true });
    bridge.guildStore.getGuild = () => undefined; // already gone from the store, so the cached name is used
    log.onGuildDelete({ id: guild });
    log.stop();
    assert.deepEqual(log.entries.map(entry => entry.kind), ["server-removed", "friend-removed", "friend-added", "friend-request"]);
    assert.equal(log.entries[0].from.place, "Guild");
});
