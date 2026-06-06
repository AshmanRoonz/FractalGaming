--!strict
-- Catch-and-throw shield. Hold the trigger (gamepad L2 / right mouse / touch SHIELD
-- button) to raise an energy vortex in front of the ship: you can't shoot, but enemy
-- projectiles get sucked in and stored (EnemyController does the capture; the server
-- stops them damaging you). Release to hurl everything you caught back as a shotgun
-- spread. A power bar drains while held (like the dash boost) so you can't hold forever.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local SoundService = game:GetService("SoundService")

local ShipState = require(script.Parent.ShipState)
local EnemyController = require(script.Parent.EnemyController)
local BattleSession = require(script.Parent.BattleSession)
local Sfx = require(ReplicatedStorage.Shared.Sfx)
local Explosion = require(ReplicatedStorage.Shared.Explosion)

local ShieldController = {}

local SHIELD_MAX = 100
local SHIELD_DRAIN = 32 -- per second while held
local SHIELD_RECHARGE = 16 -- per second while down
local SHIELD_RECOVER = 0.35 -- fraction it must refill to before use after a full drain

local THROW_DMG = 30 -- damage each thrown object does
local THROW_SPEED = 280
local THROW_LIFE = 1.3
local THROW_SPREAD = math.rad(26) -- half-angle of the shotgun cone
local PELLET_HIT = 7

