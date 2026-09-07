import assert from "node:assert/strict";
import test from "node:test";
import { createClientId, readClientPreference, writeClientPreference } from "../../shared/client-runtime";

test("보안 컨텍스트의 표준 UUID를 우선 사용한다", () => {
  const expected = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(createClientId({ randomUUID: () => expected }), expected);
});

test("randomUUID가 없는 LAN HTTP에서도 UUID 형식 ID를 만든다", () => {
  const generated = createClientId({
    getRandomValues(values) {
      values.fill(0);
      return values;
    },
  });
  assert.equal(generated, "00000000-0000-4000-8000-000000000000");
});

test("브라우저 저장소 접근이 거부돼도 현재 페이지의 별명과 기기 ID를 유지한다", () => {
  const blocked = () => { throw new Error("SecurityError"); };
  assert.equal(readClientPreference("blocked-preference", blocked), undefined);
  writeClientPreference("blocked-preference", "guest-device-id", blocked);
  assert.equal(readClientPreference("blocked-preference", blocked), "guest-device-id");
});

test("저장 한도를 초과해도 마지막 입력을 메모리에서 읽는다", () => {
  const full = () => ({ getItem: () => "old-name", setItem: () => { throw new Error("QuotaExceededError"); } });
  writeClientPreference("full-preference", "new-name", full);
  assert.equal(readClientPreference("full-preference", full), "new-name");
});
