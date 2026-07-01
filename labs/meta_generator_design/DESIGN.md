# Meta-Generator — design

*A procedural generator that generates new procedural generators.* Design output of a multi-agent workflow (8 agents): an exhaustive operator grammar, a 123-item phenomena catalog, three candidate architectures scored + synthesized, and an adversarial critique. Raw artifacts alongside this file.

## The thesis

A generator is **data**, not code. Fix one alphabet of field operators; a "generator" is a wiring of those operators (a DAG) ending in an **interpret head** that says how to read the result (height / density / color / flow / emissive). The meta-generator writes that data from a seed. One compiled GPU **Field-VM** evaluates *any* genome from a storage buffer — so reseed/mutate/breed = `writeBuffer`, never a shader recompile.

## Winner: C2 — bytecode-VM, extended

Scored `C2 8.6 > C3 7.6 > C1 6.4`. C1 (per-genome WGSL codegen) was rejected — it re-introduces the one fatal risk, shader-compile storms. C2 is the spine; it absorbs C3's L-system layer and MAP-Elites/novelty fitness.

- **Genome** = a topologically-sorted DAG of ~30 opcodes in a fixed-capacity bytecode slice; a header carries seed, kind, root, palette.
- **Field-VM** = one WGSL module, compiled once, with a uniform full-length loop over the bytecode (NOP-masked → no divergence, no recursion, no stack).
- **Interpret root** opcode fixes the KIND and routes to a render head — "one field read differently" is literally one opcode.
- Everything reproducible from a seed; the field drop-in-replaces `heightAt` for the existing field↔particle join.

## The critique's load-bearing warning (honest scope)

> The field-VM alone is a **quality-diversity parameter explorer**, not truly a generator of *kinds*. A coord→scalar DAG feeding 5 fixed sinks can only re-permute {fbm, ridge, worley, warp, terrace, …}. New topology of the same primitives into the same sinks is new *parameters-of-structure*, not new *kinds*.

What converts it to genuine novelty (in leverage order):
1. **Mandatory L-system PART layer with an *evolvable grammar*** (rules/symbols/branch stochastics as genome) — the only subsystem whose *output space grows with the genome* (branching topology, recursive depth). Branching structure is unreachable by any rewiring of a scalar field.
2. **Genome-selectable iteration kind** (reaction-diffusion vs erosion vs CA vs flow-accumulation as an evolvable choice, fed back as an input op).
3. **A grammar over the render head itself** — compose heads (a height field that is *also* the density mask) instead of picking one of five.

→ **Stage 1** (`labs/meta_generator_webgpu.html`) ships the correct field-VM backbone, labeled honestly as a *field-generator*. **Stage 2** adds (1) to make the "new kinds" claim true.

## Validity fixes baked into stage 1

- Fixed `MAX_OCT` octave loop with amplitude masking — never a runtime loop bound.
- Scrub catches **Inf** as well as NaN (`clamp(select(0,r,r==r), ±1e18)`); coord-emitting ops clamped to world range.
- Serializer enforces topological order / no forward references; exactly one interpret root; every path hits ≥1 structuring op (coherence by construction).
- One **explicit shared bind-group layout** (not `layout:'auto'` per head).
- Gallery is **one instanced draw**; per-tile genome index comes from `instance_index` — never a mid-pass uniform rewrite.
- Small register file, capped tile resolution.
- Generation is pure integer/float CPU math → same seed = same biosphere on every machine (share the seed, or the genome bytecode).

## Deferred to stage 2+

Evolvable L-system creatures; genome-selectable iterate passes (RD/erosion/CA reusing the join's atomic+heal machinery); MAP-Elites + novelty fitness (stage 1 uses coherence-by-construction); breed/pin/mutate UX; fullscreen fly through a chosen genome via the field↔particle join.
