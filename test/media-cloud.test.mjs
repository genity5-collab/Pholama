// The cloud generators: money is charged first and given back on EVERY failure, exactly once; nothing foreign gets through; no provider detail leaks.
import fs from 'node:fs'; import { pathToFileURL } from 'node:url'; import path from 'node:path'; import os from 'node:os';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? '  -> ' + String(x).slice(0, 200) : '')); } };

// load the REAL function file, minus the Deno.serve tail, and expose start/poll
const srcFile = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'functions', 'pholamaMedia.ts');
let src = fs.readFileSync(srcFile, 'utf8'); const cut = src.indexOf('Deno.serve('); src = src.slice(0, cut) + '\nexport { start, poll, COST, PLAIN, makeToken, checkToken };\n';
const tmp = path.join(os.tmpdir(), 'pholamaMedia-test-' + process.pid + '.mts'); fs.writeFileSync(tmp, src);
const M = await import(pathToFileURL(tmp).href); fs.unlinkSync(tmp);

const USER = '11111111-2222-3333-4444-555555555555', SEAL = 'x'.repeat(40), JOB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const j = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function kit(routes, o = {}) {
  const k = { spent: [], refunded: [], calls: [], logs: [] };
  k.d = { fetchFn: async (url, init = {}) => { k.calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, auth: (init.headers || {}).Authorization }); const r = routes(String(url), init, k); return r instanceof Error ? Promise.reject(r) : r; },
    key: 'SECRET-FREEAI-KEY', seal: SEAL, user: USER, spend: async c => { k.spent.push(c); return o.noCredits ? false : true; }, refund: async c => { k.refunded.push(c); }, sleep: async () => {}, log: s => k.logs.push(s), now: () => 1_800_000_000_000 };
  return k;
}
const plainOnly = r => !/free\.ai|flux|kokoro|triposr|ace-step|qwen|HTTP|gpu_busy|SECRET/i.test(JSON.stringify(r.body));
const good = u => j(200, { job_id: JOB, url: u, share_url: 'https://free.ai/share/x/' });

