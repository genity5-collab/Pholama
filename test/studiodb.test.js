// Pholama Database: AI-only setup, 0.01 GB cap, accounts, the 10-a-week + 4 hour break rule (with a fake clock), isolation, concurrency.
const fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'db-')); process.env.PHOLAMA_PRIVATE = base + '/priv'; process.env.PHOLAMA_STUDIO = base + '/studio';
const DB = require('../server/studiodb'), stu = require('../server/studio');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const H = 3600 * 1000, DAY = 24 * H, T0 = Date.UTC(2026, 9, 11, 9, 0, 0);
(async () => {
  // --- AI only
  let e = await fails(() => DB.enable('app', 'user')); ok('a person cannot turn the database on', e && e.code === 'ai-only', e && e.message);
  e = await fails(() => DB.enable('app')); ok('...and neither can a call that does not say who it is', e && e.code === 'ai-only');
  e = await fails(() => DB.createTable('app', 'users', [{ name: 'n' }], 'page')); ok('a page cannot create tables', e && e.code === 'ai-only');
  ok('it starts off, and off means no data', DB.status('app').enabled === false);
  e = await fails(() => DB.insert('app', 'notes', { a: 1 })); ok('a write while off is refused', !!e && /off/.test(e.message));
  await DB.enable('app', 'ai'); ok('the AI can turn it on', DB.status('app').enabled === true);
  // --- tables
  const t = await DB.createTable('app', 'notes', [{ name: 'title', type: 'text' }, { name: 'stars', type: 'number' }, { name: 'done', type: 'boolean' }, { name: 'due', type: 'date' }], 'ai');
  ok('the AI creates a table', t.table === 'notes' && Object.keys(t.columns).length === 4);
  for (const [why, args] of [['a bad table name', ['Drop Table;', [{ name: 'a' }]]], ['the reserved name accounts', ['accounts', [{ name: 'a' }]]], ['a reserved prototype name', ['__proto__', [{ name: 'a' }]]], ['no columns', ['empty', []]], ['a column called id', ['x1', [{ name: 'id' }]]], ['a bad type', ['x2', [{ name: 'a', type: 'blob' }]]], ['a duplicate column', ['x3', [{ name: 'a' }, { name: 'a' }]]], ['too many columns', ['x4', Array.from({ length: 21 }, (_, i) => ({ name: 'c' + i }))]]]) { e = await fails(() => DB.createTable('app', args[0], args[1], 'ai')); ok('refused: ' + why, !!e, 'accepted'); }
  for (let i = 0; i < 7; i++) await DB.createTable('app', 'tbl' + i, [{ name: 'a' }], 'ai'); e = await fails(() => DB.createTable('app', 'one_too_many', [{ name: 'a' }], 'ai')); ok('at most 8 tables', !!e && /8 tables/.test(e.message));
  await DB.dropTable('app', 'tbl0', 'ai'); await DB.dropTable('app', 'tbl2', 'ai'); e = await fails(() => DB.dropTable('app', 'tbl1', 'user')); ok('dropping a table is AI only too', e && e.code === 'ai-only');
  // --- rows
  const r1 = await DB.insert('app', 'notes', { title: 'Buy milk', stars: '3', done: 'false', due: '2026-10-12' }); ok('rows get an id and the right types', r1.id > 0 && r1.stars === 3 && r1.done === false && /^2026-10-12/.test(r1.due), JSON.stringify(r1));
  e = await fails(() => DB.insert('app', 'notes', { title: 'x', color: 'red' })); ok('an unknown column is refused', !!e && /no column/.test(e.message));
  e = await fails(() => DB.insert('app', 'notes', { stars: 'lots' })); ok('a wrong type is refused', !!e && /not a number/.test(e.message));
  e = await fails(() => DB.insert('app', 'notes', { title: 'x'.repeat(5000) })); ok('long text is cut to a safe size, not stored whole', !e && DB.select('app', 'notes', { orderBy: 'id', desc: true })[0].title.length === 4000);
  await DB.update('app', 'notes', r1.id, { done: true }); ok('update works', DB.select('app', 'notes', { where: { done: true } }).length === 1);
  e = await fails(() => DB.select('app', 'notes', { where: { nope: 1 } })); ok('selecting on an unknown column is refused', !!e);
  await DB.remove('app', 'notes', r1.id); ok('delete works', DB.select('app', 'notes', { where: { id: r1.id } }).length === 0);
  // --- the size cap
  await DB.createTable('app', 'blobs', [{ name: 'data' }], 'ai'); let full = null, n = 0;
  for (; n < 5000 && !full; n++) { try { await DB.insert('app', 'blobs', { data: 'y'.repeat(3900) }); } catch (x) { full = x; } }
  ok('the database stops at 0.01 GB with a clear message', full && (full.code === 'full' || /full/.test(full.message)) && DB.sizeOf(DB.load('app')) <= DB.LIMITS.MAX_BYTES, full && full.message);
  ok('the file on disk is within the limit', fs.statSync(path.join(base, 'priv', 'app', 'database.json')).size <= DB.LIMITS.MAX_BYTES);
  ok('status reports the usage honestly', DB.status('app').usedPercent > 90 && DB.status('app').limitBytes === 10 * 1024 * 1024);
  ok('a refused write left the data intact (still readable)', DB.select('app', 'blobs', { limit: 5 }).length === 5);
  // --- accounts
  await DB.enable('acc', 'ai');
  const a = await DB.signUp('acc', 'Ana@Example.com', 'correct horse'); ok('sign up works and normalises the email', a.email === 'ana@example.com' && a.id > 0);
  const raw = fs.readFileSync(path.join(base, 'priv', 'acc', 'database.json'), 'utf8'); ok('the password is never stored', !raw.includes('correct horse') && /"hash"/.test(raw));
  ok('status never exposes hashes or emails', !JSON.stringify(DB.status('acc')).includes('ana@') && !JSON.stringify(DB.status('acc')).includes('hash'));
  e = await fails(() => DB.signUp('acc', 'ana@example.com', 'another one 123')); ok('a second account with the same email is refused', !!e && /already/.test(e.message));
  e = await fails(() => DB.signUp('acc', 'not-an-email', 'longenough1')); ok('a bad email is refused', !!e);
  e = await fails(() => DB.signUp('acc', 'b@example.com', 'short')); ok('a short password is refused', !!e && /8 characters/.test(e.message));
  ok('the right password signs in', (await DB.signIn('acc', 'ana@example.com', 'correct horse', T0)).email === 'ana@example.com');
  e = await fails(() => DB.signIn('acc', 'ana@example.com', 'wrong', T0 + 1000)); ok('the wrong password is refused', e && e.code === 'bad');
  const e2 = await fails(() => DB.signIn('acc', 'nobody@example.com', 'whatever123', T0 + 2000)); ok('an unknown email gives the SAME message (nothing to enumerate)', e2 && e2.message === e.message && e2.code === 'bad');
  // --- the weekly rule: fresh account, fake clock
  await DB.enable('wk', 'ai'); await DB.signUp('wk', 'kim@example.com', 'passw0rd-ok');
  let okCount = 0, last = null; for (let i = 0; i < 10; i++) { try { await DB.signIn('wk', 'kim@example.com', 'passw0rd-ok', T0 + i * 60000); okCount++; } catch (x) { last = x; } }
  ok('10 sign-ins in a week are all allowed', okCount === 10 && !last, last && last.message);
  e = await fails(() => DB.signIn('wk', 'kim@example.com', 'passw0rd-ok', T0 + 11 * 60000)); ok('the 11th gets the break', e && e.code === 'break' && /Try again in/.test(e.message), e && e.message);
  ok('the break is 4 hours from the 10th sign-in', e && Math.abs(e.retryAt - (T0 + 9 * 60000 + 4 * H)) < 1000, e && (e.retryAt - T0) / H);
  e = await fails(() => DB.signIn('wk', 'kim@example.com', 'passw0rd-ok', T0 + 3 * H)); ok('still blocked at 3 hours', e && e.code === 'break');
  e = await fails(() => DB.signIn('wk', 'kim@example.com', 'WRONG', T0 + 3 * H)); ok('a wrong password during the break is also just "break"', e && e.code === 'break');
  let back = await fails(() => DB.signIn('wk', 'kim@example.com', 'passw0rd-ok', T0 + 4 * H + 10 * 60000)); ok('after 4 hours a sign-in is allowed again', back === null || back.code !== 'break', back && back.message);
  await DB.enable('wk2', 'ai'); await DB.signUp('wk2', 'lee@example.com', 'passw0rd-ok');
  for (let i = 0; i < 9; i++) await DB.signIn('wk2', 'lee@example.com', 'passw0rd-ok', T0 + i * H);
  ok('9 spread over hours leaves one more', (await DB.signIn('wk2', 'lee@example.com', 'passw0rd-ok', T0 + 9 * H)).left === 0);
  e = await fails(() => DB.signIn('wk2', 'lee@example.com', 'passw0rd-ok', T0 + 10 * H)); ok('it is a rolling week, not a calendar reset: still blocked', e && e.code === 'break');
  await DB.enable('wk3', 'ai'); await DB.signUp('wk3', 'max@example.com', 'passw0rd-ok');
  for (let i = 0; i < 9; i++) await DB.signIn('wk3', 'max@example.com', 'passw0rd-ok', T0 + i * 60000);
  const after = await DB.signIn('wk3', 'max@example.com', 'passw0rd-ok', T0 + 8 * DAY); ok('after a week the old sign-ins stop counting', after.signinsThisWeek === 1, JSON.stringify(after));
  await DB.enable('g', 'ai'); await DB.signUp('g', 'zed@example.com', 'passw0rd-ok'); let guesses = 0, brk = null;
  for (let i = 0; i < 12; i++) { const x = await fails(() => DB.signIn('g', 'zed@example.com', 'guess' + i, T0 + i * 1000)); if (x && x.code === 'bad') guesses++; if (x && x.code === 'break') { brk = x; break; } }
  ok('guessing passwords hits the break too (failed tries count)', guesses === 10 && brk, 'guesses=' + guesses);
  e = await fails(() => DB.signIn('g', 'zed@example.com', 'passw0rd-ok', T0 + 20000)); ok('...and the real password is locked out during it', e && e.code === 'break');
  await DB.enable('two', 'ai'); await DB.signUp('two', 'a1@example.com', 'passw0rd-ok'); await DB.signUp('two', 'a2@example.com', 'passw0rd-ok');
  for (let i = 0; i < 10; i++) await fails(() => DB.signIn('two', 'a1@example.com', 'passw0rd-ok', T0 + i)); const other = await DB.signIn('two', 'a2@example.com', 'passw0rd-ok', T0 + 100); ok('one account being blocked does not block another', other.email === 'a2@example.com');
  // --- the project-wide ceiling
  await DB.enable('flood', 'ai'); let busy = null; for (let i = 0; i < 205 && !busy; i++) { const em = 'u' + i + '@example.com'; await DB.signUp('flood', em, 'passw0rd-ok'); const x = await fails(() => DB.signIn('flood', em, 'passw0rd-ok', T0 + i)); if (x && x.code === 'busy') busy = x; }
  ok('a flood across many accounts is stopped for the whole project', busy && busy.code === 'busy', busy && busy.message);
  // --- isolation + concurrency
  await DB.enable('p1', 'ai'); await DB.enable('p2', 'ai'); await DB.createTable('p1', 'notes', [{ name: 'a' }], 'ai'); await DB.signUp('p1', 'solo@example.com', 'passw0rd-ok');
  e = await fails(() => DB.select('p2', 'notes')); ok('projects cannot see each other\'s tables', !!e); e = await fails(() => DB.signIn('p2', 'solo@example.com', 'passw0rd-ok', T0)); ok('...or each other\'s accounts', e && e.code === 'bad');
  await DB.enable('race', 'ai'); await DB.createTable('race', 'c', [{ name: 'n', type: 'number' }], 'ai'); await Promise.all(Array.from({ length: 40 }, (_, i) => DB.insert('race', 'c', { n: i })));
  const rows = DB.select('race', 'c', { limit: 200 }); ok('40 simultaneous writes all land, no lost updates, no duplicate ids', rows.length === 40 && new Set(rows.map(r => r.id)).size === 40, rows.length);
  ok('it lives outside the project folder (no snapshot or push can include it)', !fs.existsSync(path.join(base, 'studio', 'app', 'database.json')));
  const note = DB.promptNote('wk'); ok('the AI is told the structure and the sign-in rule, never data or hashes', /10 times a week/.test(note) && !/hash|passw0rd/.test(note));
  ok('an off database tells the AI to turn it on only when needed', /OFF/.test(DB.promptNote('fresh')));
  DB.removeAll('app'); ok('deleting a project\'s database clears it', DB.status('app').enabled === false);
  ok('the lock map does not leak: nothing is kept once the work is done', DB._locks() === 0, DB._locks());
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); fs.rmSync(base, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
})();
