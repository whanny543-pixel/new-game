// A* on the map grid with 8-way movement, plus string-pulling so units take straight lines
// across open ground instead of hugging grid diagonals.
import type { GameMap } from './map';

class Heap {
  keys: number[] = [];
  vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const ks = this.keys, vs = this.vals;
    ks.push(k);
    vs.push(v);
    let i = ks.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= ks[i]) break;
      [ks[p], ks[i]] = [ks[i], ks[p]];
      [vs[p], vs[i]] = [vs[i], vs[p]];
      i = p;
    }
  }
  pop() {
    const ks = this.keys, vs = this.vals;
    const top = vs[0];
    const lk = ks.pop()!, lv = vs.pop()!;
    if (ks.length) {
      ks[0] = lk;
      vs[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < ks.length && ks[l] < ks[m]) m = l;
        if (r < ks.length && ks[r] < ks[m]) m = r;
        if (m === i) break;
        [ks[m], ks[i]] = [ks[i], ks[m]];
        [vs[m], vs[i]] = [vs[i], vs[m]];
        i = m;
      }
    }
    return top;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];

let gScore: Float32Array | null = null;
let cameFrom: Int32Array | null = null;
let closed: Uint8Array | null = null;
let stamp: Uint16Array | null = null;
let curStamp = 1;

export interface Point {
  x: number;
  y: number;
}

/** Bresenham walk: true if every cell between a and b is passable. */
export function lineClear(map: GameMap, ax: number, ay: number, bx: number, by: number) {
  let x0 = Math.floor(ax), y0 = Math.floor(ay);
  const x1 = Math.floor(bx), y1 = Math.floor(by);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 400; guard++) {
    if (!map.passable(x0, y0)) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
      if (!map.passable(x0, y0)) return false;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return false;
}

/**
 * Find a path from world point a to world point b. Returns a list of world waypoints (cell
 * centres), excluding the start, ending at the goal (or the nearest reachable cell to it).
 */
export function findPath(map: GameMap, ax: number, ay: number, bx: number, by: number, maxIter = 6000): Point[] | null {
  const W = map.w, H = map.h, N = W * H;
  if (!gScore || gScore.length !== N) {
    gScore = new Float32Array(N);
    cameFrom = new Int32Array(N);
    closed = new Uint8Array(N);
    stamp = new Uint16Array(N);
  }
  curStamp = (curStamp + 1) & 0xffff;
  if (curStamp === 0) {
    stamp!.fill(0);
    curStamp = 1;
  }
  const g = gScore!, cf = cameFrom!, cl = closed!, st = stamp!;
  let sx = Math.floor(ax), sy = Math.floor(ay);
  const goalCell = map.nearestFree(bx, by, 10);
  if (!goalCell) return null;
  const gx = goalCell.x, gy = goalCell.y;
  if (!map.passable(sx, sy)) {
    const nf = map.nearestFree(sx, sy, 6);
    if (!nf) return null;
    sx = nf.x;
    sy = nf.y;
  }
  if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];
  // Fast path: straight line.
  if (lineClear(map, sx + 0.5, sy + 0.5, gx + 0.5, gy + 0.5)) return [{ x: gx + 0.5, y: gy + 0.5 }];

  const heap = new Heap();
  const start = sy * W + sx, goal = gy * W + gx;
  const h = (i: number) => {
    const x = i % W, y = (i / W) | 0;
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  st[start] = curStamp;
  g[start] = 0;
  cf[start] = -1;
  cl[start] = 0;
  heap.push(h(start), start);
  let best = start, bestH = h(start);
  let iter = 0;
  while (heap.size && iter++ < maxIter) {
    const cur = heap.pop();
    if (cl[cur] === 1 && st[cur] === curStamp) continue;
    cl[cur] = 1;
    if (cur === goal) {
      best = cur;
      break;
    }
    const hc = h(cur);
    if (hc < bestH) {
      bestH = hc;
      best = cur;
    }
    const cx = cur % W, cy = (cur / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!map.passable(nx, ny)) continue;
      // No cutting corners around blocked cells.
      if (d >= 4 && (!map.passable(cx + DX[d], cy) || !map.passable(cx, cy + DY[d]))) continue;
      const ni = ny * W + nx;
      const ng = g[cur] + COST[d];
      if (st[ni] !== curStamp) {
        st[ni] = curStamp;
        g[ni] = Infinity;
        cl[ni] = 0;
      }
      if (cl[ni] === 1) continue;
      if (ng < g[ni]) {
        g[ni] = ng;
        cf[ni] = cur;
        heap.push(ng + h(ni), ni);
      }
    }
  }
  // Walk back from the goal (or the closest cell we reached).
  const cells: number[] = [];
  let c = best;
  while (c !== -1 && c !== start) {
    cells.push(c);
    c = cf[c];
  }
  cells.reverse();
  if (!cells.length) return null;
  // String pulling: skip waypoints that have a clear line from the previous kept point.
  const out: Point[] = [];
  let fromX = sx + 0.5, fromY = sy + 0.5;
  let i = 0;
  while (i < cells.length) {
    let j = Math.min(cells.length - 1, i + 24);
    while (j > i) {
      const tx = (cells[j] % W) + 0.5, ty = ((cells[j] / W) | 0) + 0.5;
      if (lineClear(map, fromX, fromY, tx, ty)) break;
      j--;
    }
    const px = (cells[j] % W) + 0.5, py = ((cells[j] / W) | 0) + 0.5;
    out.push({ x: px, y: py });
    fromX = px;
    fromY = py;
    i = j + 1;
  }
  return out;
}
