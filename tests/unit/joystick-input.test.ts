import assert from "node:assert/strict";
import test from "node:test";
import { JoystickGesture, JoystickSendLimiter, joystickInput } from "../../shared/joystick-input";
import { normalizeMove } from "../../shared/game-rules";

test("중앙 손떨림과 잘못된 좌표는 정지하고 바깥 움직임은 원형으로 제한한다", () => {
  for (const [x, y, radius] of [[0, 0, 50], [-2, 3, 50], [NaN, 1, 50], [1, Infinity, 50], [1, 1, 0]]) {
    assert.deepEqual(joystickInput(x, y, radius).direction, { x: 0, y: 0 });
  }
  const value = joystickInput(300, -400, 50);
  assert.deepEqual(value.offset, { x: 30, y: -40 });
  assert.deepEqual(value.direction, { x: 0.6, y: -0.8 });
  assert.deepEqual(normalizeMove(value.direction.x, value.direction.y), value.direction);
});

test("조이스틱의 부분 세기와 임의의 각도를 서버 입력에서도 유지한다", () => {
  for (const angle of [0, Math.PI / 9, Math.PI / 2, Math.PI, Math.PI * 1.7]) {
    const direction = joystickInput(Math.cos(angle) * 28.5, Math.sin(angle) * 28.5, 50).direction;
    assert.ok(Math.abs(Math.hypot(direction.x, direction.y) - 0.5) < 1e-9);
    assert.deepEqual(normalizeMove(direction.x, direction.y), direction);
  }
});

test("스킬을 누르는 두 번째 손가락은 조이스틱의 소유권과 정지를 바꾸지 않는다", () => {
  const gesture = new JoystickGesture();
  assert.equal(gesture.begin(10), true);
  assert.equal(gesture.begin(11), false);
  assert.equal(gesture.end(11), false);
  assert.equal(gesture.owns(10), true);
  assert.equal(gesture.end(10), true);
  assert.equal(gesture.owns(10), false);
});

test("고정·취소·화면 전환으로 초기화한 터치는 새로 눌러야 다시 이동한다", () => {
  const gesture = new JoystickGesture();
  gesture.begin(5);
  gesture.reset();
  assert.equal(gesture.owns(5), false);
  assert.equal(gesture.end(5), false);
  assert.equal(gesture.begin(6), true);
});

function scheduler() {
  let now = 0;
  let input = true;
  const sent: { at: number; moving: boolean }[] = [];
  const pending = new Map<number, { at: number; callback: () => void }>();
  let id = 0;
  const limiter = new JoystickSendLimiter(() => sent.push({ at: now, moving: input }), () => now, (callback, delay) => {
    const token = ++id;
    pending.set(token, { at: now + delay, callback });
    return () => { pending.delete(token); };
  });
  const advance = (target: number) => {
    while (true) {
      const next = [...pending].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      pending.delete(next[0]);
      next[1].callback();
    }
    now = target;
  };
  return { limiter, sent, advance, setInput: (value: boolean) => { input = value; } };
}

test("초당 250번의 터치 이동에도 방향 전송은 초당 17회 이하로 제한한다", () => {
  const clock = scheduler();
  for (let at = 0; at < 1000; at += 4) {
    clock.advance(at);
    clock.limiter.request(true);
  }
  assert.equal(clock.sent.length, 17);
  // 유지 heartbeat 5회와 행동 입력이 더해져도 서버의 초당 45회 한도에 여유가 있다.
  assert.ok(clock.sent.length + 5 < 45);
});

test("손을 떼면 대기 중인 이동을 취소하고 정지를 바로 보내며 이전 입력이 재개되지 않는다", () => {
  const clock = scheduler();
  clock.limiter.request(true);
  clock.advance(10);
  clock.limiter.request(true);
  clock.advance(11);
  clock.setInput(false);
  clock.limiter.request(false);
  clock.advance(1000);
  assert.deepEqual(clock.sent, [{ at: 0, moving: true }, { at: 11, moving: false }]);
});

test("연결 종료·고정 reset은 예약된 전송을 없애고 다음 새 입력을 즉시 허용한다", () => {
  const clock = scheduler();
  clock.limiter.request(true);
  clock.advance(10);
  clock.limiter.request(true);
  clock.limiter.reset();
  clock.advance(500);
  assert.equal(clock.sent.length, 1);
  clock.limiter.request(true);
  assert.equal(clock.sent[1].at, 500);
});

test("정지 직후 다시 눌렀다 떼어도 새 터치의 시작·정지 입력이 모두 전달된다", () => {
  const clock = scheduler();
  for (const [at, moving] of [[0, true], [10, false], [20, true], [40, false]] as const) {
    clock.advance(at);
    clock.setInput(moving);
    if (moving) clock.limiter.reset(); // 실제 pointerdown에만 초기화
    clock.limiter.request(moving);
  }
  clock.advance(1000);
  assert.deepEqual(clock.sent, [
    { at: 0, moving: true }, { at: 10, moving: false }, { at: 20, moving: true }, { at: 40, moving: false },
  ]);
});

test("한 터치가 중앙 경계를 빠르게 오가도 중복 정지를 제외한 서버 신호가 몰리지 않는다", () => {
  for (const interval of [4, 12, 30, 64]) {
    const clock = scheduler();
    for (let at = 0, index = 0; at < 1000; at += interval, index += 1) {
      clock.advance(at);
      clock.setInput(index % 2 === 0);
      clock.limiter.request(index % 2 === 0);
    }
    let wasMoving = false;
    const transport = clock.sent.filter((message) => {
      const send = message.moving || wasMoving;
      wasMoving = message.moving;
      return send;
    });
    assert.ok(transport.length + 5 < 40, `${interval}ms 경계 왕복: ${transport.length}개`);
  }
});
