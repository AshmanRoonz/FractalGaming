--!strict
-- Client-side enemy RENDERER for the server-authoritative battle. The server
-- owns enemies, waves, and enemy fire; this module renders them from broadcasts,
-- exposes the list for weapon targeting, reports hits back to the server, shows
-- the wave banner, draws enemy ball visuals, and applies player-hit damage.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")

local ShipState = require(script.Parent.ShipState)
local WorldHeights = require(ReplicatedStorage.Shared.WorldHeights)
local Explosion = require(ReplicatedStorage.Shared.Explosion)
local BattleSession = require(script.Parent.BattleSession)
local Sfx = require(ReplicatedStorage.Shared.Sfx)

local EnemyController = {}

-- Live targets for the weapons: array of { id, root }.
EnemyController.enemies = {} :: { any }

-- Report a hit to the server (called by WeaponController / PetController).
function EnemyController.damage(enemy: any, amount: number)
	local ev = ReplicatedStorage:FindFirstChild("DamageEnemy")
	if ev then
		(ev :: RemoteEvent):FireServer(enemy.id, amount)
	end
end

-- Blocky placeholder skibidi (scaled + red for bosses).
local function buildDummy(scale: number, isBoss: boolean): (Model, BasePart)
	local model = Instance.new("Model")
	model.Name = if isBoss then "Boss" else "Enemy"
	local torsoColor = if isBoss then Color3.fromRGB(180, 40, 40) else Color3.fromRGB(60, 140, 220)
	local skinColor = if isBoss then Color3.fromRGB(150, 60, 60) else Color3.fromRGB(240, 200, 40)
	local legColor = if isBoss then Color3.fromRGB(90, 25, 25) else Color3.fromRGB(60, 80, 120)
	local function part(size: Vector3, color: Color3, offset: Vector3): BasePart
		local p = Instance.new("Part")
		p.Size = size * scale
		p.Color = color
		p.Material = if isBoss then Enum.Material.Neon else Enum.Material.SmoothPlastic
		p.Anchored = true
		p.CanCollide = false
		p.CastShadow = false
		p.CFrame = CFrame.new(offset * scale) -- arranged rigidly so PivotTo works
		p.Parent = model
		return p
	end
	local torso = part(Vector3.new(2, 2, 1), torsoColor, Vector3.new(0, 0, 0))
	part(Vector3.new(1.2, 1.2, 1.2), skinColor, Vector3.new(0, 1.7, 0))
	part(Vector3.new(1, 2, 1), skinColor, Vector3.new(-1.5, 0, 0))
	part(Vector3.new(1, 2, 1), skinColor, Vector3.new(1.5, 0, 0))
	part(Vector3.new(1, 2, 1), legColor, Vector3.new(-0.5, -2, 0))
	part(Vector3.new(1, 2, 1), legColor, Vector3.new(0.5, -2, 0))
	model.PrimaryPart = torso
	return model, torso
end

-- Build an enemy: clone the matching model from Assets/Enemies, or fall back to
-- the blocky placeholder. Returns (model, rootPart).
local enemyAssets = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Enemies")
local ENEMY_SIZE = 35
local BOSS_SIZE = 105

local function scaleModel(model: Model, target: number)
	local size = model:GetExtentsSize()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 0 then
		pcall(function()
			model:ScaleTo(target / longest)
		end)
	end
end

local function buildEnemy(kind: string, boss: boolean): (Model, BasePart)
	local src = if enemyAssets and kind ~= "" then enemyAssets:FindFirstChild(kind) else nil
	local model: Model? = nil
	if src and src:IsA("Model") then
		model = src:Clone()
	elseif src and src:IsA("BasePart") then
		model = Instance.new("Model")
		local p = src:Clone() :: BasePart
		p.Parent = model
		model.PrimaryPart = p
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
			model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart", true) -- recursive
		end
		if not model.PrimaryPart then
			model:Destroy() -- no usable part; use the placeholder instead
			return buildDummy(if boss then 3 else 1, boss)
		end
		scaleModel(model, if boss then BOSS_SIZE else ENEMY_SIZE)
		return model, model.PrimaryPart :: BasePart
	end
	return buildDummy(if boss then 3 else 1, boss)
