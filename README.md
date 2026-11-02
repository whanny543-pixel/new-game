# Hearthguard

A portrait, one-thumb medieval defense game for iOS and Android.

Gold drops from the goblins your knight shoots, and it stacks up on the knight's back. Stand on a build plot to spend it on archer towers, palisades, squires, forge upgrades, gold mines and more land. Hold the keep for as many waves as you can, with a troll boss every third wave.

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
| `src/config.ts` | All balancing: costs, damage, wave sizes, plot layout |
| `src/run.ts` | Gameplay: hero, enemies, waves, building, economy |
| `src/models.ts` | Procedural low-poly models |
| `src/world.ts` | Terrain, territory growth, decoration, lighting |
| `src/plot.ts` | Build-plot markers (icon, label, remaining cost) |
| `src/hud.ts`, `src/style.css` | HUD, menus, health bars |
| `src/input.ts` | Floating joystick and keyboard |
| `src/audio.ts` | Synthesized sound effects |

`npm run build:single` produces one self-contained HTML file in `dist-single/`, for sharing a playable demo.
