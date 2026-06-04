--!strict
-- Per-player hangars on a large shared concourse floor. Each bay uses an
-- imported hangar asset for the structure, with the player's selected ship on a
-- pad in the middle and a pedestal button to change ships. Walking into the ship
-- launches (detected by init.server via padCenter). Bays sit side by side.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local MarketplaceService = game:GetService("MarketplaceService")
local DataStoreService = game:GetService("DataStoreService")

local ShipTemplate = require(ReplicatedStorage.Shared.Templates.ShipTemplate)
local MainWeapons = require(ReplicatedStorage.Shared.Catalog.MainWeapons)
local SecondaryWeapons = require(ReplicatedStorage.Shared.Catalog.SecondaryWeapons)
local Pets = require(ReplicatedStorage.Shared.Catalog.Pets)
local WeaponVisuals = require(ReplicatedStorage.Shared.WeaponVisuals)
local PetVisuals = require(ReplicatedStorage.Shared.PetVisuals)

local Hangar = {}

local function findById(list: any, id: string): any
	for _, d in list do
		if d.id == id then
			return d
		end
	end
	return list[1]
end

local BASE = Vector3.new(0, 300, 3000)
local SLOT_SPACING = 120 -- gap between neighboring bays along the row (bump if they clip)
local PODIUM_Z = 45 -- how far in front of the pad the shop podiums sit (toward the wall)
local SPAWN_OFFSET = Vector3.new(-30, 5, 26) -- spawn where the ship podium used to be
local PREVIEW_LIFT = 13 -- height of the floating item preview above a podium
local PREVIEW_SIZE = 9 -- every floating preview is normalized to this longest visible axis
local DISPLAY_SIZE = 60
local START_BOLTS = 0 -- Bolts every player starts with (earn it all in battle)
local SHIP_PRICE = 600 -- cost of any non-starter ship
-- Ships that are free (owned from the start). Everything else is premium/Bolts.
local FREE_SHIPS: { [string]: boolean } = { Pyro = true, Corvette = true, Speeder = true }
local function freshFreeShips(): { [string]: boolean }
	local t = {}
	for s in FREE_SHIPS do
		t[s] = true
	end
	return t
end

local openShopEvent: any = nil -- set in Hangar.start (server -> client shop window)
local boltsEvent: any = nil -- set in Hangar.start (server -> client live Bolts balance)
local ASSET_FOOTPRINT = 170 -- scale the hangar asset to roughly this wide
local ASSET_Y_OFFSET = -50 -- drop the asset onto the ground (tune if it floats)
-- Correct the imported asset's orientation (it comes in standing on end with
-- the floor facing sideways). Tip it over, then roll the floor down.
local ASSET_ROTATION = CFrame.Angles(0, 0, math.rad(90)) * CFrame.Angles(math.rad(-90), 0, 0)

local assetsFolder = ReplicatedStorage:WaitForChild("Assets")
local shipAssets = assetsFolder:WaitForChild("Ships")

-- Hangar structure model, placed by the user in Assets/Buildings.
local hangarTemplate: Instance? = nil
local buildings = assetsFolder:FindFirstChild("Buildings")
if buildings then
	hangarTemplate = buildings:FindFirstChildWhichIsA("Model") or buildings:GetChildren()[1]
end
if not hangarTemplate then
	warn("[AceStarship] no hangar asset found in Assets/Buildings; bays will be bare")
end
local shipOrder = {}
for _, child in shipAssets:GetChildren() do
	table.insert(shipOrder, child.Name)
end
table.sort(shipOrder)
if #shipOrder == 0 then
	shipOrder = { "Pyro" }
end

local function defaultShip(): string
	return if table.find(shipOrder, "Pyro") then "Pyro" else shipOrder[1]
end

type Slot = {
	index: number,
	owner: Player,
	model: Model,
	shipModel: Model?,
	shipId: string, -- the ship you launch with (must be owned)
	previewShipId: string, -- the ship shown on the pad (any ship, just to look at)
	center: Vector3,
	nameLabel: TextLabel,
	mainId: string,
	secId: string,
	petId: string,
	mainLabel: TextLabel,
	secLabel: TextLabel,
	petLabel: TextLabel,
	bolts: number,
	kills: number,
	previewMounts: { [string]: Vector3 },
	previewModels: { [string]: Instance? },
	ownedShips: { [string]: boolean },
	ownedMain: { [string]: boolean },
	ownedSec: { [string]: boolean },
	ownedPets: { [string]: boolean },
	lastShop: string?,
}
local slots: { [Player]: Slot } = {}

