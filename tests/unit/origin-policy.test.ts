import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedRequestOrigin, SAME_HOST_ORIGIN } from "../../server/origin-policy";

test("same-host 정책은 포트가 달라도 같은 IP의 웹 Origin을 허용한다", () => {
  assert.equal(
    isAllowedRequestOrigin("http://192.168.0.41:3000", "192.168.0.41:2567", [SAME_HOST_ORIGIN]),
    true,
  );
});

test("same-host 정책은 다른 호스트의 Origin을 거부한다", () => {
  assert.equal(
    isAllowedRequestOrigin("http://192.168.0.99:3000", "192.168.0.41:2567", [SAME_HOST_ORIGIN]),
    false,
  );
});

test("명시적으로 등록한 외부 Origin은 계속 허용한다", () => {
  assert.equal(
    isAllowedRequestOrigin("https://play.example.com", "game.example.com", ["https://play.example.com"]),
    true,
  );
});
