// Procedural command-bar icons drawn on small canvases, tinted with the player's colour.
import type { IconKind } from '../core/types';

const cache = new Map<string, HTMLCanvasElement>();

export function iconCanvas(kind: IconKind, color: string, size = 64): HTMLCanvasElement {
  const key = kind + ':' + color + ':' + size;
  const c = cache.get(key);
  if (c) return c;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  g.scale(size / 64, size / 64);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const dark = '#1d222a';
  const light = '#e8ebe4';
  const fill = (p: () => void, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    p();
    g.fill();
  };
  const rect = (x: number, y: number, w: number, h: number, col: string, r = 3) => {
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  const circle = (x: number, y: number, r: number, col: string) => fill(() => g.arc(x, y, r, 0, 6.283), col);
  const soldier = (x: number, col: string, scale = 1) => {
    g.save();
    g.translate(x, 0);
    g.scale(scale, scale);
    circle(32, 18, 7, '#e8c39a');
    rect(25, 12, 14, 5, col, 2);
    rect(24, 26, 16, 18, col, 3);
    rect(25, 44, 6, 14, dark, 2);
    rect(33, 44, 6, 14, dark, 2);
    g.restore();
  };
  const tank = (col: string, big = false) => {
    const w = big ? 50 : 42, h = big ? 18 : 14;
    rect(32 - w / 2, 40, w, h, dark, 5);
    rect(32 - w / 2 + 3, 32, w - 6, 12, col, 3);
    rect(22, 24, 20, 12, col, 3);
    rect(40, 27, 20, 5, dark, 2);
  };
  const building = (col: string) => {
    rect(8, 30, 48, 26, light, 3);
    rect(12, 18, 24, 14, col, 3);
    rect(40, 22, 12, 10, dark, 2);
    rect(28, 42, 10, 14, dark, 2);
  };
  switch (kind) {
    case 'infantry':
      soldier(0, color);
      rect(38, 30, 18, 4, dark, 2);
      break;
    case 'rocketinf':
      soldier(0, color);
      rect(24, 20, 30, 7, '#4a6a3a', 2);
      circle(54, 23.5, 4, '#c33');
      break;
    case 'sniper':
      soldier(0, '#3c5a2a');
      rect(30, 28, 32, 3, dark, 1);
      circle(48, 29, 4, '#333');
      break;
    case 'hero':
      soldier(0, color);
      fill(() => {
        g.moveTo(32, 2); g.lineTo(35, 9); g.lineTo(42, 9); g.lineTo(36, 13); g.lineTo(38, 20); g.lineTo(32, 16); g.lineTo(26, 20); g.lineTo(28, 13); g.lineTo(22, 9); g.lineTo(29, 9);
      }, '#f2c230');
      break;
    case 'worker':
      soldier(0, '#d8c080');
      rect(42, 20, 5, 26, '#8a5a2a', 2);
      rect(38, 18, 13, 6, '#777', 2);
      break;
    case 'mob':
      soldier(-14, '#8a5a3a', 0.8);
      soldier(14, color, 0.8);
      soldier(0, '#c33', 0.9);
      break;
    case 'tank':
      tank(color);
      break;
    case 'heavytank':
      tank(color, true);
      rect(40, 22, 20, 4, dark, 2);
      break;
    case 'truck':
      rect(10, 32, 44, 16, color, 4);
      rect(38, 22, 16, 12, light, 3);
      circle(20, 50, 6, dark);
      circle(44, 50, 6, dark);
      break;
    case 'dozer':
      rect(14, 30, 30, 16, '#f2c230', 4);
      rect(28, 20, 14, 12, color, 3);
      rect(48, 26, 6, 24, '#999', 2);
      rect(10, 46, 36, 8, dark, 4);
      break;
    case 'artillery':
      rect(10, 36, 40, 14, color, 4);
      circle(20, 52, 6, dark);
      circle(42, 52, 6, dark);
      g.save();
      g.translate(30, 36);
      g.rotate(-0.7);
      rect(0, -3, 32, 6, dark, 2);
      g.restore();
      break;
    case 'aa':
      rect(12, 36, 40, 14, color, 4);
      circle(22, 52, 6, dark);
      circle(42, 52, 6, dark);
      for (let i = 0; i < 3; i++) {
        g.save();
        g.translate(32, 36);
        g.rotate(-0.9 + i * 0.25);
        rect(0, -2, 26, 3, dark, 1);
        g.restore();
      }
      break;
    case 'heli':
      rect(14, 30, 34, 14, color, 6);
      rect(44, 34, 14, 5, dark, 2);
      rect(8, 22, 48, 4, dark, 2);
      circle(32, 24, 3, light);
      rect(20, 46, 24, 3, dark, 1);
      break;
    case 'jet':
      fill(() => {
        g.moveTo(32, 6); g.lineTo(40, 30); g.lineTo(58, 44); g.lineTo(40, 42); g.lineTo(38, 56); g.lineTo(26, 56); g.lineTo(24, 42); g.lineTo(6, 44); g.lineTo(24, 30);
      }, color);
      rect(29, 14, 6, 12, light, 3);
      break;
    case 'bomber':
      fill(() => {
        g.moveTo(32, 8); g.lineTo(60, 48); g.lineTo(32, 42); g.lineTo(4, 48);
      }, '#2b2b2b');
      rect(28, 22, 8, 8, color, 2);
      break;
    case 'flame':
      tank(color);
      fill(() => {
        g.moveTo(48, 30); g.quadraticCurveTo(60, 22, 56, 10); g.quadraticCurveTo(58, 20, 50, 20);
      }, '#f08a24');
      break;
    case 'toxin':
      rect(10, 32, 44, 16, color, 4);
      circle(22, 50, 6, dark);
      circle(44, 50, 6, dark);
      circle(26, 28, 9, '#3fae4a');
      circle(44, 26, 6, '#7cff5a');
      break;
    case 'bomb':
      circle(30, 36, 16, dark);
      rect(38, 16, 6, 10, '#999', 2);
      fill(() => {
        g.moveTo(44, 14); g.lineTo(52, 6); g.lineTo(54, 12);
      }, '#f08a24');
      break;
    case 'building':
      building(color);
      break;
    case 'power':
      rect(14, 26, 36, 30, light, 4);
      fill(() => {
        g.moveTo(36, 10); g.lineTo(24, 36); g.lineTo(34, 36); g.lineTo(28, 56); g.lineTo(44, 30); g.lineTo(34, 30); g.lineTo(40, 10);
      }, '#f2c230');
      break;
    case 'barracks':
      rect(8, 28, 48, 28, light, 3);
      fill(() => {
        g.moveTo(6, 30); g.lineTo(32, 14); g.lineTo(58, 30);
      }, color);
      rect(26, 40, 12, 16, dark, 2);
      break;
    case 'factory':
      rect(6, 30, 52, 26, light, 3);
      fill(() => {
        g.moveTo(6, 30); g.lineTo(18, 18); g.lineTo(30, 30); g.lineTo(42, 18); g.lineTo(54, 30);
      }, color);
      rect(46, 8, 8, 20, dark, 2);
      rect(16, 40, 18, 16, dark, 2);
      break;
    case 'supply':
      rect(8, 36, 48, 20, light, 3);
      rect(14, 22, 14, 14, '#9c7a4a', 2);
      rect(30, 22, 14, 14, color, 2);
      rect(22, 8, 14, 14, '#6b7a4a', 2);
      break;
    case 'airfield':
      rect(6, 20, 52, 36, '#8a8a84', 3);
      for (let i = 0; i < 4; i++) rect(14 + i * 11, 36, 7, 4, light, 1);
      rect(10, 24, 16, 10, color, 2);
      break;
    case 'turret':
      rect(14, 40, 36, 14, light, 3);
      rect(22, 28, 20, 14, color, 3);
      g.save();
      g.translate(40, 32);
      g.rotate(-0.8);
      rect(0, -3, 24, 6, dark, 2);
      g.restore();
      break;
    case 'tech':
      rect(10, 32, 44, 24, light, 3);
      circle(32, 26, 14, color);
      rect(44, 8, 3, 24, dark, 1);
      circle(46, 8, 3, '#c33');
      break;
    case 'super':
      rect(12, 36, 40, 20, light, 3);
      fill(() => {
        g.moveTo(32, 4); g.lineTo(40, 36); g.lineTo(24, 36);
      }, color);
      fill(() => {
        g.moveTo(32, 2); g.lineTo(36, 10); g.lineTo(28, 10);
      }, '#c33');
      break;
    case 'tunnel':
      fill(() => g.arc(32, 44, 24, Math.PI, 0), '#b89d64');
      fill(() => g.arc(32, 44, 12, Math.PI, 0), dark);
      rect(8, 44, 48, 6, '#8a7a5a', 2);
      break;
    case 'market':
      rect(10, 30, 44, 26, light, 3);
      rect(6, 24, 52, 8, '#c33', 2);
      rect(16, 14, 32, 12, color, 2);
      break;
    case 'trap':
      rect(14, 34, 36, 16, '#7a4b2a', 3);
      circle(32, 32, 6, '#c33');
      break;
    case 'speaker':
      rect(30, 20, 4, 36, '#888', 1);
      fill(() => {
        g.moveTo(34, 20); g.lineTo(52, 12); g.lineTo(52, 30);
      }, color);
      fill(() => {
        g.moveTo(30, 20); g.lineTo(12, 12); g.lineTo(12, 30);
      }, color);
      break;
    case 'upgrade':
      fill(() => {
        g.moveTo(32, 8); g.lineTo(52, 30); g.lineTo(40, 30); g.lineTo(40, 54); g.lineTo(24, 54); g.lineTo(24, 30); g.lineTo(12, 30);
      }, '#f2c230');
      break;
    case 'plan':
      rect(12, 12, 40, 40, light, 4);
      rect(18, 20, 28, 4, color, 1);
      rect(18, 30, 20, 4, dark, 1);
      rect(18, 40, 24, 4, dark, 1);
      break;
  }
  cache.set(key, cv);
  return cv;
}

/** Simple glyph icons for actions (stop, attack-move, sell ...). */
export function glyphIcon(glyph: string, color = '#fff', size = 64) {
  const key = 'g:' + glyph + ':' + color + ':' + size;
  const c = cache.get(key);
  if (c) return c;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = color;
  g.font = `bold ${size * 0.55}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, size / 2, size / 2 + 2);
  cache.set(key, cv);
  return cv;
}
