// In-game HUD: top bar, command bar (bottom), generals powers column, minimap, alerts and the
// promotion panel. Everything is plain DOM; the minimap is a canvas.
import { BUILDINGS, TEAM_COLOR_CSS, UNITS, UPGRADES, RANK_XP } from '../core/data';
import { T_CLIFF, T_ROAD, T_WATER } from '../core/map';
import { formatMoney, formatTime } from '../core/math';
import type { IconKind } from '../core/types';
import { glyphIcon, iconCanvas } from './icons';
import type { Controller } from './controller';

interface Btn {
  key: string;
  label: string;
  icon: HTMLCanvasElement;
  cost?: number;
  sub?: string;
  disabled?: boolean;
  reason?: string;
  badge?: () => string;
  progress?: () => number;
  onTap: () => void;
  onHold?: () => void;
  active?: boolean;
}

export class Hud {
  root: HTMLElement;
  private ctl: Controller;
  private $ = (id: string) => document.getElementById(id)!;
  private money = this.$('hud-money');
  private power = this.$('hud-power');
  private powerBar = this.$('hud-power-fill');
  private rank = this.$('hud-rank');
  private clock = this.$('hud-clock');
  private cmdRow = this.$('cmd-row');
  private selInfo = this.$('sel-info');
  private hint = this.$('mode-hint');
  private hintText = this.$('mode-hint-text');
  private powersCol = this.$('powers');
  private toasts = this.$('toasts');
  private evaBox = this.$('eva');
  private groupsEl = this.$('groups');
  private minimap = this.$('minimap') as HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;
  private mmBase: HTMLCanvasElement;
  private promo = this.$('promo');
  private promoList = this.$('promo-list');
  private swBar = this.$('sw-timers');
  private lastSig = '';
  private btnEls = new Map<string, { el: HTMLElement; btn: Btn; prog: HTMLElement; badge: HTMLElement; cost: HTMLElement | null }>();
  private powerEls = new Map<string, { el: HTMLElement; cool: HTMLElement; lvl: HTMLElement }>();
  private mmTimer = 0;
  private evaTimer = 0;
  private uiTimer = 0;
  private color: string;
  promoOpen = false;
  onPause: () => void = () => {};
  onSpeed: () => void = () => {};

  constructor(root: HTMLElement, ctl: Controller) {
    this.root = root;
    this.ctl = ctl;
    this.color = TEAM_COLOR_CSS[ctl.viewer.color];
    this.mmCtx = this.minimap.getContext('2d')!;
    this.mmBase = this.buildMinimapBase();
    ctl.toast = (msg, kind) => this.toast(msg, kind);
    ctl.openPromo = () => this.togglePromo(true);
    this.$('btn-pause').onclick = () => this.onPause();
    this.clock.onclick = () => this.onSpeed();
    this.$('btn-army').onclick = () => ctl.selectAllArmy();
    this.$('btn-base').onclick = () => ctl.focusBase();
    this.$('mode-cancel').onclick = () => ctl.cancelMode();
    this.rank.onclick = () => this.togglePromo();
    this.$('promo-close').onclick = () => this.togglePromo(false);
    this.minimap.addEventListener('pointerdown', (e) => this.minimapTap(e));
    this.minimap.addEventListener('pointermove', (e) => {
      if (e.buttons) this.minimapTap(e);
    });
    this.buildGroups();
    this.buildPowers();
    root.classList.remove('hidden');
    this.resizeMinimap();
  }

  private resizeMinimap() {
    const size = this.minimap.clientWidth || 120;
    this.minimap.width = size * 2;
    this.minimap.height = size * 2;
  }

  private buildMinimapBase() {
    const map = this.ctl.game.map;
    const cv = document.createElement('canvas');
    cv.width = map.w;
    cv.height = map.h;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(map.w, map.h);
    const desert = map.theme === 'desert';
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const t = map.terrain[map.idx(x, y)];
        let r = desert ? 190 : 95, gg = desert ? 165 : 140, b = desert ? 110 : 60;
        if (t === T_CLIFF) (r = 110), (gg = 100), (b = 90);
        if (t === T_WATER) (r = 50), (gg = 120), (b = 190);
        if (t === T_ROAD) (r = 150), (gg = 135), (b = 100);
        const n = map.noise.at(x * 0.2, y * 0.2) * 20 - 10;
        const i = (y * map.w + x) * 4;
        img.data[i] = r + n;
        img.data[i + 1] = gg + n;
        img.data[i + 2] = b + n;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return cv;
  }

