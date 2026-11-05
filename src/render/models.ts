// Procedural low-poly models. Every unit and structure is assembled from boxes, cylinders and
// spheres, merged into one geometry per part (hull, team-coloured bits, turret, rotor).
// Model space: forward is +X, up is +Y. One world unit = one map cell.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FactionDef } from '../core/types';

type Color = number | 'team';
type Shape = 'box' | 'cyl' | 'sphere' | 'cone' | 'wedge' | 'ring';
export type PartName = 'hull' | 'turret' | 'rotor' | 'rotor2' | 'dish';

interface Part {
  shape: Shape;
  size: [number, number, number];
  pos: [number, number, number];
  rot?: [number, number, number];
  color: Color;
  part: PartName;
  segs?: number;
}

export interface ModelDef {
  hull: THREE.BufferGeometry | null;
  team: THREE.BufferGeometry | null;
  turret: { geo: THREE.BufferGeometry | null; team: THREE.BufferGeometry | null; pivot: [number, number, number] } | null;
  rotor: { geo: THREE.BufferGeometry; pivot: [number, number, number] } | null;
  rotor2: { geo: THREE.BufferGeometry; pivot: [number, number, number] } | null;
  dish: { geo: THREE.BufferGeometry; pivot: [number, number, number] } | null;
  height: number;
}

const C = {
  dark: 0x2b2b2b, steel: 0x6d7278, gun: 0x3a3d40, glass: 0x8fc6e8, skin: 0xe0b48c, tire: 0x1f1f1f, rust: 0x7a4b2a,
  sand: 0xd9c38a, concrete: 0xa9a59a, concreteDark: 0x7d7a72, red: 0xd33b2f, yellow: 0xf2c230, orange: 0xf08a24,
  white: 0xf0f0f0, olive: 0x6b7a4a, brown: 0x6b4a2a, wood: 0x9c7a4a, tarp: 0x5a7f4a, warn: 0xf2c230, black: 0x141414,
  green: 0x3fae4a, blue: 0x3b7bd8, lightGrey: 0xc5c5c0, darkGreen: 0x3c5a2a, bag: 0xb7a37a, pipe: 0x8a8f94,
};

class Kit {
  parts: Part[] = [];
  private cur: PartName = 'hull';
  turretPivot: [number, number, number] | null = null;
  rotorPivot: [number, number, number] | null = null;
  rotor2Pivot: [number, number, number] | null = null;
  dishPivot: [number, number, number] | null = null;
  height = 1;
  use(p: PartName, pivot?: [number, number, number]) {
    this.cur = p;
    if (pivot) {
      if (p === 'turret') this.turretPivot = pivot;
      if (p === 'rotor') this.rotorPivot = pivot;
      if (p === 'rotor2') this.rotor2Pivot = pivot;
      if (p === 'dish') this.dishPivot = pivot;
    }
    return this;
  }
  add(shape: Shape, size: [number, number, number], pos: [number, number, number], color: Color, rot?: [number, number, number], segs?: number) {
    this.parts.push({ shape, size, pos, rot, color, part: this.cur, segs });
    this.height = Math.max(this.height, pos[1] + size[1] / 2);
    return this;
  }
  box(sx: number, sy: number, sz: number, x: number, y: number, z: number, color: Color, rot?: [number, number, number]) {
    return this.add('box', [sx, sy, sz], [x, y, z], color, rot);
  }
  cyl(r: number, h: number, x: number, y: number, z: number, color: Color, rot?: [number, number, number], segs = 10) {
    return this.add('cyl', [r, h, r], [x, y, z], color, rot, segs);
  }
  /** Horizontal cylinder along +X (barrels). */
  barrel(r: number, len: number, x: number, y: number, z: number, color: Color = C.gun) {
    return this.add('cyl', [r, len, r], [x, y, z], color, [0, 0, -Math.PI / 2], 8);
  }
  sphere(r: number, x: number, y: number, z: number, color: Color, segs = 8) {
    return this.add('sphere', [r, r, r], [x, y, z], color, undefined, segs);
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: Color, rot?: [number, number, number], segs = 8) {
    return this.add('cone', [r, h, r], [x, y, z], color, rot, segs);
  }
  wedge(sx: number, sy: number, sz: number, x: number, y: number, z: number, color: Color, rot?: [number, number, number]) {
    return this.add('wedge', [sx, sy, sz], [x, y, z], color, rot);
  }
  wheel(r: number, w: number, x: number, y: number, z: number) {
    return this.add('cyl', [r, w, r], [x, y, z], C.tire, [Math.PI / 2, 0, 0], 10);
  }
  wheels(r: number, w: number, xs: number[], y: number, halfWidth: number) {
    for (const x of xs) {
      this.wheel(r, w, x, y, halfWidth);
      this.wheel(r, w, x, y, -halfWidth);
    }
    return this;
  }
  tracks(len: number, h: number, w: number, y: number, halfWidth: number, color: Color = C.dark) {
    this.box(len, h, w, 0, y, halfWidth, color);
    this.box(len, h, w, 0, y, -halfWidth, color);
    return this;
  }
}

function makeShape(p: Part): THREE.BufferGeometry {
  const [sx, sy, sz] = p.size;
  let g: THREE.BufferGeometry;
  switch (p.shape) {
    case 'box':
      g = new THREE.BoxGeometry(sx, sy, sz);
      break;
    case 'cyl':
      g = new THREE.CylinderGeometry(sx, sz, sy, p.segs ?? 10);
      break;
    case 'sphere':
      g = new THREE.SphereGeometry(sx, p.segs ?? 8, Math.max(4, Math.round((p.segs ?? 8) * 0.75)));
      break;
    case 'cone':
      g = new THREE.ConeGeometry(sx, sy, p.segs ?? 8);
      break;
    case 'ring':
      g = new THREE.TorusGeometry(sx, sz, 6, 16);
      g.rotateX(Math.PI / 2);
      break;
    case 'wedge': {
      // Triangular prism: full height at -X, zero at +X.
      const shape = new THREE.Shape();
      shape.moveTo(-sx / 2, -sy / 2);
      shape.lineTo(sx / 2, -sy / 2);
      shape.lineTo(-sx / 2, sy / 2);
      shape.lineTo(-sx / 2, -sy / 2);
      g = new THREE.ExtrudeGeometry(shape, { depth: sz, bevelEnabled: false });
      g.translate(0, 0, -sz / 2);
      break;
    }
  }
  if (p.rot) g.rotateX(p.rot[0]), g.rotateY(p.rot[1]), g.rotateZ(p.rot[2]);
  g.translate(p.pos[0], p.pos[1], p.pos[2]);
  return g;
}

