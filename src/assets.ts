import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { detailize } from './materials';

import heroUrl from './assets/models/king.glb?url';
import archerUrl from './assets/models/archer.glb?url';
import knightUrl from './assets/models/knight.glb?url';
import raiderUrl from './assets/models/raider.glb?url';
import bruteUrl from './assets/models/brute.glb?url';
import propsUrl from './assets/models/props.glb?url';
import natureUrl from './assets/models/nature.glb?url';
import villagerUrl from './assets/models/villager.glb?url';

// 3D models (all CC0): KayKit by Kay Lousberg (Adventurers 2.0, Medieval Hexagon, Forest Nature), Kenney (kenney.nl),
// Quaternius (Stylized Nature MegaKit).

export type CharName = 'hero' | 'archer' | 'knight' | 'raider' | 'brute' | 'villager';

const CHAR_URLS: Record<CharName, string> = {
  hero: heroUrl,
  archer: archerUrl,
  knight: knightUrl,
  raider: raiderUrl,
  brute: bruteUrl,
  villager: villagerUrl,
};

export interface CharTemplate {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Model height in its own units (used to scale to game size). */
  height: number;
}

/** An animated character instance. */
export class CharRig {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private loopName = '';
  private oneShot = false;

  constructor(t: CharTemplate, height: number) {
    this.model = SkeletonUtils.clone(t.scene);
    this.model.scale.setScalar(height / t.height);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of t.clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.mixer.addEventListener('finished', () => {
      this.oneShot = false;
      this.play(this.loopName, 0.15, true);
    });
  }

  find(name: string) {
    return this.model.getObjectByName(name);
  }

  /** Switch the looping animation (idle, run…). */
  loop(name: string, fade = 0.18) {
    if (this.loopName === name) return;
    this.loopName = name;
    if (!this.oneShot) this.play(name, fade, true);
  }

  /** Play an animation once (attack, cheer), then return to the loop. */
  once(name: string, speed = 1, fade = 0.08) {
    this.oneShot = true;
    this.play(name, fade, false, speed);
  }

  private play(name: string, fade: number, loop: boolean, speed = 1) {
    const next = this.actions.get(name);
    if (!next) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.timeScale = speed;
    next.enabled = true;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
  }

