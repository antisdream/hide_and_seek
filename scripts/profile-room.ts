import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import { createNunchisoomServer } from "../server/index";
import { DEFAULT_RULES } from "../shared/game-rules";
import type { GameSnapshot } from "../shared/game-types";

const sampleMs = 4_000;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 20_000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error("프로파일 준비 시간 초과"); await wait(30); }
}

async function profile(roomCount: number, humansPerRoom: number, botsPerRoom: number) {
  const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false,
    rules: { ...DEFAULT_RULES, countdownMs: 300, hidingMs: 600, seekingMs: 60_000, seekingMsPerExtraPlayer: 0 } });
  const clients: Room[] = [];
  const hosts: Room[] = [];
  const states = new Map<Room, GameSnapshot>();
  let measuring = false;
  let bytes = 0;
  let packets = 0;
  let snapshots = 0;
  const phases: Record<string, number> = {};
  const errors: string[] = [];
  try {
    const port = await runtime.listen(0);
    for (let group = 0; group < roomCount; group += 1) {
      let host: Room | undefined;
      for (let index = 0; index < humansPerRoom; index += 1) {
        const sdk = new ColyseusSDK(`http://127.0.0.1:${port}`);
        const options = { mode: "invite", displayName: `측정${group}-${index}`, deviceId: `profile-${group}-${index}` };
        const room = host ? await sdk.joinById(host.roomId, options) : await sdk.create("nunchisoom", options);
        if (!host) { host = room; hosts.push(room); }
        clients.push(room);
        const receive = room.connection.events.onmessage;
        room.connection.events.onmessage = (event) => {
          if (measuring) { bytes += event.data.byteLength ?? 0; packets += 1; }
          receive?.(event);
        };
        room.onMessage<GameSnapshot>("state", (state) => {
          states.set(room, state);
          if (measuring) { snapshots += 1; phases[state.phase] = (phases[state.phase] ?? 0) + 1; }
        });
        for (const type of ["effect", "notice", "chat:history", "chat:clear", "chat:message", "ping", "lens"]) room.onMessage(type, () => {});
        room.onMessage("action-error", (message) => errors.push(JSON.stringify(message)));
        room.onError((code, message) => errors.push(`${code}: ${message}`));
        room.send("ready", true);
      }
      for (let index = 0; index < botsPerRoom; index += 1) host!.send("bot:add", { difficulty: "normal" });
    }
    await waitFor(() => hosts.every((host) => states.get(host)?.canStart));
    async function sample(label: string) {
      bytes = 0; packets = 0; snapshots = 0;
      for (const key of Object.keys(phases)) delete phases[key];
      const loop = monitorEventLoopDelay({ resolution: 10 });
      loop.enable();
      const start = performance.now();
      const cpuStart = process.cpuUsage();
      measuring = true;
      await wait(sampleMs);
      measuring = false;
      const elapsedMs = performance.now() - start;
      const cpu = process.cpuUsage(cpuStart);
      loop.disable();
      return { label, elapsedMs: Math.round(elapsedMs), receivedPayloadBytes: bytes,
        payloadKBPerSecond: Math.round(bytes / elapsedMs), packets, snapshots,
        snapshotsPerClientSecond: +(snapshots / clients.length / (elapsedMs / 1_000)).toFixed(2),
        eventLoopP95Ms: +(loop.percentile(95) / 1e6).toFixed(2), eventLoopMaxMs: +(loop.max / 1e6).toFixed(2),
        processCpuPercentOfOneCore: +((cpu.user + cpu.system) / elapsedMs / 10).toFixed(1),
        rssMB: Math.round(process.memoryUsage().rss / 1_048_576), phases: { ...phases } };
    }
    const lobby = await sample("LOBBY");
    for (const host of hosts) host.send("start", true);
    await waitFor(() => hosts.every((host) => states.get(host)?.phase === "SEEKING"));
    const playing = await sample("PLAY");
    return { roomCount, humansPerRoom, botsPerRoom, clientConnections: clients.length, lobby, playing, errors };
  } finally { measuring = false; await Promise.allSettled(clients.map((client) => client.leave(true))); await runtime.shutdown(); }
}

const results = [];
for (const [roomCount, humans, bots] of [[1, 10, 0], [5, 10, 0], [5, 1, 9]]) {
  const result = await profile(roomCount, humans, bots);
  results.push(result);
  console.log(JSON.stringify(result));
}
const output = { measuredAt: new Date().toISOString(), node: process.version, logicalCpus: cpus().length, sampleMs,
  limitations: ["단일 PC loopback이며 서버와 소켓 클라이언트가 같은 프로세스에 있다.", "브라우저 FPS·외부망 RTT·TLS/프록시·운영 서버 용량 검증이 아니다.", "WebSocket 수신 binary payload 합계이며 TCP/TLS 헤더를 포함하지 않는다.", "사람 소켓은 정지 상태이며 혼합 시나리오의 AI만 실제로 움직인다.", "CPU는 서버와 시험 클라이언트의 합계다."], results };
const directory = resolve("outputs", "release-20260907");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "room-profile.json"), `${JSON.stringify(output, null, 2)}\n`);
