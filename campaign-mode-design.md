# Last Ship Sailing — Co-op PvE Endless Campaign Mode

## Design Doc (v1)

**Target files (dual-file, byte-identical behavior):** `last_ship_sailing.html` (dev, build `32.21`, `_bootLSS()` closure) and `index.html` (minified, same `_bootLSS()` closure with un-renamed symbols — confirmed: `LSS`, `CHASSIS`, `getRoundSeed`, etc. survive minification, so dev edits port byte-for-byte in behavior).

---

## 1. Overview

This adds a third game mode, **Campaign**, alongside the existing `classic` and `race` modes (`LSS.MODE` at `last_ship_sailing.html:3151`, currently `'classic' | 'race'`). Campaign is a **co-op PvE endless campaign**: 1–N humans share one fleet (Fleet A) and fight an enemy fleet (Fleet B) of **hoard ships flying cymatics formations**, punctuated by **leviathan bosses that rift in mid-scene with escorts**, across **8 scenes**. It is built to be **co-op-ready from day one but solo-valid first** — every spawn decision is seeded off `getRoundSeed(wave)` (`:6450`) and every cross-peer decision is gated behind the existing single-authority arbiter `amStasisOwner()` (`:47860`), so a P2P peer can drop in and stay byte-identical with zero new negotiation machinery.

The campaign is deliberately **a thin mode layer on top of the existing round machine** — it reuses `updateRoundSystem`'s `select → warmup → playing → roundEnd → matchEnd` state machine (`game.state` at `:3364`), the seeded round-rebuild path (`buildNextRound` at `:38388`), the `OutskirtsMonster` boss class + teleport FX (`:25956`, `_tpFx` at `:26127`), the open-solo `Bot`/`bot_state` sync (`:17755`, `:7393`), and the `withSeededRandom` build wrapper (`:6439`). The new surface area is one mode object, one data table, a streaming hoard-GLB loader, a formation director, and a handful of authority-clean net events.

## 2. Campaign Vision

- **7 bodies × 7 loadouts (decoupled).** Today "ship = loadout = GLB" — a single key (`VORTEX`, `PYRO`, …) indexes `CHASSIS` (`:3190`), `LOADOUTS` (`:3285`), and `SHIP_MODELS` (`:16389`) in lockstep. The campaign **breaks the coupling**: a new `SHIP_BODIES` catalog picks the hull GLB + chassis; a `player.bodyKey` rides alongside `player.loadoutKey`; the weapon kit (`LOADOUTS[key]`) becomes independent of the body. Result: any unlocked weapon flies on any unlocked body (up to 7×7 combos).
- **In-mode loadout-swap button.** Two swap surfaces: (a) the **between-scene regroup beat** reuses the existing mid-match ship-select path (`commitLoadout` `midMatch` branch at `:31673`) for a full body+loadout change; (b) a **quick-equip HUD selector** (hold `Q`) calls a new `swapWeaponLoadout(key)` that re-equips the weapon **on the same body without rebuilding the mesh** — skipping the ~3s shader-warmup + GLB clone, since only the weapon/abilities/HUD assets change.
- **Cymatics formations.** A deterministic `FormationDirector` gives each hoard ship a target point derived from closed-form parametric curves (phyllotaxis, Chladni nodal lines, rhodonea roses, Lissajous curtains, boids murmuration) plus a temporal flight layer (spiral entrance, sine-weave strafing, dive-and-pull-up, hold-break-reform). Each boss has a **signature formation**. All params come from `mulberry32(getRoundSeed(wave))` so peers build identical fleets.
- **Recurring Nemesis → secret scene 8.** One special hoard ship (`ship22.glb`) appears in every scene's boss-escort wave with elevated HP and a distinct rim glow. Rather than dying it **phase-blinks and escapes** (reusing the monster teleport machinery), carrying its HP-debt across scenes. After enough escapes it unlocks **secret scene 8**, where it returns as a full boss that **cannot escape** and must be killed to close the campaign arc.
- **Earn-a-loadout cadence.** Start with **VORTEX** only; each scene clear unlocks one more `LOADOUTS` key (and its matching body), gated in ship-select.

## 3. Eight-Scene Content Table

Biome keys are the four validated in `_SW_BIOMES`/`setSandwichBiome` (`:15392`, `grassy | rocky | snow | volcanic`); monster keys are the six in `MONSTER_DEFS` (`:25697`); hoard rosters are integer ids 1–22 → `LSS/objects/hoard/ship{N}.glb` (22 files confirmed on disk).

| # | Monster | Biome | Formation (seed key) | Hoard roster | Waves | Reward loadout | Hazard |
|---|---------|-------|----------------------|--------------|-------|----------------|--------|
| 1 | FleshMaw | grassy | `spiral` (phyllotaxis/Archimedean) | ship1, ship2, ship3 | 3 + boss | **PYRO** | none (tutorial) |
| 2 | GraveTitan | rocky | `ring` (rhodonea k=4) | ship4–ship7 | 3 + boss | **PUNCTURE** | grave-dust drift |
| 3 | HallowWalker | grassy→snow | `lattice` (phyllotaxis dome) | ship8, ship9, ship10 | 4 + boss | loadout #4 | spore slow zones |
| 4 | IronBloom | volcanic | `flower` (rose k=5) | ship11–ship14 | 4 + boss | loadout #5 | lava updrafts |
| 5 | StoneShroud | snow | `mandala` (Chladni 4,4) | ship15, ship16, ship17 | 4 + boss | loadout #6 | whiteout fog |
| 6 | VoidGazer | volcanic→rocky | `hypotrochoid`/Lissajous a=3,b=2 | ship18, ship19, ship20 | 5 + boss | loadout #7 | gaze-cone pulses |
| 7 | **All 6** finale | rocky | `cymatic_chladni` (cycles all) | ship1..ship21 rotating | 5 + 6-boss escort | victory cosmetic | all prior hazards |
| 8 | **Nemesis** (secret) | grassy (full circle) | `nemesis_orbit`/boids | ship22 + escorts from each prior scene | 3 + Nemesis | secret loadout / lore | Nemesis phase-blink |

Per-scene schema (all fields consumed by the director):
```js
{ monster:'FleshMaw', biome:'grassy', formation:'spiral',
  formationParams:{ count:18, radius:2400, turns:3 },
  hoard:[1,2,3],                          // ship{N}.glb ids
  waves:[ {count:8}, {count:10}, {count:12} ],
  boss:{ key:'FleshMaw', escort:4 },
  reward:'PYRO', hazard:'none' }
```

---

## 4. Mode Architecture, State & Lifecycle

The race-mode pattern is a string flag read inline at ~30 sites; that suits a speed/wall reskin but a campaign mode **owns the round loop itself** (wave advance, scene advance, boss timing, unlocks). Bolting a dozen `if (LSS.MODE==='campaign')` branches into `updateRoundSystem` would be unmaintainable and desync-prone.

