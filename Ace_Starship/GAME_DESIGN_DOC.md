# Ace Starship — Game Design Doc

*Working title. Roblox tunnel shooter, grind-and-flex. v0.1 draft, June 2026.*

## One-line pitch

Fly your ship deeper and deeper through endless procedurally generated tunnels, blast the monsters that swarm you, and upgrade your guns to shoot increasingly ridiculous stuff (ducks, toilet paper, rubber chickens). Grind currency, buy sillier ammo, flex your ship.

## Why this fits Roblox

The audience rewards a simple, readable loop and an endless catalog of collectible cosmetics. This design makes the content pipeline and the monetization pipeline the same thing: every object made in Meshy becomes a sellable projectile or ship. The sillier and more shareable the ammo, the more kids screenshot and flex it. That is the same flywheel the platform's biggest breakout hits ride.

## Core loop

1. Launch into a tunnel run (3rd-person, ship auto-follows the tunnel).
2. Monsters spawn ahead and around; player aims and fires.
3. Kills drop currency and the distance counter climbs.
4. Run ends on death (or player banks out at a checkpoint).
5. Spend currency: upgrade weapon stats, unlock new projectile skins, buy ship cosmetics.
6. Go deeper, fight harder enemies, repeat.

The whole game is "go further, get stronger, look sillier." That is the grind-and-flex hook.

## Controls (mobile-first)

Most of the audience plays on a phone, so controls must work with thumbs.

- Ship auto-travels forward along the tunnel; player steers within the tunnel cross-section (drag or joystick).
- Fire is hold-to-shoot or auto-fire (toggle in settings).
- One optional ability button (dash / shield / bomb) unlocked later.

Keep it to "steer and shoot." No complex input.

## Two-currency economy

- **Bolts** (soft / grind currency): earned from kills and distance. Buys weapon upgrades and the cheaper, common projectile skins. This is the grind.
- **Robux** (premium): buys rare and legendary projectile skins, premium ships, and convenience (skip grind, extra inventory slots). This funds the game.

Keep them cleanly separated so the game never feels pay-to-win.

## Cosmetic vs. power — the golden rule

Projectiles are **cosmetic by default**. The duck and the laser do the same damage at the same upgrade tier. All power lives in the upgrade tree (fire rate, damage, multishot, pierce). This keeps it fair, avoids pay-to-win complaints, and means you can sell hundreds of skins without breaking balance.

Later you can add **legendary projectiles** with fun, mostly-visual effects (a toilet-paper shot that unrolls a trail, a duck that quacks on hit, a chicken that splits into three). Keep gameplay impact small; keep the spectacle big.

## Rarity tiers and flexing

Projectiles and ships roll up rarity tiers (Common → Rare → Epic → Legendary → Mythic). Flexing needs an audience, so:

- A **garage / hangar** screen where the player displays their ship and equipped projectile.
- A **shared hub** (lobby) where players see each other's ships and equipped ammo before launching.
- Equipped skin is visible to other players mid-run if runs are co-op or leaderboarded.

## Content pipeline (the engine room)

This is the part that makes the game scale.

- **Ships:** modeled in Meshy, imported to Roblox (already proven working).
- **Projectiles:** every silly object you can imagine, modeled in Meshy, dropped into a standard projectile template (mesh + impact effect + sound). Each new mesh = one new sellable item with almost no extra code.
- **Monsters:** modeled in Meshy, dropped into a standard enemy template (mesh + health + movement + spawn weight).

Because ships, ammo, and monsters all use fixed templates, adding content is "make mesh in Meshy → drop into template → set price/rarity." Hundreds of items become a content calendar, not an engineering project.

## Procedural tunnels

- Tunnels are built from modular segments stitched end to end as the player advances (segments recycled behind the player).
- Difficulty scales with distance: spawn rate, enemy health, and enemy variety increase as you go deeper.
- Periodic "biome" changes (color, hazard type, music) keep long runs visually fresh and give the next-checkpoint a reward feel.
- Optional hazards baked into segments (closing gates, laser grids, asteroid clusters) for variety beyond just enemies.

## MVP scope (first playable)

Ship the smallest version that proves the loop is fun:

- One ship.
- One tunnel biome, procedurally stitched, difficulty scaling with distance.
- 3–4 monster types.
- Hold-to-fire weapon with a 3-step upgrade tree (damage, fire rate, multishot).
- 5–6 projectile skins (1 default + a few silly ones) to prove the cosmetic system and the shop.
- Bolts currency + a basic shop UI, with **banked progress** (upgrades and skins persist between runs via DataStores).
- One boss at the first distance milestone, to prove the boss beat.
- Death → score screen → spend → relaunch.

Solo only in MVP. No co-op, no Robux store, no rarity tiers, no hub yet. Just prove that "go deeper, fight a boss, shoot, upgrade, swap to a funny gun, come back richer" feels good. Everything else layers on after.

## Build order after MVP

1. Co-op (2–4 player shared runs) + separate solo and co-op leaderboards.
2. Robux store + rarity tiers (turn on monetization once the loop is proven).
3. Garage + shared hub (turn on flexing).
4. More bosses + boss variety (each biome gets its own).
5. Content scale-up: pump dozens of Meshy projectiles/ships/monsters through the templates.
6. Biomes, hazards, and an ability button.
7. Daily goals / limited-time skins / optional bank-out risk-reward layer (retention and recurring spend).

## Tech notes

- Roblox + Luau, with Rojo for filesystem-based code and version control. Wally for packages.
- Meshy → Roblox for all art (ships, ammo, monsters).
- Server-authoritative gameplay (Roblox handles replication): validate kills/currency on the server to prevent cheating.
- Standardized templates for ships, projectiles, and enemies are the most important architectural decision — they are what let art scale without code.

## Locked decisions

These three were open; now settled.

**Modes: co-op and solo, leaderboards for both.** Players can launch solo or party up (2–4) for a shared tunnel run. Both modes feed leaderboards, kept as separate boards (solo distance, co-op distance) so a co-op team doesn't dominate the solo board. Co-op adds netcode complexity but is the strongest driver of the social/flex layer, so it's worth it. Practical path: build solo first in the MVP, layer co-op in right after the loop is proven.

**Run structure: endless with periodic bosses.** The tunnel never ends; difficulty scales with distance. Every N segments (or every biome transition) a boss blocks the tunnel and must be beaten to continue. Bosses are the pacing beat: a spike of challenge, a big currency/loot payout, and a natural "do I push on or bank out?" decision point. Bosses are also prime Meshy content (one big mesh + a simple attack pattern).

**Progress: banked.** Currency, weapon upgrades, and unlocked skins persist across runs (Roblox DataStores). A run ending is a soft reset of *position and current-run multipliers*, not of what you own. This is the backbone of the grind: every run makes you permanently a little richer/stronger, which is exactly the retention hook for the audience. Optionally add a per-run risk/reward layer later (bank-out at a checkpoint to keep a run bonus, or push deeper and risk losing that bonus on death) — but owned upgrades and skins are never lost.
