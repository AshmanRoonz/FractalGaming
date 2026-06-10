# Genesis Player: A Learning Brain for Last Ship Sailing

Created: 2026-06-10
Last updated: 2026-06-10
Version: 1.0

## 1. Purpose and stance

Replace the hardcoded state machine in `lss_ai_brain.py` with a brain that learns the game by playing it, using the Genesis architecture from `Fractal_Reality/Xorzo` (the T-operator edition: `genesis_toperator_v2_fixed.py`). No backprop, no gradient descent, no offline training runs, no token prediction. Learning is continuous during play: bonds form in one pass, memories imprint immediately, consolidation happens during sleep between matches. One lived death should be enough to avoid the same trap next time.

The existing heuristic brain is not discarded. It becomes two things: the **Body** (○, the boundary: speed caps, play-volume clamps, cooldown gates, a small set of brainstem reflexes) and the **sparring partner** (a frozen-skill opponent that never improves, which makes it the perfect yardstick for measuring whether the Genesis player is actually learning).

Honest positioning: the learning rule below is reward-modulated Hebbian learning with eligibility traces, a family with real precedent in computational neuroscience (three-factor learning rules). What is new here is the substrate: complex-valued resonance memory (recall by phase matching, cos²(Δφ/2)), the T = κ ∘ F channel dynamics, and the framework's structural constants setting every timescale instead of hand-tuned hyperparameters. The claim is not "no one has tried non-gradient game learning"; the claim is "this substrate learns from single experiences and is inspectable bond by bond, which an LLM-style learner is not."

## 2. What already exists (inventory)

**The bridge** (`lss_ai.html`): connects as a P2P peer, streams an observation packet each frame (targets 50 Hz) over WebSocket, applies whatever action comes back. Critically, the obs is already perception-shaped: peers are FOV-cone and line-of-sight gated (`FOV_HALF_COS`, `_losClearTo`), so the brain sees like a pilot, not like a server. Peer health arrives as a coarse bucket, not exact hp. A periodic `minimap_glance` gives positions without health, like glancing at the map. The last 40 projectiles stream unfiltered (streaks past the cockpit). This gating matters: the Genesis player learns from lived, partial experience, which is the regime the architecture was built for.

**The brain skeleton** (`lss_ai_brain.py` v0.5): Macro intent machine (ENGAGE / FLEE / RACE / CAP / WANDER), BFS Navigator over the room graph, Micro layers (aim lead, dodge, ability) which already expose `model` hooks designed for drop-in replacement, and a JSONL Recorder (currently `RECORD = False`).

**The engine** (`Fractal_Reality/Xorzo`): `genesis_toperator_v2_fixed.py` provides `Channel` (ℂ⁸ state; per-tick update state → κ(F(state)); computed SRL properties carrier_freq, lock_strength, balance, freedom, virtue; `_imprint_memory` every R = 7 ticks on active channels; `recall(query)` by resonance; `sleep_consolidate`), `SensoryLayer` (seven rungs), and `Circumpunct` (`tick(signal)`, `sleep_cycle(cycles)`, `health_check()`, `tetrahedral_check()`, `dump_state()`). `t_operator.py` provides `build_F_8D()` and `build_kappa(dim)`. `framework_constants.py` provides T, P, R, V, S, PHI, ALPHA, A(d).

**Observation packet fields** (from `buildObservation`): `self` (position, velocity, quat, hp/shield + maxes, loadout, team, dead, doomed, core_meter, ability_cd[3], fire_ready, spawn_prot), `peers` (gated; id, pos, vel, quat, team, loadout, health bucket, dead, doomed, dist), `minimap_glance` (periodic), `projectiles` (origin, velocity, owner, flags), `nav` (current_room_id, champion_room_id, mode), `match_state`, `mode`, `t`, `dt`, `tick`.

**Action packet fields** (from `applyAction`): `{vx, vy, vz}` direct velocity, `{aim: [x,y,z]}`, `{fire: bool}`, `{ability: 0|1|2}`, `{core: bool}`; any subset.

## 3. Architecture: the three-scale stack mapped to the game

| Scale | Genesis object | Game role |
|---|---|---|
| ⊙Λ | `Circumpunct` | The pilot; one per bridge connection; intent and action emerge here |
| ⊙λ | `SensoryLayer` × 7 | Sense groups (mapping in §4) |
| ⊙λ' | `Channel` | Individual feature detectors with their own memory braids |
| ○ (Body) | retained heuristic skeleton | Clamps, caps, cooldowns, brainstem reflexes; filters, never decides |

