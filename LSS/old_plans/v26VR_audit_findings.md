# Last Ship Sailing v26VR: Audit Findings

Scope: runtime performance, load/size, code quality, bugs/correctness. Every finding below was read and verified against the actual lines in `last_ship_sailing_v26VR.html` (57,659 lines, 2.55 MB raw, 646 KB gzip).

Overall: this is a mature, heavily optimized codebase (scratch vectors, swap-with-last removal, VR perf tiers, frame throttling, pooled DOM/particles, spatial-hash gas chemistry). The wins below are the real remaining gaps, not re-litigation of work you have already done. The most consequential issues are in the multiplayer netcode, not in rendering.

---

## Priority punch list

| # | Area | Issue | Lines | Severity | Effort |
|---|------|-------|-------|----------|--------|
| B1 | Bug/MP | Peer-supplied damage applied with no clamp; vote/consensus path is dead | 6140-6152, 9064 | High | Low |
| B2 | Bug/MP | Round/match timers averaged across peers in different game states | 6041-6082 | High | Low |
| B3 | Bug/MP | `round_end` dropped unless receiver is exactly in `playing`; peer can hang | 6213-6214 | High | Low |
| B4 | Bug/MP | `for...in` over a `Map` (`net.peers`); Outline perk is a no-op online | 27262-27263 | Medium | Trivial |
| B5 | Bug/MP | Invalid `loadoutKey` registers a half-built NetworkPlayer into `game.entities` | 5542-5543, 5919-5921 | Medium | Low |
| B6 | Bug/MP | Stale NetworkPlayers never cleared on return-to-menu | 32454, 47794 | Medium | Low |
| P1 | Perf | `_setShieldOverlay` does uncached `getElementById` + classList write every frame | 30144-30153 | High | Low |
| P2 | Perf | `_setShipShieldEmissive` full `mesh.traverse()` per active shield per frame | 29926 | High | Low |
| P3 | Perf | 3 wake/light fns allocate fresh arrays + object literals every frame | 7821, 9941, 14884 | Medium | Low |
| P4 | Perf | `splice(i,1)` expiry in particles/effects/dots/dynamicObjects (O(n^2)) | 22557, 23993, 24154, 24991 | Medium | Low |
| P5 | Perf | `updateAbilities` allocates ~15 `THREE.Vector3` per frame while abilities active | 30579+ | Medium | Medium |
| L1 | Load/size | No minify step; ~24% of bytes are comments; Quest parse cost dominates | whole file | High | Medium |
| L2 | Load/size | Organic-life system (~473 lines) dead behind permanent `false` flag, still ships | 22566-23037 | Medium | Low |
| L3 | Load/size | Heavy synchronous startup (audio IRs, ~820 pooled materials, warmup) before first paint | init | Medium | Medium |
| Q1 | Quality | ~963 `typeof X==='function'` guards (22 per frame in `gameLoop`) for same-module fns | 47541-47914 | Medium | Low |
| Q2 | Quality | Showcase mode hardcoded on; its `on`/`opts` params are dead | 12038-12040, 12071 | Low | Trivial |
| Q3 | Quality | Marching-cubes tables duplicated; one copy removable | 13366, 44468 | Low | Low |
| Q4 | Quality | `_vxPickGlowColor` defined, never called | 21089 | Low | Trivial |

---

## 1. Bugs and correctness (multiplayer netcode)

These are the highest-value findings. LSS is peer-to-peer with no authoritative server, so any peer can poison shared state.

### B1 (High): damage is peer-supplied and unvalidated; the consensus that was meant to guard it never runs
`net.pendingHits` is declared as a vote map (line 3135) but is **never written**: only `.get()` (6157), `.delete()` (6171, 6175, 9071, 9089, 9099), and iteration (9066) exist, no `.set()` anywhere. So `handleHitVote` always hits `if (!hit) return;` (6158) and `cleanupPendingHits` iterates an always-empty map. The only damage path that fires is the victim self-applying:

```js
6152:    playerTakeDamage(claim.damage, fakeAttacker);
```

`claim.damage` arrives from a peer and is passed straight through, gated only by a 4000-unit distance check (6120). The comment "consensus can override if vote fails" (6141) is not true today.

Trigger: any networked hit, or a malformed/hostile peer sending `damage: 99999` or `damage: NaN`.
Symptom: one-shot kills, negative-damage healing, or NaN health that then broadcasts and poisons everyone.
Fix: clamp `claim.damage` to `[0, maxPlausibleWeaponDamage]` with a `Number.isFinite` check before line 6152, and/or actually populate `net.pendingHits` in `handleHitClaim` so the vote tally you already wrote runs.

