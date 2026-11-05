// All faction content: units, buildings, upgrades and generals powers. Everything the game
// knows about what a thing is lives here; the engine only reads these tables.
import type {
  ArmorType, BuildingDef, DamageType, FactionDef, FactionId, PowerDef, UnitDef, UpgradeDef, WeaponDef,
} from './types';

/** Damage multiplier for each damage type against each armour class. */
export const ARMOR: Record<DamageType, Record<ArmorType, number>> = {
  gun:       { infantry: 1.0, light: 0.45, tank: 0.2, air: 0.3, structure: 0.12, hero: 0.6 },
  cannon:    { infantry: 0.5, light: 1.0, tank: 1.0, air: 0, structure: 0.65, hero: 0.5 },
  rocket:    { infantry: 0.3, light: 1.0, tank: 1.0, air: 1.0, structure: 0.8, hero: 0.3 },
  explosion: { infantry: 1.0, light: 0.8, tank: 0.5, air: 0.5, structure: 1.0, hero: 0.6 },
  flame:     { infantry: 1.6, light: 0.6, tank: 0.3, air: 0, structure: 0.9, hero: 1.0 },
  sniper:    { infantry: 12, light: 0.15, tank: 0.05, air: 0, structure: 0.02, hero: 12 },
  laser:     { infantry: 1.0, light: 1.0, tank: 0.8, air: 1.2, structure: 0.4, hero: 0.8 },
  toxin:     { infantry: 1.6, light: 0.25, tank: 0.08, air: 0, structure: 0.1, hero: 1.0 },
  aa:        { infantry: 1.2, light: 0.45, tank: 0.15, air: 1.6, structure: 0.1, hero: 0.8 },
  bomb:      { infantry: 1.0, light: 1.0, tank: 1.0, air: 0, structure: 1.3, hero: 0.8 },
  crush:     { infantry: 50, light: 0, tank: 0, air: 0, structure: 0, hero: 0 },
};

/** XP needed for each veterancy chevron. */
export const VET_XP = [0, 100, 300, 700];
export const VET_DAMAGE = [1, 1.2, 1.4, 1.6];
export const VET_ARMOR = [1, 1.1, 1.2, 1.35];

/** General's rank thresholds (XP earned by destroying things) and points per rank. */
export const RANK_XP = [0, 600, 1800, 4000, 8000];
export const RANK_POINTS = [1, 1, 1, 1, 2];

export const START_CASH = [5000, 10000, 20000, 50000];

const rifle = (damage: number, range = 6, cooldown = 0.6): WeaponDef => ({
  damage, type: 'gun', range, cooldown, projectile: 'instant',
});
const rockets = (damage: number, range = 8, cooldown = 2): WeaponDef => ({
  damage, type: 'rocket', range, cooldown, projectile: 'rocket', air: true, speed: 14, splash: 0.4,
});
const cannon = (damage: number, range = 7, cooldown = 2.2): WeaponDef => ({
  damage, type: 'cannon', range, cooldown, projectile: 'shell', splash: 0.6, speed: 24,
});

