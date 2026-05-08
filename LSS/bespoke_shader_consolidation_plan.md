# LSS Bespoke Shader Consolidation Plan

Last updated: 2026-05-08 (Tranche 3 fully closed)
Status: Tranche 3 done in v14c. Tranche 1.5 + 1.5b done. Tranche 1 (smoke), Tranche 2 (ship shield), Tranche 4 (sprites) remain open.
Supersedes: the unfinished tail of `graphics_update_plan.md` (now in `old_plans/`)

## Progress log

- **2026-05-08:** Projectile inner glow halo (Tranche 3) ported. New `proj_glow` preset added; `_makeProjGlowMaterial` deleted; fade-in switched from `uOpacity` to `uBrightness` scaling. Post-port: a forgotten per-frame `uniforms.time.value` write tripped at runtime ; defensive guard added. Lesson: every port must grep all per-frame uniform writes on the swapped material before declaring done, since the new uniforms have different names.
- **2026-05-08:** Tranche 1.5 (uIntensity feature add) shipped. LayeredFXMaterial gained a per-instance `uIntensity` uniform (default 1.0) that scales the layer time-rate calculation. Four small edits: uniform decl + cfg field + uniform table entry + one line in the layer loop. All existing presets default to 1.0 so no visual change to anything wired before this point.
- **2026-05-08:** Engine plume (Tranche 3) deferred. Audit found its `uThrottle` per-frame modulation drives scroll speed + brightness + alpha together, plus the visual identity needs an axial gradient on cone geometry. uIntensity (Tranche 1.5) addresses the scroll-speed half but the axial-gradient half still requires a `geometryHint: 'cone'` mode (not yet built).
- **2026-05-08:** Tether trap orb core (Tranche 3) ported. New `orb_core` preset (ridges + stars + plasma); `_makeOrbCoreMaterial` deleted; uIntensity carries the triggered/armed state cue at 1.7 vs 1.0. The dead-code fallback at the Vortex Trip Wire mine site (already on fireball_purple) was collapsed at the same time.
- **2026-05-08:** Tranche 1.5b shipped on v14c. LayeredFXMaterial gained an axial-gradient post-pass: `vUv` varying + four uniforms (`uAxialFalloff`, `uAxialCoreColor`, `uAxialCoreStrength`, `uAxialCoreFalloff`) + cfg defaults all 0 = identity (legacy presets byte-identical) + a short post-composite block that darkens linearly along the cone/cylinder axis and blends toward a hot-core color near the base. Unblocked the engine plume + Vortex Core Beam ports.
- **2026-05-08:** Tranche 3 closed out on v14c. Eight remaining bespoke factories ported in one pass:
  * engine glow disc (`_makeEngineDiscMaterial` -> `engine_disc`), throttle modulation via uIntensity
  * Pyro gas cloud (`_makeGasCloudMaterial` -> `gas_green`), per-instance recolor on ignite preserved
  * tether trap halo (`_makeGravityHaloMaterial` -> `gravity_halo`), trigger state via uIntensity
  * stasis pickup shockwave (`_makeShockwaveMaterial` -> `shockwave_ring`), age-based fade via uIntensity + uBrightness
  * atom-fractal rocks (`_makeAtomFractalMaterial` -> `atom_surface`), surface variant ; lifetime fade via uBrightness
  * cluster distortion shell (anonymous ShaderMaterial -> `distortion_shell`); callsite is currently disabled but ported for re-enable
  * engine plume cone (`_makePlumeShaderMaterial` -> `engine_plume`); uses Tranche 1.5b axial gradient (axialFalloff 0.85, axialCoreColor white, axialCoreStrength 0.6); throttle via uIntensity
  * Vortex Core Beam (`_makeVortexCoreBeamMaterial` -> `core_beam`); uIntensity already matched LayeredFX semantics, swap was clean
  Net file size change: -308 lines. v14c is 42,659 lines.
