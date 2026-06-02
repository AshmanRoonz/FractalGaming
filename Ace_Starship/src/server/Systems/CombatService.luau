--!strict
-- Server-authoritative combat. Listens for fire requests, enforces each
-- player's fire-rate cooldown (derived from their FireRate upgrade), spawns the
-- equipped projectile with damage from their Damage/Multishot upgrades, and
-- resolves projectile->enemy hits. Clients never decide damage or kills.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local Net = require(ReplicatedStorage.Shared.Net)
local Projectiles = require(ReplicatedStorage.Shared.Catalog.Projectiles)
local ProjectileTemplate = require(ReplicatedStorage.Shared.Templates.ProjectileTemplate)
local Economy = require(ReplicatedStorage.Shared.Config.Economy)
local CurrencyService = require(ServerScriptService.Server.Systems.CurrencyService)

local CombatService = {}

local lastFire: { [Player]: number } = {}

-- Maps upgrade levels to concrete stats. Single place to tune the power curve.
local function statsFor(player: Player)
	local data = CurrencyService.getProfile(player)
	if not data then
		return nil
	end
	local up = data.Upgrades
	return {
		damage = 10 + (up.Damage - 1) * 4,
		cooldown = math.max(0.08, 0.4 - (up.FireRate - 1) * 0.02),
		shots = up.Multishot, -- number of pellets
		projectileId = data.EquippedProjectile,
	}
end

local function onFire(player: Player, payload: { aimDir: Vector3 })
	local stats = statsFor(player)
	if not stats then
		return
	end
	local now = os.clock()
	if now - (lastFire[player] or 0) < stats.cooldown then
		return -- rate-limited (anti-cheat)
	end
	lastFire[player] = now

	local character = player.Character
	local root = character and character:FindFirstChild("ShipRoot") :: BasePart?
	if not root then
		return
	end

	local def = Projectiles[stats.projectileId] or Projectiles.default_bolt
	local baseCFrame = root.CFrame
	for i = 1, stats.shots do
		-- Spread multishot slightly so pellets fan out.
		local spread = (i - (stats.shots + 1) / 2) * 2
		ProjectileTemplate.spawn({
			def = def,
			origin = baseCFrame * CFrame.Angles(0, math.rad(spread), 0),
			direction = payload.aimDir,
			speed = 220,
			damage = stats.damage,
			owner = player,
		})
	end
end

-- Called by the projectile touch handler (wired in start) when a projectile
-- overlaps an enemy. Resolves damage and rewards Bolts on kill.
function CombatService.resolveHit(projectile: BasePart, enemy: any)
	local damage = projectile:GetAttribute("Damage") :: number
	local killed = enemy:takeDamage(damage)
	projectile:Destroy()
	if killed then
		local ownerId = projectile:GetAttribute("OwnerUserId")
		local player = ownerId and Players:GetPlayerByUserId(ownerId)
		if player then
			local reward = enemy.def.boltsReward or Economy.BoltsPerKill
			CurrencyService.awardBolts(player, reward)
		end
	end
end

function CombatService.start()
	Net.fireWeapon.listen(onFire)
	Players.PlayerRemoving:Connect(function(player)
		lastFire[player] = nil
	end)
end

return CombatService
