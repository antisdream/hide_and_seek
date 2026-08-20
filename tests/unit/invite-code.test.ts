import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInviteCode } from "../../shared/invite-code";

test("초대 코드의 대소문자를 유지한다", () => {
  assert.equal(normalizeInviteCode("  AbC_def-123  "), "AbC_def-123");
});

test("초대 링크에서 방 ID를 꺼낸다", () => {
  assert.equal(
    normalizeInviteCode("http://localhost:3000/game?room=Room_42-x"),
    "Room_42-x",
  );
});

test("방 ID가 없거나 허용하지 않는 문자가 있으면 거부한다", () => {
  assert.equal(normalizeInviteCode("https://example.com/game"), undefined);
  assert.equal(normalizeInviteCode("잘못된 코드"), undefined);
});
