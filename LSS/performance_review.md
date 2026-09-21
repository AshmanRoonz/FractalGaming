# `performance_review.md` — measured performance review of all 8 game modes

> Companion to [`lss.map.md`](lss.map.md). Baseline build **v47.01**, reviewed **2026-09-20/21**.
> Everything below is **measured**, not estimated, unless a line says otherwise. Where a number was
> estimated and then re-derived, the re-derived number is the one printed.

## How this was measured

- **Rig:** Chrome (Claude Browser pane), `ANGLE (NVIDIA GeForce RTX 5050 Laptop GPU, D3D11)`, 144 Hz.
- **Harness:** a per-frame recorder in the page — `renderer.info` with `autoReset = false` and a manual
  `reset()` in a trailing rAF, so draw calls / triangles are **totals across every `render()` call in a
  frame** (shadow pass + reflector + water refraction + main + ads overlay + bloom + composite), not just
  the last one. A 16 ms poller records `game.state`, the `#lss-loading-overlay` class and its sub-line.
- **Profiles:** the **JS Self-Profiling API** at a 5 ms sample interval, served with
  `Document-Policy: js-profiling` (the `webgpu` launch entry, port 8096, serving the repo root — the game
  is then at `/LSS/index.html`). This gives real function-level self/total time with no source edits.
  `window.__prof` (`?pbhud`) gives the per-subsystem CPU split; `?pbseg` gives per-render-pass GPU time
  through `EXT_disjoint_timer_query_webgl2`.
- **Timing convention:** *load* = the **LAUNCH click → the loading curtain losing `.active`**. The warmup
  countdown that follows the lift (~8.7 s in classic) is *not* counted as loading.
- **Cache state:** warm HTTP cache, **fresh page per mode** (so per-page memos like `_monstersInit` do not
  leak between modes). The hub height bake's IndexedDB cache state is called out where it matters.

⚠ **The pane understates the hub by ~3×.** Every table below is at the pane's ~1031×688 unless it says
1080p. See *The resolution multiplier*.

---

## 1. Per-mode results

| mode | map | LAUNCH→lift | prebake `totalMs` | dominant phase | stall after lift | in-play |
|---|---|---|---|---|---|---|
| **assault** | `assault_shifting` | **2.6 s** | 621 ms | carrier 158, ui 222 | none | 122 fps · 411 draws · 1.01 M tris · p99 15.5 ms |
| **classic** | `hourglass` | **3.2 s** | 1086 ms | mon 378, ui 222, carrier 190 | none | 89 fps · 742 draws · 3.39 M tris · p99 24.3 ms |
| **race** | `race_shifting` | **3.5 s** | 1189 ms | mon 356, carrier 223, ui 231 | none | 87 fps · 804 draws · 2.83 M tris · p99 22.5 ms |
| **endless** | `endless_bend` | **5.1 s** | 1450 ms | mon 327, terrain 371, carrier 218 | none | 132 fps · 699 draws · 2.89 M tris · p99 13.2 ms |
| **campaign** (journey) | `hub_overworld` | **6.7 s** curtain | 2815 ms | **ent 1944** | none | 136 fps · 169 draws · 0.61 M tris · p99 9.9 ms |
| **cyberpunk** | `hub_overworld` | **17.5 s** | 12579 ms | **fx 11455** → `CAPPED:gpu-skipped` | **1561 ms** | 68 fps · 687 draws · 12.88 M tris · p99 25.1 ms |
| **freeflight** | `hub_overworld` | **19.5–34.8 s** | 14699–15345 ms | **clip 14318** (height bake) → `CAPPED:terrain` | **1275 ms** | 116 fps · 560 draws · 13.09 M tris · p99 17.8 ms |
| **earth** | `gmaps_earth` | **33.8 s** | 603 ms | *the world build is outside the prebake* | 90 ms | 119 fps · 202 draws · 1.69 M tris · p99 21.4 ms |

Five of the eight are healthy. **The three hub-family / real-world modes are where all the loading cost is.**

### The curtain timeline, classic (the healthy shape)

```
LAUNCH 2882 → [721 ms build frame, curtain already painted] → curtain up 3625
  compiling shaders 3625 → linking 175/176 4053 → building the world 4710
  compiling effects 4737 → priming ships 4780 → waking the leviathans 4789
  priming the hulls 5171 → cloaking the fleet 1..8/8 5239 → priming the GPU 5422
  first frame 5883 → waiting for the GPU 5896 → warming the overlays 5911
curtain down 6054 → [8.7 s warmup countdown] → playing 14788
```

