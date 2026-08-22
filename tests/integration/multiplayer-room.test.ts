import assert from "node:assert/strict";
import test from "node:test";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { FAST_TEST_RULES } from "../../shared/game-rules";
import type { GameEffect, GameSnapshot, LobbyChatMessage } from "../../shared/game-types";
import { MAP_CATALOG } from "../../shared/map-generator";
import { createNunchisoomServer } from "../../server/index";

test("4개 실제 소켓이 기준 맵 비공개·포탈 이동과 전체 라운드 전이를 지킨다", { timeout: 15_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: { ...FAST_TEST_RULES, hidingMs: 5_000 },
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const clients = Array.from({ length: 4 }, () => new ColyseusSDK(`http://127.0.0.1:${port}`));
    for (let index = 0; index < clients.length; index += 1) {
      const joinedRoom = await clients[index].joinOrCreate("nunchisoom", {
        mode: "public",
        displayName: `검증자${index + 1}`,
        deviceId: `integration-device-${index + 1}`,
      });
      registerExpectedMessages(joinedRoom);
      rooms.push(joinedRoom);
    }

    assert.equal(new Set(rooms.map((room) => room.roomId)).size, 1);
    const roleRevealSnapshots = rooms.map((room) => waitForSnapshot(room, (state) => state.phase === "COUNTDOWN"));
    const hidingSnapshots = rooms.map((room) => waitForSnapshot(room, (state) => state.phase === "HIDING"));
    for (const room of rooms) room.send("ready", true);
    await waitForSnapshot(rooms[0], (state) => state.phase === "LOBBY" && state.canStart);
    rooms[0].send("start", true);
    const roleReveals = await Promise.all(roleRevealSnapshots);
    assert.equal(roleReveals.filter((state) => state.self.role === "SEEKER").length, 1);
    assert.equal(roleReveals.filter((state) => state.self.role === "HIDER").length, 3);
    assert.equal(roleReveals.every((state) => state.entities.every((entity) => !entity.controlled && !entity.teammate)), true);
    assert.equal(roleReveals.every((state) => state.roundPlayerCount === 4), true);
    assert.equal(roleReveals.every((state) => state.seekingDurationMs === 700), true);
    assert.equal(roleReveals.every((state) => state.roundDurationMs === 5_940), true);
    const snapshots = await Promise.all(hidingSnapshots);

    const seekerSnapshot = snapshots.find((state) => state.self.role === "SEEKER");
    const hiderSnapshot = snapshots.find((state) => state.self.role === "HIDER");
    assert.ok(seekerSnapshot);
    assert.ok(hiderSnapshot);
    assert.equal(seekerSnapshot.players.some((player) => player.revealedRole), false);
    assert.equal(seekerSnapshot.seekerPreview, true);
    assert.equal(seekerSnapshot.map.id, MAP_CATALOG[0].id);
    assert.ok(seekerSnapshot.map.portals.length >= 4);
    assert.ok(seekerSnapshot.entities.some((entity) => entity.category === "prop"));
    assert.equal(
      seekerSnapshot.entities
        .filter((entity) => entity.category === "prop")
        .every((entity) => !entity.controlled && !entity.teammate && !entity.moving),
      true,
    );
    assert.ok(seekerSnapshot.entities.some((entity) => entity.category === "seeker" && entity.controlled));
    assert.equal(hiderSnapshot.entities.filter((entity) => entity.controlled).length, 1);
    assert.ok(
      hiderSnapshot.entities.filter((entity) => entity.category === "prop").length >
      seekerSnapshot.entities.filter((entity) => entity.category === "prop").length,
    );

    const seekerRoomIndex = snapshots.findIndex((state) => state.self.role === "SEEKER");
    const previewSeeker = seekerSnapshot.entities.find((entity) => entity.category === "seeker" && entity.controlled);
    assert.ok(previewSeeker);
    let latestPreviewSeeker = previewSeeker;
    const previewTrace: string[] = [];
    const removePreviewTracker = rooms[seekerRoomIndex].onMessage<GameSnapshot>("state", (state) => {
      const entity = state.entities.find((candidate) => candidate.category === "seeker" && candidate.controlled);
      if (entity) {
        latestPreviewSeeker = entity;
        previewTrace.push(`${state.phase}@${state.serverTime}:${entity.x.toFixed(2)},${entity.y.toFixed(2)}`);
        if (previewTrace.length > 12) previewTrace.shift();
      }
    });
    rooms[seekerRoomIndex].send("move", { seq: 1, x: 1, y: 0 });
    let movedThroughPortal: GameSnapshot;
    try {
      movedThroughPortal = await waitForSnapshot(
        rooms[seekerRoomIndex],
        (state) => state.phase === "HIDING" && Boolean(state.entities.find(
          (entity) => entity.category === "seeker" && entity.controlled && entity.x > 20 && entity.y < 5,
        )),
        4_500,
      );
    } catch (error) {
      throw new Error(`포탈 진입 실패: 마지막 관찰자 좌표 (${latestPreviewSeeker.x.toFixed(2)}, ${latestPreviewSeeker.y.toFixed(2)}), 최근 상태 ${previewTrace.join(" | ")}`, { cause: error });
    } finally {
      removePreviewTracker();
    }
    rooms[seekerRoomIndex].send("move", { seq: 2, x: 0, y: 0 });
    assert.equal(movedThroughPortal.seekerPreview, true);

    const seekingSnapshot = await waitForSnapshot(
      rooms[seekerRoomIndex],
      (state) => state.phase === "SEEKING",
      7_000,
    );
    assert.equal(seekingSnapshot.seekerPreview, false);
    assert.equal(seekingSnapshot.entities.every((entity) => entity.id.startsWith("object-") || entity.category === "seeker"), true);
    assert.equal(seekingSnapshot.entities.filter((entity) => entity.category === "prop").every((entity) => !entity.controlled && !entity.teammate), true);
    assert.equal(seekingSnapshot.players.every((player) => player.score === 0), true);

    const controlledSeeker = seekingSnapshot.entities.find((entity) => entity.category === "seeker" && entity.controlled);
    assert.ok(controlledSeeker);
    rooms[seekerRoomIndex].send("move", { seq: 3, x: 1, y: 0 });
    const movedSnapshot = await waitForSnapshot(
      rooms[seekerRoomIndex],
      (state) => state.phase === "SEEKING" && Boolean(state.entities.find(
        (entity) => entity.category === "seeker" && entity.controlled && entity.x > controlledSeeker.x + 0.05,
      )),
      1_000,
    );
    rooms[seekerRoomIndex].send("move", { seq: 4, x: 0, y: 0 });
    assert.ok(movedSnapshot.version > seekingSnapshot.version);

    const final = await waitForSnapshot(rooms[0], (state) => state.phase === "FINAL", 6_000);
    assert.equal(final.round, 1);
    assert.equal(final.result?.winner, "HIDERS");
    assert.equal(final.players.every((player) => Boolean(player.revealedRole)), true);
    assert.equal(
      final.players
        .filter((player) => player.revealedRole === "HIDER")
        .every((player) => player.survivalScore === 80 && player.score >= 130),
      true,
    );
    assert.equal(runtime.store.count(), 1);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("세 라운드는 밤의 문구점, 달빛 물류창고, 별빛 포장공방 순서로 전환된다", { timeout: 15_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: {
      ...FAST_TEST_RULES,
      totalRounds: 3,
      countdownMs: 80,
      hidingMs: 180,
      seekingMs: 220,
      resultMs: 80,
    },
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const clients = Array.from({ length: 4 }, () => new ColyseusSDK(`http://127.0.0.1:${port}`));
    for (let index = 0; index < clients.length; index += 1) {
      const joinedRoom = await clients[index].joinOrCreate("nunchisoom", {
        mode: "public",
        displayName: `맵검증자${index + 1}`,
        deviceId: `map-rotation-device-${index + 1}`,
      });
      registerExpectedMessages(joinedRoom);
      rooms.push(joinedRoom);
    }

    const firstRound = waitForSnapshot(rooms[0], (state) => state.phase === "HIDING" && state.round === 1);
    for (const room of rooms) room.send("ready", true);
    await waitForSnapshot(rooms[0], (state) => state.phase === "LOBBY" && state.canStart);
    rooms[0].send("start", true);
    const first = await firstRound;
    const second = await waitForSnapshot(rooms[0], (state) => state.phase === "HIDING" && state.round === 2, 5_000);
    const third = await waitForSnapshot(rooms[0], (state) => state.phase === "HIDING" && state.round === 3, 5_000);
    const final = await waitForSnapshot(rooms[0], (state) => state.phase === "FINAL", 5_000);

    assert.deepEqual(
      [first.map.id, second.map.id, third.map.id],
      MAP_CATALOG.map((map) => map.id),
    );
    assert.equal(final.round, 3);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("초대방은 방 ID로 합류하고 공개 매칭에서는 제외된다", { timeout: 10_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: FAST_TEST_RULES,
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const hostClient = new ColyseusSDK(`http://127.0.0.1:${port}`);
    const friendClient = new ColyseusSDK(`http://127.0.0.1:${port}`);
    const publicClient = new ColyseusSDK(`http://127.0.0.1:${port}`);
    const hostRoom = await hostClient.create("nunchisoom", {
      mode: "invite",
      displayName: "초대방장",
      deviceId: "invite-host-device",
    });
    registerExpectedMessages(hostRoom);
    rooms.push(hostRoom);
    const friendRoom = await friendClient.joinById(hostRoom.roomId, {
      mode: "invite",
      displayName: "초대친구",
      deviceId: "invite-friend-device",
    });
    registerExpectedMessages(friendRoom);
    rooms.push(friendRoom);
    const publicRoom = await publicClient.joinOrCreate("nunchisoom", {
      mode: "public",
      displayName: "공개참가자",
      deviceId: "public-device-001",
    });
    registerExpectedMessages(publicRoom);
    rooms.push(publicRoom);

    assert.equal(friendRoom.roomId, hostRoom.roomId);
    assert.notEqual(publicRoom.roomId, hostRoom.roomId);
    const inviteSnapshot = await waitForSnapshot(hostRoom, (state) => state.players.length === 2);
    assert.equal(inviteSnapshot.mode, "invite");
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("방장은 10인 대기실에서 난이도별 AI를 추가하고 준비 후 직접 시작한다", { timeout: 10_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: FAST_TEST_RULES,
    greet: false,
  });
  let room: Room | undefined;
  try {
    const port = await runtime.listen(0);
    const client = new ColyseusSDK(`http://127.0.0.1:${port}`);
    room = await client.create("nunchisoom", {
      mode: "invite",
      displayName: "AI방장",
      deviceId: "manual-ai-host-device",
    });
    registerExpectedMessages(room);

    room.send("bot:add", { difficulty: "easy" });
    room.send("bot:add", { difficulty: "normal" });
    room.send("bot:add", { difficulty: "hard" });
    const lobby = await waitForSnapshot(room, (state) => (
      state.phase === "LOBBY" && state.players.length === 4 && state.players.filter((player) => player.bot).length === 3
    ));
    assert.equal(lobby.mode, "invite");
    assert.equal(lobby.maxPlayers, 10);
    assert.deepEqual(
      lobby.players
        .filter((player) => player.bot)
        .map((player) => player.aiDifficulty)
        .sort(),
      ["easy", "hard", "normal"],
    );

    room.send("ready", true);
    const readyLobby = await waitForSnapshot(room, (state) => state.phase === "LOBBY" && state.canStart);
    assert.equal(readyLobby.players.find((player) => player.id === readyLobby.self.playerId)?.ready, true);
    await assert.rejects(
      waitForSnapshot(room, (state) => state.phase === "COUNTDOWN", 250),
      /대기 시간이 250ms를 넘었습니다/,
    );

    const countdown = waitForSnapshot(room, (state) => state.phase === "COUNTDOWN");
    const hiding = waitForSnapshot(room, (state) => state.phase === "HIDING");
    room.send("start", true);
    const countdownSnapshot = await countdown;
    assert.equal(countdownSnapshot.roundPlayerCount, 4);
    const snapshot = await hiding;
    assert.ok(snapshot.self.role === "HIDER" || snapshot.self.role === "SEEKER");
    assert.equal(snapshot.self.movementSpeed, snapshot.self.role === "SEEKER" ? 9.5 : 6.5);
  } finally {
    if (room) await room.leave(true);
    await runtime.shutdown();
  }
});

test("AI는 자동으로 빠지지 않고 방장만 추가·삭제와 게임 시작을 관리한다", { timeout: 10_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: FAST_TEST_RULES,
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const hostClient = new ColyseusSDK(`http://127.0.0.1:${port}`);
    const friendClient = new ColyseusSDK(`http://127.0.0.1:${port}`);
    const hostRoom = await hostClient.create("nunchisoom", {
      mode: "invite",
      displayName: "AI방장",
      deviceId: "manual-ai-mixed-host",
    });
    registerExpectedMessages(hostRoom);
    rooms.push(hostRoom);

    hostRoom.send("bot:add", { difficulty: "easy" });
    hostRoom.send("bot:add", { difficulty: "normal" });
    hostRoom.send("bot:add", { difficulty: "hard" });
    await waitForSnapshot(hostRoom, (state) => state.players.length === 4 && state.players.filter((player) => player.bot).length === 3);

    const friendRoom = await friendClient.joinById(hostRoom.roomId, {
      mode: "invite",
      displayName: "초대친구",
      deviceId: "manual-ai-mixed-friend",
    });
    registerExpectedMessages(friendRoom);
    rooms.push(friendRoom);

    const joined = await waitForSnapshot(hostRoom, (state) => state.players.length === 5);
    assert.equal(joined.players.filter((player) => player.bot).length, 3);
    assert.equal(joined.players.filter((player) => !player.bot).length, 2);

    const addDenied = waitForActionError(friendRoom, (error) => error.title === "방장 권한 필요");
    friendRoom.send("bot:add", { difficulty: "hard" });
    await addDenied;
    const unchangedAfterAdd = await waitForSnapshot(hostRoom, (state) => state.players.length === 5);
    assert.equal(unchangedAfterAdd.players.filter((player) => player.bot).length, 3);

    const botId = unchangedAfterAdd.players.find((player) => player.bot)?.id;
    assert.ok(botId);
    const removeDenied = waitForActionError(friendRoom, (error) => error.title === "방장 권한 필요");
    friendRoom.send("bot:remove", { botId });
    await removeDenied;

    hostRoom.send("bot:remove", { botId });
    const removed = await waitForSnapshot(hostRoom, (state) => state.players.length === 4 && state.players.filter((player) => player.bot).length === 2);
    assert.equal(removed.maxPlayers, 10);

    hostRoom.send("ready", true);
    friendRoom.send("ready", true);
    await waitForSnapshot(hostRoom, (state) => state.phase === "LOBBY" && state.canStart);
    friendRoom.send("start", true);
    await assert.rejects(
      waitForSnapshot(friendRoom, (state) => state.phase === "COUNTDOWN", 250),
      /대기 시간이 250ms를 넘었습니다/,
    );

    hostRoom.send("bot:add", { difficulty: "hard" });
    const managedByHost = await waitForSnapshot(hostRoom, (state) => state.players.length === 5);
    assert.equal(managedByHost.players.filter((player) => player.bot).length, 3);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("빠른 매칭은 기존 공개 대기실을 우선 채우고 시작·정원 마감 방은 제외한다", { timeout: 15_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: { ...FAST_TEST_RULES, countdownMs: 30_000 },
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const endpoint = `http://127.0.0.1:${port}`;
    const roomA = await new ColyseusSDK(endpoint).create("nunchisoom", {
      mode: "public",
      displayName: "공개방A장",
      deviceId: "public-room-a-host",
    });
    const roomB = await new ColyseusSDK(endpoint).create("nunchisoom", {
      mode: "public",
      displayName: "공개방B장",
      deviceId: "public-room-b-host",
    });
    registerExpectedMessages(roomA);
    registerExpectedMessages(roomB);
    rooms.push(roomA, roomB);

    roomA.send("bot:add", { difficulty: "easy" });
    roomB.send("bot:add", { difficulty: "normal" });
    roomB.send("bot:add", { difficulty: "hard" });
    await waitForSnapshot(roomA, (state) => state.players.length === 2);
    await waitForSnapshot(roomB, (state) => state.players.length === 3);
    await delay(100);

    const quickOne = await new ColyseusSDK(endpoint).joinOrCreate("nunchisoom", {
      mode: "public",
      displayName: "빠른참가1",
      deviceId: "quick-match-device-1",
    });
    registerExpectedMessages(quickOne);
    rooms.push(quickOne);
    assert.equal(quickOne.roomId, roomB.roomId);
    await waitForSnapshot(roomB, (state) => state.players.length === 4);

    roomB.send("ready", true);
    quickOne.send("ready", true);
    await waitForSnapshot(roomB, (state) => state.phase === "LOBBY" && state.canStart);
    const started = waitForSnapshot(roomB, (state) => state.phase === "COUNTDOWN");
    roomB.send("start", true);
    await started;
    await delay(100);

    const quickTwo = await new ColyseusSDK(endpoint).joinOrCreate("nunchisoom", {
      mode: "public",
      displayName: "빠른참가2",
      deviceId: "quick-match-device-2",
    });
    registerExpectedMessages(quickTwo);
    rooms.push(quickTwo);
    assert.equal(quickTwo.roomId, roomA.roomId);
    await waitForSnapshot(roomA, (state) => state.players.length === 3);

    for (let index = 0; index < 7; index += 1) {
      roomA.send("bot:add", { difficulty: index % 2 === 0 ? "easy" : "normal" });
    }
    const full = await waitForSnapshot(roomA, (state) => state.players.length === 10);
    assert.equal(full.maxPlayers, 10);
    assert.equal(full.players.filter((player) => player.bot).length, 8);
    await delay(100);

    const quickThree = await new ColyseusSDK(endpoint).joinOrCreate("nunchisoom", {
      mode: "public",
      displayName: "빠른참가3",
      deviceId: "quick-match-device-3",
    });
    registerExpectedMessages(quickThree);
    rooms.push(quickThree);
    assert.notEqual(quickThree.roomId, roomA.roomId);
    assert.notEqual(quickThree.roomId, roomB.roomId);
    const newRoom = await waitForSnapshot(quickThree, (state) => state.players.length === 1);
    assert.equal(newRoom.maxPlayers, 10);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("연결이 끊긴 참가자가 있으면 시작을 막고 카운트다운을 대기실로 되돌린다", { timeout: 15_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: { ...FAST_TEST_RULES, countdownMs: 5_000 },
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const endpoint = `http://127.0.0.1:${port}`;
    const clients = Array.from({ length: 5 }, () => new ColyseusSDK(endpoint));
    const hostRoom = await clients[0].create("nunchisoom", {
      mode: "invite",
      displayName: "연결검증방장",
      deviceId: "disconnect-host-device",
    });
    registerExpectedMessages(hostRoom);
    rooms.push(hostRoom);
    for (let index = 1; index < clients.length; index += 1) {
      const room = await clients[index].joinById(hostRoom.roomId, {
        mode: "invite",
        displayName: `연결검증${index}`,
        deviceId: `disconnect-member-device-${index}`,
      });
      registerExpectedMessages(room);
      rooms.push(room);
    }

    for (const room of rooms) room.send("ready", true);
    await waitForSnapshot(hostRoom, (state) => state.phase === "LOBBY" && state.canStart);
    const droppedState = await waitForSnapshot(rooms[4], (state) => state.players.length === 5);
    const droppedPlayerId = droppedState.self.playerId;
    const firstDroppedRoom = rooms[4];
    const firstReconnectToken = firstDroppedRoom.reconnectionToken;
    forgetRoom(rooms, firstDroppedRoom);
    firstDroppedRoom.reconnection.enabled = false;
    await firstDroppedRoom.leave(false);

    const disconnectedLobby = await waitForSnapshot(hostRoom, (state) => (
      state.phase === "LOBBY"
      && !state.canStart
      && state.players.some((player) => player.id === droppedPlayerId && !player.connected && player.status === "waiting")
    ));
    assert.equal(disconnectedLobby.roundPlayerCount, 4);
    const reconnectRequired = waitForActionError(hostRoom, (error) => error.title === "재연결 대기");
    hostRoom.send("start", true);
    await reconnectRequired;

    const firstReconnectedRoom = await clients[4].reconnect(firstReconnectToken);
    registerExpectedMessages(firstReconnectedRoom);
    rooms.push(firstReconnectedRoom);
    await waitForSnapshot(hostRoom, (state) => (
      state.phase === "LOBBY"
      && state.canStart
      && state.players.every((player) => player.bot || player.connected)
    ));

    const countdown = waitForSnapshot(hostRoom, (state) => state.phase === "COUNTDOWN" && state.round === 1);
    hostRoom.send("start", true);
    await countdown;
    const secondDroppedRoom = rooms[3];
    const secondState = await waitForSnapshot(secondDroppedRoom, (state) => state.phase === "COUNTDOWN");
    const secondDroppedPlayerId = secondState.self.playerId;
    const secondReconnectToken = secondDroppedRoom.reconnectionToken;
    forgetRoom(rooms, secondDroppedRoom);
    secondDroppedRoom.reconnection.enabled = false;
    await secondDroppedRoom.leave(false);
    const cancelled = await waitForSnapshot(hostRoom, (state) => (
      state.phase === "LOBBY"
      && state.round === 0
      && state.players.some((player) => player.id === secondDroppedPlayerId && player.status === "waiting")
    ));
    assert.equal(cancelled.canStart, false);

    const secondReconnectedRoom = await clients[3].reconnect(secondReconnectToken);
    registerExpectedMessages(secondReconnectedRoom);
    rooms.push(secondReconnectedRoom);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("공개방 방장 연결이 끊기면 매칭을 잠그고 재연결·만료 뒤 목록과 방장을 복구한다", { timeout: 20_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: FAST_TEST_RULES,
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const endpoint = `http://127.0.0.1:${port}`;
    const hostClient = new ColyseusSDK(endpoint);
    const hostRoom = await hostClient.create("nunchisoom", {
      mode: "public",
      displayName: "재연결방장",
      deviceId: "public-reconnect-host",
    });
    registerExpectedMessages(hostRoom);
    rooms.push(hostRoom);
    const friendRoom = await new ColyseusSDK(endpoint).joinById(hostRoom.roomId, {
      mode: "public",
      displayName: "재연결친구",
      deviceId: "public-reconnect-friend",
    });
    registerExpectedMessages(friendRoom);
    rooms.push(friendRoom);
    const joined = await waitForSnapshot(friendRoom, (state) => state.players.length === 2);
    const hostPlayerId = joined.players.find((player) => player.host)?.id;
    assert.ok(hostPlayerId);

    const reconnectToken = hostRoom.reconnectionToken;
    forgetRoom(rooms, hostRoom);
    hostRoom.reconnection.enabled = false;
    await hostRoom.leave(false);
    await waitForSnapshot(friendRoom, (state) => state.players.some((player) => (
      player.id === hostPlayerId && !player.connected && player.status === "waiting"
    )));
    await delay(100);

    const lockedOutRoom = await new ColyseusSDK(endpoint).joinOrCreate("nunchisoom", {
      mode: "public",
      displayName: "잠금중빠른참가",
      deviceId: "public-locked-quick-match",
    });
    registerExpectedMessages(lockedOutRoom);
    rooms.push(lockedOutRoom);
    assert.notEqual(lockedOutRoom.roomId, hostRoom.roomId);

    const reconnectedHostRoom = await hostClient.reconnect(reconnectToken);
    registerExpectedMessages(reconnectedHostRoom);
    rooms.push(reconnectedHostRoom);
    await waitForSnapshot(friendRoom, (state) => state.players.some((player) => (
      player.id === hostPlayerId && player.connected && player.host
    )));
    await delay(100);

    const reopenedQuickRoom = await new ColyseusSDK(endpoint).joinOrCreate("nunchisoom", {
      mode: "public",
      displayName: "재개후빠른참가",
      deviceId: "public-reopened-quick-match",
    });
    registerExpectedMessages(reopenedQuickRoom);
    rooms.push(reopenedQuickRoom);
    assert.equal(reopenedQuickRoom.roomId, hostRoom.roomId);

    forgetRoom(rooms, reconnectedHostRoom);
    reconnectedHostRoom.reconnection.enabled = false;
    await reconnectedHostRoom.leave(false);
    const migrated = await waitForSnapshot(friendRoom, (state) => (
      state.players.length === 2
      && state.players.some((player) => player.id === state.self.playerId && player.host)
    ), 12_000);
    assert.equal(migrated.players.find((player) => player.host)?.id, migrated.self.playerId);
    await delay(100);

    const migratedQuickRoom = await new ColyseusSDK(endpoint).joinOrCreate("nunchisoom", {
      mode: "public",
      displayName: "방장이전후참가",
      deviceId: "public-migrated-quick-match",
    });
    registerExpectedMessages(migratedQuickRoom);
    rooms.push(migratedQuickRoom);
    assert.equal(migratedQuickRoom.roomId, hostRoom.roomId);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("방장이 없는 동안 남은 참가자가 재연결하면 새 방장으로 선출된다", { timeout: 10_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: FAST_TEST_RULES,
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const endpoint = `http://127.0.0.1:${port}`;
    const hostRoom = await new ColyseusSDK(endpoint).create("nunchisoom", {
      mode: "invite",
      displayName: "빈방장검증",
      deviceId: "empty-host-owner-device",
    });
    registerExpectedMessages(hostRoom);
    rooms.push(hostRoom);
    const friendClient = new ColyseusSDK(endpoint);
    const friendRoom = await friendClient.joinById(hostRoom.roomId, {
      mode: "invite",
      displayName: "재연결후보",
      deviceId: "empty-host-friend-device",
    });
    registerExpectedMessages(friendRoom);
    rooms.push(friendRoom);
    await waitForSnapshot(hostRoom, (state) => state.players.length === 2);

    const friendReconnectToken = friendRoom.reconnectionToken;
    forgetRoom(rooms, friendRoom);
    friendRoom.reconnection.enabled = false;
    await friendRoom.leave(false);
    await waitForSnapshot(hostRoom, (state) => state.players.some((player) => (
      player.id !== state.self.playerId && !player.connected
    )));
    forgetRoom(rooms, hostRoom);
    await hostRoom.leave(true);

    const reconnectedFriendRoom = await friendClient.reconnect(friendReconnectToken);
    registerExpectedMessages(reconnectedFriendRoom);
    rooms.push(reconnectedFriendRoom);
    const elected = await waitForSnapshot(reconnectedFriendRoom, (state) => (
      state.players.length === 1
      && state.players.some((player) => player.id === state.self.playerId && player.host && player.connected)
    ));
    assert.equal(elected.players[0].id, elected.self.playerId);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("대기실 채팅은 서버 발신자를 사용하고 동기화·도배·경기 단계 제한을 지킨다", { timeout: 12_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: FAST_TEST_RULES,
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const endpoint = `http://127.0.0.1:${port}`;
    const hostRoom = await new ColyseusSDK(endpoint).create("nunchisoom", {
      mode: "invite",
      displayName: "채팅방장",
      deviceId: "chat-host-device",
    });
    registerExpectedMessages(hostRoom);
    rooms.push(hostRoom);
    const friendRoom = await new ColyseusSDK(endpoint).joinById(hostRoom.roomId, {
      mode: "invite",
      displayName: "채팅친구",
      deviceId: "chat-friend-device",
    });
    registerExpectedMessages(friendRoom);
    rooms.push(friendRoom);

    const friendState = await waitForSnapshot(friendRoom, (state) => state.players.length === 2);
    const hostMessagePromise = waitForChatMessage(hostRoom, (message) => message.text === "안녕 방장님");
    const friendMessagePromise = waitForChatMessage(friendRoom, (message) => message.text === "안녕 방장님");
    friendRoom.send("chat:send", {
      text: "  안녕   방장님  ",
      playerId: friendState.players.find((player) => player.host)?.id,
      displayName: "가짜방장",
    });
    const [hostMessage, friendMessage] = await Promise.all([hostMessagePromise, friendMessagePromise]);
    assert.equal(hostMessage.id, friendMessage.id);
    assert.equal(hostMessage.playerId, friendState.self.playerId);
    assert.equal(hostMessage.displayName, "채팅친구");

    const historyPromise = waitForChatHistory(hostRoom, (messages) => messages.some((message) => message.id === hostMessage.id));
    hostRoom.send("chat:sync", true);
    const history = await historyPromise;
    assert.equal(history.at(-1)?.text, "안녕 방장님");

    const maxLengthText = "가".repeat(120);
    const maxLengthMessage = waitForChatMessage(hostRoom, (message) => message.text === maxLengthText);
    hostRoom.send("chat:send", { text: maxLengthText });
    assert.equal((await maxLengthMessage).text.length, 120);

    const rateLimited = waitForActionError(friendRoom, (error) => error.title === "잠시만 기다려 주세요");
    friendRoom.send("chat:send", { text: "너무 빠른 두 번째 메시지" });
    await rateLimited;

    hostRoom.send("bot:add", { difficulty: "easy" });
    hostRoom.send("bot:add", { difficulty: "normal" });
    await waitForSnapshot(hostRoom, (state) => state.players.length === 4);
    hostRoom.send("ready", true);
    friendRoom.send("ready", true);
    await waitForSnapshot(hostRoom, (state) => state.phase === "LOBBY" && state.canStart);

    const chatCleared = waitForRoomMessage<true>(friendRoom, "chat:clear", (cleared) => cleared === true);
    const countdown = waitForSnapshot(hostRoom, (state) => state.phase === "COUNTDOWN");
    hostRoom.send("start", true);
    await Promise.all([chatCleared, countdown]);

    const phaseDenied = waitForActionError(friendRoom, (error) => error.title === "대기실 채팅");
    friendRoom.send("chat:send", { text: "경기 중에는 보낼 수 없음" });
    await phaseDenied;
    const emptyHistoryPromise = waitForChatHistory(friendRoom, (messages) => messages.length === 0);
    friendRoom.send("chat:sync", true);
    assert.deepEqual(await emptyHistoryPromise, []);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("세 라운드 혼합 방은 술래를 연속 배정하지 않고 AI 술래도 순찰한다", { timeout: 15_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: {
      ...FAST_TEST_RULES,
      totalRounds: 3,
      countdownMs: 80,
      hidingMs: 700,
      seekingMs: 500,
      resultMs: 80,
    },
    greet: false,
  });
  let room: Room | undefined;
  try {
    const port = await runtime.listen(0);
    const client = new ColyseusSDK(`http://127.0.0.1:${port}`);
    room = await client.create("nunchisoom", {
      mode: "invite",
      displayName: "역할검증자",
      deviceId: "mixed-role-rotation",
    });
    registerExpectedMessages(room);
    room.send("bot:add", { difficulty: "hard" });
    room.send("bot:add", { difficulty: "hard" });
    room.send("bot:add", { difficulty: "hard" });
    await waitForSnapshot(room, (state) => state.players.length === 4 && state.players.filter((player) => player.bot).length === 3);
    room.send("ready", true);
    await waitForSnapshot(room, (state) => state.phase === "LOBBY" && state.canStart);
    room.send("start", true);

    const seekerNames: string[] = [];
    let aiSeekerMoved = false;
    for (let round = 1; round <= 3; round += 1) {
      const hiding = await waitForSnapshot(room, (state) => state.phase === "HIDING" && state.round === round, 5_000);
      const seeker = hiding.entities.find((entity) => entity.category === "seeker");
      assert.ok(seeker?.displayName);
      seekerNames.push(seeker.displayName);

      if (!seeker.controlled) {
        const moved = await waitForSnapshot(room, (state) => {
          if (state.phase !== "HIDING" || state.round !== round) return false;
          const current = state.entities.find((entity) => entity.id === seeker.id);
          return Boolean(current && Math.hypot(current.x - seeker.x, current.y - seeker.y) > 0.05);
        }, 1_500);
        aiSeekerMoved ||= moved.entities.some((entity) => entity.id === seeker.id);
      }

      const result = await waitForSnapshot(room, (state) => state.phase === "RESULT" && state.round === round, 5_000);
      assert.equal(
        result.players
          .filter((player) => player.revealedRole === "HIDER")
          .every((player) => [20, 40, 60, 80].includes(player.survivalScore ?? -1)),
        true,
      );
    }
    await waitForSnapshot(room, (state) => state.phase === "FINAL", 5_000);
    assert.equal(new Set(seekerNames).size, 3);
    assert.notEqual(seekerNames[0], seekerNames[1]);
    assert.notEqual(seekerNames[1], seekerNames[2]);
    assert.equal(aiSeekerMoved, true);
  } finally {
    if (room) await room.leave(true);
    await runtime.shutdown();
  }
});

test("위치 고정은 이동 heartbeat를 막고 전역 자리바꿈은 술래에게 좌표를 숨긴다", { timeout: 15_000 }, async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [],
    databasePath: ":memory:",
    rules: {
      ...FAST_TEST_RULES,
      countdownMs: 80,
      hidingMs: 3_000,
      seekingMs: 1_500,
      resultMs: 80,
    },
    greet: false,
  });
  const rooms: Room[] = [];
  try {
    const port = await runtime.listen(0);
    const clients = Array.from({ length: 4 }, () => new ColyseusSDK(`http://127.0.0.1:${port}`));
    for (let index = 0; index < clients.length; index += 1) {
      const joinedRoom = await clients[index].joinOrCreate("nunchisoom", {
        mode: "public",
        displayName: `고정검증자${index + 1}`,
        deviceId: `lock-swap-device-${index + 1}`,
      });
      registerExpectedMessages(joinedRoom);
      rooms.push(joinedRoom);
    }

    const hidingPromises = rooms.map((room) => waitForSnapshot(room, (state) => state.phase === "HIDING"));
    for (const room of rooms) room.send("ready", true);
    await waitForSnapshot(rooms[0], (state) => state.phase === "LOBBY" && state.canStart);
    rooms[0].send("start", true);
    const hidingStates = await Promise.all(hidingPromises);
    const hiderIndex = hidingStates.findIndex((state) => state.self.role === "HIDER");
    const seekerIndex = hidingStates.findIndex((state) => state.self.role === "SEEKER");
    assert.ok(hiderIndex >= 0);
    assert.ok(seekerIndex >= 0);
    const hiderRoom = rooms[hiderIndex];
    const seekerRoom = rooms[seekerIndex];

    const lockedPromise = waitForSnapshot(hiderRoom, (state) => state.phase === "HIDING" && state.self.locked);
    hiderRoom.send("lock", true);
    const locked = await lockedPromise;
    const lockedEntity = locked.entities.find((entity) => entity.controlled);
    assert.ok(lockedEntity);

    hiderRoom.send("move", { seq: 1, x: 1, y: 1 });
    const afterHeartbeat = await waitForSnapshot(
      hiderRoom,
      (state) => state.phase === "HIDING" && state.self.locked && state.serverTime >= locked.serverTime + 220,
    );
    const heldEntity = afterHeartbeat.entities.find((entity) => entity.controlled);
    assert.ok(heldEntity);
    assert.ok(Math.hypot(heldEntity.x - lockedEntity.x, heldEntity.y - lockedEntity.y) < 0.001);

    const seeking = await waitForSnapshot(hiderRoom, (state) => state.phase === "SEEKING");
    const beforeSwap = seeking.entities.find((entity) => entity.controlled);
    assert.ok(beforeSwap);
    assert.equal(seeking.self.locked, true);
    const seekerBeforeSwap = await waitForSnapshot(seekerRoom, (state) => state.phase === "SEEKING");

    const hiderEffectPromise = waitForEffect(hiderRoom, (effect) => effect.type === "swap");
    const seekerEffectPromise = waitForEffect(seekerRoom, (effect) => effect.type === "swap");
    const swappedPromise = waitForSnapshot(
      hiderRoom,
      (state) => state.phase === "SEEKING" && !state.self.swapAvailable && Boolean(
        state.entities.find((entity) => entity.controlled && entity.teleportRevision > beforeSwap.teleportRevision),
      ),
    );
    hiderRoom.send("swap", true);
    const [swapped, hiderEffect, seekerEffect] = await Promise.all([
      swappedPromise,
      hiderEffectPromise,
      seekerEffectPromise,
    ]);
    const swappedEntity = swapped.entities.find((entity) => entity.controlled);
    assert.ok(swappedEntity);
    assert.ok(Math.hypot(swappedEntity.x - beforeSwap.x, swappedEntity.y - beforeSwap.y) > 0.1);
    assert.notEqual(swappedEntity.id, beforeSwap.id);
    assert.equal(typeof hiderEffect.x, "number");
    assert.equal(typeof hiderEffect.y, "number");
    assert.equal(seekerEffect.x, undefined);
    assert.equal(seekerEffect.y, undefined);
    const seekerAfterSwap = await waitForSnapshot(
      seekerRoom,
      (state) => state.phase === "SEEKING" && state.serverTime >= swapped.serverTime,
    );
    assert.equal(
      seekerAfterSwap.entities
        .filter((entity) => entity.category === "prop")
        .every((entity) => entity.teleportRevision === 0),
      true,
    );
    for (const stableId of [beforeSwap.id, swappedEntity.id]) {
      const beforeEntity = seekerBeforeSwap.entities.find((entity) => entity.id === stableId);
      const afterEntity = seekerAfterSwap.entities.find((entity) => entity.id === stableId);
      assert.ok(beforeEntity);
      assert.ok(afterEntity);
      assert.ok(Math.hypot(afterEntity.x - beforeEntity.x, afterEntity.y - beforeEntity.y) < 0.001);
    }
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

function registerExpectedMessages(room: Room): void {
  room.onMessage<GameSnapshot>("state", () => {});
  for (const type of ["notice", "effect", "lens", "ping", "action-error", "chat:message", "chat:history", "chat:clear"]) {
    room.onMessage(type, () => {});
  }
}

interface ActionErrorMessage {
  id: string;
  title: string;
  label: string;
}

function waitForActionError(
  room: Room,
  predicate: (error: ActionErrorMessage) => boolean,
  timeoutMs = 5_000,
): Promise<ActionErrorMessage> {
  return waitForRoomMessage(room, "action-error", predicate, timeoutMs);
}

function waitForChatMessage(
  room: Room,
  predicate: (message: LobbyChatMessage) => boolean,
  timeoutMs = 5_000,
): Promise<LobbyChatMessage> {
  return waitForRoomMessage(room, "chat:message", predicate, timeoutMs);
}

function waitForChatHistory(
  room: Room,
  predicate: (messages: LobbyChatMessage[]) => boolean,
  timeoutMs = 5_000,
): Promise<LobbyChatMessage[]> {
  return waitForRoomMessage<{ messages: LobbyChatMessage[] }>(
    room,
    "chat:history",
    (history) => predicate(history.messages),
    timeoutMs,
  ).then((history) => history.messages);
}

function waitForRoomMessage<T>(
  room: Room,
  type: string,
  predicate: (message: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let removeListener: () => void = () => {};
    const timer = setTimeout(() => {
      removeListener();
      reject(new Error(`${type} 메시지 대기 시간이 ${timeoutMs}ms를 넘었습니다.`));
    }, timeoutMs);
    removeListener = room.onMessage<T>(type, (message) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      removeListener();
      resolve(message);
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function forgetRoom(rooms: Room[], room: Room): void {
  const index = rooms.indexOf(room);
  if (index >= 0) rooms.splice(index, 1);
}

function waitForSnapshot(
  room: Room,
  predicate: (snapshot: GameSnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<GameSnapshot> {
  return new Promise((resolve, reject) => {
    let removeListener: () => void = () => {};
    const timer = setTimeout(() => {
      removeListener();
      reject(new Error(`상태 대기 시간이 ${timeoutMs}ms를 넘었습니다.`));
    }, timeoutMs);
    removeListener = room.onMessage<GameSnapshot>("state", (snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      removeListener();
      resolve(snapshot);
    });
  });
}

function waitForEffect(
  room: Room,
  predicate: (effect: GameEffect) => boolean,
  timeoutMs = 5_000,
): Promise<GameEffect> {
  return new Promise((resolve, reject) => {
    let removeListener: () => void = () => {};
    const timer = setTimeout(() => {
      removeListener();
      reject(new Error(`효과 대기 시간이 ${timeoutMs}ms를 넘었습니다.`));
    }, timeoutMs);
    removeListener = room.onMessage<GameEffect>("effect", (effect) => {
      if (!predicate(effect)) return;
      clearTimeout(timer);
      removeListener();
      resolve(effect);
    });
  });
}
