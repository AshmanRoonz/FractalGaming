# Fractal arenas for LSS

Concept notes for `LSS/fractal_lab.html`. The question: can a fractal be a
**level** — somewhere you explore and fight — rather than a texture?

## What already existed

`LSS/wall_pattern_lab.html` and `LSS/walls/*.json` (including
`lss_walls_mandelbox.json`) author fractals as a **surface shader** on the
arena wall shell — pattern ids with `u_iters` / `u_scale` / `u_rings`
uniforms, exported as presets the game imports through `setWallPattern`. That
system paints a Mandelbox onto a wall. You cannot fly into it.

`Caverns/caverns.html` and `labs/matter_cavern.html` build caves, but from
value noise and meshes, not fractals.

So the gap was navigable fractal geometry. That is what the lab addresses.

## Two representations, one field

Everything comes from a single analytic signed distance field, evaluated three
ways. Keeping one source of truth is the whole trick — the alternative is a
visual that disagrees with collision.

| | what it is | what it is for |
|---|---|---|
| **GPU** | fullscreen raymarch writing `gl_FragDepth` | authoring view. Infinite detail, zero build time, ordinary three.js meshes depth-sort against it correctly |
| **CPU** | the same distance estimators in JS | what makes it a *place*: collision, spawn finding, the arena probe |
| **Mesh** | surface-nets bake of the CPU field | real `BufferGeometry` + normals, exportable as OBJ |

The GPU and CPU estimators must stay in lockstep. Change a `de*` function in
GLSL and its JS twin needs the identical change, or the ship flies through
walls that are visibly there.

### Why bake at all

The raymarch is the better *look* — it has detail no mesh resolution reaches.
But LSS cannot ship a fullscreen march as its level:

- The VR path returns before the post chain entirely
  (`index-working.html` `renderFrame`), so a march-based world would be
  desktop-only.
- Mobile/integrated GPUs cannot afford it on top of the existing 5-pass
  post chain.
- Every other world object in the game is a `Mesh` with a collider.

So the field is the authoring tool and the mesh is the deliverable. Measured on
the Menger Labyrinth preset, arena radius 4200:

| bake grid | cell size | triangles | bake time |
|---|---|---|---|
| 64³ | 131 u | 151,440 | 265 ms (75 ms sampling) |
| 128³ | 66 u | 726,240 | 1,400 ms (382 ms sampling) |

64³ reads as melted — surface nets averages edge crossings, which rounds the
Menger's hard box corners. 128³ recovers the structure. Sharp-feature
reconstruction (QEF / dual contouring) is the obvious next step if the rounding
matters; it would keep creases at 64³ and roughly quarter the triangle count.

## The probe is the point

A field can be beautiful and unplayable. The probe voxelises the arena, then
flood fills, and reports:

- **open %** — fraction of arena volume a ship fits in
- **median clearance** — typical corridor width, in ship radii
- **best room** — largest inscribed sphere; is there anywhere to actually fight?
- **connected %** — fraction of open space reachable from that room

The last one earns its keep. A field that is 47% open but 45% connected is not
one arena, it is a field of sealed bubbles. `Apollonian (fragmented)` is kept
as a preset specifically as that counter-example.

First implementation sampled random points and tested pairwise segments, which
is quadratic — on a genuinely open field it locked the tab. The voxel grid
costs a fixed N³ evaluations regardless of how open the field is.

## What the sweep found

1,200 combinations of family × space mode × world scale × tile × thickness,
scored headlessly through the probe. Two results changed the design:

**"Fly inside the solid" is not a thing.** Inverting the field (`d = -de(p)`)
was one of three space modes. It measured **0% navigable volume on all seven
families**. Escape-time distance estimators are only valid *outside* the set,
so the inverted field is noise, not a cave. The mode was cut rather than
shipped. Caves come from the *carved* mode instead — `abs(d) - thickness`,
a shell around the fractal surface, flyable from both sides.

**Bounded fractals make voids, not levels.** Most families scored 87–97% open
in solid mode: a sculpture sitting in an empty arena. Domain repetition
(`tile`) is what turns them into levels — an endless lattice of rock with
tunnels through it. Repetition breaks the distance guarantee, so the field
clamps to half a cell, costing a few extra march steps near boundaries.

Best measured arenas (ship radius 14, arena radius 4200):

| preset | open | median | best room | connected |
|---|---|---|---|---|
| Menger Labyrinth | 31% | 119 u (8.5× ship) | 497 u | 100% |
| Bulb Reef | 29% | 142 u | 629 u | 100% |
| Mandelbrot Sandwich | 29% | 380 u | 660 u | 100% |
| Menger Open Grid | 43% | 100 u | 380 u | 100% |
| Kleinian Caverns | 38% | 96 u | 264 u | 100% |
| Mandelbox Warrens | 30% | 93 u | 255 u | 97% |
| Sierpinski Vaults | 50% | 75 u | 520 u | 95% |