-- Push a player's current Bolts balance to their HUD counter.
local function pushBolts(player: Player)
	local s = slots[player]
	if boltsEvent and s then
		boltsEvent:FireClient(player, s.bolts)
	end
end

-- Leaderboard: the server formats the live ranking into a string and publishes it
-- to ReplicatedStorage.Leaderboard (a StringValue, created in Hangar.start). Any TV
-- object you build in Studio just mirrors that value onto its own SurfaceGui.
local lbValue: StringValue? = nil
local function rebuildLeaderboard()
	if not lbValue then
		return
	end
	local list = {}
	for plr, s in slots do
		table.insert(list, { name = plr.Name, kills = s.kills, bolts = s.bolts })
	end
	table.sort(list, function(a, b)
		if a.kills ~= b.kills then
			return a.kills > b.kills
		end
		return a.bolts > b.bolts
	end)
	local lines = { string.format("%-3s %-12s %5s %7s", "#", "PILOT", "KILLS", "BOLTS") }
	for i, e in list do
		if i > 10 then
			break
		end
		local nm = if #e.name > 12 then e.name:sub(1, 12) else e.name
		table.insert(lines, string.format("%-3d %-12s %5d %7d", i, nm, e.kills, e.bolts))
	end
	lbValue.Value = if #list > 0 then table.concat(lines, "\n") else "No pilots yet"
end

local used: { [number]: boolean } = {}

local function part(parent: Instance, size: Vector3, cf: CFrame, color: Color3, material: Enum.Material): BasePart
	local p = Instance.new("Part")
	p.Anchored = true
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = material
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local function fitModel(model: Model, targetFootprint: number)
	local _, size = model:GetBoundingBox()
	local footprint = math.max(size.X, size.Z)
	if footprint > 0 then
		pcall(function()
			model:ScaleTo(targetFootprint / footprint)
		end)
	end
end

-- Place the hangar asset centered at `center`, bottom resting on the floor.
local function placeAsset(parent: Instance, center: Vector3)
	if not hangarTemplate then
		return
	end
	local clone = hangarTemplate:Clone()
	if clone:IsA("BasePart") then
		clone.Anchored = true
		clone.Position = center
		clone.Parent = parent
		return
	end
	local model = clone :: Model
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			d.Anchored = true
		end
	end
	-- Orient it flat first, then scale by its horizontal footprint.
	model:PivotTo(CFrame.new(center) * ASSET_ROTATION)
	local _, size0 = model:GetBoundingBox()
	local footprint = math.max(size0.X, size0.Z)
	if footprint > 0 then
		pcall(function()
			model:ScaleTo(ASSET_FOOTPRINT / footprint)
		end)
	end
	-- Center horizontally on the pad and drop its base onto the floor.
	local cf, size = model:GetBoundingBox()
	local lift = center.Y - (cf.Position.Y - size.Y / 2) + ASSET_Y_OFFSET
	model:PivotTo(model:GetPivot() + Vector3.new(center.X - cf.Position.X, lift, center.Z - cf.Position.Z))
	model.Parent = parent
end

local function scaleTo(model: Model, target: number)
	local size = model:GetExtentsSize()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 0 then
		model:ScaleTo(target / longest)
	end
end

local function showShip(slot: Slot)
	if slot.shipModel then
		slot.shipModel:Destroy()
		slot.shipModel = nil
	end
	local ok, ship = pcall(function()
		return ShipTemplate.new(slot.previewShipId) -- show whatever you're previewing
	end)
	if not ok or not ship then
		slot.nameLabel.Text = slot.previewShipId
		return
	end
	slot.nameLabel.Text = ship.def.displayName or slot.previewShipId
	local model = ship.model
	for _, p in model:GetDescendants() do
		if p:IsA("BasePart") then
			p.Anchored = true
			p.CanCollide = false
		end
	end
	scaleTo(model, DISPLAY_SIZE)
	local yaw = CFrame.Angles(0, math.rad(ship.def.modelYawOffset or 0), 0)
	model:PivotTo(CFrame.new(slot.center) * yaw)
	local boxCF, boxSize = model:GetBoundingBox()
	local lift = (slot.center.Y + 4) - (boxCF.Position.Y - boxSize.Y / 2)
	model:PivotTo(model:GetPivot() + Vector3.new(0, lift, 0))
	model.Parent = slot.model
	slot.shipModel = model
