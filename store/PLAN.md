# App store plan: which apps, which stores, in what order

Created: 2026-09-29
Last updated: 2026-09-29
Version: 1.0

**Owner's question:** *"I have so many html apps and labs... It's silly I don't have any of them in any app store."*

## The short answer

- **Ship a few strong apps, not hundreds.** Google Play bans "multiple apps with highly similar functionality, content, and user experience", and Apple's 4.3 rule says the same. Forty labs published as forty listings is the fastest way to get an account flagged, so the labs become one app.
- **The hard work is in store accounts and listings, not code.** Every one of these apps is already a website. A store package (a Trusted Web Activity for Play and Quest, a PWA package for the Microsoft Store) opens the live site full screen. After that, deploying the site updates the store app too, with no resubmission.
- **Start with the Microsoft Store, and start Google Play's clock in parallel.** Microsoft is free, has no tester gate, and reviews in 1 to 2 days. Play requires a closed test with 12 testers for 14 consecutive days before a new personal account can publish, so that 14-day clock should start as early as possible.

## The apps, in waves

### Wave 1: Last Ship Sailing (ready now)

The game became an installable app in v49.88: it has a real manifest, icons, an offline screen, and a store mode that keeps the PayPal shop and DONATE out of store builds. `store/README.md` has the steps for each store.

| Store | Fit | Cost | Gate |
|---|---|---|---|
| Microsoft Store | keyboard, mouse and gamepad audience; WebGL and WebGPU on desktop GPUs | free | ID plus selfie; the publisher is your own name unless you open a company account |
| Google Play | touch controls are already built; landscape | US$25, once | 12 testers for 14 days, and a physical Android 10+ phone |
| Meta Quest | the game already runs WebXR | not researched | packaged with Meta's Bubblewrap fork |
| Apple App Store | later | US$99 a year | Xcode 26 builds; 3.1.3(b) means the liveries must also be sold through in-app purchase |

### Wave 2: Goopling (small work, best phone game)

`goopling.html` is a single 120 KB file, and it was built for touch: hold and drag to slosh, pinch to zoom, double-tap to pulse. It has peer-to-peer "join" through trystero, mutation choices and goopling trading, and no payments. It is the best fit in the repo for a phone app store.

To-do:

- Its own manifest and icons, scoped to the page. It is served next to LSS on `lss.fractalreality.ca`, so it needs its own `id` and `scope`.
- A phone test in a TWA.
- Store screenshots.

No store mode is needed, because there is nothing to buy.

### Wave 3: Fractal Labs (one app, curated)

The Labs page on fractalreality.ca lists 42 labs, served from `lss.fractalreality.ca/labs/`. Together they make one strong "interactive simulations" app. Separately they would be 42 thin ones.

To-do:

- A home screen at `labs/index.html`: cards, a WebGPU check, and a clear message on devices without WebGPU. The current index lives on fractalreality.ca, not beside the labs.
- A manifest scoped to `/labs/`.
- Curation. Leave out development probes and duplicates:
  - `ao_spike`, `branchwork_probe`, `webgpu_rt_poison_repro` and `mesh_inference`.
  - The `* - legacy.html` copies.
  - The LSS prototypes `fire_cloud_lab`, `fractal_lab`, `fractal_arena` and `fractal_deep`.
- Input. Most labs are "fly with WASD and the mouse". Only eight listen for touch or pointer events at all: `city_generator_webgpu`, `emergence`, `modal-lab`, `recursive_webgpu_emergence_engine_v2`, `rule_zero`, `seeds_ladder`, `wind-routing` and `wind-tank`. So the **Microsoft Store is the first target**. Play comes after the fly-through labs get touch or gamepad controls.
- WebGPU on Android needs Chrome 121+ on Android 12+ (ARM, Qualcomm or Intel GPUs). A TWA can open in a browser other than Chrome, so keep the WebGL paths where they exist.

### Wave 4: a Circumpunct app, from Fractal_Reality (bigger decision)

The framework site is mostly essays. Essays are a website, and the books belong in book stores. There is also a real set of interactive pieces that could make one "Circumpunct" app:

- **Audio and visual:** `the_staggered_octave_heard`, `helix_audio`, `phi_resonance`, `binaural_beats_51`, `attune`.
- **Simulations:** `simulations/` (Genesis, The Tree That Dreams, The Living Creature, the framework shaders, Dancing Cosmos, Record Player, Kernel Explorer), `circumpunct_explorer`, `the_pole_gap_live`, `staggered_tqc`.
- **Guided practices:** `rephase_meditation`, `reclaim_stress_meditation`.

It needs a hub, curation and a manifest in `docs/`. This is a product decision, not a porting job, so it waits for your call.

### Smaller, optional

- `number-reader.html` ("Learn to Read Any Number!") could be a tidy kids' app. Kids' apps bring Play's Families policy and Apple's Kids rules, so treat it as its own project.
- Baseball Blitz is a two-player gamepad couch game. It suits the Microsoft Store or Steam, not phones.
- Table Legends (the party photo card game) is experimental; wait until it is finished.

## Not shippable to any store

- **Pokémon-themed pages:** `chess.html` ("Pokemon Chess"), `checkers.html`, `pokemon-battler.html` and `pokemon-battle-helper.html`. The name and characters belong to Nintendo, Game Freak and The Pokémon Company, so a store listing would be removed on the first complaint.
- **Personal pages:** `Jenn_Love.html`, `Landen_Love.html` and `Landen_Love2.html`.
- **Dev tools, backups and old builds:** `tools/`, `lss_old_versions/`, `LSS_old/`, `Caverns/backups/` and `microverse_megabattle/v1*` to `v4*`.

## What the scan found (2026-09-29)

These counts exclude backups, old versions and `.git`.

- **Totals:** 465 HTML files. Fractal_Reality has 336, 316 of them in `docs/`. FractalGaming has 129.
- **Fractal_Reality `docs/`:** mostly essays, with a smaller set of interactive pieces, the best of which are listed in Wave 4.
- **Games:** LSS, Goopling, Table Legends, Baseball Blitz, and Microverse Megabattle (v5, keyboard only, in active development). Ace Starship is already on Roblox.
- **Labs:** 52 files in `labs/`, of which 42 are public.
- **LSS lab tools:** Map Lab, Sound Lab, FX Lab, Ghost Lab, Replay Studio. These are already reachable from inside the game, so the store app includes them.

## Your next actions

1. Deploy v49.88 (`tools/deploy_cf.py`), then check that the address bar in Chrome or Edge offers **Install** on lss.fractalreality.ca.
2. Open a Microsoft Partner Center individual account and reserve "Last Ship Sailing".
3. Open a Google Play developer account (US$25) and **start recruiting 12 testers now** through Discord and r/LastShipSailing. The 14-day clock is the longest wait in the plan.
4. Take real gameplay screenshots: desktop 1920x1080 and a phone in landscape.
5. Package with PWABuilder, following `store/README.md`.
6. Decide on Wave 2 (Goopling) and Wave 3 (Labs); both are ready to be built.

## Revision history

- 2026-09-29 v1.0: initial plan; inventory of both repos, four waves, exclusions, next actions
