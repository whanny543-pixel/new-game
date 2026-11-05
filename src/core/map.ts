// Map generation. Each map is a hand-laid layout (starts, docks, derricks, ridges, rivers) dressed
// with seeded noise so it looks natural but is identical every time it is played.
import { Noise, Rng, clamp, dist } from './math';

export const T_GROUND = 0;
export const T_CLIFF = 1;
export const T_WATER = 2;
export const T_ROAD = 3;

export type Theme = 'desert' | 'temperate';

export interface SupplyDock {
  x: number;
  y: number;
  amount: number;
  max: number;
}

export interface Prop {
  x: number;
  y: number;
  kind: 'tree' | 'rock' | 'palm' | 'bush';
  scale: number;
  rot: number;
}

export interface MapSpec {
  id: string;
  name: string;
  size: number;
  players: number;
  theme: Theme;
  desc: string;
  seed: number;
  /** Start positions as fractions of the map size. */
  starts: [number, number][];
  /** Docks as fractions; `amount` in credits. */
  docks: [number, number, number][];
  derricks: [number, number][];
  /** Ridges: polyline of fractional points plus a half-width in cells. */
  ridges: { pts: [number, number][]; w: number }[];
  rivers: { pts: [number, number][]; w: number; bridges: [number, number][] }[];
}

export const MAPS: MapSpec[] = [
  {
    id: 'dust', name: 'Dust Basin', size: 96, players: 2, theme: 'desert', seed: 11,
    desc: 'Two bases divided by a shattered ridge. Oil in the middle, if you can hold it.',
    starts: [[0.17, 0.2], [0.83, 0.8]],
    docks: [[0.08, 0.3, 14000], [0.3, 0.1, 14000], [0.92, 0.7, 14000], [0.7, 0.9, 14000], [0.5, 0.3, 12000], [0.5, 0.7, 12000], [0.2, 0.75, 10000], [0.8, 0.25, 10000]],
    derricks: [[0.42, 0.52], [0.58, 0.48], [0.14, 0.86], [0.86, 0.14]],
    ridges: [
      { pts: [[0.28, 0.62], [0.4, 0.5], [0.38, 0.36]], w: 2 },
      { pts: [[0.72, 0.38], [0.6, 0.5], [0.62, 0.64]], w: 2 },
      { pts: [[0.05, 0.55], [0.18, 0.5]], w: 1.5 },
      { pts: [[0.95, 0.45], [0.82, 0.5]], w: 1.5 },
    ],
    rivers: [],
  },
  {
    id: 'valley', name: 'Green Valley', size: 104, players: 2, theme: 'temperate', seed: 23,
    desc: 'A river splits the valley. Two bridges, four oil derricks, endless arguments.',
    starts: [[0.14, 0.5], [0.86, 0.5]],
    docks: [[0.07, 0.3, 14000], [0.07, 0.7, 14000], [0.93, 0.3, 14000], [0.93, 0.7, 14000], [0.35, 0.12, 12000], [0.65, 0.88, 12000], [0.35, 0.88, 10000], [0.65, 0.12, 10000]],
    derricks: [[0.42, 0.3], [0.58, 0.7], [0.42, 0.7], [0.58, 0.3]],
    ridges: [
      { pts: [[0.2, 0.08], [0.3, 0.2]], w: 1.5 },
      { pts: [[0.8, 0.92], [0.7, 0.8]], w: 1.5 },
    ],
    rivers: [{ pts: [[0.5, 0], [0.47, 0.3], [0.53, 0.6], [0.5, 1]], w: 2.2, bridges: [[0.47, 0.28], [0.52, 0.72]] }],
  },
  {
    id: 'crossfire', name: 'Crossfire', size: 124, players: 4, theme: 'desert', seed: 37,
    desc: 'Four armies, one plateau. Everybody wants the centre.',
    starts: [[0.12, 0.12], [0.88, 0.88], [0.88, 0.12], [0.12, 0.88]],
    docks: [
      [0.05, 0.22, 14000], [0.22, 0.05, 14000], [0.95, 0.78, 14000], [0.78, 0.95, 14000],
      [0.95, 0.22, 14000], [0.78, 0.05, 14000], [0.05, 0.78, 14000], [0.22, 0.95, 14000],
      [0.5, 0.4, 14000], [0.5, 0.6, 14000], [0.4, 0.5, 14000], [0.6, 0.5, 14000],
    ],
    derricks: [[0.45, 0.45], [0.55, 0.55], [0.55, 0.45], [0.45, 0.55], [0.5, 0.1], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5]],
    ridges: [
      { pts: [[0.3, 0.3], [0.36, 0.42], [0.3, 0.5]], w: 1.8 },
      { pts: [[0.7, 0.7], [0.64, 0.58], [0.7, 0.5]], w: 1.8 },
      { pts: [[0.7, 0.3], [0.58, 0.36], [0.5, 0.3]], w: 1.8 },
      { pts: [[0.3, 0.7], [0.42, 0.64], [0.5, 0.7]], w: 1.8 },
    ],
    rivers: [],
  },
  {
    id: 'fortress', name: 'Fortress Delta', size: 112, players: 3, theme: 'temperate', seed: 51,
    desc: 'Three commanders, a winding river and too few bridges.',
    starts: [[0.15, 0.18], [0.85, 0.18], [0.5, 0.86]],
    docks: [
      [0.06, 0.3, 14000], [0.28, 0.06, 14000], [0.94, 0.3, 14000], [0.72, 0.06, 14000],
      [0.36, 0.94, 14000], [0.64, 0.94, 14000], [0.5, 0.45, 14000], [0.2, 0.6, 12000], [0.8, 0.6, 12000],
    ],
    derricks: [[0.5, 0.2], [0.3, 0.5], [0.7, 0.5], [0.5, 0.62]],
    ridges: [{ pts: [[0.4, 0.3], [0.5, 0.35], [0.6, 0.3]], w: 1.6 }],
    rivers: [{ pts: [[0, 0.55], [0.3, 0.68], [0.5, 0.72], [0.7, 0.68], [1, 0.55]], w: 2.0, bridges: [[0.2, 0.63], [0.5, 0.72], [0.8, 0.63]] }],
  },
];