---

## 2. The systemic finding — loading is priced in **game frames**

`_warmupYield()` (lss.js:40281) resolves on the **next rAF**, i.e. one complete game frame. Every phase of
the warmup and the prebake is built as *one unit of work per yielded frame* — 14 hulls, one compile per
frame (lss.js ~40810, "one hull's compile per frame, as `_prebakeCloakWarmRoots` does"); 8 cloak roots ×
2 hops; 32 overlay-rehearsal hops; a `_warmupYield()` between each of the 6 leviathans.

That is correct on a **7 ms** frame and catastrophic on an expensive one. At 1080p in the hub, a frame
*during* the prebake costs **100–2000 ms**, because that same frame is also doing terrain streaming,
clipmap bakes and ripple bakes.

**Consequence: `__prebake()`'s phase attribution is misleading on hub maps.** The 1080p hub reports
`ui: 11472 ms` — but `window.__uiRehearsal` reads `{ frames: 32, groups: 8, ms: 11472, worst: 1991 }`.
That is 32 frames at a 358 ms mean, not 11.5 s of overlay work. The overlay rehearsal is simply the phase
that happened to be holding the stopwatch.

### The resolution multiplier

Same hub, same machine, emulated **1920×1080** (canvas 2400×1350 @ dpr 1.25, `postFX.rtScene` 4068×2288):

| | pane 1031×688 | **1920×1080** |
|---|---|---|
| LAUNCH→lift | 19.5–34.8 s | **67.4 s** |
| shader warmup (`compiling shaders` → `linking N/M`) | ~3 s | **36.8 s** |
| prebake `totalMs` | ~15.0 s | **25.6 s** |
| `ms.ui` (overlay rehearsal) | 222–287 ms | **11472 ms** |
| `capped` | `terrain` | **`cloak-warm`** (cloak warm skipped entirely: `cloakHulls: 0`) |
| `gpuPasses` | 0 | **0** |
| entity prime | 0 of 29 (`capped: 'stage'`) | **12 of 29** (`capped: 'budget'`) |
| worst single pre-lift frame | 1713–13091 ms | **4765 ms** |

`_prebakeOverlayRehearsal` has a layer-budget guard (`_layerMP > 4` → skip). At 1080p × dpr 1.25 the layer
is **3.24 MP**, just under the cap of 4 — so it runs, and costs 11.5 s. The cap was set against a cost
model that no longer holds.

**Rule of thumb this review established: never read a hub loading number off the pane.**

---

## 3. In-play cost

### GPU, per render pass (`?pbseg`, 5 s window, 69 frames, hub)

`seg` = `[segments, totalMs, maxMs]`.

| pass | pane 1031×688 | 1080p |
|---|---|---|
| `scene` (shadow + world + water) | 162 / 316.7 / 4.5 → **4.6 ms/frame** | 162 / 495.3 / 8.0 → **7.2 ms/frame** |
| `mirror` (reflector, throttled) | 24 / 59.4 / 3.2 → 0.86 ms/frame amortised | 24 / 57.4 / 2.8 → 0.83 ms/frame |
| `comp` | 69 / 6.9 / 0.1 | 69 / 20.3 / 0.6 |
| `ripple` | 69 / 9.1 / 0.9 | 69 / 11.7 / 0.4 |
| `ads` / `bloom` / `refcopy` / `pre` | ~0 | ~0 |
| **total GPU/frame** | **≈5.7 ms** | **≈8.5 ms** |

At 1080p the sub-native shed is pinned at its floor (`_ssDyn.scale = -0.6`, active viewport **1344×756**
inside a 4068×2288 target) and the hub still only reaches 112 fps — i.e. **the hub is genuinely GPU-bound
at 1080p** and the shed is doing real work there, unlike the arenas (v44.90).

### CPU (`window.__prof`, hub session)

`renderFrame` 5.2–5.5 ms mean — essentially **resolution-independent**, as expected. Everything else is
small on average but spiky:

| subsystem | mean | **max (pane)** | **max (1080p)** |
|---|---|---|---|
| `renderFrame` | 5.17 ms | 68 ms | 80.9 ms |
| `hub:stream` | 0.21–0.99 ms | 118.6 ms | 159.8 ms |
| `hub:clip` | 0.12–0.23 ms | 99.9 ms | **306.3 ms** |
| `hub:ripple` | 0.11–0.12 ms | 96.1 ms | **246.1 ms** |
| `hub:city` | 0.22–0.33 ms | 15.4 ms | 28.4 ms |
| `hub:weather` | 0.04 ms | 51.2 ms | — |

