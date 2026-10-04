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
function clean(t) {
  const name = slugify(t.name);
  return { name, what: String(t.what || '').replace(/\s+/g, ' ').trim().slice(0, 240), method: String(t.method || 'GET').toUpperCase(), url: String(t.url).trim().slice(0, 600),
    headers: Object.fromEntries(Object.entries(t.headers || {}).slice(0, 12).map(([k, v]) => [String(k).replace(/[^A-Za-z0-9-]/g, '').slice(0, 60), String(v).slice(0, 400)]).filter(([k]) => k && !/^(host|content-length|connection|transfer-encoding)$/i.test(k))),
    body: t.body == null ? '' : String(t.body).slice(0, 4000), params: (Array.isArray(t.params) ? t.params : []).map(p => String(p).replace(/[^A-Za-z0-9_]/g, '').slice(0, 32)).filter(Boolean).slice(0, 10),
    on: t.on !== false, by: t.by === 'ai' ? 'ai' : 'user' };
}
function ensure() { try { fs.mkdirSync(DIR, { recursive: true }); } catch {} }
function read(slug) { try { const o = JSON.parse(fs.readFileSync(file(slug), 'utf8')); return o && !problem(o) ? clean(o) : null; } catch { return null; } }
function list() { ensure(); let out = []; try { out = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => read(f.slice(0, -5))).filter(Boolean); } catch {} return out.sort((a, b) => a.name.localeCompare(b.name)); }
function save(t) { const p = problem(t); if (p) throw new Error(p); ensure(); const c = clean(t); if (list().length >= 30 && !read(c.name)) throw new Error('You can keep up to 30 custom tools.'); fs.writeFileSync(file(c.name), JSON.stringify(c, null, 1)); return c.name; }
function remove(name) { const s = slugify(name); if (!SLUG.test(s)) throw new Error('No such tool.'); try { fs.unlinkSync(file(s)); } catch {} return true; }
function setOn(name, on) { const s = slugify(name), o = read(s); if (!o) throw new Error('No tool called ' + s + '.'); o.on = !!on; fs.writeFileSync(file(s), JSON.stringify(o, null, 1)); }

// Secrets live in their own file, never in the tool and never sent to the AI.
const SECRETS = path.join(DIR, '..', 'usertools-secrets.json');
function readSecrets() { try { const o = JSON.parse(fs.readFileSync(SECRETS, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
function secretNames() { return Object.keys(readSecrets()).sort(); }
function setSecret(name, value) { const n = String(name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40); if (!n) throw new Error('Give the secret a name like SUPABASE_KEY.'); const o = readSecrets(); if (value == null || value === '') delete o[n]; else { if (Object.keys(o).length >= 40 && !(n in o)) throw new Error('Up to 40 secrets.'); o[n] = String(value).slice(0, 2000); } ensure(); fs.writeFileSync(SECRETS, JSON.stringify(o), { mode: 0o600 }); return n; }

// What the AI is told about each tool: its name, what it does and the few values it fills in. Never the address, headers or secrets.
function asTools() { return list().filter(t => t.on).map(t => ({ name: TOOL_PREFIX + t.name, desc: `${t.what} args: {${t.params.map(p => `"${p}": string`).join(', ')}}${t.method !== 'GET' ? ' (changes data: the user is asked to approve first)' : ''}`, method: t.method })); }
const isUserTool = name => typeof name === 'string' && name.startsWith(TOOL_PREFIX) && !!read(name.slice(TOOL_PREFIX.length));
const needsApproval = name => { const t = read(String(name).slice(TOOL_PREFIX.length)); return !!t && t.method !== 'GET'; };

function hide(text, used) { let s = String(text); for (const v of used) if (v && v.length >= 4) s = s.split(v).join('[secret]'); return s; }
async function run(name, args, opts = {}) {
  const t = read(String(name).slice(TOOL_PREFIX.length)); if (!t) throw new Error('No such custom tool.'); if (!t.on) throw new Error('That tool is switched off.');
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
function runMaker(args) { const a = args || {}; const name = save({ ...a, by: 'ai', on: true }); const t = read(name); return `MADE custom tool x_${name} (${t.method}). It is on now. ${needed(t).length ? 'The user must add these secret(s) in Plugins > My tools before it works: ' + needed(t).join(', ') + '. ' : ''}${t.method !== 'GET' ? 'It will ask for approval before each use.' : ''}`; }

module.exports = { TOOL_PREFIX, slugify, privateIp, checkUrl, fill, fillUrl, problem, clean, list, read, save, remove, setOn, secretNames, setSecret, asTools, isUserTool, needsApproval, run, MAKER_TOOL, isMaker, runMaker, hide, needed };
