# LAST SHIP SAILING v9 ; you fly through living tunnels

Open one HTML file. You're inside a hollow sphere; the inner walls breathe with bioluminescent life and crackle with soft electric arcs. Eight tunnels snake out toward other spheres, some bright, some dark. Your fleet spawns at one apex, the enemy at the other. The round starts.

## The flight

Six degrees of freedom, zero gravity, no friction except what your engines simulate. WASD strafes, mouse aims, gamepad fully supported. The cockpit frame breathes with your weapon's fire rate; rapid weapons strobe their muzzle flash, slow weapons pulse. Pick from seven ships:

- **BLASTER** ; high-rate hitscan with a frontal Gun Shield, two firing modes
- **SYPHON** ; corvette chaingun, green tracer field that lights up the smoke around you
- **PREDATOR** ; minigun-class sustained fire, screams like a banshee
- **TRACKER** ; tone-locking missiles + deployable Particle Walls
- **PYRO** ; thermal shield, firewall, gas-cloud combustion chemistry
- **SLAYER** ; sword + dash combat, dodge into knife range
- **VORTEX** ; charge-up laser that stores damage from incoming hits and dumps it back as a beam

Each ship has a **Core ability** that charges over the round. When it lights up the AI announces "Core charged, authorization granted" and you get one signature move per match.

## The world

The maps are sets of intersecting spheres and cylinders. No static asteroid clutter. What's in the rooms instead:

- **Cluster obstacles** ; molecules of irregular fractal rock tumbling in midair. Each atom is a piece of the same animated Mandelbox field, with rocky displaced geometry and procedural surface texture. Shoot one and it crumbles into 4-8 spinning chunks. Take all the atoms and the empty cluster site keeps crackling with the energy that used to hold them together.

- **Smoke clouds with chemistry** ; some drift independently across the map, some belong to the cluster atoms (and disappear when those die). Each cloud has a phase. Clouds with similar phases bond via gravitational attraction, swirl in loose orbits, bounce when they collide, and push apart when a ship flies through their wake. The smoke catches light from gunfire ; Syphon's green tracers tint the cloud around them, Pyro's flames paint it orange, your Vortex laser dumps blue across the whole tunnel.

- **Lightning** ; bolts arc inside individual clouds and between nearby ones (smoke clusters generate their own electric activity). Destroyed cluster sites keep crackling for the rest of the round.

- **Living plants on the walls** ; fractal branching vines growing inward from every wall and tunnel surface. They double in size when no ship is near and shrink to seeds when you approach, with a half-second smoothing so they read as cautious rather than snapping. Cyan/magenta palette so they belong to the environment. Distance fade keeps the field readable during combat.

## The mechanics

- **First to 3 round wins takes the match**. Champion field spawns mid-round; lock in for the full charge time and your team wins outright.
- **Stasis fields** scattered around the map. Hold inside one for full shield recharge. v9 lets stasis lift the doomed state too, so you can panic-recover from critical damage.
- **Doomed below 30% HP** ; hull wails, the AI announces "Warning. Hull compromised. Find shields immediately." You can grab shields and survive, but a ramming player or bot can still execute you.
- **Objects can damage you to zero, but not execute** ; only ships can finish a doomed enemy. The doom timer no longer auto-kills you.
- **Death = Ghost mode** ; free 6DOF flight, pass through walls, mouse to look. No spectate cycling, no UI clutter; you fly the wreckage yourself until respawn.
- **"Last ship sailing"** ; if all your bot teammates die and you're still alive, the AI announces it. Goosebumps moment.

## The audio

Procedural in-game music engine. Seven styles ; cosmic, cyber, doom, drift, battle, jazz, and the new v9 default **techno** (hard 4-on-the-floor at 140 BPM in A1 Phrygian, square-wave acid bass, off-beat hats, claps on 2 and 4, intensity ramps with combat busyness). Drums duck out inside stasis fields. Lead phrases trigger on kills. Pad shifts to Phrygian when you're doomed.

Surround audio: full 5.1 spatial sound via custom per-speaker VBAP routing on multi-channel desktops, not stereo HRTF. Sounds actually come from where the ship is in the room, including behind you. Procedural sci-fi voice announcer over the top.

## What's actually new in v9

- Walls are now alive (plants that react to your proximity)
- Cluster obstacles became fractal rocks with crumble physics
- Smoke catches gunfire as colored light
- Smoke clusters generate inter-cloud lightning
- Persistent dot ecosystem with phase-coupled chemistry; smoke clouds form, bond, orbit, get pushed by ship wakes
- 5.1 spatial audio rebuilt from scratch (no more crackles when Blaster opens up)
- Techno is the default music, ~140 BPM Phrygian
- Doomed ships can be saved by stasis fields but not by running away
- Shields always absorb damage before HP, always
- Death cam is a free ghost flight, not a spectate cycle
- Ghost smoke from dead clusters survives independently and crackles
- Round transitions clean every effect properly (no orphaned bolts)
- Dozens of micro-fixes documented in the source

## Try it

One HTML file. WebXR ready. Trystero peer-to-peer multiplayer (no server). Bot fillers when you're solo. Custom maps via JSON paste. Shipped with The Pentagon, MiddleBars, and Center Cube layouts. Settings panel covers FOV, audio, music style, controller bindings, custom maps, sound lab.

Open it. Pick a ship. Hold the trigger.

The fleet is yours.
