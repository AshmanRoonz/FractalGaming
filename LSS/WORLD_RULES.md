# WORLD RULES — a procedural Earth for Last Ship Sailing

Derived by reading real satellite imagery and street maps at matched zoom ladders
(z8 → z18) across ~70 sites, using `LSS/_refsheet.html`. Every rule cites the plate
that produced it. Status tags: **[IN]** implemented in `world_lab.html`,
**[PART]** partially, **[TODO]** derived but not yet built.

The corpus is the deliverable. The lab is the proof that the corpus runs.

---

## A. SCALE LAW & METHOD

The two findings everything else hangs off.

**A1 [IN]** Terrain is statistically self-similar. The Grand Canyon's branching is the
same shape at 126 km, 32 km, 8 km and 2 km (canyon ladder z9→z15). One rule, every scale.

**A2 [IN]** Cities are not. Tokyo shows nothing new between z10 and z14, then everything
at once (tokyo ladder). Cities are self-*scaling*, not self-*similar*.

**A3 [IN]** The urban scale ladder has a near-constant ratio of ~4, with a different
geometry on every rung: freeway cell 6–8 km → arterial 1600 m → collector 400 m →
block 100×280 m → parcel 15×40 m → building 10×20 m (LA ladder z10→z18).

**A4 [IN]** Therefore: generate terrain with a recursive process, cities with a
fixed-depth hierarchy. Never fbm a city; never build terrain from a rung ladder.

**A5 [IN]** Self-similarity TERMINATES. Below ~100 m the canyon goes smooth and the
detail becomes vegetation stipple; below ~300 m the Alpine ridge becomes scree and
crevasse stripes. Geometry stops; texture starts.

**A6 [IN]** The cutoff is a length, not a level-count. Fixing the octave count instead
makes the cutoff move with the feature size, which is why distant fbm terrain looks
"noisy" and near fbm terrain looks "smooth" — backwards from reality.

**A7 [IN]** Texture has an LOD too. A periodic signal below one pixel does not average
away, it moirés. Fade every fine term against camera distance.

**A8 [IN]** Measure a field before you threshold it. `sstep(0.62, 0.06, vp)` reads as
"a narrow channel" and was true over most of the map; the first build flooded 45% of
all land. Print quantiles first.

**A9 [IN]** Validate against Earth's own numbers: ocean ~71% of surface, rivers+lakes
~4% of land, forest ~31% of land, cropland ~11%. If your world misses these by 5×, it
will read wrong no matter how good the shader is.

**A10 [IN]** A world that is a pure function can be *queried*. "Where is the nearest
desert?" is a 2 ms scan. You cannot ask a tile stream that question at all.

**A11 [IN]** Use an integer hash on the CPU (Math.imul). A `fract(sin())` hash drifts
between platforms; a coastline that moves between two players' machines is not a world.

**A12 [IN]** Use a cheap float hash on the GPU. Colour does not have to be
bit-reproducible, and a sin-hash costs a transcendental per noise corner.

**A13 [IN]** Split responsibilities: CPU owns geometry (vertices, collision, placement),
GPU owns colour. Then the two can never disagree about where the ground is.

**A14 [PART]** Anything a player can collide with must exist on the CPU. Anything they
can only look at should exist only on the GPU.

**A15 [IN]** Determinism is a multiplayer requirement, not a nicety: `cityAt(i,j)` must
return the identical city on every peer from the seed alone.

**A16 [IN]** Cache by cell key, never by camera. A cache keyed on view state rebuilds
when you turn around.

**A17 [TODO]** Every stochastic choice should be reachable from one seed plus a
coordinate — no sequential RNG state that depends on visit order, or two peers who
explore in different orders diverge.

**A18 [IN]** Amortise generation: a per-frame build budget, nearest-first. A 300 ms
stall on arrival is worse than 20 frames of coarse ground.

**A19 [IN]** Prefer analytic erosion over simulated. A simulation needs neighbours,
neighbours need a grid, a grid ends the "infinite pure function" property.

**A20 [PART]** Keep every rule a named, switchable term. A monolithic noise expression
cannot be art-directed, and art direction is the entire job after the first week.

---

## B. TECTONICS & LARGE LANDFORM

**B1 [IN]** Mountains come in LINEAR BELTS, never in blobs (Alps z9, Zagros, Andes).
Use a ridge function at continental scale to place the belt, then fill it.

**B2 [IN]** A belt has a sharp MOUNTAIN FRONT on at least one side — the Alps z9 plate
goes from 3000 m to a dead-flat plain in under 5 km.

**B3 [IN]** Structural grain is what makes terrain read as a place. Zagros = parallel
folds; Appalachians = zigzag folds; Namib = wind-aligned dunes; Norway = fracture-aligned
fjords. All four are anisotropy, not extra octaves.

**B4 [IN]** Grain direction varies slowly (~400 km provinces) so neighbouring provinces
meet at believable seams.

**B5 [IN]** Anisotropy above ~2× reads as corrugated iron, not geology. 1.6× is the
ceiling with axis-aligned value noise.

**B6 [IN]** Domain-warp before sampling. Warping destroys the lattice regularity that
squashing exposes, and bends ridge lines the way real strike lines bend.

**B7 [PART]** Fold belts ZIGZAG where the folds plunge (Appalachian plate). A pure
parallel field misses the hairpins that make that landscape recognisable.

**B8 [TODO]** Rivers cut THROUGH ridges at water gaps rather than going around — the
drainage is older than the fold. This is the single most distinctive Appalachian
feature and cannot emerge from a drainage field that follows the current surface.

**B9 [IN]** Plateaux are preserved FLAT SURFACES that drainage cuts into (Grand Canyon
z11). They are not the tops of peaks. Clamp, do not amplify.

**B10 [IN]** Flood-basalt provinces quantise elevation into benches (Deccan plate).
Soft-stair the height field; do not smooth it.

**B11 [IN]** Stratovolcanoes are POINT-symmetric with a summit crater and radial
gullies (Fuji plate). No ridge field can produce one; they need their own generator.

**B12 [IN]** Volcanoes are rare and are landmarks. One per ~145 km cell, 30% of cells.

**B13 [TODO]** Calderas are craters an order of magnitude wider than the cone and often
hold a lake.

**B14 [TODO]** Cinder-cone fields: dozens of small cones (100–300 m) clustered around a
rift line, each with its own crater.

**B15 [IN]** Inselbergs: isolated resistant monoliths standing on a flat plain (Uluru
plate). A hash-placed dome with steep sides and no foothills.

