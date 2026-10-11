// Agents + email logic (pure), plus a real check that every model an agent uses exists on Free.ai.
const { execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-')); const bundle = f => { const o = path.join(dir, f + '.mjs'); execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', f + '.ts'), '--format=esm', '--log-level=error', '--outfile=' + o], { cwd: path.join(__dirname, '..') }); return o; };
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const A = await import('file://' + bundle('agentsCore'));
  // --- configurations match what the user asked for
  ok('configuration one has the 9 agents asked for', A.CONFIGS.one.agents.length === 9 && ['chat', 'depth', 'ocr', 'stt', 'voice', 'vision', '3d', 'audio', 'translation'].every(r => A.findAgent('one', r)));
  ok('configuration two has the 8 agents asked for', A.CONFIGS.two.agents.length === 8 && ['chat', 'imageedit', 'document', 'stt', 'voice', 'avatar', 'vision', 'translation'].every(r => A.findAgent('two', r)));
  ok('config one chat is first and config two chat is Mistral 7B', A.CONFIGS.one.agents[0].role === 'chat' && A.findAgent('two', 'chat').model === 'mistral');
  ok('exact matches keep the model the user named', A.findAgent('one', 'stt').model === 'whisper' && A.findAgent('one', '3d').model === 'triposr' && A.findAgent('one', 'depth').model === 'marigold-depth' && A.findAgent('two', 'voice').model === 'kokoro');
  ok('only the agent Free.ai switched off is unavailable', A.available(A.findAgent('one', 'depth')) && !A.available(A.findAgent('two', 'avatar')));
  ok('every substituted agent explains the substitution', A.CONFIGS.one.agents.concat(A.CONFIGS.two.agents).filter(a => a.model && a.asked.toLowerCase().replace(/[^a-z0-9]/g,'') !== a.model.toLowerCase().replace(/[^a-z0-9]/g,'') && !['whisper', 'kokoro', 'triposr', 'mistral', 'marigold-depth'].includes(a.model)).every(a => /not hosted|licensing/.test(a.note || '')), A.CONFIGS.one.agents.concat(A.CONFIGS.two.agents).filter(a => a.model && !a.note).map(a=>a.role+':'+a.model).join());
  // --- the real catalog
  let catalog = null; try { catalog = (await (await fetch('https://api.free.ai/v1/models')).json()).models; } catch {}
  // Marigold runs behind /v1/image/depth-map/ (verified live) but is not in the public model list
  if (catalog) { const ids = new Set([...catalog.filter(m => m.self_hosted).map(m => m.id), 'marigold-depth']); const all = A.CONFIGS.one.agents.concat(A.CONFIGS.two.agents).filter(a => a.model); ok('every model used really exists on Free.ai (live check)', all.every(a => ids.has(a.model)), all.filter(a => !ids.has(a.model)).map(a => a.model).join()); }
  else console.log('SKIP live Free.ai catalog check (offline)');
  // --- picking agents
  let p = A.pickAgents('one', ['ocr', '3d', 'audio']); ok('a member can pick at most two agents, chat first', p.picked.length === 2 && p.picked[0] === 'chat' && p.picked[1] === 'ocr', JSON.stringify(p));
  p = A.pickAgents('two', ['avatar', 'vision']); ok('an unavailable agent can never be picked', !p.picked.includes('avatar') && p.picked.includes('vision'), JSON.stringify(p));
  p = A.pickAgents('nonsense', ['depth']); ok('an unknown configuration falls back to one', p.config === 'one' && p.picked.join() === 'chat,depth', JSON.stringify(p));
  p = A.pickAgents('one', ['imageedit']); ok('an agent from the other configuration is ignored', !p.picked.includes('imageedit'));
  // --- subagent routing and opt-out
  let c = A.chooseSubagents('please make a 3d mesh of a chair', 'one', { allow: ['3d'] }); ok('a 3D request chooses the 3D subagent when it is on', c.use.length === 1 && c.use[0].role === '3d');
  c = A.chooseSubagents('please make a 3d mesh of a chair', 'one', { subagents: false }); ok('"no subagents" always wins', c.use.length === 0 && c.disabled === true);
  c = A.chooseSubagents('translate this please', 'one', { allow: ['ocr'] }); ok('a subagent the member did not turn on is skipped with a reason', c.use.length === 0 && /turned this subagent off/.test(c.skipped[0].why), JSON.stringify(c.skipped));
  c = A.chooseSubagents('make a 3d mesh', 'two', {}); ok('a configuration without that agent says so', c.use.length === 0 && /no 3d agent/.test(c.skipped[0].why));
  c = A.chooseSubagents('make a talking avatar', 'two', {}); ok('an unavailable subagent explains why', c.use.length === 0 && /non-commercial/.test(c.skipped[0].why), JSON.stringify(c.skipped));
  c = A.chooseSubagents('translate this, make a 3d mesh, ocr this, describe this image, make some music, transcribe, read it aloud', 'one', { allow: ['3d','audio','ocr','vision','translation','stt','voice'] }); ok('no message ever runs more than the subagent limit', c.use.length <= A.SUBAGENT_LIMIT && c.skipped.some(s => /At most/.test(s.why)), JSON.stringify(c.use.map(x => x.role)));
  ok('subagent cost adds up', A.subagentCost(A.chooseSubagents('make a 3d mesh and translate it', 'one', { allow: ['3d','translation'] }).use) === 9);
  ok('plain chat costs no subagent credits', A.subagentCost(A.chooseSubagents('hello, how are you', 'one', {}).use) === 0);
  // --- names
  ok('a random name is stable for one member', A.randomName('user-1') === A.randomName('user-1') && A.randomName('user-1') !== A.randomName('user-2'));
  ok('the agent answers to the chosen name', A.agentName({ chosen: 'Luna' }, 'u') === 'Luna');
  ok('with no chosen name it uses the random one, never "Agent Max"', A.agentName({ chosen: null }, 'u') === A.randomName('u') && !/max/i.test(A.agentName({}, 'u')));
  for (const bad of ['', 'a', 'x'.repeat(25), '<b>hi</b>', 'Pholama Staff', 'Agent Max', 'admin']) { let t = ''; try { A.cleanName(bad); } catch (e) { t = e.message; } ok('name "' + bad.slice(0, 12) + '" is refused', !!t); }
  ok('normal names are accepted', A.cleanName("  Luna  the-2nd ") === 'Luna the-2nd' && A.cleanName('Zoë') === 'Zoë');
  ok('the system prompt uses the name and lists only real active agents', /You are Luna/.test(A.systemPrompt('Luna', 'one', ['chat', 'depth'])) && !/Translation/.test(A.systemPrompt('Luna', 'one', ['chat', 'depth'])));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); fs.rmSync(dir, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
})();
