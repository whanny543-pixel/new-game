import * as THREE from 'three';
import { COLORS, WORLD_RADIUS, ZONE_RADII } from './config';
import { makeCliff, makeDeadTree, makePine, makeRock } from './models';

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

function speckleTexture(base: number, dots: number[], count: number, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, size, size);
  const rng = mulberry32(base);
  for (let i = 0; i < count; i++) {
    g.fillStyle = `#${dots[i % dots.length].toString(16).padStart(6, '0')}`;
    g.globalAlpha = 0.25 + rng() * 0.35;
    const x = rng() * size;
    const y = rng() * size;
    const r = 1 + rng() * 3;
    g.beginPath();
    g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class World {
  readonly sun: THREE.DirectionalLight;
  private territory: THREE.Mesh;
  private territoryTex: THREE.Texture;
  private edge: THREE.Mesh;
  private radius = ZONE_RADII[0];
  private targetRadius = ZONE_RADII[0];

  constructor(scene: THREE.Scene, shadowSize: number) {
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.Fog(COLORS.fog, 38, 70);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5040, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = sun.shadow.camera;
    s.left = s.bottom = -20;
    s.right = s.top = 20;
    s.near = 1;
    s.far = 60;
    sun.shadow.bias = -0.0015;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Dirt ground.
    const dirt = speckleTexture(COLORS.ground, [COLORS.groundDark, 0xe0c08a, 0x8f6c3e], 900);
    dirt.repeat.set(30, 30);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD_RADIUS + 30, 64),
      new THREE.MeshLambertMaterial({ map: dirt }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Worn dirt roads leading in from the wilds.
    const roadMat = new THREE.MeshLambertMaterial({ color: 0xdcbb84 });
    for (const deg of [0, 120, 240]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(2.6, WORLD_RADIUS), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = (-deg * Math.PI) / 180;
      const a = (deg * Math.PI) / 180;
      road.position.set(Math.sin(a) * WORLD_RADIUS * 0.5, 0.005, -Math.cos(a) * WORLD_RADIUS * 0.5);
      road.receiveShadow = true;
      scene.add(road);
    }

    // Grass territory that grows as the player expands.
    this.territoryTex = speckleTexture(COLORS.colony, [COLORS.colonyLine, 0x4f9e36, 0x9be36f], 700);
    this.territory = new THREE.Mesh(
      new THREE.CircleGeometry(1, 72),
      new THREE.MeshLambertMaterial({ map: this.territoryTex }),
    );
    this.territory.rotation.x = -Math.PI / 2;
    this.territory.position.y = 0.012;
    this.territory.receiveShadow = true;
    scene.add(this.territory);

    this.edge = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1.0, 72),
      new THREE.MeshBasicMaterial({ color: COLORS.colonyEdge, transparent: true, opacity: 0.7 }),
    );
    this.edge.rotation.x = -Math.PI / 2;
    this.edge.position.y = 0.02;
    scene.add(this.edge);
    this.applyRadius();

    this.decorate(scene);
  }

  private decorate(scene: THREE.Scene) {
    const rng = mulberry32(1337);
    const finalR = ZONE_RADII[ZONE_RADII.length - 1] + 2.5;
    const onRoad = (x: number, z: number) => {
      for (const deg of [0, 120, 240]) {
        const a = (deg * Math.PI) / 180;
        const dx = Math.sin(a);
        const dz = -Math.cos(a);
        const along = x * dx + z * dz;
        const across = Math.abs(x * dz - z * dx);
        if (along > 0 && across < 2.8) return true;
      }
      return false;
    };
    const place = (obj: THREE.Object3D, rMin: number, rMax: number, avoidRoads = true) => {
      for (let tries = 0; tries < 20; tries++) {
        const a = rng() * Math.PI * 2;
        const r = rMin + rng() * (rMax - rMin);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (avoidRoads && onRoad(x, z)) continue;
        obj.position.x = x;
        obj.position.z = z;
        scene.add(obj);
        return;
      }
    };
    for (let i = 0; i < 70; i++) place(makePine(rng), finalR + 1, WORLD_RADIUS + 8);
    for (let i = 0; i < 26; i++) place(makeDeadTree(rng), finalR, WORLD_RADIUS);
    for (let i = 0; i < 40; i++) {
      const r = makeRock(rng);
      place(r, finalR, WORLD_RADIUS + 6);
      r.position.y = 0.1;
    }
    for (let i = 0; i < 26; i++) place(makeCliff(rng), WORLD_RADIUS + 4, WORLD_RADIUS + 16, false);
  }

  setLevel(level: number, instant = false) {
    this.targetRadius = ZONE_RADII[Math.min(level, ZONE_RADII.length - 1)];
    if (instant) {
      this.radius = this.targetRadius;
      this.applyRadius();
    }
  }

  get currentRadius() {
    return this.radius;
  }

  private applyRadius() {
    this.territory.scale.setScalar(this.radius);
    this.edge.scale.setScalar(this.radius);
    // Keep texel density constant as the disc grows.
    this.territoryTex.repeat.set(this.radius / 2.5, this.radius / 2.5);
  }

  update(dt: number, focus: THREE.Vector3) {
    if (Math.abs(this.radius - this.targetRadius) > 0.01) {
      this.radius += (this.targetRadius - this.radius) * Math.min(1, dt * 3);
      this.applyRadius();
    }
    // Shadow frustum follows the camera focus so shadows stay crisp.
    this.sun.position.set(focus.x + 9, 20, focus.z + 7);
    this.sun.target.position.copy(focus);
  }
}
