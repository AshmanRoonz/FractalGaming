--!strict
-- Mobile-first input. The ship auto-travels forward; the player only steers
-- laterally and fires. Works with touch drag (phone), mouse (desktop), and the
-- thumbstick (gamepad). Sends intent to the server; never decides outcomes.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")

local Net = require(ReplicatedStorage.Shared.Net)
local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)

local InputController = {}

local firing = false
local steerOffset = Vector3.zero -- desired lateral offset from tunnel center

local function screenToSteer(position: Vector2): Vector3
	local camera = workspace.CurrentCamera
	if not camera then
		return Vector3.zero
	end
	-- Map horizontal/vertical screen position to a steer offset within SteerRadius.
	local vp = camera.ViewportSize
	local nx = (position.X / vp.X) * 2 - 1
	local ny = (position.Y / vp.Y) * 2 - 1
	return Vector3.new(nx, -ny, 0) * GameConfig.SteerRadius
end

function InputController.start()
	UserInputService.InputBegan:Connect(function(input, gpe)
		if gpe then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch then
			firing = true
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch then
			firing = false
		end
	end)
	UserInputService.InputChanged:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseMovement
			or input.UserInputType == Enum.UserInputType.Touch then
			steerOffset = screenToSteer(Vector2.new(input.Position.X, input.Position.Y))
		end
	end)

	-- Stream intent at a fixed-ish rate via unreliable packets.
	RunService.Heartbeat:Connect(function()
		Net.steer.send({ offset = steerOffset })
		if firing then
			local camera = workspace.CurrentCamera
			local aim = camera and camera.CFrame.LookVector or Vector3.new(0, 0, -1)
			Net.fireWeapon.send({ aimDir = aim })
		end
	end)
end

return InputController
