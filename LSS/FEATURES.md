# Last Ship Sailing v16d ; Feature Overview

Zero-gravity ship combat in a single self-contained HTML file. Three.js for rendering, Web Audio for spatial sound, peer-to-peer mesh networking for multiplayer, WebXR for VR. Drop the file on any modern browser and you have a playable game; no install, no build step, no server.

This document covers every feature shipped through version 16d (the current build).

## Core concept

The game frames every match around a single fragile constraint: the last ship sailing wins the round. Two teams (Fleet A and Fleet B) spawn inside a sealed three-dimensional arena, fight to attrition, and the team with at least one ship still flying at the round-end clock takes the round. Rounds compound into matches.

The framing is deliberately physical: each player IS their ship. There is no avatar, no character, no "out-of-cockpit" view. In VR the abstraction is taken further; the cockpit frame is removed entirely and you experience the field as if your body is the hull.

## Ships

Seven distinct ship loadouts, each on one of three chassis archetypes (Frigate, Corvette, Dreadnought) and each with three abilities plus a powerful core (the ultimate).

**VORTEX (Corvette Beam).** Purple beam class. Weapon: Energy Blaster. Abilities: Laser (single-shot massive beam), Vortex Shield (hold to absorb and return projectiles), Plasma Mines (proximity-detonating field). Core: Mega Laser (sustained 4-second high-power beam).

**PYRO (Dreadnought Igniter).** Heavy fire class. Weapon: Thermite Launcher. Abilities: Flame Chain (fire wall laid forward, 6-second duration), Fire Shield (hold to block and burn close enemies), Explosive Gas (area-denial cloud, ignitable). Core: Mega Flame Chain (massive AoE incendiary).

**PUNCTURE (Frigate Sniper).** Long-range yellow class. Weapon: Sodium Railgun (hold-to-charge mechanic: 2.5-second full-charge curve, quick-tap reset, decay-on-release). Abilities: Cluster Missile (impact + sustained zone damage), Afterburner (speed boost), Stasis Trap (slow and root). Core: Mega Barrage (speed boost + sustained rocket barrage).

**SLAYER (Frigate Duelist).** Close-range green class. Weapon: Shotgun. Abilities: Stun Bolt (piercing arc projectile with slow-on-hit), Absorption (blocks 70% incoming, 85% during core), Teleport (phase dash with sweep stun). Core: Mega Stun Bolt (sustained 5-second melee aura at 1800 DPS within 500 units, visualized by a green-lightning storm that follows the caster, plus a flurry of Stun Bolt projectiles firing automatically; the lightning bolts radiate within the same 500-unit reach as the damage, so the visible storm is the damage zone).

**TRACKER (Corvette Spotter).** Lock-on orange class. Weapon: Tracking Bolt (each hit adds +1 lock to its target, capped at 3). Abilities: Tracker Rockets (5-rocket volley fired at every 3/3-locked ship; partial locks preserved), Plasma Shield (one-way deployable shield, 10,000 HP, 10 seconds), Sonar Pulse (fire beacon, sphere of detection grants +1 lock per ship in radius). Core: Mega Tracker Rockets (remote-guided missile volley; all missiles steer toward crosshair aim in real time).

**BLASTER (Dreadnought Gunner).** Suppressive cyan class. Weapon: Gatling Cannon (1.2-second spinup, close-range default mode, switchable to long-range). Abilities: Charge Shot (3200-damage burst), Body Shield (frontal 5,000-HP shield), Range Mode (close/long swap, alters spread and damage falloff). Core: AI Assist (auto-aim + unlimited ammo for 10 seconds, raycasts line-of-sight per target).

**SYPHON (Corvette Drainer).** Support/sustain blue class. Weapon: Zapper (rapid hitscan). Abilities: Rocket Salvo (5-rocket spread, 10 with Missile Racks upgrade), Energy Syphon (drain enemy shields, heal self up to 800), Inner Spark (reset all ability cooldowns). Core: AI Nanobots (3-tier permanent upgrade selection: Arc Rounds, Missile Racks, Cooldown Reduction).

## Chassis archetypes

**Frigate.** 7,500 HP, 2,500 shield, top speed 800 u/s, 3 dashes. Fast, fragile, dance-around playstyle. (PUNCTURE, SLAYER)

**Corvette.** 10,000 HP, 3,500 shield, top speed 600 u/s, 2 dashes. Balanced. (VORTEX, TRACKER, SYPHON)

