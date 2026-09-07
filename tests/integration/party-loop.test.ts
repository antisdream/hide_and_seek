import assert from "node:assert/strict";
import test from "node:test";
import { matchMaker, type Client } from "@colyseus/core";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { createNunchisoomServer } from "../../server/index";
import { FAST_TEST_RULES } from "../../shared/game-rules";
import { TAUNT_RULES } from "../../shared/party-rules";
import { MAX_MOVEMENT_DELTA_MS } from "../../shared/geometry";
import type { GameEffect, GameSnapshot, MoveMessage } from "../../shared/game-types";

// 재현 가능한 미션/포획 배치를 위해 이 테스트가 만든 메모리 방만 조정한다.
// 클라이언트 이동 E2E는 multiplayer-room.test.ts의 기존 포탈·정지·고정 테스트가 담당한다.
interface TestPlayer {
  x: number; y: number; role: string; entityId: string; locked: boolean;
  mission?: { zoneId: string; completed: boolean; progressMs: number };
}
interface TestRoom { players: Map<string, TestPlayer> }

function observe(room: Room) {
  let state: GameSnapshot | undefined;
  const effects: GameEffect[] = [];
  room.onMessage<GameSnapshot>("state", (next) => { state = next; });
  room.onMessage<GameEffect>("effect", (effect) => effects.push(effect));
  for (const type of ["notice", "action-error", "chat:message", "chat:history", "chat:clear", "lens", "ping"]) room.onMessage(type, () => {});
  return { get state() { return state; }, effects };
}

async function until<T>(read: () => T | undefined | false, timeout = 5_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("파티 흐름 상태 대기 초과");
}

test("두 역할 모두 포탈 전의 늦은 정지 좌표를 버리고 착지 후 새 버전의 정지 보정만 적용한다", { timeout: 15_000 }, async () => {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...FAST_TEST_RULES, hidingMs: 30_000 } });
  const rooms: Room[] = [];
  const views: ReturnType<typeof observe>[] = [];
  try {
    const port = await runtime.listen(0);
    for (let index = 0; index < 4; index += 1) {
      rooms.push(await new ColyseusSDK(`http://127.0.0.1:${port}`).joinOrCreate("nunchisoom", {
        mode: "public", displayName: `포탈검증${index}`, deviceId: `portal-anchor-${index}`,
      }));
      views.push(observe(rooms[index]));
    }
    for (const room of rooms) room.send("ready", true);
    await until(() => views[0].state?.canStart);
    rooms[0].send("start", true);
    await until(() => views.every((view) => view.state?.phase === "HIDING"));
    const local = matchMaker.getLocalRoomById(rooms[0].roomId) as unknown as TestRoom & {
      handleMove: (client: Client, message: MoveMessage) => void;
    };
    const originalMove = local.handleMove.bind(local);
    const anchorDistances = new Map<string, number>();
    local.handleMove = (client, message) => {
      const player = local.players.get(views[rooms.findIndex((room) => room.sessionId === client.sessionId)].state!.self.playerId)!;
      const before = { x: player.x, y: player.y };
      originalMove(client, message);
      if (message.anchorX !== undefined) anchorDistances.set(`${client.sessionId}:${message.seq}`, Math.hypot(player.x - before.x, player.y - before.y));
    };
    for (const role of ["SEEKER", "HIDER"]) {
      const index = views.findIndex((view) => view.state?.self.role === role);
      const player = local.players.get(views[index].state!.self.playerId)!;
      const entry = views[index].state!.map.portals[0];
      // 시작 좌표만 배치하고 포탈 진입과 정지는 실제 WebSocket 입력으로 실행한다.
      Object.assign(player, { x: entry.x + entry.radius + 0.1, y: entry.y, inputX: 0, inputY: 0, portalReadyAt: 0 });
      const source = { x: player.x, y: player.y };
      rooms[index].send("move", { seq: 1, x: -1, y: 0 });
      const transferred = await until(() => {
        const entity = views[index].state?.entities.find((candidate) => candidate.controlled);
        return entity && entity.teleportRevision > 0 && entity;
      });
      rooms[index].send("move", { seq: 2, x: 0, y: 0, anchorX: source.x, anchorY: source.y, anchorRevision: transferred.teleportRevision - 1 });
      await until(() => views[index].state!.self.lastAcceptedSeq >= 2);
      assert.equal(anchorDistances.get(`${rooms[index].sessionId}:2`), 0, `${role}: 포탈 이전 좌표는 착지점을 당기면 안 된다.`);
      rooms[index].send("move", { seq: 3, x: 1, y: 0 });
      rooms[index].send("move", { seq: 4, x: 0, y: 0, anchorX: player.x + 0.2, anchorY: player.y, anchorRevision: transferred.teleportRevision });
      await until(() => views[index].state!.self.lastAcceptedSeq >= 4);
      assert.ok(anchorDistances.get(`${rooms[index].sessionId}:4`)! > 0.05, "착지 이후의 유효한 보정은 계속 적용해야 한다.");
      assert.equal(rooms[index].connection.isOpen, true);
    }
  } finally { await Promise.allSettled(rooms.map((room) => room.leave(true))); await runtime.shutdown(); }
});