end

local function shipPrice(id: string): number
	return if FREE_SHIPS[id] then 0 else SHIP_PRICE
end

-- Longest VISIBLE dimension (ignores invisible helper parts that would otherwise
-- inflate the bounds and make the visible object shrink when normalized).
local function visibleLongest(model: Model): number
	local minv: Vector3? = nil
	local maxv: Vector3? = nil
	for _, p in model:GetDescendants() do
		if p:IsA("BasePart") and p.Transparency < 1 then
			local r = p.Size * 0.5
			local lo, hi = p.Position - r, p.Position + r
			if minv then
				minv = Vector3.new(math.min(minv.X, lo.X), math.min(minv.Y, lo.Y), math.min(minv.Z, lo.Z))
				maxv = Vector3.new(math.max((maxv :: Vector3).X, hi.X), math.max((maxv :: Vector3).Y, hi.Y), math.max((maxv :: Vector3).Z, hi.Z))
			else
				minv, maxv = lo, hi
			end
		end
	end
	if minv and maxv then
		local d = (maxv :: Vector3) - minv
		return math.max(d.X, d.Y, d.Z)
	end
	local s = model:GetExtentsSize()
	return math.max(s.X, s.Y, s.Z)
end

-- Build a small floating preview of the selected item, normalized so every podium's
-- object is the same visible size.
local function buildPreview(category: string, id: string, mount: Vector3, parent: Instance): Instance?
	local model: Model? = nil
	if category == "ship" then
		local ok, ship = pcall(function()
			return ShipTemplate.new(id)
		end)
		if ok and ship then
			model = ship.model
		end
	elseif category == "main" then
		model = WeaponVisuals.makeProjectile(findById(MainWeapons, id), PREVIEW_SIZE)
	elseif category == "secondary" then
		model = WeaponVisuals.makeProjectile(findById(SecondaryWeapons, id), PREVIEW_SIZE)
	elseif category == "pet" then
		model = PetVisuals.buildBody(PetVisuals.findById(id))
	end
	if model then
		for _, p in model:GetDescendants() do
			if p:IsA("BasePart") then
				p.Anchored = true
				p.CanCollide = false
				p.CastShadow = false
			end
		end
		-- Reset to native scale, then normalize every preview to the same visible size.
		pcall(function()
			model:ScaleTo(1)
		end)
		local l = visibleLongest(model)
		if l > 0 then
			pcall(function()
				model:ScaleTo(PREVIEW_SIZE / l)
			end)
		end
		model:PivotTo(CFrame.new(mount))
		model.Parent = parent
	end
	return model
end

-- Rebuild all four floating previews from the slot's current loadout.
local function updatePreviews(slot: Slot)
	if not slot.previewMounts then
		return
	end
	local picks = { ship = slot.shipId, main = slot.mainId, secondary = slot.secId, pet = slot.petId }
	for cat, id in picks do
		local mount = slot.previewMounts[cat]
		if mount then
			local old = slot.previewModels[cat]
			if old then
				old:Destroy()
			end
			slot.previewModels[cat] = buildPreview(cat, id, mount, slot.model)
		end
	end
end

-- ===== Premium items (sold for Robux via Game Passes) ======================
-- To make an item Robux-only: create a Game Pass on the Roblox Creator Dashboard,
-- then add its ID here under the right category, keyed by the item's id (ship/pet
-- asset name, or weapon catalog id). Items NOT listed stay Bolts-buyable.
-- Replace each 0 with the Game Pass ID you create for that item. While it's 0 the
-- item stays Bolts-priced (not yet premium), so nothing breaks before you make the
-- passes. Free ships (Pyro/Corvette/Speeder) are not listed here.
local PREMIUM: { [string]: { [string]: number } } = {
	ship = {
		BlackKnight = 1865233402,
		BumbleBee = 1863314952,
		Charger = 1865391345,
		Goldian = 1866447349,
		IceSki = 1866381277,
		Knifehand = 1867384824,
		MantaRay = 1866447355,
		Puncture = 1862831495,
		QuickSilver = 1866031260,
		RedLegend = 1864733442,
		Slayer = 1866553322,
		Slice = 1866043375,
		Stryder = 1866219311,
		Syphon = 1865581324,
		Tracker = 1865269370,
		Vortex = 1867426823,
	},
	main = {},
	secondary = {
		["Bathroom Toilet"] = 1866843261,
	},
	pet = {
		Dragon = 1863666268,
		Puppy = 1866091320,
	},
}

