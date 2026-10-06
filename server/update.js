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

// ---- downloading: built to survive slow or blocked routes (IPv6 trouble, VPNs, some ISPs) ----
// Each attempt forces IPv4 (family: 4) because a dead IPv6 route is the usual cause of "timed out".
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getOnce(url, { timeout, dest } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = lib(url).get(url, { headers: { 'User-Agent': 'pholama' }, family: 4 }, r => {
      if ([301, 302, 307, 308].includes(r.statusCode) && hops < 5) { r.resume(); return resolve(getOnce(new URL(r.headers.location, url).href, { timeout, dest }, hops + 1)); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      if (dest) { const f = fs.createWriteStream(dest); r.pipe(f); f.on('finish', () => f.close(() => resolve(dest))); f.on('error', reject); r.on('error', reject); }
      else { let d = ''; r.setEncoding('utf8'); r.on('data', c => d += c); r.on('end', () => resolve(d)); r.on('error', reject); }
    });
    req.on('error', reject); req.setTimeout(timeout, () => req.destroy(new Error('timed out')));
  });
}
// The same download using the computer's own tool. curl.exe ships with Windows 10+, PowerShell with every Windows.
function viaSystem(url, dest, limit = 45) {
  const { execFileSync } = require('child_process');
  const tries = process.platform === 'win32'
    ? [['curl.exe', ['-fsSL', '--connect-timeout', '10', '-m', String(limit), '-A', 'pholama', '-o', dest, url]], ['powershell', ['-NoProfile', '-Command', `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -UserAgent pholama -TimeoutSec ${limit} -Uri '${url}' -OutFile '${dest}'`]]]
    : [['curl', ['-fsSL', '--connect-timeout', '10', '-m', String(limit), '-A', 'pholama', '-o', dest, url]], ['wget', ['-q', '-T', String(Math.min(limit, 30)), '-U', 'pholama', '-O', dest, url]]];
  let last;
  for (const [cmd, args] of tries) { try { execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout: (limit + 10) * 1000 }); if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest; } catch (e) { last = e; } }
  throw new Error('no system download tool worked' + (last ? ' (' + String(last.message).split('\n')[0].slice(0, 60) + ')' : ''));
}
// Try every address in order. A route that HANGS is given up on quickly (it will not recover), while a route that
// fails fast (connection reset, HTTP 5xx) is retried. Each address then gets one go with the computer's own tool.
// `budget` caps the whole thing so "check for update" can never freeze.
async function fetchAny(urls, { dest, timeout = 12000, budget = 90000, sysLimit = 45 } = {}) {
  const errs = [], end = Date.now() + budget, left = () => end - Date.now();
  for (const url of urls) {
    if (left() <= 0) break;
    const host = new URL(url).host;
    let definite = false;   // the server answered and said no (404 etc): no other download tool will change that
    for (let a = 0; a < 3 && left() > 0; a++) {
      try { return await getOnce(url, { timeout: Math.min(timeout, left()), dest }); }
      catch (e) {
        errs.push(host + ': ' + e.message);
        if (/HTTP 4\d\d/.test(e.message)) { definite = true; break; }
        if (/timed out/.test(e.message)) break;   // not worth retrying: a 404 stays a 404 and a hang stays a hang
        await sleep(600 * (a + 1));
      }
    }
    if (!definite && left() > 5000) {
      try { const t = dest || path.join(os.tmpdir(), 'pholama-dl-' + process.pid + '.txt'); viaSystem(url, t, Math.min(sysLimit, Math.floor(left() / 1000))); if (dest) return dest; const txt = fs.readFileSync(t, 'utf8'); try { fs.unlinkSync(t); } catch {} return txt; }
      catch (e) { errs.push(host + ' (system tool): ' + e.message); }
    }
  }
  const why = [...new Set(errs)].slice(-3).join('; ');
  throw new Error(/timed out|ENOTFOUND|ECONN|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|system tool/.test(why) ? 'cannot reach GitHub from this PC. Check your internet, turn off any VPN or proxy, or allow Pholama/Node through your firewall. Details: ' + why : why);
}
const textUrls = () => [RAW + '/package.json', `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/package.json`];
const archiveUrls = () => [ARCHIVE, `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`];
const getText = url => fetchAny([url]);
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; } return 0; };