**Mandelbrot Sandwich** is the one that most belongs to LSS specifically: the
2D set's exterior distance estimate extruded between a floor and a ceiling, so
the canyon walls are the actual coastline of the Mandelbrot set. It is the same
shape as the existing sandwich terrain (`SANDWICH_TERRAIN_GUIDE.md`) with a
fractal outline instead of ridged noise, and it has by far the widest lanes
(median 380 u = 27× ship), which suits LSS's flight speeds.

## Integration path

Collision already has the right shape. LSS dispatches to
`obj.collideEntity(pos, velocity, radius, entity)` for everything in
`game.dynamicObjects` (`index-working.html:26704`). The lab's `collideShip` is
that function: one `mapJS` call, one gradient, push out, kill inbound velocity.
An arena object implementing `collideEntity` against the SDF drops straight in,
whether the visuals come from the field or the bake — and SDF collision stays
exact regardless of bake resolution, so it is worth keeping even once the mesh
is what renders.

Open questions before this is a game mode rather than a lab:

- Sharp-feature bake (see above).
- Streaming. A tiled field is endless; the bake currently covers one arena
  sphere in one go. Chunked bakes on the existing marching-cubes worker would
  match how the terrain already streams.
- Lighting. The lab uses a headlight because a directional sun means nothing
  inside a cave. LSS's weather system owns light intensities and writes on
  change, so a cave zone needs the sentinel pattern described in the
  `lss-visual-iteration` skill, not a raw multiply.
- Whether AO should come from the bake (vertex-baked, free at runtime) — the
  earlier GTAO analysis said screen-space AO is not worth its cost in this
  renderer, but a fractal cave is exactly the geometry that needs occlusion to
  read. Baking it into vertex colours at bake time sidesteps that entirely.

## Using the lab

Open `LSS/fractal_lab.html`. Click to fly (WASD, Space/C, Shift boost).

- **PROBE ARENA** scores the current field as a map.
- **R** spawns in the largest room, facing the arena centre.
- **COST VIEW** shows march steps per pixel — green cheap, red expensive. The
  only honest way to see where the frame is going before committing a shape.
- **BAKE MESH** converts the field to triangles; **VIEW** toggles field/mesh;
  **EXPORT OBJ** writes the geometry out.
- **EXPORT** writes the parameter set plus its probe score as JSON.

Framerate numbers from the sandbox are meaningless — it runs SwiftShader
(software GL) at roughly 25–45 fps for a 480×300 view. Everything visual and
every probe number in this document is real; the fps readout needs a machine
with a GPU.

---

# Aiming at the concept art

`LSS/concept/*.png` sets four arena archetypes. Read against what the lab
produces, the gap is not fractals — it is **composition**.

Every concept image has a deliberate scale hierarchy: one colossal landmark
form, mid-scale platforms and ledges, then fine greebling; stacked decks with
openings between them; man-made bridges; and emissive filigree localised to
the fractal boundary. The lab's `tile` knob does the opposite — it makes the
same structure everywhere, which is why its output reads as corridors rather
than as a place.

## Why image 1 (Mandelbrot Wall) first, for LSS specifically

- **Decomposes onto existing systems.** Floor and ceiling are sandwich
  terrain. Mid-ground ledges and bridges are instanced structures with
  registered colliders, which is what hub city already does.
- **Survives VR and mobile.** The VR path returns before the post chain, so
  anything leaning on a fullscreen raymarch is desktop-only. Image 3 is the
  most raymarch-dependent of the four, and Mandelbulb bulbs are the worst case
  to bake to a sane triangle count.
- **Suits the flight speed.** Probe medians: Mandelbrot layouts 275-380 u
  (20-27x ship radius), Kleinian 96 u, cathedral corridors tighter still.
  Recursive architecture at LSS speeds is a wall you hit.
- **Combat readability.** Dark mass with emissive accents only. Images 2 and 4
  put high-frequency detail across the whole frame, which is where enemy ships
  and tracers disappear.

Note the fractal cliff is built as GEOMETRY — collidable field, bakeable to
triangles — not as a painted shell. The existing `wallPattern` shader would be
the cheap way to fake the far backdrop, and it is deliberately not used inside
the playable volume.

## Two findings from building it

**The probe's score does not fit this archetype.** Swept across world scale,
interior openness, shell thickness, wall depth and iteration count, the wall
measures 87-97% open at every setting, and the scoring function zeroes all of
it. That is not a tuning failure: a 2D fractal curve extruded along one axis is
a *surface*, so it cannot fill volume. Image 1 genuinely is a large open void
with a colossal fractal wall on one side.

The metric was designed for volume-filling cave arenas and needs a companion
for open arenas — cover density and wall surface area within engagement range,
rather than open volume fraction. Until that exists, treat the probe's verdict
on `Mandelbrot Wall` as not applicable rather than as a failing grade.

**The interior constant is the real knob.** Inside the set the escape-time
estimate is meaningless, so interior points get a flat value. Its magnitude
decides whether the bulbs open up as caverns or fill in as rock (in carved mode
the field is `abs(d) - thickness`), and it also caps the march step inside a
bulb. `inner` is that parameter; it trades interior openness against steps
spent crossing one.

## Still missing before this looks like the art

