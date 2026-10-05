// Real Chrome: the "Max brain" picker in Settings > Usage. Choose a local AI and Max must run on it (free, no cloud call).
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  let cloudCalls = 0;
  const cloud = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { cloudCalls++; s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ reply: 'cloud answer', day_used: 1, day_cap: 10, month_used: 1, month_cap: 30 })); }); }).listen(0, '127.0.0.1');
  await wait(200);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mb-')); const port = 35000 + Math.floor(Math.random() * 2000), dbg = 9950 + Math.floor(Math.random() * 40);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_CLOUD_URL: 'http://127.0.0.1:' + cloud.address().port + '/f' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 220)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(4500);
    await ev(`(async()=>{localStorage.setItem('pholama.session', JSON.stringify({access_token:'tok_UI', refresh_token:'', expires_at: Math.floor(Date.now()/1000)+99999, token_type:'bearer', user:{id:'u1',email:'a@b.c',app_metadata:{provider:'discord'}}})); const m = await import('./account.js'); await m.Account.load(); localStorage.removeItem('pholama.maxBrain'); localStorage.removeItem('pholama.maxUsage');})()`);
    // the test PC has no model installed, so add one to the model list the way the app does
    await ev(`(()=>{const m=document.querySelector('#model'); for (const [v,t] of [['cloud:pholama','Agent Max'],['gguf:qwen2.5-1.5b','Qwen2.5 1.5B'],['gguf:tiny-chat','Tiny chat (no tools)'],['cpu:phone-one','Phone model']]) if(![...m.options].some(o=>o.value===v)) m.add(new Option(t,v)); m.value='cloud:pholama';})()`);
    await ev("document.querySelector('#opt').click()"); await wait(900); await ev("document.querySelector('#s_tab_usage').click()"); await wait(900);
    ok('the Max brain box is on the usage page (PC app)', await ev("document.querySelector('#brainBox').style.display !== 'none'"));
    const opts = await ev("[...document.querySelector('#brainSel').options].map(o=>o.value).join(',')");
    ok('the official cloud brain is first', opts.split(',')[0] === 'cloud', opts);
    ok('PC models are offered as local brains', /gguf:qwen2\.5-1\.5b/.test(opts) && /gguf:tiny-chat/.test(opts), opts);
    ok('a phone model is NOT offered', !/cpu:|web:/.test(opts), opts);
    ok('by default the cloud brain is chosen', (await ev("document.querySelector('#brainSel').value")) === 'cloud');
    await ev("(()=>{const s=document.querySelector('#brainSel'); s.value='gguf:qwen2.5-1.5b'; s.dispatchEvent(new Event('change'));})()"); await wait(500);
    ok('the choice is saved', (await ev("localStorage.getItem('pholama.maxBrain')")) === '{"mode":"local","model":"gguf:qwen2.5-1.5b"}', await ev("localStorage.getItem('pholama.maxBrain')"));
    ok('the note says it is free and unlimited', /Free and unlimited/.test(await ev("document.querySelector('#brainNote').textContent")), await ev("document.querySelector('#brainNote').textContent"));
    await ev("document.querySelector('#dlgSettings').close()"); await wait(300);
    ok('the chat-box pill now says Max is local and free, not a daily counter', /local, free/.test(await ev("document.querySelector('#crBox').textContent")), await ev("document.querySelector('#crBox').textContent"));
    ok('and the dropdown still shows Agent Max', (await ev("document.querySelector('#model').value")) === 'cloud:pholama');
    // a tool-less local model shows the Studio warning
    await ev("document.querySelector('#opt').click()"); await wait(700); await ev("document.querySelector('#s_tab_usage').click()"); await wait(500);
    await ev("(()=>{const s=document.querySelector('#brainSel'); s.value='gguf:tiny-chat'; s.dispatchEvent(new Event('change'));})()"); await wait(400);
    ok('a model without tools warns that Studio can only talk', /cannot use tools/.test(await ev("document.querySelector('#brainNote').textContent")), await ev("document.querySelector('#brainNote').textContent"));
    // back to cloud
    await ev("(()=>{const s=document.querySelector('#brainSel'); s.value='cloud'; s.dispatchEvent(new Event('change'));})()"); await wait(400);
    ok('switching back to the official brain is saved', (await ev("localStorage.getItem('pholama.maxBrain')")) === '{"mode":"cloud"}');
    // programming languages box (same Settings page)
    await ev("document.querySelector('#opt').click()"); await wait(700); await ev("document.querySelector('#s_tab_usage').click()"); await wait(1500);
    ok('the Programming languages box is shown on the PC app', await ev("document.querySelector('#langBox').style.display !== 'none'"));
    const lt = await ev("document.querySelector('#langList').textContent");
    ok('it lists what is installed with a tick, and says how to get the rest', /✓ (Python|JavaScript)/.test(lt) && /more you can install/.test(lt), lt);
    ok('a missing language shows an install link', /https?:\/\//.test(await ev("document.querySelector('#langList details').textContent")));
    await ev("document.querySelector('#langRefresh').click()"); await wait(1500);
    ok('Check again works and keeps the list', /✓/.test(await ev("document.querySelector('#langList').textContent")));
    await ev("document.querySelector('#dlgSettings').close()");
    ok('choosing a brain never called the cloud', cloudCalls === 0, cloudCalls);
    ok('no page errors', logs.length === 0, logs.join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill('SIGKILL'); srv.kill('SIGKILL'); cloud.close(); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
