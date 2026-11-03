import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from './config';
import { detailize, standard } from './materials';

// Procedural low-poly models in a warm frontier style. Static buildings are merged into one
// vertex-coloured mesh each, and the enemy horde is drawn with instancing, so a screen full of
// goblins stays cheap on phones.

const lambert = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => standard(color, extra);

export const MAT = {
  vc: detailize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), 0.34),
  vcFlat: detailize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true }), 0.4),
  /** The horde: slightly glossy skin so rim light catches on hundreds of goblins. */
  crowd: detailize(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }), 0.22),
  steel: lambert(COLORS.steel, { metalness: 0.75, roughness: 0.35 }),
  steelDark: lambert(COLORS.steelDark, { metalness: 0.6, roughness: 0.45 }),
  team: lambert(COLORS.team, { roughness: 0.7 }),
  plume: lambert(COLORS.plume),
  skin: lambert(COLORS.skin, { roughness: 0.7 }),
  coin: new THREE.MeshStandardMaterial({
    color: COLORS.coin,
    metalness: 1,
    roughness: 0.28,
    emissive: 0xffa800,
    emissiveIntensity: 0.9,
  }),
  wood: lambert(COLORS.wood),
  woodDark: lambert(COLORS.woodDark),
  arrow: new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
  bolt: new THREE.MeshBasicMaterial({ color: 0xfff0b0 }),
  fire: new THREE.MeshStandardMaterial({ color: COLORS.fire, emissive: COLORS.fire, emissiveIntensity: 5 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.35 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x3a1d05, transparent: true, opacity: 0.26, depthWrite: false }),
  arrowModel: new THREE.MeshStandardMaterial({ color: 0xd9b27a, roughness: 0.6 }),
  /** HDR colour so the bolts bloom. */
  magic: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.6, 1.0) }),
  glowRing: new THREE.MeshBasicMaterial({
    color: 0xffd86b,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
};

function swordGeometry() {
  const k = new Kit();
  k.add(new THREE.BoxGeometry(0.08, 0.62, 0.03), 0xf2f4f8, 0, 0.42, 0);
  k.add(new THREE.BoxGeometry(0.26, 0.05, 0.06), 0xd8c49a, 0, 0.1, 0);
  k.add(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 5), 0x8a5a33, 0, -0.02, 0);
  return k.geometry();
}

function bowGeometry() {
  const k = new Kit();
  k.add(new THREE.TorusGeometry(0.34, 0.035, 4, 12, Math.PI), 0xffffff, 0, 0, 0, 0, 0, -Math.PI / 2);
  k.add(new THREE.CylinderGeometry(0.008, 0.008, 0.68, 3), 0xf5efe0, 0, 0, 0);
  return k.geometry();
}

/** Collects coloured primitives and merges them into a single geometry. */
export class Kit {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(
    geo: THREE.BufferGeometry,
    color: number,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this.m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }

  geometry() {
    const g = mergeGeometries(this.parts)!;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return g;
  }

  mesh(flat = false, cast = true) {
    const m = new THREE.Mesh(this.geometry(), flat ? MAT.vcFlat : MAT.vc);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }
}

/** Shared geometries (some are swapped for KayKit models once assets load). */
const asGeo = <T extends Record<string, THREE.BufferGeometry>>(o: T) => o as { [K in keyof T]: THREE.BufferGeometry };
export const GEO = asGeo({
  coin: new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12),
  arrow: new THREE.CylinderGeometry(0.035, 0.035, 0.75, 4).rotateX(Math.PI / 2),
  bolt: new THREE.CylinderGeometry(0.08, 0.08, 1.4, 5).rotateX(Math.PI / 2),
  particle: new THREE.BoxGeometry(0.16, 0.16, 0.16),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  lowSphere: new THREE.SphereGeometry(1, 9, 7),
  box: new THREE.BoxGeometry(1, 1, 1),
  blobShadow: new THREE.CircleGeometry(1, 20),
  dot: new THREE.CircleGeometry(0.12, 10),
  ring: new THREE.RingGeometry(0.85, 1, 32),
  orb: new THREE.IcosahedronGeometry(0.2, 2),
  sword: swordGeometry(),
  bow: bowGeometry(),
});

export function blobShadow(radius: number) {
  const s = new THREE.Mesh(GEO.blobShadow, MAT.shadow);
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.025;
  s.scale.setScalar(radius);
  s.renderOrder = 1;
  return s;
}

// ---------------------------------------------------------------- Scenery
