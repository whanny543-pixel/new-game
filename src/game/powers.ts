// Generals powers (airstrikes, paradrops, hacks, mines...) and the three superweapons.
import { BUILDINGS, UNITS } from '../core/data';
import type { BuildingDef } from '../core/types';
import { dist, TAU } from '../core/math';
import { Entity, type Player } from './entity';
import { addField, applyDamage, makeProjectile, splashDamage } from './combat';
import type { Game } from './game';

export interface Flyer {
  model: 'cargo' | 'strike' | 'bomber' | 'spray';
  x: number;
  y: number;
  z: number;
  dir: number;
  speed: number;
  tx: number;
  ty: number;
  owner: Player;
  dropped: boolean;
  t: number;
  life: number;
  payload: (f: Flyer) => void;
  /** Called every tick while over the target line (carpet bombing). */
  tick?: (f: Flyer, dt: number) => void;
}

const MINE: BuildingDef = {
  id: 'n_mine', name: 'Mine', faction: 'dominion', cost: 0, buildTime: 0, hp: 60, power: 0, size: [1, 1], sight: 1,
  icon: 'trap', model: 'mine', desc: 'Hidden mine.', stealth: true, trap: 0.9, deathBlast: { damage: 260, radius: 1.6, type: 'explosion' },
};
BUILDINGS[MINE.id] = MINE;

/** Send a plane from the map edge through the target. */
export function spawnFlyer(game: Game, owner: Player, model: Flyer['model'], tx: number, ty: number, payload: Flyer['payload'], tick?: Flyer['tick']) {
  // Come in from the owner's side of the map.
  const cc = game.buildingsOf(owner, (b) => !!b.bdef!.command)[0];
  const fx = cc ? cc.x : game.map.w / 2, fy = cc ? cc.y : -10;
  let a = Math.atan2(ty - fy, tx - fx);
  if (!isFinite(a)) a = Math.PI / 2;
  const start = 46;
  const f: Flyer = {
    model, x: tx - Math.cos(a) * start, y: ty - Math.sin(a) * start, z: 11, dir: a,
    speed: model === 'bomber' ? 16 : model === 'strike' ? 18 : 12, tx, ty, owner, dropped: false, t: 0, life: (start * 2 + 10) / 12,
    payload, tick,
  };
  f.life = (start * 2 + 12) / f.speed;
  game.flyers.push(f);
  game.events.push({ kind: 'sound', name: 'jet_pass', x: tx, y: ty });
  return f;
}

export function updatePowers(game: Game, dt: number) {
  const fl = game.flyers;
  for (let i = fl.length - 1; i >= 0; i--) {
    const f = fl[i];
    f.t += dt;
    f.x += Math.cos(f.dir) * f.speed * dt;
    f.y += Math.sin(f.dir) * f.speed * dt;
    const d = dist(f.x, f.y, f.tx, f.ty);
    if (!f.dropped && d < f.speed * 0.25) {
      f.dropped = true;
      f.payload(f);
    }
    if (f.tick) f.tick(f, dt);
    if (f.t > f.life) fl.splice(i, 1);
  }
  // Solar Lance beams.
  for (const p of game.players) {
    const L = p.lance;
    if (!L) continue;
    L.t -= dt;
    const dx = L.tx - L.x, dy = L.ty - L.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(d, 4 * dt);
    if (d > 0.01) {
      L.x += (dx / d) * step;
      L.y += (dy / d) * step;
    }
    if (Math.floor(game.time * 10) !== Math.floor((game.time - dt) * 10)) {
      splashDamage(game, L.x, L.y, 2.6, 60, 'bomb', null, p);
      game.events.push({ kind: 'explosion', x: L.x, y: L.y, z: game.map.heightAt(L.x, L.y), size: 1.6, style: 'lance' });
      if (Math.floor(game.time * 2) !== Math.floor((game.time - dt) * 2)) addField(game, L.x, L.y, 1.6, 'fire', 4, 30, p);
    }
    if (L.t <= 0) p.lance = null;
  }
}

