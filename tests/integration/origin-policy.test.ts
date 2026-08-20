import assert from "node:assert/strict";
import test from "node:test";
import { FAST_TEST_RULES } from "../../shared/game-rules";
import { createNunchisoomServer } from "../../server/index";
import { SAME_HOST_ORIGIN } from "../../server/origin-policy";

test("HTTP 매치메이킹 계층도 같은 호스트 Origin만 허용한다", async () => {
  const runtime = createNunchisoomServer({
    allowedOrigins: [SAME_HOST_ORIGIN],
    databasePath: ":memory:",
    rules: FAST_TEST_RULES,
    greet: false,
  });
  const port = await runtime.listen(0, "127.0.0.1");

  try {
    const allowedOrigin = "http://127.0.0.1:3000";
    const allowed = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { Origin: allowedOrigin },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);

    const denied = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { Origin: "http://192.168.0.99:3000" },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  } finally {
    await runtime.shutdown();
  }
});
