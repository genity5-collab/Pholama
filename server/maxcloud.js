// Agent Max as the "brain" inside Studio. Max lives in the cloud and answers in text; the Studio tool loop on this PC does the file work.
// Each call is one cloud message (it counts against the Max daily and monthly allowance, which the cloud enforces).
// To keep one Studio message from draining the allowance, a single message may make at most MAX_CALLS cloud calls.
// Pure logic + one fetch. The URL and token handling are injectable so it is tested without the internet.
const FN = process.env.PHOLAMA_CLOUD_URL || 'https://lyra-09dfabbf.base44.app/functions/pholamaCloud';
const MAX_CALLS = 8;

function limitError(j, status) {
  const code = (j && j.code) || '';
  const e = new Error(code === 'login' ? 'Sign in to use Agent Max in Studio.' : code === 'limit-day' ? 'Agent Max reached its daily limit.' : code === 'limit-month' ? 'Agent Max reached its monthly limit.' : ((j && j.error) || 'Agent Max had a problem (HTTP ' + status + ').'));
  e.code = code || 'server'; e.limit = code === 'limit-day' || code === 'limit-month'; if (e.limit) e.which = code === 'limit-day' ? 'day' : 'month'; return e;
}

// A per-message counter so the cap is for ONE Studio message, not forever.
// The last 12 messages, but the instructions (system message) are ALWAYS kept. A long Studio job has many tool rounds; cutting to the last 12
// used to drop the rules and the tool list, and Max then forgot it could edit files.
function keepRules(messages) {
  const list = Array.isArray(messages) ? messages : [], sys = list.find(m => m && m.role === 'system');
  const rest = list.filter(m => m !== sys).slice(-12);
  return sys ? [sys, ...rest] : rest;
}
function newBudget(max) { return { used: 0, max: max || MAX_CALLS }; }

// localTools: does this PC have a local AI that can run tools? The cloud then counts a daily cap of 1 instead of 10, exactly like the chat page does.
// It must be the REAL answer: always sending true made Studio see a cap of 1 while the page showed 2 of 10 used.
async function streamMax(token, messages, options, onToken, signal, usage, budget, localTools) {
  token = String(token || '').trim();
  if (!token) throw limitError({ code: 'login' }, 401);
  if (budget) { if (budget.used >= budget.max) { const e = new Error('Agent Max used its ' + budget.max + ' steps for this message. Ask again to continue.'); e.code = 'steps'; e.limit = false; throw e; } budget.used++; }
  let r;
  try { r = await fetch(FN, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ messages: keepRules(messages), effort: 'normal', localTools: localTools === true, studio: true }) }); }
  catch (e) { if (e && e.name === 'AbortError') throw e; const er = new Error('Could not reach Agent Max. Check your connection.'); er.code = 'network'; throw er; }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw limitError(j, r.status);
  const text = String(j.reply || ''); if (text) onToken(text);   // the cloud answers in one piece (not streamed)
  if (usage) usage.got = false;                                   // Max tokens are the cloud's, not this PC's
  // The cloud says how much of the day and month is used. Keep it so the page counter moves in Studio too (it used to be thrown away here).
  if (usage && j && j.day_used != null) usage.max = { day_used: Number(j.day_used), day_cap: Number(j.day_cap), month_used: Number(j.month_used), month_cap: Number(j.month_cap) };
  return text;
}
module.exports = { streamMax, newBudget, limitError, keepRules, MAX_CALLS, FN };
