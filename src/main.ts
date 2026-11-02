import * as THREE from 'three';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Sfx } from './audio';
import { Fx } from './fx';
import { Hud } from './hud';
import { Input } from './input';
import { Run } from './run';
import { World } from './world';
import './style.css';

type State = 'menu' | 'playing' | 'paused' | 'over';

const BEST_KEY = 'hearthguard.bestWave';
const MUTE_KEY = 'hearthguard.muted';

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — nothing to do */
  }
}

class Game {
  private canvas = document.getElementById('c') as HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.5, 160);
  private camFocus = new THREE.Vector3(0, 0, 2);
  private camZoom = 1;
  private world: World;
  private fx: Fx;
  private hud = new Hud();
  private sfx = new Sfx();
  private input: Input;
  private run: Run | null = null;
  private state: State = 'menu';
  private clock = new THREE.Clock();
  private w = 1;
  private h = 1;
  private best = Number(load(BEST_KEY) ?? 0) || 0;
  private menuT = 0;

  constructor() {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 2 : 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.world = new World(this.scene, mobile ? 1024 : 2048);
    this.fx = new Fx(this.scene, document.getElementById('world-ui')!);
    this.input = new Input(document.getElementById('app')!);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    if (load(MUTE_KEY) === '1') this.setMuted(true);
    this.bindUi();
    this.showMenu();

    // A demo run plays behind the title screen so the world is alive from the first frame.
    this.newRun();
    this.world.decorate(this.scene, this.run!.reservedSpots());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.renderer.setAnimationLoop(() => this.frame());
  }

  private bindUi() {
    const on = (id: string, fn: () => void) =>
      document.getElementById(id)!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sfx.unlock();
        fn();
      });
    on('btn-play', () => this.start());
    on('btn-again', () => this.start());
    on('btn-pause', () => this.pause());
    on('btn-resume', () => this.resume());
    on('btn-quit', () => {
      document.getElementById('paused')!.classList.add('hidden');
      this.showMenu();
      this.newRun();
    });
    on('btn-mute', () => this.setMuted(!this.sfx.muted));
    // Keep joystick from starting when tapping HUD buttons.
    for (const id of ['btn-pause', 'btn-mute']) {
      document.getElementById(id)!.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'p') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
    });
  }

  private setMuted(m: boolean) {
    this.sfx.setMuted(m);
    save(MUTE_KEY, m ? '1' : '0');
    document.getElementById('mute-waves')!.style.display = m ? 'none' : '';
    document.getElementById('mute-x')!.style.display = m ? '' : 'none';
  }

  private showMenu() {
    this.state = 'menu';
    this.input.enabled = false;
    this.input.release();
    this.hud.show(false);
    document.getElementById('menu')!.classList.remove('hidden');
    document.getElementById('best')!.textContent = this.best ? `Best: Wave ${this.best}` : '';
  }

  private newRun() {
    this.run?.dispose();
    this.hud.reset();
    this.fx.clear();
    this.run = new Run(this.scene, this.world, this.fx, this.sfx, this.hud, {
      onGameOver: (wave) => this.gameOver(wave),
      haptic: (strong) => {
        Haptics.impact({ style: strong ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {});
      },
    });
    this.camFocus.copy(this.run.heroPos);
  }

  private start() {
    document.getElementById('menu')!.classList.add('hidden');
    document.getElementById('over')!.classList.add('hidden');
    this.newRun();
    this.state = 'playing';
    this.input.enabled = true;
    this.hud.show(true);
    this.clock.getDelta();
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.release();
    document.getElementById('paused')!.classList.remove('hidden');
  }

  private resume() {
    this.state = 'playing';
    this.input.enabled = true;
    document.getElementById('paused')!.classList.add('hidden');
    this.clock.getDelta();
  }

  private gameOver(wave: number) {
    // Let the explosion play for a moment before the card appears.
    setTimeout(() => {
      this.state = 'over';
      this.input.enabled = false;
      this.input.release();
      const record = wave > this.best;
      if (record) {
        this.best = wave;
        save(BEST_KEY, String(wave));
      }
      document.getElementById('over-wave')!.textContent = `You held until wave ${wave}`;
      document.getElementById('over-best')!.textContent = record ? 'New best!' : `Best: Wave ${this.best}`;
      document.getElementById('over')!.classList.remove('hidden');
    }, 1200);
  }

  private resize() {
    const app = document.getElementById('app')!;
    this.w = app.clientWidth;
    this.h = app.clientHeight;
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    const run = this.run!;
    this.input.update();

    if (this.state === 'playing') {
      run.update(dt, this.input.move);
    } else if (this.state === 'menu') {
      this.menuT += dt;
    }

    // Camera: fixed three-quarter view following the hero; zooms out as the land grows.
    // Narrower screens need a slightly higher camera to show the same width of the world.
    const aspectZoom = Math.min(1.35, Math.max(1, 0.5 / (this.w / this.h)) * 1.1);
    const targetZoom = aspectZoom * (this.state === 'menu' ? 1.15 : 1);
    this.camZoom += (targetZoom - this.camZoom) * Math.min(1, dt * 2);
    const follow = this.state === 'menu' ? new THREE.Vector3(Math.sin(this.menuT * 0.2) * 3, 0, 0) : run.heroPos;
    this.camFocus.lerp(follow, Math.min(1, dt * 5));
    const shake = this.fx.shake;
    this.camera.position.set(
      this.camFocus.x + (Math.random() - 0.5) * shake * 0.5,
      30 * this.camZoom,
      this.camFocus.z + 13.5 * this.camZoom + (Math.random() - 0.5) * shake * 0.5,
    );
    this.camera.lookAt(this.camFocus.x, 0, this.camFocus.z - 1.5);

    this.world.update(this.camFocus);
    if (this.state !== 'paused') this.fx.update(dt, this.camera, this.w, this.h);
    this.hud.render(dt, this.camera, this.w, this.h);
    this.renderer.render(this.scene, this.camera);
  }
}

const game = new Game();
// Exposed for automated playtests (harmless in production).
(window as unknown as { __hg: Game }).__hg = game;
