// Studio must not say "I added X" when no file was written. Real server, fake model whose answers are scripted by the test.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b') || cat.find(x => (x.tags || []).includes('tools'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-claim-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const script = path.join(home, 'fake-engine.js'), scriptFile = path.join(home, 'script.json');
  // Each request takes the NEXT scripted answer. An answer is either plain text or a tool call in the <tool_call> form the host understands.
  fs.writeFileSync(script, `const http=require('http'),fs=require('fs');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];const F=${JSON.stringify(scriptFile)};
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
let st={i:0,answers:['ok']};try{st=JSON.parse(fs.readFileSync(F,'utf8'))}catch{}const out=st.answers[Math.min(st.i,st.answers.length-1)];st.i++;try{fs.writeFileSync(F,JSON.stringify(st))}catch{}
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 500))); if (!c) bad++; };
  const script_ = answers => fs.writeFileSync(scriptFile, JSON.stringify({ i: 0, answers }));
  const say = async (q, project) => { const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, switches: { thinking: false }, studio: project ? { project } : undefined, messages: [{ role: 'user', content: q }] }) }); const t = await r.text(); let said = ''; for (const l of t.split('\n')) { try { const j = JSON.parse(l); if (j.message && j.message.content) said += j.message.content; } catch {} } return { raw: t, said }; };
  const fileText = async name => { const j = await (await fetch(B + '/api/studio/projects/claimtest')).json().catch(() => ({})); const f = (j.files || []).find(x => x.name === name); return f ? f.content : ''; };
  const tc = (name, args) => '<tool_call>\n' + JSON.stringify({ name, arguments: args }) + '\n</tool_call>';
  try {
    await fetch(B + '/api/studio/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'claimtest' }) });
    const HONEST = /haven't changed any files/;
    await fetch(B + '/api/studio/projects/claimtest/file', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'index.html', content: '<!doctype html><html><body><h1>Hello</h1></body></html>' }) });
    // 1) the bug: the model says it added something, but it never touched a file
    script_(['I added a cooldown timer and a random message generator to the UI.']);
    let r = await say('hello, how is my page', 'claimtest');
    ok('a claim of an edit with NO file written is replaced by an honest answer', HONEST.test(r.said) && !/I added a cooldown/.test(r.said.replace(HONEST, '')), r.said);
    ok('the live log explains it', /no file was written/.test(r.raw), r.raw.slice(-300));
    // 2) the fix must not get in the way of real work: the model really edits a file through a tool, then says it did
    const before = await fileText('index.html');
    script_([tc('studio_patch', { project: 'claimtest', file: 'index.html', find: 'Hello', replace: 'Hi there' }), 'I updated the heading in index.html.']);
    r = await say('change the heading to Hi there', 'claimtest');
    if (process.env.DEBUG_CLAIM) console.log('RAW>>>\n' + r.raw.split('\n').map(l => l.slice(0, 220)).join('\n'));
    const after = await fileText('index.html');
    ok('the file was really changed on disk', after !== before && /Hi there/.test(after), after.slice(0, 160));
    ok('a real edit followed by "I updated" is kept', /I updated the heading/.test(r.said) && !HONEST.test(r.said), r.said);
    // 3) an edit that FAILED does not count as a change
    script_([tc('studio_patch', { project: 'claimtest', file: 'index.html', find: 'THIS TEXT IS NOT THERE', replace: 'x' }), 'I updated the greeting as you asked.']);
    r = await say('change the greeting', 'claimtest');
    ok('a FAILED patch followed by "I updated" is replaced', HONEST.test(r.said), r.said);
    // 4) honest answers are left alone
    script_(['Want me to add a cooldown timer? Tell me where it should go.']);
    r = await say('what could I improve', 'claimtest');
    ok('an offer or a question is NOT touched', /Want me to add a cooldown timer/.test(r.said) && !HONEST.test(r.said), r.said);
    script_(['Your page has a title and one paragraph.']);
    r = await say('describe my page', 'claimtest');
    ok('a plain description is NOT touched', /Your page has a title/.test(r.said) && !HONEST.test(r.said), r.said);
    // 5) outside Studio the AI is just chatting: never touched
    script_(['I added the numbers together and got 4.']);
    r = await say('what is 2 plus 2', null);
    ok('outside Studio the reply is never replaced', /I added the numbers/.test(r.said) && !HONEST.test(r.said), r.said);
  } catch (e) { console.log('FAIL exception ' + e.stack); bad++; }
  finally { srv.kill('SIGKILL'); try { require('child_process').execSync("pkill -9 -f fake-engine.js || true"); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main();
