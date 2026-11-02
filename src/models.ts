import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, type EnemyKind } from './config';

// Procedural low-poly medieval models. Geometries and materials are shared wherever
// possible so hundreds of objects stay cheap on mobile GPUs.

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

export const MAT = {
  steel: lambert(COLORS.steel),
  steelDark: lambert(COLORS.steelDark),
  tabard: lambert(COLORS.tabard),
  plume: lambert(COLORS.plume),
  skin: lambert(COLORS.skin),
  coin: lambert(COLORS.coin, { emissive: COLORS.coinDeep, emissiveIntensity: 0.35 }),
  wood: lambert(COLORS.wood),
  woodDark: lambert(COLORS.woodDark),
  stone: lambert(COLORS.stone, { flatShading: true }),
  stoneDark: lambert(COLORS.stoneDark, { flatShading: true }),
  roof: lambert(COLORS.roof, { flatShading: true }),
  rock: lambert(COLORS.rock, { flatShading: true }),
  rockDark: lambert(COLORS.rockDark, { flatShading: true }),
  pine: lambert(COLORS.pine, { flatShading: true }),
  pineDark: lambert(COLORS.pineDark, { flatShading: true }),
  squire: lambert(COLORS.squire),
  arrow: new THREE.MeshBasicMaterial({ color: COLORS.arrow }),
  fire: lambert(COLORS.fire, { emissive: COLORS.fire, emissiveIntensity: 0.9 }),
  eyeRed: lambert(0xff2a2a, { emissive: 0xaa0000 }),
  tusk: lambert(0xfff6dc),
  dark: lambert(0x2a1d14),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
};

export const GEO = {
  coin: new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12),
  arrow: new THREE.CylinderGeometry(0.035, 0.035, 0.7, 4),
  particle: new THREE.BoxGeometry(0.16, 0.16, 0.16),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  lowSphere: new THREE.SphereGeometry(1, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  blobShadow: new THREE.CircleGeometry(1, 20),
  dot: new THREE.CircleGeometry(0.11, 10),
};
// Arrows fly along +z.
GEO.arrow.rotateX(Math.PI / 2);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, cast = true) {
  const m = mesh(GEO.box, mat, cast);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}

export function blobShadow(radius: number) {
  const s = new THREE.Mesh(GEO.blobShadow, MAT.shadow);
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.02;
  s.scale.setScalar(radius);
  s.renderOrder = 1;
  return s;
}

/** A small crossbow pointing along +z, with a muzzle marker at its tip. */
function makeCrossbow() {
  const g = new THREE.Group();
  g.add(box(0.09, 0.09, 0.6, MAT.wood));
  const bow = mesh(new THREE.TorusGeometry(0.28, 0.03, 4, 12, Math.PI), MAT.woodDark, false);
  bow.rotation.x = -Math.PI / 2;
  bow.position.z = 0.18;
  g.add(bow);
  const muzzle = new THREE.Object3D();
  muzzle.position.z = 0.35;
  g.add(muzzle);
  return { group: g, muzzle };
}

// ---------------------------------------------------------------- Hero (knight)

export interface HeroRig {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  muzzle: THREE.Object3D;
  stackAnchor: THREE.Group;
}

export function makeHero(): HeroRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = mesh(new THREE.CapsuleGeometry(0.34, 0.4, 4, 12), MAT.steel);
  torso.position.y = 0.82;
  body.add(torso);
  const tabard = mesh(new THREE.CylinderGeometry(0.37, 0.42, 0.55, 12), MAT.tabard);
  tabard.position.y = 0.78;
  body.add(tabard);
  body.add(box(0.8, 0.08, 0.08, MAT.woodDark, 0, 1.0, 0.0)); // belt/shoulder strap feel

  const helmet = mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.46, 12), MAT.steel);
  helmet.position.y = 1.5;
  body.add(helmet);
  const dome = mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.steel);
  dome.position.y = 1.73;
  body.add(dome);
  body.add(box(0.4, 0.05, 0.05, MAT.dark, 0, 1.52, 0.29, false)); // visor slit
  const plume = mesh(GEO.lowSphere, MAT.plume);
  plume.scale.set(0.09, 0.22, 0.32);
  plume.position.set(0, 2.05, -0.05);
  body.add(plume);

  const shield = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), MAT.tabard);
  shield.rotation.z = Math.PI / 2;
  shield.position.set(-0.42, 0.85, 0.05);
  body.add(shield);

  const legGeo = new THREE.CapsuleGeometry(0.11, 0.22, 2, 8);
  const legL = mesh(legGeo, MAT.steelDark);
  legL.position.set(-0.16, 0.24, 0);
  const legR = mesh(legGeo, MAT.steelDark);
  legR.position.set(0.16, 0.24, 0);
  root.add(legL, legR);

  const xb = makeCrossbow();
  xb.group.position.set(0.4, 0.95, 0.25);
  body.add(xb.group);

  const stackAnchor = new THREE.Group();
  stackAnchor.position.set(0, 1.25, -0.6);
  body.add(stackAnchor);
  body.add(box(0.5, 0.45, 0.2, MAT.wood, 0, 1.0, -0.42)); // back basket

  root.add(blobShadow(0.55));
  return { root, body, legL, legR, muzzle: xb.muzzle, stackAnchor };
}