Those maxima are **in-play hitches after loading is finished**, and they roughly triple with resolution.

---

## 4. Findings, ranked

Method: two adversarially-verified workflows. The first traced all 8 loading paths (67 findings → **12
survived**, an 82% refutation rate). The second designed fixes for the 9 measured hot spots (**33 patches
reviewed**; verifiers re-measured in node against the shipped functions rather than accepting claims).

### ⭐⭐⭐ ORDER 1

**1. `_warmRealCombatFXInner` compiles and draws two dead program variants.** lss.js:49395-49445. The block
runs `toneMapping = NoToneMapping; compile(scene, camera)` and `toneMapping = ACES; compile(scene, camera)`
with **no render target bound**, plus the matching two renders, and only *then* the `postFX.rtScene`-bound
compile+render. In r165 a bound non-XR target forces **both** `toneMapping = NoToneMapping` **and**
`outputColorSpace = linear` into the program cache key — and every live scene draw binds a target
(`renderPostFX` → `rtScene`, including the lowQuality branch; cineFX → the composer RT; XR →
`xr.getRenderTarget()`). The one direct-to-canvas path, `renderFrame`'s potato branch, is unreachable:
`applyQualityPreset` maps `'potato' → 'low'` on its first line and is the only writer of `QUALITY.level`.

- **Cost:** cyberpunk `ms.fx` = **11,455 ms of a 12,579 ms prebake**, of which **8,620 ms** is blocking
  `getProgramParameter`. ~193 programs created, **~128 of them dead**. Programs at the lift: cyberpunk
  **449** vs assault 170.
- **Downstream:** this is *why* cyberpunk blows `_PREBAKE_MAX_MS` and reports `CAPPED:gpu-skipped`, and
  the skipped GPU prime is what the **1,561 ms uncovered frame after the curtain** is.
- **Prior art:** `lss.map.md` v39.81 measured exactly this fork on the near-field water (three programs:
  the gameplay `srgb-linear/none` plus two pin-pass variants) and called it *"waste that lands on the
  load"* — named and left open, never tried-and-reverted. v36.19 shipped the mirror-image fix for the
  postFX quads, where the screen variant is the live one.
- ⚠ Three defects in the naive version, all found in verification: deleting the `_drawPasses` return
  silently deletes `drainFx0` (the caller gates the drain on the returned finisher); the `__fxWarmProgs`
  namer must move **below** the surviving compile or it goes permanently blind; and the `_lzg` cleanup at
  lss.js:49442 has been unreachable on the deferred path since v40.69, leaking the vortex-beam
  stand-ins for the session.

**2. `_stHash2` — a `Math.sin` hash — is ~70% of all terrain height evaluation.** lss.js:16604:
`function _stHash2(x,z){const h=Math.sin(x*127.1+z*311.7)*43758.5453;return h-Math.floor(h);}`. `_stNoise2`
calls it **4× per sample** on the integer lattice; `_stFbm`/`_stRidged` call `_stNoise2` once per octave.

- **Measured:** **5,705 ms of self time** in a single hub load — **43% of all main-thread JS**. Verified
  independently in node against the shipped functions sliced verbatim out of lss.js: **~200 `_stHash2`
  calls per `_stGroundYCarved`** (180 of them from `_stNoise2` with integer args), ~20 ns each, and
  replacing the hash with a free lookup takes the terrain-evaluation loop from **673 ms → 204 ms**.
- **Consumers:** chunk shells (`_swShellJobRows` 4,479 ms — 41×41 = 1,681 samples per shell × 625 chunks),
  drapes (`_swDrapeY` 2,146 ms), and the height bake itself (the 14.3 s `clip` phase runs the identical
  code in up to 8 workers via `_hbWorkerSrc`).
- **Fix:** a direct-mapped 2×2 integer-corner cache consulted only from `_stNoise2`. **Bit-exact** (0
  differing samples). Expected `clip` **14,318 → ~6,000–7,000 ms** on a cold bake.
- **Rejected:** the integer bit-mix hash. It changes world shape across four synced copies (main-thread
  `_st*`, the marching-cubes worker string, `_hbWorkerSrc`, `worldSDF`) for *less* than the cache gives —
  a bit-mix cannot beat a free table read, and the free-lookup run caps the whole win at 3.3×.