  private minimapTap(e: PointerEvent) {
    const r = this.minimap.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const map = this.ctl.game.map;
    this.ctl.jumpTo(fx * map.w, fy * map.h);
  }

  private drawMinimap() {
    const g = this.mmCtx;
    const cv = this.minimap;
    const game = this.ctl.game;
    const map = game.map;
    const W = cv.width, H = cv.height;
    const sx = W / map.w, sy = H / map.h;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mmBase, 0, 0, W, H);
    const fog = game.fogs.get(this.ctl.viewer.id);
    if (fog) {
      // Fog as a coarse overlay.
      g.fillStyle = 'rgba(0,0,0,0.85)';
      const step = 2;
      for (let y = 0; y < map.h; y += step)
        for (let x = 0; x < map.w; x += step) {
          const i = y * map.w + x;
          if (!fog.explored[i]) g.fillRect(x * sx, y * sy, step * sx, step * sy);
        }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = 0; y < map.h; y += step)
        for (let x = 0; x < map.w; x += step) {
          const i = y * map.w + x;
          if (fog.explored[i] && !fog.visible[i]) g.fillRect(x * sx, y * sy, step * sx, step * sy);
        }
    }
    for (const d of map.docks) if (d.amount > 0 && (!fog || fog.explored[d.y * map.w + d.x])) {
      g.fillStyle = '#f2c230';
      g.fillRect(d.x * sx, d.y * sy, 2 * sx, 2 * sy);
    }
    for (const e of game.entities) {
      if (e.dead || e.kind === 'crate') continue;
      if (!game.canSee(this.ctl.viewer, e)) continue;
      g.fillStyle = e.owner.id < 0 ? '#ddd' : TEAM_COLOR_CSS[e.owner.color];
      if (e.isBuilding) g.fillRect(e.cx * sx, e.cy * sy, e.w * sx, e.h * sy);
      else g.fillRect((e.x - 0.6) * sx, (e.y - 0.6) * sy, 1.2 * sx, 1.2 * sy);
    }
    // Attack alert.
    const v = this.ctl.viewer;
    if (game.time - v.lastAttackedAt < 8) {
      g.strokeStyle = 'rgba(255,60,60,' + (0.5 + 0.5 * Math.sin(game.time * 8)) + ')';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(v.lastAttackX * sx, v.lastAttackY * sy, 6 * sx, 0, 6.283);
      g.stroke();
    }
    // Camera trapezoid.
    const sc = this.ctl.scene;
    const corners = [sc.screenToGround(0, 0), sc.screenToGround(window.innerWidth, 0), sc.screenToGround(window.innerWidth, window.innerHeight), sc.screenToGround(0, window.innerHeight)];
    if (corners.every((c) => c)) {
      g.save();
      g.beginPath();
      g.rect(0, 0, W, H);
      g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      corners.forEach((c, i) => (i ? g.lineTo(c!.x * sx, c!.y * sy) : g.moveTo(c!.x * sx, c!.y * sy)));
      g.closePath();
      g.stroke();
      g.restore();
    }
  }

  private buildGroups() {
    this.groupsEl.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
      const b = document.createElement('button');
      b.className = 'grp';
      b.innerHTML = `<b>${i}</b><span></span>`;
      let timer = 0;
      b.addEventListener('pointerdown', () => {
        timer = window.setTimeout(() => {
          timer = 0;
          this.ctl.assignGroup(i);
        }, 450);
      });
      const end = () => {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
          this.ctl.selectGroup(i);
        }
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointerleave', () => timer && clearTimeout(timer));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      this.groupsEl.appendChild(b);
    }
  }

  private buildPowers() {
    this.powersCol.innerHTML = '';
    for (const ps of this.ctl.viewer.powers.values()) {
      const el = document.createElement('button');
      el.className = 'pw';
      el.innerHTML = `<span class="pw-ico">${ps.def.icon}</span><span class="pw-cool"></span><span class="pw-lvl"></span>`;
      el.title = ps.def.name;
      el.onclick = () => this.ctl.usePower(ps.def.id);
      this.powersCol.appendChild(el);
      this.powerEls.set(ps.def.id, { el, cool: el.querySelector('.pw-cool')!, lvl: el.querySelector('.pw-lvl')! });
    }
  }

  private updatePowers() {
    const v = this.ctl.viewer;
    for (const ps of v.powers.values()) {
      const pe = this.powerEls.get(ps.def.id)!;
      const locked = ps.level <= 0;
      pe.el.classList.toggle('locked', locked);
      pe.el.classList.toggle('ready', !locked && ps.cooldown <= 0 && ps.def.target !== 'none' || (!locked && ps.def.kind === 'cashhack' && ps.cooldown <= 0));
      pe.el.classList.toggle('passive', ps.def.kind === 'bounty');
      pe.el.classList.toggle('active', this.ctl.mode.kind === 'power' && this.ctl.mode.id === ps.def.id);
      pe.cool.textContent = ps.cooldown > 0 ? formatTime(ps.cooldown) : '';
      pe.cool.style.display = ps.cooldown > 0 ? '' : 'none';
      pe.lvl.textContent = locked ? (v.rank >= ps.def.rank ? '?' : 'R' + ps.def.rank) : ps.def.levels > 1 ? '★'.repeat(ps.level) : '';
      const frac = ps.def.cooldown > 0 ? 1 - ps.cooldown / ps.def.cooldown : 1;
      pe.el.style.setProperty('--cool', String(frac));
    }
    // Superweapon timers (own + enemy).
    const sws = this.ctl.game.entities.filter((e) => e.isBuilding && !e.dead && e.built && e.bdef!.superweapon && (e.owner === v || this.ctl.game.canSee(v, e)));
    const sig = sws.map((e) => e.id).join(',');
    if (sig !== this.swSig) {
      this.swSig = sig;
      this.swBar.innerHTML = '';
      this.swEls.clear();
      for (const e of sws) {
        const el = document.createElement('button');
        el.className = 'sw ' + (e.owner === v ? 'own' : 'enemy');
        el.innerHTML = `<span class="sw-name">${e.owner === v ? '' : e.owner.name + ' · '}${e.bdef!.name}</span><span class="sw-time"></span>`;
        if (e.owner === v) el.onclick = () => this.ctl.superweapon(e);
        else el.onclick = () => this.ctl.jumpTo(e.x, e.y);
        this.swBar.appendChild(el);
        this.swEls.set(e.id, el);
      }
    }
    for (const e of sws) {
      const el = this.swEls.get(e.id)!;
      const t = el.querySelector('.sw-time')!;
      const lance = e.owner === v && v.lance && e.bdef!.superweapon!.kind === 'lance';
      t.textContent = lance ? 'STEER' : e.swReady ? 'READY' : formatTime(e.swTimer);
      el.classList.toggle('ready', e.swReady || !!lance);
      el.classList.toggle('active', this.ctl.mode.kind === 'superweapon' && this.ctl.mode.building === e);
    }
  }
  private swSig = '';
  private swEls = new Map<number, HTMLElement>();

  togglePromo(open?: boolean) {
    this.promoOpen = open ?? !this.promoOpen;
    this.promo.classList.toggle('hidden', !this.promoOpen);
    if (this.promoOpen) this.renderPromo();
  }
  private renderPromo() {
    const v = this.ctl.viewer;
    this.$('promo-rank').textContent = `Rank ${v.rank} · ${v.points} point${v.points === 1 ? '' : 's'} to spend`;
    this.promoList.innerHTML = '';
    for (const ps of v.powers.values()) {
      const d = ps.def;
      const can = v.points > 0 && ps.level < d.levels && v.rank >= d.rank;
      const el = document.createElement('div');
      el.className = 'promo-item' + (ps.level > 0 ? ' owned' : '') + (v.rank < d.rank ? ' locked' : '');
      el.innerHTML = `<div class="promo-ico">${d.icon}</div><div class="promo-body"><b>${d.name}</b> <small>${d.levels > 1 ? `level ${ps.level}/${d.levels}` : ps.level ? 'unlocked' : ''}${v.rank < d.rank ? ` · requires rank ${d.rank}` : ''}</small><p>${d.desc}</p></div><button class="cta small" ${can ? '' : 'disabled'}>${ps.level >= d.levels ? 'Max' : ps.level ? 'Upgrade' : 'Unlock'}</button>`;
      el.querySelector('button')!.onclick = () => {
        this.ctl.buyPower(d.id);
        this.renderPromo();
      };
      this.promoList.appendChild(el);
    }
  }

  toast(msg: string, kind: 'info' | 'error' = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    setTimeout(() => el.classList.add('out'), 1800);
    setTimeout(() => el.remove(), 2300);
  }
  eva(msg: string) {
    this.evaBox.textContent = msg;
    this.evaBox.classList.add('show');
    this.evaTimer = 3;
    const alert = /attack|lost|captured by|superweapon|launch|Lance|eliminated/i.test(msg);
    this.evaBox.classList.toggle('alert', alert);
    this.evaBox.onclick = alert ? () => this.ctl.jumpToAlert() : null;
  }

  // ------------------------------------------------------------ command bar
  private buttonsFor(): { buttons: Btn[]; info: string } {
    const ctl = this.ctl;
    const game = ctl.game;
    const v = ctl.viewer;
    const buttons: Btn[] = [];
    const mode = ctl.mode;
    const color = this.color;
    const gi = (glyph: string) => glyphIcon(glyph, '#fff');
    const cancel = (label = 'Cancel'): Btn => ({ key: 'cancel', label, icon: gi('✕'), onTap: () => ctl.cancelMode() });
    if (mode.kind === 'build') {
      buttons.push({ key: 'place', label: 'Build here', icon: gi('✔'), disabled: !ctl.ghost?.valid, onTap: () => ctl.confirmBuild() });
      buttons.push(cancel());
      return { buttons, info: BUILDINGS[mode.defId].name + ' · ' + formatMoney(BUILDINGS[mode.defId].cost) };
    }
    if (mode.kind !== 'normal') {
      buttons.push(cancel());
      return { buttons, info: ctl.modeHint ?? '' };
    }
    const b = ctl.selectedBuilding();
    const units = ctl.selectedUnits();
    if (units.length) {
      const anyAttack = units.some((u) => u.weapons.length);
      const builders = units.filter((u) => u.udef!.builder);
      const types = new Map<string, number>();
      for (const u of units) types.set(u.udef!.id, (types.get(u.udef!.id) ?? 0) + 1);
      let info = units.length === 1 ? units[0].name : `${units.length} units`;
      if (units.length === 1) {
        const u = units[0];
        info += ` · ${Math.ceil(u.hp)}/${u.maxHp}` + (u.vet ? ' · ' + ['', 'Veteran', 'Elite', 'Heroic'][u.vet] : '') + (u.cargo ? ` · carrying ${formatMoney(u.cargo)}` : '');
      }
      buttons.push({ key: 'stop', label: 'Stop', icon: gi('■'), onTap: () => ctl.stop() });
      if (anyAttack) buttons.push({ key: 'amove', label: 'Attack move', icon: gi('⚔'), onTap: () => ctl.setMode({ kind: 'attackmove' }) });
      if (units.some((u) => u.udef!.capture)) buttons.push({ key: 'capture', label: 'Capture', icon: gi('⚑'), onTap: () => ctl.setMode({ kind: 'capture' }) });
      if (units.some((u) => u.udef!.hack)) buttons.push({ key: 'deploy', label: 'Hack', icon: gi('$'), onTap: () => ctl.deploy() });
      if (units.some((u) => u.udef!.suicide)) buttons.push({ key: 'boom', label: 'Detonate', icon: gi('✸'), onTap: () => ctl.detonate() });
      if (units.some((u) => u.udef!.gather)) buttons.push({ key: 'gather', label: 'Gather', icon: gi('$'), onTap: () => ctl.gather() });
      if (builders.length) buttons.push({ key: 'repair', label: 'Repair', icon: gi('🔧'), onTap: () => ctl.setMode({ kind: 'repair' }) });
      if (units.some((u) => !u.isAir) && game.hasBuilt(v, 'i_tunnel')) buttons.push({ key: 'enter', label: 'Enter tunnel', icon: gi('◍'), onTap: () => ctl.setMode({ kind: 'enter' }) });
      if (builders.length) {
        for (const bd of ctl.faction.buildings) {
          if (bd.command) continue;
          const blocker = game.buildBlocker(v, bd);
          buttons.push({
            key: 'b:' + bd.id, label: bd.name, icon: iconCanvas(bd.icon, color), cost: bd.cost, disabled: !!blocker, reason: blocker ?? undefined,
            onTap: () => ctl.enterBuildMode(bd.id, builders[0]),
          });
        }
      }
      if (types.size > 1) {
        for (const [id, n] of types) buttons.push({ key: 'f:' + id, label: UNITS[id].name, icon: iconCanvas(UNITS[id].icon, color), sub: '×' + n, onTap: () => ctl.filterSelection(id) });
      }
      return { buttons, info };
    }
    if (b) {
      const own = b.owner === v;
      let info = b.name + ` · ${Math.ceil(b.hp)}/${b.maxHp}`;
      if (!own) {
        info = (b.owner.id < 0 ? 'Neutral ' : b.owner.name + "'s ") + b.name + ` · ${Math.ceil(b.hp)}/${b.maxHp}`;
        if (b.bdef!.capturable || b.owner.id < 0) info += ' · capture with infantry';
        return { buttons, info };
      }
      if (!b.built) {
        info = b.name + ` · building ${Math.round(b.progress * 100)}%` + (b.builders ? '' : ' · needs a builder');
        buttons.push({ key: 'sell', label: 'Cancel', icon: gi('✕'), onTap: () => ctl.sell() });
        return { buttons, info };
      }
      const def = b.bdef!;
      if (def.produces) {
        for (const id of def.produces) {
          const ud = UNITS[id];
          const blocker = game.buildBlocker(v, ud);
          buttons.push({
            key: 'u:' + id, label: ud.name, icon: iconCanvas(ud.icon, color), cost: ud.cost, disabled: !!blocker, reason: blocker ?? undefined,
            badge: () => {
              const n = b.production.filter((p) => p.id === id).length;
              return n ? String(n) : '';
            },
            progress: () => (b.production[0]?.id === id ? b.production[0].progress : 0),
            onTap: () => ctl.queue(id),
            onHold: () => {
              const i = b.production.findIndex((p) => p.id === id);
              if (i >= 0) ctl.cancelQueue(i);
            },
          });
        }
      }
      if (def.upgrades) {
        for (const id of def.upgrades) {
          const up = UPGRADES[id];
          const done = v.upgrades.has(id);
          buttons.push({
            key: 'g:' + id, label: up.name, icon: iconCanvas(up.icon, color), cost: up.cost, disabled: done, reason: done ? 'Researched' : undefined,
            badge: () => (b.production.some((p) => p.id === id) ? '…' : ''),
            progress: () => (b.production[0]?.id === id ? b.production[0].progress : 0),
            onTap: () => ctl.queue(id),
          });
        }
      }
      if (def.plans) {
        const plans: [string, string, IconKind][] = [['bombard', 'Bombardment', 'plan'], ['hold', 'Hold the Line', 'plan'], ['search', 'Search & Destroy', 'plan']];
        for (const [id, name, ic] of plans) buttons.push({ key: 'p:' + id, label: name, icon: iconCanvas(ic, color), active: v.plan === id, onTap: () => ctl.setPlan(id as 'bombard') });
      }
      if (def.tunnel) buttons.push({ key: 'exit', label: 'Exit all', icon: gi('⇡'), sub: String(v.tunnelUnits.length), onTap: () => ctl.exitTunnel() });
      if (def.superweapon) buttons.push({ key: 'fire', label: v.lance ? 'Steer beam' : 'Fire', icon: gi('✸'), disabled: !b.swReady && !v.lance, onTap: () => ctl.superweapon(b) });
      if (def.produces) buttons.push({ key: 'rally', label: 'Rally point', icon: gi('⚑'), onTap: () => ctl.setMode({ kind: 'rally' }) });
      buttons.push({ key: 'sell', label: 'Sell', icon: gi('$'), sub: formatMoney(Math.floor(def.cost * 0.5 * (b.hp / b.maxHp))), onTap: () => ctl.sell() });
      if (b.production.length) info += ` · queue ${b.production.length}`;
      return { buttons, info };
    }
    return { buttons, info: '' };
  }

  private rebuildCommandBar() {
    const { buttons, info } = this.buttonsFor();
    this.selInfo.textContent = info;
    this.cmdRow.innerHTML = '';
    this.btnEls.clear();
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'cmd' + (b.disabled ? ' disabled' : '') + (b.active ? ' active' : '');
      const ico = document.createElement('div');
      ico.className = 'cmd-ico';
      ico.appendChild(b.icon);
      el.appendChild(ico);
      const lab = document.createElement('span');
      lab.className = 'cmd-label';
      lab.textContent = b.label;
      el.appendChild(lab);
      let costEl: HTMLElement | null = null;
      if (b.cost !== undefined || b.sub) {
        costEl = document.createElement('span');
        costEl.className = 'cmd-cost';
        costEl.textContent = b.sub ?? formatMoney(b.cost!);
        el.appendChild(costEl);
      }
      const prog = document.createElement('i');
      prog.className = 'cmd-prog';
      el.appendChild(prog);
      const badge = document.createElement('b');
      badge.className = 'cmd-badge';
      el.appendChild(badge);
      if (b.reason) el.title = b.reason;
      let held = false, timer = 0, downX = 0, downY = 0;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        held = false;
        downX = e.clientX;
        downY = e.clientY;
        if (b.onHold) timer = window.setTimeout(() => {
          held = true;
          b.onHold!();
          if (navigator.vibrate) navigator.vibrate(8);
        }, 450);
      });
      el.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        if (timer) clearTimeout(timer);
        if (held) return;
        // A swipe to scroll the bar is not a tap.
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
        if (b.disabled) {
          this.toast(b.reason ?? 'Unavailable', 'error');
          return;
        }
        b.onTap();
      });
      el.addEventListener('pointerleave', () => timer && clearTimeout(timer));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        b.onHold?.();
      });
      this.cmdRow.appendChild(el);
      this.btnEls.set(b.key, { el, btn: b, prog, badge, cost: costEl });
    }
  }

  update(dt: number) {
    const ctl = this.ctl;
    const v = ctl.viewer;
    const game = ctl.game;
    this.money.textContent = formatMoney(v.money);
    if (v.def.needsPower) {
      this.power.textContent = `${v.powerUsed}/${v.powerProduced}`;
      const f = v.powerProduced ? Math.min(1, v.powerUsed / v.powerProduced) : 1;
      this.powerBar.style.width = Math.round(f * 100) + '%';
      this.powerBar.parentElement!.classList.toggle('low', v.lowPower);
    } else {
      this.power.textContent = '—';
      this.powerBar.style.width = '0%';
    }
    const next = v.rank < 5 ? RANK_XP[v.rank] : null;
    this.rank.innerHTML = `<b>★${v.rank}</b>${v.points ? `<em>${v.points}</em>` : ''}`;
    this.rank.classList.toggle('pulse', v.points > 0);
    this.rank.title = next ? `${Math.floor(v.xp)}/${next} XP` : 'Max rank';
    this.clock.textContent = formatTime(game.time) + (ctl.speed !== 1 ? ' ' + ctl.speed + '×' : '');
    // Mode hint.
    const hint = ctl.modeHint;
    this.hint.classList.toggle('hidden', !hint);
    if (hint) this.hintText.textContent = hint;
    // Command bar rebuild when selection/mode changes.
    const sig = ctl.selectionVersion + ':' + ctl.mode.kind + ':' + (ctl.ghost ? ctl.ghost.valid : '') + ':' + [...ctl.selection].map((e) => e.id + (e.built ? '' : 'c')).join(',') + ':' + v.plan;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.rebuildCommandBar();
    }
    this.uiTimer += dt;
    if (this.uiTimer > 0.1) {
      this.uiTimer = 0;
      for (const { el, btn, prog, badge, cost } of this.btnEls.values()) {
        if (btn.progress) prog.style.width = Math.round(btn.progress() * 100) + '%';
        if (btn.badge) badge.textContent = btn.badge();
        if (btn.cost !== undefined && cost) el.classList.toggle('poor', v.money < btn.cost);
        if (btn.key === 'place') el.classList.toggle('disabled', !ctl.ghost?.valid);
      }
      this.updatePowers();
      const chips = this.groupsEl.children;
      for (let i = 0; i < 4; i++) {
        const n = ctl.groups[i + 1].length;
        const chip = chips[i] as HTMLElement;
        chip.classList.toggle('empty', !n);
        chip.querySelector('span')!.textContent = n ? String(n) : '';
      }
      const b = ctl.selectedBuilding();
      const rallyEl = this.$('rally-flag');
      rallyEl.classList.toggle('hidden', !(b && b.rally));
    }
    this.mmTimer += dt;
    if (this.mmTimer > 0.15) {
      this.mmTimer = 0;
      this.drawMinimap();
    }
    if (this.evaTimer > 0) {
      this.evaTimer -= dt;
      if (this.evaTimer <= 0) this.evaBox.classList.remove('show');
    }
  }

  dispose() {
    this.root.classList.add('hidden');
    this.cmdRow.innerHTML = '';
    this.powersCol.innerHTML = '';
    this.swBar.innerHTML = '';
    this.toasts.innerHTML = '';
    this.promo.classList.add('hidden');
  }
}
