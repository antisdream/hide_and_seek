import { randomBytes, randomUUID } from "node:crypto";
import { Room, ServerError, type AuthContext, type Client } from "@colyseus/core";
import { z } from "zod";
import { isAllowedRequestOrigin, SAME_HOST_ORIGIN } from "./origin-policy";
import { aiProfileFor, isAiDifficulty } from "../shared/ai-rules";
import {
  distance,
  hasLineOfSight,
  isBlocked,
  MAX_MOVEMENT_DELTA_MS,
  moveWithCollisions,
  PLAYER_COLLISION_RADIUS,
} from "../shared/geometry";
import {
  DEFAULT_RULES,
  normalizeMove,
  pickGlobalSwapTarget,
  roundTimingFor,
  selectSeekers,
  survivalScoreFor,
  tagCooldown,
} from "../shared/game-rules";
import {
  createMapForRound,
  findPortalTransfer,
  pickPropKind,
  type GeneratedMap,
} from "../shared/map-generator";
import type {
  AiDifficulty,
  GameEffect,
  GamePhase,
  GameRules,
  GameSnapshot,
  MissionView,
  MoveMessage,
  PingKind,
  PlayerRole,
  Point,
  PropKind,
  PublicPlayer,
  ReplayBeat,
  RoomMode,
  RoundResult,
  StaticProp,
  TagMessage,
  TeamPing,
  WorldEntity,
} from "../shared/game-types";
import type { MatchStore } from "./persistence";

const moveSchema = z.object({
  seq: z.number().int().min(0).max(2_147_483_647),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
});
const tagSchema = z.object({
  seq: z.number().int().min(0).max(2_147_483_647),
  entityId: z.string().min(4).max(80),
});
const pingSchema = z.object({
  kind: z.enum(["check", "suspect", "done", "danger", "moving"]),
});
const joinSchema = z.object({
  mode: z.enum(["public", "invite", "practice"]).optional(),
  aiDifficulty: z.enum(["easy", "normal", "hard"]).optional(),
  displayName: z.string().min(1).max(40),
  deviceId: z.string().min(8).max(120),
});

interface AuthData {
  displayName: string;
  deviceId: string;
}

interface InternalMission {
  zoneId: string;
  label: string;
  progressMs: number;
  completed: boolean;
}

interface InternalPlayer extends Point {
  id: string;
  sessionId?: string;
  displayName: string;
  avatar: string;
  joinedAt: number;
  ready: boolean;
  connected: boolean;
  bot: boolean;
  role: PlayerRole;
  score: number;
  caught: boolean;
  caughtAt: number;
  lastSurvivalScore: number;
  rotation: number;
  entityId: string;
  propKind: PropKind;
  locked: boolean;
  swapUsed: boolean;
  focus: number;
  tagReadyAt: number;
  lastTagAt: number;
  lensReadyAt: number;
  lastPingAt: number;
  lastMovedAt: number;
  portalReadyAt: number;
  teleportRevision: number;
  lastSeq: number;
  inputX: number;
  inputY: number;
  mission?: InternalMission;
  botTarget?: Point;
  botTargetEntityId?: string;
  botMemoryExpiresAt: number;
  botThinkAt: number;
  botActionAt: number;
  botRouteIndex: number;
}

interface RecentMove extends Point {
  playerId: string;
  at: number;
}

export interface RuntimeConfig {
  rules: GameRules;
  store?: MatchStore;
  allowedOrigins: string[];
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  rules: DEFAULT_RULES,
  allowedOrigins: [SAME_HOST_ORIGIN],
};

/** 서버 인스턴스마다 규칙과 저장소를 격리한 방 클래스를 만든다. */
export function createConfiguredNunchisoomRoom(config: RuntimeConfig): typeof NunchisoomRoom {
  return class ConfiguredNunchisoomRoom extends NunchisoomRoom {
    protected override getRuntimeConfig(): RuntimeConfig {
      return config;
    }
  };
}

export class NunchisoomRoom extends Room {
  private readonly players = new Map<string, InternalPlayer>();
  private readonly sessionToPlayer = new Map<string, string>();
  private readonly seekerHistory = new Map<string, number>();
  private lastRoundSeekerIds = new Set<string>();
  private preparedSeekerIds = new Set<string>();
  private readonly replay: ReplayBeat[] = [];
  private readonly recentMoves: RecentMove[] = [];
  private runtimeConfig: RuntimeConfig = DEFAULT_RUNTIME_CONFIG;
  private mode: RoomMode = "public";
  private aiDifficulty: AiDifficulty = "normal";
  private phase: GamePhase = "LOBBY";
  private phaseEndsAt = 0;
  private round = 0;
  private roundPlayerCount = 0;
  private roundSeekingMs = DEFAULT_RULES.seekingMs;
  private seekingStartedAt = 0;
  private version = 0;
  private hostPlayerId = "";
  private rules: GameRules = DEFAULT_RULES;
  private generatedMap: GeneratedMap = createMapForRound(1, 1);
  private staticProps: StaticProp[] = [];
  private baselineProps: StaticProp[] = [];
  private result?: RoundResult;
  private matchId = randomUUID();
  private matchStartedAt = 0;

  protected getRuntimeConfig(): RuntimeConfig {
    return DEFAULT_RUNTIME_CONFIG;
  }

  async onCreate(options: { mode?: RoomMode; aiDifficulty?: AiDifficulty }): Promise<void> {
    this.runtimeConfig = this.getRuntimeConfig();
    this.mode = options.mode === "invite" || options.mode === "practice" ? options.mode : "public";
    this.aiDifficulty = isAiDifficulty(options.aiDifficulty) ? options.aiDifficulty : "normal";
    this.rules = this.runtimeConfig.rules;
    this.maxClients = this.mode === "practice" ? 4 : this.rules.maxPlayers;
    this.maxMessagesPerSecond = 45;
    this.patchRate = null;
    await this.setPrivate(this.mode !== "public");
    await this.setMetadata({ mode: this.mode, phase: this.phase });

    this.onMessage("ready", z.boolean(), (client, ready) => this.handleReady(client, ready));
    this.onMessage("move", moveSchema, (client, message) => this.handleMove(client, message));
    this.onMessage("tag", tagSchema, (client, message) => this.handleTag(client, message));
    this.onMessage("lock", z.boolean(), (client, locked) => this.handleLock(client, locked));
    this.onMessage("swap", z.literal(true), (client) => this.handleSwap(client));
    this.onMessage("lens", z.literal(true), (client) => this.handleLens(client));
    this.onMessage("ping", pingSchema, (client, message) => this.handlePing(client, message.kind));
    this.onMessage("start", z.literal(true), (client) => this.handleStart(client));

    this.setSimulationInterval((deltaTime) => this.tick(deltaTime), 1_000 / this.rules.tickRate);
  }

