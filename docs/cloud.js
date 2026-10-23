// Pholama cloud model + think effort + who may use what. Pure logic, no page code, so it can be tested on its own.
const FN = 'https://lyra-09dfabbf.base44.app/functions/pholamaCloud';

// Think effort: how long and careful the answer is. On Pholama Cloud every message counts as 1 whatever the effort.
// On your own models nothing is ever charged.
export const EFFORT = {
  normal: { label: 'Normal', hint: 'Quick, short answers.' },
  long:   { label: 'Long',   hint: 'Fuller, more careful answers.' },
  max:    { label: 'Max',    hint: 'Deepest reasoning and the most thorough answers.' },
};
import { agentName } from './agentname.js';
export const MAX_NAME = agentName(), MAX_DAY = 10, MAX_MONTH = 30;   // no fixed product name: the member's chosen name, or a random one
// Free.ai self-hosted choices. The server validates this list again; the browser never sends a provider key.
export const CLOUD_MODELS = [
  { id: 'qwen7b', label: 'Qwen 7B', cost: 5, hint: 'Fast and economical' },
  { id: 'mistral', label: 'Mistral', cost: 15, hint: 'Better answers, higher credit cost' },
  { id: 'qwen-coder', label: 'Qwen Coder', cost: 5, hint: 'Best for Studio: writes Lua and models' },
];
// Studio writes code, so it uses the coder model unless the person picked another cloud model on purpose.
export const studioModelId = () => {
  try { const id = localStorage.getItem('pholama.cloudModel'); return id && CLOUD_MODELS.some(m => m.id === id) ? id : 'qwen-coder'; } catch { return 'qwen-coder'; }
};
export const cloudModelId = () => {
  try { const id = localStorage.getItem('pholama.cloudModel'); return CLOUD_MODELS.some(m => m.id === id) ? id : CLOUD_MODELS[0].id; } catch { return CLOUD_MODELS[0].id; }
};
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
export const GATE_MESSAGE = 'Sign in with Discord to chat and download models. It is free and takes one tap.';

// ---- credit balance ----
// Free and instant: the server answers with the credits left and never calls a model or charges anything.
export async function cloudStatus(token) {
  if (!token) return null;
  try {
    const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ status: true }) });
    const j = await r.json(); return r.ok && j && j.day_used != null ? j : null;
  } catch { return null; }
}

// ---- cloud chat ----
// Returns { reply, tools:[{name,input,output}], day_used, day_cap, month_used, month_cap }.
// Throws Error with .code = login | limit-day | limit-month | server | setup | network (and .info with the counts).
export async function cloudChat(messages, effort, token, signal, model = cloudModelId()) {
  let r;
  try {
    r = await fetch(FN, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ messages: messages.slice(-12), effort: cleanEffort(effort), model }) });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    const err = new Error('Could not reach the cloud model. Check your connection.'); err.code = 'network'; throw err;
  }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const err = new Error(j.error || 'The cloud model had a problem.'); err.code = j.code || 'server'; err.info = j; throw err; }
  return j;
}
