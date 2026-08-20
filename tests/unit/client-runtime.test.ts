import assert from "node:assert/strict";
import test from "node:test";
import { createClientId } from "../../shared/client-runtime";

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
