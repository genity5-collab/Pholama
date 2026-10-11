// Pholama Database (website). Same rules as the PC Studio: optional, set up by the AI only, under 0.01 GB per project,
// built-in accounts (scrypt-grade hashing), 10 sign-ins a week per account then a 4 hour break, a project-wide flood ceiling.
// The whole database is one JSON document per project. `Doc` is loaded and saved by the caller (Supabase in production), always under a per-project lock.

export const DB_LIMITS = {
  MAX_BYTES: 10 * 1024 * 1024, MAX_TABLES: 8, MAX_COLUMNS: 20, MAX_ROWS_PER_TABLE: 5000, MAX_ROW_BYTES: 16 * 1024, MAX_ACCOUNTS: 500,
  SIGNIN_PER_WEEK: 10, WEEK_MS: 7 * 24 * 3600 * 1000, BREAK_MS: 4 * 3600 * 1000, PROJECT_SIGNIN_PER_WEEK: 200,
};
export type Doc = { v: number; enabled: boolean; tables: Record<string, { columns: Record<string, string>; rows: any[] }>; accounts: any[]; seq: number; signins: { e: string; t: number; ok: boolean }[]; breaks?: Record<string, number> };
export const emptyDoc = (): Doc => ({ v: 1, enabled: false, tables: {}, accounts: [], seq: 1, signins: [] });
const COLUMN_TYPES = new Set(['text', 'number', 'boolean', 'date']);
const size = (d: Doc) => new TextEncoder().encode(JSON.stringify(d)).length;
export class DbError extends Error { code: string; retryAt?: number; constructor(m: string, code = 'error', retryAt?: number) { super(m); this.code = code; this.retryAt = retryAt; } }

const ident = (s: unknown, what: string) => { const n = String(s ?? '').trim().toLowerCase(); if (!/^[a-z][a-z0-9_]{0,30}$/.test(n) || /^(accounts|__proto__|constructor|prototype)$/.test(n)) throw new DbError('A ' + what + ' name uses lowercase letters, numbers and underscores and starts with a letter.'); return n; };
export const needAI = (by: unknown) => { if (by !== 'ai') throw new DbError('Only the AI sets up the database. Ask it in the chat.', 'ai-only'); };
export const fits = (d: Doc) => { if (size(d) > DB_LIMITS.MAX_BYTES) throw new DbError('The database is full (limit 0.01 GB). Delete some rows first.', 'full'); };

export function enable(d: Doc, by: unknown) { needAI(by); d.enabled = true; return d; }
export function disable(d: Doc, by: unknown) { needAI(by); d.enabled = false; return d; }
export function createTable(d: Doc, name: string, columns: any[], by: unknown) {
  needAI(by); if (!d.enabled) throw new DbError('Turn the database on first.');
  const t = ident(name, 'table'); if (d.tables[t]) throw new DbError('The table ' + t + ' already exists.');
  if (Object.keys(d.tables).length >= DB_LIMITS.MAX_TABLES) throw new DbError('At most ' + DB_LIMITS.MAX_TABLES + ' tables.');
  if (!Array.isArray(columns) || !columns.length) throw new DbError('Give the table at least one column.'); if (columns.length > DB_LIMITS.MAX_COLUMNS) throw new DbError('At most ' + DB_LIMITS.MAX_COLUMNS + ' columns.');
  const cols: Record<string, string> = {};
  for (const c of columns) { const cn = ident(c?.name, 'column'); if (cn === 'id') throw new DbError('id is added for you.'); if (cols[cn]) throw new DbError('Duplicate column ' + cn + '.'); const ty = String(c.type || 'text').toLowerCase(); if (!COLUMN_TYPES.has(ty)) throw new DbError('Column type must be text, number, boolean or date.'); cols[cn] = ty; }
  d.tables[t] = { columns: cols, rows: [] }; return { table: t, columns: cols };
}
export function dropTable(d: Doc, name: string, by: unknown) { needAI(by); const t = ident(name, 'table'); if (!d.tables[t]) throw new DbError('No such table.'); delete d.tables[t]; return { dropped: t }; }

