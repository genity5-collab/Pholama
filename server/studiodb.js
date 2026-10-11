// Pholama Database: a tiny, optional, built-in database for a Studio project. Free and light on purpose.
//  - ONLY the AI sets it up (enable, create tables). The page and the user can read stats and rows, never change the structure.
//  - Under 0.01 GB (10 MB) per project, enforced on every write.
//  - Built-in accounts (sign up / sign in) with scrypt-hashed passwords.
//  - After 10 sign-ins in a week an account takes a 4 hour break. A project-wide ceiling stops floods too.
// Stored outside the project folder so checkpoints, search and GitHub pushes never include user data.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const ROOT = () => process.env.PHOLAMA_PRIVATE || path.join(os.homedir(), '.pholama', 'private');
const LIMITS = {
  MAX_BYTES: 10 * 1024 * 1024,       // 0.01 GB
  MAX_TABLES: 8, MAX_COLUMNS: 20, MAX_ROWS_PER_TABLE: 5000, MAX_ROW_BYTES: 16 * 1024, MAX_ACCOUNTS: 500,
  SIGNIN_PER_WEEK: 10, WEEK_MS: 7 * 24 * 3600 * 1000, BREAK_MS: 4 * 3600 * 1000,
  PROJECT_SIGNIN_PER_WEEK: 200,      // flood ceiling for the whole project
};
const COLUMN_TYPES = new Set(['text', 'number', 'boolean', 'date']);

const proj = p => { const n = String(p == null ? '' : p).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60); if (!n) throw new Error('Pick a project first.'); return n; };
const fileFor = p => path.join(ROOT(), proj(p), 'database.json');
const ident = (s, what) => { const n = String(s == null ? '' : s).trim().toLowerCase(); if (!/^[a-z][a-z0-9_]{0,30}$/.test(n) || /^(accounts|__proto__|constructor|prototype)$/.test(n)) throw new Error('A ' + what + ' name uses lowercase letters, numbers and underscores and starts with a letter.'); return n; };

function empty() { return { v: 1, enabled: false, tables: {}, accounts: [], seq: 1, signins: [] }; }
function load(p) { try { const d = JSON.parse(fs.readFileSync(fileFor(p), 'utf8')); return Object.assign(empty(), d); } catch { return empty(); } }
const sizeOf = d => Buffer.byteLength(JSON.stringify(d));
function save(p, d) {
  const text = JSON.stringify(d); if (Buffer.byteLength(text) > LIMITS.MAX_BYTES) { const e = new Error('The database is full (limit 0.01 GB). Delete some rows first.'); e.code = 'full'; throw e; }
  const f = fileFor(p); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, text, { mode: 0o600 }); fs.renameSync(tmp, f); try { fs.chmodSync(f, 0o600); } catch {}
}
// One write at a time per project, so two quick requests cannot lose each other's changes.
const locks = new Map();
async function withLock(p, fn) {
  const k = proj(p), prev = locks.get(k) || Promise.resolve(); let release; const gate = new Promise(r => release = r), tail = prev.then(() => gate);
  locks.set(k, tail); await prev;
  try { return await fn(); } finally { release(); if (locks.get(k) === tail) locks.delete(k); }   // forget the project once nobody is waiting
}

// ---------- setup (AI only) ----------
// `by` must be 'ai'. The routes pass 'user' for anything that comes from a person or a page, so those are refused here, not just hidden.
function needAI(by) { if (by !== 'ai') { const e = new Error('Only the AI sets up the database. Ask it in the chat.'); e.code = 'ai-only'; throw e; } }
async function enable(p, by) { needAI(by); return withLock(p, () => { const d = load(p); d.enabled = true; save(p, d); return status(p); }); }
async function disable(p, by) { needAI(by); return withLock(p, () => { const d = load(p); d.enabled = false; save(p, d); return status(p); }); }
async function createTable(p, name, columns, by) {
  needAI(by); return withLock(p, () => {
    const d = load(p); if (!d.enabled) throw new Error('Turn the database on first.');
    const t = ident(name, 'table'); if (d.tables[t]) throw new Error('The table ' + t + ' already exists.');
    if (Object.keys(d.tables).length >= LIMITS.MAX_TABLES) throw new Error('At most ' + LIMITS.MAX_TABLES + ' tables.');
    if (!Array.isArray(columns) || !columns.length) throw new Error('Give the table at least one column.'); if (columns.length > LIMITS.MAX_COLUMNS) throw new Error('At most ' + LIMITS.MAX_COLUMNS + ' columns.');
    const cols = {}; for (const c of columns) { const cn = ident(c && c.name, 'column'); if (cn === 'id') throw new Error('id is added for you.'); if (cols[cn]) throw new Error('Duplicate column ' + cn + '.'); const ty = String(c.type || 'text').toLowerCase(); if (!COLUMN_TYPES.has(ty)) throw new Error('Column type must be text, number, boolean or date.'); cols[cn] = ty; }
    d.tables[t] = { columns: cols, rows: [] }; save(p, d); return { table: t, columns: cols };
  });
}
async function dropTable(p, name, by) { needAI(by); return withLock(p, () => { const d = load(p), t = ident(name, 'table'); if (!d.tables[t]) throw new Error('No such table.'); delete d.tables[t]; save(p, d); return { dropped: t }; }); }

