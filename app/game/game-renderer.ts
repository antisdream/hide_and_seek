import type Phaser from "phaser";
import type {
  GameEffect,
  GameSnapshot,
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

const TILE = 40;

/**
 * Phaser는 브라우저에서만 불러와 서버 렌더링 단계의 Canvas 접근을 막는다.
 * 모든 사물은 동일한 그리기 경로를 사용해 숨은 이용자만 식별되는 정보 누출을 피한다.
 */
export async function mountGameRenderer(
  parent: HTMLElement,
  callbacks: RendererCallbacks,
): Promise<GameRenderer> {
  const PhaserRuntime = (await import("phaser")).default;

  class NightStationeryScene extends PhaserRuntime.Scene {
    private snapshot?: GameSnapshot;
    private world?: Phaser.GameObjects.Container;
    private sceneReady = false;
    private readonly effects: Array<GameEffect & { expiresAt: number }> = [];
    private readonly pings: Array<TeamPing & { expiresAt: number }> = [];
    private lens?: LensPulse;

    constructor() {
      super("night-stationery");
    }

    create(): void {
      this.sceneReady = true;
      this.cameras.main.setBackgroundColor("#171a33");
      if (this.snapshot) this.redraw();
      else this.drawWaitingBoard();
    }

    update(): void {
      const now = Date.now();
      const beforeEffects = this.effects.length;
      const beforePings = this.pings.length;
      while (this.effects[0] && this.effects[0].expiresAt <= now) this.effects.shift();
      while (this.pings[0] && this.pings[0].expiresAt <= now) this.pings.shift();
      if (this.lens && this.lens.expiresAt <= now) this.lens = undefined;
      if (beforeEffects !== this.effects.length || beforePings !== this.pings.length) this.redraw();
    }

    setSnapshot(snapshot: GameSnapshot): void {
      this.snapshot = snapshot;
      if (this.sceneReady) this.redraw();
    }

    addEffect(effect: GameEffect): void {
      this.effects.push({ ...effect, expiresAt: Date.now() + 1_900 });
      if (this.sceneReady) this.redraw();
    }

    addLens(pulse: LensPulse): void {
      this.lens = pulse;
      if (this.sceneReady) this.redraw();
    }

    addPing(ping: TeamPing): void {
      this.pings.push({ ...ping, expiresAt: Date.now() + 2_400 });
      if (this.sceneReady) this.redraw();
    }

    private redraw(): void {
      this.world?.destroy(true);
      if (!this.snapshot) {
        this.drawWaitingBoard();
        return;
      }

      const snapshot = this.snapshot;
      const root = this.add.container(0, 0);
      this.world = root;
      root.add(this.drawFloor(snapshot.map.width, snapshot.map.height));

      for (const zone of snapshot.map.zones) {
        const ring = this.add.graphics();
        ring.lineStyle(2, 0x63d6b5, snapshot.self.role === "HIDER" ? 0.55 : 0.16);
        ring.strokeCircle(zone.x * TILE, zone.y * TILE, zone.radius * TILE);
        root.add(ring);
        if (snapshot.self.role === "HIDER") {
          const label = this.add.text(zone.x * TILE, zone.y * TILE - zone.radius * TILE, zone.label, {
            color: "#d7fff4",
            fontFamily: "Pretendard, sans-serif",
            fontSize: "13px",
            fontStyle: "bold",
            backgroundColor: "#263d48cc",
            padding: { x: 6, y: 3 },
          }).setOrigin(0.5, 1);
          root.add(label);
        }
      }

      for (const obstacle of snapshot.map.obstacles) {
        const shelf = this.add.graphics();
        shelf.fillStyle(0x6c4f66, 1);
        shelf.fillRoundedRect(
          obstacle.x * TILE,
          obstacle.y * TILE,
          obstacle.width * TILE,
          obstacle.height * TILE,
          8,
        );
        shelf.lineStyle(3, 0x2b233e, 1);
        shelf.strokeRoundedRect(
          obstacle.x * TILE,
          obstacle.y * TILE,
          obstacle.width * TILE,
          obstacle.height * TILE,
          8,
        );
        root.add(shelf);
      }

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

      for (const entity of snapshot.entities) root.add(this.drawEntity(entity));
      for (const ping of this.pings) root.add(this.drawPing(ping));
      for (const effect of this.effects) root.add(this.drawEffect(effect));
    }

    private drawWaitingBoard(): void {
      this.world?.destroy(true);
      const root = this.add.container(0, 0);
      this.world = root;
      root.add(this.drawFloor(24, 16));
      const title = this.add.text(480, 292, "수상한 잡화점을 정리하는 중…", {
        color: "#fff9ec",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "26px",
        fontStyle: "bold",
      }).setOrigin(0.5);
      const note = this.add.text(480, 332, "소리 없이도 모든 단서를 확인할 수 있어요", {
        color: "#aeb7cf",
        fontFamily: "Pretendard, sans-serif",
        fontSize: "15px",
      }).setOrigin(0.5);
      root.add([title, note]);
    }

    private drawFloor(width: number, height: number): Phaser.GameObjects.Graphics {
      const floor = this.add.graphics();
      floor.fillStyle(0x28304a, 1);
      floor.fillRect(0, 0, width * TILE, height * TILE);
      floor.lineStyle(1, 0x39435d, 0.65);
      for (let x = 0; x <= width; x += 1) floor.lineBetween(x * TILE, 0, x * TILE, height * TILE);
      for (let y = 0; y <= height; y += 1) floor.lineBetween(0, y * TILE, width * TILE, y * TILE);
      floor.lineStyle(5, 0x15182c, 1);
      floor.strokeRect(2, 2, width * TILE - 4, height * TILE - 4);
      return floor;
    }

    private drawEntity(entity: WorldEntity): Phaser.GameObjects.Container {
      const container = this.add.container(entity.x * TILE, entity.y * TILE);
      if (entity.category === "seeker") {
        this.drawSeeker(container, entity);
      } else {
        this.drawProp(container, entity.propKind ?? "notebook", entity);
      }
      container.setRotation((entity.rotation * Math.PI) / 180);
      container.setSize(42, 42).setInteractive({ useHandCursor: true });
      container.on("pointerdown", () => callbacks.onTag(entity.id));
      return container;
    }

    private drawProp(
      container: Phaser.GameObjects.Container,
      kind: PropKind,
      entity: WorldEntity,
    ): void {
      const color = propColor(kind);
      const body = this.add.graphics();
      body.fillStyle(color, 1);
      body.lineStyle(entity.controlled ? 4 : entity.teammate ? 3 : 2, entity.controlled ? 0xffd76a : entity.teammate ? 0x63d6b5 : 0x171a33, 1);

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

      // 모든 사물에 같은 표정을 그려 캐릭터성은 살리고 정답 표시는 막는다.
      const face = this.add.graphics();
      face.fillStyle(0x24213a, 1);
      face.fillCircle(-5, -1, 2);
      face.fillCircle(5, -1, 2);
      face.lineStyle(1.5, 0x24213a, 1);
      face.arc(0, 4, 4, 0.2, Math.PI - 0.2, false);
      container.add(face);

      if (entity.controlled || entity.teammate) {
        const marker = this.add.text(0, -34, entity.controlled ? "나" : "짝", {
          color: "#25213a",
          backgroundColor: entity.controlled ? "#ffd76a" : "#63d6b5",
          fontFamily: "Pretendard, sans-serif",
          fontSize: "11px",
          fontStyle: "bold",
          padding: { x: 5, y: 3 },
        }).setOrigin(0.5);
        container.add(marker);
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
      badge.setRotation((-entity.rotation * Math.PI) / 180);
      container.add(badge);
    }

    private drawEffect(effect: GameEffect): Phaser.GameObjects.Container {
      const x = (effect.x ?? 12) * TILE;
      const y = (effect.y ?? 1.3) * TILE;
      const container = this.add.container(x, y);
      const ring = this.add.graphics();
      const color = effect.type === "correct-tag" || effect.type === "mission" ? 0x63d6b5 : 0xff6f61;
      ring.lineStyle(4, color, 0.9);
      ring.strokeCircle(0, 0, 31);
      const label = this.add.text(0, -42, effect.label, {
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
    width: 24 * TILE,
    height: 16 * TILE,
    backgroundColor: "#171a33",
    render: { antialias: true, pixelArt: false, roundPixels: true },
    scale: {
      mode: PhaserRuntime.Scale.FIT,
      autoCenter: PhaserRuntime.Scale.CENTER_BOTH,
      width: 24 * TILE,
      height: 16 * TILE,
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
