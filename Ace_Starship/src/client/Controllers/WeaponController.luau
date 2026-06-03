--!strict
-- Weapons.
--   MAIN (hitscan): auto-targets the nearest enemy within the aim cone and locks
--     a continuous beam onto it, dealing damage over time. Auto-fires whenever
--     something's in your sights (no button) -- works the same on touch + desktop.
--     The beam is a placeholder "candy rope" (bright neon); swap the look later.
--   SECONDARY (projectiles): fires a funny object along your aim on a button
--     (touch), mouse, or gamepad trigger, with a cooldown. Damages on contact.
--
-- LOCAL prototype (client-side). Targets come from EnemyController.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Debris = game:GetService("Debris")
local TweenService = game:GetService("TweenService")

local Explosion = require(ReplicatedStorage.Shared.Explosion)
local WorldHeights = require(ReplicatedStorage.Shared.WorldHeights)
local MainWeapons = require(ReplicatedStorage.Shared.Catalog.MainWeapons)
local SecondaryWeapons = require(ReplicatedStorage.Shared.Catalog.SecondaryWeapons)
local BattleSession = require(script.Parent.BattleSession)
local Sfx = require(ReplicatedStorage.Shared.Sfx)

local function findById(list: any, id: string): any
	for _, d in list do
		if d.id == id then
			return d
		end
	end
	return list[1]
end

-- Object builders are shared (so remote players' projectiles render identically).
local WeaponVisuals = require(ReplicatedStorage.Shared.WeaponVisuals)
local findAssetPart = WeaponVisuals.findAssetPart
local makeProjectile = WeaponVisuals.makeProjectile

-- Resolve the equipped weapon to a def. If the id isn't in the catalog (e.g. an
-- asset that replicated after the catalog was built), but it names an asset in
-- the Lasers/Projectiles folders, build a def on the fly so it still renders --
-- instead of silently falling back to the default.
local function resolveWeaponDef(list: any, id: string?, isLaser: boolean): any
	if id then
		for _, d in list do
			if d.id == id then
				return d
			end
		end
		if findAssetPart(id) then
			if isLaser then
				return { id = id, displayName = id, color = Color3.fromRGB(255, 255, 255), shape = Enum.PartType.Ball, size = 4, spacing = 5, price = 0, object = id }
			end
			return { id = id, displayName = id, color = Color3.fromRGB(255, 255, 255), shape = Enum.PartType.Ball, size = 5, price = 0, object = id }
		end
	end
	return list[1]
end

local ShipState = require(script.Parent.ShipState)
local EnemyController = require(script.Parent.EnemyController)

local WeaponController = {}

-- Main (hitscan beam).
local MAIN_RANGE = 300
local MAIN_CONE = math.cos(math.rad(15)) -- auto-aim assist half-angle
local MAIN_DPS = 18
local LASER_BEAM_THICKNESS = 1.6 -- the real "laser" beam's width
local LASER_OBJ_SIZE = 7 -- base size for stacked-object lasers (candy, snakes, etc.)
local LASER_STRETCH = 1.8 -- elongate stacked objects along the beam
local LASER_MIN_THICK = 4 -- fatten thin objects (snakes/towers) so they're not skinny
local LASER_CONVEYOR = 12 -- studs/sec the objects stream toward the target (slow crawl)

local AIM_DIST = 160 -- where the crosshair sits along the aim ray

-- Secondary (projectiles).
local SECONDARY_SPEED = 175 -- slower so you can see the object fly
local SECONDARY_DMG = 45
local SECONDARY_COOLDOWN = 0.35
local SECONDARY_LIFE = 5
local SECONDARY_HIT = 11 -- hit radius
local PROJECTILE_SIZE = 12 -- every fired object is scaled to this (uniform, bigger)

-- Big bomb (charged by kills; faster kills charge it faster).
local KILL_CHARGE = 9 -- base charge per kill
local COMBO_WINDOW = 2.5 -- kills within this give bonus charge
local COMBO_BONUS = 20 -- max bonus charge for a fast kill
local BOMB_SCALE = 8 -- how much bigger the bomb is than a normal projectile
local BOMB_SPEED = 250
local BOMB_RADIUS = 95 -- area-of-effect radius
local BOMB_DAMAGE = 150 -- damage to each enemy in the blast

