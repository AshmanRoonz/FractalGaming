# ENDLESS mode — design

> **STATUS (2026-08-01): Stages 1+2+3 SHIPPED (v35.71 + v35.72).** The full
> loop is in: seeded endless route (126.79 km verified run, 18-segment
> window), lives-as-difficulty, distance HUD; the ambush director
> (travel → warning → battle → cleared, waves scale with km, elites every
> 5th, cleared = hull patch; bots fly the cavern via the straightaway's
> terrain nav); theme stretches every 9-15k u (biome + atmosphere swap ahead
> of the ship — the crossfade is spatial); god rays under ceiling cracks in
> calm biomes; storm stretches (35% of rocky/snow reaches: god rays off,
> ambient lightning strikes near the lane). All verified by driving the real
> mode code in-browser; live screenshot shows the HUD at 2.78 km.
> **(v35.85) CO-OP ENTRY SHIPPED** — startEndless hosts the room via
> _startHostedMode when a room is live or a #room-code is typed (solo path
> byte-identical otherwise); the shared-rng-stream split landed with it (see
> "Co-op v1" below). Remaining (stage 3b/4): water/lava hall set-pieces,
> music sync, boss milestones, daily seed, and the co-op v1 refinements
> listed below.

> 2026-08-01, from Ashman's brief: "endless caverns, winding, bending, straight
> aways, openings with water, or lava, or growing things... gas clouds and
> rocks... god rays coming through cracks in the ceiling through the cloud
> dots... changing themes as you travel... stormy areas, calm peaceful areas,
> areas on fire, mystical and magical areas, alive areas... enemies will ambush
> after a set amount of time, so it's explore/travel, battle, explore/travel,
> battle." Score is how far you get before dying.

## The one-sentence build

Endless mode is the campaign's Themed Journey made **seamless and infinite**:
one continuous flight where the route is generated ahead of the ship, biomes
crossfade instead of ending legs, and the campaign's existing travel/battle
rhythm fires on a distance clock.

## Why this is mostly composition, not construction

Verified against the code (anchors are `Jump:` strings for `index.html` /
`index-working.html`):

| Vision element | Existing system | Anchor |
|---|---|---|
| Endless terrain | Hub already streams sandwich terrain forever (`FOOT: _isHubMap ? null : {...}`) | `function updateSandwichStream` |
| Winding / bending / straightaways / openings | The route is **data**: `game.levelSpheres` (rooms) + `game.levelCylinders` (lanes); `_stRouteAt` carves terrain around them as a pure function of (x,z). Append segments = the world continues | `function _stRouteAt` |
| Cavern feel with cracks of sky | WALL_PINCH partial closure (0.24 on the Straightaway, 0.45 default) leaves the crack deliberately ("not a complete pinch", Ashman) | `function _stGroundYCarvedBase` |
| The straightaway precedent | `race_straightaway`: two carved rooms, open pinched cavern between, bots fly it with `_campHoardTerrainNav` | `race_straightaway: {` in MAP_DATA |
| The campaign corridor precedent | `CAMPAIGN_LEG_MAP` ('The Approach'): spawn room, long open cavern, arena far ahead | `const CAMPAIGN_LEG_MAP` |
| Changing themes | `_SW_BIOMES` palettes + `_SW_BIOME_LOOK` (per-biome fog/aerial/mood/grade/strata/veins, all data) + the Themed Journey's per-biome legs + hub zone crossfading | `const _SW_BIOMES` · `_hubZoneTick` |
| Travel, battle, travel, battle | The campaign's scene state machine already alternates 'travel' and battle waves | `_campStartScene` |
| Ambush waves | Campaign wave spawner + formations + hoard bots | `function spawnCampaignWave` · `FormationDirector` |
| Gas clouds and rocks | `BillboardCloudSystem` / `GasCloud` / basin clouds; `DestructibleObstacle` / `ClusterObstacle` | `class BillboardCloudSystem` · `class DestructibleObstacle` |
| Growing things ("alive areas") | Zone-aware foliage: trees, snow trees, bioluminescent mushrooms clustered on fungus noise | `_swBuildTrees` · `_swGenMushroom` |
| Water openings | Hub water + ripple sim + underwater tint | `_swBuildHubWater` · `_swUpdateUnderwater` |
| Lava openings | Volcanic biome (uLavaGlow emissive accents already in the terrain shader) | `volcanic:` in `_SW_BIOMES` |
| Storm areas | Weather system moods + the lightning pool fired ambiently | `const _WX` · `spawnLightningBolt` |
| Peer-identical procedural worlds (future co-op) | The Shifting Deep regenerates its room graph per round from (worldSeed, round); same trick seeds the route generator | `_lssGenShiftingDeep` |
| Deterministic rng | `mulberry32` / `getRoundSeed` | `function mulberry32` |
| Score reporting | match-result POST + leaderboard page | `postMatchResultToBackend` |

