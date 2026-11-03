import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Assets } from './assets';
import type { MapPalette } from './config';
import { detailize } from './materials';
import { makeMesa } from './models';
import { BOUNDS, LANDS, SPOTS, type Land } from './realm';
import { bakeStatic, groundTexture, mulberry32 } from './world';

// Claimed land turns green: a grass layer masked by a small canvas that grows outward from where
// the last fence went up, with tufts and flowers sprouting as it passes. Unclaimed land is a
// wasteland of dead trees and rocks, ringed by canyon mesas and drifting fog.

const EXTENT = 136; // world units covered by the mask
const MASK = 272; // mask pixels (2 per unit: soft edges after linear filtering)
const GROW = 1.6; // seconds for green to cover a land

const GRASS: MapPalette = {
  ground: 0x6fb446,
  groundDark: 0x579a35,
  groundLight: 0x8ccc55,
  tufts: [],
  flowers: [],
  decorTint: [1, 1, 1],
  sky: 0,
  fog: 0,
  road: 0,
  roadEdge: 0,
};

interface LandFx {
  land: Land;
  /** 0 = wild, 1 = fully green. */
  p: number;
  /** Radius of the green circle. */
  R: number;
  growing: boolean;
  ox: number;
  oz: number;
  tufts: THREE.InstancedMesh;
  tuftBase: THREE.Matrix4[];
  flowers: THREE.InstancedMesh;
  flowerBase: THREE.Matrix4[];
  wild: THREE.Object3D[];
  lush: THREE.Object3D[];
}

