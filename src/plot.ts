import * as THREE from 'three';
import type { PlotDef, PlotKind } from './config';

// A build plot: a flat marker on the ground showing what it builds and how much gold is left.

const SIZE = 2.3;
const PX = 256;

const LABEL: Record<PlotKind, string> = {
  tower: 'Watchtower',
  post: 'Guard Post',
  barricade: 'Barricade',
  range: 'Archery Range',
  barracks: 'Barracks',
  forge: 'Forge',
  bowyer: 'Bowyer',
  recruitArcher: 'Recruit Archer',
  recruitKnight: 'Recruit Knight',
};

/** Repeating plots (recruiting) don't show a level number. */
const REPEATING = new Set<PlotKind>(['recruitArcher', 'recruitKnight', 'barricade']);

export class Plot {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  level = 0;
  paid = 0;
  /** Coins currently flying towards this plot. */
  pending = 0;
  shown = false;
  private appear = 0;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private tex: THREE.CanvasTexture;
  private plane: THREE.Mesh;
  private drawnKey = '';
  private pulse = 0;

  constructor(readonly def: PlotDef) {
    this.canvas.width = this.canvas.height = PX;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = 0.04;
    this.plane.renderOrder = 2;
    this.group.add(this.plane);
    this.group.visible = false;
    this.setPos(0, 0);
  }

  setPos(x: number, z: number) {
    this.pos.set(x, 0, z);
    this.group.position.copy(this.pos);
  }

  get cost() {
    return this.def.costs[this.level] ?? 0;
  }
  get remaining() {
    return Math.max(0, this.cost - this.paid);
  }
  get maxed() {
    return this.level >= this.def.costs.length;
  }

  show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.group.visible = on;
    if (on) this.appear = 0;
  }

  bump() {
    this.pulse = 1;
  }

  update(dt: number, active: boolean) {
    if (!this.shown) return;
    this.appear = Math.min(1, this.appear + dt * 3);
    this.pulse = Math.max(0, this.pulse - dt * 6);
    const a = this.appear;
    const pop = a < 1 ? 1 + Math.sin(a * Math.PI) * 0.25 : 1;
    const s = pop * (1 + this.pulse * 0.06) * (active ? 1.06 : 1);
    this.plane.scale.set(s * a, s * a, 1);
    this.redraw(active);
  }

  private redraw(active: boolean) {
    const key = `${this.level}|${this.paid}|${active}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const g = this.ctx;
    const W = PX;
    g.clearRect(0, 0, W, W);

    // Body
    const r = 34;
    const inset = 10;
    roundRect(g, inset, inset, W - inset * 2, W - inset * 2, r);
    g.fillStyle = active ? 'rgba(40,26,12,0.62)' : 'rgba(40,26,12,0.45)';
    g.fill();

    // Progress fill (bottom-up)
    const frac = this.cost ? this.paid / this.cost : 0;
    if (frac > 0) {
      g.save();
      roundRect(g, inset, inset, W - inset * 2, W - inset * 2, r);
      g.clip();
      const h = (W - inset * 2) * frac;
      g.fillStyle = 'rgba(255,201,40,0.55)';
      g.fillRect(inset, W - inset - h, W - inset * 2, h);
      g.restore();
    }

    // Dashed border
    g.setLineDash([22, 14]);
    g.lineWidth = 9;
    g.strokeStyle = active ? '#ffe27a' : 'rgba(255,244,214,0.9)';
    roundRect(g, inset + 4, inset + 4, W - inset * 2 - 8, W - inset * 2 - 8, r - 4);
    g.stroke();
    g.setLineDash([]);

    // Icon
    g.save();
    g.translate(W / 2, 96);
    drawIcon(g, this.def.kind);
    g.restore();

    // Label
    const lvl = !REPEATING.has(this.def.kind) && this.level > 0 ? ` ${roman(this.level + 1)}` : '';
    const label = LABEL[this.def.kind] + lvl;
    g.font = `bold ${label.length > 13 ? 22 : 26}px "Lilita One", "Trebuchet MS", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff4d6';
    g.fillText(label, W / 2, 158);

    // Cost: coin + number
    const txt = String(this.remaining);
    g.font = 'bold 48px "Lilita One", "Trebuchet MS", sans-serif';
    const tw = g.measureText(txt).width;
    const cx = W / 2 - (tw + 40) / 2 + 16;
    g.beginPath();
    g.arc(cx, 204, 16, 0, Math.PI * 2);
    g.fillStyle = '#ffc928';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#8a5d00';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.lineWidth = 7;
    g.strokeStyle = '#3a2410';
    g.textAlign = 'left';
    g.strokeText(txt, cx + 24, 206);
    g.fillText(txt, cx + 24, 206);

    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    (this.plane.material as THREE.Material).dispose();
    this.plane.geometry.dispose();
  }
}

