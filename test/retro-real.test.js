// What AI models write must come out as something the REAL RetroStudio can import, not only the in-app preview.
// Each case below was a real failure: an event that vanished, a rotation that was dropped, a colour call that deleted the whole model.
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const { flatten } = await import('../docs/luaflatten.js');
  const { encodeLua, checkEncoded } = await import('../docs/retroencode.js');
  const run = async src => { const f = flatten(src); const e = await encodeLua(f.lua); return { f, e, chk: e.encoded ? await checkEncoded(e.encoded) : { valid: false, blocks: 0 } }; };

  // 1) events survive
  let r = await run(`local part = Instance.new("Part", workspace)\npart.Size = Vector3.new(6,1,6)\npart.Position = Vector3.new(0,0.5,0)\npart.Touched:Connect(function(hit)\n  print("touched")\n  part.BrickColor = BrickColor.new("Bright red")\nend)`);
  ok('a Touched handler is kept in the flat script', /Part\.Touched:Connect\(function\(hit\)/.test(r.f.lua) && /print\("touched"\)/.test(r.f.lua), r.f.lua);
  ok('the Touched handler becomes a real PartTouched block', r.e.serialized && r.e.serialized.includes('PartTouched'), r.e.skipped);
  ok('nothing is skipped by the encoder', r.e.skipped.length === 0, r.e.skipped);
  ok('the encoded string is valid and decodes', r.chk.valid && r.chk.blocks === r.e.blocks, JSON.stringify(r.chk));
  r = await run(`local p = Instance.new("Part", workspace)\np.TouchEnded:Connect(function(o)\n  print("left")\nend)`);
  ok('TouchEnded is kept too', /TouchEnded:Connect/.test(r.f.lua), r.f.lua);
  r = await run(`local p = Instance.new("Part", workspace)\np.Touched:Connect(function(hit)\n  local x = game:GetService("Players")\n  print("ok")\nend)`);
  ok('a line blocks cannot do inside an event is reported, not guessed', r.f.diagnostics.some(d => /inside Touched/.test(d)) && /print\("ok"\)/.test(r.f.lua), JSON.stringify(r.f.diagnostics));

  // 2) rotation
  r = await run(`local p = Instance.new("Part", workspace)\np.Size = Vector3.new(4,1,4)\np.CFrame = CFrame.new(0,3,0) * CFrame.Angles(0, math.rad(45), 0)`);
  ok('CFrame.Angles becomes an Orientation line', /Orientation = Vector3\.new\(0, 45, 0\)/.test(r.f.lua), r.f.lua);
  ok('and the Orientation is encoded', r.e.serialized.includes('Orientation'), '');
  r = await run(`local p = Instance.new("Part", workspace)\np.Position = Vector3.new(1,2,3)`);
  ok('an unrotated part gets no Orientation line', !/Orientation/.test(r.f.lua), r.f.lua);

  // 3) every colour call the AI may pick ends as a BrickColor
  const cols = { 'Color3.fromRGB(255,0,0)': 1, 'Color3.new(1,0.5,0)': 1, 'Color3.fromHex("#aa3333")': 1, 'Color3.fromHSV(0.6,1,1)': 1, 'BrickColor.new(Color3.fromRGB(10,200,10))': 1, 'BrickColor.new(0.2,0.4,0.9)': 1, 'BrickColor.Random()': 1, 'BrickColor.new("Bright blue")': 1, 'BrickColor.Red()': 1 };
  for (const c of Object.keys(cols)) {
    const prop = /BrickColor/.test(c) ? 'BrickColor' : 'Color';
    const x = await run(`local p = Instance.new("Part", workspace)\np.Size = Vector3.new(1,1,1)\np.${prop} = ${c}`);
    ok('colour ' + c + ' gives a BrickColor line', x.f.parts.length === 1 && /BrickColor = BrickColor\.new\("[A-Za-z ]+"\)/.test(x.f.lua) && x.e.skipped.length === 0, x.f.lua + ' ' + JSON.stringify(x.f.diagnostics));
  }
  r = await run(`local p = Instance.new("Part", workspace)\np.Color = Color3.fromRGB(999, -5, 300)`);
  ok('out of range colour numbers are clamped, not fatal', r.f.parts.length === 1, JSON.stringify(r.f.diagnostics));

  // 4) one bad line must cost one line, not the model
  r = await run(`local a = Instance.new("Part", workspace)\na.Size = Vector3.new(2,2,2)\nlocal junk = Foo.bar(1)\nlocal b = Instance.new("Part", workspace)\nb.Position = Vector3.new(5,1,0)\nSomethingUnknown(3)`);
  ok('parts before AND after a bad line are kept', r.f.parts.length === 2, r.f.parts.length);
  ok('the bad line is named so the AI can fix it', r.f.diagnostics.some(d => /Line 3/.test(d)), JSON.stringify(r.f.diagnostics));
  r = await run(`local a = Instance.new("Part", workspace)\nwhile true do end`);
  ok('a loop that never ends still stops safely', r.f.diagnostics.some(d => /too long|ran too/.test(d)), JSON.stringify(r.f.diagnostics));

  // 5) positions: every part carries explicit numbers
  r = await run(`local m = Instance.new("Model", workspace)\nfor i = 1, 3 do\n  local p = Instance.new("Part", m)\n  p.Size = Vector3.new(2,1,2)\n  p.Position = Vector3.new(i*4, 0.5, 2)\nend`);
  ok('3 looped parts each get their own Position', (r.f.lua.match(/\.Position = Vector3\.new\(/g) || []).length === 3 && /Position = Vector3\.new\(8, 0\.5, 2\)/.test(r.f.lua), r.f.lua);
  r = await run(`local m = Instance.new("Model", workspace)\nlocal p = Instance.new("Part", m)\np.Size = Vector3.new(2,2,2)\nm:MoveTo(Vector3.new(10,0,10))`);
  ok('MoveTo moves the part and writes the real position', /Position = Vector3\.new\(10, /.test(r.f.lua), r.f.lua);

  // 6) the AI is told the rules that make all of the above work
  const { LUA_RULES, ENCODER_RULES } = await import('../docs/studioloop.js');
  ok('the AI is told to give every part an explicit Position', /EVERY part gets its own explicit numbers/.test(LUA_RULES), '');
  ok('the AI is told to prefer BrickColor', /prefer p\.BrickColor = BrickColor\.new/.test(LUA_RULES), '');
  ok('the AI is told to rotate with Orientation', /p\.Orientation = Vector3\.new/.test(LUA_RULES), '');
  ok('the AI is told which behaviour works as blocks and which does not', /Touched:Connect/.test(ENCODER_RULES) && /does NOT work as blocks/.test(ENCODER_RULES), '');


  // 7) behaviour that has to work in the REAL RetroStudio, not only the preview
  const { encodeBest } = await import('../docs/retroencode.js');
  const door = `local door = Instance.new("Part", workspace)\ndoor.Size = Vector3.new(4,7,1)\ndoor.Position = Vector3.new(0,3.5,0)\nlocal open = false\ndoor.Touched:Connect(function(hit)\n  if open == false then\n    door.Transparency = 0.7\n    door.CanCollide = false\n    open = true\n    print("door opened")\n  else\n    print("already open")\n  end\nend)`;
  r = await run(door);
  ok('a door with if/else keeps its whole handler', /if open == false then/.test(r.f.lua) && /open = true/.test(r.f.lua) && /else\n/.test(r.f.lua), r.f.lua);
  ok('the script variable is declared before the handler', r.f.lua.indexOf('local open = false') > 0 && r.f.lua.indexOf('local open = false') < r.f.lua.indexOf('Touched:Connect'), r.f.lua);
  ok('the door encodes with nothing skipped, with its If, touch and variable blocks', r.e.skipped.length === 0 && r.e.serialized.includes('PartTouched') && r.e.serialized.includes('SetVariable1') && /\bIf\b/.test(r.e.serialized), r.e.blocks + ' ' + JSON.stringify(r.e.skipped));
  r = await run(`local pad = Instance.new("Part", workspace)\npad.Touched:Connect(function(hit)\n  local h = hit.Parent:FindFirstChild("Humanoid")\n  if h then h.Health = 0 end\nend)`);
  ok('something blocks cannot do is reported to the AI, not silently dropped', r.f.diagnostics.some(d => /inside Touched/.test(d)), JSON.stringify(r.f.diagnostics));
  const fade = `local lamp = Instance.new("Part", workspace)\nlamp.Size = Vector3.new(2,2,2)\nlamp.Position = Vector3.new(0,1,0)\nlocal count = 0\nfor i = 1, 5 do\n  count = count + 1\n  lamp.Transparency = i / 10\n  wait(0.5)\nend\nprint(count)`;
  const fl = flatten(fade).lua, best = await encodeBest(fade, fl), flatOnly = await encodeLua(fl);
  ok('a loop with wait keeps its timing (the as-written script wins)', best.usedRaw === true && best.blocks > flatOnly.blocks, best.blocks + ' vs ' + flatOnly.blocks);
  ok('and nothing is skipped (i / 10 becomes a Division block)', best.skipped.length === 0 && best.serialized.includes('Division') && best.serialized.includes('WhileLoop3'), JSON.stringify(best.skipped));
  const build = `local cols = {Color3.fromRGB(255,0,0), Color3.fromRGB(0,255,0)}\nfor i = 1, 4 do\n  local b = Instance.new("Part", workspace)\n  b.Position = Vector3.new(i * 3, 1, 0)\n  b.Color = cols[(i % 2) + 1]\nend`;
  const bb = await encodeBest(build, flatten(build).lua);
  ok('a script that BUILDS stays flattened (tables and i*3 worked out)', !bb.usedRaw && bb.skipped.length === 0, JSON.stringify(bb.skipped));
  const cnt = await encodeLua(`local n = 0\nn = n + 1\nn = n - 2\nn = 7\nprint(n)`);
  ok('plain variable changes become blocks (n = n + 1, n = 7)', cnt.skipped.length === 0 && cnt.serialized.includes('Addition') && cnt.serialized.includes('Subtraction'), JSON.stringify(cnt.skipped));

  // 8) the three copies of the encoder must agree
  const siteOnly = require('../site-only/retroencoder.js');
  for (const [nm, src] of [['door', flatten(door).lua], ['fade', fade], ['build', flatten(build).lua]]) {
    const a = await encodeLua(src); const b = siteOnly.compile(src);
    ok('the browser and PC encoders agree on ' + nm, a.serialized === b.serialized && a.blocks === b.blocks, (a.blocks) + ' vs ' + (b.blocks));
  }
  const ts = require('fs').readFileSync(require('path').join(__dirname, '../functions/pholamaRetroEncode.ts'), 'utf8');
  ok('the server encoder has the same new rules', /kind = \{ '\+': 'Addition'/.test(ts) && /let calcN = 0/.test(ts) && /'Add to '/.test(ts) && /add\('SetVariable1', 'Set Variable'/.test(ts), '');


  // 9) the Studio model: Free.ai's self-hosted code model, never a paid one
  const cloudJs = require('fs').readFileSync(require('path').join(__dirname, '../docs/cloud.js'), 'utf8');
  const cloudTs = require('fs').readFileSync(require('path').join(__dirname, '../functions/pholamaCloud.ts'), 'utf8');
  const appJs = require('fs').readFileSync(require('path').join(__dirname, '../docs/app.js'), 'utf8');
  ok('the server allows the self-hosted code model', /'qwen-coder': \{ cost: 5/.test(cloudTs), '');
  ok('the server still refuses any answer that is not self-hosted', /source !== 'self_hosted'\) throw/.test(cloudTs), '');
  ok('the picker offers the code model', /id: 'qwen-coder'/.test(cloudJs), '');
  ok('Studio uses the code model unless another was picked on purpose', /export const studioModelId/.test(cloudJs) && /studioModelId\(\)\)\)\.reply/.test(appJs), '');
  ok('chat keeps its own default (the fast model)', /CLOUD_MODELS\.some\(m => m\.id === id\) \? id : CLOUD_MODELS\[0\]\.id/.test(cloudJs) && /CLOUD_MODELS = \[\s*\{ id: 'qwen7b'/.test(cloudJs), '');
  ok('the AI is taught round shapes: Ball and Cylinder, with the cylinder axis rule', /Enum\.PartType\.Ball/.test(LUA_RULES) && /Enum\.PartType\.Cylinder/.test(LUA_RULES) && /LONG ALONG ITS X AXIS/.test(LUA_RULES), '');
  ok('the AI is taught how to build a car with four cylinder wheels sitting on the ground', /CARS:/.test(LUA_RULES) && /FOUR wheels/.test(LUA_RULES) && /Wheel Y equals its radius/.test(LUA_RULES), '');
  ok('the AI is told to write one statement per line', /ONE STATEMENT PER LINE/.test(LUA_RULES), '');
  ok('the Studio rules still fit the 9000 character window the server keeps', LUA_RULES.length < 9000, String(LUA_RULES.length));
  ok('a retry guards the cloud model call', /AgentMax retry after/.test(cloudTs), '');
  ok('mistral is retired: not in the picker and not in the server table', !/mistral/i.test(cloudJs.slice(cloudJs.indexOf('CLOUD_MODELS = ['), cloudJs.indexOf('];', cloudJs.indexOf('CLOUD_MODELS = [')))) && !/mistral: \{ cost/.test(cloudTs), '');
  ok('an old client that still sends mistral is moved to the cheap chat model', /m === 'mistral' \? 'qwen7b'/.test(cloudTs), '');
  ok('both cloud models cost the same cheap rate', /qwen7b: \{ cost: 5/.test(cloudTs) && /'qwen-coder': \{ cost: 5/.test(cloudTs), '');
  ok('code is written at a low temperature', /\(model === 'qwen-coder' \|\| model === 'qwen3-coder'\) \? 0\.15/.test(cloudTs), '');
  ok('no paid or OpenRouter model id is anywhere in the cloud model list', !/openrouter|\/|:free/.test(cloudJs.slice(cloudJs.indexOf('CLOUD_MODELS = ['), cloudJs.indexOf('];', cloudJs.indexOf('CLOUD_MODELS = [')))), '');

  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
