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
  return CATALOG.map(m => ({ ...m, fits: budget >= m.minRamGB, downloaded: fs.existsSync(path.join(MODELS_DIR, m.file)), partial: fs.existsSync(path.join(MODELS_DIR, m.file) + '.part'), progress: dl[m.id] || partialInfo(m) }));
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
async function stopLlama(onlyFile) {
  if (!llama || (onlyFile && llamaModel !== onlyFile)) return;
  const p = llama; llama = null; llamaModel = null; p.kill();
  await new Promise(r => { p.once('exit', r); setTimeout(r, 2500); }); // wait so Windows releases the file lock
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
const dl = {}; // id -> {done,total,status,error,speed}
const dlReq = {}; // id -> active request (so Stop can abort it)
function download(m) {
  const dest = path.join(MODELS_DIR, m.file), tmp = dest + '.part';
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0; // resume from a stopped download
  dl[m.id] = { done: have, total: 0, status: 'downloading', speed: 0, error: null };
  let last = Date.now(), lastDone = have;
  const tick = setInterval(() => { const d = dl[m.id]; if (!d || d.status !== 'downloading') return clearInterval(tick); const now = Date.now(); d.speed = Math.round((d.done - lastDone) / ((now - last) / 1000)); last = now; lastDone = d.done; }, 1000);
  const fail = msg0 => { const msg = /aborted|ECONNRESET|socket hang up|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(String(msg0)) ? 'Connection lost. Press Download to continue where it stopped.' : msg0; clearInterval(tick); if (dl[m.id] && dl[m.id].status !== 'stopped') dl[m.id] = { ...dl[m.id], status: 'error', error: msg, speed: 0 }; };
  const go = (url, hops = 0) => {
    if (hops > 6) return fail('too many redirects');
    const headers = { 'User-Agent': 'pholama' }; if (have) headers.Range = 'bytes=' + have + '-';
    const req = (url.startsWith('http://') ? http : https).get(url, { headers }, r => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) { r.resume(); return go(new URL(r.headers.location, url).href, hops + 1); }
      if (r.statusCode === 416) { try { fs.renameSync(tmp, dest); } catch {} clearInterval(tick); dl[m.id].status = 'done'; return; } // already complete
      if (r.statusCode !== 200 && r.statusCode !== 206) { r.resume(); return fail('HTTP ' + r.statusCode); }
      const resumed = r.statusCode === 206; if (!resumed) dl[m.id].done = 0; // server ignored Range: start over
      dl[m.id].total = (+r.headers['content-length'] || 0) + (resumed ? have : 0);
      try { fs.writeFileSync(tmp + '.size', String(dl[m.id].total)); } catch {}
      const f = fs.createWriteStream(tmp, { flags: resumed ? 'a' : 'w' });
      r.on('data', c => { if (dl[m.id]) dl[m.id].done += c.length; }); r.pipe(f);
      f.on('finish', () => { if (!dl[m.id] || dl[m.id].status !== 'downloading') return; if (dl[m.id].total && dl[m.id].done < dl[m.id].total) return fail('Connection dropped. Press Download to resume.'); fs.renameSync(tmp, dest); try { fs.unlinkSync(tmp + '.size'); } catch {} clearInterval(tick); dl[m.id].status = 'done'; dl[m.id].speed = 0; });
      r.on('error', e => fail(e.message)); r.on('aborted', () => fail('Connection dropped. Press Download to resume.'));
    });
    req.on('error', e => fail(e.message)); dlReq[m.id] = req;
  };
  go(m.url);
}
function stopDownload(id) { const d = dl[id]; if (d && d.status === 'downloading') { d.status = 'stopped'; d.speed = 0; } if (dlReq[id]) { dlReq[id].destroy(); delete dlReq[id]; } }
function partialInfo(m) {
  const tmp = path.join(MODELS_DIR, m.file) + '.part'; if (!fs.existsSync(tmp)) return null;
  let total = 0; try { total = +fs.readFileSync(tmp + '.size', 'utf8') || 0; } catch {}
  return { status: 'stopped', done: fs.statSync(tmp).size, total, speed: 0, error: null };
}
async function deleteModel(m) {
  stopDownload(m.id); delete dl[m.id];
  await stopLlama(m.file);
  for (const f of [path.join(MODELS_DIR, m.file), path.join(MODELS_DIR, m.file) + '.part', path.join(MODELS_DIR, m.file) + '.part.size']) try { fs.unlinkSync(f); } catch {}
}

