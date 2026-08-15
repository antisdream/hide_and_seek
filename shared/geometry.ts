import type { MapLayout, Point, Rect } from "./game-types";

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
