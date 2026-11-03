import * as THREE from 'three';
import type { Assets } from './assets';
import type { MapPalette } from './config';
import { detailize } from './materials';
import { BOUNDS, LANDS, SPOTS, type Land } from './realm';
import { bakeStatic, groundTexture, mulberry32 } from './world';

// The realm's look. Unclaimed land is wild forest (painted trees, tall grass, ferns, mossy rocks);
// claimed land becomes a bright meadow: a grass layer masked by a small canvas grows outward from
// where the last fence went up, the wild growth withers as it passes, and grass, clover and flowers
// sprout in its place. Deep woods and big mossy boulders ring the valley, with mist beyond.
// Models: Quaternius Stylized Nature MegaKit (CC0).

const EXTENT = 136; // world units covered by the mask
const MASK = 272; // mask pixels (2 per unit: soft edges after linear filtering)
const GROW = 1.6; // seconds for green to cover a land

// Chunky, rounded low-poly trees read best with cartoon shading and outlines.
const WILD_TREES = ['Tree_4_A_Color1', 'Tree_5_A_Color1', 'Tree_1_A_Color1', 'Tree_4_A_Color1', 'Tree_3_A_Color1', 'tree_single_A'];
const MEADOW_TREES = ['Tree_1_A_Color1', 'tree_single_B', 'Tree_1_A_Color1'];

const GRASS: MapPalette = {
  ground: 0x58c450,
  groundDark: 0x4cb846,
  groundLight: 0x66cf5c,
  tufts: [],
  flowers: [],
  decorTint: [1, 1, 1],
  sky: 0,
  fog: 0,
  road: 0,
  roadEdge: 0,
};

/** Instances of one prop that grow in (meadow) or wither away (wild) as a land is claimed. */
interface Patch {
  meshes: THREE.InstancedMesh[];
  /** Per instance: placement and the sub-mesh's own transform inside the prop. */
  places: THREE.Matrix4[];
  parts: THREE.Matrix4[];
  wither: boolean;
}

interface LandFx {
  land: Land;
  /** 0 = wild, 1 = fully green. */
  p: number;
  /** Radius of the green circle. */
  R: number;
  growing: boolean;
  ox: number;
  oz: number;
  patches: Patch[];
  wild: THREE.Object3D[];
  lush: THREE.Object3D[];
}

const m4 = new THREE.Matrix4();
const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();

export class Territory {
  readonly root = new THREE.Group();
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private mask: THREE.CanvasTexture;
  private grass: THREE.Mesh;
  private lands: LandFx[] = [];
  private clouds: { o: THREE.Object3D; phase: number; base: THREE.Vector3 }[] = [];
  private time = 0;
  private dirty = true;
  /** Geometry and materials we created (asset-library geometry is shared and must survive). */
  private owned: { dispose(): void }[] = [];
  private fades: { o: THREE.Object3D; mats: THREE.MeshStandardMaterial[]; a: number }[] = [];

