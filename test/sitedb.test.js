// Website database: the same rules as the PC, on the cloud code. Fake clock for the week and the 4 hour break.
const load = require('./helpers/sitecore');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async fn => { try { await fn(); return null; } catch (e) { return e; } };
const H = 3600 * 1000, DAY = 24 * H, T0 = Date.UTC(2026, 9, 11, 9, 0, 0);
(async () => {
  const D = await load('siteStudioDb.ts'); const fresh = () => D.emptyDoc();
  let d = fresh(), e;
  for (const f of [() => D.enable(d, 'user'), () => D.enable(d), () => D.enable(d, 'page'), () => D.createTable(d, 'x', [{ name: 'a' }], 'user'), () => D.dropTable(d, 'x', 'user')]) { e = await fails(f); ok('not the AI, refused: ' + f.toString().slice(6, 38), e && e.code === 'ai-only'); }
  ok('it starts off', d.enabled === false); e = await fails(() => D.insert(d, 'notes', { a: 1 })); ok('a write while off is refused', !!e && /off/.test(e.message));
  D.enable(d, 'ai'); D.createTable(d, 'notes', [{ name: 'title' }, { name: 'stars', type: 'number' }, { name: 'done', type: 'boolean' }, { name: 'due', type: 'date' }], 'ai');
  for (const [why, args] of [['bad table name', ['Drop Table;', [{ name: 'a' }]]], ['reserved accounts', ['accounts', [{ name: 'a' }]]], ['reserved __proto__', ['__proto__', [{ name: 'a' }]]], ['no columns', ['empty', []]], ['column called id', ['x1', [{ name: 'id' }]]], ['bad type', ['x2', [{ name: 'a', type: 'blob' }]]], ['duplicate column', ['x3', [{ name: 'a' }, { name: 'a' }]]], ['21 columns', ['x4', Array.from({ length: 21 }, (_, i) => ({ name: 'c' + i }))]]]) { e = await fails(() => D.createTable(d, args[0], args[1], 'ai')); ok('refused: ' + why, !!e); }
  for (let i = 0; i < 7; i++) D.createTable(d, 'tbl' + i, [{ name: 'a' }], 'ai'); e = await fails(() => D.createTable(d, 'ninth', [{ name: 'a' }], 'ai')); ok('at most 8 tables', !!e && /8 tables/.test(e.message));
  const r1 = D.insert(d, 'notes', { title: 'Buy milk', stars: '3', done: 'false', due: '2026-10-12' }); ok('rows get an id and the right types', r1.id > 0 && r1.stars === 3 && r1.done === false && /^2026-10-12/.test(r1.due));
  e = await fails(() => D.insert(d, 'notes', { color: 'red' })); ok('unknown column refused', !!e); e = await fails(() => D.insert(d, 'notes', { stars: 'lots' })); ok('wrong type refused', !!e);
  D.update(d, 'notes', r1.id, { done: true }); ok('update', D.select(d, 'notes', { where: { done: true } }).length === 1); D.remove(d, 'notes', r1.id); ok('delete', D.select(d, 'notes').length === 0);
  // size cap
  d = fresh(); D.enable(d, 'ai'); D.createTable(d, 'b', [{ name: 'data' }], 'ai'); let full = null; for (let i = 0; i < 5000 && !full; i++) { try { D.insert(d, 'b', { data: 'y'.repeat(3900) }); D.fits(d); } catch (x) { full = x; } }
  ok('it stops at 0.01 GB with a clear message', full && full.code === 'full', full && full.message);
  // accounts
  d = fresh(); D.enable(d, 'ai'); const a = await D.signUp(d, 'Ana@Example.com', 'correct horse'); ok('sign up normalises the email', a.email === 'ana@example.com');
  ok('the password is never stored and status hides emails and hashes', !JSON.stringify(d).includes('correct horse') && !JSON.stringify(D.status(d)).includes('ana@') && !/hash|salt/.test(JSON.stringify(D.status(d))));
  e = await fails(() => D.signUp(d, 'ana@example.com', 'another one 123')); ok('duplicate email refused', !!e && /already/.test(e.message)); e = await fails(() => D.signUp(d, 'b@example.com', 'short')); ok('short password refused', !!e);
  ok('the right password signs in', (await D.signIn(d, 'ana@example.com', 'correct horse', T0)).good === true);
  const bad1 = await D.signIn(d, 'ana@example.com', 'wrong', T0 + 1000), bad2 = await D.signIn(d, 'nobody@example.com', 'whatever123', T0 + 2000); ok('wrong password and unknown email look the same', bad1.good === false && bad2.good === false && bad1.account === null);
  // the weekly rule
  const mk = async em => { const x = fresh(); D.enable(x, 'ai'); await D.signUp(x, em, 'passw0rd-ok'); return x; };
  d = await mk('kim@example.com'); let n = 0; for (let i = 0; i < 10; i++) { const r = await D.signIn(d, 'kim@example.com', 'passw0rd-ok', T0 + i * 60000); if (r.good) n++; } ok('10 sign-ins in a week are allowed', n === 10);
  e = await fails(() => D.signIn(d, 'kim@example.com', 'passw0rd-ok', T0 + 11 * 60000)); ok('the 11th gets the 4 hour break', e && e.code === 'break' && /Try again in/.test(e.message) && Math.abs(e.retryAt - (T0 + 9 * 60000 + 4 * H)) < 1000, e && e.message);
  e = await fails(() => D.signIn(d, 'kim@example.com', 'passw0rd-ok', T0 + 3 * H)); ok('still blocked at 3 hours', e && e.code === 'break'); e = await fails(() => D.signIn(d, 'kim@example.com', 'WRONG', T0 + 3 * H)); ok('a wrong password in the break is also just "break"', e && e.code === 'break');
  ok('after 4 hours it works again', (await D.signIn(d, 'kim@example.com', 'passw0rd-ok', T0 + 4 * H + 10 * 60000)).good === true);
  d = await mk('lee@example.com'); for (let i = 0; i < 9; i++) await D.signIn(d, 'lee@example.com', 'passw0rd-ok', T0 + i * H); ok('9 spread over hours leaves none after the 10th', (await D.signIn(d, 'lee@example.com', 'passw0rd-ok', T0 + 9 * H)).account.left === 0);
  e = await fails(() => D.signIn(d, 'lee@example.com', 'passw0rd-ok', T0 + 10 * H)); ok('it is a rolling week: still blocked', e && e.code === 'break');
  d = await mk('max@example.com'); for (let i = 0; i < 9; i++) await D.signIn(d, 'max@example.com', 'passw0rd-ok', T0 + i * 60000); ok('after a week the old sign-ins stop counting', (await D.signIn(d, 'max@example.com', 'passw0rd-ok', T0 + 8 * DAY)).account.signinsThisWeek === 1);
  d = await mk('zed@example.com'); let guesses = 0, brk = null; for (let i = 0; i < 12; i++) { try { const r = await D.signIn(d, 'zed@example.com', 'guess' + i, T0 + i * 1000); if (!r.good) guesses++; } catch (x) { if (x.code === 'break') { brk = x; break; } } }
  ok('guessing passwords hits the break (failed tries count)', guesses === 10 && brk, 'guesses=' + guesses); e = await fails(() => D.signIn(d, 'zed@example.com', 'passw0rd-ok', T0 + 20000)); ok('the real password is locked out during it', e && e.code === 'break');
  d = fresh(); D.enable(d, 'ai'); await D.signUp(d, 'a1@example.com', 'passw0rd-ok'); await D.signUp(d, 'a2@example.com', 'passw0rd-ok'); for (let i = 0; i < 10; i++) await D.signIn(d, 'a1@example.com', 'passw0rd-ok', T0 + i); ok('one blocked account does not block another', (await D.signIn(d, 'a2@example.com', 'passw0rd-ok', T0 + 100)).good === true);
  d = fresh(); D.enable(d, 'ai'); let busy = null; for (let i = 0; i < 205 && !busy; i++) { const em = 'u' + i + '@example.com'; await D.signUp(d, em, 'passw0rd-ok'); try { await D.signIn(d, em, 'passw0rd-ok', T0 + i); } catch (x) { if (x.code === 'busy') busy = x; } }
  ok('a flood across many accounts stops the whole project', busy && busy.code === 'busy');
  ok('the AI is told the rule', /10 times a week/.test(D.promptNote(d)) && !/hash|passw0rd/.test(D.promptNote(d))); ok('off tells the AI to turn it on only when needed', /OFF/.test(D.promptNote(fresh())));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
