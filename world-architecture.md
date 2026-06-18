# Fractal World — Architecture & Design

*A connected, peer-networked cavern world. Elements from LSS, but not LSS.*

## What we decided

- **Topology:** one connected world (zones stream and blend, players travel between them; not a map pool, not discrete levels).
- **Core loop:** sandbox + co-op exploration/missions + PvP, all on the same world.
- **LSS DNA we keep:** sandwich cavern world, naval/airship feel, P2P deterministic netcode, and physics-as-gameplay (the new thing: wind/water/cymatics are mechanics, not decoration).

## The spine: deterministic world = no terrain syncing

In a connected world where terrain is a pure function of a global seed, peers never send terrain over the network. Every peer regenerates the identical world from the same seed.

So `groundY` / `ceilY` stop being "the cavern" and become global fields:

```
groundY(seed, x, z)   // defined everywhere, not just [-650, 650]
ceilY(seed, x, z)
```

The connected world and the deterministic netcode are the same decision: **sync the seed + player inputs, and everyone's world matches for free.** Heavy math (modal eigenmodes, fluid warmup) can be precomputed before a session because it is all deterministic from the seed.

## "More scenes" splits into two orthogonal things

1. **Biomes = parameter sets.** A low-frequency region map over the world selects which params are active (palette, terrain amplitude, water level + viscosity, wind strength, prop spawns, particle type). Same systems, different params:
   - grass cavern: green palette, spores drift, liquid water
   - ice: snow palette, water frozen (high viscosity, white specular), wind carries snow
   - lava: water sim emissive + slow damping, hot updrafts in the wind field
   - fungal / crystal: same machinery, different look
   You get variety from data, not rewrites. Borders blend params so transitions are continuous.

2. **Streaming = chunk manager.** Divide xz into tiles (~256 units). Load/build terrain mesh, grass, water bodies, props around each player by distance; unload far ones; LOD by distance. You walk grass→ice because the region map blended params under you, not because a level loaded.

## Layered architecture

- **L0 Deterministic core** — seeded RNG, fixed-step clock, event log, Trystero transport. Everything above is a pure function of (seed, events).
- **L1 World fields** — terrain + biome map, `f(seed, x, z)`, defined everywhere. Synced by nothing but the seed.
- **L2 Streaming** — chunk load/unload + LOD around players.
- **L3 Systems** — terrain mesh, grass, clouds, water sim (mereology: per-basin bodies), wind sim (obstacle-aware routing), lighting/AO. Each consumes a chunk + its biome params. This is the current cavern code, refactored to take params instead of constants.
- **L4 Entities** — ships, projectiles (rockets/lasers), players. Deterministic, input-synced.
- **L5 Modes** — sandbox / co-op missions / PvP are orthogonal rule layers (spawn rules, objectives, destructibility). The world does not know the mode; different regions could even run different modes.
- **L6 Presentation** — camera, HUD, post (god-rays, fog, ACES).

## Physics-as-gameplay has a clean home

Because wind and water are L3 world systems, a rocket is pushed by the same wind that bends the grass, and a basin's water answers a blast identically for every peer. The mechanic and the deterministic sim are one object. Examples:
- wind routes around peaks → projectiles drift, sails catch gusts, gliding paths matter
- water bodies are bounded (mereology) → flood a basin, drain it, freeze it; each is its own resonant system (cymatics)
- a blast injects into the shared flow field → wake propagates deterministically to all peers

## Migration path (from the current monolith)

`webgpu-grassy-cavern.html` is one file with every system hardcoded to constants (SIZE, HALF, GROUND_AMP...). We do not start by writing new scenes. We start by un-hardcoding:

1. **Seed the fields.** Make `groundY`/`ceilY` take a seed and be defined over an unbounded domain (tileable noise, no SIZE/HALF clamps).
2. **Prove streaming.** Stand up a 2x2 chunk stream with a seam that matches across chunk borders (terrain + grass continuous).
3. **Extract systems to params.** Pull grass/water/wind/clouds/lighting out of the monolith into modules that take `(chunk, biomeParams)`.
4. **Region map.** Add the low-frequency biome selector + param blending.
5. **Entities + modes.** Layer the synced entity sim and the orthogonal mode rules on top.

Once chunks tile seamlessly, biomes and modes are just data.

## Open questions to settle next

- Chunk size + view distance vs. the cost of running the fluid sims per active region.
- Do sims run everywhere loaded, or only near players (and warm up on approach)?
- Vertical: is the world a single sandwich layer, or stacked caverns (true 3D regions)?
- Persistence: does the world remember player changes (sandbox builds, flooded basins), and if so, how is that synced/stored?
