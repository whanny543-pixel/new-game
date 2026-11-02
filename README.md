# Hearthguard

A portrait, one-thumb medieval road-defense game for iOS and Android.

Goblin hordes march down winding desert roads toward your town hall. Your hero shoots on their own, and gold from fallen goblins stacks up on their back. Spend it by standing on build plots.

**The defense loop**
- **Watchtowers** sit beside the road. They're empty when built: recruit archers at the **Archery Range** and lead them to a free tower. Upgrades add a second archer slot, then a ballista.
- **Guard posts** hold the road itself. Recruit knights at the **Barracks** and lead them to a post, where they block and fight the horde.
- **Barricades** stall the horde until they're smashed (rebuild them for gold).
- The **Forge** makes swords and the **Bowyer** makes bows. Both stack up on a rack. Pick them up and walk past your knights and archers to hand them over. Upgrading a workshop makes better weapons: Iron → Steel → Gold.
- A second road opens at wave 7, and a troll boss arrives every 4th wave. Trolls drop treasure chests.
- **Hero levels:** every kill gives XP. Each level offers three perk cards (Volley, Fire Arrows, Storm Bolts, Keen Eye, War Banner, Golden Touch and more).
- **Combos:** chain kills quickly for streak bonuses. Coins are worth more as the waves climb.

A dotted trail always points to the most useful next step, and a hint line at the bottom explains it.

Built with Three.js and TypeScript (Vite), and packaged for the app stores with Capacitor. All models and sounds are generated in code, so there are no asset files to license.

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

## Where things live

| File | What it does |
| --- | --- |
| `src/config.ts` | All balancing: costs, damage, weapon tiers, waves, roads, plot layout |
| `src/run.ts` | Gameplay: hero, horde, defenders, workshops, waves, economy, hints |
| `src/road.ts` | Road curves the horde walks along |
| `src/models.ts` | Procedural low-poly models (instanced horde, merged buildings) |
| `src/world.ts` | Desert terrain, roads, scenery, lighting |
| `src/plot.ts` | Build-plot markers (icon, label, remaining cost) |
| `src/perks.ts` | Level-up perk deck |
| `src/render.ts` | Post-processing: bloom, colour grade, vignette, adaptive quality |
| `src/materials.ts` | PBR materials with world-space detail texture, baked environment light |
| `src/particles.ts` | GPU point-sprite particles and effect presets |
| `src/hud.ts`, `src/style.css` | HUD, menus, health bars, level-up cards |
| `src/input.ts` | Floating joystick and keyboard |
| `src/audio.ts` | Synthesized sound effects |

`npm run build:single` produces one self-contained HTML file in `dist-single/`, for sharing a playable demo.
