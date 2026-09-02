# tools/blender — the LSS ship-model pipeline (headless Blender 4.1)

Everything here runs Blender **without a GUI** through its Python API (`bpy`). Nothing in
this folder ships to players; `LSS/` is the deploy root and only `tools/compress_glb.mjs`
writes GLBs into it.

## Requirements

- Blender 4.1.x — installed at `C:\Program Files\Blender Foundation\Blender 4.1\blender.exe`
  (bundled glTF I/O add-on, EEVEE renders work in `--background`).
- Node deps for the compress step: `cd tools && npm install` (once).
- Python 3 with `numpy` + `Pillow` for the report/diff helpers.

## Folders

| folder | role |
| --- | --- |
| `assets_base/ships/` | **frozen inputs** — the v37.23 hulls exactly as shipped (byte-identical to `LSS/ships` at git `f6260f2`). Never edited. |
| `assets_src/ships/` | **Blender output** — float32, unquantized GLB written by the scripts here. This is what `compress_glb.mjs` reads. |
| `LSS/ships/` | **shipped** — written only by `node tools/compress_glb.mjs`. |
| `tools/blender/reports/` | JSON reports + renders from the last run (not needed at runtime). |

Why two source folders: the June art drop that `compress_glb.mjs` was written against is
no longer on disk, and the shipped hulls were already meshopt-simplified to 50%. So the
frozen shipped hulls are the new baseline, and the compress recipe runs with `simplify: 1.0`
for ships (see `OVERRIDES` in `compress_glb.mjs`) — simplifying twice would decimate to
~25% and bring back the surface wobble the 0.5 pass was tuned to avoid.

## Full rebuild (from the repo root)

```bash
"C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" --background --python tools/blender/ship_cleanup.py -- --render
"C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" --background --python tools/blender/verify_culled.py -- --after tools/blender/work/clean
python tools/blender/verify_culled_diff.py
"C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" --background --python tools/blender/ship_symmetry.py -- --fix --render
"C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" --background --python tools/blender/ship_cockpit.py -- --render
node tools/compress_glb.mjs --only ships
```

Chain: `assets_base/ships` → `ship_cleanup.py` → `tools/blender/work/clean` →
`ship_symmetry.py --fix` → `tools/blender/work/sym` → `ship_cockpit.py` → `assets_src/ships`
(all three gitignored) → `compress_glb.mjs` → `LSS/ships`.

**Ship axes are canonical**: every hull faces −X in Blender space with +Y to the pilot's
right and the symmetry plane at y = 0 (after `ship_symmetry.py`). Never derive forward
from the gun markers — a single one-sided gun skews it by up to 24° (Pyro) and that yawed
every cockpit built in that frame.
Renders and JSON reports land in `tools/blender/reports/` (gitignored); look at the
`_sheet_*.png` contact sheets there after a run.

Then bump `_MODELS_VERSION` in `LSS/index-working.html` (NOT `LSS_BUILD` — see the ASSET
CONTENT VERSIONS comment there) and run `python strip.py` from the repo root.
`python tools/gen_manifest.py` only needs re-running if the asset *tables* change.

## Scripts

- `ship_survey.py` — read-only: imports each GLB, prints topology stats, renders six views
  plus a pilot-POV from the `cockpit1` marker. Good first look at any new hull.
- `ship_cleanup.py` — **stage 1**. Per hull: deletes loose debris that sits inside the hull
  (never visible) and tiny slivers; fills tiny cracks (≤ 12-edge loops under 1.5% of hull
  length). It also detects faces whose front side points into the solid, but only flips them
  with `--flip-inverted`: the culled verification showed those are buried plates (0 pixels
  fixed, 0 broken from six vantages), so flipping is off by default. All edits go through
  edit-mode operators so the GLB's custom split normals survive. Keeps the `gun*` /
  `thruster*` / `cockpit1` markers.
- `verify_culled.py` + `verify_culled_diff.py` — renders before/after with backface culling
  ON and a transparent film from six vantages, then diffs the alpha: every enclosed
  transparent pixel is a hole the player could see through. `NEW` must be 0. (Compare the
  cleaned hulls, not the cockpit builds: transparent glass shows up as alpha too.)
