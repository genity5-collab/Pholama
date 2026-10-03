#!/usr/bin/env node
// Pholama local server. Zero dependencies (Node 18+).
// Backends: (1) existing Ollama at :11434  (2) llama.cpp `llama-server`
// Serves the web UI and an Ollama-compatible API on http://localhost:11435
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const https = require('https'), { spawn, execSync } = require('child_process');
const agent = require('./agent');

const PORT = +process.env.PORT || 11435;
const HOST = process.env.HOST || '127.0.0.1'; // set HOST=0.0.0.0 to chat from your phone on same WiFi
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LLAMA_PORT = 11436;
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const MODELS_DIR = process.env.PHOLAMA_MODELS || path.join(os.homedir(), '.pholama', 'models');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'models.json'), 'utf8')).local;
fs.mkdirSync(MODELS_DIR, { recursive: true });

// ---------- hardware ----------
function hardware() {
  const h = { ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), freeRamGB: +(os.freemem() / 2 ** 30).toFixed(1),
    cpu: (os.cpus()[0] || {}).model || 'unknown', cores: os.cpus().length, platform: process.platform, gpu: null, vramGB: null };
  try {
    const o = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0].split(',');
    h.gpu = o[0].trim(); h.vramGB = +(o[1] / 1024).toFixed(1);
  } catch {}
  if (!h.gpu && process.platform === 'darwin' && os.arch() === 'arm64') { h.gpu = 'Apple Silicon (unified memory)'; h.vramGB = h.ramGB; }
  return h;
}
function recommend(h) {
  const budget = h.vramGB && h.vramGB > 2 ? Math.max(h.vramGB, h.ramGB * 0.6) : h.ramGB;
  return CATALOG.map(m => ({ ...m, fits: budget >= m.minRamGB, downloaded: fs.existsSync(path.join(MODELS_DIR, m.file)) }));
}

// ---------- backends ----------
const get = (url) => new Promise((res, rej) => { http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); }).on('error', rej); });
async function ollamaUp() { try { return (await get(OLLAMA + '/api/tags')).status === 200; } catch { return false; } }

