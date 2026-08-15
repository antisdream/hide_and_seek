import { distance, isBlocked } from "./geometry";
import type {
  MapLayout,
  MapTheme,
  Point,
  Portal,
  PropKind,
  Rect,
  StaticProp,
  Zone,
} from "./game-types";

const PROP_KINDS: PropKind[] = ["pencil", "notebook", "tape", "eraser", "box", "ribbon"];

interface MapBlueprint {
  id: string;
  name: string;
  theme: MapTheme;
  width: number;
  height: number;
  propCount: number;
  obstacles: Rect[];
  zones: Zone[];
  portals: Portal[];
  seekerSpawns: Point[];
}

export interface GeneratedMap {
  layout: MapLayout;
  staticProps: StaticProp[];
  hiderSpawns: Point[];
  seekerSpawns: Point[];
}

export interface PortalTransfer extends Point {
  entryId: string;
  targetId: string;
  targetLabel: string;
}

const MAP_BLUEPRINTS: MapBlueprint[] = [
  {
    id: "night-stationery",
    name: "밤의 문구점",
    theme: "stationery",
    width: 34,
    height: 22,
    propCount: 56,
    obstacles: [
      { id: "shelf-a", x: 3, y: 4, width: 10, height: 0.9 },
      { id: "shelf-b", x: 18, y: 4, width: 12.5, height: 0.9 },
      { id: "shelf-c", x: 6, y: 8, width: 8, height: 0.9 },
      { id: "shelf-d", x: 20, y: 8, width: 9.5, height: 0.9 },
      { id: "shelf-e", x: 3, y: 12, width: 6.5, height: 0.9 },
      { id: "shelf-f", x: 13, y: 12, width: 8, height: 0.9 },
      { id: "shelf-g", x: 25, y: 12, width: 6, height: 0.9 },
      { id: "counter", x: 2, y: 17, width: 8, height: 1.2 },
      { id: "center-divider", x: 16, y: 15.2, width: 0.9, height: 5 },
      { id: "stock-table", x: 23, y: 17.2, width: 8, height: 1.1 },
    ],
    zones: [
      { id: "counter-zone", label: "계산대", x: 6, y: 19.7, radius: 2 },
      { id: "notebook-zone", label: "노트 진열대", x: 26, y: 6.4, radius: 2.2 },
      { id: "wrapping-zone", label: "포장 코너", x: 12, y: 15.8, radius: 2.1 },
      { id: "stock-zone", label: "안쪽 창고", x: 29, y: 20, radius: 1.8 },
      { id: "window-zone", label: "창가 전시대", x: 5, y: 2, radius: 1.8 },
    ],
    portals: [
      { id: "front-door", label: "앞문", targetId: "stock-door", x: 1.2, y: 2, radius: 0.8, exit: { x: 1.2, y: 0 } },
      { id: "stock-door", label: "창고문", targetId: "front-door", x: 32.8, y: 19.5, radius: 0.8, exit: { x: -1.2, y: 0 } },
      { id: "counter-gate", label: "계산대 비밀문", targetId: "attic-gate", x: 3.2, y: 20, radius: 0.8, exit: { x: 0, y: -1.2 } },
      { id: "attic-gate", label: "다락문", targetId: "counter-gate", x: 25, y: 1.2, radius: 0.8, exit: { x: 0, y: 1.2 } },
    ],
    seekerSpawns: [{ x: 2.2, y: 20 }, { x: 2.2, y: 21 }, { x: 4.4, y: 21 }],
  },
  {
    id: "moon-warehouse",
    name: "달빛 물류창고",
    theme: "warehouse",
    width: 36,
    height: 24,
    propCount: 62,
    obstacles: [
      { id: "crate-a", x: 4, y: 3.5, width: 7, height: 2 },
      { id: "crate-b", x: 14, y: 3.5, width: 7, height: 2 },
      { id: "crate-c", x: 25, y: 3.5, width: 7, height: 2 },
      { id: "rack-a", x: 5, y: 9, width: 11, height: 1 },
      { id: "rack-b", x: 20, y: 9, width: 11, height: 1 },
      { id: "rack-c", x: 3, y: 14, width: 8, height: 1 },
      { id: "rack-d", x: 14, y: 14, width: 8, height: 1 },
      { id: "rack-e", x: 25, y: 14, width: 8, height: 1 },
      { id: "packing-a", x: 7, y: 19, width: 7, height: 1.4 },
      { id: "packing-b", x: 22, y: 19, width: 7, height: 1.4 },
      { id: "pillar-a", x: 17.5, y: 7, width: 1, height: 4 },
      { id: "pillar-b", x: 17.5, y: 16, width: 1, height: 5 },
    ],
    zones: [
      { id: "receiving-zone", label: "입고장", x: 3, y: 21.5, radius: 1.9 },
      { id: "crate-zone", label: "상자 더미", x: 28, y: 7, radius: 2.1 },
      { id: "packing-zone", label: "포장 작업대", x: 18, y: 22, radius: 1.8 },
      { id: "moon-zone", label: "달빛 창문", x: 33, y: 11.5, radius: 1.8 },
      { id: "forklift-zone", label: "운반 통로", x: 12, y: 12, radius: 1.8 },
    ],
    portals: [
      { id: "loading-door", label: "하역장 문", targetId: "office-door", x: 1.2, y: 2, radius: 0.8, exit: { x: 1.2, y: 0 } },
      { id: "office-door", label: "관리실 문", targetId: "loading-door", x: 34.8, y: 22, radius: 0.8, exit: { x: -1.2, y: 0 } },
      { id: "lift-a", label: "화물 승강기 A", targetId: "lift-b", x: 32.5, y: 7, radius: 0.85, exit: { x: 0, y: 1.3 } },
      { id: "lift-b", label: "화물 승강기 B", targetId: "lift-a", x: 3.5, y: 17, radius: 0.85, exit: { x: 0, y: -1.3 } },
    ],
    seekerSpawns: [{ x: 2.2, y: 22 }, { x: 3.2, y: 22 }, { x: 2.7, y: 21 }],
  },
  {
    id: "ribbon-workshop",
    name: "별빛 포장공방",
    theme: "workshop",
    width: 38,
    height: 24,
    propCount: 66,
    obstacles: [
      { id: "cutting-a", x: 4, y: 4, width: 8, height: 1.5 },
      { id: "cutting-b", x: 16, y: 4, width: 8, height: 1.5 },
      { id: "cutting-c", x: 28, y: 4, width: 6, height: 1.5 },
      { id: "ribbon-a", x: 3, y: 9, width: 6, height: 1 },
      { id: "ribbon-b", x: 12, y: 9, width: 6, height: 1 },
      { id: "ribbon-c", x: 21, y: 9, width: 6, height: 1 },
      { id: "ribbon-d", x: 30, y: 9, width: 5, height: 1 },
      { id: "work-a", x: 6, y: 14, width: 9, height: 1.4 },
      { id: "work-b", x: 22, y: 14, width: 9, height: 1.4 },
      { id: "display-a", x: 3, y: 19, width: 7, height: 1 },
      { id: "display-b", x: 15, y: 19, width: 8, height: 1 },
      { id: "display-c", x: 28, y: 19, width: 7, height: 1 },
      { id: "center-pillar", x: 18.5, y: 11.5, width: 1, height: 5 },
    ],
    zones: [
      { id: "ribbon-zone", label: "리본 벽", x: 5, y: 12, radius: 1.9 },
      { id: "starlight-zone", label: "별빛 작업대", x: 19, y: 2, radius: 1.8 },
      { id: "gift-zone", label: "선물 진열장", x: 33, y: 17, radius: 2.1 },
      { id: "paper-zone", label: "포장지 서랍", x: 14, y: 22, radius: 1.8 },
      { id: "sample-zone", label: "샘플 선반", x: 29, y: 12, radius: 1.8 },
    ],
    portals: [
      { id: "curtain-a", label: "푸른 커튼", targetId: "curtain-b", x: 1.2, y: 2, radius: 0.8, exit: { x: 1.2, y: 0 } },
      { id: "curtain-b", label: "붉은 커튼", targetId: "curtain-a", x: 36.8, y: 22, radius: 0.8, exit: { x: -1.2, y: 0 } },
      { id: "paper-tunnel", label: "포장지 통로", targetId: "ribbon-tunnel", x: 11, y: 22.5, radius: 0.85, exit: { x: 0, y: -1.3 } },
      { id: "ribbon-tunnel", label: "리본 통로", targetId: "paper-tunnel", x: 27, y: 1.2, radius: 0.85, exit: { x: 0, y: 1.3 } },
    ],
    seekerSpawns: [{ x: 2.2, y: 22 }, { x: 3.2, y: 22 }, { x: 2.7, y: 21 }],
  },
];

