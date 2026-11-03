import * as THREE from 'three';

// Point-sprite particles simulated on the CPU, drawn in one call per blend mode.
// Shapes are drawn procedurally in the fragment shader: soft orb, sparkle star, or ring-less puff.

export type Shape = 0 | 1 | 2; // 0 orb, 1 star, 2 puff

export interface Emit {
  pos: THREE.Vector3;
  count?: number;
  color: number | number[];
  /** Random spread of the start position. */
  spread?: number;
  speed?: number;
  /** Bias added to every particle's velocity. */
  dir?: THREE.Vector3;
  up?: number;
  size?: number;
  sizeEnd?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  shape?: Shape;
  glow?: boolean;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aShape;
  attribute float aSpin;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  varying float vSpin;
  uniform float uScale;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vShape = aShape;
    vSpin = aSpin;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vShape;
  varying float vSpin;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float a;
    if (vShape < 0.5) {
      // Soft glowing orb with a hot core.
      float d = length(p) * 2.0;
      a = smoothstep(1.0, 0.0, d);
      a = a * a + smoothstep(0.35, 0.0, d) * 0.6;
    } else if (vShape < 1.5) {
      // Four-point sparkle, rotated.
      float c = cos(vSpin), s = sin(vSpin);
      p = mat2(c, -s, s, c) * p;
      float d = length(p) * 2.0;
      float star = max(0.0, 1.0 - abs(p.x) * 14.0 * (abs(p.y) * 2.0 + 0.15)) + max(0.0, 1.0 - abs(p.y) * 14.0 * (abs(p.x) * 2.0 + 0.15));
      a = clamp(star, 0.0, 1.0) * smoothstep(1.0, 0.2, d) + smoothstep(0.25, 0.0, d);
    } else {
      // Puff: soft edged disc with slight lumpy edge.
      float d = length(p) * 2.0;
      float ang = atan(p.y, p.x);
      d += sin(ang * 5.0 + vSpin * 3.0) * 0.06;
      a = smoothstep(1.0, 0.55, d) * 0.85;
    }
    a *= vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

class Pool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private shape: Float32Array;
  private spin: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private spinV: Float32Array;
  private next = 0;
  private alive = 0;
  readonly material: THREE.ShaderMaterial;

  constructor(
    readonly cap: number,
    additive: boolean,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.shape = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.spinV = new Float32Array(cap);
    const dyn = (arr: Float32Array, n: number) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.pos, 3));
    g.setAttribute('color', dyn(this.col, 3));
    g.setAttribute('aSize', dyn(this.size, 1));
    g.setAttribute('aAlpha', dyn(this.alpha, 1));
    g.setAttribute('aShape', dyn(this.shape, 1));
    g.setAttribute('aSpin', dyn(this.spin, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
  }

  emit(o: Emit) {
    const n = o.count ?? 1;
    const colors = Array.isArray(o.color) ? o.color : [o.color];
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      const sp = o.spread ?? 0.2;
      this.pos[i * 3] = o.pos.x + (Math.random() - 0.5) * sp * 2;
      this.pos[i * 3 + 1] = o.pos.y + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 2] = o.pos.z + (Math.random() - 0.5) * sp * 2;
      // Random direction in a sphere, biased upward.
      const th = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      const spd = (o.speed ?? 3) * (0.35 + Math.random() * 0.65);
      this.vel[i * 3] = Math.cos(th) * r * spd + (o.dir?.x ?? 0);
      this.vel[i * 3 + 1] = Math.abs(u) * spd * 0.6 + (o.up ?? 2) * (0.6 + Math.random() * 0.6) + (o.dir?.y ?? 0);
      this.vel[i * 3 + 2] = Math.sin(th) * r * spd + (o.dir?.z ?? 0);
      c.set(colors[Math.floor(Math.random() * colors.length)]);
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      const life = (o.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i] = life;
      const s = (o.size ?? 0.4) * (0.7 + Math.random() * 0.6);
      this.s0[i] = s;
      this.s1[i] = o.sizeEnd !== undefined ? o.sizeEnd * (s / (o.size ?? 0.4)) : s * 0.2;
      this.size[i] = s;
      this.grav[i] = o.gravity ?? 9;
      this.drag[i] = o.drag ?? 1.5;
      this.shape[i] = o.shape ?? 0;
      this.spin[i] = Math.random() * 6.28;
      this.spinV[i] = (Math.random() - 0.5) * 6;
      this.alpha[i] = 1;
    }
    this.alive = this.cap;
  }

  update(dt: number) {
    if (!this.alive) return;
    let any = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      any++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05 && this.grav[i] > 0) {
        this.pos[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] *= -0.35;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
      this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k;
      // Quick fade-in, long fade-out.
      this.alpha[i] = Math.min(1, (1 - k) * 12) * Math.min(1, k * 2.5);
      this.spin[i] += this.spinV[i] * dt;
    }
    this.alive = any;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.color.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    a.aSpin.needsUpdate = true;
    a.aShape.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.alive = this.cap;
  }
}

