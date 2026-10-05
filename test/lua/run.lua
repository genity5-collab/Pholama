local T = dofile("harness.lua")
local src = io.open("../../roblox/PholamaPro.server.lua"):read("*a"):gsub("^%-%-!strict\n", "")
src = src:gsub('"PASTE_YOUR_SECRET_HERE"', '"testsecret"')
local f = assert(load(src, "PholamaPro")); f()
local bad = 0
local function ok(name, cond, extra) print((cond and "PASS " or "FAIL ") .. name .. ((not cond and extra) and ("  -> " .. tostring(extra)) or "")); if not cond then bad = bad + 1 end end
local P = { UserId = 777 }
local function fire(action, code) T.fired = {}; T.remote.OnServerEvent.fns[1](P, action, code); return T.fired[#T.fired] end
ok("the script loaded and listens", #T.remote.OnServerEvent.fns == 1)
local r = fire("redeem", "ab12cd34")
ok("a good code from a subscribed player succeeds", r and r[1] == "result" and r[2] == true, r and tostring(r[3]))
ok("it told Pholama the code in CAPITALS, the Roblox id and the secret", T.posts[#T.posts]:find("code=AB12CD34") and T.posts[#T.posts]:find("robloxId=777") and T.posts[#T.posts]:find("secret=testsecret"), T.posts[#T.posts])
