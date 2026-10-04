// Real Chrome: Settings > Tools is split into groups, every group opens on its own, old switches still work, no console errors, phone width is OK.
// Drives real Chrome over the DevTools protocol: opens the real Pholama page, opens Settings > Tools and clicks every group.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-ui-')); const port = 31000 + Math.floor(Math.random() * 2000), dbg = 9300 + Math.floor(Math.random() * 500);
  const srv = spawn(process.execPath, [require('path').join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
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
  await ev("document.querySelector('#opt').click()"); await wait(1200);
  ok('Settings opened on the Tools tab', await ev("document.querySelector('#dlgSettings').open && document.querySelector('#s_sec_tools').style.display !== 'none'"));
  const groups = ['feat', 'plug', 'mine', 'mcp', 'upd'];
  ok('five groups are offered', (await ev("[...document.querySelectorAll('.s-sub button')].map(b=>b.dataset.sub).join()")) === groups.join());
  for (const g of groups) {
    await ev(`document.querySelector('.s-sub button[data-sub="${g}"]').click()`); await wait(700);
    const vis = await ev("[...document.querySelectorAll('.s-pane')].filter(p=>p.style.display!=='none').map(p=>p.dataset.pane).join()");
    ok('group "' + g + '" shows only itself', vis === g, vis);
  }
  await ev(`document.querySelector('.s-sub button[data-sub="mine"]').click()`); await wait(900);
  ok('My tools shows the Create with AI form', await ev("!!document.querySelector('#myToolsBox .tl-box') && /Create a tool with AI/.test(document.querySelector('#myToolsBox').textContent)"));
  ok('My tools offers hand-made tools and saved keys', await ev("/Make a tool by hand/.test(document.querySelector('#myToolsBox').textContent) && /Saved keys/.test(document.querySelector('#myToolsBox').textContent)"));
  ok('old switches still exist (search, github, mcp, thinking)', await ev("['p_search','p_tools','p_terminal','p_github','p_mcp','p_thinking','plList','skList','editLog','mcpList','updBox'].every(i=>!!document.getElementById(i))"));
  await ev(`document.querySelector('.s-sub button[data-sub="feat"]').click()`); await wait(400);
  ok('a switch still works (toggle search and read it back)', await ev("(()=>{const c=document.querySelector('#p_search');const a=c.checked;c.click();return c.checked!==a})()"));
  for (const t of ['usage', 'account', 'script', 'remote', 'safety', 'tools']) { await ev(`document.querySelector('#s_tab_${t}').click()`); await wait(400); ok('tab "' + t + '" opens', await ev(`document.querySelector('#s_sec_${t}').style.display !== 'none'`)); }
  ok('the chosen group is remembered', (await ev("localStorage.getItem('ph_sub')")) === 'feat');
  ok('no errors in the console', logs.filter(l => !/favicon|Failed to load resource|net::ERR|manifest|serviceWorker|sw\.js/.test(l)).length === 0, logs.join(' | '));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true }); await wait(500);
  ok('on a phone the groups bar scrolls instead of overflowing the screen', await ev("(()=>{const b=document.querySelector('.s-sub');const r=b.getBoundingClientRect();return r.right<=window.innerWidth+1 && getComputedStyle(b).overflowX==='auto'})()"));
  const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(require('os').tmpdir() + '/settings-mobile.png', Buffer.from(shot.data, 'base64'));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); ws.close(); ch.kill('SIGKILL'); srv.kill('SIGKILL'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
