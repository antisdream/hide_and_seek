import type { MapLayout, Point, Rect } from "./game-types";

/** 사람과 AI가 함께 사용하는 충돌 반경과 서버가 한 번에 따라잡을 수 있는 최대 이동 시간이다. */
export const PLAYER_COLLISION_RADIUS = 0.36;
export const MAX_MOVEMENT_DELTA_MS = 150;
const COLLISION_EPSILON = 0.000_001;
const MAX_COLLISION_STEP = 0.02;

interface SweepHit {
  time: number;
  normal: Point;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function circleTouchesRect(point: Point, radius: number, rect: Rect): boolean {
  const closestX = clamp(point.x, rect.x, rect.x + rect.width);
  const closestY = clamp(point.y, rect.y, rect.y + rect.height);
  // sweep가 계산한 정확한 접촉점은 부동소수점 오차만으로 겹침으로 판정하지 않는다.
  return Math.hypot(point.x - closestX, point.y - closestY) < radius - COLLISION_EPSILON;
}

export function isBlocked(point: Point, radius: number, map: MapLayout): boolean {
  if (
    point.x - radius < -COLLISION_EPSILON ||
    point.y - radius < -COLLISION_EPSILON ||
    point.x + radius > map.width + COLLISION_EPSILON ||
    point.y + radius > map.height + COLLISION_EPSILON
  ) {
    return true;
  }
  return map.obstacles.some((rect) => circleTouchesRect(point, radius, rect));
}

/**
 * 이동 원과 구조물의 직선 면·둥근 모서리에서 최초 접촉 지점을 구한 뒤 벽면을 따라 미끄러진다.
 * 프레임을 30번 또는 120번으로 나눠도 같은 충돌 경로를 선택해 화면과 서버 좌표가 갈라지지 않는다.
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
  const totalMovement = {
    x: direction.x * safeSpeed * (safeDelta / 1_000),
    y: direction.y * safeSpeed * (safeDelta / 1_000),
  };
  return moveByVectorWithCollisions(point, totalMovement, map, radius);
}

/**
 * 시간·속도와 무관한 임의 이동 벡터에도 공용 sweep 충돌을 적용한다.
 * 화면의 권위 좌표 보정처럼 짧은 보정 이동이 구조물을 가로지르지 않게 할 때 사용한다.
 */
export function moveByVectorWithCollisions(
  point: Point,
  movement: Point,
  map: MapLayout,
  radius = PLAYER_COLLISION_RADIUS,
): Point {
  if (!Number.isFinite(movement.x) || !Number.isFinite(movement.y)) return { ...point };
  const movementLength = Math.hypot(movement.x, movement.y);
  if (movementLength <= COLLISION_EPSILON) return { ...point };
  const next = { ...point };

  // 둥근 모서리를 따라가는 곡선도 화면 주사율에 따라 달라지지 않도록 0.02칸 이하로 적분한다.
  const stepCount = Math.max(1, Math.ceil(movementLength / MAX_COLLISION_STEP));
  const stepMovement = {
    x: movement.x / stepCount,
    y: movement.y / stepCount,
  };
  for (let step = 0; step < stepCount; step += 1) {
    let remaining = { ...stepMovement };
    // 한 스텝에서 모서리와 좁은 통로가 겹쳐도 최대 네 번까지 접촉을 해결한다.
    for (let iteration = 0; iteration < 4; iteration += 1) {
      if (Math.hypot(remaining.x, remaining.y) <= COLLISION_EPSILON) break;
      const hit = earliestSweepHit(next, remaining, map, radius);
      if (!hit) {
        next.x += remaining.x;
        next.y += remaining.y;
        break;
      }

      const travelTime = Math.max(0, hit.time);
      next.x += remaining.x * travelTime;
      next.y += remaining.y * travelTime;

      const left = Math.max(0, 1 - hit.time);
      const slide = { x: remaining.x * left, y: remaining.y * left };
      const intoWall = slide.x * hit.normal.x + slide.y * hit.normal.y;
      if (intoWall < 0) {
        slide.x -= hit.normal.x * intoWall;
        slide.y -= hit.normal.y * intoWall;
      }
      remaining = slide;
    }
  }

  const result = {
    x: clamp(next.x, radius, map.width - radius),
    y: clamp(next.y, radius, map.height - radius),
  };
  // 유효한 시작점에서 출발한 이동은 수치 오차나 예외적인 접촉 조합으로 구조물 안에 끝나지 않는다.
  return !isBlocked(point, radius, map) && isBlocked(result, radius, map) ? { ...point } : result;
}

function earliestSweepHit(point: Point, movement: Point, map: MapLayout, radius: number): SweepHit | undefined {
  let earliest: SweepHit | undefined;
  const consider = (candidate: SweepHit | undefined) => {
    if (!candidate) return;
    if (!earliest || candidate.time < earliest.time - COLLISION_EPSILON) {
      earliest = candidate;
      return;
    }
    if (Math.abs(candidate.time - earliest.time) <= COLLISION_EPSILON) {
      const x = earliest.normal.x + candidate.normal.x;
      const y = earliest.normal.y + candidate.normal.y;
      const length = Math.hypot(x, y) || 1;
      earliest = { time: earliest.time, normal: { x: x / length, y: y / length } };
    }
  };

  const minX = radius;
  const maxX = map.width - radius;
  const minY = radius;
  const maxY = map.height - radius;
  if (movement.x < 0 && point.x + movement.x < minX) {
    consider({ time: (minX - point.x) / movement.x, normal: { x: 1, y: 0 } });
  }
  if (movement.x > 0 && point.x + movement.x > maxX) {
    consider({ time: (maxX - point.x) / movement.x, normal: { x: -1, y: 0 } });
  }
  if (movement.y < 0 && point.y + movement.y < minY) {
    consider({ time: (minY - point.y) / movement.y, normal: { x: 0, y: 1 } });
  }
  if (movement.y > 0 && point.y + movement.y > maxY) {
    consider({ time: (maxY - point.y) / movement.y, normal: { x: 0, y: -1 } });
  }

  for (const rect of map.obstacles) consider(sweepCircleAgainstRect(point, movement, rect, radius));
  return earliest;
}

/**
 * 원과 사각형의 정확한 Minkowski 경계를 사용한다. 단순 확장 사각형은 실제로는 둥근
 * 모서리를 네모로 막아 프레임 길이에 따라 한쪽 벽을 선택하는 문제가 생긴다.
 */
function sweepCircleAgainstRect(point: Point, movement: Point, rect: Rect, radius: number): SweepHit | undefined {
  let earliest: SweepHit | undefined;
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;
  const consider = (time: number, normal: Point) => {
    if (time < -COLLISION_EPSILON || time > 1 + COLLISION_EPSILON) return;
    if (movement.x * normal.x + movement.y * normal.y >= -COLLISION_EPSILON) return;
    const candidate = { time: clamp(time, 0, 1), normal };
    if (!earliest || candidate.time < earliest.time - COLLISION_EPSILON) {
      earliest = candidate;
      return;
    }
    if (Math.abs(candidate.time - earliest.time) <= COLLISION_EPSILON) {
      const combined = {
        x: earliest.normal.x + normal.x,
        y: earliest.normal.y + normal.y,
      };
      const length = Math.hypot(combined.x, combined.y);
      if (length > COLLISION_EPSILON) {
        earliest = {
          time: earliest.time,
          normal: { x: combined.x / length, y: combined.y / length },
        };
      }
    }
  };

  // 직선 면 충돌은 반대 축이 실제 사각형 구간 안에 있을 때만 인정한다.
  if (movement.x > COLLISION_EPSILON) {
    const time = (rect.x - radius - point.x) / movement.x;
    const y = point.y + movement.y * time;
    if (y >= rect.y - COLLISION_EPSILON && y <= maxY + COLLISION_EPSILON) consider(time, { x: -1, y: 0 });
  } else if (movement.x < -COLLISION_EPSILON) {
    const time = (maxX + radius - point.x) / movement.x;
    const y = point.y + movement.y * time;
    if (y >= rect.y - COLLISION_EPSILON && y <= maxY + COLLISION_EPSILON) consider(time, { x: 1, y: 0 });
  }
  if (movement.y > COLLISION_EPSILON) {
    const time = (rect.y - radius - point.y) / movement.y;
    const x = point.x + movement.x * time;
    if (x >= rect.x - COLLISION_EPSILON && x <= maxX + COLLISION_EPSILON) consider(time, { x: 0, y: -1 });
  } else if (movement.y < -COLLISION_EPSILON) {
    const time = (maxY + radius - point.y) / movement.y;
    const x = point.x + movement.x * time;
    if (x >= rect.x - COLLISION_EPSILON && x <= maxX + COLLISION_EPSILON) consider(time, { x: 0, y: 1 });
  }

  const corners = [
    { x: rect.x, y: rect.y, xSide: -1, ySide: -1 },
    { x: maxX, y: rect.y, xSide: 1, ySide: -1 },
    { x: rect.x, y: maxY, xSide: -1, ySide: 1 },
    { x: maxX, y: maxY, xSide: 1, ySide: 1 },
  ] as const;
  const a = movement.x * movement.x + movement.y * movement.y;
  for (const corner of corners) {
    const offsetX = point.x - corner.x;
    const offsetY = point.y - corner.y;
    const b = 2 * (offsetX * movement.x + offsetY * movement.y);
    const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < -COLLISION_EPSILON) continue;
    const time = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
    if (time < -COLLISION_EPSILON || time > 1 + COLLISION_EPSILON) continue;
    const x = point.x + movement.x * time;
    const y = point.y + movement.y * time;
    if ((x - corner.x) * corner.xSide < -COLLISION_EPSILON || (y - corner.y) * corner.ySide < -COLLISION_EPSILON) continue;
    const normalX = x - corner.x;
    const normalY = y - corner.y;
    const normalLength = Math.hypot(normalX, normalY);
    if (normalLength <= COLLISION_EPSILON) continue;
    consider(time, { x: normalX / normalLength, y: normalY / normalLength });
  }

  return earliest;
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
