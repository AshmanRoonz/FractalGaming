--!strict
-- Code-generated tunnel, mirroring the LSS approach: a tube you fly through with
-- a tiling texture on the inner wall, built from N flat panels per ring. Rings
-- are laid along an arbitrary centerline, so the tube can run straight, curve,
-- and fork.
--
-- A Texture is applied to each panel's inner face and tiled, so a PNG asset id
-- skins the whole tunnel.

local TunnelBuilder = {}

export type Options = {
	radius: number?, -- tube radius (default 70)
	sides: number?, -- panels per ring (default 16)
	textureId: string?, -- rbxassetid for the wall PNG; "" = untextured color
	tileStuds: number?, -- studs per texture tile (default 35)
	color: Color3?,
	material: Enum.Material?,
	-- Straight-tube convenience (used by TunnelBuilder.build):
	origin: Vector3?,
	length: number?,
	sectionLength: number?,
}

local DEFAULTS = {
	radius = 70,
	sides = 16,
	textureId = "",
	tileStuds = 35,
	color = Color3.fromRGB(42, 50, 66),
	material = Enum.Material.Metal,
}

local function resolve(o: Options)
	return {
		radius = o.radius or DEFAULTS.radius,
		sides = o.sides or DEFAULTS.sides,
		textureId = o.textureId or DEFAULTS.textureId,
		tileStuds = o.tileStuds or DEFAULTS.tileStuds,
		color = o.color or DEFAULTS.color,
		material = o.material or DEFAULTS.material,
	}
end

-- Optional gap: { center = angle, halfWidth = angle }. Panels whose angle falls
-- within the gap are skipped, cutting an opening in the wall (for fork-mouths).
export type Gap = { center: number, halfWidth: number }

-- Build one ring of panels into `parent`, centered at ringCF
-- (ringCF.LookVector = tunnel direction), spanning `sectionLength` along it.
local function ringPanels(parent: Instance, ringCF: CFrame, sectionLength: number, cfg, gap: Gap?)
	local panelWidth = 2 * cfg.radius * math.tan(math.pi / cfg.sides) * 1.02
	for i = 0, cfg.sides - 1 do
		local theta = (i / cfg.sides) * math.pi * 2

		if gap then
			-- Angular distance from the gap center, wrapped to [0, pi].
			local d = math.abs(((theta - gap.center + math.pi) % (2 * math.pi)) - math.pi)
			if d < gap.halfWidth then
				continue
			end
		end

		local cosT, sinT = math.cos(theta), math.sin(theta)
		local radialOut = ringCF.RightVector * cosT + ringCF.UpVector * sinT
		local tangent = -ringCF.RightVector * sinT + ringCF.UpVector * cosT
		local center = ringCF.Position + radialOut * cfg.radius

		local panel = Instance.new("Part")
		panel.Anchored = true
		panel.CanCollide = false
		panel.CastShadow = false
		panel.Size = Vector3.new(panelWidth, 2, sectionLength)
		panel.CFrame = CFrame.fromMatrix(center, tangent, -radialOut) -- +Y faces center
		panel.Color = cfg.color
		panel.Material = cfg.material

		if cfg.textureId ~= "" then
			local tex = Instance.new("Texture")
			tex.Texture = cfg.textureId
			tex.Face = Enum.NormalId.Top
			tex.StudsPerTileU = cfg.tileStuds
			tex.StudsPerTileV = cfg.tileStuds
			tex.Parent = panel
		end

		panel.Parent = parent
	end
end

-- Build a single ring as its own Model (so streaming callers can recycle one
-- ring at a time). ringCF.LookVector = tunnel direction.
function TunnelBuilder.buildRing(ringCF: CFrame, sectionLength: number, options: Options?, gap: Gap?): Model
	local cfg = resolve(options or {})
	local ring = Instance.new("Model")
	ring.Name = "Ring"
	ringPanels(ring, ringCF, sectionLength, cfg, gap)
	return ring
end

-- Build a tube following a polyline of world points. Returns a Model (the caller
-- parents it). Points should be spaced roughly evenly (~60-100 studs).
function TunnelBuilder.buildAlong(points: { Vector3 }, options: Options?): Model
	local cfg = resolve(options or {})
	local model = Instance.new("Model")
	model.Name = "TunnelPath"
	for i = 1, #points - 1 do
		local a, b = points[i], points[i + 1]
		local dir = b - a
		local len = dir.Magnitude
		if len > 0.01 then
			local ringCF = CFrame.lookAt(a + dir * 0.5, b)
			ringPanels(model, ringCF, len * 1.04, cfg)
		end
	end
	return model
end

-- Convenience: a single straight tube along -Z from `origin`.
function TunnelBuilder.build(options: Options?): Model
	local o = options or {}
	local origin = o.origin or Vector3.new(0, 60, 0)
	local length = o.length or 4000
	local step = o.sectionLength or 120
	local points = {}
	local n = math.ceil(length / step)
	for i = 0, n do
		table.insert(points, origin - Vector3.new(0, 0, i * step))
	end
	return TunnelBuilder.buildAlong(points, options)
end

return TunnelBuilder
