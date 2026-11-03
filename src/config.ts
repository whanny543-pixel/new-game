// All gameplay tuning lives here so balancing never requires touching game logic.

export const COLORS = {
  sky: 0x9fd4f2,
  fog: 0xb8e0f0,
  /** Ground (meadow grass); the name stays for the road edge blend. */
  sand: 0x79b84a,
  sandDark: 0x5f9c3a,
  sandLight: 0x98d05c,
  road: 0xb07a4a,
  roadEdge: 0xc29262,
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
  maxHp: 120,
  regen: 10,
  range: 7,
  baseDamage: 16,
  fireDelay: 0.36,
  magnet: 3.6,
  /** Seconds before an uncollected coin flies to the hero by itself. */
  coinAutoCollect: 6,
  respawnTime: 3,
  maxVisibleStack: 50,
  maxWeapons: 10,
  startGold: 10,
};

/** Each coin is worth more as waves climb, so late builds still come quickly. */
export const coinValue = (wave: number) => 1 + Math.floor(Math.max(0, wave - 1) / 3);

export const HALL = { maxHp: 1200, regen: 3, radius: 3.4 };

/** Weapon tiers: 0 is what a fresh recruit carries; forge/bowyer levels make 1..3. */
export const SWORD_TIERS = [
  // Colours tint the KayKit textures (white = untinted).
  { name: 'Rusty Sword', damage: 9, color: 0x9c8a74 },
  { name: 'Iron Sword', damage: 17, color: 0xffffff },
  { name: 'Steel Sword', damage: 28, color: 0x8fd0ff },
  { name: 'Gold Sword', damage: 44, color: 0xffcf3d },
];
export const BOW_TIERS = [
  { name: 'Old Crossbow', damage: 14, color: 0x9c8a74 },
  { name: 'Crossbow', damage: 23, color: 0xffffff },
  { name: 'Heavy Crossbow', damage: 35, color: 0x8fd0ff },
  { name: 'Gold Crossbow', damage: 52, color: 0xffcf3d },
];

export const ARCHER = { range: 10, delay: 0.55 };
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
  goblin: { hp: 24, speed: 2.4, damage: 9, radius: 0.42, coin: 1 },
  runner: { hp: 18, speed: 4.2, damage: 8, radius: 0.38, coin: 1 },
  troll: { hp: 520, speed: 1.3, damage: 34, radius: 1.05, coin: 20, boss: true },
};

