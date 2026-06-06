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
local Quality = require(ReplicatedStorage.Shared.Quality)

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

local AIR = Enum.Material.Air

-- ===== Mountain themes ====================================================
-- Re-skin the whole world by changing THEME below. `cap`/`capY` paint high peaks
-- (e.g. snow), `base`/`baseY` paint low valleys (e.g. lava); both optional.
local Mat = Enum.Material
-- `sky` is a ColorCorrection filter over the whole view (skybox included). The base
-- skybox is RED, so a plain tint can't make it green/blue; each theme first DESATURATES
-- the red toward grey (sat) then multiplies a tint, with a small brightness nudge.
-- Volcanic keeps the red (sat ~0, warm tint).
local THEMES = {
	rocky = { ground = Mat.Rock, ceil = Mat.Basalt, fog = Color3.fromRGB(150, 180, 210), sky = { tint = Color3.fromRGB(205, 215, 232), sat = -0.45, bright = 0.02 } },
	grassy = { ground = Mat.Grass, ceil = Mat.LeafyGrass, fog = Color3.fromRGB(168, 205, 158), sky = { tint = Color3.fromRGB(190, 240, 180), sat = -0.5, bright = 0.03 } },
	snowcap = { ground = Mat.Grass, cap = Mat.Snow, capY = 55, ceil = Mat.Snow, fog = Color3.fromRGB(214, 226, 240), sky = { tint = Color3.fromRGB(226, 238, 250), sat = -0.6, bright = 0.06 } },
	frozen = { ground = Mat.Glacier, cap = Mat.Snow, capY = 40, ceil = Mat.Ice, fog = Color3.fromRGB(198, 226, 242), sky = { tint = Color3.fromRGB(200, 228, 250), sat = -0.6, bright = 0.05 } },
	volcanic = { ground = Mat.Basalt, base = Mat.CrackedLava, baseY = 15, ceil = Mat.Rock, fog = Color3.fromRGB(72, 46, 42), sky = { tint = Color3.fromRGB(255, 200, 175), sat = 0.05, bright = 0.0 } },
}
-- The world cycles through these as you progress (a new biome after each boss).
-- Newly built terrain uses the current theme, so it transitions gradually as you
-- fly into fresh ground.
local themeOrder = { THEMES.rocky, THEMES.grassy, THEMES.snowcap, THEMES.frozen, THEMES.volcanic }
local currentTheme = themeOrder[1]

local function groundMaterial(wy: number): Enum.Material
	if currentTheme.cap and wy > currentTheme.capY then
		return currentTheme.cap
	end
	if currentTheme.base and wy < currentTheme.baseY then
		return currentTheme.base
	end
	return currentTheme.ground
end

local groundY = WorldHeights.groundY
local ceilY = WorldHeights.ceilY

-- Exposed so the ship can stay inside the terrain and weapons can test against it.
TerrainController.groundY = groundY
TerrainController.ceilY = ceilY

