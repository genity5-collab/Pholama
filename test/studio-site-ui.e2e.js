// Browser smoke test for the new Chat-first website. No live database or AI calls are made.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const chrome = process.env.CHROME_BIN || 'google-chrome';
  if (spawnSync(chrome, ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-chat-ui-'));
  const port = 35000 + Math.floor(Math.random() * 1000), dbg = 10500 + Math.floor(Math.random() * 500);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.join(__dirname, '..', 'docs')], { stdio: 'ignore' });
  let browser = null, ws = null, bad = 0;
  const ok = (name, condition, detail = '') => { console.log((condition ? 'PASS ' : 'FAIL ') + name + (condition ? '' : ' -> ' + String(detail).slice(0, 350))); if (!condition) bad++; };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch {} await wait(200); }
    browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}`, 'about:blank'], { stdio: 'ignore' });
    let tabs = null;
    for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(200); }
    if (!tabs?.length) throw new Error('Chrome DevTools did not start');
    ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0; const pending = new Map(), errors = [];
    ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 180)); };
    const send = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
    await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(3500);
    const initial = await ev(`({ title: document.title, chat: document.querySelector('#vChat')?.textContent.trim(), hasInput: !!document.querySelector('#in'), history: !!document.querySelector('#histBtn'), agentBar: !document.querySelector('#siteAgentBar'), plugin: !!document.querySelector('#retroPluginBtn') })`);
    ok('real page loads in Chat-first mode with conversation controls', initial && initial.chat === 'Chat' && initial.hasInput && initial.history && initial.agentBar && initial.plugin, JSON.stringify(initial));
    await ev(`document.querySelector('#retroPluginBtn').click()`);
    ok('RetroStudio toggles its mock workspace from the chat toolbar', await ev(`document.querySelector('#retroPluginBtn').getAttribute('aria-pressed') === 'true' && !document.querySelector('#retroWorkspace').hidden`));
    await ev(`(() => { window.__alerts=[]; window.alert=t=>window.__alerts.push(String(t)); })()`);
    const attachResult = await ev(`(async () => { const a=await import('./attachui.js'); const f=n=>new File([new Uint8Array([1,2,3])], n, {type:'image/png'}); await a.addAttachmentFiles([f('one.png'),f('two.png'),f('three.png'),f('four.png')]); return { chips: document.querySelectorAll('#attachChips .achip').length, warning: window.__alerts.join(' ') }; })()`);
    ok('fourth image is rejected while three image attachments remain', attachResult?.chips === 3 && /3 images/.test(attachResult.warning), JSON.stringify(attachResult));
    const simulation = await ev(`(async () => { const R=await import('./retrostudio.js'); const r=R.simulateLuau('local P = Instance.new("Part")\\nP.Parent = workspace'); return {simulated:r.simulated, parts:r.parts.length, note:document.querySelector('#retroCanvas').getAttribute('aria-label')}; })()`);
    ok('the browser-side preview is explicitly simulated and accepts only supported parts', simulation?.simulated === true && simulation.parts === 1, JSON.stringify(simulation));
    ok('browser reported no uncaught page exceptions', errors.length === 0, errors.join(' | '));
    console.log(bad ? `${bad} FAILED` : 'ALL PASSED'); process.exitCode = bad ? 1 : 0;
  } catch (e) { console.error('FAIL browser smoke: ' + e.message); process.exitCode = 1; }
  finally { try { ws?.close(); } catch {} try { browser?.kill(); } catch {} try { server.kill(); } catch {} }
})();