function colorize(g: THREE.BufferGeometry, color: number) {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  // Slight per-face shade variation keeps flat colours from looking plastic.
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function merge(parts: Part[], pivot: [number, number, number] | null): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const geos = parts.map((p) => {
    const g = makeShape(p).toNonIndexed();
    if (pivot) g.translate(-pivot[0], -pivot[1], -pivot[2]);
    return colorize(g, p.color === 'team' ? 0xffffff : p.color);
  });
  const m = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  m.computeVertexNormals();
  return m;
}

function finish(k: Kit): ModelDef {
  const by = (part: PartName, team: boolean) => k.parts.filter((p) => p.part === part && (p.color === 'team') === team);
  const def: ModelDef = {
    hull: merge(by('hull', false), null),
    team: merge(by('hull', true), null),
    turret: null,
    rotor: null,
    rotor2: null,
    dish: null,
    height: k.height,
  };
  if (k.turretPivot) def.turret = { geo: merge(by('turret', false), k.turretPivot), team: merge(by('turret', true), k.turretPivot), pivot: k.turretPivot };
  if (k.rotorPivot) {
    const g = merge(by('rotor', false), k.rotorPivot);
    if (g) def.rotor = { geo: g, pivot: k.rotorPivot };
  }
  if (k.rotor2Pivot) {
    const g = merge(by('rotor2', false), k.rotor2Pivot);
    if (g) def.rotor2 = { geo: g, pivot: k.rotor2Pivot };
  }
  if (k.dishPivot) {
    const g = merge(by('dish', false), k.dishPivot);
    if (g) def.dish = { geo: g, pivot: k.dishPivot };
  }
  return def;
}

// ------------------------------------------------------------------------------------------- units
function soldier(k: Kit, cloth: Color, helmet: Color | null, opts: { tube?: boolean; longRifle?: boolean; wrap?: boolean; vest?: boolean; laptop?: boolean; tool?: boolean } = {}) {
  k.box(0.22, 0.42, 0.3, 0, 0.6, 0, cloth); // torso
  k.box(0.09, 0.4, 0.1, 0, 0.2, 0.08, C.dark); // legs
  k.box(0.09, 0.4, 0.1, 0, 0.2, -0.08, C.dark);
  k.sphere(0.12, 0, 0.95, 0, C.skin, 7);
  if (helmet !== null) k.box(0.27, 0.12, 0.3, 0, 1.03, 0, helmet);
  if (opts.wrap) k.box(0.26, 0.1, 0.28, 0, 1.0, 0, C.white);
  if (opts.vest) k.box(0.26, 0.3, 0.33, 0, 0.62, 0, C.olive);
  k.box(0.08, 0.3, 0.08, 0.02, 0.62, 0.2, cloth); // arms
  k.box(0.08, 0.3, 0.08, 0.02, 0.62, -0.2, cloth);
  if (opts.longRifle) k.box(0.9, 0.05, 0.05, 0.4, 0.7, 0.12, C.gun);
  else if (!opts.tool && !opts.laptop) k.box(0.55, 0.06, 0.06, 0.3, 0.7, 0.12, C.gun);
  if (opts.tube) k.cyl(0.07, 0.75, 0.05, 0.98, -0.16, C.darkGreen, [0, 0, -Math.PI / 2]);
  if (opts.tool) k.box(0.1, 0.5, 0.05, 0.2, 0.55, 0.18, C.wood);
  if (opts.laptop) k.box(0.26, 0.03, 0.2, 0.3, 0.42, 0, C.lightGrey);
  k.height = 1.1;
}

function tankBase(k: Kit, hull: Color, len = 1.8, w = 1.2, h = 0.5) {
  k.tracks(len * 1.02, h * 0.9, w * 0.28, h * 0.45, w * 0.4);
  k.box(len, h * 0.8, w * 0.62, 0, h * 0.75, 0, hull);
  k.box(len * 0.6, h * 0.35, w * 0.9, -0.1, h * 1.25, 0, hull);
}

