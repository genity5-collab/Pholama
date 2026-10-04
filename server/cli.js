#!/usr/bin/env node
// Pholama command line.  pholama pull|chat|rm|serve|list|stop|update|remove-all|help
// The CLI talks to the Pholama server on this PC and starts it in the background if it is not running.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), readline = require('readline');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 11435;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = path.join(os.homedir(), '.pholama');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'models.pc.json'), 'utf8'));
for (const m of CATALOG) m.command = 'pholama pull ' + m.id;
const tty = process.stdout.isTTY;
const c = (n, s) => tty ? `\x1b[${n}m${s}\x1b[0m` : s;
const bold = s => c(1, s), dim = s => c(2, s), red = s => c(31, s), green = s => c(32, s), cyan = s => c(36, s), yellow = s => c(33, s);
const gb = b => (b / 2 ** 30).toFixed(2) + ' GB';
const mb = b => b >= 2 ** 30 ? gb(b) : (b / 2 ** 20).toFixed(0) + ' MB';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LABEL = { tools: 'tool running', reasoning: 'reasoning', fast: 'fast', slow: 'slow' };

function find(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/^gguf:/, '');
  return CATALOG.find(m => m.id === n) || null;
}
function suggest(name) {
  const n = String(name || '').toLowerCase();
  const near = CATALOG.filter(m => m.id.includes(n) || n.includes(m.id.split('-')[0])).slice(0, 5).map(m => m.id);
  return near.length ? ' Did you mean: ' + near.join(', ') + '?' : ' Run "pholama list" to see all models.';
}
function need(name, verb) {
  const m = find(name);
  if (!m) { console.error(red(`No model called "${name || ''}".`) + suggest(name)); process.exit(1); }
  return m;
}