end

local TweenService = game:GetService("TweenService")

local function poof(pos: Vector3)
	local e = Instance.new("Part")
	e.Shape = Enum.PartType.Ball
	e.Anchored = true
	e.CanCollide = false
	e.CastShadow = false
	e.Material = Enum.Material.Neon
	e.Color = Color3.fromRGB(255, 150, 50)
	e.Size = Vector3.new(4, 4, 4)
	e.CFrame = CFrame.new(pos)
	e.Parent = workspace
	TweenService:Create(e, TweenInfo.new(0.3), { Size = Vector3.new(16, 16, 16), Transparency = 1 }):Play()
	Debris:AddItem(e, 0.35)
end

-- Big multi-burst blast for a boss death.
local function bigBoom(pos: Vector3)
	local flash = Instance.new("Part")
	flash.Shape = Enum.PartType.Ball
	flash.Anchored = true
	flash.CanCollide = false
	flash.CastShadow = false
	flash.Material = Enum.Material.Neon
	flash.Color = Color3.fromRGB(255, 240, 200)
	flash.Size = Vector3.new(12, 12, 12)
	flash.CFrame = CFrame.new(pos)
	flash.Parent = workspace
	local light = Instance.new("PointLight")
	light.Brightness = 10
	light.Range = 60
	light.Color = Color3.fromRGB(255, 170, 70)
	light.Parent = flash
	TweenService:Create(flash, TweenInfo.new(0.5), { Size = Vector3.new(55, 55, 55), Transparency = 1 }):Play()
	TweenService:Create(light, TweenInfo.new(0.5), { Brightness = 0 }):Play()
	Debris:AddItem(flash, 0.55)
	for i = 1, 7 do
		task.delay(i * 0.05, function()
			poof(pos + Vector3.new((math.random() - 0.5) * 26, (math.random() - 0.5) * 26, (math.random() - 0.5) * 26))
		end)
	end
end

