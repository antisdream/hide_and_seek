import { createNunchisoomServer } from "../../server/index.ts";

// 서버만 멈추는 상황을 재현한다. 시험 클라이언트와는 별도 프로세스, 별도 메모리 DB다.
const runtime = createNunchisoomServer({ databasePath: ":memory:", allowedOrigins: [], greet: false });
const port = await runtime.listen(0, "127.0.0.1");
process.send?.({ type: "ready", port });
process.on("message", async (message) => {
  if (message.type === "stall") {
    process.send?.({ type: "stall-start" });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, message.durationMs);
    process.send?.({ type: "stall-end" });
  } else if (message.type === "shutdown") {
    await runtime.shutdown();
    process.exit(0);
  }
});
