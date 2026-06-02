--!strict
-- The tunnel's centerline -- the single source of truth for where the tunnel
-- goes. It's a list of frames (CFrames) spaced evenly along the path, generated
-- on demand as the ship advances, with gentle yaw/pitch drift so the tunnel
-- winds. The ship flies relative to this path and the tunnel mesh is built along
-- it, so the two can never disagree.

local TunnelPath = {}

local SPACING = 80 -- studs between frames
local RADIUS = 70 -- tube radius
local MAX_YAW = math.rad(5) -- max heading drift per frame step
local MAX_PITCH = math.rad(3)

TunnelPath.spacing = SPACING
TunnelPath.radius = RADIUS
TunnelPath.shipDistance = 0 -- how far the ship has travelled along the path

local frames: { CFrame } = { CFrame.new(0, 60, 0) } -- frame 1 faces -Z
local driftYaw, driftPitch = 0, 0

local function appendFrame()
	local last = frames[#frames]
	-- Smooth random walk on the drift so curves ease rather than jitter.
	driftYaw = math.clamp(driftYaw + (math.random() - 0.5) * math.rad(2.5), -MAX_YAW, MAX_YAW)
	driftPitch = math.clamp(driftPitch + (math.random() - 0.5) * math.rad(1.5), -MAX_PITCH, MAX_PITCH)
	local rot = last * CFrame.Angles(driftPitch, driftYaw, 0)
	local nextPos = last.Position + rot.LookVector * SPACING
	frames[#frames + 1] = CFrame.lookAt(nextPos, nextPos + rot.LookVector, Vector3.yAxis)
end

function TunnelPath.ensureUpTo(index: number)
	while #frames < index do
		appendFrame()
	end
end

-- 1-based frame index covering a given distance.
function TunnelPath.indexAt(distance: number): number
	return math.floor(math.max(0, distance) / SPACING) + 1
end

function TunnelPath.frame(index: number): CFrame
	TunnelPath.ensureUpTo(index)
	return frames[index]
end

-- Interpolated frame at an arbitrary distance along the path.
function TunnelPath.frameAt(distance: number): CFrame
	distance = math.max(0, distance)
	local idxF = distance / SPACING
	local i = math.floor(idxF) + 1
	TunnelPath.ensureUpTo(i + 1)
	return frames[i]:Lerp(frames[i + 1], idxF - math.floor(idxF))
end

return TunnelPath
