import assert from "node:assert/strict";
import test from "node:test";
import { matchMaker, type Client } from "@colyseus/core";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { reconnectStalledRoom } from "../../app/game/room-lifecycle";
import { createNunchisoomServer } from "../../server/index";
import { FAST_TEST_RULES } from "../../shared/game-rules";
import type { GameSnapshot } from "../../shared/game-types";

async function until(read: () => boolean, timeout = 7000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (read()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("술래 상태 복구 대기 초과");
}

test("AI전 술래의 숨기 종료 직전 상태 수신이 멎어도 같은 방의 수색 단계로 복구한다", { timeout: 15000 }, async () => {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...FAST_TEST_RULES, countdownMs: 150, hidingMs: 700, seekingMs: 10000 } });
  let room: Room | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  try {
    const port = await runtime.listen(0);
    room = await new ColyseusSDK(`http://127.0.0.1:${port}`).create("nunchisoom", { mode: "invite", displayName: "술래복구QA", deviceId: "stalled-seeker-qa" });
    room.reconnection.minUptime = 0;
    let snapshot: GameSnapshot | undefined;
    let receivedAt = Date.now();
    let recovered = false;
    room.onMessage<GameSnapshot>("state", next => { snapshot = next; receivedAt = Date.now(); });
    for (const name of ["effect", "notice", "action-error", "chat:history", "chat:message", "chat:clear"]) room.onMessage(name, () => {});
    room.onReconnect(() => { recovered = true; receivedAt = Date.now(); });
    for (let i = 0; i < 3; i++) room.send("bot:add", { difficulty: "normal" });
    room.send("ready", true);
    await until(() => Boolean(snapshot?.canStart));

    // 이 테스트가 만든 방에서 사람의 술래 역할과 일시적인 상태 메시지 유실만 고정한다.
    const local = matchMaker.getLocalRoomById(room.roomId) as unknown as {
      phase: string;
      players: Map<string, { id: string; bot: boolean }>;
      seekerHistory: Map<string, number>;
      prepareRound(): void;
      sendSnapshotTo(client: Client): void;
      onDrop(client: Client): void;
    };
    const prepare = local.prepareRound.bind(local);
    local.prepareRound = () => {
      for (const p of local.players.values()) local.seekerHistory.set(p.id, p.bot ? 100 : 0);
      prepare();
    };
    let blocked = false;
    const send = local.sendSnapshotTo.bind(local);
    local.sendSnapshotTo = client => { if (!blocked) send(client); };
    const drop = local.onDrop.bind(local);
    local.onDrop = client => { blocked = false; drop(client); };
    room.send("start", true);
    await until(() => snapshot?.phase === "HIDING");
    assert.equal(snapshot!.self.role, "SEEKER");
    assert.equal(snapshot!.seekerPreview, true);
    const playerId = snapshot!.self.playerId;
    const hidingEndsAt = snapshot!.phaseEndsAt;
    blocked = true;
    watchdog = setInterval(() => reconnectStalledRoom(room, receivedAt, Date.now()), 50);
    await until(() => local.phase === "SEEKING");
    assert.equal(snapshot!.phase, "HIDING", "연결은 열려 있지만 마지막 숨기 상태만 남은 장애를 실제로 재현한다");
    assert.equal(room.connection.isOpen, true);
    assert.ok(Date.now() >= hidingEndsAt);
    await until(() => recovered && snapshot?.phase === "SEEKING");
    assert.equal(snapshot!.self.playerId, playerId);
    assert.equal(snapshot!.self.role, "SEEKER");
    assert.equal(snapshot!.seekerPreview, false);
    assert.ok(snapshot!.phaseEndsAt > snapshot!.serverTime);
    const firstRemaining = snapshot!.phaseEndsAt - snapshot!.serverTime;
    await until(() => snapshot!.phaseEndsAt - snapshot!.serverTime < firstRemaining - 300);
    assert.equal(room.connection.isOpen, true);
  } finally {
    if (watchdog) clearInterval(watchdog);
    await room?.leave(true);
    await runtime.shutdown();
  }
});
