--!strict
-- Placeholder flying enemies. Simple blocky "Roblox guy" dummies that drift
-- around the ship in the gap, with health. Real Meshy monsters drop into this
-- same structure later. Exposes the live list + a damage() helper for weapons.
--
-- LOCAL prototype (client-side enemies).

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Debris = game:GetService("Debris")

local ShipState = require(script.Parent.ShipState)

local EnemyController = {}

local ENEMY_HP = 100
local SPAWN_MIN, SPAWN_MAX = 360, 680 -- spawn distance from ship
local DRIFT_SPEED = 42 -- studs/sec they ease toward the ship
local BIAS_TO_START = 0.7 -- how strongly spawns favor the starting heading vs current view

-- Waves.
local WAVE_DELAY = 3 -- seconds between clearing a wave and the next
local BASE_COUNT = 2 -- wave N normal enemies = BASE_COUNT + N (wave 1 = 3)
local MAX_COUNT = 12 -- cap on normal enemies per wave
local BOSS_EVERY = 10 -- every Nth wave is a boss wave
local BOSS_HP = 900

EnemyController.wave = 0
EnemyController.waveActive = false
EnemyController.nextWaveAt = 0
local GAP_Y = 110 -- rough middle of the floor/ceiling gap

-- Enemy weapons (they shoot back).
local FIRE_RANGE = 300 -- only enemies this close fire
local LASER_DMG = 4 -- per shot
local LASER_COOLDOWN = 2.4
local BALL_DMG = 9
local BALL_SPEED = 170
local BALL_COOLDOWN = 1.5
local SHIP_HIT_RADIUS = 10

local terrainParams = RaycastParams.new()
terrainParams.FilterType = Enum.RaycastFilterType.Include
terrainParams.FilterDescendantsInstances = { workspace.Terrain }

export type Enemy = {
	model: Model,
	root: BasePart,
	hp: number,
	bob: number,
	weapon: string, -- "laser" | "ball"
	nextFire: number, -- os.clock() when it can fire again
}

EnemyController.enemies = {} :: { Enemy }

local container = Instance.new("Folder")

-- A simple blocky humanoid placeholder (classic Roblox colors). Bosses are
-- scaled up and tinted red.
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
		p:SetAttribute("LocalOffset", offset * scale)
		p.Parent = model
		return p
	end

	local torso = part(Vector3.new(2, 2, 1), torsoColor, Vector3.new(0, 0, 0))
	part(Vector3.new(1.2, 1.2, 1.2), skinColor, Vector3.new(0, 1.7, 0)) -- head
	part(Vector3.new(1, 2, 1), skinColor, Vector3.new(-1.5, 0, 0)) -- left arm
	part(Vector3.new(1, 2, 1), skinColor, Vector3.new(1.5, 0, 0)) -- right arm
	part(Vector3.new(1, 2, 1), legColor, Vector3.new(-0.5, -2, 0)) -- left leg
	part(Vector3.new(1, 2, 1), legColor, Vector3.new(0.5, -2, 0)) -- right leg

	model.PrimaryPart = torso
	return model, torso
end

-- Pose all parts around the torso CFrame using their stored local offsets.
local function poseDummy(model: Model, cf: CFrame)
	for _, p in model:GetChildren() do
		if p:IsA("BasePart") then
			local off = p:GetAttribute("LocalOffset") :: Vector3
			p.CFrame = cf * CFrame.new(off)
		end
	end
end

