--!strict
-- Renders OTHER players' ships in your battle, driven by the server's broadcast
-- of everyone's transforms. Each remote ship is interpolated between the ~20 Hz
-- updates and tagged with the pilot's name.
--
-- Phase 2 of multiplayer: presence in battle. (Shared enemies come later.)

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local ShipTemplate = require(ReplicatedStorage.Shared.Templates.ShipTemplate)
local WorldHeights = require(ReplicatedStorage.Shared.WorldHeights)

local RemoteShipsController = {}

local TARGET_SHIP_SIZE = 14

local function scaleToSize(model: Model, target: number)
	local size = model:GetExtentsSize()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 0 then
		model:ScaleTo(target / longest)
	end
end

type Remote = { model: Model, modelYaw: CFrame, target: CFrame, snapped: boolean, beam: BasePart, beamHit: Vector3? }

function RemoteShipsController.start()
	local localId = Players.LocalPlayer.UserId
	local states = ReplicatedStorage:WaitForChild("ShipStates")
	local playerFired = ReplicatedStorage:WaitForChild("PlayerFired")

	local container = Instance.new("Folder")
	container.Name = "RemoteShips"
	container.Parent = workspace

	local ships: { [number]: Remote } = {}
	local balls: { { part: BasePart, vel: Vector3, life: number } } = {}

	local function ensure(userId: number, shipId: string): Remote
		local existing = ships[userId]
		if existing then
			return existing
		end
		local ship = ShipTemplate.new(shipId)
		local model = ship.model
		for _, p in model:GetDescendants() do
			if p:IsA("BasePart") then
				p.Anchored = true
				p.CanCollide = false
			end
		end
		scaleToSize(model, TARGET_SHIP_SIZE)
		model.Parent = container

		-- Name tag.
		local plr = Players:GetPlayerByUserId(userId)
		local bb = Instance.new("BillboardGui")
		bb.Size = UDim2.fromOffset(140, 32)
		bb.StudsOffset = Vector3.new(0, 7, 0)
		bb.AlwaysOnTop = true
		bb.Adornee = ship.root
		bb.Parent = ship.root
		local nameLbl = Instance.new("TextLabel")
		nameLbl.Size = UDim2.fromScale(1, 1)
		nameLbl.BackgroundTransparency = 1
		nameLbl.Font = Enum.Font.GothamBold
		nameLbl.TextSize = 18
		nameLbl.TextColor3 = Color3.fromRGB(150, 220, 255)
		nameLbl.TextStrokeTransparency = 0.4
		nameLbl.Text = if plr then plr.Name else "Pilot"
		nameLbl.Parent = bb

		-- Beam this pilot fires (shown when they have a target).
		local beam = Instance.new("Part")
		beam.Anchored = true
		beam.CanCollide = false
		beam.CastShadow = false
		beam.Material = Enum.Material.Neon
		beam.Color = Color3.fromRGB(255, 70, 190)
		beam.Transparency = 1
		beam.Parent = container

		local rec: Remote = {
			model = model,
			modelYaw = CFrame.Angles(0, math.rad(ship.def.modelYawOffset or 0), 0),
			target = CFrame.new(0, 100, 0),
			snapped = false,
			beam = beam,
			beamHit = nil,
		}
		ships[userId] = rec
		return rec
	end

	states.OnClientEvent:Connect(function(list)
		local present = {}
		for _, e in list do
			if e.u ~= localId then
				present[e.u] = true
				local rec = ensure(e.u, e.s)
				rec.target = e.c
				rec.beamHit = e.b
			end
		end
		-- Drop ships for players no longer broadcasting (left battle / game).
		for id, rec in ships do
			if not present[id] then
				rec.model:Destroy()
				ships[id] = nil
			end
		end
	end)

	-- Render other players' secondary shots.
	playerFired.OnClientEvent:Connect(function(userId, origin, dir)
		if userId == localId then
			return
		end
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.new(4, 4, 4)
		p.Anchored = true
		p.CanCollide = false
		p.CastShadow = false
		p.Material = Enum.Material.Neon
		p.Color = Color3.fromRGB(255, 180, 40)
		p.CFrame = CFrame.new(origin)
		p.Parent = container
		table.insert(balls, { part = p, vel = dir * 380, life = 3 })
	end)

	RunService.RenderStepped:Connect(function(dt)
		for _, rec in ships do
			local goal = rec.target * rec.modelYaw
			if rec.snapped then
				rec.model:PivotTo(rec.model:GetPivot():Lerp(goal, math.clamp(dt * 12, 0, 1)))
			else
				rec.model:PivotTo(goal)
				rec.snapped = true
			end
			-- Beam to their target, if any.
			if rec.beamHit then
				local from = rec.model:GetPivot().Position
				local hit = rec.beamHit
				rec.beam.Size = Vector3.new(0.7, 0.7, (hit - from).Magnitude)
				rec.beam.CFrame = CFrame.lookAt((from + hit) / 2, hit)
				rec.beam.Transparency = 0.1
			else
				rec.beam.Transparency = 1
			end
		end
		-- Other players' secondary balls.
		for i = #balls, 1, -1 do
			local b = balls[i]
			b.life -= dt
			b.part.CFrame = b.part.CFrame + b.vel * dt
			local pos = b.part.Position
			local hitTerrain = pos.Y < WorldHeights.groundY(pos.X, pos.Z) or pos.Y > WorldHeights.ceilY(pos.X, pos.Z)
			if b.life <= 0 or hitTerrain then
				b.part:Destroy()
				table.remove(balls, i)
			end
		end
	end)
end

return RemoteShipsController
