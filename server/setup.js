// Pholama Setup (Windows): what the tool-calling runtime needs, what is installed, what is missing, sizes, and a total against 1 GB.
// The AI model is the user's own choice and is NOT counted or forced: the 1 GB budget covers everything else (app, Node, engine, Python).
// The report is a pure function of facts the server already knows, so it is testable without downloading anything.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

const BUDGET_MB = 1024;
const SIZES = Object.freeze({ app: 70, node: 30, engineCpu: 19, engineCuda: 252, python: 11 });   // measured Oct 2026
const homeDir = () => process.env.PHOLAMA_HOME || path.join(os.homedir(), '.pholama');
const pythonDir = () => path.join(homeDir(), 'python');
const pythonExe = () => path.join(pythonDir(), 'python.exe');
const mb = n => n >= 1024 ? (n / 1024).toFixed(2) + ' GB' : Math.round(n) + ' MB';

// facts: { hardware:{gpu}, llamaServer:bool, ollama:bool, python:{installed,version}, nodePrivate:bool, models:[{id,downloaded}] }
function report(facts) {
  const f = facts || {}, nvidia = !!(f.hardware && f.hardware.gpu && /nvidia/i.test(f.hardware.gpu));
  const items = [
    { id: 'app', name: 'Pholama app and server', mb: SIZES.app, installed: true, required: true },
    { id: 'node', name: 'Node.js (private copy)', mb: SIZES.node, installed: f.nodePrivate !== false, required: true },
    { id: 'engine', name: nvidia ? 'Model engine, NVIDIA build (llama.cpp)' : 'Model engine (llama.cpp)', mb: nvidia ? SIZES.engineCuda : SIZES.engineCpu, installed: !!f.llamaServer || !!f.ollama, required: true, action: 'install-engine' },
    { id: 'python', name: 'Python' + (f.python && f.python.version ? ' ' + f.python.version : ''), mb: SIZES.python, installed: !!(f.python && f.python.installed), required: false, action: 'install-python', note: 'Lets the AI run .py files and Python tools.' },
  ];
  const missing = items.filter(i => !i.installed), downloadMb = missing.reduce((a, i) => a + i.mb, 0), totalMb = items.reduce((a, i) => a + i.mb, 0);
  const haveModel = Array.isArray(f.models) && f.models.some(m => m && m.downloaded);
  return { items, missing: missing.map(i => i.id), downloadMb, totalMb, budgetMb: BUDGET_MB, underBudget: totalMb <= BUDGET_MB, headroomMb: BUDGET_MB - totalMb,
    runtimeReady: items.filter(i => i.required).every(i => i.installed), haveModel,
    modelNote: haveModel ? 'You have a model.' : 'Pick any model you like in Models. Nothing is chosen for you, and models are not counted in the 1 GB.' };
}
function describe(r) { return r.items.map(i => (i.installed ? '[x] ' : '[ ] ') + i.name + '  ' + mb(i.mb)).join('\n') + '\n\nRuntime total ' + mb(r.totalMb) + ' of ' + mb(r.budgetMb) + (r.underBudget ? ' (under 1 GB)' : ' (OVER 1 GB)') + (r.missing.length ? '. Still to download: ' + mb(r.downloadMb) + '.' : '. Everything is installed.'); }

// ---- Python: the Windows embeddable build, from python.org only ----
const PY_VERSION = '3.12.8', PY_URL = `https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`, PY_MAX = 40 * 1048576;
const PY_HOST_OK = u => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'www.python.org'; } catch { return false; } };
function detectPython() {
  if (fs.existsSync(pythonExe())) return { installed: true, where: pythonExe(), own: true, version: PY_VERSION };
  for (const c of ['python', 'py']) {
    try { const r = require('child_process').spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 4000, windowsHide: true }); const t = String(r.stdout || r.stderr || '').trim(); if (r.status === 0 && /^Python \d/.test(t)) return { installed: true, where: c, own: false, version: t.slice(7) }; } catch {}
  }
  return { installed: false };
}
async function installPython(progress, signal, url) {
  const say = progress || (() => {}), src = url || PY_URL;
  if (!PY_HOST_OK(src)) throw new Error('Python can only be downloaded from python.org.');
  const zip = path.join(homeDir(), 'python-embed.zip'); fs.mkdirSync(homeDir(), { recursive: true }); say('Downloading Python (about 11 MB)...', 0, 0);
  const r = await fetch(src, { signal, headers: { 'User-Agent': 'pholama' } });
  if (!r.ok) throw new Error('Could not download Python (HTTP ' + r.status + ').');
  const total = +r.headers.get('content-length') || 0; if (total > PY_MAX) throw new Error('The Python download is larger than expected. Stopped.');
  const chunks = []; let done = 0;
  try { for await (const c of r.body) { chunks.push(c); done += c.length; if (done > PY_MAX) throw new Error('The Python download is larger than expected. Stopped.'); say('Downloading Python...', done, total); } }
  catch (e) { if (/larger than expected/.test(e.message)) throw e; throw new Error('The Python download was cut short (the connection dropped). Try again.'); }
  const buf = Buffer.concat(chunks);
  if (total && buf.length !== total) throw new Error('The Python download was cut short. Try again.');
  if (buf.slice(0, 2).toString() !== 'PK') throw new Error('The Python download is not a zip file. Stopped.');
  fs.writeFileSync(zip, buf); say('Unpacking Python...', done, total); fs.mkdirSync(pythonDir(), { recursive: true });
  const t = require('child_process').spawnSync('tar', ['-xf', zip, '-C', pythonDir()], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  try { fs.unlinkSync(zip); } catch {}
  if (t.status !== 0 || !fs.existsSync(pythonExe())) throw new Error('Could not unpack Python: ' + String(t.stderr || t.error || '').slice(0, 160));
  return { ok: true, where: pythonExe(), version: PY_VERSION };
}
// Should first-run auto-install run now? prior = the saved { ok, tries } or null. Never on other systems, never when switched off,
// never once it worked, and never more than 3 failed tries (so no internet cannot make it loop forever).
function shouldAutoSetup(platform, env, prior) {
  if (platform !== 'win32' || (env && env.PHOLAMA_NO_AUTOSETUP === '1')) return false;
  if (prior && (prior.ok || (prior.tries || 0) >= 3)) return false;
  return true;
}
module.exports = { shouldAutoSetup, BUDGET_MB, SIZES, PY_VERSION, PY_URL, PY_HOST_OK, report, describe, mb, detectPython, installPython, pythonExe, pythonDir };
