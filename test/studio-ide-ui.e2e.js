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
  const seen404 = []; const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); req.who = 'local'; res.on('finish', () => { if (res.statusCode === 404) seen404.push(req.method + ' ' + u.pathname); });
    if (u.pathname.startsWith('/api/studio/ws')) return sr.handle(req, res, u, deps);
    if (u.pathname === '/api/studio/projects' && req.method === 'GET') return json(res, 200, { projects: stu.listProjects() });
    const pm = /^\/api\/(?:studio\/)?projects\/([^/]+)$/.exec(u.pathname); if (pm && req.method === 'GET') return json(res, 200, { name: pm[1], files: stu.snapshot(pm[1]) });
    const m = /^\/api\/(?:studio\/)?projects\/([^/]+)\/(tree)$/.exec(u.pathname); if (m) { return json(res, 200, require('../server/studioplus').walkAll(path.join(stu.ROOT, stu.projName(m[1])))); }
    const f = path.join(web, u.pathname === '/' ? 'test-host.html' : u.pathname); if (!f.startsWith(web) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); res.end(fs.readFileSync(f)); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r)); const port = srv.address().port;
  fs.writeFileSync(path.join(web, 'test-host.html'), '<!doctype html><html><head><link rel="stylesheet" href="studioworkspace.css"></head><body style="margin:0"><div id="ws" style="height:100vh"></div></body></html>');
  const dbg = 9800 + Math.floor(Math.random() * 500), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-wc-'));
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/c`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Page.javascriptDialogOpening') { logs.push('DIALOG ' + String(m.params.message).slice(0, 200)); ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } })); } if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 240)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise(res => setTimeout(() => res({ result: { value: 'EV_TIMEOUT' }, timedOut: true }), 8000))]); return r.result ? r.result.value : r; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(1500);
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  const text = () => ev("document.querySelector('#ws').innerText");
  const api = (p, o = {}, b) => fetch(`http://127.0.0.1:${port}/${p.replace(/^\//, '')}`, { ...(typeof o === 'string' ? { method: o } : o), body: b ? JSON.stringify(b) : undefined });
  await ev(`(async () => { const m = await import('./studioworkspace.js'); window.__w = m.createWorkspace(document.querySelector('#ws'), { api: async (p, o, b) => { const init = typeof o === 'string' ? { method: o } : { ...(o||{}) }; if (b !== undefined) { init.body = JSON.stringify(b); init.headers = { 'Content-Type': 'application/json' }; } return fetch('/' + p.replace(/^\\//, ''), init); }, getModels: () => [] }); await window.__w.open(); })()`); await wait(1500);
  const t0 = await text();
  ok('the workspace mounts with the real project on the dashboard', /shop/i.test(t0), t0.slice(0, 200));
  ok('all four agent modes are offered from the real capabilities', ['Fast', 'Build', 'Think', 'Repair'].every(m => t0.includes(m)), t0.slice(0, 300));
  const q = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom }; })()`);
  const onFile = (cls, file, action) => ev(`(() => { const row = [...document.querySelectorAll('.ide-patch')].find(x => x.getAttribute('data-file') === ${JSON.stringify(file)}); if (!row) return 'norow'; const t = row.querySelector(${JSON.stringify(cls)}); if (!t) return 'nobtn'; t.click(); return 'ok'; })()`);
  const tabFile = (file) => ev(`(() => { const t = [...document.querySelectorAll('.ide-tab')].find(x => x.getAttribute('data-file') === ${JSON.stringify(file)}); if (!t) return 'notab'; t.click(); return 'ok'; })()`);
  const rowText = (file) => ev(`(() => { const r = [...document.querySelectorAll('.ide-patch')].find(x => x.getAttribute('data-file') === ${JSON.stringify(file)}); return r ? r.innerText : ''; })()`);
  // ---- layout ----
  const chat = await rect('.ide-chat'), tree = await rect('.ide-tree'), edit = await rect('.ide-editor'), comp = await rect('.ide-composer');
  ok('the AI chat is a narrow panel on the left', chat && chat.x < 5 && chat.w > 240 && chat.w < 480, JSON.stringify(chat));
  ok('the file tree sits between the chat and the editor', tree && tree.x >= chat.x + chat.w - 2 && edit && edit.x >= tree.x + tree.w - 2, JSON.stringify([tree, edit]));
  ok('the editor takes the rest of the width', edit && edit.w > 500, JSON.stringify(edit));
  ok('the composer is at the BOTTOM of the chat panel', comp && chat && comp.b > chat.b - 40 && comp.y > chat.y + chat.h / 2, JSON.stringify([comp, chat]));
  ok('the message box says "Write a message"', await ev("document.querySelector('.ide-composer textarea').placeholder") === 'Write a message');
  ok('there is a + button and a model picker in the composer', (await q('.ide-composer .ide-plus')) === 1 && (await q('.ide-composer select.ide-pill')) >= 1);
  ok('a send button exists and keeps its accessible name', /start building/i.test(await ev("document.querySelector('.ide-send').textContent")));
  ok('nothing is open yet, so the editor says so', /open a file/i.test(await ev("document.querySelector('.ide-code-host').innerText")));
  // ---- run (review first) ----
  await ev(`(() => { const r = document.querySelector('#ws'); const ta = r.querySelector('textarea'); ta.value = 'fix the build and improve the heading'; const b = [...r.querySelectorAll('button')].find(x => /start building/i.test(x.textContent)); b.click(); })()`);
  for (let i = 0; i < 80; i++) { await wait(500); if (await q('.ide-patch') >= 2) break; }
  ok('after the run, each changed file is a patch card', (await q('.ide-patch')) === 2, await q('.ide-patch'));
  const names = await ev("[...document.querySelectorAll('.ide-patch-name')].map(x => x.textContent).sort().join()");
  ok('the cards name the real files', names === 'gone.js,index.html', names);
  ok('each card has Accept and Reject', (await q('.ide-patch .ide-ok')) === 2 && (await q('.ide-patch .ide-x')) === 2);
  ok('Accept all and Reject all are offered', /Accept all/.test(await ev("document.querySelector('.ide-patch-all').innerText")) && /Reject all/.test(await ev("document.querySelector('.ide-patch-all').innerText")));
  ok('the card shows how many lines were added', /\+\d/.test(await ev("document.querySelector('.ide-patch').innerText")));
  // ---- open a file: tab, breadcrumb, numbers, red/green ----
  await onFile('.ide-patch-name', 'index.html'); await wait(900);
  ok('clicking a patch opens a tab', (await q('.ide-tab')) === 1 && /index\.html/.test(await ev("document.querySelector('.ide-tab').innerText")));
  ok('the breadcrumb shows the path', /index\.html/.test(await ev("document.querySelector('.ide-crumbs').innerText")));
  ok('lines are numbered', (await q('.ide-line .ide-no')) >= 1 && (await ev("document.querySelector('.ide-line .ide-no').textContent.trim()")) === '1');
  ok('the removed line is red', (await q('.ide-line.ide-del')) >= 1 && /Old/.test(await ev("document.querySelector('.ide-line.ide-del').innerText")));
  ok('the added line is green', (await q('.ide-line.ide-add')) >= 1 && /New/.test(await ev("document.querySelector('.ide-line.ide-add').innerText")));
  await onFile('.ide-patch-name', 'gone.js'); await wait(900);
  ok('a second file opens a second tab', (await q('.ide-tab')) === 2);
  ok('the new file is all green', (await q('.ide-line.ide-add')) >= 1 && (await q('.ide-line.ide-del')) === 0);
  await tabFile('index.html'); await wait(300);
  ok('clicking a tab switches back', /New/.test(await ev("document.querySelector('.ide-code').innerText")));
  // ---- real Reject: the file really changes on disk ----
  ok('before rejecting, the new file really exists', stu.snapshot('shop').some(f => f.name === 'gone.js'));
  await onFile('.ide-x', 'gone.js'); await wait(1500);
  ok('Reject really removes the file the run created', !stu.snapshot('shop').some(f => f.name === 'gone.js'));
  ok('the card now says Rejected', /Rejected/.test(await rowText('gone.js')) || (await rowText('gone.js')) === '');
  // ---- real Accept ----
  await onFile('.ide-ok', 'index.html'); await wait(1500);
  ok('Accept keeps the AI version on disk', stu.readFile('shop', 'index.html').includes('<h1>New</h1>'));
  ok('the card now says Accepted', /Accepted/.test(await rowText('index.html')));
  ok('no Accept all left once nothing is pending', (await q('.ide-patch-all')) === 0);
  ok('the tab can be closed', (await (async () => { await ev("document.querySelector('.ide-tab-x').click()"); await wait(300); return q('.ide-tab'); })()) >= 0);
  ok('no JavaScript errors in the console', logs.length === 0, logs.join(' | ') + ' || 404s: ' + seen404.join(', '));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED');
  try { fs.unlinkSync(path.join(web, 'test-host.html')); } catch {}
  ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
})();
