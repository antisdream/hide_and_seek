import assert from "node:assert/strict";
import test from "node:test";
import { matchMaker } from "@colyseus/core";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { createNunchisoomServer } from "../../server/index";
import { TAG_HISTORY_WINDOW_MS, type TagPosition } from "../../server/tag-history";
import { FAST_TEST_RULES } from "../../shared/game-rules";
import { distance, hasLineOfSight, isBlocked, PLAYER_COLLISION_RADIUS } from "../../shared/geometry";
import type { GameEffect, GameSnapshot, StaticProp } from "../../shared/game-types";

interface TestPlayer {
  id: string;
  x: number;
  y: number;
  entityId: string;
  teleportRevision: number;
  rotation: number;
  caught: boolean;
  caughtAt: number;
  score: number;
  focus: number;
  tagReadyAt: number;
}

interface TestRoom {
  players: Map<string, TestPlayer>;
  staticProps: StaticProp[];
  tagPositions: Map<string, TagPosition[]>;
}

function observe(room: Room) {
  let state: GameSnapshot | undefined;
  const effects: GameEffect[] = [];
  const subscribers = new Set<(state: GameSnapshot) => void>();
  room.onMessage<GameSnapshot>("state", (next) => {
    state = next;
    for (const subscriber of subscribers) subscriber(next);
  });
  room.onMessage<GameEffect>("effect", (effect) => effects.push(effect));
  for (const type of ["notice", "action-error", "chat:message", "chat:history", "chat:clear", "lens", "ping"]) {
    room.onMessage(type, () => {});
  }
  return { get state() { return state; }, effects, subscribers };
}

async function until<T>(read: () => T | undefined | false, label: string, timeout = 5_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${label}: 상태 대기 초과`);
}

async function startMatch(hidingMs = 180) {
  const runtime = createNunchisoomServer({
    databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...FAST_TEST_RULES, hidingMs, seekingMs: 8_000 },
  });
  const rooms: Room[] = [];
  const views: ReturnType<typeof observe>[] = [];
  const close = async () => {
    await Promise.allSettled(rooms.map((room) => room.leave(true)));
    await runtime.shutdown();
  };
  try {
    const port = await runtime.listen(0);
    for (let index = 0; index < 4; index += 1) {
      const room = await new ColyseusSDK(`http://127.0.0.1:${port}`).joinOrCreate("nunchisoom", {
        mode: "public", displayName: `추격입력검증${index}`, deviceId: `chase-input-${index}`,
      });
      rooms.push(room);
      views.push(observe(room));
    }
    for (const room of rooms) room.send("ready", true);
    await until(() => views[0].state?.canStart, "4인 준비");
    rooms[0].send("start", true);
    await until(() => views.every((view) => view.state?.phase === "HIDING"), "라운드 시작");
    const local = matchMaker.getLocalRoomById(rooms[0].roomId) as unknown as TestRoom;
    return { rooms, views, local, close };
  } catch (error) {
    await close();
    throw error;
  }
}