export const WAVES = {
  firstDelay: 2,
  duration: 22,
  breakTime: 3,
  baseCount: 14,
  countPerWave: 9,
  hpGrowth: 0.13,
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
    [3.0, -2.6],
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
  | 'recruitKnight'
  | 'camp'
  | 'quarry'
  | 'farm'
  | 'goldmine'
  | 'wall'
  | 'castle';

/** Where a plot sits: fixed coordinates, or beside/on a road at a fraction of its length. */
export type Place = { x: number; z: number } | { road: number; t: number; side: number; dist: number };

export interface PlotDef {
  id: string;
  kind: PlotKind;
  place: Place;
  costs: number[];
  /** Kingdom wood / stone needed per level (paid from the stockpile when the gold is in). */
  wood?: number[];
  stone?: number[];
  food?: number[];
  /** Plot ids that must be built first; "wave:N" waits for wave N, "castle:N" for castle level N. */
  requires: string[];
  /** Extra requirement per level, e.g. a stone gate needs castle level 2. */
  levelNeeds?: string[];
  /** Where the pad sits if not on the building itself (gates sit on the road). */
  pad?: Place;
}

const recruitCosts = (start: number, step: number) => Array.from({ length: 60 }, (_, i) => start + i * step);

export const PLOTS: PlotDef[] = [
  { id: 'tw1', kind: 'tower', place: { road: 0, t: 0.86, side: 1, dist: 3.8 }, costs: [5, 30, 80], requires: [] },
  { id: 'tw2', kind: 'tower', place: { road: 0, t: 0.66, side: -1, dist: 3.8 }, costs: [10, 35, 90], requires: ['tw1'] },
  { id: 'range', kind: 'range', place: { x: -8, z: 3 }, costs: [14], requires: ['tw1'] },
  { id: 'recA', kind: 'recruitArcher', place: { x: -8, z: 8.6 }, costs: recruitCosts(5, 1), food: recruitCosts(2, 0), requires: ['range'] },
  { id: 'bar1', kind: 'barricade', place: { road: 0, t: 0.79, side: 0, dist: 0 }, costs: [10], requires: ['tw2'] },
  { id: 'gp1', kind: 'post', place: { road: 0, t: 0.74, side: 0, dist: 0 }, costs: [15, 50], requires: ['range'] },
  { id: 'barracks', kind: 'barracks', place: { x: 7.5, z: 7.5 }, costs: [22], requires: ['gp1'] },
  { id: 'recK', kind: 'recruitKnight', place: { x: 11.6, z: 9.8 }, costs: recruitCosts(6, 2), food: recruitCosts(3, 0), requires: ['barracks'] },
  { id: 'forge', kind: 'forge', place: { x: -9, z: -5 }, costs: [26, 80, 180], requires: ['barracks'] },
  { id: 'tw3', kind: 'tower', place: { road: 0, t: 0.46, side: 1, dist: 3.8 }, costs: [22, 58, 135], requires: ['tw2'] },
  { id: 'bowyer', kind: 'bowyer', place: { x: -2.5, z: 12 }, costs: [26, 80, 180], requires: ['forge'] },
  { id: 'tw4', kind: 'tower', place: { road: 0, t: 0.32, side: -1, dist: 3.8 }, costs: [28, 65, 140], requires: ['tw3'] },
  { id: 'gp2', kind: 'post', place: { road: 0, t: 0.53, side: 0, dist: 0 }, costs: [24, 60], requires: ['tw3'] },
  { id: 'bar2', kind: 'barricade', place: { road: 0, t: 0.58, side: 0, dist: 0 }, costs: [15], requires: ['gp2'] },
  // The east road opens later in the run.
  { id: 'tw5', kind: 'tower', place: { road: 1, t: 0.8, side: 1, dist: 3.8 }, costs: [30, 80, 180], requires: ['roadB'] },
  { id: 'tw6', kind: 'tower', place: { road: 1, t: 0.55, side: -1, dist: 3.8 }, costs: [40, 95, 200], requires: ['roadB'] },
  { id: 'gp3', kind: 'post', place: { road: 1, t: 0.68, side: 0, dist: 0 }, costs: [35, 90], requires: ['roadB'] },
  { id: 'bar3', kind: 'barricade', place: { road: 1, t: 0.74, side: 0, dist: 0 }, costs: [25], requires: ['roadB'] },
  // --- Kingdom ---
  { id: 'camp', kind: 'camp', place: { x: -15, z: -11 }, costs: [22, 65, 150], requires: ['tw1'] },
  { id: 'quarry', kind: 'quarry', place: { x: -19, z: 10 }, costs: [35, 90, 190], wood: [12, 28, 55], requires: ['camp', 'castle'] },
  // One castle plot drives the whole kingdom: castle model, town walls, gates and houses.
  {
    id: 'castle',
    kind: 'castle',
    place: { x: -4.6, z: 4.8 },
    costs: [20, 60, 130, 240, 400],
    wood: [0, 25, 40, 60, 100],
    stone: [0, 0, 30, 80, 150],
    requires: [],
  },
  // Gold mine: miners pile up gold bars for the king to collect.
  { id: 'goldmine', kind: 'goldmine', place: { x: 10.5, z: -4.5 }, costs: [35, 90, 200], wood: [8, 25, 50], requires: ['castle'] },
  { id: 'farm', kind: 'farm', place: { x: -21, z: -2 }, costs: [25, 70, 150], wood: [10, 25, 50], requires: ['range'] },
  { id: 'tw7', kind: 'tower', place: { road: 0, t: 0.18, side: 1, dist: 3.8 }, costs: [50, 110, 230], requires: ['tw4', 'wave:6'] },
  { id: 'tw8', kind: 'tower', place: { road: 1, t: 0.32, side: 1, dist: 3.8 }, costs: [55, 120, 240], requires: ['tw6', 'roadB'] },
];

/** On-road plots (posts, barricades) put their pad beside the road on this side. */
export const ROADSIDE_PAD = { side: -1, dist: 3.6 };

// ------------------------------------------------------------------ kingdom

/** The castle grows from a log camp to a citadel; town walls, gates and houses grow with it. */
export const CASTLE_LEVELS = [
  { name: 'Camp', hp: 900, builders: 1, villagers: 2, walls: 0, radius: 2.2 },
  { name: 'Wooden Hall', hp: 1000, builders: 1, villagers: 3, walls: 1, radius: 2.4 },
  { name: 'Timber Fort', hp: 1400, builders: 2, villagers: 4, walls: 2, radius: 2.8 },
  { name: 'Stone Keep', hp: 1900, builders: 2, villagers: 6, walls: 3, radius: 2.8 },
  { name: 'Castle', hp: 2600, builders: 3, villagers: 8, walls: 4, radius: 3.4 },
  { name: 'Citadel', hp: 3400, builders: 3, villagers: 10, walls: 5, radius: 4 },
];

/** Town wall tiers (index = CASTLE_LEVELS[].walls). Gates exist from tier 2. */
export const WALL_TIERS = [
  { name: 'No walls', wall: '', gate: '', gateHp: 0, archers: 0, coverage: 0 },
  { name: 'Stakes', wall: 'fence_wood_straight', gate: '', gateHp: 0, archers: 0, coverage: 0.35 },
  { name: 'Wooden Palisade', wall: 'fence_wood_straight', gate: 'fence_wood_straight_gate', gateHp: 550, archers: 0, coverage: 1 },
  { name: 'Stone Wall', wall: 'fence_stone_straight', gate: 'fence_stone_straight_gate', gateHp: 1400, archers: 0, coverage: 1 },
  { name: 'Castle Wall', wall: 'wall_straight', gate: 'wall_straight_gate', gateHp: 2700, archers: 2, coverage: 1 },
  { name: 'Citadel Wall', wall: 'wall_straight', gate: 'wall_straight_gate', gateHp: 3600, archers: 2, coverage: 1 },
];
/** Town wall ring around the castle. */
export const TOWN_WALL = { cx: 0, cz: 2.5, r: 16.5 };

export const WORKERS = {
  speed: 3.4,
  chopTime: 2.6,
  woodPerTrip: 4,
  mineTime: 3.2,
  stonePerTrip: 4,
  /** Woodcutters / miners per building level. */
  perLevel: [2, 3, 4],
  harvestTime: 2.4,
  foodPerTrip: 3,
  startFood: 10,
  treeRegrow: 18,
  repairRate: 45, // hp per second per builder
};

/** Active ability: charged by kills, blasts the horde around the hero. */
export const NOVA = { killsToCharge: 35, radius: 7.5, damage: 160, knockback: 3.2 };

// ------------------------------------------------------------------ campaign

export interface MapPalette {
  ground: number;
  groundDark: number;
  groundLight: number;
  tufts: number[];
  flowers: number[];
  /** Multiplies the colours of trees, rocks and hills. */
  decorTint: [number, number, number];
  sky: number;
  fog: number;
  road: number;
  roadEdge: number;
}

export interface KingdomMap {
  id: string;
  name: string;
  blurb: string;
  waves: number;
  hpMul: number;
  countMul: number;
  roadBWave: number;
  roads: [number, number][][];
  palette: MapPalette;
  /** Position on the world map (0..100). */
  mapX: number;
  mapY: number;
}

const MEADOW: MapPalette = {
  ground: 0x79b84a,
  groundDark: 0x5f9c3a,
  groundLight: 0x98d05c,
  tufts: [0x5f9c3a, 0x76b545, 0x8fcb52, 0x4f8a30],
  flowers: [0xffffff, 0xffe066, 0xff8fb1, 0xb69cff, 0xff6b5b],
  decorTint: [1, 1, 1],
  sky: 0x9fd4f2,
  fog: 0xb8e0f0,
  road: 0xb07a4a,
  roadEdge: 0xc29262,
};

export const KINGDOMS: KingdomMap[] = [
  {
    id: 'greenvale',
    name: 'Greenvale',
    blurb: 'Rolling meadows. The goblins are only testing you.',
    waves: 10,
    hpMul: 1,
    countMul: 0.9,
    roadBWave: 7,
    roads: ROADS,
    palette: MEADOW,
    mapX: 22,
    mapY: 74,
  },
  {
    id: 'amberwood',
    name: 'Amberwood',
    blurb: 'An autumn forest. Bigger warbands, and the east road opens sooner.',
    waves: 12,
    hpMul: 1.35,
    countMul: 1.2,
    roadBWave: 5,
    roads: [
      [
        [10, -54],
        [16, -44],
        [6, -36],
        [-8, -32],
        [-6, -24],
        [9, -21],
        [12, -13],
        [5, -7.5],
        [3.0, -2.6],
      ],
      [
        [46, 6],
        [38, -4],
        [28, -12],
        [20, -6],
        [13, 1],
        [6, 2],
        [3.9, 1.2],
      ],
    ],
    palette: {
      ground: 0xb8a24a,
      groundDark: 0x9c7f34,
      groundLight: 0xd2b866,
      tufts: [0xc98a3a, 0xb06a2a, 0xd9a24a, 0x9c7a30],
      flowers: [0xffd34d, 0xff8a3a, 0xffffff, 0xd94a2a],
      decorTint: [1.45, 0.92, 0.5],
      sky: 0xf2d1a0,
      fog: 0xf0c890,
      road: 0x9c6a3c,
      roadEdge: 0xb08050,
    },
    mapX: 48,
    mapY: 56,
  },
  {
    id: 'ashmoor',
    name: 'Ashmoor',
    blurb: 'A bleak moor at dusk. The east road opens early, and the goblins are tougher.',
    waves: 14,
    hpMul: 1.45,
    countMul: 1.25,
    roadBWave: 4,
    roads: [
      [
        [-18, -50],
        [-6, -46],
        [-12, -36],
        [-2, -27],
        [9, -21],
        [12, -13],
        [5, -7.5],
        [3.0, -2.6],
      ],
      [
        [44, -26],
        [34, -26],
        [30, -14],
        [20, -6],
        [13, 1],
        [6, 2],
        [3.9, 1.2],
      ],
    ],
    palette: {
      ground: 0x7a7f63,
      groundDark: 0x5d6150,
      groundLight: 0x939878,
      tufts: [0x6e6a52, 0x857a5a, 0x5a5c48, 0x9a8f6a],
      flowers: [0xb69cff, 0x8a6aff, 0xd6c6ff],
      decorTint: [0.78, 0.8, 0.9],
      sky: 0x8a86a8,
      fog: 0x9a96b0,
      road: 0x6e5a48,
      roadEdge: 0x857060,
    },
    mapX: 70,
    mapY: 38,
  },
  {
    id: 'frostpeak',
    name: 'Frostpeak',
    blurb: 'Snowbound pass beneath the mountains. The final stand.',
    waves: 16,
    hpMul: 1.7,
    countMul: 1.38,
    roadBWave: 3,
    roads: [
      [
        [0, -54],
        [-14, -46],
        [-10, -34],
        [-4, -26],
        [9, -21],
        [12, -13],
        [5, -7.5],
        [3.0, -2.6],
      ],
      [
        [46, -14],
        [38, -20],
        [26, -16],
        [20, -6],
        [13, 1],
        [6, 2],
        [3.9, 1.2],
      ],
    ],
    palette: {
      ground: 0xe6eef5,
      groundDark: 0xc9d6e2,
      groundLight: 0xffffff,
      tufts: [0xb8c8d8, 0xd0dce8, 0x9fb2c4],
      flowers: [0xffffff, 0xcfe8ff],
      decorTint: [1.25, 1.35, 1.5],
      sky: 0xc9dff0,
      fog: 0xdfeaf4,
      road: 0x9a8070,
      roadEdge: 0xb8a294,
    },
    mapX: 82,
    mapY: 16,
  },
];

/** The king's armory: permanent upgrades bought with crowns earned in battle. */
export const GEAR = [
  { id: 'sword', name: 'Royal Sword', desc: '+12% damage', max: 5 },
  { id: 'armor', name: 'Royal Armour', desc: '+15% health', max: 5 },
  { id: 'boots', name: 'Swift Boots', desc: '+5% speed', max: 3 },
  { id: 'banner', name: 'War Banner', desc: '+8% troop damage', max: 5 },
  { id: 'treasury', name: 'Treasury', desc: '+10 starting gold', max: 5 },
  { id: 'scepter', name: 'Scepter', desc: 'Nova charges 12% faster', max: 4 },
] as const;
export type GearId = (typeof GEAR)[number]['id'];
export const GEAR_COSTS = [20, 45, 80, 130, 200];
/** Crowns earned: per wave survived, and for winning a kingdom. */
export const CROWNS = { perWave: (k: number) => 2 + k, victory: (k: number) => 40 * (k + 1) };

/** The kingdom wall: a ring of sections the king builds one by one, upgraded with the castle. */
export const KINGDOM_WALL = {
  cx: 0,
  cz: 2.5,
  r: 15,
  sections: 12,
  /** Goblins leave the roads this far outside the wall and storm it across open ground. */
  assault: 10,
  baseCost: 14,
  costStep: 4,
  hp: { wood: 320, stone: 850, castle: 1600, citadel: 2300 },
};
export const wallTierFor = (castleLevel: number) =>
  castleLevel >= 5 ? 'citadel' : castleLevel >= 4 ? 'castle' : castleLevel >= 3 ? 'stone' : 'wood';

export const GOLD_MINE = { barsPerTrip: 2, barValue: 2, pileMax: 40, mineTime: 3.4 };