### B2 (High): shared timers are averaged across peers that are in different states
`applyGameSyncConsensus` (6041) blends `roundTimer/warmupTimer/roundEndTimer/matchEndTimer/game.time` as a plain average over every fresh peer (6060-6082). The peer's broadcast state field `s` is sent (6021) and stored (6452) but **never read** inside the blend. Scores and `currentRound` correctly take `max` (forward-only, safe); the continuous timers do not.

```js
6076:  game.roundTimer    = rtSum / n;
6078:  game.roundEndTimer = etSum / n;
```

Trigger: any 2+ peer match near a round boundary. Peer A enters `roundEnd` (roundTimer 0, roundEndTimer 5); Peer B still `playing` (roundTimer 3, roundEndTimer 0). A's average yanks roundTimer back up and roundEndTimer down while A's state stays `roundEnd`.
Symptom: countdowns visibly oscillate near transitions; peers see the round end at different real-times. This is the exact divergence the system was built to prevent.
Fix: in the loop at 6060, `if (snap.s && snap.s !== game.state) continue;` so only same-state peers contribute to the timer average. Keep the score/round `max` merge unconditional.

### B3 (High): `round_end` is ignored unless the receiver is already in `playing`
Only the lowest-peerId resolves rounds and broadcasts `round_end`; the receiver applies it conditionally:

```js
6213:  if (evt.type === 'round_end') {
6214:    if (game.state === 'playing') {
```

Combined with B2's timer skew (or plain network jitter), a non-authority peer can be in `warmup` or already nudged into `roundEnd` when the authoritative `round_end` lands, so it is silently dropped. Non-authorities never self-resolve, and because LSS is one-life-per-round, that peer's score and respawn never advance.
Symptom: a peer gets stuck with the wrong score and no respawn for the rest of the match.
Fix: accept `round_end` from any plausibly mid-round state (`playing` or `warmup`), apply scores/state idempotently, and reconcile respawn off the synced `currentRound` rather than the local transition.

### B4 (Medium): `for...in` over a `Map` makes the Outline perk a no-op online
`net.peers` is a `Map` (declared 3117), but `_tickOutlineOptics` iterates it with `for...in`:

```js
27262:  for (const pid in net.peers) {     // Map has no own enumerable keys
27263:    const peer = net.peers[pid];     // always undefined
```

The body never runs, so ally/enemy rim-highlights never attach to remote ships. (Bots do not spawn in MP, so the perk is effectively dead online.) This is the only place in the file that mis-iterates a Map.
Fix: `for (const peer of net.peers.values()) { ... }`.

### B5 (Medium): invalid `loadoutKey` creates a half-built NetworkPlayer that still gets registered
The constructor bails early on an unknown loadout (5543) without setting peerId/mesh/position/team/chassis, but `updateNetworkPlayer` registers the object anyway:

```js
5543:    if (!loadout) return;
5919:  peer.networkPlayer = np;
5920:  net.networkPlayers.push(np);
5921:  game.entities.push(np);
```

`game.entities` is then iterated for `.update()` (47784), team counts (32040), HP tiebreaks (32102), and animation.
Trigger: a peer broadcasts a `loadoutKey` not in `LOADOUTS` (version skew or corrupted packet).
Symptom: `TypeError` deref in the hot loop (broken frame/crash), or a phantom entity with `undefined` team skewing round-end counts.
Fix: validate `LOADOUTS[data.loadoutKey]` in `updateNetworkPlayer` before constructing, or throw in the ctor and skip registration when `peerId` is unset.

### B6 (Medium): NetworkPlayers leak across matches
`returnToRootMenu` (32454) clears `game.entities` but never empties `net.networkPlayers`, and `NetworkPlayer.destroy()` (5880) removes the mesh from the scene without nulling `np.mesh` or setting `np.alive=false`. The per-frame animation loop at 47794 (`for (const np of net.networkPlayers)`, guarded only by `!np.mesh || !np.alive`) keeps animating orphaned ships, and the array grows each match.
Fix: in `returnToRootMenu`, `net.networkPlayers.length = 0`; in `destroy()`, set `this.alive = false; this.mesh = null;`.

### Lower-priority correctness notes
- `match_start` lacks the dedup that `launch_at` has (6262 vs 6279), so a re-delivered packet can re-enter ship-select. Low impact (mostly idempotent), but worth mirroring `net.lastLaunchId`.
- `spawnNetworkProjectile` rejects a shot fired from exactly x=0: `if (!data || !data.ox) return;` (8948). Cosmetic only. Use `typeof data.ox !== 'number'`.
- `cleanupPendingHits` cadence `game.time % 1 < dt` (47760) can double-fire or skip a second under variable dt. Harmless while B1 keeps the map empty; becomes real once B1 is fixed. Drive it off an accumulator.

