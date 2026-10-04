// Live edit log: helpers, and the real server's event stream (a Studio edit shows as Working, then Done with line counts).
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
async function main() {
  const L = await import(path.join(root, 'web', 'editlog.js'));
  ok('title: file edit', L.title({ kind: 'file', tool: 'studio_patch', path: 'a.js' }) === 'Changed a.js' || /a\.js/.test(L.title({ kind: 'file', tool: 'studio_patch', path: 'a.js' })), L.title({ kind: 'file', tool: 'studio_patch', path: 'a.js' }));
  ok('title: write', L.title({ kind: 'file', tool: 'studio_write', path: 'x.html' }) === 'Wrote x.html');
  ok('title: think', /^Thinking: hmm/.test(L.title({ kind: 'think', text: 'hmm ok' })));
  ok('title: never throws on junk', L.title(null) === 'Event' && L.title({}) === 'Event');
  let list = L.mergeLive([], { kind: 'file', id: 'e1', status: 'working', path: 'a.js' });
  list = L.mergeLive(list, { kind: 'file', id: 'e2', status: 'ok', path: 'b.js' });
  ok('merge: newest first', list[0].id === 'e2' && list.length === 2);
  list = L.mergeLive(list, { kind: 'file', id: 'e1', status: 'ok', added: 3, removed: 1 });
  ok('merge: Working becomes Done in place', list.length === 2 && list[1].status === 'ok' && list[1].path === 'a.js' && list[1].added === 3, JSON.stringify(list));
  ok('merge: capped', L.mergeLive(Array.from({ length: 300 }, (_, i) => ({ t: i })), { x: 1 }, 300).length === 300);
  ok('merge: junk ignored', L.mergeLive([{ a: 1 }], null).length === 1);
  ok('detail rows show lines', JSON.stringify(L.detailRows({ kind: 'file', path: 'a.js', added: 3, removed: 1 })).includes('+3 / -1'));
  ok('working counts as waiting', L.info('working').group === 'waiting');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-ll-')); const port = 23000 + Math.floor(Math.random() * 6000);
  {
    const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
    const bin = path.join(home, 'bin'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(path.join(home, 'm'), { recursive: true }); fs.writeFileSync(path.join(home, 'm', m.file), 'x');
    const script = path.join(home, 'fake.js');
    fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
const done=/Wrote|wrote|OK|saved/i.test(b.split('"role":"user"').slice(-1)[0]||'')&&/tool result|Tool result|TOOL RESULT/.test(b);
const out=done?'All done.':'<tool>{"name":"studio_write","args":{"project":"live1","file":"t.js","content":"a\\nB\\nc\\nd\\n"}}</tool>';
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
    fs.copyFileSync(process.execPath, path.join(home, 'real')); fs.chmodSync(path.join(home, 'real'), 0o755);
    fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${path.join(home, 'real')}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  }
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: path.join(home, 'm'), LLAMA_SERVER_DIR: path.join(home, 'bin') }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  try {
    const got = []; let hello = false;
    const req = http.get(B + '/api/editlog/stream', res => { ok('stream opens as event-stream', /event-stream/.test(res.headers['content-type'] || '')); res.setEncoding('utf8'); let buf = ''; res.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); if (blk.startsWith(': hello')) hello = true; const m = /^data: (.*)$/m.exec(blk); if (m) { try { got.push(JSON.parse(m[1])); } catch {} } } }); });
    await wait(600); ok('stream says hello', hello);
    const J = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
    await J('/api/studio/projects', { name: 'live1' });
    // The server itself runs the edit when the model asks for it (fake model writes the call, then a final answer).
    // seed the file so the edit is a real change (3 lines -> 4 lines with one changed)
    await J('/api/studio/projects', { name: 'live1' });
    const sfile = path.join(home, '.pholama', 'studio', 'live1', 't.js'); fs.mkdirSync(path.dirname(sfile), { recursive: true }); fs.writeFileSync(sfile, 'a\nb\nc\n');
    const chatTxt = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, studio: { project: 'live1' }, messages: [{ role: 'user', content: 'change b to B in t.js and add a d line' }] }) }).then(r => r.text());
    await wait(800); req.destroy();
    const fe = got.filter(e => e.kind === 'file');
    ok('a live "working" entry arrived', fe.some(e => e.status === 'working' && e.path === 't.js'), JSON.stringify(got).slice(0, 300));
    const done = fe.find(e => e.status === 'ok' && e.path === 't.js' && e.id);
    ok('then a Done entry with the same id', !!done && fe.some(e => e.status === 'working' && e.id === done.id), JSON.stringify(fe));
    ok('with correct line counts (+2 / -1)', !!done && done.added === 2 && done.removed === 1, JSON.stringify(done));
  } finally { srv.kill('SIGKILL'); await wait(400); try { process.kill(+fs.readFileSync(path.join(home, '.pholama', 'llama.pid'), 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
