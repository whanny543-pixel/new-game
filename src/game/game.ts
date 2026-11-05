// The simulation. Owns the map, players and entities and advances them each tick. Combat,
// powers and AI live in their own modules and are driven from here.
import { BUILDINGS, DERRICK, FACTIONS, START_CASH, UNITS, UPGRADES, VET_XP, RANK_XP, RANK_POINTS } from '../core/data';
import type { BuildingDef, FactionId, UnitDef, UpgradeDef } from '../core/types';
import { GameMap, MAPS, type MapSpec, type SupplyDock } from '../core/map';
import { findPath, type Point } from '../core/path';
import { clamp, dist, Rng, turnToward, TAU } from '../core/math';
import { Entity, Player, type Order, type BattlePlan } from './entity';
import { updateCombat, type Projectile, type Field, applyDamage } from './combat';
import { updatePowers, usePower, fireSuperweapon, type Flyer } from './powers';
import { updateAi } from './ai';
import { Fog } from './fog';

export type GameEvent =
  | { kind: 'tracer'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; style: 'gun' | 'aa' | 'laser' | 'sniper' | 'hack' }
  | { kind: 'muzzle'; x: number; y: number; z: number; big?: boolean }
  | { kind: 'explosion'; x: number; y: number; z: number; size: number; style: 'blast' | 'fire' | 'toxin' | 'nuke' | 'flash' | 'emp' | 'smoke' | 'rad' | 'spark' | 'lance' | 'crash' }
  | { kind: 'flame'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; style: 'fire' | 'toxin' }
  | { kind: 'death'; entity: Entity }
  | { kind: 'eva'; player: Player; msg: string }
  | { kind: 'sound'; name: string; x: number; y: number }
  | { kind: 'spawn'; entity: Entity }
  | { kind: 'captured'; entity: Entity }
  | { kind: 'shake'; amount: number }
  | { kind: 'power'; player: Player; id: string; x: number; y: number }
  | { kind: 'superweapon'; player: Player; what: 'lance' | 'nuke' | 'storm'; x: number; y: number }
  | { kind: 'rankup'; player: Player };

export interface PlayerSetup {
  faction: FactionId;
  human: boolean;
  team: number;
  difficulty: 'easy' | 'medium' | 'hard';
  name: string;
}

export interface GameSettings {
  mapId: string;
  players: PlayerSetup[];
  startCash: number;
  /** Superweapons allowed. */
  superweapons: boolean;
}

/** Bucketed lookup of entities by position. Rebuilt every tick. */
class SpatialHash {
  private cell = 4;
  private cols: number;
  private rows: number;
  private buckets: Entity[][];
  constructor(w: number, h: number) {
    this.cols = Math.ceil(w / this.cell) + 1;
    this.rows = Math.ceil(h / this.cell) + 1;
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }
  clear() {
    for (const b of this.buckets) b.length = 0;
  }
  insert(e: Entity) {
    const cx = clamp((e.x / this.cell) | 0, 0, this.cols - 1), cy = clamp((e.y / this.cell) | 0, 0, this.rows - 1);
    this.buckets[cy * this.cols + cx].push(e);
  }
  /** Entities whose centre is within r (plus their radius) of (x, y). */
  query(x: number, y: number, r: number, out: Entity[] = []): Entity[] {
    out.length = 0;
    const rr = r + 1.6;
    const x0 = clamp(((x - rr) / this.cell) | 0, 0, this.cols - 1), x1 = clamp(((x + rr) / this.cell) | 0, 0, this.cols - 1);
    const y0 = clamp(((y - rr) / this.cell) | 0, 0, this.rows - 1), y1 = clamp(((y + rr) / this.cell) | 0, 0, this.rows - 1);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[cy * this.cols + cx];
        for (let i = 0; i < b.length; i++) {
          const e = b[i];
          const d = Math.hypot(e.x - x, e.y - y) - e.radius;
          if (d <= r) out.push(e);
        }
      }
    return out;
  }
}

export class Game {
  map: GameMap;
  spec: MapSpec;
  players: Player[] = [];
  entities: Entity[] = [];
  byId = new Map<number, Entity>();
  projectiles: Projectile[] = [];
  fields: Field[] = [];
  flyers: Flyer[] = [];
  events: GameEvent[] = [];
  time = 0;
  rng: Rng;
  spatial: SpatialHash;
  fogs = new Map<number, Fog>();
  result: { winner: number | null; over: boolean } = { winner: null, over: false };
  settings: GameSettings;
  private scratch: Entity[] = [];
  private tickCount = 0;
  private pathBudget = 0;
  /** Credits earned/spent log for the human (for the score screen). */
  humanPlayer: Player | null = null;

  constructor(settings: GameSettings) {
    this.settings = settings;
    this.spec = MAPS.find((m) => m.id === settings.mapId) ?? MAPS[0];
    this.map = new GameMap(this.spec);
    this.rng = new Rng(this.spec.seed * 31 + 7);
    this.spatial = new SpatialHash(this.map.w, this.map.h);
    const neutral = new Player(-1, 'coalition', 5, -1, false, 0, 'Neutral');
    this.players.push(neutral);
    const slots = this.map.starts.slice();
    settings.players.forEach((ps, i) => {
      const p = new Player(i, ps.faction, i, ps.team, ps.human, settings.startCash, ps.name);
      if (!ps.human) {
        p.ai = { difficulty: ps.difficulty, timer: 0, buildIndex: 0, nextWave: 240, attackTarget: null, defendUntil: 0, defendX: 0, defendY: 0, attacking: false, lastDozerOrder: 0 };
        if (ps.difficulty === 'hard') p.money = Math.round(p.money * 1.25);
      } else {
        this.humanPlayer = p;
        this.fogs.set(p.id, new Fog(this.map));
      }
      this.players.push(p);
      const st = slots[i % slots.length];
      this.spawnStart(p, st.x, st.y);
    });
    // Supply docks block the ground.
    for (const d of this.map.docks) this.map.occupy(d.x, d.y, 2, 2, -1);
    for (const d of this.map.derricks) {
      const b = this.placeBuilding(neutral, DERRICK, d.x, d.y, true);
      if (b) b.seenMask = 0xff;
    }
    for (const f of this.fogs.values()) f.update(this, this.playerById(0)!, true);
  }

  get playersAlive() {
    return this.players.filter((p) => p.id >= 0 && !p.defeated);
  }
  playerById(id: number) {
    return this.players.find((p) => p.id === id) ?? null;
  }
  get human() {
    return this.humanPlayer;
  }

  // ------------------------------------------------------------------ setup helpers
  private spawnStart(p: Player, x: number, y: number) {
    const f = FACTIONS[p.faction];
    const cdef = BUILDINGS[f.command];
    const cc = this.placeBuilding(p, cdef, x - 3, y - 3, true)!;
    cc.seenMask = 1 << (p.id & 7);
    const b = this.spawnUnit(p, f.builder, x, y + 5);
    if (b && p.faction === 'insurgency') {
      this.spawnUnit(p, f.builder, x + 2, y + 5);
      this.spawnUnit(p, f.builder, x - 2, y + 5);
    } else if (b) {
      this.spawnUnit(p, f.builder, x + 3, y + 5);
    }
  }

