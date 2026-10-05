// End to end on the REAL server (fake engine, no model): pictures, pasted code and Studio cost integration credits,
// the amounts are right, a page cannot lie about them, and with too few credits the chat STILL works (local chat stays free).
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-price-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const script = path.join(home, 'fake-engine.js');
  fs.writeFileSync(script, `const http=require('http');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}if(/stream/.test(b)&&/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:'ok'}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}s.end(JSON.stringify({choices:[{message:{content:'ok'}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
  const left = async () => (await (await fetch(B + '/api/credits')).json()).left;
  const chat = async body => { const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gguf:' + m.id, agent: true, switches: { thinking: false }, ...body }) }); const t = await r.text(); return { status: r.status, text: t }; };
  const spentIn = t => { const s = []; for (const l of t.split('\n')) { try { const j = JSON.parse(l); if (j.credits && j.credits.spent != null) s.push(j.credits.spent); } catch {} } return s; };
  const msg = c => [{ role: 'user', content: c }];
  try {
    const start = await left(); ok('starts with credits', start > 50, start);
    let b = await left(); let r = await chat({ messages: msg('hello') }); let a = await left();
    ok('a plain message costs nothing extra', spentIn(r.text).length === 0 && a === b, [b, a, r.text.slice(0, 200)]);
    b = await left(); r = await chat({ messages: msg('what is this?'), images: 2 }); a = await left();
    ok('2 pictures cost 10', b - a === 10 && spentIn(r.text).includes(10), [b, a, spentIn(r.text)]);
    b = await left(); r = await chat({ messages: msg('x'), images: 99 }); a = await left();
    ok('a page claiming 99 pictures is capped at 4 (20)', b - a === 20, [b, a]);
    b = await left(); r = await chat({ messages: msg('x'), images: -5 }); a = await left();
    ok('a negative picture count costs nothing (and does not give credits)', a === b, [b, a]);
    b = await left(); r = await chat({ messages: msg('x'), images: 'lots' }); a = await left();
    ok('a junk picture count costs nothing', a === b, [b, a]);
    const code = '```js\n' + 'const a = 1;\n'.repeat(250) + '```';   // about 3250 chars -> 4 x 2 = 8
    b = await left(); r = await chat({ messages: msg('fix this\n' + code) }); a = await left();
    ok('pasted code costs by size (about 3250 chars = 8)', b - a === 8, [b, a, spentIn(r.text)]);
    b = await left(); r = await chat({ messages: msg('```\nx=1\n```') }); a = await left();
    ok('tiny pasted code costs the minimum (2)', b - a === 2, [b, a]);
    b = await left(); r = await chat({ messages: msg('```\n' + 'x'.repeat(500000) + '\n```') }); a = await left();
    ok('huge pasted code is capped at 30', b - a === 30, [b, a]);
    b = await left(); r = await chat({ messages: msg('Dear diary. ' + 'I had a long day and wrote many words about it. '.repeat(80)) }); a = await left();
    ok('a long essay with no code is free', a === b, [b, a]);
    // the page cannot lie: it sends no price, only counts; a fake "price" field is ignored
    b = await left(); r = await chat({ messages: msg('x'), images: 1, price: 0, cost: 0, credits: 9999 }); a = await left();
    ok('sending a fake price changes nothing (still 5)', b - a === 5, [b, a]);
    b = await left(); r = await chat({ messages: msg('make a page'), studio: { project: 'price-test' } }); a = await left();
    ok('a Studio message costs 3', b - a === 3 && spentIn(r.text).includes(3), [b, a, spentIn(r.text)]);
    b = await left(); r = await chat({ messages: msg('what does this project do?'), studio: { project: 'price-test' } }); a = await left();
    ok('a chat question in Studio costs 1', b - a === 1, [b, a]);
    b = await left(); r = await chat({ messages: msg('make a whole shop website with login, a dashboard and a cart'), studio: { project: 'price-test' } }); a = await left();
    ok('a big task in Studio costs 4', b - a === 4, [b, a]);
    b = await left(); r = await chat({ messages: msg('make a page'), studio: { project: 'price-test' }, images: 1 }); a = await left();
    ok('Studio + 1 picture adds up (3 + 5 = 8)', b - a === 8, [b, a]);
    b = await left(); r = await chat({ messages: msg('hello'), studio: {} }); a = await left();
    ok('a Studio object with no project is not Studio (free)', a === b, [b, a]);
    // not enough credits: the chat still answers, the extra is skipped, nothing goes negative
    let drain = 0; while ((await left()) > 3 && drain++ < 60) await chat({ messages: msg('x'), images: 4 });
    const low = await left(); r = await chat({ messages: msg('still here?'), images: 4 }); a = await left();
    ok('with too few credits the chat still gets an answer', r.status === 200 && /ok/.test(r.text), r.text.slice(0, 300));
    ok('and the missing credits are explained', /Not enough credits/.test(r.text), r.text.slice(0, 300));
    ok('and credits never go below zero', a >= 0 && a <= low, [low, a]);
    const z = await left(); r = await chat({ messages: msg('plain, no extras') });
    ok('at (almost) zero credits plain chat is still free', r.status === 200 && /ok/.test(r.text) && (await left()) === z, r.text.slice(0, 200));
  } finally { srv.kill('SIGKILL'); await wait(400); const pf = path.join(home, '.pholama', 'llama.pid'); try { process.kill(+fs.readFileSync(pf, 'utf8'), 'SIGKILL'); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