**Dreadnought.** 12,500 HP, 5,000 shield, top speed 420 u/s, 1 dash. Slow, tanky, commits to positioning. (PYRO, BLASTER)

## Pilot perks (one per pilot, chosen at ship-select)

**Outline Optics.** Crisp silhouette outline on every ship in line of sight; green allies, red enemies. Sees through gas clouds; blocked by walls.

**Reinforced Shield.** +1,000 max shield HP. Tanks more burst damage before the hull is exposed.

**Extra Dash.** +1 dash charge. More evasive maneuvers and ram pressure.

**Auto Cloak.** When the core meter charges past 75%, the ship goes 99% transparent for 4 seconds. Use the window to reposition. Networked: peers see the caster's ship fade to near-invisible during the window.

**Nano Repair.** 1% of max HP regenerated per second; over-heals past max up to 2x hull capacity (turns the ship into a self-repairing brick).

## Combat mechanics

**Health, shield, and hull layering.** Damage hits shields first (regenerates after a delay), then hull (does not regenerate without Nano Repair). A "doomed" state triggers when HP crosses a critical threshold, with a screen-wide pulsing warning and audio cue.

**Dash.** Pilots have chassis-specific dash charges that recover on a per-charge cooldown. Dash boosters render as colored engine plumes; the burst is broadcast so peers see when an enemy is committing to a direction.

**Ram damage.** Ship-ship collisions deal damage proportional to impact velocity; the heavier ship takes less, and friendly-fire ram is shove-only with zero damage.

**Stasis.** Slows and roots affected ships. Sources: SLAYER Teleport sweep, PUNCTURE Stasis Trap, large stasis-field events. Stasis is visualized by a pulsing blue ring on affected ships and a warning bar on the player HUD.

**Execution.** Low-HP enemies can be rammed for an instant kill at close range, signaled by an on-screen prompt.

**Hit-claim consensus.** Multiplayer damage is verified peer-to-peer: the shooter broadcasts a hit claim; nearby peers vote on whether the projectile geometry actually intersected the target. Damage applies only on consensus.

## Cores (ultimate abilities)

Each ship's core has unique behavior and visual signature:

**VORTEX ; Mega Laser.** 4-second sustained heavy beam; three layered renderings (volumetric cylinder shader, converging muzzle tracers, electric arcs cracking off the beam) stack into a single thick laser.

**PYRO ; Mega Flame Chain.** Instant massive AoE incendiary blast, ignites any deployed Explosive Gas in radius.

**PUNCTURE ; Mega Barrage.** Speed boost plus a periodic rocket barrage for 5 seconds.

**SLAYER ; Mega Stun Bolt.** 5-second activation: lightning storm visualizes a 1800 DPS melee aura that follows the caster, with bolts radiating to the same 500-unit reach as the damage; Stun Bolt projectiles fire automatically twice per second; all networked so peers see the storm, see the bolts, and can dodge.

**TRACKER ; Mega Tracker Rockets.** Remote-guided missile barrage; the player steers the swarm in real time off the camera quaternion. Quarter-speed missiles let the player actually fly the swarm rather than watch it pass through the room.

**BLASTER ; AI Assist.** Auto-aim plus unlimited ammo for 10 seconds. Targets the nearest visible enemy (line-of-sight raycast); fires at 20 shots/second.

**SYPHON ; AI Nanobots.** Tiered permanent upgrade selection: Arc Rounds (+50% damage vs shielded targets), Missile Racks (doubles Rocket Salvo count), or Cooldown Reduction (30%). Tiers unlock by core charges; the upgrades carry into subsequent rounds.

## Cockpit frame system (new in v16d)

Each ship has its own painted cockpit border PNG that frames the gameplay viewport on flat-screen play. The system is now layered:

**Base frame.** The static painted border for each ship. Lives at `./frames/<TitleCase>/<KEY>.png`.

**Recoil flipbook.** Up to five numbered frames per ship (`<KEY>1.png` through `<KEY>5.png`). The animator runs two drivers concurrently: a SHOT driver bumps the playhead forward one frame on each weapon fire (wraps at end), and a TIME driver advances one frame per 50 ms between shots. The combined effect: slow-firing weapons (Sodium Railgun) play the full kick-and-return cycle per shot; high-rate weapons (Gatling Cannon at 20 Hz, Zapper at 11 Hz) cycle visibly through the frames at the firing rhythm. Missing numbered frames are skipped automatically.