- **Also dead:** there is no byte-identical algebraic simplification. Lattice coordinates run −1.4e6 to
  6.4e5, where a double still has ~30 fractional bits, so the hash is **not** precision-degraded and V8
  already does Payne-Hanek reduction inside `Math.sin`.

**3. `copyFramebufferToTexture` uses the pre-r165 argument order.** lss.js:15482 —
`rnd.copyFramebufferToTexture(_wrZero, postFX.rtRefractCopy)`. r165 changed the signature to
`(texture, position = null, level = 0)` and added a `console.warn` compat branch.

- **Measured:** **1,156 warns in 13 s** in the hub (~89/s), **5,588 in 53 s** in endless (~105/s), **0** in
  assault (no water).
- **Honest cost:** ~0.024 ms/frame — this is **not** a framerate fix and should not be sold as one. Its
  real value is that it stops **12k–18k console messages per run** being evicted, which is why `[hbake]`
  and `[prebake]` lines are currently unreadable.
- **Byte-identical GL**, proven from the r165 source: the old path resolves `position = _wrZero` → `x = y =
  0`; the new path resolves `position = null` → `x = y = 0`. Same texture object, same
  `copyTexSubImage2D`.
- ⚠ **Forward hazard:** on r180 the compat branch is gone — the old form throws on `_wrZero.image` and the
  surrounding `catch` silently zeroes `uRefract`. Refraction would die with an empty console. This matters
  for the WebGPU/r180 port.

### ⭐⭐ ORDER 2

- **Occlusion-cull the clipmap rings** — 1,228,512 triangles, 798,675 vertices, 3 draw calls and ≈11.1 M
  vertex texture fetches **per pass**, exact.
- **Stop submitting tree instances for chunks behind the shader's own fade** — the `tfade` fold in
  `_swFoliageMat` collapses them to zero size on the GPU after they have already been transformed. ~34% of
  the tree disc by area.
- **Split the DEM 7-tap box blur into two separable passes** — measured **44 ms → 11 ms** per 768×768 ring
  (4.3×, median of 7 reps).
- **Skip `_stCeilY` where it is provably dead** (`WALL_PINCH`/`ENDLESS` branches) — **12.8% measured** off
  the hub terrain loop (128.0 → 111.5 ms), not the 17–22% first claimed.

### Earth's DEM — attributed in v47.03, and the assumption was wrong

`_fetchDemRing` measured **17,858 ms of main-thread self time — 53% of a 33.8 s cold load.** But the JS
self-profiler attributes a *function*, not a statement, so that number could not be split, and my first
read of it assumed the per-texel decode loop (`px[src]*256 + px[src+1] + px[src+2]/256 - 32768`, 65,536
texels per tile) was the bulk. **It is not.**

v47.03 adds permanent stage timers to `_fetchDemRing` (`stats.demMs`) and a `window.__demReport()` probe
that sums them across every `LSSEarthTiles` the page built — a launch makes a near patch *and* a far patch,
so one instance never tells the whole story. Toronto, 10 instances, 108 tiles, warm HTTP cache:

| stage | ms | share of CPU | what it is |
|---|---|---|---|
| **blur** | **1,734** | **45%** | two box passes, R=3, over the wet mask |
| `wet` rest | 1,024 | 27% | mask + flood fill + basin carve |
| **hist** | **683** | **18%** | the float-keyed `Map` histogram + level pick |
| decode | 269 | 7% | `drawImage` + `getImageData` + the per-texel loop |
| close | 149 | 4% | the R=8 morphological closing |
| fill | 0 | — | the missing-tile repair (no tiles missing) |
| **CPU total** | **3,859** | | |
| net | 2,587 | | the tile fetches |

So the decode is **7%**, not the bulk, and a worker port of it would have bought almost nothing. The two
stages worth attacking were the ones the mode-path audit had already flagged as ORDER-2 — and it turns out
they are worth more than the ~0.5–1.5 s that estimate gave them, because that estimate was made against
the wrong baseline.

The **17.9 s** figure itself came from a *cold-network* run with `_leLoadImagesRetry`'s 3 retries and
backoff sleeps, on a larger region. A warm-cache Toronto launch is 6.4 s of `_fetchDemRing` total.
`[lss-earth-world] region 0:0: core 1.5 cells, 23895 ms, 38115 elements` is a separate cost (the Overpass
region build), not counted here.

