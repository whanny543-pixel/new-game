import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from './config';

// Procedural low-poly models in a warm frontier style. Static buildings are merged into one
// vertex-coloured mesh each, and the enemy horde is drawn with instancing, so a screen full of
// goblins stays cheap on phones.

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

export const MAT = {
  vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
  vcFlat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  steel: lambert(COLORS.steel),
  steelDark: lambert(COLORS.steelDark),
  team: lambert(COLORS.team),
  plume: lambert(COLORS.plume),
  skin: lambert(COLORS.skin),
  coin: lambert(COLORS.coin, { emissive: COLORS.coinDeep, emissiveIntensity: 0.35 }),
  wood: lambert(COLORS.wood),
  woodDark: lambert(COLORS.woodDark),
  arrow: new THREE.MeshBasicMaterial({ color: COLORS.arrow }),
  bolt: new THREE.MeshBasicMaterial({ color: 0xfff0b0 }),
  fire: lambert(COLORS.fire, { emissive: COLORS.fire, emissiveIntensity: 1 }),
  white: lambert(0xffffff),
  shadow: new THREE.MeshBasicMaterial({ color: 0x3a1d05, transparent: true, opacity: 0.22, depthWrite: false }),
  ring: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
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

export const GEO = {
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
  sword: swordGeometry(),
  bow: bowGeometry(),
};

/** A gabled roof sitting on eaves at height `y`: width across (z), ridge length along x, then yawed. */
function gable(k: Kit, w: number, h: number, d: number, color: number, x: number, y: number, z: number, ry = 0) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 3);
  g.scale(w / 1.732, d, h / 1.5);
  g.rotateZ(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  g.rotateY(ry);
  k.add(g, color, x, y + (0.5 * h) / 1.5, z);
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  return m;
}

export function blobShadow(radius: number) {
  const s = new THREE.Mesh(GEO.blobShadow, MAT.shadow);
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.025;
  s.scale.setScalar(radius);
  s.renderOrder = 1;
  return s;
}

// ---------------------------------------------------------------- Hero

export interface HeroRig {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  muzzle: THREE.Object3D;
  backAnchor: THREE.Group;
  frontAnchor: THREE.Group;
}

export function makeHero(): HeroRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const k = new Kit();
  k.add(new THREE.CapsuleGeometry(0.36, 0.42, 4, 12), COLORS.steel, 0, 0.84, 0);
  k.add(new THREE.CylinderGeometry(0.39, 0.45, 0.58, 12), COLORS.team, 0, 0.78, 0);
  k.box(0.84, 0.09, 0.09, COLORS.woodDark, 0, 1.02, 0);
  k.add(new THREE.CylinderGeometry(0.31, 0.33, 0.46, 12), COLORS.steel, 0, 1.52, 0);
  k.add(new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.steel, 0, 1.75, 0);
  k.box(0.42, 0.05, 0.05, 0x2a1d14, 0, 1.54, 0.3);
  k.add(new THREE.SphereGeometry(1, 8, 6), COLORS.plume, 0, 2.08, -0.05, 0, 0, 0, 0.09, 0.24, 0.34);
  k.add(new THREE.CapsuleGeometry(0.24, 0.5, 2, 8), COLORS.plume, 0, 1.0, -0.33, 0.25, 0, 0, 1.2, 1, 0.35); // cape
  k.add(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), COLORS.team, -0.44, 0.86, 0.05, 0, 0, Math.PI / 2);
  k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 8), COLORS.coin, -0.48, 0.86, 0.05, 0, 0, Math.PI / 2);
  // Crossbow
  k.box(0.1, 0.1, 0.62, COLORS.wood, 0.42, 0.95, 0.25);
  k.add(new THREE.TorusGeometry(0.3, 0.03, 4, 12, Math.PI), COLORS.woodDark, 0.42, 0.95, 0.43, -Math.PI / 2, 0, 0);
  body.add(k.mesh());

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.42, 0.95, 0.6);
  body.add(muzzle);

  const legGeo = new THREE.CapsuleGeometry(0.12, 0.22, 2, 8);
  const legL = mesh(legGeo, MAT.steelDark);
  legL.position.set(-0.17, 0.24, 0);
  const legR = mesh(legGeo, MAT.steelDark);
  legR.position.set(0.17, 0.24, 0);
  root.add(legL, legR);

  const backAnchor = new THREE.Group();
  backAnchor.position.set(0, 1.25, -0.62);
  body.add(backAnchor);
  const frontAnchor = new THREE.Group();
  frontAnchor.position.set(0, 1.25, 0.55);
  body.add(frontAnchor);

  root.add(blobShadow(0.6));
  return { root, body, legL, legR, muzzle, backAnchor, frontAnchor };
}

