--!strict
-- Performance settings menu. A small gear button (always on screen) opens a
-- Low / Medium / High picker that sets the shared Quality level live. Touch devices
-- start on Low automatically; this lets anyone change it.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Quality = require(ReplicatedStorage.Shared.Quality)

local SettingsController = {}

local LEVELS = { { id = "low", label = "LOW" }, { id = "med", label = "MEDIUM" }, { id = "high", label = "HIGH" } }
local ACTIVE = Color3.fromRGB(70, 150, 255)
local IDLE = Color3.fromRGB(48, 53, 68)

function SettingsController.start()
	local player = Players.LocalPlayer
	local gui = Instance.new("ScreenGui")
	gui.Name = "Settings"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 60
	gui.Parent = player:WaitForChild("PlayerGui")

	-- Gear button (top-left, under the Roblox menu).
	local gear = Instance.new("TextButton")
	gear.AnchorPoint = Vector2.new(0, 0)
	gear.Position = UDim2.fromOffset(16, 96)
	gear.Size = UDim2.fromOffset(46, 46)
	gear.BackgroundColor3 = Color3.fromRGB(30, 34, 46)
	gear.BackgroundTransparency = 0.2
	gear.Font = Enum.Font.GothamBold
	gear.TextSize = 22
	gear.TextColor3 = Color3.fromRGB(220, 225, 235)
	gear.Text = "\u{2699}" -- gear glyph
	gear.Parent = gui
	local gc = Instance.new("UICorner")
	gc.CornerRadius = UDim.new(0.3, 0)
	gc.Parent = gear

	-- Panel.
	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0, 0)
	panel.Position = UDim2.fromOffset(16, 148)
	panel.Size = UDim2.fromOffset(170, 150)
	panel.BackgroundColor3 = Color3.fromRGB(24, 27, 38)
	panel.BorderSizePixel = 0
	panel.Visible = false
	panel.Parent = gui
	local pc = Instance.new("UICorner")
	pc.CornerRadius = UDim.new(0, 10)
	pc.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(70, 150, 255)
	stroke.Thickness = 2
	stroke.Parent = panel

	local title = Instance.new("TextLabel")
	title.Position = UDim2.fromOffset(14, 8)
	title.Size = UDim2.fromOffset(150, 22)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.GothamBold
	title.TextSize = 14
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextColor3 = Color3.fromRGB(150, 200, 255)
	title.Text = "PERFORMANCE"
	title.Parent = panel

	local buttons: { [string]: TextButton } = {}
	local function refresh()
		for id, b in buttons do
			b.BackgroundColor3 = if id == Quality.level then ACTIVE else IDLE
		end
	end

	for i, lvl in LEVELS do
		local b = Instance.new("TextButton")
		b.Position = UDim2.fromOffset(14, 30 + i * 30)
		b.Size = UDim2.fromOffset(142, 26)
		b.Font = Enum.Font.GothamBold
		b.TextSize = 14
		b.TextColor3 = Color3.fromRGB(235, 235, 240)
		b.Text = lvl.label
		b.BackgroundColor3 = IDLE
		b.Parent = panel
		local bc = Instance.new("UICorner")
		bc.CornerRadius = UDim.new(0, 6)
		bc.Parent = b
		b.Activated:Connect(function()
			Quality.set(lvl.id)
			refresh()
		end)
		buttons[lvl.id] = b
	end
	refresh()

	gear.Activated:Connect(function()
		panel.Visible = not panel.Visible
		refresh()
	end)
end

return SettingsController
