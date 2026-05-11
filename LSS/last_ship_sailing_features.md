# Last Ship Sailing: Feature Writeup

A single-file WebGL multiplayer space combat game (`last_ship_sailing_v16.html`) built on Three.js r128, WebAudio, and Trystero peer-to-peer networking. Two fleets of three ships fight inside procedural SDF-based 3D arenas under cosmic-field-shaded walls, with a champion stasis objective that can decide rounds.

This document covers every system the player can see or feel.

## Match Structure

A match is a best-of-seven contest. Each round runs on a clock (default 80 seconds) preceded by a 5 second warmup. Teams are FLEET A and FLEET B; first to four round wins (ROUNDS_TO_WIN = 4) takes the match. The score banner sits at the top of the screen with a Courier-styled timer between the two fleet labels.

The round timer scales the music tempo and pitches the announcer's pace. When the round timer drops to 10 seconds remaining (CHAMPION_TIME), a giant purple stasis field spawns at the map center; the first team to hold a ship inside it for three seconds (CHAMPION_CHARGE_TIME) wins the round outright, regardless of HP. If the round timer runs out with no champion declared, total team HP breaks the tie.

A 3-2-1-LAUNCH countdown plays at the start of each round; bots stay in warmup state (no firing, no movement) for the full visible countdown so the player isn't blindsided on spawn.

## Game Modes

Classic is the default: 80 seconds, kill the enemy fleet or claim the champion field at 10s remaining. Race is the alternate mode where every chassis gets clamped to a baseline speed (RACE_SPEED 900, RACE_DASH_SPEED 1400), the champion field spawns immediately at round start as the finish line, and the bot AI gains a graph-BFS steering layer that walks rooms and tunnels toward the finish. Combat stays on; you can win Race by killing everyone OR by being first to cross the finish.

## Chassis

Three hull classes, each tuning the speed/health/dash trade.

Frigate: 7,500 HP, 2,500 shield, fastest base flight (450 units/sec), three dashes at 900 units/sec, agile turn rates, narrow hull. Used by Puncture and Slayer loadouts.

Corvette: 10,000 HP, 3,500 shield, mid speed (350 units/sec), two dashes at 750 units/sec, balanced everything. Used by Vortex, Tracker, and Syphon.

Dreadnought: 12,500 HP, 5,000 shield, slowest (250 units/sec), one heavy dash at 550 units/sec, sluggish turning, large hull. Used by Pyro and Blaster.

## Loadouts (Seven Ships)

Each loadout pairs a chassis with a primary weapon, three abilities (offensive, defensive, utility), and a class core (60s cooldown, dramatic burst).

VORTEX (Corvette MkII, purple): Splitter Rifle hitscan; Laser Shot beam (2400 dmg); Vortex Shield (hold-to-absorb-and-return); Trip Wire proximity mines. Laser Core sustains a 4 second high-power laser for 12,000 damage.

PYRO (Dreadnought Incinerator, red): T-203 Thermite projectile with splash; Firewall fire line (400 DPS, 6s); Thermal Shield (5s hold, blocks attacks AND burns close enemies, 10s regen); Incendiary Trap area denial. Flame Core dumps a massive AoE incinerator for 9,000 damage.

PUNCTURE (Frigate Starcaster, yellow): Plasma Railgun hitscan piercing multiple targets; Cluster Missile (800 impact + 500 DPS for 5s); Afterburner speed boost; Tether Trap slow-and-root. Barrage Core gives speed plus a rocket barrage (7,000 dmg).

