// three.js view of the simulation: terrain, fog of war, entity meshes, projectiles, flyers,
// selection rings and the building-placement ghost. Game (x, y) maps to world (x, z).
import * as THREE from 'three';
import { FACTIONS, TEAM_COLORS } from '../core/data';
import { T_CLIFF, T_ROAD, T_WATER, type GameMap } from '../core/map';
import type { Entity, Player } from '../game/entity';
import type { Game } from '../game/game';
import type { Projectile } from '../game/combat';
import type { Flyer } from '../game/powers';
import { Effects } from './effects';
import { buildingModel, crateModel, flyerModel, propModel, scaffoldModel, supplyPileModel, unitModel, type ModelDef } from './models';
import { clamp, lerp } from '../core/math';

const NEUTRAL_STYLE = { hull: 0x8a8a80, accent: 0x9a9a90, roof: 0xa0a090, trim: 0x555 };

interface EntityView {
  e: Entity;
  group: THREE.Group;
  body: THREE.Group;
  turret: THREE.Group | null;
  rotor: THREE.Mesh | null;
  rotor2: THREE.Mesh | null;
  dish: THREE.Mesh | null;
  teamMeshes: THREE.Mesh[];
  hullMeshes: THREE.Mesh[];
  scaffold: THREE.Mesh | null;
  height: number;
  dying: number;
  deathHandled: boolean;
  ownerId: number;
  stealthShown: boolean;
  cargo: THREE.Mesh | null;
  chute: THREE.Mesh | null;
}

