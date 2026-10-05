'use strict';
// Custom tools you make yourself ("create plugin"). A custom tool is ONE web request the AI may run: Supabase, Discord, Notion, your own API, anything with an HTTP address.
// Safety, in plain words:
//  * Your secrets (API keys) are saved on THIS PC only and are added to the request here. The AI never sees them, and they are hidden from any text that comes back.
//  * A tool may only call the public internet (https). It can never reach your own PC or home network.
//  * Reading (GET) runs by itself. Anything that changes data (POST, PUT, PATCH, DELETE) waits for your OK every time.
const fs = require('fs'), os = require('os'), path = require('path'), dns = require('dns').promises, net = require('net');
const DIR = path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.pholama', 'usertools');
const SLUG = /^[a-z][a-z0-9_]{2,31}$/;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
const file = slug => path.join(DIR, slug + '.json');
const TOOL_PREFIX = 'x_';   // custom tools are named x_<name>, so they can never replace a built-in tool

// Is this address one we must never call? (this PC, home network, cloud metadata)
function privateIp(ip) {
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:') && privateIp(l.slice(7)); }
  const p = ip.split('.').map(Number); if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
async function checkUrl(u) {
  let url; try { url = new URL(u); } catch { throw new Error('That is not a web address.'); }
  if (url.protocol !== 'https:') throw new Error('Only https:// addresses are allowed.');
  if (url.username || url.password) throw new Error('Put keys in Secrets, not in the address.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { if (privateIp(host)) throw new Error('That address is on your own network. Blocked.'); return url; }
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new Error('That address is on your own network. Blocked.');
  let addrs; try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error('Could not find ' + host); }
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('That address points to your own network. Blocked.');
  return url;
}
// {{name}} = a value the AI fills in. {{secret.NAME}} = one of your saved secrets (the AI never sees it).
function fill(text, args, secrets, used) {
  return String(text == null ? '' : text).replace(/\{\{\s*(secret\.)?([A-Za-z0-9_]+)\s*\}\}/g, (m, sec, name) => {
    if (sec) { if (!(name in secrets)) throw new Error('Missing secret ' + name + '. Add it in Plugins > My tools.'); used.add(secrets[name]); return secrets[name]; }
    return encodeURIComponentSafe(args && args[name] != null ? args[name] : '');
  });
}
const encodeURIComponentSafe = v => String(v).replace(/[\r\n]/g, ' ');
// Values the AI fills go in the query/body text. In the ADDRESS they are URL-encoded; in headers newlines are removed.
function fillUrl(text, args, secrets, used) {
  return String(text).replace(/\{\{\s*(secret\.)?([A-Za-z0-9_]+)\s*\}\}/g, (m, sec, name) => {
    if (sec) { if (!(name in secrets)) throw new Error('Missing secret ' + name + '. Add it in Plugins > My tools.'); used.add(secrets[name]); return secrets[name]; }
    return encodeURIComponent(args && args[name] != null ? args[name] : '');
  });
}

function problem(t) {
  if (!t || typeof t !== 'object') return 'not a tool';
  if (!SLUG.test(slugify(t.name))) return 'the name needs 3 to 32 letters, numbers or _';
  if (!/^https:\/\//i.test(String(t.url || ''))) return 'the address must start with https://';
  if (!METHODS.includes(String(t.method || 'GET').toUpperCase())) return 'the method must be GET, POST, PUT, PATCH or DELETE';
  if (String(t.what || '').trim().length < 8) return 'say in one sentence what it does (so the AI knows when to use it)';
  if (/\{\{\s*secret\./.test(String(t.url))) { /* secrets in the address are allowed but discouraged */ }
  return null;
}
// A thumbnail is a small picture shown on the tool card. Only a safe raster image is accepted: a data URL (png, jpeg, webp, gif, up to 60 KB)
// or an https link. SVG is refused on purpose, because an SVG can carry script.
const THUMB_DATA = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+\/]+={0,2}$/;
function cleanThumb(v) {
  const t = String(v == null ? '' : v).trim(); if (!t) return '';
  if (t.startsWith('data:')) return t.length <= 80000 && THUMB_DATA.test(t) ? t : '';
  try { const u = new URL(t); return u.protocol === 'https:' && !u.username && !u.password && t.length <= 500 && !/\.svg(?:$|[?#])/i.test(u.pathname + u.search) ? u.toString() : ''; } catch { return ''; }
}
function clean(t) {
  const name = slugify(t.name);
  return { name, what: String(t.what || '').replace(/\s+/g, ' ').trim().slice(0, 240), method: String(t.method || 'GET').toUpperCase(), url: String(t.url).trim().slice(0, 600),
    headers: Object.fromEntries(Object.entries(t.headers || {}).slice(0, 12).map(([k, v]) => [String(k).replace(/[^A-Za-z0-9-]/g, '').slice(0, 60), String(v).slice(0, 400)]).filter(([k]) => k && !/^(host|content-length|connection|transfer-encoding)$/i.test(k))),
    body: t.body == null ? '' : String(t.body).slice(0, 4000), params: (Array.isArray(t.params) ? t.params : []).map(p => String(p).replace(/[^A-Za-z0-9_]/g, '').slice(0, 32)).filter(Boolean).slice(0, 10),
    title: String(t.title || '').replace(/\s+/g, ' ').trim().slice(0, 60), thumb: cleanThumb(t.thumb),
    on: t.on !== false, by: t.by === 'ai' ? 'ai' : 'user' };
}
function ensure() { try { fs.mkdirSync(DIR, { recursive: true }); } catch {} }
function read(slug) { try { const o = JSON.parse(fs.readFileSync(file(slug), 'utf8')); return o && !problem(o) ? clean(o) : null; } catch { return null; } }
function list() { ensure(); let out = []; try { out = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => read(f.slice(0, -5))).filter(Boolean); } catch {} return out.sort((a, b) => a.name.localeCompare(b.name)); }
function save(t) { const p = problem(t); if (p) throw new Error(p); ensure(); const c = clean(t); if (list().length >= 30 && !read(c.name)) throw new Error('You can keep up to 30 custom tools.'); fs.writeFileSync(file(c.name), JSON.stringify(c, null, 1)); return c.name; }
// Edit how a tool looks and is described. A rename moves the file; the recipe (address, headers, body) stays exactly as it was.
function update(name, patch) {
  const old = read(slugify(name)); if (!old) throw new Error('No tool called ' + slugify(name) + '.');
  const p = patch || {}; const next = { ...old };
  if (p.title != null) next.title = p.title;
  if (p.what != null) next.what = p.what;
  if (p.thumb != null) { const th = cleanThumb(p.thumb); if (String(p.thumb).trim() && !th) throw new Error('That picture is not allowed. Use a png, jpeg, webp or gif under 60 KB, or an https link.'); next.thumb = th; }
  const newName = p.name != null && slugify(p.name) !== old.name ? slugify(p.name) : old.name;
  if (newName !== old.name) { if (!SLUG.test(newName)) throw new Error('the name needs 3 to 32 letters, numbers or _'); if (read(newName)) throw new Error('There is already a tool called ' + newName + '.'); next.name = newName; }
  const pr = problem(next); if (pr) throw new Error(pr);
  ensure(); const c = clean(next); fs.writeFileSync(file(c.name), JSON.stringify(c, null, 1));
  if (c.name !== old.name) { try { fs.unlinkSync(file(old.name)); } catch {} }
  return c.name;
}
function remove(name) { const s = slugify(name); if (!SLUG.test(s)) throw new Error('No such tool.'); try { fs.unlinkSync(file(s)); } catch {} return true; }
function setOn(name, on) { const s = slugify(name), o = read(s); if (!o) throw new Error('No tool called ' + s + '.'); o.on = !!on; fs.writeFileSync(file(s), JSON.stringify(o, null, 1)); }

// Secrets live in their own file, never in the tool and never sent to the AI.
const SECRETS = path.join(DIR, '..', 'usertools-secrets.json');
function readSecrets() { try { const o = JSON.parse(fs.readFileSync(SECRETS, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
function secretValues() { return readSecrets(); }   // server use only: lets a draft be scrubbed of any real key the model wrote out
function secretNames() { return Object.keys(readSecrets()).sort(); }
function setSecret(name, value) { const n = String(name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40); if (!n) throw new Error('Give the secret a name like SUPABASE_KEY.'); const o = readSecrets(); if (value == null || value === '') delete o[n]; else { if (Object.keys(o).length >= 40 && !(n in o)) throw new Error('Up to 40 secrets.'); o[n] = String(value).slice(0, 2000); } ensure(); fs.writeFileSync(SECRETS, JSON.stringify(o), { mode: 0o600 }); return n; }

// Values used in the request template must be supplied; never turn an omitted value into an empty URL segment.
function requiredArgs(t) {
  const raw = [t && t.url, JSON.stringify(t && t.headers || {}), t && t.body].join('\n'), out = new Set();
  const re = /\{\{\s*(?!secret\.)([A-Za-z0-9_]+)\s*\}\}/g; let m;
  while ((m = re.exec(raw))) out.add(m[1]);
  return [...out];
}
function missingArgs(t, args) { return requiredArgs(t).filter(n => !args || args[n] == null || String(args[n]).trim() === ''); }
// The AI gets the purpose and argument instructions, but never the address, headers or secrets.
function asTools(mentioned = []) {
  const wanted = new Set((Array.isArray(mentioned) ? mentioned : []).map(slugify));
  return list().filter(t => t.on || wanted.has(t.name)).map(t => {
    const required = requiredArgs(t), params = t.params.length ? t.params.map(p => `"${p}": string`).join(', ') : 'none';
    const desc = `User-created API plugin x_${t.name} (${t.title || t.name}). Use when: ${t.what}. Arguments: {${params}}. ` +
      (required.length ? `Required template values: ${required.join(', ')}. ` : 'No arguments are required. ') +
      `Take values from the user's request. If a required value is missing, ask instead of guessing. ` +
      (t.method !== 'GET' ? 'This changes data and requires the user to approve each call.' : 'This is a read request.');
    return { name: TOOL_PREFIX + t.name, desc, method: t.method };
  });
}
const isUserTool = name => typeof name === 'string' && name.startsWith(TOOL_PREFIX) && !!read(name.slice(TOOL_PREFIX.length));
const needsApproval = name => { const t = read(String(name).slice(TOOL_PREFIX.length)); return !!t && t.method !== 'GET'; };

function hide(text, used) { let s = String(text); for (const v of used) if (v && v.length >= 4) s = s.split(v).join('[secret]'); return s; }
async function run(name, args, opts = {}) {
  const t = read(String(name).slice(TOOL_PREFIX.length)); if (!t) throw new Error('No such custom tool.'); if (!t.on && opts.allowOff !== true) throw new Error('That tool is switched off.');
  const missing = missingArgs(t, args); if (missing.length) throw new Error('Missing value(s): ' + missing.join(', ') + '. Ask the user for them before calling this tool.');
  const secrets = readSecrets(), used = new Set();
  const url = await checkUrl(fillUrl(t.url, args, secrets, used));
  const headers = {}; for (const [k, v] of Object.entries(t.headers)) headers[k] = fill(v, args, secrets, used).replace(/[\r\n]/g, '');
  let body; if (t.method !== 'GET' && t.body) { body = String(t.body).replace(/\{\{\s*(secret\.)?([A-Za-z0-9_]+)\s*\}\}/g, (m, sec, n) => { if (sec) { if (!(n in secrets)) throw new Error('Missing secret ' + n); used.add(secrets[n]); return JSON.stringify(secrets[n]).slice(1, -1); } return JSON.stringify(String(args && args[n] != null ? args[n] : '')).slice(1, -1); }); if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'; }
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 15000);
  try {
    const r = await fetch(url, { method: t.method, headers, body, signal: ctl.signal, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) return `The service sent a redirect (${r.status}). Redirects are not followed for safety. Use the final address.`;
    const txt = hide((await r.text()).slice(0, 6000), used);
    return `HTTP ${r.status}${r.ok ? '' : ' (failed)'}\n${txt}`;
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'The service took too long (15 seconds).' : 'Request failed: ' + hide(e.message, used)); }
  finally { clearTimeout(timer); }
}

// create_plugin: the AI (or you, in words) can make a new tool. The AI only writes the recipe. It never gets to see secrets.
const MAKER_TOOL = { name: 'create_plugin', desc: 'Make a NEW custom tool for the user that calls a web service (Supabase, Discord, Notion, any https API). Only when the user asks for a new ability. args: {"name": "short_name", "what": "one sentence: what it does", "method": "GET|POST|PUT|PATCH|DELETE", "url": "https://... with {{value}} placeholders", "headers": {"Authorization": "Bearer {{secret.MY_KEY}}"}, "body": "JSON text with {{value}} placeholders", "params": ["value", ...]}. Keys go in headers as {{secret.NAME}}, never written out.' };
// Which saved secrets does this tool use? (looks at the address, headers and body)
const needed = t => [...new Set([...(JSON.stringify([t.url, t.headers, t.body]).matchAll(/\{\{\s*secret\.([A-Za-z0-9_]+)/g))].map(m => m[1]))];
const isMaker = n => n === 'create_plugin';
// "Create a tool with AI": the person pastes the service, what they want, and the API key. The key is saved as a secret FIRST under a chosen name;
// the model is told only that secret's NAME (for example {{secret.NOTION_KEY}}) and never the value.
const TOOL_WRITER_PROMPT = 'You design ONE custom web tool for a chat app. Reply with ONLY one JSON object, no other text: {"name":"short_snake_case","title":"Short Title","what":"one sentence: what it does and when to use it","method":"GET|POST|PUT|PATCH|DELETE","url":"https://... with {{value}} placeholders","headers":{"Header":"value"},"body":"JSON text with {{value}} placeholders, or empty","params":["value"]}. '
  + 'Rules: the url MUST be https. {{value}} is something the chat AI will fill in later (list each in params). Use ONLY the secret names you are given, written exactly as {{secret.NAME}}, in a header such as "Authorization": "Bearer {{secret.NAME}}". NEVER write a real key. Use GET for reading. Use the service\'s real public API address you are confident about. If you are not sure of the address, use the one the user gave.';
function parseToolJson(text) { try { const m = String(text).match(/\{[\s\S]*\}/); if (!m) return null; const o = JSON.parse(m[0]); return o && typeof o === 'object' ? o : null; } catch { return null; } }
// Keeps only secret names that really exist, and removes any real key the model may have written out by mistake.
function sanitizeDraft(o, secretValues, allowed) {
  const t = { ...o }; const scrub = v => { let x = String(v == null ? '' : v); for (const sv of secretValues) if (sv && sv.length >= 4) x = x.split(sv).join(allowed[0] ? '{{secret.' + allowed[0] + '}}' : '[removed]'); return x; };
  t.url = scrub(t.url); t.body = scrub(t.body); t.headers = Object.fromEntries(Object.entries(t.headers || {}).map(([k, v]) => [k, scrub(v)]));
  t.by = 'ai'; t.on = true;
  const used = needed(t); const bad = used.filter(n => !allowed.includes(n)); if (bad.length) throw new Error('The AI used a secret that does not exist: ' + bad[0]);
  return t;
}
function runMaker(args) { const a = args || {}; const name = save({ ...a, by: 'ai', on: true }); const t = read(name); return `MADE custom tool x_${name} (${t.method}). It is on now. ${needed(t).length ? 'The user must add these secret(s) in Plugins > My tools before it works: ' + needed(t).join(', ') + '. ' : ''}${t.method !== 'GET' ? 'It will ask for approval before each use.' : ''}`; }

module.exports = { secretValues, update, cleanThumb, TOOL_WRITER_PROMPT, parseToolJson, sanitizeDraft, TOOL_PREFIX, slugify, privateIp, checkUrl, fill, fillUrl, problem, clean, list, read, save, remove, setOn, secretNames, setSecret, requiredArgs, missingArgs, asTools, isUserTool, needsApproval, run, MAKER_TOOL, isMaker, runMaker, hide, needed };
