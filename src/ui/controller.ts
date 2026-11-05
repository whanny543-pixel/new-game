// Turns taps, drags and HUD buttons into game commands. Owns selection, modes and the camera.
import { BUILDINGS, FACTIONS, UNITS } from '../core/data';
import { clamp, dist } from '../core/math';
import type { SupplyDock } from '../core/map';
import type { Entity, Player, BattlePlan } from '../game/entity';
import type { Game } from '../game/game';
import type { Ghost, SceneView } from '../render/scene';
import type { AudioSys } from '../audio';
import type { InputHandler } from './input';

export type Mode =
  | { kind: 'normal' }
  | { kind: 'attackmove' }
  | { kind: 'capture' }
  | { kind: 'rally' }
  | { kind: 'repair' }
  | { kind: 'enter' }
  | { kind: 'build'; defId: string; builder: Entity | null }
  | { kind: 'power'; id: string }
  | { kind: 'superweapon'; building: Entity };

export class Controller implements InputHandler {
  game: Game;
  scene: SceneView;
  viewer: Player;
  audio: AudioSys;
  selection = new Set<Entity>();
  mode: Mode = { kind: 'normal' };
  groups: Entity[][] = [[], [], [], [], []];
  ghost: Ghost | null = null;
  hover: { x: number; y: number } | null = null;
  isTouch = true;
  speed = 1;
  paused = false;
  toast: (msg: string, kind?: 'info' | 'error') => void = () => {};
  /** Set by the HUD when the selection should be re-read. */
  selectionVersion = 0;
  lastAlert: { x: number; y: number } | null = null;

  constructor(game: Game, scene: SceneView, viewer: Player, audio: AudioSys) {
    this.game = game;
    this.scene = scene;
    this.viewer = viewer;
    this.audio = audio;
  }

  // ------------------------------------------------------------ selection
  selectedUnits() {
    return [...this.selection].filter((e) => e.isUnit && !e.dead && e.owner === this.viewer);
  }
  selectedBuilding(): Entity | null {
    for (const e of this.selection) if (e.isBuilding && !e.dead) return e;
    return null;
  }
  select(list: Entity[]) {
    this.selection.clear();
    for (const e of list) if (!e.dead) this.selection.add(e);
    this.selectionVersion++;
    if (list.length) this.audio.play('click');
  }
  clearSelection() {
    this.selection.clear();
    this.selectionVersion++;
  }
  prune() {
    let changed = false;
    for (const e of this.selection) if (e.dead || (e.owner !== this.viewer && !e.isBuilding)) {
      this.selection.delete(e);
      changed = true;
    }
    if (changed) this.selectionVersion++;
    for (const g of this.groups) {
      const n = g.length;
      for (let i = g.length - 1; i >= 0; i--) if (g[i].dead) g.splice(i, 1);
      if (g.length !== n) this.selectionVersion++;
    }
    if (this.mode.kind === 'superweapon' && this.mode.building.dead) this.setMode({ kind: 'normal' });
    if (this.mode.kind === 'build' && this.mode.builder?.dead) this.mode = { ...this.mode, builder: null };
  }
  selectAllOfType(e: Entity) {
    const id = e.udef?.id ?? e.bdef?.id;
    const list = this.game.entities.filter((o) => !o.dead && o.owner === this.viewer && (o.udef?.id ?? o.bdef?.id) === id && o.kind === e.kind);
    // Only the ones on screen.
    const onScreen = list.filter((o) => {
      const p = this.scene.worldToScreen(o.x, o.y, o.z);
      return p.visible && p.x >= 0 && p.y >= 0 && p.x <= window.innerWidth && p.y <= window.innerHeight;
    });
    this.select(onScreen.length ? onScreen : list);
  }
  selectAllArmy() {
    const list = this.game.unitsOf(this.viewer, (u) => u.weapons.length > 0 && !u.udef!.builder && !u.udef!.gather && !u.udef!.hack && !(u.udef!.jet && u.jetState === 'parked'));
    this.select(list);
    if (!list.length) this.toast('No combat units');
  }
  filterSelection(defId: string) {
    this.select(this.selectedUnits().filter((u) => u.udef!.id === defId));
  }
  selectGroup(i: number) {
    const g = this.groups[i].filter((e) => !e.dead);
    if (!g.length) return;
    this.select(g);
    if (this.selection.size) {
      const e = g[0];
      if (this.lastGroup === i && performance.now() - this.lastGroupTime < 400) this.jumpTo(e.x, e.y);
      this.lastGroup = i;
      this.lastGroupTime = performance.now();
    }
  }
  private lastGroup = -1;
  private lastGroupTime = 0;
  assignGroup(i: number) {
    const units = this.selectedUnits();
    if (!units.length) return;
    for (const g of this.groups) for (const u of units) {
      const k = g.indexOf(u);
      if (k >= 0) g.splice(k, 1);
    }
    for (const u of this.groups[i]) u.groupId = -1;
    this.groups[i] = units.slice();
    for (const u of units) u.groupId = i;
    this.selectionVersion++;
    this.toast(`Group ${i} set (${units.length})`);
  }