function EnemyController.start()
	local gen = BattleSession.gen
	local container = Instance.new("Folder")
	container.Name = "Enemies"
	container.Parent = workspace
	BattleSession.track(container)
	BattleSession.onCleanup(function()
		EnemyController.enemies = {} -- drop stale targets so weapons don't chase ghosts
	end)

	local enemyStates = ReplicatedStorage:WaitForChild("EnemyStates")
	local enemyFired = ReplicatedStorage:WaitForChild("EnemyFired")
	local waveEvent = ReplicatedStorage:WaitForChild("WaveEvent")
	local playerHit = ReplicatedStorage:WaitForChild("PlayerHit")

	type Rec = { id: number, model: Model, root: BasePart, current: CFrame, target: CFrame, lastPos: Vector3, boss: boolean, radius: number }
	local byId: { [number]: Rec } = {}

	local function ensure(id: number, kind: string, boss: boolean, cf: CFrame): Rec
		local r = byId[id]
		if r then
			return r
		end
		local model, root = buildEnemy(kind, boss)
		model:PivotTo(cf)
		model.Parent = container
		r = {
			id = id,
			model = model,
			root = root,
			current = cf,
			target = cf,
			lastPos = cf.Position,
			boss = boss,
			radius = (if boss then BOSS_SIZE else ENEMY_SIZE) * 0.5,
		}
		byId[id] = r
		return r
	end

	local function rebuildList()
		local list = {}
		for _, r in byId do
			table.insert(list, r)
		end
		EnemyController.enemies = list
	end

	enemyStates.OnClientEvent:Connect(function(elist)
		if BattleSession.gen ~= gen then
			return
		end
		local present = {}
		for _, e in elist do
			if type(e) == "table" and e.id and typeof(e.c) == "CFrame" then
				present[e.id] = true
				-- One bad enemy must not abort the whole snapshot.
				local ok, r = pcall(ensure, e.id, e.k or "", e.boss, e.c)
				if ok and r then
					r.target = e.c
				end
			end
		end
		for id, r in byId do
			if not present[id] then
				if r.boss then
					Explosion.big(r.lastPos)
					Sfx.play("explosion")
				else
					Explosion.burst(r.lastPos)
					Sfx.play("enemyDown")
				end
				r.model:Destroy()
				byId[id] = nil
			end
		end
		rebuildList()
	end)

	playerHit.OnClientEvent:Connect(function(amount)
		if BattleSession.gen ~= gen then
			return
		end
		ShipState.damage(amount)
		Sfx.play("hit")
	end)

	-- Wave banner.
	local hud = Instance.new("ScreenGui")
	hud.Name = "WaveBanner"
	hud.IgnoreGuiInset = true
	hud.ResetOnSpawn = false
	hud.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	BattleSession.track(hud)
	local banner = Instance.new("TextLabel")
	banner.AnchorPoint = Vector2.new(0.5, 0.5)
	banner.Position = UDim2.fromScale(0.5, 0.22)
	banner.Size = UDim2.fromOffset(600, 70)
	banner.BackgroundTransparency = 1
	banner.Font = Enum.Font.GothamBlack
	banner.TextSize = 52
	banner.TextStrokeTransparency = 1
	banner.TextTransparency = 1
	banner.Text = ""
	banner.Parent = hud
	local bannerClock = -10
	waveEvent.OnClientEvent:Connect(function(n, boss)
		if BattleSession.gen ~= gen then
			return
		end
		banner.Text = if boss then `WAVE {n}  -  BOSS` else `WAVE {n}`
		banner.TextColor3 = if boss then Color3.fromRGB(255, 90, 90) else Color3.fromRGB(255, 255, 255)
		bannerClock = os.clock()
		Sfx.play("wave")
	end)

	-- Enemy ball visuals (server decides hits; this is just the projectile look).
	local visualBalls: { { part: BasePart, vel: Vector3, life: number } } = {}
	enemyFired.OnClientEvent:Connect(function(origin, dir, speed)
		if BattleSession.gen ~= gen then
			return
		end
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.new(3, 3, 3)
		p.Anchored = true
		p.CanCollide = false
		p.CastShadow = false
		p.Material = Enum.Material.Neon
		p.Color = Color3.fromRGB(180, 120, 255)
		p.CFrame = CFrame.new(origin)
		p.Parent = container -- destroyed with the battle on teardown
		table.insert(visualBalls, { part = p, vel = dir * speed, life = 4 })
	end)

	RunService.RenderStepped:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		-- Interpolate enemies toward their latest server transform.
		for _, r in byId do
			r.current = r.current:Lerp(r.target, math.clamp(dt * 12, 0, 1))
			r.lastPos = r.current.Position
			r.model:PivotTo(r.current)
		end
		-- Move enemy ball visuals.
		for i = #visualBalls, 1, -1 do
			local b = visualBalls[i]
			b.life -= dt
			b.part.CFrame = b.part.CFrame + b.vel * dt
			local p = b.part.Position
			local hitTerrain = p.Y < WorldHeights.groundY(p.X, p.Z) or p.Y > WorldHeights.ceilY(p.X, p.Z)
			local hitShip = (ShipState.position - p).Magnitude <= 13
			if hitShip or hitTerrain then
				Explosion.burst(p) -- layered blast on impact
			end
			if b.life <= 0 or hitTerrain or hitShip then
				b.part:Destroy()
				table.remove(visualBalls, i)
			end
		end
		-- Fade the wave banner.
		local t = os.clock() - bannerClock
		local a = math.clamp((t - 2) / 1, 0, 1)
		banner.TextTransparency = a
		banner.TextStrokeTransparency = math.clamp(0.3 + a, 0, 1)
	end)
end

return EnemyController
