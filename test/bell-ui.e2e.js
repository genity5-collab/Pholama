// Real Chrome: Friends tab, private chat with a picture, privacy switches, and the not-set-up-yet message. A fake Supabase lives in the page.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const docs = path.join(__dirname, '..', 'docs');
  const srv = http.createServer((q, s) => { const f = q.url.split('?')[0]; if (f === '/') { s.setHeader('Content-Type', 'text/html'); return s.end('<!doctype html><meta charset=utf8><link rel=stylesheet href=/style.css><body><div id=host></div>'); } try { const b = fs.readFileSync(path.join(docs, f)); s.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : 'text/javascript'); s.end(b); } catch { s.statusCode = 404; s.end(); } }).listen(0, '127.0.0.1'); await wait(150);
  const port = srv.address().port, dbg = 9930 + Math.floor(Math.random() * 40), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-bl-'));
  const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1100,900', `--remote-debugging-port=${dbg}`, `--user-data-dir=${home}`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (tabs.length) break; } catch {} await wait(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : r; };
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://x.supabase.co/*' }, { urlPattern: 'https://signed.example/*' }] });
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const prevOnMsg = ws.onmessage;
    ws.onmessage = async e => { const m = JSON.parse(e.data); if (m.method === 'Fetch.requestPaused') { const u = m.params.request.url; const isVid = /\.(mp4|webm)$/.test(u); send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: isVid ? 'video/webm' : 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: isVid ? '' : PNG }); return; } prevOnMsg(e); };
 await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await wait(900);
    await ev(`(()=>{ window.__vids=[]; const orig=Document.prototype.createElement; Document.prototype.createElement=function(t,...a){ const n=orig.call(this,t,...a); if(String(t).toLowerCase()==='video'){ const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src'); Object.defineProperty(n,'src',{set(v){ window.__vids.push(v); d.set.call(n,v); },get(){ return d.get.call(n); },configurable:true}); } return n; }; })()`);
    const boot = await ev(`(async()=>{
      const UID='11111111-1111-1111-1111-111111111111', BOB='22222222-2222-2222-2222-222222222222', now=()=>new Date().toISOString();
      const db={ notes:[
          {id:3,user_id:UID,kind:'message',other:BOB,info:'<img src=x onerror=window.__pwned=1>',seen:false,created_at:now()},
          {id:2,user_id:UID,kind:'friend_request',other:BOB,info:'Bob',seen:false,created_at:now()},
          {id:1,user_id:UID,kind:'missed_call',other:BOB,info:'Bob',seen:true,created_at:now()} ],
        ring:null, rpcs:[], patches:[], deletes:0 };
      window.__db=db;
      const Account={ user:()=>({id:UID}),
        rest: async (url,o={})=>{ o=o||{}; const m=(o.method||'GET').toUpperCase(); const body=o.body?JSON.parse(o.body):null;
          if(url.startsWith('rpc/')){ db.rpcs.push([url.slice(4),body]); if(url.endsWith('pholama_my_social')) return []; return null; }
          if(url.startsWith('pholama_notifications')){ if(m==='PATCH'){ db.patches.push(body); db.notes.forEach(n=>n.seen=true); return null;} if(m==='DELETE'){ db.deletes++; db.notes=[]; return null;} return db.notes; }
          if(url.startsWith('pholama_social_prefs')) return [{allow_requests:true,allow_dms:true,allow_calls:true,notify:true}];
          if(url.startsWith('pholama_calls')){ if(url.includes('callee=eq.')) return db.ring?[db.ring]:[]; return db.ring?[db.ring]:[]; }
          if(url.startsWith('pholama_communities')) return [{slug:'general',title:'General',about:'x'}];
          if(url.startsWith('pholama_profiles')) return [{user_id:UID,platform_name:'Me'}];
          return [];
        } };
      const m=await import('/platformui.js'); window.__mount=()=>m.mountPlatform(document.getElementById('host'),{Account,cfg:()=>({SUPABASE_URL:'https://x.supabase.co'}),login:()=>{}});
      await window.__mount(); return 'mounted'; })()`);
    ok('the platform screen mounts', boot === 'mounted', boot); await wait(900);
    const badge = await ev("(document.querySelector('.plbell [class*=badge], .plbell .pcl-badge')||{}).textContent");
    ok('the bell shows 2 unread', String(badge).trim() === '2', badge + ' / ' + await ev("document.querySelector('.plbell')?.outerHTML.slice(0,300)"));
    await ev("document.querySelector('.plbell button').click()"); await wait(700);
    const list = await ev("document.querySelector('.plbell').textContent");
    ok('the bell lists the notifications in plain words', /wants to be your friend/.test(list) && /Missed call from Bob/.test(list), list.slice(0, 300));
    ok('a hostile name in a notification stays text', (await ev("window.__pwned")) === undefined && (await ev("document.querySelectorAll('.plbell img').length")) === 0);
    ok('opening the bell marks them seen', (await ev("window.__db.patches.length")) >= 1);
    await ev("[...document.querySelectorAll('.plbell button')].find(b=>/Clear/i.test(b.textContent)).click()"); await wait(600);
    ok('Clear all empties them', (await ev("window.__db.deletes")) === 1);
    // an incoming call rings and can be declined
    await ev("window.__db.ring={id:'c1',caller:'22222222-2222-2222-2222-222222222222',callee:'11111111-1111-1111-1111-111111111111',status:'ringing',offer:'{}',created_at:new Date().toISOString()}");
    let shown = false; for (let i = 0; i < 12 && !shown; i++) { await wait(1000); shown = await ev("/calling/i.test(document.body.textContent)"); }
    ok('an incoming call shows a ringing banner', shown, await ev("document.body.innerText.slice(-300)"));
    await ev("[...document.querySelectorAll('button')].find(b=>/Decline/i.test(b.textContent)).click()"); await wait(700);
    ok('declining ends the call on the server', JSON.parse(await ev("JSON.stringify(window.__db.rpcs)")).some(r => r[0] === 'pholama_call_end' && r[1].p_call === 'c1'));
    ok('the banner goes away', !(await ev("[...document.querySelectorAll('button')].some(b=>/Decline/i.test(b.textContent))")));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) { console.log('FAIL crashed: ' + e.message); bad++; }
  ch.kill(); srv.close(); console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASSED'); process.exit(bad ? 1 : 0);
})();
