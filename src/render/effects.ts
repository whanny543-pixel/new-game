// Particles, tracers, flashes and beams. Two point systems: additive (fire, sparks) and
// normal-blended (smoke, dust, toxin). Everything is pooled and cheap enough for a phone.
import * as THREE from 'three';
import type { GameEvent } from '../game/game';
import type { Field } from '../game/combat';

const MAX = 3000;

class PointSystem {
  geo = new THREE.BufferGeometry();
  pos = new Float32Array(MAX * 3);
  col = new Float32Array(MAX * 4);
  size = new Float32Array(MAX);
  vel = new Float32Array(MAX * 3);
  life = new Float32Array(MAX);
  maxLife = new Float32Array(MAX);
  grow = new Float32Array(MAX);
  grav = new Float32Array(MAX);
  baseSize = new Float32Array(MAX);
  baseA = new Float32Array(MAX);
  count = 0;
  points: THREE.Points;
  constructor(additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.12, r) * vC.a; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.geo.setDrawRange(0, 0);
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, a: number, grow = 0, grav = 0) {
    let i = this.count;
    if (i >= MAX) i = Math.floor(Math.random() * MAX);
    else this.count++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.baseSize[i] = size;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.baseA[i] = a;
    this.grow[i] = grow;
    this.grav[i] = grav;
  }
  update(dt: number) {
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      if (w !== i) {
        for (let k = 0; k < 3; k++) {
          this.pos[w * 3 + k] = this.pos[i * 3 + k];
          this.vel[w * 3 + k] = this.vel[i * 3 + k];
        }
        for (let k = 0; k < 4; k++) this.col[w * 4 + k] = this.col[i * 4 + k];
        this.maxLife[w] = this.maxLife[i];
        this.baseSize[w] = this.baseSize[i];
        this.baseA[w] = this.baseA[i];
        this.grow[w] = this.grow[i];
        this.grav[w] = this.grav[i];
      }
      this.life[w] = l;
      this.vel[w * 3 + 1] -= this.grav[w] * dt;
      this.pos[w * 3] += this.vel[w * 3] * dt;
      this.pos[w * 3 + 1] += this.vel[w * 3 + 1] * dt;
      this.pos[w * 3 + 2] += this.vel[w * 3 + 2] * dt;
      const t = l / this.maxLife[w];
      this.size[w] = this.baseSize[w] * (1 + this.grow[w] * (1 - t));
      this.col[w * 4 + 3] = this.baseA[w] * Math.min(1, t * 2.5);
      w++;
    }
    this.count = w;
    this.geo.setDrawRange(0, w);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Flash {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  size: number;
  mat: THREE.MeshBasicMaterial;
}

interface Beam {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  mat: THREE.MeshBasicMaterial;
}

const LINES = 400;

export class Effects {
  group = new THREE.Group();
  fire = new PointSystem(true);
  smoke = new PointSystem(false);
  private flashes: Flash[] = [];
  private flashPool: Flash[] = [];
  private beams: Beam[] = [];
  private beamPool: Beam[] = [];
  private lineGeo = new THREE.BufferGeometry();
  private linePos = new Float32Array(LINES * 6);
  private lineCol = new Float32Array(LINES * 6);
  private lineLife = new Float32Array(LINES);
  private lineCount = 0;
  private sphereGeo = new THREE.SphereGeometry(1, 10, 8);
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  /** Screen flash intensity (0..1) for the overlay to draw. */
  screenFlash = 0;
  shake = 0;
  heightAt: (x: number, y: number) => number = () => 0;

  constructor() {
    this.group.add(this.fire.points, this.smoke.points);
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineGeo.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false;
    this.group.add(lines);
    this.lineGeo.setDrawRange(0, 0);
    this.beamGeo.translate(0, 0.5, 0);
  }