Genuinely new pieces: the **route generator** (a segment grammar), the
**theme scheduler** (distance-keyed biome blending), the **ambush director**
(a small state machine wrapping the wave spawner), **god rays** (new visual,
cheap billboard shafts), and the **distance HUD / run-over screen**.

## The route generator (the spine)

A seeded grammar emits segments ahead of the ship and prunes behind:

- **STRAIGHT**: one cylinder along the current heading, 2000-4000u.
- **BEND**: 2-4 short chained cylinders turning up to ~60° total; heading
  persists between segments so the route flows.
- **CLIMB / DIVE**: a straight with a `cy` delta (the carve already
  interpolates tunnel height along cylinders).
- **HALL**: a sphere room, r 1200-2400 — the "openings". Rooms are where
  set-pieces spawn (water floor, lava floor, growth, obstacle clusters, and
  most ambushes; ambushing in a hall gives the fight room to breathe).
- Weights vary by theme (stormy = more bends and tight lanes; peaceful =
  long straights and big halls).

Distance score = accumulated arc length along the route (not displacement),
integrated from segment progress, shown on the HUD in km.

### The two invariants that make it work

1. **Generate far ahead, prune far behind.** `_stRouteAt` loops every sphere
   and cylinder for every terrain sample, so the active route list MUST stay
   small (a window of roughly the last 8-12 segments, everything else
   pruned). Terrain chunks bake lazily as the stream radius reaches them, so
   as long as a region's route data is final before its chunks bake (generate
   ≥ 2 stream radii ahead) and pruning only removes segments whose chunks
   have already unloaded behind, mesh and collision never disagree. Never
   let the generator re-enter a region whose chunks were baked under
   since-pruned route data; drift the heading to keep moving out.
2. **All three terrain copies see the same data.** The carve trio is
   triplicated (worker string / main / collision `worldSDF`), and lss.map.md
   flags this as trap #7. Stage 1 starts by auditing how `game.levelSpheres`
   reaches each copy today and posting route updates to the worker on
   append/prune. Nothing ships until a chunk baked by the worker matches the
   collision field at the seam.

### Float precision (decide at stage 3)

Hours-long runs march coordinates into float32-unfriendly territory
(~100k+ units). Two options, either fine:
- **Re-origin shift**: every ~60k units, translate the world (ship, route,
  chunks, effects) back toward origin between frames. Standard streaming
  trick; LSS has none today, so it touches many systems — do it late, behind
  a version bump, or
- **Bounded wander**: bias the generator to orbit inside a ~40k radius disc
  forever (score is arc length, so winding in a bounded world still scores).
  Costs the self-avoidance rule above (never re-enter loaded-stale regions),
  which a heading-drift rule satisfies most of the time with an occasional
  forced HALL detour.

Stage 1-2 simply cap runs well inside safe range (a 50 km run is already a
long session) and log a `_endlessOriginDebt` metric to decide with data.

**RESOLVED (v36.06): bounded wander stays, and its seam is closed.** The
shipped 42k home-bias created the first real long-run failure (owner report:
choppy 45-53km, then no enemies and a frozen km counter): where the bias
turns the invisible spine home, a free-path pilot flying their own valley
line diverges past the tracker's 3-seg x 4200u window and NOTHING recovered
— dist froze forever, waves anchored to the stale window tens of km behind
(director wedged in `battle`), and the append-rebake churn (the chop) died
with the extension stall. v36.06 adds the missing recovery ladder, all in
`EndlessMode.update` / `_lssEndlessNextSeg`:

1. **Relock** (4s unlocked, moving): re-scan the whole tracked window
   forward; credit the straight chord flown while lost, capped by the
   skipped spine arc (monotone).
