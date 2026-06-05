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
local WeaponVisuals = require(ReplicatedStorage.Shared.WeaponVisuals)
local SecondaryWeapons = require(ReplicatedStorage.Shared.Catalog.SecondaryWeapons)
local Quality = require(ReplicatedStorage.Shared.Quality)

local EnemyController = {}

-- Enemies fire a random projectile object from Assets/Projectiles (same models the
-- player's secondary weapons use), picked per shot.
local ENEMY_PROJ_SIZE = 9
local function randomProjectileDef(): any
	if #SecondaryWeapons > 0 then
		return SecondaryWeapons[math.random(1, #SecondaryWeapons)]
	end
	return nil
end

-- Monster roars. Drop Sounds named monster1..monsterN (and "sirenhead") into
-- Assets/Sound. Every enemy plays a random monster sound when it appears; a
-- "Siren Head" enemy plays the sirenhead sound instead.
local soundFolder = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Sound")
local monsterSounds: { Sound } = {}
if soundFolder then
	for _, s in soundFolder:GetChildren() do
		if s:IsA("Sound") and string.match(s.Name:lower(), "^monster%d+$") then
			table.insert(monsterSounds, s)
		end
	end
end
local function normalize(name: string): string
	return (name:gsub("%s", "")):lower() -- "Siren Head" -> "sirenhead"
end
local function roar(root: BasePart, kind: string)
	if Quality.level == "low" then
		return -- skip the many concurrent positional roars on weak devices
	end
	local template: Sound? = nil
	if normalize(kind) == "sirenhead" and soundFolder then
		local sh = soundFolder:FindFirstChild("sirenhead") or soundFolder:FindFirstChild("Sirenhead")
		template = if sh and sh:IsA("Sound") then sh :: Sound else nil
	elseif #monsterSounds > 0 then
		template = monsterSounds[math.random(1, #monsterSounds)]
	end
	if not template then
		return
	end
	local s = template:Clone()
	s.Looped = false
	s.Parent = root -- parenting to a part makes it positional (3D)
	-- Carry across the arena: enemies start ~hundreds of studs out, so a default
	-- rolloff would be near-silent. Stay loud out to ~600 studs, then fall off.
	s.Volume = math.max(s.Volume, 1)
	s.RollOffMode = Enum.RollOffMode.Linear
	s.RollOffMinDistance = 120
	s.RollOffMaxDistance = 1400
	s:Play()
	s.Ended:Once(function()
		s:Destroy()
	end)
	Debris:AddItem(s, 15) -- safety net if Ended never fires
end

-- Live targets for the weapons: array of { id, root }.
EnemyController.enemies = {} :: { any }

-- Report a hit to the server (called by WeaponController / PetController).
function EnemyController.damage(enemy: any, amount: number, element: string?)
	local ev = ReplicatedStorage:FindFirstChild("DamageEnemy")
	if ev then
		(ev :: RemoteEvent):FireServer(enemy.id, amount, element)
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

-- Build an enemy: clone the matching model (bosses from Assets/Bosses, regulars
-- from Assets/Enemies). Regular enemies keep their Studio size (WYSIWYG); bosses
-- are normalized to a fixed on-screen size so they're reliably big no matter how
-- the boss mesh was built. Falls back to the blocky placeholder. Returns
-- (model, root, radius).
local assetsRoot = ReplicatedStorage:WaitForChild("Assets")
local enemyAssets = assetsRoot:FindFirstChild("Enemies")
local bossAssets = assetsRoot:FindFirstChild("Bosses")
local BOSS_SIZE = 90 -- bosses are scaled to this longest-axis size (studs)

-- Longest visible dimension of a model. Measures only NON-transparent parts, so a
-- stray invisible hitbox / oversized helper part can't inflate the bounds and make
-- the visible body shrink to nothing when we normalize bosses. Falls back to the
-- full extents if everything is invisible.
local function longestAxis(model: Model): number
	local minv: Vector3? = nil
	local maxv: Vector3? = nil
	for _, p in model:GetDescendants() do
		if p:IsA("BasePart") and p.Transparency < 1 then
			local r = p.Size * 0.5
			local lo = p.Position - r
			local hi = p.Position + r
			if minv then
				minv = Vector3.new(math.min(minv.X, lo.X), math.min(minv.Y, lo.Y), math.min(minv.Z, lo.Z))
				maxv = Vector3.new(math.max((maxv :: Vector3).X, hi.X), math.max((maxv :: Vector3).Y, hi.Y), math.max((maxv :: Vector3).Z, hi.Z))
			else
				minv, maxv = lo, hi
			end
		end
	end
	if minv and maxv then
		local d = maxv - minv
		return math.max(d.X, d.Y, d.Z)
	end
	local s = model:GetExtentsSize() -- nothing visible; fall back
	return math.max(s.X, s.Y, s.Z)
end

-- Optional per-enemy fine-tune: set a number attribute "SizeMul" on the model in
-- Assets/Enemies (or /Bosses) to scale it relative to how you built it in Studio.
-- 1 (or no attribute) = exactly as built, 1.5 = 50% bigger, 0.7 = 30% smaller.
local function sizeMul(src: Instance?): number
	if src then
		local a = src:GetAttribute("SizeMul")
		if typeof(a) == "number" and a > 0 then
			return math.clamp(a, 0.1, 10)
		end
	end
	return 1
end

local function normalizeTo(model: Model, target: number)
	-- Reset any baked Studio scale to native first, so ScaleTo (which is absolute,
	-- relative to the ORIGINAL size) lands on exactly `target` no matter how the
	-- model was scaled when it was built. This is the recurring tiny-boss culprit.
	pcall(function()
		model:ScaleTo(1)
	end)
	local longest = longestAxis(model)
	if longest > 0 then
		pcall(function()
			model:ScaleTo(target / longest)
		end)
	end
end

local function buildEnemy(kind: string, boss: boolean): (Model, BasePart, number)
	-- Bosses look in Assets/Bosses first, then fall back to Assets/Enemies so a
	-- missing boss model still uses a real enemy instead of the tiny placeholder.
	local src: Instance? = nil
	if kind ~= "" then
		if boss and bossAssets then
			src = bossAssets:FindFirstChild(kind)
		end
		if not src and enemyAssets then
			src = enemyAssets:FindFirstChild(kind)
		end
	end
	local mul = sizeMul(src)
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
		-- On Low, strip any VFX/lights baked into the monster model (these are tablet cost).
		-- NOTE: we do NOT force RenderFidelity here -- Performance fidelity makes some
		-- high-detail meshes render invisible/broken, and default already LODs at distance.
		local low = Quality.level == "low"
		for _, d in model:GetDescendants() do
			if d:IsA("BasePart") then
				d.Anchored = true
				d.CanCollide = false
				d.CastShadow = false
			elseif low then
				if d:IsA("ParticleEmitter") or d:IsA("Trail") or d:IsA("Beam") or d:IsA("Fire") or d:IsA("Smoke") or d:IsA("Sparkles") then
					d.Enabled = false
				elseif d:IsA("Light") then
					d:Destroy()
				end
			end
		end
		if not model.PrimaryPart then
			model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart", true) -- recursive
		end
		if model.PrimaryPart then
			if boss then
				normalizeTo(model, BOSS_SIZE * mul) -- guaranteed-big, ignores mesh scale
			elseif mul ~= 1 then
				model:ScaleTo(mul) -- regulars keep Studio size + optional SizeMul tweak
			end
			return model, model.PrimaryPart :: BasePart, longestAxis(model) * 0.5
		end
		model:Destroy() -- no usable part; use the placeholder instead
	end
	local dm, dr = buildDummy(if boss then 3 else 1, boss)
	if boss then
		normalizeTo(dm, BOSS_SIZE) -- keep the boss placeholder big too
	end
	return dm, dr, longestAxis(dm) * 0.5
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

	type Rec = { id: number, model: Model, root: BasePart, current: CFrame, target: CFrame, lastPos: Vector3, boss: boolean, radius: number, faceFix: CFrame, highlight: Highlight, status: number, shield: BasePart? }
	local byId: { [number]: Rec } = {}

	-- Formation-core shield bubble: a translucent ForceField sphere while invulnerable.
	local function applyShield(r: Rec, sh: boolean)
		if sh and not r.shield then
			local b = Instance.new("Part")
			b.Shape = Enum.PartType.Ball
			b.Anchored = true
			b.CanCollide = false
			b.CastShadow = false
			b.Material = Enum.Material.ForceField
			b.Color = Color3.fromRGB(120, 200, 255)
			b.Transparency = 0.4
			local d = r.radius * 2.6
			b.Size = Vector3.new(d, d, d)
			b.Parent = container
			r.shield = b
		elseif not sh and r.shield then
			r.shield:Destroy()
			r.shield = nil
		end
	end

	-- Tint an enemy by its status bitmask (1 = frozen, 2 = burning, 4 = wet).
	local function applyStatus(r: Rec, st: number)
		if not Quality.highlights() then
			return -- skip per-enemy status Highlights below High quality
		end
		if st == r.status then
			return
		end
		r.status = st
		local h = r.highlight
		if bit32.band(st, 1) ~= 0 then -- frozen (cyan)
			h.FillColor = Color3.fromRGB(120, 210, 255)
			h.FillTransparency = 0.45
			h.OutlineColor = Color3.fromRGB(180, 235, 255)
			h.OutlineTransparency = 0.2
		elseif bit32.band(st, 2) ~= 0 then -- burning (orange)
			h.FillColor = Color3.fromRGB(255, 130, 40)
			h.FillTransparency = 0.55
			h.OutlineColor = Color3.fromRGB(255, 170, 60)
			h.OutlineTransparency = 0.3
		elseif bit32.band(st, 4) ~= 0 then -- wet (blue sheen)
			h.FillColor = Color3.fromRGB(60, 120, 230)
			h.FillTransparency = 0.7
			h.OutlineTransparency = 1
		else -- clear
			h.FillTransparency = 1
			h.OutlineTransparency = 1
		end
	end

	local function ensure(id: number, kind: string, boss: boolean, cf: CFrame): Rec
		local r = byId[id]
		if r then
			return r
		end
		local model, root, radius = buildEnemy(kind, boss)
		-- Orientation: the game turns the enemy to face you, so we start from however
		-- you've ROTATED the model in Studio (in Assets/Enemies or /Bosses) as its rest
		-- pose, then apply optional attribute fine-tune. So: just rotate the model in
		-- Studio until it stands upright facing -Z (forward) and it'll face the player.
		-- Fine-tune attributes (degrees) if needed: YawOffset / PitchOffset / RollOffset.
		local function deg(attr: string): number
			local a = model:GetAttribute(attr)
			return if typeof(a) == "number" then math.rad(a) else 0
		end
		local authored = model:GetPivot().Rotation -- whatever you set it to in Studio
		local faceFix = authored * CFrame.Angles(deg("PitchOffset"), deg("YawOffset"), deg("RollOffset"))
		model:PivotTo(cf)
		model.Parent = container
		local highlight = Instance.new("Highlight")
		highlight.DepthMode = Enum.HighlightDepthMode.Occluded
		highlight.FillTransparency = 1
		highlight.OutlineTransparency = 1
		highlight.Adornee = model
		highlight.Parent = model
		r = {
			id = id,
			model = model,
			root = root,
			current = cf,
			target = cf,
			lastPos = cf.Position,
			boss = boss,
			radius = radius,
			faceFix = faceFix,
			highlight = highlight,
			status = -1, -- force first applyStatus to set it
			shield = nil,
		}
		byId[id] = r
		-- Roar on spawn, then every few seconds while alive (so you hear them as they
		-- close in). The random first delay spreads a whole wave's roars out.
		task.spawn(function()
			task.wait(math.random() * (if boss then 0.4 else 1.5))
			while byId[id] == r and root and root.Parent do
				roar(root, kind)
				task.wait(if boss then 4 + math.random() * 3 else 6 + math.random() * 6)
			end
		end)
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
					applyStatus(r, if type(e.st) == "number" then e.st else 0)
					applyShield(r, e.sh == true)
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
				if r.shield then
					r.shield:Destroy()
				end
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

	-- Enemy projectile visuals (server decides hits; this is just the look). Each
	-- shot is a random projectile object from Assets/Projectiles.
	-- Terrain-collision band limits: ground never rises above GMAX, ceiling never dips
	-- below CMIN, so a bullet between them CAN'T touch terrain and we skip the costly
	-- noise sampling entirely (the big tablet win when lots of bullets are in flight).
	local GMAX = WorldHeights.GROUND_BASE + WorldHeights.GROUND_AMP
	local CMIN = WorldHeights.CEIL_BASE - WorldHeights.CEIL_AMP
	local visualBalls: { { obj: Instance, vel: Vector3, life: number, spin: Vector3, tcheck: number } } = {}
	local function spawnEnemyShot(origin: Vector3, dir: Vector3, speed: number)
		local def = randomProjectileDef()
		local obj: Instance
		if def and Quality.fancyProjectiles() then
			local m = WeaponVisuals.makeProjectile(def, ENEMY_PROJ_SIZE)
			m:PivotTo(CFrame.lookAt(origin, origin + dir)) -- face the way it's fired
			obj = m
		else
			-- Fallback ball. Neon forces a bloom/glow pass per orb, which murders weak
			-- GPUs when a swarm is on screen, so on Low we use a matte (still bright) ball.
			local p = Instance.new("Part")
			p.Shape = Enum.PartType.Ball
			p.Size = Vector3.new(3, 3, 3)
			p.Anchored = true
			p.CanCollide = false
			p.CastShadow = false
			if Quality.level == "low" then
				p.Material = Enum.Material.SmoothPlastic -- no glow = no bloom cost
				p.Color = Color3.fromRGB(210, 150, 255)
			else
				p.Material = Enum.Material.Neon
				p.Color = Color3.fromRGB(180, 120, 255)
			end
			p.CFrame = CFrame.new(origin)
			obj = p
		end
		obj.Parent = container -- destroyed with the battle on teardown
		table.insert(visualBalls, {
			obj = obj,
			vel = dir * speed,
			life = 4,
			spin = Vector3.new(math.random(-3, 3), math.random(-3, 3), math.random(-3, 3)),
			tcheck = 0,
		})
	end
	enemyFired.OnClientEvent:Connect(function(origin, dir, speed)
		if BattleSession.gen ~= gen then
			return
		end
		spawnEnemyShot(origin, dir, speed)
	end)

	RunService.RenderStepped:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		-- Interpolate enemies toward their latest server transform.
		for _, r in byId do
			r.current = r.current:Lerp(r.target, math.clamp(dt * 12, 0, 1))
			r.lastPos = r.current.Position
			-- Keep enemies upright and turn to face the player by YAW only, so tall
			-- bosses (pointed at a player flying overhead) don't tip over sideways.
			local look = r.current.LookVector
			local flat = Vector3.new(look.X, 0, look.Z)
			local facing = if flat.Magnitude > 0.001
				then CFrame.lookAt(r.lastPos, r.lastPos + flat)
				else CFrame.new(r.lastPos)
			r.model:PivotTo(facing * r.faceFix)
			if r.shield then
				r.shield.CFrame = CFrame.new(r.lastPos) -- keep the bubble on the core
			end
		end
		-- Move enemy projectile visuals.
		for i = #visualBalls, 1, -1 do
			local b = visualBalls[i]
			b.life -= dt
			local pv = b.obj :: PVInstance
			local cf = pv:GetPivot() + b.vel * dt -- translate, keep facing the travel dir
			cf *= CFrame.Angles(b.spin.X * dt, b.spin.Y * dt, b.spin.Z * dt) -- gentle tumble
			pv:PivotTo(cf)
			local p = cf.Position
			-- Cheap terrain test: only sample the expensive height noise when the bullet
			-- is actually within a terrain band, and at most ~12x/sec per bullet.
			local hitTerrain = false
			b.tcheck -= dt
			if b.tcheck <= 0 then
				b.tcheck = 0.08
				if p.Y < GMAX then
					hitTerrain = p.Y < WorldHeights.groundY(p.X, p.Z)
				end
				if not hitTerrain and p.Y > CMIN then
					hitTerrain = p.Y > WorldHeights.ceilY(p.X, p.Z)
				end
			end
			local hitShip = (ShipState.position - p).Magnitude <= 13
			if hitShip or hitTerrain then
				Explosion.burst(p) -- layered blast on impact
			end
			if b.life <= 0 or hitTerrain or hitShip then
				WeaponVisuals.clearEffects(b.obj) -- stop smoke/fire so it doesn't linger
				b.obj:Destroy()
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