// ---------------------------------------------------------------- Defenders

export interface UnitRig {
  root: THREE.Group;
  body: THREE.Group;
  weapon: THREE.Mesh;
  weaponMat: THREE.MeshLambertMaterial;
  muzzle: THREE.Object3D;
}

export function makeArcher(): UnitRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = new Kit();
  k.add(new THREE.CapsuleGeometry(0.24, 0.32, 4, 8), COLORS.team, 0, 0.52, 0);
  k.add(new THREE.CylinderGeometry(0.27, 0.3, 0.3, 10), 0x5e8f3a, 0, 0.42, 0);
  k.add(new THREE.SphereGeometry(0.21, 10, 8), COLORS.skin, 0, 1.0, 0);
  k.add(new THREE.ConeGeometry(0.25, 0.42, 8), 0x5e8f3a, 0, 1.2, -0.03, -0.2);
  k.box(0.14, 0.4, 0.14, COLORS.woodDark, 0.12, 0.75, -0.25, 0, 0.3); // quiver
  body.add(k.mesh());
  const weaponMat = lambert(0xffffff);
  const weapon = mesh(GEO.bow, weaponMat, false);
  weapon.position.set(0.28, 0.66, 0.22);
  weapon.rotation.y = Math.PI / 2;
  body.add(weapon);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.28, 0.66, 0.4);
  body.add(muzzle);
  root.add(blobShadow(0.32));
  return { root, body, weapon, weaponMat, muzzle };
}

export function makeKnight(): UnitRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = new Kit();
  k.add(new THREE.CapsuleGeometry(0.28, 0.3, 4, 8), COLORS.steel, 0, 0.55, 0);
  k.add(new THREE.CylinderGeometry(0.31, 0.35, 0.36, 10), COLORS.team, 0, 0.48, 0);
  k.add(new THREE.CylinderGeometry(0.22, 0.23, 0.32, 10), COLORS.steel, 0, 1.02, 0);
  k.add(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.steel, 0, 1.18, 0);
  k.box(0.3, 0.04, 0.04, 0x2a1d14, 0, 1.03, 0.22);
  k.add(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 10), COLORS.team, -0.36, 0.6, 0.12, 0, 0.3, Math.PI / 2);
  k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 8), COLORS.coin, -0.39, 0.6, 0.13, 0, 0.3, Math.PI / 2);
  body.add(k.mesh());
  const weaponMat = lambert(0xffffff);
  const weapon = mesh(GEO.sword, weaponMat, false);
  weapon.position.set(0.34, 0.55, 0.15);
  weapon.rotation.x = 0.9;
  body.add(weapon);
  const muzzle = new THREE.Object3D();
  body.add(muzzle);
  root.add(blobShadow(0.36));
  return { root, body, weapon, weaponMat, muzzle };
}

// ---------------------------------------------------------------- Enemy horde (instanced)

