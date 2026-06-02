--!strict
-- Shop + garage UI. Lists catalog items by rarity, shows owned/equipped state,
-- and sends buy/equip requests. All validation is server-side (ShopService);
-- this controller only sends intent and reflects the result. Stub for MVP: the
-- data model and request plumbing are here; the visual layout is a TODO.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Net = require(ReplicatedStorage.Shared.Net)
local Projectiles = require(ReplicatedStorage.Shared.Catalog.Projectiles)
local Ships = require(ReplicatedStorage.Shared.Catalog.Ships)
local Economy = require(ReplicatedStorage.Shared.Config.Economy)

local ShopController = {}

-- Catalog rows sorted by rarity order, for rendering the grid.
local function sortedByRarity(catalog: { [string]: any })
	local rows = {}
	for _, def in catalog do
		table.insert(rows, def)
	end
	table.sort(rows, function(a, b)
		return Economy.Rarities[a.rarity].order < Economy.Rarities[b.rarity].order
	end)
	return rows
end

function ShopController.requestBuy(kind: string, id: string)
	Net.buyItem.send({ kind = kind, id = id })
end

function ShopController.requestEquip(kind: string, id: string)
	Net.equipItem.send({ kind = kind, id = id })
end

function ShopController.upgrade(stat: string)
	Net.buyItem.send({ kind = "upgrade", id = stat })
end

function ShopController.start()
	-- Data is ready; build the panels when the UI pass happens.
	local _projectileRows = sortedByRarity(Projectiles)
	local _shipRows = sortedByRarity(Ships)
	-- TODO: render garage (equipped ship + projectile) and shop grid; wire
	-- buttons to requestBuy / requestEquip / upgrade above.
end

return ShopController
