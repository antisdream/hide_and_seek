import type { Point } from "./game-types";

export const JOYSTICK_SEND_INTERVAL_MS = 60;
export const JOYSTICK_DEAD_ZONE = 0.14;

/** 원 안의 작은 손떨림은 무시하고, 나머지 이동량은 0~1 속도로 부드럽게 연결한다. */
export function joystickInput(dx: number, dy: number, radius: number): { direction: Point; offset: Point } {
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || !Number.isFinite(radius) || radius <= 0 || length === 0) {
    return { direction: { x: 0, y: 0 }, offset: { x: 0, y: 0 } };
  }
  const distance = Math.min(length, radius);
  const scale = Math.max(0, (distance / radius - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE));
  return {
    direction: scale === 0 ? { x: 0, y: 0 } : { x: dx / length * scale, y: dy / length * scale },
    offset: { x: dx / length * distance, y: dy / length * distance },
  };
}

/** 이동 중 전송은 약 17Hz로 제한한다. 정지는 예약을 취소하고 즉시 보낸다. 새 터치는 reset 후 시작한다. */
export class JoystickSendLimiter {
  private cancelPending: (() => void) | undefined;
  private lastSentAt = -Infinity;
  constructor(private readonly send: () => void, private readonly now: () => number,
    private readonly schedule: (callback: () => void, delay: number) => () => void) {}
  request(moving: boolean): void {
    const remaining = JOYSTICK_SEND_INTERVAL_MS - (this.now() - this.lastSentAt);
    if (!moving || remaining <= 0) {
      this.cancelPending?.();
      this.cancelPending = undefined;
      this.flush();
    } else if (!this.cancelPending) {
      this.cancelPending = this.schedule(() => {
        this.cancelPending = undefined;
        this.flush();
      }, remaining);
    }
  }
  reset(): void {
    this.cancelPending?.();
    this.cancelPending = undefined;
    this.lastSentAt = -Infinity;
  }
  private flush(): void { this.lastSentAt = this.now(); this.send(); }
}

/** 한 손가락만 이동을 소유한다. 스킬을 누르는 다른 손가락이 이동을 바꾸거나 끝내지 않는다. */
export class JoystickGesture {
  pointerId: number | undefined;
  begin(pointerId: number): boolean {
    if (this.pointerId !== undefined) return false;
    this.pointerId = pointerId;
    return true;
  }
  owns(pointerId: number): boolean { return this.pointerId === pointerId; }
  end(pointerId: number): boolean {
    if (!this.owns(pointerId)) return false;
    this.reset();
    return true;
  }
  reset(): void { this.pointerId = undefined; }
}
