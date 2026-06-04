--!strict
-- Renders the local ship and flies it with full free 3D control (you can turn
-- around, climb, dive). The tunnel is drawn around wherever you fly (see
-- TunnelController), so you're always inside a tube without being on rails.
--
-- Controls (touch == gamepad layout):
--   LEFT stick / WASD   -> move: forward/back + strafe (relative to heading)
--   UP / DOWN buttons / Space + Shift -> rise / sink
--   RIGHT stick / arrows -> turn heading (yaw) and pitch -- this is how you
--                           steer and turn around
--
-- LOCAL prototype. Server-authoritative movement comes later.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")

local ShipTemplate = require(ReplicatedStorage.Shared.Templates.ShipTemplate)
local ShipState = require(script.Parent.ShipState)
local TerrainController = require(script.Parent.TerrainController)
local BattleSession = require(script.Parent.BattleSession)

local ShipController = {}

local SHIP_MARGIN = 9 -- keep the ship this far off the terrain surfaces

-- Tuning.
local MOVE_SPEED = 90 -- studs/sec forward/back/strafe
local VERT_SPEED = 110 -- studs/sec rise/sink
local YAW_RATE = math.rad(130) -- how fast the right stick turns the heading
local PITCH_RATE = math.rad(95)
local MOUSE_SENS = 0.006 -- radians of turn per pixel of mouse movement
local MAX_PITCH = math.rad(80) -- clamp so you can't flip fully over
local MAX_BANK = math.rad(22)
local BOOST_MULT = 2.1 -- speed multiplier while boosting
local BOOST_MAX = 100 -- boost energy
local BOOST_DRAIN = 45 -- energy/sec drained while boosting
local BOOST_RECHARGE = 20 -- energy/sec recharged while not boosting
local BASE_FOV, BOOST_FOV = 70, 90 -- camera widens while boosting for speed feel
local ROLL_DODGE = 115 -- studs/sec sideways push during a barrel roll (left/right)
local CAM_DIST = 26
local CAM_HEIGHT = 8
local TARGET_SHIP_SIZE = 14
local STICK_RADIUS = 90
local DEADZONE = 0.15

local function scaleToSize(model: Model, targetLongestSide: number)
	local size = model:GetExtentsSize()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 0 then
		model:ScaleTo(targetLongestSide / longest)
	end
end

local function keyAxis(neg: { Enum.KeyCode }, pos: { Enum.KeyCode }): number
	local v = 0
	for _, k in neg do
		if UserInputService:IsKeyDown(k) then
			v -= 1
		end
	end
	for _, k in pos do
		if UserInputService:IsKeyDown(k) then
			v += 1
		end
	end
	return v
end

local function gamepadStick(which: Enum.KeyCode): Vector2
	local pads = UserInputService:GetConnectedGamepads()
	if #pads == 0 then
		return Vector2.zero
	end
	for _, obj in UserInputService:GetGamepadState(pads[1]) do
		if obj.KeyCode == which then
			local x = if math.abs(obj.Position.X) > DEADZONE then obj.Position.X else 0
			local y = if math.abs(obj.Position.Y) > DEADZONE then obj.Position.Y else 0
			return Vector2.new(x, y)
		end
	end
	return Vector2.zero
end