**B16 [TODO]** Mesas and buttes are inselbergs with a flat cap — same rule, plus a
hard upper surface.

**B17 [IN]** Continental shelf then abyss. The sea floor is not a single depth; the
shelf ramp is why coastal water reads shallow.

**B18 [TODO]** Rift valleys: a linear graben with parallel scarps and a chain of lakes
on the floor.

**B19 [TODO]** Karst towers: hundreds of isolated steep cones on a flat plain (Guilin
plate). A high-density inselberg field with a shared base level.

**B20 [PART]** Terrain provinces should tile the world with HARD-ish boundaries, not
crossfade everything. Real geology has contacts.

**B21 [IN]** Elevation must reach Earth's distribution: land median a few hundred
metres, p95 ~1400 m, rare peaks 3–4 km. Uniform relief everywhere reads as a toy.

**B22 [TODO]** Ocean floor has its own structure: mid-ocean ridges, trenches, seamounts,
abyssal plains. Invisible to a flyer, but it sets the coast when sea level moves.

**B23 [TODO]** Islands come in three flavours — continental fragments (Stockholm),
volcanic (Hawaii), and coral (Maldives) — and each has a different coast rule.

**B24 [IN]** Mountain height should fall off toward the belt's ends, not stop.

**B25 [TODO]** Foreland basins: the flat ground on the outside of a mountain front is
depressed by the range's own weight and fills with sediment — the flattest ground on
Earth is next to the steepest.

**B26 [IN]** Erodibility varies by province and is a first-class parameter (see C).

**B27 [TODO]** Fault scarps: a straight, steep, one-sided step across otherwise
continuous terrain.

**B28 [TODO]** Dip slopes vs scarp slopes — a cuesta is gentle on one side and cliffed
on the other. Symmetric ridges are a tell.

---

## C. EROSION & DRAINAGE

**C1 [IN]** Real terrain is broad flat interfluves cut by narrow sharp incisions. Plain
fbm gives rolling lumps, which is the opposite shape.

**C2 [IN]** The weighted ridged multifractal is the cheapest fix: multiply each octave
by how high the previous one was, so detail only lands on ground already raised, and
valley floors stay flat. That one weight term is "erosion" with no simulation.

**C3 [IN]** Drainage is hierarchical: trunk, tributary, sub-tributary, rill. The weight
term produces the hierarchy for free — sub-branches only exist on the parent's flanks.

**C4 [PART]** Tributaries join pointing DOWNSTREAM, at 45–75°. Never at 90°, never
upstream.

**C5 [IN]** Drainage DENSITY is set by erodibility, not by rainfall alone. Badlands and
Loess plates have a gully every 40 m; granite next door has one valley per 4 km.

**C6 [IN]** Make erodibility a regional field and scale every drainage frequency by it.
It is the cheapest "somewhere else" lever in the generator.

**C7 [IN]** Valley cross-section changes downstream: V near the head, flat-floored
downstream. Carve depth should scale with distance from the divide.

**C8 [TODO]** Glacial valleys are U-shaped with steep walls and a flat floor, and they
TRUNCATE spurs. Fluvial valleys have interlocking spurs.

**C9 [TODO]** Hanging valleys: tributaries to a glaciated trunk enter far above its
floor, with a waterfall.

**C10 [IN]** Cirques: bowl-shaped heads at the top of glaciated valleys.

**C11 [IN]** Glaciated terrain has DERANGED drainage — basins and lakes, no tree
(Finland plate). It needs its own province and its own generator.

**C12 [IN]** Glacial lakes are elongated along the ice-flow direction and all parallel.

**C13 [TODO]** Drumlins and eskers: streamlined hills and sinuous ridges, both aligned
with the same flow direction.

**C14 [TODO]** Moraines: arcuate ridges marking where ice stopped; often dam a lake.

**C15 [IN]** Talus and scree fan out below any cliff, and are a different colour and
texture from the rock above.

**C16 [TODO]** Alluvial fans at range fronts: a cone of pale debris with its apex at the
canyon mouth, spreading into the basin (Iran plate). Extremely common and never
generated.

**C17 [TODO]** Bajada: coalesced fans forming a continuous apron along the whole front.

**C18 [IN]** Badlands are terrain whose fractal cutoff is much finer than the
surrounding rock — the same rule with a different cutoff length.

**C19 [TODO]** Soil creep rounds hilltops in humid climates; arid hills keep angular
crests. Same relief, different curvature.

**C20 [TODO]** Slope has a MAXIMUM — the angle of repose (~34° for loose material).
Terrain that exceeds it everywhere looks like a sawtooth, not a mountain.

**C21 [TODO]** Knickpoints: a sudden steepening in a river profile, migrating upstream;
waterfalls live there.

**C22 [PART]** Valleys widen downstream; the floodplain is wider than the channel by
10–100×.

**C23 [TODO]** Terraces: abandoned floodplains stranded above the current one, as flat
steps along a valley.

**C24 [TODO]** Wind erosion in deserts is direction-specific: yardangs and deflation
hollows all align with the prevailing wind.

**C25 [IN]** Below the geometry cutoff, erosion shows as texture: rills, stipple,
pavement, varnish. Paint it, do not model it.

**C26 [TODO]** Coastal cliffs retreat parallel to themselves, leaving a flat wave-cut
platform at the base — a hard horizontal notch at sea level.

**C27 [TODO]** Mass-wasting scars: landslide scoops with a debris tongue below, common
on any oversteepened slope.

**C28 [IN]** The plateau/peak ratio is a province parameter: some ranges are all summit
(Alps), some are all plateau with canyons (Colorado).

---

## D. HYDROLOGY, COAST & ICE

**D1 [IN]** Water is an ELEVATION THRESHOLD, not a painted shape. Flood a drainage
network and you get every coast type for free.

**D2 [IN]** Sea level is therefore a *generator*, not a constant. One slider produces
rias, fjords, skerries, archipelagos and estuaries out of the same terrain.

**D3 [IN]** Coastline type follows from the terrain type it cuts. Steep + incised →
fjord/ria (Norway, Sydney). Low + depositional → barrier islands and lagoons (Outer
Banks). Flat + tidal → mudflats (Wadden). Drowned karst → Ha Long.

**D4 [IN]** Coastlines are self-similar over at least 1.5 decades (Bergen ladder z8→z12):
islands have bays, and those bays have islands.

**D5 [IN]** Coastlines are ANISOTROPIC fractals. The Bergen fjords follow two fracture
trends; an isotropic coast reads as a blob no matter its dimension.