// ----------------------------------------------------------------------------------------------
// COALITION — high tech, expensive, air power. Mirrors the "rich superpower" playstyle.
// ----------------------------------------------------------------------------------------------
const coalitionUnits: UnitDef[] = [
  {
    id: 'c_dozer', name: 'Dozer', faction: 'coalition', cost: 1000, buildTime: 8, hp: 260, armor: 'light',
    speed: 3.2, move: 'vehicle', radius: 0.7, sight: 6, weapons: [], producedAt: 'c_command', icon: 'dozer',
    model: 'dozer', builder: true, desc: 'Constructs and repairs structures.',
  },
  {
    id: 'c_lifter', name: 'Supply Lifter', faction: 'coalition', cost: 1200, buildTime: 12, hp: 450, armor: 'air',
    speed: 6.5, move: 'air', altitude: 5, radius: 1.2, sight: 7, weapons: [], producedAt: 'c_supply', icon: 'heli',
    model: 'chinook', gather: 400, desc: 'Heavy-lift helicopter. Hauls $400 of supplies per trip.',
  },
  {
    id: 'c_rifleman', name: 'Rifleman', faction: 'coalition', cost: 225, buildTime: 5, hp: 130, armor: 'infantry',
    speed: 2.2, move: 'infantry', radius: 0.3, sight: 7, weapons: [rifle(11)], producedAt: 'c_barracks',
    icon: 'infantry', model: 'soldier', capture: true, desc: 'Basic rifle infantry. Can capture structures.',
  },
  {
    id: 'c_rocket', name: 'Rocket Trooper', faction: 'coalition', cost: 300, buildTime: 6, hp: 100,
    armor: 'infantry', speed: 2.0, move: 'infantry', radius: 0.3, sight: 8, weapons: [rockets(42)],
    producedAt: 'c_barracks', icon: 'rocketinf', model: 'rocketsoldier',
    desc: 'Shoulder-launched missiles. Strong against vehicles and aircraft.',
  },
  {
    id: 'c_pathfinder', name: 'Pathfinder', faction: 'coalition', cost: 600, buildTime: 8, hp: 100,
    armor: 'infantry', speed: 2.3, move: 'infantry', radius: 0.3, sight: 11,
    weapons: [{ damage: 120, type: 'sniper', range: 10, cooldown: 2.5, projectile: 'instant' }],
    producedAt: 'c_barracks', prereq: ['c_strategy'], icon: 'sniper', model: 'sniper', stealth: true, detector: true,
    desc: 'Stealth sniper. One shot, one kill against infantry. Detects stealth.',
  },
  {
    id: 'c_jackal', name: 'Jackal', faction: 'coalition', cost: 700, buildTime: 8, hp: 300, armor: 'light',
    speed: 6, move: 'vehicle', radius: 0.8, sight: 8, weapons: [rifle(13, 7, 0.35)], producedAt: 'c_factory',
    icon: 'truck', model: 'humvee', crush: true, desc: 'Fast scout car with a heavy machine gun.',
  },
  {
    id: 'c_bulwark', name: 'Bulwark Tank', faction: 'coalition', cost: 900, buildTime: 10, hp: 500, armor: 'tank',
    speed: 3.6, move: 'vehicle', radius: 0.9, sight: 8, weapons: [cannon(62)], producedAt: 'c_factory',
    icon: 'tank', model: 'tank', crush: true, desc: 'Main battle tank. Crushes infantry.',
  },
  {
    id: 'c_guardian', name: 'Guardian', faction: 'coalition', cost: 1100, buildTime: 12, hp: 580, armor: 'tank',
    speed: 3.2, move: 'vehicle', radius: 0.95, sight: 8,
    weapons: [cannon(62), { damage: 16, type: 'laser', range: 6, cooldown: 0.5, projectile: 'laser', air: true, ground: false }],
    producedAt: 'c_factory', prereq: ['c_strategy'], icon: 'heavytank', model: 'paladin', crush: true,
    desc: 'Heavy tank with a point-defence laser that burns aircraft out of the sky.',
  },
  {
    id: 'c_javelin', name: 'Javelin Launcher', faction: 'coalition', cost: 1200, buildTime: 12, hp: 220,
    armor: 'light', speed: 3.2, move: 'vehicle', radius: 0.9, sight: 9,
    weapons: [{ damage: 160, type: 'rocket', range: 17, minRange: 5, cooldown: 6, projectile: 'rocket', splash: 1.6, speed: 10 }],
    producedAt: 'c_factory', icon: 'artillery', model: 'tomahawk',
    desc: 'Long-range cruise missile artillery. Keep it behind the line.',
  },
  {
    id: 'c_raptor', name: 'Raptor Gunship', faction: 'coalition', cost: 1500, buildTime: 16, hp: 420, armor: 'air',
    speed: 7, move: 'air', altitude: 7, radius: 1.0, sight: 9,
    weapons: [rifle(9, 7, 0.25), { damage: 34, type: 'rocket', range: 8, cooldown: 3, projectile: 'rocket', splash: 0.8, speed: 14 }],
    producedAt: 'c_airfield', icon: 'heli', model: 'gunship', desc: 'Attack helicopter. Hovers and fires rockets and chain gun.',
  },
  {
    id: 'c_falcon', name: 'Falcon', faction: 'coalition', cost: 1400, buildTime: 14, hp: 300, armor: 'air',
    speed: 15, move: 'air', altitude: 9, radius: 1.0, sight: 10, jet: true,
    weapons: [{ damage: 95, type: 'rocket', range: 9, cooldown: 0.4, projectile: 'rocket', clip: 4, speed: 22, splash: 0.6 }],
    producedAt: 'c_airfield', icon: 'jet', model: 'jet', desc: 'Strike fighter. Four missiles per sortie, then rearms.',
  },
  {
    id: 'c_spectre', name: 'Spectre Bomber', faction: 'coalition', cost: 2500, buildTime: 24, hp: 340, armor: 'air',
    speed: 17, move: 'air', altitude: 10, radius: 1.2, sight: 10, jet: true,
    weapons: [{ damage: 650, type: 'bomb', range: 3, cooldown: 1, projectile: 'bomb', clip: 1, splash: 3.2 }],
    producedAt: 'c_airfield', prereq: ['c_strategy'], icon: 'bomber', model: 'bomber',
    desc: 'Supersonic bomber. One devastating fuel-air bomb per sortie.',
  },
];

const coalitionBuildings: BuildingDef[] = [
  {
    id: 'c_command', name: 'Command Center', faction: 'coalition', cost: 2000, buildTime: 30, hp: 3000, power: 0,
    size: [6, 6], sight: 12, icon: 'building', model: 'command', produces: ['c_dozer'], command: true, detector: true,
    desc: 'Heart of your base. Builds dozers and enables generals powers.',
  },
  {
    id: 'c_reactor', name: 'Fusion Reactor', faction: 'coalition', cost: 800, buildTime: 10, hp: 800, power: 5,
    size: [4, 4], sight: 6, icon: 'power', model: 'reactor', upgrades: ['c_rods'], desc: 'Provides 5 power.',
  },
  {
    id: 'c_barracks', name: 'Barracks', faction: 'coalition', cost: 600, buildTime: 10, hp: 1000, power: -1,
    size: [4, 4], sight: 7, icon: 'barracks', model: 'barracks', produces: ['c_rifleman', 'c_rocket', 'c_pathfinder'],
    desc: 'Trains infantry.',
  },
  {
    id: 'c_supply', name: 'Supply Center', faction: 'coalition', cost: 2000, buildTime: 14, hp: 1200, power: -1,
    size: [5, 5], sight: 7, icon: 'supply', model: 'supply', produces: ['c_lifter'], depot: true, freeUnits: ['c_lifter'],
    desc: 'Supply depot. Comes with one Supply Lifter.',
  },
  {
    id: 'c_factory', name: 'War Factory', faction: 'coalition', cost: 2000, buildTime: 18, hp: 1500, power: -1,
    size: [6, 5], sight: 7, icon: 'factory', model: 'factory',
    produces: ['c_dozer', 'c_jackal', 'c_bulwark', 'c_guardian', 'c_javelin'], upgrades: ['c_composite'],
    desc: 'Builds vehicles. Repairs vehicles parked beside it.',
  },
  {
    id: 'c_airfield', name: 'Airfield', faction: 'coalition', cost: 1000, buildTime: 14, hp: 1200, power: -1,
    size: [7, 6], sight: 8, icon: 'airfield', model: 'airfield', produces: ['c_raptor', 'c_falcon', 'c_spectre'],
    airfield: true, desc: 'Builds and rearms aircraft. Holds four jets.',
  },
  {
    id: 'c_aegis', name: 'Aegis Battery', faction: 'coalition', cost: 900, buildTime: 10, hp: 850, power: -2,
    size: [2, 2], sight: 11, icon: 'turret', model: 'patriot', defense: true, detector: true,
    weapons: [{ damage: 55, type: 'rocket', range: 11, cooldown: 1.1, projectile: 'rocket', air: true, speed: 16, splash: 0.5 }],
    desc: 'Missile battery. Engages ground and air targets.',
  },
  {
    id: 'c_strategy', name: 'Strategy Center', faction: 'coalition', cost: 2500, buildTime: 22, hp: 1600, power: -2,
    size: [5, 5], sight: 9, icon: 'tech', model: 'strategy', upgrades: ['c_training'], plans: true, limit: 1,
    desc: 'Unlocks advanced units. Choose a battle plan: Bombardment, Hold the Line or Search & Destroy.',
  },
  {
    id: 'c_pad', name: 'Supply Drop Zone', faction: 'coalition', cost: 2500, buildTime: 16, hp: 800, power: -1,
    size: [3, 3], sight: 6, icon: 'supply', model: 'pad', prereq: ['c_strategy'], income: { amount: 1500, interval: 90 },
    desc: 'A cargo plane drops $1500 every 90 seconds.',
  },
  {
    id: 'c_lance', name: 'Solar Lance', faction: 'coalition', cost: 5000, buildTime: 40, hp: 1600, power: -10,
    size: [5, 5], sight: 8, icon: 'super', model: 'lance', prereq: ['c_strategy'], limit: 1,
    superweapon: { kind: 'lance', cooldown: 240 },
    desc: 'Superweapon. Fires a sweeping orbital beam anywhere on the map. Tap again to steer it.',
  },
];

