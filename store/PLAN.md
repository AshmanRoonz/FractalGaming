# App store plan: which apps, which stores, in what order

Created: 2026-09-29
Last updated: 2026-09-29
Version: 1.3

**Owner's question:** *"I have so many html apps and labs... It's silly I don't have any of them in any app store."*

**Owner's decision, same day:** *"Lss won't be one of them."* Last Ship Sailing stays web-only. The LSS store work drafted on this branch (v49.88: manifest, icons, offline worker, store mode) was reverted before it was merged or deployed, and LSS is exactly as it was at v49.87.

## The short answer

- **Ship a few strong apps, not hundreds.** Google Play bans "multiple apps with highly similar functionality, content, and user experience", and Apple's 4.3 rule says the same. Forty labs published as forty listings is the fastest way to get an account flagged, so the labs become one app.
- **The hard work is in store accounts and listings, not code.** Every app here is already a web page. A store package (a Trusted Web Activity for Play and Quest, a PWA package for the Microsoft Store) opens the live page full screen. After that, deploying the page updates the store app too, with no resubmission.
- **Microsoft Store first; start Google Play's clock early.** Microsoft is free, has no tester gate, and reviews in 1 to 2 days. On Play, a new personal account must run a closed test with 12 testers for 14 consecutive days. Most sources say this applies to each app, which is one more reason to ship few, strong apps.

## The candidates

### Fractal Reality Labs: one app, curated (the labs), BUILT

The Labs page on fractalreality.ca lists 42 labs, served from `lss.fractalreality.ca/labs/`. Together they make one strong "interactive simulations" app. Separately they would be 42 thin ones. None of them link into LSS.

**Built 2026-09-29 (in `labs/`, deployed by the next `tools/deploy_cf.py`):**

| File | What it is |
|---|---|
| `labs/index.html` | The app's home screen. It has the same 42 labs, four sections and descriptions as fractalreality.ca/labs.html, without the LSS mentions. Each lab opens in the same window, and Back returns to the home screen. It checks for WebGPU: without it, a notice appears and the 28 labs built for WebGPU are dimmed. |
| `labs/manifest.webmanifest` | "Fractal Reality Labs" (launcher name "Fractal Labs"), scoped to `/labs/`. The display mode is `minimal-ui`, so installed desktop windows get Back and Reload buttons; it falls back to `standalone`. |
| `labs/icons/` | A gold ⊙ on the Labs page's dark background: any and maskable versions, 192 and 512 px, plus the Apple touch icon. |
| `labs/sw.js`, `labs/offline.html` | The offline screen only, scoped to `/labs/`. It caches nothing the labs load, and its kill switch is written in its header. |
| `labs/privacy.html` | The privacy policy for the store listings. Every claim was checked against the lab sources. |

**Tested in headless Chromium 141:**

- 42 cards, and all links return 200.
- No page errors.
- Chrome reports no manifest or installability errors.
- No horizontal scrolling on a phone.
- The worker's scope is `/labs/`, and it caches only `offline.html`.
- An offline lab navigation shows the offline page.

**Not tested:** the labs themselves on real WebGPU hardware, because this sandbox has no GPU and blocks the CDNs. The lab files are unchanged.

**Measured facts behind the hub:**

- WebGPU. 14 labs call WebGPU directly. Another 14 use three.js's WebGPURenderer, which tries WebGL2 when WebGPU is missing; those compute-heavy labs may still need WebGPU. The remaining 14 labs use canvas 2D or WebGL.
- Input. Only eight labs listen for touch or pointer events: `city_generator_webgpu`, `emergence`, `modal-lab`, `recursive_webgpu_emergence_engine_v2`, `rule_zero`, `seeds_ladder`, `wind-routing` and `wind-tank`. So the **Microsoft Store is the first target**. Play comes after the fly-through labs get touch or gamepad controls.
- WebGPU on Android needs Chrome 121+ on Android 12+, and a TWA can open in a browser other than Chrome.
- Networking. Three labs (World Navigator, Field and Particle Join, Particle Break World) join a peer-to-peer room only when the user presses Connect, and share only the flyer's position, speed and view direction.
- Device access. Rule 0 uses the camera and microphone only when the user switches them on, and keeps them on the device.
- Dependencies. The labs load three.js and other libraries from cdn.jsdelivr.net and esm.sh. That is fine for store packages that open the live site; an Apple build that bundles everything would need local copies.
- Left out of the app: `ao_spike`, `branchwork_probe`, `webgpu_rt_poison_repro`, `mesh_inference`, the `* - legacy.html` copies, and the LSS prototypes `fire_cloud_lab`, `fractal_lab`, `fractal_arena` and `fractal_deep`.

