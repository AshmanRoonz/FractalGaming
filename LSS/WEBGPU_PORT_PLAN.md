# Last Ship Sailing : WebGPU Port Plan

**Source**: `last_ship_sailing_v17.html` (and forks: `v17o.html` with perf opts, `v17a.html` with Venturi)
**Target**: `last_ship_sailing_webGPU.html`
**Engine**: Three.js r170 + WebGPURenderer + TSL
**Started**: 2026-05-17

---

## Skip List (deferred or replaced later)

These are intentionally excluded from the port. Most will be redesigned from scratch rather than ported.

- The 19 GLSL wall patterns (Kali IFS, Apollonian, Voronoi, Mandelbox, Hex, Circuit, Caustic, Panel Maze, Wave Interference, Plasma FBM, Circumpunct, Holographic Glitch, Cellular Membrane, Warped Streaks, Hex Pulse, Cyber Datamosh, Ring Tunnel, Neon Cube, Layered Cube)
- The multi-layer composite presets (Lab Composite, Digital, Matrix, all Venturi variants, etc.)
- The Venturi corrugation system (the wall pattern lab in `wall_pattern_lab.html` and its variants in `v17a`)
- Triplanar texture sampling (stone, tile, metal, fabric)
- The `cosmicField` / `sampleWallPattern` shader dispatcher
- The `wall_pattern_lab.html`, `wall_lab_v2.html`, `fx_lab.html` lab tools (these stay on r128; not part of the game)
- The PNG cockpit frames in `frames/` ARE kept ; they're images, not shaders

Walls become a single TSL material with emissive + roughness that we'll redesign once the rest of the game is ported. Expect a 30+ prompt savings versus a faithful pattern port.

---

## Phase 0 : Foundation (DONE)

What's already shipped in `last_ship_sailing_webGPU.html`:

- WebGPURenderer boot with async init
- WebGPU-unsupported overlay with clear error message
- Importmap pinning Three.js r170
- Scene + perspective camera + ACES tone mapping + sRGB color space
- Fog
- Ambient + three accent point lights at PBR scale
- Inverted-normal tunnel geometry (two rooms + cylinder)
- Eight neon-ring corridor accents
- Pointer lock + WASD + Space/Ctrl + mouse look
- Hitscan tracer + visual hit confirmation on a target dummy
- FPS / position status pill
- Crosshair HUD

Lines: ~550. Foundation is solid. Confirmed running.

---

## Phase 1 : Player ship + cockpit frame stack (~6-10 prompts)

Goal: replace the "flying camera" with an actual ship + cockpit frame layer underneath.

- Port GLTFLoader (works as-is in r170 WebGPU)
- Load the seven ship .glb files from `ships/`
- First-person mount: ship mesh slightly forward + below camera so it's visible to the player
- Cockpit frame stack from v17 (three DOM layers behind the renderer): `#gun-layer`, `#ability-overlay-frame`, `#cockpit-frame` with the new `frame_<SHIP>.png` / `gun_<SHIP>.png` / etc. naming
- Off-thread PNG decode (already implemented in v17, near-direct port)
- Directional shift on non-frame layers (per-frame yaw/pitch delta drives translate)
- Damage-shake hook on frame layer
- Test deliverable: load each of seven ships, see cockpit + ship-from-inside

**Output**: ship loadout commit works, cockpit frames swap correctly per ship.

---

## Phase 2 : Weapon system (~8-12 prompts)

Goal: full weapon dispatch for all 7 chassis.

- Loadout data block (already pure data, copies over directly)
- Weapon firing dispatch: `hitscan` / `projectile` / `spread` modes
- `fireWeapon`, `fireHitscan`, `fireProjectile`, `fireSpread`
- Projectile class with mesh + smoke trail option + impact handler
- Clip ammo + reload state + spinup state (Blaster Gatling Cannon)
- Muzzle flash light (point light pool)
- Recoil camera kick + screen shake
- Tracer effects per chassis (currently a simple line; expand to colored core + tail later)
- Per-ship muzzle origin (the painted muzzle position work from v17 ports directly: `_PLAYER_MAIN_MUZZLE_FRAC`, `_PLAYER_LAUNCHER_FRACS`)
- Spiral railgun trail for Puncture
- Test deliverable: each of seven weapons fires correctly, hits register, reloads work

**Output**: full main-weapon parity with v17.

---

## Phase 3 : Marching cubes arena + level build (~6-10 prompts)

Goal: build actual game arenas instead of the placeholder tunnel.

- Port `levelWorker` (already runs in a Web Worker, no renderer dependency)
- Port `buildRoomGraphLevel` and the SDF room generation
- Port `MAP_DATA` registry (six tunnel layouts + race mode + gmaps)
- Per-arena room palette (per-room base hue, drift over time)
- Wall material: plain `MeshStandardMaterial` with emissive + roughness (skip-list: no patterns yet)
- Dynamic objects: atom clusters, cylinders, organic blobs (geometry only, no patterns)
- Stasis field placement and effect
- Spawn points per team
- `spawnDynamicObjects` and `spawnOrganics` minus shader-heavy materials
- Test deliverable: each of the six tunnel maps builds, walls render, dynamic objects spawn

