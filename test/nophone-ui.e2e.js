// Real Chrome: phone / in-browser model installation is gone from the PC app and the website.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-np-')); const port = 36000 + Math.floor(Math.random() * 1500), dbg = 9800 + Math.floor(Math.random() * 40);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama') }, stdio: 'ignore' });
  // the website = the docs/ folder served as a static site (no PC server behind it)
  const site = http.createServer((q, s) => { let f = q.url.split('?')[0]; if (f === '/') f = '/index.html'; try { const b = fs.readFileSync(path.join(__dirname, '..', 'docs', f)); s.setHeader('Content-Type', f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : 'text/javascript'); s.end(b); } catch { s.statusCode = 404; s.end(); } }).listen(0, '127.0.0.1');
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    for (const [label, url] of [['PC app', `http://127.0.0.1:${port}/`], ['website', `http://127.0.0.1:${site.address().port}/`]]) {
      errs.length = 0; await send('Page.navigate', { url }); await wait(4500);
      { const a = await ev("!!document.querySelector('#tBrowser')"), t = await ev('document.body.innerText'); if (process.env.DBG) console.log('DBG', JSON.stringify(a), JSON.stringify(String(t).slice(0,80))); ok(`[${label}] there is no "In this browser" tab`, a === false && typeof t === 'string' && !/In this browser/.test(t)); }
      await ev("localStorage.setItem('pholama.models','[\"cpu:x\",\"web:y\"]')");
      await ev("document.querySelector('#mdl, #models, #openModels, button[id*=odel]')?.click()"); await wait(700);
      const opts = await ev("[...document.querySelectorAll('#model option')].map(o=>o.value).join(',')");
      ok(`[${label}] the model list has no phone or browser model`, !/(^|,)(cpu|web):/.test(opts) && !/📱/.test(await ev("[...document.querySelectorAll('#model option')].map(o=>o.textContent).join(',')")), opts);
      ok(`[${label}] no page errors`, errs.length === 0, errs.join(' | '));
    }
  } finally { try { ws.close(); } catch {} ch.kill('SIGKILL'); srv.kill('SIGKILL'); site.close(); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
