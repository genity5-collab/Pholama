// Bring your own AI: use your own account at ChatGPT (OpenAI), Gemini, Groq, OpenRouter, Mistral, DeepSeek, or any OpenAI-style address.
// Your key is stored ONLY on this PC (file mode 600) and is never sent to any page: the list shows just the last 4 characters.
// Every provider here speaks the same "OpenAI chat" format, so one streaming function serves them all. Zero dependencies.
const fs = require('fs'), os = require('os'), path = require('path');

const DIR = process.env.PHOLAMA_HOME || path.join(os.homedir(), '.pholama');
const FILE = path.join(DIR, 'providers.json');
const MAX_PROVIDERS = 12;

// Known providers: the address is fixed in code, so a key can only ever be sent to the company it belongs to.
const KNOWN = {
  openai:     { name: 'ChatGPT (OpenAI)',  base: 'https://api.openai.com/v1',                                 model: 'gpt-4o-mini',               tools: true,  note: 'platform.openai.com/api-keys' },
  gemini:     { name: 'Gemini (Google)',   base: 'https://generativelanguage.googleapis.com/v1beta/openai',   model: 'gemini-2.0-flash',          tools: true,  note: 'aistudio.google.com/apikey (has a free tier)' },
  groq:       { name: 'Groq',              base: 'https://api.groq.com/openai/v1',                            model: 'llama-3.3-70b-versatile',   tools: true,  note: 'console.groq.com/keys (has a free tier)' },
  openrouter: { name: 'OpenRouter',        base: 'https://openrouter.ai/api/v1',                              model: 'openai/gpt-4o-mini',        tools: true,  note: 'openrouter.ai/keys (many models, some free)' },
  mistral:    { name: 'Mistral',           base: 'https://api.mistral.ai/v1',                                 model: 'mistral-small-latest',      tools: true,  note: 'console.mistral.ai/api-keys' },
  deepseek:   { name: 'DeepSeek',          base: 'https://api.deepseek.com/v1',                               model: 'deepseek-chat',             tools: true,  note: 'platform.deepseek.com/api_keys' },
  together:   { name: 'Together AI',       base: 'https://api.together.xyz/v1',                               model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', tools: true, note: 'api.together.ai/settings/api-keys' },
  xai:        { name: 'Grok (xAI)',        base: 'https://api.x.ai/v1',                                       model: 'grok-2-latest',             tools: true,  note: 'console.x.ai' },
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

function add({ kind, key, model, base, name }, checkLink) {
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
  let r;
  try { r = await fetch(p.base + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key }, body: JSON.stringify(body) }); }
  catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Could not reach ' + p.name + '. Check the internet. ' + scrub(e.message, [p.key])); }
  if (!r.ok) {
    let m = ''; try { const j = await r.json(); m = (j.error && (j.error.message || j.error)) || j.message || ''; } catch {}
    const hint2 = r.status === 401 || r.status === 403 ? ' The key was refused: check it is correct and still active.' : r.status === 429 ? ' You hit your limit at ' + p.name + '. Wait a moment, or check your plan there.' : r.status === 404 ? ' The model name "' + p.model + '" was not found there.' : '';
    throw new Error(p.name + ' said no (HTTP ' + r.status + ').' + hint2 + (m ? ' ' + scrub(String(m), [p.key]).slice(0, 200) : ''));
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

module.exports = { KNOWN, list, known, get, add, remove, streamProvider, scrub, checkBase, hint, FILE };
