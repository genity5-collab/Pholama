// When Agent Max cannot answer, the PC answers with the user's own installed model instead.
// Always on, no switch: it costs no credits and only ever works on the user's own PC (never on the website).
// Pure decision logic, no page code, so it can be tested on its own.

// Why Max could not answer. Only these reasons may fall back; a login problem or the user pressing Stop must not.
export function fallbackReason(err) {
  if (!err || err.name === 'AbortError') return null;
  switch (err.code) {
    case 'limit-day': return 'Max\u2019s daily limit is used up';
    case 'limit-month': return 'Max\u2019s monthly limit is used up';
    case 'network': return 'Max could not be reached';
    case 'server': case 'setup': return 'Max had a problem';
    default: return null;        // login, unknown: never silently switch models
  }
}

// Only a model installed on the PC is ever used, never a phone model and never a cloud one.
export function pickFallbackModel(models, preferred) {
  const list = (models || []).filter(n => typeof n === 'string' && n && !/^(web|cpu|cloud):/.test(n));
  if (preferred && list.includes(preferred)) return preferred;
  return list[0] || '';
}

// Everything the page needs to decide. `isPc` means this page is served by the user's own PC app.
export function planFallback({ err, isPc, models, isCloud, preferred }) {
  if (!isCloud) return { use: false };
  const reason = fallbackReason(err); if (!reason) return { use: false };
  if (!isPc) return { use: false };                       // the website never falls back; it just shows Max's message
  const model = pickFallbackModel(models, preferred);
  if (!model) return { use: false, why: `${reason}. Download a model in Models and your PC will answer instead.` };
  return { use: true, model, reason };
}