### Lead chased and CUT DOWN — the discarded hub ground shells

**The mechanism is real; the size is not.** `initSandwichTerrain` builds a 5×5 block of chunks with
`ground:` populated unconditionally, then sets `_clipmap.on = false` and kicks the height bake.
`updateSandwichStream` computes `_wantGround = !_clipmap.on`, so the streamer keeps making ground shells.
gameLoop's clipmap arm waits on `_hbPending()`; the moment the bake finishes it calls `_clipEnableNow`,
which sets `_clipmap.on = true` and `_clipDropChunkGrounds()` — **removing and disposing every chunk's
ground mesh**. So every ground built before the clipmap enables is thrown away.

I expected that to be ~441 shells (the full resident ring) and ~4.5 s. **It is not.** Measured by watching
`renderer.info.memory.geometries` per frame across a hub launch and finding the largest single-frame drop:

| | largest geometry drop | chunks resident at the end |
|---|---|---|
| warm height-bake cache | **−16** (at t = 4.77 s) | 441 |
| cold height-bake cache | **−44** (at t = 12.68 s) | 441 |

The clipmap enables early enough that the other ~400 chunks are streamed with `_wantGround` already false
and never get a ground at all. So the waste is **25 shells warm / 44 cold** — ~42k–74k terrain samples,
i.e. **~40–170 ms** and a couple of MB of transient geometry, which is exactly what the mode-path audit's
confirmed finding estimated.

**Not worth doing ahead of the earth work,** because the fix carries a real regression: both fallback sites
(`_clipEnableSliced`'s catch and gameLoop's `_clipEnableNow` catch) set `game._clipWantHub = false` and
fall back to the streamer — and `updateSandwichStream` only builds a ground for a *new* chunk, so chunks
that were created ground-less would stay ground-less, leaving a permanent ~4500×4500 u hole at spawn. Any
fix must also mark those chunks `_stale` so the existing rebake path refills them. Worth doing eventually,
in the same pass as the trap fix — not as a headline win.

---

## 5. What is **not** a problem (negative results)

These cost real measurement time and are worth not re-investigating.