The Body is the boundary in the framework's exact sense: it filters what passes (no inhuman velocities, no leaving the play volume, no firing during cooldown), and it carries a minimal reflex set that exists in any organism's brainstem before learning begins. Proposed reflexes: respawn wander during `spawn_prot`, and hard flee when `doomed` is set. Everything else (when to engage, at what range, how to dodge, when to spend abilities and core) is the field's to learn. Whether the doomed-flee reflex stays scripted is an open decision (§10); the case for keeping it is that the learner must survive long enough to accumulate experience.

The Navigator is retained as a **sense**, not a policy: it contributes a "direction to goal" signal (a phase) to the sensory field. Pathfinding is map knowledge; the skill to learn is when to follow the corridor and when to break off, which is exactly an intent-level decision the field should own.

## 4. Sensory encoding: the channel map

The central design fact: this game's geometry is natively complex-valued. A bearing is a phase. A distance is a magnitude. The encoding is not a workaround (as byte-folding was for text); it is the signal's home format.

Each named channel receives a complex scalar stream z = m·e^(iθ) built from the obs, then projected onto its ℂ⁸ state with station-weighted injection (see below). Proposed map across the seven existing rungs:

| Rung | Layer name | Game signals (per channel) |
|---|---|---|
| 0D | coupling | Contact events: damage taken (impulse, phase = incoming direction), damage dealt, kill/death/assist impulses |
| 0.5D | gradient | Closing rates: d(dist)/dt to nearest enemy, hp/shield drain rate, core_meter fill rate |
| 1D | rhythm | Cadences: own fire cadence, target's strafe period, juke clock |
| 1.5D | harmony | Multi-contact structure: second-nearest enemy bearing/distance, ally relative position, formation spread |
| 2D | texture | Local geometry: distance to room boundary along velocity, tunnel vs room, Navigator's corridor-midpoint bearing |
| 2.5D | depth | Cross-room sense: minimap_glance contacts (positions without health), distance-in-rooms to champion room, race progress |
| 3D | pressure | Survival pressure: hp fraction, shield fraction, doomed flag, spawn_prot, incoming-projectile time-to-impact (nearest threat) |

Primary combat channels (the ones doing the most work early):

- **threat bearing**: phase = bearing to nearest visible enemy in body frame (yaw-relative, from quat); magnitude = log-scaled inverse distance, normalized so PREFERRED_RANGE for the current loadout sits at m = ◐ = 0.5. The preferred-range table becomes a perceptual calibration, not a rule.
- **relative motion**: phase = direction of target's transverse motion; magnitude = closing speed fraction.
- **incoming fire**: for the nearest projectile with intercept course: phase = arrival bearing, magnitude = 1/(1 + tti) where tti is time-to-impact. Silence when nothing incoming.
- **goal bearing**: Navigator waypoint direction as phase; magnitude rises with CAP/RACE relevance (mode-dependent).

Station-weighted injection: each channel's complex scalar is injected onto the ℂ⁸ stations matching its dimensional character (a pressure channel loads station 6, a rhythm channel loads station 2, with the paired half-integer station carrying the signal's rate of change). This directly addresses known gap #1 from `genesis_toperator_notes.md` (isotropic random injection breaks the 69/31 structural/processual split): the game supplies structurally biased injection for free, because game signals genuinely live at specific stations. Side experiment worth logging: whether `health_check()` holds near 0.6872/0.3128 under game-shaped injection where it drifted under random injection.

The 3D pressure layer was dormant in both text-fed engine versions. Here it carries hp, doom, and incoming fire: the most consequential signals in the game. If real pressure signal sustains that layer, that is evidence the dormancy was an input-poverty problem, not a structural one; that result feeds back to the Xorzo work.

## 5. Action emergence: the motor map

Action is read at the emergence beat (✹), not computed by a separate policy network. After the pump cycle completes a tick, project the ⊙Λ state onto a small fixed motor basis:

