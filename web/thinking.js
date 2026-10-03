// Splits streamed model text into the hidden reasoning and the visible answer, and words the timer.
// Pure logic, no page code, so it can be tested on its own.

// raw may be half-finished while streaming. Returns { thought, answer, open } where open=true means </think> has not arrived yet.
export function splitThinking(raw) {
  raw = String(raw == null ? '' : raw);
  let thought = '', answer = '', open = false, i = 0;
  for (;;) {
    const a = raw.indexOf('<think>', i);
    if (a < 0) { answer += raw.slice(i); break; }
    answer += raw.slice(i, a);
    const b = raw.indexOf('</think>', a + 7);
    if (b < 0) { thought += (thought ? '\n\n' : '') + raw.slice(a + 7); open = true; break; }
    thought += (thought ? '\n\n' : '') + raw.slice(a + 7, b);
    i = b + 8;
  }
  // a tag that is still arriving ("<thi") must not flash on screen as text
  const m = /<\/?t?h?i?n?k?>?$/.exec(answer); if (m && m[0] && '<think>'.startsWith(m[0].replace('/', '')) ) answer = answer.slice(0, m.index);
  return { thought: thought.trim(), answer: answer.replace(/^\s+/, ''), open };
}

export function fmtSeconds(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  const m = Math.floor(s / 60); return m + 'm ' + Math.round(s - m * 60) + 's';
}

// Short label for the card header.
export function thinkLabel({ open, ms, words }) {
  if (open) return 'Thinking\u2026 ' + fmtSeconds(ms);
  return 'Thought for ' + fmtSeconds(ms) + (words ? ' \u00b7 ' + words + ' words' : '');
}
export const countWords = t => (String(t || '').trim().match(/\S+/g) || []).length;
