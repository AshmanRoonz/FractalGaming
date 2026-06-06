--!strict
-- Wave-select popup. The hangar wave podium fires "OpenWaveMenu" with { start, max };
-- this shows a menu to choose which wave you launch into. The -/+ buttons send deltas
-- via "WaveAction"; the server clamps and re-fires OpenWaveMenu to refresh the display.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Sfx = require(ReplicatedStorage.Shared.Sfx)

local WaveMenuController = {}

function WaveMenuController.start()
	local player = Players.LocalPlayer
	local openWave = ReplicatedStorage:WaitForChild("OpenWaveMenu")
	local waveAction = ReplicatedStorage:WaitForChild("WaveAction")

	local gui = Instance.new("ScreenGui")
	gui.Name = "WaveMenu"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.Enabled = false
	gui.DisplayOrder = 50
	gui.Parent = player:WaitForChild("PlayerGui")

	local backdrop = Instance.new("TextButton")
	backdrop.Size = UDim2.fromScale(1, 1)
	backdrop.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
	backdrop.BackgroundTransparency = 0.45
	backdrop.Text = ""
	backdrop.AutoButtonColor = false
	backdrop.Parent = gui

	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromOffset(470, 290)
	panel.BackgroundColor3 = Color3.fromRGB(24, 27, 38)
	panel.BorderSizePixel = 0
	panel.Parent = gui
	local pc = Instance.new("UICorner")
	pc.CornerRadius = UDim.new(0, 14)
	pc.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(70, 150, 255)
	stroke.Thickness = 2
	stroke.Parent = panel

	local title = Instance.new("TextLabel")
	title.Position = UDim2.fromOffset(24, 18)
	title.Size = UDim2.fromOffset(360, 30)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.GothamBlack
	title.TextSize = 24
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextColor3 = Color3.fromRGB(120, 200, 255)
	title.Text = "SELECT START WAVE"
	title.Parent = panel

	local waveBig = Instance.new("TextLabel")
	waveBig.AnchorPoint = Vector2.new(0.5, 0)
	waveBig.Position = UDim2.new(0.5, 0, 0, 70)
	waveBig.Size = UDim2.fromOffset(420, 80)
	waveBig.BackgroundTransparency = 1
	waveBig.Font = Enum.Font.GothamBlack
	waveBig.TextSize = 64
	waveBig.TextColor3 = Color3.fromRGB(255, 255, 255)
	waveBig.Text = "WAVE 1"
	waveBig.Parent = panel

	local best = Instance.new("TextLabel")
	best.AnchorPoint = Vector2.new(0.5, 0)
	best.Position = UDim2.new(0.5, 0, 0, 150)
	best.Size = UDim2.fromOffset(420, 22)
	best.BackgroundTransparency = 1
	best.Font = Enum.Font.GothamBold
	best.TextSize = 16
	best.TextColor3 = Color3.fromRGB(170, 230, 255)
	best.Text = "best 0  (max reachable: 1)"
	best.Parent = panel

	local close = Instance.new("TextButton")
	close.AnchorPoint = Vector2.new(1, 0)
	close.Position = UDim2.new(1, -16, 0, 16)
	close.Size = UDim2.fromOffset(34, 34)
	close.BackgroundColor3 = Color3.fromRGB(50, 55, 70)
	close.Font = Enum.Font.GothamBold
	close.TextSize = 22
	close.TextColor3 = Color3.fromRGB(255, 255, 255)
	close.Text = "X"
	close.Parent = panel
	local cc = Instance.new("UICorner")
	cc.CornerRadius = UDim.new(0, 8)
	cc.Parent = close
	close.Activated:Connect(function()
		gui.Enabled = false
	end)
	backdrop.Activated:Connect(function()
		gui.Enabled = false
	end)

	-- The -10 / -1 / +1 / +10 buttons.
	local function mkBtn(text: string, delta: number, x: number, color: Color3)
		local b = Instance.new("TextButton")
		b.AnchorPoint = Vector2.new(0.5, 1)
		b.Position = UDim2.new(0.5, x, 1, -24)
		b.Size = UDim2.fromOffset(96, 56)
		b.BackgroundColor3 = color
		b.Font = Enum.Font.GothamBlack
		b.TextSize = 22
		b.TextColor3 = Color3.fromRGB(255, 255, 255)
		b.Text = text
		b.Parent = panel
		local bc = Instance.new("UICorner")
		bc.CornerRadius = UDim.new(0, 10)
		bc.Parent = b
		b.Activated:Connect(function()
			Sfx.play("ui")
			waveAction:FireServer(delta)
		end)
	end
	local down = Color3.fromRGB(200, 90, 70)
	local up = Color3.fromRGB(70, 175, 110)
	mkBtn("-10", -10, -156, down)
	mkBtn("-1", -1, -52, down)
	mkBtn("+1", 1, 52, up)
	mkBtn("+10", 10, 156, up)

	openWave.OnClientEvent:Connect(function(data)
		if type(data) ~= "table" then
			return
		end
		local startN = tonumber(data.start) or 1
		local maxN = tonumber(data.max) or 0
		waveBig.Text = "WAVE " .. tostring(startN)
		best.Text = `best {maxN}  (you can start up to {maxN + 1})`
		gui.Enabled = true
	end)
end

return WaveMenuController
