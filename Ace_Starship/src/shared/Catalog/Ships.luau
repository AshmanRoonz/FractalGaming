--!strict
-- Ship catalog. Like projectiles, each row maps to a Meshy import under
-- Assets.Ships. Ships are cosmetic shells; handling stats are mild and tunable.

export type ShipDef = {
	id: string,
	displayName: string,
	rarity: string,
	assetId: string,
	priceBolts: number?,
	priceRobux: number?,
	-- Mild handling tweaks (kept small so ships stay mostly cosmetic).
	steerSpeedMult: number?, -- multiplies GameConfig.SteerSpeed
	muzzleOffsets: { Vector3 }?, -- local-space gun barrels; defaults to one centered
	-- Degrees to rotate the mesh so its NOSE points forward (-Z). Meshy imports
	-- rarely face the right way. Try 0 / 90 / 180 / 270 until the ship flies
	-- nose-first away from the camera.
	modelYawOffset: number?,
}

local Ships: { [string]: ShipDef } = {
	starter_skiff = {
		id = "starter_skiff",
		displayName = "Pyro",
		rarity = "Common",
		assetId = "Pyro", -- matches the Meshy model name in Assets.Ships
		priceBolts = 0, -- owned by default
		steerSpeedMult = 1.0,
		muzzleOffsets = { Vector3.new(0, 0, -4) },
		modelYawOffset = 90, -- first guess; adjust if Pyro flies sideways
	},
}

return Ships
