import * as THREE from 'three';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Sfx } from './audio';
import { Fx } from './fx';
import { Hud } from './hud';
import { Input } from './input';
import { makeEnvironment } from './materials';
import { rollPerks } from './perks';
import { Renderer } from './render';
import { MAX_ENEMIES, Conquest } from './conquest';
import { Assets } from './assets';
import { Horde } from './horde';
import { useAssets } from './structures';
import { World } from './world';
import { CROWNS, GEAR, GEAR_COSTS, KINGDOMS, type GearId } from './config';
import type { Assets as AssetsT } from './assets';
import './style.css';

type State = 'menu' | 'map' | 'playing' | 'paused' | 'levelup' | 'over';

/** Camera: looks across the realm diagonally, three-quarter view, following the king. */
const CAM_YAW = Math.PI / 4;
const CAM_PITCH = 0.92;
const CAM_DIST = 33;

const SAVE_KEY = 'hearthguard.campaign.v1';
const MUTE_KEY = 'hearthguard.muted';

/** Campaign progress kept between sessions. */
interface Save {
  crowns: number;
  /** Highest kingdom index the player may enter. */
  unlocked: number;
  best: Record<string, number>;
  won: Record<string, boolean>;
  gear: Partial<Record<GearId, number>>;
}

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
  private run: Conquest | null = null;
  private horde: Horde | null = null;
  private state: State = 'menu';
  private clock = new THREE.Clock();
  private w = 1;
  private h = 1;
  private menuT = 0;
  private assets: AssetsT | null = null;
  private kingdomIndex = 0;
  private save: Save = this.loadSave();

  private loadSave(): Save {
    const blank: Save = { crowns: 0, unlocked: 0, best: {}, won: {}, gear: {} };
    try {
      return { ...blank, ...JSON.parse(load(SAVE_KEY) ?? '{}') };
    } catch {
      return blank;
    }
  }

  private persist() {
    save(SAVE_KEY, JSON.stringify(this.save));
  }

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
        this.assets = assets;
        this.horde = new Horde(assets, this.scene, MAX_ENEMIES);
        this.newRun();
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
    on('btn-play', () => this.showMap());
    on('btn-again', () => this.start(this.kingdomIndex));
    on('btn-to-map', () => this.showMap());
    on('btn-victory-map', () => this.showMap());
    on('btn-armory', () => this.showArmory());
    on('btn-armory-close', () => document.getElementById('armory')!.classList.add('hidden'));
    on('btn-pause', () => this.pause());
    on('btn-resume', () => this.resume());
    on('btn-quit', () => {
      document.getElementById('paused')!.classList.add('hidden');
      this.showMap();
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
    document.getElementById('best')!.textContent = this.save.crowns ? `Crowns: ${this.save.crowns}` : '';
  }

  // ---------------------------------------------------------------- campaign screens

  /** World map: pick a kingdom to defend. */
  private showMap() {
    this.state = 'map';
    this.input.enabled = false;
    this.input.release();
    this.hud.show(false);
    for (const id of ['menu', 'over', 'victory', 'paused']) document.getElementById(id)!.classList.add('hidden');
    document.getElementById('worldmap')!.classList.remove('hidden');
    document.getElementById('map-crowns')!.textContent = String(this.save.crowns);
    const nodes = document.getElementById('map-nodes')!;
    nodes.innerHTML = '';
    KINGDOMS.forEach((k, i) => {
      const locked = i > this.save.unlocked;
      const won = this.save.won[k.id];
      const b = document.createElement('button');
      b.className = `map-node${locked ? ' locked' : ''}${won ? ' won' : ''}${i === this.save.unlocked && !won ? ' next' : ''}`;
      b.style.left = `${k.mapX}%`;
      b.style.top = `${k.mapY}%`;
      b.innerHTML = `<span class="pin">${locked ? '🔒' : won ? '★' : i + 1}</span><span class="name">${k.name}</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sfx.unlock();
        if (locked) return;
        this.selectKingdom(i);
      });
      nodes.appendChild(b);
    });
    this.selectKingdom(Math.min(this.save.unlocked, KINGDOMS.length - 1));
  }

  private selectKingdom(i: number) {
    this.kingdomIndex = i;
    const k = KINGDOMS[i];
    const card = document.getElementById('map-card')!;
    const best = this.save.best[k.id];
    card.innerHTML = `
      <h3>${k.name}</h3>
      <p>${k.blurb}</p>
      <p class="facts">Claim <b>7</b> lands · Goblin strength <b>×${k.hpMul.toFixed(2)}</b>${best ? ` · Best: ${best} raids` : ''}${this.save.won[k.id] ? ' · <b>Conquered</b>' : ''}</p>
      <button id="btn-defend" class="cta">Reclaim ${k.name}</button>`;
    document.querySelectorAll('.map-node').forEach((n, j) => n.classList.toggle('selected', j === i));
    document.getElementById('btn-defend')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sfx.unlock();
      this.start(i);
    });
  }

  /** The king's armory: spend crowns on permanent upgrades. */
  private showArmory() {
    document.getElementById('armory')!.classList.remove('hidden');
    document.getElementById('armory-crowns')!.textContent = String(this.save.crowns);
    const list = document.getElementById('armory-list')!;
    list.innerHTML = '';
    for (const g of GEAR) {
      const lvl = this.save.gear[g.id] ?? 0;
      const maxed = lvl >= g.max;
      const cost = GEAR_COSTS[lvl];
      const row = document.createElement('div');
      row.className = 'gear';
      row.innerHTML = `
        <div class="gear-info"><b>${g.name}</b> <span class="gear-lvl">${'◆'.repeat(lvl)}${'◇'.repeat(g.max - lvl)}</span><small>${g.desc} per level</small></div>
        <button class="gear-buy" ${maxed || this.save.crowns < cost ? 'disabled' : ''}>${maxed ? 'Max' : `👑 ${cost}`}</button>`;
      row.querySelector('button')!.addEventListener('click', (e) => {
        e.stopPropagation();
        if (maxed || this.save.crowns < cost) return;
        this.save.crowns -= cost;
        this.save.gear[g.id] = lvl + 1;
        this.persist();
        this.sfx.levelUp();
        this.showArmory();
        document.getElementById('map-crowns')!.textContent = String(this.save.crowns);
      });
      list.appendChild(row);
    }
  }

  private newRun(kingdom = this.kingdomIndex) {
    this.run?.dispose();
    this.hud.reset();
    this.fx.clear();
    const map = KINGDOMS[kingdom];
    this.world.setMap(map);
    this.run = new Conquest(this.scene, this.world, this.fx, this.sfx, this.hud, {
      onGameOver: (wave) => this.gameOver(wave),
      onVictory: () => this.victory(),
      haptic: (strong) => {
        Haptics.impact({ style: strong ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {});
      },
      hurt: (a) => (this.renderer.hurt = Math.max(this.renderer.hurt, a)),
      flash: (a) => (this.renderer.flash = Math.max(this.renderer.flash, a)),
    }, this.horde!, map, this.assets!, this.save.gear);
    this.camFocus.copy(this.run.heroPos);
  }

  private start(kingdom = this.kingdomIndex) {
    this.kingdomIndex = kingdom;
    for (const id of ['menu', 'over', 'victory', 'worldmap']) document.getElementById(id)!.classList.add('hidden');
    this.newRun(kingdom);
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

  /** Crowns for the waves this run survived (paid on defeat and on victory). */
  private payCrowns(waves: number) {
    const earned = Math.max(0, waves) * CROWNS.perWave(this.kingdomIndex);
    this.save.crowns += earned;
    const id = KINGDOMS[this.kingdomIndex].id;
    this.save.best[id] = Math.max(this.save.best[id] ?? 0, waves);
    return earned;
  }

  private gameOver(wave: number) {
    // Let the explosion play for a moment before the card appears.
    setTimeout(() => {
      this.state = 'over';
      this.input.enabled = false;
      this.input.release();
      const earned = this.payCrowns(wave - 1);
      this.persist();
      document.getElementById('over-wave')!.textContent = `You held ${KINGDOMS[this.kingdomIndex].name} through ${Math.max(0, wave - 1)} goblin raids`;
      document.getElementById('over-best')!.textContent = `+${earned} crowns · spend them in the Armory`;
      document.getElementById('over')!.classList.remove('hidden');
    }, 1200);
  }

  private victory() {
    setTimeout(() => {
      this.state = 'over';
      this.input.enabled = false;
      this.input.release();
      const k = KINGDOMS[this.kingdomIndex];
      const earned = this.payCrowns(k.waves) + CROWNS.victory(this.kingdomIndex);
      this.save.crowns += CROWNS.victory(this.kingdomIndex);
      this.save.won[k.id] = true;
      this.save.unlocked = Math.max(this.save.unlocked, Math.min(KINGDOMS.length - 1, this.kingdomIndex + 1));
      this.persist();
      const next = KINGDOMS[this.kingdomIndex + 1];
      document.getElementById('victory-title')!.textContent = `${k.name} is safe!`;
      document.getElementById('victory-text')!.textContent = `+${earned} crowns.${next ? ` ${next.name} calls for its king.` : ' Every kingdom is free. Long live the king!'}`;
      document.getElementById('victory')!.classList.remove('hidden');
    }, 1800);
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
      this.camera.position.set(Math.sin(this.menuT * 0.2) * 4 + 18, 30, 18);
      this.camera.lookAt(0, 0, 0);
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
      // Screen directions → world: the camera looks across the realm at 45°.
      const m = this.input.move;
      const c = Math.cos(CAM_YAW);
      const s = Math.sin(CAM_YAW);
      this.moveWorld.x = m.x * c + m.y * s;
      this.moveWorld.y = -m.x * s + m.y * c;
      run.update(dt, this.moveWorld);
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
        ? this.look.set(Math.sin(this.menuT * 0.2) * 6, 0, Math.cos(this.menuT * 0.15) * 5)
        : this.look.copy(run.heroPos).addScaledVector(run.heroVel, 0.28);
    this.camFocus.lerp(follow, Math.min(1, dt * 4.5));
    const shake = this.fx.shake;
    // Pull back a little as the army grows.
    const army = this.state === 'playing' ? Math.min(1, run.units.length / 30) : 0;
    this.camArmy += (army - this.camArmy) * Math.min(1, dt);
    const dist = (CAM_DIST + this.camArmy * 3) * zoom;
    this.camera.position.set(
      this.camFocus.x + Math.sin(CAM_YAW) * dist * Math.cos(CAM_PITCH) + (Math.random() - 0.5) * shake * 0.6,
      dist * Math.sin(CAM_PITCH),
      this.camFocus.z + Math.cos(CAM_YAW) * dist * Math.cos(CAM_PITCH) + (Math.random() - 0.5) * shake * 0.6,
    );
    this.camera.lookAt(this.camFocus.x, 0, this.camFocus.z);
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
  private moveWorld = { x: 0, y: 0 };
  private camArmy = 0;
  /** Playtest hook: pin the camera somewhere specific. */
  debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
}

const game = new Game();
// Exposed for automated playtests (harmless in production).
(window as unknown as { __hg: Game }).__hg = game;
