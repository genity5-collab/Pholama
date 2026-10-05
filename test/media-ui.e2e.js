// Real Chrome: pictures and videos on posts, replies, tickets and builds. A fake Supabase lives in the page, so this tests the real screens.
const { spawn, spawnSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (spawnSync(process.env.CHROME_BIN || 'google-chrome', ['--version'], { stdio: 'ignore' }).status !== 0) { console.log('SKIPPED: Chrome is not installed here'); process.exit(0); }
  const docs = path.join(__dirname, '..', 'docs');
  const srv = http.createServer((q, s) => { const f = q.url.split('?')[0]; if (f === '/') { s.setHeader('Content-Type', 'text/html'); return s.end('<!doctype html><meta charset=utf8><link rel=stylesheet href=/style.css><body><div id=host></div>'); } try { const b = fs.readFileSync(path.join(docs, f)); s.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : 'text/javascript'); s.end(b); } catch { s.statusCode = 404; s.end(); } }).listen(0, '127.0.0.1'); await wait(150);
  const port = srv.address().port, dbg = 9950 + Math.floor(Math.random() * 40), home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mu-'));
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
      const UID='11111111-1111-1111-1111-111111111111', now=()=>new Date().toISOString(), soon=()=>new Date(Date.now()+3*3600e3).toISOString();
      const db={ posts:[], replies:[], tickets:[], tmsgs:[], projects:[], profiles:[{user_id:UID,platform_name:'Me',avatar_path:null}], uploads:[], calls:[] };
      window.__db=db;
      const Account={ user:()=>({id:UID}),
        storageTo: async (bucket,path,file)=>{ db.uploads.push({bucket,path,type:file.type}); return true; },
        storage: async (path,file)=>{ db.uploads.push({bucket:'pholama-avatars',path,type:file.type}); return true; },
        signedUrl: async (bucket,path)=>'https://signed.example/'+bucket+'/'+path,
        rest: async (url,o={})=>{ o=o||{}; const m=(o.method||'GET').toUpperCase(); const body=o.body?JSON.parse(o.body):null; db.calls.push([m,url]);
          if(url.startsWith('pholama_communities')) return [{slug:'general',title:'General',about:'x'}];
          if(url.startsWith('rpc/pholama_sweep')||url.startsWith('rpc/pholama_my_rewards')) return 0;
          if(url.startsWith('pholama_profiles')) return db.profiles;
          if(url.startsWith('pholama_moderators')) return [];
          if(url.startsWith('pholama_daily')||url.startsWith('pholama_warnings')||url.startsWith('pholama_rules')) return [];
          if(url.startsWith('pholama_reactions')) return [];
          if(url.startsWith('pholama_posts')){ if(m==='POST'){ db.posts.push({id:'p'+(db.posts.length+1),community:'general',created_at:now(),expires_at:soon(),hidden:false,edited_by_mod:false,...body}); return null;} return db.posts; }
          if(url.startsWith('pholama_post_replies')){ if(m==='POST'){ db.replies.push({id:db.replies.length+1,created_at:now(),hidden:false,...body}); return null;} return db.replies; }
          if(url.startsWith('rpc/pholama_ticket_open')){ const t={id:'t1',user_id:UID,subject:body.p_subject,category:body.p_category,status:'open',created_at:now(),updated_at:now()}; db.tickets.push(t); db.tmsgs.push({id:db.tmsgs.length+1,from_mod:false,body:body.p_body,media_path:body.p_media,created_at:now()}); return 't1'; }
          if(url.startsWith('rpc/pholama_ticket_say')){ db.tmsgs.push({id:db.tmsgs.length+1,from_mod:false,body:body.p_body,media_path:body.p_media,created_at:now()}); return null; }
          if(url.startsWith('pholama_ticket_messages')) return db.tmsgs;
          if(url.startsWith('pholama_tickets')) return db.tickets;
          if(url.startsWith('pholama_projects')){ if(m==='POST'){ db.projects.push({id:'j'+(db.projects.length+1),user_id:UID,hidden:false,created_at:now(),...body}); return null;} return db.projects; }
          return [];
        } };
      const m=await import('/platformui.js'); window.__mount=()=>m.mountPlatform(document.getElementById('host'),{Account,cfg:()=>({SUPABASE_URL:'https://x.supabase.co'}),login:()=>{}});
      await window.__mount(); return 'mounted'; })()`);
    ok('the platform screen mounts', boot === 'mounted', boot); await wait(500);
    // helper: hand a fake file to a file input and fire change
    await ev(`window.__give=(input,name,type,bytes)=>{ const f=new File([new Uint8Array(bytes)],name,{type}); const dt=new DataTransfer(); dt.items.add(f); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); }`);
    const tab = async label => { await ev(`[...document.querySelectorAll('.platnav button')].find(b=>b.textContent==='${label}').click()`); await wait(500); };
    // ---------- posts ----------
    await tab('Posts');
    ok('the post box has an Add picture or video button', await ev("!!document.querySelector('.platpane .pmed-pick, .platpane [class*=pmed]')"), await ev("document.querySelector('.platpane').innerHTML.slice(0,300)"));
    await ev("window.__give(document.querySelector('.platpane input[type=file]'),'cat.png','image/png',2000)"); await wait(300);
    ok('a chosen picture shows a preview', await ev("!!document.querySelector('.platpane img[src^=blob]')"));
    await ev("const ta=document.querySelector('.platpane textarea'); ta.value='look at my cat'; ta.dispatchEvent(new Event('input'))");
    await ev("[...document.querySelectorAll('.platpane button')].find(b=>b.textContent==='Post').click()"); await wait(800);
    const up1 = JSON.parse(await ev("JSON.stringify(window.__db.uploads)")), p1 = JSON.parse(await ev("JSON.stringify(window.__db.posts)"));
    ok('the picture is uploaded to the public bucket in my post folder', up1.length === 1 && up1[0].bucket === 'pholama-media' && /^11111111-1111-1111-1111-111111111111\/post\/[0-9a-f-]{8,}\.png$/.test(up1[0].path), JSON.stringify(up1));
    ok('the post row points at that same file', p1.length === 1 && p1[0].media_path === up1[0].path && p1[0].body === 'look at my cat', JSON.stringify(p1));
    ok('the post card draws the picture from the public address', await ev("[...document.querySelectorAll('.platfeed img')].some(i=>i.src.startsWith('https://x.supabase.co/storage/v1/object/public/pholama-media/'))"), await ev("document.querySelector('.platfeed').innerHTML.slice(0,400)"));
    // a video with no words
    await ev("window.__give(document.querySelector('.platpane input[type=file]'),'clip.mp4','video/mp4',3000)"); await wait(300);
    await ev("[...document.querySelectorAll('.platpane button')].find(b=>b.textContent==='Post').click()"); await wait(800);
    const p2 = JSON.parse(await ev("JSON.stringify(window.__db.posts)"));
    ok('a video with no words can be posted', p2.length === 2 && /\.mp4$/.test(p2[1].media_path) && p2[1].body === '', JSON.stringify(p2[1]));
    await wait(500); ok('the post card draws a video player for the public address', await ev("window.__vids.some(v=>v.startsWith('https://x.supabase.co/storage/v1/object/public/pholama-media/')&&/\\/post\\/[0-9a-f-]+\\.mp4$/.test(v))"), await ev("JSON.stringify(window.__vids)"));
    // refused files never leave the browser
    const before = JSON.parse(await ev("JSON.stringify(window.__db.uploads.length)"));
    await ev("window.__give(document.querySelector('.platpane input[type=file]'),'evil.svg','image/svg+xml',500)"); await wait(300);
    ok('an svg is refused with a plain message', /PNG, JPG, WebP or GIF/.test(await ev("document.querySelector('.platpane .err-t').textContent")), await ev("document.querySelector('.platpane .err-t').textContent"));
    await ev("window.__give(document.querySelector('.platpane input[type=file]'),'big.mp4','video/mp4',1)"); // tiny; size check uses file.size so emulate big below
    await ev("(()=>{ const f=new File([new Uint8Array(10)],'huge.mp4',{type:'video/mp4'}); Object.defineProperty(f,'size',{value:26*1024*1024}); const dt=new DataTransfer(); dt.items.add(f); const i=document.querySelector('.platpane input[type=file]'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true})); })()"); await wait(300);
    ok('a 26 MB video is refused', /under 25 MB/.test(await ev("document.querySelector('.platpane .err-t').textContent")), await ev("document.querySelector('.platpane .err-t').textContent"));
    ok('nothing refused was uploaded', JSON.parse(await ev("JSON.stringify(window.__db.uploads.length)")) === before);
    // hostile text never becomes HTML
    await ev("window.__db.posts.push({id:'px',user_id:'22222222-2222-2222-2222-222222222222',community:'general',body:'<img src=x onerror=window.__pwned=1>',media_path:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600e3).toISOString(),hidden:false})");
    await ev("window.__mount()"); await wait(500); await tab('Posts');
    ok('HTML in a post stays text', (await ev("window.__pwned")) === undefined);
    // ---------- replies (big window) ----------
    const openBtn = await ev("[...document.querySelectorAll('.platfeed button')].map(b=>b.textContent).join('|')");
    await ev("(()=>{ const b=[...document.querySelectorAll('.platfeed button')].find(b=>/Open|Reply|Chat|replies/i.test(b.textContent)); b&&b.click(); })()"); await wait(700);
    ok('the post window opens with a picture button', await ev("!!document.querySelector('dialog.bigchat [class*=pmed]')"), openBtn);
    await ev("window.__give(document.querySelector('dialog.bigchat input[type=file]'),'r.jpg','image/jpeg',1500)"); await wait(300);
    await ev("document.querySelector('dialog.bigchat textarea').value='nice'"); await ev("[...document.querySelectorAll('dialog.bigchat button')].find(b=>b.textContent==='Send').click()"); await wait(900);
    const r1 = JSON.parse(await ev("JSON.stringify(window.__db.replies)"));
    ok('a reply can carry a picture', r1.length === 1 && /\/post\/[0-9a-f-]{8,}\.jpg$/.test(r1[0].media_path) && r1[0].body === 'nice', JSON.stringify(r1));
    ok('the reply shows the picture in the window', await ev("!!document.querySelector('dialog.bigchat img')"));
    await ev("document.querySelector('dialog.bigchat .bc-x').click()"); await wait(200);
    // ---------- tickets ----------
    await tab('Support');
    await ev("window.__give(document.querySelector('.platpane input[type=file]'),'shot.png','image/png',1200)"); await wait(300);
    await ev("const i=document.querySelector('.platpane input:not([type=file])'); i.value='Something broke'; const t=document.querySelector('.platpane textarea'); t.value='See the picture, it crashes'");
    await ev("[...document.querySelectorAll('.platpane button')].find(b=>b.textContent==='Open ticket').click()"); await wait(900);
    const tu = JSON.parse(await ev("JSON.stringify(window.__db.uploads.filter(u=>/\\/ticket\\//.test(u.path)))")), tm = JSON.parse(await ev("JSON.stringify(window.__db.tmsgs)"));
    ok('the ticket screenshot goes to the PRIVATE bucket', tu.length === 1 && tu[0].bucket === 'pholama-private', JSON.stringify(tu));
    ok('the ticket message points at it', tm.length === 1 && tm[0].media_path === tu[0].path, JSON.stringify(tm));
    // ---------- builds ----------
    await tab('Projects');
    await ev("window.__give([...document.querySelectorAll('.platpane input[type=file]')].pop(),'pic.png','image/png',800)"); await wait(300);
    ok('a build video box refuses a picture', /must be an MP4 or WebM/.test(await ev("document.querySelector('.platpane .err-t').textContent")), await ev("document.querySelector('.platpane .err-t').textContent"));
    await ev("window.__give([...document.querySelectorAll('.platpane input[type=file]')].pop(),'demo.webm','video/webm',4000)"); await wait(300);
    await ev("const ins=[...document.querySelectorAll('.platpane section')][0]; ins.querySelector('input').value='My robot'; ins.querySelector('textarea').value='A tiny robot that waves hello.'");
    await ev("[...document.querySelectorAll('.platpane button')].find(b=>b.textContent==='Publish project').click()"); await wait(1000);
    const pj = JSON.parse(await ev("JSON.stringify(window.__db.projects)"));
    ok('a build is saved with its video', pj.length === 1 && /\/build\/[0-9a-f-]{8,}\.webm$/.test(pj[0].video_path), JSON.stringify(pj));
    ok('the build card draws the video for the public address', await ev("window.__vids.some(v=>v.startsWith('https://x.supabase.co/storage/v1/object/public/pholama-media/')&&/\\/build\\/[0-9a-f-]+\\.webm$/.test(v))"), await ev("JSON.stringify(window.__vids)"));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) { console.log('FAIL crashed: ' + e.message); bad++; }
  ch.kill(); srv.close(); console.log(bad ? '\n' + bad + ' FAILED' : '\nALL PASSED'); process.exit(bad ? 1 : 0);
})();
