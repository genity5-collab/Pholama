// One account, one place for the big AIs. When a person is signed in and that same account already has a PC on record,
// the browser (phone or site) does NOT download a model. Chat goes through the PC instead, so the phone's storage and data stay free.
// Pure functions, so the rule can be tested without a browser.

// `browser` models are web: and cpu: ids (they download into this device). PC/remote models never download here.
export function isBrowserDownload(value) { const v = String(value || ''); return v.startsWith('web:') || v.startsWith('cpu:'); }

// Returns { block, why }. Offline or unknown (hasPc === null) never blocks: a person with no connection must still be able to chat.
export function downloadDecision({ signedIn, hasPc, value }) {
  if (!isBrowserDownload(value)) return { block: false, why: '' };
  if (!signedIn) return { block: false, why: '' };
  if (hasPc !== true) return { block: false, why: '' };
  return { block: true, why: 'You are signed in and this account already has Pholama on a PC, so this device does not download models. Chat through your PC instead (Models > Connect to my PC).' };
}

// Remember the answer for a while so a tap does not wait on the network. true/false/null (null = could not find out).
const KEY = 'pholama.hasPc';
export function readCached(store, userId, now = Date.now(), maxAgeMs = 10 * 60 * 1000) {
  try { const o = JSON.parse(store.getItem(KEY) || 'null'); if (o && o.u === userId && now - o.t < maxAgeMs && typeof o.v === 'boolean') return o.v; } catch {}
  return null;
}
export function writeCached(store, userId, v, now = Date.now()) { try { if (typeof v === 'boolean') store.setItem(KEY, JSON.stringify({ u: userId, v, t: now })); } catch {} }
export function clearCached(store) { try { store.removeItem(KEY); } catch {} }
