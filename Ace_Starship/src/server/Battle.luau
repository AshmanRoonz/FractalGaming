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
local ENEMY_HP = 220 -- fewer but tankier enemies (was 100)
local BOSS_HP = 450
local SPAWN_MIN, SPAWN_MAX = 360, 680
local DRIFT_SPEED = 62 -- faster (was 42)
local GAP_Y = 110
local SPAWN_DROP = 55 -- spawn enemies this far below the player's altitude
local BOSS_HOVER = 35 -- bosses hug the ground, hovering this far above the terrain
local BIAS_TO_START = 0.7
local FIRE_RANGE = 300
local LEAD_TIME = 0.45 -- enemies aim this far ahead of your motion (smarter shooting)
local BALL_DMG = 12 -- a bit stronger (still many hits to kill you)
local BALL_SPEED = 170
local BALL_COOLDOWN = 1.5
local HIT_RADIUS = 12
local WAVE_DELAY = 3
local BASE_COUNT = 2
local MAX_COUNT = 5 -- far fewer per wave (was 12); they're tougher now
local BOSS_EVERY = 10
-- Boss scaling: each boss appearance (1st boss, 2nd boss, ...) gets tougher.
local BOSS_HP_STEP = 0.3 -- +30% HP per boss tier (was 0.75)
-- Boss/escort damage stays near a regular shot so you're never one-shot; the threat
-- is the NUMBER of coordinated shots, not lethality. (Was 18 + 6/tier = one-shot late.)
local BOSS_DMG_BASE, BOSS_DMG_STEP = 12, 0
local BOSS_CD_BASE, BOSS_CD_STEP, BOSS_CD_MIN = 1.0, 0.15, 0.4 -- fire cooldown shrinks
-- The core (the "mothership" at the back) keeps emitting LINES of enemies that
-- jitter side to side as they fly down at you (Space-Invaders style).
local MINION_INTERVAL = 5 -- seconds between lines (was 3)
local MINION_CAP = 4 -- max live line-enemies at once (was 12)
local MINION_SPEED = 95 -- escort route-runners' speed (faster)
local LINE_WIDTH = 2 -- enemies per spawned line (was 4)
local LINE_SPACING = 26 -- gap between enemies in a line
local LINE_SPEED = 88 -- how fast a line advances toward you (faster)
local JITTER_FREQ = 6 -- how fast the line shimmies left/right
local JITTER_AMP = 24 -- how far the line jitters
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

type EnemyRec = { id: number, cf: CFrame, hp: number, mh: number, boss: boolean, nextFire: number, bob: number, kind: string, dmg: number, cooldown: number, burst: number, wetUntil: number, frozenUntil: number, burnUntil: number, burnDps: number, role: string?, coreId: number?, orbitAngle: number, orbitRadius: number, shielded: boolean, escorts: number, enraged: boolean, nextSpawn: number, route: any, style: string?, slot: number, t0: number }

-- Movement styles a boss enemy can have: "route" runs football routes (sharp cuts);
-- "line" is part of a spawned row that jitters side to side as it flies down at you.

-- Football routes the boss's receivers run at you (each = legs of {forward, lateral,
-- distance}, relative to a downfield aim at the player and a random left/right side):
-- slant, out, dig, post, corner, comeback, go, wheel.
local ROUTES = {
	{ { 1, 0, 25 }, { 1, 1, 90 } }, -- slant
	{ { 1, 0, 40 }, { 0, 1, 70 } }, -- out
	{ { 1, 0, 40 }, { 0, -1, 70 } }, -- dig (in)
	{ { 1, 0, 60 }, { 1, -1, 90 } }, -- post
	{ { 1, 0, 60 }, { 1, 1, 90 } }, -- corner
	{ { 1, 0, 55 }, { -1, 0.4, 35 } }, -- comeback
	{ { 1, 0, 150 } }, -- go
	{ { 0, 1, 35 }, { 1, 0, 120 } }, -- wheel
}
-- Advance a runner to its next leg's waypoint; clears the route when the last leg ends.
local function advanceWaypoint(e: EnemyRec)
	local r = e.route
	if r.leg > #r.legs then
		e.route = nil
		return
	end
	local lg = r.legs[r.leg]
	local dir = r.fwd * lg[1] + r.lat * lg[2]
	dir = if dir.Magnitude > 0.01 then dir.Unit else r.fwd
	r.wp = r.wp + dir * lg[3]
	r.leg += 1
