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

-- Model names (from Assets/Enemies and Assets/Bosses); the server picks so all
-- clients agree. Bosses pull from the Bosses folder, regulars from Enemies.
local assetsRoot = ReplicatedStorage:WaitForChild("Assets")
local enemyAssets = assetsRoot:FindFirstChild("Enemies")
local bossAssets = assetsRoot:FindFirstChild("Bosses")
local function namesOf(folder: Instance?): { string }
	local names: { string } = {}
	if folder then
		for _, c in folder:GetChildren() do
			table.insert(names, c.Name)
		end
	end
	return names
end
local enemyKinds = namesOf(enemyAssets)
local bossKinds = namesOf(bossAssets)
local function pickKind(boss: boolean): string
	local pool = if boss and #bossKinds > 0 then bossKinds else enemyKinds
	return if #pool > 0 then pool[math.random(#pool)] else ""
end

-- Tuning (moved server-side).
local ENEMY_HP = 100
local BOSS_HP = 900
local SPAWN_MIN, SPAWN_MAX = 360, 680
local DRIFT_SPEED = 42
local GAP_Y = 110
local SPAWN_DROP = 55 -- spawn enemies this far below the player's altitude
local BOSS_HOVER = 35 -- bosses hug the ground, hovering this far above the terrain
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
-- Boss scaling: each boss appearance (1st boss, 2nd boss, ...) gets tougher.
local BOSS_HP_STEP = 0.75 -- +75% HP per boss tier
local BOSS_DMG_BASE, BOSS_DMG_STEP = 18, 6 -- ball damage: tier1=18, then +6 each
local BOSS_CD_BASE, BOSS_CD_STEP, BOSS_CD_MIN = 1.0, 0.15, 0.4 -- fire cooldown shrinks
local MAX_HIT = 160 -- cap on a single damage report (light anti-cheat; allows the bomb)
local BOLTS_PER_KILL = 6
local BOLTS_PER_WAVE = 30
local BOSS_BOLTS = 300 -- boss kills drop a huge lump
local DROP_PICKUP_RADIUS = 70 -- fly this close to a dropped Bolts to collect it
local DROP_LIFE = 25 -- seconds a dropped Bolts stays before despawning
-- Team "clothesline": a damaging beam strung between two nearby teammates' ships.
local CL_MAX_LEN = 320 -- only cuts when teammates are within this distance
local CL_RADIUS = 20 -- enemies this close to the beam get sliced
local CL_DPS = 70 -- clothesline damage per second
local START_DIR = Vector3.new(0, 0, -1)

type EnemyRec = { id: number, cf: CFrame, hp: number, mh: number, boss: boolean, nextFire: number, bob: number, kind: string, dmg: number, cooldown: number, burst: number }
type BallRec = { pos: Vector3, vel: Vector3, life: number, dmg: number }

local battling: { [Player]: { cf: CFrame, shipId: string, mainId: string, secId: string, petId: string, beamHit: Vector3? } } = {}

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
local bossTier = 0 -- how many bosses have appeared; each one is tougher

local shipUpdate, shipStates, enemyStates, waveEvent, damageEnemy, enemyFired, playerHit, playerFired, killEvent, playerDied, shipExploded
local boltsDropped, boltsCollected -- physical Bolts pickups dropped by dead monsters

-- Active Bolts drops: monsters drop these on death; players fly over to collect.
type Drop = { id: number, pos: Vector3, value: number, life: number }
local drops: { Drop } = {}
local nextDropId = 0

-- Shortest distance from point p to the segment a..b (for clothesline hit tests).
local function segDist(p: Vector3, a: Vector3, b: Vector3): number
	local ab = b - a
	local denom = ab:Dot(ab)
	local t = if denom > 0 then math.clamp((p - a):Dot(ab) / denom, 0, 1) else 0
	return (p - (a + ab * t)).Magnitude
end

