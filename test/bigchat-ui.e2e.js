// Real Chrome: the big chat window. Opens, refreshes by itself, sends with Enter, keeps your scroll spot, and never runs HTML from the network.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const docs = path.join(__dirname, '..', 'docs');
  const srv = http.createServer((q, s) => { const f = q.url.split('?')[0]; if (f === '/' ) { s.setHeader('Content-Type', 'text/html'); return s.end('<!doctype html><meta charset=utf8><link rel=stylesheet href=/style.css><body><div id=host></div>'); } try { const b = fs.readFileSync(path.join(docs, f)); s.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : 'text/javascript'); s.end(b); } catch { s.statusCode = 404; s.end(); } }).listen(0, '127.0.0.1'); await wait(150);
  const port = srv.address().port, dbg = 9900 + Math.floor(Math.random() * 40), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-bc-'));
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1000,800', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  const key = async (k, extra = {}) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0, text: k === 'Enter' ? '\r' : '', ...extra }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0 }); };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(1200);
    await ev(`(async()=>{ const m = await import('/bigchat.js'); window.__db = [{id:1,who:'Member',mine:false,text:'first',when:'now'},{id:2,who:'Moderator',mine:true,badge:'Moderator',text:'<img src=x onerror="window.__pwned=1"><b>bold</b>',when:'now'}]; window.__sent=[]; window.__loads=0;
      for (let i=3;i<40;i++) window.__db.push({id:i,who:'Member',mine:false,text:'filler message number '+i,when:'now'});
      window.__win = m.openBig({ title:'Login help', subtitle:'Waiting', header: Object.assign(document.createElement('div'),{textContent:'HEADER-NODE'}), every: 400, maxLen: 50,
        load: async()=>{ window.__loads++; return window.__db.slice(); }, send: async t=>{ if (t==='FAIL') throw new Error('Slow down. Try again in a minute.'); window.__sent.push(t); window.__db.push({id:1000+window.__sent.length,who:'You',mine:true,text:t,when:'now'}); },
        actions:[{label:'Close ticket', run: async api=>{ window.__closedTicket=1; api.close(); }}] }); })()`);
    await wait(700);
    ok('the window opens as a modal dialog', await ev("document.querySelector('dialog.bigchat')?.open === true"));
    const r = JSON.parse(await ev("(()=>{const r=document.querySelector('dialog.bigchat').getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height,vw:innerWidth,vh:innerHeight})})()"));
    ok('it is BIG (most of the screen)', r.w > r.vw * 0.8 && r.h > r.vh * 0.7, JSON.stringify(r));
    ok('the title and header node are shown', /Login help/.test(await ev("document.querySelector('.bc-title').textContent")) && /HEADER-NODE/.test(await ev("document.querySelector('.bc-head').textContent")));
    ok('all 39 messages are drawn', (await ev("document.querySelectorAll('.bc-msg').length")) === 39, await ev("document.querySelectorAll('.bc-msg').length"));
    ok('HTML inside a message is shown as plain text, never run', (await ev("window.__pwned")) === undefined && /<img src=x/.test(await ev("document.querySelectorAll('.bc-msg')[1].textContent")) && (await ev("document.querySelectorAll('.bc-list img').length")) === 0);
    ok('a moderator message carries its badge', /Moderator/.test(await ev("document.querySelectorAll('.bc-msg')[1].querySelector('.bc-badge')?.textContent || ''")));
    ok('it starts scrolled to the newest message', await ev("(()=>{const l=document.querySelector('.bc-list');return l.scrollHeight-l.scrollTop-l.clientHeight<90})()"));
    // a new message arrives from someone else while you are at the bottom: it appears and the view follows
    await ev("window.__db.push({id:500,who:'Member',mine:false,text:'LIVE-ONE',when:'now'})"); await wait(1100);
    ok('a new message arrives by itself (no reload)', /LIVE-ONE/.test(await ev("document.querySelector('.bc-list').textContent")));
    ok('and the view follows it when you were at the bottom', await ev("(()=>{const l=document.querySelector('.bc-list');return l.scrollHeight-l.scrollTop-l.clientHeight<90})()"));
    // you scroll up to read: a new message must NOT yank you down
    await ev("document.querySelector('.bc-list').scrollTop = 0"); await wait(200);
    await ev("window.__db.push({id:501,who:'Member',mine:false,text:'LIVE-TWO',when:'now'})"); await wait(1100);
    ok('reading old messages: the new one arrives but does not pull you down', /LIVE-TWO/.test(await ev("document.querySelector('.bc-list').textContent")) && (await ev("document.querySelector('.bc-list').scrollTop")) < 100, await ev("document.querySelector('.bc-list').scrollTop"));
    // no change means no repaint (does not steal focus or selection)
    const before = await ev("window.__loads"); await wait(1300); const node = await ev("(()=>{window.__mark=document.querySelector('.bc-msg'); return 1})()"); await wait(900);
    ok('it keeps polling but does not repaint when nothing changed', (await ev("window.__loads")) > before && (await ev("window.__mark === document.querySelector('.bc-msg')")));
    // sending with Enter
    await ev("document.querySelector('.bc-foot textarea').focus()"); await send('Input.insertText', { text: 'hello from me' }); await key('Enter'); await wait(800);
    ok('Enter sends the message', (await ev("window.__sent.join('|')")) === 'hello from me', await ev("window.__sent.join('|')"));
    ok('the box is emptied and the message shows at the bottom', (await ev("document.querySelector('.bc-foot textarea').value")) === '' && /hello from me/.test(await ev("document.querySelector('.bc-list').textContent")));
    ok('sending scrolls you to your own message', await ev("(()=>{const l=document.querySelector('.bc-list');return l.scrollHeight-l.scrollTop-l.clientHeight<90})()"));
    // Shift+Enter is a new line, not a send
    await send('Input.insertText', { text: 'line one' }); await key('Enter', { modifiers: 8 }); await wait(300);
    ok('Shift+Enter does not send', (await ev("window.__sent.length")) === 1, await ev("window.__sent.length"));
    await ev("document.querySelector('.bc-foot textarea').value=''");
    // the limit from the caller is applied
    ok('the length limit is applied to the box', (await ev("document.querySelector('.bc-foot textarea').maxLength")) === 50);
    // an error from the server is shown, and the text is kept so nothing is lost
    await ev("document.querySelector('.bc-foot textarea').value='FAIL'"); await key('Enter'); await wait(500);
    const eTxt = await ev("document.querySelector('.bc-err')?.textContent"), eVal = await ev("document.querySelector('.bc-foot textarea')?.value");
    ok('a server error is shown in plain words and your text is kept', /Slow down/.test(eTxt || '') && eVal === 'FAIL', JSON.stringify({ eTxt, eVal }));
    // a top-bar action runs and closes
    await ev("[...document.querySelectorAll('.bc-acts button')].find(b=>b.textContent==='Close ticket').click()"); await wait(500);
    ok('a top-bar action (Close ticket) runs', (await ev("window.__closedTicket")) === 1);
    ok('and the window is gone with its timer stopped', (await ev("document.querySelectorAll('dialog.bigchat').length")) === 0);
    const l1 = await ev("window.__loads"); await wait(1100); ok('no more polling after it closes', (await ev("window.__loads")) === l1);
    // closed ticket: no composer
    await ev(`(async()=>{ const m = await import('/bigchat.js'); window.__w2 = m.openBig({ title:'Old', canSend:false, closedText:'This ticket is closed.', load: async()=>[], send: async()=>{} }); })()`); await wait(400);
    ok('a closed conversation shows no text box, just the reason', (await ev("document.querySelectorAll('.bc-foot textarea').length")) === 0 && /closed/.test(await ev("document.querySelector('.bc-foot').textContent")));
    await key('Escape'); await wait(300);
    ok('Escape closes the window', (await ev("document.querySelectorAll('dialog.bigchat').length")) === 0, await ev("document.querySelectorAll('dialog.bigchat').length"));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } finally { try { ws.close(); } catch {} ch.kill('SIGKILL'); srv.close(); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
