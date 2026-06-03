--!strict
-- Lobby flow (no menu). You start as your character in your hangar bay; use the
-- pedestal to change ship, then walk into your ship to launch. The server
-- detects the walk-in and tells us to start the flight game.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local LobbyController = {}

local function startBattle(shipId: string, mainId: string, secId: string)
	local Controllers = script.Parent
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
end

function LobbyController.start()
	local player = Players.LocalPlayer
	local beginBattle = ReplicatedStorage:WaitForChild("BeginBattle")

	-- Hangar shop windows (podiums fire OpenShop to this).
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

	local launched = false
	beginBattle.OnClientEvent:Connect(function(shipId, mainId, secId)
		if launched then
			return
		end
		launched = true
		gui:Destroy()
		startBattle(shipId, mainId, secId)
	end)
end

return LobbyController
