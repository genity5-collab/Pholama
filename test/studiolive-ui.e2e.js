// Real Chrome: the Live Activity card appears in the Studio chat while the AI works, lists the files, and ends cleanly.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-live-')); const port = 39500 + Math.floor(Math.random() * 1000), dbg = 9900 + Math.floor(Math.random() * 40);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_NO_UPDATE: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) break; } catch {} await wait(250); }
  await fetch(`http://127.0.0.1:${port}/api/studio/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'live' }) });
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1200,800', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(4000);
    await ev("(document.querySelector('#vStudio')||[...document.querySelectorAll('#viewSw button')].find(b=>/studio/i.test(b.textContent))).click()"); await wait(2500);
    // Stand in for the server: a stream that thinks, reads a file, edits two (one with a hostile name), then answers, with pauses so the card can be seen mid-job.
    await ev(`(() => { const real = window.fetch.bind(window); const enc = new TextEncoder();
      const lines = [ {log:{kind:'thought',text:'Looking at the page first'}}, {toolStart:{name:'studio_read',args:{file:'index.html'}}}, {tool:{name:'studio_read',args:{file:'index.html'},result:'ok'}},
        {toolStart:{name:'studio_write',args:{file:'style.css'}}}, {toolStart:{name:'studio_write',args:{file:'<img src=x onerror=window.__pwn=1>.js'}}}, {tool:{name:'studio_write',args:{file:'style.css'},result:'ok'}}, {tool:{name:'studio_write',args:{file:'<img src=x onerror=window.__pwn=1>.js'},result:'ok'}}, {message:{content:'All done.'}} ];
      window.fetch = (u, o) => { if (String(u).includes('api/chat')) { const body = new ReadableStream({ async start(c) { for (const l of lines) { c.enqueue(enc.encode(JSON.stringify(l) + '\\n')); await new Promise(r => setTimeout(r, 900)); } c.close(); } }); return Promise.resolve(new Response(body, { status: 200 })); } return real(u, o); }; })()`);
    const sel = await ev("(()=>{const s=document.querySelector('#stProj');return s?s.value+'|'+s.options.length:'none'})()");
    await wait(1200); ok('(setup) the test project is open', (await ev("document.querySelector('#stProj').value")) === 'live', sel);
    await ev("(()=>{const i=document.querySelector('#stAsk'); i.value='make a page'; document.querySelector('#stSend').click();})()");
    let seen = null; for (let i = 0; i < 20; i++) { await wait(400); const t = await ev("(()=>{const c=document.querySelector('.st-live');return c?{phase:c.dataset.phase,title:c.querySelector('.lv-title').textContent,thought:c.querySelector('.lv-thought').textContent,files:[...c.querySelectorAll('.lv-files li')].map(l=>l.textContent)}:null})()"); if (t && t.files && t.files.length >= 1) { seen = t; break; } }
    ok('the card appears in the chat while the AI works', !!seen, sel);
    ok('it shows what the AI is thinking', seen && /Looking at the page/.test(seen.thought), JSON.stringify(seen));
    await wait(3600);
    const mid = await ev("(()=>{const c=document.querySelector('.st-live');return c?{title:c.querySelector('.lv-title').textContent,files:[...c.querySelectorAll('.lv-files li')].map(l=>l.textContent+(l.classList.contains('done')?'[done]':''))}:null})()");
    ok('it lists the files it reads and edits, finished ones ticked', mid && mid.files.length >= 3 && mid.files.some(f => /index\.html/.test(f) && /done/.test(f)) && mid.files.some(f => /style\.css/.test(f)), JSON.stringify(mid));
    ok('a hostile file name is shown as plain text, never run', (await ev("window.__pwn")) === undefined && (await ev("!!document.querySelector('.st-live img')")) === false, await ev('window.__pwn'));
    let fin = null; for (let i = 0; i < 25; i++) { await wait(500); const b = await ev("document.querySelector('#stSend').textContent"); if (/send/i.test(b)) { fin = b; break; } }
    ok('the job finishes and the Send button returns', !!fin, fin);
    await wait(500); const end = await ev("(()=>{const c=document.querySelector('.st-live');return c?{ended:c.classList.contains('ended'),title:c.querySelector('.lv-title').textContent}:null})()");
    ok('the card ends with a summary of what changed', end && end.ended && /Changed 2 files/.test(end.title), JSON.stringify(end));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill('SIGKILL'); srv.kill('SIGKILL'); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
