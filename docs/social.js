// Pholama Platform: friends, private chat, calls, notifications and pictures/videos.
// This file only TALKS to Supabase. The database rules in supabase/social.sql and supabase/media.sql are what actually
// enforce who can do what, so a changed page cannot read someone's messages, ring a friend who turned calls off, or attach a link.

// ---------- pure helpers (tested without a browser) ----------
export const MAX_DM = 500;
export const MAX_IMAGE = 5 * 1024 * 1024, MAX_VIDEO = 25 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
export const KINDS = ['post', 'build', 'ticket', 'dm'];
// Which bucket a kind of file goes in. Private messages and tickets are private; posts and builds are public.
export const bucketFor = kind => (kind === 'dm' || kind === 'ticket' ? 'pholama-private' : 'pholama-media');
export const isVideoType = t => VIDEO_TYPES.includes(t);
export const isVideoPath = p => /\.(mp4|webm)$/i.test(String(p || ''));

// null when the file is fine, otherwise a plain sentence for the person.
export function mediaProblem(file) {
  if (!file) return 'Choose a picture or video.';
  if (!EXT[file.type]) return 'Use a PNG, JPG, WebP or GIF picture, or an MP4 or WebM video.';
  if (isVideoType(file.type) && file.size > MAX_VIDEO) return 'Videos must be under 25 MB. Try a shorter one.';
  if (!isVideoType(file.type) && file.size > MAX_IMAGE) return 'Pictures must be under 5 MB. Try a smaller one.';
  if (!(file.size > 0)) return 'That file is empty.';
  return '';
}
// <owner id>/<kind>/<random id>.<ext>. The person never picks the name, so they cannot aim at someone else's file.
export function mediaPathFor(uid, kind, mime, rand) {
  const ext = EXT[mime]; if (!ext || !KINDS.includes(kind)) return '';
  const id = String(rand || '').replace(/[^0-9a-f-]/g, '').slice(0, 36); if (id.length < 8) return '';
  return uid + '/' + kind + '/' + id + '.' + ext;
}
export function mediaUrl(base, kind, path) {
  if (!path) return '';
  const b = String(base).replace(/\/+$/, '');
  return bucketFor(kind) === 'pholama-media' ? b + '/storage/v1/object/public/pholama-media/' + path : '';   // private files need a signed address, see signedUrl()
}
export function dmProblem(text, hasMedia) {
  const c = String(text || '').trim();
  if (!c && !hasMedia) return 'Write something or attach a picture or video.';
  if (c.length > MAX_DM) return 'Messages can be up to ' + MAX_DM + ' characters.';
  return '';
}
// A friend-list row -> what the page shows.
export function relation(row) {
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friend';
  if (row.status === 'blocked') return 'blocked';
  return row.i_asked ? 'sent' : 'received';
}
export function sortFriends(rows) {
  return [...(rows || [])].sort((a, b) => (b.unread > 0) - (a.unread > 0) || String(b.last_at || '').localeCompare(String(a.last_at || '')) || String(a.name).localeCompare(String(b.name)));
}
export function unreadTotal(rows) { return (rows || []).reduce((n, r) => n + (r.status === 'accepted' ? (+r.unread || 0) : 0), 0); }
export function notificationText(n) {
  const who = n && n.info ? n.info : 'Someone';
  switch (n && n.kind) {
    case 'friend_request': return who + ' wants to be your friend.';
    case 'friend_accepted': return who + ' accepted your friend request.';
    case 'message': return 'New message from ' + who + '.';
    case 'missed_call': return 'Missed call from ' + who + '.';
    default: return 'New notification.';
  }
}
export function callStatusText(s) { return ({ ringing: 'Ringing...', answered: 'Connected', declined: 'Declined', missed: 'No answer', ended: 'Call ended', cancelled: 'Cancelled' }[s] || s); }
export function formatClock(sec) { const s = Math.max(0, Math.floor(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

export const DEFAULT_PREFS = { allow_requests: true, allow_dms: true, allow_calls: true, notify: true };
export function cleanPrefs(p) { const o = { ...DEFAULT_PREFS }; for (const k of Object.keys(o)) if (p && typeof p[k] === 'boolean') o[k] = p[k]; return o; }

export function socialFriendly(e) {
  const m = String((e && (e.message || e.error_description || e.msg)) || e || '');
  if (/relation .* does not exist|function .* does not exist|Could not find the function|404/i.test(m)) return 'Friends and chat are not set up yet. The owner needs to run the setup SQL.';
  if (/Links are not allowed|secret key|community rules|Slow down|No one can be added|calls turned off|only call your friends|another call|cannot do that|Log in first|limit of 200|uploading it here/i.test(m)) return m.replace(/^.*?(Links are|That looks|That message|Slow down|No one|This friend|You can only|Your friend|You cannot|Log in|You have reached|Attach|Send a picture)/, '$1');
  if (/row-level security|violates row/i.test(m)) return 'Not allowed. You may need to be friends first, or they turned messages off.';
  if (/Payload too large|exceeded the maximum|413/i.test(m)) return 'That file is too big.';
  if (/mime type|not supported|invalid_mime/i.test(m)) return 'That file type is not allowed.';
  return m || 'Something went wrong.';
}

// ---------- data layer (needs an Account with rest() and a token) ----------
export function makeSocial(Account, cfg) {
  const base = () => cfg().SUPABASE_URL;
  const me = () => { const u = Account.user(); return u ? u.id : ''; };
  const rpc = (name, args) => Account.rest('rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) });
  const rand = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + '0000000000000000'));
  return {
    // --- friends ---
    list: async () => (await rpc('pholama_my_social')) || [],
    request: name => rpc('pholama_friend_request', { p_name: String(name || '').trim() }),
    answer: (id, accept) => rpc('pholama_friend_answer', { p_id: id, p_accept: !!accept }),
    remove: uid => rpc('pholama_friend_remove', { p_other: uid }),
    block: uid => rpc('pholama_block', { p_other: uid }),
    unblock: uid => rpc('pholama_unblock', { p_other: uid }),
    // --- my switches ---
    async prefs() { const r = await Account.rest('pholama_social_prefs?select=*&user_id=eq.' + encodeURIComponent(me()) + '&limit=1').catch(() => []); return cleanPrefs(r && r[0]); },
    savePrefs: p => Account.rest('pholama_social_prefs?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: me(), ...cleanPrefs(p), updated_at: new Date().toISOString() }) }),
    // --- private messages ---
    async messages(other, limit = 60) {
      const o = encodeURIComponent(other), u = encodeURIComponent(me());
      const rows = (await Account.rest('pholama_dms?select=id,sender,receiver,body,media_path,created_at,read_at&or=(and(sender.eq.' + u + ',receiver.eq.' + o + '),and(sender.eq.' + o + ',receiver.eq.' + u + '))&order=id.desc&limit=' + limit)) || [];
      return rows.reverse();
    },
    async send(other, text, file) {
      const bad = dmProblem(text, !!file); if (bad) throw new Error(bad);
      let media = null;
      if (file) { const e = mediaProblem(file); if (e) throw new Error(e); media = mediaPathFor(me(), 'dm', file.type, rand()); await Account.storageTo('pholama-private', media, file); }
      await Account.rest('pholama_dms', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ sender: me(), receiver: other, body: String(text || '').trim(), media_path: media }) });
    },
    markRead: other => rpc('pholama_dm_read', { p_other: other }),
    deleteMessage: id => Account.rest('pholama_dms?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }),
    // --- pictures and videos ---
    async upload(kind, file) {
      const e = mediaProblem(file); if (e) throw new Error(e);
      const path = mediaPathFor(me(), kind, file.type, rand()); if (!path) throw new Error('That file cannot be used here.');
      await Account.storageTo(bucketFor(kind), path, file);
      return path;
    },
    publicUrl: (kind, path) => mediaUrl(base(), kind, path),
    signedUrl: path => Account.signedUrl('pholama-private', path),
    // --- notifications ---
    async notifications() { return (await Account.rest('pholama_notifications?select=*&order=id.desc&limit=30')) || []; },
    markNotificationsSeen: () => Account.rest('pholama_notifications?user_id=eq.' + encodeURIComponent(me()) + '&seen=eq.false', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ seen: true }) }),
    clearNotifications: () => Account.rest('pholama_notifications?user_id=eq.' + encodeURIComponent(me()), { method: 'DELETE' }),
    // --- calls (the browsers do the sound themselves; these only carry the ringing and connection details) ---
    callStart: (other, offer) => rpc('pholama_call_start', { p_callee: other, p_offer: offer }),
    callAnswer: (id, answer) => rpc('pholama_call_answer', { p_call: id, p_answer: answer }),
    callIce: (id, ice) => rpc('pholama_call_ice', { p_call: id, p_ice: ice }),
    callEnd: id => rpc('pholama_call_end', { p_call: id }),
    callTimeout: id => rpc('pholama_call_timeout', { p_call: id }),
    async call(id) { const r = await Account.rest('pholama_calls?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1'); return r && r[0] || null; },
    async ringingForMe() { const r = await Account.rest('pholama_calls?select=*&callee=eq.' + encodeURIComponent(me()) + '&status=eq.ringing&created_at=gt.' + encodeURIComponent(new Date(Date.now() - 60000).toISOString()) + '&order=created_at.desc&limit=1'); return r && r[0] || null; },
    sweep: () => rpc('pholama_dm_sweep').catch(() => {}),
  };
}
