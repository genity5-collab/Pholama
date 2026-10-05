// Agent Max as a built-in friend (website only). Pure logic + a tiny data layer, so it can be tested on its own.
// Agent Max is NOT in the friends table. It is drawn at the top of the list by the page, so it can never be removed,
// blocked, reported or counted against the friend limit. The database counts the daily messages (5 free, 10 with Pro).

export const MAX_FRIEND = Object.freeze({ id: 'agent-max', name: 'Agent Max', other: 'agent-max', builtin: true });
const FN = 'https://lyra-09dfabbf.base44.app/functions/pholamaCloud';
export const MAX_LEN = 500;

// What is wrong with a message before it is sent, or '' when it is fine. (The database checks again.)
export function maxProblem(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return 'Type a message first.';
  if (t.length > MAX_LEN) return 'Keep it under ' + MAX_LEN + ' characters.';
  return '';
}

// A calm sentence for anything that goes wrong. Never model names, never raw server text.
export function maxFriendly(err) {
  const m = String((err && err.message) || err || '');
  if (/Log in|login|expired/i.test(m)) return 'Log in to chat with Agent Max.';
  if (/secret key/i.test(m)) return 'That looks like a secret key, so it was not sent.';
  if (/500 characters/i.test(m)) return 'Keep it under ' + MAX_LEN + ' characters.';
  if (/Type a message/i.test(m)) return 'Type a message first.';
  if (/cannot do that/i.test(m)) return 'You cannot do that right now.';
  return 'Agent Max is not available right now. Try again in a minute.';
}

// "3 of 5 left today" / "No messages left today. They come back at midnight UTC."
export function leftLine(info) {
  if (!info || typeof info.left !== 'number') return '';
  if (info.left <= 0) return 'No messages left today. They come back at midnight UTC.' + (info.cap < 10 ? ' Pholama Pro gives you more.' : '');
  return info.left + ' of ' + info.cap + ' messages left today.';
}

// Turn stored rows into what the chat draws. Oldest first.
export function toBubbles(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => a.id - b.id)
    .map(r => ({ id: r.id, mine: r.role === 'user', text: String(r.body || ''), at: r.created_at }));
}

// The data layer. `Account` is the page's logged-in account (rest() + token), the same one the friends screen uses.
export function makeMaxFriend(Account, fetchFn) {
  const rpc = (name, args) => Account.rest('rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) });
  const doFetch = fetchFn || ((...a) => fetch(...a));
  return {
    left: () => rpc('pholama_max_chat_left'),
    history: async () => toBubbles(await Account.rest('pholama_max_chat?select=id,role,body,created_at&order=id.desc&limit=60')),
    clear: () => Account.rest('pholama_max_chat?user_id=eq.' + encodeURIComponent(Account.user().id), { method: 'DELETE' }),
    // 1) the database counts and stores the message  2) the cloud function reads it back and writes the reply
    async send(text) {
      const bad = maxProblem(text); if (bad) throw new Error(bad);
      const sent = await rpc('pholama_max_chat_send', { p_body: String(text).trim() });
      if (!sent || sent.ok === false) return { ok: false, info: sent };
      const tok = Account.token && Account.token();
      let r;
      try { r = await doFetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ friend: true }) }); }
      catch (e) { return { ok: true, answered: false, info: sent }; }
      const j = await r.json().catch(() => ({}));
      return { ok: true, answered: r.ok && !!j.reply, reply: j.reply || '', info: sent };
    },
  };
}
