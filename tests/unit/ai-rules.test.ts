import assert from "node:assert/strict";
import test from "node:test";
import { AI_PROFILES, aiDifficultyLabel, isAiDifficulty } from "../../shared/ai-rules";

test("AI 난이도는 쉬움, 보통, 어려움 세 단계만 허용한다", () => {
  assert.equal(isAiDifficulty("easy"), true);
  assert.equal(isAiDifficulty("normal"), true);
  assert.equal(isAiDifficulty("hard"), true);
  assert.equal(isAiDifficulty("expert"), false);
  assert.deepEqual([aiDifficultyLabel("easy"), aiDifficultyLabel("normal"), aiDifficultyLabel("hard")], ["쉬움", "보통", "어려움"]);
});

test("높은 난이도일수록 더 빨리 판단하고 단서를 넓고 오래 기억한다", () => {
  assert.ok(AI_PROFILES.easy.reactionMs > AI_PROFILES.normal.reactionMs);
  assert.ok(AI_PROFILES.normal.reactionMs > AI_PROFILES.hard.reactionMs);
  assert.ok(AI_PROFILES.easy.perceptionRange < AI_PROFILES.normal.perceptionRange);
  assert.ok(AI_PROFILES.normal.perceptionRange < AI_PROFILES.hard.perceptionRange);
  assert.ok(AI_PROFILES.easy.memoryMs < AI_PROFILES.normal.memoryMs);
  assert.ok(AI_PROFILES.normal.memoryMs < AI_PROFILES.hard.memoryMs);
  assert.ok(AI_PROFILES.easy.falseInspectionChance > AI_PROFILES.hard.falseInspectionChance);
});

test("어려운 AI도 사람 역할의 최고 속도를 넘지 않는다", () => {
  assert.ok(AI_PROFILES.hard.hiderSpeedMultiplier <= 1);
  assert.ok(AI_PROFILES.hard.seekerSpeedMultiplier <= 1);
});
