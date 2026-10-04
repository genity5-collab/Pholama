// Pholama power tools: approved terminal commands, an edit log, a run guard that protects the PC, and the login bonus.
// Zero dependencies. Nothing here runs a command unless the user clicked Allow for that exact command.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');

const DIR = path.join(os.homedir(), '.pholama');
const LOG = path.join(DIR, 'edit-log.jsonl');
const BONUS_FILE = path.join(DIR, 'bonus.json');
const BONUS_URL = 'https://lyra-09dfabbf.base44.app/functions/pholamaBonus';

// ---------- limits that keep the PC responsive ----------
const LIMITS = {
  seconds: 60,            // a command is stopped after this long
  outputBytes: 64 * 1024, // output kept in memory (the rest is counted, not stored)
  returnChars: 3000,      // what the model gets back
  oneAtATime: true,       // never two commands at once
  pendingMax: 5,          // approvals waiting at once
  pendingMinutes: 10,     // an approval expires after this long
  logMax: 2000            // edit log keeps the newest entries
};

// ---------- edit log: every command and file change, who approved it, how it ended ----------
// A tiny live feed: every log entry is also handed to anyone watching (the edit log panel). Watchers can never block or break logging.
const watchers = new Set();
function watch(fn) { if (watchers.size >= 20) return null; watchers.add(fn); return () => watchers.delete(fn); }
function logEntry(e) {
  try {
    const entry = { t: new Date().toISOString(), ...e };
    for (const w of [...watchers]) { try { w(entry); } catch { watchers.delete(w); } }
  } catch {}
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');
    const st = fs.statSync(LOG);
    if (st.size > 1024 * 1024) { // trim: keep the newest entries so the file never grows without bound
      const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(-LIMITS.logMax);
      fs.writeFileSync(LOG, lines.join('\n') + '\n');
    }
  } catch { /* logging must never break a reply */ }
}
function readLog(n = 100) {
  try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(-Math.min(Math.max(+n || 100, 1), 500)).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); } catch { return []; }
}
function clearLog() { try { fs.writeFileSync(LOG, ''); return true; } catch { return false; } }

