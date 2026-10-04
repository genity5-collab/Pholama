// Pholama PC host security. Zero dependencies.
//  - Requests from this same PC (loopback) are trusted, so nothing changes at home.
//  - Any other client needs an API key: "Authorization: Bearer <key>" or "x-api-key: <key>".
//  - Keys are stored only as SHA-256 hashes. The full key is shown once when it is created.
//  - Wrong keys are rate limited per address. Comparison is constant time.
//  - Browser CORS is limited to the Pholama site, this PC and any origin you list in PHOLAMA_ORIGINS.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const DIR = process.env.PHOLAMA_HOME || path.join(os.homedir(), '.pholama');
const FILE = path.join(DIR, 'keys.json');
const MAX_KEYS = 20, MAX_FAILS = 8, WINDOW_MS = 10 * 60 * 1000;

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function load() { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(j.keys) ? j : { keys: [] }; } catch { return { keys: [] }; } }
function save(st) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 2), { mode: 0o600 }); }

// ----- keys -----
function createKey(label) {
  const st = load(); if (st.keys.length >= MAX_KEYS) throw new Error('Key limit reached (' + MAX_KEYS + '). Revoke one first.');
  const key = 'phk_' + crypto.randomBytes(24).toString('base64url');
  const rec = { id: crypto.randomBytes(5).toString('hex'), label: String(label || 'key').replace(/[^\w .@-]/g, '').slice(0, 40) || 'key', hash: sha(key), hint: key.slice(0, 8) + '...' + key.slice(-4), created: Date.now(), lastUsed: 0 };
  st.keys.push(rec); save(st);
  return { key, id: rec.id, label: rec.label, hint: rec.hint };   // the only time the full key is visible
}
function listKeys() { return load().keys.map(k => ({ id: k.id, label: k.label, hint: k.hint, created: k.created, lastUsed: k.lastUsed })); }
function revokeKey(id) { const st = load(), n = st.keys.length; st.keys = st.keys.filter(k => k.id !== String(id)); save(st); return st.keys.length < n; }
function keyCount() { return load().keys.length; }

// ----- who is calling -----
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress;
  if (!LOOPBACK.has(a)) return false;
  if (Object.keys(req.headers || {}).some(k => /^tailscale-/i.test(k))) return false;   // Tailscale Serve/Funnel add their own headers: that is a tunnel, not the PC
  // A reverse proxy / tunnel on this PC makes every request look local. Treat forwarded requests as remote.
  const h = req.headers;
  return !(h['x-forwarded-for'] || h['x-real-ip'] || h['forwarded'] || h['cf-connecting-ip'] || h['x-forwarded-host']);
}
const fails = new Map();   // addr -> [timestamps]
function addr(req) { return (req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '?').slice(0, 64); }
function blocked(a) { const now = Date.now(), l = (fails.get(a) || []).filter(t => now - t < WINDOW_MS); fails.set(a, l); return l.length >= MAX_FAILS; }
function fail(a) { const l = fails.get(a) || []; l.push(Date.now()); fails.set(a, l); if (fails.size > 2000) fails.clear(); }
function getKey(req) {
  const a = String(req.headers.authorization || ''); const m = /^Bearer\s+(\S{10,200})$/i.exec(a);
  return m ? m[1] : String(req.headers['x-api-key'] || '').slice(0, 200);
}
function checkKey(key) {
  if (!key) return null;
  const h = Buffer.from(sha(key), 'hex'), st = load(); let hit = null;
  for (const k of st.keys) { const kh = Buffer.from(k.hash, 'hex'); if (kh.length === h.length && crypto.timingSafeEqual(kh, h)) hit = k; }   // no early exit
  if (hit && Date.now() - hit.lastUsed > 60000) { hit.lastUsed = Date.now(); save(st); }
  return hit;
}

// Same checks as authorize(), but the "this request comes from the PC itself" shortcut is NEVER used.
// For anything reachable through a tunnel (ChatGPT/MCP): a tunnel runs on the PC, so every outside request can look like it came from the PC,
// and we cannot rely on which headers a tunnel adds. So a key is always required here, even from 127.0.0.1.
function authorizeKeyOnly(req) {
  const a = addr(req);
  if (blocked(a)) return { ok: false, status: 429, error: 'Too many wrong keys. Try again in a few minutes.' };
  if (!keyCount()) return { ok: false, status: 401, error: 'unauthorized', hint: 'Create a key first: on the PC, open Settings > Remote.' };
  const given = getKey(req);
  if (!given) return { ok: false, status: 401, error: 'unauthorized' };
  const k = checkKey(given);
  if (!k) { fail(a); return { ok: false, status: 401, error: 'unauthorized' }; }
  return { ok: true, who: 'key:' + k.id };
}

// Decide what to do with a request. Returns {ok, status, error, who}.
function authorize(req) {
  if (isLoopback(req)) return { ok: true, who: 'local' };
  const a = addr(req);
  if (blocked(a)) return { ok: false, status: 429, error: 'Too many wrong keys. Try again in a few minutes.' };
  if (!keyCount()) return { ok: false, status: 401, error: 'unauthorized', hint: 'No API key exists yet. On the PC, open Settings > Remote access and create one.' };
  const given = getKey(req);
  if (!given) return { ok: false, status: 401, error: 'unauthorized' };   // no key at all is not a guess, so it never counts toward a lockout
  const k = checkKey(given);
  if (!k) { fail(a); return { ok: false, status: 401, error: 'unauthorized' }; }
  return { ok: true, who: 'key:' + k.id };
}

// ----- CORS -----
const BUILTIN = ['https://genity5-collab.github.io'];
function allowedOrigins() { return BUILTIN.concat(String(process.env.PHOLAMA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)); }
function corsOrigin(req) {
  const o = req.headers.origin; if (!o) return null;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o)) return o;
  return allowedOrigins().includes(o) ? o : null;
}
function corsHeaders(req) {
  const o = corsOrigin(req); if (!o) return {};
  return { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-api-key, x-github-token', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' };
}
// Browsers from other websites must not be able to drive the local server. Block cross-site browser calls that are not allowed.
function originBlocked(req) { const o = req.headers.origin; return !!o && !corsOrigin(req); }

module.exports = { authorizeKeyOnly, createKey, listKeys, revokeKey, keyCount, authorize, isLoopback, corsHeaders, originBlocked, _sha: sha, _reset: () => fails.clear() };
