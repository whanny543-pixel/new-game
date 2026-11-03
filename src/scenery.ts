import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Stylised, flat-shaded scenery in one vertex-coloured mesh each: chunky rock cliffs that ring the
// valley, and dark pines (instanced). Cheap to draw, clean to look at.

const tmpC = new THREE.Color();

/** Colours each face by which way it points: pale tops, cool shaded sides, darker toward the base. */
function paint(g: THREE.BufferGeometry, top: number, side: number, low: number, jitter: number, rng: () => number) {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const p = geo.attributes.position;
  const cols = new Float32Array(p.count * 3);
  geo.computeBoundingBox();
  const minY = geo.boundingBox!.min.y;
  const maxY = geo.boundingBox!.max.y;
  for (let f = 0; f < p.count; f += 3) {
    const ny = (n.getY(f) + n.getY(f + 1) + n.getY(f + 2)) / 3;
    const y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
    const k = (y - minY) / Math.max(0.01, maxY - minY);
    if (ny > 0.55) tmpC.set(top);
    else tmpC.set(low).lerp(new THREE.Color(side), Math.min(1, k * 1.4));
    // Faces toward the light read a little brighter.
    const lit = 0.92 + Math.max(0, (n.getX(f) * 0.5 + n.getZ(f) * 0.3)) * 0.18 + (rng() - 0.5) * jitter;
    tmpC.multiplyScalar(lit);
    for (let v = 0; v < 3; v++) cols.set([tmpC.r, tmpC.g, tmpC.b], (f + v) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

/** One chunky rock: two or three stacked, slightly twisted low-poly prisms. */
function rock(rng: () => number, h: number, w: number) {
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  let r = w;
  const tiers = h > 6 ? 3 : 2;
  for (let i = 0; i < tiers; i++) {
    const th = (h / tiers) * (0.8 + rng() * 0.4);
    const sides = 5 + Math.floor(rng() * 2);
    const g = new THREE.CylinderGeometry(r * (0.82 + rng() * 0.1), r, th, sides, 1);
    g.rotateY(rng() * Math.PI);
    g.scale(1, 1, 0.75 + rng() * 0.45);
    g.translate((rng() - 0.5) * r * 0.3, y + th / 2, (rng() - 0.5) * r * 0.3);
    parts.push(g.toNonIndexed());
    g.dispose();
    y += th * 0.96;
    r *= 0.72 + rng() * 0.12;
  }
  return mergeGeometries(parts)!;
}

export interface CliffStyle {
  top: number;
  side: number;
  low: number;
}

/**
 * Rock cliffs ringing the square realm at distance `inner`..`outer`. The camera looks in from +x/+z,
 * so cliffs on that side stay low; the far side towers up like valley walls.
 */
export function makeCliffRing(rng: () => number, inner: number, outer: number, style: CliffStyle) {
  const parts: THREE.BufferGeometry[] = [];
  const place = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const nearSide = x > inner - 2 || z > inner - 2;
    const t = (d - inner) / (outer - inner);
    const h = nearSide ? 2.5 + t * 6 + rng() * 2 : 7 + t * 14 + rng() * 6;
    const w = 3 + rng() * 3.5;
    const g = rock(rng, h, w);
    g.rotateY(rng() * Math.PI * 2);
    g.translate(x, -0.3, z);
    parts.push(g);
  };
  for (let i = 0; i < 260; i++) {
    const x = (rng() - 0.5) * outer * 2;
    const z = (rng() - 0.5) * outer * 2;
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < inner || d > outer) continue;
    place(x, z);
  }
  const merged = mergeGeometries(parts.map((g) => paint(g, style.top, style.side, style.low, 0.08, rng)))!;
  parts.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

let pineGeo: THREE.BufferGeometry | null = null;
/** A stylised pine: three stacked cones on a short trunk, about 1 unit tall. */
function pineGeometry() {
  if (pineGeo) return pineGeo;
  const rng = () => 0.5;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.25, 5).translate(0, 0.12, 0);
  parts.push(paint(trunk, 0x6a4a32, 0x6a4a32, 0x4a3222, 0, rng));
  const tiers: [number, number, number][] = [
    [0.36, 0.42, 0.42],
    [0.28, 0.36, 0.64],
    [0.18, 0.3, 0.84],
  ];
  for (const [r, h, y] of tiers) {
    const c = new THREE.ConeGeometry(r, h, 7).translate(0, y, 0);
    parts.push(paint(c, 0x2f7a5e, 0x2a6b55, 0x1d4a3d, 0, rng));
  }
  pineGeo = mergeGeometries(parts)!;
  return pineGeo;
}

/** Many pines in one draw call. `spots` are [x, z, height]. */
export function makePines(spots: [number, number, number][], tint: [number, number, number]) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  mat.color.setRGB(tint[0], tint[1], tint[2]);
  const im = new THREE.InstancedMesh(pineGeometry(), mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach(([x, z, h], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (x * 13.7 + z * 7.1) % 6.28);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(h * 0.85, h, h * 0.85));
    im.setMatrixAt(i, m);
  });
  im.count = spots.length;
  im.castShadow = true;
  im.receiveShadow = true;
  return im;
}