2. **Re-anchor — "the cavern finds you"** (>5200u from every tracked seg for
   5s, SOLO only): credit the lost chord (speed-capped), free the stale
   window (bolts, carve shapes, and their baked chunks via the v35.84
   invalidation rule), restart the generator ~2600u ahead on the flight
   heading. dist/aegis/lives survive; gids stay monotone. Co-op seam: a
   re-anchor derives from local position and would fork the v35.85 shared
   deterministic route — roomed runs keep the old behavior until a
   route-authority net event exists (quirk #8 below in spirit).
3. **Wave lost** (every live wave bot >14km for 10s): despawn stragglers,
   return to `travel` — ambushes always find you again.
4. **Self-avoidance** in the generator: candidate endpoints steer away from
   visited 4.2k-cells (fixed deflections, zero extra rand() draws, visited
   set derived from route state in gid order — co-op byte-identical).

Proof: headless 95km harness with two deliberate 63-degree strays at bias
onset — 98.1% of flown arc credited, freeze spans bounded under ~8km with
the chord landed on recovery, every wave spawn within 5.3km, window/chunk/
entity censuses flat, run-over path clean at 99.51km. Re-origin shift is
therefore NOT needed for the currently reachable session lengths; revisit
only if runs beyond ~150k from origin ever become possible.

## The theme scheduler

The run is a sequence of **theme stretches**, 8000-15000u each, seeded, with
~1200u crossfades at the boundaries:

| Stretch | Biome/look base | Dressing |
|---|---|---|
| Calm / peaceful | grassy or snow | long straights, big halls, god rays, birdsong-adjacent music state |
| Stormy | rocky, dark mood | ambient `spawnLightningBolt` strikes, heavier fog, wind-audio bed, more bends |
| On fire | volcanic | lava-floor halls, ember particles, heat-hazed gas pockets, uLavaGlow up |
| Mystical / magical | crystalcave or goldmine | vein emissives up, crystal props, slow god rays, anomaly-ish props |
| Alive | mossy | dense mushrooms/trees in halls, fungus clusters, green fog, critters |

Mechanism: everything a biome touches is already data (`_SW_BIOMES` palette,
`_SW_BIOME_LOOK` fog/aerial/mood/grade), and the hub zone system already
proves live crossfading of exactly these knobs. The scheduler lerps between
two biome entries by route distance the way `_hubZoneTick` lerps by position.
Follow the sentinel-lighting pattern (the weather system owns light
intensities and writes on change; a theme must not raw-multiply them, per the
`lss-visual-iteration` note in FRACTAL_ARENAS.md).

Two per-stretch hooks into terrain flavor, both already parametric: bump
`WALL_PINCH` / `CLEAR_SOFT` per stretch (tight stormy lanes vs airy peaceful
halls; safe because they only affect chunks not yet baked, same rule as route
data), and `T.PILLARS` for a colonnade stretch later.

## The ambush director

A small state machine, campaign-shaped:

```
TRAVEL (clock runs: base 45-70s, minus a distance-scaled squeeze)
  → WARNING (5s: announcer line, radar pings, music shifts)
  → AMBUSH (spawnCampaignWave-style group, strength = f(distance);
            spawned AHEAD and to the sides on the route, formation entry)
  → CLEARED (wave dead: brief reward beat — core charge, health pickup,
             loot ping; music relaxes)
  → TRAVEL
```

- Wave budget scales with km traveled; every ~5th ambush is an elite wave
  (nemesis-style ship or mini-boss via the champion/boss machinery).
- Bots use `_campHoardTerrainNav` (already proven on the straightaway's
  open cavern, which is this exact terrain shape).
- Fleeing is legal but the clock shortens if you skip a fight (anti-cheese:
  uncleared waves chase; next ambush arrives sooner until cleared).
- Death = run over. No respawn. Run-over screen: distance, ambushes
  survived, theme reached, personal best (localStorage), backend POST when
  signed in (leaderboard precedent exists).

## God rays (the one new renderer feature)

Cheap and in-engine-style: pooled additive billboard shaft quads (soft
vertical gradient texture, tilted to the sun direction, depth-tested, no
shadows), spawned where the ceiling crack opens: sample the carved gap along
the route ahead; where `_stCeilYCarved` jumps toward open sky (the pinch
crack), drop 1-3 shafts + a dust-mote particle burst from the existing
particle system. Themes gate them (calm/mystical mostly). The "through the
cloud dots" read comes free: billboard clouds additively overlap the shafts.
Budget: ~8 shafts live, distance-culled. No postFX pass, so the VR path is
unaffected (it returns before the post chain).

## Mode plumbing

- `GameModes.endless` descriptor + menu entry (follow the v35.20 flat-menu
  conventions; solo-first).
- `MAP_DATA.endless_caverns` with `procedural: 'endless'`; the
  `buildRoomGraphLevel` branch (Shifting Deep precedent) seeds the generator
  and emits the first ~6 segments + spawn room.
- Round system: no round timer, no fleet-wipe end, no scoreboard cycle;
  `updateRoundSystem` gets an endless branch that only watches player death.
- Netcode: stage 4 co-op entry SHIPPED in v35.85 (see "Co-op v1" below);
  the Shifting Deep peer-identical-world bet paid off — the only extra work
  was isolating the route rng stream from the cosmetic draws.

## Co-op v1 (v35.85) — what shipped, what's deliberately deferred

Shipped (anchors are `Jump:` greps):

- **Entry** — `startEndless` mirrors `startFreeFlight`: live room or a typed
  `#room-code` → `net.endless = true` + `_startHostedMode()` (the
  `open_solo_start` handshake carries `mode:'endless'` + the shared seed);
  no room and no code = the exact v35.71 solo path. Joiners adopt via the
  new `'endless'` branch in `_applyModeClientSetup` and the `map_change`
  mode whitelist; mid-run drop-ins ride `dropin_state` like campaign.
- **One team** — every human is `TEAM_FLEET_A`
  (`assignTeamFromPeerOrder` / `_teamForPeerId` early-return for
  `net.campaign || net.endless`); waves stay `TEAM_FLEET_B`.
- **Deterministic shared route** — `_lssGenEndlessLevel` seeds TWO
  mulberry32 streams: `gen.rand` (seed ^ 0x9D2C5680) is consumed ONLY by
  `_lssEndlessNextSeg`, so segment N is byte-identical on every peer no
  matter when each client's position-trigger extends; `gen.cos`
  (seed ^ 0x41C64E6D) feeds themes / god rays / storm bolts and may
  free-run per client. Extension and pruning stay client-local.
- **Wave authority** — `amStasisOwner()` (lowest peerId) alone runs
  `_director` + `_spawnWave`; rosters/state stream over the campaign bot
  rails (`_botSendRoster` on spawn AND on cleared — the cleared sweep is
  what removes peers' dead proxies; `_botNetSync` ~8 Hz; the four gates are
  now `net.campaign || net.endless`). Non-authority clients run
  `_coopPhase`: battle/travel + banners + the cleared hull-patch derived
  from proxy liveness — no spawn, no clock, no extra net event.
- **Distance & lives are PER-PLAYER** — each client scores its own arc
  length (a pack flying together reads ~the same number); lives come from
  each player's own difficulty pick; out-of-lives = RUN OVER banner +
  best-write for that player only, then they SPECTATE via the existing
  death cam (the 6 s soft-return to menu is solo-only now) while teammates
  fly on.

Deferred / known v1 seams (refinement candidates, in rough priority):

1. Team-shared lives / team distance (one pooled meter, run ends for all).
2. Waves anchor to the AUTHORITY's ship; stragglers may see the fight far
   ahead. (Could anchor to the pack centroid or furthest player.)
3. A dead (or run-over) authority pauses NEW waves until it respawns or
   leaves (in-flight bots keep fighting; authority migrates on leave via
   the amStasisOwner recompute).
4. Mid-run drop-ins spawn at the cavern mouth and must chase the pack.
5. `bot_fire` replay suppression keys on `net.openSoloHostId`, which can
   differ from `amStasisOwner` — the mode-clicking host can miss wave
   tracer visuals when a joiner has a lower peerId (pre-existing campaign
   quirk, cosmetic only).
6. Difficulty is per-player, so lives differ inside one room; adjudicate
   whether the room should adopt the host's pick.

## Aegis Surge (v35.90) — rare hidden bolts grant persistent ranks

The permanent Aegis Ranks are a hub (Exhibition) progression; Endless gets a
RUN-SCOPED echo of it. v35.87 shipped a charge meter (bolts + kills in,
idle-drain out) and it played as a drip feed — "kinda boring" (owner).
v35.90 redesigned it around scarcity: **bolts are the ONLY source, each bolt
is a FULL rank, ranks never decay, and the bolts hide off the flight line.**
A rank is now an exploration find you keep for the whole run.

Mechanics (all on `game.endlessRun.aegis`; HUD tag ` · AEGIS Lx` on the
endless top-center line — no % readout, no decay UI; collecting pulses the
tag bright with a ⚡ for a beat, banner-free):

- **Bolts are the only charge source.** At most ONE bolt per gated segment;
  the gate is a pure gid hash passing ~28% of segments (~1 bolt per 3-5
  segments, measured 4.4 per 20). Collect radius ~120u (they are rarer).
  Collect = rank up (0..5), `rearm_reset` chirp, a bright `fireball_cyan`
  burst at the bolt, and the HUD pulse. Beyond L5 extra bolts still
  chirp/flash (nothing to grant).
- **Placement is off the main line** (`_lssEndlessBolts`): every draw is a
  **pure hash of the segment gid** — deliberately NOT `gen.rand` (the route
  stream — extra draws desync co-op routes) and NOT `gen.cos` (its cursor
  free-runs per client; nothing SHARED may draw from it). Alcove bolts sit
  420-1000u lateral of the spine, lifted to 62-92% of the carved gap (high,
  near the ceiling); segments with a side-hall chamber (`seg.spur`, the 40%
  off-lane halls) hang the bolt high in the chamber instead, constrained to
  the chamber's OUTWARD half — the next segment starts at `seg.b` and does
  not exist yet at placement time, so the constraint (not a check) is what
  keeps clearance from it deterministic per peer. A ≥420u xz
  point-to-segment floor is enforced analytically (3D distance ≥ the xz
  projection's), then the carved ground/ceiling clamp plus a `worldSDF <
  -60` step-DOWN adjust verifies open air; no air after 6 steps = no bolt on
  that segment. Measured over 128 segments: min distance-to-spine 437u xz /
  504u 3D, worst SDF -201, placement byte-identical across boots. Debug:
  `window.__endlessBoltProbe(x,y,z)` exposes closure `worldSDF` + carved Ys
  for headless checks; `__endlessAegis()` reports `offSpineMin`.
- **Ranks NEVER discharge.** No grace timer, no drain, and death does NOT
  zero: `respawnPlayer` reads `player.chassis` (our installed clone) and
  never replaces it, so speed/damage/regen ride through the respawn
  untouched. The surge resets ONLY in `onBuildWorld` (fresh run) and
  `onTeardown` (exact base-chassis-reference restore + a generic dispose
  sweep over the bolt material library).
- **Kills grant nothing.** The per-tick alive→dead liveness diff stays (real
  bots AND co-op proxies; vanish-without-dead-tick dropped uncounted) but
  only as wave bookkeeping — `a.kills` for stats, zero charge.
- **Buffs** — unchanged temporary multipliers scaled off the permanent
  tree's ceilings, applied reversibly:
  - **Damage** +6%/lvl (L5 = +30% ≈ two 1.15 tree damage nodes compounded)
    via `_endlessAegisDmgOut` in `Bot.takeDamage` — hooked BEFORE the
    isProxy route so co-op damage claims carry it.
  - **Speed** +4%/lvl (L5 = +20%, under the hoard's 1.33 precedent) via a
    CLONED chassis (`_campBoostSpeed` pattern). The base chassis REFERENCE
    is captured and restored exactly on teardown; the shared `CHASSIS`
    entry is never mutated (the task-1 rule).
  - **Hull regen** 0.3%·lvl of max per second (L5 = 1.5%/s; the Nano perk is
    1%/s for a whole perk slot). Hull, not shield — LSS shields never regen
    naturally (the stasis rule).
- **The look** (`_lssEndlessBoltSlot`) — a chaotic, brighter, smaller cousin
  of the StasisField energy sphere: emissive octahedron core (r22, toneMapped
  off) whose scale is pulsed by a 3-term incommensurate cosine sum (erratic,
  not smooth); TWO nested counter-rotating additive shells on the StasisField
  material family (`_makeFXMaterial('fireball_cyan')` r46 +
  `plasma_cyan` r64 — layered noise + fresnel; flat additive fallback on
  potato, the StasisField precedent); the additive halo sprite; and 3 small
  god-ray shafts EMITTED from the bolt (the `_ensureRays` canvas-gradient
  technique) 120° apart, leaning 0.55 rad outward, slowly precessing on a
  rig — deliberately NOT billboarded, the fan guarantees a non-edge-on shaft
  from any angle. All geometry/materials live once in `run._boltLib`, slots
  are pooled, zero per-frame allocations. **Mobile** (`_lssEndlessMobile`,
  v35.89 discipline): core + ONE shell only — no second shell, no sprite, no
  emitted rays; pool cap stays 24 (desktop 64).
- **Living motes (v35.91).** "They try to get away when you SEE them" —
  Weeping-Angel-INVERSE. A bolt flees only while OBSERVED: player within
  ~1400u AND inside the view cone (dot(camera forward, dirToBolt) > 0.55;
  one `getWorldDirection` per tick into a per-run reused vector). Fleeing is
  erratic darting AWAY at 300u/s (base away-vector, vertical damped, plus a
  3-term incommensurate cosine jitter — chaotic like its pulse),
  deliberately under base ship speed (350) and NOT rank-scaled, so Aegis
  speed ranks make later chases easier. Eyes off or out of range → it calms
  and drifts home at ~90u/s (snaps onto the anchor). The trick this buys:
  approach obliquely or eyes-off to sneak close, or run it down in a
  straight chase and corner it on its TETHER — a mote never strays more
  than 1600u from its gid-hash anchor (mixed-axis slides can overshoot;
  >1600.5 reverts to the pre-move offset). Every movement step is verified
  open air: carved-gap height clamp, then a `worldSDF < -60` endpoint check
  (the placement threshold) with an axis-drop slide on block — hold-height,
  then vertical-only: deflect along the wall, never a dead stop — and the
  pre-move offset is the always-valid fallback; dt is clamped to 0.05 so a
  hitch step cannot tunnel a thin wall. Perf: behavior ticks only for motes
  within 2500u of the player (distance early-out FIRST — a mote left beyond
  the gate holds a frozen offset until you return, by design), zero
  per-frame allocations, and the mobile branch is identical (it is just
  position math). Collection is unchanged (120u, rank-up) but measured
  against the mote's CURRENT position; shells/halo/emitted rays ride the
  moving group automatically. Debug: `window.__endlessMotes()` — anchor,
  current position, offset length, fleeT, and SDF per live bolt. Verified
  headless (v35.91): tracked-camera approach → 525u retreat in 2s; camera
  facing away → offset stays exactly 0; 30s max-pressure chase → tether max
  exactly 1600.5 with rest-position SDF never above -60 (bobbed worst
  -47.7), then a cornered collect 0.4s after closing (L1 + clone
  installed); calm return 525→0 at ~90u/s back onto the anchor; teardown
  exact-restores base speed 350 with every core mesh gone; 144 fps, zero
  console errors, mobile-sim slot carries core+one-shell and flees
  identically.

v1 seams (deliberate):

1. **Collection is local** — each pilot collects their own bolts; no
   pickup-consumed net event. Two ships can both grab "the same" bolt.
   (Sharing = a small `bolt_taken` gid+idx event, future work.)
2. Ranks are per-player; a pilot who explores side-halls out-levels one who
   flies the spine (that is the point now).
3. The bolt clearance math reads the live carve window; every peer evaluates
   a given gid at the same route state (build segs at `onBuildWorld`,
   appends at their own apply) so divergence is bounded to sub-metre joint
   noise — and collection is local anyway.
4. **Mote offsets are per-client** (v35.91): the deterministic gid-hash
   point is the shared ANCHOR; the runtime flee/return offset is local
   visual state (each client's own camera decides "observed"). Peers may
   see "the same" mote a few hundred units apart mid-chase — consistent
   with local collection (seam 1); shared-flee state would ride the same
   future `bolt_taken`-style message if sharing ever lands.
5. **Monster bounty drops are local per client** (v36.04): every peer runs
   `OutskirtsMonster.die` (authority + `mon_dead` replay), so each client
   spawns its OWN bounty bolt at the same corpse — consistent with seam 1
   (collection was always local). A bounty differs from a route mote in two
   ways: it never flees (a reward, not prey) and it expires ~45 s
   uncollected (shrink-out over the last 4 s). Pool guard: a drop is
   skipped silently unless ≥8 free slots remain under the bolt-pool cap,
   so bounties can never starve route bolts.

Verified live (headless `__endlessTick` + `__endlessAegis()` +
`__endlessBoltProbe`): 28 bolts over 128 segments (1 per 4.6), every bolt
≥437u xz / ≥504u 3D off-spine and in verified open air (worst SDF -201, all
at 53-80% of the carved gap height); placement byte-identical across two
boots of one seed; collect ×3 → L1/L2/L3 with speed 350→364→378→392 and
dmg ×1.06/1.12/1.18 (rebased, not compounded); death → L3 + the same clone
reference survive respawn, a life is spent; 60 s idle → no decay, regen
exactly 90 hp/s at L3 on a 10k hull; six wave kills → `kills:6`, rank
unchanged; teardown → the exact base reference restored (speed 350) and the
layered-FX census drops; the full desktop bolt stack costs 10 draw calls at
point-blank (525 total in-band, 144 fps); mobile-sim slots carry exactly
core + one shell, the ceiling ray pool never allocates, bolts still
collect; zero console errors.

## Stages

1. **The endless flight** (skeleton): mode button → endless map → seeded
   route generator appending/pruning → terrain streams along it (worker/main/
   collision audit FIRST) → distance HUD → death ends run. No themes, no
   waves. Exit: fly 10+ km at stable fps and framerate-flat route cost;
   collision seam-checked against baked chunks.
2. **The rhythm**: ambush director wired to campaign waves + warning/cleared
   beats + run-over screen + bests.
3. **The world**: theme scheduler + per-stretch dressing (water/lava/growth
   halls, gas, rocks, storms) + god rays + music sync + float-precision
   decision.
4. **The flourish**: elite/boss milestones, ~~co-op~~ (entry shipped v35.85
   — see "Co-op v1"; refinements remain), leaderboard board page,
   daily seed ("today's cavern" — everyone runs the same route), Branchwork
   Tier 2 spire props.

The Branchwork's Tier 1 field can land in stage 3 with the other themes; it
is already written and measured, so it is a paste-and-wire job rather than
a research one.

Each stage is shippable; each ends with the fragile-seams re-check from
lss.map.md (combat first-sight hitch, hub framerate, multiplayer combat
untouched).

## Lives as difficulty (ADJUDICATED, Ashman 2026-08-01)

Difficulty is chosen in ship-select and **is** the life count: **EASY 3 ·
MEDIUM 2 · HARD 1**. This replaces open decision 1 (the death rule).

The picker already exists: `_renderDifficultyPicker` (**Jump:** `function
_renderDifficultyPicker`) builds exactly three `perk-card` options from
`[['easy','EASY'],['medium','MEDIUM'],['hard','HARD']]` into `#diff-grid`,
persists through `_getStoredDifficulty` / `_setStoredDifficulty`, and writes
a one-line explanation into `#diff-desc`. Two changes:

1. **Un-gate it from campaign.** Its first act is
   `if (LSS.MODE !== 'campaign') { panel.style.display='none'; return; }`.
   It becomes a mode allow-list (campaign + endless).
2. **Endless reads it as lives**, with `#diff-desc` saying so ("3 lives ·
   the cavern forgives"). One store, two meanings: campaign keeps
   `_campSwarmCapFor` (swarm cap), endless adds `_endlessLivesFor`
   (3 / 2 / 1).

Because it is the same stored key, a player's campaign difficulty carries
into their first endless run — intended; it is one "how hard do you want
this" setting.

Run rules: a life is spent on death, and the run continues from a respawn on
the route a short way back (the campaign respawn path already exists), with
the ambush cleared and the distance clock kept. **Distance never resets** —
the score is how far you got, and spending a life is the cost of getting
there. Out of lives = run over. Leaderboards must therefore record the
difficulty alongside the distance; a 3-life run and a 1-life run are not the
same achievement, so they are separate boards (or the board shows lives as a
column and sorts within it).

## THE BRANCHWORK — a fractal branching zone (Ashman's request, prototyped)

> "a new zone where some of the noise/cavern spikes bend and branch like
> fractals"

**Prototyped and verified**, with one honest finding: this wants to be built
at *two tiers*, because LSS's terrain is a strict heightfield.

### Why two tiers

`_swBuildShell` writes exactly one Y per (x,z) for a ground shell and a
ceiling shell (**Jump:** `function _swBuildShell`). No overhangs are
possible in that path, and a spire thinner than ~4 terrain vertices (the
vertex step is `_SW_CHUNK / _SW_CELLS` = 900/40 = **22.5 u**) aliases into
noise. So the heightfield can carry branching *massifs*, but not delicate
bending spires.

**Tier 1 — `_stBranchAt`, the terrain field (built and measured).** A
recursive branch skeleton in the XZ plane driving both carved surfaces:
exactly the `_stPillarAt` pattern (**Jump:** `function _stPillarAt`)
generalized from Worley points to a forking, bending, tapering tree. Each
occupied cell of a coarse grid seeds one tree; the trunk forks into children
at shrinking length, thickness and height; every branch bends because its
heading drifts by a hashed amount at each sub-segment. Wired in exactly like
pillars: `MAP_DATA.<key>.terrain.branches` → `_branches` (seeded `ox`/`oz` +
a `clear` keepout list so the route lane stays flyable) → `T.BRANCH`,
consumed by the carved trio and `_stGapSDFCarved`.

**Tier 2 — branch spires as props (recommended, not yet built).** The engine
*already has a recursive branching generator*: `_swGenTree` (**Jump:**
`function _swGenTree`) builds real tube geometry with per-level `sections` /
`segments` / `taper` / `twist` / `gnarliness`, and a `force` term that steers
growth toward +Y **or −Y** — i.e. it can already grow downward, which is
what a branching stalactite needs. A "branch spire" is that generator with
crystal/rock colours, no leaf cards, bigger radii, and instanced placement on
the existing `_swForestAt` / `_swBuildTrees` path (which is already
zone-aware and already places bioluminescent mushrooms by biome). This tier
is where true 3D bending, overhanging, arbitrarily thin branches come from.

Tier 1 is the zone's silhouette and its collision; Tier 2 is what you fly
between. Ship Tier 1 first (it is one pure function), then Tier 2.

### Tier 1: measured results

Reference implementation `LSS/branchwork_reference.py`; engine-ready JS +
harness `LSS/branchwork_probe.html`.

- **Lockstep verified.** The JS and the Python reference agree to six
  decimals over a 120×120 grid: `sum(w) = 665.541942`, `sum(rise) =
  582.290680`, 973 hits, `max(w) = 1.000000`. (This matters because the
  carve math is triplicated — worker / main / collision — and trap #7 in
  lss.map.md is exactly this class of desync.)
- **Cost, measured in-browser.** First cut was **2026 ns/call — 4.1× the
  shipped pillar field, 20 ms per chunk**, which would visibly hitch
  streaming. Adding a **hierarchical subtree reject** (skip a whole subtree
  when the sample is outside `L/(1-lenRatio) + radius + soft` of its base;
  valid despite the bending because a curve of length L stays within radius
  L of its start) brought it to **696 ns/call — 1.43× the pillar field,
  7.0 ms/chunk**, with byte-identical output. That is the difference between
  shippable and not, and it is the one optimization this field must keep.
- **Collision cost is a non-issue**: ~0.33 ms per second of flight.

### Two shape rules learned by getting them wrong

1. **Slenderness.** Half-thickness must sit well under the sub-segment
   length. The first pass had `r0` 300 against a 273 u sub-segment: every
   tree fused into one lump. Now 115 against 225.
2. **Height must taper along the branch, not just per generation.** With one
   `rise` per branch, every arm was a flat-topped mesa. Interpolating rise
   from the branch's base to its tip (children starting where the parent
   ended) is what produces a central crown with arms descending and forking
   outward — the branching-spike read.

Tuned values (in `branchwork_probe.html`): cell 4200, drop 0.26, depth 4,
subs 4, len0 900, lenRatio 0.58, r0 115, rRatio 0.62, soft 95, spread 0.75,
curve 0.38, rise0 0.98, riseFall 0.26. Zone base terrain is calmed
(`GAP_HALF` 900, `AMP` 480 vs the stock 600/1120) so the branchwork carries
the silhouette instead of competing with fbm hash — both are per-map values
the engine already reads.

### How it looks (`concept/branchwork_plan.png`, `branchwork_firstperson.png`)

From above, unambiguous: forked, bending, tapering fractal structures
scattered through the cavern with the Endless corridor threading past them.
In first person at heightfield resolution they read as chunky tapering
massifs — good, not spectacular; the 95 u falloff spans only ~4 terrain
vertices, so the blend facets. Raise `soft` toward ~180 for a smoother
read. **This is precisely the gap Tier 2 fills.** (Caveat: the first-person
image is my prototype's raymarch of a 20 u/px heightmap, so some of the
terracing is the preview, not the field.)

### Where it goes in Endless

The Branchwork is one **theme stretch** in the scheduler (a "mystical /
alive" flavour), not a separate map: crystalcave or mossy palette, veins
emissive up, `T.BRANCH` on, base amplitude calmed, god rays through the
crown gaps. Every one of those is a per-stretch value the theme scheduler
already has to lerp.

## Open decisions (Ashman)

1. ~~Death rule~~ — **adjudicated: lives as difficulty, 3 / 2 / 1.**
   Sub-question left: on losing a life, respawn *on the route where you
   died* (keeps flow) or *at the last hall* (a checkpoint feel)? Design
   assumes on-route.
2. Ambush trigger: pure time, pure distance, or the blend above (time clock
   squeezed by distance)? The blend punishes neither explorers nor speeders.
3. ~~Bounded wander vs re-origin for long runs~~ — **adjudicated v36.06:
   bounded wander, with the recovery ladder (relock / re-anchor / wave-lost /
   self-avoidance) closing its divergence seam. See "Float precision" above.**
4. Does Endless share the race carousel slot pattern (`endless_` map key) or
   get its own top-level menu entry beside CAMPAIGN? (Design assumes its own
   entry; it's a flagship mode.)
5. Branchwork Tier 2: build the spire props in this pass, or ship Tier 1
   with the zone and add spires as a follow-up? (Design assumes follow-up.)
