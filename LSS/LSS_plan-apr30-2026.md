# Last Ship Sailing: AAA-feel uplift plan

**Date:** 2026-04-30
**Baseline:** `last_ship_sailing_v7_1VR.html` (frozen as known-good)
**Target build:** `last_ship_sailing_v8VR.html` (fork; all work below lands here)
**Format constraint:** stays a single self-contained HTML; no Electron / Capacitor / Tauri wrappers
**Scope philosophy:** at least one game mode (Cinematic Arena / Showcase) reaches AAA presentation; other modes inherit improvements opportunistically

---

## What v7.1VR already has

- 7 ship classes: BLASTER, PUNCTURE, PYRO, SLAYER, SYPHON, TRACKER, VORTEX
- FFA + Team modes; custom maps; loadouts
- Bot AI with collision, pathfinding, targeting
- Mouse, keyboard, gamepad, WebXR (VR) input
- Procedural Web Audio synthesis (oscillators, gain, buffers; 21 createGain, 7 createOscillator)
- 44 custom ShaderMaterials, envMap usage, custom "glow" shader tricks
- Companion lab tools: `map_lab.html`, `sound_lab.html`, `wall_pattern_lab.html`
- Cockpit PNG frame art per ship in `./frames/`

## What v7.1VR is missing (perceptual gap to AAA)

- No post-processing pipeline (no EffectComposer, no real bloom; one toneMapping reference)
- 41 MeshBasicMaterial usages; hero ships are not PBR
- envMap referenced but no PMREM / HDRI pipeline
- Zero InstancedMesh; particles are 28 Sprites + 4 Points (draw-call bound)
- No real shadows, no SSAO, no SMAA/FXAA/TAA
- No hit-stop, no chromatic aberration, no rumble chain on damage
- Procedural SFX, no spatialization (PannerNode), no reverb (ConvolverNode)
- Three.js r128 (Dec 2021); behind ~5 years of engine improvements

---

## The five force multipliers (priority order)

### 1. Real post-processing pipeline (biggest perceptual jump per hour)
`EffectComposer -> RenderPass -> UnrealBloomPass -> SMAAPass -> OutputPass`
+ `renderer.toneMapping = ACESFilmicToneMapping`
+ `renderer.outputColorSpace = SRGBColorSpace`
Existing emissive materials, tracers, explosions, shield rims start reading correctly.

### 2. InstancedMesh particle conversion
28 Sprites + 4 Points -> InstancedMesh pools. Convert `_EXPL_POOL`, `_TRACER_*_GEO`, smoke, sparks, debris. Unlocks 10,000+ instance counts at ~1 draw call per type. Crank debris 10x; add weather (embers, ash) at scale.

### 3. HDRI + IBL + PBR for hero ships
Load 2K HDRI (Polyhaven), run `PMREMGenerator`, assign `scene.environment`. Promote ship hulls from `MeshBasicMaterial` / `MeshPhongMaterial` to `MeshStandardMaterial` with metalness, roughness, clearcoat, and emissive accents.

### 4. Hit-feedback density chain
Per damage event, stack: camera shake (damage-scaled) + chromatic aberration pulse + vignette pulse + gamepad dual-rumble + white-flash material override (60ms) + audio sidechain duck + hitstop time dilation (`dt *= 0.1` for 80ms on kills). The "juice" that separates indie from Doom Eternal.

### 5. Three.js engine upgrade (r128 -> current)
Unlocks:
- WebGPURenderer (compute shaders, ~2-3x particle headroom)
- TSL (Three.js Shading Language): JS-side shader authoring
- BatchedMesh (better than InstancedMesh for varied meshes)
- proper transmission / refraction / clearcoat / sheen / iridescence
- improved shadow maps

Breaking changes to fix:
- `outputEncoding` -> `outputColorSpace`
- `sRGBEncoding` -> `SRGBColorSpace`
- `physicallyCorrectLights` removed (units default-correct now)
- `useLegacyLights` flag handling
- GLTFLoader now in `examples/jsm/loaders/`
- some material property defaults changed

