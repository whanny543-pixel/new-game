import * as THREE from 'three';
import { GEO, MAT } from './models';

// Juice: particles, flying coins, floating damage numbers.

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  grow: number;
  active: boolean;
}

interface Flyer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: () => THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  onArrive: () => void;
  active: boolean;
}

interface FloatText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  life: number;
  active: boolean;
}

const tmp = new THREE.Vector3();

export class Fx {
  private particles: Particle[] = [];
  private flyers: Flyer[] = [];
  private texts: FloatText[] = [];
  private matCache = new Map<number, THREE.MeshBasicMaterial>();
  shake = 0;

  constructor(
    scene: THREE.Scene,
    layer: HTMLElement,
  ) {
    for (let i = 0; i < 220; i++) {
      const mesh = new THREE.Mesh(GEO.particle, MAT.arrow);
      mesh.visible = false;
      scene.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, gravity: 14, grow: 0, active: false });
    }
    for (let i = 0; i < 140; i++) {
      const mesh = new THREE.Mesh(GEO.coin, MAT.coin);
      mesh.visible = false;
      scene.add(mesh);
      this.flyers.push({
        mesh,
        from: new THREE.Vector3(),
        to: () => tmp,
        t: 0,
        dur: 0.3,
        arc: 1,
        onArrive: () => {},
        active: false,
      });
    }
    for (let i = 0; i < 48; i++) {
      const el = document.createElement('div');
      el.className = 'float-text';
      layer.appendChild(el);
      this.texts.push({ el, pos: new THREE.Vector3(), life: 0, active: false });
    }
  }

  private mat(color: number) {
    let m = this.matCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.matCache.set(color, m);
    }
    return m;
  }

  burst(pos: THREE.Vector3, color: number, count: number, speed = 4, size = 1) {
    for (let i = 0; i < count; i++) {
      const p = this.particles.find((q) => !q.active);
      if (!p) return;
      p.active = true;
      p.mesh.visible = true;
      p.mesh.material = this.mat(color);
      p.mesh.position.copy(pos);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.mesh.scale.setScalar(p.size);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.vel.set(Math.cos(a) * s, 2 + Math.random() * speed, Math.sin(a) * s);
      p.maxLife = p.life = 0.45 + Math.random() * 0.4;
      p.gravity = 14;
      p.grow = 0;
    }
  }

  /** A soft puff that drifts upward and swells (chimney smoke, dust). */
  smoke(pos: THREE.Vector3, color = 0x9a8f86) {
    const p = this.particles.find((q) => !q.active);
    if (!p) return;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.material = this.mat(color);
    p.mesh.position.copy(pos);
    p.size = 2.2;
    p.mesh.scale.setScalar(p.size);
    p.vel.set((Math.random() - 0.5) * 0.4, 1.4, (Math.random() - 0.5) * 0.4);
    p.maxLife = p.life = 1.8;
    p.gravity = 0;
    p.grow = 1;
  }

  /** Returns false when the pool is exhausted (caller should apply the effect instantly). */
  fly(from: THREE.Vector3, to: () => THREE.Vector3, dur: number, arc: number, onArrive: () => void, scale = 1) {
    const f = this.flyers.find((q) => !q.active);
    if (!f) {
      onArrive();
      return false;
    }
    f.active = true;
    f.mesh.visible = true;
    f.mesh.scale.setScalar(scale);
    f.from.copy(from);
    f.to = to;
    f.t = 0;
    f.dur = dur;
    f.arc = arc;
    f.onArrive = onArrive;
    f.mesh.position.copy(from);
    return true;
  }

  text(pos: THREE.Vector3, msg: string, cls = '') {
    let t = this.texts.find((q) => !q.active);
    if (!t) t = this.texts.reduce((a, b) => (a.life < b.life ? a : b));
    t.active = true;
    t.life = 0.8;
    t.pos.copy(pos);
    t.pos.x += (Math.random() - 0.5) * 0.6;
    t.el.textContent = msg;
    t.el.className = `float-text show ${cls}`;
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number) {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.gravity && p.mesh.position.y < 0.08) {
        p.mesh.position.y = 0.08;
        p.vel.y *= -0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 6;
      const k = p.life / p.maxLife;
      p.mesh.scale.setScalar(p.grow ? p.size * (1 + (1 - k) * 1.5) * Math.min(1, k * 3) : Math.max(0.05, k) * p.size);
    }

    for (const f of this.flyers) {
      if (!f.active) continue;
      f.t += dt / f.dur;
      const to = f.to();
      if (f.t >= 1) {
        f.active = false;
        f.mesh.visible = false;
        f.onArrive();
        continue;
      }
      const e = f.t * f.t * (3 - 2 * f.t);
      f.mesh.position.lerpVectors(f.from, to, e);
      f.mesh.position.y += Math.sin(f.t * Math.PI) * f.arc;
      f.mesh.rotation.y += dt * 10;
    }

    for (const t of this.texts) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        t.el.className = 'float-text';
        continue;
      }
      t.pos.y += dt * 1.6;
      tmp.copy(t.pos).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;
      t.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      t.el.style.opacity = String(Math.min(1, t.life * 3));
    }

    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  clear() {
    for (const p of this.particles) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const f of this.flyers) {
      f.active = false;
      f.mesh.visible = false;
    }
    for (const t of this.texts) {
      t.active = false;
      t.el.className = 'float-text';
    }
    this.shake = 0;
  }
}