Verified-not-bugs (checked and cleared): `dt` is clamped (47559); `setAnimationLoop` cannot double-run (background tick guarded at 56331); owner migration uses lowest live peerId; lobby intervals/heartbeats are cleared on teardown; `net.peers`/`net.peerGameSync` are cleaned on peer-leave.

---

## 2. Runtime performance

VR path is already correct: `renderFrame` (13135) skips the entire post-FX pipeline on Quest, and `cineFX` bloom/SMAA/Bokeh is opt-in and gated off in VR. The items below are the real remaining per-frame costs.

### P1 (High): `_setShieldOverlay` does uncached DOM work every frame
`updateShieldVisuals` runs every frame (called from `updateAbilities` at 30584, which runs at 47720). It calls `_setShieldOverlay(id, on)` at least 5 times per frame, including unconditional off-branch calls, even when no shield is up. Each call:

```js
30148:    const el = document.getElementById(id);
30150:    if (on) el.classList.add('show'); else el.classList.remove('show');
```

That is ~5 uncached lookups plus ~5 unconditional classList writes per frame, forever.
Fix: cache the elements once (you already do this with `_hudEls`), and only touch classList when the on/off state actually changes (store last state per id).

### P2 (High): `_setShipShieldEmissive` traverses the whole ship per active shield per frame
While a shield is up, this walks the entire ship hierarchy every frame with an allocating arrow callback and per-material array wrapping:

```js
29928:  shipMesh.traverse(child => {
29930:    const mats = Array.isArray(child.material) ? child.material : [child.material];
```

Fix: cache the emissive-capable materials on `userData` once (the way `hullMats` is already cached for `animateShipMesh`) and iterate that flat list.

### P3 (Medium): three sibling wake/light functions allocate fresh arrays every frame
All called unconditionally near the top of `gameLoop`: `updateGasLighting` (`const lights = []`, 7821), `updateBCSWakes` (`const sources = []`, 9941), `updateAmbientCloudWakes` (`const sources = []`, 14884). Each then pushes one object literal per source (player + every bot + up to 12 projectiles), and `updateGasLighting` adds an allocating `forEach(mat => ...)` closure (7833). The source list is essentially identical across all three.
Fix: build the source list once per frame into a reused array, share it across all three, and convert the `forEach` to an indexed loop.

### P4 (Medium): `splice(i,1)` expiry in the four hottest arrays
You already converted projectiles (47864) and the effects-budget cull (24142) to swap-with-last + `pop()` and documented the O(n) to O(1) win. The per-element expiry loops were not converted: `game.particles.splice(i,1)` (23993, largest array), `game.effects.splice(i,1)` (24154), `game.dots.splice(i,1)` (24991), `game.dynamicObjects.splice(i,1)` (22557). In a backward loop, splice shifts every later element, so a frame that expires many low-index items is O(n^2). Swap-with-last is safe here because backward iteration has already visited the swapped-in slot.

### P5 (Medium): `updateAbilities` per-frame Vector3 churn
While abilities are active, the effect-update branches allocate ~15 `new THREE.Vector3` per frame (subVectors, clone().add(new Vector3(...)), velocity vectors), e.g. lines 31086, 31098, 31116, 31143, 31292, 31332, 31415, 31494, 31577, 31697, 31748. Active-ability only, not always-on, so lower priority than P1-P3.
Fix: route through module-scratch vectors where the result is consumed immediately.

### Lower-priority perf notes
- `_gasBucketKey` (22376) builds a string key `ix+'|'+iy+'|'+iz` for the spatial hash, called ~54x per gas pocket per chemistry tick. Use a packed numeric key. (Throttled on VR; full-rate on desktop.)
- `updateHUD` (34239) uses `game.entities.find(b => b.id === parseInt(botId))` per lock per frame; store an id-to-bot map instead.
- Per-entity closures re-declared each frame: `dimHullMat` (15072) in `animateShipMesh`, `_emitPuff` (16512) in `Projectile.update`, `_applyOne` (24201, 24406) in `updateEffects`. Hoist to module scope.
- `drawCircumpunctHUD` uses Canvas2D `shadowBlur` per health segment each frame (33381). Pre-render the glow to an offscreen canvas on state change.

---

## 3. Load time and file size

Raw 2.55 MB, gzip 646 KB. On Quest-class hardware the dominant cost is parsing and compiling 2.4 MB of JS, not the transfer. Composition: no large base64 assets; ~9,056 full-line comments (~600 KB, ~24% of bytes); 2,208 blank lines.

