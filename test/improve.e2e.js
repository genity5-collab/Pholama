// Improving a project that already has files, on the real server with a scripted model.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-imp-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const script = path.join(home, 'fake-engine.js'), scriptFile = path.join(home, 'script.json'), seenFile = path.join(home, 'seen.json');
  fs.writeFileSync(script, `const http=require('http'),fs=require('fs');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];const F=${JSON.stringify(scriptFile)},S=${JSON.stringify(seenFile)};
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
let st={i:0,answers:['ok']};try{st=JSON.parse(fs.readFileSync(F,'utf8'))}catch{}const out=st.answers[Math.min(st.i,st.answers.length-1)];st.i++;try{fs.writeFileSync(F,JSON.stringify(st))}catch{}
try{const seen=JSON.parse(fs.existsSync(S)?fs.readFileSync(S,'utf8'):'[]');seen.push(b);fs.writeFileSync(S,JSON.stringify(seen))}catch{}
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
  const j = (u, o) => fetch(B + u, o).then(r => r.json());
  const put = (file, content) => j('/api/studio/projects/fdg/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, content }) });
  const files = async () => Object.fromEntries(((await j('/api/studio/projects/fdg')).files || []).map(f => [f.name, f.content]));
  const script_ = a => { fs.writeFileSync(scriptFile, JSON.stringify({ i: 0, answers: a })); fs.writeFileSync(seenFile, '[]'); };
  const seen = () => JSON.parse(fs.readFileSync(seenFile, 'utf8')).join('\n');
  const say = async (msgs) => { const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, switches: { thinking: false }, studio: { project: 'fdg' }, messages: msgs }) }); const t = await r.text(); let said = ''; for (const l of t.split('\n')) { try { const x = JSON.parse(l); if (x.message && x.message.content) said += x.message.content; } catch {} } return { raw: t, said }; };
  const U = c => ({ role: 'user', content: c }), A = c => ({ role: 'assistant', content: c });
  const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Chat</title><link rel="stylesheet" href="style.css"></head><body>\n<div id="chat"></div>\n<input id="msg">\n<button id="send">Send</button>\n<script src="script.js"></script>\n</body></html>';
  const CSS = 'body{font-family:sans-serif;margin:0;padding:20px;background:#fff}\n#chat{min-height:200px;border:1px solid #ccc}\nbutton{padding:8px}\n'.repeat(3);
  const JS = "const chat=document.getElementById('chat');const msg=document.getElementById('msg');const send=document.getElementById('send');\nsend.onclick=()=>{const p=document.createElement('p');p.textContent=msg.value;chat.appendChild(p);msg.value='';};\n".repeat(3);
  const block = (f, c, l) => 'FILE: ' + f + '\n```' + l + '\n' + c + '\n```\n';
  try {
    await j('/api/studio/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'fdg' }) });
    const reset = async () => { await put('index.html', HTML); await put('style.css', CSS); await put('script.js', JS); };
    const PREV = "Improve the chatbot's UI with modern color schemes, accessibility features, and responsive design.";

    // 1) your exact transcript: a vague "ok start" after an improve request, on a project that already has files
    await reset();
    const NEWCSS = CSS.replace('background:#fff', 'background:#101522;color:#eef').replace('padding:8px', 'padding:10px 18px;border-radius:10px') + '@media(max-width:600px){body{padding:8px}}\n';
    script_([block('style.css', NEWCSS, 'css')]);
    let r = await say([U(PREV), A('Improve the chatbot\'s UI with modern color schemes.'), U('ok start')]);
    let f = await files();
    ok('"ok start" after an improve request really changes the stylesheet', /#101522/.test(f['style.css']) && /border-radius:10px/.test(f['style.css']), f['style.css'].slice(0, 120));
    ok('the page and script it did not touch are exactly as before', f['index.html'] === HTML + '\n' || f['index.html'].trim() === HTML.trim(), f['index.html'].slice(0, 80));
    ok('and the script is untouched', f['script.js'].trim() === JS.trim());
    ok('the model was shown the REAL current files', /FILE: style\.css/.test(seen()) && /#fff/.test(seen()) && /getElementById/.test(seen()), seen().slice(0, 200));
    ok('it was NOT given the click-counter example to copy', !/Clicks: /.test(seen().split('Current files')[1] || ''));
    ok('the answer says what changed and that the rest was kept', /Done\. I updated style\.css/.test(r.said) && /kept the rest/.test(r.said), r.said);
    ok('no bogus file called "bro" was created', !Object.keys(f).some(n => /bro/.test(n)), Object.keys(f));

    // 2) the model drops code: the answer is refused and your files stay
    await reset(); script_([block('script.js', 'let x=1;', 'js')]);
    r = await say([U('make the script better')]); f = await files();
    ok('a rewrite that threw most of the script away is refused', f['script.js'].trim() === JS.trim() && /did not change anything|left these alone/.test(r.said), r.said + ' | ' + f['script.js'].slice(0, 80));

    // 3) a placeholder answer is refused
    await reset(); script_([block('style.css', '/* ... rest of the code ... */\nbody{color:red}', 'css')]);
    r = await say([U('restyle the page')]); f = await files();
    ok('"rest of the code" placeholders never overwrite your file', f['style.css'].trim() === CSS.trim(), f['style.css'].slice(0, 80));

    // 4) the page loses an id the script needs: everything is put back
    await reset(); const BROKEN = HTML.replace('<button id="send">Send</button>', '<button>Send</button>').replace('<input id="msg">', '<input>');
    script_([block('index.html', BROKEN, 'html')]);
    r = await say([U('improve the page layout')]); f = await files();
    ok('a page that loses ids the script uses is undone', f['index.html'].trim() === HTML.trim() && /put everything back|put your files back|Nothing was lost|left these alone|did not change/.test(r.said), r.said + ' | ' + f['index.html'].slice(0, 80));

    // 5) it may not touch a file it was not shown (too big to show), and it may not touch a file outside the project
    await reset(); const BIGJS = "// big library\n" + "var q=1;\n".repeat(3000); await put('vendor.js', BIGJS);
    script_([block('vendor.js', 'overwritten();', 'js') + block('style.css', NEWCSS, 'css')]);
    r = await say([U('restyle it')]); f = await files();
    ok('a file that was too big to show cannot be overwritten', f['vendor.js'] === BIGJS || f['vendor.js'] === BIGJS + '\n' || !/overwritten/.test(f['vendor.js'] || ''), (f['vendor.js'] || '').slice(0, 60));
    ok('the big file was not even put in front of the model', !/var q=1;\nvar q=1;\nvar q=1;\nvar q=1;\nvar q=1;\nvar q=1;/.test(seen()));
    ok('but the allowed file is still improved', /#101522/.test(f['style.css']), f['style.css'].slice(0, 80));
    await reset(); script_([block('../evil.js', 'bad()', 'js') + block('style.css', NEWCSS, 'css')]);
    r = await say([U('restyle it')]);
    ok('a file name that escapes the project is never written', !fs.existsSync(path.join(home, '.pholama', 'studio', 'evil.js')) && !fs.existsSync(path.join(home, 'evil.js')) && !fs.existsSync(path.join(home, '.pholama', 'evil.js')));
    await j('/api/studio/projects/fdg/file', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'vendor.js' }) });

    // 6) a question about the project is never turned into a rewrite
    await reset(); script_(['It has a chat box, an input and a send button.']);
    r = await say([U('what does my page do?')]); f = await files();
    ok('a question changes no file and is answered normally', f['style.css'].trim() === CSS.trim() && f['script.js'].trim() === JS.trim() && /chat box/.test(r.said), r.said);

    // 7) nothing usable comes back: files unchanged, no fake "Done"
    await reset(); script_(['Sure! I will make it look modern and improve the design.']);
    r = await say([U('improve the design')]); f = await files();
    ok('a model that only talks changes nothing', f['style.css'].trim() === CSS.trim() && f['index.html'].trim() === HTML.trim());
    ok('and never claims it finished', !/^Done\. I updated/.test(r.said), r.said);
  } catch (e) { console.log('FAIL exception ' + e.stack); bad++; }
  finally { srv.kill('SIGKILL'); try { require('child_process').execSync("pkill -9 -f fake-engine.js || true"); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main();
