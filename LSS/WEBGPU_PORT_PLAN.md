# Last Ship Sailing : WebGPU Port Plan

**Source**: `last_ship_sailing_v17o.html` (~55,325 lines, authoritative reference)
**Target**: `last_ship_sailing_webGPU.html` (~12,035 lines + 11 extracted JS modules)
**Engine**: Three.js r170 + WebGPURenderer + TSL
**Started**: 2026-05-17
**Last updated**: 2026-05-20
**Bugfix counter**: #240 (next tag: #241)

**Mass-port pass (2026-05-20):** A subagent swept every remaining no-op stub in webGPU.html, cross-referenced v17o for real implementations, and concluded the Phase 11 stub list is essentially complete. Most "remaining stubs" turn out to be pre-load fallbacks that get overwritten by module loads (32+ of them), skip-list items (walls, Venturi, LayeredFX shaders), XR/VR disabled paths, deferred Phase 8 lobby-browser, or deferred gmaps. Ports added : `cleanupPendingHits` (#236), `disposeAllDots` (#237), `_syncMapButtonsDisabled` (#238), `_setShipShieldEmissive` / `_clearShipShieldEmissive` (#239), `_settingsClearFocus` (#240).

**Status honesty note (2026-05-19):** previous revisions of this plan marked some phases DONE based on code-presence checks alone (functions exist, modules load, dispatch chains wire up). Actual playtest is finding real bugs in those phases. From now on, DONE means "code present AND verified by user playtest." CODE-WIRED means the path is wired but not playtested end-to-end.

---

## Status at a glance

| Phase | Status | One-line summary |
|---|---|---|
| 0  Foundation | DONE | WebGPU renderer + scene + input + boot |
| 1  Cockpit + ship | DONE | 7 ships load, frames swap, GLTFLoader works |
| 2  Weapons | DONE | All 7 chassis fire correctly via lss_v17_weapons.js |
| 3  Arenas | DONE | All 6 maps build, walls plain emissive per skip-list |
| 4  Bots | CODE-WIRED | bot.update ticks ; solo combat plays ; not stress-tested |
| 5  Abilities | CODE-WIRED | All 21 abilities + hold-prime ; Vortex/shields fixed via #208-#209 |
| 6  Cores | CODE-WIRED | All 7 cores dispatch ; not all playtested |
| 7  Multiplayer | PARTIAL | Trystero connects ; lobby flow fixed via #211-#213 ; needs re-test |
| 8  Lobby | CODE-WIRED | Ship-select + ship preview (#215, #216), settings, perks ; MP lobby flow needs verify |
| 9  HUD | DONE | Circumpunct, killfeed, scoreboard, minimap, doomed UI, name tags with LOS gate (#218) |
| 10 Sound | DONE | Synth library + spatial sound + music + announcer |
| 11 FX polish | PARTIAL | Gameplay-critical FX ported ; cosmetic polish stubs remain |
| 12 Pilot perks | CODE-WIRED | Perk registry + Auto Cloak + Syphon stack ; not playtested |
| 13 Polish + perf | ONGOING | 226 bugfixes shipped ; no bloom / no perf-tier yet |

**Status legend:**
- **DONE** : code present AND user-confirmed via playtest
- **CODE-WIRED** : code present and modules load cleanly ; user hasn't played through end-to-end yet
- **PARTIAL** : known gaps remain (listed in the phase section)
- **ONGOING** : continuous work, no terminal state

**Critical path (Phases 1, 2, 3, 4, 5, 7) is code-wired and solo + bots is playable. MP needs re-test after the #211-#213 fixes.**

---

## Skip list (intentionally excluded)

These are by design ; do not log them as gaps.

- The 19 GLSL wall patterns (Kali IFS, Apollonian, Voronoi, Mandelbox, Hex, Circuit, Caustic, Panel Maze, Wave Interference, Plasma FBM, Circumpunct, Holographic Glitch, Cellular Membrane, Warped Streaks, Hex Pulse, Cyber Datamosh, Ring Tunnel, Neon Cube, Layered Cube)
- The multi-layer composite presets (Lab Composite, Digital, Matrix, all Venturi variants)
- The Venturi corrugation system
- Triplanar texture sampling (stone, tile, metal, fabric)
- The `cosmicField` / `sampleWallPattern` shader dispatcher
- The wall_pattern_lab.html, wall_lab_v2.html, fx_lab.html tools (these stay on r128)
- The PNG cockpit frames ARE kept ; they're images, not shaders

Walls render as `MeshStandardMaterial` with emissive + roughness. Per-arena hue drift gives the rooms identity. Redesign comes after the game is fully ported.

---

## Phase 0 : Foundation (DONE)

- WebGPURenderer boot with async init + WebGPU-unsupported overlay
- Importmap pinning Three.js r170 ; loads three/webgpu namespace
- Scene + perspective camera + ACES tone mapping + sRGB color space
- Fog + ambient light + accent point lights at PBR scale
- Pointer lock + WASD + Space/Ctrl + mouse look + gamepad input
- FPS / position pill, crosshair HUD
- Async module loader for the 11 lss_v17_*.js files with cache-busting

---

## Phase 1 : Player ship + cockpit (DONE)

- GLTFLoader port (works as-is in r170) ; loads all 7 .glb files from ships/
- buildModelShipMesh (webGPU.html:6792) ports v17's mesh walker
- First-person mount + player.mesh.visible = false in cockpit view
- Cockpit frame stack DOM layers : #gun-layer, #ability-overlay-frame, #cockpit-frame
- Off-thread PNG decode + frame cache + cache-bust
- Directional shift on non-frame layers via yaw/pitch delta
- Damage-shake hook wired through triggerScreenShake
- Per-ship frame swap (lss_v17_cockpit.js : preload + tick)

---

## Phase 2 : Weapons (DONE)

- Loadout data block (lss_v17_data.js : LOADOUTS, CHASSIS, PILOT_PERKS, MAP_DATA)
- Projectile class (lss_v17_weapons.js:5) : mesh + trail + smoke + glow
- fireWeapon dispatch with hitscan / projectile / spread modes
- fireHitscan + raycastLevel for SDF wall intersection (webGPU.html:2762)
- Clip ammo + reload state + spinup (Blaster Gatling)
- Tracer effects routed via painted-barrel split (bugfix #217)
- Muzzle visuals now owned by the painted PNG gun frames ; 3D world flash suppressed (bugfix #222)
- Per-ship muzzle origin from `_PLAYER_MAIN_MUZZLE_FRAC` / `_PLAYER_LAUNCHER_FRACS`
- Spiral railgun trail for Puncture

---

## Phase 3 : Arenas (DONE)

- levelWorker (lss_v17_arena.js) : marching cubes off-thread
- buildRoomGraphLevel + SDF room generation
- MAP_DATA registry (6 tunnel layouts + race mode + gmaps slots)
- Per-arena room palette with hue drift
- Wall material : MeshStandardMaterial + emissive + roughness (no patterns ; skip-list)
- Dynamic objects : atom clusters, cylinders, organic blobs (geometry only)
- Stasis field placement (Phase K) + slow-zone effect
- Spawn points per team
- spawnDynamicObjects + spawnOrganics ; shader-heavy materials swapped for plain emissive

---

## Phase 4 : Bot AI (CODE-WIRED)

- Bot class (lss_v17_bots.js:207) with per-chassis tuning
- bot.update(dt) ticked from main loop (webGPU.html:8524)
- Movement : pursue, strafe, flee on low HP
- Aim leading + fire-when-in-cone
- Ability dispatch (simplified bot version, not hold-prime)
- Death + respawn + team assignment + kill credit (bugfix #214 wires respawn via window._roundTimerTick)
- Damage states (emitDamageState ticks particles per HP tier)
- animateShipMesh ticks engine plumes / running lights / barrel recoil for bots

---

## Phase 5 : Abilities (CODE-WIRED — all 21)

- Three-slot ability state + cooldown / active / hold timers
- abilityInputPress / abilityInputRelease hold-to-prime model
- _canPrimeAbility prereq checks (energy gates, lock gates, charge gates)
- Per-ability frame overlay (slide-in / hold / slide-out, per-ability PNG)

**Vortex**: Laser, Vortex Shield (hold-drain + lockout), Plasma Mines
**Pyro**: Flame Chain (#223 added damage + flame licks), Fire Shield (#224 added flame cone), Explosive Gas (#219 added chemistry)
**Puncture**: Cluster Missile, Afterburner, Stasis Trap
**Slayer**: Stun Bolt, Absorption (hold), Teleport (phase-invuln)
**Tracker**: Tracker Rockets (lock-gated), Plasma Shield (#207 ported), Sonar Pulse
**Blaster**: Charge Shot, Body Shield (HP pool), Range Mode (toggle)
**Syphon**: Rocket Salvo, Energy Syphon, Inner Spark

Shield damage clone visual now hugs the hull for all four hold-to-use shields (#225).

---

## Phase 6 : Cores (CODE-WIRED — all 7)

- Core meter accumulation (damage + time) + 100% activation gate
- **Vortex** Mega Laser : 4 s sustained beam
- **Pyro** Mega Flame Chain : instant AoE + 3 radiating trails + gas chain ignition (#219)
- **Puncture** Mega Barrage : speed boost + rocket stream from painted launchers
- **Slayer** Mega Stun Bolt : lightning storm + bolt flurry
- **Tracker** Mega Tracker Rockets : 3 s remote-guided swarm
- **Blaster** AI Assist : 10 s auto-aim + unlimited ammo
- **Syphon** AI Nanobots : 3-tier permanent upgrades
- Core frame overlay slides in for the duration
- Per-core sound + spectacle

---

## Phase 7 : Multiplayer (PARTIAL — needs re-test after #211-#213)

### Confirmed working
- Trystero room creation / join : two clients connect cleanly
- Peer state broadcast, hit consensus, effect broadcast (code-wired, not stress-tested)

### Bugs found in playtest (all fixed)

| Bug | Cause | Fix |
|---|---|---|
| Bots appear in MP | Boot-time `spawnBots()` (webGPU.html:10457) fired unconditionally | #211 gate boot spawnBots on `!net.active` |
| Match starts the moment peers connect | Boot defaults `player.loadoutKey = 'VORTEX'` ; auto-broadcast as commit | #213 wrap `joinRoom` : null out loadoutKey + clear game.entities |
| Players never see ship-select / map-select | Same root cause | #213 fixes the side-effect |
| 6s defensive fallback in commitLoadout wrap could force playing state on MP | Setting state ignored `net.active` | #212 add `if (window.net && window.net.active) return;` guard |

### Still untested (need MP playtest)

- READY handshake : do both peers see + click the READY button ?
- enterShipSelect on both peers after match_start proposal
- Both peers commit + scheduleLaunch broadcasts launch_at + countdown syncs
- Loadout sync : peer ship select visible on the other side
- Match state sync (warmup countdown shared, round timer shared, score sync)
- Spectator camera for dead players in MP
- Killfeed broadcast across peers
- Effect broadcast across peers (lightning, tracers, particle walls, firewalls, gas pockets)
- 3-tier hit consensus actually resolves hits in MP

### NetworkPlayer ghost ship class : code-wired, behavior untested

---

## Phase 8 : Lobby / settings (CODE-WIRED)

- Ship-select panel with 7 ship cards + descriptions
- Ship preview renderer (WebGPURenderer wrapper #215 + per-frame material sweep #216)
- Loadout descriptions + ability summaries
- Pilot perk picker
- Settings panel : graphics tier, audio (master + per-bus), controls (keyboard + gamepad rebind, sensitivity)
- Lobby room code share + join (Discord-gated lobby browser is deferred)
- Ready / not-ready state
- Map selector + race mode toggle

---

## Phase 9 : HUD (DONE)

- Circumpunct HUD (canvas-based central ring overlay)
- Health, shield, core meter rings
- Ammo + reload indicator
- Ability cooldown HUD (pie segments)
- Minimap (top-down arena projection at 20 Hz)
- Killfeed
- Scoreboard (tab)
- Damage indicators (directional edge flashes)
- Doomed warning + vignette
- Enemy lock-on warning (Tracker locks)
- Match end screen with stats
- Ship name tags with LOS gate (#218) ; tags hide when occluded by walls

---

## Phase 10 : Sound (DONE)

- Synth recipe library (Web Audio API, lss_v17_audio.js)
- Spatial sound for 3D effects (playSpatialSound)
- Music patterns (warmup, combat, intensity ramping)
- Per-class ability sounds
- Ambient bed loop
- Announcer (ship welcome, kill streaks, doomed alert, core ready, low ammo, dash ready, stasis active, multiple hostiles)

---

## Phase 11 : Effects FX TSL ports (PARTIAL)

### Already shipped (good-enough fallbacks live, gameplay correct)

- Tracer : LineBasicMaterial line with painted-barrel split (#217)
- Lightning bolt : 4-segment jagged geometry (works ; full multi-segment tube pending)
- Smoke : billboard particles (works ; volumetric upgrade pending)
- Fractal atom : emissive sphere cluster (works ; IFS shader pending)
- Projectile glow : MeshBasicMaterial additive (works ; core_beam TSL pending)
- Vortex Laser core beam : cylinder fallback (works ; uses `_makeFXMaterial` proxy)
- Explosion : multi-stage hull burst (works fully)
- Impact sparks (#206) : v8Sparks InstancedMesh pool
- Dynamic light pool : pointLight pool working
- Smoke-flash piggyback : co-trigger working
- Stasis field : emissive cylinder (gameplay correct ; full shader pending)
- TRACKER Plasma Shield (#207) : additive BoxGeometry + wireframe ; collision works
- Pyro gas chemistry (#219) : full chain reaction + sustained burn damage
- Pyro Flame Chain (#223) : visible flame curtain + damage tick
- Pyro Fire Shield (#224) : forward cone of fire particles tied to damage cone
- Shield damage clones (#225) : ellipsoid hull-hug shields for all 4 holdable shields
- Heat trail (#226) : warm particle trail behind fast movers

### Still truly stubbed (cosmetic only ; no gameplay impact)

- `flashFXMaterialHit` — FX material flash on hit
- `_releaseLightningSlot` / `_releaseHeatTrail` / `_releaseExplosionMesh` / `_releaseParticleSlot` — FX pool releases
- `spawnHitstop` — slow-mo on big hits
- `cullOldestParticle` — particle pressure relief
- `_spawnSlayerCoreStormFX` — SLAYER core storm
- `updateGasLighting` / `updateBCSLighting` / `updateBCSWakes` / `updateAmbientCloudWakes` — atmosphere lighting

---

## Phase 12 : Pilot perks (CODE-WIRED)

- Perk registry (PILOT_PERKS in lss_v17_data.js)
- Apply perk on loadout commit (shield bonus, dash bonus)
- Auto Cloak (core-meter-triggered opacity drop, broadcast bit)
- Syphon-stack perk (per-kill tier escalation)
- Other passive perks + Nano Repair regen via _tickPerkEffects
- Outline Optics : deferred (needs _mirrorMeshTree backface clone ; #225 uses ellipsoid wrap instead)

---

## Phase 13 : Polish + perf (ONGOING)

- **226 bugfixes shipped** ; see inline `bugfix YYYY-MM-DD #N` tags
- Damage shake + hit flash tuning : done
- Per-perf-tier graphics quality : forced QUALITY.isPotato() path ; full tier picker not wired yet
- Bloom pass : not yet (Three.js postprocessing or custom)
- Performance profile vs WebGL v17 : not measured
- Migration guide : not written
- Final QA pass : Phases 0-4 well-tested, Phases 5-13 lightly tested

---

## Recent fixes table

| Tag | What |
|---|---|
| #206 | v8Sparks InstancedMesh impact pool ported |
| #207 | TRACKER Plasma Shield (spawnParticleWall) ported |
| #208 | updateAbilities tail post-tick : Vortex regen + Blaster transition + Charge Shot + core meter freeze |
| #209 | playerTakeDamage defensive layer : Vortex / Slayer / Body / Fire absorption + Stun Bolt counter |
| #210 | Stasis / warmup branch : gamepad look + pitch clamp outside lock guard |
| #211 | Boot spawnBots gated on `!net.active` |
| #212 | commitLoadout 6s fallback gated on `!net.active` |
| #213 | joinRoom wrap : reset state for clean MP slate |
| #214 | gameLoop calls window._roundTimerTick (round-end multi-fire) |
| #215 | WebGLRenderer stub → real WebGPURenderer wrapper for ship preview |
| #216 | Preview renderer per-frame material sweep |
| #217 | spawnTracer override : _overlayShift composition + velocity comp |
| #218 | Ship name tag LOS gate via raycastLevel |
| #219 | igniteNearbyGas + spawnIncendiaryGas (Pyro chemistry + chain reaction) |
| #220-#222 | fireWeapon muzzle visuals (3 iterations ; settled on suppressing 3D flash) |
| #223 | _buildFlameChainFlameLicks + attached firewall `_tick` damage handler |
| #224 | _spawnThermalShieldFire + updateShieldVisuals wiring |
| #225 | _makeHullHugShield / _disposeShieldClone (ellipsoid wrap) |
| #226 | spawnHeatTrail particle-based fallback |

---

## Known small-rule gaps (verified)

1. **Outline Optics perk visual** — perk's stat bonus applies on commit but the visible backface outline doesn't render. Needs `_mirrorMeshTree` from v17's shield system. The simpler `_makeHullHugShield` in #225 uses an ellipsoid instead of the mirrored tree.

### Lesson learned (2026-05-19)

The audit agent's "DONE" claim for Phase 7 was wrong. It checked that functions existed and modules loaded but didn't notice the boot bootstrap was pre-populating player state in a way that broke MP at runtime. Going forward :

- DON'T mark a phase DONE based on grep / code-presence alone.
- DO mark phases CODE-WIRED until the user (or me) actually playtests end-to-end.
- DO trace every state initialization at boot and ask "would this leak into a path where it shouldn't?" Specifically: boot-time defaults that look like user choices (loadout, ship mesh, bots, etc.) need to be invalidated when entering a clean-slate path (MP, returnToRootMenu, etc.).

---

## Critical path (shortest to playable)

1. Phase 1 (cockpit) ✓ DONE
2. Phase 2 (weapons) ✓ DONE
3. Phase 3 (arena) ✓ DONE
4. Phase 4 (bots) ✓ CODE-WIRED
5. Phase 5 (abilities) ✓ CODE-WIRED
6. Phase 7 (multiplayer) ⚠ PARTIAL (needs re-test after #211-#213)

Solo + bots is playable. MP needs re-test. Remaining work is Phase 11 cosmetic FX and Phase 13 perf tuning.

---

## Suggested next ports

1. **Re-test MP end-to-end** with the #211-#213 fixes
2. **Playtest the FX ports** (#219, #223-#226) — Pyro gas + Flame Chain + Fire Shield + shield clones should all be visible in-game
3. **`flashFXMaterialHit`** — shield-hit FX flash, visual only
4. **`_spawnSlayerCoreStormFX`** — Slayer Mega Stun Bolt core lightning storm, visual only
5. **Per-perf-tier graphics quality picker** — tier selection in settings + per-tier toggles for shadows / bloom / particle cap / dynamic light count
6. **Bloom pass** — Phase 13 polish

---

## Future-state items (post-port)

- New wall design replacing the 19 patterns (TSL-native, designed for WebGPU strengths)
- WebGPU compute shader for marching cubes
- Volumetric fog as a compute pass
- GPU particle simulation (instanced + compute-updated)
- Music synthesis on GPU
- Custom postprocess stack (motion blur, depth-of-field, lens distortion)

---

## Tracking

Each non-trivial fix lands with a `(bugfix YYYY-MM-DD #N)` comment in the source. Counter is monotonic ; current high-water mark is #226. The full grep of the bugfix tags is the canonical changelog ; no separate CHANGELOG file is maintained.
