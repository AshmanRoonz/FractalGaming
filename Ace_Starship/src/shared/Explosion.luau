--!strict
-- Layered procedural explosion, shared by weapons and enemies: flash + lumpy
-- puff-cluster fireball + spark and smoke particle bursts + a decaying light.
-- All code-driven, no asset uploads. `burst` is the standard hit; `big` is the
-- beefier boss-death version.

local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")
local RunService = game:GetService("RunService")

local Explosion = {}

-- Fewer particles on touch devices (tablets/phones) to keep combat smooth.
local MOBILE = false
pcall(function()
	MOBILE = game:GetService("UserInputService").TouchEnabled
end)
local function lo(n: number): number
	return if MOBILE then math.max(1, math.floor(n * 0.4)) else n
end

-- Expanding shockwave: an energy sphere + a flat ground ring that grow with the
-- Sedov-Taylor blast law (radius ~ t^(2/5)), so they shoot out fast then
-- decelerate and fade -- the hallmark of a real shock front.
function Explosion.shockwave(pos: Vector3, maxRadius: number?, duration: number?)
	local R = maxRadius or 90
	local dur = duration or 0.55
	local color = Color3.fromRGB(165, 210, 255)

	local sphere = Instance.new("Part")
	sphere.Shape = Enum.PartType.Ball
	sphere.Anchored = true
	sphere.CanCollide = false
	sphere.CastShadow = false
	sphere.Material = Enum.Material.Neon
	sphere.Color = color
	sphere.Size = Vector3.new(2, 2, 2)
	sphere.CFrame = CFrame.new(pos)
	sphere.Transparency = 0.25
	sphere.Parent = workspace

	local ring = Instance.new("Part")
	ring.Shape = Enum.PartType.Cylinder
	ring.Anchored = true
	ring.CanCollide = false
	ring.CastShadow = false
	ring.Material = Enum.Material.Neon
	ring.Color = color
	ring.Size = Vector3.new(3, 2, 2)
	ring.CFrame = CFrame.new(pos) * CFrame.Angles(0, 0, math.rad(90)) -- flat disc
	ring.Transparency = 0.1
	ring.Parent = workspace

	task.spawn(function()
		local t = 0
		while t < dur do
			t += RunService.Heartbeat:Wait()
			local f = math.clamp(t / dur, 0, 1)
			local r = R * f ^ 0.4 -- Sedov-Taylor: R ~ t^(2/5)
			sphere.Size = Vector3.new(r * 2, r * 2, r * 2)
			sphere.Transparency = 0.25 + 0.75 * f
			ring.Size = Vector3.new(3, r * 2, r * 2)
			ring.Transparency = 0.1 + 0.9 * f
		end
		sphere:Destroy()
		ring:Destroy()
	end)
end

local function makeEmitter(parent: Instance, props: { [string]: any }): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Rate = 0 -- burst-only (we call :Emit)
	for k, v in props do
		(e :: any)[k] = v
	end
	e.Parent = parent
	return e
end

-- scale 1 = normal hit; larger = bigger blast.
local function blast(pos: Vector3, scale: number, puffCount: number, sparkCount: number, smokeCount: number)
	local holder = Instance.new("Part")
	holder.Anchored = true
	holder.CanCollide = false
	holder.Transparency = 1
	holder.Size = Vector3.one
	holder.CFrame = CFrame.new(pos)
	holder.Parent = workspace
	local att = Instance.new("Attachment")
	att.Parent = holder

	-- Flash.
	local flash = Instance.new("Part")
	flash.Shape = Enum.PartType.Ball
	flash.Anchored = true
	flash.CanCollide = false
	flash.CastShadow = false
	flash.Material = Enum.Material.Neon
	flash.Color = Color3.fromRGB(255, 250, 230)
	flash.Size = Vector3.new(5, 5, 5) * scale
	flash.CFrame = CFrame.new(pos)
	flash.Parent = workspace
	TweenService:Create(flash, TweenInfo.new(0.12 * scale), { Size = Vector3.new(11, 11, 11) * scale, Transparency = 1 }):Play()
	Debris:AddItem(flash, 0.18 * scale)

	-- Decaying light.
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 160, 60)
	light.Brightness = 7 * scale
	light.Range = 30 * scale
	light.Parent = holder
	TweenService:Create(light, TweenInfo.new(0.35 * scale), { Brightness = 0 }):Play()

	-- Lumpy fireball puffs.
	for _ = 1, puffCount do
		local puff = Instance.new("Part")
		puff.Shape = Enum.PartType.Ball
		puff.Anchored = true
		puff.CanCollide = false
		puff.CastShadow = false
		puff.Material = Enum.Material.Neon
		puff.Color = Color3.fromRGB(255, 120 + math.random(0, 80), 40)
		puff.Size = Vector3.new(3, 3, 3) * scale
		local spread = 6 * scale
		puff.CFrame = CFrame.new(pos + Vector3.new((math.random() - 0.5) * spread, (math.random() - 0.5) * spread, (math.random() - 0.5) * spread))
		puff.Parent = workspace
		local grow = (9 + math.random() * 7) * scale
		TweenService:Create(
			puff,
			TweenInfo.new(0.3 + math.random() * 0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
			{ Size = Vector3.new(grow, grow, grow), Transparency = 1 }
		):Play()
		Debris:AddItem(puff, 0.55)
	end

	-- Sparks.
	local sparks = makeEmitter(att, {
		Texture = "rbxasset://textures/particles/sparkles_main.dds",
		Color = ColorSequence.new(Color3.fromRGB(255, 240, 160), Color3.fromRGB(255, 120, 30)),
		Size = NumberSequence.new(1.2 * scale, 0.1),
		Transparency = NumberSequence.new(0.1, 1),
		Lifetime = NumberRange.new(0.3, 0.6),
		Speed = NumberRange.new(40 * scale, 90 * scale),
		SpreadAngle = Vector2.new(180, 180),
		Acceleration = Vector3.new(0, -70, 0),
		LightEmission = 1,
		Brightness = 2,
	})
	sparks:Emit(sparkCount)

	-- Smoke.
	local smoke = makeEmitter(att, {
		Texture = "rbxasset://textures/particles/smoke_main.dds",
		Color = ColorSequence.new(Color3.fromRGB(70, 60, 55), Color3.fromRGB(30, 28, 30)),
		Size = NumberSequence.new(4 * scale, 13 * scale),
		Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0.35),
			NumberSequenceKeypoint.new(1, 1),
		}),
		Lifetime = NumberRange.new(0.6, 1.0),
		Speed = NumberRange.new(6 * scale, 16 * scale),
		SpreadAngle = Vector2.new(180, 180),
		Rotation = NumberRange.new(0, 360),
	})
	smoke:Emit(smokeCount)

	Debris:AddItem(holder, 1.4 * scale)
end

function Explosion.burst(pos: Vector3)
	blast(pos, 1, lo(4), lo(18), lo(12))
end

function Explosion.big(pos: Vector3)
	blast(pos, 3, lo(9), lo(45), lo(28))
end

return Explosion
