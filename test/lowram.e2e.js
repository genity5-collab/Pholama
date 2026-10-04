// End to end on the REAL server with a fake llama-server (no model needed): how it behaves as free memory drops.
//   normal (3 GB+ free)  -> engine starts with the usual arguments, nothing extra
//   low (< 3 GB)         -> smaller context, compressed cache, fewer threads
//   engine rejects those -> starts again with plain settings, the model is never left unusable
//   critical (< 1.5 GB)  -> the engine is unloaded, and the next message explains why
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const GB = 1024 ** 3;
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen2.5-0.5b');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-lowram-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const argLog = path.join(home, 'args.log'), freeFile = path.join(home, 'free.txt'), rejectFile = path.join(home, 'reject.txt');
  fs.writeFileSync(freeFile, String(8 * GB));
  // fake engine: records how it was started; exits at once if it is told to reject the memory flags
  const script = path.join(home, 'fake-engine.js');
  fs.writeFileSync(script, `const fs=require('fs'),http=require('http');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(argLog)},JSON.stringify(a)+'\\n');
if(fs.existsSync(${JSON.stringify(rejectFile)})&&a.includes('--cache-type-k')){process.exit(2)}
const port=+a[a.indexOf('--port')+1];http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{if(q.url==='/health'){s.setHeader('Content-Type','application/json');s.end('{"status":"ok"}');return}s.setHeader('Content-Type','application/json');s.end(JSON.stringify({choices:[{message:{content:'hi'}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  const wrap = path.join(bin, 'llama-server'); fs.writeFileSync(wrap, `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(wrap, 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_FAKE_FREEMEM_FILE: freeFile, PHOLAMA_MEM_CHECK_MS: '400', PHOLAMA_SLEEP_MS: '86400000' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) bad++; };
  const starts = () => { try { return fs.readFileSync(argLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const pidf = path.join(home, '.pholama', 'llama.pid'); const enginePid = () => { try { return +fs.readFileSync(pidf, 'utf8'); } catch { return 0; } };
  const serve = async () => { const r = await fetch(B + '/api/serve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) }); return r.json().catch(() => ({})); };
  const ctxOf = a => +a[a.indexOf('-c') + 1];
  try {
    // 1. plenty of memory: exactly the usual arguments
    await serve(); await wait(1200);
    let s = starts(); ok('normal memory: engine started', s.length === 1, JSON.stringify(s));
    ok('normal memory: no extra memory flags', s[0] && !s[0].includes('--cache-type-k') && !s[0].includes('--threads'), JSON.stringify(s[0]));
    const normalCtx = s[0] && ctxOf(s[0]);
    // 2. low memory (2 GB): gentle settings
    fs.writeFileSync(freeFile, String(2 * GB)); await serve(); await wait(1500);
    s = starts(); const low = s[s.length - 1];
    ok('low memory: engine restarted gently', s.length === 2 && low.includes('--cache-type-k') && low[low.indexOf('--cache-type-k') + 1] === 'q8_0' && low.includes('--cache-type-v'), JSON.stringify(low));
    ok('low memory: fewer threads were set', low.includes('--threads'), JSON.stringify(low));
    ok('low memory: smaller chat memory', ctxOf(low) <= 2048 && ctxOf(low) <= normalCtx, 'normal ' + normalCtx + ' low ' + ctxOf(low));
    // 3. an engine that rejects the flags: must still end up running, with plain settings
    fs.writeFileSync(rejectFile, '1'); fs.writeFileSync(freeFile, String(8 * GB)); await serve(); await wait(1200);   // back to normal first
    fs.writeFileSync(freeFile, String(2.5 * GB)); const before = starts().length; await serve(); await wait(2500);
    s = starts(); const tail = s.slice(before);
    ok('rejecting engine: first try used the flags, second try was plain', tail.length >= 2 && tail[0].includes('--cache-type-k') && !tail[tail.length - 1].includes('--cache-type-k'), JSON.stringify(tail));
    const ep = enginePid(); ok('rejecting engine: a working engine is running afterwards', ep > 0 && alive(ep), 'pid ' + ep);
    fs.unlinkSync(rejectFile);
    // 4. critical memory: unloaded
    const ep2 = enginePid(); fs.writeFileSync(freeFile, String(1 * GB)); await wait(2500);
    ok('critical memory: the engine was unloaded', ep2 > 0 && !alive(ep2), 'pid ' + ep2 + ' alive=' + alive(ep2));
    // next chat loads it again and explains why
    fs.writeFileSync(freeFile, String(8 * GB));
    const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, messages: [{ role: 'user', content: 'hi' }] }) }); const txt = await r.text();
    ok('critical memory: the next message says why it had to load again', /unloaded/i.test(txt), txt.slice(0, 300));
    const ep3 = enginePid(); ok('critical memory: the next message loaded it again', ep3 > 0 && alive(ep3), 'pid ' + ep3);
  } finally { srv.kill('SIGKILL'); await wait(500); const ep = enginePid(); if (ep) try { process.kill(ep, 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