  private flash(x: number, y: number, z: number, size: number, color: number, dur = 0.25) {
    let f = this.flashPool.pop();
    if (!f) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      f = { mesh: new THREE.Mesh(this.sphereGeo, mat), t: 0, dur, size, mat };
      this.group.add(f.mesh);
    }
    f.mat.color.set(color);
    f.t = 0;
    f.dur = dur;
    f.size = size;
    f.mesh.visible = true;
    f.mesh.position.set(x, y, z);
    f.mesh.scale.setScalar(size * 0.3);
    this.flashes.push(f);
  }

  /** Thin glowing cylinder between two points (lasers, lance). */
  beam(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, radius: number, color: number, dur: number) {
    let b = this.beamPool.pop();
    if (!b) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      b = { mesh: new THREE.Mesh(this.beamGeo, mat), t: 0, dur, mat };
      this.group.add(b.mesh);
    }
    b.mat.color.set(color);
    b.mat.opacity = 0.8;
    b.t = 0;
    b.dur = dur;
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz) || 0.01;
    b.mesh.position.set(x1, y1, z1);
    b.mesh.scale.set(radius, len, radius);
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    b.mesh.visible = true;
    this.beams.push(b);
  }

  private line(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, r: number, g: number, b: number, life: number) {
    let i = this.lineCount;
    if (i >= LINES) i = Math.floor(Math.random() * LINES);
    else this.lineCount++;
    const p = this.linePos, c = this.lineCol;
    p[i * 6] = x1; p[i * 6 + 1] = y1; p[i * 6 + 2] = z1; p[i * 6 + 3] = x2; p[i * 6 + 4] = y2; p[i * 6 + 5] = z2;
    c[i * 6] = r; c[i * 6 + 1] = g; c[i * 6 + 2] = b; c[i * 6 + 3] = r; c[i * 6 + 4] = g; c[i * 6 + 5] = b;
    this.lineLife[i] = life;
  }

  explosion(x: number, y: number, z: number, size: number, style: string) {
    const rnd = () => (Math.random() - 0.5) * 2;
    const s = Math.max(0.5, size);
    switch (style) {
      case 'blast':
      case 'crash': {
        this.flash(x, y + 0.3, z, s * 2.2, 0xffd38a, 0.22);
        const n = Math.min(60, 10 + s * 12);
        for (let i = 0; i < n; i++) this.fire.spawn(x + rnd() * s * 0.4, y + 0.2 + Math.random() * s * 0.3, z + rnd() * s * 0.4, rnd() * s * 2.5, 2 + Math.random() * s * 3, rnd() * s * 2.5, 0.35 + Math.random() * 0.4, 0.5 + s * 0.4, 1, 0.45 + Math.random() * 0.3, 0.1, 0.9, 0.8, 4);
        for (let i = 0; i < n * 0.4; i++) this.smoke.spawn(x + rnd() * s * 0.5, y + 0.3, z + rnd() * s * 0.5, rnd() * s, 1.5 + Math.random() * 2, rnd() * s, 1.0 + Math.random() * s * 0.4, 0.5 + s * 0.3, 0.25, 0.25, 0.25, 0.4, 1.6, -0.5);
        for (let i = 0; i < n * 0.5; i++) this.smoke.spawn(x, y + 0.2, z, rnd() * s * 5, 3 + Math.random() * s * 4, rnd() * s * 5, 0.6 + Math.random() * 0.5, 0.18, 0.15, 0.12, 0.1, 1, 0, 14);
        break;
      }
      case 'fire':
        this.flash(x, y + 0.2, z, s * 1.6, 0xff8a2a, 0.2);
        for (let i = 0; i < 12 + s * 8; i++) this.fire.spawn(x + rnd() * s * 0.6, y + 0.1, z + rnd() * s * 0.6, rnd() * 1.2, 1.5 + Math.random() * 2, rnd() * 1.2, 0.5 + Math.random() * 0.6, 0.6 + s * 0.4, 1, 0.4 + Math.random() * 0.3, 0.05, 0.8, 1.5, 0);
        for (let i = 0; i < 4 + s * 2; i++) this.smoke.spawn(x + rnd() * s * 0.5, y + 0.6, z + rnd() * s * 0.5, rnd() * 0.5, 1 + Math.random(), rnd() * 0.5, 1.2 + Math.random(), 0.6, 0.12, 0.12, 0.12, 0.4, 1.5, -0.3);
        break;
      case 'toxin':
        for (let i = 0; i < 14 + s * 8; i++) this.smoke.spawn(x + rnd() * s * 0.7, y + 0.2, z + rnd() * s * 0.7, rnd() * 0.8, 0.5 + Math.random(), rnd() * 0.8, 1.5 + Math.random() * 1.5, 0.9 + s * 0.4, 0.35, 0.9, 0.25, 0.55, 2, -0.2);
        this.flash(x, y + 0.2, z, s * 1.3, 0x7cff5a, 0.2);
        break;
      case 'nuke': {
        this.flash(x, y + 1, z, s * 3, 0xffffff, 0.9);
        this.screenFlash = 1;
        this.shake = Math.max(this.shake, 1.5);
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * 6.28, r = Math.random() * s * 0.5;
          this.fire.spawn(x + Math.cos(a) * r, y + 0.3, z + Math.sin(a) * r, Math.cos(a) * 2, 5 + Math.random() * 7, Math.sin(a) * 2, 2 + Math.random() * 2, 1.5 + Math.random() * 2, 1, 0.5 + Math.random() * 0.3, 0.1, 0.9, 3, -1);
        }
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * 6.28, r = Math.random() * s;
          this.smoke.spawn(x + Math.cos(a) * r, y + 0.3, z + Math.sin(a) * r, Math.cos(a) * 6, 1 + Math.random() * 3, Math.sin(a) * 6, 3 + Math.random() * 3, 1.4 + Math.random() * 1.5, 0.25, 0.22, 0.2, 0.55, 1.5, -0.3);
        }
        break;
      }
      case 'rad':
        for (let i = 0; i < 4; i++) this.fire.spawn(x + rnd() * s, y + 0.1, z + rnd() * s, 0, 0.6, 0, 1.2, 0.6, 0.6, 1, 0.3, 0.4, 1, 0);
        break;
      case 'flash':
        this.flash(x, y, z, s, 0xfff0c0, 0.12);
        break;
      case 'emp': {
        this.flash(x, y, z, s * 2, 0x6ab8ff, 0.5);
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * 6.28;
          this.fire.spawn(x, y + 0.5, z, Math.cos(a) * s * 1.6, 0.5, Math.sin(a) * s * 1.6, 0.6, 0.5, 0.5, 0.75, 1, 0.9, 1, 0);
        }
        break;
      }
      case 'smoke':
        for (let i = 0; i < 20; i++) this.smoke.spawn(x + rnd() * s, y + 0.2, z + rnd() * s, rnd(), 1 + Math.random(), rnd(), 1.5, 1.2, 0.5, 0.45, 0.4, 0.6, 2, -0.2);
        break;
      case 'spark':
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * 6.28;
          this.fire.spawn(x + Math.cos(a) * s * 0.3, y + 0.3, z + Math.sin(a) * s * 0.3, Math.cos(a) * 2, 2 + Math.random() * 3, Math.sin(a) * 2, 0.8, 0.35, 0.6, 1, 0.7, 1, 0, 3);
        }
        break;
      case 'lance':
        this.flash(x, y + 0.4, z, s * 2, 0xbfe6ff, 0.15);
        for (let i = 0; i < 10; i++) this.fire.spawn(x + rnd() * s, y + 0.2, z + rnd() * s, rnd() * 3, 2 + Math.random() * 4, rnd() * 3, 0.5, 0.5, 1, 0.8, 0.3, 1, 1, 4);
        for (let i = 0; i < 6; i++) this.smoke.spawn(x + rnd() * s, y + 0.5, z + rnd() * s, rnd(), 2, rnd(), 2, 1.2, 0.15, 0.15, 0.15, 0.5, 2, -0.3);
        break;
    }
  }

  muzzle(x: number, y: number, z: number, big: boolean) {
    this.flash(x, y, z, big ? 1.2 : 0.5, 0xffe08a, big ? 0.12 : 0.07);
    if (big) for (let i = 0; i < 6; i++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.8, 0.6, 0.6, 0.6, 0.6, 0.4, 1.5, 0);
  }

  handle(ev: GameEvent) {
    switch (ev.kind) {
      case 'tracer': {
        const c = ev.style === 'sniper' ? [1, 1, 0.8] : ev.style === 'aa' ? [1, 0.8, 0.3] : ev.style === 'laser' ? [1, 0.2, 0.2] : ev.style === 'hack' ? [0.3, 1, 0.5] : [1, 0.85, 0.5];
        if (ev.style === 'laser' || ev.style === 'hack') this.beam(ev.x1, ev.z1, ev.y1, ev.x2, ev.z2, ev.y2, 0.06, ev.style === 'laser' ? 0xff3030 : 0x40ff80, 0.15);
        else {
          // Draw the tracer as a short segment somewhere along the path.
          const t0 = Math.random() * 0.5;
          const t1 = Math.min(1, t0 + 0.35);
          this.line(ev.x1 + (ev.x2 - ev.x1) * t0, ev.z1 + (ev.z2 - ev.z1) * t0, ev.y1 + (ev.y2 - ev.y1) * t0, ev.x1 + (ev.x2 - ev.x1) * t1, ev.z1 + (ev.z2 - ev.z1) * t1, ev.y1 + (ev.y2 - ev.y1) * t1, c[0], c[1], c[2], 0.08);
          this.fire.spawn(ev.x2, ev.z2, ev.y2, 0, 0.5, 0, 0.15, 0.3, 1, 0.9, 0.5, 0.8, 0, 0);
        }
        break;
      }
      case 'muzzle':
        this.muzzle(ev.x, ev.z, ev.y, !!ev.big);
        break;
      case 'explosion':
        this.explosion(ev.x, ev.z, ev.y, ev.size, ev.style);
        break;
      case 'flame': {
        const n = 6;
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const x = ev.x1 + (ev.x2 - ev.x1) * t, y = ev.z1 + (ev.z2 - ev.z1) * t, z = ev.y1 + (ev.y2 - ev.y1) * t;
          if (ev.style === 'fire') this.fire.spawn(x, y, z, (ev.x2 - ev.x1) * 0.8, 0.8, (ev.y2 - ev.y1) * 0.8, 0.3 + t * 0.3, 0.4 + t * 0.6, 1, 0.5 + t * 0.3, 0.1, 0.9, 1.2, -1);
          else this.smoke.spawn(x, y, z, (ev.x2 - ev.x1) * 0.6, 0.4, (ev.y2 - ev.y1) * 0.6, 0.6 + t * 0.4, 0.5 + t * 0.6, 0.4, 0.9, 0.3, 0.5, 1.2, -0.3);
        }
        break;
      }
      case 'shake':
        this.shake = Math.max(this.shake, ev.amount);
        break;
      default:
        break;
    }
  }

  /** Ambient particles for lingering fields and burning things. */
  fieldTick(fields: Field[], dt: number) {
    for (const f of fields) {
      const n = Math.max(1, Math.round(f.r * f.r * 1.2 * dt * 10));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * f.r;
        const x = f.x + Math.cos(a) * r, z = f.y + Math.sin(a) * r;
        const y = this.heightAt(x, z);
        if (f.type === 'fire') this.fire.spawn(x, y + 0.1, z, 0, 1 + Math.random() * 1.5, 0, 0.5 + Math.random() * 0.4, 0.5 + Math.random() * 0.5, 1, 0.45 + Math.random() * 0.3, 0.05, 0.8, 1, 0);
        else if (f.type === 'toxin') this.smoke.spawn(x, y + 0.2, z, (Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4, 1.2 + Math.random(), 0.8 + Math.random() * 0.5, 0.4, 0.95, 0.3, 0.45, 1.5, -0.1);
        else this.fire.spawn(x, y + 0.1, z, 0, 0.5 + Math.random(), 0, 1 + Math.random(), 0.4, 0.5, 1, 0.3, 0.5, 1, 0);
      }
    }
  }

  burning(x: number, y: number, z: number, intensity: number, dt: number) {
    if (Math.random() > intensity * dt * 5) return;
    this.smoke.spawn(x + (Math.random() - 0.5) * 0.6, y + 0.3, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 0.8, 0.35, 0.15, 0.15, 0.15, 0.4, 1.8, -0.2);
    if (intensity > 0.6) this.fire.spawn(x + (Math.random() - 0.5) * 0.4, y + 0.3, z + (Math.random() - 0.5) * 0.4, 0, 1, 0, 0.4, 0.5, 1, 0.5, 0.1, 0.9, 1, 0);
  }

  update(dt: number) {
    this.fire.update(dt);
    this.smoke.update(dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const t = f.t / f.dur;
      if (t >= 1) {
        f.mesh.visible = false;
        this.flashes.splice(i, 1);
        this.flashPool.push(f);
        continue;
      }
      f.mesh.scale.setScalar(f.size * (0.3 + t * 0.7));
      f.mat.opacity = (1 - t) * 0.9;
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      if (b.t >= b.dur) {
        b.mesh.visible = false;
        this.beams.splice(i, 1);
        this.beamPool.push(b);
        continue;
      }
      b.mat.opacity = 0.8 * (1 - b.t / b.dur);
    }
    let w = 0;
    for (let i = 0; i < this.lineCount; i++) {
      const l = this.lineLife[i] - dt;
      if (l <= 0) continue;
      if (w !== i) {
        for (let k = 0; k < 6; k++) {
          this.linePos[w * 6 + k] = this.linePos[i * 6 + k];
          this.lineCol[w * 6 + k] = this.lineCol[i * 6 + k];
        }
      }
      this.lineLife[w] = l;
      w++;
    }
    this.lineCount = w;
    this.lineGeo.setDrawRange(0, w * 2);
    (this.lineGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.lineGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.screenFlash = Math.max(0, this.screenFlash - dt * 1.5);
    this.shake = Math.max(0, this.shake - dt * 2);
  }
}