const unitBuilders: Record<string, (k: Kit, s: FactionDef['style']) => void> = {
  soldier: (k) => soldier(k, 'team', C.olive),
  rocketsoldier: (k) => soldier(k, 'team', C.olive, { tube: true }),
  sniper: (k) => soldier(k, C.darkGreen, C.darkGreen, { longRifle: true }),
  hacker: (k) => soldier(k, 'team', null, { laptop: true }),
  lotus: (k) => soldier(k, C.black, null, {}),
  worker: (k) => soldier(k, C.sand, null, { tool: true }),
  rebel: (k) => soldier(k, 'team', null, { wrap: true }),
  runner: (k) => soldier(k, 'team', null, { vest: true, wrap: true }),
  mob: (k) => {
    const offs: [number, number][] = [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]];
    offs.forEach(([x, z], i) => {
      const sub = new Kit();
      soldier(sub, i % 2 ? 'team' : C.brown, null, { wrap: i % 3 === 0 });
      for (const p of sub.parts) k.parts.push({ ...p, pos: [p.pos[0] + x, p.pos[1], p.pos[2] + z] });
    });
    k.height = 1.1;
  },
  dozer: (k) => {
    k.tracks(1.3, 0.45, 0.32, 0.25, 0.42);
    k.box(1.1, 0.4, 0.7, -0.05, 0.6, 0, C.yellow);
    k.box(0.5, 0.45, 0.6, -0.25, 1.0, 0, 'team');
    k.box(0.45, 0.3, 0.55, -0.25, 1.05, 0, C.glass);
    k.box(0.12, 0.5, 1.2, 0.85, 0.45, 0, C.steel);
    k.box(0.5, 0.06, 0.06, 0.55, 0.6, 0.2, C.steel);
    k.box(0.5, 0.06, 0.06, 0.55, 0.6, -0.2, C.steel);
  },
  humvee: (k) => {
    k.wheels(0.22, 0.18, [0.5, -0.5], 0.22, 0.46);
    k.box(1.6, 0.4, 0.9, 0, 0.5, 0, 'team');
    k.box(0.9, 0.35, 0.86, -0.2, 0.85, 0, C.steel);
    k.box(0.5, 0.25, 0.8, -0.1, 0.9, 0, C.glass);
    k.use('turret', [-0.2, 1.05, 0]).cyl(0.14, 0.12, -0.2, 1.05, 0, C.gun).barrel(0.04, 0.6, 0.15, 1.1, 0);
  },
  tank: (k, s) => {
    tankBase(k, s.hull);
    k.use('turret', [-0.1, 0.95, 0]).box(0.85, 0.35, 0.8, -0.15, 1.0, 0, s.hull).box(0.3, 0.1, 0.5, -0.4, 1.2, 0, 'team').barrel(0.06, 1.1, 0.65, 1.0, 0);
  },
  paladin: (k, s) => {
    tankBase(k, s.hull, 2.0, 1.3, 0.55);
    k.use('turret', [-0.1, 1.05, 0]).box(1.0, 0.4, 0.9, -0.15, 1.1, 0, s.hull).sphere(0.2, -0.3, 1.4, 0.25, C.glass).box(0.4, 0.1, 0.5, -0.4, 1.32, -0.15, 'team').barrel(0.07, 1.2, 0.7, 1.1, 0);
  },
  tomahawk: (k) => {
    k.wheels(0.22, 0.2, [0.6, 0, -0.6], 0.22, 0.5);
    k.box(1.9, 0.35, 0.95, 0, 0.5, 0, 'team');
    k.box(0.5, 0.4, 0.9, 0.6, 0.85, 0, C.steel);
    k.use('turret', [-0.3, 0.9, 0]).box(1.2, 0.45, 0.6, -0.3, 1.05, 0, C.olive, [0, 0, 0.35]).box(0.3, 0.1, 0.5, -0.7, 0.95, 0, 'team');
  },
  gunship: (k) => {
    k.box(1.6, 0.45, 0.5, 0, 0.5, 0, 'team');
    k.box(0.6, 0.35, 0.4, 0.5, 0.75, 0, C.glass);
    k.box(1.3, 0.14, 0.14, -1.2, 0.6, 0, C.steel);
    k.box(0.1, 0.4, 0.08, -1.8, 0.8, 0, C.steel);
    k.box(0.1, 0.05, 0.35, -1.8, 0.95, 0, 'team');
    k.box(1.2, 0.06, 0.06, 0, 0.1, 0.3, C.steel);
    k.box(1.2, 0.06, 0.06, 0, 0.1, -0.3, C.steel);
    k.barrel(0.05, 0.5, 0.7, 0.35, 0);
    k.box(0.3, 0.12, 0.2, 0.1, 0.4, 0.45, C.gun);
    k.box(0.3, 0.12, 0.2, 0.1, 0.4, -0.45, C.gun);
    k.use('rotor', [0, 0.85, 0]).box(2.4, 0.03, 0.12, 0, 0.85, 0, C.dark).box(0.12, 0.03, 2.4, 0, 0.85, 0, C.dark);
    k.height = 1.1;
  },
  jet: (k) => {
    k.cyl(0.2, 1.9, 0, 0.5, 0, C.lightGrey, [0, 0, -Math.PI / 2], 8);
    k.cone(0.2, 0.5, 1.15, 0.5, 0, C.lightGrey, [0, 0, -Math.PI / 2]);
    k.box(0.5, 0.18, 0.25, 0.4, 0.65, 0, C.glass);
    k.wedge(1.0, 1.6, 0.06, -0.1, 0.5, 0, 'team', [Math.PI / 2, 0, 0]);
    k.wedge(0.5, 0.8, 0.05, -0.8, 0.5, 0, C.lightGrey, [Math.PI / 2, 0, 0]);
    k.wedge(0.5, 0.55, 0.05, -0.75, 0.75, 0, 'team', [0, 0, 0]);
    k.height = 1.0;
  },
  bomber: (k) => {
    k.box(2.6, 0.35, 0.5, 0, 0.5, 0, C.dark);
    k.cone(0.2, 0.6, 1.5, 0.5, 0, C.dark, [0, 0, -Math.PI / 2]);
    k.wedge(2.2, 3.0, 0.08, -0.3, 0.5, 0, C.dark, [Math.PI / 2, 0, 0]);
    k.box(0.5, 0.04, 0.3, -0.6, 0.55, 1.2, 'team');
    k.box(0.5, 0.04, 0.3, -0.6, 0.55, -1.2, 'team');
    k.box(0.3, 0.14, 0.4, 0.8, 0.62, 0, C.glass);
    k.height = 1.0;
  },
  chinook: (k) => {
    k.box(2.6, 0.7, 0.9, 0, 0.6, 0, 'team');
    k.box(0.6, 0.4, 0.8, 1.3, 0.8, 0, C.glass);
    k.box(0.5, 0.45, 0.4, -0.9, 1.15, 0, C.steel);
    k.box(0.5, 0.45, 0.4, 0.9, 1.15, 0, C.steel);
    k.wheels(0.12, 0.1, [0.9, -0.9], 0.15, 0.4);
    k.use('rotor', [0.9, 1.4, 0]).box(2.4, 0.03, 0.12, 0.9, 1.4, 0, C.dark).box(0.12, 0.03, 2.4, 0.9, 1.4, 0, C.dark);
    k.use('rotor2', [-0.9, 1.4, 0]).box(2.4, 0.03, 0.12, -0.9, 1.4, 0, C.dark).box(0.12, 0.03, 2.4, -0.9, 1.4, 0, C.dark);
    k.height = 1.5;
  },
  truck: (k) => {
    k.wheels(0.22, 0.18, [0.55, -0.5], 0.22, 0.45);
    k.box(0.6, 0.6, 0.85, 0.5, 0.65, 0, 'team');
    k.box(0.3, 0.3, 0.8, 0.6, 0.85, 0, C.glass);
    k.box(1.1, 0.5, 0.9, -0.35, 0.6, 0, C.olive);
    k.box(0.5, 0.3, 0.5, -0.35, 0.95, 0, C.wood);
  },
  gatling: (k, s) => {
    tankBase(k, s.hull, 1.7, 1.2, 0.5);
    k.use('turret', [-0.1, 0.95, 0]).box(0.8, 0.4, 0.7, -0.15, 1.0, 0, s.hull).box(0.3, 0.1, 0.5, -0.4, 1.22, 0, 'team');
    for (let i = 0; i < 4; i++) k.barrel(0.04, 0.9, 0.5, 1.05 + Math.sin((i / 4) * 6.28) * 0.07, Math.cos((i / 4) * 6.28) * 0.07);
  },
  flametank: (k, s) => {
    tankBase(k, s.hull, 1.7, 1.2, 0.5);
    k.cyl(0.18, 0.7, -0.5, 1.05, 0.25, C.red, [Math.PI / 2, 0, 0]);
    k.cyl(0.18, 0.7, -0.5, 1.05, -0.25, C.red, [Math.PI / 2, 0, 0]);
    k.use('turret', [0, 0.9, 0]).box(0.6, 0.3, 0.5, 0, 0.95, 0, s.hull).barrel(0.08, 0.8, 0.5, 0.95, 0, C.dark).box(0.2, 0.08, 0.4, -0.2, 1.14, 0, 'team');
  },
  infernocannon: (k) => {
    k.wheels(0.24, 0.2, [0.6, -0.6], 0.24, 0.5);
    k.box(1.9, 0.35, 0.95, 0, 0.5, 0, 'team');
    k.box(0.5, 0.4, 0.9, 0.65, 0.85, 0, C.steel);
    k.use('turret', [-0.4, 0.85, 0]).box(0.5, 0.3, 0.6, -0.4, 0.85, 0, C.gun).barrel(0.12, 1.6, 0.2, 1.3, 0, C.red).box(0.3, 0.1, 0.3, -0.5, 1.05, 0, 'team');
  },
  overlord: (k, s) => {
    tankBase(k, s.hull, 2.8, 2.0, 0.8);
    k.box(0.6, 0.3, 1.4, -0.9, 1.6, 0, 'team');
    k.use('turret', [-0.2, 1.55, 0]).box(1.4, 0.55, 1.3, -0.2, 1.65, 0, s.hull).barrel(0.09, 1.6, 0.9, 1.65, 0.3).barrel(0.09, 1.6, 0.9, 1.65, -0.3).box(0.4, 0.1, 0.6, -0.6, 1.95, 0, 'team');
  },
  nukecannon: (k) => {
    k.wheels(0.26, 0.22, [0.8, 0, -0.8], 0.26, 0.55);
    k.box(2.4, 0.4, 1.0, 0, 0.55, 0, 'team');
    k.box(0.5, 0.4, 0.9, 0.95, 0.9, 0, C.steel);
    k.use('turret', [-0.5, 0.95, 0]).box(0.8, 0.5, 0.8, -0.5, 1.0, 0, C.gun).barrel(0.16, 2.4, 0.3, 1.5, 0, C.steel).sphere(0.22, -0.9, 1.1, 0, C.yellow);
  },
  helix: (k) => {
    k.box(2.0, 0.9, 1.0, 0, 0.7, 0, 'team');
    k.box(0.6, 0.5, 0.9, 1.1, 0.85, 0, C.glass);
    k.box(1.4, 0.2, 0.2, -1.5, 0.9, 0, C.steel);
    k.box(0.1, 0.5, 0.1, -2.1, 1.15, 0, C.steel);
    k.box(0.4, 0.2, 0.25, 0.2, 0.3, 0.6, C.gun);
    k.box(0.4, 0.2, 0.25, 0.2, 0.3, -0.6, C.gun);
    k.use('rotor', [0, 1.3, 0]).box(3.0, 0.04, 0.15, 0, 1.3, 0, C.dark).box(0.15, 0.04, 3.0, 0, 1.3, 0, C.dark);
    k.use('rotor2', [0, 1.45, 0]).box(3.0, 0.04, 0.15, 0, 1.45, 0, C.dark, [0, 0.78, 0]).box(0.15, 0.04, 3.0, 0, 1.45, 0, C.dark, [0, 0.78, 0]);
    k.height = 1.5;
  },
  mig: (k) => {
    k.cyl(0.2, 2.0, 0, 0.5, 0, C.steel, [0, 0, -Math.PI / 2], 8);
    k.cone(0.2, 0.6, 1.25, 0.5, 0, C.steel, [0, 0, -Math.PI / 2]);
    k.box(0.5, 0.18, 0.25, 0.4, 0.65, 0, C.glass);
    k.wedge(1.2, 1.9, 0.06, -0.2, 0.5, 0, C.steel, [Math.PI / 2, 0, 0]);
    k.box(0.3, 0.05, 0.3, -0.5, 0.52, 0.8, 'team');
    k.box(0.3, 0.05, 0.3, -0.5, 0.52, -0.8, 'team');
    k.wedge(0.5, 0.6, 0.05, -0.8, 0.75, 0, 'team', [0, 0, 0]);
    k.height = 1.0;
  },
  technical: (k) => {
    k.wheels(0.2, 0.16, [0.5, -0.45], 0.2, 0.42);
    k.box(0.6, 0.45, 0.8, 0.35, 0.55, 0, 'team');
    k.box(0.35, 0.3, 0.75, 0.4, 0.85, 0, C.glass);
    k.box(0.8, 0.3, 0.8, -0.4, 0.5, 0, C.rust);
    k.use('turret', [-0.4, 0.75, 0]).cyl(0.1, 0.2, -0.4, 0.75, 0, C.gun).barrel(0.04, 0.7, 0, 0.85, 0);
  },
  scorpion: (k, s) => {
    tankBase(k, s.hull, 1.6, 1.1, 0.42);
    k.box(0.3, 0.1, 0.9, -0.5, 0.8, 0, 'team');
    k.use('turret', [-0.1, 0.8, 0]).box(0.7, 0.3, 0.6, -0.1, 0.85, 0, s.hull).barrel(0.05, 1.0, 0.55, 0.85, 0).box(0.25, 0.08, 0.3, -0.3, 1.04, 0, 'team');
  },
  marauder: (k, s) => {
    tankBase(k, s.hull, 2.0, 1.4, 0.55);
    k.box(0.4, 0.3, 0.3, -0.7, 1.15, 0.4, C.rust);
    k.box(0.4, 0.3, 0.3, -0.7, 1.15, -0.4, C.rust);
    k.use('turret', [-0.1, 1.05, 0]).box(1.0, 0.45, 0.9, -0.1, 1.1, 0, C.rust).box(0.3, 0.12, 0.5, -0.4, 1.38, 0, 'team').barrel(0.08, 1.3, 0.7, 1.1, 0);
  },
  quad: (k) => {
    k.wheels(0.22, 0.18, [0.5, -0.5], 0.22, 0.45);
    k.box(1.5, 0.4, 0.9, 0, 0.5, 0, 'team');
    k.box(0.45, 0.35, 0.85, 0.5, 0.85, 0, C.steel);
    k.use('turret', [-0.3, 0.85, 0]).box(0.5, 0.3, 0.6, -0.3, 0.9, 0, C.gun);
    for (const z of [0.18, -0.18]) for (const y of [0.92, 1.08]) k.barrel(0.04, 0.9, 0.2, y, z);
  },
  buggy: (k) => {
    k.wheels(0.2, 0.16, [0.45, -0.45], 0.2, 0.42);
    k.box(1.3, 0.3, 0.7, 0, 0.42, 0, 'team');
    k.box(0.4, 0.25, 0.6, 0.3, 0.65, 0, C.glass);
    k.use('turret', [-0.35, 0.7, 0]).box(0.6, 0.35, 0.7, -0.35, 0.8, 0, C.gun, [0, 0, 0.3]);
  },
  toxintractor: (k) => {
    k.wheels(0.3, 0.2, [-0.45], 0.3, 0.45);
    k.wheels(0.18, 0.14, [0.6], 0.18, 0.4);
    k.box(1.2, 0.4, 0.7, 0.1, 0.6, 0, 'team');
    k.cyl(0.4, 0.8, -0.3, 1.0, 0, C.green, undefined, 10);
    k.use('turret', [0.4, 0.8, 0]).barrel(0.06, 0.9, 0.8, 0.85, 0, C.green);
  },
  bombtruck: (k) => {
    k.wheels(0.22, 0.18, [0.55, -0.5], 0.22, 0.45);
    k.box(0.6, 0.6, 0.85, 0.5, 0.65, 0, 'team');
    k.box(0.3, 0.3, 0.8, 0.6, 0.85, 0, C.glass);
    k.box(1.1, 0.35, 0.9, -0.35, 0.5, 0, C.rust);
    for (const z of [-0.25, 0.25]) for (const x of [-0.6, -0.1]) k.cyl(0.15, 0.4, x, 0.85, z, C.red);
  },
  scud: (k) => {
    k.wheels(0.26, 0.22, [0.9, 0.3, -0.3, -0.9], 0.26, 0.55);
    k.box(2.8, 0.4, 1.0, 0, 0.55, 0, 'team');
    k.box(0.6, 0.4, 0.9, 1.1, 0.9, 0, C.steel);
    k.cyl(0.18, 2.4, -0.6, 1.5, 0, C.olive, [0, 0, 0.25]);
    k.cone(0.18, 0.5, -0.95, 2.85, 0, C.red, [0, 0, 0.25]);
  },
};

