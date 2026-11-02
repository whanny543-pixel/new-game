import * as THREE from 'three';
import {
  ENEMIES,
  FORGE_LEVELS,
  KEEP,
  MINE,
  PADS,
  PLAYER,
  SPAWN_RADIUS,
  SQUIRE,
  TOWER_LEVELS,
  WALL_HP,
  WAVES,
  ZONE_RADII,
  COLORS,
  type EnemyKind,
  type EnemyType,
  type WallSpec,
} from './config';
import * as M from './models';
import { Plot } from './plot';
import type { Fx } from './fx';
import type { Sfx } from './audio';
import type { Hud } from './hud';
import type { World } from './world';

// One play-through. Everything created here lives under `root` and is thrown away on restart.

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

interface Enemy {
  kind: EnemyKind;
  type: EnemyType;
  rig: M.EnemyRig;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  atkCd: number;
  lunge: number;
  flash: number;
  phase: number;
  bar: HTMLElement | null;
}

interface Arrow {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  target: Enemy | null;
  aim: THREE.Vector3;
  damage: number;
  active: boolean;
}

interface GroundCoin {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  active: boolean;
  age: number;
}

interface Tower {
  rig: M.TowerRig;
  pos: THREE.Vector3;
  level: number;
  cd: number;
  grow: number;
}

interface Wall {
  spec: WallSpec;
  rig: ReturnType<typeof M.makeWall>;
  hp: number;
  maxHp: number;
  alive: boolean;
  lastHit: number;
  tx: number;
  tz: number;
  plot: Plot;
  shake: number;
}

interface Mine {
  rig: ReturnType<typeof M.makeMine>;
  pos: THREE.Vector3;
  level: number;
  timer: number;
  pile: number;
  pileMesh: THREE.InstancedMesh;
  pilePos: THREE.Vector3;
  collectT: number;
}

interface Squire {
  rig: ReturnType<typeof M.makeSquire>;
  pos: THREE.Vector3;
  cd: number;
  facing: number;
}

export interface RunEvents {
  onGameOver(wave: number): void;
  haptic(strong: boolean): void;
}

export class Run {
  readonly root = new THREE.Group();
  time = 0;
  wave = 0;
  zone = 0;
  over = false;

  // Hero
  hero = M.makeHero();
  heroPos = new THREE.Vector3(0, 0, 3.2);
  heroVel = new THREE.Vector3();
  heroFacing = Math.PI;
  heroHp = PLAYER.maxHp;
  heroAlive = true;
  respawnT = 0;
  heroCd = 0;
  heroHurt = 0;
  walkT = 0;
  forge = 0;
  carry = 0;
  private stack: THREE.InstancedMesh;
  private stackLean = new THREE.Vector2();
  private pickupCombo = 0;
  private pickupComboT = 0;
  private heroBar: HTMLElement;

  // Keep
  keep = M.makeKeep();
  keepHp = KEEP.maxHp;
  private keepLastHit = -99;

  // Collections
  enemies: Enemy[] = [];
  private enemyPool: Record<EnemyKind, M.EnemyRig[]> = { goblin: [], runner: [], troll: [] };
  private arrows: Arrow[] = [];
  private coins: GroundCoin[] = [];
  plots: Plot[] = [];
  private towers = new Map<string, Tower>();
  private walls: Wall[] = [];
  private mines = new Map<string, Mine>();
  private squires: Squire[] = [];
  private guide: THREE.Mesh[] = [];

  // Paying
  private payT = 0;
  private payStreak = 0;
  private activePlot: Plot | null = null;
  private tutorialDone = false;

