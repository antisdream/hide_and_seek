import assert from "node:assert/strict";
import test from "node:test";
import { TouchActionGesture } from "../../shared/touch-action";

test("조이스틱과 다른 pointer id의 스킬 터치도 실행하고 합성 클릭은 중복 실행하지 않는다", () => {
  const action = new TouchActionGesture();
  assert.equal(action.begin(17), true);
  assert.equal(action.release(17, true, false, 100), true);
  assert.equal(action.allowsClick(110), false); // 합성 click의 pointerType/detail에 의존하지 않는다.
  action.allowNextClick(); // 새 마우스 pointerdown 또는 Enter/Space
  assert.equal(action.allowsClick(110), true);
});

test("다른 포인터·버튼 밖 해제·취소·비활성 스킬은 실행하지 않는다", () => {
  const action = new TouchActionGesture();
  action.begin(1);
  assert.equal(action.begin(2), false);
  assert.equal(action.release(2, true, false, 100), false);
  assert.equal(action.release(1, false, false, 100), false);
  action.begin(3);
  action.cancel(3);
  assert.equal(action.release(3, true, false, 100), false);
  action.begin(4);
  assert.equal(action.release(4, true, true, 100), false);
});