**D6 [IN]** Rivers ride a LOCAL base level, not the sea. A single global water plane
puts a flat puddle in every valley at every altitude.

**D7 [IN]** Water level must FALL AWAY from the channel, not rise. The sign error
flooded 45% of land in the first build.

**D8 [IN]** Water surface meshes must run UNDER the shore, not stop at the last fully
submerged quad — otherwise the waterline is a stair-step at the vertex pitch.

**D9 [PART]** Rivers widen downstream and their sinuosity rises as slope falls
(Mississippi plate).

**D10 [TODO]** Meanders migrate and leave oxbow lakes as crescents, plus scroll-bar
arcs as ground texture across the whole floodplain.

**D11 [TODO]** Braided rivers where sediment load is high and slope is steep (Iceland
plate): many shifting shallow channels in a wide pale bed, not one line.

**D12 [TODO]** Anastomosing rivers in low-gradient forest (Amazon plate): several
stable channels with islands between.

**D13 [TODO]** Deltas: the channel splits into distributaries that build a fan into the
sea, with a razor boundary to the desert beside it (Nile plate).

**D14 [TODO]** Tidal creek networks in mangrove and marsh branch TOWARD the sea, the
opposite direction to a drainage tree (Sundarbans plate).

**D15 [TODO]** Estuaries are funnel-shaped and hold mud banks; the water colour is
brown, not blue.

**D16 [IN]** Lakes form in basins, which means the generator has to be able to make a
closed basin — a pure downhill field never will.

**D17 [TODO]** Endorheic basins: no outlet, so the lake is salty and its shoreline is
ringed with evaporite flats (Danakil, Atacama plates).

**D18 [TODO]** Salt pans are pure white, dead flat, and polygonal at close range.

**D19 [TODO]** Reservoirs are lakes with ONE straight edge — the dam (Hoover plate).
Everything else about their shape is the drowned dendritic valley.

**D20 [TODO]** A reservoir's shoreline has a bathtub ring where the level has dropped.

**D21 [IN]** Water colour is depth. Shallow reads turquoise, deep reads near-black-blue,
and the gradient is the most recognisable thing about a coast from the air.

**D22 [TODO]** Coral reefs: a bright turquoise shallow rim around a deeper lagoon, with
low sand islands on the rim (Maldives plate).

**D23 [TODO]** Surf line: a white band on the windward shore, wider on shallow slopes,
absent on cliffs.

**D24 [TODO]** Beaches only form on gentle shores with sediment; cliffed coasts have
none. A beach ring round every island is a tell.

**D25 [TODO]** Spits and hooks: longshore drift extends a sand bar downdrift and curls
the end (Cape Cod plate).

**D26 [TODO]** Barrier islands run parallel to the coast with a lagoon behind and
tidal inlets through (Outer Banks plate).

**D27 [TODO]** Tidal flats: exposed at low water, cut by a dendritic drainage of their
own, colour between water and land (Wadden plate).

**D28 [IN]** Snow line is a CONTOUR, moves with latitude and aspect, and is hard-edged.

**D29 [TODO]** Snow does not hold on a slope above ~50°; steep faces stay dark rock
even above the snow line, which is what makes big mountains read as big.

**D30 [TODO]** Glaciers flow DOWN VALLEYS, are white, and carry dark medial moraine
stripes where two merge (Alps ladder z13–z15).

**D31 [TODO]** Crevasse fields are transverse stripes with a fixed wavelength — a
non-fractal texture from ice physics.

**D32 [TODO]** Proglacial lakes are milky turquoise from rock flour, not blue.

**D33 [TODO]** Sea ice and icebergs at high latitude.

**D34 [PART]** Rivers should carry their valley's colour: silt-laden rivers are brown,
mountain rivers are clear.

**D35 [TODO]** Waterfalls at knickpoints and at hanging valleys.

**D36 [TODO]** Springs and oases: water in an arid province is a POINT, and the green
around it is a sharp disc (Sahara plate).

---

## E. CLIMATE, BIOME & GROUND TEXTURE

**E1 [IN]** Moisture drives every biome downstream, so it needs the full 0–1 range.
A moisture field clustered around 0.5 gives one planet-wide colour.

**E2 [IN]** Climate zones are large (~200 km) with FRONTS, not gradients.

**E3 [PART]** Latitude bands: equatorial wet, ~25° dry, temperate wet, polar dry. Most
of Earth's biome layout is this one pattern.

**E4 [TODO]** Rain shadow: the lee side of a mountain belt is dry and the windward side
is wet, with the divide as the boundary. This single rule explains more real biome
boundaries than any other.

**E5 [TODO]** Continentality: inland is drier and more extreme than coastal at the same
latitude.

**E6 [IN]** Valleys are wetter than their divides — rivers are green in a desert.

**E7 [IN]** Altitude reduces temperature and therefore biome: tree line, then snow line.

**E8 [IN]** Tree line is a contour modified by aspect and moisture.

**E9 [IN]** Forests have EDGES. A forest that fades out through a gradient looks
airbrushed; real woods end.

**E10 [IN]** Cleared-vs-wooded is ONE decision, not two blends. Multiplying farmland by
(1−forest) and forest by (1−farmland) leaves a mush of both everywhere.

**E11 [IN]** Slope gates vegetation: cliffs are bare whatever the climate says.

**E12 [IN]** Rock colour bands follow ELEVATION, because strata are horizontal. This is
why the Grand Canyon is striped and a noise-coloured cliff never is.

**E13 [IN]** Deserts are not one surface. Erg (dune sea), reg (gravel plain) and hamada
(rock pavement) are separate provinces with hard borders, all three inside 30 km on
the Namib plate.

**E14 [IN]** Dunes are wind-ruled: one direction, one wavelength, over the whole field.

**E15 [TODO]** Dune TYPE varies with wind regime and sand supply: barchan crescents
(sparse sand, one wind), linear (two winds), star (variable). Each has a distinct
plan shape.

**E16 [IN]** Dune ripples need a noise-jittered phase or the crests come out a perfect
comb.

**E17 [TODO]** Desert varnish darkens old rock surfaces; young lava is black, old is
rust.

**E18 [TODO]** Playa: flat, pale, cracked, sits at the lowest point of a closed basin.

**E19 [TODO]** Loess: pale, soft, and shredded into knife-edge gullies (Loess plate).

**E20 [TODO]** Permafrost polygon ground at high latitude — a geometric net at ~20 m.

**E21 [TODO]** Tundra: no trees, mottled, thousands of small ponds.

