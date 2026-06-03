--!strict
-- Shared pet body builder + catalog lookup. Used by the local PetController AND by
-- RemoteShipsController, so other players' equipped pet flies alongside them.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Pets = require(ReplicatedStorage.Shared.Catalog.Pets)

local PetVisuals = {}

local petAssets = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Pets")

function PetVisuals.findById(id: string?): any
	for _, d in Pets do
		if d.id == id then
			return d
		end
	end
	return Pets[1]
end

-- Pet body model (PrimaryPart set): an asset from Assets/Pets if named, else an orb.
function PetVisuals.buildBody(cfg: any): Model
	if cfg.object and petAssets then
		local src = petAssets:FindFirstChild(cfg.object)
		if src then
			local model: Model? = nil
			if src:IsA("Model") then
				model = src:Clone()
			elseif src:IsA("BasePart") then
				model = Instance.new("Model")
				local c = src:Clone()
				c.Parent = model
				model.PrimaryPart = c
			end
			if model then
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
						model:ScaleTo((cfg.orbSize * 2) / longest)
					end)
				end
				return model
			end
		end
	end
	-- Glowing orb placeholder, with a little forward-facing pupil.
	local orb = Instance.new("Model")
	local body = Instance.new("Part")
	body.Shape = Enum.PartType.Ball
	body.Size = Vector3.new(cfg.orbSize, cfg.orbSize, cfg.orbSize)
	body.Color = cfg.bodyColor
	body.Material = Enum.Material.Neon
	body.Anchored = true
	body.CanCollide = false
	body.CastShadow = false
	body.Parent = orb
	local pupil = Instance.new("Part")
	pupil.Shape = Enum.PartType.Ball
	pupil.Size = Vector3.new(cfg.orbSize * 0.42, cfg.orbSize * 0.42, cfg.orbSize * 0.42)
	pupil.Color = Color3.fromRGB(20, 30, 40)
	pupil.Material = Enum.Material.SmoothPlastic
	pupil.Anchored = true
	pupil.CanCollide = false
	pupil.CastShadow = false
	pupil.CFrame = CFrame.new(0, 0, -cfg.orbSize * 0.5)
	pupil.Parent = orb
	orb.PrimaryPart = body
	return orb
end

return PetVisuals
