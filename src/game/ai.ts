// Skirmish AI: builds a base from a per-faction order, keeps gatherers busy, masses an army,
// attacks in waves, defends when hit, and uses powers and superweapons when they are ready.
import { BUILDINGS, FACTIONS, UNITS, UPGRADES } from '../core/data';
import type { FactionId } from '../core/types';
import { dist, TAU } from '../core/math';
import type { Entity, Player } from './entity';
import type { Game } from './game';

const BUILD_ORDER: Record<FactionId, string[]> = {
  coalition: ['c_reactor', 'c_barracks', 'c_supply', 'c_factory', 'c_reactor', 'c_aegis', 'c_supply', 'c_aegis', 'c_strategy', 'c_airfield', 'c_reactor', 'c_aegis', 'c_pad', 'c_reactor', 'c_lance', 'c_factory', 'c_aegis', 'c_reactor'],
  dominion: ['d_reactor', 'd_barracks', 'd_supply', 'd_factory', 'd_gatling', 'd_supply', 'd_gatling', 'd_hall', 'd_speaker', 'd_airfield', 'd_gatling', 'd_reactor', 'd_silo', 'd_factory', 'd_gatling', 'd_speaker'],
  insurgency: ['i_stash', 'i_barracks', 'i_arms', 'i_nest', 'i_stash', 'i_tunnel', 'i_nest', 'i_citadel', 'i_market', 'i_nest', 'i_tunnel', 'i_storm', 'i_arms', 'i_nest', 'i_trap'],
};

const ARMY: Record<FactionId, [string, number][]> = {
  coalition: [['c_rifleman', 3], ['c_rocket', 3], ['c_bulwark', 4], ['c_jackal', 1], ['c_javelin', 1.5], ['c_guardian', 2], ['c_raptor', 2], ['c_falcon', 1], ['c_pathfinder', 1], ['c_spectre', 0.5]],
  dominion: [['d_guard', 4], ['d_rocketeer', 3], ['d_warlord', 4], ['d_shredder', 2], ['d_inferno', 1], ['d_ember', 1], ['d_behemoth', 2], ['d_twinrotor', 1], ['d_vulture', 1], ['d_hacker', 1], ['d_atom', 0.6], ['d_lotus', 0.3]],
  insurgency: [['i_militia', 4], ['i_rpg', 3], ['i_viper', 4], ['i_guntruck', 1], ['i_flak', 2], ['i_buggy', 1.5], ['i_toxin', 1], ['i_ravager', 2], ['i_mob', 1], ['i_ballistic', 0.8], ['i_runner', 1], ['i_marksman', 0.3], ['i_demotruck', 0.4]],
};

const DEFENSES = new Set(['c_aegis', 'd_gatling', 'i_nest', 'i_tunnel', 'i_trap', 'd_speaker']);

interface Tuning {
  armyCap: number;
  /** Stop producing combat units above this total value until a wave goes out. */
  valueCap: number;
  attackValue: number;
  waveEvery: number;
  reserve: number;
  gatherersPerDepot: number;
  maxBuild: number;
  usePowers: boolean;
  /** No offensive waves before this many seconds. */
  firstAttack: number;
}
const TUNING: Record<'easy' | 'medium' | 'hard', Tuning> = {
  easy: { armyCap: 12, valueCap: 3000, attackValue: 2500, waveEvery: 300, reserve: 800, gatherersPerDepot: 2, maxBuild: 9, usePowers: false, firstAttack: 480 },
  medium: { armyCap: 22, valueCap: 4000, attackValue: 3500, waveEvery: 240, reserve: 400, gatherersPerDepot: 2, maxBuild: 15, usePowers: true, firstAttack: 330 },
  hard: { armyCap: 44, valueCap: 12000, attackValue: 5000, waveEvery: 180, reserve: 200, gatherersPerDepot: 3, maxBuild: 99, usePowers: true, firstAttack: 240 },
};

function isCombat(u: Entity) {
  const d = u.udef!;
  return d.weapons.length > 0 && !d.builder && !d.gather && !d.hack;
}

function baseCenter(game: Game, p: Player) {
  const bs = game.buildingsOf(p);
  if (!bs.length) return null;
  const cc = bs.find((b) => b.bdef!.command) ?? bs[0];
  return { x: cc.x, y: cc.y };
}

