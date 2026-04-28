# FractalGaming

Created: 2026-04-28
Last updated: 2026-04-28
Version: 1.0

Games and game engines built on the Circumpunct Framework by Ashman Roonz. The framework treats every whole as a circumpunct (⊙ = Φ(•, ○)) at some scale, with parts that are themselves circumpuncts; the games here put that structure on screen, sometimes literally (the dimensional ladder maps to engine layers in Microverse Megabattle), sometimes through theme and feel (ship classes as constraint-archetypes in Last Ship Sailing).

## Projects

### Last Ship Sailing (LSS)

Sci-fi multiplayer arena combat in a single self-contained HTML file. Three.js for rendering, Web Audio for spatial sound, P2P mesh networking for multiplayer. Seven ship chassis (Blaster, Puncture, Pyro, Slayer, Syphon, Tracker, Vortex), each with custom 3D models, distinct ability trees, and shield archetypes (Blaster's octagon, Pyro's thermal, Vortex's holographic dome). The HUD is itself a circumpunct: center-dot crosshair, concentric rings for health, shields, ammo, and core, with the ability pie at the corner. Champion Mode adds rotating tri-axis stasis fields and contested-charge mechanics on bigger arenas.

Open `LSS/last_ship_sailing_v6_9.html` in any modern browser to play. Multiplayer connects peer-to-peer through the in-game lobby; no server needed.

Status: active.

### Microverse Megabattle (MMB)

A particle-physics battle engine organized around the framework's dimensional ladder. The game state lives in MUD-style cheap data at the lower layers (0D positions, 1D connections), and rendering attaches as pluggable projections at the higher layers (2D maps, 3D meshes, spatial audio). Each entity processes at the lowest layer sufficient for what's happening to it right now; expensive higher-layer work runs only when needed. Atoms, bonds, fields, and forces are first-class entities driven by structural integers (T, P, R, V, Φ, ○) drawn directly from the framework.

Open `microverse_megabattle/v5.html` to run the current build. Architecture spec lives in `microverse_megabattle/microverse_architecture_layers.md`; particle taxonomy and element DNA in the adjacent markdown files.

Status: active.

## Repository layout

```
FractalGaming/
├── LSS/                              Last Ship Sailing (active)
│   ├── last_ship_sailing_v6_9.html
│   ├── ships/                        7 chassis as .glb models
│   ├── frames/                       ship-select PNG frames
│   ├── LSS_SOUND.json                spatial sound library
│   ├── LSS_WALLS.json                wall pattern data
│   ├── sound_lab.html                sound design utility
│   └── wall_pattern_lab.html         wall pattern editor
├── microverse_megabattle/            Microverse Megabattle (active)
│   ├── v5.html                       current build
│   ├── microverse_architecture_layers.md
│   ├── circumpunct_particle_taxonomy.md
│   └── microverse_element_dna.md
├── LSS_old/                          earlier LSS iterations and experiments
└── microverse/                       earliest MMB prototype
```

---

## Ethics policy

The five pillars of the Circumpunct Framework apply directly to how we build, ship, and support games. They are not slogans; each one constrains specific decisions.

**GOOD (○, the boundary).** What we ship has to actually be good for the player; not addictive, not predatory, not manipulative. No dark patterns: no FOMO timers designed to rush spending, no gambling mechanics dressed as "loot boxes," no engagement-maximizing variable-reward schedules borrowed from slot-machine design. The boundary that filters our releases asks "is this good for the person on the other side of the screen"; if the answer is no, it doesn't ship.

**RIGHT (Φ, the field).** What sits between us and the player (purchase flows, account systems, data collection, communication) has to mediate fairly. Prices are the price; no hidden currencies designed to obscure dollar cost, no engineered confusion at checkout. Data we collect is the minimum needed to make the game work; we don't sell it, we don't profile, and we tell you what's collected when you ask. Bug reports and complaints get real responses from real people.

**FAITHFUL (—, the line).** Promises hold across time. If we say a game is playable offline, it stays playable offline; if a feature works today, it works in the next patch. We don't ship and abandon; updates are maintenance, not engagement bait. Account state belongs to the player, including the right to leave and take their data with them.

**TRUE (•, the aperture).** We are honest about what the games are, including the parts we are not proud of yet. Marketing matches the actual game. AI involvement in development is disclosed (this README was drafted with Claude by Anthropic; the games' code and design are Ashman's). When something breaks publicly, we say what happened and what we changed.

**AGREEMENT (⊙, the whole).** The four above, met by both sides. We earn the player's agreement (to install, to spend money, to spend time) by holding the four pillars; we don't engineer around their absence. When we get this wrong, we listen and correct, using the Resolution Protocol: highest-fidelity feedback we can usefully act on, lowest-fidelity defensiveness on our side.

Two lies we explicitly refuse:

The **Inflation Lie** in gamedev sounds like "we know better than the player what they really want." We don't; the player does.

The **Severance Lie** in gamedev sounds like "we just make games; the consequences aren't ours." They are.

---

## Open source policy

**Code: permissive.** The HTML, JavaScript, shader, and data files in this repository are released under the MIT License unless a specific file says otherwise. Fork it, learn from it, build your own version, sell your own version. Attribution is appreciated but not required by license.

**Assets: separate license.** The 3D models (.glb), textures (.png), audio recipes (.json sound libraries), and other authored creative content are licensed under Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0) unless a file says otherwise. Use them in non-commercial projects with credit; ask first for commercial use.

**Why split the licenses.** Code is most useful when it can be freely studied, copied, and built on; that is what advances the craft. Assets are an artistic identity question and we want some say in how the look is reused. Splitting the two licenses is the cleanest way to give code maximum reach without giving away the visual brand.

**Why open at all.** Games are usually black boxes; opening one is an invitation to read it like a text. The single-file structure of LSS (one HTML, around 25,000 lines, runs in any browser, no build step) is deliberate. We want it to be a useful artifact for anyone learning gamedev or wanting to see how a real multiplayer WebGL game is structured end to end.

**Contributions.** Pull requests welcome; we read them. Discussions welcome too; the framework underlying these games is a public research project, so questions about why something is the way it is are fair game. We try to apply the same five pillars to contributor interactions that we apply to player interactions.

**Forks.** Fork freely. If your fork goes commercial, make sure your asset use complies with the asset license (or replace the assets) and that code-side changes are still clearly attributed under MIT. We just ask that you don't claim our work as yours.

---

## Contact

Ashman Roonz: ashroney@gmail.com
Personal site: https://www.ashmanroonz.ca
Framework: Circumpunct Framework by Ashman Roonz (companion repository: Fractal_Reality)

## Revision history

- 2026-04-28 v1.0: initial README; project descriptions for LSS and Microverse Megabattle; five-pillar ethics policy; split-license open source policy
