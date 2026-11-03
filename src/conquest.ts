import * as THREE from 'three';
import { BALLISTA, COLORS, ENEMIES, NOVA, PLAYER, type EnemyKind, type EnemyType, type GearId, type KingdomMap, type PlotDef, type PlotKind } from './config';
import * as M from './models';
import * as S from './structures';
import type { Horde } from './horde';
import { Plot } from './plot';
import { BASE_STATS, xpForLevel, type HeroStats, type Perk } from './perks';
import type { Fx } from './fx';
import type { Sfx } from './audio';
import type { Hud } from './hud';
import type { World } from './world';
import type { Assets } from './assets';
import {
  ARCHER_DMG,
  ARCHER_HP,
  ATTACKS,
  BOUNDS,
  CASTLE_NEEDS,
  FENCE_HP,
  FENCE_PIECE,
  FORGE,
  KEEP,
  KNIGHT_DMG,
  KNIGHT_HP,
  LANDS,
  LOOKOUT,
  MINE,
  RECRUIT,
  SPOTS,
  TIER_COLORS,
  TIER_NAMES,
  TREASURE,
  fenceCost,
  type BuildSpot,
} from './realm';
import { Territory } from './territory';

// One conquest of a kingdom. The king leads a squad through a wild forest, fences in land after land
// (each one turns green when closed), mans lookouts with archers and holds off the goblin hordes.
// Everything created here lives under `root` and is thrown away on restart.

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const mtx = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const col = new THREE.Color();

type UnitType = 'archer' | 'knight';

interface Enemy {
  kind: EnemyKind;
  type: EnemyType;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  atkCd: number;
  lunge: number;
  flash: number;
  moving: boolean;
  bar: HTMLElement | null;
  spawnT: number;
  deadT: number;
  animT: number;
}

interface Unit {
  type: UnitType;
  rig: S.UnitRig;
  mats: THREE.MeshStandardMaterial[];
  pos: THREE.Vector3;
  tier: number;
  state: 'squad' | 'jump' | 'post';
  post: Lookout | null;
  slot: number;
  cd: number;
  hp: number;
  lastHit: number;
  facing: number;
  swing: number;
  jumpT: number;
  jumpFrom: THREE.Vector3;
  bar: HTMLElement;
  /** Animation time not yet applied (posted archers animate at a lower rate). */
  animDt: number;
}

interface Fence {
  id: string;
  /** 'x': runs along x at z = c; 'z': runs along z at x = c. */
  axis: 'x' | 'z';
  c: number;
  a: number;
  b: number;
  lands: number[];
  plot: Plot;
  built: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  group: THREE.Object3D | null;
  tier: 'wood' | 'stone' | 'castle';
  rise: number;
  shake: number;
  lastHit: number;
  /** Between two claimed lands: no longer part of the border, sinks away. */
  interior: boolean;
  sink: number;
  mid: THREE.Vector3;
  everBuilt: boolean;
}

interface Lookout {
  spot: BuildSpot;
  pos: THREE.Vector3;
  root: THREE.Group;
  ballista: THREE.Object3D;
  slots: THREE.Vector3[];
  level: number;
  units: (Unit | null)[];
  ballistaCd: number;
  grow: number;
  label: HTMLElement;
  pad: Pad;
}

interface Shop {
  kind: 'range' | 'barracks' | 'forge';
  plot: Plot;
  rig: S.WorkshopRig;
  pos: THREE.Vector3;
  level: number;
  timer: number;
  rack: number[];
  rackMesh: THREE.InstancedMesh | null;
  rackWorld: THREE.Vector3;
  pickT: number;
  smokeT: number;
  recruit: Plot | null;
  recruits: number;
}