### L1 (High value, medium effort): introduce a minify step for the shipped copy
There is no build step today, and the heavy commenting is genuinely valuable for an iterative single-file project, so do not strip the dev copy. The right move is a build step (terser + html-minifier) that emits a separate shipped artifact while you keep the commented source. Realistic outcome:
- Comment + whitespace strip alone: ~600-680 KB off raw (~25%).
- Full minification: roughly 0.9-1.1 MB raw, ~250-320 KB gzip (vs 646 KB now), and a meaningfully smaller parse/compile on Quest.

### L2 (Medium): remove the dead organic-life system from the shipped copy
`const LSS_ORGANIC_LIFE_ENABLED = false;` (22566) gates the entire flora system (createOrganicMesh, spawnOrganics, updateOrganics, two palette arrays), lines ~22564-23037, about 473 lines. They early-return cheaply at runtime (22789, 22874) but still parse and ship. `updateOrganics(dt)` is still called every frame at 47875. Strip it in the build (or behind a compile flag).

### L3 (Medium): defer heavy synchronous startup past first paint
At module eval, before any frame: `initAudio` (56213) builds an 8192-sample waveshaper curve and three convolver impulse responses via `generateImpulseResponse` (48070/48072/48093), each a loop over `sampleRate * duration` (~115K samples x 2ch for the 2.4s reverb), yet the AudioContext starts suspended until the first user gesture; pools allocate ~820 GPU materials/meshes synchronously (`_initLightningPool` 64, `_initDarkLightningPool` 256, `_initParticlePool` 500); `buildShipSelect` + `buildSettingsPage` build DOM at eval (56228). Move audio IR generation into the gesture/unlock handler and pool/DOM init into a post-first-paint `requestIdleCallback` to improve Quest time-to-interactive. (Note: `warmupCombatShaders` is already correctly skipped on standalone Quest, 17640.)

---

## 4. Code quality and maintainability

The file is well-organized for a single-file project: clear section headers, table-driven configs (SHIP_MODELS, PILOT_PERKS, MAP_PRESETS), idempotent warmup, Quest-aware gating. Two structural smells stand out.

### Q1 (Medium): defensive `typeof` guards for same-module functions
~590 `typeof X === 'function'` plus ~373 `typeof X !== 'undefined'` guards across the file; 22 of them run every frame inside `gameLoop` (47585, 47591, 47594, 47602, 47721, 47744, 47904, etc.). Every guarded target is a top-level function defined in the same module, so it is always hoisted and defined; the guards defend against a load order that cannot vary within one ES module. At 90 Hz the per-frame ones are ~2,000 redundant checks/sec, and across the file they make the code read as if functions might be missing when they never are. Worst clusters: the settings UI (~36000-38000), the music functions (all 35 `music*` guards point at functions defined at 55336-55812). Replace the in-module ones with direct calls.

### Q2 (Low): showcase mode is forced on, with dead parameters
`setShowcaseMode(on, opts)` (12038) hardcodes `on = true;` on its third line (12040), ignoring its argument, and `setTimeout(() => setShowcaseMode(true), 0)` (12071) fires it every load. It triggers cineFX + an HDR environment fetch + PBR promotion at startup. Either honor the parameters or drop them; either way it adds avoidable startup material churn and a network HDR load.

### Q3 (Low): marching-cubes tables duplicated
`mcEdgeTable` + `mcTriTable` are byte-identical at lines 13366 and 44468 (~22 KB total). The copy at 13366 is inside the Web Worker source string and genuinely must be self-contained; the sync fallback copy at 44468 can reference a single module-scope constant. Only one copy is removable.

### Q4 (Low) and other small items
- `_vxPickGlowColor` (21089) is defined and never called. The only fully-dead top-level function out of ~710.
- `CLASS_COLORS` is re-expressed as a `switch` (8659) when `LSS.CLASS_COLORS[key]` already exists (2706).
- 109 `window.X =` global assignments (~126 props); consider consolidating under the existing `LSS` namespace to reduce collision surface.
- Console logging is init-only (71 log / 112 warn / 14 error); the one `console.warn` in the loop region is a once-per-match catch handler. No per-frame perf concern; a build-time strip would remove them cheaply if desired.

---

## Suggested order of work

1. B1, B2, B3: small, surgical netcode fixes that remove the most player-visible multiplayer breakage (cheating/one-shots, timer oscillation, stuck peers).
2. B4: one-line Map iteration fix.
3. P1, P2, P3: cheap per-frame wins that help every device, Quest most of all.
4. P4: propagate the swap-with-last pattern you already use.
5. L1 + L2: add a minify/strip build step and drop the dead organic block for the shipped copy; biggest load-time lever.
6. Q1: clean up in-module `typeof` guards (clarity, minor perf).

All line numbers reference `last_ship_sailing_v26VR.html` as audited. Headline bug findings (B1-B4) and the high-severity perf items (P1, P2) were re-read and confirmed directly; the remainder come with exact line refs for quick confirmation.
