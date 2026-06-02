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
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Debris = game:GetService("Debris")
local TweenService = game:GetService("TweenService")

-- Layered procedural explosion: flash + lumpy puff-cluster fireball + spark and
-- smoke particle bursts + a decaying light. All code-driven, no asset uploads.
local function makeEmitter(parent: Instance, props: { [string]: any }): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Rate = 0 -- burst-only (we call :Emit)
	for k, v in props do
		(e :: any)[k] = v
	end
	e.Parent = parent
	return e
end

local function explode(pos: Vector3)
	local holder = Instance.new("Part")
	holder.Anchored = true
	holder.CanCollide = false
	holder.Transparency = 1
	holder.Size = Vector3.one
	holder.CFrame = CFrame.new(pos)
	holder.Parent = workspace
	local att = Instance.new("Attachment")
	att.Parent = holder

	-- 1) Flash: a brief white pop.
	local flash = Instance.new("Part")
	flash.Shape = Enum.PartType.Ball
	flash.Anchored = true
	flash.CanCollide = false
	flash.CastShadow = false
	flash.Material = Enum.Material.Neon
	flash.Color = Color3.fromRGB(255, 250, 230)
	flash.Size = Vector3.new(5, 5, 5)
	flash.CFrame = CFrame.new(pos)
	flash.Parent = workspace
	TweenService:Create(flash, TweenInfo.new(0.12), { Size = Vector3.new(11, 11, 11), Transparency = 1 }):Play()
	Debris:AddItem(flash, 0.15)

	-- 2) Decaying light.
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 160, 60)
	light.Brightness = 7
	light.Range = 30
	light.Parent = holder
	TweenService:Create(light, TweenInfo.new(0.35), { Brightness = 0 }):Play()

	-- 3) Lumpy fireball: a few neon puffs at random offsets, expanding + fading.
	for _ = 1, 4 do
		local puff = Instance.new("Part")
		puff.Shape = Enum.PartType.Ball
		puff.Anchored = true
		puff.CanCollide = false
		puff.CastShadow = false
		puff.Material = Enum.Material.Neon
		puff.Color = Color3.fromRGB(255, 120 + math.random(0, 80), 40)
		puff.Size = Vector3.new(3, 3, 3)
		local off = Vector3.new((math.random() - 0.5) * 6, (math.random() - 0.5) * 6, (math.random() - 0.5) * 6)
		puff.CFrame = CFrame.new(pos + off)
		puff.Parent = workspace
		local grow = 9 + math.random() * 7
		TweenService:Create(
			puff,
			TweenInfo.new(0.3 + math.random() * 0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
			{ Size = Vector3.new(grow, grow, grow), Transparency = 1 }
		):Play()
		Debris:AddItem(puff, 0.5)
	end

	-- 4) Spark burst (fast, gravity, short-lived).
	local sparks = makeEmitter(att, {
		Texture = "rbxasset://textures/particles/sparkles_main.dds",
		Color = ColorSequence.new(Color3.fromRGB(255, 240, 160), Color3.fromRGB(255, 120, 30)),
		Size = NumberSequence.new(1.2, 0.1),
		Transparency = NumberSequence.new(0.1, 1),
		Lifetime = NumberRange.new(0.3, 0.6),
		Speed = NumberRange.new(40, 90),
		SpreadAngle = Vector2.new(180, 180),
		Acceleration = Vector3.new(0, -70, 0),
		LightEmission = 1,
		Brightness = 2,
	})
	sparks:Emit(18)

	-- 5) Smoke puff (slow, fades).
	local smoke = makeEmitter(att, {
		Texture = "rbxasset://textures/particles/smoke_main.dds",
		Color = ColorSequence.new(Color3.fromRGB(70, 60, 55), Color3.fromRGB(30, 28, 30)),
		Size = NumberSequence.new(4, 13),
		Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0.35),
			NumberSequenceKeypoint.new(1, 1),
		}),
		Lifetime = NumberRange.new(0.6, 1.0),
		Speed = NumberRange.new(6, 16),
		SpreadAngle = Vector2.new(180, 180),
		Rotation = NumberRange.new(0, 360),
	})
	smoke:Emit(12)

	Debris:AddItem(holder, 1.4)
end

local ShipState = require(script.Parent.ShipState)
local EnemyController = require(script.Parent.EnemyController)

local WeaponController = {}

-- Main (hitscan beam).
local MAIN_RANGE = 300
local MAIN_CONE = math.cos(math.rad(15)) -- auto-aim assist half-angle
local MAIN_DPS = 18

local AIM_DIST = 160 -- where the crosshair sits along the aim ray

