// Pholama Platform: profile, communities, posts (3 hour life), reactions, reports, recent local AIs.
// This file only TALKS to Supabase. The database rules in supabase/platform.sql are what actually enforce
// the limits, so a changed page cannot keep a post alive, skip a filter or ban-dodge.
export const LIFETIME_MS = 3 * 60 * 60 * 1000;
export const REACTIONS = [['like', 'Like'], ['love', 'Love'], ['laugh', 'Haha'], ['wow', 'Wow'], ['fire', 'Fire']];
export const MAX_POST = 500, MAX_NAME = 30, MIN_NAME = 2, MAX_BIO = 160, MAX_AVATAR = 262144;
const KINDS = REACTIONS.map(r => r[0]);

// ---------- pure helpers (tested without a browser) ----------
export function cleanPlatformName(n) { return String(n || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME); }
export function nameProblem(n) { const c = cleanPlatformName(n); if (c.length < MIN_NAME) return 'Pick a name with at least ' + MIN_NAME + ' characters.'; return ''; }
export function postProblem(t) { const c = String(t || '').trim(); if (!c) return 'Write something first.'; if (c.length > MAX_POST) return 'Posts can be up to ' + MAX_POST + ' characters.'; return ''; }
export function timeLeft(expiresAt, now = Date.now()) {
  const ms = new Date(expiresAt).getTime() - now; if (!(ms > 0)) return 'expired';
  const m = Math.ceil(ms / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm left' : m + 'm left';
}
export function isLive(post, now = Date.now()) { return !!post && new Date(post.expires_at).getTime() > now && !post.hidden; }
// Groups raw reaction rows into { kind: { n, mine } } for one post.
export function tally(rows, me) {
  const out = {}; for (const k of KINDS) out[k] = { n: 0, mine: false };
  for (const r of rows || []) { if (!out[r.kind]) continue; out[r.kind].n++; if (me && r.user_id === me) out[r.kind].mine = true; }
  return out;
}
export function avatarPathFor(uid, mime) { const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime]; return ext ? uid + '/avatar.' + ext : ''; }
export function avatarProblem(file) {
  if (!file) return 'Choose a picture.';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'Use a PNG, JPG or WebP picture.';
  if (file.size > MAX_AVATAR) return 'Picture must be under 256 KB. Try a smaller one.';
  return '';
}
export function friendly(e) {
  const m = String((e && (e.message || e.error_description || e.msg)) || e || '');
  if (/duplicate key|already exists|unique/i.test(m)) return 'That platform name is taken. Pick another.';
  if (/Links are not allowed|secret key|community rules|Slow down|limit of 20|Moderators only/i.test(m)) return m.replace(/^.*?(Links are|That looks|That message|Slow down|You have reached|Moderators)/, '$1');
  if (/row-level security|violates row/i.test(m)) return 'Not allowed. You may be banned, or need a platform name first.';
  if (/relation .* does not exist|404/i.test(m)) return 'The Platform is not set up yet. The owner needs to run the setup SQL.';
  return m || 'Something went wrong.';
}
export function publicAvatarUrl(base, path) { return path ? String(base).replace(/\/+$/, '') + '/storage/v1/object/public/pholama-avatars/' + path : ''; }

// The site keeps ONE small assistant. It only chats: no tools, files or web search. Bigger models live in the PC app.
// `owned` = model ids already downloaded here, `wanted` = the one being asked for. Returns '' when allowed, otherwise the reason.
export function assistantRule(owned, wanted) {
  const have = (owned || []).filter(Boolean);
  if (have.includes(wanted)) return '';
  if (have.length >= 1) return 'The site keeps one small assistant. Delete the one you have to switch, or get the PC app for more models.';
  return '';
}

