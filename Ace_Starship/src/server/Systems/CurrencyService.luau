--!strict
-- Banked progress. Owns each player's persistent profile: Bolts, owned items,
-- equipped items, and weapon upgrade levels. Backed by ProfileStore for safe
-- session-locked saves so progress is never lost or duplicated.
--
-- A run ending NEVER touches this data (banked progress, per GDD). Only earning,
-- spending, buying, and equipping mutate the profile.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ProfileStore = require(ReplicatedStorage.Packages.ProfileStore)
local Economy = require(ReplicatedStorage.Shared.Config.Economy)

export type Profile = {
	Bolts: number,
	OwnedProjectiles: { [string]: boolean },
	OwnedShips: { [string]: boolean },
	EquippedProjectile: string,
	EquippedShip: string,
	Upgrades: { Damage: number, FireRate: number, Multishot: number },
}

local DEFAULT_PROFILE: Profile = {
	Bolts = 0,
	OwnedProjectiles = { default_bolt = true },
	OwnedShips = { starter_skiff = true },
	EquippedProjectile = "default_bolt",
	EquippedShip = "starter_skiff",
	Upgrades = { Damage = 1, FireRate = 1, Multishot = 1 },
}

local CurrencyService = {}

local store = ProfileStore.New("PlayerData_v1", DEFAULT_PROFILE)
local profiles: { [Player]: any } = {}

local function onPlayerAdded(player: Player)
	local profile = store:StartSessionAsync(`player_{player.UserId}`, {
		Cancel = function()
			return player.Parent ~= Players
		end,
	})
	if not profile then
		player:Kick("Could not load your data. Please rejoin.")
		return
	end
	profile:AddUserId(player.UserId)
	profile:Reconcile() -- fill in any new default keys after an update
	profile.OnSessionEnd:Connect(function()
		profiles[player] = nil
	end)
	if player.Parent == Players then
		profiles[player] = profile
	else
		profile:EndSession()
	end
end

function CurrencyService.getProfile(player: Player): Profile?
	local p = profiles[player]
	return p and p.Data or nil
end

function CurrencyService.awardBolts(player: Player, amount: number)
	local data = CurrencyService.getProfile(player)
	if data then
		data.Bolts += amount
	end
end

-- Returns true on success. Server-authoritative spend check.
function CurrencyService.trySpend(player: Player, amount: number): boolean
	local data = CurrencyService.getProfile(player)
	if data and data.Bolts >= amount then
		data.Bolts -= amount
		return true
	end
	return false
end

function CurrencyService.upgradeCost(stat: string, currentLevel: number): number
	local base = Economy.UpgradeBaseCost[stat]
	return math.floor(base * Economy.UpgradeCostGrowth ^ (currentLevel - 1))
end

function CurrencyService.start()
	for _, player in Players:GetPlayers() do
		task.spawn(onPlayerAdded, player)
	end
	Players.PlayerAdded:Connect(onPlayerAdded)
	Players.PlayerRemoving:Connect(function(player)
		local p = profiles[player]
		if p then
			p:EndSession()
		end
	end)
end

return CurrencyService
