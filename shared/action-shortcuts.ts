import { canTaunt } from "./party-rules";
import type { GameSnapshot } from "./game-types";

type ShortcutKeyEvent = Pick<KeyboardEvent, "code" | "repeat" | "isComposing" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;
type ShortcutState = Pick<GameSnapshot, "phase" | "phaseEndsAt" | "self" | "seekerPreview">;
export type RoleAction = { type: "lock" | "swap" | "taunt" | "lens"; payload: boolean };

/** 숫자 행 단축키도 버튼과 같은 역할·단계·사용 가능 조건을 따른다. */
export function actionForShortcut(event: ShortcutKeyEvent, state: ShortcutState | undefined, now: number): RoleAction | undefined {
  if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!state || state.self.caught || (state.phase !== "HIDING" && state.phase !== "SEEKING")) return;
  if (state.self.role === "HIDER") {
    if (event.code === "Digit1") return { type: "lock", payload: !state.self.locked };
    if (event.code === "Digit2" && state.self.swapAvailable) return { type: "swap", payload: true };
    if (event.code === "Digit3" && state.phase === "SEEKING" && state.self.taunt && canTaunt(state.self.taunt, now, state.phaseEndsAt)) return { type: "taunt", payload: true };
  }
  if (state.self.role === "SEEKER" && event.code === "Digit1" && state.phase === "SEEKING" && !state.seekerPreview && now >= state.self.lensReadyAt) {
    return { type: "lens", payload: true };
  }
}
