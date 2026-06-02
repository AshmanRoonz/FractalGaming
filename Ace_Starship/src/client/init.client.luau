--!strict
-- Client bootstrap. Flight is started first and is independent of the
-- networking layer, so you can always fly. The networking-dependent
-- controllers are started in a protected call so a packet-layer issue can't
-- stop the rest of the game from booting.

local Players = game:GetService("Players")

local Controllers = script.Controllers

local player = Players.LocalPlayer
print(`[AceStarship] client starting for {player.Name}...`)

-- Renders + flies the local ship. No networking dependency.
require(Controllers.ShipController).start()

-- Builds the procedural sandwich world (mountains above + below). No networking.
require(Controllers.TerrainController).start()

-- Placeholder enemies + weapons (hitscan main, projectile secondary). No networking.
require(Controllers.EnemyController).start()
require(Controllers.WeaponController).start()
require(Controllers.PetController).start()

local function tryStart(name: string)
	local ok, err = pcall(function()
		require(Controllers[name]).start()
	end)
	if not ok then
		warn(`[AceStarship] {name} did not start (safe to ignore for now): {err}`)
	end
end

tryStart("InputController") -- steer + fire input (sends intent to server)
tryStart("HudController") -- distance, bolts, boss banner
tryStart("ShopController") -- shop + garage UI

print("[AceStarship] client ready.")
