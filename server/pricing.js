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
const STUDIO_MESSAGE = 3;    // per Studio message
const MAX_STUDIO = 20;       // extra per Studio message when Agent Max does the thinking (it makes several cloud calls per build)
const MAX_IMAGES = 4;        // same as the app's file limit

const whole = (n, hi) => { n = Math.floor(+n); return Number.isFinite(n) && n > 0 ? Math.min(n, hi) : 0; };

// extras: { images: number, codeChars: number, studio: boolean, maxStudio: boolean }  (anything else is ignored)
function extraCost(extras) {
  const e = extras && typeof extras === 'object' ? extras : {};
  const images = whole(e.images, MAX_IMAGES);
  const codeChars = whole(e.codeChars, 1e7);
  const studio = e.studio === true;
  const img = images * IMAGE_EACH;
  const code = codeChars ? Math.min(CODE_MAX, Math.max(CODE_MIN, Math.ceil(codeChars / 1000) * CODE_PER_1000)) : 0;
  const stu = studio ? STUDIO_MESSAGE : 0;
  const maxStudio = studio && e.maxStudio === true, mx = maxStudio ? MAX_STUDIO : 0;   // Agent Max in Studio only counts inside Studio
  return { images, codeChars, studio, maxStudio, img, code, stu, mx, total: img + code + stu + mx };
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
  if (c.stu) parts.push(`Studio ${c.stu}`);
  if (c.mx) parts.push(`Agent Max in Studio ${c.mx}`);
  return parts.join(' + ');
}

module.exports = { MAX_STUDIO, IMAGE_EACH, CODE_PER_1000, CODE_MIN, CODE_MAX, STUDIO_MESSAGE, MAX_IMAGES, extraCost, codeCharsIn, describe };
