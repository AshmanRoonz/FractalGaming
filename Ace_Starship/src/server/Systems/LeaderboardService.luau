--!strict
-- Two separate leaderboards: solo distance and co-op distance (per GDD, so a
-- 4-player team can't bury solo players). Backed by OrderedDataStore. A run's
-- final distance is submitted to the board matching the mode it was played in.

local DataStoreService = game:GetService("DataStoreService")

local LeaderboardService = {}

local boards = {
	solo = DataStoreService:GetOrderedDataStore("Leaderboard_Solo_v1"),
	coop = DataStoreService:GetOrderedDataStore("Leaderboard_Coop_v1"),
}

-- mode: "solo" | "coop". Only records personal bests (SetAsync on improvement).
function LeaderboardService.submit(mode: string, userId: number, distance: number)
	local board = boards[mode]
	if not board then
		return
	end
	local key = tostring(userId)
	local ok, current = pcall(function()
		return board:GetAsync(key)
	end)
	if ok and current and current >= distance then
		return
	end
	pcall(function()
		board:SetAsync(key, math.floor(distance))
	end)
end

function LeaderboardService.top(mode: string, count: number)
	local board = boards[mode]
	if not board then
		return {}
	end
	local ok, pages = pcall(function()
		return board:GetSortedAsync(false, count)
	end)
	if not ok then
		return {}
	end
	return pages:GetCurrentPage()
end

function LeaderboardService.start()
	-- Nothing to warm up yet; submissions happen on run end via MatchManager.
end

return LeaderboardService