// ---------- llama.cpp auto-install ----------
const inst = { status: 'idle', error: null, step: '', done: 0, total: 0, speed: 0 };
let instAbort = null;
function assetPattern(h) {
  const arm = os.arch() === 'arm64';
  if (process.platform === 'win32') return h.gpu && /nvidia/i.test(h.gpu) ? /bin-win-cuda-12\.4-x64\.zip$/ : /bin-win-cpu-x64\.zip$/;
  if (process.platform === 'darwin') return arm ? /bin-macos-arm64\.tar\.gz$/ : /bin-macos-x64\.tar\.gz$/;
  if (arm) return /bin-ubuntu-arm64\.tar\.gz$/;
  return h.gpu && /nvidia/i.test(h.gpu) ? /bin-ubuntu-cuda-12\.8-x64\.tar\.gz$/ : /bin-ubuntu-x64\.tar\.gz$/;
}
function stopInstall() { if (instAbort) instAbort.abort(); }
async function installLlama() {
  if (inst.status === 'installing') return;
  Object.assign(inst, { status: 'installing', error: null, step: 'Finding the right build for your PC...', done: 0, total: 0, speed: 0 });
  instAbort = new AbortController(); const signal = instAbort.signal;
  const dir = path.join(os.homedir(), '.pholama', 'bin'); fs.mkdirSync(dir, { recursive: true });
  let arc = null;
  try {
    // /releases/latest can point at a stub release with no binaries, so scan recent releases instead
    const rels = await (await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10', { headers: { 'User-Agent': 'pholama' }, signal })).json();
    if (!Array.isArray(rels)) throw new Error('Could not reach GitHub (rate limited?). Try again in a minute.');
    const pat = assetPattern(hardware());
    let a = null;
    for (const r of rels) { a = (r.assets || []).find(x => pat.test(x.name) && !x.name.startsWith('cudart')); if (a) break; }
    if (!a) throw new Error('No llama.cpp build found for this system');
    inst.step = `Downloading ${a.name}`; inst.total = a.size || 0;
    arc = path.join(dir, a.name);
    const r = await fetch(a.browser_download_url, { signal, headers: { 'User-Agent': 'pholama' } });
    if (!r.ok) throw new Error('Download failed: HTTP ' + r.status);
    inst.total = +r.headers.get('content-length') || inst.total;
    const f = fs.createWriteStream(arc); let last = Date.now(), lastDone = 0;
    for await (const c of r.body) { if (!f.write(c)) await new Promise(ok => f.once('drain', ok)); inst.done += c.length; const now = Date.now(); if (now - last >= 1000) { inst.speed = Math.round((inst.done - lastDone) / ((now - last) / 1000)); last = now; lastDone = inst.done; } }
    await new Promise((ok, no) => f.end(e => e ? no(e) : ok()));
    inst.step = 'Unpacking...'; inst.speed = 0;
    // tar ships with Windows 10+, macOS and Linux and extracts both .tar.gz and .zip
    execSync(`tar -xf "${arc}" -C "${dir}" --strip-components=1`, { stdio: 'ignore' });
    if (!findLlamaServer()) execSync(`tar -xf "${arc}" -C "${dir}"`, { stdio: 'ignore' });
    fs.unlinkSync(arc); arc = null;
    if (!findLlamaServer()) {
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
      const f2 = walk(dir).find(x => /llama-server(\.exe)?$/.test(x));
      if (f2) process.env.LLAMA_SERVER_DIR = path.dirname(f2);
    }
    if (process.platform !== 'win32') try { execSync(`chmod +x "${dir}"/llama-server 2>/dev/null || true`); } catch {}
    if (!findLlamaServer()) throw new Error('Installed, but llama-server was not found');
    inst.status = 'done'; inst.step = 'Installed';
  } catch (e) {
    if (arc) try { fs.unlinkSync(arc); } catch {}
    if (signal.aborted) { inst.status = 'stopped'; inst.error = null; inst.step = 'Stopped'; }
    else { inst.status = 'error'; inst.error = e.message; }
  }
  inst.speed = 0; instAbort = null;
}
async function uninstallLlama() { stopInstall(); await stopLlama(); try { fs.rmSync(path.join(os.homedir(), '.pholama', 'bin'), { recursive: true, force: true }); } catch {} Object.assign(inst, { status: 'idle', error: null, step: '', done: 0, total: 0 }); }

// ---------- http helpers ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// What can this model do? Only models that really support tools get the tool prompt. Everything else is plain chat.
// Downloadable models use the tags in models.json. Ollama models report their own list from /api/show.
const capCache = {};
async function modelCaps(model) {
  if (capCache[model]) return capCache[model];
  let caps = null;
  if (model.startsWith('ollama:')) {
    try {
      const r = await fetch(OLLAMA + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.slice(7) }) });
      const j = await r.json();
      if (Array.isArray(j.capabilities)) caps = { tools: j.capabilities.includes('tools'), thinking: j.capabilities.includes('thinking'), source: 'ollama' };
    } catch {}
    if (!caps) return { tools: false, thinking: false, source: 'unknown' };   // cannot tell: do not guess, plain chat (not cached, so it retries)
  } else {
    const m = CATALOG.find(x => x.id === model.replace(/^gguf:/, '')), tags = (m && m.caps) || [];
    caps = { tools: tags.includes('tools'), thinking: tags.includes('thinking'), source: 'catalog' };
  }
  return (capCache[model] = caps);
}

