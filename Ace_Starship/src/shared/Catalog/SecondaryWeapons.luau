--!strict
-- Secondary (projectile) weapons -- the "funny objects" you fire. Cosmetic-only
-- for now (same damage); placeholder parts until Meshy objects are swapped in.
-- Ordered list; the hangar pedestal cycles through it.

export type SecDef = {
	id: string,
	displayName: string,
	color: Color3,
	size: number,
	shape: Enum.PartType, -- used if no object/meshId
	price: number, -- Bolts cost (0 = free / owned by default)
	object: string?, -- optional name of a model in Assets/Objects to fire
	meshId: string?, -- optional "rbxassetid://..." to fire a real mesh
	meshScale: number?,
	textureId: string?,
}

local SecondaryWeapons: { SecDef } = {
	{ id = "ball", displayName = "Funny Ball", color = Color3.fromRGB(255, 180, 40), size = 4, shape = Enum.PartType.Ball, price = 0 },
	{ id = "beachball", displayName = "Beach Ball", color = Color3.fromRGB(255, 95, 95), size = 5.5, shape = Enum.PartType.Ball, price = 120 },
	{ id = "noob", displayName = "Noob Head", color = Color3.fromRGB(255, 225, 75), size = 4.5, shape = Enum.PartType.Ball, price = 180 },
	{ id = "brick", displayName = "Classic Brick", color = Color3.fromRGB(196, 40, 28), size = 4, shape = Enum.PartType.Block, price = 150 },
	{ id = "barrel", displayName = "Barrel", color = Color3.fromRGB(120, 75, 40), size = 5, shape = Enum.PartType.Cylinder, price = 220 },
}

return SecondaryWeapons