function coerce(ty: string, v: any) {
  if (v == null || v === '') return null;
  if (ty === 'number') { const n = Number(v); if (!Number.isFinite(n)) throw new DbError('"' + v + '" is not a number.'); return n; }
  if (ty === 'boolean') { if (v === true || v === 'true' || v === 1) return true; if (v === false || v === 'false' || v === 0) return false; throw new DbError('"' + v + '" is not true or false.'); }
  if (ty === 'date') { const t = new Date(v); if (isNaN(+t)) throw new DbError('"' + v + '" is not a date.'); return t.toISOString(); }
  return String(v).slice(0, 4000);
}
function rowFrom(t: Doc['tables'][string], obj: any) {
  const row: any = {}; for (const [k, ty] of Object.entries(t.columns)) row[k] = coerce(ty, obj?.[k]);
  for (const k of Object.keys(obj || {})) if (k !== 'id' && !(k in t.columns)) throw new DbError('There is no column "' + k + '" in this table.');
  if (new TextEncoder().encode(JSON.stringify(row)).length > DB_LIMITS.MAX_ROW_BYTES) throw new DbError('That row is too big.'); return row;
}
const tbl = (d: Doc, name: string) => { const t = d.tables[ident(name, 'table')]; if (!t) throw new DbError('No such table.'); return t; };
export function insert(d: Doc, name: string, obj: any) { if (!d.enabled) throw new DbError('The database is off for this project.'); const t = tbl(d, name); if (t.rows.length >= DB_LIMITS.MAX_ROWS_PER_TABLE) throw new DbError('This table is full (' + DB_LIMITS.MAX_ROWS_PER_TABLE + ' rows).'); const row = Object.assign({ id: d.seq++ }, rowFrom(t, obj)); t.rows.push(row); return row; }
export function update(d: Doc, name: string, id: unknown, obj: any) { const t = tbl(d, name), r = t.rows.find(x => x.id === Number(id)); if (!r) throw new DbError('No such row.'); Object.assign(r, rowFrom(t, Object.assign({}, r, obj))); return r; }
export function remove(d: Doc, name: string, id: unknown) { const t = tbl(d, name), n = t.rows.length; t.rows = t.rows.filter(x => x.id !== Number(id)); return { removed: n - t.rows.length }; }
export function select(d: Doc, name: string, opts: any = {}) {
  const t = tbl(d, name); let rows = t.rows;
  if (opts.where && typeof opts.where === 'object') for (const [k, v] of Object.entries(opts.where)) { if (!(k in t.columns) && k !== 'id') throw new DbError('There is no column "' + k + '".'); rows = rows.filter(r => r[k] === v); }
  if (opts.orderBy && (opts.orderBy in t.columns || opts.orderBy === 'id')) { const k = opts.orderBy, dir = opts.desc ? -1 : 1; rows = rows.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); }
  return rows.slice(0, Math.max(1, Math.min(200, +opts.limit || 50)));
}

