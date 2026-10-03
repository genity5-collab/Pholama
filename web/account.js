// Pholama account + memory. Talks to Supabase over plain REST (no library).
// The anon key is public by design. Row-level security makes sure each person only sees their own rows.
const C = () => window.PHOLAMA || {};
const KEY = 'pholama.session';
let session = null;

const base = () => C().SUPABASE_URL;
// People sign in with a NAME and a password. Supabase Auth wants an email-shaped id, so the name becomes a private address that never receives mail.
export function cleanName(n) { return String(n || '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 30); }
export function nameToId(n) {
  const c = cleanName(n).toLowerCase();
  let hex = ''; for (const b of new TextEncoder().encode(c)) hex += b.toString(16).padStart(2, '0');
  return 'u' + hex + '@pholama.app'; // hex keeps spaces, accents and emoji safe inside an address
}
const hdr = (tok) => ({ apikey: C().SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (tok || C().SUPABASE_ANON_KEY) });

function save(s) { session = s; if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); }
function niceError(j, fallback) {
  const m = String((j && (j.msg || j.message || j.error_description || j.error)) || fallback || 'Something went wrong');
  if (/already registered|already exists/i.test(m)) return 'That name is taken. Pick another, or log in if it is yours.';
  if (/invalid login|invalid credentials/i.test(m)) return 'Wrong name or password.';
  if (/password.*(at least|short|weak)|weak_password/i.test(m)) return 'Password must be at least 8 characters.';
  if (/valid email|email_address_invalid|invalid.*email|unable to validate email|invalid format/i.test(m)) return 'That name has characters we cannot use. Try letters and numbers.';
  if (/rate limit|too many|over_request/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  return m;
}

// ----- Discord sign-in (Supabase OAuth, implicit flow: tokens come back in the URL #hash) -----
// Discord is free. Its account must have a verified email, which is what stops people farming accounts.
// Builds the address that sends the person to Discord. `returnTo` must be allow-listed in Supabase.
export function oauthUrl(supabaseUrl, returnTo) {
  return String(supabaseUrl).replace(/\/+$/, '') + '/auth/v1/authorize?provider=discord&prompt=consent&redirect_to=' + encodeURIComponent(returnTo);
}
// Where to come back to: this exact page, without any old query or hash.
export function returnAddress(loc) { return loc.origin + loc.pathname; }
// Reads a sign-in result out of the address hash. Returns null when the hash holds no sign-in.
export function parseAuthHash(hash) {
  const h = String(hash || '').replace(/^#/, ''); if (!h) return null;
  const p = new URLSearchParams(h);
  if (p.get('error') || p.get('error_description')) return { error: (p.get('error_description') || p.get('error')).replace(/\+/g, ' ') };
  const access = p.get('access_token'); if (!access) return null;
  const exp = +p.get('expires_at') || (Math.floor(Date.now() / 1000) + (+p.get('expires_in') || 3600));
  return { access_token: access, refresh_token: p.get('refresh_token') || '', expires_at: exp, token_type: p.get('token_type') || 'bearer' };
}
// A display name taken from the Discord profile; never the email address.
export function oauthName(user) {
  const m = (user && user.user_metadata) || {};
  const n = cleanName(m.custom_claims && m.custom_claims.global_name || m.full_name || m.name || m.preferred_username || '');
  return n || 'Friend';
}

export const Account = {
  configured: () => !!(C().SUPABASE_URL && C().SUPABASE_ANON_KEY),
  user: () => (session && session.user) || null,
  token: () => (session && session.access_token) || null,   // sent to the cloud model so it knows who is asking
  name: () => { const u = session && session.user; if (!u) return ''; const m = u.user_metadata || {}; return m.name || (u.app_metadata && u.app_metadata.provider === 'discord' ? oauthName(u) : (m.full_name || '')); },
  isDiscord: () => !!(session && session.user && session.user.app_metadata && session.user.app_metadata.provider === 'discord'),

  async load() {
    try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
    if (!session) return null;
    if (session.expires_at && session.expires_at * 1000 - Date.now() < 60000) await this.refresh();
    return this.user();
  },
  async refresh() {
    if (!session || !session.refresh_token) return save(null);
    try {
      const r = await fetch(base() + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: hdr(), body: JSON.stringify({ refresh_token: session.refresh_token }) });
      const j = await r.json(); if (!r.ok || !j.access_token) return save(null); save(j);
    } catch { /* offline: keep the old session, requests will fail politely */ }
  },
  async signup(name, password) {
    name = cleanName(name); if (name.length < 2) throw new Error('Pick a name with at least 2 characters.');
    const r = await fetch(base() + '/auth/v1/signup', { method: 'POST', headers: hdr(), body: JSON.stringify({ email: nameToId(name), password, data: { name } }) });
    const j = await r.json();
    if (!r.ok) throw new Error(niceError(j, 'Could not create the account'));
    if (!j.access_token) throw new Error('Could not sign you in right after creating the account. Try logging in.');
    save(j); return this.user();
  },
  async login(name, password) {
    name = cleanName(name); if (!name) throw new Error('Type your name.');
    const r = await fetch(base() + '/auth/v1/token?grant_type=password', { method: 'POST', headers: hdr(), body: JSON.stringify({ email: nameToId(name), password }) });
    const j = await r.json();
    if (!r.ok) throw new Error(niceError(j, 'Could not log in'));
    save(j); return this.user();
  },
  // Sends the person to Discord. They come back to this same page with a sign-in in the address hash.
  startLogin() { location.href = oauthUrl(base(), returnAddress(location)); },
  // Call on page load. If the address holds a Discord result, verify it with Supabase, save the session, and clean the address bar.
  async finishLogin() {
    const r = parseAuthHash(location.hash); if (!r) return null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}   // tokens must not stay in the address bar / history
    if (r.error) throw new Error(/access_denied|denied|cancel/i.test(r.error) ? 'Discord sign-in was cancelled.' : 'Discord sign-in failed: ' + r.error);
    const who = await fetch(base() + '/auth/v1/user', { headers: hdr(r.access_token) });   // never trust a token we have not verified
    const user = await who.json().catch(() => null);
    if (!who.ok || !user || !user.id) throw new Error('Discord sign-in could not be verified. Try again.');
    if (!user.email || !(user.email_confirmed_at || user.confirmed_at)) throw new Error('That Discord account has no verified email. Verify it in Discord first, then try again.');
    save({ ...r, user }); return this.user();
  },
  logout() { save(null); },

  // ----- authenticated REST helper (refreshes an expiring token once) -----
  async rest(path, opts = {}) {
    if (!session) throw new Error('Log in first');
    if (session.expires_at && session.expires_at * 1000 - Date.now() < 30000) await this.refresh();
    if (!session) throw new Error('Your login expired. Log in again.');
    const r = await fetch(base() + '/rest/v1/' + path, { ...opts, headers: { ...hdr(session.access_token), ...(opts.headers || {}) } });
    if (r.status === 401) { await this.refresh(); if (!session) throw new Error('Your login expired. Log in again.'); }
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
    if (!r.ok) throw new Error(niceError(j, 'Request failed (' + r.status + ')'));
    return j;
  },

  // ----- memory setting (on/off) -----
  async memoryOn() {
    try { const r = await this.rest('pholama_settings?select=memory_on&limit=1'); return !!(r && r[0] && r[0].memory_on); } catch { return false; }
  },
  async setMemory(on) {
    const u = this.user(); if (!u) throw new Error('Log in first');
    await this.rest('pholama_settings?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u.id, memory_on: !!on, updated_at: new Date().toISOString() }) });
  },

  // ----- memories -----
  async list() { return (await this.rest('pholama_memories?select=id,content,created_at&order=created_at.desc&limit=200')) || []; },
  async remember(text) {
    const u = this.user(); if (!u) throw new Error('Log in first');
    text = String(text || '').trim().slice(0, 500); if (!text) throw new Error('Nothing to remember');
    const r = await this.rest('pholama_memories', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ user_id: u.id, content: text }) });
    return r && r[0];
  },
  async forget(id) { await this.rest('pholama_memories?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }); },
  async forgetAll() { const u = this.user(); await this.rest('pholama_memories?user_id=eq.' + encodeURIComponent(u.id), { method: 'DELETE' }); },
};
