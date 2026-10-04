// How many memories a person may keep. The website has a small limit (5) because it is the light helper;
// the PC app has more room (15). Pure logic so it is tested in test/core.test.js.
export const LIMIT_SITE = 5, LIMIT_PC = 15;
export const limitFor = isPcApp => (isPcApp ? LIMIT_PC : LIMIT_SITE);

// Can one more be saved? Returns { ok, left, limit, message }.
export function canSave(count, isPcApp) {
  const limit = limitFor(isPcApp), n = Math.max(0, +count || 0), left = Math.max(0, limit - n);
  if (n >= limit) return { ok: false, left: 0, limit, message: `Memory is full (${n} of ${limit}). Forget one in Account first, then try again.` + (isPcApp ? '' : ' The PC app keeps up to ' + LIMIT_PC + '.') };
  return { ok: true, left: left - 1, limit, message: '' };
}
export const usedText = (count, isPcApp) => `${Math.max(0, +count || 0)} of ${limitFor(isPcApp)} memories used`;
