--!strict
-- Owns the lifecycle of a run (a "match"). A match is solo (1 player) or co-op
-- (up to GameConfig.MaxPartySize sharing one tunnel). It advances distance,
-- drives the tunnel/spawner/boss each tick, pauses distance while a boss gate is
-- open, and on death submits to the right leaderboard. Banked progress is
-- untouched here; only LeaderboardService + CurrencyService.awardBolts persist.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local RunService = game:GetService("RunService")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local Net = require(ReplicatedStorage.Shared.Net)

local Systems = ServerScriptService.Server.Systems
local TunnelGenerator = require(Systems.TunnelGenerator)
local EnemySpawner = require(Systems.EnemySpawner)
local BossManager = require(Systems.BossManager)
local CurrencyService = require(Systems.CurrencyService)
local LeaderboardService = require(Systems.LeaderboardService)

local MatchManager = {}

type Match = {
	players: { Player },
	mode: string, -- "solo" | "coop"
	distance: number,
	tunnel: TunnelGenerator.Tunnel,
	spawner: EnemySpawner.Spawner,
	boss: BossManager.BossState,
	gateOpen: boolean, -- false while a boss blocks the tunnel
	leadPos: Vector3,
}

local matches: { Match } = {}

local function startMatch(players: { Player })
	local match: Match = {
		players = players,
		mode = if #players > 1 then "coop" else "solo",
		distance = 0,
		tunnel = TunnelGenerator.new(),
		spawner = EnemySpawner.new(),
		boss = BossManager.new(),
		gateOpen = true,
		leadPos = Vector3.zero,
	}
	table.insert(matches, match)
	-- TODO: spawn each player's equipped ship (ShipTemplate) and position them.
	return match
end

local function endMatch(match: Match)
	for _, player in match.players do
		LeaderboardService.submit(match.mode, player.UserId, match.distance)
	end
	match.tunnel:destroy()
	local idx = table.find(matches, match)
	if idx then
		table.remove(matches, idx)
	end
end

local function stepMatch(match: Match, dt: number)
	-- Forward travel only when the boss gate is open.
	if match.gateOpen then
		local speed = GameConfig.BaseTravelSpeed + GameConfig.SpeedPerKm * (match.distance / 1000)
		match.distance += speed * dt
	end

	match.tunnel:update(match.distance)

	local aheadCFrame = CFrame.new(0, 0, -(match.distance + GameConfig.SegmentLength))

	-- Boss gate logic gates the spawner and forward motion.
	local bossStatus = match.boss:update(dt, match.distance, aheadCFrame, match.leadPos)
	if bossStatus == "spawned" then
		match.gateOpen = false
		for _, player in match.players do
			Net.bossSpawned.sendTo({ bossId = "gatekeeper" }, player)
		end
	elseif bossStatus == "cleared" then
		match.gateOpen = true
		for _, player in match.players do
			CurrencyService.awardBolts(player, GameConfig.BossClearReward)
		end
	end

	if match.gateOpen then
		match.spawner:update(dt, match.distance, aheadCFrame, match.leadPos)
	end

	-- Push authoritative state to clients.
	for _, player in match.players do
		local data = CurrencyService.getProfile(player)
		Net.runState.sendTo({
			distance = match.distance,
			bolts = data and data.Bolts or 0,
			alive = true,
		}, player)
	end
end

function MatchManager.start()
	-- MVP: each joining player gets a solo match immediately. Co-op matchmaking
	-- (party up before launch) layers on top of startMatch later.
	Players.PlayerAdded:Connect(function(player)
		player.CharacterAdded:Connect(function()
			startMatch({ player })
		end)
	end)

	RunService.Heartbeat:Connect(function(dt)
		for i = #matches, 1, -1 do
			stepMatch(matches[i], dt)
		end
	end)
end

return MatchManager
