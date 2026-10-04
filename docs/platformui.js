// Pholama Platform screen. Posts, names and bios come from other people, so every piece of text is set with
// textContent. Nothing from the network is ever put into innerHTML.
import { makePlatform, REACTIONS, timeLeft, friendly, MAX_POST, MAX_BIO, MAX_NAME } from './platform.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (label, fn, cls) => { const b = el('button', cls || '', label); b.type = 'button'; b.onclick = fn; return b; };

function avatar(url, name) {
  const w = el('span', 'pavatar');
  if (url && /^https:\/\//.test(url)) { const i = document.createElement('img'); i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = url; i.onerror = () => { i.remove(); w.textContent = (name || '?').slice(0, 1).toUpperCase(); }; w.append(i); }
  else w.textContent = (name || '?').slice(0, 1).toUpperCase();
  return w;
}

export async function mountPlatform(host, ctx) {
  const { Account } = ctx; host.textContent = '';
  const root = el('div', 'platwrap'); host.append(root);
  const head = el('div', 'plathead'); head.append(el('h2', null, 'Pholama Platform'), el('p', 'dmut', 'Share tips with other people. Every post disappears after 3 hours.'));
  root.append(head);

  if (!Account.user()) {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Log in to join'), el('p', 'dmut', 'Use Discord or GitHub. You pick your own Platform name and picture.'), btn('Log in', ctx.login, 'p'));
    root.append(c); return;
  }
  const P = makePlatform(Account, ctx.cfg);
  P.sweep();                                   // removes posts older than 3 hours
  let prof = null, community = 'general', mod = false;
  const body = el('div'); root.append(body);
  const msg = el('div', 'err-t'); root.append(msg);
  const say = t => { msg.textContent = t || ''; };

  async function load() {
    try { prof = await P.profile(); mod = await P.isMod(); } catch (e) { body.textContent = ''; body.append(el('p', 'dmut', friendly(e))); return; }
    ctx.onProfile && ctx.onProfile(prof && prof.platform_name);
    body.textContent = '';
    if (!prof) return body.append(setupCard());
    if (prof.banned) return body.append(el('p', 'dmut', 'This account can no longer post on the Platform.'));
    body.append(profileCard(), await recentCard(), communityBar(), composer(), (feedBox = el('div', 'platfeed')));
    await paintFeed();
  }
  let feedBox = null;

  function setupCard() {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Choose your Platform name'), el('p', 'dmut', 'This is the name other people see. It is not your Discord or GitHub name or email.'));
    const inp = el('input'); inp.maxLength = MAX_NAME; inp.placeholder = 'Platform name'; inp.setAttribute('aria-label', 'Platform name');
    const err = el('div', 'err-t');
    c.append(inp, btn('Create profile', async () => { err.textContent = ''; try { await P.saveProfile({ name: inp.value, bio: '' }); await load(); } catch (e) { err.textContent = friendly(e); } }, 'p'), err);
    return c;
  }

  function profileCard() {
    const c = el('section', 'dcard plprof');
    const top = el('div', 'plrow'); top.append(avatar(avatarUrl(prof), prof.platform_name));
    const who = el('div'); who.append(el('b', null, prof.platform_name), el('div', 'dmut', prof.bio || 'No bio yet.')); top.append(who); c.append(top);
    const det = el('details', 'infrel'); det.append(el('summary', null, 'Edit my profile'));
    const name = el('input'); name.maxLength = MAX_NAME; name.value = prof.platform_name; name.setAttribute('aria-label', 'Platform name');
    const bio = el('textarea'); bio.maxLength = MAX_BIO; bio.rows = 2; bio.value = prof.bio || ''; bio.placeholder = 'A short bio'; bio.setAttribute('aria-label', 'Bio');
    const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.setAttribute('aria-label', 'Profile picture');
    const err = el('div', 'err-t');
    det.append(name, bio, el('small', 'dmut', 'Picture: PNG, JPG or WebP, under 256 KB.'), file,
      btn('Save', async () => { err.textContent = ''; try { await P.saveProfile({ name: name.value, bio: bio.value }); if (file.files[0]) await P.setAvatar(file.files[0]); await load(); } catch (e) { err.textContent = friendly(e); } }, 'p'), err);
    c.append(det); return c;
  }
  const avatarUrl = p => p && p.avatar_path ? ((ctx.cfg().SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1/object/public/pholama-avatars/' + p.avatar_path + '?v=' + encodeURIComponent(p.updated_at || '')) : '';

  async function recentCard() {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Your last local AIs'));
    let list = []; try { list = await P.recentAis(); } catch {}
    if (!list.length) c.append(el('p', 'dmut', 'Open the Pholama PC app while logged in and the models you downloaded appear here. Only their names are shared.'));
    else { const u = el('ul', 'dlist'); for (const m of list) { const li = el('li'); li.append(el('b', null, m.model)); u.append(li); } c.append(u); }
    return c;
  }

  let communities = [];
  function communityBar() {
    const bar = el('div', 'platcom'); bar.setAttribute('role', 'tablist');
    P.communities().then(l => { communities = l; bar.textContent = ''; for (const c of l) { const b = btn(c.title, async () => { community = c.slug; for (const x of bar.children) x.classList.toggle('on', x === b); await paintFeed(); }, 'elf' + (c.slug === community ? ' on' : '')); b.title = c.about; b.setAttribute('role', 'tab'); bar.append(b); } }).catch(e => { bar.textContent = friendly(e); });
    return bar;
  }

  function composer() {
    const c = el('section', 'dcard'); const ta = el('textarea'); ta.maxLength = MAX_POST; ta.rows = 3; ta.placeholder = 'Share something with the community'; ta.setAttribute('aria-label', 'New post');
    const count = el('small', 'dmut', '0/' + MAX_POST); ta.oninput = () => { count.textContent = ta.value.length + '/' + MAX_POST; };
    const err = el('div', 'err-t');
    const go = btn('Post', async () => { err.textContent = ''; go.disabled = true; try { await P.post(community, ta.value); ta.value = ''; count.textContent = '0/' + MAX_POST; await paintFeed(); } catch (e) { err.textContent = friendly(e); } go.disabled = false; }, 'p');
    c.append(ta, count, go, el('small', 'dmut', ' Posts vanish after 3 hours. No links or secret keys.'), err); return c;
  }

  async function paintFeed() {
    if (!feedBox) return; say('');
    let posts = []; try { posts = await P.feed(community); } catch (e) { feedBox.textContent = ''; feedBox.append(el('p', 'dmut', friendly(e))); return; }
    feedBox.textContent = '';
    if (!posts.length) return feedBox.append(el('p', 'dmut', 'No posts yet. Be the first.'));
    for (const p of posts) feedBox.append(postCard(p));
  }

  function postCard(p) {
    const c = el('article', 'dcard plpost'); if (p.hidden) c.classList.add('plhid');
    const top = el('div', 'plrow'); top.append(avatar(p.avatar, p.author)); const who = el('div'); who.append(el('b', null, p.author), el('small', 'dmut', '  ' + timeLeft(p.expires_at))); top.append(who); c.append(top);
    c.append(el('p', 'plbody', p.body));
    if (p.hidden) c.append(el('small', 'dmut', 'Hidden by moderation. Only you and moderators can see this.'));
    const rx = el('div', 'plrx');
    for (const [kind, label] of REACTIONS) {
      const r = p.reactions[kind]; const b = btn(label + (r.n ? ' ' + r.n : ''), async () => { try { await P.react(p.id, kind, !r.mine); await paintFeed(); } catch (e) { say(friendly(e)); } }, 'elf' + (r.mine ? ' on' : ''));
      b.setAttribute('aria-pressed', String(r.mine)); rx.append(b);
    }
    c.append(rx);
    const acts = el('div', 'plrow');
    if (p.user_id === Account.user().id || mod) acts.append(btn('Delete', async () => { if (!confirm('Delete this post?')) return; try { await P.deletePost(p.id); await paintFeed(); } catch (e) { say(friendly(e)); } }));
    if (p.user_id !== Account.user().id) acts.append(btn('Report', async () => { try { await P.report(p.id, 'other'); say('Thanks. A moderator will look. Three reports hide a post.'); } catch (e) { say(/duplicate|unique/i.test(String(e.message)) ? 'You already reported this post.' : friendly(e)); } }));
    if (mod) {
      acts.append(btn(p.hidden ? 'Unhide' : 'Hide', async () => { try { await P.modHide(p.id, !p.hidden); await paintFeed(); } catch (e) { say(friendly(e)); } }));
      if (p.user_id !== Account.user().id) acts.append(btn('Ban user', async () => { if (!confirm('Ban ' + p.author + ' and delete their posts?')) return; try { await P.modBan(p.user_id, true); await paintFeed(); } catch (e) { say(friendly(e)); } }));
    }
    c.append(acts); return c;
  }

  await load();
}
