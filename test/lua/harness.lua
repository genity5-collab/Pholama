-- A tiny fake Roblox so the REAL PholamaPro server script can run outside Roblox.
local T = { posts = {}, fired = {}, subscribed = true, httpAnswer = '{"ok":true}', httpFail = false, clock = 0, conns = {} }
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
repl.Parent = nil
_G.game = { GetService = function(_, n) return svc[n] end }
_G.Instance = { new = function() local o = { Parent = nil } return setmetatable(o, { __newindex = function(t, k, v) rawset(t, k, v) if k == "Parent" then end end }) end }
Instance = { new = function() return remote end }
game = _G.game
warn = function() end
task = { spawn = function(f) f() end }
T.remote, T.players = remote, players
return T
