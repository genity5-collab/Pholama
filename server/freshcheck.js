'use strict';
// "Is there a newer commit?" without waiting for GitHub's file cache (raw.githubusercontent.com keeps files for 5 minutes).
// Asks the commits API (cached for 1 minute at most), remembers the ETag, and reads package.json AT THAT COMMIT so it is never stale.
// GitHub allows 60 API requests an hour without a login, so this backs off by itself when the allowance runs low.
const https = require('https');
const LOW = 10;                       // fewer than this many requests left: slow down
const state = { etag: null, sha: null, version: null, remaining: null, resetAt: 0, blockedUntil: 0 };

function get(url, headers, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Pholama-updater', Accept: 'application/vnd.github+json', ...headers }, timeout, family: 4 }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', c => { if (b.length < 1e6) b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out'))); req.on('error', reject);
  });
}
const noteLimit = h => {
  const rem = Number(h['x-ratelimit-remaining']), reset = Number(h['x-ratelimit-reset']);
  if (Number.isFinite(rem)) state.remaining = rem; if (Number.isFinite(reset)) state.resetAt = reset * 1000;
};

// Returns { ok:true, sha, version, changed } or { ok:false, reason } (the caller then uses the old cached route).
async function latest({ repo, branch, http = get, now = Date.now } = {}) {
  if (now() < state.blockedUntil) return { ok: false, reason: 'backing off' };
  if (state.remaining !== null && state.remaining < LOW && now() < state.resetAt) return { ok: false, reason: 'rate limit nearly used' };
  let r;
  try { r = await http(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, state.etag ? { 'If-None-Match': state.etag } : {}); }
  catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 60) }; }
  noteLimit(r.headers || {});
  if (r.status === 403 || r.status === 429) { state.blockedUntil = Math.max(state.resetAt, now() + 10 * 60 * 1000); return { ok: false, reason: 'rate limited' }; }
  if (r.status === 304 && state.sha && state.version) return { ok: true, sha: state.sha, version: state.version, changed: false };
  if (r.status !== 200) return { ok: false, reason: 'HTTP ' + r.status };
  let sha; try { sha = JSON.parse(r.body).sha; } catch { return { ok: false, reason: 'unreadable answer' }; }
  if (!/^[0-9a-f]{40}$/.test(String(sha))) return { ok: false, reason: 'no commit id' };
  if (sha === state.sha && state.version) { state.etag = r.headers.etag || state.etag; return { ok: true, sha, version: state.version, changed: false }; }
  // a new commit: read package.json at exactly that commit (a commit-pinned address is never served from an old cache)
  let p; try { p = await http(`https://raw.githubusercontent.com/${repo}/${sha}/package.json`, {}); } catch (e) { return { ok: false, reason: 'could not read package.json' }; }
  let version; try { version = String(JSON.parse(p.body).version || ''); } catch { version = ''; }
  if (p.status !== 200 || !version) return { ok: false, reason: 'could not read package.json' };
  state.etag = r.headers.etag || null; state.sha = sha; state.version = version;
  return { ok: true, sha, version, changed: true };
}
const reset = () => Object.assign(state, { etag: null, sha: null, version: null, remaining: null, resetAt: 0, blockedUntil: 0 });
module.exports = { latest, reset, state };