const coalitionUpgrades: UpgradeDef[] = [
  { id: 'c_rods', name: 'Control Rods', faction: 'coalition', cost: 500, time: 10, at: 'c_reactor', icon: 'upgrade', desc: 'Each Fusion Reactor produces +3 power.' },
  { id: 'c_composite', name: 'Composite Armor', faction: 'coalition', cost: 2000, time: 20, at: 'c_factory', icon: 'upgrade', desc: 'Tanks take 25% less damage.' },
  { id: 'c_training', name: 'Advanced Training', faction: 'coalition', cost: 1500, time: 20, at: 'c_strategy', icon: 'upgrade', desc: 'Units earn veterancy twice as fast.' },
];

const coalitionPowers: PowerDef[] = [
  { id: 'c_drone', name: 'Spy Drone', faction: 'coalition', kind: 'reveal', levels: 1, cooldown: 60, rank: 1, radius: 14, target: 'point', icon: '◎', desc: 'Reveals an area for 40 seconds.' },
  { id: 'c_para', name: 'Paratroopers', faction: 'coalition', kind: 'paratroopers', levels: 3, cooldown: 150, rank: 1, radius: 4, target: 'point', icon: '⇣', desc: 'Drops 4 / 8 / 12 riflemen anywhere on the map.' },
  { id: 'c_repair', name: 'Emergency Repair', faction: 'coalition', kind: 'repair', levels: 3, cooldown: 120, rank: 1, radius: 9, target: 'point', icon: '✚', desc: 'Repairs vehicles and aircraft in an area by 30 / 60 / 100%.' },
  { id: 'c_a10', name: 'Thunderbolt Strike', faction: 'coalition', kind: 'airstrike', levels: 3, cooldown: 180, rank: 3, radius: 5, target: 'point', icon: '✈', desc: '1 / 2 / 3 ground-attack jets strafe the target.' },
  { id: 'c_fab', name: 'Fuel-Air Bomb', faction: 'coalition', kind: 'fuelair', levels: 1, cooldown: 240, rank: 5, radius: 7, target: 'point', icon: '✸', desc: 'A massive thermobaric blast.' },
];