-- A real Game Pass id only (0 = placeholder, treated as not-yet-premium).
local function premiumId(category: string, id: string): number?
	local m = PREMIUM[category]
	local gp = if m then m[id] else nil
	return if gp and gp > 0 then gp else nil
end

local gpOwned: { [Player]: { [number]: boolean } } = {} -- cache: does player own gamepass
local gpPrice: { [number]: number } = {} -- cache: gamepass Robux price

local function ownsGamepass(player: Player, gpId: number): boolean
	local c = gpOwned[player]
	if c and c[gpId] ~= nil then
		return c[gpId]
	end
	local ok, owns = pcall(function()
		return MarketplaceService:UserOwnsGamePassAsync(player.UserId, gpId)
	end)
	local val = ok and owns == true
	gpOwned[player] = gpOwned[player] or {}
	gpOwned[player][gpId] = val
	return val
end

local function gamepassPrice(gpId: number): number?
	if gpPrice[gpId] ~= nil then
		return gpPrice[gpId]
	end
	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfo(gpId, Enum.InfoType.GamePass)
	end)
	if ok and info then
		gpPrice[gpId] = info.PriceInRobux or 0
		return gpPrice[gpId]
	end
	return nil
end

-- owned?, gamepass id (if premium), Robux price (if premium)
local function itemFlags(player: Player, category: string, id: string, ownSet: { [string]: boolean }): (boolean, number?, number?)
	local gp = premiumId(category, id)
	if gp then
		return ownsGamepass(player, gp), gp, gamepassPrice(gp)
	end
	return ownSet[id] == true, nil, nil
end

-- Build the item list + Bolts for a category, sent to the client shop window.
local function buildShopData(s: Slot, category: string): any
	local items = {}
	local function add(id: string, name: string, price: number, ownSet: { [string]: boolean }, selId: string)
		local owned, robux, robuxPrice = itemFlags(s.owner, category, id, ownSet)
		table.insert(items, { id = id, name = name, price = price, owned = owned, equipped = selId == id, robux = robux, robuxPrice = robuxPrice })
	end
	if category == "ship" then
		for _, id in shipOrder do
			add(id, id, shipPrice(id), s.ownedShips, s.shipId)
		end
	elseif category == "main" then
		for _, d in MainWeapons do
			add(d.id, d.displayName, d.price, s.ownedMain, s.mainId)
		end
	elseif category == "secondary" then
		for _, d in SecondaryWeapons do
			add(d.id, d.displayName, d.price, s.ownedSec, s.secId)
		end
	elseif category == "pet" then
		for _, d in Pets do
			add(d.id, d.displayName, d.price, s.ownedPets, s.petId)
		end
	end
	return { category = category, bolts = s.bolts, items = items }
end

local function openShop(player: Player, category: string)
	local s = slots[player]
	if s and openShopEvent then
		s.lastShop = category -- so a Robux purchase can refresh the right window
		openShopEvent:FireClient(player, buildShopData(s, category))
	end
end

-- Resolve a category+id to its price and the player's owned-set; nil if invalid.
local function priceAndOwned(s: Slot, category: string, id: string): (number?, { [string]: boolean }?)
	if category == "ship" then
		if not table.find(shipOrder, id) then
			return nil, nil
		end
		return shipPrice(id), s.ownedShips
	elseif category == "main" then
		for _, d in MainWeapons do
			if d.id == id then
				return d.price, s.ownedMain
			end
		end
	elseif category == "secondary" then
		for _, d in SecondaryWeapons do
			if d.id == id then
				return d.price, s.ownedSec
			end
		end
	elseif category == "pet" then
		for _, d in Pets do
			if d.id == id then
				return d.price, s.ownedPets
			end
		end
	end
	return nil, nil
end

