--!strict
-- Pet catalog. Pets are little buddies that trail your ship and auto-fire at
-- enemies. Cosmetic + stat variations, bought from the hangar pet podium. An
-- optional `object` names a model in Assets/Pets to use as the body (else a glowing
-- orb). Ordered list.

export type PetDef = {
	id: string,
	displayName: string,
	bodyColor: Color3,
	laserColor: Color3,
	orbSize: number,
	range: number,
	damage: number,
	cooldown: number,
	price: number,
	object: string?,
}

local Pets: { PetDef } = {
	{ id = "orb", displayName = "Spark Orb", bodyColor = Color3.fromRGB(90, 230, 170), laserColor = Color3.fromRGB(120, 255, 170), orbSize = 3.6, range = 360, damage = 14, cooldown = 0.5, price = 0 },
	{ id = "ember", displayName = "Ember Orb", bodyColor = Color3.fromRGB(255, 130, 70), laserColor = Color3.fromRGB(255, 150, 60), orbSize = 3.8, range = 360, damage = 20, cooldown = 0.55, price = 450 },
	{ id = "frost", displayName = "Frost Orb", bodyColor = Color3.fromRGB(120, 200, 255), laserColor = Color3.fromRGB(150, 220, 255), orbSize = 3.8, range = 440, damage = 14, cooldown = 0.45, price = 500 },
	{ id = "void", displayName = "Void Orb", bodyColor = Color3.fromRGB(185, 120, 255), laserColor = Color3.fromRGB(205, 130, 255), orbSize = 4.2, range = 400, damage = 24, cooldown = 0.6, price = 800 },
}

-- Append a pet per asset dropped in Assets/Pets (Studio); uses that model as the body.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local petFolder = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Pets")
if petFolder then
	for _, asset in petFolder:GetChildren() do
		table.insert(Pets, {
			id = asset.Name,
			displayName = asset.Name,
			bodyColor = Color3.fromRGB(255, 255, 255),
			laserColor = Color3.fromRGB(160, 255, 200),
			orbSize = 5,
			range = 380,
			damage = 18,
			cooldown = 0.5,
			price = 600,
			object = asset.Name,
		})
	end
end

return Pets
