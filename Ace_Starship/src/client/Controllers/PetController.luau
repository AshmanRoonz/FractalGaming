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
local Pets = require(ReplicatedStorage.Shared.Catalog.Pets)

local PetController = {}

local SIDE, UP, BACK = 13, 7, 5 -- follow offset from the ship (right, up, back)

local petAssets = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Pets")

local function findById(id: string?): any
	for _, d in Pets do
		if d.id == id then
			return d
		end
	end
	return Pets[1]
end

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

-- Pet body model (PrimaryPart set): an asset from Assets/Pets if named, else an orb.
local function buildBody(cfg: any): Model
	if cfg.object and petAssets then
		local src = petAssets:FindFirstChild(cfg.object)
		if src then
			local model: Model? = nil
			if src:IsA("Model") then
				model = src:Clone()
			elseif src:IsA("BasePart") then
				model = Instance.new("Model")
				local c = src:Clone()
				c.Parent = model
				model.PrimaryPart = c
			end
			if model then
				for _, d in model:GetDescendants() do
					if d:IsA("BasePart") then
						d.Anchored = true
						d.CanCollide = false
						d.CastShadow = false
					end
				end
				if not model.PrimaryPart then
					model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart", true)
				end
				local _, size = model:GetBoundingBox()
				local longest = math.max(size.X, size.Y, size.Z)
				if longest > 0 then
					pcall(function()
						model:ScaleTo((cfg.orbSize * 2) / longest)
					end)
				end
				return model
			end
		end
	end
	-- Glowing orb placeholder, with a little forward-facing pupil.
	local orb = Instance.new("Model")
	local body = Instance.new("Part")
	body.Shape = Enum.PartType.Ball
	body.Size = Vector3.new(cfg.orbSize, cfg.orbSize, cfg.orbSize)
	body.Color = cfg.bodyColor
	body.Material = Enum.Material.Neon
	body.Anchored = true
	body.CanCollide = false
	body.CastShadow = false
	body.Parent = orb
	local pupil = Instance.new("Part")
	pupil.Shape = Enum.PartType.Ball
	pupil.Size = Vector3.new(cfg.orbSize * 0.42, cfg.orbSize * 0.42, cfg.orbSize * 0.42)
	pupil.Color = Color3.fromRGB(20, 30, 40)
	pupil.Material = Enum.Material.SmoothPlastic
	pupil.Anchored = true
	pupil.CanCollide = false
	pupil.CastShadow = false
	pupil.CFrame = CFrame.new(0, 0, -cfg.orbSize * 0.5) -- sits at the model's forward (-Z)
	pupil.Parent = orb
	orb.PrimaryPart = body
	return orb
end

function PetController.start(petId: string?)
	local gen = BattleSession.gen
	local cfg = findById(petId or "orb")
	local pet = buildBody(cfg)
	pet.Parent = workspace
	BattleSession.track(pet)
	local facing = CFrame.Angles(0, math.rad(cfg.yawOffset or 0), 0) -- correct model orientation

	local pos = ShipState.position
	local nextShot = 0
	local bob = 0

	RunService.Heartbeat:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		bob += dt
		local shipPos = ShipState.position
		local fwd = ShipState.forward
		local right = fwd:Cross(Vector3.yAxis)
		right = if right.Magnitude > 0.01 then right.Unit else Vector3.xAxis

		-- Trail the ship with a gentle bob.
		local goal = shipPos + right * SIDE + Vector3.new(0, UP + math.sin(bob * 2) * 1.5, 0) - fwd * BACK
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
