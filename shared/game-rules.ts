import type { GameRules } from "./game-types";

export const DEFAULT_RULES: GameRules = {
  tickRate: 20,
  minPlayers: 4,
  maxPlayers: 10,
  totalRounds: 3,
  countdownMs: 3_000,
  hidingMs: 18_000,
  seekingMs: 55_000,
  resultMs: 8_000,
  hiderSpeed: 5,
  seekerSpeed: 6.5,
  tagDistance: 2.6,
  tagCooldownMs: 1_200,
  wrongTagCooldownMs: 3_000,
  emptyFocusCooldownMs: 6_500,
  wrongTagPenalty: 25,
  focusRecoveryPerSecond: 5,
  focusRecoveryDelayMs: 5_000,
  swapDistance: 2.5,
  lensCooldownMs: 30_000,
  missionHoldMs: 2_000,
};

export const FAST_TEST_RULES: GameRules = {
  ...DEFAULT_RULES,
  minPlayers: 4,
  totalRounds: 1,
  countdownMs: 120,
  hidingMs: 180,
  seekingMs: 700,
  resultMs: 120,
  lensCooldownMs: 200,
  missionHoldMs: 100,
};

export function seekerCountFor(playerCount: number): number {
  if (playerCount <= 5) return 1;
  if (playerCount <= 8) return 2;
  return 3;
}

/**
 * 역할 이력이 가장 적은 이용자부터 술래를 맡긴다.
 * 같은 횟수라면 시드로 순서를 섞어 특정 입장 순서가 계속 유리해지는 것을 막는다.
 */
export function selectSeekers(
  playerIds: string[],
  seekerHistory: ReadonlyMap<string, number>,
  seed: number,
): Set<string> {
  const count = seekerCountFor(playerIds.length);
  const shuffled = [...playerIds].sort((a, b) => {
    const historyGap = (seekerHistory.get(a) ?? 0) - (seekerHistory.get(b) ?? 0);
    if (historyGap !== 0) return historyGap;
    return seededRank(a, seed) - seededRank(b, seed);
  });
  return new Set(shuffled.slice(0, count));
}

function seededRank(value: string, seed: number): number {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}

export function tagCooldown(focusAfterTag: number, correct: boolean, rules: GameRules): number {
  if (correct) return rules.tagCooldownMs;
  return focusAfterTag <= 0 ? rules.emptyFocusCooldownMs : rules.wrongTagCooldownMs;
}

export function normalizeMove(x: number, y: number): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
  const safeY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  const length = Math.hypot(safeX, safeY);
  if (length <= 1) return { x: safeX, y: safeY };
  return { x: safeX / length, y: safeY / length };
}
