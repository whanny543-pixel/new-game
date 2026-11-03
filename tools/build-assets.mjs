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
import { dedup, prune, quantize, resample, weld, meshopt, mergeDocuments, unpartition, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
// Optional second folder: a checkout of github.com/series-ai/jam-ready-assets (Kenney + Quaternius + KayKit, all CC0).
const JRA = process.argv[3];
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

/**
 * KayKit Adventurers 2.0 characters ship without animations; the clips live in shared rig files
 * (Rig_Medium / Rig_Large). Copy the clips we use onto the character, retargeted by bone name,
 * and give them the short names the game uses.
 */
async function character2(src, out, clips, dropMeshes = []) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const copy = (acc) => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setNormalized(acc.getNormalized()).setBuffer(buffer);
  const sources = new Map();
  for (const [file, from, to] of clips) {
    if (!sources.has(file)) sources.set(file, await io.read(file));
    const anim = sources.get(file).getRoot().listAnimations().find((a) => a.getName() === from);
    if (!anim) {
      console.warn(`  ${out}: missing ${from} in ${path.basename(file)}`);
      continue;
    }
    const na = doc.createAnimation(to);
    for (const ch of anim.listChannels()) {
      const target = byName.get(ch.getTargetNode()?.getName());
      if (!target || target.getMesh()) continue;
      const s = ch.getSampler();
      const ns = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
      na.addSampler(ns).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(ns));
    }
  }
  for (const n of root.listNodes()) if (dropMeshes.includes(n.getName())) n.dispose();
  await finish(doc, out, true);
}

if (JRA) {
  const CH = `${JRA}/kaykit-adventurers/3D/characters/Characters/gltf`;
  const RIG = `${JRA}/kaykit-character-animations/3D/characters/Animations/gltf`;
  const M = (f) => `${RIG}/Rig_Medium/Rig_Medium_${f}.glb`;
  const L = (f) => `${RIG}/Rig_Large/Rig_Large_${f}.glb`;
  const base = [
    [M('General'), 'Idle_A', 'Idle'],
    [M('MovementBasic'), 'Running_A', 'Running_A'],
    [M('MovementBasic'), 'Walking_A', 'Walking_A'],
    [M('General'), 'Death_A', 'Death_A'],
    [M('MovementBasic'), 'Jump_Full_Short', 'Cheer'],
  ];
  // The king: the knight without his helmet (the crown goes on in-game).
  await character2(`${CH}/Knight.glb`, 'king.glb', [...base, [M('CombatMelee'), 'Melee_1H_Attack_Stab', '1H_Melee_Attack_Stab'], [M('General'), 'Hit_A', 'Hit_A']], ['Knight_Helmet', 'Knight_HelmetVisor']);
  await character2(`${CH}/Knight.glb`, 'knight.glb', [...base, [M('CombatMelee'), 'Melee_1H_Attack_Chop', '1H_Melee_Attack_Chop']]);
  await character2(`${CH}/Ranger.glb`, 'archer.glb', [...base, [M('CombatRanged'), 'Ranged_Bow_Release', '1H_Ranged_Shoot']]);
  // The raider horde: hooded rogues (tinted red in-game).
  await character2(`${CH}/Rogue_Hooded.glb`, 'raider.glb', [
    [M('MovementBasic'), 'Walking_A', 'Walk'],
    [M('MovementBasic'), 'Running_A', 'Run'],
    [M('CombatMelee'), 'Melee_1H_Attack_Chop', 'Weapon'],
    [M('General'), 'Death_A', 'Death'],
    [M('General'), 'Spawn_Ground', 'Idle'],
  ]);
  // The warlord: the big barbarian, no bear pelt.
  await character2(
    `${CH}/Barbarian_Large.glb`,
    'brute.glb',
    [
      [L('MovementBasic'), 'Walking_A', 'Walk'],
      [L('MovementBasic'), 'Running_A', 'Run'],
      [L('CombatMelee'), 'Melee_2H_Slam', 'Weapon'],
      [L('General'), 'Death_A', 'Death'],
      [L('General'), 'Idle_A', 'Idle'],
    ],
    ['Barbarian_Large_BearHat', 'Barbarian_Large_BearPelt'],
  );
}
// Townsfolk: the rogue, unarmed.
await character(
  `${ADV}/Characters/gltf/Rogue.glb`,
  'villager.glb',
  ['Idle', 'Walking_A', 'Interact', 'PickUp', 'Cheer', 'Sit_Floor_Idle'],
  ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
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
  [`${ADV}/Assets/gltf`]: ['arrow', 'crossbow_1handed', 'quiver'],
  [DUN]: ['chest_gold', 'coin', 'coin_stack_large', 'banner_shield_blue', 'barrel_large', 'box_stacked'],
};