// --------------------------------------------------------------------------------------- buildings
function slab(k: Kit, w: number, d: number, color: number) {
  k.box(w, 0.2, d, 0, 0.1, 0, color);
}
function antenna(k: Kit, x: number, z: number, h: number) {
  k.cyl(0.04, h, x, h / 2, z, C.steel, undefined, 6);
  k.sphere(0.1, x, h, z, C.red, 6);
}
function flag(k: Kit, x: number, y: number, z: number) {
  k.cyl(0.04, 1.6, x, y + 0.8, z, C.steel, undefined, 6);
  k.box(0.5, 0.3, 0.03, x + 0.27, y + 1.45, z, 'team');
}
function crates(k: Kit, x: number, z: number, n: number) {
  for (let i = 0; i < n; i++) k.box(0.6, 0.6, 0.6, x + (i % 2) * 0.7, 0.3 + Math.floor(i / 2) * 0.6, z + (i % 3) * 0.1, i % 2 ? C.wood : C.olive);
}
function sandbags(k: Kit, r: number, segs: number) {
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    k.box(0.5, 0.35, 0.3, Math.cos(a) * r, 0.17, Math.sin(a) * r, C.bag, [0, -a, 0]);
  }
}

const buildingBuilders: Record<string, (k: Kit, s: FactionDef['style'], w: number, d: number) => void> = {
  command: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.7, 1.4, d * 0.7, 0, 0.9, 0, s.roof);
    k.box(w * 0.4, 1.3, d * 0.4, 0, 2.2, 0, s.hull);
    k.box(w * 0.3, 0.6, d * 0.3, 0, 3.1, 0, s.accent);
    k.box(w * 0.2, 0.8, 0.3, 0, 1.0, d * 0.36, C.glass);
    antenna(k, w * 0.28, -d * 0.28, 3.4);
    antenna(k, -w * 0.28, -d * 0.28, 2.6);
    k.use('dish', [w * 0.25, 3.5, d * 0.25]).cyl(0.6, 0.1, w * 0.25, 3.5, d * 0.25, C.lightGrey, [0.6, 0, 0], 10);
    flag(k, -w * 0.3, 0.2, d * 0.3);
    flag(k, w * 0.3, 0.2, d * 0.3);
  },
  reactor: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.cyl(w * 0.3, 1.2, 0, 0.8, 0, s.hull, undefined, 14);
    k.sphere(w * 0.3, 0, 1.4, 0, s.accent, 12);
    for (let i = 0; i < 4; i++) k.box(0.25, 1.4, 0.8, Math.cos(i * 1.57) * w * 0.38, 0.9, Math.sin(i * 1.57) * w * 0.38, C.steel, [0, -i * 1.57, 0]);
    k.box(0.6, 0.6, 0.8, w * 0.3, 0.5, d * 0.3, s.roof);
    k.cyl(0.1, 2.2, -w * 0.32, 1.2, d * 0.32, C.pipe, undefined, 6);
  },
  nukereactor: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.add('cyl', [w * 0.22, 2.6, w * 0.3], [w * 0.15, 1.4, 0], C.concrete, undefined, 14);
    k.box(0.1, 0.3, 2 * w * 0.24, w * 0.15, 1.6, 0, s.accent);
    k.box(w * 0.4, 0.9, d * 0.5, -w * 0.28, 0.6, 0, s.hull);
    k.box(w * 0.2, 0.4, d * 0.3, -w * 0.28, 1.25, 0, s.accent);
    k.sphere(0.25, -w * 0.28, 1.45, 0, C.yellow, 6);
  },
  barracks: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.85, 1.1, d * 0.6, 0, 0.75, 0, s.hull);
    k.wedge(d * 0.6, 0.5, w * 0.87, 0, 1.3, 0, s.roof, [0, Math.PI / 2, 0]);
    k.wedge(d * 0.6, 0.5, w * 0.87, 0, 1.3, 0, s.roof, [0, -Math.PI / 2, 0]);
    k.box(0.8, 0.8, 0.1, 0, 0.6, d * 0.3, C.dark);
    k.box(0.3, 0.2, 0.05, w * 0.3, 1.0, d * 0.3, 'team');
    k.box(0.3, 0.2, 0.05, -w * 0.3, 1.0, d * 0.3, 'team');
    flag(k, w * 0.4, 0.2, -d * 0.35);
    k.box(1.0, 0.1, 1.0, -w * 0.3, 0.25, -d * 0.3, C.olive);
  },
  supply: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.5, 1.3, d * 0.55, -w * 0.2, 0.85, 0, s.hull);
    k.box(w * 0.5, 0.2, d * 0.6, -w * 0.2, 1.6, 0, s.roof);
    k.box(w * 0.95, 0.12, d * 0.6, 0, 1.9, 0, s.accent);
    for (const x of [w * 0.4, w * 0.1]) for (const z of [d * 0.28, -d * 0.28]) k.cyl(0.06, 1.85, x, 0.95, z, C.steel, undefined, 6);
    crates(k, w * 0.15, d * 0.1, 4);
    k.box(1.2, 0.5, 0.6, w * 0.3, 0.45, -d * 0.3, 'team');
  },
  factory: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.9, 1.6, d * 0.7, 0, 1.0, -d * 0.1, s.hull);
    k.wedge(d * 0.7, 0.6, w * 0.92, 0, 1.9, -d * 0.1, s.roof, [0, Math.PI / 2, 0]);
    k.wedge(d * 0.7, 0.6, w * 0.92, 0, 1.9, -d * 0.1, s.roof, [0, -Math.PI / 2, 0]);
    k.box(w * 0.4, 1.3, 0.1, 0, 0.8, d * 0.25, C.dark);
    k.box(w * 0.45, 0.15, 0.2, 0, 1.6, d * 0.26, 'team');
    k.cyl(0.25, 2.6, w * 0.35, 1.5, -d * 0.35, C.pipe, undefined, 8);
    k.box(0.2, 2.2, 0.2, -w * 0.4, 1.2, d * 0.35, C.yellow);
    k.box(w * 0.5, 0.15, 0.15, -w * 0.18, 2.3, d * 0.35, C.yellow);
    k.box(0.8, 0.15, 0.8, w * 0.3, 0.27, d * 0.35, C.warn);
  },
  airfield: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.95, 0.04, d * 0.95, 0, 0.21, 0, C.concrete);
    for (let i = -1; i <= 1; i++) k.box(w * 0.8, 0.02, 0.15, 0, 0.24, i * d * 0.3, C.white);
    k.box(w * 0.3, 1.3, d * 0.3, -w * 0.3, 0.85, -d * 0.3, s.hull);
    k.box(w * 0.2, 0.6, d * 0.2, -w * 0.3, 1.8, -d * 0.3, C.glass);
    k.box(w * 0.22, 0.1, d * 0.22, -w * 0.3, 2.15, -d * 0.3, s.roof);
    k.box(w * 0.35, 1.1, d * 0.35, w * 0.3, 0.7, -d * 0.3, s.roof);
    k.box(w * 0.3, 0.2, 0.1, w * 0.3, 1.0, -d * 0.12, 'team');
    k.cyl(0.03, 1.2, w * 0.45, 0.8, d * 0.45, C.steel, undefined, 5);
    k.box(0.6, 0.2, 0.03, w * 0.45 + 0.3, 1.3, d * 0.45, C.orange);
  },
  patriot: (k, s) => {
    slab(k, 1.9, 1.9, C.concreteDark);
    k.box(1.3, 0.5, 1.3, 0, 0.45, 0, s.hull);
    k.use('turret', [0, 0.75, 0]).box(0.9, 0.5, 0.7, -0.1, 0.95, 0, s.accent, [0, 0, 0.5]).box(0.3, 0.3, 0.3, -0.45, 0.8, 0, s.hull);
    k.cyl(0.04, 1.2, 0.6, 0.9, 0.6, C.steel, undefined, 5);
  },
  gatlingturret: (k, s) => {
    slab(k, 1.9, 1.9, C.concreteDark);
    k.cyl(0.8, 0.6, 0, 0.5, 0, s.hull, undefined, 12);
    k.use('turret', [0, 0.95, 0]).box(0.8, 0.5, 0.7, -0.1, 1.05, 0, s.hull).box(0.3, 0.08, 0.4, -0.3, 1.33, 0, 'team');
    for (let i = 0; i < 4; i++) k.barrel(0.04, 1.0, 0.6, 1.08 + Math.sin(i * 1.57) * 0.07, Math.cos(i * 1.57) * 0.07);
  },
  strategy: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.8, 1.2, d * 0.8, 0, 0.8, 0, s.hull);
    k.sphere(w * 0.3, 0, 1.6, 0, s.accent, 12);
    k.box(w * 0.3, 0.3, 0.1, 0, 0.9, d * 0.4, 'team');
    k.use('dish', [w * 0.32, 2.2, -d * 0.3]).cyl(0.9, 0.12, w * 0.32, 2.2, -d * 0.3, C.lightGrey, [0.7, 0, 0], 12).cyl(0.05, 0.6, w * 0.32, 2.5, -d * 0.3 + 0.2, C.steel, [0.7, 0, 0], 5);
    k.cyl(0.08, 2.0, w * 0.32, 1.1, -d * 0.3, C.steel, undefined, 6);
    antenna(k, -w * 0.35, d * 0.35, 2.8);
  },
  pad: (k, s, w, d) => {
    slab(k, w, d, C.concrete);
    k.add('ring', [w * 0.38, 0, 0.08], [0, 0.22, 0], C.yellow);
    k.box(0.4, 0.4, 0.4, w * 0.35, 0.4, -d * 0.35, s.hull);
    for (let i = 0; i < 4; i++) k.sphere(0.08, Math.cos(i * 1.57) * w * 0.4, 0.3, Math.sin(i * 1.57) * d * 0.4, C.red, 5);
    crates(k, -w * 0.2, 0, 2);
  },
  lance: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.7, 0.8, d * 0.7, 0, 0.6, 0, s.hull);
    k.cyl(0.6, 2.8, 0, 2.2, 0, s.roof, undefined, 10);
    for (let i = 0; i < 3; i++) k.add('ring', [1.0 + i * 0.3, 0, 0.08], [0, 1.6 + i * 0.7, 0], s.accent);
    k.sphere(0.5, 0, 3.9, 0, C.glass, 10);
    k.use('dish', [0, 4.3, 0]).cyl(1.1, 0.12, 0, 4.3, 0, C.lightGrey, [0, 0, 0], 14);
    for (let i = 0; i < 4; i++) antenna(k, Math.cos(i * 1.57 + 0.78) * w * 0.38, Math.sin(i * 1.57 + 0.78) * d * 0.38, 1.6);
  },
  speaker: (k, s) => {
    k.cyl(0.1, 2.4, 0, 1.2, 0, C.steel, undefined, 6);
    k.box(0.4, 0.4, 0.3, 0.25, 2.3, 0, s.accent);
    k.box(0.4, 0.4, 0.3, -0.25, 2.3, 0, s.accent);
    k.cone(0.22, 0.35, 0.5, 2.3, 0, C.dark, [0, 0, -Math.PI / 2]);
    k.cone(0.22, 0.35, -0.5, 2.3, 0, C.dark, [0, 0, Math.PI / 2]);
    k.box(0.5, 0.1, 0.5, 0, 0.05, 0, C.concreteDark);
  },
  silo: (k, s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(w * 0.8, 0.7, d * 0.8, 0, 0.55, 0, C.concrete);
    k.box(w * 0.4, 0.15, d * 0.4, 0, 0.95, 0, s.accent);
    k.cyl(0.6, 0.5, 0, 1.2, 0, C.dark, undefined, 12);
    k.cone(0.4, 1.0, 0, 1.9, 0, C.white, undefined, 10);
    k.box(w * 0.3, 1.0, d * 0.25, -w * 0.3, 0.9, d * 0.3, s.hull);
    for (let i = 0; i < 4; i++) k.sphere(0.1, Math.cos(i * 1.57) * w * 0.42, 1.0, Math.sin(i * 1.57) * d * 0.42, C.red, 5);
  },
  stash: (k, s, w, d) => {
    slab(k, w, d, C.sand);
    k.box(w * 0.5, 1.0, d * 0.5, -w * 0.2, 0.7, -d * 0.1, s.hull);
    k.box(w * 0.6, 0.12, d * 0.6, -w * 0.2, 1.3, -d * 0.1, C.tarp);
    crates(k, w * 0.15, d * 0.15, 5);
    sandbags(k, Math.min(w, d) * 0.46, 10);
    flag(k, w * 0.35, 0.2, -d * 0.35);
  },
  tunnel: (k, s) => {
    k.sphere(1.1, 0, -0.3, 0, C.sand, 10);
    k.cyl(0.5, 0.4, 0, 0.6, 0, C.black, undefined, 10);
    sandbags(k, 1.2, 8);
    k.use('turret', [0, 0.95, 0]).box(0.3, 0.2, 0.2, 0, 0.95, 0, s.accent).barrel(0.04, 0.6, 0.35, 1.0, 0);
    k.height = 1.2;
  },
  stinger: (k, s) => {
    slab(k, 1.9, 1.9, C.sand);
    sandbags(k, 0.85, 9);
    k.use('turret', [0, 0.6, 0]).box(0.4, 0.4, 0.5, 0, 0.6, 0, s.hull);
    for (const z of [0.15, -0.15]) k.barrel(0.07, 0.9, 0.3, 0.75, z, C.olive);
    k.box(0.3, 0.3, 0.2, -0.3, 0.6, 0, 'team');
  },
  market: (k, s, w, d) => {
    slab(k, w, d, C.sand);
    k.box(w * 0.7, 1.1, d * 0.6, 0, 0.75, -d * 0.1, s.hull);
    k.box(w * 0.9, 0.08, d * 0.5, 0, 1.4, d * 0.2, C.red);
    k.box(w * 0.9, 0.08, d * 0.5, 0, 1.5, -d * 0.3, s.accent);
    crates(k, -w * 0.3, d * 0.25, 3);
    k.box(0.5, 0.3, 0.5, w * 0.3, 0.35, d * 0.3, C.wood);
  },
  palace: (k, s, w, d) => {
    slab(k, w, d, C.sand);
    k.box(w * 0.85, 1.6, d * 0.85, 0, 1.0, 0, s.hull);
    k.sphere(w * 0.3, 0, 2.2, 0, s.accent, 12);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      k.cyl(0.3, 2.8, x * w * 0.4, 1.5, z * d * 0.4, s.roof, undefined, 8);
      k.cone(0.35, 0.5, x * w * 0.4, 3.1, z * d * 0.4, s.accent, undefined, 8);
    }
    k.box(w * 0.3, 1.0, 0.1, 0, 0.7, d * 0.43, C.dark);
    k.box(w * 0.2, 0.3, 0.05, 0, 1.6, d * 0.44, 'team');
  },
  trap: (k) => {
    k.box(0.7, 0.2, 0.7, 0, 0.1, 0, C.rust);
    k.sphere(0.12, 0, 0.25, 0, C.red, 5);
    k.height = 0.4;
  },
  mine: (k) => {
    k.cyl(0.3, 0.12, 0, 0.06, 0, C.dark, undefined, 8);
    k.height = 0.2;
  },
  scudstorm: (k, s, w, d) => {
    slab(k, w, d, C.sand);
    k.box(w * 0.8, 0.5, d * 0.8, 0, 0.45, 0, C.concrete);
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * w * 0.25, z = (Math.floor(i / 3) - 1) * d * 0.25;
      k.cyl(0.28, 1.6, x, 1.4, z, s.hull, undefined, 8);
      k.cone(0.2, 0.4, x, 2.4, z, C.red, undefined, 8);
    }
    sandbags(k, Math.min(w, d) * 0.48, 12);
  },
  derrick: (k, _s, w, d) => {
    slab(k, w, d, C.concreteDark);
    k.box(0.3, 2.6, 0.3, -0.6, 1.3, 0, C.rust);
    k.box(0.3, 2.6, 0.3, -0.6, 1.3, 0, C.rust, [0, 0, 0.35]);
    k.use('rotor', [-0.6, 2.4, 0]).box(2.0, 0.2, 0.25, -0.6, 2.4, 0, C.rust).box(0.4, 0.5, 0.4, 0.3, 2.3, 0, C.dark);
    k.cyl(0.6, 1.0, 0.8, 0.6, 0.7, C.steel, undefined, 10);
    k.box(0.4, 0.4, 0.4, 0.8, 0.4, -0.8, C.rust);
  },
};

