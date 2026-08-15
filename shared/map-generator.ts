import { distance, isBlocked } from "./geometry";
import type { MapLayout, Point, PropKind, StaticProp, Zone } from "./game-types";

const PROP_KINDS: PropKind[] = ["pencil", "notebook", "tape", "eraser", "box", "ribbon"];

export interface GeneratedMap {
  layout: MapLayout;
  staticProps: StaticProp[];
  hiderSpawns: Point[];
  seekerSpawns: Point[];
}

export function createNightStationeryMap(seed: number): GeneratedMap {
  const random = mulberry32(seed);
  const zones: Zone[] = [
    { id: "counter", label: "계산대", x: 4, y: 2.2, radius: 2.2 },
    { id: "notebook", label: "노트 진열대", x: 18, y: 3.1, radius: 2.4 },
    { id: "wrapping", label: "포장 코너", x: 5, y: 13.2, radius: 2.3 },
    { id: "storage", label: "작은 창고", x: 19.2, y: 13, radius: 2.2 },
  ];
  const layout: MapLayout = {
    version: "night-stationery-v1",
    width: 24,
    height: 16,
    obstacles: [
      { id: "shelf-a", x: 3.2, y: 4.1, width: 7.4, height: 0.8 },
      { id: "shelf-b", x: 13.4, y: 4.1, width: 7.4, height: 0.8 },
      { id: "shelf-c", x: 5.2, y: 8.2, width: 5.6, height: 0.8 },
      { id: "shelf-d", x: 13.2, y: 9.1, width: 6.6, height: 0.8 },
      { id: "counter-wall", x: 1.2, y: 6.9, width: 2.6, height: 0.9 },
      { id: "storage-wall", x: 20.5, y: 7.1, width: 2.1, height: 0.9 },
    ],
    zones,
  };

  const staticProps: StaticProp[] = [];
  let attempts = 0;
  while (staticProps.length < 34 && attempts < 2_000) {
    attempts += 1;
    const candidate = {
      x: 0.8 + random() * (layout.width - 1.6),
      y: 0.8 + random() * (layout.height - 1.6),
    };
    if (isBlocked(candidate, 0.42, layout)) continue;
    if (staticProps.some((prop) => distance(prop, candidate) < 0.82)) continue;
    if (distance(candidate, { x: 1.5, y: 14.4 }) < 2.3) continue;

    staticProps.push({
      id: `template-${staticProps.length}`,
      kind: PROP_KINDS[Math.floor(random() * PROP_KINDS.length)],
      x: round(candidate.x),
      y: round(candidate.y),
      rotation: Math.floor(random() * 4) * 90,
    });
  }

  if (staticProps.length < 28) {
    throw new Error("유효한 문구점 사물 배치를 충분히 생성하지 못했습니다.");
  }

  const hiderSpawns = [...staticProps]
    .sort(() => random() - 0.5)
    .slice(0, 10)
    .map((prop) => ({ x: prop.x + 0.55, y: prop.y + 0.2 }));
  const seekerSpawns = [
    { x: 1.4, y: 14.3 },
    { x: 2.4, y: 14.3 },
    { x: 1.9, y: 13.2 },
  ];

  return { layout, staticProps, hiderSpawns, seekerSpawns };
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