export const MAP_CATALOG = MAP_BLUEPRINTS.map(({ id, name, theme }) => ({ id, name, theme }));

export function createMapForRound(seed: number, round: number): GeneratedMap {
  const index = ((round - 1) % MAP_BLUEPRINTS.length + MAP_BLUEPRINTS.length) % MAP_BLUEPRINTS.length;
  return createMap(MAP_BLUEPRINTS[index], seed);
}

/** 기존 호출부와 테스트를 위한 첫 번째 맵 생성 함수다. */
export function createNightStationeryMap(seed: number): GeneratedMap {
  return createMap(MAP_BLUEPRINTS[0], seed);
}

export function findPortalTransfer(point: Point, layout: MapLayout): PortalTransfer | undefined {
  const entry = layout.portals.find((portal) => distance(point, portal) <= portal.radius);
  if (!entry) return undefined;
  const target = layout.portals.find((portal) => portal.id === entry.targetId);
  if (!target) return undefined;
  return {
    entryId: entry.id,
    targetId: target.id,
    targetLabel: target.label,
    x: target.x + target.exit.x,
    y: target.y + target.exit.y,
  };
}

export function pickPropKind(seed: number, index: number): PropKind {
  const random = mulberry32(seed + index * 7_919);
  return PROP_KINDS[Math.floor(random() * PROP_KINDS.length)];
}

