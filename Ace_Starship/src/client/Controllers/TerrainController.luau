--!strict
-- "Sandwich" world: open space with procedurally generated mountains below and
-- mirrored mountains hanging above, flown through the gap.
--
-- Mountain shape: ridged multifractal noise + power redistribution + domain
-- warping (per redblobgames.com), which makes sharp ridges and valleys rather
-- than rounded blobs.
--
-- Each chunk is written to Terrain in ONE bulk WriteVoxels call (a 3D occupancy
-- array) instead of thousands of little FillBlocks, so it shades reasonably and
-- comes out smooth. Chunks stream around the ship. Distance fog tuned inside the
-- build radius so chunks fade in from haze rather than popping. LOCAL prototype.

local RunService = game:GetService("RunService")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ShipState = require(script.Parent.ShipState)
local WorldHeights = require(ReplicatedStorage.Shared.WorldHeights)
local BattleSession = require(script.Parent.BattleSession)

local TerrainController = {}

local terrain = workspace.Terrain

local RES = 4 -- Terrain voxel resolution (fixed)
local CHUNK = 160 -- chunk size (multiple of RES)
local VIEW = 5 -- chunk radius kept built (beyond the fog, so chunks are ready)
local CHUNKS_PER_FRAME = 1 -- bulk chunks written per frame (smoother frames)
local FOG_START = 320 -- terrain fades from here...
local FOG_END = 700 -- ...to fully hazed here (well inside the build radius)

-- Heightfield from the shared module (server evaluates the same math for LOS).
local GROUND_BASE = WorldHeights.GROUND_BASE
local GROUND_AMP = WorldHeights.GROUND_AMP
local GROUND_SHELL = 40 -- solid thickness below the floor surface
local CEIL_BASE = WorldHeights.CEIL_BASE
local CEIL_AMP = WorldHeights.CEIL_AMP
local CEIL_SHELL = 40 -- solid thickness above the ceiling surface
local FLOOR_Y = GROUND_BASE - GROUND_SHELL - 80 -- clear-volume bounds
local ROOF_Y = CEIL_BASE + CEIL_SHELL + 80

local GROUND_MAT = Enum.Material.Rock
local CEIL_MAT = Enum.Material.Basalt
local AIR = Enum.Material.Air

local groundY = WorldHeights.groundY
local ceilY = WorldHeights.ceilY

-- Exposed so the ship can stay inside the terrain and weapons can test against it.
TerrainController.groundY = groundY
TerrainController.ceilY = ceilY

-- Bulk-write one surface shell (ground or ceiling) for a chunk.
local function writeShell(x0: number, z0: number, isCeiling: boolean)
	local yMin, yMax, mat, surfaceFn
	if isCeiling then
		yMin = math.floor((CEIL_BASE - CEIL_AMP) / RES) * RES
		yMax = math.ceil((CEIL_BASE + CEIL_SHELL) / RES) * RES
		mat = CEIL_MAT
		surfaceFn = ceilY
	else
		yMin = math.floor((GROUND_BASE - GROUND_SHELL) / RES) * RES
		yMax = math.ceil((GROUND_BASE + GROUND_AMP) / RES) * RES
		mat = GROUND_MAT
		surfaceFn = groundY
	end

	local region = Region3.new(Vector3.new(x0, yMin, z0), Vector3.new(x0 + CHUNK, yMax, z0 + CHUNK))
	local size = region.Size
	local nx = math.floor(size.X / RES + 0.5)
	local ny = math.floor(size.Y / RES + 0.5)
	local nz = math.floor(size.Z / RES + 0.5)
	local corner = region.CFrame.Position - size * 0.5

	local surf = table.create(nx)
	for ix = 1, nx do
		local wx = corner.X + (ix - 0.5) * RES
		local col = table.create(nz)
		for iz = 1, nz do
			col[iz] = surfaceFn(wx, corner.Z + (iz - 0.5) * RES)
		end
		surf[ix] = col
	end

	local mats = table.create(nx)
	local occs = table.create(nx)
	for ix = 1, nx do
		local matY = table.create(ny)
		local occY = table.create(ny)
		local scol = surf[ix]
		for iy = 1, ny do
			local wy = corner.Y + (iy - 0.5) * RES
			local matZ = table.create(nz)
			local occZ = table.create(nz)
			for iz = 1, nz do
				local s = scol[iz]
				local o
				if isCeiling then
					o = math.clamp(((wy + RES / 2) - s) / RES, 0, 1)
				else
					o = math.clamp((s - (wy - RES / 2)) / RES, 0, 1)
				end
				if o > 0 then
					matZ[iz] = mat
					occZ[iz] = o
				else
					matZ[iz] = AIR
					occZ[iz] = 0
				end
			end
			matY[iy] = matZ
			occY[iy] = occZ
		end
		mats[ix] = matY
		occs[ix] = occY
	end

	terrain:WriteVoxels(region, RES, mats, occs)
end

function TerrainController.start()
	local gen = BattleSession.gen
	for _, name in { "Baseplate", "SpawnLocation" } do
		local inst = workspace:FindFirstChild(name)
		if inst then
			inst:Destroy()
		end
	end

	local atmo = Lighting:FindFirstChildOfClass("Atmosphere")
	if atmo then
		atmo:Destroy()
	end
	Lighting.FogColor = Color3.fromRGB(150, 180, 210)
	Lighting.FogStart = FOG_START
	Lighting.FogEnd = FOG_END
	-- Restore open visibility back in the hangar on teardown.
	BattleSession.onCleanup(function()
		Lighting.FogStart = 0
		Lighting.FogEnd = 100000
	end)

	local built: { [string]: boolean } = {}

	local function clearChunk(cx: number, cz: number)
		local center = Vector3.new(cx * CHUNK + CHUNK / 2, (FLOOR_Y + ROOF_Y) / 2, cz * CHUNK + CHUNK / 2)
		terrain:FillBlock(CFrame.new(center), Vector3.new(CHUNK, ROOF_Y - FLOOR_Y, CHUNK), AIR)
	end

	RunService.Heartbeat:Connect(function()
		if BattleSession.gen ~= gen then
			return
		end
		local pos = ShipState.position
		local scx = math.floor(pos.X / CHUNK)
		local scz = math.floor(pos.Z / CHUNK)

		local todo: { { cx: number, cz: number, d: number } } = {}
		for cx = scx - VIEW, scx + VIEW do
			for cz = scz - VIEW, scz + VIEW do
				if not built[cx .. "," .. cz] then
					local d = (cx - scx) * (cx - scx) + (cz - scz) * (cz - scz)
					table.insert(todo, { cx = cx, cz = cz, d = d })
				end
			end
		end
		table.sort(todo, function(a, b)
			return a.d < b.d
		end)
		for i = 1, math.min(CHUNKS_PER_FRAME, #todo) do
			local c = todo[i]
			built[c.cx .. "," .. c.cz] = true
			writeShell(c.cx * CHUNK, c.cz * CHUNK, false)
			writeShell(c.cx * CHUNK, c.cz * CHUNK, true)
		end

		for key in built do
			local sx, sz = key:match("(-?%d+),(-?%d+)")
			local cx, cz = tonumber(sx) :: number, tonumber(sz) :: number
			if math.abs(cx - scx) > VIEW + 1 or math.abs(cz - scz) > VIEW + 1 then
				clearChunk(cx, cz)
				built[key] = nil
			end
		end
	end)
end

return TerrainController
