'use strict';
// Lets the AI show a YouTube video or a picture in the chat when the user asks for one.
// The AI never writes HTML. It gives a video id or a picture address; the chat draws the card itself.
//  * A video is only ever shown as youtube-nocookie.com/embed/<11 character id>. Nothing else is accepted.
//  * A picture must be https, and the chat shows it as a plain image (an <img>), never as a page.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function ytId(input) {
  const s = String(input || '').trim(); if (YT_ID.test(s)) return s;
  let u; try { u = new URL(s); } catch { return null; }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (h === 'youtu.be') return YT_ID.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
  if (h === 'youtube.com' || h === 'youtube-nocookie.com' || h === 'music.youtube.com') {
    const v = u.searchParams.get('v'); if (v && YT_ID.test(v)) return v;
    const m = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:$|[/?])/.exec(u.pathname); if (m) return m[1];
  }
  return null;
}
// A real picture link: ends in an image extension, or is on a well known picture host.
const IMG_EXT = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const IMG_HOST = /(?:^|\.)(?:upload\.wikimedia\.org|images\.unsplash\.com|images\.pexels\.com|i\.imgur\.com|live\.staticflickr\.com|cdn\.pixabay\.com|i\.redd\.it|pbs\.twimg\.com|images\.pexels\.com)$/i;
const looksLikeImage = u => IMG_EXT.test(u.pathname) || IMG_HOST.test(u.hostname) || /[?&]format=(?:jpg|jpeg|png|webp)\b/i.test(u.search);
function imageUrl(input) {
  let u; try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (!looksLikeImage(u)) return null;   // a web page is not a picture
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^(\[|\d+\.\d+\.\d+\.\d+$)/.test(u.hostname) && /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(u.hostname)) return null;
  return u.toString().slice(0, 900);
}
const cleanText = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const TOOLS = [
  { name: 'show_video', desc: 'Show a YouTube video in the chat. Use it when the user asks for a video. First web_search to find a real video link, then call this with that link. Never invent an id. args: {"url": "a youtube.com or youtu.be link", "title": string}', kind: 'media' },
  { name: 'show_image', desc: 'Show a picture in the chat. Use it when the user asks to see a picture. First web_search / fetch_page to find a real https image link (ends in .jpg .png .webp .gif), then call this. Never invent a link. args: {"url": "https://... image", "title": string}', kind: 'media' },
];
// Finds a real picture for a topic from Wikipedia (free, no key). Returns an https upload.wikimedia.org link or null.
async function imageSearch(topic, fetchImpl) {
  const q = cleanText(topic, 80).replace(/\b(?:photo|picture|image|pic)s?\b/gi, '').trim(); if (q.length < 2) return null;
  const f = fetchImpl || fetch, ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = process.env.PHOLAMA_TEST_WIKI ? { ok: true, json: async () => JSON.parse(require('fs').readFileSync(process.env.PHOLAMA_TEST_WIKI, 'utf8')) } : await f('https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' + encodeURIComponent(q) + '&gsrlimit=5&prop=pageimages&piprop=original&format=json', { headers: { 'User-Agent': 'Pholama/0.9 (https://github.com/genity5-collab/Pholama)' }, signal: ctl.signal });
    if (!r.ok) return null; const j = await r.json(); const pages = Object.values((j && j.query && j.query.pages) || {}).sort((a, b) => (a.index || 9) - (b.index || 9));
    for (const pg of pages) { const u = pg && pg.original && pg.original.source; const ok = u && imageUrl(u); if (ok) return { url: ok, title: cleanText(pg.title, 120) }; }
    return null;
  } catch { return null; } finally { clearTimeout(timer); }
}
const tools = () => TOOLS;
const isMedia = n => n === 'show_video' || n === 'show_image';
// The browser finds this marker in the tool result and draws the card. The marker holds only checked values.
function run(name, args, ctx) {
  const a = args || {}, title = cleanText(a.title, 120);
  if (name === 'show_video') {
    const id = ytId(a.url || a.id || a.link); if (!id) throw new Error('That is not a YouTube link. Search the web first and use a real youtube.com or youtu.be link.');
    if (ctx && ctx.onMedia) ctx.onMedia({ kind: 'video', id, title });
    return `SHOWN: the video "${title || id}" is now showing in the chat. Say one short line about it. Do not repeat the link.`;
  }
  const url = imageUrl(a.url || a.src || a.link); if (!url) throw new Error('That is not a usable picture link. It must start with https://. Search the web first and use a real image link.');
  if (ctx && ctx.onMedia) ctx.onMedia({ kind: 'image', url, title });
  return `SHOWN: the picture "${title || 'image'}" is now showing in the chat. Say one short line about it. Do not repeat the link.`;
}
module.exports = { imageSearch, ytId, imageUrl, tools, isMedia, run, YT_ID };