// ---------- command safety ----------
// Commands that are refused outright, even if the user clicks Allow: they can wipe a disk, hide the user's data, or lock the machine.
// This is a safety net, not a sandbox: the real protection is that a person reads every command before it runs.
const BLOCK = [
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME|\*|\.\.?)(\s|$)/i, 'deletes a whole folder tree'],
  [/\bdel\s+\/[sfq]/i, 'bulk delete'], [/\brmdir\s+\/s/i, 'bulk delete'], [/\bformat\s+[a-z]:/i, 'formats a drive'],
  [/\bmkfs(\.|\s)/i, 'formats a disk'], [/\bdd\s+[^|]*\bof=\/dev\//i, 'writes to a raw disk'], [/>\s*\/dev\/(sd|nvme|disk)/i, 'writes to a raw disk'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork bomb'], [/\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i, 'shuts the PC down'],
  [/\bchmod\s+-R\s+[0-7]*777\s+\//i, 'opens permissions on the whole system'], [/\bchown\s+-R\b[^|]*\s\/(\s|$)/i, 'changes owner of the whole system'],
  [/\bcurl\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\bwget\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\biex\b[^|;&]*(downloadstring|iwr|invoke-webrequest)/i, 'runs a downloaded script'],
  [/\breg\s+delete\b|\bbcdedit\b|\bdiskpart\b|\bcipher\s+\/w/i, 'edits boot or registry'],
  [/\bsudo\b|\bsu\s+-?\s*$|\brunas\b|\bgsudo\b/i, 'asks for administrator rights'],
  [/\bkill\s+-9\s+(-1|1)\b|\btaskkill\b[^|]*\/im\s+(explorer|winlogon|csrss|svchost)/i, 'kills the system']
];
function checkCommand(cmd) {
  const c = String(cmd == null ? '' : cmd);
  if (!c.trim()) return 'Empty command.';
  if (c.length > 2000) return 'Command is too long (max 2000 characters).';
  if (/[\u0000]/.test(c)) return 'Command has invalid characters.';
  for (const [re, why] of BLOCK) if (re.test(c)) return 'Blocked for safety: ' + why + '.';
  return null;
}

// ---------- approvals: the model proposes, the user decides ----------
const pending = new Map();   // id -> { id, cmd, cwd, why, created }
let running = null;          // the one command allowed to run right now
function sweep() { const cut = Date.now() - LIMITS.pendingMinutes * 60000; for (const [k, v] of pending) if (v.created < cut) { pending.delete(k); logEntry({ kind: 'command', status: 'expired', cmd: v.cmd }); } }

function safeCwd(cwd) {
  const home = os.homedir();
  const c = cwd ? path.resolve(String(cwd)) : home;
  // Stay inside the user's home folder: a model-chosen folder like / or C:\Windows is refused.
  const rel = path.relative(home, c);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Commands may only run inside your home folder.');
  if (!fs.existsSync(c) || !fs.statSync(c).isDirectory()) throw new Error('That folder does not exist.');
  return c;
}

// Called by the tool loop. NEVER runs anything: it only queues a request for the user.
function propose({ command, cwd, why }, ctx) {
  sweep();
  const bad = checkCommand(command);
  if (bad) { logEntry({ kind: 'command', status: 'refused', cmd: String(command).slice(0, 300), reason: bad }); throw new Error(bad); }
  let dir; try { dir = safeCwd(cwd); } catch (e) { logEntry({ kind: 'command', status: 'refused', cmd: String(command).slice(0, 300), reason: e.message }); throw e; }
  if (pending.size >= LIMITS.pendingMax) throw new Error('Too many commands are waiting for approval. Answer those first.');
  const id = crypto.randomBytes(8).toString('hex');
  const p = { id, cmd: String(command).trim(), cwd: dir, why: String(why || '').slice(0, 200), created: Date.now() };
  pending.set(id, p);
  logEntry({ kind: 'command', status: 'proposed', id, cmd: p.cmd, cwd: p.cwd, why: p.why });
  if (ctx && ctx.onPending) ctx.onPending({ id, type: 'command', title: 'Run a command on your PC', command: p.cmd, folder: p.cwd, why: p.why });
  return 'The command is waiting for the user to click Allow. It has NOT run. Tell the user it needs their approval and stop. Do not say it ran.';
}

function reject(id) { const p = pending.get(id); if (!p) return false; pending.delete(id); logEntry({ kind: 'command', status: 'denied', id, cmd: p.cmd }); return true; }

// Runs an approved command with hard limits. Resolves with { ok, code, text, ms, truncated }.
function approve(id) {
  return new Promise((resolve, reject_) => {
    sweep();
    const p = pending.get(id);
    if (!p) return reject_(new Error('That request expired or was already answered.'));
    if (running) return reject_(new Error('Another command is still running. Wait for it to finish.'));
    pending.delete(id);
    const bad = checkCommand(p.cmd); if (bad) return reject_(new Error(bad)); // re-check at run time
    const win = process.platform === 'win32';
    const t0 = Date.now(); let out = '', bytes = 0, done = false, killedBy = '';
    // Lowest CPU priority where available so the PC stays smooth while a command runs.
    const file = win ? 'cmd.exe' : '/bin/sh', args = win ? ['/d', '/s', '/c', p.cmd] : ['-c', (process.platform === 'linux' || process.platform === 'darwin') ? 'exec nice -n 15 /bin/sh -c ' + shq(p.cmd) : p.cmd];
    let child;
    try { child = spawn(file, args, { cwd: p.cwd, env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !win }); }
    catch (e) { logEntry({ kind: 'command', status: 'error', id, cmd: p.cmd, error: String(e.message).slice(0, 200) }); return reject_(new Error('Could not start: ' + e.message)); }
    running = { id, child };
    const take = d => { bytes += d.length; if (out.length < LIMITS.outputBytes) out += d.toString('utf8').slice(0, LIMITS.outputBytes - out.length); if (bytes > 8 * 1024 * 1024 && !killedBy) { killedBy = 'output'; stop(child); } };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = setTimeout(() => { killedBy = killedBy || 'time'; stop(child); }, LIMITS.seconds * 1000);
    const finish = (code, err) => {
      if (done) return; done = true; clearTimeout(timer); const byUser = !!(running && running.byUser); running = null;
      if (byUser) killedBy = killedBy || 'user';
      const ms = Date.now() - t0, truncated = bytes > out.length;
      let text = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
      if (killedBy === 'time') text += `\n[stopped: it ran longer than ${LIMITS.seconds} seconds]`;
      if (killedBy === 'user') text += '\n[stopped by the user]';
      if (killedBy === 'output') text += '\n[stopped: it printed far too much output]';
      if (truncated && !killedBy) text += `\n[output cut: ${bytes} bytes printed, first ${out.length} kept]`;
      if (err) text += '\n[error: ' + String(err.message || err).slice(0, 160) + ']';
      const ok = code === 0 && !killedBy && !err;
      logEntry({ kind: 'command', status: ok ? 'ok' : killedBy ? 'stopped' : 'failed', id, cmd: p.cmd, cwd: p.cwd, code, ms, bytes, approvedBy: 'user' });
      resolve({ ok, code, ms, truncated, stoppedBy: killedBy || null, text: text.slice(0, LIMITS.returnChars) || '(no output)' });
    };
    child.on('error', e => finish(-1, e));
    child.on('close', c => finish(c));
  });
}
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function stop(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  } catch { try { child.kill(); } catch {} }
}
// Do not hand the user's secrets (tokens, API keys) to a command a small model wrote.
function cleanEnv() {
  const e = {}; for (const [k, v] of Object.entries(process.env)) { if (/token|secret|password|passwd|api[_-]?key|credential|private|auth/i.test(k)) continue; e[k] = v; }
  e.PAGER = 'cat'; e.GIT_PAGER = 'cat'; e.CI = '1'; e.NO_COLOR = '1'; return e;
}
function stopRunning() { if (running) { running.byUser = true; stop(running.child); return true; } return false; }
const list = () => { sweep(); return [...pending.values()].map(p => ({ id: p.id, command: p.cmd, folder: p.cwd, why: p.why })); };

