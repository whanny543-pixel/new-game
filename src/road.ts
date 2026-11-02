import * as THREE from 'three';
import { COLORS, ROAD_HALF_WIDTH } from './config';

/** A smooth road sampled into an arc-length table so enemies can walk it by distance. */
export class Road {
  readonly pts: THREE.Vector3[] = [];
  readonly tangents: THREE.Vector3[] = [];
  readonly cum: number[] = [];
  readonly length: number;

  constructor(control: [number, number][]) {
    const curve = new THREE.CatmullRomCurve3(
      control.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
    );
    const n = 240;
    let total = 0;
    for (let i = 0; i <= n; i++) {
      const p = curve.getPoint(i / n);
      if (i > 0) total += p.distanceTo(this.pts[i - 1]);
      this.pts.push(p);
      this.cum.push(total);
    }
    for (let i = 0; i <= n; i++) {
      const a = this.pts[Math.max(0, i - 1)];
      const b = this.pts[Math.min(n, i + 1)];
      this.tangents.push(b.clone().sub(a).normalize());
    }
    this.length = total;
  }

  private index(s: number) {
    const c = this.cum;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - c[lo]) / Math.max(1e-6, c[hi] - c[lo]);
    return { i: lo, f };
  }

  /** Point at distance `s`, shifted sideways by `offset` (positive = right of travel). */
  point(s: number, offset: number, out: THREE.Vector3) {
    const { i, f } = this.index(s);
    const a = this.pts[i];
    const b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    out.lerpVectors(a, b, f);
    const t = this.tangents[i];
    // Right-hand normal on the ground plane.
    out.x += -t.z * offset;
    out.z += t.x * offset;
    return out;
  }

  tangent(s: number, out: THREE.Vector3) {
    const { i } = this.index(s);
    return out.copy(this.tangents[i]);
  }

  /** Distance from (x,z) to the road centre line. */
  distanceTo(x: number, z: number) {
    let best = Infinity;
    for (const p of this.pts) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Ribbon mesh: darker centre fading into lighter edges. */
  makeMesh() {
    const n = this.pts.length;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const edge = new THREE.Color(COLORS.roadEdge);
    const mid = new THREE.Color(COLORS.road);
    const sand = new THREE.Color(COLORS.sand);
    // Five strips across: sand-blend | edge | centre | edge | sand-blend.
    const offsets = [-ROAD_HALF_WIDTH - 0.9, -ROAD_HALF_WIDTH, 0, ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + 0.9];
    const colors = [sand, edge, mid, edge, sand];
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < offsets.length; k++) {
        this.point(this.cum[i], offsets[k], v);
        pos.push(v.x, 0.015 + (k === 2 ? 0.004 : 0), v.z);
        const c = colors[k];
        // Slight wobble in tone along the road so it doesn't look painted on.
        const j = 1 + Math.sin(i * 0.37 + k) * 0.03;
        col.push(c.r * j, c.g * j, c.b * j);
      }
    }
    const w = offsets.length;
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < w - 1; k++) {
        const a = i * w + k;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    return m;
  }
}
