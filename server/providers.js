// Bring your own AI: use your own account at ChatGPT (OpenAI), Gemini, Groq, OpenRouter, Mistral, DeepSeek, or any OpenAI-style address.
// Your key is stored ONLY on this PC (file mode 600) and is never sent to any page: the list shows just the last 4 characters.
// Every provider here speaks the same "OpenAI chat" format, so one streaming function serves them all. Zero dependencies.
const fs = require('fs'), os = require('os'), path = require('path');

const DIR = process.env.PHOLAMA_HOME || path.join(os.homedir(), '.pholama');
const FILE = path.join(DIR, 'providers.json');
const MAX_PROVIDERS = 12;

// Known providers: the address is fixed in code, so a key can only ever be sent to the company it belongs to.
const KNOWN = {
  openai:     { name: 'ChatGPT (OpenAI)',  base: 'https://api.openai.com/v1',                                 model: 'gpt-5-mini',                tools: true,  note: 'platform.openai.com/api-keys' },
  gemini:     { name: 'Gemini (Google)',   base: 'https://generativelanguage.googleapis.com/v1beta/openai',   model: 'gemini-3.8-flash',          tools: true,  note: 'aistudio.google.com/apikey (has a free tier)' },
  groq:       { name: 'Groq',              base: 'https://api.groq.com/openai/v1',                            model: 'llama-3.3-70b-versatile',   tools: true,  note: 'console.groq.com/keys (has a free tier)' },
  openrouter: { name: 'OpenRouter',        base: 'https://openrouter.ai/api/v1',                              model: 'openai/gpt-5-mini',         tools: true,  note: 'openrouter.ai/keys (many models, some free)' },
  mistral:    { name: 'Mistral',           base: 'https://api.mistral.ai/v1',                                 model: 'mistral-small-latest',      tools: true,  note: 'console.mistral.ai/api-keys' },
  deepseek:   { name: 'DeepSeek',          base: 'https://api.deepseek.com/v1',                               model: 'deepseek-chat',             tools: true,  note: 'platform.deepseek.com/api_keys' },
  together:   { name: 'Together AI',       base: 'https://api.together.xyz/v1',                               model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', tools: true, note: 'api.together.ai/settings/api-keys' },
  xai:        { name: 'Grok (xAI)',        base: 'https://api.x.ai/v1',                                       model: 'grok-4',                   tools: true,  note: 'console.x.ai' },
  custom:     { name: 'Custom address',    base: '',                                                          model: '',                          tools: false, note: 'any OpenAI-style address, for example LM Studio or a company server' },
};

function load() { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(j.providers) ? j : { providers: [] }; } catch { return { providers: [] }; } }
function save(st) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 2), { mode: 0o600 }); try { fs.chmodSync(FILE, 0o600); } catch {} }

const hint = k => { const s = String(k || ''); return s.length > 8 ? '...' + s.slice(-4) : '...'; };
const cleanId = s => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const SAFE_MODEL = /^[A-Za-z0-9._:\/\-@+]{1,120}$/;

// Replace anything that looks like a key, so a key can never leak through an error message or a log line.
function scrub(text, keys) {
  let t = String(text == null ? '' : text);
  for (const k of keys || []) if (k && String(k).length >= 8) t = t.split(String(k)).join('[key hidden]');
  return t.replace(/\b(sk-[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{10,}|xai-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, '[key hidden]');
}

// A custom address must be https (or http only for this same PC), and must not point into a private network.
function checkBase(raw, checkLink) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, why: 'That address is not valid.' }; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol === 'http:' && !local) return { ok: false, why: 'Use an https:// address (http is only allowed for this same PC).' };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, why: 'The address must start with https://' };
  if (u.username || u.password) return { ok: false, why: 'Do not put a password in the address. Use the key box.' };
  if (!local && checkLink) { const c = checkLink(u.toString()); if (!c.ok) return { ok: false, why: 'That address points inside a private network, so it was blocked.' }; }
  return { ok: true, base: u.toString().replace(/\/+$/, '') };
}