// ---------- login bonus: +55 tool credits, once per account, granted by the server (never by this page) ----------
function bonusState() { try { return JSON.parse(fs.readFileSync(BONUS_FILE, 'utf8')); } catch { return { users: {} }; } }
function bonusTotal() { const s = bonusState(); return [...Object.values(s.users || {}), ...Object.values(s.github || {}), ...Object.values(s.rewards || {})].reduce((n, v) => n + (+v.credits || 0), 0); }
// The page sends the login token. We ask the Pholama server ourselves, so a number sent by the page is never trusted.
async function claimBonus(token) {
  if (!token || typeof token !== 'string' || token.length > 4000) throw new Error('Log in first.');
  const r = await fetch(BONUS_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not reach the Pholama server.');
  const amount = Math.min(55, Math.max(0, Math.floor(+j.bonus || 0)));
  // The server tells us who this is, so one account can only count once here even if it logs in many times.
  const who = (() => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub; } catch { return null; } })();
  if (!who || !/^[0-9a-f-]{36}$/i.test(who)) throw new Error('Could not read your account.');
  const s = bonusState(); s.users = s.users || {};
  if (!s.users[who]) { s.users[who] = { credits: amount, at: new Date().toISOString() }; fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(BONUS_FILE, JSON.stringify(s, null, 2)); logEntry({ kind: 'bonus', status: j.granted ? 'granted' : 'already-granted', credits: amount }); }
  return { bonus: bonusTotal(), granted: !!j.granted };
}


