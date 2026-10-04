#!/usr/bin/env node
// Pholama local server. Zero dependencies (Node 18+).
// Backends: (1) existing Ollama at :11434  (2) llama.cpp `llama-server`
// Serves the web UI and an Ollama-compatible API on http://localhost:11435
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const https = require('https'), { spawn, execSync } = require('child_process');
const agent = require('./agent');
const pricing = require('./pricing');
const ram = require('./ram');
const freeMem = () => (process.env.PHOLAMA_FAKE_FREEMEM_FILE ? (+String(require('fs').readFileSync(process.env.PHOLAMA_FAKE_FREEMEM_FILE, 'utf8')).trim() || os.freemem()) : os.freemem());   // test seam only
const sec = require('./security');

const PORT = +process.env.PORT || 11435;
const HOST = process.env.HOST || '127.0.0.1'; // set HOST=0.0.0.0 to chat from your phone on same WiFi
const providers = require('./providers'), maxcloud = require('./maxcloud'), mcp = require('./mcp');
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LLAMA_PORT = 11436;
const { fitToContext, chooseContext } = require('./fit');
const { shieldedTurn, FRIENDLY } = require('./shield');
const PIDFILE = path.join(os.homedir(), '.pholama', 'llama.pid');
// A previous Pholama that crashed or was force-killed can leave its model running. Stop that leftover before starting anything new.
function reapOrphan() {
  try {
    const pid = +fs.readFileSync(PIDFILE, 'utf8').trim(); fs.unlinkSync(PIDFILE);
    if (!pid || pid === process.pid) return;
    // Only kill it if that pid is STILL a llama-server. After a reboot the number may belong to an unrelated program.
    let name = '';
    try {
      if (process.platform === 'linux') name = fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim();
      else if (process.platform === 'win32') name = String(execSync('tasklist /FI "PID eq ' + pid + '" /FO CSV /NH', { encoding: 'utf8', timeout: 4000, windowsHide: true }));
      else name = String(execSync('ps -p ' + pid + ' -o comm=', { encoding: 'utf8', timeout: 4000, windowsHide: true }));
    } catch { return; }   // not running, or we cannot tell: do nothing
    if (/llama-server/i.test(name)) { process.kill(pid, 'SIGKILL'); console.log('  Stopped a leftover local AI from a previous run (pid ' + pid + ').'); }
  } catch {}
}
reapOrphan();
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const MODELS_DIR = process.env.PHOLAMA_MODELS || path.join(os.homedir(), '.pholama', 'models');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'models.pc.json'), 'utf8'));   // PC-only list: no phone models here
for (const m of CATALOG) { m.command = 'pholama pull ' + m.id; m.caps = [...new Set([...(m.caps || []), ...(m.categories || [])])]; }   // one place for the install command
fs.mkdirSync(MODELS_DIR, { recursive: true });

// ---------- hardware ----------
function hardware() {
  const h = { ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), freeRamGB: +(os.freemem() / 2 ** 30).toFixed(1),
    cpu: (os.cpus()[0] || {}).model || 'unknown', cores: os.cpus().length, platform: process.platform, gpu: null, vramGB: null };
  try {
    const o = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0].split(',');
    h.gpu = o[0].trim(); h.vramGB = +(o[1] / 1024).toFixed(1);
  } catch {}
  if (!h.gpu && process.platform === 'darwin' && os.arch() === 'arm64') { h.gpu = 'Apple Silicon (unified memory)'; h.vramGB = h.ramGB; }
  return h;
}
const { pickRecommended } = require('./recommend');
function recommend(h) {
  const budget = h.vramGB && h.vramGB > 2 ? Math.max(h.vramGB, h.ramGB * 0.6) : h.ramGB;
  const recId = pickRecommended(CATALOG, budget);
  return CATALOG.map(m => ({ ...m, recommended: m.id === recId, fits: budget >= m.minRamGB, downloaded: fs.existsSync(path.join(MODELS_DIR, m.file)), partial: fs.existsSync(path.join(MODELS_DIR, m.file) + '.part'), progress: dl[m.id] || partialInfo(m) }));
}

// ---------- backends ----------
const get = (url) => new Promise((res, rej) => { http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); }).on('error', rej); });
async function ollamaUp() { try { return (await get(OLLAMA + '/api/tags')).status === 200; } catch { return false; } }

let llama = null, llamaModel = null, served = null, llamaStartedAt = 0;
const ollamaUsed = new Set();   // Ollama models THIS app loaded (the only ones the lag guard may unload)
let guardNote = null;           // set when the guard stopped the local AIs, shown once in the page
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
// Stops every LOCAL model: the llama-server child and any Ollama model this app loaded. Nothing in the cloud or the browser is touched.
async function stopAllLocal() {
  const had = !!llama || ollamaUsed.size > 0 || helperEng.isUp();
  await helperEng.stop();
  await stopLlama();
  for (const m of [...ollamaUsed]) {
    try { await fetch(OLLAMA + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, keep_alive: 0 }), signal: AbortSignal.timeout(4000) }); } catch {}
  }
  ollamaUsed.clear(); llamaStartedAt = 0; served = null;
  return had;
}
// Killing right now, without waiting (used when the process is going away and cannot await anything).
function killLocalNow() {
  try { helperEng.killNow(); } catch {}
  try { if (llama) llama.kill('SIGKILL'); } catch {}
  llama = null; llamaModel = null; try { fs.unlinkSync(PIDFILE); } catch {}
}
const duoMod = require('./duo');
const helperEng = require('./helper-engine').create({ findBin: () => findLlamaServer(), modelsDir: MODELS_DIR, get: u => get(u), log: m => console.log('  ' + m) });
try { helperEng.cleanupStale(); } catch {}
let llamaCtx = 4096, llamaReady = false, startChain = Promise.resolve();
let lowRamRetry = false, lastRamLevel = 'normal', activeReplies = 0, lastReplyAt = Date.now(); const rest = { ms: 0 };   // rest.ms: short pause between replies when memory is low
// Only ONE start/restart may run at a time. Two messages arriving together used to launch two engines on the same port;
// the second one crashed ("couldn't bind") and the chat went dead. Later callers now wait their turn and re-check.
function startLlama(file) {
  const run = startChain.then(() => startLlamaNow(file));
  startChain = run.catch(() => {});   // one failure must not block the next attempt
  return run;
}
async function startLlamaNow(file) {
  const cm = CATALOG.find(x => x.file === file);
  let ctx = chooseContext(cm && cm.ctx, +(hardware().ramGB || 0));
  // Short on free memory right now? Run gentler (smaller chat memory, compressed cache, fewer threads). At 3 GB free or more nothing changes.
  const lvl = ram.levelFor(freeMem()), gentle = ram.settingsFor(lvl, ctx, (os.cpus() || []).length);
  if (lvl !== 'normal') { ctx = gentle.ctx; if (lvl !== lastRamLevel) console.log('  ' + ram.describe(lvl, freeMem())); }
  lastRamLevel = lvl; rest.ms = gentle.restMs;
  if (llama && llamaReady && llamaModel === file && llamaCtx === ctx) {
    try { if ((await get(`http://127.0.0.1:${LLAMA_PORT}/health`)).status === 200) return; } catch {}   // looks alive but is not answering: restart it
  }
  llamaReady = false;
  if (llama) { const old = llama; llama = null; old.kill(); await new Promise(r => { old.once('exit', r); setTimeout(r, 2500); }); }
  let bin = findLlamaServer();
  if (!bin) {   // first use on this PC: fetch the engine ourselves instead of sending the user to do it by hand
    await ensureEngine();
    bin = findLlamaServer();
    if (!bin) throw new Error('The AI engine (llama.cpp) could not be set up automatically' + (inst.error ? ': ' + inst.error : '') + '. Check your internet connection and try again, or install Ollama from ollama.com and leave it running.');
  }
  const baseArgs = ['-m', path.join(MODELS_DIR, file), '--port', String(LLAMA_PORT), '-c', String(ctx), '-ngl', '99', '--embeddings', '--pooling', 'mean'];
  let args = lvl === 'normal' || lowRamRetry ? baseArgs : [...baseArgs, ...ram.engineArgs(gentle)];
  llamaCtx = ctx;
  // No console window (Windows would open a black terminal for the engine) - its output goes to a log file instead.
  const logPath = path.join(os.homedir(), '.pholama', 'engine.log');
  let logFd = 'ignore';
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) fs.writeFileSync(logPath, ''); logFd = fs.openSync(logPath, 'a'); fs.writeSync(logFd, '\n--- ' + new Date().toISOString() + ' starting ' + file + '\n'); } catch {}
  llama = spawn(bin, args, { stdio: ['ignore', logFd, logFd], windowsHide: true }); lastReplyAt = Date.now(); const me0 = llama; llamaModel = file; llamaStartedAt = Date.now();
  if (typeof logFd === 'number') llama.once('spawn', () => { try { fs.closeSync(logFd); } catch {} });
  try { fs.mkdirSync(path.dirname(PIDFILE), { recursive: true }); fs.writeFileSync(PIDFILE, String(llama.pid)); } catch {}
  llama.on('exit', () => { if (llama === me0 || llama === null) { llama = null; llamaModel = null; llamaReady = false; try { fs.unlinkSync(PIDFILE); } catch {} } });
  const me = llama;
  for (let i = 0; i < 120; i++) {
    try { if ((await get(`http://127.0.0.1:${LLAMA_PORT}/health`)).status === 200) { llamaReady = true; return; } } catch {}
    if (llama !== me) break;   // the engine already exited (damaged model, out of memory): no point waiting
    await new Promise(r => setTimeout(r, i < 10 ? 300 : 1000));
  }
  // The engine died right away while running with the extra low-memory flags: an older engine may not know one of them.
  // Try once more with the plain settings so a flag can never make a model unusable.
  if (llama !== me && args !== baseArgs && !lowRamRetry) {
    console.log('  The engine did not accept the low-memory settings. Starting it again with plain settings.');
    lowRamRetry = true; try { return await startLlamaNow(file); } finally { lowRamRetry = false; }
  }
  let why = ''; try { why = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-4).join(' | ').slice(-300); } catch {}
  throw new Error((llama === me ? 'The AI engine did not start in time.' : 'The AI engine stopped right after starting (the model file may be damaged, or there is not enough free memory).') + (why ? ' Last engine message: ' + why : '') + ' Full log: ' + logPath);
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
  try { fs.rmSync(path.join(MODELS_DIR, m.id), { recursive: true, force: true }); } catch {}   // any per-model folder
  delete capCache['gguf:' + m.id];
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
    execSync(`tar -xf "${arc}" -C "${dir}" --strip-components=1`, { stdio: 'ignore', windowsHide: true });
    if (!findLlamaServer()) execSync(`tar -xf "${arc}" -C "${dir}"`, { stdio: 'ignore', windowsHide: true });
    fs.unlinkSync(arc); arc = null;
    if (!findLlamaServer()) {
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
      const f2 = walk(dir).find(x => /llama-server(\.exe)?$/.test(x));
      if (f2) process.env.LLAMA_SERVER_DIR = path.dirname(f2);
    }
    if (process.platform !== 'win32') try { execSync(`chmod +x "${dir}"/llama-server 2>/dev/null || true`, { windowsHide: true }); } catch {}
    if (!findLlamaServer()) throw new Error('Installed, but llama-server was not found');
    inst.status = 'done'; inst.step = 'Installed';
  } catch (e) {
    if (arc) try { fs.unlinkSync(arc); } catch {}
    if (signal.aborted) { inst.status = 'stopped'; inst.error = null; inst.step = 'Stopped'; }
    else { inst.status = 'error'; inst.error = e.message; }
  }
  inst.speed = 0; instAbort = null;
}
let engineWait = null;
// Installs the llama.cpp engine if it is missing. Several requests at once share ONE download.
function ensureEngine() {
  if (findLlamaServer()) return Promise.resolve();
  if (engineWait) return engineWait;
  engineWait = (async () => {
    console.log('  First use: downloading the AI engine (llama.cpp), about 30-200 MB, one time...');
    if (inst.status !== 'installing') installLlama();
    for (let i = 0; i < 1800; i++) {   // up to 15 minutes on a slow connection
      if (inst.status === 'done' || findLlamaServer()) return;
      if (inst.status === 'error' || inst.status === 'stopped') return;
      await new Promise(r => setTimeout(r, 500));
    }
  })().finally(() => { engineWait = null; });
  return engineWait;
}
async function uninstallLlama() { stopInstall(); await stopLlama(); try { fs.rmSync(path.join(os.homedir(), '.pholama', 'bin'), { recursive: true, force: true }); } catch {} Object.assign(inst, { status: 'idle', error: null, step: '', done: 0, total: 0 }); }