test("기억 ID 격리·수색 전 미션 금지·도발 위험 공개와 생존 보상을 실제 4소켓으로 검증한다", { timeout: 18_000 }, async () => {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...FAST_TEST_RULES, countdownMs: 80, hidingMs: 900, seekingMs: 7_500, resultMs: 80, missionHoldMs: 120 } });
  const rooms: Room[] = [];
  const views: ReturnType<typeof observe>[] = [];
  try {
    const port = await runtime.listen(0);
    for (let index = 0; index < 4; index += 1) {
      rooms.push(await new ColyseusSDK(`http://127.0.0.1:${port}`).joinOrCreate("nunchisoom", { mode: "public", displayName: `도발검증${index}`, deviceId: `party-test-${index}` }));
      views.push(observe(rooms[index]));
    }
    for (const room of rooms) room.send("ready", true);
    await until(() => views[0].state?.canStart);
    rooms[0].send("start", true);
    await until(() => views.every((view) => view.state?.phase === "HIDING"));
    const seekerIndex = views.findIndex((view) => view.state?.self.role === "SEEKER");
    const hiderIndex = views.findIndex((view) => view.state?.self.role === "HIDER");
    const preview = views[seekerIndex].state!;
    const previewIds = new Set(preview.entities.filter((entity) => entity.category === "prop").map((entity) => entity.id));
    const local = matchMaker.getLocalRoomById(rooms[0].roomId) as unknown as TestRoom;
    const hider = local.players.get(views[hiderIndex].state!.self.playerId)!;
    const zone = preview.map.zones.find((entry) => entry.id === hider.mission!.zoneId)!;
    Object.assign(hider, { x: zone.x, y: zone.y, locked: true });
    rooms[hiderIndex].send("taunt", true);
    const hidingStart = Date.now();
    await until(() => Date.now() - hidingStart > 250 && views[hiderIndex].state?.phase === "HIDING");
    assert.equal(views[hiderIndex].state!.mission!.progress, 0);
    assert.equal(views[hiderIndex].state!.self.taunt!.remaining, 2);
    await until(() => views.every((view) => view.state?.phase === "SEEKING"));
    assert.equal(views[seekerIndex].state!.entities.filter((entity) => entity.category === "prop").some((entity) => previewIds.has(entity.id)), false);
    assert.equal(views[seekerIndex].state!.self.taunt, undefined);
    rooms[hiderIndex].send("taunt", true);
    await until(() => views.every((view) => view.effects.some((effect) => effect.type === "taunt")));
    for (const view of views) {
      const effect = view.effects.find((entry) => entry.type === "taunt")!;
      assert.deepEqual(Object.keys(effect).sort(), ["id", "label", "type", "x", "y"]);
      assert.equal(effect.x, zone.x);
      assert.equal(effect.y, zone.y);
    }
    rooms[hiderIndex].send("taunt", true);
    await until(() => views[hiderIndex].state?.mission?.completed && views[hiderIndex].state?.self.taunt?.remaining === 1);
    assert.equal(views[hiderIndex].state!.self.taunt!.remaining, 1);
    assert.equal(views[seekerIndex].state!.players.every((player) => player.score === 0), true);
    await until(() => views[hiderIndex].effects.some((effect) => effect.label.includes("도발 생존 성공")), 7_000);
    const final = await until(() => views[hiderIndex].state?.phase === "FINAL" && views[hiderIndex].state, 4_000);
    assert.equal(final.players.find((player) => player.id === final.self.playerId)!.score, 80 + 50 + 25 + TAUNT_RULES.reward);
    assert.equal(final.replay.filter((beat) => beat.type === "taunt").length, 1);
    assert.equal(runtime.store.count(), 1);
    // FINAL에서 남은 고정 미션이 늦게 완료되거나 추가 점수가 발생하지 않는다.
    const idleMissionPlayer = [...local.players.values()].find((player) => player.role === "HIDER" && player !== hider)!;
    const idleZone = final.map.zones.find((entry) => entry.id === idleMissionPlayer.mission!.zoneId)!;
    Object.assign(idleMissionPlayer, { x: idleZone.x, y: idleZone.y, locked: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(idleMissionPlayer.mission!.completed, false);
  } finally { await Promise.allSettled(rooms.map((room) => room.leave(true))); await runtime.shutdown(); }
});