  onAuth(_client: Client, options: unknown, context: AuthContext): false | AuthData {
    const parsed = joinSchema.safeParse(options);
    if (!parsed.success) return false;

    const origin = context.headers.get("origin");
    const requestHost = context.headers.get("host");
    if (!isAllowedRequestOrigin(origin, requestHost, this.runtimeConfig.allowedOrigins)) {
      return false;
    }

    return {
      displayName: sanitizeDisplayName(parsed.data.displayName),
      deviceId: parsed.data.deviceId,
    };
  }

  onJoin(client: Client): void {
    if (this.phase !== "LOBBY" && this.phase !== "FINAL") {
      throw new ServerError(4_213, "진행 중인 경기에는 새로 입장할 수 없습니다.");
    }
    const auth = client.auth as AuthData;
    const player: InternalPlayer = {
      id: opaqueId("player"),
      sessionId: client.sessionId,
      displayName: auth.displayName,
      avatar: avatarAt(this.humanPlayers().length),
      joinedAt: Date.now(),
      ready: false,
      connected: true,
      bot: false,
      role: "SPECTATOR",
      score: 0,
      caught: false,
      caughtAt: 0,
      lastSurvivalScore: 0,
      x: 1.5,
      y: 14.2,
      rotation: 0,
      entityId: opaqueId("object"),
      propKind: "notebook",
      locked: false,
      swapUsed: false,
      focus: 100,
      tagReadyAt: 0,
      lastTagAt: 0,
      lensReadyAt: 0,
      lastPingAt: 0,
      lastMovedAt: 0,
      portalReadyAt: 0,
      teleportRevision: 0,
      lastSeq: -1,
      inputX: 0,
      inputY: 0,
      botMemoryExpiresAt: 0,
      botThinkAt: 0,
      botActionAt: 0,
      botRouteIndex: 0,
    };
    client.userData = { playerId: player.id };
    this.players.set(player.id, player);
    this.sessionToPlayer.set(client.sessionId, player.id);
    if (!this.hostPlayerId) this.hostPlayerId = player.id;
    this.syncPracticeBots();
    this.version += 1;
    // 입장한 클라이언트는 메시지 수신기를 붙이기 전이므로 기존 참가자에게만 알린다.
    this.broadcast("notice", { label: `${player.displayName} 님이 입장했습니다.` }, { except: client });
  }

  onDrop(client: Client): void {
    const player = this.playerFor(client);
    if (!player) return;
    player.connected = false;
    player.inputX = 0;
    player.inputY = 0;
    this.version += 1;
    this.allowReconnection(client, 10).catch(() => undefined);
  }

  onReconnect(client: Client): void {
    const player = this.playerFor(client);
    if (!player) return;
    player.connected = true;
    player.sessionId = client.sessionId;
    client.userData = { playerId: player.id };
    this.sessionToPlayer.set(client.sessionId, player.id);
    this.version += 1;
    this.sendSnapshotTo(client);
  }

  onLeave(client: Client): void {
    const player = this.playerFor(client);
    if (!player) return;
    this.sessionToPlayer.delete(client.sessionId);
    this.players.delete(player.id);
    this.seekerHistory.delete(player.id);
    this.lastRoundSeekerIds.delete(player.id);
    this.preparedSeekerIds.delete(player.id);
    if (player.id === this.hostPlayerId) this.migrateHost();
    if (this.phase === "LOBBY" || this.phase === "FINAL") this.syncPracticeBots();
    this.version += 1;

    if (this.phase === "COUNTDOWN" && !this.hasEnoughPlayers()) {
      this.cancelPreparedRound();
      this.setPhase("LOBBY", 0);
      this.broadcast("notice", { label: "인원이 부족해 시작 준비를 취소했습니다." });
    }
    if (this.phase === "SEEKING" && player.role === "HIDER") {
      this.checkAllCaught();
    }
  }

  onUncaughtException(error: unknown, methodName: string): void {
    console.error(`[게임방 오류] ${methodName}`, error);
  }

  private tick(deltaTime: number): void {
    const now = Date.now();
    this.advancePhase(now);
    this.updateBots(deltaTime, now);
    this.updatePlayers(deltaTime, now);
    this.pruneRecentMoves(now);
    this.version += 1;
    this.sendSnapshots();
  }

  private advancePhase(now: number): void {
    if (!this.phaseEndsAt || now < this.phaseEndsAt) return;
    if (this.phase === "COUNTDOWN") {
      if (!this.hasEnoughPlayers()) {
        this.cancelPreparedRound();
        this.setPhase("LOBBY", 0);
        return;
      }
      this.startRound(now);
      return;
    }
    if (this.phase === "HIDING") {
      this.seekingStartedAt = now;
      this.setPhase("SEEKING", now + this.roundSeekingMs);
      this.broadcastEffect({ type: "phase", label: `${this.generatedMap.layout.name} 수색이 시작됐습니다.` });
      return;
    }
    if (this.phase === "SEEKING") {
      this.finishRound("TIME_UP", now);
      return;
    }
    if (this.phase === "RESULT") {
      if (this.round >= this.rules.totalRounds) this.finishMatch(now);
      else this.beginCountdown(false);
    }
  }

  private handleReady(client: Client, ready: boolean): void {
    if (this.phase !== "LOBBY" && this.phase !== "FINAL") return;
    const player = this.playerFor(client);
    if (!player) return;
    player.ready = ready;
    if (this.mode === "practice") this.syncPracticeBots();
    this.version += 1;
    if (this.hasEnoughPlayers() && this.humanPlayers().every((entry) => entry.ready)) {
      this.beginCountdown(this.phase === "FINAL");
    }
  }

