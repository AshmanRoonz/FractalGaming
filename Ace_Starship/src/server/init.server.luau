--!strict
-- Server bootstrap. Requires each system in dependency order and starts it.
-- Keep this thin: it just wires systems together.

local ServerScriptService = game:GetService("ServerScriptService")
local Players = game:GetService("Players")

-- The player flies a ship, not a walking avatar. Stop the default character
-- from spawning. (Later, MatchManager will spawn/own the ship per player.)
Players.CharacterAutoLoads = false

local Systems = ServerScriptService.Server.Systems

local CurrencyService = require(Systems.CurrencyService)
local LeaderboardService = require(Systems.LeaderboardService)
local ShopService = require(Systems.ShopService)
local CombatService = require(Systems.CombatService)
local MatchManager = require(Systems.MatchManager)

print("[AceStarship] server starting...")

CurrencyService.start() -- loads/saves banked profiles (DataStore)
LeaderboardService.start() -- solo + co-op boards
ShopService.start() -- server-authoritative buy/equip
CombatService.start() -- server-authoritative hit validation
MatchManager.start() -- owns runs: tunnel, spawns, bosses, distance

print("[AceStarship] server ready.")
