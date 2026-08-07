# Porting "The Spire" volumetric arena into LSS

**Reference implementation: [`labs/fractal_arena.html`](../labs/fractal_arena.html)** — a working,
standalone prototype of the arena. Open it first; everything below assumes you have flown it.
Companion lab: [`labs/fractal_deep.html`](../labs/fractal_deep.html) (endless cavern version,
where most of the technique was worked out).

Written at the end of a long session, for a fresh one. Line numbers are approximate — **jump by
symbol name**, they shift constantly.

---

## 1. The headline: this is far smaller than it looks

The port initially looked like a new subsystem (mesher + collision + LOD + bot navigation).
It is not. **LSS already has all of that machinery**, and the arena is a new *signed-distance
field* fed into pipelines that already exist. Verified this session:

| Piece | Status in LSS | Where |
| --- | --- | --- |
| Marching-cubes mesher | **Already exists**, worker-based, low-res preview then high-res | `initializeMarchingCubesWorker` ~L20903 |
| Mesh construction | **Already exists**, builds visual mesh + depth-only occluder | `createMeshFromPositions` |
| Collision | **One function**, already branches per world type | `worldSDF(px,py,pz)` ~L29853 |
| Bot navigation | **No navmesh.** Bots steer on SDF clearance (`worldSDF(x,y,z) < -60`) | bot update ~L33025 |
| Terrain material | Derives everything from `vWPos`/`vWY`, which it computes itself | `_swPatchTerrainMat` |
| Map registry | Keyed table with name/thumb/description/theme/palette | `MAP_DATA` ~L72675 |

**Consequence:** adding one branch to `worldSDF` gives collision, bot clearance, raycasts and
dashes simultaneously, because everything routes through that one function. Bots are expected to
work at the steering level with zero bot-code changes.

---

## 2. What actually has to be written

### Slice 1 — field + collision + map entry (no geometry)
Independently testable: fly it, hit walls, watch bots avoid them, nothing renders.

1. **Port the arena field.** ~60 lines of pure math, no state, no closures. Source of truth is
   `FIELD_SRC` in `labs/fractal_arena.html`.
   - ⚠ It must exist in **two realms** (main thread for collision, worker for meshing). The lab
     solves this by defining it **once as a string** and `Function()`-constructing it on the main
     thread while injecting the same text into the worker blob. **Do the same.** LSS's terrain
     math is currently TRIPLICATED (worker copy / main copy / collision) with a hand-maintained
     "MUST stay identical" comment — that is a known bug source. Do not add a fourth copy.
2. **`worldSDF` branch.** It already reads:
   ```js
   if (gmaps active) return -10000;
   if (game.sandwichTerrain && ON) return _stGapSDFCarved(...);
   ... else room SDF from game.levelSpheres / game.levelCylinders
   ```
   Add an arena branch **before** the sandwich check. Return the arena field, clamped the same way
   the sandwich branch clamps (`>0 ? min(f,90) : max(f,-300)`) — those clamps exist because a raw
   SDF lets rays skip pillars and ejects ships vertically out of thin geometry. Do not skip them.
3. **`MAP_DATA.spire` entry** with an `arena: {...}` params block. Going through `MAP_DATA` means
   map selection, thumbnails, palettes and mode filtering all work through existing paths.
4. **Set the mode** wherever `game.sandwichTerrain` is set/cleared during world build (~L74287).

