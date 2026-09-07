import assert from "node:assert/strict";
import test from "node:test";
import { canTaunt, TAUNT_RULES } from "../../shared/party-rules";
import { consumeMovementTime, createMovementBudget } from "../../shared/movement-budget";

test("도발은 사용량·대기·진행 중·남은 수색 시간 모두를 검사한다", () => {
  const ready = { readyAt: 100, resolvesAt: 0, remaining: 2 };
  assert.equal(canTaunt(ready, 100, 6_101), true);
  assert.equal(canTaunt(ready, 100, 6_100), false);
  assert.equal(canTaunt(ready, 99, 10_000), false);
  assert.equal(canTaunt({ ...ready, remaining: 0 }, 100, 10_000), false);
  assert.equal(canTaunt({ ...ready, resolvesAt: 200 }, 100, 10_000), false);
  assert.equal(TAUNT_RULES.usesPerRound * TAUNT_RULES.reward, 40);
});

test("정상 이동 후에도 최초 200ms 정지 보정과 장시간 정상 이동을 허용한다", () => {
  const budget = createMovementBudget(0);
  for (let now = 20; now <= 2_000; now += 20) assert.equal(consumeMovementTime(budget, now, 20, "tick"), 20);
  assert.equal(consumeMovementTime(budget, 2_000, 200, "anchor"), 200);
  for (let now = 2_020; now <= 4_000; now += 20) assert.equal(consumeMovementTime(budget, now, 20, "tick"), 20);
  assert.equal(consumeMovementTime(budget, 4_000, 200, "anchor"), 0);
});

test("이동·정지 anchor를 반복해도 총 시간+200ms를 넘는 이동 예산을 만들지 않는다", () => {
  const budget = createMovementBudget(0);
  let granted = 0;
  for (let now = 20; now <= 2_000; now += 20) {
    granted += consumeMovementTime(budget, now, 20, "tick");
    if (now % 200 === 0) granted += consumeMovementTime(budget, now, 200, "anchor");
  }
  assert.equal(granted, 2_200);
  assert.equal(consumeMovementTime(budget, 1_000, 200, "anchor"), 0);
  assert.equal(consumeMovementTime(budget, 2_000, Number.NaN, "anchor"), 0);
  assert.equal(consumeMovementTime(budget, 4_000, 500, "anchor"), 200);
});
