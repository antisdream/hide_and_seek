import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPreviewScroll,
  movementSmoothingBlend,
  previewCameraZoom,
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

test("밤지기 위협 외형은 아바타마다 오라 색을 유지하고 기본값을 제공한다", () => {
  assert.notEqual(seekerThreatAccent("coral"), seekerThreatAccent("blue"));
  assert.notEqual(seekerThreatAccent("mint"), seekerThreatAccent("violet"));
  assert.equal(seekerThreatAccent(undefined), seekerThreatAccent("unknown"));
});
