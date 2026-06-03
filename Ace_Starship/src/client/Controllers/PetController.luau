--!strict
-- Pet orb. A little floating buddy that trails the ship, looks at the action,
-- and auto-fires lasers at nearby enemies. Built as a config so it becomes a
-- catalog of buyable pets later (size/color/damage/range/fire-rate per pet, and
-- a Meshy model swapped in for the placeholder orb).
--
-- LOCAL prototype (client-side).

local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")

local ShipState = require(script.Parent.ShipState)
local EnemyController = require(script.Parent.EnemyController)
local BattleSession = require(script.Parent.BattleSession)

local PetController = {}

-- One pet's stats. Future: a Pets catalog keyed by id, chosen/owned via the shop.
local PET = {
	orbSize = 3.6,
	bodyColor = Color3.fromRGB(90, 230, 170),
	laserColor = Color3.fromRGB(120, 255, 170),
	range = 360,
	damage = 14, -- per shot
	cooldown = 0.5, -- seconds between shots
	-- Follow offset from the ship (right, up, back).
	side = 13,
	up = 7,
	back = 5,
}

local terrainParams = RaycastParams.new()
terrainParams.FilterType = Enum.RaycastFilterType.Include
terrainParams.FilterDescendantsInstances = { workspace.Terrain }

local function losClear(from: Vector3, to: Vector3): boolean
	return workspace:Raycast(from, to - from, terrainParams) == nil
end

local function nearestEnemy(from: Vector3)
	local best, bestD = nil, PET.range
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

function PetController.start()
	local gen = BattleSession.gen
	-- Placeholder orb: glowing body + a little pupil so it has some character.
	local orb = Instance.new("Model")
	orb.Name = "Pet"
	local body = Instance.new("Part")
	body.Shape = Enum.PartType.Ball
	body.Size = Vector3.new(PET.orbSize, PET.orbSize, PET.orbSize)
	body.Color = PET.bodyColor
	body.Material = Enum.Material.Neon
	body.Anchored = true
	body.CanCollide = false
	body.CastShadow = false
	body.Parent = orb
	local pupil = Instance.new("Part")
	pupil.Shape = Enum.PartType.Ball
	pupil.Size = Vector3.new(PET.orbSize * 0.42, PET.orbSize * 0.42, PET.orbSize * 0.42)
	pupil.Color = Color3.fromRGB(20, 30, 40)
	pupil.Material = Enum.Material.SmoothPlastic
	pupil.Anchored = true
	pupil.CanCollide = false
	pupil.CastShadow = false
	pupil.Parent = orb
	orb.PrimaryPart = body
	orb.Parent = workspace
	BattleSession.track(orb)

	local pos = ShipState.position
	local nextShot = 0
	local bob = 0

	RunService.Heartbeat:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return -- battle torn down; this old loop is inert
		end
		bob += dt
		local shipPos = ShipState.position
		local fwd = ShipState.forward
		local right = fwd:Cross(Vector3.yAxis)
		right = if right.Magnitude > 0.01 then right.Unit else Vector3.xAxis

		-- Trail the ship with a gentle bob.
		local goal = shipPos + right * PET.side + Vector3.new(0, PET.up + math.sin(bob * 2) * 1.5, 0) - fwd * PET.back
		pos = pos:Lerp(goal, math.clamp(dt * 5, 0, 1))

		-- Aim at the nearest visible enemy (else look where the ship flies).
		local target = nearestEnemy(pos)
		local lookDir = if target then (target.root.Position - pos).Unit else fwd
		body.CFrame = CFrame.new(pos)
		pupil.CFrame = CFrame.new(pos + lookDir * PET.orbSize * 0.5)

		-- Fire.
		if target and os.clock() >= nextShot then
			nextShot = os.clock() + PET.cooldown
			local hit = target.root.Position
			local beam = Instance.new("Part")
			beam.Anchored = true
			beam.CanCollide = false
			beam.CastShadow = false
			beam.Material = Enum.Material.Neon
			beam.Color = PET.laserColor
			beam.Size = Vector3.new(0.35, 0.35, (hit - pos).Magnitude)
			beam.CFrame = CFrame.lookAt((pos + hit) / 2, hit)
			beam.Parent = workspace
			Debris:AddItem(beam, 0.1)
			EnemyController.damage(target, PET.damage)
		end
	end)
end

return PetController
