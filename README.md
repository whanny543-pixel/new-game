# Hearthguard

A portrait, one-thumb medieval kingdom-defense game for iOS and Android.

You are the king. Your realm is a dusty wasteland crawling with goblins. Lead your squad across it, fence in one land after another (each one turns green the moment its fence closes) and hold off ever-bigger goblin raids.

**How it plays**
- **Drag** anywhere to move. The king and his squad fight on their own.
- Goblins drop gold, and coin piles lie around the wasteland. Gold stacks up into a tower on the king's back. **Stand on a plot** and the gold flies off the stack into it.
- **Archery Range / Barracks:** pay the green recruit pad and a band of archers or knights runs out and joins the ring of troops marching around the king.
- **Lookouts:** build a timber platform, then stand on its pad and your squad's archers climb up, one by one. Upgraded lookouts get a ballista.
- **Fences:** each land is a square bordered by fence pieces. Build every piece around a land and it's **claimed**: grass and flowers spread out across it, its buildings unlock, houses and villagers move in, and a treasure chest pops up. Fences between two claimed lands sink away; the outer ones are your border.
- Goblins come out of the fog from any side and smash their way through your fences toward the keep. Broken fences can be rebuilt for half price. Every few raids an **ogre warlord** joins in.
- **Forge:** makes armour kits. Walk past to pick them up and they go to your troops automatically, raising them from Recruit to Iron, Steel and Royal (blue, then gold).
- **Gold Mines** pile up gold bars to scoop up. The **Castle** grows from a log camp to a citadel as you claim lands; from the Stone Keep on, fences and workshops are rebuilt in stone.
- Claim all seven lands, then beat the Warlord's Host to win the kingdom.

**Campaign**
- A world map of four kingdoms (Greenvale, Amberwood, Ashmoor, Frostpeak), each harder and with its own colours.
- Raids survived and kingdoms won earn **crowns** for the **King's Armory**: Royal Sword, Royal Armour, Swift Boots, War Banner, Treasury and Scepter.

**The king's powers:** every kill gives XP, and each level offers three perk cards. Kills also charge the **Arcane Nova** button, which blasts the horde back.

Built with Three.js and TypeScript (Vite), and packaged for the app stores with Capacitor.

**Art (all CC0, free for commercial use):**
- KayKit by Kay Lousberg (www.kaylousberg.com): characters, castle and town buildings, nature, dead trees and rocks (Forest Nature pack), gold bars.
- Kenney (www.kenney.nl): the timber palisade, lookout platforms, workbenches, campfires and the ballista.
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
#    kaykit-resource-bits, kaykit-forest-nature; their models are in Git LFS)
node tools/build-assets.mjs <folder with the KayKit clones> <jam-ready-assets folder>
```

The script keeps only the animations the game uses, bundles all static models into `props.glb`, and meshopt-compresses everything.

## Where things live

| File | What it does |
| --- | --- |
| `src/realm.ts` | The map of lands, build spots, and all conquest tuning (costs, raids, troops) |
| `src/conquest.ts` | Gameplay: king, squad, lookouts, fences and claiming, workshops, raids, economy, hints |
| `src/territory.ts` | Green spreading over claimed land, wasteland scenery, fog banks |
| `src/config.ts` | Player and goblin stats, kingdoms, armory |
| `src/assets.ts` | Loads the 3D models; animated character rigs |
| `src/horde.ts` | Baked instanced animations so hundreds of goblins stay cheap |
| `src/structures.ts` | Castle, workshops, lookouts, fences, king and troops built from the models |
| `src/models.ts` | Shared materials and small procedural bits (coins, mesas) |
| `src/world.ts`, `src/road.ts` | Ground, winding trails, lighting, static-mesh merging |
| `src/plot.ts` | Build-plot markers (icon, label, remaining cost) |
| `src/perks.ts` | Level-up perk deck |
| `src/render.ts` | Post-processing: bloom, colour grade, vignette, adaptive quality |
| `src/materials.ts` | PBR materials with world-space detail texture, baked environment light |
| `src/particles.ts`, `src/fx.ts` | GPU particles, flying coins, damage numbers |
| `src/hud.ts`, `src/style.css` | HUD, menus, health bars, level-up cards |
| `src/input.ts` | Floating joystick and keyboard |
| `src/audio.ts` | Synthesized sound effects |

`npm run build:single` produces one self-contained HTML file in `dist-single/`, for sharing a playable demo.
