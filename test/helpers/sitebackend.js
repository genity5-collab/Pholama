// Runs the REAL website Studio router (functions/siteStudioRoutes.ts) behind a local HTTP server, on the fake database, with a scripted AI.
// The browser test points window.PHOLAMA.STUDIO_URL at it, so the real screen talks to the real routes, only the database and the AI are doubles.
const http = require('http'), load = require('./sitecore'), fakePg = require('./fakepg');
module.exports = async function start({ script = [], users = { 'good-token': 'aaaaaaaa-0000-0000-0000-000000000001', 'other-token': 'bbbbbbbb-0000-0000-0000-000000000002' } } = {}) {
  const Routes = await load('siteStudioRoutes.ts'), S = await load('siteStudioSupabase.ts'); const pg = fakePg(), rest = S.makeRest('https://x.supabase.co', 'svc', pg.fetch); let si = 0, spent = new Map(); const seen = [];
  const state = { script, requests: seen, setScript(s) { state.script = s; si = 0; } };
  const server = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''), uid = users[token]; seen.push(req.method + ' ' + req.url + (uid ? '' : ' [no/invalid login]'));
    if (!uid) { res.writeHead(401, cors); return res.end(JSON.stringify({ error: 'Log in to use Pholama Studio.' })); }
    let raw = ''; for await (const c of req) raw += c; let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch {}
    const u = new URL(req.url, 'http://x'), path = u.pathname.replace(/^\/functions\/pholamaSiteStudio/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const out = await Routes.handle({ method: req.method, path, query: u.searchParams, body }, { uid, rest, master: 'a-long-server-secret-key-1234567890', callModel: async () => state.script[Math.min(si++, state.script.length - 1)], spend: async (x, n) => { const t = (spent.get(x) || 0) + n; if (t > Routes.DAILY_RUNS) return false; spent.set(x, t); return true; } });
    res.writeHead(out.status, cors); res.end(JSON.stringify(out.body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); state.url = 'http://127.0.0.1:' + server.address().port + '/functions/pholamaSiteStudio'; state.close = () => new Promise(r => server.close(r)); state.pg = pg; return state;
};
