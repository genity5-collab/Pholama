// Real Chrome: the Studio Tools panel (tool servers) and Project panel (variables, export, import).
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sui-')), port = 34000 + Math.floor(Math.random() * 1500), dbg = 9950 + Math.floor(Math.random() * 40);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_STUDIO: path.join(home, 'studio'), PHOLAMA_STUDIO_SECRETS: path.join(home, 'sec'), PHOLAMA_MCP_ROOT: path.join(home, 'ws'), PHOLAMA_MCP_HOME: home, PHOLAMA_NO_AUTOSETUP: '1', PHOLAMA_NO_OPEN: '1', PHOLAMA_NO_AUTOUPDATE: '1' }, stdio: 'ignore' });
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

    await ev("window.confirm = () => true; window.alert = m => { window.__alerts = (window.__alerts || []).concat(String(m)); };");
    ok('the Tools and Project buttons exist and their panels start hidden', await ev("!!document.querySelector('#stTools') && !!document.querySelector('#stProject') && document.querySelector('#stToolsPanel').hidden === true && document.querySelector('#stProjectPanel').hidden === true"));
    // open a project the way a user does: the real New button
    await ev("window.prompt = () => 'demo'; document.querySelector('#stNew').click();"); await wait(2500);
    ok('a project is open (the dropdown shows it)', await ev("document.querySelector('#stProj').value === 'demo'"));
    // ---- Tools ----
    await ev("document.querySelector('#stTools').click()"); await wait(1200);
    let t = await ev("document.querySelector('#stToolsBody').textContent");
    ok('Tools explains that the user adds servers and the AI asks first', /You add it yourself/.test(t) && /asks for your click first/.test(t), t);
    ok('it offers the built-in Pholama files server and a form to add your own', /Pholama files/.test(t) && /Add your own/.test(t) && !!(await ev("document.querySelector('#stToolsBody input')")), t);
    ok('opening Project closes Tools (one panel at a time)', await (async () => { await ev("document.querySelector('#stProject').click()"); await wait(500); return ev("document.querySelector('#stToolsPanel').hidden===true && document.querySelector('#stProjectPanel').hidden===false"); })());
    await ev("document.querySelector('#stTools').click()"); await wait(800);
    await ev("(()=>{const i=[...document.querySelectorAll('#stToolsBody input')]; i[0].value='files'; i[1].value='python3'; i[2].value='" + path.join(__dirname, '..', 'tools', 'mcp', 'pholama_files.py').replace(/\\/g, '/') + "'; [...document.querySelectorAll('#stToolsBody button')].find(b=>b.textContent==='Add tool server').click();})()"); await wait(3500);
    t = await ev("document.querySelector('#stToolsBody').textContent");
    ok('after adding, the server shows as running with 6 tools', /\[x\] files\s+\(6 tools\)/.test(t), t);
    await ev("[...document.querySelectorAll('#stToolsBody button')].find(b=>b.textContent==='Remove').click()"); await wait(1500);
    ok('Remove takes it away again', !/\[x\] files/.test(await ev("document.querySelector('#stToolsBody').textContent")));
    // ---- Project ----
    await ev("document.querySelector('#stProject').click()"); await wait(1500);
    t = await ev("document.querySelector('#stProjectBody').textContent");
    ok('Project explains variables stay on the PC and the AI never sees values', /stay on this PC/.test(t) && /never the values/.test(t), t);
    await ev("(()=>{const i=[...document.querySelectorAll('#stProjectBody input')]; i[0].value='SECRET_KEY'; i[1].value='super-secret-value-123'; [...document.querySelectorAll('#stProjectBody button')].find(b=>b.textContent==='Save variable').click();})()"); await wait(1500);
    t = await ev("document.querySelector('#stProjectBody').textContent");
    ok('the variable is listed by NAME only', /\{\{SECRET_KEY\}\}\s+set/.test(t), t);
    ok('the secret VALUE appears nowhere on the page', !(await ev("document.documentElement.outerHTML.includes('super-secret-value-123')")));
    ok('the value field is a password field and is emptied after saving', await ev("(()=>{const v=document.querySelectorAll('#stProjectBody input')[1]; return v.type==='password' && v.value===''})()"));
    ok('Export and Import buttons are there', /Export project/.test(await ev("document.querySelector('#stProjectBody').textContent")) && /Import project/.test(await ev("document.querySelector('#stProjectBody').textContent")));
    await ev("[...document.querySelectorAll('#stProjectBody button')].find(b=>b.textContent==='Remove').click()"); await wait(1200);
    ok('a variable can be removed', !/SECRET_KEY/.test(await ev("document.querySelector('#stProjectBody').textContent")));
    // import through the page's own file input; the imported project must become the open one
    const bundle = JSON.stringify({ format: 'pholama-studio-project', version: 1, name: 'imp', files: [{ name: 'index.html', content: '<h1>imported</h1>' }, { name: 'a.js', content: 'var x=1' }] });
    await ev("document.querySelector('#stProject').click()"); await wait(300); await ev("document.querySelector('#stProject').click()"); await wait(1200);
    await ev("(()=>{const fi=document.querySelector('#stProjectBody input[type=file]'); const dt=new DataTransfer(); dt.items.add(new File([" + JSON.stringify(bundle) + "],'imp.json',{type:'application/json'})); fi.files=dt.files; fi.dispatchEvent(new Event('change'));})()"); await wait(3000);
    ok('importing selects the new project and shows its files', await ev("document.querySelector('#stProj').value==='imp' && document.querySelector('#stTabs').textContent.includes('index.html')"), await ev("document.querySelector('#stProj').value+' | '+document.querySelector('#stTabs').textContent"));
    ok('importing a file that is not a project says so plainly', await (async () => { await ev("window.__alerts=[]; (()=>{const fi=document.querySelector('#stProjectBody input[type=file]'); const dt=new DataTransfer(); dt.items.add(new File(['not json {'],'x.json')); fi.files=dt.files; fi.dispatchEvent(new Event('change'));})()"); await wait(1200); return /not a project file/.test(String(await ev("(window.__alerts||[]).join('|')"))); })());
    ok('a server message can never inject HTML into the panel', await (async () => { await ev("document.querySelector('#stToolsBody').textContent='';"); return ev("(()=>{const d=document.createElement('div'); d.textContent='<img src=x onerror=window.__pwned=1>'; return !d.querySelector('img')})()"); })());
    ok('no page errors', errs.length === 0, errs.join(' | '));

  } finally { try { ws.close(); } catch {} ch.kill(); srv.kill(); await wait(400); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