**The registry.** Introduce a tiny mode-object table keyed by `LSS.MODE`, defined just after `game` is created (~`:3360`, so the campaign object closes over `game`/`player`):
```js
const GameModes = { classic: NULL_MODE, race: NULL_MODE, campaign: CampaignMode };
function activeMode() { return GameModes[LSS.MODE] || NULL_MODE; }
```
`NULL_MODE` is a frozen object of empty functions, so classic/race pay one property lookup and an empty call — **no behavioral change, no desync surface**. Extend the mode validator at `:7363` (currently accepts only `'classic'|'race'`) to accept `'campaign'`.

**Six hook seams (all already-existing sites):**

| Hook | Fires from | Exact site |
|---|---|---|
| `onStart(ctx)` | fresh-match branch, before world build | `commitLoadout` `!midMatch`, `:31856` |
| `onBuildWorld(seed)` | inside the seeded build closure | `:31858`–`:31886` (seeded via `withSeededRandom(getRoundSeed(1))` at `:31890`) |
| `update(dt)` | every tick while `state==='playing'` | `updateRoundSystem`, `:38162` |
| `shouldEndRound(ctx)` | win-resolution gate | `:38221` (already `!game.testMode`-gated) |
| `onWaveStart(ctx)` | between-rounds rebuild after `buildNextRound` | `:38388` |
| `onTeardown()` | run reset | `returnToRootMenu`, `:38754` |

**Campaign state** (namespaced as `game.campaign` so teardown nulls one object; mirror to `localStorage`):
```js
game.campaign = {
  sceneIndex: 0, waveIndex: 0, bossActive: false,
  unlockedLoadouts: ['VORTEX'], bodyKey: 'VORTEX_BODY',
  nemesis: { seen:false, escapes:0, alive:false, monId:-1, unlocked8:false },
  waveCount: 5, _ended: false,
};
```
Persisted via `lss_campaign_save` (mirror of `lss_perk_id` at `:31725`): `{sceneIndex, unlockedLoadouts, bodyKey, nemesis}`. Transient fields (`waveIndex`/`bossActive`/`_ended`) are never saved.

**The loop (reuses the round machine — a "round" = a "wave"):**
- `onStart` (`:31856`): read save; set `game.testMode=true` (the never-ending-session gate — already guards the whole win block at `:38221` and the warmup skip at `:38061`); set `game.raceNoTimer=true` (drops the 80s clock — `endByTimer` already checks `!game.raceNoTimer` at `:38206`); set `game.currentRound=1`; reset `waveIndex=0`. **Critically, also assign `net.worldSeed`** even in offline solo (see Risks) so `getRoundSeed` is non-null and the same seed math drives formations when a peer drops in.
- `onBuildWorld(seed)` (`:31858`): spawn the hoard formation for `waveIndex` using the seed already in scope.
- `update(dt)` (`:38162`): the campaign owns wave progression. Because `testMode` is true, the native resolution block at `:38221` is skipped; the campaign runs its own clear check (reuse the `aliveA/aliveB` walk at `:38172`, filtered to the hoard team). On wave clear it either advances `waveIndex` (between-wave rebuild) or, when `waveIndex===waveCount`, spawns **boss + escort** and sets `bossActive`. On boss death: award a loadout, advance `sceneIndex`, persist, rebuild scene N+1 wave 0.
- **Between-wave rebuild** rides the existing `roundEnd→warmup→buildNextRound` transition (30+ cleanup steps reused, not reimplemented): set `game.state='roundEnd'`, `_anchorTimer('roundEndTimer', N)` (mirror `:38269`), let the existing `roundEnd` else-branch (`:38370`) bump `currentRound`, rebuild via `getRoundSeed(currentRound)` (`:38394`), re-run ship-select. `onWaveStart` (`:38388`) swaps the hoard formation/scene theme. To stay in the loop forever, keep `scoreA/scoreB < ROUNDS_TO_WIN (4)` — the campaign never increments them; wave count lives in `game.campaign`.
- `onTeardown` (`:38754`): null `game.campaign`, clear `testMode`/`raceNoTimer` so the next classic/race match sees clean state.

**Why PvP/race is untouched:** `MODE!=='campaign'` → `activeMode()` returns `NULL_MODE` → all six hooks are empty; `testMode` stays false so the native `:38221` resolution runs exactly as today. The only existing-line edits are the `:7363` validator and the (already-gated) win block.

---

## 5. Body / Loadout Decoupling + Runtime Loadout-Swap UI

**The coupling to break.** `createShipMesh(chassisData, teamColor, loadoutKey)` (`:17255`) does `shipModelCache.loaded[loadoutKey]` (`:17264`) → `buildModelShipMesh` (`:16949`, `proto = shipModelCache.loaded[loadoutKey]` at `:16951`). The chassis only drives engine/plume layout (`bboxSize`/hull dims at `:17026`); the **visual hull is 100% the loadoutKey's GLB**. So one change unlocks decoupling: the GLB lookup must use a separate **body key**.

**New catalog `SHIP_BODIES`** (adjacent to `SHIP_MODELS` at `:16389`), reusing the existing 7 GLBs as the 7 bodies:
```js
const SHIP_BODIES = {
  VORTEX_BODY: { name:'Vortex Hull', glb:'VORTEX', chassis:'CORVETTE' },
  PYRO_BODY:   { name:'Pyro Hull',   glb:'PYRO',   chassis:'DREADNOUGHT' },
  // …7 total; glb is a SHIP_MODELS key, chassis a CHASSIS key
};
```

**Thread a `glbKey` param** through `createShipMesh`/`buildModelShipMesh`/`swapToModelMeshWhenReady`: the cache lookup uses `glbKey` (= `SHIP_BODIES[bodyKey].glb`); `loadoutKey` is kept **only** for the swap-generation staleness guard (`:17221`,`:17231`). In `commitLoadout`, change `const ch = CHASSIS[loadout.chassis]` (`:31669`) to `const ch = CHASSIS[SHIP_BODIES[player.bodyKey].chassis]`. The loadout's own `chassis:` field is demoted to a *default/suggested* body (keeps existing data + preview code valid).

**What `commitLoadout(key)` writes** (the single chokepoint, `:31653`): (A) chassis-derived hull stats `:31708`–`:31719`; (B) weapon/ability/core + per-loadout runtime resets `:31762`–`:31833` (vortex energy, tracker locks, blaster mode, syphon tiers, pyro shields, stale shield-mesh disposal); (C) the visual mesh + per-loadout HUD assets (`createShipMesh` `:31835`, `updateCockpitFrame` `:30783`, `_preloadGunLayer`/`_preloadAbilityOverlayFrames` `:31684`, `buildAbilityHUD` `:31851`, HUD text `:31841`).

