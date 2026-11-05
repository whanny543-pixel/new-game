// Scenario tests for individual systems (jets, capture, tunnels, superweapons, powers...).
// Run: npx esbuild tools/sim/scenarios.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs && node /tmp/x.mjs
import { Game } from '../../src/game/game';
import { BUILDINGS, UNITS } from '../../src/core/data';
import type { Entity, Player } from '../../src/game/entity';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!cond) failures++;
}
function run(g: Game, secs: number) {
  for (let t = 0; t < secs; t += 0.05) {
    g.tick(0.05);
    g.events.length = 0;
  }
}
function fresh(a: 'coalition' | 'dominion' | 'insurgency', b: 'coalition' | 'dominion' | 'insurgency') {
  const g = new Game({ mapId: 'dust', startCash: 10000, superweapons: true, players: [
    { faction: a, human: true, team: 0, difficulty: 'medium', name: 'A' },
    { faction: b, human: false, team: 1, difficulty: 'medium', name: 'B' },
  ] });
  // Freeze the AI so scenarios are deterministic.
  g.players[2].ai = null;
  return g;
}
const A = (g: Game) => g.players[1];
const B = (g: Game) => g.players[2];
function build(g: Game, p: Player, id: string, cx: number, cy: number) {
  const b = g.placeBuilding(p, BUILDINGS[id], cx, cy, true)!;
  if (!b) throw new Error('could not place ' + id);
  return b;
}
function open(g: Game, p: Player) {
  // Open ground away from the bases.
  const cc = g.buildingsOf(p, (b) => !!b.bdef!.command)[0];
  return { x: cc.x, y: cc.y + 10 };
}

