// Real Chrome on the WEBSITE copy (docs/): Settings > Plans shows Free vs Pro, the one-time code box counts down, and the page works on a phone.
// Drives real Chrome over the DevTools protocol: opens the real Pholama page, opens Settings > Tools and clicks every group.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-ui-')); const port = 31000 + Math.floor(Math.random() * 2000), dbg = 9300 + Math.floor(Math.random() * 500);
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', require('path').join(__dirname, '..', 'docs')], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 220));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('CONSOLE ' + m.params.args.map(a => a.value || a.description).join(' ').slice(0, 220)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(3500);
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  ok('the page loaded', await ev("!!document.querySelector('#settingsBtn')"));
  ok('Settings has a Plans tab, right after Account', (await ev("[...document.querySelectorAll('.s-tabs button')].map(b=>b.textContent).join()")).includes('Account,Plans'), await ev("[...document.querySelectorAll('.s-tabs button')].map(b=>b.textContent).join()"));
  await ev("document.querySelector('#settingsBtn').click()"); await wait(500);
  await ev("document.querySelector('#s_tab_plans').click()"); await wait(1500);
  ok('the Plans tab opens and the others hide', await ev("document.querySelector('#s_sec_plans').style.display !== 'none' && document.querySelector('#s_sec_usage').style.display === 'none' && document.querySelector('#s_sec_account').style.display === 'none'"));
  ok('the Plans tab button is highlighted', await ev("document.querySelector('#s_tab_plans').classList.contains('on') && !document.querySelector('#s_tab_usage').classList.contains('on')"));
  const txt = await ev("document.querySelector('#plans_host').innerText");
  ok('signed out it asks you to log in (and shows no code button)', /Log in/.test(txt) && !(await ev("!!document.querySelector('#pl_get')")), txt);
  // pretend to be signed in with a fake server behind the shared helper
  await ev(`(async () => { const m = await import('./plans.js'); window.__pl = m; const host = document.querySelector('#plans_host');
    const A = { user: () => ({}), rest: async p => p.includes('my_plan') ? { pro: false } : (window.__code || 'A1B2C3D4') };
    window.__tab = await m.mount(host, { Account: A, cfg: {} }); await window.__tab.paint(); })()`); await wait(400);
  const t2 = await ev("document.querySelector('#plans_host').innerText");
  ok('signed in it shows the Free plan and the comparison table', /Free plan/.test(t2) && /Agent Max messages a day/.test(t2) && /Projects you can share/.test(t2), t2);
  ok('the table has every row with Free and Pro values', (await ev("document.querySelectorAll('#plans_host .pl-tbl tbody tr').length")) === 8);
  ok('it tells you the Pro numbers (15 a day, 35 a month)', /\b15\b/.test(t2) && /\b35\b/.test(t2));
  await ev("document.querySelector('#pl_get').click()"); await wait(600);
  ok('tapping Get my code shows the code', (await ev("document.querySelector('#pl_codebox').textContent")) === 'A1B2C3D4');
  ok('the countdown is shown and the button is locked', /within 29:5|within 30:00/.test(await ev("document.querySelector('#pl_clock').textContent")) && (await ev("document.querySelector('#pl_get').disabled")) === true);
  ok('the code is big enough to read (24px+) and selectable in one tap', parseFloat(await ev("getComputedStyle(document.querySelector('#pl_codebox')).fontSize")) >= 24 && (await ev("getComputedStyle(document.querySelector('#pl_codebox')).userSelect")) === 'all');
  // phone width: no sideways scrolling
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true }); await wait(500);
  ok('on a phone the Plans page does not scroll sideways', await ev("(() => { const s = document.querySelector('#s_sec_plans'); const d = document.querySelector('#dlgSettings'); return s.scrollWidth <= s.clientWidth + 2 && d.scrollWidth <= d.clientWidth + 2; })()"));
  await send('Emulation.clearDeviceMetricsOverride');
  await ev("document.querySelector('#s_tab_account').click()"); await wait(400);
  ok('switching away hides Plans', await ev("document.querySelector('#s_sec_plans').style.display === 'none'"));
  ok('no errors in the console', logs.filter(l => !/favicon|Failed to load resource|net::ERR|manifest|serviceWorker|sw\.js/.test(l)).length === 0, logs.join(' | '));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); ws.close(); ch.kill('SIGKILL'); srv.kill('SIGKILL'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