function ShipController.start(shipId: string?)
	local gen = BattleSession.gen
	local player = Players.LocalPlayer
	local camera = workspace.CurrentCamera
	camera.CameraType = Enum.CameraType.Scriptable

	-- Always launch at full health (death leaves it at 0).
	ShipState.health = ShipState.maxHealth
	ShipState.invulnUntil = 0
	ShipState.lastHit = 0
	ShipState.beamHit = nil

	-- Mouse-look on desktop: lock the cursor and steer with mouse movement.
	local mouseLook = UserInputService.MouseEnabled and not UserInputService.TouchEnabled
	local mouseUnlocked = false -- Tab toggles this to free the cursor for clicking

	-- On return-to-hangar, hand the camera + mouse back to the character.
	BattleSession.onCleanup(function()
		camera.CameraType = Enum.CameraType.Custom
		camera.FieldOfView = BASE_FOV
		UserInputService.MouseBehavior = Enum.MouseBehavior.Default
		UserInputService.MouseIconEnabled = true
	end)

	local ship = ShipTemplate.new(shipId or "starter_skiff")
	local model = ship.model
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") then
			part.Anchored = true
			part.CanCollide = false
		end
	end
	scaleToSize(model, TARGET_SHIP_SIZE)
	model.Parent = workspace
	BattleSession.track(model)
	local modelYaw = CFrame.Angles(0, math.rad(ship.def.modelYawOffset or 0), 0)

	-- Keep the ship lit no matter the sun angle (the mesh is dark).
	local light = Instance.new("PointLight")
	light.Brightness = 2.5
	light.Range = 45
	light.Color = Color3.fromRGB(255, 244, 224)
	light.Parent = ship.root

	-- Spark burst emitted whenever the ship takes a hit.
	local hitSparks = Instance.new("ParticleEmitter")
	hitSparks.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	hitSparks.Rate = 0
	hitSparks.Lifetime = NumberRange.new(0.25, 0.5)
	hitSparks.Speed = NumberRange.new(25, 60)
	hitSparks.SpreadAngle = Vector2.new(180, 180)
	hitSparks.Color = ColorSequence.new(Color3.fromRGB(255, 200, 90), Color3.fromRGB(255, 70, 40))
	hitSparks.Size = NumberSequence.new(1.4, 0.1)
	hitSparks.Transparency = NumberSequence.new(0.1, 1)
	hitSparks.LightEmission = 1
	hitSparks.Parent = ship.root

	-- Lift the scene's ambient so nothing reads pitch-black.
	Lighting.Ambient = Color3.fromRGB(95, 98, 110)
	Lighting.OutdoorAmbient = Color3.fromRGB(150, 155, 170)
	Lighting.Brightness = 3
	Lighting.ExposureCompensation = 0.25

	-- ---- Barrel roll (Star Fox style; doubles as a dodge) ------------------
	local ROLL_DURATION = 0.5
	local ROLL_COOLDOWN = 0.7
	local rolling = false
	local rollT = 0
	local rollDir = 1
	local lastRoll = -10
	local function triggerRoll(dir: number)
		if rolling or os.clock() - lastRoll < ROLL_COOLDOWN then
			return
		end
		rolling, rollT, rollDir, lastRoll = true, 0, dir, os.clock()
		ShipState.invulnUntil = os.clock() + ROLL_DURATION -- i-frames during the roll
	end
	UserInputService.InputBegan:Connect(function(input, gpe)
		if gpe or BattleSession.gen ~= gen then
			return
		end
		if input.KeyCode == Enum.KeyCode.ButtonL1 or input.KeyCode == Enum.KeyCode.Q then
			triggerRoll(-1)
		elseif input.KeyCode == Enum.KeyCode.ButtonR1 or input.KeyCode == Enum.KeyCode.E then
			triggerRoll(1)
		elseif input.KeyCode == Enum.KeyCode.Tab then
			mouseUnlocked = not mouseUnlocked -- free / re-lock the cursor
		end
	end)

	-- ---- Touch UI (only on touch devices) ----------------------------------
	local touchMove, touchLook = Vector2.zero, Vector2.zero
	local touchUp, touchDown, touchBoost = false, false, false

	if UserInputService.TouchEnabled then
		local gui = Instance.new("ScreenGui")
		gui.Name = "FlightTouchControls"
		gui.IgnoreGuiInset = true
		gui.ResetOnSpawn = false
		gui.Parent = player:WaitForChild("PlayerGui")
		BattleSession.track(gui)

		local function makeStick(minX: number, maxX: number): () -> Vector2
			local base = Instance.new("Frame")
			base.Size = UDim2.fromOffset(STICK_RADIUS * 2, STICK_RADIUS * 2)
			base.AnchorPoint = Vector2.new(0.5, 0.5)
			base.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
			base.BackgroundTransparency = 0.75
			base.Visible = false
			base.Parent = gui
			local bc = Instance.new("UICorner")
			bc.CornerRadius = UDim.new(1, 0)
			bc.Parent = base

			local knob = Instance.new("Frame")
			knob.Size = UDim2.fromOffset(STICK_RADIUS, STICK_RADIUS)
			knob.AnchorPoint = Vector2.new(0.5, 0.5)
			knob.Position = UDim2.fromScale(0.5, 0.5)
			knob.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
			knob.BackgroundTransparency = 0.45
			knob.Parent = base
			local kc = Instance.new("UICorner")
			kc.CornerRadius = UDim.new(1, 0)
			kc.Parent = knob

			local active: InputObject? = nil
			local origin = Vector2.zero
			local value = Vector2.zero

			UserInputService.TouchStarted:Connect(function(touch, processed)
				if processed or active or BattleSession.gen ~= gen then
					return
				end
				local frac = touch.Position.X / camera.ViewportSize.X
				if frac < minX or frac >= maxX then
					return
				end
				active = touch
				origin = Vector2.new(touch.Position.X, touch.Position.Y)
				base.Position = UDim2.fromOffset(origin.X, origin.Y)
				knob.Position = UDim2.fromScale(0.5, 0.5)
				base.Visible = true
			end)
			UserInputService.TouchMoved:Connect(function(touch)
				if touch ~= active or BattleSession.gen ~= gen then
					return
				end
				local d = Vector2.new(touch.Position.X, touch.Position.Y) - origin
				if d.Magnitude > STICK_RADIUS then
					d = d.Unit * STICK_RADIUS
				end
				knob.Position = UDim2.new(0.5, d.X, 0.5, d.Y)
				value = d / STICK_RADIUS
			end)
			UserInputService.TouchEnded:Connect(function(touch)
				if touch ~= active or BattleSession.gen ~= gen then
					return
				end
				active = nil
				base.Visible = false
				value = Vector2.zero
			end)

			return function()
				return value
			end
		end

		local getMove = makeStick(0, 0.5)
		local getLook = makeStick(0.5, 1)

		local function makeButton(text: string, yOffset: number, onHold: (boolean) -> ())
			local btn = Instance.new("TextButton")
			btn.Size = UDim2.fromOffset(90, 90)
			btn.AnchorPoint = Vector2.new(1, 1)
			btn.Position = UDim2.new(1, -30, 1, yOffset)
			btn.BackgroundColor3 = Color3.fromRGB(40, 50, 70)
			btn.BackgroundTransparency = 0.3
			btn.TextColor3 = Color3.fromRGB(255, 255, 255)
			btn.TextScaled = true
			btn.Text = text
			btn.Parent = gui
			local c = Instance.new("UICorner")
			c.CornerRadius = UDim.new(0.2, 0)
			c.Parent = btn
			btn.InputBegan:Connect(function(i)
				if i.UserInputType == Enum.UserInputType.Touch or i.UserInputType == Enum.UserInputType.MouseButton1 then
					onHold(true)
				end
			end)
			btn.InputEnded:Connect(function(i)
				if i.UserInputType == Enum.UserInputType.Touch or i.UserInputType == Enum.UserInputType.MouseButton1 then
					onHold(false)
				end
			end)
		end

		makeButton("UP", -130, function(held)
			touchUp = held
		end)
		makeButton("DN", -30, function(held)
			touchDown = held
		end)
		makeButton("BOOST", -230, function(held)
			touchBoost = held
		end)

		-- Roll buttons (bottom center, clear of the sticks).
		local function makeRoll(text: string, xOffset: number, dir: number)
			local b = Instance.new("TextButton")
			b.Size = UDim2.fromOffset(84, 84)
			b.AnchorPoint = Vector2.new(0.5, 1)
			b.Position = UDim2.new(0.5, xOffset, 1, -26)
			b.BackgroundColor3 = Color3.fromRGB(70, 95, 160)
			b.BackgroundTransparency = 0.3
			b.TextColor3 = Color3.fromRGB(255, 255, 255)
			b.TextScaled = true
			b.Text = text
			b.Parent = gui
			local c = Instance.new("UICorner")
			c.CornerRadius = UDim.new(1, 0)
			c.Parent = b
			b.InputBegan:Connect(function(i)
				if i.UserInputType == Enum.UserInputType.Touch then
					triggerRoll(dir)
				end
			end)
		end
		makeRoll("\u{21BA}", -120, -1) -- left roll
		makeRoll("\u{21BB}", 120, 1) -- right roll

		RunService.RenderStepped:Connect(function()
			if BattleSession.gen ~= gen then
				return
			end
			touchMove = getMove()
			touchLook = getLook()
		end)
	end

	-- ---- Health HUD --------------------------------------------------------
	local hud = Instance.new("ScreenGui")
	hud.Name = "HealthHud"
	hud.IgnoreGuiInset = true
	hud.ResetOnSpawn = false
	hud.Parent = player:WaitForChild("PlayerGui")
	BattleSession.track(hud)

	local barBg = Instance.new("Frame")
	barBg.AnchorPoint = Vector2.new(0, 0)
	barBg.Position = UDim2.fromOffset(24, 24)
	barBg.Size = UDim2.fromOffset(320, 26)
	barBg.BackgroundColor3 = Color3.fromRGB(20, 22, 30)
	barBg.BackgroundTransparency = 0.25
	barBg.Parent = hud
	local bgCorner = Instance.new("UICorner")
	bgCorner.CornerRadius = UDim.new(0.4, 0)
	bgCorner.Parent = barBg
	local barFill = Instance.new("Frame")
	barFill.Size = UDim2.fromScale(1, 1)
	barFill.BackgroundColor3 = Color3.fromRGB(80, 220, 120)
	barFill.BorderSizePixel = 0
	barFill.Parent = barBg
	local fillCorner = Instance.new("UICorner")
	fillCorner.CornerRadius = UDim.new(0.4, 0)
	fillCorner.Parent = barFill
	local damageFlash = Instance.new("Frame")
	damageFlash.Size = UDim2.fromScale(1, 1)
	damageFlash.BackgroundColor3 = Color3.fromRGB(255, 40, 40)
	damageFlash.BackgroundTransparency = 1
	damageFlash.ZIndex = 5
	damageFlash.Parent = hud

	-- Boost energy bar (thin, under the health bar).
	local boostBg = Instance.new("Frame")
	boostBg.Position = UDim2.fromOffset(24, 52)
	boostBg.Size = UDim2.fromOffset(320, 6)
	boostBg.BackgroundColor3 = Color3.fromRGB(20, 22, 30)
	boostBg.BackgroundTransparency = 0.3
	boostBg.Parent = hud
	local boostBgC = Instance.new("UICorner")
	boostBgC.CornerRadius = UDim.new(0.5, 0)
	boostBgC.Parent = boostBg
	local boostFill = Instance.new("Frame")
	boostFill.Size = UDim2.fromScale(1, 1)
	boostFill.BackgroundColor3 = Color3.fromRGB(90, 200, 255)
	boostFill.BorderSizePixel = 0
	boostFill.Parent = boostBg
	local boostFillC = Instance.new("UICorner")
	boostFillC.CornerRadius = UDim.new(0.5, 0)
	boostFillC.Parent = boostFill

	local REGEN_DELAY = 4 -- seconds after a hit before health regenerates
	local REGEN_RATE = 9 -- health per second
	local prevHealth = ShipState.health

	-- Gamepad altitude buttons: A = down, B = up.
	local padUp, padDown = false, false
	UserInputService.InputBegan:Connect(function(input)
		if BattleSession.gen ~= gen then
			return
		end
		if input.KeyCode == Enum.KeyCode.ButtonB then
			padUp = true
		elseif input.KeyCode == Enum.KeyCode.ButtonA then
			padDown = true
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if BattleSession.gen ~= gen then
			return
		end
		if input.KeyCode == Enum.KeyCode.ButtonB then
			padUp = false
		elseif input.KeyCode == Enum.KeyCode.ButtonA then
			padDown = false
		end
	end)

	-- Stream our ship transform to the server for replication (~20 Hz).
	local shipUpdate = ReplicatedStorage:FindFirstChild("ShipUpdate")
	local sendAccum = 0

	-- ---- Free 3D flight ----------------------------------------------------
	local camYaw, camPitch = 0, 0
	local pos = Vector3.new(0, 100, 0) -- spawn in the gap between floor and ceiling
	local boostEnergy = BOOST_MAX

	RunService.RenderStepped:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return -- battle torn down; stop flying
		end
		local padMove = gamepadStick(Enum.KeyCode.Thumbstick1)
		local padLook = gamepadStick(Enum.KeyCode.Thumbstick2)

		local moveFwd = math.clamp(keyAxis({ Enum.KeyCode.S }, { Enum.KeyCode.W }) + (-touchMove.Y) + padMove.Y, -1, 1)
		local moveStrafe = math.clamp(keyAxis({ Enum.KeyCode.A }, { Enum.KeyCode.D }) + touchMove.X + padMove.X, -1, 1)
		local turn = math.clamp(keyAxis({ Enum.KeyCode.Left }, { Enum.KeyCode.Right }) + touchLook.X + padLook.X, -1, 1)
		local pitchIn = math.clamp(keyAxis({ Enum.KeyCode.Up }, { Enum.KeyCode.Down }) + touchLook.Y + (-padLook.Y), -1, 1)

		-- Vertical (Y-axis) movement: touch UP/DN buttons, gamepad A/B, or keys.
		local vert = 0
		if touchUp or padUp or UserInputService:IsKeyDown(Enum.KeyCode.Space) then
			vert += 1
		end
		if touchDown or padDown or UserInputService:IsKeyDown(Enum.KeyCode.LeftControl) then
			vert -= 1
		end

		-- Speed boost: hold Shift / left trigger / BOOST to fly faster while energy
		-- lasts; recharges when off.
		local boostHeld = touchBoost
			or UserInputService:IsKeyDown(Enum.KeyCode.LeftShift)
			or UserInputService:IsKeyDown(Enum.KeyCode.ButtonL2)
		local boosting = boostHeld and boostEnergy > 0 and ShipState.health > 0
		if boosting then
			boostEnergy = math.max(0, boostEnergy - BOOST_DRAIN * dt)
		else
			boostEnergy = math.min(BOOST_MAX, boostEnergy + BOOST_RECHARGE * dt)
		end
		local speedMult = if boosting then BOOST_MULT else 1

		-- Mouse-look: lock the cursor and steer with the mouse while alive; free it
		-- when dead so the death menu is clickable.
		local mouseDX, mouseDY = 0, 0
		if mouseLook then
			if ShipState.health > 0 and not mouseUnlocked then
				UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter
				UserInputService.MouseIconEnabled = false -- hide the center cursor dot
				local md = UserInputService:GetMouseDelta()
				mouseDX = md.X * MOUSE_SENS
				mouseDY = md.Y * MOUSE_SENS
			else
				-- Dead or Tab-unlocked: free cursor for clicking, no steering.
				UserInputService.MouseBehavior = Enum.MouseBehavior.Default
				UserInputService.MouseIconEnabled = true
			end
		end

		-- Right stick / mouse turns the heading (yaw, full 360) and pitches it.
		camYaw -= turn * YAW_RATE * dt + mouseDX
		camPitch = math.clamp(camPitch - pitchIn * PITCH_RATE * dt - mouseDY, -MAX_PITCH, MAX_PITCH)
		local yawCF = CFrame.Angles(0, camYaw, 0) -- horizontal heading
		local lookCF = yawCF * CFrame.Angles(camPitch, 0, 0)

		-- Fly where the nose points (pitch included), so aiming down dives toward
		-- the floor and up climbs; buttons still give pure vertical.
		local worldMove = lookCF.LookVector * moveFwd + lookCF.RightVector * moveStrafe
		pos += (worldMove * MOVE_SPEED * speedMult + Vector3.yAxis * vert * VERT_SPEED) * dt
		-- Barrel-roll dodge: shove the ship sideways in the roll direction.
		if rolling then
			pos += lookCF.RightVector * rollDir * ROLL_DODGE * dt
		end

		-- Stay inside the terrain: clamp altitude between floor and ceiling.
		local floorY = TerrainController.groundY(pos.X, pos.Z) + SHIP_MARGIN
		local ceilingY = TerrainController.ceilY(pos.X, pos.Z) - SHIP_MARGIN
		if ceilingY > floorY then
			pos = Vector3.new(pos.X, math.clamp(pos.Y, floorY, ceilingY), pos.Z)
		end

		-- Barrel roll: spin a full 360 around the forward axis over its duration.
		local rollAngle = 0
		if rolling then
			rollT += dt
			local p = math.clamp(rollT / ROLL_DURATION, 0, 1)
			rollAngle = -rollDir * math.pi * 2 * p
			if p >= 1 then
				rolling = false
			end
		end

		local bank = CFrame.Angles(0, 0, -moveStrafe * MAX_BANK + rollAngle)
		model:PivotTo(CFrame.new(pos) * lookCF * bank * modelYaw)

		-- Publish so the streaming tunnel follows the ship.
		ShipState.position = pos
		ShipState.forward = lookCF.LookVector

		-- Replicate our transform to other players.
		sendAccum += dt
		if shipUpdate and sendAccum >= 0.05 then
			sendAccum = 0
			-- Include the bank/roll so others see us roll; send our beam target.
			shipUpdate:FireServer(CFrame.new(pos) * lookCF * bank, ShipState.beamHit)
		end

		-- Chase camera behind the look direction.
		local camPos = (CFrame.new(pos) * lookCF * CFrame.new(0, CAM_HEIGHT, CAM_DIST)).Position
		local goal = CFrame.lookAt(camPos, pos, Vector3.yAxis)
		camera.CFrame = camera.CFrame:Lerp(goal, math.clamp(dt * 8, 0, 1))

		-- Boost feedback: widen the FOV + update the energy bar.
		local fovTarget = if boosting then BOOST_FOV else BASE_FOV
		camera.FieldOfView = camera.FieldOfView + (fovTarget - camera.FieldOfView) * math.clamp(dt * 6, 0, 1)
		boostFill.Size = UDim2.fromScale(boostEnergy / BOOST_MAX, 1)
		boostFill.BackgroundColor3 = if boosting then Color3.fromRGB(150, 230, 255) else Color3.fromRGB(90, 200, 255)

		-- ---- Health: regen, damage flash, death/respawn --------------------
		if ShipState.health < prevHealth then
			damageFlash.BackgroundTransparency = 0.55 -- flash on taking damage
			hitSparks:Emit(14) -- sparks off the hull
		end
		damageFlash.BackgroundTransparency = math.min(1, damageFlash.BackgroundTransparency + dt * 1.5)

		if ShipState.health <= 0 then
			-- Death is handled by the battle death-watcher (return to hangar);
			-- just hold at zero here, no in-place respawn.
			ShipState.health = 0
		elseif os.clock() - ShipState.lastHit > REGEN_DELAY then
			ShipState.health = math.min(ShipState.maxHealth, ShipState.health + REGEN_RATE * dt)
		end
		prevHealth = ShipState.health

		local frac = ShipState.health / ShipState.maxHealth
		barFill.Size = UDim2.fromScale(math.max(0, frac), 1)
		barFill.BackgroundColor3 = Color3.fromRGB(255, 80, 80):Lerp(Color3.fromRGB(80, 220, 120), frac)
	end)
end

return ShipController
