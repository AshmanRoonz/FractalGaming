# HOARD CAMPAIGN — ROUND TYPES, SUPPLIES, AND SHIP PROGRESSION

*Build plan for Last Ship Sailing. Turns HOARD from "survive identical waves" into a campaign of varied round types: defend the base some rounds, run out for supplies on others, and split the team to do both at once. Layers an in-run supply economy on top of the permanent Aegis ladder. Companion to [`hoard_mode_design.md`](./hoard_mode_design.md) (the mode + ship ladders) and [`AEGIS_TITANS.md`](./AEGIS_TITANS.md) (the Titanfall template). This doc adds the campaign loop and maps every piece to real code in `last_ship_sailing.html`.*

---

## 1. The idea in one paragraph

A HOARD **campaign** is an ordered sequence of rounds, and the rounds are not all the same. Some are **Defend** rounds (the leviathans assault your Base, hold it). Some are **Supply** rounds (no assault, fly out into leviathan territory, grab supplies, haul them back). Some are **Split** rounds (an assault hits the Base *while* a critical supply must be retrieved, so the squad divides, tanks hold and frigates fetch). Surviving and completing objectives earns two currencies: **Supplies** (spent during the run, between rounds, at the Base, resets each run) and **Merits** (banked per ship, spent on the permanent Aegis ladder between runs). The two together give a fast in-run power curve and a slow long-term one. That is the "progression of the ships."

---

## 2. The round types

### Defend (Hold the Base)
The Base is under assault. Waves of adds, bruisers, and (on milestone rounds) a leviathan converge on it. **Lose** if the Base reaches 0 HP or all players are downed. This is classic horde and the simplest round to build first. Roles matter: Dreadnoughts (Pyro, Blaster) anchor near the Base; Corvettes/Frigates intercept.

### Supply (The Run)
No assault on the Base. Instead, objective points spawn out in the arena and the outskirts (salvage from leviathan wrecks, drifting cargo, downed pods). Players fly out, collect a supply, and carry it back to the Base drop-off. Pressure comes from the ambient leviathans (already in the game, they converge when you leave the safe radius) and a soft timer. Reward scales with how many supplies are returned. Rewards **Supplies** primarily, some Merits.

### Split (Divide and Conquer)
Both at once: an assault hits the Base while a critical supply must be retrieved from far out. With 3+ players the team naturally divides (defenders + runners); duo/solo gets a scaled version (smaller assault, closer objective). This round is the payoff of the system because it makes the chassis roles and team comms matter. It can only ship after Defend and Supply both work, since it is their composition.

A campaign mixes these, e.g. a short authored run:
`R1 Defend (intro) → R2 Supply → R3 Defend (harder) → R4 Split → R5 Leviathan Boss Defend`.

---

## 3. The Base

A new run-scoped entity: an objective structure with its own HP (and optionally shield). It is the thing you defend in Defend/Split and the drop-off in Supply. Between rounds it is the hub where you spend Supplies. Optional v1+ extra: **turrets** you power with Supplies for passive defense. Visually it can start as a simple station mesh (or a repurposed large hull) and get art later.

---

## 4. Two currencies, two timescales

| | **Supplies** | **Merits** |
|---|---|---|
| Earned by | returning supplies, clearing rounds | kills, waves, run completion (per ship flown) |
| Scope | this run only (resets) | permanent, banked per ship |
| Spent on | base repair, turrets, temporary run-only ship boosts, unlocking next mission | the Aegis ladder (permanent ship upgrades) |
| Timescale | minutes (in-run roguelite curve) | sessions (long-term mastery curve) |
| Feeds | the stat-modifier layer with `context: run` | the stat-modifier layer with `context: hoard` |

Both currencies resolve through the **same stat-modifier layer** from the design doc. A temporary supply boost and a permanent Aegis rank are both just `{target, mul/add}` modifiers; they differ only in lifetime and where they're stored.

---

## 5. How we connect to the game (`last_ship_sailing.html`)

This is the integration map. Nothing here requires rewriting the core; it hooks the existing systems.

**State machine.** Today `game.state` runs `select → warmup → playing → roundEnd → matchEnd` (defined at the `game` object literal). HOARD keeps those state names and adds two fields read where round logic branches:
- `game.mode` = `'deathmatch' | 'hoard'`
- `game.roundType` = `'defend' | 'supply' | 'split'` (HOARD only)