// ----------------------------------------------------------------------------------------------
// DOMINION — numbers, nuclear power, hordes, heavy armour.
// ----------------------------------------------------------------------------------------------
const dominionUnits: UnitDef[] = [
  {
    id: 'd_dozer', name: 'Dozer', faction: 'dominion', cost: 1000, buildTime: 8, hp: 260, armor: 'light', speed: 3.2,
    move: 'vehicle', radius: 0.7, sight: 6, weapons: [], producedAt: 'd_command', icon: 'dozer', model: 'dozer',
    builder: true, desc: 'Constructs and repairs structures.',
  },
  {
    id: 'd_truck', name: 'Supply Truck', faction: 'dominion', cost: 600, buildTime: 8, hp: 320, armor: 'light',
    speed: 4.2, move: 'vehicle', radius: 0.8, sight: 6, weapons: [], producedAt: 'd_supply', icon: 'truck',
    model: 'truck', gather: 200, desc: 'Hauls $200 of supplies per trip.',
  },
  {
    id: 'd_guard', name: 'Guardsman', faction: 'dominion', cost: 300, buildTime: 6, hp: 115, armor: 'infantry',
    speed: 2.1, move: 'infantry', radius: 0.3, sight: 7, weapons: [rifle(10)], producedAt: 'd_barracks', count: 2,
    icon: 'infantry', model: 'soldier', capture: true, horde: true, desc: 'Trained in pairs. Horde bonus when massed.',
  },
  {
    id: 'd_rocketeer', name: 'Rocketeer', faction: 'dominion', cost: 300, buildTime: 6, hp: 100, armor: 'infantry',
    speed: 2.0, move: 'infantry', radius: 0.3, sight: 8, weapons: [rockets(42)], producedAt: 'd_barracks',
    icon: 'rocketinf', model: 'rocketsoldier', horde: true, desc: 'Anti-tank rockets. Also hits aircraft.',
  },
  {
    id: 'd_hacker', name: 'Hacker', faction: 'dominion', cost: 625, buildTime: 8, hp: 90, armor: 'infantry',
    speed: 2.0, move: 'infantry', radius: 0.3, sight: 6, weapons: [], producedAt: 'd_barracks', icon: 'hero',
    model: 'hacker', hack: 6, desc: 'Deploys a laptop and siphons $6 per second from the global network.',
  },
  {
    id: 'd_lotus', name: 'Lotus', faction: 'dominion', cost: 1500, buildTime: 18, hp: 160, armor: 'hero', speed: 2.6,
    move: 'infantry', radius: 0.3, sight: 10, limit: 1, stealth: true, capture: true, detector: true,
    weapons: [{ damage: 1, type: 'laser', range: 7, cooldown: 4, projectile: 'laser', stun: 8, ground: true }],
    producedAt: 'd_barracks', prereq: ['d_hall'], icon: 'hero', model: 'lotus',
    desc: 'Stealth hero. Captures buildings in seconds and disables vehicles with a hack.',
  },
  {
    id: 'd_warlord', name: 'Warlord Tank', faction: 'dominion', cost: 800, buildTime: 10, hp: 520, armor: 'tank',
    speed: 3.4, move: 'vehicle', radius: 0.9, sight: 8, weapons: [cannon(56)], producedAt: 'd_factory', icon: 'tank',
    model: 'tank', crush: true, horde: true, desc: 'Battle tank. +25% damage when five or more are together.',
  },
  {
    id: 'd_shredder', name: 'Shredder', faction: 'dominion', cost: 800, buildTime: 10, hp: 400, armor: 'tank',
    speed: 4.0, move: 'vehicle', radius: 0.9, sight: 9,
    weapons: [{ damage: 9, type: 'aa', range: 8.5, cooldown: 0.14, projectile: 'instant', air: true }],
    producedAt: 'd_factory', icon: 'aa', model: 'gatling', crush: true, desc: 'Rotary cannon. Shreds infantry and aircraft.',
  },
  {
    id: 'd_inferno', name: 'Inferno Tank', faction: 'dominion', cost: 800, buildTime: 10, hp: 400, armor: 'tank',
    speed: 3.6, move: 'vehicle', radius: 0.9, sight: 7,
    weapons: [{ damage: 22, type: 'flame', range: 5, cooldown: 0.3, projectile: 'flame', splash: 0.9 }],
    producedAt: 'd_factory', icon: 'flame', model: 'flametank', crush: true, desc: 'Flamethrower tank. Melts infantry and buildings.',
  },
  {
    id: 'd_ember', name: 'Ember Cannon', faction: 'dominion', cost: 900, buildTime: 12, hp: 260, armor: 'light',
    speed: 3.0, move: 'vehicle', radius: 0.9, sight: 9,
    weapons: [{ damage: 120, type: 'flame', range: 15, minRange: 4, cooldown: 5, projectile: 'shell', splash: 1.8, speed: 18, linger: 1.6 }],
    producedAt: 'd_factory', icon: 'artillery', model: 'infernocannon', desc: 'Incendiary artillery. Leaves fire burning on the ground.',
  },
  {
    id: 'd_behemoth', name: 'Behemoth', faction: 'dominion', cost: 2000, buildTime: 20, hp: 1500, armor: 'tank',
    speed: 2.4, move: 'vehicle', radius: 1.4, sight: 8, weapons: [cannon(72, 8, 2.4), cannon(72, 8, 2.4)],
    producedAt: 'd_factory', prereq: ['d_hall'], icon: 'heavytank', model: 'overlord', crush: true,
    desc: 'Twin-barrelled super-heavy tank. Crushes light vehicles under its tracks.',
  },
  {
    id: 'd_atom', name: 'Atom Cannon', faction: 'dominion', cost: 1600, buildTime: 18, hp: 300, armor: 'light',
    speed: 2.2, move: 'vehicle', radius: 1.0, sight: 9,
    weapons: [{ damage: 420, type: 'explosion', range: 19, minRange: 6, cooldown: 10, projectile: 'shell', splash: 3.2, speed: 16, linger: 2.5 }],
    producedAt: 'd_factory', prereq: ['d_hall'], icon: 'artillery', model: 'nukecannon',
    desc: 'Fires tactical nuclear shells. Devastating, slow, and leaves radiation.',
  },
  {
    id: 'd_twinrotor', name: 'Twin-Rotor', faction: 'dominion', cost: 1500, buildTime: 16, hp: 750, armor: 'air',
    speed: 5, move: 'air', altitude: 7, radius: 1.3, sight: 9,
    weapons: [rifle(11, 7, 0.3), { damage: 150, type: 'explosion', range: 3, cooldown: 6, projectile: 'bomb', splash: 2.2 }],
    producedAt: 'd_airfield', icon: 'heli', model: 'helix', desc: 'Heavy helicopter. Gun pod plus napalm bombs.',
  },
  {
    id: 'd_vulture', name: 'Vulture', faction: 'dominion', cost: 1200, buildTime: 14, hp: 280, armor: 'air',
    speed: 14, move: 'air', altitude: 9, radius: 1.0, sight: 10, jet: true,
    weapons: [{ damage: 70, type: 'flame', range: 8, cooldown: 0.4, projectile: 'rocket', clip: 2, speed: 22, splash: 1.6, linger: 1.2 }],
    producedAt: 'd_airfield', icon: 'jet', model: 'mig', desc: 'Jet fighter armed with napalm missiles.',
  },
];