// ---- prices ----
ok('prices are 45 / 45 / 90 / 25', M.COST.image === 45 && M.COST.music === 45 && M.COST['3d'] === 90 && M.COST.speech === 25);
for (const [kind, price] of [['image', 45], ['speech', 25]]) {
  const k = kit(() => good('https://api.free.ai/static/outputs/a.png')); const r = await M.start(kind, { prompt: 'a red cube' }, k.d);
  ok(kind + ': finishes with a link', r.status === 200 && r.body.url === 'https://api.free.ai/static/outputs/a.png', JSON.stringify(r));
  ok(kind + ': charged exactly ' + price + ' once and never refunded', k.spent.length === 1 && k.spent[0] === price && k.refunded.length === 0);
  ok(kind + ': the key goes to the generator and into no reply (the result link is allowed, the key and model names are not)', k.calls[0].auth === 'Bearer SECRET-FREEAI-KEY' && !/SECRET|flux|kokoro|qwen/i.test(JSON.stringify(r.body)));
}
{ const k = kit(() => good('https://api.free.ai/x.png')); await M.start('image', { prompt: 'p' }, k.d); ok('image asks the image generator with the right model', /\/v1\/image\/generate\//.test(k.calls[0].url) && k.calls[0].body.model === 'flux2-klein'); }
{ const k = kit(() => good('https://api.free.ai/x.wav')); await M.start('speech', { prompt: 'hello' }, k.d); ok('speech asks kokoro with the text', /\/v1\/tts\//.test(k.calls[0].url) && k.calls[0].body.model === 'kokoro' && k.calls[0].body.text === 'hello'); }

// ---- queued kinds ----
{ const k = kit(() => j(200, { queued: true, job_id: JOB, position_in_queue: 5 })); const r = await M.start('music', { prompt: 'calm piano', seconds: 12 }, k.d);
  ok('music queues: returns a job and a signed token', r.status === 202 && r.body.job === JOB && /^\d+\.[0-9a-f]{64}$/.test(r.body.token), JSON.stringify(r.body));
  ok('music: charged 45 once, not refunded while it waits', k.spent.join() === '45' && k.refunded.length === 0);
  ok('music uses ace-step and the length asked for', k.calls[0].body.model === 'ace-step' && k.calls[0].body.duration === 12);
  const ln = kit(() => j(200, { queued: true, job_id: JOB })); await M.start('music', { prompt: 'x', seconds: 9999 }, ln.d); ok('music length is capped at 30 seconds', ln.calls[0].body.duration === 30);
  const sh = kit(() => j(200, { queued: true, job_id: JOB })); await M.start('music', { prompt: 'x', seconds: 1 }, sh.d); ok('music length has a floor of 5 seconds', sh.calls[0].body.duration === 5); }
{ const k = kit(() => j(200, { queued: true, job_id: JOB })); const r = await M.start('3d', { image_url: 'https://api.free.ai/static/outputs/a.png' }, k.d);
  ok('3D queues and costs 90 once', r.status === 202 && k.spent.join() === '90' && k.calls[0].body.model === 'triposr'); }

// ---- refused before any credit is taken ----
for (const [what, kind, inp] of [['unknown kind', 'video', { prompt: 'x' }], ['prototype name', 'constructor', { prompt: 'x' }], ['toString', 'toString', { prompt: 'x' }], ['__proto__', '__proto__', { prompt: 'x' }], ['empty prompt', 'image', { prompt: '   ' }], ['no prompt at all', 'music', {}], ['3D without a picture', '3d', {}], ['3D with a foreign picture', '3d', { image_url: 'https://evil.example/a.png' }], ['3D with an http picture', '3d', { image_url: 'http://api.free.ai/a.png' }], ['3D with a look-alike host', '3d', { image_url: 'https://free.ai.evil.com/a.png' }], ['3D with a file path', '3d', { image_url: 'file:///etc/passwd' }]]) {
  const k = kit(() => good('https://api.free.ai/x.png')); const r = await M.start(kind, inp, k.d);
  ok('refused, nothing charged, nothing called: ' + what, r.status === 400 && k.spent.length === 0 && k.calls.length === 0 && plainOnly(r), JSON.stringify(r));
}
{ const k = kit(() => good('https://api.free.ai/x.png'), { noCredits: true }); const r = await M.start('image', { prompt: 'p' }, k.d);
  ok('out of credits: 429, the generator is never called, nothing to refund', r.status === 429 && k.calls.length === 0 && k.refunded.length === 0 && /credits/i.test(r.body.error)); }
{ const k = kit(() => good('https://api.free.ai/x.png')); k.d.spend = async () => { throw new Error('db down'); }; const r = await M.start('image', { prompt: 'p' }, k.d);
  ok('a failing credit check never reaches the generator', r.status === 429 && k.calls.length === 0); }

// ---- every failure path gives the credits back, once ----
const failures = {
  'busy all four tries': () => j(503, { error: { code: 'gpu_busy' } }),
  'rate limited': () => j(429, {}),
  'server error': () => j(500, { error: 'boom' }),
  'bad request': () => j(400, { error: 'nope' }),
  'network error': () => new Error('socket hang up'),
  'empty answer': () => j(200, {}),
  'a link on a foreign host': () => j(200, { url: 'https://evil.example/a.png' }),
  'a link that is not https': () => j(200, { url: 'http://api.free.ai/a.png' }),
  'a look-alike host': () => j(200, { url: 'https://api.free.ai.evil.com/a.png' }),
  'a paid (not self-hosted) source': () => j(200, { url: 'https://api.free.ai/a.png', free_ai_usage: { source: 'paid' } }),
};
for (const [what, route] of Object.entries(failures)) {
  const k = kit(route); const r = await M.start('image', { prompt: 'p' }, k.d);
  ok('refund once when: ' + what, k.spent.length === 1 && k.refunded.length === 1 && k.refunded[0] === 45 && r.status >= 500 && !r.body.url && plainOnly(r), JSON.stringify([k.spent, k.refunded, r]));
  ok('the failure says "not charged" in plain words: ' + what, /not charged/i.test(r.body.error || ''));
}
{ const k = kit(() => j(503, {})); await M.start('image', { prompt: 'p' }, k.d); ok('a busy generator is tried 4 times before giving up', k.calls.length === 4, k.calls.length); }
{ let n = 0; const k = kit(() => (++n < 3 ? j(503, {}) : good('https://api.free.ai/x.png'))); const r = await M.start('image', { prompt: 'p' }, k.d); ok('a busy generator that frees up is used (no refund, one charge)', r.status === 200 && k.spent.length === 1 && k.refunded.length === 0); }
{ const k = kit(() => j(500, {})); k.d.refund = async () => { throw new Error('refund failed'); }; const r = await M.start('image', { prompt: 'p' }, k.d); ok('a failing refund never breaks the answer', r.status === 502 && k.logs.some(l => /refund failed/.test(l))); }

// ---- polling ----
const tok = async (kind = 'music', user = USER, job = JOB, t = 1_800_000_000_000) => M.makeToken(SEAL, user, kind, job, t);
const poller = (job) => kit((url) => j(200, { job }));
{ const t = await tok(); const k = kit(() => j(200, { job: { status: 'queued', output_url: '', position_in_queue: 3, estimated_wait_seconds: 40 } }));
  const r = await M.poll('music', JOB, t, k.d); ok('queued: not done, shows the place in line', r.status === 200 && r.body.done === false && r.body.position === 3 && r.body.wait === 40 && k.refunded.length === 0, JSON.stringify(r)); }
{ const t = await tok(); const k = kit(() => j(200, { job: { status: 'running', output_url: '' } })); const r = await M.poll('music', JOB, t, k.d); ok('running: reported as working', r.body.done === false && r.body.status === 'working'); }
{ const t = await tok(); const k = kit(() => j(200, { job: { status: 'completed', output_url: 'https://api.free.ai/static/outputs/m.wav', output_expired: false } })); const r = await M.poll('music', JOB, t, k.d);
  ok('finished: gives the link, no refund, no second charge', r.body.done === true && r.body.url === 'https://api.free.ai/static/outputs/m.wav' && k.refunded.length === 0 && k.spent.length === 0); }
{ const t = await tok(); const k = kit(() => j(200, { job: { status: 'queued', output_url: 'https://evil.example/m.wav' } })); const r = await M.poll('music', JOB, t, k.d); ok('a foreign link in a job is never handed out', r.body.done === false && !r.body.url); }
{ const t = await tok(); const k = kit(() => j(200, { job: { status: 'completed', output_url: 'https://api.free.ai/m.wav', output_expired: true } })); const r = await M.poll('music', JOB, t, k.d); ok('an expired result is not handed out', !r.body.url); }
for (const st of ['failed', 'error', 'cancelled', 'canceled', 'expired', 'FAILED']) {
  const job = 'f' + Math.random().toString(16).slice(2).padEnd(30, '0').slice(0, 31) + '-aaaaaaaa'; const t = await tok('music', USER, job); const k = kit(() => j(200, { job: { status: st, error_message: 'GPU exploded, internal detail' } }));
  const r = await M.poll('music', job, t, k.d); ok('a ' + st + ' job: refunded 45, plain words, no provider detail', k.refunded.join() === '45' && r.body.failed === true && plainOnly(r) && !/exploded/.test(JSON.stringify(r)), JSON.stringify([k.refunded, r]));
}
{ const job = 'bbbbbbbb-1111-2222-3333-444444444444'; const t = await tok('3d', USER, job); const k = kit(() => j(200, { job: { status: 'failed' } }));
  await M.poll('3d', job, t, k.d); await M.poll('3d', job, t, k.d); await M.poll('3d', job, t, k.d);
  ok('polling a failed job again and again refunds 90 only ONCE', k.refunded.length === 1 && k.refunded[0] === 90, k.refunded.join()); }
{ const job = 'cccccccc-1111-2222-3333-444444444444'; const t = await tok('music', USER, job); const k = kit(() => j(200, {}));
  const a = await M.poll('music', job, t, k.d, true), b = await M.poll('music', job, t, k.d, true);
  ok('giving up (time limit) refunds once, even if asked twice', a.body.failed === true && a.body.code === 'timeout' && k.refunded.length === 1 && /not charged/i.test(a.body.error) && b.body.failed === true, k.refunded.join());
  ok('giving up makes no pretend-cancel call (the generator has none for an API key)', !k.calls.some(c => /cancel/.test(c.url))); }
{ const t = await tok(); const k = kit(() => { throw new Error('x'); }); k.d.fetchFn = async () => { throw new Error('network'); }; const r = await M.poll('music', JOB, t, k.d); ok('a network hiccup while waiting is not a failure and costs nothing', r.body.done === false && k.refunded.length === 0); }
{ const t = await tok(); const k = kit(() => j(502, {})); const r = await M.poll('music', JOB, t, k.d); ok('a server error while waiting is not a failure', r.body.done === false && k.refunded.length === 0); }

// ---- the token: no invented refunds ----
{ const k = kit(() => j(200, { job: { status: 'failed' } }));
  const wrongUser = await M.makeToken(SEAL, '99999999-2222-3333-4444-555555555555', 'music', JOB, 1_800_000_000_000);
  const wrongKind = await M.makeToken(SEAL, USER, 'image', JOB, 1_800_000_000_000);
  const wrongJob = await M.makeToken(SEAL, USER, 'music', 'dddddddd-1111-2222-3333-444444444444', 1_800_000_000_000);
  const old = await M.makeToken(SEAL, USER, 'music', JOB, 1_700_000_000_000);
  const other = await M.makeToken('y'.repeat(40), USER, 'music', JOB, 1_800_000_000_000);
  for (const [n, t] of [['someone else\'s token', wrongUser], ['a token for another kind', wrongKind], ['a token for another job', wrongJob], ['an old token', old], ['a token signed with another key', other], ['an empty token', ''], ['junk', 'abc'], ['a forged tail', '1800000900000.' + '0'.repeat(64)]]) {
    const r = await M.poll('music', JOB, t, k.d); ok('refused: ' + n, r.status === 400 && r.body.code === 'token');
  }
  ok('no forged poll ever refunded or even asked the generator', k.refunded.length === 0 && k.calls.length === 0); }
{ const t = await tok(); const k = kit(() => j(200, {})); for (const bad of ['../etc/passwd', 'x', '', 'a/b', 'a'.repeat(100), '<script>', "a'; drop table"]) { const r = await M.poll('music', bad, t, k.d); ok('bad job id refused: ' + bad.slice(0, 16), r.status === 400); } ok('no call made for a bad job id', k.calls.length === 0); }
{ const k = kit(() => j(200, {})); for (const kind of ['constructor', 'video', '', '__proto__']) { const r = await M.poll(kind, JOB, await tok(), k.d); ok('poll refuses kind "' + kind + '"', r.status === 400); } }

// ---- hostile prompts ----
{ const k = kit(() => good('https://api.free.ai/x.png')); await M.start('image', { prompt: 'x'.repeat(50000) }, k.d); ok('a huge prompt is cut to 1000 characters', k.calls[0].body.prompt.length === 1000); }
{ const k = kit(() => good('https://api.free.ai/x.png')); await M.start('image', { prompt: 'a\u0000b\u0007c' }, k.d); ok('control characters are removed from the prompt', !/[\u0000-\u0008]/.test(k.calls[0].body.prompt)); }
{ const k = kit(() => good('https://api.free.ai/x.png')); await M.start('image', { prompt: 'a cube', model: 'gpt-4', key: 'steal', url: 'https://evil.example', width: 99999 }, k.d);
  ok('the caller cannot pick the model, key, address or size', k.calls[0].body.model === 'flux2-klein' && !('key' in k.calls[0].body) && k.calls[0].url === 'https://api.free.ai/v1/image/generate/' && k.calls[0].body.width === 768); }
{ const k = kit(() => good('https://api.free.ai/x.png')); await M.start('image', { prompt: { toString() { return 'obj'; } } }, k.d); ok('an object as a prompt does not crash', true); }

console.log(`\n${fail ? 'FAILURES: ' + fail : 'ALL PASSED'} (${pass} checks)`); process.exit(fail ? 1 : 0);
