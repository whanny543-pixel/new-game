import * as THREE from 'three';
import {
  ARCHER,
  BALLISTA,
  BARRICADE_HP,
  BOW_TIERS,
  COLORS,
  ENEMIES,
  HALL,
  KNIGHT,
  PLAYER,
  PLOTS,
  POST_LEVELS,
  ROADSIDE_PAD,
  ROAD_HALF_WIDTH,
  SWORD_TIERS,
  TOWER_LEVELS,
  WAVES,
  WORKSHOP,
  coinValue,
  CASTLE_LEVELS,
  GATE_TIERS,
  NOVA,
  type EnemyKind,
  type EnemyType,
  type Place,
  type PlotDef,
} from './config';
import * as M from './models';
import * as S from './structures';
import type { Horde } from './horde';
import { Kingdom } from './kingdom';
import { Plot } from './plot';
import { BASE_STATS, xpForLevel, type HeroStats, type Perk } from './perks';
import type { Fx } from './fx';
import type { Sfx } from './audio';
import type { Hud } from './hud';
import type { World } from './world';
import type { Road } from './road';

// One play-through. Everything created here lives under `root` and is thrown away on restart.

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const mtx = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const col = new THREE.Color();
const eul = new THREE.Euler();

type UnitType = 'archer' | 'knight';
type WeaponKind = 'sword' | 'bow';

interface Enemy {
  kind: EnemyKind;
  type: EnemyType;
  road: number;
  s: number;
  off: number;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  atkCd: number;
  lunge: number;
  flash: number;
  phase: number;
  moving: boolean;
  bar: HTMLElement | null;
  /** Seconds left rising out of the ground. */
  spawnT: number;
  /** Seconds since death (death animation), -1 while alive. */
  deadT: number;
  animT: number;
}

interface Unit {
  type: UnitType;
  rig: S.UnitRig;
  pos: THREE.Vector3;
  tier: number;
  state: 'follow' | 'walk' | 'station';
  home: Tower | Post | null;
  slot: number;
  cd: number;
  hp: number;
  lastHit: number;
  facing: number;
  swing: number;
  /** Knights on a post: their spot on the road. */
  roadS: number;
  roadOff: number;
}

interface Tower {
  plot: Plot;
  pos: THREE.Vector3;
  rig: S.TowerRig;
  level: number;
  units: (Unit | null)[];
  ballistaCd: number;
  grow: number;
  label: HTMLElement;
}

interface Post {
  plot: Plot;
  road: number;
  s: number;
  level: number;
  units: (Unit | null)[];
  flag: THREE.Object3D;
  pos: THREE.Vector3;
  label: HTMLElement;
}

interface Barricade {
  plot: Plot;
  road: number;
  s: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  lastHit: number;
  shake: number;
  rise: number;
  /** Gates are sturdier barricades that builders can rebuild from rubble. */
  rebuildable: boolean;
  gate?: { tier: number; rubble: THREE.Object3D; right: THREE.Vector3 };
}

interface Workshop {
  plot: Plot;
  kind: 'range' | 'barracks' | 'forge' | 'bowyer';
  rig: S.WorkshopRig;
  pos: THREE.Vector3;
  level: number;
  timer: number;
  rack: number[];
  rackMesh: THREE.InstancedMesh | null;
  rackWorld: THREE.Vector3;
  pickT: number;
  smokeT: number;
}

interface Arrow {
  hero: boolean;
  crit: boolean;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  target: Enemy | null;
  aim: THREE.Vector3;
  damage: number;
  active: boolean;
}

interface Bolt {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  left: number;
  hits: Set<Enemy>;
  active: boolean;
}

interface GroundCoin {
  value: number;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  active: boolean;
  age: number;
}

interface SpawnItem {
  at: number;
  kind: EnemyKind;
  road: number;
}

interface Chest {
  root: THREE.Group;
  lid: THREE.Object3D;
  pos: THREE.Vector3;
  vy: number;
  y: number;
  open: number;
  gold: number;
  beam: THREE.Mesh;
}

export interface RunEvents {
  onGameOver(wave: number): void;
  haptic(strong: boolean): void;
  hurt(amount: number): void;
  flash(amount: number): void;
}

export const MAX_ENEMIES: Record<EnemyKind, number> = { goblin: 420, runner: 220, troll: 24 };

export class Run {
  readonly root = new THREE.Group();
  time = 0;
  wave = 0;
  over = false;

  // Hero
  hero = S.makeHero();
  heroPos = new THREE.Vector3(0, 0, 5.5);
  heroVel = new THREE.Vector3();
  heroFacing = Math.PI;
  private moveDir = new THREE.Vector3(0, 0, -1);
  heroHp = PLAYER.maxHp;
  stats: HeroStats = { ...BASE_STATS };
  perkLevels: Record<string, number> = {};
  xp = 0;
  level = 1;
  pendingLevelUps = 0;
  combo = 0;
  bestCombo = 0;
  kills = 0;
  private lastKill = -99;
  /** Seconds of slow-motion left (hit-stop on big moments). */
  hitstop = 0;
  private stepT = 0;
  private chests: Chest[] = [];
  heroAlive = true;
  private respawnT = 0;
  private heroCd = 0;
  private heroHurt = 0;
  private heroLastHit = -99;
  private walkT = 0;
  carry = 0;
  weapons: { kind: WeaponKind; tier: number }[] = [];
  private stack: THREE.InstancedMesh;
  private swordStack: THREE.InstancedMesh;
  private bowStack: THREE.InstancedMesh;
  private stackLean = new THREE.Vector2();
  private pickupCombo = 0;
  private pickupComboT = 0;
  private heroBar: HTMLElement;
  private giveT = 0;

  // Hall
  hall = S.makeHall();
  hallHp = HALL.maxHp;
  hallMax = HALL.maxHp;
  private hallRadius = HALL.radius;
  kingdom: Kingdom;
  /** 0..1 charge of the hero's Arcane Nova. */
  nova = 0;
  private hallLastHit = -99;

  // Enemies
  enemies: Enemy[] = [];
  /** Recently killed enemies still playing their death animation. */
  private corpses: Enemy[] = [];
  private grid = new Map<number, Enemy[]>();

  // Defence
  plots: Plot[] = [];
  private towers = new Map<string, Tower>();
  private posts = new Map<string, Post>();
  private barricades = new Map<string, Barricade>();
  private shops = new Map<string, Workshop>();
  units: Unit[] = [];

  // Projectiles & pickups
  private arrows: Arrow[] = [];
  private bolts: Bolt[] = [];
  private coins: GroundCoin[] = [];
  private guide: THREE.Mesh[] = [];

  // Paying
  private payT = 0;
  private payStreak = 0;
  private activePlot: Plot | null = null;

