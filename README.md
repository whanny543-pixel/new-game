# Hearthguard

A portrait, one-thumb medieval road-defense game for iOS and Android.

Skeleton hordes march down winding roads toward your castle. Your hero shoots on their own, and gold from fallen goblins stacks up on their back. Spend it by standing on build plots.

**The defense loop**
- **Watchtowers** sit beside the road. They're empty when built: recruit archers at the **Archery Range** and lead them to a free tower. Upgrades add a second archer slot, then a ballista.
- **Guard posts** hold the road itself. Recruit knights at the **Barracks** and lead them to a post, where they block and fight the horde.
- **Barricades** stall the horde until they're smashed (rebuild them for gold).
- The **Forge** makes swords and the **Bowyer** makes bows. Both stack up on a rack. Pick them up and walk past your knights and archers to hand them over. Upgrading a workshop makes better weapons: Iron → Steel → Gold.
- A second road opens at wave 7, and a troll boss arrives every 4th wave. Trolls drop treasure chests.
- **Hero levels:** every kill gives XP. Each level offers three perk cards (Volley, Fire Arrows, Storm Bolts, Keen Eye, War Banner, Golden Touch and more).
- **Combos:** chain kills quickly for streak bonuses. Coins are worth more as the waves climb.

A dotted trail always points to the most useful next step, and a hint line at the bottom explains it.

Built with Three.js and TypeScript (Vite), and packaged for the app stores with Capacitor.

**Art:** 3D models are from the KayKit packs by Kay Lousberg (www.kaylousberg.com), released under CC0, so they're free for commercial use with no attribution required (credited on the title screen anyway). The packs used are Character Pack: Adventurers, Character Pack: Skeletons, Medieval Hexagon Pack and Dungeon Remastered. Sound effects are synthesized in code.

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
node tools/build-assets.mjs <folder with those clones>
```

The script keeps only the animations the game uses, bundles all static models into `props.glb`, and meshopt-compresses everything.

## Where things live

| File | What it does |
| --- | --- |
| `src/config.ts` | All balancing: costs, damage, weapon tiers, waves, roads, plot layout |
| `src/run.ts` | Gameplay: hero, horde, defenders, workshops, waves, economy, hints |
| `src/road.ts` | Road curves the horde walks along |
| `src/assets.ts` | Loads the KayKit models; animated character rigs |
| `src/horde.ts` | Bakes skeleton animations into instanced poses so hundreds of enemies stay cheap |
| `src/structures.ts` | Towers, castle, workshops, hero and troops built from the models |
| `src/models.ts` | Shared materials, small procedural bits (coins, particles, lanterns) |
| `src/world.ts` | Meadow terrain, roads, scenery (merged into chunks), lighting |
| `src/plot.ts` | Build-plot markers (icon, label, remaining cost) |
| `src/perks.ts` | Level-up perk deck |
| `src/render.ts` | Post-processing: bloom, colour grade, vignette, adaptive quality |
| `src/materials.ts` | PBR materials with world-space detail texture, baked environment light |
| `src/particles.ts` | GPU point-sprite particles and effect presets |
| `src/hud.ts`, `src/style.css` | HUD, menus, health bars, level-up cards |
| `src/input.ts` | Floating joystick and keyboard |
| `src/audio.ts` | Synthesized sound effects |

`npm run build:single` produces one self-contained HTML file in `dist-single/`, for sharing a playable demo.
