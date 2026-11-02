// All gameplay tuning lives here so balancing never requires touching game logic.

export const COLORS = {
  sky: 0xf2c38b,
  fog: 0xe9b57a,
  sand: 0xebc07f,
  sandDark: 0xd9a865,
  sandLight: 0xf5d49c,
  road: 0x8f5532,
  roadEdge: 0xa86c40,
  cliff: 0xd58a56,
  cliffDark: 0xb46a3d,
  cliffLight: 0xe7a46d,
  coin: 0xffc928,
  coinDeep: 0xb07a00,
  steel: 0xcfd6e0,
  steelDark: 0x6f7886,
  team: 0x2f6fd6,
  teamDark: 0x1f4d9a,
  plume: 0xe2343b,
  wood: 0x9b6638,
  woodDark: 0x6a4122,
  woodLight: 0xc08850,
  roof: 0xa33a2a,
  stone: 0xb9b2a6,
  stoneDark: 0x8d867b,
  skin: 0xf2c9a0,
  cactus: 0x6aa84f,
  bush: 0x9a8a4a,
  goblin: 0x6cc13a,
  goblinDark: 0x3f7f22,
  rag: 0xb3402c,
  runner: 0xe0482c,
  troll: 0x7d8c99,
  arrow: 0xfff3c4,
  fire: 0xff9a2e,
  straw: 0xe8cc6a,
} as const;

export const PLAYER = {
  speed: 7,
  maxHp: 150,
  regen: 10,
  range: 8,
  baseDamage: 20,
  fireDelay: 0.3,
  magnet: 3.6,
  /** Seconds before an uncollected coin flies to the hero by itself. */
  coinAutoCollect: 6,
  respawnTime: 3,
  maxVisibleStack: 50,
  maxWeapons: 10,
  startGold: 14,
};

/** Each coin is worth more as waves climb, so late builds still come quickly. */
export const coinValue = (wave: number) => 1 + Math.floor(Math.max(0, wave - 1) / 2);

export const HALL = { maxHp: 1200, regen: 3, radius: 3.4 };

/** Weapon tiers: 0 is what a fresh recruit carries; forge/bowyer levels make 1..3. */
export const SWORD_TIERS = [
  { name: 'Club', damage: 9, color: 0x6a4122 },
  { name: 'Iron Sword', damage: 17, color: 0xcfd6e0 },
  { name: 'Steel Sword', damage: 28, color: 0x8fd3ff },
  { name: 'Gold Sword', damage: 44, color: 0xffc928 },
];
export const BOW_TIERS = [
  { name: 'Shortbow', damage: 14, color: 0x8a5a33 },
  { name: 'Longbow', damage: 23, color: 0x5e3b20 },
  { name: 'Recurve Bow', damage: 35, color: 0x2f6fd6 },
  { name: 'Gold Bow', damage: 52, color: 0xffc928 },
];

export const ARCHER = { range: 9.5, delay: 0.6 };
export const KNIGHT = { maxHp: 110, hpPerTier: 35, delay: 0.75, reach: 1.7, regen: 6 };

/** Watchtower per level: archer slots, and whether a ballista is mounted. */
export const TOWER_LEVELS = [
  { slots: 1, rangeBonus: 0, ballista: false },
  { slots: 2, rangeBonus: 1.5, ballista: false },
  { slots: 2, rangeBonus: 2.5, ballista: true },
];
export const BALLISTA = { damage: 60, delay: 1.6, range: 13, pierce: 4 };
export const POST_LEVELS = [{ slots: 2 }, { slots: 4 }];
export const BARRICADE_HP = [220, 380];

/** Forge / bowyer: seconds per weapon at each level, and rack capacity. */
export const WORKSHOP = { interval: [3.2, 2.2, 1.5], rackMax: 10 };

export type EnemyKind = 'goblin' | 'runner' | 'troll';

export interface EnemyType {
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  coin: number; // expected coins dropped
  boss?: boolean;
}

export const ENEMIES: Record<EnemyKind, EnemyType> = {
  goblin: { hp: 26, speed: 2.5, damage: 7, radius: 0.42, coin: 1 },
  runner: { hp: 16, speed: 4.2, damage: 5, radius: 0.36, coin: 1 },
  troll: { hp: 520, speed: 1.3, damage: 34, radius: 1.05, coin: 20, boss: true },
};

export const WAVES = {
  firstDelay: 2,
  duration: 22,
  breakTime: 3,
  baseCount: 14,
  countPerWave: 7,
  hpGrowth: 0.1,
  roadBWave: 7,
};

// ------------------------------------------------------------------ map