  setSpeed(s: number) {
    if (this.current && !this.oneShot) this.current.timeScale = s;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}

/** Merges all skinned parts sharing a rig into one SkinnedMesh: far fewer draw calls per unit. */
function mergeSkinnedParts(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const parts: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  if (parts.length < 2) return;
  const first = parts[0];
  const inv = first.bindMatrix.clone().invert();
  const geos: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  for (const p of parts) {
    const src = p.geometry;
    const n = src.attributes.position.count;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    // Remap joint indices onto the first part's skeleton (bones are shared by name).
    const remap = p.skeleton.bones.map((b) => first.skeleton.bones.findIndex((fb) => fb.name === b.name));
    // Parts can carry their own inverse bind matrices; C maps this part's bind space onto the first's:
    // IBM1 · B1 · v' = IBMp · Bp · v  ⇒  v' = B1⁻¹ · (IBM1⁻¹ · IBMp) · Bp · v
    const j = 0;
    const C = first.skeleton.boneInverses[remap[j]].clone().invert().multiply(p.skeleton.boneInverses[j]);
    const m = inv.clone().multiply(C).multiply(p.bindMatrix);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(src.attributes.position, i).applyMatrix4(m);
      pos.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(src.attributes.normal, i).applyMatrix3(nm).normalize();
      nrm.set([v.x, v.y, v.z], i * 3);
      if (src.attributes.uv) uv.set([src.attributes.uv.getX(i), src.attributes.uv.getY(i)], i * 2);
      for (let k = 0; k < 4; k++) {
        si[i * 4 + k] = Math.max(0, remap[src.attributes.skinIndex.getComponent(i, k)] ?? 0);
        sw[i * 4 + k] = src.attributes.skinWeight.getComponent(i, k);
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(src.index ? Array.from(src.index.array) : null);
    geos.push(g);
  }
  if (geos.some((g) => !g.index)) return;
  const merged = mergeGeometries(geos)!;
  const mesh = new THREE.SkinnedMesh(merged, first.material);
  mesh.name = 'Body_Merged';
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  // Keep the first part's own transform: the bind matrix was captured relative to it.
  mesh.position.copy(first.position);
  mesh.quaternion.copy(first.quaternion);
  mesh.scale.copy(first.scale);
  first.parent!.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(first.skeleton, first.bindMatrix);
  for (const p of parts) p.parent?.remove(p);
}

export class Assets {
  readonly props = new Map<string, THREE.Object3D>();
  private propBounds = new Map<string, THREE.Box3>();
  readonly chars = {} as Record<CharName, CharTemplate>;

  static async load(onProgress: (f: number) => void) {
    const a = new Assets();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const names = Object.keys(CHAR_URLS) as CharName[];
    let done = 0;
    const total = names.length + 2;
    const tick = () => onProgress(++done / total);
    // Inlined builds embed models as data: URLs. Decode those directly rather than fetching them,
    // since some hosts (sandboxed pages) block fetch() of data: URLs.
    const load = async (url: string) => {
      let g: GLTF;
      if (url.startsWith('data:')) {
        const bin = atob(url.slice(url.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        g = await loader.parseAsync(bytes.buffer, '');
      } else g = await loader.loadAsync(url);
      tick();
      return g;
    };

    const [props, nature, ...chars] = await Promise.all([load(propsUrl), load(natureUrl), ...names.map((n) => load(CHAR_URLS[n]))]);
    a.prepareProps(props);
    a.prepareProps(nature, true);
    names.forEach((n, i) => a.prepareChar(n, chars[i]));
    return a;
  }

  private prepareProps(g: GLTF, painted = false) {
    const tuned = new Set<THREE.Material>();
    for (const child of [...g.scene.children]) {
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!tuned.has(mat)) {
          tuned.add(mat);
          mat.roughness = painted ? 0.9 : 0.78;
          mat.metalness = 0;
          // Painted textures carry their own detail; leaves are alpha cut-outs seen from both sides.
          if (painted) {
            if (mat.alphaTest > 0 || mat.transparent) {
              mat.transparent = false;
              mat.alphaTest = 0.5;
              mat.side = THREE.DoubleSide;
            }
          } else detailize(mat, 0.16, 0.9);
        }
      });
      this.props.set(child.name, child);
      this.propBounds.set(child.name, new THREE.Box3().setFromObject(child));
    }
  }

  private prepareChar(name: CharName, g: GLTF) {
    mergeSkinnedParts(g.scene);
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.roughness = 0.65;
      mat.metalness = 0;
    });
    // Height from the bind pose.
    const box = new THREE.Box3().setFromObject(g.scene);
    this.chars[name] = { scene: g.scene, clips: g.animations, height: Math.max(0.1, box.max.y - box.min.y) };
  }

  /**
   * A copy of a static model, scaled so its largest dimension along `axis` is `size`,
   * centred on x/z and resting on the ground.
   */
  prop(name: string, size: number, axis: 'y' | 'x' | 'z' | 'max' = 'y') {
    const src = this.props.get(name);
    const box = this.propBounds.get(name);
    if (!src || !box) {
      console.warn('missing prop', name);
      return new THREE.Group();
    }
    const dim = box.getSize(new THREE.Vector3());
    const ref = axis === 'max' ? Math.max(dim.x, dim.y, dim.z) : dim[axis];
    const s = size / Math.max(1e-4, ref);
    const inner = src.clone(true);
    inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const outer = new THREE.Group();
    outer.add(inner);
    outer.scale.setScalar(s);
    return outer;
  }

  /** First mesh geometry/material inside a prop (for instancing small items like coins). */
  propMesh(name: string) {
    let found: THREE.Mesh | null = null;
    this.props.get(name)?.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    return found as THREE.Mesh | null;
  }

  character(name: CharName, height: number) {
    return new CharRig(this.chars[name], height);
  }
}
