import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KingdomMap, MapPalette } from './config';
import { Road } from './road';
import { detailize } from './materials';

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

export function groundTexture(pal: MapPalette, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = hex(pal.ground);
  g.fillRect(0, 0, size, size);
  const rng = mulberry32(7);
  // Broad, soft patches of light and shade: a clean painted look, no grit.
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 60 + rng() * 120;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = rng() > 0.5 ? pal.groundLight : pal.groundDark;
    grad.addColorStop(0, hex(col) + '40');
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
export function bakeStatic(group: THREE.Object3D, tint: [number, number, number]) {
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
    scene.fog = new THREE.Fog(0xb8e0f0, 62, 135);
    // Bright, soft daylight: lots of sky fill so shadows stay gentle and colours stay clean.
    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x3d5a46, 0.7));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
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
      detailize(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), 0.12, 0.6),
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
    // Clear the previous kingdom's scenery.
    for (const c of [...this.decor.children]) {
      this.decor.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }

  openRoad(i: number, on: boolean) {
    if (this.roadMeshes[i]) this.roadMeshes[i].visible = on;
  }

  update(focus: THREE.Vector3) {
    // Shadow frustum follows the camera focus so shadows stay crisp.
    this.sun.position.set(focus.x + 12, 26, focus.z + 6);
    this.sun.target.position.copy(focus);
  }
}
