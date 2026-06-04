--!strict
-- Main (laser) weapons. The "beam" is drawn as a LINE OF OBJECTS stacked between
-- you and your target (a string of candy, chain links, etc.). Cosmetic for now;
-- swap `shape` for a Meshy mesh later. Ordered list; the hangar pedestal cycles it.

export type MainDef = {
	id: string,
	displayName: string,
	color: Color3,
	shape: Enum.PartType, -- the object stacked along the line (if no meshId)
	size: number, -- object size (studs)
	spacing: number, -- distance between objects (smaller = denser line)
	price: number, -- Bolts cost (0 = free / owned by default)
	beam: boolean?, -- true = a real glowing laser beam (not a line of objects)
	object: string?, -- optional name of a model in Assets/Objects to use as the object
	meshId: string?, -- optional "rbxassetid://..." to use a real mesh instead of a shape
	meshScale: number?, -- mesh scale multiplier
	textureId: string?, -- optional mesh texture
}

-- The only non-object laser: a real glowing beam, and the free default.
local MainWeapons: { MainDef } = {
	{ id = "laser", displayName = "Laser", color = Color3.fromRGB(255, 60, 60), shape = Enum.PartType.Ball, size = 1, spacing = 1, price = 0, beam = true },
}

-- Append one laser per asset the user dropped in Assets/Lasers (Studio). The beam
-- stacks a clone of that mesh along the line. Priced in Bolts; tweak below.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local laserFolder = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Lasers")
if laserFolder then
	for _, asset in laserFolder:GetChildren() do
		table.insert(MainWeapons, {
			id = asset.Name,
			displayName = asset.Name,
			color = Color3.fromRGB(255, 255, 255),
			shape = Enum.PartType.Ball,
			size = 4, -- object size along the beam
			spacing = 5, -- gap between stacked objects
			price = 300,
			object = asset.Name, -- cloned from Assets/Lasers
		})
	end
end

return MainWeapons
