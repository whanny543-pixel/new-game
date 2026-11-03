import * as THREE from 'three';

// Cartoon shading: every lit surface gets a few flat bands of light instead of smooth PBR falloff,
// which (with the outline pass in render.ts) gives the chunky, hand-painted strategy-game look.

function makeGradient() {
  // Shadow side, mid tone, lit side. Shadows stay fairly bright so colours read clearly.
  const steps = [150, 205, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export const TOON_GRADIENT = makeGradient();

const cache = new WeakMap<THREE.Material, THREE.Material>();

/** A toon copy of a standard/lambert material (same colour, textures and transparency). */
export function toonMaterial(src: THREE.Material): THREE.Material {
  const hit = cache.get(src);
  if (hit) return hit;
  const m = src as THREE.MeshStandardMaterial;
  if (!(m.isMeshStandardMaterial || (m as unknown as THREE.MeshLambertMaterial).isMeshLambertMaterial)) return src;
  const t = new THREE.MeshToonMaterial({
    color: m.color.clone(),
    map: m.map,
    gradientMap: TOON_GRADIENT,
    emissive: m.emissive?.clone() ?? new THREE.Color(0),
    emissiveMap: m.emissiveMap ?? null,
    emissiveIntensity: m.emissiveIntensity ?? 1,
    alphaMap: m.alphaMap,
    alphaTest: m.alphaTest,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    vertexColors: m.vertexColors,
    depthWrite: m.depthWrite,
  });
  t.name = m.name;
  cache.set(src, t);
  cache.set(t, t);
  return t;
}

/** Converts every mesh under `root` to toon shading. */
export function toonify(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(toonMaterial);
    else mesh.material = toonMaterial(mesh.material);
  });
}