// What the page may see: never the key.
const view = p => ({ id: p.id, kind: p.kind, name: p.name, base: p.base, model: p.model, hint: hint(p.key), added: p.added, lastUsed: p.lastUsed || null, tools: !!p.tools });
function list() { return load().providers.map(view); }
function known() { return Object.entries(KNOWN).map(([id, k]) => ({ id, name: k.name, model: k.model, note: k.note, custom: id === 'custom' })); }
function get(id) { return load().providers.find(p => p.id === String(id)) || null; }

function addNow({ kind, key, model, base, name }, checkLink) {
  const k = KNOWN[kind]; if (!k) throw new Error('Pick one of the listed companies, or Custom address.');
  key = String(key || '').trim(); if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new Error('That key does not look right. Paste it again without spaces.');
  model = String(model || k.model || '').trim(); if (!SAFE_MODEL.test(model)) throw new Error('Write the model name, for example ' + (k.model || 'gpt-4o-mini') + '.');
  let b = k.base;
  if (kind === 'custom') { const c = checkBase(base, checkLink); if (!c.ok) throw new Error(c.why); b = c.base; }
  const st = load(); if (st.providers.length >= MAX_PROVIDERS) throw new Error('You can save up to ' + MAX_PROVIDERS + ' keys. Remove one first.');
  const label = String(name || '').trim().slice(0, 40) || k.name;
  let id = cleanId(kind + '-' + model); let n = 2; while (st.providers.some(p => p.id === id)) id = cleanId(kind + '-' + model) + '-' + n++;
  const p = { id, kind, name: label, base: b, model, key, tools: !!k.tools, added: new Date().toISOString() };
  st.providers.push(p); save(st); return view(p);
}
function remove(id) { const st = load(), n = st.providers.length; st.providers = st.providers.filter(p => p.id !== String(id)); save(st); return st.providers.length < n; }
function touch(id) { try { const st = load(); const p = st.providers.find(x => x.id === id); if (p) { p.lastUsed = new Date().toISOString(); save(st); } } catch {} }

// One streamed turn from a provider. Calls onToken(text). Returns the whole text. Never throws a message that contains the key.
async function streamProvider(id, messages, options, onToken, signal, usage) {
  const p = get(id); if (!p) throw new Error('That key was removed. Pick another model.');
  const body = { model: p.model, messages, stream: true, stream_options: { include_usage: true }, temperature: (options || {}).temperature ?? 0.7 };
  if ((options || {}).num_predict) body.max_tokens = options.num_predict;
  const send = () => fetch(p.base + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key }, body: JSON.stringify(body) });
  let r;
  try { r = await send(); }
  catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Could not reach ' + p.name + '. Check the internet. ' + scrub(e.message, [p.key])); }
  // Companies disagree about which settings they accept (newer OpenAI models want max_completion_tokens and only the default temperature;
  // some servers reject stream_options). If one is refused, drop or rename just that setting and try again, up to 3 times.
  for (let tries = 0; !r.ok && r.status === 400 && tries < 3; tries++) {
    let m = ''; try { const j = await r.clone().json(); m = String((j.error && (j.error.message || j.error)) || j.message || ''); } catch {}
    const low = m.toLowerCase(); let changed = false;
    if (/max_tokens/.test(low) && /max_completion_tokens/.test(low) && body.max_tokens != null) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; changed = true; }
    else if (/temperature/.test(low) && 'temperature' in body) { delete body.temperature; changed = true; }
    else if (/stream_options/.test(low) && 'stream_options' in body) { delete body.stream_options; changed = true; }
    else if (/max_tokens/.test(low) && body.max_tokens != null) { delete body.max_tokens; changed = true; }
    if (!changed) break;
    try { r = await send(); } catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Could not reach ' + p.name + '. Check the internet. ' + scrub(e.message, [p.key])); }
  }
  // Temporary trouble at the company (overloaded, gateway timeout): wait a moment and try again, up to 3 more times.
  // Safe to repeat: nothing has been sent to the screen yet, so the answer cannot be doubled.
  for (let tries = 0; !r.ok && [500, 502, 503, 504].includes(r.status) && tries < 3; tries++) {
    const ra = Number(r.headers && r.headers.get && r.headers.get('retry-after'));
    const wait = Math.min(8000, ra > 0 ? ra * 1000 : 1200 * Math.pow(2, tries));   // 1.2s, 2.4s, 4.8s, or what the company asks for (max 8s)
    await new Promise((ok2, no) => { const t = setTimeout(ok2, wait); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); no(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); });
    try { r = await send(); } catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Could not reach ' + p.name + '. Check the internet. ' + scrub(e.message, [p.key])); }
  }
  if (!r.ok) {
    let m = ''; try { const j = await r.json(); m = (j.error && (j.error.message || j.error)) || j.message || ''; } catch {}
    throw new Error(explain(r.status, p.name, scrub(String(m), [p.key])));
  }
  touch(p.id);
  let buf = '', all = '';
  for await (const c of r.body) {
    buf += Buffer.from(c).toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l.startsWith('data:')) continue; const d = l.slice(5).trim(); if (d === '[DONE]') continue;
      try { const j = JSON.parse(d); if (j.usage && usage) { usage.in += j.usage.prompt_tokens || 0; usage.out += j.usage.completion_tokens || 0; usage.got = true; } const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (t) { all += t; onToken(t); } } catch {}
    }
  }
  return all;
}

