// Entities (units, structures, salvage crates), players and the order types units understand.
import type { BuildingDef, FactionId, PowerDef, UnitDef } from '../core/types';
import { FACTIONS } from '../core/data';
import type { Point } from '../core/path';
import type { SupplyDock } from '../core/map';

export type Order =
  | { type: 'none' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attackmove'; x: number; y: number }
  | { type: 'attack'; target: Entity }
  | { type: 'gather' }
  | { type: 'build'; site: Entity }
  | { type: 'repair'; target: Entity }
  | { type: 'capture'; target: Entity }
  | { type: 'enter'; target: Entity }
  | { type: 'salvage'; target: Entity }
  | { type: 'deploy' }
  | { type: 'return' };

export interface ProductionItem {
  kind: 'unit' | 'upgrade';
  id: string;
  progress: number;
  time: number;
  cost: number;
}

export type BattlePlan = 'bombard' | 'hold' | 'search';

export interface PowerState {
  def: PowerDef;
  level: number;
  cooldown: number;
}

export interface AiMemory {
  difficulty: 'easy' | 'medium' | 'hard';
  timer: number;
  buildIndex: number;
  nextWave: number;
  attackTarget: Entity | null;
  defendUntil: number;
  defendX: number;
  defendY: number;
  attacking: boolean;
  lastDozerOrder: number;
}

export class Player {
  id: number;
  faction: FactionId;
  color: number;
  team: number;
  human: boolean;
  name: string;
  money: number;
  powerProduced = 0;
  powerUsed = 0;
  lowPower = false;
  rank = 1;
  xp = 0;
  points = 0;
  powers = new Map<string, PowerState>();
  upgrades = new Set<string>();
  plan: BattlePlan | null = null;
  tunnelUnits: Entity[] = [];
  reveals: { x: number; y: number; r: number; t: number }[] = [];
  defeated = false;
  ai: AiMemory | null = null;
  stats = { killed: 0, lost: 0, built: 0, spent: 0 };
  /** Active Solar Lance beam. */
  lance: { x: number; y: number; tx: number; ty: number; t: number } | null = null;
  lastAttackedAt = -100;
  lastAttackX = 0;
  lastAttackY = 0;
  lastEva: Record<string, number> = {};

  constructor(id: number, faction: FactionId, color: number, team: number, human: boolean, money: number, name: string) {
    this.id = id;
    this.faction = faction;
    this.color = color;
    this.team = team;
    this.human = human;
    this.money = money;
    this.name = name;
    for (const p of FACTIONS[faction].powers) this.powers.set(p.id, { def: p, level: 0, cooldown: 0 });
  }

  get def() {
    return FACTIONS[this.faction];
  }
  isEnemy(other: Player) {
    return other.team !== this.team;
  }
}

let nextId = 1;

export class Entity {
  id = nextId++;
  kind: 'unit' | 'building' | 'crate';
  udef: UnitDef | null = null;
  bdef: BuildingDef | null = null;
  owner: Player;
  x: number;
  y: number;
  z = 0;
  dir = 0;
  turretDir = 0;
  hp: number;
  maxHp: number;
  radius: number;
  sight: number;
  dead = false;
  deathTime = 0;
  /** Tells renderers which death animation to play. */
  deathKind: 'explode' | 'collapse' | 'crash' | 'quiet' = 'explode';

  // ---- units ----
  order: Order = { type: 'none' };
  queueOrders: Order[] = [];
  path: Point[] | null = null;
  pathGoalX = 0;
  pathGoalY = 0;
  repathTimer = 0;
  stuckTimer = 0;
  target: Entity | null = null;
  retargetTimer = 0;
  cooldowns: number[] = [];
  clip: number[] = [];
  burstLeft: number[] = [];
  burstTimer: number[] = [];
  vet = 0;
  xp = 0;
  cargo = 0;
  dock: SupplyDock | null = null;
  workTimer = 0;
  stealthActive = false;
  detected = false;
  revealTimer = 0;
  scrambleTimer = 0;
  stun = 0;
  deployed = false;
  home: Entity | null = null;
  jetState: 'parked' | 'airborne' | 'landing' = 'parked';
  orbit = 0;
  landing = false;
  salvageLevel = 0;
  moving = false;
  speedMul = 1;
  /** Parachute drop in progress (z above ground). */
  dropping = false;
  groupId = -1;
  lastShot = -10;
  lastDamaged = -10;
  idleTime = 0;

  // ---- buildings ----
  cx = 0;
  cy = 0;
  w = 1;
  h = 1;
  built = true;
  progress = 1;
  production: ProductionItem[] = [];
  rally: Point | null = null;
  incomeTimer = 0;
  swTimer = 0;
  swReady = false;
  captureProgress = 0;
  capturer: Entity | null = null;
  seenMask = 0;
  builders = 0;
  /** Jets parked here. */
  parked: Entity[] = [];
  disabled = false;

  constructor(kind: 'unit' | 'building' | 'crate', owner: Player, x: number, y: number) {
    this.kind = kind;
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.hp = 1;
    this.maxHp = 1;
    this.radius = 0.5;
    this.sight = 4;
  }

  get name() {
    return this.udef?.name ?? this.bdef?.name ?? 'Salvage';
  }
  get isUnit() {
    return this.kind === 'unit';
  }
  get isBuilding() {
    return this.kind === 'building';
  }
  get isAir() {
    return this.udef?.move === 'air';
  }
  get armor() {
    return this.udef?.armor ?? 'structure';
  }
  get weapons() {
    return this.udef?.weapons ?? this.bdef?.weapons ?? [];
  }
  get cost() {
    return this.udef?.cost ?? this.bdef?.cost ?? 0;
  }
  get canAttack() {
    return this.weapons.length > 0 && !this.udef?.suicide;
  }
  get alive() {
    return !this.dead;
  }
  /** Centre of a building footprint / position of a unit. */
  get centerX() {
    return this.x;
  }
  get centerY() {
    return this.y;
  }
  distTo(o: Entity) {
    return Math.hypot(o.x - this.x, o.y - this.y);
  }
  /** Distance between edges (0 when touching). */
  edgeDist(o: Entity) {
    return Math.max(0, this.distTo(o) - this.radius - o.radius);
  }
}