// ---------- http helpers ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...(res.cors || {}) }); res.end(JSON.stringify(obj)); };
// Raw body with a hard size limit (used by /mcp, which is reachable from outside). Rejects as soon as it goes over, and stops reading.
const rawBody = (req, max) => new Promise((ok, no) => { let d = '', n = 0, dead = false; req.on('data', c => { if (dead) return; n += c.length; if (n > max) { dead = true; req.destroy(); no(new Error('too large')); return; } d += c; }); req.on('end', () => { if (!dead) ok(d); }); req.on('error', e => { if (!dead) no(e); }); });
const body = (req) => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// What can this model do? Only models that really support tools get the tool prompt. Everything else is plain chat.
// Downloadable models use the tags in models.json. Ollama models report their own list from /api/show.
const capCache = {};
async function modelCaps(model) {
  if (capCache[model]) return capCache[model];
  let caps = null;
  if (model === 'cloud:pholama') return { tools: true, tier: 'good', thinking: false, source: 'max' };   // Agent Max in Studio: the cloud writes, this PC does the file work
  if (model.startsWith('byok:')) {   // your own hosted model: these all understand the tool format, so they count as a full agent
    const pv = providers.get(model.slice(5)); const tl = !!(pv && pv.tools);
    return (capCache[model] = { tools: tl, tier: tl ? 'good' : 'basic', thinking: false, source: 'byok' });
  }
  if (model.startsWith('ollama:')) {
    try {
      const r = await fetch(OLLAMA + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.slice(7) }) });
      const j = await r.json();
      if (Array.isArray(j.capabilities)) {
        const tl = j.capabilities.includes('tools'), bn = String((j.details && j.details.parameter_size) || '').toUpperCase(), bil = /M$/.test(bn) ? parseFloat(bn) / 1000 : parseFloat(bn);
        caps = { tools: tl, thinking: j.capabilities.includes('thinking'), tier: !tl ? 'none' : (bil >= 3 || !isFinite(bil)) ? 'good' : 'basic', source: 'ollama' };
      }
    } catch {}
    if (!caps) return { tools: false, tier: 'none', thinking: false, source: 'unknown' };   // cannot tell: do not guess, plain chat (not cached, so it retries)
  } else {
    const m = CATALOG.find(x => x.id === model.replace(/^gguf:/, '')), tags = (m && m.caps) || [], tier = (m && m.toolTier) || 'none';
    caps = { tools: tier !== 'none', tier, thinking: tags.includes('thinking'), source: 'catalog' };   // 'good' = real agent, 'basic' = Pholama guides it, 'none' = plain chat
  }
  return (capCache[model] = caps);
}

// Streams ONE model turn from whichever backend serves `model`, calling onToken(text). Returns the full text.
async function streamTurnBase(model, messages, options, onToken, signal, usage) {
  if (model.startsWith('byok:')) return providers.streamProvider(model.slice(5), messages, options, onToken, signal, usage);
  if (model.startsWith('ollama:')) {
    ollamaUsed.add(model.slice(7)); if (!llamaStartedAt || !ollamaUsed.size) llamaStartedAt = Date.now();
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
  const wantReply = Math.min(1024, (options || {}).num_predict || 1024);
  const fit = fitToContext(messages, llamaCtx, wantReply);
  if (fit.dropped || fit.trimmedLast) console.log('  Long chat: left out ' + fit.dropped + ' oldest message(s) so it fits the model (' + llamaCtx + ' tokens).');
  const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: fit.messages, stream: true, stream_options: { include_usage: true }, temperature: (options || {}).temperature ?? 0.7, ...((options || {}).num_predict ? { max_tokens: options.num_predict } : {}) }) });
  if (!r.ok) {   // the engine refused the request: say why instead of going silent
    let msg = ''; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || ''; } catch {}
    throw new Error('The AI engine could not answer' + (msg ? ': ' + String(msg).slice(0, 200) : ' (HTTP ' + r.status + ')') + '. Try a shorter message, or start a new chat.');
  }
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
const SEARCHY = /\b(search(?:ing)?|look(?:ing)? (?:it |that |this )?up|google|browse|find (?:out|online)|online|on the (?:web|internet))\b/i;
const NO_SEARCH_RAN = 'I did not actually run a search just now, so I have no results to show. Tell me what to search for, for example "search for kitten photos", and I will run it for real.';
const NO_WEB = 'I can\'t browse the web or get live data with this model. I answer from what I already know. Pick a model tagged "tools" to use web search.';