  private handleStart(client: Client): void {
    const player = this.playerFor(client);
    if (!player || player.id !== this.hostPlayerId) return;
    if (this.mode === "practice") this.syncPracticeBots();
    if (!this.hasEnoughPlayers()) {
      this.sendError(client, "인원 부족", `게임을 시작하려면 ${this.publicMinPlayers()}명이 필요합니다.`);
      return;
    }
    if (!this.humanPlayers().every((entry) => entry.ready)) {
      this.sendError(client, "준비 확인", "모든 참가자가 준비해야 시작할 수 있습니다.");
      return;
    }
    this.beginCountdown(this.phase === "FINAL");
  }

  private beginCountdown(newMatch: boolean): void {
    if (this.phase === "COUNTDOWN") return;
    if (newMatch) {
      this.round = 0;
      this.matchId = randomUUID();
      this.matchStartedAt = 0;
      this.seekerHistory.clear();
      this.lastRoundSeekerIds.clear();
      this.preparedSeekerIds.clear();
      this.replay.splice(0);
      for (const player of this.players.values()) player.score = 0;
    }
    this.result = undefined;
    this.seekingStartedAt = 0;
    this.prepareRound();
    this.setPhase("COUNTDOWN", Date.now() + this.rules.countdownMs);
    this.broadcastEffect({ type: "phase", label: `${this.round}라운드 역할이 정해졌습니다.` });
  }

  /** 역할 공개 전에 맵과 역할을 확정하되, 다른 이용자의 위치는 스냅샷에서 숨긴다. */
  private prepareRound(): void {
    this.round += 1;
    // Node와 Workers 타입을 함께 사용할 때 Buffer 전용 메서드에 의존하지 않도록 바이트로 시드를 조합한다.
    const seedBytes = randomBytes(4);
    const seed = (
      (seedBytes[0] << 24)
      | (seedBytes[1] << 16)
      | (seedBytes[2] << 8)
      | seedBytes[3]
    ) >>> 0;
    this.generatedMap = createMapForRound(seed, this.round);
    this.staticProps = this.generatedMap.staticProps.map((prop) => ({
      ...prop,
      id: opaqueId("object"),
      teleportRevision: 0,
    }));
    this.baselineProps = this.staticProps.map((prop) => ({ ...prop }));
    this.result = undefined;

    const players = [...this.players.values()];
    const timing = roundTimingFor(players.length, this.rules);
    this.roundPlayerCount = timing.playerCount;
    this.roundSeekingMs = timing.seekingMs;
    const seekerIds = selectSeekers(
      players.map((player) => player.id),
      this.seekerHistory,
      seed + this.round,
      this.lastRoundSeekerIds,
    );
    this.preparedSeekerIds = new Set(seekerIds);

    let hiderIndex = 0;
    let seekerIndex = 0;
    for (let index = 0; index < players.length; index += 1) {
      const player = players[index];
      player.role = seekerIds.has(player.id) ? "SEEKER" : "HIDER";
      player.caught = false;
      player.caughtAt = 0;
      player.lastSurvivalScore = 0;
      player.ready = player.bot;
      player.entityId = opaqueId("object");
      player.rotation = 0;
      player.locked = false;
      player.swapUsed = false;
      player.focus = 100;
      player.tagReadyAt = 0;
      player.lastTagAt = 0;
      player.lensReadyAt = 0;
      player.lastSeq = -1;
      player.inputX = 0;
      player.inputY = 0;
      player.lastMovedAt = 0;
      player.portalReadyAt = 0;
      player.teleportRevision = 0;
      player.botTarget = undefined;
      player.botTargetEntityId = undefined;
      player.botMemoryExpiresAt = 0;
      player.botThinkAt = 0;
      player.botActionAt = 0;
      player.botRouteIndex = 0;
      player.propKind = pickPropKind(seed, index);

      if (player.role === "SEEKER") {
        const spawn = this.generatedMap.seekerSpawns[seekerIndex % this.generatedMap.seekerSpawns.length];
        seekerIndex += 1;
        player.x = spawn.x;
        player.y = spawn.y;
        this.seekerHistory.set(player.id, (this.seekerHistory.get(player.id) ?? 0) + 1);
        player.mission = undefined;
        if (player.bot) player.botTarget = this.botPatrolTarget(player);
      } else {
        const spawn = this.generatedMap.hiderSpawns[hiderIndex % this.generatedMap.hiderSpawns.length];
        hiderIndex += 1;
        player.x = spawn.x;
        player.y = spawn.y;
        const zone = this.generatedMap.layout.zones[(index + this.round) % this.generatedMap.layout.zones.length];
        player.mission = { zoneId: zone.id, label: `${zone.label}에서 2초 동안 고정`, progressMs: 0, completed: false };
        player.botTarget = this.generatedMap.hiderSpawns[(hiderIndex + index * 2) % this.generatedMap.hiderSpawns.length];
      }
    }
  }

  private startRound(now: number): void {
    if (!this.matchStartedAt) this.matchStartedAt = now;
    this.lastRoundSeekerIds = new Set(this.preparedSeekerIds);
    this.setPhase("HIDING", now + this.rules.hidingMs);
    this.broadcastEffect({
      type: "phase",
      label: `${this.round}라운드 · ${this.generatedMap.layout.name} 숨기 시작`,
    });
  }

  /** 인원 이탈로 역할 공개가 취소되면 라운드와 역할 이력을 원래 상태로 되돌린다. */
  private cancelPreparedRound(): void {
    if (this.round <= 0) return;
    for (const player of this.players.values()) {
      if (player.role === "SEEKER") {
        const previous = this.seekerHistory.get(player.id) ?? 0;
        if (previous <= 1) this.seekerHistory.delete(player.id);
        else this.seekerHistory.set(player.id, previous - 1);
      }
      player.role = "SPECTATOR";
      player.inputX = 0;
      player.inputY = 0;
      player.locked = false;
    }
    this.round = Math.max(0, this.round - 1);
    this.roundPlayerCount = 0;
    this.roundSeekingMs = this.rules.seekingMs;
    this.seekingStartedAt = 0;
    this.preparedSeekerIds.clear();
    this.result = undefined;
  }

