import * as THREE from 'three';
import type { Assets, CharRig } from './assets';
import { GEO, MAT, blobShadow } from './models';

// Game objects assembled from KayKit models. One Assets instance is shared for the whole session.

let A: Assets;
export function useAssets(a: Assets) {
  A = a;
  prepareItemGeometry(a);
}

/** Normalises a prop's mesh into a standalone geometry: longest side `size`, lying along +z. */
function itemGeometry(name: string, size: number, alongZ = true) {
  const src = A.props.get(name);
  if (!src) return null;
  src.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = new THREE.BufferGeometry();
    const p = m.geometry.attributes.position;
    const pos = new Float32Array(p.count * 3);
    const uv = new Float32Array(p.count * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      pos.set([v.x, v.y, v.z], i * 3);
      if (m.geometry.attributes.uv) uv.set([m.geometry.attributes.uv.getX(i), m.geometry.attributes.uv.getY(i)], i * 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (m.geometry.index) g.setIndex(Array.from(m.geometry.index.array));
    parts.push(g);
  });
  const g = parts[0];
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const d = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  if (alongZ) {
    // Rotate the longest axis onto +z.
    if (d.y >= d.x && d.y >= d.z) g.rotateX(Math.PI / 2);
    else if (d.x >= d.y && d.x >= d.z) g.rotateY(Math.PI / 2);
  }
  g.scale(size / Math.max(d.x, d.y, d.z), size / Math.max(d.x, d.y, d.z), size / Math.max(d.x, d.y, d.z));
  g.computeVertexNormals();
  return g;
}

let itemMat: THREE.MeshStandardMaterial | null = null;
/** Material for carried/racked weapons: the KayKit atlas, tinted per instance by tier. */
export function weaponItemMaterial() {
  return itemMat!;
}

function prepareItemGeometry(a: Assets) {
  const sword = itemGeometry('sword_1handed', 0.95);
  const bow = itemGeometry('crossbow_1handed', 0.75);
  const arrow = itemGeometry('arrow', 0.8);
  const coin = itemGeometry('coin', 0.5, false);
  if (sword) GEO.sword = sword;
  if (bow) GEO.bow = bow;
  if (arrow) GEO.arrow = arrow;
  if (coin) {
    // Lay the coin flat if it was modelled standing up.
    coin.computeBoundingBox();
    const s = coin.boundingBox!.getSize(new THREE.Vector3());
    if (s.y > Math.min(s.x, s.z)) {
      if (s.z < s.x) coin.rotateX(Math.PI / 2);
      else coin.rotateZ(Math.PI / 2);
    }
    GEO.coin = coin;
  }
  const m = a.propMesh('sword_1handed');
  itemMat = (m?.material as THREE.MeshStandardMaterial).clone();
  itemMat.metalness = 0.4;
  itemMat.roughness = 0.4;
  const am = a.propMesh('arrow');
  if (am) MAT.arrowModel = am.material as THREE.MeshStandardMaterial;
}

// ---------------------------------------------------------------- characters

export interface HeroRig {
  root: THREE.Group;
  char: CharRig;
  muzzle: THREE.Object3D;
  backAnchor: THREE.Group;
  frontAnchor: THREE.Group;
  ring: THREE.Mesh;
}

export function makeHero(): HeroRig {
  const char = A.character('hero', 2.5);
  const root = char.root;
  // Staff tip: where the magic bolts leave from.
  const muzzle = new THREE.Object3D();
  const staff = char.find('2H_Staff');
  if (staff) {
    staff.add(muzzle);
    muzzle.position.set(0, 1.05, 0);
  } else {
    muzzle.position.set(0.4, 1.4, 0.4);
    root.add(muzzle);
  }
  const backAnchor = new THREE.Group();
  backAnchor.position.set(0, 1.35, -0.55);
  root.add(backAnchor);
  const frontAnchor = new THREE.Group();
  frontAnchor.position.set(0, 1.15, 0.55);
  root.add(frontAnchor);
  root.add(blobShadow(0.75));
  const ring = new THREE.Mesh(GEO.ring, MAT.glowRing);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.scale.setScalar(1.05);
  ring.renderOrder = 2;
  root.add(ring);
  char.loop('Idle');
  return { root, char, muzzle, backAnchor, frontAnchor, ring };
}

export interface UnitRig {
  root: THREE.Group;
  char: CharRig;
  weaponMat: THREE.MeshStandardMaterial;
  muzzle: THREE.Object3D;
}

export function makeUnit(type: 'archer' | 'knight'): UnitRig {
  const char = A.character(type, type === 'archer' ? 1.65 : 1.75);
  const weapon = char.find(type === 'archer' ? '1H_Crossbow' : '1H_Sword') as THREE.Mesh | undefined;
  let weaponMat = new THREE.MeshStandardMaterial();
  if (weapon) {
    // Each unit gets its own weapon material so it can show the weapon tier colour.
    const mesh = weapon.isMesh ? weapon : (weapon.getObjectByProperty('isMesh', true) as THREE.Mesh);
    weaponMat = (mesh.material as THREE.MeshStandardMaterial).clone();
    mesh.material = weaponMat;
  }
  const muzzle = new THREE.Object3D();
  if (weapon) weapon.add(muzzle);
  else char.root.add(muzzle);
  char.root.add(blobShadow(0.42));
  char.loop('Idle');
  return { root: char.root, char, weaponMat, muzzle };
}

