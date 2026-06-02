--!strict
-- Bosses. The tunnel is endless; every GameConfig.BossEveryStuds a boss is
-- placed to block progress. While a boss is alive the run "gate" is closed:
-- MatchManager pauses forward distance until the boss dies, then awards the
-- clear bonus and re-opens the tunnel. Bosses reuse EnemyTemplate + a pattern.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local Enemies = require(ReplicatedStorage.Shared.Catalog.Enemies)
local EnemyTemplate = require(ReplicatedStorage.Shared.Templates.EnemyTemplate)

local BossManager = {}
BossManager.__index = BossManager

export type BossState = typeof(setmetatable(
	{} :: {
		nextBossAt: number, -- distance of the next gate
		active: EnemyTemplate.Enemy?,
		patternClock: number,
	},
	BossManager
))

-- Attack patterns. Visual/projectile behavior keyed by EnemyDef.attackPattern.
local PATTERNS: { [string]: (boss: EnemyTemplate.Enemy, t: number) -> () } = {
	radial_burst = function(_boss, _t)
		-- TODO: fire a ring of projectiles every few seconds.
	end,
}

function BossManager.new(): BossState
	return setmetatable({
		nextBossAt = GameConfig.BossEveryStuds,
		active = nil,
		patternClock = 0,
	}, BossManager)
end

-- Returns the chosen boss id for a given gate. For MVP, always the Gatekeeper.
local function pickBossId(_distance: number): string
	return "gatekeeper"
end

-- Returns "spawned" | "active" | "cleared" | nil so MatchManager can gate distance.
function BossManager.update(self: BossState, dt: number, distance: number, spawnCFrame: CFrame, targetPos: Vector3): string?
	-- Spawn a boss when the player reaches the gate.
	if not self.active and distance >= self.nextBossAt then
		local id = pickBossId(distance)
		self.active = EnemyTemplate.new(id, spawnCFrame, distance)
		self.patternClock = 0
		return "spawned"
	end

	if self.active then
		if not self.active.alive then
			self.active:destroy()
			self.active = nil
			self.nextBossAt += GameConfig.BossEveryStuds
			return "cleared"
		end
		self.patternClock += dt
		self.active:step(dt, targetPos)
		local def = Enemies[self.active.def.id]
		if def.attackPattern and PATTERNS[def.attackPattern] then
			PATTERNS[def.attackPattern](self.active, self.patternClock)
		end
		return "active"
	end

	return nil
end

return BossManager
