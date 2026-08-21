"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import type {
  AiDifficulty,
  GameEffect,
  GamePhase,
  GameSnapshot,
  PingKind,
  RoomMode,
  TeamPing,
} from "../../shared/game-types";
import { aiDifficultyLabel, isAiDifficulty } from "../../shared/ai-rules";
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

const CONFIGURED_GAME_ENDPOINT = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
const MOVE_SEND_INTERVAL_MS = 100;
const HUD_UPDATE_INTERVAL_MS = 100;

export default function GameClient() {
  const [displayName, setDisplayName] = useState("");
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>("normal");
  const [inviteRoomId, setInviteRoomId] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
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
  const snapshotRef = useRef<GameSnapshot | undefined>(undefined);
  const previousPhaseRef = useRef<GamePhase | undefined>(undefined);
  const pendingHudSnapshotRef = useRef<GameSnapshot | undefined>(undefined);
  const hudTimerRef = useRef<number | undefined>(undefined);
  const hudPublishedAtRef = useRef(0);
  const hudSemanticKeyRef = useRef("");

  const sendMovementNow = useCallback(() => {
    const direction = movementFromKeys(pressedKeysRef.current);
    rendererRef.current?.setLocalMovement(direction);
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    activeRoom.send("move", { seq: nextSequence(sequenceRef), ...direction });
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
      const storedDifficulty = window.localStorage.getItem("nunchisoom-ai-difficulty");
      if (isAiDifficulty(storedDifficulty)) setAiDifficulty(storedDifficulty);
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
      renderer.setLocalMovement(movementFromKeys(pressedKeysRef.current));
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
        previousPhaseRef.current = undefined;
        setCoachOpen(false);
        return;
      }
      const role = snapshot.self.role;
      const enteredHiding = previousPhaseRef.current !== "HIDING" && snapshot.phase === "HIDING";
      if (enteredHiding && (role === "HIDER" || role === "SEEKER")) {
        const seen = window.localStorage.getItem(`nunchisoom-guide-seen-${role}`) === "1";
        if (!seen) setCoachOpen(true);
      }
      if (snapshot.phase === "LOBBY" || snapshot.phase === "FINAL") setCoachOpen(false);
      previousPhaseRef.current = snapshot.phase;
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
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseKeys);

    const sender = window.setInterval(() => {
      sendMovementNow();
    }, MOVE_SEND_INTERVAL_MS);

    return () => {
      window.clearInterval(sender);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseKeys);
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
    setNotice({ id: createClientId(), label: "잡화점 문을 여는 중입니다…" });
    window.localStorage.setItem("nunchisoom-display-name", normalizedName);
    try {
      const gameEndpoint = resolveGameServerEndpoint(window.location.href, CONFIGURED_GAME_ENDPOINT);
      const client = new ColyseusSDK(gameEndpoint);
      const options = {
        displayName: normalizedName,
        deviceId: getDeviceId(),
        mode,
        ...(mode === "practice" ? { aiDifficulty } : {}),
      };
      const joinedRoom = normalizedRoomId
        ? await client.joinById(normalizedRoomId, options)
        : mode === "public"
          ? await client.joinOrCreate("nunchisoom", options)
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
      joinedRoom.onDrop(() => setStatus("reconnecting"));
      joinedRoom.onReconnect(() => {
        setStatus("connected");
        setNotice({ id: createClientId(), label: "게임방에 다시 연결했습니다.", tone: "success" });
      });
      joinedRoom.onError((_code, message) => {
        setNotice({ id: createClientId(), title: "연결 오류", label: message || "게임 서버 연결을 확인해 주세요.", tone: "error" });
      });
      joinedRoom.onLeave(() => {
        if (roomRef.current === joinedRoom) {
          roomRef.current = undefined;
          snapshotRef.current = undefined;
          clearHudSchedule();
          setStatus("closed");
          setRoom(undefined);
          setSnapshot(undefined);
        }
      });

      roomRef.current = joinedRoom;
      setRoom(joinedRoom);
      setStatus("connected");
      setNotice({ id: createClientId(), label: "잡화점에 입장했습니다.", tone: "success" });
      sequenceRef.current = 0;

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
  }, [aiDifficulty, clearHudSchedule, displayName, receiveSnapshot, status]);

  const disconnect = useCallback(async () => {
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    snapshotRef.current = undefined;
    rendererRef.current?.setLocalMovement({ x: 0, y: 0 });
    clearHudSchedule();
    if (activeRoom) await activeRoom.leave(true);
    setRoom(undefined);
    setSnapshot(undefined);
    setStatus("idle");
    setInviteRoomId("");
    setInviteCodeInput("");
    window.history.replaceState({}, "", "/game");
  }, [clearHudSchedule]);

  const send = useCallback((type: string, payload: unknown) => {
    roomRef.current?.send(type, payload);
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
  const dismissCoach = () => {
    const role = snapshot?.self.role;
    if (role === "HIDER" || role === "SEEKER") {
      window.localStorage.setItem(`nunchisoom-guide-seen-${role}`, "1");
    }
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
            <p>설치 없이 별명만 정하면 바로 시작합니다. 공개방은 무작위 친구와, 초대방은 링크를 받은 지인과 만나요.</p>
            <div className="join-quick-guide">
              <strong>처음이라면 이것만 기억하세요</strong>
              <ol>
                <li>역할표에서 내가 숨는 팀인지 찾는 팀인지 확인합니다.</li>
                <li>틈새정령은 사물처럼 멈추고, 관찰자는 숨기 전 기준 배치를 기억합니다.</li>
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
              <div className="mode-grid" aria-label="게임 방식 선택">
                <button type="button" disabled={status === "connecting"} onClick={() => void connect("public")}>
                  <span aria-hidden="true">✦</span><strong>빠른 매칭</strong><small>4~10명 공개방</small>
                </button>
                <button type="button" disabled={status === "connecting"} onClick={() => void connect("invite")}>
                  <span aria-hidden="true">⌁</span><strong>친구방 만들기</strong><small>링크로 지인 초대</small>
                </button>
                <button type="button" disabled={status === "connecting"} onClick={() => void connect("practice")}>
                  <span aria-hidden="true">◎</span><strong>AI 방 만들기</strong><small>부족한 자리는 AI가 참여</small>
                </button>
              </div>
            )}
            {!inviteRoomId && (
              <fieldset className="ai-difficulty-picker">
                <legend><strong>AI 난이도</strong><small>AI 방을 만들 때 적용됩니다.</small></legend>
                <div>
                  {(["easy", "normal", "hard"] as const).map((difficulty) => (
                    <button
                      key={difficulty}
                      type="button"
                      className={aiDifficulty === difficulty ? "active" : ""}
                      aria-pressed={aiDifficulty === difficulty}
                      disabled={status === "connecting"}
                      onClick={() => {
                        setAiDifficulty(difficulty);
                        window.localStorage.setItem("nunchisoom-ai-difficulty", difficulty);
                      }}
                    >
                      {aiDifficultyLabel(difficulty)}
                    </button>
                  ))}
                </div>
                <p>{aiDifficultyDescription(aiDifficulty)}</p>
              </fieldset>
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
            <p className="join-safety">회원가입·음성채팅 없이 플레이 · 능력치 판매 없음</p>
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
          <div><small>{finalChase ? "무음 위험 경보" : phaseKicker(snapshot?.phase)}</small><strong>{finalChase ? "마지막 추격" : phaseLabel(snapshot?.phase)}</strong></div>
          <time>{formatRemaining(snapshot, serverNow)}</time>
        </div>
        <div className="room-tools">
          <button type="button" onClick={() => setCoachOpen(true)} disabled={!snapshot || snapshot.self.role === "SPECTATOR"}>
            역할 도움말
          </button>
          <button type="button" onClick={() => void copyInvite()} title="초대 링크 복사">
            방 {shortRoomId(room.roomId)} <span>복사</span>
          </button>
          <button type="button" className="leave-button" onClick={() => void disconnect()}>나가기</button>
        </div>
      </header>

      <section className="play-grid">
        <aside className="players-panel" aria-label="참가자 목록">
          <div className="panel-heading"><div><small>{modeLabel(snapshot?.mode, snapshot?.aiDifficulty)}</small><h2>함께 있는 친구</h2></div><strong>{snapshot?.players.length ?? 0}/{snapshot?.maxPlayers ?? 10}</strong></div>
          <div className="player-list">
            {snapshot?.players.map((player) => (
              <article className={`player-row avatar-${player.avatar}`} key={player.id}>
                <span className="avatar-face" aria-hidden="true"><i /><i /><b /></span>
                <div>
                  <strong>{player.displayName}{player.bot ? ` · AI ${aiDifficultyLabel(snapshot.aiDifficulty ?? "normal")}` : ""}</strong>
                  <small>{player.host ? "방장 · " : ""}{playerStatusLabel(player.status, player.ready, snapshot.phase)}{player.survivalScore !== undefined ? ` · 생존 +${player.survivalScore}` : ""}</small>
                </div>
                <b>{player.score}</b>
              </article>
            ))}
          </div>
          {snapshot && (snapshot.phase === "LOBBY" || snapshot.phase === "FINAL") && (
            <LobbyControls snapshot={snapshot} send={send} />
          )}
          <div className="silent-note"><span aria-hidden="true">◫</span><p><strong>무음 완전 지원</strong><br />색·모양·문구가 모든 소리 신호를 대신합니다.</p></div>
        </aside>

        <section className="game-column" aria-label="게임 화면">
          <div className={finalChase ? "canvas-frame final-chase" : "canvas-frame"}>
            <div ref={canvasRef} className="phaser-host" />
            {snapshot && (
              <div className="map-ribbon">
                <span>{snapshot.round || 1}R</span><strong>{snapshot.map.name || "밤의 문구점"}</strong>
              </div>
            )}
            {status === "reconnecting" && <div className="game-overlay"><strong>다시 연결하는 중…</strong><span>10초 동안 자리를 지켜드려요.</span></div>}
            {snapshot?.phase === "COUNTDOWN" && <RoleRevealOverlay snapshot={snapshot} serverNow={serverNow} />}
            {snapshot?.seekerPreview && (
              <div className="preview-ribbon">
                <span aria-hidden="true">☾</span>
                <div><strong>기준 맵 탐색 중</strong><small>마우스 드래그 이동 · 휠 확대/축소 · 숨는 이용자는 보이지 않아요</small></div>
              </div>
            )}
            {finalChase && <div className="final-chase-ribbon"><span aria-hidden="true">!</span><strong>마지막 15초</strong><small>시간이 끝나기 전에 남은 틈새정령을 찾으세요</small></div>}
            {snapshot?.result && <ResultOverlay snapshot={snapshot} />}
            {snapshot?.self.caught && snapshot.phase === "SEEKING" && <div className="caught-ribbon">발견됐어요 · 팀 핑으로 계속 도울 수 있어요</div>}
            {coachOpen && snapshot && (snapshot.phase === "HIDING" || snapshot.phase === "SEEKING") && (
              <FirstPlayCoach snapshot={snapshot} onClose={dismissCoach} />
            )}
          </div>
          <div className="visual-feed" aria-live="polite">
            <span className={`connection-dot ${status}`} aria-hidden="true" />
            <p>{notice?.label ?? roleInstruction(snapshot)}</p>
            {notice?.title && <strong>{notice.title}</strong>}
          </div>
        </section>

        <aside className="action-panel" aria-label="행동 패널">
          <RoleCard snapshot={snapshot} />
          <div className="focus-card">
            <div><span>{snapshot?.self.role === "SEEKER" ? "집중력" : "은신 안정도"}</span><strong>{snapshot?.self.focus ?? 100}</strong></div>
            <progress max={100} value={snapshot?.self.focus ?? 100}>{snapshot?.self.focus ?? 100}</progress>
          </div>
          <ActionButtons snapshot={snapshot} send={send} />
          <TeamPings role={snapshot?.self.role} send={send} />
          <TouchPad setKey={setTouchKey} />
          <p className="keyboard-help">이동: WASD / 방향키 · 사물을 클릭해 확인</p>
        </aside>
      </section>
    </main>
  );
}

function LobbyControls({ snapshot, send }: { snapshot: GameSnapshot; send: (type: string, payload: unknown) => void }) {
  const self = snapshot.players.find((player) => player.id === snapshot.self.playerId);
  const isHost = Boolean(self?.host);
  return (
    <div className="lobby-controls">
      <p>{snapshot.players.length < snapshot.minPlayers ? `${snapshot.minPlayers - snapshot.players.length}명 더 오면 시작할 수 있어요.` : "모두 준비하면 자동으로 시작해요."}</p>
      <button className={self?.ready ? "ready-button active" : "ready-button"} type="button" onClick={() => send("ready", !self?.ready)}>
        {self?.ready ? "준비 취소" : "준비 완료"}
      </button>
      {isHost && <button className="host-start" type="button" disabled={!snapshot.canStart} onClick={() => send("start", true)}>방장 시작</button>}
    </div>
  );
}

function RoleCard({ snapshot }: { snapshot?: GameSnapshot }) {
  const role = snapshot?.self.role ?? "SPECTATOR";
  return (
    <div className={`role-card role-${role.toLowerCase()}`}>
      <span aria-hidden="true">{role === "HIDER" ? "▣" : role === "SEEKER" ? "☾" : "⌛"}</span>
      <div><small>내 역할 · 현재 목표</small><strong>{role === "HIDER" ? "틈새정령" : role === "SEEKER" ? "밤지기 관찰자" : "대기 중"}</strong></div>
      <p>{roleInstruction(snapshot)}</p>
      {role === "SEEKER" && <em>이동 우위 · 틈새정령보다 약 46% 빠름</em>}
      {role === "HIDER" && <em>{snapshot?.self.locked ? "◆ 지금은 사물 고정 상태" : "이동하면 짧은 파문이 남아요"}</em>}
    </div>
  );
}

function ActionButtons({ snapshot, send }: { snapshot?: GameSnapshot; send: (type: string, payload: unknown) => void }) {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return <div className="action-empty">경기가 시작되면 역할 행동이 열려요.</div>;
  if (snapshot.phase === "COUNTDOWN") return <div className="action-empty">역할 목표를 확인하세요. 숨기·기준 맵 탐색이 시작되면 행동이 열립니다.</div>;
  if (snapshot.self.role === "HIDER") {
    return (
      <div className="action-buttons">
        <div className="action-item">
          <button type="button" onClick={() => send("lock", !snapshot.self.locked)}><span>◆</span><strong>{snapshot.self.locked ? "고정 풀기" : "사물 고정"}</strong><small>움직임을 완전히 멈춰요</small></button>
          <HelpTooltip label="사물 고정" copy="움직임을 멈춰 파문을 숨깁니다. 이동키를 누르면 자동으로 풀리며, 미션 구역에서는 고정 상태를 2초 유지해야 합니다." />
        </div>
        <div className="action-item">
          <button type="button" disabled={!snapshot.self.swapAvailable} onClick={() => send("swap", true)}><span>⇄</span><strong>자리바꿈</strong><small>가까운 같은 사물과 1회 교체</small></button>
          <HelpTooltip label="자리바꿈" copy="2.5칸 안의 같은 종류 사물과 위치를 단 한 번 바꿉니다. 관찰자가 가까이 왔을 때 탈출하거나 기준 기억을 흔들 때 사용하세요." />
        </div>
        {snapshot.mission && <div className="mission-card action-with-help"><span>시각 미션</span><strong>{snapshot.mission.label}</strong><progress max={1} value={snapshot.mission.progress}>{Math.round(snapshot.mission.progress * 100)}%</progress><HelpTooltip label="진열 미션" copy="표시된 구역 안에서 사물 고정을 2초 유지하면 25점을 받습니다. 생존보다 위험하다고 판단되면 포기해도 됩니다." /></div>}
      </div>
    );
  }
  if (snapshot.seekerPreview) {
    return (
      <div className="action-empty preview-actions">
        <strong>기억 시간</strong><br />전체 맵에서 마우스를 끌어 이동하고 휠로 확대하세요. WASD·방향키로 포탈 도착점도 직접 확인할 수 있어요.
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
    : [["danger", "관찰자 주의"], ["moving", "이동할게요"], ["done", "미션 완료"]];
  return (
    <div className="ping-panel">
      <div className="ping-heading"><span>무음 팀 신호</span><HelpTooltip label="팀 신호" copy="내 현재 위치에 같은 역할만 볼 수 있는 표시를 남깁니다. 음성채팅 없이 의심 구역과 위험을 빠르게 공유하세요." /></div>
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
  const roleName = seeker ? "밤지기 관찰자" : "틈새정령";
  const steps = seeker
    ? ["숨는 장면 대신 기준 사물 배치를 기억하세요.", "드래그·휠과 이동키로 포탈 도착점까지 확인하세요.", "수색이 열리면 가까운 수상한 사물을 클릭하세요."]
    : ["주변과 자연스럽게 어울리는 자리를 찾으세요.", "자리를 정하면 ‘사물 고정’으로 파문을 숨기세요.", "수색 중에는 자리바꿈과 포탈을 탈출에 활용하세요."];
  return (
    <div className={`game-overlay role-reveal-overlay ${seeker ? "reveal-seeker" : "reveal-hider"}`} role="dialog" aria-label={`${roleName} 역할 안내`}>
      <span className="role-reveal-symbol" aria-hidden="true">{seeker ? "☾" : "▣"}</span>
      <p className="role-reveal-kicker">{snapshot.round}라운드 역할 확정</p>
      <strong>당신은 <em>{roleName}</em>입니다</strong>
      <p className="role-reveal-goal">{seeker ? "제한시간 안에 모든 틈새정령을 찾아내세요." : "평범한 사물처럼 숨어 수색 종료까지 살아남으세요."}</p>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <div className="role-reveal-footer"><time>{formatRemaining(snapshot, serverNow)}</time><span>{formatDurationLabel(snapshot.roundDurationMs)} 라운드 · 곧 {seeker ? "기준 맵 탐색" : "숨기"} 시작</span></div>
    </div>
  );
}

function FirstPlayCoach({ snapshot, onClose }: { snapshot: GameSnapshot; onClose: () => void }) {
  const seeker = snapshot.self.role === "SEEKER";
  const preview = seeker && snapshot.phase === "HIDING";
  const title = preview ? "먼저 기준 맵을 기억하세요" : seeker ? "이제 차이를 찾아보세요" : snapshot.phase === "HIDING" ? "지금은 숨을 자리부터 찾으세요" : "움직일 때를 신중히 고르세요";
  const steps = preview
    ? ["마우스로 맵을 끌고 휠로 확대합니다.", "WASD로 포탈을 통과해 연결 구역을 봅니다.", "중복되거나 어색한 사물 수를 기억합니다."]
    : seeker
      ? ["기억한 배치와 다른 사물을 찾습니다.", "2.6칸 안까지 다가간 뒤 사물을 클릭합니다.", "막히면 렌즈로 최근 움직임 구역을 좁힙니다."]
      : snapshot.phase === "HIDING"
        ? ["진열된 사물 무리 옆으로 이동합니다.", "자연스러운 방향을 맞춘 뒤 사물 고정을 누릅니다.", "여유가 있으면 표시된 미션 구역을 노립니다."]
        : ["고정 상태를 유지해 움직임 파문을 감춥니다.", "발각 직전에는 자리바꿈이나 포탈로 빠져나갑니다.", "발견된 뒤에도 팀 신호로 동료를 돕습니다."];
  return (
    <aside className={`coach-card ${seeker ? "coach-seeker" : "coach-hider"}`} aria-label="첫 플레이 단계 안내">
      <div><span>{seeker ? "관찰자 안내" : "틈새정령 안내"}</span><button type="button" onClick={onClose} aria-label="역할 안내 닫기">×</button></div>
      <strong>{title}</strong>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <button type="button" className="coach-done" onClick={onClose}>이해했어요</button>
    </aside>
  );
}

function TouchPad({ setKey }: { setKey: (key: string, active: boolean) => void }) {
  const bind = (key: string) => ({
    onPointerDown: () => setKey(key, true),
    onPointerUp: () => setKey(key, false),
    onPointerLeave: () => setKey(key, false),
    onPointerCancel: () => setKey(key, false),
  });
  return (
    <div className="touch-pad" aria-label="화면 이동키">
      <button type="button" aria-label="위로 이동" {...bind("up")}>▲</button>
      <button type="button" aria-label="왼쪽으로 이동" {...bind("left")}>◀</button>
      <button type="button" aria-label="아래로 이동" {...bind("down")}>▼</button>
      <button type="button" aria-label="오른쪽으로 이동" {...bind("right")}>▶</button>
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
  return ({ LOBBY: "입장과 준비", COUNTDOWN: "역할 배정", HIDING: "숨기·기준 맵 탐색", SEEKING: "밤지기 수색", RESULT: "라운드 결과", FINAL: "최종 결과" } as Record<GamePhase, string>)[phase ?? "LOBBY"];
}

function phaseLabel(phase?: GamePhase): string {
  return ({ LOBBY: "대기실", COUNTDOWN: "곧 시작", HIDING: "숨기 중", SEEKING: "수색 중", RESULT: "결과 보기", FINAL: "경기 종료" } as Record<GamePhase, string>)[phase ?? "LOBBY"];
}

function roleInstruction(snapshot?: GameSnapshot): string {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return "준비를 마친 뒤 역할표를 기다리세요.";
  if (snapshot.phase === "COUNTDOWN") return snapshot.self.role === "SEEKER"
    ? "관찰자입니다. 숨는 장면은 보이지 않으니 기준 배치부터 기억하세요."
    : "틈새정령입니다. 자연스러운 자리를 찾고 사물처럼 고정하세요.";
  if (snapshot.self.caught) return "발견됐지만 끝이 아니에요. 무음 핑으로 팀을 도우세요.";
  if (snapshot.self.role === "HIDER") return snapshot.phase === "HIDING" ? "사물 사이에 자리를 잡고 고정하세요." : "평범한 척 미션을 노리되 움직임 파문을 조심하세요.";
  return snapshot.phase === "HIDING"
    ? "숨는 이용자는 보이지 않습니다. 기준 사물과 포탈을 직접 돌며 기억하세요."
    : "기억한 기준 배치와 비교하고, 가까이 다가가 수상한 사물을 클릭하세요.";
}

function modeLabel(mode?: RoomMode, difficulty?: AiDifficulty): string {
  return mode === "public"
    ? "빠른 매칭"
    : mode === "practice"
      ? `AI 방 · ${aiDifficultyLabel(difficulty ?? "normal")}`
      : "친구 초대방";
}

function aiDifficultyDescription(difficulty: AiDifficulty): string {
  return ({
    easy: "반응이 느리고 단서를 자주 놓쳐 처음 배우기 편합니다.",
    normal: "시야·기억·실수를 균형 있게 조정한 기본 난이도입니다.",
    hard: "움직임을 빨리 포착하고 오래 기억하지만 벽 너머 정답은 알지 못합니다.",
  } satisfies Record<AiDifficulty, string>)[difficulty];
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
    if (/fetch|network|connection|socket/i.test(error.message)) return "게임 서버가 실행 중인지 확인해 주세요.";
    return error.message;
  }
  return "잠시 후 다시 시도해 주세요.";
}
