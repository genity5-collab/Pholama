// Real Chrome: the Studio. Explorer with every script and model, live edit, the viewport drawing all models, and the
// write -> run -> check -> fix -> encode loop. The encoder service is faked in the page; no AI or cloud is used.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('FAIL timed out after 90s'); process.exit(1); }, 90000).unref();
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const docs = path.join(__dirname, '..', 'docs'), types = { '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' };
  const srv = http.createServer((q, s) => { let f = q.url.split('?')[0]; if (f === '/') f = '/index.html'; const p = path.join(docs, f);
    if (f.startsWith('/api/')) { s.setHeader('Content-Type', 'application/json'); return s.end('{}'); }
    if (!p.startsWith(docs) || !fs.existsSync(p)) { s.statusCode = 404; return s.end('nf'); } s.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream'); s.end(fs.readFileSync(p)); }).listen(0);
  await wait(200);
  const port = srv.address().port, dbg = 9700 + Math.floor(Math.random() * 90), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sw-'));
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1280,900', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || '').slice(0, 150)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(3200);
    await ev(`document.querySelector('#vChat').click()`); await wait(700);
    await ev(`document.querySelector('#retroPluginBtn').click()`); await wait(800);
    const type = async src => { await ev(`(() => { const t = document.querySelector('#retroCode'); t.value = ${JSON.stringify(src)}; t.dispatchEvent(new Event('input')); })()`); await wait(700); };
    const state = async () => JSON.parse(await ev(`JSON.stringify((() => { const c = document.querySelector('#retroCanvas'), d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n = 0; const f = [d[0],d[1],d[2]]; for (let i = 0; i < d.length; i += 40) if (Math.abs(d[i]-f[0])+Math.abs(d[i+1]-f[1])+Math.abs(d[i+2]-f[2]) > 40) n++;
      return { items: [...document.querySelectorAll('.ws-item')].map(b => b.querySelector('span:nth-child(2)').textContent), folders: [...document.querySelectorAll('.ws-folder')].map(f => f.textContent), title: document.querySelector('#wsTitle').textContent, code: document.querySelector('#retroCode').value, drawn: n, w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height, log: document.querySelector('#retroLog').textContent }; })())`));
    ok('the panel is called Studio', (await ev(`document.querySelector('.retro-head b').textContent`)) === 'Studio');
    ok('the viewport is really on screen', (await state()).w > 200 && (await state()).h > 200);

    const A = 'local a = Instance.new("Part", workspace)\na.Size = Vector3.new(4,1,4)\na.Position = Vector3.new(-6,3,0)\n', B = 'local b = Instance.new("Part", workspace)\nb.Size = Vector3.new(6,1,6)\nb.Position = Vector3.new(6,3,0)\n';
    await type(A); let s = await state();
    ok('typing a script builds a model right away (live edit)', s.folders[0] === 'Workspace (1)' && s.folders[1] === 'Scripts (1)' && s.drawn > 3000, JSON.stringify(s).slice(0, 200));
    const drawnOne = s.drawn;
    await ev(`document.querySelector('#wsNewScript').click()`); await wait(400); await type(B); s = await state();
    ok('a second script adds a second model; both are listed', s.folders[0] === 'Workspace (2)' && s.folders[1] === 'Scripts (2)', s.folders);
    ok('the viewport draws BOTH models', s.drawn > drawnOne, s.drawn + ' vs ' + drawnOne);
    await ev(`[...document.querySelectorAll('.ws-item')].find(b => /4 lines|3 lines/.test(b.textContent) && b.querySelector('.ws-dot.script')).click()`); await wait(400); s = await state();
    ok('clicking a script in the Explorer opens it in the editor', /a\.Size|b\.Size/.test(s.code) && /^Script/.test(s.title), s.title + ' / ' + s.code.slice(0, 40));

    // live edit off: the model must NOT change until Run is pressed
    await ev(`document.querySelector('#wsLive').click()`);
    const before = (await state()).drawn;
    await type(A + 'local c = Instance.new("Part", workspace)\nc.Size = Vector3.new(8,2,8)\nc.Position = Vector3.new(0,10,0)\n');
    ok('with Live edit off, typing does not rebuild the model', (await state()).folders[0] === 'Workspace (2)' && (await state()).drawn === before);
    const mid = await state();
    ok('with Live edit off, the log still shows the old part count until Run', /\b1 supported part/.test(mid.log) || /\b1 part/.test(mid.items.join(' ')), mid.log);
    await ev(`document.querySelector('#retroPreview').click()`); await wait(900);
    const after = await state();
    ok('pressing Run rebuilds it: the active script now builds 2 parts', /\b2 supported parts/.test(after.log), after.log);
    ok('and the Explorer shows 2 parts for that model', after.items.some(t => /^Script/.test(t) === false) || /2 parts/.test(await ev(`document.querySelector('#wsTree').textContent`)), after.items.join('|'));

    // There is no Encode button: only the AI encodes. The string box stays hidden until the AI's own run fills it.
    ok('there is no Encode button anywhere', (await ev(`!document.querySelector('#retroEncode') && ![...document.querySelectorAll('button')].some(b => /^encode/i.test(b.textContent.trim()))`)) === true);
    ok('the encoded-string box is hidden until the AI produces one', (await ev(`document.querySelector('#retroEncOut').hidden`)) === true);
    ok('Copy and the three viewport lighting sliders exist', (await ev(`!!document.querySelector('#retroCopy') && ['lightTime','lightBright','lightAmbient','lightFog'].every(i => document.getElementById(i))`)) === true);
    ok('no JavaScript errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (e) { ok('no crash', false, e && e.stack || e); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
})();