  private finishRound(reason: RoundResult["reason"], now: number): void {
    if (this.phase === "RESULT" || this.phase === "FINAL") return;
    const winner = reason === "ALL_CAUGHT" ? "SEEKERS" : "HIDERS";
    this.result = {
      winner,
      reason,
      headline: winner === "SEEKERS" ? "모든 틈새정령을 찾았습니다!" : "평범한 척 끝까지 살아남았습니다!",
    };

    for (const player of this.players.values()) {
      player.inputX = 0;
      player.inputY = 0;
      if (player.role === "HIDER") {
        const survivedUntil = player.caughtAt || now;
        const survivedMs = Math.max(0, survivedUntil - this.seekingStartedAt);
        player.lastSurvivalScore = survivalScoreFor(survivedMs, this.roundSeekingMs);
        player.score += player.lastSurvivalScore;
      }
      if (winner === "HIDERS" && player.role === "HIDER") {
        player.score += 50;
      }
      if (winner === "SEEKERS" && player.role === "SEEKER") player.score += 50;
    }
    if (reason === "TIME_UP" && Math.abs(now - this.phaseEndsAt) < 1_000) {
      this.addReplay("last-second", "마지막 1초까지 버틴 사물이 있었습니다.");
    }
    this.setPhase("RESULT", now + this.rules.resultMs);
  }

  private finishMatch(now: number): void {
    this.setPhase("FINAL", 0);
    for (const player of this.humanPlayers()) player.ready = false;
    this.runtimeConfig.store?.save({
      id: this.matchId,
      roomId: this.roomId,
      mode: this.mode,
      startedAt: this.matchStartedAt || now,
      endedAt: now,
      rounds: this.round,
      summary: [...this.players.values()].map((player) => ({
        playerId: player.id,
        displayName: player.displayName,
        bot: player.bot,
        score: player.score,
      })),
    });
    this.broadcast("notice", { label: "경기 기록을 저장했습니다. 다시 준비하면 재경기가 시작됩니다." });
  }

  private updatePlayers(deltaTime: number, now: number): void {
    for (const player of this.players.values()) {
      if (player.bot || player.caught) continue;
      this.movePlayer(player, deltaTime, now);
      this.updateFocus(player, deltaTime, now);
      this.updateMission(player, deltaTime);
    }
  }

  private movePlayer(player: InternalPlayer, deltaTime: number, now: number): void {
    const canMove =
      (player.role === "HIDER" && (this.phase === "HIDING" || this.phase === "SEEKING")) ||
      (player.role === "SEEKER" && (this.phase === "HIDING" || this.phase === "SEEKING"));
    if (!canMove || player.locked) return;

    const direction = normalizeMove(player.inputX, player.inputY);
    if (direction.x === 0 && direction.y === 0) return;
    const speed = this.movementSpeedFor(player);
    const before = { x: player.x, y: player.y };
    const next = moveWithCollisions(
      player,
      direction,
      speed,
      Math.min(MAX_MOVEMENT_DELTA_MS, deltaTime),
      this.generatedMap.layout,
    );
    player.x = next.x;
    player.y = next.y;
    if (distance(before, player) < 0.001) return;

    player.rotation = Math.round((Math.atan2(direction.y, direction.x) * 180) / Math.PI);
    player.lastMovedAt = now;
    this.applyPortal(player, now);
    if (player.role === "HIDER") {
      this.recentMoves.push({ playerId: player.id, x: player.x, y: player.y, at: now });
    }
  }

  private applyPortal(player: InternalPlayer, now: number): void {
    if (now < player.portalReadyAt) return;
    const transfer = findPortalTransfer(player, this.generatedMap.layout);
    if (!transfer || isBlocked(transfer, PLAYER_COLLISION_RADIUS, this.generatedMap.layout)) return;
    player.x = transfer.x;
    player.y = transfer.y;
    player.teleportRevision += 1;
    player.portalReadyAt = now + 900;
    player.lastMovedAt = now;
    const effect = {
      type: "portal" as const,
      x: player.x,
      y: player.y,
      label: `${transfer.targetLabel}으로 이동`,
    };
    if (this.phase === "HIDING" && player.role === "HIDER") {
      this.broadcastEffect(effect, "HIDER");
    } else {
      this.broadcastEffect(effect, player.role);
    }
  }

  private updateFocus(player: InternalPlayer, deltaTime: number, now: number): void {
    if (player.role !== "SEEKER" || player.focus >= 100) return;
    if (now - player.lastTagAt < this.rules.focusRecoveryDelayMs) return;
    player.focus = Math.min(100, player.focus + this.rules.focusRecoveryPerSecond * (deltaTime / 1_000));
  }

  private updateMission(player: InternalPlayer, deltaTime: number): void {
    if (player.role !== "HIDER" || !player.mission || player.mission.completed) return;
    const zone = this.generatedMap.layout.zones.find((entry) => entry.id === player.mission?.zoneId);
    if (!zone || !player.locked || distance(player, zone) > zone.radius) {
      player.mission.progressMs = 0;
      return;
    }
    player.mission.progressMs += deltaTime;
    if (player.mission.progressMs < this.rules.missionHoldMs) return;
    player.mission.completed = true;
    player.score += 25;
    this.addReplay("mission", `${player.displayName} 님이 위험을 감수하고 진열 미션을 완료했습니다.`);
    this.broadcastEffect({ type: "mission", x: player.x, y: player.y, label: "진열 미션 완료" }, "HIDER");
  }

  private updateBots(deltaTime: number, now: number): void {
    for (const bot of this.players.values()) {
      if (!bot.bot || bot.caught) continue;
      this.updateFocus(bot, deltaTime, now);
      if (bot.role === "HIDER") this.updateHiderBot(bot, deltaTime, now);
      if (bot.role === "SEEKER") this.updateSeekerBot(bot, deltaTime, now);
      this.updateMission(bot, deltaTime);
    }
  }

