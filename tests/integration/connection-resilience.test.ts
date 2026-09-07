import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { MOVE_HEARTBEAT_INTERVAL_MS } from "../../shared/input-rules";
import { leaveGameRoom } from "../../app/game/room-lifecycle";
import { createNunchisoomServer } from "../../server/index";
import type { GameSnapshot } from "../../shared/game-types";

test("서버만 2.6초 멈춰도 실제 클라이언트 주기의 이동 입력으로 강제 퇴장하지 않는다", { timeout: 20_000 }, async () => {
  const child = fork(fileURLToPath(new URL("../fixtures/connection-server.mjs", import.meta.url)), {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let serverError = "";
  child.stderr?.on("data", (chunk) => { serverError += String(chunk); });
  let room: Room | undefined;
  let sender: ReturnType<typeof setInterval> | undefined;
  try {
    const { port } = await childMessage(child, "ready");
    room = await new ColyseusSDK(`http://127.0.0.1:${port}`).create("nunchisoom", {
      mode: "invite", displayName: "지연 검증", deviceId: "isolated-stall-client",
    });
    let acknowledgedSequence = -1;
    room.onMessage<GameSnapshot>("state", (state) => { acknowledgedSequence = state.self.lastAcceptedSeq; });
    room.onMessage("chat:history", () => undefined);
    room.onMessage("notice", () => undefined);
    const closed: number[] = [];
    const errors: string[] = [];
    room.onLeave((code) => closed.push(code));
    room.onError((code, message) => errors.push(`${code}:${message}`));
    let sequence = 0;
    sender = setInterval(() => {
      if (room?.connection.isOpen) room.send("move", { seq: ++sequence, x: 1, y: 0 });
    }, MOVE_HEARTBEAT_INTERVAL_MS);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const stalled = childMessage(child, "stall-end");
    child.send({ type: "stall", durationMs: 2_600 });
    await stalled;
    const firstSequenceAfterStall = sequence + 1;
    const acknowledgementDeadline = Date.now() + 3_000;
    while (acknowledgedSequence < firstSequenceAfterStall && closed.length === 0 && Date.now() < acknowledgementDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.deepEqual(closed, [], `정상 이동 연결 종료: ${closed}; errors=${errors}; server=${serverError}`);
    assert.equal(room.connection.isOpen, true);
    assert.ok(acknowledgedSequence >= firstSequenceAfterStall, "지연이 풀린 뒤 새 입력에 대한 서버 ACK도 다시 도착해야 한다.");
  } finally {
    if (sender) clearInterval(sender);
    if (room) {
      room.reconnection.enabled = false;
      if (room.connection.isOpen) await room.leave(true);
    }
    if (child.connected) child.send({ type: "shutdown" });
    if (child.exitCode === null) {
      const forceStop = setTimeout(() => child.kill(), 2_000);
      await once(child, "exit");
      clearTimeout(forceStop);
    }
  }
});

test("재연결 대기 중 나가면 즉시 반환하고 이미 예약된 SDK 재연결도 실행하지 않는다", { timeout: 8_000 }, async () => {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false });
  let room: Room | undefined;
  try {
    const port = await runtime.listen(0);
    room = await new ColyseusSDK(`http://127.0.0.1:${port}`).create("nunchisoom", {
      mode: "invite", displayName: "취소 검증", deviceId: "cancel-pending-reconnect",
    });
    room.onMessage("state", () => undefined);
    room.onMessage("chat:history", () => undefined);
    room.onMessage("notice", () => undefined);
    room.reconnection.minUptime = 0;
    room.reconnection.minDelay = 300;
    room.reconnection.maxDelay = 300;
    const dropped = new Promise<void>((resolve) => room!.onDrop(() => resolve()));
    room.connection.close(4010, "test disconnect");
    await dropped;
    leaveGameRoom(room);
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(room.connection.isOpen, false, "취소한 방이 예약 타이머로 다시 열리면 안 된다.");
    assert.equal(room.reconnection.enabled, false);
  } finally {
    leaveGameRoom(room);
    await runtime.shutdown();
  }
});

function childMessage(child: ChildProcess, type: string): Promise<{ type: string; port?: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`서버 응답 지연: ${type}`)); }, 10_000);
    const listener = (message: { type: string; port?: number }) => {
      if (message.type !== type) return;
      cleanup();
      resolve(message);
    };
    const failed = (code: number | null) => { cleanup(); reject(new Error(`시험 서버 조기 종료: ${code}`)); };
    const cleanup = () => { clearTimeout(timer); child.off("message", listener); child.off("exit", failed); };
    child.on("message", listener);
    child.once("exit", failed);
  });
}
