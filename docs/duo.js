// Duo for the browser (website and the PC app's page). Two local AIs work together: a small HELPER writes short hints,
// the chosen MAIN model answers. The helper's hints are shown to the main model as "may be wrong", and bad hints are dropped.
// Pure logic (no network), tested in test/core.test.js. The PC server has the same rules in server/duo.js.
export const DUO_KEY = 'pholama.duo';          // '1' = on, '0' or missing = off
export const DUO_HELPER_KEY = 'pholama.duo.helper';

export const HELPER_SYSTEM = 'You are the helper step of a two-AI team. A bigger AI will write the final answer, not you. Write ONLY short working notes for it: what is asked, the key facts or steps, and one check. Plain text, at most 8 short lines. Never greet, never write the final answer.';

export function cleanNotes(raw, maxChars = 1500) {
  let t = String(raw == null ? '' : raw).replace(/<\/?think>/gi, '').replace(/\u0000/g, '').trim();
  if (t.length < 8) return '';
  if (/^(sorry|i (can'?t|cannot|am unable))/i.test(t)) return '';
  if (t.split(/\n+/).map(x => x.trim()).filter(Boolean).length < 2) return '';   // a one-line answer is not working, and could be wrong
  if (t.length > maxChars) t = t.slice(0, maxChars).replace(/\s+\S*$/, '') + ' ...';
  return t;
}
export function withNotes(userText, notes) {
  const n = cleanNotes(notes);
  if (!n) return String(userText || '');
  return String(userText || '') + '\n\n(Hints from a small helper AI. They may be wrong, so check them yourself and ignore anything that does not add up:\n' + n + '\n)\nNow reply with the final answer in clear sentences.';
}

// Rough weight of a browser model in MB, from the catalog's "~0.4 GB" / "~190 MB" style text.
export function sizeMB(m) {
  if (!m) return 0;
  if (typeof m.sizeMB === 'number') return m.sizeMB;
  const x = /([\d.]+)\s*(GB|MB)/i.exec(String(m.size || '')); if (!x) return 0;
  return Math.round(parseFloat(x[1]) * (/gb/i.test(x[2]) ? 1024 : 1));
}

// Which downloaded models can help `main`? Never the same one; clearly smaller (at most 60%); a plain chat model.
export function helpers(main, downloaded) {
  if (!main) return [];
  const ms = sizeMB(main);
  return (downloaded || []).filter(h => h && h.id !== main.id && sizeMB(h) > 0 && ms > 0 && sizeMB(h) <= ms * 0.6
    && !(h.caps || []).some(c => ['code', 'reasoning', 'thinking'].includes(c)));
}
export function pickHelper(main, downloaded, chosenId) {
  const c = helpers(main, downloaded); if (!c.length) return null;
  return c.find(h => h.id === chosenId) || c.slice().sort((a, b) => sizeMB(b) - sizeMB(a))[0];
}

// Is duo allowed right now? `deviceGB` is navigator.deviceMemory (a browser gives 0.25-8, or nothing).
// Two browser models live in memory at once, so the budget is their SUM plus room for the page.
export function plan({ enabled, main, downloaded, chosenId, deviceGB }) {
  if (!enabled) return { on: false, why: 'Duo is off.' };
  if (!main) return { on: false, why: 'No main model picked.' };
  const h = pickHelper(main, downloaded, chosenId);
  if (!h) return { on: false, why: 'Duo needs a second, smaller downloaded model. None found, so one AI is answering.' };
  const needMB = (sizeMB(main) + sizeMB(h)) * 1.6;
  if (deviceGB && deviceGB * 1024 < needMB * 2.5) return { on: false, why: `This device reports about ${deviceGB} GB of memory, which is too little to hold two models. One AI is answering.` };
  return { on: true, helper: h, why: `${h.name || h.id} prepares hints, ${main.name || main.id} answers.` };
}
