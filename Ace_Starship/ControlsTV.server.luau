-- Touch Controls TV (TV2).
-- Put this Script (NOT a LocalScript) inside your TV2 object in the hangar. It paints
-- a "Touch Controls" reference onto a SurfaceGui on the screen. Put the script directly
-- in the screen part, or in a Model that contains a part named "Screen".
-- Static display: no data needed, it just shows the control scheme.

local function findScreen(): BasePart?
	local p = script.Parent
	local named = p:FindFirstChild("Screen")
	if named and named:IsA("BasePart") then
		return named
	end
	if p:IsA("BasePart") then
		return p
	end
	return p:FindFirstChildWhichIsA("BasePart", true)
end

local screen = findScreen()
if not screen then
	warn("ControlsTV: no screen part found (put the script in the screen part, or name a part 'Screen')")
	return
end

-- Kill any leftover image/music channels the TV model may have shipped with.
local tv = screen.Parent
for _, d in (tv or screen):GetDescendants() do
	if d:IsA("Decal") or d:IsA("Texture") then
		d.Transparency = 1
	elseif d:IsA("Sound") then
		pcall(function()
			d:Stop()
		end)
		d.Playing = false
		d.Looped = false
		d.Volume = 0
		d.SoundId = ""
	end
end
screen.Material = Enum.Material.SmoothPlastic
screen.Color = Color3.fromRGB(8, 10, 16)

-- Fresh SurfaceGui (clear whatever was on it before, e.g. the leaderboard).
local old = screen:FindFirstChildWhichIsA("SurfaceGui")
if old then
	old:Destroy()
end
local gui = Instance.new("SurfaceGui")
gui.Face = Enum.NormalId.Front -- change in Studio if your screen faces another way
gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
gui.PixelsPerStud = 50
gui.Parent = screen

local bg = Instance.new("Frame")
bg.Size = UDim2.fromScale(1, 1)
bg.BackgroundColor3 = Color3.fromRGB(8, 10, 16)
bg.BorderSizePixel = 0
bg.Parent = gui

local title = Instance.new("TextLabel")
title.Size = UDim2.fromScale(1, 0.14)
title.BackgroundColor3 = Color3.fromRGB(20, 60, 110)
title.BorderSizePixel = 0
title.Font = Enum.Font.GothamBlack
title.TextScaled = true
title.TextColor3 = Color3.fromRGB(190, 230, 255)
title.Text = "TOUCH CONTROLS"
title.Parent = bg

-- Scrollless list of gesture -> action rows.
local list = Instance.new("Frame")
list.Position = UDim2.fromScale(0.04, 0.17)
list.Size = UDim2.fromScale(0.92, 0.8)
list.BackgroundTransparency = 1
list.Parent = bg
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0.02, 0)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = list

local rows = {
	{ "TILT", "move  -  forward / back / strafe" },
	{ "SWIPE up / down", "fly up / down" },
	{ "SWIPE left / right", "barrel roll (dodge)" },
	{ "TAP", "aim there  (tap a foe to fire)" },
	{ "DOUBLE TAP", "bomb" },
	{ "BUTTONS", "SHIELD  |  < 90  180  90 >  |  BOOST" },
	{ "MAIN LASER", "auto-fires at your target" },
}

for i, r in rows do
	local row = Instance.new("Frame")
	row.Size = UDim2.fromScale(1, 0.12)
	row.BackgroundColor3 = Color3.fromRGB(16, 22, 34)
	row.BackgroundTransparency = if i % 2 == 0 then 0.2 else 0.45
	row.BorderSizePixel = 0
	row.LayoutOrder = i
	row.Parent = list
	local rc = Instance.new("UICorner")
	rc.CornerRadius = UDim.new(0.2, 0)
	rc.Parent = row

	local key = Instance.new("TextLabel")
	key.Position = UDim2.fromScale(0.02, 0.1)
	key.Size = UDim2.fromScale(0.4, 0.8)
	key.BackgroundTransparency = 1
	key.Font = Enum.Font.GothamBlack
	key.TextScaled = true
	key.TextXAlignment = Enum.TextXAlignment.Left
	key.TextColor3 = Color3.fromRGB(120, 220, 255)
	key.Text = r[1]
	key.Parent = row

	local act = Instance.new("TextLabel")
	act.Position = UDim2.fromScale(0.44, 0.1)
	act.Size = UDim2.fromScale(0.54, 0.8)
	act.BackgroundTransparency = 1
	act.Font = Enum.Font.GothamBold
	act.TextScaled = true
	act.TextXAlignment = Enum.TextXAlignment.Left
	act.TextColor3 = Color3.fromRGB(230, 238, 250)
	act.Text = r[2]
	act.Parent = row
end