  private updateHiderBot(bot: InternalPlayer, deltaTime: number, now: number): void {
    const profile = aiProfileFor(this.aiDifficulty);
    if (this.phase === "HIDING") {
      if (!bot.botTarget) bot.botTarget = this.generatedMap.hiderSpawns[bot.botRouteIndex % this.generatedMap.hiderSpawns.length];
      if (distance(bot, bot.botTarget) <= 0.32) {
        bot.inputX = 0;
        bot.inputY = 0;
        bot.locked = true;
        return;
      }
      bot.locked = false;
      this.moveBotToward(bot, bot.botTarget, deltaTime, now);
      return;
    }

    if (this.phase !== "SEEKING") {
      bot.inputX = 0;
      bot.inputY = 0;
      return;
    }

    if (now >= bot.botThinkAt) {
      bot.botThinkAt = now + profile.thinkIntervalMs;
      const threat = [...this.players.values()]
        .filter((player) => player.role === "SEEKER")
        .map((player) => ({ player, gap: distance(bot, player) }))
        .filter(({ player, gap }) => gap <= profile.hiderDangerRange && hasLineOfSight(bot, player, this.generatedMap.layout))
        .sort((a, b) => a.gap - b.gap)[0];
      if (threat && Math.random() <= profile.hiderEscapeChance) {
        if (!bot.swapUsed && threat.gap <= profile.hiderSwapThreatRange && Math.random() < profile.hiderEscapeChance * 0.45) {
          this.performSwap(bot);
        }
        bot.locked = false;
        bot.botTarget = this.botEscapeTarget(threat.player);
        bot.botActionAt = now + profile.escapeDurationMs;
      } else if (now >= bot.botActionAt) {
        bot.locked = true;
      }
    }

    if (!bot.locked && bot.botTarget && now < bot.botActionAt) {
      if (distance(bot, bot.botTarget) <= 0.42) {
        bot.locked = true;
        bot.inputX = 0;
        bot.inputY = 0;
      } else {
        this.moveBotToward(bot, bot.botTarget, deltaTime, now);
      }
      return;
    }
    bot.inputX = 0;
    bot.inputY = 0;
  }

  private updateSeekerBot(bot: InternalPlayer, deltaTime: number, now: number): void {
    if (this.phase !== "HIDING" && this.phase !== "SEEKING") {
      bot.inputX = 0;
      bot.inputY = 0;
      return;
    }
    const profile = aiProfileFor(this.aiDifficulty);

    if (this.phase === "SEEKING" && now >= bot.botThinkAt) {
      bot.botThinkAt = now + profile.thinkIntervalMs;
      const noticed = [...this.players.values()]
        .filter((player) => player.role === "HIDER" && !player.caught)
        .map((player) => ({
          player,
          gap: distance(bot, player),
          movedRecently: now - player.lastMovedAt <= profile.memoryMs,
        }))
        .filter(({ player, gap }) => gap <= profile.perceptionRange && hasLineOfSight(bot, player, this.generatedMap.layout))
        .filter(({ gap, movedRecently }) => {
          const chance = movedRecently
            ? profile.movingRecognitionChance
            : gap <= this.rules.tagDistance * 1.6
              ? profile.stillRecognitionChance
              : 0;
          return Math.random() <= chance;
        })
        .sort((a, b) => Number(b.movedRecently) - Number(a.movedRecently) || a.gap - b.gap)[0]?.player;

      if (noticed) {
        bot.botTargetEntityId = noticed.entityId;
        bot.botTarget = { x: noticed.x, y: noticed.y };
        bot.botMemoryExpiresAt = now + profile.memoryMs;
        bot.botActionAt = now + profile.reactionMs;
      } else if (!bot.botTargetEntityId || now >= bot.botMemoryExpiresAt) {
        bot.botTargetEntityId = undefined;
        const nearbyProps = this.staticProps
          .map((prop) => ({ prop, gap: distance(bot, prop) }))
          .filter(({ gap }) => gap <= profile.perceptionRange)
          .sort((a, b) => a.gap - b.gap);
        if (nearbyProps.length > 0 && Math.random() < profile.falseInspectionChance) {
          const chosen = nearbyProps[Math.floor(Math.random() * Math.min(5, nearbyProps.length))].prop;
          bot.botTargetEntityId = chosen.id;
          bot.botTarget = { x: chosen.x, y: chosen.y };
          bot.botMemoryExpiresAt = now + profile.memoryMs;
          bot.botActionAt = now + profile.reactionMs;
        } else if (!bot.botTarget || distance(bot, bot.botTarget) <= 0.7) {
          bot.botTarget = this.botPatrolTarget(bot);
        }
      }
    }

    if (bot.botTargetEntityId) {
      const hider = [...this.players.values()].find(
        (player) => player.entityId === bot.botTargetEntityId && player.role === "HIDER" && !player.caught,
      );
      const prop = this.staticProps.find((entry) => entry.id === bot.botTargetEntityId);
      const target = hider ?? prop;
      const canSeeTarget = Boolean(
        target && distance(bot, target) <= profile.perceptionRange && hasLineOfSight(bot, target, this.generatedMap.layout),
      );
      if (hider && canSeeTarget) {
        bot.botTarget = { x: hider.x, y: hider.y };
        bot.botMemoryExpiresAt = now + profile.memoryMs;
      }
      if (!target || (!canSeeTarget && now >= bot.botMemoryExpiresAt)) {
        bot.botTargetEntityId = undefined;
        bot.botTarget = this.botPatrolTarget(bot);
      } else if (distance(bot, target) <= this.rules.tagDistance && now >= bot.botActionAt) {
        this.attemptTag(bot, bot.botTargetEntityId, now);
        bot.botTargetEntityId = undefined;
        bot.botTarget = this.botPatrolTarget(bot);
        bot.botThinkAt = now + profile.thinkIntervalMs;
      }
    }

    if (!bot.botTarget || distance(bot, bot.botTarget) <= 0.6) bot.botTarget = this.botPatrolTarget(bot);
    bot.locked = false;
    this.moveBotToward(bot, bot.botTarget, deltaTime, now);
  }

  /** 선반을 만나면 각도를 조금씩 바꿔 미끄러지듯 우회한다. */
  private moveBotToward(bot: InternalPlayer, target: Point, deltaTime: number, now: number): void {
    const base = Math.atan2(target.y - bot.y, target.x - bot.x);
    const before = { x: bot.x, y: bot.y };
    for (const offset of [0, 0.42, -0.42, 0.82, -0.82, 1.35, -1.35]) {
      bot.inputX = Math.cos(base + offset);
      bot.inputY = Math.sin(base + offset);
      this.movePlayer(bot, deltaTime, now);
      if (distance(before, bot) > 0.001) return;
    }
    bot.inputX = 0;
    bot.inputY = 0;
    bot.botTarget = this.botPatrolTarget(bot);
  }