- `ship_symmetry.py` — **symmetry pass**. Measures left/right asymmetry (distance from each
  vertex's mirror image to the real hull, as a % of width) with a heat-map render, and with
  `--fix` symmetrizes by surface averaging: a vertex moves halfway to its counterpart on
  the other side when that counterpart is within `SYM_THRESH` (3.5% of width); anything
  further apart is a deliberate one-sided feature (railgun, gun boom, Pyro's mismatched
  pods) and stays, plus a `PROTECT_R` radius around an unpaired gun marker. Marker pairs
  snap to exact mirrors. Custom normals are kept. The hull is re-centred on its true plane.
  Judge with `reports/symmetry/_sheet_*.png` (blue = symmetric, red = ≥3% off).
- `ship_cockpit.py` — **stage 2**. Per hull: finds the painted canopy faces (texture
  saturation near `cockpit1`, largest component, or `union` of same-hue components for split
  windows — PYRO), folds enclosed frame slivers in, and gives them a second material
  `canopy_glass` = the hull texture at alpha 0.38, alphaMode BLEND, single-sided (culls from
  inside, so the pilot sees a clear view). Flips inward-pointing glass faces. Carves hull
  faces inside the tub footprint plus buried inner-shell faces around the cockpit. Builds ONE
  interior mesh with ONE material from a generated 512² atlas (+ emissive atlas): a tub lofted
  from the real canopy rim (convex-hull fallback), seat, wrap-around dash with three screens,
  glow strip, side consoles with buttons, rear bulkhead, two canopy struts, seated pilot.
  Everything is sized from the canopy (Lc × Wc × Hc) and the tub depth is capped by the hull.
  The seat / eye is placed by a ray-fan search (yaw ±65°, pitch −18..+28° against the
  non-glass hull) for the most open forward view with the helmet under the glass; the
  canopy gets a rim rail; only the roll bar behind the head remains as a strut (a front
  strut either barred the view or turned into a jagged crown). Also bakes a HULL emissive
  map from the painted class-colour light strips (`HULL_GLOW` per-ship sat/val/hue
  knobs; judge with the `<ship>_night.png` render). Moves `cockpit1` to the pilot's eye.
  The glass is a FLAT tint (the hull texture paints a fake interior and glare into the
  canopy; at 35% alpha that read as a veil, worst on Puncture); all enclosed paint islands
  are folded into the pane (keeping the dark ones opaque made black shards, the paint's
  frame lines are finer than the triangles); panes are oriented against the eye so none can
  face the pilot. Knobs: `CANOPY` (per-ship detection), `ACCENT` (= LSS.CLASS_COLORS),
  `GLASS_ALPHA`, `HULL_GLOW`, `RAIL_FULL` (full thin window frame, Pyro), `TALL_DASH`
  (instrument stack for a high eye, Pyro), the `REG` atlas layout, `EMIS_FILL` (the
  interior fill light baked into the emissive atlas, a LINEAR multiplier on the tile — the
  atlas pixels are raw bytes the game decodes as sRGB, so a 0.14 tile is 1.5% linear light
  and any sRGB-space "floor" stays black on surfaces the sun never reaches; 1.5 keeps the
  dark v37.34 mood, 3.0 flattened the cockpit into a grey box).
  **Holes.** The hull is single-sided in the game, so any hull face the seat sees from its
  back is a window onto the sky. Two closers, both measured by the SEE-THROUGH MAP
  (`<ship>_seethrough.png`, equirectangular from the eye: blue glass, green interior, grey
  hull, RED hole; `see_through.hole_pct_of_sphere` in the JSON — the target is 0):
  1. **Coaming** — the tub top is capped at 0.30 Hc so it stays a basin, but where the
     glass edge sits higher (Vortex's bubble on its raised fairing: 0.66 Hc behind the seat)
     that leaves a slot straight into the fuselage void. Per rim angle a wall rises from the
     tub top to just under the lowest glass at that angle (outer 25% of the canopy radius),
     so slit windows are never covered.
  2. **Canopy-zone holes become glass.** A 360×240 ray fan from the eye with the game's
     culling (helmet, glass and anything inside the camera near plane — `L/150`, one game
     unit — passed through) collects every hull face still reached from behind. A hole
     inside the canopy's own footprint (above its lowest point, within its length and
     width) is turned into a pane, oriented away from the eye like the other panes. The
     v37.34 cockpits the owner liked were in effect full greenhouses: the painted frame
     areas between the windows were see-through and read as open sky, with the thin rim
     rail as the frame; plating them (grey tile, then the hull's own paint) put dark shards
     into that view ("worse from inside"). Pyro: 713 frame faces → glass.
  3. **Inner lining** for holes below the rim (fuselage, nose skin under the dash): those
     faces, grown by the fan's cell size at their distance, get an inner shell (vertices
     pushed 1% of the width inward along the vertex normals, shared between plates so
     creases don't crack) with a single-sided skirt around the outline; the plates live in
     the interior mesh but wear the HULL material with the hull face's own UVs (second
     material slot), so what little of them is visible looks like that ship. Rounds repeat
     until the fan is clean. Without the coaming Vortex needed 30 000 plates of tail
     interior; with it ~300. `--no-lining` / `--no-coaming` show the raw holes.
     Cracks (rays that leave the hull with nothing beyond) get a small plate at the
     parity-vote crossing, sized by the crack's cross-section only — the crossings scatter
     ALONG the ray, and that depth noise once sized a 6 cm plate for a hairline 4 cm from
     the pilot's head. Inside the canopy zone a gap is left as SKY (Puncture has a real hole
     above the head; any pane that close filled a quarter of the view).

