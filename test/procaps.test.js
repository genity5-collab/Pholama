// Pholama Pro and Agent Max: Pro members get bigger allowances, everyone else is unchanged, and a broken Pro check NEVER locks anyone out.
// Runs the real compiled cloud function with a fake Deno and a fake database.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcap-')), out = path.join(dir, 'cloud.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  const W = require('./helpers/weeklyfake')({ used: 9 }); let proMode = 'free', spendArgs = null, proAsked = null;
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json');
    if (q.url.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (q.url.includes('pholama_is_pro')) { proAsked = JSON.parse(b); if (proMode === 'drop') return q.socket.destroy(); if (proMode === 'error') { s.statusCode = 500; return s.end('{}'); } if (proMode === 'garbage') return s.end('"yes please"'); return s.end(JSON.stringify(proMode === 'pro')); }
    W.used = global.__deny ? 1000 : 9;
    if (W.handle(decodeURIComponent(q.url), b, s)) { if (q.url.includes('weekly_spend')) spendArgs = JSON.parse(b); return; }
    if (q.url.includes('chat/completions') || q.url.includes('/v1/chat')) return s.end(JSON.stringify({ choices: [{ message: { content: '{"action":"answer","text":"hi"}' } }], free_ai_usage: { source: 'self_hosted' } }));
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', FREE_AI_API_KEY: 'fk' }[k]) } };
  const realFetch = global.fetch; global.fetch = (u, o) => { u = String(u); if (/nyswblzzvqzheaxvrqtq\.supabase\.co|api\.free\.ai|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return realFetch(u, o); };
  await import('file://' + out);
  const call = body => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(body) })).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  const M = { messages: [{ role: 'user', content: 'hi' }] };

  proMode = 'free'; let r = await call(M);
  ok('a free member gets the 1,000-credit weekly pool', r.j.week_cap === 1000 && r.j.month_cap === 1000, JSON.stringify(r.j));
  ok('a message is charged at 5 credits a word (one word = 5)', spendArgs && spendArgs.p_cost === 5, JSON.stringify(spendArgs));
  ok('the Pro check was asked about THIS member', proAsked && proAsked.p_user === 'u1', JSON.stringify(proAsked));

  proMode = 'pro'; r = await call(M);
  ok('a Pro member also uses the same 1,000-credit weekly pool (Pro perks are elsewhere)', r.j.week_cap === 1000, JSON.stringify(r.j));
  r = await call({ ...M, localTools: true });
  ok('having a strong local AI does not shrink the weekly pool', r.status === 200 && r.j.week_cap === 1000, JSON.stringify(r));

  proMode = 'error'; spendArgs = null; r = await call(M);
  ok('if the Pro check BREAKS the member still gets through', r.status === 200 && !!r.j.reply && !!spendArgs, JSON.stringify(r));
  proMode = 'drop'; spendArgs = null; r = await call(M);
  ok('if the Pro check cannot even connect the member still gets through', r.status === 200 && !!r.j.reply && !!spendArgs, JSON.stringify(r));
  proMode = 'garbage'; spendArgs = null; r = await call(M);
  ok('a nonsense Pro answer does not break the chat', r.status === 200 && !!spendArgs, JSON.stringify(spendArgs));
  proMode = 'free'; spendArgs = null; r = await call(M);
  ok('a free call really does reach the credit meter (test sanity)', !!spendArgs, JSON.stringify(spendArgs));

  global.__deny = true; spendArgs = null; r = await call(M);
  ok('someone who used all 1000 credits is told so and is not charged', r.status === 429 && r.j.code === 'limit-month' && /1000/.test(r.j.error) && spendArgs === null, JSON.stringify(r));
  global.__deny = undefined;
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); net.close(); process.exit(bad ? 1 : 0);
})();