// Chat endpoint. Plain Ollama-style NDJSON. Extra event types: {tool:{...}} / {status:"..."} / {credits:{...}}.
async function chat(req, res, b) {
  const model = b.model || '';
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', ...(res.cors || {}), 'Cache-Control': 'no-cache' });
  const line = (o) => res.write(JSON.stringify(o) + '\n');
  const t0 = Date.now(), log = (kind, text) => line({ log: { kind, text, t: +((Date.now() - t0) / 1000).toFixed(1) } });
  const ac = new AbortController(); res.on('close', () => ac.abort());
  // Agent Max as the brain: one cloud call per step, capped per message. Everything else goes to the normal backends.
  const maxBudget = maxcloud.newBudget(), maxToken = String(req.headers['x-pholama-token'] || '').slice(0, 4000);
  const streamTurn = (m, msgs, o, onTok, sig, u) => m === 'cloud:pholama' ? maxcloud.streamMax(maxToken, msgs, o, onTok, sig, u, maxBudget) : streamTurnBase(m, msgs, o, onTok, sig, u);
  try {
    log('step', 'Got your message. Model: ' + model.replace(/^(gguf|ollama|byok|cloud):/, ''));
    if (memUnloaded) { log('step', memUnloaded); memUnloaded = ''; }   // explain why the AI had to load again
    const allow = b.agent ? agent.allowed() : { search: false, tools: false, mcp: false, thinking: false };
    // 1) The model must be able to do it. 2) The per-message switch in the page must be on. 3) Credits (already in `allow`).
    const caps = await modelCaps(model), sw = b.switches || {};
    const canTools = !!caps.tools; agent.setTier(caps.tier);
    for (const k of ['search', 'tools', 'mcp', 'github', 'terminal']) { if (!canTools) allow[k] = false; else if (sw[k] === false) allow[k] = false; }
    if (sw.thinking === false) allow.thinking = false;   // the per-message switch in the page. Any model can think: models without a native mode get a host reasoning pass.
    if (b.agent && !canTools) log('step', caps.source === 'unknown' ? 'Could not read this model\'s abilities, so tools are off (plain chat).' : 'This model does not support tools, so it gets a plain prompt. Pick one tagged "tools" to use search and tools.');
    if (b.agent) log('step', allow.credits ? `Credits: ${agent.credits().left} left. On: ${['search','tools','mcp','terminal','thinking'].filter(k => allow[k]).join(', ') || 'nothing'}` : 'Credits: 0 left');
    if (b.agent && !allow.credits) { line({ status: agent.limitMessage() }); log('error', agent.limitMessage()); line({ limit: { restock: agent.credits().restock } }); }
    // Memory is its own switch (set by the signed-in user in the browser). It costs credits, so it is off at 0 credits.
    const memOn = !!(b.agent && canTools && b.memory === true && true);
    if (b.agent && b.memory === true && !memOn) log('error', !canTools ? 'Memory is on, but this model cannot use tools, so it cannot save new memories. Saved notes are still used.' : 'Memory is on, but there are not enough credits to save new memories today.');
    const inStudio = !!(b.studio && b.studio.project && req.who === 'local'), stu = require('./studio');
    if (model === 'cloud:pholama' && !inStudio) { line({ status: 'Agent Max runs from the Chat box in the page. Here it only works inside Studio. Pick a model from this PC, or open Studio.' }); log('error', 'Agent Max in this box only works inside Studio.'); line({ message: { role: 'assistant', content: '' }, done: true }); return res.end(); }
    const maxStudio = inStudio && model === 'cloud:pholama';   // a remote API key can never make the AI touch files on this PC
    if (inStudio) { allow.studio = true; if (canTools && !allow.github && (req.headers['x-github-token'] || '')) allow.github = sw.github !== false; }   // Studio tools are local and free; GitHub only with the user's own token
    const { tools } = await agent.buildTools({ ...allow, memory: memOn, inStudio });
    if (inStudio && !canTools) log('error', 'This model cannot use tools, so it cannot build in Studio. Pick a model tagged "tools" (Qwen3 0.6B is the smallest).');
    const visited = agent.sources.makeCollector(12); let sentSrc = 0;
    const tctx = { sources: visited, pholamaToken: String(req.headers['x-pholama-token'] || '').slice(0, 4000), ghToken: String(req.headers['x-github-token'] || '').slice(0, 200), onPending: p => line({ approve: p }) };
    if (tools.length) log('step', `${tools.length} tools ready: ${tools.map(t => t.name).join(', ')}`);
    const effort = ['long', 'max'].includes(b.effort) ? b.effort : 'normal';
    // Price this message from the two levels, then take the credits BEFORE answering so the counter visibly drops.
    // If the full price does not fit, drop to the best level that does (thinking first, then effort) rather than refusing.
    let thinking = !!allow.thinking, effortUse = effort;
    if (b.agent) {
      const left = () => agent.credits().left;
      if (agent.messageCost(thinking, effortUse).total > left()) { log('error', `Not enough credits for ${thinking ? 'thinking + ' : ''}${effortUse} effort (${agent.messageCost(thinking, effortUse).total} needed, ${left()} left). Using a cheaper level.`); }
      while (agent.messageCost(thinking, effortUse).total > left() && (thinking || effortUse !== 'normal')) { if (effortUse === 'max') effortUse = 'long'; else if (thinking) thinking = false; else effortUse = 'normal'; }
      const price = agent.messageCost(thinking, effortUse);
      if (price.total > 0 && agent.spend(price.total)) {
        const parts = [thinking ? `thinking ${price.thinking}` : '', price.effort ? `${effortUse} effort ${price.effort}` : '', price.combo ? `thinking + max bonus ${price.combo}` : ''].filter(Boolean);
        log('step', `Spent ${price.total} credits (${parts.join(' + ')}). ${left()} left.`);
        line({ credits: { spent: price.total, left: left() } });
      }
    } else { thinking = false; effortUse = 'normal'; }
    // Extras: pictures, pasted code and Studio messages use integration credits too. Pasted code is measured here from the real message.
    // If they do not fit in what is left, the chat still goes through (local chat is always free), just without the extra.
    let extraSpent = 0;
    if (b.agent) {
      const lastUser = (() => { const u = [...(b.messages || [])].reverse().find(m => m.role === 'user'); return u ? String(u.content) : ''; })();
      const want = pricing.extraCost({ images: b.images, codeChars: pricing.codeCharsIn(lastUser), studio: inStudio, maxStudio });
      if (want.total > 0) {
        if (agent.credits().left >= want.total && agent.spend(want.total)) {
          extraSpent = want.total;
          log('step', `Spent ${want.total} credits (${pricing.describe(want)}). ${agent.credits().left} left.`);
          if (want.mx) log('action', `Agent Max in Studio: ${want.mx} extra credits, and up to ${maxcloud.MAX_CALLS} Max messages from your daily and monthly allowance.`);
          line({ credits: { spent: want.total, left: agent.credits().left } });
        } else {
          log('error', `Not enough credits for ${pricing.describe(want)} (${want.total} needed, ${agent.credits().left} left). Your chat still works. It is free on your own model.`);
        }
      }
    }
    let thinkBilled = false, thinkSeen = false;
    // more room to answer at higher effort (Normal leaves the model's own default alone)
    const opts = { ...(b.options || {}) }; if (effortUse !== 'normal') opts.num_predict = effortUse === 'max' ? 2048 : 1024;
    if (effortUse !== 'normal') log('step', 'Effort: ' + effortUse);
    const usage = { in: 0, out: 0, got: false }, t1 = Date.now();
    let searchRan = false;   // did a real search / page / GitHub tool run this message? If not, a reply that says it found results is invented.
    const origUserText = (() => { const u = [...(b.messages || [])].reverse().find(m => m.role === 'user'); return u ? String(u.content) : ''; })();
    if (inStudio) {   // Studio: only the last few turns, and never the model's own <think> notes, so a small model stays on the request instead of looping
      const cl = t => String(t || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/<\/?think>/g, '').trim();
      b.messages = (b.messages || []).map(m => m.role === 'assistant' ? { ...m, content: cl(m.content).slice(0, 1200) } : m).filter(m => m.role !== 'assistant' || m.content).slice(-8);
    }
    let generated = '';   // everything the model wrote this message (all turns), used only for the estimate
    const skillNote = allow.skills ? agent.plugins.skillsPrompt(agent.plugins.listSkills()) : '';
    const messages = [{ role: 'system', content: skillNote + agent.systemPrompt(tools, thinking, b.memory === true && Array.isArray(b.memories) ? b.memories : [], effortUse) + (inStudio && tools.length ? agent.studioPrompt(b.studio.project, (() => { try { return stu.snapshot(b.studio.project).map(f => ({ name: f.name, size: f.size })); } catch { return []; } })()) + (() => { try { const lu = [...(b.messages || [])].reverse().find(m => m.role === 'user'); return agent.studioFocus(stu.snapshot(b.studio.project), lu && lu.content, b.studio.project); } catch { return ''; } })() : '') + (() => { if (tools.length) return ''; const lu = [...(b.messages || [])].reverse().find(m => m.role === 'user'); return agent.aboutUserHint(lu && lu.content, b.memory === true && Array.isArray(b.memories) ? b.memories : []); })() }, ...(b.messages || []).filter(m => m.role !== 'system')];
    // Host-side routing: obvious intents run their tool before the model answers (weak models skip tool calls).
    if (tools.length) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const r0 = lastUser && agent.routeIntent(lastUser.content, tools, messages.filter(m => m !== lastUser));
      if (r0) {
        log('action', `Request looks like a job for ${r0.name}. Running it first.`);
        log('action', `${r0.name} ${JSON.stringify(r0.args)}`);
        let result; try { result = String(await agent.runTool(tools, r0.name, r0.args, tctx)); } catch (e) { result = 'Tool error: ' + e.message; }
        if (/^(web_search|fetch_page|github_|platform_)/.test(r0.name) && !/^Tool error/.test(result)) searchRan = true;
        if (r0.name === 'remember_thing' && result.startsWith('SAVED:')) { line({ memory: { text: result.slice(6) } }); log('result', 'Asked your account to save: ' + result.slice(6)); result = 'Saved to memory.'; } else
        log(/^Tool error/.test(result) ? 'error' : 'result', result.slice(0, 300));
        line({ tool: { name: r0.name, args: r0.args, result: result.slice(0, 400) } }); if (visited.size() !== sentSrc) { sentSrc = visited.size(); line({ sources: visited.list() }); }
        messages.push({ role: 'assistant', content: `<tool>${JSON.stringify(r0)}</tool>` }, { role: 'user', content: `Tool result for ${r0.name}:\n${result}\n\nNow answer the user's question using this result. Be brief.` });
      }
    }
    // Real thinking for ANY model. A model with its own <think> mode does it itself. Every other model gets a hidden first pass that
    // writes short working notes (what is asked, the steps, a check), shown as "Thought for Xs"; the answer pass then uses them.
    // The amount of thinking follows the effort: Normal a few lines, Long more steps, Max step by step plus a double check.
    if (thinking && !caps.thinking) {
      const lastU = [...messages].reverse().find(m => m.role === 'user');
      const depth = effortUse === 'max' ? 'Work step by step. List what is asked, each step of the working, then CHECK the result once more and fix any slip. Up to 12 short lines.'
        : effortUse === 'long' ? 'Work it through in 4 to 8 short lines: what is asked, the steps, and a quick check.'
        : 'Think briefly in 2 to 4 short lines: what is asked and how to answer it.';
      const tmsgs = [{ role: 'system', content: 'You are the private thinking step of an assistant. Write ONLY working notes for yourself, never the final answer. ' + depth + ' Plain text, no greeting.' }, ...messages.filter(m => m.role !== 'system').slice(-6)];
      const tt0 = Date.now(); let notes = ''; log('thought', 'Thinking (' + effortUse + ')...');
      line({ model, message: { role: 'assistant', content: '<think>' }, done: false });
      const think = { ...opts, num_predict: effortUse === 'max' ? 700 : effortUse === 'long' ? 420 : 220, temperature: 0.4 };
      let shownNotes = 0;   // working notes are words only: a tool command written here is held back, never shown
      const onTok = t => { notes += t; const safe = agent.safeShowLength(notes); if (safe > shownNotes) { line({ model, message: { role: 'assistant', content: notes.slice(shownNotes, safe) }, done: false }); shownNotes = safe; } };
      let usedHelper = false;
      if (b.duo === true && model.startsWith('gguf:')) {   // duo: a small second AI writes the notes, the main AI answers
        try {
          const mainM = CATALOG.find(x => x.id === model.replace(/^gguf:/, ''));
          const got = CATALOG.filter(x => fs.existsSync(path.join(MODELS_DIR, x.file)));
          const plan = duoMod.planDuo({ enabled: true, main: mainM, downloaded: got, chosenId: b.duoHelper, freeGB: require('./guard').freeMemMB() / 1024 });
          if (!plan.on) log('step', plan.why + ' Using one AI.');
          else {
            await helperEng.start(plan.helper.file, 2048);
            log('step', 'Duo: ' + plan.why);
            const hm = [{ role: 'system', content: duoMod.HELPER_SYSTEM }, ...messages.filter(m => m.role !== 'system').slice(-4)];
            const r = await fetch(`http://127.0.0.1:${helperEng.port}/v1/chat/completions`, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: hm, stream: false, max_tokens: think.num_predict, temperature: 0.3 }) });
            if (!r.ok) throw new Error('helper HTTP ' + r.status);
            const j = await r.json(); const txt = duoMod.cleanNotes(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
            if (!txt) throw new Error('the helper gave no usable notes');
            onTok(txt); usedHelper = true;
          }
        } catch (e) { notes = ''; log('error', 'Duo helper failed (' + e.message + '). The main AI thinks for itself.'); try { await helperEng.stop(); } catch {} }
      }
      if (!usedHelper) {
        try { await streamTurn(model, tmsgs, think, onTok, ac.signal, usage); }
        catch (e) { log('error', 'Thinking pass failed (' + e.message + '). Answering without it.'); }
      }
      line({ model, message: { role: 'assistant', content: '</think>\n' }, done: false });
      notes = agent.stripToolText(notes.replace(/<\/?think>/g, '')).trim();
      if (notes) {
        thinkSeen = true; log('thought', 'Thought for ' + ((Date.now() - tt0) / 1000).toFixed(1) + 's');
        // Hand the notes to the answer pass inside the user's own message, so the model treats them as its own working and just finishes the job.
        const lu2 = [...messages].reverse().find(m => m.role === 'user');
        if (lu2) lu2.content = String(lu2.content) + '\n\n(Your working so far, which you can trust:\n' + notes.slice(0, 1800) + '\n)\nNow reply to me with the final answer in clear sentences, using your working above.';
      }
    }
    // Guided edit: a small change to a file the user named. Pholama finds the line, the model writes just the new line, Pholama applies it safely.
    let guidedDone = false;
    if (inStudio && stu && b.studio && b.studio.project && b.guided !== false) {
      let plan = null, lu0 = null;
      try { lu0 = [...(b.messages || [])].reverse().find(m => m.role === 'user'); plan = agent.planGuidedEdit(stu.snapshot(b.studio.project), origUserText); } catch {}
      if (plan) {
        log('step', 'Small change to ' + plan.file + ' (line ' + plan.lineNo + '). Asking the model for just the new line.');
        let got = ''; try { await streamTurn(model, [{ role: 'system', content: 'You edit one line of code. Reply with the single new line only. No explanation, no quotes, no code fence.' }, { role: 'user', content: plan.prompt }], { ...opts, temperature: 0.1, num_predict: 160 }, t => { got += t; }, ac.signal); } catch (e) { log('error', 'Guided edit asked the model but it failed (' + e.message + '). Using the normal way.'); }
        const nl = agent.cleanGuidedLine(got, plan.oldLine);
        if (nl) {
          let res; try { res = agent.loggedStudio('patch', b.studio.project, plan.file, plan.oldLine.trim(), nl.trim()); } catch (e) { res = 'Tool error: ' + e.message; }
          const ok = !/^Tool error/.test(res);
          log(ok ? 'result' : 'error', ok ? 'Line ' + plan.lineNo + ' of ' + plan.file + ': ' + plan.oldLine.trim() + '  ->  ' + nl.trim() : res);
          line({ tool: { name: 'studio_patch', args: { project: b.studio.project, file: plan.file, find: plan.oldLine.trim(), replace: nl.trim() }, result: ok ? res : res.slice(0, 300) } });
          if (ok) {
            line({ studio: { changed: true, project: b.studio.project } });
            const txt = 'Changed line ' + plan.lineNo + ' of ' + plan.file + ':\n' + plan.oldLine.trim() + '\n' + nl.trim() + '\nEverything else in the file is untouched.';
            line({ model, message: { role: 'assistant', content: txt }, done: false }); generated += txt; guidedDone = true;
          }
        } else if (got.trim()) log('step', 'The model\'s answer was not a clean single line, using the normal way instead.');
      }
    }
    // Guided build: the user asked to MAKE something. Small models talk instead of calling tools, so Pholama asks for the files directly and writes them itself.
    if (inStudio && stu && b.studio && b.studio.project && !guidedDone && b.guided !== false) {
      let bp = null;
      try {
        const us = (b.messages || []).filter(m => m.role === 'user').map(m => String(m.content || ''));
        const cur = origUserText, before = us.slice(0, -1).reverse();
        const prevBuild = before.find(t => /\b(make|build|create|write|code|generate|develop)\b/i.test(t) && t.length < 400) || before[0] || '';
        bp = agent.planGuidedBuild(cur, prevBuild, stu.snapshot(b.studio.project).map(f => ({ name: f.name, size: f.size })), b.studio.project);
      } catch {}
      if (bp) {
        log('step', 'Building in Studio: asking the model for the files directly.');
        let got = '', tries = 0, written = [];
        while (tries < 3 && !written.length && !ac.signal.aborted) {
          tries++; got = '';
          try { await streamTurn(model, [{ role: 'system', content: 'You write small working web projects. Reply only with files in the requested FILE: format.' }, { role: 'user', content: bp.prompt + (tries > 1 ? '\n\nYour last reply had no FILE: blocks. Reply ONLY with FILE: name then a code block, for each file.' : '') }], { ...opts, temperature: 0.3, num_predict: 2400 }, t => { got += t; }, ac.signal); } catch (e) { log('error', 'Build request failed (' + e.message + ').'); break; }
          for (const f of agent.parseFileBlocks(got, b.studio.project, bp.file)) {
            let res; try { res = agent.loggedStudio('write', b.studio.project, f.file, agent.tidyFile(f.file, f.content)); } catch (e) { res = 'Tool error: ' + e.message; }
            const ok = !/^Tool error/.test(String(res));
            log(ok ? 'result' : 'error', ok ? 'Wrote ' + f.file + ' (' + Buffer.byteLength(f.content) + ' bytes)' : String(res).slice(0, 200));
            line({ tool: { name: 'studio_write', args: { project: b.studio.project, file: f.file }, result: ok ? 'Saved ' + f.file : String(res).slice(0, 200) } });
            if (ok) written.push(f.file);
          }
        }
        if (written.length) {
          line({ studio: { changed: true, project: b.studio.project } });
          let issues = []; try { issues = stu.check(b.studio.project).filter(x => x !== 'No problems found.'); } catch {}
          for (let fix = 0; fix < 2 && issues.length && !ac.signal.aborted; fix++) {   // let the model repair what the checker found
            log('step', 'Auto-check found ' + issues.length + ' problem(s). Asking the model to fix them.');
            let g2 = ''; try { await streamTurn(model, [{ role: 'system', content: 'You fix small web projects. Reply only with the corrected files in FILE: format.' }, { role: 'user', content: 'Problems found in the project:\n- ' + issues.slice(0, 5).join('\n- ') + '\n\nCurrent files:\n' + stu.snapshot(b.studio.project).filter(f => written.includes(f.name)).map(f => 'FILE: ' + f.name + '\n```\n' + f.content.slice(0, 3000) + '\n```').join('\n\n') + '\n\nReply with the corrected files in FILE: format, nothing else.' }], { ...opts, temperature: 0.2, num_predict: 2400 }, t => { g2 += t; }, ac.signal); } catch { break; }
            const backup = stu.snapshot(b.studio.project), before = issues.length;
            for (const f of agent.parseFileBlocks(g2, b.studio.project)) { try { agent.loggedStudio('write', b.studio.project, f.file, agent.tidyFile(f.file, f.content)); } catch {} }
            let now = before; try { now = stu.check(b.studio.project).filter(x => x !== 'No problems found.').length; } catch {}
            if (now >= before) { for (const f of backup) { try { stu.writeFile(b.studio.project, f.name, f.content); } catch {} } log('step', 'The fix did not help, so I kept the earlier version.'); break; }
            line({ tool: { name: 'studio_write', args: { project: b.studio.project }, result: 'Fixed problems (' + before + ' -> ' + now + ')' } });
            line({ studio: { changed: true, project: b.studio.project } });
            try { issues = stu.check(b.studio.project).filter(x => x !== 'No problems found.'); } catch { issues = []; }
          }
          const txt = 'Done. I wrote ' + written.join(', ') + ' in the project "' + b.studio.project + '". Press Run to try it.' + (issues.length ? '\n\nStill not perfect: ' + issues.slice(0, 2).join('; ') + '. Tell me what to fix.' : '');
          line({ model, message: { role: 'assistant', content: txt }, done: false }); generated += got + txt; guidedDone = true;
        } else log('step', 'The model did not give usable files, using the normal way.');
      }
    }
    let lazyTried = false;   // one firm retry per message when the AI refuses normal work as 'too complex'
    const seenCalls = {}; let badCalls = 0; const failedTry = {}; let retrying = false;   // retrying: a repair round whose words must not be shown twice
    const MAX_ROUNDS = inStudio ? 14 : 5;   // building an app takes many tool steps
    for (let round = 0; round < MAX_ROUNDS && !guidedDone; round++) {
      // With tools on, buffer the start of the reply: if it begins with "<tool" it is a tool call (hide it),
      // otherwise flush what we have and stream the rest live.
      log('step', round === 0 ? 'Loading model and writing the reply...' : 'Writing the final answer from the tool result...');
      let acc = '', mode = tools.length ? 'undecided' : 'stream', sent = 0, first = true;
      let cut = false;
      const lu = [...messages].reverse().find(m => m.role === 'user'), holdWeb = (!tools.length && lu && ASKED_WEB.test(lu.content)) || (tools.length && !searchRan && lu && SEARCHY.test(lu.content));   // decide before showing anything
      const watchLazy = !lazyTried && lu && agent.lazyRefusal(lu.content, 'I cannot create');   // a build request: hold only the first few words, a refusal shows itself early
      const flush = () => { if (cut) return; if (leaked(acc)) { cut = true; line({ model, message: { role: 'assistant', content: sent ? '\n' + CANT : CANT }, done: false }); log('step', 'Hid part of the reply that quoted private instructions.'); return; } const safe = tools.length ? (retrying ? 0 : agent.safeShowLength(acc)) : acc.length; if (safe > sent) { line({ model, message: { role: 'assistant', content: acc.slice(sent, safe) }, done: false }); sent = safe; } };
      const onTok = t => {
        acc += t; if (first) { first = false; log('step', 'Model is answering'); }
        if (thinking && !thinkSeen && acc.includes('<think>')) { thinkSeen = true; log('thought', 'Model is thinking...'); }
        if (mode === 'undecided') {
          const head = acc.trimStart();
          if (head.startsWith('<tool')) mode = 'tool';
          else if (head.length >= 5 || !'<tool'.startsWith(head)) mode = 'stream';
        }
        if (mode === 'stream' && !holdWeb && !(watchLazy && acc.length < 160)) flush();   // build request: wait for ~160 characters, then stream as normal
      };
      // Shield: an empty reply or an engine that dropped out before saying anything is retried (engine restarted first), never shown as silence.
      const shot = await shieldedTurn((tok) => streamTurn(model, messages, opts, t => { tok(t); onTok(t); }, ac.signal, usage), {
        tries: 3, signal: ac.signal,
        onRetry: (n, e) => log('step', 'The AI gave no answer' + (e && e.message && e.message !== 'empty reply' ? ' (' + e.message.slice(0, 80) + ')' : '') + '. Restarting it and trying again (' + n + '/2)...'),
        restart: async () => { if (!model.startsWith('ollama:')) { await stopLlama(); } },
      });
      if (shot.failed) { console.log('  Reply shield: no answer after 3 tries' + (shot.error ? ' (' + shot.error.message + ')' : '')); line({ model, message: { role: 'assistant', content: FRIENDLY }, done: false }); break; }
      if (shot.recovered) log('step', 'The AI recovered and answered.');
      const text = shot.text;
      generated += text;
      const shown = sent;
      const call = tools.length ? (agent.parseTool(text, tools.map(t => t.name)) || (inStudio ? agent.parseFileBlock(text, b.studio.project) : null)) : null;
      const wasRetrying = retrying; if (call || !agent.looksLikeToolAttempt(text)) retrying = false;
      if (!call && tools.length && !cut && agent.looksLikeToolAttempt(text)) {
        badCalls++;
        if (badCalls <= 2 && round < MAX_ROUNDS - 1) {
          log('step', 'The AI wrote a tool call that could not be read. Asking it to write it again (' + badCalls + '/2)...');
          messages.push({ role: 'assistant', content: agent.stripToolText(text) || '(tool call)' }, { role: 'user', content: agent.badCallNotice(badCalls, tools.map(t => t.name)) });
          retrying = true; continue;
        }
        const left = agent.stripToolText(text);   // retries used up: show only the words, never the command
        line({ model, message: { role: 'assistant', content: (shown < left.length && !shown ? left + '\n\n' : (shown ? '\n' : '')) + 'I tried to use a tool but could not get it right, so nothing was changed. Please try again, or use a bigger model for this.' }, done: false });
        log('error', 'The AI could not write a readable tool call after 2 retries.'); break;
      }
      if (!call) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        if (cut) break;
        if (leaked(text)) { line({ model, message: { role: 'assistant', content: shown ? '\n' + CANT : CANT }, done: false }); log('step', 'Hid part of the reply that quoted private instructions.'); break; }
        if (!lazyTried && lastUser && agent.lazyRefusal(lastUser.content, text)) {
          lazyTried = true; log('step', 'The AI refused a normal request as "too complex". Asking it again, firmly, for a real first version...');
          messages.push({ role: 'assistant', content: text.slice(0, 300) }, { role: 'user', content: agent.LAZY_RETRY + '\n\nThe request was: ' + String(lastUser.content).slice(0, 500) });
          retrying = true; continue;
        }
        if (holdWeb && tools.length && agent.inventedSearch(text, searchRan)) { line({ model, message: { role: 'assistant', content: NO_SEARCH_RAN }, done: false }); log('step', 'The AI said it found search results, but no search ran. Replaced that with an honest answer.'); break; }
        if (holdWeb && CLAIMS_WEB.test(text)) { line({ model, message: { role: 'assistant', content: NO_WEB }, done: false }); log('step', 'This model has no web access, so its claim to search was replaced.'); break; }
        if (shown < text.length) { const rest = tools.length ? text.slice(shown) : agent.stripToolText(text.slice(shown)); if (rest) line({ model, message: { role: 'assistant', content: rest }, done: false }); } break;
      }
      { const sig = call.name + JSON.stringify(call.args || {}); seenCalls[sig] = (seenCalls[sig] || 0) + 1;
        if (seenCalls[sig] >= 3) { log('error', 'The model repeated the same step 3 times, so I stopped it to save your time.'); line({ message: { content: '\n(I stopped because the AI kept repeating the same step. Try a bigger model, or ask for one smaller change.)' } }); break; } }
      log('action', `Model asked for ${call.name} ${JSON.stringify(call.args)}`);
      let result; try { result = String(await agent.runTool(tools, call.name, call.args, tctx)); } catch (e) { result = 'Tool error: ' + e.message; }
      if (/^(web_search|fetch_page|github_|platform_)/.test(call.name) && !/^Tool error/.test(result)) searchRan = true;
      if (call.name === 'remember_thing' && result.startsWith('SAVED:')) { line({ memory: { text: result.slice(6) } }); log('result', 'Asked your account to save: ' + result.slice(6)); result = 'Saved to memory.'; } else
      log(/^Tool error/.test(result) ? 'error' : 'result', result.slice(0, 300));
      line({ tool: { name: call.name, args: call.args, result: result.slice(0, 400) } }); if (visited.size() !== sentSrc) { sentSrc = visited.size(); line({ sources: visited.list() }); }
      if (stu && stu.isStudio(call.name) && call.name !== 'studio_read' && call.name !== 'studio_files' && call.name !== 'studio_projects') line({ studio: { changed: true, project: (call.args && call.args.project) || (b.studio && b.studio.project) || null, file: (call.args && call.args.file) || null } });
      if (inStudio && stu && stu.isStudio(call.name)) {
        // Build loop: after any change the host checks the project itself and hands the model the real problems to fix.
        let issues = []; const changed = !['studio_read', 'studio_files', 'studio_projects', 'studio_check', 'studio_run_js'].includes(call.name);
        if (changed && !/^Tool error/.test(result)) { try { issues = stu.check((call.args && call.args.project) || b.studio.project).filter(x => x !== 'No problems found.'); } catch {} }
        if (issues.length && round < MAX_ROUNDS - 1) { log('step', 'Auto-check found ' + issues.length + ' problem(s). Asking the model to fix them.'); line({ tool: { name: 'studio_check', args: {}, result: issues.join(' | ').slice(0, 400) } });
          messages.push({ role: 'assistant', content: text }, { role: 'user', content: `[${call.name} returned]\n${result}\n[automatic check found PROBLEMS]\n${issues.join('\n')}\n[end]\nFix every problem now. The element usually belongs in index.html, so call studio_write with file \"index.html\" containing a full page (<!doctype html>, <body> with the needed elements each with its id, and <script src=\"script.js\"></script> at the end). Do NOT rewrite script.js again. Reply with ONLY the tool line. Do not say it is finished until the check is clean.` }); continue; }
        messages.push({ role: 'assistant', content: text }, { role: 'user', content: `[${call.name} returned]\n${result}\n[end]\n${changed ? 'The project checked clean. If the request still needs more files, call the next studio tool now. If it is complete, write ONE short sentence in your own words describing what the user can now do in the preview. Do not repeat these instructions.' : 'Continue the task: call the next studio tool if needed, otherwise answer in plain words.'}` }); continue;
      }
      if (agent.isToolFail(result) && round < MAX_ROUNDS - 1) {
        const n = failedTry[call.name] = (failedTry[call.name] || 0) + 1;
        if (n <= 2) { log('step', call.name + ' failed. Asking the AI to fix it and try again (' + n + '/2)...'); messages.push({ role: 'assistant', content: text }, { role: 'user', content: agent.toolFailNotice(call.name, result, n - 1) }); continue; }
      }
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `[${call.name} returned]\n${result}\n[end]\nAnswer my question above in plain words using this. Do not mention the tool, this message, or these brackets.` });
    }
    if (!usage.got) {   // backend gave no numbers: estimate (about 4 characters per token) and say so
      const chars = s => Math.ceil(String(s || '').length / 4);
      usage.in = messages.reduce((n, m) => n + chars(m.content), 0); usage.out = chars(generated);
      usage.estimated = true;
    }
    line({ usage: { in: usage.in, out: usage.out, total: usage.in + usage.out, estimated: !!usage.estimated, seconds: +((Date.now() - t1) / 1000).toFixed(1) } });
    log('step', `Done. ${agent.credits().left} credits left.`);
    line({ credits: agent.credits() });
    line({ model, message: { role: 'assistant', content: '' }, done: true });
  } catch (e) {
    // Agent Max ran out (day or month): keep working on this PC's own model, free, instead of stopping.
    if (model === 'cloud:pholama' && e && e.limit && !b._fellBack) {
      const have = CATALOG.filter(m => fs.existsSync(path.join(MODELS_DIR, m.file)) && m.toolTier && m.toolTier !== 'none');
      const pick = have.find(m => m.toolTier === 'good') || have[0];
      if (pick) { log('action', e.message + ' Switching to ' + pick.name + ' on this PC. It is free.'); line({ fallback: { from: 'cloud:pholama', to: 'gguf:' + pick.id } }); return chat(req, res, { ...b, model: 'gguf:' + pick.id, _fellBack: true }); }
    }
    line({ error: e.message, done: true });
  }
  res.end();
}