1. **Scale hierarchy** — compose the field as `min()` of several fractals at
   very different scales instead of one, so there is a landmark, a mid scale
   and greebling.
2. **Bridges and catwalks** — thin flat spans are what SDFs are worst at and
   instanced meshes are best at. The probe already builds a room graph; it can
   path between rooms and lay bridges along those routes.
3. **Value structure** — the art is near-black mass with emissive as the only
   bright thing. The lab's current output is mid-dark everywhere, which is the
   same mistake the hub city made before its palette pass.
4. **Vertical framing** — the wall wants the camera flying *along* its face at
   a standoff, which is a spawn/route question, not a shader one.

Ledges are in (`deckSpacing` / `deckThick` / `ledgeReach`): periodic horizontal
slabs intersected with a band around the fractal surface, so they cling to the
coastline instead of spanning the void.

---

# The saved cavern: Menger Lace (2026-07-31)

`concept/lss_fractal_cavern_1785553884876.json` — Menger, carved, **iters 5,
thickness 1**, tile 2 (4000 u cells), worldScale 2000, shipR 8. Registered in
the lab as the **`Menger Lace Cavern`** preset; probe re-verified from a clean
load.

What thickness 1 actually is: the iters-5 solid is nothing but ~16 u struts,
so a ±1 u crust turns every strut into a hollow tube. The arena is lace, not
rock — vast blue lattice halls with purple crease-glow and mauve fog, and up
close the small struts read as floating hollow shells. CPU re-renders of the
exact field (`mapJS` ported to numpy, validated to 3e-5 u against the live
lab; shading approximated from the GLSL):
`menger_lace_view1_bestroom.png` · `menger_lace_view2_center.png` ·
`menger_lace_view3_lattice.png`.

Probe at grid 44, ship radius 8, arena radius 4200 — with a thickness sweep,
since thickness is the one knob the shipping decision turns on:

| variant | open | median | best room | connected |
|---|---|---|---|---|
| **as saved (t=1)** | **58%** | **120 u (15× ship)** | **570 u** | **100%** |
| t=1 at grid 64 | 57% | 66 u (grid-relative) | 600 u | 100% |
| t=8 | 50% | 113 u | 563 u | 100% |
| t=16 | 48% | 108 u | 555 u | 100% |
| t=24 | 48% | 100 u | 547 u | 100% |
| t=30 | 44% | 94 u | 541 u | 100% |

It beats every arena in the sweep table above on open volume while keeping
100% connectivity. The reason is iters 5 vs the Labyrinth's iters 4: one more
subdivision drills a much richer passage lattice (44% vs 31% open at the same
t=30). The grid-64 row is the convergence check — the openness is real, not a
sampling artifact (the median falls at finer grids because median clearance is
measured per open cell; compare medians only at matched grid).

## Findings that matter before this ships

1. **Raymarch-only as saved.** A 2 u wall cannot be reconstructed by surface
   nets at any sane grid — reconstruction needs the cell size below about the
   wall thickness, and 128³ over this arena is 66 u cells. So the t=1 look is
   the desktop raymarch path only; VR/mobile (which return before the post
   chain / can't afford a fullscreen march) need the fattened variant, t≈24-30,
   which bakes fine and still probes 44-48% open / 100% connected. Same field,
   per-tier thickness — the two variants can coexist and collision stays exact
   on both (SDF collision is bake-independent).
2. **Collision margins at t=1.** The lab's discrete center test stops a
   crossing when `map < shipR`, and the solid band a crossing ship sees is
   ~2·(thickness + shipR) ≈ 18 u. Per-frame travel beyond that tunnels
   straight through: ≳1100 u/s at 60 fps, ≳550 u/s at 30 fps. Dash speeds on a
   30 fps tier will clip through lace walls — those tiers want swept collision
   or the fat variant (which also fixes it: t=30 gives a ~76 u band).
3. **Probe blind spot, checked and cleared.** 2 u walls are far below the
   191 u probe cells, so in principle the flood fill could count space behind
   a sub-voxel wall as connected. Two reasons it doesn't lie here: the Menger
   complement (the tunnel system) is genuinely one connected component, and
   the sealed strut interiors — hollow tubes behind the crust — read ≤ ~7 u
   clearance < shipR 8, so they are excluded from "open" before the flood
   fill ever sees them. At shipR ≤ 6 they would start to leak in; keep shipR
   at 8+ when probing lace variants.
4. **`edgeGlow` is inert on Menger.** `deMenger` sets `gEsc = 0`, and both
   escape-driven terms (the depth tint and the coastline filigree) only light
   escape-time families. The saved `edgeGlow: 3.1` does nothing — the look is
   entirely trapGain 4.05 + glow 1.46 + fog 6.4 into the mauve `#754871`.
   Same for the saved `scale`/`power`/`minR`/`fixR`/offsets: inert leftovers,
   dropped from the preset entry.
5. **Decks are family-6 only.** The saved `deckSpacing: 700` is inert here —
   the deck/ledge feature lives inside the `family == 6` branch of `map()`.
   If the cavern wants catwalks, lifting decks out to all families is a small
   lab change (add to the still-missing list).