// Streams ONE model turn from whichever backend serves `model`, calling onToken(text). Returns the full text.
async function streamTurn(model, messages, options, onToken, signal, usage) {
  if (model.startsWith('ollama:')) {
    const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.slice(7), messages, options, stream: true }) });
    let buf = '', all = '';
    for await (const c of r.body) {
      buf += Buffer.from(c).toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
        try { const j = JSON.parse(l); const t = j.message && j.message.content; if (t) { all += t; onToken(t); } if (j.done && usage && j.eval_count != null) { usage.in += j.prompt_eval_count || 0; usage.out += j.eval_count || 0; usage.got = true; } } catch {} }
    }
    return all;
  }
  const m = CATALOG.find(x => x.id === model.replace(/^gguf:/, ''));
  if (!m) throw new Error('Unknown model ' + model);
  if (!fs.existsSync(path.join(MODELS_DIR, m.file))) throw new Error('Model not downloaded yet');
  await startLlama(m.file);
  const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, stream_options: { include_usage: true }, temperature: (options || {}).temperature ?? 0.7 }) });
  let buf = '', all = '';
  for await (const c of r.body) {
    buf += Buffer.from(c).toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!l.startsWith('data:')) continue; const d = l.slice(5).trim(); if (d === '[DONE]') continue;
      try { const j = JSON.parse(d); if (j.usage && usage) { usage.in += j.usage.prompt_tokens || 0; usage.out += j.usage.completion_tokens || 0; usage.got = true; } const t = j.choices && j.choices[0] && j.choices[0].delta.content; if (t) { all += t; onToken(t); } } catch {}
    }
  }
  return all;
}