const dominionBuildings: BuildingDef[] = [
  {
    id: 'd_command', name: 'Command Center', faction: 'dominion', cost: 2000, buildTime: 30, hp: 3000, power: 0,
    size: [6, 6], sight: 12, icon: 'building', model: 'command', produces: ['d_dozer'], command: true, detector: true,
    desc: 'Heart of your base. Builds dozers and enables generals powers.',
  },
  {
    id: 'd_reactor', name: 'Atomic Reactor', faction: 'dominion', cost: 1000, buildTime: 10, hp: 800, power: 10,
    size: [4, 4], sight: 6, icon: 'power', model: 'nukereactor', deathBlast: { damage: 350, radius: 5, type: 'explosion' },
    desc: 'Provides 10 power. Explodes violently when destroyed.',
  },
  {
    id: 'd_barracks', name: 'Barracks', faction: 'dominion', cost: 500, buildTime: 10, hp: 1000, power: -1,
    size: [4, 4], sight: 7, icon: 'barracks', model: 'barracks',
    produces: ['d_guard', 'd_rocketeer', 'd_hacker', 'd_lotus'], desc: 'Trains infantry.',
  },
  {
    id: 'd_supply', name: 'Supply Center', faction: 'dominion', cost: 1500, buildTime: 14, hp: 1200, power: -1,
    size: [5, 5], sight: 7, icon: 'supply', model: 'supply', produces: ['d_truck'], depot: true, freeUnits: ['d_truck'],
    desc: 'Supply depot. Comes with one Supply Truck.',
  },
  {
    id: 'd_factory', name: 'War Factory', faction: 'dominion', cost: 2000, buildTime: 18, hp: 1500, power: -1,
    size: [6, 5], sight: 7, icon: 'factory', model: 'factory', upgrades: ['d_uranium'],
    produces: ['d_dozer', 'd_warlord', 'd_shredder', 'd_inferno', 'd_ember', 'd_behemoth', 'd_atom'],
    desc: 'Builds vehicles. Repairs vehicles parked beside it.',
  },
  {
    id: 'd_airfield', name: 'Airfield', faction: 'dominion', cost: 1000, buildTime: 14, hp: 1200, power: -1,
    size: [7, 6], sight: 8, icon: 'airfield', model: 'airfield', produces: ['d_twinrotor', 'd_vulture'],
    upgrades: ['d_napalm'], airfield: true, desc: 'Builds and rearms aircraft.',
  },
  {
    id: 'd_gatling', name: 'Shredder Turret', faction: 'dominion', cost: 1200, buildTime: 10, hp: 900, power: -3,
    size: [2, 2], sight: 10, icon: 'turret', model: 'gatlingturret', defense: true, detector: true,
    weapons: [{ damage: 10, type: 'aa', range: 9.5, cooldown: 0.13, projectile: 'instant', air: true }],
    desc: 'Rotary cannon emplacement. Ground and air.',
  },
  {
    id: 'd_speaker', name: 'Speaker Tower', faction: 'dominion', cost: 500, buildTime: 8, hp: 500, power: -1,
    size: [1, 1], sight: 8, icon: 'speaker', model: 'speaker', heal: { radius: 8, rate: 0.02 },
    desc: 'Broadcasts doctrine. Heals nearby units.',
  },
  {
    id: 'd_hall', name: 'Doctrine Hall', faction: 'dominion', cost: 2000, buildTime: 22, hp: 1600, power: -2,
    size: [5, 5], sight: 9, icon: 'tech', model: 'strategy', upgrades: ['d_zeal'], heal: { radius: 10, rate: 0.01 },
    limit: 1, desc: 'Unlocks heavy units and heals nearby troops.',
  },
  {
    id: 'd_silo', name: 'Atomic Silo', faction: 'dominion', cost: 5000, buildTime: 40, hp: 1600, power: -10,
    size: [5, 5], sight: 8, icon: 'super', model: 'silo', prereq: ['d_hall'], limit: 1,
    superweapon: { kind: 'nuke', cooldown: 240 }, desc: 'Superweapon. Launches a nuclear missile.',
  },
];

const dominionUpgrades: UpgradeDef[] = [
  { id: 'd_uranium', name: 'Uranium Shells', faction: 'dominion', cost: 2500, time: 25, at: 'd_factory', icon: 'upgrade', desc: 'Tank cannons deal 25% more damage.' },
  { id: 'd_napalm', name: 'Black Napalm', faction: 'dominion', cost: 2000, time: 20, at: 'd_airfield', icon: 'upgrade', desc: 'Flame weapons deal 25% more damage.' },
  { id: 'd_zeal', name: 'Zeal', faction: 'dominion', cost: 2000, time: 20, at: 'd_hall', icon: 'upgrade', desc: 'Horde bonus doubled.' },
];

const dominionPowers: PowerDef[] = [
  { id: 'd_hack', name: 'Cash Hack', faction: 'dominion', kind: 'cashhack', levels: 3, cooldown: 150, rank: 1, radius: 0, target: 'none', icon: '$', desc: 'Steals $1000 / $2000 / $4000 from the enemy.' },
  { id: 'd_mines', name: 'Cluster Mines', faction: 'dominion', kind: 'mines', levels: 1, cooldown: 90, rank: 1, radius: 5, target: 'point', icon: '※', desc: 'Scatters hidden mines over an area.' },
  { id: 'd_repair', name: 'Emergency Repair', faction: 'dominion', kind: 'repair', levels: 3, cooldown: 120, rank: 1, radius: 9, target: 'point', icon: '✚', desc: 'Repairs vehicles in an area by 30 / 60 / 100%.' },
  { id: 'd_barrage', name: 'Artillery Barrage', faction: 'dominion', kind: 'barrage', levels: 3, cooldown: 180, rank: 3, radius: 6, target: 'point', icon: '☄', desc: 'Rains 12 / 24 / 36 shells on an area.' },
  { id: 'd_emp', name: 'EMP Pulse', faction: 'dominion', kind: 'emp', levels: 1, cooldown: 150, rank: 3, radius: 9, target: 'point', icon: '⚡', desc: 'Disables all vehicles and structures in the area for 20 seconds.' },
  { id: 'd_carpet', name: 'Carpet Bomb', faction: 'dominion', kind: 'carpet', levels: 1, cooldown: 240, rank: 5, radius: 4, target: 'point', icon: '✈', desc: 'A heavy bomber lays a line of bombs through the target.' },
];

