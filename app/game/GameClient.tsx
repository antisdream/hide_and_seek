"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import type {
  AiDifficulty,
  GameEffect,
  GamePhase,
  GameSnapshot,
  LobbyChatMessage,
  MoveMessage,
  PingKind,
  Point,
  RoomMode,
  TeamPing,
} from "../../shared/game-types";
import { aiDifficultyLabel } from "../../shared/ai-rules";
import { canTaunt, TAUNT_RULES } from "../../shared/party-rules";
import { GameAudio } from "./game-audio";
import { leaveGameRoom } from "./room-lifecycle";
import { MOVE_HEARTBEAT_INTERVAL_MS } from "../../shared/input-rules";
import { actionForShortcut } from "../../shared/action-shortcuts";
import { copyTextToClipboard, createClientId, readClientPreference, writeClientPreference } from "../../shared/client-runtime";
import { normalizeInviteCode } from "../../shared/invite-code";
import { createInviteUrl, resolveGameServerEndpoint } from "../../shared/network-url";
import { mountGameRenderer, type GameRenderer, type LensPulse } from "./game-renderer";

type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

interface Notice {
  id: string;
  title?: string;
  label: string;
  tone?: "normal" | "error" | "success";
}

type GuideStage = "LOBBY" | "HIDER_HIDE" | "HIDER_SURVIVE" | "SEEKER_PREVIEW" | "SEEKER_SEARCH";

const CONFIGURED_GAME_ENDPOINT = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
const HUD_UPDATE_INTERVAL_MS = 100;

