// The Agent Max cloud function in Studio mode: the PC's instructions must REACH the model, the answer comes back as plain text, one message is charged.
// Runs the real compiled function with a fake Deno, a fake login/allowance database and a fake model server.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcs-')), out = path.join(dir, 'cloud.mjs');
  execFileSync(process.execPath.replace(/node$/, 'node'), ['-e', 'process.exit(0)']);
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  const seen = { model: [], spend: 0, refund: 0 }; let modelMode = 'ok', used = 0;
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json');
    if (q.url.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (q.url.includes('pholama_max_spend')) { seen.spend++; used++; return s.end(JSON.stringify([{ ok: true, day_used: used, month_used: 20 + used }])); }
    if (q.url.includes('pholama_max_refund')) { seen.refund++; return s.end('{}'); }
    if (q.url.includes('chat/completions')) { const j = JSON.parse(b); seen.model.push(j); if (modelMode === 'fail') { s.statusCode = 500; return s.end('{}'); } return s.end(JSON.stringify({ choices: [{ message: { content: '<think>plan</think>I will add it.\n<tool>{"name":"studio_write","args":{"file":"a.js","content":"let x=1"}}</tool>' } }] })); }
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  // fake Deno + fetch rewrite: everything the function sends to Supabase / OpenRouter / Groq goes to the fake server
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', OPENROUTER_API_KEY: 'orkey', GROQ_API_KEY: 'g1' }[k]) } };
  const realFetch = global.fetch; global.fetch = (u, o) => { u = String(u); if (/nyswblzzvqzheaxvrqtq\.supabase\.co|openrouter\.ai|api\.groq\.com|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return realFetch(u, o); };
  await import('file://' + out);
  const call = body => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(body) })).then(async r => ({ status: r.status, j: await r.json() }));
  const SYS = 'STUDIO RULES: call tools like <tool>{"name":"studio_write"}</tool>. PROJECT MAP: index.html, app.js. ' + 'x'.repeat(6000);
  let r = await call({ studio: true, messages: [{ role: 'system', content: SYS }, { role: 'user', content: 'add a counter' }] });
  ok('Studio mode answers', r.status === 200 && r.j.reply, JSON.stringify(r));
  const sent = seen.model[0] && seen.model[0].messages;
  ok('the PC system prompt REACHES the model as the system message', sent && sent[0].role === 'system' && sent[0].content.startsWith('STUDIO RULES') && /PROJECT MAP/.test(sent[0].content), JSON.stringify(sent && sent[0]).slice(0, 120));
  ok('a long prompt (6000+ chars) is NOT cut to 2000', sent && sent[0].content.length > 6000, sent && sent[0].content.length);
  ok('the model is NOT forced into the old site-helper JSON shape', seen.model[0] && !seen.model[0].response_format && !/calculator/.test(JSON.stringify(sent)), JSON.stringify(seen.model[0]).slice(0, 200));
  ok('the model has room to write real code (max_tokens 3500)', seen.model[0] && seen.model[0].max_tokens >= 3000, seen.model[0] && seen.model[0].max_tokens);
  ok('the raw <tool> call comes back untouched for the PC to run', /<tool>\{"name":"studio_write"/.test(r.j.reply) && !/<think>/.test(r.j.reply), r.j.reply);
  ok('ONE model call and ONE message charged', seen.model.length === 1 && seen.spend === 1, seen.model.length + '/' + seen.spend);
  ok('the day and month counts come back for the counter', r.j.day_used === 1 && r.j.month_used === 21 && r.j.day_cap != null && r.j.month_cap === 30, JSON.stringify(r.j));
  // normal (non Studio) chat is unchanged: still the JSON site helper
  seen.model.length = 0; modelMode = 'ok';
  r = await call({ messages: [{ role: 'user', content: 'what is pholama' }] });
  ok('normal chat still uses the old JSON helper (response_format json)', seen.model[0] && seen.model[0].response_format && seen.model[0].response_format.type === 'json_object', JSON.stringify(seen.model[0] && seen.model[0].response_format));
  // nobody pays for a failure
  modelMode = 'fail'; const refundBefore = seen.refund;
  r = await call({ studio: true, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'go' }] });
  ok('when every model fails, the message is refunded', r.status === 500 && seen.refund === refundBefore + 1, r.status + ' refunds=' + (seen.refund - refundBefore));
  // the PC side: in a long job the rules survive the "last 12" cut
  const { keepRules } = require('../server/maxcloud');
  const long = [{ role: 'system', content: 'RULES' }]; for (let i = 0; i < 30; i++) long.push({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i });
  const kept = keepRules(long);
  ok('a long Studio job keeps the rules as the first message', kept[0].role === 'system' && kept[0].content === 'RULES', JSON.stringify(kept[0]));
  ok('and only the last 12 other messages', kept.length === 13 && kept[12].content === 'm29', kept.length);
  ok('with no system message it still just keeps the last 12', keepRules(long.slice(1)).length === 12);
  net.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