// OpenAI-style wrapper around chat(): collects the NDJSON stream and answers in OpenAI format (streaming or not).
async function openaiChat(req, res, b) {
  const model = String(b.model || ''); if (!model) return json(res, 400, { error: { message: 'model is required' } });
  const txt = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => typeof x === 'string' ? x : (x && (x.text || (x.type === 'text' && x.content))) || '').filter(Boolean).join('\n') : (c == null ? '' : JSON.stringify(c));   // SDKs send content as [{type:'text',text:'...'}]
  const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(-40).map(m => ({ role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : m.role === 'developer' ? 'system' : 'user', content: txt(m.content).slice(0, 20000) })).filter(m => m.content.trim());
  if (!msgs.length) return json(res, 400, { error: { message: 'messages is required' } });
  const id = 'chatcmpl-' + Date.now().toString(36), created = Math.floor(Date.now() / 1000), stream = b.stream === true;
  const opts = {}; if (+b.max_tokens > 0) opts.num_predict = Math.min(+b.max_tokens, 4096); if (typeof b.temperature === 'number') opts.temperature = b.temperature;
  let text = '', usage = null, err = null, buf = '';
  if (stream) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...(res.cors || {}) });
  const sse = (delta, fin) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: fin || null }] }) + '\n\n');
  if (stream) sse({ role: 'assistant' });
  const sink = {   // a fake response object that chat() writes into
    cors: res.cors, writeHead() {}, on: (ev, f) => res.on(ev, f), setHeader() {},
    write(chunk) { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, i); buf = buf.slice(i + 1); let o; try { o = JSON.parse(ln); } catch { continue; }
      if (o.error) err = o.error; if (o.usage) usage = o.usage;
      const c = o.message && o.message.content; if (c && !o.done) { text += c; if (stream) sse({ content: c }); } } return true; },
    end() {} };
  await chat(req, sink, { model, messages: msgs, agent: false, options: opts, effort: 'normal' });
  if (err && !text) { if (stream) { res.write('data: ' + JSON.stringify({ error: { message: String(err) } }) + '\n\n'); return res.end(); } return json(res, 502, { error: { message: String(err) } }); }
  if (stream) { sse({}, 'stop'); res.write('data: [DONE]\n\n'); return res.end(); }
  const u = usage || { in: 0, out: 0, total: 0 };
  return json(res, 200, { id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: u.in, completion_tokens: u.out, total_tokens: u.total } });
}

