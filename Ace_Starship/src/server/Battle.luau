--!strict
-- Server-authoritative battle: owns ship replication, waves, enemies, enemy
-- fire, and damage, so every player in the server fights the same skibidis.
--
-- Clients render from broadcasts and report weapon hits; the server validates
-- (lightly) and applies them. Player health stays client-side, but damage
-- events originate here.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local WorldHeights = require(ReplicatedStorage.Shared.WorldHeights)
local Hangar = require(script.Parent.Hangar)

local Battle = {}

-- Enemy model names (from Assets/Enemies); the server picks so all clients agree.
local enemyAssets = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Enemies")
local enemyKinds: { string } = {}
if enemyAssets then
	for _, c in enemyAssets:GetChildren() do
		table.insert(enemyKinds, c.Name)
	end
end
local function pickKind(): string
	return if #enemyKinds > 0 then enemyKinds[math.random(#enemyKinds)] else ""
end

-- Tuning (moved server-side).
local ENEMY_HP = 100
local BOSS_HP = 900
local SPAWN_MIN, SPAWN_MAX = 360, 680
local DRIFT_SPEED = 42
local GAP_Y = 110
local BIAS_TO_START = 0.7
local FIRE_RANGE = 300
local BALL_DMG = 9
local BALL_SPEED = 170
local BALL_COOLDOWN = 1.5
local HIT_RADIUS = 12
local WAVE_DELAY = 3
local BASE_COUNT = 2
local MAX_COUNT = 12
local BOSS_EVERY = 10
local MAX_HIT = 160 -- cap on a single damage report (light anti-cheat; allows the bomb)
local BOLTS_PER_KILL = 10
local BOLTS_PER_WAVE = 50
local START_DIR = Vector3.new(0, 0, -1)

type EnemyRec = { id: number, cf: CFrame, hp: number, mh: number, boss: boolean, nextFire: number, bob: number, kind: string }
type BallRec = { pos: Vector3, vel: Vector3, life: number }

local battling: { [Player]: { cf: CFrame, shipId: string, beamHit: Vector3? } } = {}

