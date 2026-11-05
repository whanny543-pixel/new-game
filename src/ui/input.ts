// Touch and mouse input. Touch: tap = select/command, drag = pan, long-press-drag = box select,
// pinch = zoom, double tap = select all of a type. Mouse: left drag box select, right click
// command, wheel zoom, middle drag / WASD pan.
import type { Marquee } from './overlay';

export interface InputHandler {
  onTap(x: number, y: number, double: boolean, button: number): void;
  onMarquee(x0: number, y0: number, x1: number, y1: number): void;
  onPan(dx: number, dy: number): void;
  onZoom(factor: number): void;
  onKey(key: string, down: boolean, e: KeyboardEvent): void;
  onHover(x: number, y: number): void;
  onLongPress(x: number, y: number): void;
}

interface P {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  type: string;
  button: number;
  moved: boolean;
}

export class Input {
  marquee: Marquee = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  private pointers = new Map<number, P>();
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private lastTap = { t: 0, x: 0, y: 0 };
  private pressTimer = 0;
  private panning = false;
  private el: HTMLElement;
  private handler: InputHandler;
  private keys = new Set<string>();
  private disposers: (() => void)[] = [];
  isTouch = false;

  constructor(el: HTMLElement, handler: InputHandler) {
    this.el = el;
    this.handler = handler;
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, ev: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(ev, fn as EventListener));
    };
    on(el, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(el, 'pointermove', (e: PointerEvent) => this.move(e));
    on(el, 'pointerup', (e: PointerEvent) => this.up(e));
    on(el, 'pointercancel', (e: PointerEvent) => this.up(e, true));
    on(el, 'contextmenu', (e: Event) => e.preventDefault());
    on(el, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      handler.onZoom(Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      handler.onKey(e.key, true, e);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase());
      handler.onKey(e.key, false, e);
    });
    on(window, 'blur', () => this.keys.clear());
  }

  /** Keyboard panning, called each frame. */
  tick(dt: number) {
    let dx = 0, dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') && !this.keys.has('shift') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') && !this.keys.has('shift') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (dx || dy) this.handler.onPan(-dx * 900 * dt, -dy * 900 * dt);
  }

  private down(e: PointerEvent) {
    if ((e.target as HTMLElement) !== this.el) return;
    this.el.setPointerCapture?.(e.pointerId);
    this.isTouch = e.pointerType === 'touch';
    const p: P = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), type: e.pointerType, button: e.button, moved: false };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.cancelPress();
      this.marquee.active = false;
      return;
    }
    if (e.pointerType === 'mouse') {
      if (e.button === 0) {
        this.marquee = { active: false, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
      } else if (e.button === 1) this.panning = true;
      return;
    }
    // Touch: long press starts a box selection.
    this.cancelPress();
    this.pressTimer = window.setTimeout(() => {
      const q = this.pointers.get(e.pointerId);
      if (!q || q.moved || this.pointers.size !== 1) return;
      this.marquee = { active: true, x0: q.x, y0: q.y, x1: q.x, y1: q.y };
      this.handler.onLongPress(q.x, q.y);
    }, 320);
  }

  private cancelPress() {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
      this.pressTimer = 0;
    }
  }

  private move(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.handler.onHover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDist > 0) this.handler.onZoom(this.pinchDist / d);
      this.handler.onPan(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
      this.pinchDist = d;
      this.pinchMid = mid;
      return;
    }
    if (p.type === 'mouse') {
      if (p.button === 0) {
        if (p.moved) {
          this.marquee.active = true;
          this.marquee.x1 = p.x;
          this.marquee.y1 = p.y;
        }
      } else if (p.button === 1 || this.panning) this.handler.onPan(dx, dy);
      this.handler.onHover(e.clientX, e.clientY);
      return;
    }
    if (this.marquee.active) {
      this.marquee.x1 = p.x;
      this.marquee.y1 = p.y;
      return;
    }
    if (p.moved) {
      this.cancelPress();
      this.handler.onPan(dx, dy);
    }
  }

  private up(e: PointerEvent, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.cancelPress();
    if (!p) return;
    if (this.pointers.size >= 1) {
      // Lifted one finger of a pinch: reset so the remaining finger pans cleanly.
      for (const q of this.pointers.values()) q.moved = true;
      this.pinchDist = 0;
      return;
    }
    this.panning = false;
    if (cancelled) {
      this.marquee.active = false;
      return;
    }
    if (this.marquee.active) {
      this.marquee.active = false;
      if (Math.abs(this.marquee.x1 - this.marquee.x0) > 6 || Math.abs(this.marquee.y1 - this.marquee.y0) > 6) this.handler.onMarquee(this.marquee.x0, this.marquee.y0, this.marquee.x1, this.marquee.y1);
      else if (p.type !== 'mouse') this.handler.onTap(p.x, p.y, false, 0);
      return;
    }
    if (p.moved) return;
    const now = performance.now();
    if (p.type !== 'mouse' && now - p.t > 450) return;
    const double = now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30;
    this.lastTap = { t: double ? 0 : now, x: p.x, y: p.y };
    this.handler.onTap(p.x, p.y, double, p.button);
  }

  dispose() {
    for (const d of this.disposers) d();
    this.cancelPress();
  }
}
