// Builds the game's model files from the KayKit packs (CC0, by Kay Lousberg).
//
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0
//   node tools/build-assets.mjs <folder containing those clones>
//
// Output (src/assets/models):
//   hero.glb, archer.glb, knight.glb          rigged characters, only the animations we use
//   skel_minion.glb, skel_rogue.glb, skel_warrior.glb
//   props.glb                                  every static model, one root node per asset name
//
// Everything is meshopt-compressed and quantized; three.js decodes it with MeshoptDecoder.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, weld, meshopt, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node tools/build-assets.mjs <kaykit clones folder>');
  process.exit(1);
}
const OUT = path.resolve('src/assets/models');
fs.mkdirSync(OUT, { recursive: true });

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const ADV = `${SRC}/KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures`;
const SKEL = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons`;
const HEX = `${SRC}/KayKit-Medieval-Hexagon-Pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf`;
const DUN = `${SRC}/KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf`;

/** Removing an animation must also drop its samplers, or their keyframe data lingers. */
function disposeAnimation(a) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) {
    const i = s.getInput();
    const o = s.getOutput();
    s.dispose();
    if (i && i.listParents().length <= 1) i.dispose();
    if (o && o.listParents().length <= 1) o.dispose();
  }
  a.dispose();
}

async function finish(doc, file, skinned = false) {
  await doc.transform(
    dedup(),
    prune(),
    resample(),
    weld(),
    // Rigged characters keep float positions so skinned parts can be merged at runtime.
    quantize({ quantizeNormal: 10, quantizeTexcoord: 12, ...(skinned ? { pattern: /^(NORMAL|TEXCOORD_\d+)$/ } : {}) }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  await io.write(path.join(OUT, file), doc);
  console.log(`${file.padEnd(18)} ${(fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0)} KB`);
}

async function character(src, out, keepAnims, dropMeshes = []) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!keepAnims.includes(a.getName())) disposeAnimation(a);
  for (const n of root.listNodes()) if (dropMeshes.includes(n.getName())) n.dispose();
  const missing = keepAnims.filter((n) => !root.listAnimations().some((a) => a.getName() === n));
  if (missing.length) console.warn(`  ${out}: missing animations ${missing.join(', ')}`);
  await finish(doc, out, true);
}

// ---------------------------------------------------------------- characters

// The king: a knight without his helmet (a crown is added in-game), sword, shield and cape.
await character(
  `${ADV}/Characters/gltf/Knight.glb`,
  'king.glb',
  ['Idle', 'Running_A', '1H_Melee_Attack_Stab', 'Hit_A', 'Death_A', 'Cheer'],
  ['1H_Sword_Offhand', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '2H_Sword', 'Knight_Helmet'],
);
await character(
  `${ADV}/Characters/gltf/Rogue_Hooded.glb`,
  'archer.glb',
  ['Idle', 'Running_A', '1H_Ranged_Shoot', 'Cheer'],
  ['Knife_Offhand', '2H_Crossbow', 'Knife', 'Throwable'],
);
await character(
  `${ADV}/Characters/gltf/Knight.glb`,
  'knight.glb',
  ['Idle', 'Running_A', '1H_Melee_Attack_Chop', 'Cheer', 'Death_A'],
  ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword'],
);
// Kingdom folk: woodcutters/builders (barbarian with an axe) and townsfolk/miners (rogue, unarmed).
await character(
  `${ADV}/Characters/gltf/Barbarian.glb`,
  'worker.glb',
  ['Idle', 'Walking_A', '1H_Melee_Attack_Chop', 'Interact', 'Cheer', 'PickUp'],
  ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '2H_Axe', 'Mug', 'Barbarian_Cape'],
);
await character(
  `${ADV}/Characters/gltf/Rogue.glb`,
  'villager.glb',
  ['Idle', 'Walking_A', 'Interact', 'PickUp', 'Cheer', 'Sit_Floor_Idle'],
  ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
);
// Goblin horde: adventurer rigs that the game re-skins green and gives pointy ears.
const GOBLIN_ANIMS = ['Walking_A', 'Running_A', '1H_Melee_Attack_Chop', '2H_Melee_Attack_Chop', 'Death_A', 'Idle'];
await character(
  `${ADV}/Characters/gltf/Rogue_Hooded.glb`,
  'goblin.glb',
  GOBLIN_ANIMS,
  ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable'],
);
await character(
  `${ADV}/Characters/gltf/Rogue.glb`,
  'goblin_runner.glb',
  GOBLIN_ANIMS,
  ['1H_Crossbow', '2H_Crossbow', 'Throwable', 'Rogue_Cape'],
);
await character(
  `${ADV}/Characters/gltf/Barbarian.glb`,
  'orc.glb',
  GOBLIN_ANIMS,
  ['1H_Axe_Offhand', '1H_Axe', 'Mug', 'Barbarian_Round_Shield'],
);

// ---------------------------------------------------------------- static props bundle

const PROPS = {
  [`${HEX}/buildings/blue`]: [
    'building_castle_blue',
    'building_tower_A_blue',
    'building_tower_B_blue',
    'building_tower_catapult_blue',
    'building_tower_base_blue',
    'building_archeryrange_blue',
    'building_barracks_blue',
    'building_blacksmith_blue',
    'building_lumbermill_blue',
    'building_home_A_blue',
    'building_home_B_blue',
    'building_windmill_blue',
    'building_well_blue',
    'building_market_blue',
    'building_tavern_blue',
    'building_church_blue',
    'building_mine_blue',
  ],
  [`${HEX}/buildings/neutral`]: [
    'fence_wood_straight',
    'fence_wood_straight_gate',
    'fence_stone_straight',
    'fence_stone_straight_gate',
    'wall_straight',
    'wall_straight_gate',
    'wall_corner_A_outside',
    'building_grain',
    'building_scaffolding',
    'building_stage_A',
    'building_destroyed',
    'projectile_catapult',
  ],
  [`${HEX}/decoration/nature`]: [
    'trees_A_large',
    'trees_A_medium',
    'trees_A_small',
    'trees_B_large',
    'trees_B_medium',
    'trees_B_small',
    'tree_single_A',
    'tree_single_B',
    'rock_single_A',
    'rock_single_B',
    'rock_single_C',
    'rock_single_D',
    'rock_single_E',
    'hills_A_trees',
    'hills_B_trees',
    'hills_C_trees',
    'mountain_A_grass_trees',
    'mountain_B_grass_trees',
    'mountain_C_grass_trees',
    'mountain_A',
    'mountain_B',
    'cloud_big',
    'cloud_small',
  ],
  [`${HEX}/decoration/props`]: [
    'barrel',
    'crate_A_big',
    'crate_B_big',
    'crate_long_A',
    'sack',
    'tent',
    'weaponrack',
    'bucket_arrows',
    'target',
    'wheelbarrow',
    'resource_lumber',
    'resource_stone',
    'flag_blue',
  ],
  [`${ADV}/Assets/gltf`]: ['arrow', 'sword_1handed', 'crossbow_1handed', 'quiver', 'shield_round_color', 'axe_1handed'],
  [`${SKEL}/Assets/gltf`]: ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A'],
  [DUN]: ['chest_gold', 'coin', 'coin_stack_large', 'banner_shield_blue', 'barrel_large', 'box_stacked'],
};

const findFile = (dir, name) => {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if ([`${name}.gltf`, `${name}.glb`, `${name}.gltf.glb`].includes(e.name)) return p;
    }
  }
  return null;
};

const bundle = new (await import('@gltf-transform/core')).Document();
bundle.createBuffer();
const bundleScene = bundle.createScene('props');
for (const [dir, names] of Object.entries(PROPS)) {
  for (const name of names) {
    const file = findFile(dir, name);
    if (!file) {
      console.warn(`  missing ${name}`);
      continue;
    }
    const doc = await io.read(file);
    // Wrap the asset's scene in one named node so the game can clone it by name.
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    const wrapper = doc.createNode(name);
    for (const child of scene.listChildren()) wrapper.addChild(child);
    scene.addChild(wrapper);
    for (const a of doc.getRoot().listAnimations()) disposeAnimation(a);
    const map = mergeDocuments(bundle, doc);
    const merged = map.get(wrapper);
    bundleScene.addChild(merged);
  }
}
for (const s of bundle.getRoot().listScenes()) if (s !== bundleScene) s.dispose();
bundle.getRoot().setDefaultScene(bundleScene);
await bundle.transform(unpartition());
await finish(bundle, 'props.glb');

fs.copyFileSync(`${ADV}/LICENSE.txt`, path.join(OUT, 'LICENSE-KayKit.txt'));