**E22 [TODO]** Savanna: grass matrix with scattered individual tree crowns, dark dots on
pale ground.

**E23 [TODO]** Rainforest reads as a uniform dark-green cauliflower texture with no
visible ground and a few emergent crowns.

**E24 [TODO]** Boreal forest is dark, fine-grained, and interrupted by bogs and burn
scars with hard polygon edges.

**E25 [TODO]** Burn scars and clear-cuts: geometric or lobate patches of a completely
different colour inside a forest. Extremely common and instantly readable.

**E26 [TODO]** Mangrove: dark green fringing every tidal channel, only in the tropics.

**E27 [IN]** Beach sand only on flat shores; a sand band on a cliff is wrong.

**E28 [IN]** At a low sun, SHADOW is the dominant signal from the air, not albedo.

**E29 [PART]** Aspect matters: north-facing slopes (northern hemisphere) hold more snow
and denser forest than south-facing. Real satellite images are visibly asymmetric.

**E30 [TODO]** Seasonal state should be a single global parameter — same world, green or
brown or white — because it multiplies content for one slider.

**E31 [IN]** Ground micro-texture must fade with distance or it moirés.

**E32 [TODO]** Vegetation should tint the terrain colour AND add geometry (billboards,
instanced trees) with a crossover distance, not one or the other.

---

## F. HUMAN LAND USE (outside the city)

**F1 [IN]** Field pattern is the strongest large-scale human texture on Earth, and it is
a tiling rule plus a per-cell crop colour.

**F2 [IN]** What makes farmland read is that ADJACENT CELLS ARE DIFFERENT CROPS AT
DIFFERENT STAGES. The contrast is between neighbours, not within a field.

**F3 [IN]** Field boundaries are DARK LINES — hedgerow, track, ditch, treeline. The line
is the signal, more than the fill.

**F4 [IN]** Field size is a regional constant (70–430 m) with hard province boundaries.

**F5 [IN]** Field orientation is a regional constant too, and it is usually NOT aligned
to north.

**F6 [IN]** Strip fields: some parcels split the long way into 2–6 ribbons, each its own
crop (Tuscany, bocage). This is what breaks the graph-paper look.

**F7 [IN]** Centre-pivot circles where irrigation is mechanised and water is scarce
(Kansas plate) — a circle inscribed in a square, with the corners a different colour.

**F8 [TODO]** Polder: reclaimed land is a ruler-straight ditch lattice with NO organic
element at all, and it meets the un-reclaimed land at a dead-straight dyke (Dutch plate).

**F9 [TODO]** Terraces follow CONTOURS on slopes (Bali, Tuscany). Rectilinear fields on
a hillside are a tell.

**F10 [TODO]** Bocage: irregular polygonal cells bounded by thick hedgerows, with a
village node every 1–2 km (Normandy plate).

**F11 [TODO]** Section-grid farmland (US/Canada): a 1-mile lattice of roads with the
farmstead at a corner and a shelterbelt beside it.

**F12 [TODO]** Irrigated land ends at a RAZOR EDGE against desert — no gradient at all
(Nile plate). Distance-to-water threshold, not a blend.

**F13 [TODO]** Greenhouses form a continuous white plastic landscape that is neither
field nor city (Almería plate) — its own land-use class.

**F14 [TODO]** Orchards and vineyards are a regular dot/row texture at ~5 m spacing,
visibly different from a crop field at the same scale.

**F15 [TODO]** Rice paddies are water-filled and mirror the sky — they change colour
with the season more than any other land use.

**F16 [TODO]** Pasture is unploughed: no lines, irregular boundaries, animal tracks.

**F17 [TODO]** Farm tracks connect field corners to the nearest road, and farmsteads sit
on them, not in the middle of fields.

**F18 [TODO]** Villages sit at road junctions and at the heads of valleys, spaced by the
distance a cart could travel — ~4–8 km in old country, further in new.

**F19 [TODO]** Forestry plantations are rectangles with hard edges and uniform texture,
and different blocks are different ages and therefore different tones.

**F20 [TODO]** Quarries and open-pit mines: terraced concentric benches, a spoil heap
beside them, and a haul road spiralling in (Chuquicamata plate).

**F21 [TODO]** Tailings ponds are geometric, flat and an unnatural colour.

**F22 [TODO]** Solar and wind farms: geometric arrays with a service-track lattice.

**F23 [TODO]** Transmission lines run straight across terrain regardless of relief, with
a cleared corridor — one of the few dead-straight lines in wild country.

**F24 [TODO]** Cemeteries and golf courses are green voids with a distinctive internal
texture, and they sit inside cities where land is expensive, which is the tell.

**F25 [TODO]** Land use is ZONED, not scattered: one province is arable, the next is
pasture, the next is forestry. Randomising per cell destroys the read.

---

## G. CITY SITE & OVERALL FORM

**G1 [IN]** SITE BEFORE PLAN. A city is placed by terrain before it is planned by
people: sheltered harbour, river confluence, pass, coastal plain, ford.

**G2 [IN]** Score candidate sites against the world function and reject the ones the
ground refuses. Cities then land on estuaries and valley mouths instead of Poisson dots.

**G3 [IN]** The grid stops at the SLOPE BREAK (LA z10). Flat ground gets city; the
hills next to it get curvilinear roads or nothing.

**G4 [IN]** City sizes follow a power law: a handful of metropolises, many towns, a
swarm of villages. Uniform city sizes are the fastest way to kill a world map.

**G5 [PART]** City spacing follows the same law — big cities are far apart and each is
ringed by satellites (central-place pattern).

**G6 [IN]** Footprints are NOT circles. Water and slope cut them, which is what gives
Manhattan, Venice, Hong Kong and Rio their silhouettes.

**G7 [IN]** A coastal city on a narrow shelf becomes LINEAR whatever its plan wanted to
be (Hong Kong, Dubai, every Norwegian town).

**G8 [IN]** The painted extent and the built extent must be the same shape, derived from
the same function, or the city's ground patch will not match its buildings.

**G9 [TODO]** Cities on a river straddle it, with the older half on one bank and a
bridgehead district on the other.

**G10 [TODO]** Port cities turn their waterfront into infrastructure, not housing — the
best land goes to quays.

**G11 [TODO]** The historic core is SMALL, off-centre, and has a completely different
grain from everything around it (Barcelona plate: medieval core meets Cerdà grid along
a LINE, not a gradient).

**G12 [TODO]** Era rings: a city grows in rings, each with the street pattern of its
period — medieval core, 19th-c grid, 20th-c suburb, modern superblock — and the
boundaries between them are visible from the air.