-- Secondary (projectiles).
local SECONDARY_SPEED = 380
local SECONDARY_DMG = 45
local SECONDARY_COOLDOWN = 0.35
local SECONDARY_LIFE = 3
local SECONDARY_HIT = 11 -- hit radius

local MUZZLE_FWD = 6 -- spawn weapons slightly ahead of the ship center

local function muzzle(): (Vector3, Vector3)
	local dir = ShipState.forward
	return ShipState.position + dir * MUZZLE_FWD, dir
end

-- Nearest enemy within the aim cone + range (best angle wins).
local function acquireTarget(origin: Vector3, dir: Vector3)
	local best, bestDot = nil, MAIN_CONE
	for _, e in EnemyController.enemies do
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

function WeaponController.start()
	local player = Players.LocalPlayer
	local camera = workspace.CurrentCamera

	-- Raycasts that only hit the terrain (so weapons can't shoot through hills).
	local terrainParams = RaycastParams.new()
	terrainParams.FilterType = Enum.RaycastFilterType.Include
	terrainParams.FilterDescendantsInstances = { workspace.Terrain }

	-- Crosshair showing where the secondary projectiles will go (tints red on a
	-- main-weapon lock).
	local hud = Instance.new("ScreenGui")
	hud.Name = "Reticle"
	hud.IgnoreGuiInset = true
	hud.ResetOnSpawn = false
	hud.Parent = player:WaitForChild("PlayerGui")

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

	-- Beam visual (reused).
	local beam = Instance.new("Part")
	beam.Name = "MainBeam"
	beam.Anchored = true
	beam.CanCollide = false
	beam.CastShadow = false
	beam.Material = Enum.Material.Neon
	beam.Color = Color3.fromRGB(255, 70, 190)
	beam.Transparency = 1
	beam.Parent = workspace

	-- Secondary input state (touch button / mouse / gamepad trigger).
	local secondaryHeld = false
	local lastFire = 0
	local projectiles: { { part: BasePart, vel: Vector3, life: number } } = {}

	local function fireSecondary()
		local origin, dir = muzzle()
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.new(4, 4, 4)
		p.Anchored = true
		p.CanCollide = false
		p.CastShadow = false
		p.Material = Enum.Material.Neon
		p.Color = Color3.fromRGB(255, 180, 40)
		p.CFrame = CFrame.new(origin)
		p.Parent = workspace
		table.insert(projectiles, { part = p, vel = dir * SECONDARY_SPEED, life = SECONDARY_LIFE })
	end

	UserInputService.InputBegan:Connect(function(input, gpe)
		if gpe then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.KeyCode == Enum.KeyCode.ButtonR2 then
			secondaryHeld = true
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
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
	end

	RunService.Heartbeat:Connect(function(dt)
		local origin, dir = muzzle()

		-- MAIN: auto-target + beam + damage over time.
		local target = acquireTarget(origin, dir)
		-- Drop the lock if terrain blocks the line of sight.
		if target then
			local to = target.root.Position - origin
			if workspace:Raycast(origin, to, terrainParams) then
				target = nil
			end
		end

		-- Crosshair: project the aim point to the screen; red when locked.
		local sp = camera:WorldToViewportPoint(origin + dir * AIM_DIST)
		ring.Visible = sp.Z > 0
		ring.Position = UDim2.fromOffset(sp.X, sp.Y)
		local rc = if target then Color3.fromRGB(255, 80, 80) else Color3.fromRGB(255, 255, 255)
		ringStroke.Color = rc
		dot.BackgroundColor3 = rc

		if target then
			local hit = target.root.Position
			local mid = (origin + hit) / 2
			local dist = (hit - origin).Magnitude
			beam.Size = Vector3.new(0.7, 0.7, dist)
			beam.CFrame = CFrame.lookAt(mid, hit)
			beam.Transparency = 0.1
			EnemyController.damage(target, MAIN_DPS * dt)
		else
			beam.Transparency = 1
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
			local stepVec = pr.vel * dt
			-- Stop at terrain instead of passing through it.
			if workspace:Raycast(pr.part.Position, stepVec, terrainParams) then
				pr.part:Destroy()
				table.remove(projectiles, i)
				continue
			end
			pr.part.CFrame = pr.part.CFrame + stepVec
			local hitEnemy = nil
			for _, e in EnemyController.enemies do
				if (e.root.Position - pr.part.Position).Magnitude <= SECONDARY_HIT then
					hitEnemy = e
					break
				end
			end
			if hitEnemy then
				explode(pr.part.Position)
				EnemyController.damage(hitEnemy, SECONDARY_DMG)
				pr.part:Destroy()
				table.remove(projectiles, i)
			elseif pr.life <= 0 then
				pr.part:Destroy()
				table.remove(projectiles, i)
			end
		end
	end)
end

return WeaponController
