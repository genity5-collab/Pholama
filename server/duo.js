// Two local AIs working together.
// A small, fast HELPER model does the quick private work (the working notes before an answer), then the bigger MAIN model writes the
// final answer. Each does what it is good at. Only ONE engine runs at a time (the PC swaps between them), so memory use stays the same.
// Pure logic, no network: tested in test/core.test.js.

const sizeOf = m => +(m && (m.sizeGB != null ? m.sizeGB : 0)) || 0;

// Which downloaded models can act as a helper for `main`?
// Rules: never the same model; must be clearly smaller (at most 60% of the main one's size, so swapping is quick);
// must be a quick chat model; a model that is only a code or reasoning specialist is skipped (its notes would be off-topic or too long).
function helperCandidates(main, downloaded) {
  if (!main) return [];
  const ms = sizeOf(main);
  return (downloaded || []).filter(h => {
    if (!h || h.id === main.id) return false;
    const caps = h.caps || [];
    if (!caps.includes('chat') || !caps.includes('fast')) return false;
    if (caps.includes('code') || caps.includes('reasoning') || caps.includes('thinking')) return false;
    const hs = sizeOf(h);
    if (!(hs > 0) || !(ms > 0)) return false;
    return hs <= ms * 0.6;
  });
}

// Pick the best helper: the strongest of the eligible ones (bigger helper = better notes), but never above the 60% rule.
function pickHelper(main, downloaded, chosenId) {
  const c = helperCandidates(main, downloaded);
  if (!c.length) return null;
  if (chosenId) { const w = c.find(h => h.id === chosenId); if (w) return w; }   // the user's own choice wins when it is valid
  return c.slice().sort((a, b) => sizeOf(b) - sizeOf(a))[0];
}

// Is a duo allowed right now? Returns { on, helper, why }.
// `enabled` is the user's switch, `free` is free RAM in GB (0 or unknown = do not risk it).
function planDuo({ enabled, main, downloaded, chosenId, freeGB }) {
  if (!enabled) return { on: false, why: 'Duo mode is off.' };
  if (!main) return { on: false, why: 'No main model.' };
  const helper = pickHelper(main, downloaded, chosenId);
  if (!helper) return { on: false, why: 'Duo needs a second, smaller chat model downloaded. None found.' };
  // one engine at a time, so the need is the LARGER of the two, plus headroom
  const need = Math.max(sizeOf(main), sizeOf(helper)) * 1.3;
  if (freeGB != null && freeGB > 0 && freeGB < need) return { on: false, why: `Not enough free memory for a duo (${freeGB.toFixed(1)} GB free, about ${need.toFixed(1)} GB needed).` };
  return { on: true, helper, why: `${helper.name || helper.id} prepares the notes, ${main.name || main.id} answers.` };
}

// The helper only writes notes, so it gets its own short, strict job description.
const HELPER_SYSTEM = 'You are the helper step of a two-AI team. A bigger AI will write the final answer, not you. Write ONLY short working notes for it: what is asked, the key facts or steps, and one check. Plain text, at most 8 short lines. Never greet, never write the final answer.';

// The notes can be wrong (a small model). Clean them, cap them, and refuse junk, so a bad helper can never derail the main model.
function cleanNotes(raw, maxChars = 1500) {
  let t = String(raw == null ? '' : raw).replace(/<\/?think>/gi, '').replace(/\u0000/g, '').trim();
  if (t.length < 8) return '';
  if (/^(sorry|i (can'?t|cannot|am unable))/i.test(t)) return '';   // a refusal is not notes
  // A helper that ignores its job and just answers in one sentence is not giving working. A wrong answer here would mislead the main AI.
  const lines = t.split(/\n+/).map(x => x.trim()).filter(Boolean);
  if (lines.length < 2) return '';
  if (t.length > maxChars) t = t.slice(0, maxChars).replace(/\s+\S*$/, '') + ' ...';
  return t;
}

// Hand the notes to the main model as its own trusted working (same way the single-model thinking pass does).
function withNotes(userText, notes) {
  const n = cleanNotes(notes);
  if (!n) return String(userText || '');
  return String(userText || '') + '\n\n(Hints from a small helper AI. They may be wrong, so check them yourself and ignore anything that does not add up:\n' + n + '\n)\nNow reply with the final answer in clear sentences.';
}

module.exports = { helperCandidates, pickHelper, planDuo, cleanNotes, withNotes, HELPER_SYSTEM };
