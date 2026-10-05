// Agent Max fallback order: OpenRouter main -> OpenRouter backup -> Groq keys 1,2,3. Runs the REAL aiJson from the built function against a fake network.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'pholamaCloud.ts'), 'utf8');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
// cut out the chain (constants + aiJson) and compile it with types stripped
const a = src.indexOf('const OR_MODELS'), b = src.indexOf('Deno.serve(');
ok('the chain is in the built function', a > 0 && b > a);
const body = require('./_stripTs')(src.slice(a, b));
function make(env, script) {
  const calls = []; const Deno = { env: { get: k => env[k] } };
  const fetch = async (url, o) => { const h = o.headers.Authorization || ''; const model = JSON.parse(o.body).model; const host = url.includes('openrouter') ? 'OR' : 'GROQ'; const key = h.replace('Bearer ', ''); calls.push(host + ':' + model + ':' + key); const r = script(host, model, key); return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => ({ choices: [{ message: { content: r.content || '' } }] }) }; };
  const AbortSignal = { timeout: () => undefined };
  const f = new Function('Deno', 'fetch', 'AbortSignal', body + '\nreturn aiJson;')(Deno, fetch, AbortSignal);
  return { f, calls };
}
const CONTENT = (o) => o;
const good = { status: 200, content: '{"action":"answer","answer":"hello"}' };
const ENV = { OPENROUTER_API_KEY: 'or1', GROQ_API_KEY: 'g1', GROQ_API_KEY_2: 'g2', GROQ_API_KEY_3: 'g3' };
(async () => {
  let t = make(ENV, () => good); let o = await t.f('hi');
  ok('normal: the main OpenRouter model answers and nothing else is called', o.answer === 'hello' && t.calls.length === 1 && t.calls[0] === 'OR:dots-studio/dots-3-note-preview:free:or1', t.calls);
  t = make(ENV, (h, m) => m.startsWith('dots') ? { status: 503 } : good); o = await t.f('hi');
  ok('main down: Nemotron (OpenRouter) is next', o.answer === 'hello' && t.calls.join() === 'OR:dots-studio/dots-3-note-preview:free:or1,OR:nvidia/nemotron-3.5-lightning:free:or1', t.calls);
  t = make(ENV, (h, m) => /dots|nemotron/.test(m) ? { status: 503 } : good); o = await t.f('hi');
  ok('main and Nemotron both down: gpt-oss-20b is third, before any Groq', o.answer === 'hello' && t.calls.length === 3 && /gpt-oss-20b/.test(t.calls[2]) && t.calls.every(c => c.startsWith('OR')), t.calls);
  t = make(ENV, (h, m) => m.startsWith('dots') ? { status: 200, content: 'sorry no json' } : good); o = await t.f('hi');
  ok('main gives an unusable answer: Nemotron is used', o.answer === 'hello' && t.calls.length === 2 && /nemotron/.test(t.calls[1]), t.calls);
  t = make(ENV, (h, m) => /nemotron/.test(m) ? { status: 200, content: 'Here is a thinking process:\n1. The user wants {"x": 1} maybe\n2. Draft: {"action":"tool","tool":"clock"} no wait\n\n{"action":"answer","answer":"final one"}' } : { status: 503 }); o = await t.f('hi');
  ok('Nemotron writes its thinking first: the LAST valid answer object is used', o && o.answer === 'final one', o);
  t = make(ENV, (h) => h === 'OR' ? { status: 402 } : good); o = await t.f('hi');
  ok('both OpenRouter models out of credit (402): falls to Groq key 1', o.answer === 'hello' && t.calls.filter(c => c.startsWith('GROQ')).length === 1 && t.calls[t.calls.length - 1].endsWith(':g1'), t.calls);
  t = make(ENV, (h) => h === 'OR' ? { status: 401 } : good); o = await t.f('hi');
  ok('a rejected OpenRouter key stops OpenRouter at once and goes to Groq', o.answer === 'hello' && t.calls.filter(c => c.startsWith('OR')).length === 1 && t.calls[1].startsWith('GROQ'), t.calls);
  t = make(ENV, (h, m, k) => h === 'OR' ? { status: 500 } : (k === 'g1' || k === 'g2') ? { status: 429 } : good); o = await t.f('hi');
  ok('Groq keys 1 and 2 rate limited: key 3 (GROQ_API_KEY_3) answers', o.answer === 'hello' && t.calls[t.calls.length - 1].endsWith(':g3'), t.calls);
  ok('…and each limited key is tried once, not retried on every model', t.calls.filter(c => c.endsWith(':g1')).length === 1 && t.calls.filter(c => c.endsWith(':g2')).length === 1, t.calls);
  t = make(ENV, () => ({ status: 500 })); let err = ''; try { await t.f('hi'); } catch (e) { err = String(e.message); }
  ok('everything down: a clear error, no hang', /AI failed/.test(err), err);
  t = make({ GROQ_API_KEY: 'g1' }, () => good); o = await t.f('hi');
  ok('no OpenRouter key set: goes straight to Groq', o.answer === 'hello' && t.calls.length === 1 && t.calls[0].startsWith('GROQ'), t.calls);
  t = make({}, () => good); err = ''; try { await t.f('hi'); } catch (e) { err = String(e.message); }
  ok('no keys at all: says so', /no key/.test(err), err);
  t = make(ENV, (h, m) => m.startsWith('dots') ? { status: 200, content: '<think>hmm</think>{"action":"tool","tool":"clock","input":{}}' } : good); o = await t.f('hi');
  ok('a reasoning block before the JSON is ignored', o.action === 'tool' && o.tool === 'clock' && t.calls.length === 1, o);
  const leak = /return out\(\{ error: 'Agent Max did not answer[^\n]*\n/.exec(src);
  ok('the error sent to the browser has no model names, no reasons and no detail field', leak && !/detail|String\(e\)|dots|nemotron|gpt-oss|groq|openrouter/i.test(leak[0]), leak && leak[0]);
  ok('the final error thrown from the chain carries no model name', /throw new Error\('AI failed'\)/.test(src));
  ok('the real reason is kept in the server log', /console\.log\('AgentMax error:'/.test(src) && /console\.log\('AgentMax: every model failed/.test(src));
  ok('the old THIRD_API_KEY name and the duplicate Groq model are gone', !/THIRD_API_KEY/.test(src) && !/'qwen\/qwen3\.8-27b', 'qwen\/qwen3\.8-27b'/.test(src));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
