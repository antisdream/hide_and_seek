/** 승패 능력을 판매하지 않는 위험/보상 행동. 모든 판정은 서버에서 수행한다. */
export const TAUNT_RULES = {
  survivalMs: 6_000,
  cooldownMs: 20_000,
  usesPerRound: 2,
  reward: 20,
} as const;

export interface TauntState {
  readyAt: number;
  resolvesAt: number;
  remaining: number;
}

export function canTaunt(state: TauntState, now: number, phaseEndsAt: number): boolean {
  return state.remaining > 0 && state.resolvesAt === 0 && now >= state.readyAt
    && phaseEndsAt - now > TAUNT_RULES.survivalMs;
}
