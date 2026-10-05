// Real Chrome: the Pholama logo animation plays when the app and the site open, can be skipped, never blocks the page, and shows in the update scene.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'); const wait = ms => new Promise(r => setTimeout(r, ms));
const root = path.join(__dirname, '..');
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-logo-')); const port = 33000 + Math.floor(Math.random() * 2000), dbg = 9800 + Math.floor(Math.random() * 150);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  // the website build, served as plain files (it has no PC server behind it)
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
  const site = http.createServer((q, s) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/') f = '/index.html'; const p = path.join(root, 'docs', path.normalize(f)); if (!p.startsWith(path.join(root, 'docs')) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.statusCode = 404; return s.end('no'); } s.setHeader('Content-Type', mime[path.extname(p)] || 'application/octet-stream'); s.end(fs.readFileSync(p)); }).listen(0, '127.0.0.1');
  while (!site.address()) await wait(50); const sitePort = site.address().port;
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); let logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 220));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('CONSOLE ' + m.params.args.map(a => a.value || a.description).join(' ').slice(0, 220)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  await send('Runtime.enable'); await send('Page.enable');
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  const open = async url => { await send('Page.navigate', { url }); };
  const splashUp = async (ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev("!!document.querySelector('#plogo .pi svg')")) return true; await wait(80); } return false; };
  const clean = () => logs.filter(l => !/favicon|Failed to load resource|net::ERR|manifest|serviceWorker|sw\.js/.test(l));
  try {
    for (const [label, base, isPC] of [['PC app', `http://127.0.0.1:${port}/`, true], ['website', `http://127.0.0.1:${sitePort}/`, false]]) {
      logs = []; await ev("try{sessionStorage.clear();localStorage.clear()}catch(e){}");
      await open(base);
      ok(`${label}: the splash is on screen right after opening`, await splashUp(5000));
      ok(`${label}: it covers the page and sits on top`, await ev("(()=>{const r=document.querySelector('#plogo').getBoundingClientRect(),z=+getComputedStyle(document.querySelector('#plogo')).zIndex;return r.width>=innerWidth-2&&r.height>=innerHeight-2&&z>=99999})()"));
      // wait for the CSS animations themselves to finish (not a guessed timer), so a slow machine cannot fail this
      await ev("Promise.all(document.querySelector('#plogo').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>0)))");
      ok(`${label}: it shows the PHOLAMA name once the sequence ends`, parseFloat(await ev("getComputedStyle(document.querySelector('#plogo .pi-name')).opacity")) > 0.5);
      ok(`${label}: the glasses layer has landed`, parseFloat(await ev("getComputedStyle(document.querySelector('#plogo .pi-glasses')).opacity")) === 1);
      await wait(2800);
      ok(`${label}: the splash leaves by itself`, await ev("!document.querySelector('#plogo')"));
      ok(`${label}: the real app is there underneath`, await ev("!!document.querySelector('header') && !!document.querySelector('#viewSw')"));
      ok(`${label}: no console errors`, clean().length === 0, clean().join(' | '));
      // reload in the same tab: short version
      await open(base); await splashUp();
      ok(`${label}: a reload plays the short version`, await ev("document.querySelector('#plogo .pi')?.classList.contains('fast') === true"));
      // click skips it
      await wait(200); await ev("document.querySelector('#plogo').click()"); await wait(900);
      ok(`${label}: a click skips it`, await ev("!document.querySelector('#plogo')"));
      // a brand new tab (no sessionStorage) plays the full version; ?nosplash never shows it
      await ev("sessionStorage.clear()"); await open(base + '?nosplash'); for (let i = 0; i < 60 && !(await ev("!!document.querySelector('#viewSw')")); i++) await wait(100);
      ok(`${label}: ?nosplash shows no splash`, await ev("!!document.querySelector('#viewSw') && !document.querySelector('#plogo')"));
      // Escape also skips
      await ev("sessionStorage.clear()"); await open(base); await splashUp(); await wait(200);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(900);
      ok(`${label}: Escape skips it`, await ev("!document.querySelector('#plogo')"));
      // the page works while the splash is up: a click on the splash does not reach the app underneath
      await ev("sessionStorage.clear()"); await open(base); await wait(500);
      ok(`${label}: the app is already running behind the splash`, await ev("!!document.querySelector('#viewSw')"));
    }
    // the glasses must be visible WHILE they drop (a white block over them was the bug): step the animation clock and read the lens colour
    await ev("sessionStorage.clear()"); await open(`http://127.0.0.1:${port}/`); await splashUp();
    await ev("document.querySelector('#plogo').getAnimations({subtree:true}).forEach(a=>a.pause())");
    const lens = async ms => ev(`(()=>{const r=document.querySelector('#plogo');r.getAnimations({subtree:true}).forEach(a=>a.currentTime=${ms});const g=r.querySelector('.pi-glasses'),b=r.querySelector('.pi-bare');return {g:+getComputedStyle(g).opacity,b:+getComputedStyle(b).opacity,y:g.getBoundingClientRect().top}})()`);
    const before = await lens(2600), start = await lens(2760), mid = await lens(2950), after = await lens(3400);
    ok('before the drop: glasses hidden, bare face shown', before.g === 0 && before.b === 1, JSON.stringify(before));
    ok('during the drop: glasses are already visible while the bare face is still under them', mid.g > 0.5 && mid.b === 1, JSON.stringify(mid));
    ok('the glasses start above their final spot and settle exactly on it (small bounce allowed)', start.y < after.y - 5 && Math.abs((await lens(3600)).y - after.y) < 0.5, start.y + ' / ' + after.y);
    ok('after landing: glasses fully in, bare face gone (no leftover block)', after.g === 1 && after.b === 0, JSON.stringify(after));
    // reduced motion: the finished logo at once, no moving parts
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await ev("sessionStorage.clear()"); await open(`http://127.0.0.1:${port}/`); await wait(600);
    ok('reduced motion: the logo is shown finished and still', await ev("(()=>{const p=document.querySelector('#plogo .pi');return !!p&&p.classList.contains('still')&&getComputedStyle(p.querySelector('.pi-glasses')).opacity==='1'&&getComputedStyle(p.querySelector('.pi-dot')).display==='none'})()"));
    await wait(1800); ok('reduced motion: it still leaves quickly', await ev("!document.querySelector('#plogo')"));
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    // the update scene (PC app only)
    await ev("sessionStorage.setItem('pholama_splashed','1')"); await open(`http://127.0.0.1:${port}/?nosplash`); await wait(1800);
    const m = await ev("(async()=>{const u=await import('./updatefx.js');const s=u.openInstalling('9.9.9');window.__s=s;return !!document.querySelector('#updScene .upds-logo .pi svg')})()");
    ok('update scene: the llama animation is in it', m === true, m);
    ok('update scene: progress ring and percentage are still there', await ev("!!document.querySelector('#updScene .fg')&&document.querySelector('#updScene .upds-pct').textContent==='0%'"));
    await ev("window.__s.step(2)"); ok('update scene: progress still moves with the llama there', await ev("document.querySelector('#updScene .upds-pct').textContent!=='0%'"));
    await wait(3800); ok('update scene: the llama replays while the update runs', await ev("document.querySelectorAll('#updScene .pi').length===1 && !!document.querySelector('#updScene .pi svg')"));
    await ev("window.__s.done()"); await wait(400);
    ok('update scene: finishing stops the loop and shows all set', await ev("document.querySelector('#updScene .upds-step').textContent==='All set'"));
    await ev("window.__s.close()"); await wait(800); ok('update scene: closes cleanly', await ev("!document.querySelector('#updScene')"));
    ok('no console errors in the update scene', clean().length === 0, clean().join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill('SIGKILL'); srv.kill('SIGKILL'); site.close(); }
  console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASSED'); process.exit(bad ? 1 : 0);
})();
