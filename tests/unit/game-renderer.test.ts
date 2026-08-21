import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPreviewScroll,
  movementSmoothingBlend,
  predictLocalMovement,
  previewCameraZoom,
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
    { serverTime: 1_000, x: 0, y: 0, rotation: 0 },
    { serverTime: 1_100, x: 40, y: 20, rotation: Math.PI / 2 },
  ], 1_050);
  assert.ok(sampled);
  assert.equal(sampled.x, 20);
  assert.equal(sampled.y, 10);
  assert.ok(Math.abs(sampled.rotation - Math.PI / 4) < 0.0001);
});

test("스냅숏이 잠깐 늦어져도 외삽 거리를 두 틱 이내로 제한한다", () => {
  const sampled = sampleMotionAt([
    { serverTime: 1_000, x: 0, y: 0, rotation: 0 },
    { serverTime: 1_100, x: 10, y: 0, rotation: 0 },
  ], 1_500, 60);
  assert.ok(sampled);
  assert.equal(sampled.x, 16);
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
  assert.equal(blocked.x, 1.5);
});

test("밤지기 위협 외형은 아바타마다 오라 색을 유지하고 기본값을 제공한다", () => {
  assert.notEqual(seekerThreatAccent("coral"), seekerThreatAccent("blue"));
  assert.notEqual(seekerThreatAccent("mint"), seekerThreatAccent("violet"));
  assert.equal(seekerThreatAccent(undefined), seekerThreatAccent("unknown"));
});
