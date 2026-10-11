// The name of the cloud assistant. There is no fixed product name: it is the name the member chose, or a friendly random one.
// Stored on this device so it works at once and offline. Pure logic (storage is injectable), so it is tested without a page.
const KEY = 'pholama.agentName', SEED = 'pholama.agentSeed';
const ADJ = ['Nova', 'Ember', 'Quartz', 'Willow', 'Comet', 'Juniper', 'Atlas', 'Sable', 'Orbit', 'Maple', 'Pixel', 'River', 'Cobalt', 'Aster', 'Echo', 'Lumen'];
const NOUN = ['Fox', 'Owl', 'Wren', 'Lynx', 'Otter', 'Heron', 'Finch', 'Badger', 'Panda', 'Gecko', 'Moth', 'Raven', 'Koala', 'Newt', 'Crane', 'Hare'];
const RESERVED = /\b(pholama|admin|moderator|staff|support|system|agent max|max)\b/i;

export function randomName(seed) {
  let h = 2166136261; for (const c of String(seed || 'x')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return ADJ[h % ADJ.length] + ' ' + NOUN[(h >>> 8) % NOUN.length];
}
export function cleanName(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 24) throw new Error('Pick a name between 2 and 24 characters.');
  if (!/^[\p{L}\p{N} '\-]+$/u.test(s)) throw new Error('A name can use letters, numbers, spaces, dash and apostrophe.');
  if (RESERVED.test(s)) throw new Error('That name is reserved. Pick another.');
  return s;
}
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
// A seed that stays the same on this device, so the random name does not change on every visit.
function seed(st) {
  let v = null; try { v = st && st.getItem(SEED); } catch {}
  if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); try { st && st.setItem(SEED, v); } catch {} }
  return v;
}
export function agentName(st = store()) {
  let chosen = null; try { chosen = st && st.getItem(KEY); } catch {}
  if (chosen) { try { return cleanName(chosen); } catch { /* a bad stored value falls back to the random name */ } }
  return randomName(seed(st));
}
export function setAgentName(v, st = store()) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) { try { st && st.removeItem(KEY); } catch {} return agentName(st); }   // empty = back to the random name
  const n = cleanName(raw); try { st && st.setItem(KEY, n); } catch {} return n;
}
export const hasChosenName = (st = store()) => { try { return !!(st && st.getItem(KEY)); } catch { return false; } };
// Rewrite every marked piece of text on the page, so a rename shows up everywhere at once.
export function paintNames(root, name) { if (!root || !root.querySelectorAll) return 0; let n = 0; for (const e of root.querySelectorAll('[data-agent-name]')) { const t = e.getAttribute('data-agent-name') || '{n}'; e.textContent = t.replace(/\{n\}/g, name); n++; } return n; }