  spawnUnit(p: Player, defId: string, x: number, y: number, opts: { vet?: number; z?: number; dropping?: boolean } = {}) {
    const def = UNITS[defId];
    if (!def) return null;
    let px = x, py = y;
    if (def.move !== 'air') {
      const c = this.map.nearestFree(x, y, 14);
      if (!c) return null;
      px = c.x + 0.5;
      py = c.y + 0.5;
    }
    const e = new Entity('unit', p, px, py);
    e.udef = def;
    e.maxHp = def.hp;
    e.hp = def.hp;
    e.radius = def.radius;
    e.sight = def.sight;
    e.cooldowns = def.weapons.map(() => 0);
    e.clip = def.weapons.map((w) => w.clip ?? Infinity);
    e.burstLeft = def.weapons.map(() => 0);
    e.burstTimer = def.weapons.map(() => 0);
    e.dir = this.rng.range(0, TAU);
    e.turretDir = e.dir;
    e.vet = opts.vet ?? 0;
    e.xp = VET_XP[e.vet];
    e.stealthActive = !!def.stealth;
    if (def.move === 'air') {
      e.z = opts.z ?? def.altitude ?? 6;
      e.jetState = 'airborne';
      if (def.jet) e.order = { type: 'return' };
    }
    if (opts.dropping) {
      e.dropping = true;
      e.z = opts.z ?? 14;
    }
    this.entities.push(e);
    this.byId.set(e.id, e);
    this.events.push({ kind: 'spawn', entity: e });
    return e;
  }

  /** Create a structure. `instant` skips construction. Returns null if it does not fit. */
  placeBuilding(p: Player, def: BuildingDef, cx: number, cy: number, instant: boolean) {
    const [w, h] = def.size;
    if (!instant && !this.map.canPlace(cx, cy, w, h)) return null;
    const e = new Entity('building', p, cx + w / 2, cy + h / 2);
    e.bdef = def;
    e.cx = cx;
    e.cy = cy;
    e.w = w;
    e.h = h;
    e.maxHp = def.hp;
    e.radius = Math.max(w, h) / 2;
    e.sight = def.sight;
    e.built = instant;
    e.progress = instant ? 1 : 0;
    e.hp = instant ? def.hp : def.hp * 0.1;
    e.cooldowns = (def.weapons ?? []).map(() => 0);
    e.clip = (def.weapons ?? []).map(() => Infinity);
    e.burstLeft = (def.weapons ?? []).map(() => 0);
    e.burstTimer = (def.weapons ?? []).map(() => 0);
    e.stealthActive = !!def.stealth;
    e.deathKind = 'collapse';
    e.z = this.map.heightAt(e.x, e.y);
    if (def.superweapon) e.swTimer = def.superweapon.cooldown;
    if (!def.trap && def.id !== 'n_mine') {
      this.map.occupy(cx, cy, w, h, e.id);
      // Shove ground units out of the footprint.
      for (const u of this.entities) {
        if (!u.isUnit || u.dead || u.isAir) continue;
        if (u.x >= cx && u.x < cx + w && u.y >= cy && u.y < cy + h) this.unstick(u);
      }
    }
    // Flatten the ground under the footprint so the model sits level.
    const s = this.map.w + 1;
    const hz = this.map.heightAt(e.x, e.y);
    for (let j = cy - 1; j <= cy + h + 1; j++)
      for (let i = cx - 1; i <= cx + w + 1; i++) if (i >= 0 && j >= 0 && i <= this.map.w && j <= this.map.h) this.map.height[j * s + i] = hz;
    e.z = hz;
    this.entities.push(e);
    this.byId.set(e.id, e);
    this.events.push({ kind: 'spawn', entity: e });
    if (instant && def.freeUnits) for (const u of def.freeUnits) this.spawnUnit(p, u, e.x, e.cy + h + 1.5);
    return e;
  }

