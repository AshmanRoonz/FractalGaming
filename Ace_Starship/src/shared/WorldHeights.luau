--!strict
-- The terrain heightfield as pure math, shared by client and server. The client
-- builds the visible Terrain from this; the server evaluates the same functions
-- for line-of-sight (so enemies can't shoot through mountains) without needing
-- any actual terrain voxels. math.noise is deterministic, so both agree exactly.

local WorldHeights = {}

WorldHeights.GROUND_BASE = 0
WorldHeights.GROUND_AMP = 95
WorldHeights.CEIL_BASE = 190
WorldHeights.CEIL_AMP = 85

local OCTAVES = 5
local BASE_FREQ = 0.0088
local LACUNARITY = 2.0
local GAIN = 0.5
local EXPONENT = 2.3
local WARP = 24
local WARP_FREQ = 0.0048

local function ridged(x: number, z: number, seed: number): number
	local sum, amp, freq, prev, norm = 0, 1, BASE_FREQ, 1, 0
	for _ = 1, OCTAVES do
		local n = math.noise(x * freq + seed * 19.3, z * freq + seed * 7.1, seed)
		local r = 1 - math.abs(n)
		r = r * r
		sum += r * amp * prev
		prev = r
		norm += amp
		freq *= LACUNARITY
		amp *= GAIN
	end
	return (sum / norm) ^ EXPONENT
end

local function warp(x: number, z: number): (number, number)
	local wx = x + WARP * math.noise(x * WARP_FREQ, z * WARP_FREQ, 11.2)
	local wz = z + WARP * math.noise(x * WARP_FREQ + 31.7, z * WARP_FREQ + 17.3, 12.7)
	return wx, wz
end

function WorldHeights.groundY(x: number, z: number): number
	local wx, wz = warp(x, z)
	return WorldHeights.GROUND_BASE + WorldHeights.GROUND_AMP * ridged(wx, wz, 1.7)
end

function WorldHeights.ceilY(x: number, z: number): number
	local wx, wz = warp(x + 4000, z - 4000)
	return WorldHeights.CEIL_BASE - WorldHeights.CEIL_AMP * ridged(wx, wz, 5.9)
end

-- True if a straight line from `a` to `b` passes through terrain (floor or
-- ceiling) somewhere in the middle -- i.e. the mountain blocks the shot.
function WorldHeights.blocked(a: Vector3, b: Vector3): boolean
	local d = b - a
	local len = d.Magnitude
	if len < 1 then
		return false
	end
	local steps = math.clamp(math.floor(len / 18), 1, 80)
	for i = 1, steps - 1 do
		local p = a + d * (i / steps)
		if p.Y < WorldHeights.groundY(p.X, p.Z) or p.Y > WorldHeights.ceilY(p.X, p.Z) then
			return true
		end
	end
	return false
end

return WorldHeights
