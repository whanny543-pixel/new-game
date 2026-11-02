import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets, CharName } from './assets';
import type { EnemyKind } from './config';

// The horde: skinned skeleton models are "baked" into a handful of static poses per animation
// at load time. Each pose is an InstancedMesh, so hundreds of animated enemies cost a few dozen
// draw calls and no per-enemy skinning.

export type HordeAnim = 'move' | 'attack' | 'death' | 'spawn';

interface Baked {
  frames: THREE.InstancedMesh[];
  duration: number;
  loop: boolean;
  counts: number[];
}

interface KindSetup {
  char: CharName;
  height: number;
  move: string;
  weapons: [string, string][]; // [prop name, bone name]
}

const SETUP: Record<EnemyKind, KindSetup> = {
  goblin: { char: 'minion', height: 1.25, move: 'Walking_A', weapons: [] },
  runner: { char: 'rogue', height: 1.15, move: 'Running_A', weapons: [] },
  troll: { char: 'warrior', height: 3.3, move: 'Walking_A', weapons: [] },
};

/** Repaints a character atlas: skin tones become goblin green. */
function goblinTexture(src: THREE.Texture, dark: boolean) {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const skins = [
    [246, 192, 156],
    [248, 204, 171],
    [242, 168, 126],
    [231, 206, 180],
  ];
  let skinUv: [number, number] = [0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const gg = d[i + 1];
    const b = d[i + 2];
    if (!skins.some(([sr, sg, sb]) => Math.abs(r - sr) + Math.abs(gg - sg) + Math.abs(b - sb) < 30)) continue;
    const l = (r + gg + b) / 3 / 255;
    // Orcs get a darker olive skin than goblins.
    d[i] = (dark ? 70 : 105) * l * 1.15;
    d[i + 1] = (dark ? 140 : 190) * l * 1.15;
    d[i + 2] = (dark ? 50 : 60) * l * 1.15;
    if (!skinUv[0]) {
      const px = (i / 4) % c.width;
      const py = Math.floor(i / 4 / c.width);
      skinUv = [(px + 0.5) / c.width, src.flipY ? 1 - (py + 0.5) / c.height : (py + 0.5) / c.height];
    }
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = src.flipY;
  t.colorSpace = src.colorSpace;
  t.magFilter = src.magFilter;
  t.minFilter = src.minFilter;
  return { tex: t, skinUv };
}

/** Big pointy goblin ears on the head bone. */
function addEars(head: THREE.Object3D, mat: THREE.Material, size: number, uv: [number, number]) {
  for (const side of [-1, 1]) {
    const geo = new THREE.ConeGeometry(0.11 * size, 0.55 * size, 5);
    // Point every UV at a skin texel so the ears pick up the green from the shared atlas.
    const uvs = geo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uv[0], uv[1]);
    const ear = new THREE.Mesh(geo, mat);
    ear.position.set(side * 0.42 * size, 0.42 * size, -0.02);
    ear.rotation.set(0.15, 0, side * -1.2);
    head.add(ear);
  }
}

const FRAMES: Record<HordeAnim, number> = { move: 14, attack: 10, death: 12, spawn: 6 };
const CLIPS: Record<Exclude<HordeAnim, 'move'>, string> = {
  attack: '1H_Melee_Attack_Chop',
  death: 'Death_A',
  spawn: 'Idle',
};

function bakeClip(scene: THREE.Object3D, clip: THREE.AnimationClip, frames: number, loop: boolean) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  const out: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    const t = loop ? (clip.duration * f) / frames : (clip.duration * f) / Math.max(1, frames - 1);
    mixer.setTime(Math.min(t, clip.duration - 1e-4));
    scene.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const src = m.geometry;
      const n = src.attributes.position.count;
      const pos = new Float32Array(n * 3);
      const uv = new Float32Array(n * 2);
      const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh;
      for (let i = 0; i < n; i++) {
        if (skinned) (m as THREE.SkinnedMesh).getVertexPosition(i, v);
        else v.fromBufferAttribute(src.attributes.position, i);
        v.applyMatrix4(m.matrixWorld);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        if (src.attributes.uv) {
          uv[i * 2] = src.attributes.uv.getX(i);
          uv[i * 2 + 1] = src.attributes.uv.getY(i);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(src.index ? Array.from(src.index.array) : Array.from({ length: n }, (_, i) => i));
      parts.push(g);
    });
    const merged = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    out.push(merged);
  }
  mixer.stopAllAction();
  return out;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