// ---------- rows ----------
function coerce(ty, v) {
  if (v == null || v === '') return null;
  if (ty === 'number') { const n = Number(v); if (!Number.isFinite(n)) throw new Error('"' + v + '" is not a number.'); return n; }
  if (ty === 'boolean') { if (v === true || v === 'true' || v === 1) return true; if (v === false || v === 'false' || v === 0) return false; throw new Error('"' + v + '" is not true or false.'); }
  if (ty === 'date') { const t = new Date(v); if (isNaN(t)) throw new Error('"' + v + '" is not a date.'); return t.toISOString(); }
  return String(v).slice(0, 4000);
}
function rowFrom(table, obj) {
  const row = {}; for (const [k, ty] of Object.entries(table.columns)) row[k] = coerce(ty, obj && obj[k]);
  for (const k of Object.keys(obj || {})) if (k !== 'id' && !(k in table.columns)) throw new Error('There is no column "' + k + '" in this table.');
  if (Buffer.byteLength(JSON.stringify(row)) > LIMITS.MAX_ROW_BYTES) throw new Error('That row is too big.'); return row;
}
async function insert(p, name, obj) {
  return withLock(p, () => { const d = load(p); if (!d.enabled) throw new Error('The database is off for this project.'); const t = d.tables[ident(name, 'table')]; if (!t) throw new Error('No such table.');
    if (t.rows.length >= LIMITS.MAX_ROWS_PER_TABLE) throw new Error('This table is full (' + LIMITS.MAX_ROWS_PER_TABLE + ' rows).');
    const row = Object.assign({ id: d.seq++ }, rowFrom(t, obj)); t.rows.push(row); save(p, d); return row; });
}
async function update(p, name, id, obj) { return withLock(p, () => { const d = load(p), t = d.tables[ident(name, 'table')]; if (!t) throw new Error('No such table.'); const r = t.rows.find(x => x.id === Number(id)); if (!r) throw new Error('No such row.'); Object.assign(r, rowFrom(t, Object.assign({}, r, obj))); save(p, d); return r; }); }
async function remove(p, name, id) { return withLock(p, () => { const d = load(p), t = d.tables[ident(name, 'table')]; if (!t) throw new Error('No such table.'); const n = t.rows.length; t.rows = t.rows.filter(x => x.id !== Number(id)); save(p, d); return { removed: n - t.rows.length }; }); }
function select(p, name, opts = {}) {
  const d = load(p), t = d.tables[ident(name, 'table')]; if (!t) throw new Error('No such table.'); let rows = t.rows;
  if (opts.where && typeof opts.where === 'object') for (const [k, v] of Object.entries(opts.where)) { if (!(k in t.columns) && k !== 'id') throw new Error('There is no column "' + k + '".'); rows = rows.filter(r => r[k] === v); }
  if (opts.orderBy && (opts.orderBy in t.columns || opts.orderBy === 'id')) { const k = opts.orderBy, dir = opts.desc ? -1 : 1; rows = rows.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); }
  return rows.slice(0, Math.max(1, Math.min(200, +opts.limit || 50)));
}

