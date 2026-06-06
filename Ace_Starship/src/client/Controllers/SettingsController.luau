--!strict
-- Performance settings popup. Opened from the hangar "Performance" podium (fires
-- ReplicatedStorage.OpenSettings). Picks Low / Medium / High, setting the shared
-- Quality level live. No on-screen button.

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
	gui.Enabled = false
	gui.Parent = player:WaitForChild("PlayerGui")

	local backdrop = Instance.new("TextButton")
	backdrop.Size = UDim2.fromScale(1, 1)
	backdrop.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
	backdrop.BackgroundTransparency = 0.45
	backdrop.Text = ""
	backdrop.AutoButtonColor = false
	backdrop.Parent = gui
	backdrop.Activated:Connect(function()
		gui.Enabled = false
	end)

	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromOffset(300, 240)
	panel.BackgroundColor3 = Color3.fromRGB(24, 27, 38)
	panel.BorderSizePixel = 0
	panel.Parent = gui
	local pc = Instance.new("UICorner")
	pc.CornerRadius = UDim.new(0, 12)
	pc.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(70, 150, 255)
	stroke.Thickness = 2
	stroke.Parent = panel

	local title = Instance.new("TextLabel")
	title.Position = UDim2.fromOffset(20, 16)
	title.Size = UDim2.fromOffset(220, 28)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.GothamBlack
	title.TextSize = 22
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextColor3 = Color3.fromRGB(150, 200, 255)
	title.Text = "PERFORMANCE"
	title.Parent = panel

	local close = Instance.new("TextButton")
	close.AnchorPoint = Vector2.new(1, 0)
	close.Position = UDim2.new(1, -14, 0, 14)
	close.Size = UDim2.fromOffset(32, 32)
	close.BackgroundColor3 = Color3.fromRGB(50, 55, 70)
	close.Font = Enum.Font.GothamBold
	close.TextSize = 20
	close.TextColor3 = Color3.fromRGB(255, 255, 255)
	close.Text = "X"
	close.Parent = panel
	local cc = Instance.new("UICorner")
	cc.CornerRadius = UDim.new(0, 8)
	cc.Parent = close
	close.Activated:Connect(function()
		gui.Enabled = false
	end)

	local buttons: { [string]: TextButton } = {}
	local function refresh()
		for id, b in buttons do
			b.BackgroundColor3 = if id == Quality.level then ACTIVE else IDLE
		end
	end
	for i, lvl in LEVELS do
		local b = Instance.new("TextButton")
		b.AnchorPoint = Vector2.new(0.5, 0)
		b.Position = UDim2.new(0.5, 0, 0, 56 + (i - 1) * 56)
		b.Size = UDim2.fromOffset(260, 46)
		b.Font = Enum.Font.GothamBold
		b.TextSize = 18
		b.TextColor3 = Color3.fromRGB(235, 235, 240)
		b.Text = lvl.label
		b.BackgroundColor3 = IDLE
		b.Parent = panel
		local bc = Instance.new("UICorner")
		bc.CornerRadius = UDim.new(0, 8)
		bc.Parent = b
		b.Activated:Connect(function()
			Quality.set(lvl.id)
			refresh()
		end)
		buttons[lvl.id] = b
	end
	refresh()

	-- Wait for the podium's remote without blocking the client startup chain.
	task.spawn(function()
		local openSettings = ReplicatedStorage:WaitForChild("OpenSettings")
		openSettings.OnClientEvent:Connect(function()
			refresh()
			gui.Enabled = true
		end)
	end)
end

return SettingsController
