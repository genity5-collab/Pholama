// Real Chrome: the Studio History panel (list, colour diff, restore) and the companion being visible on a dark page.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-hui-')), port = 36000 + Math.floor(Math.random() * 1500), dbg = 9900 + Math.floor(Math.random() * 40);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_STUDIO: path.join(home, '.pholama', 'studio'), PHOLAMA_STUDIO_HISTORY: path.join(home, '.pholama', 'studio-history'), PHOLAMA_NO_OPEN: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  const api = (m, p, b) => fetch(`http://127.0.0.1:${port}/api/studio/${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
  await api('POST', 'projects', { name: 'site' }); await api('PUT', 'projects/site/file', { file: 'index.html', content: '<h1>OLD</h1>\n<img src=x onerror="window.__pwned=1">\n' });
  const cp = (await api('POST', 'projects/site/history', { label: 'Version one' })).checkpoint;
  await api('PUT', 'projects/site/file', { file: 'index.html', content: '<h1>NEW</h1>\n' });
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1200,850', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, '--force-dark-mode', '--enable-features=WebContentsForceDark', 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 200)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 850, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(3500);
    await ev("localStorage.setItem('pholama_studio_companion','on'); localStorage.setItem('pholama_studio_proj','site')");
    await ev("(document.querySelector('#vStudio')||[...document.querySelectorAll('#viewSw button')].find(b=>/studio/i.test(b.textContent))).click()"); await wait(2500);
    ok('Studio opened', await ev("document.body.classList.contains('studio-on')"));
    ok('the History button exists', await ev("!!document.querySelector('#stHistory')"));
    ok('the panel starts hidden', await ev("document.querySelector('#stHistoryPanel').hidden === true"));
    await ev("document.querySelector('#stHistory').click()"); await wait(800);
    ok('clicking History opens the panel', await ev("document.querySelector('#stHistoryPanel').hidden === false"));
    ok('it lists the saved version by its name', await ev("document.querySelector('#stHistoryList').textContent.includes('Version one')"), await ev("document.querySelector('#stHistoryList').textContent"));
    await ev("[...document.querySelectorAll('#stHistoryList button')].find(b=>b.textContent==='See changes').click()"); await wait(800);
    const diff = await ev("(()=>{const d=document.querySelector('#stHistoryList .st-diff');return {shown:d&&!d.hidden,add:d.querySelectorAll('.st-diffline.add').length,del:d.querySelectorAll('.st-diffline.del').length,text:d.textContent}})()");
    ok('See changes shows the changed lines in colour', diff.shown && diff.add >= 1 && diff.del >= 1 && /NEW/.test(diff.text) && /OLD/.test(diff.text), JSON.stringify(diff).slice(0, 250));
    ok('file text is shown as text, never run as HTML (no injected image, no script ran)', await ev("!document.querySelector('#stHistoryList img') && !window.__pwned"));
    ok('the added line is green and the removed line is red (different colours)', await ev("(()=>{const a=getComputedStyle(document.querySelector('.st-diffline.add')).backgroundColor,d=getComputedStyle(document.querySelector('.st-diffline.del')).backgroundColor;return a!==d&&a!=='rgba(0, 0, 0, 0)'&&d!=='rgba(0, 0, 0, 0)'})()"));
    // restore (the page asks twice with confirm(); accept both)
    await ev("window.confirm=()=>true"); await ev("[...document.querySelectorAll('#stHistoryList button')].find(b=>b.textContent==='Restore').click()"); await wait(1500);
    const disk = (await api('GET', 'projects/site')).files.find(f => f.name === 'index.html').content;
    ok('Restore put the old file back on disk', /OLD/.test(disk) && !/NEW/.test(disk), disk);
    ok('and the editor shows the restored text', await ev("document.querySelector('#stCode').value.includes('OLD')"), await ev("document.querySelector('#stCode').value"));
    ok('the list now also has the automatic "before a restore" version', await ev("document.querySelector('#stHistoryList').textContent.includes('before a restore')"), await ev("document.querySelector('#stHistoryList').textContent"));
    ok('Save version works from the panel', await (async () => { await ev("window.prompt=()=>'From the button'"); await api('PUT', 'projects/site/file', { file: 'index.html', content: '<h1>CHANGED</h1>\n' }); await ev("document.querySelector('#stHistorySave').click()"); await wait(1200); return ev("document.querySelector('#stHistoryList').textContent.includes('From the button')"); })());
    await ev("document.querySelector('#stSettings').click()"); await wait(300);
    ok('opening Settings closes History (only one panel at a time)', await ev("document.querySelector('#stHistoryPanel').hidden === true && document.querySelector('#stSettingsPanel').hidden === false"));
    // the companion on a DARK page
    await ev("document.querySelector('#stSettings').click()"); await ev("(()=>{const c=document.querySelector('#stCompanion');if(!c.checked){c.checked=true;c.dispatchEvent(new Event('change'))}})()"); await wait(800);
    const comp = await ev("(()=>{const b=document.querySelector('.st-companion'),i=b&&b.querySelector('img');if(!b)return null;const cs=getComputedStyle(i),bs=getComputedStyle(b);return {dark:matchMedia('(prefers-color-scheme: dark)').matches,ring:cs.boxShadow,bg:bs.backgroundColor,page:getComputedStyle(document.body).backgroundColor}})()");
    ok('(setup) the page is in dark mode and the companion exists', comp && comp.dark, JSON.stringify(comp));
    ok('the companion icon has a light ring so the black square is visible on a dark page', comp && /\d/.test(comp.ring) && comp.ring !== 'none', JSON.stringify(comp));
    ok('the companion backing is lighter than the page', (() => { const lum = s => { const v = (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number); return (/^color\(/.test(s) ? v : v.map(x => x / 255)).reduce((a, b) => a + b, 0) / 3; }; return comp && lum(comp.bg) > lum(comp.page) + 0.05; })(), JSON.stringify(comp));
    const rc = await ev("(()=>{const e=document.querySelector('.st-companion');const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()");
    fs.writeFileSync(path.join(os.tmpdir(), 'companion-rect.json'), JSON.stringify(rc));
    const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(os.tmpdir(), 'studio-history-dark.png'), Buffer.from(shot.data, 'base64'));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill(); srv.kill(); await wait(400); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