// ---------- talking to the server ----------
function req(method, p, data, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = data == null ? null : JSON.stringify(data);
    const r = http.request(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
      if (raw) return resolve(res);
      let d = ''; res.on('data', x => d += x); res.on('end', () => { let j = {}; try { j = JSON.parse(d || '{}'); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}
async function up() { try { return (await req('GET', '/api/auth')).status === 200; } catch { return false; } }
async function ensureServer() {
  if (await up()) return;
  fs.mkdirSync(HOME, { recursive: true });
  const log = fs.openSync(path.join(HOME, 'server.log'), 'a');
  // In the single-file app, process.execPath is the launcher itself, so the script goes after --run (and the loop guard is cleared).
  const viaLauncher = !!process.env.PHOLAMA_LAUNCHER;
  const env = { ...process.env }; delete env.PHOLAMA_LAUNCHED;
  const child = spawn(process.execPath, viaLauncher ? ['--run', path.join(__dirname, 'server.js')] : [path.join(__dirname, 'server.js')], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env });
  child.unref();
  fs.writeFileSync(path.join(HOME, 'server.pid'), String(child.pid));
  for (let i = 0; i < 40; i++) { if (await up()) return; await sleep(250); }
  console.error(red('Could not start the Pholama server. See ' + path.join(HOME, 'server.log'))); process.exit(1);
}

// ---------- commands ----------
function printModel(m, state) {
  const cats = (m.categories || []).map(k => LABEL[k] || k).join(', ') || 'general';
  const mark = state === 'done' ? green('installed') : state === 'partial' ? yellow('partial') : dim('not installed');
  console.log(`${bold(m.id.padEnd(22))} ${String(gb(m.bytes || m.sizeGB * 2 ** 30)).padStart(9)}   ${mark.padEnd(state ? 24 : 24)} ${dim(cats)}`);
  console.log(`  ${cyan(m.command)}`);
}
async function cmdList(args) {
  const want = (args.find(a => a.startsWith('--')) || '').slice(2);
  let models = CATALOG.filter(m => !want || (m.categories || []).includes(want === 'tool' ? 'tools' : want));
  let have = {};
  if (await up()) { try { for (const m of (await req('GET', '/api/hardware')).json.models || []) have[m.id] = m.downloaded ? 'done' : m.partial ? 'partial' : ''; } catch {} }
  else for (const m of CATALOG) { const f = path.join(HOME, 'models', m.file); have[m.id] = fs.existsSync(f) ? 'done' : fs.existsSync(f + '.part') ? 'partial' : ''; }
  for (const k of ['tools', 'reasoning', 'fast', 'slow']) {
    const g = models.filter(m => (m.categories || []).includes(k)); if (!g.length) continue;
    console.log('\n' + bold(c(36, LABEL[k].toUpperCase())));
    for (const m of g) printModel(m, have[m.id]);
  }
  const other = models.filter(m => !(m.categories || []).length);
  if (other.length) { console.log('\n' + bold(c(36, 'GENERAL'))); for (const m of other) printModel(m, have[m.id]); }
  console.log('\n' + dim('Filter: pholama list --tools | --reasoning | --fast | --slow'));
}

function bar(p, w = 28) { const f = Math.round(p / 100 * w); return '[' + '#'.repeat(f) + '-'.repeat(w - f) + ']'; }
async function cmdPull(name) {
  const m = need(name);
  await ensureServer();
  const bytes = m.bytes || m.sizeGB * 2 ** 30;
  console.log(`${bold(m.name || m.id)}  ${dim('size ' + gb(bytes))}`);
  const st = (await req('GET', '/api/hardware')).json.models.find(x => x.id === m.id);
  if (st && st.downloaded) { console.log(green('Already installed. ') + 'Chat with:  ' + cyan('pholama chat ' + m.id)); return; }
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    try { await req('POST', '/api/pull/stop', { id: m.id }); } catch {}
    process.stdout.write('\n' + yellow('Stopped. ') + 'Nothing is lost. Continue with:  ' + cyan('pholama pull ' + m.id) + '\n' + dim('Remove it completely with:  pholama rm ' + m.id) + '\n');
    process.exit(130);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(dim('Press Ctrl+C any time to stop. It resumes where it left off.'));
  const r = await req('POST', '/api/pull', { id: m.id });
  if (r.status >= 400) { console.error(red(r.json.error || 'Could not start the download.')); process.exit(1); }
  let lastLen = 0;
  for (;;) {
    await sleep(500);
    let d; try { d = (await req('GET', '/api/pull/status')).json[m.id]; } catch { console.error(red('\nLost contact with the Pholama server.')); process.exit(1); }
    if (!d) continue;
    if (d.status === 'error') { console.error('\n' + red(d.error || 'Download failed.') + ' Run the same command again to resume.'); process.exit(1); }
    const total = d.total || bytes, p = Math.min(100, total ? d.done / total * 100 : 0);
    const eta = d.speed > 0 ? Math.max(0, Math.round((total - d.done) / d.speed)) : 0;
    const line = `${bar(p)} ${p.toFixed(1).padStart(5)}%  ${mb(d.done)} / ${mb(total)}  ${d.speed ? mb(d.speed) + '/s' : ''}${eta ? '  ~' + (eta >= 60 ? Math.floor(eta / 60) + 'm ' + (eta % 60) + 's' : eta + 's') : ''}`;
    if (tty) process.stdout.write('\r' + line + ' '.repeat(Math.max(0, lastLen - line.length))); else if (Math.round(p) % 10 === 0) console.log(line);
    lastLen = line.length;
    if (d.status === 'done') { console.log('\n' + green('Done. ') + 'Chat with:  ' + cyan('pholama chat ' + m.id)); return; }
    if (d.status === 'stopped' && !stopping) { console.log('\n' + yellow('Stopped.')); return; }
  }
}

async function ensureInstalled(m) {
  const st = (await req('GET', '/api/hardware')).json.models.find(x => x.id === m.id);
  if (!st || !st.downloaded) { console.error(red(`${m.id} is not installed.`) + '  Install it with:  ' + cyan(m.command)); process.exit(1); }
}
async function ensureEngine() {
  const h = (await req('GET', '/api/hardware')).json;
  if (h.llamaServer) return;
  console.log(yellow('The engine that runs models (llama.cpp) is not installed yet. Installing it once...'));
  await req('POST', '/api/install-llama');
  for (;;) {
    await sleep(700); const s = (await req('GET', '/api/install-llama/status')).json;
    if (tty) process.stdout.write('\r' + (s.step || '') + (s.total ? '  ' + Math.round(s.done / s.total * 100) + '%' : '') + '      ');
    if (s.status === 'done') { console.log('\n' + green('Engine installed.')); return; }
    if (s.status === 'error') { console.error('\n' + red(s.error)); process.exit(1); }
  }
}

async function streamChat(model, messages) {
  const res = await req('POST', '/api/chat', { model: 'gguf:' + model, messages, agent: false }, { raw: true });
  let buf = '', out = '', err = null;
  await new Promise(resolve => {
    res.on('data', ch => {
      buf += ch; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
        let o; try { o = JSON.parse(l); } catch { continue; }
        if (o.error) err = o.error;
        const t = o.message && o.message.content; if (t && !o.done) { out += t; process.stdout.write(t); }
      }
    });
    res.on('end', resolve); res.on('close', resolve);
  });
  if (err && !out) console.error(red(String(err)));
  return out;
}
async function cmdChat(name) {
  const m = need(name);
  await ensureServer(); await ensureInstalled(m); await ensureEngine();
  console.log(bold(m.name || m.id) + dim('   (type /exit or press Ctrl+C to leave, /new for a fresh chat)'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: cyan('> ') });
  let history = [], busy = false;
  rl.on('SIGINT', () => { if (busy) return; rl.close(); });
  rl.on('close', () => { console.log(dim('\nChat closed.')); process.exit(0); });
  rl.prompt();
  rl.on('line', async line => {
    const t = line.trim();
    if (!t) return rl.prompt();
    if (t === '/exit' || t === '/quit' || t === '/bye') return rl.close();
    if (t === '/new') { history = []; console.log(dim('New chat.')); return rl.prompt(); }
    busy = true; history.push({ role: 'user', content: t });
    try { const out = await streamChat(m.id, history.slice(-20)); history.push({ role: 'assistant', content: out }); } catch (e) { console.error(red(e.message)); }
    busy = false; process.stdout.write('\n'); rl.prompt();
  });
}

async function cmdRm(name) {
  const m = need(name);
  await ensureServer();
  const r = await req('DELETE', '/api/model?id=' + encodeURIComponent(m.id));
  if (r.status >= 400) { console.error(red(r.json.error || 'Could not remove it.')); process.exit(1); }
  console.log(green('Removed ') + m.id + dim(' (model file, partial download and its folders).'));
}

async function cmdRemoveAll(args) {
  const code = await require('./uninstall').run(args, {
    log: console.log, appRoot: ROOT, color: { red, green, dim, yellow, bold },
    stopServer: async () => { if (await up()) { try { await req('POST', '/api/shutdown'); } catch {} } try { fs.unlinkSync(path.join(HOME, 'server.pid')); } catch {} },
  });
  process.exit(code);
}

async function cmdServe(name, args) {
  const m = need(name);
  await ensureServer(); await ensureInstalled(m); await ensureEngine();
  console.log(bold(m.name || m.id) + ' is ready on this PC only.\n');
  console.log(`  OpenAI compatible:  ${cyan(BASE + '/v1')}   ${dim('model name: gguf:' + m.id)}`);
  console.log(`  Ollama compatible:  ${cyan(BASE + '/api/chat')}`);
  console.log(`  Web chat:           ${cyan(BASE)}\n`);
  console.log(dim('Example:  curl ' + BASE + '/v1/chat/completions -H "Content-Type: application/json" -d \'{"model":"gguf:' + m.id + '","messages":[{"role":"user","content":"Hello"}]}\''));
  console.log(dim('Only this PC can use it (127.0.0.1). Press Ctrl+C to stop serving.\n'));
  process.on('SIGINT', async () => { try { await req('POST', '/api/serve/stop'); } catch {} console.log('\nStopped serving.'); process.exit(0); });
  await req('POST', '/api/serve', { id: m.id });
  // warm the model so the first app request is fast
  try { await req('POST', '/api/chat', { model: 'gguf:' + m.id, messages: [{ role: 'user', content: 'hi' }], agent: false, options: { num_predict: 1 } }); } catch {}
  console.log(green('Serving. Keep this window open.'));
  await new Promise(() => {});
}

async function cmdAwake() {
  if (!(await up())) { console.log('Pholama is not running, so nothing is asleep. Start it with:  ' + cyan('pholama start')); return; }
  let st = null; try { st = (await req('GET', '/api/sleep')).json; } catch {}
  if (st && !st.asleep) { console.log(green('Pholama is already awake.') + ' (idle for ' + st.idleHours + ' h, it sleeps after ' + st.limitHours + ' h)'); return; }
  try { const r = (await req('POST', '/api/awake')).json; console.log(r && r.woke ? green('Pholama is awake.') + ' Your AIs load again the next time you chat.' : green('Pholama is awake.')); }
  catch (e) { console.error(red('Could not wake Pholama: ' + e.message)); process.exit(1); }
}
async function cmdStop() {
  if (!(await up())) return console.log('Pholama is not running.');
  try { await req('POST', '/api/shutdown'); } catch {}
  try { fs.unlinkSync(path.join(HOME, 'server.pid')); } catch {}
  console.log(green('Pholama stopped.'));
}

async function cmdUpdate() {
  const { update } = require('./update');
  await update({ log: console.log, color: { green, red, dim, yellow } });
}

function help() {
  console.log(`
${bold('Pholama')}  AI models on your own PC

  ${cyan('pholama list')}            all models with size, category and install command
  ${cyan('pholama pull <model>')}    download a model (shows size and %). Ctrl+C stops it, run again to resume
  ${cyan('pholama chat <model>')}    chat in this window until you close it
  ${cyan('pholama serve <model>')}   let this PC and your apps use the model at ${BASE}
  ${cyan('pholama rm <model>')}      remove the model and all its files and folders
  ${cyan('pholama update')}          get the newest Pholama without reinstalling
  ${cyan('pholama awake')}           wake Pholama after it slept (it sleeps when no AI was used for a day, to free your memory)
  ${cyan('pholama stop')}            stop the background server
  ${cyan('pholama remove-all')}      remove Pholama, its models, folders, command and icons from this PC (asks first; --dry-run only lists)
  ${cyan('pholama web')}             open the chat page in your browser

Categories: tool running, reasoning, fast, slow.  Example:  ${cyan('pholama pull qwen2.5-3b')}
`);
}

async function cmdWeb() {
  await ensureServer();
  const u = BASE, cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
  try { execSync(cmd, { stdio: 'ignore', windowsHide: true }); } catch {}
  console.log('Open ' + cyan(u));
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.find(a => !a.startsWith('--'));
  try {
    switch ((cmd || 'help').toLowerCase()) {
      case 'list': case 'ls': case 'models': return await cmdList(rest);
      case 'pull': case 'install': case 'download': return await cmdPull(arg);
      case 'chat': case 'run': return await cmdChat(arg);
      case 'remove-all': case 'uninstall-all': case 'remove-pholama': case 'uninstall-pholama': return await cmdRemoveAll(rest);
      case 'uninstall': if (!arg) { console.log('To remove ' + bold('all of Pholama') + ' from this PC run:  ' + cyan('pholama remove-all') + '\nTo remove one model run:  ' + cyan('pholama uninstall <model>')); return; } return await cmdRm(arg);
      case 'rm': case 'remove': case 'delete': return await cmdRm(arg);
      case 'serve': return await cmdServe(arg, rest);
      case 'stop': return await cmdStop();
      case 'awake': case 'wake': case 'wakeup': return await cmdAwake();
      case 'update': case 'upgrade': return await cmdUpdate();
      case 'web': case 'open': return await cmdWeb();
      case 'start': await ensureServer(); console.log(green('Pholama is running at ') + cyan(BASE)); return;
      case 'help': case '--help': case '-h': return help();
      default: console.error(red(`Unknown command "${cmd}".`)); help(); process.exit(1);
    }
  } catch (e) { console.error(red(e.message)); process.exit(1); }
})();
