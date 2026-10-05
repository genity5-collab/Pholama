-- A tiny fake Roblox so the REAL PholamaPro server script can run outside Roblox.
T = { clockNow = 0, posts = {}, fired = {}, subscribed = true, httpAnswer = '{"ok":true}', httpFail = false, clock = 0, conns = {} }
local function signal() local s = { fns = {} } function s:Connect(f) table.insert(self.fns, f) return { Disconnect = function() end } end function s:Fire(...) for _, f in ipairs(self.fns) do f(...) end end return s end
local remote = { Name = "", OnServerEvent = signal(), FireClient = function(_, p, ...) table.insert(T.fired, { ... }) end }
local players = { PlayerAdded = signal(), PlayerRemoving = signal() }
local repl = { FindFirstChild = function() return nil end }
function repl:FindFirstChild() return nil end
local svc = {
  Players = players, ReplicatedStorage = repl,
  HttpService = {
    JSONEncode = function(_, t) local parts = {} for k, v in pairs(t) do table.insert(parts, k .. "=" .. tostring(v)) end table.sort(parts) return table.concat(parts, "&") end,
    JSONDecode = function(_, s) if s == "garbage" then error("bad json") end local ok = s:find('"ok":true') ~= nil local reason = s:match('"reason":"([^"]+)"') return { ok = ok, reason = reason } end,
    RequestAsync = function(_, req) if T.httpFail then error("network down") end table.insert(T.posts, req.Body) return { Body = T.httpAnswer } end,
  },
  MarketplaceService = { GetUserSubscriptionStatusAsync = function() return { IsSubscribed = T.subscribed } end },
}
game = { GetService = function(_, n) return svc[n] end }
Instance = { new = function() return remote end }
warn = function() end
task = { spawn = function(f) f() end }
T.remote, T.players = remote, players

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

local os = { clock = function() return T.clockNow end }
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

local SECRET = "testsecret"                       -- the same word as PHOLAMA_PRO_SECRET
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

