# WebGPU Port : Discipline Rules

The first phase of this port was ad-hoc rewrites that produced regressions ;
the cluster gas (BCS / dots) is the one validated win because it was built in
isolation via `bcs_spike.html` and proven before merging. Everything else was
built in-place and is worse than v17o. From this commit forward, the rule is :

## Rule 1 : Spike-page before merge

Every visual subsystem that was a downgrade gets its own spike page before
ANY new code lands in `last_ship_sailing_webGPU.html`. Pattern :

- File : `<system>_spike.html` (e.g. `lightning_spike.html`)
- Loads three.webgpu.js + minimum boot (renderer, scene, camera, one
  PointLight). No game logic. No FX module loading.
- Renders ONE instance of the subsystem in isolation.
- Has on-screen controls (sliders, buttons) for the parameters that matter.

## Rule 2 : Side-by-side parity check

Before declaring a port "done" :

- Open v17o in one Chrome tab and observe the subsystem firing.
- Open the spike page in another tab.
- Both must look interchangeable to the eye.
- Chrome MCP can drive this comparison via screenshots.

## Rule 3 : Don't invent

For each system, the WebGPU port replicates v17o's exact visual recipe.
No "let's try a TSL noise displacement here." No "this looks close enough."
No swapping a CatmullRom curve for a polyline-faithful tube and calling it
the same. Match v17o pixel-close OR declare it can't be matched and explain why.

## Rule 4 : One improvement at a time, gated

Improvements only happen AFTER parity ships. Each improvement is itself a
spike with v17o-parity in one tab and the improved version in another. If
the improved version is unambiguously better, merge. If it's "different but
arguable," default to v17o.

## Rule 5 : Cluster gas is the floor

The current BCS / dots cloud chemistry stays as-is. It was the only system
built spike-first and is the only system the player likes more than v17o.
It's the proof of concept and the floor we measure other systems against.

## Currently downgraded vs v17o (priority order)

1. Lightning bolts ("ugly tube geometry", "no bolts")
2. Tracers (spaghetti when strafing — partially patched)
3. Explosions ("lava rocks melting away" — partially patched)
4. Shield hit FX ("blemishes on the sphere" — patched ; verify parity)
5. Damage smoke ("floating ring/halo" — patched ; verify parity)
6. PYRO fire chain (foreign-looking circles)

## What gets verified

For each spike :

- [ ] v17o's exact behavior identified in the source
- [ ] Spike page running the WebGPU TSL port
- [ ] Side-by-side screenshots in this folder
- [ ] User sign-off on parity
- [ ] Merge into webGPU.html
- [ ] Strike from this list
