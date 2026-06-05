--!strict
-- Client bootstrap. Starts in the lobby; the lobby launches the flight game when
-- the player hits LAUNCH.

local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Controllers = script.Controllers
local Quality = require(ReplicatedStorage.Shared.Quality)

local player = Players.LocalPlayer
print(`[AceStarship] client starting for {player.Name}...`)

-- Lighting cost: "Future" is by far the heaviest mode and we render with GlobalShadows
-- off, so it buys almost nothing here. Pick the technology per device: Voxel (cheapest)
-- on Low/Med for tablets/phones, ShadowMap on High. This is the biggest single win for
-- weak GPUs and applies the instant the game loads (before any enemies spawn).
pcall(function()
	Lighting.Technology = if Quality.level == "high" then Enum.Technology.ShadowMap else Enum.Technology.Voxel
end)

-- Mobile: force landscape (both ways), never portrait. LandscapeSensor lets the
-- player hold the device either landscape direction but won't flip to portrait,
-- so tilting forward/back to steer can't accidentally rotate the screen.
pcall(function()
	local pg = player:WaitForChild("PlayerGui")
	pg.ScreenOrientation = Enum.ScreenOrientation.LandscapeSensor -- both landscape ways, never portrait (tilt steering reads the accelerometer, so flipping 180 is fine)
end)

require(Controllers.SettingsController).start() -- performance settings menu
require(Controllers.SkyController).start() -- per-client skybox (off on Low)
require(Controllers.BoltsHudController).start() -- always-on Bolts counter
require(Controllers.LobbyController).start()
