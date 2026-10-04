// Bring-your-own-key: storage, secrecy, address rules.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.PHOLAMA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-prov-'));
const P = require('../server/providers'), S = require('../server/sources');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const throws = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const KEY = 'sk-test-SECRET-1234567890abcdef';

const a = P.addNow({ kind: 'openai', key: KEY }, S.checkLink);
ok('add works and uses the default model', a.model === P.KNOWN.openai.model && a.base === 'https://api.openai.com/v1', JSON.stringify(a));
ok('the view never contains the key', !JSON.stringify(a).includes('SECRET') && !JSON.stringify(P.list()).includes('SECRET'), JSON.stringify(P.list()));
ok('only the last 4 characters are shown', a.hint === '...cdef', a.hint);
ok('key file is private (mode 600)', process.platform === 'win32' || (fs.statSync(P.FILE).mode & 0o777) === 0o600, (fs.statSync(P.FILE).mode & 0o777).toString(8));
ok('ids are unique for the same model', P.addNow({ kind: 'openai', key: KEY + 'x' }, S.checkLink).id !== a.id);
ok('groq / gemini / openrouter point at their own company', ['groq', 'gemini', 'openrouter', 'mistral', 'deepseek'].every(k => P.addNow({ kind: k, key: 'abcdefgh1234' }, S.checkLink).base.startsWith('https://')));
ok('unknown company is refused', /Pick one/.test(throws(() => P.addNow({ kind: 'evil', key: 'abcdefgh1234' }))));
ok('short key refused', /does not look right/.test(throws(() => P.addNow({ kind: 'openai', key: 'abc' }))));
ok('key with spaces refused', /does not look right/.test(throws(() => P.addNow({ kind: 'openai', key: 'abcd efgh 1234' }))));
ok('odd model name refused', /model name/.test(throws(() => P.addNow({ kind: 'openai', key: 'abcdefgh1234', model: 'x; echo hacked' }))));
const c = (base) => throws(() => P.addNow({ kind: 'custom', key: 'abcdefgh1234', model: 'm', base }, S.checkLink));
ok('custom: https public address ok', c('https://llm.example.com/v1') === null);
ok('custom: http on this same PC ok (LM Studio)', c('http://localhost:1234/v1') === null);
ok('custom: http on the internet refused', /https/.test(c('http://llm.example.com/v1')), c('http://llm.example.com/v1'));
ok('custom: home network refused', /private network/.test(c('https://192.168.1.10/v1')), c('https://192.168.1.10/v1'));
ok('custom: cloud metadata address refused', /private network/.test(c('https://169.254.169.254/latest')), c('https://169.254.169.254/latest'));
ok('custom: password in the address refused', /password/.test(c('https://user:pw@llm.example.com/v1')), c('https://user:pw@llm.example.com/v1'));
ok('custom: not a URL refused', /not valid/.test(c('hello')));
ok('custom: file:// refused', c('file:///etc/passwd') !== null);
ok('scrub removes the exact key', !P.scrub('bad key ' + KEY + ' here', [KEY]).includes('SECRET'));
ok('scrub removes OpenAI/Google/Groq style keys', !/sk-abc|AIzaSy|gsk_abc/.test(P.scrub('sk-abcdefghijklmnop AIzaSyA1234567890123456789012 gsk_abcdefghij12', [])));
ok('scrub removes a Bearer header', !/eyJhbGci/.test(P.scrub('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc', [])));
ok('scrub keeps normal text', P.scrub('hello world', [KEY]) === 'hello world');
const before = P.list().length; ok('remove works', P.remove(a.id) === true && P.list().length === before - 1 && P.remove(a.id) === false);
try { for (let i = 0; i < 20; i++) P.addNow({ kind: 'openai', key: 'abcdefgh' + i, model: 'm' + i }, S.checkLink); } catch {}
ok('a limit on saved keys', P.list().length <= 12, P.list().length);
ok('known() has no secrets and includes custom', P.known().some(k => k.id === 'custom') && !JSON.stringify(P.known()).includes('"key"'));

