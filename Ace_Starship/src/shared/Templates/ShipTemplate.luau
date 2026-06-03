--!strict
-- Standardized player ship. Clones the chosen Meshy ship mesh, exposes muzzle
-- points for firing, and applies that ship's mild handling stats. The ship is a
-- cosmetic shell; movement is driven by ShipController (client) + MatchManager.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Ships = require(ReplicatedStorage.Shared.Catalog.Ships)
local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)

export type ShipDef = typeof(Ships.starter_skiff)

local ShipTemplate = {}
ShipTemplate.__index = ShipTemplate

export type Ship = typeof(setmetatable(
	{} :: {
		def: ShipDef,
		model: Model,
		root: BasePart,
		steerSpeed: number,
		muzzles: { Vector3 },
	},
	ShipTemplate
))

local shipAssets = ReplicatedStorage:WaitForChild("Assets"):WaitForChild("Ships")

-- Resolve a ship id that may be a catalog id ("starter_skiff"), a mesh/asset
-- name ("Pyro"), or any imported ship with no catalog entry yet.
local function resolveDef(shipId: string): any
	local d = Ships[shipId]
	if d then
		return d
	end
	for _, def in Ships do
		if def.assetId == shipId then
			return def
		end
	end
	-- Default config for a freshly-imported ship (tune via the catalog later).
	return { id = shipId, displayName = shipId, assetId = shipId, modelYawOffset = 90 }
end

function ShipTemplate.new(defId: string): Ship
	local def = resolveDef(defId)

	local source = shipAssets:FindFirstChild(def.assetId)
	assert(source, `Ship asset missing: {def.assetId}`)

	local model = source:Clone() :: Model
	local root = (model.PrimaryPart or model:FindFirstChildWhichIsA("BasePart")) :: BasePart

	return setmetatable({
		def = def,
		model = model,
		root = root,
		steerSpeed = GameConfig.SteerSpeed * (def.steerSpeedMult or 1),
		muzzles = def.muzzleOffsets or { Vector3.new(0, 0, -4) },
	}, ShipTemplate)
end

-- Returns world-space CFrames for each muzzle, used when firing projectiles.
function ShipTemplate.getMuzzleCFrames(self: Ship): { CFrame }
	local out = {}
	for _, offset in self.muzzles do
		table.insert(out, self.root.CFrame * CFrame.new(offset))
	end
	return out
end

return ShipTemplate