function enemyOf(game: Game, p: Player) {
  const es = game.playersAlive.filter((q) => q.isEnemy(p));
  if (!es.length) return null;
  return es.reduce((a, b) => (a.money > b.money ? a : b));
}

export function usePower(game: Game, p: Player, id: string, x: number, y: number): string | null {
  const ps = p.powers.get(id);
  if (!ps) return 'Unknown power';
  if (ps.level <= 0) return 'Not unlocked';
  if (ps.cooldown > 0) return 'Recharging';
  const def = ps.def;
  const lvl = ps.level;
  const ev = game.events;
  switch (def.kind) {
    case 'reveal':
      p.reveals.push({ x, y, r: def.radius, t: 40 });
      ev.push({ kind: 'explosion', x, y, z: game.map.heightAt(x, y) + 6, size: 1, style: 'spark' });
      break;
    case 'paratroopers':
    case 'ambush': {
      const n = def.kind === 'paratroopers' ? [0, 4, 8, 12][lvl] : [0, 4, 6, 8][lvl];
      const unit = def.kind === 'paratroopers' ? 'c_rifleman' : 'i_militia';
      const drop = () => {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU, r = 1 + (i % 3);
          const u = game.spawnUnit(p, unit, x + Math.cos(a) * r, y + Math.sin(a) * r, { vet: 1, dropping: def.kind === 'paratroopers', z: def.kind === 'paratroopers' ? 12 : 0 });
          if (u) u.order = { type: 'attackmove', x: x + Math.cos(a) * 3, y: y + Math.sin(a) * 3 };
        }
        ev.push({ kind: 'sound', name: def.kind === 'ambush' ? 'ambush' : 'paradrop', x, y });
      };
      if (def.kind === 'paratroopers') spawnFlyer(game, p, 'cargo', x, y, drop);
      else drop();
      break;
    }
    case 'repair': {
      const f = [0, 0.3, 0.6, 1][lvl];
      for (const e of game.nearby(x, y, def.radius)) if (!e.dead && e.owner === p && e.isUnit && e.udef!.move !== 'infantry') e.hp = Math.min(e.maxHp, e.hp + e.maxHp * f);
      ev.push({ kind: 'explosion', x, y, z: game.map.heightAt(x, y), size: def.radius, style: 'spark' });
      ev.push({ kind: 'sound', name: 'repair', x, y });
      break;
    }
    case 'airstrike': {
      const planes = lvl;
      for (let k = 0; k < planes; k++) {
        const ox = (k - (planes - 1) / 2) * 3;
        spawnFlyer(game, p, 'strike', x + ox, y, () => {}, (f, dt) => {
          // Strafe: fire rockets at enemies near the line while within 10 of the target.
          if (dist(f.x, f.y, f.tx, f.ty) > 9) return;
          if (Math.floor(f.t * 6) === Math.floor((f.t - dt) * 6)) return;
          let best: Entity | null = null, bd = 7;
          for (const e of game.nearby(f.tx, f.ty, 7)) {
            if (e.dead || e.kind === 'crate' || e.isAir || !p.isEnemy(e.owner) || e.owner.id < 0) continue;
            const d = dist(e.x, e.y, f.tx, f.ty);
            if (d < bd) {
              bd = d;
              best = e;
            }
          }
          const tx = best ? best.x : f.tx + (game.rng.next() - 0.5) * 4, ty = best ? best.y : f.ty + (game.rng.next() - 0.5) * 4;
          const pr = makeProjectile('rocket', 'missile', { x: f.x, y: f.y, z: f.z }, tx, ty, best, { damage: 110, type: 'rocket', range: 10, cooldown: 1, projectile: 'rocket', splash: 1.2, speed: 26 }, null, 0, 0.5);
          pr.owner = p;
          game.projectiles.push(pr);
          ev.push({ kind: 'sound', name: 'rocket', x: f.x, y: f.y });
        });
      }
      break;
    }
    case 'fuelair':
      spawnFlyer(game, p, 'bomber', x, y, (f) => {
        const pr = makeProjectile('bomb', 'bomb', { x: f.x, y: f.y, z: f.z }, x, y, null, { damage: 1000, type: 'bomb', range: 1, cooldown: 1, projectile: 'bomb', splash: 7 }, null, 0, 0);
        pr.owner = p;
        pr.vx = Math.cos(f.dir) * 5;
        pr.vy = Math.sin(f.dir) * 5;
        game.projectiles.push(pr);
      });
      break;
    case 'barrage': {
      const n = [0, 12, 24, 36][lvl];
      for (let i = 0; i < n; i++) {
        const a = game.rng.next() * TAU, r = Math.sqrt(game.rng.next()) * def.radius;
        const tx = x + Math.cos(a) * r, ty = y + Math.sin(a) * r;
        const pr = makeProjectile('sky', 'barrage', { x: tx - 6, y: ty - 20, z: 30 }, tx, ty, null, { damage: 130, type: 'explosion', range: 1, cooldown: 1, projectile: 'shell', splash: 1.8 }, null, 1.1, 0);
        pr.owner = p;
        pr.delay = 1 + (i / n) * 7;
        game.projectiles.push(pr);
      }
      ev.push({ kind: 'sound', name: 'artillery', x, y });
      break;
    }
    case 'cashhack': {
      const amt = [0, 1000, 2000, 4000][lvl];
      const e = enemyOf(game, p);
      const got = e ? Math.min(amt, Math.max(0, e.money)) : 0;
      if (e) e.money -= got;
      p.money += got;
      ev.push({ kind: 'sound', name: 'cash', x: 0, y: 0 });
      if (e?.human) game.eva(e, 'Funds stolen', 1);
      break;
    }
    case 'mines': {
      for (let i = 0; i < 10; i++) {
        const a = game.rng.next() * TAU, r = Math.sqrt(game.rng.next()) * def.radius;
        const cx = Math.floor(x + Math.cos(a) * r), cy = Math.floor(y + Math.sin(a) * r);
        if (!game.map.walkable(cx, cy)) continue;
        const m = game.placeBuilding(p, MINE, cx, cy, true);
        if (m) m.z = game.map.heightAt(m.x, m.y);
      }
      ev.push({ kind: 'sound', name: 'place', x, y });
      break;
    }
    case 'emp': {
      for (const e of game.nearby(x, y, def.radius)) {
        if (e.dead || e.kind === 'crate' || !p.isEnemy(e.owner)) continue;
        if (e.isBuilding || e.udef!.move !== 'infantry') e.stun = Math.max(e.stun, 20);
      }
      ev.push({ kind: 'explosion', x, y, z: game.map.heightAt(x, y) + 2, size: def.radius, style: 'emp' });
      ev.push({ kind: 'sound', name: 'emp', x, y });
      break;
    }
    case 'carpet':
      spawnFlyer(game, p, 'bomber', x, y, () => {}, (f, dt) => {
        if (dist(f.x, f.y, f.tx, f.ty) > 9) return;
        if (Math.floor(f.t * 5) === Math.floor((f.t - dt) * 5)) return;
        const pr = makeProjectile('bomb', 'bomb', { x: f.x, y: f.y, z: f.z }, f.x, f.y, null, { damage: 260, type: 'bomb', range: 1, cooldown: 1, projectile: 'bomb', splash: 2.4 }, null, 0, 0);
        pr.owner = p;
        pr.vx = Math.cos(f.dir) * 6;
        pr.vy = Math.sin(f.dir) * 6;
        game.projectiles.push(pr);
      });
      break;
    case 'toxinbomb':
      spawnFlyer(game, p, 'spray', x, y, (f) => {
        const r = [0, 4, 5.5, 7][lvl];
        const pr = makeProjectile('bomb', 'bomb', { x: f.x, y: f.y, z: f.z }, x, y, null, { damage: 180, type: 'toxin', range: 1, cooldown: 1, projectile: 'bomb', splash: r, linger: r }, null, 0, 0);
        pr.owner = p;
        pr.vx = Math.cos(f.dir) * 4;
        pr.vy = Math.sin(f.dir) * 4;
        game.projectiles.push(pr);
      });
      break;
    case 'sneak': {
      const cx = Math.floor(x) - 1, cy = Math.floor(y) - 1;
      const c = game.map.canPlace(cx, cy, 2, 2) ? { x: cx, y: cy } : game.map.nearestFree(cx, cy, 8);
      if (!c) return 'No room for a tunnel there';
      const t = game.placeBuilding(p, BUILDINGS['i_tunnel'], c.x, c.y, true);
      if (!t) return 'No room for a tunnel there';
      ev.push({ kind: 'explosion', x: t.x, y: t.y, z: t.z, size: 2, style: 'smoke' });
      ev.push({ kind: 'sound', name: 'ambush', x, y });
      break;
    }
    case 'scrambler':
      for (const e of game.nearby(x, y, def.radius)) if (!e.dead && e.isUnit && e.owner === p) e.scrambleTimer = 40;
      ev.push({ kind: 'explosion', x, y, z: game.map.heightAt(x, y) + 1, size: def.radius, style: 'emp' });
      break;
    case 'bounty':
      return 'Passive';
  }
  ps.cooldown = def.cooldown;
  ev.push({ kind: 'power', player: p, id, x, y });
  return null;
}