**Draft Microsoft Store listing (edit freely):**

- **Name:** Fractal Reality Labs
- **Category:** Education (Entertainment would also fit)
- **Description:** Fractal Reality Labs is a collection of 42 live experiments in simulation and emergence: Navier-Stokes fluids and smoke, volumetric clouds and full-sky weather, matter that breaks, joins and reforms, procedurally generated worlds and cities you can fly through, cellular automata, and the cymatics of water. Every lab runs in real time on your device. Most are built on WebGPU, and the fly-through labs use the keyboard and mouse. Three labs let friends share a world by typing the same room code. No accounts, no ads, no analytics.
- **Privacy policy:** `https://lss.fractalreality.ca/labs/privacy.html`
- **Screenshots:** capture 4 to 6 labs on a WebGPU machine at 1920x1080 or larger. Sky Weather Sim, City Genome, Fluid 3D, World Navigator, Matter 3D and Modal Water Lab show the range.

### φ Resonance: a paid Android and iPhone app (owner's idea, 2026-09-29)

`Fractal_Reality/docs/phi_resonance.html` ("φ-Entrainment | Sound Laboratory") is the strongest single app in either repo:

- Eight sound engines: binaural, isochronic, monaural, drone, harmonic, φ-cascade, noise and chord.
- Presets and saved states, a session timer up to 2 hours, a breathing pacer, and a full-screen visual beat that already carries a photosensitivity warning.
- Serum 2 wavetable export.
- It loads nothing from other servers, so it can be bundled inside an app and work offline.
- It makes no health claims today. The page itself says "not a medical claim", and its presets describe only frequencies and modes.

**Positioning: wellness or sound tool, not "therapy"** (checked 2026-09-29):

- **Apple.**
  - 1.4.1 puts apps "that could be used for diagnosing or treating patients" under greater scrutiny and asks for regulatory clearance.
  - 2.3.1 makes misleading marketing grounds for removal and account termination.
  - 2.3.7 bans unverifiable claims in the subtitle.
  - 5.1.1(ix) says healthcare services should come from a legal entity, not an individual.
  - Developer forums report relaxation, anxiety and insomnia apps being rejected under 1.4.1 in 2025.
  - Source: <https://developer.apple.com/app-store/review/guidelines/>
- **Google Play, Health Content and Services policy.** A health app that is not a cleared medical device must say in its description that it is "not a medical device and does not diagnose, treat, cure, or prevent any medical condition", and must advise users to consult a healthcare professional. Every developer must also complete the Health apps declaration. The fitting categories are Sleep Management or Stress Management & Mental Wellness.
  - Sources: <https://support.google.com/googleplay/android-developer/answer/16679511>, <https://support.google.com/googleplay/android-developer/answer/14738291>
- **Regulators.**
  - FDA: the General Wellness guidance, revised 2026-01-06, treats "relaxation or stress management", "mental acuity" and "sleep management" as wellness claims. Treating an anxiety disorder or insomnia is a medical-device claim. The existing "therapy apps", such as SleepioRx and DaylightRx, are cleared prescription devices. Source: <https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices>
  - Health Canada: software is a device when its represented use is medical.
  - Competition Bureau and FTC: a performance or health claim needs adequate testing before it is made. For health claims, the FTC generally expects randomized controlled trials.
- **Evidence.**
  - Binaural-beat brainwave entrainment is inconsistent: a 2023 review found 5 of 14 EEG studies supportive. <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10198548/>
  - Modest anxiety effects show up mostly around medical procedures: a 2019 meta-analysis found g = 0.45. <https://pubmed.ncbi.nlm.nih.gov/30073406/>
  - There are no trials of golden-ratio tones.
