// Per-account credit allowance (supabase/owner_credits.sql): the owner gets 1,500 + 8,500 = 10,000, everyone else stays at 1,500, and a failing lookup never lowers anyone.
// Runs the real compiled function with a fake Deno, a fake credits database and a fake model server.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cex-')), out = path.join(dir, 'cloud.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  const W = require('./helpers/weeklyfake')({ used: 0 });
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json');
    if (q.url.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (W.handle(decodeURIComponent(q.url), b, s)) return;
    if (q.url.includes('/v1/chat')) return s.end(JSON.stringify({ choices: [{ message: { content: 'hello there' } }], free_ai: { source: 'self_hosted' } }));
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', FREE_AI_API_KEY: 'fk' }[k]) } };
  global.fetch = ((rf) => (u, o) => { u = String(u); if (/supabase\.co|api\.free\.ai|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return rf(u, o); })(global.fetch);
  await import('file://' + out);
  const call = body => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(body) })).then(async r => ({ status: r.status, j: await r.json() }));

  // normal account: 1,500
  let r = await call({ status: true });
  ok('a normal account shows 1,500', r.j.week_cap === 1500 && r.j.credits_left === 1500, JSON.stringify(r));

  // the owner: 1,500 + 8,500 = 10,000
  W.extra = 8500;
  r = await call({ status: true });
  ok('the owner shows 10,000 credits', r.j.week_cap === 10000 && r.j.credits_left === 10000, JSON.stringify(r));
  W.used = 1365;
  r = await call({ status: true });
  ok('with 1,365 used the owner has 8,635 left', r.j.credits_left === 8635 && r.j.day_used === 1365, JSON.stringify(r));
  r = await call({ model: 'qwen7b', messages: [{ role: 'user', content: 'hello there friend' }] });   // 3 words
  ok('the owner can keep sending past 1,500 used', r.status === 200 && r.j.reply, JSON.stringify(r));
  ok('and the answer shows the 10,000 cap', r.j.week_cap === 10000, JSON.stringify(r));

  // the owner runs out at 10,000, not before and not after
  W.used = 9990;
  r = await call({ model: 'qwen7b', messages: [{ role: 'user', content: 'one two three four five six seven eight nine ten eleven twelve' }] });   // 12 words = 60 credits
  ok('past 10,000 the owner is stopped with a plain message', r.status === 429 || (r.j.error && /credits/i.test(r.j.error)), JSON.stringify(r));

  // everyone else is unchanged
  W.extra = 0; W.used = 1499;
  r = await call({ model: 'qwen7b', messages: [{ role: 'user', content: 'hello there friend' }] });
  ok('a normal account is still stopped at 1,500', r.status !== 200 || !r.j.reply, JSON.stringify(r));

  // a failing lookup never lowers or breaks anyone
  W.extra = 8500; W.extraFails = true; W.used = 0;
  r = await call({ status: true });
  ok('if the allowance lookup fails the account simply has the normal 1,500', r.j.week_cap === 1500 && r.j.credits_left === 1500, JSON.stringify(r));
  r = await call({ model: 'qwen7b', messages: [{ role: 'user', content: 'hello there friend' }] });
  ok('and messages still work', r.status === 200 && r.j.reply, JSON.stringify(r));
  W.extraFails = false;

  // the Codebase pool gets the same allowance
  W.extra = 8500; W.cb.used = 0;
  const task = n => ({ studio: true, codebase: true, model: 'qwen-coder', messages: [{ role: 'system', content: 'RULES' }, { role: 'user', content: n }] });
  r = await call(task('fix the menu bug please'));
  ok('Codebase shows the owner 15,000 + 8,500', r.status === 200 && r.j.week_cap === 23500, JSON.stringify(r));

  // the SQL file itself
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'owner_credits.sql'), 'utf8');
  ok('the SQL gives the owner account 8,500 extra', /d0c8bb82-1501-4eae-b7be-bae1cd1acba1', 8500/.test(sql));
  ok('the SQL keeps the allowance server-only (no anon or logged-in access)', /revoke all on public\.pholama_credit_bonus from anon, authenticated/.test(sql) && /revoke all on function public\.pholama_credit_extra\(uuid\) from public, anon, authenticated/.test(sql));
  ok('the SQL raises the weekly check so 10,000 is possible', /used <= 1001500/.test(sql));
  ok('the SQL creates the Codebase pool too', /create table if not exists public\.pholama_codebase_monthly_usage/.test(sql) && /pholama_codebase_spend/.test(sql));
  ok('the SQL can be run again (no plain create or insert without a guard)', !/^create table (?!if not exists)/m.test(sql) && /on conflict \(user_id\) do update/.test(sql));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); net.close(); process.exit(bad ? 1 : 0);
})();