  // ------------------------------------------------------------ modes
  setMode(m: Mode) {
    this.mode = m;
    if (m.kind !== 'build') this.ghost = null;
    this.selectionVersion++;
  }
  cancelMode() {
    if (this.mode.kind === 'normal') {
      this.clearSelection();
      return;
    }
    this.setMode({ kind: 'normal' });
  }
  get modeHint(): string | null {
    switch (this.mode.kind) {
      case 'attackmove': return 'Tap where to attack-move';
      case 'capture': return 'Tap a building to capture';
      case 'rally': return 'Tap where new units should gather';
      case 'repair': return 'Tap a structure to repair';
      case 'enter': return 'Tap a tunnel to enter';
      case 'build': return this.ghost ? (this.ghost.valid ? (this.isTouch ? 'Tap again or press Build to place' : 'Click to place') : 'Cannot build there') : 'Tap where to build';
      case 'power': return 'Tap the target for ' + (this.viewer.powers.get(this.mode.id)?.def.name ?? 'the power');
      case 'superweapon': return this.viewer.lance ? 'Tap to steer the beam' : 'Tap the target';
      default: return null;
    }
  }

  enterBuildMode(defId: string, builder: Entity | null) {
    const def = BUILDINGS[defId];
    if (!def) return;
    const blocker = this.game.buildBlocker(this.viewer, def);
    if (blocker) {
      this.toast(blocker, 'error');
      return;
    }
    if (this.viewer.money < def.cost) {
      this.toast('Insufficient funds', 'error');
      this.audio.play('error');
      return;
    }
    this.mode = { kind: 'build', defId, builder };
    // Start the ghost near the builder, or at the camera focus.
    const bx = builder ? builder.x : this.scene.focus.x, by = builder ? builder.y + 3 : this.scene.focus.y;
    this.placeGhost(bx, by);
    this.selectionVersion++;
  }
  placeGhost(x: number, y: number) {
    if (this.mode.kind !== 'build') return;
    const def = BUILDINGS[this.mode.defId];
    const [w, h] = def.size;
    const cx = clamp(Math.round(x - w / 2), 0, this.game.map.w - w), cy = clamp(Math.round(y - h / 2), 0, this.game.map.h - h);
    const valid = this.game.map.canPlace(cx, cy, w, h);
    this.ghost = { defId: def.id, cx, cy, w, h, valid };
  }
  confirmBuild() {
    if (this.mode.kind !== 'build' || !this.ghost) return;
    if (!this.ghost.valid) {
      this.toast('Cannot build there', 'error');
      this.audio.play('error');
      return;
    }
    const builder = this.mode.builder && !this.mode.builder.dead ? this.mode.builder : null;
    const err = this.game.cmdBuild(this.viewer, builder, this.ghost.defId, this.ghost.cx, this.ghost.cy);
    if (err) {
      this.toast(err, 'error');
      this.audio.play('error');
      return;
    }
    this.audio.play('place');
    this.setMode({ kind: 'normal' });
  }