// ---------- accounts ----------
const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
const cleanEmail = e => { const s = String(e == null ? '' : e).trim().toLowerCase(); if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) || s.length > 254) throw new Error('Enter a valid email.'); return s; };
function cleanPassword(pw) { const s = String(pw == null ? '' : pw); if (s.length < 8) throw new Error('A password needs at least 8 characters.'); if (s.length > 200) throw new Error('That password is too long.'); return s; }
async function signUp(p, email, password, extra) {
  return withLock(p, () => { const d = load(p); if (!d.enabled) throw new Error('The database is off for this project.');
    const e = cleanEmail(email), pw = cleanPassword(password); if (d.accounts.some(a => a.email === e)) throw new Error('That email already has an account.'); if (d.accounts.length >= LIMITS.MAX_ACCOUNTS) throw new Error('This project reached its account limit (' + LIMITS.MAX_ACCOUNTS + ').');
    const salt = crypto.randomBytes(16), acct = { id: d.seq++, email: e, salt: salt.toString('base64'), hash: hash(pw, salt).toString('base64'), created: Date.now(), name: extra && extra.name ? String(extra.name).slice(0, 60) : '' };
    d.accounts.push(acct); save(p, d); return { id: acct.id, email: e, name: acct.name }; });
}
// Sign-in with the weekly rule. `now` is injectable so the week and the 4 hour break can be tested without waiting.
async function signIn(p, email, password, now = Date.now()) {
  return withLock(p, () => {
    const d = load(p); if (!d.enabled) throw new Error('The database is off for this project.'); const e = cleanEmail(email);
    d.signins = d.signins.filter(s => now - s.t < LIMITS.WEEK_MS);                                   // keep one rolling week
    const mine = d.signins.filter(s => s.e === e), until = d.breaks && d.breaks[e];
    if (until && now < until) { const err = new Error('Too many sign-ins this week. Try again in ' + wait(until - now) + '.'); err.code = 'break'; err.retryAt = until; throw err; }
    if (d.signins.length >= LIMITS.PROJECT_SIGNIN_PER_WEEK) { const err = new Error('This project is getting a lot of sign-ins. Try again later.'); err.code = 'busy'; err.retryAt = now + LIMITS.BREAK_MS; throw err; }
    const a = d.accounts.find(x => x.email === e);
    // A failed try counts too, or the rule could be skipped by guessing. Same message for "no account" and "wrong password".
    let good = false; if (a) { const h = hash(String(password == null ? '' : password), Buffer.from(a.salt, 'base64')); good = crypto.timingSafeEqual(h, Buffer.from(a.hash, 'base64')); } else hash('x', Buffer.alloc(16));
    d.signins.push({ e, t: now, ok: good });
    if (d.signins.filter(s => s.e === e).length >= LIMITS.SIGNIN_PER_WEEK) { d.breaks = Object.assign({}, d.breaks, { [e]: now + LIMITS.BREAK_MS }); }
    save(p, d);
    if (!good) { const err = new Error('Wrong email or password.'); err.code = 'bad'; throw err; }
    return { id: a.id, email: a.email, name: a.name, signinsThisWeek: mine.length + 1, left: Math.max(0, LIMITS.SIGNIN_PER_WEEK - (mine.length + 1)) };
  });
}
function wait(ms) { const m = Math.ceil(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
async function deleteAccount(p, email) { return withLock(p, () => { const d = load(p), e = cleanEmail(email), n = d.accounts.length; d.accounts = d.accounts.filter(a => a.email !== e); save(p, d); return { removed: n - d.accounts.length }; }); }

// ---------- what a person or the page may see (never the structure editor, never hashes) ----------
function status(p) {
  const d = load(p), bytes = sizeOf(d);
  return { enabled: d.enabled, usedBytes: bytes, limitBytes: LIMITS.MAX_BYTES, usedPercent: Math.min(100, Math.round(bytes / LIMITS.MAX_BYTES * 1000) / 10), accounts: d.accounts.length, accountLimit: LIMITS.MAX_ACCOUNTS,
    tables: Object.entries(d.tables).map(([name, t]) => ({ name, columns: t.columns, rows: t.rows.length })), rules: { signInsPerWeek: LIMITS.SIGNIN_PER_WEEK, breakHours: LIMITS.BREAK_MS / 3600000 } };
}
function removeAll(p) { try { fs.rmSync(fileFor(p), { force: true }); } catch {} }
// The AI is told what exists so it can write code for it. It never gets the hashes.
function promptNote(p) {
  const s = status(p); if (!s.enabled) return 'The Pholama Database is OFF for this project. Turn it on only if the app needs accounts or saved data, and say why.';
  return 'The Pholama Database is ON (under 0.01 GB). Tables: ' + (s.tables.map(t => t.name + '(' + Object.entries(t.columns).map(([k, v]) => k + ':' + v).join(', ') + ')').join('; ') || 'none yet') + '. Accounts are built in. Each account may sign in 10 times a week, then takes a 4 hour break, so never build auto-login loops.';
}

const _locks = () => locks.size;
module.exports = { _locks, LIMITS, enable, disable, createTable, dropTable, insert, update, remove, select, signUp, signIn, deleteAccount, status, removeAll, promptNote, sizeOf, load };
