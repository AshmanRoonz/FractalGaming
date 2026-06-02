--!strict
-- Tunnel looks, one per "level" theme. Each maps to an uploaded wall PNG plus a
-- panel color and tile size. Levels pick a theme by key; upload a PNG, paste its
-- rbxassetid here once, and that theme is ready everywhere.
--
-- To add a theme: upload the PNG to Roblox, copy its asset id, add a row below.
--
-- NOTE on texture types:
--   * "panel" textures (HullDeck, HullPlating, CyberHull) are seamless tiles and
--     look best on the flat-panel tube.
--   * "pipe" textures were authored to wrap a whole cylinder once. On the panel
--     tube they tile like a pattern rather than wrapping; they still look good,
--     just busier. Bump tileStuds up if a pipe theme looks too repetitive.
--   * "sphere" textures (CircuitCitySphere) are for spherical rooms / boss
--     arenas later, not really tunnels; kept here for convenience.

export type Theme = {
	displayName: string,
	textureId: string, -- "rbxassetid://<number>"; "" = plain color, no texture
	color: Color3, -- panel base color (shows behind/around the texture)
	tileStuds: number, -- studs per texture tile (smaller = more repeats)
}

local TunnelThemes: { [string]: Theme } = {
	-- Seamless panel tiles (best fit) ------------------------------------
	HullDeck = {
		displayName = "Hull Deck",
		textureId = "rbxassetid://91631891507296", -- panel1a
		color = Color3.fromRGB(42, 50, 66),
		tileStuds = 35,
	},
	HullPlating = {
		displayName = "Hull Plating",
		textureId = "rbxassetid://128315909592484", -- panel1
		color = Color3.fromRGB(45, 48, 55),
		tileStuds = 35,
	},
	CyberHull = {
		displayName = "Cyber Hull",
		textureId = "rbxassetid://117893460915930", -- panel_cp
		color = Color3.fromRGB(40, 30, 55),
		tileStuds = 35,
	},

	-- Pipe textures (wrap-style; tile a bit busier) ----------------------
	Techno = {
		displayName = "Techno",
		textureId = "rbxassetid://107861588029433", -- Techno-Pipe
		color = Color3.fromRGB(30, 50, 55),
		tileStuds = 50,
	},
	Starbase = {
		displayName = "Starbase",
		textureId = "rbxassetid://71984860328973", -- Starbase-Pipes
		color = Color3.fromRGB(55, 60, 72),
		tileStuds = 50,
	},
	Jewel = {
		displayName = "Jewel",
		textureId = "rbxassetid://85681727422309", -- Jewel-Pipe
		color = Color3.fromRGB(50, 35, 60),
		tileStuds = 50,
	},
	Datacenter = {
		displayName = "Datacenter",
		textureId = "rbxassetid://106802776165574", -- Datacenter-Pipe
		color = Color3.fromRGB(30, 42, 60),
		tileStuds = 50,
	},
	Cyberpunk = {
		displayName = "Cyberpunk",
		textureId = "rbxassetid://136599729327883", -- Cyberpunk-Pipe
		color = Color3.fromRGB(45, 30, 55),
		tileStuds = 50,
	},
	CircuitCity = {
		displayName = "Circuit City",
		textureId = "rbxassetid://138106280755353", -- Circuitcity-Pipe
		color = Color3.fromRGB(28, 45, 60),
		tileStuds = 50,
	},
	Alien = {
		displayName = "Alien",
		textureId = "rbxassetid://131465374337132", -- Alien-Pipes
		color = Color3.fromRGB(35, 50, 42),
		tileStuds = 50,
	},

	-- Sphere texture (for rooms / boss arenas, not tunnels) --------------
	CircuitCitySphere = {
		displayName = "Circuit City (Sphere)",
		textureId = "rbxassetid://113625006004918", -- Circuitcity-Sphere
		color = Color3.fromRGB(28, 45, 60),
		tileStuds = 60,
	},
}

return TunnelThemes
