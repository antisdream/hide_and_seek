/** 두 번째 손가락의 pointerup으로도 스킬을 실행하고 뒤따르는 합성 click은 한 번만 처리한다. */
export class TouchActionGesture {
  private pointerId: number | undefined;
  private suppressClickUntil = -Infinity;
  begin(pointerId: number): boolean {
    if (this.pointerId !== undefined) return false;
    this.pointerId = pointerId;
    return true;
  }
  release(pointerId: number, inside: boolean, disabled: boolean, now: number): boolean {
    if (this.pointerId !== pointerId) return false;
    this.pointerId = undefined;
    this.suppressClickUntil = now + 1000;
    return inside && !disabled;
  }
  cancel(pointerId: number): void {
    if (this.pointerId === pointerId) this.pointerId = undefined;
  }
  allowNextClick(): void { this.suppressClickUntil = -Infinity; }
  allowsClick(now: number): boolean { return now > this.suppressClickUntil; }
}