local function buyItem(s: Slot, category: string, id: string)
	if premiumId(category, id) then
		return -- Robux item: bought via the Game Pass prompt, not Bolts
	end
	local price, ownedSet = priceAndOwned(s, category, id)
	if not price or not ownedSet or ownedSet[id] then
		return
	end
	if s.bolts >= price then
		s.bolts -= price
		ownedSet[id] = true
		pushBolts(s.owner)
	end
end

local function equipItem(s: Slot, category: string, id: string)
	local gp = premiumId(category, id)
	local allowed
	if gp then
		allowed = ownsGamepass(s.owner, gp) -- premium: must own the Game Pass
	else
		local _, ownedSet = priceAndOwned(s, category, id)
		allowed = ownedSet ~= nil and ownedSet[id] == true
	end
	if not allowed then
		return -- must own it first
	end
	if category == "ship" then
		s.shipId = id
		s.previewShipId = id -- equipping also shows it on the pad
		pcall(showShip, s) -- equip even if the display rebuild hiccups
	elseif category == "main" then
		s.mainId = id
		s.mainLabel.Text = findById(MainWeapons, id).displayName
	elseif category == "secondary" then
		s.secId = id
		s.secLabel.Text = findById(SecondaryWeapons, id).displayName
	elseif category == "pet" then
		s.petId = id
		s.petLabel.Text = findById(Pets, id).displayName
	end
	updatePreviews(s) -- refresh the floating preview for the equipped category
end

function Hangar.addBolts(player: Player, amount: number)
	local s = slots[player]
	if s then
		s.bolts += amount
		pushBolts(player)
	end
end

-- Credit a kill to a player (drives the leaderboard TVs).
function Hangar.addKill(player: Player)
	local s = slots[player]
	if s then
		s.kills += 1
		rebuildLeaderboard()
	end
end

local function buildBay(owner: Player, center: Vector3): (Model, TextLabel, TextLabel, TextLabel, TextLabel)
	local model = Instance.new("Model")
	model.Name = "Hangar"

	local accent = Color3.fromRGB(70, 150, 255)

	placeAsset(model, center)

	-- Glowing pad + light under the ship.
	local pad = part(model, Vector3.new(26, 1, 26), CFrame.new(center + Vector3.new(0, 0.5, 0)), accent, Enum.Material.Neon)
	local light = Instance.new("PointLight")
	light.Range = 70
	light.Brightness = 2.5
	light.Color = accent
	light.Parent = pad

	-- Ship-name billboard above the pad.
	local nameLabel = Instance.new("TextLabel")
	nameLabel.Size = UDim2.fromScale(1, 1)
	nameLabel.BackgroundTransparency = 1
	nameLabel.Font = Enum.Font.GothamBold
	nameLabel.TextScaled = true
	nameLabel.TextColor3 = Color3.fromRGB(180, 220, 255)
	nameLabel.TextStrokeTransparency = 0.4
	nameLabel.Text = "Pyro"
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(200, 40)
	bb.StudsOffset = Vector3.new(0, 28, 0)
	bb.AlwaysOnTop = false
	bb.MaxDistance = 110 -- only visible near the bay
	bb.Adornee = pad
	nameLabel.Parent = bb
	bb.Parent = pad

	-- Floating-preview mount positions, filled in by makePedestal (keyed by category).
	local mounts: { [string]: Vector3 } = {}

	-- Pedestal builder (in front of the pad). Returns its small value label.
	local function makePedestal(offset: Vector3, category: string, actionText: string, labelText: string, onTrigger: (Player) -> ()): TextLabel
		mounts[category] = center + offset + Vector3.new(0, PREVIEW_LIFT, 0)
		part(model, Vector3.new(3, 5, 3), CFrame.new(center + offset + Vector3.new(0, 2.5, 0)), Color3.fromRGB(60, 66, 84), Enum.Material.Metal)
		local button = part(model, Vector3.new(4, 1.2, 4), CFrame.new(center + offset + Vector3.new(0, 5.6, 0)), Color3.fromRGB(255, 120, 60), Enum.Material.Neon)
		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = actionText
		prompt.HoldDuration = 0
		prompt.MaxActivationDistance = 9
		prompt.RequiresLineOfSight = false
		prompt.Parent = button
		prompt.Triggered:Connect(function(plr)
			if plr == owner then
				onTrigger(plr)
			end
		end)
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.GothamBold
		label.TextScaled = true
		label.TextColor3 = Color3.fromRGB(255, 215, 150)
		label.TextStrokeTransparency = 0.4
		label.Text = labelText
		local lbb = Instance.new("BillboardGui")
		lbb.Size = UDim2.fromOffset(150, 26)
		lbb.StudsOffset = Vector3.new(0, 5, 0)
		lbb.AlwaysOnTop = false
		lbb.MaxDistance = 90 -- only visible near the podium
		lbb.Adornee = button
		label.Parent = lbb
		lbb.Parent = button
		return label
	end

	makePedestal(Vector3.new(-30, 0, PODIUM_Z), "ship", "Ship Shop", "SHIP", function(plr)
		openShop(plr, "ship")
	end)
	local mainLabel = makePedestal(Vector3.new(-10, 0, PODIUM_Z), "main", "Laser Shop", MainWeapons[1].displayName, function(plr)
		openShop(plr, "main")
	end)
	local secLabel = makePedestal(Vector3.new(10, 0, PODIUM_Z), "secondary", "Projectile Shop", SecondaryWeapons[1].displayName, function(plr)
		openShop(plr, "secondary")
	end)
	local petLabel = makePedestal(Vector3.new(30, 0, PODIUM_Z), "pet", "Pet Shop", Pets[1].displayName, function(plr)
		openShop(plr, "pet")
	end)

	model.Parent = workspace
	return model, nameLabel, mainLabel, secLabel, petLabel, mounts
