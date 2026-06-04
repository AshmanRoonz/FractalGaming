--!strict
-- Renders OTHER players in your battle from the server broadcast: their ship, their
-- equipped pet, their laser (colored to match), and their fired projectile objects,
-- so everyone sees each other's unlocks. Interpolated between ~20 Hz updates and
-- tagged with the pilot's name.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local ShipTemplate = require(ReplicatedStorage.Shared.Templates.ShipTemplate)
local WorldHeights = require(ReplicatedStorage.Shared.WorldHeights)
local BattleSession = require(script.Parent.BattleSession)
local WeaponVisuals = require(ReplicatedStorage.Shared.WeaponVisuals)
local PetVisuals = require(ReplicatedStorage.Shared.PetVisuals)
local MainWeapons = require(ReplicatedStorage.Shared.Catalog.MainWeapons)
local SecondaryWeapons = require(ReplicatedStorage.Shared.Catalog.SecondaryWeapons)
local Explosion = require(ReplicatedStorage.Shared.Explosion)
local Sfx = require(ReplicatedStorage.Shared.Sfx)
local ShipState = require(script.Parent.ShipState)

local RemoteShipsController = {}

local TARGET_SHIP_SIZE = 14
local PROJECTILE_SIZE = 12 -- match WeaponController's fired-object size
local SECONDARY_SPEED = 175
local PET_SIDE, PET_UP, PET_BACK = 13, 7, 5
-- Team clothesline tether: a glowing line from your ship to each teammate. Always
-- shown as a locator, but goes bright/hot within CL_HOT_LEN (matches the server's
-- damaging range) and fades out toward CL_FADE_LEN.
local TETHER_THICK = 0.55
local CL_HOT_LEN = 320 -- within this it's actively cutting (server CL_MAX_LEN)
local CL_FADE_LEN = 1500 -- past this the locator line is fully faded
local TETHER_HOT = Color3.fromRGB(120, 255, 180)
local TETHER_COLD = Color3.fromRGB(90, 170, 255)

local function findById(list: any, id: string?): any
	for _, d in list do
		if d.id == id then
			return d
		end
	end
	return list[1]
end

local function scaleToSize(model: Model, target: number)
	local size = model:GetExtentsSize()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 0 then
		model:ScaleTo(target / longest)
	end
end

type Remote = {
	model: Model,
	modelYaw: CFrame,
	target: CFrame,
	snapped: boolean,
	beam: BasePart,
	beamHit: Vector3?,
	tether: BasePart,
	pet: Model?,
	petFacing: CFrame,
	petPos: Vector3,
	petBob: number,
	secCfg: any,
}

