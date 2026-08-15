import assert from "node:assert/strict";
import test from "node:test";
import { hasLineOfSight, isBlocked } from "../../shared/geometry";
import { createNightStationeryMap } from "../../shared/map-generator";

test("같은 시드는 같은 맵을 만들고 시드는 공개 레이아웃에 포함하지 않는다", () => {
  const first = createNightStationeryMap(20_260_815);
  const second = createNightStationeryMap(20_260_815);
  assert.deepEqual(first, second);
  assert.equal("seed" in first.layout, false);
  assert.ok(first.staticProps.length >= 28);
});

test("생성된 사물은 벽과 선반 안에 놓이지 않는다", () => {
  const generated = createNightStationeryMap(91);
  for (const prop of generated.staticProps) {
    assert.equal(isBlocked(prop, 0.36, generated.layout), false, `${prop.id}가 이동 불가 영역에 놓였습니다.`);
  }
});

test("선반을 가로지르는 확인은 시야 판정에서 차단한다", () => {
  const generated = createNightStationeryMap(7);
  assert.equal(hasLineOfSight({ x: 4, y: 3.5 }, { x: 4, y: 5.5 }, generated.layout), false);
  assert.equal(hasLineOfSight({ x: 1, y: 1 }, { x: 2, y: 2 }, generated.layout), true);
});