// True when this PC has a local AI that can run tools: a downloaded model tagged "tools", or an Ollama model that reports the tools ability.
async function hasToolAI() {
  try {
    for (const m of CATALOG) if (m.toolTier && m.toolTier !== 'none' && fs.existsSync(path.join(MODELS_DIR, m.file))) return true;
    if (await ollamaUp()) {
      const o = JSON.parse((await get(OLLAMA + '/api/tags')).body);
      for (const m of (o.models || []).slice(0, 25)) { const c = await modelCaps('ollama:' + m.name); if (c.tools) return true; }
    }
  } catch {}
  return false;
}
async function listModels() {   // Ollama-compatible model list (ours + Ollama's)
  const list = CATALOG.filter(m => fs.existsSync(path.join(MODELS_DIR, m.file))).map(m => ({ name: 'gguf:' + m.id, model: 'gguf:' + m.id, size: m.sizeGB * 2 ** 30 }));
  if (await ollamaUp()) { try { const o = JSON.parse((await get(OLLAMA + '/api/tags')).body); for (const m of o.models || []) list.push({ ...m, name: 'ollama:' + m.name, model: 'ollama:' + m.name }); } catch {} }
  for (const pv of providers.list()) list.push({ name: 'byok:' + pv.id, model: 'byok:' + pv.id, size: 0, label: pv.name + ' (' + pv.model + ')', hosted: true });
  return list;
}