-- An enemy reached 0 HP: credit the kill (if a player landed it), drop its Bolts,
-- remove it, and award the wave-clear bonus if that emptied the wave.
local function killEnemy(e: EnemyRec, crediter: Player?)
	if crediter then
		killEvent:FireClient(crediter)
		Hangar.addKill(crediter) -- count it for the leaderboard TVs
	end
	nextDropId += 1
	local value = if e.boss then BOSS_BOLTS else BOLTS_PER_KILL
	table.insert(drops, { id = nextDropId, pos = e.cf.Position, value = value, life = DROP_LIFE })
	fireBattling(boltsDropped, nextDropId, e.cf.Position, value)
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
	local pos = center + dir * dist
	-- Bosses hug the ground (they're huge); regulars spawn below the player's
	-- altitude with a little spread so they come up from beneath, not at eye level.
	local spawnY
	if boss then
		spawnY = WorldHeights.groundY(pos.X, pos.Z) + BOSS_HOVER
	else
		spawnY = math.clamp(center.Y - SPAWN_DROP + (math.random() - 0.5) * 40, GAP_Y - 80, GAP_Y + 30)
	end
	pos = Vector3.new(pos.X, spawnY, pos.Z)
	-- Boss stats scale with how many bosses have come before (bossTier).
	local hp = if boss then math.floor(BOSS_HP * (1 + (bossTier - 1) * BOSS_HP_STEP)) else ENEMY_HP
	local dmg = if boss then BOSS_DMG_BASE + (bossTier - 1) * BOSS_DMG_STEP else BALL_DMG
	local cooldown = if boss
		then math.max(BOSS_CD_MIN, BOSS_CD_BASE - (bossTier - 1) * BOSS_CD_STEP)
		else BALL_COOLDOWN
	local burst = if boss then math.min(6, 1 + bossTier) else 1 -- shots per volley
	table.insert(enemies, {
		id = nextId,
		cf = CFrame.new(pos),
		hp = hp,
		mh = hp,
		boss = boss,
		nextFire = os.clock() + 1 + math.random() * 2,
		bob = math.random() * 10,
		kind = pickKind(boss),
		dmg = dmg,
		cooldown = cooldown,
		burst = burst,
	})
end

local function startWave()
	wave += 1
	local isBoss = wave % BOSS_EVERY == 0
	fireBattling(waveEvent, wave, isBoss)
	if isBoss then
		bossTier += 1 -- next boss tier (scales HP/damage/fire rate/volley)
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

function Battle.playerLaunched(player: Player, shipId: string?, mainId: string?, secId: string?, petId: string?)
	battling[player] = {
		cf = CFrame.new(0, 100, 0),
		shipId = shipId or "starter_skiff",
		mainId = mainId or "laser",
		secId = secId or "Missile",
		petId = petId or "orb",
		beamHit = nil,
	}
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
	playerDied = makeEvent("PlayerDied", false)
	shipExploded = makeEvent("ShipExploded", false)
	boltsDropped = makeEvent("BoltsDropped", false)
	boltsCollected = makeEvent("BoltsCollected", false)

	-- A player's ship was destroyed: blow it up + remove it for everyone else right
	-- away (don't wait for them to return to the hangar).
	playerDied.OnServerEvent:Connect(function(player, pos)
		if not battling[player] then
			return
		end
		local at = if typeof(pos) == "Vector3" then pos else battling[player].cf.Position
		for other in battling do
			if other ~= player then
				shipExploded:FireClient(other, player.UserId, at)
			end
		end
		battling[player] = nil -- stop broadcasting the dead ship
	end)

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
			killEnemy(e, player)
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
				if e.boss then
					-- Bosses are huge: keep them hugging the ground so their heads
					-- don't punch through the ceiling. Ease toward ground height.
					local targetY = WorldHeights.groundY(newPos.X, newPos.Z) + BOSS_HOVER
					newPos = Vector3.new(newPos.X, newPos.Y + (targetY - newPos.Y) * math.clamp(dt * 3, 0, 1), newPos.Z)
				else
					-- Keep enemies inside the gap, not buried in terrain.
					local gy = WorldHeights.groundY(newPos.X, newPos.Z) + 10
					local cy = WorldHeights.ceilY(newPos.X, newPos.Z) - 10
					if cy > gy then
						newPos = Vector3.new(newPos.X, math.clamp(newPos.Y, gy, cy), newPos.Z)
					end
				end
				e.cf = CFrame.lookAt(newPos, target)
				-- Only fire when a mountain isn't between us (so hiding works).
				if to.Magnitude <= FIRE_RANGE and now >= e.nextFire and not WorldHeights.blocked(newPos, target) then
					e.nextFire = now + e.cooldown
					local baseDir = (target - newPos).Unit
					-- Fire e.burst shots in a small fan (bosses fire several at once).
					for b = 1, e.burst do
						local spread = if e.burst > 1 then (b - (e.burst + 1) / 2) * math.rad(9) else 0
						local dir = CFrame.fromAxisAngle(Vector3.yAxis, spread) * baseDir
						table.insert(balls, { pos = newPos, vel = dir * BALL_SPEED, life = 4, dmg = e.dmg })
						fireBattling(enemyFired, newPos, dir, BALL_SPEED)
					end
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
				playerHit:FireClient(hitPlayer, b.dmg)
				table.remove(balls, i)
			elseif hitTerrain or b.life <= 0 then
				table.remove(balls, i)
			end
		end

		-- Team clothesline: enemies caught on the beam between two nearby teammates
		-- take damage over time. Encourages flying in formation.
		local pts: { Vector3 } = {}
		for _, rec in battling do
			table.insert(pts, rec.cf.Position)
		end
		if #pts >= 2 then
			for ei = #enemies, 1, -1 do
				local e = enemies[ei]
				local sliced = false
				for i = 1, #pts do
					for j = i + 1, #pts do
						local a, b = pts[i], pts[j]
						if (b - a).Magnitude <= CL_MAX_LEN and segDist(e.cf.Position, a, b) <= CL_RADIUS then
							sliced = true
							break
						end
					end
					if sliced then
						break
					end
				end
				if sliced then
					e.hp -= CL_DPS * dt
					if e.hp <= 0 then
						killEnemy(e, nil)
					end
				end
			end
		end

		-- Bolts drops: a player flying close collects it; otherwise it despawns.
		for i = #drops, 1, -1 do
			local d = drops[i]
			d.life -= dt
			local taker: Player? = nil
			for player, rec in battling do
				if (rec.cf.Position - d.pos).Magnitude <= DROP_PICKUP_RADIUS then
					taker = player
					break
				end
			end
			if taker then
				Hangar.addBolts(taker, d.value)
				table.remove(drops, i)
				fireBattling(boltsCollected, d.id, true) -- true = picked up (poof it)
			elseif d.life <= 0 then
				table.remove(drops, i)
				fireBattling(boltsCollected, d.id, false) -- expired, just remove
			end
		end

		-- Broadcast ship + enemy states ~20 Hz.
		accum += dt
		if accum >= 0.05 then
			accum = 0
			local ships = {}
			for player, rec in battling do
				table.insert(ships, { u = player.UserId, c = rec.cf, s = rec.shipId, b = rec.beamHit, m = rec.mainId, x = rec.secId, p = rec.petId })
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