### Slice 2 — geometry
5. **Dispatch to the existing worker.** The current call is
   `game.levelWorker.postMessage({bounds, gridRes, spheres, cylinders, smoothK, terrain})`
   (~L74356). Add an `arena` payload; in the worker, when present, evaluate the arena field
   instead of the sphere/cylinder SDF. Everything downstream (`createMeshFromPositions`,
   the occluder, materials) is unchanged.
   - ⚠ Note the sandwich-terrain path **skips marching cubes entirely** (~L74352). The arena must
     NOT take that branch.
   - ⚠ **STALE (found v36.56 while shipping slice 1): `createMeshFromPositions` is now a NO-OP
     stub** — the cosmic wall shader was removed and the legacy worker callback discards its
     output. "Everything downstream is unchanged" is wrong: slice 2 needs its own mesh-build
     path (the lab's chunked mesher pattern, or a `_swBuildShell`-style build + `_swPatchTerrainMat`).
     Slice 1 left an explicit `if (game.arenaField)` branch at the dispatch site to replace.
6. **Material.** Apply `_swPatchTerrainMat` to the arena mesh for the existing textures/themes.
   It computes `vWPos`/`vWY` itself, so it should work on arbitrary geometry — verify, don't assume.

### Slice 3 — per-floor themes
**(v36.59) SHIPPED at palette level:** per-storey vertex-color palettes (basalt/bronze/crystal/
snow) with blended 80u midline crossings, lava-lake + crack-vein emissive on the bottom band
(visual-only — the hazard question stays open), scaled spikes + floor-to-ceiling pillars.
The FULL `_swPatchTerrainMat` texture treatment below remains the upgrade path.
7. Each floor gets one of the existing texture themes, **lava on the bottom** (owner's call).
   The lab already drives palette by height in `shade()`; swap the warm→cool lerp for discrete
   per-floor themes with **blended transition bands (~80u)** near each slab — hard theme
   boundaries mid-wall read as a texturing bug, not geology.
   - LSS's terrain shader already has `uLava` (emissive pooling + drip logic), `uCrystal`, `uGold`,
     `uSnow`, `uRocky`, `uMossy`. Use those rather than inventing new ones.
   - **Decide first:** lava as *surface treatment* (shader only, ~1h) or as a *hazard* (gameplay
     volume, damage system, collision — much bigger). Recommend visual-only first.

### Slice 4 — routing (makes bots USE the space)
**(v36.61) SHIPPED.** `_arenaNav*` + the `_arenaVia` hook in `Bot.update`; offline gate
`tools/arena_nav_check.cjs`; live A/B flag `window.__arenaNav`; debug `window.__spireNav()`.
Measured 0/5 → 3/5 full three-storey descents, zero rock frames. Full entry with all the
traps in `lss.map.md` PART 7 → The Spire → v36.61. Point 9 below is CLOSED: verified
`_campHoardTerrainNav` is a double no-op on the spire (it early-returns on null
`sandwichTerrain`, and its call gate matches no classic arena match) — so it cannot climb
wrongly here. ⚠ That stops being true the moment slice 5 blends the arena into endless.
**The one thing slice 4 could not fix:** the DREADNOUGHT's `c*` of 139 u against a 146 u
ring makes it marginal on this map independent of routing — a map/scale decision, not a
nav bug.
8. SDF clearance tells a bot "not that way", never "go through *that* shaft to reach the floor
   above". Steering alone presses against a slab forever. Add a small graph: floors are nodes,
   shafts and the helical ramp are edges. Handful of nodes, not a navmesh.
9. ⚠ **Verify `_campHoardTerrainNav`'s assumption.** It does *vertical* steering tuned for
   "clear the mountain peak". In an arena with ceilings and slabs *above* you, climbing is
   sometimes exactly wrong. Test by dropping bots in and watching.

### Slice 5 — the ambitious one: styles opening into each other
Owner wants the arena and the existing heightfield terrain to connect (endless / campaign).
This is **the one genuinely new thing**: `worldSDF` currently picks *one* world type. Blending
means a region-weighted mix of arena field and sandwich terrain rather than a branch.
Do this **only after a single arena is proven**.

**(v36.60) THE OWNER'S CONNECTION DESIGN — capture, verbatim intent, three pieces:**
1. **Endless ↔ spire:** *"the two styles could somehow connect to each other to form a
   continuous endless path... perhaps the two plane world could connect/entering in from the
   bottom or top of the spiral, and then exiting on the other side to reconnect."* The endless
   two-plane cavern route flows INTO the arena at one end of the helix, the pilot climbs (or
   descends) the spiral through the storeys, and the route resumes out the other end. Mechanism
   sketch: the arena becomes a HALL-class node in the endless route generator — the route's
   carve cylinders smin into the arena volume at two portal mouths anchored to the helix's y0
   and top winding (the helix bore already pokes past the caps — those existing tunnel stubs
   ARE natural portal anchors). worldSDF blends by region weight near the portals (the slice-5
   mix), pure arena inside, pure sandwich outside. The endless route's shared-rng discipline
   (v35.85: route stream vs cosmetic stream) must treat the arena as ONE deterministic segment.
2. **Overworld ↔ spire:** *"these new spiral/spire map could be a way to connect the overworld
   to the caverns... holes that go down."* Holes punched in the hub heightfield open into the
   arena's top cap (the shafts/annular gap are ready-made vertical throats); the bottom exits
   into the cavern layer. Two implementation rungs: (a) NEAR-TERM — dress the existing
   zone-rift staged-swap traverse (`_hzEnterCavern` machinery) as a hole: fly into the pit,
   staged swap into the spire map, exit at a matching hole; (b) FULL — true SDF blending where
   the hub's carved ground opens into the arena volume (the v34.65 pillar/carve unioning shows
   the pattern). Rung (a) ships the FEELING with today's tech.
3. **(v36.64) SHIPPED as slice 5a — CLOUD COLUMNS, not waterfalls.** A full waterfall pass was
   built (v36.63) and then REJECTED by the owner: *"i actually don't like the water... instead,
   maybe a column of clouds just waiting to be disturbed."* The shafts are now packed with
   `GasCloud` columns that hang still, billow when a ship flies through, and settle back —
   tinted per storey from the same theme palette the rock uses. `_arenaBuildCloudColumns` /
   `_arenaCloudTick`; full entry + traps in `lss.map.md` PART 7 v36.64. Original ask:
   *"we could even add a little water fall in some of them, flowing from top to bottom."*

---

## 3. Budget constraints (these will bite)

- **Triangle count.** Lab builds **1.36M tris** at `CELLS = 30`. Too heavy to ship. A playable
  arena probably wants **200–400k**. `CELLS 30 → 18` cuts triangles to roughly a third and build
  time by ~4× (cost scales with the cube). Needs a look-test — spikes may go mushy.
- **⚠ (v36.57) The shipped arena is `scale: 2`** (LSS hulls collide at radius 50-64 vs the lab
  camera's 24; at lab scale resolveCollision's containment band swallowed the flight pockets and
  ships spawned pinned — see lss.map.md PART 7, the containment-band trap). At the same cell size
  that is **8× the meshing volume** of the lab numbers above — which makes the bake-to-GLB route
  effectively mandatory, not just recommended. Budget accordingly in slice 2.
- **(v36.58) OWNER DECISION: NO GLB — slice 2 shipped as RUNTIME PROCEDURAL** ("i'd rather not
  use GLB's for this, i prefer procedural seeds"). The build cost is handled instead by: 25u cells
  (CELLS 24 per 600u chunk, ~926k tris), 8 workers, a helix-bounded vertical cull, and a
  warmup→playing gate that holds round 1 until the mesh completes (~16 s desktop first build,
  cached across rounds). Full entry: lss.map.md PART 7 → The Spire → v36.58. If build time ever
  needs to shrink further, optimize the FIELD (it is the shared string, so collision speeds up
  too) — not a second geometry pipeline.
- **Build time.** Lab takes **~27 s**. This **violates the loading contract** (everything must be
  done before the cinematic starts — see `lss.map.md` PART on the loading contract). Two routes:
  - reduce density → ~5 s → may fit inside the existing loading block, or
  - **bake to GLB offline** (the arena is deterministic and static) and ship it as an asset. The
    preload pipeline and GLB compression already exist. Keep the field for collision only.
    **Recommended** — it removes marching cubes from the runtime entirely.

---

## 4. The geometry, and why it is shaped that way

All in `FIELD_SRC` of `labs/fractal_arena.html`. Reading `eval()` top-to-bottom is reading the
level design.

1. **Volume** — capped cylinder (`R 1150`, `H 780`), perimeter broken up with noise.
2. **Central column(s)** — one ragged spire on the axis + 3 satellites, smooth-unioned.
3. **Floors** — rock slabs at each level, punched with **shafts**; shaft angles rotate per floor
   so none line up vertically (a straight top-to-bottom drop would trivialise the arena). Plus an
   annular gap around the spire as the main vertical route.
4. **Helical ramp** — see below.
5. **Spikes** — stalactites/stalagmites via domain repetition with per-tile hash jitter.

### The helix insight (important — this is the reusable idea)

A heightfield is `y = f(x,z)`: one value per column, hence no overhangs. Rotating the domain to
`r = f(θ, y)` has the *same* limit — **unless you spiral.**

θ is only single-valued if you wrap it. **On a helix the same point in space sits at many
unwrapped angles, one per turn**, so evaluating the same 2D function across several windings
yields several surfaces stacked at the same (θ, r). The spiral restores the missing dimension.

**Verified in the lab:** at one fixed (x,z) on the ramp radius, scanning Y gave **4 separate open
bands spaced 428u** (exactly the pitch) with **253 solid samples between them** — floor above,
floor below, rock between. A single-valued heightfield cannot produce that.

Why it matters for LSS: a helical surface is *still a heightfield at any given winding*, so it
keeps clipmap-style LOD, analytic collision, and cheap evaluation — the properties full
volumetric geometry throws away. **If the arena ever needs LOD, this is the route.**

---

## 5. Traps (all hit for real this session — do not re-learn these)

- ⚠ **Backticks inside a template literal.** `FIELD_SRC` is a template literal; a backtick in a
  comment inside it silently terminates the string. Already in `lss.map.md` as a known trap.
- ⚠ **Per-chunk primitive culling makes the field chunk-dependent → seams.** Two chunks that
  disagree about which primitives are in scope compute different surfaces at a shared boundary and
  the mesh tears. Cost 500 interior holes in the cavern lab. With smooth-min, a primitive's
  *influence* is not bounded by its geometric distance, so no distance-based radius is provably
  safe. Fix is a **world-keyed** spatial index (exact because `smin(a,b,k)` returns exactly `a`
  once `b−a ≥ k`), or no culling at all. Same class as the clipmap footprint bug.
- ⚠ **A spike must grow from something.** Anchoring spikes to a floor *plane* puts them in mid-air
  wherever that floor has been punched away by a shaft or the annular gap. Fix: test the root at
  the **tile anchor** (so a whole cone is kept or dropped, not sliced), and share ONE `floorHole()`
  between the slab carve and the spike test so they cannot disagree.
- ⚠ **Normals: the gradient points INTO the rock.** Negate it, or every wall is lit from behind
  and the cave reads pitch black.
- ⚠ **three r165 physical light units.** `useLegacyLights` is gone; intensity is candela with
  `1/d^decay` falloff. An "ordinary" intensity of ~3 delivers ~0.003 at a 130u wall. Already
  documented for the ship headlight (candela-scale 2200, decay 1).
- ⚠ **Browser form-state restoration** overrides slider defaults on reload. Use
  `autocomplete="off"`; writing defaults in JS loses the race.
- ⚠ **Manifold probe false positives.** A sparse/elongated region leaves unbuilt chunks *inside*
  the bounding box; a bbox-rim heuristic counts edges facing them as holes (reported 964 false
  ones). Test per-edge: is the chunk on the other side actually built?
- ⚠ **Measure with the Browser pane VISIBLE.** Hidden, rAF throttles and fps/frame-time numbers
  are meaningless.

---

## 6. Verification hooks

The lab exposes `window.__spire`:
- `at(x,y,z)` — sample the field
- `stats()` — fps / tris / chunks / buildMs
- `G` — live arena params
- `FIELD.helix(x,y,z,H)` — the helix alone, for the multivalued-band probe

**Floating-spike probe** (should be 0 rock): sample the annular ring void and each shaft bore at
±70..190u from every floor.
**Multivalued probe:** fix (x,z) on the ramp radius, scan Y, count separate open bands — >1 proves
overhangs.

`labs/fractal_deep.html` additionally has `manifoldProbe()` (watertightness across chunk
boundaries) which is worth porting if the arena mesher is ever changed.

---

## 7. Target use-cases (owner)

- **Elimination map** — map entry, straightforward
- **Rift arena** — map entry
- **Part of endless** — needs slice 5 (styles opening into each other)
- **Part of campaign** — needs slice 5

---

## 8. Suggested order

1. Slice 1 (field + `worldSDF` + map entry) — testable with no geometry
2. Slice 2 (geometry via the existing worker) + material check
3. Density/build-time decision (reduce vs bake-to-GLB) — **before** polish
4. Slice 3 (per-floor themes, lava bottom)
5. Slice 4 (routing graph, bot vertical-steering check)
6. Slice 5 (blending the two world styles)

**Risk note:** slices 1–2 touch `index-working.html` at four call sites (`worldSDF`, world build,
worker dispatch, `MAP_DATA`). Back up and bump `LSS_BUILD` per the usual workflow, and regenerate
`index.html` with `python strip.py` — never hand-edit it.