local MUZZLE_FWD = 6 -- spawn weapons slightly ahead of the ship center

local function muzzle(): (Vector3, Vector3)
	local dir = ShipState.forward
	return ShipState.position + dir * MUZZLE_FWD, dir
end

-- Nearest enemy within the aim cone + range (best angle wins).
local function acquireTarget(origin: Vector3, dir: Vector3)
	local best, bestDot = nil, MAIN_CONE
	for _, e in EnemyController.enemies do
		if not e.root then
			continue
		end
		local to = e.root.Position - origin
		local dist = to.Magnitude
		if dist > MAIN_RANGE or dist < 1 then
			continue
		end
		local d = to.Unit:Dot(dir)
		if d > bestDot then
			best, bestDot = e, d
		end
	end
	return best
end

function WeaponController.start(mainId: string?, secId: string?)
	local gen = BattleSession.gen
	local mainCfg = resolveWeaponDef(MainWeapons, mainId or "laser", true)
	local secCfg = resolveWeaponDef(SecondaryWeapons, secId or "ball", false)
	local player = Players.LocalPlayer
	local camera = workspace.CurrentCamera

	local playerFired = ReplicatedStorage:FindFirstChild("PlayerFired")

	-- Crosshair showing where the secondary projectiles will go (tints red on a
	-- main-weapon lock).
	local hud = Instance.new("ScreenGui")
	hud.Name = "Reticle"
	hud.IgnoreGuiInset = true
	hud.ResetOnSpawn = false
	hud.Parent = player:WaitForChild("PlayerGui")
	BattleSession.track(hud)

	local ring = Instance.new("Frame")
	ring.AnchorPoint = Vector2.new(0.5, 0.5)
	ring.Size = UDim2.fromOffset(28, 28)
	ring.BackgroundTransparency = 1
	ring.Visible = false
	ring.Parent = hud
	local ringStroke = Instance.new("UIStroke")
	ringStroke.Thickness = 2
	ringStroke.Color = Color3.fromRGB(255, 255, 255)
	ringStroke.Parent = ring
	local ringCorner = Instance.new("UICorner")
	ringCorner.CornerRadius = UDim.new(1, 0)
	ringCorner.Parent = ring
	local dot = Instance.new("Frame")
	dot.AnchorPoint = Vector2.new(0.5, 0.5)
	dot.Position = UDim2.fromScale(0.5, 0.5)
	dot.Size = UDim2.fromOffset(4, 4)
	dot.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	dot.Parent = ring
	local dotCorner = Instance.new("UICorner")
	dotCorner.CornerRadius = UDim.new(1, 0)
	dotCorner.Parent = dot

	-- Beam = a pooled line of the weapon's object, stacked toward the target.
	local MAX_SEG = 60
	local segFolder = Instance.new("Folder")
	segFolder.Name = "MainBeam"
	segFolder.Parent = workspace
	BattleSession.track(segFolder) -- also holds projectiles + bombs (below)

	-- Real "laser" beam: a single glowing part stretched to the target (used when
	-- the weapon is a beam type instead of a line of objects).
	local beamPart = Instance.new("Part")
	beamPart.Anchored = true
	beamPart.CanCollide = false
	beamPart.CastShadow = false
	beamPart.Material = Enum.Material.Neon
	beamPart.Color = mainCfg.color
	beamPart.Size = Vector3.new(LASER_BEAM_THICKNESS, LASER_BEAM_THICKNESS, 1)
	beamPart.Transparency = 1
	beamPart.Parent = segFolder
	local function drawBeam(from: Vector3, to: Vector3)
		local d = to - from
		beamPart.Size = Vector3.new(LASER_BEAM_THICKNESS, LASER_BEAM_THICKNESS, d.Magnitude)
		beamPart.CFrame = CFrame.lookAt((from + to) / 2, to)
		beamPart.Transparency = 0
	end
	-- Each beam segment is a whole-object clone (multi-part intact), scaled uniform
	-- like the projectiles. Pooled; we cache each segment's parts + their original
	-- transparency so we can show/hide quickly without losing the mesh's look.
	local LASER_SEG_SIZE = LASER_OBJ_SIZE
	local LASER_SPACING = LASER_SEG_SIZE * LASER_STRETCH * 0.85 -- tile the stretched objects
	type Seg = { model: Model, parts: { { part: BasePart, t: number } }, align: CFrame }
	local segPool: { Seg } = {}
	local function setSegVisible(s: Seg, visible: boolean)
		for _, rec in s.parts do
			rec.part.Transparency = if visible then rec.t else 1
		end
	end
	-- The object's longest local axis + the rotation that lays it along the beam
	-- (-Z), so a tall object like the CN Tower lies sideways instead of standing up.
	local function longestAxisInfo(model: Model): (CFrame, string)
		local saved = model:GetPivot()
		model:PivotTo(CFrame.new()) -- identity, so the box reads local-axis sizes
		local _, size = model:GetBoundingBox()
		model:PivotTo(saved)
		local mx = math.max(size.X, size.Y, size.Z)
		if mx == size.X then
			return CFrame.Angles(0, math.pi / 2, 0), "X" -- local X -> beam
		elseif mx == size.Y then
			return CFrame.Angles(-math.pi / 2, 0, 0), "Y" -- local Y (height) -> beam
		end
		return CFrame.new(), "Z" -- local Z already runs along the beam
	end
	local function getSeg(i: number): Seg
		local s = segPool[i]
		if not s then
			local model = makeProjectile(mainCfg, LASER_SEG_SIZE)
			model.Parent = segFolder
			local align, axis = longestAxisInfo(model)
			local parts = {}
			local baseParts: { BasePart } = {}
			for _, d in model:GetDescendants() do
				if d:IsA("BasePart") then
					table.insert(baseParts, d)
					table.insert(parts, { part = d, t = d.Transparency })
				end
			end
			-- Single-mesh beam objects: stretch the beam axis for the laser look, and
			-- fatten the two cross axes to a minimum so thin objects (snakes, towers)
			-- don't read as skinny.
			if #baseParts == 1 then
				local pp = baseParts[1]
				local z = pp.Size
				local nx = if axis == "X" then z.X * LASER_STRETCH else math.max(z.X, LASER_MIN_THICK)
				local ny = if axis == "Y" then z.Y * LASER_STRETCH else math.max(z.Y, LASER_MIN_THICK)
				local nz = if axis == "Z" then z.Z * LASER_STRETCH else math.max(z.Z, LASER_MIN_THICK)
				pp.Size = Vector3.new(nx, ny, nz)
			end
			s = { model = model, parts = parts, align = align }
			setSegVisible(s, false)
			segPool[i] = s
		end
		return s
	end
	local function hideSegmentsFrom(n: number)
		for i = n + 1, #segPool do
			setSegVisible(segPool[i], false)
		end
	end
	-- Stream objects along origin->hit like a conveyor belt: a time-based phase
	-- scrolls them toward the target, new ones appearing at the gun. Returns how
	-- many segments were used (the rest get hidden).
	local function drawLaser(from: Vector3, to: Vector3): number
		local d = to - from
		local dist = d.Magnitude
		if dist < 0.1 then
			return 0
		end
		local dir = d / dist
		local phase = (os.clock() * LASER_CONVEYOR) % LASER_SPACING -- scroll offset
		local slots = math.clamp(math.floor(dist / LASER_SPACING) + 2, 1, MAX_SEG)
		local used = 0
		for i = 0, slots - 1 do
			local along = i * LASER_SPACING + phase
			if along <= dist then
				used += 1
				local s = getSeg(used)
				local p = from + dir * along
				s.model:PivotTo(CFrame.lookAt(p, p + dir) * s.align) -- longest side along beam
				setSegVisible(s, true)
			end
		end
		return used
	end

	-- Secondary input state (touch button / mouse / gamepad trigger).
	local secondaryHeld = false
	local lastFire = 0
	local beamTimer = 0 -- throttles beam damage reports to the server
	local projectiles: { { obj: Model, vel: Vector3, life: number } } = {}

	-- ---- Kill count + big bomb -------------------------------------------
	local killEvent = ReplicatedStorage:WaitForChild("Kill")
	local killCount = 0
	local charge = 0 -- 0..100
	local lastKill = 0
	local bombs: { { obj: Model, vel: Vector3, life: number } } = {}

	local bombHud = Instance.new("ScreenGui")
	bombHud.Name = "BombHud"
	bombHud.IgnoreGuiInset = true
	bombHud.ResetOnSpawn = false
	bombHud.Parent = player:WaitForChild("PlayerGui")
	BattleSession.track(bombHud)
	local killLabel = Instance.new("TextLabel")
	killLabel.Position = UDim2.fromOffset(24, 58)
	killLabel.Size = UDim2.fromOffset(220, 24)
	killLabel.BackgroundTransparency = 1
	killLabel.Font = Enum.Font.GothamBold
	killLabel.TextSize = 20
	killLabel.TextXAlignment = Enum.TextXAlignment.Left
	killLabel.TextColor3 = Color3.fromRGB(255, 230, 150)
	killLabel.Text = "Kills  0"
	killLabel.Parent = bombHud
	local chargeBg = Instance.new("Frame")
	chargeBg.Position = UDim2.fromOffset(24, 86)
	chargeBg.Size = UDim2.fromOffset(220, 16)
	chargeBg.BackgroundColor3 = Color3.fromRGB(20, 22, 30)
	chargeBg.BackgroundTransparency = 0.25
	chargeBg.Parent = bombHud
	local bgC = Instance.new("UICorner")
	bgC.CornerRadius = UDim.new(0.5, 0)
	bgC.Parent = chargeBg
	local chargeFill = Instance.new("Frame")
	chargeFill.Size = UDim2.fromScale(0, 1)
	chargeFill.BackgroundColor3 = Color3.fromRGB(190, 90, 255)
	chargeFill.BorderSizePixel = 0
	chargeFill.Parent = chargeBg
	local fillC = Instance.new("UICorner")
	fillC.CornerRadius = UDim.new(0.5, 0)
	fillC.Parent = chargeFill
	local bombText = Instance.new("TextLabel")
	bombText.Size = UDim2.fromScale(1, 1)
	bombText.BackgroundTransparency = 1
	bombText.Font = Enum.Font.GothamBold
	bombText.TextSize = 12
	bombText.TextColor3 = Color3.fromRGB(255, 255, 255)
	bombText.Text = "BOMB"
	bombText.Parent = chargeBg

	killEvent.OnClientEvent:Connect(function()
		if BattleSession.gen ~= gen then
			return
		end
		killCount += 1
		local now = os.clock()
		local since = now - lastKill
		lastKill = now
		local bonus = if since < COMBO_WINDOW then (1 - since / COMBO_WINDOW) * COMBO_BONUS else 0
		charge = math.min(100, charge + KILL_CHARGE + bonus)
		killLabel.Text = "Kills  " .. killCount
	end)

	local function fireBomb()
		local origin, dir = muzzle()
		local m = makeProjectile(secCfg, PROJECTILE_SIZE * BOMB_SCALE) -- HUGE
		if m.PrimaryPart then
			local light = Instance.new("PointLight")
			light.Brightness = 4
			light.Range = 50
			light.Color = Color3.fromRGB(255, 230, 180)
			light.Parent = m.PrimaryPart
		end
		m:PivotTo(CFrame.new(origin))
		m.Parent = segFolder
		table.insert(bombs, { obj = m, vel = dir * BOMB_SPEED, life = 5 })
	end

	local function tryBomb()
		if charge >= 100 then
			charge = 0
			fireBomb()
			Sfx.play("bomb")
		end
	end

	local function fireSecondary()
		local origin, dir = muzzle()
		local m = makeProjectile(secCfg, PROJECTILE_SIZE)
		-- Light it so a dark mesh object is readable against the dim world.
		if m.PrimaryPart then
			local light = Instance.new("PointLight")
			light.Brightness = 2.5
			light.Range = 18
			light.Color = Color3.fromRGB(255, 245, 220)
			light.Parent = m.PrimaryPart
		end
		m:PivotTo(CFrame.new(origin))
		m.Parent = segFolder
		table.insert(projectiles, { obj = m, vel = dir * SECONDARY_SPEED, life = SECONDARY_LIFE })
		Sfx.play("shoot")
		if playerFired then
			(playerFired :: any):FireServer(origin, dir) -- show this shot to others
		end
	end

	UserInputService.InputBegan:Connect(function(input, gpe)
		if gpe or BattleSession.gen ~= gen then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.KeyCode == Enum.KeyCode.ButtonR2 then
			secondaryHeld = true
		elseif input.KeyCode == Enum.KeyCode.F or input.KeyCode == Enum.KeyCode.ButtonX then
			tryBomb()
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if BattleSession.gen ~= gen then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.KeyCode == Enum.KeyCode.ButtonR2 then
			secondaryHeld = false
		end
	end)

	-- Touch FIRE button (secondary).
	if UserInputService.TouchEnabled then
		local gui = Instance.new("ScreenGui")
		gui.Name = "WeaponControls"
		gui.IgnoreGuiInset = true
		gui.ResetOnSpawn = false
		gui.Parent = player:WaitForChild("PlayerGui")
		BattleSession.track(gui)

		local btn = Instance.new("TextButton")
		btn.Size = UDim2.fromOffset(120, 120)
		btn.AnchorPoint = Vector2.new(1, 1)
		btn.Position = UDim2.new(1, -150, 1, -30)
		btn.BackgroundColor3 = Color3.fromRGB(220, 90, 60)
		btn.BackgroundTransparency = 0.25
		btn.TextColor3 = Color3.fromRGB(255, 255, 255)
		btn.TextScaled = true
		btn.Text = "FIRE"
		btn.Parent = gui
		local c = Instance.new("UICorner")
		c.CornerRadius = UDim.new(1, 0)
		c.Parent = btn
		btn.InputBegan:Connect(function(i)
			if i.UserInputType == Enum.UserInputType.Touch then
				secondaryHeld = true
			end
		end)
		btn.InputEnded:Connect(function(i)
			if i.UserInputType == Enum.UserInputType.Touch then
				secondaryHeld = false
			end
		end)

		-- Touch BOMB button (above FIRE).
		local bombBtn = Instance.new("TextButton")
		bombBtn.Size = UDim2.fromOffset(120, 76)
		bombBtn.AnchorPoint = Vector2.new(1, 1)
		bombBtn.Position = UDim2.new(1, -150, 1, -160)
		bombBtn.BackgroundColor3 = Color3.fromRGB(150, 70, 220)
		bombBtn.BackgroundTransparency = 0.25
		bombBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
		bombBtn.TextScaled = true
		bombBtn.Text = "BOMB"
		bombBtn.Parent = gui
		local bc = Instance.new("UICorner")
		bc.CornerRadius = UDim.new(0.3, 0)
		bc.Parent = bombBtn
		bombBtn.InputBegan:Connect(function(i)
			if i.UserInputType == Enum.UserInputType.Touch then
				tryBomb()
			end
		end)
	end

	local hadTarget = false
	RunService.Heartbeat:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		local origin, dir = muzzle()

		-- MAIN: auto-target + beam + damage over time.
		local target = acquireTarget(origin, dir)
		-- Drop the lock if a mountain blocks the line of sight.
		if target and WorldHeights.blocked(origin, target.root.Position) then
			target = nil
		end
		if target and not hadTarget then
			Sfx.play("laser") -- a tick when the beam locks on
		end
		hadTarget = target ~= nil

		-- Crosshair: project the aim point to the screen; red when locked.
		local sp = camera:WorldToViewportPoint(origin + dir * AIM_DIST)
		ring.Visible = sp.Z > 0
		ring.Position = UDim2.fromOffset(sp.X, sp.Y)
		local rc = if target then Color3.fromRGB(255, 80, 80) else Color3.fromRGB(255, 255, 255)
		ringStroke.Color = rc
		dot.BackgroundColor3 = rc

		ShipState.beamHit = if target then target.root.Position else nil -- replicate beam

		if target then
			if mainCfg.beam then
				drawBeam(origin, target.root.Position) -- real laser
			else
				hideSegmentsFrom(drawLaser(origin, target.root.Position)) -- line of objects
			end
			-- Report accumulated beam damage ~10x/sec instead of every frame.
			beamTimer += dt
			if beamTimer >= 0.1 then
				EnemyController.damage(target, MAIN_DPS * beamTimer)
				beamTimer = 0
			end
		else
			beamPart.Transparency = 1
			hideSegmentsFrom(0)
			beamTimer = 0
		end

		-- SECONDARY: fire on held + cooldown.
		if secondaryHeld and os.clock() - lastFire >= SECONDARY_COOLDOWN then
			lastFire = os.clock()
			fireSecondary()
		end

		-- Update projectiles.
		for i = #projectiles, 1, -1 do
			local pr = projectiles[i]
			pr.life -= dt
			pr.obj:PivotTo(pr.obj:GetPivot() + pr.vel * dt)
			local p = pr.obj:GetPivot().Position
			local hitTerrain = p.Y < WorldHeights.groundY(p.X, p.Z) or p.Y > WorldHeights.ceilY(p.X, p.Z)
			local hitEnemy = nil
			for _, e in EnemyController.enemies do
				if e.root and (e.root.Position - p).Magnitude <= (e.radius or SECONDARY_HIT) + PROJECTILE_SIZE * 0.5 then
					hitEnemy = e
					break
				end
			end
			if hitEnemy or hitTerrain then
				Explosion.burst(p)
				if hitEnemy then
					EnemyController.damage(hitEnemy, SECONDARY_DMG)
				end
				pr.obj:Destroy()
				table.remove(projectiles, i)
			elseif pr.life <= 0 then
				pr.obj:Destroy()
				table.remove(projectiles, i)
			end
		end

		-- Charge bar: fills with kills, glows when ready.
		chargeFill.Size = UDim2.fromScale(charge / 100, 1)
		if charge >= 100 then
			chargeFill.BackgroundColor3 = Color3.fromRGB(255, 120, 255)
			bombText.Text = "BOMB READY"
		else
			chargeFill.BackgroundColor3 = Color3.fromRGB(160, 90, 220)
			bombText.Text = "BOMB"
		end

		-- Update bombs: huge projectile, wide-area blast on impact.
		for i = #bombs, 1, -1 do
			local b = bombs[i]
			b.life -= dt
			b.obj:PivotTo(b.obj:GetPivot() + b.vel * dt)
			local pos = b.obj:GetPivot().Position
			local hitTerrain = pos.Y < WorldHeights.groundY(pos.X, pos.Z) or pos.Y > WorldHeights.ceilY(pos.X, pos.Z)
			local hitEnemy = false
			for _, e in EnemyController.enemies do
				if e.root and (e.root.Position - pos).Magnitude <= (e.radius or 10) + 14 then
					hitEnemy = true
					break
				end
			end
			if hitEnemy or hitTerrain or b.life <= 0 then
				Explosion.big(pos)
				Explosion.shockwave(pos, BOMB_RADIUS, 0.6) -- Sedov-Taylor blast ring
				Sfx.play("explosion")
				for _, e in EnemyController.enemies do
					if e.root and (e.root.Position - pos).Magnitude <= BOMB_RADIUS then
						EnemyController.damage(e, BOMB_DAMAGE)
					end
				end
				b.obj:Destroy()
				table.remove(bombs, i)
			end
		end
	end)
end

return WeaponController
