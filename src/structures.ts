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

/** Puts a weapon model into a character's hand slot; returns its first mesh. */
function arm(char: CharRig, name: string, slot: 'handslotr' | 'handslotl') {
  const src = A.props.get(name);
  const bone = char.find(slot);
  if (!src || !bone) return null;
  const w = src.clone(true);
  w.position.set(0, 0, 0);
  bone.add(w);
  let mesh: THREE.Mesh | null = null;
  w.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    if (!mesh) mesh = m;
  });
  return mesh as THREE.Mesh | null;
}

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
  const sword = arm(char, 'sword_1handed', 'handslotr');
  arm(char, 'shield_badge_color', 'handslotl');
  dressAsKing(char);
  // Golden bolts leave from the tip of the royal sword.
  const muzzle = new THREE.Object3D();
  if (sword) {
    sword.add(muzzle);
    muzzle.position.set(0, 0.7, 0);
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

/** Where the crown sits on the head bone (model units). */
const CROWN = { y: 1.02, s: 1.15 };

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
    crown.position.set(0, CROWN.y, 0);
    crown.scale.setScalar(CROWN.s);
  }
  char.model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.parent === crown || o.parent?.parent === crown) return;
    if (o.name === 'Knight_Cape') {
      m.material = new THREE.MeshStandardMaterial({ color: 0xb3122a, roughness: 0.75 });
      return;
    }
    if (o.name === 'Badge_Shield' || o.name === '1H_Sword' || o.parent?.name?.startsWith('handslot')) return;
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
  const char = A.character(type, type === 'archer' ? 1.7 : 1.8);
  const weapon = type === 'archer' ? arm(char, 'bow_withString', 'handslotl') : arm(char, 'sword_1handed', 'handslotr');
  if (type === 'knight') arm(char, 'shield_badge_color', 'handslotl');
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

/**
 * Height of the walkable top of a model at its centre: casts down from above at a few points and
 * takes the lowest hit, so thin flag poles and spires are ignored.
 */
function standHeight(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  const ray = new THREE.Raycaster();
  const hits: number[] = [];
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * 0.15;
  for (const [dx, dz] of [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ]) {
    ray.set(new THREE.Vector3(c.x + dx, box.max.y + 1, c.z + dz), new THREE.Vector3(0, -1, 0));
    const h = ray.intersectObject(o, true)[0];
    if (h) hits.push(h.point.y);
  }
  hits.sort((x, y) => x - y);
  return hits.length ? hits[Math.floor(hits.length / 2)] : box.max.y;
}

/** A watchtower archers climb onto: timber scaffolding, stone in the stone era. Level 2 adds a ballista. */
export function makeLookout(era: Era = 'wood', level = 0) {
  const root = new THREE.Group();
  const name = era === 'wood' ? `WatchTower_FirstAge_Level${level ? 3 : 2}` : `WatchTower_SecondAge_Level${level ? 3 : 1}`;
  const base = A.prop(name, 5.6, 'y');
  root.add(base);
  const H = standHeight(base);
  const ballista = A.prop('siege-ballista', 1.2, 'max');
  ballista.position.set(0, H, -0.35);
  ballista.visible = level > 0;
  root.add(ballista);
  // Archers stand close together on the top floor.
  const slots: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) slots.push(new THREE.Vector3(((i % 3) - 1) * 0.42, H, i < 3 ? 0.3 : -0.2));
  return { root, ballista, slots, height: H };
}

/** A straight run of wall `len` long along local x: timber planks, then stone. */
export function makeFenceRun(tier: 'wood' | 'stone' | 'castle', len: number) {
  const stage = new THREE.Group();
  const name = tier === 'wood' ? 'Wall_FirstAge' : 'Wall_SecondAge';
  const want = tier === 'wood' ? 2.2 : 2.5;
  const n = Math.max(1, Math.round(len / want));
  const piece = len / n;
  for (let i = 0; i < n; i++) {
    const p = A.prop(name, 1, 'x');
    const holder = new THREE.Group();
    holder.add(p);
    // Long side along x, a little taller than the model so it reads as a proper wall.
    // The source walls are thin and low at this scale: make them chest-high and chunky.
    if (tier === 'wood') holder.scale.set(piece + 0.05, 4.2, 5);
    else holder.scale.set(piece + 0.05, tier === 'castle' ? 6.6 : 5.6, 2.4);
    holder.position.x = -len / 2 + piece * (i + 0.5);
    stage.add(holder);
  }
  return bakeStatic(stage, [1, 1, 1]);
}

/** The keep, level by level: a fenced campfire, a timber hall, a great hall, a wooden fort, a castle, a fortress. */
const KEEP_MODELS: [string, number, 'y' | 'max'][] = [
  ['TownCenter_FirstAge_Level1', 4.6, 'max'],
  ['Barracks_FirstAge_Level1', 5.6, 'max'],
  ['Temple_FirstAge_Level1', 6.6, 'y'],
  ['Wonder_FirstAge_Level3', 9, 'max'],
  ['Temple_SecondAge_Level3', 8.6, 'y'],
  ['Wonder_SecondAge_Level3', 11, 'max'],
];

export function makeCastle(level: number) {
  const root = new THREE.Group();
  const [name, size, axis] = KEEP_MODELS[Math.min(level, KEEP_MODELS.length - 1)];
  const o = A.prop(name, size, axis);
  root.add(o);
  if (level === 0) root.add(campfire(0, 0.2));
  const lamp = new THREE.PointLight(0xffb357, 6, 9, 1.6);
  lamp.position.set(0, 2.2, 3.4);
  root.add(lamp);
  return root;
}

function campfire(x = 0.4, z = 2.0) {
  const g = new THREE.Group();
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

/** Workshops grow with their own level (1-3) and switch to stone with the castle. */
export function makeShop(kind: 'range' | 'barracks' | 'forge' | 'bowyer', era: Era = 'wood', level = 1): WorkshopRig {
  const root = new THREE.Group();
  const out: WorkshopRig = { root, rack: new THREE.Vector3(0, 0, 2.8) };
  const age = era === 'wood' ? 'FirstAge' : 'SecondAge';
  const lv = Math.max(1, Math.min(3, level));
  let model: THREE.Object3D;
  if (kind === 'forge') {
    model = A.prop('Blacksmith', 4.4 + lv * 0.3, 'max');
    out.rack = new THREE.Vector3(1.2, 0, 2.8);
    out.chimney = new THREE.Vector3(-0.8, 3.4, -0.6);
  } else {
    const base = kind === 'range' ? 'Archery' : 'Barracks';
    model = A.prop(`${base}_${age}_Level${lv}`, 4.2 + lv * 0.5, 'max');
  }
  root.add(model);
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

/** Townsfolk who move into claimed land. */
export function makeNpc(kind: 'villager') {
  const char = A.character(kind, 1.5);
  char.root.add(blobShadow(0.38));
  char.loop('Idle');
  return char;
}

export function prop(name: string, size: number, axis: 'y' | 'x' | 'z' | 'max' = 'y') {
  return A.prop(name, size, axis);
}
