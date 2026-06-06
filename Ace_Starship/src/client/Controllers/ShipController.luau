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
local EnemyController = require(script.Parent.EnemyController)
local Sfx = require(ReplicatedStorage.Shared.Sfx)

local ShipController = {}

local SHIP_MARGIN = 9 -- keep the ship this far off the terrain surfaces

-- Tuning.
local MOVE_SPEED = 90 -- studs/sec forward/back/strafe
local VERT_SPEED = 110 -- studs/sec rise/sink
local YAW_RATE = math.rad(130) -- how fast the right stick turns the heading
local PITCH_RATE = math.rad(95)
local MOUSE_SENS = 0.006 -- radians of turn per pixel of mouse movement
local TOUCH_LOOK_SENS = 1.4 -- multiplier on touch-stick turn/pitch (higher = more sensitive)
local GYRO_SENS = 1.3 -- multiplier on how hard device tilt steers
-- Calibration: tilt steering reads the accelerometer's gravity vector (physical
-- "down" in the device frame), so one tilt moves one axis with no gimbal mixing,
-- and it survives flipping the phone the other way. If turn/pitch feel SWAPPED on
-- your device flip GYRO_SWAP; if a direction is BACKWARDS flip the matching INVERT;
-- GYRO_DEBUG draws the raw numbers on screen so the mapping can be dialed in by eye.
local GYRO_SWAP = false -- swap which tilt axis is turn vs pitch (flip if they feel reversed)
local GYRO_INVERT_TURN = false
local GYRO_INVERT_PITCH = false -- flipped: tilt forward now moves forward
local GYRO_DEBUG = false -- true = show raw tilt readout to calibrate (turn off once dialed in)
-- Tilt is read from the device LookVector (components in -1..1), not Euler angles,
-- to avoid the pitch/yaw gimbal flip. ~0.5 ≈ a 30-degree tilt = full-speed turn.
local GYRO_TILT_FULL = 0.55 -- tilt (radians, ~31deg) that gives full turn speed
local GYRO_TILT_DEAD = 0.06 -- ignore tiny tilt jitter (radians, ~3deg)
-- Touch controls: tilt-to-move + gesture/tap tuning.
local TILT_MOVE_DEAD = 0.07 -- ignore small tilt (radians)
local TILT_MOVE_FULL = 0.5 -- tilt (radians) for full thrust
local TILT_SWAP = true -- landscape: which tilt axis is forward vs strafe
local TILT_INVERT_FWD = true -- flip if tilting forward moves you backward
local TILT_INVERT_STRAFE = false -- flip if tilting right strafes left
local TOUCH_TAP_MOVE = 16 -- px of finger travel before it counts as a swipe (not a tap)
local TOUCH_DOUBLE_TAP = 0.32 -- s window for a double-tap (bomb)
local TOUCH_TARGET_R = 150 -- px: tap within this of a target -> auto-aim + fire (big-finger friendly)
local TURN_LERP = 7 -- how fast the heading eases to a tapped/turn-button target
local AUTOLEVEL_RATE = 1.4 -- touch: how fast the aim pitch drifts back to the horizon
local AUTOPATH_RATE = 0.9 -- touch: how fast the heading drifts back to the forward path
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

	-- Hide Roblox's default touch controls (jump button + thumbstick) while flying --
	-- they overlap our custom controls. Restored on return to the hangar.
	pcall(function()
		local ps = player:WaitForChild("PlayerScripts", 5)
		local pm = ps and ps:FindFirstChild("PlayerModule")
		if pm then
			local controls = require(pm):GetControls()
			controls:Disable()
			BattleSession.onCleanup(function()
				pcall(function()
					controls:Enable()
				end)
			end)
		end
		-- Belt-and-suspenders: hide the jump button directly if it's present.
		local tg = player.PlayerGui:FindFirstChild("TouchGui")
		local frame = tg and tg:FindFirstChild("TouchControlFrame")
		local jump = frame and frame:FindFirstChild("JumpButton")
		if jump then
			jump.Visible = false
		end
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
		Sfx.play("roll")
	end
	UserInputService.InputBegan:Connect(function(input, gpe)
		if BattleSession.gen ~= gen then
			return
		end
		-- Tab is "game processed" by Roblox (UI nav), so handle it before the gpe
		-- guard or the toggle never fires.
		if input.KeyCode == Enum.KeyCode.Tab then
			mouseUnlocked = not mouseUnlocked -- free / re-lock the cursor
			return
		end
		if gpe then
			return
		end
		if input.KeyCode == Enum.KeyCode.ButtonL1 or input.KeyCode == Enum.KeyCode.Q then
			triggerRoll(-1)
		elseif input.KeyCode == Enum.KeyCode.ButtonR1 or input.KeyCode == Enum.KeyCode.E then
			triggerRoll(1)
		end
	end)

	-- ---- Touch controls --------------------------------------------------
	-- Tilt to move; swipe up/down to thrust vertically; swipe left/right to roll; tap
	-- to aim (and fire if you tapped a target); double-tap for the bomb. Top-row
	-- buttons: shield (left, built by ShieldController), 90/180 turns (centre), boost (right).
	local camYaw, camPitch = 0, 0
	local camYawTarget, camPitchTarget = 0, 0
	local touchBoost = false
	local boostBtn: TextButton? = nil
	local touchVert = 0 -- -1..1 from a vertical drag
	local gravLatest: Vector3? = nil -- gravity (device frame) for tilt-to-move
	local gravRef: Vector3? = nil -- neutral pose captured shortly after launch
	local headingTouch = false -- a tap/turn has set a heading target
	local touchAim = UserInputService.TouchEnabled and not UserInputService.MouseEnabled

	-- Turn the ship toward a world direction the shortest way (used by taps).
	local function aimToward(dir: Vector3)
		local flat = Vector3.new(dir.X, 0, dir.Z)
		if flat.Magnitude > 0.001 then
			local desired = math.atan2(-dir.X, -dir.Z)
			local delta = ((desired - camYaw + math.pi) % (2 * math.pi)) - math.pi
			camYawTarget = camYaw + delta
		end
		camPitchTarget = math.clamp(math.asin(math.clamp(dir.Y, -1, 1)), -MAX_PITCH, MAX_PITCH)
		headingTouch = true
	end

	if UserInputService.TouchEnabled then
		local gui = Instance.new("ScreenGui")
		gui.Name = "FlightTouchControls"
		gui.IgnoreGuiInset = true
		gui.ResetOnSpawn = false
		gui.Parent = player:WaitForChild("PlayerGui")
		BattleSession.track(gui)

		-- Tilt to move (accelerometer); neutral pose captured just after launch.
		if UserInputService.AccelerometerEnabled then
			UserInputService.DeviceGravityChanged:Connect(function(input)
				gravLatest = input.Position
			end)
			task.delay(0.6, function()
				gravRef = gravLatest
			end)
		end

		-- Gesture input via UserInputService (reliable + self-recovering). The
		-- gameProcessed flag means touches on a button (shield/boost/turn) are ignored
		-- here, so buttons and gestures don't fight. No full-screen catcher (which could
		-- get a touch 'stuck' and freeze tapping until a restart).
		local active: InputObject? = nil
		local startPos = Vector2.zero
		local moved, axis, rolled = false, "", false
		local lastTapT = -10
		local function stale(): boolean
			return active ~= nil
				and (active :: InputObject).UserInputState ~= Enum.UserInputState.Begin
				and (active :: InputObject).UserInputState ~= Enum.UserInputState.Change
		end
		UserInputService.TouchStarted:Connect(function(i, processed)
			if BattleSession.gen ~= gen then
				return
			end
			if stale() then
				active = nil -- recover a dropped finger
			end
			if processed or active then
				return
			end
			active = i
			startPos = Vector2.new(i.Position.X, i.Position.Y)
			moved, axis, rolled = false, "", false
		end)
		UserInputService.TouchMoved:Connect(function(i)
			if i ~= active or BattleSession.gen ~= gen then
				return
			end
			local d = Vector2.new(i.Position.X, i.Position.Y) - startPos
			if not moved and d.Magnitude > TOUCH_TAP_MOVE then
				moved = true
				axis = if math.abs(d.X) > math.abs(d.Y) then "horiz" else "vert"
			end
			if moved and axis == "horiz" and not rolled then
				triggerRoll(if d.X >= 0 then 1 else -1)
				rolled = true
			elseif moved and axis == "vert" then
				touchVert = if d.Y < 0 then 1 else -1
			end
		end)
		UserInputService.TouchEnded:Connect(function(i)
			if i ~= active or BattleSession.gen ~= gen then
				return
			end
			if not moved then
				-- Auto-aim: snap to the nearest enemy near the tap and fire; else aim there.
				local bestE, bestD = nil, TOUCH_TARGET_R
				for _, e in EnemyController.enemies do
					if e.root then
						local sp = camera:WorldToViewportPoint(e.root.Position)
						if sp.Z > 0 then
							local dd = (Vector2.new(sp.X, sp.Y) - startPos).Magnitude
							if dd < bestD then
								bestD = dd
								bestE = e
							end
						end
					end
				end
				if bestE then
					aimToward((bestE.root.Position - ShipState.position).Unit)
					ShipState.fireSecondary = true
				else
					local ray = camera:ViewportPointToRay(startPos.X, startPos.Y)
					aimToward(ray.Direction)
				end
			end
			active = nil
			touchVert = 0
		end)

		-- Top-row buttons.
		local function topBtn(text: string, ax: number, xoff: number, color: Color3): TextButton
			local b = Instance.new("TextButton")
			b.Size = UDim2.fromOffset(96, 52)
			b.AnchorPoint = Vector2.new(ax, 0)
			b.Position = UDim2.new(ax, xoff, 0, 12)
			b.BackgroundColor3 = color
			b.BackgroundTransparency = 0.3
			b.TextColor3 = Color3.fromRGB(255, 255, 255)
			b.TextScaled = true
			b.Text = text
			b.Parent = gui
			local c = Instance.new("UICorner")
			c.CornerRadius = UDim.new(0.25, 0)
			c.Parent = b
			return b
		end
		boostBtn = topBtn("BOOST", 1, -16, Color3.fromRGB(40, 90, 150))
		boostBtn.AnchorPoint = Vector2.new(0, 0.5) -- left side, under the shield button
		boostBtn.Position = UDim2.new(0, 16, 0.5, 90)
		boostBtn.Size = UDim2.fromOffset(96, 76)
		boostBtn.InputBegan:Connect(function(i)
			if i.UserInputType == Enum.UserInputType.Touch then
				touchBoost = true
			end
		end)
		boostBtn.InputEnded:Connect(function(i)
			if i.UserInputType == Enum.UserInputType.Touch then
				touchBoost = false
			end
		end)
		local function turnBtn(text: string, xoff: number, delta: number)
			local b = topBtn(text, 0.5, xoff, Color3.fromRGB(70, 80, 120))
			b.Activated:Connect(function()
				camYawTarget += delta
				headingTouch = true
			end)
		end
		turnBtn("<90", -102, math.rad(90))
		turnBtn("180", 0, math.pi)
		turnBtn("90>", 102, -math.rad(90))
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
	barBg.Position = UDim2.fromOffset(24, 76)
	barBg.Visible = false -- health now shown as a ring on the crosshair
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
	boostBg.Position = UDim2.fromOffset(24, 104)
	boostBg.Visible = false -- dash now shown under the crosshair
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

	-- Gamepad: A = down, B = up, click left stick (L3) = boost.
	local padUp, padDown, padBoost = false, false, false
	UserInputService.InputBegan:Connect(function(input)
		if BattleSession.gen ~= gen then
			return
		end
		if input.KeyCode == Enum.KeyCode.ButtonB then
			padUp = true
		elseif input.KeyCode == Enum.KeyCode.ButtonA then
			padDown = true
		elseif input.KeyCode == Enum.KeyCode.ButtonL3 then
			padBoost = true
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
		elseif input.KeyCode == Enum.KeyCode.ButtonL3 then
			padBoost = false
		end
	end)

	-- Stream our ship transform to the server for replication (~20 Hz).
	local shipUpdate = ReplicatedStorage:FindFirstChild("ShipUpdate")
	local sendAccum = 0

	-- ---- Free 3D flight ----------------------------------------------------
	local pos = Vector3.new(0, 100, 0) -- spawn in the gap between floor and ceiling
	local boostEnergy = BOOST_MAX
	local boostDepleted = false -- true once drained to 0; locks boost until it recharges
	local wasBoosting = false -- play the dash whoosh only on the frame boost kicks in

	RunService.RenderStepped:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return -- battle torn down; stop flying
		end
		local padMove = gamepadStick(Enum.KeyCode.Thumbstick1)
		local padLook = gamepadStick(Enum.KeyCode.Thumbstick2)
		-- Tilt to move, mapped like the (working) gyro LOOK: look-turn axis -> strafe,
		-- look-pitch axis -> forward/back. Reuses the GYRO_* calibration so it matches
		-- how looking felt. Flip GYRO_SWAP / GYRO_INVERT_* if a direction is off.
		local tiltFwd, tiltStrafe = 0, 0
		if gravLatest and gravRef then
			local function tiltAngles(a: Vector3): (number, number)
				local aboutX = math.atan2(a.Y, -a.Z)
				local aboutY = math.atan2(-a.X, math.sqrt(a.Y * a.Y + a.Z * a.Z))
				return aboutX, aboutY
			end
			local gx, gy = tiltAngles(gravLatest :: Vector3)
			local rx, ry = tiltAngles(gravRef :: Vector3)
			local aboutX = gx - rx
			local aboutY = gy - ry
			local function tiltAxis(t: number): number
				local s = if t >= 0 then 1 else -1
				local mag = math.max(0, math.abs(t) - GYRO_TILT_DEAD)
				local span = math.max(0.01, GYRO_TILT_FULL - GYRO_TILT_DEAD)
				return s * math.clamp(mag / span, 0, 1) * GYRO_SENS
			end
			local turnRaw = if GYRO_SWAP then aboutY else aboutX
			local pitchRaw = if GYRO_SWAP then aboutX else aboutY
			if GYRO_INVERT_TURN then turnRaw = -turnRaw end
			if GYRO_INVERT_PITCH then pitchRaw = -pitchRaw end
			tiltStrafe = tiltAxis(turnRaw) -- look-turn -> strafe
			tiltFwd = tiltAxis(pitchRaw) -- look-pitch -> forward/back
		end

		local moveFwd = math.clamp(keyAxis({ Enum.KeyCode.S }, { Enum.KeyCode.W }) + tiltFwd + padMove.Y, -1, 1)
		local moveStrafe = math.clamp(keyAxis({ Enum.KeyCode.A }, { Enum.KeyCode.D }) + tiltStrafe + padMove.X, -1, 1)
		local turn = math.clamp(keyAxis({ Enum.KeyCode.Left }, { Enum.KeyCode.Right }) + padLook.X, -1, 1)
		local pitchIn = math.clamp(keyAxis({ Enum.KeyCode.Up }, { Enum.KeyCode.Down }) + (-padLook.Y), -1, 1)

		-- Vertical (Y-axis): touch vertical drag, gamepad A/B, or keys.
		local vert = touchVert
		if padUp or UserInputService:IsKeyDown(Enum.KeyCode.Space) then
			vert += 1
		end
		if padDown or UserInputService:IsKeyDown(Enum.KeyCode.LeftControl) then
			vert -= 1
		end
		vert = math.clamp(vert, -1, 1)

		-- Speed boost: hold Shift / left trigger / BOOST to fly faster while energy
		-- lasts; recharges when off.
		local boostHeld = touchBoost
			or padBoost -- gamepad left-stick click (tracked via input events)
			or UserInputService:IsKeyDown(Enum.KeyCode.LeftShift)
		local boosting = boostHeld and not boostDepleted and ShipState.health > 0
		if boosting then
			boostEnergy -= BOOST_DRAIN * dt
			if boostEnergy <= 0 then
				boostEnergy = 0
				boostDepleted = true -- lock out until it recharges
			end
		else
			boostEnergy = math.min(BOOST_MAX, boostEnergy + BOOST_RECHARGE * dt)
			if boostDepleted and boostEnergy >= BOOST_MAX * 0.35 then
				boostDepleted = false -- usable again after recharging ~a third
			end
		end
		if boosting and not wasBoosting then
			Sfx.play("dash") -- rising-edge whoosh as the afterburner lights
		end
		wasBoosting = boosting
		local speedMult = if boosting then BOOST_MULT else 1
		ShipState.boostFrac = boostEnergy / BOOST_MAX
		if boostBtn then
			(boostBtn :: TextButton).BackgroundTransparency = 0.6 - 0.45 * math.clamp(boostEnergy / BOOST_MAX, 0, 1)
		end

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

		-- Heading. Touch: ease toward the tap / turn-button target. Else: stick/mouse rate.
		if touchAim and headingTouch then
			local a = math.clamp(dt * TURN_LERP, 0, 1)
			camYaw += (camYawTarget - camYaw) * a
			camPitch += (camPitchTarget - camPitch) * a
			camPitch = math.clamp(camPitch, -MAX_PITCH, MAX_PITCH)
			-- Aim pitch drifts back to level with the horizon.
			camPitchTarget -= camPitchTarget * math.clamp(dt * AUTOLEVEL_RATE, 0, 1)
			-- Heading drifts back onto the forward path (toward the cave), shortest way.
			local onPath = math.floor(camYawTarget / (2 * math.pi) + 0.5) * (2 * math.pi)
			camYawTarget += (onPath - camYawTarget) * math.clamp(dt * AUTOPATH_RATE, 0, 1)
		else
			camYaw -= turn * YAW_RATE * dt + mouseDX
			camPitch = math.clamp(camPitch - pitchIn * PITCH_RATE * dt - mouseDY, -MAX_PITCH, MAX_PITCH)
		end
		local yawCF = CFrame.Angles(0, camYaw, 0) -- horizontal heading
		local lookCF = yawCF * CFrame.Angles(camPitch, 0, 0)

		-- Fly where the nose points (pitch included), so aiming down dives toward
		-- the floor and up climbs; buttons still give pure vertical.
		local prevPos = pos
		local worldMove = lookCF.LookVector * moveFwd + lookCF.RightVector * moveStrafe
		pos += (worldMove * MOVE_SPEED * speedMult + Vector3.yAxis * vert * VERT_SPEED) * dt
		-- Barrel-roll dodge: shove the ship sideways in the roll direction.
		if rolling then
			pos += lookCF.RightVector * rollDir * ROLL_DODGE * dt
		end

		-- Wall collision: a "sealed" column (mountain tips touching floor-to-ceiling) has
		-- no air, so don't let the ship pass through it and out of the world. Slide along
		-- whichever axis stays open; if both are blocked, stop at the last good spot.
		local M = SHIP_MARGIN
		local function openCol(px: number, pz: number): boolean
			return TerrainController.ceilY(px, pz) - M > TerrainController.groundY(px, pz) + M
		end
		if not openCol(pos.X, pos.Z) then
			if openCol(prevPos.X, pos.Z) then
				pos = Vector3.new(prevPos.X, pos.Y, pos.Z)
			elseif openCol(pos.X, prevPos.Z) then
				pos = Vector3.new(pos.X, pos.Y, prevPos.Z)
			else
				pos = Vector3.new(prevPos.X, pos.Y, prevPos.Z)
			end
		end

		-- Stay inside the terrain: clamp altitude between floor and ceiling.
		local floorY = TerrainController.groundY(pos.X, pos.Z) + M
		local ceilingY = TerrainController.ceilY(pos.X, pos.Z) - M
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
		ShipState.strafe = moveStrafe

		-- Replicate our transform to other players.
		sendAccum += dt
		if shipUpdate and sendAccum >= 0.05 then
			sendAccum = 0
			-- Include the bank/roll so others see us roll; send our beam target.
			shipUpdate:FireServer(CFrame.new(pos) * lookCF * bank, ShipState.beamHit, ShipState.shielding)
		end

		-- Chase camera behind the look direction.
		local camPos = (CFrame.new(pos) * lookCF * CFrame.new(0, CAM_HEIGHT, CAM_DIST)).Position
		local goal = CFrame.lookAt(camPos, pos, Vector3.yAxis)
		-- Frame-rate independent so it stays tight at low mobile FPS (was dt*8, which
		-- trailed and read as "input delay" on touch).
		camera.CFrame = camera.CFrame:Lerp(goal, 1 - math.exp(-dt * 20))

		-- Boost feedback: widen the FOV + update the energy bar.
		local fovTarget = if boosting then BOOST_FOV else BASE_FOV
		camera.FieldOfView = camera.FieldOfView + (fovTarget - camera.FieldOfView) * math.clamp(dt * 6, 0, 1)
		boostFill.Size = UDim2.fromScale(boostEnergy / BOOST_MAX, 1)
		boostFill.BackgroundColor3 = if boostDepleted
			then Color3.fromRGB(120, 130, 150) -- locked out, recharging
			elseif boosting then Color3.fromRGB(150, 230, 255)
			else Color3.fromRGB(90, 200, 255)

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