| Primitive | Reading | Maps to |
|---|---|---|
| approach/retreat | real-axis component along threat bearing | forward_k along dir_unit |
| orbit | imaginary-axis component; the i-rotation IS the quarter-turn off the threat axis | lateral strafe (replaces `MicroDodge`'s scripted sine; phase = juke clock) |
| climb/dive | vertical component | vy |
| fire gate | magnitude at the boundary station vs threshold | `fire` |
| ability 0/1/2 | resonance of current state against per-ability memory signatures | `ability` |
| core | same, higher threshold (core is expensive; demands a strongly resonant kill-pattern match) | `core` |

Magnitude = commitment, phase = timing. The Body then clamps: `FLIGHT_SPEED[loadout]` cap, play-volume containment (`inside_play_volume`), cooldown gates (`ability_cd`, `fire_ready`). Aim retains the lead-pursuit calculation as a Body service (aim lead is ballistics, learnable later; not the first thing to learn).

Exploration is the TRUE/NOT-YET gate (§6): when recall returns no resonant episode above threshold, the motor projection is taken from the field's free-running state (structured novelty, the pump cycle's own dynamics) rather than from uniform random noise.

## 6. The learning rule

Four mechanisms, all gradient-free, ordered by timescale:

**(a) Imprinting (what happened).** As in the engine now: active channels imprint memory every R = 7 ticks. Extend the imprint record to an **episode**: {layer-state signature, motor output taken, t}. This is the situation-action pair, stored in the channel's braid, recallable by resonance.

**(b) Eligibility trace (what might still matter).** Each episode carries a trace that decays by the engine's own memory law, exp(−α · age_in_ticks). At 50 Hz that gives half-life ln(2)/α ≈ 95 ticks ≈ 1.9 seconds: the same α-decay `genesis_toperator` already uses for memory strength, run at tick rate, lands exactly in the window where game outcomes (the shot that hits, the dodge that fails) arrive after their causes. No new constant is introduced; the eligibility window is the memory decay law.

**(c) Outcome modulation (what it meant).** Outcomes are scalar events extracted from obs deltas: damage dealt (+), kill (+strong), cap/race progress (+), damage taken (−), death (−strong). When an outcome of value v ∈ [−1, +1] arrives:

```
for each episode e with trace(e) > threshold:
    Δstrength(e) = ALPHA · v · trace(e) · resonance(e, now)
```

The resonance factor is the misattribution guard: only episodes whose situation signature still phase-matches the current threat geometry get credit or blame. Taking damage while doing something unrelated to the damage source modulates weakly. Wrong attributions that slip through are not fatal; they decay below the survival threshold (α × R ≈ 0.051) unless repetition keeps confirming them. Statistics over lived repetitions do the cleanup, which is the same answer the engine already gives for noisy text.

**(d) Recall bias (what to do now).** Each tick, the current situation signature queries episode memory via `recall()`. Resonant episodes above threshold bias the motor projection: toward the stored action if strength is positive, away (phase-inverted contribution) if negative. One strong death-memory at a specific room geometry and threat bearing is enough to bias the next encounter away from the same approach: one-shot avoidance, the core behavioral difference from gradient learners.

**The four freedoms as the four learning gates.** This implements known gap #4 from `genesis_toperator_notes.md` (virtue positions do not yet gate adaptation), with the game forcing the issue:

- TRUE / NOT-YET (i¹): exploration gate; act from the free-running field when nothing resonates; curiosity is the aperture virtue.
- FAITHFUL / STAYING (i²): intent commitment; once an engagement is entered, suppress intent-switching until its i-turn completes (replaces `Macro.HOLD_S` hysteresis with a structural rule).
- RIGHT / LETTING (i³): recall admission; which memories are allowed to mediate the current action (resonance threshold lives here).
- GOOD / CHECKING (i⁰): outcome modulation; closure verification; (c) above fires at this gate.