- **Round transitions are clean.** 117 s of classic through rounds 2 and 3
  (`roundEnd 44993 → warmup 49990 → playing 59988`, `roundEnd 102233 → warmup 107233 → playing 117234`):
  **exactly one frame ≥ 60 ms in the entire run** (69 ms, during round 2's warmup). The map's open
  *"the level is rebuilt every round"* item **no longer produces hitches** on `hourglass` on this hardware.
  v38.97 / v38.99 / v46.95 held.
- **The 13 s synchronous build frame is covered, not exposed.** `_commitDeferOneFrame`'s `go` (lss.js:54535)
  ran for **12,683 ms** in one Long Animation Frame on a cold hub — but the recorder shows the overlay went
  `.active` at 2851.9 ms and **two frames painted with it up** before the block. The curtain is frozen, not
  absent. The v36.40 map entry investigated whether the overlay was up; it was not looking at how long the
  frame was.
- **Monster prime** (320–380 ms in classic/race) — **every** proposed fix came back UNSOUND. It is once per
  page (`_monstersInit` is never cleared), the GLBs are already disk-cached from `preloadAllAssets`, and
  deferring it into the cinematic trades 350 ms of curtain for six visibly popped leviathans. Endless is
  justified too: `_lssEndlessDropBolt` (lss.js:77819) is called from `OutskirtsMonster.die`.
- **The `carrier` phase is not the carrier** on non-freeflight modes. It is the "priming the hulls" branch
  (a hull per `shipModelCache.loaded` key + `_compileSliced` + `initTexture` + cloak warm), and it is
  load-bearing — `lss.map.md` v39.49 records the hull-per-loadout proxy group as the fix for a cold
  shadow-depth link that once produced a **2,785.8 ms `renderFrame`**.
- **82% of the first pass's findings were wrong.** 67 candidate findings, 12 survived. Most died on "the
  guard you did not read closes this path", "the map records this as tried and reverted", or "your cost
  figure is a misread of the probe".

---

## 6. Multiplayer (two peers, room `PERFRV`, classic)

Both peers connected, both launched, the match ran.

| | host | peer |
|---|---|---|
| prebake `totalMs` | **1,294 ms** | **8,253 ms** |
| `ms.gpu` | 215 | 2,160 |
| `ms.carrier` | 183 | 1,292 |
| `ms.mon` | 510 | 1,258 |
| `ms.ent` | 44 | 1,027 |

The **6.4×** is two WebGL contexts sharing one GPU — a two-tab artifact, but it models a slow peer
faithfully. The host sat on the curtain showing **`1/2 ready`** for the whole time, which is correct and
good UX.

**Structural gap:** `updateRoundSystem`'s launch gate (lss.js ~5999) is
`if (!_localWarmupReady || !_allPeersWarmupReady()) { …show "N/M ready"… return; }` — **no timeout**. And
the solo watchdog is explicitly disabled in a room: `_launchStallTimer` is created inside
`if (!net.active)` (lss.js ~54903). So **a room has no launch watchdog at all**. In practice the wait is
bounded by each peer's own `_PREBAKE_MAX_MS`, but nothing enforces that — a peer that stalls *outside* the
prebake holds the room indefinitely.

Also worth noting: `_warmupYield` keys its cheap `setTimeout(r, 16)` fallback off `document.hidden`. A tab
can be **non-hidden and still rAF-throttled** (occluded, background pane) — measured at 38 Hz backgrounded
vs 65 Hz fronted in the pane. Every prebake yield then costs more, on a per-frame-priced pipeline.

---

## 7. Reproducing this

Serve the repo root with the profiling header — the `.claude/launch.json` entry **`webgpu`** (port 8096)
sends `Document-Policy: js-profiling`, and the game is then at `/LSS/index.html`. The plain `lss` entry
(port 8099) serves `LSS/` as `/` but has no profiling header.

In the page, with `?pbhud` (and `?pbseg` for GPU segments):

```js
window.__prebake()          // the launch prebake report, per phase
window.__uiRehearsal        // {frames, groups, ms, worst} — read frames BEFORE believing ms
window.__f8log.mark('x')    // full snapshot: .seg (GPU per pass), .gt, .cold, .made, .px, .ss
window.__prof               // per-subsystem CPU totals/calls/max
window.lssPerfSnapshot()    // counts + renderer.info
window.__compileSliced      // {ms, slices, children} of the last sliced compile
window.__swapReport()       // the world-swap traverse (campaign legs, hub rifts)
```

For the JS self-profile: `new Profiler({sampleInterval: 5, maxBufferSize: 400000})`, then aggregate
`trace.samples` by leaf frame for self time and by stack walk for total time. Set
`renderer.info.autoReset = false` and `reset()` in a trailing rAF before trusting any draw-call or
triangle count.

Mode entry points, all reachable from the DOM: `#btn-join` (classic), `#btn-freeflight`, `#btn-cyberpunk`,
`#btn-earth`, `#btn-endless`, `#btn-race`, `#btn-assault`, `#btn-campaign`; then `.ship-chip` →
`#ship-preview-confirm` → `#ship-preview-launch`.

---

## 8. Change log against this baseline

| build | change | effect |
|---|---|---|
| v47.01 | *(baseline — the tables above)* | — |
| v47.02 | the three ORDER-1 fixes, applied and measured one at a time | hub **19.5–34.8 s → 4.8 s warm / 11.6 s cold**; cyberpunk **17.5 s → 6.6 s**; −120 programs |
| v47.03 | `_fetchDemRing` stage timers + `window.__demReport()` | measurement only — and it overturned the earth assumption (see above) |
| v47.04 | branch-free blur interior + integer-window DEM histogram | blur **1,734 → 826 ms**, hist **683 → 301 ms**, DEM CPU **3,859 → 3,088 ms** |

### v47.02 — measured before/after

All three were applied separately, each with its own before/after run on the same build and the same
machine. **Caveat on shader timings:** Chrome's ANGLE program cache is a *disk* cache, so a mode measured
twice on one origin links almost for free the second time. Program **count** is the cache-independent
signal and is what the fx numbers below lean on.

**1. `copyFramebufferToTexture` argument order** (lss.js:15482) — value-preserving, byte-identical GL.

| | before | after |
|---|---|---|
| `console.warn`/53 s, endless | **5,588** | **0** |
| `__waterRefractInfo` | `frames` incrementing, `inline: true` | unchanged — 6,384 frames, `inline: true`, `k: 0.045` |
| `__waterCopyAllocs` | handful | 6 |

Water still refracts (checked on screen). No fps claim is made: the measured ~0.024 ms/frame is inside
noise, and this rig has CDP attached, which inflates `console.warn` cost above what the owner sees.

**2. `_warmRealCombatFXInner` — one program variant instead of three** (lss.js:49395-49412).

| cyberpunk | before | after |
|---|---|---|
| **programs at the curtain lift** | **451** | **331** (−120, vs ~128 predicted) |
| LAUNCH→lift | 11,791 ms | **6,607 ms** |
| prebake `totalMs` | 7,736 ms | **2,409 ms** |
| `ms.fx` | 302 ms | 136 ms |
| `ms.carrier` | 3,842 ms | **195 ms** |
| `ms.cloak` / `ms.drainCloak` | 2,518 / 2,348 ms | **112 / 1 ms** |
| `ms.ent` | 1,563 ms | **283 ms** |
| pre-lift stalls ≥50 ms | 6,928 ms total | 4,133 ms total |
| in-play | 129.5 fps · 587 draws | 129.5 fps · 564 draws |

The knock-on is bigger than the phase itself: `carrier`, `cloak` and `drainCloak` were paying to link and
drain the dead canvas variants of every hull. Classic: programs **186 → 176**, `ms.fx` **69 → 18**, prebake
**1,086 → 892**, `__coldProgs()` **0**. `__fxWarmProgs` is non-empty on cyberpunk (25) — which is the proof
the namer was correctly moved *below* the surviving compile — and legitimately empty on classic, where the
shader warmup has already compiled everything and the rtScene pass creates no new programs.

Three defects the adversarial review caught and the applied patch fixes: the drain is now
**unconditional** (it used to be gated on the returned finisher, which this patch removes — that would
have silently deleted the whole `drainFx0` stage); the `__fxWarmProgs` namer moved below the compile; and
the `_lzg` cleanup — unreachable on the deferred path since v40.69, so the vortex-beam stand-ins leaked
into the scene for the session — is reachable again and now retains through `_lssRetainMat` rather than
disposing, so the `core_beam` program stays resident.

**3. `_stHash2i` — a direct-mapped 2×2 integer-corner cache for `_stNoise2`** (lss.js:16199/16628, plus
`_hbFamily`). Value-preserving.

| hub, **cold** height bake | before | after |
|---|---|---|
| `[hbake]` — same **17,831,061 evals** on 8 workers | **16,064 ms** | **9,119 ms** (−43%) |
| `ms.clip` | 12,980 ms | **6,096 ms** (−53%) |
| prebake `totalMs` | 13,279 ms | **7,310 ms** |
| **LAUNCH→lift** | **17,824 ms** | **11,566 ms** |
| `capped` | **`terrain`** | **`null`** |
| `gpuPasses` | **0** (skipped) | **14** |
| `ms.ent` / `ms.carrier` / `ms.cloak` | 0 / 0 / — (all skipped) | 413 / 211 / 114 |
| `hub:stream` cumulative, in play | 13,299 ms / 6,675 frames | **5,143 ms / 6,538 frames** (−61%) |

**The budget stops blowing.** Halving `clip` gives the prebake room to actually run the entity prime, the
hull/cloak warm *and* the 14-pass GPU prime — all three of which the hub had been silently skipping. Warm
cache: `[hbake] cache hit … 984 ms`, `ms.clip` **2 ms**, prebake **1,133 ms**, **LAUNCH→lift 4,813 ms**.

**Bit-exactness, proven three ways:** (a) the height bake's own 48-point worker-vs-main-thread self-check
at 1e-6 relative tolerance passed — `[hbake] baked on 8 workers`, no *"worker disagrees"* line; (b) in
node against the shipped `lss.js`, **2,956,866 raw-hash samples and 3,000,000 end-to-end `_stNoise2`
samples, 0 differing**, with the accumulated float sums `Object.is`-equal; (c) 1.8× on the terrain call
pattern in the same harness. The IndexedDB key moves (`acb0eeb86c03fab3` → `15acbb353a9296a4`) because
`_hbFamily` grew, so the first hub launch after this re-bakes once.

**Boot-tested desktop *and* the mobile preset** after every step (the `lss-tdz-const-trap` rule). The cache
state hangs off the function object, not a module `const`, so there is no temporal dead zone and
`f.toString()` still carries everything the worker string copies need.

### v47.02 regression sweep — all three applied

| mode | LAUNCH→lift v47.01 → v47.02 | prebake | programs at lift | `capped` | `gpuPasses` | cold links in play | post-lift stalls |
|---|---|---|---|---|---|---|---|
| assault | 2.57 → **2.17 s** | 621 → **589** | 170 → **166** | null | 13 | **0** | 0 |
| classic | 3.17 → **2.81 s** | 1086 → **892** | 186 → **176** | null | 13 | **0** | 0 |
| race | 3.47 → **3.88 s** * | 1189 → **951** | 182 → **176** | null | 13 | **0** | 0 |
| endless | 5.14 → **4.46 s** | 1450 → 2418 * | — | null | 13 | **0** | 0 |
| cyberpunk | 17.5 → **6.61 s** | 12579 → **2409** | 449 → **331** | gpu-skipped → **null** | 0 → **14** | 0 | 1 × 87 ms |
| freeflight (warm) | 19.5–34.8 → **4.81 s** | ~15000 → **1133** | 279 → ~262 | terrain → **null** | 0 → **14** | 1 | 1 × 51 ms |
| freeflight (cold bake) | — → **11.57 s** | → **7310** | 262 | **null** | **14** | 1 | 1 × 51 ms |

\* race and endless move within run-to-run streamer variance (`ms.terrain` swings with how many chunks the
commit frame had already covered: endless built 128→361 chunks on the slow run vs 298→361 on the fast one).
Their prebake totals and program counts both fell.

Not re-measured after the change: **earth** (its cost is `_fetchDemRing`, untouched by all three) and
**campaign** (journey uses the hub path, which improved).

### v47.03 / v47.04 — earth DEM

**v47.03** is measurement only: stage timers in `_fetchDemRing` accumulating into `stats.demMs`, and
`window.__demReport()` to sum them across instances. A handful of `performance.now()` calls per *ring*.
It paid for itself immediately by killing the "port the decode to a worker" plan (the decode is 7%).

**v47.04** applies the two patches the split actually pointed at:

| stage, Toronto, 10 instances, 108 tiles | v47.03 | v47.04 |
|---|---|---|
| **blur** | 1,734 ms | **826 ms** (2.1×) |
| **hist** | 683 ms | **301 ms** (2.3×) |
| decode / close / fill | 269 / 149 / 0 | 277 / 348 / 0 * |
| **DEM CPU total** | **3,859 ms** | **3,088 ms** |

\* `close` and the `wet` remainder swing run to run with how much water a patch happens to contain.

- **Blur:** the two passes were *already* separable (H into `tmp`, V into `amt`) — the cost was the two
  bounds compares and the `n2` increment on **every tap**, 7 taps × w × h × 2 axes × 2 passes. The interior
  now runs branch-free with the **same summation order** and the **same `sum / n2` division** (`n2` is
  exactly `2R+1` there), so every interior texel is **bit-identical**; the border rows and columns keep the
  original clamped-tap loop, because there `n2` varies. A running-sum box blur would be O(1) per texel
  instead of O(7), but it reorders the additions and would move the lake-bed ramp in the last bits — not
  worth it at this size.
- **Histogram:** every voting height is exactly `R*256 + G + B/256 - 32768`, a multiple of 1/256 in
  `[-32768, 32768)`, and only `valid` texels vote (the flood-fill repairs write non-multiples but leave
  `valid[i]` at 0). So `k = round((h + 32768) * 256)` is the exact integer `R*65536 + G*256 + B`, always
  < 2²⁴ and therefore a Smi. One min/max pass, then an `Int32Array` window, with a fallback to the old
  `Map` pass if a ring ever spans more than 16,384 m of relief. The round trip is exact both ways (`/256`
  is a power-of-two divide, and float32 holds all of these values exactly), so the keys are numerically
  identical and the later `levels.has(heights[i])` still matches. The one behaviour change: the dominance
  scan now walks values in ascending order rather than first-seen, which only matters on an exact tie over
  ~590k texels.

**Correctness verified:** Toronto detected `waterLevelM = detectedLevelM = 74.81` on **all 7 patches that
voted**, with `seaPct` 8.5–96.6% by patch and `wetFlooded`/`wetClosed` populated — i.e. Lake Ontario is
found, consistently, exactly as before. Screenshot confirms skyline, lake and night rig intact.

**⚠ Honest caveat: this buys CPU headroom, not curtain time, on a warm-network launch.** Every one of these
loops is sliced behind `_leSlicer`, so it only costs wall-clock when it is the critical path. `loadMs` was
9,256 ms before and 9,272 ms after — unchanged. It matters on a slower machine, on a cold network where
the retries stack, and for main-thread contention with everything else the launch is doing.
