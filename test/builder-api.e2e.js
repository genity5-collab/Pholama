// Studio secrets/export/import and tool-server routes, over real HTTP against the real server.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-bapi-')), port = 36000 + Math.floor(Math.random() * 2500);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_STUDIO: path.join(home, 'studio'), PHOLAMA_STUDIO_SECRETS: path.join(home, 'sec'), PHOLAMA_WORKSPACE: path.join(home, 'ws'), PHOLAMA_MCP_ROOT: path.join(home, 'ws'), PHOLAMA_MCP_HOME: home, PHOLAMA_NO_AUTOUPDATE: '1', PHOLAMA_NO_SCHEDULE: '1', PHOLAMA_NO_AUTOSETUP: '1' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  const call = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    await call('POST', '/api/studio/projects', { name: 'shop' });
    await call('PUT', '/api/studio/projects/shop/file', { file: 'index.html', content: '<h1>{{TITLE}}</h1>' });
    let r = await call('PUT', '/api/studio/projects/shop/secrets', { key: 'TITLE', value: 'Hello Shop' });
    ok('a secret can be saved and only its name comes back', r.s === 200 && r.j.vars[0].key === 'TITLE' && !JSON.stringify(r.j).includes('Hello Shop'), JSON.stringify(r));
    r = await call('GET', '/api/studio/projects/shop/secrets'); ok('listing never shows the value', r.s === 200 && !JSON.stringify(r.j).includes('Hello Shop'));
    r = await call('PUT', '/api/studio/projects/shop/secrets', { key: 'bad key', value: 'x' }); ok('a bad name is refused with a message', r.s >= 400 && /CAPITAL/.test(JSON.stringify(r.j)), JSON.stringify(r));
    r = await call('POST', '/api/studio/projects/shop/preview-vars', { files: { 'index.html': '<h1>{{TITLE}}</h1>' } }); ok('the preview gets the value filled in', r.j.files && r.j.files['index.html'] === '<h1>Hello Shop</h1>', JSON.stringify(r.j));
    r = await call('GET', '/api/studio/projects/shop'); ok('the stored project file still has the placeholder, not the secret', JSON.stringify(r.j).includes('{{TITLE}}') && !JSON.stringify(r.j).includes('Hello Shop'));
    const ex = await call('GET', '/api/studio/projects/shop/export'); ok('export works and holds no secret', ex.s === 200 && ex.j.format === 'pholama-studio-project' && !JSON.stringify(ex.j).includes('Hello Shop'));
    r = await call('POST', '/api/studio/import', { bundle: ex.j, name: 'shop-copy' }); ok('import makes a copy', r.s === 200 && r.j.name === 'shop-copy' && r.j.files >= 1, JSON.stringify(r));
    r = await call('POST', '/api/studio/import', { bundle: { format: 'pholama-studio-project', version: 1, files: [{ name: '../x.js', content: '1' }] } }); ok('an unsafe import is refused', r.s >= 400, JSON.stringify(r));
    r = await call('GET', '/api/studio/projects'); ok('the refused import left nothing behind', !r.j.projects.some(p => /x|imported/.test(p.name) && p.name !== 'shop' && p.name !== 'shop-copy'), JSON.stringify(r.j.projects.map(p => p.name)));
    // ---- tool servers ----
    r = await call('GET', '/api/toolservers'); ok('tool servers list answers', r.s === 200 && Array.isArray(r.j.servers));
    r = await call('POST', '/api/toolservers', { name: 'files', command: 'python3', args: [path.join(root, 'tools', 'mcp', 'pholama_files.py')] });
    ok('adding a tool server WITHOUT confirm is refused (it runs a program)', r.s === 400 && /Confirm/.test(r.j.error), JSON.stringify(r));
    r = await call('POST', '/api/toolservers', { name: 'Bad Name', command: 'x', confirm: true }); ok('a bad name is refused', r.s === 400, JSON.stringify(r));
    r = await call('POST', '/api/toolservers', { name: 'files', command: 'python3', args: [path.join(root, 'tools', 'mcp', 'pholama_files.py')], confirm: true });
    ok('with confirm it is added and starts, and reports 6 tools', r.s === 200 && r.j.tools === 6, JSON.stringify(r));
    r = await call('GET', '/api/toolservers'); ok('it is listed as running', r.j.servers.some(s => s.id === 'files' && s.running), JSON.stringify(r.j));
    r = await call('DELETE', '/api/toolservers?name=files'); ok('it can be removed', r.s === 200 && !r.j.servers.some(s => s.id === 'files'));
    r = await call('POST', '/api/toolservers', { name: 'ghost', command: 'no-such-program-xyz', confirm: true }); ok('a program that is not installed is saved but reported, not a crash', r.s === 200 && /did not start/.test(r.j.warning || ''), JSON.stringify(r));
  } finally { srv.kill(); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
})();