/** Merged, vertex-coloured enemy bodies. Each kind is one InstancedMesh. Faces +z. */
export function enemyGeometry(kind: 'goblin' | 'runner' | 'troll') {
  const k = new Kit();
  if (kind === 'troll') {
    const s = COLORS.troll;
    k.add(new THREE.SphereGeometry(1, 12, 9), s, 0, 1.15, 0, 0, 0, 0, 1.0, 1.0, 0.85);
    k.add(new THREE.SphereGeometry(1, 10, 8), s, 0, 2.15, 0.25, 0, 0, 0, 0.5, 0.5, 0.5);
    for (const side of [-1, 1]) {
      k.add(new THREE.SphereGeometry(1, 6, 5), 0xff2a2a, side * 0.18, 2.25, 0.7, 0, 0, 0, 0.08, 0.08, 0.08);
      k.add(new THREE.ConeGeometry(0.07, 0.3, 5), 0xfff6dc, side * 0.2, 1.95, 0.7);
      k.add(new THREE.SphereGeometry(1, 8, 6), s, side * 1.05, 1.0, 0.1, 0, 0, 0, 0.28, 0.6, 0.28);
      k.add(new THREE.SphereGeometry(1, 8, 6), s, side * 0.45, 0.3, 0, 0, 0, 0, 0.3, 0.4, 0.3);
    }
    k.add(new THREE.CylinderGeometry(0.22, 0.1, 1.6, 6), COLORS.woodDark, 1.15, 1.0, 0.6, 1.0);
    k.box(1.5, 0.32, 1.2, COLORS.rag, 0, 0.75, 0);
    return k.geometry();
  }
  const small = kind === 'runner';
  const sc = small ? 0.82 : 1;
  const skin = COLORS.goblin;
  k.add(new THREE.CapsuleGeometry(0.26 * sc, 0.26 * sc, 3, 8), small ? COLORS.runner : COLORS.rag, 0, 0.5 * sc, 0);
  k.add(new THREE.SphereGeometry(0.31 * sc, 10, 8), skin, 0, 1.0 * sc, 0.02);
  for (const side of [-1, 1]) {
    k.add(new THREE.ConeGeometry(0.08 * sc, 0.38 * sc, 4), skin, side * 0.4 * sc, 1.05 * sc, 0, 0, 0, side * -1.3);
    k.add(new THREE.SphereGeometry(0.05 * sc, 6, 5), 0xffe14a, side * 0.11 * sc, 1.05 * sc, 0.27 * sc);
    k.add(new THREE.CapsuleGeometry(0.07 * sc, 0.25 * sc, 2, 5), skin, side * 0.3 * sc, 0.55 * sc, 0.05);
  }
  k.add(new THREE.ConeGeometry(0.05, 0.12, 4), skin, 0, 0.98 * sc, 0.33 * sc, Math.PI / 2);
  if (small) {
    k.add(new THREE.ConeGeometry(0.31, 0.5, 8), COLORS.runner, 0, 1.25, -0.03, -0.25);
  } else {
    k.add(new THREE.CylinderGeometry(0.09, 0.05, 0.62, 5), COLORS.woodDark, 0.34, 0.65, 0.22, 0.8);
    k.add(new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), 0xc8402a, 0, 1.12, 0.0);
    k.add(new THREE.ConeGeometry(0.06, 0.3, 5), 0xf0e2c4, 0, 1.5, 0.0);
  }
  return k.geometry();
}

// ---------------------------------------------------------------- Structures

export interface TowerRig {
  root: THREE.Group;
  roof: THREE.Mesh;
  ballista: THREE.Group;
  /** Local positions on the platform where archers stand. */
  slots: THREE.Vector3[];
}

