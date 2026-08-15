import type Phaser from "phaser";
import type {
  GameEffect,
  GameSnapshot,
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
  targetX: number;
  targetY: number;
  targetRotation: number;
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

    constructor() {
      super("night-stationery");
    }

    create(): void {
      this.sceneReady = true;
      this.cameras.main.setBackgroundColor("#171a33");
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

      const blend = 1 - Math.exp(-delta / 55);
      for (const view of this.entityViews.values()) {
        const gap = Math.hypot(view.targetX - view.container.x, view.targetY - view.container.y);
        if (gap > TILE * 4) {
          // 포탈은 긴 거리를 미끄러지지 않고 즉시 도착하게 한다.
          view.container.setPosition(view.targetX, view.targetY);
        } else {
          view.container.x += (view.targetX - view.container.x) * blend;
          view.container.y += (view.targetY - view.container.y) * blend;
        }
        const angleGap = Math.atan2(
          Math.sin(view.targetRotation - view.container.rotation),
          Math.cos(view.targetRotation - view.container.rotation),
        );
        view.container.rotation += angleGap * blend;
      }
    }

    setSnapshot(snapshot: GameSnapshot): void {
      this.snapshot = snapshot;
      if (this.sceneReady) this.applySnapshot(snapshot);
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
      this.reconcileEntities(snapshot.entities);
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

      for (const portal of snapshot.map.portals ?? []) root.add(this.drawPortal(portal, palette.portal));

      const worldWidth = snapshot.map.width * TILE;
      const worldHeight = snapshot.map.height * TILE;
      this.cameras.main.stopFollow();
      this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
      this.cameras.main.centerOn(worldWidth / 2, worldHeight / 2);
      this.followedEntityId = "";
      this.redrawTransients();
    }

    private reconcileEntities(entities: WorldEntity[]): void {
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
        const targetX = entity.x * TILE;
        const targetY = entity.y * TILE;
        const targetRotation = (entity.rotation * Math.PI) / 180;
        let view = this.entityViews.get(entity.id);
        if (!view || view.signature !== signature) {
          const previousPosition = view ? { x: view.container.x, y: view.container.y } : undefined;
          const previousRotation = view?.container.rotation;
          view?.container.destroy(true);
          const container = this.drawEntity(entity);
          container.setPosition(previousPosition?.x ?? targetX, previousPosition?.y ?? targetY);
          container.setRotation(previousRotation ?? targetRotation);
          this.entityWorld.add(container);
          view = { container, signature, targetX, targetY, targetRotation };
          this.entityViews.set(entity.id, view);
        } else {
          view.targetX = targetX;
          view.targetY = targetY;
          view.targetRotation = targetRotation;
        }
        if (entity.controlled) controlledId = entity.id;
      }

      if (controlledId && controlledId !== this.followedEntityId) {
        const controlled = this.entityViews.get(controlledId)?.container;
        if (controlled) {
          this.cameras.main.startFollow(controlled, true, 0.14, 0.14);
          this.followedEntityId = controlledId;
        }
      }
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
      const label = this.add.text(0, -portal.radius * TILE - 10, portal.label, {
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
      container.on("pointerdown", () => callbacks.onTag(entity.id));
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
      const body = this.add.graphics();
      body.fillStyle(0xffd76a, 1);
      body.lineStyle(entity.controlled ? 4 : 2, entity.controlled ? 0x63d6b5 : 0x171a33, 1);
      body.fillRoundedRect(-19, -17, 38, 38, 14);
      body.strokeRoundedRect(-19, -17, 38, 38, 14);
      body.fillTriangle(-15, -14, -10, -30, -2, -17);
      body.fillTriangle(15, -14, 10, -30, 2, -17);
      body.fillStyle(0x25213a, 1);
      body.fillCircle(-6, -2, 3);
      body.fillCircle(6, -2, 3);
      body.fillStyle(0xff6f61, 1);
      body.fillCircle(0, 5, 3);
      body.lineStyle(3, 0x9cb0ff, 0.9);
      body.strokeCircle(0, 1, 25);
      container.add(body);

      const badge = this.add.text(0, 31, entity.controlled ? "나 · 관찰자" : entity.displayName ?? "관찰자", {
        color: "#ffffff",
        backgroundColor: "#25213acc",
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
    render: { antialias: true, pixelArt: false, roundPixels: true },
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
    pushEffect: (effect) => scene.addEffect(effect),
    pushLens: (pulse) => scene.addLens(pulse),
    pushPing: (ping) => scene.addPing(ping),
    destroy: () => game.destroy(true),
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