  // ------------------------------------------------------------ HUD actions
  queue(id: string) {
    const b = this.selectedBuilding();
    if (!b) return;
    const err = this.game.cmdQueue(b, id);
    if (err) {
      this.toast(err, 'error');
      this.audio.play('error');
    } else this.audio.play('click');
  }
  cancelQueue(i: number) {
    const b = this.selectedBuilding();
    if (b) this.game.cmdCancel(b, i);
  }
  sell() {
    const b = this.selectedBuilding();
    if (!b || b.owner !== this.viewer) return;
    this.game.cmdSell(b);
    this.clearSelection();
  }
  stop() {
    this.game.cmdStop(this.selectedUnits(), this.viewer);
    this.audio.play('click');
  }
  deploy() {
    this.game.cmdDeploy(this.selectedUnits(), this.viewer);
  }
  detonate() {
    this.game.cmdDetonate(this.selectedUnits(), this.viewer);
  }
  gather() {
    this.game.cmdGather(this.selectedUnits(), null, this.viewer);
  }
  exitTunnel() {
    const b = this.selectedBuilding();
    if (b && b.bdef?.tunnel) this.game.cmdExitTunnel(b);
  }
  setPlan(plan: BattlePlan) {
    this.game.cmdPlan(this.viewer, plan);
    this.toast('Battle plan: ' + (plan === 'bombard' ? 'Bombardment (+damage)' : plan === 'hold' ? 'Hold the Line (+armor)' : 'Search & Destroy (+sight)'));
    this.selectionVersion++;
  }
  usePower(id: string) {
    const ps = this.viewer.powers.get(id);
    if (!ps) return;
    if (ps.level <= 0) {
      this.toast('Not unlocked. Spend a generals point first.', 'error');
      return;
    }
    if (ps.cooldown > 0) {
      this.toast(ps.def.name + ' is recharging', 'error');
      return;
    }
    if (ps.def.target === 'none') {
      const err = this.game.cmdPower(this.viewer, id, 0, 0);
      if (err) this.toast(err, 'error');
      else this.audio.play('cash');
      return;
    }
    this.setMode({ kind: 'power', id });
  }
  buyPower(id: string) {
    if (this.game.cmdBuyPower(this.viewer, id)) {
      this.audio.play('promote');
      this.selectionVersion++;
    } else this.toast('Cannot unlock that yet', 'error');
  }
  superweapon(b: Entity) {
    if (b.dead) return;
    if (this.viewer.lance && b.bdef!.superweapon?.kind === 'lance') {
      this.setMode({ kind: 'superweapon', building: b });
      return;
    }
    if (!b.swReady) {
      this.toast('Charging: ' + Math.ceil(b.swTimer) + 's', 'error');
      return;
    }
    this.setMode({ kind: 'superweapon', building: b });
  }
  focusBase() {
    const cc = this.game.buildingsOf(this.viewer, (b) => !!b.bdef!.command)[0] ?? this.game.buildingsOf(this.viewer)[0];
    if (cc) this.jumpTo(cc.x, cc.y + 3);
  }
  jumpTo(x: number, y: number) {
    this.scene.focus.x = clamp(x, 0, this.game.map.w);
    this.scene.focus.y = clamp(y, 0, this.game.map.h);
  }
  jumpToAlert() {
    if (this.game.time - this.viewer.lastAttackedAt < 30) this.jumpTo(this.viewer.lastAttackX, this.viewer.lastAttackY);
  }

  // ------------------------------------------------------------ input handler
  private dockAt(x: number, y: number): SupplyDock | null {
    for (const d of this.game.map.docks) if (d.amount > 0 && dist(d.x + 1, d.y + 1, x, y) < 2.2) return d;
    return null;
  }

