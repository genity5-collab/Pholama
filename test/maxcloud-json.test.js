// "Agent Max did not answer" was mostly a PARSING bug: the small model writes almost-JSON, e.g. {"action":"answer","answer":"Here\'s how..."}.
// \' is not legal JSON, so the whole good answer was thrown away and the person was told it failed. This runs the real compiled function
// with a fake model that replays the messy replies seen in production and checks the person still gets the answer, once, charged once.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcj-')), out = path.join(dir, 'cloud.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  const W = require('./helpers/weeklyfake')({ used: 0 }); let script = [], calls = 0;
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json');
    if (q.url.startsWith('/auth/v1/user')) return s.end(JSON.stringify({ id: 'u1', user_metadata: { name: 'Sam' } }));
    if (W.handle(decodeURIComponent(q.url), b, s)) return;
    if (q.url.includes('/v1/chat')) { calls++; const next = script.shift(); if (next === 'HTTP500') { s.statusCode = 500; return s.end('{}'); } return s.end(JSON.stringify({ choices: [{ message: { content: next === undefined ? '{"action":"answer","answer":"default"}' : next } }], free_ai_usage: { source: 'self_hosted' } })); }
    s.statusCode = 404; s.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ PHOLAMA_SUPABASE_SERVICE_KEY: 'svc', FREE_AI_API_KEY: 'fk' }[k]) } };
  const realFetch = global.fetch; global.fetch = (u, o) => { u = String(u); if (/nyswblzzvqzheaxvrqtq\.supabase\.co|api\.free\.ai|github\.io/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return realFetch(u, o); };
  await import('file://' + out);
  const ask = async (replies, q = 'how do I download a model?') => { script = replies.slice(); calls = 0; W.spends.length = 0; W.refunds.length = 0;
    const r = await handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: q }], effort: 'normal' }) })); return { status: r.status, j: await r.json(), calls }; };

  let r = await ask(['{"action":"answer","answer":"Open Models, then press Download. It\\\'s that simple."}']);
  ok('an escaped apostrophe (\\\') no longer loses the answer', r.status === 200 && r.j.reply === "Open Models, then press Download. It's that simple.", JSON.stringify(r.j).slice(0, 200));
  r = await ask(['{\n  "action": "answer",\n  "answer": "Line one\nLine two"\n}']);
  ok('a raw line break inside the answer is kept', r.status === 200 && r.j.reply === 'Line one\nLine two', JSON.stringify(r.j).slice(0, 200));
  r = await ask(['{"action":"answer","answer":"Fine.",}']);
  ok('a trailing comma is forgiven', r.status === 200 && r.j.reply === 'Fine.', JSON.stringify(r.j).slice(0, 200));
  r = await ask(['{"action":"answer","answer":"He said \\"hi\\" and C:\\\\temp"}']);
  ok('valid JSON with real escapes is untouched', r.status === 200 && r.j.reply === 'He said "hi" and C:\\temp', JSON.stringify(r.j).slice(0, 200));
  r = await ask(['Sure! Open Models and press Download.']);
  ok('a plain-words answer still works', r.status === 200 && /press Download/.test(r.j.reply), JSON.stringify(r.j).slice(0, 200));
  r = await ask(['```json\n{"action":"answer","answer":"It\\\'s in a code fence."}\n```']);
  ok('almost-JSON inside a code fence works', r.status === 200 && r.j.reply === "It's in a code fence.", JSON.stringify(r.j).slice(0, 200));
  // the full tool round trip with a messy second round (the real production failure)
  r = await ask(['{"action":"tool","tool":"site_help","thinking":"look it up","input":{"question":"download a model"}}', '{"action":"answer","answer":"Go to Models and tap Download. You can\\\'t download on the website."}']);
  ok('tool round then an almost-JSON answer succeeds', r.status === 200 && r.j.tools.length === 1 && r.j.tools[0].name === 'site_help' && /can't download/.test(r.j.reply), JSON.stringify(r.j).slice(0, 240));
  ok('that cost exactly one message and two model calls', W.spends.length === 1 && r.calls === 2 && W.refunds.length === 0, W.spends.length + '/' + r.calls + '/' + W.refunds.length);
  // when it really is unusable, nobody pays
  r = await ask(['{"action":"tool"']);
  ok('a reply that is cut off in the middle still ends cleanly (answer or refund, never a charge for nothing)', (r.status === 200 && r.j.reply) || (r.status === 500 && W.refunds.length === 1), r.status + ' ' + JSON.stringify(r.j).slice(0, 160));
  // a hiccup on one model call must not sink the message
  r = await ask(['HTTP500', 'Open Models and press Download.']);
  ok('one failed model call is retried in plain words and still answers', r.status === 200 && /press Download/.test(r.j.reply) && W.spends.length === 1 && W.refunds.length === 0, r.status + ' ' + JSON.stringify(r.j).slice(0, 160));
  r = await ask(['{"action":"tool","tool":"site_help","input":{"question":"download"}}', 'HTTP500', 'You press Download in Models.']);
  ok('a failure AFTER a tool ran still answers (the tool result is not wasted)', r.status === 200 && r.j.tools.length === 1 && /Download/.test(r.j.reply), r.status + ' ' + JSON.stringify(r.j).slice(0, 200));
  r = await ask(['HTTP500', 'HTTP500', 'HTTP500', 'HTTP500']);
  ok('when every call fails the person is refunded and told plainly', r.status === 500 && W.refunds.length === 1 && /did not answer/.test(r.j.error) && !/500|HTTP/.test(r.j.error), r.status + ' ' + JSON.stringify(r.j).slice(0, 160));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); net.close(); process.exit(bad ? 1 : 0);
})();
