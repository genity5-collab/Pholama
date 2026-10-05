--!strict
-- PHOLAMA PRO (Roblox side)
-- Put this in a *Script* inside ServerScriptService, named "PholamaPro".
-- NEVER put it in a LocalScript or ReplicatedStorage: it holds the secret, and anyone who can read the secret can give themselves Pro.
--
-- Before it works:
--   1) Game Settings > Security > turn ON "Allow HTTP Requests".
--   2) Paste your secret in SECRET below. It must be the SAME word you saved as PHOLAMA_PRO_SECRET in the backend.
--   3) Create the subscription in Creator Hub (100 Robux / month) and paste its id in SUBSCRIPTION_ID.
--   4) Add the client script "PholamaProGui" (the second file) inside StarterGui.
--
-- How it works:
--   * The player makes a code on the Pholama website (Settings > Plans). It lasts 30 minutes and works once.
--   * They subscribe here (Roblox takes the payment), type the code, and this script asks Roblox "is this player really subscribed?".
--   * Only if Roblox says yes does it tell Pholama. Pholama then gives that Pholama account 30 days of Pro.
--   * Next time they join, if they are still subscribed and under 3 days are left, it renews by itself. No code needed.

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local SECRET = "PASTE_YOUR_SECRET_HERE"                       -- the same word as PHOLAMA_PRO_SECRET
local SUBSCRIPTION_ID = "EXP-6721075596832670281"             -- your Pholama Pro subscription
local URL = "https://lyra-09dfabbf.base44.app/functions/proRedeem"

local TRIES_PER_MINUTE = 5                                    -- stops a player guessing codes
local ASK_AGAIN_SECONDS = 2                                   -- and stops button mashing

-- The client talks to the server through this one event.
local event = ReplicatedStorage:FindFirstChild("PholamaProEvent") :: RemoteEvent?
if not event then
	event = Instance.new("RemoteEvent")
	event.Name = "PholamaProEvent"
	event.Parent = ReplicatedStorage
end
local remote = event :: RemoteEvent

local function isSubscribed(player: Player): boolean
	local ok, result = pcall(function()
		return MarketplaceService:GetUserSubscriptionStatusAsync(player, SUBSCRIPTION_ID)
	end)
	return ok and result ~= nil and result.IsSubscribed == true
end

-- One call to Pholama. Returns the decoded answer, or nil when the network failed.
local function post(payload: { [string]: any }): { [string]: any }?
	payload.secret = SECRET
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = URL,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode(payload),
		})
	end)
	if not ok or not response then
		warn("[PholamaPro] could not reach Pholama")
		return nil
	end
	local decoded, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decoded or type(data) ~= "table" then
		return nil
	end
	return data
end

-- What we tell the player. Never the secret, never raw server text.
local MESSAGES: { [string]: string } = {
	code = "That code is wrong, already used, or older than 30 minutes. Make a new one on the website.",
	["roblox-used"] = "This Roblox account already powers a different Pholama account.",
	roblox = "Roblox could not confirm your account. Try again.",
	setup = "Pro is not switched on yet. Try again later.",
	["slow-down"] = "Too many tries. Wait a minute.",
}

local lastAsk: { [Player]: number } = {}
local recent: { [Player]: { number } } = {}
local busy: { [Player]: boolean } = {}

local function allowed(player: Player): boolean
	local now = os.clock()
	if lastAsk[player] and now - lastAsk[player] < ASK_AGAIN_SECONDS then
		return false
	end
	lastAsk[player] = now
	local list = recent[player] or {}
	local kept = {}
	for _, t in ipairs(list) do
		if now - t < 60 then
			table.insert(kept, t)
		end
	end
	if #kept >= TRIES_PER_MINUTE then
		recent[player] = kept
		return false
	end
	table.insert(kept, now)
	recent[player] = kept
	return true
end

remote.OnServerEvent:Connect(function(player: Player, action: any, code: any)
	if busy[player] then
		return
	end
	if action == "status" then
		remote:FireClient(player, "subscribed", isSubscribed(player))
		return
	end
	if action ~= "redeem" then
		return
	end
	if type(code) ~= "string" then
		return
	end
	code = string.upper((string.gsub(code, "%s", "")))
	-- Lua patterns have no {8}, so: exactly 8 characters, each one 0-9 or A-F.
	if #code ~= 8 or string.find(code, "[^0-9A-F]") then
		remote:FireClient(player, "result", false, "A code has 8 letters or numbers (0-9 and A-F).")
		return
	end
	if not allowed(player) then
		remote:FireClient(player, "result", false, "Slow down a little, then try again.")
		return
	end
	busy[player] = true
	-- Roblox decides whether they paid. The client is never trusted for this.
	if not isSubscribed(player) then
		busy[player] = nil
		remote:FireClient(player, "result", false, "Subscribe to Pholama Pro first, then enter your code.")
		return
	end
	local answer = post({ code = code, robloxId = player.UserId })
	busy[player] = nil
	if not answer then
		remote:FireClient(player, "result", false, "Could not reach Pholama. Try again in a minute.")
	elseif answer.ok == true then
		remote:FireClient(player, "result", true, "Pholama Pro is on! You can close this and go back to Pholama.")
	else
		remote:FireClient(player, "result", false, MESSAGES[tostring(answer.reason)] or "Something went wrong. Try again.")
	end
end)

-- Automatic renewal: a subscribed player who joins with under 3 days left is extended, with no code.
Players.PlayerAdded:Connect(function(player: Player)
	task.spawn(function()
		if isSubscribed(player) then
			post({ renew = true, robloxId = player.UserId }) -- the answer does not matter; "unknown" just means they never linked
		end
	end)
end)

Players.PlayerRemoving:Connect(function(player: Player)
	lastAsk[player] = nil
	recent[player] = nil
	busy[player] = nil
end)
