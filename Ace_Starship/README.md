# Ace Starship

A Roblox tunnel shooter: fly endlessly through procedurally generated tunnels,
blast monsters, grind currency, and upgrade your guns to fire increasingly silly
projectiles (ducks, toilet paper, rubber chickens). Grind-and-flex, co-op or solo.

See [`GAME_DESIGN_DOC.md`](./GAME_DESIGN_DOC.md) for the full design.

## Getting started

This project uses [Rojo](https://rojo.space) to sync filesystem code into Roblox
Studio, [Rokit](https://github.com/rojo-rbx/rokit) to pin tools, and
[Wally](https://wally.run) for packages.

```bash
# 1. Install Rokit (one time), then install the pinned toolchain:
rokit install

# 2. Install Luau packages into ./Packages:
wally install

# 3. Start the Rojo server:
rojo serve

# 4. In Roblox Studio: install the Rojo plugin, open a new place,
#    and click "Connect" in the Rojo panel.
```

Edit `.luau` files in your own editor; Studio updates live. Build a place file
headlessly with `rojo build -o AceStarship.rbxlx`.

## Project layout

```
default.project.json     Rojo: maps folders below into the Roblox DataModel
rokit.toml               Pinned tools (rojo, wally, stylua, selene, luau-lsp)
wally.toml               Luau package dependencies
src/
  shared/                -> ReplicatedStorage.Shared (runs on client AND server)
    Config/
      GameConfig.luau      Tunnel pacing, difficulty, boss cadence, ship handling
      Economy.luau         Currencies, upgrade costs, rarity tiers
    Catalog/
      Ships.luau           One row per sellable ship (maps to a Meshy mesh)
      Projectiles.luau     One row per sellable projectile skin (the money catalog)
      Enemies.luau         Enemies + bosses (maps to Meshy meshes)
    Templates/
      ShipTemplate.luau        mesh + handling -> live player ship
      ProjectileTemplate.luau  mesh + damage   -> live projectile
      EnemyTemplate.luau       mesh + stats    -> live enemy/boss
    Net.luau               All client<->server messages (typed, via ByteNet)
  server/                -> ServerScriptService.Server
    init.server.luau       Bootstrap: starts every system
    Systems/
      CurrencyService.luau   Banked progress (ProfileStore): bolts, owned, upgrades
      ShopService.luau       Server-authoritative buy/equip
      CombatService.luau     Server-authoritative fire-rate + hit resolution
      EnemySpawner.luau      Weighted, distance-gated enemy spawning
      BossManager.luau       Boss gates every N studs + attack patterns
      TunnelGenerator.luau   Procedural segment stitching + recycling
      MatchManager.luau      Owns runs (solo/co-op): distance, ties systems together
      LeaderboardService.luau Separate solo + co-op distance boards
  client/                -> StarterPlayer.StarterPlayerScripts.Client
    init.client.luau       Bootstrap: starts every controller
    Controllers/
      InputController.luau   Mobile-first steer + fire (sends intent only)
      ShipController.luau    Renders local ship + chase camera
      HudController.luau     Distance, bolts, boss banner
      ShopController.luau    Shop/garage UI + buy/equip requests
```

## The content pipeline (why this scales)

Ships, projectiles, and enemies all use **standardized templates**. Adding new
content is:

1. Model it in Meshy.
2. Import the mesh into `ReplicatedStorage.Assets.<Ships|Projectiles|Enemies|Bosses>`.
3. Add one row to the matching `Catalog/*.luau` file.

No new code. That is what lets hundreds of silly guns become a content calendar
instead of an engineering project.

## Design guardrails baked into the code

- **Cosmetic vs power:** projectile skins are balance-neutral; all power lives in
  the upgrade tree (`Economy.luau` + `CombatService.luau`). Never give a skin
  more damage.
- **Server-authoritative:** clients send intent (`Net.luau`); the server decides
  fire rate, damage, kills, currency, and purchases. Prevents cheating.
- **Banked progress:** a run ending never touches owned items or upgrades. Only
  `CurrencyService` mutates the persistent profile.

## Status

Scaffold with working module structure and stubbed logic. The `TODO`s mark where
to flesh out: visual effects, UI layout, ship spawning/positioning in matches,
co-op matchmaking, and the Robux store via MarketplaceService.
