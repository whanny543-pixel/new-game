// Entry point: wires menus, game, renderer, HUD, input and audio into one loop.
import { Game, type GameSettings } from './game/game';
import { SceneView } from './render/scene';
import { Controller } from './ui/controller';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { Menus } from './ui/menus';
import { Overlay } from './ui/overlay';
import { AudioSys } from './audio';
import { POWERS } from './core/data';
import './style.css';

class App {
  private canvas = document.getElementById('c') as HTMLCanvasElement;
  private overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
  private hudRoot = document.getElementById('hud')!;
  private menus = new Menus();
  private audio = new AudioSys();
  private overlay = new Overlay(this.overlayCanvas);
  private game: Game | null = null;
  private scene: SceneView | null = null;
  private ctl: Controller | null = null;
  private hud: Hud | null = null;
  private input: Input | null = null;
  private last = performance.now();
  private paused = false;
  private settings: GameSettings | null = null;
  private ended = false;

  constructor() {
    this.menus.onStart = (s) => this.start(s);
    this.menus.onPrefs = (p) => this.applyPrefs(p);
    this.menus.onResume = () => this.resume();
    this.menus.onQuit = () => this.quit();
    this.menus.onRestart = () => this.settings && this.start(this.settings);
    this.applyPrefs(this.menus.prefs);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game && !this.paused) this.pause();
    });
    document.body.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    requestAnimationFrame((t) => this.frame(t));
  }

  private applyPrefs(p: { sound: boolean; eva: boolean; shadows: boolean; music: boolean }) {
    this.audio.enabled = p.sound;
    this.audio.evaEnabled = p.eva;
    this.audio.musicEnabled = p.music;
    this.audio.music(!!this.game && !this.paused);
    if (this.scene) this.scene.renderer.shadowMap.enabled = p.shadows && this.scene.quality === 'high';
  }

  private resize() {
    this.scene?.resize();
    this.overlay.resize();
  }

  private start(settings: GameSettings) {
    this.cleanup();
    this.settings = settings;
    this.ended = false;
    this.paused = false;
    const game = new Game(settings);
    const viewer = game.human!;
    const scene = new SceneView(this.canvas, game, viewer);
    scene.renderer.shadowMap.enabled = this.menus.prefs.shadows;
    const ctl = new Controller(game, scene, viewer, this.audio);
    const hud = new Hud(this.hudRoot, ctl);
    hud.onPause = () => this.pause();
    const input = new Input(this.canvas, ctl);
    this.audio.onEva = (msg) => hud.eva(msg);
    this.game = game;
    this.scene = scene;
    this.ctl = ctl;
    this.hud = hud;
    this.input = input;
    this.menus.show('none');
    this.resize();
    (window as unknown as { __app: unknown }).__app = { game, scene, ctl, hud };
    this.audio.unlock();
    this.audio.music(true);
    hud.onSpeed = () => {
      ctl.speed = ctl.speed >= 2 ? 1 : ctl.speed + 0.5;
      hud.toast('Game speed ' + ctl.speed + '×');
    };
    setTimeout(() => this.audio.eva('Battle control online'), 600);
    hud.toast('Tap a dozer, then a building to start construction', 'info');
  }

  private cleanup() {
    this.audio.music(false);
    this.input?.dispose();
    this.hud?.dispose();
    this.scene?.dispose();
    this.game = null;
    this.scene = null;
    this.ctl = null;
    this.hud = null;
    this.input = null;
  }

  private pause() {
    if (!this.game || this.ended) return;
    this.paused = true;
    this.audio.music(false);
    this.menus.show('pause');
  }
  private resume() {
    this.paused = false;
    this.audio.music(true);
    this.menus.show('none');
    this.last = performance.now();
  }
  private quit() {
    this.cleanup();
    this.paused = false;
    this.menus.show('main');
  }

  private frame(t: number) {
    requestAnimationFrame((tt) => this.frame(tt));
    let dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const game = this.game, scene = this.scene, ctl = this.ctl, hud = this.hud, input = this.input;
    if (!game || !scene || !ctl || !hud || !input) return;
    if (this.paused) dt = 0;
    if (dt > 0) {
      input.tick(dt);
      // Simulate in small fixed steps so fast projectiles stay accurate.
      let acc = dt * ctl.speed;
      while (acc > 0) {
        const step = Math.min(acc, 1 / 30);
        game.tick(step);
        acc -= step;
      }
      ctl.prune();
      this.audio.listenerX = scene.focus.x;
      this.audio.listenerY = scene.focus.y;
      for (const ev of game.events) {
        switch (ev.kind) {
          case 'eva':
            if (ev.player === ctl.viewer) this.audio.eva(ev.msg);
            break;
          case 'sound':
            this.audio.play(ev.name, ev.x, ev.y);
            break;
          case 'rankup':
            if (ev.player === ctl.viewer) this.audio.play('rankup');
            break;
          case 'power':
            if (ev.player === ctl.viewer) hud.toast(POWERS[ev.id]?.name + ' deployed');
            break;
          case 'superweapon':
            if (ev.player !== ctl.viewer) ctl.lastAlert = { x: ev.x, y: ev.y };
            break;
          case 'captured':
            if (ev.entity.owner === ctl.viewer) this.audio.play('complete');
            break;
          default:
            scene.effects.handle(ev);
        }
      }
      game.events.length = 0;
      if (game.result.over && !this.ended) {
        this.ended = true;
        const won = game.result.winner === ctl.viewer.team;
        this.audio.eva(won ? 'Mission accomplished' : 'Mission failed');
        setTimeout(() => {
          const s = ctl.viewer.stats;
          this.menus.showResult(won, { killed: s.killed, lost: s.lost, built: s.built, time: game.time });
        }, 2500);
      }
    }
    const b = ctl.selectedBuilding();
    scene.update(dt, ctl.viewer, ctl.selection, ctl.mode.kind === 'build' ? ctl.ghost : null, b && b.owner === ctl.viewer ? b.rally : null);
    scene.render();
    scene.autoQuality(dt);
    let ring: { x: number; y: number; r: number } | null = null;
    if (ctl.mode.kind === 'power' && ctl.hover) ring = { x: ctl.hover.x, y: ctl.hover.y, r: POWERS[ctl.mode.id].radius || 2 };
    if (ctl.mode.kind === 'superweapon' && ctl.hover) ring = { x: ctl.hover.x, y: ctl.hover.y, r: ctl.mode.building.bdef!.superweapon!.kind === 'nuke' ? 9.5 : 4.5 };
    this.overlay.draw(game, scene, ctl.viewer, ctl.selection, input.marquee, scene.effects.screenFlash, ring);
    hud.update(dt);
  }
}

new App();
