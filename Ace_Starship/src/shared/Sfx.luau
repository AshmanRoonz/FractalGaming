--!strict
-- Sound effects + music. Drop Sound objects into ReplicatedStorage.Assets.Sound
-- named to match the events below, and they're used automatically (their SoundId,
-- Volume, and PlaybackSpeed). Anything you haven't added falls back to a built-in
-- Roblox sound so there's never silence. For music, add Sounds named "MusicLobby"
-- and "MusicBattle" to that same folder.
--
-- Event names: shoot, bomb, explosion, enemyDown, hit, laser, wave, ui, launch, roll, dash, pickup.

local SoundService = game:GetService("SoundService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")

local Sfx = {}

local soundFolder: Instance? = nil
local function getFolder(): Instance?
	if soundFolder and soundFolder.Parent then
		return soundFolder
	end
	local assets = ReplicatedStorage:FindFirstChild("Assets")
	soundFolder = assets and assets:FindFirstChild("Sound")
	return soundFolder
end

type Def = { id: string, volume: number, pitch: number? }
-- Built-in fallbacks (used only if you haven't added a Sound of that name).
local FALLBACK: { [string]: Def } = {
	shoot = { id = "rbxasset://sounds/Rocket whoosh 01.wav", volume = 0.45 },
	bomb = { id = "rbxasset://sounds/collide.wav", volume = 1, pitch = 0.55 },
	explosion = { id = "rbxasset://sounds/collide.wav", volume = 0.5 },
	enemyDown = { id = "rbxasset://sounds/electronicpingshort.wav", volume = 0.5, pitch = 0.7 },
	hit = { id = "rbxasset://sounds/impact_water.mp3", volume = 0.6 },
	laser = { id = "rbxasset://sounds/electronicpingshort.wav", volume = 0.18 },
	wave = { id = "rbxasset://sounds/electronicpingshort.wav", volume = 0.6, pitch = 0.5 },
	ui = { id = "rbxasset://sounds/button.wav", volume = 0.5 },
	launch = { id = "rbxasset://sounds/Rocket whoosh 01.wav", volume = 0.7, pitch = 0.8 },
	roll = { id = "rbxasset://sounds/swoosh.mp3", volume = 0.5, pitch = 1.2 },
	dash = { id = "rbxasset://sounds/Rocket whoosh 01.wav", volume = 0.55, pitch = 1.15 },
	pickup = { id = "rbxasset://sounds/electronicpingshort.wav", volume = 0.6, pitch = 1.5 },
}

local function cleanup(s: Sound)
	s.Ended:Once(function()
		s:Destroy()
	end)
	Debris:AddItem(s, 12) -- safety net
end

-- Play a one-shot sound by event name.
function Sfx.play(name: string, pitch: number?)
	-- Prefer a user-supplied Sound object of this name.
	local folder = getFolder()
	local template = folder and folder:FindFirstChild(name)
	if template and template:IsA("Sound") then
		local s = template:Clone()
		s.Looped = false
		if pitch then
			s.PlaybackSpeed = pitch
		end
		s.Parent = SoundService
		s:Play()
		cleanup(s)
		return
	end
	-- Fallback to a built-in.
	local def = FALLBACK[name]
	if not def then
		return
	end
	local s = Instance.new("Sound")
	s.SoundId = def.id
	s.Volume = def.volume
	s.PlaybackSpeed = pitch or def.pitch or 1
	s.Parent = SoundService
	s:Play()
	cleanup(s)
end

-- Loop a music track ("lobby"/"battle") from a Sound named MusicLobby/MusicBattle.
local musicSound: Sound? = nil
function Sfx.music(name: string)
	if musicSound then
		musicSound:Destroy()
		musicSound = nil
	end
	local folder = getFolder()
	local key = "Music" .. (name:gsub("^%l", string.upper))
	local template = folder and folder:FindFirstChild(key)
	if template and template:IsA("Sound") then
		local m = template:Clone()
		m.Looped = true
		m.Parent = SoundService
		m:Play()
		musicSound = m
	end
end

return Sfx
