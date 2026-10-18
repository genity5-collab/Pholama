// Pholama Cloud credits: everyone gets 100 per rolling week. 5 credits per word you send, 3 per minute the AI works.
// Runs the real compiled function with a fake Deno and a fake database that behaves like pholama_cloud_usage / pholama_cloud_spend.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-')), out = path.join(dir, 'cloud.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  const day = off => new Date(Date.now() - off * 86400000).toISOString().slice(0, 10);
  let clockJump = 0, clockOn = false, base0 = 0;
  let rows = [], pro = false, modelFails = false, spends = [], refunds = [], models = [];
  const todayRow = () => rows.find(r => r.day === day(0));
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json'); const u = decodeURIComponent(q.url);
    if (u.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (u.includes('/rpc/pholama_is_pro')) return s.end(JSON.stringify(pro));
    if (u.includes('/rest/v1/pholama_cloud_usage')) { const m = /day=gte\.([\d-]+)/.exec(u), e = /day=eq\.([\d-]+)/.exec(u); return s.end(JSON.stringify(rows.filter(r => (m ? r.day >= m[1] : true) && (e ? r.day === e[1] : true)).map(r => ({ units: r.units })))); }
    if (u.includes('/rpc/pholama_cloud_spend')) { const a = JSON.parse(b); spends.push(a); let t = todayRow(); const cur = t ? t.units : 0;
      if (cur + a.p_cost > a.p_cap) return s.end(JSON.stringify([{ ok: false, used: cur, msgs: 0 }])); if (!t) rows.push(t = { day: day(0), units: 0 }); t.units += a.p_cost; return s.end(JSON.stringify([{ ok: true, used: t.units, msgs: 1 }])); }
    if (u.includes('/rpc/pholama_cloud_refund')) { const a = JSON.parse(b); refunds.push(a); const t = todayRow(); if (t) t.units = Math.max(0, t.units - a.p_cost); return s.end('{}'); }
    if (u.includes('/v1/chat')) { const j = JSON.parse(b); models.push(j); if (clockOn) clockJump += 130000; if (modelFails) { s.statusCode = 500; return s.end('{}'); } return s.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'answer', answer: 'Hi there' }) } }], free_ai_usage: { source: 'self_hosted' } })); }
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', FREE_AI_API_KEY: 'fk' }[k]) } };
  const realFetch = global.fetch; global.fetch = (u, o) => { u = String(u); if (/nyswblzzvqzheaxvrqtq\.supabase\.co|api\.free\.ai|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return realFetch(u, o); };
  await import('file://' + out);
  const call = text => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: text }] }) })).then(async r => ({ status: r.status, j: await r.json() }));

  // 1) a fresh account: 100 credits
  let r = await call('hello there');   // 2 words = 10 credits
  ok('a fresh account can chat', r.status === 200 && r.j.reply, JSON.stringify(r));
  ok('two words cost 10 credits (5 each)', r.j.cost === 10 && r.j.credits_left === 90, JSON.stringify(r.j));
  ok('the weekly pool is 100 for everyone', r.j.week_cap === 100 && r.j.month_cap === 100, JSON.stringify(r.j));
  // 2) words are counted even without spaces between sentences
  rows = []; r = await call('one two three four five six seven eight nine ten');   // 10 words = 50
  ok('ten words cost 50 credits', r.j.cost === 50 && r.j.credits_left === 50, JSON.stringify(r.j));
  r = await call('a b c d e f g h i j k');   // 11 words = 55 > 50 left
  ok('a message that costs more than what is left is refused', r.status === 429 && r.j.code === 'limit-month', JSON.stringify(r));
  ok('a refused message is not charged', todayRow().units === 50, todayRow().units);
  ok('the refusal tells the page the real numbers', r.j.credits_left === 50 && r.j.cost === 55, JSON.stringify(r.j));
  r = await call('a b c d e f g h i j');   // exactly 10 words = 50 = all that is left
  ok('spending exactly what is left works, then the account is at 0', r.status === 200 && r.j.credits_left === 0, JSON.stringify(r));
  r = await call('hi');
  ok('at 0 credits the AI stops', r.status === 429 && r.j.credits_left === 0, JSON.stringify(r));
  ok('the refusal never mentions models, keys or providers', !/openrouter|groq|free\.ai|api key|qwen|http \d|self_hosted/i.test(r.j.error), r.j.error);
  // 3) credits come back by themselves as the week moves on
  rows = [{ day: day(8), units: 100 }];   // spent 8 days ago: outside the 7-day window
  r = await call('hello');
  ok('spending older than 7 days no longer counts (resumes by itself)', r.status === 200 && r.j.credits_left === 95, JSON.stringify(r));
  rows = [{ day: day(3), units: 100 }];
  r = await call('hello');
  ok('spending from 3 days ago still counts', r.status === 429, JSON.stringify(r));
  rows = [{ day: day(3), units: 60 }, { day: day(1), units: 20 }];
  r = await call('hello there');   // 10 credits, 20 left
  ok('several days add up inside the week (60+20, then 10 more = 90)', r.status === 200 && r.j.credits_left === 10, JSON.stringify(r));
  // 4) a failed answer is not charged
  rows = []; refunds = []; modelFails = true;
  r = await call('hello there');
  ok('when the AI cannot answer the person gets a plain message', r.status === 500 && !/self_hosted|openrouter|groq|HTTP/i.test(r.j.error), JSON.stringify(r));
  ok('and the credits are given back', (todayRow() ? todayRow().units : 0) === 0 && refunds.length >= 1, JSON.stringify({ rows, refunds }));
  modelFails = false;
  // 5) the work-time charge: a quick answer is free, a long one costs 3 per minute
  rows = []; const realNow = Date.now;
  r = await call('hello there');
  ok('a quick answer (under a minute) adds no work-time charge', r.j.credits_left === 90, JSON.stringify(r.j));
  rows = []; clockOn = true; clockJump = 0; base0 = realNow(); Date.now = () => base0 + clockJump;
  r = await call('hello there'); Date.now = realNow; clockOn = false;
  ok('2 minutes of AI work cost 6 more credits (3 per minute)', r.j.credits_left === 84 && todayRow().units === 16, JSON.stringify({ r: r.j, rows }));
  // 6) only self-hosted free.ai models
  ok('every model call goes to the self-hosted Free.ai model only', models.length > 0 && models.every(m => m.model === 'qwen7b'), JSON.stringify(models.map(m => m.model)));
  net.close(); console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
