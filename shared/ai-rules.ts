import type { AiDifficulty } from "./game-types";

export interface AiProfile {
  label: string;
  description: string;
  hiderSpeedMultiplier: number;
  seekerSpeedMultiplier: number;
  thinkIntervalMs: number;
  reactionMs: number;
  perceptionRange: number;
  memoryMs: number;
  movingRecognitionChance: number;
  stillRecognitionChance: number;
  falseInspectionChance: number;
  hiderDangerRange: number;
  /** AI 숨는 팀이 전역 자리바꿈을 고려하기 시작하는 술래와의 거리다. */
  hiderSwapThreatRange: number;
  hiderEscapeChance: number;
  escapeDurationMs: number;
}

/**
 * AI는 정답 위치를 항상 아는 대신 시야, 반응, 기억과 오판 확률로 행동한다.
 * 난이도가 높을수록 반응이 빠르고 움직임 단서를 오래 기억하지만 인간 최고 속도는 넘지 않는다.
 */
export const AI_PROFILES: Record<AiDifficulty, AiProfile> = {
  easy: {
    label: "쉬움",
    description: "천천히 반응하고 움직임 단서를 자주 놓쳐 처음 연습하기 좋습니다.",
    hiderSpeedMultiplier: 0.82,
    seekerSpeedMultiplier: 0.78,
    thinkIntervalMs: 720,
    reactionMs: 950,
    perceptionRange: 4.6,
    memoryMs: 1_400,
    movingRecognitionChance: 0.52,
    stillRecognitionChance: 0.08,
    falseInspectionChance: 0.46,
    hiderDangerRange: 3.2,
    hiderSwapThreatRange: 2.1,
    hiderEscapeChance: 0.24,
    escapeDurationMs: 1_500,
  },
  normal: {
    label: "보통",
    description: "시야와 기억을 균형 있게 사용하며 실제 이용자와 비슷한 실수를 합니다.",
    hiderSpeedMultiplier: 0.92,
    seekerSpeedMultiplier: 0.9,
    thinkIntervalMs: 430,
    reactionMs: 560,
    perceptionRange: 6.4,
    memoryMs: 2_700,
    movingRecognitionChance: 0.76,
    stillRecognitionChance: 0.22,
    falseInspectionChance: 0.28,
    hiderDangerRange: 4.6,
    hiderSwapThreatRange: 2.5,
    hiderEscapeChance: 0.56,
    escapeDurationMs: 2_300,
  },
  hard: {
    label: "어려움",
    description: "단서를 빨리 연결하고 오래 추적하지만 벽 너머나 화면 밖 정답은 알 수 없습니다.",
    hiderSpeedMultiplier: 1,
    seekerSpeedMultiplier: 1,
    thinkIntervalMs: 230,
    reactionMs: 260,
    perceptionRange: 8.6,
    memoryMs: 4_600,
    movingRecognitionChance: 0.94,
    stillRecognitionChance: 0.46,
    falseInspectionChance: 0.12,
    hiderDangerRange: 6.2,
    hiderSwapThreatRange: 3,
    hiderEscapeChance: 0.84,
    escapeDurationMs: 3_100,
  },
};

export function aiProfileFor(difficulty: AiDifficulty): AiProfile {
  return AI_PROFILES[difficulty];
}

export function aiDifficultyLabel(difficulty: AiDifficulty): string {
  return AI_PROFILES[difficulty].label;
}

export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return value === "easy" || value === "normal" || value === "hard";
}