**Named ability frames.** Per-ship suffix frames keyed to specific abilities, registered in `_SHIP_NAMED_FRAMES`. VORTEX has `VORTEX-L.png` and `VORTEX-L2.png`: L shows whenever the Laser ability fires, and during the Mega Laser core L and L2 alternate at 10 Hz for a sustained pulse. PUNCTURE has `PUNCTURE-C.png` and `PUNCTURE-C2.png` for the Sodium Railgun charge, with alternation speed that scales with charge level (2 Hz at 0% charge, 20 Hz at 100% charge; visible urgency that builds as the shot becomes ready).

**Image pinning.** All loaded frame Image objects are stored in the cache entry. The browser cannot evict their decoded bitmaps, which eliminates the "transparent flash every Nth shot" symptom from texture re-decode.

**Muzzle alpha-scan.** On load, the base PNG is scanned to detect where the painted barrel tips are; the gameplay muzzle origin then matches the painted art exactly, even if the artist drew the barrels at an odd angle.

**VR.** The entire cockpit frame is suppressed; the player sees the world unobstructed with only the floating HUD.

## Visual effects

**Lightning system.** Pooled (64 slots in v16d) with bespoke shader rendering: each bolt is a halo tube plus a core tube with subdivision-based jitter, branching, and AdditiveBlending. Color, lifetime, thickness, and branch count are all per-call. A separate 256-slot "dark lightning" pool renders black bolts for SLAYER's Absorption aura.

**Plasma shields.** Vortex Shield (purple), Body Shield (cyan), Fire Shield (red), Plasma Shield (one-way deployed wall), Absorption (green). Each renders as a hex-grid hologram with shader-based flicker plus a hull-hugging plasma layer. Networked: peers see the shielded ship's aura matching the shield type.

**Explosions.** Pooled mesh-based fireballs with multi-layer color falloff. Used for hit confirmations, projectile impacts, and core detonations.

**Particle systems.** Tracers, dot particles, hull bursts, shield hits, damage smoke (heat trail from low-HP ships), electric smoke, fireworks bursts (Cluster Missile zones), supershape bursts (cosmic events), heat trails on fast-moving projectiles.

**Layered FX presets.** A consolidated shader system (`_makeLayeredFXMaterial`, `_makeFXMaterial`, `EFFECT_PRESETS`) replaces what used to be a dozen bespoke shader factories. New effects can plug into existing presets (fireball, plasma wall, plasma purple, core beam, etc.) instead of writing fresh GLSL.

**Persistent world effects.** Firewalls (PYRO Flame Chain), trip wires (VORTEX Plasma Mines), tethers (PUNCTURE Stasis Trap), incendiary gas, particle walls, cluster zones, slayer-core damage-FX. Each is networked via `effect_spawn` or top-level event types so all peers see the same zones at the same positions.

**Cosmic anomalies.** Procedural large-scale entities (atom-fractal rocks, cosmic anomaly bodies, champion fields, stasis fields) rendered with their own shaders and integrated into the lighting / collision pipeline.

**Wall patterns.** Maps render walls via fractal SDF shaders (Mandelbox, soul array, custom patterns). Each map carries its own pattern data, and the wall_lab / wall_pattern_lab labs let you tune them visually.

## Audio

**Spatial 3D positional audio.** Every weapon fire, explosion, ability activation, and persistent zone has a 3D position. Listener is the camera; reverb and stereo panning are positional.

**Per-weapon sound profiles.** Each weapon has its own signature: Sodium Railgun has a charge-up build that pitches up over the 2.5-second window; Gatling Cannon has a sustained chuggle; Zapper crackles; Thermite Launcher has thunk-plus-burn.

**Sustained loops.** Continuous fire effects (firewall burn, gas cloud crackle, Mega Laser hum, charge-up tones) loop seamlessly with positional tick-throttling so they don't stutter on retrigger.

**Dynamic music engine.** Adapts to combat state. Round transitions, killstreaks, doomed state, and stasis effects all modulate the music intensity. Ducking on big events (Mega Tracker Rockets, Mega Flame Chain).

**Recipe-based audio.** Each sound is defined by a JSON recipe (`LSS_SOUND.json`) that describes oscillator stacks, filters, envelopes, noise sources. The sound_lab.html is a live tool for tweaking the recipes; changes apply to the game without re-touching code.

## HUD and UI