const cache = new Map<string, ModelDef>();

export function unitModel(key: string, style: FactionDef['style']): ModelDef {
  const ck = 'u:' + key + ':' + style.hull;
  let m = cache.get(ck);
  if (m) return m;
  const k = new Kit();
  (unitBuilders[key] ?? unitBuilders.tank)(k, style);
  m = finish(k);
  cache.set(ck, m);
  return m;
}

export function buildingModel(key: string, style: FactionDef['style'], w: number, d: number): ModelDef {
  const ck = 'b:' + key + ':' + style.hull + ':' + w + 'x' + d;
  let m = cache.get(ck);
  if (m) return m;
  const k = new Kit();
  (buildingBuilders[key] ?? buildingBuilders.barracks)(k, style, w - 0.3, d - 0.3);
  m = finish(k);
  cache.set(ck, m);
  return m;
}

/** Flyers for generals powers reuse unit models. */
export function flyerModel(kind: 'cargo' | 'strike' | 'bomber' | 'spray', style: FactionDef['style']) {
  return unitModel(kind === 'cargo' ? 'chinook' : kind === 'strike' ? 'jet' : kind === 'spray' ? 'mig' : 'bomber', style);
}

/** Decorative props: trees, rocks, bushes, palms. */
export function propModel(kind: 'tree' | 'rock' | 'palm' | 'bush'): THREE.BufferGeometry {
  const ck = 'p:' + kind;
  const c = cache.get(ck);
  if (c && c.hull) return c.hull;
  const k = new Kit();
  switch (kind) {
    case 'tree':
      k.cyl(0.12, 0.8, 0, 0.4, 0, C.brown, undefined, 6);
      k.cone(0.7, 1.2, 0, 1.2, 0, 0x3f7a3a, undefined, 7);
      k.cone(0.55, 1.0, 0, 1.9, 0, 0x4f8f45, undefined, 7);
      break;
    case 'palm':
      k.cyl(0.1, 1.8, 0.1, 0.9, 0, C.brown, [0, 0, 0.12], 6);
      for (let i = 0; i < 5; i++) k.box(1.1, 0.06, 0.3, 0.2 + Math.cos(i * 1.26) * 0.5, 1.85, Math.sin(i * 1.26) * 0.5, 0x4f8f45, [0, -i * 1.26, 0.35]);
      break;
    case 'rock':
      k.sphere(0.6, 0, 0.3, 0, 0x8a8478, 5);
      k.sphere(0.4, 0.4, 0.2, 0.3, 0x9a9488, 5);
      break;
    case 'bush':
      k.sphere(0.45, 0, 0.35, 0, 0x6f8f3a, 6);
      k.sphere(0.35, 0.3, 0.3, 0.2, 0x7a9a40, 6);
      break;
  }
  const m = finish(k);
  cache.set(ck, m);
  return m.hull!;
}