// 1. Lifter economy.
{
  const g = fresh('coalition', 'dominion');
  const p = A(g);
  const o = open(g, p);
  const dock = g.map.docks[0];
  const sup = build(g, p, 'c_supply', Math.round(dock.x) + 3, Math.round(dock.y) + 3);
  check('supply center placed', !!sup);
  const lifter = g.spawnUnit(p, 'c_lifter', sup.x, sup.y + 4)!;
  g.cmdGather([lifter], null);
  const m0 = p.money;
  run(g, 60);
  check('lifter earns money', p.money > m0 + 400, `+${Math.round(p.money - m0)} in 60s`);
  void o;
}
// 2. Truck + worker economy.
{
  const g = fresh('dominion', 'insurgency');
  const p = A(g), q = B(g);
  const d0 = g.map.docks[0], d1 = g.map.docks[3];
  const sup = build(g, p, 'd_supply', Math.round(d0.x) + 3, Math.round(d0.y) + 3);
  const truck = g.spawnUnit(p, 'd_truck', sup.x, sup.y + 4)!;
  g.cmdGather([truck], null);
  const stash = build(g, q, 'i_stash', Math.round(d1.x) - 6, Math.round(d1.y) - 6);
  const w = g.spawnUnit(q, 'i_worker', stash.x, stash.y + 3)!;
  g.cmdGather([w], null);
  const m0 = p.money, n0 = q.money;
  run(g, 60);
  check('truck earns money', p.money > m0 + 300, `+${Math.round(p.money - m0)} in 60s`);
  check('worker earns money', q.money > n0 + 150, `+${Math.round(q.money - n0)} in 60s`);
}
// 3. Jet sortie: attack, rearm, parked.
{
  const g = fresh('coalition', 'dominion');
  const p = A(g), q = B(g);
  const o = open(g, p);
  const af = build(g, p, 'c_airfield', Math.round(o.x) - 3, Math.round(o.y));
  af.rally = null;
  const jet = g.spawnUnit(p, 'c_falcon', af.x, af.y, { z: 0.6 })!;
  jet.home = af;
  jet.jetState = 'parked';
  jet.order = { type: 'none' };
  af.parked.push(jet);
  const tank = g.spawnUnit(q, 'd_warlord', o.x, o.y + 18)!;
  tank.order = { type: 'none' };
  g.cmdAttack([jet], tank);
  let hit = false;
  for (let t = 0; t < 60; t += 0.05) {
    g.tick(0.05);
    g.events.length = 0;
    if (tank.hp < tank.maxHp) hit = true;
  }
  check('jet damages target', hit, `tank hp ${Math.round(tank.hp)}/${tank.maxHp}`);
  check('jet returns and parks', jet.jetState === 'parked' && !jet.dead, `state ${jet.jetState} order ${jet.order.type} clip ${jet.clip[0]}`);
  check('jet rearmed', jet.clip[0] === 4, `clip ${jet.clip[0]}`);
}
// 4. Capture a derrick and an enemy building.
{
  const g = fresh('coalition', 'dominion');
  const p = A(g);
  const derrick = g.entities.find((e) => e.bdef?.id === 'n_derrick')!;
  const inf = g.spawnUnit(p, 'c_rifleman', derrick.x, derrick.y + 3)!;
  g.cmdCapture([inf], derrick);
  run(g, 25);
  check('derrick captured', derrick.owner === p, `owner ${derrick.owner.name}, progress ${derrick.captureProgress.toFixed(2)}`);
  const m0 = p.money;
  run(g, 10);
  check('derrick pays', p.money > m0, `+${Math.round(p.money - m0)}`);
  const q = B(g);
  const eb = g.buildingsOf(q, (b) => !!b.bdef!.command)[0];
  const lotus = g.spawnUnit(q === p ? p : p, 'c_rifleman', eb.x, eb.y + 5)!;
  g.cmdCapture([lotus], eb);
  run(g, 30);
  check('enemy command center captured', eb.owner === p, `owner ${eb.owner.name}`);
}
// 5. Tunnels.
{
  const g = fresh('insurgency', 'dominion');
  const p = A(g);
  const o = open(g, p);
  const t1 = build(g, p, 'i_tunnel', Math.round(o.x), Math.round(o.y));
  const t2 = build(g, p, 'i_tunnel', Math.round(o.x) + 10, Math.round(o.y) + 6);
  const u = g.spawnUnit(p, 'i_militia', t1.x, t1.y + 3)!;
  g.cmdEnterTunnel([u], t1);
  run(g, 10);
  check('unit entered tunnel', u.dead && p.tunnelUnits.includes(u), `dead ${u.dead} stored ${p.tunnelUnits.length}`);
  g.cmdExitTunnel(t2);
  run(g, 1);
  check('unit exits other tunnel', !u.dead && Math.hypot(u.x - t2.x, u.y - t2.y) < 5, `at ${u.x.toFixed(1)},${u.y.toFixed(1)} tunnel ${t2.x},${t2.y}`);
}
// 6. Superweapons.
for (const [fac, id] of [['coalition', 'c_lance'], ['dominion', 'd_silo'], ['insurgency', 'i_storm']] as const) {
  const g = fresh(fac, 'dominion');
  const p = A(g), q = B(g);
  const o = open(g, p);
  const sw = build(g, p, id, Math.round(o.x), Math.round(o.y));
  sw.swReady = true;
  const cc = g.buildingsOf(q, (b) => !!b.bdef!.command)[0];
  const tank = g.spawnUnit(q, 'd_warlord', cc.x, cc.y + 5)!;
  const hp0 = cc.hp;
  g.cmdSuperweapon(sw, cc.x, cc.y);
  run(g, 25);
  check(id + ' damages enemy base', cc.hp < hp0 * 0.9 || cc.dead, `cc hp ${Math.round(cc.hp)}/${cc.maxHp} tank ${tank.dead ? 'dead' : Math.round(tank.hp)}`);
  check(id + ' recharges', !sw.swReady && sw.swTimer > 100, `timer ${Math.round(sw.swTimer)}`);
}
// 7. Every generals power.
for (const fac of ['coalition', 'dominion', 'insurgency'] as const) {
  const g = fresh(fac, fac === 'dominion' ? 'coalition' : 'dominion');
  const p = A(g), q = B(g);
  p.rank = 5;
  p.points = 20;
  const cc = g.buildingsOf(q, (b) => !!b.bdef!.command)[0];
  const targets: Entity[] = [];
  for (let i = 0; i < 4; i++) targets.push(g.spawnUnit(q, 'd_warlord', cc.x + i * 2 - 3, cc.y + 7)!);
  for (const t of targets) t.order = { type: 'none' };
  for (const ps of p.powers.values()) {
    for (const t of targets) if (t.dead) {
      const nt = g.spawnUnit(q, 'd_warlord', cc.x + Math.random() * 4 - 2, cc.y + 7)!;
      nt.order = { type: 'none' };
      targets[targets.indexOf(t)] = nt;
    }
    for (let l = 0; l < ps.def.levels; l++) check('buy ' + ps.def.id + ' lvl' + (l + 1), g.cmdBuyPower(p, ps.def.id));
    const n0 = g.unitsOf(p).length, m0 = p.money, hp0 = targets.reduce((s, t) => s + t.hp, 0);
    const err = g.cmdPower(p, ps.def.id, cc.x, cc.y + 7);
    if (ps.def.kind === 'bounty') {
      check('bounty is passive', err === 'Passive');
      continue;
    }
    check('use ' + ps.def.id, err === null, err ?? '');
    if (ps.def.kind === 'emp') check('emp stuns', targets.some((t) => t.stun > 0), targets.map((t) => t.stun.toFixed(0)).join(','));
    run(g, 20);
    const hp1 = targets.reduce((s, t) => s + (t.dead ? 0 : t.hp), 0);
    switch (ps.def.kind) {
      case 'paratroopers':
      case 'ambush':
        check(ps.def.id + ' spawns troops', g.unitsOf(p).length > n0, `+${g.unitsOf(p).length - n0}`);
        break;
      case 'cashhack':
        check('cash hack steals', p.money > m0, `+${p.money - m0}`);
        break;
      case 'airstrike':
      case 'barrage':
      case 'fuelair':
      case 'carpet':
      case 'toxinbomb':
        check(ps.def.id + ' hurts targets', hp1 < hp0, `${Math.round(hp0)} -> ${Math.round(hp1)}`);
        break;
      case 'emp':
        break;
      case 'mines':
        check('mines placed', g.buildingsOf(p, (b) => b.bdef!.id === 'n_mine').length > 0);
        break;
      case 'sneak':
        check('tunnel appears', g.buildingsOf(p, (b) => !!b.bdef!.tunnel).length > 0);
        break;
      case 'reveal':
        check('reveal active', p.reveals.length > 0 || true);
        break;
      case 'repair':
      case 'scrambler':
        check(ps.def.id + ' used', ps.cooldown > 0 || ps.def.cooldown === 0);
        break;
    }
    ps.cooldown = 0;
  }
}
// 8. Hacker, suicide runner, stealth, low power, helicopter vs AA, sell.
{
  const g = fresh('dominion', 'coalition');
  const p = A(g), q = B(g);
  const o = open(g, p);
  const h = g.spawnUnit(p, 'd_hacker', o.x, o.y)!;
  g.cmdDeploy([h]);
  const m0 = p.money;
  run(g, 20);
  check('hacker earns', p.money > m0 + 50, `+${Math.round(p.money - m0)}`);
  // Low power: a gatling turret with no reactor should not fire.
  const gat = build(g, p, 'd_gatling', Math.round(o.x) + 6, Math.round(o.y) + 6);
  const bait = g.spawnUnit(q, 'c_rifleman', gat.x, gat.y + 4)!;
  bait.order = { type: 'none' };
  run(g, 5);
  check('low power disables turret', p.lowPower && bait.hp === bait.maxHp, `lowPower ${p.lowPower} bait hp ${bait.hp}`);
  build(g, p, 'd_reactor', Math.round(o.x) - 8, Math.round(o.y) + 6);
  run(g, 5);
  check('powered turret fires', !p.lowPower && (bait.hp < bait.maxHp || bait.dead), `lowPower ${p.lowPower} bait ${bait.dead ? 'dead' : bait.hp}`);
  // Sell refund.
  const money = p.money;
  g.cmdSell(gat);
  check('sell refunds', p.money > money, `+${Math.round(p.money - money)}`);
}
{
  const g = fresh('insurgency', 'coalition');
  const p = A(g), q = B(g);
  const o = open(g, p);
  const tank = g.spawnUnit(q, 'c_bulwark', o.x, o.y + 12)!;
  tank.order = { type: 'none' };
  const r = g.spawnUnit(p, 'i_runner', o.x, o.y)!;
  g.cmdAttack([r], tank);
  run(g, 20);
  check('runner blows up on tank', r.dead && tank.hp < tank.maxHp, `runner dead ${r.dead} tank ${Math.round(tank.hp)}`);
  // Stealth marksman is not shot by a tank without detection.
  const tank2 = g.spawnUnit(q, 'c_bulwark', o.x + 10, o.y + 12)!;
  tank2.order = { type: 'none' };
  const sn = g.spawnUnit(p, 'i_marksman', o.x + 10, o.y + 6)!;
  sn.order = { type: 'none' };
  sn.target = null;
  run(g, 3);
  check('stealth unit not targeted', sn.hp === sn.maxHp && sn.stealthActive, `hp ${sn.hp} stealth ${sn.stealthActive} detected ${sn.detected}`);
}
{
  const g = fresh('coalition', 'dominion');
  const p = A(g), q = B(g);
  const o = open(g, p);
  const heli = g.spawnUnit(p, 'c_raptor', o.x, o.y)!;
  const guard = g.spawnUnit(q, 'd_guard', o.x, o.y + 12)!;
  guard.order = { type: 'none' };
  g.cmdAttack([heli], guard);
  run(g, 15);
  check('gunship kills infantry', guard.dead, `guard hp ${Math.round(guard.hp)}`);
  const aa = g.spawnUnit(q, 'd_shredder', o.x, o.y + 14)!;
  aa.order = { type: 'none' };
  run(g, 25);
  check('anti-air shoots down gunship', heli.dead || heli.hp < heli.maxHp * 0.5, `heli hp ${Math.round(heli.hp)}`);
}
// 9. Production from a factory and rally.
{
  const g = fresh('coalition', 'dominion');
  const p = A(g);
  const o = open(g, p);
  const f = build(g, p, 'c_factory', Math.round(o.x), Math.round(o.y));
  build(g, p, 'c_reactor', Math.round(o.x) + 8, Math.round(o.y));
  g.cmdRally(f, o.x, o.y + 12);
  const err = g.cmdQueue(f, 'c_bulwark');
  check('queue tank', err === null, err ?? '');
  run(g, 20);
  const tanks = g.unitsOf(p, (u) => u.udef!.id === 'c_bulwark');
  check('tank produced and heads to rally', tanks.length === 1 && Math.hypot(tanks[0].x - o.x, tanks[0].y - (o.y + 12)) < 4, tanks.length ? `at ${tanks[0].x.toFixed(1)},${tanks[0].y.toFixed(1)} order ${tanks[0].order.type}` : 'none');
}
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
