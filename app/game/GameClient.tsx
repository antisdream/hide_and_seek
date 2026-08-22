"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import { copyTextToClipboard, createClientId } from "../../shared/client-runtime";
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
const MOVE_SEND_INTERVAL_MS = 50;
const HUD_UPDATE_INTERVAL_MS = 100;

export default function GameClient() {
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GameRenderer | undefined>(undefined);
  const roomRef = useRef<Room | undefined>(undefined);
  const sequenceRef = useRef(0);
  const pressedKeysRef = useRef(new Set<string>());
  const lastSentMovementRef = useRef<Point>({ x: 0, y: 0 });
  const snapshotRef = useRef<GameSnapshot | undefined>(undefined);
  const localMovementLockedRef = useRef(false);
  const pendingLockRef = useRef<{ locked: boolean; requestedAt: number } | undefined>(undefined);
  const previousGuideStageRef = useRef<GuideStage | undefined>(undefined);
  const pendingHudSnapshotRef = useRef<GameSnapshot | undefined>(undefined);
  const hudTimerRef = useRef<number | undefined>(undefined);
  const hudPublishedAtRef = useRef(0);
  const hudSemanticKeyRef = useRef("");

  const sendMovementNow = useCallback(() => {
    const current = snapshotRef.current;
    const movementBlocked = Boolean(localMovementLockedRef.current || current?.self.caught);
    const direction = movementBlocked ? { x: 0, y: 0 } : movementFromKeys(pressedKeysRef.current);
    rendererRef.current?.setLocalMovement(direction);
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    const previous = lastSentMovementRef.current;
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
      }
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
    snapshotRef.current = nextSnapshot;
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
      setDisplayName(window.localStorage.getItem("nunchisoom-display-name") ?? "");
      const roomId = new URLSearchParams(window.location.search).get("room") ?? "";
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
        if (!activeRoom) return;
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
      renderer.setLocalMovement(localMovementLockedRef.current || current?.self.caught
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
        const seen = window.localStorage.getItem(guideStorageKey(stage)) === "1";
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
      const key = movementKey(event.key);
      if (!key) return;
      event.preventDefault();
      if (localMovementLockedRef.current) {
        setNotice({
          id: createClientId(),
          title: "위치 고정 중",
          label: "오른쪽 행동 패널에서 ‘고정 해제’를 눌러야 다시 움직일 수 있어요.",
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
      event.preventDefault();
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
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseKeys);
    document.addEventListener("visibilitychange", releaseHiddenKeys);

    const sender = window.setInterval(() => {
      sendMovementNow();
    }, MOVE_SEND_INTERVAL_MS);

    return () => {
      window.clearInterval(sender);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseKeys);
      document.removeEventListener("visibilitychange", releaseHiddenKeys);
      pressedKeys.clear();
    };
  }, [room, sendMovementNow]);

  useEffect(() => () => {
    clearHudSchedule();
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    if (activeRoom) void activeRoom.leave(true);
  }, [clearHudSchedule]);

  const connect = useCallback(async (mode: RoomMode, requestedRoomId?: string) => {
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
    setNotice({ id: createClientId(), label: "게임방에 연결하는 중입니다…" });
    window.localStorage.setItem("nunchisoom-display-name", normalizedName);
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

      joinedRoom.onMessage<GameSnapshot>("state", receiveSnapshot);
      joinedRoom.onMessage<GameEffect>("effect", (effect) => {
        rendererRef.current?.pushEffect(effect);
        setNotice({ id: effect.id, label: effect.label, tone: effect.type === "correct-tag" ? "success" : "normal" });
      });
      joinedRoom.onMessage<LensPulse>("lens", (pulse) => rendererRef.current?.pushLens(pulse));
      joinedRoom.onMessage<TeamPing>("ping", (ping) => rendererRef.current?.pushPing(ping));
      joinedRoom.onMessage<{ id: string; title: string; label: string }>("action-error", (error) => {
        setNotice({ ...error, tone: "error" });
      });
      joinedRoom.onMessage<{ label: string }>("notice", (message) => {
        setNotice({ id: createClientId(), label: message.label });
      });
      joinedRoom.onMessage<LobbyChatMessage>("chat:message", (message) => {
        setChatMessages((current) => appendChatMessage(current, message));
      });
      joinedRoom.onMessage<{ messages: LobbyChatMessage[] }>("chat:history", ({ messages }) => {
        setChatMessages(messages.slice(-40));
      });
      joinedRoom.onMessage("chat:clear", () => setChatMessages([]));
      joinedRoom.onDrop(() => setStatus("reconnecting"));
      joinedRoom.onReconnect(() => {
        setStatus("connected");
        joinedRoom.send("chat:sync", true);
        setNotice({ id: createClientId(), label: "게임방에 다시 연결되었습니다.", tone: "success" });
      });
      joinedRoom.onError((_code, message) => {
        setNotice({ id: createClientId(), title: "연결 오류", label: message || "게임 서버 연결을 확인해 주세요.", tone: "error" });
      });
      joinedRoom.onLeave(() => {
        if (roomRef.current === joinedRoom) {
          roomRef.current = undefined;
          snapshotRef.current = undefined;
          localMovementLockedRef.current = false;
          pendingLockRef.current = undefined;
          pressedKeysRef.current.clear();
          lastSentMovementRef.current = { x: 0, y: 0 };
          clearHudSchedule();
          setStatus("closed");
          setRoom(undefined);
          setSnapshot(undefined);
          setChatMessages([]);
          setChatText("");
        }
      });

      roomRef.current = joinedRoom;
      setRoom(joinedRoom);
      setStatus("connected");
      setNotice({ id: createClientId(), label: "대기실에 입장했습니다.", tone: "success" });
      sequenceRef.current = 0;
      lastSentMovementRef.current = { x: 0, y: 0 };
      joinedRoom.send("chat:sync", true);

      if (mode !== "public" && !normalizedRoomId) {
        const url = new URL(window.location.href);
        url.pathname = "/game";
        url.search = `?room=${encodeURIComponent(joinedRoom.roomId)}`;
        window.history.replaceState({}, "", url);
        setInviteRoomId(joinedRoom.roomId);
      }
    } catch (error: unknown) {
      setStatus("idle");
      setNotice({
        id: createClientId(),
        title: "입장하지 못했습니다",
        label: readableError(error),
        tone: "error",
      });
    }
  }, [clearHudSchedule, displayName, receiveSnapshot, status]);

  const disconnect = useCallback(async () => {
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    snapshotRef.current = undefined;
    localMovementLockedRef.current = false;
    pendingLockRef.current = undefined;
    rendererRef.current?.setLocalMovement({ x: 0, y: 0 });
    pressedKeysRef.current.clear();
    lastSentMovementRef.current = { x: 0, y: 0 };
    clearHudSchedule();
    if (activeRoom) await activeRoom.leave(true);
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
    if (!activeRoom) return;
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
        }
      }
      // WebSocket 순서를 이용해 서버가 정지 좌표를 먼저 확정한 다음 그 자리에서 고정한다.
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
      ? { id: createClientId(), label: "초대 링크를 복사했습니다.", tone: "success" }
      : { id: createClientId(), label: `초대 링크를 직접 복사하세요: ${inviteUrl}`, tone: "normal" });
  }, [room]);

  const setTouchKey = useCallback((key: string, active: boolean) => {
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
    if (stage) window.localStorage.setItem(guideStorageKey(stage), "1");
    setCoachOpen(false);
  };

  if (!room) {
    return (
      <main className="join-page">
        <header className="game-topbar">
          <Link className="brand" href="/" prefetch={false} aria-label="눈치숨 홈">
            <span className="brand-mark" aria-hidden="true">눈</span><span>눈치숨</span>
          </Link>
          <a className="text-link" href="/how-to-play">게임 방법</a>
        </header>

        <section className="join-layout">
          <div className="join-intro">
            <p className="eyebrow">소리가 없어도 단서는 선명하게</p>
            <h1>오늘 밤,<br /><em>잡화점의 눈치왕</em>은 누구?</h1>
            <p>설치 없이 별명만 정하면 대기실에 입장할 수 있습니다. 빠른 매칭은 자리가 있는 공개 대기실로 연결되고, 방을 만들면 친구를 초대하거나 AI 참가자를 추가할 수 있습니다.</p>
            <div className="join-quick-guide">
              <strong>처음이라면 이것만 기억하세요</strong>
              <ol>
                <li>역할 안내에서 내가 숨는 팀인지 술래인지 확인합니다.</li>
                <li>숨는 팀은 자리를 정한 뒤 위치를 고정하고, 술래는 기준 배치를 살펴봅니다.</li>
                <li>문과 포탈은 연결된 다른 구역으로 바로 이동합니다.</li>
              </ol>
              <a href="/how-to-play">실제 게임 화면으로 차근차근 배우기</a>
            </div>
            <CharacterParade />
          </div>

          <div className="join-card">
            <div className="join-step"><span>1</span><div><strong>별명을 정해요</strong><small>개인정보 대신 경기에서 부를 이름만 사용합니다.</small></div></div>
            <label className="field-label" htmlFor="display-name">별명</label>
            <input
              id="display-name"
              className="text-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={12}
              placeholder="예: 눈치빠른콩"
              autoComplete="nickname"
            />

            {inviteRoomId ? (
              <div className="invite-found">
                <div><span>초대장 도착</span><strong>{inviteRoomId}</strong></div>
                <button className="primary-button wide" type="button" disabled={status === "connecting"} onClick={() => void connect("invite", inviteRoomId)}>
                  초대받은 방 입장
                </button>
              </div>
            ) : (
              <div className="mode-grid unified-modes" aria-label="게임 방식 선택">
                <button className="quick-match-card" type="button" disabled={status === "connecting"} onClick={() => void connect("public")}>
                  <span aria-hidden="true">✦</span><strong>빠른 매칭</strong><small>자리가 있는 공개 대기실에 자동 참가</small>
                </button>
                <section className="create-room-card" aria-labelledby="create-room-title">
                  <div className="create-room-heading">
                    <span aria-hidden="true">◎</span>
                    <div><strong id="create-room-title">방 만들기</strong><small>친구를 초대하고 AI는 대기실에서 추가할 수 있어요.</small></div>
                  </div>
                  <button className="create-room-button" type="button" disabled={status === "connecting"} onClick={() => void connect("invite")}>
                    새 초대방 만들기
                  </button>
                  <p className="create-room-note">대기실에서 방장이 AI 인원과 난이도를 정할 수 있으며, 사람과 AI를 합해 최대 10명까지 참여할 수 있습니다.</p>
                </section>
              </div>
            )}
            {!inviteRoomId && (
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
            <p className="join-safety">회원가입·설치 불필요 · 음성 대화 없이 플레이 가능</p>
            {notice && <NoticeCard notice={notice} />}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="play-page">
      <header className="play-header">
        <Link className="brand compact" href="/" prefetch={false} aria-label="눈치숨 홈">
          <span className="brand-mark" aria-hidden="true">눈</span><span>눈치숨</span>
        </Link>
        <div className={finalChase ? "phase-summary urgent" : "phase-summary"} aria-live="polite">
          <span className={`phase-icon phase-${snapshot?.phase.toLowerCase() ?? "lobby"}`} aria-hidden="true" />
          <div><small>{finalChase ? "막판 위험 경보" : phaseKicker(snapshot?.phase)}</small><strong>{finalChase ? "마지막 추격" : phaseLabel(snapshot?.phase)}</strong></div>
          <time>{formatRemaining(snapshot, serverNow)}</time>
        </div>
        <div className="room-tools">
          <button type="button" onClick={() => setCoachOpen(true)} disabled={!snapshot}>
            단계별 도움말
          </button>
          <button type="button" onClick={() => void copyInvite()} title="초대 링크 복사">
            초대 코드 {shortRoomId(room.roomId)} <span>링크 복사</span>
          </button>
          <button type="button" className="leave-button" onClick={() => void disconnect()}>나가기</button>
        </div>
      </header>

      <section className="play-grid">
        <aside className="players-panel" aria-label="참가자 목록">
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
        </aside>

        <section className="game-column" aria-label="게임 화면">
          <div className={finalChase ? "canvas-frame final-chase" : "canvas-frame"}>
            <div ref={canvasRef} className="phaser-host" />
            {snapshot && (
              <div className="map-ribbon">
                <span>{snapshot.round || 1}R</span><strong>{snapshot.map.name || "밤의 문구점"}</strong>
              </div>
            )}
            {status === "reconnecting" && <div className="game-overlay"><strong>다시 연결하는 중…</strong><span>10초 동안 참가 상태를 유지합니다.</span></div>}
            {snapshot?.phase === "COUNTDOWN" && <RoleRevealOverlay snapshot={snapshot} serverNow={serverNow} />}
            {snapshot?.seekerPreview && (
              <div className="preview-ribbon">
                <span aria-hidden="true">☾</span>
                <div><strong>기준 배치 확인 중</strong><small>마우스 드래그 이동 · 휠 확대/축소 · 숨는 팀은 보이지 않아요</small></div>
              </div>
            )}
            {finalChase && <div className="final-chase-ribbon"><span aria-hidden="true">!</span><strong>수색 종료 15초 전</strong><small>남은 숨는 팀을 찾아보세요</small></div>}
            {snapshot?.result && <ResultOverlay snapshot={snapshot} />}
            {snapshot?.self.caught && snapshot.phase === "SEEKING" && <div className="caught-ribbon">발견됐어요 · 팀 신호로 동료를 도와주세요</div>}
            {coachOpen && snapshot && guideStageFor(snapshot) && (
              <StageHelpCoach snapshot={snapshot} onClose={dismissCoach} />
            )}
          </div>
          <div className="visual-feed">
            <span className={`connection-dot ${status}`} aria-hidden="true" />
            <div className="current-task"><small>지금 할 일</small><p>{roleInstruction(snapshot)}</p></div>
            {notice && <div className={`event-alert ${notice.tone ?? "normal"}`} role="status" aria-live="polite"><small>{notice.title ?? "최근 알림"}</small><p>{notice.label}</p></div>}
          </div>
        </section>

        <aside className="action-panel" aria-label="행동 패널">
          <RoleCard snapshot={snapshot} />
          <RoleStatusCard snapshot={snapshot} />
          <ActionButtons snapshot={snapshot} send={send} />
          <TeamPings role={snapshot?.self.role} send={send} />
          <TouchPad setKey={setTouchKey} disabled={Boolean(snapshot?.self.locked || snapshot?.self.caught)} />
          <p className="keyboard-help">{controlInstruction(snapshot)}</p>
        </aside>
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
      <p>{activePlayerCount < snapshot.minPlayers ? `게임 시작까지 ${snapshot.minPlayers - activePlayerCount}명 더 필요합니다.` : "모두 준비하면 방장이 게임을 시작할 수 있습니다."}</p>
      {isHost ? (
        <div className="bot-manager" aria-label="AI 참가자 관리">
          <strong>AI 참가자 추가</strong>
          <small>난이도를 골라 한 명씩 추가하세요. 사람과 AI를 합해 최대 10명입니다.</small>
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
      <div><small>내 역할 · 현재 목표</small><strong>{role === "HIDER" ? "숨는 팀 · 틈새정령" : role === "SEEKER" ? "술래 · 밤지기" : "역할 배정 대기"}</strong></div>
      <p>{roleInstruction(snapshot)}</p>
      {role === "SEEKER" && <em>이동 우위 · 숨는 팀보다 약 46% 빠름</em>}
      {role === "HIDER" && <em>{snapshot?.self.locked ? "◆ 위치 고정 중 · 이동키 작동 안 함" : "이동하면 짧은 파문이 남아요"}</em>}
    </div>
  );
}

function RoleStatusCard({ snapshot }: { snapshot?: GameSnapshot }) {
  if (!snapshot || snapshot.self.role === "SPECTATOR") {
    return <div className="state-card waiting"><span>현재 상태</span><strong>역할 배정 대기</strong><p>준비 완료 후 역할표에서 목표를 확인하세요.</p></div>;
  }
  if (snapshot.self.role === "HIDER") {
    const caught = snapshot.self.caught;
    const locked = snapshot.self.locked;
    return (
      <div className={`state-card hider-state ${caught ? "caught" : locked ? "locked" : "mobile"}`}>
        <span>현재 은신 상태</span>
        <strong>{caught ? "발견됨 · 팀 지원" : locked ? "위치 고정 · 이동 불가" : "이동 가능 · 파문 주의"}</strong>
        <p>{caught ? "팀 신호로 남은 동료를 도와주세요." : locked ? "다시 움직이려면 먼저 고정 해제를 누르세요." : "움직이는 동안 짧은 파문이 남습니다."}</p>
      </div>
    );
  }
  return (
    <div className="focus-card">
      <div><span>확인 집중력</span><strong>{snapshot.self.focus}</strong></div>
      <progress max={100} value={snapshot.self.focus}>{snapshot.self.focus}</progress>
      <p>오답이면 집중력이 줄고 잠시 확인할 수 없습니다.</p>
    </div>
  );
}

function ActionButtons({ snapshot, send }: { snapshot?: GameSnapshot; send: (type: string, payload: unknown) => void }) {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return <div className="action-empty">경기가 시작되면 역할 행동이 열려요.</div>;
  if (snapshot.phase === "COUNTDOWN") return <div className="action-empty">역할 목표를 확인하세요. 숨기·기준 배치 확인이 시작되면 행동이 열립니다.</div>;
  if (snapshot.phase === "RESULT" || snapshot.phase === "FINAL") return <div className="action-empty">라운드가 끝났습니다. 점수와 주요 장면을 확인하세요.</div>;
  if (snapshot.self.caught) return <div className="action-empty">발견됐지만 끝이 아니에요. 아래 팀 신호로 동료를 도와주세요.</div>;
  if (snapshot.self.role === "HIDER") {
    return (
      <div className="action-buttons">
        <div className="action-item">
          <button type="button" aria-pressed={snapshot.self.locked} onClick={() => send("lock", !snapshot.self.locked)}><span>◆</span><strong>{snapshot.self.locked ? "고정 해제" : "위치 고정"}</strong><small>{snapshot.self.locked ? "해제해야 다시 움직일 수 있어요" : "이동키를 눌러도 움직이지 않아요"}</small></button>
          <HelpTooltip label="위치 고정" copy="현재 위치에서 완전히 멈춰 움직임 파문을 숨깁니다. 고정 중에는 이동키가 작동하지 않으며, 다시 움직이려면 반드시 고정 해제를 누르세요. 미션 구역에서는 2초 동안 고정하면 됩니다." />
        </div>
        <div className="action-item">
          <button type="button" disabled={!snapshot.self.swapAvailable} onClick={() => send("swap", true)}><span>⇄</span><strong>{snapshot.self.swapAvailable ? "무작위 자리바꿈" : "자리바꿈 사용 완료"}</strong><small>{snapshot.self.swapAvailable ? "맵 전체 같은 사물 중 한 곳 · 1회" : "다음 라운드에 다시 사용할 수 있어요"}</small></button>
          <HelpTooltip label="무작위 자리바꿈" copy="거리와 관계없이 맵 전체의 같은 종류 사물 중 한 곳과 무작위로 자리를 바꿉니다. 라운드당 한 번만 사용할 수 있으니 발각 직전이나 기준 기억을 흔들 때 사용하세요." />
        </div>
        {snapshot.mission && <div className="mission-card action-with-help"><span>진열 미션</span><strong>{snapshot.mission.label}</strong><progress max={1} value={snapshot.mission.progress}>{Math.round(snapshot.mission.progress * 100)}%</progress><HelpTooltip label="진열 미션" copy="표시된 구역 안에서 위치 고정을 2초 유지하면 25점을 받습니다. 생존보다 위험하다고 판단되면 포기해도 됩니다." /></div>}
      </div>
    );
  }
  if (snapshot.seekerPreview) {
    return (
      <div className="action-empty preview-actions">
        <strong>기준 배치 확인 시간</strong><br />전체 맵에서 마우스를 끌어 이동하고 휠로 확대하세요. WASD·방향키로 포탈 도착점도 직접 확인할 수 있어요.
      </div>
    );
  }
  const lensSeconds = Math.max(0, Math.ceil((snapshot.self.lensReadyAt - snapshot.serverTime) / 1_000));
  const tagSeconds = Math.max(0, Math.ceil((snapshot.self.tagReadyAt - snapshot.serverTime) / 100) / 10);
  return (
    <div className="action-buttons">
      <div className="action-item">
        <button type="button" disabled={lensSeconds > 0} onClick={() => send("lens", true)}><span>⌾</span><strong>관찰 렌즈</strong><small>{lensSeconds > 0 ? `${lensSeconds}초 뒤 충전` : "최근 움직임을 구역으로 표시"}</small></button>
        <HelpTooltip label="관찰 렌즈" copy="최근 2초 안에 틈새정령이 움직인 넓은 구역만 1.8초간 표시합니다. 정확한 사물은 알려주지 않으며 재사용 대기는 30초입니다." />
      </div>
      <div className="action-item tag-action">
        <div className={tagSeconds > 0 ? "tag-tip cooling" : "tag-tip"}><span aria-hidden="true">☝</span><p><strong>확인 스티커</strong><br />{tagSeconds > 0 ? `${tagSeconds.toFixed(1)}초 뒤 다시 확인` : "가까운 사물을 직접 클릭하세요."}</p></div>
        <HelpTooltip label="확인 스티커" copy="2.6칸 안에서 선반에 가리지 않은 사물만 확인할 수 있습니다. 오답은 집중력 25와 3초 대기, 집중력 소진은 6.5초 대기가 적용됩니다." />
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
      <div className="ping-heading"><span>팀 신호</span><HelpTooltip label="팀 신호" copy="내 현재 위치에 같은 역할만 볼 수 있는 표시를 남깁니다. 음성 대화 없이 의심 구역과 위험을 빠르게 공유하세요." /></div>
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
    ? ["숨는 장면 대신 기준 배치를 기억하세요.", "드래그·휠과 이동키로 포탈 도착점까지 확인하세요.", "수색이 열리면 가까운 수상한 사물을 클릭하세요."]
    : ["주변과 자연스럽게 어울리는 자리를 찾으세요.", "자리를 정하면 ‘위치 고정’을 눌러 완전히 멈추세요.", "무작위 자리바꿈과 포탈은 발각 직전 탈출에 활용하세요."];
  return (
    <div className={`game-overlay role-reveal-overlay ${seeker ? "reveal-seeker" : "reveal-hider"}`} role="dialog" aria-label={`${teamName} ${roleName} 역할 안내`}>
      <span className="role-reveal-symbol" aria-hidden="true">{seeker ? "☾" : "▣"}</span>
      <p className="role-reveal-kicker">{snapshot.round}라운드 역할 확정</p>
      <strong>당신은 이번 라운드 <em>{teamName}</em>입니다</strong>
      <p className="role-reveal-alias">눈치숨 역할 이름 · {roleName}</p>
      <p className="role-reveal-goal">{seeker ? "제한시간 안에 모든 틈새정령을 찾아내세요." : "평범한 사물처럼 숨어 수색 종료까지 살아남으세요."}</p>
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
      title: "대기실에서 이렇게 준비하세요",
      steps: ["방장은 AI와 참가 인원을 정하고, 각자 준비 완료를 누릅니다.", "모두 준비되면 방장이 게임 시작을 누릅니다.", "역할 안내에서 숨는 팀인지 술래인지 확인합니다."],
    },
    HIDER_HIDE: {
      eyebrow: "숨는 팀 · 1단계",
      title: "먼저 자연스러운 자리를 찾으세요",
      steps: ["진열된 같은 종류 사물 무리 옆으로 이동합니다.", "자리를 정하면 위치 고정을 눌러 완전히 멈춥니다.", "여유가 있으면 표시된 미션 구역에서 2초간 고정합니다."],
    },
    HIDER_SURVIVE: {
      eyebrow: "숨는 팀 · 2단계",
      title: "고정을 유지하고 탈출 시점을 고르세요",
      steps: ["고정 중에는 이동키가 작동하지 않으므로 움직이기 전에 고정을 해제합니다.", "발각 직전에는 맵 전체 같은 사물로 무작위 자리바꿈을 사용합니다.", "발견된 뒤에도 팀 신호로 남은 동료를 도울 수 있습니다."],
    },
    SEEKER_PREVIEW: {
      eyebrow: "술래 · 1단계",
      title: "먼저 기준 배치를 살펴보세요",
      steps: ["숨는 팀은 보이지 않으니 기준 사물 수와 빈 공간을 확인합니다.", "마우스로 맵을 끌고 휠로 확대합니다.", "WASD로 포탈을 통과해 연결 구역과 도착점을 확인합니다."],
    },
    SEEKER_SEARCH: {
      eyebrow: "술래 · 2단계",
      title: "이제 기준 배치와 다른 점을 찾으세요",
      steps: ["기억한 배치와 다른 사물을 찾습니다.", "2.6칸 안까지 다가간 뒤 수상한 사물을 클릭합니다.", "막히면 관찰 렌즈로 최근 움직임 구역을 좁힙니다."],
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
    onPointerDown: () => setKey(key, true),
    onPointerUp: () => setKey(key, false),
    onPointerLeave: () => setKey(key, false),
    onPointerCancel: () => setKey(key, false),
  });
  return (
    <div className="touch-pad" aria-label={disabled ? "현재 이동할 수 없습니다" : "화면 이동키"}>
      <button type="button" disabled={disabled} aria-label="위로 이동" {...bind("up")}>▲</button>
      <button type="button" disabled={disabled} aria-label="왼쪽으로 이동" {...bind("left")}>◀</button>
      <button type="button" disabled={disabled} aria-label="아래로 이동" {...bind("down")}>▼</button>
      <button type="button" disabled={disabled} aria-label="오른쪽으로 이동" {...bind("right")}>▶</button>
    </div>
  );
}

function ResultOverlay({ snapshot }: { snapshot: GameSnapshot }) {
  return (
    <div className="game-overlay result-overlay">
      <span>{snapshot.result?.winner === "HIDERS" ? "▣ 끝까지 자연스러웠어요" : "☾ 관찰이 정확했어요"}</span>
      <strong>{snapshot.result?.headline}</strong>
      <ol>{snapshot.replay.slice(-3).map((beat) => <li key={beat.id}>{beat.label}</li>)}</ol>
    </div>
  );
}

function CharacterParade() {
  return (
    <div className="character-parade" aria-label="눈치숨의 오리지널 캐릭터">
      <span className="parade-prop pencil"><i /><i /><b /></span>
      <span className="parade-prop tape"><i /><i /><b /></span>
      <span className="parade-seeker"><i /><i /><b /></span>
      <span className="parade-prop notebook"><i /><i /><b /></span>
      <p>틈새정령과 밤지기 <strong>모루</strong></p>
    </div>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  return <div className={`notice-card ${notice.tone ?? "normal"}`} role="status">{notice.title && <strong>{notice.title}</strong>}<span>{notice.label}</span></div>;
}

function getDeviceId(): string {
  const key = "nunchisoom-device-id";
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const created = createClientId();
  window.localStorage.setItem(key, created);
  return created;
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
  if (!snapshot || snapshot.self.role === "SPECTATOR") return "준비를 마친 뒤 역할 안내를 기다리세요.";
  if (snapshot.phase === "COUNTDOWN") return snapshot.self.role === "SEEKER"
    ? "이번 라운드 술래입니다. 숨는 장면은 보이지 않으니 기준 배치부터 살펴보세요."
    : "이번 라운드 숨는 팀입니다. 자연스러운 자리를 찾고 위치를 고정하세요.";
  if (snapshot.self.caught) return "발견됐지만 끝이 아니에요. 팀 신호로 동료를 도와주세요.";
  if (snapshot.self.role === "HIDER") return snapshot.phase === "HIDING" ? "사물 무리 사이에 자리를 잡고 위치 고정을 누르세요." : snapshot.self.locked ? "위치 고정을 유지하고, 움직이려면 먼저 고정을 해제하세요." : "이동하면 파문이 남습니다. 자리를 정했으면 다시 위치를 고정하세요.";
  return snapshot.phase === "HIDING"
    ? "숨는 팀은 보이지 않습니다. 기준 사물과 포탈을 직접 둘러보세요."
    : "기억한 기준 배치와 비교하고, 가까이 다가가 수상한 사물을 클릭하세요.";
}

function controlInstruction(snapshot?: GameSnapshot): string {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return "이동: WASD / 방향키 · 역할 배정 뒤 전용 행동이 열립니다.";
  if (snapshot.self.caught) return "발견된 뒤에는 이동할 수 없지만 팀 신호를 보낼 수 있습니다.";
  if (snapshot.self.role === "HIDER") return snapshot.self.locked
    ? "위치 고정 중 · 다시 움직이려면 먼저 고정 해제를 누르세요."
    : "이동: WASD / 방향키 · 자리를 정한 뒤 위치 고정을 누르세요.";
  return snapshot.phase === "HIDING"
    ? "기준 배치 확인: WASD / 방향키 · 마우스 드래그 · 휠 확대/축소"
    : "이동: WASD / 방향키 · 가까운 수상한 사물을 클릭해 확인";
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
    easy: "반응이 느리고 움직임 단서를 자주 놓쳐 처음 연습하기 좋습니다.",
    normal: "찾기와 숨기 판단, 실수 확률을 균형 있게 조정한 기본 난이도입니다.",
    hard: "단서를 오래 기억하고 적극적으로 추적하거나 도망칩니다. 벽 너머 정답은 알지 못합니다.",
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
    if (/room.*(not found|does not exist)|not found.*room|4212/i.test(error.message)) return "초대 코드에 해당하는 방을 찾지 못했습니다. 코드를 다시 확인해 주세요.";
    if (/room.*full|방이 가득|4214/i.test(error.message)) return "방이 가득 찼습니다. 다른 방을 이용하거나 방장에게 AI 참가자를 줄여 달라고 알려주세요.";
    if (/4215|방장이 재연결/i.test(error.message)) return "방장이 다시 연결하는 중입니다. 잠시 뒤 빠른 매칭을 다시 시도해 주세요.";
    if (/seat reservation expired|reservation.*expired/i.test(error.message)) return "입장 시간이 지났거나 방이 닫혔습니다. 초대 코드를 다시 확인해 주세요.";
    if (/fetch|network|connection|socket/i.test(error.message)) return "게임 서버가 실행 중인지 확인해 주세요.";
    return error.message;
  }
  return "잠시 후 다시 시도해 주세요.";
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
