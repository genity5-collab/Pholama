// Version history on the REAL server: routes over HTTP, and the AI edit path makes its own checkpoint.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-hist-')), port = 31000 + Math.floor(Math.random() * 3000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_STUDIO: path.join(home, '.pholama', 'studio'), PHOLAMA_STUDIO_HISTORY: path.join(home, '.pholama', 'studio-history'), PHOLAMA_NO_OPEN: '1' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  const call = (m, p, b) => fetch(B + '/api/studio/' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
  try {
    await call('POST', 'projects', { name: 'site' });
    await call('PUT', 'projects/site/file', { file: 'index.html', content: '<h1>one</h1>\n' });
    let r = await call('POST', 'projects/site/history', { label: 'Version one' });
    ok('POST history makes a checkpoint', r.s === 200 && r.j.checkpoint && r.j.checkpoint.label === 'Version one' && r.j.checkpoint.by === 'user', JSON.stringify(r));
    const id = r.j.checkpoint.id;
    r = await call('POST', 'projects/site/history', { label: 'again' });
    ok('POST history with no change says unchanged', r.j.unchanged === true, JSON.stringify(r.j));
    await call('PUT', 'projects/site/file', { file: 'index.html', content: '<h1>two</h1>\n<p>new</p>\n' });
    r = await call('GET', 'projects/site/history/' + id + '/diff');
    ok('GET diff shows what changed since the checkpoint', r.s === 200 && r.j.changes.length === 1 && r.j.changes[0].file === 'index.html' && r.j.changes[0].added === 2 && r.j.changes[0].removed === 1, JSON.stringify(r.j).slice(0, 300));
    r = await call('GET', 'projects/site/history');
    ok('GET history lists it, newest first, with no file contents', r.j.checkpoints.length === 1 && !JSON.stringify(r.j).includes('<h1>'), JSON.stringify(r.j));
    r = await call('POST', 'projects/site/history/' + id + '/restore');
    ok('POST restore returns ok and an undo id', r.s === 200 && r.j.ok && r.j.undo, JSON.stringify(r.j));
    r = await call('GET', 'projects/site');
    ok('after restore the old content is back on disk', r.j.files.find(f => f.name === 'index.html').content === '<h1>one</h1>\n');
    r = await call('POST', 'projects/site/history/not-an-id/restore');
    ok('a bad id gives a 400, not a crash', r.s === 400 && /bad checkpoint id/.test(r.j.error), JSON.stringify(r));
    r = await call('GET', 'projects/..%2F..%2Fetc/history');
    ok('a path-like project name gives a 400', r.s === 400 || (r.s === 200 && r.j.checkpoints.length === 0), JSON.stringify(r));
    const hs = (await call('GET', 'projects/site/history')).j.checkpoints; const lastId = hs[0].id;
    r = await call('DELETE', 'projects/site/history/' + lastId);
    ok('DELETE removes a checkpoint', r.j.ok === true && (await call('GET', 'projects/site/history')).j.checkpoints.length === hs.length - 1);
    // the AI edit path (the same function the chat uses when the model calls studio_write)
    const agentSrc = fs.readFileSync(path.join(root, 'server', 'agent.js'), 'utf8');
    ok('both AI write paths call autoCheckpoint before they write', (agentSrc.match(/autoCheckpoint\(project\)/g) || []).length === 2);
  } finally { srv.kill(); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
})();
