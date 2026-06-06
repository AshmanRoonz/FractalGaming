--!strict
-- Background music director. Three looping tracks, crossfaded by game state:
--   velvet -> lobby + the breather between waves (calm)
--   caves  -> normal waves (enemies present, not a boss)
--   boss   -> boss waves
-- A track pauses when switched away and resumes where it left off; all loop. State is
-- read from the enemy count + the wave's boss flag, so no extra server wiring is needed.

local SoundService = game:GetService("SoundService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local RunService = game:GetService("RunService")

local EnemyController = require(script.Parent.EnemyController)

local MusicController = {}

local VOLUME = 0.5
local FADE = 1.6 -- crossfade seconds
local BREATHER_DELAY = 1.2 -- enemies must be gone this long before the calm track returns

local IDS = {
	velvet = "rbxassetid://112303036160778", -- Velvety Technobeats
	caves = "rbxassetid://77182582310920", -- Battle in the Caves
	boss = "rbxassetid://93998912586289", -- Bossbattle Technobeats
}

function MusicController.start()
	local sounds: { [string]: Sound } = {}
	for key, id in IDS do
		local s = Instance.new("Sound")
		s.Name = "Music_" .. key
		s.SoundId = id
		s.Looped = true
		s.Volume = 0
		s.Parent = SoundService
		sounds[key] = s
	end

	local started: { [string]: boolean } = {}
	local fades: { [string]: Tween } = {}
	local current: string? = nil

	local function fadeTo(key: string, vol: number): Tween
		if fades[key] then
			fades[key]:Cancel()
		end
		local tw = TweenService:Create(sounds[key], TweenInfo.new(FADE), { Volume = vol })
		fades[key] = tw
		tw:Play()
		return tw
	end

	local function switch(key: string)
		if current == key then
			return
		end
		local prev = current
		current = key
		local s = sounds[key]
		if not started[key] then
			s:Play()
			started[key] = true
		else
			s:Resume() -- pick up where this track left off
		end
		fadeTo(key, VOLUME)
		if prev then
			local ps = sounds[prev]
			fadeTo(prev, 0).Completed:Once(function(state)
				if current ~= prev and state == Enum.PlaybackState.Completed then
					ps:Pause() -- keep its TimePosition for next time
				end
			end)
		end
	end

	-- WaveEvent tells us whether the current wave is a boss wave.
	local bossWave = false
	task.spawn(function()
		local waveEvent = ReplicatedStorage:WaitForChild("WaveEvent")
		waveEvent.OnClientEvent:Connect(function(_n, boss)
			bossWave = boss == true
		end)
	end)

	-- Poll a few times a second and pick the track (with a short debounce before the
	-- calm track returns, so a momentary gap mid-wave doesn't flip the music).
	local emptySince: number? = nil
	local accum = 0
	RunService.Heartbeat:Connect(function(dt)
		accum += dt
		if accum < 0.3 then
			return
		end
		accum = 0
		local now = os.clock()
		local enemies = #EnemyController.enemies
		local target: string?
		if enemies > 0 then
			emptySince = nil
			target = if bossWave then "boss" else "caves"
		else
			emptySince = emptySince or now
			target = if now - emptySince > BREATHER_DELAY then "velvet" else current
		end
		if target then
			switch(target)
		end
	end)

	switch("velvet") -- lobby music straight away
end

return MusicController
