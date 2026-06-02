--!strict
-- Handles buy/equip requests, server-authoritative. Bolt purchases spend from
-- the banked profile; Robux purchases go through MarketplaceService (stubbed).
-- Upgrades read costs from CurrencyService. Nothing here trusts the client.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local Net = require(ReplicatedStorage.Shared.Net)
local Projectiles = require(ReplicatedStorage.Shared.Catalog.Projectiles)
local Ships = require(ReplicatedStorage.Shared.Catalog.Ships)
local Economy = require(ReplicatedStorage.Shared.Config.Economy)
local CurrencyService = require(ServerScriptService.Server.Systems.CurrencyService)

local ShopService = {}

local function buy(player: Player, payload: { kind: string, id: string })
	local data = CurrencyService.getProfile(player)
	if not data then
		return
	end

	if payload.kind == "upgrade" then
		local level = data.Upgrades[payload.id]
		local maxLevel = Economy.UpgradeMaxLevel[payload.id]
		if not level or level >= maxLevel then
			return
		end
		local cost = CurrencyService.upgradeCost(payload.id, level)
		if CurrencyService.trySpend(player, cost) then
			data.Upgrades[payload.id] = level + 1
		end
	elseif payload.kind == "projectile" then
		local def = Projectiles[payload.id]
		if not def or data.OwnedProjectiles[payload.id] then
			return
		end
		if def.priceBolts and CurrencyService.trySpend(player, def.priceBolts) then
			data.OwnedProjectiles[payload.id] = true
		end
		-- Robux-priced items would be granted via a MarketplaceService receipt.
	elseif payload.kind == "ship" then
		local def = Ships[payload.id]
		if not def or data.OwnedShips[payload.id] then
			return
		end
		if def.priceBolts and CurrencyService.trySpend(player, def.priceBolts) then
			data.OwnedShips[payload.id] = true
		end
	end
end

local function equip(player: Player, payload: { kind: string, id: string })
	local data = CurrencyService.getProfile(player)
	if not data then
		return
	end
	if payload.kind == "projectile" and data.OwnedProjectiles[payload.id] then
		data.EquippedProjectile = payload.id
	elseif payload.kind == "ship" and data.OwnedShips[payload.id] then
		data.EquippedShip = payload.id
	end
end

function ShopService.start()
	Net.buyItem.listen(buy)
	Net.equipItem.listen(equip)
end

return ShopService