// ---- finding out which models a key can really use ----
ok('default Gemini is not the retired 2.0 model', !/gemini-2\.0/.test(P.KNOWN.gemini.model), P.KNOWN.gemini.model);
ok('chatModels drops embeddings, audio, images, moderation', JSON.stringify(P.chatModels(['gpt-5-mini', 'text-embedding-3-large', 'whisper-1', 'gpt-image-1', 'omni-moderation-latest', 'tts-1', 'gpt-realtime'])) === '["gpt-5-mini"]', JSON.stringify(P.chatModels(['gpt-5-mini', 'text-embedding-3-large', 'whisper-1', 'gpt-image-1', 'omni-moderation-latest', 'tts-1', 'gpt-realtime'])));
ok('Google "models/" prefix is removed', P.chatModels(['models/gemini-3.8-flash'])[0] === 'gemini-3.8-flash');
ok('duplicates and junk removed', P.chatModels(['a-mini', 'a-mini', '', null, 'x; echo hacked', 'b'.repeat(200)]).length === 1);
ok('junk input never throws', P.chatModels(null).length === 0 && P.chatModels('x').length === 0 && P.chatModels({}).length === 0);
ok('cheap fast models rank above expensive ones', P.rank('gemini-3.8-flash') > P.rank('gemini-3.1-pro'));
ok('stable ranks above preview', P.rank('gpt-5-mini') > P.rank('gpt-5-mini-preview'));
let k = P.pickModel(['gemini-3.8-flash', 'gemini-3.5-flash-lite'], 'gemini-2.0-flash', 'gemini-3.8-flash'); ok('a dead name is swapped for the default that exists', k.model === 'gemini-3.8-flash' && k.changed === true);
k = P.pickModel(['gemini-3.8-flash', 'gemini-3.5-flash-lite'], 'gemini-3.5-flash-lite', 'gemini-3.8-flash'); ok('a working wish is kept', k.model === 'gemini-3.5-flash-lite' && k.changed === false);
k = P.pickModel(['openai/gpt-5-mini', 'meta/llama'], 'gpt-5-mini', 'x'); ok('a name without the prefix still matches (OpenRouter style)', k.model === 'openai/gpt-5-mini');
k = P.pickModel(['foo-mini', 'bar-pro'], 'nope', 'alsonope'); ok('with no match the best available is chosen', k.model === 'foo-mini');
k = P.pickModel([], 'mine', 'theirs'); ok('an empty list keeps the wish and says unknown', k.model === 'mine' && k.known === false);
ok('explain: refused key', /key was refused/.test(P.explain(401, 'ChatGPT', '')) && /key was refused/.test(P.explain(403, 'ChatGPT', '')));
ok('explain: retired model (404)', /not available any more/.test(P.explain(404, 'Gemini', 'models/x is not found')));
ok('explain: retired model (400 with words)', /not available any more/.test(P.explain(400, 'Gemini', 'The model `x` does not exist')));
ok('explain: no credit', /limit or has no credit/.test(P.explain(429, 'ChatGPT', 'You exceeded your current quota')));
ok('explain: provider down says the key is fine and what to do', /overloaded or down/.test(P.explain(503, 'ChatGPT', '')) && /key and model are fine/.test(P.explain(503, 'ChatGPT', '')) && /They said: busy/.test(P.explain(503, 'ChatGPT', 'busy')));
ok('explain never returns empty', ['', 'x'].every(d => [0, 400, 401, 404, 418, 429, 500].every(c => P.explain(c, 'Z', d).length > 10)));

