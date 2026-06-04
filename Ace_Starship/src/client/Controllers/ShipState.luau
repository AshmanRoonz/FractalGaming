--!strict
-- Live state of the local ship, written by ShipController each frame and read by
-- other client systems (terrain, enemies, weapons). Also holds the ship's health
-- so enemies can damage it.

local ShipState = {
	position = Vector3.new(0, 100, 0),
	forward = Vector3.new(0, 0, -1), -- unit heading the ship is looking/flying
	strafe = 0, -- current lateral input (-1 left .. +1 right), drives the pet's side
	beamHit = (nil :: Vector3?), -- where our main beam is hitting (for replication)

	maxHealth = 100,
	health = 100,
	lastHit = 0, -- os.clock() of the last damage taken (drives regen delay)
	invulnUntil = 0, -- brief immunity window (e.g. just after respawn)
}

-- Apply damage to the ship (respects the invulnerability window).
function ShipState.damage(amount: number)
	if os.clock() < ShipState.invulnUntil then
		return
	end
	ShipState.health = math.max(0, ShipState.health - amount)
	ShipState.lastHit = os.clock()
end

return ShipState