local function spawnEnemy(isBoss: boolean?)
	local boss = isBoss == true
	local model, root = buildDummy(if boss then 3 else 1, boss)
	local shipPos = ShipState.position

	-- Spawn in a 90-degree arc, biased toward the STARTING heading (so enemies
	-- trend from down-level) blended with where you're currently looking.
	local startD = EnemyController.startDir or Vector3.new(0, 0, -1)
	local cur = Vector3.new(ShipState.forward.X, 0, ShipState.forward.Z)
	cur = if cur.Magnitude > 0.01 then cur.Unit else startD
	local ref = startD * BIAS_TO_START + cur * (1 - BIAS_TO_START)
	ref = if ref.Magnitude > 0.01 then ref.Unit else startD
	local off = (math.random() - 0.5) * math.rad(90)
	local dir = CFrame.fromAxisAngle(Vector3.yAxis, off) * ref

	local dist = SPAWN_MIN + math.random() * (SPAWN_MAX - SPAWN_MIN)
	local pos = shipPos + dir * dist + Vector3.new(0, (math.random() - 0.5) * 60, 0)
	pos = Vector3.new(pos.X, math.clamp(pos.Y, GAP_Y - 60, GAP_Y + 60), pos.Z)
	poseDummy(model, CFrame.new(pos))
	model.Parent = container
	table.insert(EnemyController.enemies, {
		model = model,
		root = root,
		hp = if boss then BOSS_HP else ENEMY_HP,
		bob = math.random() * 10,
		weapon = "ball", -- enemies only throw balls (no hitscan)
		nextFire = os.clock() + 1 + math.random() * 2,
	})
end

-- Apply damage. Returns true if this killed the enemy (and respawns one).
function EnemyController.damage(enemy: Enemy, amount: number): boolean
	enemy.hp -= amount
	if enemy.hp > 0 then
		return false
	end
	local idx = table.find(EnemyController.enemies, enemy)
	if idx then
		table.remove(EnemyController.enemies, idx)
	end
	enemy.model:Destroy()
	-- Wave cleared? Schedule the next one.
	if EnemyController.waveActive and #EnemyController.enemies == 0 then
		EnemyController.waveActive = false
		EnemyController.nextWaveAt = os.clock() + WAVE_DELAY
	end
	return true
end

local enemyBalls: { { part: BasePart, vel: Vector3, life: number } } = {}

local function losClear(from: Vector3, to: Vector3): boolean
	return workspace:Raycast(from, to - from, terrainParams) == nil
end

local function enemyFire(e: Enemy, shipPos: Vector3)
	local origin = e.root.Position + Vector3.new(0, 1.5, 0)
	if not losClear(origin, shipPos) then
		return -- can't see the ship through terrain
	end
	if e.weapon == "laser" then
		-- Instant beam + damage, with a short visible flash.
		local beam = Instance.new("Part")
		beam.Anchored = true
		beam.CanCollide = false
		beam.CastShadow = false
		beam.Material = Enum.Material.Neon
		beam.Color = Color3.fromRGB(120, 230, 255)
		local mid = (origin + shipPos) / 2
		beam.Size = Vector3.new(0.4, 0.4, (shipPos - origin).Magnitude)
		beam.CFrame = CFrame.lookAt(mid, shipPos)
		beam.Parent = workspace
		Debris:AddItem(beam, 0.12)
		ShipState.damage(LASER_DMG)
		e.nextFire = os.clock() + LASER_COOLDOWN
	else
		-- Lob a ball toward the ship.
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.new(3, 3, 3)
		p.Anchored = true
		p.CanCollide = false
		p.CastShadow = false
		p.Material = Enum.Material.Neon
		p.Color = Color3.fromRGB(180, 120, 255)
		p.CFrame = CFrame.new(origin)
		p.Parent = workspace
		table.insert(enemyBalls, { part = p, vel = (shipPos - origin).Unit * BALL_SPEED, life = 4 })
		e.nextFire = os.clock() + BALL_COOLDOWN
	end
end