/** Wooden stilt watchtower. Level 2 adds a roof, level 3 a ballista. */
export function makeTower(): TowerRig {
  const root = new THREE.Group();
  const k = new Kit();
  const H = 2.4;
  for (const [x, z] of [
    [-0.85, -0.85],
    [0.85, -0.85],
    [-0.85, 0.85],
    [0.85, 0.85],
  ]) {
    k.box(0.22, H, 0.22, COLORS.woodDark, x * 0.92, H / 2, z * 0.92, 0, -z * 0.06, x * 0.06);
    k.add(new THREE.CylinderGeometry(0.2, 0.26, 0.25, 6), COLORS.stoneDark, x, 0.12, z);
  }
  // Cross braces
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const c = Math.cos(r);
    const s = Math.sin(r);
    k.box(0.1, 2.1, 0.1, COLORS.wood, s * 0.82, 1.15, c * 0.82, r, 0, 0.72);
  }
  k.box(2.3, 0.22, 2.3, COLORS.wood, 0, H + 0.1, 0);
  for (let i = 0; i < 5; i++) k.box(2.32, 0.03, 0.06, COLORS.woodDark, 0, H + 0.22, -0.9 + i * 0.45);
  // Railing
  for (const [x, z] of [
    [-1.05, -1.05],
    [1.05, -1.05],
    [-1.05, 1.05],
    [1.05, 1.05],
  ])
    k.box(0.12, 0.65, 0.12, COLORS.woodDark, x, H + 0.5, z);
  k.box(2.2, 0.1, 0.1, COLORS.woodLight, 0, H + 0.75, -1.05);
  k.box(2.2, 0.1, 0.1, COLORS.woodLight, 0, H + 0.75, 1.05);
  k.box(0.1, 0.1, 2.2, COLORS.woodLight, -1.05, H + 0.75, 0);
  k.box(0.1, 0.1, 2.2, COLORS.woodLight, 1.05, H + 0.75, 0);
  // Ladder
  k.box(0.06, H, 0.06, COLORS.woodLight, -0.25, H / 2, 1.3, 0, -0.12);
  k.box(0.06, H, 0.06, COLORS.woodLight, 0.25, H / 2, 1.3, 0, -0.12);
  for (let i = 0; i < 6; i++) k.box(0.55, 0.05, 0.05, COLORS.woodLight, 0, 0.3 + i * 0.38, 1.33 - i * 0.045);
  const base = k.mesh(true);
  root.add(base);

  const rk = new Kit();
  // Level 2: pennant poles on each corner and a crest on the front rail (keeps the archers visible).
  for (const [x, z] of [
    [-1.05, -1.05],
    [1.05, -1.05],
    [-1.05, 1.05],
    [1.05, 1.05],
  ]) {
    rk.add(new THREE.CylinderGeometry(0.04, 0.04, 1.6), COLORS.woodDark, x, H + 1.1, z);
    rk.box(0.5, 0.32, 0.03, COLORS.team, x + 0.26, H + 1.7, z);
    rk.add(new THREE.SphereGeometry(0.07, 6, 5), COLORS.coin, x, H + 1.93, z);
  }
  rk.add(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12), COLORS.team, 0, H + 0.6, 1.1, Math.PI / 2);
  rk.add(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 10), COLORS.coin, 0, H + 0.6, 1.12, Math.PI / 2);
  const roof = rk.mesh(true);
  roof.visible = false;
  root.add(roof);

  const ballista = new THREE.Group();
  const bk = new Kit();
  bk.box(0.25, 0.4, 0.25, COLORS.woodDark, 0, 0.2, 0);
  bk.box(0.18, 0.18, 1.5, COLORS.wood, 0, 0.45, 0.2);
  bk.add(new THREE.TorusGeometry(0.75, 0.06, 4, 14, Math.PI), COLORS.woodDark, 0, 0.45, 0.55, -Math.PI / 2, 0, 0);
  bk.box(0.08, 0.08, 0.9, COLORS.steel, 0, 0.58, 0.45);
  ballista.add(bk.mesh());
  ballista.position.set(0, H + 0.22, 0);
  ballista.visible = false;
  root.add(ballista);

  const slots = [new THREE.Vector3(-0.45, H + 0.22, 0.35), new THREE.Vector3(0.45, H + 0.22, -0.35)];
  return { root, roof, ballista, slots };
}

/** A banner pole marking where knights hold the road. */
export function makePostFlag() {
  const k = new Kit();
  k.add(new THREE.CylinderGeometry(0.06, 0.07, 3.2, 6), COLORS.woodDark, 0, 1.6, 0);
  k.box(0.9, 1.1, 0.04, COLORS.team, 0.47, 2.55, 0);
  k.add(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 10), COLORS.coin, 0.47, 2.6, 0.03, Math.PI / 2);
  k.add(new THREE.SphereGeometry(0.1, 8, 6), COLORS.coin, 0, 3.25, 0);
  k.add(new THREE.CylinderGeometry(0.35, 0.4, 0.2, 8), COLORS.stoneDark, 0, 0.1, 0);
  return k.mesh();
}