let llama = null, llamaModel = null;
function findLlamaServer() {
  const names = process.platform === 'win32' ? ['llama-server.exe'] : ['llama-server'];
  const dirs = [process.env.LLAMA_SERVER_DIR, path.join(ROOT, 'bin'), path.join(os.homedir(), '.pholama', 'bin'), ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean);
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); if (fs.existsSync(p)) return p; }
  return null;
}
async function startLlama(file) {
  if (llama && llamaModel === file) return;
  if (llama) { llama.kill(); llama = null; await new Promise(r => setTimeout(r, 500)); }
  const bin = findLlamaServer();
  if (!bin) throw new Error('llama-server not found. Install Ollama (ollama.com) OR download llama.cpp from github.com/ggml-org/llama.cpp/releases and put llama-server in ' + path.join(os.homedir(), '.pholama', 'bin'));
  const args = ['-m', path.join(MODELS_DIR, file), '--port', String(LLAMA_PORT), '-c', '4096', '-ngl', '99'];
  llama = spawn(bin, args, { stdio: 'inherit' }); llamaModel = file;
  llama.on('exit', () => { llama = null; llamaModel = null; });
  for (let i = 0; i < 120; i++) { try { if ((await get(`http://127.0.0.1:${LLAMA_PORT}/health`)).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('llama-server did not start in time');
}

// ---------- downloads ----------
const dl = {}; // id -> {done,total,status,error}
function download(m) {
  const dest = path.join(MODELS_DIR, m.file), tmp = dest + '.part';
  dl[m.id] = { done: 0, total: 0, status: 'downloading' };
  const go = (url, hops = 0) => {
    if (hops > 6) { dl[m.id] = { status: 'error', error: 'too many redirects' }; return; }
    https.get(url, { headers: { 'User-Agent': 'pholama' } }, r => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) return go(new URL(r.headers.location, url).href, hops + 1);
      if (r.statusCode !== 200) { dl[m.id] = { status: 'error', error: 'HTTP ' + r.statusCode }; return; }
      dl[m.id].total = +r.headers['content-length'] || 0;
      const f = fs.createWriteStream(tmp);
      r.on('data', c => dl[m.id].done += c.length); r.pipe(f);
      f.on('finish', () => { fs.renameSync(tmp, dest); dl[m.id].status = 'done'; });
      r.on('error', e => dl[m.id] = { status: 'error', error: e.message });
    }).on('error', e => dl[m.id] = { status: 'error', error: e.message });
  };
  go(m.url);
}


// ---------- llama.cpp auto-install ----------
const inst = { status: 'idle', error: null };
function assetPattern(h) {
  const arm = os.arch() === 'arm64';
  if (process.platform === 'win32') return h.gpu && /nvidia/i.test(h.gpu) ? /bin-win-cuda-12\.4-x64\.zip$/ : /bin-win-cpu-x64\.zip$/;
  if (process.platform === 'darwin') return arm ? /bin-macos-arm64\.tar\.gz$/ : /bin-macos-x64\.tar\.gz$/;
  if (arm) return /bin-ubuntu-arm64\.tar\.gz$/;
  return h.gpu && /nvidia/i.test(h.gpu) ? /bin-ubuntu-cuda-12\.8-x64\.tar\.gz$/ : /bin-ubuntu-x64\.tar\.gz$/;
}
async function installLlama() {
  if (inst.status === 'installing') return;
  inst.status = 'installing'; inst.error = null;
  try {
    const dir = path.join(os.homedir(), '.pholama', 'bin'); fs.mkdirSync(dir, { recursive: true });
    // /releases/latest can point at a stub release with no binaries, so scan recent releases instead
    const rels = await (await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10', { headers: { 'User-Agent': 'pholama' } })).json();
    if (!Array.isArray(rels)) throw new Error('Could not reach GitHub (rate limited?). Try again in a minute.');
    const pat = assetPattern(hardware());
    let a = null;
    for (const r of rels) { a = (r.assets || []).find(x => pat.test(x.name) && !x.name.startsWith('cudart')); if (a) break; }
    if (!a) throw new Error('No llama.cpp build found for this system');
    const buf = Buffer.from(await (await fetch(a.browser_download_url)).arrayBuffer());
    const arc = path.join(dir, a.name); fs.writeFileSync(arc, buf);
    // tar ships with Windows 10+, macOS and Linux and extracts both .tar.gz and .zip
    execSync(`tar -xf "${arc}" -C "${dir}" --strip-components=1`, { stdio: 'ignore' });
    if (!findLlamaServer()) execSync(`tar -xf "${arc}" -C "${dir}"`, { stdio: 'ignore' });
    fs.unlinkSync(arc);
    if (!findLlamaServer()) {
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
      const f = walk(dir).find(x => /llama-server(\.exe)?$/.test(x));
      if (f) process.env.LLAMA_SERVER_DIR = path.dirname(f);
    }
    if (process.platform !== 'win32') try { execSync(`chmod +x "${dir}"/llama-server 2>/dev/null || true`); } catch {}
    if (!findLlamaServer()) throw new Error('Installed, but llama-server was not found');
    inst.status = 'done';
  } catch (e) { inst.status = 'error'; inst.error = e.message; }
}

// ---------- http helpers ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// Streams ONE model turn from whichever backend serves `model`, calling onToken(text). Returns the full text.
async function streamTurn(model, messages, options, onToken, signal) {
  if (model.startsWith('ollama:')) {
    const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.slice(7), messages, options, stream: true }) });
    let buf = '', all = '';
    for await (const c of r.body) {
      buf += Buffer.from(c).toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
        try { const j = JSON.parse(l); const t = j.message && j.message.content; if (t) { all += t; onToken(t); } } catch {} }
    }
    return all;
  }
  const m = CATALOG.find(x => x.id === model.replace(/^gguf:/, ''));
  if (!m) throw new Error('Unknown model ' + model);
  if (!fs.existsSync(path.join(MODELS_DIR, m.file))) throw new Error('Model not downloaded yet');
  await startLlama(m.file);
  const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, temperature: (options || {}).temperature ?? 0.7 }) });
  let buf = '', all = '';
  for await (const c of r.body) {
    buf += Buffer.from(c).toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!l.startsWith('data:')) continue; const d = l.slice(5).trim(); if (d === '[DONE]') continue;
      try { const t = JSON.parse(d).choices[0].delta.content; if (t) { all += t; onToken(t); } } catch {}
    }
  }
  return all;
}

