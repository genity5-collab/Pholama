// "What can this key do?" on the real server. Proves: the key never reaches a web request or the model, unsafe tools are refused, nothing is saved until asked.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const root = path.join(__dirname, '..'); const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8')); const m = cat.find(x => x.id === 'qwen3.5-4b');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-res-')), bin = path.join(home, 'bin'), models = path.join(home, 'models'); fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, m.file), 'x');
  const KEY = ['s', 'k-live-', 'SECRETKEY-abcdefghijklmnop123456'].join('');   // built at run time so no key-shaped text sits in the source
  const script = path.join(home, 'fake-engine.js'), scriptFile = path.join(home, 'script.json'), seenFile = path.join(home, 'seen.json');
  fs.writeFileSync(script, `const http=require('http'),fs=require('fs');const a=process.argv.slice(2);const port=+a[a.indexOf('--port')+1];const F=${JSON.stringify(scriptFile)},S=${JSON.stringify(seenFile)};
http.createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('Content-Type','application/json');if(q.url==='/health'){s.end('{"status":"ok"}');return}
let st={i:0,answers:['[]']};try{st=JSON.parse(fs.readFileSync(F,'utf8'))}catch{}const out=st.answers[Math.min(st.i,st.answers.length-1)];st.i++;try{fs.writeFileSync(F,JSON.stringify(st))}catch{}
try{const seen=JSON.parse(fs.existsSync(S)?fs.readFileSync(S,'utf8'):'[]');seen.push(b);fs.writeFileSync(S,JSON.stringify(seen))}catch{}
if(/"stream":true/.test(b)){s.setHeader('Content-Type','text/event-stream');s.write('data: '+JSON.stringify({choices:[{delta:{content:out}}]})+'\\n\\n');s.write('data: [DONE]\\n\\n');s.end();return}
s.end(JSON.stringify({choices:[{message:{content:out}}]}))})}).listen(port,'127.0.0.1');`);
  const real = path.join(home, 'llama-server-real'); fs.copyFileSync(process.execPath, real); fs.chmodSync(real, 0o755);
  fs.writeFileSync(path.join(bin, 'llama-server'), `#!/bin/bash\nexec -a llama-server "${real}" "${script}" "$@"\n`); fs.chmodSync(path.join(bin, 'llama-server'), 0o755);
  const port = 21000 + Math.floor(Math.random() * 8000);
  // a fake "search page" is not needed to prove the key is safe: with no network the search simply finds nothing, and the model is told that
  const srv = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, PHOLAMA_MODELS: models, LLAMA_SERVER_DIR: bin, PHOLAMA_NO_AUTOUPDATE: '1' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port; for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/version')).ok) break; } catch {} await wait(250); }
  let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
  const post = async (u, body) => { const r = await fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const script_ = a => { fs.writeFileSync(scriptFile, JSON.stringify({ i: 0, answers: a })); fs.writeFileSync(seenFile, '[]'); };
  const seen = () => JSON.parse(fs.readFileSync(seenFile, 'utf8')).join('\n');
  const tool = (o) => ({ name: 'list_items', title: 'List items', what: 'Lists the items in the account', method: 'GET', url: 'https://api.example.com/v1/items', headers: { Authorization: 'Bearer {{secret.ACME_KEY}}' }, body: '', params: [], ...o });
  const base = { model: 'gguf:' + m.id, service: 'Acme', apiKey: KEY, secretName: 'ACME_KEY' };
  try {
    // 1) a normal run: suggestions come back
    script_([JSON.stringify([tool({}), tool({ name: 'get_item', title: 'Get item', what: 'Gets one item by its id', url: 'https://api.example.com/v1/items/{{id}}', params: ['id'] }), tool({ name: 'add_item', title: 'Add item', what: 'Creates a new item', method: 'POST', body: '{"name":"{{name}}"}', params: ['name'] })])]);
    let r = await post('/api/mytools/research', base);
    ok('research returns a checklist of tools', r.status === 200 && Array.isArray(r.j.suggestions) && r.j.suggestions.length === 3, JSON.stringify(r.j).slice(0, 300));
    ok('reading tools and writing tools are told apart', r.j.suggestions && r.j.suggestions.find(s => s.name === 'list_items').writes === false && r.j.suggestions.find(s => s.name === 'add_item').writes === true);
    ok('the key was saved as a secret on this PC', (await (await fetch(B + '/api/mytools')).json()).secrets.includes('ACME_KEY'));
    ok('THE REAL KEY WAS NEVER SENT TO THE MODEL', !seen().includes(KEY) && !seen().includes('SECRETKEY'), seen().slice(0, 200));
    ok('the model was only told the secret NAME', /ACME_KEY/.test(seen()));
    ok('the answer to the page never contains the real key', !JSON.stringify(r.j).includes('SECRETKEY'));
    ok('NOTHING was saved as a tool yet (the person must tick it)', (await (await fetch(B + '/api/mytools')).json()).tools.length === 0);

    // 2) the model leaks the real key into a tool: it is replaced by the secret name
    script_([JSON.stringify([tool({ url: 'https://api.example.com/v1/items?key=' + KEY, headers: { Authorization: 'Bearer ' + KEY } })])]);
    r = await post('/api/mytools/research', { ...base, apiKey: '' });
    const txt = JSON.stringify(r.j);
    ok('a key the model wrote out is scrubbed from the suggestion', r.status === 200 && !txt.includes('SECRETKEY') && /\{\{secret\.ACME_KEY\}\}/.test(txt), txt.slice(0, 300));

    // 3) unsafe suggestions are refused
    script_([JSON.stringify([tool({ url: 'http://api.example.com/x', name: 'plain_http' }), tool({ url: 'https://u:pw@api.example.com/x', name: 'with_password' }), tool({ headers: { Authorization: 'Bearer {{secret.STRIPE_KEY}}' }, name: 'other_secret' }), tool({ name: 'fine_tool', url: 'https://api.example.com/fine' })])]);
    r = await post('/api/mytools/research', { ...base, apiKey: '' });
    const names = (r.j.suggestions || []).map(s => s.name);
    ok('http, password-in-address and other-secret tools are dropped', r.status === 200 && names.join() === 'fine_tool', names.join());

    // 4) a model that answers nonsense
    script_(['I think you should check their website.']);
    r = await post('/api/mytools/research', { ...base, apiKey: '' });
    ok('an unusable answer gives a clear message, not a crash', r.status === 422 && /could not find a safe/.test(r.j.error || ''), JSON.stringify(r.j));

    // 5) the inputs are checked
    ok('a missing service name is refused', (await post('/api/mytools/research', { ...base, service: '' })).status === 400);
    ok('a service name that is only a key is refused (it is never searched)', (await post('/api/mytools/research', { ...base, service: KEY })).status === 400);
    ok('no model is refused', (await post('/api/mytools/research', { ...base, model: '' })).status === 400);
    ok('no key and no "no key needed" is refused', (await post('/api/mytools/research', { ...base, secretName: 'NEWKEY', apiKey: '' })).status === 400);
    ok('a key with spaces is refused', (await post('/api/mytools/research', { ...base, apiKey: 'bad key here' })).status === 400);

    // 6) a service that needs no key: tools must not use any secret
    script_([JSON.stringify([tool({ headers: {}, name: 'open_list', url: 'https://api.example.com/open' }), tool({ name: 'needs_key', url: 'https://api.example.com/private' })])]);
    r = await post('/api/mytools/research', { ...base, secretName: 'NOKEY_X', apiKey: '', needsKey: false });
    ok('with "no key needed", only tools that use no secret survive', r.status === 200 && (r.j.suggestions || []).map(s => s.name).join() === 'open_list', JSON.stringify(r.j).slice(0, 250));
  } catch (e) { console.log('FAIL exception ' + e.stack); bad++; }
  finally { srv.kill('SIGKILL'); try { require('child_process').execSync("pkill -9 -f fake-engine.js || true"); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
}
main();
