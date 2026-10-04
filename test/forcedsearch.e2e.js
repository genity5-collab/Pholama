// Regression: "search me a image of a cat" crashed with "Cannot access 'searchRan' before initialization" and searched the wrong words.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'llama3.2-3b') || cat.find(x => /llama/.test(x.id));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-fs-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  fs.writeFileSync(path.join(home, 'search.html'), '<a class="result__a" href="https://example.com/cat">Cute cat photos</a> x <a class="result__snippet" href="#">A gallery of cat pictures.</a>');
  const script = path.join(home, 'fake.js');
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
const out='Here is a gallery of cat pictures from example.com.';
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  fs.copyFileSync(process.execPath, path.join(home, 'real')); fs.chmodSync(path.join(home, 'real'), 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${path.join(home, 'real')}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 29000 + Math.floor(Math.random() * 4000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_TEST_SEARCH: path.join(home, 'search.html') }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 500))); if (!c) bad++; };
  try {
    const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, messages: [{ role: 'user', content: 'search me a image of a cat' }] }) }); const t = await r.text();
    ok('no crash', !/before initialization|Cannot access/.test(t), t);
    ok('searched for "cat image"', /"query":"cat image"/.test(t), t);
    ok('the search really returned results', /Cute cat photos|example\.com\/cat/.test(t), t);
    ok('no "could not get it right" failure', !/could not get it right/.test(t), t);
  } finally { srv.kill('SIGKILL'); await wait(400); try { process.kill(+fs.readFileSync(path.join(home, '.pholama', 'llama.pid'), 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
