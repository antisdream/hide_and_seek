import assert from "node:assert/strict";
import test from "node:test";
import { distance, hasLineOfSight, isBlocked, moveWithCollisions } from "../../shared/geometry";
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

test("세 라운드는 서로 다른 밀집형 맵과 유효한 양방향 포탈을 사용한다", () => {
  const maps = [1, 2, 3].map((round) => createMapForRound(91, round));
  assert.equal(MAP_CATALOG.length, 3);
  assert.equal(new Set(maps.map((map) => map.layout.id)).size, 3);
  for (const generated of maps) {
    assert.ok(generated.layout.width >= 32 && generated.layout.width <= 36);
    assert.ok(generated.layout.height >= 21 && generated.layout.height <= 23);
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

test("대각선으로 선반 모서리를 만나도 벽 안으로 들어갔다 튕겨 나오지 않는다", () => {
  const map = {
    id: "corner-test",
    name: "모서리 검증",
    theme: "stationery" as const,
    version: "1",
    width: 8,
    height: 8,
    obstacles: [{ id: "shelf", x: 2, y: 2, width: 3, height: 2 }],
    zones: [],
    portals: [],
  };
  const moved = moveWithCollisions({ x: 1.45, y: 1.45 }, { x: 1, y: 1 }, 9.5, 50, map);
  assert.equal(isBlocked(moved, 0.36, map), false);
  assert.ok(moved.x > 1.45 || moved.y > 1.45);
});

test("숨는 팀과 술래는 화면 주사율이 달라도 같은 선반 모서리 경로로 이동한다", () => {
  const map = {
    id: "partition-test",
    name: "프레임 분할 검증",
    theme: "stationery" as const,
    version: "1",
    width: 14,
    height: 12,
    obstacles: [{ id: "shelf", x: 3, y: 3, width: 6, height: 1 }],
    zones: [],
    portals: [],
  };
  const refreshRates = [30, 50, 60, 75, 90, 120, 144];
  const cases = [
    { label: "숨는 팀", speed: 6.5, start: { x: 2.5, y: 2.8 } },
    { label: "술래", speed: 9.5, start: { x: 2.55, y: 2.85 } },
  ];

  for (const movementCase of cases) {
    const positions = refreshRates.map((refreshRate) => {
      let position = { ...movementCase.start };
      const frameMs = 1_000 / refreshRate;
      for (let frame = 0; frame < refreshRate; frame += 1) {
        position = moveWithCollisions(position, { x: 1, y: 1 }, movementCase.speed, frameMs, map);
      }
      assert.equal(
        isBlocked(position, 0.36, map),
        false,
        `${movementCase.label} ${refreshRate}Hz 결과가 구조물과 겹쳤습니다.`,
      );
      return { refreshRate, position };
    });
    const baseline = positions[0].position;
    for (const { refreshRate, position } of positions.slice(1)) {
      const gap = distance(baseline, position);
      assert.ok(
        gap <= 0.02,
        `${movementCase.label} 30Hz와 ${refreshRate}Hz 경로가 ${gap.toFixed(4)}칸 벌어졌습니다.`,
      );
    }
  }
});

test("120ms의 긴 프레임에서도 숨는 팀과 술래의 이동 시간을 버리지 않는다", () => {
  const map = {
    id: "long-frame-test",
    name: "긴 프레임 검증",
    theme: "stationery" as const,
    version: "1",
    width: 20,
    height: 20,
    obstacles: [],
    zones: [],
    portals: [],
  };

  for (const speed of [6.5, 9.5]) {
    const moved = moveWithCollisions({ x: 2, y: 2 }, { x: 1, y: 0 }, speed, 120, map);
    assert.ok(Math.abs(moved.x - (2 + speed * 0.12)) < 0.000_001);
    assert.equal(moved.y, 2);
  }
});

test("실제 창고 맵의 좁은 통로를 불규칙 프레임과 방향 전환으로 지나도 경로가 갈라지지 않는다", () => {
  const map = createMapForRound(91, 2).layout;
  const segments = [
    { direction: { x: 0, y: -1 }, durationMs: 900 },
    { direction: { x: 1, y: 0 }, durationMs: 350 },
    { direction: { x: 0, y: 1 }, durationMs: 650 },
    { direction: { x: -1, y: 0 }, durationMs: 250 },
  ];
  const run = (framePattern: number[]) => {
    // rack-a와 pillar-a 사이 1.5칸 통로의 중앙에서 시작해 위로 통과한 뒤 기둥 둘레를 돈다.
    let position = { x: 16.75, y: 12.5 };
    let patternIndex = 0;
    const turnPositions: Array<{ x: number; y: number }> = [];
    for (const segment of segments) {
      let remainingMs = segment.durationMs;
      while (remainingMs > 0) {
        const deltaMs = Math.min(remainingMs, framePattern[patternIndex % framePattern.length]);
        patternIndex += 1;
        position = moveWithCollisions(position, segment.direction, 6.5, deltaMs, map);
        assert.equal(
          isBlocked(position, 0.36, map),
          false,
          `불규칙 프레임 ${deltaMs}ms 이동 후 (${position.x.toFixed(4)}, ${position.y.toFixed(4)})가 막혔습니다.`,
        );
        remainingMs -= deltaMs;
      }
      turnPositions.push({ ...position });
    }
    return { position, turnPositions };
  };

  const irregular = run([17, 29, 11, 41, 23, 37, 13]);
  const reference = run([5]);
  assert.ok(irregular.turnPositions[0].y < 7, "좁은 통로를 끝까지 통과하지 못했습니다.");
  assert.ok(irregular.turnPositions[2].y > 10.5, "방향 전환 후 기둥 반대편으로 내려오지 못했습니다.");
  assert.ok(distance(irregular.position, reference.position) <= 0.02);
});
