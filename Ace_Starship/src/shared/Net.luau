--!strict
-- Single source of truth for client<->server messages. Built on ByteNet so
-- payloads are typed and compact. Both server systems and client controllers
-- require this module; nobody creates raw RemoteEvents elsewhere.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ByteNet = require(ReplicatedStorage.Packages.ByteNet)

local Net = ByteNet.defineNamespace("AceStarship", function()
	return {
		-- Client -> Server: player pressed/holds fire. Server validates fire
		-- rate against the player's weapon cooldown (anti-cheat).
		fireWeapon = ByteNet.definePacket({
			value = ByteNet.struct({
				aimDir = ByteNet.vec3,
			}),
			reliabilityType = "unreliable",
		}),

		-- Client -> Server: steering input (lateral position within tunnel).
		steer = ByteNet.definePacket({
			value = ByteNet.struct({
				offset = ByteNet.vec3, -- desired lateral offset from tunnel center
			}),
			reliabilityType = "unreliable",
		}),

		-- Client -> Server: buy / equip requests (validated server-side).
		buyItem = ByteNet.definePacket({
			value = ByteNet.struct({
				kind = ByteNet.string, -- "projectile" | "ship" | "upgrade"
				id = ByteNet.string,
			}),
		}),
		equipItem = ByteNet.definePacket({
			value = ByteNet.struct({
				kind = ByteNet.string,
				id = ByteNet.string,
			}),
		}),

		-- Server -> Client: authoritative state pushes.
		runState = ByteNet.definePacket({
			value = ByteNet.struct({
				distance = ByteNet.float32,
				bolts = ByteNet.uint32,
				alive = ByteNet.bool,
			}),
		}),
		bossSpawned = ByteNet.definePacket({
			value = ByteNet.struct({
				bossId = ByteNet.string,
			}),
		}),
	}
end)

return Net
