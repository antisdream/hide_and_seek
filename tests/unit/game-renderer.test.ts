import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPreviewScroll,
  movementSmoothingBlend,
  predictLocalMovement,
  previewCameraZoom,
  projectLocalAuthorityMotion,
  reconcileLocalPosition,
  sampleMotionAt,
  seekerThreatAccent,
} from "../../app/game/game-renderer";
import { isBlocked } from "../../shared/geometry";

const EMPTY_TEST_MAP = {
  id: "empty-renderer-test",
  name: "빈 렌더러 검증 맵",
  theme: "stationery" as const,
  version: "1",
  width: 20,
  height: 20,
  obstacles: [],
  zones: [],
  portals: [],
};

const RECONCILIATION_SHELF_MAP = {
  id: "reconciliation-shelf-test",
  name: "권위 좌표 보정 선반 검증 맵",
  theme: "stationery" as const,
  version: "1",
  width: 14,
  height: 12,
  obstacles: [{ id: "shelf", x: 3, y: 3, width: 6, height: 1 }],
  zones: [],
  portals: [],
};

test("큰 맵의 사전 탐색은 전체가 보이는 배율로 시작한다", () => {
  assert.equal(previewCameraZoom(1_920, 1_200, 960, 640), 0.46);
});

test("확대 후 드래그해도 카메라가 맵 바깥으로 벗어나지 않는다", () => {
  assert.equal(clampPreviewScroll(-100, 1_920, 960, 1), 0);
  assert.equal(clampPreviewScroll(2_000, 1_920, 960, 1), 960);
  assert.equal(clampPreviewScroll(0, 800, 960, 1), -80);
});

test("30Hz 서버 좌표를 화면 프레임 사이에서 빠르고 안정적으로 보간한다", () => {
  assert.equal(movementSmoothingBlend(0), 0);
  assert.ok(movementSmoothingBlend(16) > 0.4);
  assert.ok(movementSmoothingBlend(16) < 0.5);
  assert.equal(movementSmoothingBlend(Number.NaN), 0);
});

test("시간표가 있는 좌표는 두 서버 틱 사이를 선형 보간한다", () => {
  const sampled = sampleMotionAt([
    { serverTime: 1_000, x: 0, y: 0, rotation: 0, teleportRevision: 0 },
    { serverTime: 1_100, x: 40, y: 20, rotation: Math.PI / 2, teleportRevision: 0 },
  ], 1_050);
  assert.ok(sampled);
  assert.equal(sampled.x, 20);
  assert.equal(sampled.y, 10);
  assert.ok(Math.abs(sampled.rotation - Math.PI / 4) < 0.0001);
});

test("스냅숏이 잠깐 늦어져도 외삽 거리를 두 틱 이내로 제한한다", () => {
  const sampled = sampleMotionAt([
    { serverTime: 1_000, x: 0, y: 0, rotation: 0, teleportRevision: 0 },
    { serverTime: 1_100, x: 10, y: 0, rotation: 0, teleportRevision: 0 },
  ], 1_500, 60);
  assert.ok(sampled);
  assert.equal(sampled.x, 16);
});

test("포탈·자리바꿈 좌표는 두 위치 사이를 가로질러 보간하지 않는다", () => {
  const sampled = sampleMotionAt([
    { serverTime: 1_000, x: 40, y: 40, rotation: 0, teleportRevision: 0 },
    { serverTime: 1_100, x: 800, y: 400, rotation: 0, teleportRevision: 1 },
  ], 1_050);
  assert.ok(sampled);
  assert.deepEqual({ x: sampled.x, y: sampled.y }, { x: 40, y: 40 });
});

test("로컬 입력 예측도 서버와 같은 벽 충돌을 적용한다", () => {
  const map = {
    id: "test",
    name: "테스트",
    theme: "stationery" as const,
    version: "1",
    width: 10,
    height: 10,
    obstacles: [{ id: "wall", x: 2, y: 0, width: 1, height: 10 }],
    zones: [],
    portals: [],
  };
  const free = predictLocalMovement({ x: 1, y: 5 }, { x: 0, y: 1 }, 5, 100, map);
  // 150ms 이하의 짧은 프레임 지연은 이동 시간을 버리지 않고 따라잡는다.
  assert.ok(Math.abs(free.y - 5.5) <= 1e-9);
  const blocked = predictLocalMovement({ x: 1.5, y: 5 }, { x: 1, y: 0 }, 5, 100, map);
  // 하위 스텝만큼 벽 앞까지 접근하되 충돌 반경 안으로는 들어가지 않는다.
  assert.ok(blocked.x > 1.5 && blocked.x < 2);
  assert.ok(blocked.x <= 2 - 0.36);
});