The existing `roundEnd` transition (the 5s banner) becomes the **inter-round respite / supply shop**, and `matchEnd` becomes **run complete**. Both transition points already exist in code (the `state = 'roundEnd'` and `state = 'matchEnd'` sites), so HOARD reuses them rather than adding a new loop.

**Mode registry.** There is no `registerMode` today (confirmed by grep). Introduce `LSS.registerMode({...})`, make the current PvP flow the default `'deathmatch'` mode, and register `'hoard'` beside it. Round-type behavior lives in the mode's per-round `setup(ctx, roundType)` callback. This is the same seam described in the design doc; the campaign is its first real consumer.

**World + spawns.**
- `buildWorld()` already constructs the arena; HOARD's `setup` adds the **Base** entity and the wave spawners on top of it.
- `spawnBots()` (snapshots stats between rounds) is repurposed to spawn **hostile AI bruisers** for the assault rounds.
- `spawnMonsterGuts(pos, size, def)` is the existing leviathan spawner; HOARD wave logic calls it to place leviathans **on demand** for boss/Split rounds instead of only the ambient outskirts placement.

**Base + objectives use existing paths.** The Base is added to `game.entities` with a type flag; it takes damage through the existing projectile/damage pipeline (entities already take damage). Supply pickups are entities/effects collected on proximity (reuse collision); carry-to-base is the only genuinely new bit of logic, and it's small. Win/lose checks live in the mode's `update`/`isOver`.

**Maps per round.** `MAP_PRESETS` already drives the biome and is switched between rounds; HOARD can set the map per round programmatically, so a campaign can change scenery as it escalates.

**Progression plumbing.** Both currencies feed the **stat-modifier layer** (design doc §7). `resolveStats(shipId, context)` applies Aegis modifiers when `context` is hoard and supply-boost modifiers when a run boost is active. Merits persist in the `localStorage` profile (design doc §8); Supplies live only in run state and are never saved.

**Multiplayer.** Owner-authority already runs match logic. The host owns Base HP, wave spawns, objective/supply state, and currency payouts; clients sync. Team split needs **no new netcode**, it's just spatial coordination over the existing sync.

---

## 6. Build sequencing (each step ships and play-tests alone)

Shared dependency first, then the campaign grows one round type at a time.

1. **Stat-modifier layer, identity-only** (design doc §7). Route spawn through `resolveStats`; prove no behavior change. Highest risk, isolate it.
2. **Mode registry + deathmatch-as-mode.** Register the existing game as `'deathmatch'`; no visible change.
3. **Base entity + one Defend round.** The minimum HOARD: a Base with HP, waves via `spawnMonsterGuts`/`spawnBots`, lose conditions, downed/revive. This is the vertical slice.
4. **Supplies economy + inter-round shop.** Add the Supply currency, repurpose `roundEnd` as the shop, base repair + one temporary boost to prove the modifier layer's run context.
5. **Supply round type.** Objective spawns, pickup, carry-to-base, payout.
6. **Split round type.** Compose Defend + Supply; add solo/duo scaling.
7. **Campaign sequencer.** Author a fixed 5-round campaign; later add procedural/endless assembly from a round-type pool.
8. **Aegis ladder UI** (design doc §5). Can land in parallel any time after step 1; it's the meta layer.

Steps 1, 2, and 8 are shared with the base HOARD design; 3 through 7 are this plan's additions.

---

## 7. Open decisions (yours to call)

- **Authored vs procedural campaigns**: ship a hand-built 5-round campaign first, or go straight to a procedural round-type shuffler?
- **Base turrets**: in v1, or defer (just a Base with HP first)?
- **Do Supplies ever touch meta**: pure in-run reset, or convert leftover Supplies to a few Merits at run end?
- **Split-round solo scaling**: how small does the assault get for 1–2 players, or is Split gated to 3+?
- **Temporary boosts**: how strong can a run boost be before it overshadows Aegis? (Keep Aegis the bigger long-term lever.)

---

## 8. Connecting this into the project docs

These three files now form the HOARD design set and should be discoverable together:
- `AEGIS_TITANS.md` — the Titanfall 2 reference template.
- `hoard_mode_design.md` — the mode, ship roster, and Aegis ladders.
- `hoard_campaign_plan.md` (this file) — round types, supplies, base, and code hooks.

The repo's index (`FractalGaming/README.md`, the LSS project entry) is the natural place to list them. I can add a short "HOARD mode (planned)" line there pointing at this set on request. The root `CLAUDE.md` is the Circumpunct Framework memory and doesn't track per-game features, so it isn't the right home for this.