## The Meshy v2 fleet (v37.37+)

The seven hulls are being remade from Meshy AI text-to-3D (owner's call: the old hulls were
lumpy Meshy exports with painted canopies, the root cause of the "C+" cockpits). New chain:

```bash
python tools/meshy/meshy.py balance                     # key in tools/meshy/.key (gitignored) or MESHY_API_KEY
python tools/meshy/fleet.py preview <ship> b            # 20 credits: clay geometry, prompt from FLEET[ship]['geo']
python tools/meshy/fleet.py refine  <ship> ship_<ship>_b # 10 credits: PBR 2k textures, FLEET[ship]['paint']
blender --background --python tools/blender/candidate_views.py -- --slugs ship_<ship>_b_refined   # judge sheet
python tools/blender/fleet_v2.py [--ships a,b] [--render]   # intake -> cockpit stage -> compress -> manifest
```

`tools/blender/intake/fleet.json` maps each ship to its chosen candidate folder and a mode:
`open` (the model has a real cockpit cavity) or `cut` (a closed canopy bulge). Candidates
live in `assets_base/cockpits/candidates/<slug>/` (gitignored, regenerable from the task ids
in their JSON); chosen hulls land in `assets_base/ships_v2/` after intake.

- `ship_intake.py` — one Meshy GLB → one canonical hull: joins the parts, finds the forward
  axis by MIRROR SYMMETRY (the wingspan is often longer than the fuselage, so "long axis"
  is wrong), the tail by outward-facing nozzle area, centres and scales to length 2.0, and
  places the markers from geometry: thrusters = rear-facing face clusters, guns = forward-
  facing clusters at the nose, cockpit1 = the painted canopy (largest dark, matte, upward
  patch in the front 65% — the "highest point" rule fails when the spine is taller).
  Overrides in `tools/blender/intake/<ship>.json` (`flip_forward`, `yaw_deg`, `markers`).
  `--render` draws the markers (red guns, blue thrusters, yellow eye).
- **Do not run `ship_cleanup.py` / `ship_symmetry.py` on v2 hulls.** A remeshed Meshy hull is
  thousands of overlapping shells; the debris rule deleted 60% of the Slayer. Their mirror
  error is ~0.1% of the width already.
