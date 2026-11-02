// Floating virtual joystick (touch + mouse) plus WASD / arrow keys for desktop.

export class Input {
  /** Movement vector in screen space, length 0..1 (x right, y down). */
  readonly move = { x: 0, y: 0 };
  private pointerId: number | null = null;
  private origin = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  private keys = new Set<string>();
  private base: HTMLElement;
  private knob: HTMLElement;
  private readonly radius = 56;
  enabled = false;

  constructor(private surface: HTMLElement) {
    this.base = document.getElementById('joy-base')!;
    this.knob = document.getElementById('joy-knob')!;

    surface.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  /** Pointer position relative to the game column (it may be letterboxed on wide screens). */
  private local(e: PointerEvent) {
    const r = this.surface.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.pointerId !== null) return;
    const p = this.local(e);
    this.pointerId = e.pointerId;
    this.origin.x = p.x;
    this.origin.y = p.y;
    this.stick.x = this.stick.y = 0;
    this.base.style.transform = `translate(${p.x}px, ${p.y}px)`;
    this.knob.style.transform = `translate(${p.x}px, ${p.y}px)`;
    this.base.classList.add('on');
    this.knob.classList.add('on');
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const p = this.local(e);
    let dx = p.x - this.origin.x;
    let dy = p.y - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      // Drag the base along so the stick never feels "stuck" at the edge.
      const over = d - this.radius;
      this.origin.x += (dx / d) * over;
      this.origin.y += (dy / d) * over;
      dx = p.x - this.origin.x;
      dy = p.y - this.origin.y;
      this.base.style.transform = `translate(${this.origin.x}px, ${this.origin.y}px)`;
    }
    this.stick.x = dx / this.radius;
    this.stick.y = dy / this.radius;
    this.knob.style.transform = `translate(${p.x}px, ${p.y}px)`;
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.release();
  };

  release() {
    this.pointerId = null;
    this.stick.x = this.stick.y = 0;
    this.base.classList.remove('on');
    this.knob.classList.remove('on');
  }

  update() {
    let x = this.stick.x;
    let y = this.stick.y;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    const len = Math.hypot(x, y);
    if (len < 0.12) {
      x = y = 0;
    } else if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = this.enabled ? x : 0;
    this.move.y = this.enabled ? y : 0;
  }
}
