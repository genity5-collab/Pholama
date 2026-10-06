// Setup routes on the real server, and the first-run rules (never forced on non-Windows, never repeated, can be switched off).
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sapi-')), port = 33000 + Math.floor(Math.random() * 2500);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_NO_OPEN: '1', PHOLAMA_NO_AUTOUPDATE: '1' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  const get = async p => { const r = await fetch(B + p); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    let r = await get('/api/setup');
    ok('GET /api/setup answers with the checklist', r.s === 200 && r.j.items && r.j.items.length === 4, JSON.stringify(r).slice(0, 200));
    ok('it reports the 1 GB budget and that the runtime is under it', r.j.budgetMb === 1024 && r.j.underBudget === true && r.j.totalMb < 1024, JSON.stringify([r.j.budgetMb, r.j.totalMb]));
    ok('it never picks or counts a model', !r.j.items.some(i => /model/i.test(i.id)) && /Nothing is chosen for you/.test(r.j.modelNote));
    ok('it includes readable text for the page', typeof r.j.text === 'string' && /Runtime total/.test(r.j.text));
    ok('it says whether this is Windows', typeof r.j.windows === 'boolean');
    const p = await fetch(B + '/api/setup/python', { method: 'POST' }); const pj = await p.json();
    if (process.platform === 'win32') ok('(Windows) the Python install starts', pj.ok === true, JSON.stringify(pj));
    else ok('on a non-Windows PC the Python install is refused with a clear message', p.status === 400 && /Windows/.test(pj.error), JSON.stringify(pj));
    r = await get('/api/setup/python/status'); ok('the Python status route answers', r.s === 200 && typeof r.j.status === 'string', JSON.stringify(r));
    await wait(9500);
    ok('first-run setup does NOT run here (not Windows), so no marker and no forced downloads', process.platform === 'win32' || !fs.existsSync(path.join(home, '.pholama', 'setup-done.json')));
    ok('nothing was downloaded into the home folder', !fs.existsSync(path.join(home, '.pholama', 'python')) && !fs.existsSync(path.join(home, '.pholama', 'bin', 'llama-server')));
    r = await get('/api/update');
    ok('/api/update carries progress and a whatsNew slot, and auto is OFF on a new install', r.j.progress && r.j.progress.phase === 'idle' && 'whatsNew' in r.j && r.j.auto === false, JSON.stringify(r.j).slice(0, 250));
  } finally { srv.kill(); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
})();
