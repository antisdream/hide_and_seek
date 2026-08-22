export type RoomMode = "public" | "invite";
export type AiDifficulty = "easy" | "normal" | "hard";
export type GamePhase = "LOBBY" | "COUNTDOWN" | "HIDING" | "SEEKING" | "RESULT" | "FINAL";
export type PlayerRole = "HIDER" | "SEEKER" | "SPECTATOR";
export type PropKind = "pencil" | "notebook" | "tape" | "eraser" | "box" | "ribbon";
export type PingKind = "check" | "suspect" | "done" | "danger" | "moving";
export type MapTheme = "stationery" | "warehouse" | "workshop";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Zone extends Point {
  id: string;
  label: string;
  radius: number;
}

export interface StaticProp extends Point {
  id: string;
  kind: PropKind;
  rotation: number;
  /** 자리바꿈처럼 보간하면 안 되는 좌표 변경 횟수다. 맵 원본은 0으로 간주한다. */
  teleportRevision?: number;
}

export interface Portal extends Point {
  id: string;
  label: string;
  targetId: string;
  radius: number;
  exit: Point;
}

export interface MapLayout {
  id: string;
  name: string;
  theme: MapTheme;
  version: string;
  width: number;
  height: number;
  obstacles: Rect[];
  zones: Zone[];
  portals: Portal[];
}

export interface GameRules {
  tickRate: number;
  minPlayers: number;
  maxPlayers: number;
  totalRounds: number;
  countdownMs: number;
  hidingMs: number;
  seekingMs: number;
  seekingMsPerExtraPlayer: number;
  resultMs: number;
  hiderSpeed: number;
  seekerSpeed: number;
  tagDistance: number;
  tagCooldownMs: number;
  wrongTagCooldownMs: number;
  emptyFocusCooldownMs: number;
  wrongTagPenalty: number;
  focusRecoveryPerSecond: number;
  focusRecoveryDelayMs: number;
  lensCooldownMs: number;
  missionHoldMs: number;
}

export interface PublicPlayer {
  id: string;
  displayName: string;
  avatar: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
  bot: boolean;
  /** AI 참가자일 때 대기실과 결과 화면에 표시할 개별 난이도다. */
  aiDifficulty?: AiDifficulty;
  score: number;
  status: "lobby" | "playing" | "caught" | "waiting";
  /** 결과 화면에서만 공개되는 이번 라운드 생존 점수다. */
  survivalScore?: number;
  revealedRole?: PlayerRole;
}

export interface WorldEntity extends Point {
  id: string;
  category: "prop" | "seeker";
  propKind?: PropKind;
  rotation: number;
  moving: boolean;
  controlled: boolean;
  teammate: boolean;
  caught: boolean;
  /** 포탈·자리바꿈을 일반 이동 보간과 구분하는 단조 증가 값이다. */
  teleportRevision: number;
  displayName?: string;
  avatar?: string;
}

export interface MissionView {
  zoneId: string;
  label: string;
  progress: number;
  completed: boolean;
}

export interface SelfView {
  playerId: string;
  role: PlayerRole;
  focus: number;
  locked: boolean;
  swapAvailable: boolean;
  tagReadyAt: number;
  lensReadyAt: number;
  caught: boolean;
  /** 로컬 입력 예측에 사용하는 현재 역할의 실제 이동 속도다. */
  movementSpeed: number;
}

export interface RoundResult {
  winner: "HIDERS" | "SEEKERS";
  reason: "ALL_CAUGHT" | "TIME_UP";
  headline: string;
}

export interface ReplayBeat {
  id: string;
  at: number;
  type: "tag" | "wrong-tag" | "swap" | "mission" | "last-second";
  label: string;
}

export interface GameSnapshot {
  version: number;
  serverTime: number;
  roomId: string;
  mode: RoomMode;
  phase: GamePhase;
  phaseEndsAt: number;
  round: number;
  totalRounds: number;
  roundPlayerCount: number;
  roundDurationMs: number;
  seekingDurationMs: number;
  minPlayers: number;
  maxPlayers: number;
  canStart: boolean;
  seekerPreview: boolean;
  self: SelfView;
  players: PublicPlayer[];
  entities: WorldEntity[];
  map: MapLayout;
  mission?: MissionView;
  result?: RoundResult;
  replay: ReplayBeat[];
}

export interface LobbyChatMessage {
  id: string;
  playerId: string;
  displayName: string;
  avatar: string;
  text: string;
  createdAt: number;
}

export interface MoveMessage {
  seq: number;
  x: number;
  y: number;
  /** 키를 놓은 순간 화면에 보이던 좌표다. 서버는 이동 한도와 충돌을 다시 검사한 뒤에만 사용한다. */
  anchorX?: number;
  anchorY?: number;
}

export interface TagMessage {
  seq: number;
  entityId: string;
}

export interface GameEffect {
  id: string;
  type: "correct-tag" | "wrong-tag" | "swap" | "focus-empty" | "mission" | "phase" | "portal";
  x?: number;
  y?: number;
  label: string;
}

export interface TeamPing extends Point {
  id: string;
  playerId: string;
  kind: PingKind;
  createdAt: number;
}
