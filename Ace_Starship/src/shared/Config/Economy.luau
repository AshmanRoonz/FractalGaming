--!strict
-- Economy rules. Two currencies, cleanly separated (see GDD: cosmetic vs power).
-- Bolts = soft/grind currency. Robux = premium, handled by Roblox MarketplaceService.

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary" | "Mythic"

local Economy = {
	-- Bolt rewards --------------------------------------------------------
	BoltsPerKill = 5,
	BoltsPerStud = 0.02, -- distance trickle
	BoltsPerBoss = 250,

	-- Weapon upgrade tree. Stats are POWER and only buyable with Bolts so
	-- premium skins never grant an advantage. Costs scale per level.
	UpgradeBaseCost = {
		Damage = 50,
		FireRate = 75,
		Multishot = 200,
	},
	UpgradeCostGrowth = 1.6, -- cost = base * growth ^ (level - 1)
	UpgradeMaxLevel = {
		Damage = 20,
		FireRate = 15,
		Multishot = 5,
	},

	-- Rarity metadata. Drives shop sorting, garage glow, and roll weights.
	Rarities = {
		Common = { order = 1, color = Color3.fromRGB(180, 180, 180), weight = 60 },
		Rare = { order = 2, color = Color3.fromRGB(80, 150, 255), weight = 25 },
		Epic = { order = 3, color = Color3.fromRGB(180, 90, 255), weight = 10 },
		Legendary = { order = 4, color = Color3.fromRGB(255, 180, 40), weight = 4 },
		Mythic = { order = 5, color = Color3.fromRGB(255, 60, 90), weight = 1 },
	},
}

return Economy
