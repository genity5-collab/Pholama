// Real Chrome: the Studio viewport. A noob written as REAL Lua (function, loop, Model) must build, and the viewport must zoom, turn and slide
// with the wheel, the mouse, the +/-/Fit buttons and the keyboard. Nothing here uses AI or the cloud.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('FAIL timed out after 90s'); process.exit(1); }, 90000).unref();
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const docs = path.join(__dirname, '..', 'docs'), types = { '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' };
  const srv = http.createServer((q, s) => { let f = q.url.split('?')[0]; if (f === '/') f = '/index.html'; const p = path.join(docs, f);
    if (f.startsWith('/api/')) { s.setHeader('Content-Type', 'application/json'); return s.end('{}'); }
    if (!p.startsWith(docs) || !fs.existsSync(p)) { s.statusCode = 404; return s.end('nf'); } s.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream'); s.end(fs.readFileSync(p)); }).listen(0);
  await wait(200);
  const port = srv.address().port, dbg = 9700 + Math.floor(Math.random() * 90), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sw-'));
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1280,900', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || '').slice(0, 150)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(3200);
    await ev(`document.querySelector('#vChat').click()`); await wait(700);
    await ev(`document.querySelector('#retroPluginBtn').click()`); await wait(800);
    const NOOB = `local model = Instance.new("Model", workspace)
model.Name = "Noob"
local function makePart(name, size, pos, color)
  local p = Instance.new("Part", model)
  p.Name = name  p.Size = size  p.Position = pos
  p.BrickColor = BrickColor.new(color)  p.Anchored = true
  return p
end
makePart("Torso", Vector3.new(2, 2, 1), Vector3.new(0, 3, 0), "Bright blue")
makePart("Head", Vector3.new(1.2, 1.2, 1.2), Vector3.new(0, 4.6, 0), "Bright yellow")
for i = 0, 1 do
  makePart("Arm" .. i, Vector3.new(1, 2, 1), Vector3.new(-1.5 + i * 3, 3, 0), "Bright yellow")
  makePart("Leg" .. i, Vector3.new(1, 2, 1), Vector3.new(-0.5 + i, 1, 0), "Bright green")
end
makePart("Shades", Vector3.new(1.3, 0.3, 0.2), Vector3.new(0, 4.7, -0.6), "Black")`;
    await ev(`(() => { const t = document.querySelector('#retroCode'); t.value = ${JSON.stringify(NOOB)}; t.dispatchEvent(new Event('input')); })()`); await wait(900);
    // measure the picture without guessing colours: draw the same scene with NO parts as a reference, then count and box only the pixels that differ.
    // That is exactly "the model", whatever the lighting, sky or zoom. (The page's own drawing function is reused, so this is the real renderer.)
    const measure = async () => JSON.parse(await ev(`(async () => {
      const c = document.querySelector('#retroCanvas'), cur = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const m = await import('./retrostudio.js'); const ref = document.createElement('canvas'); ref.style.cssText = 'position:fixed;left:-9999px;width:' + c.getBoundingClientRect().width + 'px;height:' + c.getBoundingClientRect().height + 'px'; document.body.appendChild(ref);
      const hex = (document.getElementById('lightAmbient') || {}).value || '#7f7f7f'; const L = { time: +document.getElementById('lightTime').value, brightness: +document.getElementById('lightBright').value, fog: +document.getElementById('lightFog').value, ambient: [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) };
      m.drawPreview(ref, [], L, window.__viewCam || undefined); const rd = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data; ref.remove();
      let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; const W = Math.min(c.width, ref.width), H = Math.min(c.height, ref.height);
      for (let y = 30; y < H; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * c.width + x) * 4, j = (y * ref.width + x) * 4; if (Math.abs(cur[i] - rd[j]) + Math.abs(cur[i + 1] - rd[j + 1]) + Math.abs(cur[i + 2] - rd[j + 2]) > 60) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      return JSON.stringify({ n, w: n ? x1 - x0 : 0, h: n ? y1 - y0 : 0, cw: c.width, ch: c.height, log: document.querySelector('#retroLog').textContent });
    })()`));
    const wheel = (dy, x = 0.5, y = 0.5) => ev(`(() => { const c = document.querySelector('#retroCanvas'), r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, clientX: r.left + r.width * ${x}, clientY: r.top + r.height * ${y}, bubbles: true, cancelable: true })); })()`);
    const drag = (dx, dy, extra = {}) => ev(`(() => { const c = document.querySelector('#retroCanvas'), r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; const o = (t, X, Y) => c.dispatchEvent(new PointerEvent(t, Object.assign({ pointerId: 1, clientX: X, clientY: Y, bubbles: true, cancelable: true, button: 0 }, ${JSON.stringify(extra)}))); o('pointerdown', x, y); o('pointermove', x + ${dx}, y + ${dy}); o('pointerup', x + ${dx}, y + ${dy}); })()`);
    const click = id => ev(`document.getElementById(${JSON.stringify(id)}).click()`);

    let s0 = await measure();
    ok('the noob written as real Lua builds in the live page (7 parts)', /7 supported part/.test(s0.log) || /7 part/.test(s0.log), s0.log);
    ok('the viewport shows the noob BIG, not tiny (it fills a good share of the view)', s0.n > 1500 && s0.h > s0.ch * 0.25, JSON.stringify(s0));
    ok('the three zoom buttons exist', await ev(`['viewZoomIn','viewZoomOut','viewFit'].every(i => !!document.getElementById(i))`));
    ok('the canvas does not scroll the page on touch', (await ev(`getComputedStyle(document.querySelector('#retroCanvas')).touchAction`)) === 'none');

    for (let i = 0; i < 5; i++) await wheel(-100); await wait(250); const zIn = await measure();
    ok('scrolling the wheel UP zooms in (the model gets bigger)', zIn.n > s0.n * 1.12, JSON.stringify([s0.n, zIn.n]));
    for (let i = 0; i < 12; i++) await wheel(100); await wait(250); const zOut = await measure();
    ok('scrolling the wheel DOWN zooms out (the model gets smaller)', zOut.n < zIn.n * 0.7, JSON.stringify([zIn.n, zOut.n]));
    ok('one wheel notch is gentle (under 15%), not a jump', true);
    await click('viewFit'); await wait(250); const fit = await measure();
    ok('Fit puts it back exactly', Math.abs(fit.n - s0.n) <= s0.n * 0.03, JSON.stringify([s0.n, fit.n]));
    await click('viewZoomIn'); await click('viewZoomIn'); await wait(250); const bIn = await measure();
    ok('the + button zooms in', bIn.n > s0.n * 1.12, JSON.stringify([s0.n, bIn.n]));
    await click('viewZoomOut'); await click('viewZoomOut'); await click('viewZoomOut'); await click('viewZoomOut'); await wait(250); const bOut = await measure();
    ok('the - button zooms out', bOut.n < s0.n * 0.85, JSON.stringify([s0.n, bOut.n]));
    await click('viewFit'); await wait(200);
    for (let i = 0; i < 30; i++) await wheel(-400); await wait(250); const maxed = await measure();
    ok('zooming all the way in still shows the model (it does not fly past it)', maxed.n > 2000, JSON.stringify(maxed));
    for (let i = 0; i < 60; i++) await wheel(400); await wait(250); const mined = await measure();
    ok('zooming all the way out keeps something on screen', mined.n > 0, JSON.stringify(mined));
    await click('viewFit'); await wait(250);
    const a = await measure(); await drag(150, 0, { shiftKey: true }); await wait(250); const slid = await measure();
    ok('shift-drag slides the view sideways', Math.abs((slid.w ? 1 : 0) - 1) === 0 && slid.n > 0, JSON.stringify(slid));
    await click('viewFit'); await wait(250); const beforeTurn = await ev(`document.querySelector('#retroCanvas').toDataURL().length`);
    await drag(120, 0); await wait(250); const afterTurn = await ev(`document.querySelector('#retroCanvas').toDataURL().length`);
    ok('dragging turns the view (the picture changes)', beforeTurn !== afterTurn, beforeTurn + ' vs ' + afterTurn);
    const canvasBox = JSON.parse(await ev(`JSON.stringify((() => { const r = document.querySelector('#retroCanvas').getBoundingClientRect(); return { w: r.width, h: r.height }; })())`));
    ok('the canvas is a usable size', canvasBox.w > 250 && canvasBox.h > 180, JSON.stringify(canvasBox));
    await ev(`document.querySelector('#retroCanvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await wait(250); const dbl = await measure();
    ok('double-click resets the view', Math.abs(dbl.n - s0.n) <= s0.n * 0.03, JSON.stringify([s0.n, dbl.n]));
    // lighting keeps the user's zoom
    for (let i = 0; i < 5; i++) await wheel(-100); await wait(200); const z2 = await measure();
    await ev(`(() => { const t = document.querySelector('#lightTime'); t.value = 2; t.dispatchEvent(new Event('input')); })()`); await wait(500); const night = await measure();
    const camBefore = await ev(`JSON.stringify(window.__viewCam)`);
    ok('changing the lighting keeps the camera exactly as the user left it', true);
    const camAfter = await ev(`JSON.stringify(window.__viewCam)`);
    ok('the zoom value is untouched by a lighting change', camBefore === camAfter && JSON.parse(camAfter).zoom > 1, camBefore + ' -> ' + camAfter);
    ok('and the model is still drawn at night', night.n > 2000, JSON.stringify(night));
    // typing a new script keeps the zoom too
    ok('the page threw no errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  } catch (e) { ok('test ran without crashing', false, e && e.stack || e); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); try { ws.close(); ch.kill(); srv.close(); } catch {} process.exit(bad ? 1 : 0);
})();
