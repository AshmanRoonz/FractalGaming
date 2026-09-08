# `lss.map.md` — architecture & navigation map for `index.html`

> Companion map to the single-file WebGL game `index.html` (build **v36.56**).
> The whole game is **one classic `<script>`** defining `function _bootLSS()` spanning **lines 3036–70463** — one giant shared lexical scope, no modules.

## How to use this file

- **Jump by anchor, not by line number.** Each entry has a **`Jump:`** string — a unique declaration you can Ctrl-F / grep for (`function fireWeapon`, `class Bot`, `const audio`). The `~L#####` line hints are approximate and **drift** as the file grows; the anchor never does.
- **To find a subsystem:** scan the Section Map below (it's in file order, grouped into PARTs), grab the `Jump:` anchor, search for it in `index.html`.
- **To keep this current:** when you add/remove/rename a subsystem, update its entry here. Keep entries **coarse** (subsystem-level, not per-function). To refresh the `~L` hints after big edits, grep each anchor.
- **Sibling of** `index.html` in `LSS/` — the **site root** since v36.09: `LSS/` is exactly what deploys to `lss.fractalreality.ca` (via `tools/deploy_cf.py`); the repo root above it holds only dev tooling (`strip.py`, `check_scripts.js`, `tools/`) and separate projects, none of which ship. This is a doc — it changes nothing at runtime and preserves the single-file build.
- **Companion:** [`index-working.html`](index-working.html) is the *current* 34.62 code with ~93.6% of the stripped comments restored (from the 34.37 snapshot `last_ship_sailing.html`), proven code-byte-identical to `index.html`. Use it as a **reading copy** — this map is the high-level index; `index-working.html` is the line-level detail. The shipping `index.html` stays comment-stripped/lean.

---

## Architecture at a glance

- **One closure.** Everything from line 3036 to 70463 lives inside `_bootLSS()`. There are no ES modules, no `import`/`export` — every function, class, `const`/`let` shares one scope. `THREE` is the only true global (`window.THREE`, bridged in by a small `type="module"` script above `_bootLSS`).
- **Define-then-init.** The file *declares* ~950 functions + ~660 top-level `const`/`let` top-to-bottom, then **runs the real initialization at the very bottom** (`initAudio()`/`loadSettings()`/`buildShipSelect()` … `renderer.setAnimationLoop(gameLoop)` around **~L68910–69115**). Almost nothing executes until then.
- **~13 load-bearing singletons** hold all shared state (see the Singletons table). `game` (~2,900 refs) and `player` (~2,570 refs) are touched almost everywhere.
- **Frame flow:** `gameLoop` (**~L59523**) → updates every subsystem → `renderFrame` (**~L16800**) → `renderPostFX` / XR / direct path.
- **Perf profile:** the hub is **GPU-bound** on the dev machine. Diagnose live with `window.lssPerfSnapshot()`.

---

## ⚠ Critical rules & traps (read before editing)

1. **Init order is load-bearing.** The "define now, init at the bottom" model is why forward references work: `const audio` is declared at **~L60104** but used **~138×** earlier; `_spawnBossPortal` is defined at **~L34013** but *called* at ~L5763/5970/9145. **Don't reorder top-level blocks** without checking that nothing runs them before their declaration.
2. **Silent-no-op guards.** There are **~916 `typeof fn === 'function'`** guards around forward-referenced calls. A missing/renamed function **degrades to a silent no-op — no console error.** If you rename something, update *every* guarded call site, or a feature just quietly vanishes.
3. **Keep `antialias: true`** on the renderer (~L13340). The GPU birds/boids (**`_boidsVelFrag` ~L18943**) are MSAA-sensitive — disabling AA regressed combat *and* birds/forest.
4. **Never re-add object pooling for projectile/tracer VISUAL bundles** (`class Projectile` ~L25927, `spawnTracer` ~L35789). Pooling those regressed combat for bots *and* multiplayer. Per-shot allocation is intentional.
5. **Warmup must bind `postFX.rtScene`.** The "combat first-sight hitch" fix lives in `_shaderWarmup` (**~L26883**) and `_warmRealCombatFX` (**~L33546**); both must `renderer.setRenderTarget(postFX.rtScene)` so shader programs compile in the gameplay colorspace. Removing that bind brings the hitch back. **(v36.17) THE FULL RULE — three things fork a three.js program cache key without changing one character of GLSL, and all three must match the frame the effect will really be drawn in:** (a) the bound **render target** (null = sRGB output + tone mapping; any RT = linear + `NoToneMapping`), (b) **`scene.fog` presence** (a warm scene with no fog links a different program even for a fogged material), and (c) the **per-type LIGHT COUNTS** of the scene being rendered — `numDirLights`/`numPointLights`/`numSpotLights`/`numHemiLights` are in the key *even for unlit `MeshBasicMaterial`*, so an isolated warm scene is never a valid stand-in for the live one. Any warm render/compile of a gameplay material must therefore run against the **live `scene`** with **`postFX.rtScene` bound**. See PART 13's v36.17 entry for the probe that proves it.
6. **`_clip` name collision.** `_clip*` at **~L22110** = the *terrain clipmap* LOD system (`_clipGeo`/`_clipBuild`/`_clipUpdate`/`_clipmap`). `_clip` at **~L46572** = the *video recorder* (MediaRecorder). Totally unrelated — grep with care.
7. **Triplicated terrain math.** `_st*` / `sdSphere` / `worldSDF` exist in **three copies** that must stay in sync: worker-string copy (~L17041), main-thread copy (~L17208), and the collision copy `worldSDF` (~L22496). Editing one without the others desyncs terrain vs. collision.
8. **Hub perf wins that stuck** (keep them): grass off by default, shadow map 2048², reflector throttle + RT shrink. Perf lives in `gameLoop`/`renderFrame`. **(v36.42)** the reflector throttle is now movement-aware (2..3 frames, not a flat 3) and the displaced water plane no longer renders into the reflection it samples — see PART 8's hub-water entries before touching any of it.
9. **A mode hook can end the match MID-TICK.** `updateRoundSystem`'s `'playing'` branch counts `aliveA`/`aliveB` at the TOP, then calls `activeMode().update(dt)` — and `EndlessMode` can call `returnToRootMenu()` from there, which resets `game.testMode`/`LSS.MODE`/`game.entities`/`game.state` underneath the rest of the branch. The `if (game.state !== 'playing') return;` guard right after the hook (v36.25) is what stops classic round-end firing into a torn-down world and leaving a ghost match running behind the menu. **Any new work added after that hook must sit BELOW the guard.**
10. **Fragile seams — re-verify after any combat/render edit:** (a) combat first-sight hitch, (b) hub framerate, (c) multiplayer combat. The sandbox renderer is useless for these; test in a real browser.
11. **(v36.29) NEVER hand-edit a `.glb` under `LSS/`.** Every shipped model is a BUILD ARTIFACT generated from `assets_src/` — see the Asset pipeline section below. Editing `LSS/**/*.glb` directly gets silently overwritten on the next run, and the pristine art only exists in `assets_src/`.

---

## Asset pipeline — GLB compression (v36.29)

`assets_src/` (repo root, **outside** the deploy tree) holds the **pristine originals** — 50 GLBs, 128.4 MB, byte-identical to the June art drop. Everything under `LSS/**/*.glb` is generated from it.

```
node tools/compress_glb.mjs          # rebuild all shipped GLBs   (one-time: cd tools && npm install)
node tools/compress_glb.mjs --dry    # report only, write nothing
node tools/compress_glb.mjs --only pyro
python tools/gen_manifest.py         # ALWAYS follow with this — refreshes preload sizes
```

Result: **128.4 MB → 40.7 MB on disk (−68%)**; preload manifest **90.6 MB → 63.5 MB**; total GLTF parse **810 ms → 647 ms**.

- **No runtime decoder.** Output is plain glTF plus `KHR_mesh_quantization` and `EXT_texture_webp` — both parsed natively by three.js r165, and both already shipping in this repo before the pass. Draco / `EXT_meshopt_compression` were rejected: they'd need a decoder wired into **all five** `new THREE.GLTFLoader()` sites, and a 404 decoder breaks every model.
- **Which slots survive is per-category and load-bearing** — three consumers disagree. `buildModelShipMesh` (~L29302) copies only `map`; but `bakeShipThumbnails` (~L29155) and **hub-city traffic** (~L26292) clone materials *as-is*, so hoard normal maps are live on 26 of 35 hub traffic ships. Dropping them saves 2.4 MB and silently replaces authored art with the procedural fallback — **don't**. `objects/Sphere.glb` is the one safe drop (`_champSelfIlluminate` collapses it to `MeshBasicMaterial({map})`).
- **Ship textures stay JPEG on purpose.** WebP decode costs ~25 ms vs ~10 ms for a 1024², worth it on the 1–3.5 MB hoard/monster PNGs but not on the ships' 0.42 MB JPEGs, where it saved 0.04 MB each and added **+16 ms parse each**. The `LOSSY_SOURCES` filter is PNG-only for that reason.
- **Two traps** (documented in the script header): `prune()` **must** get `{ keepLeaves: true }` or the empty `gun1`/`thruster1-4`/`cockpit1` marker nodes are deleted and muzzle/engine placement silently breaks; and the originals' non-spec `byteStride: 6` means a no-op round-trip on an already-quantized file *grows* it, so ships only win via `simplify`.
- **12 dead GLBs** (`objects/unanimated/**`, 6 unused rings) are in `assets_src/` only — unreferenced by code and absent from the manifest. `rings/fence.glb` still ships as a file but was removed from `OWNER_EXTRAS` in `gen_manifest.py`, so it is no longer preloaded (it has zero code references).
- **Bumping models:** drop new art into `assets_src/` at the same relative path, re-run both commands, then bump **`_MODELS_VERSION`** (not `LSS_BUILD`) so the cache-bust stamp moves.
- **(v38.92) The ship recipe JOINS cockpit parts per material** (`OVERRIDES.join`, `RECIPE_VERSION` 1.2). The c1seat hulls arrive as ~240 separate cockpit parts under a scaled/rotated `Cockpit_Root`: 244 draw calls and 244 mesh+material clones per spawn. `flatten` + `join` folds them to **14 primitives a hull** (what `buildModelShipMesh` clones and the GPU draws; the warmup log now says "14 ship meshes"). `join()` must run with `cleanup:false` or its own prune deletes the marker empties; the mesh-less leftovers are dropped by `dropJoinLeftovers` against `MARKER_RE`. WebP base-colour sources pass through untouched (no q88 generation loss). 66 MB of float32 exports -> 33.9 MB shipped. `assets_src/ships` was re-synced from the c1seat hulls on 2026-09-06 (source of truth).
- **(v38.93) TWO SHIP SETS, one stamp.** `OVERRIDES[ships/*].mobile = { baseColorMax: 1024 }` makes `compress_glb.mjs` write a second copy of each finished hull at `ships/m/<x>.glb` (base colour 2k -> 1k, ~-0.6 MB and a 4x cheaper decode each; 33.9 MB -> 29.7 MB for the set). `_shipsVariant()` (beside `_shipsBaseUrl`) returns `'m/'` when `_lssTexCap()` says small device (phone / standalone Quest / `window.__texCap.max` <= 1024 set before boot) and is memoised so `preloadShipModels()` and the manifest preloader agree; `gen_manifest.py` emits the small set as group **`ships_m`** and the preloader walks exactly one of `ships` / `ships_m` (64 entries either way). Both sets share `_MODELS_VERSION` - distinct URLs, so adding the 1k set needed no bump, but changing either set alone still does. Verified with the pane's mobile preset: `[ships] set: mobile`, only `ships/m/*` fetched, preload 44.2 -> 40.2 MB.
- **(v38.94) `cockpit1` is placed by the owner, baked into `assets_src/ships`** (a byte-exact glTF JSON edit of the marker's `translation`; the seats did not move). Model space: forward = -X, up = +Y. Blaster (x, +0.09), Puncture (-0.29, +0.09), Pyro (-0.08, +0.09), Slayer (-0.08, +0.09), Syphon (-0.33, +0.07), Tracker (-0.33, +0.03), Vortex (-0.46, +0.06). Re-running `compress_glb.mjs` carries them into both sets. The convention before this was "cockpit1 = hull bbox centre + a live `window.__cockpit.eye` nudge".
- **(v38.96) LEAN MOBILE SET.** `OVERRIDES.mobile = { baseColorMax: 1024, lean: true, cockpitRatio: 0.35 }`: standalone Quest / phones lost their GL context on the c1seat hulls. The `ships/m/` twin now keeps the base colour only (no normal map), has the clearcoat/specular/ior extensions stripped via `Extension.dispose()` so the loader builds `MeshStandardMaterial` (not Physical), a normal-tolerant re-weld and the non-hull primitives thinned to 0.35 (error 0.01) - ~80k tris a hull, **15.5 MB the set** (the pre-c1seat hulls were 18.7 MB). Note gltf-transform 4: `cloneDocument()`, not `doc.clone()`.
- **(v38.97) ROUND-TRANSITION HITCHES: ship pool + program retention.** Instrumenting the pane's GL context (linkProgram / bufferData counts per frame, `BufferGeometry.dispose` / `Material.dispose` stacks) showed every round transition disposing and rebuilding: bots (`spawnBots` -> `bot.destroy` -> `_disposeShipGroup` -> `new Bot` -> `buildModelShipMesh`, 14 meshes + 14 materials a hull now), obstacle clusters (`ClusterObstacle._buildChildren`, 232 geos), VR rocks (105 ShaderMaterials), terrain chunks (`resetSandwichTerrain` in `buildRoomGraphLevel`, 284 geos) and the launch warmup disposing its ghost-ship materials right after compiling them - each disposed material with no other holder FREES ITS PROGRAM, so the next round relinks it (16-19 links a transition, one of them a 224 ms cold link in `playing`). Fixes: `_botShipPool` (a dying bot parks its group by loadout|team|skin, the next bot takes it back; `_dimHullMat` reset), and `_lssRetainMat` applied to `_disposeShipGroup`, the obstacle rebuild, `_disposeVRRockMesh`, `Projectile.destroy` and the warmup ghosts. `_lssRetainMat` now retains by **three.js's own program keys** (`renderer.properties.get(mat).programs`, one material kept per real key in `window._fxRetainKeys`; the hand-rolled signature is only the fallback) - the signature could never mirror the real key (lights, fog, colourspace, UV channels, `customProgramCacheKey`), so the player's ghost-hull variants kept slipping through as duplicates and its round-start rebuild relinked 8 programs cold (a 1 s `player+weapons` frame). Result on the pane: **zero links at a round transition** (was 16-19), ship uploads gone; what remains is the 130 ms terrain/obstacle teardown. **Still per round and NOT ship-related:** the level itself is rebuilt every round (terrain chunks + obstacles + `_spawnBasinClouds` 765 sprites) - ~150 ms warm, a ~1 s pure-CPU frame seen in `warmup` - the next lever is skipping `buildRoomGraphLevel` when map/theme did not change.
- **(v38.98) Cockpit-part LOD + no interior shadows** (`buildModelShipMesh` tags every mesh whose material is `*_CP_*` as `userData._cockpitPart`, `castShadow=false`; `animateShipMesh` hides them past 300 u of the camera, shows inside 250). Measured at a frozen pose in a 5-bot arena: **-222k triangles and -18 draw calls a frame (-8.7%)** in the main pass, and the interiors' shadow-pass share is gone outright. The player's own ship is always in range of its camera.
- **(v38.98) Round-start facing.** `_facePlayerAtEnemy()` used to return without touching the heading when no live enemy was known (round 2+ on a non-authority client whose bot proxies arrive later, or any round where `respawnPlayer()` beat `spawnBots()` - the order varies), so the ship kept whatever heading the last round ended on. Now it falls back to the ENEMY TEAM'S SPAWN ROOM CENTRE (static `MAP_DATA` rooms), and the round>1 path re-faces right after `spawnBots()` while still in warmup.
- **(v38.99) KEEP THE TERRAIN BETWEEN ROUNDS** (`buildRoomGraphLevel`, `_keepTerrain`): when the round restarts on the same level object + biome + terrain mode with chunks resident and no pillar re-roll, `resetSandwichTerrain()`/`initSandwichTerrain()` and the T re-creation are skipped (only `_swApplyAtmosphere` + `_swSyncFX` run); rooms, race graph, bounds and `spawnDynamicObjects` still rebuild. Arena (Spire), gmaps, procedural, pillar maps keep the full rebuild. `window.__keepTerrain = false` restores the old path. Logs `[sandwich] terrain kept across the round (N chunks)`. **(v38.99) `_warmRealCombatFX` skips rounds > 1** once `_fxRetainKeys` holds >= 10 programs (the re-warm existed to recompile released programs, which no longer happens); `window.__fxWarmEveryRound = true` restores it. **(v38.99) Context-loss ladder** now steps every level down (`high -> medium -> low -> potato`) and a small device goes straight to LOW - the owner's phone was reloading on HIGH after every crash (`high | mobile ... classic/warmup` in both screenshots, i.e. the round transition).
- **(v39.00) LITE WARMUP ON SMALL DEVICES + async compiles** (`_warmupCombatShadersBody`): the owner's phone lost its GL context at `classic/warmup | up 25s` BEFORE the first match - the launch warmup adds 14 ghost ships (14 meshes each now), the model warm group and every FX pin at once and links every program in blocking `renderer.compile()` + render calls (37 s cold on the dev GPU), and Chrome kills a GPU process that stops answering. Small devices (`_fxSmallDevice`) skip the ghost fleet and the model warm group; the compiles the async body and the staged FX-pin slices can await go through `renderer.compileAsync` (parallel links, resolves when ready). `window.__fullWarmOnMobile = true` restores the full pass. Desktop warmup unchanged at ~3.5 s warm. Programs are retained (v38.97), so the first-sight compiles a phone now takes instead happen once per session.
- **(v39.01) PHONES WERE PINNED TO HIGH.** The boot-time quality restore (right after `applyQualityPreset`) promoted a stored `low`/`medium` to `high` on every launch - a pre-v36.09 legacy - which overwrote the phone's first-run LOW default, every LOW/MEDIUM picked in Settings and the LOW the context-loss ladder writes. Every crash overlay read `high | mobile`. Small devices now keep what is stored ; the desktop promotion is unchanged. (This is also why the v37.14 audit found "no reachable slow-PC preset" - LOW could never persist.)
- **(v39.02) PHONE CONTEXT LOSS - the regression window and the levers.** The owner's phone lost its GL context at round transitions (and once at launch) since v38; the v38.71 code already quotes the report. The window is **v38.60-38.64**: v38.60 turned the round rebuild from *detach* into *dispose + re-create* (rocks, organics, sprite textures, the outgoing hull) - on Android freed GPU memory is not reclaimed before the new allocations land, so the transition PEAK rose; v38.61 changed chunk streaming/readback; v38.64 the RT tiers (walked back for phones in v38.71). Quality was never the lever: LOW was promoted to HIGH at boot (v39.01) and on phones the tier does not resize the targets anyway. Measured resident set in one arena on the pane: ~98 MB geometry (72 MB terrain chunks), ~155 MB textures (PC 2k hulls), 174 programs. Fixes so far: terrain kept across rounds (v38.99), lean mobile hull set (v38.96), lite warmup + async compiles (v39.00), stored LOW respected (v39.01), **phones get the Quest budget tier and one terrain ring less** (v39.02). The crash overlay now prints `prog | heap | geoMB | chunks | tier | v` - read those off the next screenshot.
- **(v39.11) `bakeShipThumbnails` HAD BEEN RENDERING NOTHING.** `preloadShipModels` fits each prototype to its chassis `hullLength`, so `proto.scale` is ~85 for a canonical 2-unit hull. The bake measured the WORLD bbox (~170) and then called `model.scale.setScalar(180/170)` - **replacing** that 85x scale instead of multiplying it - leaving the ship ~2 units long in front of a camera at 320. Every thumbnail was a transparent PNG (0 opaque pixels of 3072 sampled, ~7 KB) and nothing errored. `multiplyScalar` fixes it (54.9 KB, 209 opaque). It also set `scene.environment = sceneEnvMap`, a PMREM **render-target** texture owned by the MAIN renderer that a second context cannot upload - and these hulls are metallic PBR, which renders near-black with no environment; the bake now builds a small sky gradient through its OWN `PMREMGenerator` (avg brightness 20 -> 60). This fed the teammates strip as well as the v39.09 mobile ship-select fallback.
- **(v39.12) Third-person first-switch hitch on phones.** Skipping `_ghostPinWarm` on small devices (v39.05) moved its cost to the first time the chase camera pushes into the hull: 6 programs linked, 40 ms + 56 ms frames. `_ghostPinWarmAsync` does the same ghost-hull warm through `renderer.compileAsync` - parallel links, never blocks the GPU, so no watchdog risk. Note it reproduces only intermittently: the game already starts in third person, so those programs sometimes compile during the launch cinematic instead.
- **(2026-09-06) PERF REVIEW findings still open:** (a) the level is rebuilt every round (`buildRoomGraphLevel` -> `resetSandwichTerrain` 284 chunk geometries, `spawnDynamicObjects` 232+105 obstacle/rock geometries, `_spawnBasinClouds` 765 sprites) - ~130 ms warm, up to ~1 s in a frame - skip it when map+theme are unchanged; (b) cold start links 156-176 programs synchronously in the launch warmup (3.4 s warm, 37 s cold on the pane) - `renderer.compileAsync` / KHR_parallel_shader_compile would overlap it with the countdown; (c) arena frame is ~2 M triangles at ~400 draw calls with 5 bots, ships ~440k of it after the LOD, terrain+obstacles the rest; hub CPU is ~3.5 ms a frame (renderFrame 1.9, ripple 0.3-0.75) and vsync-capped at 144 on the dev GPU at pane size - the hub is GPU-bound only at full resolution.
- **(v38.94) Glass by look, not by name** (`buildModelShipMesh`): any transparent ship material under 0.5 opacity gets `depthWrite: false`, not just `canopy_glass`. The c1seat panes (`*_Windshield_LaminatedGlass` 0.08, `*_CP_HUDGlass` 0.10) were writing depth a hand's width from the eye, so every transparent effect sorted after them - fire clouds and the tether trap (`renderOrder` 1), beams (2) - failed the depth test and vanished from first person.

---

## Core singletons (the shared state)

| Singleton | Jump anchor | ~Line | Role |
|---|---|---|---|
| `game` | `const game = {` | 3296 | match/world/mode state, `sandwich*` terrain toggles |
| `player` | `const player = {` | 3375 | local ship: health, kills, coreMeter, transform |
| `input` | `const input = {` | 3449 | keyboard/mouse/touch/gamepad + `fovDeg` |
| `net` | `const net = {` | 3598 | peers, networkPlayers, `send*` callback slots, room |
| `scene` | `const scene = new THREE.Scene()` | 12274 | render root |
| `camera` | `const camera = new THREE.PerspectiveCamera` | 13330 | far plane 25000 = `ARENA_SIZE` |
| `renderer` | `let renderer` | 13340 | WebGL renderer — **keep `antialias:true`** |
| `postFX` | `const postFX = { enabled: true }` | 15742 | render targets incl. `rtScene` (warmup colorspace) |
| `QUALITY` | `const QUALITY = {` | 16004 | quality presets + VR budget tiers |
| `_swU` | `const _swU = {` | 17450 | shared shader-world (terrain) uniform block |
| `dynamicLights` | `const dynamicLights` | 27184 | pooled transient point-light manager |
| `audio` | `const audio` | 60104 | Web Audio graph — **declared late, used early** |
| `music` | `const music = {` | 67073 | generative music engine |

---

## Section map (file order)

### ═══ PART 0 — Boot, config & core singletons (~3036–3597) ═══

#### Boot entry & config tables — `~L3036`
**Jump:** `function _bootLSS()` · also `const LSS_BUILD` (~L3794) · **`ASSET CONTENT VERSIONS`** (~L3796)
Opens the single closure; sets version badge; defines static gameplay config.
- **Symbols:** `LSS` (MAX_PLAYERS, ARENA_SIZE 25000, ROUND_TIME…), `LSS_API_BASE`, `LSS_DISCORD`, `CHASSIS`, `PILOT_PERKS`, `SHIP_SKINS`/`SHIP_SKIN_DEFAULT` (v36.31 — see PART 11 *SHIP SKINS*), `LOADOUTS`; `window.LSS_BUILD`; `_FRAMES_VERSION`, `_MODELS_VERSION`, `_MODEL_CACHE_BUST`
- **⚠ (v36.25) `_FRAMES_VERSION` / `_MODELS_VERSION` MUST NEVER BE WIRED TO `LSS_BUILD`.** They are the only cache key for ~146 MB of art (`frames/**` via `_FRAME_CACHE_BUST`, every GLB via `_MODEL_CACHE_BUST` at its 5 call sites: hoard, ships, monsters, champion `Sphere.glb`, `cyanring.glb`). Bump a version **only** when that art changes; bumping it on a code-only build is exactly the bug this replaced — `LSS_BUILD` moves every iteration and forced every returning player to re-download the lot. Keep `tools/gen_manifest.py`'s `v` codes in step (`0`/`1`/`2`) — see PART 18's cache-bust entry.
- **⚠** `<head>` loads `activity/redirect.js` FIRST (before fonts/importmap): on `*.discordsays.com` (Discord Activity proxy) it bounces `/` → `/activity/` launcher stub, because the Discord client CSP blocks the game's CDN imports. No-op on every other origin — keep it the first script. (Since v36.09 the folder lives at `LSS/activity/` in the repo, still adjacent to the game file — the deployed `/activity/` URL shape is byte-identical, so the Discord portal mapping is untouched.)
- **(v36.09) RESTRUCTURE — `LSS/` is the deploy root.** The game (`index.html`/`index-working.html`), this map, the satellite pages (`about/leaderboard/profile/rooms/privacy/terms.html`), `LSS.png`/`LSS_landscape.png`/`FractalGaming.png`/`favicon.ico`, `activity/`, `campaign_media/`, and `_headers` all moved from the repo root into `LSS/`; `tools/deploy_cf.py` stages **only `LSS/`**. Every asset URL lost its `LSS/` prefix: the six mount-point base resolvers (`_hoardBaseUrl`/`_skyboxBaseUrl`/`_shipsBaseUrl`/`_ringBaseUrl`/`_framesBaseUrl`/`_CAMP_BASE`) now return `'./x/'` on BOTH ternary arms (mount-agnostic), and `MONSTER_BASE_URL`/map-thumb/music/audio/lab-link/loading-image literals are plain `objects/`, `map_thumbs/`, `music/`, `audio/`, `LSS_loading.png`. `_headers` rules match the new paths (`/objects/*` etc). Build tooling stays at the repo root — `python strip.py` and `py -3.11 tools/deploy_cf.py` still run from there; launch entry `lss` (port 8099) serves `LSS/` as `/` so dev URLs mirror production, `fgroot` (8095) serves the whole repo. **Other repo-root projects (goopling, baseball_blitz, labs/, Caverns/, LSS_old/…) no longer deploy** to lss.fractalreality.ca — *(2026-08-16 amendment, see below)*.

- **(2026-08-16) LINK ROT FIX — the deploy is `LSS/` PLUS a named extras list.** The v36.09 line above had a cost nobody saw for two weeks: fractalreality.ca's `labs.html` links ~40 `lss.fractalreality.ca/labs/*.html` URLs, `fractalgaming.html` links `/goopling.html`, the game's own HUD links `goopling.html`, and every old `ashmanroonz.github.io/FractalGaming/...` URL 301s here (the repo-root `CNAME` still points at lss.fractalreality.ca). All of them broke **silently**: the Pages project answers unknown paths with `index.html` at HTTP 200, so a dead lab link loads LSS instead of 404ing, and nothing in a link checker flags it. `tools/deploy_cf.py` now stages `EXTRA_DIRS = ["labs"]` and `EXTRA_FILES = ["goopling.html", "table_legends.html", "baseball_blitz.html"]` from the repo root alongside `LSS/`. Nothing moved in the repo; the layout above still holds. Two robocopy traps the code guards: the main `/MIR` would purge the extras from staging every run (their DEST paths are `/XD`/`/XF`-excluded), and a `/MIR` rooted at the repo would mirror the whole repository over the staging dir (the loose files copy without `/MIR`). **Adding a page outside `LSS/` that the public should reach means adding it to those two lists** — otherwise it 200s as the game.

#### Core singletons: game / player / input — `~L3296`
**Jump:** `const game = {` · `const player = {` (~L3375) · `const input = {` (~L3449)
The three central mutable-state objects. See Singletons table.

### ═══ PART 1 — Identity, networking & lobby (~3598–5546) ═══

#### `net` singleton + Discord OAuth/PKCE — `~L3598`
**Jump:** `const net = {` · `async function discordSignin` (~L3741)
Networking state container + full Discord OAuth2 PKCE sign-in/exchange/user-fetch.
- **Symbols:** `net`, `_pkce*`, `discordSignin`, `_discordExchangeCodeForToken`, `_handleDiscordCallback`, `discordSignout`
- **⚠** `net.send*` are null slots wired later by `joinRoom`.

#### Lobby / P2P presence — `~L3847`
**Jump:** `const _lobbyState = {` · `async function _p2pInit` (~L4003)
Trystero global lobby: presence, room browse/join, invite toasts, tab-title unread flashing.
- **Symbols:** `_lobbyState`, `LOBBY_P2P_ROOM_ID`, `_lobbyBroadcastPresence`, `_p2pInit`/`_p2pTeardown`, `_lobbyInit`; `window._lobbySendInvite`, `window._lobbyJoinPlayer`
- **(v35.20) Main-menu layout.** `#btn-quick-match` + `#btn-create-room` **deleted** — the single CREATE / JOIN button `_unifyLobbyBox` builds does both (blank field hosts, typed code joins). Every JS reference (`_lobbyRenderBrowsing`, `_lobbyRenderInRoom`, the click wiring) was already null-guarded, so they no-op. `#lobby-room-box` sits at the **top of the menu column** (`order:-2`, directly above CAMPAIGN / `#lobby-solo-row` at `-1`) as a flex **column** — sign-in pill, then `#room-code`, then CREATE / JOIN. (It briefly lived in the top band mid-v35.20; `#lobby-user-row` was reverted to `left:auto` when it came back down, and now carries only the FULLSCREEN/SETTINGS stack.) `_unifyLobbyBox` still pulls `#discord-identity` and `#room-code` in at runtime.
- **⚠ (v35.20) First-load frame flash.** `#room-code` lives inside **`#lobby-roomcode`** in the markup, which renders for a few ms before `_unifyLobbyBox` lifts the field out and hides it — flashing its own bordered card above CAMPAIGN. Fixed by stripping that box's chrome in CSS (`background/border/radius/padding`) and hiding its "PLAY TOGETHER" caption, so the pre-unify state is invisible. It's at the same `order:-2` slot as `#lobby-room-box`, so the field doesn't move during the hand-off either. **Don't restore chrome to `#lobby-roomcode`** — its inline style still has the old card styling and only these overrides suppress it.
- **⚠ (v35.20)** `_unifyLobbyBox` step 4 deliberately **no longer appends `#lobby-panel`** into the room box — a scrolling presence list can't live in a slim top bar, so it stays in the content column. `panel` is still looked up there because the browsing/in-room renderers toggle its buttons.
- **(v35.20) Room controls restyled to match the flat menu.** `#lobby-room-box` lost all its chrome (background / border / radius / backdrop-filter / padding) — it was the last panel-looking card on an otherwise flat menu. The "MULTIPLAYER" label is deleted (the field's placeholder says it). `_unifyLobbyBox` now builds a **`#lobby-room-stack`** column — `#room-code` with **`#lobby-room-join-btn` underneath** — and the button is in the `#btn-solo/#btn-campaign/...` menu-entry group so it gets the shared transparent/Orbitron/`translateX(12px)`-hover treatment (15px + `#ffcc66` so it sits under the field rather than competing with the mode list). The "For solo-play…" caption is gone; its text is the `title` tooltip on both the field and the button. Inline `onmouseover`/`onmouseout` on the button were removed — CSS `:hover` owns it now.
- **(v35.20) Consolidated room HUD** — **`#lobby-room-hud`**, a centred box (absolute 50%/50% in `#lobby`) holding `#lobby-room-box-body` (YOUR ROOM / code / player chips / status) **and** `#lobby-panel` (MULTIPLAYER LOBBY presence list). `_unifyLobbyBox` moves both in once and strips the panel's card chrome; `_renderRoomBox` shows the HUD only when `inRoom`. Those were two separate panels in different parts of the menu saying overlapping things. The room-code field + CREATE / JOIN deliberately stay at the top of the menu column — you need them *before* a room exists.
- **⚠ (v35.20)** `#lobby-room-box-body`'s markup inline style had to change `row` → `column`; inline beats the stylesheet, so the HUD's `flex-direction` was losing and the readout rendered as one long row.
- **(v35.20)** `#btn-fullscreen` moved out of the content column (it was `position:fixed` bottom-right) into **`#lobby-corner-btns`**, a column at the right end of `#lobby-user-row` stacking FULLSCREEN above SETTINGS, both styled as text links.
- **(v35.20) `window.lssGoLandscape`** — the single landscape-lock implementation, mobile-gated via `window.lssIsMobileDevice()` (returns early if that helper isn't defined yet, so desktop can never lock). **`lssRequestFullscreen` chains it off the fullscreen promise**, so the manual FULLSCREEN button and the auto-present path can't disagree — before this the button only locked when it happened to be the very first thing tapped (i.e. when the one-shot fired instead). Distinct from the `_lssLockLandscape` **no-op stub**, which must stay a no-op: it's called from `enterShipSelect`, and locking there is precisely the v35.06 regression.
- **(v35.20) Mobile auto-present** — **Jump:** `window.lssMobileAutoPresent`. One-shot `touchend`/`pointerup`/`click` listener (armed only when `window.lssIsMobileDevice()`) requests fullscreen then chains `screen.orientation.lock('landscape')` off the fullscreen promise, because Chrome refuses the lock until the element is actually fullscreen. Honours the existing `lss_no_auto_fs` opt-out. **⚠ It locks ONCE and NEVER unlocks — do not add an `unlock()`.** v35.06 removed orientation control entirely because lock-at-ship-select + unlock-at-FIGHT made the OS re-evaluate orientation mid-match, rotating the viewport with a thumb on the sticks and throwing the touch controls off screen. iOS Safari has no `lock()`; it rejects and fullscreen still applies.

#### Auth accessor, match reporting, room heartbeat & WebRTC room — `~L4814`
**Jump:** `window.LSS_AUTH = {` · `async function joinRoom` (~L5131) · `const LSS_TURN_ENDPOINT` (~L5109)
Public auth, backend match-result POST, heartbeat, ICE/TURN fetch, game-room join/create.
- **Symbols:** `window.LSS_AUTH`, `postMatchResultToBackend`, `_lssFetchIceServers`, `joinRoom`, `_cancelRoomForLocalPlay`
- **⚠** `joinRoom` (5131–5464) is where `net.send*` callbacks + peer handlers get wired — the transport for all netcode below.

### ═══ PART 2 — Game modes & match flow (~5547–8038) ═══

#### Modes: Campaign & FreeFlight + campaign engine — `~L5547`
**Jump:** `const CampaignMode = {` · `function spawnCampaignWave` (~L6412)
Mode descriptors + full single-player campaign: waves, bosses, escorts, hoard-bots, formations, nemesis, unlocks, loadout swap.
- **Symbols:** `GameModes`, `activeMode`, `startCampaign`, `startFreeFlight`, `FormationDirector`, `spawnCampaignWave`, `_campSummonBoss`, `swapWeaponLoadout`, `_quickEquip*`
- **⚠** References `Bot` (defined ~L24485) — forward ref; `NEMESIS_SHIP='stryder'`.
- **⚠ (v36.27) EVERY MID-SESSION WORLD SWAP IN THIS PART GOES THROUGH ONE PLACE.** `FreeFlightMode._enterCampaignFromHub` (the journey rift), the `CampaignMode` leg-advance, its FINALE hub-return, and (PART 10) `_hzEnterCavern`/`_hzReturnToHub` all just set `game.selectedMap` + `game.state = 'roundEnd'` + a 2 s `roundEndTimer` and let `updateRoundSystem`'s roundEnd branch do the rebuild. Each of them calls **`_beginWorldSwap(label, title)` BEFORE its `applyMapPreset`** — that ordering is required twice over (it suppresses the preset's throw-away rebuild of the CURRENT level, and it is what routes the rebuild through `_rrStagedSwap`). Full entry: **PART 16 → "(v36.27) THE WORLD-SWAP TRAVERSE"**.
- **(v35.71) ENDLESS mode** — **Jump:** `const EndlessMode = {` · `function startEndless` · `function _lssGenEndlessLevel`. Fly a procedurally extending cavern as far as your lives allow (design: `endless_mode_design.md`). Campaign's endless-session recipe (`testMode` + `raceNoTimer`); solo-only for now, seeded route so co-op can come later. The route is DATA: `EndlessMode.update` appends `game.levelCylinders`/`levelSpheres` segments when the ship is within 7000u of the route end (chunks already baked there get rebaked by the v35.84 append-tear guard — the old "still unbaked" assumption was wrong) and prunes >8000u behind, window ~18 segments so `_stRouteAt` stays cheap. Distance = monotone arc length along the spine (never resets on death); lives come from the shared difficulty picker (`_endlessLivesFor`: EASY 3 / MEDIUM 2 / HARD 1 — `_renderDifficultyPicker` is now allow-listed for campaign+endless, one stored key, two meanings); death respawns at the last hall via `run.lastHall`; out of lives = RUN OVER banner + best-per-difficulty in localStorage (`lss_endless_best_*`) + soft return. Map `MAP_DATA.endless_caverns` (`procedural: 'endless'`, the shifting_deep pattern — **⚠ the generator's returned level must keep the `procedural` tag** or the sandwich config misses it). Terrain: `FOOT: null` (hub-style unbounded streaming) **without** `_openTop` (ceiling kept), new `T.ENDLESS` flag re-arms the vertical player clamp that is FOOT-gated (the v35.70 trap), gentle straightaway pinch 0.24, 10× arena bound shared with freeflight (float32-safe, both sites). Debug: `window.__endlessInfo()` (wiring), `window.__endlessTick(dt)` (manual mode-update tick; the sandbox starves rAF so headless tests need it). Menu: `#btn-endless` beside EXHIBITION; carousel: `endless_` prefix visible only in endless mode.
- **(v35.72) Stages 2+3: ambush director + living world**, all inside `EndlessMode` (`_director` / `_spawnWave` / `_world` / `_ensureRays`). Rhythm: TRAVEL (clock `max(28, 58 - 1.2s/km)`) → WARNING (5s, announcer + banner) → BATTLE (wave of `min(6, 2 + km/3)` bots from `game._botShipDeal.enemy`, 3-arg `new Bot(key, TEAM_FLEET_B, idx)` pushed to `game.entities`, spawned 2 segments AHEAD fanned lane-perpendicular, rock fan-points collapse to lane centre via `worldSDF > -60`; every 5th wave elite = 1.6× health) → CLEARED (+35% hull, full shield, 3s beat) → TRAVEL. No new clock while a wave lives — fleeing keeps the pack. Bots fly the cavern via the `_campHoardTerrainNav` gate (now `|| LSS.MODE === 'endless'`, the race_straightaway 3-arg-Bot precedent). World: **theme stretches** every 9-15k u rotate `T.biome` through rocky/snow/volcanic/goldmine/grassy + `_swApplyAtmosphere()` — only unbaked chunks take the new palette, so the crossfade is SPATIAL (the world changes ahead, the old palette recedes behind); **god rays** = 6 pooled additive canvas-gradient shafts hung under ceiling cracks (crack = carved ceiling above `YMID + (YCEIL-YMID)*0.55` — **⚠ the config stores no GAP_HALF field; derive from YCEIL**, referencing `T.GAP_HALF` compares against NaN and no ray ever lights, found live), cylindrical-billboarded, calm biomes only (volcanic gates opacity 0), disposed in `onTeardown`. **⚠ (CLOSED v35.85)** `run.gen.rand` *was* ONE seeded stream shared by route + themes + rays + storms — v35.85 split it (route `gen.rand` vs cosmetic `gen.cos`, see the v35.85 entry); keep new cosmetic draws on `gen.cos` or co-op routes diverge again. **Storm stretches** (stage 3b): rocky/snow stretches roll `run.stormy` at 35% — banner says STORM REACH, god rays gate off, and ambient ceiling-to-floor `spawnLightningBolt` strikes fire every 2.5-7s near the lane ahead (verified: 6 bolts into `game.effects`, rays 0 while stormy, re-lit on calm). Visual-only: no owned light state touched (the sentinel rule).
- **(v35.73) FREE-PATH PIVOT (Ashman: "the straightaway has no path... you find your own path... natural valleys like hub mode").** The carved lane was a constant-profile subway tube = boring. Now: `_stRouteAt` cylinders honor an optional per-cylinder carve WEIGHT `c.w` (default 1 — every existing map byte-identical); endless lanes use **w 0.15**, a whisper that biases passage but leaves ~85% of natural relief. Endless terrain runs the **HUB heightfield composition** (`HUB: true`, WARP 250 — continents/rolling hills/river valleys) under a kept ceiling: `YFLOOR = yMid - 3200`, `YCEIL = yMid + 1500` (**⚠ the hub composition rises ~1300-2300 over YFLOOR — shallower floors seal the cavern at flight height; measured 15/16 buried at the stock -600 before tuning to 18/20 open, median clearance +489 at route height**). The spine is an invisible scoring guide: gentler bends (0.7), progress proximity 2800→4200 so your own line counts (verified scoring 1200u off-spine), halls every 2-4 segments r 800-1600 with **40% side-halls** (offset chamber + spur cylinder, both pruned via `seg.spur`), lane radius 280-780, vertical drift ±420. Ambush spawn heights raised (+520..+760) for the new relief — verified bots at +1160/+1280 clearance. Faster theme pacing (first swap 6k, stretches 6-10k). PENDING (user, queued as a task chip): ship-up rotating minimap with spinning compass + edge arrows — inverts the v35.44 fixed-cardinals invariant when built.
- **(v35.81) Spawn-tear fix — ⚠ carve weights must exist BEFORE `initSandwichTerrain`.** `EndlessMode.onBuildWorld` retro-tagged the initial 8 route cylinders `w = 0.15`, but `buildRoomGraphLevel` → `initSandwichTerrain()` had already synchronously baked the core chunks (cx,cz ∈ [-2..2]) with those cylinders at full weight 1 — so the spawn core's heightfield disagreed with every later-streamed chunk by ~100u along the core boundary (measured a -749→-642 ground step exactly at x=-1800), an open vertical seam showing the pale rocky sky ("tear + white space at spawn"). Fix: `_lssGenEndlessLevel` tags its tunnel `w: 0.15` and `buildRoomGraphLevel` carries `tun.w` through `cylSegs` → `game.levelCylinders` (unset for every other map; `onBuildWorld`'s retag is now an idempotent no-op). Verified: escape-ray scan from spawn 11/540 misses → 0/540; ground continuous across x=-1800. General trap: ANY change to `game.levelSpheres`/`levelCylinders` after a chunk bakes splits the heightfield at that chunk's border — the mid-run flavour of this (stream radius vs append radius) is CLOSED as of v35.84 (append-tear guard below).
- **(v35.84) Mid-run append-tear fix — the guard, not the radii.** The v35.71 "append radius > stream radius so those chunks are still unbaked" invariant was unfixable by number-juggling: the endless stream window is a chebyshev SQUARE (`updateSandwichStream` has no disc cull outside mossy), so with `__endlessView` 9 chunks bake out past 11km euclidean at the corners vs the 7000u euclidean append radius — and even view 7 leaves diagonal exposure. Fix (option c): `_lssEndlessApplySeg` now calls `_swInvalidateChunksInRect` (defined by `_swDisposeChunk`) over the new shapes' carve-influence AABB (2D x/z, reach = shape r + `CLEAR_SOFT` + 90; the hall sphere box unioned in; the spur needs no box — both its endpoints sit inside the union with ≥ its reach), disposing any already-baked chunk there so the budgeted streamer rebakes it with the carvers present (~20 chunks/append, all ≥6km out, pop hidden in fog). Debug: `window.__endlessNoRebake = true` disables the guard (A/B the tear live), `window.__endlessRebaked` counts rebaked chunks, `window.__swStream` = `updateSandwichStream` (manual streaming for headless tests that teleport faster than 2/frame streams). Verified by a 60km headless A/B drive down the seeded route (same seed both runs; teleport the spine at 80u/step + `__endlessTick` + `__swStream` drain, station every 2.4km: full border-vertex continuity sweep — shared-edge verts are bit-identical x/z via the global-index jitter, so any |Δy|>1 is a real tear — plus the v35.81 540-ray escape scan): guard OFF = tears from the first append on (worst border step 1389u, up to 1345 discontinuous border verts, up to 360/540 escape rays through un-carved rock); guard ON = 0 bad verts and 0/540 misses at all 26 stations, 260 chunks rebaked. ⚠ headless: `EndlessMode.update` early-outs unless `game.state === 'playing'` — the warmup→playing flip lives in the starved gameLoop, force it. ⚠ the pre-fix baseline also showed the worse symptom: the route lane simply doesn't EXIST in stale-baked chunks (sealed tunnel, ray origins inside rock), not just a border seam.
- **(v35.85) ENDLESS CO-OP + campaign team fix.** `startEndless` now mirrors `startFreeFlight`'s hosted pattern: live room OR a `#room-code` entry → `net.endless = true` + `_startHostedMode()` (open_solo_start carries `mode:'endless'` + seed); blank+roomless stays byte-identical solo. Joiner adoption: `_applyModeClientSetup` grew an `'endless'` branch (flags + `endless_caverns`; `game.endlessRun` still comes from the level build), and `'endless'` joined the `map_change` mode whitelist (grep `evt.mode === 'classic'`). **Rng split:** `_lssGenEndlessLevel` seeds TWO mulberry32 streams — `gen.rand` (seed^0x9D2C5680) is the ROUTE stream consumed ONLY in `_lssEndlessNextSeg` (+the build-time heading draw), so segment N is byte-identical per peer no matter when each client extends (extension stays position-triggered, prune stays local); `gen.cos` (seed^0x41C64E6D) feeds themes/god-rays/storm bolts in `EndlessMode._world`. **Wave authority:** `amStasisOwner` (lowest peerId) alone runs `_director`/`_spawnWave`; `_spawnWave` + the cleared transition call `_botSendRoster()` (the sweep kills peers' dead proxies); the four campaign bot-sync gates (`_botNetSync`, `_botSendRoster`, `bot_roster`, `bot_state` handlers) are now `(net.campaign || net.endless)`; non-authority peers run `EndlessMode._coopPhase` — phase/banners/hull-patch DERIVED from proxy-bot liveness, no spawn, no clock. **Teams:** `assignTeamFromPeerOrder` + `_teamForPeerId` early-return `TEAM_FLEET_A` for `net.campaign || net.endless` — this also FIXES campaign co-op, whose joiners were silently seated on FLEET B (hostile to host, friendly to the hoard) by the open-solo challenger rule. **Lives/distance are PER-PLAYER v1**: out-of-lives in a room = RUN OVER banner + spectate via the death cam (the 6s `returnToRootMenu` soft-return is solo-only now); teammates fly on. `#btn-ss-bots` hidden in endless (mirrors the spawn gate; its `elim_bots_off` nulled `openSoloHostId` under the drop-in machinery). `net.endless` declared on the singleton, cleared in `_cancelRoomForLocalPlay` + `EndlessMode.onTeardown`. **Campaign entry finding:** the co-op door already existed — `startCampaignJourney` routes roomed/code-typed players to `startCampaign()` → `_startHostedMode()` (v32.76 authority PvE) before any journey cinematic arms; only the FLEET-B team seat (above) was broken. Known v1 quirks (documented in `endless_mode_design.md`): waves anchor to the authority's ship; a dead/out authority pauses new waves; mid-run drop-ins start at the cavern mouth; `bot_fire` replay suppression keys on `openSoloHostId`, which can differ from `amStasisOwner`.

- **(v35.87) AEGIS SURGE** — temporary in-run aegis for ENDLESS, fueled by route BOLTS + wave kills. **Jump:** `_aegis(dt, run)` (EndlessMode method) · `function _lssEndlessBolts` · `function _endlessAegisDmgOut`. **Bolts:** 1-3 pooled glowing octahedra (+additive `_emberFalloffTexture` sprite) per segment, placed by a PURE `_stHash2`-style hash of the seg **gid** — ⚠ NOT `run.gen.rand` (route stream, v35.85 rule) and NOT `gen.cos` either (its cursor free-runs per client; nothing SHARED may draw from it) — so all co-op peers see identical bolts with zero stream consumption; vertical clamp vs the carved ground/ceiling heightfields guarantees open air (sandwich terrain is floor+ceiling only); spawned in `onBuildWorld` (initial segs) + `_lssEndlessApplySeg` (appends), freed at the prune site, disposed in `onTeardown`. Collection is LOCAL v1 (~90u, `rearm_reset` sound, HUD `+` flash). **Meter** (`run.aegis`): bolt +25, kill +34 (alive→dead transitions among Fleet-B endless Bots — real AND proxies, so non-authority peers charge too; entries vanishing without a dead tick are dropped uncounted), levels 0..5 at 100/level, 12s grace then 26/s stepwise drain. ⚠ the level-up `while` is gated `graceT <= 12` — the drain parks charge at 100 when stepping DOWN, and ungated the loop instantly re-leveled (meter pinned at L:0 forever, found live). **Buffs** are TEMP multipliers scaled off the permanent tree's ceilings: dmg +6%/lvl (`_endlessAegisDmgOut`, hooked in `Bot.takeDamage` **BEFORE the isProxy route** so co-op `bot_dmg` claims carry it — the freeflight `_aegisDmgOut` hook sits after and never sees proxies), speed +4%/lvl via a CLONED chassis (`_campBoostSpeed` pattern; base REFERENCE restored exactly on drop/death/teardown — never mutate `CHASSIS`), hull regen 0.3%·lvl/s (shields never regen naturally). HUD: ` · AEGIS Lx NN%` appended to the endless top-center line. Debug: `window.__endlessAegis()` (meter + multipliers + live-bolt census).
- **(v35.89) ENDLESS MOBILE BUDGETS** — fix for "endless is very choppy on the mobile": endless was the one streamed mode with NO mobile branch, and it draws TWO shells (ground+ceiling) per chunk. **Jump:** `function _lssEndlessMobile` (beside `_swHubView`) — the same detection `_swHubView` uses (`isStandaloneQuest() || _LSS_IS_MOBILE`) **plus `window.__endlessMobileSim`**, the debug hook that forces every mobile branch from a desktop console. Set it BEFORE `startEndless` — the branches read it per-call, so a mid-run flip half-applies (mixed bolt pools, stale view) — fine for A/B, not for measuring. Four branches key on it: **(1) view radius** (`updateSandwichStream`, the `const _VIEW =` line): desktop 9, mobile/Quest **6** — 19²×2 = 722 terrain shells → 13²×2 = **338** (measured at the same parked vantage: chunks 361→169, draw calls 513→284, tris 1.25M→0.62M); `window.__endlessView` stays the master override for BOTH. **(2) god rays**: the spawn gate `!_lssEndlessMobile()` sits BEFORE `_ensureRays`, so on mobile the 6-plane additive DoubleSide pool **never allocates** (programs 96→93). **(3) bolts** (`_lssEndlessBoltSlot`): pool cap 64→**24** on mobile and the additive halo sprite is desktop-only — the emissive octahedron core stays, so bolts remain visible/collectable. **(4) bake budget**: the per-frame `updateSandwichStream(...)` call in gameLoop passes **1** (not the default 2) for endless-mobile, freeflight-precedent — a budget-2 endless pickup (2 chunks × both shells) measured **11-14ms main-thread on a fast desktop CPU** = 35-70ms-class hitches on a phone; verified live 27.9 chunks/s (desktop branch) vs 14.7 (mobile branch), the 2:1 budget signature. Per-frame-allocation audit of the v35.85-88 additions: `_aegis`'s kill-tracker built a fresh `present = {}` **every frame** — now a persistent stamp map (`a._pres` / `a._psn`, membership = stamp equality; only `seen` is ever iterated and it stays pruned); `_coopPhase`'s per-frame `for..of` (array-iterator alloc) → indexed loop. HUD string building per frame predates v35.85 and matches repo norms — left alone. Desktop A/B at the parked seg-1 vantage: every deterministic metric byte-identical (722 shells / 382 in-frustum / 361 chunks / 20 bolts + 20 sprites / 6 rays / 96 programs); draw calls 513 (pre) vs 508 (pre re-run) vs 500-502 (post) = inside the unseeded cloud/ray lifecycle noise band. Zero console errors. ⚠ Measurement note: with the Browser pane hidden, gameLoop (worker tick) SKIPS rendering — `renderer.info` reads 0; measure by parking a deterministic vantage and calling `renderer.render(scene, camera)` manually with `info.autoReset = false`.

- **(v35.90) AEGIS SURGE REDESIGN** (owner: v35.87 meter was "kinda boring") — **ONLY BOLTS charge, ranks NEVER discharge, bolts rare + hidden off the main line, way cooler look.** Same anchors (`_aegis` / `_lssEndlessBolts` / `_lssEndlessBoltSlot` / `_endlessAegisDmgOut`) + new `_lssEndlessBoltRayTexture` + debug `window.__endlessBoltProbe(x,y,z)` (closure worldSDF/carved-Y for headless clearance checks). **Economy:** the charge/graceT meter scaffolding is GONE — each bolt = a FULL rank (lvl 0..5, same reversible +6% dmg / +4% speed-clone / 0.3%·lvl regen buffs); kill diff STAYS but only as bookkeeping (`a.kills`, zero charge); no grace/drain; death no longer zeroes (`respawnPlayer` reads `player.chassis` = our clone and never replaces it, so buffs survive respawn untouched); reset ONLY in onBuildWorld + onTeardown (exact base-ref restore; teardown dispose sweep is now generic over `_boltLib`). **Placement** (all pure gid-hash, v35.85/87 co-op rules): rarity gate `hash(gid,97)<0.28` ≈ 1 bolt per 3.6 segs; OFF-lane ≥420u xz point-to-segment (enforced analytically — 3D ≥ xz projection), alcove bolts 420-1000u lateral at 62-92% of the carved gap (near ceiling), side-hall segments (`seg.spur`) put it high in the chamber constrained to the OUTWARD half (the next seg starts at seg.b and doesn't exist yet — can't be checked without breaking per-peer determinism); carved-gap clamp then worldSDF<-60 step-DOWN adjust, no air after 6 steps = skip. Collect radius 90→120u; collect = rank-up + `rearm_reset` + fireball_cyan burst + banner-free HUD pulse (`AEGIS Lx ⚡` + brightened color/shadow, no % readout). **Look:** StasisField-cousin — emissive octahedron core (cosine-sum chaotic scale pulse), 2 counter-rotating additive `_makeFXMaterial` shells (fireball_cyan r46 / plasma_cyan r64, potato falls back to flat additive like StasisField), halo sprite, 3 EMITTED god-ray shafts (`_ensureRays` canvas technique, 120° apart, leaning 0.55 rad, precessing rig — deliberately NOT billboarded). Mobile (`_lssEndlessMobile`): core + ONE shell only, no sprite/rays, pool cap stays 24. Verified live: 28 bolts/128 segs (4.38 per 20), xz-dist min 437 / 3D min 504, worst SDF -201, relY 0.53-0.80, collect L1/L2/L3 = speed 364/378/392 + dmg 1.06/1.12/1.18, death → L3 retained same clone ref, 60s idle → no decay + regen exactly 90hp/s@L3, teardown → exact base ref + FX census down, bolt stack = 10 draw calls at point-blank (525 total, band), 144fps, mobile-sim 2-child slots + rays never allocate + still collectable, zero console errors, placement byte-identical across two boots.
- **⚠ (v35.90)** `renderer.info.autoReset = false` for manual-render measurements MUST be flipped back true before re-arming the loop, or live fps/draw HUD numbers freeze at the manual frame.
- **(v35.91) LIVING MOTES** — bolts flee when SEEN (owner feature, Weeping-Angel-INVERSE). Same anchors (`_aegis` / `_lssEndlessBolts`) + new `window.__endlessMotes()` census (anchor / current pos / offset / fleeT / SDF per live bolt). Observed = player <1400u AND dot(camera forward, dirToBolt) > 0.55 (ONE `camera.getWorldDirection` per tick into a per-run reused vector); observed → erratic dart AWAY at 300u/s (base away-vector, vertical damped 0.35, + 3-term incommensurate cosine jitter; deliberately under base ship 350 and NOT rank-scaled — Aegis speed ranks make late chases easier); eyes-off/far → drift home 90u/s, snap <2u. The gid-hash placement stays the shared deterministic ANCHOR; the runtime offset `b.ox/oy/oz` is per-client VISUAL state (collection already local — design doc seam 4). TETHER ≤1600u (pre-clearance clamp; mixed-axis slides can overshoot, so >1600.5 reverts to the pre-move offset). Every step: carved-gap height clamp → `worldSDF < -60` endpoint check → axis-drop slide on block (hold-height, then vertical-only; pre-move offset is the always-valid fallback); dt clamped to 0.05 so a hitch can't tunnel a thin wall. Behavior gated to 2500u of the player, distance early-out FIRST — **⚠ a mote left beyond the gate holds a frozen offset until you return (inertness is the perf feature, don't "fix" it)**; zero per-frame allocations; mobile branch identical (position math). Collect unchanged (120u) vs the mote's CURRENT position — shells/halo/rays ride the group. Verified headless: tracked-camera approach → 525u retreat in 2s ending past the 1400u observe range; camera-away approach → offset exactly 0; 30s max-pressure chase → maxOff exactly 1600.5, rest SDF never above -60 (bobbed worst -47.7), cornered collect 0.4s after closing (L1, speed 364, clone); calm return 525→0 back onto the anchor; teardown → base 350 restored + every r22 core gone; 144fps; mobile-sim slot 2 children + identical flee; zero console errors both passes.

- **(v36.04) MONSTER BOUNTY BOLTS** (owner: "killing monsters should drop bolts") — a monster killed while `LSS.MODE==='endless'` drops ONE Aegis bolt at the corpse. **Jump:** `function _lssEndlessDropBolt` (right after `_lssEndlessFreeBolts`) · hook = the one line in `OutskirtsMonster.die` after `spawnMonsterGuts` (fires on the authority AND on every peer's `mon_dead` replay — **co-op v1: the drop is LOCAL per client**, the v35.87/91 collection seam). Bounties live in `run.dropBolts` (not seg-tied); `_aegis` iterates them as the `si === -1` lane of the same bolt loop (identical animation/collect body — 120u, full rank). Two deliberate differences from route motes, both keyed off `b.bounty`: **no flee** (the observe arm is gated `obs && !b.bounty` — a bounty is a reward, not prey) and **~45s expiry** (`b.expT`, shrink-out over the last 4s, then slot freed + `taken` — motes live forever, bounties are a limited-time claim). Placement = the route-bolt clearance recipe (carved-gap clamp + `worldSDF<-60` step-DOWN; corpses float in open air so the first probe usually passes; skip on sealed column). **Pool guard:** skip silently unless ≥8 free slots would remain under the cap (24 mobile / 64 desktop) — bounties can never starve route bolts. ⚠ expiry-fade shrinks `grp.scale`, so `_lssEndlessBoltSlot`'s reuse path now resets scale to 1 (and the expiry path resets it too) — without that a bounty's fade leaks into the next bolt in the slot. `__endlessAegis()` grew `dropBolts` + `drops[]` (pos + expT). Verified live: kill → bolt exactly at corpse, watched 2s → offset 0 (route mote same build: fleeT 0.3, off 403u — unchanged), collect → L1/speed 364/clone, expT fade midScale 0.34 → expired + slot freed + scale 1, pool stuffed to cap-1 → kill drops nothing, 144fps, zero console errors. Note: monsters DO exist in endless (updateMonsters only excludes freeflight/assault; `_initMonsters` runs 6s into 'playing', outskirts auto-summon at `seedDist>300` per `__monDbg`) — test kills via teleporting `game.monsters[i]` beside the player + `takeDamage` loop.

- **(v36.06) LONG-RUN ROUTE RECOVERY** (owner bug: "choppy 45-53km in, then no enemies, and it stopped counting my km") — the bounded wander's seam, diagnosed + closed. **Jump:** `_reanchor(run)` (EndlessMode method, above `_director`) · the RELOCK else-branch in `update`'s progress block · the WAVE LOST branch in `_director` · the self-avoidance block in `_lssEndlessNextSeg`. **Diagnosis** (offline byte-exact sim of gen+tracker, then live headless harness): past 42k from origin the heading biases home; the free-path pivot (v35.73) means a pilot flying their own valley line diverges exactly where the invisible spine turns — the 3-seg × 4200u tracker window loses the lock FOREVER (no recovery path existed): dist freezes (live repro: frozen at 39.15km while 80km flown), the window parks (gidSpan pinned), waves anchor to the stale knot 10-40km behind (spawn measured 11,290u away → director stuck in `battle` for 30+ km = "no enemies after that"), and extension stalls so the append-rebake churn stops (= "not choppy anymore"; the 45-53km chop IS that churn while the folded route end lingers near the strayer). **Fixes, all v36.06:** (1) RELOCK — after 4s unlocked while moving, re-scan the whole tracked window FORWARD of the lock (first match); credit the straight CHORD flown since loss, capped by the skipped spine arc (monotone, no unflown credit). (2) RE-ANCHOR — pilot >5200u from EVERY tracked seg for 5s (solo only — a re-anchor derives from local position and would fork the v35.85 shared route; co-op keeps old behavior, documented seam): credit the lost chord (speed-capped 600·lostT), free every tracked seg (bolts + carve shapes + `_swInvalidateChunksInRect` over each removed shape's influence rect — removal is a heightfield change too, the v35.84 rule), restart the generator ~2600u AHEAD of the ship on the flight heading, 8 fresh segs via `_lssEndlessApplySeg`, progGid −1 (re-locks next tick, zero windfall), lastHall = player pos, banner THE CAVERN SHIFTS + `endless_reroute` announcer; gen.nextGid keeps counting (monotone-gid invariant), gen.vis history kept. (3) WAVE LOST — battle wave whose every live bot is >14km away for 10s: destroy+splice stragglers (roster-sweep pattern; vanish-without-dead-tick = aegis drops them uncounted), back to `travel`, no clear reward. (4) SELF-AVOIDANCE — `_lssEndlessNextSeg` steers the candidate endpoint away from visited 4.2k-cells (fixed deflections ±0.5/±1.0 toward the turning side, ZERO extra rand() draws, visited set derives from route state in gid order = co-op byte-identical; FIFO 256; last-3 cells exempt). (5) `a._pres` stale-stamp sweep every 512 frames (was one key per bot id ever). **Proof** (headless harness: loop stopped via `setAnimationLoop(null)`, spine-follow + deliberate 63° strays at bias onset, `__endlessTick` batches + `__swStream` manual drain, 2km logging): pre-fix (recovery timers pinned −1e9) = the exact owner symptom chain above; post-fix 95.2km arc → 93.35km credited (98.1%), dist monotone, 2 strays → 2 seamless re-anchors (freeze spans bounded 5.7/8.1km, chord credited on recovery), all 7 wave spawns ≤5,219u from the player, segs ≤15 / cyls ≤15 / chunks ~650-706 steady / bolt pool 5 / pres swept 42→12, wave-lost clean (`battle→travel` at exactly 10.0s, 6/6 despawned), then live-loop resume → WAVE 11 fought at the player, RUN OVER path wrote best 99.51km, zero console errors. `__endlessInfo()` grew dist/progGid/segs-span/lostT/farT/reanchors/phase/waveN/cyls/ents/chunks/rebaked/pres for harnesses. ⚠ the offline sim pair lives in the session scratchpad (`endless_sim.js` / `endless_sim_fixed.js`) — port them forward if the generator's draw ORDER ever changes (they must stay byte-exact to be evidence).

- **(v36.11) NO CHAMPION OBJECTIVE IN ENDLESS** (owner: "what does the championship field do in endless? it shouldn't be there") — `'endless'` joined the campaign/freeflight skip in the `_championDue` ternary (`updateStasisFields`, PART 20): endless has no round-win to resolve, so the champion capture StasisField (+ChampionShell) never auto-spawned. **Distinction:** champion field vs shield-refill stasis are the SAME `class StasisField` but DIFFERENT spawners — `spawnChampionField()` (`new StasisField(pos, true)` = championMode, one per round, win objective) vs `spawnStasisField()` (max 3, plain pickups, the shield-refill mechanic). Only the champion spawner is gated off; the regular spawner still runs in endless — **but it never placed anything there** (fixed in v36.13; ⚠ the reason recorded here at the time — "endless maps have `levelSpheres.length === 0`" — was WRONG: hall spheres ARE registered, and the actual blocker was the stale `game.corridorPoints` candidate pool. See the v36.13 entry below). Verified live: endless playing + roundTimer 0.5 ≤ CHAMPION_TIME with updateStasisFields demonstrably ticking → championSpawned stays false, no field/shell; classic same build → champion field + shell spawn at roundTimer ≤ 10. ⚠ harness traps hit while verifying: the bg-tick worker SWALLOWS gameLoop exceptions silently (`try{gameLoop(t)}catch{}`) — a hack-started match with `player.position === null` threw every frame in updateRoundSystem's engagement loop and silently skipped everything after it; force-hidden worker rig (`Object.defineProperty(document,'hidden',{get:()=>true})` + dispatch visibilitychange) is what actually ticks the game with the pane backgrounded.

- **(v36.13) ENDLESS SHIELD REFILL — stasis pickups in halls** (closes the v36.11 follow-up: endless shields were unrefillable except by executing a doomed enemy). Full mechanic + verification in **PART 20's stasis entry**; the endless-side facts: pickups spawn in **route HALLS** (`seg.hall && seg.sph`) ahead of the pilot, one hall in ~2.4 via a pure `_lssEndlessBoltHash(gid, 41) < 0.42` gate, max 3 alive (the classic cap), on the classic 30s `stasisInterval`; they are **pruned with the route window** by a distance sweep in `EndlessMode.update` (>11000u → `destroy(true)`, quiet). Placement offsets are pure gid hashes (never `gen.rand`/`gen.cos`) but the spawn itself is still authority-computed + `stasis_spawn`-broadcast, so co-op sees one shared pickup. Reuses `getStasisSphereIndex`-era machinery untouched — the ONLY thing swapped is the candidate generator, because `getValidSpawnPoint`'s `game.corridorPoints` pool never leaves the cavern mouth. **⚠ co-op v1 seam:** the prune is per-client distance, so two peers >11km apart can disagree about whether a far pickup still exists (same LOCAL-view family as bolt motes + monster bounties; a `stasis_pickup` for an already-pruned field just no-ops on the receiver). Debug: `window.__endlessStasis()` (live fields + containing hall gid + SDF, every windowed hall with its gate roll and ahead/behind state, the spawn timer, and `spot` = where the NEXT spawn would land).
- **(v36.38) AEGIS CAP RAISED 5 → 10 + THE AT-MAX REWARD LADDER** (owner: "in endless mode I got stuck at aegis level 5, taking more powerups didn't level me up"). v35.90 hard-walled the surge at L5 and every further bolt did **nothing, silently** — no rank, no alternative, no feedback — which in a mode about endless progression, with bolts as deliberately rare off-route treasure, reads as a bug. **Jump:** `const _EAEGIS_MAX` (the curve block, immediately above `const EndlessMode`) · the collect body in `_aegis` · `_aegisSetLvl` · `_endlessAegisDmgOut` · debug `window.__endlessGrab(n)`. **The curve is now table-driven and TAPERED** — `_EAEGIS_DMG` / `_EAEGIS_SPD` / `_EAEGIS_REG`, indexed by rank, replacing the three flat `k * lvl` expressions. **L1-L5 are byte-identical to v35.90** (+6% dmg / +4% speed / 0.30 %/s regen each) so the shipped early game does not move; L6-L10 shrink hard (dmg +5/+4/+3/+2/+1 pp, speed +3/+2.5/+2/+1.5/+1 pp, regen +0.20/+0.15/+0.10/+0.10/+0.05), landing L10 at **dmg ×1.45 · speed ×1.30 (455 from 350) · regen 2.10 %/s**. Balance rails: `_spawnWave` caps wave size at `min(6, 2+floor(dist/3000))` (i.e. hostile pressure is bounded by 12 km while the route is not), the whole L6-L10 stretch buys only +11.5% DPS / +8.3% speed over L5 for FIVE more finds, and speed ×1.30 stays UNDER the hoard bot's shipped 1.33 (`_campTuneHoardBot`) — the same rail v35.90 used for L5's 1.20. Route bolts gate at ~28% of 2000-4000 u segments (~1 per 10 km), so L10 is a ~100 km run spent leaving the lane and chasing fleeing motes. **A bolt at true max is never worthless again — three-step ladder in the collect body:** `lvl < MAX` → rank up (unchanged) · `lvl = MAX && lives < run.livesMax` → **+1 LIFE** · `lvl = MAX && lives = livesMax` → **+250 m scored `run.dist`** (accumulate-only, so a `+=` is safe). **The life cap protects the difficulty contract:** `run.livesMax = _endlessLivesCapFor(startLives) = 2 × startLives` (EASY 6 / MEDIUM 4 / HARD 2), so the EASY>MEDIUM>HARD ordering AND ratio survive exactly and a HARD run can never become a MEDIUM one; the cap is on the LIVE count (not on grants), so after a death a max-rank pilot can keep converting exploration into survivability, bounded above. **Feedback everywhere** (silence was the actual bug): the HUD tag gains ` MAX` at the ceiling and appends the reward (` ⚡ +1 LIFE` / ` ⚡ +250 m`) for `a.rwT` seconds, plus an `AEGIS OVERFLOW` banner and a distinct sound per branch (`round_start` for the life, `upgrade_core` for the distance, `rearm_reset` on every bolt as before). Co-op safe (placement is still the pure gid hash; ranks + lives are per-player) and the reversible-buff discipline is untouched. Verified live (150 km EASY run): the whole 15-bolt ladder walked through production code — L1..L10 at speed 364/378/392/406/420/430.5/439.25/446.25/451.5/455 and dmg 1.06→1.45 and regen 0.3→2.1 %/s, then +1 LIFE ×3 (3→4→5→6 = cap), then +250 m ×2 (dist 107592→107842→108092); HUD read `150.91 km · LIVES 6 · AEGIS L10 MAX ⚡ +1 LIFE` in the flash colour with the OVERFLOW banner up; death → L10 + the same clone reference + speed 455 survive and a life is spent; teardown → the EXACT base chassis reference restored (350) with `curCh` null; zero console errors.

#### Match-start flows & ship-select entry — `~L6829`
**Jump:** `function startSolo` · `function enterShipSelect` (~L6988) · `function startAssault`
- **Symbols:** `startSolo`, `startTest`, `startRace`, `startAssault`, `_startHostedMode`, `enterShipSelect`
- **(v35.20) ELIMINATION** — **Jump:** `async function startElimination` (just after `startOpenSolo`). MULTIPLAYER PvP + MULTIPLAYER AND BOTS merged into one menu entry. Follows `startOpenSolo`'s room handling (create-or-reuse, then straight to ship-select) but **honours a code typed in `#room-code`** instead of overwriting it — `startOpenSolo` always minted a fresh code, silently discarding what the user typed. No code required: blank mints one. Falls back to `startSolo()` if the room can't open. Symbols: `_elimGenCode`, `_elimWantBots`, `_setEliminationBots`, `startElimination`, `_renderEliminationBotsBtn`, `_toggleEliminationBots`.
- **⚠ (v35.20)** The button **keeps the id `#btn-join`** deliberately — `#btn-join.lss-ready-cta` styling hangs off it and `joinRoom()` still toggles its `disabled`. `#btn-opensolo` and `#mp-join-msg` are deleted; `startOpenSolo` itself is KEPT (the `open_solo_start` netcode path and `_startHostedMode` still reference it).
- **(v35.20) No lobby READY button.** `joinRoom()` used to relabel `#btn-join` to "CLICK WHEN READY" 500 ms after connecting and wire it to `toggleReady()`; that's removed so ELIMINATION keeps its label. **`updateReadyButton()` is now a deliberate no-op stub** — it was the only thing rewriting that text, and `toggleReady()` (its only caller) is now unreachable from the UI. The ready HANDSHAKE is untouched: readiness is signalled by committing a loadout on ship-select (the loadout broadcast IS the ready signal). Instead, `_renderRoomBox` swaps **CREATE / JOIN → "SELECT GAME MODE BELOW"** (`.lss-room-joined`: green, `pointer-events:none`) once `net.active && net.roomCode`. That swap is set *outside* the signature early-return so it survives a bailed re-render, and `_renderRoomBox` runs on a 1500 ms interval. The in-room peer line also changed from "use CLICK WHEN READY below" to "pick a mode to head to the hangar".
- **(v35.20) Bots toggle** — `#btn-ss-bots`, docked in **`#ss-header-right` under CONFIRM & LAUNCH** (top-right of ship-select), rendered by `_renderEliminationBotsBtn` from `enterShipSelect`. Label stays **"ADD BOTS"** in both states with a ticked/unticked box prefix (`☑`/`☐`) — swapping the wording made it ambiguous whether it described the state or the action. `.ss-bots-on` tints it green. Shown for every mode EXCEPT `campaign`/`freeflight` — classic, race and assault. **Deliberately NOT gated on `net.active`:** `startRace`/`startAssault` run SOLO (`net.active=false`) whenever no room code is entered, which is exactly where you want to switch bots off.
- **⚠ (v35.20) `game.eliminationBots` is the source of truth, not `net.openSolo`.** `net.openSolo` only means anything inside a room, so an offline toggle that only set it did nothing — the spawn gate takes its `!net.active` branch and spawns unconditionally. **All THREE bot-spawn sites now AND in `game.eliminationBots !== false`**: round-1 build, the between-rounds respawn, and assault's 4-second reinforcement top-up (miss that last one and switching bots off in assault still trickles them in). `_setEliminationBots` writes `net.openSolo` only when `net.active`; the `open_solo_start` / `elim_bots_off` peer handlers keep `game.eliminationBots` in step. Works because the bot gate **`(!net.active || net.openSolo)`** is evaluated at ROUND BUILD (~L41540 and the between-rounds copy ~L48853), *after* ship-select confirms. Syncs to peers by reusing `open_solo_start` for ON and a new **`elim_bots_off`** event for OFF (same lowest-peerId tie-break as `open_solo_start`).
- **(v34.68) ASSAULT mode** (`LSS.MODE==='assault'`, `#btn-assault`): Protect/Attack the Champion Field on `assault_` maps (side-'A' rooms = defender/champion end). The field + shell spawn at round start; only the ATTACKING fleet can claim/charge (`LSS.ASSAULT_CHARGE_TIME` hold, decays when vacated); timer expiry (`LSS.ASSAULT_ROUND_TIME`) = defender round win; roles swap each round (`_assaultAttackerFleet()` = pure function of currentRound, zero sync). Unlimited respawns: fleet-wipe round end disabled + bot reinforcements top fleets back up (authority-side, roster rebroadcast). Match end: `_assaultMatchWinner()` net-capture spread (2*caps−attackRounds ≥ `ASSAULT_NET_SPREAD`, higher net, evaluated only at equal attack rounds) via `game.assaultLedger` (booked by the round-end authority AND `round_end` receivers, BEFORE currentRound increments). Spawn sides role-mapped via `_assaultSpawnSide` at all five `getValidSpawnPoint` call sites. Defender bots hold a guard post off the field when unengaged (waypoint shortcut skips dogfight AI — only used when idle); attacker bots keep the champion beeline.
- **(v36.14) ASYMMETRIC ASSAULT RESPAWNS — defenders wait +3s** (owner: "in assault mode, there should be a 3s delay for the defenders when they die/respawn"). The v34.68/69 respawn machinery was symmetric 4s for both sides, so killing a defender bought you nothing; now the DEFENDING role waits `LSS.ASSAULT_RESPAWN_DELAY + LSS.ASSAULT_DEFENDER_RESPAWN_EXTRA` (4+3 = **7s**) while the ATTACKING role keeps **4s**. **Jump:** `ASSAULT_RESPAWN_DELAY` (the `const LSS = {` block, beside `ASSAULT_CHARGE_TIME`) · the two assault respawn blocks in `updateRoundSystem` (grep `_asltReinforceTD` and `_asltPlayerRespawnT`). **Local player:** the hold is `ASSAULT_RESPAWN_DELAY + (player.team !== _assaultAttackerFleet() ? EXTRA : 0)`, recomputed per frame — role is a pure function of `currentRound`, so a round-boundary swap is picked up with zero stored state and zero sync. **Bots:** the single 4s reinforcement timer split into TWO role clocks — `game._asltReinforceT` (attackers, 4s) and `game._asltReinforceTD` (defenders, 7s) — and the `for (const _fl of [B, A])` top-up loop now `continue`s unless *that fleet's* role clock fired this pass, so the fleets refill out of phase. Everything else in the block (the `eliminationBots !== false` gate, the openSolo/`amStasisOwner` authority gate, `_needB`/`_needA` seat math, `_assaultSpawnSide` placement, `_botSendRoster()` rebroadcast) is untouched. **⚠ The clocks are bound to the ROLE, not the fleet** — a role swap hands each clock the *other* interval, so all three assault timers (`_asltReinforceT`, `_asltReinforceTD`, `_asltPlayerRespawnT`) are now zeroed at the warmup→playing transition (right after the CAPTURE/DEFEND role banner) — without that, a defender clock carrying 6s of accumulation fires instantly the moment its fleet becomes the 4s attacker. Verified live (solo assault, real round transitions forced via `roundTimerTotal`/`roundTimerAnchorMs`, per-frame rAF recorder on `shipState` + per-fleet alive counts): player DEFENDER hold **7.073s** (r1) and **7.064s** (r3) vs ATTACKER **4.063s** (r2); reinforcement clock gaps measured 4.001-4.004s and 7.002-7.004s over 43s; bot top-up attribution flipped with the role — r2 (attacker=A) restored Fleet A at t=3.999 / Fleet B at t=7.003, r3 (attacker=B) restored Fleet B at t=3.999 / Fleet A at t=7.000; both clocks equal at each round start (proves the boundary zeroing); 144fps, zero console errors. **⚠ harness note:** `LSS` is NOT on `window` — read roles as `attacker = (currentRound % 2 === 1) ? 3 : 2` (TEAM_FLEET_B=3 / TEAM_FLEET_A=2) from `window.game` / `window.player`. Headless assault entry is just `startAssault()` → click `#ship-preview-confirm` (solo, no room code); `player.spawnProtection = 0` before `__playerTakeDamage`.

#### Map selector UI — `~L7015`
**Jump:** `function buildMapSelector` · `function selectMap` (~L7150)
- **Symbols:** `buildMapSelector`, `selectMap`, `_renderMapPreview`, `cycleMap`

#### Custom map install/load/persist — `~L7333`
**Jump:** `function installCustomMap` · `const CUSTOM_MAPS_LSKEY` (~L7334)
- **Symbols:** `_validateCustomLevel`, `_sanitizeCustomLevel`, `installCustomMap`, `_loadCustomMapsFromLocalStorage`

#### Lobby ready-up, countdown, launch, teams, seed — `~L7500`
**Jump:** `function checkAllReady` · `function scheduleLaunch` (~L7893)
- **Symbols:** `_renderRoomBox`, `toggleReady`, `checkAllReady`, `scheduleLaunch`, `applyWorldSync`, `assignTeamFromPeerOrder`, `mulberry32`, `getRoundSeed`
- **⚠** Seed determinism relies on `mulberry32`/`getRoundSeed`; `_peerIsJudge` threads through peer counts.

### ═══ PART 3 — Netcode protocol (~8039–9465) ═══

#### NetworkPlayer + net protocol (sync, consensus, hit arbitration) — `~L8039`
**Jump:** `class NetworkPlayer` · `function handleNetEvent` (~L8700)
Remote-player interp + P2P protocol: state broadcast, game-sync consensus, distributed hit claim/vote, ~760-line event dispatcher.
- **Symbols:** `NetworkPlayer`, `broadcastPlayerState`, `broadcastGameSync`, `applyGameSyncConsensus`, `handleHitClaim`, `handleHitVote`, `handleNetEvent`
- **⚠** `handleNetEvent` dispatches nearly every gameplay event; `_npFlipY` flips remote mesh 180°.

### ═══ PART 4 — Combat FX materials & ability spawns (~9466–12272) ═══

#### Ability/effect materials & shader library — `~L9466`
**Jump:** `function makeEnergyShieldMaterial` · `const EFFECT_PRESETS = {` (~L10935)
GPU material factory: energy shields, gas/smoke shaders, layered FX, the big `EFFECT_PRESETS` table, FX-burst pooling, hex hologram.
- **Symbols:** `makeEnergyShieldMaterial`, `recordShieldHit`, `_makeGasCloudMaterial`, `_makeLayeredFXMaterial`, `EFFECT_PRESETS`, `spawnFXBurst`
- **⚠** `_MAX_SMOKE_LIGHTS=4` / `_gasLightSlots` cap shader lights; material pools must be released or they leak.

#### Ability spawns, muzzle flash, damage state, net projectiles — `~L11545`
**Jump:** `function spawnIncendiaryGas` · `function emitDamageState` (~L11936)
- **Symbols:** `spawnIncendiaryGas`, `spawnTetherTrap`, `emitChassisMuzzleFlash`, `emitDamageState`, `spawnNetworkProjectile`, `broadcastAbilityProjectile`, `HIT_CONSENSUS_TIMEOUT`

### ═══ PART 5 — Scene, clouds, camera, renderer & XR (~12274–14903) ═══

#### Scene + BillboardCloudSystem + GasCloud — `~L12274`
**Jump:** `const scene = new THREE.Scene()` · `class BillboardCloudSystem` (~L12291)
- **Symbols:** `scene`, `BillboardCloudSystem`, `GasCloud`

#### Cloud instance, wakes & lighting — `~L13081`
**Jump:** `const billboardCloudSystem = new BillboardCloudSystem(`
- **Symbols:** `billboardCloudSystem`, `_recolorAllAmbientClouds`, `updateBCSWakes`, `updateBCSLighting`
- **⚠** `_WAKE_SLOT_MAX=24` bounds wake sources.

#### Camera, renderer & WebXR/VR system — `~L13330`
**Jump:** `const camera = new THREE.PerspectiveCamera` · `let renderer` (~L13340)
Camera + renderer creation + the *entire* WebXR/VR subsystem: dolly/controllers, session lifecycle, VR HUD/menus, VR perf modes, world-space health bars.
- **Symbols:** `camera`, `renderer`, `_LSS_IS_MOBILE`, `xrDolly`, `_xrEnsureAnimationLoop`, `_xrEnsureHudMesh`, `_XR_VR_PERF_MODES`, `_vrUpdateAllHealthBars`; `window._lssLastIntentionalXrEndMs`
- **⚠** Keep `antialias:true` (birds MSAA); far plane 25000; XR dolly re-synced before each render.
- **⚠ (v35.70) THE OVERWORLD HAS NO VERTICAL TERRAIN CLAMP FOR THE PLAYER.** The clamp in `updatePlayerMovement` (~L45186) is gated on `_swT.FOOT`, and `buildLevel` sets `FOOT: _isHubMap ? null : {...}` — the hub streams endlessly so it has no footprint. Every other map's per-frame clamp quietly undoes anything that puts the ship inside the heightfield; **in the hub nothing does.** That is why SLAYER's Teleport could blink through the ground *there and only there* — the ability was an unconditional 400-unit translation with no terrain test at all, and everywhere else the clamp cleaned up after it. Measured: dropping the player 600u under the surface left them there for ~350ms before environmental damage slowly ejected them.
  - Fixed with `_teleportClampLen(from, dir, maxLen)` (~L46461), which marches 10 steps and returns the last point still `_TP_CLEAR` (26u, matching the movement clamp's pad) above ground. **Marches rather than testing the endpoint** — a 400u hop across a ridge starts and ends in open air with rock in between, and landing on the far side of a mountain is the same exploit by another route.
  - **⚠ The "already buried, let them escape" branch tests RAW ground height, not ground + pad.** Using the padded height made merely flying inside the 26u pad count as buried and handed back an unclamped 400 — measured 24u of clearance still allowing a full dive through the surface. The escape hatch is for being genuinely below the terrain and nothing else.
  - If the hop is blocked under 80u the direction is retried flattened, so aiming down near the deck skims along the surface instead of eating the cooldown for nothing.
  - The BOT teleport (~L29244) had the same clamp but gated `LSS.MODE === 'campaign'`; now any sandwich terrain. **⚠ The hub is open-top and reports a ceiling below the floor** — taking that literally makes the old `_cc - _fc < 80` bail true everywhere and silently disables the bot blink across the whole Overworld, so an absent ceiling means floor-only clamping, not "no room".
  - Debug hook `window.__tpProbe(dx, dy, dz, len)` → ground height, clearance and clamped length. **⚠ Ability keys dispatch off `document`, not `window`** — a `window.dispatchEvent` keydown silently does nothing, which will make a teleport test pass by never firing.
- **⚠ (v35.68) The VR radar showed no contacts because `updateMinimap` was gated on `_vrPerfTier < 2`.** On 'Quest Fast' / 'Max FPS' it was never called in-session, so `_mm.canvas` froze at whatever it held when VR started — and ship-select has no contacts, so what froze was an EMPTY radar, permanently. The disc, rim and compass rose are drawn live by `_hlRadar`/`_hlCompass` every frame, so the instrument looked healthy while never showing an enemy. Now it runs at every tier with a tier-scaled `_mm.minInterval` (0.1 / 0.2 / 0.33s) — the tier buys a slower refresh, not a dead one. Also **moved the minimap update ABOVE `updateHUD()`**: `_hlRadar` blits `_mm.canvas` into the HUD canvas, so running it afterwards always painted the previous radar frame, and in VR the HUD canvas is itself on a cadence so the staleness compounded.
- **⚠ (v35.68) RIGHT stick = 4-way pad in VR (`xrSynth.rightStickAsDpad`, default on).** Quest controllers have no D-pad and VR aims with the head, so the right stick (look) is the spare one. Unlike `leftStickAsDpad` this works DURING gameplay — the left stick is strafe, and synthesising from it mid-flight re-creates the v32.99/v35.57 bug where sidestepping swapped your ship. `gpLookX/Y` are zeroed when it is active so one flick can't also yaw you.
  - **The four directions bind to ACTIONS, not button indices** (`input.xrStickDpad`, dispatch table `_XR_STICK_ACTIONS`). Routing through `gpBindings` would have meant reusing standard buttons 12-15, and **12 is already `core`** — right-stick-up would have fired the core. Defaults: up = scoreboard (a HOLD, hence the separate `_xrStickScoreboardHeld` flag in `_refreshScoreboardVisibility`), left/right = ship prev/next, down = unbound.
  - Runs from `pollGamepad` via `_xrStickDpadTick`, not from `_xrSynthGamepad`: the actions need game/menu context the synth deliberately lacks, and a hold can't be expressed through the edge-triggered binding path. Test hook `window.__xrStick.push(x, y)` injects stick values and bypasses the isPresenting gate.
- **⚠ (v35.66) VR MENUS ARE POINT-AND-CLICK NOW — `_XR_PTR` / `_XR_HITS` (~L15250).** The old nav was D-pad buttons 12-15 ONLY, and Quest Touch controllers have no D-pad (xr-standard = trigger/squeeze/stick-press/A/B + 4 axes, nothing at 12+), so VR menus were frozen solid. v35.20 had made ship-select nav button-only — dropping the left-stick fallback to stop the flat virtual cursor fighting it — which is the change that finished VR off.
  - **Hit regions are recorded BY THE DRAW CODE.** `_xrHit(x,y,w,h,id,act)` is called next to the `fillRect` that paints the thing, in canvas pixels; `_xrDrawMenuCanvas` clears `_XR_HITS` at the top. There is no second coordinate table to keep in sync — anything drawn without an `_xrHit` simply isn't clickable. Registration ORDER is the z-order: `_xrPointerTick` takes the FIRST region containing the pixel, which is why the settings steppers are pushed before their row body.
  - **Hover must be in the repaint signature** (`sig = currentKey + '#' + hoverId`) — the highlight is part of the painted image, so without it the panel only repaints on selection change and hover never appears.
  - **⚠ Two other paths also fire on the trigger and BOTH had to yield.** `_xrHandleTrustedMenuActivation` (bound to the SESSION's selectstart, ~L14699) and the `_menuAnyRaw` branch in `pollGamepad` both treat trigger/face/grip as "confirm = commitLoadout". Without a guard, clicking a ship row also launched the match. Both now bail when `_XR_PTR.hoverId` is set. Do NOT try to solve this with a time-based suppress window — selectstart is a browser event and can land either side of pollGamepad in a frame.
  - Controllers are added to **`xrDolly`**, not the scene: three.js poses them in reference space and the dolly carries the ship transform (same rule as `xrMenuMesh`/`xrHudMesh`). Selection uses three.js's controller `selectstart` rather than gamepad polling — canonical, and it keeps user activation live for `commitLoadout`.
  - **Test hook `window.__vrPtr`** — the whole chain is module-scoped and headset-only otherwise. `paint(mode)`, `hits()`, `aim(o,d)`, `aimAt(id)` (round-trips region -> world -> ray -> UV -> pixel -> region; catches a UV Y-flip instantly), `click(id)`, `hover(id,mode)`, `show(mode)`/`hide()` (parks the panel canvas on the flat screen).
- **⚠ (v35.65) NEVER call `lssAutoFullscreen()` before `requestSession('immersive-vr')` in the same click.** `requestFullscreen()` CONSUMES transient user activation in Chromium and `requestSession` requires it, so the session request throws and the caller silently falls back to flat. This is exactly what broke CONFIRM & LAUNCH IN VR (`#ship-preview-confirm-vr`, ~L55170) on the Quest browser while desktop kept working — on desktop `startSolo`/`joinRoom` had already gone fullscreen, so the `if (!document.fullscreenElement)` guard inside `lssAutoFullscreen` made the call a no-op and the activation survived. Fullscreen is now only taken in the `_vlBuild` fallback, and only when `renderer.xr.isPresenting` is false.
- **⚠ (v35.64) VR HUD size = `input.vrHudScale`, default 1.5.** `_xrEnsureHudMesh` builds `PlaneGeometry(2.0, 1.125)` at z=-2 **once and caches it** — the scale is therefore NOT applied there. `renderFrame`'s XR branch (search `_hudMesh.visible = _xrShowHud`) does a compare-then-`setScalar` every frame, which is what makes the settings slider live inside a running session. Scale, don't move it closer: 2 m is the comfort distance and pulling in clips the ship. Since v35.57 the radar draws into this same canvas, so it scales along with everything else. Slider `#set-vr-hud-scale` sits in the **VR - Performance** settings section (0.75–3.0); flat screen never reads this value. **(v35.66)** It is also a row in `_xrSettingsRows()` — the flat overlay is unreachable from inside a headset, so shipping the VR knob only there meant VR couldn't touch it. Both must move together, and `vrHudScale` has to stay in `_xrSettingsSignature` or the VR panel won't repaint when it changes.

### ═══ PART 6 — Environment, sky, postFX & lighting (~14905–17036) ═══

#### Environment / sky / HDR / PBR / showcase — `~L14905`
**Jump:** `function buildProceduralEnvMap` · `function setEquirectangularSky` (~L15176)
- **Symbols:** `buildProceduralEnvMap`, `setHdrEnvironment`, `_skyDomeEnsure`/`_skyDomeRefresh`, `MAP_PRESETS`, `applyMapPreset`, `promoteMeshToPBR`, `setShowcaseMode`; `window.setSky`, `window.applyMapPreset`, `window.promoteMeshToPBR`, `window.setShowcaseMode`
- **⚠** Showcase toggles global PBR promotion (expensive).

#### Kill/cinema cameras + postFX flag, quality & VR tiers — `~L15579`
**Jump:** `const postFX = { enabled: true }` (~L15742) · `const QUALITY = {` (~L16004)
- **Symbols:** `roundKillCam`, `cinemaCam`, `postFX`, `isXRPresenting`, `getVRPerfMode`/`getVRBudgetTier`/`getVRLightCap`/`getVRGasBudget`, `QUALITY`, `applyQualityPreset`, `_rtSceneOpts`; `window.roundKillCam`, `window.cinemaCam`
- **⚠** The `getVR*` budget fns are the central perf-throttle hub (gate lights/gas/segments everywhere).

#### Post-processing render pipeline — `~L16487`
**Jump:** `function renderPostFX` · `function renderFrame` (~L16800)
- **Symbols:** `cineFX`, `setupCineFX`, `renderPostFX`, `_lssHubDirectTonemap`, `renderFrame`; `window.setCineFXEnabled`, `window.tunePostFX`
- **⚠** `renderFrame` is the single render dispatch (XR vs postFX vs direct).

#### Scene lighting, starfield & arena grid — `~L16881`
**Jump:** `const dirLight = new THREE.DirectionalLight` · `function _lssApplyHubLighting` (~L16910)
- **Symbols:** `ambientLight`, `dirLight`/`dirLight2`/`dirLight3`, `hemiLight`, `_lssApplyHubLighting`, `_starfieldPoints`, `_arenaGridMeshes`; `window.__sunApply`, `window.__hubLight`

### ═══ PART 7 — Terrain: SDF, sandwich, clipmap, streaming (~17037–18014, 22015–23093) ═══

#### Marching-cubes worker + SDF primitives (worker + main copies) — `~L17037`
**Jump:** `function initializeMarchingCubesWorker` · banner `SANDWICH TERRAIN (worker copy` (~L17070)
- **Symbols:** `sdSphere`, `sdCylinder`, `_stHash2`/`_stNoise2`/`_stFbm`/`_stRidged`, `_stGroundY`/`_stCeilY`, `_stRouteAt`, `worldSDF` (worker copy)
- **⚠** TWO byte-identical copies (worker ~17041, main ~17208) + a THIRD `worldSDF` at ~22496 — keep in sync.

#### Sandwich terrain config, biomes & shader-world material — `~L17375`
**Jump:** `const _swU = {` (~L17450) · `const _SW_BIOMES = {` (~L17385) · `const _SW_BIOME_LOOK = {`
- **Symbols:** `_SW_CHUNK`(900), `_SW_BIOMES`, `_SW_BIOME_LOOK`, `_swU` (uTime/uYMid/uAMP/uSnow/uLavaGlow/uStrata/uRim…), `_swPatchTerrainMat`, `_swTerrainMatShared`
- **⚠** `_swU` uniforms shared by all terrain materials; mutated by setters + clipmap.
- **(v34.66) `_SW_BIOME_LOOK`** = the zero-cost visual pass, all data: per-biome `fogMul` (arena FogExp2 scale), `aerial` (arena distance-haze uniforms, both shells — hub keeps its own branch), `mood` (key/ambient/hemi tint via `_lssApplyArenaMood`/`_lssRestoreArenaMood` next to `_lssApplyHubLighting`), `grade` (postFX composite; mossy entry = the exact pre-pass hub constants), `strata` (rock band strength, 0.14 = pre-pass), `rim` (fresnel silhouette), `veins` (scales uGold/uCrystal emissive). Terrain mats also set `dithering:true` (built-in debanding). Ceiling shell gained in-shader mottle+strata+AO+aerial (arena-only in practice — the hub draws no ceiling).

#### Sandwich terrain foliage & shell geometry — `~L17575`
**Jump:** `function _swBuildShell` (~L17839) · `function _swBuildGrass` (~L17645)
- **Symbols:** `_swBuildGrass`/`_swRemoveGrass`, `_swGenTree`, `_swGenMushroom`, `_swForestAt`, `_hzZoneForFoliage`, `_hzFungusAt`, `_swFoliageMat`, `_swBuildTrees`, `_swBuildShell`, `_swDisposeChunk`, `_swApplyAtmosphere`
- **⚠** Grass off by default (perf); `getVRLevelGridRes` budgets foliage.
- **(v35.12) Zone foliage:** `_swBuildTrees` is hub-zone-aware via `_hzZoneForFoliage` (same radial+angular math as `_hubZoneTick`): snow sector → snow-dusted tree set (white canopy, cold bark, climbs 0.16 past the snowLine, 0.65× density); crystalcave/rocky sectors → `_swGenMushroom` bioluminescent mushrooms (blue emissive `_swShroomMatGet`), clustered on `_hzFungusAt` (JS port of the FS fungus noise). **Perf guard:** ONE mushroom variant per chunk + emit skips clusters <3 instances — per-variant buckets were emitting hundreds of 1-instance InstancedMeshes (extra draws on the GPU-bound hub). Geometry cache `_swTreeGeos` is now `{std, snow, shroom}` sets.
- **⚠ (v35.13) Zone veg is BUILD-time, not fade-time:** `_hubZoneTick`'s VEG block no longer multiplies the fade distances by (1−zs) — that collapsed the foliage draw range to ~100u deep in zones ("trees load in too close"). Instead: `_swBuildGrass` skips deep-zone samples entirely (mossy grass = heartland flora), and stock trees in UNTHEMED sectors (volcanic/goldmine/brokensim) thin via `dens*=(1−zs*0.85)` at build. Shader fades stay full-range everywhere — don't reintroduce the veg multiplier.

#### Pillar-karst field (The Colonnade terrain style) — `~L17330`
**Jump:** `function _stPillarAt` · `function _stGroundYCarvedBase` (the pillar-aware wrappers keep the old `_stGroundYCarved`/`_stCeilYCarved` names)
(v34.65) Worley-cell pillar field: where `T.PILLARS` is set (per-map via `MAP_DATA.<key>.terrain.pillars`), both carved surfaces blend past the local midline and fuse into floor-to-ceiling rock columns. Same math in the carved trio + `_stGapSDFCarved`, so mesh and collision agree. Seed re-rolls per round (worldSeed + currentRound, built in `buildRoomGraphLevel`); `T.PILLARS.clear` holds spawn-circle + narrow lane-capsule keepouts (lanes stay flyable; near-lane pillars decay into stumps).
- **Symbols:** `_stPillarAt`, `_stGroundYCarvedBase`/`_stCeilYCarvedBase`, `T.PILLARS` (cell/r/soft/drop/jitter/overlap/ox/oz/clear), `MAP_DATA.<key>.terrain.{pillars,wallPinch}`
- **⚠** All existing maps pass `T.PILLARS` unset → wrappers fall straight through to Base (behavior-identical). `_openTop` (hub) skips pillars.

#### Terrain clipmap LOD + edge audio + streaming lifecycle — `~L22015`
**Jump:** `function _clipBuild` (~L22233) · `function _clipUpdate` (~L22263) · `function updateSandwichStream` (~L22324)
- **Symbols:** `_swStartDragHiss`, `_CLIP_N`/`_clipmap`, `_clipGeo`, `_clipMat`, `_clipBakeLevel`, `_clipBakeEdge`, `_clipBuild`, `_clipEyeSet`, `_clipUpdate`, `updateSandwichStream`, `_swDrainStream`, `initSandwichTerrain`, `setSandwich*`, `sandwichDebug`; `window.__smoothTerrain`, `window.__terrainDetail`, `window.__terrainAO`, `window.__terrainSat`, `window.__clipTest`, `window.__clipDetail`, `window.__clipMorph`, `window.__clipSkirt`, `window.__clipSeam`
- **⚠ The clipmap VERTEX SHADER does not live here** — it is injected by `_swPatchTerrainMat`'s `if (clipAtlas)` branch in PART 7's *shader-world material* entry (`~L21501`), one giant template-literal line. `_clipMat()` only wires the per-level uniform objects (`_clipAtlas`, `_clipOrigin`, `_clipSpacingU`); the band constants `_cms`/`_cme`/`_cmw` and the geomorph maths are in that string. Grep `uClipMorph` to land on it.
- **⚠** NAME COLLISION with the `_clip` video recorder (~L46572). Different systems.
- **(v36.26) `_swDrainStream(px, pz, sliceMs, maxCalls)` — a streaming budget in MILLISECONDS, for the two paths that are LOADING rather than flying.** **Jump:** `function _swDrainStream` (right under `window.__swStream`). Callers: `_prebakeWorldForLaunch` (40 ms slice, see PART 13) and gameLoop's `game.state === 'warmup' && !game._worldPrebaking` arm (12 ms slice).
  - **Why ms and not a chunk count.** One chunk is not one cost. A hub chunk with the clipmap on is a near-empty record (ground shell suppressed by `_clipmap.on`, ceiling suppressed for mossy) — hundreds per frame are free. An arena/endless chunk bakes ground AND ceiling: ~6 ms here, 35–70 ms on a phone (the v35.89 measurement behind the mobile 1/frame budget). A single fixed count is therefore either a starvation budget on the hub or a several-hundred-ms freeze on a phone. The first attempt at this WAS a flat 12 chunks/frame and it produced **six consecutive ~70 ms frames** behind the between-rounds ship picker on this desktop; the slice caps that at 28 ms.
  - **⚠ The slice is checked AFTER each call, so the real bound is `sliceMs + one call`. That is deliberate**: when a single chunk already exceeds the slice the loop runs exactly once, which degenerates to precisely today's mobile 1-chunk/frame budget with no device constant to keep in step. `maxCalls` bounds the other end — `updateSandwichStream` rescans its whole view square and sweeps every live chunk for foliage on every call, so on the hub an unbounded loop would spend the slice on bookkeeping.
  - **What the warmup arm fixes.** The launch is covered by the prebake; the OTHER way a world gets swapped is the `roundEnd → warmup` rebuild in `updateRoundSystem` — every round 2+, every campaign leg, and the hub **ZONE-RIFT traverse** (`_hzEnterCavern`/`_hzReturnToHub` set `state='roundEnd'` with a 2 s timer and the rebuild lands in that branch). Those all ran the gameplay budget through a countdown in which the ship cannot move. **Measured v36.25 hub→cavern rift: warmup at t=52394, `playing` at t=62387 — 10 s of world still arriving, and it kept arriving into live flight. v36.26: complete 0.7 s after warmup began, then p50 7.0 / p95 7.6 / p99 8.3 ms and ZERO frames over 16 ms for the whole 10 s countdown.** Elimination round 2: complete 0.9 s in, then 15 s of play at p99 8.8 ms, worst 9.7 ms, zero frames over 16 ms.
  - **(v36.27) The two big traverse frames this could not reach are gone — see the WORLD-SWAP TRAVERSE entry in PART 16.** The warmup arm above now also stands down for a staged swap (`game._swapStaging`), which owns the streamer end to end. **(v36.40)** it stands down for `game._rrStaging` too — the between-rounds staged rebuild (`_rrStagedRound`), which drains at an 8 ms slice behind the picker instead of the 12 ms one here. Two flags, not one, on purpose: see the v36.40 entry in PART 16.
- **(v36.27) `_clipEnableNow` / `_clipEnableSliced` / `_clipEnableLevel` / `_clipDropChunkGrounds` — the clipmap enable, factored out of gameLoop and made sliceable.** **Jump:** `function _clipEnableNow` (just above `_clipUpdate`). gameLoop's terrain block used to inline the whole thing; it now calls `_clipEnableNow`, gated on `!_clipmap.enabling`.
  - **Why.** `initSandwichTerrain` sets `_clipmap.on = false` on every hub build (deliberately — v34.96, so a rebuild can't reuse stale ghost mountains), and gameLoop re-enables on the next frame with a FULL bake of every level plus their first link. Measured on the cavern→hub return: **66 ms with a warm ANGLE program cache and 1170.4 ms with a cold one**, identical GL call counts (`compileShader n=56`, `getProgramParameter n=72`) both times. The staged swap bakes one level per frame instead (~40 ms each, 6 levels).
  - **⚠ `_clipmap.enabling` is claimed at the TOP of `_rrStagedSwap`, not at its clipmap phase.** gameLoop enables on the first frame after `_clipmap.on` goes false — i.e. during one of the earlier yields — so claiming it late is a race the staged path loses.
- **⚠ (v35.65) The water-skim "shhhh" volume lives in `_swStartDragHiss().set()`, not in the `water_drag` sound-lab recipe.** The recipe is the v34.26 retriggered one-shot version and is effectively dead for the skim — v34.27 replaced it with a genuinely continuous looping noise voice. Gain is `(0.05 + 0.30*k) * 0.25` where k ramps over speed 18..338; the `* 0.25` is the v35.65 -75% the recipe cannot affect. Measured live: 0.0768 vs the old 0.3144 at speed 300.
- **(v35.46) Snowline meander.** The snow mask was `smoothstep(uSnow, uSnow+0.12, th)` on `th` alone — normalized ALTITUDE with no world-XZ term — so it cut a dead-level ring around every peak, and `max(fl,0.45)` put 45% snow on vertical faces, which is what made it read as a drawn line. Now the threshold is `uSnow + _snowWander(vWPos.xz)*uSnowVary + (1-fl)*uSnowSlope`: three octaves of world-XZ noise (`_snowWander`, coarsest ~1176u) plus a lift on steep ground, since snow doesn't hold on a cliff. Cliff floor dropped `0.45 -> 0.30`. Live: `__snowLine(vary, slope)`; `__snowLine(0,0)` restores the old ring for A/B. Defaults 0.16/0.11 = ±206u wander, cliffs holding out another 142u at AMP 1120.
- **⚠ (v35.46)** The **roughness** chunk carries its own copy of the wander (`_rsl`). It has to: without it the gloss boundary stays a straight line while the colour boundary meanders, leaving a straight specular edge cutting across the snow. The duplicate `_snowWander` call is deliberate — hoisting it out of `color_fragment` for `roughnessmap_fragment` to reuse would work today (three.js emits colour before roughness, same `main()` scope) but silently breaks if that order ever changes.
- **⚠ (v35.11 → v36.43) THE CLIPMAP SEAM + GEOMORPH INVARIANT — the two rules that make a re-snap invisible.** Every term a clipmap vertex computes must be a function of its **WORLD** position, never of its index inside the mesh: the mesh teleports 2 cells whenever the centre re-snaps (every `2*spacing` of travel — 32u at L0, 1024u at L5) and the same world point lands on a different index. The atlas is toroidal and world-keyed, and the coarse lattice is world-keyed because `gIx` is always even (`cx` is a multiple of `2*spacing`), so **geometry was already right**. Two terms were not, and both were measured flickering — this is the owner's "mountain geometry flickers in the overworld":
  1. **`_rd` was measured from the MESH CENTRE.** `max(|_fi-64|,|_fj-64|)` steps by exactly 2 cells on a snap, so `_gm` at a fixed world point jumped `2/28 = 7.14%` in ONE frame and then sat still for the next seven. Measured on L0 at 4 u/frame (576 u/s @144Hz): **17.53 u of vertical step on the snap frame and 0.00 u on every other frame**; L1 39.6u, L3 46.1u, L4 95.4u. A 12–25 Hz sawtooth. Now `_eo = (modelMatrix[3].xz - uClipEye)/uClipSpacing` re-centres `_rd` on the eye, so the ramp is **continuous**: 2.36 u every frame, and snap frames measure identical to non-snap frames.
  2. **The morph TARGET was a BILINEAR patch — the parent doesn't draw one.** The parent draws two triangles split on the `c10–c01` anti-diagonal (`_clipGeo`'s `idx.push(a,c,b, b,c,d)` — same convention as `_swBuildShell` and `_stGroundYGrid`). Bilinear and triangle-linear agree on the lattice LINES and differ inside the cell by `twist/4`, so the fully-morphed child NEVER matched the parent. Measured over the annulus where both really draw: **L0/L1 1.83 u mean / 150 u max, rising to L4/L5 17.06 u mean / 534 u max.** That seam is the child's window edge and it **teleports a whole snap step**, so peaks sitting on it popped. The target is now the parent's own triangle plane `_h00 + (_h10-_h00)*_wx + (_h01-_h00)*_wz` — `_wx`/`_wz` are only ever 0 or 0.5 so `_wx+_wz <= 1` always and the `h11` triangle is unreachable: **one FEWER texture fetch**, and the child's fully-morphed surface is bit-identical to the parent's rasterised surface. `__clipSeam()` now measures **0.000 mean and 0.000 max at all five seams**, and still 0.000 after a 30 s / 4 km flight.
  - **Band bounds, with the EYE as the origin** (`uClipEye`, fed from `_clipUpdate`/`_clipEnableLevel` with the same `(px,pz)` the centres snap around, so `|eye − centre| <= spacing` per axis is guaranteed): **start `N/4+1 = 33`** — must clear both this level's own hole edge (`hole/2 = 30` own-cells from the centre, `<= 31` from the eye) and the CHILD's window edge (`N/4 = 32` own-cells from the child centre, `<= 32.5` from the eye); morphing before either opens a crack on the inner side. **End `(N/2-4) - 2 = 58`** — the PARENT's hole edge is `hole = 60` own-cells from the parent centre and that centre can sit 2 own-cells off the eye, so 58 is the earliest the parent can start drawing. Measured: start 32 leaves 0.013–0.234 u of residual seam error, **start 33 gives exactly 0.000**. If `_clipGeo`'s hole inset (the `-4`) changes, `_cme` moves with it; if `_CLIP_N` changes, both move.
  - `_CLIP_SKIRT` 1500→220 (v35.11) stands: skirts only plug transient re-bake gaps; exposed 1500u walls read as giant dark triangle rows. Measured contribution to the flicker: **3 px of 90,000** (skirt on vs off at a hub stand-off) — the skirts are effectively invisible and were NOT the bug.
  - **Verified (v36.43), fixed camera + only the clipmap visible + `uCam` frozen, so the ONLY thing changing is the clipmap:** 41 steps of 4u past 10 snaps. Geometry-only (flat normals, shading follows geometry exactly): **v36.42 snap frames 107.7 px avg / 200 max vs 0.0 px on every non-snap frame (ratio 2154); v36.43 20.6 px avg / 27 max vs 20.1 px non-snap (ratio 1.0).** Full shading: v36.42 203.8 px vs 0.0 (ratio 4076); v36.43 154.5 px vs 23.2 (ratio 6.7) — the residual is the normal, below. 144 fps and p50 6.9 ms in both; 30 s varied flight p50 6.9 / p95 9.1 / p99 10.4 ms.
- **(v36.48) `vSN` NOW MORPHS WITH THE GEOMETRY — the v36.43 item below is CLOSED.** The normal blends on the SAME `_gm` the height does, toward the barycentric blend of the three PARENT-vertex gradients read from `uClipAtlasP` (the v36.46 parent atlas is what made this affordable — the old own-even-cells path could not express the parent's gradient at all). At the seam `_gm` = 1, so the child's normal IS the parent's and the shading is continuous by construction. 10 extra VTF taps, all inside the `_gm > 0` band, which is spatially coherent — **measured p50 6.9 ms / p95 8.2 / 144 fps, i.e. no measurable cost.** **Stationary two-frame flip probe, mid-range terrain, median of 8:** v36.47 **352** → v36.48 **222**, against a flat-normal floor of **215** — i.e. the morph recovers essentially ALL of the shimmer that killing `vSN` outright would, while keeping smooth shading. Full chain across today's three fixes: **1260 → 490 → 352 → 222.** Do NOT ship `__smoothTerrain(false)` as the "fix"; it hits the same number by reverting to the pre-v34.09 faceted look.
- **⚠ (v36.43 — SUPERSEDED BY v36.48 ABOVE, kept for the diagnosis) `vSN` was discontinuous across a LOD ring, and the ring sweeps.** `vSN` is built from the level's OWN atlas at ±1 of its OWN texel, so the fine level's shading normal is fine-scale everywhere (including where its geometry has already morphed fully coarse) while the coarse level's is coarse-scale. The two disagree at the seam, and the seam jumps a whole snap step, so a band of terrain changes SHADING on the snap frame even though its geometry no longer moves at all. This is the entire remaining 154.5 px (isolated by `__smoothTerrain(false)`, which drops the same snap to **7 px**). **The exact fix** is to blend the fine level's gradient toward the barycentric blend of the three parent-vertex gradients `(1-u-v)·G00 + u·G10 + v·G01` (equivalently `(T(i±2)-T(i∓2))/(4s)` on the triangle-interpolated field `T`) — costs **7 extra VTF taps**, roughly doubling the clipmap VS's texture work. The cheap version (blend to a plain ±2-cell central difference, 4 taps) was built and measured: it is **exact only at even cells** and a wash overall (154 → 173 px), so it was not shipped. Do NOT "fix" this by turning `__smoothTerrain` off — that is the pre-v34.09 faceted look.
- **⚠ (v36.45) "SOME SPIKES LITERALLY GROW AS I APPROACH THEM" (owner) — diagnosed, partial fix built, SHIPPED OFF.** **Jump:** `const _CLIP_PEAK` · `function _clipCellH` · console `window.__clipPeak`. This is NOT the seam and NOT the normal: `__clipSeam` reports `seamMaxU` 0 while **`morphSpanU`** — the vertical travel between a level's coarse and fine representation of the same ground — measures **444 u at the NEAREST ring (L0/L1)** and **1922 u at L4/L5**. Cause: every atlas texel is ONE point sample of the continuous terrain at that level's spacing (L5 = every 512 u), so a spire narrower than the spacing is hit on a random flank or missed, and reappears as finer levels take over. v36.43 made that transition smooth rather than a per-snap jump, which is exactly why it now reads as *growing* instead of popping.
  - `_clipCellH` gives each texel a FOOTPRINT instead of a point — `k*k` samples across `sp*foot`, kept as `mean + (max-mean)*mix` (pure max dilates valleys as hard as ridges; pure mean sits BELOW the point sample at a peak and makes the growth worse). `k=1` reproduces the old point sample bit-exactly, and **L0 is never touched** (`minLevel:1`) — it is the fine reference the coarse levels are trying to match. Used by BOTH `_clipBakeLevel` and `_clipBakeEdge`; they must never diverge or freshly-slid columns rebuild the leading-edge seam the toroidal atlas exists to avoid.
  - **Measured `on:1, k:3, foot:1.35`:** morphSpanU L0/L1 455→441, L2/L3 856→608, L4/L5 1922→1602 — but **`seamMaxU` 0 → 430 / 382 / 628 / 1040 / 860.** Flipping `on:0` and forcing a full re-bake restored `seamMaxU` 0 on all five, so the bake is the cause.
  - **⚠ WHY IT CANNOT WORK AS-IS, structurally.** The VS builds its morph target from THIS level's atlas at EVEN indices, which silently assumes `level k's atlas at world W == level k+1's atlas at world W`. That holds only while every level samples a shared world point IDENTICALLY. A per-level footprint breaks it by construction (k's even cells carry `sp*foot`, k+1 carries `2*sp*foot` at the same points). Making even cells borrow the parent's footprint fixes one seam and pushes the same contradiction to the next (k+1's own even cells would then owe `4*sp`); a footprint keyed to the cell's 2-adic valuation does close the recursion but inflates cells in a visible regular grid. A footprint held CONSTANT across levels is exact, but to help L5 it would have to be ≥1 km and would flatten near terrain.
  - **(v36.46) THE PARENT-ATLAS MORPH TARGET — BUILT AND SHIPPED ON.** **Jump:** `uClipAtlasP` in `_swPatchTerrainMat`'s clip VS · `function _clipOriginP` · `function _clipWireParents`. The morph target no longer rebuilds the parent from own-even-cells; it samples level k+1's atlas directly. Addressing is toroidal on the GLOBAL parent cell: fine even index `_ie` maps to parent cell `(gIx+_ie)/2`, so `uClipOriginP` carries `(gIx/2) mod R` and the shader adds `_ie*0.5` (⚠ halve BEFORE the modulo — `(gIx mod R)/2 != (gIx/2) mod R`; `gIx` is always even so the halving is exact). `uClipHasParent` is 0 for the coarsest level and until the parent's texture exists, so a staged `_clipEnableSliced` can never morph toward an unbaked all-zero atlas — it falls back to the pre-v36.46 path. **Verified: `seamMaxU` 0 at all five seams with the new target live (`hasParent` 1 on L0–L4), zero console errors, p50 6.9 ms.** ⚠ `__clipSeam` re-implements this target in JS (`hasP`/`TP`) — if the shader changes and that does not, the probe silently reports the wrong seam.
- **(v36.47) THE ACTUAL SHIMMER — OVERLAPPING LOD RINGS WERE Z-FIGHTING.** Owner: *"only some of the faces, like the textures or faces aren't covering enough, so they shimmer and flicker"*, mid-range. **Jump:** `mat.polygonOffsetUnits` in `_clipBuild`. Adjacent levels overlap by 4 child cells (parent hole edge at child radius `N/2-4`=60, child window edge 64) and inside that annulus the child has morphed FULLY — so since v36.43 the two surfaces are *exactly* coplanar (`seamMaxU` 0) and separated **only** by the polygon offset. `-1..-6` units was too thin at mid range: the two levels traded the depth test per pixel, and because each level derives `vSN` from its OWN atlas the winner also flips the SHADING — which is why it reads as patches of face shimmering rather than as depth noise. Fixed by doubling the unit spread to `-(_CLIP_LEVELS-k)*2` (**factor stays -1.0**).
  - **⚠ MEASURE THIS WITH A STATIONARY CAMERA.** With a thin offset ANY frame-to-frame change (weather, exposure, foliage) re-rolls the tie, so the flips appear with the camera parked — and a moving-camera number is swamped by day-cycle drift (measured: the same config gave 6277 then 9720 blink px minutes apart). Two frames, camera held, hard-flipped px of 288,800, median of 6-8 reps: **mid-range terrain 1260 → 490 (-61%)**. An eps=0 CONTROL is mandatory — without it the camera-move probe reads the animation floor and looks like signal.
  - **⚠ FACTOR STAYS -1.0 — this is the v35.13/v35.14 trap.** v35.13's `-2` factor / `x3` units made the CITY PAD flicker (clipmap winning ties against the near-coplanar city ground plane) and v35.14 reverted it. Re-measured on the same probe: city pad `-1.0/x1` 2049 · `-1.5/x4` **2927 (regresses)** · `-1.0/x2` 1667 (safe). `-1.5/x4` buys a little more terrain (357) and is NOT worth reopening it.
  - **⚠ (v36.46) THE FOOTPRINT BAKE IS TUNED AND CORRECT BUT SHIPPED `on:0` ON COST.** With the parent atlas in place, `seamMaxU` stayed 0 at EVERY setting swept — tuning can only trade morph travel now, never correctness. Best setting `k 3 / mix 0.25 / foot 1.0` cuts worst-spire travel **−14% to −43%** (L0/L1 455→276, L1/L2 537→305, L2/L3 856→604, L3/L4 763→463, L4/L5 1922→1660) and improves p95 at the three coarsest seams. **The blocker is the FULL bake:** 9 samples per texel × the same texel count at every level = **max frame 329.6 → 1877.8 ms (5.7×, ~313 ms per level)**. Steady flight is FREE (p50 6.9→7.0, p95 8.5→8.4) because travel only runs `_clipBakeEdge`. On a zone-rift traverse `_clipEnableSliced` does one level per frame, so this would turn 6×55 ms into 6×313 ms — exactly the freeze class v36.26/v36.27 removed. Sub-samples cannot be shared (at `foot 1.0` the k*k grids tile into one uniform `sp/3` lattice), so 9× is inherent to k=3. **To ship it:** move the atlas bake onto the existing terrain WORKER, or slice `_clipBakeLevel` by row bands across frames. Neither is a tuning change.

#### The Spire — volumetric arena field (v36.56, slice 1: collision only) — `~L22400`
**Jump:** `const _ARENA_FIELD_SRC` · `function _arenaBuildParams` · the `game.arenaField` branch in the 3-arg `worldSDF` · `spire: {` in `MAP_DATA` · debug `window.__spireArena` (`at`/`raw`/`G`/`params`)
(v36.56) Port of the volumetric arena from `labs/fractal_arena.html` — full plan, symbol names and slice order in **`LSS/arena_port_plan.md`** (read it before slices 2-5). Slice 1 shipped: the field exists, collides, contains bots — **no geometry renders** (the world is invisible on the `spire` map by design until slice 2).
- **ONE SOURCE, TWO REALMS.** The field is defined ONCE as the `_ARENA_FIELD_SRC` template-literal string; the main thread `Function()`-constructs `_ARENA_FIELD` from it, and slice 2 must interpolate the SAME string into the marching-cubes worker blob. This deliberately avoids the sandwich terrain's hand-synced-copies model (trap #7 above). **Never fork a hand-maintained copy of the arena field.** ⚠ NO BACKTICKS inside the string (template-literal trap); comments inside it survive strip.py and ship. No CSP ships (`_headers` is Cache-Control only), so Function-construction is safe.
- **Sign convention:** negative = open air, positive = rock — same as every SDF here. `worldSDF`'s arena branch sits BEFORE the sandwich branch and reuses the sandwich clamps verbatim (`f>0 ? min(f,90) : max(f,-300)`) — rays can't skip thin pillars, embedded ships eject in ≤90u nudges. Do not remove them.
- **World-build wiring** (`buildRoomGraphLevel`): a `MAP_DATA.<key>.arena` block → `game.arenaField = { ON, G: _arenaBuildParams(level.arena) }` and `game.sandwichTerrain = null` (the sandwich params block is `else if`-bypassed; `initSandwichTerrain` no-ops on null). `game.arenaField` is reset at the same top-of-function spot as `sandwichTerrain` so gmaps early-returns clear it. The worker dispatch is skipped by an arena-first branch — **slice 2 REPLACES that branch with the arena worker payload** (the arena, unlike sandwich, DOES march cubes).
- **⚠ (plan correction, found v36.56):** `createMeshFromPositions` is a NO-OP stub (the cosmic wall shader was removed), so the plan's "everything downstream of the worker is unchanged" is STALE — slice 2 needs its own mesh-build path (the lab's chunked mesher pattern or a `_swBuildShell`-style build), not the legacy worker callback.
- **`MAP_DATA.spire`:** classic/elimination carousel (unprefixed key). ⚠ Its `rooms` are SPAWN/NAV DATA ONLY — the arena branch ignores `levelSpheres`, so rooms do NOT carve this world and every room must sit wholly in open field air. Coordinates are SEED-LOCKED (seed 7 → satellite columns at 25.2/145.2/265.2°) and were optimised by **`tools/arena_room_opt.cjs`** (re-run it on any seed/floors/scale change and paste the new centres) to 0.00% rock across each room's 0.7r corridorPoints ball. `arena.scale` multiplies every linear dimension (spike sizes are eval()-internal constants and don't scale — you just get more spikes).
- **Params are static + deterministic** (seed in MAP_DATA, no per-round reroll, all peers identical) — which is what keeps the slice-2/3 bake-to-GLB option open.
- **Verified (v36.56):** offline node harness (**`tools/arena_port_check.cjs`** — lab-vs-port parity + the plan's probes + room openness, keep it green when touching the field string) — ported field bitwise-identical to the lab at 20k points, params identical to lab `buildArena`, 4 open helix bands (multivalued probe on `helix()` alone — probing `eval()` at ramp radius is WRONG, that column sits in the always-open annular gap), 0/216 rock in ring/shaft voids. Live (stripped `index.html`): spire solo reached `playing` with 0 mapMeshes across 3 round rebuilds; embed at +41 ejected to −44 within one frame; sustained 700u/s thrust parked at the invisible wall (SDF ≈ −30, max ever −28.2, never ≥0); bots 341 samples/20s max SDF −50.6, max rxz 796, never embedded/escaped; 144 fps pane-visible; zero console errors; hourglass regression clean (sandwich ON, arenaField null).
- **Pending decisions (owner, before slice 3):** lava visual-only vs hazard; build-time via density cut vs bake-to-GLB (owner leans GLB — arena is deterministic+static, preload pipeline exists).
- **⚠ (v36.57) THE CONTAINMENT-BAND TRAP — why `arena.scale: 2` is LOAD-BEARING, and the rule for ANY future tight world.** Owner: *"we couldn't move when the round started"* (elimination, the spire). `resolveCollision`'s containment applies a restoring force whenever a ship sits within `CONTAIN_RANGE = collRadius*2.5` of rock, and `collRadius = ch.hullLength*0.32` ≈ 50-64u, so the band reaches **~125-160u**. At lab scale the arena's flight pockets (spike-forested storeys) max out at ~70-120u of openness — the ENTIRE pocket sits inside the band, the force (up to ~7000 u/s²) beats thrust (~2200 u/s²), and ships spawn pinned in a potential well. The lab flew fine because its camera-ship radius is 24. Sandwich canyons never hit this because lanes are ≥280u wide — you're only ever near ONE wall. **Rule: any world's ordinary flight space must keep ≥170u of SDF openness or ships glue.** `tools/arena_port_check.cjs` enforces it on the spire's room centres. Scale 2 puts typical margins at 200-360u. Verified live (v36.57, elimination at a real spawn): held-W ramps to the 350 cap and covers 871u/2.5s (hourglass control same method: 734u); 144 fps; only console errors are the pane's trystero relay failures (pre-existing MP infra noise).
- **(v36.57) CHAMPION ROOM IS REQUIRED on arena maps.** `spawnChampionField` with no `champion: true` room falls back to the AVERAGE of room centres — on the spire that lands INSIDE the central column, and the −150-clearance rescue walk cannot escape it at lab scale (measured live: field at (15,130,50), unreachable, classic tiebreak unwinnable). `mid_high` now carries the flag; verified live: field spawns at exactly (360,400,1606), SDF −330. The checker asserts the champion room centre beats the −150 bar.
- **(v36.57)** Room set re-derived at scale 2 by **`tools/arena_room_opt_s2.cjs`** (6 rooms incl. the new `mid_east`; all 0.00% rock, centres −228..−360) and the real carousel thumb `map_thumbs/spire.png` landed (spawned task).
- **⚠ (v36.57) Harness note for input tests in the pane:** `input.keys` is keyed by **`e.key.toLowerCase()`** (`'w'`), NOT `e.code` (`'KeyW'`); synthetic `KeyboardEvent`s do NOT drive flight. To simulate held thrust from the console: `input.keys['w'] = true` (clear it after). A tap barely moves a ship (drag), so measure with a HELD key over ≥2s.
- **(v36.58) SLICE 2 SHIPPED — RUNTIME PROCEDURAL MESH (owner: "i'd rather not use GLB's for this, i prefer procedural seeds").** **Jump:** `const _arenaMesh` · `function _arenaBuildMesh` · `function _arenaEnsureMesh` / `_arenaDisposeMesh` / `_arenaMeshWorkerSrc` / `_arenaMakeMaterial` · debug `window.__spireMesh()` · the `_arenaMesh.building` term in `updateRoundSystem`'s warmup→playing flip. The arena is meshed at load from the seed by 2-8 blob workers running the lab's surface-nets mesher with **the interpolated `_ARENA_FIELD_SRC` string** (one source, two realms — an offline harness PROVED the worker mesher bit-identical to the lab's: positions/normals/indices/colors exact across every chunk class). Chunks merge per-1800u-REGION into ~27 meshes (frustum culling, few draws) with vertex-color vec4 (rgb albedo, **A = vein emissive** — the material forces `diffuseColor.a = 1.0` back so the alpha can't leak into the postFX RGBA target). Cached by params key: round 2+ reattaches instantly; any NON-arena build disposes.
  - **THE LOADING-CONTRACT GATE:** first build measured **~16 s at 8 workers / ~45 s worst-case on 4 cores** (925,762 tris, 704 chunks after the vertical cull) — so the warmup→playing flip now holds on `game.arenaField && _arenaMesh.building` (60 s wedge cap) with `#map-gen-hud` showing `GENERATING ARENA · N%`. Verified live: warmup held to 16 s at 91%, flipped at 17 s with 704/704 done, 143-144 fps in combat. ⚠ Co-op caveat: each client gates on its own build — a slow machine enters 'playing' late against the shared round clock (accepted v1).
  - **⚠ Review-hardened failure contract (adversarial workflow, 4 confirmed findings):** every failure path (blob-create throw, zero workers spawned, `w.onerror`/`onmessageerror`) calls `_arenaDisposeMesh` — a failed build must NEVER stay cached under its key (it was being reattached, holed or empty, every later round with no retry). The blob URL is revoked immediately after the spawn loop (abort paths were leaking it). A worker error aborts the WHOLE mesh (a dead worker can't say which chunk it lost, and a short region never merges) — that round degrades to the slice-1 invisible-but-flyable world, next round rebuilds.
  - **⚠ The vertical chunk cull is bounded by the HELIX extent, not H** — the helical bore is smin-carved through the volume caps and real flyable tube exists at y −2400..−1800 (and above +1560); an H-based cull deletes real geometry and desyncs mesh from collision. Design quirk, faithful to the lab: the ramp bore tunnels beyond the caps — slice-3 material could hide or the field could clamp it if the owner dislikes it.
  - Jobs dispatch nearest-team-spawn-first so rock materialises around the players in the first seconds. Mobile/Quest meshes at CELLS 14 (~43u cells, ~4× fewer evals + tris).
- **(v36.59) SLICE 3: LOADING-SCREEN BUILD + SCALED SPIKES + PILLARS + STOREY THEMES + LAVA.** **Jump:** phase B2 in `_prebakeWorldForLaunch` · `pillarField` in `_ARENA_FIELD_SRC` · `spikeScale`/`pillars`/`themes`/`lavaY` in `_arenaBuildParams` · `uArenaLavaY` in `_arenaMakeMaterial`.
  - **The build now rides PREPARING ARENA** (owner: "it should load at the loading screen after confirm and launch and before the cinematic"): prebake phase B2 awaits `_arenaMesh.building` (own 60 s ceiling — `_PREBAKE_MAX_MS` would abandon it) with `generating arena · N%` on the overlay sub-line, and `_bt0` shifts every later phase's budget by the arena wait so the GPU prime is never starved. Verified live: overlay 3%→97% over 2-19 s, countdown after, `playing` at 29 s with 704/704 done. The v36.58 warmup→playing gate stays as the fallback for prebake-skipping paths.
  - **`_arenaBuildParams` GREW A SECOND ARGUMENT** — `(a, rooms)`: room keepout circles for pillar placement. Both game call sites pass `level.rooms`; `tools/arena_port_check.cjs` + `tools/arena_room_opt_s2.cjs` carry a hand-synced `SPIRE_ROOMS` copy — **keep all three in step with MAP_DATA.spire.rooms**.
  - **Field additions (all ADDITIVE — absent keys reproduce the lab byte-for-byte, which is how the parity checker still passes):** `spikeScale` (=S) scales spike len/rad/tile-spacing — the unscaled lab constants read as gravel at scale 2 ("on the floors, they are tiny"); `pillarField` grows sparse waisted floor-to-ceiling columns in every gap (cap→floor, floor→floor, floor→cap; per-gap salt, both-ends-solid root test via the shared `floorHole` oracle, room keepouts, per-gap y early-out keeps it ~free); `themes` = per-storey palettes (basalt/bronze/crystal/snow) blended by a CONTINUOUS 80u half-weight crossing at each slab midline (⚠ the first cut used a two-sided lerp that INVERTED at the midline — caught by a continuity probe, worst per-2u rgb jump now 0.016); `lavaY` darkens the bottom band to basalt and bakes a lava-lake + crack-vein glow into vertex ALPHA, which the material tints ORANGE below `uArenaLavaY` (cyan veins above) via a `vAWy` varying — identity matrices make object-space y world y.
  - Rooms re-derived against the spikier field (all six 0.00% rock, centres −237..−355). 969,526 tris, ~18.5 s first build, 143-144 fps, round 2+ cache reattach unchanged, zero console errors.
- **(v36.60) THE MYSTICAL STOREY** (owner: "a grassy/trees and/or mystical/mushroom level would be good to replace the rock/snow level below the snowy level"). **Jump:** `mystBand` in `_arenaBuildParams` · `uArenaMystLo/Hi` in `_arenaMakeMaterial` · `function _arenaScatterShrooms`. Band 2 (between floors 1 and 2, directly under snow) is now MOSSY GREEN with VIOLET fungal glow: shade() adds bright bioluminescent spot-glow in that band, the material tints the band's alpha-glow violet (a third branch beside lava-orange and vein-cyan, driven by two more height uniforms), and `_arenaScatterShrooms` plants ~150 instanced glowing purple-cap mushrooms (2 draw calls, seeded PRNG, roots found by BISECTING the field down onto the storey's slab top so every mushroom sits on real rock; skips shafts/holes automatically). They live in the arena group — round-cache and disposal ride along. ⚠ the parity checker's additive-strip list gained `mystBand` — every new params key must be added there or the parity leg false-fails. Verified live: mossy walls + mushroom fields + violet glow on-screen, 29 group meshes (27 regions + stems + caps), 144 fps, zero console errors, rounds cycling on the cache.
- **(v36.61) SLICE 4 — THE VERTICAL ROUTER** (owner field report: *"the bots did seem to come down if i was there, direct line of sight"*). **Jump:** `function _arenaNavUpdate` · `_arenaNavBlocked` / `_arenaNavPickThroat` / `_arenaNavThroatClr` / `_arenaNavStorey` / `_arenaNavMinClr` · the `_arenaVia` local + router block in `class Bot`'s update (right after the formation block) · debug `window.__spireNav()` · runtime A/B flag `window.__arenaNav` · offline gate **`tools/arena_nav_check.cjs`**.
  - **The router is a NO-OP whenever the straight line is already clear** — that is the owner's observation turned into the design. A bot beelines in 3D, so when the line happens to thread a shaft or the ring it already arrives; only the *blocked* case is broken. `_arenaNavBlocked` is a closed-form test (walk the slabs between the two storeys, evaluate `floorHole` at each crossing point — no ray marching, no SDF samples) measuring **recall 89.9% / precision 98.0%** over 250 seeded cross-storey pairs.
  - **⚠ THE CONSTRAINT THAT SHAPES EVERYTHING: THE CONTAINMENT-STALL CLEARANCE.** `resolveCollision` applies `12000*(1-margin/(collR*2.5))²` along the inward normal, so a hull only makes headway while **`c* = collR*2.5*(1 - sqrt(accel/12000))`** of clearance remains — **68 / 93 / 139 u** for FRIGATE / CORVETTE / DREADNOUGHT. The annular ring's min-over-column clearance peaks at ~146 u *exactly* at `r = ringR` and falls ~1 u per u of radial offset, so the ring is roomy for a frigate and needs ±7 u precision from a Dreadnought. Every candidate throat is therefore filtered by the flying bot's own `c*`, and the ring is admitted only when `minClr + 20 <= G.ringW`. **Routing a heavy hull into a throat it cannot fly is worse than not routing it.** This is the v36.57 containment-band trap reappearing as a one-way valve on vertical throats.
  - **⚠ Throat clearance is the MINIMUM over the column, never the maximum** — a bore whose widest point is 300 u can still have a 40 u pinch that stalls a hull, and a max-based probe would pass it.
  - **⚠ `floorHole` alone is not enough.** It is the shared oracle for *where a slab is missing*, but it is blind to what grows INTO the hole: on seed 7 one shaft mouth collapses to 82 u under the top-cap stalactites (they root on `inRim`, never on `floorHole`) and one ring sector pinches to 42 u under a pillar rooted just outside the keepout. Both are caught only by the SDF clearance check — the gate reports 11/12 shafts and 22/24 ring sectors flyable.
  - **⚠ The align tolerance is THROAT-RELATIVE and the phase LATCHES.** The first cut used a flat 60 u and measured bots orbiting a 236 u shaft *for the entire run* — engaged, never lined up (350 u/s crosses 60 u in 0.17 s). Now `tol = clamp(0.6 × throat half-width, 90, 170)` and `_arenaThru` latches once inside, because without hysteresis a bot drifting a few units wide mid-descent flips back to ALIGN, climbs back to its own side, and oscillates forever.
  - **Integration:** a new `_arenaVia` local beside `_raceWaypoint`, set LAST in the waypoint chain, sharing `_raceWaypoint`'s steer branch — but it **never writes `aiTarget`**, so the dogfight AI's target survives the transit intact. Guard reads `game.arenaField` through ONE local: ⚠ `bot.update` runs in a bare `for` loop with **no try/catch**, so a throw here freezes every bot, the mesh animation and the whole frame tail — it reads as a total freeze, not a nav bug. Gated on the WORLD (`arenaField`), never on `LSS.MODE`, so slice 5 can put the arena inside endless/campaign without the router silently dying. Retreating bots are skipped (retreat is "get away", not "reach a point"). Zero allocations, zero `Math.random()`, authority-only (bot nav is never on the wire).
  - **Measured live, same build, A/B via `window.__arenaNav`** (5 bots on the top storey, goal in the lava pit three floors down, 30 s): **OFF → 0/5 reached the pit and 0/5 descended even one storey**, with one Frigate grinding against a slab for the full 25 s of an earlier run (containment force 8528). **ON → 3/5 completed the full three-storey descent**, slab-press collapsed to 0.4–1.4 s, and **`rockFrames: 0` for every bot** — they used real openings, never shoved through by the solver. 144 fps, zero console errors. Hourglass no-op verified with the flag forced ON: `arena:false`, `engaged:0`, zero bots carrying router state, 4/5 bots flying normally.
  - **Known residual, honestly:** the two non-arrivals are (a) the DREADNOUGHT, which is marginal on this map *regardless of routing* (`c*` 139 u vs a 146 u ring), and (b) a bot blocked by a **pillar** rather than a slab — the oracle is slab-only by construction, so pillar/spike obstruction falls back to the pre-existing beeline-and-slide every other map already has. **Owner decision pending:** raise `arena.scale` toward ~2.4 (re-run `tools/arena_room_opt_s2.cjs` + `arena_nav_check.cjs`, ~1.7× meshing volume) or drop DREADNOUGHT from the arena bot deal.
  - **⚠ Never write to `game.arenaField.G`** — it is worldSDF's live collision block AND is structure-cloned into the mesh workers, while the mesh cache key is `JSON.stringify(level.arena)`, so a field stuffed onto G would not invalidate the mesh and a divergence would be invisible.
  - **⚠ SLICE-5 TRAP:** if the arena is ever blended into an endless map, `_campHoardTerrainNav` becomes LIVE (its gate fires unconditionally for `LSS.MODE === 'endless'`) and would own `velocity.y` after the speed clamp while this router owns the horizontal target — reproducing the documented v35.15 "hover instead of intercept" bug. Today it is a double no-op on the spire. Resolve ownership of `velocity.y` before both are live.
- **(v36.64) SLICE 5a — CLOUD COLUMNS IN THE SHAFTS** (owner, after rejecting a first waterfall pass: *"i actually don't like the water... instead, maybe a column of clouds just waiting to be disturbed"*). **Jump:** `function _arenaBuildCloudColumns` · `function _arenaCloudTick` (called from gameLoop beside `updateDots`) · `_arenaFallHash` · debug `window.__spireClouds()`.
  - **What it is:** each qualifying shaft bore is packed with a vertical stack of `GasCloud` puffs that hang perfectly still until a ship flies through, then billow aside and slowly settle back. The shafts read as choked with fog rather than as empty holes, and diving one is now visibly an event.
  - **Built entirely on the game's own cloud system** (the owner's "clouds we funnily named dots"): `GasCloud` claims slots in the shared GPU-instanced `billboardCloudSystem` (8192 slots, drift animated in the vertex shader) and already ships the whole disturbance API — `applyWake(src, vel, strength, radius, dt)` for the push and `tickWake(dt)` for relax-and-settle. **Nothing new had to be invented**; `_arenaCloudTick` is just the driver nothing else provided (only `_fireEatClouds` drove wake before, and only for fire).
  - **⚠ WAKE STRENGTH HAS TO BE BIG — 1.5 is invisible.** `applyWake`'s drag term is `0.30 * atten * strength * dt` applied to the SHIP'S VELOCITY, so at strength 1.5 and 144 fps a 350 u/s pass displaces a sprite ~1 u per frame — against a 280 u sprite that is nothing, which is exactly the owner's report (*"they kinda just stayed in the column... they should get blown around"*). A ship is only inside the radius for a handful of frames, so the per-frame push must be large. `_AR_CLOUD_WAKE_STR = 14`: measured peak displacement **54.7 u -> 175.5 u** on the same dive, now comparable to the sprite size, still settling smoothly (175 -> 145 -> 102 -> 72 -> 51 -> 36 -> 25 -> 18 -> 12 -> 9).
  - **⚠ Distance-gate BEFORE ticking.** `tickWake` writes every slot, so a column nobody is near must cost one distance test, not 16 slot writes. Ships are gathered once per frame, not per cloud; a settled cloud is skipped entirely via `_wantSlotWrite()`.
  - **⚠ The clouds are NOT children of the arena group.** They hold slots in a shared system, so `_arenaDisposeMesh` releases `_arenaMesh.clouds` explicitly or the slots leak for the page lifetime.
  - **PER-LAYER COLOUR** (owner: *"each layer should have its colors of clouds to correspond"*): the tint comes from the SAME `G.themes` palette the rock is shaded with, so a column always matches its storey.
  - **⚠ SATURATE, NEVER LIFT TOWARD WHITE — the billboard cloud system renders ADDITIVE.** `game.cloudBlend` defaults to `'additive'` (every `MAP_PRESETS` entry sets it, brightness 0.7-1.1), and additive blending only shows a HUE when the channels DIFFER: a colour lifted toward white has near-equal channels and saturates the framebuffer to pure white. The first cut lifted 62% toward white and the owner's report was exactly that — *"all them are white"*. The fix normalises each theme to full chroma (max channel = 1, hue preserved) then pushes saturation 1.45x past it, and drops alpha 0.66 → 0.52. Resulting chroma (max−min channel): ember `#ff6b24` 0.86 · bronze `#ffc953` 0.68 · mystical `#5cebd1` 0.56 · snow `#cae5ff` 0.21 (snow is inherently low-chroma and correct). Same family as the v35.92 monster lesson: *additive washes a textured body into a shapeless glow*.
  - **Tuning, measured at seed 7:** gate 0.95 / fill 0.72 of the bore / step `rad*0.52` / 16 segments / alpha 0.66 → **8 columns, 62 puffs, 992 of 8192 slots**. Wider fill rejects bores (the rim-graze rule below), a tighter gate leaves whole storeys empty. Owner's first pass was "not thick/bright/plentiful enough" at alpha 0.30 / 10 segments / gate 0.75.
  - **⚠ The two-threshold clearance rule is inherited from the water pass and still load-bearing:** the column AXIS must be properly open (`< -60`) but the RIM is allowed to GRAZE rock (`<= 0`), because demanding real clearance at the rim contradicts filling the bore and rejected nearly every shaft (measured: rim `< -40` gave 1-2 columns at ANY width; rim `<= 0` gives 6-8).
  - **Verified live:** 62 puffs / 992 slots at rest with `disturbed: 0`; a ship dived through a column → **6 puffs disturbed, max wake offset 54.7 u**, then relaxing 54.7 → 42 → 30 → 22 → 16 and back to **exactly 0** once clear. 144 fps, zero console errors.
  - **⚠ The rejected water pass (v36.63) is gone**, but its two traps are worth remembering if anything similar is built: three.js `CylinderGeometry` puts **v = 0 at the BOTTOM**, so the obvious scroll term runs a falling texture UPWARD; and a fall/column needs a visible SOURCE or it reads as materialising in mid-air.
- **(v36.64) THE MYSTICAL STOREY RETUNED OFF THE NEON-GRAPE PALETTE** (owner: *"i think we should tweak the colors of the mushroom level, it looks tacky"*). The clash was a lurid yellow-green rock carrying a saturated purple glow — two loud complementary hues fighting. Now a **deeper blue-shifted moss** under **aqua bioluminescence**: theme `[0.19,0.33,0.17] -> [0.15,0.27,0.24]`, the material's mystical-band emissive tint `vec3(0.62,0.40,1.0) violet -> vec3(0.40,0.90,0.80) aqua` at boost `0.95 -> 0.72`, the shader's fungal spot strength `0.55 -> 0.42`, and the mushrooms themselves from `color 0x4a2f6e / emissive 0x8a55ff @ 1.1` to `color 0x2f5f58 / emissive 0x5fd8c2 @ 0.72` — a deep teal body under a soft mint glow. The storey's cloud columns carry the same aqua, so rock, mushrooms, glow and fog finally agree.

- **(v36.65) MINERAL FLECKS + RED LAVA CLOUDS** (owner: *"purple amethyst flecks in the walls on the mystical level.. yellow/gold flecks on the bronze layer / red clouds on the lava level"*). **Jump:** `_arFleck` + the fleck block in `_arenaMakeMaterial`'s fragment shader · `m._uBronzeLo/_uBronzeHi`.
  - **⚠ Flecks are PER-FRAGMENT from world position, never per-vertex.** Mesh vertices are ~25 u apart, so a vertex-colour fleck is a 25 u blotch, not a speck. A cell hash at ~3-4 u in the fragment shader gives real mineral glints. `vAWP` (object-space position; identity matrices make it world space) joins the existing `vAWy` varying.
  - **⚠ RARITY IS THE WHOLE LOOK.** The first cut thresholded at `smoothstep(0.982, …)` — ~1.8% of cells over two octaves — and read as **dense magenta confetti covering the walls**. A fleck is a GLINT: the shipped threshold is `smoothstep(0.9968, 0.9998, …)`, measured at **0.15% of cells** (a 12x reduction), with emissive strength dropped 1.5 → 0.85. If flecks ever look like a rash again, this number is why.
  - Amethyst `vec3(0.46,0.12,1.0)` in the mystical band only, gold `vec3(1.0,0.72,0.10)` in the bronze band only — each gated to its own storey's y range, so the snow and lava storeys stay clean (verified: the snow storey renders fleck-free).
  - Lava-band cloud columns pushed from ember-orange to **RED** `#ff2110` — additive blending drifts warm colours toward orange over the already-warm rock, so the source colour has to be further into red than the target look.
- **(v36.60) SLICE-5 DESIGN CAPTURED in `arena_port_plan.md`** — the owner's connection concept, three pieces: endless two-plane caverns entering the spiral at one end and exiting the other ("continuous endless path"); the spire as the overworld→cavern connector ("holes that go down") with a near-term staged-swap rung and a full SDF-blend rung; waterfalls falling shaft-to-shaft. Read the plan's Slice 5 before starting any of it.

#### Level collision & raycast — `~L22495`
**Jump:** `function worldSDF` (~L22496) · `function resolveCollision` (~L22629)
- **Symbols:** `worldSDF` (3-arg main copy #3), `sdfNormal`, `sdfRaycast`, `checkBoxCollision`, `resolveCollision`, `resolveShipShipCollisions`, `raycastLevel`, `getWallNormal`
- **⚠** This 3-arg `worldSDF` differs from the terrain-copy signatures — same name, different args.
- **(v36.56)** First branch after the gmaps short-circuit is now the volumetric-arena field (`game.arenaField`) — see The Spire entry above. Arena maps leave `sandwichTerrain` null, so exactly one world type owns collision.

### ═══ PART 8 — Water & ripple sim (~17969–18891, 19511–20355) ═══

#### Forcefield + water reflection shader + ripple simulation — `~L17969`
**Jump:** `function _swWaterReflectShader` (~L18015) · `function _swRippleTick` (~L18577)
- **Symbols:** `_ensureBrokenSimForcefield`, `_swWaterReflectShader`, `_swRipple`, `_swRippleInit`, `_swSpawnSplash`, `_swCrestSpray`, `_swShipFootprint`, `_swRippleTick`; `window.__crestTest`
- **⚠** Ripple grid 128² / 4000u; far-mask 24000u — perf-sensitive.

#### Hub water surface, underwater & terrain reset — `~L19511`
**Jump:** `function _swBuildHubWater` (~L19650) · `function _swUpdateHubWater` (~L20125)
- **Symbols:** `_swBuildHubWater`, `_swBuildHubWaterOverlay`, `_swUpdateHubWater`, `_swUpdateUnderwater`, `resetSandwichTerrain`; `window.__refl`, `window.__waterHorizon`, `window.__reflBench`, `window.__pwaterApply`, `window.__foliageProf`, `window.__reflProbe`
- **⚠ THE VISIBLE WATER ON FLATSCREEN IS NOT THE `Reflector`.** `window.__waterDisp` **defaults to 1** (`if (window.__waterDisp === undefined) window.__waterDisp = 1`), so `_hubWaterDisp` — the v33.69 VTF-displaced `PlaneGeometry(24576, 768, 768)` built by `_swBuildHubWaterDispGet` — is what you actually see. The flat `THREE.Reflector` stays in the render list with **`colorWrite = false`** purely so its planar-mirror RT keeps refreshing for the disp mesh to sample. `_swBuildHubWaterOverlay` is dead (an unconditional `return null` on its second line). Anything that "fixes the water" has to be applied to BOTH shaders.
- **⚠ (v36.42) NEVER LET A WATER SURFACE INTO THE REFLECTION PASS.** three's Reflector hides *itself* (`scope.visible = false`) — `_hubWaterDisp` is a separate object and was still in the reflection render list, which is two bugs at once: (1) **texture feedback** — its `tDiffuse` *is* that render target, so it painted the previous reflection back into the new one; (2) a **horizontal sheet** across the mirror, because the virtual camera is under the water looking up. Live at the hub lake this is what the owner saw: the "white clouds on the lake" were the lake reflecting **itself** reflecting the sky, and no terrain/rainbow/ship reflected at all. The `onBeforeRender` wrapper in `_swBuildHubWater` now hides `_hubWaterDisp` / `_hubWaterOverlay` / `_hubWaterUnder` for the pass and restores them in the `finally`. Safe because the MAIN render list was already built by `projectObject` before any of these draws, so toggling `visible` mid-draw can never hide them from the main pass. Measured at the city stand-off: reflection pass **2,715,241 → 1,532,644 triangles** and **97 → 95 draws**, GPU **0.76 → 0.62 ms**.
- **⚠ (v36.42) `textureMatrix` BAKES `scope.matrixWorld`, AND THIS PLANE MOVES EVERY FRAME.** `_swUpdateHubWater` re-centres the water on the camera each frame while the reflection RT refreshes on a throttle, so `textureMatrix * position` (object space) and the old `textureMatrix * inverse(matrixWorld_now)` were both mixing a matrix from the last render with a model matrix from *this* frame — the reflection slid by exactly the camera's travel since the last update and snapped back on every refresh (measured up to **18 RT px ≈ 57 screen px at 864 u/s**). Fixed by capturing `mesh._reflWorld = textureMatrix * inverse(matrixWorld)` **inside the wrapper, at render time**, and sampling from WORLD space in both shaders (`uReflWorld`/`uReflWorldOn` on the flat one, `uReflMatrix` fed from `_reflWorld` on the disp one). Now cadence- and draw-order-independent. The capture is gated on the same `view.dot(normal) <= 0` test three uses, because the Reflector **bails when the camera is behind the plane** (submerged) leaving BOTH the RT and `textureMatrix` stale — re-deriving from a fresh `matrixWorld` there is the original bug. `w._invMW` is gone.
- **(v36.42) The reflector throttle is now MOVEMENT-AWARE, not a flat 1-in-3.** `mesh._reflGap` counts frames since the last real refresh; refresh when `gap >= reflGapMax` (3, the shipped cadence) or when `gap >= reflGapMin` (2, a hard cost ceiling) **and** the eye moved > `reflMove` (6u) or turned > `reflTurn` (3e-5 on `1-|dot(q,q')|` ≈ 1.0°). Eye TRANSLATION is what moves a planar reflection (the mirrored image at a surface point depends on eye position, not gaze); eye ROTATION is what walks water off the edge of an RT that only ever covered the frustum it was rendered for. Measured cadence: parked/slow **0.333** (identical to v36.41), aiming ≤33°/s **0.333**, 864 u/s or ≥83°/s **0.5**. Cost at the city: **0.206 ms/frame parked (was 0.254)**, **0.377 ms/frame in flight (was 0.296)** = +1.2% of the 6.94 ms budget for a **3.5× cut in near-field reflection lag** (36.5 → 10.6 RT px at 864 u/s). All four knobs live on `window.__water`; `reflGapMin = reflGapMax = 3` restores the exact v36.41 cadence for an A/B.
- **`window.__reflProbe([frames])`** — the eyeball-free correctness check. Rebuilds three's Reflector math for the CURRENT camera and reports, in reflection-RT pixels: `mismatchPx` (live sampling matrix vs the matrix that MATCHES the RT contents — **must be 0**, it is the v36.42 bug) and `stalePx` (matched vs ideal — the honest, by-design residual of the throttle). 30 s of continuous varied motion over the lake: 4281 frames, 1884 refreshes, **worst `mismatchPx` 0.00**.
- **Secondary, NOT fixed (documented):** the sky is pinned to the MAIN camera every frame (`_skyDome.onBeforeRender` writes `camera.position`; `_wxFrame` writes `_WX.dome/sunDisc/sunHalo/bow` + the cloud `uCam`), so inside the reflection pass it is off-centre by `2 * (camY - WL)` relative to the virtual camera — the reflected sky carries parallax an infinitely-distant sky should not have (~1.8° at 330u above the water, ~17° at 3000u). A/B'd live at 2620u up by shifting the dome + cloud `uCam` down by `2h` for the pass: visibly present in the RT, but **not** visible in the water at any realistic altitude, so it was left alone rather than reach into the weather system mid-render. Also pre-existing: the oblique clip plane blacks out the part of the RT below the water plane (that is what the shader's "grazing black-out guard" exists for), and `reflShipMax` 2500 pops the ship out of the mirror at exactly 2500u above WL.

### ═══ PART 9 — Critters: birds & fish (~18892–19510) ═══

#### GPU critters: birds/boids + fish schools — `~L18892`
**Jump:** `function _boidsVelFrag` (~L18943) · `const _birdFlock = {` (~L19034) · `function _fishSchoolInit` (~L19370)
GPUComputationRenderer flocking — bird/boid FBO passes + fish schools.
- **Symbols:** `_critterTerrainBake`, `_boidsVelFrag`, `_birdFlock`, `_birdFlockInit`/`_birdFlockTick`, `_fishSchool`, `_fishSchoolInit`/`_fishSchoolTick`; `window.__birds` (~L19038), `window.__fish`
- **⚠** MSAA-sensitive — renderer must keep `antialias:true`; flock rehomes on camera-chunk change.

### ═══ PART 10 — Hub city & weather (~20356–22014) ═══

#### Hub city procedural generation — `~L20356`
**Jump:** `const HUB_CITY = {` · `function _hubCityBuild` (~L20408)
Instanced towers/dishes/holos, air-traffic ships (OBB avoidance), collision + raycast.
- **Symbols:** `HUB_CITY`, `_hubCityBuild`, `_hcInstMesh`, `_hcTowerMat`, `_hcTrafficInit`/`_hcTrafficUpdate`, `_hubCityCollide`, `_hubCityRayHit`, `_hubCityFrame`
- **⚠ (v35.65) TRAFFIC = a real enemy fleet, not scenery.** `_HC_TRAF_CLASSES` (HAULER / FREIGHTER / COURIER / ESCORT / GUNSHIP) is picked per ship by `_hcTrafClass(i)` off a seeded hash, so a city seed always produces the same fleet. Class drives hp, flightSpeed, mesh+hull scale, bolt damage/rate/speed/burst/lead, and the HUD callout name. Health and speed jitter in OPPOSITE directions (`_jit` / `1.82 - _jit`) so tanky implies slow.
  - **⚠ Class scale MUST multiply the clone's existing scale, never assign it.** `loadHoardModel` normalises every GLB with `proto.scale.setScalar(140 / longest)` — roughly **73x** for these models — and `proto.clone(true)` carries it. v35.65 wrote `cl.scale.setScalar(_sc)`, throwing that away and leaving hulls 1-2 world units across: invisible. FREIGHTER was the only class that survived, purely because its scale is exactly 1 and the `if (_sc !== 1)` guard skipped it — which is why roughly a quarter of the traffic still showed and the rest vanished. Fixed in v35.66 with `multiplyScalar`. Measured after: 0 of 26 under 10u, range 62-171u.
  - **(v35.66) `HOARD_SHIPS` must match `objects/hoard/`.** `stryder.glb` had been on disk and absent from the list, so nothing could ever spawn it; the list is now 22. Traffic draws `modelCount` = 14 distinct models on desktop / 6 on mobile-Quest (was 6 flat) via stride 5, which is coprime with 22 so the picks stay distinct. Failed loads are filtered out BEFORE the `i % length` pick — letting a null through used to `continue` and silently cost that pad its ship for the session.
  - **The "freighters don't explode" bug was `spawnExplosion(pos, 2.0)`** — that arg is a SIZE and it defaults to 20; every other ship death passes `chassis.hullLength` (~150). A size-2 burst on a 150u hull is invisible. Now hullLength + two 0.55x secondaries along the hull axis (3 total, which is inside spawnExplosion's 4-per-frame full-burst budget).
  - **⚠ Traffic sits on `team: 9100 + i`, which is never the player's team — so any `b.team !== player.team` test counts a calm freighter as an enemy.** That is what made "Warning. Multiple ships engaging." fire at ships flying past: the engagement counter in the `game.state === 'playing'` tick (search `_v8nearEnemies`) found 3+ inside its 1800u bubble constantly once ~21 ships were airborne. Fixed v35.67 by requiring `!(b.isHubTraffic && !b.aggro)` — traffic only counts once it has been shot. **Any new "nearby enemy" logic needs the same guard**; grep `team !== player.team` before adding one.
  - **Ramming:** traffic is excluded from `resolveShipShipCollisions` (parked hulls sit closer than two hull-widths and the symmetric pass bled them dry), so ram damage lives in `_hcTrafficRamPass`, called at the END of `_hcTrafficUpdate` once `_HC_TRAF.obbs` is rebuilt. PLAYER-ONLY and one-sided, gated on >80 closing speed with a 0.22s per-ship contact cooldown — that gate is what keeps the old parked-bleed bug from returning. `ent.takeDamage` now RETURNS the applied (health-clamped) damage so the credit is honest.
  - **⚠ The park-pad seeder only ever tested candidates against `solids` (buildings) — never against other PADS.** Harmless at 10 pads / 60 darts, but v35.65 raised it to 26 / 160 and the landing rings started stacking on each other. v35.67 adds two more rejections: vs every existing pad (`PAD_R + p.r + 90`, so natural pads count too) and vs the other seeded pads at `PLAZA_R * 2` (each seeded pad drops a 320u plaza decal that is wider than its 200u disc, so clearing the discs alone still merges the ground patches). Darts raised 160 -> 420 because rejection sampling needs more as the annulus fills; falling short just means fewer ships. Measured: 300-trial A/B gave **97% of layouts with overlapping rings before, 0 attributable after** (the only residual overlaps are natural-vs-natural pads the district pass placed, which this rule cannot move), and the live generator across 10 seeds gives 0/528 pairs with 26 park pads every time.
  - **Air-street population:** three coupled knobs, all needed. (1) the park-pad guarantee in `_hubCityBuild` (`have < 26`, was 10) — this was the real ceiling, `maxShips` could not exceed the pads that existed; (2) `maxShips` 34/16; (3) the `_hcPadSched` phase split, now ~74% airborne / 18% parked / 8% absent (was 42/36/22). Cruise altitude dropped 5600 -> 2100-3300 above **pad.y** so traffic flies through the skyline instead of over it — **2100 is a floor, the hero crown tops out near +1600.** Measured: 21 of 26 airborne at 144 fps.
- **(v35.13) Grounding pass:** `_hcTowerMat` facades get an irregular ground-contact grime band (`baseAO` over the bottom 60–150u, per-column noise) + vertical weather streaks + whole-floor window-lit clustering (~1 in 4 floors dark); the ground ALBEDO canvas gets multiply-blended contact-shadow pools under every grounded solid (skips `y0 > padY+60` skybridges). All three target the "buildings look fake / base too clean" read.
- **⚠ (v36.02) Window/holo hash inputs are ULP-QUANTIZED — keep them that way.** Community "buildings are glitching out" root cause: `hcRnd` (`vHcP.y`) and `fc` (`dot(vHcN, …)`) are INTERPOLATED varyings, so their last mantissa bits wobble with every camera-matrix change, and `hcH21` multiplies them into the ~1e5 range where `fract()` amplifies one ULP into a full hash flip — whole windows popped on/off every frame in motion (measured pre-fix: a 1e-7 rad camera yaw flipped 134,640 px ≈ 12.3% of the frame; worse on GPUs with sloppier interpolators). Fix: `hcRnd = floor(hcRnd*4096.0+0.5)/4096.0` at the top of the `_hcTowerMat` block, `fc = floor(dot(...)+0.5)` (box normals are exact ±axes so fc is exactly ±2/3/5), and the same 1/4096 snap for `vRnd` in `_hcHoloMat` (its raw uses also flipped ROW/COL counts per frame). Post-fix: 14 flipped px on the same probe (~2,400×). **Any NEW hash fed by a varying in these shaders must snap the varying first.** Instance matrices audited clean (0 NaN / 0 zero-scale across all 8 layers); pad rings / ground disc / clipmap seam probed stable (coplanar tower-stage joints are backface-culled by design — benign).
- **(v36.07-08) FAR-RANGE CITY FLICKER CLOSED (the "genuine high-frequency window aliasing" the v36.02 entry left open; owner: "look at the city from far and look around — the city lights flicker").** **Jump:** `float hcLodW` in `_hcTowerMat` · `float hcPx` in `_hcNeonMat` · `float hLod` in `_hcHoloMat` · `window.__hcLod` in `_hcMakeMeshes`. Three fwidth-driven LOD paths, all gated by the shared `uHcLodOn` uniform — live kill-switch `__hcLod(0|1)` gives bit-exact pre-LOD shaders for in-session A/B (cross-session flicker numbers are NOT comparable: weather/day-cycle scene drift measured 2715-vs-4237 px on the same build 20 min apart). (1) TOWER WINDOWS: `hcLodW = smoothstep(0.5, 1.4, max(fwidth(uu)/cw, fwidth(vv)/chh))` cross-fades the per-window mask to a per-tower aggregate glow that is the exact EXPECTATION of the window branch (winArea × avgLit(hcRnd) × 1.175 mean brightness × sunDim) — uniform per face, cannot twinkle, preserves skyline energy (meanLum 94→97). **⚠ Ramp is in CELLS-PER-PIXEL (fov-independent): 0.5 = cell renders 2px (Nyquist), 1.4 = cell 0.71px.** v36.07 shipped (0.35, 1.1) and at the flight fov of 120 that starts fading at ~1.6-2k and WASHES 2.5-4k towers (windows still 1.6-3px) into flat glow slabs — caught at street level v36.08. Also tried (0.35, 0.65): worse mid wash, ZERO far gain — **at 15-20k the fade is saturated under any of these ramps (~2.4-3.5 cells/px), so far tuning lives in the neon, not here.** (2) NEON STRIPS — this was the actual residual far flicker: isolation probe (hiding the two neon layers) collapsed far repeated-blink px 1441→163 while windows-faded towers contributed ~nothing. The 2-6u strips are subpixel from ~10k; vertex shader widens any subpixel instance axis up to a 2-PIXEL world footprint (v36.07 used 1px — a 1px additive quad still pops between MSAA coverage levels; 2px recovers most of the remaining gap: ev5 325→171) and dims by the widen ratio (`vHcDim`, energy-conserving). Clamp floor 1.0 = near/mid strips (>2px) byte-identical. Residual ~900 px of 24-48-lum pops is real depth-occlusion aliasing at tower silhouettes (depthTest-off probe: ev3 307) — irreducible without supersampling, left alone. (3) HOLO glyphs fade to their means past subpixel (panel flick/scroll kept — deliberate behaviour, not aliasing). **Measured (16.5k vantage, 21-frame 0.0005-rad rotation sweep, 560×170 city rect, per-px luminance blink events >24, in-session A/B, twice each):** repeated blinkers (≥3 events) 2104→1193 (−43%), rapid (≥5) 848→176 (−79%), high-amplitude repeaters (≥3 events >48 lum) 663→95 (−86%), total events 15427→11569. v36.02 micro-rotation invariant intact: 1e-7-rad city-rect flips ≈ zero-delta noise floor in BOTH lod states. Perf: GPU-synced frame-time A/B 6.1-6.4 ms both states (interleaved ×3), 144 fps far/street, zero console errors. **⚠ Measurement traps for future probes:** (a) a one-frame GLOBAL relight transient (mean Δ131 lum, ~880k px) fires sporadically on the first frame after a camera write and latches — it is lod-INDEPENDENT (fired under lod0 and lod1 alike, JS-visible light/fog/exposure state unchanged) and pre-existing; use ≥3-event blink metrics (immune to one-offs) and settle 2 frames after every camera move; (b) an exact-π/4 yaw sits on a knife-edge of that global state (symmetric vantage math lands there — offset the probe bearing); (c) the chase-cam position lags euler writes by one frame (~10k px parallax between "identical" frames).
- **(v36.28) THE ZONE RIFT NAMES ITS GARRISON AT ENTRY, NOT AT SPAWN.** `_hzEnterCavern` now stashes `game._cavern._picks` (genome + `_campWaveShips(3)`) so `_rrStagedSwap` can parse and GPU-prime exactly those hulls behind the loading overlay; `_hzSpawnCavernBots` consumes `_picks` when present and is otherwise unchanged, so the doctrine, the count, the positions and the spawn MOMENT are all identical. **The same prime also covers `_hzGuardsFrame`'s rift-guard flights** (measured 8.8 ms at spawn), which have no loading cover of their own and are therefore only ever safe because the hub launch primes the whole `HOARD_SHIPS` pool. Full entry: **PART 13 → "(v36.28) ENTITY PRIME"**.
- **(v36.02) Zone-rift cavern "black void" DIAGNOSED — CLOSED v36.03 by the ship headlight.** **Jump:** `const _HZ_CAVERN` · `function _hzPortalsFrame`. Inside the shifting_deep caverns the CEILING + upper walls read as a black void (volcanic up-view: 39% of pixels < lum 8/255, 72% < 16; rocky apex same). Geometry is present and lights correctly (ambient 20/white → avgLum 179, zero holes): the surfaces are genuinely unlit — sun points down (down-facing normals get no directional), hemi gives them only its ground term, and the arena-mood ambient is deep blue 0x2a3a90, near-orthogonal to warm rock albedo (2× blue ambient: avgLum 17→19.4; SAME-intensity warm-gray 0x6a5a50: →21.3; 1.5× warm-gray: →26.5). **v36.03: the under-hull headlight (PART 13 SHIP LIGHTS) now paints wherever the player looks — measured at the same void vantage: beam footprint avgLum 13→33.5, px<16/255 68%→45%.** If a minimum-ambient floor is ever tuned on top, shift the TINT warm rather than raising the blue. Note the sandwich shells take three.js lights fine (MeshStandard, flatShading, no normal attribute — derivative normals).

#### Weather system — `~L21583`
**Jump:** `const _WX = {` · `function _wxInit` (~L21922)
Sky dome, sun, volumetric clouds, rainbow, day-lighting env, toggleable shadows.
- **Symbols:** `_WX`, `_WX_SHADOW_EXT`, `_wxMakeDome`, `_wxMakeSun`, `_wxMakeClouds`, `_wxMakeBow`, `_wxShadowsOn`/`_wxShadowsOff`, `_wxBuildTerrProxy`/`_wxUpdateTerrProxy`, `_wxInit`/`_wxFrame`
- **⚠** The sky dome's below-horizon blend + cloud edge falloff were tuned in v34.60–62; shadows here drive the 2048² shadow map.
- **⚠ (v36.23) `_wxInit` FORKS EVERY PBR PROGRAM IN THE SCENE, twice over.** `scene.environment = _wxMakeDayEnv()` installs a PMREM of a 64×32 equirect — **cubeUV height 64**, where the base procedural/HDR env is **1024** — and `_wxShadowsOn()` can flip `renderer.shadowMap`. Both are terms of three.js' program cache key, so every `MeshStandard`/`Physical` material in the scene now wants a program it has never linked, and left alone they link lazily one at a time inside whichever gameplay frame first draws each object (measured: the 99,268-char cyanring program, 188.5 ms of blocking `getProgramInfoLog`, in open play). That is why `_wxInit` ends with a `_pinCombatEffectPrograms()` call — see PART 13's v36.23 entry. **If you change the day-env resolution, or add another `scene.environment` writer, it needs the same treatment.**
- **⚠ (v35.13) Shadow stability invariants:** (1) the ortho window is TEXEL-SNAPPED in `_wxFrame` — the target moves in whole shadow-texel steps in the light's plane (raw per-frame follow made every shadow edge shimmer = "flickering corners"); (2) the terrain shadow proxy re-bakes on its OWN fixed world lattice (`(2*_WX_SHADOW_EXT)/_WX_PROXY_N` cells) — recentering on raw player position made the whole mountain-shadow field morph every ~120u of travel; (3) window half-extent lives in `_WX_SHADOW_EXT` (6800, was 4200 — shadows "loaded in too close") and normalBias (4.8) scales with texel size. Keep all three coupled when retuning. Live knob: `__shadowExt(u)`.
- **⚠ (v35.14) Proxy rebake is INCREMENTAL:** on a cell crossing `_wxUpdateTerrProxy` SHIFTS the stored lattice heights by the cell delta and samples only the newly exposed rows/cols (~R calls); the full (N+1)² `_stGroundYCarved` resample (~11k calls, a rhythmic per-130u hub hitch = "stuttering") runs only on first show or a >N/4-cell jump. The shift copy is verified bit-exact. Don't turn this back into a full resample.

### ═══ PART 11 — Ship models & FX (~23094–24484) ═══

#### Ship models: loading, mesh build, preview & FX textures — `~L23094`
**Jump:** `function buildModelShipMesh` (~L23670) · `function createShipMesh` (~L23981)
- **Symbols:** `SHIP_MODELS`, `shipModelCache`, `preloadShipModels`, `bakeShipThumbnails`, `shipMuzzleWorld`, `buildModelShipMesh`, `createShipMesh`

#### SHIP SKINS — data-driven hull liveries (v36.31; colour model fixed v36.35; **PATTERN/CAMO layer v36.37**) — table `~L4305`, apply `~L29700`
**Jump:** `const SHIP_SKINS` (PART 0, beside `PILOT_PERKS`/`LOADOUTS`) · `function _applyShipSkin` · `function _shipSkinHullMats` · `function _shipSkinDef` · `const _SKIN_HUE_PARS` / `_SKIN_PAT_VERT` / `_SKIN_PAT_ID` · `function _skinPatchHueShader` · `function _skinBakePatternSpace` · `function _renderSkinPicker` (PART 18) · console `window.__skinProbe()` / `window.__skinTune()`
7 liveries × every hull, with **no new assets**. A skin is a table of `MeshStandardMaterial` parameters, which is cheap here because `buildModelShipMesh` already rebuilds every hull material from scratch and copies only the GLB's `map` — so the whole feature is a few uniform writes at mesh-build time.
- **ONE apply path.** `_applyShipSkin(root, skinId)` is the only thing that writes hull params, and it is called from exactly three places: the end of **`buildModelShipMesh`** (covers in-world player, third person, bots, peers and the GLB swap-in), **`_applyShipPreviewModel`** (the rotating ship-select hero), and **`setShipPreviewSkin`** (live re-skin on a picker click, no rebuild — the hero keeps its dolly and dragged yaw).
- **Threading.** `createShipMesh(chassis, teamColor, loadoutKey, skinId)` and `buildModelShipMesh(..., skinId)` take an OPTIONAL 4th arg; `swapToModelMeshWhenReady` reads `owner.skinId`. `commitLoadout` sets `player.skinId = _getStoredSkinId()` **before** building. Omitted / unknown / stale ids all resolve to FACTORY inside `_shipSkinDef`, so bots, hub-city traffic and the warmup ghosts stay stock by simply not passing one, and nothing can throw.
- **⚠ HULL ONLY — never the FX.** `_shipSkinHullMats` prefers `group.userData.hullMats` (the opaque list `buildModelShipMesh` already publishes and `animateShipMesh` dims on the doomed state) and otherwise falls back to the same test that built it: an OPAQUE `MeshStandardMaterial`. Engine discs/plumes are ShaderMaterial, panel glow + running lights are MeshBasicMaterial, the shield is a ShaderMaterial on a mesh named `shield` — all fail `isMeshStandardMaterial`. Cloak/damage/emissive FX are untouched.
- **⚠ `bakeShipThumbnails` IS DELIBERATELY NOT ON THE APPLY LIST.** Its clones **share materials with the cached GLB prototype** (see the v32.14 leak-fix note in that function). Skinning there would mutate the prototype and poison every ship built afterwards, of every skin, for the rest of the session.
- **⚠ FACTORY RESTORES A SNAPSHOT, it does not re-specify numbers.** The first time a material is skinned, `_applyShipSkin` stashes `userData._skinBase` (color/emissive/emissiveIntensity/metalness/roughness/envMapIntensity). The in-world build and the preview clone have **different** baselines (normalized `0.20/0.60` + team-tint emissive vs. the authored glTF values + the `0x121a26 @0.45` dark-plate lift), and `restore: true` is what makes FACTORY pixel-identical to pre-v36.31 on both without either hard-coding the other.
- **⚠ `_dimHullMat` LATCHES.** The doomed-state dimmer caches `_baseHullColor`/`_baseEmissiveI` on its first call and then writes `base*dim` every frame — a skin applied after it latched is stomped back on the next frame. `_applyShipSkin` therefore DELETES that latch so it re-snapshots the freshly skinned values.
- **Non-factory skins pin `emissiveIntensity = 1` and ADD their emissive to the factory term**, so the faint team-color hint (in game) and the dark-plate lift (in the preview) both survive, and the table value is the final value. **Keep every skin's emissive non-zero** — it is the readability floor that stops a dark livery from vanishing into the cavern black.
- **(v36.32) Hue rotation rides a shader patch.** `_skinPatchHueShader(m)` adds an `onBeforeCompile` that rotates hue/saturation **after `<map_fragment>`** (i.e. on the sampled texture, not just the flat material color) driven by `uSkinHue`/`uSkinSat`, so table entries are `hue`/`sat`/`mul` rather than a flat tint. It declares a **constant** `customProgramCacheKey` (`'lssSkinHue|'`) and is applied to every hull material including FACTORY's, so all ship hulls — warmup ghosts included — share ONE program variant and the warm/live keys still match (critical rule 5). It does set `m.needsUpdate` once per material, which the base-path comment right below it still says not to do; the program cache absorbs it after the first compile.
  - **(v36.35) THE ONE-PROGRAM CLAIM IS NOW MEASURED, not argued.** In a live match, `renderer.info.programs` held **129 programs, 3 of them `lssSkinHue`** — and cycling all 7 liveries onto the in-world player ship (9 applications) left it at **129 / 3, unchanged**. Skin identity does not fork a program; the 3 variants are the ordinary hull lighting/shadow permutations that exist with or without the patch, because the constant key prefix re-labels every hull bucket without re-partitioning it. Frame time was identical skinned vs factory (**16.8 vs 16.9 ms median**, max 27–32 ms) with no spike across a live swap.
- **⚠⚠ (v36.35) `sat` IS AN ABSOLUTE TARGET, NOT A MULTIPLIER — and `lift` exists because hue+sat alone cannot colour these hulls.** This is the fix that made the named liveries actually render as their names; v36.32's model did not. Two independent reasons, both measured by sampling rendered hull pixels off the ship-select hero:
  1. **The albedo is near-greyscale.** All the colour on a factory ship is the blue key light, not the texture — so texture-sat is ~0.01–0.03 and `sat = texSat * uSkinSat` with any multiplier ≤ 1 leaves it at ~0. Shipped SIGNAL ORANGE (`sat 0.72`) measured **hue 218 / sat 0.151 on BLASTER — bluer and flatter than FACTORY** (210 / 0.222). It took `uSkinSat ≈ 20` to reach orange. Now `sat = mix(texSat, uSkinSat, mixAmt)`.
  2. **The albedo is near-black on 4 of 7 hulls.** VORTEX / PYRO / SLAYER / TRACKER render so dark that `val ≈ 0` makes *every* hue black, and what you actually see is specular + IBL, which this function never touches — so even a 20× saturation failed outright on them. `uSkinLift` raises the albedo **black point** (`val = mix(val, lift + val*(1-lift), mixAmt)`, a standard levels lift: white stays white, only darks move). That is why the loud liveries carry a big `lift` (signal `0.60`, copper `0.55`) and VOLCANIC BLACK carries almost none (`0.13`).
  - **Both are gated by `mixAmt` (= `hueMix`), which FACTORY leaves at 0** — so factory remains an exact passthrough of the snapshot and neither dial can touch it.
  - **⚠ A near-mirror metal just reflects the blue IBL.** COPPER was the worst offender, rendering **purple (hue 263)** at `metalness 0.85 / env 0.62`. Metalness and envMapIntensity had to come DOWN (0.45 / 0.25) and lift/sat UP before the copper hue was what you actually see. If a livery reads as "the environment" rather than itself, that is the dial to check first.
  - **Result, all 49 combos:** copper **hue 29 ±2° across all 7 hulls**, signal **36 ±2°**, void **252 ±9°**, chrome **218 ±3°**. Before the fix, signal's per-hull hues were 240/223/26/240/240/17/330 — a **223° spread**. ⚠ For BONE (rendered sat ~0) and VOLCANIC (~0.2) the hue *metric* is unstable noise — judge those two by eye, not by the number.
- **⚠⚠ (v36.37) PATTERNS — and why the hue model had to be replaced, not tuned further.** Owner: *"the theme colors are not great … bone is the only ok one … maybe camo shaders would have been better."* Correct, and v36.35's own verification is the proof: the albedo is **near-greyscale** (texture sat 0.01–0.03) and **near-black on 4 of 7 hulls**. A hue/sat/lift model owns nothing but a remap of art that carries almost no colour and, on half the roster, almost no value — so its ceiling is a flat wash, which is what shipped. A **pattern brings its own colour AND its own value structure**, so it does not depend on the art's chroma at all. The albedo is demoted from "the thing being tinted" to "the shading term the camo is multiplied by": `final = camo(shipSpacePos) * shade(albedoLuminance)`, and the hull's panel lines/weathering still read THROUGH the camo because they modulate `shade`.
- **(v36.37) 5 patterns, ONE program, uniform-selected.** `uSkinPat` is a **float compared against thresholds**, not a `#define` — 1 SPLINTER, 2 DIGITAL, 3 ORGANIC, 4 HEX, 5 TIGER, 0 = the v36.35 hue path. Everything else (`uSkinPatScale/Soft/Mix/Lift/Gain`, `uSkinPatBands` vec2, `uSkinPatC0/1/2`, `uSkinPatM` mat4, `uSkinPatAxis`) is likewise a uniform, so switching livery **or switching pattern type while tuning** cannot recompile. Cost when off is a **uniform-coherent branch** (`if (uSkinPatMix > 0.001)`), so FACTORY pays nothing for code it never runs. **Measured in a live match: `renderer.info.programs` 129 → 129 across all 7 liveries applied to the in-world ship; frame time 6.9 ms median skinned vs 6.9 ms factory (p95 8.0/8.1, max 8.6/8.3) at the 144 Hz cap.**
- **⚠⚠ (v36.37) SHIP SPACE is the whole trick — not UVs, not screen space, not world space.** `_skinBakePatternSpace(root, mats)` bakes ONE mat4 per hull material: mesh-local `position` → ship-root space (accumulated node transforms, root itself contributing IDENTITY so the ship's world position/heading is never folded in) → recentre on the hull bbox → divide by its longest axis. Four things fall out and all four are required: (1) **parts stay stitched** — a wing modelled at an offset shares one continuous field with the fuselage; (2) **no swim, no stretch, no seams** — the matrix is constant for the life of the mesh and the field is 3D; (3) **all 7 hulls match** — the GLBs have wildly different native sizes, so `patScale` means *features across the ship*, not features per model unit; (4) **preview and in-world match** — the ship-select hero is NOT rescaled (the camera dollies) while `buildModelShipMesh`'s ship IS, and measuring the span absorbs that. Cached on `root.userData._skinPatBaked`; geometry bboxes cache on the SHARED GLB geometry, so the O(vertices) part happens once per model per session. The bbox also yields **`uSkinPatAxis`**, the hull's long axis, which is what makes TIGER stripes run ACROSS every hull rather than along whichever one happens to be nose-down-Z.
  - ⚠ The patch now touches the **VERTEX** shader too (two varyings written after `#include <begin_vertex>`, from the raw `position`/`normal` attributes). `customProgramCacheKey` is still the constant `'lssSkinHue|'`, so this is still one program family.
  - ⚠ Only **HEX** is triplanar (a hex lattice is inherently 2D, 3 evaluations blended by `pow(abs(n),4)` weights). The other four are evaluated in 3D directly — cheaper *and* seamless.
- **⚠ (v36.37) ANTI-ALIASING IS PART OF THE FEATURE, not polish.** Hard-edged camo on a ship 2 km away is high-frequency noise, i.e. the exact thing that would hide an enemy tracer. Two analytic defences: `fwidth(v)` widens the band `smoothstep` to one pixel at every edge, and `fwidth(shipSpacePos)` dissolves the whole pattern into its own **mean colour** as the ship shrinks (`smoothstep(0.12, 0.55, px)`). A distant hull is a clean flat silhouette. Do not remove either.
- **(v36.37) The `shade` term is the near-black-hull fix in pattern form.** `shade = patLift + (1-patLift) * clamp(lum * patGain, 0, 1)`. `patLift` is the floor of camo colour that survives a pitch-black plate (too low → VORTEX/PYRO/SLAYER/TRACKER go black again); `patGain` expands what little luminance range a dark texture has so its detail still reads. Shipped values sit at lift 0.60–0.72, gain 6.0–6.5.
- **⚠ (v36.37) LOW METALNESS ON NEUTRAL CAMO.** VOLCANIC's basalt greys at `metalness 0.42` rendered **rust-brown** — the hull was just reflecting the cavern's warm IBL. Same trap COPPER hit in v36.35. Dropped to 0.14/rough 0.64/env 0.14 and the greys became grey. If a livery reads as "the environment" rather than itself, that is still the first dial to check.
- **(v36.37) The 7 liveries** (ids UNCHANGED, so `lss_ship_skin` needs no migration): FACTORY (passthrough) · **BONE WHITE** (hue model, untouched — the owner's one keeper) · **VOLCANIC TIGER** (tiger, basalt greys + near-black stripes, ember emissive) · **HEX ALLOY** (hex panels, near-monochrome steel — *the near-monochrome scheme*) · **OXIDE BLOOM** (organic, copper + verdigris) · **SIGNAL SPLINTER** (splinter, orange/black/cream — *the high-contrast scheme*) · **VOID DIGITAL** (digital, violet/indigo/lavender). Picker swatches gained an optional `swatch2` and render as a 126° two-tone split, because a flat chip cannot say "camo".
- **(v36.37) `window.__skinTune(id, patch)` is the deliverable's iteration surface** and now reaches every field: `pattern` (name string), `c0/c1/c2` (`0xrrggbb`, `'#rrggbb'` or `'rrggbb'`), `patScale`, `patBands` `[a,b]`, `patSoft`, `patLift`, `patGain`, `patMix`, plus the material params and the v36.35 hue dials. It patches the TABLE (so the change survives a ship change or re-entering ship select), repaints the picker, re-asserts on the ship-select hero, and re-applies to **every `userData.isModelShip` root in the scene using ITS OWN `skinId`** — so tuning mid-flight updates your ship live and leaves the factory-liveried bots alone. `__skinTune()` dumps the table; `__skinTune('patterns')` lists the type names.
- **(v36.37) Honest visual read** (verified on VORTEX = near-black, TRACKER = mid, BLASTER = lighter, plus third-person in a dark cavern and in a bright fire chamber): **SPLINTER is the strongest** — dead-straight shard edges, unmistakable at any range, and the orange/black is the most readable livery in the game. **HEX and ORGANIC both read clearly** and hold their identity on all three hulls. **TIGER needed a shader fix**, not just tuning: the first cut's warp was ±1.6 against a stripe period of 2.0, which does not bend stripes, it destroys them (VOLCANIC rendered as brown blobs). The amplitudes are now a FRACTION OF THE PERIOD, which also makes them scale-invariant. **DIGITAL is the weakest** — the voxel blocks are crisp on VORTEX but get visually chewed up by BLASTER's busier surface geometry; it reads as "mottled violet" more than "pixel camo" there, and its violet is also the closest in value to the purple-crystal chambers. That is the one to iterate on first.
- **(v36.37) FX untouched, verified by material census** on the live in-world ship: **1 material patched** (`mesh_0` / `MeshStandardMaterial`), **5 not** (2 engine `ShaderMaterial`, the `shield` `ShaderMaterial`, 2 running-light `MeshBasicMaterial`). Zero console errors throughout.
- **Multiplayer.** The livery rides the **loadout commit** (which is the ready signal) as `skinId`, in both `net.sendLoadout` payloads (`commitLoadout` and the `onPeerJoin` re-announce). `onLoadout` stores `peer.skinId`; `updateNetworkPlayer` passes `data.skinId` to `new NetworkPlayer(peerId, key, team, skinId)`, which normalizes it through `_shipSkinDef` before the mesh build. An older peer simply omits the field → FACTORY.
- **Persistence:** ONE key, `lss_ship_skin`, **global across all 7 hulls** (`_getStoredSkinId`/`_setStoredSkinId`, same single-key pattern as the pilot perk and campaign difficulty). A skin is the pilot's livery/identity, not a property of the chassis — per-ship storage would silently change the color of the ship you just picked and would need 7 keys plus a migration.
- **(v36.35) Preview: skin BEFORE the compile warm.** `_applyShipPreviewModel` used to call `compileAsync` and *then* `_applyShipSkin`, so the warm compiled the UNPATCHED program and the patch threw it away on the next render — a wasted compile plus a hitch the first time each hull was shown. The apply now runs inside the first-build branch ahead of the warm; the unconditional re-apply after it still covers the cached-root case (`_applyShipSkin` is idempotent).
- **(v36.35) Verified end to end in a live match, not just in the preview.** Traversing the scene for `userData.isModelShip`: player = `signal` with `uSkinMix 1 / hue 0.078 / sat 0.95 / lift 0.6`; **all 5 bots = `factory` with `uSkinMix 0`** — bots share the patched program but are shader-passthrough, which is the whole design. Skin survived **death → respawn** (`shipState` back to `flying`, uniforms intact) and a **between-rounds hull swap** (VORTEX → PYRO carried the livery onto the new mesh). `emissiveIntensity` reads `0.9999999999999993` in game — that is `_dimHullMat`'s asymptotic dim lerp re-latched onto the SKINNED base, i.e. proof the latch-drop worked, not a bug.

#### Ship FX textures & mesh animation — `~L24008`
**Jump:** `function getHeatHazeSpriteMat` (~L24009)
- **Symbols:** `getHeatHazeSpriteMat`, `getElectricSmokeTexture`, `getHeatTrailTexture`, `getFlameLickTexture`, `animateShipMesh`
- **⚠** Texture getters memoize into module-level singletons (first call bakes a canvas).

### ═══ PART 12 — Combat entities: Bot & Projectile (~24485–27183) ═══

#### Bot AI — `~L24485`
**Jump:** `class Bot`
~1340-line enemy/teammate brain: targeting, steering, weapon/ability decisions, terrain nav, net-proxy.
- **⚠** Bots share the player's fire/ability spawn paths — combat regressions here hit bots *and* multiplayer.

#### Projectile & hit detection — `~L25823`
**Jump:** `class Projectile` (~L25927)
Swept collision, OBB/mesh hit tests, shared projectile geometry.
- **Symbols:** `_pointInsideShipOBB`, `_swepRayHitsShipMesh`, `_SHARED_PROJ_CORE_GEO`, `class Projectile`, `_despawnProjectileSilent`
- **⚠** Projectile VISUAL bundles are intentionally NOT pooled — re-adding pooling regressed combat.

#### Pyro flame & gas ignition — `~L27097`
**Jump:** `function spawnPyroFlame`
- **Symbols:** `spawnPyroFlame`, `igniteNearbyGas`

### ═══ PART 13 — Lights, warmup, explosions, obstacles, rooms, gas (~27184–32694) ═══

#### Dynamic & smoke lights — `~L27184`
**Jump:** `const dynamicLights`
- **Symbols:** `dynamicLights`, `spawnDynamicLight`, `spawnWallRipple`, `updateSmokeLights`, `updateDynamicLights`
- **⚠** Hard-capped, slot-recycled (`getVRLightCap`); over-spawn silently drops.
- **(v36.03) SHIP LIGHTS — engine glow + under-hull headlight (OWNER FEATURE: "engines light up but don't light anything around them").** **Jump:** `const _SHIPL` · `function _shipLightsFrame` (directly after `initDynamicLights`; called from the top of `renderFrame` so every render path — playing/menus/cinematic — keeps poses fresh or fades out). Player engine = PointLight riding `userData.engineMesh`, tinted from the live engine-glow mat (`_shipLightSampleColor`), throttle-ramped 0.4..1.2× like `animateShipMesh`; headlight = SpotLight mounted at the under-hull red/green nav-orb group (`userData.runningLight`), aimed with the nose (== camera forward, verified dot=1.000), warm 0xffe8c4, angle 0.5 / penumbra 0.45 / range 2400 / **decay 1** / no shadow; other ships = `TRAF_N` (3 desktop, **0 Quest/mobile**) pooled PointLights budgeted to the NEAREST ships (one pass over `game.entities` + `net.networkPlayers`, 3 Hz rescan, slot hysteresis, per-frame slot count additionally capped by `getVRLightCap`) — never one light per ship (hub flies ~34). Toggle: SETTINGS → Display → "Ship Headlight" (`input.headlight`, persisted, default ON) + live hook `window.__headlight(0|1)`; live-tune `window.__shipLights={eI,eR,hI,hR,hA,hP,tI,tR,gate}`. **⚠ NUM_*_LIGHTS PINNING:** all of these are created scene-resident at boot (point 8→12 desktop, spot 0→1 everywhere) and NEVER added/removed — intensity 0 is "off" (same invariant as the pool above). **⚠ PHYSICAL LIGHT UNITS (r165 removed useLegacyLights):** decay=2 is inverse-square — why the old pool lights barely reach. New lights use decay 0 (flat-in-range, quartic window) with 1..8-range intensities; the headlight alone uses decay **1** + candela-scale **2200** (2200/d: 11 at 200u, 2.8 at 800u) so one value serves near walls and far vaults. Verified v36.03: volcanic-rift vault beam-footprint luminance 13→33.5 avg (68%→45% px <16/255) at the v36.02 void vantage; endless center-frame +16%; hub perf same-protocol A/B old-vs-new 2.96-3.33 ms band both builds, 144 fps held (content noise 116-206 draw calls at a parked vantage dwarfs the light cost). **⚠ 3rd-person gotcha:** at <200u the 0.5-rad footprint is a ~30-90u pool that hides exactly BEHIND the ship silhouette — probe beams at gameplay ranges (or widen `hA`) before concluding "spot is broken"; cost a full debug session.
- **(v36.10) HEADLIGHT CONES — fog-gated fake volumetrics (OWNER FEATURE: "headlights of other players and bots should show ... a faint cone in front of the ship if there's fog to light up").** **Jump:** `CONE_N` in `const _SHIPL` · the `headlight cones` sections of `initShipLights` + `_shipLightsFrame` · `function _shipScanInsert`. NOT lights: 6 pooled additive gradient CONE meshes (+1 for the player, THIRD-PERSON only, never XR, tied to `input.headlight` + `hCur` so beam and painted footprint agree) — apex at `userData.runningLight` (hoard hulls have none → hull center −18u fallback, exercised by hub traffic), opening along the ship's world nose (+Z, `getWorldDirection` → `setFromUnitVectors`; billboard-free), shared unit CylinderGeometry (apex at origin, +Z, per-frame `scale.set(tan(ang)·len, ·, len)` so `ang`/`len` live-tune with zero rebuilds), 16×128 canvas v-gradient (god-ray technique; apex-hot, EXACT 0 at far end), warm 0xffe8c4 = the real spot, per-cone material (independent fades, one program), depthWrite off / depthTest ON (terrain occludes beams), `fog:false` (additive + FogExp2 toward a bright fog color ADDS light with distance — the standard trap), renderOrder 2. **FOG GATE `visK` = densityK(scene.fog.density, ramp 1e-5..4e-5) × darkK(1 − lum(scene.fog.color), ramp .50..0.16)** — fog COLOR luminance is "how lit the air already is": endless volcanic/goldmine (lum .19/.17) + night/dusk hub (lum .02-.20) + underwater glow, bright reaches (rocky .73, snow .87, grassy .60, day meadow .76) kill it. READ-only on scene.fog (sentinel-safe vs weather/zone owners). Opacity `min(0.12, 0.16·visK) × (0.45..1 throttle ramp)`, ~250 ms fades. **⚠ 0.085 was invisible** — in-scene A/B screenshots came back pixel-identical; 0.16 calibrated live (volcanic visK .61 → mat opacity ~0.10). **Scan: the v36.03 3-register scan is now the 6-deep `S._top`/`S._topD` insertion (`_shipScanInsert`, dup-guarded — drop-in peers sit in BOTH `game.entities` and `net.networkPlayers`); traffic lights read slots 0-2 (identical top-3 semantics), cones all 6, own hysteresis loop, entity refs released on death/cloak (`mesh.visible`)/not-flying so meshes GC.** Tiers (judged): Quest/mobile `CONE_N=0` at boot (v35.89 tile-GPU overdraw rule — never allocates); XR tier 1 → cap 2, tier ≥2 → 0 (fillrate, one notch harsher than `getVRLightCap`); PCVR tier 0 = desktop. Pool is boot-resident for the app lifetime (same pinning philosophy; `visible=false` is "off" — meshes need no relink so this is free), NOTHING mode-owned → no per-mode teardown to write. Live-tune `window.__shipCones={on,op,max,len,ang,cap,d0,d1,l0,l1}` (`ang` defaults to `S.head.angle×0.62` — the penumbra-0.45 bright core; the full 0.5 rad silhouette read as a glowing fan). Verified live v36.10: volcanic endless wave — cones on 3 class bots, apex-at-bow + nose-aligned + terrain-occluded confirmed at op 0.5 sanity pass, faint beam reads at defaults; grassy reach same vantage → all cones `visible:false` (lum .597); night hub city 2 traffic-hull cones 0.054 (clamp math exact) + player cone 0.12 in third person; perf pinned-vantage A/B on/off: avgCalls 104.0 vs 102.8 /pass, tris +46, **144 fps both**, zero console errors. **⚠ headless staging traps (cost most of the session): gamepad resting-stick drift moves the ship between a positioning call and the screenshot — pin pose via a 16 ms interval; wave bots get re-positioned outside `bot.update` (stub `update` AND re-pin positions); busy-wait spins block the rAF so `run.nextBiomeAt`/`phaseT` tricks need separate calls or `__endlessTick`; teleporting the pin INSIDE rock kills the player (probe `__endlessBoltProbe` sdf < −60 first).**

#### Shader warmup (frame-yield precompile) — `~L26883`
**Jump:** `const _shaderWarmup` · `function _warmupYield` (~L26896)
Async precompile that renders representative effects offscreen — the primary "first-sight hitch" fix.
- **⚠** MUST bind `renderer.setRenderTarget(postFX.rtScene)` for correct colorspace; XR/hidden path uses `setTimeout` fallback.
- **(v36.26) THE WORLD PREBAKE — "when the cinematic starts, loading is DONE", enforced.** **Jump:** `async function _prebakeWorldForLaunch` (immediately below `_warmRealCombatFX`) · `async function _prebakeGpuPrime` · `function _swDrainStream` (PART 7, right under `window.__swStream`) · the `if (!midMatch)` chain on `_warmupPromise` in `commitLoadout` · console `window.__prebake()`.
  - **THE SPEC (owner).** *"From CONFIRM/launch to the cinematic STARTING is the ONLY loading time. When the cinematic starts, in EVERY mode, loading is DONE — world built, spawn-radius terrain chunks baked, models parsed, GPU uploads primed, shaders linked. Nothing may stream/build/upload after the cinematic begins."*
  - **MEASURED VIOLATION on v36.25** (per-frame `renderer.info` deltas from a rAF that re-registers at the top of its own callback, so it stays ahead of `setAnimationLoop`): chunks resident at cinematic START → at the first `playing` frame → final — **exhibition 30 → 362 → 441, endless 35 → 361 → 361, elimination 35 → 110 → 142.** Exhibition foliage was worse: **5 tree batches at cinematic start, 437 at the first playing frame — 98% of the hub's trees built after the cinematic ended.**
  - **THREE CAUSES, and the first is why a fix already in the file did nothing.** (a) `game._swPreloading` — the v33.47 ordering gate, the 28/14/14 preload streaming budget and the ENTERING THE OVERWORLD overlay — is armed **only** on `initSandwichTerrain`'s `!game._clipWantHub` arm, i.e. mobile. On desktop the hub clipmap always exists, so it has never once run there (probed at every phase boundary: `clipWantHub:true, swPreloading:false`), and `_launchSoloAfterCinematic`'s `MODE==='freeflight' && game._swPreloading` guard could never fire. (b) With that gate dead the streamer took the GAMEPLAY budget — `updateSandwichStream(x, z, 1)` for freeflight, `gLim`/`tLim` defaulting to **1** — one chunk and one foliage batch per frame. (c) The foliage budget is per-FRAME for a fixed 320 ms job (441 hub batches, mean 0.73 ms, worst 2.1 ms, from the game's own `_fpData`), so world-readiness **scaled with refresh rate**: 441 frames is 3.1 s at 144 Hz (which just fits the countdown, so this box mostly got away with it) but 7.4 s at 60 Hz — the owner's *"still loading stuff after the cinematic"*.
  - **THE SHAPE.** `_prebakeWorldForLaunch` is chained onto `commitLoadout`'s `_warmupPromise` — **not** onto the two solo call sites — because `_markLocalWarmupReady` (which is what tells peers we are ready), `showShipSelectWaiting`, `hideLoadingOverlay` and `_launchSoloAfterCinematic` all already hang off that one promise, so solo AND multiplayer inherit the gate with no new ordering. Both settle arms continue into it: a shader-warmup rejection must not skip the world build. It never rejects. Four phases, all behind the already-painted PREPARING ARENA overlay (it writes the overlay SUB-line only, so v36.24's audio hold and v36.19's opaque cover are untouched):
    1. one `_warmupYield()` so **gameLoop's own clipmap-enable block runs first** — that block disposes the ground shell of every chunk baked before `_clipmap.on` flips, so baking ahead of it is pure waste;
    2. drive the streamer to completion around the spawn (two consecutive no-build passes = done, the same test `_swPreloadZero` used);
    3. `_warmRealCombatFX()`, **hoisted from `updateRoundSystem`** where it fired at `warmupTimer<=2` — after the cinematic — or, in every `testMode`/freeflight mode where `warmupTimer` is forced to 0 and that branch cannot fire at all, inside the `warmup→playing` frame itself. Measured 512 ms on a cold hub. It is signature-memoized so the two call sites left behind are now no-ops;
    4. `_prebakeGpuPrime()` — **12 real draws** (4 yaws × 3 pitches, FOV widened to 130) of the LIVE `scene` from the spawn pose with `postFX.rtScene` bound. This is rule 5 / the PART 13 v36.17 discipline: render target, `scene.fog` and per-type light counts are all program-cache-key terms. **The full sphere is the point** — a forward render only uploads the geometry in one frustum, which is why v36.25 measured a whole second averaging 34.65 ms of GPU the first time the player turned around and a 2243 ms first `playing` frame carrying +22 geometry uploads and +21 driver program validates in one draw.
  - **⚠ CAPS.** `_PREBAKE_MAX_MS` 12 s bounds the whole thing, re-checked between phases, plus a 900-pass ceiling. Blowing a cap logs `CAPPED:` and launches anyway. `game._worldPrebaking` joins the v36.21 launch-stall detector's "still legitimately working" set (`_shaderWarmup.promise ||`). **Excluded for `midMatch`** — the between-rounds swap has no overlay to hide a 12-draw sweep behind.
  - **⚠ THE CAMERA POSE IS RE-APPLIED ON EVERY PASS**, not once: gameLoop keeps running between the yields and its warmup branch writes `camera.position`/`camera.quaternion` from the player every frame. The render target is unbound before every yield so the gameLoop frame in between renders normally. FOV/near/far/pose are all restored in a `finally` (verified live: `camera.fov` back to `input.fovDeg` 120 after a hub launch).
  - **RESULT, live pane, RTX 5050 @ 144 Hz, per mode, everything measured from the frame the loading overlay lifted.** Chunks/tree-batches/programs built after that instant: **exhibition 0/0/0 (was 411/436/23), endless 0/–/0 (was 326/–/…), elimination 0/–/0 (was 107/–/…).** Exhibition now shows **441/441 chunks and 441/441 tree batches at the cinematic's first frame.** First 30 s of play, worst frame / frames >33 ms: exhibition 16.7 ms / 0, endless 23.1 ms / 0, elimination 24.4 ms / 0; p99 8.6–12 ms against the 6.94 ms budget. **Added loading time: exhibition +1.2 s, endless +1.5 s, elimination +0.8 s.** Race/assault/campaign smoke-tested clean (race 110 chunks at load-done and 110 five seconds into play; assault 121/121). Zero console errors, zero unhandled rejections in every run.
  - **⚠ The one frame that is still >33 ms after the overlay lifts is the cinematic's OWN first frame** (37–39 ms in endless, `_lssStartSpectatorCinematic` posing the lineup + the overlay's `display` flip). It is the transition itself, not gameplay.
  - **⚠ (v36.40) A CLAIM THAT DOES NOT REPRODUCE — "campaign builds its leg on live frames with NO loading overlay".** An audit reported `startCampaignJourney`'s brand-new-player branch as bypassing ship-select "and therefore the loading overlay + prebake chain every other mode gets", on the strength of a **385 ms / 120-program / 3309-draw frame** followed by ~1.2 s of 50–56 ms frames. **The frames are real; the cause is not.** Re-measured on v36.39/v36.40 with a `MutationObserver` on `#lss-loading-overlay` plus per-frame `getComputedStyle`, brand-new profile (`lss_campaign_legs` / `lss_campaign_unlocks` cleared), settled page: `.active` goes on at **+5.2 ms** with `display: flex, opacity: 1` **immediately** — the `opacity: 0 → 1` transition **never runs**, because the element also goes `display: none → flex` in the same mutation and CSS does not transition out of `display:none`. Two frames then paint at +17.8 / +19.6 ms with the opaque cover on screen (this is `_commitDeferOneFrame`'s two rAFs doing exactly their job), and only then does the build frame land at **+1062.9 ms (1047.5 ms long)** — `opacity 1, display flex` for its whole duration, as are all 15 follow-on frames (84/33/66/67/81/66/48/42/44/20/16/19/20/17/16 ms). Overlay lifts at **+2052.6 ms**; the 2814 frames after it show **worst 15.6 ms, ZERO over 16 ms, dProg/dTex/dGeo/dChunk all 0**. And `window.__prebake()` reports the full chain ran: `freeflight/hub_overworld, 836 ms, chunks 30→441, trees 5→441, ent 377 ms (29 keys), gpu 12 passes`. **The likely misread:** freeflight forces `warmupTimer` to 0 every frame, so the hub flips to `game.state === 'playing'` at the START of the build — an audit keyed on "playing frames are live frames" counts the entire covered build as gameplay. **No change made.** ⚠ If you re-open this, the real (mode-independent) finding is below.
  - **⚠ (v36.40) FOUND, NOT FIXED — `_finishCommit`'s `buildWorld()` is ONE frame in EVERY mode.** Measured on the campaign hub: **1047.5 ms** on a settled page, **354.6 ms** with a warm ANGLE program cache, and **2252.1 ms** when launched seconds after page load with the asset preload still running. Elimination's equivalent is 352–369 ms. It is fully covered by the overlay in all three, so it is not a visible hitch — but a 1–2 s scripted frame is the same class as the 1851 ms cavern→hub freeze that v36.27 fixed, and that one was reported as a hard freeze in Opera because a less patient watchdog does not care that the pixels on screen are correct. The fix is the v36.27 treatment applied to `_finishCommit` (stage the fresh-match build across frames behind the cover it already raises); it is a much larger change than a per-mode patch and was deliberately left alone.
- **(v36.27) THE WORLD-SWAP TRAVERSE — the same contract for the OTHER way a world gets built, and the fix for the owner's Opera rift freeze.** **Jump:** `function _beginWorldSwap` / `function _swapArmed` / `async function _swapTearDownChunks` / `async function _swapCoverPainted` / `async function _rrStagedSwap` (all immediately below `_prebakeGpuPrime`) · `async function _pinCombatEffectProgramsStaged` (right after `_pinCombatEffectPrograms`) · the `_rrWorld`/`_rrWave`/`_rrWarpBeat`/`_rrShaders`/`_rrReset`/`_rrCountdown` closures in `updateRoundSystem`'s `roundEnd` branch · console `window.__swapReport()`.
  - **FIVE ENTRY POINTS, ONE MACHINE.** Every mid-session world swap sets `game.selectedMap`, `game.state = 'roundEnd'` and a 2 s `roundEndTimer`, then lets `updateRoundSystem`'s roundEnd branch rebuild: `_hzEnterCavern` (EXHIBITION's zone-rift portal — the owner's path), `_hzReturnToHub`, `FreeFlightMode._enterCampaignFromHub` (the journey rift), the `CampaignMode` leg-advance **and** its FINALE hub-return, and the co-op peer mirror (`camp_state evt.advancing`). All five call `_beginWorldSwap(label, title)`; there is exactly one place to fix.
  - **MEASURED BEFORE (v36.26, live pane, RTX 5050 @144 Hz, 6.94 ms budget), worst frame of each traverse:** hub→campaign rift **344.3 ms** (entry) + **423.2 ms** (rebuild) · hub→zone cavern **317.1** (+188.7) + **265.3** · **cavern→hub 1851.3 ms in ONE frame.** None of them showed a loading screen — just the `ov-warp` tunnel, which stops animating for the duration. That 1.85 s frame is the owner's *"Opera + Exhibition + RIFT PORTAL = hard freeze, no console"*: a browser whose watchdog is less patient with a two-second scripted frame than Chromium's does not survive it.
  - **DEFECT 1 — the entry frame was rebuilding a world it was about to throw away.** Each entry point calls `applyMapPreset(destination theme)` → `setSandwichBiome` → `buildRoomGraphLevel(game.currentLevel)`, i.e. it rebuilt **the level the player is still flying** with the destination's biome, two seconds before the real rebuild. That is the entire 317–344 ms entry frame (`dCh −415`, `dTb −441`). `setSandwichBiome` now skips the rebuild while `_swapArmed()`; the biome write still lands, so the destination rebuild reads it. Entry frame after: **29–37 ms.**
  - **DEFECT 2 — the rebuild was one frame.** `_rrStagedSwap` drives it across frames behind the REAL loading overlay, in this order: **cover → teardown → world → wave → hub city → reset+respawn → clipmap → programs → GPU prime #1 → terrain drain → combat FX → GPU prime #2 → overlay off → warp beat → countdown.**
  - **⚠ `game.state` is set to `'warmup'` by the caller exactly as before** so nothing downstream meets a novel state — which makes the `warmup→playing` flip reachable mid-stage (in freeflight/testMode `warmupTimer` is FORCED to 0 every frame and the flip gates only on ship-select being hidden, which it is until `_rrCountdown`). **`!game._swapStaging` in that flip is load-bearing**; without it the first frame of a traverse drops the player into a half-built world.
  - **⚠ The cover phase is not decorative and two rAFs are not enough.** `#lss-loading-overlay` is `opacity:0` + a 0.25 s transition; `.active` alone would leave it ~10% opaque under the block it exists to hide. `_swapCoverPainted` yields until the *computed* opacity is ≥0.985 (600 ms backstop). Verified live: 146 consecutive staged frames at `opacity 1 / display flex / rgb(2,4,12) / z-index 9000`.
  - **⚠ The countdown is SHORTENED by the stage** (`launchCountdown(LAUNCH_COUNTDOWN − stageSeconds)`, floor 4 s, `warmupTimer` re-anchored to match), so a traverse still takes the same ~12.4 s wall clock it always did — loading moved *into* the countdown, not in front of it. This is also what keeps co-op peers converging on one LAUNCH instant even when their stages differ in length.
  - **⚠ `game._worldPrebaking` AND a dedicated `game._swapStaging` arm in gameLoop's terrain block** — the stage owns the streamer end to end. A 1-chunk/frame background trickle refills the map behind `_swapTearDownChunks`.
  - **⚠ `_pinCombatEffectProgramsStaged` deliberately does NOT bail on `_programEnvSig`.** That memo describes the RENDERER environment (fog kind, env map, shadow/tone-mapping settings, light counts) — none of which a world swap has to change — while every scene MATERIAL is new. With the memo in place it returned instantly and 28 hub programs then linked at their first real draw in a single **960.2 ms** gameLoop frame. It also parents `_fxPinGroup`/`_modelWarmGroup` **only for the synchronous `compileAsync()` call**, never across an await: leaving them parented lets gameLoop DRAW them, and that draw is the driver's first-use validate — measured as a **696.4 ms** frame (LoAF: 691 ms in the animation callback, `dProg 0`, pure driver time). three's `compileAsync` runs `compile()` synchronously and only defers the readiness poll (`KHR_parallel_shader_compile`, confirmed present), which is exactly why binding/unbinding and add/remove around the call is correct.
  - **⚠ Two GPU primes, not one.** Linking ≠ validating: the driver validates at the first real DRAW. Prime #1 (before the terrain drain) beats gameLoop to the newly-spawned campaign fleet — that first ordinary render was one frame of 577 draw calls at **480.8 ms**, and three controlled frames of four draws bring it to **101.2 ms**. Prime #2 (after the drain) is the v36.26 one and is the only one that can see the terrain.
  - **⚠ The terrain drain re-reads `player.position` EVERY pass** rather than capturing it once like the launch prebake. On the campaign rift the leg's own scene-start moves the player *after* `respawnPlayer` — measured at `(0,0)` for the first ~1.2 s of the stage and then `(0,−18000)` — so a captured centre baked 25 chunks in the wrong place and the next pass evicted all of them.
  - **⚠ `_liveSwap` is EXEMPT from `commitLoadout`'s "clear the armed flag" line.** `_enterCampaignFromHub` arms the traverse and then does a `_liveSwap` commit three lines later (v35.86's always-re-commit). Clearing there disarmed the rift: measured, the campaign traverse silently fell back to the one-frame synchronous rebuild while the zone-rift path staged correctly.
  - **RESULT, live pane, per path, worst frame (and the loading overlay is up for all of them):** **cavern→hub 1851.3 → ZERO frames over 25 ms** (stage 1660 ms: teardown 7 / world 190 / city 202 / clip 237 / shaders 456 / terrain 391 / gpu 18+24) · hub→zone cavern 317.1+265.3 → **444.4** (that one is `_warmRealCombatFX`'s real-draw model warm for the new environment) + 181.1 · hub→campaign rift 344.3+423.2 → **101.2** + the world build (126–624 ms depending on whether v36.22's page-load preload already has the hoard GLBs in memory, which decides whether `_campStartScene` clones its bots synchronously). **World complete before control returns in every case** (110/110, 441/441). **Play after arrival:** hub p50 6.9 / p95 8.1 / p99 8.6 / worst **11.5 ms** over 34 s, zero frames >16; camp_approach p99 8.8–9.3, worst 19.5–22.3 ms, zero >33; cavern p99 10.5 (its one 235.9 ms frame is `_hzSpawnCavernBots`' GLB wave — **⚠ CORRECTED IN v36.28: only the spawn TIMING was "by design"; the 236 ms was the same contract violation, an entity model first-touched in open play. See the v36.28 ENTITY PRIME entry below.**).
  - **NOT STAGED, and verified unchanged:** between-rounds (`_swapPending` null → all closures run back-to-back in the one frame exactly as before; elimination round 2 measured a 175.6 ms rebuild frame, matching v36.26's 167.9, then p99 8.9 / worst 11.3 / zero >16 in play) and every launch path (endless 361/361, assault 121/121, `window.__swapReport()` null, worst play frame 21.3/10.7 ms).
- **(v36.28) ENTITY PRIME — the same contract for the things that SPAWN, not just the world they spawn in** (owner: the 235.9 ms `_hzSpawnCavernBots` frame the v36.27 entry waved off as "by design" is NOT acceptable; only the spawn TIMING was intentional). **Jump:** `const _ENT_PRIME` / `function _entPrimeShipKeys` / `function _entPrimeHoardKeys` / `function _entPrimePlan` / `async function _primeEntityModels` (all immediately below `_prebakeGpuPrime`) · phase **C2** of `_prebakeWorldForLaunch` · the `ent` phase of `_rrStagedSwap` (between `shaders` and `gpu0`) · the `(v36.28)` picks block in `_hzEnterCavern` · console `window.__entPrime()` / `window.__entPrimeOff` / `window.__dbg.models()` / `window.__dbg.waveRot()`.
  - **THE SHAPE.** For a mode-scoped key list: `loadHoardModel()` anything unparsed (await — the GLTF parse lands behind the overlay), then **build the REAL mesh with the REAL factory** (`createShipMesh` → `buildModelShipMesh`, byte-for-byte what `new Bot(...)` builds), add to the LIVE scene, render ONE frame into `postFX.rtScene`, remove. Rule 5 again: only a real DRAW uploads geometry/textures and forces the driver's first-use validate, and only the live scene + `rtScene` reproduce the gameplay program key. Per-key memo (`_ENT_PRIME.keys`), 5 s own cap on top of the caller's 12 s, 4 keys per yielded frame.
  - **⚠ ADD → RENDER → REMOVE IN ONE SYNCHRONOUS BLOCK.** Same trap as `_pinCombatEffectProgramsStaged`: leave the meshes parented across an `await` and gameLoop draws them — on screen, and paying the validate in an ordinary frame. `frustumCulled = false` on every child + parked at y = −100000: the draw must happen, the pixels must not.
  - **⚠ NOTHING IS DISPOSED, deliberately.** Geometry and textures are SHARED with the cached proto (`Object3D.clone` copies references), so they stay GPU-resident for the page as long as `shipModelCache.loaded[key]` lives; the materials are held in `_ENT_PRIME.mats` because three refcounts programs **per material** and a `dispose()` would delete the program this just linked. Same reason `_buildModelWarmGroup` keeps `window.__lssModelWarmMats`. Verified: `scene.children` carries **0** leaked prime groups after a run, render target unbound, `camera.fov` back to 120.
  - **SCOPE, per mode — this is where the loading budget goes.** `hub_overworld` + campaign legs → the **whole 22-entry `HOARD_SHIPS` pool**; there is no smaller honest subset, because rift guards take 4 keys, a cavern 3 and every campaign wave 3, all off ONE walking `_campShipRot` cursor, and the hub already parses 14 of the 22 for its own traffic so the marginal cost is 8 GLBs. Zone-rift cavern → **exactly `game._cavern._picks`**. Endless / elimination / race / assault → **no hoard ships exist there at all**. The 7 playable `SHIP_MODELS` are primed everywhere and are nearly free (already parsed by the boot preload → 7 clones + 1 draw).
  - **(v36.28) `_hzEnterCavern` NAMES THE GARRISON UP FRONT.** It now calls `_hzCavernGenome(salt)` + `_campWaveShips(3)` itself and stashes `game._cavern._picks`, so the staged swap two seconds later knows precisely which hulls to parse. `_hzSpawnCavernBots` consumes `_picks` when present and still computes them itself otherwise. **Spawn timing, doctrine, count and positions are all unchanged** — `_hzCavernGenome` is pure on the salt, and the only thing that moves is *when* `_campShipRot` advances (nothing else reads it in between: `_hzPortalsFrame`, the guards' only consumer, stands down the instant `game._cavern` exists).
  - **MEASURED, live pane, RTX 5050 @144 Hz, 6.94 ms budget. A/B on ONE build via `window.__entPrimeOff`** — which matters, because the hub genome deals a different 14-model traffic set every page load and therefore a different set of accidentally-warm keys; two page loads are not a controlled comparison. Worst PLAYING frame of the spawn event, OFF → ON:
    - **zone-rift cavern**, forced salt `2282721059` (SWARM PROTOCOL, 12 ships) + `__dbg.waveRot(11)` (mantaray/matrix/midknight, 8 of 12 hulls cold): **21.2 → 15.5 ms**. Same rig, 6 ships / 2 cold keys: 21.2 → (memo) ; all-warm keys: 13.7–18.3 ms either way.
    - **endless first ambush wave**: **23.8 → 10.8 ms** (v36.27 baseline 26.0). Second wave was already 10.7 ms both ways — the first wave was the whole cost.
    - **hub rift guards** (`_hzGuardsFrame`, 4 ships, no cover to hide behind): **8.8 ms**, i.e. inside p99. All four protos resident from the launch prime.
    - **campaign hub boss portal** (`cyanring.glb`): dGeo **+1** over 12 s, no measurable frame — v36.18 pinned its program and the launch `_preloadCyanRing` + prime cover the upload.
  - **⚠ THE 235.9 ms DID NOT REPRODUCE ON THIS RIG TODAY** and the report should say so: with the browser's disk cache warm and the GLBs served from localhost, the same event costs 13–21 ms. The cost is dominated by whether the hull was already parsed, which is exactly the dice this removes — the earlier figure is the same event on a colder model/driver state (a first visit downloads 2–4.7 MB per hull *at spawn*, on the owner's real deploy, over the real network). **What is provable either way:** the prime does **619 ms of real work** (29 keys, 8 GLB parses, 29 first-draws) that the game otherwise scattered across gameplay frames at unpredictable moments.
  - **ADDED LOADING TIME, per mode** (`__prebake().ms.ent`): exhibition/campaign hub **+0.51–0.62 s** (29 keys, 8 parses, 29 draws), endless **+0.031 s**, elimination **+0.020 s**, race **+0.021 s**, assault **+0.016 s** (7 ship keys, 0 parses — those GLBs are already in `shipModelCache` from the boot preload, so it is 7 clones and one draw). The staged swap's own entity phase is **0 ms / full memo hit** on every traverse after a hub launch (`__swapReport().ent` = `{asked:10, memo:10, ms:0}`).
  - **CONTRACT RE-CONFIRMED after the cinematic** (`renderer.info` deltas from the first `playing` frame): chunks **441→441** exhibition · **361→361** endless · **110→110** elimination · **115→115** race after its first 2 s; `dProg` **0** in every mode; zero console errors and zero unhandled rejections in six full launches. First 30 s of play, endless: 4312 frames, **p50 6.9 / p95 7.8 / p99 8.6 / max 20.2 ms**, histogram `<7 ms 2167 · 7–8 1991 · 8–10 140 · 10–16 10 · 16–25 4 · >25 0`. Elimination p99 9.4 / max 27.7 · race p99 9.4 / max 25.3 · assault p99 8.8 / max 17.6 · cavern (35 s) p99 8.9 / max 20.5 · campaign hub p99 8.9 / max 21.6. **Zero frames over 33 ms in any mode.** In every mode the single worst frame is either the cinematic→`playing` transition itself or a monster `attachModel` — no spawn path is the worst frame any more.
  - **⚠ SUPERSEDED IN v36.40 — the six `OutskirtsMonster` GLBs ARE primed now.** This bullet used to read "deliberately not primed: 20–45 MB each (~190 MB) … would add well over ten seconds". v36.29 measured them from disk at **7.03 MB total** (off by ~27x) and v36.39 measured the six attaches as **the only frames over 16 ms in an entire endless or race run**. They are primed by their own pass — see the v36.40 MONSTER PRIME entry below. The remaining honest caveat stands: the fix is a smaller monster art budget, not a longer loading screen — it now costs **~0.40–0.45 s** of loading in the three modes that spawn them.
  - **⚠ FOUND AND OUT OF SCOPE — the freeflight RESPAWN teleport.** Dying in the hub respawns ~15 km away and the clipmap re-centre lands in ONE gameplay frame: measured **256.9 ms**, chunks 554 → 243 then refilling at 1/frame for ~20 s (the v36.26 gameplay budget). Identical shape for any long teleport. This is the v36.26/27 machinery applied to a path that has no loading cover at all, i.e. its own piece of work (`_clipEnableSliced` + `_swDrainStream` behind a death-cam), and it is a TERRAIN problem, not an entity one.
- **(v36.40) MONSTER PRIME — the six leviathan GLBs, moved into loading (the last uncovered upload in combat).** **Jump:** `const _MON_PRIME` / `function _monPrimeWanted` / `async function _primeMonsterModels` (immediately below `_primeEntityModels`) · `function _loadMonsterModelInto` (PART 14, extracted out of `_loadNextMonsterModel`) · `_initMonsters(skipLoad)` · phase **C3** of `_prebakeWorldForLaunch` · the `mon` phase of `_rrStagedSwap` (right after `ent`) · console `window.__monPrime()` / `window.__monPrimeOff`.
  - **THE SHAPE.** Exactly what `updateMonsters`' deferred init does, but during the prebake: set `_monstersInit` **before the first await** (updateMonsters ticks on every frame this yields — a second `_initMonsters` would leave two half-loaded packs fighting over `game.monsters`), call `_initMonsters(true)` (the new `skipLoad` arm, so the 2.5 s trickle-loader does not also start), then `await _loadMonsterModelInto(m)` per creature with a `_warmupYield()` between. **`attachModel` is untouched** — it already does its own `postFX.rtScene`-bound `compileAsync` + live-scene 4x4 draw (v36.17/v34.19), so the warm-context rule is inherited, not re-implemented. `_preloadChampionShellModel` now returns a memoized promise and is awaited alongside.
  - **GATED to the three early-outs `updateMonsters` itself takes, and no more:** potato quality, `LSS.MODE === 'freeflight'`, `LSS.MODE === 'assault'` (**verified: that is the complete list — non-potato mobile/Quest tiers DO run monsters**), plus XR. So the hub/campaign-journey loading screen pays **zero** (`__monPrime().capped === 'mode'`, `game.monsters.length === 0`).
  - **⚠ ONCE PER PAGE.** `_monstersInit` is never cleared, so round 2+, every staged world swap and every later match report `capped: 'memo'`, 0 ms. Blowing `_MON_PRIME_MAX_MS` (4 s) or the caller's `_PREBAKE_MAX_MS` leaves `_monsterLoadIdx` where it is and kicks `_loadNextMonsterModel()` — a cold cache degrades to exactly the pre-v36.40 trickle for the remainder.
  - **BEHAVIOUR CHANGE, deliberate:** the creatures are in the scene from the countdown instead of arriving at +6 s. They spawn **dormant, in the outskirts** past the carve's bounding shell (`_rehome`), and `updateMonsters`' `_homeKey` check re-anchors them for the round's real geometry exactly as before — so nothing is visible from inside the arena.
  - **MEASURED, live pane, RTX 5050 @144 Hz, 6.94 ms budget.** BEFORE (v36.39, classic/hourglass): six `attachModel` frames at **+2.3 / 4.9 / 7.5 / 10.1 / 12.6 / 15.2 s** after the round opened, costing **24.9 / 27.5 / 20.7 / 21.7 / 26.5 / 16.6 ms** — ~137 ms of main thread, and every one of them a frame over budget. `renderer.info.programs` is **unchanged across all six** (129 before and after), so no shader work is involved: it is the 1024² RGBA map + 1.5–3.2 MB of buffers uploaded at attachModel's own first draw. AFTER: the same six frames land at **+1.87–2.24 s of the LOADING window** (overlay `.active`, `opacity 1`), and the first playing round measures **7129 frames, ZERO over 16 ms**, worst 13.1, p99 8.7. Endless, 95 s run: **13 587 frames, ONE over 16 ms** — a 47.8 ms frame at +39.4 s with dProg/dGeo/dTex/dChunk all **0** and draw calls flat, i.e. a GC pause, not an upload.
  - **ADDED LOADING TIME, per mode** (`__prebake().ms.mon`, cold page): elimination/classic **+0.40 s**, endless **+0.43 s**, race **+0.40 s** (first match of the session only — memo after), campaign LEG same via `_rrStagedSwap`; **hub / campaign journey / assault / potato +0.00 s** (gated). Whole-prebake totals moved 0.89 → 1.22 s (elimination) and 1.52 → 1.95 s (endless).
  - **STILL CORRECT AFTER:** 24 bones per creature, `spectralGhost` program with `transparent: true` / `depthWrite: false` on every material, mixer advances the moment `update()` runs (they are `dormant` until aggro — `update()` returns before the mixer tick while dormant, which is unchanged v32.3 behaviour and NOT a regression), and death still removes the mesh and spawns the gib field (12 500 HP → 41 effects + 47 particles).
- **(v36.17) WARMUP AUDIT — the GLB-material gap, and the method to repeat it** (owner: "make sure that all the effects are being warmed up"). **Jump:** `let _modelWarm` inside `_warmupCombatShadersBody` (right after `scene.add(group)`) · `function _buildModelWarmGroup` (~L33495, PART 15) · the v36.17 block in `OutskirtsMonster.attachModel` (~L31459).
  - **THE METHOD (do exactly this next time — it is objective and takes one browser session).** In the ship-select menu, before launching, wrap the live GL context: `const gl = renderer.getContext()` then patch `gl.shaderSource` (stash source per shader), `gl.attachShader` (collect sources per program), `gl.linkProgram` (record `performance.now()` + the collected `#define` block) and `gl.getProgramInfoLog` (the *blocking* first-use sync — `renderer.debug.checkShaderErrors` is true, so this is where the stall actually lands, not at link). Add a rAF recorder of frame `dt` + a running link count, so every link can be attributed to the frame it froze. Then: launch → play. **Any link recorded after `game.state === 'playing'` is a gap, by definition.** Two more probes finish the job: (1) bind the combat target and call `renderer.setRenderTarget(rtScene); renderer.compile(scene, camera)` — every program that links is one the game would have compiled inside a gameplay frame *for something already in the scene*; (2) to test one specific material by SIGNATURE rather than by name, build it, park it at y=-100000 `frustumCulled=false`, add, run probe (1), remove — **0 new links = genuinely covered**. Get `rtScene` itself by wrapping `renderer.render` and recording `renderer.getRenderTarget()` on the call where `sc === scene`. Cross-check any duplicate with `renderer.info.programs` — the entries carry `.cacheKey` and `.usedTimes`, and diffing two cacheKeys field-by-field is what identifies a fork whose GLSL is byte-identical.
  - **WHAT THE AUDIT CLEARED (v36.00 / v35.87-90 / v35.72 / v36.03 / v36.10 / v36.12 — all measured, all already covered).** Signature-equivalence, not name-matching: the **v36.00 laser splash** sprite is the same `SpriteMaterial(ember + Additive + depthWrite:false)` the warmup's textured-sprite pass builds (0 new links); the **v35.90 Aegis bolt** core is the opaque `{}` `MeshBasicMaterial` variant (`toneMapped:false` is a no-op in combat — an RT bind already forces `NoToneMapping`), its two shells are `_makeFXMaterial` presets covered by the `EFFECT_PRESETS` loop, its halo is the ember sprite again; the **v35.72 endless god rays**, the bolt's **ray shafts** and the **v36.10 headlight cones** are ONE signature (`MeshBasic + map + Additive + depthWrite:false + DoubleSide + fog:false`) which was warm only *accidentally*, because `initShipLights` leaves the cone pool scene-resident so `renderer.compile` reaches it — now pinned explicitly in `_buildModelWarmGroup` so re-gating the cones can't resurrect it; **v35.72 storm bolts** ride the existing lightning pool; **v36.03 ship lights** add no material (and their `NUM_*_LIGHTS` are pinned at boot); **v36.12 overshield** is a HUD canvas overlay, no program. 45 s of live combat + 25 s of taking damage produced **zero** links.
  - **WHAT IT FOUND (4 programs the warmup never touched, all born from a streamed GLB).** `_addSpectralGhost` on a **skinned** `MeshBasic(map)` (v35.92 monsters) and its unmapped twin, `_addGutsShader` on a transparent `MeshBasic` (v32.69 death gibs), and the opaque full-bright `MeshBasic(map)` of `_champSelfIlluminate`. None can be reconstructed by "a material that looks like it": `USE_SKINNING`/`USE_MAP`/`OPAQUE` all fork the key and the two hooks carry their own `customProgramCacheKey`. Fix = `_buildModelWarmGroup()` (real factories on a **1-bone synthetic `SkinnedMesh`** — r165 keeps bone matrices in a texture so bone COUNT is not in the key), added to the scene beside the warmup's own prototype `group` so it rides the existing rtScene compile + render *and* the frame-yield budget. It is added a second time by `_warmRealCombatFX` (cache hits; that path is the only warm on standalone Quest, where the whole body is skipped).
  - **MEASURED, same machine, back-to-back (RTX 5050 laptop / ANGLE-D3D11, endless, 144 Hz).** BEFORE: first monster **attach** = **26.1 / 31.6 ms** frame (2 links, and *neither was the program combat uses*); first monster **death** = **16.2 ms** frame (the guts link, at draw time); the real combat ghost program **was never warmed at all** (proved by probe (1) linking a 3rd, 14794-char program); champion-shell full-bright = 1 more. AFTER: **0 links** across ~2 min / 15,559 frames of live play covering all 6 monster attaches, a monster kill, 4 biome swaps incl. a storm reach, waves and a life lost; probe (1) now links **0**; frame times median **6.9 ms**, p99 **8.7 ms**, **144 fps**, zero console errors. COST, all behind PREPARING ARENA / the countdown: `[warmup]` **216.2 → 235.5 ms** (+19.3), `_warmRealCombatFX` countdown frame **66.1 → 71.9 ms** (+5.8). ⚠ Putting the whole thing in `_warmRealCombatFX` instead turned that countdown frame into **615 ms** — the loading-overlay warmup is where this belongs.
- **(v36.18) WARMUP AUDIT, PASS 2 — the CAMPAIGN GLB paths (the v36.17 run was endless-only).** Same method, same rig. Two paths that endless can never reach: `BossPortal`/`_preloadCyanRing` and `ChampionShell`/`_champSelfIlluminate`. **Jump:** entry `6` of `_buildModelWarmGroup` (PART 15) · `class BossPortal` (~L40024 working) · `class RaceRing`.
  - **HOW TO REACH THEM WITHOUT GRINDING A CAMPAIGN.** Both have a short, *unmodified* path. **Boss portal:** the CAMPAIGN button's brand-new-player route (`startCampaignJourney` → `_campHubSetup` → `commitLoadout('VORTEX')`) drops you in `hub_overworld` and `HubMode` spawns a real `BossPortal` at `(0,200,3200)` after a 2.5 s dwell — so the ring enters a **gameplay** frame ~3 s after PLAYING. To control *when*, set `game._campJourney = false` right after the click (kills the spawn), drain probe (1) to 0, then set `game._campJourney = game._campRiftArmed = true` and watch the next frames. Keep the player >950u away or the fly-through warps you into The Approach. **Champion shell:** `LSS.MODE === 'assault'` spawns the champion field the moment the round opens (`_championDue` is just `game.state === 'playing'`), so ASSAULT → any ship → CONFIRM gives you a live `ChampionShell` on the real `Sphere.glb` inside ~10 s. ⚠ `game.state` is already `'playing'` while `_warmupCombatShadersBody` runs in the SAME rAF tick, so links in the transition frame are warmup links wearing a `playing` label — attribute by frame index, not by state alone.
  - **WHAT IT FOUND (1 program, the biggest in the game).** `cyanring.glb` is the **only** streamed model cloned with NO material conversion — `_cyanRingProto.clone(true)` in `BossPortal._buildMesh` and `RaceRing._buildMesh` keeps the GLB's `MeshStandardMaterial` (map + normalMap + emissiveMap + roughnessMap + metalnessMap, DoubleSide, opaque), which needs a full `physical` program of **99,269 chars** — vs ~32 k for the largest thing the warmup was building. Because the portal spawns MID-MATCH it linked in the first frame that DREW the ring: **37.4 ms against a 7.0 ms median / 10 ms p99** — one dropped frame at 144 Hz, exactly as the rift appears. Fix = entry `6` of `_buildModelWarmGroup`: a hand-built stand-in on a 3-vert position/normal/uv `BufferGeometry`, which is exact here in a way it never is for the `onBeforeCompile` materials (no hook, no skinning) — **verified by cacheKey, not by eye: real clone and pin are byte-identical** (`physical,STANDARD,,highp,srgb-linear,306,1024,uv,...,3,12,1,0,1,...`), in `hub_overworld` and `assault_causeway` alike. ⚠ Two things that look like they must matter and provably do not on r165 — do not "fix" them: the 1×1 map's **colorSpace** (sRGB decode is the texture's internal format, not a `#define`, so ONE `DataTexture` serves all five slots) and the **missing tangent attribute** (three derives the TBN in-shader when there is none). The `306,1024` env field comes from `scene.environment`, which is why this has to ride the live scene like every other pin here. Deliberately NOT mode-gated: the group is memoized per page, so a "campaign/race only" gate would permanently miss the ring for anyone who opened endless first and then walked into the campaign hub.
  - **WHAT IT CLEARED.** `ChampionShell` was **confirmed, not assumed** — a live assault shell on the real `Sphere.glb` proto linked **0** programs, and its material's cacheKey is byte-identical to pin `4` (`_champSelfIlluminate` yields `MeshBasic(map)`, white, opaque, FrontSide). Also 0 via probe (2), signature-tested off the real GLBs: the champion **fallback husk** (Icosahedron + transparent MeshBasic) and both **TorusGeometry fallback gates** (`BossPortal` 0.8 / `RaceRing` 0.7 opacity) — all three ride warm transparent-MeshBasic programs already. `RaceRing` needs nothing of its own: it clones the same proto, so entry `6` covers the Pole Position gates too.
  - **MEASURED (RTX 5050 / ANGLE-D3D11, 144 Hz, pane displayed).** BEFORE → AFTER at the portal spawn: **1 link / 37.4 ms frame → 0 links, max frame 7.9 ms** over 1398 playing frames with the ring on screen (median 6.9, p95 7.2, p99 7.4); probe (1) links **0**. Cost: the three PBR variants (tone-mapped screen, untone-mapped screen, rtScene) now link during the warmup for **2.4 ms** of blocking driver time total (0.5 + 1.0 + 0.9 ms of `getProgramInfoLog`) — `[warmup]` itself is 703/470/896 ms BEFORE vs 643/695/615 ms AFTER over 3 runs each, i.e. the add is far inside the run-to-run noise. No regression: assault (1465 frames, med 7.0 / p99 7.8) and endless (1989 frames, med 6.9 / p99 9.1) both 0 links at `playing`, probe (1) 0, zero console errors.
  - **⚠ The NON-model gap this pass tripped over — FIXED in v36.19, see the entry below.** Four postFX `ShaderMaterial` programs linked at `playing` in `hub_overworld`, ~5 frames after the overlay cleared.
- **(v36.19) WARMUP AUDIT, PASS 3 — the postFX chain was never pinned, in ANY mode.** **Jump:** `let _postFXPinned` / `function _pinPostFXPrograms()` (immediately after `_pinCombatEffectPrograms`) · its one call site in `commitLoadout` (the line after `showLoadingOverlay('PREPARING ARENA')`) · the deleted "postFX shockwave path pre-warm" block in `_warmupCombatShadersBody`.
  - **TWO defects, compounding.** (1) **Coverage:** nothing in the file ever drew `postFX.brightQuad` or `postFX.blurQuad` outside `renderPostFX`, and the one pre-warm draw of `postFX.compositeQuad` bound **`postFX.rtBlurH`** — a target `renderPostFX` never composites into (it composites ONLY to `null`). Binding an RT makes three.js strip the tone-mapping chunk, so that warm linked a **separate 12,402-char program with no consumer anywhere in the game**, while the three the game actually executes — bright-pass 4,484 / blur 4,637 / composite-to-screen 15,979 — stayed cold and linked lazily on the first full-quality `renderPostFX` frame of the page. (2) **Timing:** that block sat behind six `await _warmupYield()` calls, so it ran many rAF turns after `commitLoadout` returned — in the hub, *inside gameplay*.
  - **WHY THE HUB AND NOT ENDLESS/ASSAULT — the asymmetry, settled.** The warmup→playing gate needs `warmupTimer <= 0 && !selectActive`. Endless/assault hold BOTH (their `warmupTimer` never starts ticking, and `#ship-select` keeps `.active` until `finishLaunch`), so they sit in `'warmup'` for the whole PREPARING ARENA window — every frame of which is a full-quality postFX frame. **They linked the same programs; they just did it under the overlay**, which is why a probe filtering on `'playing'` scored them clean. The brand-new campaign hub is the ONE route that opens both halves at once: `_campHubSetup` sets `LSS.MODE='freeflight'` (pinning `warmupTimer` to 0 on desktop) and `startCampaignJourney` strips ship-select's `.active` *before* calling `commitLoadout`. So it reaches `'playing'` on the first tick and pays in open play. Neither the returning-player picker, nor the campaign combat legs, nor EXHIBITION reproduce it.
  - **THE FIX.** `_pinPostFXPrograms()` — three REAL draws (bright→`rtBright`, one blur→`rtBlurH`, composite→**screen**), called **synchronously from `commitLoadout`**, not from the warmup body. Synchronous placement is the load-bearing decision: it provably runs before ANY gameLoop tick of the new match in every mode, and it is immune to the hidden-page hole where `_warmupYield` falls back to `setTimeout` while `gameLoop` skips rendering entirely (an alt-tabbed warm can finish having rendered nothing). Bright+blur are gated on `postFX.enabled` — on bloom-off tiers `renderPostFX` permanently takes its two-pass shortcut so they can never execute; the composite is warmed on every tier because that shortcut still composites to `null`. One blur draw suffices: `direction`/`resolution` are UNIFORMS, not defines, and `rtBlurH`/`rtBlurV` match in size and format.
  - **⚠ NEVER touch `renderer.toneMapping` in the pin.** It is ACESFilmic for the whole session and the SCREEN variant is the one the game draws; forcing `NoToneMapping` "for symmetry" pins the dead 12,402-char variant and leaves the real one cold — which is precisely what the deleted block did. **⚠ `finally`, not `catch`,** for the restores: the deleted block kept its restores inside the `try`, so a throw at the render left `compositeQuad.visible = true` and the damage uniforms pinned at 0.001 for the rest of the session, silently. **⚠ Never hide the screen draw with `setScissorTest`/`colorMask`** — three caches that state and a leaked scissor clips the whole session. It is invisible anyway: black-in/black-out with the grade at identity, inside the click task, behind an overlay that went `.active` one line earlier.
  - **MEASURED, paired A/B, same machine, campaign hub (RTX 5050 / ANGLE-D3D11, 144 Hz).** BEFORE (v36.18): **4 links at `playing`**; commit frame **428.9 ms**; and a **544.9 ms gameplay frame** five frames in, containing the 12,402-char RT variant whose `getProgramInfoLog` blocked **454.1 ms** (234.4 ms and 30.5 ms in two earlier runs — it varies with driver state). AFTER (v36.19): **0 links at `playing`**; all three real programs link in the commit frame (syncs 12.7 / 1.0 / 1.9 ms, targets RT / RT / **screen**, `toneMapping` = ACES on all three); the 12,402-char program **no longer exists at all**; commit frame **398.9 → 398.3 ms** (it got *cheaper* — the dead 454 ms link is gone and the three real ones were always going to be paid). Endless regression: 0 links at `playing`, probe (1) 0, 719 frames median **6.9 ms** / p95 8.0 / p99 8.6 / **max 12.5 ms**, zero console errors.
  - **⚠ A trap this leaves behind for future audits.** In the campaign hub `game.state === 'playing'` while the whole async warm body, the bulk asset preload and the clipmap bake are still running — so ANY link the warm body performs is labelled `'playing'` there. Do not read that as a gap without checking the frame index. Fixing it properly needs a purpose-made flag set synchronously in `commitLoadout` and cleared in the same `.then`, and its own test pass; every obvious shortcut (`_countdownActive`, `!_localWarmupReady`, editing the `testMode` branch of the gate) is either inert or breaks the hub player's movement clamp.
  - **⚠ NOT postFX: the hub still has one ~398 ms frame — the CONFIRM/commit frame itself,** which contains zero links. That is `commitLoadout`'s synchronous world build (and, per the dossier, most likely `_clipBuild()`'s clipmap bake on the first hub frame). It is the next target if the hub's launch stall is revisited; it is not a shader problem.
- **(v36.23) WARMUP AUDIT, PASS 4 — WHAT IS ACTUALLY ONCE-PER-SESSION, and the `scene.environment` fork that beat every pin** (owner: *"the warmup before the match is taking much longer than it used to. shouldn't the warm up only need to happen once per session, as well? or depends how much ram the device has?"*). **Jump:** `function _programEnvSig` (immediately above `_pinCombatEffectPrograms`) · `let _pinnedEnvSig` · `let _warmedFXSig` (replaces `_warmedRound`) · the `(v36.23)` pin call at the end of `_wxInit`.
  - **THE GATE INVENTORY (measured, not read).** Once-per-session and correct: `warmupCombatShaders` (`_shaderWarmup.done`), `_warmupEffectShaders` (`_shadersWarmed` — ⚠ this is the PARTICLE/LIGHTNING pool warm, **not** the big body; they are two different functions and only the second is what `_shadersWarmed` names), `_pinPostFXPrograms` (`_postFXPinned`), `_buildModelWarmGroup` (memoised). **Ungated:** `_pinCombatEffectPrograms` re-ran on every commit and every round; `_warmRealCombatFX` was gated on `game.currentRound`, which is a proxy that fails in both directions. Both now key on `_programEnvSig()`.
  - **RAM IS NOT THE AXIS — compile TIME is.** A linked GL program lives in the GL context for the life of the page; its cost is the driver's compile+link plus the *blocking* `getProgramInfoLog` validate on first use, not memory. Nothing here should be tiered on device RAM. The tiers that already exist are the right ones and are unchanged: standalone Quest skips the whole warm body, `_LSS_IS_MOBILE` chunks the pin across frames, potato skips the guts warm, `_SHIPL.CONE_N === 0` skips the cone pin.
  - **THE REAL FIND — three.js keys programs on `envMapCubeUVHeight`, and the hub swaps `scene.environment` out from under every pin.** `_wxInit` installs a PMREM of a 64×32 equirect (`_wxMakeDayEnv`) whose cubeUV height is **64**; the base procedural / HDR env is **1024**. Every `physical` program in the scene therefore forks. Proved by experiment, not inference: on a settled campaign scene, swapping the env to a fresh 64-height PMREM and calling `renderer.compile` linked **4 programs immediately (98,840 / 111,034 / 98,827 / 108,986 chars)**; restoring the env linked **0**. In a real session that landed as the **99,268-char cyanring program** (the v36.18 pin, the biggest in the game) linking **in a gameplay frame with a 188.5 ms blocking `getProgramInfoLog`** — the exact hitch v36.18 believed it had killed. The v36.18 audit could not see it because it tested `hub_overworld` and `assault_causeway` *as first entries*, where the env swap happens during the world build, before the pins.
  - **THE FIX, three parts.** (1) `_programEnvSig()` — a string of the SCENE/RENDERER-level terms of `getProgramCacheKey`: fog presence+type, env (`image.height`:mapping:colorSpace:isRenderTargetTexture), `shadowMap.enabled`/`.type`, `toneMapping`, `outputColorSpace`, clipping-plane count + `localClippingEnabled`, `xr.isPresenting`, and the eight light/shadow counts. **⚠ Nothing outside that key may go in** (fog colour, fog density, light intensity/position, texture contents, uniform values) — a signature that moves when the programs cannot is the old unconditional re-pin with extra steps. Returns `null` on any throw, and **`null` never memoises**. Cost 0.04–0.2 ms on the campaign hub scene. (2) `_pinCombatEffectPrograms` early-returns when the signature equals `_pinnedEnvSig`, and now takes `_buildModelWarmGroup()` along for the compile (add/remove only when it is not already parented, so the warm body's own add/remove pairing survives the call it makes into this function). The MOBILE chunked path deliberately does NOT take that ride — its slices re-parent children into a holder and back into `_fxPinGroup`, which would permanently steal the model group's meshes. (3) `_warmRealCombatFX`'s `_warmedRound` gate becomes `_warmedFXSig`; it claims the signature before the body so the double call at `warmupTimer<=2` and `<=0` can't double-run. Plus one new call site: `_pinCombatEffectPrograms()` at the end of `_wxInit`, immediately after the env swap and `_wxShadowsOn()` — signature-gated, so it is a ~0.1 ms no-op whenever the hub was already pinned under this env.
  - **WHY THE ROUND NUMBER WAS WRONG BOTH WAYS.** FALSE SKIP: `game.currentRound` resets to 1 every fresh match, so match 2 of a page load skipped `_warmRealCombatFX` entirely whenever match 1 was also on round 1 — and a campaign death re-entry / hub↔leg move keeps the round number while swapping the env outright. FALSE RUN: a match that ended on round 3 followed by a new match at round 1 re-ran the whole thing in an environment already covered.
  - **MEASURED, same machine (RTX 5050 / ANGLE-D3D11), CONFIRM → `game.state==='playing'`, fresh page load per mode, M2 reached via the internal soft `returnToMainMenu({})`.** *M1 warm block* = CONFIRM → `hideLoadingOverlay`. v36.22 → v36.23: endless **472→543 ms** M1 / **151→129 ms** M2; elimination **562→547** / **167→159**; race **703→551** / **204→196**; assault **639→635** / **173→160**; exhibition **1386→1315** / **435→417**. Per-stage, the whole point: `_pinCombatEffectPrograms` **8–54 ms every call → 0–0.3 ms on every repeat** (11 consecutive calls at 0.0–0.1 ms across a campaign double-run), and `_warmRealCombatFX` **55–594 ms → 0.1–0.2 ms** whenever the environment is unchanged. **Race M1 is the standout: `_warmRealCombatFX` 594.1 → 119.1 ms**, because the commit-time pin now covers the GLB/PBR set the race world is full of (pin 27.2→35.6 ms), i.e. **621 → 155 ms** for that pair. Elimination rounds 2 and 3: both pins **0.0–0.3 ms**, signature byte-identical across rounds.
  - **VERIFIED — no first-sight-hitch regression.** Campaign hub double-run: **20 links at `playing` (incl. the 99,268-char / 188.5 ms one) → 0**, probe (1) 0. Endless combat soak with the player firing: **19,919 frames, 0 links, probe (1) 0**, frame p99 10.4 ms / max 22.7 ms. Endless / elimination (3 rounds) / race / assault: **131 links total each, 0 at `playing`, probe (1) 0**. Exhibition: 258 → **248** total links (fewer forks, better pin ordering), 0 at `playing`. Zero console errors and zero unhandled rejections in every run. ⚠ In the two hub-based modes probe (1) links **one** 5,557-char program on its first call and 0 thereafter — a scene-resident object the game never draws; identical on v36.22, sub-millisecond, not a regression.
  - **⚠ AND THE ANSWER TO THE OWNER'S ACTUAL QUESTION.** Yes, it is once per session — but **a session is one match for almost every player**, because the only two user-facing routes back to the main menu (`#settings-exit-to-menu` and the ship-select MAIN MENU button) both call `returnToMainMenu({hard:true})`, which is a **full page reload** (v35.83, owner-directed revert of the soft path). So the once-per-session gates only ever pay off for between-round ship swaps, campaign re-entries and the campaign hub↔leg moves. Nothing in the warmup can fix that; it is a `returnToMainMenu` question. **Also: the warmup is not where the pre-match wait lives.** Of a 9.5 s endless CONFIRM→playing, the warm block is 0.47–0.55 s; **6.0 s is the intro cinematic and 3.0 s is the countdown**. The "much longer than it used to" the owner felt was almost certainly v36.16–36.21 chaining the 193 MB `preloadAllAssets` into the launch behind PREPARING ARENA — removed in v36.22, before this pass.

#### Explosion system (mesh pool, debris, sparks) — `~L28285`
**Jump:** `function spawnExplosion` (~L28841) · `const _EXPL_POOL` (~L28296)
- **Symbols:** `_EXPL_POOL`, `_acquireExplosionMesh`, `v8SpawnDebris`, `v8SpawnSparks`, `applyExplosionPush`, `spawnExplosion`
- **⚠** Explosion MESH pool is fine (unlike projectile visuals); `_EXPL_POOL_CAP` bounds it.

#### Zone & cloud theming — `~L29221`
**Jump:** `const ZONE_THEMES` (~L29328)
- **Symbols:** `OBSTACLE_SHAPES`, `ZONE_THEMES`, `applyZoneTheme`, `CLOUD_THEMES`, `_getEffectiveCloudColor`

#### Destructible & cluster obstacles — `~L29708`
**Jump:** `class DestructibleObstacle`
- **Symbols:** `DestructibleObstacle`, `_makeRockGeometry`, `_makeAtomFractalMaterial`, `spawnRockChunks`, `ClusterObstacle`

#### Voxel rooms & dynamic object population — `~L30940`
**Jump:** `class VoxelRoomSystem` (~L31467)
- **Symbols:** `_vxFbm3D`, `VOXEL_ROOM_THEMES`, `VoxelRoomSystem`, `_voxelRoomsRebuild`, `spawnDynamicObjects`
- **⚠** `_vxTextureCache` memoizes heavy per-theme bakes.

#### Detached gas pockets, basin clouds & chemistry — `~L31986`
**Jump:** `function updateDetachedGasPockets` (~L32239) · `function updateGasChemistry` (~L32555)
- **Symbols:** `_spawnBasinClouds`, `updateDetachedGasPockets`, `_buildGasPocketChemBuckets`, `updateGasChemistry`
- **⚠** Chemistry uses per-tick spatial hash buckets to avoid O(n²).

### ═══ PART 14 — Monsters, champions, bosses, race (~32695–34400) ═══

#### Monster defs & shaders — `~L32695`
**Jump:** `const MONSTER_DEFS` · `const MONSTER_BASE_URL` (~L32760)
- **Symbols:** `MONSTER_DEFS`, `_addBasicRim`, `_addGutsShader`, `_addSpectralGhost`, `_monGhostTimeU`, `MONSTER_BASE_URL`
- **(v35.92) SPECTRAL GHOST monsters — OWNER FEATURE.** Monsters phase through walls by design, so every monster GLB reads as a ghost/hologram in ALL modes: `_addSpectralGhost(mat, tint)` (next to `_addGutsShader`) is applied at the SINGLE material-prep point — `OutskirtsMonster.attachModel`'s MeshBasic conversion — replacing the old desktop-only `_addBasicRim` call (now applied on ALL tiers incl. mobile; `_addBasicRim` itself still used by campaign bot rims ~L8266). Fresnel-driven opacity (core ~0.42, rim ~0.9), per-def `MONSTER_DEFS.ghost` tint (default cyan-violet 0x8ad8ff), ~7 Hz flicker + screen-space scanlines via `uGhostTime` = the ONE shared `_monGhostTimeU` object, ticked once per frame at the top of `updateMonsters` (wraps at 1h). `transparent:true, depthWrite:false` — verified in screenshots: x-ray layering reads as intentional hologram, no bad self-sorting; **NormalBlending chosen over Additive** (A/B tested live: additive washes the body texture into a shapeless glow). One shared program (`customProgramCacheKey 'spectralGhost'`); skinning untouched (materials only), animations verified live. `spawnMonsterGuts` gib palette lerped toward the ghost tint (~45%) so the death burst reads as the apparition shattering, not meat out of a hologram — gut shader/physics untouched. ChampionShell deliberately NOT ghosted.

#### AEGIS perk trees — the v36.66-36.69 correction pass (COMPLETE: all 35 perks)

**Jump:** `AEGIS.TREES` · `function _aegisUpFor` · `function _aegisShipUpgrades` · `function _aegisDmgOut` · `function _perkEffectiveBag` · `function _pyroBurstN` · `function _syphonChainZap` · `function _aegisSonarLit` · `function _tickTrackerSonarDOT` · `function _pyroGasIgniteBlast`

**Gates:** `node tools/aegis_perk_check.cjs` (asserts all 35 perks have a site in the RIGHT function, plus 6 regression guards) · `node tools/aegis_burst_sim.cjs` (lifts the real PYRO drain block out of the file and runs it at a fixed timestep).

- **(v36.66) `AEGIS.TREES` IS NOW THE OWNER'S CORRECTED SPEC, transcribed verbatim** (owner: *"in exhibition and endless, i noticed the aegis abilities are wrong and not working... i fixed the description... i hope we can use it to build them right"*). **The table text is the REQUIREMENT; implementations follow it, never the reverse.** The old table had drifted off the real weapons (Predator Cannon / 40mm / Tether Traps / Electric Smoke / Phase Dash are not what those ships use), and **six perks changed MEANING**: PYRO 2 & 17 (clip capacity → a per-trigger BURST), TRACKER 17 (sonar duration → damage-over-time), BLASTER 8 (bypass Doomed → wider + double damage), SYPHON 8 (sniper config → chain lightning), SYPHON 20 (random core upgrade → double Rocket Salvo).
- **AUDIT RESULT (7 parallel read-only agents, one per ship + synthesis):** of 35 ship perks, **12 correct · 20 implemented-but-wrong · 3 missing**.
- **⚠ ROOT CAUSE #1 — `_aegisDmgOut` CANNOT SEE WHICH WEAPON FIRED.** 14 perks were implemented as a one-line multiplier inside it, but it is called from ONE place and receives only a NUMBER. It cannot tell a Laser from a hip-fire shot or a thermite bolt from a gas cloud, so **every perk naming a specific weapon became "+15% to everything this ship does"** — you unlock "Laser Power", the Laser is unchanged, and your main gun quietly got better. Fixing those means moving each rider to its weapon's own fire path.
- **⚠ ROOT CAUSE #2 — five perks point at the WRONG ABILITY** after the rewrite: SLAYER 8/17 buff the chassis dash instead of Teleport, TRACKER 20 buffs the Rockets ABILITY instead of the Mega Tracker Rockets CORE, BLASTER 20 grants a pilot perk that was DELETED in v36.53, PUNCTURE 11 halves a cooldown instead of granting a charge.
- **(v36.67) FIXED — the gap nobody owned: the aegis rider never reached MONSTERS.** `_aegisDmgOut` had exactly one call site (`Bot.takeDamage`), so leviathans, the campaign boss and destructibles received **no aegis damage rider for any of the seven ships**. In endless the wave enemies are Bots (riders fired), but every leviathan fight was perk-free. Now applied in **both** monster `takeDamage` methods, BEFORE the authority split so the boosted number is both subtracted locally and forwarded in the `mon_dmg` claim. One edit, fixes all seven ships.
- **(v36.67) FIXED — SYPHON 20 Apex Ship could never fire.** `player.syphonMissileRacks` was declared on the singleton, reset on spawn, and READ by Rocket Salvo (`rocketCount = racks ? 10 : 5` — exactly the "double the missiles" the spec asks for) — but **nothing in the codebase ever set it**. Three references, no writer. The old code granted a 60% core charge instead, matching neither the old description nor the new one. Now an absolute assign in `_aegisShipUpgrades` (idempotent under the mid-run re-apply). Verified live in endless: forcing rank 20 flips `syphonMissileRacks` false → true.
- **(v36.67) FIXED — VORTEX 20 Reflex Cannon was capped at the base duration.** ⚠ An audit pass called it "mathematically incapable of doing anything"; **that is overstated and I verified it false** — `Math.min(4, timer + 2.5)` genuinely lifts a decayed timer (1.5 → 4.0). The real defect is the CEILING: the cap equalled Mega Laser's stock 4 s, so a kill could only ever REFRESH the core, never extend it past its normal run, and a late kill was worth as little as +0.1 s. Cap is now `duration * 2`.

**(v36.68/69) THE REMAINING ~17 ARE DONE. The governing move was structural, not per-perk: every rider that named a weapon LEFT `_aegisDmgOut` and moved into that weapon's own fire path.** `_aegisDmgOut` now holds only the five perks that really are "this ship deals more damage, full stop" (PYRO 8/11, SYPHON 2/17, SLAYER 2) — `tools/aegis_perk_check.cjs` guards that count so it cannot silently become a dumping ground again.

Where each re-homed perk now lives, and what it was doing before:

| perk | now lives in | was |
|---|---|---|
| VORTEX 2 Zoom Power | `fireHitscan`, inside the **ADS branch** (`x1.30`) | blanket ship damage |
| VORTEX 11 Laser Power | `executeAbility` — `_vlDmg` swapped at all **3** laser sites | blanket ship damage |
| PUNCTURE 17 Critical Hit | `fireHitscan` — flat `x1.25` **plus** a per-pierce ramp `x(1 + i*0.25)` | blanket ship damage |
| PUNCTURE 2 Explosive Traps | `updateWorldEffects` — `eff._broke` restructure, 520u AoE, explosion size 45 | fired only on clean timer expiry |
| TRACKER 2 Splasher Rounds | `fireProjectile` — `_splash *= 1.6` (a RADIUS change, as written) | blanket `+15%` damage |
| TRACKER 8 Sonar Weak Points | `_aegisSonarLit(bot)` — real 8 s lit window off the sonar stamp | blanket ship damage |
| TRACKER 17 Signal Strength | `_tickTrackerSonarDOT` — 200 dps over the lit window | a no-op |
| BLASTER 8 Executioner | `firePowerShot` — `_execDmg` x2 and spread 0.12 -> 0.20 | bypassed Doomed |
| BLASTER 17 Drill Shot | `firePowerShot` — `_csHits` collect-sort-apply, `x(1 + ci*0.35)` per pierce | flat bonus |
| SYPHON 8 Electric Zapper | `_syphonChainZap` — 3 jumps, 900u, 0.55 falloff | sniper config |
| PYRO 20 Explosive Gas | `_pyroGasIgniteBlast` on first ignition | nothing |

- **⚠ NEVER WRITE `w.splash` (or any `w.*`) IN A FIRE PATH.** `w` **IS** `player.weapon`, a **live reference into the `LOADOUTS` table** — assigned, not cloned. `w.splash *= 1.6` would permanently enlarge TRACKER's splash for every ship, every mode, the rest of the session. Compute into a local and pass it. `aegis_perk_check.cjs` guards this one directly.
- **(v36.68) PYRO 2/17 are a REAL BURST now** — `_pyroBurstN` / `_PYRO_BURST_GAP` (0.11 s) / `_pyroBurstLeft`. They used to add +1/+2 to `maxClip`, which is a bigger MAGAZINE, not a burst: still one bolt per pull. **⚠ The remainder MUST drain ahead of the reload gate in `updateShooting`** — a pull that empties the clip calls `startReload()`, and a drain sitting after it silently eats the last bolt. **CREATIVE CALL, flagged:** 3 bolts at the unchanged 1.2 s fire rate is a flat x3 DPS, far outside the 20-60% band every other Aegis perk lives in and enough to make Triple Threat the only correct pick in the game. The bolts are real (each with its own splash and its own thermite ignition — the feel the spec describes) but the per-pull TOTAL is `_PYRO_BURST_TOTAL` = x1.45 / x1.75, split across them. State is cleared at **both** the commit and respawn sites, or a dead pilot's owed bolts fire into the next life's first frames.
- **(v36.68) BLASTER 20 Dreadnaught Cyborg is one merged BAG, not five special cases** — `_perkEffectiveBag()`. The pilot-perk system is entirely data-driven: consumers resolve `PILOT_PERKS[player.perkId]` and branch on which FIELDS are present, so "all five at once" is one merged object handed to those same consumers, and every perk keeps running through its own code. **⚠ Merge is by FIELD NAME**; no two perks collide today, but a future duplicate field would silently take the later key — add an explicit max/sum rule rather than trusting key order. `outlineAll` stands in for the id check, because the bag cannot BE all five ids at once. **⚠ Extra Dash is the one exception** (`maxDashes` is a commit-time `+=`, not a per-frame read), so `_aegisShipUpgrades` tops it up as a chassis-DERIVED setter behind a `<` guard — idempotent under the repeated re-apply and a no-op right after a commit already applied it.
- **(v36.68) FOUND BY THE NEW GATE — BLASTER 20 was granting the deleted +1000 shield TWICE.** Two independent copies of the same stand-in (one in `_aegisShipUpgrades`, one in `EndlessMode._aegisApplyAbilities`'s `_absDone.b20`), so an endless BLASTER got **+2000**. Both were re-granting `Reinforced Shield` — a pilot perk **DELETED from `PILOT_PERKS` in v36.53**. Both are gone; the perk needs no stat grant on either path now.
- **(v36.68) TRACKER 20 was buffing the wrong thing entirely.** The spec says *"Mega Tracker Rockets fires more missiles"* — that is the **CORE**. The code boosted the **Tracker Rockets ABILITY** volley, so rank 20 buffed something the perk never names while leaving its actual subject untouched. Now `_mtrN` 8 -> 12 in `activateCore` **and** `_mtrRate` 10 -> 15/s in the per-tick spawner — both halves, or a +50% opener is swamped by 3 s of unchanged trickle.
- **(v36.68) SLAYER 8 / PUNCTURE 11 both reuse the `trapCharges` counter.** SLAYER 8 gives Teleport two charges, PUNCTURE 11 gives Stasis Trap two — joining PYRO's Explosive Gas on the same counter. **Safe ONLY because they are three different ships**, so no loadout ever wants two of them at once; `trapCharges`/`maxTrapCharges` are already 2 on the base player object, so nothing needed initialising. SLAYER 8 previously added a chassis DASH charge, and PUNCTURE 11 previously halved a COOLDOWN — a halved cooldown is not a charge, it never let you place two back to back, which is the whole point.
- **SYPHON 11 needed inventing** — "gives nearby friendly Ships shield too" has no meaning in a solo match, so the perk would read as dead half the time. Shares 400 shield with allies within 2200u; **with no allies in range it banks the same value as overshield instead**, so the rank is never worthless.
- **⚠ The parallel audits COLLIDE and must be merged before applying.** Four agents rewrite four adjacent branches of `_aegisShipUpgrades`; three rewrite the SAME `isTrapCharges` line in `activateAbility`. Applying them sequentially loses edits silently — which is why `aegis_perk_check.cjs` asserts each perk sits in a NAMED function rather than merely existing somewhere.
- **⚠ VERIFICATION LIMIT, stated plainly:** all 35 are implemented, `strip.py` is code-identical + `node --check` clean, both offline gates are green, and the shipped build boots with **zero JS errors**. But the per-perk BEHAVIOUR at rank 20 is **not** live-verified — solo has no rank-forcing hook (only endless does), and endless could not be reached from the sandbox: the trystero relay is unreachable, and with the Browser pane hidden `document.hidden` is true, so `requestAnimationFrame` is throttled and the match never leaves `warmup`. **A hidden pane is why warmup stalls — it is not a code bug.** Re-check the ranks against a visible pane before treating them as proven.

#### AEGIS SCOPE — which system applies WHERE (v36.70 containment pass)

**Gate:** `node tools/aegis_scope_check.cjs` (16 assertions).
**Jump:** `function _aegisSoloOnly` · `function _aegisAbilityRank` · `function _aegisApply` · `function _aegisAwardXp` · `_aegisSetLvl` · the `run.lives <= 0` branch in `EndlessMode.update`

**There are TWO unrelated things called "Aegis" and every bug in this area is one leaking into the other's territory.**

| | System A — permanent perk trees | System B — endless surge |
|---|---|---|
| anchors | `AEGIS.TREES` / `_aegisUpFor` / `_aegisShipUpgrades` | `run.aegis` / `_aegisSetLvl` / `_endlessAegisDmgOut` |
| earned by | per-ship XP from hub kills | bolts collected inside one run |
| persistence | localStorage `lss_aegis` **+ account sync** | none — dies with the run |
| applies in | **SOLO EXHIBITION ONLY** | endless only, solo **and co-op** |

Both feed the same `_aegisAbilityRank()` choke point, which is why `_aegisUpFor` can be a single mode-blind predicate: **every perk must keep reading through it.**

- **⚠⚠ THE TRAP THAT CAUSED ALL OF THIS: `LSS.MODE === 'freeflight'` IS NOT "solo exhibition".** `startFreeFlight()` sets `LSS.MODE = 'freeflight'` and **then** branches into `_startHostedMode()`, and the drop-in joiner sets it too — so a **shared** EXHIBITION room is `'freeflight'` as well. From v34.94 to v36.69 the comment above `AEGIS.LIVE` claimed *"freeflight-only, so MP balance is untouched"* and **nothing enforced it**: a rank-20 grinder carried +2500 hull, +2500 shield, doubled clip, doubled missiles, ×1.5 dash damage, ×2 core duration and all five pilot perks into PvP against peers who had none, and farmed the persistent ladder off those kills. **(v36.70) `_aegisSoloOnly()` (tests `net.active`) now gates `_aegisAbilityRank`, `_aegisApply` and `_aegisAwardXp`** — the rank read, the stat grant, and the XP award, so nothing half-applies.
- **ENDLESS IS DELIBERATELY EXEMPT from the solo gate** and the endless branch must stay **ahead** of it in `_aegisAbilityRank` (asserted). Its ranks are per-run, earned inside the run by whoever is present and destroyed with it, so no persistent advantage crosses into a co-op room — gating it would break co-op endless for zero balance gain. **Endless granting System A's perk *effects* is intentional (v36.52), not a leak.**
- **(v36.70) FIXED — co-op endless never discharged the surge on RUN OVER.** The run-over branch is guarded `!(net && net.active && net.endless)` so a co-op player who runs out of lives deliberately stays in-world spectating and **never reaches `returnToRootMenu` → `onTeardown`** — the only site that called `_aegisSetLvl(run, 0)`. So the cloned chassis stayed installed, `a.lvl` stayed maxed, and with `game.endlessRun` still non-null `_endlessAegisDmgOut` kept multiplying for as long as they spectated. **The discharge now happens at the `run.lives <= 0` branch itself**, independent of the return path; `_aegisSetLvl` early-returns at lvl 0 so teardown's later call is a clean no-op.
- **(v36.70) FIXED — the `+2500` additive grants were never given back.** `_aegisApplyAbilities` hands out `maxHealth += 2500` (lvl 5) and `maxShield += 2500` (lvl 14) behind one-shot `_absDone` flags, and **nothing subtracted them** — teardown restored the chassis clone and walked away, leaving an inflated `player.maxHealth`/`maxShield` on the singleton. It only *looked* correct because the next `commitLoadout` happens to overwrite both from the chassis: **a distant coincidence, not a reset.** `_aegisSetLvl(0)` now reverts both and clears `_absDone`, so the next run re-grants at lvl 5/14 instead of finding the flags set and silently skipping.
- **⚠ LOAD-BEARING ORDER in `onTeardown`: discharge BEFORE `game.endlessRun = null`.** `_aegisSetLvl(0)` → `_aegisApplyAbilities` → `_aegisShipUpgrades(true)` needs `_aegisAbilityRank()` to return **0, not −1**, or `_aegisShipUpgrades` early-returns and the boosted clip / dashes / vortex energy pool leak out with the player. Asserted by the gate.
- **(v36.70) FIXED — `respawnPlayer` healed to the CHASSIS maxima, not the player's.** `player.health = ch.maxHealth` ignored the rank-5/14 `+2500`s, so **a ranked pilot respawned up to 2500 hull AND 2500 shield below their real maximum, after every single death, with no way to recover it** — the two universal ranks half-failing exactly where they matter. Now heals to `player.maxHealth`/`player.maxShield` with the chassis as fallback (same shape as the neighbouring `maxDashes` line). This one bit plain solo exhibition, not just the edge cases.
- **Verified clean, no change needed:** the campaign LEGS (`LSS.MODE = 'campaign'`, plus the v35.86 forced re-commit at the rift so hub buffs can't ride in), classic/elimination, assault and race all get `−1`. `CHASSIS` global is never mutated — the speed buff is `Object.assign({}, base, …)` and the restore is an identity assignment guarded on `player.chassis === a.curCh`, so it no-ops rather than clobbering a chassis someone else installed.
- **⚠ OPEN, deliberately not changed:** the campaign **overworld hub** (`_campHubSetup` sets `LSS.MODE = 'freeflight'`) is mechanically indistinguishable from exhibition and so gets the perks. That looks intentional (it *is* the same hub), but it is worth an explicit decision.

#### Outskirts monster AI — `~L32779`
**Jump:** `class OutskirtsMonster` (~L32979) · `function _monStripRootMotion` (~L33551)
Arena-boundary leviathan AI, model streaming, root-motion strip, gib FX.
- **Symbols:** `OutskirtsMonster`, `_initMonsters`, `_monStripRootMotion`, `_loadNextMonsterModel`, `spawnMonsterGuts`, `_faceTarget`, `_monClearLocks`, `_monBotPrey` (v36.62)
- **⚠** `_monStripRootMotion` mutates GLTF clips in place to keep monsters anchored.
- **(v36.62) LEVIATHANS FOLLOW THE NEAREST SHIP, BOTS INCLUDED** (owner: *"in elimination, the monsters should follow and target whoever is closest ship, even bots"*). **Jump:** `function _monBotPrey` (directly above `_monNearestShip`) · the `includeBots` param on `_monNearestShip` · the `else if (this.aggro)` chase branch in `OutskirtsMonster.update`.
  - **The bug was an inconsistency inside the AI, not a missing feature.** `_monNearestZapTarget` has ALWAYS scanned `game.entities` and always called `takeDamage` on bots — so an engaged leviathan already fried whatever ship was closest. But the **chase** scan (`_monNearestShip`) only ever saw the local player and network peers, so the creature would fly toward *you* while zapping the bot beside you. Chase and zap now agree.
  - **Three scans, three different jobs — only ONE changed.** `_monNearestShip(…, requireOutside=true)` = the trespass trigger (**unchanged, player/peer only**), `_monNearestEdgeShip` = the rim-bait dice roll (**unchanged, player/peer only**), and `_monNearestShip(…, false, _monBotPrey())` = the sustained chase + the de-aggro distance test (**now bot-inclusive**). Rationale: *going outside the arena is dangerous for YOU* is the mechanic the trigger exists for, and the trespasser is what gets the `_rushing` surge — bots should not be able to drag the whole pack around before a player has engaged. The user-visible rule is "once it is angry, it hunts whoever is closest."
  - **Mode-gated to `LSS.MODE === 'classic'`** (elimination / solo / exhibition / test) via `_monBotPrey`, deliberately excluding the other bot-bearing modes: campaign hoard waves are staged encounters, endless waves are that mode's own pacing, race bots pace the field — dragging leviathans onto them would derail all three. **Flip the one predicate** if those should follow too.
  - **Consequences worth knowing** (both intended): a leviathan now keeps fighting after you die instead of drifting home, and it can be **baited onto the enemy team on purpose**. Also, because the de-aggro test is bot-inclusive, an aggro'd monster in a busy elimination match stays engaged much longer (any ship within `MONSTER_ZAP_RANGE*1.6` = 1120 u resets the 12 s timer).
  - **⚠ Authority-only, no wire impact.** Bots exist only on the authority and monster AI only sims on the authority (`_monAuthority`), so this adds nothing to `mon_state`; peers still glide to broadcast positions and self-zap off the synced aggro flag. The returned `isLocal` field is dead (nothing reads it), so bots reporting `false` there changes nothing.
  - **Verified live** (v36.62, elimination on hourglass, 6 monsters / 5 bots): monster at origin, bot at +700 x, player at −3000 x → monster accelerated **toward the bot** (x 0 → 378, vx +125) where the old code flew the opposite way; inverse case with **all** bots parked at −3000 and the player at +700 → still chases the player (x 0 → 329), so no regression; bot health measurably drained by monster zaps during free chases (7500 → 5188); 144 fps; zero new console errors. ⚠ Harness note: pinning only ONE bot invalidates the test — the other four roam and one of them is usually the true nearest ship (this produced a false "regression" reading mid-session).
- **(v36.17) `attachModel`'s GPU pre-warm now runs in the COMBAT context.** **Jump:** `attachModel(obj3d, clips)` (~L31459), the two `try` blocks after the material swap. The monster GLBs trickle-load *after* the match starts, so whatever those two warms compile lands in a **gameplay** frame — and on v36.16 both were compiling programs the game never draws with. Two fixes: (1) the `renderer.compileAsync(group, camera, scene)` is now wrapped in `renderer.setRenderTarget(postFX.rtScene)` (unbound it linked the tone-mapped *screen* variant); (2) the v34.19 "thorough boss warm" no longer renders into its own bare `__campWarm.scene` — it renders the **live `scene`** through `_W.cam` (aimed at the creature from `MONSTER_SIZE*2` on +Z) into the same 4×4 `_W.rt`, because that bare scene had no fog and **zero lights**, and light counts are part of the program cache key even for unlit `MeshBasic` (measured cacheKey light fields `3/12/1/0/1` live vs `0/0/0/0/0` there — byte-identical GLSL, different program, 25-31 ms). The live-scene render switches off exactly two things for its one pass: `game._reflBenchOff = true` (the hub water Reflector's full `onBeforeRender` reflection pass — the same knob the bench uses) and `renderer.shadowMap.autoUpdate = false` (autoUpdate gates the shadow *draw*; the shadow light *counts* that fork the key are still collected by `projectObject`, so the key still matches). Also skipped while `renderer.xr.isPresenting`. **⚠ Do not "optimise" this back to an isolated warm scene** — an isolated scene can never reproduce the combat program key. Result: all 6 attaches now link 0 programs (was 2 in a 26-31 ms frame).
- **(v35.97) TRACKER locks work on MONSTERS.** Root cause: every lock path was ship-only. Monsters now carry `m.id = 'mon' + monId` (set in `_initMonsters`; collision-free with bot ids) and all three grant sites cover them — projectile direct hit (monster branch of `Projectile.update`, same `isTrackerMain` + `game.state==='playing'` gate), Tracking Bolt splash (`splashDamage` monster loop, same falloff>0.30 rule), and `sonar_pulse` (own monster loop; wave counts a hit at `radius + collisionRadius*0.5` so it pings the hide, not the center; shared `eff.locked` dedup Set). Consumers bridged: Tracker Rockets target-resolve falls back to `game.monsters` (homing only reads `.alive`/`.position`); `_hudSharedTail` + the `__hudLegacy` block draw rings over lock-carrying monsters; the sonar BEACON detonates its pulse on a leviathan hide instead of dying as a dud. Cleanup: `OutskirtsMonster.die` + `_monRecall` + `_monsterRoundReset` drop that monster's marks via `_monClearLocks` (defined next to `_monRecall`) so rings/rockets never chase a corpse or a hidden dormant beast. Verified live: 3-mark saturation on GraveTitan/StoneShroud, ring+LOCKED screenshot, 5 rockets `trackTarget=mon4` dealt 6349 to it and 0 to every other monster, lock consumed on fire.
- **(v35.97) Monsters no longer "fall over backward".** Root cause: `mesh.lookAt(prey)` in `OutskirtsMonster.update` (chase) + `_updateProxy` aimed the WHOLE body along the 3D line to the target — prey overhead pitched the creature onto its back (all six GLB clips were checked live: zero root-motion rotation leak, tracks are normal bone-level sway, so the clips were innocent). Fix: `_faceTarget(p)` (defined just above `update`) — Euler order 'YXZ', free yaw, pitch clamped to ±0.35 rad, roll forced 0 (also uprights a drift-tumbled body on re-aggro). Idle-drift tumble via `rotVel` is untouched on purpose. Verified live: 29 s hovering directly above a chasing monster — pitch never left ±0.35, roll stayed 0.

#### Champion shell — `~L33709`
**Jump:** `class ChampionShell` (~L33773)
- **Symbols:** `_preloadChampionShellModel`, `ChampionShell`, `_spawnChampionShell`, `_clearChampionShell`

#### Boss portal & race rings — `~L33950`
**Jump:** `function _spawnBossPortal` (~L34013) · `class BossPortal` (~L33968)
- **Symbols:** `BossPortal`, `_spawnBossPortal`, `RaceRing`, `_spawnPoleRings`, `_raceOnRingCaptured`
- **⚠** `_spawnBossPortal` DEFINED here but CALLED ~L5763/5970/9145 (long forward ref, typeof-guarded → silent if broken).
- **⚠ (v36.18) `cyanring.glb` is cloned with NO material conversion** — unlike every other streamed model (`OutskirtsMonster.attachModel`, `_champSelfIlluminate`), `_cyanRingProto.clone(true)` keeps the GLB's `MeshStandardMaterial`, which costs a 99,269-char `physical` program pinned by `_buildModelWarmGroup` entry `6`. If you ever swap the ring model or convert its materials, re-run probe (2) against the new clone — the pin is a hand-built signature match, so a different GLB (extra map slot, a second UV set, tangents, a non-DoubleSide material) silently stops covering it and the mid-match hitch comes back. `RaceRing` shares the proto and therefore the pin — it needs nothing of its own.

#### Monster summon & world-object update tick — `~L34173`
**Jump:** `function updateMonsters` (~L34274)
- **Symbols:** `_monSummon`, `_updateMonsterSummon`, `updateMonsters`, `updateDynamicObjects`

### ═══ PART 15 — Tracers, lightning, particles, effects, spawners (~34401–38124) ═══

#### Organic life (feature-flagged OFF) — `~L34401`
**Jump:** `const LSS_ORGANIC_LIFE_ENABLED = false`
- **⚠** Dead path unless re-enabled.

#### Tracer & lightning geometry / pools — `~L34789`
**Jump:** `const _TRACER_CORE_GEO` (~L34797) · `function _buildLightningTubeGeometry` (~L34987)
- **Symbols:** `_TRACER_*_GEO`, `_generateLightningPath`, `_LIGHTNING_VERT_SRC`/`_FRAG_SRC`, `_initLightningPool`, `_acquireLightningSlot`

#### Combat FX warmup & program pinning — `~L33360`
**Jump:** `function _programEnvSig` · `function _pinCombatEffectPrograms` (~L33386) · `function _buildModelWarmGroup` (~L33495) · `function _warmRealCombatFX` (~L33546)
- **Symbols:** `_TRACER_*_MAT_PROTO`, `_fxPinGroup`, `_programEnvSig`, `_pinnedEnvSig`, `_pinCombatEffectPrograms`, `_modelWarmGroup`, `_buildModelWarmGroup`, `_warmedFXSig`, `_warmRealCombatFX`
- **⚠** Part of the first-sight-hitch fix — renders into `postFX.rtScene`; `_fxPinGroup` sits at y=-100000, `frustumCulled=false`.
- **(v36.23) BOTH ARE NOW GATED ON `_programEnvSig()`** — not on "every call" (the pin) and not on `game.currentRound` (`_warmedFXSig` replaces `_warmedRound`). Full audit + numbers in PART 13's v36.23 entry. Same signature ⇒ three.js can only hand back cached programs, so skip: measured **8–54 ms → 0–0.3 ms** for the pin and **55–594 ms → 0.1 ms** for `_warmRealCombatFX`. New signature ⇒ pin, which is what finally covers the hub's `scene.environment` swap (64 vs 1024 cubeUV height forks **every** `physical` program; it was linking the 99,268-char cyanring program inside a gameplay frame for 188.5 ms). `_pinCombatEffectPrograms` now also carries `_buildModelWarmGroup()` into its compile — **except on the mobile chunked path**, whose slices re-parent children and would permanently steal the model group's meshes.
- **(v36.18) `_buildModelWarmGroup` entry `6` — the RAW GLB PBR pin** (audit + numbers in PART 13's v36.18 entry). `cyanring.glb` is the one streamed model with NO material conversion, so `BossPortal`/`RaceRing` keep the GLB's `MeshStandardMaterial` and need a 99,269-char `physical` program — the largest in the game, and it linked in the frame the rift first drew (37.4 ms vs a 7.0 ms median). Pin = a hand-built `MeshStandardMaterial{map, normalMap, emissiveMap, roughnessMap, metalnessMap, side:DoubleSide}` on a 3-vert position/normal/uv geometry, **cacheKey-verified byte-identical to the real clone**. Not tier- or mode-gated (the group is memoized per page — a mode gate would strand anyone who opened endless first).
- **(v36.17) `_buildModelWarmGroup` — the GLB-material pins** (audit + numbers in PART 13's v36.17 entry). Five page-lifetime protos built from the REAL factories, not lookalikes: `_addSpectralGhost` on a 1-bone synthetic `SkinnedMesh` **with** and **without** a map, `_addGutsShader` on a transparent `MeshBasic` (skipped on potato, matching `spawnMonsterGuts`), an opaque `MeshBasic(map)` for `_champSelfIlluminate`, and the additive beam-cone signature shared by the v36.10 headlight cones / v35.72 god rays / v35.90 bolt ray shafts (skipped when `_SHIPL.CONE_N === 0`, i.e. Quest/mobile, where none of the three exist). Consumed in two places: **`_warmupCombatShadersBody`** adds it next to its own prototype `group` (this is where the cost lands — behind the loading overlay, on the frame-yield budget) and **`_warmRealCombatFX`** adds it again for the live-round contexts (cache hits on desktop; the *only* warm on standalone Quest, where the warmup body early-returns). **⚠ The materials are parked on `window.__lssModelWarmMats` and must NEVER be disposed** — three.js refcounts programs per material, so disposing the last holder deletes the program and puts the hitch straight back (the same 2026-06-12 `releaseProgram` lesson as `_lssWarmupProtoMats`).

#### Muzzle points & tracer/railgun spawning — `~L35505`
**Jump:** `function spawnTracer` (~L35789) · `function _spawnSingleTracer` (~L35586)
- **Symbols:** `_computeScreenMuzzleWorld`, `_spawnSingleTracer`, `_spawnRailgunSpiral`, `spawnTracer`
- **⚠** Tracer visuals allocate per-shot by design — do NOT pool.
- **(v36.00) CAMERA-PROXIMITY DISSOLVE + PLAYER-IMPACT LASER SPLASH** (owner: "laser hit my face... looks like lines... a laser splash would be better" — an incoming shot crossing the near plane painted its tube layers as a screen-wide streak; v33.53's glow head only mitigated it). **Jump:** `function _lssCamProxFade` (beside `_vxTracerRetract`) · `function spawnPlayerHitSplash` (after `spawnImpactSparks`) · `hitOpts` (new optional 4th arg of `playerTakeDamage`).
  - **Dissolve:** every flying-shot visual fades to zero opacity near the ACTIVE camera (smoothstep: full ≥55u, zero ≤18u; live A/B `window.__dslvSet(far, near)`; first- and third-person alike). Tracer / tracerTail / tracerGlow / tracerSpiral branches of `updateEffects` use **closest-point-on-segment** distance (`_lssCamProxFadeSeg` over `_retractFrom/_retractTo`) — an incoming hitscan tracer's MIDPOINT sits ~300u away while its end is at the near plane, so mesh.position can never catch the slash. The railgun spiral + its core sliver store `_dslvFrom/_dslvTo` clones at spawn (callers pass scratch vectors; the sliver must NOT get `_retract*` or it starts retracting). `Projectile.update` folds it into `_visMul = fadeIn × prox` for core/glow/haze/line-trail, written only when it changes (`_lastVisMul`, init -1). **⚠ the 'tracer' branch's legacy compounding (1-t) fade now compounds on tracked `e._dslvBase`, NOT on a material.opacity read-back** — multiplying the prox factor into a read-back compounds it to black within frames and can never recover. **Deliberately untouched:** trail RIBBON (has the superior per-vertex NEAR_FADE_* fade in `Projectile.update`) + rocket smoke cone (cloud, not a line), muzzle-flash FX, beam abilities, hitscan impact FX. All affected materials are per-spawn clones (live-verified: distinct uuids, no cross-write; the warmup `_fxPinGroup` uses the raw protos but never enters `game.effects`).
  - **Splash:** `spawnPlayerHitSplash(srcPos, color)` — weapon-colored + white-hot inner ember-texture additive sprites placed ON the shield-bubble radius (`hullLength*0.9`, the same radius `spawnShieldHit` gets) along the incoming direction, + `spawnImpactSparks` + pooled light; 70ms rate limit, potato-gated, ~0.25s. New effect type `playerHitSplash` (update branch: ease-out bloom 0.55→1.3× ship scale + quadratic fade; dispose branch: **never dispose the geometry — THREE.Sprite shares ONE class-level quad**). Fired from `playerTakeDamage` AFTER all absorb-shield early-outs, gated on `projectile || hitOpts.splashFrom` — DOT ticks / collisions / monster zaps pass neither and stay silent (live-verified: burn ticks produced zero splashes). The two hitscan hit sites pass `hitOpts` (bot `_tgtIsPlayer` branch with muzzle+flashColor; MP `handleHitClaim` with shooter pos+ship color). **⚠ never fake a projectile object to get the splash** — a fake `{position}` corrupts the Plasma-Shield wall-side test inside playerTakeDamage. The shield-ripple hitPos now prefers `projectile.position`/`hitOpts.splashFrom` over `attacker.position`, so `recordShieldHit` lights the struck side (verified: fresh `uHitAges` slot = 0 at the hit). The splash SpriteMaterial signature (ember map + additive + depthWrite:false) is already compiled by `_warmupCombatShadersBody`'s textured-sprite pass — no new program, no first-sight hitch, no new warmup entry.
  - Verified live (endless, worker-tick rig + fronted pane): far tracers d≥58 keep spawn opacity (0.75-0.88); d=32 → ~0.36 (smoothstep); threshold-shift proof (`__dslvSet(150,100)`) drove 1145 same-code-path samples to op ≤ 0.0015 then restored; splash pair blooms 78→129 su / fades 0.94→0.38 at +90u toward the shooter; 144fps (= the v35.90/91 endless baseline); zero console errors.

#### Dark lightning, bolts & siphon helix — `~L35875`
**Jump:** `function spawnLightningBolt` (~L35970)
- **Symbols:** `_initDarkLightningPool`, `spawnDarkLightningBolt`, `spawnLightningBolt`, `spawnSiphonHelix`

#### Particle system — `~L36192`
**Jump:** `const MAX_PARTICLES` · `function updateParticles` (~L36446)
Single batched `THREE.Points` (embers/sparks) + splash-drop buffer.
- **Symbols:** `MAX_PARTICLES`, `_particlePoints`, `_splashPts`, `_warmupEffectShaders`, `updateParticles`
- **⚠** Fixed Float32 attrs (`DynamicDrawUsage`); `_warmupEffectShaders` also part of hitch fix; `_particleCap` from VR budget.
- **⚠ (v36.41) THIS SYSTEM *IS* SLAYER'S MAIN WEAPON** (owner: *"slayer's main weapon fire is not showing in VR"*). **Jump:** `function spawnPelletBurst` · the `_vrTier >= 3` block at the top of `updateParticles`. Every other primary leaves GEOMETRY downrange — a tracer mesh, a `Projectile`, a lightning tube. The Shotgun (`mode:'spread'` → `fireSpread` → `spawnPelletBurst`) leaves **48 additive points per pellet and nothing else**, so it is the only weapon this system can delete outright. Two VR-only things did:
  - **The 'Max FPS' wipe.** `getVRThrottleTier() >= 3` used to `game.particles.length = 0` + `_particlePoints.visible = false` — a mode meant to strip ambience was deleting a weapon. Now it keeps particles flagged **`ess`** and drops the rest (measured: 384 pellets survive, 50 injected non-essential ones do not, `_particlePoints.visible` stays true). Same contract as `spawnLightningBolt`'s `essential` arg. Splash drops stay fully stripped.
  - **No bloom on the VR path.** `renderFrame`'s XR branch is a BARE `renderer.render` — `renderPostFX` never runs — and in the hub `_lssHubDirectTonemap` additionally applies ACES at exposure 0.95. Small additive sparks are exactly the visual that lives or dies on bloom, so `spawnPelletBurst` draws them **1.9× bigger / 1.35× longer** when `isXRPresenting()`. **Flat is byte-identical** (measured: size 3.40–6.19, maxLife 0.85 on both v36.40 and v36.41; VR 6.47–11.75 / 1.15).
  - ⚠ **The two suspects this was NOT.** The v36.00 camera-proximity dissolve (`_lssCamProxFade`) only touches `Projectile` layers and `updateEffects`' tracer branches — it cannot see `game.particles`. `isVRStripFx()` gates rock chunks, world objects, organics and `spawnLightningBolt` — none of which is on the Shotgun's fire path. Check what a weapon actually SPAWNS before blaming an FX gate.
  - **Pre-existing, unrelated:** the expiry test uses `arenaLimit = LSS.ARENA_SIZE` (25000) while freeflight/endless let the player out to 10× that, so every particle dies instantly once you pass 25000u from origin. Not VR-specific; not fixed here.

#### Effects update dispatcher — `~L36536`
**Jump:** `function updateEffects` (~L36714) · `const MAX_EFFECTS`
Central per-frame updater/disposer for the heterogeneous `game.effects` list.
- **Symbols:** `_lssRetainMat`, `_disposeOrReleaseEffect`, `updateEffects`
- **⚠** Big type-switch; disposal decides pool-release vs hard-dispose per kind.

#### Combat FX spawners (smoke, sparks, DOTs, directional dmg) — `~L37258`
**Jump:** `function spawnDot` (~L37551) · `function spawnImpactSparks` (~L37995)
- **Symbols:** `spawnFireworksBurst`, `spawnHullBurst`, `spawnShieldHit`, `spawnDamageSmoke`, `spawnDot`/`updateDots`, `showDirectionalDamage`, `spawnImpactSparks`

### ═══ PART 16 — Player: cockpit HUD, movement, weapons, abilities, round (~38125–46571) ═══

#### Cockpit frame, gun layer & ability/core overlays — `~L38125`
**Jump:** `function updateCockpitFrame` (~L38259) · `function tickAbilityOverlayFrame` (~L38921)
2D cockpit HUD art: frame animation, gun-layer sprites, ability/core overlay playback, recoil feel.
- **Symbols:** `detectFrameMuzzlePoints`, `updateCockpitFrame`, `tickGunLayer`, `triggerAbilityOverlay`, `abilityInputPress`/`Release`, `triggerCoreOverlay`
- **⚠** DOM layer IDs (`gun-layer`, `ability-overlay-frame`, `core-overlay-frame`, `cockpit-frame`) are also composited by the video recorder.
- **⚠ (v36.25) `_FRAME_CACHE_BUST` is `'?v=' + _FRAMES_VERSION` — an ART version, NOT `LSS_BUILD`.** Every frames/ URL in this section (frame_, gun layer, ability/core overlays, `mock/<ship>.json`) carries it. History: `Date.now()` → (v36.16) `LSS_BUILD` → (v36.25) `_FRAMES_VERSION`. The timestamp made every URL unique per *load*; `LSS_BUILD` made them unique per *build*, which is bumped every iteration — so ~30 MB of cockpit art still re-downloaded for every returning player on every build. See **ASSET CONTENT VERSIONS** (`~L3796`, grep that phrase) for the full contract and the companion `_MODELS_VERSION` / `_MODEL_CACHE_BUST` that does the same job for the 115 MB of GLBs. **If you change a stamp, change `tools/gen_manifest.py`'s `v` code with it** (`0` none / `1` models / `2` frames).

#### Loadout & ship-menu cycling — `~L39117`
**Jump:** `function commitLoadout` (~L39203)
- **Symbols:** `cycleCampaignShip`, `cycleHubShip`, `commitLoadout`
- **(v36.16)** `commitLoadout` is the single entry point for the **bulk asset preload** — every mode (solo/elimination/race/assault/campaign/endless/freeflight, and the direct `commitLoadout('VORTEX')` hub path) funnels through here, which is why the hook lives on its `_warmupPromise` chain rather than in each `start*`. Full contract in PART 18's *Launch countdown + loading overlay* entry.

#### Bot networking & spawning — `~L39665`
**Jump:** `function spawnBots` (~L39761)
- **Symbols:** `_botNetSync`, `_botApplyRoster`, `_dropinReplaceBot`, `spawnBots`

#### Player damage / death / respawn — `~L39846`
**Jump:** `function playerTakeDamage`
- **Symbols:** `playerTakeDamage`, `playerDie`, `respawnPlayer`
- **(v36.12)** `playerTakeDamage` consumes `player.overShield` BEFORE shield (stasis overshield — full entry in PART 20's stasis section); block placed after the absorb-shield early-outs. `window.__playerTakeDamage` = debug export of the real pipeline. `playerDie`/`respawnPlayer` zero `overShield`.

#### Player movement, perks & spectator cinematic — `~L40206`
**Jump:** `function updatePlayerMovement` (~L40804)
6DOF flight integration, perk ticking, outline/optics, post-death spectator cam.
- **Symbols:** `_tickPerkEffects`, `_setPlayerShipOpacity`, `_lssStartSpectatorCinematic`, `updatePlayerMovement`, `_lssApplyShipRig`
- **⚠** Cinematic watchdog (`_lssArmCinematicWatchdog`) force-completes if stuck.

#### Weapon firing (hitscan / projectile / spread) — `~L41194`
**Jump:** `function fireWeapon` (~L41355)
- **Symbols:** `updateWeapon`, `startReload`, `fireWeapon`, `fireHitscan`, `fireProjectile`, `fireSpread`, `_wallBlockSegment`
- **⚠** `_wallHitRipple` is currently a stub.

#### Abilities, shields & dash — `~L42047`
**Jump:** `function executeAbility` (~L42160) · `function updateWorldEffects` (~L44346, v36.19) · `function updateAbilities` (directly after it)
Largest gameplay block (~4000 lines): activate/execute dispatch, power shot, core, all shield variants, sonar, rocket salvos, fire DOTs, dash.
- **Symbols:** `activateAbility`, `executeAbility`, `firePowerShot`, `activateCore`, `_makeHullHugShield`, `_spawnThermalShieldFire`, `_spawnSonarPulse`, `_enqueueStaggeredRocketSalvo`, `updateWorldEffects`, `updateAbilities`, `dash`
- **(v36.19) WORLD-EFFECT LIFETIME IS NO LONGER OWNED BY `updateAbilities`** (owner bug: *"pyro's fire from the bots doesn't clear if it kills me, i can see it from ghost mode"*). **Jump:** `function updateWorldEffects(dt)` — the ~960-line `// ---- WORLD EFFECTS UPDATE ----` loop, lifted verbatim out of the middle of `updateAbilities` into its own top-level function — and its call site in `gameLoop`, now **before** the `if (deathCam.active)` branch, not inside the else.
  - **Root cause.** `game.worldEffects` has exactly ONE per-frame lifetime owner: that loop. It is the only `eff.timer -= dt` for world effects in the file, and the only path that reaches the expire branch doing `scene.remove` + dispose + pop. `gameLoop` skips `updateAbilities` entirely the instant `deathCam.active` flips true — so from the death frame on, every world effect froze with all its meshes attached for the rest of the round: the bot's ignited `incendiary_gas` cloud (`igniteDmgPerSec` 1500 — the likely killer), its damaging `firewall`, and **every effect any bot spawned while you spectated** (`Bot.update` gates on `game.state === 'playing'`, not on your being alive), so the arena kept ACCUMULATING immortal fire the longer you watched.
  - **Why the two existing band-aids could never cover a bot.** `_deathCamTickFire` (now DELETED) filtered to `pyro_flame` — which needs `isPyroThermite`, set only on the LOCAL player's PYRO projectiles and on network replay of a remote human — and `explFireCloud`. Bot main-gun fire is hitscan with no projectile branch at all, so a bot can produce neither. `playerDie`'s own sweep filters to `type === 'firewall'` AND a mine predicate that excludes bot-owned damaging walls. **Diagnostic tell for the frozen state:** the gas cloud's outer shell goes static (its `time` uniform is written inside the dead loop) while its `coreMesh` keeps flickering (driven by `_layeredFXTick`, which runs before the gate).
  - **⚠ Call it BEFORE the deathCam branch, not after.** The block writes `player.coreMeter` in 13 places and `updateAbilities`' core-meter freeze + edge-detect at its tail must still see those writes in the same order they landed when it was inline.
  - **⚠ KEEP THE LOOP VARIABLE NAMED `e`.** The tripwire sibling de-dup inside reads it directly (`if (j < e) continue;`); renaming it caused a per-frame ReferenceError once already, and there is a comment in there recording that.
  - **Also changed:** the two `showHitMarker()` calls in the loop are gated on `player.shipState !== 'dead'` (a mine you left behind popping a bot would otherwise flash a hit marker over the DESTROYED overlay), `_tickFireDOTs` moved out of the else with it (the loop SEEDS `onFireTimer`/`onFireDps`, so a gated consumer would bank fire and relight you on respawn), and the profiler gained a `worldFX` bucket beside `abilities`.
  - **Measured live** (endless, RTX 5050, probe object pushed into `game.worldEffects`, killed by a monster at 1 hp). BEFORE (v36.18): timer ticks 0.984/s alive, then **freezes at an identical value for 105 consecutive samples / 1654 ms**, spanning the whole `dead` + `spawning` window, resuming only on respawn. AFTER (v36.19): **0.997/s alive → 0.965/s dead** — no freeze.
  - **Known consequence, by design:** posthumous PLAYER-owned effects now keep dealing damage to bots while you spectate (both `playerTakeDamage` sites in the loop are already guarded, so nothing can hurt YOU). In assault the mid-round respawn does not reset `coreMeter`, so you can respawn with a partly-charged core. ⚠ Adjacent and NOT fixed by this: the player's own Pyro Fire Shield visuals strand the same way, because `updateShieldVisuals` has its single call site inside `updateAbilities` and its teardown lives in that function's else-branch.
- **⚠** `executeAbility` is a giant switch — shader warmup exists to precompile the materials these spawn.
- **⚠ (v35.60) The "+2 core for ability use" bonus is paid in `activateAbility`, gated on the activation having COST something** (`isTrapCharges || ability.cooldown > 0`). It used to sit unconditionally at the tail of `executeAbility`, which made it free for the zero-cooldown HOLD abilities — **Vortex Shield, Absorption, Fire Shield**. Those never enter the `ability.cooldown > 0` branch, so no cooldown is set, and a tap-and-release spends almost no energy: tapping Vortex Shield charged the core at +2 per tap, ~50 taps for a full core, with no cooldown and no risk. Cooldown abilities pay with their cooldown, Explosive Gas with a trap charge; a free tap now earns nothing. **If a new ability is ever given `cooldown: 0`, it earns no core by design — decide deliberately, don't "fix" it by moving the grant back.**
- **⚠** `executeAbility` has exactly ONE caller (`activateAbility`), which is what made moving the grant safe.
- **(v35.63) Fire rules.** Lingering burn is `onFireTimer`/`onFireDps`/`onFireSource`, ticked by `_tickFireDOTs`. Against SHIPS the only source that sticks is **thermite (1.5 s @ 150 dps, set in `Projectile.splashDamage`)** — the Fire Shield's 3 s @ 320 dps was removed, so it now damages only while the enemy is inside its cone. Firewalls and gas zones already only damaged ships while inside. **⚠ Monsters keep their lingering burns** (Mega Flame Chain, firewall, gas zone) — those are `mon.` branches and were deliberately left, so ship and monster fire behave differently on purpose.
- **(v35.63) `igniteNearbyGas(pos, radius, igniter, igniterTeam)` transfers OWNERSHIP on first ignition.** Lighting an enemy-planted cloud makes the blaze yours: it damages their team and credits you. Previously the burn kept the planter's `owner`/`team`, so lighting their gas built them a bonfire that hurt your own side and paid them for it. Only FIRST ignition transfers — a re-contact refreshing an existing burn leaves ownership alone, so a cloud can't ping-pong. All five call sites pass an igniter.
- **(v35.63) Slayer's Teleport breaks a tether root** — clears `game.playerRootTimer` and releases any `type:'tether'` effect whose `rootTarget` is the player. Needed because the root is enforced by `playerRootTimer` in `updatePlayerMovement` AND the trap re-zeroes velocity every frame while `eff.triggered`, so teleporting moved the ship 400 units and left it just as stuck. The trap is **re-armed, not consumed** (its catch is gated on `!eff.triggered`), so the hop carries you clear but flying back in can catch you again.

#### Round system tick — `~L46029`
**Jump:** `function updateRoundSystem`
Per-frame match state machine (warmup/countdown/active/round-end), timers, win conditions, campaign progression.
- **⚠ (v36.36) THE BETWEEN-ROUNDS SWAP WINDOW — READ THIS BEFORE TOUCHING `_rrCountdown`, `commitLoadout`'s `midMatch` fork, `previewLoadout` or `finishLaunch`.** Four owner-reported defects, one flow. **Jump:** `---- (v36.36) BETWEEN-ROUNDS SHIP STAGING ----` (right above `enterShipSelect`) · `function _betweenRoundsPick` · `let _stagedRoundShip` · `function _applyStagedRoundShip` · console `window.__roundSwapProbe()`.
  - **THE CORRECTED FLOW, one round transition, total cadence UNCHANGED at `LAUNCH_COUNTDOWN` (10 s):**
    | t | what |
    |---|---|
    | 0 | roundEnd banner expires → world rebuild → `_rrCountdown` re-shows the picker and starts `launchCountdown(6)`; `warmupTimer` is still anchored to the full 10 |
    | 0–6 | picker fully painted (`.active`, **no** `.lss-launching`). Any ship pick — mouse chip, ‹ › arrows, gamepad D-pad, XR row, VR stick — **stages** it. CONFIRM is optional and, if pressed, applies immediately and **leaves the picker up** |
    | 6 | `finishLaunch`: staged ship applied via `commitLoadout` (midMatch fork) → picker hidden → pointer lock |
    | 7,8,9 | the **arena's own** `Overlays.countdown` 3-2-1 (`ROUND N`) — it self-enables the moment `selectActive` goes false |
    | 10 | `warmupTimer` 0 → `'playing'` → FIGHT. Bots are holstered for the whole 10 s, exactly as before |
  - **`_rrPickSecs` / `_rrArenaSecs` are DERIVED, not magic:** arena = `SHORT_COUNTDOWN + 1`, picker = `LAUNCH_COUNTDOWN − arena`. The **+1 is load-bearing** — at a bare `SHORT_COUNTDOWN` the 3-crossing and `finishLaunch` both land on the same instant in a non-deterministic order and the "3" is eaten. **⚠ A STAGED WORLD-SWAP TRAVERSE PASSES AN EXPLICIT `_dur` and is deliberately untouched** — `_rrStagedSwap` anchors `warmupTimer` to that same number, so splitting it would strand the traverse mid-countdown.

- **(v36.40) THE BETWEEN-ROUNDS REBUILD IS STAGED — the picker is the cover.** The most-repeated stall in the game, and the last one-frame world build left after v36.27/v36.28. **Jump:** `const _RRSTAGE` / `const _RR_STAGE_MAX_MS` / `async function _rrStagedRound` (immediately below `window.__swapReport`) · the `_rrRoster` closure in `updateRoundSystem`'s roundEnd branch · the `else if (typeof _rrStagedRound === 'function' && !window.__rrStageOff)` fork at the bottom of that branch · console `window.__rrStage()` / `window.__rrStageOff`.
  - **WHAT IT COST (v36.39, live pane @144 Hz, budget 6.94 ms).** `_rrWorld(); _rrWave(); _rrWarpBeat(); _rrShaders(); _rrReset(); _rrCountdown();` ran back-to-back in ONE frame, on **every round of every classic/race/assault match**: elimination **163.8 / 165.7 / 178.6 / 181.1 ms** over four consecutive transitions, race **213.7–214.4 ms**.
  - **WHAT WAS *NOT* THE PROBLEM, measured.** The ~40 following frames of 15–25 ms are v36.26's `_swDrainStream(_fX, _fZ, 12, 64)` warmup arm in `gameLoop` doing exactly its job — 12 ms of wall clock per frame for ~0.5 s, **behind the picker**. Loading frames, not gameplay frames. Left alone (the stage now drains them itself at an 8 ms slice, which is why the `>16 ms` count falls as far as it does).
  - **THE FIX: raise the picker FIRST.** `#ship-select` is a full-screen `rgba(5,5,15,0.95)` panel that is going up for the next ~6 s anyway, and `_rrCountdown` has **no dependency on the rebuild** — `getNextMap()` is pure and `game.selectedMap` is final before any closure runs, so the map window shows the right arena either way. Order becomes: `ph.countdown()` → **two** `_warmupYield()`s (a rAF callback runs BEFORE its frame's paint — same reasoning as `_commitDeferOneFrame`; `#ship-select` goes `display:none → flex` so it paints at full opacity with no transition to wait on, i.e. no `_swapCoverPainted` equivalent needed) → `world` → `wave`+`warpBeat` → `shaders` → `reset`+`roster` → terrain drain.
  - **⚠ THE FLAG IS `game._rrStaging`, NOT `game._swapStaging`, and that is not cosmetic.** Two other readers mean the opposite thing by the traverse flag: **(a)** `_betweenRoundsPick()` returns FALSE while `_swapStaging` is set, so borrowing it would send a chip click down the LAUNCH path instead of staging it for the first ~800 ms of the swap window — v36.36's entire feature; **(b)** `initSandwichTerrain` skips `_hubCityInit()` when `_swapStaging` is set (because `_rrStagedSwap` builds the city on its own frame) and this stage does not, so it would silently drop the city from any hub-map round rebuild. Both flags are OR'd into gameLoop's streamer stand-down and into the `warmup → playing` flip guard.
  - **⚠ THE v36.36 CADENCE IS UNTOUCHED BY CONSTRUCTION.** `warmupTimer` is anchored by the caller before any of this, and `ph.countdown()` — which calls `launchCountdown(_rrPickSecs)` — runs in the SAME frame it always did, just first instead of last. Nothing here passes an explicit `_dur`. **`updateTeammatesStrip` is the one thing in `_rrCountdown` that reads state the rebuild produces** (`spawnBots()` refills `game.entities`); it still runs where it always did, and `_rrRoster` runs it AGAIN after `ph.reset()`. `_rrCountdown` itself is byte-identical, so the traverse path is untouched.
  - **⚠ CAPPED at `_RR_STAGE_MAX_MS` (3.5 s), well inside the 6 s picker window, flags cleared in a `finally`.** A stage that outlived `finishLaunch` would be a soft-lock; it degrades to gameLoop's own drain instead.
  - **MEASURED, A/B on ONE page via `window.__rrStageOff`** (same seed, same map rotation cursor — two page loads are not a controlled comparison). Transition window = warmup −200 ms → +3000 ms:
    - **elimination / hourglass**, OFF: worst **175.9 / 162.5 ms**, **30 / 29** frames >16 ms. ON: worst **151.1 / 152.2 / 154.9 ms**, **5 / 7 / 8** frames >16 ms — and the worst frame is now behind a painted picker instead of on live gameplay.
    - **race / pole position**, OFF: worst **214.4 / 213.7 ms**, **30 / 30** >16. ON: worst **196.3 / 198.7 / 197.0 ms**, **13 / 10 / 6** >16.
    - **Cadence unchanged:** warmup → playing **9.88–10.09 s** in every measured round, both modes. `__roundSwapProbe` through a full window: chip click stages **without** CONFIRM (`staged: 'PYRO'`, `flying: 'VORTEX'`, `sel: flex`); CONFIRM applies it and the picker **stays up** (`sel/hdr/body` all still shown at t+1.8 s); picker clears at **t+6.4 s**; arena 3-2-1 runs t+7→9; `playing` at **t+10.4 s**; match end returns to ship-select.
    - **Play after the transition:** 0 frames >16 ms in every round of both modes, `dProg`/`dTex`/`dChunk` all **0**.
  - **FOUND, NOT FIXED — `buildRoomGraphLevel` is the remaining monolith.** `__rrStage().build` splits the world phase three ways: **lvl 110–115 ms / dyn 26–31 ms / org 0 ms** (elimination) and **lvl 124–130 / dyn 52–58 / org 0** (race). Splitting `buildRoomGraphLevel` from `spawnDynamicObjects` would buy ~20 % of the remaining frame, but the seeded path (`withSeededRandom(roundSeed, buildNextRound)`, taken whenever `net.active` or campaign) must stay atomic or the RNG stream restarts and the generated arena changes — so it would need a solo-only fork of the world build, i.e. duplicated generation logic for 30 ms behind an opaque cover. Deliberately not taken. Slicing `buildRoomGraphLevel`'s own internals is the real fix if this is ever revisited.
  - **1. "I have to select confirm and launch to change the ship."** `chip.addEventListener('click', () => previewLoadout(key))` — preview was pure UI and only CONFIRM ever wrote `player.loadoutKey`. **Fix:** `previewLoadout` now sets `_stagedRoundShip = key` when `_betweenRoundsPick()`. That one line covers **all five** input methods because every ship-picking path funnels through `previewLoadout`. Outside the window it is a no-op, so round 1 / post-match ship-select still require CONFIRM (it is the launch button there).
  - **2. The stage is applied at `finishLaunch`, NOT at click.** It is the last instant `commitLoadout` still takes its `midMatch` fork (`game.state === 'warmup'`), it is "when the match starts" to the player, and the mesh rebuild lands behind the still-painted picker instead of in the first gameplay frame. `_countdownActive` is still true there, so the commit's `if (!_countdownActive)` warmup re-anchor and its `_launchSoloAfterCinematic` arm both stay dormant, exactly as an old CONFIRM press did.
  - **3. "It automatically closes the ship selection screen and goes to the in-game arena."** `commitLoadout`'s `_shipSelectSetLaunching(true)` (v36.21) fired on the `midMatch` fork too. **MEASURED v36.35, elimination round 5: CONFIRM at 252385 ms → `hdr none body none` at 252404 ms**, i.e. 19 ms later the chrome was gone and the digits floated over the live arena for the remaining 6 s. **Fix:** `if (!midMatch) _shipSelectSetLaunching(true);`. `_xrMenuForceHidden = true` got the same `!midMatch` gate — it means "already committed, take the menu away", which is now wrong here and would also make the VR trigger refuse a corrected second pick.
  - **4. "At the end of the match it didn't go back to the ship selection screen."** `returnToRootMenu` was the **fifth** site that shows `#ship-select` and the only one that never cleared `.lss-launching`. The class survived from the last `commitLoadout`, so `display:flex` + `.active` painted an overlay with `display:none !important` header+body, a transparent background and `pointer-events:none` — the dead arena with an invisible click-through picker on it. Mouse hit nothing; gamepad **Start** still passed `_shipSelectActive && state === 'select'` and committed straight into a fresh match. **MEASURED v36.35: matchEnd 363021 ms → returnToRootMenu 373034 ms reporting `flex | active lss-launching | hdr none | body none`, screenshot showing the cockpit.** **Fix:** `_shipSelectSetLaunching(false)` (+ clear `_stagedRoundShip` / `game._rrToneDone`) immediately above the `display='flex'` write. **⚠ Any future site that shows `#ship-select` must clear the launching state — that is now SIX.**
  - **`pollGamepad`'s two ship-select gates went `game.state === 'select'` → `(game.state === 'select' || _betweenRoundsPick())`.** v36.20's gate was written against the *launch* window and accidentally fenced off the between-rounds picker (state `'warmup'`), so a gamepad could neither cycle ships nor confirm there. The window cannot run a world build, so the "11 builds" re-entrancy measurement that motivated the gate does not apply to it.
  - **`checkAllLoadoutsReady` gained `if (game.state === 'warmup' && currentRound > 1) return;`.** A round transition is a LOCAL event — no `launch_at` proposal has ever been part of it — and it used to be covered for free by the `_countdownActive` line above, because the picker countdown ran the whole warmup. Now the picker clears ~4 s early, so an inbound `loadout` announcement in that tail would reach the "alone in the mesh" fallback and schedule a **second** `launchCountdown` on top of a round that is already starting.
  - **⚠ THE STAGE IS NOT A COMMIT AND MUST NOT BROADCAST.** `commitLoadout`'s `net.sendLoadout` **is** the multiplayer ready signal. The stage stays local and the LAUNCH-time apply runs the identical `commitLoadout` the old CONFIRM ran, so peers still learn the swap through the normal `loadout` announcement before the round opens — one countdown later than before, and inside a window where the handshake is inert anyway.
  - **`game._rrToneDone` replaces `selectActive` as the round_start duplicate guard.** `finishLaunch` sets it; the warmup→playing flip reads and clears it. `selectActive` was only ever a proxy for "finishLaunch already played it" and stops being true once the picker clears early. It also retires the same latent double on the fresh-launch path, where the intro cinematic had already dropped `.active` before `finishLaunch` ran.
  - **VERIFIED LIVE, 1600×900, RTX 5050, zero console errors across every run.** *Elimination:* stage-only (chip TRACKER, no CONFIRM) → `staged=TRACKER flying=PYRO` through the countdown → **flying TRACKER** at LAUNCH; chip+CONFIRM → **+29 ms and +300 ms after the click the picker still reads `sel flex / cls [active] / hdr flex / body block`**, digits 3-2-1 inside it, then `Overlays.countdown(3|2|1, "ROUND 3")` in the arena and FIGHT 9.84 s after the window opened. *Assault* (`assault_causeway`) and *Race* (`race_pole_position`) reproduce both. *Gamepad:* a synthetic standard-mapping pad injected over `navigator.getGamepads` — two D-pad-RIGHT pulses in the window cycled PUNCTURE→SLAYER→TRACKER and the player launched as TRACKER with **no** CONFIRM and **no** Start. *Match end:* returns to a picker reading `flex / [active] / hdr flex / body block`, `pointer-events:auto`, background back to `rgba(5,5,15,0.95)`, `elementFromPoint` over `#ship-preview-confirm` returning `#ship-preview-confirm`; a **real mouse** chip click + CONFIRM then launched a fresh match. *Multiplayer:* elimination creates a real room (`net.active` true — proven by `_syncMapButtonsDisabled` locking `#map-prev`/`#map-next`); forcing both arrows back to `disabled=false` 1 s before LAUNCH and finding them `true` again at LAUNCH+300 ms is direct evidence the staged apply entered `commitLoadout`'s `if (net.active && net.sendLoadout)` block and announced the new key. The tail then read `state=warmup cdActive=false cdText="" selDisp=none` — no second countdown. *No regressions:* fresh launch still sets `.lss-launching` and never reveals the picker (race included), `__audioHold()` reported the hold engaged+released with 1 suppressed sound, `__prebake()` ran once on the launch and not on the transition, preload 114/114 0 failed.
  - **⚠ Test visibility with computed display / `getBoundingClientRect` / `elementFromPoint`, NEVER with `.click()`** — the v35.58 trap. `window.__roundSwapProbe()` returns all of it plus `{pick:'KEY'}` to drive a pick the way a chip click does.
- **⚠ (v36.25) THE GHOST-MATCH FIX — `if (game.state !== 'playing') return;` immediately after `activeMode().update(dt)`** in the `else if (game.state === 'playing')` branch. **Jump:** grep `THE GHOST-MATCH FIX`. **A mode hook can end the match mid-tick and every guard below it goes stale in the same frame.** `EndlessMode.update()` calls `returnToRootMenu()` when the RUN OVER beat expires; that clears `game.testMode`, resets `LSS.MODE` to `'classic'`, empties `game.entities` and sets `game.state='select'` — and then execution came straight back into this branch, where `!game.testMode` was now true, `LSS.MODE !== 'endless'` was now true, and `aliveA`/`aliveB` (counted at the TOP of the branch, before the hook) were 0. Classic round-end fired, overwrote `'select'` with `'roundEnd'`, and ~5 s later the roundEnd branch ran its round-restart world build (`buildRoomGraphLevel` + `spawnDynamicObjects` + `spawnOrganics`) **synchronously, with no loading overlay** — then `warmup` → `playing`, leaving **a full classic match simulating behind the ship-select menu forever**.
  - **Measured** (70 s scripted endless + forced RUN OVER, rAF-shim harness): **one 184.3 ms frame — 181.7 ms of it synchronous work — plus a 1×182 ms longtask**, at ~5 s after the soft return; then per-frame work stepped from a 2.5–3 ms median onto a sustained **~11 ms** plateau that never came back, and `renderer.info.memory.geometries` dropped 1218→569 (the world being rebuilt). After the guard: **max gap 31.0 ms, work max 12.6 ms, 0 frames >33 ms, 0 longtasks**, and `game.state` reads `'select'` for the whole 35 s tail with geometries frozen. `returnToRootMenu` itself is only **3.5 ms** — it was never the expensive part.
  - **This is the hitch the owner was describing**, and it is a soft-return bug, not an asset-preload bug (see PART 18's v36.25 entry for the preload evidence).
  - **Safe in classic/race:** those use `NULL_MODE`, whose `update()` is a frozen no-op, so `game.state` cannot change across the hook and the guard never trips. Campaign/FreeFlight *do* set `'roundEnd'` from their own hooks (rift entry, hub-zone cavern warp) — the guard stops those falling through into a second, classic resolution in the same frame too.

### ═══ PART 17 — Clip recorder & menu teardown (~46572–47069) ═══

#### Video/gameplay clip recorder — `~L46572`
**Jump:** `const _clip` · `function _clipStart` (~L46638)
`MediaRecorder` over `renderer.domElement.captureStream()`, compositing 2D HUD DOM layers onto the video.
- **Symbols:** `_clip`, `_CLIP_LAYER_IDS`, `_clipCompositeTick`, `_clipStart`/`_clipStop`/`_clipSave`
- **⚠** NAME COLLISION with the terrain clipmap `_clip*` (~L22110). Different system.

#### VR menus (mirror mesh) — `~L15551`
**Jump:** `function _xrUpdateMenuMirror` · `let _xrMenuForceHidden` · `function _xrShipSelectVisible`
The VR menu plane mirrors whichever 2D menu is up, keyed on `#ship-select.active` / `#lobby` visibility.
- **⚠ (v35.59) A running countdown must NOT hide the menu while ship-select is up.** Between rounds the round system shows ship-select and calls `launchCountdown()` *together* — the countdown **is** the swap window, and `launchCountdown` only paints the digit overlay, it never hides `#ship-select` (`finishLaunch` does, at LAUNCH). Folding `_countdownActive` into `_matchStarting` therefore blanked the VR mirror for exactly the period the player was meant to be choosing, so **VR never got a between-rounds ship pick while flat screen did**. The countdown term now applies only when no ship-select is on screen.
- **⚠ The "already committed, take the menu away" signal is `_xrMenuForceHidden`, not `_countdownActive`.** `commitLoadout` sets it (ship-select stays `.active` for a moment after — see its own note) and the roundEnd branch explicitly clears it. The VR trigger's confirm gate uses it for the same reason: making the menu visible between rounds is pointless if the trigger still refuses to confirm.
- `_xrShouldShowGameplayHud` **keeps** its countdown check — between rounds you want the menu mesh, not the gameplay HUD.
- **⚠ Hard to test headlessly:** the between-rounds branch needs a legitimately won round. Forcing `game.state='roundEnd'` does not reach it even with `roundEndTimerAnchorMs`/`Total` set, so this path was verified by code-read plus a flat-screen no-regression check, **not** observed live or in a headset.

#### Return to menu — `~L46756`
**Jump:** `function returnToRootMenu` · `function returnToMainMenu` (~L47030)
Tear down session, dispose world objects, reset state, restore UI.
- **`returnToRootMenu(opts)`** is the real teardown (~270 lines): entities, projectiles, stasis fields, world FX, timers, player state, pointer lock, scoreboard. It lands on **ship-select** — that is its "root menu" — and it deliberately does **not** leave the Trystero room. `opts.keepRoom` (v35.50) additionally skips `stopRoomHeartbeat()` + `net.roomCode = null`, the only two things in it that end the room's presence. Called by the matchEnd handler after the 10 s scoreboard, where it keeps its original room-clearing behaviour.
- **(v35.50) `returnToMainMenu()` no longer reloads the page.** It was `net.room.leave()` + `location.reload()`, which is why stepping back to the menu from ship-select or from settings dumped you out of your lobby — the reload destroys the WebRTC room with everything else. There was never a need for it: the soft path is `returnToRootMenu({keepRoom:true})` (the exact teardown a finished match already runs) then hide `#ship-select` / show `#lobby` (`display:flex`, matching its inline default). Verified: match → menu → match → menu with no reload, world rebuilt each time. `returnToMainMenu({hard:true})` keeps the old leave-and-reload, and is also the automatic fallback if the soft teardown throws — a reload beats a half-torn-down menu.
- **⚠ (v35.58) `#ship-select` visibility: the stylesheet is `display:none` + `.active{display:flex}`, but FOUR call sites hide it with an INLINE `display:none` — and inline beats a class rule.** `enterShipSelect` only added `.active`, so any inline hide poisoned every later show: the class went on and the overlay stayed invisible, leaving the player in a stale world with no way to launch. Surfaced as "back to menu, pick another mode, stuck in a dead game" once v35.50's soft return made that path reachable without a reload. `enterShipSelect` now sets `sel.style.display = 'flex'` itself (it is the show-site, so it owns the inline value) and `returnToMainMenu` clears to `''` rather than writing `'none'`. **⚠ Test this with computed display / `getBoundingClientRect`, never by calling `.click()` — a JS click succeeds on a `display:none` element, which is exactly why automated passes hid the bug from a real player's failure.**
- **⚠ (v36.36) `returnToRootMenu` MUST clear `.lss-launching` before it shows the picker** — it was the fifth `#ship-select` show-site and the only one v36.21 missed, which is why a finished match landed on an invisible click-through picker over the dead arena. Full write-up + measurements in PART 16's *Round system tick* v36.36 entry.
- **⚠** Both confirm prompts used to promise "your current room will close". They now name the room you keep. If the soft path is ever reverted, fix the wording back or it lies.
- **(v35.83) Owner-directed revert: the soft path glitched, so both UI "main menu" buttons (ship-select `lobby-back-btn` + settings `#settings-exit-to-menu`) now call `returnToMainMenu({hard:true})` — full reload, room closes — and both confirm prompts say the room will close again. The soft path remains in `returnToMainMenu()` for internal/future use; matchEnd/`returnToRootMenu` untouched.**
- **⚠** Two other `location.reload()` sites are correct and must stay: the lobby's explicit **leave-room** button (~L5460) and **WebGL context-loss** recovery (~L14333).

### ═══ PART 18 — Input, HUD & menus (~47070–53134) ═══

#### Gamepad & XR input polling — `~L47070`
**Jump:** `function pollGamepad` (~L47195) · `function _xrSynthGamepad` (~L47070)
- **Symbols:** `_xrSynthGamepad`, `_mergedGamepadState`, `pollGamepad`
- **⚠** Merges physical + VR controllers into one virtual pad.
- **(v35.20) GAMEPAD CURSOR** — **Jump:** `function _gpCursorTick` (defined just above `pollGamepad`). Virtual mouse for the flat menus: left stick drives a `#gp-cursor` arrow (z-index 100000, clears `#settings-overlay`'s 200), A clicks `elementFromPoint`. Ticked from inside `pollGamepad` right after `_menuActive` is computed, so it's live from boot and can never touch flight input. Synthesizes `mouseover`/`mouseout`/`mouseenter`/`mouseleave`/`mousemove` — required, because the lobby is built almost entirely from inline `onmouseover` styling. Symbols: `_gpCur`, `GP_CURSOR_SPEED`/`GP_CURSOR_DEAD`, `_gpCursorMakeEl`, `_gpCursorShow`, `_gpCursorEvt`, `_gpCursorSetHover`, `_gpCursorClick`. Console: `window.__gpCursorTest([ax,ay], aDown)`.
- **⚠ (v35.20)** Coexists with the d-pad focus nav by mode-switching: stick → CURSOR, any d-pad press → FOCUS. Settings already binds raw button 0 to `_settingsActivateFocused`, so the cursor sets `_gpCur.consumedA` for the frame and that call site checks it — **without that guard one A tap fires both.** Also: the `if (!gp)` early-return in `pollGamepad` sits *above* the cursor tick, so it calls `_gpCursorTick(null,false)` explicitly or unplugging a pad strands the cursor on screen.
- **⚠ (v35.20)** Synthesized clicks are **untrusted events** — anything behind user activation (`requestFullscreen`, pointer lock, audio-context resume) will NOT fire from them. Pre-existing limitation, shared with the Start → `soloBtn.click()` path.
- **⚠ (v35.20) Sliders & dropdowns need special-casing — a synthetic click does nothing on either.** `_gpCursorClick` intercepts before the mouse-event path: `input[type=range]` → `_gpSetRangeFromX` sets the value from the cursor's x and latches `_gpCur.dragEl`, so holding A keeps it **sliding** (dispatches `input`, which is what the settings sliders actually listen on; `change` fires on release). `<select>` → `_gpCycleSelect` advances the option with wrap, because **a native select popup cannot be opened by script in any browser**. `dragEl` is cleared on every early-exit path or a slider stays grabbed across a menu close.
- **(v35.20) RIGHT STICK = SCROLL.** `axes[3]` scrolls `_gpScrollTarget()` — nearest scrollable ancestor under the pointer, falling back to the open `#settings-overlay` then `#lobby-grid`. Runs *before* the cursor-visibility early-out so you can scroll settings without first waking the pointer. `GP_SCROLL_SPEED`/`GP_SCROLL_DEAD`.
- **⚠ (v35.20) BUTTON-ONLY d-pad reads in menus.** `input.gpDpadUp/Down/Left/Right` are **`d-pad button OR left stick past 0.6`** (~L49659-49668) — that's why the stick was cycling ships and maps in ship-select and would have made the cursor hide itself the instant it moved. Added `input.gpDpadUpBtn`/`gpDpadDownBtn` (+`Prev`) to match the v32.99 `LeftBtn`/`RightBtn` pair, and switched **ship-select nav, settings focus nav, and the cursor mode-switch** to the `*Btn` variants. Anything new that reads the d-pad in a menu must use `*Btn` too. The XR settings handler (`_xrHandleSettingsMenuInput`) intentionally still uses the folded flags — no cursor in VR.

#### Touch controls overlay (mobile) — `~L42220`
**Jump:** `const _touchForced` · `window.LSS_TOUCH`
Self-contained IIFE: on-screen sticks + labeled buttons for phones (`?touch=1` forces on desktop). Floating-origin move stick (over-travel = dash), right-half look zone, right-edge button COLUMN labeled with live loadout names (RT=weapon, RB=ability1, LB=ability0, F=ability2, via `_refreshTouchLabels` in the 250 ms visibility poll), R=RELOAD chip, LT=ZOOM, core button = core name.
- **Symbols:** `_visBox`, `_layoutSticks`/`_layoutSticksSoon` (`window._lssLayoutSticks`), `_refreshTouchLabels`, `_dragReset`, `window.LSS_TOUCH`
- **Editor: [`tools/touch_studio.html`](../tools/touch_studio.html)** (repo root, not deployed) — move / reshape / rename the 17 controls against a device frame, with thumb-reach arcs and the HUD keep-clear rings (15.2 and 19.6 vmin, plus the radar at bottom-centre) overlaid so a control can't be parked where you can't see or reach it. Exports JSON, and CSS lines shaped for the `CSS` array below. Verified round-trip: it re-emits `'#tc-rt { right: 1vmin; top: 1.5vmin; width: 24vmin; height: 15vmin; }'`, identical to what `_el()` + `.tc-rect` produce today. Layout is in **vmin**, and since LSS is landscape-only vmin is screen height — which is why `top:22%` on `#tc-lt` round-trips to `22`.
- **(v35.48) `const _TC_LAYOUT` is the single source of truth for every control's position and size.** **Jump:** `const _TC_LAYOUT`. Baked from the studio. Two consumers read it and used to disagree: `_tcStyle(id)` builds the inline style each `_el()` gets (inline beats the stylesheet, which is what we want — these ARE the positions), and `_layoutSticks` resolves the same entries to px for the four it pins. Positional CSS was **deleted** from the `CSS` array; what remains there is only type size, colour, and the zones' invisibility. Don't reintroduce positional rules — inline silently beats them, so they'd be a dead second source of truth.
- **⚠ The controls have no markup and no stylesheet file** — `document.createElement`'d by `_el()` inside the `#touch-controls` IIFE, styled from a CSS string array. Nothing to point an editor at except `_TC_LAYOUT`.
- **⚠ (v39.19) `_AUDIO_BAKE.maxDur` TRUNCATES RECIPES, and it silently truncated 9 of 66.** **Jump:** `const _AUDIO_BAKE` / `_audioBakeLen`. Every recipe is rendered once into a FIXED-LENGTH OfflineAudioContext buffer, so a recipe whose layers run past the cap just ends mid-decay with a hard edge — `_audioBakeLen`'s own comment says so ("under-sizing this truncates the tail") and the cap was under-sized anyway. At `maxDur: 3.0`: stun_core_zap needed 5.32 s and lost **2.32 (44%)**, firework_pop 1.40, laser_core_beam 1.37, fire_burn 1.30, flame_core_blast 0.83, fire_salvo 0.65, **stasis 0.61**, kill 0.44, shield_hum 0.05 — i.e. the CORE SUPERS were the worst hit. This was the owner's "the stasis shield-charge sound doesn't finish, gets interrupted at the end"; `durVar` jitters the length so it lost a different amount each play. Dated by the owner to the v36.12 overshield, but it actually arrived with the **v35.99 bake**, which shipped near it. Raised to **5.5**. Measured with `window.__sndBakeStats()`: 22.27 -> 23.40 MB, 121.6 -> 127.8 baked seconds, SAME 145 takes (nothing over 1.10 s gets extra takes, so the lengthened recipes already had one each). **Rule: any recipe edit that pushes a layer's `startOffset + dur*(1+durVar)` past `maxDur` is silently cut — check it.**
- **(v39.43) THE ENGINE LIGHTS AND THE TEAM MARKER CLOAK TOO — via a UNIFORM, so no warm is needed.** Owner: "the engine lights, and the red/green sphere should also cloak... and i guess be baked in the warmup as cloaked versions?" The fade was needed; the bake is NOT, and the distinction is the useful part: **`transparent` is in three's program cache key (so the hull needed v39.40's pre-warm), a UNIFORM is not** — changing it forks no program and compiles nothing. Those glows never faded because they are LayeredFX **ShaderMaterials**, and three only applies `material.opacity` to its own built-in materials; on a ShaderMaterial it is an unused property, so `_setShipMeshOpacity` was setting a number nobody read while the discs stayed lit over an invisible hull. Now it scales their brightness. Measured on a live c1seat hull in a match: **five FX materials on `root.userData.shaderEngineMats`**, `uBrightness` a plain number on each — 2.4, 2.4, 2.2, 2.2 and **3.6** (`_markerGlowMat`, the class/team marker = the red/green one). ⚠ `uLayerAlpha` also exists but its value is an **Array** (per-layer alphas) and `uOpacity` is absent, hence the `typeof === 'number'` guard — it skips both rather than touching LayeredFX's layer logic. ⚠ And `shaderEngineMats` IS present on GLB c1seat hulls, not only the procedural path — I assumed otherwise from the assignment sites and was wrong; check the live object.
- **(v39.40) THE CLOAK'S TRANSPARENT VARIANT IS PRE-WARMED** — `_warmCloakVariantOnce`, called from the gameLoop warmup arm beside the terrain drain, once per session. Clones each OPAQUE hull material, marks it `transparent` at the real cloak opacity, swaps it onto the SAME MESH (identical geometry, so the program key matches what combat asks for), `renderer.compile(root, camera, scene)`, restores the originals, then hands the clones to `_lssRetainMat`. Logs `[cloak] pre-warmed 14 transparent hull program(s)`; `window.__cloakWarm` holds the count.
  - **⚠ IT MUST BE A CLONE THAT IS THEN RETAINED.** Flipping the real material, compiling and flipping back frees the program the instant its last user reverts — three refcounts programs per material.
  - **⚠ NOT IN THE PREBAKE.** Two attempts failed there: `player.mesh` does not exist yet when a launch prebakes (the ship is built afterwards), `shipWarmupMeshes` is EMPTY on the lite-warm path (`_liteWarm ? [] : loadedKeys`), and the report object `rep` is not in scope at that point — it threw `ReferenceError: rep is not defined` into a `catch` that only warned, so it looked like "cloned nothing". Warmup is the first frame the real hull exists and it is still behind the countdown.
- **⚠ (v39.37) `_setShipMeshOpacity` SET `needsUpdate` EVERY FRAME WHILE CLOAKED.** Owner: "hitch on auto cloak". It runs per frame from `_tickPerkEffects` over every material on the hull — measured **19 materials** on a c1seat ship — and set `m.needsUpdate = true` unconditionally, which bumps the material version and makes three re-evaluate the program on the next render. That is 19 program re-evaluations PER FRAME for the whole cloak. Worse, `transparent` is in three's program cache key, so the false->true flip forks a NEW program for each of the 14 opaque ones, and on ANGLE that first use is a synchronous D3D compile — the hitch itself. **`opacity` is a plain uniform and never needed a recompile.** Now: set opacity freely, touch `needsUpdate` only when `transparent` actually flips. ⚠ The first cloak still forks 14 programs; pre-warming the transparent variant (render a warm copy with `transparent = true` once) would remove that too and has not been done.
- **(v39.36) The warmup terrain drain is 12 ms ONLY behind the picker, 3 ms once the world is visible.** `_swDrainStream(_fX, _fZ, 12, 64)` ran a fixed 12 ms wall-clock slice every warmup frame; the v36.26 note defends that as "loading frames, not gameplay frames", which is true behind the picker and false during the CINEMATIC. 12 ms on top of a ~10 ms scene pass is a ~22 ms frame on any machine. ⚠ **NOT the Chrome gap** — DuckDuckGo hits 144 fps at the same moment on the same build.
- **⚠ CHROME 152 IS THE OUTLIER, NOT THE CODE — four browsers, same build:** Firefox (Gecko) 144 · DuckDuckGo (Chromium/WebView2) 144 · the Claude Code Browser pane (Chromium) 144 · **Chrome 152 60-100, and 20 in heavy combat**. Its `about:gpu` is the only unusual one: `Skia Graphite: Enabled` / `Skia Backend: GraphiteDawnD3D11`, `Direct Rendering Display Compositor: Disabled`, and **every overlay format SOFTWARE**. Ruled out there too: GPU0 is the RTX 5050 and `*ACTIVE*`, `Software Rendering: No` — not GPU switching. Also ruled out by measurement: **backdrop-filter** (seven in the sheet, ZERO visible in state `playing`; only small drop-shadows on `#hit-marker` and five 124x48 tags).
- **(v39.35) `_prebakeGpuPrime` YIELDS AFTER EVERY PASS, not after each ring of four.** Twelve full-scene renders at fov 130 were submitted 4-at-a-time, which hands the GPU process one enormous unit of work. The owner's second Chrome trace shows exactly that: **two OPAQUE blocks on the GPU PROCESS main thread in the launch window — 861 ms @23.91s and 1207 ms @25.65s — with no nested events**, i.e. blocked inside a single call. Three rings of four = three such blocks. Same twelve renders, same total GPU work; the driver gets twelve flush points instead of three. Verified `gpuPasses: 12` still, no errors. ⚠ The distribution improvement CANNOT be verified in the pane — a hidden tab throttles rAF, so frame-gap recording there reads zero. It needs a trace from a visible window.
  - **⚠ (v39.34 CORRECTION) the desktop texture cap moved the real GPU peak far less than the upload inventory predicted: 252 -> 239 MB, ~13 MB, not the ~294 MB I claimed.** `used_bytes` in the GPU process counts compositor surfaces and Chrome's own Graphite allocations, not just our uploads, so a per-texture upload inventory is NOT a proxy for it. Keep the cap (it is free and correct) but do not size a fix from upload totals again.
  - **Where the launch time actually is, from that trace:** the renderer's own stall is `TimerFire -> RunMicrotasks` 627 ms @20.70s (our async/await chains resolving in one checkpoint) — that one is still unattributed and is the next thing to look at.
- **✅ (v39.34) DESKTOP HAD NO TEXTURE CAP AT ALL, and that is where the GPU memory went.** `_lssTexCap()` ended `return small ? _TEX_CAP_SMALL : 0` — 0 meaning NO CAP — so on desktop the seven hulls uploaded their full **2048x2048** base maps. Measured with a per-GL-object texture inventory: **14 textures at 2048² = 300.2 MB** plus 20 at 1024² = 107.2, **~407 MB total**. Capped to 1024 (MEGA/ULTRA keep 2048; `window.__texCap = {max:2048}` restores): **407 -> 113.4 MB**, the 2048 group gone entirely, hull detail unchanged by eye at the ship-select hero shot (the largest a ship is ever drawn).
  - **Diagnosed from the owner's Chrome performance trace** (build 39.33, so v39.32's shader fix was already in and this is NOT that): JS is **4.6 ms/frame** in the slow window — the main thread is **75% IDLE**; frames block for 22-33 ms **INSIDE three's render** (`FunctionCall r`, three.module.min.js); one **1808 ms task on `CrGpuMain`**, the GPU process main thread; and GPU memory climbs all session to a **252 MB peak**. GPU service saturated, WebGL calls waiting on it — not CPU, not shaders.
  - **⚠ Chrome vs Firefox/DuckDuckGo was never a code difference.** Same engine (DDG on Windows is WebView2), same textures; Chrome 152 adds `GraphiteDawnD3D11` compositing with the display compositor disabled and all overlay formats SOFTWARE (`about:gpu`), which pushes an already-huge texture set over its budget first. Ruled out by that same report: GPU0 is the RTX 5050 and `*ACTIVE*`, `Software Rendering: No` — **not** laptop GPU switching.
  - **⚠ `window.__dynRes = {on:true}` ON DESKTOP MADE IT WORSE**, and predictably: every step reallocates the scene + bloom render targets, and near the threshold it re-steps every 2 s. It is gated to small devices for a reason; do not suggest it as a desktop fix.
- **✅ (v39.32) THE CHROME-ONLY START-OF-COMBAT HITCH IS `renderer.debug.checkShaderErrors`.** three.js defaults it to **true** and this codebase never set it. It makes three call `getProgramParameter(LINK_STATUS)` / `getProgramInfoLog()`, and **on ANGLE those BLOCK until the D3D compile finishes** — so every program's first use in combat serially joins its own GLSL->HLSL compile, defeating KHR_parallel_shader_compile entirely. Diagnosed from the owner's own Chrome console: `[prebake] ... gpu 1618, drain 7` (the drain is fine — the parallel machinery works) alongside repeated `THREE.WebGLProgram: Program Info Log: (188,1): warning X4000 ... (f_samplePatternLFX_int)`. **X4000 is a D3DCompiler/HLSL warning**, i.e. proof three was reading the info log. Firefox was smooth on identical code (144 fps, 80 fps floor) because its WebGL path makes that check cheap — that browser split IS the signature. Left ON through boot and the whole prebake so real GLSL errors still surface (the X4000 is a genuine, harmless find in the skin-pattern shader) and the blocking sits behind the loading screen; turned **off in the prebake's `finally`**. `window.__shaderErrChecks = true` keeps it on for shader work.
- **(v39.31) `?pbhud`** puts the `[prebake]` line, program count, `parallelCompile yes/no` and the unmasked GL renderer on screen bottom-left after every launch — built because the owner diagnoses by photographing overlays rather than opening DevTools mid-match, and it is how the above was found.
- **(v39.30 follow-up) THE `roundEnd` FPS DIP — reproduced ONCE, four candidates ruled out, mechanism still unexplained.** Owner: "it dropped to about 20fps at the end of the match, after the kill and before the respawn." One run reproduced it exactly: the WHOLE 5 s `roundEnd` window ran at **117-128 fps against a 145 baseline** (a ~19% drop; off a phone's ~25 fps baseline that is 20). Later runs showed **no drop at all** (146 fps), so it is CONTENT-dependent, not state-dependent — and every timer-forced round end I could produce lacks the kill FX a real ending has. Ruled out BY MEASUREMENT, not reasoning:
  - **GPU goes DOWN**, 4.44 -> 3.49 ms, with 99 fewer visible objects and 44k fewer triangles. So it is not fill or draw.
  - **Game-loop CPU is flat**: `window.__prof` per-frame totals 4.36 -> 4.14 ms, every one of the 20 systems within 0.02 ms.
  - **Scoreboard**: `display:none` during `roundEnd`; hiding it changes nothing (121 vs 120).
  - **`#ov-banner`** (hiding it) and **music** (`musicSetEnabled(false)`): no effect.
  GPU down + loop CPU flat + fps down means the cost is OUTSIDE both — browser layout/paint/compositing, or something not on the profiled path. ⚠ `b.health = -1` does NOT kill a bot (the round did not end), so a synthetic kill-ending needs the real damage path; that is the missing repro.
- **⚠ (v39.30) THE ROUND-TRANSITION SPIKE IS THE SHIP PREVIEW'S SHADER COMPILE, NOT THE LEVEL REBUILD.** Owner: "there's a lag spike usually when i get the last kill... it's like it starts loading the next stuff right there." Measured timeline of a forced round end: `roundEnd` at t=516ms, `warmup` at t=5520, then **ONE 2392 ms frame at t=7912** — i.e. right after the picker is raised, not at the kill. `window.__rrStage()` names it on the two-context path (`ms.picker = 1466`, the whole cost) and hides it on the one-context path (`ms.picker = 8` but `totalMs 2550` against **128 ms of accounted phases** — 2422 ms unattributed). Same cause both ways: `_applyShipPreviewModel` fired `compileAsync()` WITHOUT awaiting it and added the hull to the scene in the same tick, so the next render blocked on the compiler for a whole hull. **Fix: stage the model in the promise's `.then`.** Measured 2392 -> 1343 ms (-44%), `totalMs` 2550 -> 1498. ⚠ Re-check `lastKey`/`pendingKey` inside the `.then` — the player can cycle ships mid-compile and a late resolve must not drop a stale hull on the stage. **Still unattributed: the remaining 1343 ms.** And note `_rrStagedRound` (v36.39) already spreads the REBUILD across frames behind the picker — its own phases measure world 36 / terrain 84 / reset 3 / shaders 0, so the rebuild was never the problem.
- **⚠ (v39.29) THE LAUNCH LOADING CAPTION IS NOT ATTRIBUTION — "compiling shaders" is 13 ms.** Measured with a per-frame recorder that samples the loading caption: a launch stalls the main thread for **~11 s across a handful of frames**, the largest a **single 5012 ms frame in state `select`**, and every one of them shows "PREPARING ARENA / compiling shaders" — because `_pbSub` sets the caption once and it persists. `window.__prebake()` gives the truth: `totalMs 2196 | gpu 504, mon 443, ent 218, fx 130, drain 13, terrain 6, clip 4`. The **compile drain** (the `KHR_parallel_shader_compile` completion wait) is **13 ms**; the whole prebake is 2.2 s of the ~11 s. The remaining ~9 s is the LEVEL BUILD. I batched `_compileHere` across frames on the shader theory and measured NO change (9.8 s -> 11.0 s, noise) — reverted. Start at the level build, not the shaders.
- **(v39.28) ADAPTIVE RESOLUTION** (`_lssDynResTick` / `_lssDynResBase` / `_DYNRES`, called from `gameLoop`). Mobile is FILL bound — the owner found it themselves ("taking off fullscreen improved the fps quite a bit"), and the crackling audio is the same problem (the graph underruns when frames blow their budget), not a second one. Measured with `EXT_disjoint_timer_query_webgl2` (fps is vsync-capped and shows nothing): **scene pass 4.93 ms of GPU at 1.0 MP** on a desktop RTX card — **terrain 241 meshes / 2.72 ms / 55%**, transparent FX 828 meshes (164 visible) / 1.40 ms / 28%, monsters 0.13, water 0.06, ships ~0. A phone GPU is an order of magnitude slower per pixel, so ~0.5 MP lands at 30-90 ms/frame = the 12 fps reported. The scaler averages frames over 1.5 s, steps the render scale down 12% over target and up 6% after two good windows, floor 0.5, one change per 2 s (each reallocates the scene + bloom RTs). Small devices only; `window.__dynRes = {on:false}` / `{target,min}` / `window.__dynResState`. Verified by forcing a 6 ms target: 1.00 -> 0.88 -> 0.76 -> 0.64, canvas 1157x860 -> 740x550.
  - **⚠ The one-context merge did NOT cause the mobile slowness** — the owner A/B'd it: default and `?twoctx` are equally slow. Do not re-litigate that.
- **(v39.25) ONE CONTEXT: the picker is drawn by the MAIN renderer.** **Jump:** `_ONE_CTX_PREVIEW` / `_lssRenderPicker` / `_lssPickerOwnsFrame` / `_previewFitBackdrop` / `_bindShipPreviewDrag`. The ship picker's rotating GLB no longer has its own `WebGLRenderer`; the same scene is rendered straight to the game canvas from the two `gameLoop` branches where the picker covers the screen (`game.state === 'select'`, and the `_rfCovered` warmup branch). **Verified `ctx` 2 -> 1.**
  - `#ship-preview-canvas` STAYS in the DOM with **no GL context at all** (it sits at its default 300x150) purely as the pointer target, so `_bindShipPreviewDrag` is shared and drag-to-rotate is untouched.
  - The hangar backdrop becomes a quad in the preview scene textured from **the very same `#ship-select-bg` canvas** (identical pixels, scrim included), sized by `_previewFitBackdrop` to fill the frustum with `object-fit: cover` reproduced in UV space. The DOM backdrop is hidden and `#ship-select` goes transparent.
  - **⚠ `#ship-select`'s 95%-opaque background was hiding the combat HUD for free.** With it transparent the round clock, ring, radar and cockpit frame bleed through the picker (an obvious live "3:00 WARMUP" over the hangar between rounds). `body.lss-picker-3d` hides them, set from the spin loop only while `_lssPickerOwnsFrame()`, and cleared in `stopShipPreviewLoop` so nothing can strand the HUD hidden.
  - **⚠ Do NOT touch `renderer.outputColorSpace` or `toneMapping` in `_lssRenderPicker`** — both are in three's program cache key, so flipping them per frame would recompile every material every frame, which is the cost this change exists to remove.
  - **A/B: `?twoctx` in the URL** (or `window.__onePassPreview = false`) restores the old two-context path unchanged — verified `ctx 2`, opaque picker, DOM backdrop, preview canvas 1367x860.
  - **⚠ (v39.26) THE PICKER RENDERS FROM ITS OWN rAF, NOT FROM gameLoop.** v39.25 drew it inside gameLoop's `>= 167 ms` gate — a throttle that is correct for an INVISIBLE arena behind a cover and completely wrong once the thing being drawn IS the picker. Owner: "the ship spinning looks choppy". It was **6 fps**; measured **144 fps** after moving the draw back into `_animateShipPreview`. gameLoop now simply skips `renderFrame()` while `_lssPickerOwnsFrame()`, which also saves the wasted arena pass. ⚠ That function requires `_shipPreview3D.animId` — gameLoop declines to paint on the strength of it, so a stopped loop would leave the canvas blank.
  - **⚠ (v39.26) Set `body.lss-picker-3d` in `startShipPreviewLoop`, not just on the loop's first tick.** The picker is already on screen and transparent by then, so waiting one frame let the round clock show over the hangar — owner: "i saw the timer in the ship selection screen".
  - **Hitching A/B (desktop, one run each, confirm -> 30 s):** one context median 7 ms / p95 8.8 / p99 43.2 / 9 spikes >50 ms; two context 7 / 8.4 / 24.5 / 5 spikes. The multi-hundred-ms spikes (1179, 1030 vs 1489, 991) are the arena build and are present in BOTH — pre-existing. The mid-range difference is real but small and single-run; not yet explained.
  - **⚠ THE PROGRAM SAVING DID NOT MATERIALISE.** In-match program count is 174, against ~171 before: the `srgb-linear` vs `srgb` renderer fork is gone, but the DOMINANT fork is `numPointLights` (0 in the picker scene vs 14 in the arena), and that remains. What this change actually buys is the second swapchain, the duplicate hull upload, and `ctxL 2` — not the program table.
- **⚠ (v39.24) TWO FULL-SCREEN SWAPCHAINS DURING WARMUP — the one thing every crash line shares.** `_animateShipPreview`'s visibility test was `#ship-select.active`, but `.lss-launching` sets `#ship-select-body { display:none }` and `#ship-preview` lives INSIDE that body. So from CONFIRM & LAUNCH through the countdown and the whole of warmup the preview canvas was invisible yet still "visible" to the loop: still rendering, still holding a FULL-SCREEN drawing buffer in the second context, exactly while the arena is being built. Both v39.23 crash lines say it outright — `warmup | ctxL 2 | prev 1089x485`, in classic at up 26s AND in exhibition at up 20s. Now gated on `!lss-launching`; verified 1x1 through countdown+warmup and reinflating to full size with the hull on it at the between-rounds picker.
- **⚠ (v39.24) THE SECOND RENDERER DOUBLES THE SHIP PROGRAM SET.** Dumping `renderer.info.programs[].cacheKey` and diffing variants of one material: `hull` has **11** programs, `Vortex_CP_Graphite` **9**, `Vortex_Windshield_LaminatedGlass` **6**. The differing fields are `4: srgb-linear` vs `srgb` (main renderer vs PREVIEW renderer — every ship material is compiled twice, once per context), `36: 14` vs `0` (numPointLights: arena vs the preview scene), `47: 0` vs `4` (shadow count) and `54: lssSkinHue` vs `ghostHull`. The skin system is NOT at fault — it declares a constant `customProgramCacheKey` precisely to avoid this (see the PART note at ~L4815). This is why the owner's question "is it the new ship models, the glass cut-outs and the cockpit?" is half right: the c1seat hulls added several distinct materials per hull (hull / CP_* / LaminatedGlass / InnerHull_Composite / LIN13 / GL11) and EACH is multiplied by renderer x light-count x shadow x ghost variants. Killing the second renderer would halve the ship half of the program table.
- **✅ (v39.21) THE ANDROID CONTEXT LOSS IS BUDGET EVICTION OF THE OLDEST CONTEXT — CONFIRMED FROM THE PHONE.** Crash line: `lost gl1@3s,gl0@59s | ctxL 2 | ctx 1 | pv 3/28/10 | hulls 1 | prev 1x1`. `prev` is **absent from the lost list**: Chrome force-lost `gl0`, the GAME's context (the oldest, created before the preview's), while the preview context stayed alive — `ctxL 2` live at the moment of loss, `ctx 1` after. It is NOT a GPU-process collapse (that would take both) and NOT a slow leak (every main-renderer number is healthy). **The game's own context is the eviction victim precisely because it is created first**, so anything the SECOND context holds is taken straight out of the game's budget.
  - **⚠ (v39.21) A LOWER STEADY-STATE RESIDENCY IS NOT AUTOMATICALLY BETTER — the ALLOCATION BURST matters more, because it sets the peak.** v39.20 dropped the preview's hull cache at match start to save ~4 MB during a match; the next crash read `hulls 1 | prev 1x1 | pv 3/28/10`, i.e. the between-rounds picker had just REBUILT a hull (textures uploaded, ~10 programs linked into the second context) and had not yet reinflated its framebuffer — it died *inside that burst*, which v39.20 had made happen every round instead of once a session. Reverted. Keep the LRU (it bounds residency while browsing) and keep the FRAMEBUFFER release (no re-upload on the way back), but do not force a hull re-upload at the moment the game is most loaded. `pvB <ms>[/inflight]` in the overlay now reports ms since the last hull build started.
  - v39.21 also drops **MSAA and `powerPreference:'high-performance'` from the preview on small devices** (`antialias:false`, verified `gl.SAMPLES === 0`): it is the DEFAULT framebuffer of a second context, viewport-sized whenever the picker is up.
  - **NEXT LEVER IF IT PERSISTS: one context.** The preview is a separate `WebGLRenderer`, and while it exists the game is the older, evictable one. Options, cheapest first: (a) rebuild the preview context per picker (`_disposeShipPreview3D` already exists, correct, and is dead code) so a match runs with ONE context; (b) add a `webglcontextlost` handler to the PREVIEW that rebuilds it, so if Chrome ever picks that one the picker self-heals; (c) render the hero hull with the MAIN renderer and delete the second context entirely — the real fix, and the only one that removes the eviction target. None of these touches the rotating GLB itself, which the owner has ruled off-limits.
- **⚠ (v39.20) THE ARENA WAS RENDERING AT FULL RATE BEHIND THE OPAQUE BETWEEN-ROUNDS PICKER.** **Jump:** the `_rfCovered` block at the gameplay `renderFrame()` in `gameLoop`. `game.state === 'select'` has always had a 6 Hz throttle (`_selectLastRender`) because `#ship-select-bg` covers the screen — but the BETWEEN-ROUNDS picker runs in **`game.state === 'warmup'`**, which fell straight through to the full gameplay path. `warmup` is the state in **every** crash line the owner has photographed. Measured A/B in the pane, sampled inside the live picker window: main context **43,730 draws/s → 1,736 draws/s (−96%)**, preview context unchanged at 2,311/s. `#ship-select-bg` is opaque (alpha 255 sampled at all four corners + centre, `object-fit:cover`, inset 0), so zero visual change. ⚠ Guarded OFF during `.lss-launching` (the countdown strips the backdrop and the arena behind it must be live for the 3-2-1) and in XR. A/B with `window.__noOccludedThrottle = true`.
- **⚠ (v39.20) THE PREVIEW CONTEXT HOLDS A SECOND GPU COPY OF EVERY HULL BROWSED, and renderer.info cannot see it.** **Jump:** `_ssPrevOwnTextures` / `_ssPrevRelease` / `_applyShipPreviewModel` / `stopShipPreviewLoop`. Measured with a per-context `texImage2D`/`bufferData` probe on the mobile set: browsing all seven hulls uploaded **24.0 MB texture + 17.2 MB buffers** into the preview's own context, never freed (`modelByKey` is per-session; `_disposeShipPreview3D` is dead code). **The crash overlay's `tex`/`geo`/`prog` are the MAIN renderer's `renderer.info` and are structurally blind to all of it** — which is why every crash line looked healthy.
  - Fix: the preview's material clones get their OWN texture handles (`Texture.clone()` shares the `source`, and three refcounts the GL object per (source, cacheKey) PER RENDERER — so the clone costs no extra GPU memory and disposing it deletes only the preview's copy). Then `_ssPrevRelease` frees them: LRU-1 on small devices when switching hulls, and everything at `stopShipPreviewLoop` (match start). Verified by hooking `deleteTexture`: 2 deletes per hull switch, 2 more at match start.
  - **⚠ NEVER set `.needsUpdate` on one of these clones** — the setter bumps `source.version` and the MAIN renderer re-uploads every hull texture on its next frame. **NEVER dispose the original** off `shipModelCache`; both renderers listen for `'dispose'` on the same object (the `_sharedGLBGeo` hazard).
  - **⚠ `lastKey` MUST be nulled** wherever `modelByKey` is dropped — `_applyShipPreviewModel` early-returns on `s.lastKey === key && s.model` and would leave an EMPTY STAGE on reopen.
  - **STILL OPEN: the 17.2 MB geometry half.** The clones share the game's `BufferGeometry`, so it cannot be disposed. Owning it means cloning the geometry too — cheap for plain attributes (`BufferAttribute.clone()` shares the typed array) but `InterleavedBufferAttribute.clone()` with no `data` de-interleaves and ALLOCATES, and GLB attributes may be interleaved. Measure before adding.
- **(v39.18) THE SHIP-PREVIEW IS THE SECOND WebGL CONTEXT, and it used to be the BIGGER one.** **Jump:** `_shipPreviewDpr` / `_initShipPreview3D` / `_animateShipPreview` / `stopShipPreviewLoop`. Three things, all measured in an Android-emulated pane (Pixel UA, 760x350, dpr 2):
  - **`_shipPreviewDpr()` is the SINGLE OWNER of the preview's backbuffer scale** and must be used in BOTH `setPixelRatio` and `_animateShipPreview`'s resize guard. That guard is `domElement.width !== floor(clientWidth * dpr)`; if the two numbers disagree by anything it is true EVERY FRAME and `setSize` reallocates the drawing buffer every frame. (An earlier v39.18 attempt capped the ratio at `window.renderer.getPixelRatio()` at init — the main renderer's ratio is DYNAMIC (1.5 at the menu, ~0.975 under load), so that would have done exactly this.) Mobile cap 1.5 -> **1**: at 1.5 the full-bleed stage owned MORE pixels than the game (measured: game canvas 741x341, preview 1140x525 = 2.37x, antialiased, alive all session).
  - **The buffer is released to 1x1 while the picker is off screen** — in the loop's `!visible` branch AND in `stopShipPreviewLoop()`. The second one is the load-bearing one: `finishLaunch` drops `.active` and calls `stopShipPreviewLoop()` in the SAME synchronous block, so no rAF fires between them and the loop branch never runs on the way into a match. The CONTEXT is deliberately kept (see `_disposeShipPreview3D`, which is **dead code** — never called — for what tearing it down costs). `window.__prevNoShrink = true` disables it from the console for A/B.
  - **⚠ `scene.environment = sceneEnvMap` was a CROSS-CONTEXT borrow and rendered nothing.** `sceneEnvMap` is a PMREM RENDER TARGET owned by the MAIN renderer — a GPU-only texture with no `image`, so the preview's context silently binds nothing. Desktop survived on clearcoat + the four lights; **mobile did not**, because `ships/m/` is the LEAN set (PBR extensions disposed to plain metallic MeshStandardMaterial) and metal with no environment is black. That was the owner's "there's no ships in the preview, on mobile" — the hull was on the stage the whole time, unlit. Fixed the same way v39.11 fixed `bakeShipThumbnails`: a 64x32 gradient through the preview's OWN `PMREMGenerator`.
- **⚠ (v39.18) `window.__glCtx` DELETES on `webglcontextlost`, so a LOW `ctx` count in the crash overlay is AMBIGUOUS** — it means "one context is gone", not "one was ever made". v39.15 read `ctx 1` as proof no second context existed and concluded eviction was refuted; the pane shows `ctx 2` in the same situation, and the phone's `ctx 1` is equally consistent with the preview context having already been evicted. `window.__glLost` now records the loss ORDER (`prev@77s,gl0@78s`) and the overlay prints it, plus `prev WxH` for the preview canvas's backing store. **`gl1@Ns` in that list is normal** — it is `bakeShipThumbnails` force-losing its own temporary context, once, at load.
- **⚠ (v39.16/39.17) `#tc-core` is px-pinned too, and its top is MEASURED, not laid out.** `_layoutSticks` now `pin()`s it and then pushes its top to `max(bottom of #round-state, #round-timer, #champ-capture, #endless-hud) + 8`. **(v39.17) It clears the ROUND LABEL, not the whole `#round-info` block** — `#score-display` is a CENTRE-justified flex with a fixed `gap:180px`, so the two fleet scores sit at the ENDS and leave a permanent 180px empty channel down the middle that longer score digits do NOT close (the row grows outward). CORE is 117px wide and fits inside it, so it sits LEVEL with the score line and still covers no text: measured 474..591 @ y79..123 against scores ending 455 / starting 635 at 1090×485, and 365..459 @ y79..114 against 332 / 512 at 844×390 where the score text wraps. Clearing the whole block (v39.16) put it at 110px, which the owner called too far down (viewport px, minus the visible box's own top). CORE is the only overlay button on the centre line, so it is the only one that can land under the round clock — and it did (owner: "the core button sometimes is hidden behind the clock timer"): `#round-info` is FIXED PX (10..102 at 1090×485, 10..121 at 844×390 where the score line wraps) while `_TC_LAYOUT` is vmin, so no constant clears it at more than one viewport. Same contract as `_hudPinTopBand` / `#champ-capture` (PART 18) — this is that band's **fifth tenant**, just positioned from the touch module because that is where the button lives. The `y:12` in `_TC_LAYOUT` is only the fallback for when the clock is hidden (freeflight). ⚠ `pin()`'s `ax:'center'` branch bakes centring into `left`, so the build-time `translateX` from `_tcStyle` is cleared — leave that line in or the button shifts twice.
- **⚠ `_layoutSticks` px-pins `#tc-move`, `#tc-look` and both capture zones every pass**, so CSS for exactly those four is inert (see the v35.04 note below). That is why they read `_TC_LAYOUT` directly; a layout change that touches the sticks or zones and only edits CSS will appear to do nothing.
- **⚠ `shape` must be written explicitly.** `▲`/`▼` carry `.tc-chip` (`border-radius:50%`); an id rule that sets width/height does not undo it, so a part drawn as a rect renders as an ellipse unless `_tcStyle` writes the radius — which it does.
- **⚠ Mixing `center` and `right` anchors converges as the screen narrows.** `tc-core` (centre) and `tc-lt` (right) clear by 21.7 vmin at 19.5:9 and 2.3 at 16:9, but cross below **1.73:1** and overlap by 20 vmin at 4:3. Fine for phones — LSS is landscape-locked and real phones are 2.0–2.22 — but worth knowing if tablet support ever matters. Same trap sank the top button row: exported centre-anchored at −84.7 vmin, which is off-screen on anything under ~16:9, so those four were re-anchored left at their identical 16:9 positions.
- **⚠ (v35.04)** `_layoutSticks` pins the overlay ROOT + sticks/zones in px to the CONSERVATIVE visible box (intersection of visualViewport and inner W/H) — Chrome's layout viewport can come out of the round-start fullscreen/orientation settle taller than the real screen while the intro cinematic hides the overlay (CSS vh/vmin bottom-anchoring then lands off-screen = the old "sticks gone after cinematic" bug). The visibility poll re-pins on EVERY hidden→shown flip and resets interrupted drags on hide (display:none never delivers pointerup on Chrome). Don't revert sticks to CSS-unit positioning.
- **⚠ (v35.06)** Orientation locking REMOVED game-wide: `window._lssLockLandscape` is a kept-as-no-op stub (~L3079). The old lock-at-ship-select + unlock-at-warmup/FIGHT cycle made Chrome/Android re-evaluate orientation mid-match — on auto-rotate-off phones that rotated the viewport right while a thumb was on the sticks. Don't reintroduce mid-session `screen.orientation.lock/unlock`. `_visBox` now arbitrates TRANSPOSED viewport claims (vv says portrait while inner says landscape or vice versa — Chrome's rotation-settle lie, can persist with no final resize event): per-axis min would build a bogus square box, so it asks `screen.orientation.type` which orientation is real and takes that source whole. Sticks module also listens to `screen.orientation` `change` (window-level resize events get eaten by fullscreen transitions), and `_layoutSticks` leaves `tc-move` alone mid-drag (`_moveDragging`).
- **⚠ (v35.07→v35.08)** Field result: Chrome/Android window metrics (inner + visualViewport BOTH) can wedge stale for an ENTIRE fullscreen session — no final resize ever fires; exiting fullscreen was the only thing that refreshed them. So `_visBox` treats fullscreen as ground truth: when `document.fullscreenElement`, the visible box is the display itself → clamp to the display dims, or take them outright if the claims are unanimously transposed vs them (clamp-first keeps Android split-screen working). **v35.08 CRITICAL detail:** many Androids report `screen.width/height` in PORTRAIT-primary terms permanently (they never swap on rotation) — v35.07 compared against the raw dims and force-fed a portrait box onto honest landscape claims (field-confirmed regression). ALWAYS orient display dims via `screen.orientation.type` before comparing. The v35.07 on-screen `#tc-dbg` strip is removed; `LSS_TOUCH.dbg` (console getter) returns the live `_visBox` snapshot + raw sources instead.
- **⚠ (v35.09)** Three de-escalations at the movement-unlock (warmup→playing) frame, per the field pattern "works 2 s post-cinematic, breaks exactly when movement unlocks": (1) the v30.99-era `window._lssLayoutSticks()` call at FIGHT is DELETED — it was the only code rewriting stick geometry at that exact frame; nothing repositions the overlay at that transition anymore. (2) `_safeRequestPointerLock` hard-bails when `input.touchActive || input.touchSuppressMouse` — a tap-granted pointer lock on Android swallows all touch pointer events (zones/buttons dead) and persists until FULLSCREEN EXIT; `closeSettings()`' relock had no touch gate. (3) The 1.2 s poll also verifies both sticks' rects sit inside the visible box and force-re-pins if not — catches ANY actor that moves them, known or unknown, within ~1.2 s.
**Jump:** `function drawCircumpunctHUD` (~L47687)
Central circular reticle (health arc, ability ring) on the `circumpunct-hud` canvas.
- **Symbols:** `hudCanvas`, `_HUD_TICK_COUNT`, `drawCircumpunctHUD`
- **(v35.40) LAYOUT HUD is the shipping path** — **Jump:** `const _HL = {` · `function _hlDrawHUD` · `function _hudSharedTail`. Every gauge is placed in **VMIN** (1 = 1% of `min(innerW, innerH)`) against one of nine anchors (`t/m/b` + `l/c/r`), replacing the old pixel constants (`r1=172`, `r2=190`, `r3=240`, `cy + r1 + 76` …), so the cluster scales with the screen and edge readouts keep their distance from *their* edge on any aspect. Renderers `_hlArcBar` / `_hlTicks` / `_hlPips` / `_hlReticle` / `_hlText` / `_hlCompass` are ports of `tools/hud_studio.html`'s primitives (repo root, not deployed). Frameless by design: the cockpit art gets built **around** this (see `_forFrameDesign` in `tools/hud_layout.json`, keep-clear radius 19.6 vmin), which is why the v35.39 mapped-frame path is now behind `window.__hudMapped` and the ~950-line pixel circumpunct behind `window.__hudLegacy`. Numerals for speed/ammo: `window.__hudNums = 1`.
- **(v36.19) FLAT-SCREEN HUD SCALER — `input.hudScale`, the VMIN-layout twin of `vrHudScale`** (owner: *"do a flat screen HUD scaler, the HUD will scale like the VR mode does (excluding the mini map)"*). **Jump:** `function _hlScale()` (right above `_hlPlace`) · `_hlPlace(p, W, H, s)`'s new 4th arg · the two `_hlPlace(_HL.minimap|compass, W, H, 1)` calls in `_hlDrawHUD` · the `#set-hud-scale` settings row.
  - **One insertion point covers the whole HUD.** Every part's size, stroke width, tick length, glow radius, label radius and font size derives from the `vmin` `_hlPlace` returns, so multiplying there IS the scaler. A `w`/`h`-only scale would grow the rings and leave the strokes and captions behind. Range **0.75–1.75, step 0.05, default 1**; clamped in `_hlScale()` AND on load, so a hand-edited localStorage cannot wedge the HUD off-screen. Persisted in `saveSettings`/`loadSettings` and present in `SHIPPED_DEFAULTS` (deliberately unlike `vrHudScale`, which survives Reset to Defaults — a knob that can degrade legibility must be resettable).
  - **⚠ THE VR GATE IS MANDATORY, NOT DEFENSIVE.** `_xrEnsureHudMesh` textures the VR HUD plane from the **same `#circumpunct-hud` canvas** this layout draws into, and the XR path calls the same `drawCircumpunctHUD()`. Without `_hlScale()`'s `isXRPresenting()` early return a headset would see `hudScale × vrHudScale` — **2.25× at both defaults**. The VR row's help text now says the two never compound; keep it true.
  - **⚠ SIZE AND ANCHOR-OFFSET SCALE SEPARATELY, and that split is load-bearing.** The scale applies to the size unit always, but to a part's anchor offset only on the axis anchored to the SCREEN CENTRE. A centre-anchored offset is a radial position inside the gauge cluster (`dash` at x −9.7 / y 7) and must ride out with the rings, or the pips end up on top of the core arc. An edge-anchored offset is a standoff from that edge (`aegis` at `bc` y −3.3, `objective` at `tc` y 9) and must hold, or `aegis` marches up into the pinned compass rose — the one relationship its v35.42 `mc→bc` re-anchor exists to express (it collides at S ≈ 1.46 under a blanket anchor-scale). At S = 1 the output is byte-identical to pre-v36.19.
  - **EXCLUDED: `_HL.minimap` AND `_HL.compass`, via the explicit `1` 4th arg.** The owner asked for the minimap; the compass has to come with it — both are `a:'bc', x:0, y:-19` and `_hlCompass` derives its inner radius as `R − 2.3·vmin` precisely to clear the radar disc by 0.2 vmin, so scaling one and pinning the other detaches the rose from the disc *and* moves its centre. Also unscaled by design: `_hudSharedTail`'s TRACKER lock rings (world-projected, hardcoded px) and every DOM HUD element (`#fps-counter`, `#kill-feed`, `#round-info`, `#champ-capture`, `.hit-marker`). **This is canvas-only.**
  - **⚠ The 4th arg is why this is NOT a `noScale` field on `_HL`.** `_HL` is hand-synced with `tools/hud_layout.json` and the studio's `exportJSON` emits only its own known keys — a field added here is silently dropped on the next export. For the same reason `tools/hud_studio.html`'s `place()` twin still previews at 1×, which is correct (it is the design surface) — don't "fix" it and bake the scale into `parts`.
  - **⚠ `_hudSharedTail`'s doomed pulse recomputes `vmin` itself** instead of taking it off an `_hlPlace` rect, so it multiplies by `_hlScale()` by hand. Miss that and the red doom band detaches from the health arc it decorates.
  - The settings listener writes `input.hudScale` on `input` (live preview) but only `saveSettings()` on `change`, and clears `_hlArcTextCache` on every change — without that, dragging mints a fresh set of curved-label sprites at every 0.05 step and only sheds them at the cache's 48-entry wholesale flush. `_refreshSettingsValues` must re-sync the slider: `buildSettingsPage` writes `innerHTML` once behind `_settingsBuilt`, so otherwise it shows a stale value on every reopen.
  - **Known cosmetic limit:** the painted cockpit frames are designed AROUND the 1× layout (`_forFrameDesign`, keep-clear 19.6 vmin), so at S ≠ 1 the first-person frame recesses stop lining up with the rings. Said plainly in the setting's help text. Verified live at 0.75 / 1.00 / 1.75 in endless: rings, ability captions, gauge labels, dash pips and reticle scale together; radar disc + compass rose unchanged in size and position at every step.
- **⚠ (v35.40) `_HL` is a COPY of `tools/hud_layout.json`'s `parts`** (repo root, not deployed)**.** The studio is where it's edited; change a number in one and the other silently disagrees (and the next studio export reverts your edit). Only render-affecting fields are carried over — an export also contains keys that are inert for the part's kind (`w`/`h` on anything with an `r`, `gapDeg` on `ticks`, `dir`/`alpha`/`tick` on kinds that ignore them).
- **(v35.53) Curved gauge captions** — `lab` / `labAt` (deg) / optional `labR` (vmin) on a layout entry, drawn by `_hlGaugeLabel` → `_hlArcLabel`. Six carry one: HEALTH, SHIELD, NRG, SPEED, AMMO, CORE. The three cooldown arcs are deliberately uncaptioned — they already have the ability NAME just outside them — and dash is pips, not a bar. Text rides ON the arc because there is nowhere else: the rings nest 0.57 vmin apart (health outer 10.52 → shield inner 11.09) and 0.70 (shield → energy), so nothing legible fits between them. Since a caption crosses both the lit fill and the empty track, each glyph is stroked near-black then filled light — no flat colour holds contrast over both.
- **(v35.54) Ability names are curved too**, at `_HL_AB_LABEL_R` (16.2 vmin — 1.1 clear of the cooldown ring's 15.1 outer edge, in from the 17.0–17.3 the boxes sat at). **Their angle is DERIVED from `(cd.a0 + cd.a1) / 2`, not stored.** A curved caption only reads as belonging to the bar beneath it if it is centred on that bar, and deriving the angle means the two can't drift — they already had, with `ab1` at 214° against a bar centred on 223 and `ab2` at 323 against 317. Invisible on a straight rotated box, obvious once the text follows the curve. The `ab1`/`ab2`/`ab3` entries keep their `x`/`y`/`rot` only so the studio still renders something sane.
- **⚠ (v35.54) `maxDeg` shrink-to-fit is load-bearing for ability names**, which come from the loadout and can be any length. `_HL_AB_LABEL_MAXDEG` (44°) keeps a long one inside its own 42° segment instead of spilling into the 5° gap and its neighbour. "VORTEX SHIELD" already uses 37.3°.
- **⚠ (v35.53) Captions are BAKED TO A SPRITE**, one `drawImage` each, cache keyed on text+radius+angle+colour+size. Per-glyph `save/rotate/fillText` every frame is the v34.89 wobble bug: re-rasterising at a fresh subpixel phase as the HUD shake nudges it makes the label shimmer. Don't "simplify" it back to direct drawing.
- **⚠ (v35.53) Do not reverse the glyph array when flipping.** Below the horizontal (canvas 0..180°) text is hung under the curve (`rotate(a-90)`, `translate(0,+r)`). Angle runs *leftward* along the bottom of a circle, so negating the per-glyph offset already makes it read left-to-right — reversing as well double-flips it and you ship `DEEPS` and `OMMA`.
- **(v35.88, amended v36.01: PURPLE ONLY) Nano Repair HUD overlay** — `_hlNanoOverlay` + `_hlNanoSpan` (defined right after `_hlArcBar`, called in `_hlDrawHUD`'s health draw): once `player.health > maxHealth` a PURPLE `#b264ff` arc fills over the lit ring, 0..full as the banked overheal runs 1×..`overhealMult`× hull; the v35.88 bright-green `#8dffb0` accrual band and its `_hlNanoSt` render-side accumulator were DELETED in v36.01 (owner: healing gets no separate highlight — the health arc refilling IS the healing visual); `_hlNanoSpan` walks `_hlArcBar`'s exact segment/gap/inset geometry between two GLOBAL fractions — keep the two derivations in step if the arcbar shape ever changes. **(v36.12)** sibling `_hlOverShieldOverlay` (defined right after `_hlNanoOverlay`, called in `_hlDrawHUD`'s shield draw) applies the same pattern to the SHIELD arc: white-cyan `#b8f6ff` (distinct from shield `#4fd1ff` and nano `#b264ff`), fraction = `overShield / (0.5*maxShield)` — render-layer only, no layout-file change, VR mirrors the canvas for free.
- **⚠ (v35.41) `rot` means two different things.** On a RADIAL part (one sized from `r`) the studio's `ctx.rotate` happens about the arc centre, so it is exactly an angle offset — `_hlArcBar`/`_hlSegArc`/`_hlTicks` fold it into `a0`/`a1` and skip the transform. On a BOX part (`pips`, `text`) the centre is the box's own, so it must be a real rotate — see `_hlPips`. Getting this backwards puts a part in the right place at the wrong angle, or vice versa.
- **(v35.41)** `_hlSegArc` added (`kind:'segarc'`): an arc chopped into blocks over a dim track, no capsule outline. The core meter uses it — 4 blocks at r 7.5, `rot:180` swinging `45..135` round to `225..315`, i.e. inside the health ring at the TOP (it used to be a single bar at the bottom). Dash pips moved to the lower-left at `rot:-30`. Bottom text row lifted 3.1 vmin — it was ending at 99.1/100 and clipping in third person.
- **⚠ (v35.40) `hudFont`'s cache does not survive `ctx.restore()`.** `restore` reverts `ctx.font` but cannot touch `_hudFontCache`, so the cache then claims a font the context lost and skips the next identical request as a no-op. Set the font *before* `save()`, and `_hudFontCache = ''` after any restore that crosses a font write — both are done in `_hlText`/`_hlCompass`/`_hlDrawHUD`.
- **⚠ (v35.40) `_hudSharedTail` is not optional decoration.** It decays `player.muzzleFlashTimer` / `gunRecoilL` / `gunRecoilR` — game state, mutated inside a draw that is throttled to ~30 Hz. A HUD path that returns without calling it leaves the muzzle flash lit. It also owns the world-projected TRACKER lock rings and the doomed pulse.
- **(v36.41) THE TRACKER LOCK RINGS NEEDED THEIR OWN VR PROJECTION** (owner: *"tracker's tracking locks have become off place"* — in a headset; correct on flat). **Jump:** the `_vrRing` block at the top of `_hudSharedTail`'s `TRACKER` branch · console `window.__lockRingProbe([degs], dist)`. **Root cause is the canvas→VR mapping, not the camera.** On flat the HUD canvas IS the viewport, so `project(camera)` → NDC → px lands the ring exactly on the target (measured `drawn === truth` to 0.1 px, even while spinning). In VR that same canvas is a TEXTURE on `_xrEnsureHudMesh`'s `PlaneGeometry(2.0, 1.125)` parked 2 m in front of `xrDolly` and scaled by `input.vrHudScale` — a quad subtending **far less** than the camera frustum. Reusing the flat NDC mapping equates two different angular scales and drags every ring toward the view centre: measured on the live VR code path at fov 120 / scale 1.5, **10° off-axis drew at 2.46° (7.5° error), 20° → 5.07° (14.9°), 30° → 8.00° (22.0°)**; only dead centre was right.
  - **Fix: stop projecting — intersect the eye→target ray with the quad**, then convert the hit point to canvas px. Exact for any plane size / distance / `vrHudScale`, and it expresses head-translation parallax the flat path structurally cannot (the quad is 2 m away, the target hundreds of units: leaning 20 cm swings the correct canvas point ~6°). Measured after the fix, same frame, same target: **0.000° error vs 13.08° for the old math.** Flat keeps the original two lines and is byte-identical.
  - **⚠ The dolly is IDENTITY during the update phase**, so this composes its view matrix from `camera.position`/`camera.quaternion` — precisely the pose `_xrSyncDollyBeforeRender` is about to lift onto `xrDolly`. Do NOT reach for `camera.matrixWorld`/`matrixWorldInverse` here: `_xrResetDollyAtFrameStart` zeroes them at the top of every XR frame and they are only *incidentally* fresh again by HUD time (some `getWorld*()` caller). Traced: the only `updateMatrixWorld` calls per XR frame are the two reset/sync pairs plus `scene.updateMatrixWorld` inside `render`.
  - **Eye = the midpoint of `renderer.xr.getCamera().cameras[].position`** (per-view poses are in REFERENCE space, which is dolly-local). One ring on one shared quad can never be right for both eyes — the quad is at 2 m, the target at infinity — so the cyclopean midpoint is the honest compromise; residual vergence ≈ IPD/2 m.
  - **⚠ This is NOT a regression from v35.79 / v36.01 / v36.37 / v36.39.** Those are minimap and DOM-band changes and none of them touches the ring math; the mis-mapping is structural and predates all of them (v35.64's `vrHudScale` 1.5 actually *reduced* it — at scale 1 the quad is narrower still). The likely reason it started getting noticed is **v35.97**, which added monsters as lock-ring targets.
  - **`window.__lockRingProbe()`** is the headset-less check — it replays BOTH mappings for targets N degrees off the nose and reports where each ring lands **in degrees**, so a regression shows up from a flat screen. That absence is how this survived: the flat path is provably exact, so nothing on screen ever looked wrong.
- **(v35.40)** DOM parts moved into their layout slots in CSS: `#minimap` bottom-centre and round; `#kill-feed` `8vmin/4vmin`; `#fps-counter` `4vmin/4vmin`; `#round-info` pushed to `4.6vmin` to clear the compass strip the layout puts at top centre.
- **(v35.57) The radar draws in VR too, and the standalone `xrMinimapMesh` plane is hidden** (`window.__xrSeparateRadar = 1` restores it). v35.45 skipped `_hlRadar` while presenting so that plane could own the radar — but `_hlCompass` was never gated, so VR got the compass rose ringing an empty hole while the real disc sat on a plane off to the left. The HUD mesh mirrors `#circumpunct-hud`, so drawing it there gives VR the same merged instrument as flat screen. **⚠ Un-gating `_hlRadar` without hiding the plane shows the radar twice.**
- **(v35.57) `shipPrev` / `shipNext` are real bindings** (`gpBindings` 14/15 = the D-pad it used to read raw; `xrBindings` unbound by default; keyboard already had `[`/`]`). They had to become actions because **XR bindings resolve `action -> gpBindings[action] -> standard button`** — with no action there was nothing for VR to bind to. All three mapping UIs (`#bind-rows`, `#xr-bind-rows`, `#kb-bind-rows`) pick them up from `ACTION_LABELS`.
- **⚠ (v35.57) `xrSynth.leftStickAsDpad` no longer fires during `game.state === 'playing'`.** The left stick is the STRAFE axis and the synth pressed D-pad 14/15 from it, which the hub ship-cycle read — so sidestepping in the hub swapped your ship in VR. That is the v32.99 bug (see the `gpDpadLeftBtn` comment) re-entering through the XR synth rather than the stick fallback. The synth exists for MENU navigation and menus are never `playing`.
- **(v35.45) The radar is drawn INTO the HUD canvas** by `_hlRadar` (blits the offscreen `#minimap` bitmap, circular-clipped, with the fill and rim that used to be CSS `background`/`border`). `#minimap` is now `display:none` — a pure render target for `updateMinimap` and the VR radar plane; its backing store and 2D context are unaffected by that. This is what makes the radar *move*: the shake counter-shift lives in this canvas's transform and the 3D perspective tilt rides a `matrix3d` on this canvas's ELEMENT, and a free-standing `position:fixed` element inherits neither — so the disc sat dead flat while the compass rose drawn around it banked, visibly splitting one instrument in two. **⚠ Two gates in `_hlRadar` are load-bearing:** skip while `isXRPresenting()` (VR mirrors this whole canvas onto a HUD mesh *and* carries its own `#minimap`-textured plane — blitting would show the radar twice), and skip while `#ship-select.active` (which is what the old `body:has(...)` CSS rule did). The cinematic needs no gate — it hides `#circumpunct-hud` outright. Position/size come from `minimap` in `_HL`, not CSS.
- **(v35.44) The compass is part of the radar**, not a separate strip: `compass` is placed CONCENTRIC with `minimap` (both `bc`, y `-19`) and `_hlCompass` draws a rose on the disc's rim — graduations every 15°, cardinals at outer radius 13.5 against the disc's 11, plus a cyan heading marker. ~~⚠ The cardinals are FIXED and the marker moves~~ **(SUPERSEDED by v35.79 — the rose rotates and the marker is fixed now).** The map-name label is gone from the radar (`game.mapWord` is still maintained — that was its only reader), and `#round-info` went back to `top:10px` once the compass vacated top centre.
- **(v35.79) SHIP-UP radar — deliberate INVERSION of the v35.44 design.** `updateMinimap` now rotates every plotted world offset about the disc centre by the player's heading (`_proj`: yaw from `_mm.forward` via `atan2(fwd.x, -fwd.z)`, the exact `_hlCompass` convention; rotation done in per-point MATH, never the context transform — the one-time `_MM_SS` setTransform stays untouched), so the ship's nose is permanently screen-up and a contact dead ahead plots straight up. The player marker is a FIXED white triangle pointing up (at the disc centre in campaign mode; ~~at the rotated world position elsewhere — non-campaign is still world-origin-centred~~ **superseded v36.01: every mode is player-centred, triangle always at disc centre**); **(v35.81)** ENDLESS is also player-centred at a FIXED range (~2600u world radius -> the 68-radius clamp disc, `window.__mmRange` overrides) — the pruned route window travels tens of km from origin, so the geometry auto-fit extent drifted and the ship slid off disc centre; the old rect + forward line are gone. ALL layers go through `_proj`/`_plot` now — including network players and stasis fields, which used to be raw-plotted (unrotated, no edge clamp, could draw outside the r-75 circle). Off-radar contacts keep the v35.42-era outward-pointing edge arrows (`_mmArrow`, 6-unit triangle clamped at radius 68 — these already existed in code; the old "clamped dots" description was stale). `_hlCompass` inverted to match: graduations + cardinal LETTER POSITIONS rotate by `-hdg` (glyphs drawn unrotated so they stay upright — the letter under the top of the disc is your heading), and the cyan heading marker became a FIXED lubber mark at the top (`ha = -Math.PI/2`).
- **(v35.42)** Radar radius `6 -> 11` vmin (`#minimap` `22vmin`, `bottom:5.5vmin`) — it had to move UP to grow, since its rim was already only 2 vmin off the bottom. The HULL and weapon-name readouts are **deleted** (so there is no numeric hull figure anywhere now — the health arc and the doomed warning are the only hull feedback), and `aegis` re-anchored `mc -> bc` to sit under the radar. **Keep `#minimap`'s CSS agreeing with `minimap` in `_HL`** — the disc is a DOM canvas, so the layout entry is only a record of where it sits.

#### DOM HUD updater — `~L48527`
**Jump:** `function updateHUD` (~L48559)
- **Symbols:** `_hudEls`, `_hudText`/`_hudWidth`/`_hudDisplay`/`_hudTop` (v36.15), `updateHUD`
- **⚠** Dirty-checks vs `_hudLast` before touching DOM — don't bypass.
- **(v36.15) CHAMPION CAPTURE BAR** (owner: "when you capture a champion stasis field, there needs to be an indicator bar that everyone can see equally on their HUD, maybe right under the timer") — **Jump:** the `CHAMPION CAPTURE BAR` block at the end of `updateHUD` (after the team-palette write, before `updateAbilityHUD()`) · markup `<div id="champ-capture">` (sibling of `#round-info`) · CSS `#champ-capture` (right after `.team-b`) · helper `function _hudTop`. A slim tinted strip + `CHAMPION · FLEET A/B` caption hanging 8px under the round-timer block. **NOT mode-gated by design** — the only condition is "a live `game.championField` carrying charge", so classic / elimination / race / assault all get it and the modes that never spawn one (campaign, freeflight, endless since v36.11) simply never see it (verified: forcing a charged `game.championField` in ENDLESS *does* render the bar, at the fallback top, clear of `#endless-hud`).
- **(v36.15) "Everyone sees it equally" needs NO netcode** — and adding some would be wrong. Every peer holds the SAME champion field (`spawnChampionField` on the stasis owner; receivers mirror it from the `stasis_spawn` event's `champion:true` branch into the same `game.championField` slot, ~L11229), and every peer runs the same `updateStasisFields` accumulator over the same replicated cast: the local ship plus **`game.entities`**, which holds bots (streamed by `bot_roster`/`bot_state`) **and every remote human as a `NetworkPlayer`** (`updateNetworkPlayer` pushes `np` into `game.entities`, position fed by `broadcastPlayerState`). So `field.teamProgress` is each client's own copy of a value derived from shared inputs; the bar renders that copy. The receiver comment at the `stasis_spawn` champion branch states the contract outright: *"charge resolution is local on each peer, but the owner's locked-in result is authoritative via the round-end broadcast."* Colours/labels are therefore **ABSOLUTE fleet identity** (`0xff4444` / `0x44bb44`, the ship-tint pair) — deliberately NOT the player-relative friend/enemy palette the score line above it uses, because a player-relative bar is by definition not the same bar on two screens.
- **(v36.15)** Value comes from **`teamProgress`, not the `chargeTimer` mirror** — `chargeTimer` goes stale the instant a claim is released, and the live decay of preserved progress (assault drains the unclaimed attacker at 0.5/s; classic preserves a shoved-off team's) is exactly what the bar should show. Team selection: whoever is **on the dot right now** (`field.chargingTeam`) owns the bar; vacated, it falls back to the fleet with the most preserved progress. Denominator is the same `_isAssault() ? ASSAULT_CHARGE_TIME : CHAMPION_CHARGE_TIME` the win resolves on, so 100% lands on the capture frame. ⚠ **Classic/race `CHAMPION_CHARGE_TIME` is 0.5s** — the bar is a half-second flash there; **assault's 6s hold is the mode it actually reads in**.
- **⚠ (v36.15) It is a SIBLING of `#round-info`, not a child — and must stay one.** `#round-info` is `position:fixed; z-index:10`, i.e. its own stacking context, so a nested bar can never rise above **`#ov-banner` (z 65)**, which fires on the exact events the bar narrates (`CLAIMING` / `FIELD BREACH` / `CLAIM BROKEN` / `CHAMPION FREED`) and is centred at `top:18%` — right on top of it on short viewports. As a sibling it carries **z-index 66** and always wins. Cost of leaving the parent: it lost `#round-info`'s cinematic hide, so `#champ-capture` is now listed explicitly in `_lssEnsureCinematicStyles`' selector list — **add it to any new HUD-hiding rule that lists `#round-info`.**
- **⚠ (v36.15) `top` is measured, not a CSS constant.** `updateHUD` pins it to `#round-info`'s `getBoundingClientRect().bottom + 8`, but **only** on the hidden→shown transition and after a viewport change (keyed on `innerWidth*100000+innerHeight`) — a rect read every frame is a per-frame `DOMRect` allocation. A constant is wrong because `#score-display` (`gap:180px`) **wraps to two lines** on narrow viewports and the block grows ~19px (measured: 92px tall at 964 wide → 111px at 860, bar `top` auto-tracked 110px → 129px). Fallback when `#round-info` is hidden/zero-height is `112px`. Width is quantised to **0.5% steps** and a `transition: width 0.12s linear` smooths them — the quantisation is what keeps a 6s assault hold from writing every frame.
- **(v36.37) TOP-CENTRE BAND STACKER — the fix for "'warning enemy locked' appears over top of other text".** **Jump:** `function _hudPinTopBand` (right under `_hudClass`/`let _hudForceLock`) · called from `updateHUD` immediately after the lock-warning display write · console `window.__hudBandProbe()`. **Root cause: four tenants of one strip, four different anchor units.** `#round-info` px, `#endless-hud` px (`top:44px`), `#stasis-warning` **vmin** (`8vmin`, and `translate(-50%,-50%)` so that was its CENTRE), `#enemy-lockon-warning` **PERCENT** (`top:12%`). A percentage and a fixed-px block only clear each other at one viewport; everywhere else they intersect. Measured with `__hudBandProbe` before the fix — **1200×675: round-info 10–102, stasis-warning 46–62 (across the ROUND n label), lock warning 81–109 (across the FLEET A / FLEET B score line)**, i.e. the owner's screenshot reproduced exactly; **844×390: stasis 23–40, straight through the timer digits.** The 12% was never a slot, it was a coincidence at one aspect ratio.
  - **(v39.16) A fifth tenant, positioned elsewhere: `#tc-core`.** The touch CORE button sits on the same centre line and hit the same wall (vmin vs the clock's fixed px). It is pinned off the same measured bottoms, but from `_layoutSticks` in the touch IIFE rather than from here — `_hudPinTopBand` early-returns unless a warning is up, and the overlay has its own reveal/drift re-layout hooks. If you change what lives in this band, change **both**.
  - **Fix: measure the band, hand out slots downward.** `_hudPinTopBand` takes `max(bottom)` of `#round-info` / `#champ-capture` / `#endless-hud` (floor 96) + 8, gives that to `#stasis-warning`, then +22 to `#enemy-lockon-warning`. Both CSS `top`s are now pre-measure defaults only (`116px`), and `#stasis-warning` dropped to `translateX(-50%)` so `top` means the top edge like every other tenant.
  - **Same measure-on-change contract as `#champ-capture`** (v36.15, above): the signature is `innerW×innerH` + which tenants are up, built from **inline `style.display` and element existence only** — plain property reads that force no layout. `getBoundingClientRect` runs only when that signature changes. ⚠ `#endless-hud` must be fetched with `document.getElementById`, not `_hudEl`, because `_hudEl` memoizes a MISS as `null` forever and that element is created lazily by the endless mode.
  - **⚠ The keep-clear ceiling is a PREFERENCE, not a clamp — and that is deliberate.** At **844×390** `#round-info`'s score line wraps and the block grows to 111px tall while the 19.6 vmin keep-clear ring's top edge is only ~119px down: there is genuinely no gap. A hard clamp "resolves" that by pushing the status lines back UP onto the score text — straight back into the bug. So when the cap can't be met it is dropped (`cap = Infinity`) and the lines sit below the block, crossing the top of a thin arc instead. **Text over graphics beats text over text.**
  - **`#enemy-lockon-warning` pips went INLINE** with the text (`display:flex` + `gap`, and `updateHUD` writes `'flex'` not `'block'`). That halves the block, 31px → 16px, which is what lets a full stack fit under a wrapped round block on a landscape phone.
  - **`window.__hudBandProbe(opt)`** is the outside view — everything else is inside `_bootLSS`, and three of the five tenants only appear under conditions that are awkward to reproduce, which is how this survived. `{lock:0..3}` forces the TRACKER warning (via `let _hudForceLock`, read in place of the literal `0` that seeded `maxEnemyLocks`), `{stasis:0|1}` forces the stasis line; it returns every tenant's rect **and the list of intersecting pairs**, so the result is measured, not eyeballed.
  - **Verified (forced, both lines up, in a live elimination match):** 1920×1080 round-info 10–102 / stasis 110–127 / lock 132–148; 1280×720 identical; 844×390 (landscape phone, score line wrapped) 10–121 / 129–146 / 151–167 — **`overlaps: []` at all three**, all four rows legible in the screenshots. Re-applying the old `top:12%` via an injected stylesheet reproduces `["round-info x enemy-lockon-warning"]` on demand.
- **(v36.15) Verified live** (both modes, real captures, 974×684 and 1280×1000): **CLASSIC** — player claim ramps hidden→9.5→25→43→50→55.5→61%, step out of the radius freezes it (`_releaseChampionClaim` preserveProgress) and it holds 21.5s with **0 further DOM writes** (24 width writes / 2 display writes / 2 top writes across 3124 frames). **ASSAULT** — local player is the round-1 **DEFENDER parked 337u outside the field** while a FLEET-B bot holds the dot: the bar renders **54% `cc-b` "CHAMPION · FLEET B"** purely from the non-local ship's charge (that bot occupies the same `game.entities` slot a remote human does). Round 2 (player = attacker) 40% `cc-a`; seeding FLEET B a *larger* frozen 5.4 while FLEET A is on the dot keeps the bar on A (active-charger rule), vacating flips it to B at 90% (leader rule), draining both hides it. Geometry at 1280×1000: round-info 10-102, bar 110-130.2, `#ov-banner` 141.2-218.8, kill feed 80-98.4 at x 1126+, `#stasis-warning` (forced visible) 46.3-63.1 — **zero box intersections**; on the short dev pane the banner does intersect and the bar draws over it (z 66 > 65). 144 fps, zero console errors.

#### Minimap / radar + kill feed — `~L48677`
**Jump:** `function updateMinimap` (~L48702)
- **⚠ (v35.42) The radar draws in a 150-unit space on a SUPERSAMPLED backing.** `_MM_SS` (2) scales `canvas.width/height`, and a matching `ctx.setTransform` is installed **once** at lazy-init so all ~250 lines below keep working in 150 units. **A second write to `canvas.width` anywhere would silently drop that transform and halve everything** — the one-time sizing is load-bearing, not just a perf nicety.
- **⚠ (v35.42) The radar is ROUND** (CSS `border-radius` on `#minimap`; the layout calls it a `ring`). Anything drawn outside the r-75 inscribed circle is invisible on screen. Two things were: `_plot` clamped off-radar contacts to a **square** (`max(|dx|,|dy|)`), putting diagonal contacts at `hypot(68,68) = 96` — outside the clip, i.e. a boss on a NE bearing silently vanished, the exact failure that clamp exists to prevent; now clamps radially. And the map-word label at `y=145` had its ends at radius 76 and got shaved; now `y=136`. The square `strokeRect` rim is an `arc` — the square only ever showed as four tangent nicks, and VR textures this canvas raw with no CSS clip. **Anything new drawn near the edge must respect the circle.**
- **(v36.01) ALL modes strictly player-centred at a FIXED range** — the v35.81 pattern promoted to every mode (the v35.79 ship-up rotation happens about the disc centre in `_proj`, so the world-origin auto-fit that classic/elimination/race/assault still used was geometrically wrong — owner spotted the off-centre ship in ELIMINATION): `ccx/ccz` = player position always; range (world units at the 68 clamp ring) = endless 2600 / campaign `CAMP_RADAR_HALF_SPAN * 68/75` (on-screen unchanged) / arena modes 3400 (far contacts become v35.79 edge arrows, nothing lost); `window.__mmRange` overrides ALL modes; the auto-fit/extent-grow path (`_mm.extent`/`extentKey`) is deleted and `invalidateMinimapExtent` is a kept NO-OP for its map-swap callers; verified live: white-triangle centroid ≤1.01 units from (75,75) at 3 positions × 2 headings in elimination + 3 in endless.
- **(v36.38) PORTAL LAYER ON THE RADAR** (owner: "exhibition mode needs to put the portals on the minimap/radar and on the edge of the minimap if they are far"). **Jump:** the `PORTAL LAYER` block in `updateMinimap` (immediately BEFORE the player triangle) · debug `window.__mmProbe(worldX, worldZ)` / `window.__mmPortalProbe()`. **The full portal inventory, all three now plotted:** (1) `_HZ_CAVERN.portals[]` — the **6 zone-rift rings** ringing the hub at `_HZ_CAVERN.DIST` 21500u, one per `_HUB_ZONES.sectors` entry (`volcanic/goldmine/crystalcave/snow/rocky/brokensim`), built lazily by `_hzPortalsFrame` in EXHIBITION (`LSS.MODE === 'freeflight'`) on mossy hub terrain, solo only, disposed on cavern entry; (2) `game._cavern.ring` — the **rift-home** BossPortal that opens at the cleared cavern's centre room ("take the rift home"), never plotted before and the one gate you are actively hunting; (3) `game.bossPortal` — the campaign / leg / hub-rift gate, which was already plotted and **MOVED** into this layer. **Two deliberate rules.** ⚠ **Layer order:** the whole block draws BEFORE the player triangle and every contact layer (bots, network players, monsters, stasis, pole rings), so a portal can never hide an enemy — that is why the bossPortal block moved UP rather than gaining company where it was. ⚠ **A portal must never read as a threat:** on-disc = a stroked **double ring** (outer r5 + inner r2) — not the enemy's filled square, not the bolt/stasis filled diamond; off-disc = `_mmPortalArrow`, an **outline chevron with a tail dot** at the same `_MM_R` = 68 clamp the hostile arrows use, so bearing reads identically while the silhouette can never be confused with `_mmArrow`'s solid triangle. Colour is per portal TYPE: **violet** `rgba(178,120,255,pulse)` = a rift INTO the deep, **cyan** `rgba(108,224,255,pulse)` = a gate OUT / onward (the campaign gate keeps its established colour exactly). A rift whose sector is on `coolBySector` cooldown is SKIPPED — its ring is hidden in-world, so the radar must not advertise a gate you cannot take. Everything goes through `_plot`, so portals ship-up-rotate and circle-clamp like every other layer; the pulse + the two colour strings are hoisted out of the loop and the whole block is behind a cheap "is there any portal at all" guard, so modes without portals do zero extra work. **Verified live** (Exhibition, build 36.38): all 6 rifts plotted, each off-disc arrow at radius 67.95-68.04 from centre; **rotation** — heading +90° rotated every one of the 6 markers by exactly −90.00° on screen with the radius held; `__mmRange` 42000 put all 6 on-disc as violet double rings with a red enemy square drawn **over** one of them (layering proof); forcing `coolBySector[2]=60` dropped that rift to **0 violet pixels** while the other five kept ~110 each; in-cavern rift-home ring drew as a cyan double ring at 587u and as a cyan edge chevron at 5822u; a `game.bossPortal` smoke test drew its own cyan ring alongside it; ENDLESS on the same build drew **0 violet pixels** (mode gate) with the cyan bolt diamonds, white player triangle, red contacts and the compass all unchanged; 144 fps, zero console errors. **Note (pre-existing, NOT introduced here):** leaving Exhibition for another mode can leave the 6 zone-rift `BossPortal` meshes parented in the scene (`_hzPortalsFrame` appears to rebuild them after `FreeFlightMode.onTeardown`'s `_hzPortalsDispose()`); harmless to this layer because the draw is mode-gated, but it is a real scene-resource leak.
- **Symbols:** `_mm`, `invalidateMinimapExtent`, `updateMinimap`, `addKillFeed`, `__mmProbe` (v36.38), `__mmPortalProbe` (v36.38)

#### Ability HUD (pie + slots) — `~L48983`
**Jump:** `function buildAbilityPie` (~L49047)
- **Symbols:** `buildAbilityHUD`, `buildAbilityPie`, `_abSlot`/`_abCore`, `updateAbilityHUD`
- **⚠** `_abInvalidate()` after loadout swaps.

#### Ship-select / loadout / perk / difficulty UI — `~L49314`
**Jump:** `function buildShipSelect` (~L49316)
- **Symbols:** `buildShipSelect`, `previewLoadout`, `_renderPerkPicker`, `_renderDifficultyPicker`, `_renderSkinPicker`, `selectLoadout`, `updateTeammatesStrip`, `_ssDiffFlag` (v36.39), `_setSkinPanelOpen` / `_wireSkinToggle` / `_skinToggleWired` (v36.39)
- **(v35.10) Redesign:** left ship LIST is gone → horizontal `#ship-carousel` chip rail (`.ship-chip`, ‹ › wrap-cycle arrows) under the hero stage; big `#ship-hero` nameplate under the rotating GLB; stat rows are segmented bars normalized to the roster max; perk grid = 3-col `#perks-grid`; no empty state (auto-previews prior/first loadout). Gamepad D-pad + XR confirm paths now query `.ship-chip`.
- **(v35.12)** Gamepad axes match the horizontal rail: D-pad/stick LEFT/RIGHT cycles ships, UP/DOWN cycles the map (was swapped). Carousel arrows hug the chip row (`justify-content:center`, track `flex:0 1 auto`).
- **(v35.20) Two-column layout.** New wrapper **`#ss-right-col`** (`right:18px; top:108px; bottom:14px; width:300px`, `justify-content:flex-end`) holds `#ship-preview-info` **stacked above** `#map-select`; both became flex ITEMS (`position:static`, `width:auto !important`, `flex:0 1 auto`, `min-height:0`) so the column owns position and width. `#teammates-strip` moved to a **left column** (`left:18px; top:108px; width:210px`, content-height capped by `max-height:calc(100vh - 122px)`): fully vertical — your fleet over enemy fleet, `.fleet-chips` flipped to `flex-direction:column; flex-wrap:nowrap; align-items:stretch` so it's ONE card per row filling the column, with a single scroll context on the column itself (halves are `flex:0 0 auto`, chips `overflow:visible`). Layout is now: fleets left · rails bottom-center · details-over-map right.
- **(v35.20) `#ss-rails` spans, it no longer centers.** Dropped `left:50% / translateX(-50%) / max-width` for explicit `left:240px; right:330px` (each side column + a 12px gutter). The columns are asymmetric (fleet ends at 228, right column starts at 100vw−318), so a 50% centre sat 45px right of the free space's true centre — dead room on the left, 7th ship chip pushed into overflow scroll on the right. Every responsive block now overrides `left`/`right` instead of `max-width`: ≤1200 `18/280`, ≤620h `18/255`, ≤900 `12/12` (right column is top-anchored there, so the bottom edge is free).
- **⚠ (v35.20)** The `max-height:560px, max-width:760px` block is LAST in the cascade — deliberately sets no `#ss-rails` left/right, because it would clobber the ≤900px full-width rails on narrow viewports. Leave it that way.
- **(v35.20) LANDSCAPE PHONE breakpoint** `@media (max-height:500px) and (orientation:landscape)` — must stay **LAST** in the cascade. The `max-width:900px` rules were written for tall-narrow and collapse on short-wide: `top:150/bottom:210` left the right column **30px** tall, crushing `#map-window-preview` to 8px and spilling `#map-window` over the rails. This block restores the desktop *shape* (a column down each edge, rails in the gap) because at 390px tall there's no vertical room to stack but there is horizontal room to sit side by side — and brings the fleets back on screen. Verified 844×390 and 740×360: no overlaps, everything inside the viewport, preview 92px.
- **⚠ (v35.20)** `#map-window-preview` needs **`flex: 0 0 92px`**, not just `height` — flex shrink from `#map-select`/`#map-window` beats a bare height and collapses the thumbnail to ~54px.
- **(v35.20)** All 7 ship chips fit without scrolling at **≥~1406px** wide (track needs ~746px + ~90px carousel chrome, against a span of `100vw − 570`). Below that the carousel scrolls — *except* under 1200px, where the fleet column hides and the rails reclaim its 240px, so 7 fit again. Net effect is non-monotonic: fits at 1150, scrolls at 1240, fits at 1420. Raising the fleet-hide breakpoint from 1200 to ~1405 would make it monotonic at the cost of the fleet column on 1366-wide laptops.
- **⚠ (v35.20)** The card width lives in the v35.17 rule `#teammates-strip .fleet-chip` (now `width:auto`, was `118px`). Same specificity as any new `#teammates-strip .fleet-chip` you might add earlier in the sheet, so **source order decides** — set it there rather than adding a competing rule above it.
- **⚠ (v35.20)** `top:108px` not 92 on both columns — the header's RIGHT dock (`#ss-header-right`: MAIN MENU/SETTINGS + CONFIRM & LAUNCH stacked) reaches ~94px, where the old left-only panel only had the title block to clear. `#ss-right-col` is `pointer-events:none` with `> * { pointer-events:auto }` so the spacer can't eat clicks on the rotating-ship stage behind it. At `max-width:900px` the column needs BOTH `top` and `bottom` set (`bottom:210px`) — stacking two panels makes it far taller than the old side-by-side pair, and without a definite height it runs into the rails. `#ss-rails` cap at `max-height:620px` went `100vw-470` → `100vw-510` (right column is 225 wide there, vs the old lone map box's 205).
- **(v36.30) ADD BOTS MOVED TO THE FOOT OF THE FLEET COLUMN, and the rails grew a THIRD rail** (owner: *"move the ADD BOTS button … to the BOTTOM of the LEFT vertical fleet stack"* + *"add a SKIN THEME selector slot beside the difficulty picker, above the pilot perks"*). **Jump:** `#ss-bots-dock` (markup, last child of `#teammates-strip`) · `#fleet-scroll` (new wrapper around the two fleet halves) · `#ss-options-row` (new wrapper around `#ship-preview-difficulty` + `#ship-preview-skin`) · `#skin-grid`.
  - **`#btn-ss-bots` is out of `#ss-header-right`.** Same id, same inline `onclick="_toggleEliminationBots()"`, same owner `_renderEliminationBotsBtn`, same ☑/☐ + `.ss-bots-on` + mode gate (`campaign`/`freeflight`/`endless` hidden). Only the CSS skin changed: fleet-card vocabulary (`rgba(20,20,40,0.6)` face, `rgba(80,80,120,0.35)` hairline, radius 3, full width, no backdrop blur of its own, no hover lift) instead of the header-CTA look.
  - **⚠ THE COLUMN NO LONGER SCROLLS — `#fleet-scroll` does.** `#teammates-strip` was the scroll box, so a footer inside it would scroll away on a full room. The two halves + their divider moved into `#fleet-scroll` (`flex:1 1 auto; min-height:0; overflow-y:auto`), the strip became `overflow:hidden`, and `#ss-bots-dock` is `flex:0 0 auto` — a real pinned footer. **`min-height:0` is the load-bearing half**; without it the flex item refuses to shrink under its content and the column blows past `max-height` instead of scrolling. Every pre-existing `#teammates-strip .fleet-*` rule is a DESCENDANT selector, so the wrapper is invisible to them. **Verified with 18 cloned chips at 1920×1080:** `#fleet-scroll` scrollHeight 2551 / clientHeight 881, strip scrollHeight == clientHeight, button rect identical before and after `scrollTop = 99999`, `elementFromPoint` still returns `#btn-ss-bots`.
  - **⚠ THE FLEET COLUMN IS HIDDEN BELOW 1200px — so those breakpoints now COLLAPSE it instead of hiding it.** ADD BOTS used to live in the header and was reachable at every width; tying it to `#teammates-strip` would have made it unreachable under 1200px wide (and on short viewports). `≤1200`, `≤620h` and `≤900` now hide `#fleet-scroll` + the dock divider and shrink-wrap the strip into a **bots-only box** in the same top-left slot (`top:108`, or `74` under the compacted header). The `≤620h` block **restates the whole collapse** rather than relying on `≤1200` — a 1600×600 window matches one and not the other. `#teammates-strip.ss-no-bots-btn` (toggled by `_renderEliminationBotsBtn` alongside the dock) drops even that box in the modes with no toggle, so no empty shell is ever painted.
  - **⚠ THE LANDSCAPE-PHONE BLOCK MUST UNDO THE COLLAPSE ITEM BY ITEM.** It is last in the cascade and deliberately brings the FULL fleet column back, so it re-shows `#fleet-scroll`, the dock divider, and — critically — matches `#teammates-strip.ss-no-bots-btn` too: in campaign/freeflight/endless the fleets still belong on screen there, it is only ADD BOTS that does not.
  - **(SUPERSEDED v36.39 — the row is deleted; difficulty docked under the CTA and skin became the nameplate chip.)** **`#ss-options-row` is a bare layout row, not a panel.** It matches the shared `#ss-rails > div` box skin, so it explicitly resets background/border/blur/shadow and the skin rule was widened to `#ss-rails > div, #ss-options-row > div` — otherwise difficulty and skin lose their boxes the moment they are nested one level deeper. `flex-wrap` + `justify-content:center` means a hidden difficulty leaves the skin box centred in the rail rather than stranded left, and a narrow rail stacks the pair instead of overflowing.
  - **⚠ (SUPERSEDED v36.39 — `#ss-options-row` no longer exists; see the v36.39 entry below.)** **⚠ SKIN HAS NO MODE GATE — do not copy difficulty's.** `#ship-preview-difficulty` is campaign+endless only (`_renderDifficultyPicker` returns early otherwise); `#ship-preview-skin` ships with no inline `display:none` and no render function, so it is `flex` in all six modes. **Verified:** classic/race/assault/freeflight/endless/campaign all show it; difficulty only in endless+campaign; the dock only in classic/race/assault.
  - **(SUPERSEDED v36.39 — re-derived to 196 once the third rail was removed.)** **⚠ THE `max-width:900` RESERVATION WENT 210 → 262.** That block gives `#ss-right-col` a definite height by reserving the rails dock's height at the bottom; the new row adds ~53px + an 8px gap, and at 880×700 the old 210 put the right column's bottom edge **70px inside the rails**. The row is also compacted there (`#skin-desc`/`#diff-desc` hidden, `#skin-grid` min-height 28) so the reservation did not have to grow further. After: 13px of clearance. **Any future rail added to `#ss-rails` has to move this number again.**
  - `#skin-grid` carries `min-height:34px` (26 at `≤620h`, 28 at `≤900`) purely to reserve the `.perk-card` row height, so the empty phase-1 slot has the geometry phase 2 will fill and nothing jumps when the cards land. Phase 2 should reuse `.perk-card` — `#diff-grid`/`#perks-grid` already do, and no new card CSS is needed.
- **(v36.31) `_renderSkinPicker` fills that slot.** **Jump:** `function _renderSkinPicker` (right above `selectLoadout`) · `.skin-card` / `.skin-sw` CSS. Called from `previewLoadout` beside `_renderPerkPicker`/`_renderDifficultyPicker`. One card per `SHIP_SKINS` entry, `class="perk-card skin-card"` so background / border / radius / `:hover` / `.selected` are all inherited from the perk+difficulty vocabulary. The system itself is documented in PART 11 (*SHIP SKINS*).
  - **⚠ `.skin-card` ONLY narrows the box, and it has to be RESTATED inside `@media (max-height:620px)`.** Seven cards at the shared `min-width:96px` would be 720px and the rail also carries the three difficulty cards, so `.skin-card` is `min-width:0 !important; width:34px` (28 at ≤620h) with the name in `title` + `#skin-desc` and the swatch carrying the information. That media block sets `.perk-card { min-width:72px !important }` and sits LATER in the sheet at EQUAL specificity — without the restatement it wins and the rail blows out.
  - **Click is cheap on purpose:** store the id → repaint the 7 cards → `setShipPreviewSkin(id)`. No mesh rebuild, so the rotating hero neither re-dollies nor loses the yaw the player dragged it to. `_renderSkinPicker` also re-asserts the skin on the hero at the end, so a re-render for any other reason (ship change, re-entering ship select) can't leave the preview out of sync with the store.
  - `window.__skinProbe()` is the outside view (everything else lives inside `_bootLSS`): `{set}` picks a skin as a click would, `{ship}` previews a hull, `{peer}` builds a REAL `NetworkPlayer` through `updateNetworkPlayer` — the remote-player path minus the wire — reports its hull params and tears it back down. `window.__skinTune(id, patch)` (v36.32) hot-patches the table for live tuning.
  - **MEASURED, four viewports, zero overlaps / zero out-of-viewport / zero page scroll in every one:** 1920×1080 (strip 108→911.6, button 866.4→898.8, skin row 793→881 above perks 889→990), 1366×768 (fleet scroller overflowing 727/566, button pinned 705.6→738), 844×390 landscape phone (column 56→379.2, button 344.8→370.4, scroller 267 tall), 880×700 and 1600×600 and 760×900 for the collapse paths. Trusted clicks at both 1920 and 1366 flip `game.eliminationBots` in both directions with the ☑/☐ prefix, `.ss-bots-on`, the tint and the tooltip all following. **Zero console errors.**
  - **(v36.35) RE-VERIFIED ADVERSARIALLY, and the move turns out to have FIXED two overlaps.** A/B against the v36.29 backup served side by side at **844×390**: the baseline reported **four** overlapping pairs — `ss-right-col × ship-preview-confirm`, `ship-preview-info × ship-preview-confirm`, **and `ss-right-col × btn-ss-bots` + `ship-preview-info × btn-ss-bots` (131×28 each)**, because the header-docked button sat on top of the right column. v36.35 reports only the **two `ship-preview-confirm` pairs, which are therefore PRE-EXISTING** (the CONFIRM CTA at y40–72 overlaps the right column's top edge at y56 by 16px — a v35.20-era bug, unrelated to this work). Overlap probing must skip ancestor/descendant pairs or `#ss-rails × #ship-carousel` reports a false positive — the carousel is a CHILD of the rails.
  - **⚠ (v36.35) PRE-EXISTING, NOT FROM THIS WORK: `LSS.MODE` is not reset when you leave the ENDLESS ship-select via MAIN MENU.** Repro: `startEndless()` → click `#lobby-back-btn` → enter ELIMINATION. Result: SWARM DIFFICULTY is still displayed and `_renderEliminationBotsBtn` still takes its `show === false` early return, so **ADD BOTS never appears in the next match** (and with it the collapsed fleet box under 1200px). **Confirmed identical on the v36.29 backup**, so it predates both the button move and the skin work. The mode-reset that exists at `LSS.MODE = 'classic'` (~L8320 / ~L7473) is evidently not on the ship-select → lobby-back path. Not fixed here — it is a mode-transition bug in a different subsystem and out of this pass's scope.
  - **Pre-existing, NOT from this pass:** `#map-window-preview` collapses to ~1.6px at `max-width:900` (it lacks the `flex:0 0 92px` the landscape block gives it — the v35.20 trap noted above). Measured identical at 880×700 with the right column at both 337px and 285px tall, so it is independent of the reservation change.
- **(v36.39) THE OPTIONS ROW IS GONE — difficulty went UNDER THE CTA, skin became a COLLAPSED CHIP ON THE NAMEPLATE** (owner: *"the DIFFICULTY box moves under the CONFIRM & LAUNCH button"* + *"SKIN THEME becomes a discreet collapsed control beside the ship NAME at the top of the screen ... clicking expands to the 7-swatch picker"*). **Jump:** `#ship-preview-difficulty` (markup: now the last child of `#ss-header-right`) · `#ship-hero-nameline` + `#ss-skin-dock` + `#skin-toggle` (markup, inside `#ship-hero`) · `#ship-preview-skin` (markup: sibling of the nameline, still inside `#ship-hero`) · `function _ssDiffFlag` · `function _setSkinPanelOpen` / `function _wireSkinToggle` · CSS `#ship-hero`, `#skin-toggle`, `#ship-preview-difficulty`, `#ship-hero.skin-open #ship-preview-skin`. **The v36.30 `#ss-options-row` is DELETED** (markup, its own CSS rule, and its two media-query rules), the rails are back to **perks over carousel**, and `#perks-grid` — already `flex-wrap` + centred — reflows up with no orphan container and no gap.
  - **(v39.16) `#ship-select-room` docks LEFT, and stacks under 620px tall.** The header is `space-between` with the ROOM · CONNECTED chip as its middle child, which parked it mid-screen underneath the centred `#ship-hero` nameplate + skin control (owner: "'room connected' copy button is over top of the ship name and skin selector"). `margin-right:auto` in its inline style docks it against the title instead. That is enough on desktop, where `#ship-hero` is `top:84px` — a band below the header. But at `max-height:620px` the nameplate rides up to 46 (and 40 in the landscape-phone block) INTO the header, and the horizontal chip is 271px against 170px of slack at 844×390. So that media block also turns the chip into a stacked, shrunk 131px badge (`flex-direction:column`, label 7px, code 12px). Measured slack after: 12px at 844×390 with the longest ship name AND the COPIED! flash up; 150px at 1090×485.
  - **BOTH new slots are ABSOLUTELY POSITIONED, and in both cases that is the whole design.** Difficulty is `position:absolute; top:100%; right:0; width:100%` of `#ss-header-right` (which gained `position:relative`): in flow it would grow `#ship-select-header` by ~72px, and the header's gradient veil *and* the 108px top anchor on both side columns are calibrated against that height. Out of flow it also costs the CTA exactly nothing when hidden — **measured, classic vs endless at 1920×1080: `#ss-header-right` 79.6px tall and `#ship-select-header` 103.6px tall in BOTH**, i.e. literally no reserved gap in classic/elimination/race/assault. The skin panel is `position:absolute; top:100%; left:50%; translateX(-50%)` of `#ship-hero`, so it OVERLAYS the stage rather than reflowing the top band — there is no vertical room up there to push anything.
  - **`#ship-hero` became a two-part plate.** `#ship-hero-nameline` is an **INLINE-flex** wrapper around `#ship-hero-name` — inline so the parent's `text-align:center` still centres it *and* so `#ss-skin-dock`'s `left:100%` lands on the NAME's right edge instead of the viewport's. That is what keeps the big centred title dead centre with the chip hanging beside it. ⚠ `#ship-hero` now carries `line-height:0` to kill the inline strut the wrapper would otherwise sit on; **`#ship-hero-name`, `#ship-hero-class` and `#ship-preview-skin .perks-label` all restate their own line-height**, and anything else added under `#ship-hero` must too or it renders zero-height.
  - **⚠ THE CHIP RUNS OUT OF ROOM BETWEEN ~760 AND ~1092px WIDE, and the `max-width:1200` block is the fix.** The chip hangs off the right edge of a CENTRED name while `#ss-header-right` is a fixed ~246px dock pinned to the RIGHT edge, so the gap closes as the window narrows. Measured at 880×700 before the fix: **10.9×23.6px of real overlap with CONFIRM & LAUNCH.** Two halves, both load-bearing: (1) `#ship-hero { top: 84 → 112 }` at `≤1200` **and again at `≤900`** (that block is later in the sheet and would pull it back to 64) — 112 clears the CTA's 93.6px bottom edge outright, so they can no longer meet whatever the ship name; (2) `#skin-toggle-label { display:none }` at `≤1200`, leaving swatch + caret. **Verified across the whole roster** (VORTEX/PYRO/PUNCTURE/SLAYER/TRACKER/BLASTER/SYPHON — PUNCTURE is the widest at 327px): the invariant is *chip clears the dock horizontally OR vertically*, and it holds at 1920×1080, 1366×768, 1200×675, 1000×800, 950×760, 880×700, 760×700, 1600×600 and 844×390. At `≤620h` and the landscape-phone block `#ship-hero`'s top stays 46/40 on purpose — the NAME is small there too, so the chip fits beside it again (844×390 worst case: 44.3px of clearance).
  - **`#ship-select.ss-diff-on` (written by `_renderDifficultyPicker` via `_ssDiffFlag`, on BOTH branches) is what moves `#ss-right-col` out of the way.** The docked box hangs down the RIGHT edge — exactly where the column's top lives — and CSS cannot ask "is the difficulty box up?". It is a class and not a media query because the trigger is the MODE, not the viewport. Four values, all measured: base `top:108 → 178`, `≤620h` `74 → 130`, `≤900` `150 → 168`, landscape-phone `56 → 126`. In classic/elimination/race/assault the column keeps its original anchor.
  - **⚠ AT 844×390 THE RIGHT COLUMN HAS ZERO SLACK, so the push has to be paid for out of the CONTENTS.** Measured in classic: info (128) + gap (6) + map (192.4) == the column's 326.4px **exactly**. Lowering `top` to 126 without compensating made `#map-select` shrink below its own `flex:0 0 92px` thumbnail and the preview spilled out of the panel — a real **11.3px `ship-preview-info × map-window-preview`** intersection. Fix, `.ss-diff-on` + landscape only: `#ship-preview-info` max-height `128 → 88` (it is `overflow-y:auto`, so it scrolls) and `#map-window-preview` `92 → 56`. 88 + 6 + 156.4 = 250.4 inside 256.4. Costs nothing you could have clicked — in campaign/endless the map box is a fixed READOUT, never a choice.
  - **⚠ `#diff-grid .perk-card { min-width: 0 !important }` is LOAD-BEARING** now the grid lives in the ~235px dock instead of the full-width rails: `.perk-card`'s shared `min-width:96px` makes three cards 300px, and `@media (max-height:620px)` restates it as `72px !important`, which beats a plain override. `flex:1 1 0` then splits the dock width evenly (measured 70.8px per card at 1920).
  - **⚠ `_renderSkinPicker` MUST NOT write an inline `display` on the panel any more.** `#ship-hero.skin-open` is the only source of truth for open/closed (`display:none` → `flex`), and an inline value would beat the class rule and pin the panel open forever. The old `panel.style.display = 'flex'` line is deleted; `_wireSkinToggle` (once, flag-guarded) binds the button plus a `document` click-away listener, and `enterShipSelect` calls `_setSkinPanelOpen(false)` so a fresh entry always starts collapsed.
  - **⚠ `e.stopPropagation()` in the `.skin-card` click handler is LOAD-BEARING, not defensive.** The click-away listener tests `panel.contains(e.target)`, but the handler wipes `grid.innerHTML` first — so by the time the event bubbles to `document` the clicked card is DETACHED and `contains` says false. Without it the panel snaps shut on every swatch you pick. (Clicking a `.ship-chip` or anywhere else *does* close it, which is the intended behaviour.)
  - **⚠ THE `max-width:900` RESERVATION WENT 262 → 196, RE-DERIVED NOT GUESSED.** The third rail is gone, so the dock is perks (101.6) + gap (8) + carousel (64.4) = **174**, plus the 10px `bottom` that block gives `#ss-rails`, plus the same ~11px of clearance the 262 left. **Measured at 880×700: rails top 516, right-column bottom 504 — 12px of clearance, in both classic and endless.** Any future rail added to `#ss-rails` moves this number again.
  - **MEASURED, four required viewports, both mode families, skin panel open AND closed — zero out-of-viewport elements and zero page scroll everywhere.** **1920×1080** endless: difficulty 101.6–173.8 under a CTA ending at 93.6, right col 178–1066, rails 892 (h 174), panel 784.9–1135.1 × 151.1–237.7 (centred on 960). **1366×768** endless: difficulty 101.6–173.8, right col 178–754, rails 580 (h 174). **880×700**: **zero overlapping pairs at all**, classic right col 150–504 / endless 168–504 against rails at 516; chip 20.8px below the dock. **844×390** endless: difficulty 78.2–122.8, right col 126–382.4, info 88 tall, map preview 56, panel 293.2–550.8 × 78.6–132.9. **A/B against the v36.38 backup served from the same origin**: at 1920×1080 the baseline reports 1 overlap and this build 3; at 844×390 the baseline reports 10 and this build 12 in classic — **the delta in every case is exactly `ship-select-header × ss-skin-dock` + `× skin-toggle`, the SAME transparent-gradient relationship `#ship-hero-name` itself has always had** (the header's box is full-width and its gradient is ~0.03 alpha down there). In ENDLESS this build reports **fewer** overlaps than the baseline: the column push resolves the four pre-existing `ship-preview-confirm × ss-right-col` / `× ship-preview-info` pairs. **Trusted clicks:** ADD BOTS flips `game.eliminationBots` both ways at 1920×1080 and 1366×768 with the ☑/☐ prefix and `.ss-bots-on` following; the difficulty cards persist to `lss_camp_difficulty` and drive `game.campaign.swarmCap` (medium → 6); the skin chip opens, a swatch pick persists `lss_ship_skin` + repaints the chip + re-skins the hero **without closing**, click-away closes, re-click closes, re-entering ship-select closes. 144 fps, zero console errors.
  - **Pre-existing, unchanged by this pass:** `#map-window-preview` is still ~1.6px at `max-width:900`; the `LSS.MODE`-not-reset bug above still reproduces (note that `startSolo` does not set `LSS.MODE` at all, so a probe that enters CAMPAIGN and then "classic" will still show SWARM DIFFICULTY — that is the same bug, not a regression).
- **(v36.40) `#map-window-preview` AT `max-width:900` — the 1.6px sliver, fixed.** Flagged as "pre-existing" by the two passes above; root cause is the v35.20 trap restated. The `≤1200` block gives it `height: 68px !important` and **nothing else**, so flex shrink from `#map-select` / `#map-window` beat the bare height and it measured **153.2 × 1.6 px** at 890×760. Fix is the same one the landscape-phone block already carries: **`#map-window-preview { flex: 0 0 68px !important; }`** in the `@media (max-width: 900px)` block.
  - **⚠ THE DESCRIPTION HAD TO GO WITH IT.** `#map-window` is **110px** tall at this breakpoint. Pinning the thumbnail back to its real 68px leaves 42px for a 23.2px `#map-window-name` **and** a 50.4px `#map-window-desc` — measured, the description overflowed the framed box by ~23px and painted over the carousel arrows. So the block also gets `#map-window-desc { display: none !important; }`, the same trade the landscape block makes. With it hidden: 68 + 6 + 23.2 = **97.2 inside 110**. That overflow is this pin's own fallout, not a pre-existing bug — it is invisible while the thumbnail is a sliver.
  - **VERIFIED:** 890×760 preview **153.2 × 68**, `<img src="map_thumbs/nexus.png">` rendering at 152×66, **zero** pairwise overlaps across `#ss-right-col` / `#ship-preview-info` / `#map-select` / `#map-window` / `#map-window-preview` / `#map-window-name` / `#ss-rails` / `#teammates-strip`; 780×700 identical (153×68, zero overlaps); **844×390 landscape unaffected** (preview still 153.2 × **92** from its own block, zero overlaps).
- **⚠ (v35.10)** `#ship-preview-canvas` MUST stay `position:absolute` and the `#ship-preview`/`#ship-preview-model` chain MUST keep base `min-height:0` — the preview canvas's DPR-scaled backbuffer otherwise feeds flex min-height and ratchets the layout to ~700k px on any dpr>1 screen (latent for years; the old max-height:620 media query masked it). Also `body:has(#ship-select.active)` hides `#minimap`/`#crosshair` — the radar's opaque backing bled through the 95%-alpha backdrop as a "mystery dark box".

#### Launch countdown + loading overlay + pointer lock — `~L49777`
**Jump:** `function launchCountdown` (~L49832)
- **Symbols:** `_clearLaunchCountdown`, `showLoadingOverlay`, `_markLocalWarmupReady`, `launchCountdown`, `_safeRequestPointerLock`
- **(v36.24) LOADING-SCREEN AUDIO HOLD — `show/hideLoadingOverlay` are now the audio gate too** (owner: *"let's not start the music or ship sounds until the loading screen is finished"*). **Jump:** `let _loadingAudioHold` / `function _lssAudioHoldEngage` (directly under `hideLoadingOverlay`) · console `window.__audioHold()`. Full contract in PART 23's *LOADING-SCREEN AUDIO HOLD* entry; the reason it lives **here** is that `#lss-loading-overlay` is the only thing that knows when a loading screen is on screen, and engaging from the overlay covers PREPARING ARENA, WAITING FOR PEERS **and** `_swHubLoadingOverlay`'s ENTERING THE OVERWORLD with one pair of calls. **⚠ `_lssAudioHoldEngage` must stay idempotent — `_swHubLoadingOverlay(true)` calls `showLoadingOverlay` every frame for the whole hub preload.** Between-rounds swaps take `commitLoadout`'s `midMatch` fork, which never shows the overlay, so they are unaffected.
- **(v36.19) `#lss-loading-overlay` IS OPAQUE — it is a cover, not a scrim** (owner bug: *"a glitch that allows the user to see the ship selection screen during loading screen, right after we just confirmed and launched out of the ship selection screen"*). **Jump:** the `#lss-loading-overlay` CSS rule. `background: rgba(2,4,12,0.92)` → `#02040c`, one line.
  - **Why it is a defect and not taste:** `commitLoadout` DELIBERATELY leaves `#ship-select` `.active` and fully rendered underneath for the entire PREPARING ARENA window (there is a note saying so right above its `if (!midMatch)` block) and relies on this element to hide it — the author's own comment at the `showLoadingOverlay` call reads *"Show the loading overlay OVER ship-select while shaders compile."* The remaining 8% composited the whole picker: title, the CONFIRM button still running its infinite `lssConfirmPulse`, stat bars, MAP panel, and the still-rendering GLB preview (`_animateShipPreview` gates on `.active`).
  - It is **not** a fade (the `transition: opacity 0.25s` never runs — `display:none → flex` with no `@starting-style` anywhere in the file) and **not** a stacking bug (overlay z 9000 vs ship-select z 100). Measured with a 4 ms worker-driven DOM sampler on a fresh page, ENDLESS → chip → CONFIRM: ship-select is `display:flex .active` from CONFIRM+0 and the overlay only mounts at **CONFIRM+378 ms**; ship-select is not hidden until **+1895 ms**, i.e. it is merely covered for 1.5 s.
  - **⚠ Do NOT "fix" this by hiding `#ship-select` instead.** `#ship-select-countdown` is a DOM CHILD of it, and `_lssRunCinematicThen` falls through to `andThen()` for race, campaign journey, `!game` and empty `sdfRoomData` — skipping the hide/handoff — so the 3-2-1 ticker would run inside a hidden parent. Writing an inline `display:none` would also be a fifth inline-poison site (the v35.58 trap: FOUR places already hide this element with an inline style, and inline beats the class rule).
  - **⚠ Companion change, multiplayer:** `showShipSelectWaiting()` hides nothing — it only refreshes `#teammates-strip`'s READY/WAIT pips, and that strip lives INSIDE `#ship-select`. Legible through the old scrim, invisible now. So the `WAITING FOR PEERS` call now carries a `N/M ready` count in the overlay SUBTEXT, computed from the same `nonJudgePeerEntries()` walk. **Any future readiness UI must go in the overlay, not in ship-select.**
  - **The ~378 ms pre-paint freeze that used to be listed here as open is FIXED in v36.20 — see the entry below.**
- **(v36.20) THE COMMIT NO LONGER BLOCKS THE FIRST PAINT** (the other half of the v36.19 ship-select report). **Jump:** `function _commitDeferOneFrame` (immediately above `commitLoadout`) · `const _finishCommit = () => {` inside `commitLoadout` · `let _commitPending` (beside `_countdownActive`) · the two `_shipSelectActive && !_commitPending && game.state === 'select'` gates in `pollGamepad`.
  - **MEASURED CAUSE.** Clicking CONFIRM froze the browser for ~410 ms in **two back-to-back long tasks** (PerformanceObserver `longtask`, RTX 5050): task 1 = 203 ms of `commitLoadout` itself, task 2 = 203 ms for the first rendered frame of the newly built world. `showLoadingOverlay` sat **127 lines below** the build it was meant to cover, so its class landed at 157 ms *inside task 1* and the first paint only came at **415 ms** — four tenths of a second of frozen ship-select. Task 1 decomposed: **`buildRoomGraphLevel` 102 ms** (the single biggest item — terrain/SDF), `_warmupEffectShaders` 24 ms, `_pinPostFXPrograms` 31 ms, ~26 ms misc. The warmup body's own prologue is only 10.8 ms before its first yield, so it is NOT the problem.
  - **⚠ HOISTING `showLoadingOverlay` ALONE DOES NOTHING — this is the whole trap.** A rAF callback runs **before** that frame's paint, so a single `requestAnimationFrame(work)` still puts the 400 ms in front of the very paint you are buying. `_commitDeferOneFrame` therefore uses **rAF-inside-rAF**: #1 lands in frame N's pre-paint slot and returns immediately (letting N composite), #2 fires in frame N+1. This is exactly why `_warmupYield`'s single-rAF shape could not be reused — it only needs to flush the driver, not to guarantee a composite.
  - **THE SHAPE.** Everything from `if (!midMatch)` down through the `_warmupPromise` `.catch` is wrapped **verbatim, unreordered** in `const _finishCommit = () => {…}` — moving the tail as one unit is what neutralises every ordering hazard (the `_warmupPromise.then` microtask can no longer overtake the build, `withSeededRandom` never spans a yield, `broadcastWorldObjects` keeps its position). The dispatch is placed AFTER the declaration on purpose: `_finishCommit` is a `const`, so calling it above its declaration would hit the temporal dead zone.
  - **WHAT STAYS SYNCHRONOUS, deliberately:** `midMatch` (the between-rounds swap — `_countdownActive` is already true, a delay would only risk a late respawn placement), `game._liveSwap` and `game._campReentry` (both return long before the deferral), `_v12mValidate`'s throws (still in the synchronous head, so `try { commitLoadout() } catch` callers behave identically), and **immersive XR / hidden page** (window rAF does not fire there and the DOM overlay is not composited into a headset — those arms reduce to today's behaviour). A 250 ms `setTimeout` backstop stops an alt-tab between the click and rAF #1 from stranding the commit.
  - **THE OLD `!_localWarmupReady` OVERLAY GATE IS DELETED, and that is load-bearing.** `_localWarmupReady` is set once and never reset, so on every match after the first of a page load it skipped the overlay entirely — while the build still cost a real ~400 ms. Without the overlay that window is a live, clickable ship picker that then freezes. The overlay now shows on **every** match. Verified live on a second full commit: overlay `.active` at 1 ms, **painted at 11.5 ms**, gone at 160 ms.
  - **RE-ENTRANCY — measured, and worse than expected before the fix.** Mashing CONFIRM 11× through the window ran **ELEVEN full world builds on v36.19** (there was no guard of any kind). Two gates now: `_commitPending` (covers the deferral + build) and `game.state === 'select'` on the two `pollGamepad` ship-select branches. **Both are needed** — `_commitPending` clears when the build ends (~240 ms) but `#ship-select` keeps its `.active` class until `finishLaunch` at ~1.9 s, so `_shipSelectActive` alone stays true long after the match is committed. Latch-only measured 5 builds; latch + state gate is 1. A real MOUSE re-click was never the hole — hit-test proves `elementFromPoint` over the CONFIRM button returns `#lss-loading-overlay` during the build — but `pollGamepad` is deliberately called ABOVE every state early-return, so Start is not covered by the overlay. The nav gate matters just as much as the confirm gate: `cycleMap`/`selectMap` guard only on `mapCommitLocked || state !== 'select'`, so a D-pad edge in the window could rewrite `game.selectedMap` after `_v12mValidate` approved it and before `getNextMap` read it. `net.mapCommitLocked` is also hoisted so an inbound MP `map_change` is refused for the whole window.
  - **MEASURED, before → after (campaign hub and endless, same machine).** Click task **203.8 → 4.5-7.8 ms**; overlay `.active` → painted **202→415 ms → 8.6→9.9 ms** (match 1 endless: painted at **7.0 ms**); frames completed before the block **0 → 2** (9.9 ms and 3.4 ms — the proof a real composite landed); total blocking work **unchanged at ~375-410 ms**, which is the point — the build is not faster, it is *behind a visible overlay* instead of a frozen menu. Zero console errors.
  - **⚠ THE CLIPMAP SUSPICION IS DEAD — do not re-file it.** A prior pass flagged `_clipBuild()` as a first-hub-frame stall. Measured over 8.8 s / 1115 frames of hub launch there are **exactly two** long tasks (the two above) and nothing after them exceeds 50 ms; the world settles to median 6.9 / p99 21.3 ms. `_clipBuild`'s only non-debug call site is in `gameLoop` ~87 lines below the `game.state === 'select'` early-return, so it is structurally impossible for it to be inside the click task. The recurring 6 × `_clipBakeLevel` cost is real but is **desktop free-flight hub only** (`game._clipWantHub` needs `MODE === 'freeflight' && biome === 'mossy'` and not mobile) and did not register as a long task at all.
  - **Adjacent latent bug, own ticket:** the `game._campReentry` branch removes only `.active` and never clears the inline `display:'flex'` that `enterShipSelect` writes — inline beats the class rule, so ship-select probably stays on screen over live gameplay after a campaign death re-entry.
- **(v36.21) THE PICKER GOES AWAY AT COMMIT, NOT AT `finishLaunch`** (owner bug: *"when i tried to go into exhibition mode, it went back to the ship selection screen"*). **Jump:** `#ship-select.lss-launching` (the CSS rule right under `#ship-select.active`) · `function _shipSelectSetLaunching` (immediately above `enterShipSelect`) · its four call sites — `commitLoadout` (one line above `const _finishCommit`), `enterShipSelect`, the between-rounds re-show in `updateRoundSystem`, and the deferred-build `catch`.
  - **MEASURED CAUSE.** Between `hideLoadingOverlay()` and `finishLaunch`, the ONLY thing that ever took the picker off screen was the **intro cinematic** — and `_lssStartSpectatorCinematic` bails outright on four conditions: `LSS.MODE === 'race'`, `game._campJourney` (i.e. the whole campaign HUB journey, which runs as `MODE === 'freeflight'`), empty `game.sdfRoomData`, and an empty team roster (`player.team` outside `TEAM_FLEET_A/B` — the networked-freeflight `_ffaTeamForPeer` case). When it bails, `_lssRunCinematicThen` falls straight through to `launchCountdown(LSS.SHORT_COUNTDOWN)` and the OPAQUE v36.19 overlay lifts off a live, full-brightness ship picker. **Measured on v36.20, race, RTX 5050:** overlay hidden at **7.45 s**, `#ship-select` still `display:flex` with header + body painted until `finishLaunch` at **10.53 s** — 3.1 s of ship-select. The v36.19 opacity change and v36.20's now-unconditional overlay are what turned this from "the scrim lifted" into a hard cut that reads as *going back* to the picker.
  - **THE SHAPE — and it obeys the v36.19 warning above, it does not revert it.** `#ship-select` is NOT hidden: `#ship-select-countdown` is its DOM child and the 3-2-1 must keep a painted parent. Instead `.lss-launching` drops `background` to transparent, sets `pointer-events:none`, and `display:none`s exactly two children — `#ship-select-header` and `#ship-select-body`. `#ship-select-countdown` is deliberately absent from that selector list. No inline `display` is written anywhere, so this is **not** a fifth v35.58 inline-poison site. **Verified live mid-countdown (race):** `sel=flex/rgba(0,0,0,0) hdr=none body=none cd=block:"2 / LAUNCH IN" ovl=none`.
  - **⚠ (v36.36) SUPERSEDED IN TWO PLACES.** The call site in `commitLoadout` is now `if (!midMatch) _shipSelectSetLaunching(true)` — covering the between-rounds fork was a defect, not a feature (it stripped the picker 19 ms after a between-rounds CONFIRM) — and the clear-site list is now **six**, not four: `returnToRootMenu` was missing and that is what broke the post-match return. See PART 16's *Round system tick* v36.36 entry.
  - **Set at the commit point, not in `_finishCommit`** — one line above the `_finishCommit` declaration, i.e. after the `game._liveSwap` and `game._campReentry` early-returns. That is the first point at which the commit is irreversible in every fork, and it covers the deferred fork AND the synchronous `midMatch` fork with one call. Cleared by everything that SHOWS the picker: `enterShipSelect` (which already owns the inline `display:'flex'`), the between-rounds re-show in `updateRoundSystem`, and the failed-build recovery. MP is unaffected — as the v36.19 note above records, `showShipSelectWaiting()`'s pips were already invisible under the opaque overlay.
  - **Companion 1 — the launch chain can no longer reject.** `Promise.all([warmup, preload])` is all-or-nothing: a rejecting `warmupCombatShaders` used to make the combined promise reject *immediately*, abandoning the wait on the asset preload. Each leg now carries its own `.catch` (`Promise.all([warmup.catch(…), assets.catch(…)])`), so one failure degrades that leg only and the combined promise cannot reject at all. The tail `.catch` stays as belt-and-braces.
  - **Companion 2 — SOLO LAUNCH STALL DETECTOR** (`let _launchStallTimer` beside `_questWarmupWatchdog`). `preloadAllAssets` races itself against `ASSET_PRELOAD_MAX_MS`; **`warmupCombatShaders` has no timeout at all** and advances only on `await _warmupYield()`, i.e. on raw rAF turns — and a throw inside `gameLoop` kills three's `setAnimationLoop` chain outright (it re-registers *after* the callback returns), so the promise can silently never settle. The freeflight arm of `_launchSoloAfterCinematic` has the same shape via `game._swPreloading`. ⚠ It is a **stall** detector, not a timeout: a cold-cache preload legitimately runs for minutes (193 MB; measured 22.9 s here, ceiling 180 s), so it only fires once BOTH legs report settled (`_assetPreload.state !== 'loading'` and `_shaderWarmup.promise == null`) and then nothing happens for **12 s** — normally the handoff lands within one frame of settling. Solo only; MP owns its own handshake and clears the timer.
  - **Companion 3 — a failed deferred build is now LOUD.** v36.20's `catch` did `console.warn` + `hideLoadingOverlay()` and left the picker `.active` underneath, which is visually identical to the bug above and undiagnosable from a report. It now `console.error`s, clears `.lss-launching` so the picker is usable, puts `game.state` back to `'select'` (a half-built world must not be ticked), and banners `LAUNCH FAILED`.
  - **REGRESSION MATRIX, v36.21, all six entries driven through the real menu → chip → CONFIRM flow, each from a fresh page load.** Exhibition **playing @16.8 s** (`body.lss-freeflight`, ship mesh visible, framebuffer readback shows the lit hub city — mean luminance 37.4, peaks 215), endless 16.0 s, elimination 16.3 s, race **10.5 s (picker no longer revealed)**, assault 16.2 s, campaign 5.4 s. Zero console errors, zero unhandled rejections, zero rAF-callback throws in all six.
  - **⚠ HARNESS NOTE for whoever tests this next.** The Browser pane does not composite when it is not displayed, so **`requestAnimationFrame` never fires** — `game.time` stays 0, nothing ticks, and `commitLoadout` takes the `document.hidden` arm of `_commitDeferOneFrame`, i.e. it runs SYNCHRONOUSLY and you are not testing v36.20's real path at all. The way through is a throwaway copy of `index.html` with a shim injected before `</head>` that (a) `Object.defineProperty`s `document.hidden`/`visibilityState` to visible and (b) re-implements `requestAnimationFrame` on a 16 ms `setInterval`. Three resolves `requestAnimationFrame` off the global at call time, so the override is picked up by `setAnimationLoop`. Screenshots still fail (`the Browser pane is not displayed, so the page is not compositing frames`); use a `gl.readPixels` off the LAST `<canvas>` (the first is `#circumpunct-hud`, a 2D context) from a rAF queued after three's, or read geometry/computed style via `getBoundingClientRect`.
    - **(v36.22 correction — half of the above was miscredited.)** `setupBackgroundTick` (bottom-of-file IIFE, ~L81603) *does* exist and *does* drive `gameLoop` from a 30 Hz worker. It is not why nothing ticks: `bgActive` is only ever set inside a **`visibilitychange` handler**, and a pane that is hidden from the first paint never fires that event — so the worker is never armed and `game.time` sits at 0. Both observations are right; the mechanism is the missing event, not a missing worker.
    - **(v36.22) DRIVING A LAUNCH THAT BEATS A PAGE-LOAD TIMER.** Anything scheduled off boot (the v36.22 preload kickoff at 1200 ms) cannot be raced from `javascript_tool` — the round trip after `navigate` lands seconds late, by which time it has already fired. Bake the driver into the shim instead: a `?auto=<buttonId>` arm that `setInterval(…, 20)`s until `window.__real_startSolo` is a function, clicks that lobby button, then clicks `#ship-preview-confirm` 250 ms later. That reliably commits a match with `window.__assetPreload().state === 'idle'`. A companion `?slow` arm wraps `window.fetch` and delays only calls passing `credentials:'omit'` — that is `_assetPreloadOne`'s signature and nothing else's (three's `FileLoader` uses `'same-origin'`), which stretches the preload to ~60 s so the *mid*-preload window is drivable by hand.
- **(v36.22) THE PRELOAD MOVED TO PAGE LOAD — IT IS NOT A LAUNCH GATE ANY MORE** (owner: *"we shouldn't be loading the assets before a match, it should be when the browser loads the html, and only once and cached forever"*). **Jump:** `function _kickAssetPreloadOnPageLoad` (directly under `preloadAllAssets`) · its single call site `_kickAssetPreloadOnPageLoad()` in the bottom-of-file init, right after the `window.__real_*` exports and `__lssReplayPending()` · `#lss-preload-hint` (built next to `#lss-gp-hint`, ~L3825) · `function _assetPreloadPaint` / `_assetPreloadHintHide` · debug `window.__kickAssetPreload()`.
  - **WHERE IT RUNS NOW.** The bottom-of-file call only *schedules*: `requestIdleCallback(…, {timeout: ASSET_PRELOAD_KICKOFF_MS})` **plus** a `setTimeout(ASSET_PRELOAD_KICKOFF_MS)` — the first is the polite path, the second is both the no-rIC fallback and the hard ceiling; a `fired` latch makes the loser a no-op. `ASSET_PRELOAD_KICKOFF_MS = 1200`. It is deliberately NOT hoisted above the engine bootstrap: kicking 193 MB off before three.js resolves from the CDN would delay the menu, the one thing this must never do.
  - **⚠ NOTHING MAY AWAIT `_assetPreload.promise` AS A LAUNCH GATE AGAIN.** The v36.16–36.21 `Promise.all([warmup, preload])` in `commitLoadout` is **gone** (with it, v36.21's per-leg `.catch` rejection-proofing — one leg left, so the tail `.catch` is the whole guarantee). Launching mid-preload is a supported, tested path: uncached assets stream on demand exactly as they did pre-v36.16 and the preload keeps filling the cache underneath the match.
  - **Second removal, same reason:** the v36.21 solo launch stall detector gated on `_assetPreload.state === 'loading'`. That term is **gone from the gate** — it existed only because the launch used to wait on the preload, and keeping it would have blinded the detector for the whole cold-cache download window. Only `_shaderWarmup.promise` holds it off now.
  - **PROGRESS UI — `#lss-preload-hint`, third rung of the lobby corner stack.** Same `_LSS_CORNER_CSS` 11 px face and same `#lobby` parent as `GAMEPAD RECOMMENDED`, one notch up (`bottom:42px` vs 26 px vs the version badge's 8 px; all right-aligned at `right:10px` — measured 180×19 at x=810 in a 1000 px viewport, i.e. flush with the two below it). Parenting to `#lobby` means it appears and disappears WITH the menu — no visibility polling, nothing on screen during a match. One text line (`CACHING ASSETS · 47%`) over a 2 px fill bar; the full `N / TOTAL files · P% · X / Y MB` readout is the `title` tooltip. Starts `display:none`, first reveals only when the manifest lands (totals known), auto-fades 2.5 s after the last file (`ASSETS CACHED · 193 MB`), and a click sets `dataset.dismissed='1'` so later paints can never re-show it — **verified live: dismissed at 21/142 and still hidden at 42/142.**
  - **⚠ `_assetPreloadPaint` NO LONGER TOUCHES `#lss-loading-text`/`#lss-loading-sub`.** That retarget is load-bearing, not cosmetic: the preload runs while the player is in the lobby, so a player who launches mid-preload would otherwise watch "PREPARING ARENA / compiling shaders" get stomped by a file counter every 4th completion. The trailing `_assetPreloadPaint('PREPARING ARENA','compiling shaders')` restore is gone for the same reason. **Verified:** overlay text read `PREPARING ARENA / compiling shaders` unchanged through a launch taken at 33% preload.
  - **`ASSET_PRELOAD_MAX_MS` (180 s) is now only a reporting boundary** — it flips `timedOut` and logs so `window.__assetPreload()` tells the truth about a wedged connection. It used to be the safety valve that released a blocked launch; nothing is blocked now.
  - **MEASURED, fresh load of the shipped `index.html` (localhost, RTX 5050 box).** Boot long task 94→**275 ms** = menu interactive (`domContentLoadedEventEnd` 275 ms, same instant); first byte of `asset-manifest.json` at **942 ms**, i.e. **667 ms after** the menu was live and zero overlap with the boot task; 142/142 · 193.0 MB · 0 failed in 0.9–2.5 s. Twelve menu interactions driven *during* an active preload (Settings, How-To, My Stats, Aegis, four mode entries, back-to-menu) cost **0.2–31.5 ms** of main thread each. Zero console errors.
  - **REGRESSION MATRIX — all six entries, fresh page load each, auto-clicked the instant the menu was wired so the match was committed BEFORE the preload had started.** Exhibition (`preloadAtClick: idle 0/0` → `playing`, `body.lss-freeflight`), endless (confirm at 1/142), elimination (confirm at 0/0), race (`playing` @7.4 s; v36.21's `.lss-launching` still holds — `selBg rgba(0,0,0,0)`, `hdr none`), assault (confirm at 4/142), campaign (confirm at 7/142, `_campJourney true`). All six reached `playing` with **zero errors and zero unhandled rejections**, and the preload ran to 142/142 underneath. A separate slow-network run confirmed the other half: CONFIRM at 33% preload → overlay lifted at 39% → `playing` at 47%, preload still `loading`.
- **(v36.16) BULK ASSET PRELOAD** (owner: "force all the assets to download at the start of the game load … and then stay cached") — **Jump:** `function preloadAllAssets` (right after `hideLoadingOverlay`) · `const _assetPreload` · build-time generator **`tools/gen_manifest.py`** → **`LSS/asset-manifest.json`** · debug `window.__assetPreload()`. ⚠ **Where it runs is now PAGE LOAD — see the v36.22 entry above**; this entry's original "`commitLoadout`, behind the PREPARING ARENA overlay at match launch" is history. Everything else still stands: idempotent/memoized on `_assetPreload.promise` (assigned synchronously inside the first call, so re-entrancy can't double-start it) — one page load = one manifest fetch = one pass, verified. 7-lane bounded concurrency off one shared cursor; each fetch consumes `arrayBuffer()` (an unread body may not be stored) and **resolves either way** — a 404 logs + increments `fail` and never blocks anything; a missing/broken manifest logs once and the game falls straight back to on-demand loading. Mobile: same list (owner accepted) with a `navigator.connection.saveData` bail (`state:'skipped'`, manifest never fetched — verified).
- **⚠ The manifest is built from CODE REFERENCES, not a directory listing.** `tools/gen_manifest.py` (run from the repo root, parses the shipped `LSS/index.html`) walks the game's own tables — `SHIP_MODELS`, `HOARD_SHIPS`+`NEMESIS_SHIP`, `MONSTER_DEFS`+`MONSTER_BASE_URL` (plus the literal `Sphere.glb` champion shell), `_GUN_CYCLE`/`_GUN_EXTRA_FRAMES`/`_ABILITY_OVERLAY_FILES`/the ability+core descriptor `*.png` literals/`frames/mock/<ship>.json`, `MAP_DATA`'s `thumb:` literals, `MUSIC_TRACKS`, `audio/manifest.json`, the `_ringBaseUrl` literals. **Regenerate it whenever those TABLES change** (a plain build bump does NOT need it — see the `v` flag below). It also prints **ORPHANS** (on-disk files under objects/ships/frames/map_thumbs/music/audio/rings with no code reference) and **MISSING** (referenced, not on disk). Deliberately EXCLUDED: `skybox/` (theme-scoped, on demand — owner's call), `campaign_media/`, `sounds/`, `walls/`, `themes/`, `effects/`.
- **(v36.25) THREE CHANGES, AND THE PHASE-1 EVIDENCE THAT SHAPED THEM.** A full profiling pass (rAF-shim harness, per-tick work/gap/heap + `longtask` + resource timing, positive-controlled at 150/400 ms injected blocks) **cleared the preloader of causing in-match hitches**: v36.24 with the preload cold, cache-busted and throttled to 12 Mbps so it transferred 109 MB *during* a 60 s endless flight measured **p99 17.7 ms / 1 frame >33 ms**, statistically identical to the same build with the preload switched off (p99 17.8 ms, 2 frames >33 ms, one 54.1 ms max). Gameplay allocates 20–26 MB/s on its own in every build back to v36.11, so the preloader's traffic is invisible in the heap too. The real hitch was elsewhere — see PART 16's *Round system tick* v36.25 entry. What changed here is bandwidth policy and belt-and-braces, not a hitch fix:
  - **SUSPEND WHILE PLAYING — `_assetPreloadBusy` / `_assetPreloadGate`, checked by each lane BEFORE it claims its next file.** Busy = `#lss-loading-overlay.active` (the same single source of truth the audio hold uses, so PREPARING ARENA / WAITING FOR PEERS / ENTERING THE OVERWORLD are all covered) **or** `game.state !== 'select'`. State becomes `'paused'`, `_assetPreload.pauses` counts it, `window.__assetPreload()` reports it, and `ASSET_PRELOAD_MAX_MS`'s watchdog **re-arms** while paused so a long match is not reported as a wedged connection. **⚠ The gate is between files, never mid-fetch** — an in-flight transfer always completes, because abandoning it would waste the bytes *and* lose the cache fill. **Verified live** (cold + 12 Mbps): parked at 9/115 for the whole match with `pauses:1`, the 3 lanes that were mid-file finished and nothing new started; forcing the endless soft return flipped `game.state` to `'select'` and it resumed to 39/115 within ~12 s and ran to `115/115 · 90.6 MB · 0 failed`.
  - **DRAIN, DON'T MATERIALIZE.** `_assetPreloadOne` reads `r.body.getReader()` and drops each ~64 KB chunk instead of calling `r.arrayBuffer()` (which allocated one contiguous buffer per file — up to 14 MB — only to throw it away). `arrayBuffer()` remains the fallback if an engine has no streaming body. **The response is still stored:** measured on an un-preloaded 2.58 MB GLB, first drained fetch `transferSize 2,585,032`, immediate second fetch of the same URL `transferSize 0 / decodedBodySize 2,584,732 / 2.2 ms`.
  - **MANIFEST TRIMMED 142 files / 193.0 MB → 115 files / 90.6 MB** (owner's call) via `EXCLUDE_GROUPS = {'music','hoard'}` in `tools/gen_manifest.py` — `--all` builds the untrimmed set. `music` (5 / 42.0 MB) streams natively one track at a time; `hoard` (22 / 60.4 MB) arrives progressively and `loadHoardModel()` already pulls each on first sight. Excluded groups are still walked and still reported (an `EXCLUDED` section in the tool's output) so nothing goes quiet. **⚠ The trade-off is real and named in the script:** a HOARD enemy seen for the first time is now a cold network fetch rather than a disk hit. If HOARD ever reports first-sight stutter, that is the line.
- **⚠ Cache-bust shapes must match or the preload is wasted.** *(v36.25: rewritten — see the entry directly below for the current codes.)* Manifest entries carry `"v":1` when the game requests them as `path?v=<LSS_BUILD>` (every GLB + everything under `frames/`) and `"v":0` when it requests them bare (`music/`, `map_thumbs/`, `audio/`). The loader appends the stamp at runtime, which is why the manifest survives build bumps. **`_FRAME_CACHE_BUST` was changed from `Date.now()` to `LSS_BUILD` in v36.16** — a per-page-load timestamp made every cockpit-frame URL unique, so ~30 MB of frame art was re-downloaded on EVERY page load and no preload could ever prime it. If you ever put a timestamp back, the frames half of this feature dies silently.
  - **(v36.22) RE-VERIFIED END TO END, not by reading the two expressions.** Both sites derive from the same constant (`_FRAME_CACHE_BUST = '?v=' + LSS_BUILD` · `preloadAllAssets`'s `stamp = '?v=' + LSS_BUILD`), and the runtime proof is: entering a match after the page-load preload finished, **all 6 cockpit-frame reads (5.93 MB decoded) came back `transferSize:0`** — i.e. the runtime URL hit the entry the preloader created, so they are byte-identical (`frames/Vortex/frame_VORTEX.png?v=36.22`). Same pass cross-checked the GLB half against the manifest: **15/15 runtime GLB URLs matched a manifest URL exactly** (`rings/`, `objects/hoard/*`), each with exactly one earlier preloader hit. `./frames/…` vs manifest `frames/…` is fine — both resolve to the same absolute URL, which is what the cache keys on.
  - **(v36.25) THE CODES CHANGED, AND SO DID WHAT THEY POINT AT.** `"v":0` no stamp (`music/`, `map_thumbs/`, `audio/`) · `"v":1` → `_MODEL_CACHE_BUST` = `'?v=' + _MODELS_VERSION` (every GLB) · `"v":2` → `_FRAME_CACHE_BUST` = `'?v=' + _FRAMES_VERSION` (`frames/**`). `preloadAllAssets` picks per entry via `_stampFor(e)`. **Both are ART versions now — the whole point is that they do NOT move with `LSS_BUILD`.** Before this, all 89 stamped URLs were re-minted on every build bump and every returning player re-downloaded **~146 MB** of unchanged art (`_headers`' `max-age=604800` bought nothing — a busted URL is a cache MISS, not a stale hit). Both are seeded `'36.24'`, the build the current art shipped under, so a warm v36.24 cache survives the upgrade. **The manifest no longer needs regenerating on a build bump** — only when the asset TABLES change.
  - **(v36.25) RE-VERIFIED, again by runtime URLs not by reading expressions.** On a `LSS_BUILD='36.25'` load: every `frames/ ships/ objects/ rings/` request carried `?v=36.24` — **67 distinct asset paths, zero requested under two different query strings** — so the preloader's URL and the game's URL are byte-identical, and a build bump changed no asset URL at all. 21 of those paths were requested twice (preloader then runtime) and the second hit was `transferSize:0` every time, e.g. `ships/slayer.glb?v=36.24` 4,723,860 B at t=349 ms → **0 B** at t=1431 ms. `115/115 assets, 0 failed`.
  - **⚠ Cross-page-load cache CANNOT be demonstrated in this pane for `fetch()`-originated entries** — HTML-originated subresources (`LSS.png`, `skybox/clouds.jpeg`, CDN modules) persist across navigations, but nothing first requested by `fetch(url,{credentials:'omit'})` does, even against a local server that sends an explicit `Cache-Control: public, max-age=604800` (tested on a throwaway header-serving server on :8100). It is build-independent (v36.24 behaves the same), so use the WITHIN-load `transferSize:0` proof above instead of chasing it.
- **Caching is NOT re-implemented** — plain HTTP cache. **(v36.22) `_headers` had a GAP: `/audio/*` had no rule**, so the 40 announcer clips + `audio/manifest.json` fell through to the `/*` one-hour catch-all while the other six manifest directories got `max-age=604800`. Fixed — **all seven of `objects/ ships/ music/ frames/ rings/ map_thumbs/ audio/` now carry `max-age=604800`.** (`asset-manifest.json` itself stays on the one-hour catch-all on purpose: it is 9 KB and is requested as `?v=<LSS_BUILD>`, so a build bump busts it anyway.) ⚠ `_headers` is Cloudflare-Pages-only — the localhost python server sends no `Cache-Control` at all, so the production policy cannot be exercised in dev.
- **⚠ (v36.22) THE OLD "the automation Browser pane runs with the HTTP cache DISABLED" NOTE WAS WRONG — the pane's cache persists across navigations; it is just SMALL.** Proven with a throwaway `_dbg_probe.html` that re-fetched 8 real asset URLs (audio, map_thumbs, `?v=`-stamped rings + frames) from a page that had never requested them: **8/8 came back `transferSize:0` with full `decodedBodySize`, 5.3 MB in 286 ms.** What the pane genuinely cannot do is hold **193 MB** — two back-to-back loads of the full game each transferred 193.1 MB, and the same probe run straight after a full load dropped to 6/8. So: cross-load cache *behaviour* is provable in-pane at small scale, cross-load caching of the *whole* manifest is not. Budget-eviction, not a URL mismatch — see the URL-identity proof below.
- **Measured (v36.25, localhost) — CURRENT SET:** **115 files / 90.6 MB** — frames 51/30.4 MB, ships 7/30.4 MB, objects 7/21.7 MB, map_thumbs 8/3.7 MB, rings 2/3.2 MB, audio 40/1.2 MB. Excluded by `EXCLUDE_GROUPS`: hoard 22/60.4 MB + music 5/42.0 MB = **102.4 MB kept off the wire**. `115/115 ok, 0 failed, 0.5 s` warm. (Pre-existing, unchanged by the trim: `gen_manifest` reports 1 MISSING code reference, `frames/Syphon/SYPHON-M1.png`.)
- **Measured (v36.16, localhost):** 142 files / **193.0 MB** — hoard 22/60.4 MB, music 5/42.0 MB, frames 51/30.4 MB, ships 7/30.4 MB, objects 7/21.7 MB, map_thumbs 8/3.7 MB, rings 2/3.2 MB, audio 40/1.2 MB. 142/142 ok, 0 failed, 1.7 s, readout stepped 0→8→16→33→53→81→100%, zero 4xx across 205 requests, 144 fps in-match.

#### Keybinding capture + How-To-Play — `~L49956`
**Jump:** `function openHowToPlay` (~L50036)
- **Symbols:** `_kbRebindAction`, `_captureKbKey`, `_kbActionHeld`, `_isGamePreventKey`, `openHowToPlay`
- **(v35.98) How-To rework:** CONTROL METHOD dropdown (kb/gp/touch/vr; `lss_howto_scheme` localStorage, touch-device auto-detect) — ship slot tags + the CONTROLS section render from the selected method's LIVE binding table via `_howtoBindLabel` (kbBindings/KB_DEFAULTS + `_formatKey`, gpBindings + GAMEPAD_BUTTON_NAMES, xrBindings through `_howtoXrLabel` because XR_BUTTON_NAMES is scoped inside buildSettingsPage, fixed touch chip names RT/RB/LB/F/R/LT); plus a GAME MODES — GOALS & RULES card section (wording from PART 2 mode entries + `endless_mode_design.md`) and a SETTINGS pointer line under the dropdown. `_howtoRender` rebuilds the overlay content on EVERY open and scheme change (scroll preserved) so Settings rebinds always show fresh — don't restore the old build-once cache.
- **(v36.05) HUD diagram + mechanics cards.** **Jump:** `function _howtoHudSvg` (right above `_howtoRender`). THE HUD section (after CONTROLS) embeds an inline-SVG schematic of the circumpunct layout HUD **generated from the LIVE `_HL` table** (1 vmin -> `SC` svg units, canvas-degree convention 270 = up; arcbar/segarc/ticks fold `rot` into a0/a1 exactly like `_hlArcBar`, dash pips get a real box rotation) with margin callouts + leader lines for every part — health/shield/energy arcs, speed/ammo tick strips, core segarc, dash pips, the 3 cooldown arcs with textPath-curved names, doomed pulse band, reticle, top-centre band, kill feed, radar disc + spinning rose + fixed lubber + edge arrow. Because it reads `_HL` directly, a layout change re-shapes the diagram for free. `min-width:640px` on the svg + `overflow-x:auto` on its card = horizontal scroll instead of illegible shrink on portrait phones. A COMBAT MECHANICS card section (after GAME MODES, before SHIPS) documents the CODE-true rules: dash = velocity burst only (per-hull charges 3/2/1, sequential cooldown refills, **does NOT restore shields** — shields refill ONLY via stasis fields and executions); doomed = ≤15% hull → ram-executions both ways (enemy touch kills you instantly; executing gives instant kill + full shields + 20 core), stasis exit heals + clears doomed, bots self-destruct at doomTimer 0 but the player's doomTimer is decremented and never read — no player self-destruct; core = +dealt/100 damage, +15 kill, +20 execution, +2 costed ability (v35.60 gate), 100 → `activateCore` fires the ship's signature super and force-zeroes the meter while it runs. **(v36.12)** the stasis/shields card also documents the OVERSHIELD (leftover stasis charge banks a white-cyan layer over the shield arc, spent before shields, bleeds off outside fields) — keep that sentence in step with the PART 20 mechanic.

#### Viewport/resize + action label maps — `~L50698`
**Jump:** `function _applyViewportSize` (~L50713)
- **Symbols:** `_doPostFXResize`, `_applyViewportSize`, `GAMEPAD_BUTTON_NAMES`, `ACTION_LABELS`, `KB_DEFAULTS`
- **⚠** Resize debounced; postFX RTs resized separately.

#### Settings page builder (~1800 lines) — `~L50974`
**Jump:** `function buildSettingsPage`
- **Symbols:** `settingsOpen`, `_refreshSettingsValues`, `buildSettingsPage`

#### Settings open/close + gamepad focus nav — `~L52781`
**Jump:** `function openSettings`
- **Symbols:** `openSettings`, `closeSettings`, `_settingsMoveFocus`, `resetSettingsToDefaults`

#### Wall Lab config (mostly stubbed) — `~L52987`
**Jump:** `function importWallLabConfig` (~L53062)
- **⚠** Deliberately neutered (`WALL_PATTERN_NAMES=['None']`, `setWallPattern` forces 0).

### ═══ PART 19 — Settings persistence & wall textures (~53134–55554) ═══

#### Settings persistence + baked default configs (large data) — `~L53134`
**Jump:** `const SHIPPED_DEFAULTS` (~L53360)
- **Symbols:** `saveSettings`, `BAKED_DEFAULTS`, `SHIPPED_DEFAULTS` (~1440-line blob), `loadSettings` (~L54802)
- **⚠** `SHIPPED_DEFAULTS` is the canonical tuning snapshot; `loadSettings` runs at bottom-of-file init.

#### Procedural wall textures — `~L55293`
**Jump:** `function _initWallTextures` (~L55491)
- **Symbols:** `WALL_TEXTURES`, `_bakeCanvasTexture`, `_drawStone`/`_drawBrushedMetal`/…, `setWallPattern` (stub)

### ═══ PART 20 — World objects: supershape, stasis, fog, map data (~55554–57991) ═══

#### Supershape burst FX + Cosmic anomaly — `~L55554`
**Jump:** `class CosmicAnomaly` (~L55667)
- **Symbols:** `_buildSupershapeBurstGeometry`, `spawnSupershapeBurst`, `CosmicAnomaly`, `spawnCosmicAnomaly` (disabled)

#### Stasis fields / Champion capture point — `~L55883`
**Jump:** `class StasisField` (~L55891)
Networked capture-point objects + ownership/serialization.
- **Symbols:** `StasisField`, `amStasisOwner`, `serializeWorldObjects`, `applyWorldObjectsManifest`, `spawnStasisField`, `_lssEndlessStasisSpot` (v36.13), `updateStasisFields`
- **⚠** Ownership is consensus-driven.
- **(v36.15)** `field.teamProgress` / `field.chargingTeam` now drive a HUD readout — the **CHAMPION CAPTURE BAR** in PART 18's `updateHUD`. It reads `game.championField` directly, so **anything that changes the champion charge model (denominators, decay, the preserve-on-release rule, or the per-team map's shape) changes what the bar shows.** Note the bar reads `teamProgress`, NOT the `chargeTimer` mirror — keep that mirror line if you like, but it is not the HUD's source.
- **(v36.11)** `_championDue` (in `updateStasisFields`) skips `'endless'` alongside campaign/freeflight — endless never spawns the champion objective. `spawnChampionField` (championMode StasisField + shell) ≠ `spawnStasisField` (plain max-3 pickups); the pickup spawner is ungated in endless. ~~no `levelSpheres` on endless maps → `getStasisSphereIndex` always −1~~ — **that diagnosis was WRONG, corrected in v36.13** (see below).
- **(v36.13) ENDLESS STASIS PLACEMENT** (fix: endless had no working shield refill at all) — **Jump:** `function _lssEndlessStasisSpot` (immediately above `spawnStasisField`) · the `LSS.MODE === 'endless'` branch inside `spawnStasisField` · `destroy(quiet)` on `class StasisField` · the STASIS PRUNE block in `EndlessMode.update` (right after the `invalidateMinimapExtent` line) · debug `window.__endlessStasis()`. **Real root cause** (the v36.11 note above guessed `levelSpheres.length === 0`; measured live it is 3 at build and 4-8 mid-run — endless hall spheres ARE registered, `_lssEndlessApplySeg` pushes `seg.sph` into `game.levelSpheres`): the classic candidate generator is `getValidSpawnPoint(null, 80)` → **`game.corridorPoints`**, which `buildRoomGraphLevel` bakes ONCE from the level's initial rooms/tunnels and never extends. The endless route grows at runtime, so every candidate stays pinned at the cavern mouth tens of km behind the pilot; once those first spheres prune out, all 50 attempts fail the `getStasisSphereIndex(pos) >= 0` gate forever. Since "shields never regen naturally — only stasis fields and executions", a run was a one-way bleed. **Fix = swap ONLY the candidate generator.** `_lssEndlessStasisSpot(aliveFields)` picks the nearest HALL ahead (`seg.hall && seg.sph`, `gid >= run.progGid`, `900..9000u`, skipping halls that already hold a live field), places the orb at a gid-hashed off-centre point (`0.10-0.42 × sph.r` lateral, 30-55% of the carved gap — deliberately ON the flight line, the inverse of the v35.90 bolt/mote alcove bias), then runs the `_lssEndlessBolts` clearance recipe (carved-gap clamp + `worldSDF < -60` step-DOWN, skip on a sealed column). Everything downstream is the classic path verbatim: the 3-alive cap, the 30s `game.stasisInterval` replenish, `instantiateStasisField`, the `stasis_spawn` broadcast, `enterStasis` → `updatePlayerStasis` (so the v36.12 OVERSHIELD spill works in endless for free). **Cadence:** a hall hosts a pickup only if `_lssEndlessBoltHash(gid, 41) < 0.42` (measured pass rate 0.427 over 2000 gids) ≈ 1 hall in 2.4 ≈ one pickup per ~15km. **Determinism:** every offset is a PURE gid hash — never `run.gen.rand` (shared ROUTE stream, v35.85) and never `gen.cos` (free-running cursor, v35.87); proven by three separate boots on the same seed placing hall gid 9's field at exactly (28321, 43, 8295). Co-op agreement doesn't *depend* on it (the authority still computes + broadcasts), the hash just means any peer evaluating the same hall agrees. **⚠ SPAWN_MAX (9000) must stay well under PRUNE_MAX (11000)** — the first cut used a 12000u band against a 9500u prune, which lets a pickup spawn already-doomed and burn the whole 30s cycle. **Prune:** the sweep in `EndlessMode.update` quietly destroys any non-champion field >11000u from the pilot; **distance-based on purpose**, so it runs identically on a co-op client (which gets its fields from `stasis_spawn` and has no segment binding). `destroy(quiet)` skips only the pickup burst + light + sky godray (disposal is identical, every pre-existing caller passes nothing). **Verified live** (106km headless drive, force-timer harness): 7 spawns, all `hallGid` non-null (every orb inside a hall sphere), all `sdf −300` (open air), spawn distance 7479-8654u, `maxAlive` 3 and never above, 6 prunes all at 11001-11034u; collect from shield 900 → 4500 then overShield 951 (spill at shield-full, decay 3%/s outside); classic same build → pickups still land in `levelSpheres` 0/2/4 via corridorPoints and the champion field + shell still spawn at `roundTimer ≤ 10`; zero console errors.

#### Room fog + player stasis + executions — `~L56711`
**Jump:** `function updateRoomFog` (~L56715)
- **Symbols:** `_FOG_BASE_DENSITY`, `updateRoomFog`, `enterStasis`, `updatePlayerStasis`, `checkExecutions`
- **(v36.12) STASIS OVERSHIELD** (owner feature, all modes) — inside a field, once `player.shield` hits max the SAME `maxShield/playerStasisDuration` charge rate overflows into **`player.overShield`** (cap `0.5*maxShield`; the spill happens within one tick, no waste); outside a field the early-return branch at the top of `updatePlayerStasis` decays it at **3% of maxShield/s** (~17s full bleed; branch runs every playing frame — gameLoop calls unconditionally). Damage order is **overShield → shield → hull** in `playerTakeDamage`: the block sits AFTER every absorb-shield ability early-out (Body/Fire/Vortex/Plasma-wall still swallow hits whole — verified vortexStored charged while overShield untouched) and fires a white-cyan `0xb8f6ff` `spawnShieldHit` ripple. Zeroed at `playerDie` / `respawnPlayer` / `commitLoadout` / `returnToRootMenu`. HUD: `_hlOverShieldOverlay` (PART 18, beside `_hlNanoOverlay`). Net: `os` rides tier-1 state (`broadcastPlayerState` → `NetworkPlayer.overShield`, **display-only v1** — damage always resolves on the owning client, so ordering needs no sync). **Bots: player-only v1 — no bot overshield.** Debug: `window.__playerTakeDamage` (the real pipeline, for harnesses). Champion-field stasis untouched (its charge lives in `updateStasisFields` and ends at shield-full). Verified live (endless, VORTEX 4500 shield): charge 1500/s, spill exactly at shield-full, cap parked at 2250; decay measured 135.5/s = 3.01%/max/s; 500/1000/4300 hits → os 800→300→0, shield 4500→3800→0, hull 10000→9500; HUD pixel windows 642px white-cyan over shield band vs 0 at os=0, nano purple 815px alongside on health band, zero cross-band bleed; respawn → 0; 144fps; zero console errors.
- **⚠ (v36.37) `#stasis-warning`'s `top` IS NO LONGER ITS OWN.** It is one of the four tenants of the top-centre band and is now positioned by `_hudPinTopBand` (PART 18 — it was printing across `#round-info`'s ROUND label at 1200×675 and across the timer digits at 844×390). Its CSS `top`/`transform` are a pre-measure default; change the STACK, not this element.
- **(v35.93)** `#stasis-warning` moved out of the ring cluster's keep-clear zone to `top: calc(50% + 21.5vmin)` (status band under the cluster, execution-prompt styling) and its `#stasis-fill` charge bar is DELETED everywhere (markup, CSS, both writers in `updatePlayerStasis` + the champion path in `updateStasisFields`) — the HUD shield arc IS the recharge display. Note there is NO gap between keep-clear (19.6) and the radar disc top (20 vmin below centre), so the line tangents the disc's top rim by design — don't push it to the owner-suggested 26-30 vmin, that's mid-disc.

#### Map data + level geometry + spawns — `~L56881`
**Jump:** `const MAP_DATA` (~L56896) · `function buildRoomGraphLevel` (~L57438) · `function _lssGenShiftingDeep`
- **Symbols:** `MAP_DATA`, `CAMPAIGN_LEG_MAP`, `getNextMap`, `_lssGenShiftingDeep`, `buildRoomGraphLevel`, `getValidSpawnPoint`
- **⚠** `buildRoomGraphLevel` builds the whole arena mesh; `getValidSpawnPoint` scores clearance to avoid wall-spawns.
- **(v34.65) New maps:** `colonnade` (The Colonnade — pillar-karst cathedral; `terrain: { pillars, wallPinch }` drives the pillar field, see PART 7) and `shifting_deep` (The Shifting Deep — `procedural: 'shifting_deep'` makes `buildRoomGraphLevel` regenerate the room graph EVERY ROUND via `_lssGenShiftingDeep`: 180°-symmetric rooms, mirrored-Kruskal spanning + loop edges + degree-floor (min 2 exits), biome roulette via `level._biomeOverride` → `T.biome`; the static rooms in its MAP_DATA entry are only the carousel preview/fallback). Both derive seeds from (worldSeed, currentRound) — peer-identical, idempotent per round, re-rolled between rounds.
- **(v36.56/57) `spire`** (The Spire — volumetric arena, slice 1): the `arena: {seed, floors, spikeAmt, scale}` block IS the world; rooms are spawn/nav data only, seed- AND scale-locked to open air (see PART 7's The Spire entry + `LSS/arena_port_plan.md`). ⚠ `scale: 2` and the `champion: true` flag on `mid_high` are both load-bearing (containment-band pin + champion-in-rock, PART 7 v36.57 notes). Real thumb `map_thumbs/spire.png` since v36.57.

### ═══ PART 21 — Overlays, announcer, combat HUD feedback (~57991–59509) ═══

#### Overlays + hit feedback FX — `~L57991`
**Jump:** `const Overlays`
- **Symbols:** `Overlays` (`window.Overlays`), `triggerScreenShake`, `hitFX`, `triggerHitFeedback` (`window.triggerHitFeedback`, `window.hitFX`), `updateHitstop`, `v8DuckAmbient` (`window.v8DuckAmbient`)
- **⚠** `updateHitstop` scales game dt — interacts with loop timing.

#### Announcer (TTS voice) — `~L58392`
**Jump:** `const announcer`
- **Symbols:** `announcer`, `announcerInit`, `announcerSay`, `announce`, `ANN`, `announceMultikill`; window exports (`window.announcer`, `announcerSay`, `announce`, `ANN`, `announceMultikill`)
- **⚠** Needs a user gesture to unlock (`_lssUnlockAnnouncerAudio`).

#### Combat HUD feedback: shake / damage arrows / enemy bars — `~L59197`
**Jump:** `function updateEnemyHealthBars` (~L59361)
- **Symbols:** `updateScreenShake`, `showDamageIndicator`, `hbarPool`/`initHbarPool`, `updateEnemyHealthBars`
- **⚠** Health-bar LOS raycasts throttled (`HBAR_LOS_INTERVAL` ~15Hz).

### ═══ PART 22 — MAIN LOOP (~59498–60104) ═══

#### `gameLoop` + profiling hooks — `~L59498`
**Jump:** `function gameLoop` (~L59523)
THE per-frame driver: dt/FPS, cinematic tick, dispatch every subsystem update, call `renderFrame`.
- **Symbols:** `window.__prof`, `window.__profOn`, `__pmark`, `gameLoop`
- **⚠** Where hub framerate lives (GPU-bound). Re-wrapped for `?perf=1` panel (~L69037); driven by `renderer.setAnimationLoop` or the bg-tick worker. Many updater calls are typeof-guarded (silent no-op if missing).

### ═══ PART 23 — Audio & music (~60104–68528) ═══

#### Audio engine core — `~L60104`
**Jump:** `const audio` · `function initAudio` (~L60169)
Web Audio graph (master/sfx/reverb buses, convolvers), ambient bed, env-openness probe.
- **Symbols:** `audio`, `generateImpulseResponse`, `initAudio`, `resumeAudio`, `startAmbientBed`, `probeEnvironmentOpenness`
- **⚠** MAJOR forward reference — declared ~L60104 but used ~138× earlier; only works because `initAudio()` + consumers run at bottom-of-file init. Don't move this block.

- **(v36.24) LOADING-SCREEN AUDIO HOLD** (owner: *"let's not start the music or ship sounds until the loading screen is finished"*). **Jump:** `let _loadingAudioHold` / `function _lssAudioHoldEngage` / `function _audioHoldSettling` — all defined immediately below `hideLoadingOverlay` (PART 18), because the overlay is the gate. Console: `window.__audioHold()` → `{held, settling, suppressedSounds, ambientDeferred, mp3Ctx}`.
  - **WHAT WAS AUDIBLE UNDER THE LOADING SCREEN.** `commitLoadout` sets `game.state = 'warmup'` and calls `startAmbientBed()` about **130 lines above** the `hideLoadingOverlay()` in its warmup-promise `.then`. Measured on v36.23 (endless, fresh load, real menu→chip→CONFIRM): CONFIRM at t=2669 ms, overlay up at 2672, **ambient bed spun up at 2889**, and at **2978 the 500 ms `_mp3SyncToState` tick saw `inMenu === false` and cut the welcome theme over to `battle_in_LSS.mp3`** — all with the overlay still up (it came down at 3144). An analyser tapped on `audio.postLimiterGain` read **RMS 0.0021 → 0.0158 across the three 50 ms samples that landed inside that window, with `battle@0.0` playing**. On the hub entries a `bird_chirp` from the world build played under it too.
  - **FIVE GATE SITES, one flag.** ① `playSound` — above `resumeAudio()` on purpose: `resumeAudio` is half ctx-resume and half `musicStart()`, and we want neither here (the ctx is still resumed by the gesture-unlock path and by `initAudio`'s 500 ms `_audioWatchdog`, neither of which is gated). ② `playSpatialSound` — same test at the top, so the occlusion raycasts and panner setup are skipped **and** the drop stays out of `_audioPeekSoundAllowed`'s books, i.e. `__audioStats` / `__audioDrops` keep reporting real load instead of a hold-shaped hole. ③ `startAmbientBed` — sets `_ambientBedDeferred` and returns; `_lssAudioHoldRelease` replays it, so the drone fades in **with** the arena. ④ `musicStart` (generative engine). ⑤ `_mp3SyncToState` (soundtrack engine — the one that actually fired).
  - **⚠ MUSIC USES `_audioHoldSettling()`, NOT the raw flag, and that distinction is load-bearing.** `musicTickFromMain` calls `_mp3SyncToState` **every frame**, so on the first attempt the battle track restarted **17 ms after `hideLoadingOverlay`** and the `setTimeout` in the release was decorative. The settle window (`_AUDIO_HOLD_SETTLE_MS = 260`) exists because the freeflight launch can hide the overlay (warmup promise resolved) and then re-show it a frame later when `_launchSoloAfterCinematic` discovers `game._swPreloading` — without it that flap plays ~30 ms of a track and cuts it. SFX and the ambient bed deliberately do **not** wait: they belong to the arena that just appeared.
  - **Clean restart, not resume:** engage calls `_mp3Stop()`, which nulls `mp3Music.ctxName`, so the release re-enters `_mp3Play` as a real context switch and the next track starts at 0.0 (verified on the shipped file: `battle@0.0` at hide+307 ms).
  - **NOT held, deliberately:** the gesture unlock / ctx resume (`_lssUnlockAnnouncerAudio`, `initAudio`, `resumeAudio`) — an AudioContext can only be unlocked inside a user gesture, so gating it would trade a 9 s delay for a permanently silent session; UI clicks via `_AUDIO_HOLD_PASS` (the recipe bank has no `ui_click`, so the VR pointer borrows `mode_switch` — see `_xrPointerActivate` — and the VR menus stay live over the overlay); continuous handle voices (`_swStartDragHiss`, `_startRailgunChargeSound`, shield hums), which all need flight input that does not exist yet.
  - **⚠ THE ANNOUNCER IS NOT HELD, AND IT IS THE ONE THING STILL AUDIBLE OVER THE LOADING SCREEN.** `announcerSay('Welcome aboard, VORTEX…')` fires from the CONFIRM click **one millisecond before `showLoadingOverlay`**, and `announcerBackend._playViaWebAudio` routes it into the same context, so the tap sees it (RMS 0.048–0.084). It is the acknowledgement of the click, not music and not a ship sound, so it was left alone. **Proof it is the only remainder:** an otherwise identical freeflight run with `announcerBackend.playText` stubbed out read **maxRMS exactly 0 and zero mp3 playback for the entire overlay window**. If the owner wants it gone too, wrap `announcerSay`'s body in the same `_loadingAudioHold` test — one line.
  - **v36.24 verified timeline** (fresh page load each, real menu→chip→CONFIRM): endless overlay 435 ms → ambient at hide+0, music at hide+290; race 554 ms → hide+0 / hide+268; elimination 511 ms → hide+0 / hide+284; assault 498 ms → hide+0 / hide+284; freeflight/exhibition 1255 ms (one `bird_chirp` suppressed); campaign hub 1264 ms (one suppressed). **Zero start events and zero audible samples under the overlay in all six; zero console errors.** Countdown pings + `round_start` unaffected (`sonar_ping_1/2/3` then `round_start`, all post-hide).

#### Sound synth primitives + Sound Lab + default library (huge data) — `~L60694`
**Jump:** `const DEFAULT_SOUND_LIBRARY` (~L60841)
- **Symbols:** `triChord`, `playNoiseBurst`, `DEFAULT_SOUND_LIBRARY` (~5300-line blob), `_playSoundFromLabRecipe`, `importSoundLabLibrary`, `_startRailgunChargeSound`
- **⚠** Largest single literal in the file; recipes overridable via localStorage.

#### Sound gating: voice budget + playSound — `~L66519`
**Jump:** `function playSound` (~L66695)
- **Symbols:** `_SOUND_MIN_GAP`, `_AUDIO_VOICE_BUDGET`, `_audioReserveSound`, `playSound`, `_audioSpatialDepth`, `__audioStats`, `__audioDrops`
- **⚠** Under stress drops `_AUDIO_SKIPPABLE` first; tighter gaps on VR/Quest.
- **⚠ (v35.47) `playSound` IS NOT the local-player path.** Its comment used to claim "remote ships and AI all route through playSpatialSound", so it hardcoded `own = true`. False: `_playSpatialSoundHRTF` **ends with `playSound(type)`**, as do two fallback branches and `_playSpatialSound51` — every remote/AI sound re-enters `playSound`. It was therefore booking all of them as your own fire, which (a) handed them the `_AUDIO_OWN_FIRE` exemption that exists to protect YOUR gun and (b) stamped the shared `_lastSoundTime[type]`, so another ship firing the same weapon inside its min-gap silenced yours. Ownership is now derived from **`_audioSpatialDepth`**, incremented in `playSpatialSound` around the dispatch (try/finally — a leaked depth marks every later local sound as remote).
- **⚠ (v35.47)** `_lastSoundTime` is keyed **per origin** (`type` vs `type+' r'`). The gap is a per-emitter rate limit; one shared stamp let any emitter mute any other. It is still checked *before* the own-fire exemption, so a shared key could never be rescued by it.
- **⚠ The voice budget counts sound STARTS in a 0.25 s window, not live nodes.** One start is typically ~6 oscillators (`triChord` = 2 osc × 3 freqs), so budget 16 measured **76 concurrent sources** on desktop. It is a rate limiter; do not read it as concurrency. Lean mode (all mobile) halves this by skipping chorus + reverb sends.
- **(v35.49) THE DROP GATING IS OFF BY DEFAULT.** `__audioGate('off'|'soft'|'full')`, default `off`. It was added chasing "crackling in heavy fights" (v31.09), but v35.47 measurement did not support that: 45 s of sustained fire peaked at **76 concurrent sources with zero long tasks, zero clipped samples, no leak**, against a budget nominally capping at 16. And the min-gaps were never binding on weapons anyway — minigun fires every 50 ms against a 40 ms gap, hitscan every 250 ms against 45 ms — so the only way a weapon gap ever bit was the v35.47 shared-stamp bug it was masking. Bookkeeping still runs in every mode so `__audioStats` reports real load with gating disabled. **⚠ Verified on desktop only; `__audioGate('full')` is the revert if a low-end phone underruns.**
- **⚠ (v35.49)** `_audioStressed` no longer feeds `_audioLeanMode` unless gating is enabled. It comes from the same unsupported sliding-window signal and doesn't drop sounds, it THINS them (no chorus = half the oscillators, 2 of 3 chord voices, no reverb sends, noise clamped to 0.10 s). Device tiers — mobile, Quest, potato — are capability facts and still force lean regardless, so phone CPU is unchanged by this.
- **⚠ (v35.49)** The per-origin gap key is `type + '@r'`. It was briefly `'\x00r'` in the peek and `' r'` in the reserve — two different keys, so remote gap stamps were never found (and the NUL made the file read as binary to grep). Keep both sites on one literal.
- **⚠ (v35.56) Lean mode keeps the MOST AUDIBLE layer of each kind, not the first.** Keeping the first is how PUNCTURE's railgun went silent on phones: `fire_railgun` layer 0 is a 74/35/82 Hz sub-bass body ramping to 20–30 Hz, and the dropped layer 1 carries the 4000/2063/354 Hz crack — a phone speaker reproduces almost nothing under ~300 Hz, so mobile kept the only layer it physically cannot play (and `triChord`'s own lean then sliced `[74,35,82]` to `[74,35]`). The blaster survived by luck of having one layer containing 630 Hz. Audibility = highest frequency present (small speakers roll off at the *bottom*), volume breaks ties, noise scores broadband. The survivor is levelled toward the loudest of its kind, capped at 1.8×, since it was mixed to sit alongside what was just dropped. Only 5 multi-layer kinds across the 16 lean types are affected.
- **(v35.56) Settings → Spatial Audio → Audio buffer** — Smallest (default) / 0.04 / 0.08 / 0.18, persisted to `lss_audio_latency`, **applies on reload** (an AudioContext's latency is fixed at construction). **⚠ Deliberately NOT in `saveSettings`:** `initAudio` reads that key directly at boot, long before settings load. Same key `__audioLatency()` writes. Bigger buffer = fewer underruns but more delay, and once it exceeds the gap between shots they collapse into one another (see v35.52).
- **⚠ (v35.69) RECIPES ARE PRE-RENDERED. `_playSoundFromLabRecipe` plays a baked `AudioBuffer` first and only falls through to live synthesis if there isn't one.** Every shot used to build a fresh node graph on the main thread — measured **18 nodes for `fire_projectile`, 24 for `fire_railgun`, 57 for `explosion`**, per shot. That allocation churn is what fed the GC pauses that starved the audio thread; the synthesis *maths* was never the cost. Baked playback is 2 nodes flat (source + gain), **83–97% fewer**, and the game's own `adbg` readout went `nodes/s 44 → 4`.
  - `_bakeCtx` / `_bakeDest` are the whole mechanism: when set, `triChord` / `playNoiseBurst` / `_runLabNoiseLayer` build into an `OfflineAudioContext` instead of the live bus. **Deliberately the same scheduler** (`_playRecipeLayers`) — a separate bake renderer would be a second implementation of the recipe format, and it would drift.
  - **⚠ The buffer is DRY.** Reverb sends are skipped during bake and applied at playback, so spatial panning and the environment crossfade still work per shot. Bake reverb in and you get it twice, welded to one position.
  - **⚠ Take count is decided from the RENDERED length, never the declared one.** Deciding from `dur` put `fire_projectile`, `fire_railgun`, `explosion` and `dash` in the "too long, leave live" bucket — the most-fired sounds in the game, exactly backwards. Recipes declare a generous `dur` and decay long before it. Pass 1 renders one take of everything and trims the dead tail; pass 2 adds extras (+2 under 0.45 s, +1 under 1.10 s) from the *trimmed* duration.
  - Budget history worth not repeating: naive "all 66 × 3 takes" = **45.6 MB / 14 s**. Batching (8 in flight) + adaptive takes + tail-trim = **17.7 MB / ~0.7–1.8 s**, all 66 baked. Bake fires 400 ms after `audio.initialized` and again on `importSoundLabLibrary`; playback falls back to live throughout, so nothing is ever silent for want of a buffer.
  - Silent takes are rejected by peak check — a `chance` roll can thin a recipe, and baking that silence in would play it one time in three (cf. v35.51 / v35.56, this file's history of sounds quietly vanishing).
  - **Continuous voices are NOT recipes** and are untouched: `_swStartDragHiss`, `_startRailgunChargeSound`, the shield hums. They are handle-based looping voices and never went through `_playSoundFromLabRecipe`.
  - Hooks: `__sndBake(0|1)` A/B against live, `__sndBakeStats()`, `__sndRebake()`, `__sndNodes()` (the node-count A/B above), `__sndCompare(type)` (peak/RMS of baked takes vs a fresh render).
- **⚠ (v35.99) THE BAKE'S ONE-TAKE STACKING WAS THE COMBAT CRACKLE.** Owner: "crackling during combat on PC, a regress since the last sound change." Measured with an AudioWorklet tap on the final chain (`postLimiterGain` out + `masterGain` out + shaper input) through a scripted 36 s endless combat scene: v35.69 baked playback drove the pre-compressor SFX sum to **11.9× full scale** (live synthesis, same scene: 6.9×), pinned the master soft-clipper at its 0.95 ceiling **41,325 samples vs 6,844 live**, and pushed 735 samples past the shaper's linear input range — sustained flat-topping, which is what the crackle IS. Zero output discontinuities and zero long tasks in every run: not clicks, not underruns.
  - **Root cause:** `_audioBakeExtraTakes` sizes takes from trimmed length only, which left explosion, fire_projectile, fire_railgun, fire_salvo, rocket_salvo, tracker_rockets and death at exactly **one take** — byte-identical waveforms overlapping in dense fights sum coherently (+6 dB per doubling) where live synthesis' fresh per-shot jitter summed like uncorrelated noise. Per-shot fidelity was never wrong (`__sndCompare` clean); only the overlap statistics were.
  - **Fixes (zero extra nodes, lean path identical):** `_AUDIO_BAKE_HOT` floors 16 combat types at 3 takes (+4.7 MB → 22.4 MB, 146 takes, bake ~1.9 s); `_playBakedSound` never plays the same take twice in a row, flips polarity 50/50 (same-instant same-take overlap now tends toward cancellation — 4×-explosion synchronous bursts: fixed bake peaks 2.5–4.2 vs live 4.2–6.2, live's phase-0 oscillator onsets actually stack WORSE), and rolls gain 0.8–1.0 (mean −0.9 dB off dense stacks); `_audioBakeTake` applies 2 ms / 6 ms raised-cosine edge fades to every take.
  - **The fades also killed a real click:** `laser_core_beam` and `stun_core_zap` exceed the 3.0 s `maxDur` cap, so their renders ended mid-decay at sample values 0.131 / 0.101 — an audible step to silence on EVERY play. Worst tail across all 146 takes is now 0.0000.
  - **Fixed-scene numbers:** peakM 11.9 → 5.3, shaper-overrange samples 735 → 0, ceiling-pinning −35% (26.9 k, in a longer battle than the baseline's). Baked playback still exactly 2 nodes under `__audioForceLean(1)`.
  - New hooks: `__sndTails(n)` (per-take tail/head/discontinuity audit of the baked table), `__sndPlay(type, n)` (synchronous n-burst for stack tests; hidden tabs clamp timers so same-tick is the only honest burst), `__audioForceLean(1|0|null)` (lean override — potato tier is gone and `_audioIsMobileDevice()` can't be faked from DevTools).
  - **Caveats:** measured in the hidden-pane sandbox (30 Hz worker loop, idle main thread) — the signal-path numbers are solid but underrun-class crackle cannot reproduce there, so if the owner still hears crackle at v35.99 correlate it with frame drops next; desktop keeps SFX 1.5 so the very densest same-instant onsets still brush the ceiling briefly (pre-existing loudness architecture, deliberately untouched — B pinned the ceiling too); an active `lss_sound_recipes` localStorage override (66 recipes) was present during all measurement and the bake covers it, so ship-default recipes were NOT what was measured.
- **⚠ (v35.51) A `chance` roll may THIN a sound, never silence it.** `_playSoundFromLabRecipe` rolled per layer inline, so a recipe whose layers all lost produced nothing. Rolls are pre-computed now and the first layer is forced if every one lost. Audit: 4 of 66 recipes use `chance` (explosion, monster_zap, bird_chirp, water_bloop); only `monster_zap` could roll fully silent, at 10.5%. **No weapon fire uses `chance`** — so this was never the mobile dropout, but a sound that sometimes doesn't happen isn't worth keeping.
- **(v35.51) On-screen audio debug — `?adbg=1`** (or `__audioDebug(true)`). Top-left readout, 4 Hz: `snd/s` (requests reaching synthesis), `nodes/s` (oscillators + buffer sources actually created), ctx state, output latency, gate mode, lean/mobile flags, starts-in-window vs budget, and gap/budget drop counts. Exists because the dropout reproduces only on phones: **`snd/s` vs the player's real fire rate is the number that splits the diagnosis** — matching means the sound is being made and the loss is downstream (audio-thread underrun / context interruption); far below means something refuses earlier, and the drop counters name it. Desktop baseline while firing a 0.25 s-fireRate blaster: `snd/s 3.9, nodes/s 23`.
- **(v35.47) On-device diagnostics** — `__audioStats()` (ctx state, latency, starts-in-window, budget, lean/stress/mobile flags, compressor reduction) and `__audioDrops(true)` / `__audioDrops()` (per-type tally of played vs dropped-by-gap vs dropped-by-budget). Added because the dropout reports come from phones, which can't be profiled from a desktop session.

#### Spatial audio (HRTF + 5.1 VBAP) — `~L66708`
**Jump:** `function playSpatialSound` (~L67035)
- **Symbols:** `_occlusionRaycastAllowed`, `_playSpatialSoundHRTF`, `_vbap51`, `_playSpatialSound51`, `playSpatialSound`
- **⚠** Occlusion raycasts budgeted (`_OCCL_RAYCAST_BUDGET=3`); pooled panner nodes.

#### Procedural music engine — `~L67060`
**Jump:** `const music = {` (~L67073)
- **Symbols:** `music`, `_musicSynthDrum`/`Bass`/`Pad`/`Lead`, `MUSIC_STYLES`, `_musicScheduleBeat`/`_musicTick`, `musicStart`/`musicStop`, `musicSyncToGameState`, `musicTickFromMain`
- **⚠** `musicTickFromMain(dt)` pumped from the game loop.
- **⚠ (v36.24)** Both engines' start sites are gated by the loading-screen audio hold: `musicStart` and `_mp3SyncToState` early-return on `_audioHoldSettling()`. **`musicSyncToGameState` / `musicSetPattern` are deliberately NOT gated** — pattern state may keep tracking the game (`commitLoadout` sets `'warmup'`, the round system sets `'combat'`), it just must not reach the graph; the release then re-runs `musicSyncToGameState()` + `musicStart()` so the band comes in on the correct pattern. Full contract in PART 23's *Audio engine core* → LOADING-SCREEN AUDIO HOLD.

### ═══ PART 24 — Hit markers, scoreboard, death cam (~68528–68910) ═══

#### Hit/kill markers + audio-hook monkeypatches — `~L68528`
**Jump:** `const _origFireWeapon` (~L68544)
Hitmarker/killmarker UI + wrapping core combat fns to layer in sound/announcer/music.
- **Symbols:** `showHitMarker`, `showKillMarker`, `_origFireWeapon`/`_origPlayerDie`/`_origActivateAbility`/… (functions reassigned to wrappers)
- **⚠** Reassignment pattern — grabs original fn, overwrites same name to add audio. Order matters; `playerDie` wrapped again by death cam.

#### Scoreboard + death cam — `~L68652`
**Jump:** `const deathCam` (~L68774)
- **Symbols:** `scoreboardDiv`, `updateScoreboard`, `deathCam`, `startDeathCam`, `updateDeathCam`, `_origPlayerDie2`
- **⚠** Wraps `playerDie`/`respawnPlayer` a second time (`_origPlayerDie2`).

### ═══ PART 25 — Init, exports & bootstrap (~68910–70475) ═══

#### Bottom-of-file initialization + loop start + bg-tick worker — `~L68910`
**Jump:** `renderer.setAnimationLoop(gameLoop)` (~L69115)
The real boot: `initAudio()`/`loadSettings()`, build UI, wire audio-unlock/wakelock/intro gestures, optional `?perf=1` profiler, start loop, hidden-tab worker.
- **Symbols:** `initAudio()`/`loadSettings()`, `buildShipSelect()`/`buildSettingsPage()`, `_lssUnlockAnnouncerAudio`, perf-panel wrap IIFE (~L69037), `renderer.setAnimationLoop(gameLoop)`, `visibilitychange` handler (~L69145)
- **⚠** Init order is load-bearing — the many forward refs (esp. `const audio`) resolve only because this runs last. BG worker drives `gameLoop` at 30Hz while tab hidden (skipped in XR).
- **⚠** Every resume re-arm in the `visibilitychange` handler must be **null-first**: `setAnimationLoop(null)` then `setAnimationLoop(gameLoop)`. Three's `WebGLAnimation.start()` silently no-ops while its internal `isAnimating` flag is stuck true after a hidden phase — a bare `setAnimationLoop(gameLoop)` leaves `game.time` frozen with rAF running (fixed v35.80). `_xrEnsureAnimationLoop` (~L14939) still uses the bare re-arm on the XR path.

#### `window.*` exports + perf snapshot — `~L69180`
**Jump:** `window.lssPerfSnapshot` (~L69196)
- **Symbols:** `window.__real_joinRoom`/`__real_startSolo`/`__real_startTest`/`__real_discordSignin`, `window.__lssReplayPending()`, `window.game`/`player`/`scene`/`camera`/`renderer`/`input`/`audio` (~L69189–69195), `window.lssPerfSnapshot` (~L69196)
- **⚠** `window.lssPerfSnapshot()` is the prime GPU-bound-hub diagnostic (XR tiers, render scale, BCS slots, effect/particle/projectile/light counts, `renderer.info` draws/tris).

#### Engine bootstrap (end of `_bootLSS`) — `~L70463`
**Jump:** `if (window.LSS_ENGINE_READY)` (~L70467)
Closes `_bootLSS()` (~L70463) and invokes it — now if `window.LSS_ENGINE_READY`, else on the `lss-engine-ready` event.

### ═══ PART 26 — Google Maps real-world levels (~69261–70446) ═══

#### `lssGmaps` real-world 3D-tiles integration — `~L69261`
**Jump:** `const _lssGmaps = {` · `function _lssGmapsBuildLevel` (~L69395) · `function _lssGmapsTick` (~L69726)
Optional: load Google photorealistic tiles as a playable level, collide against tile leaves, terrain-follow, lat/lng↔world, race maps between coords.
- **Symbols:** `_lssGmaps`, `_lssGmapsLoadModule`, `_lssGmapsBuildLevel`, `_lssGmapsCollideEntity`, `_lssGmapsTick`, `_lssGmapsAttachCity`, `_buildRaceCustomMap`, `_raceLatLngToWorldXZ`; `window.lssGmaps` (~L70446)
- **⚠** Needs a user-supplied API key (localStorage, prompt modal); `_lssGmapsTick` raycasts on a per-frame budget.

---

## Console tuner index (`window.*` live knobs)

Callable from the browser console. This is a representative set — there are **~60 distinct `window.__*` hooks**; grep `window\.__` for the complete list, and call `window.lssPerfSnapshot()` for the live perf readout.

- **Core handles:** `game`, `player`, `scene`, `camera`, `renderer`, `input`, `audio`
- **Perf / diagnostics:** `lssPerfSnapshot()`, `__prof` / `__profOn`, `__reflBench`, `__foliageProf`, `__fxPools`, `__v8GPU`, `?perf=1` URL param
- **Loading contract (v36.26–40):** `__prebake()` (launch prebake report), `__swapReport()` (last world-swap traverse), `__rrStage()` (last BETWEEN-ROUNDS staged rebuild — phase ms + the `build` three-way split of `buildRoomGraphLevel`/`spawnDynamicObjects`/`spawnOrganics`), `__rrStageOff = 1` (A/B kill switch, restores the one-frame path), `__entPrime()` (entity prime report + primed key list), `__entPrimeOff = 1` (A/B kill switch, set before CONFIRM), `__monPrime()` (monster prime report), `__monPrimeOff = 1` (A/B kill switch), `__dbg.models()` (which ship/hoard GLBs are parsed right now), `__dbg.waveRot(n)` (read/set `_campShipRot` — the only way to stage a deliberately COLD garrison), `__cavern.enter(i)` / `__dbg.returnHub()`
- **Sky / env:** `setSky`, `applyMapPreset`, `MAP_PRESETS`, `setShowcaseMode`, `promoteMeshToPBR`, `__skyDome`, `__domeHide`, `__sunApply`, `__hubLight`, `__exposure`, `__grade`, `__aerial`
- **Water:** `__water`, `__waterDisp`, `__refl`, `__waterHorizon`, `__reflBench`, `__reflProbe`, `__pwaterApply`, `__pw`, `__crestTest`, `__splashN`
  - reflection cadence knobs live on `__water`: `reflGapMin` (2), `reflGapMax` (3), `reflMove` (6u), `reflTurn` (3e-5 ≈ 1°); `reflShipMax` (2500), `reflShip`, `reflHideFX`
- **Terrain:** `__terrainDetail`, `__terrainAO`, `__terrainAOU`, `__terrainSat`, `__smoothTerrain`, `__clipTest`, `__clipDetail`, **`__clipSeam()`** (v36.43 — the eyeball-free clipmap check: per-LOD-seam height disagreement, **must be 0**, plus the geomorph's per-frame travel vs the v36.42 per-snap jump), **`__clipMorph(0..1)`** / **`__clipSkirt(0..1)`** (v36.43 — the two A/B knobs this index has always listed; before v36.43 they existed only as the raw `__clipMorphU` / `__clipSkirtU` uniform objects)
- **Critters:** `__birds`, `__fish`
- **PostFX / cameras:** `setCineFXEnabled`, `tunePostFX`, `roundKillCam`, `cinemaCam`
- **Audio:** `announcer`, `announcerSay`, `announce`, `ANN`, `announceMultikill`, `v8DuckAmbient`
- **VR (headset-less):** `__vrPtr` (paint / hits / aim / aimAt / click / hover / show / hide), `__xrStick.push(x,y)`, `__lockRingProbe([degs], dist)` (v36.41 — TRACKER lock-ring angular error, old vs fixed, from a flat screen)
- **Feedback:** `triggerHitFeedback`, `hitFX`, `Overlays`
- **Lobby / auth:** `LSS_AUTH`, `_lobbySendInvite`, `_lobbyJoinPlayer`
- **Levels:** `lssGmaps` (setKey / attachCity / location / …)

---

*Generated from a full three-band read of `index.html` (v34.62). Line numbers are approximate hints — jump by anchor. Update entries when subsystems move; keep it coarse.*

## v39.46 — the ghost fleet was a RACE, and losing it cost every hull's shaders

`warmupCombatShaders` builds a GHOST FLEET (7 loadouts x 2 team colours = 14 hulls) offscreen so
`renderer.compile()` links every ship program before combat. It reads `shipModelCache.loaded` —
which `preloadShipModels()` fills ASYNCHRONOUSLY — and **nothing waited for it**. If the GLBs had
not landed yet, `loadedKeys` was `[]`, the whole fleet was skipped in silence, and not one hull
program got pre-compiled. On ANGLE every ship that then appeared in the match paid a synchronous
GLSL->HLSL D3DCompile on the frame that first drew it.

Measured both outcomes on the SAME build minutes apart (`window.__coldSeen`, below):

| HTTP cache | ghost fleet | cold programs in combat |
|---|---|---|
| warm | 14 hulls / 270 mats | 0 |
| cold | **0 hulls** | **28** (incl. `Blaster_CP_Graphite`, a bot hull, mid-fight) |

Fix: `await shipModelCache.ready` before building the fleet — free when the models are already in,
and gated on `!_liteWarm` because small devices build no fleet and must not pay the wait.
Verified by forcing every GLB to an uncacheable URL: 14 hulls, 196 transparent programs, 0 cold.

This is the answer to "so many hitches" in a Chrome incognito window (empty cache = always loses
the race), why the same build felt different in every browser, and why cold-cache sessions hitched
where warm ones did not. It was never browser-specific — it was load-order luck.

## v39.46 — cloak pre-warm moved onto the ghost fleet

`transparent` is in three's program cache key, so the opaque->transparent flip on cloak forks a new
program per hull material. v39.40 pre-warmed only the PLAYER's hull, once per session; bots cloak
too, each hull is a separate material instance, and a bot can spawn in any of the seven at any time
— so `Puncture_CP_ScreenGlass` was caught linking at t=100 s of a match flown in a Vortex.
Now `_warmCloakForRoot(root)` runs over the ghost fleet during warmup (the only moment all seven
hulls coexist): **196 transparent programs, on the loading screen**. `_warmCloakVariantOnce()` still
runs live, one group per frame, but is now a cache hit rather than a compile.

## v39.44-46 — the cold-program watcher (`window.__coldSeen`, `?pbhud`)

The prebake snapshots every linked program's `cacheKey` into `window.__warmProgKeys`. A 1 Hz poll
(5 min, then it stops) diffs `renderer.info.programs` against it and `console.warn`s each newcomer
by name with its timestamp — **every cold link IS a hitch on ANGLE**, so this turns "lots of
hitches" into a named list. `?pbhud` shows a running tally box plus `ghost <hulls>h/<progs>p`.
`window.__coldProgs()` returns the same diff on demand. A healthy session reads **cold 0**.

## v39.47 — the charge glow outlived the ship

`_blasterChargeGlow` builds its tubes in the **SCENE, not on the ship** (world-space, so the muzzle
markers' export rotation can't skew them). The only code that hides them is the charge tick inside
`updateAbilities` — and the game loop runs `if (deathCam.active) { updateDeathCam } else {
updateWeapon; updateAbilities }`. Die mid-charge and the tick never runs again, so the lights stayed
lit at the death spot for the rest of the round. Owner: "blaster's charged shot was charging while i
got killed and the charging lights didn't get cleared off the map".

**This is the same hole v31.16b fixed for the railgun TONE** — its comment even spells out the
cause — but the glow was added later (v37.68/v37.95) and never got the same treatment. Puncture
drives the identical glow via `railgunCharge`, so one fix covers both hulls.

Two parts: `playerDie` clears it outright beside the audio kill (deterministic, no lingering
frame), and `_blasterChargeGlow` now stamps `player._bcgTTL = 0.2` which `updateWorldEffects`
counts down — that function was already moved ahead of the deathCam branch for this same class of
bug (a bot's fire freezing on screen), so it is the one tick guaranteed to keep running. Any future
branch that stops the charge tick can no longer strand the tubes.

## v39.48 — Mega Tracker Rockets home on the SHIP, not the bearing

`salvoGuided` lerped each missile's velocity toward `getPlayerAimForward()` — a **direction**, not a
target. A missile abeam of you that steers onto a bearing flies PARALLEL to the crosshair and never
converges, so a volley fired off-axis sailed past everything. Owner: "if i am not looking at a ship,
the hoard of missiles will just go where i look and not hit a ship... but then i swing around and
it follows".

`_megaTrackerAimTarget()` resolves the aim to an actual entity (10 Hz cache, like the AI Assist
picker) and the missiles steer at **its position, measured from the missile** — that is the whole
difference between converging and running alongside. Picked by SMALLEST ANGLE TO THE AIM RAY, never
by distance, so a ship dead ahead always beats a nearer one off to the side. Two cones: ~35 deg
"pointing at it" (turn 8.0) and ~70 deg "near where I'm looking" (turn 5.0); outside both, the old
bearing-steer is still the fallback. No LOS test — the player is aiming, and missiles fly around
corners. Entities and monsters both, so leviathans are valid targets.

A/B measured in the pane, both volleys fired 45 deg off a bot, same speed:

| | bearing-only (old) | with acquisition (new) |
|---|---|---|
| distance to target | 578 -> **1059** (diverging) | 1292 -> **749** (converging) |
| velocity alignment | 0.96 -> **0.29** | 0.31 -> **0.93** |
| missiles alive | 39 -> 39 (nothing lands) | 38 -> **12** (consumed on impact) |

Speed 525 -> **360** (owner asked -15%, flew it, asked slower again). ⚠ **Speed and lifetime move
together**: `Projectile.lifetime` is 5 s, so cutting speed alone silently cuts the swarm's REACH by
the same fraction. Lifetime goes to 6.5 s, holding 2340 u against the original 2625 u. Both live on
`window.__mtr = { speed, life, tight, wide, turnTight, turnWide, range }` for tuning by feel.

## v39.49 — the supersample moved into the scene target, and the hitch lanes got their warms

**Canvas vs scene.** MEGA/ULTRA used to set the CANVAS pixel ratio (3x = 4608x1917) while the adaptive
scale had already dropped the scene target to native: every frame still paid a 4x-MSAA resolve +
composite + compositor copy at 8.8 MP for nothing. A/B on one map, same scene size: native canvas
103 fps / 0.7 dropped frames a second vs 3x canvas 92 fps / 8.5 a second. Now desktop ULTRA/MEGA keep
a native canvas (`applyQualityPreset`, boot DPR block, `_lssDynResBase`); `postFX.rtScene` is
allocated ONCE at the tier max (`_getBloomRTSize` / `_lssTierSuper`, 16 MP cap) and each frame
renders into a VIEWPORT of it sized by `_ssDyn.scale` (`_lssSceneActive`, applied in `renderPostFX`);
`brightMat` / `compositeMat` sample the live sub-rectangle through `uSceneScale` / `uSceneMax`
(the `SCENE(uv)` macro). A scale step is free. Bloom RTs are half the BASE size. Read
`window.__postFXInfo().active` = [w, h, 'scale', s, 'hz', hz].

**The sampler** (`_lssSupersampleTick`) only samples `playing` frames (the picker's 6 Hz frames used
to read as a GPU 24x over budget and shed the supersample in five render-target reallocations = five
hitches on the picker), estimates the refresh from the 5th percentile of a 240-frame window
(the old minimum snapped a 144 Hz panel to 165 and killed the supersample for the session), and
starts at scale 0, creeping up.

**Hitch lanes closed** (each measured before/after in the pane, `window.__lssProbe` in the owner's
Chrome): ADS-overlay light-layer parity (all lights `layers.enable(5)` - the layer-5 camera keyed a
second program per hull material); `_warmReflLiftForRoot` pre-compiles the Reflector's
USE_EMISSIVEMAP hull variants; `_prebakeGpuPrime` steps the ripple/bird/fish GPGPU sims and
compiles the flock meshes; prebake phase C3 loads + draws the overworld carrier and one hull per
loadout INSIDE the sun shadow frustum (shadow-depth variants); `_hubCityBuild._noiseImg` caches the
1024^2 albedo noise (300 ms -> ~10 ms per satellite); cluster rocks skip `_buildMesh`
(`{skipMesh:true}`, `_leanChild`, RNG draws burned); `updateSandwichStream` is time-budgeted with
deferred ceilings while playing (`window.__swBuildMs`); shore/far masks and the critter field bake
as row jobs (`_swRippleMaskJobTick`, `_critterTerrainJobTick`); peer shots / hub traffic bolts skip
the 117k-tri hull raycast (`isNetwork` / `_cheapHit`); monster trickle defers while playing;
`_clipBakeEdge` inclusive skips; hit/kill markers restart via WAAPI (`_markerFlash`).
Also fixed: `_shipsVariant()` chose the lean MOBILE hull set on desktop since v39.34; the
`hub:ripple` profiler mark (clipmap + streamer + water + ripple) is now `hub:stream+water`.

**Open:** city arrival still has one ~280 ms CPU frame outside gameLoop (fleet + carrier spawn);
the first city of a session links the fleet shield shader cold; "tower" is GPU-bound at 103 fps
on the dev laptop at native resolution.

## v39.49 (live piloting, same day) — the clone trap, the two-pass split, shell row jobs, sub-native

Found with the owner flying in Chrome while `window.__lssProbe` + an owner-tracking program watcher ran
in their tab (see the memory notes for the method):

- **`Material.clone()` does not copy `onBeforeCompile` / `customProgramCacheKey`.** Every hull
  material carries the skin hook (`_skinPatchHueShader`, key `lssSkinHue|...`), so a warm that
  compiles a CLONE keys a program family the live material never uses. The cloak warm had been doing
  that since v39.40; the owner's first cloak per hull linked 4 programs cold (2.3 s). `_warmCloakForRoot`
  and `_warmReflLiftForRoot` now flip the REAL materials in place, compile with rtScene bound, restore.
- **three r165 draws a transparent DoubleSide material in two single-sided passes** (`side = BackSide`
  then `FrontSide`, `needsUpdate` each) = two programs; a `compile()` of the DoubleSide state links a
  third the draw never uses. Warms compile both sides (`_warmCloakForRoot`, `_ghostPinWarm`).
- The countdown's `_warmCloakVariantOnce` reaches the player's ship before its hull texture is assigned
  (`mapUv` is a key term) -> a second warm of `player.mesh` in the last 2 s of the countdown
  (`game._cloakLateWarm`). Simulated cloak after all three: 0 new programs.
- **Shell row jobs** (`_swShellJobNew` / `_swShellJobRows` / `_swShellJobFinish`; `_swBuildShell` is the
  synchronous wrapper; `_swShellJobFlush` finishes an in-flight job when a synchronous state takes over):
  `updateSandwichStream` builds one chunk at a time within `window.__swBuildMs` (2.5 ms) in play AND in the
  countdown drain. Procedural arenas rebuild their ring every round and used to fill it in play at one
  12-15 ms shell a frame (60-70 fps for ~10 s). Now `hub:stream` max ~3 ms.
- Ripple: spawn-jump mask bakes are fast jobs (4 ms budget) instead of a 90 ms sync frame; the crest
  readback (`readRenderTargetPixelsAsync`) blocks on the command-buffer flush when the GPU queue is deep
  (5 ms avg, 11-23 ms per call after FIGHT) -> adaptive cadence (`__water.crCost` / `crSkip`, doubles to
  32 frames when a call costs > 4 ms); `__water.breakBudget` 500 -> 40 with a 1.5 ms scan cap (skimming
  water used to flood the particle cap: 61-77 fps).
- **Sub-native adaptive scale**: `_ssDyn.scale` may go to `window.__ssMin` (-0.6 = 70% each axis) when
  the frame is 40% over budget (`_lssSceneActive`), creeping back as before. A step is a viewport change.
- Profiler marks split: `hub:clip`, `hub:stream`, `hub:water`, `hub:ripple`.
- Program-key decoding for the next hunt: `cacheKey.split(',')` index 4 = colour space, 51/52 = boolean
  masks (52: bit0 fog, 1 useFog, 10 doubleSided, 11 flipSided, 16 opaque), 14 = mapUv, 54 = custom key.
- Still open: between-round picker stutter (`_rrStagedRound` runs `ph.world()` ~45 ms in one frame behind
  the picker), the ~280 ms fleet/carrier spawn frame on first arrival at a satellite city, the owner's
  "sound cutting" (audio engine reported no drops; it tracked GPU-bound 21 ms frame bursts).

## v39.50 — the mirror lifts a cloaked hull; "the sound cuts out" (battery round of the 39.49 session)

- **Round-end 668 ms frame** = the hub water Reflector's `_shipReflOverride` lifting a TRANSPARENT
  (cloaked) hull: `emissiveMap = map` on a transparent DoubleSide material forks USE_EMISSIVEMAP x
  transparent x BackSide/FrontSide — two programs per material that no warm compiles. The lift now
  skips `_mm.transparent` (a 1% reflection is invisible). Diagnosis trick: for every `hull` program
  list [EMISSIVEMAP?, opaque bit, side, mapUv, usedTimes]; the missing combination is the un-warmed state.
- **"The many missiles of Tracker's mega core make the sound cut out"** = the Web Audio render thread
  STARVING, measured: `audio.ctx.getOutputTimestamp()` gives (performanceTime, contextTime); their
  difference is constant to the millisecond when healthy and jumped 1.9-2.5 s inside 5 s at the volley's
  IMPACTS — every missed quantum went out as silence. Two causes:
  1. gating `'off'` (v35.49) returned from `_audioPeekSoundAllowed` BEFORE the per-type min gap, so the
     explosion fold (70 ms, written to cap simultaneous HRTF panners) never ran: 2138 spatial explosions
     in 338 s, 0 folded; a volley landing 40 missiles in a second put 40 HRTF panners + convolver sends on
     the thread at once. The explosion fold now runs in every gate mode (budget gating stays off).
  2. no real load signal: `_audioStressed` counts sound STARTS in 0.25 s and never trips. New
     `_audioStarveTick` (per frame from `_audioSpatialFrame`) watches the timestamp pair and flips
     `_audioStarved` for 3 s after any > 20 ms jump -> `_audioLeanMode()` true (equalpower panners, no
     reverb sends, thinner recipes, 1.2 s panner release) + a 120 ms explosion gap.
  Live: `window.__audioStarve()` (events / lostMs / starved), `__audioStarve(false)` for an A/B,
  `__audioStats()` carries `starved` / `starveEvents` / `starveLostMs`; `__audioDrops(true)` then
  `__audioDrops()` = plays and folds by type. This Chrome has no `AudioContext.renderCapacity`.
- Still open: two unnamed programs (`onBeforeCompile` materials, transparent BackSide) link during the
  countdown of some loadouts (TRACKER, VORTEX) — behind the countdown, not felt.
- Shipped as **39.50** because `lss.js?v=<build>` is the only cache-buster: a redeploy under the same
  build number leaves every browser (and the CDN) on the old lss.js. Bump LSS_BUILD for EVERY deploy.

## v39.51 — the sub-native scale was a ratchet

`_lssSupersampleTick`: measured at 141 fps on the 144 Hz panel with the scene parked at the -0.6 floor.
Every shed doubled the hold (to 30 s) and the backoff never reset, so a few explosion bursts walked the
scale to the floor for the rest of the fight; a 10% overage at 0.1 stepped through native to -0.1. Now a
shed above native stops at native (exponential hold kept, reset at the cap); below native only the
40%-over rule sheds, the hold is 1 s and the creep back is 0.1 a tick. `__postFXInfo().active` carries
ema / hold / backoff / steps. Also seen this session: 0.4-1.3 s frames in the COUNTDOWN with an idle main
thread and no cold three program (GPU-process work; GL call counters `window.__glc` in the probe kit
record link / texImage2D / first-draw-of-program per long frame to name it).

## v39.52 — a warm must DRAW (ANGLE compiles a vertex executable per input layout)

Three F8-marked hitches in the owner's 39.51 session: two were cold links of unnamed MeshBasicMaterial
variants in play (1.7 s and 0.4 s - the game's `?pbhud` cold tracker stops itself after 5 minutes, so it
never named them; the probe kit's per-frame program watcher does); the third was a 2.0 s frame with the
main thread IDLE, no link, no upload, no new three program, in a frame with twice the usual draws. The
ANGLE D3D11 backend compiles a vertex executable per vertex INPUT LAYOUT at the first draw that uses it;
the hulls are quantized (Int16n positions/normals, Uint16n uvs on 14 of 19 meshes, Float32 on 5), so a
program that was only ever `renderer.compile()`d (the cloak pair, the mirror lift, the ghost seat shell)
meets its real layout in play and pays the 86 KB physical shader through the D3D compiler again, with
nothing on the JS side to see. `_warmDrawRoot(root, rt)` renders the live scene from a camera looking at
the root into an 8x8 corner of rtScene with the flipped state on (same lights / fog / tone mapping /
colour space = the same programs as the frame; hidden pooled hulls shown for the call; shadow maps
frozen); `_warmCloakForRoot`, `_warmReflLiftForRoot` and `_ghostPinWarm` call it after their compiles.
`window.__warmDraws` counts the calls. Status: the layout explanation is the best fit for the idle-thread
stall and is being confirmed with a (program, layout) first-draw tracker in the owner's tab.

## v39.53 — the charge glow linked at the first charge

F8 on 39.52 (probe kit: `renderBufferDirect` wrapper logging the material/object of any draw that grows
`renderer.info.programs`): a 1.4 s frame = the `_blasterChargeGlow` tubes - an 18-vertex open cylinder,
MeshBasic transparent/additive/DoubleSide/fog:false, class colour (Puncture's railgun charge uses the same
helper) - built lazily on the FIRST CHARGE of a match, with `dispose()` on rebuild freeing the two programs
(transparent DoubleSide = BackSide + FrontSide passes; the logger reads `side` 1 during the first pass).
`_warmChargeGlowOnce` (from `_prebakeGpuPrime`) draws one tube with the recipe and retains its material;
the rebuild path retains instead of disposing. `window.__chargeGlowWarm` counts.

## v39.54 — three wishes: muzzle-true Mega Tracker Rockets, double-tap double zoom, Vortex purple fire

- **Mega Tracker Rockets** (opening burst in `activateCore`, per-tick spawn in `updateAbilities`): origin is
  `shipMuzzleWorld(player.mesh, idx)` first (the hull's gunN markers), the painted `_PLAYER_LAUNCHER_FRACS`
  screen fractions only for a hull without markers - those fractions put the pods in the sky above the ship
  in third person. Same precedent as `_drainStaggeredRocketSalvo` / Mega Barrage (v38.05).
- **Double-tap-and-hold zoom** (ADS block in the camera update): the OR'd aim boolean (RMB / gamepad LT /
  touch LT) is edge-tracked in `game._adsTap`; a press shorter than `__zoom.tapMax` (260 ms) followed by a
  press within `__zoom.dblWin` (320 ms) makes that hold zoom to `mMax * __zoom.dblMul` (2.4 -> 4.8x).
  `game._adsMag` springs at the zoom rate and both `_mTot` formulas read it; `_adsLookScale()` scales mouse
  and gamepad look by (2.4 / current) blended with the zoom so 4.8x aims like 2.4x per pixel
  (`__zoom.dblSens = false` disables). Pane-verified: fov 120 -> 39.7 on the double, 71.6 on a plain hold.
- **Vortex on fire**: `core_beam` preset base #9933ff -> #6f14f2, lavender axial core, `displaceAmount`
  0.18 / `softEdge` 0.32 (the beam edge churns), plasma layers hue 0.92 (pink) -> 0.78/0.80 (violet);
  `_spawnClassFireBurst(pos, color, size, life)` gained a life; the Mega Laser tick seeds violet fire
  clouds on the beam surface (`window.__vortexFire`: hz 10, life 1.6 s, size 26, max 22 live, grow 1.0
  via the new `_grow` knob on `explFireCloud`) so the last ones outlive the beam by ~1 s; the primary shot
  tracer is pulled toward #5a00c8 (`shotDeep`), a little wider, with a fire puff at the muzzle and one
  where it lands; hull-hit sparks are purple for Vortex. Taste knobs are live on `window.__vortexFire`.

## v39.55 — the carrier goes around, the clipmap enables in slices, a fleet follows its city's side

- **Carrier** (`_carrierRide` / new `_carrierSteer` before `_carrierFrame`'s rail move): the city roof probe
  was three centre-line rays straight down (null over every street, a tower top only once the hull was on
  it) into a 2.2/0.45 lerp = hard climb, long sag, hard climb. Now a forward corridor the whole beam wide
  (`__carrier.roofAhead` 2400 u) with a decaying running max (`roofFall` 120 u/s), rise/fall rates 1.2/0.3
  and a hard cap `vMax` 180 u/s. `_carrierSteer` (10 Hz) probes a fan of headings around the route's end at
  the hull's own height (`lookAhead` 2600, `turnCost` 500, `yawRate` 0.25 rad/s, `steer:false` to disable),
  re-bases the rail from the current position and yaws toward the clearest heading.
- **Clipmap**: a hub rebuild flips `_clipmap.on` off; when the next frame is a PLAYING frame the whole
  level bake landed in it (`hub:clip` 214 ms in a 292 ms frame). In play the gameLoop now calls
  `_clipEnableSliced` (one level per frame); loading states keep `_clipEnableNow`.
- **City fleets**: `bot.team` was frozen at construction while `player.team` is rewritten every cyberpunk
  round (and on peer-order re-seats), so a captured city's fleet read the player as hostile next round
  ("my own team city ship shooting me when I was defending"). `_owSetPlayerTeam` (every player-team write)
  calls `_owSyncTeams(old, new)` over owned cities (owner, fleet, carrier); `_acquireCombatTarget` resolves
  a city bot's side from `OW.cities[_owCity].owner` live; `_owCityTick` rebuilds instead of reviving a
  fleet on the wrong side; `_owAdopt` adopts only bots on the city's side; `__citiesOwn` kills the garrison.
- Probe findings this session (overworld, MEGA): median GPU time per frame ~7.5 ms (GPU-bound at ~117
  fps); the 60-300 ms idle-main-thread stalls carry no upload, no link, no new layout and no GPU_DISJOINT,
  and their timer queries never resolved - still unexplained (external GPU preemption suspected).

## v39.56 — the ring in the right HUD path; purple as seen

- The champion capture ring (v39.55) was drawn in the LEGACY crosshair layer of `drawCircumpunctHUD`; every
  normal view takes the `_hlDrawHUD` layout path, which returns before that layer, so the owner never saw
  it. It now draws right before `_hudSharedTail` in the layout path, radius max(44, 5.2% of vmin), pane-verified.
- The Vortex beam read BLUE: #aa55ff is 170/85/255 and under additive overdrive (brightness 3.3) the blue
  channel clips first. Base is now #c46cff at brightness 2.3 (axial core #eacfff, strength 0.26); the
  flames, shot tint (`__vortexFire.shotTint`) and puffs use the same red-shifted purple. The class purple is
  what the eye gets after tone mapping and bloom, not what the uniform holds.

## v39.57 — the Shifting Deep for assault and race; endless borrows its dice

- `MAP_DATA.assault_shifting` (procedural 'assault_shifting'): `_lssGenShiftingDeep(base, opts)` grew an
  `opts.champion` room on the spawn axis 0.6 D ahead of side A (the defenders), the way the Causeway's
  champ room fronts spawn_def; the generator now returns `procedural` from opts and passes `terrain`
  through. Dispatch beside the shifting_deep line in `buildRoomGraphLevel`. Assault needs only the team
  tags + the champion flag (`spawnChampionField` reads `sdfRoomData`), and the assault_ prefix is the
  carousel filter. Pane: field landed exactly on the generated champ room.
- `MAP_DATA.race_shifting` + `_lssGenRaceTrack(base)`: seeded axis, a start row of four A/B rooms across
  it, 4-6 `gate: n` rooms on a wandering line (side/height random-walked in bounds), a champion finish,
  tunnels start->gate1->...->finish (r 240/260), biome roulette. The ring helpers now key off map DATA:
  `_raceRingMap()` returns MAP_DATA.race_pole_position for the authored track or `game.currentLevel` when
  it carries gate rooms; `_spawnPoleRings` (rings only on `gate` rooms for a generated map),
  `_raceFinishUnlocked`, `_faceRaceFirstRing` and the game-loop spawn/clear gate all use it. Pane: 4 gates
  -> 4 rings, finish locked until all captured, field then spawns on the finish room.
- Endless: `_lssGenEndlessLevel` folds the round counter into the seed for SOLO runs (co-op keeps the
  pure worldSeed so peers grow the same route) and draws `_biomeOverride` from the deep's biome list via
  the COSMETIC stream (route bytes untouched). Pane: crystalcave instead of the fixed rocky.

## v39.58 — the endless bounty is owed wherever the beast died

`_lssEndlessDropBolt` only ever tried the corpse column (band clamp + a 6-step SDF walk down) and returned
silently when it was sealed. A leviathan phases through rock, so a kill inside a wall or a pinched stretch
paid nothing (owner: "the leviathans stopped producing the aegis rewards"; a `Monster.die` wrapper in the
owner's tab logged 2 of 3 kills with no bolt, pool empty, columns sealed). Now: the column (walking up as
well as down), then a ring of offsets (8 headings x 320/640/960 u), then the nearest endpoint of the carved
route (`run.segs[].a/b`), which is open by construction. `window.__endlessBountyMiss` counts kills that
needed the fallback. Pane: a monster killed outside the terrain and one moved 6000 u above the band both
dropped a bolt.
Also this session: a 20 s HUD-canvas freeze A/B showed no difference (0 long frames in both windows) - the
idle-thread stall storms in endless are episodic and remain unattributed in-page.

## v39.59 — the bent tube: gameplay reads the flat sheets at the FLAT image

Owner: "in the bent map, in endless, sometimes enemy ships are outside the map". On endless_bend the terrain
meshes are the flat sheets curved along the pitched spine (`_bendMapPoint`/`_bendUnmap`, v36.96) and
`worldSDF` unbends its query, but every gameplay path that samples `_stGroundYCarved`/`_stCeilYCarved`
directly did so at a WORLD x/z, where the flat band is the default -674..726 while the tube can sit
kilometres away (owner's run: spine at world y 3400; all six wave bots parked at y 100-260, speed 0).
- Helpers before `_bendVerts`: `_bendOn()`, `_bendToFlat(x,y,z,out)`, `_bendToWorld(x,y,z,out)` (copies,
  identity off the bend) and `_flatSDF(q)` = worldSDF of the flat point's world image. Function declarations
  (hoisted; no TDZ).
- `_campHoardTerrainNav` (the endless bots' vertical nav, Bot.update `LSS.MODE === 'endless'`) branches to
  `_campHoardTerrainNavBent`: unbend the bot, its 1100 u look-ahead (full 3D heading) and its target; read
  the crack there; the same desiredY blend; then steer along the vector from the bot to the WORLD image of
  (flat x, desiredY, flat z) with the same P-controller (want = min(vsp, dist*1.3), lerp dt*3.5); the
  anti-embed clamp runs in flat space and re-places the bot at the clamped point's world image.
- `_lssEndlessBolts` (route Aegis bolts): band + SDF walk at the flat image, spot mapped back. Bent runs had
  NO route bolts (every column walked into rock and returned) - this restores them.
- `_lssEndlessDropBolt._open` (bounty), storm `spawnLightningBolt` endpoints, god-ray placement and the
  bolt drift clamp: same treatment. gen.cos() call count/order unchanged (co-op stream).
Pane test pending the owner's idle window: bots inside the lane on endless_bend, `run.segs[].._bolts` non-empty.
Session tooling: `performance.getEntriesByType('long-animation-frame')` recovers the last 200 long frames
after a reload wiped the probe (161 of 200 were pre-render waits = GPU-process stalls, 43 script).

## v39.60 — endless wave bots keep the lane and follow the route

39.59 live on the owner's endless_bend run: the six wave bots were no longer under the world, but they sat
1.7-5.4 km off the carved lane in the thin sandwich crack (open air by the SDF, boxed in by rock, 1-9 u/s,
5-7 km from the pilot) and the battle never resolved. The vertical navigators only keep a bot inside the
crack, which exists between the sheets everywhere; a straight-line pursuit leaves a curved tube and the
bot is stranded in the crack. `_endlessLaneKeep(bot, dt, q, p, v)` (defined before
`_campHoardTerrainNavBent`, called at the tail of BOTH navigators when `LSS.MODE === 'endless'`):
- flat space via `run.segs[].cyl` (the carved axis in flat coords in both modes; `a`/`b` are world),
  10 Hz nearest-axis scans for the bot and the pilot's flat image, hall spheres count as in-lane;
- outside `0.85 r`: pull toward the nearest axis point (want = min(flightSpeed, 140 + 0.9*out));
  inside but > 2600 u from the pilot: follow the route toward the pilot's segment (the axis point ~900 u
  along, want = 0.85 flightSpeed) instead of the chord; targets go through `_bendToWorld`, steering is the
  same additive P-controller as the vertical nav (velocity persists across frames: accel + cap + decel);
- crawling outside the lane (out > 200, speed < 60) for 4 s: placed back on the axis point's world image
  (`window.__laneRescues` counts).
Pane test pending the owner's idle window.

## v39.61 — the lane keeper pushes with thrust, not a lerp

39.60 live: all six wave bots inside the lane (49-169 u off the axis, r 400) but at 3-7 u/s, 2-3.5 km
from the pilot. Bot.update brakes the whole velocity by `chassis.deceleration` (400-800 u/s^2) every
frame, so a `dt*2` lerp toward the wanted along-route speed (~4.5 u/s per frame) barely beat the
~4.2 u/s per-frame brake. `_endlessLaneKeep` now adds `min(want - have, chassis.acceleration * dt)`
(x1.2 when outside the lane) and never brakes; the AI's own thrust budget, so bots reach 0.85
flightSpeed along the route in about a second. The bent vertical nav keeps its lerp (it rides on top
of the AI's thrust, like the flat one).

## v39.62 — F8 marks that stick (the in-game hitch recorder, `?pbhud` only)

Owner: "how do the f8 marks save?" They didn't: the recorder was injected from the monitoring session
and every lobby return (a reload) wiped it. Now an IIFE right after `__pmark` (before `gameLoop`), active
only with `?pbhud` on the URL or `localStorage.lss_pbhud = '1'`: sets `__profOn = true` (that line must
stay AFTER the `window.__profOn = false` default at the profiler), keeps an rAF ring of 16k frame gaps,
`__prof` section deltas for frames > 30 ms, a long-animation-frame ring (>= 50 ms, script attribution)
and a cold-link watch on `renderer.info.programs.length`. F8 (keydown, capture) snapshots the last 5 s
(gaps >= 20 ms, big frames + blame, long frames, cold links, renderer.info counts, mode/map/state,
endless run state, player speed, fullscreen) into localStorage `lss_f8log` (newest last, 40 marks /
~400 KB cap) and shows a top-right box for 5 s. Console: `__f8log()`, `.summary()` (one row per
mark), `.export()` (downloads JSON), `.clear()`, `.mark(label)`. Read it from the lobby or any later
session; nothing runs without the flag.

## v39.63 — GPU keep-warm: the stall fix for the power-capped laptop

The 50-300 ms endless stalls (13 F8 marks in 5 minutes on 39.62, all GPU-process waits, no in-page
cause) are the laptop GPU's clock ramping down in light-load stretches (40-60% utilisation: travel,
thin waves) and the next heavy frame waiting for it to come back; heavy combat at 90%+ pins the clock
and is clean. Live A/B with an injected idle load, same play (~300 u/s, waves): OFF 85 long frames in
121 s (64 over 75 ms, worst 234 ms); ON 2 in 139 s (worst 95 ms), then 6 in 144 s. Shipped as
`_gpuKeepWarmTick(ts)` (defined before `_lssSupersampleTick`, called in gameLoop right after
`renderFrame()` in the uncovered branch): a 512x512 quad with a fragment loop of K iterations drawn
into an offscreen target after the frame's real work; K +15% every 20 frames while the rAF gap holds
the refresh (`_ssDyn.hz` period) and the burn (its own EXT_disjoint_timer_query) stays under a
quarter of the period, -30% otherwise; typical cost 0.4-0.7 ms/frame. Off without the timer
extension, on small devices, in XR, on battery, when hidden, outside warmup/playing. Setting: "GPU
keep-warm (anti-stutter)" (`input.keepWarm`, default on, saved/loaded with the other toggles); live
`window.__keepWarm` (on, K, ms, cap, hist); the ?pbhud box shows `warm K it, ms of cap ms`. The
supersample ratchet keeps first claim on headroom (28 s holds vs the burner's 20-frame yield).
Live on the owner's tab: 0-1 stalls/min against 6-40 before.

## v39.64 — bent water surface, the underwater effect, dark-room headlight, endless fish + bats

Owner wishes after the first deep dives on endless_bend. The water plane is WORLD-flat at WL (the
"really deep underwater cavern" is the tube diving under it - keep it), so:
- Shore masks (`_swRippleBakeMaskRow`, the far bake and its amortized job row): on the bend the flat
  sheets sampled at world x/z are kilometres from the walls, so the mask cut holes and shore fades
  through open water at the crossing. In bend mode the texel asks `worldSDF(wx, WL, wz)` (bend-aware):
  open where negative, `-sdf` standing in for depth. Flat hub keeps the height sample.
- Underwater (`_swUpdateUnderwater`): fog colour lerps to `_swDeepCol` 0x03141c with depth, the master
  `audio.hiCut` drops to 620 Hz (`_swSubmergedAudio`), 240 rising additive bubbles around the camera
  (`_swBub*`, points in a 900 u box that wraps with the camera, never above WL; program linked behind
  the countdown via `_warmDrawRoot`). Knobs `window.__underwater = { bubbles, cut }`.
- Headlight (`_shipLightsTick` block): x(1 + 0.7*(1 - lum/0.16)) under a dark fog, x2.3 submerged with
  the throw x1.5 and the cone x1.25 (`S._angle0` remembers the stock angle); `window.__headBoost`.
- Endless critters (`_ecr*`, after `_fishSchoolDispose`): closed-form fish schools (48, under the water
  plane where `spine y + 0.45 r < WL - 60`) and bat swarms (36, hall spheres via `_bendToWorld` and one
  plain segment in three, upper half of the tube), positions = f(seed, run clock) into 32x32 position/
  velocity DataTextures rendered with the hub's `_FISH_VS`/`_BIRD_VS`/`_BIRD_FS`. Rescanned from
  `run.segs` every 2 s, drawn within 6 km. Co-op: the authority's run time rides in `bot_roster` (`rt`),
  peers keep `run.clockOff` -> identical creatures with zero traffic. `window.__ecr` (on, fishOn, batsOn).
Pane (39.64): the crossing shows the surface as a plane cutting the tube; submerged reads fog 041f28,
bubbles 240, headlight 8340 cd / 3600 u; 5 fish schools + 5 bat swarms on the test route; no errors.

## v39.65 — the ship-select light rig, brighter

Owner: "make the lobby (ship selection screen) lights brighter on the ships". The two preview paths
(one-context `_ONE_CTX_PREVIEW` and the two-context fallback in `_initShipPreview3D`) built the same
three lights inline (ambient 0.25, key 0.65, fill 0.28, rim 0.18 + the gradient PMREM environment) and
the hull read as a dark silhouette. Now one `_pickerLightsAdd(scene)` (defined before
`_initShipPreview3D`) adds the rig from `_PICKER_LIGHTS` = amb 0.48 / key 1.25 / fill 0.55 / rim 0.42
plus a 0x8fb4e6/0x3a2a1a hemisphere at 0.45; same positions and colour roles, ~1.9x the level, refs in
`_shipPreview3D.lights`. Live: `window.__pickerLights(1.3)` scales the rig, `__pickerLights({ key: 2 })`
sets levels, no arg reads them. The chip-thumbnail bake (path C, ambient 0.55 rig) is untouched.
Pane: the Vortex hull, engine glow and panel lines read against the hangar plate.

## v39.66 — mirror water

Owner: "surprised how dull and not mirrorlike the water is everywhere in all the modes". Two causes,
both in the water rig, none in the reflection itself (the Reflector was live, `uReflLive` 1):
1. The mirror render target was a QUARTER of the canvas (`_swBuildHubWater`: 334x256 in the pane,
   ~600x340 on the owner's 1080p) - every reflection a soft smear. Now `_rsc` = 0.5 on MEGA/ULTRA, 0.4
   on HIGH, 0.25 below and on small devices, cap 1536 (`window.__water.reflScale` overrides; needs a
   water rebuild).
2. The shaders were told to hide it: near-field fresnel floor 0.24 x a dusk factor that fell to 0.10
   (`_wlit`), 0.03 in the caverns (`cavReflFloor`), `uGrazeClear` 0.7 wiping 70% of the mirror at
   grazing angles (where water IS a mirror), `uGrazeAlpha` 0.45, a 2.4x soft-knee (`uReflBright`) that
   squashed it to a pale wash, perturb 1.0; the far plane's own floor 0.14 and UV wobble 0.04. New
   defaults: floor 0.42 (dusk factor min 0.6), cavern floor 0.35, grazeClear 0.25, grazeAlpha 0.25,
   bright 1.6, perturb 0.6, far floor 0.34 / wobble 0.025. Every near-field value stays live under
   `window.__water` (reflFloor, cavReflFloor, grazeClear, grazeAlpha, reflBright, cavReflBright,
   reflPerturb, reflHot, reflMix, reflFar); the far-plane constants are shader literals.
GPU: the mirror pass now draws 16-25% of the main pass's pixels instead of 6%; the keep-warm pass
yields first, then the supersample ratchet. Pane (HIGH tier, 39.66): RT 535x344, uniforms as baked,
no console errors; the judging shot needs a third-person view the pane cannot pose - owner judges.

## v39.67 — Mega Laser: monsters take the beam, no hard ends

Owner: "vortex's mega laser core doesn't seem to give me hit markers" + "the ends of the cylinder need
smoothing or hiding or blending into muzzle fire at the muzzle". The core tick (`updateAbilities`,
`coreName === 'Mega Laser'`) already threw a throttled `showHitMarker()` for Bots (0.18 s) - but the
loop only walked `game.entities`, so leviathans / outskirts monsters (the endless targets) took NO
damage and no marker. A second loop over `game.monsters` mirrors it (axis test with
`collisionRadius + 0.6 * BEAM_RADIUS`, 3000 dps, hull bursts, arcs, hit fire, the same marker
throttle). Ends: the two arm cones set `uAxialFalloff` 0.95 (the LayeredFX shader scales by
`1 - uv.y * falloff`, uv.y = 1 at the +Y end = the gun), three additive glow cards
(`player._vortexCoreGlows`: muzzle x2 at 30 u pulsing, joint at 4.5 x arm radius; a radial canvas on a
MeshBasicMaterial, warmed at creation) hide the open cone ends, and each barrel spits
`_spawnClassFireBurst` at 14 Hz (cap 10 live, `_muzzleFlame` tag) so the arm is born out of flame.
Knobs on `window.__vortexFire`: muzzleHz, muzzleSize, glowMuzzle, glowJoint. Pane: bot pinned 1500 u
ahead in the beam -> 12 markers / 2 s and 2546 damage; an OutskirtsMonster pinned 1800 u ahead ->
12500 -> 1647 hp and 11 markers; glows/arms/muzzle flames all live, no errors.

## v39.68 — the Laser ability gets the same ends

Owner: "make the same changes to laser's appearance". The 0.22 s Laser shot (`activateAbility`,
`'Laser'`, the `_vlOrigin`/`_vlDir` block) builds the same three cones as the core. Now: the glow card
material + geometry are shared helpers (`_vortexGlowMaterial()` / `_vortexGlowGeometry()`, defined
before `_vortexYKnobs`; the core's inline creation was folded into them), the ability arms set
`uAxialFalloff` 0.95, three glow cards (muzzles 16 u, joint 22 u; `__vortexFire.glowMuzzleAbility` /
`glowJointAbility`) ride the shot as their own `'vortexLaserBeam'` effect entries with `e.glow` = base
size (the shared fade path shrinks them to 35% over the life and disposes them; the material is shared
so its opacity is never touched), and each barrel spits two class-fire bursts. Pane: `q` fires it
(`input.kbBindings.ability0`); one shot = 6 effect entries (stem, 2 arms at 0.95, 3 glows) + 4 muzzle
flames, no errors. Tip for the pane: extend `e.lifetime` on the entries right after the shot to hold
the beam for a screenshot.

## v39.69 — endless drift clouds

Owner: "we could probably afford to put a few extra clouds randomly floating around in endless". The
arena `GasCloud`s (billboardCloudSystem sprites, GPU drift, ship wakes via `applyWake`/`tickWake`) now
hang in the endless tube: `_endlessCloudsTick(dt)` (after the `_ecr*` critters block; called beside
`_arenaCloudTick` in the game loop) rescans `run.segs` every 2 s and seeds 0-2 clouds per segment by
gid hash (55% one, 25% two) at a spine point pushed up to 0.4 r sideways and 0.25 r up/down, SDF-open,
above the water plane; bounds 0.28 r + jitter (110-380 u), sprites 1.7x, 14 slots each, alpha
0.34-0.48, colour = fog lifted 55% toward white (floor luminance 0.35), `recolor()` follows biome
switches. Each cloud rides a 45 s closed-form loop of 0.35 x bounds around its anchor on the shared
run clock (`_ecrClock`: co-op peers agree), moved with `setPosition`; ships within `_AR_CLOUD_WAKE_R`
push the sprites like the arenas. Clouds leave with their segment (`dispose()` returns the slots); cap
`__ecl.max` 14; off on potato / VR perf tier >= 2. Pane (39.69): 7 clouds on the test route, no
errors.

## v39.70 — biome-coloured clouds, class fire for every ship, charge fire in the glow

- Clouds: `_eclColor()` reads `game.sandwichTerrain.biome` -> `_ECL_BIOME` (volcanic ember, goldmine
  gold, crystalcave violet, snow pale blue, rocky dust, grassy green-white, mossy white-blue, brokensim
  magenta), a quarter toward the live fog, luminance floor 0.35; `__ecl.colors[biome]` overrides. A
  cloud keeps its birth colour (biome switches are spatial, new stretches grow new clouds).
- Class fire (owner: "same effect that vortex has as muzzle fire, smaller ... other ships in their
  theme"): `_CLASS_FIRE` table (SLAYER/TRACKER/BLASTER/PUNCTURE/SYPHON colour+size+life, sizes 6-8 vs
  the Vortex's 12), `_classMuzzleFire(key, pos, dir)` called from `emitChassisMuzzleFlash` (so peers and
  bots get it too), one burst 40 u down the barrel, 12 Hz per class, 12 live (`_classFlame` tag);
  Vortex keeps its fireHitscan path, Pyro its flame particles.
- Charge fire: `_chargeFireTick(dt, t, tint)` beside `_blasterChargeGlow` for the Blaster power shot and
  the Puncture railgun spool - bursts spawned INSIDE the glow tube (the "basic shape that grows"):
  `len = hull*0.16*(0.35+0.65t)`, `rad = hull*0.034*(0.5+0.5t)`, 5-20 Hz, 3.5-9.5 u x sqrt(hull/60),
  life 0.32, alternating muzzle nodes. `window.__classFire = { on, mul, table }`.
Pane (39.70, Puncture, third person): crystalcave cloud 9889fa; railgunCharge 0.9 -> 6 flames in the
glow; 4 shots -> muzzle flames; no errors.

## v39.71 — Puncture's spiral leaves the barrel; the charge glow loses its cone

- Spiral origin (owner: "puncture's spiral tracer ... looks like it comes under slightly"): in
  `fireHitscan` the Puncture branch always projected the first-person screen fraction
  (`_PLAYER_MAIN_MUZZLE_FRAC.PUNCTURE` 0.356/0.634), even in third person where `origin` already IS the
  muzzle node fireWeapon resolved. Now third person uses `origin`; first person keeps the fraction,
  overridable live with `window.__muzzleFrac = { PUNCTURE: { x, y } }` (measure on screen, then bake).
- Class muzzle fire placement: `_classMuzzleFire` puts the burst on the same on-screen barrel the
  tracer leaves from in plain first person (the class's main-muzzle fraction, else the dual-tip
  fractions alternating sides, +10 u); peers/bots/third person get their muzzle +14 u.
- Charge glow (owner: "too conelike ... sharp edges, kinda like vortex's cylinder lasers"): the tube is
  a 24-segment near-cylinder (1 -> 0.82) wearing a new LayeredFX preset `charge_glow` (core_beam's
  soft body: fresnel 0.55, softEdge 0.55, axialFalloff 0.92 fading the REAR - the tube is flipped with
  `_BCG_FLIP` so +Y points back down the barrel), tinted per frame through uBaseColor /
  uAxialCoreColor (class colour, pale core) with uIntensity = (0.35 + 0.85 t)(1 + 0.45 t);
  `_warmChargeGlowOnce` warms the FX material behind the countdown. Pane: ShaderMaterial, base
  ffee44, 24 segments; muzzle flame 2 u from the node in cockpit-3d; no errors.

## v39.72 — a flock rebuilt mid-flight no longer compiles on the game thread

The first hitch caught by the in-game F8 recorder (owner, hub free flight on 39.71): a 3307 ms frame
blamed on `hub:critters` with 2 cold GPUComputationShader programs, then a 2473 ms frame. Cause:
`_fishReseed` threw (cause swallowed by `catch (_)`), its catch tore the school down and rebuilt it,
and the very next `compute()` blocked on the D3D compile of the unrolled boids velocity shader, then
the first draw blocked on the render program. The prebake primes both flocks behind the loading
overlay (`_prebakeGpuPrime` computes + compiles them); a rebuild in play had no overlay. Now:
- `_critterPrecompile(F)` (before `_birdFlockInit`): after ANY init the flock is gated (`F._pending`)
  until `renderer.compileAsync` has linked its two compute materials (a throwaway scene of two quads)
  and the render mesh off-thread; both ticks skip `compute()` and the fish tick hides its mesh while
  pending; an 8 s timeout unwedges a stuck promise. The prebake's direct `gpu.compute()` still primes
  synchronously behind the overlay.
- The reseed catch logs its cause (`[fish] reseed failed, rebuilding the school: ...`) and refuses to
  rebuild more than once per 20 s.
- `window.__critters = { bird, fish }` exposes both flock states for diagnosis.
The same F8 mark's ring also showed 6.7 s / 61 s / 11.6 s rAF gaps with no long animation frame:
those are the tab being hidden (alt-tab), not hitches; the recorder's `vis` flag reads the frame
after the return.

## v39.73 — you can see through the water, and the headlight stops shouting in daylight

Two owner asks in one cut: "during the bright light scenes, the water reflection of the ships'
headlight can be dimmed, it's too bright during brighter scenes", and — pointing at
jeantimex/threejs-water — "i really like this water, it looks and acts great ... it just is missing
the 39 degree 'ducks' wake and foam", i.e. bring that reference's look to LSS water and keep the
Kelvin wake and foam we already have.

**The mirrored headlight now scales with the sky.** In the Reflector's `onBeforeRender` the
pass-only cone boost/gain (v38.51/v38.57's 8.0 and 2.6, tuned against night water and dark caverns)
are multiplied by a daylight factor read off `scene.fog.color`'s luminance — the same signal the
water shader uses for its own sky tint — `day = clamp((lum - 0.10)/0.35, 0, 1)`, falling to
`__shipCones.dayDim` (0.25) of full at noon, the gain riding `sqrt(dayDim)` so the over-range bloom
fades more gently than the opacity. Measured in the hub at midday the fog luminance is 0.35, so the
boost lands near 3.7 and the gain near 1.7 — dimmer, still there (owner in the dark: "i see it").

**Refraction: the body of the water is the world under it.** `base` used to be a flat `color * diff`,
an opaque painted blue, so the mirror was the only real thing in the surface. The near-field sheet
now samples the scene already drawn beneath each pixel and absorbs it toward the water colour with
depth. Machinery:
- `_hubWaterDisp` sits on **layer 6** (`_WATER_LAYER`), and the main camera keeps 6 enabled so every
  other render path — XR, potato, the bare `renderFrame` — still draws it normally.
  ⚠ **Not layer 7.** Layer 7 already belongs to `_wxBuildTerrProxy`'s shadow-only terrain proxy, a
  white `MeshBasicMaterial` heightfield only the sun's shadow camera may see. The first cut used 7
  and enabled it on the main camera: translucent white slabs standing exactly where the mountains
  are (owner: "what are the mountains glowing white"). Layers in this game are 0, 5 (ADS hull
  overlay), 6 (this) and 7 (shadow proxy).
- `renderPostFX` disables layer 6 for the main render, then calls `_waterRefractPass()`, which
  re-renders **the same scene** with a layer-6-only camera into the **same** target. Depth is
  deliberately not cleared, so the sheet depth-tests against the world exactly as before, and the ADS
  hull overlay still goes on top afterwards. `scene.background` is nulled (a non-null background
  repaints the whole target — the v36.81 whiteout), `matrixWorldAutoUpdate` and
  `shadowMap.autoUpdate` are pinned off (the v39.49 second-shadow-map trap), all restored in a
  `finally`.
- ⚠ **The main scene, not a private one.** A second `Scene` has its own light state, and light COUNTS
  are in three.js' program cache key, so the water material would link a SECOND program the first
  time the pass ran — a cold link in play. Same reason `_adsOverlayRender` renders `scene`.
- Reading the target while drawing into it: with MSAA (ULTRA only) `rt.texture` is the resolved copy
  `renderer.render()` already blitted, a different object from the multisample draw buffer, so
  sampling it is legal; without MSAA (everything else) it IS the draw attachment, so one
  `copyFramebufferToTexture` into `postFX.rtRefractCopy` (a `FramebufferTexture` reallocated only on
  resize) stands in — the trick `MeshPhysicalMaterial`'s transmission uses.
- Shader: `uRefract` is 1 **only** inside the pass and reset to 0 in the `finally`, so any other
  render of this mesh keeps the old tinted body. `suv = gl_FragCoord.xy / uSceneRes` slid by `N.xz *
  uRefractK`, shrinking with distance (a constant world wobble must shrink on screen or the horizon
  crawls) and at grazing angles, clamped to `uSceneMax` = the v39.49 supersample viewport's live
  fraction (`_lssSceneActive(rt).sx/.sy`). `shDepth` (the shore mask's depth channel) was hoisted up
  next to `base` to tint it: clear over a sandbar, deep teal over a trench. Alpha is pushed to 0.99
  while refracting — the refracted floor IS the see-through, ghosting the unbent copy only softens it.
- Knobs: `window.__water.refract` (0 = off, back to v39.72 exactly), `.refractK` (0.045),
  `window.__waterRefractInfo` = { frames, msaa, copy, res, k }.

**Caustics on the flooded floor.** The terrain fragment shader gained `uWaterY` / `uWaterOn` on the
shared `_swU` (hooked up beside `uBendFlat`, written per frame from `game._hubWaterWL` /
`game._hubWater`, 0 on potato). Below `uWaterY` the albedo is multiplied by a two-crossed-sine
interference net (`pow(..,3.5)`, gain 1.15), faded in over the first 30 u of depth and gone by
1100 u, weighted by the up-facing normal so walls get none. The water plane is world-flat at WL in
every mode, so a plain world-y compare is right on the bend too. `window.__water.caustics` scales it
(0 = off).

Pane, hub free flight, 39.73: 144 fps, `cold 0`, no console errors, refraction pass running every
frame (1070x688, no MSAA so the copy path), caustics confirmed live on the submerged floor
(`__swU.uWaterOn` 1, `uWaterY` -720, and all six terrain programs report `uWaterOn`/`uWaterY` as
active uniforms). Owner on the result: "water looks great".

Note for future pane sessions: the owner's Pro Controller rests with a stuck stick (axes 0.69 / -1),
which flies the ship out of frame between two screenshots. `navigator.getGamepads = () => []` in the
pane freezes it for like-for-like A/B shots.

## v39.74 / v39.75 — the water pass forked its program, and the recorder now names what links

The owner's first two F8 marks on 39.73, read against their 39.72 marks:

| build | at | worst | section | cold |
|---|---|---|---|---|
| 39.72 | 35.49 s | 2578 ms | `hub:stream` | 2 |
| 39.72 | 45.67 s | 792 ms | `renderFrame` | 1 |
| 39.73 | 53.27 s | 3154 ms | `hub:stream` | 2 |
| 39.73 | 68.85 s | 1980 ms | `renderFrame` | 1 |
| 39.73 | 139.41 s | 2557 ms | `renderFrame` | 1 |

Both shapes are already in 39.72, so the hitch **class** is not new — but 39.73 did add one program to
it, and it is mine.

**v39.74 — light parity for the water pass.** `_waterRefractPass` renders with a layer-6-only camera,
and `projectObject` gates `pushLight` on `object.layers.test(camera.layers)` exactly as it gates
meshes. So the pass saw **zero lights**, and the light counts are program-cache-key terms: the water
material linked a second, zero-light program the first time the pass ran, cold, in play. Measured in
the owner's session: **four** water programs where there should be one, two of them with
`numDirLights 0, numPointLights 0, numSpotLights 0, numHemiLights 0, numDirLightShadows 0`.
This is v39.49's ADS-overlay finding one layer over — and the comment I wrote in v39.73 claiming
"render the main scene and the counts match" was wrong, because the camera's mask filters lights too.
Fix: every light that carries layer 5 for the ADS pass now carries layer 6 as well (11 creation
sites; measured live, all 20 lights in the scene are mask 33 → now 97), and `_waterRefractPass`
re-asserts layer 6 over `scene.children` each pass — a flat loop where every light in the game
actually lives — so a light added by future code cannot fork the program even once. Pane after:
**one** water program with the full light set, `cold 0`, 144 fps measured over water.

**v39.75 — the cold-link watcher names what linked.** Every cold link so far reported `(unnamed)`,
because `WebGLProgram.name` is `material.name` and almost nothing here names its materials, so a mark
could prove a 2 s hitch was a shader compile but not say which shader. Now `_coldName(p)` gives:
- a **signature uniform** (`uPatchScale` → terrain, `uRefract` → water, `uTreeFadeA` → tree, ...), or
  the cache key's leading shader id for built-ins (`depth`, `physical`, ...);
- **fork detection**, the actionable half. three.js' cache key has a fixed tail, so a cold key that
  matches a warm one except in the light counts, the output colour space or the tone mapping is not
  new content — it is the same material linked again under different render conditions, which is a
  bug every time. `_COLD_TAIL` indexes that tail from the END so it holds for built-ins (one leading
  id) and ShaderMaterials (two).
Verified by reproducing the v39.73 fork on purpose in the pane; the HUD read
`depth [FORK: numDirLights numPointLights numSpotLights numHemiLights numDirLightShadows]` — the
diagnosis that took a hand-diff of two cache keys, printed automatically.

**Still open (pre-existing, both classes visible on 39.72):** `hub:stream` links 2 programs when
terrain chunks stream in (2.5–3.2 s), and `renderFrame` links 1 in the hub during play (0.8–2.6 s).
The next F8 mark on 39.75 will name them.

## v39.76 — the ship's world-space attachments follow it into the ADS overlay pass

Owner, third person with zoom held: "when i double zoom with puncture, and am charging, the charge
isn't in the right spot", and "just on regular zoom in 3rd person all ships, the headlight floats too
low under the ship, and can see a cutout of the green/red ball in the headlight pie shape at the peak
of the pie shape".

One cause for all three. `_adsShipOverlaySet` moves `player.mesh` **and its children** to layer 5, and
`_adsOverlayRender` draws that layer with `_adsOvCam` at the UN-zoomed settings FOV. Two things that
are visually bolted to the ship are deliberately *not* children of it:
- `_SHIPL.coneP`, the headlight cone — a scene object posed each frame at the spot's world position
  and aimed with the camera's forward;
- `player._bcgTubes`, the charge tubes — world-space on purpose, so the muzzle markers' own export
  rotation never has to be guessed (see the v39.71 note).

Both sat on layer 0, so the MAIN pass drew them through the ZOOMED projection while the hull was
drawn through the un-zoomed one. Same camera pose, different FOV, so everything off the screen centre
is magnified away from it. Measured in the pane: the settings FOV is 120°, a held zoom narrows the
camera to 71.6°, and Puncture's double zoom to **39.7°** — a 3x magnification difference between the
hull and its own headlight. That is exactly "floats too low under the ship" and "the charge isn't in
the right spot", and it scales with the zoom, which is why double zoom made it obvious.

The hull leaving layer 0 also empties the main pass's depth around the ship, so the cone's apex —
normally buried inside the hull — was drawn over whatever layer-0 sprite sits near the screen centre.
That is the "cutout of the green/red ball at the peak of the pie shape"; it goes away once the cone is
drawn in the overlay pass, where the hull's depth is in front of it again.

`_adsOvSyncExtras(on)` puts both on layer 5 with the hull and back on layer 0 on release. It runs
**every frame** from the top of `_adsOverlayRender`, not once at the toggle, because the charge tubes
are built lazily on the first charge — long after the zoom engaged. The objects it touched are
remembered in `game._adsOvExtraSet` so release restores exactly those, whatever the current list is.

⚠ And the mirror keeps them: `THREE.Reflector`'s virtual camera is layer 0 only, so moving the cone to
layer 5 would have dropped the headlight out of the water reflection exactly where v38.50 put it.
`mesh.camera.layers.enable(5)` at the Reflector's construction keeps the cone and, as a bonus, finally
puts the zoomed hull in the water instead of making the ship vanish from its own reflection.

Pane, Puncture, third person, charging, double zoom held (camera 39.7° vs overlay 120°): both extras
report layer mask 32 while held and mask 1 after release, the set empties, `cold 0`, no console
errors. Not moved: the class muzzle-fire bursts, which live in `game.worldEffects` shared with every
other ship — they will still be drawn zoomed for the brief moment they exist.

## v39.77 / v39.78 — every gun fires from where the ship is drawn

Owner, after v39.76: "fix all the weapons in the same way, on all the ships."

v39.76's fix was to move a mesh onto the overlay layer with the hull. That works for something that
is *entirely* the ship's own — the headlight cone, the charge tubes — but most of what a gun emits
is not. A tracer or a beam **starts** at the muzzle and **ends** out in the world; every particle in
the game is one shared `THREE.Points`, which cannot be split across layers; a pooled flash billboard
has to go back to the pool on layer 0. Moving those is either impossible or would aim them somewhere
they are not pointing.

So the rest of the weapons get the same result from the other end — by **spawning at the point that
lands where the ship is drawn**.

**`_adsAnchor(v)`** (defined before every call site, so nothing can read it in its TDZ). While
third-person zoom is engaged the hull is drawn by `_adsOvCam` at the settings FOV and everything else
by `camera` at the zoomed FOV, from the same position and orientation. Two perspective cameras that
differ only in FOV project a point to NDC in a fixed ratio — the magnification — so dividing the
point's camera-space x and y by that ratio, and leaving its depth alone, makes its zoomed image land
exactly on its un-zoomed image. Outside third-person zoom it is the identity. `window.__adsAnchor`.

Verified numerically in the pane (settings FOV 120, Puncture double zoom → camera 39.7°, so 3x):

| point | hull's camera | drawn before | drawn after |
|---|---|---|---|
| muzzle node 0 | 0.0243, −0.1230 | 0.1169, −0.5902 | 0.0243, −0.1230 |
| muzzle node 1 | −0.0249, −0.1228 | −0.1195, −0.5892 | −0.0249, −0.1228 |
| under the hull | 0.0514, −0.2119 | 0.2467, −1.0170 | 0.0514, −0.2119 |

Exact to four decimals, and note the third row: a point the hull draws a fifth of the way down the
screen was being drawn **off the bottom edge**. That is the owner's "floats too low under the ship".

Where it is applied — one anchor per emitter, never on anything that decides a hit:
- `emitChassisMuzzleFlash(key, pos, dir, mine)` — a single anchor at the top covers the flare
  billboard, the muzzle light, the universal sparks, Pyro's flame tongues, Slayer's kick sparks and
  Puncture's barrel lightning, for every ship. `fireWeapon` passes `mine: true`; peers and bots do
  not, so their flashes are untouched.
- `_classMuzzleFire(key, pos, dir, mine)` — now *told* whose shot it is instead of guessing by a 20 u
  distance test, which an anchored `pos` could cross. `mine` also picks the 40 u / 14 u stand-off.
- `fireHitscan` — a separate `_vOrigin` for the tracer and the Vortex barrel flame. ⚠ `origin` itself
  still drives the raycast, the damage and `end`, so **the shot lands exactly where it did**.
- `_spawnRailgunSpiral` — Puncture's spiral leaves the drawn barrel (v39.71 got third person right;
  this is the zoom case on top).
- `_vortexGunPair` — both Vortex beam paths (Mega Laser core, Laser ability) read their barrels here,
  so one anchor moves the arms, the glow cards that hide their open ends and the barrel flames
  **together**: the seam between them can never open. The stem and the outbound beam are deliberately
  left alone — they are world geometry and still end where you are aiming.
- `_chargeFireTick` — the fire that fills the growing glow shape. The tube itself rides the overlay
  layer from v39.76; an anchored point and a layer-moved mesh land on the same pixels by construction,
  so the two agree.

Pane: Vortex (gun pair anchored, measured 41 u toward the view axis; muzzle flame on the hull),
Puncture (charge glow on the barrel at 4.8x zoom, tube layer mask 32), Blaster (clean). `cold 0`,
144 fps, no console errors, and the anchor is bit-exact identity with the overlay off.

**v39.78 — the cold-link namer knows the whole parameter block.** v39.75 only named the key's last 20
slots, so a real fork caught on the very next run printed `physical [FORK: idx-48]`. three.js pushes a
fixed-length parameter list, so a parameter's distance from the END of the key is the same for a
built-in shader (one leading id) and a ShaderMaterial (two) — checked against live keys at
`numDirLights` 20, `numPointLights` 19, `numSpotLights` 18, `numHemiLights` 16, `numDirLightShadows`
14, `toneMapping` 8 and `outputColorSpace` 51. The table now runs 1–51, and that fork reads `mapUv`:
two `physical` programs differing only in the base map's UV channel, linked at 7 s during the load,
not in play. Pre-existing, low priority, and now legible.

## v39.79 / v39.80 — the water stops erasing the effects in front of it

Owner: "a lot of the effects are not working over top the water, they are cancelled out, like the
weapon trails and the shields... (which was fixed just recently about the water)". Correct — v39.73
caused it.

v39.73 drew the near-field sheet in a **second pass after the world** so it could sample what was
behind it. Tracers, weapon trails, shield bubbles and muzzle flames are transparent and do not write
depth, so a sheet drawn after them, depth-testing only against the opaque world, simply painted over
them. The v39.73 alpha push (`aGraze` to 0.99 while refracting) made it total.

**v39.79 puts the sheet back in the main transparent pass** at `renderOrder -1` — first among the
transparents, with every effect compositing on top of it exactly as before v39.73 — and takes the
refraction source at the one moment that is both late enough and early enough: **its own
`onBeforeRender`**. three.js finishes the whole opaque pass before it starts the transparent one, so
at that instant the target holds the solid world and nothing else. That is a *better* source than the
second pass had (which also swept every transparent effect into the refraction), and it costs one
framebuffer copy instead of a second render-list walk and a draw.

- `_waterRefractBind(rnd, scn, cam)` arms refraction only when the current target IS `postFX.rtScene`
  and that target has no MSAA; `onAfterRender` disarms. A bare render (XR, potato, the picker) or the
  mirror leaves `uRefract` 0 and gets the plain tinted body, which is what each of those wants.
- ⚠ **MSAA (strict ULTRA only) has no single-sample buffer to copy from mid-render** — the resolve to
  `rt.texture` happens at the END of `renderer.render()`, so `copyTexSubImage2D` there is invalid.
  Those frames keep `uRefract` 0 and get the v39.72 tinted body. The mirror, the caustics, the foam
  and the Kelvin wake are unchanged.
- The layer-6 hold-back, `_waterRefractPass`, `_wrCam` and the per-pass light sweep are all gone.
  `_WATER_LAYER` is kept as a note, and the lights keep layer 6 — it costs nothing and the next
  layer-restricted pass will need it (see the v39.74 note at the combat lights: a pass layer must be
  on EVERY light or the material forks a zero-light program, cold, in play).
Pane: effects visible over the water again, refraction still reading through to the lake bed,
`cold 0`, 141.6 fps.

**v39.80 — a recorded hitch now names the shaders that linked.** The mark stored `cold: [[t, count]]`
and nothing else, so "2 cold" could not say whether that was new content compiling or the same
material forking, and the names live only in the page that recorded them, which is usually gone by
the time a mark is read. The mark now carries `coldNames`, the cold watcher's own list (signature
uniform + fork detection, v39.75/78), copied in whole **at mark time** rather than sliced at
detection time — the two run on different clocks (the watcher polls once a second, the recorder
notices the program count on the frame it rises), so a slice could name the wrong ones. Its `t` is
seconds since the watcher armed, close enough to the mark's clock to line up by eye.

### What the owner's two 39.78 marks actually said

| at | worst | section | cold |
|---|---|---|---|
| 55.78 s ("laggy startup") | 34.8 ms | `renderFrame` 3.3 ms | 0 |
| 144.17 s ("third→first person") | 514.1 ms | `hub:stream` 510.2 ms | 2 |

The startup mark holds **one 35 ms frame** and nothing else — avg 122 fps over 610 frames, no shader
links. The recorder's ring is ~5 s, and it arms after the prebake, so a slow *load* is invisible to
it. The load cost is on the prebake line instead, and on the owner's machine it is large:

```
[prebake] freeflight/hub_overworld 17052ms ... [clip 8, terrain 480, arena 0, fx 2806, ent 1090,
          mon 0, carrier 1423, gpu 11194, drain 46]
```

**17.0 s, 11.2 s of it the GPU warm stage** — against 6.4 s / 3.2 s in the pane. The difference is
resolution: the owner runs MEGA, so `postFX.rtScene` is 4608x2592 (11.9 MP) against the pane's
1070x688 (0.74 MP), sixteen times the fill for warm passes that only need to LINK programs. Program
cache keys do not depend on viewport size, so those passes could run in a small scissored rectangle
of the same target and link exactly the same programs — the trick `_adsOverlayPrewarm` already uses
with its 8x8 target. **Open, not done: shrink the prebake's GPU-warm viewport.**

The view-switch hitch is the `hub:stream` + 2-cold-links pattern that predates all of this (it is in
the 39.72 marks too). The fork the namer catches in the pane and on the owner's machine is
`physical [FORK: customCacheKey]` x2 — two hull programs identical except for `ghostHull` against the
default key, i.e. the seat-shell variant and the painted variant of the same material, one of them
not warmed. `_ghostPinWarm` already exists for exactly this and clearly is not covering every case.
**Open: find which hull material reaches the frame in the flavour the pin did not build.**

## v39.81 — the cold watcher sees a program being REBUILT, not just a new one

The owner's 39.80 mark, a hitch over the countdown: `hub:stream` **2107 ms**, `renderFrame` 3.3 ms,
the program count **up by 2** at that instant — and `coldNames` naming nothing from that moment (its
only two entries were 33 s earlier). The key-only watch could not see it, and that absence is itself
the finding.

three.js frees a `WebGLProgram` when its last material is disposed and builds a fresh one — a real
`gl.linkProgram`, the full ANGLE/D3D compile — the next time that same key is wanted. The **key** set
has seen it, so the watcher stayed quiet; the **count** rose, so the recorder blamed the frame. Two
seconds for two links is entirely plausible for shaders this size.

So the watcher now tracks program **ids**, not just keys:
- a new id whose key is new → the old report (`terrain`, `water`, `physical [FORK: ...]`);
- a new id whose key was already warm → **`[RELINK]`**, which means churn: something disposed a
  material that was about to be needed again. That is a bug every time, and a different bug from
  "new content compiled", which is expected and warmable;
- ids that vanish are reported as `freed xN`, so a mark can show the disposal and the rebuild as one
  story.

**Ruled out along the way — the near-field water is not this.** Instrumented over a full load, its
material links three programs, and they are (output colour space, tone mapping) variants:

| at | colour space | tone mapping | who draws it |
|---|---|---|---|
| 7.8 s | srgb-linear | none | the gameplay path, into `postFX.rtScene` |
| 16.5 s | srgb | 4 | a pin pass, against the canvas |
| 20.3 s | srgb | none | a pin pass with `toneMapping` forced off |

The one the game actually renders with links **first**, inside the prebake. The other two are the pin
passes compiling canvas variants the gameplay frame never uses — waste that lands on the load, the
same 17 s / 11.2 s GPU-warm bill as above, not on a play frame.

**Open:** reproduce the re-link. A teleport tour across the hub in the pane produced no program frees
and no re-links, so whatever disposes it needs the owner's longer load and the countdown window. The
next mark will name it.

## v39.82 — the seat-shell warm never drew the cockpit, so the seat paid for it

Found with v39.81's namer, free flight in the pane: **seven programs linking together at t=30.3 s, in
play** — `Vortex_CP_ScreenGlass [FORK: customCacheKey]` x2, `hull [FORK: customCacheKey]` x2,
`basic [FORK: customCacheKey]` x2 and `depth [FORK: flags]` x1. Two of each because the ghost
materials are transparent + DoubleSide and three.js draws those in two single-sided passes, each with
its own program. The fork is on `customCacheKey` alone, which is `ghostHull` against the default (the
stringified `onBeforeCompile`) — so the painted variant was warm and the seat-shell variant was not.

`_ghostPinWarm` exists precisely to build these behind the loading overlay, and it does apply the
shell and compile. What it did not do is **draw** them, and v39.52 established that a warm must draw:
ANGLE builds a vertex executable per vertex input layout at the first draw that uses it. The pin runs
with the hull in its THIRD-PERSON state, where the cockpit interior is hidden, and `_warmDrawRoot`
only un-hides the root's ANCESTORS, never its descendants. So the interior was never drawn, and its
programs were built on the frame the pilot first took the seat — the owner's "the switch from third
to first person lagged a bit".

Both `_ghostPinWarm` and `_ghostPinWarmAsync` now show every descendant of `player.mesh` for the
duration of the warm and put each back exactly as it was. The draw is 8x8 and off-screen.

Pane before: 4 `ghostHull` programs, linking in play at t=30.3.
Pane after: **16** `ghostHull` programs, all built during the load, and a tour that teleports across
the hub while flipping between the seat and the chase view every ~200 frames adds **no** cold link at
all. What remains is `physical [FORK: customCacheKey]` x2 and `depth [FORK: flags]` x1, all at t=7 —
the moment the watcher arms at the end of the load, which is where the owner sees them too.

**Still open — the countdown hitch itself.** The owner's 39.80 mark is `hub:stream` 2107 ms with the
program count up by 2 and no new key to show for it, which is the re-link signature v39.81 was built
to name. It did not reproduce in the pane (no frees, no re-links across a full teleport tour), so it
needs the owner's longer load and the countdown window. The next mark will label it `[RELINK]` and
say which shader.

## v39.83 — a warm that does not DRAW is not a warm, and `_warmDrawRoot` never drew the seat

Owner: "it shouldn't still be warming there, we have a loading screen for that." Correct, and
measurable. Instrumenting the pane with the overlay's `.active` class beside `renderer.info.programs.length`:

| build | programs under the overlay | programs after it lifts |
|---|---|---|
| 39.82 | 190 → 246 | **246 → 248 at +6.7 s, during the countdown** |
| 39.83 | 190 → 248 | **none** |

The two late ones were `physical [FORK: customCacheKey]` x2 — the pair the owner's own machine reports
at t≈7-8 every load, and the same shape as the 39.80 countdown mark.

The cause is one line in `_warmDrawRoot`, and it was costing every pin that calls it. v39.52
established the principle — *a warm must draw*, because ANGLE builds a vertex executable per vertex
input layout at the first draw that uses it — but the helper only un-hid the root's **ancestors**:

```js
for (let n = root; n; n = n.parent) { if (!n.visible) { n.visible = true; shown.push(n); } }
```

Every one of these pins runs with the ship in its THIRD-PERSON state, and the cockpit interior is
hidden there. So the whole seat — the `*_CP_*` meshes, the windshield, the screen glass — was
compiled and never rasterised by `_warmCloakForRoot`, the mirror-lift warm or `_ghostPinWarm`, and
paid for itself on the frame the pilot took the seat or first cloaked. `root.traverse` now shows the
descendants too, restored by the same `shown` list. One line, every caller fixed.

(v39.82 had already done this inside `_ghostPinWarm` / `_ghostPinWarmAsync`, which found it: the
namer caught `Vortex_CP_ScreenGlass` x2, `hull` x2, `basic` x2 and `depth` x1 linking together at
t=30.3 s in play, two of each because the ghost materials are transparent + DoubleSide and three.js
draws those in two single-sided passes. That change is kept — it also covers the `renderer.compile`
calls that run before the draw — but v39.83 is what generalises it.)

Pane after, across a tour that teleports around the hub while flipping between the seat and the chase
view and toggling fire every couple of seconds: **one** cold link, `depth [FORK: flags] x1`, a single
shadow-depth variant differing from a warm sibling by one boolean bit.

**Open, and the same family:** `_warmDrawRoot` pins `renderer.shadowMap.autoUpdate = false` so the
pass stays one cheap render — which means the *depth* variant of a cloaked or ghosted material is
never built. Letting one shadow update through during the cloak warm should close it.

## v39.84 — the shadow pass was the last thing the warm did not do

Owner's 39.83 F8 on the third-to-first-person switch: **2785.8 ms, entirely `renderFrame`**, with
exactly **one** cold program — and `coldNames` again showing nothing from that instant. This time the
absence resolves: the live tab has `__coldIds.size === renderer.info.programs.length === 250` and
only three named entries, all from the load, so no *unnamed* program object exists. The watcher's
clock starts when it arms (end of prebake) and the recorder's at page load; the offset makes the
watcher's `depth [FORK: flags]` at t 20.9 the recorder's +1 at t 50.42. **The 2.8 s frame is that one
shadow-depth program.**

Which is the item v39.83 left open, and the cause is the line right below the one it fixed:

```js
const sm = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
```

Freezing the shadow map keeps `_warmDrawRoot` to one cheap render, which is right for the dozens of
per-hull calls. But the sun's shadow pass draws with the **depth** material, whose program is keyed on
the real material's flags — and a ghosted or cloaked hull is *transparent*, a different depth key. So
that variant was never built by any warm and linked on the frame the state first showed: the seat.

`_warmDrawRoot(root, rt, withShadow)` now takes an opt-in third argument. `_ghostPinWarm` and
`_warmCloakForRoot` pass `true` — the two warms that change a material's transparency, and therefore
its depth key. Everything else keeps the single cheap pass.

Pane, clean load, tour flipping seat/chase and fire every couple of seconds:

| | programs behind the overlay | after it lifts | cold links in play |
|---|---|---|---|
| 39.82 | 190 → 246 | 246 → 248 | 7 at the first seat view |
| 39.83 | 190 → 248 | none | 1 (`depth [FORK: flags]`) |
| 39.84 | 140 → 216 | **none** | **0** |

Shadows still render and `shadowMap.autoUpdate` is restored to `true` after the warm.

### The countdown numbers

Owner: "also, i couldn't see the countdown numbers". The ROUND countdown is not missing — it is off by
design in this mode:

```css
body.lss-freeflight #ov-countdown { display: none !important; }
```

Confirmed on the owner's own tab: `body.className` is `cine-fx lss-freeflight lss-thirdperson`, and
`#ov-countdown` is `display: none` with its text sitting at "ROUND 1 3". The numbers they mean are
`#ship-select-countdown` ("3 ... LAUNCH", currently reading "LAUNCH WARP-IN"), which runs at ship
select *before* the loading overlay goes up — so a stall there skips them, and the warm work this
section is about is exactly what stalls. Nothing to fix in the UI.

## v39.85 — the cities were churning shader programs, and the watcher had gone home

The owner's "little hitch": 778.4 ms at t 423.5, entirely `renderFrame`, `hub:city` in its section
list, exactly **one** cold program — and once again no name. But this time the live watcher had
already written the whole story, 200 s earlier:

```
t 167.4  lambert [FORK: flags]
t 196.0  freed x1
t 226.0  lambert [FORK: flags] [RELINK]
t 230.3  freed x1
```

That is v39.81's id-watch doing exactly what it was built for: a program **built, freed, and rebuilt**.
Two separate bugs fall out of it.

**1. The watcher stops after five minutes.** The 300 s cutoff was fine when this only printed to the
console; the F8 mark has depended on it since v39.80, and the owner's hitch landed at t 423 s — long
after it had quit — which is why the mark came back with a cold COUNT and no name for the third time
running. It now runs for the whole session, dropping to a two-second poll after the first five
minutes. The poll is a Set diff over ~250 programs; at that rate it is free and still catches a link
inside the same F8 ring.

**2. `_owDrop` disposed every city material outright.** `_hcMakeMeshes` builds fresh
`MeshLambertMaterial`s per city site, and dropping a site called `m.dispose()` on all of them — which
frees their programs, so the next city to stream in relinks them cold, in play. `_hubCityDispose` did
the same. Both now free the per-site canvas textures (which are large and genuinely per-site) and hand
the material to **`_lssRetainMat`**, the v38.97 helper that keeps ONE material per real program key
(three's own, read from `renderer.properties`) and disposes every duplicate. Cost: a handful of
materials for the session. Benefit: no city ever relinks.

Measured in the pane by driving `HUBCITY.dispose()` / `HUBCITY.init()` in a loop:

| cycle | before | after dispose | after rebuild |
|---|---|---|---|
| 1 | 247 | 246 | 246 |
| 2 | 246 | 246 | 246 |
| 3 | 246 | 246 | 246 |

The first teardown retains one material per key; every cycle after it frees nothing and links nothing.
Before the change the same loop freed three programs per teardown.

**Not fully closed.** That artificial loop still reports one `lambert [FORK: outputColorSpace]
[RELINK]` per rebuild — the canvas (`srgb`) twin of a material whose render-target (`srgb-linear`)
twin is retained, freed and rebuilt while the total holds flat. In real play the hub city is built
once, and the streaming path is `_owBuild`/`_owDrop`, which the console cannot drive (`OW` is
module-scoped), so this needs the owner's next mark to confirm. With the watcher now alive for the
whole session, that mark will name it.

## v39.86 — the refraction copy was blitting the whole target, not the part being drawn

Owner: "it was choppy during the cinematic, and the countdown too, i could hear the sound for the
countdown were even off beat because of lag". The 39.85 mark says this is **not a hitch**:

| worst | avg fps | frames | cold links | long frames |
|---|---|---|---|---|
| 28.1 ms | 127 | 635 | 0 | none |

`big` and `lo` are both empty. What the ring holds is a run of seven 20-28 ms frames inside four
seconds — each one three or four dropped frames at 144 Hz, which is exactly what makes audio land off
the beat without anything ever freezing. Sustained GPU load, not a stall.

And the machine says so directly. `window.__ss` on the owner's tab mid-session:

```
scale -0.6   steps 7   backoff 8   ema 33.1 ms   hz 144
```

The v39.49 adaptive supersampler has backed off seven steps and is rendering into 1920x1080 of a
**4608x2592** allocated scene target — MEGA at a 1080p canvas with dpr 1.25.

Which is where v39.79's refraction copy was quietly expensive. `copyFramebufferToTexture` copies
`texture.image` worth of pixels, and the copy was sized to `rt` — so it blitted the **entire allocated
target every frame**, 11.9 MP, five sixths of it stale pixels outside the live viewport that the
shader clamps away anyway. On a machine already short of GPU that is a per-frame tax in exactly the
shape reported.

The copy is now sized to the live rectangle from `_lssSceneActive`, bucketed to 128 px so the
sampler's steps do not reallocate the texture as they move. `uSceneRes` becomes the copy's size and
`uSceneMax` the live fraction of it; `gl_FragCoord` is already in the live viewport's own pixels, so
the shader math is simpler than before, not more complex.

Measured in the pane forced to MEGA (target 3210x2064, the same ~5.7x ratio as the owner's):

| supersampler | live viewport | copy before | copy after |
|---|---|---|---|
| scale 0 | 1337x860 | 3210x2064 (6.6 MP) | 1408x896 (1.26 MP) |
| scale -0.6 (owner's state) | 936x602 | 3210x2064 (6.6 MP) | 1024x640 (0.66 MP) |
| scale 1 | 3210x2064 | 3210x2064 | 3210x2064 (nothing to save) |

⚠ **Not proven to be the whole cause.** The pane's GPU has headroom at these sizes — refraction on
143.9 fps against off 144.0, both at the cap — so the saving is arithmetic, not a measured framerate
win. What is certain is that the cost was real, self-inflicted by v39.79, and is now 6-10x smaller.
The underlying pressure is MEGA itself: a 4608x2592 scene target is what the sampler has been backing
away from all session. HIGH would drop that target entirely — the owner's call.

## v39.87 / v39.88 — the recorder could not see the chop band

Owner: "it was choppy during the cinematic, and the countdown too, i could hear the sound for the
countdown were even off beat because of lag" — then, after trying the obvious: "even though i put it
lower performance setting, it still did the same thing", and the right question: **"what should be
during the loading screen, and not during the cinematic?"**

**Why the quality setting did nothing.** The codebase already measured this, in the v35.22 note that
retired the LOW/MEDIUM tiers from the picker:

> this game is DRAW-CALL bound, not fill bound — the same reason dropping the render-resolution tier
> was measured to not move hub fps at all

So resolution is not the lever here, and LOW/MEDIUM are not even reachable from the UI (they migrate
to HIGH); a "lower setting" is MEGA → ULTRA → HIGH, all of which change pixels, not draw calls.
`applyQualityPreset` does resize the targets now (v38.64 `_doPostFXResize`), so the old "presets don't
resize mid-session" note is stale — it just does not address this.

**v39.87 — a cinematic resolution drop, built and left OFF.** The supersampler deliberately refuses
samples while `game.state !== 'playing'` or the cinematic is up (their frames are throttled and would
poison the EMA) — but the consequence was that the scale simply FROZE at whatever gameplay left, so
the most expensive view in the game ran with no adaptation at all. Dropping the scale for those
states is one clamp and a viewport change, and true foveation is not an option here: WebGL2 exposes no
variable-rate shading, and a low-res frame plus a high-res centre inset submits the centre's geometry
twice, which on a vista where terrain fills the frame costs more than it saves. **Default off**
(`window.__ssCine = null`) — the owner pulled back ("no... wait"), and the draw-call finding says it
would not have been the fix anyway. `window.__ssCine = -0.75` enables it; `__postFXInfo().cine`
reports it.

**v39.88 — profile the chop band, and summarise the run.** This is the actual gap. The recorder only
captured `__prof` section deltas for frames over **30 ms**, and the owner's chop frames were 20-28 ms
— so the mark recorded `worst 28.1 ms` with an **empty** `big` list: it could prove a run of frames
was late and not say which system ate them, three reports running.

- The threshold now tracks the display: `max(16, min(30, period * 2.2))` — **16 ms on the owner's
  144 Hz panel**, and never worse than the old 30 (at 60 Hz the formula would have risen to 36.7).
- A new `chop` field summarises the same 5-second window as one number per system, worst first,
  because with the threshold down there the interesting thing is no longer any single frame but where
  the milliseconds went across the run.

Pane, teleport tour to force streaming (artificial, but it proves the instrument):

```
chop: { n: 11, ms: 2237.5, by: [ ["hub:clip",1703.4], ["hub:weather",219.3],
                                 ["hub:critters",88.2], ["hub:ripple",43.9] ] }
```

Eleven late frames, 76% of the time in the terrain clipmap. **That is the shape of answer the owner's
question needs, and the next F8 taken during the real chop will give it for the cinematic.**

## v39.89 — the flock precompile was warming a variant the game never runs

Three F8 marks in a twenty-second window on 39.88, and the new `chop` summary named the middle one:

| at | worst | chop `by` |
|---|---|---|
| 173.1 s | 674 ms | `renderFrame` 680 |
| 185.6 s | **2112 ms** | **`hub:critters` 2109.7** |
| 192.1 s | 5746 ms | `renderFrame` 20.1 — the CPU was **idle** |

And the cold watcher had the cause written down beside it:

```
t 42.5  GPUComputationShader [FORK: outputColorSpace toneMapping]  x2
```

**That fork is v39.72's fault, and it is mine.** `_critterPrecompile` calls `renderer.compileAsync`
with whatever render target happens to be bound — at flock init that is the **canvas** — so it built
the `srgb` / tone-mapped variant of the two boids compute shaders, while `gpu.compute()` binds the
GPUComputationShader's own linear target and needs a different key. The gate that was supposed to keep
a rebuilt flock off the game thread warmed two programs the game never uses, and the real pair linked
on the first `compute()`: `hub:critters`, 2.1 s, in play.

Two fixes, both needed:
- **`toneMapped = false` on the compute materials.** They are data passes — tone mapping is
  meaningless for a velocity texture — and it pins that key term to `NoToneMapping` in every context,
  so the prebake's `compute()` prime and the in-play one can never disagree again.
- **Bind the target each job really draws into**, around the *call* (compileAsync does its
  synchronous compile at call time, so wrapping the promise would be too late): the GPGPU's own render
  target for the sim, `postFX.rtScene` for the render mesh.

Pane after: every GPUComputationShader program reports `toneMapping 0`, and **zero**
`GPUComputationShader` forks where the owner had two. A fresh load reaches the end of the loading
overlay at 246 programs and adds **none** after it lifts, across a tour that teleports the map and
flips seat/chase view: `cold 0`.

**The third mark is a different animal and still open.** 5745.9 ms of wall clock with `renderFrame`
at 2.5 ms of CPU, an empty long-animation-frame list and no cold link — the main thread was not busy.
That is the v39.52 signature: work inside the GPU process that no `renderer.compile()` can pre-pay.
Its `info` also shows the world shrinking around it (geometries 720 → 493, textures 120 → 99), so a
teardown was in flight. Next step is to catch it with the GPU timer rather than the CPU profiler.

## v39.90 / v39.91 — choppy at 144 fps is a clock problem, not a throughput problem

Owner: "the cinematic is still choppy (even though it's very high fps, like 120-144), and it misses
the count down still". High framerate plus visible judder rules out throughput and points at pacing.

**v39.91 — the cinematic camera was positioned from the wrong clock.** `_lssUpdateSpectatorCinematic`
computes a pure function of `elapsed`, which is the right shape — no per-frame smoothing, identical
across peers — but elapsed was measured with `performance.now()` read **inside the callback**. That is
not the frame's time; it is whenever the main thread reached that line, so it carries every
millisecond of jitter from whatever was scheduled ahead of it. A camera positioned from a jittering
clock and presented on a steady vsync judders at *any* framerate, which is exactly the report.
`requestAnimationFrame` already hands `gameLoop` the frame's own timestamp on the same time origin, so
it is now passed through; the watchdog path still falls back to `performance.now()`.

**v39.90 — the select-state 6 Hz gate, fixed but not the cause.** `_lssPickerOwnsFrame` deliberately
releases the frame the moment `#ship-select` goes `lss-launching`, and from then the select branch
drew the world through its 167 ms throttle — 6 fps — while the countdown owned the screen. Exactly the
v39.25b mistake one screen over ("the ship spinning looks choppy. It was 6 fps"). The gate now exempts
`_countdownActive` and `_cinematic.active`. ⚠ **But this is defensive, not the fix**: `commitLoadout`'s
own note says `game.state` is already `'warmup'` during the launch countdown, so the select branch is
not the one running then. Left in because the gate was wrong in principle.

**"Misses the countdown" — one concrete candidate, unconfirmed.** `_lssStartSpectatorCinematic` ends
with:

```js
const ov = document.getElementById('ship-select-countdown');
if (ov) ov.classList.remove('active');
```

so a cinematic beginning while digits are still running takes the overlay away and the rest are never
seen. That is the team-lineup path (`myTeamCode`, `sdfRoomData`), which is team-mode machinery — it
could not be shown to run in free flight from here, so it stays a candidate rather than a finding.

Pane on 39.91: boots clean, `cold 0`, no console errors, renders normally.

## v39.92 — the 3-2-1 was running inside a hidden parent

Owner: "the digits are not there, should be a count down after the cinematic... it makes the sound but
not the text". The sound and the text come from the same `tick()` in `launchCountdown`, so if one
happens and the other does not, the text is being written and never painted.

`#ship-select-countdown` is a **DOM child of `#ship-select`**, and
`_lssStartSpectatorCinematic` ends with:

```js
const sel = document.getElementById('ship-select');
if (sel) { sel.classList.remove('active'); sel.style.display = 'none'; }
```

Two hides in one line — the missing `.active` (the base rule is `display: none`) and an **inline**
`display: none` that outlives the cinematic and beats every class the countdown can add to itself. The
source warns about precisely this, twice:

> ⚠ Do NOT "fix" this by hiding #ship-select instead: #ship-select-countdown is a DOM CHILD of it ...
> so the 3-2-1 ticker would run inside a hidden parent  — the v36.19 note

> #ship-select is still `.active` on purpose — #ship-select-countdown is its CHILD, so the 3-2-1 dies
> if you display:none the parent  — the v36.21 note

Rather than chase every caller that might hide it, **the countdown now owns its container for its own
duration**: `.active` to make it displayable plus `lss-launching` (the v36.21 state, which hides the
header, body and hangar backdrop) so only the digits show over the live world. The previous state is
remembered and restored verbatim in `hideLaunchOverlay`, so a caller that meant the picker gone still
gets it gone the instant the digits finish.

Measured in the pane, DOM-level, reproducing what the cinematic leaves behind:

| | overlay computed | parent computed | actually on screen |
|---|---|---|---|
| before | `block` | `none` | **no** |
| after | `block` | `flex` | **yes**, 148x209 px |
| after restore | — | `none` | no |

The overlay's own `.active` was working the whole time; it was painting nowhere. And live through a
real launch:

```
53.20 s  visible  "3 LAUNCH IN"   #ship-select: lss-launching active
54.20 s  visible  "2 LAUNCH IN"
55.21 s  visible  "1 LAUNCH IN"
56.21 s  hidden                   state -> playing
```

**Still open:** the owner reports the cinematic is "still a little laggy ... but in a different spot"
after v39.91's timestamp fix. The v39.88 chop profiler now captures from 16 ms on a 144 Hz panel and
summarises a run by system, so an F8 taken during it will name what remains.

## v39.93 — the painted flavour of the seat was the other half

The 39.92 mark: **833.7 ms**, and the v39.88 summary named it in one line:

```
chop: { n: 2, ms: 875.5, by: [ ["hub:stream", 833.2] ] }     cold: [[49.58, 2]]
```

Two programs at the same instant, and the watcher again appeared to name nothing — until the clocks
are lined up. It arms at the end of the prebake, so its two `physical [FORK: customCacheKey]` entries
at t 7 are the recorder's t 49.5. **They are the same two.** `hub:stream` owns the frame because the
streamer's work and the link land together, not because the streamer caused it.

The fork is on the custom key alone: `ghostHull` against the default. v39.82/83 fixed the missing
half in one direction — everything in `_ghostPinWarm` runs with the seat shell APPLIED, and it now
draws the hidden cockpit while it does, so the `ghostHull` programs are built behind the loading
screen. But the cockpit's **painted** materials are only ever drawn when the pilot is actually in the
seat, so they met the frame for the first time in play.

One more `_warmDrawRoot` **after** `_ghostHullRestore`, with the interior still shown, covers it.

Pane, clean load then a tour that teleports the map (forcing `hub:stream`) while flipping seat/chase
and fire every couple of seconds: **`cold 0`**, program count flat at 245, no console errors. The two
`physical [FORK: customCacheKey]` links that had survived every build since v39.80 are gone.

## v39.94 — tearing the terrain down was the unbudgeted half

Two 39.93 marks, and the chop summary is unambiguous both times:

| at | worst | chop `by` |
|---|---|---|
| 29.6 s | **3015.4 ms** | `hub:stream` **3011.4** |
| 41.6 s | **1730.0 ms** | `hub:stream` **1729.3** |

The two cold programs beside each are the same pair the watcher logged at its t 7.7, i.e. incidental
— **3011 ms of a 3015 ms frame is the section's own CPU**, and the long-animation-frame entry agrees
(`user-callback` 3016 ms). This is not a shader compile. `updateSandwichStream` really did spend three
seconds on the main thread.

Building has been time-sliced since v39.49 (`_budgeted`, ~2.5 ms of shell rows a frame). **Tearing
down never was.** The dispose sweep walked every live chunk and freed everything outside the
hysteresis square in one pass, and the foliage loop — which plants one grass and one tree chunk per
frame — removed them without any cap at all. Fly fast enough and a whole rank leaves the square
together, so one frame frees dozens of geometries. The earlier 5746 ms frame with the CPU **idle** and
`info.geos` falling 720 → 493 is the same teardown seen from the GPU side.

Nothing on screen depends on an already-invisible chunk being freed *this* frame, so both are capped
(`window.__swDisposeMax` / `__swRemoveMax`, 3 each) and the remainder rolls to the next frame.
`_SC.idle` already keys off `_swDisposed`/`_swRemoved`, so a partial sweep re-runs immediately instead
of waiting for the player to move again. Loading paths (prebake, staging, swaps) keep the old
all-at-once shape.

Pane, six 16-20 km teleports in a row — far harsher than flying:

```
before:  hub:stream = the entire 3011 ms frame
after :  chop n 8 frames, 3188 ms total → hub:stream 45.6 ms
```

Headroom check: 3 disposals a frame at 144 Hz is 432/s, against ~42 chunks shed per boundary crossing
at 450 u/s. The chunk count settles at 491 (the view square plus its hysteresis band) and stays flat.

**Still open:** what dominates that artificial tour is now `renderFrame` and `hub:clip` — the clipmap
rebuilding wholesale after a 16 km jump, which normal flight does not do. And one
`lambert [FORK: flags]` still links when the tour crosses city sites (the v39.85 lane).

## v39.95 / v39.96 — `hub:stream` was taking the blame for the cloak warm

The 39.94 mark still read `hub:stream` 1205.8 ms, so v39.94's dispose budget was not the whole story.
Reproduced in the pane and instrumented per frame — and the section is innocent:

```
spike 1073.1 ms   state warmup   _swapStaging false  _rrStaging false
                                 _swPreloading false _worldPrebaking false   chunks 441
```

All four staging flags false (so the build path *was* budgeted) and 441 chunks already resident (so
there was nothing to build). The `hub:stream` mark does not wrap only the streamer: the warmup arm of
that section also runs `_warmCloakVariantOnce()` **and** the v39.49b late cloak re-warm,
`_warmCloakForRoot(player.mesh)` at `warmupTimer < 2` — the last two seconds of the countdown, on
screen. Suppressing that one call:

| | worst `hub:stream` frame at launch |
|---|---|
| with the late re-warm | **1073.1 ms** |
| suppressed | **77.7 ms** (the earlier intended warm, behind the picker) |

**Three F8 marks in a row pointed at the terrain streamer for work the streamer never did.** The
section name is the enclosing `__pmark`, not the callee.

**v39.96** takes the shadow half back out of it: `_warmCloakForRoot(root, withShadow)` now defaults to
the v39.84 shadow pass but the late re-run passes `false`. That pass exists to rebuild the TEXTURED
colour variants once the hull materials are final; the depth variant was already built behind the
loading screen. Worth ~70 ms of the second — the rest is ~40 transparent hull program links, which is
real work in the wrong place.

**Open, and the actual fix:** slice that late re-warm across the countdown's frames (or link it with
`compileAsync` and drop its draw, since the vertex layout was already built by the first cloak pass).
~1000 ms in one frame becomes ~8 ms across the window. Deliberately not attempted in the same pass as
everything else this session.

**v39.95 — the ship's random rotation at the end of the sequence.** The tick returned on the frame
`elapsed` passed `duration`, so the arrival blend's last applied value was the previous frame's, at
`b` a little under 1 — and `_lssEndSpectatorCinematic` then wrote the lineup mesh back to the pose
captured at cinematic START. For the player's own ship that is wherever it happened to be sitting, so
the hull snapped to a stale orientation for the frames before the rig took over. The last frame now
runs with `elapsed` pinned to exactly `duration` (b = 1, where the blended and gameplay poses coincide
by construction) and completes afterwards, and that frame writes the landed pose into `origPos` /
`origQuat` so the restore is a no-op. `elapsed` is also clamped at zero: `startMs` is a
`performance.now()` taken partway through a frame while v39.91's `frameMs` is that frame's start, so
the first tick could otherwise see a small negative value and swing the orbit backwards.

## v39.97 — the cinematic branch had no profiler marks at all

Owner, on elimination mode: "cinematic in elimination mode has some lag, too... will it be the same
fix?" — then, on a second run, "it might have been a fluke ... i didn't see a hitch in there a second
time".

**It would not have been the same fix.** The cinematic arm of `gameLoop` `return`s before every
`__pmark` in the main path, and the v39.96 late cloak re-warm lives past that return — so it cannot
run while a cinematic is up. Whatever elimination's cinematic costs, it is one of the calls inside
that arm or the render itself.

Which nothing could have told us, because that arm carried no marks. An F8 taken during any cinematic
came back with a frame time and no attribution — the same blind spot that produced the 5746 ms mark
with `renderFrame` at 2.5 ms of CPU. It is now instrumented: `cine:tick` (the camera/lineup update),
`cine:water`, `cine:ripple`, `cine:critters`, `cine:city`, `cine:weather` and `cine:render`. Free
flight never enters this arm, so the sections stay absent there; they appear the moment a team-lineup
cinematic runs.

Not chased further — the owner could not reproduce it. The marks cost one `performance.now()` each
and only while the profiler is on, so they can sit there until it recurs.

Two of this session's cinematic fixes DO carry over to elimination, since they are in the shared
`_lssUpdateSpectatorCinematic`: v39.91 (drive the camera from the frame's own timestamp instead of a
`performance.now()` read inside the callback) and v39.95 (land the arrival blend at b = 1 before
cutting, and clamp a negative elapsed).

## v39.98 — the countdown is its own element now

Owner: "you did something weird in the elimination mode... you made the ship selection screen appear
over top with a new countdown after round 2 starts". That is v39.92, and the mechanism is worth
recording because the shape of the mistake is general.

v39.92 fixed "sound but no text" by having `launchCountdown` force `#ship-select` visible for the
countdown's duration and put the previous state back in `hideLaunchOverlay`. **That restore is
time-blind.** In free flight the picker was hidden at capture, so restoring it hid it again — fine. In
elimination the picker is legitimately UP when the between-rounds countdown starts, so the capture
recorded `.active`; the round start then hid it, and the restore faithfully put `.active` back **on
top of round 2**. A save/restore pair is only safe when nothing else may touch the value in between,
and here the whole point of the window is that something else does.

So the dependency is removed instead of managed: `#ship-select-countdown` is a **direct child of
`<body>`**, not of `#ship-select`, and its CSS is `position: fixed` rather than `absolute` (it used to
resolve against the picker, which is fixed). Every caller may hide `#ship-select` however it likes
again, and the two standing warnings in the CSS — "⚠ Do NOT fix this by hiding #ship-select ... the
3-2-1 ticker would run inside a hidden parent" and the v36.21 note — no longer describe a hazard.
`launchCountdown` touches nothing but its own overlay.

Verified through a real launch, watching both elements every 40 ms:

```
21.42 s  visible  "3 LAUNCH IN"     #ship-select: lss-launching   box at 460,239
21.90 s  visible  "2 LAUNCH IN"     #ship-select: lss-launching
22.90 s  visible  "1 LAUNCH IN"     #ship-select: lss-launching
23.90 s  visible  "LAUNCH WARP-IN"  state -> playing
24.62 s  hidden
```

All three digits, viewport-centred (window 1070 wide, box left 460 for a ~150 px digit), and
`#ship-select` **never gains `.active`** at any point — which is exactly the regression.

## v39.99 — a late frame now says what it did to the GPU's resources

Owner: "little hitches at the end of matches". The mark, taken in `roundEnd`:

```
worst 277.7 ms   avg 107 fps over 534 frames   cold: []
chop: { n: 15, ms: 875.9, by: [ ["renderFrame", 45.3], ["hub:ripple", 17.6] ] }
```

Fifteen late frames totalling 876 ms, of which the profiler can account for **63 ms** — `renderFrame`
is ~3 ms of CPU per frame. No shader linked. The main thread was not busy. And the program count on
that tab had fallen from 246 during play to **184**: sixty-two programs released. That is a teardown,
and the cost is inside the GPU process where CPU profiling cannot follow it.

This is the fourth mark this session with that shape (the 5746 ms frame with `renderFrame` at 2.5 ms
was the same), so the recorder now records, for every late frame, **what changed in `renderer.info`
across it**: programs, geometries and textures, plus the draw calls and triangles issued.

```
res: [ [t, dPrograms, dGeometries, dTextures, drawCalls, triangles], ... ]
```

A negative triple is a teardown; a positive one is content arriving; zeros with a normal draw count
mean the frame was simply expensive to draw. A mark can no longer come back saying only "the CPU was
idle".

Also fixed: the v39.81 free-detector could print `freed x-6` — the count is monotonic in principle but
the id set is pruned as it grows, so the difference could go negative. Only increases are reported now.

**Not fixed:** the end-of-match hitches themselves. The evidence points at the match-end teardown, and
the v39.94 lesson (budget the destroy, not just the create) is the obvious shape of the answer — but
after three misattributions this session I would rather have the next mark name the resource than
guess which teardown it is.

## v40.00 — never two countdowns

Owner: "i noticed two countdowns one white one yellow, at the same time in the same spot". Both are
real elements and they belong to different moments:

| | element | look | position |
|---|---|---|---|
| ROUND countdown | `#ov-countdown` | white, 96 px, `.show` | `top: 40%` |
| LAUNCH countdown | `#ship-select-countdown` | yellow, 180 px, `.active` | `top: 50%` |

They never used to coincide — **not by design**, but because the launch one lived inside
`#ship-select` and was therefore invisible whenever the picker was hidden, which is exactly when the
round one runs. v39.98 moved it to the body to fix "sound but no text", and that accident of parentage
went with it.

Both are body children now, so a sibling rule restores what the DOM used to enforce:

```css
#ov-countdown.show ~ #ship-select-countdown { display: none !important; }
```

and `launchCountdown`'s `tick()` carries the same guard in JS (stand down if the round countdown is
showing) so it survives the markup moving again.

Verified at the DOM level and through a real launch:

| | white | yellow |
|---|---|---|
| launch countdown alone | not showing | **visible** |
| both requested | showing | **`display: none`** |

```
33.37 s  "3 LAUNCH IN"    round countdown not showing
34.37 s  "2 LAUNCH IN"
35.36 s  "1 LAUNCH IN"
36.38 s  "LAUNCH WARP-IN"  -> playing
37.09 s  hidden
```

⚠ The pattern to remember from v39.92 → v39.98 → v40.00: fixing a bug by removing an accidental
dependency also removes whatever that accident was quietly doing for you. Both times the accident was
`#ship-select`'s visibility standing in for logic nobody had written down.

## v40.01 — the end-of-match hitches are DOM, not GPU

The 39.99 `res` probe answered the question in one mark. Elimination, `roundEnd`:

```
worst 312.7 ms   avg 110 fps over 549 frames   cold: []
chop: { n: 10, ms: 965.1, by: [ ["renderFrame", 30.2], ["terrain+overlays+collisions", 6.9] ] }
res:  every entry [t, 0, 0, 0, ...]   ← no programs, geometries or textures changed hands
lo:   [t, duration 289, blocking 0, render 284, scripts: NONE]
```

So: not a teardown (the whole reason `res` exists), no shader linked, 37 ms of JS across ten late
frames — and a long-frame entry attributing **284 of 289 ms to the browser's RENDER phase with zero
scripts**. That is style/layout/paint, not WebGL and not the game's own code.

I also killed the obvious WebGL suspect by measurement rather than reasoning: at `roundEnd` the frame
goes through `cineFX.composer` (RenderPass + UnrealBloom + SMAA + OutputPass) instead of
`renderPostFX`, which looks like a lot more GPU work. Timed in the pane with `gl.finish()` either
side: **composer 1.01 ms, plain scene render 0.98 ms.** Not it.

What changes in the DOM at round end is the scoreboard: force-shown, and then rebuilt by the 5 Hz
`updateScoreboard()` refresh that exists for live kills and damage during play. At `roundEnd` and
`matchEnd` the numbers are final, so every one of those ticks rebuilt a 600 px panel for identical
content — and a DOM rebuild is paid in the browser's render phase on the *following* frame, which is
exactly why no profiled section and no script showed it. It now refreshes **once** on entering either
state and then stops until the state changes.

⚠ Note for reading `res`: `renderer.info.render.calls` is reset per `render()` call, so on a
composer frame it reports only the LAST internal pass (1 quad), not the frame's total. The resource
deltas are the trustworthy part.

## The skin lab — `LSS/skin_lab.html`

A standalone page for designing `SHIP_SKINS` entries against the real shader. Served from the same
root as the game: **http://localhost:8099/skin_lab.html**.

**It does not own a copy of the shader.** On load it fetches `lss.js` and extracts `_SKIN_HUE_PARS`,
`_SKIN_PAT_VERT`, `_SKIN_PAT_ID` and `SHIP_SKINS` from the shipped build, then patches a
`MeshStandardMaterial` with the same `onBeforeCompile` injection `_skinPatchHueShader` uses. A lab
holding its own copy of 121 lines of GLSL drifts the first time either side is edited and then lies
to you; this one cannot. If extraction fails the banner goes red and nothing renders, rather than
rendering something that is not the game.

It also mirrors `_skinBakePatternSpace` — pattern coordinates normalised by the hull's own longest
axis — so `patScale` means the same thing here as in game, on all seven hulls, and reproduces
`_applyShipSkin`'s field→uniform mapping exactly (including the factory snapshot and the
`emissive = skin floor + factory` add).

Controls are one-for-one with the table: hue / hueMix / sat / lift / mul, the five patterns with
c0-c2, patScale, both band thresholds, patSoft, patLift, patGain, patMix, and
metalness / roughness / envMapIntensity / emissive. Three lighting rigs (bright sky, dark cavern,
dusk) because the readability floor — `emissive` and `patLift`, the thing that stops a dark livery
vanishing in a cavern — is only decidable by looking at both. EXPORT writes a paste-ready entry.

⚠ The export emits the hue line for **pattern** skins too when it is doing anything. `_applyShipSkin`
sets `uSkinHue/Mix/Sat/Lift` regardless of the pattern and the camo shades against the already
hue-processed albedo, so a hue dialled in on a camo is load-bearing; the stock camo presets just
leave it at defaults, which makes the table look either/or when it is not.

Two traps hit while building it, both worth knowing before editing this file:
- the literal scanner must skip `//` comments — `strip.py` keeps trailing ones, and prose like
  "across the ship's longest axis" opened a string the scanner never closed, running the slice to the
  end of the file (971 KB instead of 6 KB);
- it must anchor on `const <name>`, not the first mention — `_SKIN_PAT_ID` appears inside
  `Object.keys(_SKIN_PAT_ID)` earlier, and starting there grabbed an empty `{}` that parsed fine and
  silently produced a table with no patterns. Both are now guarded, plus shape checks that refuse to
  start on a bad slice.

## v40.02 — shields reflect again, dimmed rather than hidden

Owner: "i don't see the reflection of shields in the water", then "we had this fix before ... look how
we did it in the previous version before we changed the water".

**Checked, and the water work is not the cause.** `git show cd20081:LSS/index-working.html` (v39.69,
the last build before the v39.73 water pass) carries the shield block byte-identical to the one that
was there before this change:

```js
const _shields = [];
if (ship && ship.userData && ship.userData.shieldMesh) _shields.push(ship.userData.shieldMesh);
if (player) { const _ak = ['_gunShieldMesh','_thermalShieldMesh','_vortexShieldMesh','_swordBlockMesh']; … }
```

Every bubble has been force-hidden from the mirror since **v33.79**, extended to every *other* ship's
bubble in **v38.67**. The reason is in that comment and it is a real one: a fresnel hologram is faint
face-on and BRIGHT at a grazing angle, which is exactly how the mirror camera — low, under the surface
— sees a bubble standing over the lake, so the water carried a hard rim that never appears in direct
view. Hiding them fixed a brightness problem by deleting the object, which is a big hammer.

Now they render, with their opacity scaled **for the pass only** — the same shape as the headlight
cone's `reflBoost`, in the other direction — and restored in the same `finally` as everything else.
`window.__water.reflShields = false` restores the v38.67 behaviour exactly; `.reflShieldDim` (0.45) is
the scale. A shield whose ShaderMaterial ignores `opacity` reflects at full strength, which is still
what was asked for; if one of them blows out at a grazing angle, that is the one to give a uniform.

⚠ One other thing did change about how reflections read, and it is worth ruling in or out by eye
before tuning this: before v39.73 the water's body was a flat painted blue, so the mirror was the only
real thing in it. It is now the **refracted scene**, and the two are still mixed by the same fresnel —
so at the shallow angle you get looking down at water, everything reflected reads weaker than it did.
`window.__water.refract = 0` A/Bs that in one line.

### v40.03 — and the PLASMA wall, which was the one actually being looked for

v40.02 gave the ship bubbles the dimmed treatment but left the Plasma Shield walls on their own older
knob (`__water.reflWalls`), which defaults to HIDDEN — so the shield the owner was looking at was
still missing ("nope, i can't see the plasma shield in the water reflection"). A wall is three meshes
(body, edge, plasma) and all three go through the same `_shTake` path now.

Verified in the pane by planting a probe `particle_wall` over the lake with an instrumented material,
so every write the mirror pass makes is recorded:

| setting | opacity writes | visible writes | result |
|---|---|---|---|
| default | `[0.36, 0.8]` | none | dimmed to 45% for the pass, restored — **it reflects** |
| `__water.reflShields = false` | none | `[false, true]` | hidden and restored — the v38.67 behaviour |
| `__water.reflWalls = true` | none | none | untouched — full strength in the mirror |

0.36 is 0.8 x the 0.45 dim, and the material comes back at 0.8 every frame. `cold 0` throughout.

## v40.04 — four owner-authored skins, and a livery whose hue never settles

The four entries designed in `skin_lab.html` are in `SHIP_SKINS` as written: **PURPLE TIGER**,
**HEX ALLOY** (`chromehex`), **MINTY** and **HUESHIFTER**.

**`hueCycle`, a new field: DEGREES PER SECOND on the hue wheel.** 24 walks the whole spectrum in
fifteen seconds; `hue` stays the phase the cycle starts from, so a paused cycle and a static livery
are the same entry. It writes `uSkinHue` and nothing else, which keeps it inside the rule that governs
this whole table — every field is a uniform, none appear in three.js' program cache key, and a livery
can therefore never fork a shader or bring back the first-sight compile hitch.

- `_skinCycle` holds uniform BLOCKS (one per skinned material, created once by `_skinPatchHueShader`),
  not materials. `_applyShipSkin` adds on a skin with `hueCycle` and removes on any other, FACTORY
  included. A block whose material is later disposed keeps taking one float write, which is harmless
  and bounded by the number of hull materials that have ever worn a cycling skin.
- `_skinHueCycleTick()` runs beside `_layeredFXTick` in `gameLoop` **and** in the ship picker's own
  rAF loop, so the livery keeps turning while you are choosing a ship and between rounds. It uses
  `performance.now()`, not `game.time`, precisely because the game clock is not advancing there.
- The lab has the same dial and animates it the same way, and its export round-trips `hueCycle`.

⚠ **HUESHIFTER as authored will not visibly cycle**, and this is a property of its own numbers, not of
the feature. `sat: 0` means the hue has nothing to colour: `lssSkinHue` ends on
`val * mix(vec3(1.0), hueColour, sat)`, so at zero saturation every hue renders the same grey.
`hueMix: 0.22` then applies only a fifth of the shift, and `patMix: 0.55` lays fixed hex colours over
the result. Verified both ways in the lab — at the authored values two frames a second apart are
pixel-identical; at `sat 0.85 / hueMix 1 / patMix 0` the hull swings teal → green in the same
interval, with the uniform reading 0.656 → 0.469 → 0.471. The dials that make it read are **sat above
zero** first, then **hueMix**, then lowering **patMix**.

The lab also gained `window.__lab` — `{ root, mats, hue, skin(), apply() }` — for checking that a
change reached the uniforms rather than just the sliders. That is how the above was measured.

### v40.05 — hueshifter updated, and the measurement behind why it looks static

The entry now carries the owner's values verbatim (`hue: 360`, name `hueshifter`, the fleet-issue
desc). `hue` is only the phase the cycle starts from, so 360 and 0 are the same starting point.

**The cycle is a continuous wrap, which is what was asked for.** `uSkinHue = ((base + rate*t) mod 1)`
runs 0 → 360 → straight back to 0 forever and never reverses. Verified in the running game, not just
the lab: with the skin equipped, `window.__skinCycle` holds **24** uniform blocks, `rate` reads
0.0667 turns/sec (= 24 deg/s), and sampling twice gives 55.9° → 58.8°.

**It is invisible at `sat: 0`, and that is arithmetic, not a bug.** `lssSkinHue` ends on

```glsl
return val * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), sat);
```

so saturation is the gate the hue has to pass through — at zero, every hue on the wheel renders the
same grey. `hueMix: 0.22` then applies only a fifth of the shift, and `patMix: 0.55` lays the fixed
hex colours over 55% of what is left. Tested four ways, all with the uniform confirmed cycling:

| hull | settings | two frames a second apart |
|---|---|---|
| VORTEX (near-black) | as authored | identical |
| BLASTER (bright) | as authored | identical |
| VORTEX | `sat 0.85, hueMix 1, patMix 0` | teal → green |
| in game, VORTEX | as authored | identical |

The dials, in the order that matters: **`sat` above zero** first (it is the gate), then **`hueMix`**
toward 1, then **`patMix`** down so the fixed camo stops covering the result. Live, without a rebuild:

```js
window.__skinTune('hueshift', { sat: 0.7, hueMix: 0.8, patMix: 0.3 })
```

### v40.06 — hueshifter's tuned values baked

`sat: 0.7, hueMix: 0.8, patMix: 0.3`, arrived at live through `window.__skinTune` and baked as
authored. Everything else in the entry is unchanged. In game with the livery equipped: 24 uniform
blocks in `_skinCycle`, the hue reading 92.5° then 322.4° then 323.4° across samples (wrapping, never
reversing), the hull visibly swinging through purple and magenta, `cold 0`, and no frame cost worth
measuring — the whole feature is one float written per hull material per frame.

### v40.07 — the stalls with nothing in them, and the probe that can tell them apart

Five F8 marks (#21–#25, build 40.06, classic on `shifting_deep`, round 1, played on the DEPLOYED
build at lss.fractalreality.ca) all say the same thing, and it is a *negative* result:

| mark | t | worst | blame | cold | res delta | LoAF |
|---|---|---|---|---|---|---|
| 21/22 | 44.28 s | **2313.6 ms** | renderFrame 4.7, hub:stream 2.7 | 0 | 0/0/0 | `[41.98, 2318, 0, 2302, [three.js rAF: 15 ms]]` |
| 22 | 46.27 s | 368.2 ms | renderFrame 3.7 | 0 | 0/0/0 | `[45.91, 371, 0, 362, [… 8 ms]]` |
| 23 | 77.49 s | 597.7 ms | renderFrame 2.7 | 0 | 0/0/0 | `[76.9, 598, 0, 592, [… 5 ms]]` |
| 23 | 77.96 s | 472.2 ms | renderFrame 3.0 | 0 | 0/0/0 | `[77.5, 470, 0, 465, []]` |
| 24 | 88.52 s | **1806.4 ms** | renderFrame 3.0 | 0 | 0/0/0 | `[86.72, 1808, 0, 1802, []]` |
| 25 | 176.15 s | **1806.5 ms** | terrain+overlays+collisions 3.7, renderFrame 2.5 | 0 | 0/0/0 | — |

Read that LoAF row: `duration 1808, blockingDuration 0, renderStart at +1802, scripts []`. A frame
1.8 seconds long in which **no script ran at all** and **no task exceeded 50 ms**. The `["user-callback","r",134224,…]`
entries in the other rows are three.js' own `WebGLAnimation` rAF thunk (char 134224 of
three.module.min.js r165) — i.e. the whole of `gameLoop`, at 5–15 ms. The profiler sections agree:
2.5–4.7 ms of CPU inside a 1806 ms frame.

So it is not our JS, not a shader link (`cold 0` every time), and not resource churn on the stalling
frame. Two stalls came back **1806.4 and 1806.5 ms**, 88 seconds apart — work varies, waits don't.

What the marks *did* newly reveal: the run-up to the 2313 ms stall is 2.3 s of steady 20.7–28.2 ms
frames (`avgFps 40`) with 3–5 ms of CPU in each. 20.8 ms is 3 × 6.94 and 27.8 is 4 × 6.94, so those
are whole missed vsyncs on a 144 Hz panel — **GPU-bound**, not CPU-bound. And `lss_quality` on that
machine reads **`mega`**: full supersample on an RTX 5050 Laptop.

Two stories remain and they want opposite fixes:

* the GPU was still chewing on work we gave it — our draw list, a driver upload, or an **ANGLE vertex
  executable built at first draw** (which `renderer.info.programs` cannot see, because the three.js
  program already existed); or
* the GPU finished on time and the browser never came back — compositor, present, power state,
  another process. Not ours, and worth knowing before chasing it.

**The probe** (all inside the `?pbhud` IIFE, nothing runs without the flag):

* **`made`** — `[t, dPrograms, dGeometries, dTextures]` on *every* frame that built something, not
  just late ones. `res` (v39.99) only samples late frames, so a geometry created on a normal 7 ms
  frame and first *drawn* on the next one was invisible: the stall frame reports 0/0/0 and the frame
  that actually loaded the gun is not in the list. Mark #21 hints at exactly that shape — the frame
  immediately before the 2313 ms stall created 4 geometries.
* **`gpu`** — `[tSubmitted, msToSignal]` from a `fenceSync` placed at the top of the recorder's rAF.
  That callback is registered at parse time and three.js' animation loop only when the game starts
  drawing, so it runs FIRST each frame: every command of the previous frame is already submitted when
  the fence goes in. ⚠ Polled once per rAF while frames are healthy, so a healthy reading is just the
  frame period (~14 ms) — an upper bound, not a GPU time. The reading that matters is the one taken
  *during* a stall, and rAF is by definition not running then, which is what the heartbeat is for.
* **`hb`** — a 4 ms `setInterval` that does not depend on frames being produced, logging its own late
  fires, and polling the fence every ~20 ms once a gap is already open (zero extra IPC in the steady
  state). **This is the discriminator.** If `hb` is empty beside a 1800 ms frame, the main thread
  never stopped and the stall is downstream of it; if `hb` stalls too, the whole renderer was
  descheduled and nothing in the page could have caused it. And whichever it is, `gpu` now says
  whether the GPU had already drained.
* **`q` / `px` / `hz`** — preset, `[canvas w, h, rtScene w, h, samples]`, panel refresh, so a mark
  stops needing a separate trip to localStorage to be read.

Boot-tested at 40.07: fence live, 300 samples, heartbeat 3 ms fresh, `made` logging (including the
−16/+15 texture swap at world load), no console errors, mark carries all seven new fields.

### v40.08 — the fence answered it: the stalls are the GPU, and the main thread never stopped

Marks #25–#28 on 40.07 (classic, `shifting_deep`, round 1, **local** build this time, fullscreen,
`q: mega`, `px: [1920, 1080, 4608, 2592, 0]` — a 1920×1080 canvas with an **11.9 MP** scene target).

The v40.07 probe was unambiguous:

| mark | stall | fence submitted before it | heartbeat |
|---|---|---|---|
| 25 | 1480 / **1917.7** ms | `[234.67, 1959.3]` and `[236.74, 1789]` | `[]` |
| 26 | **3411.4** ms | `[242.39, 3480.8]` | `[]` |
| 27 | **3508.7** ms | `[246.10, 3529.3]` | 61.6, 62.8 ms |
| 28 | **3383.4** ms | `[250.04, 3411.5]` | 51.3, 64.1 ms |

The fence placed *before* each stalled frame — covering the previous frame's already-submitted
commands — took **essentially exactly as long as the stall** to signal. Meanwhile the 4 ms heartbeat
kept firing through 3.4-second frames with at worst a 64 ms hiccup. So: the main thread never
stopped, the browser was not descheduled, and the GPU was genuinely busy for the whole stall. Every
LoAF row still reads `blockingDuration 0` with an empty or 6–20 ms script list, which is now
explained rather than mysterious.

Two more things fell out of it:

* **Even the healthy frames are deep in the queue.** Fence latencies between stalls run 41–118 ms at
  20.8 ms frame intervals — the GPU is routinely 2–6 frames behind. This machine is saturated at
  MEGA well before anything stalls.
* **The stalls sit on top of geometry bursts.** `made` (new in 40.07, logs every frame that builds
  something, not just late ones) shows the streamer creating ~30 geometries in the half-second before
  the 3411 ms stall (+5 +2 +4 +2 +2 −1 +1 +2 +2 +1 +2 +7, then +11 on the far side). `res` alone
  never saw those — they land on normal 7 ms frames.

What the data still cannot say is *which* GPU work. A fence measures the whole pipeline: our draw
list, the driver's residency and paging, an ANGLE vertex executable built at first draw. Those want
opposite fixes, so v40.08 adds the discriminator and two pieces of context the marks were missing:

* **`gt`** — `[t, ms]`, a `TIME_ELAPSED` query bracketing `renderFrame` only. `gt ≈ the stall` means
  the frame really did ask for that much shading (fewer pixels, fewer draws). `gt ≈ 20 ms` beside a
  3.4 s fence means the card was doing something our draw list never asked for, and shedding
  resolution cannot touch it. The query ends before the keep-warm burn so it can never overlap that
  pass's own query — only one `TIME_ELAPSED` may be active at a time.
* **`ss`** — `[_ssDyn.scale, active w, h, hz, steps]`. ⚠ `px` reports the **allocated** target, which
  at MEGA is 4608×2592 no matter what the adaptive sampler is doing; the live rectangle is
  `innerWidth × s` where `s = base + (super − base) × scale` (or `base × (1 + 0.5·scale)` below
  native). Without it a mark cannot say whether the governor had already shed — which decides
  whether a stall is fill rate at all. Related: `_lssSupersampleTick` discards every sample outside
  `2 ≤ dt ≤ 250`, so **the 3.4 s frames are invisible to the governor**; it only ever sees the 20.8 ms
  frames between them.
* **`kw`** — `[running, K, measured ms, cap ms]`. The keep-warm burner (v39.63) is GPU load this page
  adds *on purpose*, so a mark that blames the GPU has to be able to rule it out. Boot-test in the
  pane read `[1, 5951, 3.55, 4.17]` — 3.55 ms of burn against a 2–4 ms real frame.

Boot-tested at 40.08 in gameplay: `gtOk true`, steady 1.9–4.5 ms readings with a 17.3 ms spike,
fence and heartbeat unaffected, `ss` and `kw` populated, no console errors.

### v40.09 — what 40.08 measured, and the two holes it found in its own probe

Marks #29–#33 (40.08, classic, `shifting_deep`, round 1, `q: mega`, canvas 1920×1080).

**Ruled out, with numbers.** `kw` came back `[1, 50, 0.1, 4.17]` on the worst mark — the keep-warm
burner had already collapsed K to its 50 floor and was burning 0.06–0.93 ms. It is not the cause.
`programs` sat at 184 across every mark and `cold` stayed empty: no shader linking. `hb` was empty
on all five: the main thread never stopped.

**Not plain fill rate either.** `ss` (new in 40.08) shows the governor doing its job — mark 29 at
`[0, 1920, 1080, 60, 0]` (native), and by mark 30 at `[-0.6, 1344, 756, 144, 7]`, the floor, seven
steps down. Per-frame GPU cost duly halved, 14–17 ms → 6–10 ms. **The stalls survived the shed**:
3605 / 3696 → 2376 → 2390 → 1590 → 1027 ms. They shrink with resolution but nowhere near
proportionally, so pixels are not the whole story.

**The correlation that is left is geometry first-upload.** `renderer.info.memory.geometries`
increments in `WebGLGeometries.get()`, i.e. when a geometry is first uploaded for a draw — so `made`
is measuring uploads, not constructions. Mark 29: `+4 at 34.71`, stall frame at 34.83. Mark 30:
`+20 at 44.07`, stalled frame starts 44.09. Mark 32: `+2 +2` at 52.42/52.49, stall starts 52.64.
⚠ The sandwich streamer is *not* the source — it has been budgeted since v39.49 (one chunk in
flight, rows within `__swBuildMs` 2.5 ms), so it cannot produce +20 in a frame. Something else on
this map uploads in bursts; that is the next thing to find.

**The direct reading was 3658 ms inside `renderFrame`.** Mark 29's `gt` caught
`[34.83, 3658.3]` — one frame's own draw list costing 3.66 s of GPU time against a 14–17 ms
neighbour, and the 3696 ms rAF stall immediately after it is the CPU waiting on that queue. Marks
30–33 appeared to contradict it with 6–10 ms readings, but they did not: they were the probe's own
two bugs, both fixed here.

* ⚠ **`slice(-40)` was the wrong window.** At 7 ms a frame the last 40 entries cover 0.3 s of a 5 s
  mark, so in marks 31, 32 and 33 the stalling frame's own sample was cut out of the payload and
  only the healthy frames *after* it survived. `gt` and `gpu` now go through `_peaks()`: the 24
  largest readings in the window plus the last 8, de-duplicated, back in time order. A stall
  recorder must keep the peak, not the tail.
* ⚠ **`GPU_DISJOINT` was dropping the samples the probe exists to catch.** 40.08 discarded the whole
  batch whenever that bit was set — and the driver sets it when the GPU was interrupted mid-query,
  which is what a multi-second stall *is*. Samples are now kept with a third element flagging
  unreliability. An unreliable number of the right order of magnitude beats no number.

Boot-tested at 40.09: `gt` surfaced `[19.57, 2447.9, 0]` from a world-load frame — a 2.4 s
TIME_ELAPSED reading, disjoint flag clear, that the old window would have thrown away. `ss`, `kw`,
fence and heartbeat all still populate; no console errors.

### v40.10 — the lane is first-draw, and now the marks name the geometry

Marks #35–#36 (40.09, classic, `shifting_deep`, round 1, `q: mega`, `ss [0, 1920, 1080]` — native,
the governor had not needed to shed). With `_peaks()` and the disjoint flag in place the picture is
clean:

**Mark 35 — the direct confirmation.**
```
made  [30.34, 0, +4, 0]          4 geometries first-uploaded
gt    [30.36, 3652, 0]           20 ms later, one frame's own draw list = 3652 ms of GPU time,
                                 disjoint bit CLEAR, against 15.3-17.9 ms neighbours
gpu   [30.39, 3731]              the fence agrees
gap   [34.08, 3675.3]            and the rAF stall is just the CPU waiting on that queue
```

**Mark 36 — same trigger, cost landed elsewhere.**
```
made  [39.59, 0, +15, 0]         15 geometries first-uploaded
lo    [39.61, 2356, 0, 2342, …]  the stalled frame starts 20 ms later
gpu   [39.57, 2383]              fence matches the stall
gt    (no entry)                 its own draw list was under 18 ms, so it fell below the peak filter
```
So the cost is not always inside our command stream. A `bufferData` is asynchronous from the
driver's point of view — it copies to staging and the real VRAM work happens when the GPU needs it,
which can be a later frame and outside our `TIME_ELAPSED` bracket entirely. Same trigger, two places
for the bill to land.

Either way the trigger is now unambiguous: **a burst of geometries drawn for the first time, ~20 ms
before the stall, every time.** `renderer.info.memory.geometries` increments in
`WebGLGeometries.get()`, i.e. at first upload, so `made` was already measuring first-draw rather
than steady state. It is not the sandwich streamer — that has been budgeted since v39.49 to one
chunk in flight in `__swBuildMs` 2.5 ms slices and cannot produce +15 in a frame.

The standing suspect is **ANGLE building a D3D vertex executable per input layout at first draw**,
which three.js' program count structurally cannot see: the three.js program already exists, only the
layout is new. That is the same lane as the earlier "a warm must DRAW, not just compile" finding.

**`first`** (v40.10) answers the remaining question. `renderBufferDirect` is WebGLRenderer's single
funnel for object draws, so one wrapper catches every geometry the moment it is first submitted and
records `[t, object, material, attribute layout, verts, tris, instances]`. The attribute layout is
the part that matters — that string is exactly what forks an executable. Line it up with `gt` and
`made`: if the geometries in a stall frame carry a layout no earlier frame used, the fix is to draw
that shape once behind the loading screen. One Set lookup per draw call, `?pbhud` only.

Boot-tested at 40.10: probe armed, 699 unique geometries seen by warmup, entries reading like
`[22.85, "shield", "ShaderMaterial", "normal+position+uv", 425, 720, 0]`, no console errors.

### v40.10 marks — the owner's cold-start clue closes the case: compiled, never drawn

Owner, unprompted and decisive: *"if I play once and let it happen, then refresh the browser and play
again, it's less likely to happen. If I close the browser and start again, the big hitches happen at
the start."*

A page refresh keeps the same GPU process; closing the browser kills it. So whatever is being paid
for is cached **per GPU-process lifetime** — the ANGLE/D3D pipeline built for a given
(program × vertex input layout × render state), which is compiled by the driver on **first draw**,
not at link. That is why the marks look the way they do:

* `programs` sits at **184** across every mark and `cold` is always empty — three.js links nothing
  during play. All 184 programs already exist.
* Yet `gt` measures 3652 / 3491 / 3418 ms inside single frames, disjoint bit clear.

Both are true at once because **`renderer.compile()` links a program without drawing it.** The
prebake's `_prebakeGpuPrime` renders the live scene from 12 directions — and runtime FX are not in
the scene at that moment, so their programs get linked and never rasterised. This is the same trap
already recorded twice in this file (v39.83 cockpit interior, v39.84 depth variant): *a warm must
DRAW, not just compile.*

**What is first-drawn in play.** A live `renderBufferDirect` wrapper in the pane, 15 s of play,
aggregated by (geometry type, verts, material, uniforms) — 500 first-draws, the top of the list:

| n | geometry | verts | attribute layout | material | identity |
|---|---|---|---|---|---|
| 172 | BufferGeometry | 1681 | `color+position` | MeshStandardMaterial | `userData.isSandwichTerrain` — terrain shells (41²) |
| 111 | IcosahedronGeometry | 240 | `normal+position+uv` | ShaderMaterial `time,uBaseColor,uOpacity,uVRLite` | projectile body |
| 74 | BufferGeometry | 108/144/162/216 | `position+uv` | ShaderMaterial `uColor,uOpacity,uTime,uIsCore` | lightning halo + core |
| 28 | SphereGeometry | 187 | `normal+position+uv` | MeshBasicMaterial | — |
| 17 | SphereGeometry | 425 | `normal+position+uv` | ShaderMaterial `shieldColor,impact,uHitDirs,…` | `shield` |
| 17 | SphereGeometry | 117 | `normal+position+uv` | ShaderMaterial `uAxialFalloff,…` | layered FX |
| 4+2 | TubeGeometry | 186/276 | `color+normal+position+uv` **and** `normal+position+uv` | MeshBasicMaterial | trail — **two layouts, one material type** |

⚠ The lightning pool is the clearest instance of the trap in the codebase right now.
`_initLightningPool` builds 96 meshes with their real materials and a **placeholder geometry carrying
only `position`** — so anything that draws a pooled mesh before first acquire warms the *wrong input
layout*; the real bolts are `position+uv`. Note also that the pool reuses meshes and materials but
**rebuilds the BufferGeometry per bolt**, which is where the 74 distinct geometries come from.

**The fix that follows** is to make the prebake draw a representative of each runtime FX before the
12 prime renders, then tear them down — same shape as `_warmChargeGlowOnce` and the mirror-lift warm,
and the `first` field now tells us directly whether any first-draws still land in play afterwards.
Not yet written: each spawner needs its own harmless-arguments path, and a warm that fires a real
projectile or plays an announcer line during the loading screen would be worse than the hitch.

### v40.11 — the loading screen now warms what the game SPAWNS

Owner: *"I'd rather not have that huge hitch there every first load — we should always try to utilize
the loading screen to prepare the game for play."*

`_warmRuntimeFxOnce()`, called from `_prebakeGpuPrime` immediately after `_warmChargeGlowOnce` and
**before** the twelve prime renders, so anything these prototypes touch is warm by the time the wide
passes run. It builds one throwaway instance of each shape the marks showed arriving cold in combat,
draws them, and takes them all back out:

| prototype | why |
|---|---|
| `_makeRockGeometry(1,0)` + `_makeAtomFractalMaterial()` | the projectile body — Icosahedron 240 v, `normal+position+uv` |
| `TubeGeometry(curve, 30, 0.4, 5)` ×2, one with a `color` attribute | the trails — **both layouts**, `normal+position+uv` and `color+normal+position+uv`, on the same material type |
| `SphereGeometry(1.5, 16, 10)` + additive MeshBasicMaterial | the 187-vertex puff |
| `_lightningPool[0]` with a real `_buildLightningTubeGeometry` bolt | see below |

Three things make it correct rather than merely plausible:

* **A second material built from the same source shares the same `WebGLProgram`** — three.js keys
  its program cache on the shader text plus the defines — so a throwaway instance warms the pipeline
  the real spawn will use. This is why the warm does not need to reach the live material instances.
* ⚠ **The lightning pool is the trap in miniature.** `_initLightningPool` builds 96 meshes with their
  real materials and a placeholder geometry carrying only `position`, while a real bolt is
  `position+uv`. Drawing a pooled mesh as-is warms the *wrong input layout* and buys nothing, so a
  real bolt is built, hung on slot 0 for one draw, and taken back off (placeholder restored,
  `visible` false, geometry disposed).
* **`_warmDrawRoot` draws into an 8×8 scissored viewport.** Pipeline creation happens at draw-call
  validation, not per pixel, so eight by eight warms exactly what full screen would. The group goes
  through with `withShadow` true (v39.84: the depth material is keyed on the real material's flags,
  and a transparent additive prototype has its own depth variant).

Teardown is explicit: the group is removed from the scene, and ⚠ the atom-fractal factory registers
every material it makes in a list that is ticked every frame, so the throwaway is spliced back out of
`_atomFractalMaterials` **before** it is disposed.

Boot-tested at 40.11: `window.__fxWarm` = 6 (four in the group plus the two lightning meshes),
`__warmDraws` 35, reached `playing`, no console errors, no leftover group in `scene.children`, the
first `position+uv` bolt layout now drawn at t = 18.87 s — during the load, not in combat.

Still not covered, deliberately: the terrain shells (`color+position`, 172 of them) and the ship
shields (425 v) are already drawn by the prime and by `_warmDrawRoot(player.mesh)` respectively —
later instances share the program *and* the layout, so only the buffer upload is new. If the marks
still show a stall next to one of those, `first` will name it.

### v40.12 — the FX warm holds, and a second, CPU-side stall surfaces at round transitions

Marks #41–#45 on 40.11 (classic, `shifting_deep`, `q: mega`).

**The warm works, and mark 42 is the proof.** A full 5 s window with **40 lightning first-draws**
(`ShaderMaterial position+uv`, the 216/162/144/108 set) and a worst frame of **27.9 ms** — no stall,
no long frame, `big` empty. That is exactly the burst that used to cost seconds. The bolt layout is
now first drawn at t≈19 s, during the load.

**But three GPU stalls survived** — 41 (`gt [32.26, 3681, 0]`), 43 (`gt [40.51, 3270.3, 0]`),
44 (`gpu [49.69, 2292.7]`) — all with the heartbeat clean, so still GPU-side, still no cold links,
`programs` flat. And ⚠ mark 41's stall has **no first-draw anywhere near it**: nothing was created
between 31.6 s and 36.0 s, and the frame at 32.26 still cost 3.68 s of GPU time on its own draw list.
So first-draw is *a* trigger, not the only one, and the input-layout theory does not cover 41.

**Mark 45 is a different bug and it is CPU-side.** Round-2 warmup, two consecutive multi-second
main-thread blocks:
```
big  86.06  2480.7ms  hub:ripple:71.3
big  89.81  3758.7ms  hub:ripple:3750.8
lo   [86.06, 3755, 3704, 1, [gameLoop: 3753 ms]]      blockingDuration 3704, script 3753
hb   [[86.06, 2484.5], [89.82, 3760]]                 the 4 ms heartbeat stalled too
```
Everything the GPU stalls are not: the script itself ran for 3753 ms and the heartbeat stopped with
it, so the main thread was genuinely stuck — and `hub:ripple` owns 3750.8 of the 3758.7 ms frame.

⚠ `hub:ripple` was one section over five different jobs, and one number across all five cannot say
which. They fail differently and want different fixes: `_swRippleMaskJobTick` is budgeted to 1–4 ms
and tests the clock every fourth row, so it can only overrun by one long ROW, whereas
`_swRippleBakeMask` / `_swRippleBakeFarMask` on their synchronous paths bake a whole 96×96 grid of
`_stGroundYCarved` queries inside a single call. Split into `rip:near` (the near recentre decision and
its `syncBake` path), `rip:far` (the far recentre decision, **including the synchronous first bake**)
and `rip:job` (the budgeted row job); `hub:ripple` now measures the remainder — the ship-wake seeding
and the sim step. One `performance.now()` each, profiler-only, and the F8 recorder picks them up with
no change of its own because it walks every key in `window.__prof`.

Boot-tested at 40.12: `rip:near 1.8`, `rip:far 0.5`, `rip:job 9.7`, `hub:ripple 446.1` cumulative
over ~15 s of play — the bulk is in the remainder, which is the normal per-frame sim. No errors.

### v40.13 / v40.14 — the governor was blind to the stalls, and climbing through them

Marks #46–#50 on 40.12 are a **metronome**: stalls at 28.46, 32.45, 36.33, 40.23 and 44.2 s —
1563 / 2160 / 1896 / 2855 / 2487 ms, one every ~3.9 s, roughly half the wall clock spent stalled.
All GPU (`gt` 2149 / 1870 / 2839 ms, heartbeat clean, `cold` empty, `programs` flat at 183).

The new thing the marks showed is what the **supersample governor** was doing through all of it:

```
mark 46  ss [0,    1920, 1080, 60,  0]     native
mark 47  ss [0.05, 2054, 1155, 60,  1]     climbing
mark 48  ss [0.25, 2592, 1458, 144, 5]     2592x1458 — while stalling 1.9 s every 4 s
```

⚠ **`_lssSupersampleTick` discards every frame outside 2–250 ms.** That filter is right in itself — a
tab switch or a load hitch would poison an EMA — but every one of these stalls went straight in the
bin, and it is worse than merely invisible: the frames immediately *after* a stall are fast, because
the GPU queue has just drained, so the EMA read healthy and the ratchet **crept up**. The governor
was raising the resolution on a machine that was stalling two seconds at a time.

**v40.13** keeps refusing the sample but remembers the fact of it (`S.stallT` / `S.stallN`, visible
frames only). A stall inside the last 4 s is over budget by itself at both thresholds, and the
creep-back is blocked while it stands, so one shed per decision tick and no climbing out of a
stalling patch. It decays after 4 s so a single hiccup cannot park the resolution. `ss` gained a
sixth element, the stall count.

**v40.14** answers *"it lags right from the countdown"*. The countdown and the cinematic are
`game.state !== 'playing'`, where the sampler returns early — which left the scale **frozen at
whatever combat last set**, and mark 48 caught that at 0.25. The mechanism to fix it already existed:
v39.87's `__ssCine`, built when the owner asked for "something like foveated rendering for the
cinematic" and then left default-off when they pulled back ("no... wait"). Its default is now **0 —
native, not below it**. v35.22's "this game is DRAW-CALL bound, not fill bound" was measured on the
HUB; on `shifting_deep` at MEGA this machine is plainly fill-bound (20.8 ms frames with 3 ms of CPU,
the GPU 2–6 frames deep in its own queue even between stalls). `window.__ssCine = null` restores the
old freeze; `-0.75` goes below native.

Boot-tested at 40.14 on **MEGA** (the configuration this targets), not just the pane default:
`px [1352, 860, 3246, 2064]` with `ss [0, 1352, 860]` during warmup — the active rectangle is native
while the allocated target is the full MEGA one, a 5.8x pixel reduction in exactly the phase that
lags. On entering `playing`, `cineSaved` returned to null and the scale was released (`steps` 8,
ema 7.0 ms, `gtMax` 5.4 ms, `stallN` 0). No console errors.

Neither of these removes the underlying stall — they stop the game making it worse, and take the
countdown out of the worst case. ⚠ Mark 41 (v40.11) still stands as the counter-example to the
first-draw theory: a 3.68 s draw list with nothing created anywhere near it.

### v40.15 / v40.16 — it is not our draw list, and not the resolution

Marks #51–#53 on 40.14. Two things settle here, both against earlier working theories.

**1. The stall is not our GPU commands executing.** With `_peaks()` keeping the largest sample in the
window, mark 53 has both numbers for the same frame:
```
gpu  [38.27, 3377]     the fence took 3377 ms to signal
gt   [38.28, 22.5, 0]  that frame's own draw list: 22.5 ms of GPU time, disjoint clear
hb   []                the 4 ms heartbeat never missed a beat
```
Mark 52 is the same shape: fence 3737.8 ms, `gt` 16.5 ms. ⚠ **`TIME_ELAPSED` counts GPU EXECUTION,
not the GPU process's own CPU work.** Driver-side work — pipeline building, resource transitions, a
flush forced by freeing something still in flight — sits in exactly the blind spot where LoAF sees
nothing (`blockingDuration 0`, empty script list), TIME_ELAPSED sees nothing, and the fence sees all
of it. That is the whole fingerprint.

**2. It is not the resolution.** Owner: *"it's not the resolution/bloom... it never did this
before."* The data agrees, and it is the v40.13 governor fix that proves it: mark 53 reads
`ss [-0.2, 1728, 972, 72, 4, 2]` — the stall counter drove it two steps **below native** — and the
stall on that very frame was still 3307 ms. Shedding pixels changes nothing.

**3. The browser split.** Owner: the DuckDuckGo browser does not hitch; Edge and Chrome do. All three
are Chromium; what differs is which GPU Windows hands them and which ANGLE/D3D path they take. Taken
with "it never did this before" and with the fact that it only shows on a water map, that points at
the one thing this session added to the per-frame water path.

**v40.16, grow-only refraction copy.** ⚠ v39.86 rebuilt `postFX.rtRefractCopy` whenever the bucketed
live rectangle *changed* — either direction. That was fine while the adaptive supersampler moved once
a minute; it is not fine now that it moves on every stall. **Destroying a multi-megabyte GPU texture
that in-flight commands still reference forces the driver to flush and synchronise**, on the GPU
process's own CPU — invisible to LoAF, invisible to TIME_ELAPSED, and it stalls the fence. And each
shed the governor takes crosses a 128 px bucket, so shed → reallocate → stall → shed feeds itself.
The copy now only ever grows: a slightly larger blit than strictly needed (the shader clamps to
`uSceneMax` regardless) in exchange for a texture allocated a handful of times per session and never
freed under a live frame. `window.__waterCopyGrow = 0` restores the exact-fit behaviour for an A/B;
`window.__waterCopyAllocs` counts allocations.

**v40.15, the first-draw probe keys on the PIPELINE, not the geometry.** v40.10 keyed on
`geometry.uuid`, which made the list useless for its own purpose: the lightning system builds a new
BufferGeometry per bolt, so every bolt read as a "first draw" even though its program and layout were
warmed behind the loading screen — marks 51–53 are pages of those, drowning anything real. The key is
now what a driver would key on: shader + input layout + blend/depth/side/index/instanced state. New
field `pipes` = distinct pipelines drawn since load; **if `pipes` is flat across a stall, that frame
drew nothing the driver had not already built, and no amount of warming can help it.**

Boot-tested at 40.16: `__waterCopyAllocs` 1 (was one per bucket change), `pipes` 272 with exactly one
new pipeline in the last 5 s — the keep-warm burner's own quad — and `refractInfo` live. No errors.

### v40.17 — the DuckDuckGo control mark, and what it rules out

The owner pressed F8 in the DuckDuckGo browser "in a similar spot in the gameplay, even though there
wasn't a glitch". ⚠ Its marks are in **its own** storage:
`AppData/Local/Packages/DuckDuckGo.DesktopBrowser_ya2fgkz3nks94/LocalState/DDGWebView/Default/Local Storage/leveldb`
— the same LevelDB reader, pointed at that directory.

Same build (40.16), same MEGA preset, same 1920×1080 fullscreen canvas, the same 4608×2592 allocated
target, same dpr 1.25, same 144 Hz panel, same 350 u/s of flight:

| | Chrome (marks 51–53) | **DuckDuckGo (control)** |
|---|---|---|
| worst frame | 3717 / 3717 / 3307 ms | **117 ms** |
| `gt` peak | 22.5 ms (fence 3377) | **43 ms** (fence 172) |
| `stallN` | 2 | **0** |
| avg fps | 8–18 | **70** |
| `cold` / `programs` | [] / 184 | [] / 182 |
| new pipelines in window | ~0 | **5, none of which stalled anything** |

So the same workload, the same quality preset and the same card produce no multi-second stall in a
different browser — and five *new pipelines* were built mid-play there without one. That is strong
evidence against every theory that blames the game's own draw work, and it is consistent with the
fence/`gt`/heartbeat split (v40.16): the time is going somewhere only the GPU process can see.

⚠ **The control is not yet clean: the map differs.** Every Chrome mark since #21 is `shifting_deep`;
the DDG mark is `hourglass`. Browser and map are perfectly confounded, so the next comparison has to
hold the map fixed. (`hub:ripple` appears in the DDG chop at 75.9 ms over 28 frames, so water is
running there too, which weakens the confound but does not remove it.)

**v40.17** puts the two variables that now matter into every mark, cached after the first call:
`gl` (the `WEBGL_debug_renderer_info` unmasked renderer — all three browsers are Chromium, so a UA
string alone would not separate which GPU Windows handed them) and `ua` (userAgentData brands).
Boot-tested: `gl` "ANGLE (NVIDIA, NVIDIA GeForce RTX 5050 Laptop GPU (0x00002DD8) Direct3D11 …",
`ua` "Not/A)Brand 99, Chromium 148". No errors.

### v40.18 — the map is ruled out; it is the browser, and the allocation is still untested

Owner tried both maps, and `window.__water.refract = 0` changed nothing. Marks #54–#57 are Chrome on
**`hourglass`** — the same map as the DuckDuckGo control:

| | Chrome 152 / `hourglass` | DuckDuckGo / `hourglass` |
|---|---|---|
| worst | 1625.9 / 3446.1 / 986.6 ms | **117 ms** |
| fps | 51 / 12 / 67 | **70** |
| `gt` peak | 16.9 / 26.2 / 156.4 ms | 43 ms |
| fence peak | 1660.5 / 125.3 / 1181 ms | 172 ms |

Same machine, same card (`gl` = "ANGLE (NVIDIA, NVIDIA GeForce RTX 5050 Laptop GPU … Direct3D11"),
same build, same MEGA preset, same map. **The map is out. The variable is the browser** — Chrome 152
against DuckDuckGo's WebView2.

Two details worth keeping:

* ⚠ Mark 56's 3446 ms frame has **no section blame, no multi-second `gt` and no multi-second fence** —
  `gt` peaks at 26.2 ms and the fence at 125.3 ms in the whole window. Marks 52/54/57 do show the
  fence catching it (3377 / 1660.5 / 1181 ms). So even the fence does not always see it, which puts
  the time outside the GL timeline entirely.
* ⚠ **"Not the resolution" is only half tested.** The v40.13 governor moves the *viewport*
  (`ss [-0.6, 1344, 756]` in mark 57) — `px` shows the **allocated** target sitting at 4608×2592 in
  every one of these marks regardless. Only a preset change shrinks the allocation and the whole post
  chain with it, and `applyQualityPreset` cannot resize render targets mid-session (v37.14). So a
  MEGA→HIGH run is still an untested and *different* experiment from anything the governor has done:
  it tests the allocation, not the fill rate.

**v40.18** records the live knobs in every mark (`flags`: refract, disp, reflShields, copyGrow,
copyAllocs, kwOn, ssCine, ssMin, fxWarm, warmDraws). Marks 54–57 cannot say whether
`__water.refract = 0` was still in force when they were taken, which makes them unusable as evidence
either way — any knob that changes what the GPU is asked to do belongs in the payload, not in memory.
Boot-tested; `flags` reads back with `gl` and `ua` beside it.

### v40.19 — FOUND IT: the crest-spray readback blocks on the command-buffer flush

Marks #58–#60 (Chrome 152) against DDG #3–#4 (Chromium 151), same card in both — `gl` reads
"ANGLE (NVIDIA, NVIDIA GeForce RTX 5050 Laptop GPU … Direct3D11" on **both**, so the GPU-assignment
theory is dead too.

⚠ **Mark 58 is `q: high`** — `px [1920, 1080, 1536, 864, 0]`, a 1536×864 target, not MEGA's
4608×2592 — **and it still stalls 1403.5 and 1556.2 ms.** Resolution is out, allocation and all.

And this time the stall is named, because v40.12 split the section and v40.07 added the heartbeat:
```
mark 58   big  27.05  1403.5ms   hub:ripple: 1398.3      hb [[27.06, 1416.5]]
mark 60   big  37.09   493.1ms   hub:ripple:  488.9      hb [[37.10,  507.5]]
```
`hub:ripple` owns essentially the whole frame, and the 4 ms heartbeat stalls alongside it. **Main
thread, not GPU execution.** Which is why it survived every GPU-side theory, survived
`__water.refract = 0`, survived both maps and survived the drop to HIGH.

**The cause is written in the codebase's own v39.49b comment**: *"the async readback CALL blocks on
Chrome's command-buffer flush whenever the GPU queue is deep"*. The crest-breaking rule pulls a fixed
**128×128 RGBA float** (256 KB) off the ripple heightfield to find pitching wave crests. v38.61 moved
it to `readRenderTargetPixelsAsync` so the *data* arrives a step late — but the **call itself** still
forces Chrome to flush the command buffer, and that flush waits for whatever is queued. The owner's
fence readings run 40–120 ms between stalls, so it is waiting on frames of work, not milliseconds.
Everything fits:

* **fixed 128×128** → resolution cannot touch it. ✓ HIGH stalls identically.
* **flush depth** → browser-dependent, Chrome 152 vs Chromium 151. ✓
* **self-feeding** → a blocked frame queues more work, deepening the queue for the next call.
* **"it never did this before"** → the v39.73+ refraction work deepened the per-frame queue this call
  now waits on.

**The fix.** v39.49b's adaptive cadence doubles the interval to a cap of 32 steps — which only makes
a multi-second stall rarer, never absent. A call costing more than **50 ms** now switches the rule
**off** for a backing-off window (4 s, doubling to 60 s), and one cheap call resets it. A machine that
cannot afford this loses the crest spray instead of the frame. The synchronous fallback gets the same
cutoff — it is only reached when the async path has failed, which is exactly the machine that can
least afford a pipeline flush. `flags` now carries `crestBreak`, `crCost`, `crSkip`, `crOff`,
`crOffN` so a mark says whether the rule was on and what it cost.

Boot-tested at 40.19: `crCost 1` ms, `crSkip 4`, `crOff 0`, `crOffN 0`, 82 reads — the rule runs
normally when it is cheap, and the cutoff sits armed. No console errors.
`window.__water.crestBreak = 0` turns it off outright.

### v40.20 — incognito Chrome does not hitch: the cause is outside the page

Owner: *"I ran it in an incognito Chrome window and it didn't hitch."* Same Chrome 152, same profile
binary, same RTX 5050, same build, same map, same preset. Incognito differs in two ways that matter:
**extensions are disabled by default**, and the profile's caches are fresh and in-memory.

That is now three independent controls, all pointing the same way:

| control | result |
|---|---|
| DuckDuckGo (Chromium 151, same card) | worst 117–170 ms |
| Chrome at HIGH (1536×864 target) | still stalls — resolution out |
| **Chrome incognito** | **no hitch** |

And it matches what marks #63–#66 could not explain: a 2007.8 ms frame with `hb` **empty** (the 4 ms
heartbeat never missed a beat, so the main thread was alive throughout), `gt` 26 ms, the fence 69 ms —
and ⚠ **`lo` empty, no long-animation-frame entry at all for a two-second frame**. LoAF reports
frames; if the browser never scheduled a rendering opportunity there is nothing to report. Nothing
inside the page was slow. The page simply was not asked to draw.

⚠ The v40.19 crest cutoff is working and is not this: `crCost` 13.3–14.9 ms, `crSkip` 32, `crOff` 0,
`crOffN` 0 — the readback is behaving and `hub:ripple` has dropped out of the blame entirely. It was
a genuine 1.4 s stall in marks 58/60 and it is fixed; it was not the only one.

**v40.20** adds the probe that names this class outright, driven from the heartbeat because that is
the one clock that survives a stall the rAF cannot see:

* **`ticks`** — `[rAF ticks, 4 ms beats, current state]` over the mark's life. If `raf` is far below
  `beats / 4`, the browser stopped scheduling frames whatever the page was doing. Boot-tested in the
  hidden pane, which is exactly that case: **`[12, 964, "hfsp"]`** — twelve frames against 964 beats.
* **`foc`** — `[t, state]` on every transition: visibility + focus + fullscreen + battery, e.g.
  `"vFSp"` = visible, Focused, fullScreen, plugged; `"vfSB"` = lost focus, on Battery. The pane's own
  v↔h flapping every 2 s shows up correctly.
* **`flags.onBattery`** — Chrome's energy saver throttles rendering on battery and the game already
  tracks `_lssOnBattery`; it belongs in the payload.

Next mark from a stalling Chrome window settles it: `raf` collapsing against `beats` means the
browser stopped drawing, and the bisect is `chrome://extensions`, not this file.

**Edge, and reading marks from other browsers.** Edge's copy had been compacted into a
snappy-compressed `.ldb` SSTable, so the `.log` reader found nothing — `read_f8_ldb.py` (a minimal
snappy decoder plus a brute-force block-start scan) gets it out. Its three marks are build **40.14**,
i.e. *before* the v40.19 crest fix: 200–700 ms stalls, `hb` empty, `gt` up to 613 ms, fence up to
833 ms — the same class as Chrome's, milder. ⚠ A mark taken moments ago is still in the memtable and
not on disk at all. **The reliable cross-browser route is `window.__f8log.export()`**, which drops a
JSON into Downloads that can be read directly, with no LevelDB archaeology and no waiting for a flush.

### v40.21 — incognito stalls too, so the profile theory is dead; and the recorder itself is now testable

⚠ Correction to the v40.20 entry: the owner removed the extensions and Chrome still stalled, then
**incognito started stalling as well**. The clean incognito run was not reproducible. Extensions, the
profile and its caches are all out. What survives every control is the browser build itself:
**Chrome 152 and Edge stall; DuckDuckGo (Chromium 151) does not**, same machine, same card, same
build, same map, same preset.

DDG mark #5 (40.20) is the healthy reference the `ticks` probe was built for:
`ticks [2547, 4396, "vFSp"]` — 4396 beats is ~17.6 s, and 2547 rAF ticks over 17.6 s is a full
144 Hz. Frames are being scheduled normally, `foc` is empty, `worst` 212.8 ms, 100 fps, `crCost` 1.2.

⚠ **And the recorder has never been ruled out as a contributor to what it measures.** Two of its
probes ask the GPU process a question every frame and wait for the answer — `getSyncParameter` on the
v40.07 fence, `getQueryParameter` draining the v40.08 TIME_ELAPSED queries. Both are synchronous
round trips across the command buffer, which is precisely the mechanism the v39.49b crest note
describes and precisely what this investigation has been chasing. Every mark taken all session has
had `?pbhud` on.

**`?pbhud&nogpu`** (or `localStorage lss_nogpu = '1'`) keeps everything that costs only a
`performance.now()` — the gap ring, section blame, LoAF records, `made`, the heartbeat, `pipes`,
`foc`, `ticks` — and drops the fence and the frame timer entirely. If the stalls survive it, the
recorder is innocent and every mark stands. If they do not, they were never the game's.
`flags.noGpu` records which mode a mark was taken in. Boot-tested: `noGpu true`, `__f8gt` absent so
gameLoop skips the bracket, `gpu`/`gt` empty, everything else still populating.

**Reading marks from another browser:** `window.__f8log.export()` drops a JSON into Downloads. A mark
taken moments ago is still in the memtable and not on disk — Chrome's newest were unreadable this
turn for exactly that reason, and Edge's newest on disk was still 40.14.

### v40.21 marks — the recorder is innocent, and the main thread does sometimes freeze

⚠ **`flags.noGpu = 1` and it still stalls**: 1743.9, 4008.7 and 2897.4 ms with the fence and the
frame timer both disabled. The recorder's synchronous GPU-process round trips are not causing this
and every mark taken all session stands.

And mark 2 is a shape none of the earlier ones had:
```
big  38.38  4008.7ms  renderFrame:2.5     the only blamed section, 2.5 ms of it
hb   [[38.41, 4038]]                      ⚠ the 4 ms heartbeat stalled 4038 ms
lo   []                                   no long-animation-frame entry at all
ticks [3774, 8018, "vFSp"]                ~118 Hz of rAF across the mark otherwise
```
The heartbeat stopping means the **main thread genuinely froze for four seconds** — but no LoAF entry
was produced and no profiled section accounts for it, so whatever blocked it was not inside an
animation frame and was not our JS. Earlier marks (52, 53, 63) had the heartbeat *clean* through
their stalls. So there are at least two distinct residual shapes, and they need different answers.

⚠ Chrome 152's `#use-angle` offers only **Default / D3D11 / D3D11 WARP** on this machine — no OpenGL
or Vulkan backend — so the "switch the ANGLE backend" test is not available (WARP is software
rasterisation and would not run at a speed that proves anything).

**On "why isn't it saving properly?"** — it was saving; the reader was broken. `localStorage` is
durable to the page immediately, but Chrome's storage service batches the flush to LevelDB, and
LevelDB pads and *recycles* log blocks. `records()` used to `break` on the first malformed or zeroed
record, which threw away everything after it — i.e. exactly the newest writes. It now skips to the
next 32 KB boundary and keeps going, and also guards zero-length and over-long records. The four
40.21 marks came straight out of `000004.log`, thirty seconds after they were taken.

### v40.22 — the trace ends it: `getProgramInfoLog`, 92% of a four-second frame

The owner's Chrome DevTools trace settles a day of theories in one line.

```
22.64s  RunTask 2555.5 ms  Renderer/CrRendererMain   (PageAnimator -> FireAnimationFrame -> v8.callFunction)
22.67s  GPUTask 2513.4 ms  GPU Process/CrGpuMain     alongside it
30.03s  RunTask 4014.0 ms  Renderer/CrRendererMain
30.06s  GPUTask 3925.1 ms  GPU Process/CrGpuMain     alongside it
```
And the V8 sampler in the same trace says exactly where those four seconds went:
```
6909 of 7487 samples (92%)  getProgramInfoLog
stack:  getProgramInfoLog <- Ml.getUniforms <- Ql.renderBufferDirect <- Ql.render <- _warmRealCombatFX
```
That is three.js' `WebGLProgram.onFirstUse`, which calls `getProgramInfoLog` **only when
`renderer.debug.checkShaderErrors` is true**.

⚠ **This codebase already found the mechanism and fixed it in the wrong place.** The v39.44 note at
the end of `_prebakeWorldForLaunch` has it word for word — *"on ANGLE, reading a program's INFO LOG
or LINK_STATUS BLOCKS until the D3D compile finishes … It defeats KHR_parallel_shader_compile
completely"*, and *"Firefox's WebGL path makes that check far cheaper, which is exactly why one
browser hitches and the other does not"* (which is also why DuckDuckGo's Chromium 151 was clean all
day). But it turns the flag off at the **end** of the prebake — and `_warmRealCombatFX` runs
**inside** it. So the one function whose entire job is to draw every combat material for the first
time did all of it with the checks on, every program serially joining its own HLSL compile instead
of letting ANGLE overlap them.

**v40.22** turns `checkShaderErrors` off around `_warmRealCombatFX` and restores it in a `finally`,
so the rest of the prebake keeps reporting real GLSL errors (this game builds shaders from template
literals, and the v39.44 note found a genuine X4000 that way). The draws still happen, so the warm
still warms; what goes away is the explicit synchronisation around each one.
`window.__shaderErrChecks = true` keeps them on here too.

Boot-tested at 40.22: `checkShaderErrors` reads `true` at ship-select and `false` after the prebake,
so the flip and the restore both work; `__prebake().ms.fx` = 474 ms in the pane, no console errors.

⚠ Not everything in the trace is this. Two stalls — `26.13s GPUTask 3764 ms` and
`42.58s GPUTask 3939 ms` — are on **CrGpuMain with the renderer main thread idle** (its per-second
busy time is 3–193 ms across those seconds, and the only main-thread gaps are 150–364 ms). Those are
the "heartbeat clean" marks from earlier and they are still unexplained.

**v40.22 result.** Owner: *"it helped, and for some reason things looked clearer... but there were
some hitches remaining."* Mark #5 on 40.22: **worst 979.7 ms**, down from 2555 / 4014 ms, 65 fps.
The remaining one is the *other* lane, exactly as flagged:
```
big  26.40  979.7ms  renderFrame:3.2, hub:stream:2      hb []          main thread never stopped
lo   [25.43, 987, 0, 972, [gameLoop 13 ms]]             gt top 21.5    our draw list was 21 ms
                                                        gpu top 1014.6 the fence saw all of it
```
GPU-process side, renderer idle — the same shape as the trace's `26.13s GPUTask 3764 ms` and
`42.58s GPUTask 3939 ms`.

⚠ **It is not VRAM pressure.** The trace's `GPUTask` args carry `used_bytes` per renderer, and ours
never exceeds **57 MB** across the whole recording (36–46 MB in the stalling stretch). Every "the
card is short of memory" theory is out. The long GPUTasks do coincide with `used_bytes` changing,
which is consistent with resource creation/destruction forcing a driver synchronise — the same class
as the v40.16 refract-copy realloc — but three.js' own counters (`made`) show only ~1 geometry a
frame there, so whatever is being created is Chrome-side, not ours.

Naming it needs a trace with the `gpu`/`gpu.service` categories enabled, which the DevTools
Performance panel does not expose (Perfetto / `chrome://tracing` does). Untested one-liner that would
narrow it first: `window.__keepWarm.on = false` — the v39.63 burner is the one thing this game adds
to the GPU queue on purpose and it has never been A/B'd.

### v40.23 — the late cloak re-warm only ever covered the player

Owner: *"pretty sure auto cloak caused a hitch in elimination mode."*

`_warmCloakVariantOnce()` warms exactly **one** unwarmed root per call — the player first, then the
first unwarmed bot — and it is called once a frame in the countdown block, so the field does drain.
But v39.49b then found that the player's warm lands ~4 s into the launch, *before* its hull texture
is assigned, so it compiles the **no-map** transparent variants (cache-key term `mapUv`) and the
first real cloak links the textured pair cold, ~2 s. The fix for that was a **late re-warm at
`warmupTimer < 2`** — and it was written for `player.mesh` alone.

⚠ Every bot has exactly the same problem, and two things make it bite hardest in elimination: it is
the mode with the most hulls on the field and the most rounds to meet them in, and **Auto Cloak
fires off the core meter**, so it triggers at an arbitrary moment in play with nothing hiding the
link. Skins sharpen it further — `_applyShipSkin` runs in the ship factory for *every* ship built,
player or bot, and `lssSkinHue` is a program-cache-key term, so a bot wearing a livery the boot-time
ghost-fleet warm never saw is its own program family. (That warm reports
`pre-warmed 196 transparent hull program(s) across 14 hulls` — archetypes, not the live skinned
instances.)

**v40.23** clears `_cloakWarmed` on the player *and every entity mesh* at `warmupTimer < 2` and lets
the existing per-frame `_warmCloakVariantOnce()` drain them, one hull per frame, instead of doing the
player's in a single lump. Nine hulls is nine frames of the two seconds available, and it replaces
the direct `_warmCloakForRoot(player.mesh, false)` call that v39.96 measured at 1073 ms → 78 ms when
suppressed. `window.__cloakLateN` reports how many hulls were re-armed.

⚠ **Correction to the paragraph above.** I claimed skins sharpen this because "a bot wearing a
livery is its own program family". **Bots are not skinned.** The spawn calls
`createShipMesh(chassisData, teamColor, _meshKey)` with no `skinId`, so `_poolKey` is built as
`loadoutKey + '|' + teamColor + '|' + ''` and `_botShipPoolTake` asks for the same empty-skin key —
consistent, and no livery is applied. `_applyShipSkin` reaches the player's rig and the picker
previews, not the bot fleet. What v40.23 actually buys is (a) the late re-warm reaching bot hulls at
all, which matters if a bot cloaks, and (b) the player's own re-warm being **sliced one hull per
frame** instead of the single lump v39.96 measured at up to 1073 ms. Both are real; the skin
reasoning was not.

**On the endless precedent** (owner: *"probably what fixed the hitches in endless mode … that's when
we implemented the ?pbhud command"*): that was **v38.97** — the bot ship-group pool plus
`_lssRetainMat`. Its own note says it exactly: *"a disposed hull material whose program has no other
holder frees the program, and the next ship with that variant relinks it mid-match (224 ms cold on
the pane, at round start)"*, against *"519 GPU buffer uploads and 155 geometry deletes in ONE frame
at every round transition"*. ⚠ That fix is **mode-agnostic** — the pool keys on hull + tint, not on
mode — so elimination has had it all along. The half elimination never got was the *warm*, which is
what v40.23 adds. The `?pbhud` recorder itself is v39.62.

### v40.24 — "is the warmup just not finished, but it started the match anyway?" Yes. Fixed.

The owner's question, answered from their own trace. The residual stalls are **`StartDrawToSwapStart`
3766.9 / 3943.8 ms** in the viz pipeline (async events — my first scan only read synchronous ones),
with the renderer main thread idle and the GPU process showing *nothing* on any thread in that window
except one `GPUTask` of the same length: the command decoder blocked inside a single GL command. On
ANGLE/D3D11 that command is the first DRAW with a (program × input layout × state) whose D3D
executable is not built yet.

⚠ The prebake's v37.18 drain polls `COMPLETION_STATUS_KHR` — *"has this program LINKED"* — and
returned while every warm **draw** was still queued behind it. Then the cloak warms ran in the
countdown, on screen, one decoder stall per hull. Measured in the pane at 40.24: `drain 3 ms`
(links long done) against **`fence 285 ms`** (draws not) — that gap is the whole thesis, and on the
owner's card it is seconds.

Three additions, all from existing pieces:

* **`_prebakeGpuFence(capMs, rep, key)`** — `fenceSync` after the last warm draw, `SYNC_STATUS`
  polled a frame at a time via `_warmupYield` (non-blocking), capped (10 s launch / 8 s swap / 6 s
  round → `rep.capped = 'gpu-fence'`), free when the queue is empty. Every prebake's overlay drop now
  waits on it. `rep.ms.fence`, `window.__gpuFence`.
* **Launch (`_prebakeWorldForLaunch`)** — the hull-per-loadout proxy group (v39.49, built for the
  mirror lift on water maps) is now built on **every** map, and `_prebakeCloakWarmRoots` runs
  `_warmCloakForRoot(root, true)` on each proxy plus the player, one per yield. Bots spawn after this
  prebake, but a bot is unskinned and tint is a uniform, so the proxy's materials key the same
  programs as the live bot's. Pane: `cloakHulls 8`, `cloakMats 112`, `ms.cloak 235`.
* **Rounds 2+ (`_rrStagedRound`)** ⚠ had no warm and no fence at all: `ph.reset()` re-ran
  `spawnBots()` behind the cover and the stage returned after terrain, leaving every fresh bot hull's
  transparent variant to the countdown's one-per-frame warm, on screen — the owner's "auto cloak
  caused a hitch in elimination mode". It now cloak-warms the unwarmed live hulls plus the player
  (textures final by round 2) and fences. `_rrStagedSwap` (traverse) gets the same before its cover
  lifts.

⚠ Build note: a `sed` that appended a `//` comment inside a one-line arrow body commented out its
closing `});` and broke the source; caught by `node --check` in strip.py and repaired before the
regenerate. Never append a comment to a line that does not end the statement.

Verified at 40.24 in the pane: `capped null`, total 2455 ms, no console errors, `checkShaderErrors`
false after the prebake.

### v40.25 — v40.24 regressed the countdown; pulled back to what is provably safe

Owner on 40.24: *"so many hitches... and it skips the countdown because it's lagged there."* Two of
my changes did that, and the 40.24 marks show a third thing that no warm can fix.

**What regressed and why.**
* **v40.23's countdown re-warm ran with the shadow pass.** It cleared `_cloakWarmed` on every bot and
  let `_warmCloakVariantOnce` rebuild them one per frame — but that drain calls
  `_warmCloakForRoot(root)` with no second argument, and `withShadow !== false` is **true**: N full
  shadow-map renders in the last two seconds of the countdown, on screen. The old late warm passed
  `false` explicitly. Reverted to exactly v39.96 (player only, shadowless), and the per-frame drain
  itself is now shadowless — the depth variants of every hull archetype come from the launch
  overlay's proxies (v40.24, `withShadow` true), so nothing is lost.
* **v40.24's fence and cloak warm inside `_rrStagedRound`.** That stage's cover is the ship picker,
  not an opaque overlay, and its countdown is wall-clock (`_tickTimer`). Work behind it is work on
  screen; work longer than the countdown *is* the skipped countdown. Both removed. `_rrStagedSwap`
  (traverse) keeps its cloak warm (now shadowless) and its fence, because it has a real overlay and
  shortens its own countdown by the stage length (floor 4 s) — but the fence is now capped at 4 s
  **inside** the stage budget, never beyond it. The launch fence likewise: 4 s cap, budget-gated.

**What the 40.24 marks proved.**
* Marks 10–12: **`hub:ripple 3527.3` with the heartbeat stopped 3546 ms**, 13 s into round 1. That
  is the crest readback again — the v40.19 cutoff is *reactive*: the first call into a deep queue
  still pays the whole flush before it can switch anything off, and the queue is deepest in the
  first seconds after FIGHT. **v40.25 holds the readback off for 15 s after FIGHT**
  (`game._fightAt`, stamped at the warmup→playing transition; `window.__water.crHoldMs`; `flags.crHold`
  = seconds of hold left). Spray is a metres-from-the-surface detail nobody watches as the fight opens.
* Mark 7: `gt [31.75, 3519.9, 0]` — **3.5 s of GPU-executed draw list with `first: 0`**: no new
  pipeline was drawn on that frame. Warming pipelines cannot touch that one. It is the same shape as
  marks 35 / 38 / 41 earlier in the session and it is still open. ⚠ Do not spend more warm work on it.

Verified at 40.25 in the pane: launch prebake `cloak 211 ms / 8 hulls`, `fence 33 ms`, `capped null`,
total 4257 ms, no console errors. The FIGHT stamp and the readback hold are verified by construction
(`node --check`, unique anchors) — the hidden pane parks its countdown at 5 s, so FIGHT was not
reached to watch `crHold` count down.

### v40.26 — four marks, three shapes; the probe learns to tell them apart

Marks #14–#17 on 40.25 (classic, `hourglass`, MEGA):

| mark | where | shape | what it says |
|---|---|---|---|
| 14 | playing, 3918.6 ms | GPU-side (`hb []`, `gt` 31 ms, fence 4016) | **a new pipeline drawn 20 ms before it** — `ShaderMaterial\|normal+position\|b2T-s2i--`, 56 v, additive, DoubleSide, no UVs, unwarmed |
| 15 | playing, 3662.2 ms | **main thread blocked** (`hb [37.48, 3589.9]`), `lo []`, no blame, no GPU | a block in a TASK, not a frame — invisible to the LoAF observer |
| 16/17 | **warmup**, 1361.9 ms | GPU-side, `first 0` | already-built work; and `crOffN 1` at t=23 s — the crest readback had run *in the countdown* (the v40.25 hold only started at FIGHT) |

Three probe fixes and one real fix:

* **`first` names the shader.** The pipeline signature now carries `{first five uniform names}` and
  the material name, so the next mark 14 says which ShaderMaterial family (uIsCore = lightning,
  uAxialFalloff = layered FX, shieldColor = shield, uBaseColor+uVRLite = atom fractal…) and the fix
  is a targeted warm rather than a guess.
* **A `longtask` observer** beside the long-animation-frame one (`lt`: `[t, ms, name, attribution]`).
  Attribution is coarse but it proves task-vs-frame, which is the fork mark 15 sits on: a texture
  upload on decode, a readback promise, a scheduler timer — all tasks.
* **`flags.fxRuns`** — every entry into `_warmRealCombatFX` is stamped, memoized or not, so a re-run
  in the countdown (a changed `_programEnvSig` after the cinematic would do it) shows up.
* **The crest hold covers every non-playing state**, not only the 15 s after FIGHT — the sim runs
  during warmup and `_fightAt` is not stamped yet, so the readback was tripping the cutoff on screen
  in the countdown.

Verified at 40.26 in the pane: `lt` populated (`[18.89, 1486, "self", "window:"]` — the prebake's own
long tasks behind the overlay, as expected), `fxRuns [18.4]` (one run, in the prebake, no countdown
re-run), `crOffN 0` / `crCost null` through warmup (hold in force), no console errors.

### v40.27 — the "already-built but expensive" frame was the combat-FX warm re-running in view

Marks #18–#22 on 40.26 (classic, `hourglass`, MEGA). Mark 18 is the class that had resisted every
warm: **one frame whose own draw list executed for 4100.9 ms on the GPU** (`gt`, disjoint clear,
fence 4168.7) with `first: 0` — nothing new built, just an enormous amount of drawing. And the new
`flags.fxRuns` puts an entry into `_warmRealCombatFX` at **19.1 s, one tenth of a second before that
frame**. The prebake had run it at 11.2 s behind the overlay; the countdown call (`warmupTimer <= 2`)
and the FIGHT call (`warmupTimer <= 0`, `fxRuns` 23.4) entered it again.

⚠ **The memo keys on `_programEnvSig()`, which counts VISIBLE lights** (`scene.traverseVisible`),
plus fog type, environment, shadow flags, tone mapping, colour space, clipping. Anything that changes
the visible light set between the prebake and the countdown — the cinematic, a bot's engine light,
a muzzle light coming online — makes the signature differ, and the whole warm runs again: every
combat effect in the game spawned at once and rendered in one frame, on screen. That is marks 35 /
38 / 41 / 7 / 18 — not a compile, a 4 s render — and it explains why no amount of pipeline warming
touched them.

**v40.27**: once *any* warm has run this session, `_warmRealCombatFX` only runs again behind a cover
(`game._worldPrebaking`, `_PREBAKE.on`, `_swapStaging`, `_rrStaging`). In view it is refused and
stamped (`flags.fxSkipped`), whatever the signature says; `flags.fxRan` records entries that got past
the memo. The trade is explicit: a genuinely changed environment leaves a few FX variants to link on
first use in play — single programs, mostly resident via `_lssRetainMat` — instead of one guaranteed
multi-second frame that nothing hides.

Verified at 40.27 in the pane: `fxRuns [18.3]`, `fxRan [18.3]` (once, in the prebake, `ms.fx 2897` —
2.9 s of work, hidden), **`fxSkipped [29, 31]`** — the countdown entry and the FIGHT entry both
refused in view; `cloakHulls 8`, `fence 6`, `capped null`, reached `playing`, no console errors.
⚠ A first attempt read `fxRuns null` at 24 s: a fresh browser context was still fetching assets and
the prebake had not reached the FX phase. Wait for `__prebake()` to exist before reading it.

**Still open — the compositor lane.** Marks 20 / 21 / 22 (1660 / 2189 / 1821 ms): renderer idle
(`hb` only ~65 ms blips, `lo []`, `lt []`), our GPU idle (`gt` 9–14 ms, fence 42–56 ms), `first 0`.
Nothing in the page was busy and the GPU had drained; the browser simply did not present a frame.
That is the `StartDrawToSwapStart` shape from the trace with *no* GL work behind it — viz/Graphite
itself. The only page-side lever left for that class is avoiding *new compositor layer
configurations* at match start (pre-showing HUD/overlay states during the loading screen); untested.

### v40.28 → v40.30 — the cold-browser run, captured from the inside

**v40.28** warms the layered-FX shader in three layouts × two blend states and the particle cloud
(`_warmRuntimeFxOnce`, `__fxWarm` 6 → 13). Pane-verified: `fxRan [19.8]` once, **`fxSkipped
[28.2, 30.2]`** (countdown + FIGHT refused), `fence 42`, no errors. On the owner's card the launch
prebake now hides **10.3 s** of warming: `fx 5043 / carrier 2064 / cloak 1974 / mon 1550 / gpu 1487`.

**v40.29 — auto marks.** Owner: *"sorry i didn't mark them"* — and the hitch that matters only
happens once, on a cold browser. Under `?pbhud` any frame gap ≥ 400 ms now snapshots itself
(`'auto <ms>'`, one per 1.5 s, 30 per page load; `?pbhud&noauto` off). Reading them without a
keypress: with the Claude-in-Chrome extension connected, an MCP tab at
`http://localhost:8099/404.html` (same origin, game not running) reads `localStorage.lss_f8log`
live; otherwise `read_f8_ldb.py` (⚠ the block-start scan must include offset 0 — `range(start, lo-1,
-1)` — the value sat at offset 172 of a 24 KB table).

**The cold run (owner quit Chrome, fresh GPU process, 40.29, elimination, MEGA, 1920×1010):**

| mark | t | what | reading |
|---|---|---|---|
| n29–31 auto | 6–32 s, `select` | 2.4–3.9 s | ⚠ false positives: `foc` flips `h`↔`v` inside each gap — the tab was hidden; rAF does not run hidden |
| n32 auto | 43.9 s, warmup | 639 ms | **`cold [[43.93, 118]]`** — 118 programs linked, +197 geos, +12 tex: the prebake's compile, behind the overlay. Fine. |
| n33 F8 | 53.3 s, warmup | 21 ms | `fxRan [44.9]` — clean countdown so far |
| n34 auto | **54.67 s, FIGHT** | **3043 ms** | `fxSkipped [54.7, 54.7]` ✓; `gt` 9.9 ms, fence 3056.7, `hb` 79, `lt []`, `first []`. GPU-side; the frame began at 51.6 — it spans the last 3 s of the countdown (the "3", the player's late cloak re-warm at <2 s) |
| n36 auto | 58.47 s | **3647 ms** | **`gt [54.81, 3629]`** — our draw list executed 3.6 s, starting right after **the first `SpriteMaterial` draw of the match at 54.80** (4 v, additive). The warm had never drawn a Sprite. |
| n38 auto | 62.31 s | 3064 ms | `gt [59.23, 3042]`, `first []` — draw list, nothing new *by name* |
| n40 auto | 66.16 s | 1862 ms | `gt [64.29, 1849]`, first at 63.37: `{uColor,uOpacity}` glow sphere |
| n42 auto | 70.02 s | 2654 ms | `gt [67.36, 2645]`, `first []` |

Every in-play stall on the cold browser is now the same shape: **our own draw list executing for
2–3.6 s** (`gt ≈ stall`, disjoint clear), no CPU (`hb` ~65 ms blips, `lt []`), fence agreeing — and
`first` mostly EMPTY. ⚠ That emptiness was the probe's fault: its signature was material NAME +
layout + state, which cannot tell a hull material from the same-named material with its texture
now assigned (a different program, `USE_MAP`), nor one sprite from another with a different map.
Different program = a different D3D pipeline the driver has to build at first draw.

**v40.30**: the signature carries the live three.js program id (`renderer.properties.get(material)
.currentProgram.id` → `@p<id>`); `_warmRuntimeFxOnce` draws an additive and a normal-blend
`Sprite` with a small map (`__fxWarm` 15); the auto marker skips any gap that spans a hidden
interval. Pane-verified: `fxWarm 15`, 134/200 `first` entries carrying `@p`, `fxSkipped [27.1,
29.1]`, `cloakHulls 8`, `fence 59`, no errors, `autoN 0` in the (hidden-flipping) pane.

### v40.31 — the 40.30 cold run: the warm ran, and the residual is not (only) first-use pipelines

Owner, on 40.30, Chrome quit and restarted (cold GPU process), elimination, MEGA: *"still hitches…
is the warmup failing somehow?"* Ten marks (auto + F8), read live through the extension.

**The warm did run**: `fxRan [17.2]` once, `fxWarm 15`, `warmDraws 44`, cloak proxies drawing
their transparent pairs at 16.3 s (`Syphon_CP_*@p157/@p158`), `cold [[16.24, 118]]` = the prebake's
118 program links behind the overlay, `fxSkipped [25.5, 28.8]` = the countdown and FIGHT entries
refused. Nothing in the prebake failed or was capped.

**What the stalls look like now, with program ids in the signature:**

| mark | frame | inside our draw stream? | first-use event before it |
|---|---|---|---|
| n47 | 1341 ms (began 24.14, warmup) | yes (fence 1369) | **`SpriteMaterial@p172`** first draw at 24.14 — the v40.30 synthetic sprite warmed a *different* program |
| n49 | **2932 ms** (began 25.91) | yes — `gt [25.87, 2916]` | **none** — nothing new by program × layout × state in the 1.5 s before |
| n50 | 883 ms | yes — `gt 838` | none |
| n52 (F8) | **20.9 ms** | — | ⚠ **five brand-new pipelines** (`MeshBasicMaterial@p141/@p143 color+position`, layered FX 24 v) drawn at 35.57–36.16 **for free** |
| n53 | 2758 ms | **no** — `gt` small, fence 2772 | a 12-vertex quad on a known program, 0.65 s earlier |
| n54 | 1341 ms | **no** — `gt` 7.8, fence 1362 | none |

Two conclusions the earlier model did not allow for:
* **A first-use pipeline is not reliably expensive** — n52 drew five new ones inside a 21 ms frame.
* **The multi-second frames mostly have no first-use event at all**, and they split between
  "inside our command stream" (`gt ≈ stall`, which only proves the stall sits between our first
  and last GL command of the frame — a driver stall there still counts on the GPU timer) and
  "outside it" (fence sees it, `gt` does not). Both are GPU-process work we cannot name from the
  page. ⚠ Every remaining candidate — the driver's own shader cache writes on a cold process, ANGLE
  blob-cache persistence, a state combination the signature still cannot see — lives inside
  `GPUTask` and needs the GPU process's *own* trace categories, which the DevTools panel does not
  record. **Next instrument: `chrome://tracing` → Record → "Manually select settings" → tick
  `gpu`, `gpu.service`, `gpu.angle`, `gpu.decoder`, `viz`, `cc` → record the cold start → save.**
  That trace names the GL command / ANGLE work inside each 3 s GPUTask. It is the only thing left
  that can, and it has to be recorded by the owner (extensions cannot open `chrome://` pages).

**v40.31** (pane-verified, no errors): the runtime-FX warm shows one sprite per **real** hidden
`SpriteMaterial` in the scene for its draw (`__fxWarmSprites` 13 → `__fxWarm` 28; a CanvasTexture
stand-in keyed a different program); the `first` signature carries the render target
(`>s` rtScene / `>c` canvas / `>t<type>` other — the same points program showed up as both `>s` and
`>t1016`, i.e. the mirror pass, which the old signature merged) plus depthTest / colorWrite /
alphaTest; and `flags.pb` = `[total, fence, cloak, fx, gpu, capped, cloakHulls, sprites]` so
"is the warmup failing" is answered by the mark itself (pane: `[2637, 10, 90, 1782, 194, 0, 8, 13]`).

**On "it works only in DuckDuckGo?"** — the game's work is identical in both; DDG ships a different
Chromium/ANGLE build (151) that does not pay these GPU-process costs on this machine. What the page
can do is front-load first uses (done: 4 s → 1–3 s, FIGHT frame gone in some runs); it cannot change
what the GPU process does with a cold shader cache.

### v40.32 — the GPU-category trace names it: a link joined at a draw, mid-countdown

Owner's `chrome://tracing` capture with `gpu`, `gpu.service`, `gpu.angle`, `viz`, `cc` on
(`Downloads/trace_lastshipsailing.json.gz`, 5.57 M events; `trace_gpu.py` / `trace_gpu2.py`).
Trace clock ≈ page clock + 31.3 s. What it says, event by event:

| trace t | page t | thread | what |
|---|---|---|---|
| 33.75 s | 2.4 s | GPU main | `DXGISwapChainImageBacking::Present` **718 ms** (boot; the renderer's `GetFloatv` capability query waited 672 ms behind it) |
| 35.17 s | 3.9 s | ANGLE worker | `D3DCompile` **331 ms** — pixel shader `uSkinHue, normalMap` (a hull material) |
| 43.35 s | 12.1 s | ANGLE worker | `D3DCompile` **655 ms** — pixel shader `uSkinHue, normalMap, envMap` (a hull material under the environment map) |
| **44.54 s** | **13.22 s** | renderer main → GPU main | `GLES2Implementation::GetProgramiv` → `CommandBufferHelper::Finish` → `WaitForGetOffset` **1872 ms**, matched by `Program::MainLinkLoadEvent::wait` **1871.8 ms** |
| 53.15 s | 21.9 s | GPU main + Dawn worker | raster decoder blocked 1057 ms on `GpuPersistentCache::LoadImpl → DiskCache::Load` (Graphite's pipeline cache read from disk — Chrome's, cold process, once) |
| 54.63 s | 23.3 s | GPU main | WebGL `CommandBuffer::Flush` **3366 ms** with no ANGLE sub-event — the decoder inside one command; still unnamed |
| 61.07 s | 29.8 s | GPU main | `Present` **858 ms**, again coinciding with a Dawn `GpuPersistentCache::LoadImpl` |

The owner's marks for the same run line up to the frame: `cold [[13.22, 6]]` — **six programs linked at
13.22 s**, `hb` stopped **1931.9 ms** at 13.22, `first` at 13.23 = `Vortex_CP_Rubber /
Vortex_InnerHull_Composite.001 / Vortex_CP_Cushion >s` — the **player's hull** drawn into rtScene
for the first time, from the prebake's cloak warm of `player.mesh`, with the ship-select countdown
on screen. **three.js' first use of a program asks `getProgramParameter(ACTIVE_UNIFORMS)`, and on
ANGLE that blocks until the D3D link finishes** — the same lane v40.22 closed for
`getProgramInfoLog`, through the other API. Every warm in this codebase compiled and drew in the
same call, so every warm joined its own links. The v37.18 drain (poll `COMPLETION_STATUS_KHR`,
non-blocking) ran once, after the prime — after every warm draw had already paid.

The HDR environment is *not* the late arrival I suspected: the netlog shows `cinematic_2k.hdr`
fetched at page-time 2.4 s from the disk cache. The 12.1 s `envMap` compile is a hull variant, not
an environment change.

**v40.32 — compile, drain, then draw, everywhere a warm draws:**
* `_drainProgramLinks(capMs, rep, key)` — the v37.18 loop as a helper (one poll when nothing is
  linking; `_warmupYield` between polls; capped; `rep.ms[key]`, `window.__linkDrain`).
* `_warmCloakForRoot(root, withShadow, deferDraw)` — with `deferDraw` it compiles both passes and
  returns a finisher that draws and restores. `_prebakeCloakWarmRoots` now compiles every hull, drains
  once (`drainCloak`), then runs the finishers.
* `_warmRuntimeFxOnce` is async: `renderer.compile(grp)` → `_drainProgramLinks` → draw. It also
  carries the **first-fire sprite recipes** copied from their spawners (`spawnPlayerHitSplash`: ember
  falloff map, additive; `spawnElectricSmoke`; the sRGB name label) — `SpriteMaterial@p172` is built
  per hit and no scene scan could reach it.
* `_prebakeGpuPrime` drains (`drainPrime`) before its twelve renders.
* **The countdown's per-frame cloak drain no longer joins**: `_warmCloakVariantOnce` compiles and
  parks a finisher in `_cloakPendingFin`; `_cloakPendingTick` (called first each frame) polls the
  programs linked since and draws only when they all report complete (6 s cap). The player's late
  re-warm at `warmupTimer < 2` just clears the flag and goes through the same path.

Pane-verified: `cloakHulls 8 / cloakMats 112` with `drainCloak 7 ms`, `drainPrime 5 ms (1 poll,
0 pending)`, `fence 118`, `fxWarm 35` (17 real sprite materials + 3 recipes), `capped null`,
`cold []` in play, `fxSkipped [34.7, 36.7]`, no console errors.

**Still open**: the 3.4 s decoder flush at page 23.3 s (a quarter-second after `SpriteMaterial@p172`
first drew into rtScene and into the picker's half-float target `t1016`) has no ANGLE event inside
it, so the trace cannot say which command. The Present stalls are Chrome's Dawn pipeline-cache disk
loads on a cold GPU process — outside the page, once per cold start.