local bad = 0
local function ok(name, cond, extra) print((cond and "PASS " or "FAIL ") .. name .. ((not cond and extra ~= nil) and ("  -> " .. tostring(extra)) or "")); if not cond then bad = bad + 1 end end
local P = { UserId = 777 }
local function fire(action, code) T.fired = {}; T.remote.OnServerEvent.fns[1](P, action, code); return T.fired[#T.fired] end
local function fresh() T.posts = {}; T.subscribed = true; T.httpFail = false; T.httpAnswer = '{"ok":true}'; T.players.PlayerRemoving:Fire(P) end
ok("the script loaded and listens", #T.remote.OnServerEvent.fns == 1)

local r = fire("redeem", "ab12cd34")
ok("a good code from a subscribed player succeeds", r and r[1] == "result" and r[2] == true, r and tostring(r[3]))
ok("Pholama is told the code in CAPITALS, the Roblox id and the secret", T.posts[#T.posts] and T.posts[#T.posts]:find("code=AB12CD34") and T.posts[#T.posts]:find("robloxId=777") and T.posts[#T.posts]:find("secret=testsecret"), T.posts[#T.posts])

fresh(); T.subscribed = false; r = fire("redeem", "AB12CD34")
ok("NOT subscribed: refused, and Pholama is never contacted", r and r[2] == false and #T.posts == 0, #T.posts)
ok("and the message tells them to subscribe", r and tostring(r[3]):find("Subscribe"))

fresh(); r = fire("redeem", "  ab 12 cd 34  ")
ok("spaces inside the code are ignored", r and r[2] == true and T.posts[1]:find("code=AB12CD34"), T.posts[1])

for _, bad_code in ipairs({ "", "123", "AB12CD3", "AB12CD345", "GHIJKLMN", "AB12CD3!", "../../etc" }) do
  fresh(); r = fire("redeem", bad_code)
  ok("a wrong-shaped code never reaches Pholama: '" .. bad_code .. "'", r and r[2] == false and #T.posts == 0, #T.posts)
end
fresh(); r = fire("redeem", 12345678); ok("a number instead of text is ignored", r == nil or #T.posts == 0)
fresh(); r = fire("redeem", { "AB12CD34" }); ok("a table instead of text is ignored", #T.posts == 0)
fresh(); r = fire("redeem", nil); ok("no code at all is ignored", #T.posts == 0)
fresh(); r = fire("hack", "AB12CD34"); ok("an unknown action does nothing", #T.posts == 0)

-- answers from Pholama turn into kind messages, never raw server text
local answers = { { '{"ok":false,"reason":"code"}', "wrong, already used" }, { '{"ok":false,"reason":"roblox-used"}', "different Pholama" }, { '{"ok":false,"reason":"setup"}', "not switched on" }, { '{"ok":false,"reason":"slow-down"}', "Too many" }, { '{"ok":false,"reason":"secret"}', "Something went wrong" }, { '{"ok":false,"reason":"<script>"}', "Something went wrong" } }
for _, a in ipairs(answers) do
  fresh(); T.httpAnswer = a[1]; T.clock = T.clock + 10; r = fire("redeem", "AB12CD34")
  ok("Pholama says " .. a[1]:sub(1, 40) .. " -> player sees a friendly message", r and r[2] == false and tostring(r[3]):find(a[2], 1, true) and not tostring(r[3]):find("secret") and not tostring(r[3]):find("<script>"), r and r[3])
end
fresh(); T.httpAnswer = "garbage"; r = fire("redeem", "AB12CD34"); ok("an unreadable answer gives a calm message", r and r[2] == false and tostring(r[3]):find("Could not reach"), r and r[3])
fresh(); T.httpFail = true; r = fire("redeem", "AB12CD34"); ok("network down gives a calm message and no crash", r and r[2] == false and tostring(r[3]):find("Could not reach"), r and r[3])

-- the status check tells the screen if they are subscribed
fresh(); T.subscribed = true; r = fire("status"); ok("status says subscribed", r and r[1] == "subscribed" and r[2] == true)
fresh(); T.subscribed = false; r = fire("status"); ok("status says not subscribed", r and r[1] == "subscribed" and r[2] == false)

-- renewal when a subscribed player joins
fresh(); T.subscribed = true; T.players.PlayerAdded:Fire(P)
ok("a subscribed player joining is renewed, no code needed", T.posts[1] and T.posts[1]:find("renew=true") and T.posts[1]:find("robloxId=777") and not T.posts[1]:find("code="), T.posts[1])
fresh(); T.subscribed = false; T.players.PlayerAdded:Fire(P)
ok("an unsubscribed player joining is NOT sent to Pholama", #T.posts == 0)
fresh(); T.httpFail = true; local okj = pcall(function() T.players.PlayerAdded:Fire(P) end)
ok("network down while joining does not crash the game", okj)

-- guessing: 5 tries a minute, and no mashing
fresh(); local now = 1000; T.clockNow = now
local results = {}
for i = 1, 8 do now = now + 2.5; T.clockNow = now; local x = fire("redeem", "AB12CD3" .. (i % 10)); results[i] = x and x[2] end
ok("after 5 tries in a minute the 6th is refused", results[5] == true and results[6] == false, table.concat({ tostring(results[5]), tostring(results[6]) }, ","))
ok("only 5 reached Pholama", #T.posts == 5, #T.posts)
now = now + 70; T.clockNow = now; local x = fire("redeem", "AB12CD30"); ok("a minute later they can try again", x and x[2] == true, x and x[3])
fresh(); now = now + 100; T.clockNow = now; fire("redeem", "AB12CD31"); local n1 = #T.posts; now = now + 0.5; T.clockNow = now; fire("redeem", "AB12CD32")
ok("pressing twice within 2 seconds only counts once", #T.posts == n1, #T.posts)

-- leaving clears the player's state
T.players.PlayerRemoving:Fire(P); ok("leaving does not crash", true)
print(bad == 0 and "ALL PASSED" or (bad .. " FAILED"))