function enemyBuildings(game: Game, p: Player) {
  return game.entities.filter((e) => e.isBuilding && !e.dead && e.owner.id >= 0 && p.isEnemy(e.owner));
}

function nearestEnemyBuilding(game: Game, p: Player, x: number, y: number) {
  let best: Entity | null = null, bd = Infinity;
  for (const b of enemyBuildings(game, p)) {
    const d = dist(b.x, b.y, x, y) - (b.bdef!.command ? 6 : 0) - (b.bdef!.defense ? -3 : 0);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Spot with the most enemy buildings around it (superweapon target). */
function enemyBaseCore(game: Game, p: Player) {
  let best: Entity | null = null, bn = -1;
  const bs = enemyBuildings(game, p);
  for (const b of bs) {
    let n = 0;
    for (const o of bs) if (dist(b.x, b.y, o.x, o.y) < 9) n += o.bdef!.cost;
    if (n > bn) {
      bn = n;
      best = b;
    }
  }
  return best;
}

/** Densest cluster of enemy units (power target). */
function enemyArmyCluster(game: Game, p: Player, minValue: number) {
  const us = game.entities.filter((e) => e.isUnit && !e.dead && e.owner.id >= 0 && p.isEnemy(e.owner) && !e.isAir);
  let best: Entity | null = null, bv = 0;
  for (const u of us) {
    let v = 0;
    for (const o of us) if (dist(u.x, u.y, o.x, o.y) < 5) v += o.cost;
    if (v > bv) {
      bv = v;
      best = u;
    }
  }
  return bv >= minValue ? best : null;
}

function findSpot(game: Game, defId: string, cx: number, cy: number, dirX: number, dirY: number, minR: number, maxR: number) {
  const def = BUILDINGS[defId];
  const [w, h] = def.size;
  const rng = game.rng;
  for (let tries = 0; tries < 70; tries++) {
    const r = minR + rng.next() * (maxR - minR);
    const a = Math.atan2(dirY, dirX) + (rng.next() - 0.5) * (minR > 6 ? 1.4 : TAU);
    const x = Math.floor(cx + Math.cos(a) * r - w / 2), y = Math.floor(cy + Math.sin(a) * r - h / 2);
    if (game.map.canPlace(x - 1, y - 1, w + 2, h + 2)) return { x, y };
  }
  return null;
}

export function updateAi(game: Game, p: Player, dt: number) {
  const ai = p.ai!;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = 1.0;
  const T = TUNING[ai.difficulty];
  const f = FACTIONS[p.faction];
  const base = baseCenter(game, p);
  if (!base) return;
  const enemyCC = nearestEnemyBuilding(game, p, base.x, base.y);
  let dirX = 0, dirY = 1;
  if (enemyCC) {
    dirX = enemyCC.x - base.x;
    dirY = enemyCC.y - base.y;
    const l = Math.hypot(dirX, dirY) || 1;
    dirX /= l;
    dirY /= l;
  }
  const units = game.unitsOf(p);
  const buildings = game.buildingsOf(p);
  const builders = units.filter((u) => u.udef!.builder);
  const gatherers = units.filter((u) => u.udef!.gather);
  const army = units.filter(isCombat);
  const ins = p.faction === 'insurgency';

  // ---- builders: keep enough, assign idle ones to unfinished sites or repairs.
  const sites = buildings.filter((b) => !b.built);
  const idleBuilders = builders.filter((b) => b.order.type === 'none' || (ins && b.order.type === 'gather' && sites.some((s) => s.builders === 0)));
  for (const s of sites) {
    if (s.builders > 0) continue;
    const b = idleBuilders.sort((a, c) => a.distTo(s) - c.distTo(s))[0];
    if (b) {
      game.cmdBuildSite(b, s);
      idleBuilders.splice(idleBuilders.indexOf(b), 1);
    }
  }
  if (idleBuilders.length) {
    const hurt = buildings.filter((b) => b.built && b.hp < b.maxHp * 0.6 && game.time - b.lastDamaged > 6);
    if (hurt.length) game.cmdRepair([idleBuilders.pop()!], hurt[0]);
  }
  for (const b of idleBuilders) if (ins && b.order.type === 'none') game.cmdGather([b], null);
  const wantBuilders = ins ? 5 : 2;
  const cc = buildings.find((b) => b.bdef!.command && b.built);
  if (builders.length < wantBuilders && cc && !cc.production.length && p.money > UNITS[f.builder].cost + 200) {
    const producer = ins ? buildings.find((b) => b.built && b.bdef!.depot && !b.production.length) ?? cc : cc;
    game.cmdQueue(producer, f.builder);
  }

  // ---- construction from the build order (also rebuilds losses).
  const order = BUILD_ORDER[p.faction].slice(0, T.maxBuild);
  if (sites.length < (ai.difficulty === 'hard' ? 2 : 1) && game.time - ai.lastDozerOrder > 3) {
    const desired: Record<string, number> = {};
    for (let i = 0; i < Math.min(order.length, ai.buildIndex + 1); i++) desired[order[i]] = (desired[order[i]] ?? 0) + 1;
    let want: string | null = null;
    for (const id of Object.keys(desired)) {
      if (game.countOf(p, id) < desired[id]) {
        want = id;
        break;
      }
    }
    if (!want && ai.buildIndex < order.length - 1) {
      ai.buildIndex++;
      want = order[ai.buildIndex];
    }
    if (want) {
      const def = BUILDINGS[want];
      const blocker = game.buildBlocker(p, def);
      if (!blocker && p.money >= def.cost) {
        const defensive = DEFENSES.has(want);
        const spot = defensive
          ? findSpot(game, want, base.x, base.y, dirX, dirY, 10, 16)
          : def.depot
            ? (() => {
                // Depots go beside the nearest unclaimed dock.
                const taken = buildings.filter((b) => b.bdef!.depot);
                let bestDock = null as null | { x: number; y: number }, bd = Infinity;
                for (const d of game.map.docks) {
                  if (d.amount <= 0) continue;
                  if (taken.some((t) => dist(t.x, t.y, d.x, d.y) < 9)) continue;
                  const dd = dist(d.x, d.y, base.x, base.y);
                  if (dd < bd) {
                    bd = dd;
                    bestDock = d;
                  }
                }
                return bestDock ? findSpot(game, want!, bestDock.x + 1, bestDock.y + 1, 0, 0, 3, 7) : findSpot(game, want!, base.x, base.y, dirX, dirY, 5, 14);
              })()
            : findSpot(game, want, base.x, base.y, -dirX, -dirY, 4, 15) ?? findSpot(game, want, base.x, base.y, dirX, dirY, 4, 18);
        if (spot) {
          const builder = builders.filter((b) => b.order.type !== 'build').sort((a, b) => dist(a.x, a.y, spot.x, spot.y) - dist(b.x, b.y, spot.x, spot.y))[0] ?? null;
          if (builder || ins) {
            const err = game.cmdBuild(p, builder, want, spot.x, spot.y);
            if (!err) ai.lastDozerOrder = game.time;
          }
        }
      } else if (blocker && blocker.startsWith('Limit')) ai.buildIndex++;
    }
  }

  // ---- gatherers.
  const depots = buildings.filter((b) => b.built && b.bdef!.depot);
  const gatherDef = f.units.find((u) => u.gather)!;
  const wantGather = depots.length * (ins ? 4 : T.gatherersPerDepot);
  if (gatherers.length + game.queuedCount(p, gatherDef.id) < wantGather && p.money > gatherDef.cost + 100) {
    const d = depots.find((b) => !b.production.length);
    if (d) game.cmdQueue(d, gatherDef.id);
  }
  for (const g of gatherers) if (g.order.type === 'none' && !(ins && g.order.type !== 'none')) game.cmdGather([g], null);

  // ---- army production.
  const armyValueNow = army.reduce((s, u) => s + u.cost, 0);
  if (army.length < T.armyCap && armyValueNow < T.valueCap && p.money > T.reserve) {
    for (const b of buildings) {
      if (!b.built || !b.bdef!.produces || b.production.length) continue;
      const options = ARMY[p.faction].filter(([id]) => b.bdef!.produces!.includes(id) && !game.buildBlocker(p, UNITS[id]) && UNITS[id].cost + T.reserve <= p.money);
      if (!options.length) continue;
      if (ai.difficulty === 'easy' && game.time < 90) continue;
      const total = options.reduce((s, [, w]) => s + w, 0);
      let r = game.rng.next() * total;
      for (const [id, w] of options) {
        r -= w;
        if (r <= 0) {
          game.cmdQueue(b, id);
          break;
        }
      }
    }
  }
  // ---- upgrades.
  if (p.money > 4500) {
    for (const b of buildings) {
      if (!b.built || !b.bdef!.upgrades || b.production.length) continue;
      const up = b.bdef!.upgrades.find((id) => !p.upgrades.has(id) && game.queuedCount(p, id) === 0 && UPGRADES[id].cost < p.money - 2000);
      if (up) {
        game.cmdQueue(b, up);
        break;
      }
    }
  }
  if (!p.plan && game.hasBuilt(p, 'c_strategy')) p.plan = ai.difficulty === 'hard' ? 'bombard' : 'hold';

  // ---- hackers deploy, lotus captures.
  for (const u of units) {
    if (u.udef!.hack && u.order.type === 'none' && !u.deployed) game.cmdDeploy([u]);
    if (u.udef!.id === 'd_lotus' && u.order.type === 'none' && enemyCC) {
      const target = enemyBuildings(game, p).filter((b) => b.built && !b.bdef!.command && !b.bdef!.weapons).sort((a, b) => a.distTo(u) - b.distTo(u))[0];
      if (target) game.cmdCapture([u], target);
    }
  }
  // Capture neutral derricks with spare infantry.
  const derricks = game.entities.filter((e) => e.isBuilding && !e.dead && e.bdef!.capturable && e.owner !== p && e.owner.id < 0);
  if (derricks.length && game.time > 60) {
    const inf = army.filter((u) => u.udef!.capture && u.order.type === 'none');
    const d = derricks.sort((a, b) => dist(a.x, a.y, base.x, base.y) - dist(b.x, b.y, base.x, base.y))[0];
    if (inf.length && d && dist(d.x, d.y, base.x, base.y) < 45 && !inf.some((u) => u.order.type === 'capture')) game.cmdCapture([inf[0]], d);
  }

  // ---- defence / attack.
  const armyValue = army.reduce((s, u) => s + u.cost, 0);
  const underAttack = game.time - p.lastAttackedAt < 12;
  const jets = army.filter((u) => u.udef!.jet);
  const ground = army.filter((u) => !u.udef!.jet);
  if (underAttack && !ai.attacking) {
    if (game.time > ai.defendUntil) {
      ai.defendUntil = game.time + 10;
      ai.defendX = p.lastAttackX;
      ai.defendY = p.lastAttackY;
      const defenders = ground.filter((u) => u.order.type === 'none' || u.order.type === 'move');
      if (defenders.length) game.cmdMove(defenders, ai.defendX, ai.defendY, true);
      for (const j of jets) if (j.jetState === 'parked' && j.clip[0] > 0) {
        const t = game.nearby(ai.defendX, ai.defendY, 8).find((e) => e.isUnit && !e.dead && p.isEnemy(e.owner) && !e.isAir);
        if (t) game.cmdAttack([j], t);
      }
    }
  } else if (ai.attacking) {
    const t = ai.attackTarget;
    if (!t || t.dead) {
      const centroid = ground.length ? { x: ground.reduce((s, u) => s + u.x, 0) / ground.length, y: ground.reduce((s, u) => s + u.y, 0) / ground.length } : base;
      ai.attackTarget = nearestEnemyBuilding(game, p, centroid.x, centroid.y);
      if (!ai.attackTarget) ai.attacking = false;
      else game.cmdMove(ground, ai.attackTarget.x, ai.attackTarget.y, true);
    } else {
      const idle = ground.filter((u) => u.order.type === 'none' && u.distTo(t) > 10);
      if (idle.length) game.cmdMove(idle, t.x, t.y, true);
      for (const j of jets) if (j.jetState === 'parked' && j.clip[0] > 0 && j.order.type === 'none') {
        const near = game.nearby(t.x, t.y, 12).find((e) => e.isUnit && !e.dead && p.isEnemy(e.owner) && !e.isAir && e.udef!.move === 'vehicle') ?? t;
        game.cmdAttack([j], near);
      }
    }
    if (armyValue < T.attackValue * 0.3) {
      ai.attacking = false;
      ai.nextWave = game.time + T.waveEvery * 0.6;
      game.cmdMove(ground, base.x + dirX * 10, base.y + dirY * 10, true);
    }
  } else {
    if ((armyValue >= T.attackValue || game.time >= ai.nextWave) && game.time >= T.firstAttack && ground.length >= 6 && enemyCC) {
      ai.attacking = true;
      ai.nextWave = game.time + T.waveEvery;
      ai.attackTarget = enemyCC;
      game.cmdMove(ground, enemyCC.x, enemyCC.y, true);
    } else {
      // Muster between base and the enemy.
      const idle = ground.filter((u) => u.order.type === 'none' && u.idleTime > 8);
      if (idle.length) {
        const mx = base.x + dirX * 11, my = base.y + dirY * 11;
        const far = idle.filter((u) => dist(u.x, u.y, mx, my) > 7);
        if (far.length) game.cmdMove(far, mx, my, false);
      }
    }
  }

  // ---- generals powers.
  if (p.points > 0) {
    const prio = [...p.powers.values()].filter((ps) => ps.level < ps.def.levels && p.rank >= ps.def.rank).sort((a, b) => b.def.rank - a.def.rank || a.level - b.level);
    if (prio.length) game.cmdBuyPower(p, prio[0].def.id);
  }
  if (T.usePowers && Math.floor(game.time) % 5 === 0) {
    for (const ps of p.powers.values()) {
      if (ps.level <= 0 || ps.cooldown > 0) continue;
      const k = ps.def.kind;
      if (k === 'cashhack') game.cmdPower(p, ps.def.id, 0, 0);
      else if (k === 'airstrike' || k === 'barrage' || k === 'fuelair' || k === 'carpet' || k === 'toxinbomb') {
        const c = enemyArmyCluster(game, p, 2500) ?? enemyBaseCore(game, p);
        if (c) game.cmdPower(p, ps.def.id, c.x, c.y);
      } else if (k === 'emp') {
        if (underAttack) {
          const c = enemyArmyCluster(game, p, 1500);
          if (c && dist(c.x, c.y, base.x, base.y) < 30) game.cmdPower(p, ps.def.id, c.x, c.y);
        }
      } else if (k === 'paratroopers' || k === 'ambush') {
        if (ai.attacking && ai.attackTarget) game.cmdPower(p, ps.def.id, ai.attackTarget.x + dirX * -4, ai.attackTarget.y + dirY * -4);
        else if (underAttack) game.cmdPower(p, ps.def.id, ai.defendX, ai.defendY);
      } else if (k === 'repair') {
        const hurt = ground.filter((u) => u.udef!.move === 'vehicle' && u.hp < u.maxHp * 0.5);
        if (hurt.length >= 3) game.cmdPower(p, ps.def.id, hurt[0].x, hurt[0].y);
      } else if (k === 'mines') {
        game.cmdPower(p, ps.def.id, base.x + dirX * 13, base.y + dirY * 13);
      } else if (k === 'reveal' && enemyCC) game.cmdPower(p, ps.def.id, enemyCC.x, enemyCC.y);
      else if (k === 'sneak' && enemyCC && ai.attacking) game.cmdPower(p, ps.def.id, enemyCC.x - dirX * 10, enemyCC.y - dirY * 10);
      else if (k === 'scrambler' && ai.attacking && ground.length) game.cmdPower(p, ps.def.id, ground[0].x, ground[0].y);
    }
  }
  // ---- superweapons.
  for (const b of buildings) {
    if (!b.swReady) continue;
    const core = enemyBaseCore(game, p);
    if (core) game.cmdSuperweapon(b, core.x, core.y);
  }
  // Tunnels: dump stored units when the base is attacked.
  if (p.tunnelUnits.length && underAttack) {
    const t = buildings.find((b) => b.built && b.bdef!.tunnel);
    if (t) game.cmdExitTunnel(t);
  }
}
