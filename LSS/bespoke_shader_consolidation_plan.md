# LSS Bespoke Shader Consolidation Plan

Last updated: 2026-05-08
Status: planning, ready to execute in tranches
Supersedes: the unfinished tail of `graphics_update_plan.md` (now in `old_plans/`)

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

| Effect | Current factory | Suggested preset | Notes |
|---|---|---|---|
| Engine plume cone | `_makePlumeShaderMaterial` (6158) | new: `engine_plume` | Per-ship axial scroll; preset needs a `axisScrollDir` config |
| Engine glow disc | `_makeEngineDiscMaterial` (6240) | reuse: `fireball` with thin disc geometry | Test if existing preset is close enough |
| Projectile inner glow halo | `_makeProjGlowMaterial` (6512) | new: `proj_halo` | One preset, hue-tinted per ship class (uniform override) |
| Pyro gas cloud (unignited) | `_makeGasCloudMaterial` (5282) | new: `gas_green` | Sibling preset to `cloud_lit`, swaps to `fireball` on ignite |
| Vortex Core Beam | `_makeVortexCoreBeamMaterial` (5964) | new: `core_beam` | Cylinder geo; needs axial pulse pattern |
| Tether Trap orb | `_makeOrbCoreMaterial` (7620) | reuse: `fireball_purple` | Octahedron; preset likely fits as-is |
| Tether Trap halo | `_makeGravityHaloMaterial` (7630) | new: `gravity_halo` | Outer ring with inward pull pattern |
| Stasis pickup shockwave | `_makeShockwaveMaterial` (~32093) | new: `shockwave_ring` | Expanding ring; very simple preset |
| Atom-fractal cluster rocks | `_makeAtomFractalMaterial` (16420) | new: `atom_surface` | Surface (not volume) shader; geometryHint='surface' |
| Cluster distortion shell | anon ShaderMaterial (16680) | new: `distortion_shell` | Chromatic shimmer; may need a chromatic-aberration preset feature |

Suggested order: engine plume → projectile glow → gas cloud → tether trap → core beam → shockwave → atom rocks → distortion shell. Engine effects first because they're on every ship every frame; consolidating them is the biggest "code health" win even if visual delta is small.

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