function RemoteShipsController.start()
	local gen = BattleSession.gen
	local localId = Players.LocalPlayer.UserId
	local states = ReplicatedStorage:WaitForChild("ShipStates")
	local playerFired = ReplicatedStorage:WaitForChild("PlayerFired")

	local container = Instance.new("Folder")
	container.Name = "RemoteShips"
	container.Parent = workspace
	BattleSession.track(container)

	local ships: { [number]: Remote } = {}
	local balls: { { obj: Model, vel: Vector3, life: number } } = {}

	local function ensure(userId: number, shipId: string, mainId: string?, secId: string?, petId: string?): Remote
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

		-- Beam, colored to match their laser.
		local mainCfg = findById(MainWeapons, mainId)
		local beam = Instance.new("Part")
		beam.Anchored = true
		beam.CanCollide = false
		beam.CastShadow = false
		beam.Material = Enum.Material.Neon
		beam.Color = mainCfg.color
		beam.Transparency = 1
		beam.Parent = container

		-- Team clothesline tether from your ship to this teammate.
		local tether = Instance.new("Part")
		tether.Anchored = true
		tether.CanCollide = false
		tether.CastShadow = false
		tether.Material = Enum.Material.Neon
		tether.Color = TETHER_COLD
		tether.Transparency = 1
		tether.Parent = container

		-- Their equipped pet, flying alongside.
		local petCfg = PetVisuals.findById(petId)
		local pet = PetVisuals.buildBody(petCfg)
		pet.Parent = container

		local rec: Remote = {
			model = model,
			modelYaw = CFrame.Angles(0, math.rad(ship.def.modelYawOffset or 0), 0),
			target = CFrame.new(0, 100, 0),
			snapped = false,
			beam = beam,
			beamHit = nil,
			tether = tether,
			pet = pet,
			petFacing = CFrame.Angles(0, math.rad(petCfg.yawOffset or 0), 0),
			petPos = Vector3.new(0, 100, 0),
			petBob = 0,
			secCfg = findById(SecondaryWeapons, secId),
		}
		ships[userId] = rec
		return rec
	end

	states.OnClientEvent:Connect(function(list)
		if BattleSession.gen ~= gen then
			return
		end
		local present = {}
		for _, e in list do
			if e.u ~= localId then
				present[e.u] = true
				local rec = ensure(e.u, e.s, e.m, e.x, e.p)
				rec.target = e.c
				rec.beamHit = e.b
			end
		end
		-- Drop players no longer broadcasting (left battle / game).
		for id, rec in ships do
			if not present[id] then
				rec.model:Destroy()
				rec.beam:Destroy()
				rec.tether:Destroy()
				if rec.pet then
					rec.pet:Destroy()
				end
				ships[id] = nil
			end
		end
	end)

	-- A remote ship was destroyed: explode it and remove it right away.
	local shipExploded = ReplicatedStorage:WaitForChild("ShipExploded")
	shipExploded.OnClientEvent:Connect(function(userId, pos)
		if BattleSession.gen ~= gen or userId == localId then
			return
		end
		local rec = ships[userId]
		local at = if rec then rec.model:GetPivot().Position else pos
		Explosion.big(at)
		Sfx.play("explosion")
		if rec then
			rec.model:Destroy()
			rec.beam:Destroy()
			rec.tether:Destroy()
			if rec.pet then
				rec.pet:Destroy()
			end
			ships[userId] = nil
		end
	end)

	-- Render other players' secondary shots as their actual projectile object.
	playerFired.OnClientEvent:Connect(function(userId, origin, dir)
		if BattleSession.gen ~= gen or userId == localId then
			return
		end
		local rec = ships[userId]
		local secCfg = (rec and rec.secCfg) or findById(SecondaryWeapons, "Missile")
		local m = WeaponVisuals.makeProjectile(secCfg, PROJECTILE_SIZE)
		m:PivotTo(CFrame.lookAt(origin, origin + dir)) -- face the way it's fired
		m.Parent = container
		table.insert(balls, { obj = m, vel = dir * SECONDARY_SPEED, life = 5 })
	end)

	RunService.RenderStepped:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
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
				rec.beam.Size = Vector3.new(0.9, 0.9, (hit - from).Magnitude)
				rec.beam.CFrame = CFrame.lookAt((from + hit) / 2, hit)
				rec.beam.Transparency = 0.1
			else
				rec.beam.Transparency = 1
			end
			-- Team clothesline tether from your ship to this teammate. Always shown as
			-- a locator; bright/hot when close enough to be cutting, fading out far away.
			local myPos = ShipState.position
			local theirPos = rec.model:GetPivot().Position
			local span = theirPos - myPos
			local len = span.Magnitude
			if len > 1 then
				rec.tether.Size = Vector3.new(TETHER_THICK, TETHER_THICK, len)
				rec.tether.CFrame = CFrame.lookAt((myPos + theirPos) / 2, theirPos)
				if len <= CL_HOT_LEN then
					rec.tether.Color = TETHER_HOT
					rec.tether.Transparency = 0.45 -- actively cutting, but see-through
				else
					rec.tether.Color = TETHER_COLD
					local f = math.clamp((len - CL_HOT_LEN) / (CL_FADE_LEN - CL_HOT_LEN), 0, 1)
					rec.tether.Transparency = 0.6 + f * 0.35 -- faint, fading with distance
				end
			else
				rec.tether.Transparency = 1
			end
			-- Pet trails their ship.
			if rec.pet then
				local pos = rec.model:GetPivot().Position
				local fwd = rec.target.LookVector
				local right = fwd:Cross(Vector3.yAxis)
				right = if right.Magnitude > 0.01 then right.Unit else Vector3.xAxis
				rec.petBob += dt
				local g = pos + right * PET_SIDE + Vector3.new(0, PET_UP + math.sin(rec.petBob * 2) * 1.2, 0) - fwd * PET_BACK
				rec.petPos = rec.petPos:Lerp(g, math.clamp(dt * 5, 0, 1))
				rec.pet:PivotTo(CFrame.lookAt(rec.petPos, rec.petPos + fwd) * rec.petFacing)
			end
		end
		-- Other players' projectile objects.
		for i = #balls, 1, -1 do
			local b = balls[i]
			b.life -= dt
			b.obj:PivotTo(b.obj:GetPivot() + b.vel * dt)
			local pos = b.obj:GetPivot().Position
			local hitTerrain = pos.Y < WorldHeights.groundY(pos.X, pos.Z) or pos.Y > WorldHeights.ceilY(pos.X, pos.Z)
			if b.life <= 0 or hitTerrain then
				WeaponVisuals.clearEffects(b.obj)
				b.obj:Destroy()
				table.remove(balls, i)
			end
		end
	end)
end

return RemoteShipsController