// ---- find out which models a key can really use (model names change often, so never trust a fixed name) ----
const NOT_CHAT = /(embed|embedding|moderation|whisper|tts|transcribe|audio|realtime|live|image|imagen|dall|veo|lyria|vision-preview|rerank|guard|safety|aqa|robotics|computer-use|search-preview|omni-moderation|davinci|babbage|instruct$|-preview-\d{2}-\d{4})/i;
const cleanModelId = (id) => String(id || '').replace(/^models\//, '');   // Google lists "models/gemini-..."
// Best first. Bigger number = a better guess for a general, tool-capable chat model that is cheap enough for everyday use.
function rank(id) {
  const m = id.toLowerCase(); let r = 0;
  if (/(flash|mini|small|haiku|lite|turbo|instant|fast|nano)/.test(m)) r += 30;          // cheap and quick
  if (/(lite|nano)/.test(m)) r -= 10;                                                     // but not the weakest
  if (/(pro|ultra|opus|large|max|reasoner|o1|o3|o4)/.test(m)) r -= 15;                    // expensive or slow
  if (/(latest)$/.test(m)) r += 5;
  if (/(preview|exp|experimental|beta)/.test(m)) r -= 20;                                 // may vanish soon
  if (/(tts|image|embed|audio|live)/.test(m)) r -= 100;
  const v = /(\d+(?:\.\d+)?)/.exec(m); if (v) r += Math.min(20, +v[1] * 2);            // newer version first
  return r;
}
function chatModels(ids) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(ids) ? ids : []) { const id = cleanModelId(raw); if (!id || id.length > 120 || !SAFE_MODEL.test(id) || seen.has(id) || NOT_CHAT.test(id)) continue; seen.add(id); out.push(id); }
  return out.sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
}
// Pick what to use: the person's wish if that model exists for this key, else the provider's default if it exists, else the best one found.
function pickModel(available, wanted, fallback) {
  const list = chatModels(available); if (!list.length) return { model: wanted || fallback || '', list, changed: false, known: false };
  const has = (m) => m && list.includes(m); const any = (m) => m && list.find(x => x === m || x.endsWith('/' + m));
  if (has(wanted)) return { model: wanted, list, changed: false, known: true };
  const w = any(wanted); if (w) return { model: w, list, changed: w !== wanted, known: true };
  if (has(fallback)) return { model: fallback, list, changed: fallback !== wanted, known: true };
  return { model: list[0], list, changed: true, known: true };
}
// Turn a provider's refusal into a plain sentence the person can act on.
function explain(status, providerName, detail) {
  const d = String(detail || '').toLowerCase();
  if (status === 401 || status === 403) return 'The key was refused by ' + providerName + '. Check that you copied all of it, that it has not been deleted, and that it belongs to ' + providerName + '.';
  if (status === 404 || /model.*(not found|does not exist|no longer|deprecat|retired|not supported|unavailable)|no such model|invalid model/.test(d)) return 'That model name is not available any more at ' + providerName + '. Pick another one from the list.';
  if (status === 429 || /quota|rate.?limit|billing|insufficient|exceeded/.test(d)) return providerName + ' says this key has hit its limit or has no credit left. Check billing on their website, or wait a little.';
  if (status === 400) return providerName + ' did not accept the request' + (detail ? ': ' + String(detail).slice(0, 160) : '.');
  if (status >= 500) return providerName + ' is overloaded or down right now (HTTP ' + status + '), even after trying again a few times. Your key and model are fine. Wait a minute and try again, or pick another model with Change model.' + (detail ? ' They said: ' + String(detail).slice(0, 140) : '');
  return providerName + ' said no (HTTP ' + status + ').' + (detail ? ' ' + String(detail).slice(0, 160) : '');
}
// Ask the company which models this key can use. The key goes only to the company's fixed address.
async function fetchModels(base, key, timeoutMs = 10000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(base.replace(/\/+$/, '') + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: ac.signal });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) { const m = j && (j.error && (j.error.message || j.error) || j.message) || ''; return { ok: false, status: r.status, detail: scrub(String(m), [key]).slice(0, 200) }; }
    const arr = Array.isArray(j && j.data) ? j.data : Array.isArray(j && j.models) ? j.models : Array.isArray(j) ? j : [];
    return { ok: true, status: 200, ids: arr.map(x => (x && (x.id || x.name)) || (typeof x === 'string' ? x : '')).filter(Boolean) };
  } catch (e) { return { ok: false, status: 0, detail: e && e.name === 'AbortError' ? 'timed out' : scrub(String(e && e.message), [key]).slice(0, 160) }; }
  finally { clearTimeout(t); }
}