-- Bulk-write one surface shell (ground or ceiling) for a chunk. `step` samples the
-- surface on a coarser grid (step x step voxels share a height -> flatter, fewer
-- triangles). step 1 = full detail; bigger = blockier + lighter (Low quality).
local function writeShell(x0: number, z0: number, isCeiling: boolean, step: number?)
	local gstep = if step and step > 1 then step else 1
	-- In a pinch section the peaks/stalactites grow well past the normal range, so this
	-- chunk's voxel column must be taller to capture them (only here -- normal chunks stay
	-- cheap). The extra height is sampled at the same coarse step, so Low stays light.
	local pinch = WorldHeights.pinchInZ(z0, z0 + CHUNK)
	local yMin, yMax, mat, surfaceFn
	if isCeiling then
		local low = if pinch then WorldHeights.WALL_CEIL_MIN else CEIL_BASE - CEIL_AMP
		yMin = math.floor(low / RES) * RES
		yMax = math.ceil((CEIL_BASE + CEIL_SHELL) / RES) * RES
		mat = currentTheme.ceil
		surfaceFn = ceilY
	else
		yMin = math.floor((GROUND_BASE - GROUND_SHELL) / RES) * RES
		local high = if pinch then WorldHeights.WALL_GROUND_MAX else GROUND_BASE + GROUND_AMP
		yMax = math.ceil(high / RES) * RES
		mat = currentTheme.ground -- base; cap/base by height applied per voxel below
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
		-- Snap to a step-coarser grid, so step x step voxel blocks share a height.
		local six = math.floor((ix - 1) / gstep) * gstep + 1
		local wx = corner.X + (six - 0.5) * RES
		local col = table.create(nz)
		for iz = 1, nz do
			local siz = math.floor((iz - 1) / gstep) * gstep + 1
			col[iz] = surfaceFn(wx, corner.Z + (siz - 0.5) * RES)
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
			-- Ceiling is one material; ground varies by height (snow caps / lava).
			local rowMat = if isCeiling then mat else groundMaterial(wy)
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
					matZ[iz] = rowMat
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

	-- Tablets/phones: cut terrain GPU so Roblox's auto-quality stays higher and keeps
	-- drawing distant enemies. The ground uses a small radius and the CEILING (upper
	-- mountains) an even tighter one -- you look up far less than ahead, so this drops
	-- a lot of ceiling triangles while keeping it visible nearby. Wide fog stays for
	-- enemy visibility; ceiling collision math is unchanged.
	-- Terrain detail follows the Quality setting. VIEW = draw distance; the step values
	-- = how coarsely the mountain/ceiling surface is sampled (bigger = fewer polygons).
	VIEW = Quality.viewDistance() -- 2 low / 3 med / 4 high
	local CEIL_VIEW = VIEW
	local groundStep, ceilStep = 1, 1
	local DRAW_TERRAIN = true -- mountains drawn on all settings (low = coarse/blocky)
	if Quality.level == "med" then
		groundStep, ceilStep = 2, 2
		CEIL_VIEW = math.max(2, VIEW - 1)
	elseif Quality.level == "low" then
		groundStep, ceilStep = 3, 4 -- blocky low-poly mountains + very coarse ceiling
		CEIL_VIEW = math.max(2, VIEW - 1)
	end

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
	currentTheme = themeOrder[1] -- fresh start each battle
	Lighting.FogColor = currentTheme.fog
	-- With mountains off there are no chunk edges to hide, so drop the fog entirely and
	-- you can see monsters at any range. With terrain on, keep it tight so streaming
	-- chunks fade in from haze instead of popping.
	local fogStart = if DRAW_TERRAIN then FOG_START else 90000
	local fogEnd = if DRAW_TERRAIN then FOG_END else 100000
	Lighting.FogStart = fogStart
	Lighting.FogEnd = fogEnd
	local targetFog = currentTheme.fog

	-- Sky/scene color filter that shifts with the biome (skybox included). Skipped on
	-- Low quality (a full-screen post-process pass is costly on weak GPUs).
	local cc = if Quality.level ~= "low" then Instance.new("ColorCorrectionEffect") else nil
	if cc then
		cc.Name = "BiomeSky"
		cc.TintColor = currentTheme.sky.tint
		cc.Saturation = currentTheme.sky.sat
		cc.Brightness = currentTheme.sky.bright
		cc.Parent = Lighting
		BattleSession.track(cc) -- removed on return to hangar
	end
	local targetSky = currentTheme.sky

	-- Restore open visibility back in the hangar on teardown.
	BattleSession.onCleanup(function()
		Lighting.FogStart = 0
		Lighting.FogEnd = 100000
	end)

	-- Rotate the biome each boss cycle. Newly built chunks use the new theme, so it
	-- bleeds in gradually as you fly forward into fresh ground; fog eases over.
	local THEME_EVERY = 10 -- waves per theme (matches the boss cadence)
	local waveEvent = ReplicatedStorage:WaitForChild("WaveEvent")
	waveEvent.OnClientEvent:Connect(function(n)
		if BattleSession.gen ~= gen or type(n) ~= "number" then
			return
		end
		local idx = math.floor((n - 1) / THEME_EVERY) % #themeOrder + 1
		currentTheme = themeOrder[idx]
		targetFog = currentTheme.fog
		targetSky = currentTheme.sky
	end)

	local builtG: { [string]: boolean } = {} -- chunks with the ground shell built
	local builtC: { [string]: boolean } = {} -- chunks with the ceiling shell built

	local function clearChunk(cx: number, cz: number)
		local center = Vector3.new(cx * CHUNK + CHUNK / 2, (FLOOR_Y + ROOF_Y) / 2, cz * CHUNK + CHUNK / 2)
		terrain:FillBlock(CFrame.new(center), Vector3.new(CHUNK, ROOF_Y - FLOOR_Y, CHUNK), AIR)
	end
	-- Clear only the ceiling band (above the ground), for chunks that left the
	-- tighter ceiling radius but are still within the ground radius.
	local function clearCeiling(cx: number, cz: number)
		local yLow = CEIL_BASE - CEIL_AMP - 4
		local center = Vector3.new(cx * CHUNK + CHUNK / 2, (yLow + ROOF_Y) / 2, cz * CHUNK + CHUNK / 2)
		terrain:FillBlock(CFrame.new(center), Vector3.new(CHUNK, ROOF_Y - yLow, CHUNK), AIR)
	end

	RunService.Heartbeat:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		Lighting.FogColor = Lighting.FogColor:Lerp(targetFog, math.clamp(dt * 0.5, 0, 1)) -- ease biome fog
		-- Ease the sky/scene filter toward the current biome (skybox shifts color).
		if cc then
			local a = math.clamp(dt * 0.5, 0, 1)
			cc.TintColor = cc.TintColor:Lerp(targetSky.tint, a)
			cc.Saturation = cc.Saturation + (targetSky.sat - cc.Saturation) * a
			cc.Brightness = cc.Brightness + (targetSky.bright - cc.Brightness) * a
		end
		if not DRAW_TERRAIN then
			return -- lowest setting: no mountains drawn
		end

		local pos = ShipState.position
		local scx = math.floor(pos.X / CHUNK)
		local scz = math.floor(pos.Z / CHUNK)

		local todo: { { cx: number, cz: number, d: number, g: boolean, c: boolean } } = {}
		for cx = scx - VIEW, scx + VIEW do
			for cz = scz - VIEW, scz + VIEW do
				local key = cx .. "," .. cz
				local cheb = math.max(math.abs(cx - scx), math.abs(cz - scz))
				local needG = not builtG[key]
				-- Pinch chunks always carry their ceiling (ground + ceiling overlap there,
				-- so they can't be unloaded separately), regardless of the tighter radius.
				local pinch = WorldHeights.pinchInZ(cz * CHUNK, cz * CHUNK + CHUNK)
				local needC = (cheb <= CEIL_VIEW or pinch) and not builtC[key]
				if needG or needC then
					local d = (cx - scx) * (cx - scx) + (cz - scz) * (cz - scz)
					table.insert(todo, { cx = cx, cz = cz, d = d, g = needG, c = needC })
				end
			end
		end
		table.sort(todo, function(a, b)
			return a.d < b.d
		end)
		for i = 1, math.min(CHUNKS_PER_FRAME, #todo) do
			local t = todo[i]
			local key = t.cx .. "," .. t.cz
			if t.g then
				writeShell(t.cx * CHUNK, t.cz * CHUNK, false, groundStep)
				builtG[key] = true
			end
			if t.c then
				writeShell(t.cx * CHUNK, t.cz * CHUNK, true, ceilStep)
				builtC[key] = true
			end
		end

		-- Unload everything for chunks well outside the ground view.
		for key in builtG do
			local sx, sz = key:match("(-?%d+),(-?%d+)")
			local cx, cz = tonumber(sx) :: number, tonumber(sz) :: number
			if math.abs(cx - scx) > VIEW + 1 or math.abs(cz - scz) > VIEW + 1 then
				clearChunk(cx, cz)
				builtG[key] = nil
				builtC[key] = nil
			end
		end
		-- Unload just the ceiling for chunks outside the tighter ceiling radius. Skip pinch
		-- chunks: their ceiling overlaps the ground wall, so a ceiling-only clear would
		-- punch a hole in the wall -- they're only ever cleared in full by clearChunk above.
		for key in builtC do
			local sx, sz = key:match("(-?%d+),(-?%d+)")
			local cx, cz = tonumber(sx) :: number, tonumber(sz) :: number
			if
				math.max(math.abs(cx - scx), math.abs(cz - scz)) > CEIL_VIEW + 1
				and not WorldHeights.pinchInZ(cz * CHUNK, cz * CHUNK + CHUNK)
			then
				clearCeiling(cx, cz)
				builtC[key] = nil
			end
		end
	end)
end

return TerrainController