  onTap(x: number, y: number, double: boolean, button: number) {
    this.audio.unlock();
    const pt = this.scene.screenToGround(x, y);
    const ent = this.scene.pickEntity(x, y, this.viewer, 30);
    const m = this.mode;
    switch (m.kind) {
      case 'build': {
        if (!pt) return;
        const g = this.ghost;
        const def = BUILDINGS[m.defId];
        const cx = clamp(Math.round(pt.x - def.size[0] / 2), 0, this.game.map.w), cy = clamp(Math.round(pt.y - def.size[1] / 2), 0, this.game.map.h);
        if (button === 2) {
          this.setMode({ kind: 'normal' });
          return;
        }
        if (g && Math.abs(g.cx - cx) <= 1 && Math.abs(g.cy - cy) <= 1 && g.valid) this.confirmBuild();
        else {
          this.placeGhost(pt.x, pt.y);
          if (!this.isTouch && this.ghost?.valid) this.confirmBuild();
        }
        return;
      }
      case 'power': {
        if (!pt) return;
        const err = this.game.cmdPower(this.viewer, m.id, pt.x, pt.y);
        if (err) this.toast(err, 'error');
        this.setMode({ kind: 'normal' });
        return;
      }
      case 'superweapon': {
        if (!pt) return;
        this.game.cmdSuperweapon(m.building, pt.x, pt.y);
        this.setMode({ kind: 'normal' });
        return;
      }
      case 'attackmove':
        if (pt) this.game.cmdMove(this.selectedUnits(), pt.x, pt.y, true, this.viewer);
        this.setMode({ kind: 'normal' });
        return;
      case 'capture':
        if (ent && ent.isBuilding && ent.owner !== this.viewer) this.game.cmdCapture(this.selectedUnits(), ent, this.viewer);
        else this.toast('Tap an enemy or neutral structure', 'error');
        this.setMode({ kind: 'normal' });
        return;
      case 'repair':
        if (ent && ent.isBuilding && ent.owner === this.viewer) this.game.cmdRepair(this.selectedUnits(), ent, this.viewer);
        this.setMode({ kind: 'normal' });
        return;
      case 'enter':
        if (ent && ent.bdef?.tunnel && ent.owner === this.viewer) this.game.cmdEnterTunnel(this.selectedUnits(), ent, this.viewer);
        this.setMode({ kind: 'normal' });
        return;
      case 'rally': {
        const b = this.selectedBuilding();
        if (b && pt) this.game.cmdRally(b, pt.x, pt.y);
        this.setMode({ kind: 'normal' });
        return;
      }
      default:
        break;
    }
    if (button === 2) {
      this.command(ent, pt);
      return;
    }
    if (ent && ent.owner === this.viewer) {
      if (double) this.selectAllOfType(ent);
      else this.select([ent]);
      return;
    }
    const units = this.selectedUnits();
    if (units.length) {
      if (double && !ent) {
        this.clearSelection();
        return;
      }
      this.command(ent, pt);
      return;
    }
    if (ent) {
      // Look at an enemy or neutral thing.
      this.select([ent]);
      return;
    }
    this.clearSelection();
  }

  /** Issue a context command for the selected units. */
  private command(ent: Entity | null, pt: { x: number; y: number } | null) {
    const units = this.selectedUnits();
    if (!units.length) return;
    const game = this.game;
    if (ent) {
      if (ent.kind === 'crate') {
        const sv = units.filter((u) => u.udef!.salvage);
        if (sv.length) game.cmdSalvage(sv, ent, this.viewer);
        const rest = units.filter((u) => !u.udef!.salvage);
        if (rest.length) game.cmdMove(rest, ent.x, ent.y);
        return;
      }
      if (ent.owner.id >= 0 && ent.owner.team !== this.viewer.team) {
        const attackers = units.filter((u) => u.weapons.length);
        if (attackers.length) game.cmdAttack(attackers, ent, this.viewer);
        else {
          const cap = units.filter((u) => u.udef!.capture && ent.isBuilding);
          if (cap.length) game.cmdCapture(cap, ent, this.viewer);
          else game.cmdMove(units, ent.x, ent.y);
        }
        return;
      }
      if (ent.owner.id < 0 && ent.isBuilding) {
        const cap = units.filter((u) => u.udef!.capture);
        if (cap.length) {
          game.cmdCapture(cap, ent, this.viewer);
          this.toast('Capturing ' + ent.name);
        } else this.toast('Only infantry can capture', 'error');
        const rest = units.filter((u) => !u.udef!.capture);
        if (rest.length) game.cmdMove(rest, ent.x, ent.y + ent.h / 2 + 1.5);
        return;
      }
      // Friendly.
      if (ent.isBuilding) {
        const builders = units.filter((u) => u.udef!.builder);
        const gatherers = units.filter((u) => u.udef!.gather && !u.udef!.builder);
        const rest = units.filter((u) => !u.udef!.builder && !(u.udef!.gather && !u.udef!.builder));
        if (builders.length) {
          if (!ent.built) for (const b of builders) game.cmdBuildSite(b, ent);
          else if (ent.hp < ent.maxHp) game.cmdRepair(builders, ent, this.viewer);
          else if (ent.bdef!.depot && ent.owner === this.viewer && builders[0].udef!.gather) game.cmdGather(builders, null, this.viewer);
          else game.cmdMove(builders, ent.x, ent.y + ent.h / 2 + 1.5);
        }
        if (gatherers.length) {
          if (ent.bdef!.depot) game.cmdGather(gatherers, null, this.viewer);
          else game.cmdMove(gatherers, ent.x, ent.y + ent.h / 2 + 1.5);
        }
        if (rest.length) {
          if (ent.bdef!.tunnel && ent.owner === this.viewer) game.cmdEnterTunnel(rest.filter((u) => !u.isAir), ent, this.viewer);
          else game.cmdMove(rest, ent.x, ent.y + ent.h / 2 + 1.5);
        }
        return;
      }
      game.cmdMove(units, ent.x, ent.y);
      return;
    }
    if (!pt) return;
    const dock = this.dockAt(pt.x, pt.y);
    if (dock) {
      const g = units.filter((u) => u.udef!.gather);
      if (g.length) {
        game.cmdGather(g, dock, this.viewer);
        this.toast('Gathering supplies');
      }
      const rest = units.filter((u) => !u.udef!.gather);
      if (rest.length) game.cmdMove(rest, pt.x, pt.y);
      return;
    }
    game.cmdMove(units, pt.x, pt.y);
  }

