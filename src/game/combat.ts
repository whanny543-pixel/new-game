// Targeting, weapons, projectiles, lingering fire/toxin fields and damage resolution.
import { ARMOR, VET_ARMOR, VET_DAMAGE } from '../core/data';
import type { DamageType, WeaponDef } from '../core/types';
import { angleDiff, dist, lerp, turnToward } from '../core/math';
import type { Entity, Player } from './entity';
import type { Game } from './game';

export interface Projectile {
  kind: 'shell' | 'rocket' | 'bomb' | 'sky';
  style: 'shell' | 'rocket' | 'bomb' | 'nuke' | 'scud' | 'missile' | 'napalm' | 'molotov' | 'barrage';
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  target: Entity | null;
  t: number;
  dur: number;
  speed: number;
  arc: number;
  damage: number;
  type: DamageType;
  splash: number;
  owner: Player;
  attacker: Entity | null;
  linger: number;
  delay: number;
  dead: boolean;
  vx: number;
  vy: number;
  dir: number;
}

export interface Field {
  x: number;
  y: number;
  r: number;
  t: number;
  dps: number;
  type: 'fire' | 'toxin' | 'rad';
  owner: Player;
}

const scratchDet: Entity[] = [];

/** Can weapon w (on shooter u) engage target t at all? */
export function canHit(u: Entity, w: WeaponDef, t: Entity) {
  if (t.isAir) {
    if (!w.air) return false;
  } else if (w.ground === false) return false;
  if (w.stun && t.isUnit && t.udef!.move === 'infantry') return false;
  if (u.udef?.suicide && t.isUnit && t.udef!.move === 'infantry') return false;
  return true;
}

export function validTarget(game: Game, u: Entity, t: Entity | null): t is Entity {
  if (!t || t.dead || t.kind === 'crate') return false;
  if (!game.isEnemy(u, t)) return false;
  if (t.owner.id < 0 && t.isBuilding) return false; // neutral derricks are captured, not shot
  if (t.stealthActive && !t.detected && t.revealTimer <= 0) return false;
  if (t.isUnit && t.udef!.jet && t.jetState === 'parked' && u.isUnit && u.udef!.move !== 'air' && !u.weapons.some((w) => w.ground !== false)) return false;
  if (t.isAir && t.udef!.jet && t.jetState === 'parked') return u.weapons.some((w) => w.ground !== false);
  return u.weapons.some((w) => canHit(u, w, t));
}

function maxRange(u: Entity) {
  let r = 0;
  for (const w of u.weapons) r = Math.max(r, w.range);
  return r;
}