end

local function freeIndex(): number
	local i = 0
	while used[i] do
		i += 1
	end
	return i
end

-- ---- Saved profiles (Bolts + unlocks + loadout persist to the player's account) --
-- NOTE: DataStores only work in published places, and in Studio you must enable
-- "Studio Access to API Services" (Game Settings -> Security) or saving is skipped.
local profileStore = DataStoreService:GetDataStore("AceProfiles_v1")
local function profileKey(player: Player): string
	return "u_" .. player.UserId
end

local function loadProfile(player: Player): { [string]: any }?
	local ok, data = pcall(function()
		return profileStore:GetAsync(profileKey(player))
	end)
	if ok and type(data) == "table" then
		return data
	end
	return nil
end

local function saveProfile(player: Player)
	local s = slots[player]
	if not s then
		return
	end
	local data = {
		bolts = s.bolts,
		kills = s.kills,
		shipId = s.shipId,
		mainId = s.mainId,
		secId = s.secId,
		petId = s.petId,
		ownedShips = s.ownedShips,
		ownedMain = s.ownedMain,
		ownedSec = s.ownedSec,
		ownedPets = s.ownedPets,
	}
	pcall(function()
		profileStore:SetAsync(profileKey(player), data)
	end)
end

-- Apply a loaded profile onto a freshly created slot (keeps free defaults owned).
local function applyProfile(player: Player, saved: { [string]: any })
	local s = slots[player]
	if not s then
		return
	end
	if type(saved.bolts) == "number" then
		s.bolts = saved.bolts
	end
	if type(saved.kills) == "number" then
		s.kills = saved.kills
	end
	if type(saved.ownedShips) == "table" then
		s.ownedShips = saved.ownedShips
	end
	if type(saved.ownedMain) == "table" then
		s.ownedMain = saved.ownedMain
	end
	if type(saved.ownedSec) == "table" then
		s.ownedSec = saved.ownedSec
	end
	if type(saved.ownedPets) == "table" then
		s.ownedPets = saved.ownedPets
	end
	-- Never lose the free starter items even if the schema changes.
	for id in freshFreeShips() do
		s.ownedShips[id] = true
	end
	s.ownedMain[MainWeapons[1].id] = true
	s.ownedSec[SecondaryWeapons[1].id] = true
	s.ownedPets[Pets[1].id] = true
	-- Re-equip the saved loadout via equipItem, which checks Game Pass ownership for
	-- premium items and the owned-set for regular ones (so premium picks stick too).
	if type(saved.shipId) == "string" then
		equipItem(s, "ship", saved.shipId)
	end
	if type(saved.mainId) == "string" then
		equipItem(s, "main", saved.mainId)
	end
	if type(saved.secId) == "string" then
		equipItem(s, "secondary", saved.secId)
	end
	if type(saved.petId) == "string" then
		equipItem(s, "pet", saved.petId)
	end
	pcall(showShip, s)
	pushBolts(player)
	rebuildLeaderboard()
end

function Hangar.assign(player: Player): Vector3
	local index = freeIndex()
	used[index] = true
	local center = BASE + Vector3.new(0, 0, index * SLOT_SPACING)
	local model, nameLabel, mainLabel, secLabel, petLabel, mounts = buildBay(player, center)
	slots[player] = {
		index = index,
		owner = player,
		model = model,
		shipModel = nil,
		shipId = defaultShip(),
		previewShipId = defaultShip(),
		center = center,
		nameLabel = nameLabel,
		mainId = MainWeapons[1].id,
		secId = SecondaryWeapons[1].id,
		petId = Pets[1].id,
		mainLabel = mainLabel,
		secLabel = secLabel,
		petLabel = petLabel,
		bolts = START_BOLTS,
		kills = 0,
		previewMounts = mounts,
		previewModels = {},
		ownedShips = freshFreeShips(),
		ownedMain = { [MainWeapons[1].id] = true },
		ownedSec = { [SecondaryWeapons[1].id] = true },
		ownedPets = { [Pets[1].id] = true },
	}
	showShip(slots[player])
	updatePreviews(slots[player]) -- floating item previews over the podiums
	pushBolts(player) -- seed the HUD counter with the starting balance

	-- Load this player's saved Bolts / unlocks / loadout (yields on the web call).
	local saved = loadProfile(player)
	if saved and slots[player] then
		applyProfile(player, saved)
	end

	-- Warm the Game Pass ownership/price caches in the background so the shop
	-- opens instantly (no web call mid-open).
	task.spawn(function()
		for _, m in PREMIUM do
			for _, gp in m do
				ownsGamepass(player, gp)
				gamepassPrice(gp)
			end
		end
	end)

	return center + SPAWN_OFFSET -- spawn where the ship podium used to be
end

function Hangar.release(player: Player)
	saveProfile(player) -- persist Bolts / unlocks / loadout before tearing down
	gpOwned[player] = nil -- drop the ownership cache
	local s = slots[player]
	if not s then
		return
	end
	used[s.index] = nil
	s.model:Destroy()
	slots[player] = nil
end

function Hangar.getShip(player: Player): string
	local s = slots[player]
	return if s then s.shipId else defaultShip()
end

function Hangar.getMain(player: Player): string
	local s = slots[player]
	return if s then s.mainId else MainWeapons[1].id
end

function Hangar.getSecondary(player: Player): string
	local s = slots[player]
	return if s then s.secId else SecondaryWeapons[1].id
end

function Hangar.getPet(player: Player): string
	local s = slots[player]
	return if s then s.petId else Pets[1].id
end

function Hangar.padCenter(player: Player): Vector3?
	local s = slots[player]
	return if s then s.center else nil
end

-- Where to drop a returning player: in front of their existing bay's ship (the
-- same spot Hangar.assign first spawned them), without allocating a new bay.
function Hangar.returnPoint(player: Player): Vector3?
	local s = slots[player]
	return if s then s.center + SPAWN_OFFSET else nil