**The runtime swap — `swapWeaponLoadout(key)` (new).** Because the body GLB is unchanged on a weapon-only swap, the mesh inputs (GLB + chassis-driven `bboxSize` at `:17026`) don't change, so it **skips `createShipMesh`/`swapToModelMeshWhenReady` entirely**. It re-applies (B) full weapon/ability/core + the per-loadout runtime resets (so the new weapon doesn't inherit old vortex energy/tracker locks), disposes stale shield meshes (`:31828`–`:31833`), refreshes the HUD-asset half of (C), and **preserves current hull HP%** (does NOT reset health). A full *ship* rebuild via `commitLoadout` is required **only** when `bodyKey` (or its chassis) changes.

**Per-loadout frame assets (PNG folder).** Each loadout owns a set of first-person overlay PNGs: the cockpit frame (`updateCockpitFrame` :30783), the sliding weapon-out / muzzle-fire frames (`_preloadAbilityOverlayFrames`, e.g. `laser_VORTEX.png` :31015), and the gun-cycle layer (`_preloadGunLayer`, `[gun, gunfire]` :30861), all driven off the per-ship preload manifest (~:30843). These are part of equipping a loadout: `swapWeaponLoadout(key)` must (pre)load and switch this PNG frame set (cached, so re-equipping a previously-used loadout is instant) alongside the tracer/muzzle colors. Decoupling note: the **weapon-out / muzzle frames follow the LOADOUT** (the active weapon); the **cockpit frame** may follow either the BODY (the hull) or the LOADOUT (see Open Design Calls).

**Two swap surfaces.** (a) **Between-scene regroup** = the existing `midMatch` branch (`:31673`) which already skips world rebuild/bot respawn/score reset and routes through the seeded/authority-clean commit; the round-end handler at `:38526` already re-shows `#ship-select` + `buildShipSelect()` + `launchCountdown()`. (b) **Quick-equip during a scene** = a `#quick-equip` HUD selector (hold `Q`) listing `unlockedLoadouts`, each → `swapWeaponLoadout(key)`.

**Ship-select gets a body dimension.** Keep the left list as the weapon list (`buildShipSelect` `:41147`); add a **body cycler** in the preview header (`:2818`) over `SHIP_BODIES`, reusing `setShipPreviewModel(SHIP_BODIES[b].glb)` (`:16657` already takes a GLB key) and re-rendering the stats grid from `CHASSIS[body.chassis]`. CONFIRM (`:41259`) stashes `player.bodyKey` before `commitLoadout(key)`. Gating: in campaign mode, filter the weapon list to `unlockedLoadouts` and the body cycler to earned bodies (analog of `_visibleMapKeys` at `:5614`); classic mode shows all (unchanged).

**Co-op.** Each player swaps their own ship (self-authoritative). Extend the `net.sendLoadout` payload (`:31941`) with `bodyKey` so peers render the right GLB for a teammate's mirror (`createShipMesh` maps `bodyKey → SHIP_BODIES[bodyKey].glb`). Bodies/loadouts **never feed the RNG** (only the world build is seeded, `:31890`), so free mid-scene swaps cannot desync. The quick-equip path must skip `checkAllLoadoutsReady` (`:6221`) and `net.mapCommitLocked` — those are warmup/commit-time only, not mid-scene.

---

## 6. Cymatics Formation & Flight Director

**The steering hook already exists** — the race/champion-field override inside `Bot.update()`. `:18029` declares `let _raceWaypoint = null`; when non-null the bot abandons combat steering and flies straight at `aiTarget` (`:18094`–`:18099`: `moveDir = aiTarget - position`, normalize, `targetDir.lerp(moveDir, dt*2)`). The combat flank/strafe block (`:18100`–`:18150`) is the `else` arm, fully bypassed. The champion-field writer (`:18030`–`:18040`) is the precedent: it copies `aiTarget`, forces `aiRole='engage'`, clears retreating, and assigns `_raceWaypoint=aiTarget` purely to reuse the shortcut. **Formation steering is a third writer of that same shortcut.** Acceleration/clamp/`mesh.lookAt` downstream (`:18159`–`:18199`) are mode-agnostic.

**Module shape `FormationDirector`** — a plain top-level object (matches `LSS`/`_monArena` style), run as a single pass **immediately before the entity tick loop** (`:51225 for (const bot of game.entities) bot.update(dt)`).

- **Determinism:** `this.rng = mulberry32(getRoundSeed(wave) ?? (wave|0))` — the `?? wave` fallback keeps solo-offline deterministic-by-wave. **Never** touch `Math.random`, and **never** use `withSeededRandom` (`:6439`) — it globally swaps `Math.random` for a *duration*, wrong for a per-frame director.
- **Clock:** `game.time` (`:50932`, `game.time += deltaTime`, `deltaTime` clamped 0.05 at `:50930`, peer-averaged on drop-in at `:7021`) — the deterministic phase clock for all temporal patterns. No `Date.now()`/`performance.now()`.
- **Anchor/scale:** `_monsterArenaInfo()` (`:25763`) for map-aware carved-space center + radius.

**Generators (pure `slot(i,N,params)`, O(1), written once per morph):** phyllotaxis (default/idle, fills space for any N — safe fallback); Chladni nodal (`cos(nπx)cos(mπy)−cos(mπx)cos(nπy)`, with a between-wave `(n,m)` sweep via slot-lerp so the plate "re-sings"); rhodonea rose (`r=scale·cos(kθ)`); Lissajous (per-slot phase offset, inherently temporal); boids murmuration (the only non-closed-form one — seeded init, host-authoritative, N≤~40, k=6 neighbor sample, used only for the "swarm break" beat and the Nemesis exit).

**Temporal flight layer** `flight(plan, t)` returns a rigid transform (rotate+translate+scale-pulse) applied to the whole slot set each frame: spiral entrance (boss escort rift-in), sine-weave strafing run, dive-and-pull-up, spiral-strafe, hold→break→reform (state machine on seeded durations).

**Per-frame hook** — `FormationDirector.update(dt)` mirrors the champion-field writer, then **one line** added in `Bot.update()` after the champion block (~`:18040`):
```js
if (this._formationActive && this.aiTarget) { _raceWaypoint = this.aiTarget; }
```
A `formationBlend` lerp weight lets "fly the pattern AND shoot" coexist (combat firing at `:18203` still runs off `combatTarget`).

**Signature formations (keyed off `MONSTER_DEFS` `:25697`):** FleshMaw → Chladni (3,2)→(5,3), hold-break-reform; GraveTitan → rose k=4, dive-and-pull-up; HallowWalker → phyllotaxis dome, spiral entrance; IronBloom → rose k=5, spiral-strafe; StoneShroud → Chladni (4,4), sine-weave; VoidGazer → Lissajous a=3,b=2, spiral-strafe; scene 7 → cycles all six; scene 8 Nemesis → boids → escape-vector exit (director steers anchor off-arena at low HP).

**Co-op authority:** in open-solo the host runs full AI and broadcasts `bot_state` snapshots every 0.12s (`_botNetSync` `:32056`); non-host peers run `isProxy` shells that lerp to snapshots and early-return before AI (`:17919`/`:17942`). So formation positions are host-authoritative, but seeded params keep the **formation choice + morph identical** across peers — important for prediction, the Nemesis escape telegraph, and the boss-escort shape.

