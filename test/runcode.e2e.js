// End to end: a real Pholama server, a fake model that writes a Python file and then RUNS it with run_code.
// The real Python output must reach the model, and a missing language must come back as install help, not a made-up result.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const py = ['python3', 'python'].find(c => { const r = spawnSync(c, ['--version']); return !r.error && r.status === 0; });
  if (!py) { console.log('SKIPPED: Python is not installed here'); process.exit(0); }
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen2.5-1.5b') || cat.find(x => (x.caps || []).includes('tools')) || cat[0];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-rc-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'), ws = path.join(home, 'ws'); for (const d of [bin, models, ws]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const script = path.join(home, 'fake.js');
  // The fake model: step 1 writes the file, step 2 runs it, step 3 (sees TOOL RESULT text) answers. Rust is asked for separately to prove the install help path.
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
require('fs').appendFileSync(process.env.HOME+'/saw.txt', b+'\\n----\\n');
let out;
const wantsRust=/RUSTJOB/.test(b);
if(/finished in \\d+ ms with exit code 0/.test(b)) out='The program printed: '+(/answer=(\\d+)/.exec(b)||[])[0];
else if(/is not installed on this PC/.test(b)) out='It needs installing first: '+(/https?:\\/\\/\\S+/.exec(b)||[''])[0];
else if(/Created job\\.(py|rs) \\(/.test(b)) out='<tool>{"name":"run_code","args":{"path":"'+(wantsRust?'job.rs':'job.py')+'"}}</tool>';
else out='<tool>{"name":"write_file","args":{"path":"'+(wantsRust?'job.rs':'job.py')+'","content":"'+(wantsRust?'fn main(){println!(\\\\"answer=1\\\\");}':'print(\\\\"answer=\\\\" + str(6*7))')+'"}}</tool>';
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  fs.copyFileSync(process.execPath, path.join(home, 'real')); fs.chmodSync(path.join(home, 'real'), 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${path.join(home, 'real')}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 31000 + Math.floor(Math.random() * 3000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_HOME: path.join(home, '.pholama'), PHOLAMA_WORKSPACE: ws, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 700))); if (!c) bad++; };
  const chat = async q => (await (await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, tools: true, messages: [{ role: 'user', content: q }] }) })).text());
  try {
    const t = await chat('Write a python file job.py that prints the answer, then run it.'); fs.writeFileSync('/tmp/rc_stream.txt', t);
    ok('the AI wrote job.py into the workspace', fs.existsSync(path.join(ws, 'job.py')) && /answer=/.test(fs.readFileSync(path.join(ws, 'job.py'), 'utf8')), t.slice(0, 700));
    ok('run_code was called and REAL Python output came back to the model', /"name":"run_code"/.test(t) && /answer=42/.test(t), t.slice(0, 900));
    ok('the final answer uses the real output (not invented)', /The program printed: answer=42/.test(t), t.slice(0, 900));
    const r = await chat('RUSTJOB write a rust file job.rs and run it');
    const noRust = spawnSync('rustc', ['--version']).error;
    if (noRust) ok('a missing Rust toolchain comes back as install help the AI relays', /is not installed on this PC/.test(r) && /rustup\.rs/.test(r), r.slice(0, 900));
    else console.log('SKIP missing-Rust check: Rust is installed here');
  } finally { srv.kill('SIGKILL'); await wait(300); fs.rmSync(home, { recursive: true, force: true }); }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