end

local function buildConcourse()
	local folder = Instance.new("Folder")
	folder.Name = "Concourse"
	folder.Parent = workspace

	local accent = Color3.fromRGB(70, 150, 255)
	local w, d = 6000, 2000
	local cx, cz, cy = BASE.X + 1400, BASE.Z, BASE.Y

	part(folder, Vector3.new(w, 4, d), CFrame.new(cx, cy - 2, cz), Color3.fromRGB(34, 38, 50), Enum.Material.Metal)

	local h = 40
	part(folder, Vector3.new(w, h, 4), CFrame.new(cx, cy + h / 2, cz - d / 2), accent, Enum.Material.Metal)
	part(folder, Vector3.new(w, h, 4), CFrame.new(cx, cy + h / 2, cz + d / 2), accent, Enum.Material.Metal)
	part(folder, Vector3.new(4, h, d), CFrame.new(cx - w / 2, cy + h / 2, cz), accent, Enum.Material.Metal)
	part(folder, Vector3.new(4, h, d), CFrame.new(cx + w / 2, cy + h / 2, cz), accent, Enum.Material.Metal)

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "LobbySpawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(12, 1, 12)
	spawn.CFrame = CFrame.new(BASE.X, cy + 0.5, BASE.Z + 60)
	spawn.Neutral = true
	spawn.Duration = 0
	spawn.Transparency = 1
	spawn.Parent = folder