// ----------------------------------------------------------------------------------------------
// INSURGENCY — cheap, sneaky, no power needed, scavenges wrecks.
// ----------------------------------------------------------------------------------------------
const insurgencyUnits: UnitDef[] = [
  {
    id: 'i_worker', name: 'Worker', faction: 'insurgency', cost: 200, buildTime: 5, hp: 90, armor: 'infantry',
    speed: 2.6, move: 'infantry', radius: 0.3, sight: 6, weapons: [], producedAt: 'i_stash', icon: 'worker',
    model: 'worker', builder: true, gather: 100, desc: 'Builds structures and hauls $100 of supplies per trip.',
  },
  {
    id: 'i_militia', name: 'Militia', faction: 'insurgency', cost: 150, buildTime: 4, hp: 110, armor: 'infantry',
    speed: 2.3, move: 'infantry', radius: 0.3, sight: 7, weapons: [rifle(10)], producedAt: 'i_barracks',
    icon: 'infantry', model: 'rebel', capture: true, desc: 'Cheap riflemen. Can capture structures.',
  },
  {
    id: 'i_rpg', name: 'Rocket Militia', faction: 'insurgency', cost: 300, buildTime: 6, hp: 100, armor: 'infantry',
    speed: 2.1, move: 'infantry', radius: 0.3, sight: 8, weapons: [rockets(42)], producedAt: 'i_barracks',
    icon: 'rocketinf', model: 'rocketsoldier', desc: 'Rocket-propelled grenades. Anti-vehicle and anti-air.',
  },
  {
    id: 'i_runner', name: 'Demolition Runner', faction: 'insurgency', cost: 200, buildTime: 5, hp: 90, armor: 'infantry',
    speed: 2.9, move: 'infantry', radius: 0.3, sight: 6, suicide: true,
    weapons: [{ damage: 420, type: 'explosion', range: 1.2, cooldown: 1, projectile: 'instant', splash: 1.8 }],
    producedAt: 'i_barracks', icon: 'bomb', model: 'runner', desc: 'Sprints at a target and detonates a satchel charge.',
  },
  {
    id: 'i_mob', name: 'Riot Mob', faction: 'insurgency', cost: 800, buildTime: 10, hp: 640, armor: 'infantry',
    speed: 2.2, move: 'infantry', radius: 0.8, sight: 7,
    weapons: [rifle(16, 6, 0.35), { damage: 26, type: 'flame', range: 5, cooldown: 0.6, projectile: 'shell', splash: 0.9, speed: 12 }],
    producedAt: 'i_barracks', icon: 'mob', model: 'mob', desc: 'An angry crowd with rifles and molotovs.',
  },
  {
    id: 'i_marksman', name: 'Marksman', faction: 'insurgency', cost: 1500, buildTime: 18, hp: 200, armor: 'hero',
    speed: 2.5, move: 'infantry', radius: 0.3, sight: 11, limit: 1, stealth: true, detector: true,
    weapons: [{ damage: 150, type: 'sniper', range: 11, cooldown: 2.4, projectile: 'instant' }],
    producedAt: 'i_barracks', prereq: ['i_citadel'], icon: 'hero', model: 'sniper',
    desc: 'Stealth hero sniper. Kills infantry instantly from long range.',
  },
  {
    id: 'i_guntruck', name: 'Gun Truck', faction: 'insurgency', cost: 500, buildTime: 6, hp: 270, armor: 'light',
    speed: 6.5, move: 'vehicle', radius: 0.8, sight: 8, weapons: [rifle(13, 7, 0.35)], producedAt: 'i_arms',
    icon: 'truck', model: 'technical', crush: true, salvage: true, desc: 'Fast pickup with a mounted gun. Salvages wrecks.',
  },
  {
    id: 'i_viper', name: 'Viper Tank', faction: 'insurgency', cost: 600, buildTime: 8, hp: 420, armor: 'tank',
    speed: 3.8, move: 'vehicle', radius: 0.9, sight: 8, weapons: [cannon(50)], producedAt: 'i_arms', icon: 'tank',
    model: 'scorpion', crush: true, salvage: true, desc: 'Light tank. Grows stronger by salvaging wrecks.',
  },
  {
    id: 'i_ravager', name: 'Ravager', faction: 'insurgency', cost: 800, buildTime: 10, hp: 540, armor: 'tank',
    speed: 3.6, move: 'vehicle', radius: 0.95, sight: 8, weapons: [cannon(62)], producedAt: 'i_arms',
    prereq: ['i_citadel'], icon: 'heavytank', model: 'marauder', crush: true, salvage: true,
    desc: 'Heavy tank built from scrap. Salvages wrecks.',
  },
  {
    id: 'i_flak', name: 'Flak Truck', faction: 'insurgency', cost: 700, buildTime: 8, hp: 330, armor: 'light',
    speed: 4.5, move: 'vehicle', radius: 0.85, sight: 9,
    weapons: [{ damage: 11, type: 'aa', range: 9, cooldown: 0.18, projectile: 'instant', air: true }],
    producedAt: 'i_arms', icon: 'aa', model: 'quad', crush: true, desc: 'Quad autocannon. Anti-air and anti-infantry.',
  },
  {
    id: 'i_buggy', name: 'Barrage Buggy', faction: 'insurgency', cost: 900, buildTime: 10, hp: 170, armor: 'light',
    speed: 6, move: 'vehicle', radius: 0.8, sight: 10,
    weapons: [{ damage: 28, type: 'rocket', range: 14, minRange: 3, cooldown: 5, projectile: 'rocket', burst: 6, splash: 1.0, speed: 14 }],
    producedAt: 'i_arms', icon: 'artillery', model: 'buggy', desc: 'Fast rocket artillery. Fragile but deadly.',
  },
  {
    id: 'i_toxin', name: 'Toxin Sprayer', faction: 'insurgency', cost: 600, buildTime: 8, hp: 400, armor: 'light',
    speed: 3.6, move: 'vehicle', radius: 0.9, sight: 7,
    weapons: [{ damage: 20, type: 'toxin', range: 5, cooldown: 0.25, projectile: 'toxin', splash: 0.9, linger: 1.0 }],
    producedAt: 'i_arms', icon: 'toxin', model: 'toxintractor', crush: true, desc: 'Sprays toxin. Clears infantry and garrisons.',
  },
  {
    id: 'i_demotruck', name: 'Demolition Truck', faction: 'insurgency', cost: 1200, buildTime: 12, hp: 260, armor: 'light',
    speed: 4.2, move: 'vehicle', radius: 0.9, sight: 6, suicide: true,
    weapons: [{ damage: 1400, type: 'explosion', range: 1.6, cooldown: 1, projectile: 'instant', splash: 3.4 }],
    producedAt: 'i_arms', icon: 'bomb', model: 'bombtruck', desc: 'A truck full of explosives. Drive it into something expensive.',
  },
  {
    id: 'i_ballistic', name: 'Ballistic Launcher', faction: 'insurgency', cost: 1300, buildTime: 14, hp: 360, armor: 'light',
    speed: 2.6, move: 'vehicle', radius: 1.1, sight: 9,
    weapons: [{ damage: 330, type: 'explosion', range: 20, minRange: 6, cooldown: 10, projectile: 'rocket', splash: 2.6, speed: 9, linger: 2.4 }],
    producedAt: 'i_arms', prereq: ['i_citadel'], icon: 'artillery', model: 'scud',
    desc: 'Long-range ballistic missile with a toxin warhead.',
  },
];

