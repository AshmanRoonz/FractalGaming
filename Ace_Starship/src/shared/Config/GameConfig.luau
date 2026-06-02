--!strict
-- Central tuning knobs for the whole game. Anything a designer would want to
-- tweak without touching system code lives here.

local GameConfig = {
	-- Tunnel / run pacing -------------------------------------------------
	SegmentLength = 200, -- studs per tunnel segment
	SegmentsAhead = 6, -- how many segments to keep generated in front of the lead player
	SegmentsBehind = 2, -- how many to keep behind before recycling
	BaseTravelSpeed = 60, -- studs/sec the ship auto-travels at distance 0
	SpeedPerKm = 8, -- travel speed added per 1000 studs of distance

	-- Difficulty scaling (all scale with distance travelled) --------------
	BaseSpawnInterval = 1.5, -- seconds between enemy spawns at distance 0
	MinSpawnInterval = 0.35, -- floor, no matter how deep
	SpawnIntervalDecayPerKm = 0.15,
	EnemyHealthPerKm = 0.25, -- +25% enemy health per km

	-- Bosses --------------------------------------------------------------
	BossEveryStuds = 4000, -- a boss blocks the tunnel at each multiple
	BossClearReward = 250, -- bonus Bolts for clearing a boss

	-- Co-op ---------------------------------------------------------------
	MaxPartySize = 4,

	-- Player ship ---------------------------------------------------------
	SteerRadius = 18, -- how far from tunnel center the ship can move
	SteerSpeed = 40, -- studs/sec lateral response

	-- Misc ----------------------------------------------------------------
	RespawnGraceSeconds = 3,
}

return GameConfig
