import * as THREE from 'three';
import { CASTLE_LEVELS, WORKERS } from './config';
import type { CharRig } from './assets';
import * as S from './structures';
import type { Fx } from './fx';
import type { Sfx } from './audio';

// The living kingdom: a wood/stone stockpile fed by villagers who actually go and fetch it,
// builders who patch up gates and barricades, and townsfolk going about their day.

const v1 = new THREE.Vector3();

export interface Repairable {
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  lastHit: number;
  /** Destroyed ones can be rebuilt from rubble by builders (gates). */
  rebuildable: boolean;
}

type Job = 'wood' | 'stone' | 'builder' | 'villager' | 'farmer';

interface Npc {
  job: Job;
  char: CharRig;
  pos: THREE.Vector3;
  facing: number;
  state: string;
  t: number;
  target: THREE.Vector3 | null;
  carry: THREE.Object3D | null;
  tree: Tree | null;
  field: Field | null;
  site: Repairable | null;
  home: THREE.Vector3;
  hitT: number;
  /** Which way to sidestep when something is in the way. */
  side: number;
}

interface Tree {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  state: 'up' | 'falling' | 'down';
  t: number;
  claimed: Npc | null;
  fallDir: number;
  baseScale: number;
}

interface Field {
  pos: THREE.Vector3;
  crops: THREE.InstancedMesh;
  grown: number;
  claimed: Npc | null;
}

/** Houses that appear around the castle as the kingdom grows: [model, x, z, size, castle level]. */
export const HOUSES: [string, number, number, number, number][] = [
  ['tent', -7, 22, 2.4, 0],
  ['building_home_A_blue', -9.5, 22.5, 3.6, 1],
  ['building_home_B_blue', 3.5, 22.5, 3.6, 1],
  ['building_well_blue', -3, 23.5, 2.4, 2],
  ['building_home_A_blue', 9.5, 21.5, 3.6, 2],
  ['building_windmill_blue', 16.5, 19, 5.5, 3],
  ['building_home_B_blue', -15.5, 19.5, 3.6, 3],
  ['building_home_A_blue', -4, 28, 3.6, 4],
  ['building_church_blue', 4, 28.5, 5.6, 4],
  ['building_home_B_blue', 12, 26.5, 3.6, 5],
  ['building_home_A_blue', -12, 27, 3.6, 5],
];

interface Site {
  root: THREE.Group;
  pos: THREE.Vector3;
  level: number;
  /** Where workers drop their haul. */
  drop: THREE.Vector3;
  pile: THREE.Object3D[];
  door?: THREE.Vector3;
}

export interface KingdomEvents {
  text(pos: THREE.Vector3, msg: string, cls?: string): void;
  push(p: THREE.Vector3, r: number): void;
}

export class Kingdom {
  wood = 0;
  stone = 0;
  food = WORKERS.startFood;
  farm: Site | null = null;
  private fields: Field[] = [];
  private houses: THREE.Object3D[] = [];
  /** Things that rise out of the ground when built. */
  private risers: { obj: THREE.Object3D; t: number }[] = [];
  castleLevel = 0; // index into CASTLE_LEVELS
  private npcs: Npc[] = [];
  private trees: Tree[] = [];
  camp: Site | null = null;
  quarry: Site | null = null;
  private time = 0;
  /** Points of interest in town that villagers stroll between. */
  private waypoints: THREE.Vector3[] = [];

