# `lss.map.md` — architecture & navigation map for `index.html`

> Companion map to the single-file WebGL game `index.html` (build **v35.14**).
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
- **(v35.20) Main-menu layout.** `#btn-quick-match` + `#btn-create-room` **deleted** — the single CREATE / JOIN button `_unifyLobbyBox` builds does both (blank field hosts, typed code joins). Every JS reference (`_lobbyRenderBrowsing`, `_lobbyRenderInRoom`, the click wiring) was already null-guarded, so they no-op. `#lobby-room-box` sits at the **top of the menu column** (`order:-2`, directly above CAMPAIGN / `#lobby-solo-row` at `-1`) as a flex **column** — sign-in pill, then `#room-code`, then CREATE / JOIN. (It briefly lived in the top band mid-v35.20; `#lobby-user-row` was reverted to `left:auto` when it came back down, and now carries only the FULLSCREEN/SETTINGS stack.) `_unifyLobbyBox` still pulls `#discord-identity` and `#room-code` in at runtime.
- **⚠ (v35.20) First-load frame flash.** `#room-code` lives inside **`#lobby-roomcode`** in the markup, which renders for a few ms before `_unifyLobbyBox` lifts the field out and hides it — flashing its own bordered card above CAMPAIGN. Fixed by stripping that box's chrome in CSS (`background/border/radius/padding`) and hiding its "PLAY TOGETHER" caption, so the pre-unify state is invisible. It's at the same `order:-2` slot as `#lobby-room-box`, so the field doesn't move during the hand-off either. **Don't restore chrome to `#lobby-roomcode`** — its inline style still has the old card styling and only these overrides suppress it.
- **⚠ (v35.20)** `_unifyLobbyBox` step 4 deliberately **no longer appends `#lobby-panel`** into the room box — a scrolling presence list can't live in a slim top bar, so it stays in the content column. `panel` is still looked up there because the browsing/in-room renderers toggle its buttons.
- **(v35.20) Room controls restyled to match the flat menu.** `#lobby-room-box` lost all its chrome (background / border / radius / backdrop-filter / padding) — it was the last panel-looking card on an otherwise flat menu. The "MULTIPLAYER" label is deleted (the field's placeholder says it). `_unifyLobbyBox` now builds a **`#lobby-room-stack`** column — `#room-code` with **`#lobby-room-join-btn` underneath** — and the button is in the `#btn-solo/#btn-campaign/...` menu-entry group so it gets the shared transparent/Orbitron/`translateX(12px)`-hover treatment (15px + `#ffcc66` so it sits under the field rather than competing with the mode list). The "For solo-play…" caption is gone; its text is the `title` tooltip on both the field and the button. Inline `onmouseover`/`onmouseout` on the button were removed — CSS `:hover` owns it now.
- **(v35.20)** `#btn-fullscreen` moved out of the content column (it was `position:fixed` bottom-right) into **`#lobby-corner-btns`**, a column at the right end of `#lobby-user-row` stacking FULLSCREEN above SETTINGS, both styled as text links.
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

#### Match-start flows & ship-select entry — `~L6829`
**Jump:** `function startSolo` · `function enterShipSelect` (~L6988) · `function startAssault`
- **Symbols:** `startSolo`, `startTest`, `startRace`, `startAssault`, `_startHostedMode`, `enterShipSelect`
- **(v35.20) ELIMINATION** — **Jump:** `async function startElimination` (just after `startOpenSolo`). MULTIPLAYER PvP + MULTIPLAYER AND BOTS merged into one menu entry. Follows `startOpenSolo`'s room handling (create-or-reuse, then straight to ship-select) but **honours a code typed in `#room-code`** instead of overwriting it — `startOpenSolo` always minted a fresh code, silently discarding what the user typed. No code required: blank mints one. Falls back to `startSolo()` if the room can't open. Symbols: `_elimGenCode`, `_elimWantBots`, `_setEliminationBots`, `startElimination`, `_renderEliminationBotsBtn`, `_toggleEliminationBots`.
- **⚠ (v35.20)** The button **keeps the id `#btn-join`** deliberately — `#btn-join.lss-ready-cta` styling hangs off it and `joinRoom()` still toggles its `disabled`. `#btn-opensolo` and `#mp-join-msg` are deleted; `startOpenSolo` itself is KEPT (the `open_solo_start` netcode path and `_startHostedMode` still reference it).
- **(v35.20) No lobby READY button.** `joinRoom()` used to relabel `#btn-join` to "CLICK WHEN READY" 500 ms after connecting and wire it to `toggleReady()`; that's removed so ELIMINATION keeps its label. **`updateReadyButton()` is now a deliberate no-op stub** — it was the only thing rewriting that text, and `toggleReady()` (its only caller) is now unreachable from the UI. The ready HANDSHAKE is untouched: readiness is signalled by committing a loadout on ship-select (the loadout broadcast IS the ready signal). Instead, `_renderRoomBox` swaps **CREATE / JOIN → "SELECT GAME MODE BELOW"** (`.lss-room-joined`: green, `pointer-events:none`) once `net.active && net.roomCode`. That swap is set *outside* the signature early-return so it survives a bailed re-render, and `_renderRoomBox` runs on a 1500 ms interval. The in-room peer line also changed from "use CLICK WHEN READY below" to "pick a mode to head to the hangar".
- **(v35.20) Bots toggle** — `#btn-ss-bots`, docked in **`#ss-header-right` under CONFIRM & LAUNCH** (top-right of ship-select), rendered by `_renderEliminationBotsBtn` from `enterShipSelect`. Label stays **"ADD BOTS"** in both states with a ticked/unticked box prefix (`☑`/`☐`) — swapping the wording made it ambiguous whether it described the state or the action. `.ss-bots-on` tints it green. Self-hides unless `net.active && LSS.MODE==='classic'` (offline the gate is `!net.active`, so bots always spawn and a toggle would be a lie). Works because the bot gate **`(!net.active || net.openSolo)`** is evaluated at ROUND BUILD (~L41540 and the between-rounds copy ~L48853), *after* ship-select confirms. Syncs to peers by reusing `open_solo_start` for ON and a new **`elim_bots_off`** event for OFF (same lowest-peerId tie-break as `open_solo_start`).
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
- **Symbols:** `_swStartDragHiss`, `_CLIP_N`/`_clipmap`, `_clipGeo`, `_clipMat`, `_clipBakeLevel`, `_clipBuild`, `_clipUpdate`, `updateSandwichStream`, `initSandwichTerrain`, `setSandwich*`, `sandwichDebug`; `window.__smoothTerrain`, `window.__terrainDetail`, `window.__terrainAO`, `window.__terrainSat`, `window.__clipTest`, `window.__clipDetail`
- **⚠** NAME COLLISION with the `_clip` video recorder (~L46572). Different systems.
- **⚠ (v35.11) Clipmap seam invariant:** each ring geomorphs its outer band toward the parent's coarse surface, and the morph MUST complete at the parent ring's inner hole edge = child-cell radius `N/2-4` (the ring geo is `_clipGeo(N/2-4)`), NOT at the window edge `N/2`. The old `(rd-48)/16` band finished 4 cells late, so the parent's fully-coarse surface poked through the ~75%-morphed child along the seam rectangle = the hub's "big triangles in a row". Band is now `(rd-N/4)/(N/4-4)` (starts 32, ends 60 for N=128 — wider band also halves the visible travel-morph rate). `_CLIP_SKIRT` 1500→220 (skirts only plug transient re-bake gaps; exposed 1500u walls read as giant dark triangle rows). Live A/B: `__clipMorph(0|1)`, `__clipSkirt(0..1)`. If `_clipGeo`'s hole inset (the `-4`) ever changes, the band end must move with it.

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
- **Symbols:** `HUB_CITY`, `_hubCityBuild`, `_hcInstMesh`, `_hcTowerMat`, `_hcTrafficInit`/`_hcTrafficUpdate`, `_hubCityCollide`, `_hubCityRayHit`, `_hubCityFrame`
- **(v35.13) Grounding pass:** `_hcTowerMat` facades get an irregular ground-contact grime band (`baseAO` over the bottom 60–150u, per-column noise) + vertical weather streaks + whole-floor window-lit clustering (~1 in 4 floors dark); the ground ALBEDO canvas gets multiply-blended contact-shadow pools under every grounded solid (skips `y0 > padY+60` skybridges). All three target the "buildings look fake / base too clean" read.

#### Weather system — `~L21583`
**Jump:** `const _WX = {` · `function _wxInit` (~L21922)
Sky dome, sun, volumetric clouds, rainbow, day-lighting env, toggleable shadows.
- **Symbols:** `_WX`, `_WX_SHADOW_EXT`, `_wxMakeDome`, `_wxMakeSun`, `_wxMakeClouds`, `_wxMakeBow`, `_wxShadowsOn`/`_wxShadowsOff`, `_wxBuildTerrProxy`/`_wxUpdateTerrProxy`, `_wxInit`/`_wxFrame`
- **⚠** The sky dome's below-horizon blend + cloud edge falloff were tuned in v34.60–62; shadows here drive the 2048² shadow map.
- **⚠ (v35.13) Shadow stability invariants:** (1) the ortho window is TEXEL-SNAPPED in `_wxFrame` — the target moves in whole shadow-texel steps in the light's plane (raw per-frame follow made every shadow edge shimmer = "flickering corners"); (2) the terrain shadow proxy re-bakes on its OWN fixed world lattice (`(2*_WX_SHADOW_EXT)/_WX_PROXY_N` cells) — recentering on raw player position made the whole mountain-shadow field morph every ~120u of travel; (3) window half-extent lives in `_WX_SHADOW_EXT` (6800, was 4200 — shadows "loaded in too close") and normalBias (4.8) scales with texel size. Keep all three coupled when retuning. Live knob: `__shadowExt(u)`.
- **⚠ (v35.14) Proxy rebake is INCREMENTAL:** on a cell crossing `_wxUpdateTerrProxy` SHIFTS the stored lattice heights by the cell delta and samples only the newly exposed rows/cols (~R calls); the full (N+1)² `_stGroundYCarved` resample (~11k calls, a rhythmic per-130u hub hitch = "stuttering") runs only on first show or a >N/4-cell jump. The shift copy is verified bit-exact. Don't turn this back into a full resample.

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
- **(v35.20) GAMEPAD CURSOR** — **Jump:** `function _gpCursorTick` (defined just above `pollGamepad`). Virtual mouse for the flat menus: left stick drives a `#gp-cursor` arrow (z-index 100000, clears `#settings-overlay`'s 200), A clicks `elementFromPoint`. Ticked from inside `pollGamepad` right after `_menuActive` is computed, so it's live from boot and can never touch flight input. Synthesizes `mouseover`/`mouseout`/`mouseenter`/`mouseleave`/`mousemove` — required, because the lobby is built almost entirely from inline `onmouseover` styling. Symbols: `_gpCur`, `GP_CURSOR_SPEED`/`GP_CURSOR_DEAD`, `_gpCursorMakeEl`, `_gpCursorShow`, `_gpCursorEvt`, `_gpCursorSetHover`, `_gpCursorClick`. Console: `window.__gpCursorTest([ax,ay], aDown)`.
- **⚠ (v35.20)** Coexists with the d-pad focus nav by mode-switching: stick → CURSOR, any d-pad press → FOCUS. Settings already binds raw button 0 to `_settingsActivateFocused`, so the cursor sets `_gpCur.consumedA` for the frame and that call site checks it — **without that guard one A tap fires both.** Also: the `if (!gp)` early-return in `pollGamepad` sits *above* the cursor tick, so it calls `_gpCursorTick(null,false)` explicitly or unplugging a pad strands the cursor on screen.
- **⚠ (v35.20)** Synthesized clicks are **untrusted events** — anything behind user activation (`requestFullscreen`, pointer lock, audio-context resume) will NOT fire from them. Pre-existing limitation, shared with the Start → `soloBtn.click()` path.
- **(v35.20) RIGHT STICK = SCROLL.** `axes[3]` scrolls `_gpScrollTarget()` — nearest scrollable ancestor under the pointer, falling back to the open `#settings-overlay` then `#lobby-grid`. Runs *before* the cursor-visibility early-out so you can scroll settings without first waking the pointer. `GP_SCROLL_SPEED`/`GP_SCROLL_DEAD`.
- **⚠ (v35.20) BUTTON-ONLY d-pad reads in menus.** `input.gpDpadUp/Down/Left/Right` are **`d-pad button OR left stick past 0.6`** (~L49659-49668) — that's why the stick was cycling ships and maps in ship-select and would have made the cursor hide itself the instant it moved. Added `input.gpDpadUpBtn`/`gpDpadDownBtn` (+`Prev`) to match the v32.99 `LeftBtn`/`RightBtn` pair, and switched **ship-select nav, settings focus nav, and the cursor mode-switch** to the `*Btn` variants. Anything new that reads the d-pad in a menu must use `*Btn` too. The XR settings handler (`_xrHandleSettingsMenuInput`) intentionally still uses the folded flags — no cursor in VR.

#### Touch controls overlay (mobile) — `~L42220`
**Jump:** `const _touchForced` · `window.LSS_TOUCH`
Self-contained IIFE: on-screen sticks + labeled buttons for phones (`?touch=1` forces on desktop). Floating-origin move stick (over-travel = dash), right-half look zone, right-edge button COLUMN labeled with live loadout names (RT=weapon, RB=ability1, LB=ability0, F=ability2, via `_refreshTouchLabels` in the 250 ms visibility poll), R=RELOAD chip, LT=ZOOM, core button = core name.
- **Symbols:** `_visBox`, `_layoutSticks`/`_layoutSticksSoon` (`window._lssLayoutSticks`), `_refreshTouchLabels`, `_dragReset`, `window.LSS_TOUCH`
- **⚠ (v35.04)** `_layoutSticks` pins the overlay ROOT + sticks/zones in px to the CONSERVATIVE visible box (intersection of visualViewport and inner W/H) — Chrome's layout viewport can come out of the round-start fullscreen/orientation settle taller than the real screen while the intro cinematic hides the overlay (CSS vh/vmin bottom-anchoring then lands off-screen = the old "sticks gone after cinematic" bug). The visibility poll re-pins on EVERY hidden→shown flip and resets interrupted drags on hide (display:none never delivers pointerup on Chrome). Don't revert sticks to CSS-unit positioning.
- **⚠ (v35.06)** Orientation locking REMOVED game-wide: `window._lssLockLandscape` is a kept-as-no-op stub (~L3079). The old lock-at-ship-select + unlock-at-warmup/FIGHT cycle made Chrome/Android re-evaluate orientation mid-match — on auto-rotate-off phones that rotated the viewport right while a thumb was on the sticks. Don't reintroduce mid-session `screen.orientation.lock/unlock`. `_visBox` now arbitrates TRANSPOSED viewport claims (vv says portrait while inner says landscape or vice versa — Chrome's rotation-settle lie, can persist with no final resize event): per-axis min would build a bogus square box, so it asks `screen.orientation.type` which orientation is real and takes that source whole. Sticks module also listens to `screen.orientation` `change` (window-level resize events get eaten by fullscreen transitions), and `_layoutSticks` leaves `tc-move` alone mid-drag (`_moveDragging`).
- **⚠ (v35.07→v35.08)** Field result: Chrome/Android window metrics (inner + visualViewport BOTH) can wedge stale for an ENTIRE fullscreen session — no final resize ever fires; exiting fullscreen was the only thing that refreshed them. So `_visBox` treats fullscreen as ground truth: when `document.fullscreenElement`, the visible box is the display itself → clamp to the display dims, or take them outright if the claims are unanimously transposed vs them (clamp-first keeps Android split-screen working). **v35.08 CRITICAL detail:** many Androids report `screen.width/height` in PORTRAIT-primary terms permanently (they never swap on rotation) — v35.07 compared against the raw dims and force-fed a portrait box onto honest landscape claims (field-confirmed regression). ALWAYS orient display dims via `screen.orientation.type` before comparing. The v35.07 on-screen `#tc-dbg` strip is removed; `LSS_TOUCH.dbg` (console getter) returns the live `_visBox` snapshot + raw sources instead.
- **⚠ (v35.09)** Three de-escalations at the movement-unlock (warmup→playing) frame, per the field pattern "works 2 s post-cinematic, breaks exactly when movement unlocks": (1) the v30.99-era `window._lssLayoutSticks()` call at FIGHT is DELETED — it was the only code rewriting stick geometry at that exact frame; nothing repositions the overlay at that transition anymore. (2) `_safeRequestPointerLock` hard-bails when `input.touchActive || input.touchSuppressMouse` — a tap-granted pointer lock on Android swallows all touch pointer events (zones/buttons dead) and persists until FULLSCREEN EXIT; `closeSettings()`' relock had no touch gate. (3) The 1.2 s poll also verifies both sticks' rects sit inside the visible box and force-re-pins if not — catches ANY actor that moves them, known or unknown, within ~1.2 s.
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
- **⚠ (v35.10)** `#ship-preview-canvas` MUST stay `position:absolute` and the `#ship-preview`/`#ship-preview-model` chain MUST keep base `min-height:0` — the preview canvas's DPR-scaled backbuffer otherwise feeds flex min-height and ratchets the layout to ~700k px on any dpr>1 screen (latent for years; the old max-height:620 media query masked it). Also `body:has(#ship-select.active)` hides `#minimap`/`#crosshair` — the radar's opaque backing bled through the 95%-alpha backdrop as a "mystery dark box".

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
