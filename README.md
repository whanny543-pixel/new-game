# Hearthguard

A portrait, one-thumb medieval kingdom-defense game for iOS and Android.

You are the king. Goblin warbands march down winding roads toward your castle. You fight on the front line (your sword fires golden bolts), and gold from fallen goblins stacks up on your back. Spend it by standing on build plots.

**Campaign**
- A world map of four kingdoms (Greenvale, Amberwood, Ashmoor, Frostpeak). Each has its own roads, look and difficulty. Survive all its waves to free it and unlock the next.
- Victories and survived waves earn **crowns**. Spend them in the **King's Armory** on permanent upgrades: Royal Sword, Royal Armour, Swift Boots, War Banner, Treasury and Scepter.

**Defense**
- **Watchtowers** beside the road need archers. Recruit them at the **Archery Range** and lead them to a free tower. Upgrades add a slot, then a catapult.
- **Guard posts** on the road hold knights recruited at the **Barracks**. **Barricades** stall the horde.
- The **Forge** makes swords and the **Bowyer** makes crossbows. Carry them to your troops for better weapons.
- An Orc Warlord leads every 4th wave and drops a treasure chest.

**The kingdom wall**
- Goblins march down the roads, but near your kingdom they leave them and storm across open ground. From wave 3, whole warbands come straight over the fields from any side.
- Build the wall ring around your kingdom one section at a time (each section has a lookout post for two archers, and gates where roads cross). Any section you haven't built, or that gets smashed, is a way in.

**The kingdom grows with the castle**
- The castle starts as a few logs, a tent and a campfire, then becomes a Wooden Hall, Timber Fort, Stone Keep, Castle and finally a Citadel.
- Everything matches its era: until the Stone Keep, workshops are tents, workbenches and timber platforms; after it they're rebuilt in stone. Every wall section is rebuilt too: wooden palisade → stone → castle walls → citadel walls with towers.
- **Gold Mine:** miners dig up gold bars that pile up outside the mine. Walk past to scoop them into your stack.
- New houses, a well, a windmill and a church appear as the town grows, and more townsfolk move in.
- **Lumber Camp:** woodcutters chop trees, which regrow. **Quarry:** miners bring stone. **Farm:** farmers harvest wheat for **food**, which recruits need.
- **Builders** repair wall sections and barricades.

**The king's powers:** every kill gives XP, and each level offers three perk cards. Kills also charge the **Arcane Nova** button, which blasts the horde back.

Built with Three.js and TypeScript (Vite), and packaged for the app stores with Capacitor.

**Art (all CC0, free for commercial use):**
- KayKit by Kay Lousberg (www.kaylousberg.com): characters, castle and town buildings, nature, gold bars.
- Kenney (www.kenney.nl): wooden-era camp pieces (lookout platforms, workbenches, campfires) and the ballista.
- Quaternius (quaternius.com): the goblin horde (Ultimate Monsters "Orc" and "Orc_Skull").

Licence files are in `src/assets/models`. The king is the KayKit knight with a procedural crown and royal cape. Sound effects are synthesized in code.

## Run in a browser

```bash
npm install
npm run dev          # http://localhost:5173 (desktop: WASD/arrows, phone: drag anywhere)
```

## Build the mobile apps

```bash
npm run cap:sync     # build the web game and copy it into ios/ and android/
npm run ios          # opens Xcode (needs a Mac, Xcode, and CocoaPods: `cd ios/App && pod install`)
npm run android      # opens Android Studio
```

Both apps are locked to portrait. On iOS that's set in `ios/App/App/Info.plist`, and on Android in `android/app/src/main/AndroidManifest.xml`.

Before submitting to the stores:
- Set your own bundle id in `capacitor.config.ts` (`appId`), then run `npx cap sync`.
- Replace the default app icons and splash screens. `npx @capacitor/assets generate` creates every size from one 1024×1024 icon.
- Sign the builds with your Apple Developer and Google Play accounts.

## Rebuilding the 3D assets

The processed models live in `src/assets/models` (about 3 MB total). To regenerate them from the original packs:

```bash
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0
git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0
git clone --depth 1 --filter=blob:none --sparse https://github.com/series-ai/jam-ready-assets
#   (sparse-checkout kenney-survival-kit, kenney-castle-kit, quaternius-ultimate-monsters,
#    kaykit-resource-bits; their models are in Git LFS)
node tools/build-assets.mjs <folder with the KayKit clones> <jam-ready-assets folder>
```

The script keeps only the animations the game uses, bundles all static models into `props.glb`, and meshopt-compresses everything.

## Where things live

| File | What it does |
| --- | --- |
| `src/config.ts` | All balancing: costs, damage, weapon tiers, waves, roads, plot layout |
| `src/run.ts` | Gameplay: hero, horde, defenders, workshops, waves, economy, hints |
| `src/road.ts` | Road curves the horde walks along |
| `src/assets.ts` | Loads the KayKit models; animated character rigs |
| `src/horde.ts` | Goblin re-skin and baked instanced animations so hundreds of enemies stay cheap |
| `src/structures.ts` | Towers, castle, workshops, hero and troops built from the models |
| `src/models.ts` | Shared materials, small procedural bits (coins, particles, lanterns) |
| `src/world.ts` | Meadow terrain, roads, scenery (merged into chunks), lighting |
| `src/plot.ts` | Build-plot markers (icon, label, remaining cost) |
| `src/perks.ts` | Level-up perk deck |
| `src/kingdom.ts` | Wood/stone/food stockpile, woodcutters, miners, farmers, builders, townsfolk, houses |
| `src/render.ts` | Post-processing: bloom, colour grade, vignette, adaptive quality |
| `src/materials.ts` | PBR materials with world-space detail texture, baked environment light |
| `src/particles.ts` | GPU point-sprite particles and effect presets |
| `src/hud.ts`, `src/style.css` | HUD, menus, health bars, level-up cards |
| `src/input.ts` | Floating joystick and keyboard |
| `src/audio.ts` | Synthesized sound effects |

`npm run build:single` produces one self-contained HTML file in `dist-single/`, for sharing a playable demo.
