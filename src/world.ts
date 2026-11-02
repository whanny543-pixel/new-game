import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, ROAD_HALF_WIDTH, ROADS } from './config';
import { Road } from './road';
import { detailize } from './materials';
import { MAT, makeBush, makeCactus, makeDeadTree, makeLantern, makeMesa, makeProps, makeRock } from './models';

/** Small deterministic RNG so the map looks the same every run. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function sandTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = hex(COLORS.sand);
  g.fillRect(0, 0, size, size);
  const rng = mulberry32(7);
  // Soft dunes of light and shade.
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 30 + rng() * 90;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = rng() > 0.5 ? COLORS.sandLight : COLORS.sandDark;
    grad.addColorStop(0, hex(col) + '55');
    grad.addColorStop(1, hex(col) + '00');
    g.fillStyle = grad;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        g.save();
        g.translate(ox, oy);
        g.fillRect(x - r, y - r, r * 2, r * 2);
        g.restore();
      }
  }
  // Grit.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = hex(rng() > 0.5 ? COLORS.sandDark : COLORS.sandLight);
    g.globalAlpha = 0.25 + rng() * 0.3;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class World {
  readonly sun: THREE.DirectionalLight;
  readonly roads: Road[];
  private roadMeshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene, shadowSize: number) {
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.Fog(COLORS.fog, 55, 105);

    scene.add(new THREE.HemisphereLight(0xc9dcff, 0x8a6a6a, 0.8));
    const sun = new THREE.DirectionalLight(0xffd29a, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = sun.shadow.camera;
    s.left = s.bottom = -30;
    s.right = s.top = 30;
    s.near = 1;
    s.far = 80;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    const tex = sandTexture();
    tex.repeat.set(14, 14);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      detailize(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }), 0.45, 0.9),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    this.roads = ROADS.map((pts) => new Road(pts));
    for (const r of this.roads) {
      const m = r.makeMesh();
      scene.add(m);
      this.roadMeshes.push(m);
    }
    // The east road is hidden until it opens.
    this.roadMeshes[1].visible = false;
  }

  openRoad(i: number, on: boolean) {
    this.roadMeshes[i].visible = on;
  }

  /** Scatter scenery, keeping clear of roads and of the given reserved spots. */
  decorate(scene: THREE.Scene, reserved: { x: number; z: number; r: number }[]) {
    const rng = mulberry32(2024);
    const clear = (x: number, z: number, pad: number) => {
      if (Math.hypot(x, z) < 9 + pad) return false;
      for (const r of this.roads) if (r.distanceTo(x, z) < ROAD_HALF_WIDTH + 1.6 + pad) return false;
      for (const q of reserved) if (Math.hypot(x - q.x, z - q.z) < q.r + pad) return false;
      return true;
    };
    const place = (make: () => THREE.Object3D, n: number, rMin: number, rMax: number, pad: number) => {
      for (let i = 0; i < n; i++) {
        for (let tries = 0; tries < 25; tries++) {
          const a = rng() * Math.PI * 2;
          const r = rMin + rng() * (rMax - rMin);
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r - 10;
          if (!clear(x, z, pad)) continue;
          const o = make();
          o.position.set(x, 0, z);
          o.rotation.y = rng() * Math.PI * 2;
          scene.add(o);
          break;
        }
      }
    };
    place(() => makeMesa(rng), 34, 30, 70, 4);
    place(() => makeMesa(rng), 8, 16, 30, 4.5);
    place(() => makeCactus(rng), 60, 8, 60, 0.8);
    place(() => makeBush(rng), 70, 6, 60, 0.6);
    place(() => makeRock(rng), 60, 6, 60, 0.8);
    place(() => makeDeadTree(rng), 18, 10, 55, 1);
    place(() => makeProps(rng), 10, 9, 22, 1.2);
    this.scatterGround(scene, rng, clear);

    // Lanterns along the last stretch of each road.
    for (const road of this.roads) {
      for (const t of [0.93, 0.83]) {
        const v = road.point(road.length * t, ROAD_HALF_WIDTH + 0.7, new THREE.Vector3());
        const l = makeLantern();
        l.position.copy(v);
        scene.add(l);
      }
    }
  }

  /** Thousands of pebbles and dry tufts as two instanced meshes: texture for almost free. */
  private scatterGround(scene: THREE.Scene, rng: () => number, clear: (x: number, z: number, pad: number) => boolean) {
    const pebbleGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const pebbles = new THREE.InstancedMesh(pebbleGeo, MAT.vcFlat, 1800);
    const tuftParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const blade = new THREE.ConeGeometry(0.045, 0.5, 3);
      blade.translate(0, 0.25, 0);
      blade.rotateZ((i - 2) * 0.28);
      blade.rotateY(i * 1.3);
      tuftParts.push(blade.toNonIndexed());
      blade.dispose();
    }
    const tuftGeo = mergeGeometries(tuftParts)!;
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 900);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const pebbleCols = [COLORS.cliffDark, COLORS.cliff, COLORS.sandDark, 0x9c8a78, 0xb98a60];
    const tuftCols = [0xb8a35a, 0x9e9a4e, 0xc9b26a, 0x8f8a3e];
    // Pebbles need a colour attribute for the vertex-colour material: give them white and tint per instance.
    const n = pebbleGeo.attributes.position.count;
    pebbleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    let pi = 0;
    let ti = 0;
    for (let k = 0; k < 6000 && (pi < 1800 || ti < 900); k++) {
      const x = (rng() - 0.5) * 120;
      const z = (rng() - 0.5) * 110 - 12;
      const onRoadOk = rng() < 0.25; // some pebbles sit on the road edges
      if (!clear(x, z, -1.2) && !onRoadOk) continue;
      if (Math.hypot(x, z) < 6) continue;
      if (pi < 1800 && rng() < 0.7) {
        const s = 0.5 + rng() * 1.6;
        q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
        m.compose(new THREE.Vector3(x, 0.03, z), q, new THREE.Vector3(s, s * (0.5 + rng() * 0.4), s));
        pebbles.setMatrixAt(pi, m);
        pebbles.setColorAt(pi, c.set(pebbleCols[Math.floor(rng() * pebbleCols.length)]));
        pi++;
      } else if (ti < 900 && clear(x, z, 0)) {
        const s = 0.6 + rng() * 0.9;
        q.setFromEuler(e.set(0, rng() * 6, 0));
        m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
        tufts.setMatrixAt(ti, m);
        tufts.setColorAt(ti, c.set(tuftCols[Math.floor(rng() * tuftCols.length)]));
        ti++;
      }
    }
    pebbles.count = pi;
    tufts.count = ti;
    pebbles.receiveShadow = true;
    tufts.castShadow = false;
    scene.add(pebbles, tufts);
  }

  update(focus: THREE.Vector3) {
    // Shadow frustum follows the camera focus so shadows stay crisp.
    this.sun.position.set(focus.x + 12, 26, focus.z + 6);
    this.sun.target.position.copy(focus);
  }
}