/** Spiked barricade spanning the road; local x runs across the road. */
export function makeBarricade(len: number) {
  const k = new Kit();
  const n = Math.max(3, Math.round(len / 0.5));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + ((i + 0.5) * len) / n;
    const lean = i % 2 ? 0.5 : -0.5;
    k.add(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 5), i % 2 ? COLORS.wood : COLORS.woodDark, x, 0.6, 0, lean, 0, 0);
    k.add(new THREE.ConeGeometry(0.08, 0.25, 5), COLORS.woodLight, x, 0.6 + Math.cos(lean) * 0.95, Math.sin(lean) * 0.95, lean);
  }
  k.box(len, 0.16, 0.16, COLORS.woodDark, 0, 0.55, 0);
  k.box(len, 0.12, 0.12, COLORS.wood, 0, 0.25, 0.1);
  return k.mesh();
}

export function makeHall() {
  const root = new THREE.Group();
  const k = new Kit();
  k.box(5.2, 0.5, 4.4, COLORS.stoneDark, 0, 0.25, 0);
  k.box(4.6, 2.0, 3.8, COLORS.wood, 0, 1.5, 0);
  for (let i = 0; i < 7; i++) k.box(4.62, 0.05, 0.05, COLORS.woodDark, 0, 0.7 + i * 0.28, 1.92);
  k.box(4.0, 1.6, 3.2, COLORS.woodLight, 0, 3.3, 0);
  gable(k, 3.6, 2.0, 4.8, COLORS.roof, 0, 4.1, 0);
  k.box(4.9, 0.14, 0.18, COLORS.woodDark, 0, 6.1, 0);
  gable(k, 4.6, 1.0, 5.3, COLORS.roof, 0, 2.5, 0);
  // Door, windows, balcony
  k.box(1.1, 1.4, 0.1, COLORS.woodDark, 0, 1.2, 1.95);
  k.box(0.6, 0.5, 0.08, 0x3a2410, -1.5, 3.3, 1.62);
  k.box(0.6, 0.5, 0.08, 0x3a2410, 1.5, 3.3, 1.62);
  k.box(0.7, 0.6, 0.08, 0xffd27a, -1.5, 1.6, 1.93);
  k.box(0.7, 0.6, 0.08, 0xffd27a, 1.5, 1.6, 1.93);
  k.box(4.4, 0.12, 0.8, COLORS.woodDark, 0, 2.52, 2.3);
  for (let i = 0; i < 9; i++) k.box(0.06, 0.5, 0.06, COLORS.woodLight, -2.1 + i * 0.52, 2.8, 2.65);
  k.box(4.4, 0.07, 0.07, COLORS.woodLight, 0, 3.05, 2.65);
  // Chimney + side shed
  k.box(0.6, 2.2, 0.6, COLORS.stone, 1.5, 5.0, -0.8);
  k.box(1.8, 1.4, 2.4, COLORS.wood, -3.2, 0.95, -0.4);
  gable(k, 2.2, 0.8, 2.6, COLORS.roof, -3.2, 1.65, -0.4, Math.PI / 2);
  // Crown sign
  k.box(1.2, 0.7, 0.08, COLORS.woodDark, 0, 4.3, 1.62);
  k.add(new THREE.ConeGeometry(0.12, 0.3, 4), COLORS.coin, -0.3, 4.35, 1.68);
  k.add(new THREE.ConeGeometry(0.14, 0.38, 4), COLORS.coin, 0, 4.39, 1.68);
  k.add(new THREE.ConeGeometry(0.12, 0.3, 4), COLORS.coin, 0.3, 4.35, 1.68);
  // Barrels & crates
  k.add(new THREE.CylinderGeometry(0.32, 0.32, 0.7, 10), COLORS.wood, 2.9, 0.35, 1.8);
  k.add(new THREE.CylinderGeometry(0.32, 0.32, 0.7, 10), COLORS.woodDark, 3.1, 0.35, 1.0);
  k.box(0.7, 0.7, 0.7, COLORS.woodLight, -2.9, 0.35, 2.1, 0.3);
  root.add(k.mesh(true));

  const banners = new THREE.Group();
  for (const x of [-2.2, 2.2]) {
    const b = mesh(GEO.box, MAT.team, false);
    b.scale.set(0.6, 1.2, 0.04);
    b.position.set(x, 2.0, 2.0);
    banners.add(b);
  }
  root.add(banners);
  const lamp = new THREE.PointLight(COLORS.fire, 5, 8, 1.6);
  lamp.position.set(0, 2.0, 3.0);
  root.add(lamp);
  return { root, banners };
}

