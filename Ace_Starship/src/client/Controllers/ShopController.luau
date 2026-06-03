--!strict
-- Shop window for the hangar podiums. The server fires "OpenShop" with the item
-- list for a category (ship / laser / projectile); this builds a popup grid where
-- you Buy items with Bolts and Equip ones you own. Buy/Equip go back to the
-- server via "ShopAction", which validates and re-sends fresh data.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ShopController = {}

local TITLES = {
	ship = "SHIP HANGAR",
	main = "LASER SHOP",
	secondary = "PROJECTILE SHOP",
	pet = "PET SHOP",
}

local GOLD = Color3.fromRGB(255, 205, 90)
local GREEN = Color3.fromRGB(90, 200, 110)
local GREY = Color3.fromRGB(90, 96, 110)
local RED = Color3.fromRGB(200, 80, 80)

function ShopController.start()
	local player = Players.LocalPlayer
	local openShop = ReplicatedStorage:WaitForChild("OpenShop")
	local shopAction = ReplicatedStorage:WaitForChild("ShopAction")

	local gui = Instance.new("ScreenGui")
	gui.Name = "Shop"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.Enabled = false
	gui.DisplayOrder = 50
	gui.Parent = player:WaitForChild("PlayerGui")

	-- Dim modal backdrop (click to close).
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
	panel.Size = UDim2.fromOffset(470, 540)
	panel.BackgroundColor3 = Color3.fromRGB(24, 27, 38)
	panel.BorderSizePixel = 0
	panel.Parent = gui
	local pc = Instance.new("UICorner")
	pc.CornerRadius = UDim.new(0, 14)
	pc.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(70, 150, 255)
	stroke.Thickness = 2
	stroke.Parent = panel

	local titleLabel = Instance.new("TextLabel")
	titleLabel.Position = UDim2.fromOffset(24, 18)
	titleLabel.Size = UDim2.fromOffset(300, 32)
	titleLabel.BackgroundTransparency = 1
	titleLabel.Font = Enum.Font.GothamBlack
	titleLabel.TextSize = 26
	titleLabel.TextXAlignment = Enum.TextXAlignment.Left
	titleLabel.TextColor3 = Color3.fromRGB(120, 200, 255)
	titleLabel.Text = "SHOP"
	titleLabel.Parent = panel

	local boltsLabel = Instance.new("TextLabel")
	boltsLabel.Position = UDim2.fromOffset(24, 52)
	boltsLabel.Size = UDim2.fromOffset(300, 24)
	boltsLabel.BackgroundTransparency = 1
	boltsLabel.Font = Enum.Font.GothamBold
	boltsLabel.TextSize = 18
	boltsLabel.TextXAlignment = Enum.TextXAlignment.Left
	boltsLabel.TextColor3 = GOLD
	boltsLabel.Text = "Bolts: 0"
	boltsLabel.Parent = panel

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

	local scroll = Instance.new("ScrollingFrame")
	scroll.Position = UDim2.fromOffset(16, 92)
	scroll.Size = UDim2.fromOffset(438, 430)
	scroll.BackgroundTransparency = 1
	scroll.BorderSizePixel = 0
	scroll.ScrollBarThickness = 6
	scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
	scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scroll.Parent = panel
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 8)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = scroll

	local function close()
		gui.Enabled = false
	end
	backdrop.Activated:Connect(close)
	closeBtn.Activated:Connect(close)

	local function makeRow(category: string, item: any, bolts: number, order: number)
		local row = Instance.new("Frame")
		row.Size = UDim2.new(1, -8, 0, 56)
		row.BackgroundColor3 = Color3.fromRGB(36, 40, 54)
		row.BorderSizePixel = 0
		row.LayoutOrder = order
		row.Parent = scroll
		local rc = Instance.new("UICorner")
		rc.CornerRadius = UDim.new(0, 8)
		rc.Parent = row

		local name = Instance.new("TextLabel")
		name.Position = UDim2.fromOffset(14, 8)
		name.Size = UDim2.fromOffset(260, 24)
		name.BackgroundTransparency = 1
		name.Font = Enum.Font.GothamBold
		name.TextSize = 18
		name.TextXAlignment = Enum.TextXAlignment.Left
		name.TextColor3 = Color3.fromRGB(245, 245, 245)
		name.Text = item.name
		name.Parent = row

		local sub = Instance.new("TextLabel")
		sub.Position = UDim2.fromOffset(14, 30)
		sub.Size = UDim2.fromOffset(260, 18)
		sub.BackgroundTransparency = 1
		sub.Font = Enum.Font.Gotham
		sub.TextSize = 13
		sub.TextXAlignment = Enum.TextXAlignment.Left
		sub.TextColor3 = Color3.fromRGB(170, 175, 185)
		sub.Text = if item.price == 0 then "Free" else item.price .. " Bolts"
		sub.Parent = row

		local btn = Instance.new("TextButton")
		btn.AnchorPoint = Vector2.new(1, 0.5)
		btn.Position = UDim2.new(1, -12, 0.5, 0)
		btn.Size = UDim2.fromOffset(120, 38)
		btn.Font = Enum.Font.GothamBold
		btn.TextSize = 16
		btn.TextColor3 = Color3.fromRGB(20, 22, 30)
		btn.AutoButtonColor = true
		btn.Parent = row
		local bc = Instance.new("UICorner")
		bc.CornerRadius = UDim.new(0, 8)
		bc.Parent = btn

		if item.equipped then
			btn.Text = "EQUIPPED"
			btn.BackgroundColor3 = GREY
			btn.AutoButtonColor = false
			btn.TextColor3 = Color3.fromRGB(220, 220, 220)
		elseif item.owned then
			btn.Text = "EQUIP"
			btn.BackgroundColor3 = GREEN
			btn.Activated:Connect(function()
				shopAction:FireServer(category, "equip", item.id)
			end)
		elseif bolts >= item.price then
			btn.Text = "BUY"
			btn.BackgroundColor3 = GOLD
			btn.Activated:Connect(function()
				shopAction:FireServer(category, "buy", item.id)
			end)
		else
			btn.Text = "BUY"
			btn.BackgroundColor3 = RED
			btn.AutoButtonColor = false
			btn.TextColor3 = Color3.fromRGB(255, 230, 230)
			-- not enough Bolts; server would reject, so clicking is a no-op
		end
	end

	openShop.OnClientEvent:Connect(function(data)
		if type(data) ~= "table" then
			return
		end
		titleLabel.Text = TITLES[data.category] or "SHOP"
		boltsLabel.Text = "Bolts: " .. tostring(data.bolts)
		for _, child in scroll:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		for i, item in data.items do
			makeRow(data.category, item, data.bolts, i)
		end
		gui.Enabled = true
	end)
end

return ShopController
