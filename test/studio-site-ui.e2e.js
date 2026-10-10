// Real Chrome on the WEBSITE copy (docs/): the Studio shows credits, launches a project, streams builder messages, then shows the live screen.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-st-')); const port = 33000 + Math.floor(Math.random() * 2000), dbg = 9800 + Math.floor(Math.random() * 500);
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.join(__dirname, '..', 'docs')], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch {} await wait(250); }
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}/chrome`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 220)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(3000);
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  // Mount the real client in a fresh box with a stubbed network.
  await ev(`(async () => {
    window.__st = { projects: [], phase: 'init', calls: [] };
    window.fetch = async (u, o) => { const b = JSON.parse(o.body); const S = window.__st; S.calls.push(b.action); const r = d => ({ ok: true, json: async () => ({ errors: null, data: d }) });
      if (b.action === 'credits') return r({ credits: 41 });
      if (b.action === 'projects') return r(S.projects);
      if (b.action === 'launch') { S.projects = [{ projectId: 'ab12cd34-gps', label: b.label, status: 'init' }]; return r({ projectId: 'ab12cd34-gps', started: true }); }
      if (b.action === 'status') return r(S.phase === 'init' ? { projectId: 'ab12cd34-gps', label: 'GPS', status: 'init', done: false, expectedMinutes: 9, messages: [{ text: 'Planning the map screen', type: 'building' }], previewUrl: '' } : { projectId: 'ab12cd34-gps', label: 'GPS', status: 'done', done: true, creditsSpent: 7.5, messages: [{ text: 'All done', type: 'finished' }], previewUrl: 'about:blank#live', productionUrl: '' });
      if (b.action === 'versions') return r([{ id: 'v_abc123', name: 'First build', createdAt: '2026-10-10T00:00:00Z' }]);
      if (b.action === 'prompt') return r({ status: 'init' });
      return r({}); };
    const host = document.createElement('div'); host.id = 'st_host'; document.body.append(host);
    const m = await import('./cloudstudio.js'); window.__studio = m.mountCloudStudio(host, { Account: { token: () => 'tok' }, cfg: () => ({ STUDIO_URL: 'https://x.test/f' }), setInterval: (fn, ms) => setInterval(fn, 300) });
  })()`); await wait(900);
  ok('credits are shown in the header', /Build credits: 41/.test(await ev("document.querySelector('.cloudstudio-credits').textContent")), await ev("document.querySelector('.cloudstudio-credits').textContent"));
  ok('the empty state offers a new project form', /Create your first project/.test(await ev("document.querySelector('#st_host').textContent") || ''), await ev("document.querySelector('#st_host').textContent"));
  await ev("document.querySelector('#st_host input').value='GPS app'; document.querySelector('#st_host textarea').value='a gps app with free maps'; [...document.querySelectorAll('#st_host button')].find(b=>b.textContent==='Launch project').click()"); await wait(1500);
  ok('launching opens the project workspace', /GPS/.test(await ev("document.querySelector('.cloudstudio-project-head h2')?.textContent || ''")), await ev("document.querySelector('#st_host').innerText.slice(0,300)"));
  ok('the live builder message streams into the chatbot', /Planning the map screen/.test(await ev("document.querySelector('.cloudstudio-transcript').textContent")));
  ok('while building: waiting note shown, live screen hidden, Stop shown', (await ev("!document.querySelector('.cloudstudio-wait').hidden")) && (await ev("document.querySelector('.cloudstudio-live').hidden")) && (await ev("!document.querySelector('.cloudstudio-project-head button:nth-of-type(2)').hidden")));
  ok('Publish is locked while building', await ev("[...document.querySelectorAll('.cloudstudio-project-head button')].find(b=>b.textContent==='Publish').disabled"));
  await ev("window.__st.phase='done'"); await wait(1200);
  ok('when the builder finishes, the live screen appears', (await ev("!document.querySelector('.cloudstudio-live').hidden")) && (await ev("document.querySelector('.cloudstudio-wait').hidden")));
  ok('the live screen points at the project preview URL', /about:blank/.test(await ev("document.querySelector('.cloudstudio-live').src")), await ev("document.querySelector('.cloudstudio-live').src"));
  ok('Open in new tab is enabled next to the iframe', (await ev("[...document.querySelectorAll('.cloudstudio-project-head button')].find(b=>b.textContent==='Open in new tab').disabled")) === false);
  ok('credits used by the last run are shown', /7\.5 credits/.test(await ev("document.querySelector('.cloudstudio-status').textContent")));
  ok('Publish unlocks once there is a preview', (await ev("[...document.querySelectorAll('.cloudstudio-project-head button')].find(b=>b.textContent==='Publish').disabled")) === false);
  ok('version history lists the first build with Restore', /First build/.test(await ev("document.querySelector('.cloudstudio-versions').textContent")) && (await ev("!![...document.querySelectorAll('.cloudstudio-versions button')].find(b=>b.textContent==='Restore')")));
  await ev("document.querySelector('.cloudstudio-chat textarea').value='add a search box'; [...document.querySelectorAll('.cloudstudio-chat button')].find(b=>b.textContent==='Send to builder').click()"); await wait(700);
  ok('a chat change is sent to the builder and echoed', (await ev('window.__st.calls.includes("prompt")')) && /add a search box/.test(await ev("document.querySelector('.cloudstudio-transcript').textContent")));
  ok('polling stops after the run finishes (no endless requests)', await (async () => { const a = await ev('window.__st.calls.filter(c=>c==="status").length'); await wait(1200); const b = await ev('window.__st.calls.filter(c=>c==="status").length'); return b - a <= 8; })());
  ok('no errors in the console', logs.length === 0, logs.join(' | '));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); ch.kill(); srv.kill(); process.exit(bad ? 1 : 0);
})();