- **2026-05-08 (post-port fix):** Three gas-cloud sites that the porting agent missed updating were writing to `uColor` / `uBaseAlpha` / `time` on the now-LayeredFX `gas_green` material and crashing at runtime. Fixed by routing recolor through `uBaseColor` (with `uColor` fallback retained), brightness modulation through `uBrightness` (with `uBaseAlpha` fallback), and dropping `time.value` writes (auto-ticked). A targeted sweep across the whole file confirmed no other unguarded writes to deleted-bespoke uniform names remain on ported materials. Lesson refined: when delegating a multi-port pass, the verification step must include grepping ALL uniform-write sites in update/tick loops for ALL ported materials, not just the construction sites ; the agent grepped for factory definitions and callsites but missed update-loop branches that referenced deleted uniforms.
- **2026-05-08 (rollback ; user feedback):** Two ports rolled back after the user reported "looks worse" on play-test. Both have visual identities that LayeredFX's current pattern library cannot reproduce:
  * **Atom-fractal cluster rocks** ; the bespoke shader uses an iterative Mandelbox fractal (8-step escape-time loop with magic-number folding) for the surface texture. The voronoi+ridges+FBM substitute the porting agent picked produces cellular noise, which reads to the player as "static TV / sand." LayeredFX has no escape-time fractal pattern. Restored `_makeAtomFractalMaterial` verbatim from v14b ; deleted `atom_surface` preset.
  * **Pyro gas cloud (outer hull)** ; the bespoke shader's identity is a hard alpha-threshold discard (`if (alpha < 0.05) discard`) plus sparse-pattern wispy-plume vertex displacement. The discard creates the characteristic "cloud has holes / silhouette breakup" look that no smooth-blend LayeredFX preset can match. Restored `_makeGasCloudMaterial` verbatim ; deleted `gas_green` preset. The gas cloud's INNER core mesh remains on the `fireball` LayeredFX preset (was already on it since v11, not part of this rollback).
- **Framework limitation captured:** LayeredFXMaterial's pattern library is noise-based + smooth-blend. Two future feature additions would unlock these two ports cleanly:
  * **Escape-time fractal pattern** (Mandelbox / Mandelbulb). Adds a `pattern: 8` to the dispatch with the bespoke 8-iteration loop. Modest shader cost ; expressive enough to handle the atom rocks plus future "alien geometry" effects.
  * **Hard alpha-discard config field** (`alphaThreshold: 0.05` or similar). Adds a `discard` after the layer composite when alpha falls below the threshold. Unblocks the gas cloud's silhouette breakup and any other "this isn't a sphere" volumetric effect.
  Both are scoped as future work, not in v14c. The consolidation plan is reaching its honest end ; ports that don't fit the framework should be acknowledged as outside its current scope rather than forced through with regressions.

## Why this plan exists

`graphics_update_plan.md` (2026-05-03) called for migrating every volumetric and surface effect onto a unified `LayeredFXMaterial` system. The bulk of that plan shipped across v11 / v11a / v11b / v11c / Phase 4 / Phase 5 / Phase 6 (fire trap, flame licks, Trip Wire orbs, all three shield-dome variants, cluster explosions, Tracker particle wall plasma backing, cosmic anomaly). A 2026-05-08 audit on `last_ship_sailing_v14.html` confirmed the conversion is substantially complete for the loud, eye-catching FX.

What's left is a long tail of smaller bespoke shaders plus two genuinely big systems (smoke, ship energy shield) that are gated on capability additions to `LayeredFXMaterial` itself. v14a already deleted six fully-dead factory functions (~528 lines). This plan handles the rest.

## Scope summary

| Category | Count | Effort | Visual ROI |
|---|---|---|---|
| Gated on LayeredFX feature-adds | 2 | High (per item) | High (smoke especially) |
| Ready to port, low risk | 9 | Medium (per item) | Low to medium |
| Sprite-based, separate question | 5 | Architectural | Low |
| Leave as-is (deliberate design) | 3 | None | N/A |

Total still-bespoke surface area: ~16 effect families. Realistic target: bring the gated two onto LayeredFX (with the feature work that unblocks them), port the 4-5 most-visible small ones, leave the rest.

## Tranche 1 ; LayeredFX feature additions

These are prerequisites. Without them, the two largest ports have no clean target.

### 1A. Dynamic-light support in `LayeredFXMaterial`

Smoke (`_makeSmokeMaterial`, line 5769 in v14) carries a per-material 4-slot dynamic-light uniform array (`uLightPos[4]`, `uLightColor[4]`, `uLightIntensity[4]`, `uLightRadius[4]`) with a registry (`_smokeMatRegistry`) that updates the closest 4 lights per smoke instance per frame. The current LayeredFX shader has no concept of receiving scene lighting ; it's pure self-emissive composite math.

**Work:**
- Add 4-slot light uniform array to the LayeredFX uniform block.
- Add an optional `lightingMode` config field on presets: `none` (current behavior, default for fire/explosions) | `received` (smoke-style, multiplies the composite color by accumulated incoming light).
- Add an external tick in the per-frame loop that mirrors `_smokeMatRegistry`: walk `_ACTIVE_LAYERED_FX`, find materials with `lightingMode === 'received'`, populate their light uniforms from the closest scene lights.
- Author a `cloud_lit` preset variant that reproduces the current smoke material's look as closely as possible.