export class Horde {
  private kinds = {} as Record<EnemyKind, { scale: number; anims: Record<HordeAnim, Baked> }>;

  constructor(assets: Assets, parent: THREE.Object3D, caps: Record<EnemyKind, number>) {
    for (const kind of Object.keys(SETUP) as EnemyKind[]) {
      const s = SETUP[kind];
      const tpl = assets.chars[s.char];
      const scene = SkeletonUtils.clone(tpl.scene);
      for (const [prop, bone] of s.weapons) {
        const b = scene.getObjectByName(bone);
        const w = assets.props.get(prop);
        if (b && w) b.add(w.clone(true));
      }
      let material: THREE.Material | null = null;
      scene.traverse((o) => {
        if (!material && (o as THREE.Mesh).isMesh) material = ((o as THREE.Mesh).material as THREE.Material).clone();
      });
      const mat = material as unknown as THREE.MeshStandardMaterial;
      mat.roughness = 0.6;
      // Green skin and pointy ears turn the adventurer rigs into goblins (and an orc warlord).
      let skinUv: [number, number] = [0, 0];
      if (mat.map) {
        const g = goblinTexture(mat.map, kind === 'troll');
        mat.map = g.tex;
        skinUv = g.skinUv;
      }
      const head = scene.getObjectByName('head');
      if (head) addEars(head, mat, 1, skinUv);
      if (kind === 'troll') {
        // The warlord swings his big axe.
        const axe = scene.getObjectByName('2H_Axe');
        if (axe) axe.visible = true;
      }
      const anims = {} as Record<HordeAnim, Baked>;
      for (const anim of Object.keys(FRAMES) as HordeAnim[]) {
        const clipName = anim === 'move' ? s.move : anim === 'attack' && kind === 'troll' ? '2H_Melee_Attack_Chop' : CLIPS[anim];
        const clip = tpl.clips.find((c) => c.name === clipName) ?? tpl.clips[0];
        const loop = anim === 'move' || anim === 'attack';
        const geos = bakeClip(scene, clip, FRAMES[anim], loop);
        const frames = geos.map((g) => {
          const im = new THREE.InstancedMesh(g, mat, caps[kind]);
          im.count = 0;
          im.castShadow = true;
          im.receiveShadow = false;
          im.frustumCulled = false;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.setColorAt(0, tmpC.setRGB(1, 1, 1));
          im.visible = false;
          parent.add(im);
          return im;
        });
        anims[anim] = { frames, duration: clip.duration, loop, counts: new Array(frames.length).fill(0) };
      }
      this.kinds[kind] = { scale: s.height / tpl.height, anims };
    }
  }

  /** Duration of an animation in seconds (at speed 1). */
  duration(kind: EnemyKind, anim: HordeAnim) {
    return this.kinds[kind].anims[anim].duration;
  }

  begin() {
    for (const k of Object.values(this.kinds))
      for (const a of Object.values(k.anims)) a.counts.fill(0);
  }

  /** Queue one enemy for drawing this frame. `t` is seconds into the animation. */
  add(kind: EnemyKind, anim: HordeAnim, t: number, x: number, y: number, z: number, rotY: number, tilt: number, sizeMul: number, bright: number) {
    const k = this.kinds[kind];
    const a = k.anims[anim];
    const n = a.frames.length;
    let f = Math.floor((t / a.duration) * n);
    f = a.loop ? ((f % n) + n) % n : Math.min(n - 1, Math.max(0, f));
    const im = a.frames[f];
    const i = a.counts[f]++;
    if (i >= im.instanceMatrix.count) return;
    const s = k.scale * sizeMul;
    tmpQ.setFromEuler(tmpE.set(tilt, rotY, 0, 'YXZ'));
    tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(s, s, s));
    im.setMatrixAt(i, tmpM);
    im.setColorAt(i, tmpC.setRGB(bright, bright, bright));
  }

  end() {
    for (const k of Object.values(this.kinds))
      for (const a of Object.values(k.anims))
        a.frames.forEach((im, f) => {
          im.count = Math.min(a.counts[f], im.instanceMatrix.count);
          im.visible = im.count > 0;
          if (im.count) {
            im.instanceMatrix.needsUpdate = true;
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
          }
        });
  }

  dispose(parent: THREE.Object3D) {
    for (const k of Object.values(this.kinds))
      for (const a of Object.values(k.anims))
        for (const im of a.frames) {
          parent.remove(im);
          im.dispose();
        }
  }
}