export function fireSuperweapon(game: Game, b: Entity, x: number, y: number) {
  const p = b.owner;
  const sw = b.bdef!.superweapon;
  if (!sw || b.dead) return;
  if (sw.kind === 'lance' && p.lance) {
    p.lance.tx = x;
    p.lance.ty = y;
    return;
  }
  if (!b.swReady) return;
  b.swReady = false;
  b.swTimer = sw.cooldown;
  const ev = game.events;
  ev.push({ kind: 'superweapon', player: p, what: sw.kind, x, y });
  for (const q of game.players) {
    if (!q.human) continue;
    const msg = sw.kind === 'lance' ? 'Warning. Solar Lance firing' : sw.kind === 'nuke' ? 'Warning. Nuclear launch detected' : 'Warning. Rocket Storm launch detected';
    game.eva(q, msg, 1);
  }
  switch (sw.kind) {
    case 'lance':
      p.lance = { x, y, tx: x, ty: y, t: 9 };
      ev.push({ kind: 'sound', name: 'lance', x, y });
      break;
    case 'nuke': {
      const pr = makeProjectile('sky', 'nuke', { x: b.x, y: b.y, z: 40 }, x, y, null, { damage: 3200, type: 'bomb', range: 1, cooldown: 1, projectile: 'shell', splash: 9.5, linger: 7 }, null, 9, 0);
      pr.owner = p;
      pr.sz = 42;
      pr.sx = x + (b.x - x) * 0.3;
      pr.sy = y + (b.y - y) * 0.3;
      game.projectiles.push(pr);
      ev.push({ kind: 'sound', name: 'siren', x, y });
      break;
    }
    case 'storm':
      for (let i = 0; i < 9; i++) {
        const a = game.rng.next() * TAU, r = Math.sqrt(game.rng.next()) * 4.5;
        const tx = x + Math.cos(a) * r, ty = y + Math.sin(a) * r;
        const pr = makeProjectile('sky', 'scud', { x: b.x, y: b.y, z: 34 }, tx, ty, null, { damage: 420, type: 'explosion', range: 1, cooldown: 1, projectile: 'shell', splash: 3.6, linger: 3.2 }, null, 6, 0);
        pr.owner = p;
        pr.delay = i * 0.5;
        game.projectiles.push(pr);
      }
      ev.push({ kind: 'sound', name: 'siren', x, y });
      break;
  }
}

/** Damage helper exported for the AI to judge targets. */
export { applyDamage, UNITS };