const m4 = new THREE.Matrix4();
const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const e = new THREE.Euler();
const col = new THREE.Color();

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
  private rockify: (o: THREE.Object3D) => THREE.Object3D = (o) => o;

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
      0.4,
      0.9,
    );
    this.grass = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT, EXTENT), mat);
    this.grass.rotation.x = -Math.PI / 2;
    this.grass.position.y = 0.025;
    this.grass.receiveShadow = true;
    this.grass.renderOrder = 1;
    this.root.add(this.grass);

    const rng = mulberry32(99);
    // Wild props take the kingdom's tint; rocks get warmed toward canyon red-brown.
    const tints = new Map<string, THREE.Material>();
    const tint = (o: THREE.Object3D, rgb: [number, number, number]) => {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const key = `${src.uuid}|${rgb.join(',')}`;
        let t = tints.get(key);
        if (!t) {
          const mm = src.clone();
          if (rgb === rockTint) {
            // Canyon rock: drop the grey atlas for a flat sandstone colour.
            mm.map = null;
            mm.color.set(0xb47a52).multiply(new THREE.Color(dt[0], dt[1], dt[2]));
            mm.flatShading = true;
          } else mm.color.setRGB(rgb[0], rgb[1], rgb[2]);
          t = mm;
          tints.set(key, t);
        }
        m.material = t;
      });
      return o;
    };
    const dt = pal.decorTint;
    const rockTint: [number, number, number] = [1.35 * dt[0], 1.0 * dt[1], 0.78 * dt[2]];
    this.rockify = (o) => tint(o, rockTint);
    const clear = (x: number, z: number, pad: number) => {
      for (const c of keepClear) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return false;
      for (const sp of SPOTS) if (Math.hypot(x - sp.x, z - sp.z) < 3.4 + pad) return false;
      if (Math.hypot(x, z) < 6 + pad) return false;
      return true;
    };
    // Close to a fence line? Keep fences free of trees.
    const nearFence = (x: number, z: number) => {
      const fx = Math.abs(((x + 10) % 20 + 20) % 20 - 10);
      const fz = Math.abs(((z + 10) % 20 + 20) % 20 - 10);
      return 10 - fx < 1.8 || 10 - fz < 1.8;
    };

    // Tuft and flower geometry, shared by every land.
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.ConeGeometry(0.05, 0.55, 3);
      blade.translate(0, 0.27, 0);
      blade.rotateZ((i - 2.5) * 0.25);
      blade.rotateY(i * 1.1);
      parts.push(blade.toNonIndexed());
      blade.dispose();
    }
    const tuftGeo = mergeGeometries(parts)!;
    const flowerGeo = new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.3, 0);
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const tuftCols = [0x5f9c3a, 0x76b545, 0x8fcb52, 0x4f8a30];
    const flowerCols = [0xffffff, 0xffe066, 0xff8fb1, 0xb69cff, 0xff6b5b];

    for (const land of LANDS) {
      const nT = 300;
      const nF = 90;
      const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, nT);
      const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, nF);
      const tuftBase: THREE.Matrix4[] = [];
      const flowerBase: THREE.Matrix4[] = [];
      for (let i = 0; i < nT; i++) {
        const x = land.x0 + 0.6 + rng() * 18.8;
        const z = land.z0 + 0.6 + rng() * 18.8;
        const sc = 0.6 + rng() * 0.9;
        tuftBase.push(new THREE.Matrix4().compose(v.set(x, 0, z), q.setFromEuler(e.set(0, rng() * 6, 0)), s.set(sc, sc, sc)));
        tufts.setColorAt(i, col.set(tuftCols[Math.floor(rng() * tuftCols.length)]));
      }
      for (let i = 0; i < nF; i++) {
        const x = land.x0 + 1 + rng() * 18;
        const z = land.z0 + 1 + rng() * 18;
        const sc = 0.8 + rng() * 0.6;
        flowerBase.push(new THREE.Matrix4().compose(v.set(x, 0, z), q.identity(), s.set(sc, sc, sc)));
        flowers.setColorAt(i, col.set(flowerCols[Math.floor((i / 4) % flowerCols.length)]));
      }
      for (const im of [tufts, flowers]) {
        im.count = 0;
        im.frustumCulled = false;
        this.root.add(im);
      }
      // Wild things that wither away, and lush things that sprout, when the land is claimed.
      const wild: THREE.Object3D[] = [];
      const lush: THREE.Object3D[] = [];
      for (let i = 0; i < 9; i++) {
        for (let tries = 0; tries < 20; tries++) {
          const x = land.x0 + 1.5 + rng() * 17;
          const z = land.z0 + 1.5 + rng() * 17;
          if (!clear(x, z, 0.5) || nearFence(x, z)) continue;
          const r = rng();
          const o =
            r < 0.45
              ? assets.prop(['Tree_Bare_1_A_Color7', 'Tree_Bare_1_B_Color7', 'Tree_Bare_2_A_Color7'][Math.floor(rng() * 3)], 2.2 + rng() * 1.6)
              : assets.prop(['Rock_1_A_Color4', 'Rock_3_A_Color4', 'Rock_3_C_Color4', 'Rock_6_A_Color4'][Math.floor(rng() * 4)], 0.6 + rng() * 0.9, 'max');
          tint(o, r < 0.45 ? dt : rockTint);
          o.position.set(x, 0, z);
          o.rotation.y = rng() * 6.28;
          o.userData.s = o.scale.x;
          this.root.add(o);
          wild.push(o);
          break;
        }
      }
      for (let i = 0; i < 8; i++) {
        for (let tries = 0; tries < 20; tries++) {
          const x = land.x0 + 1.5 + rng() * 17;
          const z = land.z0 + 1.5 + rng() * 17;
          if (!clear(x, z, 1) || nearFence(x, z)) continue;
          const r = rng();
          const o =
            r < 0.4
              ? assets.prop(['trees_A_medium', 'trees_B_medium', 'tree_single_A', 'tree_single_B'][Math.floor(rng() * 4)], 2 + rng() * 1.6)
              : r < 0.55
                ? assets.prop('Tree_4_A_Color1', 2.6 + rng())
                : assets.prop('Bush_1_A_Color1', 0.8 + rng() * 0.5, 'max');
          o.position.set(x, 0, z);
          o.rotation.y = rng() * 6.28;
          o.userData.s = o.scale.x;
          o.scale.setScalar(0.001);
          o.visible = false;
          this.root.add(o);
          lush.push(o);
          break;
        }
      }
      this.lands.push({ land, p: 0, R: 0, growing: false, ox: 0, oz: 0, tufts, tuftBase, flowers, flowerBase, wild, lush });
    }

    this.outskirts(pal, rng);
    this.redraw();
  }

  /** Canyon mesas, dead trees and a wall of fog around the edge of the realm. */
  private outskirts(pal: MapPalette, rng: () => number) {
    const stage = new THREE.Group();
    const inLand = (x: number, z: number) => Math.abs(x) < 31.5 && Math.abs(z) < 31.5;
    for (let i = 0; i < 70; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const x = (rng() - 0.5) * 140;
        const z = (rng() - 0.5) * 140;
        const d = Math.max(Math.abs(x), Math.abs(z));
        if (d < 44) continue;
        const mesa = makeMesa(rng);
        mesa.scale.setScalar(1.3 + rng() * 0.9);
        mesa.position.set(x, 0, z);
        stage.add(mesa);
        break;
      }
    }
    const scatter = (names: string[], n: number, size: () => number, axis: 'y' | 'max', minD: number, maxD: number) => {
      for (let i = 0; i < n; i++) {
        for (let tries = 0; tries < 20; tries++) {
          const x = (rng() - 0.5) * maxD * 2;
          const z = (rng() - 0.5) * maxD * 2;
          const d = Math.max(Math.abs(x), Math.abs(z));
          if (d < minD || inLand(x, z)) continue;
          const o = this.assets.prop(names[Math.floor(rng() * names.length)], size(), axis);
          o.position.set(x, 0, z);
          o.rotation.y = rng() * 6.28;
          stage.add(o);
          break;
        }
      }
    };
    scatter(['Tree_Bare_1_A_Color7', 'Tree_Bare_1_B_Color7', 'Tree_Bare_2_A_Color7'], 70, () => 2 + rng() * 2, 'y', 31, 52);
    const before = stage.children.length;
    scatter(['Rock_1_A_Color4', 'Rock_3_A_Color4', 'Rock_3_C_Color4', 'Rock_6_A_Color4'], 60, () => 0.6 + rng() * 1.6, 'max', 31, 52);
    for (const o of stage.children.slice(before)) this.rockify(o);
    scatter(['mountain_A', 'mountain_B'], 10, () => 7 + rng() * 5, 'max', 46, 60);
    this.root.add(bakeStatic(stage, pal.decorTint));

    // Fog banks: big soft clouds sitting on the ground beyond the edge of the realm.
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, emissive: 0xffffff, emissiveIntensity: 0.35 });
    for (let i = 0; i < 46; i++) {
      const side = i % 4;
      const t = (rng() - 0.5) * 2 * (BOUNDS + 16);
      const out = BOUNDS + 9 + rng() * 6;
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? out : -out;
      const z = side === 0 ? out : side === 1 ? -out : t;
      const c = this.assets.prop(rng() > 0.5 ? 'cloud_big' : 'cloud_small', 9 + rng() * 7, 'max');
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

  isGreen(id: number) {
    return (this.lands[id]?.p ?? 0) > 0.5;
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
      const grow = (base: THREE.Matrix4[], im: THREE.InstancedMesh) => {
        let n = 0;
        base.forEach((b, i) => {
          v.setFromMatrixPosition(b);
          const k = THREE.MathUtils.clamp((R - Math.hypot(v.x - L.ox, v.z - L.oz)) / 2.5, 0, 1);
          const pop = k < 1 ? k * (1 + Math.sin(k * Math.PI) * 0.4) : 1;
          b.decompose(v, q, s);
          m4.compose(v, q, s.multiplyScalar(Math.max(0.001, pop)));
          im.setMatrixAt(i, m4);
          n = i + 1;
        });
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      };
      grow(L.tuftBase, L.tufts);
      grow(L.flowerBase, L.flowers);
      for (const o of L.wild) {
        const k = THREE.MathUtils.clamp((R - Math.hypot(o.position.x - L.ox, o.position.z - L.oz)) / 2, 0, 1);
        o.scale.setScalar(Math.max(0.001, o.userData.s * (1 - k)));
        o.visible = k < 1;
      }
      for (const o of L.lush) {
        const k = THREE.MathUtils.clamp((R - Math.hypot(o.position.x - L.ox, o.position.z - L.oz)) / 2, 0, 1);
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
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.geometry as THREE.BufferGeometry & { shared?: boolean }).shared) {
        // Props share geometry with the asset library; only dispose what we made ourselves.
        if (m === this.grass || (o as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose();
      }
    });
  }
}
