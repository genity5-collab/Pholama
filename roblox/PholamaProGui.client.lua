--!strict
-- PHOLAMA PRO (Roblox side, screen)
-- Put this in a *LocalScript* inside StarterGui, named "PholamaProGui". It builds its own window, so you draw nothing.
-- It only shows buttons and sends the typed code to the server. The server (PholamaPro) decides everything.
-- Press the "Pholama Pro" button at the bottom left to open the window.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local SUBSCRIPTION_ID = "EXP-6721075596832670281"

local player = Players.LocalPlayer
local remote = ReplicatedStorage:WaitForChild("PholamaProEvent") :: RemoteEvent

local gui = Instance.new("ScreenGui")
gui.Name = "PholamaProGui"
gui.ResetOnSpawn = false
gui.DisplayOrder = 50
gui.Parent = player:WaitForChild("PlayerGui")

local function corner(o: Instance, r: number)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, r)
	c.Parent = o
end

local function label(parent: Instance, text: string, size: number, y: number, h: number, bold: boolean?): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = UDim2.new(1, -32, 0, h)
	l.Position = UDim2.new(0, 16, 0, y)
	l.Text = text
	l.TextWrapped = true
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextYAlignment = Enum.TextYAlignment.Top
	l.Font = if bold then Enum.Font.GothamBold else Enum.Font.Gotham
	l.TextSize = size
	l.TextColor3 = Color3.fromRGB(235, 235, 240)
	l.Parent = parent
	return l
end

local function button(parent: Instance, text: string, y: number, color: Color3): TextButton
	local b = Instance.new("TextButton")
	b.Size = UDim2.new(1, -32, 0, 40)
	b.Position = UDim2.new(0, 16, 0, y)
	b.BackgroundColor3 = color
	b.Text = text
	b.Font = Enum.Font.GothamBold
	b.TextSize = 16
	b.TextColor3 = Color3.new(1, 1, 1)
	b.AutoButtonColor = true
	b.Parent = parent
	corner(b, 10)
	return b
end

-- The small button that opens the window
local open = Instance.new("TextButton")
open.Name = "OpenPro"
open.Size = UDim2.new(0, 130, 0, 36)
open.Position = UDim2.new(0, 12, 1, -48)
open.BackgroundColor3 = Color3.fromRGB(88, 101, 242)
open.Text = "Pholama Pro"
open.Font = Enum.Font.GothamBold
open.TextSize = 15
open.TextColor3 = Color3.new(1, 1, 1)
open.Parent = gui
corner(open, 10)

-- The window
local win = Instance.new("Frame")
win.Visible = false
win.AnchorPoint = Vector2.new(0.5, 0.5)
win.Position = UDim2.fromScale(0.5, 0.5)
win.Size = UDim2.new(0, 360, 0, 410)
win.BackgroundColor3 = Color3.fromRGB(28, 29, 36)
win.Parent = gui
corner(win, 16)
local fit = Instance.new("UISizeConstraint") -- never wider than a small phone screen
fit.MaxSize = Vector2.new(360, 410)
fit.Parent = win

label(win, "Pholama Pro", 22, 12, 30, true)
label(win, "More Agent Max messages, more projects and more friends. 100 Robux a month.", 14, 46, 40)
label(win, "1. On the Pholama website open Settings > Plans and tap Get my code.", 14, 92, 40)
local subBtn = button(win, "2. Subscribe to Pholama Pro", 136, Color3.fromRGB(67, 160, 71))
label(win, "3. Type your code here (it works for 30 minutes, one time):", 14, 186, 40)

local box = Instance.new("TextBox")
box.Size = UDim2.new(1, -32, 0, 44)
box.Position = UDim2.new(0, 16, 0, 228)
box.BackgroundColor3 = Color3.fromRGB(45, 46, 56)
box.PlaceholderText = "XXXXXXXX"
box.Text = ""
box.ClearTextOnFocus = false
box.Font = Enum.Font.Code
box.TextSize = 24
box.TextColor3 = Color3.new(1, 1, 1)
box.PlaceholderColor3 = Color3.fromRGB(120, 120, 135)
box.Parent = win
corner(box, 10)

local go = button(win, "Activate Pro", 284, Color3.fromRGB(88, 101, 242))
local status = label(win, "", 14, 334, 50)
local close = button(win, "Close", 364, Color3.fromRGB(70, 72, 84))

local function say(text: string, good: boolean?)
	status.Text = text
	status.TextColor3 = if good == true then Color3.fromRGB(120, 220, 130) elseif good == false then Color3.fromRGB(255, 130, 130) else Color3.fromRGB(235, 235, 240)
end

-- Only letters A-F and numbers, max 8, shown in capitals. The server checks again; this is just for comfort.
box:GetPropertyChangedSignal("Text"):Connect(function()
	local cleaned = string.upper((string.gsub(box.Text, "[^%x]", "")))
	cleaned = string.sub(cleaned, 1, 8)
	if cleaned ~= box.Text then
		box.Text = cleaned
	end
end)

local waiting = false
open.Activated:Connect(function()
	win.Visible = not win.Visible
	if win.Visible then
		say("")
		remote:FireServer("status")
	end
end)
close.Activated:Connect(function()
	win.Visible = false
end)

subBtn.Activated:Connect(function()
	-- Roblox shows its own purchase window. The payment happens on Roblox, never here.
	local MarketplaceService = game:GetService("MarketplaceService")
	local ok = pcall(function()
		MarketplaceService:PromptSubscriptionPurchase(player, SUBSCRIPTION_ID)
	end)
	if not ok then
		say("Could not open the subscription window. Try again.", false)
	end
end)

go.Activated:Connect(function()
	if waiting then
		return
	end
	if #box.Text ~= 8 then
		say("A code has 8 letters or numbers.", false)
		return
	end
	waiting = true
	go.Text = "Checking..."
	say("Checking your code...")
	remote:FireServer("redeem", box.Text)
end)

remote.OnClientEvent:Connect(function(kind: any, a: any, b: any)
	if kind == "subscribed" then
		if a == true then
			subBtn.Text = "You are subscribed"
			subBtn.BackgroundColor3 = Color3.fromRGB(60, 90, 65)
		else
			subBtn.Text = "2. Subscribe to Pholama Pro"
			subBtn.BackgroundColor3 = Color3.fromRGB(67, 160, 71)
		end
	elseif kind == "result" then
		waiting = false
		go.Text = "Activate Pro"
		say(tostring(b), a == true)
		if a == true then
			box.Text = ""
		end
	end
end)

-- After the Roblox purchase window closes, check again so the button updates.
game:GetService("MarketplaceService").PromptSubscriptionPurchaseFinished:Connect(function(_, _, _)
	task.wait(1)
	remote:FireServer("status")
end)
