import * as THREE from 'three';
import type { Perk } from './perks';

// DOM overlay: top bar, banners, hints and health bars pinned to world positions.

interface Pinned {
  el: HTMLElement;
  fill: HTMLElement;
  pos: THREE.Vector3;
  visible: boolean;
}

const tmp = new THREE.Vector3();

export class Hud {
  private root = document.getElementById('hud')!;
  private layer = document.getElementById('world-ui')!;
  private goldEl = document.getElementById('gold')!;
  private goldPill = document.getElementById('gold-pill')!;
  private waveLabel = document.getElementById('wave-label')!;
  private waveBar = document.getElementById('wave-bar')!;
  private keepBar = document.getElementById('keep-bar')!;
  private bannerEl = document.getElementById('banner')!;
  private hintEl = document.getElementById('hint')!;
  private bars = new Map<HTMLElement, Pinned>();
  private last = { gold: -1, wave: -1, waveP: -1, keep: -1, hint: '' };
  private bannerTimer = 0;
  private goldShown = 0;
  private goldTarget = 0;
  private xpFill = document.getElementById('xp-fill')!;
  private xpLevel = document.getElementById('xp-level')!;
  private comboEl = document.getElementById('combo')!;
  private comboNum = document.getElementById('combo-num')!;
  private perksEl = document.getElementById('perks')!;
  private woodEl = document.getElementById('wood')!;
  private stoneEl = document.getElementById('stone')!;
  private novaBtn = document.getElementById('btn-nova')!;
  private novaFill = document.getElementById('nova-fill')!;
  private res = { wood: -1, stone: -1, nova: -1 };
  private perkCards = document.getElementById('perk-cards')!;
  private bumpTimer = 0;

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  /** The counter rolls toward the real value so gains feel like a slot machine. */
  setGold(n: number) {
    this.goldTarget = n;
  }

  setResources(wood: number, stone: number) {
    if (wood !== this.res.wood) {
      this.woodEl.textContent = String(wood);
      this.woodEl.parentElement!.classList.toggle('bump', wood > this.res.wood && this.res.wood >= 0);
      this.res.wood = wood;
    }
    if (stone !== this.res.stone) {
      this.stoneEl.textContent = String(stone);
      this.stoneEl.parentElement!.classList.toggle('bump', stone > this.res.stone && this.res.stone >= 0);
      this.res.stone = stone;
    }
  }

  /** Nova ability button: fills as you kill, glows when ready. */
  setNova(frac: number) {
    const p = Math.round(frac * 100);
    if (p === this.res.nova) return;
    this.res.nova = p;
    this.novaFill.style.height = `${p}%`;
    this.novaBtn.classList.toggle('ready', frac >= 1);
  }

  setXp(level: number, frac: number) {
    this.xpFill.style.width = `${Math.min(1, frac) * 100}%`;
    this.xpLevel.textContent = String(level);
  }

  setCombo(n: number) {
    if (n < 3) {
      this.comboEl.classList.remove('show');
      return;
    }
    this.comboNum.textContent = `×${n}`;
    this.comboEl.classList.add('show');
    this.comboEl.classList.remove('pop');
    void this.comboEl.offsetWidth; // restart the pop animation
    this.comboEl.classList.add('pop');
    this.comboEl.classList.toggle('hot', n >= 30);
  }

