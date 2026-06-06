--!strict
-- Central performance/quality setting, read by the client visual systems so they can
-- skip expensive work on weak devices. Touch devices default to Low. Module-level so
-- the choice persists across battles; the settings menu changes it live.

local Quality = {}

-- Everyone starts on High; lower it at the hangar Performance podium if needed.
Quality.level = "high" -- "low" | "med" | "high"

local listeners: { (string) -> () } = {}

function Quality.set(level: string)
	if level ~= "low" and level ~= "med" and level ~= "high" then
		return
	end
	Quality.level = level
	for _, fn in listeners do
		task.spawn(fn, level)
	end
end

function Quality.onChange(fn: (string) -> ())
	table.insert(listeners, fn)
end

-- Derived flags the visual systems check.
function Quality.particles(): boolean -- full layered explosions / smoke
	return Quality.level ~= "low"
end
function Quality.highlights(): boolean -- per-enemy status tint Highlights
	return Quality.level == "high"
end
function Quality.lights(): boolean -- dynamic PointLights on effects
	return Quality.level == "high"
end
function Quality.fancyProjectiles(): boolean -- enemy shots as full objects vs simple balls
	return Quality.level == "high"
end
function Quality.viewDistance(): number -- terrain chunk radius
	if Quality.level == "low" then
		return 2
	elseif Quality.level == "med" then
		return 3
	end
	return 4
end

return Quality
