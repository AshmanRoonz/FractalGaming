--!strict
-- One battle "session" for the local player. Everything a battle starts captures
-- the current `gen`; on return-to-hangar, teardown() bumps `gen` so every old
-- loop/handler instantly no-ops, runs registered cleanups, destroys tracked
-- instances, and clears the local terrain.
--
-- This is CLIENT-LOCAL ONLY. The shared, server-authoritative battle (enemies,
-- waves, other pilots) keeps running for everyone else; leaving just removes this
-- player from the server's battling set and wipes their own local view.

local BattleSession = {}

BattleSession.gen = 0
local insts: { Instance } = {}
local cleanups: { () -> () } = {}

-- Track an instance to destroy on teardown. Returns it for inline use.
function BattleSession.track(i: Instance): Instance
	table.insert(insts, i)
	return i
end

-- Register a function to run on teardown (camera reset, etc.).
function BattleSession.onCleanup(fn: () -> ())
	table.insert(cleanups, fn)
end

function BattleSession.teardown()
	BattleSession.gen += 1 -- every loop/handler guarded by the old gen now bails
	for _, fn in cleanups do
		pcall(fn)
	end
	for _, i in insts do
		pcall(function()
			i:Destroy()
		end)
	end
	table.clear(insts)
	table.clear(cleanups)
	pcall(function()
		workspace.Terrain:Clear() -- local terrain only; other clients keep theirs
	end)
end

return BattleSession