**Risk:** moderate. The light-uniform pump is a per-frame O(N*L) walk where N = active lit-materials and L = scene lights. Smoke instance count peaks during big cluster explosions (~30+ active). Profile before shipping. The good news: smoke lifetimes are short (1-3s) so the active set stays bounded.

**Acceptance:** a `cloud_lit` preset that, dropped into `_makeSmokeMaterial`'s callsites, produces visuals within "could be the same artist" range of the current smoke. Side-by-side comparison in `fx_lab.html` before any in-game swap.

### 1B. Ripple-on-impact uniform support

Ship energy shield (`makeEnergyShieldMaterial`, line 4971) carries `uHitDirs`, `uHitAges`, `uHitColors` arrays that drive expanding ripple rings from the impact point on the shield surface. The plasma_wall preset has nothing equivalent ; it's a flat composite with no event-driven local distortion.

**Work:**
- Add an N-slot ripple uniform block to LayeredFX (recommend N=4 starting; fresnel-shielded ships rarely have more than that many simultaneous active hits).
- Add a `ripples` toggle in preset config. When on, the fragment shader adds a per-ripple contribution: ring distance from `uHitDirs[i]`, attenuated by `uHitAges[i]`, tinted by `uHitColors[i]`.
- Expose a `triggerRipple(material, direction, color)` helper alongside `_makeFXMaterial`.

**Risk:** low to moderate. Math is well-understood (the existing energy-shield shader is the reference implementation). Main risk is making the API ergonomic so the existing shield-impact callsites can swap in cleanly.

**Acceptance:** a `shield_dome` preset that produces shield-bubble visuals within the same comparison bar as 1A.

## Tranche 1.5 ; Small LayeredFX feature add for engine effects

Discovered while attempting the engine plume port (2026-05-08). The plume's bespoke `uThrottle` uniform is heavily modulated per frame (scroll speed 1.5x→5.5x, brightness 0.55x→1.0x, alpha 0.85x→1.0x, capped at 1.5 for boost). LayeredFX has no equivalent, and the engine glow disc has the same pattern.

**Work:**
- Add a `uIntensity` uniform to LayeredFX (default 1.0). When != 1.0, it scales each layer's effective time rate (so animation slows at low intensity, speeds up at high) and post-multiplies the final color and alpha.
- Optional: add a `geometryHint: 'cone'` mode that exposes a UV.y-derived axial coordinate to the patterns, so axial gradients (hot core at base fading toward tip) can be authored as preset features rather than custom shader code. This is the second blocker for engine plume specifically; engine glow disc doesn't need it.

**Risk:** low. The uniform is a single float. Time-rate scaling is one multiplier line in the layer loop. Color/alpha post-multiply is two lines after the fragment composite. The cone-axial sampling is more work but isolated.

**Acceptance:** engine plume preset with idle-vs-burning visual difference within "could be the same artist" range of the bespoke shader. Side-by-side in `fx_lab.html` before swap.

After Tranche 1.5 ships, engine plume + engine glow disc become the natural next ports in Tranche 3.

## Tranche 2 ; The big port (after Tranche 1 ships)

### 2A. Smoke

Replace `_makeSmokeMaterial` with `_makeFXMaterial('cloud_lit')` at all callsites:
- Explosion residue (line 15872 in v14)
- Per-child cluster smoke (16642)
- Distortion-shell cluster smoke (16995, 17166)
- Ambient cloud parents (19549) and their internal puff cluster (19601)
- Damaged-ship trailing smoke (19909)

Delete `_makeSmokeMaterial` and `_smokeMatRegistry` once all callsites are migrated.

### 2B. Ship energy shield

Replace `makeEnergyShieldMaterial` with `_makeFXMaterial('shield_dome')` at the two callsites (11679, 12054). Wire the existing impact-hook code to call `triggerRipple` instead of mutating `uHitDirs/uHitAges/uHitColors` directly.

Delete `makeEnergyShieldMaterial`.

## Tranche 3 ; The small ports (parallel-friendly, no blockers)

These are independent. Each is roughly an evening's work: author a preset in `fx_lab.html`, swap the callsite, side-by-side check, ship.

