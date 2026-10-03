// Sites the AI looked at while answering: safe links, preview images, and a clean record for the chat and Studio.
// Nothing here opens a link for the user. The page only shows them, and the user clicks on purpose.
const net = require('net');

const RISKY_TLD = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'cf', 'tk', 'ml', 'ga', 'work', 'loan', 'men', 'kim', 'rest']);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at']);

function isPrivateHost(h) {
  h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (net.isIPv4(h)) { const [a, b] = h.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; }
  if (net.isIPv6(h)) return h === '::1' || h === '::' || /^f[cd]/.test(h) || h.startsWith('fe80');
  return false;
}

// Returns { ok, url, host, warn } . ok=false means the link must never be shown as clickable.
function checkLink(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, why: 'not a web address' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, why: 'only http and https links are allowed' };
  if (u.username || u.password) return { ok: false, why: 'the link hides a login in front of the site name' };
  if (isPrivateHost(u.hostname)) return { ok: false, why: 'points at a private address on your own network' };
  const host = u.hostname.toLowerCase().replace(/^www\./, ''); const warn = [];
  if (net.isIPv4(host) || net.isIPv6(host)) warn.push('raw IP address instead of a site name');
  if (host.startsWith('xn--') || host.includes('.xn--')) warn.push('disguised (lookalike) characters in the name');
  const tld = host.split('.').pop(); if (RISKY_TLD.has(tld)) warn.push('an ending (.' + tld + ') often used for scams');
  if (SHORTENERS.has(host)) warn.push('a shortened link that hides where it goes');
  if (u.protocol === 'http:') warn.push('not encrypted (http)');
  if (/\.(exe|msi|bat|cmd|scr|vbs|ps1|jar|apk|dmg|pkg|hta|lnk)(\?|#|$)/i.test(u.pathname)) warn.push('a program file. Only run it if you trust the site');
  u.hash = ''; return { ok: true, url: u.toString(), host, warn };
}

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tagAttr = (tag, name) => { const m = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? decode(m[2] ?? m[3]) : ''; };

// Preview picture + title + description from a page's own tags.
function pageMeta(html, baseUrl) {
  const out = { title: '', image: '', desc: '' }; html = String(html || '').slice(0, 200000);
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of metas) {
    const key = (tagAttr(t, 'property') || tagAttr(t, 'name')).toLowerCase(), val = tagAttr(t, 'content');
    if (!val) continue;
    if ((key === 'og:image' || key === 'og:image:url' || key === 'twitter:image') && !out.image) out.image = val;
    else if ((key === 'og:title' || key === 'twitter:title') && !out.title) out.title = val;
    else if ((key === 'og:description' || key === 'description') && !out.desc) out.desc = val;
  }
  if (!out.title) { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); if (m) out.title = decode(m[1].replace(/\s+/g, ' ')); }
  if (out.image) { try { out.image = new URL(out.image, baseUrl).toString(); } catch { out.image = ''; } }
  if (out.image) { const c = checkLink(out.image); if (!c.ok || c.warn.some(w => /raw IP|disguised/.test(w))) out.image = ''; else out.image = c.url; }
  out.title = out.title.slice(0, 140); out.desc = out.desc.slice(0, 220);
  return out;
}

// One list per chat request. Keeps order, drops repeats, caps the size.
function makeCollector(max = 12) {
  const list = [], seen = new Set();
  return {
    add(entry) {
      const c = checkLink(entry.url); if (!c.ok) return null;
      if (seen.has(c.url)) { const ex = list.find(x => x.url === c.url); if (ex) Object.assign(ex, { image: ex.image || entry.image || '', title: ex.title || entry.title || '' }); return ex; }
      if (list.length >= max) return null; seen.add(c.url);
      const e = { url: c.url, host: c.host, title: String(entry.title || c.host).slice(0, 140), snippet: String(entry.snippet || '').slice(0, 220), image: entry.image || '', how: entry.how || 'found', warn: c.warn, at: Date.now() };
      list.push(e); return e;
    },
    list: () => list.slice(),
    size: () => list.length,
  };
}

module.exports = { checkLink, isPrivateHost, pageMeta, makeCollector };