export function makeSquire() {
  const g = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(0.22, 0.3, 4, 8), MAT.squire);
  body.position.y = 0.5;
  g.add(body);
  const head = mesh(GEO.lowSphere, MAT.skin);
  head.scale.setScalar(0.2);
  head.position.y = 1.0;
  g.add(head);
  const cap = mesh(new THREE.ConeGeometry(0.22, 0.3, 8), MAT.tabard);
  cap.position.y = 1.2;
  g.add(cap);
  const xb = makeCrossbow();
  xb.group.scale.setScalar(0.7);
  xb.group.position.set(0.25, 0.6, 0.15);
  g.add(xb.group);
  g.add(blobShadow(0.32));
  return { root: g, muzzle: xb.muzzle };
}

// ---------------------------------------------------------------- Enemies

export interface EnemyRig {
  root: THREE.Group;
  body: THREE.Group;
  mats: THREE.MeshLambertMaterial[];
}

export function makeEnemy(kind: EnemyKind, color: number): EnemyRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Per-enemy material so we can flash it white on hit.
  const skin = lambert(kind === 'runner' ? COLORS.goblin : color, { emissive: 0x000000 });
  const mats = [skin];

  if (kind === 'troll') {
    const torso = mesh(GEO.sphere, skin);
    torso.scale.set(1.0, 1.0, 0.85);
    torso.position.y = 1.15;
    body.add(torso);
    const head = mesh(GEO.lowSphere, skin);
    head.scale.setScalar(0.5);
    head.position.set(0, 2.15, 0.25);
    body.add(head);
    for (const s of [-1, 1]) {
      const eye = mesh(GEO.lowSphere, MAT.eyeRed, false);
      eye.scale.setScalar(0.08);
      eye.position.set(s * 0.18, 2.25, 0.68);
      body.add(eye);
      const tusk = mesh(new THREE.ConeGeometry(0.07, 0.3, 5), MAT.tusk, false);
      tusk.position.set(s * 0.2, 1.95, 0.68);
      body.add(tusk);
      const arm = mesh(GEO.lowSphere, skin);
      arm.scale.set(0.28, 0.6, 0.28);
      arm.position.set(s * 1.05, 1.0, 0.1);
      body.add(arm);
      const leg = mesh(GEO.lowSphere, skin);
      leg.scale.set(0.3, 0.4, 0.3);
      leg.position.set(s * 0.45, 0.3, 0);
      body.add(leg);
    }
    const club = mesh(new THREE.CylinderGeometry(0.22, 0.1, 1.6, 6), MAT.woodDark);
    club.position.set(1.15, 1.0, 0.6);
    club.rotation.x = 1.0;
    body.add(club);
    body.add(box(1.5, 0.3, 1.2, MAT.wood, 0, 0.75, 0)); // loincloth
  } else {
    const small = kind === 'runner';
    const s = small ? 0.8 : 1;
    const torso = mesh(new THREE.CapsuleGeometry(0.25 * s, 0.25 * s, 4, 8), MAT.wood);
    torso.position.y = 0.48 * s;
    body.add(torso);
    const head = mesh(GEO.lowSphere, skin);
    head.scale.setScalar(0.3 * s);
    head.position.y = 0.98 * s;
    body.add(head);
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.08 * s, 0.35 * s, 4), skin, false);
      ear.rotation.z = side * -1.3;
      ear.position.set(side * 0.38 * s, 1.02 * s, 0);
      body.add(ear);
      const eye = mesh(GEO.lowSphere, MAT.eyeRed, false);
      eye.scale.setScalar(0.05 * s);
      eye.position.set(side * 0.11 * s, 1.03 * s, 0.26 * s);
      body.add(eye);
    }
    if (small) {
      // Red-hooded runner.
      const hoodMat = lambert(color, { emissive: 0x000000 });
      mats.push(hoodMat);
      const hood = mesh(new THREE.ConeGeometry(0.3, 0.45, 8), hoodMat);
      hood.position.y = 1.2;
      body.add(hood);
    } else {
      const club = mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.6, 5), MAT.woodDark);
      club.position.set(0.32, 0.6, 0.2);
      club.rotation.x = 0.8;
      body.add(club);
    }
  }
  root.add(blobShadow(kind === 'troll' ? 1.2 : kind === 'runner' ? 0.36 : 0.45));
  return { root, body, mats };
}

