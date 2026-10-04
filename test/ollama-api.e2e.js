// Native Ollama API compatibility: preserve request JSON and proxy management calls only from localhost.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const root = path.join(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));
const freePort = async () => { const s = http.createServer(); await listen(s); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x || '').slice(0, 250))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-ollama-')), home = path.join(dir, 'home'); fs.mkdirSync(home);
  const received = [];
  const ollama = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      received.push({ path: req.url, method: req.method, body }); res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest', size: 123 }] }));
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.12.0' }));
      if (req.url === '/api/chat') return res.end(JSON.stringify({ echoed: body }));
      if (req.url === '/api/generate') return res.end(JSON.stringify({ echoed: body }));
      if (req.url === '/api/show') return res.end(JSON.stringify({ echoed: body, capabilities: ['tools'] }));
      if (req.url === '/api/embed') return res.end(JSON.stringify({ model: body.model, embeddings: [[1, 2, 3]] }));
      if (req.url === '/api/pull') { res.setHeader('Content-Type', 'application/x-ndjson'); return res.end('{"status":"success"}\n'); }
      if (['/api/create', '/api/copy', '/api/delete', '/api/push'].includes(req.url)) return res.end(JSON.stringify({ echoed: body }));
      res.statusCode = 404; res.end(JSON.stringify({ error: 'missing' }));
    });
  }); await listen(ollama);
  const port = await freePort(), appHome = path.join(home, '.pholama'); fs.mkdirSync(appHome);
  const proc = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { cwd: root, env: { ...process.env, HOME: home, USERPROFILE: home, PHOLAMA_HOME: appHome, PHOLAMA_NO_AUTOUPDATE: '1', PHOLAMA_NO_SCHEDULE: '1', PHOLAMA_NO_REAPER: '1', PORT: String(port), OLLAMA_URL: 'http://127.0.0.1:' + ollama.address().port }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port, call = (route, method = 'GET', body) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body == null ? {} : { body: JSON.stringify(body) }) });
  try {
    let ready = false; for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/version')).ok) { ready = true; break; } } catch {} await wait(200); }
    ok('Pholama server starts with an Ollama-compatible backend', ready);
    let r = await call('/api/ollama/tags'); let j = await r.json(); ok('native tags are passed through without Pholama prefixes', r.ok && j.models[0].name === 'llama3.2:latest', JSON.stringify(j));
    const request = { model: 'llama3.2:latest', messages: [{ role: 'user', content: 'look at this' }], images: ['BASE64'], tools: [{ type: 'function', function: { name: 'x' } }], format: 'json', keep_alive: '5m', stream: false, options: { temperature: 0.2 } };
    r = await call('/api/chat', 'POST', request); j = await r.json(); ok('unprefixed Ollama chat preserves images, tools, format, options and keep_alive', r.ok && JSON.stringify(j.echoed) === JSON.stringify(request), JSON.stringify(j.echoed));
    r = await call('/api/generate', 'POST', { model: 'llama3.2:latest', prompt: 'hello', format: 'json', keep_alive: 0, options: { seed: 9 } }); j = await r.json(); ok('native generate preserves caller fields', r.ok && j.echoed.prompt === 'hello' && j.echoed.options.seed === 9 && j.echoed.keep_alive === 0);
    r = await call('/api/show', 'POST', { model: 'llama3.2:latest', verbose: true }); j = await r.json(); ok('show forwards native model details', r.ok && j.echoed.verbose === true);
    r = await call('/api/embed', 'POST', { model: 'nomic-embed-text', input: ['one', 'two'], truncate: false }); j = await r.json(); ok('unprefixed Ollama embed route is passed through', r.ok && j.model === 'nomic-embed-text' && j.embeddings.length === 1 && received.at(-1).body.truncate === false);
    r = await call('/api/ollama/pull', 'POST', { name: 'llama3.2:latest', stream: true }); const t = await r.text(); ok('native pull streams Ollama progress', r.ok && /success/.test(t));
    for (const [route, method, body] of [['create','POST',{model:'my-model',from:'llama3.2'}], ['copy','POST',{source:'a',destination:'b'}], ['delete','DELETE',{model:'my-model'}], ['push','POST',{model:'my-model', insecure:false}]]) { r = await call('/api/ollama/' + route, method, body); j = await r.json(); ok('native ' + route + ' is supported', r.ok && j.echoed && JSON.stringify(j.echoed) === JSON.stringify(body), JSON.stringify(j)); }
    r = await call('/api/ollama/ps'); j = await r.json(); ok('native ps endpoint passes through Ollama metadata', r.ok && j.models[0].size === 123);
  } finally { proc.kill('SIGKILL'); ollama.close(); await wait(250); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