  // ------------------------------------------------------------------ queries
  isEnemy(a: Entity, b: Entity) {
    return a.owner.team !== b.owner.team;
  }
  nearby(x: number, y: number, r: number) {
    return this.spatial.query(x, y, r, this.scratch);
  }
  /** Can `viewer` currently see entity e (stealth + fog)? */
  canSee(viewer: Player, e: Entity) {
    if (e.owner.team === viewer.team) return true;
    if (e.stealthActive && !e.detected && e.revealTimer <= 0) return false;
    if (e.isBuilding && (e.seenMask & (1 << (viewer.id & 7))) !== 0) return true;
    const fog = this.fogs.get(viewer.id);
    if (!fog) return true;
    const vis = fog.visibleAt(e.x, e.y);
    if (vis && e.isBuilding) e.seenMask |= 1 << (viewer.id & 7);
    return vis;
  }
  buildingsOf(p: Player, pred?: (b: Entity) => boolean) {
    return this.entities.filter((e) => e.isBuilding && e.owner === p && !e.dead && (!pred || pred(e)));
  }
  unitsOf(p: Player, pred?: (u: Entity) => boolean) {
    return this.entities.filter((e) => e.isUnit && e.owner === p && !e.dead && (!pred || pred(e)));
  }
  hasBuilt(p: Player, defId: string) {
    return this.entities.some((e) => e.isBuilding && e.owner === p && !e.dead && e.built && e.bdef!.id === defId);
  }
  countOf(p: Player, defId: string) {
    return this.entities.filter((e) => !e.dead && e.owner === p && (e.udef?.id === defId || e.bdef?.id === defId)).length;
  }
  prereqsMet(p: Player, prereq?: string[]) {
    if (!prereq) return true;
    return prereq.every((id) => this.hasBuilt(p, id));
  }
  /** Why can't p build this right now? null if fine. */
  buildBlocker(p: Player, def: UnitDef | BuildingDef): string | null {
    if (!this.prereqsMet(p, def.prereq)) return 'Requires ' + def.prereq!.map((id) => BUILDINGS[id]?.name ?? id).join(', ');
    if (def.limit && this.countOf(p, def.id) + this.queuedCount(p, def.id) >= def.limit) return 'Limit reached';
    if ('superweapon' in def && def.superweapon && !this.settings.superweapons) return 'Superweapons disabled';
    return null;
  }
  queuedCount(p: Player, id: string) {
    let n = 0;
    for (const e of this.entities) if (e.owner === p && e.isBuilding) for (const it of e.production) if (it.id === id) n++;
    return n;
  }
  nearestDepot(p: Player, x: number, y: number) {
    let best: Entity | null = null, bd = Infinity;
    for (const e of this.entities) {
      if (!e.isBuilding || e.owner !== p || e.dead || !e.built || !e.bdef!.depot) continue;
      const d = dist(e.x, e.y, x, y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  nearestDock(x: number, y: number, maxD = Infinity): SupplyDock | null {
    let best: SupplyDock | null = null, bd = maxD;
    for (const d of this.map.docks) {
      if (d.amount <= 0) continue;
      const dd = dist(d.x + 1, d.y + 1, x, y);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }
  nearestAirfield(p: Player, x: number, y: number) {
    let best: Entity | null = null, bd = Infinity;
    for (const e of this.entities) {
      if (!e.isBuilding || e.owner !== p || e.dead || !e.built || !e.bdef!.airfield) continue;
      if (e.parked.length >= 4) continue;
      const d = dist(e.x, e.y, x, y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  eva(p: Player, msg: string, minGap = 8) {
    if (!p.human) return;
    const last = p.lastEva[msg] ?? -100;
    if (this.time - last < minGap) return;
    p.lastEva[msg] = this.time;
    this.events.push({ kind: 'eva', player: p, msg });
  }

  // ------------------------------------------------------------------ commands
  private own(units: Entity[], p?: Player) {
    return units.filter((u) => u.isUnit && !u.dead && (!p || u.owner === p));
  }
  private setOrder(u: Entity, o: Order) {
    u.order = o;
    u.queueOrders.length = 0;
    u.path = null;
    u.stuckTimer = 0;
    u.deployed = false;
    if (o.type !== 'attack') u.target = null;
    if (o.type === 'move' || o.type === 'attackmove') u.idleTime = 0;
  }

  /** Move a group to a point, spreading them into a loose formation. */
  cmdMove(units: Entity[], x: number, y: number, attackMove = false, p?: Player) {
    const us = this.own(units, p);
    if (!us.length) return;
    const spots = this.formation(x, y, us.length, us);
    us.forEach((u, i) => {
      const s = spots[i];
      if (u.udef!.jet) {
        this.setOrder(u, attackMove ? { type: 'attackmove', x, y } : { type: 'move', x, y });
        u.jetState = 'airborne';
        return;
      }
      this.setOrder(u, attackMove ? { type: 'attackmove', x: s.x, y: s.y } : { type: 'move', x: s.x, y: s.y });
    });
    this.events.push({ kind: 'sound', name: attackMove ? 'ack_attack' : 'ack_move', x, y });
  }
  private formation(x: number, y: number, n: number, us: Entity[]) {
    const out: Point[] = [];
    if (n === 1) {
      out.push({ x, y });
      return out;
    }
    const r = Math.max(...us.map((u) => u.radius));
    const spacing = r * 2.3;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    let i = 0;
    for (let ry = 0; ry < rows && i < n; ry++)
      for (let cx = 0; cx < cols && i < n; cx++, i++) {
        const px = x + (cx - (cols - 1) / 2) * spacing;
        const py = y + (ry - (rows - 1) / 2) * spacing;
        const c = this.map.nearestFree(px, py, 6);
        out.push(c ? { x: c.x + 0.5, y: c.y + 0.5 } : { x, y });
      }
    return out;
  }
  cmdAttack(units: Entity[], target: Entity, p?: Player) {
    for (const u of this.own(units, p)) {
      if (!u.weapons.length) continue;
      this.setOrder(u, { type: 'attack', target });
      u.target = target;
      if (u.udef!.jet) u.jetState = 'airborne';
    }
    this.events.push({ kind: 'sound', name: 'ack_attack', x: target.x, y: target.y });
  }
  cmdStop(units: Entity[], p?: Player) {
    for (const u of this.own(units, p)) {
      if (u.udef!.jet) {
        this.setOrder(u, { type: 'return' });
        continue;
      }
      this.setOrder(u, { type: 'none' });
    }
  }
  cmdGather(units: Entity[], dock: SupplyDock | null, p?: Player) {
    for (const u of this.own(units, p)) {
      if (!u.udef!.gather) continue;
      this.setOrder(u, { type: 'gather' });
      u.dock = dock;
    }
  }
  cmdBuildSite(builder: Entity, site: Entity) {
    if (!builder.udef?.builder || builder.dead) return;
    this.setOrder(builder, { type: 'build', site });
  }
  cmdRepair(units: Entity[], target: Entity, p?: Player) {
    for (const u of this.own(units, p)) if (u.udef!.builder) this.setOrder(u, { type: 'repair', target });
  }
  cmdCapture(units: Entity[], target: Entity, p?: Player) {
    for (const u of this.own(units, p)) if (u.udef!.capture) this.setOrder(u, { type: 'capture', target });
  }
  cmdEnterTunnel(units: Entity[], tunnel: Entity, p?: Player) {
    for (const u of this.own(units, p)) if (!u.isAir) this.setOrder(u, { type: 'enter', target: tunnel });
  }
  cmdExitTunnel(tunnel: Entity) {
    const p = tunnel.owner;
    const list = p.tunnelUnits.splice(0);
    list.forEach((u, i) => {
      const a = (i / Math.max(1, list.length)) * TAU;
      const c = this.map.nearestFree(tunnel.x + Math.cos(a) * 2.5, tunnel.y + Math.sin(a) * 2.5, 8);
      if (!c) {
        p.tunnelUnits.push(u);
        return;
      }
      u.x = c.x + 0.5;
      u.y = c.y + 0.5;
      u.dead = false;
      u.order = { type: 'none' };
      this.entities.push(u);
      this.byId.set(u.id, u);
      this.events.push({ kind: 'spawn', entity: u });
    });
  }
  cmdSalvage(units: Entity[], crate: Entity, p?: Player) {
    for (const u of this.own(units, p)) if (u.udef!.salvage) this.setOrder(u, { type: 'salvage', target: crate });
  }
  cmdDeploy(units: Entity[], p?: Player) {
    for (const u of this.own(units, p)) if (u.udef!.hack) this.setOrder(u, { type: 'deploy' });
  }
  cmdDetonate(units: Entity[], p?: Player) {
    for (const u of this.own(units, p)) if (u.udef!.suicide) this.explodeSuicide(u);
  }
  explodeSuicide(u: Entity) {
    const w = u.weapons[0];
    const victims = this.nearby(u.x, u.y, w.splash ?? 1.5);
    for (const v of victims) if (v !== u && this.isEnemy(u, v) && !v.dead) applyDamage(this, v, w.damage, w.type, u);
    this.events.push({ kind: 'explosion', x: u.x, y: u.y, z: u.z, size: (w.splash ?? 1.5) * 1.2, style: 'blast' });
    this.events.push({ kind: 'sound', name: 'explosion_big', x: u.x, y: u.y });
    u.deathKind = 'quiet';
    this.kill(u, null);
  }

  /** Validate and start a structure at cell (cx, cy) using a builder. */
  cmdBuild(p: Player, builder: Entity | null, defId: string, cx: number, cy: number): string | null {
    const def = BUILDINGS[defId];
    if (!def) return 'Unknown';
    const blocker = this.buildBlocker(p, def);
    if (blocker) return blocker;
    if (p.money < def.cost) {
      this.eva(p, 'Insufficient funds', 3);
      return 'Insufficient funds';
    }
    if (!this.map.canPlace(cx, cy, def.size[0], def.size[1])) return 'Cannot build there';
    p.money -= def.cost;
    p.stats.spent += def.cost;
    const site = this.placeBuilding(p, def, cx, cy, false)!;
    if (builder) this.cmdBuildSite(builder, site);
    else {
      const b = this.unitsOf(p, (u) => !!u.udef!.builder && u.order.type === 'none')[0];
      if (b) this.cmdBuildSite(b, site);
    }
    this.events.push({ kind: 'sound', name: 'place', x: site.x, y: site.y });
    return null;
  }
  cmdSell(b: Entity) {
    if (b.dead || !b.isBuilding) return;
    const refund = b.built ? Math.floor(b.bdef!.cost * 0.5 * (b.hp / b.maxHp)) : Math.floor(b.bdef!.cost * (1 - b.progress * 0.5));
    b.owner.money += refund;
    for (const it of b.production) b.owner.money += it.cost;
    b.deathKind = 'quiet';
    this.kill(b, null, true);
    this.events.push({ kind: 'sound', name: 'sell', x: b.x, y: b.y });
  }
  cmdQueue(b: Entity, id: string): string | null {
    if (b.dead || !b.built) return 'Not ready';
    const p = b.owner;
    const udef = UNITS[id], upg = UPGRADES[id];
    if (b.production.length >= 9) return 'Queue full';
    if (udef) {
      const blocker = this.buildBlocker(p, udef);
      if (blocker) return blocker;
      if (p.money < udef.cost) {
        this.eva(p, 'Insufficient funds', 3);
        return 'Insufficient funds';
      }
      p.money -= udef.cost;
      p.stats.spent += udef.cost;
      b.production.push({ kind: 'unit', id, progress: 0, time: udef.buildTime, cost: udef.cost });
      return null;
    }
    if (upg) {
      if (p.upgrades.has(id) || this.queuedCount(p, id) > 0) return 'Already researched';
      if (p.money < upg.cost) {
        this.eva(p, 'Insufficient funds', 3);
        return 'Insufficient funds';
      }
      p.money -= upg.cost;
      b.production.push({ kind: 'upgrade', id, progress: 0, time: upg.time, cost: upg.cost });
      return null;
    }
    return 'Unknown';
  }
  cmdCancel(b: Entity, index: number) {
    const it = b.production[index];
    if (!it) return;
    b.production.splice(index, 1);
    b.owner.money += it.cost;
  }
  cmdRally(b: Entity, x: number, y: number) {
    b.rally = { x, y };
  }
  cmdPlan(p: Player, plan: BattlePlan) {
    p.plan = plan;
  }
  cmdBuyPower(p: Player, id: string): boolean {
    const ps = p.powers.get(id);
    if (!ps) return false;
    if (p.points <= 0 || ps.level >= ps.def.levels || p.rank < ps.def.rank) return false;
    p.points--;
    ps.level++;
    return true;
  }
  cmdPower(p: Player, id: string, x: number, y: number): string | null {
    return usePower(this, p, id, x, y);
  }
  cmdSuperweapon(b: Entity, x: number, y: number) {
    fireSuperweapon(this, b, x, y);
  }

  // ------------------------------------------------------------------ tick
  tick(dt: number) {
    if (this.result.over) return;
    this.time += dt;
    this.tickCount++;
    this.pathBudget = 40;
    this.spatial.clear();
    for (const e of this.entities) if (!e.dead) this.spatial.insert(e);

    for (const p of this.players) if (p.id >= 0) this.updatePlayer(p, dt);
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e.isUnit) this.updateUnit(e, dt);
      else if (e.isBuilding) this.updateBuilding(e, dt);
      else this.updateCrate(e, dt);
    }
    updateCombat(this, dt);
    updatePowers(this, dt);
    if (this.tickCount % 4 === 0) for (const [id, f] of this.fogs) f.update(this, this.playerById(id)!, false);
    for (const p of this.players) if (p.ai && !p.defeated) updateAi(this, p, dt);
    // Sweep the dead.
    if (this.tickCount % 10 === 0) {
      let w = 0;
      for (let i = 0; i < this.entities.length; i++) {
        const e = this.entities[i];
        if (!e.dead || this.time - e.deathTime < 6) this.entities[w++] = e;
        else this.byId.delete(e.id);
      }
      this.entities.length = w;
    }
    if (this.tickCount % 20 === 0) this.checkVictory();
  }

  private updatePlayer(p: Player, dt: number) {
    // Power.
    let prod = 0, used = 0;
    for (const e of this.entities) {
      if (!e.isBuilding || e.owner !== p || e.dead || !e.built) continue;
      const pw = e.bdef!.power;
      if (pw > 0) prod += pw + (p.upgrades.has('c_rods') && e.bdef!.id === 'c_reactor' ? 3 : 0);
      else used -= pw;
    }
    p.powerProduced = prod;
    p.powerUsed = used;
    const low = p.def.needsPower && used > prod;
    if (low && !p.lowPower) this.eva(p, 'Low power', 20);
    p.lowPower = low;
    for (const ps of p.powers.values()) if (ps.cooldown > 0) ps.cooldown = Math.max(0, ps.cooldown - dt);
    for (let i = p.reveals.length - 1; i >= 0; i--) {
      p.reveals[i].t -= dt;
      if (p.reveals[i].t <= 0) p.reveals.splice(i, 1);
    }
    // Rank.
    const nextRank = p.rank < 5 ? RANK_XP[p.rank] : Infinity;
    if (p.xp >= nextRank) {
      p.rank++;
      p.points += RANK_POINTS[p.rank - 1];
      this.events.push({ kind: 'rankup', player: p });
      this.eva(p, 'Promotion. New generals power available', 1);
    }
  }

  // ------------------------------------------------------------------ units
  private updateUnit(u: Entity, dt: number) {
    const def = u.udef!;
    if (u.stun > 0) {
      u.stun -= dt;
      u.moving = false;
      return;
    }
    if (u.revealTimer > 0) u.revealTimer -= dt;
    if (u.scrambleTimer > 0) u.scrambleTimer -= dt;
    u.stealthActive = (!!def.stealth || u.scrambleTimer > 0 || (def.id === 'i_militia' && u.owner.upgrades.has('i_camo'))) && this.time - u.lastShot > 2;
    if (u.dropping) {
      u.z -= dt * 4;
      if (u.z <= 0) {
        u.z = 0;
        u.dropping = false;
      }
      return;
    }
    // Passive heal: heroic veterancy and junk repair.
    if (u.hp < u.maxHp) {
      if (u.vet >= 3) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.01 * dt);
      if (def.move === 'vehicle' && u.owner.upgrades.has('i_junk')) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.006 * dt);
    }
    const o = u.order;
    // Drop finished or dead targets.
    if ('target' in o && o.target.dead) {
      if (o.type === 'attack' && u.udef!.jet) this.setOrder(u, { type: 'return' });
      else this.setOrder(u, { type: 'none' });
    } else if (o.type === 'attack' && !u.isAir && !this.canSee(u.owner, o.target)) {
      // Lost sight of the target: push on to where it was last seen.
      this.setOrder(u, { type: 'attackmove', x: o.target.x, y: o.target.y });
    } else if (o.type === 'build' && (o.site.dead || o.site.built)) this.setOrder(u, { type: 'none' });

    if (def.move === 'air') this.updateAir(u, dt);
    else this.updateGround(u, dt);
  }

  private goalFor(u: Entity): Point | null {
    const o = u.order;
    switch (o.type) {
      case 'move':
      case 'attackmove':
        return { x: o.x, y: o.y };
      case 'attack': {
        const t = o.target;
        if (u.udef?.suicide) return u.edgeDist(t) < 0.9 ? null : { x: t.x, y: t.y };
        if (this.inRange(u, t)) return null;
        return { x: t.x, y: t.y };
      }
      case 'gather':
        return this.gatherGoal(u);
      case 'build':
      case 'repair':
      case 'capture':
      case 'enter':
      case 'salvage': {
        const t = o.type === 'build' ? o.site : o.target;
        if (u.edgeDist(t) < 1.0) return null;
        return { x: t.x, y: t.y };
      }
      default:
        return null;
    }
  }

  /** Is target within range of any weapon that can hit it? */
  inRange(u: Entity, t: Entity) {
    const d = u.distTo(t) - t.radius - (u.isBuilding ? u.radius : 0);
    for (const w of u.weapons) {
      if (t.isAir ? !w.air : w.ground === false) continue;
      if (w.minRange && d < w.minRange) continue;
      if (d <= w.range + (u.udef?.suicide ? 0 : 0.2)) return true;
    }
    return false;
  }

  private updateGround(u: Entity, dt: number) {
    const def = u.udef!;
    const o = u.order;
    u.moving = false;
    // Target-chasing: if we have a combat target not in range, path to it.
    if (def.suicide) {
      const t = o.type === 'attack' ? o.target : u.target;
      if (t && !t.dead && u.edgeDist(t) < 0.9) {
        this.explodeSuicide(u);
        return;
      }
    }
    if (o.type === 'attackmove' && u.target && !u.target.dead && this.canSee(u.owner, u.target)) {
      const close = def.suicide ? u.edgeDist(u.target) < 0.9 : this.inRange(u, u.target);
      if (!close) this.steerTo(u, u.target.x, u.target.y, dt, 0.2);
      return;
    }
    if (o.type === 'none' && u.target && !u.target.dead && def.suicide) {
      // Suicide units idle near enemies rush them.
      this.steerTo(u, u.target.x, u.target.y, dt, 0.2);
      return;
    }
    if (o.type === 'deploy') {
      u.workTimer += dt;
      if (u.workTimer > 3) {
        u.deployed = true;
        u.owner.money += (def.hack ?? 0) * dt;
      }
      return;
    }
    if (o.type === 'gather') {
      this.updateGather(u, dt);
      return;
    }
    const goal = this.goalFor(u);
    if (!goal) {
      u.idleTime += dt;
      if (o.type === 'move') this.setOrder(u, { type: 'none' });
      if (o.type === 'attackmove') this.setOrder(u, { type: 'none' });
      if (o.type === 'build') this.workBuild(u, o.site, dt);
      else if (o.type === 'repair') this.workRepair(u, o.target, dt);
      else if (o.type === 'capture') this.workCapture(u, o.target, dt);
      else if (o.type === 'enter') this.workEnter(u, o.target);
      else if (o.type === 'salvage') this.workSalvage(u, o.target);
      return;
    }
    const arrive = o.type === 'move' || o.type === 'attackmove' ? 0.45 : 0.1;
    this.steerTo(u, goal.x, goal.y, dt, arrive);
    if (o.type === 'move' || o.type === 'attackmove') {
      const d = dist(u.x, u.y, goal.x, goal.y);
      // Arrived, or close and boxed in by friends: the order is complete.
      if (d <= arrive || (u.stuckTimer > 1.2 && d < 3.5)) this.setOrder(u, { type: 'none' });
    }
  }

  /** Move a ground unit standing in a blocked cell to the nearest free one. */
  unstick(u: Entity) {
    const c = this.map.nearestFree(u.x, u.y, 12);
    if (c) {
      u.x = c.x + 0.5;
      u.y = c.y + 0.5;
      u.path = null;
    }
  }

  /** Follow a path toward (gx, gy). Handles separation and repathing. */
  private steerTo(u: Entity, gx: number, gy: number, dt: number, arrive: number) {
    const def = u.udef!;
    const map = this.map;
    if (!map.passable(Math.floor(u.x), Math.floor(u.y))) this.unstick(u);
    if (dist(u.x, u.y, gx, gy) <= arrive) {
      u.path = null;
      return;
    }
    u.repathTimer -= dt;
    const goalMoved = dist(gx, gy, u.pathGoalX, u.pathGoalY) > 1.5;
    if (!u.path || goalMoved || (u.stuckTimer > 0.7 && u.repathTimer <= 0)) {
      if (u.repathTimer <= 0 && this.pathBudget > 0) {
        this.pathBudget--;
        u.path = findPath(map, u.x, u.y, gx, gy);
        u.pathGoalX = gx;
        u.pathGoalY = gy;
        u.repathTimer = 0.5 + this.rng.next() * 0.3;
        u.stuckTimer = 0;
        if (!u.path) {
          u.stuckTimer = 5;
          return;
        }
      } else if (!u.path) return;
    }
    // Next waypoint.
    while (u.path.length > 1 && dist(u.x, u.y, u.path[0].x, u.path[0].y) < 0.6) u.path.shift();
    const wp = u.path[0];
    let dx = wp.x - u.x, dy = wp.y - u.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    // Separation from nearby ground units.
    let sx = 0, sy = 0;
    const near = this.nearby(u.x, u.y, 1.5);
    for (const n of near) {
      if (n === u || n.isAir || n.kind !== 'unit' || n.dead) continue;
      const ox = u.x - n.x, oy = u.y - n.y;
      const d = Math.hypot(ox, oy);
      const min = u.radius + n.radius;
      if (d < min && d > 0.001) {
        const f = ((min - d) / min) * (n.moving ? 0.9 : 1.6);
        sx += (ox / d) * f;
        sy += (oy / d) * f;
      }
    }
    const want = Math.atan2(dy, dx);
    if (def.move === 'vehicle') {
      u.dir = turnToward(u.dir, want, dt * 5);
    } else u.dir = want;
    const speed = def.speed * u.speedMul;
    const vx = (dx + sx) * speed, vy = (dy + sy) * speed;
    const nx = u.x + vx * dt, ny = u.y + vy * dt;
    if (map.passable(Math.floor(nx), Math.floor(ny))) {
      u.x = nx;
      u.y = ny;
      u.stuckTimer = Math.max(0, u.stuckTimer - dt * 0.5);
    } else if (map.passable(Math.floor(nx), Math.floor(u.y))) {
      u.x = nx;
      u.stuckTimer += dt;
    } else if (map.passable(Math.floor(u.x), Math.floor(ny))) {
      u.y = ny;
      u.stuckTimer += dt;
    } else {
      u.stuckTimer += dt * 2;
    }
    u.moving = true;
    u.idleTime = 0;
    // Crushing.
    if (def.crush) {
      for (const n of near) {
        if (n.kind !== 'unit' || n.dead || n.isAir || !this.isEnemy(u, n)) continue;
        const d = Math.hypot(n.x - u.x, n.y - u.y);
        if (n.udef!.move === 'infantry' && d < u.radius + 0.15) applyDamage(this, n, 1000, 'crush', u);
        else if (def.id === 'd_behemoth' && n.udef!.armor === 'light' && n.radius < 1 && d < u.radius + 0.1) applyDamage(this, n, 60 * dt * 10, 'crush', u);
      }
    }
  }

  private updateAir(u: Entity, dt: number) {
    const def = u.udef!;
    const o = u.order;
    const alt = def.altitude ?? 6;
    u.moving = false;
    if (def.jet) {
      if (u.jetState === 'parked') {
        if (o.type === 'return' || o.type === 'none') {
          u.workTimer += dt;
          const w0 = def.weapons[0];
          if (u.workTimer > 6 && w0) u.clip[0] = w0.clip ?? Infinity;
          u.z += (0.6 - u.z) * Math.min(1, dt * 4);
          return;
        }
        u.jetState = 'airborne';
        u.workTimer = 0;
        if (u.home) u.home.parked = u.home.parked.filter((x) => x !== u);
      }
      if (o.type === 'return') {
        if (!u.home || u.home.dead || !u.home.built) u.home = this.nearestAirfield(u.owner, u.x, u.y);
        const h = u.home;
        if (!h) {
          this.flyOrbit(u, u.x, u.y, dt, alt);
          return;
        }
        const d = dist(u.x, u.y, h.x, h.y);
        if (d < 1.2) {
          u.jetState = 'parked';
          u.workTimer = 0;
          if (!h.parked.includes(u)) h.parked.push(u);
          const slot = h.parked.indexOf(u);
          u.x = h.cx + 1.2 + (slot % 2) * 2.4;
          u.y = h.cy + 1.4 + Math.floor(slot / 2) * 2.4;
          u.dir = Math.PI / 2;
          this.setOrder(u, { type: 'none' });
          return;
        }
        this.flyTo(u, h.x, h.y, dt, d < 6 ? 1.0 : alt, 1);
        return;
      }
      if (o.type === 'attack') {
        const t = o.target;
        if (u.clip[0] <= 0) {
          this.setOrder(u, { type: 'return' });
          return;
        }
        this.flyTo(u, t.x, t.y, dt, alt, 1);
        return;
      }
      if (o.type === 'move' || o.type === 'attackmove') {
        if (dist(u.x, u.y, o.x, o.y) < 2) this.flyOrbit(u, o.x, o.y, dt, alt);
        else this.flyTo(u, o.x, o.y, dt, alt, 1);
        return;
      }
      // Airborne with no orders: orbit in place.
      this.flyOrbit(u, u.x, u.y, dt, alt);
      return;
    }
    // Helicopters.
    if (o.type === 'gather') {
      this.updateGather(u, dt);
      return;
    }
    let goal: Point | null = null;
    let standoff = 0;
    if (o.type === 'attack') {
      goal = { x: o.target.x, y: o.target.y };
      standoff = (u.weapons[0]?.range ?? 6) * 0.75;
    } else if (o.type === 'attackmove' && u.target && !u.target.dead) {
      goal = { x: u.target.x, y: u.target.y };
      standoff = (u.weapons[0]?.range ?? 6) * 0.75;
    } else if (o.type === 'move' || o.type === 'attackmove') goal = { x: o.x, y: o.y };
    if (!goal) {
      u.z += (alt - u.z) * Math.min(1, dt * 2);
      u.idleTime += dt;
      return;
    }
    const d = dist(u.x, u.y, goal.x, goal.y);
    if (d <= standoff + 0.3) {
      u.dir = turnToward(u.dir, Math.atan2(goal.y - u.y, goal.x - u.x), dt * 3);
      u.z += (alt - u.z) * Math.min(1, dt * 2);
      if (o.type === 'move') this.setOrder(u, { type: 'none' });
      if (o.type === 'attackmove' && !u.target) this.setOrder(u, { type: 'none' });
      return;
    }
    this.flyTo(u, goal.x, goal.y, dt, alt, 0.6);
  }
  private flyTo(u: Entity, x: number, y: number, dt: number, alt: number, turn: number) {
    const def = u.udef!;
    const want = Math.atan2(y - u.y, x - u.x);
    u.dir = turnToward(u.dir, want, dt * (def.jet ? 2.2 : 3.5) * turn);
    const sp = def.speed * u.speedMul;
    u.x += Math.cos(u.dir) * sp * dt;
    u.y += Math.sin(u.dir) * sp * dt;
    u.x = clamp(u.x, 1, this.map.w - 1);
    u.y = clamp(u.y, 1, this.map.h - 1);
    u.z += (alt - u.z) * Math.min(1, dt * 2);
    u.moving = true;
    u.idleTime = 0;
  }
  private flyOrbit(u: Entity, x: number, y: number, dt: number, alt: number) {
    u.orbit += dt * 0.9;
    const r = 4;
    this.flyTo(u, x + Math.cos(u.orbit) * r, y + Math.sin(u.orbit) * r, dt, alt, 1);
  }

  // ------------------------------------------------------------------ economy
  private gatherGoal(u: Entity): Point | null {
    const def = u.udef!;
    if (u.cargo >= (def.gather ?? 1)) {
      const depot = this.nearestDepot(u.owner, u.x, u.y);
      if (!depot) return null;
      if (u.isAir) return { x: depot.x, y: depot.y };
      const c = this.map.nearestFree(depot.cx + depot.w / 2, depot.cy + depot.h + 0.5, 6);
      return c ? { x: c.x + 0.5, y: c.y + 0.5 } : null;
    }
    if (!u.dock || u.dock.amount <= 0) return null;
    if (u.isAir) return { x: u.dock.x + 1, y: u.dock.y + 1 };
    const c = this.map.nearestFree(u.dock.x + 1, u.dock.y + 1, 4);
    return c ? { x: c.x + 0.5, y: c.y + 0.5 } : null;
  }
  private updateGather(u: Entity, dt: number) {
    const def = u.udef!;
    const cap = def.gather ?? 1;
    const alt = def.altitude ?? 5;
    if (u.cargo >= cap) {
      const depot = this.nearestDepot(u.owner, u.x, u.y);
      if (!depot) {
        this.eva(u.owner, 'No supply center. Supplies cannot be delivered', 30);
        if (u.isAir) u.z += (alt - u.z) * Math.min(1, dt * 2);
        return;
      }
      const near = u.isAir ? dist(u.x, u.y, depot.x, depot.y) < 1.2 : u.edgeDist(depot) < 1.3;
      if (near) {
        u.workTimer += dt;
        u.moving = false;
        if (u.isAir) u.z += (1.5 - u.z) * Math.min(1, dt * 3);
        const unloadTime = u.isAir ? 3 : def.gather! >= 200 ? 2 : 1.5;
        if (u.workTimer > unloadTime) {
          u.owner.money += u.cargo;
          u.cargo = 0;
          u.workTimer = 0;
        }
        return;
      }
      const g = this.gatherGoal(u)!;
      if (u.isAir) this.flyTo(u, g.x, g.y, dt, alt, 1);
      else this.steerTo(u, g.x, g.y, dt, 0.3);
      return;
    }
    if (!u.dock || u.dock.amount <= 0) {
      const depot = this.nearestDepot(u.owner, u.x, u.y);
      u.dock = this.nearestDock(depot ? depot.x : u.x, depot ? depot.y : u.y, 60) ?? this.nearestDock(u.x, u.y);
      if (!u.dock) {
        this.eva(u.owner, 'Supplies exhausted', 60);
        this.setOrder(u, { type: 'none' });
        return;
      }
    }
    const dk = u.dock;
    const dd = dist(u.x, u.y, dk.x + 1, dk.y + 1);
    const near = u.isAir ? dd < 1.2 : dd < 2.1;
    if (near) {
      u.moving = false;
      u.workTimer += dt;
      if (u.isAir) u.z += (1.5 - u.z) * Math.min(1, dt * 3);
      const loadTime = u.isAir ? 6 : def.gather! >= 200 ? 4 : 2.5;
      if (u.workTimer > loadTime) {
        const take = Math.min(cap, dk.amount);
        dk.amount -= take;
        u.cargo += take;
        u.workTimer = 0;
        if (dk.amount <= 0) {
          // Pile gone: free the cells.
          this.map.occupy(dk.x, dk.y, 2, 2, 0);
        }
      }
      return;
    }
    const g = this.gatherGoal(u);
    if (!g) return;
    if (u.isAir) this.flyTo(u, g.x, g.y, dt, alt, 1);
    else this.steerTo(u, g.x, g.y, dt, 0.3);
  }

  private workBuild(u: Entity, site: Entity, dt: number) {
    if (site.dead || site.built) return;
    site.builders++;
    const rate = site.builders === 1 ? 1 : 0.5;
    site.progress = Math.min(1, site.progress + (dt / site.bdef!.buildTime) * rate);
    site.hp = Math.min(site.maxHp, site.hp + (site.maxHp * 0.9 * dt * rate) / site.bdef!.buildTime);
    u.dir = Math.atan2(site.y - u.y, site.x - u.x);
    if (site.progress >= 1) this.finishBuilding(site);
  }
  private finishBuilding(b: Entity) {
    b.built = true;
    b.progress = 1;
    b.hp = b.maxHp;
    b.owner.stats.built++;
    this.events.push({ kind: 'sound', name: 'complete', x: b.x, y: b.y });
    this.eva(b.owner, 'Construction complete', 2);
    if (b.bdef!.freeUnits) for (const id of b.bdef!.freeUnits) {
      const u = this.spawnUnit(b.owner, id, b.x, b.cy + b.h + 1.5);
      if (u && u.udef!.gather) this.cmdGather([u], null);
    }
    if (b.bdef!.superweapon) {
      for (const p of this.players) if (p.human && p.isEnemy(b.owner)) this.eva(p, 'Warning. Enemy superweapon detected', 1);
    }
  }
  private workRepair(u: Entity, t: Entity, dt: number) {
    if (t.dead) return;
    if (t.hp >= t.maxHp) {
      this.setOrder(u, { type: 'none' });
      return;
    }
    t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.04 * dt);
    u.dir = Math.atan2(t.y - u.y, t.x - u.x);
  }
  private workCapture(u: Entity, t: Entity, dt: number) {
    if (t.dead || t.owner === u.owner || !t.isBuilding) {
      this.setOrder(u, { type: 'none' });
      return;
    }
    if (t.capturer && t.capturer !== u && !t.capturer.dead && t.capturer.edgeDist(t) < 1.5) return;
    t.capturer = u;
    const speed = u.udef!.id === 'd_lotus' ? 4 : 12;
    t.captureProgress += dt / speed;
    u.dir = Math.atan2(t.y - u.y, t.x - u.x);
    if (t.captureProgress >= 1) {
      t.captureProgress = 0;
      t.capturer = null;
      const prev = t.owner;
      t.owner = u.owner;
      t.production.length = 0;
      t.seenMask = 0xff;
      this.events.push({ kind: 'captured', entity: t });
      this.eva(u.owner, 'Structure captured', 2);
      if (prev.human) this.eva(prev, 'Structure captured by the enemy', 2);
      this.setOrder(u, { type: 'none' });
    }
  }
  private workEnter(u: Entity, tunnel: Entity) {
    if (tunnel.dead || tunnel.owner !== u.owner || !tunnel.built) {
      this.setOrder(u, { type: 'none' });
      return;
    }
    u.owner.tunnelUnits.push(u);
    u.dead = true;
    u.deathTime = -1000;
    u.deathKind = 'quiet';
    this.setOrder(u, { type: 'none' });
    this.events.push({ kind: 'death', entity: u });
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.25);
  }
  private workSalvage(u: Entity, crate: Entity) {
    if (crate.dead) {
      this.setOrder(u, { type: 'none' });
      return;
    }
    this.pickupCrate(u, crate);
    this.setOrder(u, { type: 'none' });
  }
  pickupCrate(u: Entity, crate: Entity) {
    crate.dead = true;
    crate.deathTime = this.time;
    this.events.push({ kind: 'death', entity: crate });
    if (u.salvageLevel < 2) {
      u.salvageLevel++;
      u.maxHp = Math.round(u.udef!.hp * (1 + 0.2 * u.salvageLevel));
      u.hp = Math.min(u.maxHp, u.hp + u.udef!.hp * 0.2);
    } else u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.3);
    this.events.push({ kind: 'sound', name: 'salvage', x: u.x, y: u.y });
  }
  private updateCrate(c: Entity, dt: number) {
    c.workTimer += dt;
    if (c.workTimer > 45) {
      c.dead = true;
      c.deathTime = this.time;
      this.events.push({ kind: 'death', entity: c });
      return;
    }
    for (const n of this.nearby(c.x, c.y, 1.2)) {
      if (n.kind === 'unit' && !n.dead && n.udef!.salvage) {
        this.pickupCrate(n, c);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ buildings
  private updateBuilding(b: Entity, dt: number) {
    const def = b.bdef!;
    const p = b.owner;
    b.builders = 0;
    if (b.stun > 0) {
      b.stun -= dt;
      b.disabled = true;
      return;
    }
    b.disabled = def.defense ? p.lowPower : false;
    if (!b.built) return;
    if (b.capturer && (b.capturer.dead || b.capturer.edgeDist(b) > 1.6 || b.capturer.order.type !== 'capture')) {
      b.capturer = null;
      b.captureProgress = Math.max(0, b.captureProgress - dt * 0.2);
    }
    if (def.trap) {
      for (const n of this.nearby(b.x, b.y, def.trap)) {
        if (n.kind === 'unit' && !n.dead && !n.isAir && this.isEnemy(b, n)) {
          this.kill(b, null);
          return;
        }
      }
      return;
    }
    // Production.
    if (b.production.length) {
      const it = b.production[0];
      const rate = p.lowPower ? 0.5 : 1;
      it.progress += (dt / it.time) * rate;
      if (it.progress >= 1) {
        b.production.shift();
        if (it.kind === 'unit') this.produceUnit(b, UNITS[it.id]);
        else {
          p.upgrades.add(it.id);
          this.eva(p, 'Upgrade complete', 1);
          this.events.push({ kind: 'sound', name: 'complete', x: b.x, y: b.y });
        }
      }
    }
    // Income.
    if (def.income && p.id >= 0) {
      b.incomeTimer += dt;
      if (b.incomeTimer >= def.income.interval) {
        b.incomeTimer = 0;
        p.money += def.income.amount;
        if (def.id === 'c_pad') this.events.push({ kind: 'sound', name: 'cash', x: b.x, y: b.y });
      }
    }
    // Heal aura.
    if (def.heal && !p.lowPower) {
      for (const n of this.nearby(b.x, b.y, def.heal.radius)) {
        if (n.kind === 'unit' && n.owner === p && !n.dead && n.hp < n.maxHp) n.hp = Math.min(n.maxHp, n.hp + n.maxHp * def.heal.rate * dt);
      }
    }
    // War factories repair vehicles beside them.
    if (def.produces && def.produces.some((id) => UNITS[id]?.move === 'vehicle')) {
      for (const n of this.nearby(b.x, b.y, b.radius + 3)) {
        if (n.kind === 'unit' && n.owner === p && !n.dead && n.udef!.move === 'vehicle' && n.hp < n.maxHp) n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.02 * dt);
      }
    }
    // Superweapon countdown.
    if (def.superweapon) {
      if (!b.swReady && !(p.lowPower && p.def.needsPower)) {
        b.swTimer -= dt;
        if (b.swTimer <= 0) {
          b.swReady = true;
          b.swTimer = 0;
          this.eva(p, 'Superweapon ready', 1);
        }
      }
    }
  }

  private produceUnit(b: Entity, def: UnitDef) {
    const p = b.owner;
    const n = def.count ?? 1;
    const exitX = b.x, exitY = b.cy + b.h + 1.2;
    for (let i = 0; i < n; i++) {
      let u: Entity | null;
      if (def.move === 'air') {
        u = this.spawnUnit(p, def.id, b.x, b.y, { z: def.jet ? 0.6 : 2 });
        if (u && def.jet) {
          u.home = b;
          u.jetState = 'parked';
          b.parked.push(u);
          const slot = b.parked.indexOf(u);
          u.x = b.cx + 1.2 + (slot % 2) * 2.4;
          u.y = b.cy + 1.4 + Math.floor(slot / 2) * 2.4;
          u.dir = Math.PI / 2;
          u.order = { type: 'none' };
        }
      } else u = this.spawnUnit(p, def.id, exitX + (i - (n - 1) / 2) * 0.8, exitY);
      if (!u) continue;
      u.dir = Math.PI / 2;
      if (def.gather) this.cmdGather([u], null);
      else if (b.rally && !def.jet) this.cmdMove([u], b.rally.x, b.rally.y, true);
      else if (!def.jet && !def.builder) {
        const c = this.map.nearestFree(exitX + this.rng.range(-3, 3), exitY + 2 + this.rng.range(0, 2), 6);
        if (c) this.setOrder(u, { type: 'move', x: c.x + 0.5, y: c.y + 0.5 });
      }
    }
    this.eva(p, 'Unit ready', 1.5);
    this.events.push({ kind: 'sound', name: 'unit_ready', x: b.x, y: b.y });
  }

  // ------------------------------------------------------------------ death & victory
  kill(e: Entity, killer: Entity | null, silent = false) {
    if (e.dead) return;
    e.dead = true;
    e.deathTime = this.time;
    e.hp = 0;
    const p = e.owner;
    if (e.isBuilding) {
      if (!e.bdef!.trap && e.bdef!.id !== 'n_mine') {
        for (let j = e.cy; j < e.cy + e.h; j++) for (let i = e.cx; i < e.cx + e.w; i++) if (this.map.inBounds(i, j) && this.map.occupied[this.map.idx(i, j)] === e.id) this.map.occupied[this.map.idx(i, j)] = 0;
      }
      for (const j of e.parked) if (!j.dead) j.home = null;
      if (e.bdef!.deathBlast && !silent) {
        const db = e.bdef!.deathBlast;
        for (const v of this.nearby(e.x, e.y, db.radius)) if (v !== e && !v.dead && (this.isEnemy(e, v) || e.bdef!.id === 'd_reactor')) applyDamage(this, v, db.damage, db.type, null);
        this.events.push({ kind: 'explosion', x: e.x, y: e.y, z: e.z, size: db.radius, style: e.bdef!.id === 'd_reactor' ? 'nuke' : 'blast' });
        this.events.push({ kind: 'sound', name: 'explosion_big', x: e.x, y: e.y });
        this.events.push({ kind: 'shake', amount: 0.6 });
      }
      if (!silent && p.id >= 0) {
        p.stats.lost++;
        if (e.bdef!.command) this.eva(p, 'Command center lost', 1);
        else this.eva(p, 'Structure lost', 4);
      }
      if (e.bdef!.tunnel && p.id >= 0 && !this.entities.some((t) => t !== e && t.isBuilding && t.owner === p && !t.dead && t.bdef!.tunnel)) {
        p.tunnelUnits.length = 0;
      }
    } else if (e.isUnit) {
      if (e.home) e.home.parked = e.home.parked.filter((x) => x !== e);
      if (e.isAir) e.deathKind = 'crash';
      if (!silent && p.id >= 0) {
        p.stats.lost++;
        this.eva(p, 'Unit lost', 6);
      }
      // Wrecked vehicles leave salvage.
      if (e.udef!.move === 'vehicle' && !silent && this.rng.next() < 0.6) {
        const c = new Entity('crate', this.players[0], e.x, e.y);
        c.radius = 0.4;
        c.hp = 1;
        c.z = this.map.heightAt(e.x, e.y);
        this.entities.push(c);
        this.byId.set(c.id, c);
        this.events.push({ kind: 'spawn', entity: c });
      }
    }
    if (killer && killer.owner !== p && killer.owner.id >= 0) {
      const kp = killer.owner;
      const value = e.cost;
      kp.stats.killed++;
      kp.xp += value / 10;
      killer.xp += (value / 10) * (kp.upgrades.has('c_training') ? 2 : 1);
      while (killer.vet < 3 && killer.xp >= VET_XP[killer.vet + 1]) {
        killer.vet++;
        if (killer.vet === 3) killer.hp = killer.maxHp;
        this.events.push({ kind: 'sound', name: 'promote', x: killer.x, y: killer.y });
      }
      const bounty = kp.powers.get('i_bounty');
      if (bounty && bounty.level > 0) kp.money += value * [0, 0.05, 0.1, 0.2][bounty.level];
    }
    this.events.push({ kind: 'death', entity: e });
  }

  private checkVictory() {
    for (const p of this.players) {
      if (p.id < 0 || p.defeated) continue;
      const alive = this.entities.some((e) => !e.dead && e.owner === p && (e.isBuilding || (e.isUnit && e.udef!.builder)));
      if (!alive) {
        p.defeated = true;
        for (const e of this.entities) if (!e.dead && e.owner === p) this.kill(e, null, true);
        for (const q of this.players) if (q.human && q !== p) this.eva(q, `${p.name} has been eliminated`, 1);
      }
    }
    const teams = new Set(this.playersAlive.map((p) => p.team));
    const human = this.humanPlayer;
    if (human && human.defeated) {
      this.result = { winner: null, over: true };
    } else if (teams.size <= 1) {
      this.result = { winner: teams.size ? [...teams][0] : null, over: true };
    }
  }
}

export { START_CASH };
export type { Entity, Player, BuildingDef, UnitDef, UpgradeDef };