---

## Showcase / Cinematic Arena mode

A single mode that turns every dial up. One ship, one map, one game type. Other modes stay on the existing v7.1 visual budget so we do not regress competitive play.

For Showcase only:
- post-processing: bloom + ACES + SMAA + optional SSAO + optional motion blur
- HDRI sky + IBL + real shadows (PCFSoftShadowMap, cascaded if budget allows)
- one signature volumetric god-ray (port of Three.js Volumetric Light Scattering example)
- hero ship: high-poly GLTF with PBR + clearcoat + dirt/scratch normal map
- ocean: FFT/Gerstner shader with foam (or paid Three.js ocean shader, ~$20)
- particles: all instanced, debris budget 10x
- audio: recorded SFX (or synth output baked) routed through ConvolverNode reverb (arena IR) + PannerNode 3D positional
- announcer: ~50 voice lines (round start, kills, multikills, ship destroyed, victory) via TTS or recorded
- cinematic round-start camera flyover with `DepthOfFieldPass` and FOV ease
- kill-cam: 1.5s slow-mo orbit on round-winning kill
- HUD micro-animations (telemetry tick-up, ability ready pulse, lock-on pip chase)

---

## Work breakdown (sequenced)

| # | Task | Est | Risk | Unblocks |
|---|---|---|---|---|
| 1 | Fork v7.1VR -> v8VR | 5 min | none | everything |
| 2 | Three.js r128 -> current upgrade | 1-2 days | medium (API breaks) | post-pipeline, PBR, future WebGPU |
| 3 | EffectComposer + bloom + ACES + SMAA | 1 day | low | the visible AAA jump |
| 4 | HDRI + PMREM + PBR hero ships | 1 day | low | cinematic lighting |
| 5 | Particles -> InstancedMesh | 2 days | medium (refactor surface) | scale-up effects |
| 6 | Hit-feedback chain (shake, chroma, hitstop, rumble) | 1 day | low | game feel |
| 7 | PannerNode 3D audio + ConvolverNode reverb | 0.5 day | low | aural depth |
| 8 | Announcer voice lines + voice queue | open-ended | low | mode polish |
| 9 | Showcase Mode wrapper (one ship + one map) | 0.5 day | low | the showpiece |
| 10 | Smoke test v8VR (lobby, match, no console errors) | ongoing | n/a | release confidence |

Realistic clock: ~8 working days for a Cinematic Arena that surprises people.

## Explicitly out of scope

- Native wrappers (Electron / Capacitor / Tauri); HTML stays the deliverable
- Realtime multiplayer netcode (multi-month project, doesn't change feel)
- Wholesale replacement of procedural audio synth (route through reverb instead; keep the labs)
- Custom WebGPU shaders before the Three.js upgrade lands

## Success criteria

- v8VR opens in modern Chrome / Edge / Quest Browser without console errors
- Showcase mode renders with bloom + ACES + IBL + instanced particles
- Hit on enemy produces: visual flash + camera shake + chroma pulse + rumble + 3D-positioned impact sound + reverb tail + hitstop on kill
- VR mode still works (WebXR session start in Quest Browser)
- v7.1VR untouched and remains playable as the baseline

## Notes on backwards compatibility

- v7.1VR `localStorage` keys can be re-used by v8VR; settings carry over
- `./frames/` cockpit PNGs are unchanged
- Maps from `maps/` and walls from `walls/` should still load
- Custom map JSON schema must remain compatible; if extended, add an optional version field

## Followups (post-Showcase)

- WebGPURenderer trial path
- Photo Mode (free camera + post-pipeline overrides + frame export)
- Replay system (deterministic input log + camera retake)
- TWA APK packaging for Quest sideload distribution
- A `v8VR-lite.html` build that strips post-pipeline for low-end devices
