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

local SIDE, UP, BACK = 17, 7, 5 -- follow offset from the ship (right, up, back)

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

-- start(ids, elements): ids = list of equipped pet bodies, elements = the element
-- assigned to each slot (fully decoupled, set at the element podium). Each pet fires
-- with its assigned element, so two slots of different elements drive the reactions.
function PetController.start(ids: any, elements: any)
	local idList: { string } = if type(ids) == "table" then ids else { ids }
	if #idList == 0 then
		idList = { "orb" }
	end
	local els: { string } = if type(elements) == "table" then elements else {}
	local gen = BattleSession.gen

	type Buddy = {
		pet: Model,
		cfg: any,
		element: string?,
		facing: CFrame,
		pos: Vector3,
		side: number,
		sideTarget: number,
		baseSide: number,
		back: number,
		nextShot: number,
		bob: number,
	}
	local buddies: { Buddy } = {}
	for i, id in idList do
		if type(id) == "string" then
			local cfg = findById(id)
			local pet = PetVisuals.buildBody(cfg)
			pet.Parent = workspace
			BattleSession.track(pet)
			local baseSide = if i % 2 == 1 then 1 else -1 -- alternate right / left
			table.insert(buddies, {
				pet = pet,
				cfg = cfg,
				element = els[i] or cfg.element, -- assigned element overrides the body's
				facing = CFrame.Angles(0, math.rad(cfg.yawOffset or 0), 0),
				pos = ShipState.position,
				side = baseSide,
				sideTarget = baseSide,
				baseSide = baseSide,
				back = BACK + math.floor((i - 1) / 2) * 5, -- stagger pairs front/back
				nextShot = 0,
				bob = math.random() * 3,
			})
		end
	end

	RunService.Heartbeat:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		local shipPos = ShipState.position
		local fwd = ShipState.forward
		local right = fwd:Cross(Vector3.yAxis)
		right = if right.Magnitude > 0.01 then right.Unit else Vector3.xAxis
		local strafe = ShipState.strafe or 0
		local single = #buddies == 1

		for _, b in buddies do
			b.bob += dt
			-- Only a lone pet flips sides on strafe; with two pets they stay on opposite
			-- sides (so they don't pile on top of each other when you strafe).
			if single and strafe * b.sideTarget > 0.3 then
				b.sideTarget = -b.sideTarget
			end
			b.side = b.side + (b.sideTarget - b.side) * math.clamp(dt * 4, 0, 1)

			local goal = shipPos
				+ right * (SIDE * b.side)
				+ Vector3.new(0, UP + math.sin(b.bob * 2) * 1.5, 0)
				- fwd * b.back
			b.pos = b.pos:Lerp(goal, math.clamp(dt * 5, 0, 1))

			local target = nearestEnemy(b.pos, b.cfg.range)
			local lookDir = if target then (target.root.Position - b.pos).Unit else fwd
			b.pet:PivotTo(CFrame.lookAt(b.pos, b.pos + lookDir) * b.facing)

			if target and os.clock() >= b.nextShot then
				b.nextShot = os.clock() + b.cfg.cooldown
				local hit = target.root.Position
				local beam = Instance.new("Part")
				beam.Anchored = true
				beam.CanCollide = false
				beam.CastShadow = false
				beam.Material = Enum.Material.Neon
				beam.Color = b.cfg.laserColor
				beam.Size = Vector3.new(0.35, 0.35, (hit - b.pos).Magnitude)
				beam.CFrame = CFrame.lookAt((b.pos + hit) / 2, hit)
				beam.Parent = workspace
				Debris:AddItem(beam, 0.1)
				EnemyController.damage(target, b.cfg.damage) -- no element (elemental system off)
			end
		end
	end)
end

return PetController
