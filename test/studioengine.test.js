// The Studio engine against REAL project files (in a temp folder), with a scripted model standing in for the AI.
const fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-'));
process.env.PHOLAMA_STUDIO = path.join(base, 'studio'); process.env.PHOLAMA_STUDIO_HISTORY = path.join(base, 'hist'); process.env.PHOLAMA_STUDIO_RUNS = path.join(base, 'runs');
const stu = require('../server/studio'), runs = require('../server/studiorun'), eng = require('../server/studioengine'), ws = require('../server/studioworkspace'), agent = require('../server/agent');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const tool = (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>';
const mkDeps = script => { let i = 0; return { callModel: async () => { const r = script[Math.min(i++, script.length - 1)]; return typeof r === 'function' ? r() : r; }, runTool: async (n, a) => stu.run(n, a), parseTool: (t, n) => agent.parseTool(t, null), toolNames: [] }; };
(async () => {
  // a real project with a real build error: index.html points at a script that does not exist
  stu.createProject('shop'); stu.writeFile('shop', 'index.html', '<!doctype html><html><body><h1>Shop</h1><script src="app.js"></script></body></html>\n');
  let r = runs.create({ project: 'shop', prompt: 'fix the build error and improve the dashboard', mode: 'build' });
  const out = await eng.execute(r.id, mkDeps([
    '["Create the missing script","Improve the heading"]',
    tool('studio_write', { file: 'app.js', content: 'console.log("ready");\n' }),
    tool('studio_patch', { file: 'index.html', find: '<h1>Shop</h1>', replace: '<h1>Shop dashboard</h1>' }),
    'All tasks are done.'
  ]));
  ok('a real run completes only after verification passes', out.status === 'completed', JSON.stringify({ s: out.status, e: out.error }));
  ok('the files really changed on disk', stu.readFile('shop', 'app.js').includes('ready') && stu.readFile('shop', 'index.html').includes('Shop dashboard'));
  ok('all seven stages are recorded in order', runs.STAGES.every(s => out.stages.find(x => x.id === s)) && out.stages.find(s => s.id === 'verify').status === 'completed');
  ok('the timeline comes from real tool calls with input, output and duration', out.steps.some(s => s.tool === 'studio_write' && s.status === 'completed' && s.output && typeof s.ms === 'number' && s.input.includes('app.js')));
  ok('inspection steps read the real project', out.steps.some(s => s.tool === 'studio_files' && /index\.html/.test(s.output)));
  ok('the plan is stored with dependencies', out.plan.length === 2 && out.plan[1].dependsOn[0] === 't1');
  ok('a checkpoint was saved before any edit', !!out.checkpoint);
  ok('the report lists the real changed files with line counts', out.report.changed === 2 && out.report.files.some(f => f.file === 'app.js' && f.status === 'added'), JSON.stringify(out.report));
  ok('the report says the build passed', out.report.verified.build === 'passed');
  const d = ws.runDiff(out); ok('the diff against the checkpoint is real', d.available && d.changes.some(c => c.file === 'index.html' && c.status === 'changed' && c.added > 0));
  // honesty: the model says it is done but nothing changed
  stu.createProject('empty1'); stu.writeFile('empty1', 'index.html', '<!doctype html><html><body>x</body></html>\n');
  r = runs.create({ project: 'empty1', prompt: 'make it better', mode: 'fast' });
  let o2 = await eng.execute(r.id, mkDeps(['Done! I improved everything.']));
  ok('a model that only talks is NOT marked complete', o2.status === 'failed' && /without changing any file/.test(o2.error), JSON.stringify({ s: o2.status, e: o2.error }));
  // repair: the model breaks the build, then fixes it from the real error
  stu.createProject('fixme'); stu.writeFile('fixme', 'index.html', '<!doctype html><html><body><script src="main.js"></script></body></html>\n');
  r = runs.create({ project: 'fixme', prompt: 'add a title', mode: 'build' });
  let o3 = await eng.execute(r.id, mkDeps(['["Add a title"]', tool('studio_patch', { file: 'index.html', find: '<body>', replace: '<body><h1>Hi</h1>' }), 'Finished.', tool('studio_write', { file: 'main.js', content: 'var x = 1;\n' }), 'Fixed.']));
  ok('a real build error triggers a repair that the next check confirms', o3.repairs === 1 && o3.status === 'completed' && o3.stages.find(s => s.id === 'repair').status === 'completed', JSON.stringify({ r: o3.repairs, s: o3.status, e: o3.error }));
  // limits: a repair that cannot fix is capped and the run is failed, not claimed done
  stu.createProject('stuck'); stu.writeFile('stuck', 'index.html', '<!doctype html><html><body><script src="gone.js"></script></body></html>\n');
  r = runs.create({ project: 'stuck', prompt: 'tweak', mode: 'fast' });
  let o4 = await eng.execute(r.id, mkDeps(['["Tweak"]', tool('studio_patch', { file: 'index.html', find: '<body>', replace: '<body><p>a</p>' }), 'Done.']));
  ok('an unfixable error is reported as failed with the real problem listed', o4.status === 'failed' && o4.report.unresolved.some(x => /gone\.js/.test(x)), JSON.stringify(o4.report && o4.report.unresolved));
  ok('repair attempts never exceed the mode limit', o4.repairs <= runs.MODES.fast.maxRepairs);
  // the model can only touch the chosen project
  stu.createProject('other'); stu.writeFile('other', 'index.html', '<!doctype html><html><body>keep</body></html>\n');
  r = runs.create({ project: 'shop', prompt: 'hack', mode: 'fast' });
  await eng.execute(r.id, mkDeps(['["x"]', tool('studio_write', { project: 'other', file: 'index.html', content: 'HACKED' }), 'Done.']));
  ok("an edit aimed at another project is redirected to the run's own project", stu.readFile('other', 'index.html').includes('keep'));
  // unclear target
  r = runs.create({ project: '', prompt: 'start editing my older projects', mode: 'build' });
  let o5 = await eng.execute(r.id, mkDeps(['x']));
  ok('an unclear target asks which project instead of guessing', o5.status === 'waiting' && /Which project/.test(o5.error));
  // cancel
  r = runs.create({ project: 'shop', prompt: 'long', mode: 'build' });
  let p = eng.execute(r.id, { ...mkDeps(['["a"]']), callModel: async () => { eng.cancel(r.id); return '["a"]'; } }); let o6 = await p;
  ok('cancel stops a run and marks it cancelled', o6.status === 'cancelled');
  // secrets
  ok('secrets in prompts and output are hidden', runs.scrub('key ghp_abcdefghijklmnopqrstuvwxyz0123456789 and tlm_sk_abc123') === 'key [hidden] and [hidden]');
  // restart recovery
  const stale = runs.create({ project: 'shop', prompt: 'x', mode: 'fast' }); stale.status = 'running'; runs.save(stale);
  ok('a run left "running" by a crash is recovered as failed', runs.recover() >= 1 && runs.load(stale.id).status === 'failed');
  // revert
  const o7 = runs.load(out.id); ws.revertFile(o7, 'app.js'); ok('rejecting a new file removes it', !fs.existsSync(path.join(process.env.PHOLAMA_STUDIO, 'shop', 'app.js')));
  ws.revertRun(o7); ok('reverting a whole run restores the original page', stu.readFile('shop', 'index.html').includes('<h1>Shop</h1>'));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); fs.rmSync(base, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
})();
