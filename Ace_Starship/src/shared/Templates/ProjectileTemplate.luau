--!strict
-- Standardized projectile. Given a ProjectileDef, it clones the right Meshy mesh,
-- launches it, and (on the server) reports hits. Damage is supplied by the
-- weapon/upgrade tree, NOT the skin, so all skins are balance-neutral.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")

local Projectiles = require(ReplicatedStorage.Shared.Catalog.Projectiles)

export type SpawnParams = {
	def: typeof(Projectiles.default_bolt),
	origin: CFrame,
	direction: Vector3,
	speed: number,
	damage: number, -- comes from the firing weapon's current upgrade level
	owner: Player?,
	lifetime: number?,
}

local ProjectileTemplate = {}

local assetsFolder = ReplicatedStorage:WaitForChild("Assets"):WaitForChild("Projectiles")

-- Returns the rendered part (caller decides what to do with hit signals).
function ProjectileTemplate.spawn(params: SpawnParams): BasePart
	local mesh = assetsFolder:FindFirstChild(params.def.assetId)
	assert(mesh, `Projectile asset missing: {params.def.assetId}`)

	local proj = mesh:Clone() :: BasePart
	proj.CFrame = params.origin
	proj.CanCollide = false
	proj.Anchored = false
	proj.AssemblyLinearVelocity = params.direction.Unit * params.speed

	-- Stash gameplay data on the instance for the server collision handler.
	proj:SetAttribute("Damage", params.damage)
	proj:SetAttribute("ProjectileId", params.def.id)
	if params.owner then
		proj:SetAttribute("OwnerUserId", params.owner.UserId)
	end

	-- Cosmetic-only effect hook. Visual flair lives in a separate module so
	-- legendaries can be flashy without touching balance.
	if params.def.effect then
		-- TODO: require(ReplicatedStorage.Shared.Effects)[params.def.effect](proj)
	end

	proj.Parent = workspace
	Debris:AddItem(proj, params.lifetime or 4)
	return proj
end

return ProjectileTemplate
