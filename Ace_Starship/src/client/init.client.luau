--!strict
-- Client bootstrap. Starts in the lobby; the lobby launches the flight game when
-- the player hits LAUNCH.

local Players = game:GetService("Players")

local Controllers = script.Controllers

local player = Players.LocalPlayer
print(`[AceStarship] client starting for {player.Name}...`)

require(Controllers.LobbyController).start()