function ShieldController.start()
	local gen = BattleSession.gen
	local player = Players.LocalPlayer

	ShipState.shielding = false
	ShipState.shieldCaught = {}

	-- ---- HUD: power bar + caught counter ---------------------------------
	local hud = Instance.new("ScreenGui")
	hud.Name = "ShieldHud"
	hud.IgnoreGuiInset = true
	hud.ResetOnSpawn = false
	hud.Parent = player:WaitForChild("PlayerGui")
	BattleSession.track(hud)

	local barBg = Instance.new("Frame")
	barBg.Position = UDim2.fromOffset(24, 164)
	barBg.Visible = false -- shield now shown as a ring on the crosshair
	barBg.Size = UDim2.fromOffset(220, 10)
	barBg.BackgroundColor3 = Color3.fromRGB(20, 22, 30)
	barBg.BackgroundTransparency = 0.3
	barBg.Parent = hud
	local bgC = Instance.new("UICorner")
	bgC.CornerRadius = UDim.new(0.5, 0)
	bgC.Parent = barBg
	local barFill = Instance.new("Frame")
	barFill.Size = UDim2.fromScale(1, 1)
	barFill.BackgroundColor3 = Color3.fromRGB(90, 220, 255)
	barFill.BorderSizePixel = 0
	barFill.Parent = barBg
	local fillC = Instance.new("UICorner")
	fillC.CornerRadius = UDim.new(0.5, 0)
	fillC.Parent = barFill
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextSize = 11
	label.TextColor3 = Color3.fromRGB(255, 255, 255)
	label.Text = "SHIELD"
	label.Parent = barBg

	-- ---- Input: hold to shield -------------------------------------------
	local held = false
	UserInputService.InputBegan:Connect(function(input, gpe)
		if gpe or BattleSession.gen ~= gen then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton2 or input.KeyCode == Enum.KeyCode.ButtonL2 then
			held = true
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if BattleSession.gen ~= gen then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton2 or input.KeyCode == Enum.KeyCode.ButtonL2 then
			held = false
		end
	end)

	-- Touch SHIELD button (above the BOMB/FIRE stack on the right).
	local touchHeld = false
	local shieldBtn: TextButton? = nil
	if UserInputService.TouchEnabled then
		local gui = Instance.new("ScreenGui")
		gui.Name = "ShieldControls"
		gui.IgnoreGuiInset = true
		gui.ResetOnSpawn = false
		gui.Parent = player:WaitForChild("PlayerGui")
		BattleSession.track(gui)
		local btn = Instance.new("TextButton")
		btn.Size = UDim2.fromOffset(96, 76)
		btn.AnchorPoint = Vector2.new(0, 0.5)
		btn.Position = UDim2.new(0, 16, 0.5, 0) -- middle-left of the screen
		btn.BackgroundColor3 = Color3.fromRGB(70, 150, 220)
		btn.BackgroundTransparency = 0.25
		btn.TextColor3 = Color3.fromRGB(255, 255, 255)
		btn.TextScaled = true
		btn.Text = "SHIELD"
		btn.Parent = gui
		shieldBtn = btn
		local c = Instance.new("UICorner")
		c.CornerRadius = UDim.new(0.3, 0)
		c.Parent = btn
		btn.InputBegan:Connect(function(i)
			if i.UserInputType == Enum.UserInputType.Touch then
				touchHeld = true
			end
		end)
		btn.InputEnded:Connect(function(i)
			if i.UserInputType == Enum.UserInputType.Touch then
				touchHeld = false
			end
		end)
	end

	-- ---- Thrown pellets (the caught objects themselves) -------------------
	local pellets: { { obj: Instance, vel: Vector3, life: number, dmg: number } } = {}
	local function throwBack()
		local caught = ShipState.shieldCaught
		ShipState.shieldCaught = {}
		if #caught == 0 then
			return
		end
		local fwd = ShipState.forward
		for _, obj in caught do
			local yaw = (math.random() - 0.5) * 2 * THROW_SPREAD
			local pitch = (math.random() - 0.5) * 2 * THROW_SPREAD
			local dir = (CFrame.lookAt(Vector3.zero, fwd) * CFrame.Angles(pitch, yaw, 0)).LookVector
			local pv = obj :: PVInstance
			pv:PivotTo(CFrame.lookAt(pv:GetPivot().Position, pv:GetPivot().Position + dir)) -- face the throw
			table.insert(pellets, { obj = obj, vel = dir * THROW_SPEED, life = THROW_LIFE, dmg = THROW_DMG })
		end
		Sfx.play("shieldLaunch")
	end

	-- Controllable charge sound (so the release can interrupt it). Cloned from the Sound
	-- named "shieldCharge" in Assets/Sound; nil if you haven't added one.
	local chargeSound: Sound? = nil
	do
		local assets = ReplicatedStorage:FindFirstChild("Assets")
		local folder = assets and assets:FindFirstChild("Sound")
		local tmpl = folder and folder:FindFirstChild("shieldCharge")
		if tmpl and tmpl:IsA("Sound") then
			local s = tmpl:Clone()
			s.Looped = false
			s.Parent = SoundService
			chargeSound = s
			BattleSession.track(s)
		end
	end

	-- ---- Per-frame: power, state, pellet motion ---------------------------
	local energy = SHIELD_MAX
	local depleted = false
	local lockUntilRelease = false -- after a full drain, must let go before shielding again
	local wasShielding = false
	RunService.RenderStepped:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		local input = (held or touchHeld) and ShipState.health > 0
		if not input then
			lockUntilRelease = false -- you let go; shield can engage again
		end
		local want = input and not depleted and not lockUntilRelease
		if want then
			energy -= SHIELD_DRAIN * dt
			if energy <= 0 then
				energy = 0
				depleted = true
				lockUntilRelease = true -- don't auto re-charge while still holding
			end
		else
			energy = math.min(SHIELD_MAX, energy + SHIELD_RECHARGE * dt)
			if depleted and energy >= SHIELD_MAX * SHIELD_RECOVER then
				depleted = false
			end
		end
		local shielding = want and energy > 0
		ShipState.shielding = shielding
		ShipState.shieldFrac = energy / SHIELD_MAX
		if shieldBtn then
			(shieldBtn :: TextButton).BackgroundTransparency = 0.6 - 0.45 * math.clamp(energy / SHIELD_MAX, 0, 1)
		end

		-- Raise edge: start the charge-up sound.
		if shielding and not wasShielding then
			if chargeSound then
				chargeSound.TimePosition = 0
				chargeSound:Play()
			end
		end
		-- Release edge (or ran out): cut the charge sound and hurl the caught shots back.
		if wasShielding and not shielding then
			if chargeSound then
				chargeSound:Stop()
			end
			throwBack() -- plays shieldLaunch if anything was caught
		end
		wasShielding = shielding

		-- Orbit the actual caught objects around the ship while the shield is up.
		if shielding then
			local caught = ShipState.shieldCaught
			local n = #caught
			local center = ShipState.position + ShipState.forward * 8
			local radius = 9 + n * 0.25
			local now = os.clock()
			for idx, obj in caught do
				local ang = now * 2.2 + idx * (2 * math.pi / math.max(1, n))
				local off = Vector3.new(math.cos(ang) * radius, math.sin(ang * 1.6) * 3, math.sin(ang) * radius)
				;(obj :: PVInstance):PivotTo(CFrame.new(center + off) * CFrame.Angles(ang, ang * 0.7, 0))
			end
		end

		-- Bar: cyan when ready, dim/red while locked out.
		barFill.Size = UDim2.fromScale(math.max(0, energy / SHIELD_MAX), 1)
		barFill.BackgroundColor3 = if depleted
			then Color3.fromRGB(120, 90, 90)
			else Color3.fromRGB(90, 220, 255)
		local nc = #ShipState.shieldCaught
		label.Text = if nc > 0 then `SHIELD  +{nc}` else "SHIELD"

		-- Move thrown pellets (the caught objects); damage the first enemy each hits.
		for i = #pellets, 1, -1 do
			local pr = pellets[i]
			pr.life -= dt
			local pv = pr.obj :: PVInstance
			pv:PivotTo(pv:GetPivot() + pr.vel * dt)
			local p = pv:GetPivot().Position
			local hit = nil
			for _, e in EnemyController.enemies do
				if e.root and (e.root.Position - p).Magnitude <= (e.radius or 12) + PELLET_HIT then
					hit = e
					break
				end
			end
			if hit then
				EnemyController.damage(hit, pr.dmg)
				Explosion.burst(p)
				pr.obj:Destroy()
				table.remove(pellets, i)
			elseif pr.life <= 0 then
				pr.obj:Destroy()
				table.remove(pellets, i)
			end
		end
	end)

	BattleSession.onCleanup(function()
		ShipState.shielding = false
		for _, obj in ShipState.shieldCaught do
			pcall(function()
				obj:Destroy()
			end)
		end
		ShipState.shieldCaught = {}
	end)
end

return ShieldController