**G13 [TODO]** Old walls leave a RING ROAD or a ring park where they were demolished
(Vienna, Milan). The trace outlives the wall.

**G14 [IN]** Density falls off from the core; so should detail. Sorting blocks by
distance and spending a fixed instance budget is both cheaper and more accurate than
uniform detail.

**G15 [IN]** Height falls off hard from the core. The LA z13 plate has exactly one
shadow cluster in an 8 km frame.

**G16 [TODO]** Some cities have NO single core — São Paulo has tower clusters scattered
across the whole basin. Make "monocentric vs polycentric" a plan parameter.

**G17 [IN]** Green is STRUCTURAL, not decoration: Central Park is a hard-edged
rectangular void inside the densest fabric.

**G18 [TODO]** Linear green follows rivers, ravines and old rail — Toronto's ravines and
São Paulo's valleys stay green while the ridges get built.

**G19 [PART]** Grain boundaries are HARD. Never crossfade two district types.

**G20 [TODO]** Informal settlement takes the land nobody else wants: steep slopes,
flood-prone ground, the edge of infrastructure. Very fine grain, no plan, tin roofs
(Rio, Dhaka, Lagos plates).

**G21 [TODO]** New towns are built all at once and read as one texture over a large
area, with green wedges left between (Shenzhen plate).

**G22 [TODO]** Modernist plans read as a DIAGRAM, not a city: discrete pods on an axis
with vast gaps (Brasília plate).

**G23 [TODO]** Airports sit 10–30 km out, on flat land, aligned to the prevailing wind,
with a motorway spur to the city.

**G24 [TODO]** Industry clusters along rail, water and the ring road — never in the core
and never uphill of the good housing.

**G25 [TODO]** Retail parks and big-box sit at motorway junctions with parking oceans
that are larger than the buildings (Las Vegas plate).

**G26 [TODO]** A city's roof-colour palette is regional and near-constant; the CITY
chooses it, not the building.

**G27 [IN]** Cities take their region's ground colour. Marrakesh is the colour of the
ground it stands on.

**G28 [TODO]** Reclaimed land is dead-straight where everything else is organic, and it
is always the newest and most geometric part of the city (Hong Kong, Tokyo Bay).

---

## H. STREET NETWORK