**Circumpunct HUD.** Centered crosshair (the "point"). Concentric rings around it for health, shield, ammo, and core meter. A small ability pie at the corner shows each ability's cooldown state. The visual is itself a literal circumpunct (the framework symbol the project is built around).

**Kill feed.** Top-right rolling list of recent kills; each entry shows killer chassis, weapon, and victim with chassis color.

**Scoreboard (Tab to hold).** Two-column team breakdown with kills, damage dealt, ship class, and Discord avatar/name for each player.

**Damage direction indicators.** Four screen-edge bands pulse red on incoming hits in the direction of the source. Also a glitched-text callout overlay near the ship taking damage.

**Cinematic overlays.** Damage vignette flash, killstreak text, countdown ring (round start), respawn fade, medal display, "ABILITY ACTIVE" labels, ability-color flashes, banner for round-end. All CSS-driven so they don't fight Three.js for render time.

**Shield-active fullscreen tints.** Vortex Shield, Body Shield, Fire Shield, Absorption each have their own screen-edge wash overlay so first-person feedback reads instantly.

**Lock-on warning.** When TRACKER's lock fills on you, a pulsing red ring appears around the screen; partial locks show partial fill.

**Execution prompt.** "RAM TO EXECUTE" floats on low-HP enemies within ram range.

**Stasis warning bar.** When you're caught in stasis, a blue progress bar shows how much of the slow remains.

## Multiplayer

**P2P mesh networking.** Trystero-based WebRTC mesh; no central game server. The lobby uses lss.fractalreality.ca/rooms.html (a Cloudflare Worker) as a lightweight signaling and room-discovery layer.

**Lobby system.** Room codes auto-fill from URL query (`?room=ABCD`). Pre-game lobby shows all connected peers with their Discord avatars, ready state, chassis selection, and team. "All ready" launches the match with a synchronized countdown.

**Synchronized round timing.** All peers anchor round transitions to a UTC wall-clock timestamp; round-end resolution flows from the stasis field "owner" (the longest-running peer) so peers don't disagree on who won when the timer expires.

**Loadout sync.** Peer ship selection is broadcast on change; everyone sees who's flying what before launch.

**Network projectile rendering.** Other players' projectiles render with the same visual flags as locally fired ones (color, isArcWave, isFireSource, isCluster, sizeMult, splash, tracking, salvoGuided). The shooter's client is authoritative for damage; the broadcast carries damage=0 to receivers.

**State broadcast.** Each peer continuously broadcasts position, rotation, health, shield, cloak state, kills, damage dealt, doomed flag. Receivers smoothly interpolate the remote ship mesh.

**Discord integration.** OAuth login surfaces Discord username and avatar in the lobby; the game runs as a Discord Activity inside Discord clients (the activity SDK is wired up alongside the standalone browser flow).

**Bandwidth tracking.** Live byte counter on outbound and inbound network traffic, visible in the developer overlay.

## Maps

**Built-in maps.** Hourglass, Spine, Tower, Cross, Octahedron, Pentagon, Gyre, Pyramid, Cube Center, Arc, Infinity, Middle Bars. Each is a JSON description of rooms and tunnels with optional champion-flagged finish-line rooms.

**Real-world maps.** Type any Google Maps location into the location picker; the map builds an arena over the actual geography. The wall pattern, sky, and lighting stay procedural, so the location is a layout template rather than a 1:1 reconstruction.

**Custom maps.** Drop a JSON file into the custom-map slot to play user-built arenas. Same schema as built-in maps.

**Map-walk lab.** A separate HTML tool for walking through a candidate map on foot before committing it to the rotation; useful for layout iteration.

## Game modes

**Standard arena.** Last team alive at round-end wins. Bots fill remaining slots if the player count is low.

**Champion mode.** Activates at the 10-second mark of each round. A champion-flagged room becomes a contested control point; rotating tri-axis stasis fields close in on the rest of the arena; whoever holds the champion room when stasis catches everyone else wins the round.

**Race mode.** Champion-flagged rooms become finish-line objectives. The first team to reach the flag wins the round through the existing championResult pipeline.

**Bot fill.** AI opponents flying every loadout with situational behavior (cover-hugging, ability use, AI Assist auto-aim with line-of-sight checks). Bots scale to fill remaining slots up to a configurable per-team cap.

## Quality and accessibility