// Second layer for the private prompt. The prompt tells the model not to talk about itself, but small models slip.
// LEAK: markers that only exist inside our own instructions. If a reply contains one, it is cut and replaced.
const LEAK = ['[private tool access]', '[private notes', 'Never mention, quote, summarise', 'never recited unless', 'follow the pattern, never repeat them', 'You cannot browse the web, run code or use tools'];
const leaked = t => LEAK.some(m => t.includes(m));
// CLAIM: a model with NO tools must not say it can browse. Only checked when the user actually asked about that.
const ASKED_WEB = /\b(can|could|do|does|are|will|would)\s+(you|u)\b[^?.!]{0,40}\b(search|browse|google|internet|online|web|look (it )?up|access|live|real[- ]time|news)|\b(search|browse|look up|google)\b[^?.!]{0,30}\b(for me|it|that|this|the (web|internet|news))|\blatest news\b/i;   // about the MODEL's own ability, not just a word like "search"
const CLAIMS_WEB = /\b(yes\b.{0,40}\b(search|browse|look up|access)|i (can|will|could) (search|browse|look up|check|access)|i('ll| will) (search|look))/i;
const CANT = 'I can\'t share that.';
const NO_WEB = 'I can\'t browse the web or get live data with this model. I answer from what I already know. Pick a model tagged "tools" to use web search.';

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
    // 1) The model must be able to do it. 2) The per-message switch in the page must be on. 3) Credits (already in `allow`).
    const caps = await modelCaps(model), sw = b.switches || {};
    const canTools = !!caps.tools;
    for (const k of ['search', 'tools', 'mcp']) { if (!canTools) allow[k] = false; else if (sw[k] === false) allow[k] = false; }
    if (!caps.thinking || sw.thinking === false) allow.thinking = false;   // a model that cannot think gets no think prompt
    if (b.agent && !canTools) log('step', caps.source === 'unknown' ? 'Could not read this model\'s abilities, so tools are off (plain chat).' : 'This model does not support tools, so it gets a plain prompt. Pick one tagged "tools" to use search and tools.');
    if (b.agent) log('step', allow.credits ? `Credits: ${agent.credits().left} left. On: ${['search','tools','mcp','thinking'].filter(k => allow[k]).join(', ') || 'nothing'}` : 'Credits: 0 left');
    if (b.agent && !allow.credits) line({ status: 'Daily credits used up: search, tools, MCP and thinking are off. Plain local chat still works.' });
    // Memory is its own switch (set by the signed-in user in the browser). It costs credits, so it is off at 0 credits.
    const memOn = !!(b.agent && canTools && b.memory === true && allow.credits && agent.credits().left >= agent.COST.memory);
    if (b.agent && b.memory === true && !memOn) log('error', !canTools ? 'Memory is on, but this model cannot use tools, so it cannot save new memories. Saved notes are still used.' : 'Memory is on, but there are not enough credits to save new memories today.');
    const { tools } = await agent.buildTools({ ...allow, memory: memOn });
    if (tools.length) log('step', `${tools.length} tools ready: ${tools.map(t => t.name).join(', ')}`);
    const thinking = allow.thinking && agent.credits().left >= agent.COST.thinking;
    if (allow.thinking && !thinking) log('error', 'Not enough credits for thinking mode. Answering without it.');
    if (thinking) log('step', 'Thinking mode on (charged only if the model really thinks)');
    let thinkBilled = false, thinkSeen = false;
    const usage = { in: 0, out: 0, got: false }, t1 = Date.now();
    let generated = '';   // everything the model wrote this message (all turns), used only for the estimate
    const messages = [{ role: 'system', content: agent.systemPrompt(tools, thinking, b.memory === true && Array.isArray(b.memories) ? b.memories : []) }, ...(b.messages || []).filter(m => m.role !== 'system')];
    // Host-side routing: obvious intents run their tool before the model answers (weak models skip tool calls).
    if (tools.length) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const r0 = lastUser && agent.routeIntent(lastUser.content, tools);
      if (r0) {
        log('action', `Request looks like a job for ${r0.name}. Running it first.`);
        log('action', `${r0.name} ${JSON.stringify(r0.args)}`);
        let result; try { result = String(await agent.runTool(tools, r0.name, r0.args)); } catch (e) { result = 'Tool error: ' + e.message; }
        if (r0.name === 'remember_thing' && result.startsWith('SAVED:')) { line({ memory: { text: result.slice(6) } }); log('result', 'Asked your account to save: ' + result.slice(6)); result = 'Saved to memory.'; } else
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
      let cut = false;
      const lu = [...messages].reverse().find(m => m.role === 'user'), holdWeb = !tools.length && lu && ASKED_WEB.test(lu.content);   // decide before showing anything
      const flush = () => { if (cut) return; if (leaked(acc)) { cut = true; line({ model, message: { role: 'assistant', content: sent ? '\n' + CANT : CANT }, done: false }); log('step', 'Hid part of the reply that quoted private instructions.'); return; } if (acc.length > sent) { line({ model, message: { role: 'assistant', content: acc.slice(sent) }, done: false }); sent = acc.length; } };
      const text = await streamTurn(model, messages, b.options, t => {
        acc += t; if (first) { first = false; log('step', 'Model is answering'); }
        if (thinking && !thinkSeen && acc.includes('<think>')) { thinkSeen = true; log('thought', 'Model is thinking...'); if (!thinkBilled && agent.spend(agent.COST.thinking)) { thinkBilled = true; log('step', `Thinking used (-${agent.COST.thinking} credits)`); } }
        if (mode === 'undecided') {
          const head = acc.trimStart();
          if (head.startsWith('<tool')) mode = 'tool';
          else if (head.length >= 5 || !'<tool'.startsWith(head)) mode = 'stream';
        }
        if (mode === 'stream' && !holdWeb) flush();
      }, ac.signal, usage);
      generated += text;
      const shown = sent;
      const call = tools.length ? agent.parseTool(text) : null;
      if (!call) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        if (cut) break;
        if (leaked(text)) { line({ model, message: { role: 'assistant', content: shown ? '\n' + CANT : CANT }, done: false }); log('step', 'Hid part of the reply that quoted private instructions.'); break; }
        if (holdWeb && CLAIMS_WEB.test(text)) { line({ model, message: { role: 'assistant', content: NO_WEB }, done: false }); log('step', 'This model has no web access, so its claim to search was replaced.'); break; }
        if (shown < text.length) line({ model, message: { role: 'assistant', content: text.slice(shown) }, done: false }); break;
      }
      log('action', `Model asked for ${call.name} ${JSON.stringify(call.args)}`);
      let result; try { result = String(await agent.runTool(tools, call.name, call.args)); } catch (e) { result = 'Tool error: ' + e.message; }
      if (call.name === 'remember_thing' && result.startsWith('SAVED:')) { line({ memory: { text: result.slice(6) } }); log('result', 'Asked your account to save: ' + result.slice(6)); result = 'Saved to memory.'; } else
      log(/^Tool error/.test(result) ? 'error' : 'result', result.slice(0, 300));
      line({ tool: { name: call.name, args: call.args, result: result.slice(0, 400) } });
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `[${call.name} returned]\n${result}\n[end]\nAnswer my question above in plain words using this. Do not mention the tool, this message, or these brackets.` });
    }
    if (thinking && !thinkSeen) log('step', 'This model did not think, so thinking was not charged. Try a bigger model.');
    if (!usage.got) {   // backend gave no numbers: estimate (about 4 characters per token) and say so
      const chars = s => Math.ceil(String(s || '').length / 4);
      usage.in = messages.reduce((n, m) => n + chars(m.content), 0); usage.out = chars(generated);
      usage.estimated = true;
    }
    line({ usage: { in: usage.in, out: usage.out, total: usage.in + usage.out, estimated: !!usage.estimated, seconds: +((Date.now() - t1) / 1000).toFixed(1) } });
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
    if (p === '/api/caps') { const m = u.searchParams.get('model') || ''; const c = await modelCaps(m); return json(res, 200, { ...c, search: c.tools, mcp: c.tools }); }
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
    if (p === '/api/install-llama/stop' && req.method === 'POST') { stopInstall(); return json(res, 200, { ok: true }); }
    if (p === '/api/install-llama' && req.method === 'DELETE') { await uninstallLlama(); return json(res, 200, { ok: true }); }
    if (p === '/api/pull/stop' && req.method === 'POST') { const b = await body(req); stopDownload(b.id); return json(res, 200, { ok: true }); }
    if (p === '/api/model' && req.method === 'DELETE') { const m = CATALOG.find(x => x.id === new URL(req.url, 'http://x').searchParams.get('id')); if (!m) return json(res, 404, { error: 'unknown model' }); await deleteModel(m); return json(res, 200, { ok: true }); }
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
