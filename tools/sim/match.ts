// Headless AI-vs-AI smoke test (not shipped; bundled with esbuild and run in Node).
import { Game } from '../../src/game/game';
import type { FactionId } from '../../src/core/types';

const mapId = process.argv[2] ?? 'dust';
const factionA = (process.argv[3] as FactionId) ?? 'coalition';
const factionB = (process.argv[4] as FactionId) ?? 'insurgency';
const minutes = Number(process.argv[5] ?? 12);
const verbose = process.argv.includes('-v');
const g = new Game({
  mapId,
  startCash: 10000,
  superweapons: true,
  players: [
    { faction: factionA, human: false, team: 0, difficulty: 'hard', name: 'A' },
    { faction: factionB, human: false, team: 1, difficulty: 'hard', name: 'B' },
  ],
});
const t0 = Date.now();
let ticks = 0;
for (let t = 0; t < minutes * 60 && !g.result.over; t += 0.05) {
  g.tick(0.05);
  ticks++;
  if (ticks % (30 * 20) === 0) {
    const line = g.players
      .filter((p) => p.id >= 0)
      .map((p) => {
        const units = g.unitsOf(p), bs = g.buildingsOf(p);
        const sites = bs.filter((b) => !b.built).length;
        const atk = p.ai?.attacking ? 'ATK' : '';
        const gath = units.filter((u) => u.udef!.gather);
        let extra = '';
        if (verbose) {
          extra = ' g[' + gath.map((u) => u.order.type[0] + (u.cargo ? '$' : '') + (u.dock ? 'd' : '-')).join('') + '] b[' + bs.map((b) => b.bdef!.id.slice(2, 6) + (b.built ? '' : '*')).join(',') + ']';
        }
        return p.name + ':$' + Math.floor(p.money) + ' u' + units.length + ' b' + bs.length + '(' + sites + ') pw' + p.powerProduced + '/' + p.powerUsed + ' r' + p.rank + ' k' + p.stats.killed + ' l' + p.stats.lost + ' ' + atk + extra;
      })
      .join(' | ');
    console.log('t=' + Math.round(g.time) + 's ' + line);
  }
  g.events.length = 0;
}
console.log('result', g.result, 'real ms', Date.now() - t0, 'ticks', ticks, 'docks', g.map.docks.map((d) => Math.round(d.amount)).join(','));
