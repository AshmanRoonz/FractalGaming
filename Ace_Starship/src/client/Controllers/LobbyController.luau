--!strict
-- Lobby flow (no menu). You start as your character in your hangar bay; use the
-- pedestals to shop/equip, then walk into your ship to launch. While in battle a
-- "Leave Battle" button and a death overlay can send you back to the hangar
-- (server respawns you in your bay); the shared battle keeps running for others.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local LobbyController = {}

local launched = false -- module-level so a return-to-hangar can reset it

local function startBattle(shipId: string, mainId: string, secId: string)
	local Controllers = script.Parent
	local BattleSession = require(Controllers.BattleSession)
	local ShipState = require(Controllers.ShipState)
	local player = Players.LocalPlayer
	local leaveBattle = ReplicatedStorage:WaitForChild("LeaveBattle")
	local gen = BattleSession.gen

	local function go(name: string, ...)
		local args = table.pack(...)
		local ok, err = pcall(function()
			require(Controllers[name]).start(table.unpack(args, 1, args.n))
		end)
		if not ok then
			warn(`[AceStarship] {name} failed to start: {err}`)
		end
	end
	-- Independent systems first so a failure in one doesn't drop the rest.
	go("ShipController", shipId)
	go("TerrainController")
	go("WeaponController", mainId, secId)
	go("PetController")
	go("EnemyController")
	go("RemoteShipsController")

	-- ---- Return-to-hangar flow ---------------------------------------------
	local returning = false
	local function returnToHangar()
		if returning then
			return
		end
		returning = true
		BattleSession.teardown() -- stop + destroy this player's local battle view
		leaveBattle:FireServer() -- server respawns us in our existing bay
		launched = false -- allow relaunch by walking into the ship again
	end

	local menu = Instance.new("ScreenGui")
	menu.Name = "BattleMenu"
	menu.IgnoreGuiInset = true
	menu.ResetOnSpawn = false
	menu.DisplayOrder = 20
	menu.Parent = player:WaitForChild("PlayerGui")
	BattleSession.track(menu)

	-- Leave Battle button (top-right, always available).
	local leaveBtn = Instance.new("TextButton")
	leaveBtn.AnchorPoint = Vector2.new(1, 0)
	leaveBtn.Position = UDim2.new(1, -20, 0, 20)
	leaveBtn.Size = UDim2.fromOffset(150, 40)
	leaveBtn.BackgroundColor3 = Color3.fromRGB(60, 66, 84)
	leaveBtn.BackgroundTransparency = 0.15
	leaveBtn.Font = Enum.Font.GothamBold
	leaveBtn.TextSize = 16
	leaveBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
	leaveBtn.Text = "Leave Battle"
	leaveBtn.Parent = menu
	local lc = Instance.new("UICorner")
	lc.CornerRadius = UDim.new(0, 8)
	lc.Parent = leaveBtn
	leaveBtn.Activated:Connect(returnToHangar)

	-- Death overlay (hidden until your ship is destroyed).
	local death = Instance.new("Frame")
	death.Size = UDim2.fromScale(1, 1)
	death.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
	death.BackgroundTransparency = 0.35
	death.Visible = false
	death.Parent = menu
	local title = Instance.new("TextLabel")
	title.AnchorPoint = Vector2.new(0.5, 0.5)
	title.Position = UDim2.fromScale(0.5, 0.42)
	title.Size = UDim2.fromOffset(600, 70)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.GothamBlack
	title.TextSize = 50
	title.TextColor3 = Color3.fromRGB(255, 90, 90)
	title.Text = "SHIP DESTROYED"
	title.Parent = death
	local respawn = Instance.new("TextButton")
	respawn.AnchorPoint = Vector2.new(0.5, 0.5)
	respawn.Position = UDim2.fromScale(0.5, 0.56)
	respawn.Size = UDim2.fromOffset(260, 56)
	respawn.BackgroundColor3 = Color3.fromRGB(80, 180, 120)
	respawn.Font = Enum.Font.GothamBold
	respawn.TextSize = 22
	respawn.TextColor3 = Color3.fromRGB(15, 20, 16)
	respawn.Text = "Return to Hangar"
	respawn.Parent = death
	local rc = Instance.new("UICorner")
	rc.CornerRadius = UDim.new(0, 10)
	rc.Parent = respawn
	respawn.Activated:Connect(returnToHangar)

	-- Death watcher: surface the overlay when health hits zero.
	RunService.RenderStepped:Connect(function()
		if BattleSession.gen ~= gen then
			return
		end
		if ShipState.health <= 0 then
			death.Visible = true
		end
	end)
end

function LobbyController.start()
	local player = Players.LocalPlayer
	local beginBattle = ReplicatedStorage:WaitForChild("BeginBattle")

	-- Hangar shop windows (podiums fire OpenShop to this). Lives across the whole
	-- session, including after returning from battle.
	local okShop, errShop = pcall(function()
		require(script.Parent.ShopController).start()
	end)
	if not okShop then
		warn(`[AceStarship] ShopController failed to start: {errShop}`)
	end

	-- Quiet title (no window).
	local gui = Instance.new("ScreenGui")
	gui.Name = "Lobby"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.Parent = player:WaitForChild("PlayerGui")
	local title = Instance.new("TextLabel")
	title.AnchorPoint = Vector2.new(0.5, 0)
	title.Position = UDim2.new(0.5, 0, 0, 30)
	title.Size = UDim2.fromOffset(700, 60)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.GothamBlack
	title.TextSize = 50
	title.TextColor3 = Color3.fromRGB(120, 200, 255)
	title.Text = "ACE STARSHIP"
	title.Parent = gui

	beginBattle.OnClientEvent:Connect(function(shipId, mainId, secId)
		if launched then
			return
		end
		launched = true
		gui.Enabled = false -- hide the title while flying (kept for next time)
		startBattle(shipId, mainId, secId)
	end)
end

return LobbyController
