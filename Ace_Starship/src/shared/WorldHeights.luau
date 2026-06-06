--!strict
-- The terrain heightfield as pure math, shared by client and server. The client
-- builds the visible Terrain from this; the server evaluates the same functions
-- for line-of-sight (so enemies can't shoot through mountains) without needing
-- any actual terrain voxels. math.noise is deterministic, so both agree exactly.
--
-- COURSE FEATURES: along the spawn-forward line (-Z), the world periodically pinches
-- into a corridor. In a "pinch" section the mountain amplitude is cranked UP at the
-- sides so the natural ground peaks rise and the ceiling stalactites drop until their
-- tips touch (a craggy barrier, not a flat wall), while a clear lane is kept low down
-- the middle. The lane narrows across the section (converging), and every few sections
-- a central ridge splits it into a fork. Between sections the world opens back up so
-- there's room to breathe and look around.

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

-- ===== Course feature tuning ==============================================
local FEATURES_ON = true
local FIRST_OPEN = 1500 -- open space right after spawn before the first pinch (studs)
local FEATURE_PERIOD = 3600 -- distance between the start of one pinch and the next
local FEATURE_LEN = 2200 -- how much of each period is a walled pinch (rest is open)
local OPEN_HALF = 300 -- clear-lane half-width where a pinch begins
local NARROW_HALF = 150 -- clear-lane half-width by the end of a pinch (still roomy to fly)
local WALL_SOFT = 80 -- soft thickness of the wall faces (smooth ramp, not a cliff)
local FORK_EVERY = 3 -- every Nth pinch grows a central ridge -> fork in the road
local FORK_HALF = 55 -- half-width of that central ridge (leaves a lane on each side)
-- A wall seals BY CONSTRUCTION: in the wall the ground rises ABOVE the shared MEET
-- altitude and the ceiling drops BELOW it, so ground >= MEET >= ceiling at every column
-- regardless of how the two (independent) noises line up. No more sneak-through gaps.
local MEET = 100 -- altitude where ground peaks and ceiling tips fuse (near flight height)
local GAMP_W = 60 -- craggy height of wall ground peaks above MEET
local CAMP_W = 60 -- craggy depth of wall ceiling tips below MEET
local CLEAR = 25 -- how much the open lane is pushed clear (ground down / ceiling up)

-- Extremes used to size the terrain voxel column in pinch chunks (see TerrainController).
WorldHeights.WALL_GROUND_MAX = MEET + GAMP_W
WorldHeights.WALL_CEIL_MIN = MEET - CAMP_W

local function smoothstep(e0: number, e1: number, x: number): number
	local t = math.clamp((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)
end

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

-- Envelope (0..1) of the pinch along Z only: 0 in open stretches, ramps to 1 inside a
-- walled section. Cheap (no noise); used both per-column and for chunk voxel sizing.
local function envAtZ(z: number): number
	if not FEATURES_ON then
		return 0
	end
	local p = -z -- forward progress (ship flies -Z)
	if p < FIRST_OPEN then
		return 0
	end
	local q = p - FIRST_OPEN
	local seg = math.floor(q / FEATURE_PERIOD)
	local frac = q - seg * FEATURE_PERIOD
	if frac > FEATURE_LEN then
		return 0 -- open stretch between pinches
	end
	local t = frac / FEATURE_LEN
	return smoothstep(0, 0.12, t) * (1 - smoothstep(0.88, 1, t))
end

-- Per-column feature: returns (env, cross). cross is 0 in the clear lane and rises to
-- 1 in the wall (sides + optional fork ridge). No noise here, so it's cheap.
local function feature(x: number, z: number): (number, number)
	local e = envAtZ(z)
	if e <= 0 then
		return 0, 0
	end
	local p = -z
	local q = p - FIRST_OPEN
	local seg = math.floor(q / FEATURE_PERIOD)
	local t = (q - seg * FEATURE_PERIOD) / FEATURE_LEN
	local half = OPEN_HALF + (NARROW_HALF - OPEN_HALF) * t -- lane converges across the pinch
	local d = math.abs(x) -- corridor centered on x = 0 (the spawn-forward line)
	local cross = smoothstep(half, half + WALL_SOFT, d) -- 0 in lane, 1 out in the wall
	if (seg % FORK_EVERY == 0) and t > 0.45 then
		local fenv = smoothstep(0.45, 0.62, t) -- the fork grows partway into the pinch
		local ridge = 1 - smoothstep(FORK_HALF, FORK_HALF + WALL_SOFT, d) -- 1 at the center
		cross = math.max(cross, fenv * ridge)
	end
	return e, cross
end

function WorldHeights.groundY(x: number, z: number): number
	local wx, wz = warp(x, z)
	local r = ridged(wx, wz, 1.7)
	local g = WorldHeights.GROUND_BASE + WorldHeights.GROUND_AMP * r
	local e, cross = feature(x, z)
	if e > 0 then
		-- Blend toward a craggy wall that always sits ABOVE the MEET line; clear the lane.
		local gw = e * cross
		g = g * (1 - gw) + (MEET + GAMP_W * r) * gw
		g -= e * (1 - cross) * CLEAR
	end
	return g
end

function WorldHeights.ceilY(x: number, z: number): number
	local wx, wz = warp(x + 4000, z - 4000)
	local r = ridged(wx, wz, 5.9)
	local c = WorldHeights.CEIL_BASE - WorldHeights.CEIL_AMP * r
	local e, cross = feature(x, z)
	if e > 0 then
		-- Blend toward a craggy wall that always sits BELOW the MEET line; raise the lane.
		local cw = e * cross
		c = c * (1 - cw) + (MEET - CAMP_W * r) * cw
		c += e * (1 - cross) * CLEAR
	end
	return c
end

-- True if the gap is fully pinched shut at this column (ground at/above ceiling): used
-- by ship collision to block flying into a wall.
function WorldHeights.solid(x: number, z: number): boolean
	return WorldHeights.ceilY(x, z) <= WorldHeights.groundY(x, z)
end

-- Does any pinch overlap this Z span? Lets the terrain voxelizer use a taller column
-- only where walls can actually reach, keeping normal chunks cheap.
function WorldHeights.pinchInZ(zStart: number, zEnd: number): boolean
	if not FEATURES_ON then
		return false
	end
	local lo = math.min(zStart, zEnd)
	local hi = math.max(zStart, zEnd)
	local step = (hi - lo) / 6
	for i = 0, 6 do
		if envAtZ(lo + step * i) > 0.001 then
			return true
		end
	end
	return false
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
