import * as THREE from 'three';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Sfx } from './audio';
import { Fx } from './fx';
import { Hud } from './hud';
import { Input } from './input';
import { makeEnvironment } from './materials';
import { rollPerks } from './perks';
import { Renderer } from './render';
import { MAX_ENEMIES, Run } from './run';
import { Assets } from './assets';
import { Horde } from './horde';
import { useAssets } from './structures';
import { World } from './world';
import './style.css';

type State = 'menu' | 'playing' | 'paused' | 'levelup' | 'over';

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
  private renderer: Renderer;
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
  private horde: Horde | null = null;
  private state: State = 'menu';
  private clock = new THREE.Clock();
  private w = 1;
  private h = 1;
  private best = Number(load(BEST_KEY) ?? 0) || 0;
  private menuT = 0;

  constructor() {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new Renderer(this.canvas);
    this.scene.environment = makeEnvironment(this.renderer.gl);
    this.scene.environmentIntensity = 0.28;

    this.world = new World(this.scene, mobile ? 2048 : 4096);
    this.fx = new Fx(this.scene, document.getElementById('world-ui')!);
    this.input = new Input(document.getElementById('app')!);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    if (load(MUTE_KEY) === '1') this.setMuted(true);
    this.bindUi();
    this.showMenu();

    // Load the 3D models, then start a demo run behind the title screen.
    const play = document.getElementById('btn-play') as HTMLButtonElement;
    play.disabled = true;
    play.textContent = 'Loading… 0%';
    Assets.load((f) => (play.textContent = `Loading… ${Math.round(f * 100)}%`))
      .then((assets) => {
        useAssets(assets);
        this.horde = new Horde(assets, this.scene, MAX_ENEMIES);
        this.newRun();
        this.world.decorate(this.scene, this.run!.reservedSpots(), assets);
        play.disabled = false;
        play.textContent = 'Play';
      })
      .catch((err) => {
        console.error(err);
        play.textContent = 'Could not load. Tap to retry';
        play.disabled = false;
        play.onclick = () => location.reload();
      });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.renderer.gl.setAnimationLoop(() => this.frame());
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
    on('btn-nova', () => {
      if (this.state === 'playing') this.run?.castNova();
    });
    // Keep joystick from starting when tapping HUD buttons.
    for (const id of ['btn-pause', 'btn-mute', 'btn-nova']) {
      document.getElementById(id)!.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && this.state === 'playing') this.run?.castNova();
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
      hurt: (a) => (this.renderer.hurt = Math.max(this.renderer.hurt, a)),
      flash: (a) => (this.renderer.flash = Math.max(this.renderer.flash, a)),
    }, this.horde!);
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
    this.renderer.resize(this.w, this.h);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.fx.p.setViewport(this.h * Math.min(window.devicePixelRatio || 1, 2), this.camera.fov);
  }

  /** Pauses the action and shows the level-up cards, one level at a time. */
  private offerPerk() {
    const run = this.run!;
    this.state = 'levelup';
    this.input.enabled = false;
    this.input.release();
    this.sfx.levelUp();
    const lvl = run.level - run.pendingLevelUps + 1;
    const choices = rollPerks(run.perkLevels);
    if (!choices.length) {
      run.pendingLevelUps = 0;
      this.state = 'playing';
      this.input.enabled = true;
      return;
    }
    this.hud.showPerks(lvl, choices, run.perkLevels, (p) => {
      run.applyPerk(p);
      this.renderer.flash = 0.5;
      this.state = 'playing';
      this.input.enabled = true;
      this.clock.getDelta();
    });
  }

  private frame() {
    const rawDt = Math.min(this.clock.getDelta(), 1 / 20);
    const run = this.run;
    if (!run) {
      // Still loading: keep the scene alive behind the title card.
      this.menuT += rawDt;
      this.camera.position.set(Math.sin(this.menuT * 0.2) * 4, 34, 12);
      this.camera.lookAt(0, 0, -4);
      this.renderer.render(this.scene, this.camera, rawDt, rawDt);
      return;
    }
    this.input.update();

    // Hit-stop: big moments freeze the action for a beat.
    let dt = Math.min(rawDt, 1 / 30);
    if (run.hitstop > 0) {
      run.hitstop -= rawDt;
      dt *= 0.08;
    }

    if (this.state === 'playing') {
      run.update(dt, this.input.move);
      if (run.pendingLevelUps > 0 && run.hitstop <= 0 && !run.over) this.offerPerk();
    } else if (this.state === 'menu') {
      this.menuT += dt;
    }

    // Camera: three-quarter view following the hero with a little look-ahead.
    // Narrower screens need a slightly higher camera to show the same width of the world.
    const aspectZoom = Math.min(1.35, Math.max(1, 0.5 / (this.w / this.h)) * 1.1);
    const targetZoom = aspectZoom * (this.state === 'menu' ? 1.12 : 1);
    this.camZoom += (targetZoom - this.camZoom) * Math.min(1, dt * 2);
    const zoom = this.camZoom * (1 - this.fx.punch * 0.07);
    const follow =
      this.state === 'menu'
        ? this.look.set(Math.sin(this.menuT * 0.2) * 4, 0, -4 + Math.cos(this.menuT * 0.15) * 3)
        : this.look.copy(run.heroPos).addScaledVector(run.heroVel, 0.28);
    this.camFocus.lerp(follow, Math.min(1, dt * 4.5));
    const shake = this.fx.shake;
    this.camera.position.set(
      this.camFocus.x + (Math.random() - 0.5) * shake * 0.6,
      29 * zoom,
      this.camFocus.z + 14.5 * zoom + (Math.random() - 0.5) * shake * 0.6,
    );
    this.camera.lookAt(this.camFocus.x, 0, this.camFocus.z - 1.2);
    if (this.debugCam) {
      this.camera.position.copy(this.debugCam.pos);
      this.camera.lookAt(this.debugCam.look);
    }

    this.world.update(this.camFocus);
    const fxDt = this.state === 'paused' || this.state === 'levelup' ? 0 : dt;
    this.fx.update(fxDt, this.camera, this.w, this.h);
    if (this.state === 'menu' && Math.random() < 0.1) this.fx.p.motes(this.camFocus);
    this.hud.render(rawDt, this.camera, this.w, this.h);
    this.renderer.render(this.scene, this.camera, fxDt, rawDt);
  }

  private look = new THREE.Vector3();
  /** Playtest hook: pin the camera somewhere specific. */
  debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
}

const game = new Game();
// Exposed for automated playtests (harmless in production).
(window as unknown as { __hg: Game }).__hg = game;
