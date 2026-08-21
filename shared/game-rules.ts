import type { GameRules } from "./game-types";

export const DEFAULT_RULES: GameRules = {
  tickRate: 30,
  minPlayers: 4,
  maxPlayers: 10,
  totalRounds: 3,
  countdownMs: 10_000,
  hidingMs: 35_000,
  seekingMs: 125_000,
  seekingMsPerExtraPlayer: 15_000,
  resultMs: 10_000,
  hiderSpeed: 6.5,
  seekerSpeed: 9.5,
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
  seekingMsPerExtraPlayer: 0,
  resultMs: 120,
  lensCooldownMs: 200,
  missionHoldMs: 100,
};

export interface RoundTiming {
  playerCount: number;
  countdownMs: number;
  hidingMs: number;
  seekingMs: number;
  resultMs: number;
  totalMs: number;
}

/**
 * 4인 기본 라운드에 참가자 한 명당 수색 시간 15초를 더한다.
 * 숨기기는 동시에 진행되므로 인원이 늘어도 준비 시간은 늘리지 않는다.
 */
export function roundTimingFor(playerCount: number, rules: GameRules = DEFAULT_RULES): RoundTiming {
  const safeCount = Number.isFinite(playerCount) ? Math.trunc(playerCount) : rules.minPlayers;
  const normalizedCount = Math.max(rules.minPlayers, Math.min(rules.maxPlayers, safeCount));
  const extraPlayers = Math.max(0, normalizedCount - rules.minPlayers);
  const seekingMs = rules.seekingMs + extraPlayers * rules.seekingMsPerExtraPlayer;
  return {
    playerCount: normalizedCount,
    countdownMs: rules.countdownMs,
    hidingMs: rules.hidingMs,
    seekingMs,
    resultMs: rules.resultMs,
    totalMs: rules.countdownMs + rules.hidingMs + seekingMs + rules.resultMs,
  };
}

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
  previousSeekers: ReadonlySet<string> = new Set(),
): Set<string> {
  const count = seekerCountFor(playerIds.length);
  const eligible = playerIds.filter((playerId) => !previousSeekers.has(playerId));
  const candidates = eligible.length >= count ? eligible : playerIds;
  const shuffled = [...candidates].sort((a, b) => {
    const historyGap = (seekerHistory.get(a) ?? 0) - (seekerHistory.get(b) ?? 0);
    if (historyGap !== 0) return historyGap;
    return seededRank(a, seed) - seededRank(b, seed);
  });
  return new Set(shuffled.slice(0, count));
}

/**
 * 수색 시간 생존 비율을 20·40·60·80점의 네 구간으로 올림한다.
 * 수색이 시작된 뒤 조금이라도 버티면 20점, 한 라운드 최대 생존 점수는 80점이다.
 */
export function survivalScoreFor(survivedMs: number, seekingMs: number): number {
  if (!Number.isFinite(survivedMs) || !Number.isFinite(seekingMs) || seekingMs <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, survivedMs / seekingMs));
  return ratio > 0 ? Math.ceil(ratio * 4) * 20 : 0;
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
