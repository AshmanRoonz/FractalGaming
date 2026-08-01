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
