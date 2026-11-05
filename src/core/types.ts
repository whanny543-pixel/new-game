// Shared type definitions for the whole game: factions, units, buildings, weapons, powers.

export type FactionId = 'coalition' | 'dominion' | 'insurgency';
export type ArmorType = 'infantry' | 'light' | 'tank' | 'air' | 'structure' | 'hero';
export type DamageType =
  | 'gun' | 'cannon' | 'rocket' | 'explosion' | 'flame' | 'sniper' | 'laser' | 'toxin' | 'aa' | 'bomb' | 'crush';
export type MoveType = 'infantry' | 'vehicle' | 'air';
export type ProjectileKind = 'instant' | 'shell' | 'rocket' | 'laser' | 'flame' | 'bomb' | 'toxin';
export type IconKind =
  | 'infantry' | 'rocketinf' | 'sniper' | 'hero' | 'tank' | 'heavytank' | 'truck' | 'artillery' | 'aa' | 'heli' | 'jet'
  | 'bomber' | 'dozer' | 'worker' | 'flame' | 'toxin' | 'bomb' | 'mob' | 'building' | 'power' | 'barracks' | 'factory'
  | 'supply' | 'airfield' | 'turret' | 'tech' | 'super' | 'tunnel' | 'market' | 'trap' | 'speaker' | 'upgrade' | 'plan';

export interface WeaponDef {
  damage: number;
  type: DamageType;
  range: number;
  minRange?: number;
  /** Seconds between shots (or volleys). */
  cooldown: number;
  projectile: ProjectileKind;
  /** Splash radius in world units (0 = single target). */
  splash?: number;
  air?: boolean;
  /** Defaults to true. */
  ground?: boolean;
  /** Shots per volley. */
  burst?: number;
  /** Jets: shots per sortie before they must rearm at an airfield. */
  clip?: number;
  speed?: number;
  /** Seconds the target's engine is disabled (EMP / hero ability). */
  stun?: number;
  /** Leaves a lingering toxin / fire field of this radius for a few seconds. */
  linger?: number;
}

export interface UnitDef {
  id: string;
  name: string;
  faction: FactionId;
  cost: number;
  buildTime: number;
  hp: number;
  armor: ArmorType;
  speed: number;
  move: MoveType;
  radius: number;
  sight: number;
  weapons: WeaponDef[];
  producedAt: string;
  prereq?: string[];
  icon: IconKind;
  model: string;
  desc: string;
  /** Units spawned per build (e.g. a pair of guardsmen). */
  count?: number;
  /** Max alive per player (heroes). */
  limit?: number;
  builder?: boolean;
  /** Credits carried per trip. */
  gather?: number;
  stealth?: boolean;
  detector?: boolean;
  horde?: boolean;
  salvage?: boolean;
  capture?: boolean;
  crush?: boolean;
  /** Explodes on contact with its target. */
  suicide?: boolean;
  /** Credits per second while deployed. */
  hack?: number;
  /** Hovering aircraft stay airborne; jets return to an airfield to rearm. */
  jet?: boolean;
  /** Flight altitude for air units. */
  altitude?: number;
  tier?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  faction: FactionId;
  cost: number;
  buildTime: number;
  hp: number;
  /** Positive produces, negative consumes. */
  power: number;
  size: [number, number];
  sight: number;
  icon: IconKind;
  model: string;
  desc: string;
  weapons?: WeaponDef[];
  prereq?: string[];
  /** Unit ids this building can produce. */
  produces?: string[];
  /** Upgrade ids researched here. */
  upgrades?: string[];
  /** Gatherers return to this building. */
  depot?: boolean;
  /** Units spawned for free when construction finishes. */
  freeUnits?: string[];
  /** Passive income: credits every `interval` seconds. */
  income?: { amount: number; interval: number };
  /** Heals friendly units within radius (fraction of max hp per second). */
  heal?: { radius: number; rate: number };
  superweapon?: { kind: 'lance' | 'nuke' | 'storm'; cooldown: number };
  /** Disabled while the player is low on power. */
  defense?: boolean;
  limit?: number;
  command?: boolean;
  stealth?: boolean;
  detector?: boolean;
  /** Explodes with this damage & radius when destroyed (reactors, traps). */
  deathBlast?: { damage: number; radius: number; type: DamageType };
  /** Detonates itself when an enemy comes within radius (demo trap). */
  trap?: number;
  tunnel?: boolean;
  airfield?: boolean;
  /** Coalition strategy centre battle plans. */
  plans?: boolean;
  capturable?: boolean;
  tier?: number;
}

export type PowerKind =
  | 'reveal' | 'paratroopers' | 'repair' | 'airstrike' | 'fuelair' | 'barrage' | 'cashhack' | 'mines' | 'emp'
  | 'carpet' | 'ambush' | 'bounty' | 'toxinbomb' | 'sneak' | 'scrambler';

export interface PowerDef {
  id: string;
  name: string;
  faction: FactionId;
  kind: PowerKind;
  levels: number;
  cooldown: number;
  rank: number;
  radius: number;
  target: 'point' | 'none';
  desc: string;
  icon: string;
}

export interface UpgradeDef {
  id: string;
  name: string;
  faction: FactionId;
  cost: number;
  time: number;
  at: string;
  desc: string;
  icon: IconKind;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  motto: string;
  desc: string;
  units: UnitDef[];
  buildings: BuildingDef[];
  powers: PowerDef[];
  upgrades: UpgradeDef[];
  builder: string;
  command: string;
  needsPower: boolean;
  /** Palette used by the procedural models. */
  style: { hull: number; accent: number; roof: number; trim: number };
}