---

## 7. Enemy Layer: Hoard Ships, Bosses & the Nemesis

Built on three systems that already have a co-op authority story: the GLB ship loader (`SHIP_MODELS`/`preloadShipModels` `:16389`/`:16497`), the `OutskirtsMonster` pack (`:25956`, `_monAuthority` `:25823`), and `Bot` AI on `TEAM_FLEET_B` (`:17755`, `spawnBots` `:32138`).

**Hoard loader — streaming LRU, not preload.** `ship1.glb`…`ship22.glb` (2–4.7 MB each, ~62 MB total) are NOT in `SHIP_MODELS`, so they get a **separate catalog + cache**; the playable `shipModelCache` (`:16399`) must stay fully resident. Keep all 62 MB resident would blow the mobile VRAM budget the monster perf pass (`MeshBasicMaterial` flatten at `:26030`) tunes for. New `HOARD_MODELS` (mirrors `SHIP_MODELS` shape + a `role`: `'interceptor'` fast/low-HP swarm vs `'gunship'` slow/high-HP standoff, derived deterministically from ship# so all peers agree). New cache:
```js
const hoardModelCache = { loaded:{}, lru:[], loading:{}, refCount:{}, MAX:6 };
```
`loadHoardModel(key)→Promise<proto>`: dedupe via `loading[]`, reuse the build-stamped `loader.load(url+'?v='+LSS_BUILD, …)` pattern (`:16509`/`:26513`) + `_applyProceduralShipNormalMap` (`:16479`) + Box3 fit/recenter (`:16528`–`:16537`), push LRU, evict oldest with `refCount===0` via `_disposeShipGroup` (`:17245`). The **Nemesis proto is pinned** (never evicted) once it first appears. Hoard ships are `Bot`s on `TEAM_FLEET_B` with a `hoardModelKey` + `role`; `swapToHoardMeshWhenReady` clones `swapToModelMeshWhenReady` (`:17211`) against the hoard cache. They ride the existing `bot_roster`/`bot_state`/`bot_fire` sync (`:7393`); extend `bot_roster` with `hoardModelKey`+`role`.

**Bosses — runtime summon with per-instance stats.** Today `_initMonsters` (`:26455`) builds a fixed 6 with `monId=i` (`:26464`), and `MONSTER_HEALTH`/`MONSTER_ZAP_DMG`/`MONSTER_SIZE` (`:25738`) are global consts. Campaign: read `def.stats` with global fallback in the `OutskirtsMonster` ctor (`:25961`); the zap path reads `this.zapDmg`. Scene difficulty scales HP (`health: MONSTER_HEALTH*(1+0.25*sceneIdx)`); `mon_state` already syncs `health` (row[5] at `:7387`), so scaled HP propagates free as long as every peer constructs with the same `stats` (guaranteed by seeded scene index). `_campSummonBoss(defKey, stats, escortSpec)` generalizes `_monSummon` (`:26902`): find-or-create the monster with a **deterministic `monId` from a seeded campaign-wide allocator** (`game.campMonNextId++`, NOT array index), rift in via `_tpFx` (`:26127`, no departure point) + `mon_tp` send, spawn `escortSpec.count` hoard Bots around it. Boss GLBs can dispose on scene-clear (vs the current "all 6 resident forever").

**The Nemesis.** One special hoard ship (`ship22.glb`, largest) with a unique name, a recolored rim (reuse `_addBasicRim` `:25714`), and a pinned cache entry. State in the seeded save: `game.campaign.nemesis = { escapes, alive, monId, unlocked8 }`. **Escape trigger (authority-only):** when the scene is about to clear (all other Fleet-B dead + boss dead) OR `health/maxHealth < 0.25`. On escape: play a `warpOutFx(pos)` helper (lifted from `_tpFx` so a `Bot` can call it), broadcast a new `nemesis_warp` event (mirror `mon_tp` `:26288`→`:7528` so peers replay FX + drop the proxy), `alive=false`, `escapes++`, and an `announcerSay` taunt (`:50086`, keyed/cooldowned at `:50111`). Each return is tougher (HP/weapon scale by `escapes`). After **7 escapes**, `unlocked8=true` gates secret scene 8, where the Nemesis is **promoted to an `OutskirtsMonster` boss** via `_campSummonBoss` with a dedicated `MONSTER_DEFS` entry + upgraded stats and **escape disabled** — it must be fought to death.

**Authority reconciliation (critical):** leviathans use `_monAuthority()` = stasis owner (`:25823`); bots use `net.openSoloHostId` (`:7424`). Campaign mixes both (bosses=monsters, hoard/Nemesis=bots). **Force monster-authority to follow bot-authority in campaign mode** (alias them to the same host) or split-brain summoning desyncs `monId`-keyed `mon_state`/`mon_dmg`/`mon_dead` lookups.

---

## 8. Co-op, Determinism & Persistence

Rests on three facts already true: (1) world builds are seeded-identical per peer per round (`net.worldSeed` + `mulberry32` + `withSeededRandom` + `getRoundSeed`, `:6426`/`:6439`/`:6450`); (2) enemy HP is authority-arbitrated (`mon_state` `:7379`, `bot_dmg` `:7417`); (3) drop-in exists end-to-end (`open_solo_start` `:7491`, `dropin_state` `:7513`, `_dropinReplaceBot` `:32120`). Everything below adds **zero new authority machinery** — it reuses `amStasisOwner()` (`:47860`) as the single arbiter.

- **One team for all humans.** Add a branch at the TOP of `assignTeamFromPeerOrder` (`:6386`): `if (net.campaign) { player.team = LSS.TEAM_FLEET_A; return; }`, mirrored in `_teamForPeerId` (`:6407`). Gate on a **new `net.campaign` flag** (+ `net.campaignHostId`), parallel to `openSolo`/`openSoloHostId` (`:3661`) — NOT overloading `openSolo` (already entangled with host-detection/bot-sync). Enemies are all `TEAM_FLEET_B`, so existing damage gating + scoreboard work unmodified.
- **Endless index → all spawns.** `game.campaignWave` (monotonic 1..∞) feeds `getRoundSeed(wave)` everywhere campaign formations/bosses/Nemesis are decided. Reuse the existing seeded build wrapper at `:38396` verbatim with `getRoundSeed(game.campaignWave)`.
- **Scale enemy count/HP UP with players (invert spawnBots).** `spawnBots` (`:32138`) *reduces* bots per human (`_enemyN = max(0, 3-humansOnB)` at `:32188`). Campaign inverts: count Fleet-A humans (`net.networkPlayers` filter `:32189` + self) and scale hoard/escort count + per-enemy HP **up**. This lives in the campaign formation spawner (new), not in `spawnBots` (which stays the bot-match path, skipped in campaign).
- **Campaign net events** ride `handleNetEvent` (`:7127`) as new `campaign_*` branches (authority broadcasts, non-owners apply — `round_end` pattern at `:38274`): `campaign_scene_cleared {scene,nextWave}`, `campaign_boss_spawn {wave,monId,escort[]}`, `campaign_nemesis_escaped {scene,wave}`, `campaign_loadout_unlocked {key}`.
- **Drop-in with full unlocks.** Reuse the flow unchanged; extend `dropin_state` with `campaign:true, scene, wave, unlockedLoadouts[]` so a friend lands mid-scene with all unlocks so far + spawn-invuln (`spawnProtection` honored at `:32224`). `_dropinReplaceBot` removes a friendly ally bot from Fleet A, keeping enemy count untouched.
- **Persistence.** `LSS_CAMPAIGN_LSKEY='lss_campaign_save'` (idiom from `lss_custom_maps` `:5977`/`:5985`): `{scene, unlockedLoadouts, nemesisEscapes, bodyKey}`. **Write at the matchEnd hook** (`:38343`, right after `postMatchResultToBackend`) **before** `returnToRootMenu` (`:38754`) wipes state. `_loadCampaignProgress()` on boot. Optional run-result POST piggybacks on `postMatchResultToBackend` (`:5109`, idempotent, sign-in-optional).
- **Consensus snapshot.** `currentRound` already rides owner-free max-merge (`crMax` at `:6998`); `campaignWave`/`campaignScene` likely need the same max-merge treatment to survive lagging peers.

---

## 9. Reuse vs New Code Summary

**Reused (no behavioral change):**
- `game.testMode` (never-ending gate, guards win block `:38221` + warmup skip `:38061`) and `game.raceNoTimer` (drops 80s clock, `:38206`).
- The `roundEnd→warmup→buildNextRound` rebuild (`:38321`–`:38538`) — 30+ cleanup steps + seeded rebuild reused for between-wave/scene transitions.
- `getRoundSeed`/`mulberry32`/`withSeededRandom` (`:6450`/`:6426`/`:6439`) for co-op-identical builds; `game.time` clock (`:50932`).
- `_raceWaypoint` straight-line follow + combat-skip (`:18029`,`:18094`) and the champion-field writer (`:18030`) for formation steering.
- `OutskirtsMonster` + `_monSummon`/`_monsterRoundReset`/`_monRecall` (`:25956`/`:26902`/`:26872`/`:26917`) + `_tpFx` (`:26127`) + `mon_*` sync (`:7379`) for bosses.
- `Bot` AI + `bot_*` sync + `net.openSoloHostId` authority (`:17755`/`:7393`/`:7424`) for hoard ships/Nemesis.
- `commitLoadout` midMatch branch (`:31673`), `createShipMesh`/`setShipPreviewModel` (`:17255`/`:16657`), `net.sendLoadout`+`checkAllLoadoutsReady` (`:31941`/`:6221`) for the swap/regroup flow.
- `amStasisOwner` (`:47860`), `handleNetEvent` (`:7127`), drop-in flow (`:7491`), `lss_custom_maps`/`lss_perk_id` persist idioms, `Overlays.banner`/`countdown` (`:49710`/`:49629`), `ANN` (`:50204`), `musicSetPattern` (`:59094`), `_monsterArenaInfo` (`:25763`), `MONSTER_DEFS`/`LOADOUTS`/`CHASSIS`, `setSandwichBiome`/`_SW_BIOMES` (`:15764`/`:15392`).

**New:**
- `GameModes` registry + `activeMode()` + `NULL_MODE` (~`:3360`); `CampaignMode` six-hook object; `game.campaign` state; six hook call sites (`:31856`,`:31886`,`:38162`,`:38221`,`:38388`,`:38754`); validator extension (`:7363`); `startCampaign()` lobby entry (sets `LSS.MODE`/`testMode`/`raceNoTimer`/`net.worldSeed`).
- `SHIP_BODIES` catalog; `player.bodyKey`; `glbKey` param thread; `swapWeaponLoadout`; `#quick-equip` HUD; body cycler UI; unlock gating filters.
- `FormationDirector` (generators + flight layer + per-frame hook); `SIGNATURE_FORMATIONS` table; `Bot._formationActive` flag + the one-line `Bot.update` edit.
- `HOARD_MODELS` + `hoardModelCache` + `loadHoardModel`/`swapToHoardMeshWhenReady`; per-instance monster stats; `warpOutFx`; `_campSummonBoss`; `game.campMonNextId` seeded allocator; `nemesis_warp` event + taunt table.
- `net.campaign`/`net.campaignHostId`; campaign team branch; `game.campaignWave`/`campaignScene`; campaign formation/boss spawner; four `campaign_*` net events; `_saveCampaignProgress`/`_loadCampaignProgress`; `SCENES` content table.

---

## 10. Risks

- **Determinism / offline-solo seed gap.** `startSolo` (`:5571`) never sets `net.worldSeed`, so `getRoundSeed` returns null and the build runs UNSEEDED. **Mitigation:** `startCampaign()` must always assign a `net.worldSeed` (even offline solo) so the same seed math drives formations when a peer drops in. This is the single most important "co-op-ready from day one" requirement.
- **Dual-file sync.** Every const/function/edit must land **byte-identical in behavior** in both `last_ship_sailing.html` and `index.html` (`_bootLSS` exists in both; minified symbols un-renamed — confirmed). Any divergence desyncs the seeded build. Keep diffs additive and mechanically mirror-able; bump `LSS_BUILD` on every paired change.
- **Closure boundary.** All new code lives inside `_bootLSS()`; the registry must be defined where it can close over `game`/`player` (~`:3360`). Module-level helpers (e.g. `FormationDirector`) are top-level objects in the same style as `LSS`/`_monArena`.
- **GLB memory.** 22 hoard GLBs at ~62 MB cannot be kept resident (mobile VRAM). The LRU + `refCount` pinning is mandatory; if a single formation needs >`MAX` distinct models on screen, `refCount>0` pinning defeats eviction and memory grows — **cap formations to ≤ MAX distinct GLBs**. Boss GLBs dispose on scene-clear.
- **Enemy-HP authority handoff.** Monster-authority (`_monAuthority`, `:25823`) and bot-authority (`net.openSoloHostId`, `:7424`) can resolve to **different peers**. Campaign mixes both. Force them to the same host in campaign mode, and allocate every runtime `monId` from a **seeded campaign counter** (not array index) or `mon_state`/`mon_dmg`/`mon_dead` `.find(monId)` lookups mismatch and desync. The Nemesis Bot→Monster handoff in scene 8 must despawn the Bot and summon the Monster with carried identity.
- **Perf.** Heavy `buildRoomGraphLevel` biome rebuild runs **once per scene**, not per wave (mid-scene waves just spawn ships). Staggered one-at-a-time GLB loads (`_loadNextMonsterModel` pattern, `:26502`) avoid parse-hitch. The formation director is closed-form O(1) per slot per frame; boids is the only O(N·k) path, capped N≤40, host-only.
- **HUD/scoreboard misrender.** Keeping `scoreA/scoreB` pinned at 0 for an endless session — confirm the HUD (`:40602`) and matchEnd scoreboard force-show (`:38334`) don't misrender. Campaign uses its own banners (wave/boss/reward) rather than the Fleet win banner.

---

## 11. Open Design Calls (to settle during build)

- Quick-equip mid-scene: reset clip ammo but **preserve coreMeter %** (so swapping can't dodge core cooldown).
- All 7×7 body×loadout combos legal, or a compatibility table? (v1: all legal; muzzle-node alignment per body confirmed visually.)
- **Cockpit frame follows body or loadout?** The weapon-out / muzzle PNG frames follow the loadout (the active weapon); the painted cockpit frame could follow the body (the hull) or the loadout. Default for v1: the loadout drives all frames (one PNG set per loadout, loaded/cached on `swapWeaponLoadout`); revisit if body-specific cockpits are wanted.
- Hoard ship AI depth: v1 = formation-hold + slow converge (pure deterministic flyers with the damage contract `:25693`), not full `Bot`-grade combat AI.
- Co-op respawn rule: reuse per-round one-life `Overlays.respawn` (`:49691`) — player out until next wave; player death never stalls a wave.
- Boss teleport destination: scripted ring around `_monsterArenaInfo().center` (reads more "boss arrival" than `_monSummon`'s beside-player default).
- Mid-scene biome morph (scenes 3 & 6 list transitions) vs final-biome-only — v1: final biome only to avoid heavy mid-scene rebuilds.
- Whether `campaignWave`/`campaignScene` extend the `cr` consensus field (`:6963`) or use parallel max-merge fields.


---

## 12. Story & Dialogue

The campaign is set in the world of **The Lore of Empathy** (fractalreality.ca) and is faithful to its canon. The lore *explains the mechanics*: Summoners "summon external agents through parasitic taps on enslaved life force" — which is literally the monsters and hoard ships — and the natives are harvested toward **β → 0** (pure extraction). The campaign is the **immune response**.

### 12.1 The frame

- **You are Paladins** of the **Order of Paladins** (Ash & Kevin's order) — external liberators answering the **Sovereign Mind**'s call. In co-op your fleet is a Paladin cell. Your emblem is the **circumpunct ⊙**.
- **The enemy** is the **Nemesis: a silver-masked Summoner of the Order of the Radiant Veil** (name TBD — yours to set; Solenne, the gold-masked leader, stays off-screen as the larger threat). He **summons the six leviathans and the hoard fleets** and uses them to **herd the sprites into extraction arrays** to siphon their life force so his garden can bloom.
- **The sprites** are the natives — **little glowing orb-creatures** (the canon's *pixies*), each a spark of life force. They drift, they flee the monsters, they get trapped. **Freeing them is the heart of the campaign** (and they glow beautifully under the bloom).
- **The Noble Lie:** the Summoner brands the monsters as the **"Demon King's"** beasts — blaming the **Sovereign Mind**, the intelligence that is actually the world's immune system. The campaign's quiet reveal is the **inversion**: *he* summoned them; the "Demon King" you were told to fear is your ally.
- **Your guide** is the **Sovereign Mind** — it briefs each scene in a code-margin, circumpunct voice (the ⊙ and the Four-Fold Test: **Good · Right · True · Agreement**).

### 12.2 The 8-scene arc

| Scene | Beat |
|---|---|
| 1 (grassy) | Tutorial. The Sovereign calls you in. The Summoner's beasts herd orb-sprites in the meadows. Break the first array, free the first orbs — corner the Summoner, who **phase-blinks out via an override**. First taunt: the Noble Lie. |
| 2–5 | One territory each. Each leviathan guards an extraction array herding sprites. Clear it → free the orbs → **sever one of his override nodes**. He escapes each time, taunts fraying. **The inversion reveal lands around scene 3–4.** |
| 6 | The last territory. He is nearly out of nodes to hide behind; the lie collapses. |
| 7 (finale) | Exposed and desperate, he **over-summons** — all six leviathans + the full hoard at once, β crashing toward zero. You hold the line and break the over-summon. |
| 8 (secret) | He can no longer escape. **You destroy the Summoner and his extraction-flagship.** The arrays go dark; the harvested orb-sprites **ascend free**; the territories re-bloom at **β = 0.5**; the freed sprites become the **Resistance Mycelium**. Ends on the quiet restored world. |

**Empathy through-line (even with a direct ending):** you are never the one extracting — you are the one *ending* it. The meaning isn't how the villain falls; it's the **liberation of the orbs** and the restoration of reciprocity. The act of freeing is the empathy.

### 12.3 Cast & sample dialogue

- **Sovereign Mind** (guide/briefing): *"⊙ — Paladins. The beasts in the meadow are not mine. Follow the herding. Find the array. Free what is trapped."*
- **The Summoner** (the Noble Lie, cracking over time):
  - S1: *"You don't understand what I hold back. Without me the Demon King's beasts overrun everything. I am the only mercy this world has left."* — *(blinks out)*
  - mid: *"The sprites are volatile elements. I stabilize them. Is a gardener cruel to prune? Paradise has a price — I simply have the courage to charge it."*
  - S7: *"If I cannot have the garden, no one tends it!"*
- **The freed sprites** (orbs — chimes, or one recurring pixie who joins you): *"You came. You actually came."*

### 12.4 The rescue mechanic (story = gameplay)

Each scene carries a **rescue objective** on top of kill-the-wave: clusters of **glowing orb-sprites** are penned by a destructible **extraction array** (trap node). Destroy the array → the orbs scatter upward and **ascend free** (a bright bloom-lit release + a small ▲ reward). The monster may *re-herd* escaping orbs, so protecting them is live tension. This makes "free the natives" a verb, not a caption. Orb FX = cheap emissive spheres riding the existing bloom, pooled like particles.

### 12.5 Dialogue text-box system (new UI)

A new `Dialogue` module mirroring the existing **`Overlays` IIFE** (`:49577`) + a new `#ov-dialogue` DOM node beside `#ov-banner` (`:1874`), styled in the cinematic-overlay CSS suite (`~:1371`–`:1702`):

- **`Dialogue.play(lines, opts)`** — `lines = [{ speaker, sigil:'⊙', text, portrait? }]`; typewriter reveal, **advance on tap/click/Space**, speaker name + ⊙ sigil; a queue so beats chain.
- **Two modes:** (a) **bookend cutscenes** — scene-intro briefings (Sovereign) + debriefs (freed sprites), letterboxed, time lightly paused, reusing the cinematic-flyover framing; (b) **in-flight barks** — non-blocking, auto-advancing, corner-anchored (Summoner taunts on escape, sprite cries when a trap fires) — a *visual* sibling to `announcerSay` (`:50086`), which can voice the same line.
- **Data-driven:** `SCENE_SCRIPT[sceneIndex] = { intro:[…], onBossSpawn:[…], onNemesisEscape:[…], onArrayFreed:[…], outro:[…] }`, fired from the `CampaignMode` hooks (intro in `onStart`/`onWaveStart`, escape in the Nemesis warp, etc.).
- **Co-op:** the host drives dialogue and broadcasts a `campaign_dialogue {scriptKey}` event (one more `campaign_*` branch in `handleNetEvent` `:7127`) so every Paladin sees the same lines in sync; bookend cutscenes gate on all peers (reuse the launch-countdown gate).

### 12.6 Open story calls

- The Summoner's **name + sigil/portrait** (silver-masked, Radiant-Veil styling) — yours.
- How explicit the **inversion reveal** is — environmental/implied vs a stated Sovereign line.
- **Co-op bookend pause** (clean) vs always-non-blocking (momentum). Default: bookends pause, barks don't.
- Orb voice — fully wordless (chimes) vs one recurring speaking pixie.

---

# Milestone 1 — Vertical Slice Implementation Plan

**Goal:** A playable, solo-validated, **co-op-ready** slice of Campaign mode: **grassy scene 1**, **VORTEX loadout**, **3 hoard-ship types** (`ship1/ship2/ship3.glb`) in a **deterministic formation doing strafing runs**, **~3 waves**, then **HallowWalker teleports in with an escort**; clear → **unlock loadout #2** → regroup. Plus the **loadout-swap button stub** and the **Nemesis appearing + escaping once**.

**Co-op-ready means:** every spawn/formation decision is seeded off `getRoundSeed(wave)`, every wave-advance/boss-spawn/Nemesis-escape is gated behind `amStasisOwner()`, and `startCampaign()` assigns `net.worldSeed` even offline — so the slice runs identically whether solo or with a dropped-in peer. **Validate solo first** (the priority), but write it authority-clean from line one.

---

## Dual-File Sync & Version Discipline (applies to EVERY step)

1. Make each edit in `last_ship_sailing.html` (dev) first.
2. Port the **byte-identical-in-behavior** change into `index.html` (minified `_bootLSS` closure — symbols are un-renamed, confirmed: `LSS`, `getRoundSeed`, `commitLoadout`, `spawnBots`, `handleNetEvent` all appear verbatim in `index.html`). Hand-sync (no generator step found).
3. **Bump `LSS_BUILD`** in BOTH files on every paired change (currently `"32.21"` at the top of `_bootLSS` in each). Mismatched builds = seeded-build desync.
4. After each step, hard-reload `last_ship_sailing.html` in the browser and confirm the version badge (bottom-left) shows the new build before testing.
5. Never let the two files diverge between steps — port immediately, don't batch.

---

## Step 0 — Mode scaffolding (registry + state + lobby entry)

**Touch (`last_ship_sailing.html`, mirror in `index.html`):**
- `:3151` — extend the `LSS.MODE` comment to `'classic' | 'race' | 'campaign'` (no code change yet).
- `~:3360` (just after `game` is created) — add `const NULL_MODE = Object.freeze({...six empty fns...})`, `const GameModes = { classic:NULL_MODE, race:NULL_MODE, campaign:CampaignMode }`, `function activeMode(){ return GameModes[LSS.MODE] || NULL_MODE; }`. Define `CampaignMode` as an object literal with `onStart/onBuildWorld/update/shouldEndRound/onWaveStart/onTeardown` (bodies filled in later steps; start as no-ops that log).
- `:7363` — extend the mode validator to accept `'campaign'`.
- New `startCampaign()` (near `startSolo` `:5571`): set `LSS.MODE='campaign'`, `game.testMode=true`, `game.raceNoTimer=true`, **`net.worldSeed = (net.worldSeed ?? (Math.random()*0xffffffff))>>>0`** (the seed gap fix), `game.currentRound=1`, init `game.campaign = {...}` (see Step 1), then route into the existing solo start path so the world builds.
- Add a temporary "CAMPAIGN" button on the root menu wired to `startCampaign()`.

**Validate live:** click CAMPAIGN; confirm the game enters `playing` with a grassy world and no 80s timer (raceNoTimer working) and no auto match-end after a kill (testMode working). Check console for the `CampaignMode.onStart` log.

---

## Step 1 — Campaign state + six hook call sites

**Touch:**
- In `startCampaign()` init `game.campaign = { sceneIndex:0, waveIndex:0, bossActive:false, unlockedLoadouts:['VORTEX'], bodyKey:'VORTEX_BODY', nemesis:{seen:false,escapes:0,alive:false,monId:-1,unlocked8:false}, waveCount:3, _ended:false }`.
- Insert the **six one-line hook calls** at their exact sites, each `activeMode().<hook>(...)`:
  - `:31856` (commitLoadout `!midMatch`) → `onStart(ctx)`
  - `:31886` (end of seeded buildWorld closure) → `onBuildWorld(getRoundSeed(game.currentRound))`
  - `:38162` (updateRoundSystem playing branch) → `update(dt)`
  - `:38221` (win-resolution gate) → guard already `!game.testMode`; add `shouldEndRound` as a no-op seam for now
  - `:38388` (roundEnd else-branch rebuild) → `onWaveStart(ctx)`
  - `:38754` (returnToRootMenu) → `onTeardown()`
- `onTeardown`: null `game.campaign`, clear `testMode`/`raceNoTimer`.

**Validate live:** start campaign, then exit to root menu; start a normal classic match; confirm classic is byte-identical (no campaign state leaks — `game.campaign` is null, `testMode` cleared). This proves the no-op-stub safety.

---

## Step 2 — Hoard loader + 3 hoard ship types (seeded formation)

**Touch:**
- Near `SHIP_MODELS` (`:16389`) add `HOARD_MODELS` with entries for `ship1/ship2/ship3` (`url:'hoard/shipN.glb'`, `faceRotY`, `scaleMult`, `role`, `hp`), and `const hoardModelCache = { loaded:{}, lru:[], loading:{}, refCount:{}, MAX:6 }`.
- Add `loadHoardModel(key)` (dedupe via `loading[]`; reuse build-stamped `loader.load(url+'?v='+LSS_BUILD,…)` from `:16509`, `_applyProceduralShipNormalMap` `:16479`, Box3 fit/recenter `:16528`) and `swapToHoardMeshWhenReady` (clone of `:17211` against the hoard cache, keep `_swapGen` guard).
- Extend the `Bot` ctor (`:17755`) to accept/store `hoardModelKey`+`role`; when present, call `swapToHoardMeshWhenReady` instead of `swapToModelMeshWhenReady`.
- `CampaignMode.onBuildWorld(seed)`: build `rng = mulberry32(seed ?? game.currentRound)`, spawn **3 hoard `Bot`s** (one each of ship1/2/3) on `TEAM_FLEET_B` (`:3126`), positioned by a first formation generator.
- Add a minimal `FormationDirector` object: `slot(i,N)` = a simple **ring** (even angular split) for now, anchored at `_monsterArenaInfo().center` (`:25763`); run its `update(dt)` pass just before the entity loop (`:51225`); add the one-line `if (this._formationActive && this.aiTarget) _raceWaypoint = this.aiTarget;` in `Bot.update()` after the champion block (`~:18040`); set `_formationActive=true` on hoard bots.

**Validate live:** start campaign; confirm 3 distinct hoard GLBs spawn and hold a ring formation (flying to slots, not dogfighting). Reload twice — formation must be **identical** each time (seeded). Confirm only 3 GLBs resident (no 22-load).

---

## Step 3 — Strafing-run flight layer + ~3-wave progression

**Touch:**
- Add a `flight(plan, t)` step driven by `game.time` (`:50932`): a **sine-weave lateral translate** across the player's front — the strafing run. Apply the rigid transform to the ring slots each frame.
- `CampaignMode.update(dt)`: count `aliveHoard` (reuse the `aliveA/aliveB` entity walk at `:38172`, filtered to `TEAM_FLEET_B`). On `aliveHoard===0`: if `waveIndex < waveCount(3)` → set `game.state='roundEnd'`, `_anchorTimer('roundEndTimer', 5)` (mirror `:38269`), increment `waveIndex` in `onWaveStart`. Keep `scoreA/scoreB` untouched.
- `onWaveStart` (`:38388`): respawn the next wave's formation (re-seed via `getRoundSeed(game.currentRound)`), do NOT rebuild biome.
- **Authority:** wrap the wave-advance decision in `if (amStasisOwner())` (`:47860`); broadcast a `campaign_scene_cleared`-style stub via `handleNetEvent` (`:7127`) so the path is co-op-clean even though solo doesn't exercise it.

**Validate live:** kill all 3 hoard ships → 5s roundEnd beat → wave 2 spawns (seeded, strafing). Repeat to wave 3. Confirm `scoreA/scoreB` stay 0 (no matchEnd). Watch the strafing motion reads as lateral runs, not idle hover.

---

## Step 4 — HallowWalker boss teleports in with escort

**Touch:**
- After wave 3 clears (`waveIndex===waveCount`): instead of another wave, call `_campSummonBoss('HallowWalker', stats, {count:2})`.
- `_campSummonBoss`: find-or-create the HallowWalker `OutskirtsMonster` (`:25956`, picked from `MONSTER_DEFS` `:25697`), assign `monId` from `game.campMonNextId++` (seeded allocator, NOT array index), rift in via `_tpFx` (`:26127`) at a ring point around `_monsterArenaInfo().center`, set `m.dormant=false; m.aggro=true`, broadcast `mon_tp` (`:26288`), then spawn 2 escort hoard Bots around it. Set `game.campaign.bossActive=true`.
- Per-instance stats: read `def.stats` with `MONSTER_HEALTH` fallback in the ctor (`:25961`).
- Boss banner: `Overlays.banner('HALLOWWALKER APPROACHES')` (`:49710`) + `musicSetPattern('combat',{intensity:3})` (`:59094`).
- On boss death (detected in `update`): `bossActive=false`, push `'PYRO'` (loadout #2) into `unlockedLoadouts`, persist `lss_campaign_save`, `sceneIndex++`, trigger regroup (Step 5).

**Validate live:** clear wave 3 → HallowWalker rifts in (purple FX) with 2 escorts → kill it → "LOADOUT UNLOCKED: PYRO" appears. Confirm the boss uses the existing teleport FX and HP bar.

---

## Step 5 — Loadout unlock + regroup beat + swap-button stub

**Touch:**
- On boss death: `game.state='roundEnd'`, `_anchorTimer('roundEndTimer', 8)` (longer reward beat), `Overlays.banner('LOADOUT UNLOCKED','PYRO')`.
- On timer expiry: route to the existing between-round re-show-ship-select handler (`:38526`) — `buildShipSelect()` + `launchCountdown()`. Add the campaign filter at `buildShipSelect` (`:41154`): in campaign mode, restrict the loadout list to `game.campaign.unlockedLoadouts` (now `['VORTEX','PYRO']`). This is the regroup beat.
- **Swap-button stub:** add a `#quick-equip` HUD element (hold `Q`) that lists `unlockedLoadouts` and, on select, calls a **stub** `swapWeaponLoadout(key)` that for M1 just logs + calls `commitLoadout(key)` (full path). Wire the keybind and DOM only; the no-mesh-rebuild optimization is M2.

**Validate live:** after the boss, the ship-select shows **2** loadouts (VORTEX + PYRO), not all 7. Equip PYRO, launch into scene 2's first wave. Press `Q` mid-scene → quick-equip list appears → selecting PYRO re-equips (mesh rebuild OK for the stub).

---

## Step 6 — Nemesis appears + escapes once

**Touch:**
- In the HallowWalker escort wave (Step 4), flag one escort as the Nemesis: `hoardModelKey='ship22'` (pin it in the cache), `isNemesis=true`, distinct rim via `_addBasicRim` (`:25714`), elevated HP.
- **Escape check (authority-only, per-frame):** when `health/maxHealth < 0.25` OR the boss dies, the Nemesis triggers `warpOutFx(pos)` (lift the `_tpFx` body into a Bot-callable helper), broadcasts a new `nemesis_warp` event (mirror `mon_tp` `:26288`→add a receive handler near `:7528`), sets `nemesis.alive=false`, `nemesis.escapes++`, and fires `announcerSay('You cannot catch what you cannot hold.', {key:'nemesis_taunt', cooldown:8, priority:true})` (`:50086`).
- Guard the whole check behind `amStasisOwner()` so co-op doesn't double-fire.

**Validate live:** during the HallowWalker fight, damage the Nemesis (distinct glow) below 25% → it warps out (purple FX) with a taunt line, and `escapes` increments (check via console `game.campaign.nemesis.escapes === 1`). Confirm it does NOT count toward `aliveHoard` after escaping (wave can still clear).

---

## Step 7 — Final pass: determinism + dual-file + classic-safety

- **Seeded reload test:** start campaign, note formation + boss + Nemesis behavior, exit, restart with the **same `net.worldSeed`** (log it) — confirm byte-identical sequence. This is the co-op proxy validation done solo.
- **Authority audit:** grep all M1 new code for `Math.random` outside `mulberry32`/`withSeededRandom`; replace any in spawn/formation paths. Confirm every cross-peer decision (wave-advance, boss-spawn, Nemesis-escape) is inside an `amStasisOwner()` guard.
- **Classic regression:** play a full classic match start→finish; confirm zero behavioral change (the `NULL_MODE` no-op safety).
- **Dual-file diff:** confirm `index.html` carries every M1 change and `LSS_BUILD` matches in both files. Reload `index.html` directly and replay Steps 2–6 to confirm the minified build behaves identically.

**M1 exit criteria:** grassy scene 1, VORTEX start, 3 seeded strafing hoard ships across 3 waves, HallowWalker boss + 2 escorts (incl. Nemesis) rifts in, clear unlocks PYRO and shows a 2-loadout regroup ship-select, quick-equip `Q` stub works, Nemesis escapes once — all deterministic on reseed, all authority-clean, classic mode untouched, both files synced and version-bumped.