/** Control points of each road, from the wilds to the town hall (north is -z). */
export const ROADS: [number, number][][] = [
  [
    [-5, -52],
    [-13, -43],
    [-14, -33],
    [-4, -26],
    [9, -21],
    [12, -13],
    [5, -7.5],
    [3.6, -3.4],
  ],
  [
    [44, -12],
    [36, -18],
    [26, -16],
    [20, -6],
    [13, 1],
    [6, 2],
    [3.9, 1.2],
  ],
];
export const ROAD_HALF_WIDTH = 1.9;

export type PlotKind =
  | 'tower'
  | 'post'
  | 'barricade'
  | 'range'
  | 'barracks'
  | 'forge'
  | 'bowyer'
  | 'recruitArcher'
  | 'recruitKnight';

/** Where a plot sits: fixed coordinates, or beside/on a road at a fraction of its length. */
export type Place = { x: number; z: number } | { road: number; t: number; side: number; dist: number };

export interface PlotDef {
  id: string;
  kind: PlotKind;
  place: Place;
  costs: number[];
  /** Plot ids that must be built first; "wave:N" waits for wave N. */
  requires: string[];
}

const recruitCosts = (start: number, step: number) => Array.from({ length: 60 }, (_, i) => start + i * step);

export const PLOTS: PlotDef[] = [
  { id: 'tw1', kind: 'tower', place: { road: 0, t: 0.86, side: 1, dist: 3.8 }, costs: [5, 25, 70], requires: [] },
  { id: 'tw2', kind: 'tower', place: { road: 0, t: 0.66, side: -1, dist: 3.8 }, costs: [8, 30, 80], requires: ['tw1'] },
  { id: 'range', kind: 'range', place: { x: -8, z: 3 }, costs: [12], requires: ['tw1'] },
  { id: 'recA', kind: 'recruitArcher', place: { x: -8, z: 8.6 }, costs: recruitCosts(4, 1), requires: ['range'] },
  { id: 'bar1', kind: 'barricade', place: { road: 0, t: 0.79, side: 0, dist: 0 }, costs: [8], requires: ['tw2'] },
  { id: 'gp1', kind: 'post', place: { road: 0, t: 0.74, side: 0, dist: 0 }, costs: [12, 45], requires: ['range'] },
  { id: 'barracks', kind: 'barracks', place: { x: 7.5, z: 7.5 }, costs: [18], requires: ['gp1'] },
  { id: 'recK', kind: 'recruitKnight', place: { x: 11.6, z: 9.8 }, costs: recruitCosts(5, 2), requires: ['barracks'] },
  { id: 'forge', kind: 'forge', place: { x: -9, z: -5 }, costs: [22, 70, 160], requires: ['barracks'] },
  { id: 'tw3', kind: 'tower', place: { road: 0, t: 0.46, side: 1, dist: 3.8 }, costs: [18, 50, 120], requires: ['tw2'] },
  { id: 'bowyer', kind: 'bowyer', place: { x: -2.5, z: 12 }, costs: [22, 70, 160], requires: ['forge'] },
  { id: 'tw4', kind: 'tower', place: { road: 0, t: 0.32, side: -1, dist: 3.8 }, costs: [28, 65, 140], requires: ['tw3'] },
  { id: 'gp2', kind: 'post', place: { road: 0, t: 0.53, side: 0, dist: 0 }, costs: [24, 60], requires: ['tw3'] },
  { id: 'bar2', kind: 'barricade', place: { road: 0, t: 0.58, side: 0, dist: 0 }, costs: [15], requires: ['gp2'] },
  // The east road opens later in the run.
  { id: 'tw5', kind: 'tower', place: { road: 1, t: 0.8, side: 1, dist: 3.8 }, costs: [30, 80, 180], requires: ['wave:7'] },
  { id: 'tw6', kind: 'tower', place: { road: 1, t: 0.55, side: -1, dist: 3.8 }, costs: [40, 95, 200], requires: ['wave:7'] },
  { id: 'gp3', kind: 'post', place: { road: 1, t: 0.68, side: 0, dist: 0 }, costs: [35, 90], requires: ['wave:7'] },
  { id: 'bar3', kind: 'barricade', place: { road: 1, t: 0.74, side: 0, dist: 0 }, costs: [25], requires: ['wave:7'] },
  { id: 'tw7', kind: 'tower', place: { road: 0, t: 0.18, side: 1, dist: 3.8 }, costs: [50, 110, 230], requires: ['tw4', 'wave:8'] },
  { id: 'tw8', kind: 'tower', place: { road: 1, t: 0.32, side: 1, dist: 3.8 }, costs: [55, 120, 240], requires: ['tw6', 'wave:9'] },
];

/** On-road plots (posts, barricades) put their pad beside the road on this side. */
export const ROADSIDE_PAD = { side: -1, dist: 3.6 };