export function supplyPileModel(level: number): THREE.BufferGeometry {
  const ck = 's:' + level;
  const c = cache.get(ck);
  if (c && c.hull) return c.hull;
  const k = new Kit();
  const n = 2 + level * 2;
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 4);
    k.box(0.75, 0.6, 0.75, ((i % 2) - 0.5) * 0.85 + 1, 0.3 + layer * 0.6, (Math.floor((i % 4) / 2) - 0.5) * 0.85 + 1, i % 3 === 0 ? C.olive : i % 3 === 1 ? C.wood : C.yellow, [0, (i * 0.37) % 0.4, 0]);
  }
  const m = finish(k);
  cache.set(ck, m);
  return m.hull!;
}

export function crateModel(): THREE.BufferGeometry {
  const ck = 'crate';
  const c = cache.get(ck);
  if (c && c.hull) return c.hull;
  const k = new Kit();
  k.box(0.6, 0.4, 0.6, 0, 0.2, 0, C.rust);
  k.box(0.3, 0.3, 0.3, 0.1, 0.5, 0.1, C.steel);
  const m = finish(k);
  cache.set(ck, m);
  return m.hull!;
}

/** Scaffold frame shown while a structure is under construction. */
export function scaffoldModel(w: number, d: number, h: number): THREE.BufferGeometry {
  const ck = 'sc:' + w + ':' + d + ':' + h;
  const c = cache.get(ck);
  if (c && c.hull) return c.hull;
  const k = new Kit();
  for (const x of [-1, 1]) for (const z of [-1, 1]) k.box(0.12, h, 0.12, (x * w) / 2, h / 2, (z * d) / 2, C.yellow);
  for (const z of [-1, 1]) k.box(w, 0.1, 0.1, 0, h, (z * d) / 2, C.yellow);
  for (const x of [-1, 1]) k.box(0.1, 0.1, d, (x * w) / 2, h, 0, C.yellow);
  const m = finish(k);
  cache.set(ck, m);
  return m.hull!;
}