function EnemyController.start()
	container.Name = "Enemies"
	container.Parent = workspace

	-- Capture the starting heading; spawns favor this direction.
	local sd = Vector3.new(ShipState.forward.X, 0, ShipState.forward.Z)
	EnemyController.startDir = if sd.Magnitude > 0.01 then sd.Unit else Vector3.new(0, 0, -1)

	-- Wave banner.
	local hud = Instance.new("ScreenGui")
	hud.Name = "WaveBanner"
	hud.IgnoreGuiInset = true
	hud.ResetOnSpawn = false
	hud.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	local banner = Instance.new("TextLabel")
	banner.AnchorPoint = Vector2.new(0.5, 0.5)
	banner.Position = UDim2.fromScale(0.5, 0.22)
	banner.Size = UDim2.fromOffset(600, 70)
	banner.BackgroundTransparency = 1
	banner.Font = Enum.Font.GothamBlack
	banner.TextSize = 52
	banner.TextStrokeTransparency = 1
	banner.TextTransparency = 1
	banner.TextColor3 = Color3.fromRGB(255, 255, 255)
	banner.Text = ""
	banner.Parent = hud
	local bannerClock = -10

	local function startWave()
		EnemyController.wave += 1
		local n = EnemyController.wave
		local isBossWave = n % BOSS_EVERY == 0
		if isBossWave then
			banner.Text = `WAVE {n}  -  BOSS`
			banner.TextColor3 = Color3.fromRGB(255, 90, 90)
			spawnEnemy(true)
			for _ = 1, 3 do
				spawnEnemy(false)
			end
		else
			banner.Text = `WAVE {n}`
			banner.TextColor3 = Color3.fromRGB(255, 255, 255)
			local count = math.min(MAX_COUNT, BASE_COUNT + n)
			for _ = 1, count do
				spawnEnemy(false)
			end
		end
		bannerClock = os.clock()
		EnemyController.waveActive = true
	end

	EnemyController.wave = 0
	EnemyController.waveActive = false
	EnemyController.nextWaveAt = os.clock() + 2 -- first wave shortly after start

	RunService.Heartbeat:Connect(function(dt)
		local shipPos = ShipState.position

		-- Start the next wave once the field is clear and the breather is over.
		if not EnemyController.waveActive and #EnemyController.enemies == 0 and os.clock() >= EnemyController.nextWaveAt then
			startWave()
		end

		-- Fade the banner: hold ~2s, then fade out over 1s.
		local t = os.clock() - bannerClock
		local a = math.clamp((t - 2) / 1, 0, 1)
		banner.TextTransparency = a
		banner.TextStrokeTransparency = math.clamp(0.3 + a, 0, 1)
		for _, e in EnemyController.enemies do
			-- Ease toward the ship and bob a little, so they read as "flying".
			e.bob += dt
			local toShip = shipPos - e.root.Position
			local step = Vector3.zero
			if toShip.Magnitude > 60 then
				step = toShip.Unit * DRIFT_SPEED * dt
			end
			local bobY = math.sin(e.bob * 1.5) * 8 * dt
			local newPos = e.root.Position + step + Vector3.new(0, bobY, 0)
			poseDummy(e.model, CFrame.lookAt(newPos, shipPos))

			-- Fire at the ship if in range and off cooldown.
			if toShip.Magnitude <= FIRE_RANGE and os.clock() >= e.nextFire then
				enemyFire(e, shipPos)
			end
		end

		-- Update enemy balls: move, stop at terrain, damage ship on contact.
		for i = #enemyBalls, 1, -1 do
			local b = enemyBalls[i]
			b.life -= dt
			local stepVec = b.vel * dt
			local hitTerrain = workspace:Raycast(b.part.Position, stepVec, terrainParams) ~= nil
			b.part.CFrame = b.part.CFrame + stepVec
			if (b.part.Position - shipPos).Magnitude <= SHIP_HIT_RADIUS then
				ShipState.damage(BALL_DMG)
				b.part:Destroy()
				table.remove(enemyBalls, i)
			elseif hitTerrain or b.life <= 0 then
				b.part:Destroy()
				table.remove(enemyBalls, i)
			end
		end
	end)
end

return EnemyController
