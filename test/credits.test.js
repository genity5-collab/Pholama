// Pholama Cloud credits: everyone gets 100 per rolling week. 5 credits per word you send, 3 per minute the AI works.
// Runs the real compiled function with a fake Deno and a fake database that behaves like pholama_cloud_usage / pholama_cloud_spend.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-')), out = path.join(dir, 'cloud.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  const W = require('./helpers/weeklyfake')({ used: 0 });
  let clockJump = 0, clockOn = false, base0 = 0, modelFails = false, models = [];
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json'); const u = decodeURIComponent(q.url);
    if (u.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (W.handle(u, b, s)) return;
    if (u.includes('/v1/chat')) { const j = JSON.parse(b); models.push(j); if (clockOn) clockJump += 130000; if (modelFails) { s.statusCode = 500; return s.end('{}'); } return s.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'answer', answer: 'Sure, here is a plain answer.' }) } }], free_ai_usage: { source: 'self_hosted', model: j.model } })); }
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', FREE_AI_API_KEY: 'fk' }[k]) } };
  const realFetch = global.fetch; global.fetch = (u, o) => { u = String(u); if (/nyswblzzvqzheaxvrqtq\.supabase\.co|api\.free\.ai|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return realFetch(u, o); };
  await import('file://' + out);
  const call = text => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: text }] }) })).then(async r => ({ status: r.status, j: await r.json() }));

  // 1) a fresh account: 1,500 credits a week
  let r = await call('hello there');   // 2 words x 5 = 10 credits
  ok('a fresh account can chat', r.status === 200 && r.j.reply, JSON.stringify(r));
  ok('two words cost 10 credits (5 each)', r.j.cost === 10 && r.j.credits_left === 1490, JSON.stringify(r.j));
  ok('the weekly pool is 1,500 for everyone', r.j.week_cap === 1500 && r.j.month_cap === 1500, JSON.stringify(r.j));
  ok('the spend reaches the database with the exact cost', W.spends.length === 1 && W.spends[0].p_cost === 10 && W.spends[0].p_user === 'u1', JSON.stringify(W.spends));
  // 2) words are counted even without spaces between sentences
  W.used = 0; r = await call('one two three four five six seven eight nine ten');   // 10 words = 50
  ok('ten words cost 50 credits', r.j.cost === 50 && r.j.credits_left === 1450, JSON.stringify(r.j));
  W.used = 1460; r = await call('a b c d e f g h i j k');   // 11 words = 55 > 40 left
  ok('a message that costs more than what is left is refused', r.status === 429 && r.j.code === 'limit-month', JSON.stringify(r));
  ok('a refused message is not charged', W.used === 1460, W.used);
  ok('the refusal tells the page the real numbers', r.j.credits_left === 40 && r.j.cost === 55, JSON.stringify(r.j));
  r = await call('a b c d e f g h');   // exactly 8 words = 40 = all that is left
  ok('spending exactly what is left works, then the account is at 0', r.status === 200 && r.j.credits_left === 0, JSON.stringify(r));
  r = await call('hi');
  ok('at 0 credits the AI stops', r.status === 429 && r.j.credits_left === 0, JSON.stringify(r));
  ok('the refusal never mentions models, keys or providers', !/openrouter|groq|free\.ai|api key|qwen|http \d|self_hosted/i.test(r.j.error), r.j.error);
  // 3) the credit check itself can fail: the person is told plainly and nothing is charged
  W.used = 0; W.usageFails = true; W.spends.length = 0;
  r = await call('hello');
  ok('if the credit count cannot be read the AI does not run and nothing is charged', r.status === 502 && r.j.code === 'limit-check' && W.spends.length === 0, JSON.stringify(r));
  W.usageFails = false; W.spendFails = true;
  r = await call('hello');
  ok('if the charge cannot be recorded the answer is not given for free', r.status === 502 && r.j.code === 'limit-check', JSON.stringify(r));
  W.spendFails = false;
  // 4) a failed answer is not charged
  W.used = 0; W.refunds.length = 0; modelFails = true;
  r = await call('hello there');
  ok('when the AI cannot answer the person gets a plain message', r.status === 500 && !/self_hosted|openrouter|groq|HTTP/i.test(r.j.error), JSON.stringify(r));
  ok('and the credits are given back', W.used === 0 && W.refunds.length >= 1 && W.refunds[0].p_cost === 10, JSON.stringify({ used: W.used, refunds: W.refunds }));
  modelFails = false;
  // 5) the work-time charge: a quick answer is free, a long one costs 5 per started minute
  W.used = 0; const realNow = Date.now;
  r = await call('hello there');
  ok('a quick answer (under a minute) adds no work-time charge', r.j.credits_left === 1490 && W.used === 10, JSON.stringify({ r: r.j, used: W.used }));
  W.used = 0; clockOn = true; clockJump = 0; base0 = realNow(); Date.now = () => base0 + clockJump;
  r = await call('hello there'); Date.now = realNow; clockOn = false;
  ok('2 minutes of AI work cost 10 more credits (5 per minute)', r.j.credits_left === 1480 && W.used === 20, JSON.stringify({ r: r.j, used: W.used }));
  // 6) the cap is the same for a Pro member (Pro perks are elsewhere) unless the code says otherwise
  W.used = 0; W.pro = true; r = await call('hello there');
  ok('a Pro member can chat and the pool is reported', r.status === 200 && r.j.week_cap >= 1500, JSON.stringify(r.j)); W.pro = false;
  // 7) only self-hosted free.ai models
  ok('every model call goes to the self-hosted Free.ai model only', models.length > 0 && models.every(m => m.model === 'qwen7b'), JSON.stringify(models.map(m => m.model)));
  net.close(); console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
