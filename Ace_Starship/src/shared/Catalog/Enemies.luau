--!strict
-- Enemy + boss catalog. Each row maps to a Meshy import under Assets.Enemies
-- (or Assets.Bosses). The EnemyTemplate reads these to spawn a live enemy.

export type EnemyDef = {
	id: string,
	displayName: string,
	assetId: string,
	baseHealth: number,
	contactDamage: number,
	speed: number, -- studs/sec toward the player
	boltsReward: number?, -- overrides Economy.BoltsPerKill if set
	-- Spawn weighting and where in the run it can appear.
	spawnWeight: number,
	minDistance: number, -- studs before this enemy starts appearing
	isBoss: boolean?,
	attackPattern: string?, -- bosses only: key into BossManager patterns
}

local Enemies: { [string]: EnemyDef } = {
	drifter = {
		id = "drifter",
		displayName = "Drifter",
		assetId = "Drifter",
		baseHealth = 20,
		contactDamage = 10,
		speed = 30,
		spawnWeight = 60,
		minDistance = 0,
	},
	chaser = {
		id = "chaser",
		displayName = "Chaser",
		assetId = "Chaser",
		baseHealth = 35,
		contactDamage = 15,
		speed = 55,
		spawnWeight = 30,
		minDistance = 1500,
	},
	brute = {
		id = "brute",
		displayName = "Brute",
		assetId = "Brute",
		baseHealth = 120,
		contactDamage = 25,
		speed = 22,
		boltsReward = 20,
		spawnWeight = 10,
		minDistance = 3000,
	},

	-- First boss (MVP). Blocks the tunnel at BossEveryStuds.
	gatekeeper = {
		id = "gatekeeper",
		displayName = "The Gatekeeper",
		assetId = "Gatekeeper",
		baseHealth = 2500,
		contactDamage = 40,
		speed = 12,
		boltsReward = 250,
		spawnWeight = 0, -- bosses are placed, never random-spawned
		minDistance = 4000,
		isBoss = true,
		attackPattern = "radial_burst",
	},
}

return Enemies
