// Real Chrome + the REAL workspace routes (studioroutes.js) + real project files. Only the AI is scripted.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')); process.env.PHOLAMA_STUDIO = base + '/s'; process.env.PHOLAMA_STUDIO_HISTORY = base + '/h'; process.env.PHOLAMA_STUDIO_RUNS = base + '/r';
  const sr = require('../server/studioroutes'), stu = require('../server/studio'), agent = require('../server/agent');
  stu.createProject('shop'); stu.writeFile('shop', 'index.html', '<!doctype html><html><body><h1>Old</h1><script src="gone.js"></script></body></html>\n');
  const tool = (n, a) => '<tool_call>' + JSON.stringify({ name: n, arguments: a }) + '</tool_call>';
  let script = ['["Add the script","New heading"]', tool('studio_write', { file: 'gone.js', content: 'var ready = 1;\n' }), tool('studio_patch', { file: 'index.html', find: '<h1>Old</h1>', replace: '<h1>New</h1>' }), 'Done.'];
  const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
  const deps = { json, body, models: [{ id: 'test-model', name: 'test-model', tools: true }], terminal: false, toolNames: [], parseTool: t => agent.parseTool(t, null), callModel: () => async () => script.length > 1 ? script.shift() : script[0], runTool: async (n, a) => stu.run(n, a) };
  const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
  const web = path.join(__dirname, '..', 'web');
  const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); req.who = 'local';
    if (u.pathname.startsWith('/api/studio/ws')) return sr.handle(req, res, u, deps);
    if (u.pathname === '/api/studio/projects' && req.method === 'GET') return json(res, 200, { projects: stu.listProjects() });
    const m = /^\/api\/studio\/projects\/([^/]+)\/(tree)$/.exec(u.pathname); if (m) { return json(res, 200, require('../server/studioplus').walkAll(path.join(stu.ROOT, stu.projName(m[1])))); }
    const f = path.join(web, u.pathname === '/' ? 'test-host.html' : u.pathname); if (!f.startsWith(web) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); res.end(fs.readFileSync(f)); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r)); const port = srv.address().port;
  fs.writeFileSync(path.join(web, 'test-host.html'), '<!doctype html><html><head><link rel="stylesheet" href="studioworkspace.css"></head><body><div id="ws"></div></body></html>');
  const dbg = 9800 + Math.floor(Math.random() * 500), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-wc-'));
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/c`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 240)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(1500);
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  const text = () => ev("document.querySelector('#ws').innerText");
  const api = (p, o = {}, b) => fetch(`http://127.0.0.1:${port}/${p.replace(/^\//, '')}`, { ...(typeof o === 'string' ? { method: o } : o), body: b ? JSON.stringify(b) : undefined });
  await ev(`(async () => { const m = await import('./studioworkspace.js'); window.__w = m.createWorkspace(document.querySelector('#ws'), { api: async (p, o, b) => { const init = typeof o === 'string' ? { method: o } : { ...(o||{}) }; if (b !== undefined) { init.body = JSON.stringify(b); init.headers = { 'Content-Type': 'application/json' }; } return fetch('/' + p.replace(/^\\//, ''), init); }, getModels: () => [] }); await window.__w.open(); })()`); await wait(1500);
  const t0 = await text();
  ok('the workspace mounts with the real project on the dashboard', /shop/i.test(t0), t0.slice(0, 200));
  ok('all four agent modes are offered from the real capabilities', ['Fast', 'Build', 'Think', 'Repair'].every(m => t0.includes(m)), t0.slice(0, 300));
  ok('the real model from the server is offered', /test-model/.test(await ev("document.querySelector('#ws').innerHTML")));
  // start a run through the UI
  await ev(`(() => { const r = document.querySelector('#ws'); const ta = r.querySelector('textarea'); ta.value = 'fix the build and improve the heading'; ta.dispatchEvent(new Event('input', { bubbles: true })); const b = [...r.querySelectorAll('button')].find(x => /start building/i.test(x.textContent)); b.click(); })()`);
  let t1 = ''; for (let i = 0; i < 40; i++) { await wait(500); t1 = await text(); if (/completed/i.test(t1) && /Verify/i.test(t1)) break; }
  ok('the seven stages show on the screen', ['Understand', 'Inspect', 'Plan', 'Execute', 'Verify', 'Repair', 'Report'].every(s => new RegExp(s, 'i').test(t1)), t1.slice(0, 400));
  ok('real tool steps appear in the timeline', /gone\.js/.test(t1) && /index\.html/.test(t1), t1.slice(0, 500));
  ok('the run ends completed (only because verification passed)', /completed/i.test(t1));
  ok('the real file on disk was changed by the run', fs.readFileSync(path.join(process.env.PHOLAMA_STUDIO, 'shop', 'index.html'), 'utf8').includes('<h1>New</h1>') && fs.existsSync(path.join(process.env.PHOLAMA_STUDIO, 'shop', 'gone.js')));
  const clicked = await ev(`(() => { const r = document.querySelector('#ws'); const e = [...r.querySelectorAll('li, div, button')].find(x => x.children.length < 6 && /Writing/.test(x.textContent) && /gone\\.js/.test(x.textContent)); if (!e) return false; e.click(); return true; })()`); await wait(400);
  ok('a timeline entry can be clicked open', clicked === true);
  ok('opening it shows its input and output', /var ready|Saved|Created|input/i.test(await text()), (await text()).slice(0, 200));
  ok('the changed files and the diff are listed', /gone\.js/.test(await text()) && /(\+|added|changed)/i.test(await text()));
  await ev(`(() => { const b = [...document.querySelectorAll('#ws button')].find(x => /^terminal$/i.test(x.textContent.trim())); if (b) b.click(); })()`); await wait(400);
  const term = await text(); ok('the Terminal tab says plainly that no execution environment is connected (nothing faked)', /No execution environment is connected/i.test(term), term.slice(-300));
  ok('no JavaScript errors in the console', logs.length === 0, logs.join(' | '));
  await ev('window.__w && window.__w.stop && window.__w.stop()');
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); try { fs.unlinkSync(path.join(web, 'test-host.html')); } catch {} ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
})();
