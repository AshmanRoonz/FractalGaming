--!strict
-- THE MONETIZATION CATALOG.
-- Every entry here is one sellable projectile skin. Adding a new silly gun is:
--   1. model it in Meshy, import to ReplicatedStorage.Assets.Projectiles as <assetId>
--   2. add a row below
-- That's it. No new code. Stats stay neutral (cosmetic-only, per GDD); only
-- `effect` adds visual flair on legendaries.

export type ProjectileDef = {
	id: string,
	displayName: string,
	rarity: string, -- key into Economy.Rarities
	assetId: string, -- name of the mesh under Assets.Projectiles
	priceBolts: number?, -- nil = not buyable with Bolts (premium-only)
	priceRobux: number?, -- nil = not buyable with Robux (grind-only)
	-- Purely visual hook fired on spawn/impact. Keep gameplay impact tiny.
	effect: string?, -- e.g. "quack", "tp_trail", "chicken_split"
}

local Projectiles: { [string]: ProjectileDef } = {
	default_bolt = {
		id = "default_bolt",
		displayName = "Plasma Bolt",
		rarity = "Common",
		assetId = "PlasmaBolt",
		priceBolts = 0, -- starter, owned by default
	},
	rubber_duck = {
		id = "rubber_duck",
		displayName = "Rubber Duck",
		rarity = "Rare",
		assetId = "RubberDuck",
		priceBolts = 1200,
		effect = "quack",
	},
	toilet_paper = {
		id = "toilet_paper",
		displayName = "TP Roll",
		rarity = "Rare",
		assetId = "ToiletPaperRoll",
		priceBolts = 1500,
		effect = "tp_trail",
	},
	rubber_chicken = {
		id = "rubber_chicken",
		displayName = "Rubber Chicken",
		rarity = "Epic",
		assetId = "RubberChicken",
		priceRobux = 99,
		effect = "chicken_split",
	},
}

return Projectiles