test("실제 이동으로 사거리 밖에 나온 숨는 사물을 최근 이력으로 잡고 연타·오답 규칙을 유지한다", { timeout: 15_000 }, async () => {
  const { rooms, views, local, close } = await startMatch();
  try {
    await until(() => views.every((view) => view.state?.phase === "SEEKING"), "수색 시작");
    const seekerIndex = views.findIndex((view) => view.state!.self.role === "SEEKER");
    const hiderIndex = views.findIndex((view) => view.state!.self.role === "HIDER");
    assert.ok(seekerIndex >= 0 && hiderIndex >= 0);
    const seeker = local.players.get(views[seekerIndex].state!.self.playerId)!;
    const hider = local.players.get(views[hiderIndex].state!.self.playerId)!;
    const ordinaryProp = local.staticProps[0];
    assert.ok(ordinaryProp);
    // 이 테스트 방의 시작 좌표만 배치한다. 이동·이력 기록·판정·쿨다운은 서버의 실제 루프를 사용한다.
    Object.assign(seeker, { x: 10, y: 2 });
    Object.assign(hider, { x: 12.35, y: 2 });
    Object.assign(ordinaryProp, { x: 11, y: 2 });
    const map = views[seekerIndex].state!.map;
    assert.equal(isBlocked(seeker, PLAYER_COLLISION_RADIUS, map), false);
    assert.equal(isBlocked(hider, PLAYER_COLLISION_RADIUS, map), false);
    assert.equal(hasLineOfSight(seeker, hider, map), true);
    let sampleUsed: TagPosition | undefined;
    let distanceAtClick = 0;
    let historyAgeAtClick = 0;
    let sent = false;
    let started = false;
    let onSnapshot: ((state: GameSnapshot) => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("사거리 경계 이동·클릭 대기 초과")), 3_000);
        onSnapshot = (state) => {
          if (sent) return;
          const target = state.entities.find((entity) => entity.id === hider.entityId);
          if (!target) return;
          if (!started) {
            if (Math.abs(target.x - 12.35) > 0.000_001 || target.y !== 2) return;
            started = true;
            rooms[hiderIndex].send("move", { seq: 1, x: 1, y: 0 });
            return;
          }
          if (distance(seeker, target) <= FAST_TEST_RULES.tagDistance) return;
          // 인위적인 75/200ms sleep 대신 첫 사거리 밖 스냅숏 콜백에서 바로 실제 소켓으로 클릭한다.
          // 과거 이력은 읽어서 검증할 뿐 주입하거나 시간을 바꾸지 않는다.
          try {
            const now = Date.now();
            sampleUsed = [...(local.tagPositions.get(hider.id) ?? [])].reverse().find((sample) =>
              sample.entityId === hider.entityId
              && sample.teleportRevision === hider.teleportRevision
              && now - sample.at <= TAG_HISTORY_WINDOW_MS
              && distance(seeker, sample) <= FAST_TEST_RULES.tagDistance,
            );
            assert.ok(sampleUsed, "실제 서버가 200ms 안에 기록한 사거리 내 위치가 필요합니다.");
            distanceAtClick = distance(seeker, hider);
            historyAgeAtClick = now - sampleUsed.at;
            assert.ok(distanceAtClick > FAST_TEST_RULES.tagDistance, "현재 거리 판정만으로는 포획할 수 없어야 합니다.");
            sent = true;
            rooms[seekerIndex].send("tag", { seq: 1, entityId: hider.entityId });
            rooms[seekerIndex].send("tag", { seq: 1, entityId: hider.entityId });
            rooms[seekerIndex].send("tag", { seq: 2, entityId: hider.entityId });
            rooms[seekerIndex].send("tag", { seq: 3, entityId: ordinaryProp.id });
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        };
        views[seekerIndex].subscribers.add(onSnapshot);
      });
    } finally {
      if (onSnapshot) views[seekerIndex].subscribers.delete(onSnapshot);
    }
    await until(() => views[hiderIndex].state?.self.caught && views[seekerIndex].state!.self.lastAcceptedSeq >= 3, "추격 포획과 연타 처리");
    assert.ok(sampleUsed);
    assert.ok(historyAgeAtClick >= 0 && historyAgeAtClick <= TAG_HISTORY_WINDOW_MS);
    assert.ok(hider.caughtAt - sampleUsed.at <= TAG_HISTORY_WINDOW_MS, "실제 포획 시점에도 이력이 200ms 범위 안이어야 합니다.");
    assert.equal(hider.caught, true);
    // 플레이 중 점수는 공개 스냅숏에서 숨기므로, 실제 판정 후 서버 점수를 읽어 중복 가산을 확인한다.
    assert.equal(seeker.score, 80);
    assert.equal(views[seekerIndex].effects.filter((effect) => effect.type === "correct-tag").length, 1);
    assert.equal(views[seekerIndex].effects.filter((effect) => effect.type === "wrong-tag").length, 0);
    assert.equal(views[seekerIndex].state!.self.focus, 100, "쿨다운 중 오답 클릭은 집중력도 소모하지 않아야 합니다.");

    await until(() => views[seekerIndex].state!.serverTime >= seeker.tagReadyAt, "정상 포획 쿨다운 종료");
    rooms[seekerIndex].send("tag", { seq: 4, entityId: ordinaryProp.id });
    await until(() => views[seekerIndex].state!.self.lastAcceptedSeq >= 4
      && views[seekerIndex].effects.some((effect) => effect.type === "wrong-tag"), "평범한 사물 오답 판정");
    assert.equal(views[seekerIndex].state!.self.focus, 100 - FAST_TEST_RULES.wrongTagPenalty);
    assert.equal(seeker.score, 80);
    rooms[seekerIndex].send("tag", { seq: 4, entityId: ordinaryProp.id });
    rooms[seekerIndex].send("tag", { seq: 5, entityId: ordinaryProp.id });
    await until(() => views[seekerIndex].state!.self.lastAcceptedSeq >= 5, "오답 중복과 쿨다운 처리");
    assert.equal(views[seekerIndex].state!.self.focus, 100 - FAST_TEST_RULES.wrongTagPenalty);
    assert.equal(views[seekerIndex].effects.filter((effect) => effect.type === "wrong-tag").length, 1);
    assert.equal(seeker.score, 80);
    assert.equal(rooms.every((room) => room.connection.isOpen), true);
  } finally { await close(); }
});