// The only things an outside MCP client (ChatGPT) can reach. Fixed list, read-only, no caller-chosen tool names.
const mcpDeps = {
  version: () => '',
  async news(limit) { const { tools } = await agent.buildTools({ platform: true }); return agent.runTool(tools, 'platform_updates', { limit }, { sources: agent.sources.makeCollector(4) }); },
  async search(query) { const { tools } = await agent.buildTools({ search: true }); return agent.runTool(tools, 'web_search', { query }, { sources: agent.sources.makeCollector(8) }); },
  async models() { const l = await listModels(); return l.length ? l.map(m => { const c = CATALOG.find(x => 'gguf:' + x.id === m.name); return (m.label || m.name.replace(/^(gguf|ollama):/, '')) + (c && c.toolTier ? ' (tools: ' + c.toolTier + ')' : ''); }).join('\n') : 'No models installed yet.'; },
  async credits() { const c = agent.credits(); return c.left + ' credits left today (of ' + c.daily + ').'; },
};
mcpDeps.version = VERSION_FOR_MCP;
function VERSION_FOR_MCP() { try { return require('../package.json').version; } catch { return '0'; } }
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  res.cors = sec.corsHeaders(req);
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method === 'OPTIONS') { res.writeHead(204, res.cors); return res.end(); }
  if (sec.originBlocked(req)) return json(res, 403, { error: 'This website is not allowed to use this Pholama host.' });   // other sites can never drive your PC
  try {
    if (p === '/mcp') {
      if (!mcp.isOn()) return json(res, 404, { error: 'The ChatGPT connection is switched off. Turn it on in Pholama on the PC: Settings > Connect ChatGPT.' });
      const a = sec.authorizeKeyOnly(req); if (!a.ok) return json(res, a.status, { error: a.error, hint: a.hint });   // a key is ALWAYS needed here, even from this PC: a tunnel makes outside requests look local
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Use POST.' })); }
      let raw = ''; try { raw = await rawBody(req, mcp.MAX_BODY); } catch { return json(res, 413, { error: 'Too large' }); }
      const r = await mcp.handleBody(raw, { ...mcpDeps, version: VERSION_FOR_MCP() });
      if (r.body === null) { res.writeHead(r.status, res.cors); return res.end(); }
      return json(res, r.status, r.body);
    }
    if (p === '/api/mcp-server') {   // on/off switch: this PC only (the /api/ rule below already blocks remote keys from it)
      const a = sec.authorize(req); if (!a.ok || a.who !== 'local') return json(res, 403, { error: 'This can only be done on the PC itself.' });
      if (req.method === 'GET') return json(res, 200, { on: mcp.isOn(), tools: mcp.TOOLS.map(t => ({ name: t.name, description: t.description })) });
      if (req.method === 'POST') { const b = await body(req); return json(res, 200, { on: mcp.setOn(b.on === true) }); }
    }
    if (p === '/api/auth') return json(res, 200, { required: !sec.isLoopback(req), local: sec.isLoopback(req), keys: sec.isLoopback(req) ? sec.keyCount() : undefined });   // public: lets the page know if it needs a key
    if (p.startsWith('/api/') || p.startsWith('/v1/')) {
      const a = sec.authorize(req);
      if (!a.ok) return json(res, a.status, { error: a.error, hint: a.hint });
      req.who = a.who;
      // A remote API key is for plain chat only: the OpenAI-style /v1 routes and reading credits. Everything else
      // (settings, the agent and its tools, commands, GitHub approvals, downloads, logs) answers to this PC alone.
      const REMOTE_OK = p.startsWith('/v1/') || ['/api/credits', '/api/chat', '/api/tags', '/api/caps', '/api/version', '/api/ps', '/api/show', '/api/embed', '/api/embeddings', '/api/docs'].includes(p);
      if (req.who !== 'local' && !REMOTE_OK) return json(res, 403, { error: 'This can only be done on the PC itself.' });
      if (!sleeper.touch(req.method, p)) return json(res, 503, { error: 'Pholama is asleep: nobody used an AI for a day, so all local AIs were shut down to free your memory. On the PC, run:  pholama awake', asleep: true });
    }
    // serve / shutdown: only from this PC
    if (p === '/api/serve' && req.method === 'POST') {
      if (req.who !== 'local') return json(res, 403, { error: 'Only this PC can start serving.' });
      const b = await body(req), m = CATALOG.find(x => x.id === b.id);
      if (!m) return json(res, 404, { error: 'unknown model' });
      if (!fs.existsSync(path.join(MODELS_DIR, m.file))) return json(res, 409, { error: 'Not installed. Run: ' + m.command });
      served = m.id; try { await startLlama(m.file); } catch (e) { served = null; return json(res, 500, { error: e.message }); }
      return json(res, 200, { ok: true, model: 'gguf:' + m.id, url: `http://127.0.0.1:${PORT}/v1` });
    }
    if (p === '/api/serve/stop' && req.method === 'POST') { if (req.who !== 'local') return json(res, 403, { error: 'Only this PC can do that.' }); served = null; await stopLlama(); return json(res, 200, { ok: true }); }
    if (p === '/api/serve' && req.method === 'GET') return json(res, 200, { model: served ? 'gguf:' + served : null });
    if (p === '/api/restart' && req.method === 'POST') {
      if (req.who !== 'local') return json(res, 403, { error: 'Only this PC can do that.' });
      // Start a fresh copy of this same server (hidden, detached) that waits a moment for this one to let go of the port, then close this one.
      try {
        const cp = require('child_process');
        const child = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{require("child_process").spawn(process.execPath,[' + JSON.stringify(path.join(__dirname, 'server.js')) + '],{detached:true,stdio:"ignore",windowsHide:true,cwd:' + JSON.stringify(path.join(__dirname, '..')) + ',env:process.env}).unref()},1800)'], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
        child.unref();
      } catch (e) { return json(res, 500, { error: 'Could not restart: ' + e.message }); }
      json(res, 200, { ok: true }); setTimeout(() => closeAll(0), 300); return;
    }
    if (p === '/api/shutdown' && req.method === 'POST') { if (req.who !== 'local') return json(res, 403, { error: 'Only this PC can do that.' }); json(res, 200, { ok: true }); setTimeout(() => closeAll(0), 200); return; }
    // API keys are managed only from this PC, never remotely
    if (p === '/api/keys') {
      if (req.who !== 'local') return json(res, 403, { error: 'Keys can only be managed on the PC itself.' });
      if (req.method === 'GET') return json(res, 200, { keys: sec.listKeys() });
      if (req.method === 'POST') { try { return json(res, 200, sec.createKey((await body(req)).label)); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'DELETE') return json(res, 200, { ok: sec.revokeKey(u.searchParams.get('id')) });
    }
    // OpenAI-compatible API so other apps can use your local AI. Plain chat only: no tools, no credits, no GitHub.
    if (p === '/v1/models') return json(res, 200, { object: 'list', data: (await listModels()).map(m => ({ id: m.name, object: 'model', owned_by: 'pholama' })) });
    if (p === '/v1/chat/completions' && req.method === 'POST') return openaiChat(req, res, await body(req));
    if (p === '/api/caps') { const m = u.searchParams.get('model') || ''; const c = await modelCaps(m); return json(res, 200, { ...c, nativeThinking: !!c.thinking, thinking: true, search: c.tools, mcp: c.tier === 'good', github: c.tools }); }   // thinking works on every model now: models without a native mode get the host reasoning pass
    if (p.startsWith('/api/studio/')) {
      const stu = require('./studio'); const seg = p.split('/').slice(3).map(decodeURIComponent);
      try {
        if (seg[0] === 'projects' && req.method === 'GET' && !seg[1]) return json(res, 200, { projects: stu.listProjects() });
        if (seg[0] === 'projects' && req.method === 'POST' && !seg[1]) { const b = await body(req); return json(res, 200, stu.createProject(b.name, b.template)); }
        if (seg[0] === 'projects' && seg[1] && !seg[2] && req.method === 'GET') return json(res, 200, { name: stu.projName(seg[1]), files: stu.snapshot(seg[1]) });
        if (seg[0] === 'projects' && seg[1] && !seg[2] && req.method === 'DELETE') return json(res, 200, { ok: true, text: stu.deleteProject(seg[1]) });
        if (seg[0] === 'projects' && seg[1] && seg[2] === 'file' && req.method === 'PUT') { const b = await body(req); return json(res, 200, stu.writeFile(seg[1], b.file, b.content)); }
        if (seg[0] === 'projects' && seg[1] && seg[2] === 'file' && req.method === 'DELETE') { const b = await body(req); return json(res, 200, { ok: true, text: stu.deleteFile(seg[1], b.file) }); }
        if (seg[0] === 'projects' && seg[1] && seg[2] === 'check' && req.method === 'GET') return json(res, 200, { issues: stu.check(seg[1]) });
        if (seg[0] === 'run' && req.method === 'POST') { const b = await body(req); return json(res, 200, stu.runJs(b.code)); }
        return json(res, 404, { error: 'unknown studio route' });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/github/approve' && req.method === 'POST') { const b = await body(req); try { return json(res, 200, { ok: true, text: await agent.github.confirm(String(req.headers['x-github-token'] || ''), String(b.id || ''), b.approve === true) }); } catch (e) { return json(res, 200, { ok: false, text: e.message }); } }
    // ---- commands the AI proposes: run only after the user clicks Allow, only from this PC's own page ----
    if (p.startsWith('/api/cmd/') || p === '/api/editlog' || p === '/api/editlog/stream' || p === '/api/providers' || p === '/api/providers/models' || p === '/api/bonus' || p === '/api/bonus/github' || p === '/api/bonus/rewards') {
      if (req.who !== 'local') return json(res, 403, { error: 'This can only be done on the PC itself.' });
      const o = req.headers.origin;   // the public website is allowed to chat with this PC, but never to approve or stop commands
      if (o && !new RegExp('^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):' + PORT + '$').test(o)) return json(res, 403, { error: 'Approve commands in the Pholama window on this PC.' });
      if (p === '/api/cmd/list') return json(res, 200, { pending: agent.power.list() });
      if (p === '/api/cmd/approve' && req.method === 'POST') {
        const b = await body(req), id = String(b.id || '');
        if (b.approve !== true) return json(res, 200, { ok: agent.power.reject(id), text: 'Denied. Nothing ran.' });
        try { const r = await agent.power.approve(id); return json(res, 200, { ok: r.ok, text: r.text, code: r.code, ms: r.ms, stoppedBy: r.stoppedBy }); }
        catch (e) { return json(res, 200, { ok: false, text: e.message }); }
      }
      if (p === '/api/cmd/stop' && req.method === 'POST') return json(res, 200, { ok: agent.power.stopRunning() });
      if (p === '/api/providers/models' && req.method === 'GET') {   // the models this saved key can really use (asked from the company, key never leaves this PC except to them)
        try { return json(res, 200, await providers.modelsFor(u.searchParams.get('id'))); } catch (e) { return json(res, 400, { error: providers.scrub(e.message) }); }
      }
      if (p === '/api/providers') {   // your own API keys: only on this PC, and the key is never sent back
        if (req.method === 'GET') return json(res, 200, { providers: providers.list(), known: providers.known() });
        if (req.method === 'POST') { try { const b = await body(req); const v = await providers.add(b, agent.sources.checkLink); return json(res, 200, { ok: true, provider: v, note: v.note || '' }); } catch (e) { return json(res, 400, { error: providers.scrub(e.message) }); } }
        if (req.method === 'PATCH') { try { const b = await body(req); return json(res, 200, { ok: true, provider: providers.setModel(b.id, b.model) }); } catch (e) { return json(res, 400, { error: providers.scrub(e.message) }); } }
        if (req.method === 'DELETE') { const id = u.searchParams.get('id'); for (const k of Object.keys(capCache)) if (k === 'byok:' + id) delete capCache[k]; return json(res, 200, { ok: providers.remove(id) }); }
      }
      if (p === '/api/editlog/stream' && req.method === 'GET') {   // live feed of new log entries (server-sent events)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const send = e => { try { res.write('data: ' + JSON.stringify(e) + '\n\n'); } catch {} };
        const stop = agent.power.watch(send);
        if (!stop) { res.end('event: full\ndata: {}\n\n'); return; }
        res.write(': hello\n\n'); const beat = setInterval(() => { try { res.write(': \n\n'); } catch {} }, 20000);
        const done = () => { clearInterval(beat); stop(); }; req.on('close', done); res.on('error', done); return;
      }
      if (p === '/api/editlog' && req.method === 'GET') return json(res, 200, { entries: agent.power.readLog(+u.searchParams.get('n') || 100) });
      if (p === '/api/editlog' && req.method === 'DELETE') return json(res, 200, { ok: agent.power.clearLog() });
      if (p === '/api/bonus' && req.method === 'POST') { try { return json(res, 200, await agent.power.claimBonus(String((await body(req)).token || ''))); } catch (e) { return json(res, 200, { error: e.message, bonus: agent.power.bonusTotal() }); } }
      if (p === '/api/bonus/github' && req.method === 'POST') { try { return json(res, 200, await agent.power.claimGithubBonus(String((await body(req)).token || ''))); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (p === '/api/bonus/rewards' && req.method === 'POST') { try { return json(res, 200, await agent.power.claimRewards(String((await body(req)).token || ''))); } catch (e) { return json(res, 200, { error: String(e.message || e) }); } }
      if (p === '/api/bonus' && req.method === 'GET') return json(res, 200, { bonus: agent.power.bonusTotal() });
    }
    if (p === '/api/credits') return json(res, 200, { ...agent.credits(), allowed: agent.allowed() });
    if (p === '/api/prefs' && req.method === 'POST') return json(res, 200, agent.setPrefs(await body(req)));
    // Plugins: the list with on/off state, and one switch. Skills: list, save, switch, delete, and "make one for me".
    if (p === '/api/plugins' && req.method === 'GET') { const c = agent.credits(); return json(res, 200, { plugins: agent.plugins.list(agent.allowed().prefs, c.left > 0), skills: agent.plugins.listSkills(), check: agent.plugins.selfCheck(agent.allowed().prefs) }); }
    if (p === '/api/plugins/switch' && req.method === 'POST') { const b = await body(req), pl = agent.plugins.PLUGINS.find(x => x.id === b.id); if (!pl) return json(res, 400, { error: 'No such plugin.' }); agent.setPrefs({ [pl.pref]: b.on === true }); return json(res, 200, { ok: true, plugins: agent.plugins.list(agent.allowed().prefs, agent.credits().left > 0) }); }
    if (p === '/api/skills' && req.method === 'POST') { const b = await body(req); try { const slug = agent.plugins.saveSkill(b, 'you'); return json(res, 200, { ok: true, name: slug, skills: agent.plugins.listSkills() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/skills/draft' && req.method === 'POST') {   // the model drafts a skill; NOTHING is saved here, the person reads it first
      const b = await body(req), idea = String(b.idea || '').replace(/\s+/g, ' ').trim().slice(0, 300), model = String(b.model || '');
      if (idea.length < 5) return json(res, 400, { error: 'Say what the skill is for first.' });
      if (!model) return json(res, 400, { error: 'Pick a model at the top first.' });
      try {
        for (let tries = 0; tries < 2; tries++) {
          let text = ''; await streamTurnBase(model, [{ role: 'system', content: agent.plugins.SKILL_WRITER_PROMPT }, { role: 'user', content: 'Skill idea: ' + idea }], { num_predict: 500, temperature: 0.3 }, t => { text += t; }, AbortSignal.timeout(90000), { in: 0, out: 0, got: false });
          const sk = agent.plugins.parseSkillJson(text.replace(/<think>[\s\S]*?(<\/think>|$)/g, ''));
          if (sk && !agent.plugins.skillProblem(sk)) return json(res, 200, { skill: { name: agent.plugins.slugify(sk.name), when: String(sk.when).slice(0, 200), steps: String(sk.steps).slice(0, 1500) } });
        }
        return json(res, 422, { error: 'The AI did not write a usable skill. Try again, or write it yourself.' });
      } catch (e) { return json(res, 500, { error: 'The AI could not write it: ' + String(e.message).slice(0, 120) }); }
    }
    if (p === '/api/skills/switch' && req.method === 'POST') { const b = await body(req); try { agent.plugins.setSkillOn(b.name, b.on === true); return json(res, 200, { ok: true, skills: agent.plugins.listSkills() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/skills/delete' && req.method === 'POST') { const b = await body(req); try { agent.plugins.deleteSkill(b.name); return json(res, 200, { ok: true, skills: agent.plugins.listSkills() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/mcp' && req.method === 'GET') return json(res, 200, { servers: agent.state().mcp.map(x => ({ name: x.name, url: x.url })), tools: await agent.listMcp() });
    if (p === '/api/mcp' && req.method === 'POST') return json(res, 200, { servers: agent.addMcp(await body(req)) });
    if (p === '/api/mcp' && req.method === 'DELETE') { agent.removeMcp(u.searchParams.get('name')); return json(res, 200, { ok: true }); }
    if (p === '/api/update' && req.method === 'GET') return json(res, 200, require('./update').status());
    if (p === '/api/update/check' && req.method === 'POST') return json(res, 200, await require('./update').backgroundCheck());
    if (p === '/api/update/auto' && req.method === 'POST') { const b = await body(req); return json(res, 200, require('./update').setAuto(b.auto !== false)); }
    if (p === '/api/guard') { const n = guardNote; guardNote = null; return json(res, 200, { stopped: n, loaded: !!llama || helperEng.isUp() || ollamaUsed.size > 0 }); }
    if (p === '/api/awake' && req.method === 'POST') { if (req.who !== 'local') return json(res, 403, { error: 'Only this PC can do that.' }); return json(res, 200, { ok: true, woke: sleeper.wake() }); }
    if (p === '/api/sleep' && req.method === 'GET') return json(res, 200, { asleep: sleeper.isAsleep(), idleHours: +(sleeper.idleMs() / 3600000).toFixed(2), limitHours: +(sleeper.limitMs / 3600000).toFixed(2) });
    if (p === '/api/stop-local' && req.method === 'POST') { if (req.who !== 'local') return json(res, 403, { error: 'Only this PC can do that.' }); const had = await stopAllLocal(); return json(res, 200, { ok: true, stopped: had }); }
    if (p === '/api/hardware') { const h = hardware(); return json(res, 200, { hardware: h, ollama: await ollamaUp(), llamaServer: !!findLlamaServer(), toolAI: await hasToolAI(), models: recommend(h) }); }
    if (p === '/api/tags') return json(res, 200, { models: await listModels() });
    if (p === '/api/pull' && req.method === 'POST') { const b = await body(req); const m = CATALOG.find(x => x.id === b.id); if (!m) return json(res, 404, { error: 'unknown model' }); if (!dl[m.id] || dl[m.id].status !== 'downloading') download(m); return json(res, 200, { ok: true }); }
    if (p === '/api/install-llama' && req.method === 'POST') { installLlama(); return json(res, 200, { ok: true }); }
    if (p === '/api/install-llama/status') return json(res, 200, inst);
    if (p === '/api/install-llama/stop' && req.method === 'POST') { stopInstall(); return json(res, 200, { ok: true }); }
    if (p === '/api/install-llama' && req.method === 'DELETE') { await uninstallLlama(); return json(res, 200, { ok: true }); }
    if (p === '/api/pull/stop' && req.method === 'POST') { const b = await body(req); stopDownload(b.id); return json(res, 200, { ok: true }); }
    if (p === '/api/model' && req.method === 'DELETE') { const m = CATALOG.find(x => x.id === new URL(req.url, 'http://x').searchParams.get('id')); if (!m) return json(res, 404, { error: 'unknown model' }); await deleteModel(m); return json(res, 200, { ok: true }); }
    if (p === '/api/pull/status') return json(res, 200, dl);
    if (p === '/api/chat' && req.method === 'POST') {
      const cb = await body(req);
      // Remote callers get plain chat only: the tools, terminal, GitHub and memory never run for a key holder.
      if (req.who !== 'local') { cb.agent = false; cb.memory = false; delete cb.switches; delete cb.tools; }
      if (rest.ms > 0 && Date.now() - lastReplyAt < rest.ms) await new Promise(r => setTimeout(r, rest.ms - (Date.now() - lastReplyAt)));   // low memory: a short rest between replies
      activeReplies++;
      try { return await chat(req, res, cb); } finally { activeReplies--; lastReplyAt = Date.now(); }
    }
    // ---- Ollama / OpenAI style extras so games and sites can use this PC's AI the way they would use Ollama ----
    if (p === '/api/version') return json(res, 200, { version: require('../package.json').version, name: 'pholama' });
    if (p === '/api/ps') return json(res, 200, { models: served ? [{ name: 'gguf:' + served, model: 'gguf:' + served }] : [] });
    if (p === '/api/show' && req.method === 'POST') {
      const b = await body(req), id = String(b.model || b.name || '').replace(/^gguf:/, ''), m = CATALOG.find(x => x.id === id);
      if (!m) return json(res, 404, { error: 'model not found' });
      return json(res, 200, { name: 'gguf:' + m.id, details: { family: m.family, parameter_size: m.params, format: 'gguf' }, capabilities: ['completion'].concat(m.toolTier === 'good' ? ['tools'] : [], (m.caps || []).includes('thinking') ? ['thinking'] : []), context_length: m.ctx, license: m.license });
    }
    if (p === '/v1/completions' && req.method === 'POST') {   // classic text completion: wrap the prompt as one message
      const b = await body(req), pr = Array.isArray(b.prompt) ? b.prompt.join('\n') : String(b.prompt || '');
      if (!pr.trim()) return json(res, 400, { error: { message: 'prompt is required' } });
      let text = '', err = null, buf = '', usage = null;
      const sink = { cors: res.cors, writeHead() {}, on: (ev, f) => res.on(ev, f), setHeader() {}, end() {}, write(c) { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); let o; try { o = JSON.parse(l); } catch { continue; } if (o.error) err = o.error; if (o.usage) usage = o.usage; const t = o.message && o.message.content; if (t && !o.done) text += t; } return true; } };
      await chat(req, sink, { model: String(b.model || ''), messages: [{ role: 'user', content: pr.slice(0, 20000) }], agent: false, options: { ...(+b.max_tokens > 0 ? { num_predict: Math.min(+b.max_tokens, 4096) } : {}), ...(typeof b.temperature === 'number' ? { temperature: b.temperature } : {}) }, effort: 'normal' });
      if (err && !text) return json(res, 502, { error: { message: String(err) } });
      const u = usage || { in: 0, out: 0, total: 0 };
      return json(res, 200, { id: 'cmpl-' + Date.now().toString(36), object: 'text_completion', created: Math.floor(Date.now() / 1000), model: String(b.model || ''), choices: [{ index: 0, text, finish_reason: 'stop' }], usage: { prompt_tokens: u.in, completion_tokens: u.out, total_tokens: u.total } });
    }
    if ((p === '/v1/embeddings' || p === '/api/embed' || p === '/api/embeddings') && req.method === 'POST') {
      const b = await body(req), model = String(b.model || ''), raw = b.input != null ? b.input : b.prompt, inputs = (Array.isArray(raw) ? raw : [raw]).map(x => String(x == null ? '' : x).slice(0, 8000)).filter(Boolean).slice(0, 64);
      if (!inputs.length) return json(res, 400, { error: { message: 'input is required' } });
      try {
        let vecs;
        if (model.startsWith('ollama:')) { const r = await fetch(OLLAMA + '/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.slice(7), input: inputs }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'embedding failed'); vecs = j.embeddings; }
        else { const m = CATALOG.find(x => x.id === model.replace(/^gguf:/, '')); if (!m) return json(res, 404, { error: { message: 'unknown model' } }); if (!fs.existsSync(path.join(MODELS_DIR, m.file))) return json(res, 409, { error: { message: 'Model not downloaded yet' } });
          await startLlama(m.file); const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: inputs }) }); const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'This model cannot make embeddings'); vecs = (j.data || []).map(d => d.embedding); }
        if (p === '/v1/embeddings') return json(res, 200, { object: 'list', model, data: vecs.map((e, i) => ({ object: 'embedding', index: i, embedding: e })), usage: { prompt_tokens: 0, total_tokens: 0 } });
        return json(res, 200, p === '/api/embed' ? { model, embeddings: vecs } : { embedding: vecs[0] });
      } catch (e) { return json(res, 502, { error: { message: String(e.message || e).slice(0, 200) } }); }
    }
    if (p === '/api/docs') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(res.cors || {}) }); return res.end(require('./apidocs').page(PORT)); }
    if (p === '/api/generate' && req.method === 'POST') { // Ollama-compatible generate -> chat
      const b = await body(req); b.messages = [{ role: 'user', content: b.prompt || '' }];
      return chat(req, res, b);
    }
    // static
    let f = path.join(WEB, p === '/' ? 'index.html' : p);
    const inside = f === WEB || f.startsWith(WEB + path.sep);   // "web-other" must not count as inside "web"
    let st; try { st = inside ? fs.statSync(f) : null; } catch { st = null; }
    if (!st || st.isDirectory()) { res.writeHead(404); return res.end('not found'); }
    // The browser must ask this PC every time, otherwise after an update it keeps showing the OLD Studio, pages and icons (it guesses a cache time
    // when there is no header). An ETag makes that check cheap: nothing changed = a tiny "304 not modified" answer, no download.
    const tag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
    const hdr = { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: tag };
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, hdr); return res.end(); }
    res.writeHead(200, { ...hdr, 'Content-Length': st.size }); fs.createReadStream(f).pipe(res);
  } catch (e) { json(res, 500, { error: e.message }); }
});
server.listen(PORT, HOST, () => {
  const h = hardware();
  console.log(`\n  Pholama running\n  Chat UI:  http://localhost:${PORT}\n  RAM: ${h.ramGB} GB${h.gpu ? '  GPU: ' + h.gpu + (h.vramGB ? ' (' + h.vramGB + ' GB)' : '') : ''}\n  Models folder: ${MODELS_DIR}\n`);
  try { require('./update').startBackground(); } catch {}
  if (HOST !== '127.0.0.1') console.log('  Reachable on your network. Open http://<this-PC-IP>:' + PORT + ' on your phone.\n');
});
// ---------- lag guard: if the PC starts struggling, stop the local AIs (and only those) ----------
const guard = require('./guard').createGuard({
  isLoaded: () => !!llama || helperEng.isUp() || ollamaUsed.size > 0,
  startedAt: () => llamaStartedAt,
  stopLocal: () => stopAllLocal(),
  onStop: (why) => { guardNote = { at: Date.now(), why }; console.log('\n  Lag guard: ' + why + '. Stopped all local AIs. Cloud Agent Max is not affected.\n'); },
});
guard.start();
// ---------- sleep: one day with nobody using an AI shuts every local AI down until `pholama awake` ----------
const sleeper = require('./sleep').create({
  isLoaded: () => !!llama || helperEng.isUp() || ollamaUsed.size > 0,
  stopAll: () => stopAllLocal(),
  onSleep: (ms) => console.log('\n  Pholama went to sleep: nobody used an AI for ' + Math.round(ms / 3600000) + ' hours, so every local AI was shut down and the memory is free. Run  pholama awake  to wake it.\n'),
  onWake: () => console.log('\n  Pholama is awake.\n'),
});
sleeper.start(+process.env.PHOLAMA_SLEEP_CHECK_MS || 60000);
// ---------- memory guard: when free memory gets very low (or the AI sat unused for a while) give the memory back. It loads again on the next message. ----------
let memUnloaded = '';
const memTimer = setInterval(async () => {
  try {
    if (!llama || sleeper.isAsleep()) return;
    const level = ram.levelFor(freeMem());
    if (!ram.shouldUnload(level, lastReplyAt, Date.now(), activeReplies > 0)) return;
    const why = level === 'critical' ? ram.describe(level, freeMem()) : 'The AI sat unused for a while, so Pholama unloaded it to free memory. It loads again on your next message.';
    await stopLlama(); llamaReady = false; memUnloaded = why; console.log('\n  ' + why + '\n');
  } catch {}
}, +process.env.PHOLAMA_MEM_CHECK_MS || 30000);
if (memTimer.unref) memTimer.unref();

