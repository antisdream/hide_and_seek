import type Phaser from "phaser";
import { isBlocked } from "../../shared/geometry";
import type {
  GameEffect,
  GameSnapshot,
  MapLayout,
  MapTheme,
  Point,
  PropKind,
  TeamPing,
  WorldEntity,
} from "../../shared/game-types";

export interface LensPulse {
  id: string;
  cells: Point[];
  expiresAt: number;
}

export interface GameRenderer {
  pushSnapshot: (snapshot: GameSnapshot) => void;
  setLocalMovement: (movement: Point) => void;
  pushEffect: (effect: GameEffect) => void;
  pushLens: (pulse: LensPulse) => void;
  pushPing: (ping: TeamPing) => void;
  destroy: () => void;
}

interface RendererCallbacks {
  onTag: (entityId: string) => void;
}

interface EntityView {
  container: Phaser.GameObjects.Container;
  signature: string;
  controlled: boolean;
  samples: MotionSample[];
}

export interface MotionSample {
  serverTime: number;
  x: number;
  y: number;
  rotation: number;
}

interface MapPalette {
  floor: number;
  grid: number;
  obstacle: number;
  obstacleLine: number;
  accent: number;
  portal: number;
}

const TILE = 40;
const VIEW_WIDTH = 24 * TILE;
const VIEW_HEIGHT = 16 * TILE;
const PREVIEW_MAX_ZOOM = 1.25;
const MOVEMENT_RESPONSE_MS = 28;
const REMOTE_INTERPOLATION_DELAY_MS = 50;
const MAX_EXTRAPOLATION_MS = 66;
const PORTAL_SNAP_DISTANCE = TILE * 4;

/** 서버 스냅숏 사이에서도 프레임 시간에 비례해 같은 체감 속도로 좌표를 보간한다. */
export function movementSmoothingBlend(deltaMs: number, responseMs = MOVEMENT_RESPONSE_MS): number {
  const safeDelta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  const safeResponse = Number.isFinite(responseMs) ? Math.max(1, responseMs) : MOVEMENT_RESPONSE_MS;
  return 1 - Math.exp(-safeDelta / safeResponse);
}

/**
 * 시간표가 붙은 서버 좌표를 두 스냅숏 사이에서 선형 보간한다.
 * 네트워크가 잠깐 늦으면 최대 두 서버 틱까지만 속도를 외삽하고, 포탈 이동은 즉시 전환한다.
 */
export function sampleMotionAt(
  samples: readonly MotionSample[],
  renderServerTime: number,
  maxExtrapolationMs = MAX_EXTRAPOLATION_MS,
): MotionSample | undefined {
  if (samples.length === 0) return undefined;
  const first = samples[0];
  if (samples.length === 1 || renderServerTime <= first.serverTime) return { ...first };

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const next = samples[index];
    if (renderServerTime > next.serverTime) continue;
    if (Math.hypot(next.x - previous.x, next.y - previous.y) > PORTAL_SNAP_DISTANCE) {
      return { ...(renderServerTime < next.serverTime ? previous : next) };
    }
    const span = Math.max(1, next.serverTime - previous.serverTime);
    const ratio = Math.max(0, Math.min(1, (renderServerTime - previous.serverTime) / span));
    return {
      serverTime: renderServerTime,
      x: previous.x + (next.x - previous.x) * ratio,
      y: previous.y + (next.y - previous.y) * ratio,
      rotation: interpolateAngle(previous.rotation, next.rotation, ratio),
    };
  }

  const latest = samples[samples.length - 1];
  const previous = samples[samples.length - 2];
  const span = latest.serverTime - previous.serverTime;
  if (span <= 0 || Math.hypot(latest.x - previous.x, latest.y - previous.y) > PORTAL_SNAP_DISTANCE) {
    return { ...latest };
  }
  const extraMs = Math.max(0, Math.min(maxExtrapolationMs, renderServerTime - latest.serverTime));
  return {
    serverTime: latest.serverTime + extraMs,
    x: latest.x + ((latest.x - previous.x) / span) * extraMs,
    y: latest.y + ((latest.y - previous.y) / span) * extraMs,
    rotation: latest.rotation,
  };
}

