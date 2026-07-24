# `lss.map.md` — architecture & navigation map for `index.html`

> Companion map to the single-file WebGL game `index.html` (build **v35.04**).
> The whole game is **one classic `<script>`** defining `function _bootLSS()` spanning **lines 3036–70463** — one giant shared lexical scope, no modules.

## How to use this file

- **Jump by anchor, not by line number.** Each entry has a **`Jump:`** string — a unique declaration you can Ctrl-F / grep for (`function fireWeapon`, `class Bot`, `const audio`). The `~L#####` line hints are approximate and **drift** as the file grows; the anchor never does.
- **To find a subsystem:** scan the Section Map below (it's in file order, grouped into PARTs), grab the `Jump:` anchor, search for it in `index.html`.
- **To keep this current:** when you add/remove/rename a subsystem, update its entry here. Keep entries **coarse** (subsystem-level, not per-function). To refresh the `~L` hints after big edits, grep each anchor.
- **Sibling of** `index.html` in the repo root. This is a doc — it changes nothing at runtime and preserves the single-file build.
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
5. **Warmup must bind `postFX.rtScene`.** The "combat first-sight hitch" fix lives in `_shaderWarmup` (**~L27395**) and `_warmRealCombatFX` (**~L35432**); both must `renderer.setRenderTarget(postFX.rtScene)` so shader programs compile in the gameplay colorspace. Removing that bind brings the hitch back.
6. **`_clip` name collision.** `_clip*` at **~L22110** = the *terrain clipmap* LOD system (`_clipGeo`/`_clipBuild`/`_clipUpdate`/`_clipmap`). `_clip` at **~L46572** = the *video recorder* (MediaRecorder). Totally unrelated — grep with care.
7. **Triplicated terrain math.** `_st*` / `sdSphere` / `worldSDF` exist in **three copies** that must stay in sync: worker-string copy (~L17041), main-thread copy (~L17208), and the collision copy `worldSDF` (~L22496). Editing one without the others desyncs terrain vs. collision.
8. **Hub perf wins that stuck** (keep them): grass off by default, shadow map 2048², reflector throttle + RT shrink. Perf lives in `gameLoop`/`renderFrame`.
9. **Fragile seams — re-verify after any combat/render edit:** (a) combat first-sight hitch, (b) hub framerate, (c) multiplayer combat. The sandbox renderer is useless for these; test in a real browser.

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
**Jump:** `function _bootLSS()` · also `const LSS_BUILD = '34.64'` (~L3044)
Opens the single closure; sets version badge; defines static gameplay config.
- **Symbols:** `LSS` (MAX_PLAYERS, ARENA_SIZE 25000, ROUND_TIME…), `LSS_API_BASE`, `LSS_DISCORD`, `CHASSIS`, `PILOT_PERKS`, `LOADOUTS`; `window.LSS_BUILD`
- **⚠** `<head>` loads `activity/redirect.js` FIRST (before fonts/importmap): on `*.discordsays.com` (Discord Activity proxy) it bounces `/` → `/activity/` launcher stub, because the Discord client CSP blocks the game's CDN imports. No-op on every other origin — keep it the first script.

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

#### Match-start flows & ship-select entry — `~L6829`
**Jump:** `function startSolo` · `function enterShipSelect` (~L6988) · `function startAssault`
- **Symbols:** `startSolo`, `startTest`, `startRace`, `startAssault`, `_startHostedMode`, `enterShipSelect`
- **(v34.68) ASSAULT mode** (`LSS.MODE==='assault'`, `#btn-assault`): Protect/Attack the Champion Field on `assault_` maps (side-'A' rooms = defender/champion end). The field + shell spawn at round start; only the ATTACKING fleet can claim/charge (`LSS.ASSAULT_CHARGE_TIME` hold, decays when vacated); timer expiry (`LSS.ASSAULT_ROUND_TIME`) = defender round win; roles swap each round (`_assaultAttackerFleet()` = pure function of currentRound, zero sync). Unlimited respawns: fleet-wipe round end disabled + bot reinforcements top fleets back up (authority-side, roster rebroadcast). Match end: `_assaultMatchWinner()` net-capture spread (2*caps−attackRounds ≥ `ASSAULT_NET_SPREAD`, higher net, evaluated only at equal attack rounds) via `game.assaultLedger` (booked by the round-end authority AND `round_end` receivers, BEFORE currentRound increments). Spawn sides role-mapped via `_assaultSpawnSide` at all five `getValidSpawnPoint` call sites. Defender bots hold a guard post off the field when unengaged (waypoint shortcut skips dogfight AI — only used when idle); attacker bots keep the champion beeline.

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
- **Symbols:** `_swBuildGrass`/`_swRemoveGrass`, `_swGenTree`, `_swForestAt`, `_swBuildTrees`, `_swBuildShell`, `_swDisposeChunk`, `_swApplyAtmosphere`
- **⚠** Grass off by default (perf); `getVRLevelGridRes` budgets foliage.

#### Pillar-karst field (The Colonnade terrain style) — `~L17330`
**Jump:** `function _stPillarAt` · `function _stGroundYCarvedBase` (the pillar-aware wrappers keep the old `_stGroundYCarved`/`_stCeilYCarved` names)
(v34.65) Worley-cell pillar field: where `T.PILLARS` is set (per-map via `MAP_DATA.<key>.terrain.pillars`), both carved surfaces blend past the local midline and fuse into floor-to-ceiling rock columns. Same math in the carved trio + `_stGapSDFCarved`, so mesh and collision agree. Seed re-rolls per round (worldSeed + currentRound, built in `buildRoomGraphLevel`); `T.PILLARS.clear` holds spawn-circle + narrow lane-capsule keepouts (lanes stay flyable; near-lane pillars decay into stumps).
- **Symbols:** `_stPillarAt`, `_stGroundYCarvedBase`/`_stCeilYCarvedBase`, `T.PILLARS` (cell/r/soft/drop/jitter/overlap/ox/oz/clear), `MAP_DATA.<key>.terrain.{pillars,wallPinch}`
- **⚠** All existing maps pass `T.PILLARS` unset → wrappers fall straight through to Base (behavior-identical). `_openTop` (hub) skips pillars.

#### Terrain clipmap LOD + edge audio + streaming lifecycle — `~L22015`
**Jump:** `function _clipBuild` (~L22233) · `function _clipUpdate` (~L22263) · `function updateSandwichStream` (~L22324)
- **Symbols:** `_swStartDragHiss`, `_CLIP_N`/`_clipmap`, `_clipGeo`, `_clipMat`, `_clipBakeLevel`, `_clipBuild`, `_clipUpdate`, `updateSandwichStream`, `initSandwichTerrain`, `setSandwich*`, `sandwichDebug`; `window.__smoothTerrain`, `window.__terrainDetail`, `window.__terrainAO`, `window.__terrainSat`, `window.__clipTest`, `window.__clipDetail`
- **⚠** NAME COLLISION with the `_clip` video recorder (~L46572). Different systems.

#### Level collision & raycast — `~L22495`
**Jump:** `function worldSDF` (~L22496) · `function resolveCollision` (~L22629)
- **Symbols:** `worldSDF` (3-arg main copy #3), `sdfNormal`, `sdfRaycast`, `checkBoxCollision`, `resolveCollision`, `resolveShipShipCollisions`, `raycastLevel`, `getWallNormal`
- **⚠** This 3-arg `worldSDF` differs from the terrain-copy signatures — same name, different args.

### ═══ PART 8 — Water & ripple sim (~17969–18891, 19511–20355) ═══

#### Forcefield + water reflection shader + ripple simulation — `~L17969`
**Jump:** `function _swWaterReflectShader` (~L18015) · `function _swRippleTick` (~L18577)
- **Symbols:** `_ensureBrokenSimForcefield`, `_swWaterReflectShader`, `_swRipple`, `_swRippleInit`, `_swSpawnSplash`, `_swCrestSpray`, `_swShipFootprint`, `_swRippleTick`; `window.__crestTest`
- **⚠** Ripple grid 128² / 4000u; far-mask 24000u — perf-sensitive.

#### Hub water surface, underwater & terrain reset — `~L19511`
**Jump:** `function _swBuildHubWater` (~L19650) · `function _swUpdateHubWater` (~L20125)
- **Symbols:** `_swBuildHubWater`, `_swBuildHubWaterOverlay`, `_swUpdateHubWater`, `_swUpdateUnderwater`, `resetSandwichTerrain`; `window.__refl`, `window.__waterHorizon`, `window.__reflBench`, `window.__pwaterApply`, `window.__foliageProf`

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
- **Symbols:** `HUB_CITY`, `_hubCityBuild`, `_hcInstMesh`, `_hcTrafficInit`/`_hcTrafficUpdate`, `_hubCityCollide`, `_hubCityRayHit`, `_hubCityFrame`

#### Weather system — `~L21583`
**Jump:** `const _WX = {` · `function _wxInit` (~L21922)
Sky dome, sun, volumetric clouds, rainbow, day-lighting env, toggleable shadows.
- **Symbols:** `_WX`, `_wxMakeDome`, `_wxMakeSun`, `_wxMakeClouds`, `_wxMakeBow`, `_wxShadowsOn`/`_wxShadowsOff`, `_wxInit`/`_wxFrame`
- **⚠** The sky dome's below-horizon blend + cloud edge falloff were tuned in v34.60–62; shadows here drive the 2048² shadow map.

### ═══ PART 11 — Ship models & FX (~23094–24484) ═══

#### Ship models: loading, mesh build, preview & FX textures — `~L23094`
**Jump:** `function buildModelShipMesh` (~L23670) · `function createShipMesh` (~L23981)
- **Symbols:** `SHIP_MODELS`, `shipModelCache`, `preloadShipModels`, `bakeShipThumbnails`, `shipMuzzleWorld`, `buildModelShipMesh`, `createShipMesh`

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

#### Shader warmup (frame-yield precompile) — `~L27395`
**Jump:** `const _shaderWarmup` · `function _warmupYield` (~L27417)
Async precompile that renders representative effects offscreen — the primary "first-sight hitch" fix.
- **⚠** MUST bind `renderer.setRenderTarget(postFX.rtScene)` (~L27974) for correct colorspace; XR/hidden path uses `setTimeout` fallback.

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
- **Symbols:** `MONSTER_DEFS`, `_addBasicRim`, `_addGutsShader`, `MONSTER_BASE_URL`

#### Outskirts monster AI — `~L32779`
**Jump:** `class OutskirtsMonster` (~L32979) · `function _monStripRootMotion` (~L33551)
Arena-boundary leviathan AI, model streaming, root-motion strip, gib FX.
- **Symbols:** `OutskirtsMonster`, `_initMonsters`, `_monStripRootMotion`, `_loadNextMonsterModel`, `spawnMonsterGuts`
- **⚠** `_monStripRootMotion` mutates GLTF clips in place to keep monsters anchored.

#### Champion shell — `~L33709`
**Jump:** `class ChampionShell` (~L33773)
- **Symbols:** `_preloadChampionShellModel`, `ChampionShell`, `_spawnChampionShell`, `_clearChampionShell`

#### Boss portal & race rings — `~L33950`
**Jump:** `function _spawnBossPortal` (~L34013) · `class BossPortal` (~L33968)
- **Symbols:** `BossPortal`, `_spawnBossPortal`, `RaceRing`, `_spawnPoleRings`, `_raceOnRingCaptured`
- **⚠** `_spawnBossPortal` DEFINED here but CALLED ~L5763/5970/9145 (long forward ref, typeof-guarded → silent if broken).

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

#### Combat FX warmup & program pinning — `~L35277`
**Jump:** `function _pinCombatEffectPrograms` (~L35300) · `function _warmRealCombatFX` (~L35432)
- **Symbols:** `_TRACER_*_MAT_PROTO`, `_fxPinGroup`, `_pinCombatEffectPrograms`, `_warmRealCombatFX`
- **⚠** Part of the first-sight-hitch fix — renders into `postFX.rtScene`; `_fxPinGroup` sits at y=-100000, `frustumCulled=false`.

#### Muzzle points & tracer/railgun spawning — `~L35505`
**Jump:** `function spawnTracer` (~L35789) · `function _spawnSingleTracer` (~L35586)
- **Symbols:** `_computeScreenMuzzleWorld`, `_spawnSingleTracer`, `_spawnRailgunSpiral`, `spawnTracer`
- **⚠** Tracer visuals allocate per-shot by design — do NOT pool.

#### Dark lightning, bolts & siphon helix — `~L35875`
**Jump:** `function spawnLightningBolt` (~L35970)
- **Symbols:** `_initDarkLightningPool`, `spawnDarkLightningBolt`, `spawnLightningBolt`, `spawnSiphonHelix`

#### Particle system — `~L36192`
**Jump:** `const MAX_PARTICLES` · `function updateParticles` (~L36446)
Single batched `THREE.Points` (embers/sparks) + splash-drop buffer.
- **Symbols:** `MAX_PARTICLES`, `_particlePoints`, `_splashPts`, `_warmupEffectShaders`, `updateParticles`
- **⚠** Fixed Float32 attrs (`DynamicDrawUsage`); `_warmupEffectShaders` also part of hitch fix; `_particleCap` from VR budget.

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

#### Loadout & ship-menu cycling — `~L39117`
**Jump:** `function commitLoadout` (~L39203)
- **Symbols:** `cycleCampaignShip`, `cycleHubShip`, `commitLoadout`

#### Bot networking & spawning — `~L39665`
**Jump:** `function spawnBots` (~L39761)
- **Symbols:** `_botNetSync`, `_botApplyRoster`, `_dropinReplaceBot`, `spawnBots`

#### Player damage / death / respawn — `~L39846`
**Jump:** `function playerTakeDamage`
- **Symbols:** `playerTakeDamage`, `playerDie`, `respawnPlayer`

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
**Jump:** `function executeAbility` (~L42160) · `function updateAbilities` (~L44346)
Largest gameplay block (~4000 lines): activate/execute dispatch, power shot, core, all shield variants, sonar, rocket salvos, fire DOTs, dash.
- **Symbols:** `activateAbility`, `executeAbility`, `firePowerShot`, `activateCore`, `_makeHullHugShield`, `_spawnThermalShieldFire`, `_spawnSonarPulse`, `_enqueueStaggeredRocketSalvo`, `updateAbilities`, `dash`
- **⚠** `executeAbility` is a giant switch — shader warmup exists to precompile the materials these spawn.

#### Round system tick — `~L46029`
**Jump:** `function updateRoundSystem`
Per-frame match state machine (warmup/countdown/active/round-end), timers, win conditions, campaign progression.

### ═══ PART 17 — Clip recorder & menu teardown (~46572–47069) ═══

#### Video/gameplay clip recorder — `~L46572`
**Jump:** `const _clip` · `function _clipStart` (~L46638)
`MediaRecorder` over `renderer.domElement.captureStream()`, compositing 2D HUD DOM layers onto the video.
- **Symbols:** `_clip`, `_CLIP_LAYER_IDS`, `_clipCompositeTick`, `_clipStart`/`_clipStop`/`_clipSave`
- **⚠** NAME COLLISION with the terrain clipmap `_clip*` (~L22110). Different system.

#### Return to menu — `~L46756`
**Jump:** `function returnToRootMenu` · `function returnToMainMenu` (~L47030)
Tear down session, dispose world objects, reset state, restore UI.

### ═══ PART 18 — Input, HUD & menus (~47070–53134) ═══

#### Gamepad & XR input polling — `~L47070`
**Jump:** `function pollGamepad` (~L47195) · `function _xrSynthGamepad` (~L47070)
- **Symbols:** `_xrSynthGamepad`, `_mergedGamepadState`, `pollGamepad`
- **⚠** Merges physical + VR controllers into one virtual pad.

#### Touch controls overlay (mobile) — `~L42220`
**Jump:** `const _touchForced` · `window.LSS_TOUCH`
Self-contained IIFE: on-screen sticks + labeled buttons for phones (`?touch=1` forces on desktop). Floating-origin move stick (over-travel = dash), right-half look zone, right-edge button COLUMN labeled with live loadout names (RT=weapon, RB=ability1, LB=ability0, F=ability2, via `_refreshTouchLabels` in the 250 ms visibility poll), R=RELOAD chip, LT=ZOOM, core button = core name.
- **Symbols:** `_visBox`, `_layoutSticks`/`_layoutSticksSoon` (`window._lssLayoutSticks`), `_refreshTouchLabels`, `_dragReset`, `window.LSS_TOUCH`
- **⚠ (v35.04)** `_layoutSticks` pins the overlay ROOT + sticks/zones in px to the CONSERVATIVE visible box (intersection of visualViewport and inner W/H) — Chrome's layout viewport can come out of the round-start fullscreen/orientation settle taller than the real screen while the intro cinematic hides the overlay (CSS vh/vmin bottom-anchoring then lands off-screen = the old "sticks gone after cinematic" bug). The visibility poll re-pins on EVERY hidden→shown flip and resets interrupted drags on hide (display:none never delivers pointerup on Chrome). Don't revert sticks to CSS-unit positioning.
**Jump:** `function drawCircumpunctHUD` (~L47687)
Central circular reticle (health arc, ability ring) on the `circumpunct-hud` canvas.
- **Symbols:** `hudCanvas`, `_HUD_TICK_COUNT`, `drawCircumpunctHUD`

#### DOM HUD updater — `~L48527`
**Jump:** `function updateHUD` (~L48559)
- **Symbols:** `_hudEls`, `_hudText`/`_hudWidth`/`_hudDisplay`, `updateHUD`
- **⚠** Dirty-checks vs `_hudLast` before touching DOM — don't bypass.

#### Minimap / radar + kill feed — `~L48677`
**Jump:** `function updateMinimap` (~L48702)
- **Symbols:** `_mm`, `invalidateMinimapExtent`, `updateMinimap`, `addKillFeed`

#### Ability HUD (pie + slots) — `~L48983`
**Jump:** `function buildAbilityPie` (~L49047)
- **Symbols:** `buildAbilityHUD`, `buildAbilityPie`, `_abSlot`/`_abCore`, `updateAbilityHUD`
- **⚠** `_abInvalidate()` after loadout swaps.

#### Ship-select / loadout / perk / difficulty UI — `~L49314`
**Jump:** `function buildShipSelect` (~L49316)
- **Symbols:** `buildShipSelect`, `previewLoadout`, `_renderPerkPicker`, `_renderDifficultyPicker`, `selectLoadout`, `updateTeammatesStrip`

#### Launch countdown + loading overlay + pointer lock — `~L49777`
**Jump:** `function launchCountdown` (~L49832)
- **Symbols:** `_clearLaunchCountdown`, `showLoadingOverlay`, `_markLocalWarmupReady`, `launchCountdown`, `_safeRequestPointerLock`

#### Keybinding capture + How-To-Play — `~L49956`
**Jump:** `function openHowToPlay` (~L50036)
- **Symbols:** `_kbRebindAction`, `_captureKbKey`, `_kbActionHeld`, `_isGamePreventKey`, `openHowToPlay`

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
- **Symbols:** `StasisField`, `amStasisOwner`, `serializeWorldObjects`, `applyWorldObjectsManifest`, `spawnStasisField`, `updateStasisFields`
- **⚠** Ownership is consensus-driven.

#### Room fog + player stasis + executions — `~L56711`
**Jump:** `function updateRoomFog` (~L56715)
- **Symbols:** `_FOG_BASE_DENSITY`, `updateRoomFog`, `enterStasis`, `updatePlayerStasis`, `checkExecutions`

#### Map data + level geometry + spawns — `~L56881`
**Jump:** `const MAP_DATA` (~L56896) · `function buildRoomGraphLevel` (~L57438) · `function _lssGenShiftingDeep`
- **Symbols:** `MAP_DATA`, `CAMPAIGN_LEG_MAP`, `getNextMap`, `_lssGenShiftingDeep`, `buildRoomGraphLevel`, `getValidSpawnPoint`
- **⚠** `buildRoomGraphLevel` builds the whole arena mesh; `getValidSpawnPoint` scores clearance to avoid wall-spawns.
- **(v34.65) New maps:** `colonnade` (The Colonnade — pillar-karst cathedral; `terrain: { pillars, wallPinch }` drives the pillar field, see PART 7) and `shifting_deep` (The Shifting Deep — `procedural: 'shifting_deep'` makes `buildRoomGraphLevel` regenerate the room graph EVERY ROUND via `_lssGenShiftingDeep`: 180°-symmetric rooms, mirrored-Kruskal spanning + loop edges + degree-floor (min 2 exits), biome roulette via `level._biomeOverride` → `T.biome`; the static rooms in its MAP_DATA entry are only the carousel preview/fallback). Both derive seeds from (worldSeed, currentRound) — peer-identical, idempotent per round, re-rolled between rounds.

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

#### Sound synth primitives + Sound Lab + default library (huge data) — `~L60694`
**Jump:** `const DEFAULT_SOUND_LIBRARY` (~L60841)
- **Symbols:** `triChord`, `playNoiseBurst`, `DEFAULT_SOUND_LIBRARY` (~5300-line blob), `_playSoundFromLabRecipe`, `importSoundLabLibrary`, `_startRailgunChargeSound`
- **⚠** Largest single literal in the file; recipes overridable via localStorage.

#### Sound gating: voice budget + playSound — `~L66519`
**Jump:** `function playSound` (~L66695)
- **Symbols:** `_SOUND_MIN_GAP`, `_AUDIO_VOICE_BUDGET`, `_audioReserveSound`, `playSound`
- **⚠** Under stress drops `_AUDIO_SKIPPABLE` first; tighter gaps on VR/Quest.

#### Spatial audio (HRTF + 5.1 VBAP) — `~L66708`
**Jump:** `function playSpatialSound` (~L67035)
- **Symbols:** `_occlusionRaycastAllowed`, `_playSpatialSoundHRTF`, `_vbap51`, `_playSpatialSound51`, `playSpatialSound`
- **⚠** Occlusion raycasts budgeted (`_OCCL_RAYCAST_BUDGET=3`); pooled panner nodes.

#### Procedural music engine — `~L67060`
**Jump:** `const music = {` (~L67073)
- **Symbols:** `music`, `_musicSynthDrum`/`Bass`/`Pad`/`Lead`, `MUSIC_STYLES`, `_musicScheduleBeat`/`_musicTick`, `musicStart`/`musicStop`, `musicSyncToGameState`, `musicTickFromMain`
- **⚠** `musicTickFromMain(dt)` pumped from the game loop.

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
- **Sky / env:** `setSky`, `applyMapPreset`, `MAP_PRESETS`, `setShowcaseMode`, `promoteMeshToPBR`, `__skyDome`, `__domeHide`, `__sunApply`, `__hubLight`, `__exposure`, `__grade`, `__aerial`
- **Water:** `__water`, `__waterDisp`, `__refl`, `__waterHorizon`, `__reflBench`, `__pwaterApply`, `__pw`, `__crestTest`, `__splashN`
- **Terrain:** `__terrainDetail`, `__terrainAO`, `__terrainAOU`, `__terrainSat`, `__smoothTerrain`, `__clipTest`, `__clipDetail`
- **Critters:** `__birds`, `__fish`
- **PostFX / cameras:** `setCineFXEnabled`, `tunePostFX`, `roundKillCam`, `cinemaCam`
- **Audio:** `announcer`, `announcerSay`, `announce`, `ANN`, `announceMultikill`, `v8DuckAmbient`
- **Feedback:** `triggerHitFeedback`, `hitFX`, `Overlays`
- **Lobby / auth:** `LSS_AUTH`, `_lobbySendInvite`, `_lobbyJoinPlayer`
- **Levels:** `lssGmaps` (setKey / attachCity / location / …)

---

*Generated from a full three-band read of `index.html` (v34.62). Line numbers are approximate hints — jump by anchor. Update entries when subsystems move; keep it coarse.*
