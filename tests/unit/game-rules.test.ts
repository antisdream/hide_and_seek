import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULES, normalizeMove, seekerCountFor, selectSeekers, tagCooldown } from "../../shared/game-rules";

test("인원에 따라 관찰자 수를 1명, 2명, 3명으로 늘린다", () => {
  assert.equal(seekerCountFor(4), 1);
  assert.equal(seekerCountFor(6), 2);
  assert.equal(seekerCountFor(9), 3);
});

test("관찰자 횟수가 적은 이용자를 먼저 선택한다", () => {
  const players = ["가", "나", "다", "라", "마", "바"];
  const history = new Map([["가", 3], ["나", 2], ["다", 0], ["라", 0], ["마", 1], ["바", 2]]);
  const selected = selectSeekers(players, history, 42);
  assert.equal(selected.size, 2);
  assert.deepEqual([...selected].sort(), ["다", "라"]);
});

test("대각선 이동 벡터를 정규화하고 비정상 값은 제거한다", () => {
  const diagonal = normalizeMove(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 0.0001);
  assert.deepEqual(normalizeMove(Number.NaN, Number.POSITIVE_INFINITY), { x: 0, y: 0 });
});

test("오답과 집중력 소진에 더 긴 재사용 대기를 적용한다", () => {
  assert.equal(tagCooldown(100, true, DEFAULT_RULES), DEFAULT_RULES.tagCooldownMs);
  assert.equal(tagCooldown(50, false, DEFAULT_RULES), DEFAULT_RULES.wrongTagCooldownMs);
  assert.equal(tagCooldown(0, false, DEFAULT_RULES), DEFAULT_RULES.emptyFocusCooldownMs);
});
