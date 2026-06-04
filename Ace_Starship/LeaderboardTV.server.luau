-- Leaderboard TV.
-- Put this Script inside your TV object in the hangar (a Script, not a LocalScript,
-- since the TV lives in the Workspace). It mirrors the live ranking that the server
-- publishes at ReplicatedStorage.Leaderboard onto a SurfaceGui on the screen.
--
-- It will REUSE a SurfaceGui + TextLabel you already built (so you can style it),
-- or create a basic one if there isn't one yet. Put the script either directly in
-- the screen part, or in a Model that contains a part named "Screen".

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local lb = ReplicatedStorage:WaitForChild("Leaderboard") -- StringValue from Hangar

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
	warn("LeaderboardTV: no screen part found (put the script in the screen part, or name a part 'Screen')")
	return
end

-- This TV may have come from a third-party model with random image/music channels.
-- Kill any of that so no untrusted assets load: hide leftover Decals/Textures and
-- stop + silence any Sounds anywhere in the TV.
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

-- Reuse an existing SurfaceGui/TextLabel if you styled one; else make a basic one.
local gui = screen:FindFirstChildWhichIsA("SurfaceGui")
if not gui then
	gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front -- change in Studio if your screen faces another way
	gui.Parent = screen
end

local label = gui:FindFirstChild("Body", true)
if not (label and label:IsA("TextLabel")) then
	label = gui:FindFirstChildWhichIsA("TextLabel", true)
end
if not label then
	local bg = Instance.new("Frame")
	bg.Size = UDim2.fromScale(1, 1)
	bg.BackgroundColor3 = Color3.fromRGB(8, 10, 16)
	bg.Parent = gui

	-- Title bar that says LEADERBOARD.
	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.Size = UDim2.fromScale(1, 0.15)
	title.BackgroundColor3 = Color3.fromRGB(20, 60, 110)
	title.Font = Enum.Font.GothamBlack
	title.TextScaled = true
	title.TextColor3 = Color3.fromRGB(190, 230, 255)
	title.Text = "⚡ LEADERBOARD"
	title.Parent = bg

	label = Instance.new("TextLabel")
	label.Name = "Body"
	label.Position = UDim2.fromScale(0.03, 0.18)
	label.Size = UDim2.fromScale(0.94, 0.8)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.Code -- monospace so the columns line up
	label.TextColor3 = Color3.fromRGB(220, 235, 255)
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Top
	label.TextScaled = false
	label.TextSize = 28
	label.Parent = bg
end

local function refresh()
	label.Text = lb.Value
end

lb:GetPropertyChangedSignal("Value"):Connect(refresh)
refresh()
