// Pholama Pro and Agent Max: Pro members get bigger allowances, everyone else is unchanged, and a broken Pro check NEVER locks anyone out.
// Runs the real compiled cloud function with a fake Deno and a fake database.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcap-')), out = path.join(dir, 'cloud.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  let proMode = 'free', spendArgs = null, proAsked = null;
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json');
    if (q.url.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (q.url.includes('pholama_is_pro')) { proAsked = JSON.parse(b); if (proMode === 'drop') return q.socket.destroy(); if (proMode === 'error') { s.statusCode = 500; return s.end('{}'); } if (proMode === 'garbage') return s.end('"yes please"'); return s.end(JSON.stringify(proMode === 'pro')); }
    if (q.url.includes('pholama_max_spend')) { spendArgs = JSON.parse(b); return s.end(JSON.stringify([{ ok: !global.__deny, reason: global.__deny, day_used: 3, month_used: 9 }])); }
    if (q.url.includes('pholama_max_refund')) return s.end('{}');
    if (q.url.includes('chat/completions')) return s.end(JSON.stringify({ choices: [{ message: { content: '{"action":"answer","text":"hi"}' } }] }));
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', OPENROUTER_API_KEY: 'orkey', GROQ_API_KEY: 'g1' }[k]) } };
  const realFetch = global.fetch; global.fetch = (u, o) => { u = String(u); if (/nyswblzzvqzheaxvrqtq\.supabase\.co|openrouter\.ai|api\.groq\.com|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return realFetch(u, o); };
  await import('file://' + out);
  const call = body => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(body) })).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  const M = { messages: [{ role: 'user', content: 'hi' }] };

  proMode = 'free'; let r = await call(M);
  ok('a free member keeps 10 a day and 30 a month', spendArgs.p_day_cap === 10 && spendArgs.p_month_cap === 30, JSON.stringify(spendArgs));
  ok('the reply tells the page the free caps', r.j.day_cap === 10 && r.j.month_cap === 30, JSON.stringify(r.j));
  ok('the Pro check was asked about THIS member', proAsked && proAsked.p_user === 'u1', JSON.stringify(proAsked));

  proMode = 'pro'; r = await call(M);
  ok('a Pro member gets 15 a day and 35 a month', spendArgs.p_day_cap === 15 && spendArgs.p_month_cap === 35, JSON.stringify(spendArgs));
  ok('the reply tells the page the Pro caps', r.j.day_cap === 15 && r.j.month_cap === 35, JSON.stringify(r.j));
  r = await call({ ...M, localTools: true });
  ok('Pro with a strong local AI still gets a bit more than free (2 not 1)', spendArgs.p_day_cap === 2 && spendArgs.p_month_cap === 35, JSON.stringify(spendArgs));
  proMode = 'free'; await call({ ...M, localTools: true });
  ok('free with a strong local AI is still 1 a day', spendArgs.p_day_cap === 1, JSON.stringify(spendArgs));

  proMode = 'error'; spendArgs = null; r = await call(M);
  ok('if the Pro check BREAKS the member still gets through on the free caps', r.status === 200 && !!r.j.reply && !!spendArgs && spendArgs.p_day_cap === 10 && spendArgs.p_month_cap === 30, JSON.stringify([r.status, spendArgs, r.j]));
  proMode = 'drop'; spendArgs = null; r = await call(M);
  ok('if the Pro check cannot even connect the member still gets through on the free caps', r.status === 200 && !!r.j.reply && !!spendArgs && spendArgs.p_day_cap === 10 && spendArgs.p_month_cap === 30, JSON.stringify([r.status, spendArgs, r.j]));
  proMode = 'garbage'; spendArgs = null; r = await call(M);
  ok('a nonsense Pro answer is NOT treated as Pro', r.status === 200 && !!spendArgs && spendArgs.p_day_cap === 10, JSON.stringify(spendArgs));
  proMode = 'free'; spendArgs = null; r = await call(M);
  ok('a free call really does reach the allowance counter (test sanity)', !!spendArgs, JSON.stringify(spendArgs));

  proMode = 'pro'; global.__deny = 'day'; r = await call(M);
  ok('a Pro member who used today\'s 15 is told 15, not 10', r.status === 429 && /15/.test(r.j.error) && !/\b10\b/.test(r.j.error), r.j.error);
  global.__deny = 'month'; r = await call(M);
  ok('a Pro member who used the month is told 35', /35/.test(r.j.error), r.j.error);
  global.__deny = undefined; proMode = 'free'; global.__deny = 'month'; r = await call(M);
  ok('a free member who used the month is told 30', /30/.test(r.j.error), r.j.error);
  global.__deny = undefined;
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); net.close(); process.exit(bad ? 1 : 0);
})();
