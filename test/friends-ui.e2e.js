// Real Chrome: Friends tab, private chat with a picture, privacy switches, and the not-set-up-yet message. A fake Supabase lives in the page.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const docs = path.join(__dirname, '..', 'docs');
  const srv = http.createServer((q, s) => { const f = q.url.split('?')[0]; if (f === '/') { s.setHeader('Content-Type', 'text/html'); return s.end('<!doctype html><meta charset=utf8><link rel=stylesheet href=/style.css><body><div id=host></div>'); } try { const b = fs.readFileSync(path.join(docs, f)); s.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : 'text/javascript'); s.end(b); } catch { s.statusCode = 404; s.end(); } }).listen(0, '127.0.0.1'); await wait(150);
  const port = srv.address().port, dbg = 9990 + Math.floor(Math.random() * 40), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-fr-'));
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
      const UID='11111111-1111-1111-1111-111111111111', BOB='22222222-2222-2222-2222-222222222222', CAT='33333333-3333-3333-3333-333333333333', now=()=>new Date().toISOString();
      const db={ setup:true, friends:[
          {other:BOB,friend_id:1,status:'accepted',i_asked:true,name:'Bob',avatar_path:null,unread:2,last_body:'hello',last_at:now(),allow_calls:true},
          {other:CAT,friend_id:2,status:'pending',i_asked:false,name:'<img src=x onerror=window.__pwned=1>',avatar_path:null,unread:0,last_body:null,last_at:null,allow_calls:false} ],
        dms:[{id:1,sender:BOB,receiver:UID,body:'hello',media_path:null,created_at:now(),read_at:null}], uploads:[], rpcs:[], prefs:{allow_requests:true,allow_dms:true,allow_calls:true,notify:true}, prefSaves:[], notes:[] };
      window.__db=db;
      const Account={ user:()=>({id:UID}),
        storageTo: async (bucket,path,file)=>{ db.uploads.push({bucket,path,type:file.type}); return true; },
        signedUrl: async (bucket,path)=>'https://signed.example/'+bucket+'/'+path,
        rest: async (url,o={})=>{ o=o||{}; const m=(o.method||'GET').toUpperCase(); const body=o.body?JSON.parse(o.body):null;
          if(url.startsWith('rpc/')){ const name=url.slice(4); db.rpcs.push([name,body]);
            if(!db.setup) throw new Error('Could not find the function public.'+name+' in the schema cache');
            if(name==='pholama_my_social') return db.friends;
            if(name==='pholama_friend_answer'){ const f=db.friends.find(x=>x.friend_id===body.p_id); if(body.p_accept) f.status='accepted'; else db.friends=db.friends.filter(x=>x!==f); return null; }
            if(name==='pholama_friend_request'){ db.friends.push({other:'44444444-4444-4444-4444-444444444444',friend_id:9,status:'pending',i_asked:true,name:body.p_name,avatar_path:null,unread:0,last_body:null,last_at:null,allow_calls:false}); return null; }
            if(name==='pholama_friend_remove'){ db.friends=db.friends.filter(x=>x.other!==body.p_other); return null; }
            if(name==='pholama_block'){ const f=db.friends.find(x=>x.other===body.p_other); if(f) f.status='blocked'; return null; }
            return null; }
          if(url.startsWith('pholama_dms')){ if(m==='POST'){ db.dms.push({id:db.dms.length+1,created_at:now(),read_at:null,...body}); return null;} return db.dms; }
          if(url.startsWith('pholama_social_prefs')){ if(m==='POST'){ db.prefSaves.push(body); Object.assign(db.prefs,body); return null;} return [db.prefs]; }
          if(url.startsWith('pholama_notifications')) return db.notes;
          if(url.startsWith('pholama_calls')) return [];
          if(url.startsWith('pholama_communities')) return [{slug:'general',title:'General',about:'x'}];
          if(url.startsWith('pholama_profiles')) return [{user_id:UID,platform_name:'Me'}];
          if(url.startsWith('pholama_moderators')||url.startsWith('pholama_daily')||url.startsWith('pholama_warnings')||url.startsWith('pholama_rules')) return [];
          return [];
        } };
      window.__Account=Account;
      const m=await import('/platformui.js'); window.__mount=()=>m.mountPlatform(document.getElementById('host'),{Account,cfg:()=>({SUPABASE_URL:'https://x.supabase.co'}),login:()=>{}});
      await window.__mount(); return 'mounted'; })()`);
    ok('the platform screen mounts', boot === 'mounted', boot); await wait(600);
    const tab = async label => { await ev(`[...document.querySelectorAll('.platnav button')].find(b=>b.textContent==='${label}').click()`); await wait(600); };
    const names = await ev("[...document.querySelectorAll('.platnav button')].map(b=>b.textContent).join(',')");
    ok('Friends and Privacy tabs exist', /Friends/.test(names) && /Privacy/.test(names), names);
    await tab('Friends');
    const txt = () => ev("document.querySelector('.platpane').textContent");
    ok('a friend is listed with the unread count', /Bob/.test(await txt()) && /2/.test(await txt()), (await txt()).slice(0, 200));
    ok('a friend request shows Accept and Decline', await ev("[...document.querySelectorAll('.platpane button')].some(b=>/Accept/.test(b.textContent))") && await ev("[...document.querySelectorAll('.platpane button')].some(b=>/Decline/.test(b.textContent))"));
    ok('a hostile name stays text (no element, no script run)', (await ev("window.__pwned")) === undefined && (await ev("document.querySelectorAll('.platpane img').length")) === 0);
    ok('the hostile name is still shown as text', /<img src=x/.test(await txt()));
    // accept
    await ev("[...document.querySelectorAll('.platpane button')].find(b=>/Accept/.test(b.textContent)).click()"); await wait(700);
    ok('accepting calls the right database function', JSON.parse(await ev("JSON.stringify(window.__db.rpcs)")).some(r => r[0] === 'pholama_friend_answer' && r[1].p_id === 2 && r[1].p_accept === true));
    // send a request by name
    await ev("const i=document.querySelector('.platpane input'); i.value='Dana'; i.dispatchEvent(new Event('input',{bubbles:true}))");
    await ev("[...document.querySelectorAll('.platpane button')].find(b=>/Send request/i.test(b.textContent)).click()"); await wait(700);
    ok('a friend request by name goes out', JSON.parse(await ev("JSON.stringify(window.__db.rpcs)")).some(r => r[0] === 'pholama_friend_request' && r[1].p_name === 'Dana'));
    // open chat with Bob
    await ev("[...document.querySelectorAll('.platpane button')].find(b=>b.textContent==='Chat').click()"); await wait(800);
    ok('the chat opens with Bobs message', /hello/.test(await ev("document.querySelector('.platpane').textContent")) && !!(await ev("document.querySelector('.platpane textarea')")));
    ok('opening the chat marks it read', JSON.parse(await ev("JSON.stringify(window.__db.rpcs)")).some(r => r[0] === 'pholama_dm_read' && r[1].p_other === '22222222-2222-2222-2222-222222222222'));
    await ev("const ta=document.querySelector('.platpane textarea'); ta.value='hi Bob'; ta.dispatchEvent(new Event('input',{bubbles:true}))");
    await ev("window.__give=(input,name,type,bytes)=>{ const f=new File([new Uint8Array(bytes)],name,{type}); const dt=new DataTransfer(); dt.items.add(f); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); }");
    await ev("window.__give(document.querySelector('.platpane input[type=file]'),'me.png','image/png',900)"); await wait(300);
    await ev("document.querySelector('.platpane textarea').closest('.pfr-composer-wrap, .pfr-composer, div').parentElement.querySelector('button.p, button[type=button].p') ? 0 : 0");
    await ev("(()=>{ const b=[...document.querySelectorAll('.platpane button')].find(b=>b.textContent==='Send'); b.click(); })()"); await wait(900);
    const up = JSON.parse(await ev("JSON.stringify(window.__db.uploads)")), dm = JSON.parse(await ev("JSON.stringify(window.__db.dms)"));
    ok('a chat picture goes to the PRIVATE bucket in my dm folder', up.length === 1 && up[0].bucket === 'pholama-private' && /^11111111-1111-1111-1111-111111111111\/dm\/[0-9a-f-]{8,}\.png$/.test(up[0].path), JSON.stringify(up));
    const mine = dm.find(x => x.body === 'hi Bob'); ok('the message is saved from me to Bob with that file', dm.length === 2 && !!mine && mine.sender === '11111111-1111-1111-1111-111111111111' && mine.receiver === '22222222-2222-2222-2222-222222222222' && mine.media_path === up[0].path, JSON.stringify(dm));
    // links are not something the page itself decides, but the hint must be visible
    ok('the no-links hint is visible', /Links are not allowed/.test(await ev("document.querySelector('.platpane').textContent")));
    // privacy
    await tab('Privacy');
    const sw = await ev("[...document.querySelectorAll('.platpane [role=switch]')].map(s=>s.getAttribute('aria-checked')).join(',')");
    ok('four privacy switches, all on by default', sw === 'true,true,true,true', sw);
    await ev("document.querySelectorAll('.platpane [role=switch]')[2].click()"); await wait(700);
    const saved = JSON.parse(await ev("JSON.stringify(window.__db.prefSaves)"));
    ok('turning Calls off is saved to my account', saved.length === 1 && saved[0].allow_calls === false && saved[0].allow_dms === true && saved[0].user_id === '11111111-1111-1111-1111-111111111111', JSON.stringify(saved));
    // not set up
    await ev("window.__db.setup=false; window.__mount()"); await wait(700); await tab('Friends');
    ok('with the SQL missing, Friends explains it instead of crashing', /not set up/i.test(await ev("document.querySelector('.platpane').textContent")), await ev("document.querySelector('.platpane').textContent.slice(0,200)"));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) { console.log('FAIL crashed: ' + e.message); bad++; }
  ch.kill(); srv.close(); console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASSED'); process.exit(bad ? 1 : 0);
})();