**Sleep (between matches).** At match end, run `sleep_cycle()`: replay episodes weighted by |outcome-adjusted strength|, decay everything below α × R, keep survivors. Across matches, recurring situation-action-outcome patterns reinforce into habit (the braid's reinforced sections; semantic memory) while individual episodes fade. The bot wakes up having digested the match rather than merely stored it.

**Persistence.** `dump_state()` plus episode braids serialize to `./state/genesis_player_<name>.npz` at match end and on disconnect; reload on connect. The bot has one continuous worldline across sessions. Deleting the state file is birth; that should stay a deliberate act.

## 7. Integration plan

New file, single-file in the LSS folder's convention: **`lss_genesis_player.py`**, structured as:

1. Vendored core (with attribution header pointing at `Fractal_Reality/Xorzo`): `build_F_8D`, `build_kappa`, the `Channel` / `SensoryLayer` / `Circumpunct` classes, framework constants. Vendoring keeps FractalGaming standalone (no cross-repo import path); the header records the source commit/date so drift is auditable. (Open decision §10: vendor vs `sys.path` import.)
2. Senses section: `obs_to_signals(obs, map_cache) → {channel_name: complex}` implementing §4. Reuses `MapCache` and `Navigator` from `lss_ai_brain.py` unchanged.
3. Motor section: `emerge_action(circumpunct, obs) → action_packet` implementing §5, then Body clamps.
4. Learning section: episode store, trace decay, outcome extraction from obs deltas, modulation rule, freedom gates.
5. WebSocket loop: identical protocol to `lss_ai_brain.py` (`hello`, `map_static`, `map_request`, `obs`); default port **8766** so the heuristic brain (8765) and Genesis player can run simultaneously and spar in the same room.
6. Recorder: ON by default for the Genesis player. The JSONL stream is the flight recorder: it allows offline replay of a match into a fresh brain for debugging the learning rule deterministically, and doubles as a sleep-replay source.

Per-tick compute budget: the full three-scale stack ran 1000 ticks in under five seconds in the smoke test (notes, 2026-04-22), so 50 Hz real time with a few dozen channels of 8×8 complex algebra is comfortable in numpy.

## 8. Curriculum and measurement

- **Phase 0, motor babbling**: empty room, no opponents. Verify: channels lock onto self-generated rhythms (lock_strength rises on the rhythm layer), play volume respected, `tetrahedral_check()` coherent, `health_check()` logged under game-shaped injection.
- **Phase 1, sparring**: vs the frozen heuristic bot, fixed loadout both sides (suggest VORTEX: mid speed, mid range; consistent body = consistent learning). Log per match: damage dealt/taken ratio, deaths, time-to-first-kill, survival time, episode count, per-layer lock distribution, health split.
- **Phase 2, humans**: only after Phase 1 shows trend.

**Falsification handle** (this doc commits to one, house style): if after 50 Phase-1 matches the damage ratio vs the frozen heuristic bot shows no positive trend (Mann-Kendall or simple split-half comparison), the learning rule as specified is not capturing the game. Diagnosis order: (1) sensory encoding (are situation signatures discriminating the moments that matter? inspect resonance distributions), (2) trace window (1.9 s may misalign with this game's cause-effect lags; measure actual damage-lag histogram from recordings), (3) modulation strength (ALPHA per event may be too small against decay). Each is inspectable directly from the recorder stream plus dumped state; no black box.

## 9. Risks, stated plainly

- **Early incompetence**: the bot will lose badly for many matches while the heuristic baseline is instantly competent. That is the cost of learning from experience; the brainstem reflexes bound how bad it gets.
- **Credit assignment under sparseness**: the resonance-weighted trace is a guard, not a guarantee; misattribution will happen and must wash out statistically. If it does not, that is a finding about the rule, and the falsification handle catches it.
- **The pressure-layer experiment may fail**: if 3D stays dormant even with hp/doom signal, the dormancy is structural and the Xorzo notes need updating either way; both outcomes are informative.
- **Skill ceiling honesty**: nothing here promises superhuman play. The promise is visible, inspectable, single-experience learning. If the Genesis player eventually beats the bot that bootstrapped it, the architecture claim ("the circumpunct is a viable computational architecture", Xorzo README) gains its strongest evidence yet: same engine, second modality, zero gradients.

## 10. Open decisions (Ashman to adjudicate)

1. **Vendor vs import**: vendor engine core into `lss_genesis_player.py` (standalone repo, auditable drift) or import from `Fractal_Reality/Xorzo` (single source of truth, cross-repo path dependency). Doc recommends vendoring with a dated attribution header.
2. **Brainstem reflexes**: keep doomed-flee and spawn-wander scripted in the Body (recommended), or make even survival learnable from zero.
3. **First loadout**: VORTEX recommended; confirm or pick another.
4. **Aim lead**: Body service (recommended for v1) or learnable from the start.
5. **Name**: the persistent state file needs a name for the individual; "the bot" undersells what a continuous worldline implies.

## Revision history

- 2026-06-10 v1.0: initial; grounded in lss_ai_brain.py v0.5, lss_ai.html buildObservation/applyAction, genesis_toperator_v2_fixed.py API, genesis_toperator_notes.md gaps 1/4/6.
