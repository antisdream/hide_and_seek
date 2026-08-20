import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RULES,
  normalizeMove,
  roundTimingFor,
  seekerCountFor,
  selectSeekers,
  tagCooldown,
} from "../../shared/game-rules";

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

test("틈새정령 속도는 유지하고 관찰자만 50퍼센트 이상 빠르게 한다", () => {
  assert.equal(DEFAULT_RULES.hiderSpeed, 5);
  assert.equal(DEFAULT_RULES.seekerSpeed, 7.8);
  assert.ok(DEFAULT_RULES.seekerSpeed / DEFAULT_RULES.hiderSpeed >= 1.5);
});

test("확인 스티커는 결과에 따라 체감 가능한 재사용 대기를 둔다", () => {
  assert.ok(DEFAULT_RULES.tagCooldownMs >= 1_000);
  assert.ok(DEFAULT_RULES.wrongTagCooldownMs >= DEFAULT_RULES.tagCooldownMs * 2);
  assert.ok(DEFAULT_RULES.emptyFocusCooldownMs > DEFAULT_RULES.wrongTagCooldownMs);
});

test("4인은 180초이며 한 명이 늘 때마다 수색 시간만 15초 늘어난다", () => {
  assert.deepEqual(roundTimingFor(4), {
    playerCount: 4,
    countdownMs: 10_000,
    hidingMs: 35_000,
    seekingMs: 125_000,
    resultMs: 10_000,
    totalMs: 180_000,
  });
  assert.equal(roundTimingFor(5).totalMs, 195_000);
  assert.equal(roundTimingFor(6).seekingMs, 155_000);
  assert.equal(roundTimingFor(10).totalMs, 270_000);
  assert.equal(roundTimingFor(20).playerCount, 10);
});