// ---------------------------------------------------------------- Structures

export interface TowerRig {
  root: THREE.Group;
  head: THREE.Group;
  muzzle: THREE.Object3D;
  banners: THREE.Mesh[];
}

/** Stone archer tower; the archer on top turns to aim. */
export function makeTower(): TowerRig {
  const root = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(0.8, 0.95, 1.6, 8), MAT.stone);
  base.position.y = 0.8;
  base.receiveShadow = true;
  root.add(base);
  const deck = mesh(new THREE.CylinderGeometry(1.0, 0.85, 0.25, 8), MAT.wood);
  deck.position.y = 1.72;
  root.add(deck);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    root.add(box(0.22, 0.32, 0.22, MAT.stoneDark, Math.cos(a) * 0.88, 1.98, Math.sin(a) * 0.88));
  }
  const banners: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const b = box(0.5, 0.6, 0.04, MAT.tabard, 0, 1.05, i === 0 ? 0.93 : -0.93, false);
    b.visible = false;
    root.add(b);
    banners.push(b);
  }

  const head = new THREE.Group();
  head.position.y = 1.85;
  const archer = mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 8), MAT.squire);
  archer.position.y = 0.35;
  head.add(archer);
  const face = mesh(GEO.lowSphere, MAT.skin);
  face.scale.setScalar(0.18);
  face.position.y = 0.8;
  head.add(face);
  const hat = mesh(new THREE.ConeGeometry(0.2, 0.28, 8), MAT.plume);
  hat.position.y = 1.0;
  head.add(hat);
  const xb = makeCrossbow();
  xb.group.position.set(0.0, 0.5, 0.25);
  head.add(xb.group);
  root.add(head);
  return { root, head, muzzle: xb.muzzle, banners };
}

/** Sharpened wooden palisade, merged into two meshes so long fences cost two draw calls. */
export function makeWall(len: number) {
  const root = new THREE.Group();
  const n = Math.max(3, Math.round(len / 0.36));
  const light: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + ((i + 0.5) * len) / n;
    const h = 0.9 + ((i * 37) % 7) * 0.05;
    const stake = new THREE.CylinderGeometry(0.17, 0.19, h, 6).translate(x, h / 2, 0);
    const tip = new THREE.ConeGeometry(0.17, 0.35, 6).translate(x, h + 0.17, 0);
    (i % 2 ? light : dark).push(stake, tip);
  }
  dark.push(new THREE.BoxGeometry(len, 0.12, 0.42).translate(0, 0.45, 0));
  for (const [geos, mat] of [
    [light, MAT.wood],
    [dark, MAT.woodDark],
  ] as const) {
    const merged = mergeGeometries(geos)!;
    geos.forEach((g) => g.dispose());
    root.add(mesh(merged, mat));
  }
  return { root };
}

