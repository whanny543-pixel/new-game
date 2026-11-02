// All gameplay tuning lives here so balancing never requires touching game logic.

export const COLORS = {
  sky: 0x8fc7e8,
  fog: 0x9fcbe0,
  ground: 0xc9a46b,
  groundDark: 0xa98450,
  colony: 0x6cbf4a,
  colonyLine: 0x7fd25a,
  colonyEdge: 0xe8f7c0,
  coin: 0xffc928,
  coinDeep: 0xb07a00,
  steel: 0xc9d1dc,
  steelDark: 0x6f7886,
  tabard: 0x2f6fd6,
  plume: 0xe2343b,
  wood: 0x8a5a33,
  woodDark: 0x5e3b20,
  stone: 0xb9b2a6,
  stoneDark: 0x8d867b,
  roof: 0xc4452d,
  rock: 0x9a9184,
  rockDark: 0x7b7367,
  pine: 0x2f7d4a,
  pineDark: 0x245f39,
  skin: 0xf2c9a0,
  goblin: 0x6fbf3a,
  runner: 0xd94f2b,
  troll: 0x6b7f8f,
  arrow: 0xfff3c4,
  squire: 0xf2a33a,
  fire: 0xff9a2e,
} as const;

/** Territory radius for each expansion level. */
export const ZONE_RADII = [8, 13.5, 19, 25];
export const WORLD_RADIUS = 40;
export const SPAWN_RADIUS = 31;

export const PLAYER = {
  speed: 6.8,
  maxHp: 120,
  regen: 14, // hp/s while inside the colony
  range: 7.5,
  baseDamage: 20,
  baseFireDelay: 0.34,
  magnet: 3.4,
  respawnTime: 3,
  maxVisibleStack: 50,
};

/** Hero crossbow damage / fire delay per Forge upgrade level. */
export const FORGE_LEVELS = [
  { damage: 20, delay: 0.34 },
  { damage: 30, delay: 0.3 },
  { damage: 45, delay: 0.26 },
  { damage: 65, delay: 0.22 },
  { damage: 90, delay: 0.18 },
];

/** Squires follow the hero and fire their own crossbows. */
export const SQUIRE = { range: 7, damage: 10, delay: 0.55 };

export const TOWER_LEVELS = [
  { damage: 20, delay: 0.6, range: 9, shots: 1 },
  { damage: 35, delay: 0.45, range: 10, shots: 1 },
  { damage: 55, delay: 0.38, range: 11, shots: 2 },
];

/** The keep at the centre — lose it and the run ends. */
export const KEEP = { maxHp: 700, regen: 4, radius: 2.0 };

export interface EnemyType {
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  reward: number;
  color: number;
  boss?: boolean;
}

export type EnemyKind = 'goblin' | 'runner' | 'troll';

export const ENEMIES: Record<EnemyKind, EnemyType> = {
  goblin: { hp: 32, speed: 2.3, damage: 9, radius: 0.45, reward: 1, color: COLORS.goblin },
  runner: { hp: 20, speed: 4.0, damage: 6, radius: 0.36, reward: 1, color: COLORS.runner },
  troll: { hp: 420, speed: 1.35, damage: 32, radius: 1.05, reward: 18, color: COLORS.troll, boss: true },
};

export type PadKind = 'tower' | 'wall' | 'squire' | 'forge' | 'expand' | 'mine';

export interface WallSpec {
  x: number;
  z: number;
  rot: number;
  len: number;
}

export interface PadDef {
  id: string;
  kind: PadKind;
  x: number;
  z: number;
  /** Cost of each successive level. */
  costs: number[];
  /** Territory level required before the pad appears. */
  zone: number;
  wall?: WallSpec;
}

// Angles are measured clockwise from "north" (-z), which is the top of the screen.
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * r, z: -Math.cos(a) * r };
};

const tower = (id: string, deg: number, r: number, zone: number, costs: number[]): PadDef => ({
  id,
  kind: 'tower',
  ...polar(deg, r),
  costs,
  zone,
});

/** A palisade segment tangent to the territory edge, with its build pad just inside. */
const wall = (id: string, deg: number, zone: number, stepDeg: number, cost: number): PadDef => {
  const R = ZONE_RADII[zone] + 0.4;
  const pad = polar(deg, R - 1.6);
  const c = polar(deg, R);
  const len = 2 * R * Math.sin(((stepDeg / 2) * Math.PI) / 180) + 0.5;
  return {
    id,
    kind: 'wall',
    ...pad,
    costs: [cost],
    zone,
    wall: { x: c.x, z: c.z, rot: (-deg * Math.PI) / 180, len },
  };
};

const walls = (prefix: string, zone: number, from: number, to: number, step: number, cost: number) => {
  const out: PadDef[] = [];
  for (let d = from; d <= to + 0.001; d += step) out.push(wall(`${prefix}${d}`, d, zone, step, cost));
  return out;
};

export const PADS: PadDef[] = [
  // --- Territory level 0 ---
  tower('t0', -38, 5, 0, [8, 40, 110]),
  { id: 'squire', kind: 'squire', x: -3.4, z: 2.6, costs: [15, 45, 100, 200], zone: 0 },
  { id: 'forge', kind: 'forge', x: 3.4, z: 2.6, costs: [20, 60, 140, 280], zone: 0 },
  ...walls('w0_', 0, -50, 50, 50, 14),
  { id: 'e1', kind: 'expand', x: 0, z: 5.6, costs: [40], zone: 0 },

  // --- Territory level 1 ---
  tower('t1a', -45, 10.5, 1, [30, 90, 200]),
  tower('t1b', 45, 10.5, 1, [30, 90, 200]),
  { id: 'm1', kind: 'mine', x: -8.2, z: 5, costs: [45, 120], zone: 1 },
  ...walls('w1_', 1, -70, 70, 35, 28),
  { id: 'e2', kind: 'expand', x: 0, z: 10.8, costs: [130], zone: 1 },

  // --- Territory level 2 ---
  tower('t2a', -12.5, 15.5, 2, [70, 180, 340]),
  tower('t2b', 12.5, 15.5, 2, [70, 180, 340]),
  tower('t2c', -62.5, 15.5, 2, [80, 200, 380]),
  tower('t2d', 62.5, 15.5, 2, [80, 200, 380]),
  { id: 'm2', kind: 'mine', x: 9, z: 9, costs: [100, 240], zone: 2 },
  ...walls('w2_', 2, -100, 100, 25, 45),
  { id: 'e3', kind: 'expand', x: 0, z: 16.2, costs: [320], zone: 2 },

  // --- Territory level 3 ---
  tower('t3a', -30, 21.5, 3, [150, 340, 600]),
  tower('t3b', 30, 21.5, 3, [150, 340, 600]),
  tower('t3c', -90, 21.5, 3, [160, 360, 620]),
  tower('t3d', 90, 21.5, 3, [160, 360, 620]),
  tower('t3e', -150, 21.5, 3, [170, 380, 650]),
  tower('t3f', 150, 21.5, 3, [170, 380, 650]),
  ...walls('w3_', 3, -160, 180, 20, 70),
];

export const WAVES = {
  firstDelay: 4,
  breakTime: 5,
  baseCount: 7,
  countPerWave: 4,
  hpGrowth: 0.17,
  /** Spawn arc half-width in degrees: enemies come from the north first, then from everywhere. */
  arc: (wave: number) => Math.min(180, 30 + wave * 13),
};

export const MINE = { interval: [2.2, 1.2], pileMax: 30 };
export const WALL_HP = [260, 420, 640, 900];