test("도발 중 포획·연결 끊김은 보상을 취소하고 술래는 도발할 수 없다", { timeout: 20_000 }, async () => {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...FAST_TEST_RULES, countdownMs: 80, hidingMs: 180, seekingMs: 7_000, resultMs: 80 } });
  const rooms: Room[] = [];
  const views: ReturnType<typeof observe>[] = [];
  try {
    const port = await runtime.listen(0);
    for (let index = 0; index < 4; index += 1) {
      rooms.push(await new ColyseusSDK(`http://127.0.0.1:${port}`).joinOrCreate("nunchisoom", { mode: "public", displayName: `취소검증${index}`, deviceId: `cancel-test-${index}` }));
      views.push(observe(rooms[index]));
    }
    for (const room of rooms) room.send("ready", true);
    await until(() => views[0].state?.canStart);
    rooms[0].send("start", true);
    await until(() => views.every((view) => view.state?.phase === "SEEKING"));
    const seekerIndex = views.findIndex((view) => view.state?.self.role === "SEEKER");
    const hiders = views.map((view, index) => view.state?.self.role === "HIDER" ? index : -1).filter((index) => index >= 0);
    rooms[seekerIndex].send("taunt", true);
    const local = matchMaker.getLocalRoomById(rooms[0].roomId) as unknown as TestRoom;
    const seeker = local.players.get(views[seekerIndex].state!.self.playerId)!;
    const caught = local.players.get(views[hiders[0]].state!.self.playerId)!;
    // 평탄한 테스트 위치에서 거리·시야 판정을 통과하는 실제 tag 요청을 사용한다.
    Object.assign(seeker, { x: 10, y: 2 });
    Object.assign(caught, { x: 11, y: 2 });
    rooms[hiders[0]].send("taunt", true);
    rooms[hiders[1]].send("taunt", true);
    await until(() => views[hiders[0]].state?.self.taunt?.resolvesAt && views[hiders[1]].state?.self.taunt?.resolvesAt);
    rooms[seekerIndex].send("tag", { seq: 1, entityId: caught.entityId });
    await until(() => views[hiders[0]].state?.self.caught);
    const disconnected = rooms[hiders[1]];
    disconnected.reconnection.enabled = false;
    rooms.splice(hiders[1], 1);
    await disconnected.leave(false);
    const final = await until(() => views[seekerIndex].state?.phase === "FINAL" && views[seekerIndex].state, 9_000);
    assert.equal(final.replay.some((beat) => beat.type === "taunt"), false);
    assert.equal(views[seekerIndex].effects.filter((effect) => effect.type === "taunt").length, 2);
  } finally { await Promise.allSettled(rooms.map((room) => room.leave(true))); await runtime.shutdown(); }
});