/** Pick the best enemy within radius r of u. */
export function acquireTarget(game: Game, u: Entity, r: number): Entity | null {
  const cands = game.nearby(u.x, u.y, r);
  let best: Entity | null = null, bestScore = -Infinity;
  const suicide = !!u.udef?.suicide;
  const artillery = u.weapons.some((w) => (w.minRange ?? 0) > 0);
  for (const t of cands) {
    if (t === u || !validTarget(game, u, t)) continue;
    const d = Math.max(0, u.distTo(t) - t.radius);
    let score = -d;
    if (t.isUnit) {
      score += artillery ? 0 : 6;
      if (t.udef!.suicide) score += 8;
      if (t.udef!.gather || t.udef!.builder) score -= 2;
      if (t.canAttack && t.target === u) score += 5;
      if (suicide && t.udef!.move !== 'infantry') score += 10;
    } else {
      if (t.bdef!.weapons?.length) score += 4;
      if (artillery) score += 3;
      if (!t.built) score -= 2;
      if (suicide) score += 6;
    }
    if (t.isAir && u.weapons.some((w) => w.air && w.ground === false)) score += 10;
    // Hold fire against things only one weak weapon could scratch.
    // Never auto-engage things we can barely scratch (snipers vs tanks, rifles vs bunkers).
    let mult = 0;
    for (const w of u.weapons) if (canHit(u, w, t)) mult = Math.max(mult, ARMOR[w.type][t.armor]);
    if (mult < 0.1) continue;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export function updateCombat(game: Game, dt: number) {
  const time = game.time;
  // Stealth detection, staggered.
  if (Math.floor(time * 4) !== Math.floor((time - dt) * 4)) {
    for (const e of game.entities) if (!e.dead && e.stealthActive) e.detected = false;
    for (const d of game.entities) {
      if (d.dead) continue;
      const isDet = d.udef?.detector || d.bdef?.detector;
      if (!isDet || (d.isBuilding && !d.built)) continue;
      const near = game.spatial.query(d.x, d.y, d.sight, scratchDet);
      for (const e of near) if (e.stealthActive && !e.dead && game.isEnemy(d, e)) e.detected = true;
    }
  }

  for (const u of game.entities) {
    if (u.dead || u.kind === 'crate') continue;
    if (!u.weapons.length) continue;
    if (u.isBuilding && (!u.built || u.disabled)) continue;
    if (u.stun > 0 || u.dropping) continue;
    if (u.isUnit && u.udef!.jet && u.jetState === 'parked') {
      for (let i = 0; i < u.cooldowns.length; i++) u.cooldowns[i] = Math.max(0, u.cooldowns[i] - dt);
      continue;
    }
    const def = u.udef;
    const o = u.order;
    // Validate current target.
    if (u.target && !validTarget(game, u, u.target)) u.target = null;
    if (o.type === 'attack') u.target = o.target;
    // Acquire.
    u.retargetTimer -= dt;
    const range = maxRange(u);
    if (u.retargetTimer <= 0) {
      u.retargetTimer = 0.25 + (u.id % 7) * 0.03;
      if (o.type === 'attackmove' || (o.type === 'none' && def?.suicide)) {
        if (!u.target || u.distTo(u.target) > range + 6) u.target = acquireTarget(game, u, range + (def?.move === 'air' ? 8 : 5)) ?? u.target;
      } else if (o.type === 'none' || o.type === 'deploy' || o.type === 'gather' || u.isBuilding) {
        const chase = u.isBuilding ? 0 : 0.5;
        if (def?.gather || def?.builder || def?.hack) continue;
        if (!u.target || u.distTo(u.target) - u.target.radius > range + chase) u.target = acquireTarget(game, u, range + chase);
        if (u.target && u.distTo(u.target) - u.target.radius > range + chase + 1) u.target = null;
      } else if (o.type === 'move' && def?.move === 'air' && !def.jet) {
        u.target = acquireTarget(game, u, range);
      }
    }
    const t = u.target;
    // Turrets.
    const hasTurret = u.isBuilding || (def && def.move === 'vehicle' && def.model !== 'dozer');
    if (t) {
      const want = Math.atan2(t.y - u.y, t.x - u.x);
      if (hasTurret) u.turretDir = turnToward(u.turretDir, want, dt * 7);
      else if (def?.move === 'infantry' && !u.moving) u.dir = want;
    } else if (hasTurret && u.isUnit) u.turretDir = turnToward(u.turretDir, u.dir, dt * 3);
    // Fire weapons.
    for (let i = 0; i < u.weapons.length; i++) {
      const w = u.weapons[i];
      if (u.cooldowns[i] > 0) u.cooldowns[i] -= dt;
      if (u.burstLeft[i] > 0) {
        u.burstTimer[i] -= dt;
        if (u.burstTimer[i] <= 0 && t) {
          u.burstLeft[i]--;
          u.burstTimer[i] = 0.14;
          shoot(game, u, w, i, t);
        }
        continue;
      }
      if (u.cooldowns[i] > 0 || !t) continue;
      if (!canHit(u, w, t)) continue;
      if (u.clip[i] <= 0) continue;
      if (def?.suicide) continue;
      const d = u.distTo(t) - t.radius - (u.isBuilding ? u.radius * 0.5 : 0);
      if (d > w.range + 0.25 || (w.minRange && d < w.minRange)) continue;
      if (hasTurret && Math.abs(angleDiff(u.turretDir, Math.atan2(t.y - u.y, t.x - u.x))) > 0.35) continue;
      if (def?.jet && Math.abs(angleDiff(u.dir, Math.atan2(t.y - u.y, t.x - u.x))) > 0.6) continue;
      u.cooldowns[i] = w.cooldown;
      if (w.burst && w.burst > 1) {
        u.burstLeft[i] = w.burst - 1;
        u.burstTimer[i] = 0.14;
      }
      shoot(game, u, w, i, t);
    }
  }

  // Projectiles.
  const ps = game.projectiles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (p.delay > 0) {
      p.delay -= dt;
      continue;
    }
    updateProjectile(game, p, dt);
    if (p.dead) ps.splice(i, 1);
  }
  // Fields.
  const fs = game.fields;
  for (let i = fs.length - 1; i >= 0; i--) {
    const f = fs[i];
    f.t -= dt;
    if (f.t <= 0) {
      fs.splice(i, 1);
      continue;
    }
    if (Math.floor(time * 5) !== Math.floor((time - dt) * 5)) {
      const type: DamageType = f.type === 'fire' ? 'flame' : f.type === 'toxin' ? 'toxin' : 'explosion';
      for (const e of game.nearby(f.x, f.y, f.r)) {
        if (e.dead || e.kind === 'crate' || e.isAir) continue;
        if (e.owner.team === f.owner.team) continue;
        applyDamage(game, e, f.dps * 0.2, type, null);
      }
    }
  }
}

function muzzle(u: Entity) {
  const def = u.udef;
  const h = u.isBuilding ? 1.6 : def?.move === 'infantry' ? 0.9 : def?.move === 'air' ? 0 : 1.0;
  const a = u.isBuilding || def?.move === 'vehicle' ? u.turretDir : u.dir;
  const r = u.isBuilding ? Math.min(u.radius, 1.2) : u.radius * 0.9;
  return { x: u.x + Math.cos(a) * r, y: u.y + Math.sin(a) * r, z: u.z + h };
}

function shoot(game: Game, u: Entity, w: WeaponDef, i: number, t: Entity) {
  u.lastShot = game.time;
  u.revealTimer = Math.max(u.revealTimer, 2);
  u.stealthActive = false;
  if (u.clip[i] !== Infinity) u.clip[i]--;
  const m = muzzle(u);
  const tz = t.z + (t.isBuilding ? 1 : t.isAir ? 0 : 0.6);
  const ev = game.events;
  switch (w.projectile) {
    case 'instant': {
      ev.push({ kind: 'muzzle', x: m.x, y: m.y, z: m.z });
      ev.push({ kind: 'tracer', x1: m.x, y1: m.y, z1: m.z, x2: t.x, y2: t.y, z2: tz, style: w.type === 'sniper' ? 'sniper' : w.type === 'aa' ? 'aa' : 'gun' });
      ev.push({ kind: 'sound', name: w.type === 'sniper' ? 'sniper' : w.type === 'aa' ? 'gatling' : u.udef?.move === 'infantry' ? 'rifle' : 'mg', x: u.x, y: u.y });
      hitEntity(game, t, w, u, t.x, t.y);
      break;
    }
    case 'laser': {
      ev.push({ kind: 'tracer', x1: m.x, y1: m.y, z1: m.z, x2: t.x, y2: t.y, z2: tz, style: w.stun ? 'hack' : 'laser' });
      ev.push({ kind: 'sound', name: w.stun ? 'hack' : 'laser', x: u.x, y: u.y });
      hitEntity(game, t, w, u, t.x, t.y);
      if (w.stun) t.stun = Math.max(t.stun, w.stun);
      break;
    }
    case 'flame':
    case 'toxin': {
      const style = w.projectile === 'flame' ? 'fire' : 'toxin';
      ev.push({ kind: 'flame', x1: m.x, y1: m.y, z1: m.z, x2: t.x, y2: t.y, z2: t.z + 0.3, style });
      ev.push({ kind: 'sound', name: style === 'fire' ? 'flame' : 'spray', x: u.x, y: u.y });
      splashDamage(game, t.x, t.y, w.splash ?? 0.8, w.damage, w.type, u, null);
      if (w.linger) addField(game, t.x, t.y, w.linger, style === 'fire' ? 'fire' : 'toxin', 3, w.damage * 1.5, u.owner);
      break;
    }
    case 'shell': {
      ev.push({ kind: 'muzzle', x: m.x, y: m.y, z: m.z, big: true });
      ev.push({ kind: 'sound', name: w.range > 12 ? 'artillery' : 'cannon', x: u.x, y: u.y });
      const d = dist(m.x, m.y, t.x, t.y);
      const lead = t.isUnit && t.moving ? Math.min(1.5, d / (w.speed ?? 20)) * 0.9 : 0;
      const tx = t.x + (lead ? Math.cos(t.dir) * t.udef!.speed * lead : 0);
      const ty = t.y + (lead ? Math.sin(t.dir) * t.udef!.speed * lead : 0);
      game.projectiles.push(makeProjectile('shell', w.type === 'flame' && w.range < 8 ? 'molotov' : w.range > 12 ? (w.type === 'explosion' ? 'nuke' : 'barrage') : 'shell', m, tx, ty, t, w, u, d / (w.speed ?? 20), w.range > 12 ? 6 : 1.2));
      break;
    }
    case 'rocket': {
      ev.push({ kind: 'muzzle', x: m.x, y: m.y, z: m.z });
      ev.push({ kind: 'sound', name: w.range > 12 ? 'missile' : 'rocket', x: u.x, y: u.y });
      const style = w.range > 15 ? 'scud' : w.type === 'flame' ? 'napalm' : u.udef?.jet || w.range > 12 ? 'missile' : 'rocket';
      const p = makeProjectile('rocket', style, m, t.x, t.y, t, w, u, 0, w.range > 12 ? 5 : 1);
      p.dir = u.isBuilding || u.udef?.move === 'vehicle' ? u.turretDir : u.dir;
      game.projectiles.push(p);
      break;
    }
    case 'bomb': {
      ev.push({ kind: 'sound', name: 'bomb_drop', x: u.x, y: u.y });
      const p = makeProjectile('bomb', 'bomb', { x: u.x, y: u.y, z: u.z }, t.x, t.y, t, w, u, 0, 0);
      p.vx = Math.cos(u.dir) * (u.udef?.speed ?? 0) * 0.6;
      p.vy = Math.sin(u.dir) * (u.udef?.speed ?? 0) * 0.6;
      game.projectiles.push(p);
      break;
    }
  }
}

export function makeProjectile(kind: Projectile['kind'], style: Projectile['style'], from: { x: number; y: number; z: number }, tx: number, ty: number, target: Entity | null, w: WeaponDef, attacker: Entity | null, dur: number, arc: number): Projectile {
  return {
    kind, style, x: from.x, y: from.y, z: from.z, sx: from.x, sy: from.y, sz: from.z, tx, ty, target, t: 0,
    dur: Math.max(0.15, dur), speed: w.speed ?? 14, arc, damage: w.damage, type: w.type, splash: w.splash ?? 0,
    owner: attacker ? attacker.owner : null!, attacker, linger: w.linger ?? 0, delay: 0, dead: false, vx: 0, vy: 0,
    dir: 0,
  };
}

function updateProjectile(game: Game, p: Projectile, dt: number) {
  switch (p.kind) {
    case 'shell':
    case 'sky': {
      p.t += dt / p.dur;
      const t = Math.min(1, p.t);
      p.x = lerp(p.sx, p.tx, t);
      p.y = lerp(p.sy, p.ty, t);
      const gz = game.map.heightAt(p.tx, p.ty);
      p.z = p.kind === 'sky' ? lerp(p.sz, gz, t * t) : lerp(p.sz, gz, t) + Math.sin(t * Math.PI) * p.arc;
      if (p.t >= 1) impact(game, p, p.tx, p.ty);
      break;
    }
    case 'rocket': {
      if (p.target && !p.target.dead) {
        p.tx = p.target.x;
        p.ty = p.target.y;
      }
      const tz = p.target && !p.target.dead ? p.target.z + (p.target.isBuilding ? 0.8 : 0.4) : game.map.heightAt(p.tx, p.ty) + 0.2;
      p.t += dt;
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      // Lob high for long-range missiles, then dive.
      const total = dist(p.sx, p.sy, p.tx, p.ty);
      const prog = 1 - d / Math.max(0.01, total);
      const wantZ = tz + Math.sin(Math.min(1, Math.max(0, prog)) * Math.PI) * p.arc * 3;
      if (d <= step + 0.3) {
        const hitR = p.target && !p.target.dead ? p.target.radius : 0.4;
        if (p.target && !p.target.dead && dist(p.x, p.y, p.target.x, p.target.y) < hitR + 0.8) impact(game, p, p.target.x, p.target.y);
        else impact(game, p, p.tx, p.ty);
        break;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      p.z += (wantZ - p.z) * Math.min(1, dt * 6);
      p.dir = Math.atan2(dy, dx);
      if (p.t > 8) p.dead = true;
      break;
    }
    case 'bomb': {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z -= 9 * p.t * dt;
      const gz = game.map.heightAt(p.x, p.y);
      if (p.z <= gz + 0.1) impact(game, p, p.x, p.y);
      break;
    }
  }
}

function impact(game: Game, p: Projectile, x: number, y: number) {
  p.dead = true;
  const ev = game.events;
  const z = game.map.heightAt(x, y);
  const big = p.splash >= 2.5;
  const style = p.style === 'nuke' ? 'nuke' : p.type === 'flame' ? 'fire' : p.type === 'toxin' || p.style === 'scud' ? 'toxin' : 'blast';
  ev.push({ kind: 'explosion', x, y, z, size: Math.max(0.6, p.splash || 0.6) * (big ? 1.1 : 1), style });
  ev.push({ kind: 'sound', name: p.style === 'nuke' ? 'nuke' : big ? 'explosion_big' : p.splash > 1 ? 'explosion' : 'hit', x, y });
  if (p.style === 'nuke' || big) ev.push({ kind: 'shake', amount: p.style === 'nuke' ? 1.5 : 0.5 });
  if (p.splash > 0) splashDamage(game, x, y, p.splash, p.damage, p.type, p.attacker, p.owner);
  else if (p.target && !p.target.dead && dist(x, y, p.target.x, p.target.y) < p.target.radius + 0.7) {
    hitEntity(game, p.target, { damage: p.damage, type: p.type } as WeaponDef, p.attacker, x, y);
  }
  if (p.linger > 0) addField(game, x, y, p.linger, p.type === 'flame' ? 'fire' : p.type === 'toxin' || p.style === 'scud' ? 'toxin' : 'rad', p.style === 'nuke' ? 25 : 6, p.damage * 0.25, p.owner);
}

export function addField(game: Game, x: number, y: number, r: number, type: Field['type'], t: number, dps: number, owner: Player) {
  game.fields.push({ x, y, r, t, dps, type, owner });
}

function hitEntity(game: Game, t: Entity, w: { damage: number; type: DamageType; splash?: number }, attacker: Entity | null, x: number, y: number) {
  if (w.splash && w.splash > 0) splashDamage(game, x, y, w.splash, w.damage, w.type, attacker, attacker?.owner ?? null);
  else applyDamage(game, t, w.damage, w.type, attacker);
}

export function splashDamage(game: Game, x: number, y: number, r: number, damage: number, type: DamageType, attacker: Entity | null, owner: Player | null) {
  const team = attacker ? attacker.owner.team : owner ? owner.team : -99;
  for (const e of game.nearby(x, y, r)) {
    if (e.dead || e.kind === 'crate') continue;
    if (e.owner.team === team) continue;
    if (e.isAir && (type === 'flame' || type === 'toxin' || type === 'explosion' || type === 'bomb')) {
      if (e.z > 3) continue;
    }
    const d = Math.max(0, dist(x, y, e.x, e.y) - e.radius);
    const f = d < r * 0.5 ? 1 : lerp(1, 0.35, (d - r * 0.5) / (r * 0.5));
    applyDamage(game, e, damage * f, type, attacker);
  }
}

/** Apply damage with armour, veterancy, upgrades and battle plans; kills on zero. */
export function applyDamage(game: Game, t: Entity, amount: number, type: DamageType, attacker: Entity | null) {
  if (t.dead || t.kind === 'crate') return;
  let dmg = amount * ARMOR[type][t.armor];
  if (attacker) {
    const ap = attacker.owner;
    dmg *= VET_DAMAGE[attacker.vet];
    if (attacker.udef?.horde) {
      let n = 0;
      for (const o of game.nearby(attacker.x, attacker.y, 6)) if (o !== attacker && o.kind === 'unit' && !o.dead && o.owner === ap && o.udef!.horde) n++;
      if (n >= 4) dmg *= ap.upgrades.has('d_zeal') ? 1.5 : 1.25;
    }
    if (type === 'cannon' && ap.upgrades.has('d_uranium')) dmg *= 1.25;
    if (type === 'flame' && ap.upgrades.has('d_napalm')) dmg *= 1.25;
    if ((type === 'gun' || type === 'aa') && ap.upgrades.has('i_apbullets')) dmg *= 1.25;
    if (type === 'rocket' && ap.upgrades.has('i_aprockets')) dmg *= 1.25;
    if (ap.plan === 'bombard') dmg *= 1.1;
    if (attacker.salvageLevel) dmg *= 1 + 0.25 * attacker.salvageLevel;
  }
  dmg /= VET_ARMOR[t.vet];
  if (t.owner.plan === 'hold') dmg *= 0.9;
  if (t.udef?.armor === 'tank' && t.owner.upgrades.has('c_composite')) dmg *= 0.75;
  if (t.isBuilding && !t.built) dmg *= 1.5;
  t.hp -= dmg;
  t.lastDamaged = game.time;
  const p = t.owner;
  if (p.id >= 0) {
    if (t.isBuilding) {
      p.lastAttackedAt = game.time;
      p.lastAttackX = t.x;
      p.lastAttackY = t.y;
      game.eva(p, 'Base under attack', 15);
    } else if (!t.udef?.builder && !t.udef?.gather) {
      game.eva(p, 'Units under attack', 15);
    } else {
      p.lastAttackedAt = game.time;
      p.lastAttackX = t.x;
      p.lastAttackY = t.y;
    }
  }
  // Retaliate if idle.
  if (attacker && t.isUnit && t.canAttack && t.order.type === 'none' && !t.target && validTarget(game, t, attacker)) {
    const inReach = t.distTo(attacker) - attacker.radius <= maxRange(t) + 3;
    if (inReach) t.target = attacker;
  }
  if (t.hp <= 0) {
    t.hp = 0;
    game.kill(t, attacker);
  }
}
