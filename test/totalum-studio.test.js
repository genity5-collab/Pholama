// Pholama Studio on Totalum: runs the real function against a fake login and a fake Totalum server.
const { execFileSync } = require('child_process'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-')), out = path.join(dir, 'f.mjs');
  execFileSync('npx', ['--no-install', 'esbuild', path.join(__dirname, '..', 'functions', 'pholamaTotalumStudio.ts'), '--format=esm', '--log-level=error', '--outfile=' + out], { cwd: path.join(__dirname, '..') });
  const seen = { keys: new Set(), calls: [] }; let projects = [], agentStatus = 'init', fail = null, user = 'u1';
  const net = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s.setHeader('Content-Type', 'application/json'); const send = (d, st = 200) => { s.statusCode = st; s.end(JSON.stringify(d)); };
    if (q.url.startsWith('/auth/v1/user')) return q.headers.authorization === 'Bearer good' ? send({ id: user }) : send({}, 401);
    seen.keys.add(q.headers['api-key']); seen.calls.push(q.method + ' ' + q.url);
    if (fail && !(/INVALID_PROJECT/.test(fail) && !q.url.endsWith('/projects/launch'))) return send({ errors: { errorCode: fail, errorMessage: 'x' }, data: null }, fail === 'INSUFFICIENT_CREDITS' ? 402 : /INVALID_PROJECT/.test(fail) ? 400 : 409);
    if (q.url === '/api/v1/vcaas/account') return send({ errors: null, data: { credits: 41.5 } });
    if (q.url === '/api/v1/vcaas/projects' && q.method === 'GET') return send({ errors: null, data: projects });
    if (q.url === '/api/v1/vcaas/projects/launch') { const j = JSON.parse(b); if (!/^[a-z][a-z0-9-]*$/.test(j.projectId)) return send({ errors: { errorCode: 'INVALID_PROJECT_NAME', errorMessage: 'x' }, data: null }, 400); if (j.projectId.length < 4 || j.projectId.length > 35) return send({ errors: { errorCode: 'INVALID_PROJECT_NAME_LENGTH', errorMessage: 'x' }, data: null }, 400); projects.push({ projectId: j.projectId, label: j.label, agentProcessStatus: 'init' }); return send({ errors: null, data: { projectId: j.projectId, label: j.label, agent: { started: true, expectedMinutes: 12 }, warnings: [] } }); }
    let m = q.url.match(/^\/api\/v1\/vcaas\/projects\/([^/]+)(\/.*)?$/);
    if (m && m[2] === '/agent/status') return send({ errors: null, data: { status: agentStatus, creditsSpent: 7.25, expectedMinutes: 9, realtimeConversation: [{ author: 'user', message: 'secret prompt' }, { author: 'agent', message: 'Building the map', messageType: 'building', createdAt: 'now' }] } });
    if (m && !m[2]) return send({ errors: null, data: { projectId: m[1], label: 'L', developmentUrlFieldToUse: 'cachedDevelopmentUrl', cachedDevelopmentUrl: 'https://cached.test/x', temporalDevelopmentProjectUrl: 'https://live.test/x', productionProjectUrl: 'https://prod.test', deployment: { status: 'success' } } });
    if (m && m[2] === '/agent/start') return send({ errors: null, data: { status: 'init' } });
    if (m && m[2] === '/deployments/deploy') return send({ errors: null, data: { status: 'deploying' } });
    send({ errors: null, data: {} }); }); }).listen(0, '127.0.0.1');
  await new Promise(r => setTimeout(r, 150)); const base = 'http://127.0.0.1:' + net.address().port;
  let handler; global.Deno = { serve: h => { handler = h; }, env: { get: k => ({ TOTALUM_API_KEY: 'tlm_sk_secret', PHOLAMA_SUPABASE_SERVICE_KEY: 'svc' }[k]) } };
  const realFetch = global.fetch; global.fetch = (u, o) => { u = String(u); if (/nyswblzzvqzheaxvrqtq\.supabase\.co/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); else if (/api-accounts\.totalum\.app/.test(u)) u = base + u.replace(/^https?:\/\/[^/]+/, ''); return realFetch(u, o); };
  await import('file://' + out);
  const call = (body, tok = 'good') => handler(new Request('http://x/f', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) })).then(async r => { const raw = await r.text(); return { status: r.status, j: JSON.parse(raw), raw }; });

  let r = await call({ action: 'credits' }, 'nope'); ok('no valid login is refused', r.status === 401);
  r = await call({ action: 'credits' }); ok('credits come back', r.status === 200 && r.j.data.credits === 41.5, JSON.stringify(r.j));
  r = await call({ action: 'launch', label: 'My GPS App!', prompt: 'a gps app' });
  const pid = r.j.data && r.j.data.projectId;
  ok('launch works and the project id is owner-tagged', r.status === 200 && /^u[0-9a-f]{8}-my-gps-app$/.test(pid), JSON.stringify(r.j));
  ok('launch reports the build started', r.j.data.started === true && r.j.data.expectedMinutes === 12);
  r = await call({ action: 'projects' }); ok('my projects lists it', r.j.data.length === 1 && r.j.data[0].projectId === pid, JSON.stringify(r.j));
  projects.push({ projectId: 'someoneelse-site', label: 'not mine' });
  r = await call({ action: 'projects' }); ok("another user's project is never listed", r.j.data.length === 1 && !JSON.stringify(r.j).includes('someoneelse'));
  r = await call({ action: 'status', projectId: 'someoneelse-site' }); ok("status of someone else's project is refused", r.status === 404);
  r = await call({ action: 'prompt', projectId: 'someoneelse-site', prompt: 'hack' }); ok("prompting someone else's project is refused", r.status === 404);
  r = await call({ action: 'deploy', projectId: '../../account' }); ok('a crafted project id is refused', r.status === 404);
  r = await call({ action: 'status', projectId: pid });
  ok('status shows running and the builder messages only (not the user prompt)', r.status === 200 && r.j.data.status === 'init' && r.j.data.messages.length === 1 && !r.raw.includes('secret prompt'), r.raw);
  ok('preview uses developmentUrlFieldToUse (cached)', r.j.data.previewUrl === 'https://cached.test/x', r.j.data.previewUrl);
  agentStatus = 'done'; r = await call({ action: 'status', projectId: pid }); ok('done is reported with credits spent', r.j.data.done === true && r.j.data.creditsSpent === 7.25);
  r = await call({ action: 'prompt', projectId: pid, prompt: 'add a map' }); ok('a follow-up prompt starts the builder', r.status === 200 && r.j.data.status === 'init');
  r = await call({ action: 'prompt', projectId: pid, prompt: 'x'.repeat(8001) }); ok('an oversize prompt is refused', r.status === 400);
  r = await call({ action: 'deploy', projectId: pid }); ok('publish starts', r.status === 200 && r.j.data.status === 'deploying');
  projects.push({ projectId: pid.slice(0, 9) + '-two' }, { projectId: pid.slice(0, 9) + '-three' });
  r = await call({ action: 'launch', label: 'fourth', prompt: 'p' }); ok('the per-user project cap (3) is enforced', r.status === 403, JSON.stringify(r.j));
  projects = [];
  let allLetterFirst = true, longestOk = true;
  for (const u of ['a', 'b', 'u9', 'zz', 'user-123', 'x'.repeat(40), '0', '9', '1f', '77', '5', '3']) { user = u; projects = []; const rr = await call({ action: 'launch', label: 'a'.repeat(30), prompt: 'p' }); if (rr.status !== 200 || !/^[a-z]/.test(rr.j.data.projectId)) allLetterFirst = false; if (rr.j.data && rr.j.data.projectId.length + 6 > 35) longestOk = false; }
  user = 'u1'; projects = [];
  ok('every user gets a project id that starts with a letter (Totalum rule)', allLetterFirst);
  ok('even a 30-character name stays within 35 characters with 6 random chars appended', longestOk);
  fail = 'INVALID_PROJECT_NAME'; r = await call({ action: 'launch', label: 'zz', prompt: 'p' }); ok('a rejected name tells the user to pick another (not a generic failure)', r.status === 400 && /different project name/.test(r.raw), r.raw);
  fail = 'INSUFFICIENT_CREDITS'; r = await call({ action: 'launch', label: 'broke', prompt: 'p' }); ok('out of credits gives a friendly message', r.status === 402 && /out of build credits/.test(r.raw) && !/INSUFFICIENT/.test(r.raw), r.raw);
  fail = null;
  ok('the Totalum key only ever travelled server to server', [...seen.keys].every(k => k === 'tlm_sk_secret'));
  ok('no response ever contains the key', !JSON.stringify(r.j).includes('tlm_sk_'));
  net.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
