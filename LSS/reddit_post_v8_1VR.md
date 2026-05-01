# LSS v8.1 VR is here, and it's the most stacked single HTML file I've ever shipped

Title idea: **Last Ship Sailing v8.1 VR; zero-G arena combat with 7 ships, 11 maps, WebXR, and a reactive band that scores your match in real time (single HTML file, runs in your browser)**

---

Hey r/LastShipSailing,

This build (v8.1 VR) is the biggest leap since the AAA uplift. Every system that was already in place got polished, and the headline addition is a procedural in-game band (Tier 3) that follows the round beat by beat. No streamed audio, no samples; pure Web Audio synthesis reacting to what you're doing.

Pull it up, slap on a headset (or don't), pick a ship, and fly.

## The roster (7 ships, 3 chassis classes)

Each ship has a primary weapon, three abilities (offensive, defensive, utility), and a Core super on a 60s cooldown:

- **VORTEX** (Corvette MkII): Splitter Rifle hitscan, Laser Shot beam (2400 dmg), hold-to-absorb-and-return Vortex Shield, Trip Wire mines, Laser Core (4s continuous death beam, 12000 dmg).
- **PYRO** (Dreadnought Incinerator): T-203 Thermite launcher with splash, Firewall (400 DPS line), Thermal Shield that burns close enemies, Incendiary Trap, Flame Core AoE (9000 dmg).
- **PUNCTURE** (Frigate Starcaster): Plasma Railgun (1000 dmg, 4500 range), Cluster Missile (impact 800 + DoT), Afterburner, Tether Trap that roots, Barrage Core (rocket spam + speed).
- **SLAYER** (Frigate Blade): Leadwall shotgun (8 pellets), Arc Wave electric proj, Sword Block (70%, 85% on Core), Phase Dash teleport, Sword Core empowered melee.
- **TRACKER** (Corvette Tracker): 40mm Tracker projectile, lock-on Rockets (5 missiles, 3 locks), Particle Wall one-way shield (5000 HP), Sonar Lock reveal, Salvo Core barrage (11000 dmg).
- **BLASTER** (Dreadnought Siege): Predator Cannon minigun (150-round clip, spinup), Power Shot (3200 dmg), Gun Shield (5000 HP frontal), Mode Switch close/long, Smart Core (auto-aim, 10s, infinite ammo).
- **SYPHON** (Corvette Sovereign): XO-16 Chaingun, Rocket Salvo (5 or 10 with upgrade), Energy Siphon drain-heal, Rearm cooldown reset, Upgrade Core with three permanent tiers.

## The maps (11 hand-built arenas, no procgen jank)

Real geometry, real flow, every map symmetrical and tested for fights, not just looks:

The Nexus (hex ring, 6 chambers, no dead ends), The Spine (long axis with arcs), The Infinity (two rings pinched at center), The Tower (vertical stack across 3 layers), The Cross (compact 4-arm crucible), The Arc (curved approach with overhead shortcuts), The Octahedron (bipyramid with 4 equator rooms), The Pentagon (5-ring bipyramid, no hub), The Gyre (helix climbing Y), Middlebars (lattice arenas with a champion peak), and the original Circumpunct (5 spheres + 8 cylinders).

## Round structure (it actually has a rhythm)

- 5s warmup with a 3-2-1-LAUNCH ticker
- 80s rounds, first to 4 round-wins takes the match
- **Doomed state**: drop below 15% HP and you've got 10s to recover or you're out, the world goes red, and the music turns sour
- **Champion Mode**: at 10s remaining, a giant purple stasis field spawns at center. Hold a ship inside it for 5s of uninterrupted contact and your team wins the round. Die in the field while charging? You lose. Timer runs out with no champion? Total team HP breaks the tie.
- **Stasis fields** spawn periodically across the map; step inside and the world turns dreamlike (drums cut out, only pad and bass hum, you can think for a second)

## VR / WebXR (yes, in a single HTML file)

WebXRManager is fully wired. Hit the Enter VR button on a Quest 2/3/Pro browser, and the cockpit frames, 2D HUD, ability pie, and damage edges all peel away cleanly to show you only the stereoscopic 3D arena. Lobby and ship select stay flat-screen so you can prep before strapping in. You can also play it desktop-flat with the cockpit PNG overlay and mouse/keyboard or gamepad.

## AAA-feel visuals (Three.js r0.165 pipeline)

- **EffectComposer** post stack: bloom + ACES tonemap + SMAA antialiasing
- **HDRI / PBR**: cinematic 2K equirectangular environment, IBL on hero ships in Showcase mode
- **InstancedMesh debris pool**: hundreds of fragments per fight, single draw call
- **Hit-feedback chain**: screen shake + chromatic aberration + vignette + gamepad rumble + hitstop + white-flash, all stacked
- **Cinematic round-start flyover**: 2.5s scripted spline (pull back, orbit, push in over your ship) with depth-of-field BokehPass
- **Kill-cam slow-mo orbit**: 1.5s time-dilated camera spin around the dying enemy when you land the round-winning kill
- **Cockpit frames**: full-viewport PNG overlays per ship (BLASTER, TRACKER, VORTEX, SLAYER, PYRO, PUNCTURE, SYPHON), with a four-quarter ability pie that lights up over the painted radar

## Audio (this is the part I'm most hyped about)

- **Spatial audio**: HRTF panning, occlusion (walls actually muffle), multi-convolver reverb per room, sidechain ambient duck on hits
- **Web Speech ship-AI announcer** with a voice picker; lines for round start/won, core ready, dash ready, enemy lock, ramming, stasis active, low ammo, multikill calls
- **Tier 3 reactive band** (the new thing): 4 voices (drums, bass, pad, lead) all procedural via Web Audio. The match scores itself:
  - BPM rises from 96 to 128 as the round timer drains
  - Kill streaks trigger lead phrases (1 note, 2 ascending, 3-note arpeggio, full pentatonic run on a 4+ multikill)
  - Doomed state slumps the pad to Phrygian b2, drops the snare, adds a sub-LFO "tunnel" feel
  - Stasis field cuts the drums entirely (silence as a feature)
  - Round end shifts to Picardy third (victory, lifts to major) or i-iv-i descending (defeat, the sigh)
  - Match end resolves I-V-I or sits unresolved on i-VII-VI-V
  - Picks a key per match (A minor, D minor, E Phrygian, or F# minor)

## Settings

Master toggles for music (with intensity ceiling: chill / normal / wild), separate volume sliders for music vs sfx vs ambient, voice picker for the announcer, mute-music-in-lobby, all persisted to localStorage.

## What it isn't

No Electron wrapper, no native build, no installer; it's one HTML file (~26k lines if you're curious, all systems inline). Trystero handles the netcode for what light networking exists. No microtransactions, no accounts, no telemetry; you double-click the file and it runs.

## Try it

Drop the file in your browser of choice (Chrome/Edge for best WebGPU pre-flight, headset browser for VR). Pick a ship. Fly the Nexus first if you want flow, the Tower if you want vertical chaos, the Octahedron if you want to feel small.

Feedback welcome on anything: the new music layer especially, since it's the freshest system and there's a settings ceiling if it's too much.

Fly safe out there.

(P.S. v7.1VR remains the frozen rollback baseline if anything in v8.1 turns out to bite. It's not going anywhere.)