**Output**: arenas exist and are flyable. No patterns yet ; walls are plain emissive.

---

## Phase 4 : Bot AI (~6-10 prompts)

Goal: bots that fly, shoot, use abilities, fight each other.

- Port Bot class with per-chassis behavior tuning
- Movement: pursue, strafe, flee on low HP
- Aim leading, fire-when-in-cone logic
- Ability dispatch (the simplified bot version, not the player hold-prime version)
- Death + respawn
- Team assignment + kill credit
- Damage states (emit particles on low HP)
- Test deliverable: solo match with 4 bots, they fight, kill, respawn

**Output**: solo gameplay against bots works.

---

## Phase 5 : Player ability system (~12-20 prompts)

Goal: all 21 player abilities + hold-to-prime input model.

- Three-slot ability state (offensive / defensive / utility)
- Cooldown timers, active timers, hold-state
- Hold-to-prime input wrapping (already designed in v17: `abilityInputPress` / `abilityInputRelease`)
- Per-ability prereq checks (`_canPrimeAbility`)
- Ability frame overlay system (slide-in, hold, slide-out, with per-ability frame files)
- Abilities by chassis:
  - **Vortex**: Laser (energy-cost), Vortex Shield (hold-drain), Plasma Mines
  - **Pyro**: Flame Chain (firewall), Fire Shield (hold), Explosive Gas (charge-based)
  - **Puncture**: Cluster Missile, Afterburner, Stasis Trap
  - **Slayer**: Stun Bolt, Absorption (hold), Teleport (phase-invuln)
  - **Tracker**: Tracker Rockets (lock-gated), Plasma Shield, Sonar Pulse
  - **Blaster**: Charge Shot, Body Shield (HP-pool), Range Mode (toggle)
  - **Syphon**: Rocket Salvo, Energy Syphon (instant zap), Inner Spark (reset cooldowns)
- Ability HUD pie + cooldown indicators
- Per-ability sound dispatch
- Test deliverable: every ability fires, behaves correctly, sounds, applies damage

**Output**: full ability parity.

---

## Phase 6 : Core abilities (~6-10 prompts)

Goal: 7 core implementations + core meter charging.

- Core meter accumulation (damage dealt + time-based)
- Core activation gate (100% meter required)
- **Vortex**: Mega Laser (4 s sustained beam, alternating L/ML frame)
- **Pyro**: Mega Flame Chain (instant AoE + three radiating trails)
- **Puncture**: Mega Barrage (5 s speed + rocket stream from painted launchers)
- **Slayer**: Mega Stun Bolt (lightning storm + bolt flurry for 5 s)
- **Tracker**: Mega Tracker Rockets (3 s remote-guided swarm from launchers)
- **Blaster**: AI Assist (10 s auto-aim, unlimited ammo, core frame overlay)
- **Syphon**: AI Nanobots (3-tier permanent upgrades)
- Core frame overlay (already designed)
- Per-core sound + spectacle
- Test deliverable: each core activates, sustains, ends, applies effect

**Output**: full core parity.

---

## Phase 7 : Multiplayer (~8-12 prompts)

Goal: Trystero-backed peer-to-peer matches.

- Trystero room creation / join (no renderer dependency, direct port)
- Peer state broadcast (use pooled state object from v17o)
- NetworkPlayer ghost ship class
- Interp + extrapolation between state packets
- Loadout sync (peer ship select)
- Hit consensus (the 3-tier system: claim → vote → resolve)
- Match state sync (warmup countdown, round timer, scores, match end)
- Spectator camera for dead players
- Killfeed broadcast
- Effect broadcast (lightning, tracers, ability projectiles)
- Test deliverable: 2-player MP works, 4-player MP works, no desyncs

**Output**: full MP parity.

---

## Phase 8 : Lobby / ship-select / settings (~6-10 prompts)

Goal: full pre-match UI.

- Ship-select panel with seven ship cards
- Ship thumbnail baking from .glb (one-time at boot)
- Ship preview renderer (small isolated renderer in the lobby)
- Loadout descriptions + ability summaries
- Pilot perk picker
- Settings panel: graphics (perf tier, fog, bloom), audio (master + per-bus), controls (keyboard rebind, gamepad rebind, sensitivity)
- Lobby room code share + join
- Ready / not-ready state
- Map selector
- DROP / gmaps input (or skip if not porting gmaps)
- Test deliverable: full lobby flow from boot to launch

**Output**: lobby + settings work end-to-end.

---

## Phase 9 : HUD + scoreboard + killfeed (~5-8 prompts)

Goal: full in-game UI.

