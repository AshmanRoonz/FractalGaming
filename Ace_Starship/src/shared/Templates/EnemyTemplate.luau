--!strict
-- Standardized enemy. Wraps a Meshy mesh + an EnemyDef into a live, moving,
-- damageable object. Bosses use the same template with isBoss + an attack pattern.
-- This template is server-authoritative: only the server mutates health.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Enemies = require(ReplicatedStorage.Shared.Catalog.Enemies)
local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)

export type EnemyDef = typeof(Enemies.drifter)

local EnemyTemplate = {}
EnemyTemplate.__index = EnemyTemplate

export type Enemy = typeof(setmetatable(
	{} :: {
		def: EnemyDef,
		model: Model,
		root: BasePart,
		health: number,
		maxHealth: number,
		alive: boolean,
	},
	EnemyTemplate
))

local enemyAssets = ReplicatedStorage:WaitForChild("Assets"):WaitForChild("Enemies")
local bossAssets = ReplicatedStorage:WaitForChild("Assets"):WaitForChild("Bosses")

-- distanceKm drives health scaling (see GameConfig.EnemyHealthPerKm).
function EnemyTemplate.new(defId: string, spawnCFrame: CFrame, distanceStuds: number): Enemy
	local def = Enemies[defId]
	assert(def, `Unknown enemy id: {defId}`)

	local source = (def.isBoss and bossAssets or enemyAssets):FindFirstChild(def.assetId)
	assert(source, `Enemy asset missing: {def.assetId}`)

	local model = source:Clone() :: Model
	local root = (model.PrimaryPart or model:FindFirstChildWhichIsA("BasePart")) :: BasePart
	model:PivotTo(spawnCFrame)
	model.Parent = workspace

	local km = distanceStuds / 1000
	local scaledHealth = def.baseHealth * (1 + GameConfig.EnemyHealthPerKm * km)

	local self = setmetatable({
		def = def,
		model = model,
		root = root,
		health = scaledHealth,
		maxHealth = scaledHealth,
		alive = true,
	}, EnemyTemplate)

	root:SetAttribute("EnemyId", def.id)
	return self
end

-- Server-only. Returns true if this hit killed the enemy.
function EnemyTemplate.takeDamage(self: Enemy, amount: number): boolean
	if not self.alive then
		return false
	end
	self.health -= amount
	if self.health <= 0 then
		self.alive = false
		return true
	end
	return false
end

-- Simple homing-toward-target step. Called each tick by EnemySpawner/BossManager.
function EnemyTemplate.step(self: Enemy, dt: number, targetPos: Vector3)
	if not self.alive then
		return
	end
	local toTarget = (targetPos - self.root.Position)
	if toTarget.Magnitude > 0.1 then
		self.root.AssemblyLinearVelocity = toTarget.Unit * self.def.speed
	end
end

function EnemyTemplate.destroy(self: Enemy)
	self.alive = false
	self.model:Destroy()
end

return EnemyTemplate
