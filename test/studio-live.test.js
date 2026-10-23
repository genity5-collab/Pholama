// LIVE: the website Studio engine driven by the REAL Free.ai self-hosted model (no scripted AI). Skips quietly without FREE_AI_API_KEY.
// Run on purpose (it makes real, free, self-hosted calls):  node test/studio-live.test.js
const load = require('./helpers/sitecore'), memory = load.memory, live = require('./helpers/livefreeai')(process.env.LIVE_MODEL || 'qwen-coder');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
(async () => {
  if (!live) { console.log('SKIP no FREE_AI_API_KEY'); return; }
  const core = await load('siteStudioCore.ts'), E = await load('siteStudioEngine.ts'), R = await load('siteStudioRun.ts');
  const task = async (prompt, seed) => {
    const m = memory(core), cps = new Map(); await core.createProject(m.ctx, 'demo');
    for (const [f, t] of Object.entries(seed || {})) await core.writeFile(m.ctx, 'demo', f, t);
    const checkpoints = { async save(p, l, f) { const id = 'c' + (cps.size + 1) + 'abcdef'; cps.set(id, { label: l, files: f }); return id; }, async load(p, id) { return cps.get(id) || null; }, async list() { return []; } };
    let calls = 0; const callModel = async msgs => { calls++; return live(msgs); };
    const run = R.create({ project: 'demo', prompt, mode: 'build', model: 'qwen-coder' });
    const t0 = Date.now();
    const out = await E.execute(run, { c: m.ctx, checkpoints, runs: { async save() {} }, callModel, tools: E.makeTools({ c: m.ctx }) });
    return { out, m, calls, sec: Math.round((Date.now() - t0) / 1000) };
  };
  let r = await task('Create a small landing page: index.html with a heading "Pholama" and a button, and style.css that makes the button blue.');
  console.log('   run 1:', r.out.status, '|', r.calls, 'model calls |', r.sec + 's |', (r.out.error || '').slice(0, 120));
  const files1 = await r.m.ctx.store.allFiles('demo');
  ok('a new site is really created by the AI through tools', r.out.status === 'completed' && !!files1['index.html'], r.out.status + ' ' + r.out.error);
  ok('the files hold what was asked for', /pholama/i.test(files1['index.html'] || '') && /blue|#00f|#0000ff|rgb\(0,\s*0,\s*255/i.test(Object.values(files1).join('\n')), Object.keys(files1).join());
  ok('the report is built from evidence', r.out.report && r.out.report.changed >= 1);
  r = await task('Change the heading text from "Old" to "New".', { 'index.html': '<!doctype html><html><head><title>t</title></head><body><h1>Old</h1><p>keep me</p></body></html>' });
  console.log('   run 2:', r.out.status, '|', r.calls, 'model calls |', r.sec + 's |', (r.out.error || '').slice(0, 120));
  const f2 = (await r.m.ctx.store.allFiles('demo'))['index.html'] || '';
  ok('an existing file is edited, not thrown away', r.out.status === 'completed' && /<h1>New<\/h1>/.test(f2) && /keep me/.test(f2), r.out.status + ' ' + f2.slice(0, 200));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL crashed ->', e.stack || e); process.exit(1); });
