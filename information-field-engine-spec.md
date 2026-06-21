# Information-Field Engine

### A design spec for future games

Author: Ashman Roonz
Status: Living design spec
Last updated: 2026-06-20

---

## 0. Purpose of this document

This is the north-star architecture for games built under FractalGaming. It is engine-agnostic and game-agnostic; it describes how to *think about* a game so that the hard features (multiplayer, replays, huge worlds, modern rendering) fall out of the architecture instead of being bolted on later.

It is the refined product of a deliberate process: an intuitive framework was used as a language to reason into unfamiliar technical territory, then pressure-tested against real engine constraints until the language and the mechanics agreed. The slogans were retired. The commitments were kept.

---

## 1. Thesis

> A game world is a logically substrate-agnostic information field whose authoritative state is never stored in observer-projected form. Processors evolve that field along two orthogonal axes, **Evolution** and **Observation**; a deterministic core (with reconciliation) guarantees that the same inputs re-evolve the same world, while a cosmetic layer is free to diverge. Observation is a measurement-and-reconstruction operator that integrates a bounded, retained window of the field's history into one observer's filtered, lossy frame. Because authority is observer-independent and observation is detachable, replays, rollback, headless servers, and multi-view rendering are all the same operation applied differently.

That final sentence is the payoff. The rest of this spec exists to make it true in code.

---

## 2. The two axes

The classic mental model is "CPU runs the game, GPU draws it." That is a hardware accident, not a principle. Modern GPUs evolve simulations and modern CPUs decide what to perceive. So the real split is functional, not physical:

**Evolution.** Advances authoritative state under fixed rules. Owns truth. Has no camera and needs none. Deterministic core plus free-diverging cosmetic layer.

**Observation.** Reads the field from a viewpoint and reconstructs a percept (a frame). Owns nothing. Entirely derivable. Can be detached, duplicated, delayed, or discarded without affecting truth.

Either physical processor may perform either function. Authority lives on the Evolution axis; frames live on the Observation axis; the two need not coincide. A dedicated server is pure Evolution with zero Observation. A spectator client is almost pure Observation.

---

## 3. Core commitments

These six commitments are the spec. Everything else is implementation detail.

### C1. Truth is never stored in observer-projected form

Authoritative state must be observer-independent: every viewpoint must agree on it. State may live on the GPU (a fluid grid, an SDF, a particle buffer) and may be drawable, but it may never be stored *already projected and filtered for one camera*. A framebuffer is therefore never a source of truth; it is a readout.

*Test:* if two observers would disagree on a value, that value is a percept, not state, and may not be authoritative.

**Buys:** clean separation of gameplay from rendering; the renderer can be replaced wholesale without touching the simulation.

### C2. Evolution and Observation are orthogonal

The world's truth does not depend on anyone looking. Observation is a detachable function applied to retained state.

**Buys:** headless dedicated servers; spectator and director cameras; re-rendering any moment at any resolution; VR (two observations of one state); split-screen (N observations, one simulation).

### C3. The deterministic core re-evolves identically from inputs

Gameplay-authoritative state (positions, velocities, health, ownership, control inputs) lives in a deterministic core: same initial state plus same input stream yields the same world, bit-for-bit, on any machine. This requires a controlled numeric model (fixed-point, or tightly constrained floating point) and usually a custom or determinism-audited physics step, because most off-the-shelf physics engines are not cross-platform deterministic.

**Buys:** replays as nothing more than a stored input log re-evolved; rollback netcode; deterministic bug reproduction (ship the input log, replay the exact failure); cheap network state (send intent, not worlds).

### C4. The cosmetic layer is allowed to diverge

Particles, decals, ragdolls, screen shake, ambient detail: anything no rule depends on lives outside the deterministic core and may differ between machines freely. Reconciliation never touches it.

**Buys:** the determinism tax is paid only where it earns its keep; visual richness without networking cost; the engine scales to large worlds an all-deterministic design could not afford (an MMO cannot lockstep its whole world).

### C5. Rendering is measurement *and* reconstruction

Observation samples the field, then applies priors to reconstruct a plausible frame: shading models invent highlights, temporal accumulation reuses prior frames, neural upscalers and frame generation synthesize detail and whole frames. The frame is a *reconstructed percept from sparse, noisy samples*, not triangles faithfully drawn. Design the renderer this way from day one.

**Buys:** native alignment with where rendering is actually going (TAA, DLSS/FSR, frame generation, Gaussian splatting, radiance fields) instead of treating them as bolt-ons.

### C6. Observation is bounded by a retention contract