(async () => {
  const http = require('http'); let seen = [], mode = 'ok';
  const srv = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    seen.push({ url: q.url, auth: q.headers.authorization, body: b }); r.setHeader('Content-Type', 'application/json');
    if (mode === 'badkey') { r.statusCode = 401; return r.end(JSON.stringify({ error: { message: 'Incorrect API key provided: SECRETKEY12345' } })); }
    if (q.url.endsWith('/models')) return r.end(JSON.stringify(mode === 'google' ? { models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-embedding-2' }] } : { data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3-small' }, { id: 'gpt-5' }] }));
    if (q.url.endsWith('/chat/completions')) {
      const j = JSON.parse(b);
      if (mode === 'needs_completion_tokens' && j.max_tokens != null) { r.statusCode = 400; return r.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } })); }
      if (mode === 'no_temperature' && j.temperature != null) { r.statusCode = 400; return r.end(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model." } })); }
      if (mode === 'retired') { r.statusCode = 404; return r.end(JSON.stringify({ error: { message: 'models/gemini-2.0-flash is no longer available' } })); }
      r.setHeader('Content-Type', 'text/event-stream'); r.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'hello' } }] }) + '\n\n'); r.write('data: [DONE]\n\n'); return r.end();
    }
    r.statusCode = 404; r.end('{}'); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + srv.address().port;
  mode = 'ok'; let g = await P.fetchModels(base, 'KEY1234567'); ok('fetchModels lists ids and sends the key as Bearer', g.ok && g.ids.includes('gpt-5') && seen.pop().auth === 'Bearer KEY1234567', JSON.stringify(g));
  mode = 'google'; g = await P.fetchModels(base, 'KEY1234567'); ok('fetchModels understands the Google list shape', g.ok && g.ids.includes('models/gemini-3.8-flash'), JSON.stringify(g));
  mode = 'badkey'; g = await P.fetchModels(base, 'SECRETKEY12345'); ok('a refused key is reported and never echoed', !g.ok && g.status === 401 && !JSON.stringify(g).includes('SECRETKEY12345'), JSON.stringify(g));
  g = await P.fetchModels('http://127.0.0.1:1', 'KEY1234567', 2000); ok('an unreachable server is a clean failure', !g.ok && g.status === 0);
  fs.writeFileSync(P.FILE, JSON.stringify({ providers: [] }));   // the limit test above filled every slot: start clean
  const fakeOk = async () => ({ ok: true, status: 200, ids: ['gemini-3.8-flash', 'gemini-embedding-2', 'gemini-3.5-flash-lite'] });
  let v = await P.add({ kind: 'gemini', key: 'abcdefgh1234', model: 'gemini-2.0-flash' }, S.checkLink, { fetchModels: fakeOk }); ok('add swaps a dead model for a live one and says so', v.model === 'gemini-3.8-flash' && /not available for this key/.test(v.note || ''), JSON.stringify(v));
  v = await P.add({ kind: 'gemini', key: 'abcdefgh5678' }, S.checkLink, { fetchModels: fakeOk }); ok('add with no model picks a live one', v.model === 'gemini-3.8-flash' && !v.note, JSON.stringify(v));
  const before = P.list().length;
  let msg = ''; try { await P.add({ kind: 'openai', key: 'abcdefgh9999' }, S.checkLink, { fetchModels: async () => ({ ok: false, status: 401, detail: 'bad' }) }); } catch (e) { msg = e.message; }
  ok('a refused key is NOT saved and the reason is plain', /key was refused/.test(msg) && P.list().length === before, msg);
  msg = ''; try { await P.add({ kind: 'openai', key: 'abcdefgh8888' }, S.checkLink, { fetchModels: async () => ({ ok: false, status: 0, detail: 'timed out' }) }); } catch (e) { msg = e.message; }
  ok('no internet is not saved either, with a clear reason', /Could not reach/.test(msg) && P.list().length === before, msg);
  v = await P.add({ kind: 'openai', key: 'abcdefgh7777' }, S.checkLink, { fetchModels: async () => ({ ok: false, status: 404, detail: '' }) }); ok('a server with no model list still saves (first chat will tell)', !!v.id && v.model === P.KNOWN.openai.model, JSON.stringify(v));
  msg = ''; try { await P.add({ kind: 'openai', key: 'abcdefgh6666' }, S.checkLink, { fetchModels: async () => ({ ok: true, status: 200, ids: ['text-embedding-3-small', 'whisper-1'] }) }); } catch (e) { msg = e.message; }
  ok('a key with no chat model is explained', /lists no chat model/.test(msg), msg);
  const st = JSON.parse(fs.readFileSync(P.FILE, 'utf8')); st.providers.push({ id: 'fake', kind: 'openai', name: 'Fake', base, model: 'gpt-5-mini', key: 'KEY1234567', tools: true }); fs.writeFileSync(P.FILE, JSON.stringify(st));
  const run = async (m, opt) => { mode = m; seen = []; let out = ''; await P.streamProvider('fake', [{ role: 'user', content: 'hi' }], opt || { num_predict: 50 }, t => { out += t; }, undefined, { in: 0, out: 0 }); return out; };
  ok('normal chat works', (await run('ok')) === 'hello');
  ok('max_tokens refused -> retried with max_completion_tokens', (await run('needs_completion_tokens')) === 'hello' && JSON.parse(seen[seen.length - 1].body).max_completion_tokens === 50 && JSON.parse(seen[seen.length - 1].body).max_tokens === undefined, JSON.stringify(seen.map(x => x.body)));
  ok('temperature refused -> retried without it', (await run('no_temperature')) === 'hello' && JSON.parse(seen[seen.length - 1].body).temperature === undefined);
  msg = ''; try { await run('retired'); } catch (e) { msg = e.message; }
  ok('a retired model gives a plain sentence, not raw JSON', /not available any more/.test(msg) && !/\{/.test(msg), msg);
  msg = ''; try { await run('badkey'); } catch (e) { msg = e.message; }
  ok('a refused key in chat is plain and never shows the key', /key was refused/.test(msg) && !msg.includes('SECRETKEY12345'), msg);
  // temporary 503s: retried, then succeeds; permanent 503: gives up after 4 tries with a plain message
  { let hits = 0; const flaky = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { hits++; if (hits <= 2) { r.statusCode = 503; r.setHeader('Content-Type', 'application/json'); r.setHeader('Retry-After', '0'); return r.end(JSON.stringify({ error: { message: 'The model is overloaded. Please try again later.' } })); } r.setHeader('Content-Type', 'text/event-stream'); r.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'finally' } }] }) + '\n\ndata: [DONE]\n\n'); r.end(); }); }).listen(0, '127.0.0.1');
    await new Promise(r => setTimeout(r, 100)); const st2 = JSON.parse(fs.readFileSync(P.FILE, 'utf8')); st2.providers.push({ id: 'flaky', kind: 'openai', name: 'Flaky', base: 'http://127.0.0.1:' + flaky.address().port, model: 'm', key: 'KEY1234567', tools: true }); fs.writeFileSync(P.FILE, JSON.stringify(st2));
    let out = ''; await P.streamProvider('flaky', [{ role: 'user', content: 'hi' }], {}, t => { out += t; }, undefined, { in: 0, out: 0 });
    ok('a temporary 503 is retried and the answer arrives once', out === 'finally' && hits === 3, out + ' hits=' + hits);
    hits = -100; msg = ''; const t0 = Date.now(); try { await P.streamProvider('flaky', [{ role: 'user', content: 'hi' }], {}, () => {}, undefined, { in: 0, out: 0 }); } catch (e) { msg = e.message; }
    ok('a 503 that never ends stops after 4 tries with a plain message', /overloaded or down/.test(msg) && hits === -96, msg + ' hits=' + hits);
    ok('that message contains the company\'s own reason', /overloaded\. Please try again/.test(msg), msg);
    const ac = new AbortController(); hits = -100; setTimeout(() => ac.abort(), 150); msg = ''; try { await P.streamProvider('flaky', [{ role: 'user', content: 'hi' }], {}, () => {}, ac.signal, { in: 0, out: 0 }); } catch (e) { msg = e.name; }
    ok('pressing Stop during the wait cancels at once', msg === 'AbortError' && Date.now() - t0 < 20000, msg);
    flaky.close(); }
  mode = 'ok'; const ml = await P.modelsFor('fake'); ok('modelsFor returns only chat models and says if the current one is fine', JSON.stringify(ml.models) === '["gpt-5-mini","gpt-5"]' && ml.currentOk === true, JSON.stringify(ml));
  ok('setModel changes the model and keeps the key hidden', P.setModel('fake', 'gpt-5').model === 'gpt-5' && !JSON.stringify(P.list()).includes('KEY1234567'));
  ok('setModel refuses junk', /does not look right/.test(throws(() => P.setModel('fake', 'x; echo hacked'))) && /removed/.test(throws(() => P.setModel('nope', 'gpt-5'))));
  srv.close();
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