// ---------- data layer (needs an Account with a rest() helper) ----------
export function makePlatform(Account, cfg) {
  const base = () => cfg().SUPABASE_URL;
  const me = () => { const u = Account.user(); return u ? u.id : ''; };
  return {
    async sweep() { try { await Account.rest('rpc/pholama_sweep', { method: 'POST', body: '{}' }); } catch {} },
    async profile(uid = me()) { if (!uid) return null; const r = await Account.rest('pholama_profiles?select=*&user_id=eq.' + encodeURIComponent(uid) + '&limit=1'); return r && r[0] || null; },
    async saveProfile({ name, bio }) {
      const n = cleanPlatformName(name), bad = nameProblem(n); if (bad) throw new Error(bad);
      const row = { user_id: me(), platform_name: n, bio: String(bio || '').slice(0, MAX_BIO) };
      await Account.rest('pholama_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
      return row;
    },
    async setAvatar(file) {
      const bad = avatarProblem(file); if (bad) throw new Error(bad);
      const path = avatarPathFor(me(), file.type);
      const r = await Account.storage(path, file);   // throws on failure
      await Account.rest('pholama_profiles?user_id=eq.' + encodeURIComponent(me()), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ avatar_path: path }) });
      return path;
    },
    communities: async () => (await Account.rest('pholama_communities?select=*&order=title.asc')) || [],
    async feed(community) {
      const posts = (await Account.rest('pholama_posts?select=id,user_id,community,body,created_at,expires_at,hidden&community=eq.' + encodeURIComponent(community) + '&order=created_at.desc&limit=50')) || [];
      const live = posts.filter(p => isLive(p) || p.user_id === me());
      if (!live.length) return [];
      const ids = live.map(p => p.id).join(','), uids = [...new Set(live.map(p => p.user_id))].join(',');
      const [rx, pr] = await Promise.all([
        Account.rest('pholama_reactions?select=post_id,user_id,kind&post_id=in.(' + ids + ')').catch(() => []),
        Account.rest('pholama_profiles?select=user_id,platform_name,avatar_path&user_id=in.(' + uids + ')').catch(() => []),
      ]);
      const who = new Map((pr || []).map(p => [p.user_id, p]));
      return live.map(p => ({ ...p, author: (who.get(p.user_id) || {}).platform_name || 'Someone', avatar: publicAvatarUrl(base(), (who.get(p.user_id) || {}).avatar_path), reactions: tally((rx || []).filter(r => r.post_id === p.id), me()) }));
    },
    async post(community, body) {
      const bad = postProblem(body); if (bad) throw new Error(bad);
      await Account.rest('pholama_posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: me(), community, body: String(body).trim() }) });
    },
    deletePost: id => Account.rest('pholama_posts?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }),
    async react(postId, kind, on) {
      if (!KINDS.includes(kind)) throw new Error('Unknown reaction.');
      if (on) await Account.rest('pholama_reactions', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ post_id: postId, user_id: me(), kind }) });
      else await Account.rest('pholama_reactions?post_id=eq.' + encodeURIComponent(postId) + '&user_id=eq.' + encodeURIComponent(me()) + '&kind=eq.' + kind, { method: 'DELETE' });
    },
    report: (postId, reason = 'other') => Account.rest('pholama_reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ post_id: postId, reporter: me(), reason: ['spam', 'abuse', 'unsafe', 'other'].includes(reason) ? reason : 'other' }) }),
    async isMod() { try { const r = await Account.rest('pholama_moderators?select=user_id&limit=1'); return !!(r && r.length); } catch { return false; } },
    modHide: (id, hidden) => Account.rest('rpc/pholama_mod_hide', { method: 'POST', body: JSON.stringify({ p_post: id, p_hidden: !!hidden }) }),
    modBan: (uid, banned) => Account.rest('rpc/pholama_mod_ban', { method: 'POST', body: JSON.stringify({ p_user: uid, p_banned: !!banned }) }),
    async recentAis() { return (await Account.rest('pholama_recent_ais?select=model,seen_at&order=seen_at.desc&limit=12')) || []; },
  };
}
