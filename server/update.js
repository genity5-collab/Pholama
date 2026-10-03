// Pholama updater. Replaces the program files with the newest version from GitHub.
// Your models, keys, accounts and settings live in ~/.pholama and are never touched.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), http = require('http');
const lib = u => u.startsWith('http://') ? http : https;
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = process.env.PHOLAMA_REPO || 'genity5-collab/Pholama';
const BRANCH = process.env.PHOLAMA_BRANCH || 'main';
const RAW = process.env.PHOLAMA_UPDATE_BASE || `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;   // overridable for testing or your own mirror
const ARCHIVE = process.env.PHOLAMA_UPDATE_ARCHIVE || `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz`;
// Program files that an update may replace. Anything else in the folder is left alone.
const KEEP = new Set(['.git', 'node_modules', 'bin']);
const localVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0'; } catch { return '0'; } };

function getText(url, hops = 0) {
  return new Promise((resolve, reject) => {
    lib(url).get(url, { headers: { 'User-Agent': 'pholama' } }, r => {
      if ([301, 302, 307, 308].includes(r.statusCode) && hops < 5) { r.resume(); return resolve(getText(new URL(r.headers.location, url).href, hops + 1)); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d));
    }).on('error', reject).setTimeout(15000, function () { this.destroy(new Error('timed out')); });
  });
}
function getFile(url, dest, hops = 0) {
  return new Promise((resolve, reject) => {
    lib(url).get(url, { headers: { 'User-Agent': 'pholama' } }, r => {
      if ([301, 302, 307, 308].includes(r.statusCode) && hops < 5) { r.resume(); return resolve(getFile(new URL(r.headers.location, url).href, dest, hops + 1)); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const f = fs.createWriteStream(dest); r.pipe(f); f.on('finish', () => f.close(resolve)); f.on('error', reject); r.on('error', reject);
    }).on('error', reject).setTimeout(60000, function () { this.destroy(new Error('timed out')); });
  });
}
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; } return 0; };

// Returns { current, latest, newer } or throws when GitHub cannot be reached.
async function check() {
  const pkg = JSON.parse(await getText(RAW + '/package.json'));
  const current = localVersion();
  return { current, latest: pkg.version || '0', newer: cmp(pkg.version || '0', current) > 0 };
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (KEEP.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}

async function update({ log = console.log, color = {}, force = false } = {}) {
  const g = color.green || (x => x), r = color.red || (x => x), d = color.dim || (x => x);
  log('Checking for a newer Pholama...');
  let info;
  try { info = await check(); } catch (e) { log(r('Could not reach GitHub (' + e.message + '). Your current version keeps working.')); return { ok: false }; }
  if (!info.newer && !force) { log(g('You are up to date. ') + d('Version ' + info.current)); return { ok: true, updated: false }; }
  log(`Updating ${info.current} -> ${info.latest} ...`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pholama-up-'));
  try {
    const tgz = path.join(tmp, 'p.tgz');
    await getFile(ARCHIVE, tgz);
    execSync(`tar -xzf "${tgz}" -C "${tmp}"`, { stdio: 'ignore' });
    const dir = fs.readdirSync(tmp).map(n => path.join(tmp, n)).find(p => fs.statSync(p).isDirectory());
    if (!dir || !fs.existsSync(path.join(dir, 'server', 'server.js')) || !fs.existsSync(path.join(dir, 'models.pc.json'))) throw new Error('The downloaded update looked incomplete, so nothing was changed.');
    JSON.parse(fs.readFileSync(path.join(dir, 'models.pc.json'), 'utf8'));   // refuse a broken catalog
    // keep a copy of the current version so a bad update can be undone by hand
    const backup = path.join(os.homedir(), '.pholama', 'previous-version');
    try { fs.rmSync(backup, { recursive: true, force: true }); copyTree(ROOT, backup); } catch {}
    copyTree(dir, ROOT);
    if (process.platform !== 'win32') { for (const f of ['start.sh', 'server/server.js', 'server/cli.js']) try { fs.chmodSync(path.join(ROOT, f), 0o755); } catch {} }
    log(g(`Updated to ${info.latest}. `) + 'Restart Pholama to use it:  pholama stop   then   pholama start');
    return { ok: true, updated: true, version: info.latest };
  } catch (e) {
    log(r('Update failed: ' + e.message + ' Nothing was broken; your current version keeps working.'));
    return { ok: false };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

// ---- background updates: the running app checks GitHub now and then, downloads quietly, and tells the page ----
const HOME = path.join(os.homedir(), '.pholama'), SET = path.join(HOME, 'update.json');
const readSet = () => { try { return JSON.parse(fs.readFileSync(SET, 'utf8')); } catch { return {}; } };
const writeSet = o => { try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(SET, JSON.stringify(o)); } catch {} };
const status = { current: localVersion(), latest: null, ready: false, checking: false, lastCheck: null, error: null, auto: readSet().auto !== false };
let timer = null;
async function backgroundCheck() {
  if (status.checking) return status;
  status.checking = true; status.error = null;
  try {
    const info = await check(); status.latest = info.latest; status.lastCheck = Date.now();
    if (info.newer && status.auto) {
      const r = await update({ log() {} });               // quiet: only program files change
      if (r.updated) { status.ready = true; status.current = localVersion(); }
      else if (!r.ok) status.error = 'Could not install the update. Your current version keeps working.';
    } else if (info.newer) status.ready = false;
  } catch (e) { status.error = 'Could not reach GitHub.'; status.lastCheck = Date.now(); }
  status.checking = false; return status;
}
// Checks shortly after start, then every 6 hours. Never throws, never blocks the app.
function startBackground(hours = 6) {
  if (timer || process.env.PHOLAMA_NO_AUTOUPDATE === '1') return;
  setTimeout(() => backgroundCheck().catch(() => {}), 20000).unref();
  timer = setInterval(() => backgroundCheck().catch(() => {}), hours * 3600 * 1000); timer.unref();
}
function setAuto(on) { status.auto = !!on; writeSet({ ...readSet(), auto: !!on }); return status; }
// 'running' is the version this process started with; 'current' is what is on disk now. They differ after an update until you restart.
const RUNNING = localVersion();
module.exports = { update, check, localVersion, status: () => ({ ...status, running: RUNNING, current: localVersion(), ready: status.ready && cmp(localVersion(), RUNNING) > 0 }), backgroundCheck, startBackground, setAuto };
