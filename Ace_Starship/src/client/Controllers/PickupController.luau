--!strict
-- Renders the physical Bolts that dead monsters drop. The server owns them: it
-- tells us where one dropped (BoltsDropped) and when it's gone (BoltsCollected),
-- and awards the Bolts when a player flies close. We just show the spinning pickup
-- and poof it when collected.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")

local BattleSession = require(script.Parent.BattleSession)
local Sfx = require(ReplicatedStorage.Shared.Sfx)

local PickupController = {}

local BOLT_SIZE = 18 -- on-screen size of a dropped Bolts (longest axis, studs)
-- Upright correction: the spawn forces world orientation, which can lay the model
-- flat if its Studio pivot is rotated. Tweak these degrees if it spawns lying down /
-- sideways (try 90 on a different axis, or flip a sign).
local BOLT_UPRIGHT = CFrame.Angles(math.rad(90), 0, 0)
local objectsFolder = ReplicatedStorage:WaitForChild("Assets"):FindFirstChild("Objects")

-- Build the Bolts pickup from Assets/Objects/Bolts, or a glowing fallback so it
-- still works before that asset is added.
local function buildBolt(): Model
	local src = objectsFolder and objectsFolder:FindFirstChild("Bolts")
	local model: Model
	if src and src:IsA("Model") then
		model = src:Clone()
	elseif src and src:IsA("BasePart") then
		model = Instance.new("Model")
		local p = src:Clone() :: BasePart
		p.Parent = model
		model.PrimaryPart = p
	else
		model = Instance.new("Model")
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.new(BOLT_SIZE, BOLT_SIZE, BOLT_SIZE)
		p.Material = Enum.Material.Neon
		p.Color = Color3.fromRGB(255, 215, 70)
		p.Parent = model
		model.PrimaryPart = p
	end
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") then
			d.Anchored = true
			d.CanCollide = false
			d.CastShadow = false
		end
	end
	if not model.PrimaryPart then
		model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart", true)
	end
	local _, size = model:GetBoundingBox()
	local longest = math.max(size.X, size.Y, size.Z)
	if longest > 0 then
		pcall(function()
			model:ScaleTo(BOLT_SIZE / longest)
		end)
	end
	return model
end

function PickupController.start()
	local gen = BattleSession.gen
	local container = Instance.new("Folder")
	container.Name = "BoltDrops"
	container.Parent = workspace
	BattleSession.track(container)

	local dropped = ReplicatedStorage:WaitForChild("BoltsDropped")
	local collected = ReplicatedStorage:WaitForChild("BoltsCollected")

	type Drop = { model: Model, base: Vector3, t: number }
	local byId: { [number]: Drop } = {}

	dropped.OnClientEvent:Connect(function(id, pos, _value)
		if BattleSession.gen ~= gen or byId[id] then
			return
		end
		local model = buildBolt()
		model:PivotTo(CFrame.new(pos) * BOLT_UPRIGHT)
		model.Parent = container
		byId[id] = { model = model, base = pos, t = math.random() * 6.28 }
	end)

	collected.OnClientEvent:Connect(function(id, picked)
		if BattleSession.gen ~= gen then
			return
		end
		local d = byId[id]
		if not d then
			return
		end
		byId[id] = nil
		if picked then
			Sfx.play("pickup")
			-- Quick sparkle: expand + fade each part, then clean up.
			for _, p in d.model:GetDescendants() do
				if p:IsA("BasePart") then
					TweenService:Create(p, TweenInfo.new(0.25), {
						Size = p.Size * 2,
						Transparency = 1,
					}):Play()
				end
			end
			Debris:AddItem(d.model, 0.3)
		else
			d.model:Destroy()
		end
	end)

	RunService.RenderStepped:Connect(function(dt)
		if BattleSession.gen ~= gen then
			return
		end
		for _, d in byId do
			d.t += dt
			local bob = math.sin(d.t * 2) * 2
			d.model:PivotTo(CFrame.new(d.base + Vector3.new(0, bob, 0)) * CFrame.Angles(0, d.t * 2, 0) * BOLT_UPRIGHT)
		end
	end)
end

return PickupController