  private botPatrolTarget(bot: InternalPlayer): Point {
    const waypoints: Point[] = [
      ...this.generatedMap.layout.zones,
      ...this.generatedMap.layout.portals,
      ...this.generatedMap.hiderSpawns.slice(0, 6),
    ];
    const identityOffset = [...bot.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const target = waypoints[(identityOffset + bot.botRouteIndex + this.round) % waypoints.length];
    bot.botRouteIndex += 1;
    return { x: target.x, y: target.y };
  }

  private botEscapeTarget(seeker: InternalPlayer): Point {
    const candidates: Point[] = [
      ...this.generatedMap.hiderSpawns,
      ...this.generatedMap.layout.zones,
      ...this.generatedMap.layout.portals.map((portal) => ({ x: portal.x, y: portal.y })),
    ];
    const best = candidates.sort((a, b) => distance(seeker, b) - distance(seeker, a))[0];
    return { x: best.x, y: best.y };
  }

  private movementSpeedFor(player: InternalPlayer): number {
    const base = player.role === "HIDER" ? this.rules.hiderSpeed : this.rules.seekerSpeed;
    if (!player.bot) return base;
    const profile = aiProfileFor(this.aiDifficulty);
    return base * (player.role === "HIDER" ? profile.hiderSpeedMultiplier : profile.seekerSpeedMultiplier);
  }

  private handleMove(client: Client, message: MoveMessage): void {
    const player = this.playerFor(client);
    if (!player || message.seq <= player.lastSeq) return;
    player.lastSeq = message.seq;
    // 위치 고정은 명시적인 고정 해제만 허용하며, 이동 heartbeat가 상태를 풀지 못하게 한다.
    if (player.locked) {
      player.inputX = 0;
      player.inputY = 0;
      return;
    }
    const normalized = normalizeMove(message.x, message.y);
    player.inputX = normalized.x;
    player.inputY = normalized.y;
  }

  private handleLock(client: Client, locked: boolean): void {
    const player = this.playerFor(client);
    if (!player || player.role !== "HIDER" || player.caught) return;
    if (this.phase !== "HIDING" && this.phase !== "SEEKING") return;
    player.locked = locked;
    if (locked) {
      player.inputX = 0;
      player.inputY = 0;
    }
  }

  private handleSwap(client: Client): void {
    const player = this.playerFor(client);
    if (!player || player.role !== "HIDER" || player.caught || player.swapUsed) return;
    if (this.phase !== "HIDING" && this.phase !== "SEEKING") return;
    if (this.performSwap(player)) return;
    this.sendError(client, "자리바꿈 실패", "맵에 교체 가능한 같은 종류의 사물이 없습니다.");
  }

  private performSwap(player: InternalPlayer): boolean {
    const target = pickGlobalSwapTarget(this.staticProps, player.propKind);
    if (!target) return false;
    const previous = { x: player.x, y: player.y, rotation: player.rotation, entityId: player.entityId };
    player.x = target.x;
    player.y = target.y;
    player.rotation = target.rotation;
    // 같은 종류는 외형이 같으므로 ID도 위치에 남겨 술래 스냅숏의 전후 차이만으로 정답을 좁히지 못하게 한다.
    player.entityId = target.id;
    target.x = previous.x;
    target.y = previous.y;
    target.rotation = previous.rotation;
    target.id = previous.entityId;
    player.teleportRevision += 1;
    target.teleportRevision = (target.teleportRevision ?? 0) + 1;
    player.swapUsed = true;
    this.addReplay("swap", `${player.displayName} 님이 사물과 자리를 바꿨습니다.`);
    const swapEffect = {
      type: "swap" as const,
      x: player.x,
      y: player.y,
      label: "종이조각 사이로 두 사물이 바뀌었습니다.",
    };
    // 관찰자에게 목적지 좌표가 담긴 효과를 보내면 전역 자리바꿈의 은신 의미가 사라진다.
    this.broadcastEffect(swapEffect, "HIDER");
    if (this.phase === "SEEKING") {
      this.broadcastEffect({
        type: "swap",
        label: "어딘가에서 같은 사물 둘이 뒤바뀌었습니다.",
      }, "SEEKER");
    }
    return true;
  }

  private handleTag(client: Client, message: TagMessage): void {
    const seeker = this.playerFor(client);
    const now = Date.now();
    if (!seeker || seeker.role !== "SEEKER" || seeker.caught || this.phase !== "SEEKING") return;
    if (message.seq <= seeker.lastSeq) return;
    seeker.lastSeq = message.seq;
    this.attemptTag(seeker, message.entityId, now, client);
  }

  private attemptTag(seeker: InternalPlayer, entityId: string, now: number, client?: Client): boolean {
    if (seeker.role !== "SEEKER" || seeker.caught || this.phase !== "SEEKING") return false;
    if (now < seeker.tagReadyAt || seeker.focus <= 0) {
      if (client) {
        const waitSeconds = Math.max(0.1, Math.ceil((seeker.tagReadyAt - now) / 100) / 10);
        this.sendError(client, "확인 대기", `확인 스티커 재사용까지 ${waitSeconds.toFixed(1)}초 남았습니다.`);
      }
      return false;
    }

    const targetHider = [...this.players.values()].find(
      (player) => player.entityId === entityId && player.role === "HIDER" && !player.caught,
    );
    const targetProp = this.staticProps.find((prop) => prop.id === entityId);
    const target = targetHider ?? targetProp;
    if (!target || distance(seeker, target) > this.rules.tagDistance) {
      if (client) this.sendError(client, "태그 범위", "스티커를 붙이려면 사물에 조금 더 가까이 가야 합니다.");
      return false;
    }
    if (!hasLineOfSight(seeker, target, this.generatedMap.layout)) {
      if (client) this.sendError(client, "시야 가림", "선반 너머의 사물에는 스티커를 붙일 수 없습니다.");
      return false;
    }

    seeker.lastTagAt = now;
    if (targetHider) {
      targetHider.caught = true;
      targetHider.caughtAt = now;
      targetHider.inputX = 0;
      targetHider.inputY = 0;
      seeker.focus = Math.min(100, seeker.focus + 10);
      seeker.score += 80;
      seeker.tagReadyAt = now + tagCooldown(seeker.focus, true, this.rules);
      this.addReplay("tag", `${seeker.displayName} 님이 ${targetHider.displayName} 님을 찾아냈습니다.`);
      this.broadcastEffect({ type: "correct-tag", x: targetHider.x, y: targetHider.y, label: "정확한 확인 스티커!" });
      this.checkAllCaught();
      return true;
    } else {
      seeker.focus = Math.max(0, seeker.focus - this.rules.wrongTagPenalty);
      seeker.tagReadyAt = now + tagCooldown(seeker.focus, false, this.rules);
      this.addReplay("wrong-tag", `${seeker.displayName} 님이 평범한 사물을 의심했습니다.`);
      const effect = {
        id: opaqueId("effect"),
        type: seeker.focus <= 0 ? "focus-empty" : "wrong-tag",
        x: target.x,
        y: target.y,
        label: seeker.focus <= 0 ? "집중력 소진 — 잠시 관찰만 가능" : "평범한 사물입니다.",
      } satisfies GameEffect;
      if (client) client.send("effect", effect);
      else this.broadcast("effect", effect);
      return false;
    }
  }

  private handleLens(client: Client): void {
    const seeker = this.playerFor(client);
    const now = Date.now();
    if (!seeker || seeker.role !== "SEEKER" || this.phase !== "SEEKING") return;
    if (now < seeker.lensReadyAt) {
      this.sendError(client, "렌즈 충전 중", "관찰 렌즈가 아직 충전되지 않았습니다.");
      return;
    }
    seeker.lensReadyAt = now + this.rules.lensCooldownMs;
    const cells = new Map<string, Point>();
    for (const move of this.recentMoves) {
      if (now - move.at > 2_000) continue;
      const x = Math.floor(move.x / 4) * 4 + 2;
      const y = Math.floor(move.y / 4) * 4 + 2;
      cells.set(`${x}:${y}`, { x, y });
    }
    client.send("lens", { id: opaqueId("lens"), cells: [...cells.values()], expiresAt: now + 1_800 });
  }

  private handlePing(client: Client, kind: PingKind): void {
    const player = this.playerFor(client);
    const now = Date.now();
    if (!player || now - player.lastPingAt < 1_200) return;
    if (player.role !== "HIDER" && player.role !== "SEEKER") return;
    player.lastPingAt = now;
    const ping: TeamPing = {
      id: opaqueId("ping"),
      playerId: player.id,
      kind,
      x: player.x,
      y: player.y,
      createdAt: now,
    };
    for (const targetClient of this.clients) {
      const teammate = this.playerFor(targetClient);
      if (teammate?.role === player.role) targetClient.send("ping", ping);
    }
  }

  private checkAllCaught(): void {
    const hiders = [...this.players.values()].filter((player) => player.role === "HIDER");
    if (hiders.length > 0 && hiders.every((player) => player.caught)) {
      this.finishRound("ALL_CAUGHT", Date.now());
    }
  }

  private sendSnapshots(): void {
    for (const client of this.clients) this.sendSnapshotTo(client);
  }

  private sendSnapshotTo(client: Client): void {
    const viewer = this.playerFor(client);
    if (!viewer) return;
    const now = Date.now();
    const revealRoles = this.phase === "RESULT" || this.phase === "FINAL";
    const seekerPreview = viewer.role === "SEEKER" && this.phase === "HIDING";
    const roleReveal = this.phase === "COUNTDOWN";
    const players: PublicPlayer[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        avatar: player.avatar,
        ready: player.ready,
        connected: player.connected,
        host: player.id === this.hostPlayerId,
        bot: player.bot,
        score: this.phase === "HIDING" || this.phase === "SEEKING" ? 0 : player.score,
        status: this.playerStatus(player),
        ...(revealRoles && player.role === "HIDER" ? { survivalScore: player.lastSurvivalScore } : {}),
        ...(revealRoles ? { revealedRole: player.role } : {}),
      }));

