import * as THREE from 'three';

// Shared material helpers. Every surface gets a subtle world-space detail texture
// (projected along whichever axis it faces), which breaks up flat colours into
// something that reads as wood grain, stone pitting or sand without any UV work.

function makeNoise(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  // Tileable value noise, several octaves.
  const grid = (n: number) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return { n, a };
  };
  const octaves = [grid(4), grid(8), grid(16), grid(32), grid(64)];
  const sample = (o: { n: number; a: Float32Array }, x: number, y: number) => {
    const fx = (x / size) * o.n;
    const fy = (y / size) * o.n;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (i: number, j: number) => o.a[((j + o.n) % o.n) * o.n + ((i + o.n) % o.n)];
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let tot = 0;
      for (const o of octaves) {
        v += sample(o, x, y) * amp;
        tot += amp;
        amp *= 0.55;
      }
      v /= tot;
      // Second channel: stretched streaks for wood grain.
      const streak = sample(octaves[4], x * 0.12, y) * 0.6 + sample(octaves[3], x * 0.2, y) * 0.4;
      const i = (y * size + x) * 4;
      img.data[i] = v * 255;
      img.data[i + 1] = streak * 255;
      img.data[i + 2] = Math.random() * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export const DETAIL = makeNoise();

/** Adds world-space detail modulation to a standard material. Strength ~0.2–0.5. */
export function detailize<T extends THREE.MeshStandardMaterial>(mat: T, strength = 0.32, scale = 0.6): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: DETAIL };
    shader.uniforms.uDetailStrength = { value: strength };
    shader.uniforms.uDetailScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDPos;\nvarying vec3 vDNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 dW = vec4(transformed, 1.0);
        vec3 dN = objectNormal;
        #ifdef USE_INSTANCING
          dW = instanceMatrix * dW;
          dN = mat3(instanceMatrix) * dN;
        #endif
        dW = modelMatrix * dW;
        vDPos = dW.xyz;
        vDNrm = normalize(mat3(modelMatrix) * dN);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uDetail;
        uniform float uDetailStrength;
        uniform float uDetailScale;
        varying vec3 vDPos;
        varying vec3 vDNrm;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 an = abs(vDNrm);
          vec2 uv = an.y > max(an.x, an.z) ? vDPos.xz : (an.x > an.z ? vDPos.zy : vDPos.xy);
          vec4 d1 = texture2D(uDetail, uv * uDetailScale * 0.25);
          vec4 d2 = texture2D(uDetail, uv * uDetailScale * 1.3);
          float n = d1.r * 0.55 + d2.r * 0.45;
          // Vertical faces get directional grain.
          float grain = an.y > 0.6 ? 0.5 : d2.g;
          float m = mix(n, grain, 0.35);
          diffuseColor.rgb *= 1.0 + (m - 0.5) * uDetailStrength * 2.0;
          // Darken toward the ground: cheap ambient occlusion.
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.9, vDPos.y));
        }`,
      );
  };
  mat.customProgramCacheKey = () => `detail-${strength}-${scale}`;
  return mat;
}

export function standard(color: number, extra: THREE.MeshStandardMaterialParameters = {}, strength = 0.3) {
  return detailize(new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...extra }), strength);
}

/** Bakes a soft studio environment so standard materials pick up nice reflections. */
export function makeEnvironment(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  // Warm sky dome + bright sun patch + ground bounce.
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; void main(){
      float h = vP.y;
      vec3 sky = mix(vec3(1.0,0.86,0.66), vec3(0.55,0.72,0.95), smoothstep(0.0, 0.8, h));
      vec3 ground = vec3(0.75,0.5,0.3);
      vec3 c = h > 0.0 ? sky : ground * (0.6 + 0.4 * (1.0 + h));
      float sun = pow(max(0.0, dot(vP, normalize(vec3(0.5,0.7,0.3)))), 64.0);
      gl_FragColor = vec4(c + sun * vec3(6.0,5.0,3.5), 1.0);
    }`,
  });
  env.add(new THREE.Mesh(geo, mat));
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return rt.texture;
}
