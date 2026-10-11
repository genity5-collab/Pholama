// The website Studio engine, run end to end with a SCRIPTED AI (only the AI is fake). Real tools, real files, real checks.
const load = require('./helpers/sitecore'), memory = load.memory;
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 350))); if (!c) bad++; };
const tc = (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>';
(async () => {
  const core = await load('siteStudioCore.ts'), E = await load('siteStudioEngine.ts'), R = await load('siteStudioRun.ts');
  const setup = async (reply, opts = {}) => {
    const m = memory(core), saved = new Map(), cps = new Map(); await core.createProject(m.ctx, 'shop');
    const checkpoints = { async save(p, label, files) { const id = 'c' + (cps.size + 1) + 'abcdef'; cps.set(id, { label, files }); return id; }, async load(p, id) { return cps.get(id) || null; }, async list() { return []; } };
    const seen = []; let i = 0; const callModel = async msgs => { seen.push(JSON.stringify(msgs)); const r = typeof reply === 'function' ? reply(i++, msgs) : reply[Math.min(i++, reply.length - 1)]; if (r instanceof Error) throw r; return r; };
    const run = R.create({ project: opts.project ?? 'shop', prompt: opts.prompt || 'make the heading say Hello', mode: opts.mode || 'build', model: 'm' });
    const tools = E.makeTools({ c: m.ctx });
    const out = await E.execute(run, { c: m.ctx, checkpoints, runs: { async save(r) { saved.set(r.id, JSON.stringify(r)); } }, callModel, tools, ...opts.deps });
    return { m, run: out, seen, saved, cps };
  };
  // --- a good run
  let r = await setup(['["Change the heading"]', tc('studio_read', { file: 'index.html' }), tc('studio_patch', { file: 'index.html', find: '<h1>shop</h1>', replace: '<h1>Hello</h1>' }), 'Done.']);
  ok('a good run completes', r.run.status === 'completed' && !r.run.error, r.run.status + ' ' + r.run.error);
  ok('the file really changed', (await r.m.ctx.store.getFile('shop', 'index.html')).includes('<h1>Hello</h1>'));
  ok('all seven stages are recorded', r.run.stages.map(s => s.id).join() === 'understand,inspect,plan,execute,verify,repair,report' && r.run.stages.find(s => s.id === 'execute').status === 'completed' && r.run.stages.find(s => s.id === 'repair').status === 'skipped');
  ok('the timeline has real steps for the real tool calls', r.run.steps.some(s => s.tool === 'studio_patch' && s.status === 'completed') && r.run.steps.some(s => s.tool === 'studio.build'));
  ok('the report is built from evidence: 1 file changed, build passed', r.run.report.changed === 1 && r.run.report.files[0].file === 'index.html' && r.run.report.verified.build === 'passed');
  ok('tests are honestly "not run" on the website, never faked', r.run.report.verified.tests === 'not run');
  ok('a checkpoint was saved BEFORE the change', r.run.checkpoint && r.cps.get(r.run.checkpoint).files['index.html'].includes('<h1>shop</h1>'));
  ok('the run was saved as it went', r.saved.size === 1);
  // --- revert / diff
  const cps = { async load(p, id) { return r.cps.get(id) || null; }, async save(p, label, files) { const id = 'x' + r.cps.size; r.cps.set(id, { label, files }); return id; } };
  const dd = await E.runDiff(r.m.ctx, cps, r.run); ok('the run diff shows the real change', dd.available && dd.changes[0].file === 'index.html' && dd.changes[0].added >= 1 && dd.changes[0].removed >= 1);
  await E.revertRun(r.m.ctx, cps, r.run); ok('reverting the run puts the project back', (await r.m.ctx.store.getFile('shop', 'index.html')).includes('<h1>shop</h1>'));
  // --- the model only touches THIS project, and secrets never reach it
  const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  r = await setup(['["x"]', tc('studio_write', { file: 'server.js', content: 'const k = "' + GH + '";\nconsole.log(k);\n' }), 'Done.'], { deps: {} });
  ok('(control) without a saved secret nothing is rewritten', (await r.m.ctx.store.getFile('shop', 'server.js')).includes(GH));
  { const m = memory(core); await core.createProject(m.ctx, 'shop'); await m.secrets.set('shop', 'GITHUB_TOKEN', GH, 'detected'); const seen = [], cps2 = new Map(); const run = R.create({ project: 'shop', prompt: 'wire it up', mode: 'build', model: 'm' }); let i = 0; const script = ['["Wire up"]', tc('studio_write', { file: 'server.js', content: 'const k = "' + GH + '";\n' }), 'Done.'];
    const out = await E.execute(run, { c: m.ctx, checkpoints: { async save(p, l, f) { cps2.set('c1abcdef', { label: l, files: f }); return 'c1abcdef'; }, async load(p, id) { return cps2.get(id); } }, runs: { async save() {} }, callModel: async msgs => { seen.push(JSON.stringify(msgs)); return script[Math.min(i++, script.length - 1)]; }, tools: E.makeTools({ c: m.ctx }) });
    ok('the model never receives a saved secret', seen.every(x => !x.includes(GH)), seen.find(x => x.includes(GH)) && 'LEAKED');
    ok('a file can never hold a saved secret', !(await m.ctx.store.getFile('shop', 'server.js')).includes(GH) && (await m.ctx.store.getFile('shop', 'server.js')).includes('{{secret:GITHUB_TOKEN}}'));
    ok('the stored run never holds it either', !JSON.stringify(out).includes(GH)); }
  // --- failure paths
  r = await setup(['["x"]', 'I looked and everything is fine.']); ok('a model that changes nothing is NOT reported as success', r.run.status === 'failed' && /without changing any file/.test(r.run.error) && r.run.report.changed === 0, r.run.status + ' / ' + r.run.error);
  r = await setup(['["x"]', tc('studio_write', { file: 'a.js', content: 'let x = ;' }), 'Done.', 'Done.', 'Done.']); ok('a change that leaves a broken script is caught by the real check and NOT called complete', r.run.status === 'failed' && r.run.report.verified.build === 'failed' && r.run.report.unresolved.length > 0, r.run.status);
  r = await setup(['["x"]', tc('studio_write', { file: 'a.js', content: 'let x = ;' }), 'Done.', tc('studio_write', { file: 'a.js', content: 'let x = 1;' }), 'Fixed.']); ok('repair: the engine feeds the REAL error back and the AI fixes it', r.run.status === 'completed' && r.run.repairs === 1 && r.run.stages.find(s => s.id === 'repair').status === 'completed' && (await r.m.ctx.store.getFile('shop', 'a.js')) === 'let x = 1;', r.run.status + ' repairs=' + r.run.repairs);
  r = await setup(['["x"]', tc('studio_write', { file: 'a.js', content: 'let x = ;' }), 'Done.', tc('studio_write', { file: 'b.js', content: 'let y = ;' }), tc('studio_write', { file: 'c.js', content: 'let z = ;' }), 'Done.', 'Done.', 'Done.', 'Done.', 'Done.']); ok('repair: a fix that makes things worse is rolled back', r.run.steps.some(s => s.tool === 'rollback'), r.run.steps.map(s => s.tool).join());
  r = await setup(['["x"]', tc('studio_read', { file: '../../secret.env' }), 'Done.']); ok('a path trick is refused by the real tool', r.run.steps.some(s => s.tool === 'studio_read' && s.status === 'failed'));
  r = await setup([new Error('503 upstream exploded at https://api.free.ai/secret-route')]); ok('a dead AI ends the run failed, with NO provider detail shown', r.run.status === 'failed' && !/free\.ai|503|exploded/i.test(JSON.stringify(r.run)), r.run.error);
  r = await setup(['["x"]'], { project: 'nope' }); ok('a missing project fails cleanly', r.run.status === 'failed' && /no project named/.test(r.run.error));
  r = await setup(['["x"]'], { project: '' }); ok('no project fails cleanly', r.run.status === 'failed');
  let polls = 0; r = await setup(['["a","b"]', tc('studio_read', { file: 'index.html' }), tc('studio_read', { file: 'index.html' }), 'Done.'], { deps: { cancelled: () => ++polls > 6 } }); ok('a cancelled run stops and says cancelled', r.run.status === 'cancelled', r.run.status);
  // --- slices: a run can pause at the time limit and be continued by a LATER call, finishing with the same result
  { const m = memory(core); await core.createProject(m.ctx, 'shop'); const cp = new Map(), saves = []; const checkpoints = { async save(p, l, f) { cp.set('c1abcdef', { label: l, files: f }); return 'c1abcdef'; }, async load(p, id) { return cp.get(id); } };
    const script = ['["Change it"]', tc('studio_read', { file: 'index.html' }), tc('studio_patch', { file: 'index.html', find: '<h1>shop</h1>', replace: '<h1>Sliced</h1>' }), 'Done.']; let i = 0;
    const deps = dl => ({ c: m.ctx, checkpoints, runs: { async save(r) { saves.push(JSON.stringify(r)); } }, callModel: async () => script[Math.min(i++, script.length - 1)], tools: E.makeTools({ c: m.ctx }), deadline: dl });
    const run = R.create({ project: 'shop', prompt: 'change the heading', mode: 'build', model: 'm' }); let slices = 0;
    while (!E.isDone(run) && slices < 60) { slices++; await E.advance(run, deps(slices % 2 ? Date.now() - 1 : Date.now() + 60000)); }
    ok('a run split into many short slices still finishes', E.isDone(run) && run.status === 'completed' && slices > 4, run.status + ' in ' + slices + ' slices');
    ok('...with the same result as one long run', (await m.ctx.store.getFile('shop', 'index.html')).includes('<h1>Sliced</h1>') && run.report.changed === 1 && run.steps.filter(s => s.tool === 'studio_patch').length === 1, run.steps.map(s => s.tool).join());
    ok('...and no step ran twice because of the pauses', run.steps.filter(s => s.tool === 'studio_read').length === 1 && run.steps.filter(s => s.tool === 'studio.build').length === 1);
    ok('...and the saved run holds its own progress (state lives on the run)', saves.some(x => JSON.parse(x).cursor && JSON.parse(x).cursor.phase === 'execute')); }
  { const m = memory(core); await core.createProject(m.ctx, 'shop'); const run = R.create({ project: 'shop', prompt: 'x', mode: 'build', model: 'm' }); const saved = [];
    const dd = dl => ({ c: m.ctx, checkpoints: { async save() { return 'c1abcdef'; }, async load() { return { label: '', files: {} }; } }, runs: { async save(r) { saved.push(JSON.stringify(r)); } }, callModel: async () => '["a"]', tools: E.makeTools({ c: m.ctx }), deadline: dl });
    await E.advance(run, dd(Date.now() + 60000)); const before = JSON.parse(saved[saved.length - 1]); const reloaded = JSON.parse(saved[saved.length - 1]); await E.advance(reloaded, dd(Date.now() + 60000));
    ok('a run reloaded from its saved JSON carries on (a NEW request can continue an old one)', before.cursor.phase === 'plan' && reloaded.cursor.phase === 'execute', before.cursor.phase + ' -> ' + reloaded.cursor.phase); }
  r = await setup(['not json at all', 'Done.']); ok('an unreadable plan falls back to the request itself, and says so', r.run.plan.length === 1 && /did not return a readable plan/.test(r.run.steps.find(s => s.tool === 'model.plan').output));
  r = await setup(['x'], { mode: 'fast', prompt: 'hello' }); ok('fast mode skips the planning model call', !r.run.steps.some(s => s.tool === 'model.plan'));
  let loops = 0; r = await setup(() => (loops++ ? tc('studio_read', { file: 'index.html' }) : '["x"]')); ok('a model that never stops is capped by the mode\'s step limit', r.run.steps.filter(s => s.tool === 'studio_read').length <= 24 + 2 && ['failed', 'completed'].includes(r.run.status));
  // --- parseTool forms
  const pt = E.parseTool; ok('parse: <tool_call> with arguments', pt(tc('studio_read', { file: 'a' }), ['studio_read']).args.file === 'a'); ok('parse: "args" spelling', pt('<tool_call>{"name":"studio_read","args":{"file":"a"}}</tool_call>').args.file === 'a');
  ok('parse: stopped before the closing tag', pt('<tool_call>{"name":"studio_read","arguments":{"file":"a"}}').args.file === 'a'); ok('parse: trailing comma forgiven', pt('<tool_call>{"name":"studio_read","arguments":{"file":"a",}}</tool_call>').args.file === 'a');
  ok('parse: <function=name> form', pt('<function=studio_read>{"file":"a"}</function>').name === 'studio_read'); ok('parse: a tool that is not allowed is ignored', pt(tc('rm_everything', {}), ['studio_read']) === null);
  ok('parse: plain words are not a tool call', pt('All done, I changed the heading.') === null);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
