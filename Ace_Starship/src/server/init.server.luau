--!strict
-- Server bootstrap. A guaranteed lobby platform is built first (so nobody ever
-- falls into the void), then per-player hangars + the battle. Walking into your
-- ship launches you flying your selected ship.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local RunService = game:GetService("RunService")

-- Never auto-spawn (we place players ourselves). Set FIRST so a later error
-- can't leave players dropping into empty space.
Players.CharacterAutoLoads = false

-- Mobile perf: skip real-time shadows (big win on tablets, minor visual loss).
game:GetService("Lighting").GlobalShadows = false

-- Big lobby platform, sized for ~8 bays side by side. Built directly here so it
-- always exists regardless of the hangar module. Centered on the hangar row
-- (bays run along Z from x=0, z=3000) with generous room in front of the openings.
local LOBBY_Y = 1000 -- high above the ceiling mountains so it's hidden from the battlefield
local LOBBY_CX, LOBBY_CZ = 0, 3420
do
	local folder = Instance.new("Folder")
	folder.Name = "LobbyPlatform"
	folder.Parent = workspace
	local function block(size: Vector3, pos: Vector3, color: Color3)
		local p = Instance.new("Part")
		p.Anchored = true
		p.Size = size
		p.Position = pos
		p.Color = color
		p.Material = Enum.Material.Metal
		p.TopSurface = Enum.SurfaceType.Smooth
		p.Parent = folder
	end
	local w, d = 4000, 2800 -- X width (room to step back), Z depth (covers the bay row)
	block(Vector3.new(w, 8, d), Vector3.new(LOBBY_CX, LOBBY_Y - 4, LOBBY_CZ), Color3.fromRGB(34, 38, 50)) -- floor only; border rails removed

	local sl = Instance.new("SpawnLocation")
	sl.Name = "LobbySpawn"
	sl.Anchored = true
	sl.Size = Vector3.new(12, 1, 12)
	sl.Position = Vector3.new(0, LOBBY_Y + 0.5, LOBBY_CZ + 80)
	sl.Neutral = true
	sl.Duration = 0
	sl.Transparency = 1
	sl.Parent = folder
end

-- Skybox is now installed per-client by SkyController (so it can be turned off on
-- Low-quality / touch devices). Edit the face ids in Shared/SkyConfig.luau.

-- Load hangar + battle (don't let a failure break spawning).
local Hangar, Battle
local setupOk = pcall(function()
	Hangar = require(ServerScriptService.Server.Hangar)
	Battle = require(ServerScriptService.Server.Battle)
	Hangar.start()
	Battle.start()
end)
if not setupOk then
	warn("[AceStarship] hangar/battle setup failed; lobby is bare")
end

local beginBattle = Instance.new("RemoteEvent")
beginBattle.Name = "BeginBattle"
beginBattle.Parent = ReplicatedStorage

-- Client asks to come back to the hangar (death / respawn / leave battle).
local leaveBattle = Instance.new("RemoteEvent")
leaveBattle.Name = "LeaveBattle"
leaveBattle.Parent = ReplicatedStorage

local inLobby: { [Player]: boolean } = {}

-- Spawn (or respawn) the player's character in their hangar bay. Because we manage
-- spawning ourselves (CharacterAutoLoads is off), we must re-spawn on death/reset
-- too, or the menu "Reset" button leaves them dead in the hangar.
local function placeInBay(player: Player, spawnPos: Vector3?)
	player:LoadCharacter()
	local char = player.Character or player.CharacterAdded:Wait()
	task.wait()
	if spawnPos and char then
		char:PivotTo(CFrame.new(spawnPos))
	end
	inLobby[player] = true
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if hum then
		hum.Died:Connect(function()
			if inLobby[player] then -- not if they just launched into battle
				task.wait(0.4)
				if inLobby[player] and player.Parent then
					placeInBay(player, if Hangar then Hangar.returnPoint(player) else nil)
				end
			end
		end)
	end
end

local function spawnInLobby(player: Player)
	local spawnPos: Vector3? = nil
	if Hangar then
		local ok, pos = pcall(Hangar.assign, player)
		if ok then
			spawnPos = pos
		end
	end
	placeInBay(player, spawnPos)
end

local function launchPlayer(player: Player)
	inLobby[player] = nil
	local shipId = if Hangar then Hangar.getShip(player) else "Pyro"
	local mainId = if Hangar then Hangar.getMain(player) else "laser"
	local secId = if Hangar then Hangar.getSecondary(player) else "Missile"
	local petId = if Hangar then Hangar.getPet(player) else "orb"
	local petId2 = if Hangar then Hangar.getPet2(player) else "orb"
	local el1 = if Hangar then Hangar.getEl1(player) else "lightning"
	local el2 = if Hangar then Hangar.getEl2(player) else "fire"
	if player.Character then
		player.Character:Destroy()
	end
	if Battle then
		Battle.playerLaunched(player, shipId, mainId, secId, petId)
	end
	beginBattle:FireClient(player, shipId, mainId, secId, petId, petId2, el1, el2)
end

-- Return a battling player to their existing hangar bay (no new bay allocated).
-- The shared server battle keeps running for everyone else.
local function returnToHangar(player: Player)
	if inLobby[player] then
		return -- already home
	end
	if Battle then
		Battle.playerLeft(player)
	end
	placeInBay(player, if Hangar then Hangar.returnPoint(player) else nil)
end

leaveBattle.OnServerEvent:Connect(returnToHangar)

Players.PlayerAdded:Connect(spawnInLobby)
for _, player in Players:GetPlayers() do
	task.spawn(spawnInLobby, player)
end

Players.PlayerRemoving:Connect(function(player)
	inLobby[player] = nil
	if Hangar then
		Hangar.release(player)
	end
end)

RunService.Heartbeat:Connect(function()
	if not Hangar then
		return
	end
	for player in inLobby do
		local char = player.Character
		local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		local pad = Hangar.padCenter(player)
		if root and pad then
			local flat = Vector3.new(root.Position.X - pad.X, 0, root.Position.Z - pad.Z)
			if flat.Magnitude <= 11 then
				launchPlayer(player)
			end
		end
	end
end)

print("[AceStarship] lobby server ready.")
