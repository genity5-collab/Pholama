// What extra things cost in integration credits. Pure logic (no files, no network) so it is tested on its own.
// Plain chat on your own model is free. These are the things that use real work:
//   images   - the picture reader has to look at each picture
//   code     - big pasted code is a lot for a small model to chew through (charged by size)
//   studio   - every message you send while building in Studio
// The page reports WHAT was attached (counts only, never the content). The server clamps the numbers and does the charging.

const IMAGE_EACH = 5;        // per picture shown to the reader
const CODE_PER_1000 = 2;     // per 1000 characters of pasted code, rounded up
const CODE_MIN = 2;          // any pasted code costs at least this
const CODE_MAX = 30;         // but one message never costs more than this for code
// Studio prices by how big the job is (worked out on the server from the real message, so the page cannot lower it):
const STUDIO_CHAT = 1;       // a question or a chat in Studio
const STUDIO_MESSAGE = 3;    // a medium task (a normal build or edit)
const STUDIO_BIG = 4;        // a big task (a whole app, game or site, or a long multi-part request)
const MAX_STUDIO = 0;        // Agent Max in Studio costs the same as any other model now. It still uses its own daily/monthly Max messages.
const MAX_IMAGES = 4;        // same as the app's file limit

const whole = (n, hi) => { n = Math.floor(+n); return Number.isFinite(n) && n > 0 ? Math.min(n, hi) : 0; };

// Sort a Studio message into 'chat', 'medium' or 'big'. Plain words and counts only, no AI, so the price is always predictable.
const BUILD = /\b(make|build|create|add|write|code|generate|design|fix|change|update|edit|rewrite|refactor|implement|remove|delete|rename|convert|improve|redo|continue)\b/i;
const WHOLE = /\b(whole|entire|full|complete|from scratch)\b|\b(an?|the)\s+(\w+\s+){0,2}(app|game|website|web ?site|site|platform|dashboard|shop|store|portal|system|tool|clone)\b/i;
function taskSize(text) {
  const t = String(text || '').trim(); if (!t) return 'chat';
  if (!BUILD.test(t)) return 'chat';                                     // no build verb: it is a question or small talk
  const parts = (t.match(/(?:^|\n)\s*(?:[-*\u2022]|\d+[.)])\s+\S/g) || []).length;   // bullet or numbered items
  const files = new Set((t.match(/\b[\w\/-]+\.(?:html|css|js|ts|json|py|lua|md|cpp|rs|go|java)\b/gi) || []).map(x => x.toLowerCase())).size;
  const ands = (t.match(/\b(and|also|then|plus)\b/gi) || []).length + (t.match(/,/g) || []).length;   // commas and 'and' both mean another part
  if (t.length > 500 || parts >= 4 || files >= 3 || (WHOLE.test(t) && (t.length > 90 || ands >= 2))) return 'big';
  return 'medium';
}

// extras: { images: number, codeChars: number, studio: boolean, maxStudio: boolean }  (anything else is ignored)
function extraCost(extras) {
  const e = extras && typeof extras === 'object' ? extras : {};
  const images = whole(e.images, MAX_IMAGES);
  const codeChars = whole(e.codeChars, 1e7);
  const studio = e.studio === true;
  const size = studio ? (e.size === 'big' || e.size === 'chat' ? e.size : 'medium') : null;
  const img = images * IMAGE_EACH;
  const code = codeChars ? Math.min(CODE_MAX, Math.max(CODE_MIN, Math.ceil(codeChars / 1000) * CODE_PER_1000)) : 0;
  const stu = studio ? (size === 'chat' ? STUDIO_CHAT : size === 'big' ? STUDIO_BIG : STUDIO_MESSAGE) : 0;
  const maxStudio = studio && e.maxStudio === true, mx = maxStudio ? MAX_STUDIO : 0;   // Agent Max in Studio only counts inside Studio
  return { images, codeChars, studio, size, maxStudio, img, code, stu, mx, total: img + code + stu + mx };
}

// How much of a user's own message is pasted code: text inside ``` fences, plus any very long single paste with code-like lines.
// Measured on the server from the real message, so it cannot be under-reported by the page.
function codeCharsIn(text) {
  const t = String(text || ''); let n = 0, m; const fence = /```[^\n]*\n([\s\S]*?)(```|$)/g;
  while ((m = fence.exec(t))) n += m[1].length;
  if (n) return n;
  // no fences: count it as code only when it is long AND most lines look like code (so a long essay is never charged)
  const lines = t.split('\n'); if (t.length < 400 || lines.length < 6) return 0;
  const codey = lines.filter(l => /[{};=()<>]|^\s{2,}\S|^\s*(def|function|const|let|var|class|import|return|if|for|while|local|end)\b/.test(l)).length;
  return codey / lines.length >= 0.6 ? t.length : 0;
}

// Describe a price in one plain sentence for the chat log.
function describe(c) {
  const parts = [];
  if (c.img) parts.push(`${c.images} picture${c.images === 1 ? '' : 's'} ${c.img}`);
  if (c.code) parts.push(`pasted code ${c.code}`);
  if (c.stu) parts.push(`Studio ${c.size === 'big' ? 'big task' : c.size === 'chat' ? 'chat' : 'task'} ${c.stu}`);
  if (c.mx) parts.push(`Agent Max in Studio ${c.mx}`);
  return parts.join(' + ');
}

module.exports = { taskSize, STUDIO_CHAT, STUDIO_BIG, MAX_STUDIO, IMAGE_EACH, CODE_PER_1000, CODE_MIN, CODE_MAX, STUDIO_MESSAGE, MAX_IMAGES, extraCost, codeCharsIn, describe };