export default function GameClient({ initialPlay = "solo" }: { initialPlay?: "solo" | "friends" | "public" }) {
  const [displayName, setDisplayName] = useState("");
  const [inviteRoomId, setInviteRoomId] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [chatMessages, setChatMessages] = useState<LobbyChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [room, setRoom] = useState<Room>();
  const [snapshot, setSnapshot] = useState<GameSnapshot>();
  const [notice, setNotice] = useState<Notice>();
  const [coachOpen, setCoachOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [soloDifficulty, setSoloDifficulty] = useState<AiDifficulty>("normal");
  const [joinMode, setJoinMode] = useState<"solo" | "friends" | "public">(initialPlay);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const audioRef = useRef<GameAudio | undefined>(undefined);
  const audioToggleBusyRef = useRef(false);
  const connectionGenerationRef = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GameRenderer | undefined>(undefined);
  const roomRef = useRef<Room | undefined>(undefined);
  const sequenceRef = useRef(0);
  const pressedKeysRef = useRef(new Set<string>());
  const lastSentMovementRef = useRef<Point>({ x: 0, y: 0 });
  const snapshotRef = useRef<GameSnapshot | undefined>(undefined);
  const snapshotReceivedAtRef = useRef(0);
  const localMovementLockedRef = useRef(false);
  const pendingLockRef = useRef<{ locked: boolean; requestedAt: number } | undefined>(undefined);
  const previousGuideStageRef = useRef<GuideStage | undefined>(undefined);
  const pendingHudSnapshotRef = useRef<GameSnapshot | undefined>(undefined);
  const hudTimerRef = useRef<number | undefined>(undefined);
  const hudPublishedAtRef = useRef(0);
  const hudSemanticKeyRef = useRef("");

  const sendMovementNow = useCallback(() => {
    const activeRoom = roomRef.current;
    if (!activeRoom || !activeRoom.connection.isOpen) {
      pressedKeysRef.current.clear();
      lastSentMovementRef.current = { x: 0, y: 0 };
      rendererRef.current?.setLocalMovement({ x: 0, y: 0 });
      return;
    }
    const current = snapshotRef.current;
    const activePhase = current?.phase === "HIDING" || current?.phase === "SEEKING";
    const movementBlocked = !activePhase || Boolean(localMovementLockedRef.current || current?.self.caught);
    const direction = movementBlocked ? { x: 0, y: 0 } : movementFromKeys(pressedKeysRef.current);
    rendererRef.current?.setLocalMovement(direction);
    const previous = lastSentMovementRef.current;
    // 정지 입력은 전환 순간 한 번이면 충분하다. 로비·포획·결과에서 빈 입력을 계속 보내지 않는다.
    if (direction.x === 0 && direction.y === 0 && previous.x === 0 && previous.y === 0) return;
    const message: MoveMessage = { seq: nextSequence(sequenceRef), ...direction };
    if (
      direction.x === 0
      && direction.y === 0
      && Math.hypot(previous.x, previous.y) > 0
    ) {
      const anchor = rendererRef.current?.getLocalPosition();
      if (anchor) {
        message.anchorX = anchor.x;
        message.anchorY = anchor.y;
        message.anchorRevision = anchor.teleportRevision;
      }
      rendererRef.current?.setLocalMovement(direction, message.seq);
    }
    activeRoom.send("move", message);
    lastSentMovementRef.current = direction;
  }, []);

  const publishHudSnapshot = useCallback((nextSnapshot: GameSnapshot) => {
    pendingHudSnapshotRef.current = undefined;
    hudTimerRef.current = undefined;
    hudPublishedAtRef.current = performance.now();
    hudSemanticKeyRef.current = hudSemanticKey(nextSnapshot);
    setServerOffset(nextSnapshot.serverTime - Date.now());
    setSnapshot(nextSnapshot);
  }, []);

  const receiveSnapshot = useCallback((nextSnapshot: GameSnapshot) => {
    audioRef.current?.snapshot(nextSnapshot);
    snapshotRef.current = nextSnapshot;
    snapshotReceivedAtRef.current = Date.now();
    rendererRef.current?.pushSnapshot(nextSnapshot);
    const pendingLock = pendingLockRef.current;
    if (pendingLock && nextSnapshot.self.locked === pendingLock.locked) {
      pendingLockRef.current = undefined;
      localMovementLockedRef.current = nextSnapshot.self.locked;
    } else if (pendingLock && Date.now() - pendingLock.requestedAt <= 1_000) {
      // 잠금 요청이 서버 상태에 반영되기 전까지는 클릭 시점의 안전한 이동 차단을 유지한다.
      localMovementLockedRef.current = pendingLock.locked ? true : nextSnapshot.self.locked;
    } else {
      pendingLockRef.current = undefined;
      localMovementLockedRef.current = nextSnapshot.self.locked;
    }
    if (localMovementLockedRef.current || nextSnapshot.self.caught) {
      pressedKeysRef.current.clear();
      lastSentMovementRef.current = { x: 0, y: 0 };
      rendererRef.current?.setLocalMovement({ x: 0, y: 0 });
    }
    const key = hudSemanticKey(nextSnapshot);
    const elapsed = performance.now() - hudPublishedAtRef.current;
    if (key !== hudSemanticKeyRef.current || elapsed >= HUD_UPDATE_INTERVAL_MS) {
      if (hudTimerRef.current !== undefined) window.clearTimeout(hudTimerRef.current);
      publishHudSnapshot(nextSnapshot);
      return;
    }
    pendingHudSnapshotRef.current = nextSnapshot;
    if (hudTimerRef.current !== undefined) return;
    hudTimerRef.current = window.setTimeout(() => {
      const pending = pendingHudSnapshotRef.current;
      if (pending) publishHudSnapshot(pending);
      else hudTimerRef.current = undefined;
    }, Math.max(0, HUD_UPDATE_INTERVAL_MS - elapsed));
  }, [publishHudSnapshot]);

  const clearHudSchedule = useCallback(() => {
    if (hudTimerRef.current !== undefined) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = undefined;
    pendingHudSnapshotRef.current = undefined;
    hudSemanticKeyRef.current = "";
    hudPublishedAtRef.current = 0;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDisplayName(readClientPreference("nunchisoom-display-name") ?? "");
      const params = new URLSearchParams(window.location.search);
      const roomId = params.get("room") ?? "";
      const requestedPlay = params.get("play");
      if (requestedPlay === "friends" || requestedPlay === "public") setJoinMode(requestedPlay);
      setInviteRoomId(roomId);
      setInviteCodeInput(roomId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!room || !canvasRef.current) return;
    let disposed = false;
    void mountGameRenderer(canvasRef.current, {
      onTag: (entityId) => {
        const activeRoom = roomRef.current;
        if (!activeRoom || !activeRoom.connection.isOpen) return;
        activeRoom.send("tag", { seq: nextSequence(sequenceRef), entityId });
      },
    }).then((renderer) => {
      if (disposed) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      if (snapshotRef.current) renderer.pushSnapshot(snapshotRef.current);
      const current = snapshotRef.current;
      renderer.setLocalMovement(!roomRef.current?.connection.isOpen || localMovementLockedRef.current || current?.self.caught
        ? { x: 0, y: 0 }
        : movementFromKeys(pressedKeysRef.current));
    });
    return () => {
      disposed = true;
      rendererRef.current?.destroy();
      rendererRef.current = undefined;
    };
  }, [room]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!snapshot) {
        previousGuideStageRef.current = undefined;
        setCoachOpen(false);
        return;
      }
      const stage = snapshot.phase === "FINAL" ? undefined : guideStageFor(snapshot);
      if (!stage) {
        previousGuideStageRef.current = undefined;
        setCoachOpen(false);
        return;
      }
      if (previousGuideStageRef.current !== stage) {
        const seen = readClientPreference(guideStorageKey(stage)) === "1";
        setCoachOpen(!seen);
        previousGuideStageRef.current = stage;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  useEffect(() => {
    if (!room) return;
    const pressedKeys = pressedKeysRef.current;
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isTypingTarget(event.target)) return;
      const key = movementKey(event.key);
      if (!key) return;
      event.preventDefault();
      if (!roomRef.current?.connection.isOpen) return;
      if (localMovementLockedRef.current) {
        setNotice({
          id: createClientId(),
          title: "위치 고정 중",
          label: "‘고정 해제’를 누르면 다시 움직일 수 있어요.",
        });
        return;
      }
      if (snapshotRef.current?.self.caught) return;
      if (pressedKeys.has(key)) return;
      pressedKeys.add(key);
      sendMovementNow();
    };
    const keyUp = (event: KeyboardEvent) => {
      const key = movementKey(event.key);
      if (!key) return;
      if (!event.isComposing && !isTypingTarget(event.target)) event.preventDefault();
      if (pressedKeys.delete(key)) sendMovementNow();
    };
    const releaseKeys = () => {
      if (pressedKeys.size === 0) return;
      pressedKeys.clear();
      sendMovementNow();
    };
    const releaseHiddenKeys = () => {
      if (document.visibilityState === "hidden") releaseKeys();
    };
    const releaseTypingKeys = (event: FocusEvent) => {
      if (isTypingTarget(event.target)) releaseKeys();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseKeys);
    document.addEventListener("visibilitychange", releaseHiddenKeys);
    document.addEventListener("focusin", releaseTypingKeys);

    const sender = window.setInterval(() => {
      sendMovementNow();
    }, MOVE_HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(sender);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseKeys);
      document.removeEventListener("visibilitychange", releaseHiddenKeys);
      document.removeEventListener("focusin", releaseTypingKeys);
      pressedKeys.clear();
    };
  }, [room, sendMovementNow]);

  useEffect(() => () => {
    clearHudSchedule();
    connectionGenerationRef.current += 1;
    audioRef.current?.destroy();
    audioRef.current = undefined;
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    leaveGameRoom(activeRoom);
  }, [clearHudSchedule]);

  const connect = useCallback(async (mode: RoomMode, requestedRoomId?: string, practiceDifficulty?: AiDifficulty) => {
    if (status === "connecting") return;
    const normalizedRoomId = requestedRoomId ? normalizeInviteCode(requestedRoomId) : undefined;
    if (requestedRoomId && !normalizedRoomId) {
      setNotice({ id: createClientId(), title: "초대 코드 확인", label: "올바른 초대 코드 또는 초대 링크를 입력해 주세요.", tone: "error" });
      return;
    }
    const normalizedName = displayName.normalize("NFKC").trim().slice(0, 12);
    if (!normalizedName) {
      setNotice({ id: createClientId(), title: "별명 확인", label: "1~12자의 별명을 입력해 주세요.", tone: "error" });
      return;
    }

    setStatus("connecting");
    const connectionGeneration = ++connectionGenerationRef.current;
    setNotice({ id: createClientId(), label: "게임에 들어가고 있어요…" });
    writeClientPreference("nunchisoom-display-name", normalizedName);
    try {
      const gameEndpoint = resolveGameServerEndpoint(window.location.href, CONFIGURED_GAME_ENDPOINT);
      const client = new ColyseusSDK(gameEndpoint);
      const options = {
        displayName: normalizedName,
        deviceId: getDeviceId(),
        mode,
      };
      const joinedRoom = normalizedRoomId
        ? await client.joinById(normalizedRoomId, options)
        : mode === "public"
          ? await joinPublicWaitingRoom(client, options)
          : await client.create("nunchisoom", options);

      // 느린 연결 중 페이지를 떠났다면 AI 경기를 시작하지 않고 만들어진 연결을 즉시 정리한다.
      if (connectionGeneration !== connectionGenerationRef.current) {
        leaveGameRoom(joinedRoom);
        return;
      }
      // 입장 직후에도 서버의 10초 유예를 사용할 수 있게 SDK의 기본 5초 최소 연결시간을 해제한다.
      joinedRoom.reconnection.minUptime = 0;

      joinedRoom.onMessage<GameSnapshot>("state", (next) => {
        if (roomRef.current === joinedRoom) receiveSnapshot(next);
      });
      joinedRoom.onMessage<GameEffect>("effect", (effect) => {
        if (roomRef.current !== joinedRoom) return;
        audioRef.current?.effect(effect);
        rendererRef.current?.pushEffect(effect);
        setNotice({ id: effect.id, label: effect.label, tone: effect.type === "correct-tag" ? "success" : "normal" });
      });
      joinedRoom.onMessage<LensPulse>("lens", (pulse) => {
        if (roomRef.current === joinedRoom) rendererRef.current?.pushLens(pulse);
      });
      joinedRoom.onMessage<TeamPing>("ping", (ping) => {
        if (roomRef.current === joinedRoom) rendererRef.current?.pushPing(ping);
      });
      joinedRoom.onMessage<{ id: string; title: string; label: string }>("action-error", (error) => {
        if (roomRef.current !== joinedRoom) return;
        setNotice({ ...error, tone: "error" });
      });
      joinedRoom.onMessage<{ label: string }>("notice", (message) => {
        if (roomRef.current !== joinedRoom) return;
        setNotice({ id: createClientId(), label: message.label });
      });
      joinedRoom.onMessage<LobbyChatMessage>("chat:message", (message) => {
        if (roomRef.current !== joinedRoom) return;
        setChatMessages((current) => appendChatMessage(current, message));
      });
      joinedRoom.onMessage<{ messages: LobbyChatMessage[] }>("chat:history", ({ messages }) => {
        if (roomRef.current !== joinedRoom) return;
        setChatMessages(messages.slice(-40));
      });
      joinedRoom.onMessage("chat:clear", () => {
        if (roomRef.current === joinedRoom) setChatMessages([]);
      });
      joinedRoom.onDrop((code, reason) => {
        if (roomRef.current !== joinedRoom) return;
        console.warn("[눈숨 연결 끊김]", JSON.stringify({ code, reason, phase: snapshotRef.current?.phase }));
        pressedKeysRef.current.clear();
        lastSentMovementRef.current = { x: 0, y: 0 };
        rendererRef.current?.setLocalMovement({ x: 0, y: 0 }, null);
        setStatus("reconnecting");
      });
      joinedRoom.onReconnect(() => {
        if (roomRef.current !== joinedRoom) { leaveGameRoom(joinedRoom); return; }
        rendererRef.current?.setLocalMovement({ x: 0, y: 0 }, null);
        setStatus("connected");
        joinedRoom.send("chat:sync", true);
        setNotice({ id: createClientId(), label: "다시 연결됐어요. 이어서 즐겨요!", tone: "success" });
      });
      joinedRoom.onError((code, message) => {
        if (roomRef.current !== joinedRoom) return;
        console.warn("[눈숨 연결 오류]", { code, message });
        setNotice({ id: createClientId(), title: "연결이 원활하지 않아요", label: readableError(new Error(`${code} ${message ?? ""}`)), tone: "error" });
      });
      joinedRoom.onLeave((code, reason) => {
        if (roomRef.current === joinedRoom) {
          const current = snapshotRef.current;
          console.warn("[눈숨 연결 종료]", JSON.stringify({
            code, reason, phase: current?.phase,
            lastAcceptedSeq: current?.self.lastAcceptedSeq,
            teleportRevision: current?.entities.find((entity) => entity.controlled)?.teleportRevision,
            snapshotServerTime: current?.serverTime,
          }));
          roomRef.current = undefined;
          snapshotRef.current = undefined;
          localMovementLockedRef.current = false;
          pendingLockRef.current = undefined;
          pressedKeysRef.current.clear();
          lastSentMovementRef.current = { x: 0, y: 0 };
          clearHudSchedule();
          setStatus("closed");
          setRoom(undefined);
          audioRef.current?.snapshot(undefined);
          setSnapshot(undefined);
          setChatMessages([]);
          setChatText("");
          setInviteRoomId("");
          setInviteCodeInput("");
          setNotice({
            id: createClientId(), title: "게임 연결이 종료됐어요",
            label: "연결이 끊겼어요. 잠시 뒤 다시 들어와 주세요.", tone: "error",
          });
          window.history.replaceState({}, "", "/game");
        }
      });

      roomRef.current = joinedRoom;
      setRoom(joinedRoom);
      setStatus("connected");
      setNotice({ id: createClientId(), label: "대기실에 들어왔어요.", tone: "success" });
      sequenceRef.current = 0;
      lastSentMovementRef.current = { x: 0, y: 0 };
      joinedRoom.send("chat:sync", true);

      if (practiceDifficulty) {
        for (let index = 0; index < 3; index += 1) joinedRoom.send("bot:add", { difficulty: practiceDifficulty });
        joinedRoom.send("ready", true);
        joinedRoom.send("start", true);
      }

      if (mode !== "public" && !normalizedRoomId) {
        const url = new URL(window.location.href);
        url.pathname = "/game";
        url.search = `?room=${encodeURIComponent(joinedRoom.roomId)}`;
        window.history.replaceState({}, "", url);
        setInviteRoomId(joinedRoom.roomId);
      }
    } catch (error: unknown) {
      if (connectionGeneration !== connectionGenerationRef.current) return;
      setStatus("idle");
      setNotice({
        id: createClientId(),
        title: "방에 들어가지 못했어요",
        label: readableError(error),
        tone: "error",
      });
    }
  }, [clearHudSchedule, displayName, receiveSnapshot, status]);

  const disconnect = useCallback(() => {
    connectionGenerationRef.current += 1;
    audioRef.current?.snapshot(undefined);
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    snapshotRef.current = undefined;
    localMovementLockedRef.current = false;
    pendingLockRef.current = undefined;
    rendererRef.current?.setLocalMovement({ x: 0, y: 0 });
    pressedKeysRef.current.clear();
    lastSentMovementRef.current = { x: 0, y: 0 };
    clearHudSchedule();
    leaveGameRoom(activeRoom);
    setRoom(undefined);
    setSnapshot(undefined);
    setChatMessages([]);
    setChatText("");
    setStatus("idle");
    setInviteRoomId("");
    setInviteCodeInput("");
    window.history.replaceState({}, "", "/game");
  }, [clearHudSchedule]);

  const send = useCallback((type: string, payload: unknown) => {
    const activeRoom = roomRef.current;
    if (!activeRoom || !activeRoom.connection.isOpen) return;
    if (type === "lock" && typeof payload === "boolean") {
      pendingLockRef.current = { locked: payload, requestedAt: Date.now() };
      // 잠금은 클릭한 프레임부터 막고, 해제는 서버 응답을 확인한 뒤 다시 이동을 허용한다.
      if (payload) localMovementLockedRef.current = true;
      pressedKeysRef.current.clear();
      rendererRef.current?.setLocalMovement({ x: 0, y: 0 });
      const previous = lastSentMovementRef.current;
      const stopMessage: MoveMessage = { seq: nextSequence(sequenceRef), x: 0, y: 0 };
      if (Math.hypot(previous.x, previous.y) > 0) {
        const anchor = rendererRef.current?.getLocalPosition();
        if (anchor) {
          stopMessage.anchorX = anchor.x;
          stopMessage.anchorY = anchor.y;
          stopMessage.anchorRevision = anchor.teleportRevision;
        }
      }
      // WebSocket 순서를 이용해 서버가 정지 좌표를 먼저 확정한 다음 그 자리에서 고정한다.
      rendererRef.current?.setLocalMovement({ x: 0, y: 0 }, stopMessage.seq);
      activeRoom.send("move", stopMessage);
      lastSentMovementRef.current = { x: 0, y: 0 };
      activeRoom.send(type, payload);
      return;
    }
    activeRoom.send(type, payload);
  }, []);

  const copyInvite = useCallback(async () => {
    if (!room) return;
    const inviteUrl = createInviteUrl(window.location.href, room.roomId);
    const copied = await copyTextToClipboard(inviteUrl);
    setNotice(copied
      ? { id: createClientId(), label: "초대 링크를 복사했어요. 친구에게 보내 주세요!", tone: "success" }
      : { id: createClientId(), label: `초대 링크를 직접 복사하세요: ${inviteUrl}`, tone: "normal" });
  }, [room]);

  useEffect(() => {
    if (!room) return;
    const keyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !roomRef.current?.connection.isOpen) return;
      const current = snapshotRef.current;
      const action = actionForShortcut(event, current, current ? current.serverTime + (Date.now() - snapshotReceivedAtRef.current) : Date.now());
      if (!action) return;
      event.preventDefault();
      // 버튼과 동일한 전송 경로로 정지 좌표 확인과 위치 고정 순서를 보존한다.
      if (action.type === "lock" && pendingLockRef.current) action.payload = !pendingLockRef.current.locked;
      send(action.type, action.payload);
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [room, send]);

  const toggleSound = async () => {
    if (audioToggleBusyRef.current) return;
    audioToggleBusyRef.current = true;
    try {
      audioRef.current ??= new GameAudio();
      audioRef.current.snapshot(snapshotRef.current);
      const enabled = await audioRef.current.setEnabled(!soundEnabled);
      setSoundEnabled(enabled);
      if (!enabled && !soundEnabled) setNotice({ id: createClientId(), label: "이 브라우저에서 소리를 켜지 못했어요. 화면을 보면서 계속 즐길 수 있어요." });
    } catch {
      setSoundEnabled(false);
      setNotice({ id: createClientId(), label: "소리를 켜지 못했어요. 소리 버튼을 다시 눌러 주세요." });
    } finally {
      audioToggleBusyRef.current = false;
    }
  };

  const copyResult = async () => {
    const current = snapshotRef.current;
    if (!current || current.phase !== "FINAL") return;
    const self = current.players.find((player) => player.id === current.self.playerId);
    const text = `눈숨 ${current.totalRounds}라운드 완주! ${self?.displayName ?? "나"} ${self?.score ?? 0}점 · 다음 판 함께해요\n${createInviteUrl(window.location.href, current.roomId)}`;
    const copied = await copyTextToClipboard(text);
    setNotice({ id: createClientId(), label: copied ? "내 결과와 초대 링크를 복사했어요. 친구에게 보내 주세요!" : `직접 복사해 주세요: ${text}`, tone: copied ? "success" : "normal" });
  };

  const setTouchKey = useCallback((key: string, active: boolean) => {
    if (active && !roomRef.current?.connection.isOpen) return;
    if (active && (localMovementLockedRef.current || snapshotRef.current?.self.caught)) return;
    const changed = active
      ? !pressedKeysRef.current.has(key)
      : pressedKeysRef.current.has(key);
    if (!changed) return;
    if (active) pressedKeysRef.current.add(key);
    else pressedKeysRef.current.delete(key);
    sendMovementNow();
  }, [sendMovementNow]);

  const serverNow = clockNow + serverOffset;
  const finalChase = isFinalChase(snapshot, serverNow);
  const waitingRoom = snapshot?.phase === "LOBBY" || snapshot?.phase === "FINAL";
  const selfIsHost = Boolean(snapshot?.players.find((player) => player.id === snapshot.self.playerId)?.host);
  const dismissCoach = () => {
    const stage = snapshot ? guideStageFor(snapshot) : undefined;
    if (stage) writeClientPreference(guideStorageKey(stage), "1");
    setCoachOpen(false);
  };

  if (!room) {
    return (
      <main className="join-page night-entry">
        <header className="game-topbar">
          <Link className="brand" href="/" prefetch={false} aria-label="눈숨 홈">
            <span className="brand-mark" aria-hidden="true">눈</span><span>눈숨</span>
          </Link>
          <a className="text-link" href="/how-to-play">게임 방법</a>
        </header>

        <section className="join-layout">
          <div className="join-intro">
            <p className="eyebrow">눈숨 · 눈치 보며 숨바꼭질</p>
            <h2>물건 사이에<br /><em>쏙 숨어볼까요?</em></h2>
            <p>혼자라면 AI와 먼저 해봐요.<br />친구와 함께라면 방을 만들고 초대해 주세요.</p>
            <figure className="entry-art"><Image src="/og.png" width={1731} height={909} sizes="(max-width: 900px) 100vw, 480px" alt="문구점에서 친구들을 찾는 모루" /></figure>
            <div className="entry-first-steps"><strong>처음이어도 괜찮아요.</strong><p>게임이 시작되면 내 역할을 알려드려요.<br />궁금할 때는 물음표를 눌러 보세요.</p><a href="/how-to-play">게임 방법 살펴보기 →</a></div>
          </div>

          <div className="join-card">
            <div className="entry-card-heading"><p className="eyebrow">플레이 준비</p><h1>{inviteRoomId ? "친구가 보낸 초대장이에요" : "어떻게 놀까요?"}</h1><p>{inviteRoomId ? "별명을 정하고 방에 들어가 보세요." : "같이 놀 방법을 고르고 별명을 정해 주세요."}</p></div>
            {!inviteRoomId && <div className="join-mode-selector" role="group" aria-label="플레이 방식">
              <button type="button" aria-pressed={joinMode === "solo"} disabled={status === "connecting"} onClick={() => setJoinMode("solo")}>혼자 하기</button>
              <button type="button" aria-pressed={joinMode === "friends"} disabled={status === "connecting"} onClick={() => setJoinMode("friends")}>친구랑 하기</button>
              <button type="button" aria-pressed={joinMode === "public"} disabled={status === "connecting"} onClick={() => setJoinMode("public")}>공개방 찾기</button>
            </div>}
            <label className="field-label" htmlFor="display-name">별명</label>
            <input
              id="display-name"
              className="text-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={12}
              placeholder="예: 숨은콩"
              autoComplete="nickname"
            />

            {inviteRoomId ? (
              <div className="invite-found">
                <div><span>초대장 도착</span><strong>{inviteRoomId}</strong></div>
                <button className="primary-button wide" type="button" disabled={status === "connecting"} onClick={() => void connect("invite", inviteRoomId)}>
                  친구 방에 들어가기
                </button>
                <button type="button" className="secondary-button" disabled={status === "connecting"} onClick={() => {
                  setInviteRoomId(""); setInviteCodeInput(""); window.history.replaceState({}, "", "/game");
                }}>다른 방법으로 시작하기</button>
              </div>
            ) : (
              <div className="mode-grid unified-modes" aria-label="게임 방식 선택">
                {joinMode === "solo" && <section className="solo-start-card" aria-label="혼자 바로 시작">
                  <div><strong>AI 친구 3명과 시작해요</strong><small>처음이라면 쉬움으로 가볍게 해보세요.</small></div>
                  <label htmlFor="solo-difficulty">AI 난이도</label>
                  <select id="solo-difficulty" value={soloDifficulty} onChange={(event) => setSoloDifficulty(event.target.value as AiDifficulty)} disabled={status === "connecting"}>
                    <option value="easy">쉬움</option><option value="normal">보통</option><option value="hard">어려움</option>
                  </select>
                  <button className="primary-button" type="button" disabled={status === "connecting"} onClick={() => void connect("invite", undefined, soloDifficulty)}>{status === "connecting" ? "게임에 연결하는 중…" : "AI와 바로 시작"}</button>
                </section>}
                {joinMode === "public" && <section className="public-start-card" aria-label="공개방 찾기"><strong>함께할 방을 찾아봐요</strong><p>빈자리가 있는 방으로 들어가요. 열린 방이 없으면 새 방을 만들어요. 사람이 부족하면 방장이 AI를 불러올 수 있어요.</p><button className="primary-button wide" type="button" disabled={status === "connecting"} onClick={() => void connect("public")}>{status === "connecting" ? "대기실 찾는 중…" : "공개 대기실 찾기"}</button><small>바로 한 판 시작하고 싶다면 ‘혼자 하기’를 선택하세요.</small></section>}
                {joinMode === "friends" && <section className="create-room-card" aria-labelledby="create-room-title">
                  <div className="create-room-heading">
                    <span aria-hidden="true">◎</span>
                    <div><strong id="create-room-title">친구들을 초대해요</strong><small>방을 만들고 초대 링크를 보내 주세요.</small></div>
                  </div>
                  <button className="create-room-button" type="button" disabled={status === "connecting"} onClick={() => void connect("invite")}>
                    {status === "connecting" ? "대기실에 연결하는 중…" : "친구 방 만들기"}
                  </button>
                  <p className="create-room-note">4명부터 시작할 수 있어요. 사람이 모자라면 AI 친구를 불러오세요.</p>
                </section>}
              </div>
            )}
            {!inviteRoomId && joinMode === "friends" && (
              <form
                className="invite-join"
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect("invite", inviteCodeInput);
                }}
              >
                <label htmlFor="invite-code"><strong>초대 코드로 참가</strong><small>친구가 보낸 코드 또는 링크를 붙여 넣으세요.</small></label>
                <div>
                  <input
                    id="invite-code"
                    className="text-input"
                    value={inviteCodeInput}
                    onChange={(event) => setInviteCodeInput(event.target.value)}
                    placeholder="초대 코드 또는 링크"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="submit" disabled={status === "connecting"}>참가</button>
                </div>
              </form>
            )}
            <p className="join-safety">무료 · 설치·가입 없음 · 마이크 없이 플레이</p>
            {notice && <NoticeCard notice={notice} />}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`play-page play-workspace ${waitingRoom ? "is-waiting" : "is-playing"} ${panelsOpen ? "panels-open" : ""}`}>
      <header className="play-header">
        <Link className="brand compact" href="/" prefetch={false} aria-label="눈숨 홈">
          <span className="brand-mark" aria-hidden="true">눈</span><span>눈숨</span>
        </Link>
        <div className={finalChase ? "phase-summary urgent" : "phase-summary"} aria-live="polite">
          <span className={`phase-icon phase-${snapshot?.phase.toLowerCase() ?? "lobby"}`} aria-hidden="true" />
          <div><small>{finalChase ? "막판 위험 경보" : phaseKicker(snapshot?.phase)}</small><strong>{finalChase ? "마지막 추격" : phaseLabel(snapshot?.phase)}</strong></div>
          <time>{formatRemaining(snapshot, serverNow)}</time>
        </div>
        <div className="play-header-actions">
          <button type="button" onClick={() => setCoachOpen(true)} disabled={!snapshot}>
            도움말
          </button>
          {!waitingRoom && <button type="button" aria-expanded={panelsOpen} aria-controls="participants-panel" onClick={() => setPanelsOpen(open => !open)}>참가자·팀</button>}
          <details className="room-menu"><summary>메뉴</summary><div className="room-tools">
          <button type="button" aria-pressed={soundEnabled} onClick={() => void toggleSound()} title="배경음과 효과음은 선택 사항입니다">{soundEnabled ? "소리 끄기" : "소리 켜기"}</button>
          <button type="button" onClick={() => void copyInvite()} title="초대 링크 복사">
            초대 코드 {shortRoomId(room.roomId)} <span>링크 복사</span>
          </button>
          <button type="button" className="leave-button" onClick={() => void disconnect()}>나가기</button>
          </div></details>
        </div>
      </header>

      <section className="play-grid">
        <aside className="players-panel" id="participants-panel" aria-label="참가자 목록">
          <div className="panel-heading"><div><small>{modeLabel(snapshot?.mode)}</small><h2>참가자</h2></div><strong>{snapshot?.players.length ?? 0}/{snapshot?.maxPlayers ?? 10}</strong></div>
          <div className="player-list">
            {snapshot?.players.map((player) => (
              <article className={`player-row avatar-${player.avatar}`} key={player.id}>
                <span className="avatar-face" aria-hidden="true"><i /><i /><b /></span>
                <div>
                  <strong>{player.displayName}{player.bot ? ` · AI ${aiDifficultyLabel(player.aiDifficulty ?? "normal")}` : ""}</strong>
                  <small>{player.host ? "방장 · " : ""}{playerStatusLabel(player.status, player.ready, snapshot.phase)}{player.survivalScore !== undefined ? ` · 생존 +${player.survivalScore}` : ""}</small>
                </div>
                <div className="player-row-actions">
                  {selfIsHost && waitingRoom && player.bot && (
                    <button className="remove-bot-button" type="button" onClick={() => send("bot:remove", { botId: player.id })}>
                      내보내기
                    </button>
                  )}
                  <b>{player.score}</b>
                </div>
              </article>
            ))}
          </div>
          {snapshot && (snapshot.phase === "LOBBY" || snapshot.phase === "FINAL") && (
            <LobbyControls snapshot={snapshot} send={send} />
          )}
          {snapshot && waitingRoom && (
            <LobbyChat
              messages={chatMessages}
              value={chatText}
              onChange={setChatText}
              onSend={() => {
                const text = chatText.trim();
                if (!text) return;
                send("chat:send", { text });
                setChatText("");
              }}
            />
          )}
          <div className="silent-note"><span aria-hidden="true">◫</span><p><strong>소리 없이도 플레이 가능</strong><br />중요한 상황을 색·모양·문구로 알려드립니다.</p></div>
          <section className="action-panel" aria-label="팀 신호와 설명">
            <div className="panel-heading"><h2>함께 플레이</h2></div>
            <TeamPings role={snapshot?.self.role} send={send} />
            <details className="play-rules-details"><summary>역할과 조작 다시 보기</summary><p>{roleInstruction(snapshot)}</p><p>{controlInstruction(snapshot)}</p><button type="button" onClick={() => { setPanelsOpen(false); setCoachOpen(true); }}>단계별 도움말 열기</button></details>
            <p className="team-reminder">게임의 중요한 단서는 화면에도 표시돼요. 소리를 켜지 않아도 함께할 수 있어요.</p>
          </section>
        </aside>

        <section className="game-column" aria-label="게임 화면">
          <details className="play-objective">
            <summary><strong>{snapshot?.self.role === "HIDER" ? "▣ 숨는 팀" : snapshot?.self.role === "SEEKER" ? "☾ 술래" : "역할 확인 중"}</strong><span>{snapshot?.self.caught ? "들켰어요" : snapshot?.self.role === "SEEKER" ? `집중력 ${Math.round(snapshot.self.focus)}` : snapshot?.self.locked ? "위치 고정 중" : "이동 가능"}</span><span className="objective-expand">역할·조작 설명 ⌄</span></summary>
            <div className="play-objective-details"><RoleCard snapshot={snapshot} /><RoleStatusCard snapshot={snapshot} /></div>
          </details>
          <div className={finalChase ? "canvas-frame final-chase" : "canvas-frame"}>
            <div ref={canvasRef} className="phaser-host" />
            {snapshot && (
              <div className="map-ribbon">
                <span>{snapshot.round || 1}R</span><strong>{snapshot.map.name || "밤의 문구점"}</strong>
              </div>
            )}
            {status === "reconnecting" && <div className="game-overlay reconnect-overlay"><strong>다시 연결하는 중…</strong><span>10초 동안 기다릴게요. 연결되면 바로 돌아와요.</span></div>}
            {snapshot?.phase === "COUNTDOWN" && <RoleRevealOverlay snapshot={snapshot} serverNow={serverNow} />}
            {snapshot?.seekerPreview && (
              <div className="preview-ribbon">
                <span aria-hidden="true">☾</span>
                <div><strong>기준 배치 확인 중</strong><small>마우스 드래그 이동 · 휠 확대/축소 · 숨는 팀은 보이지 않아요</small></div>
              </div>
            )}
            {finalChase && <div className="final-chase-ribbon"><span aria-hidden="true">!</span><strong>수색 종료 15초 전</strong><small>남은 숨는 팀을 찾아보세요</small></div>}
            {snapshot?.result && <ResultOverlay snapshot={snapshot} send={send} connected={status === "connected"} onCopyResult={() => void copyResult()} />}
            {snapshot?.self.caught && snapshot.phase === "SEEKING" && <div className="caught-ribbon">발견됐어요 · 팀 신호로 동료를 도와주세요</div>}
            {coachOpen && snapshot && guideStageFor(snapshot) && (
              <StageHelpCoach snapshot={snapshot} onClose={dismissCoach} />
            )}
            {!waitingRoom && <div className="movement-controls"><span className="movement-label">{snapshot?.self.caught ? "발견됨" : snapshot?.self.locked ? "위치 고정 중" : "이동"}</span><TouchPad setKey={setTouchKey} disabled={status !== "connected" || !(snapshot?.phase === "HIDING" || snapshot?.phase === "SEEKING") || Boolean(snapshot?.self.locked || snapshot?.self.caught)} /></div>}
          </div>
          <div className="game-controls-bar" aria-label="게임 조작">
            <fieldset className="primary-game-actions" aria-label="역할 행동" disabled={status !== "connected"}><ActionButtons snapshot={snapshot} send={send} /></fieldset>
          </div>
          <div className="visual-feed">
            <span className={`connection-dot ${status}`} aria-hidden="true" />
            <div className="current-task"><small>{status === "reconnecting" ? "연결 복구 중" : "연결됨"}</small><p>{controlInstruction(snapshot)}</p></div>
            {notice && <div className={`event-alert ${notice.tone ?? "normal"}`} role="status" aria-live="polite"><small>{notice.title ?? "최근 알림"}</small><p>{notice.label}</p></div>}
          </div>
        </section>

      </section>
    </main>
  );
}