export class GameMap {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  /** Per-vertex height, (w+1)*(h+1). */
  readonly height: Float32Array;
  /** Cells blocked by structures / piles (dynamic). Values are entity ids + 1, 0 = free. */
  readonly occupied: Int32Array;
  readonly starts: { x: number; y: number }[] = [];
  readonly docks: SupplyDock[] = [];
  readonly derricks: { x: number; y: number }[] = [];
  readonly props: Prop[] = [];
  readonly theme: Theme;
  readonly spec: MapSpec;
  /** Cheap moisture/colour noise for the renderer. */
  readonly noise: Noise;

  constructor(spec: MapSpec) {
    this.spec = spec;
    this.w = spec.size;
    this.h = spec.size;
    this.theme = spec.theme;
    this.terrain = new Uint8Array(this.w * this.h);
    this.height = new Float32Array((this.w + 1) * (this.h + 1));
    this.occupied = new Int32Array(this.w * this.h);
    this.noise = new Noise(spec.seed);
    this.generate();
  }

  idx(x: number, y: number) {
    return y * this.w + x;
  }
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  terrainAt(x: number, y: number) {
    return this.inBounds(x, y) ? this.terrain[this.idx(x, y)] : T_CLIFF;
  }
  /** Can a ground unit stand on this cell? */
  passable(x: number, y: number) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return (t === T_GROUND || t === T_ROAD) && this.occupied[this.idx(x, y)] === 0;
  }
  /** Terrain only (ignores structures). */
  walkable(x: number, y: number) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return t === T_GROUND || t === T_ROAD;
  }
  /** Smooth ground height at a world position. */
  heightAt(wx: number, wy: number) {
    const x = clamp(wx, 0, this.w - 0.001), y = clamp(wy, 0, this.h - 0.001);
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const s = this.w + 1;
    const h00 = this.height[yi * s + xi], h10 = this.height[yi * s + xi + 1];
    const h01 = this.height[(yi + 1) * s + xi], h11 = this.height[(yi + 1) * s + xi + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }

  occupy(x: number, y: number, w: number, h: number, id: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.inBounds(i, j)) this.occupied[this.idx(i, j)] = id;
  }
  /** True if every cell of the footprint is buildable ground. */
  canPlace(x: number, y: number, w: number, h: number) {
    for (let j = y - 1; j <= y + h; j++)
      for (let i = x - 1; i <= x + w; i++) {
        const edge = j < y || j >= y + h || i < x || i >= x + w;
        if (!this.inBounds(i, j)) return false;
        if (edge) continue;
        if (!this.passable(i, j)) return false;
      }
    return true;
  }
  /** Nearest passable cell to (x, y), searching outward in rings. */
  nearestFree(x: number, y: number, maxR = 12): { x: number; y: number } | null {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.passable(x, y)) return { x, y };
    for (let r = 1; r <= maxR; r++) {
      for (let i = -r; i <= r; i++) {
        const cands = [[x + i, y - r], [x + i, y + r], [x - r, y + i], [x + r, y + i]];
        for (const [cx, cy] of cands) if (this.passable(cx, cy)) return { x: cx, y: cy };
      }
    }
    return null;
  }

  private generate() {
    const s = this.spec;
    const rng = new Rng(s.seed * 7919);
    const n = this.noise;
    const W = this.w, H = this.h;
    // Gentle rolling heights.
    const vs = W + 1;
    for (let y = 0; y <= H; y++)
      for (let x = 0; x <= W; x++) this.height[y * vs + x] = n.fbm(x * 0.06, y * 0.06, 3) * 1.1 - 0.4;

    const setCircle = (cx: number, cy: number, r: number, t: number) => {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
          if (this.inBounds(x, y) && dist(x + 0.5, y + 0.5, cx, cy) <= r) this.terrain[this.idx(x, y)] = t;
    };
    const strokeLine = (pts: [number, number][], w: number, t: number, wobble: number) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const len = dist(ax * W, ay * H, bx * W, by * H);
        const steps = Math.ceil(len * 2);
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const x = (ax + (bx - ax) * u) * W, y = (ay + (by - ay) * u) * H;
          const ww = w + (n.at(x * 0.3, y * 0.3) - 0.5) * wobble;
          setCircle(x, y, ww, t);
        }
      }
    };
    for (const r of s.ridges) strokeLine(r.pts, r.w, T_CLIFF, 1.6);
    for (const r of s.rivers) {
      strokeLine(r.pts, r.w, T_WATER, 1.0);
      for (const [bx, by] of r.bridges) setCircle(bx * W, by * H, r.w + 1.8, T_ROAD);
    }
    // Map border is impassable rock.
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) this.terrain[this.idx(x, y)] = T_CLIFF;

    // Raise cliffs and sink water in the height map.
    for (let y = 0; y <= H; y++)
      for (let x = 0; x <= W; x++) {
        let cliff = 0, water = 0, count = 0;
        for (let j = -1; j <= 0; j++)
          for (let i = -1; i <= 0; i++) {
            const t = this.terrainAt(x + i, y + j);
            count++;
            if (t === T_CLIFF) cliff++;
            if (t === T_WATER) water++;
          }
        const k = y * vs + x;
        if (cliff === count) this.height[k] += 2.6 + n.at(x * 0.5, y * 0.5) * 1.2;
        else if (cliff > 0) this.height[k] += 1.2;
        if (water > 0) this.height[k] -= 0.9 * (water / count) + 0.3;
      }

    for (const [fx, fy] of s.starts) this.starts.push({ x: Math.round(fx * W), y: Math.round(fy * H) });
    for (const [fx, fy, amount] of s.docks) {
      const x = Math.round(fx * W), y = Math.round(fy * H);
      this.docks.push({ x, y, amount: amount * 1.5, max: amount * 1.5 });
      // Clear a little pad around each dock.
      setCircle(x + 1, y + 1, 4, T_GROUND);
    }
    for (const [fx, fy] of s.derricks) {
      const x = Math.round(fx * W), y = Math.round(fy * H);
      setCircle(x + 1.5, y + 1.5, 4, T_GROUND);
      this.derricks.push({ x, y });
    }
    // Keep starts clear of rock.
    for (const st of this.starts) setCircle(st.x, st.y, 14, T_GROUND);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) this.terrain[this.idx(x, y)] = T_CLIFF;

    // Decorative props scattered on open ground, away from bases, docks and derricks.
    const tries = (W * H) / 14;
    for (let i = 0; i < tries; i++) {
      const x = rng.range(2, W - 2), y = rng.range(2, H - 2);
      if (!this.walkable(Math.floor(x), Math.floor(y))) continue;
      if (this.starts.some((st) => dist(st.x, st.y, x, y) < 15)) continue;
      if (this.docks.some((d) => dist(d.x, d.y, x, y) < 5)) continue;
      if (this.derricks.some((d) => dist(d.x, d.y, x, y) < 4)) continue;
      const v = n.fbm(x * 0.08 + 50, y * 0.08 + 50, 2);
      if (v < 0.52) continue;
      const kind = this.theme === 'desert' ? (rng.next() < 0.65 ? 'rock' : rng.next() < 0.5 ? 'palm' : 'bush') : rng.next() < 0.75 ? 'tree' : rng.next() < 0.5 ? 'rock' : 'bush';
      this.props.push({ x, y, kind, scale: rng.range(0.8, 1.4), rot: rng.range(0, 6.28) });
    }
  }
}