  constructor(
    parent: THREE.Object3D,
    private assets: Assets,
    pal: MapPalette,
    keepClear: { x: number; z: number; r: number }[],
  ) {
    parent.add(this.root);
    this.canvas.width = this.canvas.height = MASK;
    this.mask = new THREE.CanvasTexture(this.canvas);
    this.mask.colorSpace = THREE.NoColorSpace;
    const grassTex = groundTexture(GRASS);
    grassTex.repeat.set(EXTENT / 9, EXTENT / 9);
    const mat = detailize(
      new THREE.MeshStandardMaterial({ map: grassTex, alphaMap: this.mask, transparent: true, depthWrite: false, roughness: 0.95 }),
      0.08,
      0.6,
    );
    this.grass = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT, EXTENT), mat);
    this.grass.rotation.x = -Math.PI / 2;
    this.grass.position.y = 0.025;
    this.grass.receiveShadow = true;
    this.grass.renderOrder = 1;
    this.root.add(this.grass);
    this.owned.push(this.grass.geometry, mat, grassTex);

    const rng = mulberry32(99);
    const clear = (x: number, z: number, pad: number) => {
      for (const c of keepClear) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return false;
      for (const sp of SPOTS) if (Math.hypot(x - sp.x, z - sp.z) < 3.4 + pad) return false;
      if (Math.hypot(x, z) < 6 + pad) return false;
      return true;
    };
    // Keep fence lines free of trees.
    const nearFence = (x: number, z: number, pad = 1.8) => {
      const fx = Math.abs((((x + 10) % 20) + 20) % 20 - 10);
      const fz = Math.abs((((z + 10) % 20) + 20) % 20 - 10);
      return 10 - fx < pad || 10 - fz < pad;
    };
    const tint = pal.decorTint;

    for (const land of LANDS) {
      const inside = (pad: number) => {
        for (let t = 0; t < 30; t++) {
          const x = land.x0 + pad + rng() * (20 - pad * 2);
          const z = land.z0 + pad + rng() * (20 - pad * 2);
          if (clear(x, z, 0.2)) return [x, z] as const;
        }
        return null;
      };
      const scatter = (count: number, pad: number, fence: number) => {
        const out: [number, number][] = [];
        for (let i = 0; i < count; i++) {
          const p = inside(pad);
          if (p && !nearFence(p[0], p[1], fence)) out.push([p[0], p[1]]);
        }
        return out;
      };
      const patches: Patch[] = [];
      // Meadow: short grass everywhere, clover and flowers in drifts.
      patches.push(this.patch('Grass_Common_Short', 0.5, 'y', scatter(110, 0.4, 0), rng, 0.7, 1.2, false));
      patches.push(this.patch('Clover_1', 0.5, 'max', scatter(26, 1, 0.6), rng, 0.8, 1.4, false));
      patches.push(this.patch('Flower_3_Group', 0.7, 'max', scatter(12, 1, 0.6), rng, 0.8, 1.3, false));
      patches.push(this.patch('Flower_4_Group', 0.75, 'max', scatter(8, 1, 0.6), rng, 0.8, 1.3, false));
      // Wild: tall grass and mushrooms that wither away.
      patches.push(this.patch('Mushroom_Common', 0.45, 'max', scatter(10, 1.5, 1.2), rng, 0.7, 1.3, true));
      for (const p of patches) if (!p.wither) for (const im of p.meshes) im.count = 0;

      // Individual wild trees, rocks and ferns (fade when in front of the king).
      const wild: THREE.Object3D[] = [];
      const addWild = (name: string, size: number, axis: 'y' | 'max', minGap: number) => {
        for (let t = 0; t < 20; t++) {
          const p = inside(1.6);
          if (!p || nearFence(p[0], p[1])) continue;
          if (wild.some((w) => Math.hypot(w.position.x - p[0], w.position.z - p[1]) < minGap)) continue;
          const o = this.assets.prop(name, size, axis);
          o.position.set(p[0], 0, p[1]);
          o.rotation.y = rng() * 6.28;
          o.userData.s = o.scale.x;
          this.root.add(o);
          this.fadeable(o, tint);
          wild.push(o);
          return;
        }
      };
      const trees = land.id === 0 ? 4 : 8;
      for (let i = 0; i < trees; i++) addWild(WILD_TREES[Math.floor(rng() * WILD_TREES.length)], 2.6 + rng() * 1.4, 'y', 2.2);
      for (let i = 0; i < 4; i++) addWild(['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'][i % 3], 0.9 + rng() * 1.1, 'max', 1.4);
      for (let i = 0; i < 5; i++) addWild('Bush_1_A_Color1', 0.9 + rng() * 0.6, 'max', 1.2);

      // A few meadow trees and flowering bushes pop up once the land is yours.
      const lush: THREE.Object3D[] = [];
      for (let i = 0; i < 6; i++) {
        const p = inside(2);
        if (!p || nearFence(p[0], p[1], 2.2)) continue;
        const tree = i < 3;
        const o = this.assets.prop(tree ? MEADOW_TREES[i % MEADOW_TREES.length] : 'Bush_1_A_Color1', tree ? 3.2 + rng() * 1.2 : 1 + rng() * 0.4, tree ? 'y' : 'max');
        o.position.set(p[0], 0, p[1]);
        o.rotation.y = rng() * 6.28;
        o.userData.s = o.scale.x;
        o.scale.setScalar(0.001);
        o.visible = false;
        this.root.add(o);
        this.fadeable(o, [1, 1, 1]);
        lush.push(o);
      }
      this.lands.push({ land, p: 0, R: 0, growing: false, ox: 0, oz: 0, patches, wild, lush });
    }

    this.outskirts(pal, rng);
    this.redraw();
  }

  /**
   * Places many copies of a prop as instanced meshes (one per sub-mesh). `spots` are x/z positions;
   * each gets a random turn and a scale between lo and hi.
   */
  private patch(name: string, size: number, axis: 'y' | 'max', spots: [number, number][], rng: () => number, lo: number, hi: number, wither: boolean, tint?: [number, number, number]): Patch {
    const proto = this.assets.prop(name, size, axis);
    proto.updateMatrixWorld(true);
    const places = spots.map(([x, z]) => {
      const sc = lo + rng() * (hi - lo);
      return new THREE.Matrix4().compose(v.set(x, 0, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * 6.28), s.set(sc, sc, sc));
    });
    const meshes: THREE.InstancedMesh[] = [];
    const parts: THREE.Matrix4[] = [];
    proto.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let mat = m.material as THREE.Material;
      if (tint && (tint[0] !== 1 || tint[2] !== 1)) {
        const c = (mat as THREE.MeshStandardMaterial).clone();
        c.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]));
        this.owned.push(c);
        mat = c;
      }
      const im = new THREE.InstancedMesh(m.geometry, mat, Math.max(1, places.length));
      places.forEach((p, i) => im.setMatrixAt(i, m4.multiplyMatrices(p, m.matrixWorld)));
      im.count = places.length;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.root.add(im);
      meshes.push(im);
      parts.push(m.matrixWorld.clone());
    });
    return { meshes, places, parts, wither };
  }

  /** Deep woods and big mossy boulders walling in the valley, then a ring of mist. */
  private outskirts(pal: MapPalette, rng: () => number) {
    const stage = new THREE.Group();
    const add = (name: string, size: number, axis: 'y' | 'max', x: number, z: number) => {
      const o = this.assets.prop(name, size, axis);
      o.position.set(x, 0, z);
      o.rotation.y = rng() * 6.28;
      stage.add(o);
    };
    const spots: [number, number][] = [];
    const ok = (x: number, z: number, gap: number) => !spots.some(([a, b]) => Math.hypot(a - x, b - z) < gap);
    for (let i = 0; i < 2600 && spots.length < 220; i++) {
      const x = (rng() - 0.5) * 112;
      const z = (rng() - 0.5) * 112;
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d < 32 || d > 50 || !ok(x, z, 2.2)) continue;
      // Low growth only on the camera side near the edge, so nothing hides the king.
      const near = (x > 31 && x < 42) || (z > 31 && z < 42);
      spots.push([x, z]);
      if (near) add('Bush_1_A_Color1', 1.2 + rng() * 0.8, 'max', x, z);
      else add(WILD_TREES[Math.floor(rng() * WILD_TREES.length)], 4 + rng() * 3, 'y', x, z);
    }
    // Boulders: big on the far sides like valley walls, small on the camera side.
    for (let i = 0; i < 90; i++) {
      const x = (rng() - 0.5) * 130;
      const z = (rng() - 0.5) * 130;
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d < 44 || d > 64) continue;
      const near = x > 40 || z > 40;
      add(['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'][i % 3], near ? 3 + rng() * 3 : 9 + rng() * 9, 'max', x, z);
    }
    for (let i = 0; i < 60; i++) {
      const x = (rng() - 0.5) * 80;
      const z = (rng() - 0.5) * 80;
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d < 31 || d > 38) continue;
      add(['Rock_Medium_2', 'Bush_1_A_Color1', 'Rock_Medium_1'][i % 3], 0.8 + rng() * 0.8, 'max', x, z);
    }
    const baked = bakeStatic(stage, pal.decorTint);
    baked.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.owned.push(m.geometry);
    });
    this.root.add(baked);

    // Mist: big soft clouds sitting on the ground beyond the edge of the realm.
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, emissive: 0xffffff, emissiveIntensity: 0.35 });
    this.owned.push(cloudMat);
    for (let i = 0; i < 46; i++) {
      const side = i % 4;
      const t = (rng() - 0.5) * 2 * (BOUNDS + 16);
      const out = BOUNDS + 24 + rng() * 10;
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? out : -out;
      const z = side === 0 ? out : side === 1 ? -out : t;
      const c = this.assets.prop(rng() > 0.5 ? 'cloud_big' : 'cloud_small', 12 + rng() * 9, 'max');
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = cloudMat;
          m.castShadow = false;
        }
      });
      c.position.set(x, -0.5 + rng() * 1.2, z);
      c.rotation.y = rng() * 6.28;
      this.root.add(c);
      this.clouds.push({ o: c, phase: rng() * 6.28, base: c.position.clone() });
    }
  }

  /** Gives a prop its own materials so it can turn see-through when it stands between camera and king. */
  private fadeable(o: THREE.Object3D, tint: [number, number, number]) {
    const mats: THREE.MeshStandardMaterial[] = [];
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const mm = (m.material as THREE.MeshStandardMaterial).clone();
      mm.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]));
      m.material = mm;
      mats.push(mm);
      this.owned.push(mm);
    });
    this.fades.push({ o, mats, a: 1 });
  }

  /** Trees in front of the king (toward the camera, which looks in from +x/+z) fade out. */
  fadeAround(focus: THREE.Vector3, dt: number) {
    const k = Math.SQRT1_2;
    for (const f of this.fades) {
      if (!f.o.visible) continue;
      const dx = f.o.position.x - focus.x;
      const dz = f.o.position.z - focus.z;
      const along = (dx + dz) * k;
      const side = Math.abs(dx - dz) * k;
      const want = along > -0.5 && along < 18 && side < 3.5 + along * 0.3 ? 0.2 : 1;
      if (want === f.a) continue;
      f.a = want < f.a ? Math.max(want, f.a - dt * 4) : Math.min(want, f.a + dt * 3);
      for (const m of f.mats) {
        m.transparent = f.a < 1;
        m.opacity = f.a;
        m.depthWrite = f.a >= 1;
      }
    }
  }

  /** Starts turning a land green, spreading out from (x, z). */
  claim(id: number, x: number, z: number, instant = false) {
    const L = this.lands[id];
    if (!L || L.p >= 1 || L.growing) return;
    L.growing = true;
    L.ox = x;
    L.oz = z;
    if (instant) L.p = 0.995;
    for (const o of L.lush) o.visible = true;
  }

  update(dt: number) {
    this.time += dt;
    for (const c of this.clouds) {
      c.o.position.x = c.base.x + Math.sin(this.time * 0.15 + c.phase) * 1.5;
      c.o.position.y = c.base.y + Math.sin(this.time * 0.4 + c.phase) * 0.25;
    }
    for (const L of this.lands) {
      if (!L.growing) continue;
      L.p = Math.min(1, L.p + dt / GROW);
      if (L.p >= 1) L.growing = false;
      this.dirty = true;
      const land = L.land;
      // Radius that reaches the far corner of the land at p = 1.
      const far = Math.max(
        Math.hypot(land.x0 - L.ox, land.z0 - L.oz),
        Math.hypot(land.x1 - L.ox, land.z0 - L.oz),
        Math.hypot(land.x0 - L.ox, land.z1 - L.oz),
        Math.hypot(land.x1 - L.ox, land.z1 - L.oz),
      );
      const R = (L.R = L.p * (far + 2));
      const reach = (x: number, z: number, soft: number) => THREE.MathUtils.clamp((R - Math.hypot(x - L.ox, z - L.oz)) / soft, 0, 1);
      for (const P of L.patches) {
        P.meshes.forEach((im, mi) => {
          P.places.forEach((p, i) => {
            v.setFromMatrixPosition(p);
            const k = reach(v.x, v.z, 2.5);
            const sc = P.wither ? 1 - k : k < 1 ? k * (1 + Math.sin(k * Math.PI) * 0.4) : 1;
            p.decompose(v, q, s);
            m4.compose(v, q, s.multiplyScalar(Math.max(0.001, sc)));
            im.setMatrixAt(i, m4.multiply(P.parts[mi]));
          });
          im.count = P.places.length;
          im.instanceMatrix.needsUpdate = true;
          im.visible = !(P.wither && L.p >= 1);
        });
      }
      for (const o of L.wild) {
        const k = reach(o.position.x, o.position.z, 2);
        o.scale.setScalar(Math.max(0.001, o.userData.s * (1 - k)));
        o.visible = k < 1;
      }
      for (const o of L.lush) {
        const k = reach(o.position.x, o.position.z, 2);
        const pop = k < 1 ? k * (1 + Math.sin(k * Math.PI) * 0.35) : 1;
        o.scale.setScalar(Math.max(0.001, o.userData.s * pop));
      }
    }
    if (this.dirty) this.redraw();
  }

  private redraw() {
    this.dirty = false;
    const g = this.ctx;
    const px = MASK / EXTENT;
    const X = (x: number) => (x + EXTENT / 2) * px;
    g.fillStyle = '#000';
    g.fillRect(0, 0, MASK, MASK);
    g.fillStyle = '#fff';
    for (const L of this.lands) {
      if (L.p <= 0) continue;
      const land = L.land;
      const R = L.p >= 1 ? 999 : L.R;
      g.save();
      g.beginPath();
      // Green reaches just past the fence line so the fence stands on grass.
      g.rect(X(land.x0 - 0.8), X(land.z0 - 0.8), (land.x1 - land.x0 + 1.6) * px, (land.z1 - land.z0 + 1.6) * px);
      g.clip();
      g.beginPath();
      g.arc(X(L.ox), X(L.oz), R * px, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    this.mask.needsUpdate = true;
  }

  dispose(parent: THREE.Object3D) {
    parent.remove(this.root);
    this.mask.dispose();
    for (const o of this.owned) o.dispose();
    this.root.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
  }
}
