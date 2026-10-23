// The Manual encoder card on the RetroStudio tab, driven in a real browser: paste a script, press Encode, get a string that RetroStudio can import.
// Golden scripts (made by the reference encoder) are the proof: the page must give the same blocks, and must say so honestly when it cannot.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const chrome = process.env.CHROME_BIN || 'google-chrome';
  if (spawnSync(chrome, ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-menc-')), port = 37000 + Math.floor(Math.random() * 900), dbg = 11500 + Math.floor(Math.random() * 400);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.join(__dirname, '..', 'docs')], { stdio: 'ignore' });
  let browser = null, ws = null, bad = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch {} await wait(150); }
    browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}`, 'about:blank'], { stdio: 'ignore' });
    let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(200); }
    ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
    let id = 0; const pend = new Map(), errors = [];
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 200)); };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
    await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(2500);
    await ev(`localStorage.setItem('pholama.connectors', JSON.stringify({retrostudio:true}))`);
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(2200);
    await ev(`document.querySelector('#vStudio').click()`); await wait(400);
    await ev(`(()=>{const t=document.querySelector('#stTabRetro'); t.hidden=false; t.click();})()`); await wait(500);

    const ui = await ev(`(() => { const v = e => { const r = e && e.getBoundingClientRect(); return !!(r && r.width > 0 && r.height > 0); }; return { card: v(document.querySelector('#retroManual')), input: v(document.querySelector('#mEncIn')), go: v(document.querySelector('#mEncGo')), title: (document.querySelector('#retroManual .retro-card-head b') || {}).textContent, outHidden: document.querySelector('#mEncOut').hidden, chatBar: getComputedStyle(document.querySelector('footer')).display }; })()`);
    ok('the Manual encoder card is on the RetroStudio tab and visible', ui.card && ui.input && ui.go && ui.title === 'Manual encoder', JSON.stringify(ui));
    ok('the chat bar is hidden while Studio is open (it used to float over the Viewport)', ui.chatBar === 'none', ui.chatBar);
    ok('the output stays hidden until something is encoded', ui.outHidden === true);

    // a button press with nothing pasted says so, and does not crash
    await ev(`document.querySelector('#mEncGo').click()`); await wait(200);
    ok('Encode with an empty box says what to do', /Paste a script/.test(await ev(`document.querySelector('#mEncLog').textContent`)));

    // golden scripts: the page must give the same blocks as the reference encoder
    const golden = fs.readdirSync(path.join(__dirname, 'golden')).filter(f => f.endsWith('.json')).sort().slice(0, 6).map(f => JSON.parse(fs.readFileSync(path.join(__dirname, 'golden', f), 'utf8')));
    let matched = 0; const notes = [];
    for (const g of golden) {
      await ev(`(()=>{ const i = document.querySelector('#mEncIn'); i.value = ${JSON.stringify(g.source)}; })()`);
      await ev(`document.querySelector('#mEncGo').click()`); await wait(700);
      const r = await ev(`({ hidden: document.querySelector('#mEncOut').hidden, text: document.querySelector('#mEncText').value, info: document.querySelector('#mEncInfo').textContent, state: document.querySelector('#mEncState').textContent })`);
      const m = /^(\d+) blocks/.exec(r.info || ''); const same = !r.hidden && r.text.startsWith('\x1a0000000000000004\x1b') && m && Number(m[1]) === Number(g.blocks) && /checked OK/.test(r.info);
      if (same) matched++; else notes.push(`${g.blocks} expected, got "${r.info}" hidden=${r.hidden}`);
    }
    ok(`the page encodes ${golden.length} golden scripts to the same block count, each decoded and checked`, matched === golden.length, notes.join(' | '));

    // the copy button puts the string in the clipboard path without throwing, and the editor-script shortcut fills the box
    await ev(`(()=>{ document.querySelector('#retroCode').value = 'print("hi")'; document.querySelector('#mEncFromEditor').click(); })()`); await wait(150);
    ok('"Use editor script" fills the box from the editor', await ev(`document.querySelector('#mEncIn').value === 'print("hi")'`));
    await ev(`document.querySelector('#mEncGo').click()`); await wait(600);
    ok('a one-line script encodes (print is a real block)', await ev(`!document.querySelector('#mEncOut').hidden && /1 blocks/.test(document.querySelector('#mEncInfo').textContent)`), await ev(`document.querySelector('#mEncLog').textContent`));
    await ev(`document.querySelector('#mEncCopy').click()`); await wait(300);
    ok('Copy reacts (Copied, or the select fallback)', await ev(`/Copied|Select and copy/.test(document.querySelector('#mEncCopy').textContent)`), await ev(`document.querySelector('#mEncCopy').textContent`));

    // something it cannot turn into blocks is said plainly, with no string shown
    await ev(`(()=>{ document.querySelector('#mEncIn').value = '-- just a comment, no blocks'; })()`);
    await ev(`document.querySelector('#mEncGo').click()`); await wait(500);
    const none = await ev(`({ hidden: document.querySelector('#mEncOut').hidden, log: document.querySelector('#mEncLog').textContent })`);
    ok('a script with nothing to encode says so and shows no string', none.hidden === true && /Nothing in that script/.test(none.log), JSON.stringify(none));

    // Clear resets it
    await ev(`document.querySelector('#mEncClear').click()`);
    ok('Clear empties the box, the result and the message', await ev(`document.querySelector('#mEncIn').value === '' && document.querySelector('#mEncOut').hidden && document.querySelector('#mEncLog').textContent === ''`));
    ok('the whole run had no page errors', errors.length === 0, errors.join(' | '));
  } catch (e) { console.log('FAIL test crashed -> ' + e.message); bad++; }
  finally { try { ws && ws.close(); } catch {} try { browser && browser.kill(); } catch {} server.kill(); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