// ---------- GitHub-on-both bonus: +250 tool credits, once per account ----------
// The database (not the page) says whether this account used GitHub on both the site and the PC app.
// We ask it ourselves, with the person's own login token, and read who they are from its answer.
const SB_URL = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const GITHUB_BONUS = 250;
async function claimGithubBonus(token) {
  const anonKey = (fs.readFileSync(path.join(__dirname, '..', 'web', 'config.js'), 'utf8').match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1] || '';
  if (!token || typeof token !== 'string' || token.length > 4000) throw new Error('Log in first.');
  const h = { Authorization: 'Bearer ' + token, apikey: String(anonKey || ''), 'Content-Type': 'application/json' };
  const who = await fetch(SB_URL + '/auth/v1/user', { headers: h, signal: AbortSignal.timeout(10000) });
  const user = await who.json().catch(() => null);
  if (!who.ok || !user || !/^[0-9a-f-]{36}$/i.test(user.id || '')) throw new Error('Could not read your account.');
  const s = bonusState(); s.github = s.github || {};
  if (s.github[user.id]) return { bonus: bonusTotal(), granted: false, already: true };
  const r = await fetch(SB_URL + '/rest/v1/rpc/pholama_github_both', { method: 'POST', headers: h, body: '{}', signal: AbortSignal.timeout(10000) });
  const both = await r.json().catch(() => null);
  if (!r.ok) throw new Error('Could not check your GitHub sign-ins yet.');
  if (both !== true) return { bonus: bonusTotal(), granted: false, both: false };
  s.github[user.id] = { credits: GITHUB_BONUS, at: new Date().toISOString() };
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(BONUS_FILE, JSON.stringify(s, null, 2));
  logEntry({ kind: 'bonus', status: 'granted', credits: GITHUB_BONUS });
  return { bonus: bonusTotal(), granted: true, both: true };
}

// ---------- report rewards + moderator gifts: integration credits, claimed from the database with the person's own token ----------
// The database decides how many credits are waiting and hands them over exactly once. This page/server never trusts a number from the browser.
function rewardsTotal() { const s = bonusState(); return Object.values(s.rewards || {}).reduce((n, v) => n + (+v.credits || 0), 0); }
async function claimRewards(token, fetchImpl = fetch) {
  const anonKey = (fs.readFileSync(path.join(__dirname, '..', 'web', 'config.js'), 'utf8').match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1] || '';
  if (!token || typeof token !== 'string' || token.length > 4000) throw new Error('Log in first.');
  const h = { Authorization: 'Bearer ' + token, apikey: String(anonKey || ''), 'Content-Type': 'application/json' };
  const who = await fetchImpl(SB_URL + '/auth/v1/user', { headers: h, signal: AbortSignal.timeout(10000) });
  const user = await who.json().catch(() => null);
  if (!who.ok || !user || !/^[0-9a-f-]{36}$/i.test(user.id || '')) throw new Error('Could not read your account.');
  const r = await fetchImpl(SB_URL + '/rest/v1/rpc/pholama_claim_rewards', { method: 'POST', headers: h, body: '{}', signal: AbortSignal.timeout(10000) });
  const n = await r.json().catch(() => null);
  if (!r.ok || typeof n !== 'number') throw new Error('Could not collect your credits yet.');
  const got = Math.max(0, Math.min(100000, Math.floor(n)));
  if (got > 0) {   // each claim is recorded on its own, so adding the same claim twice is impossible (the database only pays once)
    const s = bonusState(); s.rewards = s.rewards || {}; s.rewards[Date.now() + '-' + user.id] = { credits: got, at: new Date().toISOString() };
    fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(BONUS_FILE, JSON.stringify(s, null, 2));
    logEntry({ kind: 'bonus', status: 'granted', credits: got });
  }
  return { granted: got, bonus: bonusTotal() };
}

module.exports = { watch, LIMITS, propose, approve, reject, list, stopRunning, checkCommand, readLog, clearLog, logEntry, claimBonus, claimGithubBonus, claimRewards, bonusTotal };