    const visibleProps = seekerPreview || roleReveal ? this.baselineProps : this.staticProps;
    const entities: WorldEntity[] = visibleProps.map((prop) => ({
      id: prop.id,
      category: "prop",
      propKind: prop.kind,
      x: prop.x,
      y: prop.y,
      rotation: prop.rotation,
      moving: false,
      controlled: false,
      teammate: false,
      caught: false,
      // 술래에게 원본 revision을 주면 자리바꿈 대상 둘만 추릴 수 있으므로 동일한 정적 값으로 비식별화한다.
      teleportRevision: viewer.role === "SEEKER" ? 0 : prop.teleportRevision ?? 0,
    }));
    for (const player of roleReveal ? [] : this.players.values()) {
      if (player.role === "HIDER" && !player.caught && !seekerPreview) {
        entities.push({
          id: player.entityId,
          category: "prop",
          propKind: player.propKind,
          x: player.x,
          y: player.y,
          rotation: player.rotation,
          moving: now - player.lastMovedAt < 260,
          controlled: player.id === viewer.id,
          teammate: viewer.role === "HIDER" && player.role === "HIDER" && player.id !== viewer.id,
          caught: false,
          teleportRevision: viewer.role === "SEEKER" ? 0 : player.teleportRevision,
        });
      }
      if (player.role === "SEEKER") {
        entities.push({
          id: player.entityId,
          category: "seeker",
          x: player.x,
          y: player.y,
          rotation: player.rotation,
          moving: now - player.lastMovedAt < 260,
          controlled: player.id === viewer.id,
          teammate: viewer.role === "SEEKER" && player.id !== viewer.id,
          caught: false,
          teleportRevision: player.teleportRevision,
          displayName: player.displayName,
          avatar: player.avatar,
        });
      }
    }
    entities.sort((a, b) => a.id.localeCompare(b.id));

