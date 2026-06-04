--!strict
-- Client bootstrap. Starts in the lobby; the lobby launches the flight game when
-- the player hits LAUNCH.

local Players = game:GetService("Players")

local Controllers = script.Controllers

local player = Players.LocalPlayer
print(`[AceStarship] client starting for {player.Name}...`)

-- Mobile: force landscape (both ways), never portrait. LandscapeSensor lets the
-- player hold the device either landscape direction but won't flip to portrait,
-- so tilting forward/back to steer can't accidentally rotate the screen.
pcall(function()
	local pg = player:WaitForChild("PlayerGui")
	pg.ScreenOrientation = Enum.ScreenOrientation.LandscapeSensor
end)

require(Controllers.BoltsHudController).start() -- always-on Bolts counter
require(Controllers.LobbyController).start()