export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createMap(blueprint: MapBlueprint, seed: number): GeneratedMap {
  const random = mulberry32(seed);
  const layout: MapLayout = {
    id: blueprint.id,
    name: blueprint.name,
    theme: blueprint.theme,
    version: `${blueprint.id}-v2`,
    width: blueprint.width,
    height: blueprint.height,
    obstacles: blueprint.obstacles.map((obstacle) => ({ ...obstacle })),
    zones: blueprint.zones.map((zone) => ({ ...zone })),
    portals: blueprint.portals.map((portal) => ({ ...portal, exit: { ...portal.exit } })),
  };

  const staticProps: StaticProp[] = [];
  let attempts = 0;
  while (staticProps.length < blueprint.propCount && attempts < 8_000) {
    attempts += 1;
    const candidate = {
      x: 0.8 + random() * (layout.width - 1.6),
      y: 0.8 + random() * (layout.height - 1.6),
    };
    if (isBlocked(candidate, 0.42, layout)) continue;
    if (layout.portals.some((portal) => distance(portal, candidate) < 1.7)) continue;
    if (blueprint.seekerSpawns.some((spawn) => distance(spawn, candidate) < 2.2)) continue;
    if (staticProps.some((prop) => distance(prop, candidate) < 0.84)) continue;

    staticProps.push({
      id: `${blueprint.id}-template-${staticProps.length}`,
      kind: PROP_KINDS[Math.floor(random() * PROP_KINDS.length)],
      x: round(candidate.x),
      y: round(candidate.y),
      rotation: Math.floor(random() * 4) * 90,
    });
  }

  if (staticProps.length < blueprint.propCount) {
    throw new Error(`${blueprint.name}의 사물 배치를 충분히 생성하지 못했습니다.`);
  }

  const hiderSpawns = buildHiderSpawns(staticProps, layout, random);
  if (hiderSpawns.length < 10) {
    throw new Error(`${blueprint.name}의 숨는 역할 시작 지점을 충분히 만들지 못했습니다.`);
  }

  return {
    layout,
    staticProps,
    hiderSpawns,
    seekerSpawns: blueprint.seekerSpawns.map((spawn) => ({ ...spawn })),
  };
}

function buildHiderSpawns(staticProps: StaticProp[], layout: MapLayout, random: () => number): Point[] {
  const shuffled = staticProps
    .map((prop) => ({ prop, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ prop }) => prop);
  const offsets: Point[] = [
    { x: 0.62, y: 0 },
    { x: -0.62, y: 0 },
    { x: 0, y: 0.62 },
    { x: 0, y: -0.62 },
  ];
  const spawns: Point[] = [];
  for (const prop of shuffled) {
    const offsetStart = Math.floor(random() * offsets.length);
    for (let index = 0; index < offsets.length; index += 1) {
      const offset = offsets[(offsetStart + index) % offsets.length];
      const candidate = { x: prop.x + offset.x, y: prop.y + offset.y };
      if (isBlocked(candidate, 0.36, layout)) continue;
      if (layout.portals.some((portal) => distance(portal, candidate) < 1.3)) continue;
      if (spawns.some((spawn) => distance(spawn, candidate) < 0.9)) continue;
      spawns.push({ x: round(candidate.x), y: round(candidate.y) });
      break;
    }
    if (spawns.length >= 10) break;
  }
  return spawns;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