test("급회전·키 전환에도 현재 입력을 과거 권위 좌표에 소급 투영하지 않는다", () => {
  const beforeTurn = { serverTime: 1_000, x: 5 * 40, y: 5 * 40, rotation: 0, teleportRevision: 0 };
  const afterTurn = { serverTime: 1_033, x: 5.2 * 40, y: 5 * 40, rotation: -Math.PI / 2, teleportRevision: 0 };

  // 함수 계약에서 현재 입력·속도·현재 시각을 제거해 확인되지 않은 과거 입력을 적용할 수 없게 한다.
  assert.equal(projectLocalAuthorityMotion.length, 1);
  assert.deepEqual(projectLocalAuthorityMotion(beforeTurn), beforeTurn);
  assert.deepEqual(projectLocalAuthorityMotion(afterTurn), afterTurn);
});

test("정지 중 큰 서버 오차도 한 프레임에 순간이동하지 않고 연속 보정한다", () => {
  const corrected = reconcileLocalPosition({ x: 400, y: 80 }, { x: 40, y: 80 }, 16, EMPTY_TEST_MAP);
  assert.ok(corrected.x > 0 && corrected.x < 400);
  assert.equal(corrected.y, 80);
});

test("이동 중에는 누르고 있는 방향의 반대로 권위 좌표를 따라가지 않는다", () => {
  const display = { x: 400, y: 80 };
  const corrected = reconcileLocalPosition(display, { x: 40, y: 80 }, 16, EMPTY_TEST_MAP, { x: 1, y: 0 });
  assert.deepEqual(corrected, display);
});

test("이동 중 횡방향 좌표 보정은 60fps 한 프레임에 3.2px을 넘지 않는다", () => {
  const display = { x: 80, y: 80 };
  const corrected = reconcileLocalPosition(display, { x: 80, y: 480 }, 16, EMPTY_TEST_MAP, { x: 1, y: 0 });
  const correction = Math.hypot(corrected.x - display.x, corrected.y - display.y);
  assert.ok(correction > 0);
  assert.ok(correction <= 3.2 + 0.000_001);
  assert.equal(corrected.x, display.x);
});

test("이동 중 반대편 권위 좌표 보정이 선반 안으로 캐릭터를 밀어 넣지 않는다", () => {
  let display = { x: 4 * 40, y: 2.64 * 40 };
  const authority = { x: 4 * 40, y: 4.36 * 40 };

  for (let frame = 0; frame < 12; frame += 1) {
    const predicted = predictLocalMovement(
      { x: display.x / 40, y: display.y / 40 },
      { x: 1, y: 0 },
      9.5,
      16,
      RECONCILIATION_SHELF_MAP,
    );
    display = reconcileLocalPosition(
      { x: predicted.x * 40, y: predicted.y * 40 },
      authority,
      16,
      RECONCILIATION_SHELF_MAP,
      { x: 1, y: 0 },
    );
    assert.equal(
      isBlocked({ x: display.x / 40, y: display.y / 40 }, 0.36, RECONCILIATION_SHELF_MAP),
      false,
      `${frame}번째 이동 프레임에서 권위 보정이 선반 안으로 들어갔습니다.`,
    );
  }
  assert.ok(display.x > 4 * 40);
  assert.ok(display.y <= 2.64 * 40 + 0.001);
});

test("정지 중 권위 좌표 보정도 선반을 가로질러 반대편으로 이동하지 않는다", () => {
  let display = { x: 4 * 40, y: 2 * 40 };
  const authority = { x: 4 * 40, y: 4.36 * 40 };

  for (let frame = 0; frame < 60; frame += 1) {
    display = reconcileLocalPosition(display, authority, 16, RECONCILIATION_SHELF_MAP);
    assert.equal(
      isBlocked({ x: display.x / 40, y: display.y / 40 }, 0.36, RECONCILIATION_SHELF_MAP),
      false,
      `${frame}번째 정지 보정 프레임에서 권위 보정이 선반 안으로 들어갔습니다.`,
    );
  }
  assert.ok(display.y <= 2.64 * 40 + 0.001);
});

test("밤지기 위협 외형은 아바타마다 오라 색을 유지하고 기본값을 제공한다", () => {
  assert.notEqual(seekerThreatAccent("coral"), seekerThreatAccent("blue"));
  assert.notEqual(seekerThreatAccent("mint"), seekerThreatAccent("violet"));
  assert.equal(seekerThreatAccent(undefined), seekerThreatAccent("unknown"));
});