export class Particles {
  private glow = new Pool(2600, true);
  private solid = new Pool(1400, false);

  constructor(scene: THREE.Scene) {
    scene.add(this.glow.points, this.solid.points);
  }

  /** Keeps sprite sizes in world units regardless of screen resolution. */
  setViewport(heightPx: number, fovDeg: number) {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.material.uniforms.uScale.value = scale;
    this.solid.material.uniforms.uScale.value = scale;
  }

  emit(o: Emit) {
    (o.glow === false ? this.solid : this.glow).emit(o);
  }

  update(dt: number) {
    this.glow.update(dt);
    this.solid.update(dt);
  }

  clear() {
    this.glow.clear();
    this.solid.clear();
  }

  // ---------------------------------------------------------------- presets

  hit(pos: THREE.Vector3, color: number) {
    this.emit({ pos, count: 5, color: [0xffffff, 0xfff1a8, color], speed: 5, up: 1, size: 0.35, life: 0.25, gravity: 6, drag: 4 });
  }

  crit(pos: THREE.Vector3) {
    this.emit({ pos, count: 10, color: [0xffffff, 0xffd34d, 0xff9a2e], speed: 8, up: 1.5, size: 0.5, life: 0.35, gravity: 4, drag: 4, shape: 1 });
  }

  /** Cartoon "poof": a puff of white cloud, a few tumbling bits and a spark of stars. */
  death(pos: THREE.Vector3, color: number, big = false) {
    const n = big ? 3 : 1;
    this.emit({ pos, count: 5 * n, color: [0xffffff, 0xf4efe8, 0xe8e2da], spread: 0.3 * n, speed: 2.2 * n, up: 1.2, size: 0.9 * n, sizeEnd: 2.0 * n, life: 0.45, gravity: -1, drag: 4, shape: 2, glow: false });
    this.emit({ pos, count: 4 * n, color: [color, 0xffffff], speed: 4.5 * n, up: 4, size: 0.24 * n, sizeEnd: 0.08, life: 0.6, gravity: 16, drag: 1, glow: false });
    this.emit({ pos, count: 3 * n, color: [0xffffff, 0xfff4b0], speed: 6 * n, up: 2, size: 0.35, life: 0.3, gravity: 0, drag: 4, shape: 1 });
  }

  /** An ogre's club hits the ground: a ring of dust and flying grit. */
  slam(pos: THREE.Vector3) {
    this.emit({ pos, count: 14, color: [0xe9dcc4, 0xd8c6a6, 0xffffff], spread: 0.4, speed: 7, up: 0.6, size: 1.1, sizeEnd: 2.2, life: 0.55, gravity: 0, drag: 5, shape: 2, glow: false });
    this.emit({ pos, count: 10, color: [0x8a6a48, 0x6a5038], speed: 6, up: 6, size: 0.22, sizeEnd: 0.1, life: 0.7, gravity: 18, drag: 0.6, glow: false });
  }

  dust(pos: THREE.Vector3, amount = 1) {
    this.emit({ pos, count: amount, color: [0xd9b47f, 0xc99d63], spread: 0.25, speed: 0.6, up: 0.6, size: 0.4, sizeEnd: 1.0, life: 0.6, gravity: -0.2, drag: 2, shape: 2, glow: false });
  }

