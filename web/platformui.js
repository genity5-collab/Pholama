// Pholama Platform screen. Posts, names and bios come from other people, so every piece of text is set with
// textContent. Nothing from the network is ever put into innerHTML.
import { TICKET_CATEGORIES, MAX_TICKET_SUBJECT, MAX_TICKET_BODY, ticketProblem, ticketStatusText, rewardText, makePlatform, REACTIONS, timeLeft, friendly, banText, MAX_POST, MAX_BIO, MAX_NAME, MAX_PROJ_IMAGES, MAX_REPLY } from './platform.js';
import { openBig, whenText } from './bigchat.js';
import { attachPicker, mediaView, lazyMedia, installMediaStyles } from './mediaui.js';
import { isVideoPath } from './social.js';
import { mountFriends } from './friendsui.js';
import { mountBell, createCalls, mountSocialSettings } from './callui.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (label, fn, cls) => { const b = el('button', cls || '', label); b.type = 'button'; b.onclick = fn; return b; };

function avatar(url, name) {
  const w = el('span', 'pavatar');
  if (url && /^https:\/\//.test(url)) { const i = document.createElement('img'); i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = url; i.onerror = () => { i.remove(); w.textContent = (name || '?').slice(0, 1).toUpperCase(); }; w.append(i); }
  else w.textContent = (name || '?').slice(0, 1).toUpperCase();
  return w;
}

export async function mountPlatform(host, ctx) {
  const { Account } = ctx; host.textContent = ''; installMediaStyles();
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
  // A stored file as something to look at: kind 'post'/'build' are public, 'ticket' is private (signed address).
  const showFile = (kind, path, alt) => path ? lazyMedia(() => P.mediaSrc(kind, path), { video: isVideoPath(path), alt }) : null;
  const body = el('div'); root.append(body);
  const msg = el('div', 'err-t'); root.append(msg);
  const say = t => { msg.textContent = t || ''; };

  async function load() {
    try { prof = await P.profile(); mod = await P.isMod(); } catch (e) { body.textContent = ''; body.append(el('p', 'dmut', friendly(e))); return; }
    ctx.onProfile && ctx.onProfile(prof && prof.platform_name);
    collectCredits();
    body.textContent = '';
    if (!prof) return body.append(setupCard());
    const ban = banText(prof); if (ban) { const c = el('section', 'dcard'); c.append(el('h3', null, 'You cannot post right now'), el('p', 'dmut', ban)); body.append(c); }
    const tabs = el('div', 'platnav'); tabs.setAttribute('role', 'tablist');
    const pane = el('div', 'platpane');
    const defs = [['home', 'Home', paintHome], ['posts', 'Posts', paintPosts], ['projects', 'Projects', paintProjects], ['friends', 'Friends', paintFriends], ['privacy', 'Privacy', paintPrivacy], ['rules', 'Rules', paintRules], ['support', 'Support', paintSupport]];
    if (mod) defs.push(['mod', 'Moderator', paintMod]);
    const show = async id => { for (const b of tabs.children) { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); } pane.textContent = ''; say(''); const d = defs.find(x => x[0] === id); try { await d[2](pane); } catch (e) { pane.append(el('p', 'dmut', friendly(e))); } };
    for (const [id, label] of defs) { const b = btn(label, () => show(id), 'elf'); b.dataset.id = id; b.setAttribute('role', 'tab'); tabs.append(b); }
    body.append(tabs, pane); go = show; startSocial(); await show(tab0);
  }
  let go = null, tab0 = 'home';

  // ----- friends, private chat, calls, notifications -----
  let calls = null, bellApi = null, friendUnread = 0;
  function startSocial() {
    if (calls) return;
    try {
      calls = createCalls({ Account, cfg: ctx.cfg, getFriendName: id => id }); calls.watchIncoming();
      const bellHost = el('div', 'plbell'); head.append(bellHost);
      bellApi = mountBell(bellHost, { Account, cfg: ctx.cfg, onOpenChat: () => go('friends'), onOpenFriends: () => go('friends') });
    } catch (e) { /* the social tables may not exist yet; the Friends tab explains it */ }
  }
  async function paintFriends(pane) {
    startSocial();
    const h = el('div'); pane.append(h);
    await mountFriends(h, { Account, cfg: ctx.cfg, onUnread: n => { friendUnread = n; }, startCall: f => { if (calls) calls.start(f); } });
  }
  async function paintPrivacy(pane) {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Friends and privacy'), el('p', 'dmut', 'You choose who can reach you. Everything here is saved to your account.')); pane.append(c);
    const h = el('div'); c.append(h);
    await mountSocialSettings(h, { Account, cfg: ctx.cfg });
  }

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
    const ai = el('section', 'dcard'); ai.append(el('h3', null, 'Pholama assistant'), el('p', 'dmut', 'Chat on the website is Agent Max, the cloud assistant: nothing to download. For local models, tools, programming languages, web search and Roblox Studio, use the PC app.'));
    const a = el('a', 'btnlink', 'Get the PC app'); a.href = 'https://github.com/genity5-collab/Pholama#on-your-pc-more-power-tools-web-search'; a.target = '_blank'; a.rel = 'noopener'; ai.append(a); grid.append(ai);
    pane.append(grid, profileCard());
  }

  async function paintPosts(pane) { pane.append(communityBar(), composer(), (feedBox = el('div', 'platfeed'))); await paintFeed(); }

  // ----- credits waiting (report rewards + moderator gifts) are collected when the Platform opens -----
  async function collectCredits() {
    const n = await P.waitingCredits(); if (!(n > 0)) return;
    if (ctx.addCredits) { try { const got = await P.claimCredits(); if (got > 0) await ctx.addCredits(got); say(rewardText(got)); } catch {} }
    else say('You have ' + n + ' integration credits waiting. Open the PC app or the site while signed in to collect them.');
  }

  // ----- one ticket conversation. Moderators get reply / close / reopen; everyone else can only add a note while it is open -----
  function thread(t, isModView, after) {
    const box = el('div', 'tkt'); const list = el('div'); box.append(list);
    async function paint() {
      const m = await P.ticketMessages(t.id).catch(() => []); list.textContent = '';
      for (const x of m) { const b = el('div', 'tmsg' + (x.from_mod ? ' tmod' : '')); b.append(el('b', null, x.from_mod ? 'Moderator' : 'Member'), el('span', 'dmut', ' ' + new Date(x.created_at).toLocaleString()), el('p', 'plbody', x.body)); { const f = showFile('ticket', x.media_path, 'Attachment'); if (f) b.append(f); } list.append(b); }
    }
    const ta = el('textarea'); ta.maxLength = MAX_TICKET_BODY; ta.rows = 3; ta.setAttribute('aria-label', isModView ? 'Reply as moderator' : 'Add a note');
    ta.placeholder = isModView ? 'Reply to this member...' : 'Add a note for the moderators...';
    const row = el('div', 'dact');
    const send = btn(isModView ? 'Reply' : 'Send note', async () => { const v = ta.value.trim(); if (!v) return; send.disabled = true; try { await P.say(t.id, v); ta.value = ''; await paint(); after && after(); } catch (e) { say(friendly(e)); } send.disabled = false; }, 'p');
    row.append(send);
    if (isModView) row.append(btn(t.status === 'closed' ? 'Reopen' : 'Close ticket', async () => { try { await P.closeTicket(t.id, t.status !== 'closed'); after && after(); } catch (e) { say(friendly(e)); } }));
    if (t.status !== 'closed' || isModView) box.append(ta, row); else box.append(el('p', 'dmut', 'This ticket is closed. Open a new one if you still need help.'));
    paint(); return box;
  }

  // ----- the big window for one ticket: the reporter and the moderators chat here, it refreshes by itself -----
  function openTicketBig(t, isModView, after) {
    let status = t.status;
    const mkHeader = () => {
      const h = el('div'); h.append(el('small', 'dmut', (t.category || '') + ' - ' + ticketStatusText(status) + ' - opened ' + whenText(t.created_at)));
      if (isModView) {
        const tools = el('div', 'dact'); const idc = el('code', null, t.user_id); idc.title = 'Member id';
        const n = el('input'); n.type = 'number'; n.min = 1; n.max = 500; n.placeholder = 'Credits (1-500)'; n.setAttribute('aria-label', 'Credits to give'); n.style.maxWidth = '150px';
        const act = (label, fn) => btn(label, async () => { try { win.note(''); const r = await fn(); win.note(r); } catch (e) { win.note(friendly(e)); } });
        tools.append(act('Unban', async () => { await P.modBan(t.user_id, false); return 'Unbanned.'; }), act('Remove newest warning', async () => String(await P.modCmd('unwarn ' + t.user_id))), n,
          act('Give credits', async () => { const v = Math.floor(+n.value); if (!(v >= 1 && v <= 500)) throw new Error('Give between 1 and 500 credits.'); await P.modCmd('give ' + t.user_id + ' ' + v + ' ticket ' + t.id.slice(0, 8)); n.value = ''; return v + ' credits given.'; }));
        h.append(el('small', 'dmut', 'Member id: '), idc, tools);
      }
      return h;
    };
    const win = openBig({
      title: t.subject, subtitle: ticketStatusText(status), header: mkHeader(), maxLen: MAX_TICKET_BODY, every: 4000, attach: true,
      placeholder: isModView ? 'Reply to this member...' : 'Write a note for the moderators...', emptyText: 'No messages yet.',
      canSend: status !== 'closed' || isModView, closedText: 'This ticket is closed. Open a new one if you still need help.',
      load: async () => (await P.ticketMessages(t.id)).map(x => ({ id: x.id, who: x.from_mod ? 'Moderator' : (isModView ? 'Member' : 'You'), mine: isModView ? !!x.from_mod : !x.from_mod, badge: x.from_mod ? 'Moderator' : '', when: whenText(x.created_at), text: x.body, media: x.media_path ? { get: () => P.mediaSrc('ticket', x.media_path), video: isVideoPath(x.media_path) } : null })),
      send: async (v, f) => { await P.say(t.id, v, f); after && after(); },
      actions: isModView ? [{ label: status === 'closed' ? 'Reopen' : 'Close ticket', run: async api => { await P.closeTicket(t.id, status !== 'closed'); after && after(); api.close(); } }] : [],
      onClose: () => after && after(),
    });
    return win;
  }

  // ----- the big window for one post: the post on top, everyone chats underneath -----
  function openPostBig(p) {
    const head = el('div'); const top = el('div', 'plrow'); top.append(avatar(p.avatar, p.author)); const who = el('div'); who.append(el('b', null, p.author), el('small', 'dmut', '  ' + timeLeft(p.expires_at))); top.append(who);
    head.append(top); if (p.body) head.append(el('p', 'plbody', p.body)); { const f = showFile('post', p.media_path, 'Picture or video from ' + p.author); if (f) head.append(f); } head.append(el('small', 'dmut', 'Replies disappear with the post.'));
    const open_ = { v: null };
    const win = openBig({
      title: 'Post by ' + p.author, subtitle: timeLeft(p.expires_at), header: head, maxLen: MAX_REPLY, every: 4000, attach: true,
      placeholder: 'Reply to ' + p.author + '. Enter sends.', emptyText: 'No replies yet. Start the chat.',
      load: async () => (await P.replies(p.id)).filter(r => !r.hidden || r.user_id === Account.user().id || mod).map(r => ({ id: r.id, who: r.user_id === Account.user().id ? 'You' : r.author, mine: r.user_id === Account.user().id, badge: r.user_id === p.user_id ? 'Author' : '', when: whenText(r.created_at), text: r.body, media: r.media_path ? { get: () => P.mediaSrc('post', r.media_path), video: isVideoPath(r.media_path) } : null })),
      send: async (v, f) => { await P.reply(p.id, v, f); },
      actions: [],
    });
    open_.v = win; return win;
  }

  async function paintSupport(pane) {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Contact support'), el('p', 'dmut', 'Open a ticket and a moderator will answer here. Only moderators can reply. You can have 3 open at once.'));
    const subj = el('input'); subj.maxLength = MAX_TICKET_SUBJECT; subj.placeholder = 'Short title'; subj.setAttribute('aria-label', 'Ticket title');
    const cat = el('select'); cat.setAttribute('aria-label', 'Ticket topic'); for (const [v, l] of TICKET_CATEGORIES) { const o = el('option', null, l); o.value = v; cat.append(o); }
    const txt = el('textarea'); txt.maxLength = MAX_TICKET_BODY; txt.rows = 4; txt.placeholder = 'What do you need help with?'; txt.setAttribute('aria-label', 'Ticket message');
    let tfile = null; const tpick = attachPicker({ accept: 'both', onChange: f => { tfile = f; }, onError: m => say(m) });
    const go1 = btn('Open ticket', async () => { const bad = ticketProblem(subj.value, txt.value); if (bad && !(tfile && !txt.value.trim() && !/title/i.test(bad))) return say(bad); go1.disabled = true; try { await P.openTicket(subj.value.trim(), cat.value, txt.value.trim(), tfile); subj.value = ''; txt.value = ''; tpick.clear(); tfile = null; say('Ticket opened. A moderator will reply here.'); await list(); } catch (e) { say(friendly(e)); } go1.disabled = false; }, 'p');
    c.append(subj, cat, txt, tpick.node, el('small', 'dmut', 'A screenshot or short video helps. Only you and moderators can see it.'), go1); pane.append(c);
    const lc = el('section', 'dcard'); lc.append(el('h3', null, 'Your tickets')); const box = el('div'); lc.append(box); pane.append(lc);
    async function list() {
      const ts = await P.myTickets().catch(() => []); box.textContent = '';
      if (!ts.length) return box.append(el('p', 'dmut', 'No tickets yet.'));
      for (const t of ts) {
        const d = el('details', 'tk'); const sm = el('summary'); sm.append(el('b', null, t.subject), el('span', 'dmut', '  ' + ticketStatusText(t.status))); d.append(sm);
        let built = false; d.ontoggle = () => { if (d.open && !built) { built = true; d.append(btn('Open big window', () => openTicketBig(t, false, list), 'p openbig'), thread(t, false, list)); } }; box.append(d);
      }
    }
    await list();
  }

  // ----- moderator inbox: every open ticket, with quick actions on the member -----
  async function inbox(pane) {
    const c = el('section', 'dcard'); c.append(el('h3', null, 'Support inbox'), el('p', 'dmut', 'Open tickets. Reply, close, give credits, unwarn or unban without typing commands.'));
    const sel = el('select'); sel.setAttribute('aria-label', 'Which tickets'); for (const [v, l] of [['', 'Open and answered'], ['open', 'Waiting for a reply'], ['closed', 'Closed']]) { const o = el('option', null, l); o.value = v; sel.append(o); }
    const box = el('div'); c.append(sel, box); pane.append(c);
    async function list() {
      const ts = await P.allTickets(sel.value).catch(() => []); box.textContent = '';
      if (!ts.length) return box.append(el('p', 'dmut', 'Nothing here. Nice.'));
      for (const t of ts) {
        const d = el('details', 'tk'); const sm = el('summary'); sm.append(el('b', null, t.subject), el('span', 'dmut', '  ' + t.category + ' - ' + ticketStatusText(t.status) + ' - ' + new Date(t.updated_at).toLocaleString())); d.append(sm);
        let built = false;
        d.ontoggle = () => {
          if (!d.open || built) return; built = true;
          const tools = el('div', 'dact'); const id = el('code', null, t.user_id); id.title = 'Member id';
          const n = el('input'); n.type = 'number'; n.min = 1; n.max = 500; n.placeholder = 'Credits (1-500)'; n.setAttribute('aria-label', 'Credits to give');
          const act = (label, fn) => btn(label, async () => { try { say(await fn()); } catch (e) { say(friendly(e)); } });
          tools.append(act('Unban', async () => { await P.modBan(t.user_id, false); return 'Unbanned.'; }), act('Remove newest warning', async () => String(await P.modCmd('unwarn ' + t.user_id)))
            , n, act('Give credits', async () => { const v = Math.floor(+n.value); if (!(v >= 1 && v <= 500)) throw new Error('Give between 1 and 500 credits.'); await P.modCmd('give ' + t.user_id + ' ' + v + ' ticket ' + t.id.slice(0, 8)); n.value = ''; return v + ' credits given.'; }));
          d.append(btn('Open big window', () => openTicketBig(t, true, list), 'p openbig'), el('small', 'dmut', ' Member id: '), id, tools, thread(t, true, list));
        };
        box.append(d);
      }
    }
    sel.onchange = list; await list();
  }

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
    const err = el('div', 'err-t'); let vfile = null;
    const vpick = attachPicker({ accept: 'both', onChange: f => { if (f && !/^video\//.test(f.type)) { err.textContent = 'The build video must be an MP4 or WebM video. Use the images box for pictures.'; vpick.clear(); vfile = null; return; } vfile = f; }, onError: m => { err.textContent = m; } });
    const add = btn('Publish project', async () => { err.textContent = ''; add.disabled = true; try { await P.addProject({ title: t.value, blurb: b.value, files: f.files, video: vfile }); await go('projects'); } catch (e) { err.textContent = friendly(e); } add.disabled = false; }, 'p');
    form.append(t, b, f, el('small', 'dmut', 'Optional: one video of your build (MP4 or WebM, under 25 MB).'), vpick.node, add, err); pane.append(form);
    const list = await P.projects(); const grid = el('div', 'plproj'); pane.append(grid);
    if (!list.length) grid.append(el('p', 'dmut', 'No projects yet. Be the first to show one.'));
    for (const p of list) {
      const c = el('article', 'dcard plpost' + (p.hidden ? ' plhid' : '')); c.append(el('h3', null, p.title), el('small', 'dmut', 'by ' + p.author));
      if (p.images.length) { const g = el('div', 'plimgs'); for (const u of p.images) { if (!/^https:\/\//.test(u)) continue; const i = document.createElement('img'); i.alt = p.title + ' screenshot'; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = u; g.append(i); } c.append(g); }
      { const v = showFile('build', p.video_path, p.title + ' video'); if (v) c.append(v); }
      c.append(el('p', 'plbody', p.blurb)); if (p.hidden) c.append(el('small', 'dmut', 'Hidden by moderation.'));
      const acts = el('div', 'plrow');
      if (p.user_id === Account.user().id) acts.append(btn('Delete', async () => { if (!confirm('Delete this project?')) return; try { await P.deleteProject(p.id); await go('projects'); } catch (e) { say(friendly(e)); } }));
      if (mod) acts.append(btn(p.hidden ? 'Show' : 'Hide', async () => { try { await P.modProject(p.id, !p.hidden); await go('projects'); } catch (e) { say(friendly(e)); } }));
      c.append(acts); grid.append(c);
    }
  }

  async function paintMod(pane) {
    await inbox(pane);
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
    let file = null; const pick = attachPicker({ accept: 'both', onChange: f => { file = f; }, onError: m => { err.textContent = m; } });
    const go = btn('Post', async () => { err.textContent = ''; go.disabled = true; try { await P.post(community, ta.value, file); ta.value = ''; count.textContent = '0/' + MAX_POST; pick.clear(); file = null; await paintFeed(); } catch (e) { err.textContent = friendly(e); } go.disabled = false; }, 'p');
    c.append(ta, count, pick.node, go, el('small', 'dmut', ' Posts vanish after 3 hours. No links or secret keys. Pictures and videos are fine.'), err); return c;
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
    if (p.body) c.append(el('p', 'plbody', p.body)); { const f = showFile('post', p.media_path, 'Picture or video from ' + p.author); if (f) c.append(f); }
    if (p.hidden) c.append(el('small', 'dmut', 'Hidden by moderation. Only you and moderators can see this.')); if (p.edited_by_mod) c.append(el('small', 'dmut', ' Edited by a moderator.'));
    const rx = el('div', 'plrx');
    for (const [kind, label] of REACTIONS) {
      const r = p.reactions[kind]; const b = btn(label + (r.n ? ' ' + r.n : ''), async () => { try { await P.react(p.id, kind, !r.mine); await paintFeed(); } catch (e) { say(friendly(e)); } }, 'elf' + (r.mine ? ' on' : ''));
      b.setAttribute('aria-pressed', String(r.mine)); rx.append(b);
    }
    c.append(rx);
    const acts = el('div', 'plrow');
    acts.append(btn('Open and chat', () => openPostBig(p), 'p openbig'));
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