/** 로컬 입력을 즉시 반영하되 서버와 같은 충돌 반경과 축별 미끄러짐을 사용한다. */
export function predictLocalMovement(
  point: Point,
  input: Point,
  speed: number,
  deltaMs: number,
  map: MapLayout,
): Point {
  const safeDelta = Number.isFinite(deltaMs) ? Math.max(0, Math.min(50, deltaMs)) : 0;
  const length = Math.hypot(input.x, input.y);
  if (length <= 0 || !Number.isFinite(speed) || speed <= 0) return { ...point };
  const direction = length > 1 ? { x: input.x / length, y: input.y / length } : input;
  const step = speed * (safeDelta / 1_000);
  const next = { ...point };
  const nextX = { x: point.x + direction.x * step, y: point.y };
  if (!isBlocked(nextX, 0.36, map)) next.x = nextX.x;
  const nextY = { x: next.x, y: point.y + direction.y * step };
  if (!isBlocked(nextY, 0.36, map)) next.y = nextY.y;
  return next;
}

function interpolateAngle(from: number, to: number, ratio: number): number {
  const gap = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + gap * ratio;
}

/** 밤지기마다 기존 아바타 색을 위협적인 오라 색으로 이어받는다. */
export function seekerThreatAccent(avatar: string | undefined): number {
  return ({
    coral: 0xff5f68,
    mint: 0x55d8b6,
    yellow: 0xffc857,
    violet: 0xb58cff,
    blue: 0x698cff,
    peach: 0xff8c61,
  } as Record<string, number>)[avatar ?? ""] ?? 0xff5f68;
}

/** 큰 맵도 처음에는 한 화면에 들어오도록 사전 탐색 배율을 계산한다. */
export function previewCameraZoom(
  worldWidth: number,
  worldHeight: number,
  viewWidth = VIEW_WIDTH,
  viewHeight = VIEW_HEIGHT,
): number {
  const fitZoom = Math.min(viewWidth / worldWidth, viewHeight / worldHeight) * 0.92;
  return Math.max(0.35, Math.min(1, fitZoom));
}

/** 확대 상태에서 카메라가 맵 밖으로 완전히 벗어나지 않게 스크롤을 제한한다. */
export function clampPreviewScroll(scroll: number, worldSize: number, viewSize: number, zoom: number): number {
  const visibleSize = viewSize / zoom;
  if (visibleSize >= worldSize) return (worldSize - visibleSize) / 2;
  return Math.max(0, Math.min(worldSize - visibleSize, scroll));
}

/**
 * 서버 좌표를 목표값으로 유지하고 Phaser 프레임 사이에서 보간한다.
 * 맵과 사물 전체를 매 스냅숏마다 파괴하지 않아 이동이 끊겨 보이는 현상을 줄인다.
 */