  sparkle(pos: THREE.Vector3, color = 0xffe066, count = 1) {
    this.emit({ pos, count, color: [color, 0xffffff], spread: 0.25, speed: 0.6, up: 0.6, size: 0.45, life: 0.45, gravity: 0, drag: 2, shape: 1 });
  }

  trail(pos: THREE.Vector3, color: number, size = 0.22) {
    this.emit({ pos, count: 1, color, spread: 0.02, speed: 0.1, up: 0, size, life: 0.18, gravity: 0, drag: 0 });
  }

  muzzle(pos: THREE.Vector3) {
    this.emit({ pos, count: 3, color: [0xfff1c0, 0xffb347], speed: 1.5, up: 0.3, size: 0.45, life: 0.12, gravity: 0, drag: 6 });
  }

  embers(pos: THREE.Vector3) {
    this.emit({ pos, count: 1, color: [0xff9a2e, 0xffd34d, 0xff5a1f], spread: 0.3, speed: 0.6, up: 1.8, size: 0.18, life: 1.4, gravity: -0.4, drag: 0.6 });
  }

  smoke(pos: THREE.Vector3) {
    this.emit({ pos, count: 1, color: [0x8a817a, 0x9e958c, 0x6f6761], spread: 0.15, speed: 0.3, up: 1.4, size: 1.2, sizeEnd: 3.4, life: 2.2, gravity: -0.3, drag: 0.4, shape: 2, glow: false });
  }

  /** Big celebratory burst for building something. */
  build(pos: THREE.Vector3) {
    this.emit({ pos, count: 40, color: [0xffd34d, 0xffffff, 0x6fd3ff, 0xff6b8b, 0x8cff6b], speed: 9, up: 6, size: 0.32, sizeEnd: 0.2, life: 1.2, gravity: 12, drag: 1.2, shape: 1 });
    this.emit({ pos, count: 10, color: [0xd8c2a0, 0xc9ae86], spread: 1.2, speed: 4, up: 0.4, size: 1.0, sizeEnd: 2.2, life: 0.7, gravity: 0, drag: 3, shape: 2, glow: false });
  }

  levelUp(pos: THREE.Vector3) {
    this.emit({ pos, count: 60, color: [0xffd34d, 0xfff4b0, 0xffffff], spread: 0.6, speed: 4, up: 7, size: 0.4, life: 1.2, gravity: -1, drag: 1.2, shape: 1 });
  }

  coinBurst(pos: THREE.Vector3) {
    this.emit({ pos, count: 24, color: [0xffd34d, 0xffffff, 0xffb000], speed: 7, up: 5, size: 0.4, life: 0.7, gravity: 8, drag: 1.5, shape: 1 });
  }

  zap(from: THREE.Vector3, to: THREE.Vector3) {
    const steps = 8;
    const p = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      p.lerpVectors(from, to, i / steps);
      p.x += (Math.random() - 0.5) * 0.5;
      p.z += (Math.random() - 0.5) * 0.5;
      this.emit({ pos: p, count: 1, color: [0x9fe8ff, 0xffffff], spread: 0.05, speed: 0.4, up: 0, size: 0.5, life: 0.22, gravity: 0, drag: 0 });
    }
  }

  explosion(pos: THREE.Vector3) {
    this.emit({ pos, count: 18, color: [0xff9a2e, 0xffd34d, 0xff5a1f], speed: 6, up: 3, size: 0.6, sizeEnd: 0.1, life: 0.45, gravity: 2, drag: 3 });
    this.emit({ pos, count: 5, color: [0x5a4a40, 0x7a6a5e], speed: 2, up: 2, size: 1.2, sizeEnd: 2.4, life: 0.8, gravity: -0.5, drag: 2, shape: 2, glow: false });
  }

  /** Lazy motes drifting in the warm air around the camera. */
  motes(center: THREE.Vector3) {
    const p = new THREE.Vector3(center.x + (Math.random() - 0.5) * 30, 0.5 + Math.random() * 4, center.z + (Math.random() - 0.5) * 34);
    this.emit({ pos: p, count: 1, color: 0xffe2a0, spread: 0, speed: 0.3, up: 0.15, size: 0.09, life: 4, gravity: -0.02, drag: 0.1 });
  }
}
