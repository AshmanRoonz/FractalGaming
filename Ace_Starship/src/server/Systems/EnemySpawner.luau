--!strict
-- Spawns regular enemies during a run. Spawn interval and enemy health scale
-- with distance (GameConfig). Picks enemy types by spawnWeight, gated by each
-- type's minDistance. Bosses are NOT handled here (see BossManager).

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local Enemies = require(ReplicatedStorage.Shared.Catalog.Enemies)
local EnemyTemplate = require(ReplicatedStorage.Shared.Templates.EnemyTemplate)

local EnemySpawner = {}
EnemySpawner.__index = EnemySpawner

export type Spawner = typeof(setmetatable(
	{} :: {
		live: { EnemyTemplate.Enemy },
		sinceLastSpawn: number,
	},
	EnemySpawner
))

function EnemySpawner.new(): Spawner
	return setmetatable({ live = {}, sinceLastSpawn = 0 }, EnemySpawner)
end

local function currentInterval(distanceStuds: number): number
	local km = distanceStuds / 1000
	local interval = GameConfig.BaseSpawnInterval - GameConfig.SpawnIntervalDecayPerKm * km
	return math.max(GameConfig.MinSpawnInterval, interval)
end

-- Weighted pick among enemies whose minDistance has been reached (boss excluded).
local function pickEnemyId(distanceStuds: number): string?
	local pool = {}
	local total = 0
	for id, def in Enemies do
		if def.isBoss or def.spawnWeight <= 0 then
			continue
		end
		if distanceStuds < def.minDistance then
			continue
		end
		total += def.spawnWeight
		table.insert(pool, { id = id, cumulative = total })
	end
	if total == 0 then
		return nil
	end
	local roll = math.random() * total
	for _, entry in pool do
		if roll <= entry.cumulative then
			return entry.id
		end
	end
	return nil
end

-- spawnCFrameAhead: where to place the enemy (in front of the player group).
function EnemySpawner.update(self: Spawner, dt: number, distanceStuds: number, spawnCFrameAhead: CFrame, targetPos: Vector3)
	self.sinceLastSpawn += dt
	if self.sinceLastSpawn >= currentInterval(distanceStuds) then
		self.sinceLastSpawn = 0
		local id = pickEnemyId(distanceStuds)
		if id then
			table.insert(self.live, EnemyTemplate.new(id, spawnCFrameAhead, distanceStuds))
		end
	end

	-- Move enemies and cull the dead.
	for i = #self.live, 1, -1 do
		local enemy = self.live[i]
		if not enemy.alive then
			enemy:destroy()
			table.remove(self.live, i)
		else
			enemy:step(dt, targetPos)
		end
	end
end

return EnemySpawner
