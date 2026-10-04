'use strict';
// "Research what this API key can do". Given a SERVICE NAME only (never the key), Pholama searches for the service's API documentation, asks the
// model to propose several useful tools, and hands them back as a checklist. Nothing is saved until the person ticks it. Pure functions, tested in test/research.test.js.
const SLUG = /^[a-z][a-z0-9_]{2,31}$/;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);

// The search text is built from the service name ONLY. A key, token or anything that looks like one is removed before it can be searched.
function looksLikeSecret(s) { return /\b(?:sk|pk|rk|eyJ|ghp|gho|github_pat|xox[abp]|AKIA|AIza|sbp|service_role)[-_A-Za-z0-9.]{8,}/.test(s) || /[A-Za-z0-9+/_-]{32,}/.test(s) || /\b[0-9a-f]{32,}\b/i.test(s); }
function cleanService(name) {
  let s = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  s = s.split(' ').filter(w => !looksLikeSecret(w)).join(' ').replace(/[^\w .&+-]/g, '').trim();
  return s.length >= 2 ? s : '';
}
const queryFor = service => { const s = cleanService(service); return s ? s + ' REST API reference documentation endpoints' : ''; };

// Pull links that look like real API docs from the raw search page. Keeps a few, drops ads and social sites.
function docLinks(html, service) {
  const out = [], seen = new Set();
  const skip = /(facebook|twitter|x\.com|linkedin|youtube|reddit|pinterest|instagram|tiktok|medium\.com|quora|stackoverflow|duckduckgo)\./i;
  for (const m of String(html || '').matchAll(/href="([^"]+)"/g)) {
    let u = m[1]; const d = u.match(/[?&]uddg=([^&]+)/); if (d) { try { u = decodeURIComponent(d[1]); } catch { continue; } }
    if (!/^https:\/\//i.test(u) || skip.test(u)) continue;
    let url; try { url = new URL(u); } catch { continue; }
    if (url.username || url.password) continue;
    const key = url.hostname + url.pathname; if (seen.has(key)) continue; seen.add(key);
    const docish = /(api|docs?|developer|reference|rest|swagger|openapi)/i.test(url.hostname + url.pathname);
    out.push({ url: url.href, docish });
  }
  return out.sort((a, b) => b.docish - a.docish).slice(0, 4).map(x => x.url);
}

// Reduce a fetched docs page to a short plain-text digest the model can read.
function digest(html, max = 3500) {
  const t = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t.slice(0, max);
}

const PROMPT = 'You suggest useful custom web tools for a chat app, for ONE online service. Reply with ONLY a JSON array (no other text) of 3 to 6 objects: '
  + '[{"name":"short_snake_case","title":"Short Title","what":"one sentence: what it does and when to use it","method":"GET|POST|PUT|PATCH|DELETE","url":"https://... with {{value}} placeholders","headers":{"Header":"value"},"body":"JSON text with {{value}} placeholders, or empty","params":["value"]}]. '
  + 'Rules: every url MUST be https and MUST be the service\'s real public API address, taken from the notes you are given or one you are certain of. {{value}} is something the chat AI fills in later (list each in params). '
  + 'Use ONLY the secret name you are given, written exactly as {{secret.NAME}}, in a header such as "Authorization": "Bearer {{secret.NAME}}". NEVER write a real key. '
  + 'Prefer reading tools (GET) first: list, get, search. Add at most 2 writing tools (POST/PUT/PATCH/DELETE) for the most useful actions. Do not repeat the same tool. If you are not sure of an address, leave that tool out.';

function parseList(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const m = t.match(/\[[\s\S]*\]/); if (!m) return [];
  let a; try { a = JSON.parse(m[0]); } catch { return []; }
  return Array.isArray(a) ? a.filter(x => x && typeof x === 'object') : [];
}

// Turn the model's list into safe, checked suggestions. `check` is usertools.problem (returns a message when a tool is not allowed).
function suggestions(list, { secretName, secretValues = [], check, existing = [] }) {
  const taken = new Set(existing), out = [];
  for (const o of (list || []).slice(0, 10)) {
    let t = { ...o };
    const scrub = v => { let x = String(v == null ? '' : v); for (const sv of secretValues) if (sv && sv.length >= 4) x = x.split(sv).join(secretName ? '{{secret.' + secretName + '}}' : '[removed]'); return x; };
    t.url = scrub(t.url); t.body = scrub(t.body); t.headers = Object.fromEntries(Object.entries(t.headers || {}).map(([k, v]) => [k, scrub(v)]));
    // only the one secret we were given may be used
    const used = [...JSON.stringify([t.url, t.headers, t.body]).matchAll(/\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[1]);
    if (used.some(n => n !== secretName)) continue;
    t.method = String(t.method || 'GET').toUpperCase();
    let name = slug(t.name); if (!SLUG.test(name)) continue;
    let n = name, i = 2; while (taken.has(n)) n = (name + '_' + i++).slice(0, 32); name = n;
    t.name = name; t.title = String(t.title || name).slice(0, 60); t.params = Array.isArray(t.params) ? t.params.map(String).slice(0, 8) : [];
    // an address must be a clean https address with no name or password in it (keys belong in Secrets)
    try { const u = new URL(String(t.url).replace(/\{\{[^}]*\}\}/g, 'x')); if (u.protocol !== 'https:' || u.username || u.password) continue; } catch { continue; }
    let bad = ''; try { bad = check ? check(t) : ''; } catch (e) { bad = String(e.message || 'not allowed'); }
    if (bad) continue;
    taken.add(name);
    out.push({ name, title: t.title, what: String(t.what || '').slice(0, 200), method: t.method, url: t.url, headers: t.headers, body: t.body || '', params: t.params, writes: t.method !== 'GET' });
  }
  return out.slice(0, 6);
}
module.exports = { cleanService, queryFor, docLinks, digest, PROMPT, parseList, suggestions, looksLikeSecret };