test("1명+3 AI 즉시 시작과 같은 방 재경기는 추가 AI·방 생성 없이 동작한다", { timeout: 9_000 }, async () => {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false, rules: FAST_TEST_RULES });
  let room: Room | undefined;
  try {
    const port = await runtime.listen(0);
    room = await new ColyseusSDK(`http://127.0.0.1:${port}`).create("nunchisoom", { mode: "invite", displayName: "솔로검증", deviceId: "solo-party-test" });
    const view = observe(room);
    for (let index = 0; index < 3; index += 1) room.send("bot:add", { difficulty: "normal" });
    room.send("ready", true);
    room.send("start", true);
    const first = await until(() => view.state?.phase === "FINAL" && view.state);
    assert.equal(first.players.length, 4);
    assert.equal(first.players.filter((player) => player.bot).length, 3);
    room.send("ready", true);
    room.send("start", true);
    const second = await until(() => runtime.store.count() === 2 && view.state?.phase === "FINAL" && view.state);
    assert.equal(second.roomId, first.roomId);
    assert.deepEqual(second.players.map((player) => player.id), first.players.map((player) => player.id));
    assert.equal(runtime.store.count(), 2);
  } finally { await room?.leave(true); await runtime.shutdown(); }
});

test("실제 서버 이동은 역할 속도를 따르고 반복 정지 보정으로 과속할 수 없다", { timeout: 10_000 }, async () => {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...FAST_TEST_RULES, hidingMs: 6_000 } });
  const rooms: Room[] = [];
  const views: ReturnType<typeof observe>[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const port = await runtime.listen(0);
    for (let index = 0; index < 4; index += 1) {
      rooms.push(await new ColyseusSDK(`http://127.0.0.1:${port}`).joinOrCreate("nunchisoom", { mode: "public", displayName: `속도검증${index}`, deviceId: `speed-test-${index}` }));
      views.push(observe(rooms[index]));
    }
    for (const room of rooms) room.send("ready", true);
    await until(() => views[0].state?.canStart);
    rooms[0].send("start", true);
    await until(() => views.every((view) => view.state?.phase === "HIDING"));
    const index = views.findIndex((view) => view.state?.self.role === "HIDER");
    const local = matchMaker.getLocalRoomById(rooms[0].roomId) as unknown as TestRoom & {
      tick: (delta: number) => void; version: number; clock: { elapsedTime: number };
    };
    // 부하로 150ms를 넘는 긴 tick은 게임 규칙에 따라 잘린다. 이를 과속/시계 결함과 혼동하지 않는다.
    const frames = new Map<number, { raw: number; simulated: number; clock: number }>();
    let raw = 0; let simulated = 0;
    const tick = local.tick.bind(local);
    local.tick = (delta) => {
      raw += delta; simulated += Math.min(MAX_MOVEMENT_DELTA_MS, delta);
      tick(delta);
      frames.set(local.version, { raw, simulated, clock: local.clock.elapsedTime });
    };
    Object.assign(local.players.get(views[index].state!.self.playerId)!, { x: 5, y: 2 });
    let seq = 1;
    rooms[index].send("move", { seq: seq++, x: 1, y: 0 });
    const moving = await until(() => {
      const state = views[index].state!;
      const entity = state.entities.find((entry) => entry.controlled)!;
      return state.self.lastAcceptedSeq >= 1 && entity.y === 2 && entity.x > 5.1 && frames.has(state.version) && state;
    });
    const origin = moving.entities.find((entity) => entity.controlled)!;
    const later = await until(() => views[index].state!.serverTime >= moving.serverTime + 700 && views[index].state);
    const laterX = later.entities.find((entity) => entity.controlled)!.x;
    const startFrame = frames.get(moving.version)!;
    const endFrame = frames.get(later.version)!;
    assert.ok(Math.abs((endFrame.raw - startFrame.raw) - (endFrame.clock - startFrame.clock)) <= 1,
      "별도 타이머가 같은 시계를 갱신해 simulation delta를 잘라내면 안 된다.");
    const expected = moving.self.movementSpeed * (endFrame.simulated - startFrame.simulated) / 1_000;
    assert.ok(Math.abs(laterX - origin.x - expected) < 0.12,
      `서버 이동 ${laterX - origin.x}, 시뮬레이션 시간 기준 기대 ${expected}. 역할 속도대로 이동해야 한다.`);
    timer = setInterval(() => {
      const state = views[index].state!;
      const entity = state.entities.find((entry) => entry.controlled)!;
      rooms[index].send("move", { seq: seq++, x: 0, y: 0, anchorX: entity.x + state.self.movementSpeed * 0.2, anchorY: entity.y });
      rooms[index].send("move", { seq: seq++, x: 1, y: 0 });
    }, 200);
    const attacked = await until(() => views[index].state!.serverTime >= later.serverTime + 1_000 && views[index].state);
    const maximum = moving.self.movementSpeed * ((attacked.serverTime - moving.serverTime) / 1_000 + 0.2);
    assert.ok(attacked.entities.find((entity) => entity.controlled)!.x - origin.x <= maximum + 0.12, "반복 정지 보정에도 실제 경과시간+최초200ms의 이동 한도를 지켜야 한다.");
  } finally { if (timer) clearInterval(timer); await Promise.allSettled(rooms.map((room) => room.leave(true))); await runtime.shutdown(); }
});

