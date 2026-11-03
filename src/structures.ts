import * as THREE from 'three';
import type { Assets, CharRig } from './assets';
import { GEO, MAT, blobShadow } from './models';
import { bakeStatic } from './world';

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
  kitGeo = layFlat(itemGeometry('shield_round_color', 0.62, false));
  barGeo = layFlat(itemGeometry('Gold_Bar', 0.44, false));
  const bm = a.propMesh('Gold_Bar');
  barMat = (bm?.material as THREE.MeshStandardMaterial | undefined) ?? new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.8, roughness: 0.3 });
}

/** Rotates a geometry so its thinnest side faces up (and its base sits at y = 0). */
function layFlat(g: THREE.BufferGeometry | null) {
  if (!g) return new THREE.BoxGeometry(0.4, 0.1, 0.4);
  g.computeBoundingBox();
  const s = g.boundingBox!.getSize(new THREE.Vector3());
  if (s.x < s.y && s.x <= s.z) g.rotateZ(Math.PI / 2);
  else if (s.z < s.y && s.z < s.x) g.rotateX(Math.PI / 2);
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox!.min.y, 0);
  g.computeVertexNormals();
  return g;
}

let kitGeo: THREE.BufferGeometry | null = null;
let barGeo: THREE.BufferGeometry | null = null;
let barMat: THREE.Material | null = null;
/** A forge kit (a round shield): stacked in the king's arms and on the forge rack. */
export function kitGeometry() {
  return kitGeo!;
}
export function barGeometry() {
  return barGeo!;
}
export function barMaterial() {
  return barMat!;
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
  const char = A.character('hero', 2.35);
  const root = char.root;
  dressAsKing(char);
  // Golden bolts leave from the tip of the royal sword.
  const muzzle = new THREE.Object3D();
  const sword = char.find('1H_Sword');
  if (sword) {
    sword.add(muzzle);
    muzzle.position.set(0, 0.9, 0);
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

/** Crown, red royal cape and gilded armour turn the knight model into the king. */
function dressAsKing(char: CharRig) {
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 0.9, roughness: 0.25, emissive: 0x6a4400, emissiveIntensity: 0.35 });
  const crown = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.31, 0.2, 16, 1, true), gold);
  band.material.side = THREE.DoubleSide;
  crown.add(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), gold);
    spike.position.set(Math.cos(a) * 0.32, 0.19, Math.sin(a) * 0.32);
    crown.add(spike);
    const gem = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe2343b : 0x2f6fd6, roughness: 0.2, emissive: i % 2 ? 0x5a0000 : 0x001a5a }),
    );
    gem.position.set(Math.cos(a) * 0.335, 0.0, Math.sin(a) * 0.335);
    crown.add(gem);
  }
  const head = char.find('head');
  if (head) {
    head.add(crown);
    crown.position.set(0, 1.12, 0);
    crown.scale.setScalar(1.25);
  }
  char.model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.parent === crown || o.parent?.parent === crown) return;
    if (o.name === 'Knight_Cape') {
      m.material = new THREE.MeshStandardMaterial({ color: 0xb3122a, roughness: 0.75 });
      return;
    }
    if (o.name === 'Badge_Shield' || o.name === '1H_Sword') return;
    // Gild the armour: warm tint on a private copy of the material.
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.color.setRGB(1.12, 0.98, 0.72);
    mat.metalness = 0.35;
    mat.roughness = 0.45;
    m.material = mat;
  });
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

/** Building style follows the castle: rough timber until the Stone Keep, then stone. */
export type Era = 'wood' | 'stone';
export const eraFor = (castleLevel: number): Era => (castleLevel >= 3 ? 'stone' : 'wood');

/** A timber lookout platform: up to six archers stand on top; level 2 mounts a ballista. */
export function makeLookout() {
  const root = new THREE.Group();
  // Tall stilts, so archers stand high over the fences.
  const base = A.prop('structure-floor', 2.8, 'max');
  base.scale.y *= 1.9;
  root.add(base);
  const H = new THREE.Box3().setFromObject(base).max.y;
  for (const [x, z] of [
    [-1.3, -1.3],
    [1.3, 1.3],
  ]) {
    const f = A.prop('flag_blue', 1.5);
    f.position.set(x, H, z);
    root.add(f);
  }
  const ballista = A.prop('siege-ballista', 1.4, 'max');
  ballista.position.set(0, H, -0.85);
  ballista.visible = false;
  root.add(ballista);
  const slots: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) slots.push(new THREE.Vector3(((i % 3) - 1) * 0.8, H, i < 3 ? 0.45 : -0.3));
  return { root, ballista, slots, height: H };
}

