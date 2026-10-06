// Real Chrome: the Studio Setup panel, and the update banner with notes before install and a live download bar.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sui-')), port = 34000 + Math.floor(Math.random() * 1500), dbg = 9950 + Math.floor(Math.random() * 40);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_NO_OPEN: '1', PHOLAMA_NO_AUTOUPDATE: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1200,850', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 200)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 850, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(3500);
    await ev("(document.querySelector('#vStudio')||[...document.querySelectorAll('#viewSw button')].find(b=>/studio/i.test(b.textContent))).click()"); await wait(2500);
    ok('the Setup button exists and its panel starts hidden', await ev("!!document.querySelector('#stSetup') && document.querySelector('#stSetupPanel').hidden === true"));
    await ev("document.querySelector('#stSetup').click()"); await wait(1200);
    const t = await ev("document.querySelector('#stSetupBody').textContent");
    ok('Setup shows the checklist: engine, Python and the 1 GB total', /Model engine/.test(t) && /Python/.test(t) && /of 1\.00 GB/.test(t) && /under 1 GB/.test(t), t);
    ok('it says no model is chosen for you', /Nothing is chosen for you/.test(t), t);
    ok('the size meter is drawn and small (the runtime is a fraction of 1 GB)', await ev("(()=>{const w=parseFloat(document.querySelector('.st-meter i').style.width);return w>0&&w<30})()"));
    ok('a missing engine offers an Install engine button', await ev("[...document.querySelectorAll('#stSetupBody button')].some(b=>b.textContent==='Install engine')"));
    ok('opening History closes Setup (one panel at a time)', await (async () => { await ev("document.querySelector('#stHistory').click()"); return ev("document.querySelector('#stSetupPanel').hidden===true && document.querySelector('#stHistoryPanel').hidden===false"); })());
    await ev("document.querySelector('#stHistory').click()");
    // the update banner, driven directly with the same module the page uses
    const out = await ev(`(async()=>{const m=await import('./updatefx.js');
      m.showBanner({version:'9.9.9',title:'A shiny new thing',notes:['New: first thing','Fixed: <img src=x onerror="window.__pwned=1"> second'],onInstall(){}});
      const b=document.getElementById('updBanner');const notes=[...b.querySelectorAll('.updb-notes li')].map(l=>l.textContent);
      const injected=!!b.querySelector('img');
      const a=m.updateBannerProgress({phase:'downloading',done:2097152,total:4194304,percent:50,speed:1048576});
      const w1=b.querySelector('.updb-bar i').style.width, label1=b.querySelector('.updb-prog').textContent, barShown=!b.querySelector('.updb-bar').hidden;
      m.updateBannerProgress({phase:'downloading',done:4194304,total:4194304,percent:100,speed:1048576});
      const w2=b.querySelector('.updb-bar i').style.width;
      m.updateBannerProgress({phase:'error',step:'no internet'});
      const errCls=b.querySelector('.updb-bar').classList.contains('err'), errTxt=b.querySelector('.updb-prog').textContent;
      m.updateBannerProgress({phase:'idle'}); const hidden=b.querySelector('.updb-bar').hidden;
      return {notes,injected,pwned:!!window.__pwned,w1,label1,barShown,w2,errCls,errTxt,hidden}})()`);
    ok('the banner lists what is new BEFORE installing', out.notes.length === 2 && out.notes[0] === 'New: first thing', JSON.stringify(out));
    ok('a release note can never inject HTML or run a script', !out.injected && !out.pwned && out.notes[1].includes('<img'), JSON.stringify(out));
    ok('the live bar shows the percentage and a readable label', out.barShown && out.w1 === '50%' && /Downloading 2\.0 MB of 4\.0 MB at 1\.0 MB\/s/.test(out.label1), JSON.stringify(out));
    ok('the bar moves forward to 100%', out.w2 === '100%', out.w2);
    ok('an error turns the bar red with a clear message', out.errCls && /no internet/.test(out.errTxt), JSON.stringify(out));
    ok('going idle hides the bar again', out.hidden === true);
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill(); srv.kill(); await wait(400); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
