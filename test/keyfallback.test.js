// Agent Max tries up to three Groq keys in order. A key that is rate limited (429) or rejected (401/403) hands over to the next one.
// This runs the REAL aiJson() out of the built function against a fake Groq, so a typo in a key name is caught. (The OpenRouter steps that come first are tested in agentmax-chain.test.js; here no OpenRouter key is set.)
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), 'utf8');
const a = src.indexOf('const OR_MODELS'), b = src.indexOf('Deno.serve');
const code = src.slice(a, b).replace(/\(k\): k is string =>/g, '(k) =>').replace(/async function aiJson\(prompt: string\): Promise<any>/, 'async function aiJson(prompt)').replace(/\(j: any\)/g, '(j)').replace(/: Promise<any>/g, '').replace(/ as any/g, '').replace(/: any/g, '');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
const answer = { action: 'answer', answer: 'hello' };
async function run(env, plan) {   // plan: key -> HTTP status (200 = good answer)
  const seen = []; const Deno = { env: { get: k => env[k] } };
  const fetch = async (url, init) => { const key = String(init.headers.Authorization).replace('Bearer ', ''); seen.push(key); const st = plan[key] || 500;
    return { status: st, ok: st === 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }; };
  const AbortSignal = { timeout: () => undefined };
  const fn = new Function('Deno', 'fetch', 'AbortSignal', code.replace(/: Promise<any>/g, '').replace(/: any/g, '') + '\nreturn aiJson;')(Deno, fetch, AbortSignal);
  let res = null, err = null; try { res = await fn('hi'); } catch (e) { err = e.message; }
  return { res, err, seen: [...new Set(seen)] };
}
(async () => {
  const E = { GROQ_API_KEY: 'k1', GROQ_API_KEY_2: 'k2', GROQ_API_KEY_3: 'k3' };
  let r = await run(E, { k1: 200 });
  ok('the first key is used when it works', r.res && r.res.answer === 'hello' && r.seen.join() === 'k1', JSON.stringify(r));
  r = await run(E, { k1: 429, k2: 200 });
  ok('rate limited first key hands over to the second', r.res && r.seen.join() === 'k1,k2', JSON.stringify(r));
  r = await run(E, { k1: 429, k2: 429, k3: 200 });
  ok('when two keys are rate limited the THIRD key (GROQ_API_KEY_3) answers', r.res && r.res.answer === 'hello' && r.seen.join() === 'k1,k2,k3', JSON.stringify(r));
  r = await run(E, { k1: 401, k2: 403, k3: 200 });
  ok('rejected keys (401, 403) also hand over to the third', r.res && r.seen.join() === 'k1,k2,k3', JSON.stringify(r));
  r = await run(E, { k1: 429, k2: 429, k3: 429 });
  ok('all three limited: fails cleanly', !r.res && /AI failed/.test(r.err) && r.seen.join() === 'k1,k2,k3', JSON.stringify(r));
  r = await run({ GROQ_API_KEY: 'k1', GROQ_API_KEY_3: 'k3' }, { k1: 429, k3: 200 });
  ok('a missing middle key is skipped', r.res && r.seen.join() === 'k1,k3', JSON.stringify(r));
  r = await run({ GROQ_API_KEY_3: 'k3' }, { k3: 200 });
  ok('works with only the third key set', r.res && r.seen.join() === 'k3', JSON.stringify(r));
  r = await run({}, {});
  ok('no keys at all: a clear error', !r.res && /no key/.test(r.err), JSON.stringify(r));
  ok('the key is read from the environment only, never written in the file', !/gsk_[A-Za-z0-9]{10,}/.test(src) && !/sk-or-v1-[A-Za-z0-9]{10,}/.test(src));
  ok('the old THIRD_API_KEY name is gone from the function', !/THIRD_API_KEY/.test(src));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