    const mission: MissionView | undefined = viewer.mission
      ? {
          zoneId: viewer.mission.zoneId,
          label: viewer.mission.label,
          progress: Math.min(1, viewer.mission.progressMs / this.rules.missionHoldMs),
          completed: viewer.mission.completed,
        }
      : undefined;
    const timing = roundTimingFor(this.roundPlayerCount || this.players.size, this.rules);
    const snapshot: GameSnapshot = {
      version: this.version,
      serverTime: now,
      roomId: this.roomId,
      mode: this.mode,
      ...(this.mode === "practice" ? { aiDifficulty: this.aiDifficulty } : {}),
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      round: this.round,
      totalRounds: this.rules.totalRounds,
      roundPlayerCount: timing.playerCount,
      roundDurationMs: timing.totalMs,
      seekingDurationMs: timing.seekingMs,
      minPlayers: this.publicMinPlayers(),
      maxPlayers: this.mode === "practice" ? 4 : this.maxClients,
      canStart:
        (this.phase === "LOBBY" || this.phase === "FINAL") &&
        this.hasEnoughPlayers() &&
        this.humanPlayers().every((player) => player.ready),
      seekerPreview,
      self: {
        playerId: viewer.id,
        role: viewer.role,
        focus: Math.round(viewer.focus),
        locked: viewer.locked,
        swapAvailable: !viewer.swapUsed,
        tagReadyAt: viewer.tagReadyAt,
        lensReadyAt: viewer.lensReadyAt,
        caught: viewer.caught,
        movementSpeed: this.movementSpeedFor(viewer),
      },
      players,
      entities,
      map: this.generatedMap.layout,
      mission,
      result: this.result,
      replay: revealRoles ? [...this.replay] : [],
    };
    client.send("state", snapshot);
  }

  private setPhase(phase: GamePhase, endsAt: number): void {
    this.phase = phase;
    this.phaseEndsAt = endsAt;
    this.version += 1;
    void this.setMetadata({ mode: this.mode, phase });
  }

  private addReplay(type: ReplayBeat["type"], label: string): void {
    this.replay.push({ id: opaqueId("beat"), at: Date.now(), type, label });
    if (this.replay.length > 12) this.replay.shift();
  }

  private broadcastEffect(effect: Omit<GameEffect, "id">, role?: PlayerRole): void {
    const payload: GameEffect = { id: opaqueId("effect"), ...effect };
    if (!role) {
      this.broadcast("effect", payload);
      return;
    }
    for (const client of this.clients) {
      if (this.playerFor(client)?.role === role) client.send("effect", payload);
    }
  }

  private sendError(client: Client, title: string, label: string): void {
    client.send("action-error", { id: opaqueId("error"), title, label });
  }

  private pruneRecentMoves(now: number): void {
    while (this.recentMoves.length > 0 && now - this.recentMoves[0].at > 2_500) {
      this.recentMoves.shift();
    }
  }

  private playerFor(client: Client): InternalPlayer | undefined {
    const id = (client.userData as { playerId?: string } | undefined)?.playerId
      ?? this.sessionToPlayer.get(client.sessionId);
    return id ? this.players.get(id) : undefined;
  }

  private humanPlayers(): InternalPlayer[] {
    return [...this.players.values()].filter((player) => !player.bot);
  }

  private hasEnoughPlayers(): boolean {
    return this.mode === "practice"
      ? this.humanPlayers().filter((player) => player.connected).length >= 1
      : this.humanPlayers().filter((player) => player.connected).length >= this.rules.minPlayers;
  }

  private publicMinPlayers(): number {
    return this.mode === "practice" ? 1 : this.rules.minPlayers;
  }

  /** AI 방은 사람 수가 바뀌어도 사람+AI 합계 네 명을 유지한다. */
  private syncPracticeBots(): void {
    if (this.mode !== "practice") return;
    const targetBotCount = Math.max(0, 4 - this.humanPlayers().length);
    const currentBots = [...this.players.values()].filter((player) => player.bot);
    while (currentBots.length > targetBotCount) {
      const removed = currentBots.pop();
      if (!removed) break;
      this.players.delete(removed.id);
      this.seekerHistory.delete(removed.id);
      this.lastRoundSeekerIds.delete(removed.id);
      this.preparedSeekerIds.delete(removed.id);
    }

    const names = ["몽글", "콩콩", "반짝"];
    const usedNames = new Set([...this.players.values()].map((player) => player.displayName));
    while (currentBots.length < targetBotCount) {
      const index = currentBots.length;
      const name = names.find((candidate) => !usedNames.has(candidate)) ?? `별콩${index + 1}`;
      usedNames.add(name);
      const bot: InternalPlayer = {
        id: opaqueId("bot"),
        displayName: name,
        avatar: avatarAt(index + 2),
        joinedAt: Date.now() + index,
        ready: true,
        connected: true,
        bot: true,
        role: "HIDER",
        score: 0,
        caught: false,
        caughtAt: 0,
        lastSurvivalScore: 0,
        x: 10 + index,
        y: 8,
        rotation: 0,
        entityId: opaqueId("object"),
        propKind: pickPropKind(Date.now(), index),
        locked: false,
        swapUsed: false,
        focus: 100,
        tagReadyAt: 0,
        lastTagAt: 0,
        lensReadyAt: 0,
        lastPingAt: 0,
        lastMovedAt: 0,
        portalReadyAt: 0,
        teleportRevision: 0,
        lastSeq: -1,
        inputX: 0,
        inputY: 0,
        botMemoryExpiresAt: 0,
        botThinkAt: 0,
        botActionAt: 0,
        botRouteIndex: 0,
      };
      this.players.set(bot.id, bot);
      currentBots.push(bot);
    }
  }

  private migrateHost(): void {
    this.hostPlayerId = this.humanPlayers()
      .filter((player) => player.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? "";
  }

  private playerStatus(player: InternalPlayer): PublicPlayer["status"] {
    if (this.phase === "LOBBY" || this.phase === "COUNTDOWN" || this.phase === "FINAL") return "lobby";
    if (!player.connected) return "waiting";
    if (player.caught) return "caught";
    return "playing";
  }
}

function sanitizeDisplayName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\p{C}<>]/gu, "").trim().slice(0, 12);
  return normalized || `손님-${Math.floor(1_000 + Math.random() * 9_000)}`;
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

function avatarAt(index: number): string {
  return ["coral", "mint", "yellow", "violet", "blue", "peach"][index % 6];
}
