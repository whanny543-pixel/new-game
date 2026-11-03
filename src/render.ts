import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Rendering pipeline: scene → bloom → colour grade + vignette → tone-mapped output.
// Quality steps down automatically if the device can't hold a smooth frame rate.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.22 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uSat: { value: 1.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uHurt, uFlash, uSat;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Gentle saturation boost and warm lift in the shadows.
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb += vec3(-0.01, 0.0, 0.025) * (1.0 - l); // cool the shadows a touch
      // Vignette (tinted red when hurt).
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.8)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      c.rgb = mix(c.rgb, vec3(0.9, 0.08, 0.05), (1.0 - v) * uHurt * 0.75);
      c.rgb += uFlash * vec3(1.0, 0.92, 0.7);
      gl_FragColor = c;
    }
  `,
};

/**
 * Cartoon outlines from the depth buffer: wherever depth jumps between neighbouring pixels (a
 * silhouette), the edge is inked in a dark, saturated version of the colour underneath.
 */
class InkPass extends Pass {
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  camera: THREE.PerspectiveCamera | null = null;
  constructor() {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.5 },
        uFar: { value: 160 },
        uWidth: { value: 1.4 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear, uFar, uWidth;
        varying vec2 vUv;
        float lin(vec2 uv) {
          float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
          return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
        }
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float d = lin(vUv);
          vec2 o = uTexel * uWidth;
          float n = max(max(lin(vUv + vec2(o.x, 0.0)), lin(vUv - vec2(o.x, 0.0))), max(lin(vUv + vec2(0.0, o.y)), lin(vUv - vec2(0.0, o.y))));
          float m = min(min(lin(vUv + vec2(o.x, 0.0)), lin(vUv - vec2(o.x, 0.0))), min(lin(vUv + vec2(0.0, o.y)), lin(vUv - vec2(0.0, o.y))));
          // Relative depth jump: only real silhouettes, not the gentle slope of the ground.
          float jump = max(n - d, d - m) / max(d, 0.001);
          float edge = smoothstep(0.05, 0.11, jump);
          // Fade outlines on the far background so distant scenery stays soft.
          edge *= 1.0 - smoothstep(55.0, 85.0, d);
          vec3 ink = c.rgb * vec3(0.18, 0.16, 0.2);
          gl_FragColor = vec4(mix(c.rgb, ink, edge * 0.92), c.a);
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w: number, h: number) {
    this.mat.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }
  setWidth(px: number) {
    this.mat.uniforms.uWidth.value = px;
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    this.mat.uniforms.tDepth.value = readBuffer.depthTexture;
    if (this.camera) {
      this.mat.uniforms.uNear.value = this.camera.near;
      this.mat.uniforms.uFar.value = this.camera.far;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.mat.dispose();
    this.quad.dispose();
  }
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private ink: InkPass;
  private renderPass: RenderPass;
  private quality = 2; // 2 high, 1 medium, 0 low
  private frameTimes: number[] = [];
  private w = 1;
  private h = 1;
  private readonly mobile = matchMedia('(pointer: coarse)').matches;
  hurt = 0;
  flash = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;

    const dummyScene = new THREE.Scene();
    const dummyCam = new THREE.Camera();
    // Multisampled HDR target: anti-aliasing survives the post-processing chain.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.mobile ? 2 : 4 });
    // Depth as a texture so the ink pass can find silhouettes.
    target.depthTexture = new THREE.DepthTexture(1, 1);
    target.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(this.gl, target);
    this.renderPass = new RenderPass(dummyScene, dummyCam);
    this.composer.addPass(this.renderPass);
    this.ink = new InkPass();
    this.composer.addPass(this.ink);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 1.75);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.applyQuality();
  }

  private pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, [1, 1.5, this.mobile ? 2 : 1.75][this.quality]);
  }

  private applyQuality() {
    this.gl.setPixelRatio(this.pixelRatio());
    this.bloom.enabled = this.quality > 0;
    this.composer.setPixelRatio(this.pixelRatio());
    this.resize(this.w, this.h);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.ink.setSize(w * this.pixelRatio(), h * this.pixelRatio());
    this.ink.setWidth(Math.max(1, this.pixelRatio() * 0.85));
    // Bloom at reduced resolution: looks the same, costs a fraction.
    this.bloom.setSize(Math.max(64, (w * this.pixelRatio()) / 2), Math.max(64, (h * this.pixelRatio()) / 2));
  }

  /** Watches frame times and steps quality down (never up) when the device struggles. */
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;
    if (median > 1 / 40 && this.quality > 0) {
      this.quality--;
      this.applyQuality();
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number, rawDt: number) {
    this.adapt(rawDt);
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.ink.camera = camera as THREE.PerspectiveCamera;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.grade.uniforms.uHurt.value = this.hurt;
    this.grade.uniforms.uFlash.value = this.flash * 0.35;
    this.composer.render(dt);
  }
}
