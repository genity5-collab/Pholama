// REAL browser, REAL website page, REAL router. Only the database and the AI are doubles. A person builds a page through the Studio screen.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
const tc = (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>';
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const backend = await require('./helpers/sitebackend')({ script: ['["Add a welcome heading"]', tc('studio_read', { file: 'index.html' }), tc('studio_patch', { file: 'index.html', find: '<h1>cafe</h1>', replace: '<h1>Welcome to the cafe</h1>' }), 'Done.'] });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-site-')), port = 36000 + Math.floor(Math.random() * 1500), dbg = 10400 + Math.floor(Math.random() * 400);
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.join(__dirname, '..', 'docs')], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = []; ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(2500);
  // sign in AFTER the page's own startup has run, then mount the Studio exactly the way app.js does
  await ev(`localStorage.setItem('pholama.session', JSON.stringify({ access_token: 'good-token', refresh_token: 'r', expires_at: ${Math.floor(Date.now() / 1000) + 3600}, user: { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'kim@example.com', app_metadata: { provider: 'github' }, user_metadata: { name: 'Kim' } } }))`);
  const mounted = await ev(`(async () => { window.PHOLAMA = Object.assign(window.PHOLAMA || {}, { STUDIO_URL: ${JSON.stringify(backend.url)} }); const host = document.createElement('div'); host.id = 'st_host'; document.body.append(host); const acct = await import('./account.js'); await acct.Account.load(); const m = await import('./cloudstudio.js'); window.__alerts = []; window.alert = t => window.__alerts.push(String(t)); window.__h = m.mountCloudStudio(host, { Account: acct.Account, cfg: () => window.PHOLAMA }); await window.__h.ready; return !!document.querySelector('#st_host .ws-prompt'); })()`);
  ok('the real Studio screen mounts on the website page', mounted === true, mounted);
  await wait(800);
  ok('it asked the cloud function for its capabilities with the login', backend.requests.some(r => /capabilities/.test(r) && !/no\/invalid/.test(r)), backend.requests.join(' | '));
  ok('the model picker shows the one cloud agent and the mode picker shows 4 modes', (await ev(`(() => { const s = [...document.querySelectorAll('#st_host .ws-select')]; return JSON.stringify({ models: [...s[1].options].map(o => o.textContent), modes: [...s[2].options].length }); })()`)) === '{"models":["Pholama cloud agent"],"modes":4}', await ev(`document.querySelector('#st_host').innerText.slice(0,200)`));
  // create the project and run, through the screen
  await ev(`(() => { const s = document.querySelector('#st_host .ws-select'); s.value = '__new__'; s.dispatchEvent(new Event('change')); })()`); await wait(200);
  await ev(`(() => { const i = document.querySelector('#st_host input[placeholder^="New project"]'); i.value = 'cafe'; i.dispatchEvent(new Event('input')); const p = document.querySelector('#st_host .ws-prompt'); p.value = 'Add a welcome heading'; p.dispatchEvent(new Event('input')); })()`);
  await ev(`document.querySelector('#st_host .ws-btn-primary').click()`);
  let status = 'working'; for (let i = 0; i < 25; i++) { await wait(1000); status = await ev(`(() => { const c = [...document.querySelectorAll('#st_host .ws-stage-chip')]; if (!c.length) return 'working'; if (c.some(x => x.classList.contains('failed'))) return 'failed'; const rep = c[c.length - 1]; return /report/i.test(rep.innerText) && rep.classList.contains('completed') ? 'done' : 'working'; })()`); if (status !== 'working') break; }
  ok('the run finishes on screen after real polling (no stream was opened)', status === 'done', status + ' alerts=' + (await ev('JSON.stringify(window.__alerts)')) + ' :: ' + (await ev(`document.querySelector('#st_host').innerText.slice(0, 500)`)));
  ok('the screen polled the run (GET runs/<id>) instead of opening a stream', backend.requests.filter(r => /GET .*\/runs\/r/.test(r)).length >= 2 && !backend.requests.some(r => /\/stream/.test(r)), backend.requests.join(' | '));
  ok('no EventSource was used on the website', !(await ev(`performance.getEntriesByType('resource').some(r => /\\/stream/.test(r.name))`)));
  const saved = await require('./helpers/sitecore')('siteStudioSupabase.ts').then(S => S.makeStore(S.makeRest('https://x.supabase.co', 'svc', backend.pg.fetch), 'aaaaaaaa-0000-0000-0000-000000000001').getFile('cafe', 'index.html'));
  ok('the file really changed in the member\'s own project', /Welcome to the cafe/.test(saved || ''), saved);
  const text = await ev(`document.querySelector('#st_host').innerText`);
  ok('the screen shows the steps the AI took (read, edit, build check)', /studio_read|Read|Reading/i.test(text) && /Edit|patch|Editing/i.test(text) && /build/i.test(text), text.slice(0, 600));
  ok('nothing technical, provider or key is on screen', !/free\.ai|totalum|supabase|openrouter|api[_-]?key|Bearer|good-token/i.test(text), text.slice(0, 300));
  ok('the browser raised no script errors', errs.length === 0, errs.join(' | '));
  ok('every request carried the login (none were rejected)', !backend.requests.some(r => /no\/invalid/.test(r)), backend.requests.filter(r => /no\/invalid/.test(r)).join());
  // logged-out: the screen shows a login message, not a crash
  const before = backend.requests.length; await ev(`localStorage.removeItem('pholama.session')`); await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(2500);
  const out = await ev(`(async () => { window.PHOLAMA = Object.assign(window.PHOLAMA || {}, { STUDIO_URL: ${JSON.stringify(backend.url)} }); const host = document.createElement('div'); host.id = 'st2'; document.body.append(host); const acct = await import('./account.js'); await acct.Account.load(); const m = await import('./cloudstudio.js'); const h = m.mountCloudStudio(host, { Account: acct.Account, cfg: () => window.PHOLAMA }); await h.ready; await new Promise(r => setTimeout(r, 800)); return host.innerText.slice(0, 300); })()`);
  ok('the report says the work was verified', /Verified/.test(text) || /Verified/.test(await ev(`document.querySelector('#st_host').innerText`)));
  ok('logged out: the screen asks the person to log in (and calls nothing)', /Log in to use Pholama Studio/.test(out) && !backend.requests.slice(before).length, out + ' :: ' + backend.requests.slice(before).join());
  ch.kill(); srv.kill(); await backend.close(); console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
