import assert from "node:assert/strict";
import test from "node:test";
import { clampPreviewScroll, previewCameraZoom } from "../../app/game/game-renderer";

test("큰 맵의 사전 탐색은 전체가 보이는 배율로 시작한다", () => {
  assert.equal(previewCameraZoom(1_920, 1_200, 960, 640), 0.46);
});

test("확대 후 드래그해도 카메라가 맵 바깥으로 벗어나지 않는다", () => {
  assert.equal(clampPreviewScroll(-100, 1_920, 960, 1), 0);
  assert.equal(clampPreviewScroll(2_000, 1_920, 960, 1), 960);
  assert.equal(clampPreviewScroll(0, 800, 960, 1), -80);
});
