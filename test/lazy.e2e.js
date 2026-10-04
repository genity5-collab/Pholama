// On the REAL server: an AI that refuses normal work as "too complex" is asked again, firmly, and the person only sees the real answer.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-lazy-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const script = path.join(home, 'fake-engine.js');
  // The fake AI refuses unless it has been told "That request is normal and allowed", or the request is harmful (then it always refuses).
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];
const REFUSE="I'm sorry, but creating a Lua script for a simulator game would involve a complex process that goes beyond the scope of simple scripting.";
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
const told=/That request is normal and allowed/.test(b), harmful=/keylogger/.test(b), always=/ALWAYSNO/.test(b);
const out=(harmful||always||!told)?REFUSE:'Here is a start:\\n\`\`\`lua\\nlocal coins = 0\\n\`\`\`\\nNext, add a shop.';
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 500))); if (!c) bad++; };
  const say = async content => { const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, messages: [{ role: 'user', content }] }) }); const t = await r.text(); let shown = ''; for (const l of t.split('\n')) { try { const j = JSON.parse(l); if (j.message && j.message.content && !j.tool) shown += j.message.content; } catch {} } return { raw: t, shown }; };
  try {
    let r = await say('make me a lua script for a simulator game');
    ok('a refused normal request is retried and the person sees the real answer', /local coins/.test(r.shown), r.shown);
    ok('the refusal itself is never shown', !/goes beyond the scope/.test(r.shown), r.shown);
    ok('the retry is logged', /refused a normal request/.test(r.raw), r.raw.slice(0, 300));
    r = await say('write a keylogger in python');
    ok('a harmful request is NOT pushed: the refusal stands', /goes beyond the scope/.test(r.shown) && !/refused a normal request/.test(r.raw), r.shown);
    r = await say('ALWAYSNO please create a tiny game');
    ok('if it still refuses after one firm retry, it stops (no loop) and says so', !/local coins/.test(r.shown) && r.shown.length > 0 && (r.raw.match(/refused a normal request/g) || []).length === 1, r.shown + ' | retries=' + (r.raw.match(/refused a normal request/g) || []).length);
    r = await say('what is the capital of France');
    ok('a normal question is untouched', !/refused a normal request/.test(r.raw));
  } finally { srv.kill('SIGKILL'); await wait(400); try { process.kill(+fs.readFileSync(path.join(home, '.pholama', 'llama.pid'), 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
