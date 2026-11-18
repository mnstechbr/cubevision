# Graph Report - CubeVision  (2026-11-18)

## Corpus Check
- 33 files · ~17,677 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .css 2, (none) 1, .task 1)

## Summary
- 258 nodes · 590 edges · 14 communities (12 shown, 2 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 52 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9230dedb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- holo.ts
- hands.ts
- package.json
- Dive
- CubeVision
- compilerOptions
- layers.ts
- main.ts
- ui.ts
- boot
- stage.ts
- orbit.ts
- Particles
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `boot()` - 24 edges
2. `three` - 21 edges
3. `Dive` - 20 edges
4. `Lines` - 19 edges
5. `Layer` - 18 edges
6. `rng()` - 13 edges
7. `layerBase()` - 13 edges
8. `lineMaterial()` - 13 edges
9. `targetMaterial()` - 13 edges
10. `Intents` - 13 edges

## Surprising Connections (you probably didn't know these)
- `DiveHost` --references--> `Orbit`  [EXTRACTED]
  src/engine/dive.ts → src/engine/orbit.ts
- `DiveHost` --references--> `Particles`  [EXTRACTED]
  src/engine/dive.ts → src/engine/particles.ts
- `boot()` --calls--> `Dive`  [EXTRACTED]
  src/main.ts → src/engine/dive.ts
- `boot()` --calls--> `nextOf()`  [EXTRACTED]
  src/main.ts → src/engine/layers.ts
- `boot()` --calls--> `loadLayer()`  [EXTRACTED]
  src/main.ts → src/engine/layers.ts

## Import Cycles
- None detected.

## Communities (14 total, 2 thin omitted)

### Community 0 - "holo.ts"
Cohesion: 0.22
Nodes (24): three, layerBase(), Lines, rng(), AMBER, CYAN, edges(), fillMaterial() (+16 more)

### Community 1 - "hands.ts"
Cohesion: 0.10
Nodes (15): Gestures, HandFrame, Slot, setup(), ASSETS, fetchAssets(), HandsSession, openCamera() (+7 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (31): dependencies, @fontsource/ibm-plex-mono@^5.3.0, @mediapipe/tasks-vision@^1.2.3, three@^0.187.0, @vercel/analytics@^2.0.1, @vercel/speed-insights@^2.1.0, devDependencies, @types/three@^0.187.0 (+23 more)

### Community 3 - "Dive"
Cohesion: 0.10
Nodes (16): Dive, DiveHost, smooth(), State, UP, Fade, disposeTree(), Layer (+8 more)

### Community 4 - "CubeVision"
Cohesion: 0.10
Nodes (20): 10. Decisões (fechadas no kickoff, 2026-11-18), 11. Regras de trabalho, 1. Visão, 2. A história: camadas, 3. Gestos, 4. Arquitetura, 5. Privacidade e LGPD, 6. Desempenho: checklist adaptado (+12 more)

### Community 5 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noUnusedLocals, noUnusedParameters (+5 more)

### Community 6 - "layers.ts"
Cohesion: 0.27
Nodes (9): vitest, arrived(), ctx, run(), LayerModule, loaders, loadLayer(), nextOf() (+1 more)

### Community 7 - "main.ts"
Cohesion: 0.17
Nodes (8): holo, textPoints(), showReveal(), debug, DETAIL, params, PARTICLES, requested

### Community 8 - "ui.ts"
Cohesion: 0.18
Nodes (9): LayerId, dict, i18n, Lang, lang, listeners, Strings, cursorEls (+1 more)

### Community 9 - "boot"
Cohesion: 0.25
Nodes (6): createDust(), Orbit, atMost(), boot(), setCamLabel(), startCamera()

### Community 10 - "stage.ts"
Cohesion: 0.29
Nodes (4): createGovernor(), createStage(), PIXEL_RATIO, Stage

### Community 11 - "orbit.ts"
Cohesion: 0.40
Nodes (4): View, copy(), Pose, UP

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `three` connect `holo.ts` to `package.json`, `Dive`, `layers.ts`, `main.ts`, `stage.ts`, `orbit.ts`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `boot()` (e.g. with `.expand()` and `.intro()`) actually correct?**
  _`boot()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Should `hands.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10256410256410256 - nodes in this community are weakly interconnected._
- **Why does `Dive` connect `Dive` to `boot`, `layers.ts`, `main.ts`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06825396825396825 - nodes in this community are weakly interconnected._
- **Why does `Layer` connect `Dive` to `holo.ts`, `layers.ts`, `main.ts`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Should `Dive` be split into smaller, more focused modules?**
  _Cohesion score 0.10317460317460317 - nodes in this community are weakly interconnected._