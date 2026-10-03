// Pholama cloud model + think effort + who may use what. Pure logic, no page code, so it can be tested on its own.
const FN = 'https://lyra-09dfabbf.base44.app/functions/pholamaCloud';

// Think effort: how long and careful the answer is. On Agent Max every message counts as 1 whatever the effort.
// On your own models nothing is ever charged.
export const EFFORT = {
  normal: { label: 'Normal', hint: 'Quick, short answers.' },
  long:   { label: 'Long',   hint: 'Fuller, more careful answers.' },
  max:    { label: 'Max',    hint: 'Deepest reasoning and the most thorough answers.' },
};
export const MAX_NAME = 'Agent Max', MAX_DAY = 10, MAX_MONTH = 30;
export const effortKeys = () => Object.keys(EFFORT);
export const cleanEffort = e => (EFFORT[e] ? e : 'normal');

// What to add to a LOCAL model's instructions for a given effort. Normal adds nothing (so normal is exactly as before).
export function effortPrompt(e) {
  if (e === 'long') return 'Take a little more care: give a fuller, well organised answer.';
  if (e === 'max') return 'Reason carefully step by step, double check your work, then give a thorough answer.';
  return '';
}
// Local models also get more room to answer at higher effort.
export const effortTokens = (base, e) => (e === 'max' ? Math.round(base * 2) : e === 'long' ? Math.round(base * 1.5) : base);

// ---- the sign-in rule: you must have an account to use ANY model, or to download one ----
export const CLOUD_ID = 'cloud:pholama';
export function mayUse(user) { return !!user; }
export function mayDownload(user) { return !!user; }
export const GATE_MESSAGE = 'Create a free account to chat and download models. It only takes a name and a password.';

// ---- cloud chat ----
// Returns { reply, tools:[{name,input,output}], day_used, day_cap, month_used, month_cap }.
// Throws Error with .code = login | limit-day | limit-month | server | setup | network (and .info with the counts).
export async function cloudChat(messages, effort, token, signal) {
  let r;
  try {
    r = await fetch(FN, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ messages: messages.slice(-12), effort: cleanEffort(effort) }) });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    const err = new Error('Could not reach the cloud model. Check your connection.'); err.code = 'network'; throw err;
  }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const err = new Error(j.error || 'The cloud model had a problem.'); err.code = j.code || 'server'; err.info = j; throw err; }
  return j;
}
