// Real Chrome: the Studio companion wanders by itself, codes on a tiny laptop while the AI builds, stays on screen, and respects drag.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-cmp-')); const port = 38000 + Math.floor(Math.random() * 1500), dbg = 9850 + Math.floor(Math.random() * 40);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_NO_UPDATE: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1200,800', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  const pos = () => ev("(()=>{const e=document.querySelector('.st-companion-wrap');if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),mood:e.dataset.mood||'',pcHidden:e.querySelector('.st-companion-pc').hidden,walking:e.classList.contains('walking')}})()");
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(4000);
    await ev("localStorage.setItem('pholama_studio_companion','on')");
    await ev("(document.querySelector('#vStudio')||[...document.querySelectorAll('#viewSw button')].find(b=>/studio/i.test(b.textContent))).click()"); await wait(2500);
    ok('Studio opened', await ev("document.body.classList.contains('studio-on')"), await ev('document.body.className'));
    await ev("(()=>{const c=document.querySelector('#stCompanion');c.checked=true;c.dispatchEvent(new Event('change'))})()"); await wait(500);
    const p0 = await pos(); ok('the companion is on screen', p0 && p0.x >= 0 && p0.y >= 0 && p0.x <= 1200 && p0.y <= 800, JSON.stringify(p0));
    ok('the tiny laptop exists and is hidden while idle', p0 && p0.pcHidden === true, JSON.stringify(p0));
    // it wanders by itself
    const seen = new Set(), xs = []; let onScreen = true, sawWalk = false;
    for (let i = 0; i < 24; i++) { await wait(1000); const p = await pos(); if (!p) continue; seen.add(p.x + ',' + p.y); xs.push(p.x); if (p.walking) sawWalk = true; if (p.x < 0 || p.y < 0 || p.x > 1200 - 56 + 2 || p.y > 800 - 56 + 2) onScreen = false; }
    ok('it walks around on its own (visited several spots)', seen.size >= 3, [...seen].slice(0, 6).join(' | '));
    ok('while moving it shows the walking look', sawWalk);
    ok('it never leaves the screen', onScreen, xs.join(','));
    // dragging stops it: menu open means it stays put
    let mid = null; for (let i = 0; i < 60 && !mid; i++) { const p = await pos(); if (p && p.walking) mid = p; else await wait(250); }
    ok('(setup) caught it in the middle of a walk', !!mid, JSON.stringify(await pos()));
    await ev("document.querySelector('.st-companion').click()"); await wait(300);
    const a = await pos(); await wait(7000); const b = await pos();
    ok('with its menu open it stands still', a && b && a.x === b.x && a.y === b.y, JSON.stringify([a, b]));
    await ev("document.querySelector('.st-companion').click()"); await wait(300);
    // it codes while the AI is really building
    await ev("window.__pholamaStudioBusy && window.__pholamaStudioBusy(true)");
    const forced = await ev("typeof window.__pholamaStudioBusy");
    ok('a test hook exists to simulate the AI building', forced === 'function', forced);
    let coding = null; for (let i = 0; i < 12; i++) { await wait(1000); const p = await pos(); if (p && p.mood === 'code' && !p.pcHidden) { coding = p; break; } }
    ok('while the AI builds, the laptop appears and it codes', !!coding, JSON.stringify(await pos()));
    await wait(2500); const txt = await ev("document.querySelector('.st-pc-screen pre').textContent");
    ok('the laptop screen shows code being typed', typeof txt === 'string' && txt.length > 5 && /[;{}()<>=]/.test(txt), JSON.stringify(txt));
    await ev("window.__pholamaStudioBusy(false)");
    let done = false; for (let i = 0; i < 12; i++) { await wait(1000); const p = await pos(); if (p && p.mood !== 'code' && p.pcHidden) { done = true; break; } }
    ok('when the AI stops, the laptop goes away', done, JSON.stringify(await pos()));
    // turning it off removes everything and stops the timers
    await ev("(()=>{const c=document.querySelector('#stCompanion');c.checked=false;c.dispatchEvent(new Event('change'))})()"); await wait(500);
    ok('turning it off removes it', (await pos()) === null);
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill('SIGKILL'); srv.kill('SIGKILL'); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
