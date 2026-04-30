# Last Ship Sailing v8VR: followup sprint plan

**Date opened:** 2026-04-30 (original plan: AAA-feel uplift, all 12 tasks closed)
**Date updated:** 2026-04-30 (replaced with this focused followup list)
**Baseline:** `last_ship_sailing_v8VR.html` (the AAA-uplift fork; v7.1VR remains frozen)
**Target build:** still `last_ship_sailing_v8VR.html`; this sprint extends it in place
**Format constraint:** stays a single self-contained HTML file
**Scope philosophy:** finish the polish loop on the systems already shipped; do not start new top-level systems

---

## What's already in v8VR

For reference, the previous sprint landed: Three.js r128 -> r0.165 upgrade, EffectComposer post-pipeline (bloom + ACES + SMAA), HDRI / PBR helpers, InstancedMesh debris pool, hit-feedback chain (shake + chromatic + vignette + rumble + hitstop + white-flash), Showcase mode wrapper, Web Speech ship-AI announcer with voice picker, spatial audio (HRTF panning + occlusion + multi-convolver reverb + sidechain ambient duck). All 12 original tasks completed.

The work below is the followup polish loop on top of that foundation.

---

## Sprint backlog

### 1. Convert remaining particle paths to InstancedMesh

Only the v8VR debris pool is instanced today. The legacy sprite-based smoke, impact sparks, and tracer trails still allocate per-spawn meshes / sprites. Converting them collapses dozens of draw calls per fight into single instanced calls and makes effect counts scale 5-10x without GPU cost.

Targets:
- Smoke plumes (currently per-spawn `THREE.Mesh(_SMOKE_GEO, smokeMat)` with custom shader; harder, since the shader needs to honor instance time/seed)
- Impact sparks (`spawnImpactSparks`; currently sprite-based)
- Tracer trail beads (`_TRACER_*_GEO` chain in tracer construction)
- Heat-haze sprites (`getHeatHazeSpriteMat`)

Smoke is the hardest because the existing shader uses per-mesh uniforms; sparks and tracer trails are the easy wins to do first. Pattern follows `v8Debris` from the previous sprint (single InstancedMesh, parallel `Float32Array` per attribute, round-robin allocation, scale to 0 for hide).

### 2. Cinematic round-start camera flyover

When a round transitions from warmup to play, swap the player camera onto a scripted spline path for ~2.5 seconds: pull back, orbit the arena center, push in over the player's ship, settle into normal first-person view. While on the flyover, push the EffectComposer with a `BokehPass` (depth of field) so distant ship silhouettes go soft. Hand control back the moment the FIGHT banner clears.

Touch points:
- New `cinemaCam` system parallel to `deathCam`; same lifecycle pattern
- Hook into the warmup -> playing transition (the spot where `ANN.roundStart()` fires)
- Add `BokehPass` to the cineFX composer with focus driven by the camera-to-player distance
- Restore camera and disable BokehPass when flyover ends
- Skip entirely when in VR (XR pose owns the camera)

### 3. Kill-cam slow-mo orbit on round-winning kills

When the kill that ends a round is the player's, lock the camera into a 1.5 second slow-motion orbit around the dying enemy, tracking the kill direction. Reuses `hitFX` hitstop infrastructure: hold time-dilation at ~0.25 instead of releasing after 140ms. Perfect time for `ANN.roundWon()` to land cleanly over the slow-mo.

Touch points:
- Detect "round-winning kill" inside the existing kill registration block (the one that already does multikill)
- Repurpose deathCam orbit logic with a slower angular rate and a fixed target (the dying ship) instead of a teammate
- Tie into `setShowcaseMode` so it's gated to Showcase mode only (otherwise stock matches stay snappy)

### 4. Wire the unhooked announcer lines

These are already defined in the `ANN` library but no gameplay code calls them yet. Each is a simple hook into an existing event:

- `ANN.coreReady()`: when `player.coreMeter` first crosses 100 (core ability charged)
- `ANN.dashReady()`: when `player.dashCharges` refills back to max from 0 (after a full deplete)
- `ANN.enemyLock()`: when the existing TRACKER lock-on system flags an enemy targeting the player (`player.enemyToneLockMax` rising edge)
- `ANN.ramming()`: when an enemy ship's velocity vector points at the player and is closing fast inside ~600 units
- `ANN.stasisActive()`: when `updatePlayerStasis` flips player into a stasis field
- `ANN.lowAmmo()`: when `player.clipAmmo / player.maxClip <= 0.2` and reload hasn't started

Each is two to four lines of code; the cooldowns on the lines themselves prevent spam.

### 5. Drop a real HDRI file

The HDRI loader (`setHdrEnvironment`) already wired in v8VR points at `LSS/skybox/cinematic_2k.hdr`, which doesn't exist. As long as the file is missing, Showcase mode keeps falling back to the procedural starfield envMap — meaning IBL on PBR-promoted hero ships looks identical to before. Drop a 2K equirectangular HDR (1-3MB) at that path and the next call to `setHdrEnvironment()` flips IBL on for real.

Recommended sources:
- polyhaven.com (free, CC0)
- Search terms that match the LSS aesthetic: "satara_night", "moonless_golf", "spruit_sunrise", or any sci-fi / spaceship interior HDRI
- Save as `LSS/skybox/cinematic_2k.hdr` (override path with `setHdrEnvironment('./skybox/other.hdr')`)

This is a 5-minute task that unlocks the visible-PBR difference Showcase mode is supposed to deliver.

---

## Work order recommendation

| # | Task | Est | Risk | Why this order |
|---|---|---|---|---|
| 5 | Drop HDRI file | 5 min | none | Cheapest unlock; no code change |
| 4 | Wire unhooked announcer lines | 1-2 hrs | low | Self-contained; no rendering risk |
| 3 | Kill-cam slow-mo orbit | 0.5 day | low | Reuses deathCam + hitFX; small surface |
| 2 | Cinematic round-start flyover | 1 day | medium | New camera system + BokehPass tuning |
| 1 | Smoke / sparks / tracer to InstancedMesh | 2-3 days | medium-high | Largest refactor; touches custom shaders |

Realistic clock for the whole list: ~4 working days plus the 5-minute HDRI drop.

---

## Out of scope (still)

- Native wrappers (Electron / Capacitor / Tauri); HTML stays the deliverable
- Realtime multiplayer netcode beyond what trystero already provides
- Wholesale audio replacement; spatial path is in, more line wiring is open

## Followups (post-this-sprint)

- WebGPURenderer trial (compute shaders for crowd particle sims)
- Photo Mode (free camera + post-pipeline overrides + frame export)
- Replay system (deterministic input log + camera retake)
- TWA APK for Quest sideload distribution
- `v8VR-lite.html` that strips post-pipeline for low-end devices

## Success criteria

- All five sprint items shippable independently (no inter-task dependencies)
- v8VR continues to boot cleanly and v7.1VR remains frozen / playable as the rollback baseline
- Showcase mode visibly improves with the HDRI drop
- Round-end and ability events feel announcer-supported rather than silent
- Effect counts scale up under sustained combat without FPS regression
