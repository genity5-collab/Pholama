// Studio connectors: an Ollama-style grid of tools, grouped by what they are for.
// Pure data + small helpers (no network here except the one Discord check), so it is easy to test.
//
// RetroStudio is a connector you unlock by being in the Pholama Discord server. The check uses the person's OWN Discord sign-in
// (Discord's "guilds" permission lists the servers they are in), so no bot and no secret is needed. The server id below is public.

export const PHOLAMA_GUILD_ID = '1556650031375982803';

// group -> cards. `needs` says what a card needs before Connect works.
//   'discord' = being in the Pholama Discord server; 'pc' = a connected Pholama PC; '' = nothing (works in the browser).
export const GROUPS = [
  { id: 'roblox', label: 'Roblox', items: [
    { id: 'retrostudio', name: 'RetroStudio', mark: 'RS', blurb: 'Preview Luau, build models, encode to RetroStudio blocks', needs: 'discord', opens: 'retro' },
    { id: 'robloxdocs', name: 'Roblox docs', mark: 'Rb', blurb: 'Look up the Roblox API while you build', needs: '' },
  ] },
  { id: 'code', label: 'Code', items: [
    { id: 'github', name: 'GitHub', mark: 'GH', blurb: 'Read and write repositories', needs: 'pc' },
    { id: 'gitlab', name: 'GitLab', mark: 'GL', blurb: 'Projects and merge requests', needs: 'pc' },
    { id: 'bitbucket', name: 'Bitbucket', mark: 'BB', blurb: 'Repositories and pull requests', needs: 'pc' },
  ] },
  { id: 'docs', label: 'Docs and data', items: [
    { id: 'notion', name: 'Notion', mark: 'N', blurb: 'Pages and databases', needs: 'pc' },
    { id: 'supabase', name: 'Supabase', mark: 'Sb', blurb: 'Your project database', needs: 'pc' },
    { id: 'sentry', name: 'Sentry', mark: 'Se', blurb: 'Errors from your apps', needs: 'pc' },
  ] },
  { id: 'work', label: 'Work and chat', items: [
    { id: 'slack', name: 'Slack', mark: 'Sl', blurb: 'Read and post messages', needs: 'pc' },
    { id: 'discord', name: 'Discord', mark: 'Di', blurb: 'Your Pholama Discord', needs: 'pc' },
    { id: 'linear', name: 'Linear', mark: 'Li', blurb: 'Issues and projects', needs: 'pc' },
    { id: 'jira', name: 'Jira', mark: 'Ji', blurb: 'Tickets and boards', needs: 'pc' },
  ] },
];

export const allConnectors = () => GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.id })));
export const findConnector = id => allConnectors().find(c => c.id === id) || null;

// Does a Discord "guilds" answer contain the Pholama server? Accepts the raw array from Discord. Anything else is "no".
export function inPholamaServer(guilds, guildId = PHOLAMA_GUILD_ID) {
  return Array.isArray(guilds) && guilds.some(g => g && String(g.id) === String(guildId));
}

// Asks Discord, with the person's own token, which servers they are in.
// Returns { state: 'member' | 'not-member' | 'needs-signin' | 'needs-permission' | 'error' }.
//   needs-signin     = not logged in with Discord at all
//   needs-permission = logged in with Discord, but before the "guilds" permission was asked for (log in again)
export async function checkMembership({ providerToken, isDiscord, fetchFn = globalThis.fetch } = {}) {
  if (!isDiscord) return { state: 'needs-signin' };
  if (!providerToken) return { state: 'needs-permission' };
  try {
    const r = await fetchFn('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: 'Bearer ' + providerToken } });
    if (r.status === 401 || r.status === 403) return { state: 'needs-permission' };
    if (!r.ok) return { state: 'error' };
    const list = await r.json();
    return { state: inPholamaServer(list) ? 'member' : 'not-member' };
  } catch { return { state: 'error' }; }
}

// What a card should look like right now. Pure: the page passes in what it knows.
//   ctx = { member: 'member'|'not-member'|'needs-signin'|'needs-permission'|'error'|'unknown', pcConnected: boolean, connected: {id:true} }
export function cardState(c, ctx = {}) {
  if (ctx.connected && ctx.connected[c.id]) return { kind: 'connected', label: 'Connected', action: c.opens ? 'open' : 'disconnect' };
  if (c.needs === 'discord') {
    const m = ctx.member || 'unknown';
    if (m === 'member') return { kind: 'ready', label: 'Connect', action: 'connect' };
    if (m === 'needs-signin') return { kind: 'locked', label: 'Log in with Discord', action: 'login', note: 'Log in with Discord to unlock this.' };
    if (m === 'needs-permission') return { kind: 'locked', label: 'Log in again', action: 'login', note: 'Log in with Discord once more so Pholama can see you are in the server.' };
    if (m === 'not-member') return { kind: 'locked', label: 'Join the Discord', action: 'join', note: 'Join the Pholama Discord server, then press Check again.' };
    if (m === 'error') return { kind: 'locked', label: 'Try again', action: 'check', note: 'Could not reach Discord. Try again.' };
    return { kind: 'locked', label: 'Checking...', action: 'check', note: '' };
  }
  if (c.needs === 'pc') return ctx.pcConnected ? { kind: 'ready', label: 'Connect', action: 'connect' } : { kind: 'locked', label: 'Needs your PC', action: 'pc', note: 'Runs through a connected Pholama PC.' };
  return { kind: 'ready', label: 'Connect', action: 'connect' };
}

// ---- drawing (browser only) ----
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

export function renderConnectors(host, ctx, on) {
  host.textContent = '';
  const wrap = el('div', 'cn-wrap');
  wrap.appendChild(el('h3', 'cn-title', 'Studio works with your favorite tools'));
  const cols = el('div', 'cn-cols');
  for (const g of GROUPS) {
    const col = el('div', 'cn-col'); col.appendChild(el('div', 'cn-group', g.label));
    for (const c of g.items) {
      const st = cardState(c, ctx);
      const card = el('div', 'cn-card ' + st.kind); card.dataset.id = c.id; card.dataset.state = st.kind;
      card.appendChild(el('span', 'cn-mark', c.mark));
      const txt = el('span', 'cn-txt'); txt.append(el('b', '', c.name), el('small', '', st.note || c.blurb)); card.appendChild(txt);
      const b = el('button', 'cn-btn' + (st.kind === 'ready' ? ' p' : ''), st.label); b.type = 'button'; b.dataset.action = st.action;
      b.onclick = () => on && on(c, st.action);
      card.appendChild(b); col.appendChild(card);
    }
    cols.appendChild(col);
  }
  wrap.appendChild(cols); host.appendChild(wrap);
}