export interface Ghost {
  defId: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  valid: boolean;
}

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 1, 260);
  focus = { x: 0, y: 0 };
  zoom = 27;
  pitch = 0.96;
  yaw = 0;
  effects = new Effects();
  private game: Game;
  private map: GameMap;
  private views = new Map<number, EntityView>();
  private sun: THREE.DirectionalLight;
  private fogTex: THREE.DataTexture;
  private fogData: Uint8Array;
  private fogVersion = -1;
  private fogUniforms: { uFog: { value: THREE.Texture }; uMapSize: { value: THREE.Vector2 } };
  private hullMat: THREE.MeshLambertMaterial;
  private hullGhostMat: THREE.MeshLambertMaterial;
  private teamMats: THREE.MeshLambertMaterial[] = [];
  private teamGhostMats: THREE.MeshLambertMaterial[] = [];
  private scaffoldMat: THREE.MeshLambertMaterial;
  private rings: THREE.Mesh[] = [];
  private ringGeo = new THREE.RingGeometry(0.9, 1, 28);
  private ringMat: THREE.MeshBasicMaterial;
  private ringMatB: THREE.MeshBasicMaterial;
  private ghostGroup = new THREE.Group();
  private ghostKey = '';
  private ghostMatOk: THREE.MeshBasicMaterial;
  private ghostMatBad: THREE.MeshBasicMaterial;
  private projMeshes = new Map<Projectile, THREE.Mesh>();
  private projGeos: Record<string, THREE.BufferGeometry> = {};
  private projMats: Record<string, THREE.Material> = {};
  private flyerMeshes = new Map<Flyer, THREE.Group>();
  private pileGroups: { mesh: THREE.Mesh; level: number }[] = [];
  private lanceMesh: THREE.Mesh;
  private rallyMesh: THREE.Group;
  private water: THREE.Mesh | null = null;
  private time = 0;
  private tmpV = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private chuteGeo = new THREE.SphereGeometry(0.8, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  private chuteMat: THREE.MeshLambertMaterial;
  quality: 'high' | 'low' = 'high';
  private perf = { frames: 0, time: 0 };

  constructor(canvas: HTMLCanvasElement, game: Game, viewer: Player) {
    this.game = game;
    this.map = game.map;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    const desert = this.map.theme === 'desert';
    this.scene.background = new THREE.Color(desert ? 0xd8c9a2 : 0xb9d4e6);
    this.scene.fog = new THREE.Fog(desert ? 0xd8c9a2 : 0xb9d4e6, 80, 170);

    // Fog of war texture.
    this.fogData = new Uint8Array(this.map.w * this.map.h * 4);
    this.fogTex = new THREE.DataTexture(this.fogData, this.map.w, this.map.h, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    this.fogUniforms = { uFog: { value: this.fogTex }, uMapSize: { value: new THREE.Vector2(this.map.w, this.map.h) } };

    this.hullMat = this.withFog(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.hullGhostMat = this.withFog(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }));
    for (let i = 0; i < TEAM_COLORS.length; i++) {
      this.teamMats.push(this.withFog(new THREE.MeshLambertMaterial({ color: TEAM_COLORS[i] })));
      this.teamGhostMats.push(this.withFog(new THREE.MeshLambertMaterial({ color: TEAM_COLORS[i], transparent: true, opacity: 0.45 })));
    }
    this.scaffoldMat = this.withFog(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.ringMatB = new THREE.MeshBasicMaterial({ color: 0x7ec8ff, transparent: true, opacity: 0.8, depthWrite: false });
    this.ghostMatOk = new THREE.MeshBasicMaterial({ color: 0x4cff7a, transparent: true, opacity: 0.45, depthWrite: false });
    this.ghostMatBad = new THREE.MeshBasicMaterial({ color: 0xff4c4c, transparent: true, opacity: 0.45, depthWrite: false });
    this.chuteMat = this.withFog(new THREE.MeshLambertMaterial({ color: 0xf0f0f0, side: THREE.DoubleSide }));

    // Lights.
    const hemi = new THREE.HemisphereLight(desert ? 0xfff2d0 : 0xdfeeff, desert ? 0x8a7a5a : 0x5a6a4a, 1.15);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.buildTerrain();
    this.buildProps();
    this.buildPiles();
    this.scene.add(this.effects.group, this.ghostGroup);
    this.effects.heightAt = (x, y) => this.map.heightAt(x, y);

    const lanceGeo = new THREE.CylinderGeometry(0.5, 1.4, 60, 10, 1, true);
    lanceGeo.translate(0, 30, 0);
    this.lanceMesh = new THREE.Mesh(lanceGeo, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.lanceMesh.visible = false;
    this.scene.add(this.lanceMesh);

    this.rallyMesh = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    pole.position.y = 0.8;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.04), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[viewer.color] }));
    flag.position.set(0.3, 1.4, 0);
    this.rallyMesh.add(pole, flag);
    this.rallyMesh.visible = false;
    this.scene.add(this.rallyMesh);

    // Projectile looks.
    const g = this.projGeos;
    g.shell = new THREE.SphereGeometry(0.13, 6, 5);
    g.molotov = new THREE.SphereGeometry(0.14, 6, 5);
    g.barrage = new THREE.SphereGeometry(0.2, 6, 5);
    g.rocket = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6);
    g.rocket.rotateZ(-Math.PI / 2);
    g.missile = new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6);
    g.missile.rotateZ(-Math.PI / 2);
    g.napalm = g.missile;
    g.bomb = new THREE.CapsuleGeometry(0.16, 0.5, 2, 6);
    g.bomb.rotateZ(-Math.PI / 2);
    g.nuke = new THREE.CylinderGeometry(0.35, 0.35, 2.6, 8);
    g.scud = new THREE.CylinderGeometry(0.2, 0.2, 1.8, 8);
    const m = this.projMats;
    m.shell = new THREE.MeshLambertMaterial({ color: 0x222222 });
    m.molotov = new THREE.MeshBasicMaterial({ color: 0xff9a2a });
    m.barrage = new THREE.MeshLambertMaterial({ color: 0x333333 });
    m.rocket = new THREE.MeshLambertMaterial({ color: 0xdddddd });
    m.missile = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
    m.napalm = new THREE.MeshLambertMaterial({ color: 0xff7a2a });
    m.bomb = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    m.nuke = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.scud = new THREE.MeshLambertMaterial({ color: 0x6b7a4a });

    const st = this.map.starts[viewer.id % this.map.starts.length];
    this.focus.x = st.x;
    this.focus.y = st.y + 4;
    this.resize();
  }

  /** Multiply every material's output by the fog-of-war texture at its world position. */
  private withFog<T extends THREE.Material>(mat: T): T {
    const u = this.fogUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFog = u.uFog;
      shader.uniforms.uMapSize = u.uMapSize;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFogPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\n vFogPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\n vFogPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFogPos; uniform sampler2D uFog; uniform vec2 uMapSize;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n float fv = texture2D(uFog, vFogPos.xz / uMapSize).r;\n gl_FragColor.rgb *= 0.04 + 0.96 * fv;');
    };
    mat.customProgramCacheKey = () => 'fogwar';
    return mat;
  }

  private buildTerrain() {
    const map = this.map;
    const W = map.w, H = map.h;
    const geo = new THREE.PlaneGeometry(W, H, W, H);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, H / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const desert = map.theme === 'desert';
    const c = new THREE.Color();
    const grassA = new THREE.Color(desert ? 0xdcc488 : 0x78a64a), grassB = new THREE.Color(desert ? 0xc4aa70 : 0x56873a);
    const dirt = new THREE.Color(desert ? 0xa88a58 : 0x8a7246);
    const rock = new THREE.Color(desert ? 0x9a8468 : 0x7a7466), rockTop = new THREE.Color(desert ? 0xb59c7c : 0x8f8a7c);
    const sand = new THREE.Color(desert ? 0xdcc69a : 0xb8a878);
    const road = new THREE.Color(desert ? 0xb4a078 : 0x8f8468);
    const s = W + 1;
    for (let j = 0; j <= H; j++)
      for (let i = 0; i <= W; i++) {
        const k = j * s + i;
        pos.setY(k, map.height[k]);
        let cliff = 0, water = 0, roadN = 0, n = 0;
        for (let dj = -1; dj <= 0; dj++)
          for (let di = -1; di <= 0; di++) {
            const t = map.terrainAt(i + di, j + dj);
            n++;
            if (t === T_CLIFF) cliff++;
            if (t === T_WATER) water++;
            if (t === T_ROAD) roadN++;
          }
        const nz = map.noise.fbm(i * 0.11 + 3, j * 0.11 + 9, 2);
        c.copy(grassA).lerp(grassB, nz);
        if (nz > 0.6) c.lerp(dirt, (nz - 0.6) * 1.5);
        if (roadN) c.lerp(road, roadN / n);
        if (water) c.lerp(sand, water / n);
        if (cliff) c.lerp(cliff === n ? rockTop : rock, Math.min(1, cliff / n + 0.3));
        // Darker lowlands.
        const h = map.height[k];
        c.multiplyScalar(0.92 + clamp(h, -0.5, 1.5) * 0.08);
        colors[k * 3] = c.r;
        colors[k * 3 + 1] = c.g;
        colors[k * 3 + 2] = c.b;
      }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const detail = this.makeDetailTexture(desert);
    detail.repeat.set(W / 6, H / 6);
    const mat = this.withFog(new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    // A wide apron beyond the map edge so the camera never sees the sky colour below the horizon.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(W * 5, H * 5), this.withFog(new THREE.MeshLambertMaterial({ color: desert ? 0x9a865c : 0x4f6e38 })));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(W / 2, -1.2, H / 2);
    apron.receiveShadow = true;
    this.scene.add(apron);
    // Water.
    let hasWater = false;
    for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] === T_WATER) hasWater = true;
    if (hasWater) {
      const wg = new THREE.PlaneGeometry(W, H);
      wg.rotateX(-Math.PI / 2);
      wg.translate(W / 2, -0.55, H / 2);
      const wm = this.withFog(new THREE.MeshLambertMaterial({ color: 0x3f8fc9, transparent: true, opacity: 0.8 }));
      this.water = new THREE.Mesh(wg, wm);
      this.scene.add(this.water);
    }
  }

  private makeDetailTexture(_desert: boolean) {
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = 236 + Math.random() * 20;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildProps() {
    const kinds: ('tree' | 'rock' | 'palm' | 'bush')[] = ['tree', 'rock', 'palm', 'bush'];
    const dummy = new THREE.Object3D();
    for (const kind of kinds) {
      const list = this.map.props.filter((p) => p.kind === kind);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(propModel(kind), this.hullMat, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      list.forEach((p, i) => {
        dummy.position.set(p.x, this.map.heightAt(p.x, p.y) - 0.05, p.y);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }
  }

  private buildPiles() {
    for (const d of this.map.docks) {
      const level = 3;
      const mesh = new THREE.Mesh(supplyPileModel(level), this.hullMat);
      mesh.position.set(d.x, this.map.heightAt(d.x + 1, d.y + 1), d.y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.pileGroups.push({ mesh, level });
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera() {
    const f = this.focus;
    const gy = this.map.heightAt(f.x, f.y);
    const d = this.zoom;
    const sx = Math.sin(this.yaw), cx = Math.cos(this.yaw);
    const shake = this.effects.shake;
    const ox = shake ? (Math.random() - 0.5) * shake * 0.6 : 0, oy = shake ? (Math.random() - 0.5) * shake * 0.6 : 0;
    this.camera.position.set(f.x + sx * Math.cos(this.pitch) * d + ox, gy + Math.sin(this.pitch) * d, f.y + cx * Math.cos(this.pitch) * d + oy);
    this.camera.lookAt(f.x + ox, gy, f.y + oy);
    // Sun follows the camera so the shadow map covers what you see.
    this.sun.position.set(f.x - 20, 45, f.y + 12);
    this.sun.target.position.set(f.x, gy, f.y);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    const span = Math.max(26, this.zoom * 1.05);
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.updateProjectionMatrix();
  }

  worldToScreen(x: number, y: number, z: number) {
    const v = this.tmpV.set(x, z, y).project(this.camera);
    const w = this.renderer.domElement.clientWidth || window.innerWidth, h = this.renderer.domElement.clientHeight || window.innerHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 && v.z > -1 };
  }

  /** Ray from screen pixel to the terrain (approximate: two plane iterations). */
  screenToGround(sx: number, sy: number) {
    const w = window.innerWidth, h = window.innerHeight;
    const nd = new THREE.Vector2((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    this.ray.setFromCamera(nd, this.camera);
    let hy = this.map.heightAt(this.focus.x, this.focus.y);
    const hit = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      this.groundPlane.constant = -hy;
      if (!this.ray.ray.intersectPlane(this.groundPlane, hit)) return null;
      hy = this.map.heightAt(hit.x, hit.z);
    }
    return { x: clamp(hit.x, 0, this.map.w - 0.01), y: clamp(hit.z, 0, this.map.h - 0.01) };
  }

  /** Nearest pickable entity within `radiusPx` of the screen point. */
  pickEntity(sx: number, sy: number, viewer: Player, radiusPx: number): Entity | null {
    let best: Entity | null = null, bd = radiusPx;
    for (const v of this.views.values()) {
      const e = v.e;
      if (e.dead || !v.group.visible) continue;
      if (!this.game.canSee(viewer, e)) continue;
      const p = this.worldToScreen(e.x, e.y, e.z + v.height * 0.5);
      if (!p.visible) continue;
      // Buildings are big; use their footprint, units a generous circle.
      const px = this.worldToScreen(e.x + e.radius, e.y, e.z);
      const rpx = Math.max(14, Math.abs(px.x - p.x)) + (e.isUnit ? 10 : 0);
      const d = Math.hypot(p.x - sx, p.y - sy) - rpx;
      const dd = d + (e.isBuilding ? 8 : 0) + (e.owner === viewer ? -4 : 0);
      if (dd < bd) {
        bd = dd;
        best = e;
      }
    }
    return best;
  }

  /** Entities inside a screen rectangle. */
  entitiesInRect(x0: number, y0: number, x1: number, y1: number, viewer: Player) {
    const out: Entity[] = [];
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    for (const v of this.views.values()) {
      const e = v.e;
      if (e.dead || e.owner !== viewer || !e.isUnit) continue;
      const p = this.worldToScreen(e.x, e.y, e.z + 0.5);
      if (p.visible && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) out.push(e);
    }
    return out;
  }

  private styleFor(e: Entity) {
    return e.owner.id < 0 ? NEUTRAL_STYLE : FACTIONS[e.owner.faction].style;
  }

  private makeMeshes(def: ModelDef, team: THREE.Material, hull: THREE.Material, target: THREE.Group, teamMeshes: THREE.Mesh[], hullMeshes: THREE.Mesh[]) {
    if (def.hull) {
      const m = new THREE.Mesh(def.hull, hull);
      m.castShadow = true;
      m.receiveShadow = true;
      target.add(m);
      hullMeshes.push(m);
    }
    if (def.team) {
      const m = new THREE.Mesh(def.team, team);
      m.castShadow = true;
      target.add(m);
      teamMeshes.push(m);
    }
  }

  private createView(e: Entity): EntityView {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const style = this.styleFor(e);
    const teamMat = this.teamMats[e.owner.color % this.teamMats.length];
    const teamMeshes: THREE.Mesh[] = [], hullMeshes: THREE.Mesh[] = [];
    let def: ModelDef;
    let turret: THREE.Group | null = null;
    let rotor: THREE.Mesh | null = null, rotor2: THREE.Mesh | null = null, dish: THREE.Mesh | null = null;
    let scaffold: THREE.Mesh | null = null;
    if (e.kind === 'crate') {
      def = { hull: crateModel(), team: null, turret: null, rotor: null, rotor2: null, dish: null, height: 0.6 };
    } else if (e.isUnit) def = unitModel(e.udef!.model, style);
    else def = buildingModel(e.bdef!.model, style, e.w, e.h);
    this.makeMeshes(def, teamMat, this.hullMat, body, teamMeshes, hullMeshes);
    if (def.turret) {
      turret = new THREE.Group();
      turret.position.set(def.turret.pivot[0], def.turret.pivot[1], def.turret.pivot[2]);
      this.makeMeshes({ ...def, hull: def.turret.geo, team: def.turret.team }, teamMat, this.hullMat, turret, teamMeshes, hullMeshes);
      body.add(turret);
    }
    const spin = (r: { geo: THREE.BufferGeometry; pivot: [number, number, number] }) => {
      const m = new THREE.Mesh(r.geo, this.hullMat);
      m.position.set(r.pivot[0], r.pivot[1], r.pivot[2]);
      m.castShadow = true;
      body.add(m);
      hullMeshes.push(m);
      return m;
    };
    if (def.rotor) rotor = spin(def.rotor);
    if (def.rotor2) rotor2 = spin(def.rotor2);
    if (def.dish) dish = spin(def.dish);
    if (e.isBuilding) {
      scaffold = new THREE.Mesh(scaffoldModel(e.w, e.h, def.height + 0.5), this.scaffoldMat);
      scaffold.visible = !e.built;
      group.add(scaffold);
    }
    this.scene.add(group);
    const v: EntityView = { e, group, body, turret, rotor, rotor2, dish, teamMeshes, hullMeshes, scaffold, height: def.height, dying: 0, deathHandled: false, ownerId: e.owner.id, stealthShown: false, cargo: null, chute: null };
    if (e.udef?.gather) {
      v.cargo = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), this.hullMat);
      v.cargo.visible = false;
      body.add(v.cargo);
      v.cargo.position.set(e.isAir ? 0 : -0.3, e.isAir ? -0.4 : 1.1, 0);
    }
    return v;
  }

  private setTeam(v: EntityView, ghost: boolean) {
    const col = v.e.owner.color % this.teamMats.length;
    const tm = ghost ? this.teamGhostMats[col] : this.teamMats[col];
    for (const m of v.teamMeshes) m.material = tm;
    for (const m of v.hullMeshes) m.material = ghost ? this.hullGhostMat : this.hullMat;
    v.ownerId = v.e.owner.id;
    v.stealthShown = ghost;
  }

  private updateFog(viewer: Player) {
    const fog = this.game.fogs.get(viewer.id);
    if (!fog || fog.version === this.fogVersion) return;
    this.fogVersion = fog.version;
    const d = this.fogData;
    const w = fog.w, h = fog.h;
    // 3x3 box blur so the shroud edge is a soft gradient instead of a staircase.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0, n = 0;
        for (let j = -1; j <= 1; j++) {
          const yy = y + j;
          if (yy < 0 || yy >= h) continue;
          for (let i = -1; i <= 1; i++) {
            const xx = x + i;
            if (xx < 0 || xx >= w) continue;
            const k = yy * w + xx;
            sum += fog.visible[k] ? 255 : fog.explored[k] ? 105 : 0;
            n++;
          }
        }
        const idx = (y * w + x) * 4;
        d[idx] = sum / n;
        d[idx + 3] = 255;
      }
    this.fogTex.needsUpdate = true;
  }

  private updateGhost(ghost: Ghost | null, viewer: Player) {
    if (!ghost) {
      this.ghostGroup.visible = false;
      return;
    }
    const key = ghost.defId + ':' + ghost.valid;
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      this.ghostGroup.clear();
      const def = this.game.entities.length ? null : null;
      void def;
      const bdef = FACTIONS[viewer.faction].buildings.find((b) => b.id === ghost.defId);
      const md = buildingModel(bdef?.model ?? 'barracks', FACTIONS[viewer.faction].style, ghost.w, ghost.h);
      const mat = ghost.valid ? this.ghostMatOk : this.ghostMatBad;
      if (md.hull) this.ghostGroup.add(new THREE.Mesh(md.hull, mat));
      if (md.team) this.ghostGroup.add(new THREE.Mesh(md.team, mat));
      if (md.turret?.geo) {
        const t = new THREE.Mesh(md.turret.geo, mat);
        t.position.set(...md.turret.pivot);
        this.ghostGroup.add(t);
      }
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(ghost.w, ghost.h), mat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.05;
      this.ghostGroup.add(pad);
    }
    this.ghostGroup.visible = true;
    const cx = ghost.cx + ghost.w / 2, cy = ghost.cy + ghost.h / 2;
    this.ghostGroup.position.set(cx, this.map.heightAt(cx, cy), cy);
  }

  update(dt: number, viewer: Player, selection: Set<Entity>, ghost: Ghost | null, rally: { x: number; y: number } | null) {
    this.time += dt;
    const game = this.game;
    this.updateFog(viewer);
    this.updateCamera();
    this.updateGhost(ghost, viewer);
    if (this.water) (this.water.material as THREE.MeshLambertMaterial).opacity = 0.75 + Math.sin(this.time) * 0.05;

    // Entities.
    for (const e of game.entities) {
      let v = this.views.get(e.id);
      if (!v) {
        if (e.dead) continue;
        v = this.createView(e);
        this.views.set(e.id, v);
      }
      if (e.dead) {
        this.updateDying(v, dt);
        continue;
      }
      const visible = game.canSee(viewer, e);
      v.group.visible = visible;
      if (!visible) continue;
      if (v.ownerId !== e.owner.id) this.setTeam(v, v.stealthShown);
      const ghostly = e.stealthActive && !e.detected && e.revealTimer <= 0;
      if (ghostly !== v.stealthShown) this.setTeam(v, ghostly);
      const gy = e.isBuilding ? e.z : this.map.heightAt(e.x, e.y);
      v.group.position.set(e.x, gy + (e.isUnit ? e.z : 0), e.y);
      if (e.isUnit) {
        const def = e.udef!;
        v.group.rotation.y = -e.dir;
        if (def.move === 'infantry') {
          const bob = e.moving ? Math.abs(Math.sin(this.time * 12 + e.id)) * 0.08 : 0;
          v.body.position.y = bob;
          v.body.rotation.z = e.moving ? Math.sin(this.time * 12 + e.id) * 0.06 : 0;
          if (e.udef!.hack && e.deployed) v.body.rotation.z = 0;
        } else if (def.move === 'air') {
          const bank = def.jet ? 0.5 : 0.25;
          v.body.rotation.z = lerp(v.body.rotation.z, e.moving ? -bank * 0.3 : 0, dt * 2);
          v.body.rotation.x = lerp(v.body.rotation.x, e.moving && !def.jet ? -0.12 : 0, dt * 2);
          if (e.dropping) v.body.rotation.set(0, 0, 0);
        }
        if (v.turret) v.turret.rotation.y = -(e.turretDir - e.dir);
        if (v.rotor) v.rotor.rotation.y += dt * (e.jetState === 'parked' ? 0 : 40);
        if (v.rotor2) v.rotor2.rotation.y -= dt * 40;
        if (v.cargo) v.cargo.visible = e.cargo > 0;
        // Parachute.
        if (e.dropping && !v.chute) {
          v.chute = new THREE.Mesh(this.chuteGeo, this.chuteMat);
          v.chute.position.y = 2.2;
          v.group.add(v.chute);
        } else if (!e.dropping && v.chute) {
          v.group.remove(v.chute);
          v.chute = null;
        }
        // Burning when badly hurt.
        if (e.hp < e.maxHp * 0.4 && def.move !== 'infantry') this.effects.burning(e.x, gy + e.z + 0.6, e.y, 1 - e.hp / e.maxHp, dt);
      } else if (e.isBuilding) {
        if (v.scaffold) {
          v.scaffold.visible = !e.built;
          v.body.scale.y = e.built ? 1 : 0.05 + e.progress * 0.95;
          v.body.visible = e.built || e.progress > 0.02;
        }
        if (v.turret) v.turret.rotation.y = -e.turretDir;
        if (v.rotor) v.rotor.rotation.z = Math.sin(this.time * 2) * 0.3;
        if (v.dish) v.dish.rotation.y += dt * 0.6;
        if (e.built && e.hp < e.maxHp * 0.5) this.effects.burning(e.x + (Math.random() - 0.5) * e.w * 0.6, gy + 1.5, e.y + (Math.random() - 0.5) * e.h * 0.6, 1 - e.hp / e.maxHp, dt);
        if (e.bdef!.trap && e.owner.team !== viewer.team) v.group.visible = false;
      }
    }
    // Remove views for entities that were swept.
    for (const [id, v] of this.views) {
      if (!game.byId.has(id) || (v.e.dead && v.dying > 3)) {
        this.scene.remove(v.group);
        this.views.delete(id);
      }
    }

    // Selection rings.
    let ri = 0;
    for (const e of selection) {
      if (e.dead) continue;
      let ring = this.rings[ri];
      if (!ring) {
        ring = new THREE.Mesh(this.ringGeo, this.ringMat);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);
        this.rings.push(ring);
      }
      ring.visible = true;
      ring.material = e.isBuilding ? this.ringMatB : this.ringMat;
      const gy = e.isBuilding ? e.z : this.map.heightAt(e.x, e.y);
      ring.position.set(e.x, gy + 0.08 + (e.isUnit && e.isAir ? 0 : 0), e.y);
      const s = e.isBuilding ? Math.max(e.w, e.h) * 0.62 : e.radius + 0.35;
      ring.scale.setScalar(s);
      ri++;
    }
    for (; ri < this.rings.length; ri++) this.rings[ri].visible = false;
    if (rally) {
      this.rallyMesh.visible = true;
      this.rallyMesh.position.set(rally.x, this.map.heightAt(rally.x, rally.y), rally.y);
    } else this.rallyMesh.visible = false;

    // Supply piles.
    this.map.docks.forEach((d, i) => {
      const pg = this.pileGroups[i];
      const level = d.amount <= 0 ? 0 : Math.max(1, Math.ceil((d.amount / d.max) * 3));
      if (level !== pg.level) {
        pg.level = level;
        pg.mesh.visible = level > 0;
        if (level > 0) pg.mesh.geometry = supplyPileModel(level);
      }
    });

    // Projectiles.
    for (const p of game.projectiles) {
      if (p.delay > 0) continue;
      let m = this.projMeshes.get(p);
      if (!m) {
        m = new THREE.Mesh(this.projGeos[p.style] ?? this.projGeos.shell, this.projMats[p.style] ?? this.projMats.shell);
        this.scene.add(m);
        this.projMeshes.set(p, m);
      }
      m.position.set(p.x, p.z, p.y);
      if (p.kind === 'rocket' || p.kind === 'bomb') {
        m.rotation.set(0, -p.dir, p.kind === 'bomb' ? -0.8 : 0);
        if (p.style === 'rocket' || p.style === 'missile' || p.style === 'napalm') this.effects.smoke.spawn(p.x, p.z, p.y, 0, 0.3, 0, 0.5, 0.35, 0.85, 0.85, 0.85, 0.5, 1.5, 0);
      } else if (p.kind === 'sky') {
        m.rotation.set(0, 0, 0);
        if (p.style === 'nuke') this.effects.fire.spawn(p.x, p.z - 1.4, p.y, 0, -2, 0, 0.5, 1.2, 1, 0.6, 0.2, 0.9, 1, 0);
        else this.effects.smoke.spawn(p.x, p.z, p.y, 0, 0.3, 0, 0.8, 0.5, 0.9, 0.9, 0.9, 0.5, 1.5, 0);
      }
    }
    for (const [p, m] of this.projMeshes) {
      if (p.dead) {
        this.scene.remove(m);
        this.projMeshes.delete(p);
      }
    }
    // Flyers.
    for (const f of game.flyers) {
      let g = this.flyerMeshes.get(f);
      if (!g) {
        g = new THREE.Group();
        const md = flyerModel(f.model, FACTIONS[f.owner.faction].style);
        const tm = this.teamMats[f.owner.color % this.teamMats.length];
        this.makeMeshes(md, tm, this.hullMat, g, [], []);
        if (md.rotor) {
          const r = new THREE.Mesh(md.rotor.geo, this.hullMat);
          r.position.set(...md.rotor.pivot);
          r.name = 'rotor';
          g.add(r);
        }
        g.scale.setScalar(1.4);
        this.scene.add(g);
        this.flyerMeshes.set(f, g);
      }
      g.position.set(f.x, f.z, f.y);
      g.rotation.y = -f.dir;
      const r = g.getObjectByName('rotor');
      if (r) r.rotation.y += dt * 40;
    }
    for (const [f, g] of this.flyerMeshes) {
      if (!game.flyers.includes(f)) {
        this.scene.remove(g);
        this.flyerMeshes.delete(f);
      }
    }
    // Lance beam.
    let lance: { x: number; y: number } | null = null;
    for (const p of game.players) if (p.lance) lance = p.lance;
    this.lanceMesh.visible = !!lance;
    if (lance) {
      this.lanceMesh.position.set(lance.x, this.map.heightAt(lance.x, lance.y), lance.y);
      this.lanceMesh.rotation.y += dt * 3;
      (this.lanceMesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 30) * 0.15;
    }
    this.effects.fieldTick(game.fields, dt);
    this.effects.update(dt);
  }

  private updateDying(v: EntityView, dt: number) {
    const e = v.e;
    if (!v.deathHandled) {
      v.deathHandled = true;
      const gy = e.isBuilding ? e.z : this.map.heightAt(e.x, e.y);
      if (e.deathKind === 'explode') this.effects.explosion(e.x, gy + e.z + 0.3, e.y, Math.max(0.8, e.radius * 1.6), 'blast');
      else if (e.deathKind === 'collapse') {
        this.effects.explosion(e.x, gy + 0.5, e.y, Math.max(1.5, e.radius * 1.4), 'blast');
        this.effects.explosion(e.x, gy + 0.2, e.y, Math.max(1.5, e.radius * 1.6), 'smoke');
      }
      if (e.deathKind === 'quiet' || e.kind === 'crate') v.group.visible = false;
      if (e.isUnit && e.udef!.move === 'infantry') v.group.visible = false;
    }
    v.dying += dt;
    if (!v.group.visible) return;
    switch (e.deathKind) {
      case 'explode': {
        const s = Math.max(0.01, 1 - v.dying * 2.5);
        v.group.scale.setScalar(s);
        if (v.dying > 0.4) v.group.visible = false;
        break;
      }
      case 'collapse': {
        v.group.position.y -= dt * 1.2;
        v.body.rotation.z = Math.sin(v.dying * 8) * 0.04;
        if (v.dying > 1.6) v.group.visible = false;
        break;
      }
      case 'crash': {
        v.group.position.y -= dt * (3 + v.dying * 6);
        v.group.rotation.z += dt * 2.5;
        v.group.rotation.y += dt * 1.5;
        this.effects.burning(v.group.position.x, v.group.position.y, v.group.position.z, 1, dt * 3);
        const gy = this.map.heightAt(v.group.position.x, v.group.position.z);
        if (v.group.position.y <= gy + 0.2) {
          this.effects.explosion(v.group.position.x, gy + 0.3, v.group.position.z, 1.6, 'blast');
          v.group.visible = false;
        }
        break;
      }
      default:
        v.group.visible = false;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.perf.frames++;
  }

  /** Drop shadow quality if the device cannot hold the frame rate. */
  autoQuality(dt: number) {
    this.perf.time += dt;
    if (this.perf.time > 5) {
      const fps = this.perf.frames / this.perf.time;
      if (fps < 24 && this.quality === 'high') {
        this.quality = 'low';
        this.renderer.shadowMap.enabled = false;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) ((o as THREE.Mesh).material as THREE.Material).needsUpdate = true;
        });
      }
      this.perf.time = 0;
      this.perf.frames = 0;
    }
  }

  dispose() {
    this.renderer.dispose();
  }
}