// Chat endpoint. Plain Ollama-style NDJSON. Extra event types: {tool:{...}} / {status:"..."} / {credits:{...}}.
async function chat(req, res, b) {
  const model = b.model || '';
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
  const line = (o) => res.write(JSON.stringify(o) + '\n');
  const t0 = Date.now(), log = (kind, text) => line({ log: { kind, text, t: +((Date.now() - t0) / 1000).toFixed(1) } });
  const ac = new AbortController(); res.on('close', () => ac.abort());
  try {
    log('step', 'Got your message. Model: ' + model.replace(/^(gguf|ollama):/, ''));
    const allow = b.agent ? agent.allowed() : { search: false, tools: false, mcp: false, thinking: false };
    if (b.agent) log('step', allow.credits ? `Credits: ${agent.credits().left} left. On: ${['search','tools','mcp','thinking'].filter(k => allow[k]).join(', ') || 'nothing'}` : 'Credits: 0 left');
    if (b.agent && !allow.credits) line({ status: 'Daily credits used up: search, tools, MCP and thinking are off. Plain local chat still works.' });
    const { tools } = await agent.buildTools(allow);
    if (tools.length) log('step', `${tools.length} tools ready: ${tools.map(t => t.name).join(', ')}`);
    const thinking = allow.thinking && agent.credits().left >= agent.COST.thinking;
    if (allow.thinking && !thinking) log('error', 'Not enough credits for thinking mode. Answering without it.');
    if (thinking) log('step', 'Thinking mode on (charged only if the model really thinks)');
    let thinkBilled = false, thinkSeen = false;
    const messages = [{ role: 'system', content: agent.systemPrompt(tools, thinking) }, ...(b.messages || []).filter(m => m.role !== 'system')];
    // Host-side routing: obvious intents run their tool before the model answers (weak models skip tool calls).
    if (tools.length) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const r0 = lastUser && agent.routeIntent(lastUser.content, tools);
      if (r0) {
        log('action', `Request looks like a job for ${r0.name}. Running it first.`);
        log('action', `${r0.name} ${JSON.stringify(r0.args)}`);
        let result; try { result = String(await agent.runTool(tools, r0.name, r0.args)); } catch (e) { result = 'Tool error: ' + e.message; }
        log(/^Tool error/.test(result) ? 'error' : 'result', result.slice(0, 300));
        line({ tool: { name: r0.name, args: r0.args, result: result.slice(0, 400) } });
        messages.push({ role: 'assistant', content: `<tool>${JSON.stringify(r0)}</tool>` }, { role: 'user', content: `Tool result for ${r0.name}:\n${result}\n\nNow answer the user's question using this result. Be brief.` });
      }
    }
    for (let round = 0; round < 5; round++) {
      // With tools on, buffer the start of the reply: if it begins with "<tool" it is a tool call (hide it),
      // otherwise flush what we have and stream the rest live.
      log('step', round === 0 ? 'Loading model and writing the reply...' : 'Writing the final answer from the tool result...');
      let acc = '', mode = tools.length ? 'undecided' : 'stream', sent = 0, first = true;
      const flush = () => { if (acc.length > sent) { line({ model, message: { role: 'assistant', content: acc.slice(sent) }, done: false }); sent = acc.length; } };
      const text = await streamTurn(model, messages, b.options, t => {
        acc += t; if (first) { first = false; log('step', 'Model is answering'); }
        if (thinking && !thinkSeen && acc.includes('<think>')) { thinkSeen = true; log('thought', 'Model is thinking...'); if (!thinkBilled && agent.spend(agent.COST.thinking)) { thinkBilled = true; log('step', `Thinking used (-${agent.COST.thinking} credits)`); } }
        if (mode === 'undecided') {
          const head = acc.trimStart();
          if (head.startsWith('<tool')) mode = 'tool';
          else if (head.length >= 5 || !'<tool'.startsWith(head)) mode = 'stream';
        }
        if (mode === 'stream') flush();
      }, ac.signal);
      const shown = sent;
      const call = tools.length ? agent.parseTool(text) : null;
      if (!call) { if (shown < text.length) line({ model, message: { role: 'assistant', content: text.slice(shown) }, done: false }); break; }
      log('action', `Model asked for ${call.name} ${JSON.stringify(call.args)}`);
      let result; try { result = String(await agent.runTool(tools, call.name, call.args)); } catch (e) { result = 'Tool error: ' + e.message; }
      log(/^Tool error/.test(result) ? 'error' : 'result', result.slice(0, 300));
      line({ tool: { name: call.name, args: call.args, result: result.slice(0, 400) } });
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Tool result for ${call.name}:\n${result}\n\nNow answer the user using this result. Do not call another tool unless you must.` });
    }
    if (thinking && !thinkSeen) log('step', 'This model did not think, so thinking was not charged. Try a bigger model.');
    log('step', `Done. ${agent.credits().left} credits left.`);
    line({ credits: agent.credits() });
    line({ model, message: { role: 'assistant', content: '' }, done: true });
  } catch (e) { line({ error: e.message, done: true }); }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
  try {
    if (p === '/api/credits') return json(res, 200, { ...agent.credits(), allowed: agent.allowed() });
    if (p === '/api/prefs' && req.method === 'POST') return json(res, 200, agent.setPrefs(await body(req)));
    if (p === '/api/mcp' && req.method === 'GET') return json(res, 200, { servers: agent.state().mcp.map(x => ({ name: x.name, url: x.url })), tools: await agent.listMcp() });
    if (p === '/api/mcp' && req.method === 'POST') return json(res, 200, { servers: agent.addMcp(await body(req)) });
    if (p === '/api/mcp' && req.method === 'DELETE') { agent.removeMcp(u.searchParams.get('name')); return json(res, 200, { ok: true }); }
    if (p === '/api/hardware') { const h = hardware(); return json(res, 200, { hardware: h, ollama: await ollamaUp(), llamaServer: !!findLlamaServer(), models: recommend(h) }); }
    if (p === '/api/tags') { // Ollama-compatible model list (ours + Ollama's)
      const list = CATALOG.filter(m => fs.existsSync(path.join(MODELS_DIR, m.file))).map(m => ({ name: 'gguf:' + m.id, model: 'gguf:' + m.id, size: m.sizeGB * 2 ** 30 }));
      if (await ollamaUp()) { try { const o = JSON.parse((await get(OLLAMA + '/api/tags')).body); for (const m of o.models || []) list.push({ ...m, name: 'ollama:' + m.name, model: 'ollama:' + m.name }); } catch {} }
      return json(res, 200, { models: list });
    }
    if (p === '/api/pull' && req.method === 'POST') { const b = await body(req); const m = CATALOG.find(x => x.id === b.id); if (!m) return json(res, 404, { error: 'unknown model' }); if (!dl[m.id] || dl[m.id].status !== 'downloading') download(m); return json(res, 200, { ok: true }); }
    if (p === '/api/install-llama' && req.method === 'POST') { installLlama(); return json(res, 200, { ok: true }); }
    if (p === '/api/install-llama/status') return json(res, 200, inst);
    if (p === '/api/pull/status') return json(res, 200, dl);
    if (p === '/api/chat' && req.method === 'POST') return chat(req, res, await body(req));
    if (p === '/api/generate' && req.method === 'POST') { // Ollama-compatible generate -> chat
      const b = await body(req); b.messages = [{ role: 'user', content: b.prompt || '' }];
      return chat(req, res, b);
    }
    // static
    let f = path.join(WEB, p === '/' ? 'index.html' : p);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } catch (e) { json(res, 500, { error: e.message }); }
});
server.listen(PORT, HOST, () => {
  const h = hardware();
  console.log(`\n  Pholama running\n  Chat UI:  http://localhost:${PORT}\n  RAM: ${h.ramGB} GB${h.gpu ? '  GPU: ' + h.gpu + (h.vramGB ? ' (' + h.vramGB + ' GB)' : '') : ''}\n  Models folder: ${MODELS_DIR}\n`);
  if (HOST !== '127.0.0.1') console.log('  Reachable on your network. Open http://<this-PC-IP>:' + PORT + ' on your phone.\n');
});
process.on('exit', () => llama && llama.kill()); process.on('SIGINT', () => { llama && llama.kill(); process.exit(); });
