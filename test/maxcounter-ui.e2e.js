// Real Chrome: Agent Max messages sent FROM STUDIO must move the day / month counters on the usage page, like chat does.
// A fake Max cloud returns real counts; the test reads the counters on the real screen before and after.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  let used = 2, mode = 'ok', calls = 0;
  const cloud = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { calls++; s.setHeader('Content-Type', 'application/json');
    if (mode === 'limit') { s.statusCode = 429; s.end(JSON.stringify({ error: 'daily', code: 'limit-day' })); return; }
    used++; s.end(JSON.stringify({ reply: 'Hello from Max', day_used: used, day_cap: 10, month_used: 20 + used, month_cap: 30 })); }); }).listen(0, '127.0.0.1');
  await wait(200); const cport = cloud.address().port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mc-')); const port = 33000 + Math.floor(Math.random() * 2000), dbg = 9800 + Math.floor(Math.random() * 150);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_STUDIO: path.join(home, 'studio'), PHOLAMA_CLOUD_URL: 'http://127.0.0.1:' + cport + '/f' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 220)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(4500);
    // Once the app has started, sign in with a fake user by filling the same store the app reads, then load it through the SAME account module the app uses.
    await ev(`(async()=>{localStorage.setItem('pholama.session', JSON.stringify({access_token:'tok_UI', refresh_token:'', expires_at: Math.floor(Date.now()/1000)+99999, token_type:'bearer', user:{id:'u1',email:'a@b.c',app_metadata:{provider:'discord'}}})); const m = await import('./account.js'); await m.Account.load(); localStorage.removeItem('pholama.maxUsage'); return m.Account.token();})()`);
    console.log('  signed in as token:', await ev("import('./account.js').then(m=>m.Account.token())"));
    ok('the page loaded', await ev("!!document.querySelector('#viewSw')"));
    const btn = await ev("[...document.querySelectorAll('#viewSw button')].map(b=>b.id+':'+b.textContent.trim()).join('|')"); console.log('  views:', btn);
    await ev("(document.querySelector('#vStudio')||[...document.querySelectorAll('#viewSw button')].find(b=>/studio/i.test(b.textContent))).click()"); await wait(2500);
    ok('Studio opened', await ev("document.body.classList.contains('studio-on') && !document.querySelector('#studio').hidden"), await ev("document.body.className"));
    // make a project if none, choose Agent Max
    if (!(await ev("!!document.querySelector('#stProj') && document.querySelector('#stProj').options.length"))) { await ev("window.prompt=()=>'mcproj'; document.querySelector('#stNew').click()"); await wait(1500); }
    await ev("(()=>{const m=document.querySelector('#model'); if(![...m.options].some(o=>o.value==='cloud:pholama')){const o=document.createElement('option');o.value='cloud:pholama';o.textContent='Agent Max';m.appendChild(o);} m.value='cloud:pholama'; m.dispatchEvent(new Event('change'));})()"); await wait(400);
    ok('Agent Max is the chosen model', (await ev("document.querySelector('#model').value")) === 'cloud:pholama');
    const before = await ev("localStorage.getItem('pholama.maxUsage')"); ok('no usage is stored before the first Studio message', before == null, before);
    const sendMsg = async t => { await ev(`(()=>{const a=document.querySelector('#stAsk');a.value=${JSON.stringify(t)};document.querySelector('#stSend').click();})()`); for (let i = 0; i < 40; i++) { await wait(500); if ((await ev("document.querySelector('#stSend').textContent")) === 'Send') break; } await wait(600); };
    await sendMsg('say hello');
    console.log('  cloud calls so far:', calls, '| studio log:', JSON.stringify(await ev("[...document.querySelectorAll('#stAiLog .st-msg')].map(m=>m.className.replace('st-msg ','')+': '+m.textContent.slice(0,150))")));
    let u = JSON.parse(await ev("localStorage.getItem('pholama.maxUsage')") || 'null');
    ok('after one Studio message the counter is saved with the cloud numbers', u && u.day_used === 3 && u.day_cap === 10 && u.month_used === 23 && u.month_cap === 30, JSON.stringify(u));
    await sendMsg('and again');
    u = JSON.parse(await ev("localStorage.getItem('pholama.maxUsage')") || 'null');
    ok('after a second message it went UP and equals what the cloud last counted', u && u.day_used > 3 && u.month_used > 23 && u.day_used === used && u.month_used === 20 + used, JSON.stringify(u) + ' cloud=' + used);
    // the real screen: open Settings > Usage and read the sentence the user sees
    await ev("document.querySelector('#opt').click()"); await wait(900); await ev("document.querySelector('#s_tab_usage').click()"); await wait(700);
    const txt = await ev("document.querySelector('#u_cloud_text').textContent"); ok('the usage page shows the new numbers', new RegExp('Today ' + used + ' of 10, this month ' + (20 + used) + ' of 30').test(txt), txt);
    ok('the day bar is drawn', (await ev("document.querySelector('#u_day_num').textContent")) === used + ' / 10', await ev("document.querySelector('#u_day_num').textContent"));
    // hit the limit: the day counter must show full
    await ev("document.querySelector('#dlgSettings').close && document.querySelector('#dlgSettings').close()"); await wait(300);
    mode = 'limit'; await sendMsg('once more');
    u = JSON.parse(await ev("localStorage.getItem('pholama.maxUsage')") || 'null');
    ok('when the cloud says the day is full, the day counter shows 10 of 10', u && u.day_used === 10 && u.day_cap === 10, JSON.stringify(u));
    ok('no page errors', logs.length === 0, logs.join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill('SIGKILL'); srv.kill('SIGKILL'); cloud.close(); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