export interface WorkshopRig {
  root: THREE.Group;
  /** Local position of the output rack / waiting area. */
  rack: THREE.Vector3;
  chimney?: THREE.Vector3;
  anim?: THREE.Object3D;
}

export function makeBarracks(): WorkshopRig {
  const root = new THREE.Group();
  const k = new Kit();
  k.box(4.2, 0.35, 3.2, COLORS.stoneDark, 0, 0.17, 0);
  k.box(3.8, 2.0, 2.8, COLORS.wood, 0, 1.35, 0);
  gable(k, 4.3, 1.9, 3.3, COLORS.team, 0, 2.35, 0, Math.PI / 2);
  k.box(1.0, 1.4, 0.1, COLORS.woodDark, 0, 1.05, 1.42);
  // Crossed swords sign
  k.box(1.1, 0.8, 0.06, COLORS.woodLight, 0, 2.6, 1.45);
  k.box(0.08, 0.8, 0.04, COLORS.steel, 0, 2.6, 1.5, 0, 0, 0.7);
  k.box(0.08, 0.8, 0.04, COLORS.steel, 0, 2.6, 1.5, 0, 0, -0.7);
  // Training dummy
  k.add(new THREE.CylinderGeometry(0.06, 0.06, 1.4), COLORS.woodDark, 2.6, 0.7, 1.0);
  k.add(new THREE.CapsuleGeometry(0.22, 0.4, 2, 8), COLORS.straw, 2.6, 1.15, 1.0);
  k.box(0.9, 0.08, 0.08, COLORS.woodDark, 2.6, 1.2, 1.0);
  root.add(k.mesh(true));
  return { root, rack: new THREE.Vector3(0, 0, 2.6) };
}

export function makeRange(): WorkshopRig {
  const root = new THREE.Group();
  const k = new Kit();
  k.box(4.0, 0.3, 3.0, COLORS.stoneDark, 0, 0.15, 0);
  for (const [x, z] of [
    [-1.8, -1.3],
    [1.8, -1.3],
    [-1.8, 1.3],
    [1.8, 1.3],
  ])
    k.box(0.2, 2.2, 0.2, COLORS.woodDark, x, 1.25, z);
  gable(k, 4.5, 1.7, 3.3, 0x5e8f3a, 0, 2.35, 0, Math.PI / 2);
  k.box(3.6, 1.0, 0.1, COLORS.wood, 0, 0.8, -1.3);
  // Targets
  for (const x of [-2.9, 2.9]) {
    k.add(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 14), COLORS.straw, x, 0.9, -0.4, Math.PI / 2);
    k.add(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14), 0xe2343b, x, 0.9, -0.4 + 0.01, Math.PI / 2);
    k.add(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 10), COLORS.straw, x, 0.9, -0.4 + 0.02, Math.PI / 2);
    k.box(0.08, 1.2, 0.08, COLORS.woodDark, x, 0.45, -0.55, 0, -0.3);
  }
  k.box(0.6, 0.9, 0.3, COLORS.woodDark, 0.8, 0.6, 0.5);
  root.add(k.mesh(true));
  return { root, rack: new THREE.Vector3(0, 0, 2.5) };
}

