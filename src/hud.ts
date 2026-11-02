import * as THREE from 'three';

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
  private bumpTimer = 0;

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  setGold(n: number) {
    if (n === this.last.gold) return;
    this.last.gold = n;
    this.goldEl.textContent = String(n);
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
    if (this.bumpTimer > 0) {
      this.bumpTimer -= dt;
      if (this.bumpTimer <= 0) this.goldPill.classList.remove('bump');
    }
  }

  reset() {
    for (const el of [...this.bars.keys()]) this.removeBar(el);
    this.last = { gold: -1, wave: -1, waveP: -1, keep: -1, hint: '' };
    this.bannerEl.className = '';
    this.hint('');
  }
}
