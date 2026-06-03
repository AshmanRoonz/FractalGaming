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

local function findById(list: any, id: string): any
	for _, d in list do
		if d.id == id then
			return d
		end
	end
	return list[1]
end

-- Resolve a named object in Assets/Objects to its mesh + texture ids.
local objectsFolder = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Objects")
local function resolveObject(name: string?): (string?, string?)
	if not objectsFolder or not name then
		return nil, nil
	end
	local inst = objectsFolder:FindFirstChild(name)
	if not inst then
		return nil, nil
	end
	local mp = if inst:IsA("MeshPart") then inst else inst:FindFirstChildWhichIsA("MeshPart")
	if mp then
		return (mp :: MeshPart).MeshId, (mp :: MeshPart).TextureID
	end
	return nil, nil
end

-- Make a Part look like the weapon's object: a real mesh (named in Assets/Objects
-- or a meshId) if given, otherwise a plain shape. SmoothPlastic so it's readable.
local function styleObject(part: Part, def: any)
	part.Material = Enum.Material.SmoothPlastic
	part.Color = def.color
	part.Size = Vector3.new(def.size, def.size, def.size)
	local meshId, texId = resolveObject(def.object)
	meshId = meshId or def.meshId
	if meshId then
		local m = Instance.new("SpecialMesh")
		m.MeshType = Enum.MeshType.FileMesh
		m.MeshId = meshId
		m.TextureId = texId or def.textureId or ""
		local sc = def.meshScale or 1
		m.Scale = Vector3.new(sc, sc, sc)
		m.Parent = part
	else
		part.Shape = def.shape
	end
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
	local mainCfg = findById(MainWeapons, mainId or "candy")
	local secCfg = findById(SecondaryWeapons, secId or "ball")
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
	local segPool: { BasePart } = {}
	local function getSeg(i: number): BasePart
		local s = segPool[i]
		if not s then
			s = Instance.new("Part")
			s.Anchored = true
			s.CanCollide = false
			s.CastShadow = false
			styleObject(s, mainCfg)
			s.Transparency = 1
			s.Parent = segFolder
			segPool[i] = s
		end
		return s
	end
	local function hideSegmentsFrom(n: number)
		for i = n + 1, #segPool do
			segPool[i].Transparency = 1
		end
	end
	-- Stack objects evenly along origin->hit; returns how many were used.
	local function drawLaser(from: Vector3, to: Vector3): number
		local d = to - from
		local dist = d.Magnitude
		if dist < 0.1 then
			return 0
		end
		local count = math.clamp(math.floor(dist / mainCfg.spacing), 1, MAX_SEG)
		for i = 1, count do
			local s = getSeg(i)
			s.CFrame = CFrame.new(from + d * ((i - 0.5) / count))
			s.Transparency = 0
		end
		return count
	end

	-- Secondary input state (touch button / mouse / gamepad trigger).
	local secondaryHeld = false
	local lastFire = 0
	local beamTimer = 0 -- throttles beam damage reports to the server
	local projectiles: { { part: BasePart, vel: Vector3, life: number } } = {}

	-- ---- Kill count + big bomb -------------------------------------------
	local killEvent = ReplicatedStorage:WaitForChild("Kill")
	local killCount = 0
	local charge = 0 -- 0..100
	local lastKill = 0
	local bombs: { { part: BasePart, vel: Vector3, life: number } } = {}

	local bombHud = Instance.new("ScreenGui")
	bombHud.Name = "BombHud"
	bombHud.IgnoreGuiInset = true
	bombHud.ResetOnSpawn = false
	bombHud.Parent = player:WaitForChild("PlayerGui")
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
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.CastShadow = false
		styleObject(p, secCfg)
		p.Size = p.Size * BOMB_SCALE
		local mesh = p:FindFirstChildWhichIsA("SpecialMesh")
		if mesh then
			mesh.Scale = mesh.Scale * BOMB_SCALE
		end
		p.CFrame = CFrame.new(origin)
		p.Parent = workspace
		table.insert(bombs, { part = p, vel = dir * BOMB_SPEED, life = 5 })
	end

	local function tryBomb()
		if charge >= 100 then
			charge = 0
			fireBomb()
		end
	end

	local function fireSecondary()
		local origin, dir = muzzle()
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.CastShadow = false
		styleObject(p, secCfg)
		p.CFrame = CFrame.new(origin)
		p.Parent = workspace
		table.insert(projectiles, { part = p, vel = dir * SECONDARY_SPEED, life = SECONDARY_LIFE })
		if playerFired then
			(playerFired :: any):FireServer(origin, dir) -- show this shot to others
		end
	end

	UserInputService.InputBegan:Connect(function(input, gpe)
		if gpe then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.KeyCode == Enum.KeyCode.ButtonR2 then
			secondaryHeld = true
		elseif input.KeyCode == Enum.KeyCode.F or input.KeyCode == Enum.KeyCode.ButtonX then
			tryBomb()
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

	RunService.Heartbeat:Connect(function(dt)
		local origin, dir = muzzle()

		-- MAIN: auto-target + beam + damage over time.
		local target = acquireTarget(origin, dir)
		-- Drop the lock if a mountain blocks the line of sight.
		if target and WorldHeights.blocked(origin, target.root.Position) then
			target = nil
		end

		-- Crosshair: project the aim point to the screen; red when locked.
		local sp = camera:WorldToViewportPoint(origin + dir * AIM_DIST)
		ring.Visible = sp.Z > 0
		ring.Position = UDim2.fromOffset(sp.X, sp.Y)
		local rc = if target then Color3.fromRGB(255, 80, 80) else Color3.fromRGB(255, 255, 255)
		ringStroke.Color = rc
		dot.BackgroundColor3 = rc

		ShipState.beamHit = if target then target.root.Position else nil -- replicate beam

		if target then
			hideSegmentsFrom(drawLaser(origin, target.root.Position))
			-- Report accumulated beam damage ~10x/sec instead of every frame.
			beamTimer += dt
			if beamTimer >= 0.1 then
				EnemyController.damage(target, MAIN_DPS * beamTimer)
				beamTimer = 0
			end
		else
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
			pr.part.CFrame = pr.part.CFrame + pr.vel * dt
			local p = pr.part.Position
			local hitTerrain = p.Y < WorldHeights.groundY(p.X, p.Z) or p.Y > WorldHeights.ceilY(p.X, p.Z)
			local hitEnemy = nil
			for _, e in EnemyController.enemies do
				if e.root and (e.root.Position - p).Magnitude <= (e.radius or SECONDARY_HIT) then
					hitEnemy = e
					break
				end
			end
			if hitEnemy or hitTerrain then
				Explosion.burst(p)
				if hitEnemy then
					EnemyController.damage(hitEnemy, SECONDARY_DMG)
				end
				pr.part:Destroy()
				table.remove(projectiles, i)
			elseif pr.life <= 0 then
				pr.part:Destroy()
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
			b.part.CFrame = b.part.CFrame + b.vel * dt
			local pos = b.part.Position
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
				for _, e in EnemyController.enemies do
					if e.root and (e.root.Position - pos).Magnitude <= BOMB_RADIUS then
						EnemyController.damage(e, BOMB_DAMAGE)
					end
				end
				b.part:Destroy()
				table.remove(bombs, i)
			end
		end
	end)
end

return WeaponController
