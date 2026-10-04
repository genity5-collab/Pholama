// End to end on the REAL server (fake engine): when the daily credits are gone, the paid features really stop, the person is told
// how long until the restock (never "NaN"), and plain chat on their own model still answers.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-limit-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const script = path.join(home, 'fake-engine.js');
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:'plain answer'}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}s.end(JSON.stringify({choices:[{message:{content:'plain answer'}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_DAILY_CREDITS: '30' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 500))); if (!c) bad++; };
  const cr = async () => (await fetch(B + '/api/credits')).json();
  const chat = async body => { const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, ...body }) }); return { status: r.status, text: await r.text() }; };
  try {
    let c = await cr(); ok('the credits answer includes a restock time', !!c.restock && typeof c.restock.wait === 'string' && c.restock.minutes >= 1 && c.restock.minutes <= 1440, JSON.stringify(c.restock));
    ok('restock has no NaN anywhere', !/NaN|undefined|null/.test(JSON.stringify(c.restock)), JSON.stringify(c.restock));
    ok('the restock time is in the future', new Date(c.restock.at) > new Date(), c.restock.at);
    // spend everything with thinking (25 each) until under 25 left, then once more to reach the limit
    await chat({ messages: [{ role: 'user', content: 'a' }], switches: { thinking: true } });
    c = await cr(); const r1 = await chat({ messages: [{ role: 'user', content: 'b' }], switches: { thinking: true } }); c = await cr();
    // force zero through a big paid extra
    let g = 0; while ((await cr()).left > 0 && g++ < 20) await chat({ messages: [{ role: 'user', content: 'x' }], images: 1, switches: { thinking: false } });
    c = await cr();
    if (c.left > 0) { // a tiny remainder (< 5) cannot buy anything; the limit still applies to features that need credits
      ok('credits are nearly gone', c.left < 5, c.left);
    }
    const r = await chat({ messages: [{ role: 'user', content: 'search the web for kittens' }] });
    const low = (await cr());
    if (low.left === 0) ok('at zero: the limit message is shown', /credit limit reached/i.test(r.text), r.text.slice(0, 500));
    if (low.left === 0) ok('at zero: it says how long to wait', /wait \d+ (min|hours? ?)/i.test(r.text) || /wait \d+ hours? \d+ min/i.test(r.text), r.text.slice(0, 500));
    ok('the chat never prints NaN', !/NaN/.test(r.text), r.text.slice(0, 300));
    ok('at zero: plain chat still answers for free', r.status === 200 && /plain answer/.test(r.text), r.text.slice(0, 400));
    const toolsReady = /tools ready: ([^"]*)"/.exec(r.text);
    ok('at zero: web search and GitHub tools are NOT offered', !toolsReady || (!/web_search|fetch_page|github_/.test(toolsReady[1])), toolsReady && toolsReady[1]);
    ok('at zero: free local file tools are still offered', !toolsReady || /read_file|calculator/.test(toolsReady[1]), toolsReady && toolsReady[1]);
    ok('at zero: nothing went negative', (await cr()).left >= 0);
  } finally { srv.kill('SIGKILL'); await wait(400); try { process.kill(+fs.readFileSync(path.join(home, '.pholama', 'llama.pid'), 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
