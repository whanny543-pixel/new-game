// Hero perks offered on level-up. Each pick stacks up to `max` times.

export interface HeroStats {
  damage: number; // multiplier
  fireDelay: number; // multiplier (lower is faster)
  multishot: number; // extra arrows per volley
  chain: number; // extra enemies a lightning arc can jump to
  splash: number; // explosive arrows: fraction of damage dealt around the target
  magnet: number; // pickup range multiplier
  speed: number; // move speed multiplier
  allies: number; // defender damage multiplier
  greed: number; // chance of a bonus coin per kill
  crit: number; // crit chance
  maxHp: number;
}

export const BASE_STATS: HeroStats = {
  damage: 1,
  fireDelay: 1,
  multishot: 0,
  chain: 0,
  splash: 0,
  magnet: 1,
  speed: 1,
  allies: 1,
  greed: 0,
  crit: 0.1,
  maxHp: 150,
};

export type Rarity = 'common' | 'rare' | 'epic';

export interface Perk {
  id: string;
  name: string;
  desc: (level: number) => string;
  rarity: Rarity;
  max: number;
  icon: string; // inline SVG path data, drawn in a 24×24 box
  apply: (s: HeroStats) => void;
}

export const PERKS: Perk[] = [
  {
    id: 'power',
    name: 'Heavy Bolts',
    desc: () => '+20% hero damage',
    rarity: 'common',
    max: 6,
    icon: 'M4 20 16 8l-2-2 4-4 4 4-4 4-2-2L4 20zm-1-4 5 5',
    apply: (s) => (s.damage *= 1.2),
  },
  {
    id: 'rapid',
    name: 'Quick Hands',
    desc: () => 'Fire 15% faster',
    rarity: 'common',
    max: 5,
    icon: 'M13 2 4 14h7l-1 8 9-12h-7z',
    apply: (s) => (s.fireDelay *= 0.85),
  },
  {
    id: 'multi',
    name: 'Volley',
    desc: (l) => `Shoot ${l + 2} bolts at once`,
    rarity: 'rare',
    max: 2,
    icon: 'M3 12h14M3 6l12 3M3 18l12-3M17 12l-3-3m3 3-3 3',
    apply: (s) => (s.multishot += 1),
  },
  {
    id: 'chain',
    name: 'Storm Bolts',
    desc: (l) => `Hits arc lightning to ${l * 2 + 2} enemies`,
    rarity: 'epic',
    max: 4,
    icon: 'M14 2 6 13h5l-2 9 9-12h-5z',
    apply: (s) => (s.chain += 2),
  },
  {
    id: 'splash',
    name: 'Fire Arrows',
    desc: () => 'Hits explode, burning nearby enemies',
    rarity: 'rare',
    max: 4,
    icon: 'M12 2c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z',
    apply: (s) => (s.splash += 0.4),
  },
  {
    id: 'crit',
    name: 'Keen Eye',
    desc: () => '+12% critical hit chance (double damage)',
    rarity: 'common',
    max: 5,
    icon: 'M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
    apply: (s) => (s.crit += 0.12),
  },
  {
    id: 'allies',
    name: 'War Banner',
    desc: () => 'Your archers, knights and ballistas deal +25% damage',
    rarity: 'rare',
    max: 5,
    icon: 'M5 22V2h2v2h12l-3 5 3 5H7v8z',
    apply: (s) => (s.allies *= 1.25),
  },
  {
    id: 'greed',
    name: 'Golden Touch',
    desc: () => '+35% chance of a bonus coin per kill',
    rarity: 'rare',
    max: 4,
    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 4v2h2v2h-4v1h3a2 2 0 0 1 0 4h-1v2h-2v-2H9v-2h4v-1h-3a2 2 0 0 1 0-4h1V6z',
    apply: (s) => (s.greed += 0.35),
  },
  {
    id: 'magnet',
    name: 'Coin Magnet',
    desc: () => 'Pick up gold from 60% farther away',
    rarity: 'common',
    max: 3,
    icon: 'M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3z',
    apply: (s) => (s.magnet *= 1.6),
  },
  {
    id: 'speed',
    name: 'Swift Boots',
    desc: () => 'Move 15% faster',
    rarity: 'common',
    max: 3,
    icon: 'M4 18h16v3H4zm2-3 2-9h4l1 4 5 2v3z',
    apply: (s) => (s.speed *= 1.15),
  },
  {
    id: 'vigor',
    name: 'Iron Will',
    desc: () => '+50% max health, fully healed',
    rarity: 'common',
    max: 3,
    icon: 'M12 21s-8-5-8-11a5 5 0 0 1 8-3 5 5 0 0 1 8 3c0 6-8 11-8 11z',
    apply: (s) => (s.maxHp *= 1.5),
  },
];

const WEIGHT: Record<Rarity, number> = { common: 10, rare: 6, epic: 3 };

/** Three distinct perks the player can still take, weighted by rarity. */
export function rollPerks(owned: Record<string, number>, n = 3): Perk[] {
  const pool = PERKS.filter((p) => (owned[p.id] ?? 0) < p.max);
  const out: Perk[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, p) => a + WEIGHT[p.rarity], 0);
    let r = Math.random() * total;
    let i = 0;
    for (; i < pool.length; i++) {
      r -= WEIGHT[pool[i].rarity];
      if (r <= 0) break;
    }
    out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
  }
  return out;
}

export function xpForLevel(level: number) {
  return 6 + level * 6;
}
