// Menu screens: main, skirmish setup, help, settings, pause and results.
import { FACTIONS, FACTION_IDS, START_CASH } from '../core/data';
import { GameMap, MAPS, T_CLIFF, T_ROAD, T_WATER } from '../core/map';
import type { FactionId } from '../core/types';
import type { GameSettings, PlayerSetup } from '../game/game';

export interface Prefs {
  sound: boolean;
  eva: boolean;
  shadows: boolean;
  setup: {
    mapId: string;
    faction: FactionId;
    opponents: { faction: FactionId | 'random'; difficulty: 'easy' | 'medium' | 'hard' }[];
    teams: 'ffa' | 'vs';
    cash: number;
    superweapons: boolean;
  };
  wins: number;
  losses: number;
}

const KEY = 'irondoctrine.prefs.v1';

export function loadPrefs(): Prefs {
  const def: Prefs = {
    sound: true, eva: true, shadows: true,
    setup: { mapId: 'dust', faction: 'coalition', opponents: [{ faction: 'random', difficulty: 'medium' }], teams: 'ffa', cash: 10000, superweapons: true },
    wins: 0, losses: 0,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...JSON.parse(raw), setup: { ...def.setup, ...(JSON.parse(raw).setup ?? {}) } };
  } catch {
    /* ignore */
  }
  return def;
}
export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const thumbs = new Map<string, HTMLCanvasElement>();
function mapThumb(id: string) {
  const c = thumbs.get(id);
  if (c) return c;
  const spec = MAPS.find((m) => m.id === id)!;
  const map = new GameMap(spec);
  const cv = document.createElement('canvas');
  cv.width = map.w;
  cv.height = map.h;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(map.w, map.h);
  const desert = spec.theme === 'desert';
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const t = map.terrain[map.idx(x, y)];
      let r = desert ? 200 : 100, gg = desert ? 175 : 150, b = desert ? 115 : 65;
      if (t === T_CLIFF) (r = 115), (gg = 105), (b = 95);
      if (t === T_WATER) (r = 55), (gg = 125), (b = 195);
      if (t === T_ROAD) (r = 160), (gg = 145), (b = 105);
      const n = map.noise.at(x * 0.2, y * 0.2) * 24 - 12;
      const i = (y * map.w + x) * 4;
      img.data[i] = r + n;
      img.data[i + 1] = gg + n;
      img.data[i + 2] = b + n;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#f2c230';
  for (const d of map.docks) g.fillRect(d.x, d.y, 2, 2);
  g.fillStyle = '#222';
  for (const d of map.derricks) g.fillRect(d.x, d.y, 3, 3);
  map.starts.forEach((s, i) => {
    g.fillStyle = ['#2f7fe0', '#d63a3a', '#3fae4a', '#e0a02f'][i];
    g.beginPath();
    g.arc(s.x, s.y, 4, 0, 6.283);
    g.fill();
  });
  thumbs.set(id, cv);
  return cv;
}

export class Menus {
  prefs: Prefs;
  private $ = (id: string) => document.getElementById(id)!;
  onStart: (s: GameSettings) => void = () => {};
  onPrefs: (p: Prefs) => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onRestart: () => void = () => {};

  constructor() {
    this.prefs = loadPrefs();
    this.$('btn-skirmish').onclick = () => this.show('setup');
    this.$('btn-help').onclick = () => this.show('help');
    this.$('btn-settings').onclick = () => this.show('settings');
    for (const el of document.querySelectorAll('[data-back]')) (el as HTMLElement).onclick = () => this.show('main');
    this.$('btn-start').onclick = () => this.start();
    this.$('btn-resume').onclick = () => this.onResume();
    this.$('btn-quit').onclick = () => this.onQuit();
    this.$('btn-restart').onclick = () => this.onRestart();
    this.$('btn-result-menu').onclick = () => this.onQuit();
    this.$('btn-result-again').onclick = () => this.onRestart();
    this.$('pause-settings').onclick = () => this.show('settings', true);
    this.buildSettings();
    this.buildSetup();
    this.show('main');
  }

  show(id: 'main' | 'setup' | 'help' | 'settings' | 'pause' | 'result' | 'none', overlayOnPause = false) {
    for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
    if (id === 'none') return;
    this.$('screen-' + id).classList.remove('hidden');
    if (id === 'settings') this.$('settings-back').dataset.target = overlayOnPause ? 'pause' : 'main';
    if (id === 'main') this.$('main-record').textContent = this.prefs.wins + this.prefs.losses ? `Record: ${this.prefs.wins} W – ${this.prefs.losses} L` : '';
  }

  private buildSettings() {
    const p = this.prefs;
    const bind = (id: string, key: 'sound' | 'eva' | 'shadows') => {
      const el = this.$(id) as HTMLInputElement;
      el.checked = p[key];
      el.onchange = () => {
        p[key] = el.checked;
        savePrefs(p);
        this.onPrefs(p);
      };
    };
    bind('opt-sound', 'sound');
    bind('opt-eva', 'eva');
    bind('opt-shadows', 'shadows');
    this.$('settings-back').onclick = () => this.show((this.$('settings-back').dataset.target as 'main' | 'pause') ?? 'main');
  }