**Quality tiers.** Potato, Low, Medium, High, Ultra. Each tier disables progressively more shaders, particle counts, wall complexity, and dynamic-light density. Potato is genuinely playable on low-end hardware (walls collapse to flat MeshBasicMaterial; no shader effects).

**Custom keybinds.** Every input is rebindable via settings; the bindings persist to localStorage. Tab is the default scoreboard hold.

**Pointer-lock and gamepad.** Mouse + keyboard with pointer-lock for free look. Gamepad supported with stick aim and shoulder buttons for abilities and core.

**Screen wake lock.** Browsers that support Wake Lock are pinned awake during active play (no sleep / no efficiency throttling).

## VR / WebXR

**Native WebXR session.** Standalone Quest, Pico, and PC-tethered headsets supported through the browser's WebXR API. Headset controllers map to weapon-aim and ability triggers.

**No cockpit frame.** In VR the painted border is suppressed; the player perceives the world directly with only the HUD floating in front.

**Performance tiers.** Separate VR perf tier detection (`getVRPerfTier`) lowers particle counts and shader passes for standalone headsets to maintain 90 FPS.

## Developer tools

**sound_lab.html.** Live sound recipe editor. Tweak oscillators, filters, envelopes, noise; hear changes instantly; export back to LSS_SOUND.json.

**wall_pattern_lab.html / wall_lab_v2.html.** Fractal SDF shader playground for designing map wall patterns. Mandelbox, custom escape-time functions, parameter sliders.

**map_lab.html.** Map authoring tool for designing arena rooms and tunnels in a 3D editor view.

**fx_lab.html.** Particle and explosion FX preview.

**reaction_diffusion_lab.html / mixed_lab.html.** Generative pattern research labs used to develop the wall shaders.

**map_walk_lab.html.** First-person walk-through of a candidate map without combat.

## Licensing and ethics

**Code: proprietary.** All Rights Reserved to FractalReality.ca. See LICENSE in the repo root for the full terms. No fork, mirror, modification, reverse-engineering, or AI/ML training use is permitted without prior written consent.

**Assets: proprietary.** All Rights Reserved to FractalReality.ca. See LICENSE-ASSETS. Datamining and asset-ripping are explicitly prohibited.

**Community use carve-out.** Anyone may run the game for personal non-commercial play; create User-Created Content using the in-game tools (clips, screenshots, custom maps, fan art); and share that content in the official Fractal Reality Discord, on Owner-designated community channels, and on personal non-commercial channels with credit to FractalReality.ca. Creators retain ownership of their original expression.

**Trademarks and merchandising reserved.** All ship names, logos, characters, and overall look and feel are trademarks of FractalReality.ca. Merch rights are reserved exclusively to the owner.

**Five-pillar ethics policy.** The game ships under a published ethics policy based on the Circumpunct Framework: GOOD (no dark patterns, no FOMO timers, no slot-machine variable-reward schedules), RIGHT (fair purchase flows, minimal data collection, real responses to bug reports), FAITHFUL (offline stays offline, no ship-and-abandon, account state belongs to the player), TRUE (honest marketing, disclosed AI use in development, public post-mortems on breakage), and AGREEMENT (the four above, met by both sides).

## What changed in v16d specifically

**Cockpit frame recoil flipbook.** Per-ship subdirectory layout (`./frames/<TitleCase>/<KEY>N.png`) with up to five numbered recoil frames. Dual-driver animator (shot bumps + time advances) means both slow and rapid-fire weapons read correctly.

**Named ability frames.** New `_SHIP_NAMED_FRAMES` registry plus `_getActiveAbilityFrameKey` state lookup. VORTEX has L / L2 (Laser ability and Mega Laser core, with 10 Hz alternation during the core). PUNCTURE has C / C2 (Sodium Railgun charging, with charge-rate-scaling alternation that builds from 2 Hz at 0% to 20 Hz at 100%).

**Image pinning.** All loaded cockpit frame Image objects are stored in the cache entry. The browser keeps the decoded bitmaps in memory across the session, eliminating the "transparent flash every Nth shot" symptom from texture eviction.

**Title and manifest.** Page title and PWA manifest both updated to v16d.

**Forked clean from v16c.** All v16c features (the performance pass, the renamed loadouts, the SLAYER core lightning storm, the proprietary licensing) are preserved.

Next planned work: PUNCTURE core revisit and continued cockpit frame iterations per-ship.

---

Contact: ashroney@gmail.com
Site: https://fractalreality.ca
