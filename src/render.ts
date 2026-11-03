import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
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
    this.composer = new EffectComposer(this.gl, target);
    this.renderPass = new RenderPass(dummyScene, dummyCam);
    this.composer.addPass(this.renderPass);
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
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.grade.uniforms.uHurt.value = this.hurt;
    this.grade.uniforms.uFlash.value = this.flash * 0.35;
    this.composer.render(dt);
  }
}