- `ship_cockpit.py --open a,b --cut c,d`: OPEN = the cavity is found with downward rays on a
  grid around cockpit1, its rim becomes the canopy outline and a lofted glass DOME
  (`OPEN_CFG`: dome_h of rim width, apex_fwd) is joined into the hull as the canopy faces;
  everything downstream (tub, eye, rail, coaming, lining, see-through map) runs unchanged.
  Cavity `method` per ship: `pct` (default — cells `depth` below the window's 80th
  percentile height; right for a fuselage pit: Slayer, Puncture) or `adapt` (cells below
  the local maximum within `local_r` by `adapt_frac` of the deepest drop near the marker;
  the only rule that finds a thin delta's slot without eating its wing top: Vortex). Judge
  with `<ship>_cavity.png` (height grid, red = cavity, yellow = marker). Enclosure and
  morphology variants were tried and starve wide pits — leave the two methods alone.
  CUT = the painted bulge is found and DELETED, then the hole's footprint is the cavity.
  `CUT_CFG` modes: 'dark' (dark + matte + upward faces near cockpit1, spatially clustered —
  shared-edge components are confetti on these meshes; needs a hull lighter than its
  canopy), 'hue' (CHROMA KEY: prompt the refine to paint the canopy a colour the hull never
  wears — Pyro's cyan on red — and key on that hue; also give the intake
  `intake/<ship>.json` `canopy_hue` so cockpit1 lands on it), 'geo' (an ellipse footprint).
  Meshy's own cavity interior is a smooth lumpy blob with a stretched texture — the tub
  carve replaces it. Islands are off in these modes.
- Textures: the refine GLB embeds JPEG 2k base/normal/metallicRoughness; `compress_glb.mjs`
  ship recipe now converts JPEG too (base 2k WebP q88, data maps 1k WebP q85): ~10 MB → ~3 MB.
- In-game (v37.37): materials that ship a normal/roughness/metalness map keep them (old
  hulls have none), the cockpit rig adds two point lights (`window.__cockpit.light`), and
  the interior material is found by NAME (two-primitive interiors since v37.36).

## What the game does with it (index-working.html)

- `_lssApplyShipRig`, first-person branch: with Settings > "3D Cockpit" on, the ship mesh
  stays visible and the camera sits at `cockpit1`; `body.lss-cockpit3d` hides the PNG
  frames; the eye kicks on recoil and the interior emissive pulses on fire / core /
  railgun charge (published as `userData._cockpitPulse`, multiplied in by
  `animateShipMesh`, which owns `emissiveIntensity`). `window.__cockpit = { on, kick,
  recoilMul }` overrides live: `kick` (default 0.35 world units) is the eye's per-shot
  kick-back, `recoilMul` (default 0.4) scales the per-shot pitch kick and screen shake
  while the cockpit is live (v37.35: "less screen/ship shake"); the painted frames keep
  their original feel.
- Fire: with the cockpit live the shots and muzzle flash leave the GLB gun markers
  (`_computeScreenMuzzleWorld` answers the marker on the same screen side; `spawnTracer`
  draws one tracer from the barrel).
- `buildModelShipMesh` keeps `emissiveMap` (cockpit always; hull behind Settings > "Hull
  Lights").

## Rules that bit us

- **Never let the ship recipe simplify twice.** `OVERRIDES` pins `simplify: 1.0`.
- **Markers are empty nodes.** `prune()` must keep leaves; `buildModelShipMesh` reads
  `/^gun\d+$/` and `/^thruster(\d+)$/` by name, and the cockpit work reads `cockpit1`.
- **In-game only the baseColor map survives.** `buildModelShipMesh` rebuilds materials
  keeping map / color / vertexColors / transparent / opacity — normal, roughness and
  emissive maps authored in Blender show only on the ship-select stage and hub traffic.
- **bmesh face order after `to_mesh()` is not creation order** — tag `material_index` on
  the `BMFace`, never by index range.
- **`BVHTree.FromBMesh(...).ray_cast` reports the STORED face normal**, not a geometric
  one. Faces made with `bm.faces.new` carry a zero normal until `bm.normal_update()`, and
  then read as solid from both sides — the first lining pass lined nothing because the
  helmet "blocked" every ray. Update normals before building a tree.
- **Coincident double-sided quads fool ray probes**: the tree answers either quad first,
  and stepping past the hit skips both. Make sealing geometry single-sided, facing the eye.
- **A ray fan only finds the faces it hits.** At 1.5° cells the tail triangles sit between
  rays, so line by a radius scaled with distance (`1.6 × cell × distance`), then re-fan.
- Import with `merge_vertices=True` for real topology counts; the default import splits at
  UV seams and reports thousands of fake "loose parts".
- Forward axis = mean(gun markers) − mean(thruster markers); glTF space round-trips when
  the hierarchy is flattened, transforms applied, and `export_yup=True`.