// ---------- reaper: if Pholama is killed hard (End task, crash), this tiny separate watcher still stops the AI engines ----------
// Started once, detached and hidden. It exits by itself as soon as it has done its job.
function startReaper() {
  try {
    const files = [PIDFILE, helperEng.PIDFILE];
    const r = require('child_process').spawn(process.execPath, [path.join(__dirname, 'reaper.js'), String(process.pid), ...files], { detached: true, stdio: 'ignore', windowsHide: true });
    r.unref();
  } catch (e) { console.log('  (could not start the memory watcher: ' + e.message + ')'); }
}
if (!process.env.PHOLAMA_NO_REAPER) startReaper();

// ---------- closing Pholama closes every local AI, however it is closed ----------
let closing = false;
function closeAll(code) {
  if (closing) return; closing = true;
  try { guard.stop(); } catch {}
  try { sleeper.stop(); } catch {}
  try { clearInterval(memTimer); } catch {}
  killLocalNow();
  for (const m of ollamaUsed) { try { require('child_process').spawnSync(process.execPath, ['-e', `fetch(${JSON.stringify(OLLAMA + '/api/generate')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:${JSON.stringify(m)},keep_alive:0})}).catch(()=>{})`], { timeout: 3000 }); } catch {} }
  process.exit(code || 0);
}
process.on('exit', killLocalNow);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, () => closeAll(0)); } catch {} }
process.on('uncaughtException', e => { console.error('Pholama error:', e && e.stack || e); closeAll(1); });
