# HOARD MODE + AEGIS SHIPS

*Design doc for Last Ship Sailing. Co-op horde survival (HOARD) as the grind; per-ship permanent upgrade ladders (AEGIS) as the reward. Built directly on the Titanfall 2 Aegis template captured in [`aegis_titans.md`](./aegis_titans.md), but using LSS's real ships, chassis, monsters, and stats.*

---

## 1. The pitch

You and up to five friends survive escalating waves of the leviathans (**HOARD** mode). Every match banks **Merits** to whichever ship you flew. Spend Merits between runs to climb that ship's **Aegis ladder** — a short, fixed, per-ship upgrade track that makes the ship permanently stronger. Aegis bonuses apply in HOARD (co-op PvE) only; PvP deathmatch always resolves base stats.

The name is the pun: you survive by *hoarding* Merits and upgrades.

---

## 2. Why this fits LSS

Three foundations already exist, which is what makes this an add-on rather than a rewrite:

- **Enemies**: the six leviathans (your son's models, one per cube face, Dreadnought-class 12,500 HP, electric-zap attack) already drift the arena outskirts. HOARD turns them from ambient hazard into the main event.
- **Co-op netcode**: Trystero P2P with owner-authority and drop-in already does multiplayer. HOARD is co-op, so it reuses this; the host runs wave logic, clients sync.
- **The mode seam**: this is the first real customer for the game-mode registry (`LSS.registerMode({...})`). HOARD becomes mode #2 after deathmatch.

The one genuinely new system both features need is a **stat-modifier layer** (Section 7). Everything else is additive.

---

## 3. Ship roster (current, real values)

Seven ships across three chassis. Aegis is **per ship**: progress on one does not carry to another (the Titanfall pattern, you master each kit on its own). The TF2 analogue is listed only to show the template mapping cleanly.

| Ship | Chassis | Role | Base HP / Shield | Main weapon | Core | TF2 analogue |
|------|---------|------|------------------|-------------|------|--------------|
| **PUNCTURE** | Frigate | Sniper | 7,500 / 2,500 | Sodium Railgun (1000) | Mega Barrage | Northstar |
| **SLAYER** | Frigate | Duelist | 7,500 / 2,500 | Shotgun (200 ×8) | Mega Stun Bolt | Ronin |
| **VORTEX** | Corvette | Beam | 10,000 / 3,500 | Energy Blaster (380) | Mega Laser | Ion |
| **TRACKER** | Corvette | Spotter | 10,000 / 3,500 | Tracking Bolt (660, lock) | Mega Tracker Rockets | Tone |
| **SYPHON** | Corvette | Drainer | 10,000 / 3,500 | Zapper (240) | AI Nanobots | Monarch |
| **PYRO** | Dreadnought | Igniter | 12,500 / 5,000 | Thermite Launcher (900) | Mega Flame Chain | Scorch |
| **BLASTER** | Dreadnought | Gunner | 12,500 / 5,000 | Gatling Cannon (85) | AI Assist | Legion |

---

## 4. The Aegis rank pattern (lifted from TF2)

Seven upgrades per ship, unlocked at **ranks 2, 5, 8, 11, 14, 17, 20**. Two are universal (same for every ship); five are ship-specific. Always active in HOARD; they stack with the ship's normal kit.

| Rank | Slot |
|------|------|
| 2 | Ship-specific — primary weapon |
| **5** | **Universal — Chassis Upgrade: +2,500 max health** |
| 8 | Ship-specific — identity |
| 11 | Ship-specific — identity |
| **14** | **Universal — Shield Upgrade: +2,500 max shield** |
| 17 | Ship-specific — second power spike |
| 20 | Ship-specific — signature capstone |

The two universal bumps map straight onto LSS's `CHASSIS` health/shield pools, so they're literally `maxHealth += 2500` / `maxShield += 2500` modifiers.

---

## 5. Aegis ladders (per ship)

All numbers are starting proposals, not final balance. Every entry is a single change to an existing stat or flag — no new weapon code.

### VORTEX — Corvette Beam
| Rank | Upgrade | Effect |
|---|---|---|
| 2 | Beam Capacitor | Energy Blaster damage +15% (380 → 437) |
| 5 | Chassis Upgrade | +2,500 max health |
| 8 | Energy Reserves | Vortex Shield / ADS power-boost drains energy 25% slower |
| 11 | Focused Laser | Laser ability damage +20% (2400 → 2880) |
| 14 | Shield Upgrade | +2,500 max shield |
| 17 | Mine Field | Plasma Mines +2 mines, +15% damage |
| 20 | **Reflective Core** | Mega Laser duration extends on each kill |

### PYRO — Dreadnought Igniter
| Rank | Upgrade | Effect |
|---|---|---|
| 2 | Double Threat | Thermite Launcher fires 2 shots before reload |
| 5 | Chassis Upgrade | +2,500 max health |
| 8 | Hot Streak | Thermite hits build Core meter faster |
| 11 | Roaring Flames | Thermite damage +20% (900 → 1080) |
| 14 | Shield Upgrade | +2,500 max shield |
| 17 | Triple Threat | Thermite Launcher fires 3 shots before reload |
| 20 | **Detonation** | Igniting Explosive Gas triggers an initial blast |

### PUNCTURE — Frigate Sniper
| Rank | Upgrade | Effect |
|---|---|---|
| 2 | Hardened Slugs | Railgun damage +10% (1000 → 1100) |
| 5 | Chassis Upgrade | +2,500 max health |
| 8 | Quick Charge | Railgun fire interval 1.5s → 1.2s |
| 11 | Trap Mastery | Stasis Trap gains a 2nd charge |
| 14 | Shield Upgrade | +2,500 max shield |
| 17 | Critical Slug | Railgun weak-point damage +25% |
| 20 | **Twin Cluster** | Cluster Missile fires two missiles |

### SLAYER — Frigate Duelist
| Rank | Upgrade | Effect |
|---|---|---|
| 2 | Choke Barrel | Shotgun +2 pellets (8 → 10) |
| 5 | Chassis Upgrade | +2,500 max health |
| 8 | Ghost Drive | Teleport gains a 2nd charge |
| 11 | Kinetic Transfer | Damage blocked by Absorption charges the core |
| 14 | Shield Upgrade | +2,500 max shield |
| 17 | Long Blink | Teleport distance +50% |
| 20 | **Duelist's Core** | Mega Stun Bolt grants shield on hit; duration doubled |

### TRACKER — Corvette Spotter
| Rank | Upgrade | Effect |
|---|---|---|
| 2 | Splasher Bolts | Tracking Bolt splash radius +30% (220 → 285) |
| 5 | Chassis Upgrade | +2,500 max health |
| 8 | Sonar Weak Points | Enemies revealed by Sonar take +25% damage |
| 11 | Extended Magazine | Tracking Bolt clip 12 → 24 |
| 14 | Shield Upgrade | +2,500 max shield |
| 17 | Signal Strength | Sonar Pulse duration +100% (8s → 16s) |
| 20 | **Salvo Core Barrage** | Mega Tracker Rockets fires more missiles |

### BLASTER — Dreadnought Gunner
| Rank | Upgrade | Effect |
|---|---|---|
| 2 | Piercing Rounds | Gatling rounds pierce through enemies |
| 5 | Chassis Upgrade | +2,500 max health |
| 8 | Executioner | Close-range Charge Shot bypasses Doomed state |
| 11 | Redirect | Damage absorbed by Body Shield recharges your shield |
| 14 | Shield Upgrade | +2,500 max shield |
| 17 | Drill Shot | Long-range Charge Shot +damage per enemy pierced |
| 20 | **All Systems** | AI Assist core also grants unlimited ability energy |

### SYPHON — Corvette Drainer
| Rank | Upgrade | Effect |
|---|---|---|
| 2 | Tuned Coils | Zapper damage +15% (240 → 276) |
| 5 | Chassis Upgrade | +2,500 max health |
| 8 | Energized Syphon | Energy Syphon also grants shield on drain |
| 11 | Missile Racks | Rocket Salvo 5 → 10 rockets *(the game's own loadout text already names this upgrade)* |
| 14 | Shield Upgrade | +2,500 max shield |
| 17 | Quick Spark | Inner Spark cooldown 12s → 8s |
| 20 | **Nanobot Ascension** | AI Nanobots core starts each run with one tier pre-charged |

---

## 6. HOARD mode design

### Structure

A **run** is a co-op session of escalating waves for 1–6 players. Two variants:

- **Campaign run** (fixed): a set wave count (e.g. 10) with a leviathan boss on the final wave. Completing it = bonus Merit payout. Easier to balance — ship this first.
- **Endless** (score chase): waves never stop; you play for a high-water-mark wave count. Smaller per-wave payout; leaderboard-friendly later.

### Wave content

- **Adds**: small fast drones make up the bulk count so there's always something to shoot.
- **Bruisers**: hostile AI ships (reuse the bot system) from wave ~4 to force target priority.
- **Leviathans**: the six existing monsters are the set-piece spawns. Each has a different cube-face origin and the electric zap, so boss waves already vary. Rotate which leviathan headlines a run.

### Scaling

Each wave raises enemy count and HP on a gentle curve, scaled by **player count** so solo and six-player runs feel similar. Boss HP scales harder with players than adds do (bosses are a wall; trash should melt).

### Co-op survival loop

- **Downed, not dead**: hull break → downed/ghost state (build on the existing death-cam / ghost path) with a revive window; a teammate flying close for a few seconds revives you. All players downed = run over.
- **Respite between waves**: a 10–15s breather, shields fully regen, next wave previewed. No in-match shop in v1 — Aegis is the meta layer. (An in-run roguelite pickup layer is a possible later addition, explicitly out of scope.)

### Merit economy (mirrors the TF2 structure in the reference doc)

Merits bank to the **ship you flew**, not a shared pool:

- **Run completion** — difficulty-scaled (Easy 1, Normal 1, Hard 2, Master 3).
- **Waves cleared** — 1 per wave, capped.
- **Wave milestone** — 1 per wave where the team killed ≥50% of enemies.
- **Unique ships** — bonus if the squad ran no duplicate ships.
- **Retries remaining** — 1 per unused revive/retry.

Tune so a focused run nudges a ship forward without ranking it instantly. Give assist/revive credit so support ships (Tracker, Syphon) aren't starved.

### Difficulty gating (TF2 pattern)

Higher difficulties require a ship at a given Aegis rank, which also makes the universal HP/shield bumps a soft prerequisite for the hard content:

- **Hard** — requires a rank-5 ship.
- **Master** — requires a rank-11 ship.
- **Insane** — requires a rank-14 ship.

---

## 7. The load-bearing system: stat-modifier layer

The only deep change, and the riskiest, because it touches weapons and ships (the fragile core).

**Today:** stats are baked constants — ship stats come from `CHASSIS[...]` + `LOADOUTS[...]`, read directly everywhere.

**Needed:** stats resolved through a function so modifiers stack on top:

```
finalStats = resolveStats(shipId, context)
  // 1. start from base CHASSIS + LOADOUT
  // 2. if context is HOARD/co-op, apply each unlocked Aegis rank's modifier
  // 3. return the resolved object the spawn code reads
```

A modifier is plain data: `{ target: 'weapon.damage', mul: 1.15 }` or `{ target: 'maxHealth', add: 2500 }`. An Aegis rank is a list of these. The ladder UI and any future reward all emit the same modifier objects, so they share one resolution path. Flag-style upgrades (Piercing Rounds, Twin Cluster) are booleans the weapon code checks, defaulting false outside HOARD.

**De-risk plan:** build this layer first with **every modifier set to identity / disabled**, and confirm the game plays byte-for-byte the same as today. That proves the foundation without changing behavior. Only then wire real modifiers in.

---

## 8. Save / profile data model

Per-ship persistence in `localStorage`. In co-op each peer loads its own profile and announces its Aegis state at match join, so the host's authoritative sim builds each player's resolved stats correctly.

```
profile = {
  version: 1,
  ships: {
    VORTEX:   { merits: 0, aegisRank: 0 },
    PYRO:     { merits: 0, aegisRank: 0 },
    PUNCTURE: { merits: 0, aegisRank: 0 },
    SLAYER:   { merits: 0, aegisRank: 0 },
    TRACKER:  { merits: 0, aegisRank: 0 },
    BLASTER:  { merits: 0, aegisRank: 0 },
    SYPHON:   { merits: 0, aegisRank: 0 },
  }
}
```

`aegisRank` is the highest rank reached (linear ladder, so one number says which upgrades are active). Keep `version` for safe migrations.

---

## 9. Multiplayer notes

- **Host runs the waves.** Owner-authority already does this for matches; HOARD wave spawns, enemy HP, and boss logic live on the host.
- **Loadout broadcast.** Each client sends `{shipId, aegisRank}` at join; host resolves their stats and is the source of truth for damage/health.
- **Version parity.** Modes ship inside the core (not as downloaded files), so every peer on the same build has identical wave + ladder logic. Refuse mismatched builds into a HOARD lobby.
- **Cheating.** Client-reported Merits/ranks are spoofable. Fine for friends-and-family co-op; if it ever matters, the host can validate before paying out.

---

## 10. Build sequencing (each step ships and play-tests alone)

1. **Stat-modifier layer, identity-only.** Route ship spawn through `resolveStats`; prove no behavior change. *(Highest risk — isolate it.)*
2. **Profile + Merits.** localStorage profile; award Merits at end of a normal match as a test harness; no spending yet.
3. **HOARD skeleton.** Register the mode; fixed waves of adds + a leviathan boss; downed/revive loop; run-complete payout. Co-op last.
4. **Aegis ladder UI + spending.** Per-ship ladder screen; spend Merits; set `aegisRank`; modifiers now resolve live in HOARD.
5. **Polish + tuning.** Scaling curves, Merit economy, difficulty gating, endless variant, boss rotation, balance pass.

Scope: the modifier layer + HOARD skeleton is the bulk; the ladders are cheap once the layer exists (they're data). This is a feature epic — the biggest addition to date — but it runs along the grain of what's already there.

---

## 11. Open decisions (yours to call)

- **Ladder shape**: keep the TF2-faithful 7 ranks at 2/5/8/11/14/17/20, or compress to a shorter ladder for a faster first cut?
- **First variant**: campaign or endless? (Campaign balances easier.)
- **In-run upgrades**: stay meta-only (Aegis) in v1, or add a light roguelite pickup during a run later?
- **PvP**: this doc keeps PvP pure (Aegis off). A separate "ranked-up" playlist would be a deliberate later choice.
- **Respec**: can players refund Merits and respec a ship, or is the ladder permanent once bought?

---

**Companion reference:** [`aegis_titans.md`](./aegis_titans.md) — the vanilla Titanfall 2 Aegis system this design is modeled on.
