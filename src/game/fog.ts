// Shroud (never explored: black) and fog (explored but not currently seen) for a player.
import type { GameMap } from '../core/map';
import type { Game } from './game';
import type { Player } from './entity';

export class Fog {
  readonly w: number;
  readonly h: number;
  readonly visible: Uint8Array;
  readonly explored: Uint8Array;
  version = 0;
  constructor(map: GameMap) {
    this.w = map.w;
    this.h = map.h;
    this.visible = new Uint8Array(map.w * map.h);
    this.explored = new Uint8Array(map.w * map.h);
  }
  visibleAt(x: number, y: number) {
    const cx = x | 0, cy = y | 0;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return this.visible[cy * this.w + cx] === 1;
  }
  exploredAt(x: number, y: number) {
    const cx = x | 0, cy = y | 0;
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return this.explored[cy * this.w + cx] === 1;
  }
  private stamp(x: number, y: number, r: number) {
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(this.w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(this.h - 1, Math.ceil(y + r));
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      const dy = cy + 0.5 - y;
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - x;
        if (dx * dx + dy * dy <= r2) {
          const i = cy * this.w + cx;
          this.visible[i] = 1;
          this.explored[i] = 1;
        }
      }
    }
  }
  update(game: Game, p: Player, _full: boolean) {
    this.visible.fill(0);
    for (const e of game.entities) {
      if (e.dead || e.owner.team !== p.team || e.kind === 'crate') continue;
      let r = e.sight;
      if (e.isBuilding && !e.built) r *= 0.5;
      if (e.owner.plan === 'search') r *= 1.15;
      this.stamp(e.x, e.y, r);
    }
    for (const q of game.players) if (q.team === p.team) for (const rv of q.reveals) this.stamp(rv.x, rv.y, rv.r);
    this.version++;
  }
}
