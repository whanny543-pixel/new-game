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
  regen: 5,
  range: 7,
  baseDamage: 16,
  fireDelay: 0.36,
  magnet: 3.6,
  /** Seconds before an uncollected coin flies to the hero by itself. */
  coinAutoCollect: 6,
  respawnTime: 3,
  startGold: 10,
};

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

/** Ballista on an upgraded lookout. */
export const BALLISTA = { damage: 60, delay: 1.6, range: 13, pierce: 4 };
/** The king's Arcane Nova. */
export const NOVA = { killsToCharge: 35, radius: 7.5, damage: 160, knockback: 3.2 };

export const ROAD_HALF_WIDTH = 1.9;

export type PlotKind = 'tower' | 'range' | 'barracks' | 'forge' | 'recruitArcher' | 'recruitKnight' | 'goldmine' | 'wall' | 'castle';

export interface PlotDef {
  id: string;
  kind: PlotKind;
  /** Gold per level. */
  costs: number[];
}

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
  /** Raids to count for crowns when the kingdom is won. */
  waves: number;
  hpMul: number;
  countMul: number;
  /** Dirt trails winding through the forest (decoration). */
  roads: [number, number][][];
  palette: MapPalette;
  /** Position on the world map (0..100). */
  mapX: number;
  mapY: number;
}

/** Old trails through the forest toward the keep. */
const TRAILS: [number, number][][] = [
  [
    [-4, -60],
    [6, -48],
    [-3, -36],
    [4, -24],
    [-2, -14],
    [0, -3],
  ],
  [
    [60, 8],
    [46, 0],
    [34, 6],
    [22, -2],
    [12, 3],
    [3, 0],
  ],
  [
    [-52, 50],
    [-40, 36],
    [-30, 30],
    [-20, 18],
    [-10, 12],
    [-2, 3],
  ],
];

const mirror = (t: [number, number][][]) => t.map((r) => r.map(([x, z]) => [-x, z] as [number, number]));

export const KINGDOMS: KingdomMap[] = [
  {
    id: 'greenvale',
    name: 'Greenvale',
    blurb: 'A wild forest crawling with goblins. They are only testing you.',
    waves: 10,
    hpMul: 1,
    countMul: 0.85,
    roads: TRAILS,
    palette: {
      ground: 0x5d8a4a,
      groundDark: 0x547f43,
      groundLight: 0x689755,
      tufts: [],
      flowers: [],
      decorTint: [1, 1, 1],
      sky: 0x9fd4f2,
      fog: 0xd2e6ee,
      road: 0xdcc596,
      roadEdge: 0xcbb183,
    },
    mapX: 22,
    mapY: 74,
  },
  {
    id: 'amberwood',
    name: 'Amberwood',
    blurb: 'An autumn forest. Bigger warbands, tougher goblins.',
    waves: 12,
    hpMul: 1.3,
    countMul: 1.1,
    roads: mirror(TRAILS),
    palette: {
      ground: 0x7c6a3c,
      groundDark: 0x6a5a30,
      groundLight: 0x8e7a48,
      tufts: [],
      flowers: [],
      decorTint: [1.45, 0.92, 0.5],
      sky: 0xf2d1a0,
      fog: 0xf0d2a8,
      road: 0xe0c08e,
      roadEdge: 0xcca878,
    },
    mapX: 48,
    mapY: 56,
  },
  {
    id: 'ashmoor',
    name: 'Ashmoor',
    blurb: 'A dark, haunted forest at dusk. Huge hordes and more ogres.',
    waves: 14,
    hpMul: 1.5,
    countMul: 1.25,
    roads: TRAILS,
    palette: {
      ground: 0x46503a,
      groundDark: 0x384030,
      groundLight: 0x58624a,
      tufts: [],
      flowers: [],
      decorTint: [0.62, 0.7, 0.78],
      sky: 0x8a86a8,
      fog: 0x9a96b0,
      road: 0x6e604c,
      roadEdge: 0x5c5040,
    },
    mapX: 70,
    mapY: 38,
  },
  {
    id: 'frostpeak',
    name: 'Frostpeak',
    blurb: 'A snowy pine forest. Bring spring back, one land at a time. The final stand.',
    waves: 16,
    hpMul: 1.75,
    countMul: 1.4,
    roads: mirror(TRAILS),
    palette: {
      ground: 0xe6eef5,
      groundDark: 0xc9d6e2,
      groundLight: 0xffffff,
      tufts: [],
      flowers: [],
      decorTint: [1.25, 1.35, 1.5],
      sky: 0xc9dff0,
      fog: 0xdfeaf4,
      road: 0xb8a294,
      roadEdge: 0xa08a7c,
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
  { id: 'scepter', name: 'Scepter', desc: '+10% troop health', max: 4 },
] as const;
export type GearId = (typeof GEAR)[number]['id'];
export const GEAR_COSTS = [20, 45, 80, 130, 200];
/** Crowns earned: per wave survived, and for winning a kingdom. */
export const CROWNS = { perWave: (k: number) => 2 + k, victory: (k: number) => 40 * (k + 1) };