-- Fire an event only to players currently in battle (lobby players don't listen).
local function fireBattling(event: any, ...)
	for player in battling do
		event:FireClient(player, ...)
	end
end
local enemies: { EnemyRec } = {}
local balls: { BallRec } = {}
local nextId = 0
local wave, waveActive, nextWaveAt = 0, false, 0

local shipUpdate, shipStates, enemyStates, waveEvent, damageEnemy, enemyFired, playerHit, playerFired, killEvent

local function makeEvent(name: string, unreliable: boolean): any
	local e = Instance.new(if unreliable then "UnreliableRemoteEvent" else "RemoteEvent")
	e.Name = name
	e.Parent = ReplicatedStorage
	return e
end

local function playerPositions(): { Vector3 }
	local out = {}
	for _, rec in battling do
		table.insert(out, rec.cf.Position)
	end
	return out
end

local function avgPlayerPos(): Vector3
	local positions = playerPositions()
	if #positions == 0 then
		return Vector3.new(0, GAP_Y, 0)
	end
	local sum = Vector3.zero
	for _, p in positions do
		sum += p
	end
	return sum / #positions
end

local function nearestPlayerPos(from: Vector3): Vector3?
	local best, bestD = nil, math.huge
	for _, p in playerPositions() do
		local d = (p - from).Magnitude
		if d < bestD then
			best, bestD = p, d
		end
	end
	return best
end

local function anyForward(): Vector3
	for _, rec in battling do
		local f = Vector3.new(rec.cf.LookVector.X, 0, rec.cf.LookVector.Z)
		if f.Magnitude > 0.01 then
			return f.Unit
		end
	end
	return START_DIR
end

local function spawnEnemy(boss: boolean)
	nextId += 1
	local center = avgPlayerPos()
	local cur = anyForward()
	local ref = START_DIR * BIAS_TO_START + cur * (1 - BIAS_TO_START)
	ref = if ref.Magnitude > 0.01 then ref.Unit else START_DIR
	local off = (math.random() - 0.5) * math.rad(90)
	local dir = CFrame.fromAxisAngle(Vector3.yAxis, off) * ref
	local dist = SPAWN_MIN + math.random() * (SPAWN_MAX - SPAWN_MIN)
	local pos = center + dir * dist + Vector3.new(0, (math.random() - 0.5) * 60, 0)
	pos = Vector3.new(pos.X, math.clamp(pos.Y, GAP_Y - 60, GAP_Y + 60), pos.Z)
	table.insert(enemies, {
		id = nextId,
		cf = CFrame.new(pos),
		hp = if boss then BOSS_HP else ENEMY_HP,
		mh = if boss then BOSS_HP else ENEMY_HP,
		boss = boss,
		nextFire = os.clock() + 1 + math.random() * 2,
		bob = math.random() * 10,
		kind = pickKind(),
	})
end

local function startWave()
	wave += 1
	local isBoss = wave % BOSS_EVERY == 0
	fireBattling(waveEvent, wave, isBoss)
	if isBoss then
		spawnEnemy(true)
		for _ = 1, 3 do
			spawnEnemy(false)
		end
	else
		for _ = 1, math.min(MAX_COUNT, BASE_COUNT + wave) do
			spawnEnemy(false)
		end
	end
	waveActive = true
end

local function findEnemy(id: number): EnemyRec?
	for _, e in enemies do
		if e.id == id then
			return e
		end
	end
	return nil
end

function Battle.playerLaunched(player: Player, shipId: string?)
	battling[player] = { cf = CFrame.new(0, 100, 0), shipId = shipId or "starter_skiff", beamHit = nil }
end

function Battle.playerLeft(player: Player)
	battling[player] = nil
end

function Battle.start()
	shipUpdate = makeEvent("ShipUpdate", true)
	shipStates = makeEvent("ShipStates", true)
	-- Reliable (not unreliable): a full-wave snapshot of ~12 enemies exceeds the
	-- ~900-byte unreliable-event cap and would be silently dropped, leaving
	-- enemies invisible/untargetable while their shots (sent separately) still show.
	enemyStates = makeEvent("EnemyStates", false)
	enemyFired = makeEvent("EnemyFired", true)
	waveEvent = makeEvent("WaveEvent", false)
	damageEnemy = makeEvent("DamageEnemy", false)
	playerHit = makeEvent("PlayerHit", false)
	playerFired = makeEvent("PlayerFired", true)
	killEvent = makeEvent("Kill", false)

	shipUpdate.OnServerEvent:Connect(function(player, cf, beamHit)
		local rec = battling[player]
		if rec and typeof(cf) == "CFrame" then
			rec.cf = cf
			rec.beamHit = if typeof(beamHit) == "Vector3" then beamHit else nil
		end
	end)

	-- Relay a player's secondary shot to everyone else (visual only).
	playerFired.OnServerEvent:Connect(function(player, origin, dir)
		if typeof(origin) == "Vector3" and typeof(dir) == "Vector3" then
			fireBattling(playerFired, player.UserId, origin, dir)
		end
	end)

	damageEnemy.OnServerEvent:Connect(function(player, id, amount)
		if type(id) ~= "number" or type(amount) ~= "number" then
			return
		end
		local e = findEnemy(id)
		if not e then
			return
		end
		e.hp -= math.clamp(amount, 0, MAX_HIT)
		if e.hp <= 0 then
			killEvent:FireClient(player) -- credit the kill to whoever landed it
			Hangar.addBolts(player, BOLTS_PER_KILL)
			local idx = table.find(enemies, e)
			if idx then
				table.remove(enemies, idx)
			end
			if waveActive and #enemies == 0 then
				waveActive = false
				nextWaveAt = os.clock() + WAVE_DELAY
				for p in battling do
					Hangar.addBolts(p, BOLTS_PER_WAVE) -- everyone gets the wave-clear bonus
				end
			end
		end
	end)

	Players.PlayerRemoving:Connect(Battle.playerLeft)

	nextWaveAt = os.clock() + 3

	local accum = 0
	RunService.Heartbeat:Connect(function(dt)
		local now = os.clock()

		-- Start next wave when clear.
		if not waveActive and #enemies == 0 and #playerPositions() > 0 and now >= nextWaveAt then
			startWave()
		end

		-- Enemies: drift toward nearest player, bob, fire balls.
		for _, e in enemies do
			e.bob += dt
			local myPos = e.cf.Position
			local target = nearestPlayerPos(myPos)
			if target then
				local to = target - myPos
				local step = if to.Magnitude > 60 then to.Unit * DRIFT_SPEED * dt else Vector3.zero
				local newPos = myPos + step + Vector3.new(0, math.sin(e.bob * 1.5) * 8 * dt, 0)
				-- Keep enemies inside the gap, not buried in terrain.
				local gy = WorldHeights.groundY(newPos.X, newPos.Z) + 10
				local cy = WorldHeights.ceilY(newPos.X, newPos.Z) - 10
				if cy > gy then
					newPos = Vector3.new(newPos.X, math.clamp(newPos.Y, gy, cy), newPos.Z)
				end
				e.cf = CFrame.lookAt(newPos, target)
				-- Only fire when a mountain isn't between us (so hiding works).
				if to.Magnitude <= FIRE_RANGE and now >= e.nextFire and not WorldHeights.blocked(newPos, target) then
					e.nextFire = now + BALL_COOLDOWN
					local dir = (target - newPos).Unit
					table.insert(balls, { pos = newPos, vel = dir * BALL_SPEED, life = 4 })
					fireBattling(enemyFired, newPos, dir, BALL_SPEED)
				end
			end
		end

		-- Enemy balls: move + hit players.
		for i = #balls, 1, -1 do
			local b = balls[i]
			b.life -= dt
			b.pos += b.vel * dt
			local hitPlayer = nil
			for player, rec in battling do
				if (rec.cf.Position - b.pos).Magnitude <= HIT_RADIUS then
					hitPlayer = player
					break
				end
			end
			local hitTerrain = b.pos.Y < WorldHeights.groundY(b.pos.X, b.pos.Z)
				or b.pos.Y > WorldHeights.ceilY(b.pos.X, b.pos.Z)
			if hitPlayer then
				playerHit:FireClient(hitPlayer, BALL_DMG)
				table.remove(balls, i)
			elseif hitTerrain or b.life <= 0 then
				table.remove(balls, i)
			end
		end

		-- Broadcast ship + enemy states ~20 Hz.
		accum += dt
		if accum >= 0.05 then
			accum = 0
			local ships = {}
			for player, rec in battling do
				table.insert(ships, { u = player.UserId, c = rec.cf, s = rec.shipId, b = rec.beamHit })
			end
			if #ships > 0 then
				fireBattling(shipStates, ships)
			end
			local elist = {}
			for _, e in enemies do
				-- Only what the client renderer needs (hp/mh stay server-side).
				table.insert(elist, { id = e.id, c = e.cf, boss = e.boss, k = e.kind })
			end
			fireBattling(enemyStates, elist)
		end
	end)
end

return Battle
