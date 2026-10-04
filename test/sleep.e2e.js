// End to end on the REAL server: it sleeps after idle, refuses AI work while asleep, wakes with `awake`,
// and when the server is killed hard the engine is freed by the watcher. Uses a fake llama-server so no model is needed.
const http = require('http'), { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = (Array.isArray(cat) ? cat : cat.models)[0];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sleep-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  // a fake engine: it must be NAMED llama-server, answer /health, and stay alive until killed
  const script = path.join(home, 'fake-engine.js');
  fs.writeFileSync(script, `const http=require('http');const port=+process.env.FE_PORT;if(!port){return}http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{if(q.url==='/health'){s.end('{"status":"ok"}');return}s.setHeader('Content-Type','application/json');s.end(JSON.stringify({choices:[{message:{content:'hi'}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  const wrap = path.join(bin, 'llama-server'); fs.writeFileSync(wrap, `#!/bin/bash\nPORT=""; while [ $# -gt 0 ]; do if [ "$1" = "--port" ]; then PORT="$2"; fi; shift; done\nFE_PORT="$PORT" exec -a llama-server "${real}" "${script}"\n`); fs.chmodSync(wrap, 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_SLEEP_MS: '5000', PHOLAMA_SLEEP_CHECK_MS: '500', PHOLAMA_NO_OPEN: '1' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port, get = async p => (await fetch(B + p)).json(), post = async (p, b) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, json: await r.json().catch(() => ({})), text: '' }; };
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) bad++; };
  const pidf = path.join(home, '.pholama', 'llama.pid'); const enginePid = () => { try { return +fs.readFileSync(pidf, 'utf8'); } catch { return 0; } };
  try {
    ok('starts awake', (await get('/api/sleep')).asleep === false);
    const r = await fetch(B + '/api/serve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) }); const sj = await r.json().catch(() => ({}));
    await wait(1500); const ep = enginePid();
    ok('an AI engine is running', ep > 0 && alive(ep), JSON.stringify({ status: r.status, sj, ep }));
    ok('passive polling does not count as use', (await get('/api/hardware')).hardware !== undefined);
    await wait(6500);   // past the 5 second limit, with only passive calls in between
    const s = await get('/api/sleep'); ok('after idle time it went to sleep', s.asleep === true, JSON.stringify(s));
    ok('sleeping shut the AI engine down (memory freed)', !alive(ep), 'engine pid ' + ep + ' still alive');
    const c = await post('/api/chat', { model: 'gguf:' + m.id, messages: [{ role: 'user', content: 'hi' }] });
    ok('asleep: a chat is refused with a clear message', c.status === 503 && c.json.asleep === true && /pholama awake/.test(c.json.error || ''), JSON.stringify(c));
    const cli = spawnSync(process.execPath, [path.join(root, 'server', 'cli.js'), 'awake'], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 15000 });
    ok('`pholama awake` wakes it', /awake/i.test(cli.stdout + cli.stderr) && (await get('/api/sleep')).asleep === false, cli.stdout + cli.stderr);
    const cli2 = spawnSync(process.execPath, [path.join(root, 'server', 'cli.js'), 'awake'], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 15000 });
    ok('`pholama awake` when already awake says so', /already awake/i.test(cli2.stdout), cli2.stdout);
    // hard kill: start an engine again, then SIGKILL the server itself
    await fetch(B + '/api/serve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) }).catch(() => {});
    await wait(3000); const ep2 = enginePid(); ok('a new engine started after waking', ep2 > 0 && alive(ep2), 'ep2=' + ep2);
    srv.kill('SIGKILL');
    for (let i = 0; i < 20 && alive(ep2); i++) await wait(500);
    ok('server killed hard (End task): the AI engine is freed anyway', !alive(ep2), 'engine ' + ep2 + ' still running');
  } finally { try { srv.kill('SIGKILL'); } catch {} try { const p = enginePid(); if (p) process.kill(p, 'SIGKILL'); } catch {} try { fs.rmSync(home, { recursive: true, force: true }); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
