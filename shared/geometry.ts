import type { MapLayout, Point, Rect } from "./game-types";

/** 사람과 AI가 함께 사용하는 충돌 반경과 한 번에 처리할 수 있는 최대 이동 시간이다. */
export const PLAYER_COLLISION_RADIUS = 0.36;
export const MAX_MOVEMENT_DELTA_MS = 50;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function circleTouchesRect(point: Point, radius: number, rect: Rect): boolean {
  const closestX = clamp(point.x, rect.x, rect.x + rect.width);
  const closestY = clamp(point.y, rect.y, rect.y + rect.height);
  return Math.hypot(point.x - closestX, point.y - closestY) < radius;
}

export function isBlocked(point: Point, radius: number, map: MapLayout): boolean {
  if (
    point.x - radius < 0 ||
    point.y - radius < 0 ||
    point.x + radius > map.width ||
    point.y + radius > map.height
  ) {
    return true;
  }
  return map.obstacles.some((rect) => circleTouchesRect(point, radius, rect));
}

/**
 * 서버와 클라이언트가 같은 순서로 충돌을 계산하는 공용 이동 적분기다.
 * 긴 프레임은 작은 거리로 나눠 얇은 선반을 건너뛰지 않으며, X를 적용한 좌표로 Y를 판정한다.
 */
export function moveWithCollisions(
  point: Point,
  input: Point,
  speed: number,
  deltaMs: number,
  map: MapLayout,
  radius = PLAYER_COLLISION_RADIUS,
): Point {
  const safeDelta = Number.isFinite(deltaMs)
    ? Math.max(0, Math.min(MAX_MOVEMENT_DELTA_MS, deltaMs))
    : 0;
  const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const inputLength = Math.hypot(input.x, input.y);
  if (safeDelta === 0 || safeSpeed === 0 || !Number.isFinite(inputLength) || inputLength === 0) {
    return { ...point };
  }

  const direction = inputLength > 1
    ? { x: input.x / inputLength, y: input.y / inputLength }
    : { x: input.x, y: input.y };
  const totalStep = safeSpeed * (safeDelta / 1_000);
  // 충돌 반경의 절반보다 짧은 하위 스텝으로 얇은 구조물 통과와 모서리 겹침을 막는다.
  const maxSubstep = Math.max(0.01, radius * 0.5);
  const substepCount = Math.max(1, Math.ceil(totalStep / maxSubstep));
  const substep = totalStep / substepCount;
  const next = { ...point };

  for (let index = 0; index < substepCount; index += 1) {
    const nextX = { x: next.x + direction.x * substep, y: next.y };
    if (!isBlocked(nextX, radius, map)) next.x = nextX.x;

    const nextY = { x: next.x, y: next.y + direction.y * substep };
    if (!isBlocked(nextY, radius, map)) next.y = nextY.y;
  }

  return next;
}

export function hasLineOfSight(from: Point, to: Point, map: MapLayout): boolean {
  return !map.obstacles.some((rect) => segmentIntersectsRect(from, to, rect));
}

/** Liang–Barsky 방식으로 선분이 선반 사각형 내부를 통과하는지 검사한다. */
export function segmentIntersectsRect(from: Point, to: Point, rect: Rect): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const p = [-dx, dx, -dy, dy];
  const q = [
    from.x - rect.x,
    rect.x + rect.width - from.x,
    from.y - rect.y,
    rect.y + rect.height - from.y,
  ];

  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 4; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return false;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return false;
  }
  return true;
}
