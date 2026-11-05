// Small numeric helpers shared by the simulation and the renderer.

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => (bx - ax) ** 2 + (by - ay) ** 2;
export const TAU = Math.PI * 2;

/** Smallest signed difference between two angles. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate `a` toward `b` by at most `step` radians. */
export function turnToward(a: number, b: number, step: number) {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= step) return b;
  return a + Math.sign(d) * step;
}

/** Deterministic pseudo random generator (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** Smooth 2D value noise in [0, 1]. */
export class Noise {
  private perm: Uint8Array;
  constructor(seed: number) {
    const rng = new Rng(seed);
    this.perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  private hash(x: number, y: number) {
    return this.perm[(this.perm[x & 255] + y) & 255] / 255;
  }
  at(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = this.hash(xi, yi), b = this.hash(xi + 1, yi), c = this.hash(xi, yi + 1), d = this.hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }
  /** Fractal noise: several octaves summed. */
  fbm(x: number, y: number, octaves = 3) {
    let v = 0, amp = 0.5, f = 1, sum = 0;
    for (let i = 0; i < octaves; i++) {
      v += this.at(x * f, y * f) * amp;
      sum += amp;
      amp *= 0.5;
      f *= 2;
    }
    return v / sum;
  }
}

export function formatMoney(v: number) {
  return '$' + Math.floor(v).toLocaleString('en-US');
}

export function formatTime(s: number) {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}