/** A straight run of fence `len` long along local x: timber palisade, stone fence or castle wall. */
export function makeFenceRun(tier: 'wood' | 'stone' | 'castle', len: number) {
  const stage = new THREE.Group();
  const name = tier === 'wood' ? 'fence-fortified' : tier === 'stone' ? 'fence_stone_straight' : 'wall_straight';
  const want = tier === 'wood' ? 1.25 : tier === 'stone' ? 2.25 : 2.7;
  const n = Math.max(1, Math.round(len / want));
  const piece = len / n;
  for (let i = 0; i < n; i++) {
    const p = A.prop(name, 1, 'max');
    const holder = new THREE.Group();
    holder.add(p);
    const box = new THREE.Box3().setFromObject(holder);
    const sz = box.getSize(new THREE.Vector3());
    if (sz.z > sz.x) p.rotation.y = Math.PI / 2;
    const k = (piece + 0.04) / Math.max(sz.x, sz.z);
    holder.scale.setScalar(tier === 'wood' ? k * 1.15 : k);
    holder.scale.x = k;
    holder.position.x = -len / 2 + piece * (i + 0.5);
    stage.add(holder);
  }
  const g = bakeStatic(stage, [1, 1, 1]);
  return g;
}

/** The castle at each level: a log camp, a wooden hall, a timber fort, a stone keep, a castle, a citadel. */
export function makeCastle(level: number) {
  const root = new THREE.Group();
  const add = (name: string, size: number, x: number, z: number, ry = 0, axis: 'y' | 'max' = 'max') => {
    const o = A.prop(name, size, axis);
    o.position.set(x, 0, z);
    o.rotation.y = ry;
    root.add(o);
    return o;
  };
  switch (level) {
    case 0:
      // Just a few logs, a tent and a campfire.
      add('tent', 2.6, -0.6, -0.4, 0.3);
      add('resource_lumber', 1.4, 1.6, 0.6, 0.8);
      add('resource_lumber', 1.2, -1.9, 1.2, -0.4);
      add('barrel', 0.8, 1.4, -1.2);
      root.add(campfire());
      break;
    case 1:
      add('building_home_B_blue', 4.4, 0, -0.3, Math.PI);
      add('resource_lumber', 1.2, 2.4, 1.4, 0.6);
      root.add(campfire(-2.2, 1.8));
      break;
    case 2:
      add('building_home_A_blue', 5.2, 0, -0.4, Math.PI);
      add('building_home_B_blue', 3.2, -2.9, 1.2, Math.PI + 0.4);
      add('flag_blue', 2.6, -2.6, 2.4, 0, 'y');
      add('flag_blue', 2.6, 2.6, 2.4, 0, 'y');
      break;
    case 3:
      add('building_tower_B_blue', 7.2, 0, -0.6, Math.PI, 'y');
      add('building_home_A_blue', 3.4, -2.6, 0.8, Math.PI);
      add('flag_blue', 2.8, 2.4, 2.4, 0, 'y');
      break;
    case 4:
      add('building_castle_blue', 8.5, 0, 0, 0, 'y');
      add('flag_blue', 2.8, -2.8, 3.4, 0, 'y');
      add('flag_blue', 2.8, 2.8, 3.4, 0, 'y');
      break;
    default:
      add('building_castle_blue', 10, 0, 0, 0, 'y');
      add('building_tower_A_blue', 7, -4.6, -1.4, 0, 'y');
      add('building_tower_A_blue', 7, 4.6, -1.4, 0, 'y');
      add('flag_blue', 3.2, -3.2, 4, 0, 'y');
      add('flag_blue', 3.2, 3.2, 4, 0, 'y');
      break;
  }
  const lamp = new THREE.PointLight(0xffb357, 6, 9, 1.6);
  lamp.position.set(0, 2.2, 3.4);
  root.add(lamp);
  return root;
}