- Circumpunct HUD (the canvas-based central ring overlay)
- Health, shield, core meter rings
- Ammo + reload indicator
- Ability cooldown HUD
- Minimap (top-down arena projection)
- Killfeed
- Scoreboard (tab)
- Damage indicators (directional edge flashes)
- Doomed warning + vignette
- Enemy lock-on warning (Tracker locks)
- Match end screen with stats
- Test deliverable: HUD reads correctly in all match states

**Output**: in-game HUD parity.

---

## Phase 10 : Sound (~3-5 prompts)

Goal: full audio.

- Port the synth recipe library (Web Audio API, no renderer dependency)
- Spatial sound for 3D effects
- Music patterns (warmup, combat, intensity ramping)
- Per-class ability sounds
- Ambient bed loop
- Announcer (ship welcome, kill streaks, doomed alert)
- Optional: hook into browser TTS for procedural callouts (the discussion from earlier)
- Test deliverable: every action has audible feedback

**Output**: audio parity.

---

## Phase 11 : Effects FX TSL ports (~10-15 prompts)

Goal: visual polish layer; each effect type ported from GLSL to TSL.

- Tracer (line + tail + bright core)
- Fractal lightning bolt (the heavy one; multi-segment jagged geometry)
- Smoke (volumetric / billboard hybrid)
- Fractal atom (cluster center self-illumination)
- Shield materials (plasma_cyan, plasma_purple, plasma_red, plasma_green, plasma_amber, plasma_wall)
- Projectile glow (LayeredFX core beam)
- Vortex Laser core beam
- Explosion (multi-stage hull burst + plumes)
- Impact sparks
- Stasis field shader
- Gas chemistry pockets (atoms ignite + propagate)
- Dynamic light pool + smoke-flash piggyback (already optimized in v17o, near-direct port)
- Test deliverable: visual feedback matches v17 within reasonable fidelity

**Output**: full FX parity (or "good enough" placeholder per effect).

---

## Phase 12 : Pilot perks (~2-4 prompts)

Goal: per-perk runtime effects.

- Perk registry (already pure data)
- Apply perk on loadout commit (shield bonus, dash bonus, etc.)
- Auto Cloak perk (core-meter-triggered opacity drop, broadcast bit)
- Syphon-stack perk (per-kill tier escalation)
- Other passive perks
- Test deliverable: each perk applies correctly

**Output**: perk parity.

---

## Phase 13 : Polish + perf tuning (~10-20 prompts)

Goal: ship-ready build.

- Performance profile vs WebGL v17 build
- Per-perf-tier graphics quality (potato / low / high)
- Bloom pass on WebGPU (use Three.js postprocessing if available, else write custom)
- Damage shake / hit flash tuning
- Bug fixes from playtesting
- Migration guide for users coming from v17
- Final QA pass with multiple peers
- Test deliverable: builds feel as good or better than v17

**Output**: shippable WebGPU build.

---

## Total estimated prompts

| Path | Prompts |
|---|---|
| Minimum viable (Phases 1, 2, 3, 4, 5, 7) | 40-65 |
| Full single-player (add 6, 8, 9, 11, 12) | 70-100 |
| Full parity (everything + polish 13) | 85-150 |

Realistic with debugging overhead and discovery: budget 2x the optimistic count. So 80-200 prompts total to genuine v17 parity, spread across however many sessions you want.

---

## Critical path (shortest to playable)

1. **Phase 1** (cockpit) → see your own ship
2. **Phase 2** (weapons) → shoot stuff
3. **Phase 3** (arena) → real maps
4. **Phase 4** (bots) → solo opponents
5. **Phase 5** (abilities) → full combat
6. **Phase 7** (multiplayer) → play with friends

Six phases. Estimated 40-65 prompts to a playable game. Walls will be plain emissive throughout; that's the skip list at work.

Phases 6 (cores), 8 (lobby polish), 9 (HUD), 10 (sound), 11 (FX polish), 12 (perks), 13 (polish) are optional layers on top. Decide per-phase whether the time investment is worth the fidelity.

---

## Future-state items (post-port, post-walls)

These come AFTER the game is fully ported. Don't tackle until the rest is done.

- New wall design replacing the 19 patterns (TSL-native, designed for WebGPU strengths)
- WebGPU compute shader for marching cubes (massive level-build speedup, enables real-time arena variation)
- Volumetric fog as a compute pass
- GPU particle simulation (instanced + compute-updated)
- New cosmetic upgrades
- Procedural ship hull variations
- Music synthesis on GPU
- Custom postprocess stack (motion blur, depth-of-field, lens distortion)

---

## Tracking

Each phase ends with a `// Phase N : <name> (done)` comment block in the webGPU file marking the milestone. Plan tasks per phase in the TaskCreate tool so we can see the gauge advance.

If at any point the WebGPU build feels meaningfully better than v17 (lower latency, smoother framerate, less stutter), consider declaring victory early and merging back into v17a / v17o as the new mainline.
