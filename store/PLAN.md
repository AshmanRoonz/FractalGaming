# App store plan: which apps, which stores, in what order

Created: 2026-09-29
Last updated: 2026-09-29
Version: 1.1

**Owner's question:** *"I have so many html apps and labs... It's silly I don't have any of them in any app store."*

**Owner's decision, same day:** *"Lss won't be one of them."* Last Ship Sailing stays web-only. The LSS store work drafted on this branch (v49.88: manifest, icons, offline worker, store mode) was reverted before it was merged or deployed, and LSS is exactly as it was at v49.87.

## The short answer

- **Ship a few strong apps, not hundreds.** Google Play bans "multiple apps with highly similar functionality, content, and user experience", and Apple's 4.3 rule says the same. Forty labs published as forty listings is the fastest way to get an account flagged, so the labs become one app.
- **The hard work is in store accounts and listings, not code.** Every app here is already a web page. A store package (a Trusted Web Activity for Play and Quest, a PWA package for the Microsoft Store) opens the live page full screen. After that, deploying the page updates the store app too, with no resubmission.
- **Microsoft Store first; start Google Play's clock early.** Microsoft is free, has no tester gate, and reviews in 1 to 2 days. On Play, a new personal account must run a closed test with 12 testers for 14 consecutive days. Most sources say this applies to each app, which is one more reason to ship few, strong apps.

## The candidates

### Fractal Labs: one app, curated (the labs)

The Labs page on fractalreality.ca lists 42 labs, served from `lss.fractalreality.ca/labs/`. None of them link into LSS. Together they make one strong "interactive simulations" app. Separately they would be 42 thin ones.

To-do:

- A home screen at `labs/index.html`: cards, a WebGPU check, and a clear message on devices without WebGPU. The current index lives on fractalreality.ca, not beside the labs.
- A manifest scoped to `/labs/`, with its own icons.
- Curation. Leave out development probes and duplicates:
  - `ao_spike`, `branchwork_probe`, `webgpu_rt_poison_repro` and `mesh_inference`.
  - The `* - legacy.html` copies.
  - The LSS prototypes `fire_cloud_lab`, `fractal_lab`, `fractal_arena` and `fractal_deep`.
- Input. Most labs are "fly with WASD and the mouse". Only eight listen for touch or pointer events at all: `city_generator_webgpu`, `emergence`, `modal-lab`, `recursive_webgpu_emergence_engine_v2`, `rule_zero`, `seeds_ladder`, `wind-routing` and `wind-tank`. So the **Microsoft Store is the first target**. Play comes after the fly-through labs get touch or gamepad controls.
- WebGPU on Android needs Chrome 121+ on Android 12+ (ARM, Qualcomm or Intel GPUs). A TWA can open in a browser other than Chrome, so keep the WebGL paths where they exist.
- Dependencies. Three.js and other libraries load from cdn.jsdelivr.net and esm.sh. That is fine for store packages that open the live site; an Apple build that bundles everything would have to include local copies.

### Goopling: the best phone game

`goopling.html` is a single 120 KB file, and it was built for touch: hold and drag to slosh, pinch to zoom, double-tap to pulse. It has peer-to-peer "join" through trystero, mutation choices and goopling trading, and no payments or outbound links. It fits Google Play and the Microsoft Store.

To-do:

- Its own manifest and icons, with an `id` and `scope` for the page.
- A privacy policy. Its peer-to-peer join sends data to other players.
- A test on a real phone.
- Store screenshots.

### Circumpunct: one app from Fractal_Reality (a product decision)

The framework site is mostly essays. Essays are a website, and the books belong in book stores. There is also a smaller set of interactive pieces that could make one "Circumpunct" app:

- **Audio and visual:** `the_staggered_octave_heard`, `helix_audio`, `phi_resonance`, `binaural_beats_51`, `attune`.
- **Simulations:** `simulations/` (Genesis, The Tree That Dreams, The Living Creature, the framework shaders, Dancing Cosmos, Record Player, Kernel Explorer), `circumpunct_explorer`, `the_pole_gap_live`, `staggered_tqc`.
- **Guided practices:** `rephase_meditation`, `reclaim_stress_meditation`.

It needs a hub, curation and a manifest in `docs/` (served by GitHub Pages at fractalreality.ca).

### Smaller apps (each its own listing, so choose sparingly)

- **`number-reader.html`** ("Learn to Read Any Number!") could be a tidy kids' app. Kids' apps bring Play's Families policy and Apple's Kids rules, so treat it as its own project.
- **`filedrop.html`** (DEADDROP, a serverless file drop over WebRTC). It carries a PayPal donate button, which should be hidden in a store build (see the donate note in `store/README.md`).
- **Baseball Blitz** is a two-player gamepad couch game. It suits the Microsoft Store or Steam, not phones.
- **Table Legends** (the party photo card game) is experimental; wait until it is finished.

## Not going to a store

- **Last Ship Sailing:** owner's decision, 2026-09-29.
- **Pokémon-themed pages:** `chess.html` ("Pokemon Chess"), `checkers.html`, `pokemon-battler.html` and `pokemon-battle-helper.html`. The name and characters belong to Nintendo, Game Freak and The Pokémon Company, so a store listing would be removed on the first complaint.
- **Personal pages:** `Jenn_Love.html`, `Landen_Love.html` and `Landen_Love2.html`.
- **Dev tools, backups and old builds:** `tools/`, `lss_old_versions/`, `LSS_old/`, `Caverns/backups/` and `microverse_megabattle/v1*` to `v4*`.

## What the scan found (2026-09-29)

These counts exclude backups, old versions and `.git`.

- **Totals:** 465 HTML files. Fractal_Reality has 336, 316 of them in `docs/`. FractalGaming has 129.
- **Fractal_Reality `docs/`:** mostly essays, with the interactive pieces listed above.
- **Games besides LSS:** Goopling, Table Legends, Baseball Blitz, and Microverse Megabattle (v5, keyboard only, in active development). Ace Starship is already on Roblox.
- **Labs:** 52 files in `labs/`, of which 42 are public.

## Next

1. Choose which of the candidates go first.
2. For each chosen app, build its store files: a manifest, icons, an offline screen, and store mode if the app shows any payment or donate link. The steps are in `store/README.md`.
3. Open a Microsoft Partner Center account (free). Open a Google Play developer account (US$25) and line up 12 testers.

## Revision history

- 2026-09-29 v1.1: LSS removed (owner's decision) and its store work reverted before merge; the labs are now the lead candidate; added DEADDROP and the hosting notes
- 2026-09-29 v1.0: initial plan; inventory of both repos, four waves, exclusions, next actions
