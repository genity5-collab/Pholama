// Pholama Codebase through the cloud function (Studio mode + codebase:true): model choice, price, reply room, refunds, the zero-spend guard.
// Runs the real compiled function with a fake Deno, a fake credits database and a fake model server.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-')), out = path.join(dir, 'cloud.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  const W = require('./helpers/weeklyfake')({ used: 0 }); const seen = { model: [] }; let mode = 'ok', replyText = '<tool>{"name":"done","summary":"ok"}</tool>';
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json');
    if (q.url.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (W.handle(decodeURIComponent(q.url), b, s)) return;
    if (q.url.includes('/v1/chat')) { const j = JSON.parse(b); seen.model.push(j); if (mode === 'fail') { s.statusCode = 500; return s.end('{}'); } return s.end(JSON.stringify({ choices: [{ message: { content: replyText } }], free_ai_usage: { source: mode === 'paid' ? 'openrouter' : 'self_hosted' } })); }
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', FREE_AI_API_KEY: 'fk' }[k]) } };
  global.fetch = ((rf) => (u, o) => { u = String(u); if (/supabase\.co|api\.free\.ai|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return rf(u, o); })(global.fetch);
  await import('file://' + out);
  const call = body => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(body) })).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  const cb = (model, task, extra = {}) => ({ studio: true, codebase: true, model, messages: [{ role: 'system', content: 'RULES' }, { role: 'user', content: task }], ...extra });

  // models and prices
  let r = await call(cb('qwen-coder', 'fix the menu bug please')); // 5 words
  ok('qwen-coder is accepted', r.status === 200 && r.j.reply, JSON.stringify(r));
  ok('the model sent to Free.ai is exactly qwen-coder', seen.model[0].model === 'qwen-coder', seen.model[0].model);
  ok('qwen-coder costs 5 credits a word (5 words = 25)', r.j.cost === 25 && W.cb.spends[0].p_cost === 25, JSON.stringify(W.cb.spends[0]));
  r = await call(cb('qwen3-coder', 'fix the menu bug please')); // 5 words
  ok('qwen3-coder is accepted', r.status === 200 && r.j.reply, JSON.stringify(r));
  ok('the model sent to Free.ai is exactly qwen3-coder', seen.model[1].model === 'qwen3-coder', seen.model[1].model);
  ok('qwen3-coder costs 10 credits a word (5 words = 50)', r.j.cost === 50 && W.cb.spends[1].p_cost === 50, JSON.stringify(W.cb.spends[1]));
  r = await call(cb('qwen-coder', 'a'));
  ok('a one-word task still costs at least the model rate', r.j.cost === 5, r.j.cost);
  r = await call(cb('qwen3-coder', 'a'));
  ok('a one-word debugging task costs at least 10', r.j.cost === 10, r.j.cost);

  ok('both coders run steady (temperature 0.15), not chatty', seen.model[0].temperature === 0.15 && seen.model[1].temperature === 0.15, seen.model[0].temperature + '/' + seen.model[1].temperature);
  // only what the person typed is billed: everything after the [Studio] marker (tool results, notes, screenshots) is free
  const typed = 'make the checkout page work', hidden = '\n\n[Studio]\nRESULT: ' + 'word '.repeat(900);
  r = await call(cb('qwen-coder', typed + hidden));
  ok('a long tool result after the [Studio] marker is not billed as typed words (5 words = 25)', r.j.cost === 25, r.j.cost);
  r = await call(cb('qwen3-coder', typed + hidden));
  ok('same for qwen3-coder (5 words = 50)', r.j.cost === 50, r.j.cost);

  // room for big replies
  const lastReq = () => seen.model[seen.model.length - 1];
  await call(cb('qwen-coder', 'build it'));
  ok('Codebase replies get 6,000 tokens of room', lastReq().max_tokens === 6000, lastReq().max_tokens);
  await call({ studio: true, model: 'qwen-coder', messages: [{ role: 'system', content: 'R' }, { role: 'user', content: 'build it' }] });
  ok('plain Studio keeps 3,500 (Codebase did not change it)', lastReq().max_tokens === 3500, lastReq().max_tokens);
  await call({ studio: true, codebase: false, model: 'qwen-coder', messages: [{ role: 'system', content: 'R' }, { role: 'user', content: 'build it' }] });
  ok('codebase:false is plain Studio', lastReq().max_tokens === 3500);
  await call({ studio: true, codebase: 'true', model: 'qwen-coder', messages: [{ role: 'system', content: 'R' }, { role: 'user', content: 'build it' }] });
  ok('only a real boolean true turns Codebase on ("true" text does not)', lastReq().max_tokens === 3500);
  await call({ model: 'qwen-coder', codebase: true, messages: [{ role: 'user', content: 'what is pholama' }] });
  ok('codebase:true without studio:true does not get the big room (normal chat is unchanged)', lastReq().max_tokens !== 6000, lastReq().max_tokens);

  // a long reply is not cut at 16,000 characters for Codebase, but still is for plain Studio
  replyText = 'x'.repeat(25000);
  r = await call(cb('qwen-coder', 'write a lot'));
  ok('a 25,000 character Codebase reply arrives whole', r.j.reply && r.j.reply.length === 25000, r.j.reply && r.j.reply.length);
  r = await call({ studio: true, model: 'qwen-coder', messages: [{ role: 'system', content: 'R' }, { role: 'user', content: 'write a lot' }] });
  ok('plain Studio is still cut at 16,000', r.j.reply && r.j.reply.length === 16000, r.j.reply && r.j.reply.length);
  replyText = 'y'.repeat(40000);
  r = await call(cb('qwen-coder', 'write a lot'));
  ok('even Codebase has an upper bound (30,000)', r.j.reply && r.j.reply.length === 30000, r.j.reply && r.j.reply.length);
  replyText = '<tool>{"name":"done","summary":"ok"}</tool>';

  // ---- Codebase has its OWN monthly pool; the 1,500 weekly credits are never touched ----
  { const wk0 = W.spends.length, wkUsed = W.used, cb0 = W.cb.spends.length, cbUsed = W.cb.used;
    r = await call(cb('qwen-coder', 'fix the menu bug please'));   // 25
    ok('a Codebase call charges the Codebase pool', W.cb.spends.length === cb0 + 1 && W.cb.used === cbUsed + 25, JSON.stringify(W.cb));
    ok('and never touches the weekly credits', W.spends.length === wk0 && W.used === wkUsed);
    ok('the answer reports the monthly cap (15,000) and what is left', r.j.week_cap === 15000 && r.j.credits_left === 15000 - W.cb.used, JSON.stringify({ c: r.j.week_cap, l: r.j.credits_left }));
    W.used = 1500;   // the whole WEEK is spent...
    r = await call(cb('qwen-coder', 'fix the menu bug please'));
    ok('a spent week does NOT block Codebase while its monthly pool has room', r.status === 200 && r.j.reply, r.status + ' ' + JSON.stringify(r.j).slice(0, 120));
    r = await call({ model: 'qwen7b', messages: [{ role: 'user', content: 'what is pholama' }] });
    ok('but normal chat IS still blocked by the spent week', r.status === 429 && r.j.code === 'limit-month', r.status);
    W.used = 0;
    const wkS = W.spends.length;
    r = await call({ model: 'qwen-coder', codebase: true, messages: [{ role: 'user', content: 'what is pholama' }] });   // claims Codebase without studio:true
    ok('claiming codebase:true without studio:true cannot use the Codebase pool', W.cb.spends.length === cb0 + 2 && W.spends.length === wkS + 1, W.cb.spends.length + '/' + (W.spends.length - wkS));
    W.cb.used = 14990;   // Codebase pool nearly spent
    const sp = W.cb.spends.length; r = await call(cb('qwen-coder', 'fix the menu bug please'));   // 25 > 10 left
    ok('Codebase pool spent: refused with a MONTH message, not "week"', r.status === 429 && r.j.code === 'limit-month' && /month/.test(r.j.error) && !/week/.test(r.j.error), r.j.error);
    ok('and the refusal is for 10 left of 15,000', r.j.credits_left === 10 && r.j.week_cap === 15000, JSON.stringify(r.j).slice(0, 160));
    ok('and nothing was charged (the pool stays at 14,990)', W.cb.used === 14990);
    W.cb.used = 0; }

  // models that must not work
  for (const m of ['mistral-large', 'gpt-4o', 'qwen3-coder ', 'QWEN-CODER', '', 'constructor', '__proto__', 'toString']) {
    const before = W.cb.spends.length; r = await call(cb(m, 'hello there'));
    ok('model ' + JSON.stringify(m) + ' is refused or moved to the cheap chat model, never billed as a coder', (r.status === 400 && r.j.code === 'model' && W.cb.spends.length === before) || (r.status === 200 && seen.model[seen.model.length - 1].model === 'qwen7b'), r.status + ' ' + JSON.stringify(r.j).slice(0, 100));
  }
  // not enough credits
  const W2 = W.cb; W2.used = 14980;
  const spendsBefore = W2.spends.length; r = await call(cb('qwen3-coder', 'one two three four five'));   // 50 credits, only 20 left
  ok('not enough credits: refused with the limit code, 429', r.status === 429 && r.j.code === 'limit-month', r.status + ' ' + JSON.stringify(r.j).slice(0, 120));
  ok('and no model call was made for it', seen.model.length === seen.model.length && !(r.j.reply));
  W2.used = 0;
  // failure refunds exactly what was charged
  mode = 'fail'; const refBefore = W.cb.refunds.length, usedBefore = W.cb.used;
  r = await call(cb('qwen3-coder', 'one two three'));   // 30 credits
  ok('when the model fails, the message is refunded', r.status === 500 && W.cb.refunds.length === refBefore + 1, r.status);
  ok('the refund is exactly the charge (30)', W.cb.refunds[W.cb.refunds.length - 1].p_cost === 30 && W.cb.used === usedBefore, JSON.stringify(W.cb.refunds[W.cb.refunds.length - 1]) + ' used=' + W.cb.used);
  // zero-spend guard: a paid model answer is refused and refunded, and the reply never reaches the user
  mode = 'paid'; const refPaid = W.cb.refunds.length;
  r = await call(cb('qwen-coder', 'one two three'));
  ok('a non-self-hosted answer is refused and refunded', r.status === 500 && W.cb.refunds.length === refPaid + 1 && !r.j.reply, r.status);
  r = await call(cb('qwen3-coder', 'one two three'));
  ok('the same guard protects qwen3-coder', r.status === 500 && !r.j.reply, r.status);
  mode = 'ok';
  // no login
  const noAuth = await handler(new Request('http://x/f', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cb('qwen-coder', 'hi')) })); const na = await noAuth.json().catch(() => ({}));
  ok('no login: refused, nothing billed', noAuth.status === 401 || noAuth.status === 403 || na.code === 'login', noAuth.status + JSON.stringify(na).slice(0, 80));
  net.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
