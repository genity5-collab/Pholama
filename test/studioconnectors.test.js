// Studio connectors: the Discord-membership gate for RetroStudio, card states and the grid data.
const path = require('path'), { pathToFileURL } = require('url');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const C = await import(pathToFileURL(path.join(__dirname, '../docs/studioconnectors.js')).href);
  const G = C.PHOLAMA_GUILD_ID;
  ok('the Pholama server id is the one the owner gave', G === '1556650031375982803');
  ok('membership: found in a list of servers', C.inPholamaServer([{ id: '1' }, { id: G }]) === true);
  ok('membership: a number-shaped id still matches', C.inPholamaServer([{ id: 1556650031375982803n }]) === true);
  ok('membership: not in the list', C.inPholamaServer([{ id: '1' }, { id: '2' }]) === false);
  ok('membership: garbage is never "member"', [null, undefined, {}, 'x', 5, [null], [{}]].every(x => C.inPholamaServer(x) === false));
  const resp = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  ok('not logged in with Discord -> needs-signin', (await C.checkMembership({ isDiscord: false })).state === 'needs-signin');
  ok('Discord login without the permission token -> needs-permission', (await C.checkMembership({ isDiscord: true, providerToken: '' })).state === 'needs-permission');
  ok('member of the server -> member', (await C.checkMembership({ isDiscord: true, providerToken: 't', fetchFn: resp(200, [{ id: G }]) })).state === 'member');
  ok('in other servers only -> not-member', (await C.checkMembership({ isDiscord: true, providerToken: 't', fetchFn: resp(200, [{ id: '9' }]) })).state === 'not-member');
  ok('Discord says 401 (token expired) -> needs-permission', (await C.checkMembership({ isDiscord: true, providerToken: 't', fetchFn: resp(401, {}) })).state === 'needs-permission');
  ok('Discord is down (500) -> error, never member', (await C.checkMembership({ isDiscord: true, providerToken: 't', fetchFn: resp(500, {}) })).state === 'error');
  ok('network failure -> error, never member', (await C.checkMembership({ isDiscord: true, providerToken: 't', fetchFn: async () => { throw new Error('x'); } })).state === 'error');
  let sent = null; await C.checkMembership({ isDiscord: true, providerToken: 'TOK', fetchFn: async (u, o) => { sent = { u, o }; return { status: 200, ok: true, json: async () => [] }; } });
  ok('it asks Discord for the person\'s own servers with their own token', sent && /users\/@me\/guilds$/.test(sent.u) && sent.o.headers.Authorization === 'Bearer TOK');

  const retro = C.findConnector('retrostudio');
  ok('RetroStudio is a connector that needs Discord', retro && retro.needs === 'discord');
  const S = m => C.cardState(retro, { member: m });
  ok('member -> Connect is ready', S('member').kind === 'ready' && S('member').action === 'connect');
  ok('not a member -> locked with a Join button', S('not-member').kind === 'locked' && S('not-member').action === 'join');
  ok('not signed in -> locked with a login button', S('needs-signin').action === 'login');
  ok('needs permission -> asks to log in again', S('needs-permission').action === 'login' && /again/i.test(S('needs-permission').label));
  ok('unknown / error never unlock it', S('unknown').kind === 'locked' && S('error').kind === 'locked' && S(undefined).kind === 'locked');
  ok('connected shows Connected and can open the tab', C.cardState(retro, { member: 'member', connected: { retrostudio: true } }).label === 'Connected' && C.cardState(retro, { connected: { retrostudio: true } }).action === 'open');
  ok('a PC connector is locked without a PC and ready with one', C.cardState(C.findConnector('github'), {}).kind === 'locked' && C.cardState(C.findConnector('github'), { pcConnected: true }).kind === 'ready');
  ok('a browser connector needs nothing', C.cardState(C.findConnector('robloxdocs'), {}).kind === 'ready');
  const all = C.allConnectors(); ok('every connector has an id, a name and a mark; ids are unique', all.every(c => c.id && c.name && c.mark) && new Set(all.map(c => c.id)).size === all.length);
  ok('grouped like the Ollama grid: Roblox, Code, Docs, Work', C.GROUPS.map(g => g.label).join('|') === 'Roblox|Code|Docs and data|Work and chat');
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