end
-- Start a fresh route aimed downfield at the player, picking a random side + route.
local function newRoute(e: EnemyRec, target: Vector3)
	local p = e.cf.Position
	local fwd = Vector3.new(target.X - p.X, 0, target.Z - p.Z)
	fwd = if fwd.Magnitude > 0.01 then fwd.Unit else Vector3.new(0, 0, 1)
	local lat = fwd:Cross(Vector3.yAxis)
	lat = (if lat.Magnitude > 0.01 then lat.Unit else Vector3.xAxis) * (if math.random() < 0.5 then 1 else -1)
	e.route = { legs = ROUTES[math.random(#ROUTES)], leg = 1, fwd = fwd, lat = lat, wp = p }
	advanceWaypoint(e)
end

-- ---- Formation boss: a Bosses model "core" ringed by orbiting escort enemies. The
-- core is shielded (invulnerable) until every escort is destroyed; then it enrages.
local ESCORT_BASE = 2 -- escorts on the first boss (was 5)
local ESCORT_PER_TIER = 1 -- +1 escort each boss tier
local ESCORT_MAX = 4 -- never more than this many escorts

-- ---- Elemental status + reactions (Magicka-style) -------------------------------
local WET_TIME = 4 -- seconds an enemy stays Wet
local FROZEN_TIME = 2.5 -- seconds Frozen
local FROZEN_SLOW = 0.3 -- movement multiplier while Frozen
local BURN_TIME = 4 -- seconds Burning
local BURN_DPS = 14 -- burn damage per second
local SHATTER_BONUS = 70 -- bonus damage when a hit lands on a Frozen enemy
local CHAIN_DAMAGE = 45 -- lightning-on-Wet arc damage to each nearby enemy
local CHAIN_RADIUS = 45 -- how far the electrocution arcs
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
	-- A dying escort weakens its formation core; when the last one falls, the core
	-- drops its shield and enrages. (Inline lookup: findEnemy is defined below.)
	if e.role == "escort" and e.coreId then
		for _, o in enemies do
			if o.id == e.coreId then
				o.escorts -= 1
				if o.escorts <= 0 then
					o.shielded = false
					o.enraged = true
				end
				break
			end
		end
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
		for p, rec in battling do
			Hangar.addBolts(p, BOLTS_PER_WAVE) -- everyone gets the wave-clear bonus
			-- Bank the wave only if it's this player's next continuous one (earned+1),
			-- so jumping into a higher-wave game doesn't save progress you skipped.
			if wave == rec.earned + 1 then
				rec.earned = wave
				Hangar.bankWave(p, wave)
			end
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

-- Nearest battling player's record (carries position + velocity, for lead aiming).
local function nearestPlayerRec(from: Vector3): any
	local best, bestD = nil, math.huge
	for _, rec in battling do
		local d = (rec.cf.Position - from).Magnitude
		if d < bestD then
			best, bestD = rec, d
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
	local rec: EnemyRec = {
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
		wetUntil = 0,
		frozenUntil = 0,
		burnUntil = 0,
		burnDps = 0,
		role = nil,
		coreId = nil,
		orbitAngle = 0,
		orbitRadius = 0,
		shielded = false,
		escorts = 0,
		enraged = false,
		nextSpawn = os.clock() + 3,
		route = nil,
		style = nil,
		slot = 0,
		t0 = os.clock(),
	}
	table.insert(enemies, rec)
	return rec
end

local function startWave()
	wave += 1
	local isBoss = wave % BOSS_EVERY == 0
	fireBattling(waveEvent, wave, isBoss)
	if isBoss then
		bossTier += 1 -- next boss tier (scales HP/damage/fire rate/volley)
		-- Formation: a shielded core (Bosses model) ringed by orbiting escort enemies.
		local core = spawnEnemy(true)
		core.role = "core"
		core.shielded = true
		local n = math.min(ESCORT_MAX, ESCORT_BASE + (bossTier - 1) * ESCORT_PER_TIER)
		core.escorts = n
		for _ = 1, n do
			local e = spawnEnemy(false)
			e.role = "escort"
			e.coreId = core.id
			e.style = "route" -- escorts run football routes; gate the core's shield
		end
	else
		for _ = 1, math.min(MAX_COUNT, BASE_COUNT + math.floor(wave / 4)) do
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
	local wasEmpty = next(battling) == nil
	battling[player] = {
		cf = CFrame.new(0, 100, 0),
		shipId = shipId or "starter_skiff",
		mainId = mainId or "laser",
		secId = secId or "Missile",
		petId = petId or "orb",
		beamHit = nil,
		vel = Vector3.zero, -- estimated velocity, for enemy lead aiming
		lastUpdate = 0,
		earned = Hangar.getMaxWave(player), -- only banks waves continuous from here
	}
	-- The first player into an empty battle sets the starting wave (1..their max+1).
	-- Joiners drop into the wave already in progress.
	if wasEmpty then
		local start = math.max(1, Hangar.getStartWave(player))
		wave = start - 1
		bossTier = math.floor((start - 1) / BOSS_EVERY) -- so bosses scale to the wave
		waveActive = false
		nextWaveAt = os.clock() + 3
		table.clear(enemies)
		table.clear(balls)
		table.clear(drops)
	end
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
			-- Estimate velocity from successive updates for enemy lead aiming.
			local now = os.clock()
			local dtu = now - (rec.lastUpdate or now)
			if dtu > 0.001 then
				local v = (cf.Position - rec.cf.Position) / dtu
				if v.Magnitude > 260 then
					v = v.Unit * 260 -- clamp wild jumps (respawns/teleports)
				end
				rec.vel = v
			end
			rec.lastUpdate = now
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

	damageEnemy.OnServerEvent:Connect(function(player, id, amount, element)
		if type(id) ~= "number" or type(amount) ~= "number" then
			return
		end
		local e = findEnemy(id)
		if not e then
			return
		end
		if e.shielded then
			return -- core is invulnerable until its escorts are destroyed
		end
		amount = math.clamp(amount, 0, MAX_HIT)
		local now = os.clock()
		local el = if type(element) == "string" then element else nil

		-- Shatter: any hit on a Frozen enemy hits hard and breaks the ice.
		if e.frozenUntil > now then
			amount += SHATTER_BONUS
			e.frozenUntil = 0
		end

		-- Reactions with an existing Wet status (the Magicka emergence):
		if el == "lightning" and e.wetUntil > now then
			e.wetUntil = 0
			-- Electrocution arcs to nearby enemies (collect first; killing mutates list).
			local arc = {}
			for _, o in enemies do
				if o ~= e and (o.cf.Position - e.cf.Position).Magnitude <= CHAIN_RADIUS then
					table.insert(arc, o)
				end
			end
			for _, o in arc do
				if not o.shielded then
					o.hp -= CHAIN_DAMAGE
					if o.hp <= 0 then
						killEnemy(o, player)
					end
				end
			end
			amount += CHAIN_DAMAGE
		elseif el == "cold" and e.wetUntil > now then
			e.wetUntil = 0
			e.frozenUntil = now + FROZEN_TIME -- Wet + Cold = Frozen
		end

		-- Apply this element's own status (opposites cancel):
		if el == "water" then
			e.wetUntil = now + WET_TIME
		elseif el == "fire" then
			if e.frozenUntil > now then
				e.frozenUntil = 0 -- Fire vs Cold: cancel
			else
				e.burnUntil = now + BURN_TIME
				e.burnDps = BURN_DPS
			end
		elseif el == "cold" then
			e.burnUntil = 0 -- Cold cancels Burn (opposite)
		end

		e.hp -= amount
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

		-- The core keeps spawning fast weaving minions in front of itself. (Collect
		-- cores first; spawning mutates the enemies list.)
		local cores: { EnemyRec } = {}
		for _, e in enemies do
			if e.role == "core" and now >= e.nextSpawn then
				table.insert(cores, e)
			end
		end
		for _, c in cores do
			local live = 0
			for _, o in enemies do
				if o.role == "minion" and o.coreId == c.id then
					live += 1
				end
			end
			if live + LINE_WIDTH <= MINION_CAP then
				c.nextSpawn = now + MINION_INTERVAL
				-- Emit a LINE: a row of enemies abreast, sharing a jitter phase (lineT0),
				-- spawned in front of the core facing the player.
				local cp = c.cf.Position
				local fwd = c.cf.LookVector
				local right = c.cf.RightVector
				local lineT0 = now
				for j = 1, LINE_WIDTH do
					local m = spawnEnemy(false)
					m.role = "minion"
					m.coreId = c.id
					m.style = "line"
					m.t0 = lineT0 -- whole line shimmies together
					local off = (j - (LINE_WIDTH + 1) / 2) * LINE_SPACING
					m.slot = off -- keeps its place in the row as the line advances
					m.cf = CFrame.new(cp + fwd * 70 + right * off + Vector3.new(0, 8, 0))
				end
			else
				c.nextSpawn = now + 0.5 -- at cap; check again soon
			end
		end

		-- Enemies: escorts orbit, minions weave in, everyone else drifts; all fire.
		for _, e in enemies do
			e.bob += dt
			local myPos = e.cf.Position
			local tRec = nearestPlayerRec(myPos)
			local target = if tRec then tRec.cf.Position else nil
			if target then
				-- Boss receivers (escorts/minions) run football routes or a synchronized
				-- invader sweep; the core hugs the ground; everyone else drifts in.
				local isRunner = (e.role == "escort" or e.role == "minion") and e.frozenUntil <= now
				local newPos
				if isRunner and e.style == "line" then
					-- Jittering line: advance toward the player while the whole row shimmies
					-- side to side together (shared t0), holding its place in the row (slot).
					local to = Vector3.new(target.X - myPos.X, 0, target.Z - myPos.Z)
					local fwd = if to.Magnitude > 0.01 then to.Unit else Vector3.new(0, 0, 1)
					local lat = fwd:Cross(Vector3.yAxis)
					lat = if lat.Magnitude > 0.01 then lat.Unit else Vector3.xAxis
					local jitter = math.sin((now - e.t0) * JITTER_FREQ) * JITTER_AMP
					local aim = target + lat * (e.slot + jitter)
					local dir = Vector3.new(aim.X - myPos.X, 0, aim.Z - myPos.Z)
					dir = if dir.Magnitude > 0.01 then dir.Unit else fwd
					newPos = myPos + dir * LINE_SPEED * dt + Vector3.new(0, math.sin(e.bob * 2) * 6 * dt, 0)
					local gy = WorldHeights.groundY(newPos.X, newPos.Z) + 10
					local cy = WorldHeights.ceilY(newPos.X, newPos.Z) - 10
					if cy > gy then
						newPos = Vector3.new(newPos.X, math.clamp(newPos.Y, gy, cy), newPos.Z)
					end
				elseif isRunner then
					-- Football route: head to the current waypoint, cut to the next on arrival.
					if not e.route then
						newRoute(e, target)
					end
					local r = e.route
					if r then
						local d = Vector3.new(r.wp.X - myPos.X, 0, r.wp.Z - myPos.Z)
						if d.Magnitude < 16 then
							advanceWaypoint(e)
							if not e.route then
								newRoute(e, target)
							end
							r = e.route
							d = Vector3.new(r.wp.X - myPos.X, 0, r.wp.Z - myPos.Z)
						end
						local hd = if d.Magnitude > 0.01 then d.Unit else e.cf.LookVector
						newPos = myPos + hd * MINION_SPEED * dt + Vector3.new(0, math.sin(e.bob * 2) * 6 * dt, 0)
						local gy = WorldHeights.groundY(newPos.X, newPos.Z) + 10
						local cy = WorldHeights.ceilY(newPos.X, newPos.Z) - 10
						if cy > gy then
							newPos = Vector3.new(newPos.X, math.clamp(newPos.Y, gy, cy), newPos.Z)
						end
					end
				end
				if not newPos then
					-- Core (hugs ground), frozen runners, and normal enemies drift in.
					local to = target - myPos
					local slow = if e.frozenUntil > now then FROZEN_SLOW else 1 -- Frozen crawl
					local step = if to.Magnitude > 60 then to.Unit * DRIFT_SPEED * slow * dt else Vector3.zero
					newPos = myPos + step + Vector3.new(0, math.sin(e.bob * 1.5) * 8 * dt, 0)
					if e.boss then
						local targetY = WorldHeights.groundY(newPos.X, newPos.Z) + BOSS_HOVER
						newPos = Vector3.new(newPos.X, newPos.Y + (targetY - newPos.Y) * math.clamp(dt * 3, 0, 1), newPos.Z)
					else
						local gy = WorldHeights.groundY(newPos.X, newPos.Z) + 10
						local cy = WorldHeights.ceilY(newPos.X, newPos.Z) - 10
						if cy > gy then
							newPos = Vector3.new(newPos.X, math.clamp(newPos.Y, gy, cy), newPos.Z)
						end
					end
				end
				e.cf = CFrame.lookAt(newPos, target)
				-- Only fire when a mountain isn't between us (so hiding works). The
				-- enraged core (escorts all dead) fires twice as fast.
				if (target - newPos).Magnitude <= FIRE_RANGE and now >= e.nextFire and e.frozenUntil <= now and not WorldHeights.blocked(newPos, target) then
					e.nextFire = now + (if e.enraged then e.cooldown * 0.5 else e.cooldown)
					-- Lead the shot: aim where the player is heading, not where they are.
					local aim = target + (if tRec then tRec.vel else Vector3.zero) * LEAD_TIME
					local baseDir = (aim - newPos).Unit
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

		-- Burn damage-over-time (iterate backward; killing removes from the list).
		for ei = #enemies, 1, -1 do
			local e = enemies[ei]
			if e.burnUntil > now then
				e.hp -= e.burnDps * dt
				if e.hp <= 0 then
					killEnemy(e, nil)
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
				if sliced and not e.shielded then
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
				-- Status flags (fz/bn/wt) let the client tint frozen/burning/wet enemies.
				local st = 0
				if e.frozenUntil > now then
					st += 1
				end
				if e.burnUntil > now then
					st += 2
				end
				if e.wetUntil > now then
					st += 4
				end
				table.insert(elist, { id = e.id, c = e.cf, boss = e.boss, k = e.kind, st = st, sh = e.shielded })
			end
			fireBattling(enemyStates, elist)
		end
	end)
end

return Battle
