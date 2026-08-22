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
  // 탭 전환 등으로 프레임이 길어져도 한 번에 50ms 이상 예측하지 않는다.
  assert.equal(free.y, 5.25);
  const blocked = predictLocalMovement({ x: 1.5, y: 5 }, { x: 1, y: 0 }, 5, 100, map);
  // 하위 스텝만큼 벽 앞까지 접근하되 충돌 반경 안으로는 들어가지 않는다.
  assert.ok(blocked.x > 1.5 && blocked.x < 2);
  assert.ok(blocked.x <= 2 - 0.36);
});

test("지연된 권위 좌표도 50ms에서 멈추지 않고 현재 시각까지 나눠 투영한다", () => {
  const map = {
    id: "projection-test",
    name: "투영 검증",
    theme: "stationery" as const,
    version: "1",
    width: 20,
    height: 20,
    obstacles: [],
    zones: [],
    portals: [],
  };
  const projected = projectLocalAuthorityMotion(
    { serverTime: 1_000, x: 5 * 40, y: 5 * 40, rotation: 0, teleportRevision: 0 },
    { x: -1, y: 0 },
    5,
    1_200,
    map,
  );
  assert.equal(projected.serverTime, 1_200);
  assert.ok(Math.abs(projected.x - 4 * 40) < 0.001);
});

test("이동 중 큰 서버 오차도 한 프레임에 순간이동하지 않고 연속 보정한다", () => {
  const corrected = reconcileLocalPosition({ x: 400, y: 80 }, { x: 0, y: 80 }, 16);
  assert.ok(corrected.x > 0 && corrected.x < 400);
  assert.equal(corrected.y, 80);
});

test("밤지기 위협 외형은 아바타마다 오라 색을 유지하고 기본값을 제공한다", () => {
  assert.notEqual(seekerThreatAccent("coral"), seekerThreatAccent("blue"));
  assert.notEqual(seekerThreatAccent("mint"), seekerThreatAccent("violet"));
  assert.equal(seekerThreatAccent(undefined), seekerThreatAccent("unknown"));
});