export function makeForge(): WorkshopRig {
  const root = new THREE.Group();
  const k = new Kit();
  k.box(4.0, 0.3, 3.2, COLORS.stoneDark, 0, 0.15, 0);
  k.box(3.2, 1.9, 2.6, COLORS.stone, 0, 1.25, -0.2);
  gable(k, 3.7, 1.6, 3.0, COLORS.roof, 0, 2.2, -0.2, Math.PI / 2);
  k.box(0.8, 2.8, 0.8, COLORS.stoneDark, 1.1, 2.4, -0.7);
  k.box(1.4, 1.0, 0.1, 0x2a1408, 0, 0.95, 1.12);
  k.box(1.1, 0.6, 0.12, COLORS.fire, 0, 0.75, 1.1);
  // Anvil
  k.box(0.5, 0.45, 0.35, COLORS.woodDark, -1.0, 0.45, 1.6);
  k.box(0.75, 0.25, 0.35, 0x45474d, -1.0, 0.8, 1.6);
  k.add(new THREE.ConeGeometry(0.16, 0.3, 4), 0x45474d, -1.5, 0.8, 1.6, 0, 0, Math.PI / 2);
  // Rack frame
  k.box(2.0, 0.12, 0.12, COLORS.woodDark, 0.9, 1.0, 2.1);
  k.box(0.12, 1.0, 0.12, COLORS.woodDark, -0.05, 0.5, 2.1);
  k.box(0.12, 1.0, 0.12, COLORS.woodDark, 1.85, 0.5, 2.1);
  root.add(k.mesh(true));
  const glow = new THREE.PointLight(COLORS.fire, 4, 5, 1.6);
  glow.position.set(0, 1, 1.6);
  root.add(glow);
  const hammer = new THREE.Group();
  const hk = new Kit();
  hk.box(0.05, 0.4, 0.05, COLORS.woodDark, 0, 0.2, 0);
  hk.box(0.2, 0.1, 0.1, 0x45474d, 0, 0.42, 0);
  hammer.add(hk.mesh());
  hammer.position.set(-1.0, 0.95, 1.6);
  root.add(hammer);
  return { root, rack: new THREE.Vector3(0.9, 0, 2.6), chimney: new THREE.Vector3(1.1, 4.0, -0.7), anim: hammer };
}

export function makeBowyer(): WorkshopRig {
  const root = new THREE.Group();
  const k = new Kit();
  k.box(3.6, 0.3, 3.0, COLORS.stoneDark, 0, 0.15, 0);
  k.box(3.0, 1.8, 2.4, COLORS.woodLight, 0, 1.2, -0.2);
  for (let i = 0; i < 6; i++) k.box(3.02, 0.05, 0.05, COLORS.wood, 0, 0.5 + i * 0.28, 1.02);
  gable(k, 3.5, 1.6, 2.9, 0x5e8f3a, 0, 2.1, -0.2, Math.PI / 2);
  k.box(0.9, 1.2, 0.1, COLORS.woodDark, -0.7, 0.9, 1.02);
  // Bow sign
  k.add(new THREE.TorusGeometry(0.35, 0.05, 4, 12, Math.PI), COLORS.woodDark, 0.7, 2.0, 1.1, 0, 0, -Math.PI / 2);
  k.add(new THREE.CylinderGeometry(0.01, 0.01, 0.7, 3), 0xf5efe0, 0.7, 2.0, 1.1);
  // Log pile
  for (let i = 0; i < 3; i++)
    k.add(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 7), COLORS.wood, -2.0, 0.2 + i * 0.28, -0.6 + (i % 2) * 0.18, Math.PI / 2, 0, 0);
  k.box(2.0, 0.12, 0.12, COLORS.woodDark, 0.6, 1.0, 1.9);
  k.box(0.12, 1.0, 0.12, COLORS.woodDark, -0.35, 0.5, 1.9);
  k.box(0.12, 1.0, 0.12, COLORS.woodDark, 1.55, 0.5, 1.9);
  root.add(k.mesh(true));
  return { root, rack: new THREE.Vector3(0.6, 0, 2.4) };
}

// ---------------------------------------------------------------- Decor