test("실제 소켓의 역방향 정지 보정은 바라보는 방향을 유지하고 짧은 반대 입력은 방향을 바꾼다", { timeout: 10_000 }, async () => {
  const { rooms, views, local, close } = await startMatch(8_000);
  try {
    const index = views.findIndex((view) => view.state!.self.role === "HIDER");
    assert.ok(index >= 0);
    const player = local.players.get(views[index].state!.self.playerId)!;
    Object.assign(player, { x: 10, y: 2 });
    rooms[index].send("move", { seq: 1, x: 1, y: 0 });
    await until(() => views[index].state!.self.lastAcceptedSeq >= 1 && player.x > 10.05, "오른쪽 실제 이동");
    const beforeStop = { x: player.x, y: player.y };
    const anchor = { x: beforeStop.x - 0.2, y: beforeStop.y };
    rooms[index].send("move", {
      seq: 2, x: 0, y: 0, anchorX: anchor.x, anchorY: anchor.y, anchorRevision: player.teleportRevision,
    });
    await until(() => views[index].state!.self.lastAcceptedSeq >= 2, "역방향 정지 좌표 확인");
    const stopped = views[index].state!.entities.find((entity) => entity.controlled)!;
    assert.ok(Math.abs(stopped.x - anchor.x) < 0.000_001, "진행 방향 반대의 0.2칸 정지 보정이 실제로 적용되어야 합니다.");
    assert.ok(stopped.x < beforeStop.x);
    assert.equal(stopped.y, anchor.y);
    assert.equal(stopped.rotation, 0, "좌표 보정 벡터 때문에 오른쪽에서 왼쪽으로 고개가 돌아가면 안 됩니다.");
    // 같은 소켓에서 연속 전송해 서버 tick보다 짧은 반대 입력도 바라보는 방향에 반영되는지 확인한다.
    rooms[index].send("move", { seq: 3, x: -1, y: 0 });
    rooms[index].send("move", { seq: 4, x: 0, y: 0 });
    await until(() => views[index].state!.self.lastAcceptedSeq >= 4, "짧은 반대 입력과 정지 확인");
    const turned = views[index].state!.entities.find((entity) => entity.controlled)!;
    assert.equal(Math.abs(turned.rotation), 180);
    assert.ok(Math.abs(turned.x - stopped.x) < 0.000_001, "이동 tick 없이 끝난 입력도 마지막 이동 의도의 방향을 보존해야 합니다.");
    assert.equal(rooms[index].connection.isOpen, true);
  } finally { await close(); }
});
