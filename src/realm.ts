// The realm: a wild forest split into fenced lands. Fence a land in completely to claim it:
// the ground turns green, new buildings unlock and the frontier moves out.
// All layout and conquest tuning lives here.

export interface Land {
  id: number;
  name: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Each land is a 20×20 square; the keep sits in the middle of land 0. */
export const LANDS: Land[] = [
  { id: 0, name: 'Kingsfield', x0: -10, z0: -10, x1: 10, z1: 10 },
  { id: 1, name: 'Sunreach', x0: 10, z0: -10, x1: 30, z1: 10 },
  { id: 2, name: 'Northmoor', x0: -10, z0: -30, x1: 10, z1: -10 },
  { id: 3, name: 'Westfold', x0: -30, z0: -10, x1: -10, z1: 10 },
  { id: 4, name: 'Southvale', x0: -10, z0: 10, x1: 10, z1: 30 },
  { id: 5, name: 'Highcrag', x0: 10, z0: -30, x1: 30, z1: -10 },
  { id: 6, name: 'Hollowmere', x0: -30, z0: 10, x1: -10, z1: 30 },
];

/** Fences are built in pieces this long. */
export const FENCE_PIECE = 10;

/** Hero stays inside this square. */
export const BOUNDS = 36;

export type BuildKind = 'range' | 'barracks' | 'forge' | 'lookout' | 'goldmine' | 'castle' | 'recruitArcher' | 'recruitKnight';

export interface BuildSpot {
  id: string;
  kind: BuildKind;
  land: number;
  x: number;
  z: number;
  costs: number[];
  /** Other spots that must be built first. */
  after?: string;
}

/** Where each building goes. Spots appear once their land is open (lookouts) or claimed (the rest). */
export const SPOTS: BuildSpot[] = [
  // Kingsfield: the first archers and their lookouts.
  { id: 'range', kind: 'range', land: 0, x: -5.6, z: 4.6, costs: [8, 40] },
  { id: 'look0a', kind: 'lookout', land: 0, x: 6, z: -6, costs: [12, 45] },
  { id: 'look0b', kind: 'lookout', land: 0, x: -6, z: -6, costs: [16, 50] },
  { id: 'look0c', kind: 'lookout', land: 0, x: 6, z: 6.5, costs: [22, 55] },
  { id: 'castle', kind: 'castle', land: 0, x: 0, z: 6.4, costs: [30, 70, 130, 210, 320] },
  // Sunreach: the forge and gold.
  { id: 'forge', kind: 'forge', land: 1, x: 20, z: 3, costs: [35, 70, 110] },
  { id: 'mine1', kind: 'goldmine', land: 1, x: 20, z: -4, costs: [30, 60] },
  { id: 'look1a', kind: 'lookout', land: 1, x: 26, z: 6, costs: [24, 60] },
  { id: 'look1b', kind: 'lookout', land: 1, x: 26, z: -6, costs: [24, 60] },
  // Northmoor: knights.
  { id: 'barracks', kind: 'barracks', land: 2, x: -3, z: -20, costs: [30, 70] },
  { id: 'look2a', kind: 'lookout', land: 2, x: 6, z: -26, costs: [26, 65] },
  { id: 'look2b', kind: 'lookout', land: 2, x: -6, z: -26, costs: [26, 65] },
  // Westfold.
  { id: 'mine3', kind: 'goldmine', land: 3, x: -19, z: -3, costs: [40, 80] },
  { id: 'look3a', kind: 'lookout', land: 3, x: -26, z: -6, costs: [28, 70] },
  { id: 'look3b', kind: 'lookout', land: 3, x: -26, z: 6, costs: [28, 70] },
  // Southvale.
  { id: 'look4a', kind: 'lookout', land: 4, x: 6, z: 26, costs: [30, 70] },
  { id: 'look4b', kind: 'lookout', land: 4, x: -6, z: 26, costs: [30, 70] },
  { id: 'mine4', kind: 'goldmine', land: 4, x: -1, z: 18, costs: [45, 90] },
  // Highcrag and Hollowmere: the outer marches.
  { id: 'look5a', kind: 'lookout', land: 5, x: 26, z: -26, costs: [34, 80] },
  { id: 'look5b', kind: 'lookout', land: 5, x: 14, z: -26, costs: [34, 80] },
  { id: 'look6a', kind: 'lookout', land: 6, x: -26, z: 26, costs: [34, 80] },
  { id: 'look6b', kind: 'lookout', land: 6, x: -14, z: 26, costs: [34, 80] },
];

/** Recruiting: each payment brings a band of fresh troops. */
export const RECRUIT = {
  archer: { band: 3, cost: 10, step: 5 },
  knight: { band: 2, cost: 18, step: 7 },
  /** Most troops that can march with the king at once. */
  squadMax: 24,
};

export const LOOKOUT = { slots: [3, 5], range: [11, 13] };

/** Fence piece cost: grows with every land already claimed. */
export const fenceCost = (claimed: number) => (claimed === 0 ? 5 : 8 + claimed * 4);
export const FENCE_HP = { wood: 900, stone: 2200, castle: 4000 };

/** Castle level each land needs before the castle can grow past it. */
export const CASTLE_NEEDS = [1, 2, 3, 5, 7];
export const KEEP = [
  { name: 'Log Camp', hp: 700, radius: 2.2 },
  { name: 'Wooden Hall', hp: 1100, radius: 2.6 },
  { name: 'Timber Fort', hp: 1600, radius: 3 },
  { name: 'Stone Keep', hp: 2300, radius: 3.2 },
  { name: 'Castle', hp: 3200, radius: 3.6 },
  { name: 'Citadel', hp: 4200, radius: 4.4 },
];

/** Raids: time between them, size, and when ogre warlords come. Mostly driven by lands held. */
export const ATTACKS = {
  first: 24,
  every: 30,
  base: 10,
  /** Extra goblins per raid survived. */
  perAttack: 2,
  /** Extra goblins per land held. */
  perLand: 13,
  /** Goblin health: +% per land held and per raid. */
  hpPerLand: 0.14,
  hpPerAttack: 0.02,
  bossEvery: 3,
};

/** Forge kits: each one raises a soldier one tier. */
export const FORGE = { interval: [3.6, 2.6, 1.8], rackMax: 8 };
export const TIER_COLORS = [0xffffff, 0x9cc3ff, 0x5b8cff, 0xffcf3d];
export const TIER_NAMES = ['Recruit', 'Iron', 'Steel', 'Royal'];
export const ARCHER_DMG = [12, 19, 28, 40];
export const KNIGHT_DMG = [16, 26, 38, 54];
export const KNIGHT_HP = [90, 130, 180, 240];
export const ARCHER_HP = [45, 65, 90, 120];

export const MINE = { every: 2.6, perLevel: [1, 2], pileMax: 30, barValue: 2 };

/** Loose treasure lying around the forest: walk over it to scoop it up. */
export const TREASURE = { perLand: 2, coins: 7 };
