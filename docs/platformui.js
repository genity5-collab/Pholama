// Pholama Platform screen. Posts, names and bios come from other people, so every piece of text is set with
// textContent. Nothing from the network is ever put into innerHTML.
import { makePlatform, REACTIONS, timeLeft, friendly, banText, MAX_POST, MAX_BIO, MAX_NAME, MAX_PROJ_IMAGES } from './platform.js';

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
    const ban = banText(prof); if (ban) { const c = el('section', 'dcard'); c.append(el('h3', null, 'You cannot post right now'), el('p', 'dmut', ban)); body.append(c); }
    const tabs = el('div', 'platnav'); tabs.setAttribute('role', 'tablist');
    const pane = el('div', 'platpane');
    const defs = [['home', 'Home', paintHome], ['posts', 'Posts', paintPosts], ['projects', 'Projects', paintProjects], ['rules', 'Rules', paintRules]];
    if (mod) defs.push(['mod', 'Moderator', paintMod]);
    const show = async id => { for (const b of tabs.children) { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); } pane.textContent = ''; say(''); const d = defs.find(x => x[0] === id); try { await d[2](pane); } catch (e) { pane.append(el('p', 'dmut', friendly(e))); } };
    for (const [id, label] of defs) { const b = btn(label, () => show(id), 'elf'); b.dataset.id = id; b.setAttribute('role', 'tab'); tabs.append(b); }
    body.append(tabs, pane); go = show; await show(tab0);
  }
  let go = null, tab0 = 'home';

  async function paintHome(pane) {
    const grid = el('div', 'dgrid');
    const d = await P.daily().catch(() => null);
    const dc = el('section', 'dcard'); dc.append(el('h3', null, 'Daily post'));
    if (d) dc.append(el('b', null, d.title), el('p', 'plbody', d.body), el('small', 'dmut', d.day)); else dc.append(el('p', 'dmut', 'No daily post yet today. Moderators post one each day.'));
    grid.append(dc);
    const w = await P.warnings().catch(() => []); const fresh = w.filter(x => !x.seen);
    if (w.length) { const wc = el('section', 'dcard plwarn'); wc.append(el('h3', null, fresh.length ? 'You have a warning' : 'Past warnings')); for (const x of w.slice(0, 3)) wc.append(el('p', 'plbody', x.reason)); if (fresh.length) wc.append(btn('I understand', async () => { try { await P.markWarningsSeen(); await go('home'); } catch (e) { say(friendly(e)); } }, 'p')); grid.append(wc); }
    const quick = el('section', 'dcard'); quick.append(el('h3', null, 'Quick links'));
    const row = el('div', 'dact'); row.append(btn('Write a post', () => go('posts'), 'p'), btn('Show a project', () => go('projects')), btn('Read the rules', () => go('rules'))); quick.append(row); grid.append(quick);
    const ai = el('section', 'dcard'); ai.append(el('h3', null, 'Pholama assistant'), el('p', 'dmut', 'The website keeps one small assistant (Qwen2.5 0.5B). It only chats: no tools, no files. For chat with bigger models, tools, web search and Roblox Studio, use the PC app.'));
    const a = el('a', 'btnlink', 'Get the PC app'); a.href = 'https://github.com/genity5-collab/Pholama#on-your-pc-more-power-tools-web-search'; a.target = '_blank'; a.rel = 'noopener'; ai.append(a); grid.append(ai);
    pane.append(grid, profileCard(), await recentCard());
  }

  async function paintPosts(pane) { pane.append(communityBar(), composer(), (feedBox = el('div', 'platfeed'))); await paintFeed(); }

  async function paintRules(pane) {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Community rules'));
    const rules = await P.rules().catch(() => []); if (!rules.length) c.append(el('p', 'dmut', 'Rules are not set up yet.'));
    const ol = el('ol', 'dbul'); for (const r of rules) { const li = el('li'); li.append(el('b', null, r.title + '. '), document.createTextNode(r.body)); ol.append(li); } c.append(ol);
    c.append(el('p', 'dmut', 'Posts disappear after 3 hours. Moderators can warn, edit, hide and remove posts, and ban people who break the rules.')); pane.append(c);
  }

  async function paintProjects(pane) {
    const form = el('section', 'dcard'); form.append(el('h3', null, 'Advertise your project'), el('p', 'dmut', 'Show what you made. Add up to ' + MAX_PROJ_IMAGES + ' images (PNG, JPG or WebP, under 256 KB each). Projects stay up until you delete them.'));
    const t = el('input'); t.maxLength = 60; t.placeholder = 'Project title'; t.setAttribute('aria-label', 'Project title');
    const b = el('textarea'); b.maxLength = 400; b.rows = 3; b.placeholder = 'What is it? Why is it cool?'; b.setAttribute('aria-label', 'Project description');
    const f = el('input'); f.type = 'file'; f.multiple = true; f.accept = 'image/png,image/jpeg,image/webp'; f.setAttribute('aria-label', 'Project images');
    const err = el('div', 'err-t'); const add = btn('Publish project', async () => { err.textContent = ''; add.disabled = true; try { await P.addProject({ title: t.value, blurb: b.value, files: f.files }); await go('projects'); } catch (e) { err.textContent = friendly(e); } add.disabled = false; }, 'p');
    form.append(t, b, f, add, err); pane.append(form);
    const list = await P.projects(); const grid = el('div', 'plproj'); pane.append(grid);
    if (!list.length) grid.append(el('p', 'dmut', 'No projects yet. Be the first to show one.'));
    for (const p of list) {
      const c = el('article', 'dcard plpost' + (p.hidden ? ' plhid' : '')); c.append(el('h3', null, p.title), el('small', 'dmut', 'by ' + p.author));
      if (p.images.length) { const g = el('div', 'plimgs'); for (const u of p.images) { if (!/^https:\/\//.test(u)) continue; const i = document.createElement('img'); i.alt = p.title + ' screenshot'; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = u; g.append(i); } c.append(g); }
      c.append(el('p', 'plbody', p.blurb)); if (p.hidden) c.append(el('small', 'dmut', 'Hidden by moderation.'));
      const acts = el('div', 'plrow');
      if (p.user_id === Account.user().id) acts.append(btn('Delete', async () => { if (!confirm('Delete this project?')) return; try { await P.deleteProject(p.id); await go('projects'); } catch (e) { say(friendly(e)); } }));
      if (mod) acts.append(btn(p.hidden ? 'Show' : 'Hide', async () => { try { await P.modProject(p.id, !p.hidden); await go('projects'); } catch (e) { say(friendly(e)); } }));
      c.append(acts); grid.append(c);
    }
  }

  async function paintMod(pane) {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Moderator console'), el('p', 'dmut', 'Type help to see every command. Each one is checked by the database, so only moderators can use it.'));
    const inp = el('input'); inp.placeholder = 'ban Zed 24 spamming'; inp.setAttribute('aria-label', 'Moderator command'); inp.maxLength = 700; inp.autocomplete = 'off'; inp.spellcheck = false;
    const out = el('pre', 'cmdcode'); out.textContent = 'Ready.';
    const run = btn('Run', async () => { run.disabled = true; try { out.textContent = String(await P.modCmd(inp.value)); inp.value = ''; await logBox(); } catch (e) { out.textContent = friendly(e); } run.disabled = false; }, 'p');
    inp.onkeydown = e => { if (e.key === 'Enter') run.click(); };
    c.append(inp, run, out); pane.append(c);
    const lg = el('section', 'dcard'); lg.append(el('h3', null, 'Recent moderator actions')); const box = el('div'); lg.append(box); pane.append(lg);
    async function logBox() { const l = await P.modLog().catch(() => []); box.textContent = ''; if (!l.length) box.append(el('p', 'dmut', 'Nothing yet.')); for (const x of l) box.append(el('div', 'dmut', new Date(x.created_at).toLocaleString() + '  ' + x.action + (x.detail ? ': ' + x.detail : ''))); }
    await logBox();
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
    if (p.hidden) c.append(el('small', 'dmut', 'Hidden by moderation. Only you and moderators can see this.')); if (p.edited_by_mod) c.append(el('small', 'dmut', ' Edited by a moderator.'));
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
      acts.append(btn('Edit', async () => { const t = prompt('Edit this post (it will be marked as edited by a moderator):', p.body); if (t == null) return; try { await P.modEdit(p.id, t); await paintFeed(); } catch (e) { say(friendly(e)); } }));
      acts.append(btn('Remove', async () => { if (!confirm('Permanently remove this post?')) return; try { await P.modRemove(p.id); await paintFeed(); } catch (e) { say(friendly(e)); } }));
      if (p.user_id !== Account.user().id) {
        acts.append(btn('Warn', async () => { const r = prompt('Warning for ' + p.author + ':'); if (!r) return; try { await P.modWarn(p.user_id, r); say('Warning sent.'); } catch (e) { say(friendly(e)); } }));
        acts.append(btn('Ban', async () => { const r = prompt('Reason for banning ' + p.author + ':'); if (r == null) return; const h = prompt('Hours (leave empty for permanent):', '24'); try { await P.modBan(p.user_id, true, r, h ? parseInt(h, 10) || null : null); await paintFeed(); } catch (e) { say(friendly(e)); } }));
        acts.append(btn('Copy user id', async () => { try { await navigator.clipboard.writeText(p.user_id); say('User id copied.'); } catch { say('User id: ' + p.user_id); } }));
      }
    }
    c.append(acts); return c;
  }

  await load();
}
