// 2D canvas drawn over the 3D view: health bars, veterancy chevrons, progress bars, the
// marquee rectangle, power target rings and the nuke screen flash.
import { TEAM_COLOR_CSS } from '../core/data';
import type { Entity, Player } from '../game/entity';
import type { Game } from '../game/game';
import type { SceneView } from '../render/scene';

export interface Marquee {
  active: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Overlay {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
  }

  private bar(x: number, y: number, w: number, frac: number, color: string, h = 4) {
    const g = this.ctx;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = color;
    g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  draw(game: Game, scene: SceneView, viewer: Player, selection: Set<Entity>, marquee: Marquee, flash: number, targetRing: { x: number; y: number; r: number } | null) {
    const g = this.ctx;
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const W = window.innerWidth, H = window.innerHeight;
    const t = game.time;
    for (const e of game.entities) {
      if (e.dead || e.kind === 'crate') continue;
      const selected = selection.has(e);
      const damaged = e.hp < e.maxHp * 0.999;
      const recent = t - e.lastDamaged < 4;
      const show = selected || (damaged && (e.owner === viewer ? true : recent)) || (e.isBuilding && !e.built && e.owner === viewer) || e.captureProgress > 0;
      if (!show) continue;
      if (!game.canSee(viewer, e)) continue;
      const height = e.isBuilding ? 2.5 : e.isUnit && e.udef!.move === 'infantry' ? 1.3 : 1.4;
      const p = scene.worldToScreen(e.x, e.y, e.z + height);
      if (!p.visible || p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) continue;
      const w = e.isBuilding ? Math.min(90, 26 + e.w * 7) : e.radius > 0.6 ? 34 : 22;
      const frac = e.hp / e.maxHp;
      const col = frac > 0.6 ? '#4ce06a' : frac > 0.3 ? '#f2c230' : '#e24a3a';
      this.bar(p.x - w / 2, p.y - 6, w, frac, col);
      if (e.isUnit && e.vet > 0) {
        g.fillStyle = e.vet >= 3 ? '#ffd34d' : '#f0f0f0';
        for (let i = 0; i < e.vet; i++) {
          const cx = p.x - w / 2 + 4 + i * 7, cy = p.y + 2;
          g.beginPath();
          g.moveTo(cx - 3, cy + 4);
          g.lineTo(cx, cy);
          g.lineTo(cx + 3, cy + 4);
          g.lineTo(cx, cy + 2.5);
          g.fill();
        }
      }
      if (e.isBuilding && !e.built) this.bar(p.x - w / 2, p.y + 1, w, e.progress, '#7ec8ff', 3);
      if (e.isBuilding && e.built && e.production.length && selected) this.bar(p.x - w / 2, p.y + 1, w, e.production[0].progress, '#f2c230', 3);
      if (e.captureProgress > 0) this.bar(p.x - w / 2, p.y + 1, w, e.captureProgress, TEAM_COLOR_CSS[e.capturer?.owner.color ?? 0], 3);
      if (e.groupId >= 0 && e.owner === viewer && selected) {
        g.fillStyle = '#fff';
        g.font = 'bold 10px system-ui';
        g.fillText(String(e.groupId), p.x + w / 2 + 3, p.y);
      }
    }
    // Attack alert markers.
    if (t - viewer.lastAttackedAt < 6) {
      const p = scene.worldToScreen(viewer.lastAttackX, viewer.lastAttackY, 1);
      if (p.visible) {
        g.strokeStyle = 'rgba(255,60,60,' + (0.5 + 0.5 * Math.sin(t * 10)) + ')';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(p.x, p.y, 18 + Math.sin(t * 6) * 4, 0, 6.283);
        g.stroke();
      }
    }
    if (targetRing) {
      const p = scene.worldToScreen(targetRing.x, targetRing.y, 0);
      const pr = scene.worldToScreen(targetRing.x + targetRing.r, targetRing.y, 0);
      g.strokeStyle = 'rgba(255,220,80,0.9)';
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.ellipse(p.x, p.y, Math.abs(pr.x - p.x), Math.abs(pr.x - p.x) * 0.6, 0, 0, 6.283);
      g.stroke();
      g.setLineDash([]);
    }
    if (marquee.active) {
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.fillStyle = 'rgba(120,200,255,0.15)';
      g.lineWidth = 1.5;
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
      g.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      g.strokeRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    }
    if (flash > 0) {
      g.fillStyle = `rgba(255,255,240,${Math.min(1, flash)})`;
      g.fillRect(0, 0, W, H);
    }
  }
}