SLAYER (Frigate Blade, green): Leadwall buckshot (8 pellets, short range); Arc Wave electric projectile (2000 dmg, stuns enemy ships 1.5s); Sword Block (blocks 70% incoming, 85% with Sword Core, can't shoot while up); Phase Dash teleport. Sword Core empowers melee plus arc waves for 9,000 damage over 5 seconds.

TRACKER (Corvette Tracker, orange): 40mm Tracker projectile (sniper-spotter pace, each hit adds a lock 1/3 -> 3/3); Tracker Rockets (no cooldown, fires a 5-rocket volley at every fully-locked ship); Particle Wall one-way 10,000 HP shield; Sonar Lock beacon adds +1 lock per ship in sphere. Salvo Core unleashes a massive missile barrage (11,000 dmg).

BLASTER (Dreadnought Siege, cyan): Predator Cannon spin-up hitscan (1.2s spinup); Power Shot pierces multiple targets (3200 dmg); Gun Shield frontal 5000 HP wall; Mode Switch between close and long range. Smart Core grants auto-aim and unlimited ammo for 10 seconds.

SYPHON (Corvette Sovereign, blue): XO-16 Chaingun hitscan; Rocket Salvo (5 rockets, 10 with Missile Racks upgrade); Energy Siphon drains shields and heals 800; Rearm resets ability cooldowns. Upgrade Core is unique: it grants three tiers of permanent upgrades over a 12 second window.

## Pilot Perks

In v16, every pilot picks one perk from a roster of five, persisted to localStorage across sessions. Perks are independent of chassis and stack with the loadout.

Outline Optics: renders a crisp silhouette outline on every ship in your line of sight (green allies, red enemies). Uses the classic inverted-hull trick (backface-only mesh clone scaled slightly larger), with additive blending and distance-based scaling so the outline stays visible through clouds at any range. Walls block it (the depth buffer occludes); clouds don't write depth so the outline punches through gas.

Reinforced Shield: +1000 max shield HP (default perk). Tanks more burst before hull is exposed.

Extra Dash: +1 dash charge. Dash recharge respects the perk-bumped maximum, so the extra slot actually refills on cooldown.

Auto Cloak: every 30 seconds your ship goes 98% transparent for 3 seconds. On activation the HUD fires an ability flash banner ("Auto Cloak ACTIVE", purple) and the ship-AI announcer speaks "Auto cloak active.".

Nano Repair: 1% of max HP regenerated per second, OVER-HEALS past max up to 2x hull. Over a 3-minute round this can fully restore plus stack a bonus half-bar of survivability if you stay alive.

## Dash and Dash-Ram

Every chassis has chargeable dashes (1-3 depending on hull). A dash is short (0.4-0.6s), fast (550-900 units/sec), and refills on a cooldown timer. Dashing while colliding with another ship triggers the v16 dash-ram: the dasher acts as the aggressor and the target gets an 85% share of an impulse multiplied by 3.2; the dasher keeps moving with only a 15% deflection. Damage on the target is multiplied by 2.4 if they're on the enemy team (friendly fire shoves but does no damage).

Dash-ramming the claimer of a champion stasis field breaks the claim: the field releases, the shoved team's accrued progress is PRESERVED (so they can resume on re-entry), and the dasher's team starts their own progress from zero. Repeated dash-rams ping-pong the claim back and forth with a 0.6s grace lockout on the just-shoved ship to prevent same-frame re-claims.

## Stasis Fields

Two flavors. Regular pickup fields (cyan, 120 unit radius) spawn every 30 seconds up to three at a time; flying into one fully recharges your shield AND immobilizes the ship for 3 seconds in an iconic stasis state (vignette overlay, HUD warning, velocity zero, charge bar fill).

Champion fields (purple, 260 unit radius) are the round objective. They use a stasis-charge model: the first ship inside is LOCKED with velocity zero and the claiming team's progress ticks up. Reaching CHAMPION_CHARGE_TIME (2s) wins the round for that team, with a 5-second grace before the round-end logic resolves so the player sees the moment. Death frees the field for another attempt; dash-ram displaces the claimer and transfers the claim.

## Map System

The world is an SDF (signed distance field) built from spheres (rooms) and cylinders (tunnels) blended with a smooth-min (k=45). This produces seamless room/tunnel junctions without CSG. The level dispatcher generates classic procedural arenas, lobby-selected static rooms, race courses, and v12 Google Maps overlays (real city geometry, baked tile leaf meshes, with raycasting against the photoreal mesh for line-of-sight and projectile hits).

Per-room volumetric fog modulates density by what room the player is in: team spawn rooms stay clear (sightlines), central rooms get hazy, tunnels land between. Lerp keeps transitions smooth across boundaries.

## Wall Patterns

Walls render through a layered cosmic-field shader stack supporting 21 presets, cycleable in-game with `P` or via the gamepad button bound to "cycle wall pattern". Patterns include Kali IFS, Apollonian Gasket, Voronoi Cells, Wave Interference, Mandelbox Folds, Hex Lattice, Plasma FBM, Circumpunct Lattice, Soul Array dot lattice, Circuit Traces, Holographic Glitch, Cellular Membrane, Warped Streaks, Caustic Shimmer, Hex Pulse Radar, Cyber Datamosh, Neon Cube (raymarched), Panel Maze (architectural), Ring Tunnel, Layered Cube (transparent), and a special multi-layer composite slot that combines Panel Maze + Layered Cube + Wave Interference.

The wall pattern composite uses BG/FG1/FG2 layered passes; uTime is driven globally each frame.

## Cloud System

The BillboardCloudSystem (BCS) is an InstancedMesh slot pool of 4096 sprite slots feeding the GasCloud class. Each cloud has per-sprite slots with offset, scale, alpha, wake offset, drift phases, and drift amplitudes. Clouds:
inherit color from the rocks they spawn near (HSL desaturated/lightened),
form soft lattices through a Lennard-Jones-like potential (attraction at distance, repulsion close-in, tangential damping for orderly settling),
open up around the FORWARD part of any ship moving through them (sign-flipped tube push so sprites behind the ship pull inward, sprites ahead push outward, regardless of ship facing),
respond to walls with friction and gravity (no harsh bouncing),
and persist across rounds via a dispose loop in spawnDynamicObjects + applyWorldObjectsManifest.

Lightning arcs are emitted only by clouds, not rocks (rocks don't make lightning).

## Visual Systems

Plasma materials use a shared FXMaterial preset library: plasma_purple, plasma_red, plasma_green, plasma_cyan, plasma_wall, and an atom_fractal cluster preset for rock formations. The hull-hug shield system (v14f) mirrors a ship's mesh tree scaled 1.07x with these presets, parented under player.mesh, with a localized hit ripple and per-weapon-color tinting.

Particle systems handle muzzle flashes, sparks, hull explosions (localized to hit point in v14f), pyro flame cone matching damage geometry, slayer buckshot (4x brighter, 4x particle count), and persistent debris/decal effects.

The cockpit-anchored CircumpunctHUD draws concentric rings: health, shield, core meter, abilities, ammo, speed; all mapped into ring arcs, tick marks, and bracket geometry. The HUD shake-counters camera shake by 35% so it reads as sprung cockpit, not pasted-to-screen.

Ship name labels are HUD callouts (v16): a small target bracket at the ship's screen position, an SVG-drawn diagonal-then-horizontal line, and a chassis name overlay that flips left for ships on the right half of the screen. Blue for allies, red for enemies. The reveal animation digitizes characters in over 0.45 seconds the first time a ship enters view; tagged with continuous jitter and infrequent CRT-glitch slice shifts.

Layered FX shockwave-ring presets handle stasis pickup, vortex core beam, atom-fractal cluster rocks, cluster distortion shells, engine plume cones, engine glow discs, gas clouds, tether trap halos, and more. Each was tranche-ported from the original SDK.

## Audio

Procedural music engine (v15m upgrades) drives a four-voice synth stack: drum kit (kick body + click transient, snare body + noise, sweeping crash, pitched hat), fat bass with sub-osc and tanh saturation, four-oscillator pad with LFO filter modulation, lead with octave-layered detune and delayed vibrato. A WaveShaper soft-clip master limiter replaces the old DynamicsCompressor.

Chord variety supports maj7, maj9, min7, sus2, sus4, dim7, add9. Patterns have transition fills firing on bar boundaries. Special-moment cues exist for champion-field appearance (low rumble + ascending pad swell to signal "the field is open, last 10 seconds"). Lead has a reverb send through a predelay->convolver->wet-gain chain.

Sound effects are organized by ship in the v14g sound lab, with a default library covering laser, cores, mode switch, dash, afterburner, upgrade core, tether trap wall-bend, trip wire deploy, and per-weapon fire sounds. Shared sounds are marked with ships arrays so the dropdown shows count suffixes.

The TTS announcer ("ship-AI") uses speechSynthesis to speak round events, perk activations, and welcomes. Per-key cooldowns and a global anti-chain gap prevent overlap. Dynamic rate maps game state to announcer pace (menu = slower, playing = faster, roundEnd = dramatic). Voices are selectable in settings via the voiceschanged event. Skipped in VR (headset audio path differs).

## Multiplayer

Trystero P2P with a lobby browser backed by a Cloudflare Worker (LSS_API_BASE). Solo vs Join Room chooser on cold boot. Lobby supports map carousel arrows; ship-select panel shows the local player's chosen ship plus a fleet strip with baked GLB thumbnails of teammates and enemies. READY pip per peer.

Discord integration via PKCE OAuth: the user signs in with their Discord, the app exchanges via a Worker proxy (which holds channel webhook URLs as encrypted secrets), and match results post to a channel. Identify scope only; tokens stored in localStorage; PKCE verifier in sessionStorage.

Peer-view shields use the same hull-hug clone approach as local; userData is filtered to avoid circular references that crashed the JSON clone path.

## Input

Keyboard and mouse: WASD movement, SPACE/CTRL vertical, MOUSE aim, SHIFT dash, Q/E/F abilities, V core, ESC settings, P cycle wall pattern. Dead-state spectating: A/D or click to cycle teammate cam.

Gamepad: D-pad up/down cycles ships in ship-select, d-pad left/right cycles maps (or teammate cam when dead), LB/RB cycle perks (v16), START launches, BACK opens settings in-match or closes menu. Standard layout bindings are configurable in settings; menu nav reads buttons directly so it survives corrupted bindings. Left-stick horizontal acts as a fallback for d-pad left/right.

VR support presents flat-screen settings inside the headset; XR session ends via Enter VR button. TTS is skipped while presenting.

## Settings + Persistence

Settings overlay supports d-pad nav (up/down moves focus, left/right adjusts the focused widget, A activates buttons or toggles checkboxes). Persisted to localStorage: perk selection (`lss_perk_id`), quality tier (`lss_quality`), and general settings (`lss_settings`). Quality system supports potato/low/mid/high/ultra tiers tuning particle counts, cloud density, shader complexity, and bloom RT size.

## Cosmic Anomaly

A v11 special: when active, a 75 second cosmic event modifies the field. Self-destroys when its pass completes; reference cleared after destroy.

## Killfeed, Medals, and Overlays

Killfeed slides in at the top-right with kill source. Medal popups appear for assist (green diamond), savior (blue circle), and execution (red dot). Round banner overlay handles round-start, champion-field events ("CHAMPION OBJECTIVE", "CHAMPION CHARGE", "CHAMPION RESUMED", "CLAIM BROKEN", "CHAMPION CLAIMED"), and match-end ("EXECUTION"). Damage vignette pulses red on hit. Respawn overlay persists until next round.

Ability flash overlay shows the activated ability name with its preset color (dash cyan, shield blue, overclock orange, cloak purple, emp red, heal green, stasis teal, missiles orange).

## Performance Optimizations (v15a)

Five major performance improvements landed in v15a: composite shader cleanup, bloom render-target sizing fix, worldSDF spatial index, trail ring buffer (instead of array shift), and Vector3 scratch pools. Quality system gates expensive features per tier so the game runs on weak hardware (potato tier) up through high-end (ultra tier with full effects).

## Special Mechanics Summary

Slayer Arc Wave projectiles stun enemy ships for 1.5 seconds on hit (electric proj effect).

Blaster Power Shot and Puncture Plasma Railgun pierce multiple targets.

Vortex/Gun/Thermal/Sword Block shields are fully damage-immune (the hit ripple shows the shield absorbing, but no HP leaks through).

Gun Shield drains its own HP while up. Thermal Shield emits fire particles in the same forward cone its burn damage uses.

Bot Slayer fires buckshot like the player and buckshot travels farther for bots.

Tracker Sonar Lock is a beacon that adds locks within its detection sphere; combined with main-gun shots stacking locks 1/3 -> 2/3 -> 3/3, the Tracker Rockets volley fires at every fully-locked ship (partial locks preserved on others).

The Pyro Thermal Shield is a power pool (2500 HP, regen to max over 10s); its fire emitter spawns flame particles in the exact damage cone (reach 2.6 hull lengths, base 0.75 hull, tip 1.7 hull).
