--!strict
-- Installs the skybox per-client from Shared/SkyConfig. It is turned OFF on Low quality
-- (six large face textures cost real GPU memory + fill on weak devices), and reverts to
-- the cheap built-in sky there. On Med/High it REPLACES any existing/blank Sky so a
-- leftover one can't block ours, and re-adds it if something removes it.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local SkyConfig = require(ReplicatedStorage.Shared.SkyConfig)
local Quality = require(ReplicatedStorage.Shared.Quality)

local SkyController = {}

local watching = false -- whether our ChildRemoved re-add guard is active
local ourSky: Sky? = nil

local function clearSkies()
	for _, c in Lighting:GetChildren() do
		if c:IsA("Sky") then
			c:Destroy()
		end
	end
	ourSky = nil
end

local function buildSky(): Sky
	local sky = Instance.new("Sky")
	sky.Name = "AceSky"
	sky.SkyboxUp = SkyConfig.Up
	sky.SkyboxDn = SkyConfig.Dn
	sky.SkyboxLf = SkyConfig.Lf
	sky.SkyboxRt = SkyConfig.Rt
	sky.SkyboxFt = SkyConfig.Ft
	sky.SkyboxBk = SkyConfig.Bk
	sky.Parent = Lighting
	return sky
end

local function apply(level: string)
	if not SkyConfig.enabled or SkyConfig.Up == "" or level == "low" then
		-- Low / disabled: no custom skybox, fall back to the cheap default sky.
		clearSkies()
		return
	end
	clearSkies() -- drop any blank/leftover sky that would otherwise show instead
	ourSky = buildSky()
	if not watching then
		watching = true
		-- If anything later removes our sky, put it back (only while we want one).
		Lighting.ChildRemoved:Connect(function(child)
			if child == ourSky and Quality.level ~= "low" then
				task.defer(function()
					if not Lighting:FindFirstChildOfClass("Sky") then
						ourSky = buildSky()
					end
				end)
			end
		end)
	end
end

function SkyController.start()
	apply(Quality.level)
	Quality.onChange(apply) -- swap the sky in/out if quality changes live
end

return SkyController
