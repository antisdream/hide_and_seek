import assert from "node:assert/strict";
import test from "node:test";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { FAST_TEST_RULES } from "../../shared/game-rules";
import type { GameSnapshot } from "../../shared/game-types";
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

test("AI 방은 선택한 난이도로 한 명과 AI 세 명이 함께 시작한다", { timeout: 10_000 }, async () => {
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
      mode: "practice",
      aiDifficulty: "hard",
      displayName: "연습자",
      deviceId: "practice-device-001",
    });
    registerExpectedMessages(room);
    const hiding = waitForSnapshot(room, (state) => state.phase === "HIDING");
    room.send("ready", true);
    const snapshot = await hiding;
    assert.equal(snapshot.mode, "practice");
    assert.equal(snapshot.players.length, 4);
    assert.equal(snapshot.maxPlayers, 4);
    assert.equal(snapshot.players.filter((player) => player.bot).length, 3);
    assert.equal(snapshot.aiDifficulty, "hard");
    assert.ok(snapshot.self.role === "HIDER" || snapshot.self.role === "SEEKER");
    assert.equal(snapshot.self.movementSpeed, snapshot.self.role === "SEEKER" ? 9.5 : 6.5);
  } finally {
    if (room) await room.leave(true);
    await runtime.shutdown();
  }
});

test("AI 방에 친구가 합류하면 AI 한 명이 빠져 네 자리를 유지한다", { timeout: 10_000 }, async () => {
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
      mode: "practice",
      aiDifficulty: "normal",
      displayName: "AI방장",
      deviceId: "practice-mixed-host",
    });
    registerExpectedMessages(hostRoom);
    rooms.push(hostRoom);
    const friendRoom = await friendClient.joinById(hostRoom.roomId, {
      mode: "invite",
      displayName: "초대친구",
      deviceId: "practice-mixed-friend",
    });
    registerExpectedMessages(friendRoom);
    rooms.push(friendRoom);

    const snapshot = await waitForSnapshot(hostRoom, (state) => (
      state.players.length === 4 && state.players.filter((player) => player.bot).length === 2
    ));
    assert.equal(snapshot.mode, "practice");
    assert.equal(snapshot.players.filter((player) => !player.bot).length, 2);
    assert.equal(snapshot.aiDifficulty, "normal");
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  }
});

test("세 라운드 AI 방은 관찰자를 연속 배정하지 않고 AI 관찰자도 순찰한다", { timeout: 15_000 }, async () => {
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
      mode: "practice",
      aiDifficulty: "hard",
      displayName: "역할검증자",
      deviceId: "practice-role-rotation",
    });
    registerExpectedMessages(room);
    room.send("ready", true);

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

function registerExpectedMessages(room: Room): void {
  room.onMessage<GameSnapshot>("state", () => {});
  for (const type of ["notice", "effect", "lens", "ping", "action-error"]) {
    room.onMessage(type, () => {});
  }
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
