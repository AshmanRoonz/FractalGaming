--!strict
-- Persistent Bolts balance counter, always on screen (lobby + battle). The server
-- pushes the number via the BoltsChanged remote whenever it changes; on start we
-- ask once for the current balance so it shows immediately.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local BoltsHudController = {}

function BoltsHudController.start()
	local player = Players.LocalPlayer
	local gui = Instance.new("ScreenGui")
	gui.Name = "BoltsHud"
	gui.ResetOnSpawn = false -- survive respawns / battle transitions
	gui.IgnoreGuiInset = true
	gui.DisplayOrder = 5
	gui.Parent = player:WaitForChild("PlayerGui")

	local label = Instance.new("TextLabel")
	label.Name = "Balance"
	label.AnchorPoint = Vector2.new(1, 0) -- top-right, below the Leave Battle button
	label.Position = UDim2.new(1, -20, 0, 70)
	label.Size = UDim2.fromOffset(220, 34)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBlack
	label.TextSize = 26
	label.TextColor3 = Color3.fromRGB(255, 215, 70)
	label.TextStrokeColor3 = Color3.fromRGB(0, 0, 0)
	label.TextStrokeTransparency = 0.4
	label.TextXAlignment = Enum.TextXAlignment.Right
	label.Text = "⚡ ..."
	label.Parent = gui

	local boltsEvent = ReplicatedStorage:WaitForChild("BoltsChanged")
	boltsEvent.OnClientEvent:Connect(function(amount)
		label.Text = `⚡ {amount}`
	end)
	boltsEvent:FireServer() -- ask for the current balance now
end

return BoltsHudController
