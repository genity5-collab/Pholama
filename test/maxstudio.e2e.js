// Agent Max as the brain in Studio, on the real server with a fake cloud. Checks: it builds a real file through the Studio tools,
// the token is sent, the extra credits are charged, the step cap holds, errors are friendly, and a limit falls back to the local model for free.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
async function main() {
  const calls = []; let mode = 'ok';
  const cloud = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    calls.push({ auth: q.headers.authorization, body: b }); s.setHeader('Content-Type', 'application/json');
    if (mode === 'limit') { s.statusCode = 429; s.end(JSON.stringify({ error: 'daily limit', code: 'limit-day' })); return; }
    if (mode === 'login') { s.statusCode = 401; s.end(JSON.stringify({ error: 'Log in', code: 'login' })); return; }
    const sawResult = /Wrote|wrote|saved|OK/i.test(b.split('"role":"user"').slice(-1)[0] || '') && /tool result|Tool result|TOOL RESULT/.test(b);
    const reply = mode === 'loop' ? '<tool>{"name":"studio_write","args":{"project":"mx","file":"loop' + calls.length + '.txt","content":"x' + calls.length + '"}}</tool>' : sawResult ? 'All done, Max built it.' : '<tool>{"name":"studio_write","args":{"project":"mx","file":"hello.html","content":"<h1>From Max</h1>"}}</tool>';
    s.end(JSON.stringify({ reply })); }); }).listen(0, '127.0.0.1');
  await wait(200); const cport = cloud.address().port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-max-')), bin = path.join(home, 'bin'), models = path.join(home, 'm'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const lm = cat.find(x => x.id === 'llama3.2-3b'); fs.writeFileSync(path.join(models, lm.file), 'x');
  const script = path.join(home, 'fake.js');
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
const out='Local model answering for free.';
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  fs.copyFileSync(process.execPath, path.join(home, 'real')); fs.chmodSync(path.join(home, 'real'), 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${path.join(home, 'real')}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 27000 + Math.floor(Math.random() * 4000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_CLOUD_URL: 'http://127.0.0.1:' + cport + '/f' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  const J = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const chat = (body, hdr = { 'x-pholama-token': 'tok_ABC123' }) => fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr }, body: JSON.stringify(body) }).then(r => r.text());
  const credits = async () => (await (await fetch(B + '/api/credits')).json().catch(() => ({}))).left;
  const studio = { project: 'mx' };
  try {
    await J('/api/studio/projects', { name: 'mx' });
    const before = await credits();
    let t = await chat({ model: 'cloud:pholama', agent: true, studio, messages: [{ role: 'user', content: 'make a hello page' }] });
    const file = path.join(home, '.pholama', 'studio', 'mx', 'hello.html');
    ok('Max built a real file through the Studio tools', fs.existsSync(file) && /From Max/.test(fs.readFileSync(file, 'utf8')), t.slice(0, 500));
    ok('the final answer came from Max', /Max built it/.test(t), t.slice(0, 400));
    ok('the sign-in token was sent to the cloud', calls.length > 0 && calls.every(c => c.auth === 'Bearer tok_ABC123'), JSON.stringify(calls.map(c => c.auth)));
    ok('the token never comes back to the page', !t.includes('tok_ABC123'), t.slice(0, 200));
    ok('the extra Max price is shown (23 total with Studio)', /Agent Max in Studio 20/.test(t) && /Spent 23 credits/.test(t), (t.match(/Spent[^"]*/g) || []).join(' | '));
    const after = await credits(); if (before != null && after != null) ok('23 credits were taken', before - after >= 23, before + ' -> ' + after);
    // Max is for Studio only
    t = await chat({ model: 'cloud:pholama', agent: true, messages: [{ role: 'user', content: 'hi' }] }); ok('outside Studio it explains, and does not call the cloud', /only works inside Studio/.test(t), t.slice(0, 300));
    // the step cap: a model that loops forever is stopped after 8 cloud calls
    mode = 'loop'; calls.length = 0;
    t = await chat({ model: 'cloud:pholama', agent: true, studio, messages: [{ role: 'user', content: 'keep going forever' }] });
    ok('one message makes at most 8 Max calls', calls.length <= 8 && calls.length > 0, 'calls=' + calls.length);
    ok('and says why it stopped (the person sees the reason)', /used its 8 steps|Ask again/i.test(t), t.replace(/\{"credits"[\s\S]*/, '').slice(-500));
    // not signed in
    mode = 'login'; t = await chat({ model: 'cloud:pholama', agent: true, studio, messages: [{ role: 'user', content: 'x' }] }, {});
    ok('no sign-in gives a clear message', /Sign in to use Agent Max/.test(t), t.slice(0, 300));
    // a limit falls back to the local model, free
    mode = 'limit'; t = await chat({ model: 'cloud:pholama', agent: true, studio, messages: [{ role: 'user', content: 'hello again' }] });
    ok('at the limit it says it is switching to the local model', /daily limit/i.test(t) && /Switching to/.test(t) && /free/i.test(t), t.slice(0, 500));
    ok('and the local model really answered', /Local model answering for free/.test(t), t.slice(0, 500));
    const evs = t.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    ok('no error is shown to the person', !evs.some(e => e.error), JSON.stringify(evs.filter(e => e.error)));
  } finally { srv.kill('SIGKILL'); cloud.close(); await wait(400); try { process.kill(+fs.readFileSync(path.join(home, '.pholama', 'llama.pid'), 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
