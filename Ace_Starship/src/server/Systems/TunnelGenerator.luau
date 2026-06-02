--!strict
-- Procedural tunnel. Stitches modular segments end-to-end ahead of the lead
-- player and recycles segments left behind. Segments are Meshy/Studio models
-- stored under Assets.TunnelSegments. Difficulty/biome are layered on by
-- MatchManager; this module only owns geometry and recycling.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)

local TunnelGenerator = {}
TunnelGenerator.__index = TunnelGenerator

export type Tunnel = typeof(setmetatable(
	{} :: {
		segments: { Model }, -- active segments, ordered front-to-back of travel
		nextSpawnZ: number, -- world distance where the next segment attaches
		segmentPool: { Model }, -- recycled, ready to reuse
	},
	TunnelGenerator
))

local segmentAssets = ReplicatedStorage:WaitForChild("Assets"):WaitForChild("TunnelSegments")

local function acquireSegment(self: Tunnel): Model
	local seg = table.remove(self.segmentPool)
	if seg then
		return seg
	end
	-- Pick a random segment variant; for MVP there may be only one.
	local variants = segmentAssets:GetChildren()
	return (variants[math.random(#variants)] :: Model):Clone()
end

function TunnelGenerator.new(): Tunnel
	return setmetatable({
		segments = {},
		nextSpawnZ = 0,
		segmentPool = {},
	}, TunnelGenerator)
end

-- Ensure SegmentsAhead segments exist past the player's current distance.
function TunnelGenerator.update(self: Tunnel, leadDistance: number)
	local targetZ = leadDistance + GameConfig.SegmentsAhead * GameConfig.SegmentLength
	while self.nextSpawnZ < targetZ do
		local seg = acquireSegment(self)
		seg:PivotTo(CFrame.new(0, 0, -self.nextSpawnZ))
		seg.Parent = workspace
		table.insert(self.segments, seg)
		self.nextSpawnZ += GameConfig.SegmentLength
	end

	-- Recycle anything well behind the player back into the pool.
	local cutoff = leadDistance - GameConfig.SegmentsBehind * GameConfig.SegmentLength
	for i = #self.segments, 1, -1 do
		local seg = self.segments[i]
		if -seg:GetPivot().Z > cutoff then
			continue
		end
		table.remove(self.segments, i)
		seg.Parent = nil
		table.insert(self.segmentPool, seg)
	end
end

function TunnelGenerator.destroy(self: Tunnel)
	for _, seg in self.segments do
		seg:Destroy()
	end
	for _, seg in self.segmentPool do
		seg:Destroy()
	end
end

return TunnelGenerator