/** The keep at the centre of the territory. */
export function makeKeep() {
  const root = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(2.8, 2.2, 2.8), MAT.stone);
  base.position.y = 1.1;
  base.receiveShadow = true;
  root.add(base);
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 1.4 : -1.4;
    const z = i < 2 ? 1.4 : -1.4;
    const t = mesh(new THREE.CylinderGeometry(0.55, 0.6, 3.0, 8), MAT.stoneDark);
    t.position.set(x, 1.5, z);
    root.add(t);
    const roof = mesh(new THREE.ConeGeometry(0.72, 1.0, 8), MAT.roof);
    roof.position.set(x, 3.5, z);
    root.add(roof);
  }
  for (let i = 0; i < 6; i++) {
    const o = -1.0 + i * 0.4;
    root.add(box(0.22, 0.3, 0.22, MAT.stoneDark, o, 2.35, 1.3));
    root.add(box(0.22, 0.3, 0.22, MAT.stoneDark, o, 2.35, -1.3));
  }
  const door = box(0.8, 1.1, 0.1, MAT.woodDark, 0, 0.55, 1.41, false);
  root.add(door);
  const pole = mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0), MAT.woodDark);
  pole.position.set(0, 3.2, 0);
  root.add(pole);
  const flag = box(0.9, 0.5, 0.03, MAT.tabard, 0.47, 3.9, 0, false);
  root.add(flag);
  const glow = new THREE.PointLight(COLORS.fire, 4, 7, 1.6);
  glow.position.set(0, 1.0, 2.0);
  root.add(glow);
  return { root, flag };
}

export function makeMine() {
  const root = new THREE.Group();
  const hill = mesh(new THREE.DodecahedronGeometry(1.3, 0), MAT.rock);
  hill.scale.set(1.1, 0.8, 1.0);
  hill.position.set(0, 0.6, -0.4);
  root.add(hill);
  root.add(box(0.15, 1.3, 0.15, MAT.wood, -0.55, 0.65, 0.55));
  root.add(box(0.15, 1.3, 0.15, MAT.wood, 0.55, 0.65, 0.55));
  root.add(box(1.4, 0.18, 0.2, MAT.wood, 0, 1.35, 0.55));
  root.add(box(0.9, 1.0, 0.1, MAT.dark, 0, 0.5, 0.48, false));
  const cart = new THREE.Group();
  cart.add(box(0.7, 0.35, 0.5, MAT.woodDark, 0, 0.32, 0));
  const gold = mesh(GEO.lowSphere, MAT.coin, false);
  gold.scale.set(0.3, 0.12, 0.2);
  gold.position.y = 0.52;
  cart.add(gold);
  cart.position.set(0, 0, 1.3);
  root.add(cart);
  const pick = new THREE.Group();
  pick.add(box(0.06, 0.8, 0.06, MAT.wood, 0, 0.4, 0));
  pick.add(box(0.6, 0.08, 0.08, MAT.steelDark, 0, 0.8, 0));
  pick.position.set(0.9, 0.2, 0.9);
  root.add(pick);
  return { root, cart, pick };
}

// ---------------------------------------------------------------- Decor

export function makeRock(rng: () => number) {
  const m = mesh(new THREE.DodecahedronGeometry(1, 0), rng() > 0.5 ? MAT.rock : MAT.rockDark);
  m.scale.set(0.5 + rng() * 1.1, 0.35 + rng() * 0.7, 0.5 + rng() * 1.1);
  m.rotation.set(rng(), rng() * 6, rng());
  m.receiveShadow = true;
  return m;
}

export function makePine(rng: () => number) {
  const g = new THREE.Group();
  const s = 0.8 + rng() * 0.7;
  const trunk = mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 5), MAT.woodDark);
  trunk.position.y = 0.4;
  g.add(trunk);
  const mat = rng() > 0.5 ? MAT.pine : MAT.pineDark;
  for (let i = 0; i < 3; i++) {
    const c = mesh(new THREE.ConeGeometry(0.9 - i * 0.22, 1.1, 7), mat);
    c.position.y = 1.0 + i * 0.6;
    g.add(c);
  }
  g.scale.setScalar(s);
  g.rotation.y = rng() * 6;
  return g;
}

export function makeDeadTree(rng: () => number) {
  const g = new THREE.Group();
  const h = 1.6 + rng() * 1.2;
  const trunk = mesh(new THREE.CylinderGeometry(0.06, 0.14, h, 5), MAT.woodDark);
  trunk.position.y = h / 2;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const b = mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.8, 4), MAT.woodDark);
    b.position.set(0, h * (0.5 + i * 0.15), 0);
    b.rotation.set(0, (i * 2.1 + rng()) % 6.28, 0.8);
    b.translateY(0.35);
    g.add(b);
  }
  return g;
}

export function makeCliff(rng: () => number) {
  const h = 3 + rng() * 5;
  const m = mesh(new THREE.CylinderGeometry(2.5 + rng() * 2, 3.5 + rng() * 2.5, h, 6), rng() > 0.5 ? MAT.rock : MAT.rockDark);
  m.position.y = h / 2 - 0.3;
  m.rotation.y = rng() * 6;
  return m;
}