function LobbyControls({ snapshot, send }: { snapshot: GameSnapshot; send: (type: string, payload: unknown) => void }) {
  const self = snapshot.players.find((player) => player.id === snapshot.self.playerId);
  const isHost = Boolean(self?.host);
  const roomFull = snapshot.players.length >= snapshot.maxPlayers;
  const activePlayerCount = snapshot.players.filter((player) => player.bot || player.connected).length;
  return (
    <div className="lobby-controls">
      <p>{activePlayerCount < snapshot.minPlayers ? `게임 시작까지 ${snapshot.minPlayers - activePlayerCount}명 더 필요해요.` : "모두 준비되면 방장이 게임을 시작해요."}</p>
      {isHost ? (
        <div className="bot-manager" aria-label="AI 참가자 관리">
          <strong>AI 참가자 추가</strong>
          <small>난이도를 골라 한 명씩 불러 보세요. 사람과 AI를 합해 10명까지 함께해요.</small>
          <div>
            {(["easy", "normal", "hard"] as const).map((difficulty) => (
              <button
                key={difficulty}
                type="button"
                disabled={roomFull}
                title={aiDifficultyDescription(difficulty)}
                onClick={() => send("bot:add", { difficulty })}
              >
                + {aiDifficultyLabel(difficulty)} AI
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="host-managing-note">방장이 참가 인원과 AI 난이도를 정하고 있습니다.</p>
      )}
      <button className={self?.ready ? "ready-button active" : "ready-button"} type="button" onClick={() => send("ready", !self?.ready)}>
        {self?.ready ? "준비 취소" : "준비 완료"}
      </button>
      {isHost && <button className="host-start" type="button" disabled={!snapshot.canStart} onClick={() => send("start", true)}>게임 시작</button>}
    </div>
  );
}

function LobbyChat({
  messages,
  value,
  onChange,
  onSend,
}: {
  messages: LobbyChatMessage[];
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <section className="lobby-chat" aria-labelledby="lobby-chat-title">
      <div className="lobby-chat-heading">
        <strong id="lobby-chat-title">대기실 채팅</strong>
        <small>텍스트 채팅 · 최대 120자</small>
      </div>
      <div className="lobby-chat-log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <p>인사를 나누고 인원·AI 구성과 준비 여부를 맞춰 보세요.</p>
        ) : messages.map((message) => (
          <article key={message.id}>
            <strong>{message.displayName}</strong>
            <span>{message.text}</span>
          </article>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <label className="sr-only" htmlFor="lobby-chat-input">채팅 메시지</label>
        <input
          id="lobby-chat-input"
          value={value}
          maxLength={120}
          placeholder="메시지 입력"
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit" disabled={!value.trim()}>보내기</button>
      </form>
    </section>
  );
}

function RoleCard({ snapshot }: { snapshot?: GameSnapshot }) {
  const role = snapshot?.self.role ?? "SPECTATOR";
  return (
    <div className={`role-card role-${role.toLowerCase()}`}>
      <span aria-hidden="true">{role === "HIDER" ? "▣" : role === "SEEKER" ? "☾" : "⌛"}</span>
      <div><small>내 역할과 할 일</small><strong>{role === "HIDER" ? "숨는 팀 · 틈새정령" : role === "SEEKER" ? "술래 · 밤지기" : "역할을 기다리는 중"}</strong></div>
      <p>{roleInstruction(snapshot)}</p>
      {role === "SEEKER" && <em>이동 우위 · 숨는 팀보다 약 46% 빠름</em>}
      {role === "HIDER" && <em>{snapshot?.self.locked ? "◆ 위치 고정 중 · 이동키 작동 안 함" : "이동하면 짧은 파문이 남아요"}</em>}
    </div>
  );
}

function RoleStatusCard({ snapshot }: { snapshot?: GameSnapshot }) {
  if (!snapshot || snapshot.self.role === "SPECTATOR") {
    return <div className="state-card waiting"><span>현재 상태</span><strong>역할을 기다리는 중</strong><p>게임이 시작되면 내 역할을 알려드려요.</p></div>;
  }
  if (snapshot.self.role === "HIDER") {
    const caught = snapshot.self.caught;
    const locked = snapshot.self.locked;
    return (
      <div className={`state-card hider-state ${caught ? "caught" : locked ? "locked" : "mobile"}`}>
        <span>지금 내 상태</span>
        <strong>{caught ? "들켰어요 · 친구 응원하기" : locked ? "가만히 숨는 중" : "움직일 수 있어요"}</strong>
        <p>{caught ? "팀 신호로 남은 동료를 도와주세요." : locked ? "다시 움직이려면 먼저 고정 해제를 누르세요." : "움직이면 동그란 흔적이 잠깐 보여요."}</p>
      </div>
    );
  }
  return (
    <div className="focus-card">
      <div><span>확인 집중력</span><strong>{snapshot.self.focus}</strong></div>
      <progress max={100} value={snapshot.self.focus}>{snapshot.self.focus}</progress>
      <p>틀리면 집중력이 줄고 잠시 쉬어야 해요.</p>
    </div>
  );
}

function ActionButtons({ snapshot, send }: { snapshot?: GameSnapshot; send: (type: string, payload: unknown) => void }) {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return <div className="action-empty">경기가 시작되면 역할 행동이 열려요.</div>;
  if (snapshot.phase === "COUNTDOWN") return <div className="action-empty">내 역할을 확인해 주세요. 곧 움직일 수 있어요.</div>;
  if (snapshot.phase === "RESULT" || snapshot.phase === "FINAL") return <div className="action-empty">이번 라운드가 끝났어요. 점수를 확인해 볼까요?</div>;
  if (snapshot.self.caught) return <div className="action-empty">들켰네요! 팀 신호로 아직 숨은 친구들을 도와주세요.</div>;
  if (snapshot.self.role === "HIDER") {
    return (
      <div className="action-buttons">
        <div className="action-item">
          <button type="button" aria-keyshortcuts="1" aria-pressed={snapshot.self.locked} onClick={() => send("lock", !snapshot.self.locked)}><span>◆</span><kbd className="action-shortcut" aria-hidden="true">1</kbd><strong>{snapshot.self.locked ? "고정 해제" : "위치 고정"}</strong><small>{snapshot.self.locked ? "해제해야 다시 움직일 수 있어요" : "이동키를 눌러도 움직이지 않아요"}</small></button>
          <HelpTooltip label="위치 고정" copy="움직임을 멈춰 눈에 덜 띄게 숨어요. 다시 움직이려면 ‘고정 해제’를 눌러 주세요. 수색 시간에는 미션 구역에서 2초 동안 고정하면 점수를 얻어요." />
        </div>
        <div className="action-item">
          <button type="button" aria-keyshortcuts="2" disabled={!snapshot.self.swapAvailable} onClick={() => send("swap", true)}><span>⇄</span><kbd className="action-shortcut" aria-hidden="true">2</kbd><strong>{snapshot.self.swapAvailable ? "자리바꿈" : "사용 완료"}</strong><small>{snapshot.self.swapAvailable ? "맵 전체 같은 사물 중 한 곳 · 1회" : "다음 라운드에 다시 사용할 수 있어요"}</small></button>
          <HelpTooltip label="무작위 자리바꿈" copy="가게 안의 같은 종류 물건 중 하나와 무작위로 자리를 바꿔요. 라운드마다 한 번만 쓸 수 있어요. 들킬 것 같을 때 사용해 보세요." />
        </div>
        {snapshot.self.taunt && <div className="action-item taunt-action">
          <button type="button" aria-keyshortcuts="3" disabled={snapshot.phase !== "SEEKING" || !canTaunt(snapshot.self.taunt, snapshot.serverTime, snapshot.phaseEndsAt)} onClick={() => send("taunt", true)}>
            <span aria-hidden="true">!</span><kbd className="action-shortcut" aria-hidden="true">3</kbd><strong>{snapshot.self.taunt.resolvesAt > snapshot.serverTime ? `${Math.ceil((snapshot.self.taunt.resolvesAt - snapshot.serverTime) / 1_000)}초 더 버티기!` : "여기 있었지!"}</strong>
            <small>{snapshot.phase !== "SEEKING" ? "수색이 시작되면 도발할 수 있어요" : snapshot.self.taunt.remaining === 0 ? "이번 라운드 도발 사용 완료" : snapshot.self.taunt.readyAt > snapshot.serverTime ? `${Math.ceil((snapshot.self.taunt.readyAt - snapshot.serverTime) / 1_000)}초 후 · ${snapshot.self.taunt.remaining}번 남음` : `위치 공개 후 6초 생존 +${TAUNT_RULES.reward}점 · ${snapshot.self.taunt.remaining}번`}</small>
          </button>
          <HelpTooltip label="도발" copy="‘나 여기 있어!’ 하고 위치를 알려요. 그 뒤 6초 동안 잡히지 않으면 20점! 도망가거나 자리를 바꿔도 돼요. 20초 간격으로, 라운드마다 2번 쓸 수 있어요. 잡히거나 연결이 끊기면 점수를 받지 못해요." />
        </div>}
        {snapshot.mission && <div className="mission-card action-with-help"><span>{snapshot.phase === "HIDING" ? "수색 시작 후 진열 미션" : "진열 미션"}</span><strong>{snapshot.mission.label}</strong><progress max={1} value={snapshot.mission.progress}>{Math.round(snapshot.mission.progress * 100)}%</progress><HelpTooltip label="진열 미션" copy="수색이 시작되면 표시된 곳에서 ‘위치 고정’을 누르고 2초 동안 기다려요. 25점을 받을 수 있어요. 술래가 가까이 있다면 무리하지 않아도 돼요." /></div>}
      </div>
    );
  }
  if (snapshot.seekerPreview) {
    return (
      <div className="action-empty preview-actions">
        <strong>가게 모습을 기억해요</strong><br />마우스로 화면을 끌거나 휠로 확대해 보세요. 방향키로 움직여 포탈 반대편도 둘러볼 수 있어요.
      </div>
    );
  }
  const lensSeconds = Math.max(0, Math.ceil((snapshot.self.lensReadyAt - snapshot.serverTime) / 1_000));
  const tagSeconds = Math.max(0, Math.ceil((snapshot.self.tagReadyAt - snapshot.serverTime) / 100) / 10);
  return (
    <div className="action-buttons">
      <div className="action-item">
        <button type="button" aria-keyshortcuts="1" disabled={lensSeconds > 0} onClick={() => send("lens", true)}><span>⌾</span><kbd className="action-shortcut" aria-hidden="true">1</kbd><strong>관찰 렌즈</strong><small>{lensSeconds > 0 ? `${lensSeconds}초 뒤 충전` : "최근 움직임을 구역으로 표시"}</small></button>
        <HelpTooltip label="관찰 렌즈" copy="숨는 친구들이 최근 2초 동안 움직인 구역을 1.8초간 보여줘요. 어떤 물건인지는 직접 찾아야 해요. 한 번 쓰면 30초 뒤에 다시 쓸 수 있어요." />
      </div>
      <div className="action-item tag-action">
        <div className={tagSeconds > 0 ? "tag-tip cooling" : "tag-tip"}><span aria-hidden="true">☝</span><p><strong>사물 확인</strong><br />{tagSeconds > 0 ? `${tagSeconds.toFixed(1)}초 뒤 다시 확인` : "가까운 사물을 클릭·터치"}</p></div>
        <HelpTooltip label="확인 스티커" copy="2.6칸 안에 있고 선반에 가리지 않은 물건을 확인할 수 있어요. 틀리면 집중력이 25 줄고 3초를 기다려야 해요. 집중력을 모두 쓰면 6.5초 뒤에 다시 확인할 수 있어요." />
      </div>
    </div>
  );
}

function TeamPings({ role, send }: { role?: GameSnapshot["self"]["role"]; send: (type: string, payload: unknown) => void }) {
  if (role !== "HIDER" && role !== "SEEKER") return null;
  const choices: Array<[PingKind, string]> = role === "SEEKER"
    ? [["suspect", "수상해요"], ["check", "여기 확인"], ["done", "확인 완료"]]
    : [["danger", "술래 조심"], ["moving", "이동할게요"], ["done", "미션 완료"]];
  return (
    <div className="ping-panel">
      <div className="ping-heading"><span>팀 신호</span><HelpTooltip label="팀 신호" copy="내가 있는 곳에 같은 팀만 볼 수 있는 표시를 남겨요. 수상한 곳이나 술래가 온 방향을 알려 주세요." /></div>
      <div>{choices.map(([kind, label]) => <button key={kind} type="button" onClick={() => send("ping", { kind })}>{label}</button>)}</div>
    </div>
  );
}

function HelpTooltip({ label, copy }: { label: string; copy: string }) {
  return (
    <details className="help-tooltip">
      <summary aria-label={`${label} 자세히 보기`}>?</summary>
      <div role="tooltip"><strong>{label}</strong><p>{copy}</p></div>
    </details>
  );
}

function RoleRevealOverlay({ snapshot, serverNow }: { snapshot: GameSnapshot; serverNow: number }) {
  const seeker = snapshot.self.role === "SEEKER";
  const teamName = seeker ? "술래" : "숨는 팀";
  const roleName = seeker ? "밤지기" : "틈새정령";
  const steps = seeker
    ? ["먼저 가게가 어떤 모습인지 기억해요.", "방향키로 움직이고, 포탈 반대편도 둘러봐요.", "수색이 시작되면 수상한 물건에 다가가 눌러요."]
    : ["다른 물건 옆에 자연스럽게 숨어요.", "자리를 잡으면 ‘위치 고정’을 눌러요.", "들킬 것 같으면 자리바꿈이나 포탈로 빠져나와요."];
  return (
    <div className={`game-overlay role-reveal-overlay ${seeker ? "reveal-seeker" : "reveal-hider"}`} role="dialog" aria-label={`${teamName} ${roleName} 역할 안내`}>
      <span className="role-reveal-symbol" aria-hidden="true">{seeker ? "☾" : "▣"}</span>
      <p className="role-reveal-kicker">{snapshot.round}라운드, 내 역할은?</p>
      <strong>이번에는 <em>{teamName}</em>{seeker ? "예요" : "이에요"}</strong>
      <p className="role-reveal-alias">내 캐릭터 · {roleName}</p>
      <p className="role-reveal-goal">{seeker ? "시간 안에 숨어 있는 친구들을 모두 찾아봐요." : "물건인 척, 시간이 끝날 때까지 들키지 말아요."}</p>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <div className="role-reveal-footer"><time>{formatRemaining(snapshot, serverNow)}</time><span>{formatDurationLabel(snapshot.roundDurationMs)} 라운드 · 곧 {seeker ? "기준 배치 확인" : "숨기"} 시작</span></div>
    </div>
  );
}

function StageHelpCoach({ snapshot, onClose }: { snapshot: GameSnapshot; onClose: () => void }) {
  const stage = guideStageFor(snapshot) ?? "LOBBY";
  const guide = ({
    LOBBY: {
      eyebrow: "처음 플레이 안내",
      title: "친구들과 준비해요",
      steps: ["친구들이 모이면 ‘준비 완료’를 눌러 주세요.", "사람이 모자라면 방장이 AI를 불러올 수 있어요.", "모두 준비되면 방장이 게임을 시작해요."],
    },
    HIDER_HIDE: {
      eyebrow: "숨는 팀 · 1단계",
      title: "어디에 숨을까요?",
      steps: ["같은 종류의 물건이 모인 곳으로 가보세요.", "자리를 잡으면 ‘위치 고정’을 눌러요.", "미션은 수색이 시작된 뒤 할 수 있어요. 지금은 숨을 곳부터 찾아요."],
    },
    HIDER_SURVIVE: {
      eyebrow: "숨는 팀 · 2단계",
      title: "들키지 않게 숨어요",
      steps: ["다시 움직이려면 ‘고정 해제’를 눌러 주세요.", "들킬 것 같으면 다른 물건과 자리를 바꿔요.", "더 도전하고 싶다면 ‘여기 있었지!’를 눌러 보세요. 위치를 알리고 6초 버티면 20점이에요."],
    },
    SEEKER_PREVIEW: {
      eyebrow: "술래 · 1단계",
      title: "처음 가게 모습을 기억해요",
      steps: ["아직 숨는 친구들은 보이지 않아요. 물건과 빈자리를 기억해요.", "마우스로 화면을 끌거나 휠로 확대할 수 있어요.", "방향키로 포탈에 들어가 반대편도 둘러보세요."],
    },
    SEEKER_SEARCH: {
      eyebrow: "술래 · 2단계",
      title: "아까와 달라진 곳을 찾아요",
      steps: ["아까와 달라진 물건이나 움직이는 흔적을 찾아요.", "수상한 물건에 가까이 다가가 눌러 보세요.", "어디부터 볼지 모르겠다면 ‘관찰 렌즈’를 써보세요."],
    },
  } satisfies Record<GuideStage, { eyebrow: string; title: string; steps: string[] }>)[stage];
  const tone = stage.startsWith("SEEKER") ? "coach-seeker" : stage.startsWith("HIDER") ? "coach-hider" : "coach-lobby";
  return (
    <aside className={`coach-card ${tone}`} aria-label="단계별 게임 도움말">
      <div><span>{guide.eyebrow}</span><button type="button" onClick={onClose} aria-label="게임 도움말 닫기">×</button></div>
      <strong>{guide.title}</strong>
      {stage === "LOBBY" && <div className="coach-role-summary"><b>숨는 팀</b><span>위치 고정 후 생존</span><b>술래</b><span>기준 배치와 차이 찾기</span></div>}
      <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <button type="button" className="coach-done" onClick={onClose}>이해했어요</button>
    </aside>
  );
}

function TouchPad({ setKey, disabled }: { setKey: (key: string, active: boolean) => void; disabled: boolean }) {
  const bind = (key: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setKey(key, true);
    },
    onPointerUp: () => setKey(key, false),
    onPointerCancel: () => setKey(key, false),
    onLostPointerCapture: () => setKey(key, false),
  });
  return (
    <div className="touch-pad" aria-label={disabled ? "현재 이동할 수 없습니다" : "화면 이동키"}>
      <button type="button" disabled={disabled} aria-label="위로 이동" {...bind("up")}><b>W</b><small>▲</small></button>
      <button type="button" disabled={disabled} aria-label="왼쪽으로 이동" {...bind("left")}><b>A</b><small>◀</small></button>
      <button type="button" disabled={disabled} aria-label="아래로 이동" {...bind("down")}><b>S</b><small>▼</small></button>
      <button type="button" disabled={disabled} aria-label="오른쪽으로 이동" {...bind("right")}><b>D</b><small>▶</small></button>
    </div>
  );
}

function ResultOverlay({ snapshot, send, connected, onCopyResult }: { snapshot: GameSnapshot; send: (type: string, payload: unknown) => void; connected: boolean; onCopyResult: () => void }) {
  const self = snapshot.players.find((player) => player.id === snapshot.self.playerId);
  const ranking = [...snapshot.players].sort((a, b) => b.score - a.score);
  const rank = self ? 1 + ranking.filter((player) => player.score > self.score).length : 0;
  const othersReady = snapshot.players.filter((player) => !player.bot && player.id !== self?.id).every((player) => player.connected && player.ready);
  return (
    <div className="game-overlay result-overlay">
      <span>{snapshot.result?.winner === "HIDERS" ? "▣ 끝까지 자연스러웠어요" : "☾ 관찰이 정확했어요"}</span>
      <strong>{snapshot.phase === "FINAL" ? `${snapshot.totalRounds}라운드 완주! 다음 눈치왕은?` : snapshot.result?.headline}</strong>
      {snapshot.phase === "FINAL" && <p className="result-my-score">내 기록 <b>{self?.score ?? 0}점</b> · 공동 순위 포함 {rank}위 / {ranking.length}명</p>}
      {snapshot.replay.length > 0 && <ol>{snapshot.replay.slice(-3).map((beat) => <li key={beat.id}>{beat.label}</li>)}</ol>}
      {snapshot.phase === "FINAL" && <div className="result-actions">
        <button className="primary-button" type="button" disabled={!connected || Boolean(self?.host && !othersReady)} onClick={() => {
          if (self?.host) { send("ready", true); send("start", true); }
          else send("ready", !self?.ready);
        }}>{self?.host ? othersReady ? "같은 방에서 한 판 더" : "친구의 재경기 준비를 기다려요" : self?.ready ? "재경기 준비 취소" : "한 판 더! 준비 완료"}</button>
        <button className="secondary-button" type="button" onClick={onCopyResult}>내 결과·초대 링크 복사</button>
        <small>{self?.host ? "지금 친구들과 같은 AI 난이도로 다시 시작해요." : self?.ready ? "준비됐어요! 모두 준비되면 방장이 시작해요." : "준비하면 같은 친구들과 다시 만나요."}</small>
      </div>}
    </div>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  return <div className={`notice-card ${notice.tone ?? "normal"}`} role="status">{notice.title && <strong>{notice.title}</strong>}<span>{notice.label}</span></div>;
}

function getDeviceId(): string {
  const key = "nunchisoom-device-id";
  const current = readClientPreference(key);
  if (current && current.length >= 8 && current.length <= 120) return current;
  const created = createClientId();
  writeClientPreference(key, created);
  return created;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
  ));
}

function nextSequence(ref: { current: number }): number {
  ref.current = ref.current >= 2_147_483_646 ? 0 : ref.current + 1;
  return ref.current;
}

function movementKey(rawKey: string): string | undefined {
  return ({
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
  } as Record<string, string>)[rawKey];
}

function movementFromKeys(keys: ReadonlySet<string>): { x: number; y: number } {
  const x = Number(keys.has("right")) - Number(keys.has("left"));
  const y = Number(keys.has("down")) - Number(keys.has("up"));
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function formatRemaining(snapshot: GameSnapshot | undefined, serverNow: number): string {
  if (!snapshot?.phaseEndsAt) return "--:--";
  const remaining = Math.max(0, snapshot.phaseEndsAt - serverNow);
  const seconds = Math.ceil(remaining / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDurationLabel(durationMs: number): string {
  const seconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0 ? `${minutes}분` : `${minutes}분 ${remaining}초`;
}

function isFinalChase(snapshot: GameSnapshot | undefined, serverNow: number): boolean {
  if (snapshot?.phase !== "SEEKING") return false;
  const remaining = snapshot.phaseEndsAt - serverNow;
  return remaining > 0 && remaining <= 15_000;
}

function phaseKicker(phase?: GamePhase): string {
  return ({ LOBBY: "참가자 준비", COUNTDOWN: "역할 안내", HIDING: "숨기·기준 배치 확인", SEEKING: "술래 수색", RESULT: "라운드 결과", FINAL: "최종 결과" } as Record<GamePhase, string>)[phase ?? "LOBBY"];
}

function phaseLabel(phase?: GamePhase): string {
  return ({ LOBBY: "대기실", COUNTDOWN: "곧 시작", HIDING: "숨기 중", SEEKING: "수색 중", RESULT: "결과 보기", FINAL: "경기 종료" } as Record<GamePhase, string>)[phase ?? "LOBBY"];
}

function roleInstruction(snapshot?: GameSnapshot): string {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return "준비가 되면 ‘준비 완료’를 눌러 주세요.";
  if (snapshot.phase === "COUNTDOWN") return snapshot.self.role === "SEEKER"
    ? "이번에는 술래예요. 먼저 가게 모습을 살펴봐요."
    : "이번에는 숨는 팀이에요. 다른 물건 옆에 쏙 숨어봐요.";
  if (snapshot.self.caught) return "들켰네요! 팀 신호로 아직 숨은 친구들을 도와주세요.";
  if (snapshot.self.role === "HIDER") return snapshot.phase === "HIDING" ? "다른 물건 옆에 숨고 ‘위치 고정’을 눌러 주세요." : snapshot.self.locked ? "가만히 숨어 있어요. 움직이려면 ‘고정 해제’를 눌러 주세요." : "움직이면 흔적이 보여요. 숨을 곳을 찾으면 위치를 고정해 주세요.";
  return snapshot.phase === "HIDING"
    ? "아직 숨는 친구들은 보이지 않아요. 가게와 포탈을 둘러봐요."
    : "아까와 다른 물건이 있나요? 가까이 다가가 눌러 보세요.";
}

function controlInstruction(snapshot?: GameSnapshot): string {
  if (snapshot?.phase === "FINAL") return "내 기록을 보고, 준비되면 한 판 더 시작해요.";
  if (snapshot?.phase === "RESULT") return "이번 라운드가 끝났어요. 곧 다음 역할을 알려드릴게요.";
  if (!snapshot || snapshot.self.role === "SPECTATOR") return "게임이 시작되면 방향키나 화면 이동키로 움직여요.";
  if (snapshot.self.caught) return "이제 움직일 수는 없지만, 팀 신호로 친구들을 도울 수 있어요.";
  if (snapshot.self.role === "HIDER") return snapshot.self.locked
    ? "위치 고정 중 · 숫자 1 또는 ‘고정 해제’로 다시 움직여요."
    : "이동: WASD / 방향키 / 화면 WASD · 숫자 1 고정 · 2 자리바꿈 · 3 여기 있었지!";
  return snapshot.phase === "HIDING"
    ? "기준 배치 확인: WASD / 방향키 · 마우스 드래그 · 휠 확대/축소"
    : "이동: WASD / 방향키 / 화면 WASD · 숫자 1 관찰 렌즈 · 가까운 사물을 클릭·터치해 확인";
}

function guideStageFor(snapshot: GameSnapshot): GuideStage | undefined {
  if (snapshot.phase === "LOBBY" || snapshot.phase === "FINAL") return "LOBBY";
  if (snapshot.self.role === "HIDER" && snapshot.phase === "HIDING") return "HIDER_HIDE";
  if (snapshot.self.role === "HIDER" && snapshot.phase === "SEEKING") return "HIDER_SURVIVE";
  if (snapshot.self.role === "SEEKER" && snapshot.phase === "HIDING") return "SEEKER_PREVIEW";
  if (snapshot.self.role === "SEEKER" && snapshot.phase === "SEEKING") return "SEEKER_SEARCH";
  return undefined;
}

function guideStorageKey(stage: GuideStage): string {
  return `nunchisoom-guide-seen-v2-${stage}`;
}

function modeLabel(mode?: RoomMode): string {
  return mode === "public" ? "공개 대기실" : "초대방";
}

function aiDifficultyDescription(difficulty: AiDifficulty): string {
  return ({
    easy: "AI가 천천히 반응해서 처음 연습하기 좋아요.",
    normal: "숨고 찾기를 골고루 즐기기 좋은 난이도예요.",
    hard: "AI가 흔적을 빨리 알아채고 오래 기억해요. 그래도 벽 너머를 볼 수는 없어요.",
  } satisfies Record<AiDifficulty, string>)[difficulty];
}

function appendChatMessage(current: LobbyChatMessage[], message: LobbyChatMessage): LobbyChatMessage[] {
  if (current.some((entry) => entry.id === message.id)) return current;
  return [...current, message].slice(-40);
}

/** 이동 좌표와 서버 버전은 제외하고, 화면 안내가 즉시 바뀌어야 할 사건만 묶는다. */
function hudSemanticKey(snapshot: GameSnapshot): string {
  const players = snapshot.players
    .map((player) => `${player.id}:${player.ready}:${player.status}:${player.score}:${player.survivalScore ?? ""}`)
    .join("|");
  return [
    snapshot.phase,
    snapshot.round,
    snapshot.self.role,
    snapshot.self.caught,
    snapshot.self.locked,
    snapshot.self.swapAvailable,
    snapshot.mission?.completed ?? false,
    snapshot.result?.winner ?? "",
    players,
  ].join(";");
}

function playerStatusLabel(status: GameSnapshot["players"][number]["status"], ready: boolean, phase: GamePhase): string {
  if (phase === "COUNTDOWN") return "역할 확인 중";
  if (status === "caught") return "발견됨 · 응원 중";
  if (status === "playing") return "게임 중";
  if (status === "waiting") return "재연결 대기";
  return ready ? "준비 완료" : "준비 중";
}

function shortRoomId(roomId: string): string {
  return roomId.slice(0, 6).toUpperCase();
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    if (/room.*(not found|does not exist)|not found.*room|4212/i.test(error.message)) return "초대받은 방을 찾지 못했어요. 코드를 다시 확인해 주세요.";
    if (/room.*full|방이 가득|4214/i.test(error.message)) return "방이 가득 찼어요. 다른 방으로 들어가거나 방장에게 AI를 줄여 달라고 해주세요.";
    if (/4215|방장이.*(재연결|다시 연결)/i.test(error.message)) return "방장이 다시 연결하는 중이에요. 조금 뒤에 다시 들어와 주세요.";
    if (/4213|이미 시작한|진행 중인 경기/i.test(error.message)) return "이미 시작한 게임이에요. 다음 판에 함께해 주세요.";
    if (/seat reservation expired|reservation.*expired/i.test(error.message)) return "입장 시간이 지났거나 방이 닫혔어요. 초대 코드를 다시 확인해 주세요.";
    if (/fetch|network|connection|socket/i.test(error.message)) return "게임에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 들어와 주세요.";
  }
  return "게임에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

/** 마지막 자리가 동시에 예약된 경우 공개 대기실 검색을 한 번만 새로 시도한다. */
async function joinPublicWaitingRoom(
  client: ColyseusSDK,
  options: { displayName: string; deviceId: string; mode: RoomMode },
): Promise<Room> {
  try {
    return await client.joinOrCreate("nunchisoom", options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/4213|4214|4215|seat reservation expired|reservation.*expired/i.test(message)) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return client.joinOrCreate("nunchisoom", options);
  }
}
