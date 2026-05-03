# LSS Graphics Update Plan ; Layered FX Materials

Last updated: 2026-05-03
Status: planning, prototype starting on fx_lab.html

## Vision

Apply the same multi-layer composite-material architecture that makes the wall system feel alive to every other volumetric or surface effect in the game. A fire isn't a single shader sample ; it's a hot core, a turbulent middle, and a wispy halo, each with their own scale, hue offset, time rate, and blend mode. A smoke plume isn't a billboard ; it's a dense inner cloud, a drifting middle, and a dispersing edge. A stasis field isn't a sphere ; it's an inner pulse, a swirling middle layer, and an outer mist.

The walls already prove the technique works at game scale. Generalizing it to fx is what takes LSS's visual identity from "a polished hobby game" to "a hobby game that looks like a real studio title." Same architectural posture, broader application.

The unifying abstraction: **`LayeredFXMaterial`**, a parameterized THREE.ShaderMaterial that takes a layer config (a small JSON describing each layer's pattern + scale + time rate + hue + alpha + blend) and produces a working material. Effects are then defined as JSON presets rather than as bespoke shaders.

## Why this matters

Three reinforcing reasons:

1. **Visual ROI per hour of work.** A great fire shader is iconic ; players notice the difference immediately. A great smoke shader makes the world feel weighty. Stasis fields with internal turbulence stop reading as "geometry with a glow" and start reading as "an actual otherworldly object." Each conversion is high-impact polish for a small lift once the architecture is in place.

2. **Architectural consistency.** Right now the game has a wall shader system, a smoke shader system, an explosion-flash system, a shield-shader system, etc. ; each its own bespoke pile of code. Unifying under `LayeredFXMaterial` collapses those into one shader plus N JSON presets. Easier to maintain, easier to extend, easier to expose to user customization (the customization promise on about.html ; "swap your own assets, walls, sounds, ships, frames" ; can extend to "swap your own effects").

3. **Lab tooling pays back across many features.** `wall_pattern_lab.html` and `map_lab.html` and `sound_lab.html` are paying back daily because they let us tune visually rather than by editing code constants and reloading. `fx_lab.html` would do the same for every layered effect we convert. Build the lab once, author dozens of presets across the project's life.

## Architecture

### `LayeredFXMaterial` class

A single THREE.ShaderMaterial subclass with up to N layers (start with 3, leave room to extend to 5+).

Constructor accepts a config object:

```js
{
  layers: [
    { pattern, scale, timeRate, hue, alpha, blend, satBase, contrastBase },
    { pattern, scale, timeRate, hue, alpha, blend, satBase, contrastBase },
    { pattern, scale, timeRate, hue, alpha, blend, satBase, contrastBase },
  ],
  baseColor:    0xff8800,
  fresnel:      { strength: 0.8, color: 0xffaa00 },
  alphaFalloff: { startDist: 0, endDist: 200 },
  geometryHint: 'volume' | 'surface' | 'billboard',
}
```

Internally builds a fragment shader that loops over the layers, samples the pattern function, applies the blend mode, accumulates color + alpha, then emits the result with optional fresnel + alpha falloff.

### Pattern library

A shared GLSL pattern library (similar to `cosmicField()` in the wall shader, but isolated and reusable):

- `fbm(p, octaves)` ; classic fractal Brownian motion
- `plasma(p, t)` ; flowing-energy sine-based pattern
- `turbulence(p, t)` ; absolute-value fbm for fire-like edges
- `voronoi(p)` ; for cellular/membrane effects
- `wave(p, t)` ; concentric wave interference
- `ridges(p)` ; sharp ridged turbulence (lightning, energy arcs)
- `caustic(p, t)` ; water-caustic shimmer
- `stars(p)` ; fast-strobe high-detail pinpoints

Each is a small GLSL function that takes a sample position + optional time and returns a float in [0, 1] (or vec3 for color-aware patterns). Layers reference patterns by integer index (matching the wall pattern system's convention).

### Blend modes

- `0` ; **replace** (later layer overwrites)
- `1` ; **multiply** (darken / colorize)
- `2` ; **add** (brighten / energy)
- `3` ; **screen** (soft brighten)
- `4` ; **mix** (linear blend by alpha)
- `5` ; **overlay** (contrast-preserving)
- `6` ; **subtract** (darken / shadow)

Same numeric scheme as the wall pattern lab.

### Preset schema

Effect presets stored as JSON, similar to wall pattern presets:

```json
{
  "name": "Pyro Inferno",
  "version": 1,
  "geometryHint": "volume",
  "baseColor": "#ff8800",
  "fresnel": { "strength": 0.6, "color": "#ffaa00" },
  "alphaFalloff": { "startDist": 0, "endDist": 200 },
  "layers": [
    { "pattern": 0, "scale": 0.01, "timeRate": 1.0, "hue": 0.05, "alpha": 1.0,  "blend": 2, "satBase": 0.95, "contrastBase": 1.0 },
    { "pattern": 2, "scale": 0.03, "timeRate": 0.5, "hue": 0.10, "alpha": 0.6,  "blend": 4, "satBase": 0.9,  "contrastBase": 1.0 },
    { "pattern": 0, "scale": 0.005,"timeRate": 0.2, "hue": 0.0,  "alpha": 0.3,  "blend": 1, "satBase": 0.7,  "contrastBase": 1.0 }
  ]
}
```

Stored in `EFFECT_PRESETS` table in the game, swappable per-effect-instance, exportable from fx_lab.html as JSON.

### How effects use the material

Each effect type (fire, smoke, stasis, etc.) gets a default preset baked into the game. Per-instance customization (e.g. "this Pyro player wants their fire BLUE") layers user settings on top.

```js
// Pyro fires their flame trap
const preset = EFFECT_PRESETS['pyro_fire'];
const mat = new LayeredFXMaterial(preset);
flameTrap.mesh.material = mat;
```

When the lab exports a preset, the JSON drops directly into the game's `EFFECT_PRESETS` table.

## Effect candidates, ranked by visual ROI

### Tier 1 ; biggest visual delta, prioritize first

- **Pyro flame and gas** ; iconic ability, currently simple, fire is the textbook layered-shader use case.
- **Smoke plumes** ; we already have volumetric smoke; adding layers makes it film-quality.
- **Stasis field aura** ; champion fields and pickups; layered energy shell makes them feel like artifacts instead of geometry.

### Tier 2 ; strong polish, after Tier 1 is in

- **Explosion bloom** ; layered flash + heat shimmer + concussion ring in the brief explosion window.
- **Energy shields** ; existing hex-hologram + caustic-shimmer second layer for living-fluid feel.
- **Vortex's energy field** ; multiple swirling plasma layers.
- **Champion field's claim aura** ; layered purple energy when a team is charging.

### Tier 3 ; subtle but accumulative

- **Rocket / dash / missile trails** ; layered procedural plasma streaks.
- **Tracker laser-lock indicators** ; pulse layers.
- **Doomed-state ship glow** ; ominous layered red.
- **Spawn-protection bubble** ; soft layered energy.

### Tier 4 ; if the architecture proves out

- **HDRI skybox replacement** ; fully procedural layered cosmic backdrop.
- **Ambient particle field** ; floating energy motes around the play area.
- **Wall-pattern integration** ; merge the wall preset system into the same `LayeredFXMaterial` class so walls and fx share patterns + blend modes (already mostly compatible).

## Implementation phases

### Phase 1 ; the lab + the architecture (this session, ~1 weekend)

1. Build `fx_lab.html` (in progress). Three.js scene with a preview mesh (sphere or volume), three layer controls, pattern selector, base color picker, JSON export.
2. Implement `LayeredFXMaterial` class inside the lab (then promote to the game).
3. Implement the pattern library (~6-8 GLSL functions).
4. Implement the blend mode switch (~7 modes).
5. Author 3-4 starter presets in the lab: "Generic Fire," "Generic Smoke," "Plasma Energy," "Cold Stasis."

### Phase 2 ; convert Pyro fire (proof of concept, ~half day)

6. Identify the current Pyro fire shader/material in v10.
7. Replace with `LayeredFXMaterial` using the "Pyro Inferno" preset.
8. A/B test: side-by-side screenshots, tune.
9. Ship.

### Phase 3 ; convert smoke (~half day)

10. Replace volumetric shader smoke with layered version.
11. Test under heavy combat (many overlapping plumes).
12. Tune for performance.

### Phase 4 ; convert stasis fields (~half day)

13. Replace stasis core + edge meshes' materials with layered.
14. Champion fields get their own preset (purple energy).

### Phase 5 ; explosion bloom + shields (~1 day)

15. Layered flash for explosions.
16. Caustic-shimmer second layer on shields.

### Phase 6 ; trails + ambient (~1 day)

17. Convert rocket / dash trails.
18. Add ambient layered particles if rendering budget allows.

### Phase 7 ; ship customization (later)

19. Expose the effect presets in the customization layer ; users can edit `effect_presets.json` in their local repo and run with custom fire / smoke / stasis aesthetics, sync over P2P (every peer sees their own local presets).

## Performance considerations

Walls are huge surfaces ; the cost there is dominated by the high pixel coverage. Effects are small-area, but many can be on-screen at once.

- **Per-effect cost** scales with: layer count × pattern complexity × screen-space coverage. Three layers of FBM at 8 octaves over a 100px particle is fine. Same on a 1000px firewall is significant.
- **Active-effect cap**: if many effects accumulate (Pyro spam fire, missile barrage explosions), we may need to reduce layer count adaptively or cap the number of layered-FX-materials in flight. Existing particle pools already cap counts; same idea.
- **Pattern complexity tiers**: cheap (single FBM, plasma, voronoi), medium (turbulence, wave, caustic), expensive (high-octave fbm, ridges with derivatives). Lab exposes a "performance tier" badge on each pattern.
- **Mobile / low-end fallback**: not a current target, but if it becomes one, the layer count drops to 2 and patterns auto-degrade to cheap tier.

For now, profile-driven optimization. Start naive; tune what shows up in the GPU frame.

## Open questions

- **Should the wall shader merge into `LayeredFXMaterial`?** The wall shader currently has its own special-case path (uPattern == 20-24 multi-layer composites). If `LayeredFXMaterial` proves out, the wall shader could become a specific subclass that inherits the layer compositing logic and adds wall-specific extras (zone color, fresnel rim on geometry edges, etc.). Maybe Phase 7+ work.
- **Per-instance customization API.** Lab exports a preset; how does an in-game effect override layer 2's hue at runtime? Either: store a mutable params object, push to uniforms each frame; or: lock the material at creation and only swap presets between effects (cheaper). Probably the latter for v1.
- **Networking.** Custom effect presets are local-only (each peer renders their own). No need to sync over Trystero, since the gameplay state doesn't depend on visual presentation. Same architectural property as custom GLBs / PNGs / sounds.
- **Hot-reload from lab.** Future polish: the lab can push presets directly into a running game instance via a dev-only endpoint. Nice-to-have.
- **Variable layer count.** Start with exactly 3 layers (matches wall_pattern_lab). Could extend to "N layers, each can be enabled/disabled" later. The shader gets uglier; the visuals get richer. Probably worth it once the architecture proves out.

## What's getting built right now

`fx_lab.html` (this session). Self-contained editor like wall_pattern_lab. Three.js preview canvas, three layer controls in a sidebar, pattern selector, blend mode selector, base color picker, JSON export. Uses the `LayeredFXMaterial` class internally (which gets extracted into the game later when we convert Pyro fire).

The lab ships a few starter presets that demonstrate what's possible (fire, smoke, plasma, stasis) and serves as the template for authoring per-effect presets later.

## Authored presets (Phase 2 inputs)

Source-of-truth JSON files live in `LSS/effects/`. As of 2026-05-03 the user has authored three presets ready for in-game integration:

- **`fireball.json`** ; bright orange-red fireball with turbulence base + ridge accents + dark FBM subtract for charred edges. Bright (3.0). Target effects: Pyro fire trap puff, fireball impact, explosion bloom hot core.
- **`cloud.json`** ; drifting volumetric cloud. Dark base color, turbulence-mix front + soft FBM screen overlay + dark FBM multiply core. Target effects: smoke plumes, gas trails, ambient nebula puffs, Pyro gas cloud.
- **`plasma_wall.json`** ; cyan plasma energy with sine-flow base + ridge multiply + turbulence subtract for dynamic edges. Target effects: Tracker particle wall, Vortex thermal shield dome, Blaster gun shield, generic energy barriers.

Phase 2 work picks these up and wires them into the corresponding game-side materials. The lab also keeps inline copies under the same names so any of them can be reloaded with one click for further tuning.

---

License: same as the rest of LSS-related design docs in this repo. Internal planning document.