// ---------- accounts ----------
// Password hashing: PBKDF2-SHA256 (Web Crypto, available in Deno). 100k rounds keeps a free function fast while staying slow to guess.
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)), unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPw(pw: string, salt: Uint8Array) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, k, 256)); }
const same = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]; return x === 0; };
const cleanEmail = (e: unknown) => { const s = String(e ?? '').trim().toLowerCase(); if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) || s.length > 254) throw new DbError('Enter a valid email.'); return s; };
const cleanPw = (pw: unknown) => { const s = String(pw ?? ''); if (s.length < 8) throw new DbError('A password needs at least 8 characters.'); if (s.length > 200) throw new DbError('That password is too long.'); return s; };
export async function signUp(d: Doc, email: string, password: string, extra?: { name?: string }) {
  if (!d.enabled) throw new DbError('The database is off for this project.');
  const e = cleanEmail(email), pw = cleanPw(password); if (d.accounts.some(a => a.email === e)) throw new DbError('That email already has an account.'); if (d.accounts.length >= DB_LIMITS.MAX_ACCOUNTS) throw new DbError('This project reached its account limit (' + DB_LIMITS.MAX_ACCOUNTS + ').');
  const salt = crypto.getRandomValues(new Uint8Array(16)), acct = { id: d.seq++, email: e, salt: b64(salt), hash: b64(await hashPw(pw, salt)), created: Date.now(), name: extra?.name ? String(extra.name).slice(0, 60) : '' };
  d.accounts.push(acct); return { id: acct.id, email: e, name: acct.name };
}
const wait = (ms: number) => { const m = Math.ceil(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
// Sign-in with the weekly rule. `now` is injectable so the week and the 4 hour break can be tested without waiting. A failed try counts too.
export async function signIn(d: Doc, email: string, password: string, now = Date.now()) {
  if (!d.enabled) throw new DbError('The database is off for this project.'); const e = cleanEmail(email);
  d.signins = d.signins.filter(s => now - s.t < DB_LIMITS.WEEK_MS);
  const mine = d.signins.filter(s => s.e === e), until = d.breaks?.[e];
  if (until && now < until) throw new DbError('Too many sign-ins this week. Try again in ' + wait(until - now) + '.', 'break', until);
  if (d.signins.length >= DB_LIMITS.PROJECT_SIGNIN_PER_WEEK) throw new DbError('This project is getting a lot of sign-ins. Try again later.', 'busy', now + DB_LIMITS.BREAK_MS);
  const a = d.accounts.find(x => x.email === e); let good = false;
  if (a) good = same(await hashPw(String(password ?? ''), unb64(a.salt)), unb64(a.hash)); else await hashPw('x', new Uint8Array(16));   // same work either way: no timing hint about which emails exist
  d.signins.push({ e, t: now, ok: good });
  if (d.signins.filter(s => s.e === e).length >= DB_LIMITS.SIGNIN_PER_WEEK) d.breaks = Object.assign({}, d.breaks, { [e]: now + DB_LIMITS.BREAK_MS });
  return { good, account: good ? { id: a.id, email: a.email, name: a.name, signinsThisWeek: mine.length + 1, left: Math.max(0, DB_LIMITS.SIGNIN_PER_WEEK - (mine.length + 1)) } : null };
}
export function deleteAccount(d: Doc, email: string) { const e = cleanEmail(email), n = d.accounts.length; d.accounts = d.accounts.filter(a => a.email !== e); return { removed: n - d.accounts.length }; }
// What a person or a page may see: never hashes, never emails.
export function status(d: Doc) {
  const bytes = size(d);
  return { enabled: d.enabled, usedBytes: bytes, limitBytes: DB_LIMITS.MAX_BYTES, usedPercent: Math.min(100, Math.round(bytes / DB_LIMITS.MAX_BYTES * 1000) / 10), accounts: d.accounts.length, accountLimit: DB_LIMITS.MAX_ACCOUNTS,
    tables: Object.entries(d.tables).map(([name, t]) => ({ name, columns: t.columns, rows: t.rows.length })), rules: { signInsPerWeek: DB_LIMITS.SIGNIN_PER_WEEK, breakHours: DB_LIMITS.BREAK_MS / 3600000 } };
}
export function promptNote(d: Doc) {
  const s = status(d); if (!s.enabled) return 'The Pholama Database is OFF for this project. Turn it on only if the app needs accounts or saved data, and say why.';
  return 'The Pholama Database is ON (under 0.01 GB). Tables: ' + (s.tables.map(t => t.name + '(' + Object.entries(t.columns).map(([k, v]) => k + ':' + v).join(', ') + ')').join('; ') || 'none yet') + '. Accounts are built in. Each account may sign in 10 times a week, then takes a 4 hour break, so never build auto-login loops.';
}