Reconstruction can only integrate the history Evolution chose to keep. Infinite history is impossible, so Evolution owes Observation a bounded history horizon: N frames of motion vectors, prior depths, previous transforms. The axes are orthogonal in *authority* but coupled by this *retention contract*.

**Buys:** predictable memory budget; temporal techniques have a defined, guaranteed input.

---

## 4. What falls out for free

Under these commitments, the following are not features to build; they are the same mechanism viewed differently:

| Capability | What it actually is |
|---|---|
| Replay | Re-evolution of the deterministic core from a stored input log |
| Rollback netcode | Re-evolution from a corrected past state |
| Dedicated server | Evolution with Observation switched off |
| Spectator / director cam | An extra Observation of existing state |
| Multi-resolution / re-render | The same state observed at a different sampling rate |
| VR / split-screen | Multiple Observations of one Evolution |
| Deterministic bug repro | Re-evolution from the reporter's input log |

If a proposed feature in this list is hard to implement, that is a signal a commitment above has been violated somewhere.

---

## 5. Why this fits modern rendering

The frontier of geometry and lighting is already field-based: signed distance fields for shape, voxel and surfel structures for global illumination, grids for fluids and gases, radiance fields for appearance. An engine conceived as "evolve fields, then sample them" is structurally native to these techniques. A mesh-and-material-centric engine has to translate everything into triangles and fights the mismatch. Treating the field as primary and the mesh as one possible projection is closer to the frontier than the textbook object model.

The framebuffer should likewise be treated as a rich multi-channel structure (depth, normals, motion, material id, ownership), not a finished picture. This is how deferred shading and visibility buffers already work and is the foundation for screen-space effects. It is a cache of the field, never the field itself.

---

## 6. Networking principle

Do not transmit worlds. Transmit information and rules, and reconstruct worlds locally.

Bandwidth scales with player intent (inputs and control state), not with world size. Combined with C3, this allows enormous procedurally reconstructed worlds over a small network footprint. Authoritative corrections (state hashes plus reconciliation deltas) flow only for the deterministic core; the cosmetic layer is never synced.

---

## 7. Glossary: framework language to mechanics

The original intuitive language maps to real techniques. Keep the right column; the left column is the scaffolding that got us here.

| Framework language | Mechanics | Holds | Breaks |
|---|---|---|---|
| Information field | World-space authoritative state (ECS, grids, SDFs, particle buffers) | State is primary, render is derived | Field is not the pixel array; it is observer-independent state |
| Pixel-particle | A G-buffer sample / measurement operator | A pixel carries rich data, not just color | A pixel is an integral over a region and time, not a point particle |
| Spacetime slice | A temporal projection with a reconstruction kernel | A frame is a view of an evolving system | A frame mixes several times (TAA, scanout, reprojection), not one |
| Illusion core / GPU | The Observation function | Rendering creates perception, not reality | Observation runs on any processor, and it reconstructs, not just samples |
| CPU maintains reality | The Evolution function | Truth is advanced under rules | Evolution runs on any processor, including the GPU |
| Screen is fundamental | Screen is the lossy readout | Forces state-first thinking | The screen is the *least* fundamental layer, being the most lossy |

---

## 8. Boundaries and non-goals

The value is in the six commitments, not in the original slogans. Specifically retired:

- "The screen is fundamental." It is the lossy readout. State is fundamental.
- "Pixels are the fundamental particles." Pixels are measurement operators over the field.
- "A frame is a single slice of time." A frame is a temporal projection over a retained window.
- "Logically substrate-agnostic" is a *spec-level* statement only. At implementation, the substrate (data layout, cache behavior, what lives in VRAM) is where performance lives and must be chosen deliberately. Do not let the agnostic framing excuse careless representation.

Determinism is a tax, not a free property. Pay it only in the core (C3, C4). Confirm the chosen physics and math path is actually deterministic on every target platform before relying on replays or rollback.

---

## 9. Build order for a new game

1. Define the deterministic core state and its fixed-step update. Prove bit-exact re-evolution from an input log on one machine.
2. Add the input-log replay path. If replays work, C2 and C3 are real.
3. Split out the cosmetic layer; confirm it can diverge without breaking replays.
4. Add the Observation layer as a pure reader of state plus a retained history window (C6).
5. Add networking last: transmit inputs and rules, add reconciliation for the core only.
6. Layer reconstruction-based rendering (temporal accumulation, upscaling) onto the Observation layer.

If step 2 is painful, stop and fix the architecture before going further. Replays are the canary for the whole design.

---

## 10. One-line summary

Evolve an observer-independent field deterministically, keep truth out of rendered form, and treat every frame as one detachable, reconstructed observation; then replays, rollback, servers, and multi-view are all the same thing.
