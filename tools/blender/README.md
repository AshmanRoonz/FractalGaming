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
3. Click **Paint Glass: OFF** to turn it on. Default tool = **Outline** (owner: "straight lines from
   one point to the next"): click on the hull to drop points joined by straight lines, **Enter** or
   double-click closes the shape and marks every visible triangle inside it, **Shift+Enter** erases
   inside, **Backspace** removes the last point, **Esc** cancels. Switch the Tool to **Brush** to
   drag-paint instead (**Shift** erases, **[ ]** resize). **Right-drag** orbits, wheel zooms, in both.
   *Mirror* applies both sides at once (axis Z = the ship's left/right). *Front-facing only* keeps
   the inside of the hull out of it. The outline fill renders the id pass over the whole view, so
   only the surface you can see inside the shape is marked (sub-pixel triangles are added when their
   centroid lies inside and no deeper than the visible surface around it).
4. Optional: **Place Cockpit** and click where the pilot's eye should be — the pipeline uses it.
5. **Save to pipeline** writes `tools/blender/marks/<ship>_glass.json` (or **Export** and move
   the download there). **Load marks JSON** resumes a previous session.
6. Rebuild: `blender --background --python tools/blender/ship_original.py -- --ships <ship>`
   then `node tools/compress_glb.mjs --only ships`.

With a marks file present the pipeline uses your marks as the window and skips the reference
transfer, the surround fill, the boundary smoothing, the shell vote and the islands. Outline fills
are replayed as CUTS (v37.50, owner: *"after i hit enter to fill the nice straight lines, it goes
jagged"*): every outline edge together with the camera you drew it from spans a plane ;
`replay_fills` bisects the front-facing faces near that edge with it (`bmesh.ops.bisect_plane` on a
working subset, mirrored outlines replayed with the mirrored camera), then the pieces inside the
polygon, front-facing and unoccluded from that camera, become glass — so the glass edge IS the line
you drew. Brush marks (no outline) are matched by centroid, whole triangles. A per-ship
`tools/blender/marks/<ship>_adjust.json` with `{"level_bottom": true}` (or a Blender z = the editor's
'up' value) makes the glass's LOWER edge a level line: the outline's bottom points are pushed below,
a horizontal plane at that height cuts the hull, and faces under it are excluded (Syphon, v37.58 —
the owner could not click the right spot for a level edge). The report shows
`fill_ops` / `fill_cuts` / `cut_faces`, or `marks_matched` / `marks_missed` for brush files. The report
shows `marks_matched` / `marks_missed` ; a miss count in the thousands means the wrong file.
Technically: the editor makes the hull non-indexed, tints marked triangles through
`onBeforeCompile`, picks with a GPU id pass (triangle index encoded as colour, one pixel read
back) so a million-triangle hull paints at full speed, and brushes by centroid distance on a
uniform grid.

### The originals carry the markers now (v37.51)

Owner: *"can you transfer the other saved points to the ships_original glb files? thrusters, guns
and cockpit?"* — `node tools/transfer_markers.mjs [ship...]` copies the gun* / thruster* /
cockpit* nodes from `assets_base/ships/<ship>.glb` (the frozen v37.23 hulls, same scene space)
into `LSS/ships_original/<Ship>.glb` as empty nodes at the scene root, meshes and textures
untouched (written binary in memory: a `.tmp` name once made NodeIO emit a JSON stub with side
files — the untouched copies in `assets_base/ships_original_raw/` restored the folder).
`tools/blender/marker_check.py` confirms every marker imports at the frozen position (offset 0).
`ship_original.py` reads markers from the original's own nodes first (`markers_source: original`),
then the frozen hull ; markers placed in the editor (the marks JSON) override both. The editor
opens the originals with the markers detected, so they can be adjusted there.

## Clean hulls: remesh + rebake (v37.52) — `tools/blender/ship_remesh.py`

Owner (2026-09-03): *"the GLB files are shit... they look nice from far, but when you zoom in, it
is a hot mess"* — every original is ~2000 loose overlapping panels with no thickness. Option 1:

`blender --background --python tools/blender/ship_remesh.py -- --ships pyro --render` per ship:
SOLIDIFY the panels (`--solid` 0.006 L ; without thickness a voxel remesh cannot tell inside from
outside: the `voxel_remesh` operator gave a pitted, porous surface and crashed Blender with an
access violation two runs in three, the REMESH modifier a sparse cloud) → REMESH modifier, voxel
`--voxel` 0.002 L (≈1.08 M quads on the Pyro, stable) → SMOOTH ×2 (voxel terracing) → drop the
loose parts boxed inside another (cavities) → decimate (triangle count, Y symmetry) to `--target`
150k, validate + dissolve degenerate (a decimated mesh once lost a face's loops and every later
step silently did nothing) → smooth shading with sharp edges by angle (4.1: no auto-smooth
property) → smart UV + pack → Cycles bake hi→clean: DIFFUSE colour (the paint) and tangent
NORMAL (the detail), `--tex` 4096 (2k was visibly soft ; coverage ~36% from the many islands),
cage 0.015 L / rays 0.035 L (longer rays drew thin dark streaks across the panes where they
crossed overlapping panels) → `assets_base/ships_clean/<Ship>.glb` (gitignored) with the markers.
INNER SKIN (v37.57): solidify + voxel remesh yields a shell with an outer AND an inner surface ;
the cavity filter only drops inner skins that are separate loose parts, and where the inner skin
connects to the outer through openings it survived — 64% of the clean Pyro's faces sat a few mm
under the skin and left opaque slivers and a jagged "crack" under the owner's glass cuts.
`remove_inner_skin` (after a first decimation to 2× the budget) deletes every face no external
viewpoint can see: a 9-ray cone around the normal must all be blocked AND none of 14 far-away
directions sees the face first (so nozzle interiors and intakes, which fail the cone test, stay) ;
then a second decimation to the budget spends it on the outside only. `inner_probe.py` reports the
blocked-normal fraction (Pyro 64% → 17% = its concavities).
Diagnostics: `reports/remesh/<ship>_{before,after}_{front34,canopy_close,skin_macro}.png` (scratch
`sheet_remesh.py`) and `<ship>_remesh.json` — every step asserts it produced data.

Then the cockpit chain on the clean hulls: `ship_original.py --orig assets_base/ships_clean`
(imports with merge_vertices: the export split vertices along UV seams, 5647 "shells" otherwise).
Outline marks drawn on the ORIGINAL in the editor replay as cuts on the clean hull too (same
space) ; brush marks match faces by centroid and do not transfer.

### blender-model-optimizer (v37.54) — what it does for us

Owner: *"try this https://github.com/Hinneman/blender-model-optimizer"*. It is a Blender 4.2+ sidebar
add-on that cleans and decimates AI models (merge doubles, fill holes, remove enclosed loose parts or
ray-cast interior faces, delete small pieces, planar pre-pass + multi-pass collapse with UV-seam
protection, optional normal bake, export with Draco). Its geometry functions are plain bpy, so
`tools/blender/optimizer_try.py` drives them headless under 4.1 from the vendored copy in
`tools/blender/vendor/blender-model-optimizer/` (MIT). Findings on the Pyro (`reports/remesh/
_compare_pyro.png`, scratch `sheet_compare.py`): it keeps the original texture crispest because it
never bakes, but it is a decimator — the overlapping zero-thickness panel soup stays, which is what
reads as a mess up close and what the glass cuts and the cabin cannot live with ; its collapse also
leaves a mesh the glTF exporter rejects until validated (same trap as ours) ; its RAY_CAST interior
removal is 13 Python rays per face (hours on a million faces — use LOOSE_PARTS). What we kept: its
`decimate_single` (planar pre-pass merges the remesh's coplanar quads into n-gons, then a two-pass
collapse spends the budget on curves) now runs inside `ship_remesh.py` by default (`--pkg ''` for
the plain collapse), together with larger UV islands (80°, tighter pack: 55% coverage instead of
36%) — the remeshed Pyro is now close to the original's crispness with clean geometry.

### v37.59 — bare hulls with the owner's glass (the cabin is opt-in)

Owner: *"if you used my original glb's then why are your cockpits inside there? we should be starting
fresh, with just the glass installed."* `ship_original.py` no longer builds the procedural cabin
unless `--interior` is passed: the default output is the clean hull + `canopy_glass` cut along the
owner's outlines + markers + the eye (`cockpit1`) placed by the open-view scan. Classification of
the cut faces (v37.58): a face inside the outline that faces the camera but is hidden only by other
glass (the canopy's own bulge at grazing angles) is a candidate, confirmed when it lies in the glass
fringe ; then a CLOSE pass fills faces with glass on two of their edges (one-face cracks, notches)
without moving the straight outer edges.

### v37.60 — "parts of the hull missing" (owner) : what it was

Three separate causes, none of them the glass itself (a probe with the glass painted opaque green
from four angles showed it confined to the outlines): (1) the outline cuts add faces, so hulls that
arrived at exactly the 150k budget went just over it and `ship_original.py` DECIMATED the region
within 0.35 L of the eye by half — Vortex, Tracker, Slayer and Blaster lost 16–36k faces of cockpit-
area detail (fix: the budget check has 10% slack) ; (2) the inner-skin pass also removed exterior
faces in the Pyro's deep grooves (fix: it is opt-in, `--strip-inner`, default off — hulls stay
complete as in v37.54) ; (3) the hidden-behind-glass rule turned a patch of the Tracker's BELLY into
glass — it sat in the fringe of a thin hull, seen through the canopy from above (fix: candidates must
face like the pane, normal within ~78° of the glass's mean normal).

### v37.60b — the Vortex floor under the window (owner: "still has a bit of cut out on the hull under the window")

The hidden-behind-glass rule also needs its candidates to look out at OPEN AIR (`escapes(fi)`, the
surround fill's test): the hull's own inner skin under the canopy faces up like the pane and sits in
the fringe, so 296 floor faces on the Vortex had become glass and from the seat the floor under the
window was see-through. Far-half pane faces (what the rule is for) escape ; interior faces' normal
rays end inside the hull. Vortex trapped glass 296 -> 37, additions 640 -> 421. Probe:
`escape_probe.py` in the session scratchpad (glass faces whose normal ray hits the mesh).

### v37.61 — GHOST SEAT VIEW (game side, not the pipeline)

Owner: "what we did with the leviathans to make them ghost looking... we should try that with the
ships for what they look like from the inside". `_addGhostHull` in index-working.html clones the
monsters' `_addSpectralGhost` treatment onto the player's hull materials while the 3D cockpit is
live (abs(N.V) fresnel so the inner skin reads like the outer, canopy glass untouched, restored on
leaving the seat). Knobs `window.__cockpit.ghost = { on, core 0.30, rim 0.62, mix 0.35, tint
0x8ad8ff, flicker 1 }` + `__ghostHullRefresh()` to re-apply after a change.

### v37.62 — the glass is a TRANSLUCENT ZONE, not a hole (game side)

Owner: "on all the models, let's use the glass cut out to define a more translucent area, instead
of cutting it fully out". Outside: `_addCanopyPane` gives the canopy_glass material a body
(opacity 0.62 over the GLB's 0.35) plus a fresnel rim, knobs `window.__canopy = { opacity, rim,
tint }`. Seat: the glass joins the ghost shell at a lower alpha (`__cockpit.ghost.glassCore 0.10 /
glassRim 0.30`). The ghost shell is restored whenever the chase view is up (warmup frames run
first-person, so a guard at the top of `_lssApplyShipRig` puts the painted hull back).

### v37.63 — the far-half rule is OFF for mirrored outlines

Owner: "vortex has that cutout on its hull under the windows again". A probe from the eye with
the glass painted green (`eye_probe.py`, session scratchpad) showed a jagged tongue of glass
below the canopy rim on the flanks: the hull the bubble occludes from the drawing camera, which
the hidden-behind-glass rule adopted (exterior, escaping, aligned — none of the earlier filters
could reject it). With a MIRRORED outline the far half of the pane is the near half of the
mirrored pass and the primary rule cuts it directly, so the rule is redundant: `load_marks` now
tags fills `mirrored` and `replay_fills`' candidates are dropped when any fill is. Vortex glass
2991 -> 2491 faces, the pane's edges are the owner's straight lines only.

### v37.63 — original-hull A/B set

Owner: "we might have to start over with the original glbs". `ship_original.py --orig
LSS/ships_original --out assets_src/ships_orig` cuts the same outlines into the ORIGINAL hi-poly
exports (decimated to the 150k budget, panel soup and all) ; `node tools/compress_glb.mjs --only
ships_orig` -> `LSS/ships_orig/`. In the game `?hull=orig` (or localStorage lss_hull_set = 'orig')
loads that set instead of the remeshed one — a reload switches, the model cache is per boot.

## v37.64-65 — START OVER FROM THE ORIGINALS, NO GLASS (`ship_plain.py`)

Owner: "i don't think we need the glb models with the cutout, let's start over and use the
ships_original models, let's shrink the file size down / we won't use the glass cutout data at all
/ let's do this for all the ships". The remesh + bake + glass-cut chain is retired (both scripts
stay for reference) and replaced by ONE short stage:

    blender --background --python tools/blender/ship_plain.py -- [--target 60000] [--render]
    node tools/compress_glb.mjs --only ships          # -> LSS/ships, then bump the stamps

`LSS/ships_original/<Ship>.glb` -> weld exact duplicates -> planar 5 deg pre-pass + 2-pass collapse
to 60k triangles with UV seams protected (the original texture is KEPT, nothing is re-baked) ->
validate -> smooth with edges over 32 deg split -> export with the marker nodes. 606k-1.0M tris in,
60k out, and at that budget the hull is indistinguishable from the original at every distance
(reports/plain/_vortex_plain.png). Shipped: **21.1 MB for the fleet, down from 46.1 MB** (2.6-3.7 MB
a ship, was 5.4-7.6). No glass material, no cuts, no interior, no marks JSON.

Two traps, both fatal and silent (Blender exits 127 with no traceback):
  * the seam-protected decimation leaves a mesh datablock `bmesh.from_mesh()` CANNOT read - drop the
    vertex groups it made and rebuild the datablock with `bpy.data.meshes.new_from_object()` first ;
  * the 4.1 edit-mode shading operators (`edges_select_sharp` / `mark_sharp`) and an applied
    EDGE_SPLIT modifier crash on these hulls - split the sharp edges in bmesh instead.

### The seat

The old `cockpit1` markers came from the simplified hulls: on five of the seven originals they sit
ON the outer skin with nothing above them, which is why the seat view had a floor and no ceiling
(owner: "it looks like the top half the ship is missing in ghost view" -> "maybe it's just where the
cockpit position is placed"). The eye is now the hull's EXACT CENTRE (owner: "let's try placing the
cockpit location in the exact middle of each ship") - enclosed on all six sides on every ship, so
the ghost shell wraps the pilot. Nudge it live from the seat with
`window.__cockpit.eye = { fwd, up, right }` (game units, a corvette is ~100 long), or bake an offset
per ship in `tools/blender/marks/<ship>_eye.json` `{"offset": [fwd, right, up]}` (hull lengths).

### The ghost is a seat effect only

Owner: "it glitched on endless and the cinematic showed the external view as the ghost (it should
only be internal view looking out as ghost)". The pre-round cinematic flies an EXTERNAL camera while
the game is still in first person, and the ship rig does not run on every one of those frames, so an
apply from an earlier frame survived into a view that shows the hull from outside. The gate moved to
the RENDER side: `_ghostHullSync()` runs at the top of `renderFrame`, after every camera is final and
before any path draws, and `_ghostSeatWanted()` requires the seat camera (cockpit live, not third
person, no cinematic). The cinematic also strips the shell the moment it takes the camera.

### v37.66 — a BAKED skin on the decimated hull

Owner: "earlier we ran a streamline that cleaned up the ship models... it made the skin theme go on
way cleaner... right now we can see a lot of triangles with the skins applied". The original UVs are
per-panel and a collapse drags them across their own seams, so the texture smears along every
decimated triangle. `ship_plain.py` now finishes the way the remesh chain did: the decimated hull
gets ONE fresh atlas (smart project 80 deg + pack) and the original's appearance is baked into it
through space (Cycles DIFFUSE COLOR, 2048), plus a tangent NORMAL bake at 1024 that puts the panel
detail the decimation removed back into the shading. Cage 0.015 L, rays 0.035 L, 4 samples, ~5 s a
ship. `--nobake` keeps the original texture and UVs, `--tex` sets the atlas size.

The bake source is a copy of the hi-poly taken before the weld, kept hidden and removed after.
Fleet after this: **17.9 MB** (2.2-3.2 MB a ship), against 21.1 MB unbaked and 46.1 MB in the glass
chain, and the skin lands clean (reports/plain/_vortex_baked.png).

### v37.66 — the ghost shell: theme tint, calmer, and it stops being cut

Owner: "less flicker, and also make it correspond with the theme color of the ship / water and the
city really mess with the ghost transparency... on land it looks fine... the water and the city cut
through it... and also on the water you can't see the reflection of the ship while looking out in
ghost mode" then "a bit more transparent would be better".

  * **tint** = `LSS.CLASS_COLORS[loadoutKey]`, the same table the beams and shields use.
  * **flicker** 1 -> 0.25, and the rim's additive term is now the `glow` knob (0.85, was a
    hard-coded 1.15) - against a night city that term, not the alpha, was what swamped the view.
  * **cut through** = transparent-vs-transparent sort order. The hub water plane FOLLOWS the ship
    and the city's glass sorts by its own bounding centre, so both tie with the hull on distance and
    won the toss about half the time. The shell now draws at `renderOrder` 4000, after everything.
  * **no reflection** = `_shipReflOverride` HIDES every transparent mesh in the reflection pass (the
    v33.79 shield-blob rule), and the ghost hull is transparent, so the ship simply had no
    reflection. The pass now puts the painted hull back for its own render and re-applies the shell
    after, so the mirror shows the real ship while the seat keeps the shell.
  * density: core 0.30 -> 0.09, rim 0.62 -> 0.44. The eye sits at the hull centre, so a look out
    passes through four to eight layers of shell and the old core compounded to nearly opaque.

Ghost materials are now built ONCE per hull and cached (the reflection pass swaps them out and back
every time it runs; cloning per swap would churn all frame). Knobs, all live:
`window.__cockpit.ghost = { on, core, rim, mix, glow, flicker, tint, order }`.

### v37.67 — the Blaster's eight barrels, and where the sources live

The owner re-exported `Blaster.glb` with six more gun markers (gun1..gun8, two pods of four at the
wing roots) and dropped it over `LSS/ships/blaster.glb`. Rebuilt through `ship_plain.py`: 929k tris
in, 60k out, all eight markers carried through, 2.72 MB shipped. The game picks them up with no
change - `muzzleNodes` collects every `gun<n>` node - so normal fire now cycles all eight barrels,
and the CORE fires from them in every view with a white-hot volley at each (see `_blasterCoreVolley`
in index-working.html, knobs `window.__blasterCore`).

**The hi-poly sources moved to `assets_base/ships_original/`** (they were in `LSS/`, which is the
DEPLOY ROOT - 195 MB that `tools/deploy_cf.py` would have uploaded to the live site ; the folder had
also been renamed by hand to "New folder"). `ship_plain.py --orig` defaults there now, and the
deploy script excludes both old names as a guard.
