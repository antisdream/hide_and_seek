import assert from "node:assert/strict";
import test from "node:test";
import { actionForShortcut } from "../../shared/action-shortcuts";
import type { GameSnapshot } from "../../shared/game-types";

type ShortcutEvent = Parameters<typeof actionForShortcut>[0];
type ShortcutSnapshot = Pick<GameSnapshot, "phase" | "phaseEndsAt" | "self" | "seekerPreview" | "serverTime">;

function key(code: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { code, repeat: false, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides };
}

function snapshot(role: GameSnapshot["self"]["role"] = "HIDER"): ShortcutSnapshot {
  return {
    phase: "SEEKING",
    phaseEndsAt: 70_000,
    serverTime: 10_000,
    seekerPreview: false,
    self: {
      playerId: "shortcut-player", role, focus: 100, locked: false, swapAvailable: true,
      tagReadyAt: 0, lensReadyAt: 10_000, caught: false, movementSpeed: 4, lastAcceptedSeq: 0,
      taunt: { readyAt: 10_000, resolvesAt: 0, remaining: 2 },
    },
  };
}

test("숨는 팀 숫자 1은 숨기·수색 단계에서 고정과 해제를 모두 허용한다", () => {
  const current = snapshot();
  for (const phase of ["HIDING", "SEEKING"] as const) {
    current.phase = phase;
    for (const locked of [false, true]) {
      current.self.locked = locked;
      assert.deepEqual(actionForShortcut(key("Digit1"), current, current.serverTime), { type: "lock", payload: !locked });
    }
  }
});

test("숨는 팀 숫자 2는 고정 중에도 사용 가능하며 사용한 자리바꿈은 보내지 않는다", () => {
  const current = snapshot();
  current.self.locked = true;
  for (const phase of ["HIDING", "SEEKING"] as const) {
    current.phase = phase;
    assert.deepEqual(actionForShortcut(key("Digit2"), current, current.serverTime), { type: "swap", payload: true });
  }
  current.self.swapAvailable = false;
  assert.equal(actionForShortcut(key("Digit2"), current, current.serverTime), undefined);
});

test("숨는 팀 숫자 3 도발은 수색이 시작돼야 사용할 수 있다", () => {
  const current = snapshot();
  assert.deepEqual(actionForShortcut(key("Digit3"), current, current.serverTime), { type: "taunt", payload: true });
  current.phase = "HIDING";
  assert.equal(actionForShortcut(key("Digit3"), current, current.serverTime), undefined);
});

test("도발 단축키는 남은 사용량·진행 중 상태·남은 생존 시간을 검사한다", () => {
  const current = snapshot();
  for (const taunt of [undefined, { readyAt: 0, resolvesAt: 0, remaining: 0 }, { readyAt: 0, resolvesAt: 16_000, remaining: 1 }]) {
    current.self.taunt = taunt;
    assert.equal(actionForShortcut(key("Digit3"), current, current.serverTime), undefined);
  }
  current.self.taunt = { readyAt: 10_000, resolvesAt: 0, remaining: 1 };
  current.phaseEndsAt = 16_000;
  assert.equal(actionForShortcut(key("Digit3"), current, current.serverTime), undefined);
  current.phaseEndsAt = 16_001;
  assert.deepEqual(actionForShortcut(key("Digit3"), current, current.serverTime), { type: "taunt", payload: true });
});

test("숫자 1 관찰 렌즈는 술래 수색 단계에서만 열리고 숫자 2·3은 행동하지 않는다", () => {
  const current = snapshot("SEEKER");
  assert.deepEqual(actionForShortcut(key("Digit1"), current, current.serverTime), { type: "lens", payload: true });
  for (const code of ["Digit2", "Digit3"]) assert.equal(actionForShortcut(key(code), current, current.serverTime), undefined);
  current.seekerPreview = true;
  assert.equal(actionForShortcut(key("Digit1"), current, current.serverTime), undefined);
  current.seekerPreview = false;
  current.phase = "HIDING";
  assert.equal(actionForShortcut(key("Digit1"), current, current.serverTime), undefined);
});

test("도발·렌즈 쿨다운은 로컬 시계 대신 전달받은 서버 기준 현재 시각으로 판정한다", () => {
  const receivedAt = 1_000_000_000;
  const localNow = receivedAt + 250;
  for (const [role, code, type] of [["HIDER", "Digit3", "taunt"], ["SEEKER", "Digit1", "lens"]] as const) {
    const current = snapshot(role);
    current.self.lensReadyAt = 10_250;
    current.self.taunt = { readyAt: 10_250, resolvesAt: 0, remaining: 1 };
    const serverNow = current.serverTime + (localNow - receivedAt);
    assert.equal(actionForShortcut(key(code), current, serverNow - 1), undefined);
    assert.deepEqual(actionForShortcut(key(code), current, serverNow), { type, payload: true });
  }
});

test("대기·역할 공개·결과 단계와 잡힌 플레이어에게는 숫자 행동을 보내지 않는다", () => {
  for (const role of ["HIDER", "SEEKER"] as const) {
    const current = snapshot(role);
    for (const phase of ["LOBBY", "COUNTDOWN", "RESULT", "FINAL"] as const) {
      current.phase = phase;
      for (const code of ["Digit1", "Digit2", "Digit3"]) {
        assert.equal(actionForShortcut(key(code), current, current.serverTime), undefined, `${role} ${phase} ${code}`);
      }
    }
    current.phase = "SEEKING";
    current.self.caught = true;
    for (const code of ["Digit1", "Digit2", "Digit3"]) assert.equal(actionForShortcut(key(code), current, current.serverTime), undefined);
  }
});

test("역할이 없거나 관전자이면 행동하지 않고 숫자패드와 다른 키도 무시한다", () => {
  for (const code of ["Digit1", "Digit2", "Digit3"]) {
    assert.equal(actionForShortcut(key(code), undefined, 10_000), undefined);
    assert.equal(actionForShortcut(key(code), snapshot("SPECTATOR"), 10_000), undefined);
  }
  for (const role of ["HIDER", "SEEKER"] as const) {
    const current = snapshot(role);
    for (const code of ["Numpad1", "Numpad2", "Numpad3", "Digit0", "Digit4", "KeyW", "ArrowUp", ""]) {
      assert.equal(actionForShortcut(key(code), current, current.serverTime), undefined, `${role} ${code}`);
    }
  }
});

test("길게 누르기·IME 조합·브라우저 조합키는 준비된 모든 역할 행동에서도 무시한다", () => {
  const blockedFlags = ["repeat", "isComposing", "altKey", "ctrlKey", "metaKey", "shiftKey"] as const;
  for (const [role, code] of [["HIDER", "Digit1"], ["HIDER", "Digit2"], ["HIDER", "Digit3"], ["SEEKER", "Digit1"]] as const) {
    const current = snapshot(role);
    assert.ok(actionForShortcut(key(code), current, current.serverTime));
    for (const flag of blockedFlags) {
      assert.equal(actionForShortcut(key(code, { [flag]: true }), current, current.serverTime), undefined, `${role} ${code} ${flag}`);
    }
  }
});
