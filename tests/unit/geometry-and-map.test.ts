import assert from "node:assert/strict";
import test from "node:test";
import { distance, hasLineOfSight, isBlocked } from "../../shared/geometry";
import {
  createMapForRound,
  createNightStationeryMap,
  findPortalTransfer,
  MAP_CATALOG,
} from "../../shared/map-generator";

test("같은 시드는 같은 맵을 만들고 시드는 공개 레이아웃에 포함하지 않는다", () => {
  const first = createNightStationeryMap(20_260_815);
  const second = createNightStationeryMap(20_260_815);
  assert.deepEqual(first, second);
  assert.equal("seed" in first.layout, false);
  assert.ok(first.staticProps.length >= 56);
});

test("세 라운드는 서로 다른 대형 맵과 유효한 양방향 포탈을 사용한다", () => {
  const maps = [1, 2, 3].map((round) => createMapForRound(91, round));
  assert.equal(MAP_CATALOG.length, 3);
  assert.equal(new Set(maps.map((map) => map.layout.id)).size, 3);
  for (const generated of maps) {
    assert.ok(generated.layout.width >= 34);
    assert.ok(generated.layout.height >= 22);
    assert.ok(generated.layout.obstacles.length >= 10);
    assert.ok(generated.staticProps.length >= 56);
    assert.ok(generated.layout.portals.length >= 4);
    for (const portal of generated.layout.portals) {
      const target = generated.layout.portals.find((candidate) => candidate.id === portal.targetId);
      assert.ok(target, `${portal.id}의 도착 포탈이 없습니다.`);
      assert.equal(target.targetId, portal.id);
    }
  }
});

test("세 맵의 사물과 포탈 도착점은 이동 가능한 위치에 놓인다", () => {
  for (const round of [1, 2, 3]) {
    const generated = createMapForRound(91, round);
    for (const prop of generated.staticProps) {
      assert.equal(isBlocked(prop, 0.36, generated.layout), false, `${prop.id}가 이동 불가 영역에 놓였습니다.`);
    }
    for (const spawn of [...generated.seekerSpawns, ...generated.hiderSpawns]) {
      assert.equal(isBlocked(spawn, 0.36, generated.layout), false, `시작점 (${spawn.x}, ${spawn.y})이 막혔습니다.`);
    }
    for (const spawn of generated.seekerSpawns) {
      assert.equal(
        generated.layout.portals.some((portal) => distance(spawn, portal) <= portal.radius),
        false,
        `관찰자 시작점 (${spawn.x}, ${spawn.y})이 포탈 안에 있습니다.`,
      );
    }
    for (const portal of generated.layout.portals) {
      const transfer = findPortalTransfer(portal, generated.layout);
      assert.ok(transfer);
      assert.equal(isBlocked(transfer, 0.36, generated.layout), false, `${portal.id}의 도착점이 막혔습니다.`);
    }
  }
});

test("선반을 가로지르는 확인은 시야 판정에서 차단한다", () => {
  const generated = createNightStationeryMap(7);
  assert.equal(hasLineOfSight({ x: 4, y: 3.5 }, { x: 4, y: 5.5 }, generated.layout), false);
  assert.equal(hasLineOfSight({ x: 1, y: 1 }, { x: 2, y: 2 }, generated.layout), true);
});