  // Waves
  private spawnQueue: EnemyKind[] = [];
  private spawnT = 0;
  private spawnInterval = 1;
  private waveBreak: number = WAVES.firstDelay;
  private waveSpawned = 0;
  private waveTotal = 1;
  private lastSpawn = 0;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private fx: Fx,
    private sfx: Sfx,
    private hud: Hud,
    private events: RunEvents,
  ) {
    scene.add(this.root);
    world.setLevel(0, true);

    this.keep.root.scale.setScalar(0.8);
    this.root.add(this.keep.root);
    this.root.add(this.hero.root);
    this.hero.root.position.copy(this.heroPos);

    this.stack = new THREE.InstancedMesh(M.GEO.coin, M.MAT.coin, PLAYER.maxVisibleStack);
    this.stack.count = 0;
    this.stack.castShadow = true;
    this.stack.frustumCulled = false;
    this.hero.stackAnchor.add(this.stack);
    this.heroBar = hud.worldBar('hero');

    for (let i = 0; i < 160; i++) {
      const mesh = new THREE.Mesh(M.GEO.arrow, M.MAT.arrow);
      mesh.visible = false;
      this.root.add(mesh);
      this.arrows.push({ mesh, pos: new THREE.Vector3(), target: null, aim: new THREE.Vector3(), damage: 0, active: false });
    }
    for (let i = 0; i < 220; i++) {
      const mesh = new THREE.Mesh(M.GEO.coin, M.MAT.coin);
      mesh.castShadow = true;
      mesh.visible = false;
      this.root.add(mesh);
      this.coins.push({ mesh, vel: new THREE.Vector3(), active: false, age: 0 });
    }
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const d = new THREE.Mesh(M.GEO.dot, dotMat);
      d.rotation.x = -Math.PI / 2;
      d.position.y = 0.05;
      d.visible = false;
      this.root.add(d);
      this.guide.push(d);
    }

    for (const def of PADS) {
      const p = new Plot(def);
      this.root.add(p.group);
      this.plots.push(p);
    }

    // A little starting gold by the keep teaches the collect → build loop immediately.
    for (let i = 0; i < 12; i++) this.dropCoin(v1.set(-2.75 + i * 0.5, 0.3, 4.4), 0.5);

    hud.hint('Grab the gold, then stand on the plot to build');
  }

  // ------------------------------------------------------------------ helpers

  get heroDamage() {
    return FORGE_LEVELS[this.forge].damage;
  }

  private stackTop(out: THREE.Vector3) {
    const n = Math.min(this.carry, PLAYER.maxVisibleStack);
    out.set(0, n * 0.11 + 0.05, 0);
    return this.hero.stackAnchor.localToWorld(out);
  }

  private dropCoin(at: THREE.Vector3, spread = 2.5) {
    const c = this.coins.find((q) => !q.active);
    if (!c) {
      // Pool exhausted: bank it directly rather than losing the reward.
      this.carry++;
      return;
    }
    c.active = true;
    c.age = 0;
    c.mesh.visible = true;
    c.mesh.position.copy(at);
    const a = Math.random() * Math.PI * 2;
    const s = spread * (0.3 + Math.random() * 0.7);
    c.vel.set(Math.cos(a) * s, 4 + Math.random() * 2.5, Math.sin(a) * s);
  }

  // ------------------------------------------------------------------ main update

  update(dt: number, move: { x: number; y: number }) {
    if (this.over) return;
    this.time += dt;
    this.updateHero(dt, move);
    this.updateSquires(dt);
    this.updateWaves(dt);
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateWalls(dt);
    this.updateMines(dt);
    this.updateArrows(dt);
    this.updateCoins(dt);
    this.updatePlots(dt);
    this.updateKeep(dt);
    this.updateGuide();
    this.updateStack(dt);
    this.hud.setGold(this.carry);
  }

  // ------------------------------------------------------------------ hero

  private updateHero(dt: number, move: { x: number; y: number }) {
    const rig = this.hero;
    if (!this.heroAlive) {
      this.respawnT -= dt;
      rig.root.visible = false;
      this.hud.hint(`Respawning in ${Math.ceil(this.respawnT)}…`);
      if (this.respawnT <= 0) {
        this.heroAlive = true;
        this.heroHp = PLAYER.maxHp;
        this.heroPos.set(0, 0, 3.2);
        rig.root.visible = true;
        this.fx.burst(v1.copy(this.heroPos).setY(1), COLORS.coin, 14, 4);
        this.hud.hint(this.tutorialDone ? '' : 'Grab the gold, then stand on the plot to build');
      }
      this.hud.placeBar(this.heroBar, null, 0);
      return;
    }

    // Movement: screen-space stick maps directly to world x/z (camera never rotates).
    const speed = PLAYER.speed;
    this.heroVel.set(move.x * speed, 0, move.y * speed);
    this.heroPos.addScaledVector(this.heroVel, dt);
    const lim = SPAWN_RADIUS - 2;
    const d = Math.hypot(this.heroPos.x, this.heroPos.z);
    if (d > lim) this.heroPos.multiplyScalar(lim / d);
    // Don't walk through the keep.
    const kd = Math.hypot(this.heroPos.x, this.heroPos.z);
    if (kd < 2.4) {
      this.heroPos.multiplyScalar(2.4 / Math.max(kd, 0.001));
      // Slide around the walls instead of sticking when pushing straight into them.
      const tx = -this.heroPos.z / 2.4;
      const tz = this.heroPos.x / 2.4;
      const along = this.heroVel.x * tx + this.heroVel.z * tz;
      const side = Math.abs(along) > 0.1 ? Math.sign(along) : this.heroPos.x >= 0 ? -1 : 1;
      this.heroPos.x += tx * side * speed * 0.6 * dt;
      this.heroPos.z += tz * side * speed * 0.6 * dt;
    }

    const moving = this.heroVel.lengthSq() > 0.01;
    if (moving) this.walkT += dt * 11;
    else this.walkT = 0;

    // Shooting
    this.heroCd -= dt;
    const target = this.nearestEnemy(this.heroPos, PLAYER.range);
    let face = moving ? Math.atan2(this.heroVel.x, this.heroVel.z) : this.heroFacing;
    if (target) {
      face = Math.atan2(target.pos.x - this.heroPos.x, target.pos.z - this.heroPos.z);
      if (this.heroCd <= 0) {
        this.heroCd = FORGE_LEVELS[this.forge].delay;
        rig.muzzle.getWorldPosition(v1);
        this.fire(v1, target, this.heroDamage);
        this.sfx.shoot();
      }
    }
    this.heroFacing = lerpAngle(this.heroFacing, face, Math.min(1, dt * 14));

    rig.root.position.copy(this.heroPos);
    rig.root.rotation.y = this.heroFacing;
    const sw = Math.sin(this.walkT);
    rig.legL.position.z = sw * 0.16;
    rig.legR.position.z = -sw * 0.16;
    rig.body.position.y = Math.abs(sw) * 0.06;
    rig.body.rotation.z = sw * 0.04;

    // Regenerate inside the territory.
    if (Math.hypot(this.heroPos.x, this.heroPos.z) < this.world.currentRadius) {
      this.heroHp = Math.min(PLAYER.maxHp, this.heroHp + PLAYER.regen * dt);
    }
    this.heroHurt = Math.max(0, this.heroHurt - dt * 4);
    M.MAT.tabard.emissive.setRGB(this.heroHurt * 0.8, 0, 0);

    const frac = this.heroHp / PLAYER.maxHp;
    this.hud.placeBar(this.heroBar, frac < 0.999 ? v1.copy(this.heroPos).setY(2.6) : null, frac);
  }

  private damageHero(dmg: number) {
    if (!this.heroAlive) return;
    this.heroHp -= dmg;
    this.heroHurt = 1;
    this.sfx.hurt();
    this.fx.text(v1.copy(this.heroPos).setY(2.2), `-${dmg}`, 'hurt');
    if (this.heroHp <= 0) {
      this.heroAlive = false;
      this.respawnT = PLAYER.respawnTime;
      this.fx.burst(v1.copy(this.heroPos).setY(1), COLORS.tabard, 20, 5);
      this.fx.shake = Math.max(this.fx.shake, 0.6);
      this.events.haptic(true);
      // Drop half the stack where you fell.
      const lose = Math.floor(this.carry / 2);
      this.carry -= lose;
      for (let i = 0; i < Math.min(lose, 60); i++) this.dropCoin(v1.copy(this.heroPos).setY(1.2), 3.5);
    }
  }

  private updateStack(dt: number) {
    const n = Math.min(this.carry, PLAYER.maxVisibleStack);
    this.stack.count = n;
    // Lean the tower against the direction of travel, with a springy lag.
    const tx = this.heroAlive ? -this.heroVel.x * 0.006 : 0;
    const tz = this.heroAlive ? -this.heroVel.z * 0.006 : 0;
    this.stackLean.x += (tx - this.stackLean.x) * Math.min(1, dt * 6);
    this.stackLean.y += (tz - this.stackLean.y) * Math.min(1, dt * 6);
    // Lean is world-space; convert into the hero's local frame.
    const c = Math.cos(-this.heroFacing);
    const s = Math.sin(-this.heroFacing);
    const lx = this.stackLean.x * c + this.stackLean.y * s;
    const lz = -this.stackLean.x * s + this.stackLean.y * c;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const f = (i / PLAYER.maxVisibleStack) ** 2 * 35;
      const wob = Math.sin(this.time * 2.5 + i * 0.12) * 0.0015 * i;
      v1.set(lx * f + wob, i * 0.11, lz * f);
      q.setFromAxisAngle(UP, i * 0.4);
      m.compose(v1, q, v2.set(1, 1, 1));
      this.stack.setMatrixAt(i, m);
    }
    this.stack.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ squires

  private addSquire() {
    const rig = M.makeSquire();
    const pos = this.heroPos.clone();
    rig.root.position.copy(pos);
    this.root.add(rig.root);
    this.squires.push({ rig, pos, cd: Math.random() * 0.5, facing: 0 });
  }

  private updateSquires(dt: number) {
    const n = this.squires.length;
    this.squires.forEach((sq, i) => {
      // Formation: a loose arc trailing the hero.
      const a = this.heroFacing + Math.PI + (n > 1 ? (i / (n - 1) - 0.5) * 2.2 : 0);
      v1.set(this.heroPos.x + Math.sin(a) * 1.5, 0, this.heroPos.z + Math.cos(a) * 1.5);
      const prev = sq.pos.clone();
      sq.pos.lerp(v1, Math.min(1, dt * 6));
      const moved = prev.distanceTo(sq.pos);

      sq.cd -= dt;
      const t = this.nearestEnemy(sq.pos, SQUIRE.range);
      let face = moved > 0.005 ? Math.atan2(sq.pos.x - prev.x, sq.pos.z - prev.z) : sq.facing;
      if (t) {
        face = Math.atan2(t.pos.x - sq.pos.x, t.pos.z - sq.pos.z);
        if (sq.cd <= 0) {
          sq.cd = SQUIRE.delay;
          sq.rig.muzzle.getWorldPosition(v2);
          this.fire(v2, t, SQUIRE.damage);
        }
      }
      sq.facing = lerpAngle(sq.facing, face, Math.min(1, dt * 10));
      sq.rig.root.position.copy(sq.pos);
      sq.rig.root.position.y = moved > 0.01 ? Math.abs(Math.sin(this.time * 14 + i)) * 0.1 : 0;
      sq.rig.root.rotation.y = sq.facing;
      sq.rig.root.visible = this.heroAlive;
    });
  }

  // ------------------------------------------------------------------ waves & enemies

  private updateWaves(dt: number) {
    if (this.spawnQueue.length === 0) {
      const alive = this.enemies.length;
      const ready = this.wave === 0 || alive <= 2 || this.time - this.lastSpawn > 22;
      if (ready) {
        this.waveBreak -= dt;
        if (this.waveBreak <= 0) this.startWave(this.wave + 1);
      }
    } else {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = this.spawnInterval * (0.6 + Math.random() * 0.8);
        this.spawn(this.spawnQueue.shift()!);
        this.waveSpawned++;
        this.lastSpawn = this.time;
      }
    }
    const progress = this.wave === 0 ? 0 : this.waveSpawned / this.waveTotal;
    this.hud.setWave(Math.max(1, this.wave), progress);
  }

  private startWave(n: number) {
    this.wave = n;
    this.waveBreak = WAVES.breakTime;
    const count = WAVES.baseCount + (n - 1) * WAVES.countPerWave;
    const q: EnemyKind[] = [];
    for (let i = 0; i < count; i++) q.push(n >= 3 && Math.random() < 0.3 ? 'runner' : 'goblin');
    const trolls = n % 3 === 0 ? Math.floor(n / 3) : n >= 10 ? 1 : 0;
    for (let i = 0; i < trolls; i++) q.splice(Math.floor(q.length * (0.35 + 0.5 * (i / Math.max(1, trolls)))), 0, 'troll');
    this.spawnQueue = q;
    this.waveTotal = q.length;
    this.waveSpawned = 0;
    this.spawnInterval = Math.max(0.22, Math.min(1.3, 15 / q.length));
    this.spawnT = 0.5;
    this.hud.banner(trolls ? `Wave ${n} — Troll!` : `Wave ${n}`, trolls > 0);
    if (trolls) this.sfx.boss();
    else this.sfx.wave();
  }

  private spawn(kind: EnemyKind) {
    const type = ENEMIES[kind];
    const rig = this.enemyPool[kind].pop() ?? M.makeEnemy(kind, type.color);
    const arc = WAVES.arc(this.wave);
    // Bias spawns toward the roads so groups arrive in readable lanes.
    const roads = [0, 120, -120].filter((r) => Math.abs(r) <= arc);
    let deg = (Math.random() * 2 - 1) * arc;
    if (roads.length && Math.random() < 0.6) deg = roads[Math.floor(Math.random() * roads.length)] + (Math.random() - 0.5) * 24;
    const a = (deg * Math.PI) / 180;
    const pos = new THREE.Vector3(Math.sin(a) * SPAWN_RADIUS, 0, -Math.cos(a) * SPAWN_RADIUS);
    const hp = Math.round(type.hp * (1 + WAVES.hpGrowth * (this.wave - 1)) * (type.boss ? 1 + this.wave * 0.08 : 1));
    rig.root.position.copy(pos);
    rig.root.visible = true;
    rig.root.scale.setScalar(1);
    for (const m of rig.mats) m.emissive.setRGB(0, 0, 0);
    this.root.add(rig.root);
    this.enemies.push({
      kind,
      type,
      rig,
      pos,
      hp,
      maxHp: hp,
      alive: true,
      atkCd: 0.5,
      lunge: 0,
      flash: 0,
      phase: Math.random() * 10,
      bar: type.boss ? this.hud.worldBar('enemy big') : null,
    });
    if (type.boss) this.fx.shake = Math.max(this.fx.shake, 0.4);
  }

  private nearestEnemy(from: THREE.Vector3, range: number, skip?: Enemy) {
    let best: Enemy | null = null;
    let bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || e === skip) continue;
      const dx = e.pos.x - from.x;
      const dz = e.pos.z - from.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Returns the wall an enemy at (x,z) with radius r would overlap, if any. */
  private blockingWall(x: number, z: number, r: number) {
    for (const w of this.walls) {
      if (!w.alive) continue;
      const dx = x - w.spec.x;
      const dz = z - w.spec.z;
      const along = dx * w.tx + dz * w.tz;
      const across = -dx * w.tz + dz * w.tx;
      if (Math.abs(along) < w.spec.len / 2 + r && Math.abs(across) < 0.3 + r) return w;
    }
    return null;
  }

  private updateEnemies(dt: number) {
    const list = this.enemies;
    for (const e of list) {
      if (!e.alive) continue;
      const t = e.type;
      e.atkCd -= dt;
      e.lunge = Math.max(0, e.lunge - dt * 4);
      e.flash = Math.max(0, e.flash - dt * 8);

      // Choose a target: the hero if close, otherwise the keep.
      const hdx = this.heroPos.x - e.pos.x;
      const hdz = this.heroPos.z - e.pos.z;
      const hd = Math.hypot(hdx, hdz);
      const chaseHero = this.heroAlive && hd < (t.boss ? 6 : 4.5);
      let tx: number, tz: number, reach: number;
      if (chaseHero) {
        tx = this.heroPos.x;
        tz = this.heroPos.z;
        reach = t.radius + 0.55;
      } else {
        tx = 0;
        tz = 0;
        reach = t.radius + KEEP.radius;
      }
      const dx = tx - e.pos.x;
      const dz = tz - e.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist;
      const nz = dz / dist;
      let attacking = false;

      if (dist <= reach) {
        attacking = true;
        if (e.atkCd <= 0) {
          e.atkCd = t.boss ? 1.4 : 1.0;
          e.lunge = 1;
          if (chaseHero) this.damageHero(t.damage);
          else this.damageKeep(t.damage);
        }
      } else {
        const step = t.speed * dt;
        const nxp = e.pos.x + nx * step;
        const nzp = e.pos.z + nz * step;
        const wall = this.blockingWall(nxp, nzp, t.radius);
        if (wall) {
          attacking = true;
          if (e.atkCd <= 0) {
            e.atkCd = t.boss ? 1.4 : 1.0;
            e.lunge = 1;
            this.damageWall(wall, t.damage);
          }
        } else {
          e.pos.x = nxp;
          e.pos.z = nzp;
        }
      }

      // Soft separation so crowds spread out instead of stacking.
      for (const o of list) {
        if (o === e || !o.alive) continue;
        const sx = e.pos.x - o.pos.x;
        const sz = e.pos.z - o.pos.z;
        const min = t.radius + o.type.radius;
        const d2 = sx * sx + sz * sz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * (o.type.boss && !t.boss ? 0.9 : 0.5);
          const px = sx * push;
          const pz = sz * push;
          if (!this.blockingWall(e.pos.x + px, e.pos.z + pz, t.radius)) {
            e.pos.x += px;
            e.pos.z += pz;
          }
        }
      }

      // Animate
      const r = e.rig.root;
      r.position.set(e.pos.x, 0, e.pos.z);
      r.rotation.y = Math.atan2(nx, nz);
      const hop = attacking ? 0 : Math.abs(Math.sin(this.time * (t.boss ? 5 : 11) + e.phase));
      e.rig.body.position.y = hop * (t.boss ? 0.12 : 0.18);
      e.rig.body.position.z = e.lunge * (t.boss ? 0.6 : 0.35);
      e.rig.body.rotation.x = e.lunge * 0.4;
      for (const m of e.rig.mats) m.emissive.setScalar(e.flash * 0.8);
      if (e.bar) this.hud.placeBar(e.bar, v1.set(e.pos.x, 3.4, e.pos.z), e.hp / e.maxHp);
    }

    // Remove the dead and recycle their rigs.
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.alive) continue;
      this.root.remove(e.rig.root);
      this.enemyPool[e.kind].push(e.rig);
      if (e.bar) this.hud.removeBar(e.bar);
      list.splice(i, 1);
    }
  }

  private hitEnemy(e: Enemy, dmg: number) {
    if (!e.alive) return;
    e.hp -= dmg;
    e.flash = 1;
    this.fx.text(v1.set(e.pos.x, e.type.boss ? 3.0 : 1.6, e.pos.z), `-${dmg}`, dmg >= 50 ? 'crit' : '');
    this.sfx.hit();
    if (e.hp <= 0) {
      e.alive = false;
      v1.set(e.pos.x, 0.8, e.pos.z);
      this.fx.burst(v1, e.type.color, e.type.boss ? 30 : 10, e.type.boss ? 6 : 4, e.type.boss ? 1.6 : 1);
      this.sfx.pop();
      for (let i = 0; i < e.type.reward; i++) this.dropCoin(v1, e.type.boss ? 4 : 2);
      if (e.type.boss) {
        this.fx.shake = Math.max(this.fx.shake, 0.8);
        this.events.haptic(true);
        this.hud.banner('Troll slain!', false);
      }
    }
  }

  // ------------------------------------------------------------------ arrows

  private fire(from: THREE.Vector3, target: Enemy, damage: number) {
    const a = this.arrows.find((q) => !q.active);
    if (!a) {
      this.hitEnemy(target, damage);
      return;
    }
    a.active = true;
    a.mesh.visible = true;
    a.pos.copy(from);
    a.target = target;
    a.aim.set(target.pos.x, target.type.boss ? 1.4 : 0.7, target.pos.z);
    a.damage = damage;
    a.mesh.position.copy(from);
  }

  private updateArrows(dt: number) {
    const speed = 26;
    for (const a of this.arrows) {
      if (!a.active) continue;
      if (a.target?.alive) a.aim.set(a.target.pos.x, a.target.type.boss ? 1.4 : 0.7, a.target.pos.z);
      v1.subVectors(a.aim, a.pos);
      const d = v1.length();
      const step = speed * dt;
      if (d <= step + 0.15) {
        a.active = false;
        a.mesh.visible = false;
        if (a.target?.alive) this.hitEnemy(a.target, a.damage);
        continue;
      }
      a.pos.addScaledVector(v1, step / d);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.aim);
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
      }
      if (!this.heroAlive || c.age < 0.35) continue;
      const dx = p.x - this.heroPos.x;
      const dz = p.z - this.heroPos.z;
      if (dx * dx + dz * dz < PLAYER.magnet * PLAYER.magnet) {
        c.active = false;
        c.mesh.visible = false;
        this.fx.fly(
          p.clone(),
          () => this.stackTop(v2),
          0.28,
          1.2,
          () => {
            this.carry++;
            this.pickupCombo++;
            this.pickupComboT = 0.6;
            this.sfx.pickup(this.pickupCombo);
            this.hud.bumpGold();
          },
        );
      }
    }
  }

  // ------------------------------------------------------------------ plots & building

  private plotVisible(p: Plot) {
    if (p.def.zone > this.zone || p.maxed) return false;
    if (p.def.kind === 'wall') return !this.walls.find((w) => w.plot === p && w.alive);
    return true;
  }

  private updatePlots(dt: number) {
    let on: Plot | null = null;
    for (const p of this.plots) {
      p.show(this.plotVisible(p));
      if (!p.shown || !this.heroAlive) continue;
      const dx = this.heroPos.x - p.pos.x;
      const dz = this.heroPos.z - p.pos.z;
      if (dx * dx + dz * dz < 1.25 * 1.25) on = p;
    }
    if (on !== this.activePlot) {
      this.activePlot = on;
      this.payStreak = 0;
      this.payT = 0;
    }
    for (const p of this.plots) p.update(dt, p === on);

    if (on && this.carry > 0 && on.paid + on.pending < on.cost) {
      // Pay faster the longer you stand there — a big stack drains in a satisfying rush.
      this.payStreak += dt;
      const rate = Math.min(45, 7 + this.payStreak * 26);
      this.payT += dt * rate;
      while (this.payT >= 1 && this.carry > 0 && on.paid + on.pending < on.cost) {
        this.payT -= 1;
        this.carry--;
        on.pending++;
        const plot = on;
        const from = this.stackTop(new THREE.Vector3());
        this.fx.fly(from, () => v2.set(plot.pos.x, 0.2, plot.pos.z), 0.22, 1.0, () => {
          plot.pending--;
          plot.paid++;
          plot.bump();
          this.sfx.pay(plot.paid / Math.max(1, plot.cost));
          if (plot.paid >= plot.cost) this.completePlot(plot);
        });
      }
    }
    if (!this.tutorialDone && (this.plots[0].level > 0 || this.wave >= 2)) {
      this.tutorialDone = true;
      this.hud.hint('');
    }
  }

  private completePlot(p: Plot) {
    const def = p.def;
    const lvl = p.level; // the level being completed (0 = first build)
    p.level++;
    p.paid = 0;
    const at = v1.set(p.pos.x, 0.6, p.pos.z);
    this.sfx.build();
    this.events.haptic(false);
    this.fx.burst(at, COLORS.coin, 18, 5);
    this.fx.shake = Math.max(this.fx.shake, 0.25);

    switch (def.kind) {
      case 'tower': {
        let t = this.towers.get(def.id);
        if (!t) {
          const rig = M.makeTower();
          rig.root.position.set(def.x, 0, def.z);
          rig.root.rotation.y = Math.atan2(def.x, def.z) + Math.PI;
          this.root.add(rig.root);
          t = { rig, pos: new THREE.Vector3(def.x, 0, def.z), level: 0, cd: 0, grow: 0 };
          this.towers.set(def.id, t);
          // Move the upgrade plot beside the tower (tangentially, away from the north road).
          const ang = Math.atan2(def.x, -def.z);
          const dir = ang >= 0 ? 1 : -1;
          p.setPos(def.x + Math.cos(ang) * 2.4 * dir, def.z + Math.sin(ang) * 2.4 * dir);
          this.fx.text(v2.set(def.x, 3, def.z), 'Archer Tower!', 'good');
        } else {
          t.level = Math.min(TOWER_LEVELS.length - 1, lvl);
          t.rig.banners.forEach((b, i) => (b.visible = i < t!.level));
          this.fx.text(v2.set(def.x, 3.2, def.z), `Tower ${['I', 'II', 'III'][t.level]}`, 'good');
        }
        t.grow = 0;
        break;
      }
      case 'wall': {
        let w = this.walls.find((q) => q.plot === p);
        const spec = def.wall!;
        if (!w) {
          const rig = M.makeWall(spec.len);
          rig.root.position.set(spec.x, 0, spec.z);
          rig.root.rotation.y = spec.rot;
          this.root.add(rig.root);
          const hp = WALL_HP[def.zone];
          w = { spec, rig, hp, maxHp: hp, alive: true, lastHit: -99, tx: Math.cos(spec.rot), tz: -Math.sin(spec.rot), plot: p, shake: 0 };
          this.walls.push(w);
        }
        w.alive = true;
        w.hp = w.maxHp;
        w.rig.root.visible = true;
        w.rig.root.scale.set(1, 0.01, 1);
        p.level = 0; // walls can be rebuilt after being destroyed
        this.fx.burst(v2.set(spec.x, 0.5, spec.z), COLORS.wood, 16, 4);
        break;
      }
      case 'squire':
        this.addSquire();
        this.fx.text(v2.copy(this.heroPos).setY(2.6), 'Squire joined!', 'good');
        break;
      case 'forge':
        this.forge = Math.min(FORGE_LEVELS.length - 1, this.forge + 1);
        this.fx.text(v2.copy(this.heroPos).setY(2.6), `Damage ${FORGE_LEVELS[this.forge].damage}!`, 'good');
        break;
      case 'expand':
        this.zone = Math.min(ZONE_RADII.length - 1, this.zone + 1);
        this.world.setLevel(this.zone);
        this.hud.banner('Land claimed!', false);
        break;
      case 'mine': {
        let mine = this.mines.get(def.id);
        if (!mine) {
          const rig = M.makeMine();
          rig.root.position.set(def.x, 0, def.z);
          rig.root.rotation.y = Math.atan2(-def.x, -def.z);
          this.root.add(rig.root);
          const pileMesh = new THREE.InstancedMesh(M.GEO.coin, M.MAT.coin, MINE.pileMax);
          pileMesh.count = 0;
          pileMesh.castShadow = true;
          pileMesh.frustumCulled = false;
          this.root.add(pileMesh);
          // Pile sits in front of the mine, toward the keep.
          const inward = v2.set(-def.x, 0, -def.z).normalize();
          const pilePos = new THREE.Vector3(def.x + inward.x * 2.2, 0, def.z + inward.z * 2.2);
          pileMesh.position.copy(pilePos);
          mine = { rig, pos: new THREE.Vector3(def.x, 0, def.z), level: 0, timer: 0, pile: 0, pileMesh, pilePos, collectT: 0 };
          this.mines.set(def.id, mine);
          // The plot moves aside so the mine stays visible.
          p.setPos(def.x - inward.z * 2.4, def.z + inward.x * 2.4);
          this.fx.text(v2.set(def.x, 3, def.z), 'Gold Mine!', 'good');
        } else {
          mine.level = Math.min(MINE.interval.length - 1, lvl);
          this.fx.text(v2.set(def.x, 3, def.z), 'Mine upgraded!', 'good');
        }
        break;
      }
    }
  }

  private updateTowers(dt: number) {
    for (const t of this.towers.values()) {
      t.grow = Math.min(1, t.grow + dt * 3);
      const g = t.grow;
      const s = g < 1 ? 1 + Math.sin(g * Math.PI) * 0.2 : 1;
      t.rig.root.scale.set(s, Math.max(0.01, g) * s, s);
      const stats = TOWER_LEVELS[t.level];
      t.cd -= dt;
      const target = this.nearestEnemy(t.pos, stats.range);
      if (!target) continue;
      const want = Math.atan2(target.pos.x - t.pos.x, target.pos.z - t.pos.z) - t.rig.root.rotation.y;
      t.rig.head.rotation.y = lerpAngle(t.rig.head.rotation.y, want, Math.min(1, dt * 12));
      if (t.cd <= 0) {
        t.cd = stats.delay;
        t.rig.muzzle.getWorldPosition(v1);
        this.fire(v1, target, stats.damage);
        if (stats.shots > 1) {
          const second = this.nearestEnemy(t.pos, stats.range, target) ?? target;
          this.fire(v1, second, stats.damage);
        }
        this.sfx.turret();
      }
    }
  }

  private damageWall(w: Wall, dmg: number) {
    w.hp -= dmg;
    w.lastHit = this.time;
    w.shake = 1;
    if (w.hp <= 0) {
      w.alive = false;
      w.rig.root.visible = false;
      this.fx.burst(v1.set(w.spec.x, 0.6, w.spec.z), COLORS.wood, 22, 5);
      this.sfx.pop();
    }
  }

  private updateWalls(dt: number) {
    for (const w of this.walls) {
      if (!w.alive) continue;
      // Rise out of the ground after building.
      if (w.rig.root.scale.y < 1) w.rig.root.scale.y = Math.min(1, w.rig.root.scale.y + dt * 4);
      w.shake = Math.max(0, w.shake - dt * 5);
      w.rig.root.position.x = w.spec.x + (Math.random() - 0.5) * w.shake * 0.12;
      // Slow self-repair when left alone.
      if (this.time - w.lastHit > 5) w.hp = Math.min(w.maxHp, w.hp + w.maxHp * 0.05 * dt);
    }
  }

  private updateMines(dt: number) {
    const m = new THREE.Matrix4();
    for (const mine of this.mines.values()) {
      mine.timer += dt;
      const interval = MINE.interval[mine.level];
      if (mine.timer >= interval) {
        mine.timer -= interval;
        if (mine.pile < MINE.pileMax) mine.pile++;
      }
      mine.rig.pick.rotation.x = Math.sin(this.time * 6) * 0.6;
      mine.rig.cart.position.x = Math.sin(this.time * 0.8) * 0.3;

      // Hero collects the pile by walking up to it.
      if (this.heroAlive && mine.pile > 0 && this.heroPos.distanceTo(mine.pilePos) < 2.2) {
        mine.collectT += dt * 25;
        while (mine.collectT >= 1 && mine.pile > 0) {
          mine.collectT -= 1;
          mine.pile--;
          const from = mine.pilePos.clone().setY(0.1 + mine.pile * 0.05);
          this.fx.fly(from, () => this.stackTop(v2), 0.25, 1, () => {
            this.carry++;
            this.pickupCombo++;
            this.pickupComboT = 0.6;
            this.sfx.pickup(this.pickupCombo);
            this.hud.bumpGold();
          });
        }
      } else mine.collectT = 0;

      // Draw the pile as small coin columns.
      mine.pileMesh.count = mine.pile;
      for (let i = 0; i < mine.pile; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        v1.set((col - 1) * 0.5, 0.06 + row * 0.1, (col % 2) * 0.3);
        m.makeTranslation(v1.x, v1.y, v1.z);
        mine.pileMesh.setMatrixAt(i, m);
      }
      mine.pileMesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ keep

  private damageKeep(dmg: number) {
    this.keepHp -= dmg;
    this.keepLastHit = this.time;
    this.fx.burst(v1.set((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2), COLORS.stone, 4, 3);
    this.fx.shake = Math.max(this.fx.shake, 0.15);
    if (this.keepHp <= 0 && !this.over) {
      this.keepHp = 0;
      this.over = true;
      this.sfx.boom();
      this.fx.burst(v1.set(0, 2, 0), COLORS.fire, 60, 9, 2);
      this.fx.shake = 1.5;
      this.events.haptic(true);
      this.events.onGameOver(this.wave);
    }
  }

  private updateKeep(dt: number) {
    if (this.time - this.keepLastHit > 5) this.keepHp = Math.min(KEEP.maxHp, this.keepHp + KEEP.regen * dt);
    this.keep.flag.rotation.y = Math.sin(this.time * 2.2) * 0.25;
    this.hud.setKeep(this.keepHp / KEEP.maxHp);
  }

  // ------------------------------------------------------------------ guide line

  /** Dotted trail to the nearest plot you can afford — the "go here next" nudge. */
  private updateGuide() {
    let best: Plot | null = null;
    let bd = Infinity;
    if (this.heroAlive && this.carry > 0) {
      for (const p of this.plots) {
        if (!p.shown || p.remaining > this.carry) continue;
        const d = p.pos.distanceToSquared(this.heroPos);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    const show = best && bd > 2.5 * 2.5;
    const n = this.guide.length;
    for (let i = 0; i < n; i++) {
      const dot = this.guide[i];
      if (!show) {
        dot.visible = false;
        continue;
      }
      const t = (i + ((this.time * 2) % 1)) / n;
      const len = Math.sqrt(bd) - 1.2;
      if (t * Math.sqrt(bd) > len) {
        dot.visible = false;
        continue;
      }
      dot.visible = true;
      dot.position.set(
        this.heroPos.x + (best!.pos.x - this.heroPos.x) * t,
        0.05,
        this.heroPos.z + (best!.pos.z - this.heroPos.z) * t,
      );
    }
  }

  // ------------------------------------------------------------------ teardown

  dispose() {
    this.scene.remove(this.root);
    for (const p of this.plots) p.dispose();
    for (const e of this.enemies) if (e.bar) this.hud.removeBar(e.bar);
    this.hud.removeBar(this.heroBar);
    const mats = new Set<THREE.Material>();
    for (const e of this.enemies) e.rig.mats.forEach((m) => mats.add(m));
    for (const pool of Object.values(this.enemyPool)) for (const r of pool) r.mats.forEach((m) => mats.add(m));
    mats.forEach((m) => m.dispose());
    M.MAT.tabard.emissive.setRGB(0, 0, 0);
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
