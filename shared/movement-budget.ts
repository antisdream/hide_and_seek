/** 서버 이동과 정지 좌표 보정이 함께 소비하는 시간 예산. 초기 예측 여유는 최대 200ms다. */
export interface MovementBudget { creditMs: number; updatedAt: number }

export function createMovementBudget(now: number): MovementBudget {
  return { creditMs: 200, updatedAt: now };
}

export function consumeMovementTime(
  budget: MovementBudget, now: number, requestedMs: number, kind: "tick" | "anchor",
): number {
  if (!Number.isFinite(now) || !Number.isFinite(requestedMs) || requestedMs <= 0) return 0;
  const requested = kind === "anchor" ? Math.min(200, requestedMs) : requestedMs;
  const elapsed = Math.max(0, now - budget.updatedAt);
  // 현재 서버 tick에 필요한 시간은 보관 상한에 더하지만, 경과하지 않은 시간을 만들어내지 않는다.
  const available = Math.min(200 + (kind === "tick" ? requested : 0), budget.creditMs + elapsed);
  const allowed = Math.min(requested, available);
  budget.creditMs = Math.min(200, available - allowed);
  budget.updatedAt = Math.max(budget.updatedAt, now);
  return allowed;
}