const insurgencyBuildings: BuildingDef[] = [
  {
    id: 'i_command', name: 'Command Center', faction: 'insurgency', cost: 2000, buildTime: 30, hp: 2600, power: 0,
    size: [6, 6], sight: 12, icon: 'building', model: 'command', produces: ['i_worker'], command: true, detector: true,
    desc: 'Heart of your base. Enables generals powers.',
  },
  {
    id: 'i_stash', name: 'Supply Stash', faction: 'insurgency', cost: 1500, buildTime: 12, hp: 1000, power: 0,
    size: [4, 4], sight: 7, icon: 'supply', model: 'stash', produces: ['i_worker'], depot: true,
    freeUnits: ['i_worker', 'i_worker'], desc: 'Supply depot. Comes with two workers.',
  },
  {
    id: 'i_barracks', name: 'Barracks', faction: 'insurgency', cost: 500, buildTime: 10, hp: 900, power: 0,
    size: [4, 4], sight: 7, icon: 'barracks', model: 'barracks',
    produces: ['i_militia', 'i_rpg', 'i_runner', 'i_mob', 'i_marksman'], desc: 'Trains infantry.',
  },
  {
    id: 'i_arms', name: 'Arms Dealer', faction: 'insurgency', cost: 2500, buildTime: 18, hp: 1500, power: 0,
    size: [6, 5], sight: 7, icon: 'factory', model: 'factory',
    produces: ['i_guntruck', 'i_viper', 'i_ravager', 'i_flak', 'i_buggy', 'i_toxin', 'i_demotruck', 'i_ballistic'],
    desc: 'Builds vehicles. Repairs vehicles parked beside it.',
  },
  {
    id: 'i_tunnel', name: 'Tunnel Network', faction: 'insurgency', cost: 800, buildTime: 10, hp: 800, power: 0,
    size: [2, 2], sight: 9, icon: 'tunnel', model: 'tunnel', tunnel: true, detector: true,
    weapons: [{ damage: 10, type: 'gun', range: 8, cooldown: 0.3, projectile: 'instant', air: true }],
    desc: 'Units that enter any tunnel can exit from any other. Has a machine gun.',
  },
  {
    id: 'i_nest', name: 'Missile Nest', faction: 'insurgency', cost: 900, buildTime: 10, hp: 750, power: 0,
    size: [2, 2], sight: 11, icon: 'turret', model: 'stinger', detector: true,
    weapons: [{ damage: 48, type: 'rocket', range: 11, cooldown: 1.3, projectile: 'rocket', air: true, speed: 16, splash: 0.5 }],
    desc: 'Sandbagged missile crews. Ground and air.',
  },
  {
    id: 'i_market', name: 'Black Market', faction: 'insurgency', cost: 2500, buildTime: 18, hp: 1100, power: 0,
    size: [3, 3], sight: 7, icon: 'market', model: 'market', income: { amount: 25, interval: 4 },
    upgrades: ['i_apbullets', 'i_aprockets', 'i_junk'], desc: 'Steady illicit income and weapon upgrades.',
  },
  {
    id: 'i_citadel', name: 'Citadel', faction: 'insurgency', cost: 2500, buildTime: 24, hp: 2600, power: 0,
    size: [5, 5], sight: 10, icon: 'tech', model: 'palace', upgrades: ['i_camo'], limit: 1, detector: true,
    weapons: [rifle(12, 9, 0.3)], desc: 'Fortified palace. Unlocks heavy units and the hero.',
  },
  {
    id: 'i_trap', name: 'Demo Trap', faction: 'insurgency', cost: 600, buildTime: 4, hp: 120, power: 0,
    size: [1, 1], sight: 4, icon: 'trap', model: 'trap', stealth: true, trap: 2.2,
    deathBlast: { damage: 450, radius: 2.8, type: 'explosion' }, desc: 'A hidden bomb that detonates when enemies approach.',
  },
  {
    id: 'i_storm', name: 'Rocket Storm', faction: 'insurgency', cost: 5000, buildTime: 40, hp: 1600, power: 0,
    size: [5, 5], sight: 8, icon: 'super', model: 'scudstorm', prereq: ['i_citadel'], limit: 1,
    superweapon: { kind: 'storm', cooldown: 240 }, desc: 'Superweapon. Nine toxin missiles rain on a target.',
  },
];