test("AI가 같은 사람을 계속 발견해도 반응 시점이 밀리지 않고 실제 포획한다", { timeout: 8_000 }, async (t) => {
  t.mock.method(Math, "random", () => 0);
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...FAST_TEST_RULES, hidingMs: 500, seekingMs: 4_000 } });
  const rooms: Room[] = [];
  const views: ReturnType<typeof observe>[] = [];
  try {
    const port = await runtime.listen(0);
    for (let index = 0; index < 4; index += 1) {
      rooms.push(await new ColyseusSDK(`http://127.0.0.1:${port}`).joinOrCreate("nunchisoom", { mode: "public", displayName: `추적검증${index}`, deviceId: `ai-catch-test-${index}` }));
      views.push(observe(rooms[index]));
    }
    rooms[0].send("bot:add", { difficulty: "hard" });
    for (const room of rooms) room.send("ready", true);
    await until(() => views[0].state?.canStart && views[0].state.players.length === 5).catch((error) => { throw new Error(JSON.stringify(views[0].state?.players), { cause: error }); });
    rooms[0].send("start", true);
    await until(() => views.every((view) => view.state?.phase === "HIDING"));
    const local = matchMaker.getLocalRoomById(rooms[0].roomId) as unknown as TestRoom;
    for (const [id, player] of local.players) {
      Object.assign(player, id.startsWith("bot-") ? { role: "SEEKER", x: 10, y: 2 } : { role: "HIDER", x: 28, y: 20, locked: true });
    }
    const target = local.players.get(views[0].state!.self.playerId)!;
    Object.assign(target, { x: 11, y: 2 });
    await until(() => views[0].state?.phase === "SEEKING" && views[0].state.self.caught, 2_000);
    assert.ok(views[0].effects.some((effect) => effect.type === "correct-tag"));
  } finally { await Promise.allSettled(rooms.map((room) => room.leave(true))); await runtime.shutdown(); }
});
