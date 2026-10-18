// The Lua model flattener: real Lua in, flat part list + simple script out. It must understand what AI models write, stay safe, and never throw.
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const { flatten, nearestBrick } = await import('../docs/luaflatten.js');
  const R = await import('../docs/retrostudio.js'); const enc = require('../site-only/retroencoder.js');
  const f = s => flatten(s);

  // --- what AI models really write
  const noob = `local model = Instance.new("Model", workspace)
model.Name = "Noob"
local function makePart(name, size, pos, color)
  local p = Instance.new("Part", model)
  p.Name = name  p.Size = size  p.Position = pos
  p.BrickColor = BrickColor.new(color)  p.Anchored = true
  return p
end
makePart("Torso", Vector3.new(2, 2, 1), Vector3.new(0, 3, 0), "Bright blue")
makePart("Head", Vector3.new(1.2, 1.2, 1.2), Vector3.new(0, 4.6, 0), "Bright yellow")
for i = 0, 1 do
  makePart("Arm" .. i, Vector3.new(1, 2, 1), Vector3.new(-1.5 + i * 3, 3, 0), "Bright yellow")
  makePart("Leg" .. i, Vector3.new(1, 2, 1), Vector3.new(-0.5 + i, 1, 0), "Bright green")
end
makePart("Shades", Vector3.new(1.3, 0.3, 0.2), Vector3.new(0, 4.7, -0.6), "Black")`;
  let r = f(noob);
  ok('a noob with a helper function, a loop and a Model builds 7 parts', r.ok && r.parts.length === 7 && r.models.length === 1, JSON.stringify([r.ok, r.parts.length, r.diagnostics]));
  ok('loop arithmetic is worked out (-1.5 + i * 3)', r.parts.find(p => p.name === 'Arm1').position[0] === 1.5 && r.parts.find(p => p.name === 'Arm0').position[0] === -1.5, JSON.stringify(r.parts.map(p => p.name + p.position)));
  ok('string joining works ("Arm" .. i)', r.parts.some(p => p.name === 'Arm0') && r.parts.some(p => p.name === 'Leg1'));
  ok('BrickColor names become real colours', r.parts.find(p => p.name === 'Torso').color.join() === '13,105,172', r.parts[0].color);
  ok('parts remember their model', r.parts.every(p => p.model === 'Noob'), JSON.stringify(r.parts.map(p => p.model)));
  const c = enc.compile(r.lua);
  ok('the flattened script encodes with nothing skipped', c.skipped.length === 0 && enc.check(c.encoded).valid, JSON.stringify(c.skipped));
  ok('the old simple reader built NOTHING from this same script (the reason for this module)', R.simulateLuau(noob).parts.length === 7 && R.simulateLuau(noob).flat, 'simulateLuau did not use the flattener');

  ok('Roblox Y is UP: the head is higher than the torso and the legs are lowest', (() => { const h = n => r.parts.find(p => p.name === n).position[2]; return h('Head') > h('Torso') && h('Torso') > h('Leg0'); })(), JSON.stringify(r.parts.map(p => [p.name, p.position[2]])));
  ok('the flat script keeps Roblox order for the encoder (Torso at 0, 3, 0)', /Torso\.Position = Vector3\.new\(0, 3, 0\)/.test(r.lua), r.lua.slice(0, 200));

  // --- language features
  ok('tables and ipairs', f('local c={"Red","Blue"} for i,n in ipairs(c) do local p=Instance.new("Part",workspace) p.Position=Vector3.new(i*5,0,0) p.BrickColor=BrickColor.new(n=="Red" and "Bright red" or "Bright blue") end').parts.length === 2);
  ok('pairs over a table with named fields', f('local t={a=1,b=2} local n=0 for k,v in pairs(t) do n=n+v end local p=Instance.new("Part",workspace) p.Size=Vector3.new(n,1,1)').parts[0].size[0] === 3);
  ok('if / elseif / else', f('local x=5 local p=Instance.new("Part",workspace) if x<3 then p.Size=Vector3.new(1,1,1) elseif x<9 then p.Size=Vector3.new(2,2,2) else p.Size=Vector3.new(3,3,3) end').parts[0].size[0] === 2);
  ok('while with break', f('local i=0 while true do i=i+1 if i>=4 then break end end local p=Instance.new("Part",workspace) p.Size=Vector3.new(i,1,1)').parts[0].size[0] === 4);
  ok('repeat until', f('local i=0 repeat i=i+2 until i>=6 local p=Instance.new("Part",workspace) p.Size=Vector3.new(i,1,1)').parts[0].size[0] === 6);
  ok('recursion (a stack of blocks)', f('local function stack(n) if n==0 then return end local p=Instance.new("Part",workspace) p.Position=Vector3.new(0,n*2,0) stack(n-1) end stack(5)').parts.length === 5);
  ok('math functions and pi', Math.abs(f('local p=Instance.new("Part",workspace) p.Position=Vector3.new(math.floor(math.pi*10)/10,0,0)').parts[0].position[0] - 3.1) < 1e-9);
  ok('Vector3 maths (a + b, v * 2)', f('local v=Vector3.new(1,2,3)+Vector3.new(1,1,1) local p=Instance.new("Part",workspace) p.Position=v*2').parts[0].position.join() === '4,8,6');   // viewport order is [x, depth, height]: Roblox Y (up) is the last value
  ok('compound assignment (+=)', f('local n=1 n+=4 local p=Instance.new("Part",workspace) p.Size=Vector3.new(n,1,1)').parts[0].size[0] === 5);
  ok('CFrame.new(x,y,z) positions a part', f('local p=Instance.new("Part",workspace) p.CFrame=CFrame.new(7,8,9)').parts[0].position.join() === '7,9,8');
  ok('Color3.fromRGB and Color3.new', f('local p=Instance.new("Part",workspace) p.Color=Color3.new(1,0,0)').parts[0].color.join() === '255,0,0');
  ok('Enum.Material and Shape are read', (() => { const p = f('local p=Instance.new("Part",workspace) p.Material=Enum.Material.Neon p.Shape=Enum.PartType.Ball').parts[0]; return p.material === 'Neon' && p.shape === 'Ball'; })());
  ok('Model:SetPrimaryPartCFrame / MoveTo moves the whole model', (() => { const r2 = f('local m=Instance.new("Model",workspace) local a=Instance.new("Part",m) a.Position=Vector3.new(0,0,0) local b=Instance.new("Part",m) b.Position=Vector3.new(2,0,0) m:MoveTo(Vector3.new(10,0,0))'); return r2.parts.map(p => p.position[0]).join() === '9,11'; })());
  ok('Clone copies a part', f('local a=Instance.new("Part",workspace) a.Size=Vector3.new(2,2,2) local b=a:Clone() b.Parent=workspace b.Position=Vector3.new(5,0,0)').parts.length === 2);
  ok('string.format and tostring', f('local p=Instance.new("Part",workspace) p.Name=string.format("Part%d",3)..tostring(4)').parts[0].name === 'Part34');
  ok('nested Models keep their parent chain', (() => { const o = f('local a=Instance.new("Model",workspace) a.Name="Car" local b=Instance.new("Model",a) b.Name="Wheel" local p=Instance.new("Part",b)'); return o.models.length === 2 && o.parts.length === 1 && o.lua.includes('Instance.new("Model", Car)'); })());
  ok('a part that is never parented is reported, not drawn', (() => { const o = f('local p=Instance.new("Part") p.Size=Vector3.new(1,1,1)'); return o.parts.length === 0 && o.diagnostics.some(d => /not parented/.test(d)); })());
  ok('events and game-only calls are ignored, not errors', f('local p=Instance.new("Part",workspace) p.Touched:Connect(function(h) print("x") end) game:GetService("Players") task.wait(1)').parts.length === 1);
  ok('comments and long comments are skipped', f('--[[ a long\ncomment ]] local p=Instance.new("Part",workspace) -- trailing').parts.length === 1);
  ok('RGB colours become the nearest BrickColor so the encoder keeps them', nearestBrick(250, 20, 20) === 'Really Red' && /BrickColor\.new\("Really Red"\)/.test(f('local p=Instance.new("Part",workspace) p.Color=Color3.fromRGB(250,20,20)').lua));

  // --- precise errors the AI can act on
  ok('a syntax error names the line', /^Line 2:/.test(f('local a = 1\nlocal b = = 2').diagnostics[0]), JSON.stringify(f('local a = 1\nlocal b = = 2').diagnostics));
  ok('reading a field of nil names the line', /Line 1: Cannot read/.test(f('local x = nothing.field').diagnostics[0]));
  ok('an unfinished string is reported', /Unfinished/.test(f('local s = "abc').diagnostics[0]));

  // --- safety: nothing can escape or hang
  const t0 = Date.now();
  ok('an endless while loop stops, fast', /too long/.test(f('while true do end').diagnostics[0]) && Date.now() - t0 < 3000);
  ok('an endless for loop stops', /too long/.test(f('for i=1,1e15 do end').diagnostics[0]));
  ok('runaway recursion stops', /too many times/.test(f('local function f() return f() end f()').diagnostics[0]));
  ok('a parts bomb is capped at 400', f('for i=1,100000 do local p=Instance.new("Part",workspace) end').parts.length <= 400);
  ok('a string bomb fails cleanly instead of crashing', /too long/.test(f('local s="x" for i=1,60 do s=s..s end').diagnostics[0]));
  ok('huge nesting is refused', /nested too deeply/.test(f('('.repeat(500) + '1' + ')'.repeat(500)).diagnostics[0]));
  ok('a giant script is refused', f('x=1\n'.repeat(40000)).diagnostics.length > 0);
  for (const [n, src] of [['loadstring', 'loadstring("x=1")()'], ['globalThis', 'globalThis.process.exit(1)'], ['constructor', '("a").constructor("return process")()'], ['__proto__', 'local t={} t.__proto__.x=1'], ['getfenv', 'getfenv(0).x=1'], ['require', 'require(game.ServerStorage.X)'], ['HttpService', 'game:GetService("HttpService"):GetAsync("http://x")'], ['os', 'os.execute("ls")'], ['io', 'io.open("/etc/passwd")']])
    ok(`${n} cannot escape or run anything`, (() => { let o; try { o = f(src); } catch (e) { return false; } return o.parts.length === 0 && typeof process !== 'undefined' && !o.crash; })());
  ok('flatten never throws, whatever it is given', [null, undefined, 42, {}, [], '\u0000\u0001', 'end end end', '}}}{{{', 'local'].every(x => { try { const o = flatten(x); return Array.isArray(o.diagnostics); } catch { return false; } }));
  ok('Object.prototype is not polluted by a script', ({}).polluted === undefined && !('x' in Object.prototype));

  // --- the preview and judge use it
  const L = await import('../docs/studioloop.js');
  ok('the noob passes the Studio check', L.judge(R.simulateLuau(noob), []).ok);
  ok('exact duplicate parts are still caught', !L.judge(R.simulateLuau('local a=Instance.new("Part",workspace)\na.Size=Vector3.new(2,2,2)\na.Position=Vector3.new(0,5,0)\nlocal b=Instance.new("Part",workspace)\nb.Size=Vector3.new(2,2,2)\nb.Position=Vector3.new(0,5,0)'), []).ok);
  ok('shades on a head (different sizes, close together) are NOT a problem', L.judge(R.simulateLuau(noob), []).ok);
  ok('the auto-repair leaves a real-Lua script untouched', (() => { const sim = R.simulateLuau(noob); const o = L.autoRepair(noob, sim, ['Skip: x']); return o.source === noob && o.changes.length === 0; })());
  ok('old one-line scripts still preview', R.simulateLuau('local p = Instance.new("Part", workspace)\np.Size = Vector3.new(2,2,2)\np.Position = Vector3.new(0,5,0)').parts.length === 1);
  ok('the AI is told it can write loops and functions, and to build more than one part', /Loops, local functions/.test(L.STUDIO_RULES) && /head, torso/.test(L.STUDIO_RULES) && !/Do NOT use: elseif, while, function/.test(L.STUDIO_RULES));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