  constructor(
    private root: THREE.Object3D,
    private fx: Fx,
    private sfx: Sfx,
    private ev: KingdomEvents,
    private hallPos = new THREE.Vector3(0, 0, 0),
  ) {
    this.waypoints = [
      [0, 7],
      [-5, 9],
      [2.5, 10],
      [-3, 21.5],
      [6, 20],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.syncHouses();
    this.syncPopulation();
  }

  // ---------------------------------------------------------------- buildings

  buildCamp(pos: THREE.Vector3, level: number) {
    if (!this.camp) {
      const root = new THREE.Group();
      const b = S.prop('building_lumbermill_blue', 4.6, 'max');
      b.rotation.y = Math.PI;
      root.add(b);
      root.position.copy(pos);
      this.root.add(root);
      this.camp = { root, pos: pos.clone(), level, drop: pos.clone().add(new THREE.Vector3(2.4, 0, 2.2)), pile: [] };
      this.plantForest(pos);
    }
    this.camp.level = level;
    this.syncPopulation();
    this.refreshPiles();
  }

  buildQuarry(pos: THREE.Vector3, level: number) {
    if (!this.quarry) {
      const root = new THREE.Group();
      const b = S.prop('building_mine_blue', 4.8, 'max');
      b.rotation.y = Math.PI;
      root.add(b);
      for (const [x, z, s] of [
        [-3.2, -1.5, 1.3],
        [3.4, -0.8, 1.1],
        [-2.6, 2.2, 0.8],
      ]) {
        const r = S.prop('rock_single_' + 'ABCDE'[Math.floor(Math.abs(x * 7)) % 5], s, 'max');
        r.position.set(x, 0, z);
        root.add(r);
      }
      root.position.copy(pos);
      this.root.add(root);
      this.quarry = {
        root,
        pos: pos.clone(),
        level,
        drop: pos.clone().add(new THREE.Vector3(2.6, 0, 2.6)),
        door: pos.clone().add(new THREE.Vector3(0, 0, 2.5)),
        pile: [],
      };
    }
    this.quarry.level = level;
    this.syncPopulation();
    this.refreshPiles();
  }

  setCastleLevel(level: number) {
    this.castleLevel = level;
    this.syncHouses();
    this.syncPopulation();
  }

  /** New homes pop up as the castle levels up; townsfolk stroll between them. */
  private syncHouses() {
    HOUSES.forEach(([name, x, z, size, lvl], i) => {
      if (lvl > this.castleLevel || this.houses[i]) return;
      const h = S.prop(name, size, 'max');
      h.position.set(x, 0, z);
      h.rotation.y = Math.atan2(-x, -(z - 2.5)) + Math.PI;
      this.root.add(h);
      this.houses[i] = h;
      this.risers.push({ obj: h, t: 0 });
      this.waypoints.push(new THREE.Vector3(x + (x > 0 ? -2 : 2), 0, z - 2.4));
      this.fx.p.build(new THREE.Vector3(x, 0.5, z));
    });
  }

  buildFarm(pos: THREE.Vector3, level: number) {
    if (!this.farm) {
      const root = new THREE.Group();
      const mill = S.prop('building_windmill_blue', 5.2, 'max');
      mill.rotation.y = Math.PI;
      root.add(mill);
      root.position.copy(pos);
      this.root.add(root);
      this.farm = { root, pos: pos.clone(), level, drop: pos.clone().add(new THREE.Vector3(2.2, 0, 2.4)), pile: [] };
      // Wheat fields beside the windmill.
      const stalk = new THREE.ConeGeometry(0.07, 0.75, 4).translate(0, 0.37, 0);
      const wheat = new THREE.MeshStandardMaterial({ color: 0xe8c24a, roughness: 0.8 });
      const dirt = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 });
      for (const [dx, dz] of [
        [-4.5, -2],
        [-4.5, 2.2],
        [4.6, -2.4],
        [-0.5, 5],
      ]) {
        const fp = pos.clone().add(new THREE.Vector3(dx, 0, dz));
        const bed = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 3), dirt);
        bed.position.copy(fp).setY(0.06);
        bed.receiveShadow = true;
        this.root.add(bed);
        const crops = new THREE.InstancedMesh(stalk, wheat, 36);
        crops.castShadow = true;
        this.root.add(crops);
        this.fields.push({ pos: fp, crops, grown: 1, claimed: null });
      }
    }
    this.farm.level = level;
    this.syncPopulation();
    this.refreshPiles();
  }

  /** Choppable trees around the lumber camp; they fall when cut and grow back. */
  private plantForest(camp: THREE.Vector3) {
    const spots: [number, number][] = [
      [-4.5, -4],
      [-6.5, -1],
      [-3, -7],
      [-7.5, -5.5],
      [-1, -9],
      [-5.5, -9],
      [-9, -2.5],
      [-8.5, -8.5],
      [0.5, -6],
      [-2.5, -11.5],
    ];
    spots.forEach(([dx, dz], i) => {
      const obj = S.prop(i % 2 ? 'tree_single_A' : 'tree_single_B', 2.6 + (i % 3) * 0.4);
      const pos = new THREE.Vector3(camp.x + dx, 0, camp.z + dz);
      obj.position.copy(pos);
      obj.rotation.y = i * 1.7;
      this.root.add(obj);
      this.trees.push({ obj, pos, state: 'up', t: 0, claimed: null, fallDir: i * 2.3, baseScale: obj.scale.x });
    });
  }

  /** Log and stone piles grow with the stockpile. */
  private refreshPiles() {
    const fill = (site: Site | null, name: string, amount: number, per: number, size: number) => {
      if (!site) return;
      const want = Math.min(8, Math.ceil(amount / per));
      while (site.pile.length < want) {
        const i = site.pile.length;
        const p = S.prop(name, size, 'max');
        p.position.set(site.drop.x + (i % 3) * 0.75 - 0.75, Math.floor(i / 3) * 0.35, site.drop.z + (Math.floor(i / 3) % 2) * 0.3);
        p.rotation.y = i * 0.5;
        this.root.add(p);
        site.pile.push(p);
      }
      while (site.pile.length > want) this.root.remove(site.pile.pop()!);
    };
    fill(this.camp, 'resource_lumber', this.wood, 6, 1.1);
    fill(this.quarry, 'resource_stone', this.stone, 6, 0.9);
    fill(this.farm, 'sack', this.food, 6, 0.8);
  }

  /** Spends from the stockpile; the goods fly from their pile to `to`. */
  spend(wood: number, stone: number, to: THREE.Vector3, food = 0) {
    this.wood -= wood;
    this.stone -= stone;
    this.food -= food;
    const fly = (from: THREE.Vector3 | undefined, n: number, color: number) => {
      if (!from || !n) return;
      for (let i = 0; i < Math.min(8, n); i++) {
        this.fx.fly(from.clone().setY(1), () => v1.copy(to).setY(0.3), 0.6 + i * 0.05, 3, () => {}, 1.4);
        this.fx.p.sparkle(from.clone().setY(1.2), color, 2);
      }
    };
    fly(this.camp?.drop, wood, 0xd9a066);
    fly(this.quarry?.drop, stone, 0xd8d4cc);
    fly(this.farm?.drop, food, 0xf0c24a);
    this.refreshPiles();
  }

  // ---------------------------------------------------------------- population

  private count(job: Job) {
    return this.npcs.filter((n) => n.job === job).length;
  }

  private syncPopulation() {
    const want: Record<Job, number> = {
      wood: this.camp ? WORKERS.perLevel[Math.min(this.camp.level, 2)] : 0,
      stone: this.quarry ? WORKERS.perLevel[Math.min(this.quarry.level, 2)] : 0,
      builder: CASTLE_LEVELS[this.castleLevel].builders,
      villager: CASTLE_LEVELS[this.castleLevel].villagers,
      farmer: this.farm ? WORKERS.perLevel[Math.min(this.farm.level, 2)] : 0,
    };
    for (const job of Object.keys(want) as Job[]) {
      while (this.count(job) < want[job]) this.spawn(job);
    }
  }

  private spawn(job: Job) {
    const char = S.makeNpc(job === 'wood' || job === 'builder' ? 'worker' : 'villager');
    const start =
      job === 'wood' && this.camp
        ? this.camp.drop.clone()
        : job === 'stone' && this.quarry
          ? this.quarry.drop.clone()
          : job === 'farmer' && this.farm
            ? this.farm.drop.clone()
            : this.hallPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, 4.5));
    char.root.position.copy(start);
    if (job !== 'wood') {
      // Only woodcutters carry axes.
      const axe = char.find('1H_Axe');
      if (axe) axe.visible = false;
    }
    if (job === 'builder') {
      // Builders get a hammer-ish tool: reuse the axe, it reads fine at this size.
      const axe = char.find('1H_Axe');
      if (axe) axe.visible = true;
    }
    this.root.add(char.root);
    const home = start.clone();
    this.npcs.push({ job, char, pos: start, facing: 0, state: 'idle', t: Math.random() * 2, target: null, carry: null, tree: null, field: null, site: null, home, hitT: 0, side: Math.random() < 0.5 ? -1 : 1 });
    this.fx.p.levelUp(start.clone().setY(0.3));
  }

  // ---------------------------------------------------------------- update

  update(dt: number, repairables: Repairable[], now: number) {
    this.time += dt;
    for (const tree of this.trees) this.updateTree(tree, dt);
    for (let i = this.risers.length - 1; i >= 0; i--) {
      const r = this.risers[i];
      r.t = Math.min(1, r.t + dt * 2.2);
      const k = r.t < 1 ? 1 + Math.sin(r.t * Math.PI) * 0.15 : 1;
      r.obj.scale.y = r.obj.scale.x * Math.max(0.01, r.t) * k;
      if (r.t >= 1) {
        r.obj.scale.y = r.obj.scale.x;
        this.risers.splice(i, 1);
      }
    }
    const fm = new THREE.Matrix4();
    for (const f of this.fields) {
      if (f.grown < 1) f.grown = Math.min(1, f.grown + dt / 16);
      // Stalks grow back taller over time.
      const s = 0.15 + f.grown * 0.85;
      for (let i = 0; i < 36; i++) {
        fm.makeScale(1, s, 1).setPosition(f.pos.x - 1.25 + (i % 6) * 0.5, 0.1, f.pos.z - 1.25 + Math.floor(i / 6) * 0.5);
        f.crops.setMatrixAt(i, fm);
      }
      f.crops.instanceMatrix.needsUpdate = true;
    }
    for (const n of this.npcs) {
      switch (n.job) {
        case 'wood':
          this.woodcutter(n, dt);
          break;
        case 'stone':
          this.miner(n, dt);
          break;
        case 'builder':
          this.builder(n, dt, repairables, now);
          break;
        case 'villager':
          this.villager(n, dt);
          break;
        case 'farmer':
          this.farmer(n, dt);
          break;
      }
      n.char.root.position.copy(n.pos);
      n.char.root.rotation.y = n.facing;
      n.char.update(dt);
    }
  }

  /** Walks toward target; returns true on arrival. */
  private walk(n: Npc, target: THREE.Vector3, dt: number, speed = WORKERS.speed) {
    const dx = target.x - n.pos.x;
    const dz = target.z - n.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      n.char.loop('Idle');
      return true;
    }
    const step = Math.min(d, speed * dt);
    n.pos.x += (dx / d) * step;
    n.pos.z += (dz / d) * step;
    const bx = n.pos.x;
    const bz = n.pos.z;
    this.ev.push(n.pos, 0.3);
    // Blocked by a building: slide around it instead of pushing into it forever.
    if (Math.hypot(n.pos.x - bx, n.pos.z - bz) > step * 0.4) {
      n.pos.x += (-dz / d) * n.side * step;
      n.pos.z += (dx / d) * n.side * step;
      this.ev.push(n.pos, 0.3);
    }
    n.facing = lerpAngle(n.facing, Math.atan2(dx, dz), Math.min(1, dt * 10));
    n.char.loop('Walking_A');
    n.char.setSpeed(speed / 2.6);
    return false;
  }

  private face(n: Npc, p: THREE.Vector3, dt: number) {
    n.facing = lerpAngle(n.facing, Math.atan2(p.x - n.pos.x, p.z - n.pos.z), Math.min(1, dt * 8));
  }

  private setCarry(n: Npc, prop: string | null, size = 0.8) {
    if (n.carry) n.char.root.remove(n.carry);
    n.carry = null;
    if (!prop) return;
    const c = S.prop(prop, size, 'max');
    c.position.set(0, 1.75, 0.15);
    n.char.root.add(c);
    n.carry = c;
  }

  private deposit(n: Npc, kind: 'wood' | 'stone' | 'food', amount: number) {
    if (kind === 'wood') this.wood += amount;
    else if (kind === 'stone') this.stone += amount;
    else this.food += amount;
    this.setCarry(n, null);
    this.ev.text(n.pos.clone().setY(2.4), `+${amount} ${kind}`, kind === 'stone' ? 'stone' : 'wood');
    this.fx.p.sparkle(n.pos.clone().setY(1), kind === 'wood' ? 0xd9a066 : kind === 'food' ? 0xf0c24a : 0xe8e4dc, 4);
    this.sfx.pay(0.5);
    this.refreshPiles();
  }

  private woodcutter(n: Npc, dt: number) {
    const camp = this.camp!;
    switch (n.state) {
      case 'idle': {
        n.t -= dt;
        n.char.loop('Idle');
        if (n.t > 0) break;
        // Claim the nearest standing tree.
        let best: Tree | null = null;
        let bd = Infinity;
        for (const t of this.trees) {
          if (t.state !== 'up' || t.claimed) continue;
          const d = t.pos.distanceToSquared(n.pos);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        if (!best) {
          n.t = 1.5;
          break;
        }
        best.claimed = n;
        n.tree = best;
        // Stand just in front of the tree.
        const dir = v1.subVectors(n.pos, best.pos).setY(0).normalize();
        n.target = best.pos.clone().addScaledVector(dir, 0.9);
        n.state = 'toTree';
        break;
      }
      case 'toTree':
        if (this.walk(n, n.target!, dt)) {
          n.state = 'chop';
          n.t = WORKERS.chopTime;
          n.hitT = 0;
        }
        break;
      case 'chop': {
        const tree = n.tree!;
        this.face(n, tree.pos, dt);
        n.char.loop('1H_Melee_Attack_Chop');
        n.t -= dt;
        n.hitT -= dt;
        if (n.hitT <= 0) {
          n.hitT = 0.75;
          // Wood chips fly and the tree shudders.
          this.fx.p.emit({ pos: tree.pos.clone().setY(0.9), count: 6, color: [0xd9a066, 0x8a5a33, 0xf0d0a0], speed: 3, up: 2, size: 0.18, life: 0.5, gravity: 12, glow: false });
          tree.t = 0.25;
          this.sfx.hit();
        }
        if (n.t <= 0) {
          tree.state = 'falling';
          tree.t = 0;
          tree.claimed = null;
          n.tree = null;
          this.setCarry(n, 'resource_lumber', 0.9);
          n.char.once('PickUp', 1.6);
          n.state = 'toCamp';
          n.target = camp.drop.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, 0.8));
        }
        break;
      }
      case 'toCamp':
        if (this.walk(n, n.target!, dt, WORKERS.speed * 0.85)) {
          this.deposit(n, 'wood', WORKERS.woodPerTrip);
          n.state = 'idle';
          n.t = 0.6;
        }
        break;
    }
  }

  private updateTree(t: Tree, dt: number) {
    if (t.state === 'up') {
      // Shudder after an axe hit.
      if (t.t > 0) {
        t.t = Math.max(0, t.t - dt);
        t.obj.rotation.z = Math.sin(t.t * 60) * t.t * 0.25;
      } else t.obj.rotation.z = 0;
    } else if (t.state === 'falling') {
      t.t += dt;
      const k = Math.min(1, t.t / 0.9);
      t.obj.rotation.set(0, t.fallDir, 0);
      t.obj.rotateX((k * k * Math.PI) / 2);
      if (k >= 1) {
        this.fx.p.dust(t.pos.clone().setY(0.2), 6);
        this.sfx.pop();
        t.state = 'down';
        t.t = 0;
      }
    } else {
      t.t += dt;
      // Gone, then a sapling grows back.
      const grow = Math.max(0, (t.t - 1.5) / WORKERS.treeRegrow);
      t.obj.rotation.set(0, t.fallDir, 0);
      t.obj.scale.setScalar(Math.max(0.001, Math.min(1, grow)) * t.baseScale);
      if (grow >= 1) {
        t.state = 'up';
        t.t = 0;
      }
    }
  }

  private miner(n: Npc, dt: number) {
    const q = this.quarry!;
    switch (n.state) {
      case 'idle':
        n.t -= dt;
        n.char.loop('Idle');
        if (n.t <= 0) {
          n.state = 'toMine';
          n.target = q.door!.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0));
        }
        break;
      case 'toMine':
        if (this.walk(n, n.target!, dt)) {
          n.state = 'inside';
          n.t = WORKERS.mineTime;
          n.char.root.visible = false;
        }
        break;
      case 'inside':
        n.t -= dt;
        if (Math.random() < dt * 3) this.fx.p.dust(q.door!.clone().setY(0.4), 1);
        if (Math.random() < dt * 1.2) this.sfx.hit();
        if (n.t <= 0) {
          n.char.root.visible = true;
          this.setCarry(n, 'resource_stone', 0.75);
          n.state = 'toPile';
          n.target = q.drop.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, 0.8));
        }
        break;
      case 'toPile':
        if (this.walk(n, n.target!, dt, WORKERS.speed * 0.8)) {
          this.deposit(n, 'stone', WORKERS.stonePerTrip);
          n.state = 'idle';
          n.t = 0.8;
        }
        break;
    }
  }

  private farmer(n: Npc, dt: number) {
    const farm = this.farm!;
    switch (n.state) {
      case 'idle': {
        n.t -= dt;
        n.char.loop('Idle');
        if (n.t > 0) break;
        const field = this.fields.find((f) => f.grown >= 1 && !f.claimed);
        if (!field) {
          n.t = 1.5;
          break;
        }
        field.claimed = n;
        n.field = field;
        n.target = field.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, 1.8));
        n.state = 'toField';
        break;
      }
      case 'toField':
        if (this.walk(n, n.target!, dt)) {
          n.state = 'harvest';
          n.t = WORKERS.harvestTime;
        }
        break;
      case 'harvest': {
        const f = n.field!;
        this.face(n, f.pos, dt);
        n.char.loop('Interact');
        n.t -= dt;
        if (Math.random() < dt * 6) this.fx.p.emit({ pos: f.pos.clone().setY(0.6), count: 2, color: [0xf0c24a, 0xfff0a0], spread: 1.2, speed: 1.5, up: 2, size: 0.18, life: 0.6, gravity: 6, glow: false });
        if (n.t <= 0) {
          f.grown = 0;
          f.claimed = null;
          n.field = null;
          this.setCarry(n, 'sack', 0.7);
          n.state = 'toMill';
          n.target = farm.drop.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, 0.8));
        }
        break;
      }
      case 'toMill':
        if (this.walk(n, n.target!, dt, WORKERS.speed * 0.85)) {
          this.deposit(n, 'food', WORKERS.foodPerTrip);
          n.state = 'idle';
          n.t = 0.6;
        }
        break;
    }
  }

  private builder(n: Npc, dt: number, sites: Repairable[], now: number) {
    switch (n.state) {
      case 'idle': {
        n.t -= dt;
        n.char.loop('Idle');
        if (n.t > 0) break;
        n.t = 0.8;
        // Most damaged structure that isn't under attack right now and nobody else is fixing.
        let best: Repairable | null = null;
        let worst = 0.999;
        for (const s of sites) {
          if (now - s.lastHit < 2.5) continue;
          if (!s.alive && !s.rebuildable) continue;
          if (this.npcs.some((o) => o !== n && o.site === s)) continue;
          const f = s.alive ? s.hp / s.maxHp : 0;
          if (f < worst) {
            worst = f;
            best = s;
          }
        }
        if (best) {
          n.site = best;
          n.target = best.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 0, 2.2));
          n.state = 'toSite';
          this.ev.text(n.pos.clone().setY(2.4), 'On my way!', 'good');
        } else if (n.pos.distanceTo(n.home) > 1) {
          n.target = n.home;
          n.state = 'goHome';
        }
        break;
      }
      case 'toSite':
        if (this.walk(n, n.target!, dt, WORKERS.speed * 1.2)) {
          n.state = 'repair';
          n.hitT = 0;
        }
        break;
      case 'repair': {
        const s = n.site!;
        this.face(n, s.pos, dt);
        n.char.loop('Interact');
        n.hitT -= dt;
        if (n.hitT <= 0) {
          n.hitT = 0.5;
          this.fx.p.emit({ pos: s.pos.clone().setY(1), count: 4, color: [0xffe28a, 0xffffff], speed: 3, up: 2, size: 0.22, life: 0.35, gravity: 8, shape: 1 });
          this.sfx.hit();
        }
        if (now - s.lastHit < 1.5) {
          // Under attack: back off.
          n.site = null;
          n.state = 'idle';
          n.t = 2;
          break;
        }
        s.hp = Math.min(s.maxHp, Math.max(0, s.hp) + WORKERS.repairRate * dt);
        if (s.hp >= s.maxHp || (!s.alive && s.hp >= s.maxHp * 0.5)) {
          n.site = null;
          n.state = 'idle';
          n.t = 0.5;
          n.char.once('Cheer', 1.4);
        }
        break;
      }
      case 'goHome':
        if (this.walk(n, n.target!, dt)) {
          n.state = 'idle';
          n.t = 1;
        }
        break;
    }
  }

  private villager(n: Npc, dt: number) {
    switch (n.state) {
      case 'idle':
        n.t -= dt;
        if (n.t <= 0) {
          const wp = this.waypoints[Math.floor(Math.random() * this.waypoints.length)];
          n.target = wp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5));
          n.state = 'walk';
        }
        break;
      case 'walk':
        if (this.walk(n, n.target!, dt, WORKERS.speed * 0.55)) {
          n.state = 'idle';
          n.t = 3 + Math.random() * 6;
          const r = Math.random();
          // Chat, sit, or just stand around.
          n.char.loop(r < 0.35 ? 'Interact' : r < 0.55 ? 'Sit_Floor_Idle' : 'Idle');
        }
        break;
    }
  }

  dispose() {
    for (const n of this.npcs) this.root.remove(n.char.root);
    for (const t of this.trees) this.root.remove(t.obj);
    for (const h of this.houses) if (h) this.root.remove(h);
    this.npcs = [];
    this.trees = [];
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