end

function Hangar.start()
	-- Shop remotes: server pushes item lists, client requests buy/equip.
	openShopEvent = Instance.new("RemoteEvent")
	openShopEvent.Name = "OpenShop"
	openShopEvent.Parent = ReplicatedStorage
	-- Live Bolts balance for the HUD counter. Client fires it (no args) to ask for
	-- its current balance on spawn; server pushes the number back here and on change.
	boltsEvent = Instance.new("RemoteEvent")
	boltsEvent.Name = "BoltsChanged"
	boltsEvent.Parent = ReplicatedStorage
	-- Live leaderboard text any TV object in Studio can mirror onto its SurfaceGui.
	lbValue = Instance.new("StringValue")
	lbValue.Name = "Leaderboard"
	lbValue.Value = "No pilots yet"
	lbValue.Parent = ReplicatedStorage
	rebuildLeaderboard()
	boltsEvent.OnServerEvent:Connect(function(player)
		pushBolts(player)
	end)
	local shopAction = Instance.new("RemoteEvent")
	shopAction.Name = "ShopAction"
	shopAction.Parent = ReplicatedStorage
	shopAction.OnServerEvent:Connect(function(player, category, action, id)
		if type(category) ~= "string" or type(action) ~= "string" or type(id) ~= "string" then
			return
		end
		if category ~= "ship" and category ~= "main" and category ~= "secondary" and category ~= "pet" then
			return
		end
		local s = slots[player]
		if not s then
			return
		end
		if action == "buy" then
			buyItem(s, category, id)
			equipItem(s, category, id) -- equip what you just bought (no-op if buy failed)
		elseif action == "equip" then
			equipItem(s, category, id)
		elseif action == "preview" then
			-- Show any ship on the pad without owning/equipping it.
			if category == "ship" and table.find(shipOrder, id) then
				s.previewShipId = id
				pcall(showShip, s)
			end
		else
			return
		end
		openShop(player, category) -- refresh the window
	end)

	-- Reverse map (Game Pass id -> category + item id) so a purchase auto-equips.
	local premiumByPass: { [number]: { category: string, id: string } } = {}
	for cat, m in PREMIUM do
		for id, gp in m do
			premiumByPass[gp] = { category = cat, id = id }
		end
	end

	-- When a Robux Game Pass purchase completes, grant + auto-equip + refresh.
	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, gpId, purchased)
		if not purchased then
			return
		end
		gpOwned[player] = gpOwned[player] or {}
		gpOwned[player][gpId] = true
		local s = slots[player]
		local info = premiumByPass[gpId]
		if s and info then
			equipItem(s, info.category, info.id)
			openShop(player, s.lastShop or info.category)
		end
	end)

	-- The lobby platform is built by init.server now; just spin the displays and
	-- refresh the leaderboard TVs a couple times a second (catches joins/leaves/Bolts).
	local lbAccum = 0
	RunService.Heartbeat:Connect(function(dt)
		local t = os.clock()
		for _, s in slots do
			if s.shipModel then
				s.shipModel:PivotTo(s.shipModel:GetPivot() * CFrame.Angles(0, dt * 0.3, 0))
			end
			-- Spin + bob the floating item previews above the podiums.
			if s.previewModels and s.previewMounts then
				for cat, m in s.previewModels do
					local mount = s.previewMounts[cat]
					if m and (m :: Instance).Parent and mount then
						local bob = math.sin(t * 2 + mount.X) * 0.7
						;(m :: PVInstance):PivotTo(CFrame.new(mount + Vector3.new(0, bob, 0)) * CFrame.Angles(0, t, 0))
					end
				end
			end
		end
		lbAccum += dt
		if lbAccum >= 2 then
			lbAccum = 0
			rebuildLeaderboard()
		end
	end)

	-- Autosave every 60s, and save everyone when the server shuts down.
	task.spawn(function()
		while true do
			task.wait(60)
			for plr in slots do
				saveProfile(plr)
			end
		end
	end)
	game:BindToClose(function()
		for plr in slots do
			saveProfile(plr)
		end
	end)
end

return Hangar
