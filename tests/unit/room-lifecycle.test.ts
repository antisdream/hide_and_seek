import assert from "node:assert/strict";
import test from "node:test";
import { CloseCode, type Room } from "@colyseus/sdk";
import { reconnectStalledRoom, SNAPSHOT_STALE_MS } from "../../app/game/room-lifecycle";

test("서버 상태만 끊긴 열린 소켓은 4초 후 기존 자동 재접속으로 전환한다", () => {
  const closes: { code?: number; reason?: string }[] = [];
  const room = { connection: { isOpen: true, close(code?: number, reason?: string) { closes.push({ code, reason }); room.reconnection.isReconnecting = true; } }, reconnection: { enabled: true, isReconnecting: false } } as unknown as Room;
  assert.equal(reconnectStalledRoom(room, 1000, 1000 + SNAPSHOT_STALE_MS - 1), false);
  assert.equal(reconnectStalledRoom(room, 1000, 1000 + SNAPSHOT_STALE_MS), true);
  assert.equal(closes[0].code, CloseCode.MAY_TRY_RECONNECT);
  assert.equal(reconnectStalledRoom(room, 1000, 20_000), false, "재접속 중에는 새 재접속을 겹쳐 시작하지 않는다");
  assert.equal(closes.length, 1);
  room.reconnection.isReconnecting = false;
  assert.equal(reconnectStalledRoom(room, 20_000, 20_050), false, "최신 상태를 받으면 정상 연결을 유지한다");
});

test("나간 방·닫힌 소켓·수신 시각이 없는 방은 상태 감시가 다시 연결하지 않는다", () => {
  const room = { connection: { isOpen: true, close() { assert.fail("다시 연결하면 안 된다"); } }, reconnection: { enabled: true, isReconnecting: false } } as unknown as Room;
  assert.equal(reconnectStalledRoom(undefined, 1000, 10_000), false);
  for (const at of [0, -1, NaN, Infinity]) assert.equal(reconnectStalledRoom(room, at, 10_000), false);
  assert.equal(reconnectStalledRoom(room, 1000, NaN), false);
  assert.equal(reconnectStalledRoom(room, 10_000, 1000), false);
  room.reconnection.enabled = false;
  assert.equal(reconnectStalledRoom(room, 1000, 10_000), false);
  room.reconnection.enabled = true;
  Object.assign(room.connection, { isOpen: false });
  assert.equal(reconnectStalledRoom(room, 1000, 10_000), false);
});
