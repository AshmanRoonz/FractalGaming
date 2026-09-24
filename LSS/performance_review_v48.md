# Performance review v48.32: adversarially verified findings

> Companion to [`lss.map.md`](lss.map.md) and [`performance_review.md`](performance_review.md) (measured baseline v47.01-47.15). Source: `LSS/index-working.html` at **v48.32**, reviewed **2026-09-24**. **121 findings** were verified by independent adversarial reviewers: **86 survived and 35 were refuted**. This synthesis then overturned one more survivor and trimmed three others (see *Synthesis correction*). Every impact figure is the **verifiers' corrected number**, labelled **measured** (node or headless-Chrome bench against the shipped code), **computed** (arithmetic from the source and the baseline) or **estimated**. Nothing was measured in the pane, because the owner was using it. Every GPU claim therefore needs the A/B in *Measurement plan* before anyone quotes fps.
>
> **Method.** 32 finder agents (21 subsystem slices, 5 cross-cutting lenses, 6 critic-directed follow-up hunts) -> every finding attacked by two independent verifiers (code truth + hotness; safety + prior art), with a tiebreak judge on splits -> synthesis. Agents benchmarked in node / headless Chrome against the shipped functions; nobody edited the game and nobody drove the owner's pane.
>
> **Hand spot-checks after synthesis (re-read in the source, not taken on trust):** r165 `ShaderMaterial` constructor sets `forceSinglePass = true` (three.module.js r165, class ShaderMaterial) - the synthesis correction below holds; r165 `lights_fragment_begin` calls `RE_Direct` unconditionally per point light (O1.3); `LSSEarthTiles.updateNight` does a whole-scene `traverse` per patch per frame (O1.1); every NetworkPlayer is pushed to both `net.networkPlayers` and `game.entities` and both loops call `_processShipForLabel` (O1.7); gameLoop stamps `_lssLastRafAt` at frame START and the bg worker's 33 ms messages test it (O1.9); the ground branch of `_swPatchTerrainMat` ends `diffuseColor.rgb=terr;` so the ground `vColor` is dead (O1.14); `_sm = _fxSmallDevice() && _swVrNoRefl()` sits after `if (_swVrNoRefl()) return;` so it is always false (O2.26). All seven held.
>
> Owner constraint, applied throughout: every fix below is visually identical, imperceptible, or an improvement. Nothing here lowers quality.

---

## Status after the v48.33-48.37 pass (2026-09-24)

Implemented and measured in the pane against a byte-exact v48.32 served beside it (details, traps and knobs: the *v48.33-48.37 - the performance pass* entry at the end of `lss.map.md`).

| item | status | measured |
|---|---|---|
| O1.1 Earth sun walk + matfix | **shipped** | sun lookup 0.576 -> 0.064 ms/frame at spawn (9 patches); `earth:matfix` -> 0 |
| O1.3 dark-light skip | **shipped** | pixel-identical by construction; 264/264 programs link; GPU A/B at 1080p still to do |
| O1.4 mirror matrix walk | **shipped** | 1.34 -> 1.00 scene walks/frame (0.343 ms each at 2,093 nodes) |
| O1.2 far-foliage gate, islands + parks | **shipped** | both gates -2.6 M tris, -60..78 draws/frame near the city; new gate hides 69 meshes / 4.1 M instanced tris |
| O1.10 crest readback prologue | **shipped** | 1.05 -> 0.05 ms avg, 5.0 -> 0.2 ms worst per readback |
| O1.11 sky islands (memo + slices + keep + curtain bake) | **shipped** | 20 s dash: frames > 40 ms 3 -> 0, worst 43.4 -> 30.5 ms, island work/frame 29.1 -> 0.6 ms max |
| O1.9 stall watchdog | **shipped** (+ a second bug found) | extra frames after a 200/300 ms frame 7/9 -> 0; watchdog no longer dies after one alt-tab |
| O1.7 peer tag double-processing | **shipped** | not yet watched in a two-tab room |
| O1.8 HUD hatch cull | **shipped** | pixel-identical; GPU-process cost per the review's harness |
| O2.22 CORE glow union | **shipped, owner to judge** | 2.45 -> 0.92 ms/redraw (harness); not pixel-identical - `__hudCore = {glowUnion: 0}` reverts live |
| O2.27 endless corpse sweep | **shipped** | watched live: entities stay at one wave's 6 across waves 2-3 |
| O2.29 VR label adoption | **shipped** | not yet exercised in XR |
| O2.23 HUD layer cache | **shipped v48.38** | GPU-process per HUD draw at 1080p/DPR 1.25: full 3.24 -> 1.25, CORE ready 3.41 -> 1.25, combat 2.50 -> 1.46 ms (harness, real span); pixels within Skia's own variance; no in-pane fps change either way |
| O2.10 smoke cone rebuild + lazy ribbon | **shipped v48.39** (+ 2 shared-sphere disposals found) | 180 live-cone frames -> 11 cone builds (10 s window); 0 core / 0 haze sphere disposals over the session (salvo strip and `removeHaze` freed them per shot) |
| O2.13 projectile core shadow | **shipped v48.39** | castShadow off |
| O2.15 callout LOS stagger | **shipped v48.39** | phase-aligned tags disperse to 0-1 tests/frame within a cycle |
| O2.20 replay keep | **shipped v48.39** | keep now 0.34 s into the picker (its IDB put: 9.3 ms, main thread) instead of mid 3-2-1 |
| O2.25 k-rate panners + listener | **shipped v48.39** | offline render, 16 HRTF panners: 720 -> 203 ms per 4 s (~18 % -> ~5 % of the audio thread); ILD diff median 0.37 dB |
| O2.30 post-match picker rebuild | **shipped v48.39** | 3 map clicks: 3 rebuilds (160/111/104 ms frames) -> 0; launch still rebuilds a changed biome |
| O2.33 arena grid | **shipped v48.39** | 61,206 segments -> 606 lines on desktop, coverage node-checked identical |
| O1.13 paired shells | **shipped v48.40** | bit-identical (`tools/terrain_pair_check.mjs`); both shells of a chunk 5.05 -> 1.86 ms with O1.14; in-page 5x5 core 72-78 -> 44-48 ms |
| O1.14 ground colour skip + palette cache | **shipped v48.40** | ground-only render with magenta vs original vertex colours: 0 bytes differ |
| O1.12 Spire trig tables | **shipped v48.40** | bit-identical (`tools/spire_table_check.mjs` + `arena_port_check.cjs`); in-page Spire mesh 28.6 -> 11.0 s, nav lattice 5.5 -> 2.7 s |
| O1.15 hub deck noise tables | **shipped v48.40** | byte-identical (`tools/hub_deck_bake_check.mjs`); `[hubcity] built` genMs 412 -> 60-65 |
| O2.19 wild leviathan arrival | **shipped v48.41** (prebake) | 5 packs arriving: skinned sphere computes in play 11 -> 0, new programs 1 -> 0, LoAFs 100 + 74 ms -> none |
| O2.17 hull ray grid | **shipped v48.41** | grid vs three on 9,000+ live segments: 100 % agree; 0.004-0.013 vs 0.46-1.96 ms per ray; grids prebuilt (39 in 136 ms) |

---

## Synthesis correction: r165 `ShaderMaterial` is already single-pass

`three165/package/src/materials/ShaderMaterial.js:33` sets `this.forceSinglePass = true`. The base `Material.js:71` sets `false`. The two-pass split in `WebGLRenderer.renderObject` (`transparent && side === DoubleSide && forceSinglePass === false` → BackSide draw + FrontSide draw, each after `needsUpdate`) therefore only hits the **built-in** materials. The game pins `three@0.165.0` (L6510) and never sets `forceSinglePass` itself (0 hits). Consequences:

- **Lightning pool is already one draw per mesh.** `_initLightningPool` L83399/L83413 uses `new THREE.ShaderMaterial` for both halo and core. So survivor **#44 is overturned** (it survived at confirmed 0.87 / partial 0.86; see *Checked and NOT a problem*), and step (A) of #47 is a no-op.
- **Also ShaderMaterials, so already single-pass:** smoke cone (`_makeSmokeConeMaterial` L20050), fire clouds and class muzzle fire (`_makeFireCloudMaterial` L19294), the rainbow (`_wxMakeBow` L56665), the shield bubble, the BCS and the Reflector. They are removed from the `forceSinglePass` item (O2.11). The impact estimates in #36 and #5 that counted them are void.
- **What remains real:** additive, depthWrite-off **`MeshBasicMaterial`** FX. That is the projectile ribbon, the replay ribbon, the headlight cones, the wall-ripple ring, organic decorations, and the hub pad rings, beams, cones and island rings.

**Merged:** #29+#64 (light skip) · #63+#66+#62 (Earth traversals) · #65+#69 (dome gate) · #5+#36+#28, with #44 and #47A voided (single-pass) · #32+#35+#57 (idle shields) · #39+#73 (water silhouettes) · #40+#74 (leviathan arrival) · #42+#45 (atom registry) · #30+#68 (cabin shadows) · #23+#79 (water sheet cull) · #9+#41 (BCS per-sprite constants). #1/#3, #49/#81/#82 and #10/#83 are cross-referenced but kept separate. They share a system, not a root cause.

**Relationship to the known-open list:** O2.3 (clipmap sector cull) complements *clipmap ring occlusion*; it does not overlap it. O1.13 (paired shell evaluation) complements *skip `_stCeilY` where dead*. O2.31 **is** the map's own open item (v39.79: "Open, not done: shrink the prebake's GPU-warm viewport"). Nothing here addresses *room launch has no watchdog*.

---

## 1. Summary

- **Earth family, CPU:** each city patch walks the whole scene every frame to find the same sun. That is 0.7 ms at spawn and up to 5.4 ms per frame after wandering a big city, on desktop. One walk fixes it (O1.1). Roofs also cast 25-70 shadow draws per frame that write no texels (O1.6).
- **Hub GPU** (the hub is GPU-bound at 1080p):
  - zero-pixel foliage in sky islands and city parks, 1-2.7 M triangles per frame (O1.2);
  - pinned dark lights running the full GGX BRDF on every lit fragment in every mode, which matters most on phones (O1.3);
  - dust and HII noise in the galaxy dome that is provably zero (O1.5);
  - in Order 2: the ~24-26 % of the scene render that Panini never displays (O2.1), shadow-pass trees (O2.2), and the back halves of the clipmap and water sheet (O2.3-2.4).
- **CPU:** the water mirror re-walks every world matrix (O1.4). A peer's callout tag is rebuilt twice per frame, costing +0.47 to 1.17 ms per frame in rooms (O1.7). Race rocks cost ~340 draws per frame, about 1.2-3.8 ms (O2.9).
- **Hitches:**
  - the stall watchdog adds +33 to 76 ms (desktop) to every hitch of 120 ms or more (O1.9);
  - the crest readback blocks on `getParameter` (O1.10);
  - sky-island builds take 8-24 ms and are billed to `hub:clip` (O1.11);
  - a sonar hull raycast takes 23 ms per call (O2.17);
  - a leviathan family arrival costs 6-35 ms (O2.19);
  - water silhouette rebuilds (O2.18);
  - the replay keep lands during the live 3-2-1 (O2.20).
- **Loading:** The Spire's field becomes ~3x cheaper per sample, which saves seconds (O1.12). Chunk shells drop 50-60 % (O1.13-1.14). The hub moss bake drops ~200 ms (O1.15). The post-match picker's throwaway rebuild on every click goes away (O2.30). The prebake scissor is known-open (O2.31).
- **HUD:** the canvas HUD costs 0.7-3.5 ms of GPU-process raster per redraw, on the same GPU main thread as the game's WebGL (O1.8, O2.22-2.23).
- **Long sessions:** endless never frees dead bots, the atom-fractal registry only grows, and VR name labels leak one per bot per round (O2.27-2.29).
- **XR and phone:** VR label line-of-sight is uncached (O2.24). The phone mirror has refreshed at the desktop rate since v41.82 (O2.26). Idle shield bubbles are full-screen discard layers in the seat (O2.14).

---

## 2. Findings

### ⭐⭐⭐ ORDER 1: high impact, low risk, graphics-identical

#### In-play CPU / GPU

