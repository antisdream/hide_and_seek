import { distance, hasLineOfSight } from "../shared/geometry";
import type { MapLayout, Point } from "../shared/game-types";

/** 화면 보간과 짧은 전달 지연을 보완하는 서버 위치 이력의 최대 나이. */
export const TAG_HISTORY_WINDOW_MS = 200;

export interface TagPosition extends Point {
  at: number;
  entityId: string;
  teleportRevision: number;
}

/** 현재도 보이는 같은 사물의 최근 보행 위치에서 사거리를 검사한다. */
export function wasRecentlyWithinTagRange(
  seeker: Point & { lastTeleportedAt?: number },
  target: Point & { entityId: string; teleportRevision: number; lastMovedAt: number },
  history: readonly TagPosition[],
  now: number,
  tagDistance: number,
  map: MapLayout,
): boolean {
  if (now - target.lastMovedAt > TAG_HISTORY_WINDOW_MS || !hasLineOfSight(seeker, target, map)) return false;
  return history.some((sample) =>
    sample.at <= now
    && sample.at >= (seeker.lastTeleportedAt ?? 0)
    && now - sample.at <= TAG_HISTORY_WINDOW_MS
    && sample.entityId === target.entityId
    && sample.teleportRevision === target.teleportRevision
    && distance(seeker, sample) <= tagDistance
    && hasLineOfSight(seeker, sample, map)
  );
}
