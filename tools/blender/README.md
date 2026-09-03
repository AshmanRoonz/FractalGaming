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

## The frame art in 3D (v37.39) — the owner's target look

`LSS/frames/<Ship>/frame_<SHIP>.png` are the painted 2D cockpit overlays (1536×1024 RGBA:
dark hard-surface panelling, a hexagonal centre display, class-colour glowing instruments,
a top canopy rail, side pillars on Pyro/Blaster). The owner pointed at them as the reference,
so `ship_cockpit.py` now puts the painting itself in the cockpit: `build_frame_billboard`
cuts the PNG into strips by its own alpha (dashboard at the bottom, rail at the top, pillars
where the sides are opaque) and hangs each strip on a cylinder segment around the pilot's
eye at its own depth (`FRAME_R`: dashboard 0.27 Lc — inside the procedural dash, which it
hides — rail 0.60 Lc, pillars 0.48 Lc), keeping the overlay's screen angles (`FRAME_VFOV`
120 = the owner's fovDeg, `FRAME_HFOV` 144 for 16:9) so the artist's composition is exact
at the default eye and parallaxes with the head. The material is mostly self-lit (emissive =
art × `FRAME_EMIS_GAIN`, base × `FRAME_LIT`) so it reads like the overlay instead of sun +
emissive blowing out the centre display. In-game the `cockpit_frame` node is a FIRST-PERSON
element: hidden on every ship by default, shown only while this player's cockpit is live
(`_lssCockpitOff` in the third-person and no-cockpit branches) — a rail strip 60° above a
low canopy would otherwise float over the hull in the chase view.

The same build made the tub COMPACT (owner: "a lot of wasted space"): `COMPACT_DEPTH` 0.75,
side consoles from the armrests out to the walls and the full tub length (screens, keypads,
two switch rows, rotary knobs, an inner lip), a raised deck with rudder pedals in the
footwell, avionics racks between the seat back and a closer bulkhead, ribs along the walls.

## The Meshy v2 fleet (v37.37+) — built, then REVERTED (v37.38)

The owner's verdict in the game: "the ships look like shit now", and no more Meshy credits.
The seven refined GLBs stay under `assets_base/cockpits/candidates` and the chain below
still works, but the game ships the original hulls. Kept for reference:


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

## The ORIGINAL exports (v37.41) — `ship_original.py`

The owner dropped the original hi-poly exports in `LSS/ships_original/<Ship>.glb` (capitalised
names ; 0.3–1.0 M triangles in a single mesh of ~2000 overlapping shells, one 2048² JPEG,
opaque, no markers ; Syphon is a 22k-triangle PNG + normal-map export). Owner: *"the interiors
seem to be intact, but the windows need to be transparent... most of the symmetry is good, so
just add some floating dashboards and other interior cockpit design"*, *"the originals aren't
marked for the engines and weapons... but they are similar shape, so we can transfer that over"*.

`orig_peek.py` (→ `reports/orig/`) showed the originals sit in the SAME frame and scale as the
frozen v37.23 hulls (dims and centres agree to 1e-4), so the frozen markers transfer at identical
coordinates ; the hulls are hollow shells with a real cockpit pit under an opaque painted canopy,
and the inner skin is textured well enough to read as an interior when rendered double-sided
(which is what the owner saw).

Chain: `LSS/ships_original` → `ship_original.py` → `assets_src/ships` → `node tools/compress_glb.mjs --only ships`
→ `LSS/ships`. **No `ship_cleanup` / `ship_symmetry` on these** (cleanup deleted 60% of a
multi-shell hull before). The script executes the top half of `ship_cockpit.py` as its library
(knobs, atlas, `Builder`, `build_frame_billboard`), so there is one copy of the frame-art code.