// Change which model a saved key uses, without typing the key again.
function setModel(id, model) {
  model = String(model || '').trim(); if (!SAFE_MODEL.test(model)) throw new Error('That model name does not look right.');
  const st = load(), p = st.providers.find(x => x.id === String(id)); if (!p) throw new Error('That key was removed.');
  p.model = model; save(st); return view(p);
}
// The models a saved key can really use right now, best first.
async function modelsFor(id, opts = {}) {
  const p = get(id); if (!p) throw new Error('That key was removed.');
  const got = await (opts.fetchModels || fetchModels)(p.base, p.key);
  if (!got.ok) throw new Error(explain(got.status, p.name, got.detail));
  const list = chatModels(got.ids); return { models: list, current: p.model, currentOk: list.includes(p.model) };
}
// The version the app uses: checks the key against the company first, so a wrong key or a dead model is caught now, in plain words.
async function add(input, checkLink, opts = {}) {
  const k = KNOWN[input && input.kind]; if (!k) throw new Error('Pick one of the listed companies, or Custom address.');
  const key = String(input.key || '').trim(); if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new Error('That key does not look right. Paste it again without spaces.');
  let base = k.base; if (input.kind === 'custom') { const c = checkBase(input.base, checkLink); if (!c.ok) throw new Error(c.why); base = c.base; }
  if (opts.skipCheck || process.env.PHOLAMA_TEST_NO_KEYCHECK === '1') return addNow(input, checkLink);   // the env switch exists for offline tests only
  const got = await (opts.fetchModels || fetchModels)(base, key);
  let model = String(input.model || '').trim(), note = '';
  if (got.ok) {
    const pick = pickModel(got.ids, model, k.model);
    if (pick.known && pick.changed && model) note = '"' + model + '" is not available for this key, so ' + pick.model + ' was picked instead.';
    // The company answered with models but none of them chat: the key works, the plan or project has nothing we can talk to.
    if (Array.isArray(got.ids) && got.ids.length && !pick.list.length) throw new Error('This key works, but ' + k.name + ' lists no chat model for it. Check your plan or project on their website.');
    model = pick.model;
    if (!model) throw new Error('This key works, but ' + k.name + ' lists no chat model for it. Check your plan on their website.');
  } else if (got.status === 401 || got.status === 403) {
    throw new Error(explain(got.status, k.name, got.detail));
  } else if (got.status === 0 && input.kind !== 'custom') {
    throw new Error('Could not reach ' + k.name + ' to check the key' + (got.detail ? ' (' + got.detail + ')' : '') + '. Check the internet and try again.');
  }   // any other answer (some servers have no model list): fall through and save, the first chat will tell us
  const v = addNow({ ...input, model, kind: input.kind }, checkLink); return note ? { ...v, note } : v;
}
module.exports = { setModel, modelsFor, addNow, chatModels, pickModel, explain, fetchModels, rank, KNOWN, list, known, get, add, remove, streamProvider, scrub, checkBase, hint, FILE };