// Returns { current, latest, newer } or throws when GitHub cannot be reached.
async function check() {
  const current = localVersion();
  // Fresh answer first: the commits API is cached for 1 minute, the raw file for 5. Skipped when a test or mirror supplies its own address.
  if (!process.env.PHOLAMA_UPDATE_BASE && !process.env.PHOLAMA_NO_FRESH) {
    try { const f = await require('./freshcheck').latest({ repo: REPO, branch: BRANCH }); if (f.ok) return { current, latest: f.version || '0', newer: cmp(f.version || '0', current) > 0, sha: f.sha }; } catch {}
  }
  const pkg = JSON.parse(await fetchAny(process.env.PHOLAMA_UPDATE_BASE ? [RAW + '/package.json'] : textUrls()));
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
  try { info = await check(); } catch (e) { log(r('Could not update: ' + e.message + '. Your current version keeps working.')); return { ok: false }; }
  if (!info.newer && !force) { log(g('You are up to date. ') + d('Version ' + info.current)); return { ok: true, updated: false }; }
  log(`Updating ${info.current} -> ${info.latest} ...`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pholama-up-'));
  try {
    const tgz = path.join(tmp, 'p.tgz');
    await fetchAny(process.env.PHOLAMA_UPDATE_ARCHIVE ? [ARCHIVE] : archiveUrls(), { dest: tgz, timeout: 60000 });
    execSync(`tar -xzf "${tgz}" -C "${tmp}"`, { stdio: 'ignore', windowsHide: true });
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
const status = { current: localVersion(), latest: null, ready: false, checking: false, restarting: false, lastCheck: null, error: null, auto: readSet().auto !== false };
let timer = null, restartHandler = null, checkTask = null;
// The server supplies this callback so automatic updates can replace the running process.
// Keeping it injectable makes the updater safe to use from the CLI and easy to test.
function setRestartHandler(fn) { restartHandler = typeof fn === 'function' ? fn : null; return status; }
async function backgroundCheck({ installNow = false } = {}) {
  if (checkTask) {
    await checkTask;
    if (installNow && !status.ready && status.latest && cmp(status.latest, localVersion()) > 0) return backgroundCheck({ installNow: true });
    return status;
  }
  status.checking = true; status.error = null;
  const work = (async () => {
    try {
      const info = await check(); status.latest = info.latest; status.lastCheck = Date.now();
      if (info.newer && (status.auto || installNow)) {
        const r = await update({ log() {} });               // quiet: only program files change
        if (r.updated) {
          status.ready = true; status.current = localVersion();
          // A downloaded update is not useful while the old JS is still serving the UI.
          // Restart only when this is the long-running PC server; manual/CLI updates keep the old behavior.
          if (restartHandler) { status.restarting = true; try { restartHandler(info.latest); } catch (e) { status.error = 'Update installed, but automatic restart failed.'; } }
        }
        else if (!r.ok) status.error = 'Could not install the update. Your current version keeps working.';
      } else if (info.newer) status.ready = false;
    } catch (e) { status.error = 'Could not reach GitHub.'; status.lastCheck = Date.now(); }
    finally { status.checking = false; }
    return status;
  })();
  const tracked = work.finally(() => { if (checkTask === tracked) checkTask = null; });
  checkTask = tracked;
  return tracked;
}
// Checks shortly after start, then every minute (server.js passes 1/60 hour). Never throws, never blocks the app.
function startBackground(hours = 6) {
  if (timer || process.env.PHOLAMA_NO_AUTOUPDATE === '1') return;
  setTimeout(() => backgroundCheck().catch(() => {}), 1500).unref();
  timer = setInterval(() => backgroundCheck().catch(() => {}), hours * 3600 * 1000); timer.unref();
}
// Scheduled OS task: respect the user's auto-update setting and do nothing if the app is running;
// the live server performs its own more-frequent check and owns restart handling.
async function offlineCheck({ log = () => {}, isRunning, runUpdate = update } = {}) {
  if (readSet().auto === false) return { ok: true, skipped: 'automatic-updates-off' };
  let running = false;
  try {
    if (isRunning) running = await isRunning();
    else running = await new Promise(resolve => {
      let savedPort = 0; try { savedPort = +fs.readFileSync(path.join(os.homedir(), '.pholama', 'update-scheduler', 'port'), 'utf8'); } catch {}
      const port = savedPort || +process.env.PORT || 11435;
      const req = http.get({ hostname: '127.0.0.1', port, path: '/api/version', timeout: 1200 }, res => {
        let data = ''; res.setEncoding('utf8'); res.on('data', x => { data += x; }); res.on('end', () => { try { resolve(JSON.parse(data).name === 'pholama'); } catch { resolve(false); } });
      });
      req.on('timeout', () => { req.destroy(); resolve(false); }); req.on('error', () => resolve(false));
    });
  } catch {}
  if (running) return { ok: true, skipped: 'app-running' };
  return runUpdate({ log });
}
function setAuto(on) { status.auto = !!on; writeSet({ ...readSet(), auto: !!on }); return status; }
// 'running' is the version this process started with; 'current' is what is on disk now. They differ after an update until you restart.
const RUNNING = localVersion();
module.exports = { update, check, localVersion, status: () => ({ ...status, running: RUNNING, current: localVersion(), ready: status.ready && cmp(localVersion(), RUNNING) > 0 }), backgroundCheck, offlineCheck, startBackground, setAuto, setRestartHandler };
