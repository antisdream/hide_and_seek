import assert from "node:assert/strict";
import test from "node:test";
import { wasRecentlyWithinTagRange } from "../../server/tag-history";
import type { MapLayout } from "../../shared/game-types";

const map: MapLayout = { id: "tag-test", name: "판정 검증", theme: "stationery", version: "1", width: 30, height: 20, obstacles: [], zones: [], portals: [] };
const seeker = { x: 10, y: 2 };
const target = { x: 12.8875, y: 2, entityId: "moving-prop", teleportRevision: 0, lastMovedAt: 1_000 };
const sample = { x: 12.4, y: 2, at: 925, entityId: target.entityId, teleportRevision: 0 };

test("75ms 전 화면상 사거리 안에서 이동한 숨는 사물을 서버 이력으로 판정한다", () => {
  assert.equal(wasRecentlyWithinTagRange(seeker, target, [sample], 1_000, 2.6, map), true);
});

test("오래되거나 미래인 위치, 사거리 밖 위치와 멈춘 대상은 보정하지 않는다", () => {
  for (const invalid of [{ ...sample, at: 799 }, { ...sample, at: 1_001 }, { ...sample, x: 13 }]) {
    assert.equal(wasRecentlyWithinTagRange(seeker, target, [invalid], 1_000, 2.6, map), false);
  }
  assert.equal(wasRecentlyWithinTagRange(seeker, { ...target, lastMovedAt: 700 }, [sample], 1_000, 2.6, map), false);
});

test("포탈이나 자리바꿈 이전의 위치 이력으로 잡지 않는다", () => {
  assert.equal(wasRecentlyWithinTagRange(seeker, { ...target, teleportRevision: 1 }, [sample], 1_000, 2.6, map), false);
  assert.equal(wasRecentlyWithinTagRange(seeker, { ...target, entityId: "swapped-prop" }, [sample], 1_000, 2.6, map), false);
  assert.equal(wasRecentlyWithinTagRange({ ...seeker, lastTeleportedAt: 950 }, target, [sample], 1_000, 2.6, map), false);
  assert.equal(wasRecentlyWithinTagRange({ ...seeker, lastTeleportedAt: 900 }, target, [sample], 1_000, 2.6, map), true);
});

test("현재 또는 과거 위치가 선반에 가려져 있으면 과거 사거리로 잡지 않는다", () => {
  const currentBlocked = { ...map, obstacles: [{ id: "shelf", x: 12.6, y: 1, width: 0.1, height: 2 }] };
  assert.equal(wasRecentlyWithinTagRange(seeker, target, [sample], 1_000, 2.6, currentBlocked), false);
  const pastBlocked = { ...map, obstacles: [{ id: "shelf", x: 11.5, y: 1.9, width: 0.2, height: 0.2 }] };
  assert.equal(wasRecentlyWithinTagRange(seeker, { ...target, y: 4 }, [sample], 1_000, 2.6, pastBlocked), false);
});
