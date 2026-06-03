--!strict
-- Shared weapon-object builders. Used by the local WeaponController AND by the
-- RemoteShipsController, so other players' projectiles/lasers render with the exact
-- same object you equipped. Objects come from Assets/Lasers, /Projectiles, /Objects.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local WeaponVisuals = {}

local assetsRoot = ReplicatedStorage:WaitForChild("Assets")
local objectFolders: { Instance } = {}
for _, n in { "Lasers", "Projectiles", "Objects" } do
	local f = assetsRoot:FindFirstChild(n)
	if f then
		table.insert(objectFolders, f)
	end
end

-- A named asset's main part (the asset itself if a part, else the first part in it).
function WeaponVisuals.findAssetPart(name: string?): BasePart?
	if not name then
		return nil
	end
	for _, folder in objectFolders do
		local inst = folder:FindFirstChild(name)
		if inst then
			if inst:IsA("BasePart") then
				return inst :: BasePart
			end
			local mp = inst:FindFirstChildWhichIsA("BasePart", true)
			if mp then
				return mp
			end
		end
	end
	return nil
end

-- A single BasePart version of the weapon object (used for stacked beam segments):
-- a clone of the asset mesh scaled to def.size, else a meshId mesh, else a shape.
function WeaponVisuals.makeObject(def: any): BasePart
	local part: BasePart
	local src = WeaponVisuals.findAssetPart(def.object)
	if src then
		part = src:Clone()
		local s = part.Size
		local longest = math.max(s.X, s.Y, s.Z)
		if longest > 0 then
			part.Size = s * (def.size / longest)
		end
	elseif def.meshId then
		local p = Instance.new("Part")
		p.Size = Vector3.new(def.size, def.size, def.size)
		p.Material = Enum.Material.SmoothPlastic
		p.Color = def.color
		local m = Instance.new("SpecialMesh")
		m.MeshType = Enum.MeshType.FileMesh
		m.MeshId = def.meshId
		m.TextureId = def.textureId or ""
		local sc = def.meshScale or 1
		m.Scale = Vector3.new(sc, sc, sc)
		m.Parent = p
		part = p
	else
		local p = Instance.new("Part")
		p.Shape = def.shape
		p.Size = Vector3.new(def.size, def.size, def.size)
		p.Material = Enum.Material.SmoothPlastic
		p.Color = def.color
		part = p
	end
	part.Anchored = true
	part.CanCollide = false
	part.CastShadow = false
	return part
end

local function findAssetSource(name: string?): Instance?
	if not name then
		return nil
	end
	for _, folder in objectFolders do
		local inst = folder:FindFirstChild(name)
		if inst then
			return inst
		end
	end
	return nil
end

-- The whole fired object as a MODEL (all parts intact), scaled uniformly to size.
function WeaponVisuals.makeProjectile(def: any, targetSize: number): Model
	local model: Model
	local src = findAssetSource(def.object)
	if src and src:IsA("Model") then
		model = src:Clone()
	elseif src and src:IsA("BasePart") then
		model = Instance.new("Model")
		local c = src:Clone()
		c.Parent = model
		model.PrimaryPart = c
	else
		model = Instance.new("Model")
		local p = Instance.new("Part")
		p.Shape = if def.shape then def.shape else Enum.PartType.Ball
		p.Size = Vector3.new(2, 2, 2)
		p.Material = Enum.Material.SmoothPlastic
		p.Color = def.color
		p.Parent = model
		model.PrimaryPart = p
	end
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			d.Anchored = true
			d.CanCollide = false
			d.CastShadow = false
		end
	end
	if not model.PrimaryPart then
		model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart", true)
	end
	local _, size = model:GetBoundingBox()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 0 then
		pcall(function()
			model:ScaleTo(targetSize / longest)
		end)
	end
	return model
end

return WeaponVisuals