Per ship: markers from `assets_base/ships/<ship>.glb` → the hull split into its loose shells
(Blender's own split ; a face attribute carries the part id through the join) → canopy =
TRANSFER of the old chain's `canopy_glass` region: `tools/blender/work/ref/<ship>.glb` (copies of
`LSS/ships` at v37.39/40, the canopies the owner judged in-game ; `work/` is gitignored, so the script
re-fetches them with `git show 5491ffb:LSS/ships/<ship>.glb` when missing), reduced to its big edge-connected
components (the old chain also laid hundreds of small panes over see-through gaps around the canopy
zone — those blotches must not transfer), then every original face within `REF_TOL` (0.007 L) of
that surface facing the same way is glass → SURROUND FILL (an opaque outer-skin face whose glass
neighbours' mean sits at its own centre is a bar between panes / a missed pane triangle → glass ;
voxel-grid statistics, not per-face tree queries — those took minutes per pass) → UNDERSIDE (a face
whose ray along −normal meets glass within 0.03 L is the shell's inner surface) → ISLANDS (small
loose shells lying wholly inside the glass fringe — bar remnants, specks — would float as shards in
the pilot's sky) → EYE by open-view scan along the canopy centreline under the canopy TOP surface
(first glass hit from above ; the lowest hit dropped Tracker's eye into the belly), candidates
without a pit floor beneath them penalised, rearmost on ties, `cockpit1` moved there → hull material
double-sided + hull-light emissive from the paint → THE TUB (v37.42, owner on v37.41: "they all look so
bad" from the seat — the AI hull has no interior, only hollow overlapping panels, and the clear
canopy exposed them): a lofted cabin from the canopy outline (polar 90th-percentile profile of the
glass centres × `TUB_SHRINK`), walls up to the LOWEST glass of each sector (so a greenhouse's side
windows stay outside the wall), a coaming ledge out past the glass rim, floor at `TUB_DEPTH`·Lc under
the eye, the hull's opaque faces inside that volume deleted (except the glass fringe = frame bars),
then sills with screens / buttons / switches, MFDs on the sill fronts, bulkhead with racks and a light
strip, wall ribs, deck grating, pedals, seat with pedestal → v37.43: NO frame-art band in the model (owner: *"i
dont think merging the png dashboards with the glbs are working"* — two visual languages) ; instead a
3D INSTRUMENT PANEL across the tub front, tilted 22° toward the pilot with its top under the eye line
(attitude display centre, radar left, bars right, log strip, buttons, glow strips, glare shield) and a
RIM RAIL tube along the coaming's outer edge so the window keeps an outline. The library's emissive
FILL (1.5×, for the old lightless tub) made these walls glow flat pale grey under a clear canopy ; this
chain overrides `EMIS_FILL = 0.35` and emission strength 1.0. v37.44 (in-game the cabin read as a long
corridor): panel at 0.26 Lc and ≥ 0.34 Lc wide, sills end at it, MFDs at 0.20 Lc, plus CANOPY ARCHES —
a mullion 0.15 Lc ahead and a roll bar 0.11 Lc behind the head, chains of tubes riding just under the
glass surface, so the window is framed in 3D. v37.45 (owner: *"the cockpit glass looks like it's tearing
into the frame... ripped apart"*): the glass BOUNDARY is smoothed (erode glass faces with < 22% glass in
their neighbourhood, close outer-skin faces with > 62%), a window-sill LIP rises from the coaming's outer
edge to the skin above it so the boundary is never in view from the seat, arches and rim rail are smooth
TUBES (bevelled segment boxes spiked at the joints), the eye sits 55% back along the canopy (rearmost-on-
ties made long canopies read as corridors), panel at 0.22 Lc, control stick, throttle, HUD combiner glass
(faint), overhead switch strip under the roll bar, and an ORM map on the interior atlas (glossy screens,
metal panels, matte seat). v37.46 (owner: *"if you use the original GLB files, it might be easier to find
the lines for the actual cockpit glass"*): SHELL VOTE — the canopy panes are their own loose parts in the
original, so after the face-level selection a part with ≥ 50% glass faces becomes glass whole and a small
part with < 12% loses its strays ; the glass edge follows the model's part lines (parts over 20k faces keep
the face-level result). Arch/rail metal dulled (trim metallic 0.35), display roughness 0.28 → decimate (`--target 150000` triangles ; shells within 0.35 L of the eye keep up to 60%
of the budget at ratio ≤ 0.5, the rest fills it, `delimit={'MATERIAL'}` so nothing collapses
across the glass border) → export.

⭐ What did NOT work on these hulls, so nobody tries it again: paint rules (Vortex's canopy and
fuselage share one purple, Pyro's bars and hull one black), bounding-box fills (leak over the
nose of every dark hull), "small shell" guards (the fuselage IS thousands of small panels),
flood-fill islands (with ~2000 shells everything is an island), and rays straight up from the
frozen `cockpit1` (they hit seat and console shells, not the canopy).

Diagnostics with `--render`: `reports/original/<ship>_{front34,canopy_close,top_close,
canopy_debug,cutaway,pilotpov,pilotpov_down,pilotpov_right}.png` and `<ship>_original.json`.

Game side (v37.41): `buildModelShipMesh` keeps `THREE.DoubleSide` from the GLB (the inner skin is
the interior ; single-sided left see-through holes wherever the pit shells gap).

Frame art (v37.41): ONE continuous band instead of cut strips — the owner saw the strip cuts
("it looks cut up on the frame"). A single grid covers the whole PNG and only its radius varies,
blended smoothly (dash rows close, rail rows far, pillar columns between) ; fully transparent
cells are skipped.

## Painting the glass yourself (v37.47) — `tools/glb_editor.html` → Paint Glass

The one thing the pipeline could never do reliably on these multi-shell AI hulls is know where the
window is. The owner can, in a minute: the GLB editor has a **Paint Glass** section.

1. `python tools/glb_editor_server.py` and open <http://localhost:8098/tools/glb_editor.html>
   (or open the file directly and use Export instead of Save).
2. **Open GLB** → `LSS/ships_original/<Ship>.glb` (the hi-poly original ; it loads in ~10 s).
3. Click **Paint Glass: OFF** to turn it on. **Left-drag** paints green, **right-drag** orbits,
   wheel zooms, **Shift** erases, **[ ]** change the brush. *Mirror* paints both sides at once
   (axis Z = the ship's left/right). *Front-facing only* keeps the brush off the inside.
4. Optional: **Place Cockpit** and click where the pilot's eye should be — the pipeline uses it.
5. **Save to pipeline** writes `tools/blender/marks/<ship>_glass.json` (or **Export** and move
   the download there). **Load marks JSON** resumes a previous session.
6. Rebuild: `blender --background --python tools/blender/ship_original.py -- --ships <ship>`
   then `node tools/compress_glb.mjs --only ships`.

With a marks file present the pipeline uses exactly those triangles as the window (matched by
centroid, so triangle order does not matter), adds only the shell's inner layer, and skips the
reference transfer, the surround fill, the boundary smoothing and the shell vote. The report
shows `marks_matched` / `marks_missed` ; a miss count in the thousands means the wrong file.
Technically: the editor makes the hull non-indexed, tints marked triangles through
`onBeforeCompile`, picks with a GPU id pass (triangle index encoded as colour, one pixel read
back) so a million-triangle hull paints at full speed, and brushes by centroid distance on a
uniform grid.
