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

-- All projectiles are real objects from Assets/Projectiles. "Missile" is the free
-- starting projectile; everything else costs Bolts.
local DEFAULT_SEC = "Missile"
local SecondaryWeapons: { SecDef } = {}

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local projFolder = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Projectiles")
if projFolder then
	for _, asset in projFolder:GetChildren() do
		local def: SecDef = {
			id = asset.Name,
			displayName = asset.Name,
			color = Color3.fromRGB(255, 255, 255),
			size = 5, -- fired object size
			shape = Enum.PartType.Ball,
			price = 500,
			object = asset.Name, -- cloned from Assets/Projectiles
		}
		if asset.Name == DEFAULT_SEC then
			table.insert(SecondaryWeapons, 1, def) -- the default goes first
		else
			table.insert(SecondaryWeapons, def)
		end
	end
end
-- The first projectile (Missile if present, else whatever loaded first) is free.
if SecondaryWeapons[1] then
	SecondaryWeapons[1].price = 0
end

return SecondaryWeapons