- **Conclusion.** Market it for relaxation, focus, sleep wind-down, meditation and sound exploration. Keep "therapy" and "treats X" out of the name, subtitle, keywords and screenshots, and add Google's required disclaimer. The store name should be "Phi Resonance" rather than "φ-Entrainment", because "entrainment" reads as a claim to change the body. A clinical "therapy" product would mean a company, clinical trials and regulatory clearance: a different project.

**Build: a Capacitor app for both platforms, not a web wrapper.**

- **iPhone.** Apple wants a bundled, self-contained app for 4.2 and 2.5.2.
  - Screen-off playback needs `UIBackgroundModes audio` and `navigator.audioSession.type = 'playback'` (iOS 16.4+).
  - WebKit bug 261554, which suspended the AudioContext in the background, is fixed, but WKWebView hosts still interrupt the context. Resume it on `visibilitychange`, test on a real device, and keep a native audio plugin as the fallback.
- **Android.** Android 17 requires a visible activity or a `mediaPlayback` foreground service for screen-off audio; otherwise playback "fails silently". That needs native code, which a TWA does not have. Source: <https://developer.android.com/about/versions/17/changes/bg-audio>
- **Web-side changes:**
  - Media Session controls on the lock screen.
  - Resume audio on `visibilitychange`.
  - Share-sheet export in place of `a.download`, for preset JSON and the Serum files.
  - The Google disclaimer in the About screen.

**Selling:**

- **Model:** paid upfront. The store handles payment, so there is no billing code.
- **Apple:**
  - Enroll in the Small Business Program for a 15% commission.
  - The Paid Apps agreement is irreversible and needs banking and tax details.
  - Canadian developers must give a GST/HST number; it is unconfirmed whether a small supplier without one can proceed.
  - Selling in the EU makes you a DSA "trader", which shows an address, phone and email on EU product pages.
- **Google:**
  - 15% on the first US$1M; enroll in the 15% tier.
  - A payments profile with a legal street address is required, and **Google displays the full address publicly for accounts that sell**.
- **Web version:** the page is free on fractalreality.ca today. Keep it as a free lite version, or retire it, before launch.

### Goopling: the best phone game

`goopling.html` is a single 120 KB file, and it was built for touch: hold and drag to slosh, pinch to zoom, double-tap to pulse. It has peer-to-peer "join" through trystero, mutation choices and goopling trading, and no payments or outbound links. It fits Google Play and the Microsoft Store.

To-do:

- Its own manifest and icons, with an `id` and `scope` for the page.
- A privacy policy. Its peer-to-peer join sends data to other players.
- A test on a real phone.
- Store screenshots.

### Circumpunct: one app from Fractal_Reality (a product decision)

The framework site is mostly essays. Essays are a website, and the books belong in book stores. There is also a smaller set of interactive pieces that could make one "Circumpunct" app:

- **Audio and visual:** `the_staggered_octave_heard`, `helix_audio`, `attune`. φ Resonance is its own app (above), and `binaural_beats_51` could become one of its modes.
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

1. Deploy (`tools/deploy_cf.py`). Then open `https://lss.fractalreality.ca/labs/` in Chrome or Edge, and check that the address bar offers **Install** and that the privacy page loads.
2. Open a Microsoft Partner Center account (free, individual), reserve "Fractal Reality Labs", and package `https://lss.fractalreality.ca/labs/` in PWABuilder (steps in `store/README.md`).
3. Take 4 to 6 screenshots on a WebGPU machine and submit with the listing above.
4. Choose the next app: Goopling for phones, the Circumpunct app, or one of the smaller tools.

## Revision history

- 2026-09-29 v1.3: φ Resonance added as a paid Android and iPhone app (owner's idea); wellness positioning, store and regulatory rules with sources, build and selling notes
- 2026-09-29 v1.2: the Labs app is built (hub, manifest, icons, offline worker, privacy page, tested); draft Microsoft Store listing added
- 2026-09-29 v1.1: LSS removed (owner's decision) and its store work reverted before merge; the labs are now the lead candidate; added DEADDROP and the hosting notes
- 2026-09-29 v1.0: initial plan; inventory of both repos, four waves, exclusions, next actions
