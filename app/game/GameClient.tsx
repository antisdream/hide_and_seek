"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ColyseusSDK, type Room } from "@colyseus/sdk";
import type {
  GameEffect,
  GamePhase,
  GameSnapshot,
  PingKind,
  RoomMode,
  TeamPing,
} from "../../shared/game-types";
import { mountGameRenderer, type GameRenderer, type LensPulse } from "./game-renderer";

type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

interface Notice {
  id: string;
  title?: string;
  label: string;
  tone?: "normal" | "error" | "success";
}

const GAME_ENDPOINT = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "http://127.0.0.1:2567";

export default function GameClient() {
  const [displayName, setDisplayName] = useState("");
  const [inviteRoomId, setInviteRoomId] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [room, setRoom] = useState<Room>();
  const [snapshot, setSnapshot] = useState<GameSnapshot>();
  const [notice, setNotice] = useState<Notice>();
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GameRenderer | undefined>(undefined);
  const roomRef = useRef<Room | undefined>(undefined);
  const sequenceRef = useRef(0);
  const pressedKeysRef = useRef(new Set<string>());
  const snapshotRef = useRef<GameSnapshot | undefined>(undefined);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDisplayName(window.localStorage.getItem("nunchisoom-display-name") ?? "");
      setInviteRoomId(new URLSearchParams(window.location.search).get("room") ?? "");
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
    });
    return () => {
      disposed = true;
      rendererRef.current?.destroy();
      rendererRef.current = undefined;
    };
  }, [room]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    if (snapshot) rendererRef.current?.pushSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (!room) return;
    const pressedKeys = pressedKeysRef.current;
    const keyDown = (event: KeyboardEvent) => {
      const key = movementKey(event.key);
      if (!key) return;
      event.preventDefault();
      pressedKeys.add(key);
    };
    const keyUp = (event: KeyboardEvent) => {
      const key = movementKey(event.key);
      if (!key) return;
      event.preventDefault();
      pressedKeys.delete(key);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    const sender = window.setInterval(() => {
      const direction = movementFromKeys(pressedKeys);
      room.send("move", { seq: nextSequence(sequenceRef), ...direction });
    }, 75);

    return () => {
      window.clearInterval(sender);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      pressedKeys.clear();
    };
  }, [room]);

  useEffect(() => () => {
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    if (activeRoom) void activeRoom.leave(true);
  }, []);

  const connect = useCallback(async (mode: RoomMode, requestedRoomId?: string) => {
    if (status === "connecting") return;
    const normalizedName = displayName.normalize("NFKC").trim().slice(0, 12);
    if (!normalizedName) {
      setNotice({ id: crypto.randomUUID(), title: "별명 확인", label: "1~12자의 별명을 입력해 주세요.", tone: "error" });
      return;
    }

    setStatus("connecting");
    setNotice({ id: crypto.randomUUID(), label: "잡화점 문을 여는 중입니다…" });
    window.localStorage.setItem("nunchisoom-display-name", normalizedName);
    try {
      const client = new ColyseusSDK(GAME_ENDPOINT);
      const options = {
        displayName: normalizedName,
        deviceId: getDeviceId(),
        mode,
      };
      const joinedRoom = requestedRoomId
        ? await client.joinById(requestedRoomId, options)
        : mode === "public"
          ? await client.joinOrCreate("nunchisoom", options)
          : await client.create("nunchisoom", options);

      joinedRoom.onMessage<GameSnapshot>("state", (nextSnapshot) => {
        setServerOffset(nextSnapshot.serverTime - Date.now());
        setSnapshot(nextSnapshot);
      });
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
        setNotice({ id: crypto.randomUUID(), label: message.label });
      });
      joinedRoom.onDrop(() => setStatus("reconnecting"));
      joinedRoom.onReconnect(() => {
        setStatus("connected");
        setNotice({ id: crypto.randomUUID(), label: "게임방에 다시 연결했습니다.", tone: "success" });
      });
      joinedRoom.onError((_code, message) => {
        setNotice({ id: crypto.randomUUID(), title: "연결 오류", label: message || "게임 서버 연결을 확인해 주세요.", tone: "error" });
      });
      joinedRoom.onLeave(() => {
        if (roomRef.current === joinedRoom) {
          roomRef.current = undefined;
          setStatus("closed");
          setRoom(undefined);
          setSnapshot(undefined);
        }
      });

      roomRef.current = joinedRoom;
      setRoom(joinedRoom);
      setStatus("connected");
      setNotice({ id: crypto.randomUUID(), label: "잡화점에 입장했습니다.", tone: "success" });
      sequenceRef.current = 0;

      if (mode !== "public" && !requestedRoomId) {
        const url = new URL(window.location.href);
        url.pathname = "/game";
        url.search = `?room=${encodeURIComponent(joinedRoom.roomId)}`;
        window.history.replaceState({}, "", url);
        setInviteRoomId(joinedRoom.roomId);
      }
    } catch (error: unknown) {
      setStatus("idle");
      setNotice({
        id: crypto.randomUUID(),
        title: "입장하지 못했습니다",
        label: readableError(error),
        tone: "error",
      });
    }
  }, [displayName, status]);

  const disconnect = useCallback(async () => {
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    if (activeRoom) await activeRoom.leave(true);
    setRoom(undefined);
    setSnapshot(undefined);
    setStatus("idle");
    window.history.replaceState({}, "", "/game");
  }, []);

  const send = useCallback((type: string, payload: unknown) => {
    roomRef.current?.send(type, payload);
  }, []);

  const copyInvite = useCallback(async () => {
    if (!room) return;
    const url = new URL("/game", window.location.origin);
    url.searchParams.set("room", room.roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice({ id: crypto.randomUUID(), label: "초대 링크를 복사했습니다.", tone: "success" });
    } catch {
      setNotice({ id: crypto.randomUUID(), label: `초대 코드: ${room.roomId}`, tone: "normal" });
    }
  }, [room]);

  const setTouchKey = useCallback((key: string, active: boolean) => {
    if (active) pressedKeysRef.current.add(key);
    else pressedKeysRef.current.delete(key);
  }, []);

  if (!room) {
    return (
      <main className="join-page">
        <header className="game-topbar">
          <Link className="brand" href="/" aria-label="눈치숨 홈">
            <span className="brand-mark" aria-hidden="true">눈</span><span>눈치숨</span>
          </Link>
          <a className="text-link" href="/how-to-play">게임 방법</a>
        </header>

        <section className="join-layout">
          <div className="join-intro">
            <p className="eyebrow">소리가 없어도 단서는 선명하게</p>
            <h1>오늘 밤,<br /><em>잡화점의 눈치왕</em>은 누구?</h1>
            <p>설치 없이 별명만 정하면 바로 시작합니다. 공개방은 무작위 친구와, 초대방은 링크를 받은 지인과 만나요.</p>
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
                <div><span>초대장 도착</span><strong>{shortRoomId(inviteRoomId)}</strong></div>
                <button className="primary-button wide" type="button" disabled={status === "connecting"} onClick={() => void connect("invite", inviteRoomId)}>
                  초대방 입장
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
                  <span aria-hidden="true">◎</span><strong>혼자 연습</strong><small>봇 3명과 튜토리얼</small>
                </button>
              </div>
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
        <Link className="brand compact" href="/" aria-label="눈치숨 홈">
          <span className="brand-mark" aria-hidden="true">눈</span><span>눈치숨</span>
        </Link>
        <div className="phase-summary" aria-live="polite">
          <span className={`phase-icon phase-${snapshot?.phase.toLowerCase() ?? "lobby"}`} aria-hidden="true" />
          <div><small>{phaseKicker(snapshot?.phase)}</small><strong>{phaseLabel(snapshot?.phase)}</strong></div>
          <time>{formatRemaining(snapshot, clockNow + serverOffset)}</time>
        </div>
        <div className="room-tools">
          <button type="button" onClick={() => void copyInvite()} title="초대 링크 복사">
            방 {shortRoomId(room.roomId)} <span>복사</span>
          </button>
          <button type="button" className="leave-button" onClick={() => void disconnect()}>나가기</button>
        </div>
      </header>

      <section className="play-grid">
        <aside className="players-panel" aria-label="참가자 목록">
          <div className="panel-heading"><div><small>{modeLabel(snapshot?.mode)}</small><h2>함께 있는 친구</h2></div><strong>{snapshot?.players.length ?? 0}/{snapshot?.maxPlayers ?? 10}</strong></div>
          <div className="player-list">
            {snapshot?.players.map((player) => (
              <article className={`player-row avatar-${player.avatar}`} key={player.id}>
                <span className="avatar-face" aria-hidden="true"><i /><i /><b /></span>
                <div><strong>{player.displayName}{player.bot ? " · 봇" : ""}</strong><small>{player.host ? "방장 · " : ""}{playerStatusLabel(player.status, player.ready)}</small></div>
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
          <div className="canvas-frame">
            <div ref={canvasRef} className="phaser-host" />
            {status === "reconnecting" && <div className="game-overlay"><strong>다시 연결하는 중…</strong><span>10초 동안 자리를 지켜드려요.</span></div>}
            {snapshot?.phase === "COUNTDOWN" && <div className="game-overlay compact-overlay"><strong>{formatRemaining(snapshot, clockNow + serverOffset)}</strong><span>역할표를 확인하세요</span></div>}
            {snapshot?.worldHidden && <div className="game-overlay curtain-overlay"><span aria-hidden="true">◎</span><strong>밤지기 모루는 문 밖에서 기다리는 중</strong><p>틈새정령에게 25초의 준비 시간을 공정하게 보장합니다.</p></div>}
            {snapshot?.result && <ResultOverlay snapshot={snapshot} />}
            {snapshot?.self.caught && snapshot.phase === "SEEKING" && <div className="caught-ribbon">발견됐어요 · 팀 핑으로 계속 도울 수 있어요</div>}
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
      <span aria-hidden="true">{role === "HIDER" ? "▣" : role === "SEEKER" ? "◎" : "⌛"}</span>
      <div><small>내 역할</small><strong>{role === "HIDER" ? "틈새정령" : role === "SEEKER" ? "관찰자" : "대기 중"}</strong></div>
      <p>{roleInstruction(snapshot)}</p>
    </div>
  );
}

function ActionButtons({ snapshot, send }: { snapshot?: GameSnapshot; send: (type: string, payload: unknown) => void }) {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return <div className="action-empty">경기가 시작되면 역할 행동이 열려요.</div>;
  if (snapshot.self.role === "HIDER") {
    return (
      <div className="action-buttons">
        <button type="button" onClick={() => send("lock", !snapshot.self.locked)}><span>◆</span><strong>{snapshot.self.locked ? "고정 풀기" : "사물 고정"}</strong><small>움직임을 완전히 멈춰요</small></button>
        <button type="button" disabled={!snapshot.self.swapAvailable} onClick={() => send("swap", true)}><span>⇄</span><strong>자리바꿈</strong><small>가까운 같은 사물과 1회 교체</small></button>
        {snapshot.mission && <div className="mission-card"><span>시각 미션</span><strong>{snapshot.mission.label}</strong><progress max={1} value={snapshot.mission.progress}>{Math.round(snapshot.mission.progress * 100)}%</progress></div>}
      </div>
    );
  }
  const lensSeconds = Math.max(0, Math.ceil((snapshot.self.lensReadyAt - snapshot.serverTime) / 1_000));
  return (
    <div className="action-buttons">
      <button type="button" disabled={lensSeconds > 0} onClick={() => send("lens", true)}><span>⌾</span><strong>관찰 렌즈</strong><small>{lensSeconds > 0 ? `${lensSeconds}초 뒤 충전` : "최근 움직임을 구역으로 표시"}</small></button>
      <div className="tag-tip"><span aria-hidden="true">☝</span><p><strong>확인 스티커</strong><br />가까운 사물을 직접 클릭하세요.</p></div>
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
      <span>무음 팀 신호</span>
      <div>{choices.map(([kind, label]) => <button key={kind} type="button" onClick={() => send("ping", { kind })}>{label}</button>)}</div>
    </div>
  );
}

function TouchPad({ setKey }: { setKey: (key: string, active: boolean) => void }) {
  const bind = (key: string) => ({
    onPointerDown: () => setKey(key, true),
    onPointerUp: () => setKey(key, false),
    onPointerLeave: () => setKey(key, false),
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
      <span>{snapshot.result?.winner === "HIDERS" ? "▣ 끝까지 자연스러웠어요" : "◎ 관찰이 정확했어요"}</span>
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
  const created = crypto.randomUUID();
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

function phaseKicker(phase?: GamePhase): string {
  return ({ LOBBY: "입장과 준비", COUNTDOWN: "역할 배정", HIDING: "틈새정령 시간", SEEKING: "밤지기 입장", RESULT: "라운드 결과", FINAL: "최종 결과" } as Record<GamePhase, string>)[phase ?? "LOBBY"];
}

function phaseLabel(phase?: GamePhase): string {
  return ({ LOBBY: "대기실", COUNTDOWN: "곧 시작", HIDING: "숨기 중", SEEKING: "수색 중", RESULT: "결과 보기", FINAL: "경기 종료" } as Record<GamePhase, string>)[phase ?? "LOBBY"];
}

function roleInstruction(snapshot?: GameSnapshot): string {
  if (!snapshot || snapshot.self.role === "SPECTATOR") return "준비를 마친 뒤 역할표를 기다리세요.";
  if (snapshot.self.caught) return "발견됐지만 끝이 아니에요. 무음 핑으로 팀을 도우세요.";
  if (snapshot.self.role === "HIDER") return snapshot.phase === "HIDING" ? "사물 사이에 자리를 잡고 고정하세요." : "평범한 척 미션을 노리되 움직임 파문을 조심하세요.";
  return snapshot.phase === "HIDING" ? "관찰자는 문 밖에서 배치 규칙을 익히는 중이에요." : "가까이 다가가 수상한 사물을 클릭하세요.";
}

function modeLabel(mode?: RoomMode): string {
  return mode === "public" ? "빠른 매칭" : mode === "practice" ? "연습방" : "친구 초대방";
}

function playerStatusLabel(status: GameSnapshot["players"][number]["status"], ready: boolean): string {
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
    if (/fetch|network|connection|socket/i.test(error.message)) return "게임 서버가 실행 중인지 확인해 주세요.";
    return error.message;
  }
  return "잠시 후 다시 시도해 주세요.";
}