  private buildSetup() {
    const s = this.prefs.setup;
    // Maps.
    const maps = this.$('setup-maps');
    maps.innerHTML = '';
    for (const m of MAPS) {
      const el = document.createElement('button');
      el.className = 'map-card';
      el.appendChild(mapThumb(m.id));
      const t = document.createElement('div');
      t.innerHTML = `<b>${m.name}</b><small>${m.players} players · ${m.theme}</small>`;
      el.appendChild(t);
      el.onclick = () => {
        s.mapId = m.id;
        this.refreshSetup();
      };
      maps.appendChild(el);
    }
    // Factions.
    const fs = this.$('setup-factions');
    fs.innerHTML = '';
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      const el = document.createElement('button');
      el.className = 'faction-card ' + id;
      el.innerHTML = `<b>${f.name}</b><em>${f.motto}</em><p>${f.desc}</p>`;
      el.onclick = () => {
        s.faction = id;
        this.refreshSetup();
      };
      fs.appendChild(el);
    }
    (this.$('opt-cash') as HTMLSelectElement).innerHTML = START_CASH.map((c) => `<option value="${c}">$${c.toLocaleString()}</option>`).join('');
    (this.$('opt-cash') as HTMLSelectElement).onchange = (e) => {
      s.cash = Number((e.target as HTMLSelectElement).value);
      savePrefs(this.prefs);
    };
    (this.$('opt-sw') as HTMLInputElement).onchange = (e) => {
      s.superweapons = (e.target as HTMLInputElement).checked;
      savePrefs(this.prefs);
    };
    (this.$('opt-teams') as HTMLSelectElement).onchange = (e) => {
      s.teams = (e.target as HTMLSelectElement).value as 'ffa' | 'vs';
      savePrefs(this.prefs);
    };
    this.refreshSetup();
  }

  private refreshSetup() {
    const s = this.prefs.setup;
    const spec = MAPS.find((m) => m.id === s.mapId) ?? MAPS[0];
    s.mapId = spec.id;
    const maxOpp = spec.players - 1;
    while (s.opponents.length < 1) s.opponents.push({ faction: 'random', difficulty: 'medium' });
    if (s.opponents.length > maxOpp) s.opponents.length = maxOpp;
    document.querySelectorAll('#setup-maps .map-card').forEach((el, i) => el.classList.toggle('sel', MAPS[i].id === s.mapId));
    document.querySelectorAll('#setup-factions .faction-card').forEach((el, i) => el.classList.toggle('sel', FACTION_IDS[i] === s.faction));
    this.$('setup-map-desc').textContent = spec.desc;
    (this.$('opt-cash') as HTMLSelectElement).value = String(s.cash);
    (this.$('opt-sw') as HTMLInputElement).checked = s.superweapons;
    (this.$('opt-teams') as HTMLSelectElement).value = s.teams;
    this.$('opt-teams').parentElement!.classList.toggle('hidden', maxOpp < 2);
    // Opponents.
    const list = this.$('setup-opponents');
    list.innerHTML = '';
    s.opponents.forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'opp-row';
      row.innerHTML = `<span>Enemy ${i + 1}</span>
        <select class="opp-f"><option value="random">Random</option>${FACTION_IDS.map((f) => `<option value="${f}">${FACTIONS[f].name}</option>`).join('')}</select>
        <select class="opp-d"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
        <button class="opp-x" ${s.opponents.length <= 1 ? 'disabled' : ''}>✕</button>`;
      const f = row.querySelector('.opp-f') as HTMLSelectElement, d = row.querySelector('.opp-d') as HTMLSelectElement;
      f.value = o.faction;
      d.value = o.difficulty;
      f.onchange = () => {
        o.faction = f.value as FactionId | 'random';
        savePrefs(this.prefs);
      };
      d.onchange = () => {
        o.difficulty = d.value as 'easy';
        savePrefs(this.prefs);
      };
      (row.querySelector('.opp-x') as HTMLButtonElement).onclick = () => {
        s.opponents.splice(i, 1);
        this.refreshSetup();
      };
      list.appendChild(row);
    });
    const add = this.$('btn-add-opp') as HTMLButtonElement;
    add.disabled = s.opponents.length >= maxOpp;
    add.onclick = () => {
      s.opponents.push({ faction: 'random', difficulty: 'medium' });
      this.refreshSetup();
    };
    savePrefs(this.prefs);
  }

  private start() {
    const s = this.prefs.setup;
    const players: PlayerSetup[] = [{ faction: s.faction, human: true, team: 0, difficulty: 'medium', name: 'You' }];
    s.opponents.forEach((o, i) => {
      const faction = o.faction === 'random' ? FACTION_IDS[Math.floor(Math.random() * 3)] : o.faction;
      const names = ['Gen. Kuznetsov', 'Gen. Alvarez', 'Gen. Okafor', 'Gen. Tanaka'];
      players.push({ faction, human: false, team: s.teams === 'vs' ? 1 : i + 1, difficulty: o.difficulty, name: names[i % names.length] });
    });
    savePrefs(this.prefs);
    this.onStart({ mapId: s.mapId, players, startCash: s.cash, superweapons: s.superweapons });
  }

  showResult(won: boolean, stats: { killed: number; lost: number; built: number; time: number }) {
    if (won) this.prefs.wins++;
    else this.prefs.losses++;
    savePrefs(this.prefs);
    this.$('result-title').textContent = won ? 'Victory' : 'Defeat';
    this.$('result-title').className = won ? 'win' : 'lose';
    const m = Math.floor(stats.time / 60), sec = Math.floor(stats.time % 60);
    this.$('result-stats').innerHTML = `<div><b>${stats.killed}</b><span>destroyed</span></div><div><b>${stats.lost}</b><span>lost</span></div><div><b>${stats.built}</b><span>structures built</span></div><div><b>${m}:${sec.toString().padStart(2, '0')}</b><span>time</span></div>`;
    this.show('result');
  }
}