  onMarquee(x0: number, y0: number, x1: number, y1: number) {
    if (this.mode.kind !== 'normal') {
      this.setMode({ kind: 'normal' });
    }
    const list = this.scene.entitiesInRect(x0, y0, x1, y1, this.viewer);
    if (!list.length) return;
    const combat = list.filter((u) => u.weapons.length > 0 && !u.udef!.builder && !u.udef!.gather && !u.udef!.hack);
    this.select(combat.length ? combat : list);
  }
  onLongPress() {
    if (navigator.vibrate) navigator.vibrate(10);
  }
  onPan(dx: number, dy: number) {
    const k = (this.scene.zoom / window.innerHeight) * 1.45;
    this.scene.focus.x = clamp(this.scene.focus.x - dx * k, 0, this.game.map.w);
    this.scene.focus.y = clamp(this.scene.focus.y - dy * k, 0, this.game.map.h);
  }
  onZoom(f: number) {
    this.scene.zoom = clamp(this.scene.zoom * f, 14, 64);
  }
  onHover(x: number, y: number) {
    this.isTouch = false;
    const pt = this.scene.screenToGround(x, y);
    this.hover = pt;
    if (this.mode.kind === 'build' && pt) this.placeGhost(pt.x, pt.y);
  }
  onKey(key: string, down: boolean, e: KeyboardEvent) {
    if (!down) return;
    const k = key.toLowerCase();
    if (k === 'escape') this.cancelMode();
    else if (k === 'a' && !e.ctrlKey && !e.metaKey && this.selectedUnits().length) this.setMode({ kind: 'attackmove' });
    else if (k === 's' && !e.ctrlKey && this.selectedUnits().length) this.stop();
    else if (k === 'h') this.focusBase();
    else if (k === 'f' && !e.ctrlKey) this.selectAllArmy();
    else if (k === ' ') {
      e.preventDefault();
      this.jumpToAlert();
    } else if (/^[1-4]$/.test(k)) {
      if (e.ctrlKey || e.shiftKey || e.metaKey) {
        e.preventDefault();
        this.assignGroup(Number(k));
      } else this.selectGroup(Number(k));
    } else if (k === 'delete' || k === 'backspace') {
      const b = this.selectedBuilding();
      if (b && b.owner === this.viewer) this.sell();
    }
  }

  /** Expose the faction tables for the HUD. */
  get faction() {
    return FACTIONS[this.viewer.faction];
  }
  unitDef(id: string) {
    return UNITS[id];
  }
}