**H1 [IN]** Blocks are the FACES of the street graph, not the primitive. Generating
blocks first and separating them with gaps gives a diagram, not a place. (The LSS hub
city's own comment says "this city has no streets" — that is the single biggest gap.)

**H2 [IN]** Recursive subdivision gives the street hierarchy and the block sizes as the
same recursion seen from two sides.

**H3 [IN]** Street width is a function of DEPTH: arterial 40–60 m, collector 20–34 m,
local 12–20 m, alley 6–9 m (LA/Paris/Tokyo z16–z18).

**H4 [IN]** Recursion depth must come from AREA, not from a constant — a 12 km
metropolis and a 1 km town both have ~100 m blocks.

**H5 [IN]** Every grammar has a natural block size, and a superblock is bigger than all
of them. Split down to the grammar's own size first; the lanes you leave are real
streets. Skipping this rung produces 440 m podiums and 300 m sheds.

**H6 [IN]** 'rhythm' splitting (on a multiple of the block module) gives Manhattan and
Phoenix; 'even' gives superblocks; 'jitter' plus rotation gives the medina and Naples.

**H7 [TODO]** Arterials should be CONTINUOUS across the whole city; recursive
subdivision alone produces a hierarchy but not through-routes. Real cities are legible
because you can drive straight across them.

**H8 [TODO]** Radial cities need the subdivision done in POLAR space — concentric rings
and radial spokes (Amsterdam, Paris, Moscow plates).

**H9 [TODO]** A ring road at ~0.5–0.7 of the city radius, plus 5–9 radials punching out
to the next town (Paris, Moscow, Houston, Atlanta plates).

**H10 [TODO]** Motorways are a coarser, separate network laid OVER the arterial grid at
6–8 km spacing, with grade-separated interchanges (LA plate).

**H11 [TODO]** Interchanges are large, curved and unmistakable from the air; they are
among the biggest single human structures in any city.

**H12 [TODO]** Motorways cut the fabric diagonally and TRUNCATE blocks into triangles
where they cross (Chicago plate).

**H13 [TODO]** Rail does the same but harder, and leaves lens-shaped yards, viaducts and
a strip of industry on both sides.

**H14 [TODO]** Wedge and triangle blocks at oblique intersections are the tell of a
radial plan over an older fabric (Paris Opéra plate).

**H15 [TODO]** Boulevards are tree-lined; the tree rows read as two dark-green lines
flanking a pale one, and that is how you recognise Paris from 3 km up.

**H16 [TODO]** Cul-de-sac subdivisions: a curvilinear branching tree with dead ends,
inside a mile-square of arterials (Phoenix plate). Completely different topology from
a grid — a tree, not a lattice.

**H17 [TODO]** Roads follow CONTOURS on slopes, switchbacking where they must climb.
Straight roads up a hillside are a tell.

**H18 [TODO]** Bridges are rare and expensive, so the network funnels into them and
there is a traffic node at each end (Istanbul plate).

**H19 [TODO]** Causeways run dead straight across shallow water (Venice, Lagos plates).

**H20 [IN]** A street is a RIBBON, not a quad. Segment it and sample the terrain along
it, or an arterial cuts straight through every hill it crosses.

**H21 [IN]** Road meshes must be double-sided; a street rect's winding flips with its
yaw, so a single-sided road network renders as dashes.

**H22 [TODO]** Streets should be cut INTO the terrain (a graded corridor), not laid on
top of it.

**H23 [TODO]** Junction spacing is tighter in older fabric and looser in newer — block
size is the clearest dating evidence in any city.

**H24 [TODO]** Alleys split long blocks down the middle in North American grids and are
absent in European ones.

**H25 [TODO]** Dead ends and disconnections cluster at barriers: rail, water, motorway,
slope.

---

## I. BLOCK & PARCEL GRAMMAR

**I1 [IN]** Four grammars cover almost every plate: perimeter-with-courtyard,
tower-in-park, lot-filling fine grain, and detached parcel rows.

**I2 [IN]** Which grammar a block gets is decided by district, and district by distance
to core — because that is how the real ones sort.

**I3 [IN]** PERIMETER: buildings hug all four street faces, courtyard void in the
middle, and ONE CORNICE HEIGHT for the whole block. The uniform height is not a
simplification, it IS the look (Paris Opéra plate).

**I4 [IN]** Split each perimeter face into party-wall units so the roofline has a rhythm
instead of being one extruded slab.

**I5 [TODO]** Courtyards are not empty: they hold outbuildings, glass roofs and trees.

**I6 [TODO]** Corner buildings in a perimeter block are taller and more ornate — the
corner is the valuable address.

**I7 [TODO]** The Barcelona chamfer: cutting every corner at 45° creates an octagonal
block and a small plaza at every intersection. One rule, and the whole city is
recognisable.

**I8 [IN]** TOWER-IN-PARK: isolated towers on a podium with big setbacks, and the
LANDSCAPED GROUND between them is half the archetype.

**I9 [IN]** Number of towers should scale with block area, capped — not a flat random.

**I10 [IN]** Podium size has a real-world maximum (~120 m); beyond that it is a slab.

**I11 [IN]** FINE GRAIN: buildings fill their parcel edge to edge with a ~1 m gap, huge
footprint variance, low height variance (Tokyo Ginza plate).

**I12 [IN]** Sub-split the block into parcels and build each to its own boundary; do not
place buildings at random points inside a block.

**I13 [IN]** Leave a few empty lots — a perfectly full block reads as generated.

**I14 [IN]** DETACHED: house + front setback + back yard + driveway, very regular
rhythm. The RHYTHM is the signal, not the houses.

**I15 [IN]** A house is ~12 m wide whether the lot is 14 m or 80 m. Scaling the
footprint with the lot turns every outer suburb into flat plates.

**I16 [IN]** The building covers roughly a third of its parcel; the rest is yard.

**I17 [IN]** Lots grow toward the city edge — the real density gradient, and the cheap
one.

**I18 [IN]** INDUSTRIAL: big flat sheds with a long axis, a yard, and silos. From the
air these are the largest single roofs in any city.

**I19 [IN]** Sheds have a real-world maximum (~190 × 150 m).

**I20 [TODO]** Industrial yards hold container/trailer stacks — small bright rectangles
in rows, a very recognisable texture.

**I21 [TODO]** INFORMAL: no parcels, no setbacks, footprints of 4–10 m packed to ~80%
coverage, following contours on steep ground (Rio, Dhaka plates).

**I22 [TODO]** RETAIL/BIG-BOX: one large flat building at the back of a parking ocean,
with the parking bays as a striped texture (Las Vegas plate).

**I23 [TODO]** Parking is a land use in its own right and is often larger than the
buildings it serves. Leaving it out makes North American cities read as European.

**I24 [IN]** PARK: ~8% of blocks, with trees and paths, distributed rather than one blob.

**I25 [TODO]** Campus (university, hospital, government): large buildings on a private
internal circulation with no through streets — a hole in the street network.

**I26 [TODO]** Stadiums, arenas andmarkets are single landmark footprints an order of
magnitude bigger than their neighbours.

**I27 [TODO]** Religious buildings sit on a plaza and break the grain around them.

**I28 [TODO]** Block interiors in older fabric are full of accreted outbuildings; in
newer fabric they are empty.

**I29 [TODO]** Parcels are usually deeper than they are wide, with the narrow end on the
street — the burgage plot, and the reason old high streets have a fine street rhythm.

**I30 [PART]** Grammar should be able to vary WITHIN a district, weighted — a pure
district is as fake as a random one.

---

## J. BUILDING, ROOF & MATERIAL

**J1 [IN]** Roof colour is a REGIONAL CONSTANT with low variance: Paris zinc, Barcelona
and Naples terracotta, Tokyo and LA pale grey, Marrakesh ochre, Dubai sand-and-white.
Randomising roof colour per building is the fastest way to make a city look fake.

**J2 [IN]** Jitter within the palette must be small (±10%), and the palette is chosen
once per city.

**J3 [IN]** Building height follows a rank-size power law with a strong distance-to-core
term. One or two landmarks ≫ everything else.

**J4 [IN]** Silhouette archetypes are what make a skyline read: slab, setback ziggurat,
spire, twist, round. The LSS hub city learned this at v35.21 after two art-direction
passes called its skyline "a single rounded clump with no roofline rhythm".

**J5 [IN]** Silhouette variety costs INSTANCES, never DRAW CALLS, as long as every
variant lands in the same instanced buffer.

**J6 [IN]** Setbacks step in as they rise; the stepping ratio (~0.64) is consistent.

**J7 [IN]** Masts and antennas on tall roofs; they are half the silhouette.

**J8 [TODO]** Roof CLUTTER is what separates a real roof from a lid: HVAC boxes, water
tanks, cooling towers, lift overruns, solar arrays, dishes, skylights, rooftop gardens.
At z18 Manhattan and Tokyo are more clutter than roof.

**J9 [TODO]** Roof PITCH is regional: flat in hot-dry and modern, pitched in wet-cold,
and the pitch direction follows the ridge line of the block.

**J10 [TODO]** Mansard roofs read as a lighter band around the eaves (Paris plate).

**J11 [IN]** Windows are on WALLS ONLY; a roof with windows in it is the classic tell.

**J12 [IN]** Floor pitch ~3.3 m, bay pitch ~3.6 m. These two numbers set the apparent
scale of every building in the world.

**J13 [IN]** A floor-slab shadow line is what makes a box read as storeys.

**J14 [IN]** Use the WORLD normal to decide wall-vs-roof. `vNormal` is view-space, so
windows crawl over the roofs as you turn the camera.

**J15 [TODO]** Lit-window fraction should vary with time of day and with building use —
offices empty at night, housing does not.

**J16 [TODO]** Ground floors are different: taller, glazed, with awnings and signage.

**J17 [TODO]** Party walls are blind: a terrace has windows on two faces, not four.

**J18 [TODO]** Balconies on the courtyard face of housing; fire escapes on one gable.

**J19 [TODO]** Materials should follow era and use: masonry, curtain wall, precast panel,
corrugated metal, tin. Each has a different reflectance and a different noise.

**J20 [TODO]** Glass towers reflect the sky and are therefore BRIGHTER than their
surroundings at low sun, while masonry is darker. Getting this backwards flattens a CBD.

**J21 [TODO]** Very tall buildings taper and their tops are more expensive-looking — the
crown is where the budget went.

**J22 [TODO]** Building age should correlate with its ring: the core is oldest and
newest at once, the middle ring is uniform.

**J23 [IN]** Trees are part of the building fabric: street trees, courtyard trees,
podium landscaping.

**J24 [TODO]** Shadows are the single strongest cue for height. A tower with no shadow
reads as a painted rectangle.

---

## K. INFRASTRUCTURE

**K1 [TODO]** PORTS: rectangular basins cut into the land off a main channel, long
straight quays, container yards as striped rectangles, tank farms as circles in rows
(Rotterdam plate). Everything rectilinear against a natural river.

**K2 [TODO]** Container stacks are a striped texture at ~12 m pitch and are brightly
coloured — one of the few saturated things in any aerial image.

**K3 [TODO]** Breakwaters and moles: straight or hooked walls enclosing calm water.

**K4 [TODO]** Dry docks, slipways and cranes along the quay edge.

**K5 [TODO]** AIRPORTS: one to four runways as long thin rectangles aligned to the
prevailing wind, with taxiway loops, a terminal and a geometric apron (HK plate).

**K6 [TODO]** Runway length 2–4 km and dead flat — an airport FLATTENS its terrain.

**K7 [TODO]** Approach lighting and clearways extend the runway's line into the
surrounding land use.

**K8 [TODO]** RAIL: corridors that cut the fabric diagonally, lens-shaped yards with
parallel track bundles, viaducts, and industry along both sides (Chicago plate).

**K9 [TODO]** Stations are a node with a fan of tracks and a dense commercial patch
around them.

**K10 [TODO]** Rail has a much tighter curve and grade limit than road, so it follows
valleys and tunnels through ridges rather than climbing them.

**K11 [TODO]** BRIDGES: the network funnels into them, with an interchange at each end.

**K12 [TODO]** Bridge type scales with span: beam, arch, cable-stayed, suspension.

**K13 [TODO]** DAMS: a reservoir is a lake with one straight edge; everything else about
its shape is the drowned dendritic valley (Hoover plate).

**K14 [TODO]** A transmission fan radiates from every dam and power station — dead
straight corridors over any terrain.

**K15 [TODO]** CANALS: constant-width, constant-level channels with locks where the land
steps, and spoil banks along both sides (Panama plate).

**K16 [TODO]** MINES: terraced concentric benches, a haul road spiralling in, and a
spoil heap and tailings pond beside (Chuquicamata plate).

**K17 [TODO]** Quarries are the same at 1/10 scale and are extremely common near cities.

**K18 [TODO]** Water treatment and sewage works: rows of circular and rectangular tanks,
always downstream and downwind of the city.

**K19 [TODO]** Power stations: cooling towers, stacks, a coal or fuel yard, and a rail
or water connection.

**K20 [TODO]** Solar farms and wind farms as geometric arrays with service tracks.

**K21 [TODO]** Military: geometric, fenced, isolated, with hardstanding and revetments.

**K22 [TODO]** Landfill: terraced mounds with a haul road, usually the highest ground
in a flat city.

**K23 [TODO]** Seawalls, levees and flood barriers as dead-straight lines along a
naturally sinuous edge.

**K24 [TODO]** Reclaimed land: dead-straight coast segments where everything around is
organic (Hong Kong, Tokyo Bay, Dubai plates).

**K25 [TODO]** Artificial water is rectilinear: marinas, docks, canals, ornamental lakes
(Dubai Marina plate) — the exact inverse of natural water, which is why the contrast is
so strong.

**K26 [TODO]** Infrastructure reads as strongly from the air as buildings do, and it is
almost always the thing missing from procedural cities.

---

## L. LIGHT, COLOUR & ATMOSPHERE

**L1 [IN]** Low sun is warm and dim; high sun is white and bright. That one curve is
most of the difference between "a render" and "a photograph of somewhere".

**L2 [IN]** Keep the terminator hard and let the SKY do the fill, rather than a flat
ambient term.

**L3 [IN]** Aerial perspective: distance tends toward the sky colour, and brighter
toward the sun. Grey fog everywhere is the giveaway.

**L4 [IN]** Fog falloff in the ground shader must match the scene fog the other
materials use, or terrain and buildings disagree at the horizon.

**L5 [TODO]** Haze is thicker low down; the horizon is brighter than the sky above it.

**L6 [TODO]** Shadows from terrain onto terrain (self-shadowing) are what make a
mountain range read at dawn. A shadow map or a cheap horizon-angle approximation.

**L7 [TODO]** Cloud shadows moving across the ground are the strongest cue that a world
is alive and are almost free.

**L8 [IN]** Break up flat colour fill with a low-amplitude noise; uniform albedo reads
as plastic.

**L9 [TODO]** Specular on water, wet ground and glass; everything else is near-Lambert
at these distances.

**L10 [TODO]** Colour temperature shifts with altitude and latitude — polar light is
blue, tropical light is neutral, desert light is warm.

**L11 [TODO]** Night: cities become emissive and everything else goes dark. The street
network is more legible at night than by day.

**L12 [TODO]** Sun ANGLE should be a first-class art-direction control, because the same
terrain reads completely differently at 10° and 60°.

---

## M. IMPLEMENTATION, LOD & THE LSS CONTRACT

**M1 [IN]** Concentric rings, each cell snapped to its own size, so rings never jitter
as the camera moves.

**M2 [IN]** Hide LOD seams with a downward SKIRT on every cell edge — cheaper and more
robust than stitching index buffers.

**M3 [IN]** Sample one extra ring outside each cell so edge normals are the true surface
normal and neighbours agree.

**M4 [IN]** Build nearest-first with a per-frame budget.

**M5 [IN]** One InstancedMesh per primitive kind per city; a 50k-building city is two
draw calls.

**M6 [IN]** Cap the instance budget per city and spend it core-first.

**M7 [PART]** Cities beyond mesh range should still be PAINTED on the terrain, so a
distant city reads as a city long before a building exists for it.

**M8 [TODO]** Coarse city LOD: one box per block beyond the instance range, so the
skyline survives at 40 km.

**M9 [TODO]** Trees need a billboard/instance crossover, not one or the other.

**M10 [IN]** Chunk spatially: one merged mesh per layer defeats frustum culling and
makes raycasts O(everything).

**M11 [IN]** The LSS Earth contract is eight members: `.group`, `.errorTarget`,
`.errorThreshold`, `.setResolutionFromRenderer()`, `.setLatLonToYUp()`, `.setCamera()`,
`.dispose()`, `.update()`, plus `.addEventListener()`. Everything downstream
(`_lssGmapsCollideEntity`, `_lssGmapsTick`, `worldSDF`, race routes) only traverses
`.group` for `isMesh` and raycasts it.

**M12 [IN]** Work in TRUE METRES and let the game apply its 7 units/metre at the group,
exactly as `gmaps_earth` does today.

**M13 [TODO]** `setLatLonToYUp(lat, lon)` should map lat/lon onto the procedural plane so
the existing DROP-ON-LOCATION panel, race routes and warp targets keep working.

**M14 [TODO]** `streamUpdate(focus)` keeps the LSSEarthWorld streaming shape; `update()`
must stay a no-op because the tick calls it every frame.

**M15 [PART]** Collision comes free: the same height function the mesh used answers
`heightAt(x, z)` without a raycast, which is cheaper than the current mesh raycast.

**M16 [TODO]** Publish meshes over several frames (LSSEarthWorld's `_LE_PUBLISH_PER_FRAME`
pattern) — geometry upload is ~1–1.5 ms each and will blow a 144 Hz budget in a burst.

**M17 [IN]** Never dispose a shared singleton geometry in a per-instance teardown.

**M18 [TODO]** Mobile and Quest: halve SEG, drop two LOD rings, cut the fragment shader's
octave counts, and skip the fine-detail terms entirely.

**M19 [IN]** Expose every knob on `window.*` so the world can be tuned live without a
rebuild.

**M20 [TODO]** Seeded worlds are shareable: a seed plus a coordinate is a complete
location, which gives the game free "places" without a level editor.

**M21 [IN]** Zero bytes streamed is the headline: no DEM, no imagery, no Overpass, no
API key, no rate limit, works offline and in a standalone build.

**M22 [TODO]** Keep an escape hatch: the real-Earth streamer and the procedural world
should be switchable behind the same contract, so Earth mode can offer both.

---

## N. FACADES & THE STREET AT EYE LEVEL

Derived from ground-level photographs (Wikimedia Commons, via `LSS/_photosheet.html`)
rather than from maps — a Sydney terrace row, a Porto mid-century apartment block, the
Daily News Building, a Bracknell suburban street, a Pune residential lane. Maps tell
you where a building is; only a photograph tells you what its wall looks like, and at
LSS flight altitudes the wall is most of the frame.

**N1 [IN]** A facade is a repeated BAY. Bay width: houses 5–6 m, apartments 3.5–4.5 m,
offices 2–3 m. Narrower bays read as a taller, more commercial building.

**N2 [IN]** Storey height: ground floor 3.2–4.5 m, upper floors 2.8–3.3 m. These two
numbers set the apparent scale of every building in the world.

**N3 [IN]** THREE-PART VERTICAL COMPOSITION — base, shaft, cap. Every photograph has it,
from a two-storey terrace to a 40-storey tower.

**N4 [IN]** The BASE is the single strongest cue that a box is a building: one tall
storey, different material, mostly glazed, shaded by a canopy, reading as a dark band.

**N5 [IN]** Windows read NEAR-BLACK in daylight. Wall-to-window contrast is 4:1 or more,
and that contrast is the whole facade texture.

**N6 [IN]** Window area fraction rises with building type: houses ~15%, apartments ~25%,
offices 50–70%.

**N7 [IN]** ONE COLOUR PER BUILDING. Variance lives BETWEEN neighbours (the Porto plate
has a cream block beside a pink one beside a grey one), never within one facade.

**N8 [IN]** Residential facades are dominated by HORIZONTAL bands (balconies, string
courses, floor lines); tall commercial by VERTICAL piers (Daily News plate reads as
stripes, not a grid, from the street).

**N9 [IN]** Balconies occur on a SUB-RHYTHM — every other bay, or alternating floors —
never on every bay.

**N10 [PART]** Roofline breakers: chimneys, dormers, stair penthouses, lift overruns,
water tanks, antennas, parapet railings. A clean flat lid is the classic tell.

**N11 [TODO]** Terraces STEP with the street slope rather than sloping — the parapet
line is a staircase.

**N12 [TODO]** Street furniture is what gives a street its scale: lamp posts at 25–30 m,
signals at junctions, bollards, bins, benches, planters, signage.

**N13 [TODO]** Footpath material and colour differ from the roadway, with a kerb line
between. The Porto plate has light stone setts against dark asphalt.

**N14 [IN]** Street trees at 8–12 m spacing, with gaps at driveways and junctions.

**N15 [TODO]** Parked cars line the kerb almost everywhere — a continuous band of small
saturated objects, and one of the only saturated things in the scene.

**N16 [IN]** At night, windows are a SPARSE scatter of warm dots, not a full grid, plus
continuous street lighting and floodlit landmarks.

**N17 [TODO]** Corner buildings chamfer or round the corner and are taller or more
ornate — the corner is the valuable address.

**N18 [IN]** Weathering runs DOWNWARD from sills and parapets as vertical streaks.

**N19 [IN]** Awnings and canopies project at the base and cast a shadow band along it.

**N20 [TODO]** Utility poles and overhead wires in low and mid-density areas; buried in
high-density. The Bracknell and Tasmania plates both have wires crossing the frame.

**N21 [TODO]** Front setback is a cultural constant: terraced 0–3 m, Australian suburb
3–5 m, UK/US suburb 8–12 m. It changes the whole character of the street.

**N22 [TODO]** Ridge direction is consistent within a street — roofs run parallel to the
street, not at random.

**N23 [IN]** Mature street trees can be TALLER than the houses and occlude 30–60% of a
residential block from above. At aerial altitudes the canopy is the fabric.

**N24 [TODO]** Driveways and garages face the street and break the fence line.

**N25 [TODO]** Repetition with variation: a terrace is ONE module repeated exactly — same
width, same floor heights, same openings — with variation only in colour, door, fence
and planting. Varying the module is wrong; varying the detail is right.

**N26 [TODO]** Ground-floor signage and awnings are the most saturated things on any
street, and the only place a city gets real colour.

---

## COUNTS

**362 rules** — 157 implemented, 16 partial, 189 derived-not-yet-built.

| ch | topic | rules |
|---|---|---|
| A | Scale law & method | 20 |
| B | Tectonics & landform | 28 |
| C | Erosion & drainage | 28 |
| D | Hydrology, coast & ice | 36 |
| E | Climate, biome & ground texture | 32 |
| F | Human land use | 25 |
| G | City site & form | 28 |
| H | Street network | 25 |
| I | Block & parcel grammar | 30 |
| J | Building, roof & material | 24 |
| K | Infrastructure | 26 |
| L | Light, colour & atmosphere | 12 |
| M | Implementation, LOD & LSS contract | 22 |
| N | Facades & the street at eye level | 26 |