| Effect | Current factory | Suggested preset | Notes | Status |
|---|---|---|---|---|
| Projectile inner glow halo | `_makeProjGlowMaterial` | `proj_glow` | Per-instance baseColor override from Projectile.trailColor; uPosScale = 1/radius. | **Done v14a/b 2026-05-08** |
| Tether Trap orb | `_makeOrbCoreMaterial` | `orb_core` | New preset (ridges + stars + plasma) ; uIntensity carries the triggered/armed state. | **Done v14a/b 2026-05-08** |
| Engine plume cone | `_makePlumeShaderMaterial` | `engine_plume` | Throttle modulation via uIntensity. Hot core + axial fade via Tranche 1.5b axial-gradient feature. | **Done v14c 2026-05-08** |
| Engine glow disc | `_makeEngineDiscMaterial` | `engine_disc` | Throttle modulation via uIntensity. Per-instance baseColor for team tint vs cyan thruster. | **Done v14c 2026-05-08** |
| Pyro gas cloud (unignited) | `_makeGasCloudMaterial` | (rolled back) | Bespoke alpha-discard + sparse-pattern wispy plume not reproducible with current LayeredFX pattern library. Needs a hard alpha-threshold config field added to LayeredFX. | **Rolled back v14c 2026-05-08** |
| Vortex Core Beam | `_makeVortexCoreBeamMaterial` | `core_beam` | Cylinder geo; uIntensity write at the existing call sites already matched LayeredFX semantics, clean swap. | **Done v14c 2026-05-08** |
| Tether Trap halo | `_makeGravityHaloMaterial` | `gravity_halo` | wave + ridges layers ; trigger state via uIntensity. Visual delta accepted (rings approximation, not pixel-perfect). | **Done v14c 2026-05-08** |
| Stasis pickup shockwave | `_makeShockwaveMaterial` | `shockwave_ring` | wave base + ridges accent + stars sparkle ; lifetime fade via uIntensity + uBrightness. | **Done v14c 2026-05-08** |
| Atom-fractal cluster rocks | `_makeAtomFractalMaterial` | (rolled back) | Bespoke uses iterative Mandelbox fractal ; LayeredFX pattern library has no escape-time fractal equivalent. Substitution read as "static TV / sand" on play-test. Needs a Mandelbox pattern function added to LayeredFX. | **Rolled back v14c 2026-05-08** |
| Cluster distortion shell | anon ShaderMaterial | `distortion_shell` | caustic + plasma layers ; per-cluster phase via _timeOffset. Callsite currently disabled, ported for future re-enable. | **Done v14c 2026-05-08** |

Suggested order (revised after the engine-plume deferral): **projectile glow [done]** → tether trap orb (cleanest fit, reuses existing preset) → stasis shockwave (very small) → gas cloud → tether trap halo → atom rocks → distortion shell, then come back to engine plume + glow disc + core beam after Tranche 1.5 ships the `uIntensity` feature.

## Tranche 4 ; The sprite layer (open architectural question)

LayeredFX is built around 3D mesh materials. The sprite-based effects (`THREE.SpriteMaterial`-based) are a different rendering path:

- Heat haze sprite cache (12123)
- Impact-sparks particle pool (18268, used by `spawnImpactSparks` 19819)
- Heat trail behind fast ships (19704, `spawnHeatTrail`)
- Electric smoke around clusters (19050, `spawnElectricSmoke`)
- `_spawnCloudHalo` puffs (12269)

**Open question:** is it worth building a `LayeredFXSpriteMaterial` sibling that takes the same preset schema but produces a screen-aligned billboard material? Or are sprites different enough (always camera-facing, no geometry, often instanced for performance) that they should stay on their own minimal shader system?

**Recommendation:** punt this until after Tranche 3. After the mesh-FX consolidation is done, revisit ; the sprite layer might naturally evolve toward a small shared sprite-shader helper without needing the full LayeredFX architecture mirrored to it.

## Leave-as-is (verified deliberate)

- **Slayer Sword Block dome** ; `_makeHexHologramMaterial`. Hex grid is the design choice, not an unfinished port.
- **Ambient cloud sprites** ; v11a billboard system with mini-cluster motion. Different architecture by design.
- **Wall SDF / triplanar texture shader** ; v14 work, its own system.

## Plan-status fields the audit also confirmed

For future cross-reference: the `doomed`-state visual is a CSS vignette + post-process `doomedWarp` uniform (no dedicated 3D effect). Spawn protection is a gameplay flag with no visual. Healing/repair effects don't exist as a system. So nothing was missed in the audit; these three were absent from the codebase, not missing from the plan.

## What this plan deliberately does NOT do

- Does not promise visual upgrade. The unconverted tail is mostly things the player won't notice converting; this is consolidation, not polish.
- Does not block other workstreams. The SSE invite system (`design_lobby_invite.md`), gmaps multiplayer (the v12-mp branch that was punted), and race-mode time-trial leaderboards (cheap, given the D1 backend is shipped) are independent and arguably higher-leverage. This plan is the "graphics consolidation tail" lane; pace it accordingly.