  /** Level-up card picker. Calls back with the chosen perk. */
  showPerks(level: number, perks: Perk[], levels: Record<string, number>, onPick: (p: Perk) => void) {
    this.perkCards.innerHTML = '';
    (document.getElementById('perks-level') as HTMLElement).textContent = `Level ${level}`;
    perks.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = `perk ${p.rarity}`;
      b.style.animationDelay = `${i * 0.08}s`;
      const lv = levels[p.id] ?? 0;
      b.innerHTML = `
        <span class="perk-ico"><svg viewBox="0 0 24 24"><path d="${p.icon}"/></svg></span>
        <span class="perk-text">
          <span class="perk-name">${p.name}${lv ? ` <em>${lv + 1}</em>` : ''}</span>
          <span class="perk-desc">${p.desc(lv)}</span>
        </span>
        <span class="perk-tag">${p.rarity}</span>`;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.perksEl.classList.add('hidden');
        onPick(p);
      });
      this.perkCards.appendChild(b);
    });
    this.perksEl.classList.remove('hidden');
  }

  bumpGold() {
    this.goldPill.classList.add('bump');
    this.bumpTimer = 0.08;
  }

  setWave(n: number, progress: number) {
    if (n !== this.last.wave) {
      this.last.wave = n;
      this.waveLabel.textContent = `Wave ${n}`;
    }
    const p = Math.round(progress * 100);
    if (p !== this.last.waveP) {
      this.last.waveP = p;
      this.waveBar.style.width = `${p}%`;
    }
  }

  setKeep(frac: number) {
    const p = Math.round(frac * 100);
    if (p === this.last.keep) return;
    this.last.keep = p;
    this.keepBar.style.width = `${p}%`;
    this.keepBar.classList.toggle('low', frac < 0.35);
  }

  banner(text: string, boss: boolean) {
    this.bannerEl.textContent = text;
    this.bannerEl.className = boss ? 'show boss' : 'show';
    this.bannerTimer = 2.2;
  }

  hint(text: string) {
    if (text === this.last.hint) return;
    this.last.hint = text;
    this.hintEl.textContent = text;
  }

  /** A health bar that follows something in the world. */
  worldBar(cls: string) {
    const el = document.createElement('div');
    el.className = `wbar ${cls}`;
    const fill = document.createElement('i');
    el.appendChild(fill);
    el.style.display = 'none';
    this.layer.appendChild(el);
    this.bars.set(el, { el, fill, pos: new THREE.Vector3(), visible: false });
    return el;
  }

  placeBar(el: HTMLElement, pos: THREE.Vector3 | null, frac: number) {
    const b = this.bars.get(el);
    if (!b) return;
    b.visible = pos !== null;
    if (pos) b.pos.copy(pos);
    b.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  /** A small pill showing how many defenders a tower or post holds. */
  worldLabel(kind: 'archer' | 'knight') {
    const el = document.createElement('div');
    el.className = `wlabel ${kind}`;
    const icon = document.createElement('b');
    const text = document.createElement('span');
    el.append(icon, text);
    el.style.display = 'none';
    this.layer.appendChild(el);
    this.bars.set(el, { el, fill: text, pos: new THREE.Vector3(), visible: false });
    return el;
  }

  placeLabel(el: HTMLElement, pos: THREE.Vector3, text: string, warn: boolean) {
    const b = this.bars.get(el);
    if (!b) return;
    b.visible = true;
    b.pos.copy(pos);
    if (b.fill.textContent !== text) b.fill.textContent = text;
    el.classList.toggle('warn', warn);
  }

  removeBar(el: HTMLElement) {
    el.remove();
    this.bars.delete(el);
  }

  /** Call after the camera has moved for this frame. */
  render(dt: number, camera: THREE.Camera, w: number, h: number) {
    for (const b of this.bars.values()) {
      if (!b.visible) {
        b.el.style.display = 'none';
        continue;
      }
      tmp.copy(b.pos).project(camera);
      b.el.style.display = 'block';
      b.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.className = '';
    }
    if (this.goldShown !== this.goldTarget) {
      const diff = this.goldTarget - this.goldShown;
      const step = Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 12)));
      this.goldShown = Math.abs(step) >= Math.abs(diff) ? this.goldTarget : this.goldShown + step;
      this.goldEl.textContent = String(this.goldShown);
    }
    if (this.bumpTimer > 0) {
      this.bumpTimer -= dt;
      if (this.bumpTimer <= 0) this.goldPill.classList.remove('bump');
    }
  }

  reset() {
    for (const el of [...this.bars.keys()]) this.removeBar(el);
    this.last = { gold: -1, wave: -1, waveP: -1, keep: -1, hint: '' };
    this.goldShown = this.goldTarget = 0;
    this.res = { wood: -1, stone: -1, nova: -1 };
    this.setResources(0, 0);
    this.setNova(0);
    this.goldEl.textContent = '0';
    this.setXp(1, 0);
    this.setCombo(0);
    this.perksEl.classList.add('hidden');
    this.bannerEl.className = '';
    this.hint('');
  }
}