function plus(g: CanvasRenderingContext2D) {
  g.moveTo(30, -44);
  g.rect(30, -44, 10, 30);
  g.rect(20, -34, 30, 10);
}

function roman(n: number) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1] ?? String(n);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Simple bold silhouettes, drawn around (0,0), roughly 80px tall. */
function drawIcon(g: CanvasRenderingContext2D, kind: PlotKind) {
  g.fillStyle = '#fff4d6';
  g.strokeStyle = '#3a2410';
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.beginPath();
  switch (kind) {
    case 'tower':
      // Stilt tower
      g.rect(-30, -40, 60, 16);
      g.moveTo(-24, -24);
      g.lineTo(-30, 42);
      g.lineTo(-20, 42);
      g.lineTo(-14, -24);
      g.closePath();
      g.moveTo(24, -24);
      g.lineTo(30, 42);
      g.lineTo(20, 42);
      g.lineTo(14, -24);
      g.closePath();
      g.rect(-22, 4, 44, 8);
      break;
    case 'post':
      // Banner on a pole
      g.rect(-24, -42, 8, 84);
      g.moveTo(-16, -40);
      g.lineTo(30, -40);
      g.lineTo(30, 0);
      g.lineTo(7, -10);
      g.lineTo(-16, 0);
      g.closePath();
      break;
    case 'barricade':
      for (let i = 0; i < 4; i++) {
        const x = -36 + i * 22;
        g.moveTo(x, 38);
        g.lineTo(x + 18, -30);
        g.lineTo(x + 26, -26);
        g.lineTo(x + 10, 40);
        g.closePath();
      }
      break;
    case 'range':
      g.arc(0, 0, 38, 0, Math.PI * 2);
      g.moveTo(22, 0);
      g.arc(0, 0, 22, 0, Math.PI * 2);
      g.moveTo(8, 0);
      g.arc(0, 0, 8, 0, Math.PI * 2);
      break;
    case 'barracks':
    case 'recruitKnight':
      // Helmet
      g.moveTo(-30, 30);
      g.lineTo(-30, -6);
      g.quadraticCurveTo(-30, -40, 0, -40);
      g.quadraticCurveTo(30, -40, 30, -6);
      g.lineTo(30, 30);
      g.lineTo(6, 30);
      g.lineTo(6, 0);
      g.lineTo(-6, 0);
      g.lineTo(-6, 30);
      g.closePath();
      if (kind === 'recruitKnight') plus(g);
      break;
    case 'recruitArcher':
      // Bow with arrow
      g.moveTo(-8, -40);
      g.quadraticCurveTo(44, 0, -8, 40);
      g.lineTo(-8, 30);
      g.quadraticCurveTo(28, 0, -8, -30);
      g.closePath();
      g.rect(-34, -3, 56, 6);
      plus(g);
      break;
    case 'forge':
      // Anvil
      g.moveTo(-40, -22);
      g.lineTo(34, -22);
      g.quadraticCurveTo(34, -6, 14, -4);
      g.lineTo(10, 14);
      g.lineTo(26, 30);
      g.lineTo(-26, 30);
      g.lineTo(-10, 14);
      g.lineTo(-14, -4);
      g.quadraticCurveTo(-30, -6, -40, -22);
      g.closePath();
      break;
    case 'bowyer':
      g.moveTo(-14, -40);
      g.quadraticCurveTo(46, 0, -14, 40);
      g.lineTo(-14, 30);
      g.quadraticCurveTo(30, 0, -14, -30);
      g.closePath();
      g.rect(-18, -40, 4, 80);
      break;
  }
  g.stroke();
  g.fill();
}
