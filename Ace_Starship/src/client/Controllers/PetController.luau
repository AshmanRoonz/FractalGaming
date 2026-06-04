--!strict
-- Pet buddy: trails the ship, faces the action, and auto-fires lasers at the
-- nearest visible enemy. The equipped pet (chosen at the hangar pet podium) sets
-- its look + stats. An optional asset model from Assets/Pets is used as the body,
-- otherwise a glowing orb. LOCAL prototype (client-side).

local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ShipState = require(script.Parent.ShipState)
local EnemyController = require(script.Parent.EnemyController)
local BattleSession = require(script.Parent.BattleSession)
local PetVisuals = require(ReplicatedStorage.Shared.PetVisuals)

local PetController = {}

local SIDE, UP, BACK = 13, 7, 5 -- follow offset from the ship (right, up, back)

local findById = PetVisuals.findById

local terrainParams = RaycastParams.new()
terrainParams.FilterType = Enum.RaycastFilterType.Include
terrainParams.FilterDescendantsInstances = { workspace.Terrain }

local function losClear(from: Vector3, to: Vector3): boolean
	return workspace:Raycast(from, to - from, terrainParams) == nil
end

local function nearestEnemy(from: Vector3, range: number)
	local best, bestD = nil, range
	for _, e in EnemyController.enemies do
		if e.root then
			local d = (e.root.Position - from).Magnitude
			if d < bestD and losClear(from, e.root.Position) then
				best, bestD = e, d
			end
		end
	end
	return best
end

function PetController.start(petId: string?)
	local gen = BattleSession.gen
	local cfg = findById(petId or "orb")
	local pet = PetVisuals.buildBody(cfg)
	pet.Parent = workspace
	BattleSession.track(pet)
	local facing = CFrame.Angles(0, math.rad(cfg.yawOffset or 0), 0) -- correct model orientation

	local pos = ShipState.position
	local nextShot = 0
	local bob = 0
	local sideTarget = 1 -- +1 = ship's right (default), -1 = left
	local side = 1 -- smoothed, so it glides across instead of snapping

	RunService.Heartbeat:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		bob += dt
		local shipPos = ShipState.position
		local fwd = ShipState.forward
		local right = fwd:Cross(Vector3.yAxis)
		right = if right.Magnitude > 0.01 then right.Unit else Vector3.xAxis

		-- Flip to the opposite side when you strafe toward the pet (so it doesn't slide
		-- between the ship and camera). Hysteresis stops it flickering near neutral.
		local strafe = ShipState.strafe or 0
		if strafe * sideTarget > 0.3 then -- strafing toward the side the pet is on
			sideTarget = -sideTarget
		end
		side = side + (sideTarget - side) * math.clamp(dt * 4, 0, 1)

		-- Trail the ship with a gentle bob.
		local goal = shipPos + right * (SIDE * side) + Vector3.new(0, UP + math.sin(bob * 2) * 1.5, 0) - fwd * BACK
		pos = pos:Lerp(goal, math.clamp(dt * 5, 0, 1))

		-- Face the nearest visible enemy (else look where the ship flies).
		local target = nearestEnemy(pos, cfg.range)
		local lookDir = if target then (target.root.Position - pos).Unit else fwd
		pet:PivotTo(CFrame.lookAt(pos, pos + lookDir) * facing)

		-- Fire.
		if target and os.clock() >= nextShot then
			nextShot = os.clock() + cfg.cooldown
			local hit = target.root.Position
			local beam = Instance.new("Part")
			beam.Anchored = true
			beam.CanCollide = false
			beam.CastShadow = false
			beam.Material = Enum.Material.Neon
			beam.Color = cfg.laserColor
			beam.Size = Vector3.new(0.35, 0.35, (hit - pos).Magnitude)
			beam.CFrame = CFrame.lookAt((pos + hit) / 2, hit)
			beam.Parent = workspace
			Debris:AddItem(beam, 0.1)
			EnemyController.damage(target, cfg.damage)
		end
	end)
end

return PetController
