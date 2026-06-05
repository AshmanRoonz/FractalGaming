--!strict
-- Element menu for the hangar element podium. The server fires "OpenElements" with
-- the player's current element per pet slot + the options; this builds a popup where
-- you pick an element for Pet 1 and Pet 2. Choices go back via "ElementAction".

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Sfx = require(ReplicatedStorage.Shared.Sfx)

local ElementController = {}

local COLORS: { [string]: Color3 } = {
	fire = Color3.fromRGB(255, 120, 50),
	cold = Color3.fromRGB(140, 210, 255),
	lightning = Color3.fromRGB(255, 225, 90),
	water = Color3.fromRGB(70, 130, 235),
}

function ElementController.start()
	local player = Players.LocalPlayer
	local openElements = ReplicatedStorage:WaitForChild("OpenElements")
	local elementAction = ReplicatedStorage:WaitForChild("ElementAction")

	local gui = Instance.new("ScreenGui")
	gui.Name = "ElementMenu"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.Enabled = false
	gui.DisplayOrder = 50
	gui.Parent = player:WaitForChild("PlayerGui")

	local backdrop = Instance.new("TextButton")
	backdrop.Size = UDim2.fromScale(1, 1)
	backdrop.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
	backdrop.BackgroundTransparency = 0.45
	backdrop.Text = ""
	backdrop.AutoButtonColor = false
	backdrop.Parent = gui

	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromOffset(470, 330)
	panel.BackgroundColor3 = Color3.fromRGB(24, 27, 38)
	panel.BorderSizePixel = 0
	panel.Parent = gui
	local pc = Instance.new("UICorner")
	pc.CornerRadius = UDim.new(0, 14)
	pc.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(150, 110, 230)
	stroke.Thickness = 2
	stroke.Parent = panel

	local title = Instance.new("TextLabel")
	title.Position = UDim2.fromOffset(24, 18)
	title.Size = UDim2.fromOffset(300, 32)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.GothamBlack
	title.TextSize = 26
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextColor3 = Color3.fromRGB(200, 165, 255)
	title.Text = "ELEMENTS"
	title.Parent = panel

	local closeBtn = Instance.new("TextButton")
	closeBtn.AnchorPoint = Vector2.new(1, 0)
	closeBtn.Position = UDim2.new(1, -16, 0, 16)
	closeBtn.Size = UDim2.fromOffset(34, 34)
	closeBtn.BackgroundColor3 = Color3.fromRGB(50, 55, 70)
	closeBtn.Font = Enum.Font.GothamBold
	closeBtn.TextSize = 22
	closeBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
	closeBtn.Text = "X"
	closeBtn.Parent = panel
	local cc = Instance.new("UICorner")
	cc.CornerRadius = UDim.new(0, 8)
	cc.Parent = closeBtn

	local function close()
		gui.Enabled = false
	end
	backdrop.Activated:Connect(close)
	closeBtn.Activated:Connect(close)

	-- One row of element buttons for a pet slot.
	local function makeRow(which: number, label: string, y: number, options: { string }, current: string)
		local rowLabel = Instance.new("TextLabel")
		rowLabel.Position = UDim2.fromOffset(24, y)
		rowLabel.Size = UDim2.fromOffset(120, 28)
		rowLabel.BackgroundTransparency = 1
		rowLabel.Font = Enum.Font.GothamBold
		rowLabel.TextSize = 18
		rowLabel.TextXAlignment = Enum.TextXAlignment.Left
		rowLabel.TextColor3 = Color3.fromRGB(235, 235, 240)
		rowLabel.Text = label
		rowLabel.Parent = panel

		for i, el in options do
			local btn = Instance.new("TextButton")
			btn.Position = UDim2.fromOffset(24 + (i - 1) * 106, y + 30)
			btn.Size = UDim2.fromOffset(98, 44)
			btn.Font = Enum.Font.GothamBold
			btn.TextSize = 15
			btn.Text = el:upper()
			btn.TextColor3 = Color3.fromRGB(20, 22, 30)
			btn.BackgroundColor3 = COLORS[el] or Color3.fromRGB(120, 120, 130)
			btn.AutoButtonColor = true
			btn.Parent = panel
			local bc = Instance.new("UICorner")
			bc.CornerRadius = UDim.new(0, 8)
			bc.Parent = btn
			if el == current then
				local sel = Instance.new("UIStroke")
				sel.Color = Color3.fromRGB(255, 255, 255)
				sel.Thickness = 3
				sel.Parent = btn
			end
			btn.Activated:Connect(function()
				Sfx.play("ui")
				elementAction:FireServer(which, el)
			end)
		end
	end

	openElements.OnClientEvent:Connect(function(data)
		if type(data) ~= "table" then
			return
		end
		-- Clear previous rows (keep title/close/backdrop).
		for _, child in panel:GetChildren() do
			if child:IsA("TextButton") and child ~= closeBtn then
				child:Destroy()
			elseif child:IsA("TextLabel") and child ~= title then
				child:Destroy()
			end
		end
		local options = data.options or { "fire", "cold", "lightning", "water" }
		makeRow(1, "Pet 1", 70, options, data.el1)
		makeRow(2, "Pet 2", 190, options, data.el2)
		gui.Enabled = true
	end)
end

return ElementController
