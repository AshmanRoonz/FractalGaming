# Last Ship Sailing : WebGPU Port Plan

**Source**: `last_ship_sailing_v17o.html` (~55,325 lines, authoritative reference)
**Target**: `last_ship_sailing_webGPU.html` (~12,035 lines + 11 extracted JS modules)
**Engine**: Three.js r170 + WebGPURenderer + TSL
**Started**: 2026-05-17
**Last updated**: 2026-05-20
**Bugfix counter**: #339 (next tag: #340)

**Mass-port pass (2026-05-20):** A subagent swept every remaining no-op stub in webGPU.html, cross-referenced v17o for real implementations, and concluded the Phase 11 stub list is essentially complete. Most "remaining stubs" turn out to be pre-load fallbacks that get overwritten by module loads (32+ of them), skip-list items (walls, Venturi, LayeredFX shaders), XR/VR disabled paths, deferred Phase 8 lobby-browser, or deferred gmaps. Ports added : `cleanupPendingHits` (#236), `disposeAllDots` (#237), `_syncMapButtonsDisabled` (#238), `_setShipShieldEmissive` / `_clearShipShieldEmissive` (#239), `_settingsClearFocus` (#240).

**Follow-up pass (2026-05-20 evening):** Probed the live runtime to identify which "stub-looking" functions were truly empty vs. masked by module overrides. Of the truly-empty ones, most depend on the skip-list systems (BCS gas, LayeredFX shaders, layered Dots, XR / VR, gmaps) and stay no-op by design. Exceptions ported : `updateOrganics` (#298), `__v8GPU` adapter probe so Settings → Active GPU resolves (#299). `spawnHitstop` has no callers anywhere ; `updateRoundSystem` is superseded by `_roundTimerTick` ; both can stay stubbed.

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
| 8  Lobby | DONE | Ship-select + 3D rotating ship preview via main-renderer-to-RT bridge (#255-#262), settings, perks ; MP lobby flow needs verify |
| 9  HUD | DONE | Circumpunct, killfeed, scoreboard, minimap, doomed UI, name tags with LOS gate (#218) |
| 10 Sound | DONE | Synth library + spatial sound + music + announcer |
| 11 FX polish | PARTIAL | Gameplay-critical FX ported ; cosmetic polish stubs remain |
| 12 Pilot perks | CODE-WIRED | Perk registry + Auto Cloak + Syphon stack ; not playtested |
| 13 Polish + perf | ONGOING | 302 bugfixes shipped ; per-tier quality picker fully functional (#246 light cap + #301 particle cap + #302 effect/spawn-gate tier) ; bloom still pending |

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
- Outline Optics : ported in #247 via _mirrorMeshTree + _tickOutlineOptics (backface-clone trick from v17)

---

## Phase 13 : Polish + perf (ONGOING)

- **262 bugfixes shipped** ; see inline `bugfix YYYY-MM-DD #N` tags
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
| #227-#232 | Six iterations on tracer pipeline chasing "white squares from sides while turning" |
| #233 | spawnExplosion Phase 1 white camera-facing plane removed (actual culprit) |
| #234 | Plasma Shield NormalBlending + cockpit background-size cover |
| #235-#240 | Mass-port pass : cleanupPendingHits, disposeAllDots, _syncMapButtonsDisabled, _setShipShieldEmissive/_clearShipShieldEmissive, _settingsClearFocus |
| #241 | cullOldestParticle O(n²) -> single splice |
| #242 | _setShipShieldEmissive idempotency guard |
| #243 | Per-frame scene.traverse safety sweep removed |
| #244 | (reverted) #215 WebGPURenderer ship preview, failed perf diagnostic |
| #245 | Restored #215 ship preview after FPS issue turned out to be hardware |
| #246 | applyQualityPreset now drives MAX_PARTICLES + dynamicLights.MAX_LIGHTS + shadow/bloom flags per tier |
| #247 | _mirrorMeshTree + _tickOutlineOptics ported ; Outline Optics perk now has v17 backface-clone visual |
| #248 | Stripped #41/#100 SVG-silhouette overlay that was hiding the restored 3D ship preview |
| #249 | Sanitize preview model materials : swap ShaderMaterial -> MeshStandardMaterial after setShipPreviewModel, cached via userData._wgpuSafe |
| #250 | Global THREE.ShaderMaterial -> MeshBasicMaterial fallback installed before module load ; fixes fx.js lightning pool incompatibility warning + frees the renderer to draw the rest of the scene |
| #251 | Preview-renderer shim hardening : seed canvas to 256x256 before WebGPURenderer construct, gate first render behind explicit init() promise, log all rejections (silent failures were why #245 read as "no model") |
| #252 | Diagnostic scene-walk log inside render() : meshes / mats / canvas / bbox / camera ; revealed model+camera were correct |
| #253 | Force opaque magenta clear + force every mesh to bright unlit MeshBasicMaterial (probe) : clear painted, mesh did not — proved second WebGPURenderer was dropping all draws silently |
| #254 | Added sentinel red sphere to scene each frame : also invisible, confirming dual-renderer death |
| #255 | Pivoted off dual WebGPURenderer : preview canvas now uses 2D context. WebGLRenderer shim is a soft renderer that stashes pending scene/camera ; main gameLoop post-render hook renders pending to a WebGLRenderTarget via the MAIN renderer + reads pixels async + putImageData onto the bridge canvas |
| #256 | readRenderTargetPixelsAsync in r170 returns the buffer in the promise — passing a Uint8Array as the 6th arg used it as a WeakMap key ("Invalid value used as weak map key") |
| #257 | Round RT dimensions to 64-multiples (WebGPU CopyTextureToBuffer 256-byte row alignment), cap at 384 ; aspect-correct letterbox via 2D drawImage ; brief camera-aspect swap so model isn't squashed |
| #258 | Dropped #254's brute-force MeshBasicMaterial swap from the in-render path |
| #259 | Smart sanitizer in setShipPreviewModel wrap : only swap actually-incompatible material types (ShaderMaterial/RawShaderMaterial), preserve MeshStandardMaterial so PBR + lights work |
| #260 | Removed unnecessary Y flip in readback (WebGPURenderer rows are top-to-bottom) ; ambient + directional + emissive bump for visibility |
| #261 | Wavelength-aware light rebalance : warm amber/orange directionals clamped low so they don't tint everything yellow ; cool key + hemisphere take the lifting |
| #262 | Brightness pass : ambient 2.2 / cool key 4.0 / hemisphere 2.8, roughness ≤ 0.4, metalness ≥ 0.3, emissive 0x384a68 @ 1.2. Ship reads bright + crisp through ACES tone mapping. RT cap bumped to 640 for more hull detail |
| #263 | bakeShipThumbnails ported via main WebGPURenderer + RT + readback. Fleet chip avatars, killfeed icons, and any other _shipThumbCache consumer now show real ship images |
| #264 | TSL bloom postprocessing wired : pass(scene, camera) + bloom(scenePass.getTextureNode('output'), 0.45, 0.45, 0.85) via PostProcessing. gameLoop routes through _postProcessing.renderAsync when active. Gated by QUALITY.bloomEnabled() so high/ultra tiers get the polish, low/potato stay lean |
| #265 | Procedural env map via RoomEnvironment + PMREMGenerator + soft HemisphereLight fill. Main scene's PBR materials (ships, glows, shield clones) now have realistic reflections instead of dull matte under AmbientLight + per-room PointLights only. window.sceneEnvMap exposed for cockpit / lobby code paths |
| #266 | _makeProceduralShipNormalMap + _applyProceduralShipNormalMap ported from v17o:14311. 256x256 RGBA DataTexture with 2-octave value-noise height field (panel groups + finer rivet/weld detail), tangent-space normals from finite differences. Cockpit.js's preloadShipModels picks it up automatically ; ships catch dynamic lights at panel scale |
| #267 | _makeProceduralWallNormalMap + _applyProceduralWallNormalMap : 3-octave value-noise normal map (plate seams + panel groups + grain) with stronger relief (STR 2.0) and bigger tiling (repeat 8x8). Applied during _swapWallMaterialsForWebGPU + on existing potato-path wall materials so muzzle flashes / explosions / per-room lights catch surface detail on every wall surface in every arena |
| #268 | _makeFXMaterial preset palette tuned for bloom (#264) : brighter base colors + higher opacity on proj_glow / proj_core / plasma_*, so emissive surfaces actually push past the 0.85 bloom threshold and feel energetic. proj_haze + smoke kept dim so atmospheric fades don't trigger bloom |
| #269 | Expanded _makeFXMaterial preset coverage : core_beam (VORTEX Laser signature), mega_laser, beam, beam_halo, plasma fallback, flame, stasis, lightning, shock, nano, syphon. Default white-fallback previously affected Vortex Laser ability + several other ability beam visuals |
| #270 | Procedural nebulae : 8 large additive sprites at distance with radial-gradient canvas textures (purples / cyans / amber / pink / teal / lavender). Soft per-pixel noise so they're not perfect discs. Adds cosmic depth to the starfield without baked skybox textures |
| #271 | Circumpunct lattice emissive map : 2D-baked version of v17's GLSL pattern 7 (patternCircumpunct). 256x256 CanvasTexture with 4x4 cells each containing 3 concentric rings + bright center dot, additive-composited. Repeats 6x6 on walls so the static lattice visible across every arena surface gives the v17 visual identity. First of the 19 skip-list patterns ported |
| #272-#276 | Wall over-exposure cascade fixes : disable broken wall normal map (geometry lacks tangents), gate ship normal map on attribute presence, drop TSL bloom imports (CDN 404s on r170 path), add defensive per-frame normal-attribute sweep (#274), force envMapIntensity=0 + dim emissive on walls (#275), then re-apply in the per-frame sweep since marching-cubes worker adds walls after the boot swap (#276), drop renderer.toneMappingExposure to 0.75 |
| #277 | Killfeed icon thumbnails : wrap addKillFeed to inject ship-icon avatars from _shipThumbCache (#263) next to killer/victim names. Robust label-matching handles "VORTEX [EXEC]", "PYRO BOT", etc. Falls back to plain text when thumb not cached |
| #278 | Scoreboard ship icons : wrap updateScoreboard to inject thumbnails before each sb-name cell. Handles "YOU (VORTEX)", "[NET] PYRO", "TRACKER BOT" naming patterns via the same cache lookup chain |
| #279 | Map preview thumbnails : iterate MAP_DATA, project each arena's rooms to XZ plane, draw tunnels as line strokes + rooms as palette-tinted filled circles with team-color borders (red/blue/gold) onto a 220x150 canvas. Cached as data URLs in _mapThumbCache. Wrap selectMap so picking an arena in the lobby's MAP panel shows the layout preview |
| #280 | Wire Overlays.killStreak(count) on player multikills (v17o:17213 was never invoked in port). hud.js already had killStreak() function ; just needed the call site. "DOUBLE KILL!" / "TRIPLE KILL!" / "RAMPAGE!" banners now fire on the streak window (4s consecutive) |
| #281 | Persist last loadout / perk / map to localStorage on commitLoadout, restore on boot. Boot path already had the read for lss_last_ship ; just needed the write. Added equivalent read+write for lss_last_perk + lss_last_map so the user's previous choices survive page reloads |
| #282 | spawnTripWireOrb full gameplay port from v17o:6959. Previous stub spawned cosmetic sphere only. Now : 12s lifetime worldEffect with 1s arm timer, 220-radius proximity, 350 damage on first enemy contact (after arming), _tick handles pulse + spark timers + detonation visuals. VORTEX Plasma Mines + bot-deployed mines actually do damage |
| #283 | Spawn-protection HUD badge : cyan chip "SPAWN PROTECTION 2.4s" toggled by gameLoop while player.spawnProtection > 0. Player can't see their own ship's brightening shield in first-person so the explicit countdown is friendlier than v17's silent invuln window |
| #284 | _layeredFXTick now real : _makeFXMaterial registers each created material in _FXMatRegistry with _fxBaseOpacity + per-material phase ; gameLoop calls _layeredFXTick each frame to pulse opacity around base. FX surfaces (plasma shields, projectile glows, mine cores, ability bursts) no longer dead-flat additive |
| #285 | returnToRootMenu now resets music pattern to lobby (v17o:53170 was missed). Combat track previously kept playing when the user backed out of a match ; now transitions to the calm lobby bed with bpmTarget 78 |
| #286 | spawnExplosion : added gold torus ring shockwave + 3-7 secondary bursts (fire/smoke mix) + 8-24 dark smoke residue particles + distance-falloff screen shake. Matches v17's chaotic multi-burst feel without the supershape / FXBurst pool dependencies |
| #287 | _makeFXMaterial uniform → mat.color bridge : uBaseColor / uColor / color / diffuse uniforms now point at the material's own color so Projectile + ability code's `mat.uniforms.uBaseColor.value.set(trailColor)` actually tints the glow per ship class |
| #288 | spawnRockChunks ported (4-8 IcosahedronGeometry chunks with random rotation + outward velocity + tumble + fade). ClusterObstacle.takeDamage breaks one child on hits ≥ 80 dmg, destroy() scatters all remaining chunks. Rocks shatter visibly instead of dissolving |
| #289 | Lightweight ambient cloud layer : 12 large soft-noise CanvasTexture sprites with drift + opacity pulse. Lazy-init on first updateAmbientClouds() call, wired into gameLoop. Reads as nebular weather without v17's heavyweight Dot+shader+lightning system |
| #290 | Discord identity reads ported (frontend-only) : discordCurrentUser / discordCurrentToken / _discordAvatarUrlFor / _discordRenderIdentity from v17o:4641. Signin / signout delegated to the LSS_DISCORD Worker URL. Cached user lights up chip avatars + scoreboard + killfeed when a previous session wrote to localStorage |
| #291 | spawnDashBoosters upgraded to v17o:32322 tracer-from-engine-plumes approach. Dashes now read as a row of plasma beams emitted from each engine port along the back-axis instead of scattered particles. Falls back to single ship-center tracer when no plumes (e.g. peers whose mesh tree hasn't synced) |
| #292 | _generateLightningPath + _generateLightningBranches ported from v17o:23088. spawnLightningBolt now builds a depth-5 fractal subdivision (33 vertices, perpendicular midpoint displacement with decay) + 2-3 random interior branch crackles. SLAYER Stun Bolt + lightning storm + SYPHON zap + tracker chain now look like real crackling lightning instead of 4-segment jagged poly-lines |
| #293 | StasisField visual upgrade : outer atmospheric haze sphere (BackSide, low opacity) + third diagonal ring + pulsing core scale + breathing haze opacity. Field reads as volumetric from any angle instead of flat ring pairs that look paper-thin from oblique views. Fade-out wired for all four meshes |
| #294 | Real rock geometry : _hashDisplace + _makeRockGeometry ported from v17o:20825/20834. IcosahedronGeometry with per-vertex radial displacement 0.55-1.35x via seeded hash. ClusterObstacle children no longer cubes — irregular pitted asteroid silhouettes. Same geometry used in spawnRockChunks. Clouds also fixed : were spawning at world origin (off-screen for arenas where origin isn't player-relevant) ; now spawn around player position when game.state hits 'playing' / 'warmup', 16 sprites at 800-3000 unit radius |
| #295 | Three corrections : (a) wall-dim heuristic was checking BackSide but our walls use FrontSide ; replaced with direct iteration of game.mapMeshes so the authoritative wall list drives the dim. (b) Projectile-vs-cluster collision now calls cl.takeDamage(p.damage, owner, p) instead of just bouncing — rocks actually break visibly. (c) Rock damage threshold dropped from 80 to 30 so most weapons shatter rocks (splash damage still below threshold) |
| #296 | Wall dim moved to its own try block (so the normal sweep can't black-hole it) + force-apply every frame regardless of tag. Manual JS-console run confirmed code works — Chrome MCP tab was hidden so rAF was paused, but logic is correct |
| #297 | Real fix for "white walls" : they aren't walls — they're the 300k-vert GLB ship hulls. Each has color=1/1/1 inherited from GLB material, which under bright ambient + hemisphere + env saturates to white. buildModelShipMesh now : (a) darkens GLB-inherited diffuse (replaces near-white with steel-grey 0x2e3a4c blended 20% to team color), (b) sets envMapIntensity 0 so env doesn't push it past white, (c) bumps emissive to 0.35×teamCol @ 0.65 intensity so the class color reads as the dominant tint |
| #298 | updateOrganics ported from v17o:22929. fx.js ships a `function updateOrganics(dt) { /* large body omitted */ }` placeholder that overrides the pre-load fallback at script-eval time, so the 50+ organic flora entries spawned by spawnOrganics (tendrils, polyps, spores, fans, vein networks) sat frozen with no opacity pulse and no sway. Real impl re-assigned to window.updateOrganics after `await loadScript('./lss_v17_fx.js')` so it wins the load order. Opacity pulse via sin(t × pulseSpeed + phase) with base opacity cached on userData so the multiplicative modulation doesn't compound. Position sway around basePos using independent X/Y/Z phases. Spore type also drifts child sprites along seeded driftSpeed / driftPhase / driftRadius. Wired into gameLoop right after updateDynamicObjects |
| #299 | window.__v8GPU populated from WebGPU adapter info so Settings → Graphics → Active GPU shows the real GPU name instead of permanently stuck on "detecting...". v17's GL path read WEBGL_debug_renderer_info ; WebGPU exposes vendor / architecture / device / description on `(await navigator.gpu.requestAdapter({powerPreference:'high-performance'})).info`. Fire-and-forget after `renderer.init()` so boot isn't blocked ; live-refreshes any open `#set-gpu-info` label. Renders as "nvidia / blackwell" on this rig ; deduplicated across all four info fields so we don't print "amd / amd" when vendor and device overlap |
| #300 | bakeShipThumbnails reentry guard. cockpit.js's preloadShipModels calls `bakeShipThumbnails()` at line 1079 AND webGPU.html schedules a separate call ~800ms after `models.ready` resolves. The original "already baked" check reads `_shipThumbsBaked` which only flips AFTER the full async loop completes (~1s of GPU readbacks), so the second caller saw `false` and ran a redundant bake. Visible at boot as two `[v263] thumbs baked : 7 of 7` log lines ; wastes ~1s of GPU time per load + races on cache writes. Now sets `window.bakeShipThumbnails._inProgress = true` at the start ; overlapping callers bail immediately. Released on every exit path (including the `if (baked) return` and the missing-cache early-out). Confirmed via reload : single "thumbs baked" log line now |
| #301 | Per-tier MAX_PARTICLES cap actually applies. applyQualityPreset (#246) writes window.MAX_PARTICLES to 200/350/500/700/1000 across the five tiers, but fx.js declared `const MAX_PARTICLES = 500` at line 52 and the per-frame cap check at line 153 (`while (game.particles.length > MAX_PARTICLES) cullOldestParticle();`) referenced the module-local const — so the picker's potato setting was effectively a no-op and high tiers' visual budget was silently clipped to 500. Patched the cap line in fx.js to read `window.MAX_PARTICLES ?? MAX_PARTICLES`. Verified via direct test : with cap forced to 100, seeding 300 synthetic particles triggers exactly 200 cullOldestParticle calls and leaves 100. The pool itself still sizes to 500 at module load (the const references at lines 83/102/103/108/112 are immutable), so ultra is effectively capped at 500 by pool exhaustion ; the key win is potato actually getting 200 instead of 500 |
| #302 | getVRPerfTier now actually reflects QUALITY.level. Was a hardcoded `function() { return 0; }` stub from before the per-tier picker was wired, so fx.js's getEffectBudget always returned MAX_EFFECTS (350) and the four other tier gates scattered through fx.js (lines 144 `tier >= 3` skip, 627 `tier < 2` spawnFXBurst gate, 937 conditional, 1291 `tier >= 1` skip) never fired regardless of picker setting. Maps `QUALITY.level` to v17's VR tier scale where 0 = no degradation : potato→3, low→2, medium→1, high+ultra→0. Verified : potato now gets 80 effect budget (was 350), low 140, medium 220, high+ultra keep 350. Combined with #246 (light cap) and #301 (particle cap), the full per-tier graphics picker is functional end-to-end |
| #303 | Default `QUALITY.level` to 'ultra' on first run instead of 'potato'. Stored value in localStorage still wins ; only first-time users get the upgrade. Per user request |
| #304 | window.showcase defined + Cinematic Mode default to active. v17 declares `const showcase = { active: false, pbrPromotedRoot: null }` at line 12383 ; the port had only the typeof-guarded reference at 7425. Lobby.js Settings checkbox reads `showcase.active` to populate the toggle and now persists the choice via `lss_showcase` localStorage key. Boot path also reads that key so the preference survives reloads |
| #305 | Strip team-color emissive from ship hulls (was #297 cosmetic overcompensation). buildModelShipMesh previously set `emissive: teamCol × 0.35 @ 0.65 intensity` so every ship glowed in its class color, even in first person ; user feedback : ships should reflect scene lighting only. Now `emissive: 0x000000 @ 0`, `envMapIntensity` restored to 0.35 (was 0.0) so the procedural env map (#265) drives reflections, hull color is neutral steel-grey (no team-color lerp). Engine glows + plumes + nameplates still carry team identity. Verified : enemy bot mesh now reports emissive=0/0, color=#818b99, env=0.35 |
| #306 | Hitscan weapons now collide with cluster rocks. v17 fireHitscan only walked `game.dynamicObjects` (empty in webGPU port because clusters own all rocks), so laser / gatling / railgun tracers passed straight through asteroids. Added ray-vs-sphere walk over `game.clusters` mirroring the projectile-vs-cluster path, takeDamage(w.damage) on impact, sparks + hit sound + dynamic light at the rock surface, beam terminates at the impact distance |
| #307 | ClusterObstacle.takeDamage now picks the closest alive child instead of a random index. Old code random-indexed into children, frequently picked an already-broken slot, and silently bailed on `if (!child.alive) return` ; rocks felt unresponsive because most hits looked like no-ops. Now walks children, picks the alive one nearest to projectile.position (falls back to first alive when no projectile carried) so every hit shatters something while alive children remain |
| #308 | Better ambient cloud texture. Old version was a single 128x128 shared canvas-texture, all 16 sprites used identical radial gradient + per-pixel multiplicative noise, so neighbors looked like twin blobs. Replaced with a per-seed generator that builds 256x256 multi-octave value noise (3 octaves at 16/32/64 lattice) modulated by elliptical falloff with randomized x/y aspect, plus per-variant tint roll (cool blue, lavender, peach, mint). Pool of 6 variants ; spawn loop picks randomly + applies per-instance asymmetric scale jitter (0.75-1.35 in x and y independently) + screen-space rotation. 22 sprites instead of 16, closer to player (500-2400 vs 800-3000), bigger (500-1100 vs 400-900) |
| #309 | Engine plume particle stream layer. Per user request : flat MeshBasicMaterial plume cones felt 2D. Cones stay as the base silhouette ; on top, each plume emits 0.30×throttle particles per frame (so idle ships emit nothing, full-throttle ships emit ~14/sec/plume). Particles inherit the plume's world position, drift in the ship's local +Z direction at 60+(speed×0.4) units/sec, scatter with small ±20 spread, fade over 0.35-0.65s, use the plume's base color tint. Reuses the existing game.particles pool that fx.js updateParticles renders so no new pipeline ; cheap |
| #310 | 3D ember chunks layered on top of fx.js spawnExplosion. Per user request : explosion sprite billboards looked 2D. Wrapped spawnExplosion post-load to add 6-14 small displaced IcosahedronGeometry shards per blast (scales with size), each with MeshStandardMaterial + hot amber emissive (2.2 intensity) so they read as molten debris flying outward. Per-ember velocity 250-450 units/sec with random direction, tumble at 12 rad/sec on each axis, drag 0.6/sec, fade + emissive ramp over 0.9-1.6s lifetime. fx.js's sprite path is unchanged ; embers are additive volumetric layer. Caps at 14 chunks ; size ≥ 10 gate keeps projectile pops lean |
| #311 | Hit marker SVG hidden per user request. Was a screen-space chromatic-split flash on every weapon hit ; user feedback that 2D drawings should be replaced with effects. Removed `.hit-marker.active` animation visibility by setting `display: none` on the base class. Sound feedback (`playSound('hit')` in the showHitMarker wrap) and world-space sparks (spawnImpactSparks at the actual bot hit point, already wired through weapons.js + abilities.js) carry the feedback now. The .hit-marker-kill chromatic flash for kills is preserved since killing is a bigger moment and the screen-space cue carries that |
| #312 | Cluster collision for SLAYER spread / shotgun pellets + cluster signature split. fireSpread (lss_v17_weapons.js:1178) only walked game.dynamicObjects which is empty ; shotgun pellets passed through asteroids. Added per-pellet ray-vs-child-sphere walk over game.clusters mirroring #306. Also fixed both fireHitscan bestObstacle.takeDamage call sites (lines 1042 and 1058) to detect ClusterObstacle and call with (amount, attacker, projectile) signature so #307 picks the closest alive child at the actual impact position. Cluster takeDamage doesn't return dealt damage, so credit player.damageDealt + coreMeter unconditionally on cluster hits since the threshold (≥30) is satisfied by every chassis. Combined with #306, every weapon class (hitscan + spread + projectile) now visibly shatters rocks |
| #313 | "Walls grey or white" was a real bug, not lighting. The arena's marching-cubes worker built mapMeshes with `MeshBasicMaterial(color: 0xffffff)` — flat unlit pure white. `_swapWallMaterialsForWebGPU` was supposed to convert these to `MeshStandardMaterial` for PBR lighting, but its "compat" check listed `isMeshBasicMaterial` as compatible (alongside Standard / Lambert / Node) — so MeshBasicMaterial walls were "considered fine" and skipped. They stayed at color 0xffffff with no emissive / no metalness / no roughness / nothing for env map + ambient + hemisphere to attenuate. That's what was blowing out the background. Restricted "compat" to actually-PBR types (Standard / Physical / Lambert / Node) so MeshBasicMaterial walls now get swapped to a dark-blue MeshStandardMaterial (0x3a4a6a + 0x1e2a44 emissive). Verified live : walls swap correctly, the dark-blue space backdrop is back and rocks / cockpit read against a properly attenuated scene |
| #314 | Cluster gas cloud system (4-part : cluster-attached + detach-on-break + wakes + chemistry + wall slide). Builds on v17o's GasCloud / updateBCSWakes / updateGasChemistry / updateDetachedGasPockets but without the heavyweight BCS shader (skip-listed). Each cluster gets one attached sprite-cloud sized to clusterScale, tinted by cluster.baseColor via _smokeColorFromRock (hue preserved, saturation dropped to 30-50%, lightness lifted to ~0.78). When ClusterObstacle.takeDamage breaks a child rock, a detached pocket spawns at the child's world position with random ±60 unit/sec outward velocity and joins game.detachedGasPockets (capped at 40). Per-frame _tickDetachedGasPockets : (1) drift + drag, (2) wakes from player + alive entities + up to 8 projectiles (v17o algorithm : velocity drag at 0.28×atten + bow-wave/wake-closure perpendicular to motion + speed-gated cloud-center magnetic pull), (3) wake decay back toward zero with ~1s time constant + clamp within radius×0.8, (4) wall splat via 6-axis raycastLevel probe : push back along normal + kill normal velocity so pocket slides along wall instead of clipping, (5) pocket × pocket chemistry within 200 units + pocket × cluster center chemistry (spawnLightningBolt halo+core, 8-12s spark interval per pocket). 22 ambient clouds (#308) still spawn at boot for atmospheric depth ; cluster-attached + detached pockets are the gameplay-aware layer on top. Verified : 17 attached clouds on 17 clusters, breaking children spawns visible detached pockets that drift and interact |
| #315 | Player ship freeze fixed. animateShipMesh's #309 plume-particle spawn could throw when `plume.getWorldPosition` hit a detached / mid-rebuild plume mesh (parent chain nulled during loadout swap). webGPU.html's try/catch around animateShipMesh swallowed the throw silently, leaving the player ship visibly frozen while the rest of the gameLoop continued (round timer ticked, bots moved, projectiles flew, but the local cockpit / engine animation stopped). Wrapped the inner emit in try/catch + added plume.parent + mesh.quaternion guards so a bad frame just skips the emit instead of bailing the whole tick |
| #316 | Three-part wall-color regression fix. Three problems: (a) `updateDynamicObjects` was getting shadowed by fx.js's placeholder so #314's cluster cloud spawn + wall catchup never ran (b) the cluster cloud + catchup logic was sitting INSIDE the wrong post-load section, AND (c) a separate post-load override at webGPU.html:13419 was re-installing the short version after my override, wiping out the catchup. Split into three sub-fixes : #316a moves the cluster cloud + catchup body out of the pre-load fallback into a #316b post-loadScript override in loadClusterTwoAndThree, and #316c also patches the duplicate-override site at 13419 to carry the full version. Wall catchup loop now scans game.mapMeshes every frame for any still-MeshBasicMaterial (non-occluder) walls and re-runs `_swapWallMaterialsForWebGPU` ; self-disables once stable. Also re-wraps buildRoomGraphLevel to reset `_wallCatchupDone` on every round so the catchup sweep rearms |
| #317 | Cluster collision honors group rotation. The WebGPU port's ClusterObstacle adds child rock meshes as children of `this.group` and applies tumbling rotation per frame via `this.group.rotation.x += rotSpeed.x * dt`. All three collision call sites (fireHitscan #306, fireSpread #312, projectile-vs-cluster #295, ClusterObstacle.takeDamage #307) computed child world position as `cluster.position + child.position` which only matches the actual mesh world position at zero group rotation. The moment the cluster spun even slightly, every weapon class missed children whose local offset crossed the rotated axis. Switched all four sites to `child.mesh.getWorldPosition(scratchVec)` after `group.updateMatrixWorld(true)`, and bumped the per-child collision radius from `scale × 0.65` to `scale × 0.85` since the rocks visibly fill more of their bounding sphere than the old test assumed. Live test : firing from player.position at the nearest rock now consistently shatters one child and spawns a detached gas pocket |
| #318 | Cloud-to-cloud attraction. Mirrors v17o `_applyCloudAttraction` : every pair of detached pockets within 600 units gets a small attractive impulse (peak 35 unit/sec² for close pairs, tapering quadratically to 0 at the range edge) so pockets gradually drift together and form lattices over the round. Combined with the chemistry sparks (#314), the atmosphere reads as "alive" : the longer a round runs, the more pockets cluster and the more arcs they exchange. O(D²) walk capped at 40 pockets ⇒ ≤780 pair checks per frame |
| #319 | Projectile-light-on-clouds. Mirrors v17o `updateBCSLighting` but without the BCS shader-uniform array (the port's clouds are simple SpriteMaterial). Each frame, for each detached gas pocket, find the closest active projectile within 280 units ; lerp the sprite's material.color toward `projectile.trailColor` at a rate proportional to proximity. When no projectile is nearby, decay back toward the pocket's spawn-time `_baseColor`. Net effect : tracers visibly paint nearby gas in the weapon's class color along the bullet path. Cached the spawn color on first tick rather than at spawn so the snapshot is reliable across material clones |
| #320 | Wrap updatePlayer in try/catch with fallback integrator. updatePlayer's 500-line body covers input, velocity, dash, doomed, hostile checks, position integration, SDF collision, perk effects ; any throw silently killed the ship's per-frame position update while the gameLoop continued (bots tracked + fired at the stationary player and killed them — exactly the user-reported "ship stopped moving mid-game" symptom). The catch logs once per session for diagnosis, then runs a best-effort fallback : `position.addScaledVector(velocity, dt)` + mild drag, so the ship keeps moving even if updatePlayer is permanently broken. Game continues playable while we trace the root cause |
| #321 | Render trap throttle. The `renderer.render` defensive trap at line 12691 walks the entire scene each time render throws, hides bad-geometry meshes (first pass) or bumps every transparent indexed mesh's `index.version` (second pass), then hopes the next frame renders cleanly. Under sustained failures (the recurring `setIndexBuffer parameter 1 is not of type 'GPUBuffer'` GPU resource race) the trap fires every frame, walking 100-160 transparent meshes per frame, which itself becomes the dominant CPU cost and tanks framerate ; combined with whatever's actually broken on the GPU, the ship can feel frozen because the rAF cadence drops below input poll rate. Now : track consecutive-failure counter, suspend the bump-walk after 30 frames in a row (the bump strategy hasn't been observed to actually fix the underlying GPU race), log once, decay the counter on each clean render so transient bursts don't permanently disable the trap |
| #322 | **TSL bloom restored.** The earlier #272-#276 diagnosis that "TSL imports failed on r170 CDN" was right but the conclusion was wrong : r170 didn't ship a separate `three.tsl.js` build (404 at `cdn.jsdelivr.net/npm/three@0.170.0/build/three.tsl.js`), but r172 DOES. Bumped the importmap from 0.170.0 to 0.172.0. Re-enabled the two dynamic imports : `three/tsl` for `pass()` and `three/addons/tsl/display/BloomNode.js` for `bloom()` ; PostProcessing class is on the main `three.webgpu.js` namespace as `THREE.PostProcessing` so no third import needed (was wrong about that too). Verified live : `tslOK: true, bloomOK: true, ppActive: true, tslKeys: 529`. setupBloom() now wires `pass(scene, camera)` → `bloom(_scenePass.getTextureNode('output'), ...)` → `_postProcessing.outputNode = _scenePass.add(_bloomPass)`, and gameLoop routes through `_postProcessing.renderAsync()` instead of `renderer.render()` whenever bloom is active |
| #323 | (reverted) bloom mip trim to 3 mips. BloomNode constructor pre-binds `_textureNodeBlur0..4` to the 5 vertical RTs, so trimming the arrays after-construction crashed the blur pass and tanked FPS to 14. Reverted ; the full 5-mip cost stands |
| #324 | Tuned bloom params for visible glow without screen-wash. Strength 0.50 + radius 0.55 + threshold 0.65 ; the threshold is the sweet spot between "only stars bloom" (0.85 looked invisible) and "everything mushy" (0.40 over-bloomed). When enabled, HUD ring + gas clouds + engine plumes + enemy shields all visibly halo |
| #325 | **Bloom default OFF.** User feedback : the FPS drop from 110-120 → 50 wasn't worth the visual win on this rig. r172 TSL bloom is honest about its cost (5-mip pyramid × H+V blur × half-res through PostProcessing). Now : `QUALITY.bloomEnabled()` returns false by default regardless of tier. Opt-in via `window.QUALITY.bloomOverride = true` from the browser console then reload. Tuning from #324 sticks so opt-in users see the dramatic version. Settings UI toggle is TODO ; for now console + reload is the path |
| #326 | **Multi-sprite swarm clouds.** v17o's GasCloud claims 8-17 small billboard slots per cluster ; ours had ONE big sprite per cluster so clouds read as blobs not swarms. Rebuilt `_clusterAttachedClouds` to store `{ slots, radius, baseTint }` objects ; each cluster now spawns 6 small sprites at random offsets within `clusterScale × 0.95` (cube-root distribution for uniform volume density), each with per-slot color jitter, scale variance, screen rotation, and independent churn-phase. Each detached pocket spawns 4 small sprites with the same machinery. Per-frame `_tickAttachedClusterClouds` updates each cluster swarm sprite's world position = `cluster.position + slot.offset + sin(t * churnSpeed + slot.churnPhase) × churnAmp` so the swarm breathes within the cluster. Detached-pocket tick updates each slot's position the same way relative to `pocket.basePos + pocket.wakeOff + per-slot offset + churn`. Projectile-lighting (#319) and chemistry (#314) now iterate per-slot too so every sprite in a hit pocket tints toward the tracer color. 18 clusters × 6 + 30 max pockets × 4 = 228 swarm sprites max + 22 ambient = 250 total. Visual confirm : tinted puffs distributed around each rock cluster instead of one big tinted blob per cluster |
| #327 | **TSL fire material** for Pyro Flame Chain (Reverted in #328). Replaced the old additive `MeshBasicMaterial(orange-red)` sphere with a `NodeMaterial` driven by multi-octave noise. User reported the renderer glitched when Pyro fired. Reverted to additive sphere fallback in #328 ; the TSL fire material factory `window._makeFireMaterial` still exists for later debugging but isn't picked by the flame chain builder |
| #328 | TSL fire revert. `_buildFlameChainFlameLicks` back to `MeshBasicMaterial(0xff3300 / 0xff7722)` additive sphere. Pyro Flame Chain works again. Investigation of why the NodeMaterial broke the pipeline is deferred — possibly a `colorNode + opacityNode` combination that the post-processing chain doesn't like, or NodeMaterial + Sphere geometry + this scene state has an incompatibility we haven't pinned down |
| #329 | **Match v17o ambient nebula density.** This was the critical visual gap. Side-by-side comparison with v17o showed v17o fills the entire screen with bright overlapping colored cloud sprites at all times — the dark space backdrop with sparse far-away wisps in our port was the source of every "shields are still circles / clouds don't look like clouds / no atmosphere" complaint. Bumped ambient cloud count 22 → 60. Reduced ring distance to 150-1600 units (was 500-2400) with a `pow(rand, 0.6)` bias so half the sprites sit within 700 units and actually FILL the player's foreground. Per-sprite tint roll across 8 saturated nebular hues (violet / teal / magenta / sky-blue / gold / mint / rose-orange / lavender) — `SpriteMaterial.color` multiplies the multi-octave noise texture (#308) so the noise pattern still shows through the tint. Opacity floor raised 0.55 → 0.70. Base size 500-1100 → 600-1400. With 60 sprites at this density the screen now reads as "nebula soup" matching v17o's signature look. Live confirm : direct A/B screenshots show purple + teal + pink + green ambient clouds filling the view, rocks + cockpit + HUD visible THROUGH the atmospheric haze instead of against a dark void |
| #330 | Starfield punches through clouds. The 2500-point procedural starfield from #149 used NormalBlending + size 4.5 ; the new dense ambient cloud layer (#329) covered them. Switched stars to AdditiveBlending + size 7.0 + opacity 1.0 so bright star points add to whatever cloud color is in front, reading as crisp punctures of starlight through the nebula haze |
| #331 | **Basin gas pockets for constant lightning chemistry.** v17o's signature constant lightning crackle came from "basin clouds" (detached gas pockets spawned at level-defined basin positions at arena build time, not just when rocks broke). Our port only spawned pockets on rock-break ; lightning was therefore invisible until enough kills happened. Now : at first frame of `playing` state, spawn 12 basin pockets in 4 hub clusters (3 pockets per hub, 240-unit intra-hub spread so pockets are within the 200u chemistry reaction radius of each other). Each pocket gets a saturated nebular tint (teal / violet / magenta / sky-blue / gold / mint), drift velocity, 60-100s lifetime, and an initial spark cooldown of 0.5-3s so arcs fire within seconds of round start. Live confirm : 12 basin pockets spawn ; sparkTimers count down past zero ; pairs within 200u arc continuously per v17o's algorithm |
| #332 | **Cluster glow flares.** v17o has bright yellow / green flares emanating from cluster centers ; reads as the "core glow" of the rock cluster's gas. Our port had the 6-sprite tinted swarm (#326) but no central hot point. Now : each cluster gets one big additive sprite at `cluster.position` tinted with the SATURATED rock baseColor (full sat 0.85, lightness 0.65 — much brighter than the #310 desaturated smoke tint). Per-cluster pulse phase + speed so adjacent flares don't pulse in sync. Animated per-frame in `_tickAttachedClusterClouds` : scale 0.85-1.10 × base, opacity 0.70-0.95. 18 flares spawn ; visible as bright pulsing orbs through the nebula haze even at distance |
| #333 | **Lightning bolts thickened + extended.** Bolts were 0.22s × thickness 1.4-1.6 ; each crackle disappeared before the eye caught it across distance. Layered the pocket × pocket chemistry to 3 stacked bolts : outer glow (0x88aaff thickness 4.5, 0.55s lifetime), halo (0xa8c8ff thickness 2.8, 0.45s), bright core (0xeef2ff thickness 1.4, 0.30s). Pocket × cluster arcs got the same treatment at slightly tighter widths. Net effect : each arc reads as a sustained discharge conduit (~0.5s visible window) instead of a single thin flash, matching v17o's `_spawnLayeredGasArc` recipe |
| #334 | **Per-cluster fake-bloom halo.** Bloom (#325) is default OFF because the global TSL post-process pyramid costs 60 fps for negligible visual improvement on dim emissives. Faked it instead at the cluster level : each cluster's existing flare (#332) now also spawns a SECOND sprite behind it at 3.2× the radius with 0.30 opacity, same tint but desaturated slightly, and its own slower pulse phase so the halo breathes independently of the core. The two-sprite-per-cluster cost is negligible (38 total halos for 19 clusters × 2) vs running the full 5-mip × H+V blur pyramid. Net effect : bright cluster cores read as having a soft glow halo around them, perceptually similar to bloom on those specific hot spots without paying global postprocess cost |
| #335 | **Ambient dust-particle field.** v17o's BCS gas system has up to 8192 slots and produces a constant texture of small bright drifting specks throughout the player's view. Our ambient cloud + cluster + basin sprite layers cover the big puffs but the screen still felt spatially sparse between them. Added a 2000-point THREE.Points field with per-vertex nebular tints (violet / teal / magenta / sky-blue / gold / mint / pale-white), additive blending + size attenuation + size 2.5, positioned in a 100-1200 unit radius sphere around the player. Per-frame tick : the dust group's position is copied to player.position so it follows the cockpit, and rotates 0.015 rad/s on Y + 0.008 rad/s on X so the dust has visible parallax even when the player is stationary. Cheap (single Points object, no per-particle simulation) and fills the inter-puff space with the "particle texture" v17o has |
| #336 | Ambient cloud per-frame opacity honors spawn-time baseOpacity. updateAmbientClouds had hardcoded `cloud.material.opacity = Math.min(0.85, 0.50 × pulse)` which overwrote my #329 spawn-time opacity (0.70-0.95) every frame, capping every sprite at 0.85 and dimming most to 0.55. Now : on first tick, cache `cloud.material.opacity` into `userData._baseOpacity` ; subsequent ticks pulse around that baseline. Verified : median ambient cloud opacity went from 0.50 to 0.81, max 0.98 ; nebula soup now visibly brighter, matching the spawn-time intent of #329 |
| #337 | Dust field gets soft glow texture. The #335 dust points were hard 2.5px squares ; from any distance they read as a pixel grid not nebular shimmer. Added a 32×32 procedural radial-gradient CanvasTexture (1.0 → 0.55 → 0.18 → 0 alpha stops) and assigned it as `PointsMaterial.map`. Bumped point size 2.5 → 6.0 to compensate for the sub-pixel-transparent texture margins. Each of the 2000 dust points now renders as a tiny soft additive glow puff, blending into the cluster halos + ambient clouds to produce the constant atmospheric shimmer v17o gets from its BCS slot rendering. Cost is negligible : single texture upload, no per-point change |
| #338 | **Gamepad survives alt-tab.** When the player alt-tabbed away from the game, the browser dropped pointer lock ; `pointerlockchange` set `input.locked = false` and showed the resume overlay. On returning, `updatePlayer` had an early-return at line 12091: `if (!input.locked) { player.velocity.multiplyScalar(...); return; }` which fired BEFORE the gamepad look + move blocks could run. The pad was being polled fine (`pollGamepad` always runs in gameLoop, populates `input.gpFire / gpMoveX / gpLookY / ...` from fresh `navigator.getGamepads()`) but the values were thrown away ; controller appeared dead until the user clicked to re-acquire mouse lock. Fixed by gating the early-return on `(!input.gpConnected || !_gpAxisActive)` ; gamepad now drives look + move + fire even without pointer lock. `_gpAxisActive` checks for stick deflection > 0.05, d-pad, or any face / shoulder / trigger button held so noise floor doesn't trigger it. Bonus : when gamepad input is detected without lock, the resume overlay is auto-hidden so it doesn't sit on top of gameplay. Mouse path is unchanged ; pointer lock is still required for mouse look |
| #339 | **Directional 3D shield-impact burst.** User had flagged "shields are still circles" : v17o uses a TSL shader uniform to ripple the shield surface AT the impact point, but our port had only `recordShieldHit` which uniformly lifts the WHOLE shield mesh opacity (every hit reads as "the entire bubble lit up", no directional cue). Added a localized burst : on every `spawnShieldHit(pos, radius, color, shipMesh)` call we spawn a camera-facing additive Sprite at the impact world position, tinted with the shield color, scaled from `radius * 0.45` → `radius * 1.30` over 0.30s with ease-out expansion + quadratic alpha decay. Shared 64x64 radial-gradient texture is lazy-built once + reused for every burst. `_tickShieldImpactBursts(dt)` runs in the gameLoop next to `_tickShieldFlashes`, auto-disposing sprites at end-of-life. The whole-shield opacity flash (#171 recordShieldHit) still fires so the shield bubble itself still pulses ; the new burst adds the missing "this is where you got hit" hot point on top |

---

## Known small-rule gaps (verified)

_(none currently known ; Outline Optics fixed in #247 ; please report any others you notice during playtest)_

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
5. ~~Per-perf-tier graphics quality picker~~ DONE (#246 + #301 + #302) : tier picker now drives particle cap, dynamic light cap, effect budget, shadow flag, and bloom flag. Per-tier individual override toggles in settings still TODO if anyone wants them
6. **Bloom pass** — Phase 13 polish (TSL imports failed on r170 CDN, gracefully disabled, see #272-#276)

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

Each non-trivial fix lands with a `(bugfix YYYY-MM-DD #N)` comment in the source. Counter is monotonic ; current high-water mark is #262. The full grep of the bugfix tags is the canonical changelog ; no separate CHANGELOG file is maintained.