interface Mine {
  plot: Plot;
  pos: THREE.Vector3;
  level: number;
  timer: number;
  bars: number;
  pile: THREE.InstancedMesh;
  drop: THREE.Vector3;
  takeT: number;
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

interface Treasure {
  root: THREE.Object3D;
  pos: THREE.Vector3;
  coins: number;
  t: number;
}

interface Villager {
  char: ReturnType<typeof S.makeNpc>;
  pos: THREE.Vector3;
  to: THREE.Vector3;
  wait: number;
  facing: number;
}

interface SpawnItem {
  at: number;
  kind: EnemyKind;
  x: number;
  z: number;
}

export interface RunEvents {
  onGameOver(wave: number): void;
  onVictory(): void;
  haptic(strong: boolean): void;
  hurt(amount: number): void;
  flash(amount: number): void;
}

export const MAX_ENEMIES: Record<EnemyKind, number> = { goblin: 600, runner: 260, troll: 24 };

/** A ground pad that sends squad archers up a lookout. Shows filled / total slots. */
class Pad {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';
  pulse = 0;
  constructor(readonly pos: THREE.Vector3) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(pos.x, 0.05, pos.z);
    this.mesh.renderOrder = 2;
  }
  draw(filled: number, total: number, active: boolean) {
    const key = `${filled}/${total}/${active}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.ctx;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.78)';
    g.strokeStyle = 'rgba(60,40,20,0.8)';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(8, 8, 112, 112, 18);
    g.fill();
    g.stroke();
    // Two little soldiers.
    g.fillStyle = filled < total ? '#3a2a1a' : '#4caf50';
    for (const [x, sz] of [
      [46, 1],
      [78, 0.85],
    ] as const) {
      g.beginPath();
      g.arc(x, 44 - (1 - sz) * 6, 11 * sz, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.roundRect(x - 14 * sz, 58 - (1 - sz) * 6, 28 * sz, 26 * sz, 8);
      g.fill();
    }
    g.font = 'bold 30px "Lilita One", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#2a1a0a';
    g.fillText(`${filled}/${total}`, 64, 104);
    this.tex.needsUpdate = true;
  }
  dispose() {
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}

let chevronGeo: THREE.BufferGeometry | null = null;
function chevron() {
  if (!chevronGeo) {
    const s = new THREE.Shape();
    s.moveTo(-0.32, -0.16);
    s.lineTo(0, 0.14);
    s.lineTo(0.32, -0.16);
    s.lineTo(0.32, 0.02);
    s.lineTo(0, 0.32);
    s.lineTo(-0.32, 0.02);
    s.closePath();
    chevronGeo = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  }
  return chevronGeo;
}

export class Conquest {
  readonly root = new THREE.Group();
  time = 0;
  /** Attacks survived so far. */
  wave = 0;
  over = false;
  won = false;

  // Hero
  hero = S.makeHero();
  heroPos = new THREE.Vector3(0, 0, 6.5);
  heroVel = new THREE.Vector3();
  heroFacing = Math.PI;
  heroHp = PLAYER.maxHp;
  stats: HeroStats = { ...BASE_STATS };
  perkLevels: Record<string, number> = {};
  xp = 0;
  level = 1;
  pendingLevelUps = 0;
  combo = 0;
  bestCombo = 0;
  kills = 0;
  hitstop = 0;
  heroAlive = true;
  carry = 0;
  kits: number[] = [];
  nova = 0;
  private lastKill = -99;
  private stepT = 0;
  private respawnT = 0;
  private heroCd = 0;
  private heroLastHit = -99;
  private stack: THREE.InstancedMesh;
  private kitStack: THREE.InstancedMesh;
  private stackLean = new THREE.Vector2();
  private pickupCombo = 0;
  private pickupComboT = 0;
  private heroBar: HTMLElement;
  private giveT = 0;
  private novaRate = 1;

  // Keep
  keep = { root: new THREE.Group(), model: null as THREE.Object3D | null };
  castleLevel = 0;
  keepHp = KEEP[0].hp;
  keepMax = KEEP[0].hp;
  private keepRise = 1;
  private keepLastHit = -99;

  // Realm
  territory: Territory;
  claimed = new Set<number>();
  fences: Fence[] = [];
  plots: Plot[] = [];
  private spotPlots = new Map<string, Plot>();
  private lookouts = new Map<string, Lookout>();
  private shops = new Map<string, Shop>();
  private mines = new Map<string, Mine>();
  private treasures: Treasure[] = [];
  private villagers: Villager[] = [];
  private houses: { o: THREE.Object3D; rise: number }[] = [];
  private fenceFallenAt = -99;

  // Armies
  enemies: Enemy[] = [];
  private corpses: Enemy[] = [];
  private grid = new Map<number, Enemy[]>();
  units: Unit[] = [];

  // Projectiles & pickups
  private arrows: Arrow[] = [];
  private bolts: Bolt[] = [];
  private coins: GroundCoin[] = [];
  private chests: Chest[] = [];
  private guide: THREE.Mesh[] = [];

  // Paying
  private payT = 0;
  private payStreak = 0;
  private activePlot: Plot | null = null;
  private deployT = 0;

  // Attacks
  private queue: SpawnItem[] = [];
  private nextAttack = ATTACKS.first;
  private finalAttack = false;
  private finalSpawned = false;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private fx: Fx,
    private sfx: Sfx,
    private hud: Hud,
    private events: RunEvents,
    private horde: Horde,
    readonly map: KingdomMap,
    assets: Assets,
    gear: Partial<Record<GearId, number>> = {},
  ) {
    const lv = (id: GearId) => gear[id] ?? 0;
    this.stats.damage *= 1 + 0.12 * lv('sword');
    this.stats.maxHp *= 1 + 0.15 * lv('armor');
    this.stats.speed *= 1 + 0.05 * lv('boots');
    this.stats.allies *= 1 + 0.08 * lv('banner');
    this.novaRate = 1 + 0.12 * lv('scepter');
    this.heroHp = this.stats.maxHp;
    scene.add(this.root);

    this.root.add(this.keep.root);
    this.setKeepModel(0);
    this.root.add(this.hero.root);
    this.hero.root.position.copy(this.heroPos);

    this.territory = new Territory(this.root, assets, map.palette, [{ x: 0, z: 0, r: 5 }]);

    this.stack = new THREE.InstancedMesh(M.GEO.coin, M.MAT.coin, MAX_STACK);
    this.stack.count = 0;
    this.stack.castShadow = true;
    this.stack.frustumCulled = false;
    this.hero.backAnchor.add(this.stack);
    this.kitStack = new THREE.InstancedMesh(S.kitGeometry(), S.weaponItemMaterial(), 30);
    this.kitStack.count = 0;
    this.kitStack.castShadow = true;
    this.kitStack.frustumCulled = false;
    this.kitStack.setColorAt(0, col.setRGB(1, 1, 1));
    this.hero.frontAnchor.add(this.kitStack);
    this.heroBar = hud.worldBar('hero');

    for (let i = 0; i < 260; i++) {
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
    for (let i = 0; i < 360; i++) {
      const mesh = new THREE.Mesh(M.GEO.coin, M.MAT.coin);
      mesh.castShadow = true;
      mesh.visible = false;
      this.root.add(mesh);
      this.coins.push({ value: 1, mesh, vel: new THREE.Vector3(), active: false, age: 0 });
    }
    const chevMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.95, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Mesh(chevron(), chevMat);
      d.visible = false;
      d.renderOrder = 3;
      this.root.add(d);
      this.guide.push(d);
    }

    this.createFences();
    this.createSpots();
    this.createTreasure();

    // A little gold at the king's feet teaches the collect → build loop straight away.
    const start = PLAYER.startGold + 10 * lv('treasury');
    for (let i = 0; i < start; i++) this.dropCoin(v1.set(-2.5 + (i % 6) * 1.0, 0.3, 8.5 + Math.floor(i / 6) * 0.9), 0.4, 1);
  }

  // ------------------------------------------------------------------ layout

  private createFences() {
    const seen = new Map<string, Fence>();
    const add = (axis: 'x' | 'z', c: number, a: number, b: number, land: number) => {
      for (let p = a; p < b - 0.1; p += FENCE_PIECE) {
        const id = `${axis}${c}:${p}`;
        const f = seen.get(id);
        if (f) {
          f.lands.push(land);
          continue;
        }
        const mid = axis === 'x' ? new THREE.Vector3(p + FENCE_PIECE / 2, 0, c) : new THREE.Vector3(c, 0, p + FENCE_PIECE / 2);
        const def: PlotDef = { id, kind: 'wall', costs: [fenceCost(0)] };
        const plot = new Plot(def);
        this.root.add(plot.group);
        this.plots.push(plot);
        const fence: Fence = {
          id,
          axis,
          c,
          a: p,
          b: p + FENCE_PIECE,
          lands: [land],
          plot,
          built: false,
          alive: false,
          hp: 0,
          maxHp: 1,
          group: null,
          tier: 'wood',
          rise: 1,
          shake: 0,
          lastHit: -99,
          interior: false,
          sink: 0,
          mid,
          everBuilt: false,
        };
        seen.set(id, fence);
        this.fences.push(fence);
      }
    };
    for (const L of LANDS) {
      add('x', L.z0, L.x0, L.x1, L.id);
      add('x', L.z1, L.x0, L.x1, L.id);
      add('z', L.x0, L.z0, L.z1, L.id);
      add('z', L.x1, L.z0, L.z1, L.id);
    }
    this.placeFencePlots();
  }

  /** Fence pads sit just inside the land being fenced (the open one, for shared fences). */
  private placeFencePlots() {
    for (const f of this.fences) {
      const target = f.lands.find((l) => !this.claimed.has(l) && this.isOpen(l)) ?? f.lands.find((l) => this.claimed.has(l)) ?? f.lands[0];
      const L = LANDS[target];
      const cx = (L.x0 + L.x1) / 2;
      const cz = (L.z0 + L.z1) / 2;
      const inX = f.axis === 'z' ? Math.sign(cx - f.c) * 2.1 : 0;
      const inZ = f.axis === 'x' ? Math.sign(cz - f.c) * 2.1 : 0;
      f.plot.setPos(f.mid.x + inX, f.mid.z + inZ);
    }
  }

  private createSpots() {
    for (const sp of SPOTS) {
      const kind: PlotKind = sp.kind === 'lookout' ? 'tower' : (sp.kind as PlotKind);
      const def: PlotDef = { id: sp.id, kind, costs: [...sp.costs] };
      const p = new Plot(def);
      p.setPos(sp.x, sp.z);
      this.root.add(p.group);
      this.plots.push(p);
      this.spotPlots.set(sp.id, p);
    }
  }

  /** Piles of coins lying in the forest: a reason to venture out. */
  private createTreasure() {
    let seed = 7 + this.map.mapX;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const L of LANDS) {
      const n = L.id === 0 ? 1 : TREASURE.perLand;
      for (let i = 0; i < n; i++) {
        for (let tries = 0; tries < 30; tries++) {
          const x = L.x0 + 3 + rnd() * 14;
          const z = L.z0 + 3 + rnd() * 14;
          if (Math.hypot(x, z) < 7) continue;
          if (SPOTS.some((s) => Math.hypot(s.x - x, s.z - z) < 3.6)) continue;
          if (this.treasures.some((t) => t.pos.distanceTo(v1.set(x, 0, z)) < 6)) continue;
          const root = S.prop('coin_stack_large', 1.1, 'max');
          root.position.set(x, 0, z);
          this.root.add(root);
          this.treasures.push({ root, pos: new THREE.Vector3(x, 0, z), coins: TREASURE.coins + L.id * 2, t: rnd() * 6 });
          break;
        }
      }
    }
  }

  /** A land is open for fencing once it touches claimed land (Kingsfield is open from the start). */
  isOpen(land: number) {
    if (land === 0) return true;
    const L = LANDS[land];
    for (const c of this.claimed) {
      const o = LANDS[c];
      const touchX = (L.x0 === o.x1 || L.x1 === o.x0) && L.z0 === o.z0;
      const touchZ = (L.z0 === o.z1 || L.z1 === o.z0) && L.x0 === o.x0;
      if (touchX || touchZ) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ small utilities

  private stackTop(out: THREE.Vector3) {
    const n = Math.min(this.carry, MAX_STACK);
    out.set(0, n * 0.11 + 0.05, 0);
    return this.hero.backAnchor.localToWorld(out);
  }

  private frontTop(out: THREE.Vector3) {
    out.set(0, this.kits.length * 0.16, 0.1);
    return this.hero.frontAnchor.localToWorld(out);
  }

  private dropCoin(at: THREE.Vector3, spread = 2.5, value = this.coinValue) {
    const c = this.coins.find((q) => !q.active);
    if (!c) {
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

  /** Gold per coin grows slowly as the conquest goes on. */
  get coinValue() {
    return 1 + Math.floor(this.claimed.size / 3);
  }

  get claimedCount() {
    return this.claimed.size;
  }

  // ------------------------------------------------------------------ main update

  update(dt: number, move: { x: number; y: number }) {
    if (this.over) return;
    this.time += dt;
    this.updateHero(dt, move);
    this.updateAttacks();
    this.updateEnemies(dt);
    this.updateUnits(dt);
    this.updateLookouts(dt);
    this.updateShops(dt);
    this.updateKits(dt);
    this.updateMines(dt);
    this.updateArrows(dt);
    this.updateBolts(dt);
    this.updateCoins(dt);
    this.updateTreasure(dt);
    this.updateChests(dt);
    this.updatePlots(dt);
    this.updateFences(dt);
    this.updateKeep(dt);
    this.updateVillagers(dt);
    this.territory.update(dt);
    this.territory.fadeAround(this.heroPos, dt);
    this.updateGuide();
    this.updateStacks(dt);
    this.drawCrowd(dt);
    this.hud.setGold(this.carry);
    const squad = this.units.filter((u) => u.state !== 'post');
    this.hud.setResources(squad.filter((u) => u.type === 'archer').length, squad.filter((u) => u.type === 'knight').length, this.claimedCount);
    if (!this.chests.some((c) => c.open === 0)) this.hud.hint(this.currentHint());
    if (this.time - this.lastKill > 2.2 && this.combo) {
      this.combo = 0;
      this.hud.setCombo(0);
    }
    if (this.keepHp / this.keepMax < 0.3) this.events.hurt(0.25 + Math.sin(this.time * 6) * 0.15);
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
        this.heroPos.set(0, 0, KEEP[this.castleLevel].radius + 2.5);
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
    this.heroPos.x = THREE.MathUtils.clamp(this.heroPos.x, -BOUNDS, BOUNDS);
    this.heroPos.z = THREE.MathUtils.clamp(this.heroPos.z, -BOUNDS, BOUNDS);
    this.pushOutOfBuildings(this.heroPos, 0.45);

    const moving = this.heroVel.lengthSq() > 0.01;
    if (moving) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.11;
        this.fx.p.dust(v1.copy(this.heroPos).setY(0.1));
      }
    }
    // The squad ring around the king grows with the squad.
    const n = this.units.filter((u) => u.state === 'squad').length;
    const ringR = n ? formationRadius(n) + 0.7 : 1.05;
    rig.ring.scale.setScalar(THREE.MathUtils.lerp(rig.ring.scale.x, ringR, Math.min(1, dt * 5)));
    rig.ring.rotation.z += dt * 0.6;
    (rig.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(this.time * 4) * 0.1;

    this.heroCd -= dt;
    const target = this.nearestEnemy(this.heroPos.x, this.heroPos.z, PLAYER.range);
    let face = moving ? Math.atan2(this.heroVel.x, this.heroVel.z) : this.heroFacing;
    if (target) {
      face = Math.atan2(target.x - this.heroPos.x, target.z - this.heroPos.z);
      if (this.heroCd <= 0) {
        this.heroCd = PLAYER.fireDelay * this.stats.fireDelay;
        rig.muzzle.getWorldPosition(v1);
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
        if (!moving) rig.char.once('1H_Melee_Attack_Stab', 2.2);
        this.sfx.shoot();
      }
    }
    this.heroFacing = lerpAngle(this.heroFacing, face, Math.min(1, dt * 14));
    rig.root.position.copy(this.heroPos);
    rig.root.rotation.y = this.heroFacing;
    rig.ring.rotation.y = -this.heroFacing;
    rig.char.loop(moving ? 'Running_A' : 'Idle');
    rig.char.update(dt);

    if (this.time - this.heroLastHit > 3) this.heroHp = Math.min(this.stats.maxHp, this.heroHp + PLAYER.regen * dt);
    const frac = this.heroHp / this.stats.maxHp;
    this.hud.placeBar(this.heroBar, frac < 0.999 ? v1.copy(this.heroPos).setY(2.7) : null, frac);
  }

  get heroDamage() {
    return Math.round(PLAYER.baseDamage * (1 + this.castleLevel * 0.12) * this.stats.damage);
  }

  private nearestExcept(x: number, z: number, range: number, skip: Set<Enemy>) {
    let best: Enemy | null = null;
    let bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || skip.has(e) || e.spawnT > 0) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  nearestEnemy(x: number, z: number, range: number) {
    let best: Enemy | null = null;
    let bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

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

  private pushOutOfBuildings(p: THREE.Vector3, r: number) {
    const solid: [number, number, number][] = [[0, -0.2, KEEP[this.castleLevel].radius]];
    for (const s of this.shops.values()) solid.push([s.pos.x, s.pos.z - 0.3, 1.9]);
    for (const l of this.lookouts.values()) solid.push([l.pos.x, l.pos.z, 1.5]);
    for (const m of this.mines.values()) solid.push([m.pos.x, m.pos.z - 0.3, 1.7]);
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
    // The coin tower on the king's back, leaning and swaying with momentum. It can grow sky-high.
    const n = Math.min(this.carry, MAX_STACK);
    this.stack.count = n;
    const tx = this.heroAlive ? -this.heroVel.x * 0.005 : 0;
    const tz = this.heroAlive ? -this.heroVel.z * 0.005 : 0;
    this.stackLean.x += (tx - this.stackLean.x) * Math.min(1, dt * 5);
    this.stackLean.y += (tz - this.stackLean.y) * Math.min(1, dt * 5);
    const c = Math.cos(-this.heroFacing);
    const s = Math.sin(-this.heroFacing);
    const lx = this.stackLean.x * c + this.stackLean.y * s;
    const lz = -this.stackLean.x * s + this.stackLean.y * c;
    for (let i = 0; i < n; i++) {
      const f = (i / 60) ** 1.6 * 2.2;
      const wob = Math.sin(this.time * 2.5 + i * 0.09) * 0.0012 * i;
      v1.set(lx * f + wob, i * 0.11, lz * f);
      quat.setFromAxisAngle(UP, i * 0.4);
      mtx.compose(v1, quat, scl.set(1, 1, 1));
      this.stack.setMatrixAt(i, mtx);
    }
    this.stack.instanceMatrix.needsUpdate = true;

    // Forge kits stacked in the king's arms.
    this.kitStack.count = this.kits.length;
    this.kits.forEach((tier, i) => {
      v1.set(0, i * 0.16, 0);
      quat.setFromAxisAngle(UP, i * 0.5);
      mtx.compose(v1, quat, scl.set(1, 1, 1));
      this.kitStack.setMatrixAt(i, mtx);
      this.kitStack.setColorAt(i, col.set(TIER_COLORS[tier]));
    });
    this.kitStack.instanceMatrix.needsUpdate = true;
    if (this.kitStack.instanceColor) this.kitStack.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ attacks

  private updateAttacks() {
    while (this.queue.length && this.queue[0].at <= this.time) {
      const it = this.queue.shift()!;
      this.spawn(it.kind, it.x, it.z);
    }
    if (this.finalAttack) {
      if (this.queue.length === 0) this.finalSpawned = true;
      if (this.finalSpawned && this.enemies.length === 0 && !this.won) this.victory();
      this.hud.setWave('Final battle!', 1);
      return;
    }
    // Every land claimed: the goblin warlords make their last stand.
    if (this.claimedCount === LANDS.length && !this.finalAttack) {
      this.finalAttack = true;
      this.launchAttack(true);
      return;
    }
    const left = this.nextAttack - this.time;
    if (left <= 0 && this.queue.length === 0) this.launchAttack(false);
    this.hud.setWave(`Lands ${this.claimedCount}/${LANDS.length}`, 1 - Math.max(0, left) / ATTACKS.every);
  }

  private launchAttack(final: boolean) {
    const n = ++this.wave;
    this.nextAttack = this.time + ATTACKS.every;
    const mul = this.map.countMul * (final ? 1.6 : 1);
    const total = Math.round((ATTACKS.base + (n - 1) * ATTACKS.perAttack + this.claimedCount * ATTACKS.perLand) * mul);
    const trolls = final ? 3 + Math.floor(this.map.hpMul) : n % ATTACKS.bossEvery === 0 ? Math.ceil(n / (ATTACKS.bossEvery * 2)) : 0;
    const items: SpawnItem[] = [];
    // Warbands come out of the fog from a few directions at once.
    const bands = Math.min(5, 1 + Math.floor(n / 3) + (final ? 2 : 0));
    let left = total;
    for (let b = 0; b < bands; b++) {
      const size = b === bands - 1 ? left : Math.round(total / bands);
      left -= size;
      const a = Math.random() * Math.PI * 2;
      const t0 = this.time + 0.4 + b * 2.5;
      for (let i = 0; i < size; i++) {
        const aa = a + (Math.random() - 0.5) * 0.3;
        const R = 50 + Math.random() * 4;
        const kind: EnemyKind = n >= 2 && Math.random() < 0.22 ? 'runner' : 'goblin';
        items.push({ at: t0 + i * 0.07, kind, x: Math.cos(aa) * R, z: Math.sin(aa) * R });
      }
    }
    for (let i = 0; i < trolls; i++) {
      const a = Math.random() * Math.PI * 2;
      items.push({ at: this.time + 3 + i * 4, kind: 'troll', x: Math.cos(a) * 50, z: Math.sin(a) * 50 });
    }
    items.sort((a, b) => a.at - b.at);
    this.queue = items;
    if (final) {
      this.hud.banner('The Warlord’s Host attacks!', true);
      this.sfx.boss();
      this.fx.shake = Math.max(this.fx.shake, 0.6);
    } else if (trolls) {
      this.hud.banner('Ogre warlord incoming!', true);
      this.sfx.boss();
    } else {
      this.hud.banner(`Goblin raid ${n}!`, false);
      this.sfx.wave();
    }
  }

  private victory() {
    this.won = true;
    this.over = true;
    this.hud.banner(`${this.map.name} is yours!`, false);
    this.fx.p.levelUp(v1.copy(this.heroPos).setY(0.5));
    this.fx.pillar(this.heroPos, 0xffd34d, 2, 1.5);
    this.hero.char.once('Cheer', 1);
    this.events.flash(0.7);
    this.sfx.treasure();
    this.events.onVictory();
  }

  private spawn(kind: EnemyKind, x: number, z: number) {
    if (this.enemies.filter((e) => e.kind === kind).length >= MAX_ENEMIES[kind]) return;
    const type = ENEMIES[kind];
    const grow = 1 + ATTACKS.hpPerLand * this.claimedCount + ATTACKS.hpPerAttack * (this.wave - 1);
    const hp = Math.round(type.hp * this.map.hpMul * grow * (type.boss ? 1 + this.wave * 0.08 : 1));
    this.enemies.push({
      kind,
      type,
      x,
      z,
      facing: Math.atan2(-x, -z),
      hp,
      maxHp: hp,
      alive: true,
      atkCd: 0.5,
      lunge: 0,
      flash: 0,
      moving: true,
      bar: type.boss ? this.hud.worldBar('enemy big') : null,
      spawnT: 0,
      deadT: -1,
      animT: Math.random(),
    });
    if (type.boss) this.fx.shake = Math.max(this.fx.shake, 0.4);
  }

  // ------------------------------------------------------------------ enemies

  private gridKey(x: number, z: number) {
    return (Math.floor(x / 1.6) + 512) * 4096 + (Math.floor(z / 1.6) + 512);
  }

  /** A standing border fence between (x, z) and (nx, nz), if any. */
  private fenceBetween(x: number, z: number, nx: number, nz: number, r: number) {
    for (const f of this.fences) {
      if (!f.alive || f.interior) continue;
      const [p, np, q] = f.axis === 'x' ? [z, nz, x] : [x, nx, z];
      if (q < f.a - r || q > f.b + r) continue;
      const side = p - f.c >= 0 ? 1 : -1;
      if ((np - f.c) * side < r && Math.abs(p - f.c) < r + 1.2) return f;
    }
    return null;
  }

  private updateEnemies(dt: number) {
    this.grid.clear();
    for (const e of this.enemies) {
      const k = this.gridKey(e.x, e.z);
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, (cell = []));
      cell.push(e);
    }
    const squad = this.units.filter((u) => u.state === 'squad');
    const keepR = KEEP[this.castleLevel].radius;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const t = e.type;
      e.atkCd -= dt;
      e.lunge = Math.max(0, e.lunge - dt * 4);
      e.flash = Math.max(0, e.flash - dt * 7);

      let attack: (() => void) | null = null;
      let faceX = 0;
      let faceZ = 0;
      // Where to: the king if he's close, else whoever of his squad is close, else the keep.
      let tx = 0;
      let tz = 0;
      const hd = Math.hypot(this.heroPos.x - e.x, this.heroPos.z - e.z);
      if (this.heroAlive && hd < 7.5) {
        tx = this.heroPos.x;
        tz = this.heroPos.z;
        if (hd < t.radius + 0.7) {
          attack = () => this.damageHero(t.damage);
          faceX = tx - e.x;
          faceZ = tz - e.z;
        }
      }
      if (!attack && hd < 14) {
        let best: Unit | null = null;
        let bd = 25;
        for (const u of squad) {
          const d = (u.pos.x - e.x) ** 2 + (u.pos.z - e.z) ** 2;
          if (d < bd) {
            bd = d;
            best = u;
          }
        }
        if (best) {
          if (hd >= 7.5) {
            tx = best.pos.x;
            tz = best.pos.z;
          }
          if (Math.sqrt(bd) < t.radius + 0.55) {
            const u = best;
            attack = () => this.damageUnit(u, t.damage);
            faceX = u.pos.x - e.x;
            faceZ = u.pos.z - e.z;
          }
        }
      }
      const dk = Math.hypot(e.x, e.z);
      if (!attack && dk < keepR + t.radius + 0.35) {
        attack = () => this.damageKeep(t.damage);
        faceX = -e.x;
        faceZ = -e.z;
      }

      let moved = false;
      if (!attack) {
        const dx = tx - e.x;
        const dz = tz - e.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = t.speed * dt;
        const nx = e.x + (dx / d) * step;
        const nz = e.z + (dz / d) * step;
        const f = this.fenceBetween(e.x, e.z, nx, nz, t.radius);
        if (f) {
          attack = () => this.damageFence(f, t.damage);
          if (f.axis === 'x') faceZ = f.c - e.z;
          else faceX = f.c - e.x;
        } else {
          e.x = nx;
          e.z = nz;
          moved = true;
        }
        if (!faceX && !faceZ) e.facing = lerpAngle(e.facing, Math.atan2(dx, dz), Math.min(1, dt * 8));
      }
      if (attack && e.atkCd <= 0) {
        e.atkCd = t.boss ? 1.4 : 1.0;
        e.lunge = 1;
        attack();
      }
      e.moving = moved;

      // Separation, never pushing anyone through a standing fence.
      const ox = e.x;
      const oz = e.z;
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
        if (!this.fenceBetween(ox, oz, ox + px, oz + pz, t.radius * 0.6)) {
          e.x += px;
          e.z += pz;
        }
      }
      if (faceX || faceZ) e.facing = Math.atan2(faceX, faceZ);
      if (e.bar) this.hud.placeBar(e.bar, v1.set(e.x, 4.2, e.z), e.hp / e.maxHp);
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
      if (!e.moving) {
        e.animT += dt;
        h.add(e.kind, 'attack', e.animT * 1.3, x, 0, z, e.facing, 0, size, bright);
      } else {
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
    v1.set(e.x, e.type.boss ? 2.2 : 1.0, e.z);
    if (crit) this.fx.p.crit(v1);
    else this.fx.p.hit(v1, e.kind === 'troll' ? 0xc9d4de : 0xffffff);
    this.fx.text(v1.set(e.x, e.type.boss ? 3.4 : 1.8, e.z), crit ? `${dmg}!` : `-${dmg}`, crit ? 'crit' : '');
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

    this.nova = Math.min(1, this.nova + (e.type.boss ? 0.3 : this.novaRate / NOVA.killsToCharge));
    this.hud.setNova(this.nova);
    this.xp += e.type.boss ? 20 : 1;
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      this.pendingLevelUps++;
    }
    this.hud.setXp(this.level, this.xp / xpForLevel(this.level));

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
      this.hud.banner('Ogre slain!', false);
      this.spawnChest(v1, 20 + this.wave * 4);
    }
  }

  // ------------------------------------------------------------------ chests & treasure

  private spawnChest(at: THREE.Vector3, gold: number) {
    const root = new THREE.Group();
    const chest = S.makeChest();
    root.add(chest.root);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 7, 16, 1, true).translate(0, 3.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    root.add(beam);
    root.position.set(at.x, 0, at.z);
    this.root.add(root);
    this.chests.push({ root, lid: chest.lid, pos: new THREE.Vector3(at.x, 0, at.z), vy: 7, y: 0.01, open: 0, gold, beam });
    this.hud.hint('A treasure chest! Go grab it');
  }

  private updateChests(dt: number) {
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const c = this.chests[i];
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
          this.hud.banner(`+${c.gold * this.coinValue} gold!`, false);
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

  private updateTreasure(dt: number) {
    for (let i = this.treasures.length - 1; i >= 0; i--) {
      const t = this.treasures[i];
      t.t += dt;
      if (Math.random() < dt * 3) this.fx.p.sparkle(v1.copy(t.pos).setY(0.6 + Math.random() * 0.6), 0xffe066);
      t.root.position.y = Math.abs(Math.sin(t.t * 2)) * 0.12;
      if (!this.heroAlive || Math.hypot(this.heroPos.x - t.pos.x, this.heroPos.z - t.pos.z) > 1.8) continue;
      // Scoop: the pile bursts into the king's stack.
      this.root.remove(t.root);
      this.treasures.splice(i, 1);
      this.fx.p.coinBurst(v1.copy(t.pos).setY(0.8));
      this.fx.ring(t.pos, 0xffd34d, 4);
      this.sfx.treasure();
      this.events.haptic(false);
      for (let k = 0; k < t.coins; k++) {
        const from = v1.copy(t.pos).setY(0.5 + k * 0.05).clone();
        this.fx.fly(from, () => this.stackTop(v3), 0.25 + k * 0.03, 1.6, () => this.gainCoin(this.coinValue));
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
      this.fx.p.trail(a.pos, a.hero ? (this.stats.splash ? 0xff8a2e : this.stats.chain ? 0x8fe3ff : 0xffd86b) : 0xffffff, a.hero ? 0.28 : 0.2);
    }
  }

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
      // The squad scoops up gold too: a bigger squad, a wider sweep.
      const squadR = formationRadius(this.units.filter((u) => u.state === 'squad').length);
      const far = c.age > PLAYER.coinAutoCollect;
      const mag = Math.max(PLAYER.magnet * this.stats.magnet, squadR + 1.2);
      if (far || dx * dx + dz * dz < mag * mag) {
        c.active = false;
        c.mesh.visible = false;
        const value = c.value;
        this.fx.fly(p.clone(), () => this.stackTop(v3), far ? 0.7 : 0.28, far ? 3 : 1.2, () => this.gainCoin(value));
      }
    }
  }

  // ------------------------------------------------------------------ plots & building

  private spotOpen(sp: BuildSpot) {
    // Lookouts (and everything in Kingsfield) can go up before the land is fenced in.
    return sp.kind === 'lookout' || sp.land === 0 ? this.isOpen(sp.land) : this.claimed.has(sp.land);
  }

  private plotVisible(p: Plot) {
    if (p.maxed) return false;
    if (p.def.kind === 'wall') {
      const f = this.fences.find((q) => q.plot === p)!;
      return !f.built && !f.interior && f.lands.some((l) => this.isOpen(l));
    }
    if (p.def.kind === 'recruitArcher' || p.def.kind === 'recruitKnight') return this.squadCount() < RECRUIT.squadMax;
    const sp = SPOTS.find((s) => s.id === p.def.id);
    if (!sp || !this.spotOpen(sp)) return false;
    // Upgrades (level 2+) need the land claimed.
    if (p.level > 0 && !this.claimed.has(sp.land) && sp.kind !== 'castle') return false;
    if (sp.kind === 'castle') return this.claimedCount >= CASTLE_NEEDS[p.level];
    return true;
  }

  private squadCount() {
    return this.units.filter((u) => u.state === 'squad').length;
  }

  private updatePlots(dt: number) {
    let on: Plot | null = null;
    for (const p of this.plots) {
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

    if (on && this.carry > 0 && on.paid + on.pending < on.cost) {
      this.payStreak += dt;
      const rate = Math.min(50, 8 + this.payStreak * 28);
      this.payT += dt * rate;
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
    const lvl = p.level;
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

    const kind = p.def.kind;
    if (kind === 'wall') {
      const f = this.fences.find((q) => q.plot === p)!;
      p.level = 0;
      this.buildFence(f);
      this.checkClaims(f);
      return;
    }
    if (kind === 'recruitArcher' || kind === 'recruitKnight') {
      p.level = 0;
      const type: UnitType = kind === 'recruitArcher' ? 'archer' : 'knight';
      const shop = [...this.shops.values()].find((s) => s.recruit === p)!;
      const cfg = RECRUIT[type];
      const n = Math.min(cfg.band, RECRUIT.squadMax - this.squadCount());
      for (let i = 0; i < n; i++) this.spawnUnit(type, v2.copy(shop.rackWorld).add(v3.set((i - 1) * 0.8, 0, 0.4)));
      shop.recruits++;
      p.def.costs[0] = cfg.cost + cfg.step * shop.recruits;
      this.fx.text(v2.copy(shop.rackWorld).setY(2.4), `+${n} ${type === 'archer' ? 'archers' : 'knights'}!`, 'good');
      return;
    }
    const sp = SPOTS.find((s) => s.id === p.def.id)!;
    switch (sp.kind) {
      case 'lookout':
        this.buildLookout(sp, p, lvl);
        break;
      case 'range':
      case 'barracks':
      case 'forge':
        this.buildShop(sp, p, lvl);
        break;
      case 'goldmine':
        this.buildMine(sp, p, lvl);
        break;
      case 'castle':
        this.upgradeKeep(lvl + 1);
        break;
    }
  }

  // ------------------------------------------------------------------ fences & claiming

  private fenceTier(): Fence['tier'] {
    return this.castleLevel >= 4 ? 'castle' : this.castleLevel >= 3 ? 'stone' : 'wood';
  }

  private buildFence(f: Fence, retier = false) {
    const tier = this.fenceTier();
    if (f.group) this.root.remove(f.group);
    const g = S.makeFenceRun(tier, f.b - f.a);
    if (f.axis === 'x') g.position.set(f.mid.x, 0, f.c);
    else {
      g.position.set(f.c, 0, f.mid.z);
      g.rotation.y = Math.PI / 2;
    }
    this.root.add(g);
    f.group = g;
    const frac = f.built && f.alive ? f.hp / f.maxHp : 1;
    f.tier = tier;
    f.maxHp = FENCE_HP[tier];
    f.hp = frac * f.maxHp;
    f.built = true;
    f.alive = true;
    f.rise = 0;
    g.scale.y = 0.01;
    if (!retier) {
      f.everBuilt = true;
      for (let i = 0; i < 6; i++) {
        const t = f.a + ((i + 0.5) / 6) * (f.b - f.a);
        this.fx.p.dust(f.axis === 'x' ? v1.set(t, 0.2, f.c) : v1.set(f.c, 0.2, t), 3);
      }
    }
  }

  /** Any land whose border is now complete becomes yours. */
  private checkClaims(last: Fence) {
    for (const L of LANDS) {
      if (this.claimed.has(L.id) || !this.isOpen(L.id)) continue;
      const border = this.fences.filter((f) => f.lands.includes(L.id));
      if (!border.every((f) => f.built)) continue;
      this.claimLand(L.id, last.mid);
    }
    this.refreshFences();
  }

  private claimLand(id: number, from: THREE.Vector3) {
    const L = LANDS[id];
    this.claimed.add(id);
    this.territory.claim(id, from.x, from.z);
    const cx = (L.x0 + L.x1) / 2;
    const cz = (L.z0 + L.z1) / 2;
    this.hud.banner(`${L.name} claimed!`, false);
    this.fx.pillar(v1.set(cx, 0, cz), 0x9dff7a, 6, 1.6);
    this.fx.ring(v1, 0x9dff7a, 16, 1.2);
    this.fx.p.levelUp(v1.set(cx, 1, cz));
    this.fx.shake = Math.max(this.fx.shake, 0.5);
    this.fx.punch = 1;
    this.hitstop = 0.12;
    this.events.flash(0.6);
    this.events.haptic(true);
    this.sfx.levelUp();
    this.sfx.treasure();
    // The land's reward: a chest in the middle, and its lost treasure piles come home.
    if (id > 0) this.spawnChest(v1.set(cx + 2, 0, cz + 2), 12 + id * 4);
    this.spawnHouses(L.id);
    for (let i = 0; i < 2; i++) this.spawnVillager(cx + (Math.random() - 0.5) * 8, cz + (Math.random() - 0.5) * 8);
  }

  /** Fences between two claimed lands are no longer the border: they sink into the ground. */
  private refreshFences() {
    for (const f of this.fences) {
      if (f.interior) continue;
      if (f.lands.length === 2 && f.lands.every((l) => this.claimed.has(l))) {
        f.interior = true;
        f.sink = 0.001;
      }
    }
    // Fresh fence pieces cost more with every land you hold.
    const cost = fenceCost(this.claimedCount);
    for (const f of this.fences) if (!f.built && f.plot.paid === 0 && f.plot.pending === 0) f.plot.def.costs[0] = f.everBuilt ? Math.ceil(cost * 0.5) : cost;
    this.placeFencePlots();
  }

  private damageFence(f: Fence, dmg: number) {
    f.hp -= dmg;
    f.lastHit = this.time;
    f.shake = 1;
    if (Math.random() < 0.3)
      this.fx.p.emit({ pos: v1.set(f.mid.x, 1, f.mid.z), count: 2, color: f.tier === 'wood' ? [0x9b6638, 0xc08850] : [0xb9b6ae, 0x8d8a83], speed: 3, up: 2, size: 0.18, life: 0.5, gravity: 12, glow: false });
    if (f.hp <= 0 && f.alive) {
      f.alive = false;
      f.built = false;
      f.hp = 0;
      if (f.group) {
        this.root.remove(f.group);
        f.group = null;
      }
      this.fx.burst(v1.set(f.mid.x, 0.8, f.mid.z), f.tier === 'wood' ? COLORS.wood : COLORS.stone, 26, 6);
      this.fx.p.explosion(v1);
      this.fx.shake = Math.max(this.fx.shake, 0.6);
      this.sfx.boom();
      this.events.haptic(true);
      if (this.time - this.fenceFallenAt > 4) this.hud.banner('A fence is down! Rebuild it', true);
      this.fenceFallenAt = this.time;
      this.refreshFences();
    }
  }

  private updateFences(dt: number) {
    for (const f of this.fences) {
      if (!f.group) continue;
      if (f.interior) {
        f.sink += dt * 0.8;
        f.group.position.y = -f.sink * 2.6;
        if (f.sink >= 1) {
          this.root.remove(f.group);
          f.group = null;
          f.alive = false;
        }
        continue;
      }
      if (f.rise < 1) {
        f.rise = Math.min(1, f.rise + dt * 2.5);
        const k = f.rise < 1 ? 1 + Math.sin(f.rise * Math.PI) * 0.15 : 1;
        f.group.scale.y = Math.max(0.01, f.rise) * k;
      }
      f.shake = Math.max(0, f.shake - dt * 5);
      const base = f.axis === 'x' ? f.mid.x : f.c;
      f.group.position.x = base + (Math.random() - 0.5) * f.shake * 0.12;
      // Fences mend themselves slowly when left alone.
      if (this.time - f.lastHit > 6) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.03 * dt);
    }
  }

  // ------------------------------------------------------------------ lookouts

  private buildLookout(sp: BuildSpot, p: Plot, lvl: number) {
    let l = this.lookouts.get(sp.id);
    const L = LANDS[sp.land];
    const toCx = Math.sign((L.x0 + L.x1) / 2 - sp.x) || 1;
    const toCz = Math.sign((L.z0 + L.z1) / 2 - sp.z) || 1;
    if (!l) {
      const rig = S.makeLookout();
      const pos = new THREE.Vector3(sp.x, 0, sp.z);
      rig.root.position.copy(pos);
      this.root.add(rig.root);
      const pad = new Pad(new THREE.Vector3(sp.x + toCx * 2.6, 0, sp.z));
      this.root.add(pad.mesh);
      l = { spot: sp, pos, root: rig.root, ballista: rig.ballista, slots: rig.slots, level: 0, units: new Array(LOOKOUT.slots[1]).fill(null), ballistaCd: 0, grow: 0, label: this.hud.worldLabel('archer'), pad };
      this.lookouts.set(sp.id, l);
      // The upgrade pad moves beside the platform.
      p.setPos(sp.x, sp.z + toCz * 2.7);
      this.fx.text(v2.copy(pos).setY(3.5), 'Lookout!', 'good');
    } else {
      l.level = Math.min(1, lvl);
      l.ballista.visible = true;
      l.grow = 0.4;
      this.fx.text(v2.copy(l.pos).setY(4), 'Ballista + 2 slots!', 'good');
    }
  }

  private updateLookouts(dt: number) {
    let onPad: Lookout | null = null;
    for (const l of this.lookouts.values()) {
      l.grow = Math.min(1, l.grow + dt * 3);
      const g = l.grow;
      const s = g < 1 ? 1 + Math.sin(g * Math.PI) * 0.15 : 1;
      l.root.scale.set(s, Math.max(0.02, Math.min(1, g * 1.2)) * s, s);
      const slots = LOOKOUT.slots[l.level];
      const filled = l.units.slice(0, slots).filter(Boolean).length;
      const active = this.heroAlive && Math.hypot(this.heroPos.x - l.pad.pos.x, this.heroPos.z - l.pad.pos.z) < 1.2;
      if (active) onPad = l;
      l.pad.draw(filled, slots, active);
      this.hud.placeLabel(l.label, v1.copy(l.pos).setY(4.6), `${filled}/${slots}`, filled === 0);
      if (l.level >= 1) {
        l.ballistaCd -= dt;
        const target = this.nearestEnemy(l.pos.x, l.pos.z, BALLISTA.range);
        if (target && l.ballistaCd <= 0) {
          l.ballistaCd = BALLISTA.delay;
          this.fireBolt(v1.copy(l.pos).setY(3.4), v2.set(target.x, 0.9, target.z));
          this.sfx.boom();
        }
      }
    }
    // Standing on a lookout's pad sends squad archers up, one by one.
    this.deployT -= dt;
    if (onPad && this.deployT <= 0) {
      const slots = LOOKOUT.slots[onPad.level];
      const slot = onPad.units.findIndex((u, i) => i < slots && !u);
      const archer = this.units.filter((u) => u.state === 'squad' && u.type === 'archer').sort((a, b) => b.tier - a.tier)[0];
      if (slot >= 0 && archer) {
        this.deployT = 0.22;
        onPad.units[slot] = archer;
        archer.post = onPad;
        archer.slot = slot;
        archer.state = 'jump';
        archer.jumpT = 0;
        archer.jumpFrom.copy(archer.pos);
        this.sfx.pay(0.5 + slot * 0.1);
      }
    }
  }

  // ------------------------------------------------------------------ workshops

  private buildShop(sp: BuildSpot, p: Plot, lvl: number) {
    const kind = sp.kind as Shop['kind'];
    let shop = this.shops.get(sp.id);
    if (!shop) {
      const rig = S.makeShop(kind, S.eraFor(this.castleLevel));
      const pos = new THREE.Vector3(sp.x, 0, sp.z);
      rig.root.position.copy(pos);
      this.root.add(rig.root);
      let rackMesh: THREE.InstancedMesh | null = null;
      if (kind === 'forge') {
        rackMesh = new THREE.InstancedMesh(S.kitGeometry(), S.weaponItemMaterial(), FORGE.rackMax);
        rackMesh.count = 0;
        rackMesh.castShadow = true;
        rackMesh.frustumCulled = false;
        rackMesh.setColorAt(0, col.setRGB(1, 1, 1));
        rackMesh.position.copy(pos);
        this.root.add(rackMesh);
      }
      shop = { plot: p, kind, rig, pos, level: 1, timer: 0, rack: [], rackMesh, rackWorld: rig.rack.clone().add(pos), pickT: 0, smokeT: 0, recruit: null, recruits: 0 };
      this.shops.set(sp.id, shop);
      // Upgrade pad to the left, recruit pad to the right.
      p.setPos(sp.x - 2.8, sp.z + 3.2);
      if (kind !== 'forge') {
        const type: UnitType = kind === 'range' ? 'archer' : 'knight';
        const def: PlotDef = { id: `${sp.id}_recruit`, kind: type === 'archer' ? 'recruitArcher' : 'recruitKnight', costs: [RECRUIT[type].cost] };
        const rp = new Plot(def);
        rp.setPos(sp.x + 2.8, sp.z + 3.2);
        this.root.add(rp.group);
        this.plots.push(rp);
        shop.recruit = rp;
        // The first band is on the house.
        if (kind === 'range') for (let i = 0; i < 2; i++) this.spawnUnit('archer', v2.copy(shop.rackWorld).add(v3.set(i - 0.5, 0, 0.5)));
      }
      this.fx.text(v2.copy(pos).setY(4), kind === 'range' ? 'Archery Range!' : kind === 'barracks' ? 'Barracks!' : 'Forge! Making armour', 'good');
    } else {
      shop.level = Math.min(3, lvl + 1);
      this.fx.text(v2.copy(shop.pos).setY(4), kind === 'forge' ? `Now forging: ${TIER_NAMES[shop.level]} kits` : 'Faster training!', 'good');
      if (shop.recruit && kind !== 'forge') shop.recruit.def.costs[0] = Math.max(6, Math.round(shop.recruit.def.costs[0] * 0.7));
    }
  }

  private updateShops(dt: number) {
    for (const s of this.shops.values()) {
      if (s.rig.anim) s.rig.anim.rotation.z = Math.sin(this.time * 9) * 0.7;
      if (s.kind !== 'forge') continue;
      if (Math.random() < dt * 8) this.fx.p.embers(v1.set(s.pos.x + 1.3, 1.0, s.pos.z + 0.4));
      if (s.rig.chimney) {
        s.smokeT -= dt;
        if (s.smokeT <= 0) {
          s.smokeT = 0.35;
          this.fx.p.smoke(v1.copy(s.rig.chimney).add(s.pos));
        }
      }
      if (s.rack.length < FORGE.rackMax) {
        s.timer += dt;
        if (s.timer >= FORGE.interval[s.level - 1]) {
          s.timer = 0;
          s.rack.push(s.level);
          this.fx.p.sparkle(v1.copy(s.rackWorld).setY(1), 0x9cc3ff, 6);
        }
      }
      const im = s.rackMesh!;
      im.count = s.rack.length;
      s.rack.forEach((tier, i) => {
        v1.copy(s.rig.rack).add(v2.set(0, 0.15 + i * 0.16, 0));
        quat.setFromAxisAngle(UP, i * 0.5);
        mtx.compose(v1, quat, scl.set(1, 1, 1));
        im.setMatrixAt(i, mtx);
        im.setColorAt(i, col.set(TIER_COLORS[tier]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (this.heroAlive && s.rack.length && this.kits.length < 30 && this.heroPos.distanceTo(s.rackWorld) < 2.4) {
        s.pickT -= dt;
        if (s.pickT <= 0) {
          s.pickT = 0.1;
          const tier = s.rack.pop()!;
          const from = v1.copy(s.rackWorld).setY(0.9).clone();
          this.fx.fly(from, () => this.frontTop(v3), 0.25, 0.8, () => {
            this.kits.push(tier);
            this.kits.sort((a, b) => a - b);
            this.sfx.pickup(4);
          });
        }
      } else s.pickT = 0;
    }
  }

  /** Carried kits go to the nearest soldier who'd be better for it. */
  private updateKits(dt: number) {
    this.giveT -= dt;
    if (!this.heroAlive || !this.kits.length || this.giveT > 0) return;
    for (let ki = this.kits.length - 1; ki >= 0; ki--) {
      const tier = this.kits[ki];
      let best: Unit | null = null;
      for (const u of this.units) {
        if (u.tier >= tier || u.state === 'jump') continue;
        if (Math.hypot(u.pos.x - this.heroPos.x, u.pos.z - this.heroPos.z) > 6.5) continue;
        if (!best || u.tier < best.tier) best = u;
      }
      if (!best) continue;
      this.kits.splice(ki, 1);
      this.giveT = 0.14;
      const unit = best;
      const from = this.frontTop(new THREE.Vector3());
      this.fx.fly(from, () => v3.copy(unit.pos).setY(unit.pos.y + 1), 0.3, 1, () => {
        if (!this.units.includes(unit)) return;
        this.setTier(unit, Math.max(unit.tier, tier));
        this.fx.text(v1.copy(unit.pos).setY(unit.pos.y + 2.2), `${TIER_NAMES[tier]}!`, 'good');
        this.fx.p.levelUp(v1.copy(unit.pos).setY(unit.pos.y + 0.6));
        this.fx.ring(v1.copy(unit.pos), TIER_COLORS[tier], 3, 0.5);
        this.sfx.build();
      });
      return;
    }
  }

  // ------------------------------------------------------------------ gold mines

  private buildMine(sp: BuildSpot, p: Plot, lvl: number) {
    let m = this.mines.get(sp.id);
    if (!m) {
      const pos = new THREE.Vector3(sp.x, 0, sp.z);
      const b = S.prop('building_mine_blue', 3.6, 'max');
      b.position.copy(pos);
      this.root.add(b);
      const pile = new THREE.InstancedMesh(S.barGeometry(), S.barMaterial(), MINE.pileMax);
      pile.count = 0;
      pile.castShadow = true;
      pile.frustumCulled = false;
      this.root.add(pile);
      m = { plot: p, pos, level: 1, timer: 0, bars: 0, pile, drop: new THREE.Vector3(sp.x + 2.4, 0, sp.z + 2.4), takeT: 0 };
      this.mines.set(sp.id, m);
      p.setPos(sp.x - 2.6, sp.z + 2.8);
      this.fx.text(v2.copy(pos).setY(4), 'Gold Mine!', 'good');
    } else {
      m.level = Math.min(MINE.perLevel.length, lvl + 1);
      this.fx.text(v2.copy(m.pos).setY(4), 'Richer seam: double gold!', 'good');
    }
  }

  private updateMines(dt: number) {
    for (const m of this.mines.values()) {
      if (m.bars < MINE.pileMax) {
        m.timer += dt;
        if (m.timer >= MINE.every) {
          m.timer = 0;
          m.bars = Math.min(MINE.pileMax, m.bars + MINE.perLevel[m.level - 1]);
          this.fx.p.sparkle(v1.copy(m.drop).setY(0.6), 0xffe066, 4);
        }
      }
      // The pile: bars stacked in a little pyramid.
      m.pile.count = m.bars;
      for (let i = 0; i < m.bars; i++) {
        const layer = Math.floor(i / 6);
        const k = i % 6;
        v1.set(m.drop.x + ((k % 3) - 1) * 0.42 + (layer % 2) * 0.1, 0.1 + layer * 0.16, m.drop.z + (Math.floor(k / 3) - 0.5) * 0.24);
        quat.setFromAxisAngle(UP, layer % 2 ? 0.08 : -0.05);
        mtx.compose(v1, quat, scl.set(1, 1, 1));
        m.pile.setMatrixAt(i, mtx);
      }
      m.pile.instanceMatrix.needsUpdate = true;
      if (!this.heroAlive || !m.bars || this.heroPos.distanceTo(m.drop) > 2.6) continue;
      m.takeT -= dt;
      if (m.takeT > 0) continue;
      m.takeT = 0.06;
      m.bars--;
      const value = MINE.barValue;
      this.fx.fly(m.drop.clone().setY(0.6), () => this.stackTop(v3), 0.3, 1.4, () => this.gainCoin(value), 1.3);
    }
  }

  // ------------------------------------------------------------------ the squad

  private spawnUnit(type: UnitType, at: THREE.Vector3) {
    const rig = S.makeUnit(type);
    const pos = at.clone().setY(0);
    rig.root.position.copy(pos);
    this.root.add(rig.root);
    // Private materials so each soldier can wear the colour of his armour tier.
    const mats: THREE.MeshStandardMaterial[] = [];
    rig.char.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.material === rig.weaponMat) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      m.material = mat;
      mats.push(mat);
    });
    const u: Unit = {
      type,
      rig,
      mats,
      pos,
      tier: 0,
      state: 'squad',
      post: null,
      slot: -1,
      cd: Math.random() * 0.5,
      hp: type === 'archer' ? ARCHER_HP[0] : KNIGHT_HP[0],
      lastHit: -99,
      facing: Math.PI,
      swing: 0,
      jumpT: 0,
      jumpFrom: new THREE.Vector3(),
      bar: this.hud.worldBar('ally'),
      animDt: 0,
    };
    this.units.push(u);
    this.fx.p.levelUp(v1.copy(pos).setY(0.3));
    this.fx.ring(pos, 0x6fb6ff, 3, 0.5);
    return u;
  }

  private setTier(u: Unit, tier: number) {
    u.tier = tier;
    const c = TIER_COLORS[tier];
    for (const m of u.mats) {
      m.color.set(c);
      m.emissive.set(tier === 3 ? 0x4a3400 : tier >= 2 ? 0x0a1a4a : 0x000000);
    }
    u.rig.weaponMat.color.set(c);
    u.hp = this.unitMaxHp(u);
  }

  private unitMaxHp(u: Unit) {
    return (u.type === 'archer' ? ARCHER_HP : KNIGHT_HP)[u.tier];
  }

  private damageUnit(u: Unit, dmg: number) {
    u.hp -= dmg;
    u.lastHit = this.time;
    if (u.hp <= 0) {
      this.fx.p.death(v1.copy(u.pos).setY(0.8), COLORS.team);
      this.fx.text(v1.copy(u.pos).setY(2), u.type === 'archer' ? 'Archer down!' : 'Knight down!', 'hurt');
    }
  }

  private updateUnits(dt: number) {
    // Formation slots around the king: rings that grow outward.
    const center = this.heroAlive ? this.heroPos : v3.set(0, 0, KEEP[this.castleLevel].radius + 2.5);
    let si = 0;
    for (const u of this.units) {
      const prevX = u.pos.x;
      const prevZ = u.pos.z;
      let walking = false;
      let face = u.facing;
      if (u.state === 'squad') {
        formationSlot(si++, v1);
        v1.add(center);
        // Knights charge goblins that come close, then fall back in.
        let target: Enemy | null = null;
        if (u.type === 'knight') {
          target = this.nearestEnemy(u.pos.x, u.pos.z, 4);
          if (target && Math.hypot(target.x - center.x, target.z - center.z) < 7) v1.set(target.x, 0, target.z);
          else target = null;
        }
        walking = walkTo(u.pos, v1, dt, target ? 7.5 : 9, target ? 1.1 : 0);
        this.pushOutOfBuildings(u.pos, 0.3);
        if (walking) face = Math.atan2(u.pos.x - prevX, u.pos.z - prevZ);
      } else if (u.state === 'jump') {
        // Leap up to the lookout.
        const l = u.post!;
        u.jumpT = Math.min(1, u.jumpT + dt * 1.8);
        l.root.localToWorld(v1.copy(l.slots[u.slot]));
        const e = u.jumpT * u.jumpT * (3 - 2 * u.jumpT);
        u.pos.lerpVectors(u.jumpFrom, v1, e);
        u.pos.y += Math.sin(u.jumpT * Math.PI) * 2.5;
        face = Math.atan2(v1.x - u.jumpFrom.x, v1.z - u.jumpFrom.z);
        if (u.jumpT >= 1) {
          u.state = 'post';
          this.fx.p.dust(v1.copy(u.pos), 2);
          this.sfx.build();
        }
      } else {
        const l = u.post!;
        l.root.localToWorld(u.pos.copy(l.slots[u.slot]));
      }

      u.cd -= dt;
      u.swing = Math.max(0, u.swing - dt * 5);
      if (u.state !== 'jump') {
        if (u.type === 'archer') {
          const range = u.state === 'post' ? LOOKOUT.range[u.post!.level] : 8.5;
          const t = this.nearestEnemy(u.pos.x, u.pos.z, range);
          if (t) {
            face = Math.atan2(t.x - u.pos.x, t.z - u.pos.z);
            if (u.cd <= 0) {
              u.cd = 0.62 + Math.random() * 0.1;
              u.swing = 1;
              u.rig.muzzle.getWorldPosition(v2);
              this.fire(v2, t, Math.round(ARCHER_DMG[u.tier] * this.stats.allies));
              if (Math.random() < 0.3) this.sfx.turret();
            }
          }
        } else {
          const t = this.nearestEnemy(u.pos.x, u.pos.z, 1.7);
          if (t) {
            face = Math.atan2(t.x - u.pos.x, t.z - u.pos.z);
            if (u.cd <= 0) {
              u.cd = 0.7;
              u.swing = 1;
              this.hitEnemy(t, Math.round(KNIGHT_DMG[u.tier] * this.stats.allies));
              this.fx.p.hit(v2.set(t.x, 1, t.z), 0xffffff);
            }
          }
        }
      }
      if (this.time - u.lastHit > 3) u.hp = Math.min(this.unitMaxHp(u), u.hp + 8 * dt);
      u.facing = lerpAngle(u.facing, face, Math.min(1, dt * 10));
      u.rig.root.position.copy(u.pos);
      u.rig.root.rotation.y = u.facing;
      u.rig.char.loop(walking || u.state === 'jump' ? 'Running_A' : 'Idle');
      if (u.swing === 1) u.rig.char.once(u.type === 'archer' ? '1H_Ranged_Shoot' : '1H_Melee_Attack_Chop', 1.6);
      // Far from the king, or standing on a lookout, soldiers animate at a lower rate (cheaper on phones).
      u.animDt += dt;
      const far = Math.abs(u.pos.x - this.heroPos.x) + Math.abs(u.pos.z - this.heroPos.z) > 34;
      const every = far ? 0.25 : u.state === 'post' ? 0.066 : 0;
      if (u.animDt >= every || u.swing === 1) {
        u.rig.char.update(u.animDt);
        u.animDt = 0;
      }
      u.rig.root.visible = !far || u.state !== 'post' ? true : u.rig.root.visible;
      const frac = u.hp / this.unitMaxHp(u);
      this.hud.placeBar(u.bar, frac < 0.999 ? v1.copy(u.pos).setY(u.pos.y + 2.1) : null, frac);
    }

    this.units = this.units.filter((u) => {
      if (u.hp > 0) return true;
      if (u.post) u.post.units[u.slot] = null;
      this.root.remove(u.rig.root);
      u.rig.weaponMat.dispose();
      for (const m of u.mats) m.dispose();
      this.hud.removeBar(u.bar);
      return false;
    });
  }

  // ------------------------------------------------------------------ keep

  private setKeepModel(level: number) {
    if (this.keep.model) this.keep.root.remove(this.keep.model);
    this.keep.model = S.makeCastle(level);
    this.keep.root.add(this.keep.model);
  }

  private upgradeKeep(level: number) {
    level = Math.min(level, KEEP.length - 1);
    const prev = this.castleLevel;
    this.castleLevel = level;
    const frac = this.keepHp / this.keepMax;
    this.keepMax = KEEP[level].hp;
    this.keepHp = Math.min(this.keepMax, frac * this.keepMax + this.keepMax * 0.25);
    this.setKeepModel(level);
    this.keep.root.scale.set(1, 0.01, 1);
    this.keepRise = 0;
    this.hud.banner(`${KEEP[level].name}!`, false);
    this.fx.pillar(v1.set(0, 0, 0), 0xffe08a, 5, 1.4);
    this.fx.ring(v1, 0xffd34d, 14, 0.9);
    this.fx.p.levelUp(v1.set(0, 3, 0));
    this.fx.p.build(v1.set(0, 1, 0));
    this.fx.shake = Math.max(this.fx.shake, 0.4);
    this.events.flash(0.5);
    this.sfx.levelUp();
    // The whole kingdom follows the castle: fences, then workshops, turn to stone.
    const tierChanged = (prev >= 4 ? 2 : prev >= 3 ? 1 : 0) !== (level >= 4 ? 2 : level >= 3 ? 1 : 0);
    if (tierChanged) {
      for (const f of this.fences) if (f.built && f.alive && !f.interior) this.buildFence(f, true);
      this.hud.banner(level >= 4 ? 'Castle walls!' : 'Stone walls!', false);
    }
    if (S.eraFor(level) !== S.eraFor(prev)) {
      for (const shop of this.shops.values()) {
        const rig = S.makeShop(shop.kind, S.eraFor(level));
        rig.root.position.copy(shop.pos);
        this.root.remove(shop.rig.root);
        this.root.add(rig.root);
        shop.rig = rig;
        shop.rackWorld = rig.rack.clone().add(shop.pos);
        this.fx.p.build(v1.copy(shop.pos).setY(0.5));
      }
    }
    this.spawnHouses(0);
  }

  private damageKeep(dmg: number) {
    this.keepHp -= dmg;
    this.keepLastHit = this.time;
    this.fx.p.explosion(v1.set((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3));
    this.events.hurt(0.25);
    this.fx.shake = Math.max(this.fx.shake, 0.15);
    if (this.keepHp <= 0 && !this.over) {
      this.keepHp = 0;
      this.over = true;
      this.sfx.boom();
      this.fx.p.explosion(v1.set(0, 2, 0));
      this.fx.p.build(v1);
      this.fx.shake = 1.5;
      this.events.haptic(true);
      this.events.onGameOver(this.wave);
    }
  }

  private updateKeep(dt: number) {
    if (this.time - this.keepLastHit > 5) this.keepHp = Math.min(this.keepMax, this.keepHp + 4 * dt);
    if (this.keepRise < 1) {
      this.keepRise = Math.min(1, this.keepRise + dt * 2);
      const k = this.keepRise < 1 ? 1 + Math.sin(this.keepRise * Math.PI) * 0.12 : 1;
      this.keep.root.scale.set(1, Math.max(0.01, this.keepRise) * k, 1);
    }
    this.hud.setKeep(this.keepHp / this.keepMax);
  }

  // ------------------------------------------------------------------ townsfolk

  private spawnHouses(land: number) {
    const L = LANDS[land];
    const want = land === 0 ? Math.min(6, this.castleLevel + 1) : 2;
    const have = this.houses.filter((h) => {
      const p = h.o.position;
      return p.x > L.x0 && p.x < L.x1 && p.z > L.z0 && p.z < L.z1;
    }).length;
    const names = this.castleLevel >= 3 ? ['building_home_A_blue', 'building_home_B_blue'] : ['tent', 'tent-canvas'];
    for (let i = have; i < want; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const x = L.x0 + 3 + Math.random() * 14;
        const z = L.z0 + 3 + Math.random() * 14;
        if (Math.hypot(x, z) < 7.5) continue;
        if (SPOTS.some((s) => Math.hypot(s.x - x, s.z - z) < 5)) continue;
        if (this.houses.some((h) => Math.hypot(h.o.position.x - x, h.o.position.z - z) < 4)) continue;
        if ([...this.mines.values()].some((m) => m.pos.distanceTo(v1.set(x, 0, z)) < 5)) continue;
        const o = S.prop(names[i % 2], names[0] === 'tent' ? 2.4 : 3.4, 'max');
        o.position.set(x, 0, z);
        o.rotation.y = Math.atan2(-x, -z);
        o.scale.y = 0.01;
        this.root.add(o);
        this.houses.push({ o, rise: 0 });
        break;
      }
    }
  }

  private spawnVillager(x: number, z: number) {
    if (this.villagers.length >= 14) return;
    const char = S.makeNpc('villager');
    const pos = new THREE.Vector3(x, 0, z);
    char.root.position.copy(pos);
    this.root.add(char.root);
    this.villagers.push({ char, pos, to: pos.clone(), wait: Math.random() * 2, facing: 0 });
  }

  private updateVillagers(dt: number) {
    for (const h of this.houses) {
      if (h.rise >= 1) continue;
      h.rise = Math.min(1, h.rise + dt * 2);
      const base = h.o.scale.x;
      const k = h.rise < 1 ? 1 + Math.sin(h.rise * Math.PI) * 0.15 : 1;
      h.o.scale.y = base * Math.max(0.01, h.rise) * k;
    }
    const claimed = [...this.claimed];
    for (const v of this.villagers) {
      if (v.wait > 0) {
        v.wait -= dt;
        v.char.loop('Idle');
        if (v.wait <= 0 && claimed.length) {
          const L = LANDS[claimed[Math.floor(Math.random() * claimed.length)]];
          v.to.set(L.x0 + 2 + Math.random() * 16, 0, L.z0 + 2 + Math.random() * 16);
        }
      } else {
        const moving = walkTo(v.pos, v.to, dt, 2.2, 0.2);
        if (moving) {
          v.facing = lerpAngle(v.facing, Math.atan2(v.to.x - v.pos.x, v.to.z - v.pos.z), Math.min(1, dt * 6));
          v.char.loop('Walking_A');
        } else v.wait = 1.5 + Math.random() * 4;
      }
      this.pushOutOfBuildings(v.pos, 0.3);
      v.char.root.position.copy(v.pos);
      v.char.root.rotation.y = v.facing;
      v.char.update(dt);
    }
  }

  // ------------------------------------------------------------------ guidance

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
    // 1. Archers in the squad and lookouts with room.
    const squadArchers = this.units.filter((u) => u.state === 'squad' && u.type === 'archer').length;
    if (squadArchers >= 2) {
      const pads = [...this.lookouts.values()].filter((l) => l.units.slice(0, LOOKOUT.slots[l.level]).some((x) => !x)).map((l) => l.pad.pos);
      if (pads.length) return nearest(pads);
    }
    // 2. A plot we can pay for: fences of the land closest to being claimed first.
    if (this.carry > 0) {
      const ok = this.plots.filter((p) => p.shown && p.remaining <= this.carry);
      const fenceOf = (p: Plot) => this.fences.find((f) => f.plot === p);
      const progress = (land: number) => {
        const border = this.fences.filter((f) => f.lands.includes(land));
        return border.filter((f) => f.built).length / border.length;
      };
      let bestLand = -1;
      let bestP = -1;
      for (const p of ok) {
        const f = fenceOf(p);
        if (!f) continue;
        for (const l of f.lands) {
          if (this.claimed.has(l) || !this.isOpen(l)) continue;
          const pr = progress(l);
          if (pr > bestP) {
            bestP = pr;
            bestLand = l;
          }
        }
      }
      // Buildings and repairs of claimed land come first; then finish the land you've started.
      const others = ok.filter((p) => {
        const f = fenceOf(p);
        return !f || f.lands.every((l) => this.claimed.has(l) || !this.isOpen(l)) || f.everBuilt;
      });
      if (others.length) return nearest(others.map((p) => p.pos));
      const focus = ok.filter((p) => fenceOf(p)?.lands.includes(bestLand));
      if (focus.length) return nearest(focus.map((p) => p.pos));
      if (ok.length) return nearest(ok.map((p) => p.pos));
    }
    // 3. Kits for posted archers.
    if (this.kits.length) {
      const needs = this.units.filter((u) => u.state === 'post' && u.tier < this.kits[this.kits.length - 1]).map((u) => u.pos);
      if (needs.length) return nearest(needs);
    }
    // 4. Forge rack with kits someone needs.
    if (this.kits.length < 30) {
      for (const s of this.shops.values()) {
        if (!s.rack.length) continue;
        const top = Math.max(...s.rack);
        if (this.units.some((u) => u.tier < top)) return s.rackWorld;
      }
    }
    // 5. Gold piling up at a mine.
    const mine = [...this.mines.values()].find((m) => m.bars >= 8);
    if (mine) return mine.drop;
    // 6. Treasure out in the wilds.
    if (this.treasures.length && this.enemies.length < 6) return nearest(this.treasures.map((t) => t.pos));
    return null;
  }

  private updateGuide() {
    const target = this.heroAlive ? this.guideTarget() : null;
    const d = target ? Math.hypot(target.x - this.heroPos.x, target.z - this.heroPos.z) : 0;
    const show = target && d > 3;
    const n = this.guide.length;
    const ang = target ? Math.atan2(target.x - this.heroPos.x, target.z - this.heroPos.z) : 0;
    const step = 0.85;
    for (let i = 0; i < n; i++) {
      const dot = this.guide[i];
      const dist = 1.6 + (i + ((this.time * 2.2) % 1)) * step;
      if (!show || dist > d - 1.2) {
        dot.visible = false;
        continue;
      }
      dot.visible = true;
      dot.position.set(this.heroPos.x + Math.sin(ang) * dist, 0.07, this.heroPos.z + Math.cos(ang) * dist);
      dot.rotation.y = ang + Math.PI;
      const fade = Math.min(1, (d - 1.2 - dist) / 1.5, (dist - 1.6) / 0.8 + 0.3);
      dot.scale.setScalar(0.9 * Math.max(0.2, fade));
    }
  }

  private currentHint() {
    if (!this.heroAlive) return `Back in ${Math.ceil(this.respawnT)}…`;
    const range = this.shops.get('range');
    const squadArchers = this.units.filter((u) => u.state === 'squad' && u.type === 'archer').length;
    if (!range) return this.carry < 8 ? 'Scoop up the gold and treasure lying around' : 'Stand on the plot to build an Archery Range';
    if (!this.units.length) return 'Stand on the recruit pad to hire archers';
    if (!this.lookouts.size) return 'Build a lookout platform for your archers';
    if (squadArchers >= 2 && [...this.lookouts.values()].some((l) => l.units.slice(0, LOOKOUT.slots[l.level]).some((x) => !x)))
      return 'Stand on the lookout pad to send archers up';
    if (!this.claimed.has(0)) return 'Fence in Kingsfield to claim it';
    if (this.kits.length) return 'Walk up to your troops to hand out armour';
    const forge = this.shops.get('forge');
    if (forge?.rack.length && this.units.some((u) => u.tier < Math.max(...forge.rack))) return 'Armour is ready at the Forge';
    if ([...this.mines.values()].some((m) => m.bars >= 10)) return 'Gold bars are piling up at the mine!';
    if (this.nova >= 1 && this.enemies.length > 4) return 'Arcane Nova is ready! Tap the button';
    const castle = this.spotPlots.get('castle')!;
    if (castle.shown && this.carry >= castle.remaining) return `Upgrade your castle to a ${KEEP[castle.level + 1].name}`;
    if (this.claimedCount < LANDS.length) return 'Fence in a neighbouring land to claim it';
    return '';
  }

  // ------------------------------------------------------------------ nova

  castNova() {
    if (this.nova < 1 || !this.heroAlive || this.over) return false;
    this.nova = 0;
    this.hud.setNova(0);
    const r2 = NOVA.radius * NOVA.radius;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if ((e.x - this.heroPos.x) ** 2 + (e.z - this.heroPos.z) ** 2 > r2) continue;
      if (!e.type.boss) {
        const d = Math.hypot(e.x - this.heroPos.x, e.z - this.heroPos.z) || 1;
        const nx = e.x + ((e.x - this.heroPos.x) / d) * NOVA.knockback;
        const nz = e.z + ((e.z - this.heroPos.z) / d) * NOVA.knockback;
        if (!this.fenceBetween(e.x, e.z, nx, nz, e.type.radius)) {
          e.x = nx;
          e.z = nz;
        }
      }
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
    this.hero.char.once('Cheer', 1.6);
    this.sfx.boom();
    this.sfx.levelUp();
    return true;
  }

  // ------------------------------------------------------------------ teardown

  dispose() {
    this.territory.dispose(this.root);
    this.scene.remove(this.root);
    for (const p of this.plots) p.dispose();
    for (const l of this.lookouts.values()) {
      l.pad.dispose();
      this.hud.removeBar(l.label);
    }
    for (const e of this.enemies) if (e.bar) this.hud.removeBar(e.bar);
    for (const u of this.units) {
      u.rig.weaponMat.dispose();
      for (const m of u.mats) m.dispose();
      this.hud.removeBar(u.bar);
    }
    this.hud.removeBar(this.heroBar);
    this.horde.begin();
    this.horde.end();
    void this.world;
  }
}

/** The coin tower can grow far past the top of the screen. */
const MAX_STACK = 320;

/** Slot `i` of the squad formation, relative to the king: rings of 6, 12, 18… */
function formationSlot(i: number, out: THREE.Vector3) {
  let ring = 0;
  let start = 0;
  while (i >= start + 6 * (ring + 1)) {
    start += 6 * (ring + 1);
    ring++;
  }
  const n = 6 * (ring + 1);
  const a = ((i - start) / n) * Math.PI * 2 + ring * 0.4;
  const r = 1.35 + ring * 0.95;
  return out.set(Math.sin(a) * r, 0, Math.cos(a) * r);
}

function formationRadius(n: number) {
  if (n <= 0) return 0;
  let ring = 0;
  let cap = 6;
  while (n > cap) {
    ring++;
    cap += 6 * (ring + 1);
  }
  return 1.35 + ring * 0.95;
}

/** Steps a position toward a target, stopping `stop` short. Returns whether it moved. */
function walkTo(p: THREE.Vector3, target: THREE.Vector3, dt: number, speed: number, stop = 0) {
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.08 + stop) return false;
  const step = Math.min(d - stop, speed * dt * Math.min(1, d / 0.6 + 0.3));
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  p.y = 0;
  return true;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