export async function mountGameRenderer(
  parent: HTMLElement,
  callbacks: RendererCallbacks,
): Promise<GameRenderer> {
  const PhaserRuntime = (await import("phaser")).default;

  class NightStationeryScene extends PhaserRuntime.Scene {
    private snapshot?: GameSnapshot;
    private staticWorld?: Phaser.GameObjects.Container;
    private entityWorld?: Phaser.GameObjects.Container;
    private transientWorld?: Phaser.GameObjects.Container;
    private waitingWorld?: Phaser.GameObjects.Container;
    private readonly entityViews = new Map<string, EntityView>();
    private readonly effects: Array<GameEffect & { expiresAt: number }> = [];
    private readonly pings: Array<TeamPing & { expiresAt: number }> = [];
    private lens?: LensPulse;
    private sceneReady = false;
    private mapKey = "";
    private followedEntityId = "";
    private previewCameraActive = false;
    private previewPointerId = -1;
    private previewPointerX = 0;
    private previewPointerY = 0;
    private previewScrollX = 0;
    private previewScrollY = 0;
    private previewMinZoom = 1;
    private previewWorldWidth = VIEW_WIDTH;
    private previewWorldHeight = VIEW_HEIGHT;
    private localMovement: Point = { x: 0, y: 0 };
    private serverClockOffset = 0;
    private hasServerClockOffset = false;

    constructor() {
      super("night-stationery");
    }

    create(): void {
      this.sceneReady = true;
      this.cameras.main.setBackgroundColor("#171a33");
      this.input.on("pointerdown", this.beginPreviewDrag, this);
      this.input.on("pointermove", this.movePreviewCamera, this);
      this.input.on("pointerup", this.endPreviewDrag, this);
      this.input.on("pointerupoutside", this.endPreviewDrag, this);
      this.input.on("wheel", this.zoomPreviewCamera, this);
      if (this.snapshot) this.applySnapshot(this.snapshot);
      else this.drawWaitingBoard();
    }

    update(_time: number, delta: number): void {
      const now = Date.now();
      const beforeEffects = this.effects.length;
      const beforePings = this.pings.length;
      while (this.effects[0] && this.effects[0].expiresAt <= now) this.effects.shift();
      while (this.pings[0] && this.pings[0].expiresAt <= now) this.pings.shift();
      const lensExpired = Boolean(this.lens && this.lens.expiresAt <= now);
      if (lensExpired) this.lens = undefined;
      if (beforeEffects !== this.effects.length || beforePings !== this.pings.length || lensExpired) {
        this.redrawTransients();
      }

      const renderServerTime = now + this.serverClockOffset - REMOTE_INTERPOLATION_DELAY_MS;
      for (const view of this.entityViews.values()) {
        const latest = view.samples[view.samples.length - 1];
        if (!latest) continue;
        if (view.controlled && this.canPredictLocalMovement()) {
          const predicted = predictLocalMovement(
            { x: view.container.x / TILE, y: view.container.y / TILE },
            this.localMovement,
            this.snapshot?.self.movementSpeed ?? 0,
            delta,
            this.snapshot!.map,
          );
          view.container.setPosition(predicted.x * TILE, predicted.y * TILE);
          const authorityGap = Math.hypot(latest.x - view.container.x, latest.y - view.container.y);
          if (authorityGap > PORTAL_SNAP_DISTANCE) {
            view.container.setPosition(latest.x, latest.y);
          } else {
            const moving = Math.hypot(this.localMovement.x, this.localMovement.y) > 0;
            const correction = movementSmoothingBlend(delta, moving ? 210 : 58);
            view.container.x += (latest.x - view.container.x) * correction;
            view.container.y += (latest.y - view.container.y) * correction;
          }
          if (Math.hypot(this.localMovement.x, this.localMovement.y) > 0) {
            view.container.rotation = Math.atan2(this.localMovement.y, this.localMovement.x);
          } else {
            view.container.rotation = interpolateAngle(
              view.container.rotation,
              latest.rotation,
              movementSmoothingBlend(delta, 58),
            );
          }
          continue;
        }

        const sampled = sampleMotionAt(view.samples, renderServerTime);
        if (!sampled) continue;
        view.container.setPosition(sampled.x, sampled.y);
        view.container.setRotation(sampled.rotation);
      }
    }

    setSnapshot(snapshot: GameSnapshot): void {
      const observedOffset = snapshot.serverTime - Date.now();
      this.serverClockOffset = this.hasServerClockOffset
        ? this.serverClockOffset + (observedOffset - this.serverClockOffset) * 0.12
        : observedOffset;
      this.hasServerClockOffset = true;
      this.snapshot = snapshot;
      if (this.sceneReady) this.applySnapshot(snapshot);
    }

    setLocalMovement(movement: Point): void {
      this.localMovement = { x: movement.x, y: movement.y };
    }

    addEffect(effect: GameEffect): void {
      this.effects.push({ ...effect, expiresAt: Date.now() + 1_900 });
      if (this.sceneReady) this.redrawTransients();
    }

    addLens(pulse: LensPulse): void {
      this.lens = pulse;
      if (this.sceneReady) this.redrawTransients();
    }

    addPing(ping: TeamPing): void {
      this.pings.push({ ...ping, expiresAt: Date.now() + 2_400 });
      if (this.sceneReady) this.redrawTransients();
    }

    private applySnapshot(snapshot: GameSnapshot): void {
      this.waitingWorld?.destroy(true);
      this.waitingWorld = undefined;
      // 같은 맵이어도 역할이 바뀌면 미션 구역의 노출 방식이 달라지므로 다시 구성한다.
      const nextMapKey = `${snapshot.map.id ?? "legacy"}:${snapshot.map.version}:${snapshot.self.role}`;
      if (this.mapKey !== nextMapKey) {
        this.mapKey = nextMapKey;
        this.rebuildStaticMap(snapshot);
        this.clearEntities();
      }
      this.syncPreviewCamera(snapshot);
      this.reconcileEntities(snapshot.entities, snapshot.seekerPreview, snapshot.serverTime);
    }

    private canPredictLocalMovement(): boolean {
      const snapshot = this.snapshot;
      if (!snapshot || snapshot.self.caught || snapshot.self.locked) return false;
      if (snapshot.self.role !== "HIDER" && snapshot.self.role !== "SEEKER") return false;
      return snapshot.phase === "HIDING" || snapshot.phase === "SEEKING";
    }

    private rebuildStaticMap(snapshot: GameSnapshot): void {
      this.staticWorld?.destroy(true);
      const root = this.add.container(0, 0);
      this.staticWorld = root;
      const palette = paletteFor(snapshot.map.theme);
      root.add(this.drawFloor(snapshot.map.width, snapshot.map.height, palette));

      for (const zone of snapshot.map.zones) {
        const ring = this.add.graphics();
        ring.lineStyle(2, palette.accent, snapshot.self.role === "HIDER" ? 0.55 : 0.12);
        ring.strokeCircle(zone.x * TILE, zone.y * TILE, zone.radius * TILE);
        root.add(ring);
        if (snapshot.self.role === "HIDER") {
          root.add(this.add.text(zone.x * TILE, zone.y * TILE - zone.radius * TILE, zone.label, {
            color: "#f2fff9",
            fontFamily: "Pretendard, sans-serif",
            fontSize: "13px",
            fontStyle: "bold",
            backgroundColor: "#263d48cc",
            padding: { x: 6, y: 3 },
          }).setOrigin(0.5, 1));
        }
      }

      for (const obstacle of snapshot.map.obstacles) {
        const structure = this.add.graphics();
        structure.fillStyle(palette.obstacle, 1);
        structure.fillRoundedRect(
          obstacle.x * TILE,
          obstacle.y * TILE,
          obstacle.width * TILE,
          obstacle.height * TILE,
          8,
        );
        structure.lineStyle(3, palette.obstacleLine, 1);
        structure.strokeRoundedRect(
          obstacle.x * TILE,
          obstacle.y * TILE,
          obstacle.width * TILE,
          obstacle.height * TILE,
          8,
        );
        root.add(structure);
      }

      for (const portal of snapshot.map.portals ?? []) {
        const target = snapshot.map.portals.find((candidate) => candidate.id === portal.targetId);
        root.add(this.drawPortal(portal, target?.label, palette.portal));
      }

      const worldWidth = snapshot.map.width * TILE;
      const worldHeight = snapshot.map.height * TILE;
      this.cameras.main.stopFollow();
      this.cameras.main.setZoom(1);
      this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
      this.cameras.main.centerOn(worldWidth / 2, worldHeight / 2);
      this.followedEntityId = "";
      this.redrawTransients();
    }

    private reconcileEntities(entities: WorldEntity[], seekerPreview: boolean, serverTime: number): void {
      const visibleIds = new Set(entities.map((entity) => entity.id));
      for (const [id, view] of this.entityViews) {
        if (visibleIds.has(id)) continue;
        view.container.destroy(true);
        this.entityViews.delete(id);
      }

      if (!this.entityWorld) this.entityWorld = this.add.container(0, 0);
      let controlledId = "";
      for (const entity of entities) {
        const signature = entitySignature(entity);
        const sample: MotionSample = {
          serverTime,
          x: entity.x * TILE,
          y: entity.y * TILE,
          rotation: (entity.rotation * Math.PI) / 180,
        };
        let view = this.entityViews.get(entity.id);
        if (!view || view.signature !== signature) {
          const previousPosition = view ? { x: view.container.x, y: view.container.y } : undefined;
          const previousRotation = view?.container.rotation;
          view?.container.destroy(true);
          const container = this.drawEntity(entity);
          container.setPosition(previousPosition?.x ?? sample.x, previousPosition?.y ?? sample.y);
          container.setRotation(previousRotation ?? sample.rotation);
          this.entityWorld.add(container);
          view = { container, signature, controlled: entity.controlled, samples: [sample] };
          this.entityViews.set(entity.id, view);
        } else {
          view.controlled = entity.controlled;
          const latest = view.samples[view.samples.length - 1];
          if (!latest || sample.serverTime > latest.serverTime) {
            if (latest && Math.hypot(sample.x - latest.x, sample.y - latest.y) > PORTAL_SNAP_DISTANCE) {
              view.samples = [sample];
              view.container.setPosition(sample.x, sample.y);
              view.container.setRotation(sample.rotation);
            } else {
              view.samples.push(sample);
              if (view.samples.length > 5) view.samples.shift();
            }
          }
        }
        if (entity.controlled) controlledId = entity.id;
      }

      if (!seekerPreview && controlledId && controlledId !== this.followedEntityId) {
        const controlled = this.entityViews.get(controlledId)?.container;
        if (controlled) {
          // 카메라는 이미 보간된 개체를 그대로 따라가 이중 지연과 정수 픽셀 튐을 만들지 않는다.
          this.cameras.main.startFollow(controlled, false, 1, 1);
          this.followedEntityId = controlledId;
        }
      }
    }

    private syncPreviewCamera(snapshot: GameSnapshot): void {
      const camera = this.cameras.main;
      const worldWidth = snapshot.map.width * TILE;
      const worldHeight = snapshot.map.height * TILE;
      if (snapshot.seekerPreview) {
        const mapChanged = worldWidth !== this.previewWorldWidth || worldHeight !== this.previewWorldHeight;
        if (!this.previewCameraActive || mapChanged) {
          this.previewCameraActive = true;
          this.previewWorldWidth = worldWidth;
          this.previewWorldHeight = worldHeight;
          this.previewMinZoom = previewCameraZoom(worldWidth, worldHeight, camera.width, camera.height);
          camera.stopFollow();
          camera.setZoom(this.previewMinZoom);
          camera.centerOn(worldWidth / 2, worldHeight / 2);
          this.followedEntityId = "";
          parent.classList.add("preview-camera-active");
        }
        return;
      }

      if (!this.previewCameraActive) return;
      this.previewCameraActive = false;
      this.previewPointerId = -1;
      camera.setZoom(1);
      this.followedEntityId = "";
      parent.classList.remove("preview-camera-active", "preview-camera-dragging");
    }

    private beginPreviewDrag(pointer: Phaser.Input.Pointer): void {
      if (!this.previewCameraActive) return;
      this.previewPointerId = pointer.id;
      this.previewPointerX = pointer.x;
      this.previewPointerY = pointer.y;
      this.previewScrollX = this.cameras.main.scrollX;
      this.previewScrollY = this.cameras.main.scrollY;
      parent.classList.add("preview-camera-dragging");
    }

    private movePreviewCamera(pointer: Phaser.Input.Pointer): void {
      if (!this.previewCameraActive || pointer.id !== this.previewPointerId || !pointer.isDown) return;
      const camera = this.cameras.main;
      camera.scrollX = clampPreviewScroll(
        this.previewScrollX - (pointer.x - this.previewPointerX) / camera.zoom,
        this.previewWorldWidth,
        camera.width,
        camera.zoom,
      );
      camera.scrollY = clampPreviewScroll(
        this.previewScrollY - (pointer.y - this.previewPointerY) / camera.zoom,
        this.previewWorldHeight,
        camera.height,
        camera.zoom,
      );
    }

    private endPreviewDrag(pointer: Phaser.Input.Pointer): void {
      if (pointer.id !== this.previewPointerId) return;
      this.previewPointerId = -1;
      parent.classList.remove("preview-camera-dragging");
    }

    private zoomPreviewCamera(
      pointer: Phaser.Input.Pointer,
      _over: Phaser.GameObjects.GameObject[],
      _deltaX: number,
      deltaY: number,
    ): void {
      if (!this.previewCameraActive || deltaY === 0) return;
      pointer.event?.preventDefault();
      const camera = this.cameras.main;
      const before = camera.getWorldPoint(pointer.x, pointer.y);
      const direction = deltaY > 0 ? 0.88 : 1.12;
      camera.setZoom(Math.max(this.previewMinZoom, Math.min(PREVIEW_MAX_ZOOM, camera.zoom * direction)));
      const after = camera.getWorldPoint(pointer.x, pointer.y);
      camera.scrollX = clampPreviewScroll(
        camera.scrollX + before.x - after.x,
        this.previewWorldWidth,
        camera.width,
        camera.zoom,
      );
      camera.scrollY = clampPreviewScroll(
        camera.scrollY + before.y - after.y,
        this.previewWorldHeight,
        camera.height,
        camera.zoom,
      );
    }

    private clearEntities(): void {
      this.entityWorld?.destroy(true);
      this.entityWorld = this.add.container(0, 0);
      this.entityViews.clear();
      this.followedEntityId = "";
    }

    private redrawTransients(): void {
      if (!this.sceneReady) return;
      this.transientWorld?.destroy(true);
      const root = this.add.container(0, 0);
      this.transientWorld = root;
      if (this.lens) {
        for (const cell of this.lens.cells) {
          const pulse = this.add.graphics();
          pulse.fillStyle(0x698cff, 0.2);
          pulse.fillRoundedRect((cell.x - 2) * TILE, (cell.y - 2) * TILE, 4 * TILE, 4 * TILE, 20);
          pulse.lineStyle(3, 0x9cb0ff, 0.75);
          pulse.strokeRoundedRect((cell.x - 2) * TILE, (cell.y - 2) * TILE, 4 * TILE, 4 * TILE, 20);
          root.add(pulse);
        }
      }
      for (const ping of this.pings) root.add(this.drawPing(ping));
      for (const effect of this.effects) root.add(this.drawEffect(effect));
    }

    private drawWaitingBoard(): void {
      this.waitingWorld?.destroy(true);
      const root = this.add.container(0, 0);
      this.waitingWorld = root;
      root.add(this.drawFloor(24, 16, paletteFor("stationery")));
      root.add(this.add.text(480, 292, "수상한 잡화점을 정리하는 중…", {
        color: "#fff9ec",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "26px",
        fontStyle: "bold",
      }).setOrigin(0.5));
      root.add(this.add.text(480, 332, "소리 없이도 모든 단서를 확인할 수 있어요", {
        color: "#aeb7cf",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "15px",
      }).setOrigin(0.5));
    }

    private drawFloor(width: number, height: number, palette: MapPalette): Phaser.GameObjects.Graphics {
      const floor = this.add.graphics();
      floor.fillStyle(palette.floor, 1);
      floor.fillRect(0, 0, width * TILE, height * TILE);
      floor.lineStyle(1, palette.grid, 0.65);
      for (let x = 0; x <= width; x += 1) floor.lineBetween(x * TILE, 0, x * TILE, height * TILE);
      for (let y = 0; y <= height; y += 1) floor.lineBetween(0, y * TILE, width * TILE, y * TILE);
      floor.lineStyle(5, 0x15182c, 1);
      floor.strokeRect(2, 2, width * TILE - 4, height * TILE - 4);
      return floor;
    }

    private drawPortal(
      portal: GameSnapshot["map"]["portals"][number],
      targetLabel: string | undefined,
      color: number,
    ): Phaser.GameObjects.Container {
      const container = this.add.container(portal.x * TILE, portal.y * TILE);
      const gate = this.add.graphics();
      gate.fillStyle(color, 0.18);
      gate.fillCircle(0, 0, portal.radius * TILE);
      gate.lineStyle(5, color, 0.9);
      gate.strokeCircle(0, 0, portal.radius * TILE);
      gate.lineStyle(2, 0xffffff, 0.7);
      gate.strokeCircle(0, 0, portal.radius * TILE - 9);
      const label = this.add.text(0, -portal.radius * TILE - 10, `${portal.label} → ${targetLabel ?? "연결 구역"}`, {
        color: "#ffffff",
        backgroundColor: "#25213add",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        padding: { x: 7, y: 4 },
      }).setOrigin(0.5, 1);
      container.add([gate, label]);
      return container;
    }

    private drawEntity(entity: WorldEntity): Phaser.GameObjects.Container {
      const container = this.add.container(entity.x * TILE, entity.y * TILE);
      if (entity.category === "seeker") this.drawSeeker(container, entity);
      else this.drawProp(container, entity.propKind ?? "notebook", entity);
      container.setSize(42, 42).setInteractive({ useHandCursor: true });
      container.on("pointerdown", () => {
        if (this.snapshot?.seekerPreview) return;
        if ((this.snapshot?.self.tagReadyAt ?? 0) > (this.snapshot?.serverTime ?? 0)) return;
        callbacks.onTag(entity.id);
      });
      return container;
    }

    private drawProp(
      container: Phaser.GameObjects.Container,
      kind: PropKind,
      entity: WorldEntity,
    ): void {
      const body = this.add.graphics();
      body.fillStyle(propColor(kind), 1);
      body.lineStyle(
        entity.controlled ? 4 : entity.teammate ? 3 : 2,
        entity.controlled ? 0xffd76a : entity.teammate ? 0x63d6b5 : 0x171a33,
        1,
      );

      if (kind === "pencil") {
        body.fillRoundedRect(-22, -7, 44, 14, 6);
        body.strokeRoundedRect(-22, -7, 44, 14, 6);
        body.fillStyle(0xfff1ca, 1);
        body.fillTriangle(22, -7, 31, 0, 22, 7);
      } else if (kind === "tape") {
        body.fillCircle(0, 0, 19);
        body.strokeCircle(0, 0, 19);
        body.fillStyle(0x28304a, 1);
        body.fillCircle(0, 0, 8);
      } else if (kind === "ribbon") {
        body.fillCircle(0, -3, 12);
        body.fillTriangle(-5, 5, -18, 24, 0, 16);
        body.fillTriangle(5, 5, 18, 24, 0, 16);
        body.strokeCircle(0, -3, 12);
      } else if (kind === "eraser") {
        body.fillRoundedRect(-21, -13, 42, 26, 10);
        body.strokeRoundedRect(-21, -13, 42, 26, 10);
      } else if (kind === "box") {
        body.fillRoundedRect(-21, -19, 42, 38, 5);
        body.strokeRoundedRect(-21, -19, 42, 38, 5);
        body.lineStyle(2, 0x171a33, 0.65);
        body.lineBetween(-21, -6, 21, -6);
      } else {
        body.fillRoundedRect(-19, -24, 38, 48, 6);
        body.strokeRoundedRect(-19, -24, 38, 48, 6);
        body.lineStyle(2, 0xffffff, 0.5);
        body.lineBetween(-11, -13, 11, -13);
        body.lineBetween(-11, -6, 8, -6);
      }
      container.add(body);

      const face = this.add.graphics();
      face.fillStyle(0x24213a, 1);
      face.fillCircle(-5, -1, 2);
      face.fillCircle(5, -1, 2);
      face.lineStyle(1.5, 0x24213a, 1);
      face.arc(0, 4, 4, 0.2, Math.PI - 0.2, false);
      container.add(face);

      if (entity.controlled || entity.teammate) {
        container.add(this.add.text(0, -34, entity.controlled ? "나" : "짝", {
          color: "#25213a",
          backgroundColor: entity.controlled ? "#ffd76a" : "#63d6b5",
          fontFamily: "Pretendard, sans-serif",
          fontSize: "11px",
          fontStyle: "bold",
          padding: { x: 5, y: 3 },
        }).setOrigin(0.5));
      }
    }

    private drawSeeker(container: Phaser.GameObjects.Container, entity: WorldEntity): void {
      const accent = seekerThreatAccent(entity.avatar);
      const outline = entity.controlled ? 0x63d6b5 : accent;

      const shadow = this.add.graphics();
      shadow.fillStyle(0x080913, 0.72);
      shadow.fillEllipse(0, 26, 58, 17);

      const aura = this.add.graphics();
      aura.lineStyle(entity.controlled ? 5 : 3, outline, entity.controlled ? 0.78 : 0.42);
      aura.strokeCircle(0, 1, 31);
      aura.lineStyle(2, 0xff435f, 0.55);
      aura.arc(0, 2, 36, Math.PI * 0.12, Math.PI * 0.88, false);
      aura.arc(0, 2, 36, Math.PI * 1.12, Math.PI * 1.88, false);

      const cloak = this.add.graphics();
      cloak.fillStyle(0x10121f, 1);
      cloak.lineStyle(entity.controlled ? 4 : 3, outline, 1);
      cloak.fillTriangle(-28, 28, 28, 28, 0, -4);
      cloak.fillRoundedRect(-23, -22, 46, 49, 13);
      cloak.strokeRoundedRect(-23, -22, 46, 49, 13);

      // 초기 귀여운 밤지기의 뿔과 노란 얼굴은 가면으로 남기고, 망토와 균열을 덧입힌다.
      cloak.fillTriangle(-20, -17, -14, -37, -4, -20);
      cloak.fillTriangle(20, -17, 14, -37, 4, -20);
      cloak.lineBetween(-20, -17, -14, -37);
      cloak.lineBetween(-14, -37, -4, -20);
      cloak.lineBetween(20, -17, 14, -37);
      cloak.lineBetween(14, -37, 4, -20);
      cloak.fillStyle(accent, 0.82);
      cloak.fillTriangle(-22, 3, -36, 13, -21, 17);
      cloak.fillTriangle(22, 3, 36, 13, 21, 17);
      cloak.fillTriangle(-16, 24, -7, 35, -2, 25);
      cloak.fillTriangle(16, 24, 7, 35, 2, 25);

      const mask = this.add.graphics();
      mask.fillStyle(0xffd76a, 0.94);
      mask.lineStyle(2, 0x090a12, 1);
      mask.fillRoundedRect(-15, -13, 30, 27, 10);
      mask.strokeRoundedRect(-15, -13, 30, 27, 10);
      mask.fillStyle(accent, 1);
      mask.fillTriangle(-12, -5, -2, -4, -7, 2);
      mask.fillTriangle(12, -5, 2, -4, 7, 2);
      mask.fillStyle(0xffffff, 0.92);
      mask.fillCircle(-7, -2, 1.4);
      mask.fillCircle(7, -2, 1.4);
      mask.fillStyle(0xff435f, 1);
      mask.fillCircle(0, 4, 2.5);
      mask.lineStyle(2, 0x531326, 1);
      mask.lineBetween(-8, 8, -4, 11);
      mask.lineBetween(-4, 11, 0, 8);
      mask.lineBetween(0, 8, 4, 11);
      mask.lineBetween(4, 11, 8, 8);
      mask.lineStyle(1.5, 0x531326, 0.9);
      mask.lineBetween(-2, -12, 1, -7);
      mask.lineBetween(1, -7, -2, -3);
      mask.lineBetween(-2, -3, 2, 1);

      container.add([shadow, aura, cloak, mask]);

      const badge = this.add.text(0, 39, entity.controlled ? "나 · 밤지기" : entity.displayName ?? "밤지기", {
        color: "#ffffff",
        backgroundColor: "#111321e8",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "11px",
        fontStyle: "bold",
        padding: { x: 5, y: 3 },
      }).setOrigin(0.5, 0);
      badge.setRotation(-container.rotation);
      container.add(badge);
    }

    private drawEffect(effect: GameEffect): Phaser.GameObjects.Container {
      const fallback = this.snapshot
        ? { x: this.snapshot.map.width / 2, y: this.snapshot.map.height / 2 }
        : { x: 12, y: 8 };
      const container = this.add.container((effect.x ?? fallback.x) * TILE, (effect.y ?? fallback.y) * TILE);
      const ring = this.add.graphics();
      const color = effect.type === "correct-tag" || effect.type === "mission" || effect.type === "portal"
        ? 0x63d6b5
        : 0xff6f61;
      ring.lineStyle(4, color, 0.9);
      ring.strokeCircle(0, 0, effect.type === "portal" ? 42 : 31);
      const label = this.add.text(0, -48, effect.label, {
        color: "#ffffff",
        backgroundColor: "#25213add",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "13px",
        fontStyle: "bold",
        padding: { x: 8, y: 5 },
      }).setOrigin(0.5);
      container.add([ring, label]);
      return container;
    }

    private drawPing(ping: TeamPing): Phaser.GameObjects.Container {
      const container = this.add.container(ping.x * TILE, ping.y * TILE);
      const ring = this.add.graphics();
      ring.lineStyle(4, 0x9cb0ff, 0.9);
      ring.strokeCircle(0, 0, 28);
      ring.strokeCircle(0, 0, 38);
      const label = this.add.text(0, -46, pingLabel(ping.kind), {
        color: "#25213a",
        backgroundColor: "#9cb0ff",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        padding: { x: 7, y: 4 },
      }).setOrigin(0.5);
      container.add([ring, label]);
      return container;
    }
  }

  const scene = new NightStationeryScene();
  const game = new PhaserRuntime.Game({
    type: PhaserRuntime.AUTO,
    parent,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    backgroundColor: "#171a33",
    // 빠른 이동에서도 좌표를 정수 픽셀로 강제하지 않아 미세한 떨림을 줄인다.
    render: { antialias: true, pixelArt: false, roundPixels: false },
    scale: {
      mode: PhaserRuntime.Scale.FIT,
      autoCenter: PhaserRuntime.Scale.CENTER_BOTH,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
    },
    scene,
    audio: { noAudio: true },
  });

  return {
    pushSnapshot: (snapshot) => scene.setSnapshot(snapshot),
    setLocalMovement: (movement) => scene.setLocalMovement(movement),
    pushEffect: (effect) => scene.addEffect(effect),
    pushLens: (pulse) => scene.addLens(pulse),
    pushPing: (ping) => scene.addPing(ping),
    destroy: () => {
      parent.classList.remove("preview-camera-active", "preview-camera-dragging");
      game.destroy(true);
    },
  };
}