if (JRA) {
  PROPS[`${JRA}/kenney-survival-kit/3D/nature/Models/GLB format`] = [
    'tent-canvas',
    'campfire-pit',
    'campfire-stand',
    'workbench-anvil',
    'workbench',
    'structure-floor',
    'structure-canvas',
    'structure-roof',
    'fence-fortified',
    'resource-wood',
    'resource-planks',
    'resource-stone-large',
  ];
  PROPS[`${JRA}/kaykit-resource-bits/3D/misc/Assets/gltf`] = ['Gold_Bar', 'Gold_Bars_Stack_Large', 'Gold_Bars_Stack_Small', 'Food_Pile_Large'];
  PROPS[`${JRA}/kenney-castle-kit/3D/fantasy/Models/GLB format`] = ['siege-ballista', 'flag-banner-long'];
  // Weapons for the 2.0 characters (attached to their hand slots in-game).
  PROPS[`${JRA}/kaykit-adventurers/3D/characters/Assets/gltf`] = ['sword_1handed', 'bow_withString', 'axe_1handed', 'axe_2handed', 'dagger', 'shield_badge_color'];
  // KayKit Forest Nature: trees, bushes and rocks of the wild forest.
  PROPS[`${JRA}/kaykit-forest-nature/3D/nature/Assets/gltf`] = [
    'Bush_1_A_Color1',
    'Tree_1_A_Color1',
    'Tree_3_A_Color1',
    'Tree_4_A_Color1',
    'Tree_5_A_Color1',
    'Tree_7_A_Color1',
    'Rock_1_A_Color1',
    'Rock_3_C_Color1',
  ];
}

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

/** Bundles static models into one file, one named root node per asset. */
async function bundleProps(map, file, textures = null) {
  const bundle = new (await import('@gltf-transform/core')).Document();
  bundle.createBuffer();
  const bundleScene = bundle.createScene('props');
  for (const [dir, names] of Object.entries(map)) {
    for (const name of names) {
      const found = findFile(dir, name);
      if (!found) {
        console.warn(`  missing ${name}`);
        continue;
      }
      const doc = await io.read(found);
      // Wrap the asset's scene in one named node so the game can clone it by name.
      const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
      const wrapper = doc.createNode(name);
      for (const child of scene.listChildren()) wrapper.addChild(child);
      scene.addChild(wrapper);
      for (const a of doc.getRoot().listAnimations()) disposeAnimation(a);
      const m = mergeDocuments(bundle, doc);
      bundleScene.addChild(m.get(wrapper));
    }
  }
  for (const sc of bundle.getRoot().listScenes()) if (sc !== bundleScene) sc.dispose();
  bundle.getRoot().setDefaultScene(bundleScene);
  await bundle.transform(unpartition());
  if (textures) {
    // Painted textures arrive at up to 4K with normal maps: phones need far less.
    for (const mat of bundle.getRoot().listMaterials()) {
      const n = mat.getNormalTexture();
      if (n) {
        mat.setNormalTexture(null);
        if (n.listParents().length <= 1) n.dispose();
      }
    }
    const sharp = (await import('sharp')).default;
    await bundle.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textures, textures], quality: 82 }));
  }
  await finish(bundle, file);
}

await bundleProps(PROPS, 'props.glb');

if (JRA) {
  // Quaternius Stylized Nature MegaKit: painted trees, pines, plants, flowers and rocks.
  const NAT = `${JRA}/quaternius-stylized-nature/3D/nature`;
  const n = (base, count) => Array.from({ length: count }, (_, i) => `${base}_${i + 1}`);
  await bundleProps(
    {
      [NAT]: [
        ...n('CommonTree', 5),
        ...n('Pine', 5),
        ...n('TwistedTree', 5),
        'DeadTree_1',
        'DeadTree_2',
        'Bush_Common',
        'Bush_Common_Flowers',
        'Fern_1',
        'Plant_1_Big',
        'Plant_7_Big',
        'Flower_3_Group',
        'Flower_4_Group',
        'Grass_Common_Short',
        'Grass_Common_Tall',
        'Grass_Wispy_Tall',
        'Clover_1',
        ...n('Rock_Medium', 3),
        ...n('Pebble_Round', 3),
        'Mushroom_Common',
        'RockPath_Round_Wide',
        'RockPath_Round_Thin',
      ],
    },
    'nature.glb',
    512,
  );
  fs.copyFileSync(`${NAT}/License.txt`, path.join(OUT, 'LICENSE-Quaternius-StylizedNature.txt'));
}

fs.copyFileSync(`${ADV}/LICENSE.txt`, path.join(OUT, 'LICENSE-KayKit.txt'));
