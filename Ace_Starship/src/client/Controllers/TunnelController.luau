--!strict
-- Carve-your-own tunnel. Rings are laid along the ship's ACTUAL flight path (a
-- breadcrumb trail), so the tube is always centered on the ship: it wraps behind
-- and around you and you can never clip out through a wall. Ahead is open until
-- you fly there -- the path literally only exists where you've gone.
--
-- Single endless pipe, no branches. LOCAL prototype.
-- The look comes from TunnelThemes: set THEME below.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local TunnelBuilder = require(ReplicatedStorage.Shared.TunnelBuilder)
local TunnelThemes = require(ReplicatedStorage.Shared.Config.TunnelThemes)
local ShipState = require(script.Parent.ShipState)

local TunnelController = {}

local THEME = "HullDeck"
local STEP = 70 -- ring spacing along the trail
local MAX_RINGS = 70 -- trail length before the oldest recycles (~4900 studs)
local MAX_RINGS_PER_FRAME = 6 -- fill cap so a fast frame never hitches

function TunnelController.start()
	-- Clear the default ground so it reads as open space, not floating pipe.
	for _, name in { "Baseplate", "SpawnLocation" } do
		local inst = workspace:FindFirstChild(name)
		if inst then
			inst:Destroy()
		end
	end

	local theme = TunnelThemes[THEME] or TunnelThemes.HullDeck
	local cfg = {
		radius = 70,
		sides = 16,
		textureId = theme.textureId,
		tileStuds = theme.tileStuds,
		color = theme.color,
	}

	local container = Instance.new("Model")
	container.Name = "Tunnel"
	container.Parent = workspace

	local rings: { Model } = {}
	local function layRing(center: Vector3, lookAt: Vector3)
		local ring = TunnelBuilder.buildRing(CFrame.lookAt(center, lookAt), STEP * 1.1, cfg)
		ring.Parent = container
		table.insert(rings, ring)
		if #rings > MAX_RINGS then
			rings[1]:Destroy()
			table.remove(rings, 1)
		end
	end

	-- Prime a short stub behind the spawn so the ship starts inside some tube.
	local spawn = ShipState.position
	for i = 8, 1, -1 do
		local c = spawn + Vector3.new(0, 0, i * STEP)
		layRing(c, c + Vector3.new(0, 0, -1))
	end

	local lastCenter = spawn

	RunService.RenderStepped:Connect(function()
		local shipPos = ShipState.position
		local added = 0
		while (shipPos - lastCenter).Magnitude >= STEP and added < MAX_RINGS_PER_FRAME do
			local dir = (shipPos - lastCenter).Unit
			local newCenter = lastCenter + dir * STEP
			layRing((lastCenter + newCenter) / 2, newCenter)
			lastCenter = newCenter
			added += 1
		end
	end)
end

return TunnelController