function entitySignature(entity: WorldEntity): string {
  return [
    entity.category,
    entity.propKind ?? "",
    entity.controlled,
    entity.teammate,
    entity.displayName ?? "",
  ].join(":");
}

function paletteFor(theme: MapTheme | undefined): MapPalette {
  const palettes: Record<MapTheme, MapPalette> = {
    stationery: {
      floor: 0x28304a,
      grid: 0x39435d,
      obstacle: 0x6c4f66,
      obstacleLine: 0x2b233e,
      accent: 0x63d6b5,
      portal: 0x9cb0ff,
    },
    warehouse: {
      floor: 0x24383b,
      grid: 0x385356,
      obstacle: 0x84684c,
      obstacleLine: 0x30281f,
      accent: 0x8ee3cf,
      portal: 0xffc96b,
    },
    workshop: {
      floor: 0x382b46,
      grid: 0x543d62,
      obstacle: 0x7b5578,
      obstacleLine: 0x2c2036,
      accent: 0xff9c91,
      portal: 0xcaa8ff,
    },
  };
  return palettes[theme ?? "stationery"] ?? palettes.stationery;
}

function propColor(kind: PropKind): number {
  return {
    pencil: 0xffd76a,
    notebook: 0x698cff,
    tape: 0x63d6b5,
    eraser: 0xff8f85,
    box: 0xc99b73,
    ribbon: 0xb996f4,
  }[kind];
}

function pingLabel(kind: TeamPing["kind"]): string {
  return {
    check: "여기 확인",
    suspect: "수상해요",
    done: "확인 완료",
    danger: "관찰자 주의",
    moving: "움직임 발견",
  }[kind];
}