export function makeCactus(rng: () => number) {
  const k = new Kit();
  const h = 1.0 + rng() * 1.4;
  k.add(new THREE.CapsuleGeometry(0.22, h, 3, 8), COLORS.cactus, 0, h / 2 + 0.2, 0);
  if (rng() > 0.3) {
    k.add(new THREE.CapsuleGeometry(0.14, 0.45, 3, 6), COLORS.cactus, 0.32, h * 0.55, 0, 0, 0, 0);
    k.add(new THREE.CapsuleGeometry(0.13, 0.3, 3, 6), COLORS.cactus, 0.18, h * 0.42, 0, 0, 0, Math.PI / 2);
  }
  if (rng() > 0.5) {
    k.add(new THREE.CapsuleGeometry(0.12, 0.35, 3, 6), COLORS.cactus, -0.3, h * 0.7, 0);
    k.add(new THREE.CapsuleGeometry(0.11, 0.25, 3, 6), COLORS.cactus, -0.17, h * 0.6, 0, 0, 0, Math.PI / 2);
  }
  return k.mesh();
}

export function makeBush(rng: () => number) {
  const k = new Kit();
  for (let i = 0; i < 4; i++) {
    const s = 0.2 + rng() * 0.25;
    k.add(new THREE.IcosahedronGeometry(s, 0), rng() > 0.5 ? COLORS.bush : 0x7f7038, (rng() - 0.5) * 0.6, s * 0.8, (rng() - 0.5) * 0.6);
  }
  return k.mesh(true);
}

export function makeRock(rng: () => number) {
  const k = new Kit();
  const s = 0.4 + rng() * 0.9;
  k.add(new THREE.DodecahedronGeometry(s, 0), rng() > 0.5 ? COLORS.cliff : COLORS.cliffDark, 0, s * 0.4, 0, rng(), rng() * 6, rng(), 1, 0.6 + rng() * 0.4, 1);
  return k.mesh(true);
}

export function makeProps(rng: () => number) {
  const k = new Kit();
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const x = (rng() - 0.5) * 1.6;
    const z = (rng() - 0.5) * 1.6;
    if (rng() > 0.5) k.add(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 10), rng() > 0.5 ? COLORS.wood : COLORS.woodDark, x, 0.35, z);
    else k.box(0.65, 0.65, 0.65, COLORS.woodLight, x, 0.32, z, rng());
  }
  return k.mesh();
}

/** Layered mesa: stacked, slightly shrinking slabs with striped strata. */
export function makeMesa(rng: () => number) {
  const k = new Kit();
  const layers = 2 + Math.floor(rng() * 3);
  let w = 4 + rng() * 5;
  let d = 3 + rng() * 4;
  let y = 0;
  for (let i = 0; i < layers; i++) {
    const h = 1.4 + rng() * 1.6;
    const c = i % 2 ? COLORS.cliffDark : rng() > 0.5 ? COLORS.cliff : COLORS.cliffLight;
    k.add(new THREE.CylinderGeometry(1, 1.08, 1, 7), c, (rng() - 0.5) * 0.6, y + h / 2, (rng() - 0.5) * 0.6, 0, rng() * 6, 0, w / 2, h, d / 2);
    y += h;
    w *= 0.8 + rng() * 0.12;
    d *= 0.8 + rng() * 0.12;
  }
  return k.mesh(true);
}

export function makeDeadTree(rng: () => number) {
  const k = new Kit();
  const h = 1.6 + rng() * 1.2;
  k.add(new THREE.CylinderGeometry(0.06, 0.14, h, 5), COLORS.woodDark, 0, h / 2, 0);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + rng();
    k.add(new THREE.CylinderGeometry(0.03, 0.06, 0.8, 4), COLORS.woodDark, Math.cos(a) * 0.3, h * (0.55 + i * 0.13), Math.sin(a) * 0.3, Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8);
  }
  return k.mesh();
}

export function makeLantern() {
  const root = new THREE.Group();
  const k = new Kit();
  k.add(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6), COLORS.woodDark, 0, 1.1, 0);
  k.box(0.5, 0.06, 0.06, COLORS.woodDark, 0.2, 2.15, 0);
  k.box(0.18, 0.26, 0.18, COLORS.fire, 0.42, 1.95, 0);
  root.add(k.mesh());
  return root;
}