const insurgencyUpgrades: UpgradeDef[] = [
  { id: 'i_apbullets', name: 'AP Bullets', faction: 'insurgency', cost: 2000, time: 20, at: 'i_market', icon: 'upgrade', desc: 'Machine guns and rifles deal 25% more damage.' },
  { id: 'i_aprockets', name: 'AP Rockets', faction: 'insurgency', cost: 2000, time: 20, at: 'i_market', icon: 'upgrade', desc: 'Rockets deal 25% more damage.' },
  { id: 'i_junk', name: 'Junk Repair', faction: 'insurgency', cost: 1000, time: 15, at: 'i_market', icon: 'upgrade', desc: 'Vehicles slowly repair themselves.' },
  { id: 'i_camo', name: 'Camouflage', faction: 'insurgency', cost: 1000, time: 15, at: 'i_citadel', icon: 'upgrade', desc: 'Militia become stealthed while not firing.' },
];

const insurgencyPowers: PowerDef[] = [
  { id: 'i_ambush', name: 'Militia Ambush', faction: 'insurgency', kind: 'ambush', levels: 3, cooldown: 120, rank: 1, radius: 4, target: 'point', icon: '⇣', desc: '4 / 6 / 8 militia appear anywhere on the map.' },
  { id: 'i_bounty', name: 'Cash Bounty', faction: 'insurgency', kind: 'bounty', levels: 3, cooldown: 0, rank: 1, radius: 0, target: 'none', icon: '$', desc: 'Earn 5 / 10 / 20% of the value of everything you destroy.' },
  { id: 'i_scrambler', name: 'GPS Scrambler', faction: 'insurgency', kind: 'scrambler', levels: 1, cooldown: 120, rank: 1, radius: 8, target: 'point', icon: '◌', desc: 'Your units in the area become stealthed for 40 seconds.' },
  { id: 'i_toxinbomb', name: 'Toxin Strike', faction: 'insurgency', kind: 'toxinbomb', levels: 3, cooldown: 180, rank: 3, radius: 5, target: 'point', icon: '☣', desc: 'A plane drops a toxin bomb. Larger at each level.' },
  { id: 'i_sneak', name: 'Sneak Attack', faction: 'insurgency', kind: 'sneak', levels: 1, cooldown: 240, rank: 5, radius: 2, target: 'point', icon: '◍', desc: 'A tunnel exit appears anywhere on the map.' },
];

export const FACTIONS: Record<FactionId, FactionDef> = {
  coalition: {
    id: 'coalition', name: 'Coalition', short: 'COA', motto: 'Precision. Power. Air superiority.',
    desc: 'Expensive, high-tech forces. Dominant air force, lasers and the Solar Lance superweapon.',
    units: coalitionUnits, buildings: coalitionBuildings, powers: coalitionPowers, upgrades: coalitionUpgrades,
    builder: 'c_dozer', command: 'c_command', needsPower: true,
    style: { hull: 0x8a8f78, accent: 0x3b7bd8, roof: 0xb9bcae, trim: 0x2d3748 },
  },
  dominion: {
    id: 'dominion', name: 'Dominion', short: 'DOM', motto: 'Strength in numbers.',
    desc: 'Massed infantry and armour, atomic power, hordes that grow stronger together, and the Atomic Silo.',
    units: dominionUnits, buildings: dominionBuildings, powers: dominionPowers, upgrades: dominionUpgrades,
    builder: 'd_dozer', command: 'd_command', needsPower: true,
    style: { hull: 0x6b6f5a, accent: 0xd33b2f, roof: 0x8b8a7a, trim: 0x3a2f2a },
  },
  insurgency: {
    id: 'insurgency', name: 'Insurgency', short: 'INS', motto: 'Hit, hide, scavenge.',
    desc: 'Cheap, fast and sneaky. No power needed, tunnels everywhere, toxin weapons and the Rocket Storm.',
    units: insurgencyUnits, buildings: insurgencyBuildings, powers: insurgencyPowers, upgrades: insurgencyUpgrades,
    builder: 'i_worker', command: 'i_command', needsPower: false,
    style: { hull: 0xa48a5a, accent: 0x2f8f4e, roof: 0xc9b07c, trim: 0x4a3a28 },
  },
};

export const FACTION_IDS: FactionId[] = ['coalition', 'dominion', 'insurgency'];

export const UNITS: Record<string, UnitDef> = {};
export const BUILDINGS: Record<string, BuildingDef> = {};
export const UPGRADES: Record<string, UpgradeDef> = {};
export const POWERS: Record<string, PowerDef> = {};
for (const f of Object.values(FACTIONS)) {
  for (const u of f.units) UNITS[u.id] = u;
  for (const b of f.buildings) BUILDINGS[b.id] = b;
  for (const u of f.upgrades) UPGRADES[u.id] = u;
  for (const p of f.powers) POWERS[p.id] = p;
}

/** Neutral tech structure: capturable oil derrick that pays its owner. */
export const DERRICK: BuildingDef = {
  id: 'n_derrick', name: 'Oil Derrick', faction: 'coalition', cost: 0, buildTime: 0, hp: 1200, power: 0, size: [3, 3],
  sight: 5, icon: 'building', model: 'derrick', desc: 'Capture with infantry for $30 every 3 seconds.',
  income: { amount: 30, interval: 3 }, capturable: true,
};
BUILDINGS[DERRICK.id] = DERRICK;

/** Player-colour palette (team colours). */
export const TEAM_COLORS = [0x2f7fe0, 0xd63a3a, 0x3fae4a, 0xe0a02f, 0x9b4fd6, 0x29b6c0];
export const TEAM_COLOR_CSS = ['#2f7fe0', '#d63a3a', '#3fae4a', '#e0a02f', '#9b4fd6', '#29b6c0'];