// ---------------------------------------------------------------- structures

export interface TowerRig {
  root: THREE.Group;
  /** Level 2 decoration (flags). */
  roof: THREE.Object3D;
  /** Level 3: catapult tower replaces the plain one. */
  ballista: THREE.Object3D;
  base: THREE.Object3D;
  slots: THREE.Vector3[];
}

export function makeTower(): TowerRig {
  const root = new THREE.Group();
  const H = 4.6;
  const base = A.prop('building_tower_base_blue', H);
  root.add(base);
  const cat = A.prop('building_tower_catapult_blue', H * 1.25);
  cat.visible = false;
  root.add(cat);
  const roof = new THREE.Group();
  for (const [x, z] of [
    [-1.0, -1.0],
    [1.0, 1.0],
  ]) {
    const f = A.prop('flag_blue', 1.6);
    f.position.set(x, H - 0.1, z);
    roof.add(f);
  }
  roof.visible = false;
  root.add(roof);
  const slots = [new THREE.Vector3(-0.45, H - 0.35, 0.4), new THREE.Vector3(0.5, H - 0.35, -0.35)];
  return { root, roof, ballista: cat, base, slots };
}

export function makePostFlag() {
  const g = new THREE.Group();
  const banner = A.prop('flag_blue', 3.2);
  g.add(banner);
  const rack = A.prop('weaponrack', 1.2);
  rack.position.set(0.9, 0, 0.4);
  g.add(rack);
  return g;
}

/** A barricade spanning the road; local x runs across the road. */
export function makeBarricade(len: number) {
  const g = new THREE.Group();
  const n = 2;
  for (let i = 0; i < n; i++) {
    const f = A.prop('fence_wood_straight', len / n + 0.15, 'max');
    // Lay the fence's long side across the road whichever way it was modelled.
    const box = new THREE.Box3().setFromObject(f);
    const size = box.getSize(new THREE.Vector3());
    if (size.z > size.x) f.rotation.y = Math.PI / 2;
    f.position.x = -len / 2 + (len / n) * (i + 0.5);
    g.add(f);
  }
  const c1 = A.prop('crate_A_big', 0.9);
  c1.position.set(-len / 2 - 0.4, 0, 0.3);
  const c2 = A.prop('barrel', 0.9);
  c2.position.set(len / 2 + 0.4, 0, -0.2);
  g.add(c1, c2);
  return g;
}

export function makeHall() {
  const root = new THREE.Group();
  const castle = A.prop('building_castle_blue', 8.5);
  root.add(castle);
  const banners = new THREE.Group();
  for (const x of [-2.8, 2.8]) {
    const b = A.prop('flag_blue', 2.8);
    b.position.set(x, 0, 3.4);
    banners.add(b);
  }
  root.add(banners);
  const lamp = new THREE.PointLight(0xffb357, 6, 9, 1.6);
  lamp.position.set(0, 2.2, 3.4);
  root.add(lamp);
  return { root, banners };
}

export interface WorkshopRig {
  root: THREE.Group;
  rack: THREE.Vector3;
  chimney?: THREE.Vector3;
  anim?: THREE.Object3D;
}

export function makeShop(kind: 'range' | 'barracks' | 'forge' | 'bowyer'): WorkshopRig {
  const root = new THREE.Group();
  const model = {
    range: 'building_archeryrange_blue',
    barracks: 'building_barracks_blue',
    forge: 'building_blacksmith_blue',
    bowyer: 'building_lumbermill_blue',
  }[kind];
  const b = A.prop(model, 4.6, 'max');
  b.rotation.y = Math.PI;
  root.add(b);
  const out: WorkshopRig = { root, rack: new THREE.Vector3(0, 0, 2.7) };
  if (kind === 'forge') {
    const rack = A.prop('weaponrack', 1.3);
    rack.position.set(0.9, 0, 2.4);
    root.add(rack);
    out.rack = new THREE.Vector3(0.9, 0, 2.8);
    out.chimney = new THREE.Vector3(-0.6, 4.2, -0.4);
  } else if (kind === 'bowyer') {
    const logs = A.prop('resource_lumber', 1.0);
    logs.position.set(-1.6, 0, 2.2);
    root.add(logs);
    out.rack = new THREE.Vector3(0.8, 0, 2.8);
  } else if (kind === 'range') {
    const t = A.prop('target', 1.3);
    t.position.set(2.4, 0, 1.4);
    root.add(t);
    const q = A.prop('bucket_arrows', 0.7);
    q.position.set(-1.8, 0, 2.2);
    root.add(q);
  } else {
    const rack = A.prop('weaponrack', 1.2);
    rack.position.set(-2.0, 0, 1.8);
    root.add(rack);
  }
  return out;
}

/** Treasure chest: returns the lid so it can swing open. */
export function makeChest() {
  const root = A.prop('chest_gold', 1.2);
  let lid: THREE.Object3D = new THREE.Object3D();
  root.traverse((o) => {
    if (o.name === 'chest_gold_lid') lid = o;
  });
  return { root, lid };
}

export function prop(name: string, size: number, axis: 'y' | 'x' | 'z' | 'max' = 'y') {
  return A.prop(name, size, axis);
}
