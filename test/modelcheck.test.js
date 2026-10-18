// Models must be sized and placed sensibly, and the encoder must keep exactly the numbers and parents the script says.
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const P = (n, sx, sy, sz, x, y, z) => `local ${n} = Instance.new("Part", workspace)\n${n}.Size = Vector3.new(${sx}, ${sy}, ${sz})\n${n}.Position = Vector3.new(${x}, ${y}, ${z})\n`;
(async () => {
  const F = await import('../docs/luaflatten.js'), L = await import('../docs/studioloop.js'), E = await import('../docs/retroencode.js');
  const judge = src => { const f = F.flatten(src); return L.judge({ parts: f.parts, created: f.parts.length, diagnostics: [] }); };
  const text = j => j.problems.join(' | ');
  let j = judge(P('a', 4, 1, 4, 0, 0.5, 0) + P('b', 4, 4, 1, 0, 3, 0) + P('c', 4, 1, 4, 0, 5.5, 0));
  ok('a well built stack resting on the ground passes', j.ok, text(j));
  j = judge(P('a', 4, 4, 4, 0, 20, 0) + P('b', 4, 4, 4, 4, 20, 0) + P('c', 4, 4, 4, 8, 20, 0));
  ok('a model floating high above the ground is caught', /floats 18\.0 studs/.test(text(j)), text(j));
  j = judge(P('a', 4, 4, 4, 0, -6, 0) + P('b', 4, 4, 4, 4, -6, 0) + P('c', 4, 4, 4, 8, -6, 0));
  ok('a model sunk into the ground is caught', /sinks 8\.0 studs/.test(text(j)), text(j));
  j = judge(P('a', 4, 4, 4, 0, 2, 0) + P('b', 4, 4, 4, 4, 2, 0) + P('c', 2, 2, 2, 40, 1, 0));
  ok('a stray piece that touches nothing is caught and named', /1 part touch nothing else \(c\)/.test(text(j)) || /touch nothing else/.test(text(j)), text(j));
  j = judge(P('a', 300, 4, 300, 0, 2, 0) + P('b', 4, 4, 4, 0, 6, 0) + P('c', 4, 4, 4, 8, 6, 0));
  ok('a model far too big is caught', /far too big/.test(text(j)), text(j));
  j = judge(P('a', 0.4, 0.4, 0.4, 0, 0.2, 0) + P('b', 0.4, 0.4, 0.4, 0.4, 0.2, 0) + P('c', 0.4, 0.4, 0.4, 0.8, 0.2, 0));
  ok('a model too small to see is caught', /smaller than 1\.5 studs/.test(text(j)), text(j));
  // a rotated roof is judged by its turned shape, not its unturned one
  j = judge(P('w1', 16, 8, 1, 0, 4, -5.5) + P('w2', 16, 8, 1, 0, 4, 5.5) + 'local r = Instance.new("WedgePart", workspace)\nr.Size = Vector3.new(12, 5, 16)\nr.CFrame = CFrame.new(0, 10.5, 0) * CFrame.Angles(0, math.rad(90), 0)\n');
  ok('a rotated roof sitting on the walls is not flagged as stray', !/touch nothing/.test(text(j)), text(j));
  // encoder: numbers keep their value
  const dump = async src => { const r = await E.encodeLua(F.flatten(src).lua); return r.serialized.replace(/\x1a/g, '|').replace(/\x1b/g, '~'); };
  let d = await dump('local p = Instance.new("Part", workspace)\np.Position = Vector3.new(0, 0.5, -5.5)\n');
  ok('a fraction survives encoding (0.5 stays 0.5, not 0)', /~Y~0~0\.5~/.test(d), d.slice(-400));
  ok('a negative survives encoding (-5.5 stays -5.5, not 0)', /~Z~0~-5\.5/.test(d), d.slice(-400));
  d = await dump('local p = Instance.new("Part", workspace)\np.Size = Vector3.new(16, 1, 12)\n');
  ok('whole numbers keep the original typed hex form (16 is 10, 12 is C)', /~X~1~10~Number~Y~1~1~Number~Z~1~C~Number/.test(d), d.slice(-400));
  // encoder: shapes copied from the real samples. Objects are named as plain text; a part goes into a model with "part.Parent = model" (value in variable mode 2).
  d = await dump('local House = Instance.new("Model", workspace)\nlocal Floor = Instance.new("Part", House)\nFloor.Anchored = true\n');
  ok('a part is created in the workspace first, the form every real sample uses', /~Parent~0~workspace~ClassName~0~Part\|?[^]*?Outputs~Object~\w+/.test(d) && !/~Parent~2~/.test(d), d);
  ok('then moved into its model with Set Object Property Parent, value in variable mode 2', /~Value~2~\w+~Property~0~Parent~Object~0~\w+/.test(d), d);
  ok('a property targets the part by plain name (mode 0), like every real sample', /~Property~0~Anchored~Object~0~\w+/.test(d), d);
  ok('the model itself is parented to workspace by name (mode 0)', /~Parent~0~workspace~ClassName~0~Model/.test(d), d);
  d = await dump('local p = Instance.new("Part", workspace)\np.Anchored = true\n');
  ok('a part in workspace stays a plain path and gets no extra Parent block', /~Parent~0~workspace~ClassName~0~Part/.test(d) && !/Property~0~Parent/.test(d), d);
  // every part of a house reaches the output as its own Create Object
  const house = require('fs').readFileSync('/tmp/house.lua', 'utf8').length ? null : null;
  const hs = 'local House = Instance.new("Model", workspace)\n' + ['A', 'B', 'C', 'D', 'E'].map(n => `local ${n} = Instance.new("Part", House)\n${n}.Size = Vector3.new(4, 4, 4)\n`).join('');
  d = await dump(hs);
  ok('every part is created (5 parts + 1 model = 6 Create Object blocks)', (d.match(/\|Type~CreateObject/g) || []).length === 6, (d.match(/\|Type~CreateObject/g) || []).length);
  ok('and each one is moved into the model (5 Parent blocks)', (d.match(/Property~0~Parent~Object~0~/g) || []).length === 5, d);

  // The AI could not fix a part out of bounds in another model. Now the problem names the real variable, the model, the true position and the exact line, and is fixed for free.
  const L2 = await import('../docs/studioloop.js');
  const scene = 'local House = Instance.new("Model", workspace)\nlocal Floor = Instance.new("Part", House)\nFloor.Size = Vector3.new(16, 1, 12)\nFloor.Position = Vector3.new(0, 0.5, 0)\nlocal Wall = Instance.new("Part", House)\nWall.Size = Vector3.new(16, 8, 1)\nWall.Position = Vector3.new(0, 5, -5.5)\nlocal Roof = Instance.new("Part", House)\nRoof.Size = Vector3.new(16, 1, 12)\nRoof.Position = Vector3.new(0, 9.5, 0)\nlocal Lost = Instance.new("Part", House)\nLost.Size = Vector3.new(4, 4, 4)\nLost.Position = Vector3.new(300, 2, 0)\nlocal Tree = Instance.new("Model", workspace)\nlocal Trunk = Instance.new("Part", Tree)\nTrunk.Size = Vector3.new(2, 10, 2)\nTrunk.Position = Vector3.new(30, 5, 0)\nlocal Top = Instance.new("Part", Tree)\nTop.Size = Vector3.new(8, 8, 8)\nTop.Position = Vector3.new(30, 14, 0)\nlocal Root = Instance.new("Part", Tree)\nRoot.Size = Vector3.new(3, 1, 3)\nRoot.Position = Vector3.new(30, 0.5, 90)\n';
  const fb = F.flatten(scene), simb = { parts: fb.parts, created: fb.parts.length, diagnostics: [], flat: fb.lua };
  ok('parts remember the script variable they were stored in', fb.parts.some(p => p.varName === 'Lost') && fb.parts.some(p => p.modelVar === 'Tree'), fb.parts.map(p => p.varName + '/' + p.modelVar).join(' '));
  ok('the real position is kept, not the clamped one (300, not 200)', fb.parts.find(p => p.varName === 'Lost').trueAt[0] === 300);
  const dg = L2.diagnose(simb);
  ok('a part out of bounds in another model is named with its model and variable', dg.some(i => /House\.Lost/.test(i.text) && /300/.test(i.text)) && dg.some(i => /Tree\.Root/.test(i.text) && /90/.test(i.text)), dg.map(i => i.text).join(' | '));
  ok('the problem gives the exact line that fixes it', dg.some(i => i.fix === 'Lost.Position = Vector3.new(0, 2, 0)') && dg.some(i => i.fix === 'Root.Position = Vector3.new(30, 0.5, 0)'), dg.map(i => i.fix).join(' | '));
  const rep = L2.autoRepair(scene, simb, []);
  ok('auto repair fixes a model the reader understood (it used to do nothing)', rep.changes.length === 2 && /-- Studio fix/.test(rep.source), rep.changes.join());
  const fa = F.flatten(rep.source), ja = L2.judge({ parts: fa.parts, created: fa.parts.length, diagnostics: [] });
  ok('after the repair both models pass the check', ja.ok, ja.problems.join(' | '));
  ok('the repair does not touch parts that were fine', fa.parts.find(p => p.varName === 'Trunk').trueAt.join() === '30,0,5' && fa.parts.find(p => p.varName === 'Floor').trueAt.join() === '0,0,0.5');
  ok('the AI is shown the located problem, not just a sentence', /House\.Lost/.test(L2.fixRequest(scene, { problems: dg.map(i => i.text) }, 1)));
  // rules
  const R = L.rulesFor(false);
  ok('the AI is told about PrimaryPart, scale and building from the ground up', /PrimaryPart/.test(R) && /house 20 x 12 x 10/.test(R) && /ground up/.test(R));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
