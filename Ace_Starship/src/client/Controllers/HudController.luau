--!strict
-- HUD: live distance counter, Bolts balance, and a boss banner when a gate
-- opens. Reads authoritative pushes from the server (Net.runState / bossSpawned).
-- UI is built in code here for MVP; can move to a proper UI framework later.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local Net = require(ReplicatedStorage.Shared.Net)

local HudController = {}

local function buildHud(): { distance: TextLabel, bolts: TextLabel, boss: TextLabel }
	local gui = Instance.new("ScreenGui")
	gui.Name = "AceHud"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

	local function label(name: string, pos: UDim2, size: number): TextLabel
		local l = Instance.new("TextLabel")
		l.Name = name
		l.BackgroundTransparency = 1
		l.Position = pos
		l.Size = UDim2.fromOffset(300, 40)
		l.Font = Enum.Font.GothamBold
		l.TextScaled = false
		l.TextSize = size
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.Text = ""
		l.Parent = gui
		return l
	end

	return {
		distance = label("Distance", UDim2.fromOffset(20, 20), 28),
		bolts = label("Bolts", UDim2.fromOffset(20, 56), 24),
		boss = label("Boss", UDim2.new(0.5, -150, 0.15, 0), 36),
	}
end

function HudController.start()
	local hud = buildHud()

	Net.runState.listen(function(state)
		hud.distance.Text = `{math.floor(state.distance)} m`
		hud.bolts.Text = `⚡ {state.bolts}`
	end)

	Net.bossSpawned.listen(function(payload)
		hud.boss.Text = `⚠ BOSS: {payload.bossId}`
		task.delay(4, function()
			hud.boss.Text = ""
		end)
	end)
end

return HudController
