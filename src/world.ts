import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_HALF_WIDTH, type KingdomMap, type MapPalette } from './config';
import { Road } from './road';
import { detailize } from './materials';
import { makeLantern } from './models';
import type { Assets } from './assets';

/** Small deterministic RNG so the map looks the same every run. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function groundTexture(pal: MapPalette, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = hex(pal.ground);
  g.fillRect(0, 0, size, size);
  const rng = mulberry32(7);
  // Soft dunes of light and shade.
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 30 + rng() * 90;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = rng() > 0.5 ? pal.groundLight : pal.groundDark;
    grad.addColorStop(0, hex(col) + '55');
    grad.addColorStop(1, hex(col) + '00');
    g.fillStyle = grad;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        g.save();
        g.translate(ox, oy);
        g.fillRect(x - r, y - r, r * 2, r * 2);
        g.restore();
      }
  }
  // Grit.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = hex(rng() > 0.5 ? pal.groundDark : pal.groundLight);
    g.globalAlpha = 0.25 + rng() * 0.3;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Merges every mesh under `group` into one mesh per material (world transforms baked in).
 * Hundreds of trees, rocks and houses become a couple of draw calls.
 */
function bakeStatic(group: THREE.Object3D, tint: [number, number, number]) {
  group.updateMatrixWorld(true);
  const byMat = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const v = new THREE.Vector3();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const src = m.geometry;
    const n = src.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(src.attributes.position, i).applyMatrix4(m.matrixWorld);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      if (src.attributes.normal) {
        v.fromBufferAttribute(src.attributes.normal, i).applyMatrix3(nm).normalize();
        nrm[i * 3] = v.x;
        nrm[i * 3 + 1] = v.y;
        nrm[i * 3 + 2] = v.z;
      }
      if (src.attributes.uv) {
        uv[i * 2] = src.attributes.uv.getX(i);
        uv[i * 2 + 1] = src.attributes.uv.getY(i);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(src.index ? Array.from(src.index.array) : Array.from({ length: n }, (_, i) => i));
    // Bucket by material and by 24-unit map chunk so off-screen chunks get culled.
    const cx = Math.floor((m.matrixWorld.elements[12] + 200) / 24);
    const cz = Math.floor((m.matrixWorld.elements[14] + 200) / 24);
    const key = `${m.material.uuid}|${cx}|${cz}`;
    const entry = byMat.get(key) ?? { mat: m.material, geos: [] };
    entry.geos.push(g);
    byMat.set(key, entry);
  });
  const out = new THREE.Group();
  // Scenery gets the kingdom's tint (autumn, dusk, snow…) on its own copy of each material.
  const tinted = new Map<THREE.Material, THREE.Material>();
  const tintOf = (m: THREE.Material) => {
    if (tint[0] === 1 && tint[1] === 1 && tint[2] === 1) return m;
    let t = tinted.get(m);
    if (!t) {
      t = m.clone();
      (t as THREE.MeshStandardMaterial).color.setRGB(tint[0], tint[1], tint[2]);
      tinted.set(m, t);
    }
    return t;
  };
  for (const { mat: rawMat, geos } of byMat.values()) {
    const mat = tintOf(rawMat);
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

export class World {
  readonly sun: THREE.DirectionalLight;
  roads: Road[] = [];
  private roadMeshes: THREE.Mesh[] = [];
  private ground: THREE.Mesh;
  private decor = new THREE.Group();
  palette: MapPalette | null = null;

  constructor(
    private scene: THREE.Scene,
    shadowSize: number,
  ) {
    scene.fog = new THREE.Fog(0xb8e0f0, 55, 105);
    scene.add(new THREE.HemisphereLight(0xc9dcff, 0x8a6a6a, 0.8));
    const sun = new THREE.DirectionalLight(0xffd29a, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = sun.shadow.camera;
    s.left = s.bottom = -42;
    s.right = s.top = 42;
    s.near = 1;
    s.far = 110;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      detailize(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), 0.45, 0.9),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground, this.decor);
  }

  /** Switches to a kingdom: its roads, ground colours and sky. Call decorate() afterwards. */
  setMap(map: KingdomMap) {
    const pal = map.palette;
    this.palette = pal;
    this.scene.background = new THREE.Color(pal.sky);
    (this.scene.fog as THREE.Fog).color.set(pal.fog);
    const mat = this.ground.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    const tex = groundTexture(pal);
    tex.repeat.set(14, 14);
    mat.map = tex;
    mat.needsUpdate = true;
    for (const m of this.roadMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.roads = map.roads.map((pts) => new Road(pts));
    this.roadMeshes = this.roads.map((r) => {
      const m = r.makeMesh(pal.road, pal.roadEdge);
      this.scene.add(m);
      return m;
    });
    // The east road is hidden until it opens.
    this.roadMeshes[1].visible = false;
    // Clear the previous kingdom's scenery.
    for (const c of [...this.decor.children]) {
      this.decor.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }

  openRoad(i: number, on: boolean) {
    this.roadMeshes[i].visible = on;
  }

  /** Scatter KayKit scenery, keeping clear of roads and of the given reserved spots. */
  decorate(reserved: { x: number; z: number; r: number }[], assets: Assets) {
    const target = this.decor;
    const pal = this.palette!;
    const rng = mulberry32(2024);
    // Everything static goes into a staging group, then gets merged into a few big meshes.
    const scene = new THREE.Group();
    const clear = (x: number, z: number, pad: number) => {
      if (Math.hypot(x, z) < 8 + pad) return false;
      for (const r of this.roads) if (r.distanceTo(x, z) < ROAD_HALF_WIDTH + 1.4 + pad) return false;
      for (const q of reserved) if (Math.hypot(x - q.x, z - q.z) < q.r + pad) return false;
      return true;
    };
    const add = (name: string, size: number, x: number, z: number, axis: 'y' | 'max' = 'y') => {
      const o = assets.prop(name, size, axis);
      o.position.set(x, 0, z);
      o.rotation.y = rng() * Math.PI * 2;
      scene.add(o);
      return o;
    };
    const scatter = (names: string[], n: number, rMin: number, rMax: number, pad: number, size: () => number, axis: 'y' | 'max' = 'y') => {
      for (let i = 0; i < n; i++) {
        for (let tries = 0; tries < 30; tries++) {
          const a = rng() * Math.PI * 2;
          const r = rMin + rng() * (rMax - rMin);
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r - 12;
          const sz = size();
          // Big things need clearance proportional to their size.
          if (!clear(x, z, Math.max(pad, axis === 'max' ? sz * 0.5 : pad))) continue;
          add(names[Math.floor(rng() * names.length)], sz, x, z, axis);
          break;
        }
      }
    };

    // A ring of forested mountains frames the battlefield.
    scatter(['mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass_trees'], 40, 62, 92, 6, () => 9 + rng() * 6, 'max');
    // Forest clumps and lone trees.
    scatter(['trees_A_large', 'trees_B_large', 'trees_A_medium', 'trees_B_medium'], 70, 10, 55, 2.4, () => 2.6 + rng() * 2.2);
    scatter(['trees_A_small', 'trees_B_small', 'tree_single_A', 'tree_single_B'], 60, 9, 50, 1.4, () => 1.6 + rng() * 1.6);
    scatter(['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'], 45, 8, 50, 0.8, () => 0.5 + rng() * 0.9, 'max');

    // A little village around the castle.
    const village: [string, number, number, number][] = [
      ['building_home_A_blue', -15, 11, 3.6],
      ['building_home_B_blue', -13.5, 17.5, 3.6],
      ['building_windmill_blue', -20, 6, 6],
      ['building_tavern_blue', 15, 16, 4.2],
      ['building_well_blue', 4.5, 16.5, 2.6],
      ['building_market_blue', -7, 18, 4],
      ['building_church_blue', 21, 10, 5.6],
      ['building_home_A_blue', 8.5, 21, 3.6],
      ['building_home_B_blue', -2, 22, 3.6],
      ['tent', -17.5, -9, 2.2],
    ];
    for (const [name, x, z, size] of village) {
      if (!clear(x, z, 1.6)) continue;
      const o = add(name, size, x, z, 'max');
      o.rotation.y = Math.atan2(-x, -z) + Math.PI; // face the castle
      reserved.push({ x, z, r: 3 });
    }
    const props = ['barrel', 'crate_A_big', 'crate_B_big', 'sack', 'wheelbarrow', 'resource_lumber', 'crate_long_A'];
    scatter(props, 26, 8, 24, 0.8, () => 0.8 + rng() * 0.5);

    target.add(bakeStatic(scene, pal.decorTint));
    this.scatterGround(target, rng, clear, pal);

    // Lanterns along the last stretch of each road.
    for (const road of this.roads) {
      for (const t of [0.93, 0.83]) {
        const v = road.point(road.length * t, ROAD_HALF_WIDTH + 0.7, new THREE.Vector3());
        const l = makeLantern();
        l.position.copy(v);
        target.add(l);
      }
    }
  }

  /** Thousands of grass tufts, flowers and pebbles as instanced meshes: texture for almost free. */
  private scatterGround(scene: THREE.Object3D, rng: () => number, clear: (x: number, z: number, pad: number) => boolean, pal: MapPalette) {
    const tuftParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.ConeGeometry(0.05, 0.55, 3);
      blade.translate(0, 0.27, 0);
      blade.rotateZ((i - 2.5) * 0.25);
      blade.rotateY(i * 1.1);
      tuftParts.push(blade.toNonIndexed());
      blade.dispose();
    }
    const tuftGeo = mergeGeometries(tuftParts)!;
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 2600);
    const flowerGeo = new THREE.IcosahedronGeometry(0.09, 0);
    flowerGeo.translate(0, 0.3, 0);
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), 900);
    const pebbleGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const pebbles = new THREE.InstancedMesh(pebbleGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), 700);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const tuftCols = pal.tufts;
    const flowerCols = pal.flowers;
    const pebbleCols = [0xa9a49a, 0x8f8a82, 0xc2bdb2];
    let ti = 0;
    let fi = 0;
    let pi = 0;
    for (let k = 0; k < 14000 && (ti < 2600 || fi < 900 || pi < 700); k++) {
      const x = (rng() - 0.5) * 130;
      const z = (rng() - 0.5) * 120 - 12;
      const roadside = !clear(x, z, -1.5);
      if (Math.hypot(x, z) < 5) continue;
      const roll = rng();
      if (roadside) {
        // The road gets pebbles only.
        if (pi < 700 && roll < 0.3) {
          const s = 0.5 + rng() * 1.2;
          q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
          m.compose(new THREE.Vector3(x, 0.03, z), q, new THREE.Vector3(s, s * 0.6, s));
          pebbles.setMatrixAt(pi, m);
          pebbles.setColorAt(pi++, c.set(pebbleCols[Math.floor(rng() * pebbleCols.length)]));
        }
        continue;
      }
      if (roll < 0.72 && ti < 2600) {
        const s = 0.6 + rng() * 0.9;
        q.setFromEuler(e.set(0, rng() * 6, 0));
        m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
        tufts.setMatrixAt(ti, m);
        tufts.setColorAt(ti++, c.set(tuftCols[Math.floor(rng() * tuftCols.length)]));
      } else if (fi < 900) {
        // Flowers grow in little patches.
        const col = flowerCols[Math.floor(rng() * flowerCols.length)];
        for (let j = 0; j < 4 && fi < 900; j++) {
          const s = 0.8 + rng() * 0.6;
          m.compose(new THREE.Vector3(x + (rng() - 0.5) * 0.9, 0, z + (rng() - 0.5) * 0.9), q.identity(), new THREE.Vector3(s, s, s));
          flowers.setMatrixAt(fi, m);
          flowers.setColorAt(fi++, c.set(col));
        }
      }
    }
    tufts.count = ti;
    flowers.count = fi;
    pebbles.count = pi;
    pebbles.receiveShadow = true;
    scene.add(tufts, flowers, pebbles);
  }

  update(focus: THREE.Vector3) {
    // Shadow frustum follows the camera focus so shadows stay crisp.
    this.sun.position.set(focus.x + 12, 26, focus.z + 6);
    this.sun.target.position.copy(focus);
  }
}