**O1.1 · Earth: one full scene traverse per city patch every frame (`updateNight`), plus a dead material fix-up traverse.** [#63 #66 #62]
- **Where:**
  - L147113-147119 `LSSEarthTiles.updateNight`;
  - L149202-149205 `LSSEarthWorld.updateNight`, called every frame from `_lssGmapsTick` L150336;
  - L150484-150498, the matfix traverse.
  - Jump: `updateNight(scene) {` · `__pmark('earth:matfix');`
- **Modes:** FREE FLIGHT: EARTH, Custom Location (streams as `LSSEarthWorld` since v46.87), the Earth Circuit race, custom-location assault. All platforms.
- **Mechanism:**
  - `LSSEarthWorld.updateNight` forwards the call to every patch: `for (const p of this._patches.values()) p.updateNight(scene);`.
  - Every patch with a cyberpunk wall material (the default, `cyberpunk: level.cyberpunk !== false`) then runs `scene.traverse((o) => { if (o.isDirectionalLight && o.intensity > bi) ... })` over the **whole scene**. That includes ~900 pooled hidden FX meshes, the ships and every patch. It gets the same answer P times per frame.
  - Separately, `t.group.traverse` runs every frame and allocates `[c.material]` per mesh. It patches materials that only the long-dead 3d-tiles path needed (`_lssGmapsLoadModule` has no callers). Today it changes exactly two things: the Earth ad panels' `_hcHoloMat` (authored `transparent:true, depthWrite:false`, L48438) and the debug river.
- **Impact:** measured with real r165 objects at 25-29 ns per node.
  - At spawn (P=9, 3-5k nodes): **0.7-1.2 ms per frame**.
  - P=16: **~2.7 ms**.
  - P=25, after wandering a big city: **~5.4 ms**.
  - These are desktop figures against Earth's 8.4 ms frame. Pixel 9 and Quest are ~2-3x.
  - matfix adds 0.01-0.1 ms and 1.9-5k short-lived arrays per frame.
  - The v47.13 self-profile already showed "`updateNight` 1,505 ms" across one round transition (lss.map.md line 23), and nobody followed it up.
- **Fix:**
  - (a) In `LSSEarthWorld.updateNight`, first check whether any patch (or `_far`) has `_wallMat.userData.uSunV`. If one does, walk the scene **once** with a hoisted visitor (no per-frame closure), then write `sun.position.normalize()` into every patch's `uSunV`. Give `LSSEarthTiles.updateNight(scene, sun)` an optional second argument; the one-argument form must keep working for the single-patch class and the overlay loader (L150788).
  - (b) In `_buildAdPanels`, right after `const mat = _hcHoloMat();` (L148049), add `mat.transparent = false; mat.depthWrite = true;`. Do the same in `_buildLocalWater`, then delete the traverse.
- **Risks:**
  - Keep the method names: callers go through `typeof t.updateNight === 'function'`.
  - Do not cache the light forever. Picker and thumbnail directional lights exist (L62311, L63122), and `_lssEarthApplyDayNight` changes intensities every blend step, so keep the one walk.
  - matfix flips the holo material to **opaque** on its first frame. The program in use today is therefore the opaque single-pass DoubleSide one. Baking the flags at creation keeps that program. "Restoring" `transparent:true` would create a new BackSide/FrontSide pair of programs.
- **Measure:** set `window.__profOn = true` and compare `__prof['earth:tiles']` / `['earth:matfix']` before and after. Get the formula's inputs with `lssGmaps.state.tiles._patches.size` and `let n=0; scene.traverse(()=>n++); n`.
- **Votes:** #63 partial 0.87 / partial 0.82 · #66 confirmed 0.85 / partial 0.86 · #62 partial 0.72.

**O1.2 · The v47.05 far-foliage gate misses sky-island trees and city park trees (1-2.7 M zero-pixel triangles per frame).** [#25]
- **Where:**
  - L53564 `const im = new THREE.InstancedMesh(pool[pal[b]], mat, cnt);`; the material pick is at L53522;
  - the gate `_swTreeVisTick` L36287, called at L132185;
  - the collapse is in the `_swFoliageMat` VS at L35980.
  - Jump: `function _swTreeVisTick`
- **Modes:** freeflight, cyberpunk, campaign hub (desktop B = 8208).
- **Mechanism:**
  - The foliage VS ends `float tfade=1.0-smoothstep(uTreeFadeA,uTreeFadeB,...); transformed*=tfade;`. Instances past B collapse to zero-area triangles but still pay the full instanced vertex work.
  - v47.05 hides such meshes, but it only walks `game.sandwichChunks`.
  - Sky islands are built out to `SKY_I.range = 30000` (L52945) and never hidden. City park trees use the same materials, are never gated, and also cast, so the shadow pass pays for them too.
- **Impact:** computed at B = 8208.
  - Sky islands: 0.7-0.9 M zero-pixel tris and 17-20 draws in the main pass, plus ~0.3 M averaged over mirror frames.
  - Hub parks, freeflight at spawn: ~0.6 M tris averaged over yaw (1.11 M facing the city) in the main pass, plus the shadow pass.
  - v47.05's **measured** rate was −1.14 M tris and −44 draws for −0.36 ms GPU and +5.5 fps at 1080p. By that rate this is roughly **0.3-0.8 ms GPU per frame at 1080p** (estimated).
- **Fix:**
  - Add a separate `_swFolVisExtra(cx, cz)` called right after `_swTreeVisTick` at L132185, in its own `try`. It must not sit behind the `chunks.size` early return, and a throw in it must not reach the chunk gate.
  - Reuse every guard: the `__treeVisCull` restore, bendWorld, `_worldPrebaking` / `_swPreloading` / `_swapStaging` / `_rrStaging`, `__lssWarmDraw`, `_PREBAKE.on`, and `B > 0`.
  - Iterate the owners directly (cache `I._fol` in `_skBuild`, plus the park-tree list at build). Do not add a registry Set whose unregister bookkeeping could go stale.
- **Risks:**
  - `InstancedMesh.computeBoundingSphere` iterates `count`, so compute the sphere once at full count before any gating.
  - Never gate while the curtain is down: far submits are what link the tree and shroom programs (the v47.05 rule).
  - Touch only meshes on the two foliage materials. Leave `_skVineMat`, island buildings and the v46.71 drapes alone.
- **Measure:** symmetric toggle, interleaved A/B at 1920×1080 on a settled world. Read tris, calls and fps (with `autoReset=false`), plus `?pbseg` `scene` and `mirror` and `window.__treeVis`.
- **Votes:** confirmed 0.85 / partial 0.78.

**O1.3 · Pinned dark lights run the full GGX BRDF on every lit fragment. A one-time `lights_fragment_begin` patch makes them free.** [#29 #64]
- **Where:**
  - the patch goes in the fog_vertex `ShaderChunk` try block at L24264-24266 (before the renderer exists);
  - the pinned lights: pool L70729/L70747, engine L70938, traffic L70878/L70955, cockpit pair L96470-96471, spot headlight L70947.
  - Jump: `(function initDynamicLights() {` · `NUM_POINT_LIGHTS PINNING`
- **Modes:** every mode and platform. Desktop has 14 point + 1 spot, phones 11 + 1, Quest 7 + 1. It runs in the main, mirror, refraction and ADS passes.
- **Mechanism:**
  - r165's loop does `getPointLightInfo(...); RE_Direct(...)` unconditionally.
  - `directLight.visible` (set as `color != vec3(0)`) gates only shadow sampling.
  - An intensity-0 light has an exactly-zero colour, and a fragment past a light's `distance` gets exactly 0 from the cutoff window. Both still pay `RE_Direct_Physical` + `BRDF_GGX` (~65-70 scalar ops).
  - The L70743 comment assumes the "noop light iterations" are nearly free. On r165 they are not.
  - **The pinning stays.** The patch changes no `NUM_*_LIGHTS` and no program key.
- **Impact:** FXC proxy, estimated.
  - The lighting block of a lit Standard fragment goes from **838 → 436 DXBC** when all guarded lights are dark.
  - A far terrain fragment goes from ~2,160 → ~1,760 (−19 %); a near one saves ~15 %. Lambert (the city) saves only ~10 per light.
  - Desktop hub at 1080p (GPU-bound): **~0.1-0.25 ms GPU per frame**. Arenas get headroom, not fps.
  - Phones: plausibly **0.5-2 ms** (estimated, unmeasured).
- **Fix:**
  - With exact-text anchors, wrap the point-loop and spot-loop `RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );` in `if ( directLight.visible ) { ... }`.
  - Optionally also skip `getPointLightInfo` when `pointLight.color == vec3(0.0)`.
  - Assert that every anchor matched exactly the expected number of times. If not, `console.warn` and leave the chunk untouched.
  - Gate it behind `?nolightskip` and set `window.__lightSkip`.
- **Risks:**
  - It must run before the first compile. `ShaderChunk` text is not in the program cache key; the fog_vertex site is proven early enough.
  - After deploy there is a one-time Chrome shader-cache miss on every lit program; the prebake absorbs it.
  - FXC may flatten the branch: then there is no gain, but also no loss.
  - A three upgrade changes the chunk text, which is why the asserts exist.
- **Measure:** `?nolightskip` reload A/B at a frozen pose with the governor scale fixed (`__ss`). Read `?pbseg` `scene` and `mirror` in the hub at 1080p, in classic, and on the phone and Quest. A pixel diff should show zero changes.
- **Votes:** #29 partial 0.78 ×2 · #64 partial 0.75 / confirmed 0.85.

**O1.4 · The water-mirror pass re-walks the whole scene graph: the Reflector's nested `render(scene)` repeats `scene.updateMatrixWorld()`.** [#1]
- **Where:** L46033, the `mesh.onBeforeRender` wrapper in `_swBuildHubWater`. Jump: `const _reflOBR = mesh.onBeforeRender;`
- **Modes:**
  - the hub family, endless, Earth with sea, and any map with the `_hubWater` Reflector;
  - phones too, which refresh at the desktop cadence (see O2.26).
- **Mechanism:**
  - r165 `render()` begins `if ( scene.matrixWorldAutoUpdate === true ) scene.updateMatrixWorld();`.
  - The stock Reflector turns off `xr.enabled` and `shadowMap.autoUpdate`, but not this, and it renders from inside the main pass's `renderObjects`. Every world matrix has already been updated this frame.
  - `Scene.matrixAutoUpdate` is true, so `force` recomposes and re-multiplies every node again. Nothing moves between the two walks:
    - the wrapper's own underwater flip calls `updateMatrixWorld(true)` itself;
    - `_reflLift` (L45678-45708) touches materials only.
  - The same pin already exists for the ADS overlay pass (v39.49, L97733-97760).
- **Impact:** node bench of r165 `updateMatrixWorld` at 92-160 ns per object, with an estimated 3-6k nodes and 24 refreshes in 69 frames.
  - Desktop hub: **~0.12-0.35 ms per frame averaged**. Each mirror frame gets 0.35-1.0 ms cheaper, which evens out the alternating frame times.
  - Phones: ~0.3-1 ms per frame (estimated).
- **Fix:** wrap the call using `scn` (the scene passed in, not the closure `scene`):
  `const _mwWas = scn ? scn.matrixWorldAutoUpdate : true; if (scn) scn.matrixWorldAutoUpdate = false; try { _reflOBR.call(...) } finally { if (scn) scn.matrixWorldAutoUpdate = _mwWas; /* FIRST line of the finally */ ... }`
- **Risks:**
  - The restore must be the **first** statement of the `finally`; one throw would otherwise freeze every matrix in the scene.
  - A future `onBeforeRender` that moves an object must update its own matrix (the `_skyDome` pattern).
  - The same wrapper also fires inside warm and prebake renders, where the rule holds too.
- **Measure:** get the exact per-refresh saving on the owner's machine with `let n=0; scene.traverse(()=>n++); n` and `let t=performance.now(); for(let i=0;i<50;i++) scene.updateMatrixWorld(); (performance.now()-t)/50`. Then compare `__prof` renderFrame and `?pbseg` `mirror` before and after.
- **Votes:** confirmed 0.82 / confirmed 0.88.

**O1.5 · Sky dome galaxy: dust and HII noise are evaluated on every sky pixel but are exactly zero off the galactic band.** [#65 #69]
- **Where:** `_wxMakeDome`:
  - `uDay = 12` at L56222 and `lit = mix(uDay,1.0,nightRamp)*uSpace` at L56283 keep `if (lit > 0.002)` (L56294) permanently true;
  - HII at L56345-56347, dust at L56354-56358.
  - Jump: `function _wxMakeDome() {`
- **Modes:** hub family, Earth (`_wxInit(null)`), the circuits, and every platform (the dome is built on phones and Quest too). It runs in the main and mirror passes.
- **Mechanism:**
  - Day and night, each sky pixel runs 28 `gn3` value-noise calls (224 hashes) plus asin, atan, exp and pow.
  - Dust: `trans = exp(-dust*4.2*uDust*smoothstep(0.01,0.22,band))` is **exactly 1.0** wherever `band ≤ 0.01`, yet the dp `gfbm`, the 4-octave `gridged`, the pow and the exp are all evaluated.
  - HII is multiplied by `band`, so it is exactly 0 where `band == 0`.
- **Impact:** computed, not measured.
  - The dome costs ~0.35-0.8 ms per frame at the hub's 1080p floor.
  - **Exact tier**, bit-identical: ~0.1-0.15 ms on desktop. About 79 % of sky pixels in a horizontal view are off-band for dust.
  - **Near-exact tier** [#69], a second step: skip warp, milk and HII where the galaxy's contribution is below 1e-4. That is ~0.03 of an 8-bit step, so imperceptible but not identical. It skips ~59 % of sky pixels (32-100 % depending on heading), roughly 0.2-0.5 ms.
  - Phones gain proportionally more (the dome is unmeasured there).
- **Fix:**
  - Dust: `float trans = 1.0; if (band > 0.01) { ...dp, gfbm, gridged, pow, exp unchanged... }`.
  - HII: `if (band > 0.0) { ... }`.
  - Write the 0.01 edge once, as one literal or const, used by both the gate and the smoothstep.
  - A/B uniform declared at creation (so it adds no program variant): `if (uGateOff > 0.5 || band > 0.01)`.
  - Ship the near-exact tier separately, with its threshold derived from the live `uMilky` / `uDay` (the `window.__sky` knobs).
- **Risks:** `renderer.debug.checkShaderErrors` is **off** (L24451), so a GLSL typo makes the dome silently vanish. Any later change to the 0.01 edge must move the gate with it.
- **Measure:** get the ceiling first with `window.__domeHide(true/false)` interleaved, reading `?pbseg` `scene`. Then toggle the gate uniform live at one pose off the band and one along it. Screenshots should be identical for the exact tier.
- **Votes:** #65 confirmed 0.85 / 0.88 · #69 confirmed 0.78 ×2.

**O1.6 · Earth roof meshes cast shadows but write no shadow texels.** [#60]
- **Where:** L147642 in `_loadBuildingsBody`; the roof bucket is at L147888. Jump: `m.name = 'earth-roofs-' + c;`
- **Modes:** Earth, Custom Location, race_earth. Desktop only (`_wxShadowsOn` / `_wxFull`).
- **Mechanism:**
  - Roofs contain only the extrusion's top cap (all 3 vertices above `topY`), so every normal is +Y.
  - They use a FrontSide Lambert material with `shadowSide` null under PCFSoft. r165 draws FrontSide materials as **BackSide** in the depth pass, and `__sunAngle` is clamped to 2-89°. Every roof triangle is therefore culled at rasterisation.
  - The walls' far faces are the real casters. Each roof chunk inside the ±6800 box is still one shadow draw per frame.
- **Impact:** computed.
  - 50-70 shadow draws per frame over a dense downtown (Manhattan, the Custom Location default); ~25-45 at the Toronto spawn.
  - At about 2-5 µs of JS per draw plus GL, that is ~0.1-0.35 ms CPU per frame.
  - Pixels are identical.
- **Fix:** keep `receiveShadow`. Let the roof take **one** shadow draw, so the pass still uploads its buffers where it does today, then leave it:
  `m.onAfterShadow = function () { this.castShadow = false; this.onAfterShadow = THREE.Object3D.prototype.onAfterShadow; };`
  r165 has `onAfterShadow`, at `WebGLShadowMap.js:363/377`. Add a comment explaining the side flip.
- **Risks:** valid only while the shadow type is not VSM and `roofMat.shadowSide` stays null. Re-check if roofs ever gain pitched geometry. `castShadow` is not a program-key term.
- **Measure:** console A/B on a settled downtown: `scene.traverse(o=>{ if(/^earth-roofs-/.test(o.name)) o.castShadow=false })`, then `=true`. Compare calls (with `autoReset=false`) and `?pbseg` `scene`, and take a shadow screenshot.
- **Votes:** confirmed 0.88 ×2.

**O1.7 · A peer's callout tag is drawn twice every frame, and the second copy moves to a new DOM div each frame.** [#51]
- **Where:**
  - L130414-130419 (both loops);
  - `_processShipForLabel` L130219;
  - `_lblClaimSlot` L130026/L130038.
  - Jump: `for (const np of net.networkPlayers) _processShipForLabel(np);`
- **Modes:** every room with human peers.
- **Mechanism:**
  - Every NetworkPlayer is in **both** `net.networkPlayers` (L16863) and `game.entities` (L16867, and re-added on respawn at L93429). The map already warns about this at L91.
  - On the second pass the peer's own slot is already stamped for this frame, so `_lblClaimSlot` claims a **new** div and the old one is hidden. Each frame that means a new ~8-element subtree shown, one hidden, and a new composited layer.
  - With 3 or more peers, the tags steal each other's slots (name text and avatar `src` rewrites).
- **Impact:** **measured** in headless Chrome 153 on the owner's laptop CPU.
  - Main thread: **+0.47 ms per frame** with 1 visible peer, **+0.77** with 2, **+1.17** with 3. GPU raster and compositor work come on top. The cost does not depend on DPR.
  - 0.47 ms is ~7 % of a 144 Hz frame.
- **Fix:**
  - In `_processShipForLabel`, right after the first guard line, add `if (ent._lblFrame === _lblFrameId) return; ent._lblFrame = _lblFrameId;`. It must come **before** `ent._lblUpPrev = !!ent._lblUp;` (L130234).
  - Keep the `networkPlayers` loop: it covers a peer that has dropped out of `game.entities` (`returnToRootMenu` clears only entities).
  - Do not dedupe with `indexOf`.
- **Risks:**
  - **Visible, and an improvement:** peer tags stop double-stacking and read lighter, which is the designed look. Tell the owner.
  - Stamp before any state mutation (the v40.61 hold).
- **Measure:** two-tab room (`PERFRV`). Count visible `.ship-name-label` for the peer (2 today, 1 after). Read `__prof['fx+hud+minimap']` and check the DevTools Layers panel.
- **Votes:** confirmed 0.92 / partial 0.90.

**O1.8 · HUD `_hlfHatch` strokes ~73 full-length lines per lit HP plate; ~85 % can never touch the plate.** [#82]
- **Where:** L108929, called from `_hlfBarRow` L109113-109114. Jump: `function _hlfHatch(ctx, cx, cy, reach, col, alpha, vm)`
- **Modes:** all flat modes, and the XR HUD texture.
- **Mechanism:**
  - Each line is its own beginPath / moveTo / lineTo / stroke at 45° across a 2R × 2R box, clipped to the cell.
  - A plate spans only 25-40° of arc, but Skia cannot quick-reject a line: each line's AABB is the whole square, which overlaps the clip.
  - Canvas raster runs on the **GPU process main thread**, the same thread that decodes the game's WebGL stream, so `__prof` cannot see it.
- **Impact:** **measured** on an RTX 4070 in headless Chrome (ANGLE D3D11) at 995×583, 1884×975 and 2524×1335, hudScale 1.75. Output is bit-exact (checked with `--disable-accelerated-2d-canvas`).
  - **0.7-1.1 ms of GPU-process raster per HUD redraw** at full or changing hull; 0.2-0.6 ms when hurt.
  - At ~30 redraws per second that is ≈ 0.2-0.27 ms per frame averaged, arriving as a lump every 4th-5th frame.
- **Fix:**
  - Pass the AABB of the annulus sector as an optional 8th argument. Compute it from the 4 corners plus every 90° multiple inside `[st, le]`, at both radii.
  - Set `m = (lw/2 + 2)·√2`, `kLo = bb0 − bb3 − m`, `kHi = bb2 − bb1 + m`.
  - Inside the **unchanged** accumulating `d += step` loop, compute `k = (cx+d) − (cy−reach)` and `continue` before `beginPath` when k is out of range.
- **Risks:**
  - Keep the accumulating loop; `-2R + i*step` changes the last float bits.
  - Do not merge the lines into one path; that is not identical on the GPU (measured).
  - The HUD lab (`hud_concepts.html`) evaluates this function from `lss.js`, so the extra argument must stay optional.
  - This finding's twin (input-hud slice) was refuted on **main-thread** cost (0.06-0.09 ms). The cost lives in the GPU process, which is where this one was measured.
- **Measure:** scratchpad `node hlc_mk2.mjs`, then `node hlc_run.mjs hlc_bench2.html "notime&pattr=full,ready,combat,regen&blocks=8&bn=60&vs=hcull"`. For the stroke count use `"notime&hcstat"`.
- **Votes:** partial 0.85 / confirmed 0.90.

#### In-play hitches

**O1.9 · The stall watchdog fires after every healthy frame of 120 ms or more, and each queued 30 Hz worker message then runs a full extra frame.** [#2]
- **Where:**
  - L144060 `setupBackgroundTick` (worker L144052/L144082-144084, handler L144056-144072);
  - the start-of-frame stamp at L131788-131790;
  - rAF sites L24971, L144017, L144096, L144113, L144124.
  - Jump: `(function setupBackgroundTick() {`
- **Modes:** all flat modes (XR is excluded by the handler's first line). Worst on phones, slow GPUs and curtain frames.
- **Mechanism:**
  - gameLoop stamps `_lssLastRafAt` at the **start** of the frame. The worker posts `'t'` every 33 ms, and those messages are not coalesced.
  - After a D ms frame, the first queued message sees `now − _lssLastRafAt ≥ D > 120`, so it runs `gameLoop(_now)`: simulation, `renderFrame` and `_gpuKeepWarmTick`, all out of vsync.
  - The watchdog frame deliberately does not refresh the stamp, so every remaining queued message runs another frame, until Chrome's ~100 ms compositing boost.
- **Impact:** **measured** on a headless Chrome 153 replica.
  - Desktop (~8 ms per gameLoop): a 130 / 150 / 200 / 300 ms hitch grows by **+33 / +41 / +51 / +76 ms** (4 / 5 / 6 / 9 watchdog frames).
  - Phones are proportionally worse; a 130 ms hitch becomes ~180-230 ms.
  - It does not change the per-frame average. It lengthens every hitch of 120 ms or more, including the baseline's `hub:clip`, `hub:ripple` and `hub:stream` maxima of 118-306 ms.
- **Fix:**
  - Step 1: add a **hoisted** wrapper, `function _lssRafEntry(t,f){ try { gameLoop(t,f); } finally { try { _lssLastRafAt = performance.now(); _lssLastLoopWasRaf = true; } catch(_){} } }`. Declare `let _lssLastLoopWasRaf = true;` beside `_lssLastRafAt` (~L144041).
  - Pass the wrapper at **all five** rAF sites and keep the null-first re-arm. gameLoop is still looked up by name, so the `?perf=1` reassignment still works. Keep the top-of-frame stamps.
  - Step 2 (verifier): the next rAF after a watchdog frame can see a timestamp older than the watchdog's `performance.now()`, which gives a negative dt. Clamp or rebase it using `_lssLastLoopWasRaf`.
- **Risks:**
  - The v43.16 contract still holds: when rAF truly stops (occluded pane, visible but not painted), the watchdog still drives at TICK_HZ. End-stamping only delays its first tick by at most one frame.
  - Do **not** switch the test to `_lssLastLoopAt` (the v43.15 7.6 Hz trap).
  - Watchdog frames also run during the curtain's long frames today (simulation only, under `_rfPrebake`), so re-measure LAUNCH→lift.
- **Measure:** add a temporary `window.__wdN` counter beside the handler's call. Force a long frame with `requestAnimationFrame(()=>{const t=performance.now(); while(performance.now()-t<200){}})`. Today `__wdN` rises by 1 or more; after the fix it should rise by 0.
- **Votes:** confirmed 0.85 / partial 0.85.

**O1.10 · Crest-break readback: three's `readRenderTargetPixelsAsync` does a blocking `getParameter` on every call, which throttles crest spray to 1/8 of its designed rate.** [#21]
- **Where:** L42723. Jump: `const _asyncRB = (typeof renderer.readRenderTargetPixelsAsync === 'function')`
- **Modes:** every water mode, while playing within 700 u of the water and past the 15 s FIGHT hold.
- **Mechanism:**
  - The call only becomes async after its first `await`.
  - Its synchronous prologue runs `capabilities.textureTypeReadable(FloatType)`. In r165 that evaluates `gl.getParameter(IMPLEMENTATION_COLOR_READ_TYPE)` before the `!== FloatType` short-circuit. That is a GPU-process round trip that waits for the command queue.
  - The v39.49b adaptive cadence reacts by backing `R._crSkip` off from 4 to 32.
- **Impact:** computed from recorded `crCost`.
  - Healthy queue: 0.75-1.1 ms blocking per call at 11-15 calls/s, ≈ **0.08-0.15 ms per frame**, arriving as a ~1 ms spike on 1 frame in 9-12.
  - Deep queue (GPU-bound hub at 1080p; the owner's deep-queue machine, v40.19): **13-15 ms stalls about 2× per second**.
  - After the fix `crSkip` settles at 4, so spray returns to its designed rate. That is the designed look, a visual improvement.
- **Fix:**
  - Step 1, once after the renderer exists:
    `const _c = renderer.capabilities, _o = _c.textureTypeReadable; _c.textureTypeReadable = t => (t === THREE.FloatType || t === THREE.UnsignedByteType) ? true : _o.call(_c, t);`
    The output is identical: r165 returns true for those two types whatever the query answers.
  - Step 2, only if step 1 is not enough: own the PBO + `fenceSync`. Poll at most once per frame, use no `SYNC_FLUSH_COMMANDS_BIT`, and always unbind `PIXEL_PACK_BUFFER`.
- **Risks:** `getBufferSubData` can still wait; time it separately and check LoAF. A `PIXEL_PACK_BUFFER` left bound breaks three's later reads and uploads.
- **Measure:** near water, read `window.__water.crCost`, `.crSkip`, `.crReads` and `window.__crestOffN` before and after (expect crCost ≈ 0.05 ms, crSkip = 4). Check the `?pbhud` `hub:ripple` max and LoAF while skimming.
- **Votes:** partial 0.80 / partial 0.62.

**O1.11 · Sky-island builds are a recurring 8-24 ms in-play hitch, billed to `hub:clip`. A bit-exact `_skH3` lattice memo cuts a third, and slicing removes it.** [#26]
- **Where:**
  - L52971 `_skH3`, used from `_skN3`;
  - `_skNet` L53143;
  - `_skFrame` L53612, which runs at L132187, **before** `__pmark('hub:clip')` at L132214.
  - Jump: `function _skH3(x, y, z)`
- **Modes:** freeflight, cyberpunk, campaign hub.
- **Mechanism:**
  - `_skFrame` builds the nearest unbuilt island every frame (`SKY_I.budget = 1`). A build is a 27³ surface-net field plus 6 samples per vertex for normals.
  - Each field sample is 5 octaves × 8 lattice corners of a `Math.sin` hash, on integer corners that neighbouring samples share.
  - The cost is billed to `hub:clip`, so v47.08's hitch hunt could not see it.
- **Impact:** **measured** in node, JIT-warm.
  - **8-12 ms median, 17-18 ms p90, 20-24 ms max per island.**
  - Frequency: ~21 per minute at 1,400 u/s dash; 0-4 per minute at cruise; ~16.5 per minute while circling or dogfighting (rebuild thrash at the range edge, because there is no drop hysteresis); runs of up to ~32 consecutive frames at spawn, teleport and respawn.
  - The memo alone gives −33 %, bit-exact.
- **Fix:**
  - (a) Memoise `_skH3` **only inside `_skN3`**, with a direct-mapped typed-array cache: Int32 x/y/z keys, Float64 value, imul hash, 2^14-2^15 entries (320-640 KB, allocated lazily). Store only when the input is an integer and the value is not NaN.
  - (b) Turn the build into a generator, `function* _skBuildG(I)`, under a ~1.5 ms per frame budget. Keep the build synchronous for an island first built inside the dome (post-teleport), which would otherwise pop in late.
  - (c) Add `__pmark('hub:sky')` after `_skFrame`.
  - Worth checking: drop hysteresis at the range edge.
- **Risks:**
  - **NaN poisoning:** `Int32Array` stores NaN as 0, so one NaN position reaching `_skCollide` would poison lattice (0,0,0) near the hub origin for the whole session.
  - A sliced build must be discarded if its island leaves range, and must keep the same `rnd()` order.
- **Measure:** split out `hub:sky` and read its `__prof` max and calls over a 60 s straight dash at 1080p. Look for LoAF entries naming `_skBuild`. Node harness: `skcache.mjs`.
- **Votes:** partial 0.82 ×2.

#### Loading

**O1.12 · The Spire's field recomputes constant shaft and satellite trig ~330 times per sample. A value-identical table makes each sample ~3x cheaper.** [#34]
- **Where:** L59084, `floorHole(px, pz, f, g)` inside `const _ARENA_FIELD_SRC`. Jump: `floorHole(px, pz, f, g)`
- **Modes:**
  - classic and elimination on The Spire: the first build per page per params key;
  - in play, Spire bot collision, sight lines and navigation use the same field.
- **Mechanism:**
  - `eval()` calls `floorHole` ~40 times (39.9 instrumented): 3 from the floor loop, the rest from the `rootTest` closures in `spikes()` and `pillarField()`.
  - Each call recomputes 4 shaft centres with cos/sin of `(h/g.shafts)*6.2831853 + f*0.9 + g.satPhase`, which depends only on (h, f, g). That is ~320 trig calls per sample on 12 per-arena constants. The central-column loop adds 3 cos + 3 sin.
- **Impact:** **measured** in node 22, with eval counts from the code.
  - 7.0 µs → 1.9-2.2 µs per eval.
  - Grid pass (12.37 M evals): ~87 s → ~25 s of CPU.
  - grad (~2.9 M evals): ~20 s → ~6 s.
  - Spread over the 8-worker pool, the map's measured ~16 s first Spire build (v36.58/59; ~45 s worst case on 4 cores) should drop by more than half (estimated).
- **Fix:**
  - Every edit stays inside `_ARENA_FIELD_SRC`.
  - Add `_tg/_tT/_tS` fields plus a `_tab(g)` method on the **field object**, keyed by G identity. It fills Float64Arrays with the **exact same expressions**.
  - In `floorHole`: `if (this._tg !== g) this._tab(g);`, with the per-call trig kept as the out-of-range fallback. Do the same for the satellites.
  - Write nothing onto G.
- **Risks:**
  - The source is interpolated into two Blob workers and is itself a template literal: no backticks and no `${` in the patch.
  - A debug mutation of G through `__spireArena.G()` would leave the tables stale.
  - The parity checker (the map's "ONE SOURCE, TWO REALMS") must still pass.
- **Measure:** on a fresh page, `window.__spireMesh().ms` and `window.__arenaLatReport().ms`, plus the "generating arena · N%" duration. In play with 5 bots, the `__prof` terrain section.
- **Votes:** partial 0.85 / partial 0.88.

**O1.13 · Chunk shells evaluate the terrain twice per vertex (ground shell, then ceiling shell, at the same jittered points).** [#20, step 1]
- **Where:** L36687 in `_swShellJobRows`. Jump: `let y = isCeil ? _stCeilYCarved(x, z, T) : _stGroundYCarved(x, z, T);`
- **Modes:** endless (continuous in-play streaming), race and procedural arenas (round rebuilds), zone-rift caverns, campaign legs, and arena prebakes.
- **Mechanism:**
  - `_stGroundYCarvedBase` evaluates g, route and `mid = (g + _stCeilY)*0.5`. `_stCeilYCarvedBase` evaluates c, route and `mid = (_stGroundY + c)*0.5`.
  - The two jobs use identical (x, z), because the jitter is keyed on the same `_gi/_gj`.
  - So g, c and route are each evaluated twice per vertex, and four times where `_swRimPinch > 0` or on pillar maps.
- **Impact:** **measured** in node, bit-exact, per chunk with both shells:
  - endless 2.65 → 1.21 ms (−54 %);
  - footprint arena 3.47 → 1.71 ms (−51 %);
  - colonnade 6.94 → 2.84 ms (−59 %).
  - In endless play: ~0.08-0.15 ms per frame averaged at cruise, 2× at boost. Busy streaming frames halve, and throughput doubles (one chunk per frame instead of one shell). That directly addresses the v42.00 "I can see the draw" complaint.
- **Fix:**
  - Add `_stCarvedPair(x, z, T, out)` beside the carved trio, **not** in `_hbFamily` (so no hub re-bake).
  - It evaluates g, c and r once and reproduces both bases verbatim:
    - `g+(mid-g)*PINCH*(1-ro)`;
    - the `if(ro<=0)` early return exactly (not `if(ro>0)`, which diverges on NaN);
    - the `_openTop` 1e9 case;
    - the pillar fuse.
  - A paired row job then writes both shells.
- **Risks:**
  - Copy the association of `_stGroundYCarvedBase`, not `_stGapSDFCarved`'s precomputed `pw`; they round differently.
  - Do not "unify" with collision.
  - Any worker copy must stay byte-identical.
- **Measure:** node harness (exactness + ns/vertex). In page: `__prebake().ms.terrain` on an endless and a classic launch, endless `__prof['hub:stream']`, and a screenshot diff.
- **Votes:** partial 0.80 / partial 0.85. Step 2 (the `WARP=0` noise) is O2.34.

**O1.14 · Chunk shell build: every ground vertex computes a colour the shader never shows, and every vertex re-linearises constant palette hexes with `Math.pow`.** [#84]
- **Where:**
  - L35056 `_swColGroundB`;
  - the call at L36694-36695;
  - the ground FS at L35558-35568 (`if(uCeil<0.5){ ... diffuseColor.rgb=terr; }`).
  - Jump: `function _swColGroundB(`
- **Modes:** classic, race, assault, endless, campaign caverns, every FOOT arena.
- **Mechanism:**
  - `terr` is built only from uniforms, vWPos, vWY and the facet normal. vColor never appears in `_swPatchTerrainMat` (0 references), so the ground colour attribute is computed, uploaded (20 KB per shell) and fetched for nothing. Ceilings do use it.
  - Separately, the palette's sRGB→linear conversion runs per vertex on constants.
- **Impact:** **measured** in node.
  - **1.2-1.7 ms per arena/endless chunk** on desktop (1.1-1.3 ms from the palette cache alone). That is ~25-30 % of the whole chunk build (33-36 % of shell-row work).
  - The hourglass window has 110-144 chunks, so **~155-200 ms per world build**. This covers the prebake, the 5×5 synchronous core, the warmup drain slices, and every round's ring rebuild on shifting maps.
  - In endless play it lowers the average, not the peak, because the work is already budgeted.
- **Fix:**
  - (a) Compute and write colour only `if (isCeil)`. Leave the ground `cols` zero-filled (`new Float32Array`) and keep the attribute and `vertexColors:true`. `diffuseColor.rgb *= vColor` then gives 0, which `= terr` overwrites, so the program key, the merge and the warm are all unchanged.
  - (b) Cache the linearised palette entries.
- **Risks:** do not share one colour attribute across shells. Do not leave `vertexColors:true` with the attribute absent (Chrome's attribute-0 emulation). Option (a) avoids both.
- **Measure:** scratchpad `lod_colcost4.mjs`; `__rrStage().build.parts.init`; `lssPerfSnapshot` prebake `ms.terrain` on endless_bend.
- **Votes:** confirmed 0.92 / confirmed 0.88.

**O1.15 · The hub-city moss-noise bake does 16.8 M `Math.sin` calls in the synchronous hub build frame. A per-octave lattice table is 5.9× faster and byte-identical.** [#27]
- **Where:** L47768, loop at L47775-47793 in `_hubCityBuild`. Jump: `const hsh = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };`
- **Modes:** the first hub-family launch per page (freeflight, cyberpunk, campaign hub), and the first staged swap into the hub. `_hubCityBuild._noiseImg` caches the result after that.
- **Mechanism:** 1024² pixels × 4 octaves × 4 corners = 16.8 M `Math.sin` calls over ~15.5k distinct integer corners. It runs inside the hub build frame, **before** `_hbKick`, so the worker bake cannot hide it.
- **Impact:** **measured** in node, cold JIT: **190-230 ms** off one synchronous frame. That is ~4 % of freeflight's warm 4.81 s LAUNCH→lift and ~3 % of cyberpunk's 6.6 s. Phones are likely 0.4-0.6 s.
- **Fix:**
  - Build one Float64Array per octave, spanning `floor(0*s+o) .. floor(1023*s+o)+1` with offsets (0,0), (7,3), (13,9), (31,17), filled with the same `hsh(i,j)`.
  - Keep `x*0.041 + 7` exactly as written: no accumulation, no factoring.
  - Read the corners in the same a, b, c, dd order and keep the existing mix.
- **Risks:** an off-by-one on the last `+1` corner reads `undefined`, which becomes NaN and then pixel 0. Byte-compare the whole image against the old loop.
- **Measure:** the `[hubcity] built` genMs, and LAUNCH→lift on a fresh page. Node harness: `noisebake.js`.
- **Votes:** confirmed 0.90 ×2.

---

### ⭐⭐ ORDER 2: solid but smaller, or needs care

#### GPU (hub-heavy)

**O2.1 · The Panini composite never displays ~24-26 % of the scene render. A depth-only early-Z mask over the two unused lenses would skip that fragment work.** [#4]
- **Where:**
  - the composite `#define SCENE(uv) texture2D(tScene, clamp(panMap(uv) * uSceneScale, ...))` at L29282;
  - conformal `const ymax = xmax / asp;` at L29807;
  - the main pass at L30055-30056;
  - `const camera` at L24269;
  - the default `_LSSPAN.pref` at L28927-28928.
  - Jump: `(v42.91) CONFORMAL PANINI. Maps an OUTPUT pixel`
- **Modes:** every flat mode on desktop with wide-view correction on. That is the default when there is no stored preference and the device is not mobile.
- **Mechanism:**
  - rtScene renders the full rectilinear 120° frustum.
  - Conformal Panini pulls the top and bottom of the centre column in to about half height. Two lens-shaped regions are therefore fully shaded every frame and never sampled: top centre (sky, clouds, the galaxy dome) and bottom centre (terrain and water under the ship).
  - The boundary has a closed form per column.
- **Impact:** computed with a bloom-texel guard (scratchpad `vpanini_guard.js`):
  - **0.24 MP** masked at the 1080p hub floor (23.6 % of 1.016 MP);
  - **0.54 MP** at native 1080p (25.8 % of 2.07 MP);
  - 0.06 MP in the pane.
  - The review's pane-vs-1080p gap implies ~3.9 ms/MP of marginal scene cost (an indicative two-session fit). That puts it at **roughly 0.5-1 ms GPU per frame at the floor, and more at native**.
  - This is potentially the largest desktop GPU lever here, but it **must be measured**. It overlaps O1.5, because the top lens is exactly the dome's most expensive pixels.
- **Fix:**
  - `camera.layers.enable(8)`.
  - The mask is a `RawShaderMaterial` with `precision highp float;`, `colorWrite:false`, `depthWrite:true`, LEQUAL, and `gl_Position = vec4(x, y, -1.0, 1.0)`.
  - The mesh gets `layers.set(8)`, no shadow flags, `frustumCulled=false`, and `renderOrder −1e9` inside a group at −1e9. Add it once and never dispose it.
  - Compute the boundary in the VS, sharing `postFX.compositeMat.uniforms.uPan` **by reference** so it cannot desync. Size the guard band in bloom texels.
- **Risks:**
  - Layer 8 keeps the mask out of the Reflector's virtual camera (layers 0+5), the ADS camera (5), cine's CubeCamera faces (0) and the shadow pass (castShadow is false). `_warmDrawRoot` copies `camera.layers`, but the mask is invisible outside renderPostFX.
  - Bloom blur and the refraction copy must never pull black from masked texels; that is what the guard is for.
  - Anything drawn with `depthTest:false` bypasses early-Z. That costs no saving and does no harm; take a census of the big ones.
- **Measure:** live `window.__panMask`, interleaved A/B at 1920×1080 in the settled hub at HIGH and at MEGA. Read `?pbseg` `scene`, fps and p99 (expect +1 draw). Screenshots on and off must match, including the bloom at the lens edge.
- **Votes:** partial 0.65 / partial 0.72.

**O2.2 · The sun's shadow pass draws every tree chunk in a full circle around the player. About half of them cannot shadow anything the camera or the mirror sees.** [#14]
- **Where:**
  - L36255 emit (`im.castShadow=!noShadow;`);
  - the ±6800 box (`_WX_SHADOW_EXT`, L56895/L56912), centred on the player in `_wxFrame` (L57156-57158).
  - Jump: `function _swTreeVisTick`
- **Modes:** freeflight, cyberpunk, campaign hub, hub race circuits. Desktop only.
- **Mechanism:** r165 `WebGLShadowMap.renderObject` culls casters only against the **shadow** camera, so every tree chunk inside the box is drawn in full, including the half behind the view.
- **Impact:** computed from a model calibrated on v47.05. About −30 to −70 shadow draws and −0.8 to −1.8 M tris per frame, out of the ~100-125 draws and 2.5-3.3 M tris the pass carries. That is **~0.2-0.5 ms GPU at 1080p**.
- **Fix:**
  - Record `_cs: !noShadow` in `userData` at emit.
  - Hook `scene.onBeforeRender = (r, s, cam) => _swTreeShadowCull(cam)`. Nothing else assigns it, including cine.js. r165 calls it after `camera.updateMatrixWorld` and before `shadowMap.render`.
  - Per tree mesh: `castShadow = _cs && (its bounding sphere swept along the sun direction meets the view frustum OR the mirrored reflector frustum)`.
- **Risks:**
  - Compute from the frustum actually rendered: Panini and ADS change fov inside the frame.
  - The mirror reuses the shadow map, so include its frustum.
  - Never switch mushrooms (noShadow) on. Leave park and island foliage alone.
  - Keep everything casting behind the curtain.
- **Measure:** interleaved A/B at 1920×1080 on a settled pose: triangles and draws per frame, `?pbseg` `scene`, `__prof` renderFrame.
- **Votes:** confirmed 0.78 / partial 0.78.

**O2.3 · Clipmap rings are submitted whole in every pass (`frustumCulled=false`). Per-camera angular `drawRange` plus a tiled index order would cut ~0.8 M tris per frame.** [#19]
- **Where:** L58162 in `_clipBuild`, plus the row-major loop in `_clipGeo`. Jump: `mesh.frustumCulled = false; mesh.renderOrder = -2; mesh.userData = { isClipmap: true };`
- **Modes:** desktop hub-world modes (phones have no clipmap).
- **Mechanism:**
  - Whole-mesh culling is correct for a ring, but every triangle is then vertex-shaded, including those behind the camera.
  - The vertex cost is 5 fetches for base height and normal, plus 3 for the parent morph target and 10 for the parent normal inside the morph band.
  - This happens in the main pass and in ~35 % of frames for the mirror.
  - After v47.07, L0 (532,480 tris), L1 and L2 remain.
- **Impact:** computed at fov 120. −0.53 to −0.61 M tris per main pass, −0.18 to −0.20 M per frame from the mirror: **0.72-0.81 M per frame** (8-9 % of the hub's 8.95 M). That is ~0.09-0.25 ms GPU at v47.07's measured rate. The tiled order then cuts a further 24-37 % of vertex-shader invocations on what is still drawn.
- **Fix:**
  - Emit a Uint32 index as 16 angular wedges (by atan2 of the quad centre), 4×4 tiles within each wedge. Each skirt quad goes to the wedge of the grid quad that owns its edge. Store the wedge sequence twice (+~11 MB, desktop only) or split into two draws.
  - Draw a 128×128 core of L0 as an always-drawn range.
  - Set `drawRange` per render from conservative sector boxes.
- **Risks:** the boxes must be conservative (skirts hang 220 u, heights span the full range, the eye sits up to one spacing off centre). Watch for LEQUAL ties at the perimeter (run the v36.47 flip probe). `__clipDetail` nulls levels. This complements the known-open *ring occlusion* item.
- **Measure:** `window.__clipSect` interleaved at 1920×1080. Read triangles (with `autoReset=false`), `?pbseg` `scene` and `mirror`, and take screenshots at 600 u and 9,000 u.
- **Votes:** partial 0.75 / partial 0.72.

**O2.4 · The displaced water sheet (768², 1.18 M tris) is drawn whole every frame, although half is behind the camera and, in caverns, ~75 % sits under dry ground where every fragment discards.** [#23 #79]
- **Where:**
  - L44551;
  - `mesh.frustumCulled = false` at L45406;
  - the discard at L45396-45397;
  - `_swBuildHubWaterDispGet`.
  - Jump: `const _dispHalf = 12288, _dispSeg = 768;`
- **Modes:**
  - the frustum half: hub family, Earth, water maps;
  - the dry-tile half: classic (The Nexus, hourglass), elimination and endless_bend caverns, desktop only.
- **Mechanism:**
  - 590k vertices × 5 ripple fetches are shaded every main pass (the sheet is hidden in the mirror pass, L45997).
  - At fov 120, 42-52 % of the sheet is behind the eye.
  - In caverns, `_aOut = aGraze * mix(1.0, shoreA, uShoreFade) * edgeFade` discards everywhere the near and far shore masks read dry, so 0.85-0.9 M tris can never produce a pixel.
- **Impact:** anchored on v36.42's measured 0.14 ms mirror-pass drop when this sheet was removed.
  - Hub: ~0.05-0.1 ms per frame above ~106 u.
  - Caverns: **0.10-0.17 ms**, and 0.2-0.35 ms near the water, where the sheet is in the two-pass DoubleSide band.
  - Phone tilers probably gain more (unmeasured).
- **Fix:**
  - Keep `_hubWaterDisp` as the **same single Mesh**; there are 20+ read sites. Keep the original row-major index for full and fallback draws.
  - Add one tile-major Uint32 index (16×16-quad tiles in Hilbert order) used by K ≈ 32 child meshes. The children share the parent's attribute objects and material, have `renderOrder −1` and `frustumCulled=false`, and draw only the visible and wet tile runs.
  - Hub-only alternative (#23): one reordered index with an always-drawn near disc plus wedges.
- **Risks:**
  - `_waterRefractBind` must copy **once** per render; guard on `renderer.info.render.frame`.
  - Blend order at crest self-overlaps changes (≤7 % on those pixels only). That is v44.21 sawtooth territory, so A/B it on a wake with the owner.
  - +14 MB of index: do not duplicate it on phone or Quest.
  - Mask-driven culls must use the **committed** mask with a guard band.
- **Measure:** symmetric `__water.tileCull` / `__sheetCull` toggles. Read triangles per frame, `?pbseg` `scene`, and screenshots including the low-skim DoubleSide band.
- **Votes:** #23 partial 0.62 / 0.72 · #79 partial 0.62 / 0.70.

**O2.5 · BCS gas shader: two per-sprite constants are recomputed per pixel (the 6-noise alpha mask, and the 8-light loop).** [#9 #41]
- **Where:** L23376 in `class BillboardCloudSystem` (L23389); the light loop at L23388-23394. Jump: `float n = bcsFbm(noisePos);`
- **Modes:** every mode with BCS gas (arena atom smoke, basin pools, the hub weather deck), phones, and optionally VR.
- **Mechanism:**
  - Alpha: `F(uv, seed)` is static for a sprite's life. The seed comes from `Math.random()` at `claimSlot` (L23479), and no time or camera term enters; drift moves only the quad, in the VS. Yet it costs 6 value-noise evaluations (24 hashes, ~430 ALU) per fragment per pass.
  - Lighting: `vSpritePos` is constant per sprite, so `lit` is too, yet all 8 slots are looped per fragment.
- **Impact:** derived, not measured.
  - Mask bake: saves 75-95 % of BCS fragment ALU. That is ~0.1-0.18 ms in the desktop hub at cruise, and ~0.3-1 ms in classic, race and endless views over a basin pool.
  - Light loop moved to the VS: ~12-15 % of surviving gas ALU. That is 0.05-0.09 ms with a pool in view, and 0.15-0.3 ms inside a dense bank or the weather deck.
  - Phones ~3×.
- **Fix:**
  - (1) Move the loop into the VS with `flat varying vec3 vLit`, same expression order. This is identical.
  - (2) Declare `uniform sampler2DArray uMask; uniform float uMaskOn;` at construction, with a 1×1 `DataArrayTexture` placeholder, so the program source is final from boot.
  - At boot (never at match start), bake 512 seed layers with the bcs hash, noise and fbm functions copied verbatim, and upload them as a `DataArrayTexture` with mips.
- **Risks:**
  - r165 `updateRenderTargetMipmap` binds `TEXTURE_2D` for an array RT, which gives a GL error and no mips. Upload a DataArrayTexture instead.
  - Seeds quantise to 512 patterns. Each cloud overlaps 9-17 randomly scaled and tinted sprites, so this is imperceptible.
  - The shader source changes, so re-warm against rtScene. Match precision across stages.
- **Measure:** `__cineAPI.bcs.mesh.visible=false` isolates the BCS share of `?pbseg` `scene` and `mirror`. Then run knob A/Bs at fixed poses.
- **Votes:** #9 partial 0.72 ×2 · #41 partial 0.62.

**O2.6 · ez-tree geometry is non-indexed: 21 % of tree vertices are exact duplicates.** [#15]
- **Where:** L35753, `leafCard` in `_swGenTree`; L35806-35809. Jump: `function _swGenTree`
- **Modes:** hub family, city parks and sky islands (all share `_swTreeGeos`).
- **Mechanism:** each crossed plane emits 6 vertices with w0 and w2 duplicated. The instanced Standard VS (6 sin sway terms plus shadow coordinates) or MeshDepthMaterial runs once per corner.
- **Impact:** computed. VS runs per triangle drop 3.00 → 2.36 (ultra) or 2.40 (lite), i.e. ~1-3 M fewer per frame across main, mirror and shadow: **~0.05-0.2 ms GPU at 1080p**.
- **Fix:**
  - Add an `IDX` array and make `vtx` return the vertex index.
  - `tri` keeps its own 3 vertices, so bark stays flat-shaded.
  - `leafCard` emits 4 vertices plus `i,i+1,i+2, i,i+2,i+3`, preserving winding and order.
  - Finish with `setIndex` and `computeVertexNormals`.
- **Risks:**
  - Normals come out 0.0175° off. Write `normalize(n1)` explicitly for the 4 plane vertices to be exact.
  - The flora-pool debug trick of identifying a species by `position.count` changes.
- **Measure:** `?pbseg` `scene` in a dense forest at 1080p. Triangle counts must be unchanged; a screenshot diff should show at most 0-1 LSB.
- **Votes:** confirmed 0.80 / confirmed 0.85.

**O2.7 · The terrain FS evaluates noise that is multiplied by exactly 1.0 (ground AO past 2.2 km), or recomputed (`_snowWander`).** [#17]
- **Where:** L35568 (the AO block), L35570 (roughness `_snowWander`). Jump: `function _swPatchTerrainMat`
- **Modes:** clipmap hub and sandwich arenas.
- **Impact:**
  - Desktop 1080p hub: ~0.04-0.09 ms for all parts together; the AO gate alone is ~0.02-0.03 ms.
  - Mobile and Quest: only (b) helps, because `uAO = 0` there.
- **Fix:**
  - (a) `if(uAO>0.001 && _mD<2200.0)`. Bit-identical.
  - (b) Hoist `float _swSW=_snowWander(vWPos.xz);` to the head of `main()`, **unconditionally**, and use it in both places.
- **Risks:**
  - (b) reverses the v35.46 deliberate duplication. Its recorded reason was chunk order, which does not apply to a hoist at the head of `main()`. Update the map note.
  - All 8 terrain materials share one key, so the injected source must never be runtime-conditional.
  - A GLSL error makes the terrain silently not draw.
- **Measure:** screenshot diff (expect 0 px); `?pbseg` `scene` over far terrain.
- **Votes:** partial 0.55.

**O2.8 · The refraction copy blits the grow-only texture's full size, not the live rect (MEGA after a shed).** [#6]
- **Where:** L29751. Jump: `(v40.16) GROW ONLY`
- **Modes:** MEGA on water maps only. Zero at HIGH, ULTRA (MSAA), in XR and on potato. At most ~0.05 ms on phones.
- **Mechanism:** r165 `copyFramebufferToTexture` copies `texture.image.width×height`. Once the adaptive scale has climbed, every later frame copies the largest rect ever reached.
- **Impact:** worst case ~0.25-0.4 ms per frame at MEGA after a shed (the finder's bandwidth arithmetic). It is zero when the session's largest bucket matches the current one.
- **Fix:** temporarily trim `image.width/height` to `min(full, bw+2, bh+2)` around the copy. Only trim when `renderer.properties.get(C2).__version === C2.version` and `__webglTexture` exists, and restore in a `finally`.
- **Risks:** trimming on an allocation frame allocates a small texture, after which full copies fail with INVALID_VALUE and silently zero refraction. The version guard prevents that.
- **Measure:** `?pbseg` `refcopy` at MEGA after forcing a shed.
- **Votes:** partial 0.75 / partial 0.78.

#### CPU / draw calls

**O2.9 · Every cluster rock is its own draw, material and VAO, with no distance cull. A Shifting Run round has ~685 rocks.** [#38]
- **Where:** `_buildChildren` → `new THREE.Mesh(_makeRockGeometry(1, seed), _makeAtomFractalMaterial(...))`. Jump: `function _makeAtomFractalMaterial`
- **Modes:** race (race_shifting), classic, assault, endless, campaign legs.
- **Mechanism:**
  - Each rock has a unique 240-vertex non-indexed geometry and its own ShaderMaterial, so it is one draw plus a VAO switch.
  - The only cull is the frustum. The far plane is `_lssCamReach()/cos(hHalf)`, ~70-81k at fov 120, and the material has no fog.
  - v47.90 made the Shifting Run 4× longer.
- **Impact:** computed.
  - ~337 rock draws per frame on average along the racing line, and up to ~760 at the start line.
  - At 2.4-2.6 µs of JS plus 1-2.5 µs of GL per rock, that is **~1.2-1.7 ms per frame on average and 2.7-3.8 ms at the start**.
- **Fix:**
  - Skip "one material per cluster" as a standalone step.
  - Build one module-level **opaque** ShaderMaterial from the same source, registered once, with a BatchedMesh per round. Keep a lightweight proxy transform per child, synced into the batch.
- **Risks:**
  - Rocks are `transparent:true, depthWrite:true` today (L74755-74757). An opaque batch moves them to the opaque list: A/B the water and gas compositing at the waterline, and any `uOpacity` fade.
  - Never ship a transparent batch; it sorts as one object and brings back the v38.67 angle flips.
  - `c.mesh` is read by `_disposeVRRockMesh`, destroy, `_fragmentExplode`, teardown and collision.
  - `USE_BATCHING` plus the opaque flag fork the program key: pin them in `_buildModelWarmGroup` with rtScene bound.
- **Measure:** mid-course with `autoReset=false`. For the upper bound, `game.dynamicObjects.forEach(o=>o.mesh&&(o.mesh.visible=false))`, then restore.
- **Votes:** partial 0.80 / partial 0.72.

**O2.10 · The projectile smoke cone is destroyed and rebuilt every frame. The ribbon is built and then thrown away.** [#37]
- **Where:**
  - L69242-69246, the teardown inside `update()`;
  - the rebuild at L69261-69269;
  - the ribbon discard at L69232-69238;
  - `destroy()` keeps its own copy at L70342-70348.
  - Jump: `(v27) Cone-cloud trail mesh : material is per-projectile`
- **Modes:** every mode with Pyro Thermite, Tracker, rockets or mirrored peer heavies.
- **Mechanism:**
  - The unconditional `if (this.smokeCone) { scene.remove; _releaseSmokeConeMaterial; null }` runs every frame, and the `if (!this.smokeCone)` branch below immediately builds a new Mesh: a uuid, 2 Matrix4s and more.
  - Smoke-trail shots also build a ribbon in the constructor that the first update disposes.
  - The salvo path disposes geometry per shot. That is the shared-geometry-disposal class if the geometry is a singleton.
- **Impact:** **measured** with real r165: 3.0-3.6 µs plus ~1.8 KB of garbage per live cone per frame. At 5-20 live cones that is **15-65 µs and 1.3-5 MB/s of young-generation garbage** at 144 Hz, and higher in a Mega Tracker volley.
- **Fix:**
  - Delete the L69242-69246 block. Keep the teardowns in `destroy()` and `_despawnProjectileSilent` (L70423).
  - Optionally build the ribbon lazily, only when `!this.smokeTrail`.
- **Risks:**
  - This is not pooling: each shot still gets its own bundle, per the rule.
  - The cone keeps a stable id, which only affects the sort tiebreak at exactly equal depth.
  - Side note: `_smokeConeMatPool` never recycles anything.
- **Measure:** DevTools allocation sampling across a volley; `__prof['shipAnim+net+misc']`; `renderer.info.memory.geometries` should stop oscillating.
- **Votes:** confirmed 0.88.

**O2.11 · Additive, depthWrite-off `MeshBasicMaterial` FX take r165's two-pass transparent-DoubleSide path.** [#5 #36 #28, corrected]
- **Where:**
  - L69186, the projectile ribbon (`frustumCulled=false`, L69197);
  - L31618, the replay ribbon;
  - L71004, the headlight cones;
  - L98400, the wall ripple;
  - L82603, `createOrganicMesh`;
  - L48583 `ringMat`, L48731 beam, L48744 cones, L53303 `_skRingMat`.
  - Jump: `--- Tube ribbon trail (Effect 07) ---`
- **Modes:** combat modes (ribbons), and the hub and cyberpunk near cities (decorations).
- **Mechanism:**
  - Each such object is drawn BackSide and then FrontSide, each after `needsUpdate`. That means 2 `getProgram` calls (~130-field params object, cache-key join, uniformsList rebuild), a program switch and a full uniform upload per object per pass.
  - For additive blending with depthWrite off, the order cannot matter, and unlit MeshBasic shades DOUBLE_SIDED and FLIP_SIDED identically.
- **Impact:** **measured** JS floor of 7-9 µs per object per pass (node, r165), ~10-15 µs with the WebGL binding, plus −1 draw and 4-8 KB of garbage.
  - Ribbons: 10-30 live bolts, all drawn whether on screen or not, ≈ **0.1-0.35 ms per frame**.
  - Hub decorations: ~0.1-0.15 ms in cyberpunk near the city, 0.15-0.2 ms in freeflight, ×2 per eye in XR.
  - Organic decorations: unmeasured; take a census.
- **Fix:**
  - Add `function _lssAddOnePass(m){ if (m && m.transparent && m.side === THREE.DoubleSide && m.blending === THREE.AdditiveBlending && m.depthWrite === false) m.forceSinglePass = true; return m; }`, declared above its first reader (TDZ).
  - Apply it **at construction** at the sites above.
  - Also set `banner.frustumCulled = true` for the towed banners [#28].
  - **Not** for ShaderMaterials (already single-pass, see top), premultiplied or normal blending (banners L49490, holo panels L48441), or `depthWrite:true`.
- **Risks:**
  - The flag swaps the Back/Front program pair for one DOUBLE_SIDED variant. Set it at construction so the prebake's `renderer.compile` links that variant behind the curtain. Check `__coldProgs()` / `__coldSeen` are 0 and look at `renderer.info.programs` at the lift.
  - Expect 1-LSB rounding where a ribbon overlaps itself.
- **Measure:** `renderer.info.render.calls` totals, `__prof` renderFrame and the programs count, in a classic firefight and near the hub city.
- **Votes:** #5 partial 0.80 ×2 · #36 partial 0.78 ×2 · #28 partial 0.72.

**O2.12 · The v38.98 cockpit-part rule (`/_CP_/`) no longer matches the re-exported seat and bulkhead, so ~12-17k tris and 8 meshes per hull cast sun shadows.** [#30 #68]
- **Where:** L64065. Jump: `(v38.98) COCKPIT PARTS`
- **Modes:** desktop sun-shadow modes (hub, cyberpunk, Earth).
- **Mechanism:** the v42.08 GLBs moved the seat, harness and bulkhead onto `<Ship>_Cabin_*` materials, which the regex misses. They sit inside the tub and under the windshield, which still casts (shadow depth ignores `transparent`).
- **Impact:** computed.
  - Cyberpunk 3v3: **−48 shadow draws and −95k depth tris**, about 0.2-0.4 ms of renderFrame CPU.
  - Solo hub or Earth: −8 draws (noise).
  - Mobile, Quest and arenas: 0.
- **Fix:**
  - A **shadow-only** rule after L64065: `else if (mats.some(mm => mm && /_Cabin_/.test(mm.name||''))) { child.castShadow = false; child.userData._cockpitInteriorNoShadow = true; }`.
  - Leave `InnerHull_Composite` casting: it closes the envelope under the non-casting `_CP_` canopy frame. So #30's `InnerHull` extension is rejected.
  - Optionally mirror the rule at L85605.
  - **Do not** add `_Cabin_` to the 300 u LOD; the seat is visible through the windshield.
- **Risks:** this is identical only while the seat is enclosed from every light direction. Check with a low-sun shadow screenshot.
- **Measure:** live traverse toggle; read `renderer.info` totals.
- **Votes:** #30 partial 0.88 / 0.85 · #68 partial 0.75.

**O2.13 · Every Projectile's additive glow core casts a sun shadow.** [#11]
- **Where:** L69052. Jump: `this.mesh.castShadow = true;`
- **Modes:** desktop hub, cyberpunk, Earth (hub weather on).
- **Mechanism:** the core is a `MeshBasicMaterial` with additive blending and depthWrite false, but r165 draws every castShadow mesh with the depth material regardless. Each bolt costs one extra shadow draw for a dark sub-texel smudge (2.2 u against 6.64 u texels), which is physically wrong.
- **Impact:** measured with a stub-GL bench at ~3-4 µs per bolt. ~0.06-0.08 ms with ~20 bolts and 0.15-0.2 ms with ~50. **Improves** the image.
- **Fix:** `castShadow = false`, with a comment beside the v35.14 mushroom note.
- **Risks:** none found. The mesh flag is not a key term, and the depth program stays warm through other casters.
- **Measure:** calls minus `game.projectiles.length` with shadow autoUpdate on and off.
- **Votes:** partial 0.75.

**O2.14 · Idle energy-shield bubbles are drawn every frame, and their shader discards every fragment more than 95 % of the time.** [#32 #35 #57]
- **Where:** L64229 (`new THREE.SphereGeometry(Math.max(w, l) * 2, 24, 16)`); the discard at L18873; `tickEnergyShields`. Jump: `const shieldMat = makeEnergyShieldMaterial(_shipShieldColor(loadoutKey));`
- **Modes:** every mode with ships; first person and VR matter most.
- **Mechanism:**
  - The bubble is a sphere of radius 80-140 u with an additive DoubleSide **ShaderMaterial**, so it is **one** draw per pass, not two. #35's "two passes" was wrong.
  - Its fragment shader runs 4 `rippleSample` calls, then `discard` when intensity < 0.001 and there is no ripple.
  - Intensity is almost always 0: the player's is zeroed every frame (L132646-132649), peers only during spawn protection, bots only for the nemesis (L132607-132619). Ripples live 0.55 s.
- **Impact:**
  - CPU: 5-10 µs per visible bubble per pass, ~0.03-0.07 ms in classic, +mirror.
  - XR: draws ×2 per eye; Quest ~0.15-0.3 ms.
  - GPU: the player's own bubble is about one full-viewport discard layer.
- **Fix:**
  - Gate **material.visible**, not mesh.visible. `projectObject` skips it, and `renderer.compile` ignores it.
  - Hide a material only after it has drawn once (`onBeforeRender` sets `userData._esDrawn`), or only while `game.state === 'playing'`.
  - Add eager `visible = true` hooks in `recordShieldHit`, `setShieldIntensity` and the nemesis write (L132615).
- **Risks:**
  - An unhooked intensity writer would leave a shield hidden. There are 3 today (L18959, L132615, L132648); grep `.intensity.value =` again when landing.
  - Do not use `forceSinglePass` here.
- **Measure:** calls; `?pbseg` `scene` in first person and in VR. Shoot a bot and check the ripple appears the same frame.
- **Votes:** #32 partial 0.72 · #35 partial 0.80 / 0.85 · #57 partial 0.72.

**O2.15 · Callout line-of-sight raycasts run in lockstep: tags acquired together re-test together forever.** [#52]
- **Where:** L130273-130281. Jump: `const HBAR_LOS_INTERVAL`
- **Modes:** the hub, cyberpunk, near overworld cities, and arenas.
- **Mechanism:** the only writer is `ent._hbLosTime = now`. After a cinematic, a round start or a camera sweep, every tag shares a phase.
- **Impact:** the average is unchanged, but **1.1-3 ms bursts land about every 10th frame at 144 Hz** (10-20 entities × 110-150 µs).
- **Fix:** `ent._hbLosTime = now + (Math.random() - 0.5) * 0.3 * HBAR_LOS_INTERVAL;` on every write. This cuts the peak from 10 to 4-5 tests per frame. Keep the immediate test when the value is null or stale.
- **Risks:** worst-case staleness is ~77 ms plus a frame, well inside `LABEL_SHOW_HOLD` 250 / `DROP_HOLD` 350. Do not raise the interval (the map chose 15 Hz at L1565).
- **Measure:** DevTools per-frame `updateEnemyHealthBars` should go from a sawtooth to flat.
- **Votes:** partial 0.65.

**O2.16 · Continuous damage runs the one-shot hit-feedback restart every frame, including a forced reflow.** [#53]
- **Where:**
  - L90713, restart at L90715-90717 (`el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');`);
  - reached through `playerTakeDamage` L93570 from per-frame ability damage (L67324 Mega Laser, L67385 Stun).
  - Jump: `function showDirectionalDamage`
- **Modes:** classic, assault, race, endless, the hub.
- **Impact:** ~0.45 ms of main thread per call. That is **~0.4 ms per frame** while a bot core or a DoT zone hits you, about 6 % of a 144 Hz frame; Pixel 9 2-3×.
- **Fix:**
  - The v38.61 WAAPI pattern with module constants `_DE_KEYS` and `_DE_OPTS`. Cancel the previous animation, then `el.animate(...)`. Keep the old restart only as a fallback.
  - Cache the edge elements.
  - Use a scratch quaternion instead of `camera.quaternion.clone()`.
- **Risks:** keep the `.pulse` CSS rule (`_prebakeOverlayRehearsal` L85026 warms it). A `fill:'forwards'` animation persists, so always cancel. No display toggling (v40.94).
- **Measure:** DevTools "Forced reflow" markers while standing in an enemy firewall.
- **Votes:** partial 0.72.

#### In-play hitches

**O2.17 · Sonar beacons still take the ~117k-tri unaccelerated hull raycast, measured by the owner at ~21 ms per call and repeated every frame inside the OBB.** [#67]
- **Where:**
  - L68942 `_swepRayHitsShipMesh`;
  - call sites L69868 and L70040;
  - sources L100793 (player) and L66753 (TRACKER bots since v41.91).
  - Jump: `function _swepRayHitsShipMesh`
- **Modes:** any mode with a TRACKER player or bot.
- **Mechanism:**
  - Sonar beacons set none of the exemptions (`hasShield`, `_usesSplashSlop`, `isNetwork`, `_cheapHit`).
  - three's `Mesh.raycast` has no acceleration: the local bbox test uses an infinite ray, and `far` is only checked per hit. It walks 65-78k of 115-133k tris per call.
- **Impact:** **measured** in node at ~23 ms per call (p90 31), matching the owner's 20.6-22.7 ms. At 2,400 u/s and 144 Hz a beacon inside the 1.4× OBB makes ~3 calls, so **a near miss is several consecutive +21 ms frames**. No mean-fps effect.
- **Fix:**
  - An exact uniform grid per `BufferGeometry` in a WeakMap, only for geometries over ~5k tris (Hull_01, the cabin shell, the canopy frame).
  - Fall back to plain raycast for skinned meshes, morphs, material groups and non-default drawRange.
  - **Build ahead of time** (50-68 ms per hull type): in the prebake for the loaded hulls, or at idle.
- **Risks:**
  - Match three's semantics exactly: `material.side`, groups, near/far, the ~85× scale, and the stationary 1.5-unit probe (`sweptLen < 0.5`).
  - A lazy build is itself the hitch.
- **Measure:** `?pbhud` + F8 after a sonar hit on an unshielded ship; console-time `Mesh.raycast`.
- **Votes:** partial 0.78 ×2.

**O2.18 · Water body-patch silhouettes are cached per slot, not per body. Every slot change relinks a throwaway depth material and does a synchronous `readPixels`.** [#39 #73]
- **Where:** L38937/L38950 `_swHullSilhouette` (key `hull.uuid + ':' + res`); the dispose at L39050. Jump: `function _swHullSilhouette` · `const _pick = [_b0, _b1];`
- **Modes:** the hub (wading leviathans, bots over the sea), flooded caverns.
- **Mechanism:**
  - `_swEntityWaterTick` picks the top two bodies each frame by `BEAM / max(200, d)`. A swap (A,B)→(B,A) as the camera crosses their bisector rebuilds both slots.
  - Each rebuild creates a new Scene and clones, a new `MeshDepthMaterial` that is disposed afterwards (so it relinks), an RT, and a sync readback.
  - `_swEntPatch` calls the silhouette **before** its own dry test (L41385 vs L41398).
- **Impact:** estimated. **3-10 ms for a single rebuild, 4-13 ms for a double swap** (1-2 dropped frames at 144 Hz). It is worse on the deep-queue machine (v40.19 fence readings of 40-120 ms).
- **Fix:**
  - (1) Keep one depth material alive: `R._silMat = R._silMat || new THREE.MeshDepthMaterial({depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide})`, never disposed. Or replace the L39050 dispose with `_lssRetainMat`. This alone removes the relink, including on player hull swaps.
  - (2) A per-body LRU `Map` (~16 entries, ~32 KB each). Evict only records no slot or `_entPrev`/`_hullPrev` references. `hullRedo` flushes it.
- **Risks:**
  - A reused record keeps its first-build pose, which matches the code comment's stated intent.
  - Never dispose a texture that is still bound (the null-sampler trap).
- **Measure:** a rAF poller on `window.__entP[i].id`, plus a wrapped `readPixels` count and time.
- **Votes:** #39 partial 0.72 ×2 · #73 partial 0.80 ×2.

**O2.19 · Wild leviathan family arrival: skinned bounding spheres, per-member clip clones, and an unpinned program, all in the arrival frame.** [#40 #74]
- **Where:** L79489 `_wildProto`; `_wildRigClone`; `_attach` → `_monStripRootMotion`; the warm pins at L84191-84196. Jump: `function _wildProto` · `function _buildModelWarmGroup`
- **Modes:** freeflight, cyberpunk, campaign hub, the overworld circuit.
- **Mechanism:**
  - `Box3.setFromObject` never fills `boundingSphere`, and r165 `SkinnedMesh.copy` only clones a sphere that exists. So each clone's first frustum test runs `computeBoundingSphere`, pushing every vertex through its bones.
  - `_attach` clones all 72 tracks per member.
  - The opaque skinned `basicRim` program (`customProgramCacheKey 'basicRim'`, L77701) matches none of the pins, which are transparent ghost variants or non-skinned.
- **Impact:**
  - A family visible at spawn (~52 % of spawns): **6-35 ms (mean ~18 ms)** in one render, 2-3 times at hub entry.
  - Clip clones: 0.3-3 ms.
  - A one-per-session link of 3-15 ms (up to 50 ms cold), plus a 1-3 ms texture upload per new type.
- **Fix:**
  - (1) In `_wildProto`, after `setFromObject`: `gltf.scene.traverse(n => { if (n.isSkinnedMesh) { n.computeBoundingSphere(); n.boundingSphere.radius *= 1.35; } });`. Use **1.35, not 1.2**: FleshMaw needs ×1.278 over the walk clip.
  - (2) Strip root motion once per prototype.
  - (3) Add `add(mkSkinned(_addBasicRim(new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }), 0x8ad8ff, 0.35)));` next to pins 1-2. Verify its `cacheKey` against a real clone with rtScene bound.
- **Risks:**
  - The margin depends on the data: re-run `vf_wildsphere.mjs` whenever a monster GLB or clip changes, and check for limb culling at the screen edge.
  - Phones skip the model warm group.
- **Measure:** `?pbhud`, force respawns (`__wild.keepR`), LoAF entries, `computeBoundingSphere` self time, and `renderer.info.programs` at arrival.
- **Votes:** #40 partial 0.85 / 0.82 · #74 partial 0.75.

**O2.20 · The round auto-keep is one 7-17 ms task, and it lands in the middle of the next round's visible 3-2-1.** [#8]
- **Where:** L32113 (`setTimeout(() => _rplAutoKeep(done), 1200)`), armed by `_rplFrame`, which only runs inside renderFrame. The picker owns the frame until `lss-launching`. Jump: `function _rplAutoKeep`
- **Modes:** classic and elimination, solo and rooms.
- **Impact:** a node proxy (desktop) of serialize **plus the synchronous IndexedDB structured clone**:
  - 11 s round: ~2.1 ms;
  - 37 s: ~7.7 ms;
  - 88 s: ~15-17 ms;
  - phones 2-2.5×.
  - It lands about 0.2 s after the visible "3". The v48.05 map note says the clone runs off the main thread; that is wrong.
- **Fix:** at the v48.07 gameLoop-top line (L131812), end the recording as soon as the state leaves `roundEnd`/`playing`:
  `if (!R.endT) R.endT = _rplNow(); _RPL.last = R; _RPL.cur = null; _RPL.rec = false; _RPL.kcAt = 0; setTimeout(() => _rplAutoKeep(R), 300);`
  The keep then runs under the scoreboard, not the countdown.
- **Risks:** for the optional typed-array version, `_rplDeserialize`'s `Array.isArray` rejects typed arrays and would silently load an **empty** replay, so it must accept `ArrayBuffer.isView`. JSON export must stay on plain arrays.
- **Measure:** `__replay.log()` timestamps; a LoAF observer (`invoker: TimerHandler:setTimeout`).
- **Votes:** partial 0.78 / partial 0.82.

**O2.21 · The particle over-cap cull rescans the whole pool once per removed particle (O(k·n)).** [#46]
- **Where:** L88940 (`while (game.particles.length > _pCap) cullOldestParticle();`), L88793; caps at L88058. Jump: `function cullOldestParticle`
- **Modes:** fires only where pool + burst exceeds the cap: non-mossy cavern arenas at the HIGH cap of 800, or multi-SLAYER rooms. The hub (cap 4000) effectively never.
- **Impact:** **measured** in node (desktop, megamorphic shapes): a single-frame spike of **1.8-7.4 ms** when a SLAYER pull (+384 particles) lands on a full pool.
- **Fix:**
  - For k < 8, keep the current loop.
  - Otherwise copy the lives into a module-level `Float64Array` scratch buffer, quickselect the threshold, and compact in one pass.
  - Add a NaN fallback.
- **Risks:** survivor order changes. Additive blending is commutative; `_cohTick` sums drift by less than an ULP. Keep the VR tier-3 `ess` compaction first.
- **Measure:** `__prof['particles']` max in the hourglass, player SLAYER against a bot SLAYER.
- **Votes:** partial 0.80 / confirmed 0.86.

#### HUD raster (GPU process). Land O1.8 first, then O2.22, then O2.23.

**O2.22 · CORE ready/firing glow: 15 separately shadowed chevron fills.** [#49]
- **Where:** L109403 `_hlfChevronRow`; `_hlfChevronPath` L109361; glow at L109593-109594. Jump: `function _hlfChevronRow`
- **Mechanism:** every lit chevron is its own shadowed fill (`shadowBlur` 1.92 vm), so each pays a blur layer.
- **Impact:** **measured** on an RTX 4070: **1.3-1.5 ms of GPU-process work per redraw** while CORE is READY or FIRING (2.45 → 0.92 ms). The glowing row then costs about the same as the unglowing one.
- **Fix:**
  - Add a sibling `_hlfChevronSub` with no `beginPath`, inside the `_HL`..`_hlDrawHUD` span.
  - Batch **only** the glow fill.
  - The charging state stays byte-identical. READY and FIRING are imperceptible: a union fill with one shadow layer.
- **Risks:** off-default `__hudCore` knobs that make chevrons overlap would lose the double alpha.
- **Measure:** scratchpad `mkbench.mjs` → `bench.html`.
- **Votes:** confirmed 0.85 / partial 0.80.

**O2.23 · HUD layer cache: bake the HP/SHIELD frame and the CORE row when their inputs are unchanged, and blit them with one `drawImage`.** [#81]
- **Where:** L109521. Jump: `function _hlfDraw(ctx, W, H, v)`
- **Impact:** **measured** on an RTX 4070 (reproduced independently).
  - **2.2-2.4 ms (full), 2.3-3.0 ms (READY), 1.3-1.9 ms (combat)** of GPU-process work saved per draw.
  - ~0.1-0.2 ms when every value changes on every draw. It is never worse.
- **Fix:**
  - Implement the harness version (`vf_hlc_mk.mjs`, `_lcRun`).
  - Key the cache on the inputs **plus an entry-state signature**: lineJoin, lineCap, miterLimit, lineDash, composite op, shadowBlur and shadowColor.
  - Draw live when the entry style is a gradient or pattern.
  - Blit at integer offsets and restore the end state (for example `lineJoin = 'round'` after the CORE blit).
- **Risks:** state leaking across the cut. Invalidate on dpr, hudScale and resize. Shake windows draw live.
- **Measure:** the `hlc_run.mjs` patterns.
- **Votes:** confirmed 0.80 / partial 0.75.

#### XR

**O2.24 · VR ship-name labels raycast line of sight for every in-range entity every XR frame, uncached.** [#10]
- **Where:** L26820, called through `_vrUpdateAllHealthBars` at L33581. Jump: `function _vrUpdateShipNameLabel`
- **Mechanism:** the flat callout caches the same test at 15 Hz and skips undrawn hulls. The VR path has neither, and hub traffic pseudo-entities qualify too.
- **Impact:** computed, VR only.
  - PCVR at 90 Hz: N=5 costs 0.45-0.6 ms per frame, N=8 costs 0.7-1.0 ms. The cache saves **~0.4-0.85 ms**.
  - Quest is ~3-4× per ray (estimated).
- **Fix:** keep every existing gate and its order. Optionally gate on a drawn hull. Add a **staggered** per-entity 0.067 s cache after the 3,500 u distance gate.
- **Risks:** 67 ms occlusion latency, the same as flat mode (which may even steady the tags). Without the stagger, the cost returns as a spike (see O2.15).
- **Measure:** a raycast counter over the Quest remote console; XR frame time and `_xrGov` tier residency.
- **Votes:** partial 0.78 ×2.

#### Audio

**O2.25 · Every PannerNode runs Chromium's per-sample azimuth path because the listener gets a new `setTargetAtTime` every frame. Switch panners and listener to k-rate.** [#58]
- **Where:** L140609 `_acquireSpatialTriple`; `_audioUpdateListener` L140666 (and again per spatial sound at L141352). Jump: `function _acquireSpatialTriple`
- **Modes:** everywhere, including Quest and phones.
- **Mechanism:**
  - Chromium keeps a param sample-accurate until a SetTarget converges, which takes ~10 time constants (0.2 s). A new event arrives every frame.
  - Nothing sets `automationRate` (0 hits), so `PannerHandler::Process` takes the per-sample path for every panner.
- **Impact:** audio render thread only; 0 ms on the main thread and GPU.
  - Each sounding panner costs 5-9 µs per 2.67 ms quantum.
  - A normal fight is **1.5-6 % of the audio thread**, and more in a Tracker mega-core volley, which is the v39.49d starvation scenario.
- **Fix:**
  - Add a hoisted `function _audioKRate(ps)` that sets `automationRate = 'k-rate'` behind an `'automationRate' in p` guard.
  - Flip the listener's 9 params once after context creation (L133044-133047).
  - Flip every panner's 6 params at **every** `createPanner` site, including `_carrierEngineStart` at L50712 (hence a function declaration, not a const).
- **Risks:** one a-rate panner, or an a-rate listener, keeps everything on the slow path. There is no audible change for HRTF.
- **Measure:** DevTools WebAudio "Render capacity" with a console toggle; `__audioStarve()` during a volley.
- **Votes:** confirmed 0.82 ×2.

#### Phone

**O2.26 · The phone reflection cadence has been dead code since v41.82, so phones refresh the full-scene mirror every 2-3 frames.** [#22]
- **Where:** L45787 `const _sm = _fxSmallDevice() && _swVrNoRefl();`, which sits after `if (_swVrNoRefl()) return;` at L45762, so `_sm` is always false. Jump: `const _sm = _fxSmallDevice() && _swVrNoRefl();`
- **Modes:** phones in the hub and in Earth. Desktop and presenting headsets are unchanged.
- **Impact:** mirror refreshes drop from 0.5 to 0.25 per frame in flight and from 0.33 to 0.17 parked. That is 17-25 fewer full scene renders per 100 frames (per-render cost on the Pixel 9 unmeasured). Also see O1.4.
- **Fix:** `const _sm = _fxSmallDevice() && !isXRPresenting();`. This restores v38.62's measured phone 4/6 cadence and keeps v41.82's headset exemption.
- **Risks:** it **brings back v38.62's staleness** under fast turns compared with today's phone build. It is a regression fix, but the owner should judge it on the Pixel 9 first. No rebuild is needed: `__water.reflGapMin=4; __water.reflGapMax=6`.
- **Measure:** `game._hubWater._reflWorldN` over 10 s; phone fps over the lake.
- **Votes:** confirmed 0.87 / partial 0.85.

#### Long-session memory

**O2.27 · Endless (and assault) never release dead wave bots.** [#85]
- **Where:** L12367; `Bot.die` L68738-68740 only does `scene.remove`. Classic's `spawnBots` (L93414-93424) destroys bots; endless never gets there. Jump: `_spawnWave(run) {`
- **Mechanism:**
  - Corpses stay in `game.entities`, so the hull pool stays empty and every wave builds fresh hulls (feeding the LayeredFX and shield registries).
  - `animateShipMesh` runs on every corpse in the unguarded main loop (L132561-132574).
  - The co-op `bot_state` packet grows.
- **Impact:** measured in desktop node. `animateShipMesh` costs **0.10 ms per frame at 150 corpses** and rises linearly; the registries add ~0.02 ms. That is ~150-360 corpses per hour, plus GPU memory.
- **Fix:** in `_spawnWave`, before `waveN++` and the `new Bot` loop, sweep `Bot`s with `!isProxy && !alive && team === LSS.TEAM_FLEET_B`: strip the VR label (O2.29), `destroy()` (which pools the hull), then splice. Assault needs an age gate.
- **Risks:**
  - The replay borrows `A.ent.mesh`, so null `b.mesh` after pooling.
  - Peers must have seen the death first (the v47.45 lesson). Do not sweep at wave clear.
- **Measure:** `lssPerfSnapshot()` counts at each "WAVE N CLEARED" over 20 waves; they should be flat after the fix.
- **Votes:** confirmed 0.85 / partial 0.80.

**O2.28 · `_atomFractalMaterials` only grows, two per-frame loops walk all of it, and expired rock fragments are never disposed.** [#42 #45]
- **Where:**
  - L74637; the push at L74759;
  - the loops `_syncVRLiteMaterialUniforms` (L89357-89362) and `updateEffects` (L89440-89449);
  - the fragment expiry in `DestructibleObstacle.update` at L74327.
  - Jump: `const _atomFractalMaterials = [];`
- **Mechanism:**
  - Only the two warm teardowns splice the array (L72428, L86281).
  - `_disposeVRRockMesh` and the rockChunk release never deregister.
  - Each entry pins ~3.5 KB of per-call shader source.
- **Impact:** measured in node.
  - ~4.9 KB of heap per material, ~105 per classic round (more in race), ~4,000 after an hour solo and ~8,000 as a multiplayer non-owner.
  - ~45 ns per entry per frame, so **~0.2-0.4 ms per frame after an hour**, plus undisposed fragment geometry.
- **Fix:**
  - Share the uniform objects `_AFM_TIME` / `_AFM_VRLITE`; the only writers write the same value. Delete the push but keep the const, which the warm `indexOf` still reads. Replace both loops with single writes.
  - On fragment expiry, use the `_disposeVRRockMesh` idiom from `_fragmentExplode`.
- **Risks:** `ShaderMaterial.clone()` deep-clones uniforms (no atom material is ever cloned). No swap-remove by index, which conflicts with the warm `indexOf`+`splice`.
- **Measure:** a temporary probe `window.__afm`; `__prof['fx+hud+minimap']` on a fresh page against after N rounds; `renderer.info.memory.geometries` across rounds.
- **Votes:** #42 partial 0.80 · #45 partial 0.85 / confirmed 0.88.

**O2.29 · VR name labels ride pooled bot hulls: one sprite, line and 512×128 CanvasTexture per bot per round, and labels visible at round end stay drawn through walls.** [#83]
- **Where:** L26741, `bot.mesh.add(sprite)` (L26785-26786); the pool put at L64341-64350; reuse at L65255. Jump: `function _vrEnsureShipNameLabel`
- **Impact:** 256 KB of VRAM plus ~256 KB of canvas per label, ~150 per hour: **~38 MB VRAM + 38 MB canvas per hour on Quest**. Orphaned labels are never updated, which **improves** once fixed (no more phantom tags).
- **Fix:**
  - In `Bot.destroy()`, hide `_vrNameSprite` and `_vrNameLine` before pooling.
  - Adopt instead of rebuilding: `if (bot._vrNameSprite && bot._vrNameSprite.parent === bot.mesh) return ...`, and adopt a flagged child (`userData.vrNameLabel`) found on the pooled hull.
  - Land together with O2.27.
- **Measure:** `lssPerfSnapshot().rendererInfo.textures` per round in XR.
- **Votes:** confirmed 0.85 / partial 0.85.

#### Loading, prebake and menu

**O2.30 · The post-match picker rebuilds the finished match's level on every map, theme or mode click, then throws it away at launch.** [#55]
- **Where:** L14911 `selectMap` → `applyMapPreset` (L27365) → `setSandwichBiome`, which calls `buildRoomGraphLevel(game.currentLevel)` at L58989. `returnToRootMenu` (L106368) leaves `currentLevel` resident. Jump: `function selectMap(mapKey, opts)`
- **Modes:** the post-match picker in any mode. **Every peer** pays on an inbound `map_change`.
- **Impact:** a menu hitch of **~130 ms per click** on wall power (the code's own v38.99 figure for a non-kept rebuild), and a 168-176 ms frame in elimination; more on phones.
- **Fix:** after the `_swapArmed()` return: `try { if (game.currentLevel && game.state === 'select' && typeof _lssPickerOwnsFrame === 'function' && _lssPickerOwnsFrame()) return name; } catch (_) {}`
- **Risks:**
  - Do not gate on state alone: the between-rounds picker (`warmup`) and the campaign death picker (`playing`) must keep rebuilding.
  - The XR gate inside `_lssPickerOwnsFrame` keeps VR identical.
  - Verify the launch path still rebuilds. Nothing (for example a keep check) may assume `sandwichTerrain.biome` matches the resident world.
- **Measure:** a LoAF observer in the post-match picker while clicking the map arrow 3-4 times.
- **Votes:** partial 0.82 / confirmed 0.86.

**O2.31 · Full-scene warm renders fill the whole live scene rect. The 12-pass prime should draw into an 8×8 scissor, as `_warmDrawRoot` already does. (Known-open: map v39.79.)** [#77]
- **Where:** L86416-86417. Jump: `async function _prebakeGpuPrime`
- **Impact:** loading only. **~50-150 ms off LAUNCH→lift** in a 1080p HIGH hub (native rect 2.07 MP), ×2 on staged traverses, ~0-30 ms in the pane, and up to ~0.3-0.6 s at 4K ULTRA (estimated).
- **Fix:** save `rt.viewport`, `rt.scissor` and `rt.scissorTest`, set them to 8×8 with the scissor test on, render, then restore in a `finally`. Put it behind a `window.__primeFull` knob. Treat the entity-prime `renderFrame`s and the fx warm the same way.
- **Risks:** three sizes the transmission RT from the active viewport per `camera.id`. If transmissive materials are ever in view, give the prime its own camera, as `_warmDrawRoot` does. Program keys do not depend on the viewport (v39.79).
- **Measure:** `__prebake().ms.gpu/.ent/.fx/.fence` and `__gpuFence`, 3 runs per arm at 1920×1080.
- **Votes:** partial 0.65 / partial 0.75.

**O2.32 · `_birdFlockTick` has no `F._pending` gate, and the ripple sim has no async precompile.** [#78]
- **Where:** L43882 (`F.gpu.compute()` unconditional), against fish at L44088/L44113. Jump: `function _birdFlockTick`
- **Impact:** cold ANGLE cache only. ~0 on the first cold hub launch, but up to ~1-2 s of main-thread join on a relaunch or world change that rebuilds the flock with a short build. The ripple compile is unmeasured.
- **Fix:** `if (F.frame % cad === 0 && !F._pending)` at L43878. Correct the v39.72 map entry, which claims both ticks are gated. For the ripple: factor out `_swRippleUpEnsure()` and `compileAsync` with the right target bound (`toneMapped=false`).
- **Risks:** keep the 8 s unwedge timer and the prime's direct computes (L86312-86314).
- **Votes:** partial 0.66 / partial 0.72.

**O2.33 · The arena boundary grid builds 61,206 collinear 500 u segments that draw as 606 lines.** [#13]
- **Where:** L33860. Jump: `(function createArenaGrid() {`
- **Impact:** boot, desktop: **11-33 ms → ~0.1 ms** (33 ms cold), and ~122k fewer `Vector3`s (6-8 MB of garbage). Marginal on phones (step 2000).
- **Fix:** n = `floor(2s/step)+1` lines per face in a `Float32Array`. Keep the overshoot and the tier step.
- **Risks:** very long lines on mobile tilers. Keep the pieces on tier > 0.
- **Votes:** confirmed 0.85.

**O2.34 · Non-hub `_stGroundY` / `_stCeilY` compute a domain-warp noise pair multiplied by `WARP = 0`.** [#20, step 2]
- **Where:** `const wx=x+T.WARP*_stNoise2(...)`, where `T.WARP = _isHubMap ? 250 : 0` (L128244).
- **Impact:** a further cut on every non-hub terrain sample, for both shells and `worldSDF` (size per the #20 node harness).
- **Fix:** `T.WARP ? x + T.WARP*_stNoise2(...) : x`.
- **Risks:** it edits `_hbFamily` sources, so the hub bake key changes and **one cold hub re-bake** follows (~9 s behind the curtain, the same cost v47.02 accepted). The marching-cubes worker copy must stay byte-identical.
- **Votes:** partial 0.80 / partial 0.85.

---

### ⭐ ORDER 3: small, speculative, or measure first

- **O3.1 · Static-matrix flags** [#3]
  - Where: L23164, `const scene = new THREE.Scene()`; foliage emits at L35724, L36255 and L36655-36729.
  - Finding: every render recomposes every static node.
  - Impact: **0.03-0.15 ms per frame** in the hub (the claimed 0.4-1 ms assumed a 4-8k static census the code does not have). Phone and Quest 0.05-0.2 ms.
  - Risk: silent staleness in anything flagged. Take a census first.
  - Votes: partial 0.65 / 0.75.
- **O3.2 · `resolveDepthBuffer: false` on `_rtSceneOpts`** [#7]
  - Where: L29007-29011.
  - Only for **strict ULTRA** opt-in players; ~0.08-0.35 ms per render into rtScene.
  - Pre-existing hazard found while checking this: r165 invalidates the MSAA **colour** attachment after every resolve, so the ULTRA ADS overlay pass (`autoClear` false) draws onto an invalidated attachment. Check that as a correctness bug.
  - Votes: partial 0.6.
- **O3.3 · Clipmap atlas partial upload** [#16]
  - Where: L58108.
  - Each snap uploads the full 1.05 MB atlas.
  - Impact: ~0.005-0.02 ms per frame at cruise and ~0.02-0.06 ms at 1,400 u/s. Snaps never coincide, so there is no hitch.
  - A twin finding was refuted as under the bar. Only act on it if a 1,400 u/s LoAF trace shows it.
  - Fix: own `texSubImage2D` spans. Never use r165 `copyTextureToTexture` (its `getParameter` calls block).
  - Votes: partial 0.72 / 0.75.
- **O3.4 · `__glBytes` bind hooks** [#12]
  - Where: L24378.
  - A null-prototype dictionary with integer keys costs ~60 ns per `bindTexture`/`bindBuffer`; a `Map` costs ~7-10 ns.
  - Impact: 0.015-0.07 ms desktop, 0.04-0.2 ms phone and Quest.
  - Keep the hooks always-on (v47.36) and check `__glBytesRead()` is unchanged.
  - Votes: partial 0.6.
- **O3.5 · Tree and drape planting test order** [#18]
  - Where: L36165 (`_swMoistAt`/`_swExposeAt` run before the `dens` rejection that drops 97.9 %), L36125, L36556.
  - Impact: **measured** −0.3-0.35 ms per foliage-build frame (~1 ms on phones); 0.02-0.1 ms per frame amortised.
  - Keep a named `_ECO_MAX = 1.77` bound next to the ecology formula.
  - Votes: partial 0.8.
- **O3.6 · Water foam block** [#24]
  - Where: L45044.
  - All whitening is off by default (`uFoamAll` 0, `uShoreFoam` 0), yet the block still evaluates.
  - Impact: ~0.01-0.02 ms desktop, 0.1-0.3 ms phone (estimated).
  - The proposed wrap **does not compile** as written: hoist `shoreA` (read at L45396) and merge the `nearDepth` fetch, or FXC flattens the branch (X4121).
  - Votes: partial 0.6.
- **O3.7 · Outline Optics rim culling** [#31]
  - Where: L101452, `_mirrorMeshTree`.
  - Perk only. ~37 wasted draws and 240k tris with 5 bots (0.1-0.35 ms CPU).
  - Fix: set `frustumCulled = true` on rim meshes from the tick after creation, so the first draw still links the program.
  - Votes: partial 0.72 / 0.8.
- **O3.8 · Wild leviathans on non-authority peers** [#43]
  - Where: L79710, `tickProxy`.
  - It has no 14 km gate; copy the authority's.
  - Impact: mixers 60-100 µs per frame, plus ~3 far skinned draws.
  - Votes: partial 0.72.
- **O3.9 · Lightning pool, corrected** [#47]
  - Where: L83438.
  - `forceSinglePass` is a **no-op** (see top).
  - What remains is merging halo and core into one draw (a new attribute and a new program, warmed in `_warmupEffectShaders` and `_warmRuntimeFxOnce`) and culling the bolts.
  - Impact: ~0.05-0.14 ms while a core runs, CPU only.
  - Votes: partial 0.75 / 0.82.
- **O3.10 · Energy Syphon triple helix build** [#48]
  - Where: L100271.
  - ~2 ms JS and ~400 KB of uploads per hit, split across two `setTimeout` tasks.
  - Fix: share the geometry through an explicit refcount (this is the shared-geometry-disposal class).
  - Votes: partial 0.7.
- **O3.11 · HUD redrawn while `display:none`** [#50]
  - Where: L111690.
  - Applies in ghost mode, orbit view and the final kill cam: ~0.15-0.3 ms per frame on phones, negligible on desktop.
  - Fix: a `classList` check (never `getComputedStyle`). Keep the `_hudSharedTail` decays at HUD cadence (v35.40). VR must keep drawing.
  - Votes: partial 0.62.
- **O3.12 · Hidden `.lss-tag` infinite animations** [#54]
  - Where: L2102.
  - **Measured** ~25 µs per frame on desktop, 50-100 µs on phones.
  - Fix: pause them. Never use `animation:none` or `display:none` (v40.94).
  - Votes: partial 0.72.
- **O3.13 · `joinRoom` serial awaits** [#56]
  - Where: L10164.
  - Fix: `Promise.all` the trystero import and the TURN POST, plus an in-flight ICE prefetch promise (never cache a failure).
  - Impact: 0-300 ms of click-to-picker latency.
  - Votes: partial 0.62.
- **O3.14 · Reverb** [#59]
  - Where: L133147.
  - `probeEnvironmentOpenness` is frozen at 0.7 (`game.mapMeshes` is never populated), so the 0.7/0.3 blend is constant. One pre-mixed IR with `normalize=false` set **before** `buffer` does the same work.
  - Impact: ~1-1.5 % of the desktop audio thread.
  - The map entry at L1579-1580 that lists the probe as live is stale.
  - Votes: partial 0.72.
- **O3.15 · Earth patch post-passes to a Worker** [#61]
  - Where: L145548.
  - 0.3-0.7 s of sliced main-thread CPU per dense patch, 3 patches per cell crossing, which affects in-play frame pacing.
  - It is a large refactor with a determinism requirement (DEM heights and `_bldList` drive collision).
  - Measure first: count LoAF entries while `__earthTiles._pending.size > 0`. v47.03's rejection was about load time, not pacing.
  - Votes: partial 0.6 / 0.62.
- **O3.16 · Snell's-window copy shader** [#75]
  - Where: L43334.
  - It links on the first dive of a session (~4-8 ms cold).
  - Fix: warm it in `_prebakeGpuPrime` with a 4×4 HalfFloat target.
  - Also: `mesh._aboveRT` is never disposed in `_swDisposeHubWater`.
  - Votes: partial 0.6.
- **O3.17 · Shore-mask rebake** [#80]
  - Where: L40959.
  - Step 1: check the budget every row instead of every 4 rows (identical output).
  - Step 2: reuse the 68-83 % overlap, on the hub's flat path only. Earth tiles and endless carves must still full-bake.
  - Impact: ~0.08 ms per frame desktop, 0.2-0.3 ms phone. It also improves the stale edge.
  - Votes: partial 0.6.
- **O3.18 · Phone** — adaptive resolution only resizes the canvas [#86]
  - Where: L62992.
  - rtScene is sized from `innerWidth·min(dpr, bloomDPR)`, so the scene pass never shrank. Each step only reallocates the drawing buffer (a hitch), blurs the final image and changes particle size.
  - Fix: make it opt-in only, and only after a Pixel 9 A/B (the net sign is unknown).
  - Side benefit: XR stops calling `setPixelRatio`.
  - Votes: partial 0.82 / 0.78.
- **O3.19 · Memory** — LayeredFX orphans [#33]
  - Where: L64093.
  - 4 never-attached LayeredFX materials per hull build stay in `_ACTIVE_LAYERED_FX`, and `_energyShieldMaterials` is push-only.
  - Impact: 7-20 µs per frame over a realistic session; ~27 KB per build.
  - A twin was refuted as negligible.
  - Fix: build the legacy engine materials only when there are no thruster markers; make the shield list a Set with a `dispose` listener.
  - Votes: partial 0.8.

---

## 3. Win-wins (better graphics and faster)

- **O1.7 peer tags:** stops the unintended double-stacking and saves 0.47-1.17 ms per frame.
- **O1.10 crest readback:** spray back to its designed rate, and the 1-15 ms stalls gone.
- **O1.9 watchdog:** no more burst of out-of-vsync frames after every long frame.
- **O2.13 projectile core shadow:** removes a physically wrong smudge and saves draws.
- **O2.29 VR labels:** no more phantom tags through walls, and VRAM stops leaking.
- **O3.17 shore mask:** the stale edge window shrinks from ~40 frames to ~12.
- **O3.18 phone dynres:** no resolution-step blur or particle-size jumps.
- **Phone cloud churn** [#76], L28190, Jump `cloudChurn() {`.
  - v39.02 made `getVRBudgetTier()` return 1 on phones. That froze BCS sprite drift (`uChurn = 0`) as a side effect: churn was never in v39.02's budget list.
  - The gate's reason ("3 sin() per slot per frame") is from before v32.91. The drift now runs in the BCS vertex shader, whose sines are computed regardless of `uChurn`.
  - Fix: `cloudChurn() { return getVRThrottleTier() < 1; }`, or keep exact headset behaviour with an `isXRPresenting()` clause.
  - Cost: 0 GPU, and one fewer `matchMedia` per frame.
  - It is a visible change (the desktop look), so it needs the owner's eyes on the Pixel 9.
  - Votes: partial 0.8.

**Quality for about zero cost** (no perf gain; kept here so nothing is lost):
- **Bloom and Panini tap footprint** [#70], L29148, Jump `postFX.brightMat = new THREE.ShaderMaterial`.
  - The bright pass takes one bilinear tap per bloom texel at a fixed ~4.24:1 scene ratio. Only ~22 % of scene texels feed bloom, so 1-3 px emitters (tracers, far windows) flicker.
  - Fix: take 4 taps at ±0.25 bloom texel per axis, with the soft knee applied per tap. The result is unchanged at R=2.
  - In a 1D model, the temporal CV of a thin emitter falls from 1.08 to 0.38 (1 px). Cost < 0.01-0.05 ms.
  - The owner tunes bloom by eye, so show a live A/B.
  - Votes: partial 0.72.
- **Anisotropy on GLB hull, monster and carrier textures** [#71], L61984.
  - The chase camera views the deck at 15.6°, but GLTFLoader leaves anisotropy at 1.
  - Fix: set `min(8, maxAniso)` in every loader callback before the first upload (L62045, L13138, L50672, L78950, L79496, L144803). Desktop only.
  - Cost < 0.05 ms.
  - Votes: partial 0.75.
- **Phone texture shrink** [#72], L61972.
  - Add `imageSmoothingQuality = 'high'` before `drawImage` (the same idiom as L146843). This gives an exact box average at 4:1 and 8:1 instead of aliased bilinear.
  - Runtime cost is 0. Scope it to model textures (the sky loses stars).
  - Votes: partial 0.85.

---

## 4. Checked and NOT a problem (do not re-investigate)

- **Lightning halo/core "two-pass" [#44, overturned here]:** the pool uses `ShaderMaterial`, which r165 constructs with `forceSinglePass = true` (`ShaderMaterial.js:33`). The same fact kills the BCS, shield, smoke-cone, fire-cloud, bow and Reflector "two-pass" claims. **Always check the material class before claiming the DoubleSide split.**
- **BCS "draws twice, switch to FrontSide":** same reason; one draw already.
- **Cavern flat Reflector "drawn twice to fire onBeforeRender":** it is a stock ShaderMaterial, so it is single-pass.
- **BCS high-water `instanceCount` + `addUpdateRange`:** 10-30 µs at best, under the bar.
- **Clipmap VS fetching the same parent texels twice:** real, but too small to count.
- **Hub grass on the undrawn ground shell:** grass is **off** in shipped play (`sandwichGrass: false`, L7657). What is left is under the bar (see the known-open discarded shells).
- **Shared or vertex-cache-ordered shell index:** memory only. Sharing one index brings back the shared-geometry-disposal bug class that has shipped half-fixed twice.
- **Rim-sealed coincident shell triangles beyond the seal wall:** invisible, but the per-frame saving is too small.
- **Earth terrain shadow proxy (a flat plane):** under 0.05 ms per frame.
- **Instanced debris and sparks drawing full capacity:** under the bar, and the only fix that recovers the cost is unsafe.
- **Dynamic light pool evicts the oldest light:** no performance gain, and almost no visible one.
- **A new ShaderMaterial per fire burst:** 0.002-0.014 ms per frame.
- **Spire A* `Math.hypot`:** under the bar, and v47.83 already caps the hitch.
- **Bot fire gate / fireAtShip duplicate line-of-sight ray; gas-pocket `worldSDF` computed twice; gas chemistry's 27-bucket scan:** all real and all far under 0.05 ms.
- **HP hatch, main-thread view (the refuted twin of O1.8):** main-thread cost is 0.06-0.09 ms. The real cost is **GPU-process raster**, which `__prof` cannot see. Measure canvas work in the GPU process.
- **Cold-program watcher `setInterval` leaking one per launch:** far under the bar.
- **NetworkPlayer charge-glow tubes leaking; Earth teardown pinning one 3072² texture; the procedural PMREM kept resident:** memory pins with no frame-time or hitch effect.
- **Prebake cosmetic tail:** 0.3-0.9 ms, under 1 % of a 100-2000 ms prebake frame. The known-open cost is load work and GPU backlog.
- **Hit claims broadcast to the whole room; `updateAmbientBed` AudioParam churn; curved label sprites at 1× DPR:** facts check out, but the gains are under the bar.
- **Music-reactive sky reads silence (the mp3 is outside the Web Audio graph):** real, but not a performance item, and the fix is not visually neutral.

---

## 5. Measurement plan

**Rules** (from the v47.05 and v47.07 experience):
- Put `renderer.info.autoReset = false` with a `reset()` in a trailing rAF, so counts are **totals across passes**. The mirror's nested render otherwise resets them mid-frame.
- Take GPU A/Bs at a **1920×1080 emulation** on a **settled** world, **interleaved** on/off/on/off. The pane understates hub GPU by ~3×.
- Every debug toggle must be **symmetric**: restore state, do not just stop gating (the v47.06 lesson).
- Fix the governor scale (`__ss`) for fragment-bound A/Bs, so both arms render the same rectangle.
- Phone items get the owner's eyes on the Pixel 9.

**Order to run, cheapest proof first:**
1. **O1.1 Earth traversals.** Pure CPU; the pane is fine. Read `__prof['earth:tiles']` and `['earth:matfix']`, `T._patches.size` and the scene node count, then patch and re-read. Expect ms-scale drops after wandering a city.
2. **O1.4 mirror matrix walk.** In the hub console, the `scene.updateMatrixWorld()` ×50 timing gives the exact saving per mirror refresh on this machine before any edit. Then check `__prof` renderFrame and `?pbseg` `mirror`.
3. **O1.3 light skip.** `?nolightskip` reload A/B at 1080p in the hub and classic, reading `?pbseg` `scene` and `mirror`, plus a pixel diff. Repeat on the phone and Quest, where it should matter most.
4. **O1.2 far-foliage extension, O1.5 dome gate, O2.1 Panini mask.** One settled hub pose at 1080p, interleaving `__treeVis`-style / `uGateOff` / `__panMask` toggles. Record triangles, calls, `?pbseg` `scene` and `mirror`, and fps/p99. Get the dome ceiling first with `__domeHide`. The mask and the dome gate overlap (the top lens *is* sky), so measure the dome gate first and the mask on top of it.
5. **Hitches:** O1.9 (`__wdN` plus a forced 200 ms frame), O1.10 (`__water.crCost` and `crSkip` near water), O1.11 (split `hub:sky` and fly a 60 s dash with a LoAF observer). For O2.17, O2.18 and O2.19, use F8 marks at the event.
6. **Loading:** run the node harnesses first (Spire `floorHole`, shell pairing, colour skip, moss table; each checks exactness), then fresh-page LAUNCH→lift, 3 runs per arm: `__spireMesh().ms`, `__prebake().ms.terrain`, `[hubcity] built`. O2.30 is a LoAF observer on post-match picker clicks.
7. **Multiplayer:** two-tab room `PERFRV` for O1.7 (count the peer's visible label divs, `__prof['fx+hud+minimap']`).
8. **GPU-process HUD** (O1.8, O2.22, O2.23): the scratchpad `hlc_run.mjs` / `mkbench.mjs` harnesses first, then a Chrome trace of CrGpuMain slices at the HUD cadence in game. `__prof` cannot see this cost.
9. **Phone:** O2.26 with the live `__water.reflGapMin/Max` knobs (no rebuild), `#76` churn by eye, and O3.18 as a matched two-fight A/B before anything ships.