  // Waves
  private queue: SpawnItem[] = [];
  private waveStart = 0;
  private nextWaveAt: number = WAVES.firstDelay;
  private waveTotal = 1;
  private waveSpawned = 0;
  private roadBOpen = false;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private fx: Fx,
    private sfx: Sfx,
    private hud: Hud,
    private events: RunEvents,
    private horde: Horde,
  ) {
    scene.add(this.root);
    world.openRoad(1, false);

    this.root.add(this.hall.root);
    this.kingdom = new Kingdom(this.root, fx, sfx, {
      text: (p, m, c) => this.fx.text(p, m, c),
      push: (p, r) => this.pushOutOfBuildings(p, r),
    });
    this.root.add(this.hero.root);
    this.hero.root.position.copy(this.heroPos);

    this.stack = new THREE.InstancedMesh(M.GEO.coin, M.MAT.coin, PLAYER.maxVisibleStack);
    this.stack.count = 0;
    this.stack.castShadow = true;
    this.stack.frustumCulled = false;
    this.hero.backAnchor.add(this.stack);
    this.swordStack = this.makeItemStack(M.GEO.sword);
    this.bowStack = this.makeItemStack(M.GEO.bow);
    this.heroBar = hud.worldBar('hero');

    for (let i = 0; i < 220; i++) {
      const mesh = new THREE.Mesh(M.GEO.arrow, M.MAT.arrowModel);
      mesh.visible = false;
      this.root.add(mesh);
      this.arrows.push({ hero: false, crit: false, mesh, pos: new THREE.Vector3(), target: null, aim: new THREE.Vector3(), damage: 0, active: false });
    }
    for (let i = 0; i < 16; i++) {
      const mesh = S.prop('projectile_catapult', 0.9);
      mesh.visible = false;
      this.root.add(mesh);
      this.bolts.push({ mesh, pos: new THREE.Vector3(), dir: new THREE.Vector3(), left: 0, hits: new Set(), active: false });
    }
    for (let i = 0; i < 320; i++) {
      const mesh = new THREE.Mesh(M.GEO.coin, M.MAT.coin);
      mesh.castShadow = true;
      mesh.visible = false;
      this.root.add(mesh);
      this.coins.push({ value: 1, mesh, vel: new THREE.Vector3(), active: false, age: 0 });
    }
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 18; i++) {
      const d = new THREE.Mesh(M.GEO.dot, dotMat);
      d.rotation.x = -Math.PI / 2;
      d.position.y = 0.06;
      d.visible = false;
      this.root.add(d);
      this.guide.push(d);
    }

    for (const def of PLOTS) {
      const p = new Plot(def);
      const at = this.placeOf(def);
      p.setPos(at.x, at.z);
      this.root.add(p.group);
      this.plots.push(p);
    }

    // A little gold on the ground teaches the collect → build loop straight away.
    for (let i = 0; i < PLAYER.startGold; i++) this.dropCoin(v1.set(-3.25 + (i % 7) * 1.08, 0.3, 7.2 + Math.floor(i / 7) * 0.9), 0.4, 1);
  }

  private get roads(): Road[] {
    return this.world.roads;
  }

  // ------------------------------------------------------------------ placement helpers

  /** World position of a plot's pad. On-road structures put their pad on the roadside. */
  placeOf(def: PlotDef) {
    if (def.pad) return this.resolve(def.pad);
    return this.resolve(def.place, def.kind === 'post' || def.kind === 'barricade');
  }

  private resolve(place: Place, roadside = false) {
    if ('x' in place) return new THREE.Vector3(place.x, 0, place.z);
    const r = this.roads[place.road];
    const side = roadside ? ROADSIDE_PAD.side : place.side;
    const dist = roadside ? ROADSIDE_PAD.dist : place.dist;
    return r.point(r.length * place.t, side * dist, new THREE.Vector3());
  }

  /** Spots worth keeping clear of scenery. */
  reservedSpots() {
    const out: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: 6 }];
    for (const p of this.plots) {
      const k = p.def.kind;
      if (k === 'camp') out.push({ x: p.pos.x - 4, z: p.pos.z - 5, r: 8.5 }); // the woodcutters' forest
      if (k === 'camp' || k === 'quarry') out.push({ x: p.pos.x, z: p.pos.z, r: 5.5 });
      if (k === 'gate') {
        const g = this.resolve(p.def.place);
        out.push({ x: g.x, z: g.z, r: 9 });
      }
    }
    for (const p of this.plots) {
      out.push({ x: p.pos.x, z: p.pos.z, r: 3 });
      if (p.def.kind === 'tower') {
        const far = this.towerPadAfter(p.def);
        out.push({ x: far.x, z: far.z, r: 3 });
      }
      const after = SHOP_PAD_AFTER[p.def.id];
      if (after) out.push({ x: after.x, z: after.z, r: 3 });
      if (['range', 'barracks', 'forge', 'bowyer', 'castle'].includes(p.def.kind)) out.push({ x: p.pos.x, z: p.pos.z, r: 5 });
    }
    return out;
  }

  private towerPadAfter(def: PlotDef) {
    const pl = def.place as { road: number; t: number; side: number; dist: number };
    return this.resolve({ ...pl, dist: pl.dist + 2.9 });
  }

  // ------------------------------------------------------------------ small utilities

  private makeItemStack(geo: THREE.BufferGeometry) {
    const im = new THREE.InstancedMesh(geo, S.weaponItemMaterial(), PLAYER.maxWeapons);
    im.count = 0;
    im.castShadow = true;
    im.frustumCulled = false;
    im.setColorAt(0, col.setRGB(1, 1, 1));
    this.hero.frontAnchor.add(im);
    return im;
  }

  private stackTop(out: THREE.Vector3) {
    const n = Math.min(this.carry, PLAYER.maxVisibleStack);
    out.set(0, n * 0.11 + 0.05, 0);
    return this.hero.backAnchor.localToWorld(out);
  }

  private frontTop(out: THREE.Vector3) {
    out.set(0, this.weapons.length * 0.1, 0.1);
    return this.hero.frontAnchor.localToWorld(out);
  }

  private dropCoin(at: THREE.Vector3, spread = 2.5, value = coinValue(this.wave)) {
    const c = this.coins.find((q) => !q.active);
    if (!c) {
      // Pool exhausted: bank it directly rather than losing the reward.
      this.carry += value;
      return;
    }
    c.active = true;
    c.value = value;
    c.mesh.scale.setScalar(value > 1 ? 1.25 : 1);
    c.age = 0;
    c.mesh.visible = true;
    c.mesh.position.copy(at);
    const a = Math.random() * Math.PI * 2;
    const s = spread * (0.3 + Math.random() * 0.7);
    c.vel.set(Math.cos(a) * s, 4 + Math.random() * 2.5, Math.sin(a) * s);
  }

  private gainCoin(value = 1) {
    this.carry += value;
    this.pickupCombo++;
    this.pickupComboT = 0.6;
    this.sfx.pickup(this.pickupCombo);
    this.hud.bumpGold();
  }

  isBuilt(id: string) {
    const p = this.plots.find((q) => q.def.id === id);
    return !!p && p.level > 0;
  }

  // ------------------------------------------------------------------ main update

  update(dt: number, move: { x: number; y: number }) {
    if (this.over) return;
    this.time += dt;
    this.updateHero(dt, move);
    this.updateWaves();
    this.updateEnemies(dt);
    this.updateUnits(dt);
    this.updateTowers(dt);
    this.updatePosts();
    this.updateBarricades(dt);
    this.updateShops(dt);
    this.updateWeapons(dt);
    this.updateArrows(dt);
    this.updateBolts(dt);
    this.updateCoins(dt);
    this.updateChests(dt);
    this.updatePlots(dt);
    this.updateHall(dt);
    this.kingdom.update(dt, [...this.barricades.values()], this.time);
    this.hud.setResources(this.kingdom.wood, this.kingdom.stone);
    this.updateGuide();
    this.updateStacks(dt);
    this.drawCrowd(dt);
    this.hud.setGold(this.carry);
    if (!this.chests.some((c) => c.open === 0)) this.hud.hint(this.currentHint());
    if (this.time - this.lastKill > 2.2 && this.combo) {
      this.combo = 0;
      this.hud.setCombo(0);
    }
    // Heartbeat vignette while the hall is in danger.
    if (this.hallHp / this.hallMax < 0.3) this.events.hurt(0.25 + Math.sin(this.time * 6) * 0.15);
    // Ambient dust motes.
    if (Math.random() < 0.1) this.fx.p.motes(this.heroPos);
  }

  // ------------------------------------------------------------------ hero

  private updateHero(dt: number, move: { x: number; y: number }) {
    const rig = this.hero;
    if (!this.heroAlive) {
      this.respawnT -= dt;
      rig.root.visible = false;
      if (this.respawnT <= 0) {
        this.heroAlive = true;
        this.heroHp = this.stats.maxHp;
        this.heroPos.set(0, 0, 5.5);
        rig.root.visible = true;
        this.fx.p.levelUp(v1.copy(this.heroPos).setY(0.5));
        this.fx.pillar(this.heroPos, 0xffe08a, 1.2);
      }
      this.hud.placeBar(this.heroBar, null, 0);
      return;
    }

    const speed = PLAYER.speed * this.stats.speed;
    this.heroVel.set(move.x * speed, 0, move.y * speed);
    this.heroPos.addScaledVector(this.heroVel, dt);
    this.heroPos.x = THREE.MathUtils.clamp(this.heroPos.x, -40, 48);
    this.heroPos.z = THREE.MathUtils.clamp(this.heroPos.z, -54, 22);
    this.pushOutOfBuildings(this.heroPos, 0.45);

    const moving = this.heroVel.lengthSq() > 0.01;
    if (moving) {
      this.walkT += dt * 11;
      this.moveDir.copy(this.heroVel).normalize();
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.11;
        this.fx.p.dust(v1.copy(this.heroPos).setY(0.1));
      }
    } else this.walkT = 0;
    rig.ring.rotation.z += dt * 1.5;
    (rig.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(this.time * 4) * 0.12;

    this.heroCd -= dt;
    const target = this.nearestEnemy(this.heroPos.x, this.heroPos.z, PLAYER.range);
    let face = moving ? Math.atan2(this.heroVel.x, this.heroVel.z) : this.heroFacing;
    if (target) {
      face = Math.atan2(target.x - this.heroPos.x, target.z - this.heroPos.z);
      if (this.heroCd <= 0) {
        this.heroCd = PLAYER.fireDelay * this.stats.fireDelay;
        rig.muzzle.getWorldPosition(v1);
        // Volley: extra bolts go to the next-nearest goblins.
        const hit = new Set<Enemy>();
        let t: Enemy | null = target;
        for (let k = 0; k <= this.stats.multishot && t; k++) {
          hit.add(t);
          const crit = Math.random() < this.stats.crit;
          const dmg = Math.round(this.heroDamage * (crit ? 2 : 1));
          this.fire(v1, t, dmg, true, crit);
          t = this.nearestExcept(this.heroPos.x, this.heroPos.z, PLAYER.range, hit);
        }
        this.fx.p.muzzle(v1);
        if (!moving) rig.char.once('Spellcast_Shoot', 2.2);
        this.sfx.shoot();
      }
    }
    this.heroFacing = lerpAngle(this.heroFacing, face, Math.min(1, dt * 14));

    rig.root.position.copy(this.heroPos);
    rig.root.rotation.y = this.heroFacing;
    rig.char.loop(moving ? 'Running_A' : 'Idle');
    rig.char.update(dt);

    if (this.time - this.heroLastHit > 3) this.heroHp = Math.min(this.stats.maxHp, this.heroHp + PLAYER.regen * dt);
    this.heroHurt = Math.max(0, this.heroHurt - dt * 4);
    const frac = this.heroHp / this.stats.maxHp;
    this.hud.placeBar(this.heroBar, frac < 0.999 ? v1.copy(this.heroPos).setY(2.7) : null, frac);
  }

  get heroDamage() {
    const forge = this.shops.get('forge');
    return Math.round((PLAYER.baseDamage + (forge ? forge.level * 8 : 0)) * this.stats.damage);
  }

  private nearestExcept(x: number, z: number, range: number, skip: Set<Enemy>) {
    let best: Enemy | null = null;
    let bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || skip.has(e)) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Apply a level-up pick. */
  applyPerk(p: Perk) {
    this.perkLevels[p.id] = (this.perkLevels[p.id] ?? 0) + 1;
    const hpFrac = this.heroHp / this.stats.maxHp;
    p.apply(this.stats);
    this.heroHp = p.id === 'vigor' ? this.stats.maxHp : hpFrac * this.stats.maxHp;
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    this.fx.p.levelUp(v1.copy(this.heroPos).setY(0.4));
    this.fx.pillar(this.heroPos, 0xffd34d, 1.6, 1.1);
    this.fx.ring(this.heroPos, 0xffd34d, 7, 0.7);
    this.fx.text(v1.copy(this.heroPos).setY(3.2), p.name + '!', 'good');
    this.sfx.levelUp();
  }

  /** Keeps a walker out of the hall and building footprints. */
  private pushOutOfBuildings(p: THREE.Vector3, r: number) {
    const solid: [number, number, number][] = [[0, -0.2, this.hallRadius]];
    for (const site of [this.kingdom.camp, this.kingdom.quarry]) if (site) solid.push([site.pos.x, site.pos.z - 0.3, 2]);
    for (const s of this.shops.values()) solid.push([s.pos.x, s.pos.z - 0.2, 1.9]);
    for (const t of this.towers.values()) solid.push([t.pos.x, t.pos.z, 1.15]);
    for (const [x, z, rad] of solid) {
      const dx = p.x - x;
      const dz = p.z - z;
      const d = Math.hypot(dx, dz);
      const min = rad + r;
      if (d < min && d > 1e-4) {
        p.x = x + (dx / d) * min;
        p.z = z + (dz / d) * min;
      }
    }
  }

  private damageHero(dmg: number) {
    if (!this.heroAlive) return;
    this.heroHp -= dmg;
    this.heroHurt = 1;
    this.heroLastHit = this.time;
    this.sfx.hurt();
    this.events.hurt(0.45);
    if (this.heroHp <= 0) {
      this.heroAlive = false;
      this.respawnT = PLAYER.respawnTime;
      this.fx.p.death(v1.copy(this.heroPos).setY(1), COLORS.team, true);
      this.fx.shake = Math.max(this.fx.shake, 0.6);
      this.events.haptic(true);
      this.hud.banner('Knocked out!', true);
      const lose = Math.floor(this.carry / 2);
      this.carry -= lose;
      for (let i = 0; i < Math.min(lose, 60); i++) this.dropCoin(v1.copy(this.heroPos).setY(1.2), 3.5);
    }
  }

  private updateStacks(dt: number) {
    // Gold tower on the back, leaning with momentum.
    const n = Math.min(this.carry, PLAYER.maxVisibleStack);
    this.stack.count = n;
    const tx = this.heroAlive ? -this.heroVel.x * 0.006 : 0;
    const tz = this.heroAlive ? -this.heroVel.z * 0.006 : 0;
    this.stackLean.x += (tx - this.stackLean.x) * Math.min(1, dt * 6);
    this.stackLean.y += (tz - this.stackLean.y) * Math.min(1, dt * 6);
    const c = Math.cos(-this.heroFacing);
    const s = Math.sin(-this.heroFacing);
    const lx = this.stackLean.x * c + this.stackLean.y * s;
    const lz = -this.stackLean.x * s + this.stackLean.y * c;
    for (let i = 0; i < n; i++) {
      const f = (i / PLAYER.maxVisibleStack) ** 2 * 35;
      const wob = Math.sin(this.time * 2.5 + i * 0.12) * 0.0015 * i;
      v1.set(lx * f + wob, i * 0.11, lz * f);
      quat.setFromAxisAngle(UP, i * 0.4);
      mtx.compose(v1, quat, scl.set(1, 1, 1));
      this.stack.setMatrixAt(i, mtx);
    }
    this.stack.instanceMatrix.needsUpdate = true;

    // Weapons carried in the arms, lying crosswise.
    let si = 0;
    let bi = 0;
    this.weapons.forEach((w, i) => {
      const im = w.kind === 'sword' ? this.swordStack : this.bowStack;
      const idx = w.kind === 'sword' ? si++ : bi++;
      v1.set(0, i * 0.1, 0);
      quat.setFromEuler(eul.set(Math.PI / 2, 0, Math.PI / 2, 'XYZ'));
      mtx.compose(v1, quat, scl.set(1, 1, 1));
      im.setMatrixAt(idx, mtx);
      const tiers = w.kind === 'sword' ? SWORD_TIERS : BOW_TIERS;
      im.setColorAt(idx, col.set(tiers[w.tier].color));
    });
    this.swordStack.count = si;
    this.bowStack.count = bi;
    for (const im of [this.swordStack, this.bowStack]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ waves

  private updateWaves() {
    // Spawn whatever is due.
    while (this.queue.length && this.queue[0].at <= this.time) {
      const it = this.queue.shift()!;
      this.spawn(it.kind, it.road);
      this.waveSpawned++;
    }
    if (this.queue.length === 0 && this.time >= this.nextWaveAt) {
      const elapsed = this.time - this.waveStart;
      if (this.wave === 0 || this.enemies.length <= 6 || elapsed > WAVES.duration + 14) this.startWave(this.wave + 1);
    }
    this.hud.setWave(Math.max(1, this.wave), this.wave === 0 ? 0 : this.waveSpawned / this.waveTotal);
  }

  private startWave(n: number) {
    this.wave = n;
    this.waveStart = this.time;
    this.nextWaveAt = this.time + WAVES.duration + WAVES.breakTime;
    if (n >= WAVES.roadBWave && !this.roadBOpen) {
      this.roadBOpen = true;
      this.world.openRoad(1, true);
      this.hud.banner('Skeletons on the east road!', true);
      this.sfx.boss();
    }
    const total = WAVES.baseCount + (n - 1) * WAVES.countPerWave;
    const trolls = n % 4 === 0 ? Math.ceil(n / 4) : n >= 10 && n % 2 === 0 ? 1 : 0;
    const items: SpawnItem[] = [];
    // Enemies arrive in packs that string out along the road.
    let left = total;
    let t = this.time + 0.5;
    const packs = Math.max(2, Math.round(total / 14));
    const gap = (WAVES.duration * 0.8) / packs;
    for (let p = 0; p < packs && left > 0; p++) {
      const size = p === packs - 1 ? left : Math.min(left, Math.round(total / packs));
      left -= size;
      const road = this.roadBOpen && p % 3 === 1 ? 1 : 0;
      for (let i = 0; i < size; i++) {
        const kind: EnemyKind = n >= 3 && Math.random() < 0.25 ? 'runner' : 'goblin';
        items.push({ at: t + i * 0.12, kind, road });
      }
      t += gap;
    }
    for (let i = 0; i < trolls; i++) {
      items.push({ at: this.time + 4 + i * 5, kind: 'troll', road: this.roadBOpen && i % 2 ? 1 : 0 });
    }
    items.sort((a, b) => a.at - b.at);
    this.queue = items;
    this.waveTotal = items.length;
    this.waveSpawned = 0;
    if (trolls) {
      this.hud.banner(`Wave ${n}: Bone Giant!`, true);
      this.sfx.boss();
    } else if (!(n === WAVES.roadBWave)) {
      this.hud.banner(`Wave ${n}`, false);
      this.sfx.wave();
    }
  }

  private spawn(kind: EnemyKind, road: number) {
    if (this.enemies.filter((e) => e.kind === kind).length >= MAX_ENEMIES[kind]) return;
    const type = ENEMIES[kind];
    const hp = Math.round(type.hp * (1 + WAVES.hpGrowth * (this.wave - 1)) * (type.boss ? 1 + this.wave * 0.06 : 1));
    const e: Enemy = {
      kind,
      type,
      road,
      s: Math.random() * 0.8,
      off: (Math.random() * 2 - 1) * (ROAD_HALF_WIDTH - 0.5),
      x: 0,
      z: 0,
      facing: 0,
      hp,
      maxHp: hp,
      alive: true,
      atkCd: 0.5,
      lunge: 0,
      flash: 0,
      phase: Math.random() * 10,
      moving: true,
      bar: type.boss ? this.hud.worldBar('enemy big') : null,
      spawnT: this.horde.duration(kind, 'spawn') / 1.6,
      deadT: -1,
      animT: Math.random(),
    };
    this.roads[road].point(e.s, e.off, v1);
    e.x = v1.x;
    e.z = v1.z;
    this.enemies.push(e);
    if (type.boss) this.fx.shake = Math.max(this.fx.shake, 0.4);
  }

  // ------------------------------------------------------------------ enemies

  nearestEnemy(x: number, z: number, range: number, skip?: Enemy) {
    let best: Enemy | null = null;
    let bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || e === skip) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private gridKey(x: number, z: number) {
    return (Math.floor(x / 1.6) + 512) * 4096 + (Math.floor(z / 1.6) + 512);
  }

  private updateEnemies(dt: number) {
    // Spatial hash for separation.
    this.grid.clear();
    for (const e of this.enemies) {
      const k = this.gridKey(e.x, e.z);
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, (cell = []));
      cell.push(e);
    }

    const knights = this.units.filter((u) => u.type === 'knight' && u.state === 'station' && u.home);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const t = e.type;
      const road = this.roads[e.road];
      e.atkCd -= dt;
      e.lunge = Math.max(0, e.lunge - dt * 4);
      e.flash = Math.max(0, e.flash - dt * 7);
      if (e.spawnT > 0) {
        // Clawing up out of the ground.
        e.spawnT -= dt;
        if (Math.random() < dt * 10) this.fx.p.dust(v1.set(e.x, 0.1, e.z), 1);
        road.point(e.s, e.off, v1);
        e.x = v1.x;
        e.z = v1.z;
        road.tangent(e.s, v2);
        e.facing = Math.atan2(v2.x, v2.z);
        continue;
      }

      let blocked = false;
      let attack: (() => void) | null = null;
      let faceX = 0;
      let faceZ = 0;

      // 1. The hero, if standing in the way.
      const hd = Math.hypot(this.heroPos.x - e.x, this.heroPos.z - e.z);
      if (this.heroAlive && hd < t.radius + 0.7) {
        blocked = true;
        faceX = this.heroPos.x - e.x;
        faceZ = this.heroPos.z - e.z;
        attack = () => this.damageHero(t.damage);
      }
      // 2. Knights holding the road.
      if (!blocked) {
        for (const k of knights) {
          const post = k.home as Post;
          if (post.road !== e.road) continue;
          const ahead = k.roadS - e.s;
          if (ahead > -0.2 && ahead < t.radius + 0.6 && Math.abs(k.roadOff - e.off) < 0.75 + t.radius) {
            blocked = true;
            faceX = k.pos.x - e.x;
            faceZ = k.pos.z - e.z;
            attack = () => this.damageKnight(k, t.damage);
            break;
          }
        }
      }
      // 3. Barricades.
      if (!blocked) {
        for (const b of this.barricades.values()) {
          if (!b.alive || b.road !== e.road) continue;
          const ahead = b.s - e.s;
          if (ahead > -0.3 && ahead < t.radius + 0.35) {
            blocked = true;
            attack = () => this.damageBarricade(b, t.damage);
            break;
          }
        }
      }
      // 4. Reaching the hall: one heavy hit, then the goblin is gone (no reward).
      if (!blocked && e.s >= road.length - 0.3) {
        this.damageHall(t.damage * 3);
        e.alive = false;
        this.fx.p.explosion(v1.set(e.x, 1, e.z));
        continue;
      }

      if (blocked) {
        if (attack && e.atkCd <= 0) {
          e.atkCd = t.boss ? 1.4 : 1.0;
          e.lunge = 1;
          attack();
        }
      } else {
        e.s += t.speed * dt;
      }
      e.moving = !blocked;

      // Separation: push apart in the plane, then fold the push back into (s, off).
      let px = 0;
      let pz = 0;
      const gx = Math.floor(e.x / 1.6) + 512;
      const gz = Math.floor(e.z / 1.6) + 512;
      for (let ix = -1; ix <= 1; ix++)
        for (let iz = -1; iz <= 1; iz++) {
          const cell = this.grid.get((gx + ix) * 4096 + gz + iz);
          if (!cell) continue;
          for (const o of cell) {
            if (o === e || !o.alive) continue;
            const sx = e.x - o.x;
            const sz = e.z - o.z;
            const min = t.radius + o.type.radius;
            const d2 = sx * sx + sz * sz;
            if (d2 < min * min && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const k = ((min - d) / d) * (o.type.boss && !t.boss ? 0.9 : 0.45);
              px += sx * k;
              pz += sz * k;
            }
          }
        }
      if (px || pz) {
        road.tangent(e.s, v2);
        let ds = px * v2.x + pz * v2.z;
        const doff = px * -v2.z + pz * v2.x;
        if (blocked && ds > 0) ds = 0;
        e.s = Math.max(0, e.s + ds);
        const lim = ROAD_HALF_WIDTH + (t.boss ? 0 : 0.4);
        e.off = THREE.MathUtils.clamp(e.off + doff, -lim, lim);
      }

      road.point(e.s, e.off, v1);
      e.x = v1.x;
      e.z = v1.z;
      if (faceX || faceZ) e.facing = Math.atan2(faceX, faceZ);
      else {
        road.tangent(e.s, v2);
        e.facing = Math.atan2(v2.x, v2.z);
      }
      if (e.bar) this.hud.placeBar(e.bar, v1.set(e.x, 3.5, e.z), e.hp / e.maxHp);
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive) continue;
      if (e.bar) this.hud.removeBar(e.bar);
      this.enemies.splice(i, 1);
    }
  }

  private drawCrowd(dt: number) {
    const h = this.horde;
    h.begin();
    for (const e of this.enemies) {
      const boss = e.type.boss;
      const bright = 1 + e.flash * 1.8;
      const size = 1 + e.flash * 0.08;
      const fwd = e.lunge * (boss ? 0.4 : 0.2);
      const x = e.x + Math.sin(e.facing) * fwd;
      const z = e.z + Math.cos(e.facing) * fwd;
      if (e.spawnT > 0) {
        const dur = h.duration(e.kind, 'spawn');
        h.add(e.kind, 'spawn', dur - e.spawnT * 1.6, x, 0, z, e.facing, 0, size, bright);
      } else if (!e.moving) {
        e.animT += dt;
        h.add(e.kind, 'attack', e.animT * 1.3, x, 0, z, e.facing, 0, size, bright);
      } else {
        // Walk cycle speed follows movement speed.
        e.animT += dt * (e.kind === 'runner' ? 1.15 : boss ? 0.8 : 1.25);
        h.add(e.kind, 'move', e.animT, x, 0, z, e.facing, 0, size, bright);
      }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.deadT += dt;
      const dur = h.duration(c.kind, 'death');
      const sink = Math.max(0, c.deadT * 1.3 - dur * 1.3) * 0.8;
      h.add(c.kind, 'death', c.deadT * 1.3, c.x, -sink, c.z, c.facing, 0, 1, 1);
      if (c.deadT * 1.3 > dur + 0.9) this.corpses.splice(i, 1);
    }
    h.end();
  }

  private hitEnemy(e: Enemy, dmg: number, crit = false) {
    if (!e.alive) return;
    e.hp -= dmg;
    e.flash = 1;
    // Small knockback up the road (bosses shrug it off).
    if (!e.type.boss) e.s = Math.max(0, e.s - 0.12);
    v1.set(e.x, e.type.boss ? 2.2 : 1.0, e.z);
    if (crit) this.fx.p.crit(v1);
    else this.fx.p.hit(v1, e.kind === 'troll' ? 0xc9d4de : 0xb7ff7a);
    this.fx.text(v1.set(e.x, e.type.boss ? 3.0 : 1.7, e.z), crit ? `${dmg}!` : `-${dmg}`, crit ? 'crit' : '');
    this.sfx.hit();
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    e.alive = false;
    e.deadT = 0;
    if (this.corpses.length < 160) this.corpses.push(e);
    this.kills++;
    v1.set(e.x, 0.8, e.z);
    this.fx.p.death(v1, e.kind === 'troll' ? COLORS.troll : COLORS.goblin, e.type.boss);
    this.sfx.pop();
    let coins = Math.floor(e.type.coin);
    if (Math.random() < e.type.coin - coins) coins++;
    if (Math.random() < this.stats.greed) coins++;
    for (let i = 0; i < coins; i++) this.dropCoin(v1, e.type.boss ? 4 : 1.6);

    // XP and level-ups.
    this.nova = Math.min(1, this.nova + (e.type.boss ? 0.3 : 1 / NOVA.killsToCharge));
    this.hud.setNova(this.nova);
    this.xp += e.type.boss ? 20 : 1;
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      this.pendingLevelUps++;
    }
    this.hud.setXp(this.level, this.xp / xpForLevel(this.level));

    // Kill streaks.
    this.combo = this.time - this.lastKill < 1.6 ? this.combo + 1 : 1;
    this.lastKill = this.time;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.hud.setCombo(this.combo);
    const milestones: Record<number, string> = { 15: 'Killing spree!', 30: 'Rampage!', 60: 'Unstoppable!', 100: 'Legendary!', 150: 'Godlike!' };
    if (milestones[this.combo]) {
      this.hud.banner(milestones[this.combo], false);
      const bonus = Math.round(this.combo / 3);
      for (let i = 0; i < bonus; i++) this.dropCoin(v2.copy(this.heroPos).setY(2.5), 3);
      this.fx.p.coinBurst(v2.copy(this.heroPos).setY(2));
      this.fx.ring(this.heroPos, 0xffd34d, 6);
      this.sfx.treasure();
      this.events.haptic(false);
    }

    if (e.type.boss) {
      this.fx.shake = Math.max(this.fx.shake, 0.9);
      this.fx.punch = 1;
      this.hitstop = 0.18;
      this.events.haptic(true);
      this.events.flash(0.6);
      this.fx.ring(v1, 0xffffff, 6, 0.5);
      this.hud.banner('Giant smashed!', false);
      this.spawnChest(v1);
    }
  }

  // ------------------------------------------------------------------ chests

  private spawnChest(at: THREE.Vector3) {
    const root = new THREE.Group();
    const chest = S.makeChest();
    root.add(chest.root);
    const lid = chest.lid;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 7, 16, 1, true).translate(0, 3.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    root.add(beam);
    root.position.set(at.x, 0, at.z);
    this.root.add(root);
    this.chests.push({ root, lid, pos: new THREE.Vector3(at.x, 0, at.z), vy: 7, y: 0.01, open: 0, gold: 20 + this.wave * 4, beam });
    this.hud.hint('A treasure chest! Go grab it');
  }

  private updateChests(dt: number) {
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const c = this.chests[i];
      // Pops up out of the troll, then bounces.
      if (c.y > 0 || c.vy > 0) {
        c.vy -= 20 * dt;
        c.y = Math.max(0, c.y + c.vy * dt);
        if (c.y === 0 && c.vy < 0) c.vy = Math.abs(c.vy) > 3 ? -c.vy * 0.35 : 0;
      }
      c.root.position.y = c.y;
      if (c.open === 0) {
        c.root.rotation.y += dt * 0.8;
        (c.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(this.time * 5) * 0.08;
        if (Math.random() < dt * 6) this.fx.p.sparkle(v1.copy(c.pos).setY(0.8 + Math.random()), 0xffe066);
        if (this.heroAlive && Math.hypot(this.heroPos.x - c.pos.x, this.heroPos.z - c.pos.z) < 2) {
          c.open = 0.001;
          this.fx.p.coinBurst(v1.copy(c.pos).setY(1));
          this.fx.pillar(c.pos, 0xffd34d, 1.4, 1);
          this.fx.ring(c.pos, 0xffd34d, 6);
          this.fx.punch = 0.7;
          this.hitstop = 0.1;
          this.events.flash(0.4);
          this.events.haptic(true);
          this.sfx.treasure();
          this.hud.banner(`+${c.gold * coinValue(this.wave)} gold!`, false);
          for (let n = 0; n < c.gold; n++) this.dropCoin(v1.copy(c.pos).setY(1.2), 4.5);
        }
      } else {
        c.open += dt;
        c.lid.rotation.x = -Math.min(1, c.open * 4) * 1.6;
        (c.beam.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.3 - c.open * 0.3);
        if (c.open > 2.5) {
          c.root.scale.setScalar(Math.max(0.01, 1 - (c.open - 2.5) * 3));
          if (c.open > 2.85) {
            this.root.remove(c.root);
            c.beam.geometry.dispose();
            (c.beam.material as THREE.Material).dispose();
            this.chests.splice(i, 1);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ projectiles

  private fire(from: THREE.Vector3, target: Enemy, damage: number, hero = false, crit = false) {
    const a = this.arrows.find((q) => !q.active);
    if (!a) {
      this.hitEnemy(target, damage, crit);
      return;
    }
    a.active = true;
    a.hero = hero;
    a.crit = crit;
    a.mesh.geometry = hero ? M.GEO.orb : M.GEO.arrow;
    a.mesh.material = hero ? M.MAT.magic : M.MAT.arrowModel;
    a.mesh.scale.setScalar(hero && crit ? 1.6 : 1);
    a.mesh.visible = true;
    a.pos.copy(from);
    a.target = target;
    a.aim.set(target.x, target.type.boss ? 1.4 : 0.8, target.z);
    a.damage = damage;
    a.mesh.position.copy(from);
  }

  private updateArrows(dt: number) {
    const speed = 30;
    for (const a of this.arrows) {
      if (!a.active) continue;
      if (a.target?.alive) a.aim.set(a.target.x, a.target.type.boss ? 1.4 : 0.8, a.target.z);
      v1.subVectors(a.aim, a.pos);
      const d = v1.length();
      const step = speed * dt;
      if (d <= step + 0.15) {
        a.active = false;
        a.mesh.visible = false;
        if (a.target?.alive) {
          const t = a.target;
          this.hitEnemy(t, a.damage, a.crit);
          if (a.hero) this.heroHitEffects(t, a.damage);
        }
        continue;
      }
      a.pos.addScaledVector(v1, step / d);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.aim);
      this.fx.p.trail(a.pos, a.hero ? (this.stats.splash ? 0xff8a2e : this.stats.chain ? 0x8fe3ff : 0xffd86b) : 0xfff3d0, a.hero ? 0.28 : 0.18);
    }
  }

  /** Perk effects that ride on the hero's bolts. */
  private heroHitEffects(t: Enemy, dmg: number) {
    const at = v2.set(t.x, 0.9, t.z);
    if (this.stats.splash > 0) {
      this.fx.p.explosion(at);
      const r2 = 1.9 * 1.9;
      for (const e of this.enemies) {
        if (e === t || !e.alive) continue;
        if ((e.x - t.x) ** 2 + (e.z - t.z) ** 2 < r2) this.hitEnemy(e, Math.max(1, Math.round(dmg * this.stats.splash)));
      }
    }
    if (this.stats.chain > 0 && Math.random() < 0.45) {
      const hit = new Set<Enemy>([t]);
      let from = t;
      for (let i = 0; i < this.stats.chain; i++) {
        const next = this.nearestExcept(from.x, from.z, 4.5, hit);
        if (!next) break;
        hit.add(next);
        this.fx.p.zap(v1.set(from.x, 1, from.z), v3.set(next.x, 1, next.z));
        this.hitEnemy(next, Math.round(dmg * 0.6));
        from = next;
      }
    }
  }

  private fireBolt(from: THREE.Vector3, to: THREE.Vector3) {
    const b = this.bolts.find((q) => !q.active);
    if (!b) return;
    b.active = true;
    b.mesh.visible = true;
    b.pos.copy(from);
    b.dir.subVectors(to, from).setY(0).normalize();
    b.left = BALLISTA.range + 4;
    b.hits.clear();
    b.mesh.position.copy(from);
    b.mesh.lookAt(v1.copy(from).add(b.dir));
  }

  private updateBolts(dt: number) {
    for (const b of this.bolts) {
      if (!b.active) continue;
      const step = 26 * dt;
      b.pos.addScaledVector(b.dir, step);
      b.pos.y = Math.max(0.9, b.pos.y - dt * 4);
      b.left -= step;
      b.mesh.position.copy(b.pos);
      this.fx.p.trail(b.pos, 0xffe3a0, 0.5);
      for (const e of this.enemies) {
        if (!e.alive || b.hits.has(e)) continue;
        if ((e.x - b.pos.x) ** 2 + (e.z - b.pos.z) ** 2 < (e.type.radius + 0.5) ** 2) {
          b.hits.add(e);
          this.hitEnemy(e, Math.round(BALLISTA.damage * this.stats.allies));
          if (b.hits.size >= BALLISTA.pierce) b.left = 0;
        }
      }
      if (b.left <= 0) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }

  // ------------------------------------------------------------------ coins

  private updateCoins(dt: number) {
    this.pickupComboT -= dt;
    if (this.pickupComboT <= 0) this.pickupCombo = 0;
    for (const c of this.coins) {
      if (!c.active) continue;
      c.age += dt;
      const p = c.mesh.position;
      if (p.y > 0.06 || c.vel.y > 0) {
        c.vel.y -= 18 * dt;
        p.addScaledVector(c.vel, dt);
        if (p.y < 0.06) {
          p.y = 0.06;
          c.vel.set(c.vel.x * 0.3, Math.abs(c.vel.y) > 3 ? -c.vel.y * 0.3 : 0, c.vel.z * 0.3);
        }
        c.mesh.rotation.x += dt * 9;
      } else {
        c.mesh.rotation.x = 0;
        c.mesh.rotation.y += dt * 2;
        if (Math.random() < dt * 0.8) this.fx.p.sparkle(v1.copy(p).setY(0.3), 0xffe066);
      }
      if (!this.heroAlive || c.age < 0.35) continue;
      const dx = p.x - this.heroPos.x;
      const dz = p.z - this.heroPos.z;
      // Nearby coins snap to the hero; forgotten ones fly over on their own after a while.
      const far = c.age > PLAYER.coinAutoCollect;
      const mag = PLAYER.magnet * this.stats.magnet;
      if (far || dx * dx + dz * dz < mag * mag) {
        c.active = false;
        c.mesh.visible = false;
        const value = c.value;
        this.fx.fly(p.clone(), () => this.stackTop(v3), far ? 0.7 : 0.28, far ? 3 : 1.2, () => this.gainCoin(value));
      }
    }
  }

  // ------------------------------------------------------------------ plots & building

  private needMet(r: string) {
    if (!r) return true;
    if (r.startsWith('wave:')) return this.wave >= Number(r.slice(5));
    if (r.startsWith('castle:')) return this.kingdom.castleLevel + 1 >= Number(r.slice(7));
    return this.isBuilt(r);
  }

  private requirementsMet(def: PlotDef) {
    return def.requires.every((r) => this.needMet(r));
  }

  private plotVisible(p: Plot) {
    if (p.maxed || !this.requirementsMet(p.def)) return false;
    if (!this.needMet(p.def.levelNeeds?.[p.level] ?? '')) return false;
    if (p.def.kind === 'barricade') return !this.barricades.get(p.def.id)?.alive;
    if (p.def.kind === 'recruitArcher') return this.openSpots('archer') > 0;
    if (p.def.kind === 'recruitKnight') return this.openSpots('knight') > 0;
    return true;
  }

  private updatePlots(dt: number) {
    let on: Plot | null = null;
    for (const p of this.plots) {
      p.setStock(this.kingdom.wood, this.kingdom.stone);
      p.show(this.plotVisible(p));
      if (!p.shown || !this.heroAlive) continue;
      const dx = this.heroPos.x - p.pos.x;
      const dz = this.heroPos.z - p.pos.z;
      if (dx * dx + dz * dz < 1.3 * 1.3) on = p;
    }
    if (on !== this.activePlot) {
      this.activePlot = on;
      this.payStreak = 0;
      this.payT = 0;
    }
    for (const p of this.plots) p.update(dt, p === on);

    if (on && !on.stocked && on.paid === 0) this.hud.hint(this.missingHint(on));
    if (on && on.stocked && this.carry > 0 && on.paid + on.pending < on.cost) {
      // Pay faster the longer you stand there: a big stack drains in a satisfying rush.
      this.payStreak += dt;
      const rate = Math.min(45, 7 + this.payStreak * 26);
      this.payT += dt * rate;
      // Big costs move in bigger chunks so nothing takes more than a couple of seconds.
      const chunk = Math.max(1, Math.floor(on.cost / 35));
      while (this.payT >= 1 && this.carry > 0 && on.paid + on.pending < on.cost) {
        this.payT -= 1;
        const amt = Math.min(chunk, this.carry, on.cost - on.paid - on.pending);
        this.carry -= amt;
        on.pending += amt;
        const plot = on;
        const from = this.stackTop(new THREE.Vector3());
        this.fx.fly(from, () => v3.set(plot.pos.x, 0.2, plot.pos.z), 0.22, 1.0, () => {
          plot.pending -= amt;
          plot.paid += amt;
          plot.bump();
          this.sfx.pay(plot.paid / Math.max(1, plot.cost));
          if (plot.paid >= plot.cost) this.completePlot(plot);
        });
      }
    }
  }

  completePlot(p: Plot) {
    const def = p.def;
    const lvl = p.level;
    if (p.woodCost || p.stoneCost) this.kingdom.spend(Math.min(p.woodCost, this.kingdom.wood), Math.min(p.stoneCost, this.kingdom.stone), p.pos);
    p.level++;
    p.paid = 0;
    this.sfx.build();
    this.events.haptic(false);
    v1.set(p.pos.x, 0.6, p.pos.z);
    this.fx.p.build(v1);
    this.fx.ring(v1, 0xffe08a, 5, 0.6);
    this.fx.pillar(v1, 0xfff0b0, 1.3, 0.8);
    this.fx.shake = Math.max(this.fx.shake, 0.25);
    this.fx.punch = Math.max(this.fx.punch, 0.5);
    this.events.flash(0.25);

    switch (def.kind) {
      case 'tower':
        this.buildTower(p, lvl);
        break;
      case 'post':
        this.buildPost(p, lvl);
        break;
      case 'barricade':
        this.buildBarricade(p);
        p.level = 0; // can be rebuilt after it's smashed
        break;
      case 'range':
      case 'barracks':
      case 'forge':
      case 'bowyer':
        this.buildShop(p, def.kind, lvl);
        break;
      case 'camp':
        this.kingdom.buildCamp(this.resolve(def.place), lvl);
        if (lvl === 0) {
          p.setPos(-10.8, -14.4);
          this.fx.text(v2.copy(p.pos).setY(4), 'Lumber Camp! Woodcutters at work', 'good');
        } else this.fx.text(v2.copy(p.pos).setY(4), '+1 woodcutter', 'good');
        break;
      case 'quarry':
        this.kingdom.buildQuarry(this.resolve(def.place), lvl);
        if (lvl === 0) {
          p.setPos(-14.2, 11.4);
          this.fx.text(v2.copy(p.pos).setY(4), 'Quarry! Miners at work', 'good');
        } else this.fx.text(v2.copy(p.pos).setY(4), '+1 miner', 'good');
        break;
      case 'castle':
        this.upgradeCastle(lvl + 1);
        break;
      case 'gate':
        this.buildGate(p, lvl);
        break;
      case 'recruitArcher':
      case 'recruitKnight': {
        const type: UnitType = def.kind === 'recruitArcher' ? 'archer' : 'knight';
        const shop = this.shops.get(type === 'archer' ? 'range' : 'barracks')!;
        this.spawnUnit(type, shop.rackWorld, 'follow');
        this.fx.text(v2.copy(shop.rackWorld).setY(2.2), type === 'archer' ? 'Archer recruited!' : 'Knight recruited!', 'good');
        break;
      }
    }
  }

  private buildTower(p: Plot, lvl: number) {
    const def = p.def;
    let t = this.towers.get(def.id);
    if (!t) {
      const rig = S.makeTower();
      const pos = this.resolve(def.place);
      rig.root.position.copy(pos);
      // Face the road.
      const pl = def.place as { road: number; t: number };
      const r = this.roads[pl.road];
      const onRoad = r.point(r.length * pl.t, 0, new THREE.Vector3());
      rig.root.rotation.y = Math.atan2(onRoad.x - pos.x, onRoad.z - pos.z);
      this.root.add(rig.root);
      t = { plot: p, pos, rig, level: 0, units: [null, null], ballistaCd: 0, grow: 0, label: this.hud.worldLabel('archer') };
      this.towers.set(def.id, t);
      const far = this.towerPadAfter(def);
      p.setPos(far.x, far.z);
      this.fx.text(v2.copy(pos).setY(3.5), 'Watchtower!', 'good');
      // The very first tower comes with a free archer to show how towers work.
      if (def.id === 'tw1') this.spawnUnit('archer', v2.set(2.5, 0, 4), 'follow', t);
    } else {
      t.level = Math.min(TOWER_LEVELS.length - 1, lvl);
      t.rig.roof.visible = t.level >= 1;
      t.rig.ballista.visible = TOWER_LEVELS[t.level].ballista;
      t.rig.base.visible = !TOWER_LEVELS[t.level].ballista;
      if (TOWER_LEVELS[t.level].ballista) t.rig.roof.visible = false;
      t.grow = 0.4;
      this.fx.text(v2.copy(t.pos).setY(4), TOWER_LEVELS[t.level].ballista ? 'Ballista mounted!' : '+1 archer slot', 'good');
    }
  }

  private buildPost(p: Plot, lvl: number) {
    const def = p.def;
    let post = this.posts.get(def.id);
    if (!post) {
      const pl = def.place as { road: number; t: number };
      const road = this.roads[pl.road];
      const s = road.length * pl.t;
      const flag = S.makePostFlag();
      const pos = road.point(s, ROAD_HALF_WIDTH + 0.7, new THREE.Vector3());
      flag.position.copy(pos);
      this.root.add(flag);
      post = { plot: p, road: pl.road, s, level: 0, units: [null, null, null, null], flag, pos: road.point(s, 0, new THREE.Vector3()), label: this.hud.worldLabel('knight') };
      this.posts.set(def.id, post);
      this.fx.text(v2.copy(post.pos).setY(3), 'Guard Post!', 'good');
    } else {
      post.level = Math.min(POST_LEVELS.length - 1, lvl);
      this.fx.text(v2.copy(post.pos).setY(3), '+2 knight slots', 'good');
    }
  }

  private buildBarricade(p: Plot) {
    const def = p.def;
    let b = this.barricades.get(def.id);
    if (!b) {
      const pl = def.place as { road: number; t: number };
      const road = this.roads[pl.road];
      const s = road.length * pl.t;
      const mesh = S.makeBarricade(ROAD_HALF_WIDTH * 2 + 0.6);
      const pos = road.point(s, 0, new THREE.Vector3());
      mesh.position.copy(pos);
      road.tangent(s, v2);
      mesh.rotation.y = Math.atan2(v2.x, v2.z);
      this.root.add(mesh);
      const hp = BARRICADE_HP[pl.road === 0 ? 0 : 1];
      b = { plot: p, road: pl.road, s, hp, maxHp: hp, alive: true, mesh, pos, lastHit: -99, shake: 0, rise: 0, rebuildable: false };
      this.barricades.set(def.id, b);
    }
    b.alive = true;
    b.hp = b.maxHp;
    b.rise = 0;
    b.mesh.visible = true;
    this.fx.p.build(v2.copy(b.pos).setY(0.5));
  }

  private buildShop(p: Plot, kind: Workshop['kind'], lvl: number) {
    let shop = this.shops.get(p.def.id);
    if (!shop) {
      const rig = S.makeShop(kind);
      const pos = p.pos.clone();
      rig.root.position.copy(pos);
      this.root.add(rig.root);
      let rackMesh: THREE.InstancedMesh | null = null;
      const rackWorld = rig.rack.clone().add(pos);
      if (kind === 'forge' || kind === 'bowyer') {
        rackMesh = new THREE.InstancedMesh(kind === 'forge' ? M.GEO.sword : M.GEO.bow, S.weaponItemMaterial(), WORKSHOP.rackMax);
        rackMesh.count = 0;
        rackMesh.castShadow = true;
        rackMesh.frustumCulled = false;
        rackMesh.setColorAt(0, col.setRGB(1, 1, 1));
        rackMesh.position.copy(pos);
        this.root.add(rackMesh);
      }
      shop = { plot: p, kind, rig, pos, level: 1, timer: 0, rack: [], rackMesh, rackWorld, pickT: 0, smokeT: 0 };
      this.shops.set(p.def.id, shop);
      const after = SHOP_PAD_AFTER[p.def.id];
      if (after) p.setPos(after.x, after.z);
      this.fx.text(v2.copy(pos).setY(4), SHOP_NAMES[kind], 'good');
      // Recruits already queued at the hall pick up the new shop's spot.
    } else {
      shop.level = Math.min(WORKSHOP.interval.length, lvl + 1);
      const tiers = kind === 'forge' ? SWORD_TIERS : BOW_TIERS;
      this.fx.text(v2.copy(shop.pos).setY(4), `Now making: ${tiers[shop.level].name}`, 'good');
    }
  }

  // ------------------------------------------------------------------ defenders

  private spawnUnit(type: UnitType, at: THREE.Vector3, state: Unit['state'], home?: Tower) {
    const rig = S.makeUnit(type);
    const pos = at.clone().setY(0);
    rig.root.position.copy(pos);
    this.root.add(rig.root);
    const u: Unit = {
      type,
      rig,
      pos,
      tier: 0,
      state,
      home: null,
      slot: -1,
      cd: Math.random() * 0.5,
      hp: KNIGHT.maxHp,
      lastHit: -99,
      facing: Math.PI,
      swing: 0,
      roadS: 0,
      roadOff: 0,
    };
    this.setTier(u, 0);
    this.units.push(u);
    if (home) this.assign(u, home);
    this.fx.p.levelUp(v1.copy(pos).setY(0.3));
    this.fx.ring(pos, 0x6fb6ff, 3, 0.5);
    return u;
  }

  private setTier(u: Unit, tier: number) {
    u.tier = tier;
    const tiers = u.type === 'archer' ? BOW_TIERS : SWORD_TIERS;
    u.rig.weaponMat.color.set(tiers[tier].color);
    u.rig.weaponMat.emissive.set(tier === 3 ? 0x6a4a00 : 0x000000);
    if (u.type === 'knight') {
      const maxHp = KNIGHT.maxHp + tier * KNIGHT.hpPerTier;
      u.hp = maxHp;
    }
  }

  private maxHp(u: Unit) {
    return KNIGHT.maxHp + u.tier * KNIGHT.hpPerTier;
  }

  private slotsOf(h: Tower | Post) {
    return 'rig' in h ? TOWER_LEVELS[h.level].slots : POST_LEVELS[h.level].slots;
  }

  /** Empty tower/post slots for a unit type, minus recruits already on their way. */
  private openSpots(type: UnitType) {
    const homes: (Tower | Post)[] = type === 'archer' ? [...this.towers.values()] : [...this.posts.values()];
    let free = 0;
    for (const h of homes) {
      const n = this.slotsOf(h);
      for (let i = 0; i < n; i++) if (!h.units[i]) free++;
    }
    return free - this.units.filter((u) => u.type === type && u.state === 'follow').length;
  }

  private freeSlot(h: Tower | Post) {
    const n = this.slotsOf(h);
    for (let i = 0; i < n; i++) if (!h.units[i]) return i;
    return -1;
  }

  private assign(u: Unit, h: Tower | Post) {
    const slot = this.freeSlot(h);
    if (slot < 0) return false;
    h.units[slot] = u;
    u.home = h;
    u.slot = slot;
    u.state = 'walk';
    if (!('rig' in h)) {
      // Knight spots on the road: two abreast, the second pair one step behind.
      u.roadS = h.s - (slot >= 2 ? 1.3 : 0);
      u.roadOff = slot % 2 ? 0.85 : -0.85;
    }
    this.fx.text(v1.copy(u.pos).setY(2), u.type === 'archer' ? 'To the tower!' : 'Holding the road!', 'good');
    return true;
  }

  /** Where a stationed unit stands (world space). */
  private stationPos(u: Unit, out: THREE.Vector3) {
    const h = u.home!;
    if ('rig' in h) return h.rig.root.localToWorld(out.copy(h.rig.slots[u.slot]));
    return this.roads[h.road].point(u.roadS, u.roadOff, out);
  }

  /** Ground point a unit walks to before taking its station. */
  private approachPos(u: Unit, out: THREE.Vector3) {
    const h = u.home!;
    if ('rig' in h) {
      // The foot of the ladder.
      return h.rig.root.localToWorld(out.set(0, 0, 1.8));
    }
    return this.stationPos(u, out);
  }

  private updateUnits(dt: number) {
    const followers = this.units.filter((u) => u.state === 'follow');
    // Lead followers to any free tower/post nearby.
    if (this.heroAlive) {
      for (const u of followers) {
        const homes: (Tower | Post)[] = u.type === 'archer' ? [...this.towers.values()] : [...this.posts.values()];
        for (const h of homes) {
          if (this.freeSlot(h) >= 0 && Math.hypot(h.pos.x - this.heroPos.x, h.pos.z - this.heroPos.z) < 5.5) {
            this.assign(u, h);
            break;
          }
        }
      }
    }

    let fi = 0;
    const fwdAngle = Math.atan2(this.moveDir.x, this.moveDir.z);
    for (const u of this.units) {
      const prevX = u.pos.x;
      const prevZ = u.pos.z;
      let walking = false;
      if (u.state === 'follow') {
        // Trailing formation behind the hero.
        const row = Math.floor(fi / 3);
        const colI = (fi % 3) - 1;
        fi++;
        const back = 1.7 + row * 1.0;
        const ca = Math.cos(fwdAngle);
        const sa = Math.sin(fwdAngle);
        v1.set(this.heroPos.x - Math.sin(fwdAngle) * back + ca * colI * 0.95, 0, this.heroPos.z - Math.cos(fwdAngle) * back - sa * colI * 0.95);
        walking = this.walkTo(u, v1, dt, 8);
        u.rig.root.visible = this.heroAlive;
      } else if (u.state === 'walk') {
        this.approachPos(u, v1);
        const arrived = !this.walkTo(u, v1, dt, 6) || u.pos.distanceTo(v1) < 0.3;
        walking = !arrived;
        if (arrived) {
          u.state = 'station';
          this.stationPos(u, u.pos);
          this.sfx.pay(1);
        }
      } else {
        this.stationPos(u, u.pos);
      }
      if (u.state !== 'station') this.pushOutOfBuildings(u.pos, 0.3);

      // Combat
      u.cd -= dt;
      u.swing = Math.max(0, u.swing - dt * 5);
      let face = walking ? Math.atan2(u.pos.x - prevX, u.pos.z - prevZ) : u.facing;
      if (u.type === 'archer') {
        const range = ARCHER.range + (u.home && 'rig' in u.home ? TOWER_LEVELS[u.home.level].rangeBonus : -2);
        const t = this.nearestEnemy(u.pos.x, u.pos.z, range);
        if (t) {
          face = Math.atan2(t.x - u.pos.x, t.z - u.pos.z);
          if (u.cd <= 0 && u.state !== 'walk') {
            u.cd = ARCHER.delay;
            u.swing = 1;
            u.rig.muzzle.getWorldPosition(v2);
            this.fire(v2, t, Math.round(BOW_TIERS[u.tier].damage * this.stats.allies));
            this.sfx.turret();
          }
        }
      } else {
        const t = this.nearestEnemy(u.pos.x, u.pos.z, KNIGHT.reach + 0.3);
        if (t) {
          face = Math.atan2(t.x - u.pos.x, t.z - u.pos.z);
          if (u.cd <= 0) {
            u.cd = KNIGHT.delay;
            u.swing = 1;
            this.hitEnemy(t, Math.round(SWORD_TIERS[u.tier].damage * this.stats.allies));
            this.fx.p.hit(v2.set(t.x, 1, t.z), 0xffffff);
          }
        } else if (u.state === 'station' && u.home && !('rig' in u.home)) {
          // Face up the road toward the incoming horde.
          this.roads[u.home.road].tangent(u.roadS, v2);
          face = Math.atan2(-v2.x, -v2.z);
        }
        if (this.time - u.lastHit > 3) u.hp = Math.min(this.maxHp(u), u.hp + KNIGHT.regen * dt);
      }
      u.facing = lerpAngle(u.facing, face, Math.min(1, dt * 10));

      u.rig.root.position.copy(u.pos);
      u.rig.root.rotation.y = u.facing;
      u.rig.char.loop(walking ? 'Running_A' : 'Idle');
      if (u.swing === 1) u.rig.char.once(u.type === 'archer' ? '1H_Ranged_Shoot' : '1H_Melee_Attack_Chop', 1.6);
      u.rig.char.update(dt);
    }

    // Remove the fallen.
    this.units = this.units.filter((u) => {
      if (u.hp > 0) return true;
      if (u.home) u.home.units[u.slot] = null;
      this.root.remove(u.rig.root);
      u.rig.weaponMat.dispose();
      return false;
    });
  }

  /** Steps toward a point; returns whether it's still moving. */
  private walkTo(u: Unit, target: THREE.Vector3, dt: number, speed: number) {
    const dx = target.x - u.pos.x;
    const dz = target.z - u.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return false;
    const step = Math.min(d, speed * dt * Math.min(1, d / 0.6 + 0.3));
    u.pos.x += (dx / d) * step;
    u.pos.z += (dz / d) * step;
    u.pos.y = 0;
    return true;
  }

  private damageKnight(u: Unit, dmg: number) {
    u.hp -= dmg;
    u.lastHit = this.time;
    if (u.hp <= 0) {
      this.fx.p.death(v1.copy(u.pos).setY(0.8), COLORS.team);
      this.fx.text(v1.copy(u.pos).setY(2), 'Knight fell!', 'hurt');
    }
  }

  private updateTowers(dt: number) {
    for (const t of this.towers.values()) {
      t.grow = Math.min(1, t.grow + dt * 3);
      const g = t.grow;
      const s = g < 1 ? 1 + Math.sin(g * Math.PI) * 0.15 : 1;
      t.rig.root.scale.set(s, Math.max(0.02, Math.min(1, g * 1.2)) * s, s);

      const manned = t.units.filter((u) => u && u.state === 'station').length;
      const slots = TOWER_LEVELS[t.level].slots;
      this.hud.placeLabel(t.label, v1.copy(t.pos).setY(TOWER_LEVELS[t.level].ballista ? 7.2 : 6), `${t.units.filter(Boolean).length}/${slots}`, manned === 0);

      if (TOWER_LEVELS[t.level].ballista) {
        t.ballistaCd -= dt;
        const target = this.nearestEnemy(t.pos.x, t.pos.z, BALLISTA.range);
        if (target) {
          if (t.ballistaCd <= 0) {
            t.ballistaCd = BALLISTA.delay;
            v1.copy(t.pos).setY(5.2);
            this.fireBolt(v1, v2.set(target.x, 0.9, target.z));
            this.sfx.boom();
          }
        }
      }
    }
  }

  private updatePosts() {
    for (const p of this.posts.values()) {
      const slots = POST_LEVELS[p.level].slots;
      const n = p.units.filter(Boolean).length;
      this.hud.placeLabel(p.label, v1.copy(p.flag.position).setY(3.9), `${n}/${slots}`, n === 0);
      p.flag.rotation.y = Math.sin(this.time * 2 + p.s) * 0.15;
    }
  }

  private damageBarricade(b: Barricade, dmg: number) {
    b.hp -= dmg;
    b.lastHit = this.time;
    b.shake = 1;
    if (b.hp <= 0 && b.alive) {
      b.alive = false;
      b.mesh.visible = false;
      if (b.gate) {
        b.gate.rubble.visible = true;
        this.hud.banner('The gate has fallen!', true);
        this.fx.shake = Math.max(this.fx.shake, 0.7);
        this.events.haptic(true);
        // Archers on the wall come down with it.
        const t = this.towers.get(b.plot.def.id + '_wall');
        if (t) t.rig.root.visible = false;
      }
      this.fx.burst(v1.copy(b.pos).setY(0.6), COLORS.wood, 22, 5);
      this.fx.p.explosion(v1);
      this.sfx.pop();
    }
  }

  private updateBarricades(dt: number) {
    for (const b of this.barricades.values()) {
      if (b.gate && !b.alive && b.hp >= b.maxHp * 0.5) {
        // Builders have put it back together.
        b.alive = true;
        b.mesh.visible = true;
        b.rise = 0;
        b.gate.rubble.visible = false;
        const t = this.towers.get(b.plot.def.id + '_wall');
        if (t) t.rig.root.visible = true;
        this.fx.p.build(v1.copy(b.pos).setY(0.5));
        this.fx.text(v1.copy(b.pos).setY(3), 'Gate rebuilt!', 'good');
      }
      if (!b.alive) continue;
      b.rise = Math.min(1, b.rise + dt * 4);
      b.shake = Math.max(0, b.shake - dt * 5);
      b.mesh.scale.y = Math.max(0.02, b.rise);
      b.mesh.position.x = b.pos.x + (Math.random() - 0.5) * b.shake * 0.12;
      if (!b.gate && this.time - b.lastHit > 5) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.04 * dt);
    }
  }

  // ------------------------------------------------------------------ workshops & weapons

  private updateShops(dt: number) {
    for (const s of this.shops.values()) {
      if (s.rig.anim) s.rig.anim.rotation.z = Math.sin(this.time * 9) * 0.7;
      if (s.kind !== 'forge' && s.kind !== 'bowyer') continue;
      if (s.kind === 'forge' && Math.random() < dt * 8) this.fx.p.embers(v1.set(s.pos.x, 1.0, s.pos.z + 1.3));
      if (s.rig.chimney) {
        s.smokeT -= dt;
        if (s.smokeT <= 0) {
          s.smokeT = 0.35;
          this.fx.p.smoke(v1.copy(s.rig.chimney).add(s.pos));
        }
      }
      if (s.rack.length < WORKSHOP.rackMax) {
        s.timer += dt;
        const interval = WORKSHOP.interval[s.level - 1];
        if (s.timer >= interval) {
          s.timer = 0;
          s.rack.push(s.level);
          this.fx.p.sparkle(v1.copy(s.rackWorld).setY(1), s.kind === 'forge' ? 0xffb347 : 0xfff3c0, 6);
        }
      }
      // Draw the rack.
      const im = s.rackMesh!;
      im.count = s.rack.length;
      const tiers = s.kind === 'forge' ? SWORD_TIERS : BOW_TIERS;
      s.rack.forEach((tier, i) => {
        v1.copy(s.rig.rack).add(v2.set(-0.8 + i * 0.23, 0.45, -0.45));
        quat.setFromEuler(eul.set(0.15, 0, 0, 'XYZ'));
        mtx.compose(v1, quat, scl.set(1, 1, 1));
        im.setMatrixAt(i, mtx);
        im.setColorAt(i, col.set(tiers[tier].color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;

      // Pick up when standing by the rack.
      if (this.heroAlive && s.rack.length && this.weapons.length < PLAYER.maxWeapons && this.heroPos.distanceTo(s.rackWorld) < 2.4) {
        s.pickT -= dt;
        if (s.pickT <= 0) {
          s.pickT = 0.12;
          const tier = s.rack.pop()!;
          const kind: WeaponKind = s.kind === 'forge' ? 'sword' : 'bow';
          const from = v1.copy(s.rackWorld).setY(0.9).clone();
          this.fx.fly(from, () => this.frontTop(v3), 0.25, 0.8, () => {
            this.weapons.push({ kind, tier });
            this.weapons.sort((a, b) => (a.kind === b.kind ? a.tier - b.tier : a.kind < b.kind ? -1 : 1));
            this.sfx.pickup(4);
          });
        }
      } else s.pickT = 0;
    }
  }

  /** Hand carried weapons to nearby defenders who have something worse. */
  private updateWeapons(dt: number) {
    this.giveT -= dt;
    if (!this.heroAlive || !this.weapons.length || this.giveT > 0) return;
    for (let wi = this.weapons.length - 1; wi >= 0; wi--) {
      const w = this.weapons[wi];
      const type: UnitType = w.kind === 'sword' ? 'knight' : 'archer';
      let best: Unit | null = null;
      for (const u of this.units) {
        if (u.type !== type || u.tier >= w.tier) continue;
        if (Math.hypot(u.pos.x - this.heroPos.x, u.pos.z - this.heroPos.z) > 5) continue;
        if (!best || u.tier < best.tier) best = u;
      }
      if (!best) continue;
      this.weapons.splice(wi, 1);
      this.giveT = 0.18;
      const unit = best;
      const from = this.frontTop(new THREE.Vector3());
      this.fx.fly(from, () => v3.copy(unit.pos).setY(unit.pos.y + 1), 0.3, 1, () => {
        if (!this.units.includes(unit)) return;
        this.setTier(unit, Math.max(unit.tier, w.tier));
        const tiers = unit.type === 'archer' ? BOW_TIERS : SWORD_TIERS;
        this.fx.text(v1.copy(unit.pos).setY(unit.pos.y + 2.2), tiers[w.tier].name + '!', 'good');
        this.fx.p.levelUp(v1.copy(unit.pos).setY(unit.pos.y + 0.6));
        this.fx.ring(v1.copy(unit.pos), tiers[w.tier].color, 3, 0.5);
        this.sfx.build();
      });
      return;
    }
  }

  // ------------------------------------------------------------------ hall

  private damageHall(dmg: number) {
    this.hallHp -= dmg;
    this.hallLastHit = this.time;
    this.fx.p.explosion(v1.set((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3));
    this.events.hurt(0.25);
    this.fx.shake = Math.max(this.fx.shake, 0.15);
    if (this.hallHp <= 0 && !this.over) {
      this.hallHp = 0;
      this.over = true;
      this.sfx.boom();
      this.fx.p.explosion(v1.set(0, 2, 0));
      this.fx.p.build(v1);
      this.fx.shake = 1.5;
      this.events.haptic(true);
      this.events.onGameOver(this.wave);
    }
  }

  private updateHall(dt: number) {
    if (this.time - this.hallLastHit > 5) this.hallHp = Math.min(this.hallMax, this.hallHp + HALL.regen * dt);
    this.hall.banners.children.forEach((b, i) => (b.rotation.y = Math.sin(this.time * 2 + i) * 0.2));
    this.hud.setKeep(this.hallHp / this.hallMax);
  }

  // ------------------------------------------------------------------ guidance

  /** The single most useful next destination, if any. */
  private guideTarget(): THREE.Vector3 | null {
    const hx = this.heroPos.x;
    const hz = this.heroPos.z;
    const nearest = (pts: THREE.Vector3[]) => {
      let best: THREE.Vector3 | null = null;
      let bd = Infinity;
      for (const p of pts) {
        const d = (p.x - hx) ** 2 + (p.z - hz) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best;
    };
    // 1. Followers waiting for a home.
    const types = new Set(this.units.filter((u) => u.state === 'follow').map((u) => u.type));
    const homes: THREE.Vector3[] = [];
    if (types.has('archer')) for (const t of this.towers.values()) if (this.freeSlot(t) >= 0) homes.push(t.pos);
    if (types.has('knight')) for (const p of this.posts.values()) if (this.freeSlot(p) >= 0) homes.push(p.pos);
    if (homes.length) return nearest(homes);
    // 2. Carried weapons someone needs.
    const needs: THREE.Vector3[] = [];
    for (const w of this.weapons) {
      const type = w.kind === 'sword' ? 'knight' : 'archer';
      for (const u of this.units) if (u.type === type && u.tier < w.tier) needs.push(u.pos);
    }
    if (needs.length) return nearest(needs);
    // 3. A rack with upgrades waiting.
    if (this.weapons.length < PLAYER.maxWeapons) {
      const racks: THREE.Vector3[] = [];
      for (const s of this.shops.values()) {
        if (!s.rack.length) continue;
        const type = s.kind === 'forge' ? 'knight' : 'archer';
        const top = Math.max(...s.rack);
        if (this.units.some((u) => u.type === type && u.tier < top)) racks.push(s.rackWorld);
      }
      if (racks.length) return nearest(racks);
    }
    // 4. The cheapest-to-reach plot we can afford.
    if (this.carry > 0) {
      const ok = this.plots.filter((p) => p.shown && p.stocked && p.remaining <= this.carry).map((p) => p.pos);
      if (ok.length) return nearest(ok);
    }
    return null;
  }

  private updateGuide() {
    const target = this.heroAlive ? this.guideTarget() : null;
    const d = target ? Math.hypot(target.x - this.heroPos.x, target.z - this.heroPos.z) : 0;
    const show = target && d > 3;
    const n = this.guide.length;
    for (let i = 0; i < n; i++) {
      const dot = this.guide[i];
      const t = (i + ((this.time * 2) % 1)) / n;
      if (!show || t * d > d - 1.4) {
        dot.visible = false;
        continue;
      }
      dot.visible = true;
      dot.position.set(this.heroPos.x + (target!.x - this.heroPos.x) * t, 0.06, this.heroPos.z + (target!.z - this.heroPos.z) * t);
    }
  }

  private missingHint(p: Plot) {
    const w = Math.max(0, p.woodCost - this.kingdom.wood);
    const st = Math.max(0, p.stoneCost - this.kingdom.stone);
    if (w && !this.kingdom.camp) return `Needs ${w} wood. Build a Lumber Camp`;
    if (st && !this.kingdom.quarry) return `Needs ${st} stone. Build a Quarry`;
    return `Waiting for ${[w ? `${w} wood` : '', st ? `${st} stone` : ''].filter(Boolean).join(' and ')} from your workers`;
  }

  /** Castle upgrades: more health, more builders and townsfolk, and a bigger castle. */
  private upgradeCastle(level: number) {
    const L = CASTLE_LEVELS[Math.min(level, CASTLE_LEVELS.length - 1)];
    this.kingdom.setCastleLevel(Math.min(level, CASTLE_LEVELS.length - 1));
    const frac = this.hallHp / this.hallMax;
    this.hallMax = L.hp;
    this.hallHp = Math.min(this.hallMax, frac * this.hallMax + this.hallMax * 0.25);
    const scale = 1 + level * 0.1;
    this.hall.root.scale.setScalar(scale);
    this.hallRadius = HALL.radius * scale;
    this.hud.banner(`Your Keep is now a ${L.name}!`, false);
    this.fx.pillar(v1.set(0, 0, 0), 0xffe08a, 5, 1.4);
    this.fx.ring(v1, 0xffd34d, 12, 0.9);
    this.fx.p.levelUp(v1.set(0, 3, 0));
    this.events.flash(0.5);
    this.sfx.levelUp();
  }

  /** Gatehouse on a road: wooden, then stone, then a castle wall with archer posts. */
  private buildGate(p: Plot, lvl: number) {
    const def = p.def;
    const tier = GATE_TIERS[Math.min(lvl, GATE_TIERS.length - 1)];
    const pl = def.place as { road: number; t: number };
    const road = this.roads[pl.road];
    const s = road.length * pl.t;
    const pos = road.point(s, 0, new THREE.Vector3());
    road.tangent(s, v2);
    const right = new THREE.Vector3(-v2.z, 0, v2.x);
    const span = ROAD_HALF_WIDTH * 2 + 0.8;
    // Keep wings clear of towers, buildings, plots and the other road.
    const blockers: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: this.hallRadius + 1.5 }];
    for (const q of this.plots) if (q !== p && q.def.kind !== 'gate') blockers.push({ x: q.pos.x, z: q.pos.z, r: 1.8 });
    for (const t of this.towers.values()) blockers.push({ x: t.pos.x, z: t.pos.z, r: 2 });
    for (const sh of this.shops.values()) blockers.push({ x: sh.pos.x, z: sh.pos.z, r: 3 });
    const canPlace = (x: number) => {
      const wx = pos.x + right.x * x;
      const wz = pos.z + right.z * x;
      if (blockers.some((b) => Math.hypot(wx - b.x, wz - b.z) < b.r + 1.2)) return false;
      return this.roads.every((r, i) => i === pl.road || r.distanceTo(wx, wz) > ROAD_HALF_WIDTH + 1);
    };
    const group = S.makeGate(tier.gate, tier.wall, span, canPlace, tier.archers > 0);
    group.position.copy(pos);
    group.rotation.y = Math.atan2(v2.x, v2.z);
    this.root.add(group);

    let b = this.barricades.get(def.id);
    if (!b) {
      const rubble = S.prop('building_destroyed', span * 0.8, 'max');
      rubble.position.copy(pos);
      rubble.visible = false;
      this.root.add(rubble);
      b = { plot: p, road: pl.road, s, hp: tier.hp, maxHp: tier.hp, alive: true, mesh: group, pos, lastHit: -99, shake: 0, rise: 0, rebuildable: true, gate: { tier: lvl, rubble, right } };
      this.barricades.set(def.id, b);
    } else {
      this.root.remove(b.mesh);
      b.mesh = group;
      b.gate!.tier = lvl;
      b.maxHp = tier.hp;
      b.hp = tier.hp;
      b.alive = true;
      b.gate!.rubble.visible = false;
    }
    b.rise = 0;
    this.fx.p.build(v1.copy(pos).setY(0.5));
    this.fx.ring(pos, 0xffe08a, 9, 0.7);
    this.fx.text(v1.copy(pos).setY(4), `${tier.name}!`, 'good');
    this.hud.banner(`${tier.name} raised!`, false);

    // The castle gate has a walkway with archer posts.
    if (tier.archers > 0 && !this.towers.has(def.id + '_wall')) {
      const H = 3.1;
      const rig: S.TowerRig = {
        root: group,
        roof: new THREE.Group(),
        ballista: new THREE.Group(),
        base: new THREE.Group(),
        slots: [new THREE.Vector3(-1.6, H, -0.3), new THREE.Vector3(1.6, H, -0.3)],
      };
      const t: Tower = { plot: p, pos: pos.clone(), rig, level: 1, units: [null, null], ballistaCd: 0, grow: 1, label: this.hud.worldLabel('archer') };
      this.towers.set(def.id + '_wall', t);
    }
  }

  /** Arcane Nova: blast every enemy near the hero and shove them back up the road. */
  castNova() {
    if (this.nova < 1 || !this.heroAlive || this.over) return false;
    this.nova = 0;
    this.hud.setNova(0);
    const r2 = NOVA.radius * NOVA.radius;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if ((e.x - this.heroPos.x) ** 2 + (e.z - this.heroPos.z) ** 2 > r2) continue;
      if (!e.type.boss) e.s = Math.max(0, e.s - NOVA.knockback);
      e.spawnT = 0;
      this.hitEnemy(e, Math.round(NOVA.damage * this.stats.damage), true);
    }
    v1.copy(this.heroPos);
    this.fx.ring(v1, 0x9fe8ff, NOVA.radius * 1.2, 0.6);
    this.fx.ring(v1, 0xffffff, NOVA.radius * 0.8, 0.4);
    this.fx.pillar(v1, 0x9fe8ff, 2, 0.8);
    this.fx.p.emit({ pos: v1.clone().setY(1), count: 80, color: [0x9fe8ff, 0xffffff, 0xb48bff], speed: 16, up: 2, size: 0.45, life: 0.6, gravity: 2, drag: 2.5, shape: 1 });
    this.fx.shake = Math.max(this.fx.shake, 1);
    this.fx.punch = 1;
    this.hitstop = 0.12;
    this.events.flash(0.7);
    this.events.haptic(true);
    this.hero.char.once('Spellcast_Shoot', 1.2);
    this.sfx.boom();
    this.sfx.levelUp();
    return true;
  }

  private currentHint() {
    if (!this.heroAlive) return `Back in ${Math.ceil(this.respawnT)}…`;
    const built = (id: string) => this.isBuilt(id);
    if (!built('tw1')) return this.carry < 5 ? 'Defeat skeletons and grab their gold' : 'Stand on the plot to build a watchtower';
    const followers = this.units.filter((u) => u.state === 'follow');
    if (followers.some((u) => u.type === 'archer') && [...this.towers.values()].some((t) => this.freeSlot(t) >= 0))
      return 'Lead your archer to an empty watchtower';
    if (followers.some((u) => u.type === 'knight') && [...this.posts.values()].some((p) => this.freeSlot(p) >= 0))
      return 'Lead your knight to the guard post';
    if (followers.length) return 'Build another tower or post for your recruits';
    if (built('tw2') && !built('range')) return 'Towers need archers. Build an Archery Range';
    if (built('range') && this.units.filter((u) => u.type === 'archer').length < 2) return 'Recruit an archer at the range';
    if (built('gp1') && !built('barracks')) return 'Build Barracks to recruit knights';
    if (built('barracks') && !this.units.some((u) => u.type === 'knight')) return 'Recruit knights to hold the road';
    if (built('tw2') && !built('camp')) return 'Build a Lumber Camp: woodcutters will gather wood';
    if (built('camp') && !built('gateA')) return 'Raise a gate across the road to shield the castle';
    if (this.nova >= 1 && this.enemies.length > 4) return 'Arcane Nova is ready! Tap the button';
    if (this.weapons.length) {
      const k = this.weapons[this.weapons.length - 1].kind;
      return k === 'sword' ? 'Walk up to your knights to hand over swords' : 'Walk up to your archers to hand over crossbows';
    }
    for (const s of this.shops.values()) {
      if (!s.rack.length) continue;
      const type = s.kind === 'forge' ? 'knight' : 'archer';
      if (this.units.some((u) => u.type === type && u.tier < Math.max(...s.rack)))
        return s.kind === 'forge' ? 'Swords are ready at the Forge' : 'Crossbows are ready at the Bowyer';
    }
    return '';
  }

  // ------------------------------------------------------------------ teardown

  dispose() {
    this.kingdom.dispose();
    this.scene.remove(this.root);
    for (const p of this.plots) p.dispose();
    for (const e of this.enemies) if (e.bar) this.hud.removeBar(e.bar);
    for (const u of this.units) u.rig.weaponMat.dispose();
    this.hud.removeBar(this.heroBar);
    this.horde.begin();
    this.horde.end();
  }
}

const SHOP_NAMES: Record<Workshop['kind'], string> = {
  range: 'Archery Range!',
  barracks: 'Barracks!',
  forge: 'Forge! Making Iron Swords',
  bowyer: 'Bowyer! Making Crossbows',
};

/** After the first build, upgrade pads for workshops move beside the building. */
const SHOP_PAD_AFTER: Record<string, { x: number; z: number }> = {
  forge: { x: -13.4, z: -3.4 },
  bowyer: { x: 1.9, z: 12.6 },
};

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