function campfire(x = 0.4, z = 2.0) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6), MAT.woodDark);
    log.rotation.set(Math.PI / 2, (i / 4) * Math.PI * 2, 0.4);
    log.position.y = 0.12;
    g.add(log);
  }
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 7), MAT.fire);
  fire.position.y = 0.35;
  g.add(fire);
  const light = new THREE.PointLight(0xff8a3a, 4, 6, 1.8);
  light.position.y = 0.9;
  g.add(light);
  g.position.set(x, 0, z);
  return g;
}

export interface WorkshopRig {
  root: THREE.Group;
  rack: THREE.Vector3;
  chimney?: THREE.Vector3;
  anim?: THREE.Object3D;
}

export function makeShop(kind: 'range' | 'barracks' | 'forge' | 'bowyer', era: Era = 'stone'): WorkshopRig {
  const root = new THREE.Group();
  const add = (name: string, size: number, x: number, z: number, ry = 0, axis: 'y' | 'max' = 'max') => {
    const o = A.prop(name, size, axis);
    o.position.set(x, 0, z);
    o.rotation.y = ry;
    root.add(o);
    return o;
  };
  const out: WorkshopRig = { root, rack: new THREE.Vector3(0, 0, 2.7) };
  if (era === 'wood') {
    // Rough timber camp versions: tents, lean-tos and workbenches.
    switch (kind) {
      case 'range':
        add('tent', 2.8, 0, -0.6, 0, 'max');
        add('target', 1.3, 2.3, 0.8);
        add('target', 1.3, -2.3, 0.8);
        add('bucket_arrows', 0.7, 0.8, 1.6);
        break;
      case 'barracks':
        add('tent', 2.8, -1.3, -0.4, 0.2);
        add('tent', 2.4, 1.5, -0.8, -0.3);
        add('campfire-pit', 0.9, 0.2, 1.0);
        add('weaponrack', 1.2, 0.4, 1.6);
        out.rack = new THREE.Vector3(0, 0, 2.6);
        break;
      case 'forge':
        add('building_scaffolding', 2.8, 0, -1.0, 0, 'max');
        add('workbench-anvil', 1.1, -0.6, 0.6);
        add('campfire-stand', 1.1, 1.3, 0.4);
        add('weaponrack', 1.2, 0.9, 2.1);
        out.rack = new THREE.Vector3(0.9, 0, 2.6);
        out.chimney = new THREE.Vector3(1.3, 1.2, 0.4);
        break;
      case 'bowyer':
        add('tent', 2.6, 0, -0.8, 0, 'max');
        add('workbench', 1.1, -0.9, 0.8);
        add('resource-planks', 1.2, 1.5, 0.6);
        out.rack = new THREE.Vector3(0.8, 0, 2.6);
        break;
    }
    return out;
  }
  const model = {
    range: 'building_archeryrange_blue',
    barracks: 'building_barracks_blue',
    forge: 'building_blacksmith_blue',
    bowyer: 'building_market_blue',
  }[kind];
  const b = A.prop(model, 4.6, 'max');
  b.rotation.y = Math.PI;
  root.add(b);
  if (kind === 'forge') {
    add('weaponrack', 1.3, 0.9, 2.4, 0, 'y');
    out.rack = new THREE.Vector3(0.9, 0, 2.8);
    out.chimney = new THREE.Vector3(-0.6, 4.2, -0.4);
  } else if (kind === 'bowyer') {
    add('resource_lumber', 1.0, -1.6, 2.2, 0, 'y');
    out.rack = new THREE.Vector3(0.8, 0, 2.8);
  } else if (kind === 'range') {
    add('target', 1.3, 2.4, 1.4, 0, 'y');
    add('bucket_arrows', 0.7, -1.8, 2.2, 0, 'y');
  } else {
    add('weaponrack', 1.2, -2.0, 1.8, 0, 'y');
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

/** Kingdom folk: woodcutters/builders ('worker') and townsfolk/miners ('villager'). */
export function makeNpc(kind: 'worker' | 'villager') {
  const char = A.character(kind, kind === 'worker' ? 1.6 : 1.5);
  char.root.add(blobShadow(0.38));
  char.loop('Idle');
  return char;
}

export function prop(name: string, size: number, axis: 'y' | 'x' | 'z' | 'max' = 'y') {
  return A.prop(name, size, axis);
}
