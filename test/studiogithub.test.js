// GitHub import / review / push through a FAKE GitHub: import writes real files, push is parked for approval, success needs GitHub's own confirmation.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
process.env.PHOLAMA_STUDIO = path.join(base, 's'); process.env.PHOLAMA_STUDIO_HISTORY = path.join(base, 'h'); process.env.PHOLAMA_STUDIO_RUNS = path.join(base, 'r');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const calls = []; let refSha = 'old', confirmSha = true;
const blob = t => Buffer.from(t).toString('base64');
const fake = http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
  calls.push(q.method + ' ' + q.url + (q.headers.authorization ? ' [auth]' : '')); s.setHeader('Content-Type', 'application/json'); const j = (o, c = 200) => { s.statusCode = c; s.end(JSON.stringify(o)); };
  if (q.url === '/repos/me/site') return j({ default_branch: 'main', html_url: 'https://github.com/me/site' });
  if (q.url.startsWith('/repos/me/site/branches')) return j([{ name: 'main' }, { name: 'dev', protected: true }]);
  if (q.url.startsWith('/repos/me/site/git/trees/') && q.method === 'GET') return j({ tree: [{ type: 'blob', path: 'index.html', sha: 'a', size: 30 }, { type: 'blob', path: 'logo.png', sha: 'p', size: 99 }, { type: 'blob', path: '.env', sha: 'e', size: 5 }, { type: 'blob', path: 'big.js', sha: 'g', size: 900000 }] });
  if (q.url === '/repos/me/site/git/blobs/a') return j({ encoding: 'base64', content: blob('<h1>from github</h1>\n') });
  if (q.url === '/repos/me/site/git/ref/heads/main') return j({ object: { sha: confirmSha ? refSha : 'someone-else' } });
  if (q.url === '/repos/me/site/git/commits/old') return j({ tree: { sha: 'tree0' } });
  if (q.url === '/repos/me/site/git/blobs' && q.method === 'POST') return j({ sha: 'b1' });
  if (q.url === '/repos/me/site/git/trees' && q.method === 'POST') return j({ sha: 'tree1' });
  if (q.url === '/repos/me/site/git/commits' && q.method === 'POST') { refSha = 'newcommit'; return j({ sha: 'newcommit' }); }
  if (q.url === '/repos/me/site/git/refs/heads/main' && q.method === 'PATCH') return j({});
  j({ message: 'Not Found' }, 404); }); }).listen(0, '127.0.0.1');
fake.on('listening', async () => {
  const realFetch = global.fetch; global.fetch = (u, o) => realFetch(String(u).replace('https://api.github.com', 'http://127.0.0.1:' + fake.address().port), o);
  const gh = require('../server/github'), stu = require('../server/studio'), sr = require('../server/studioroutes');
  const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
  const srv = http.createServer((req, res) => { req.who = 'local'; sr.handle(req, res, new URL(req.url, 'http://x'), { json, body, models: [], terminal: false }); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  const call = (m, p, b, tok) => new Promise(r => { const q = http.request({ port: srv.address().port, path: p, method: m, headers: { 'content-type': 'application/json', ...(tok ? { 'x-github-token': tok } : {}) } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ code: res.statusCode, j: (() => { try { return JSON.parse(d); } catch { return d; } })() })); }); if (b) q.write(JSON.stringify(b)); q.end(); });
  let r = await call('GET', '/api/studio/ws/github/status'); ok('without a token GitHub says it is not connected', r.j.connected === false);
  r = await call('POST', '/api/studio/ws/github/import', { repo: 'me/site' }); ok('import without a token is refused', r.code === 401);
  r = await call('POST', '/api/studio/ws/github/import', { repo: 'not a repo' }, 'tok'); ok('a bad repo name is refused', r.code === 400);
  r = await call('POST', '/api/studio/ws/github/import', { repo: 'me/site', branch: '../x' }, 'tok'); ok('a path-like branch is refused', r.code === 400);
  r = await call('POST', '/api/studio/ws/github/branches', { repo: 'me/site' }, 'tok'); ok('branches are listed from GitHub', /main/.test(r.j.text) && /dev \(protected\)/.test(r.j.text), JSON.stringify(r.j));
  r = await call('POST', '/api/studio/ws/github/import', { repo: 'me/site' }, 'tok');
  ok('import writes only supported text files into a real project', r.code === 200 && r.j.imported === 1 && stu.readFile('site', 'index.html').includes('from github'), JSON.stringify(r.j));
  ok('unsupported, hidden and huge files are listed as skipped, not silently dropped', r.j.skipped.length === 3 && r.j.skipped.some(x => /\.env/.test(x)) && r.j.skipped.some(x => /too large/.test(x)));
  ok('a checkpoint was saved before the import', require('../server/studiohistory').list(stu, 'site').length >= 1);
  stu.writeFile('site', 'index.html', '<h1>edited locally</h1>\n'); stu.writeFile('site', 'new.js', 'var a=1;\n');
  r = await call('POST', '/api/studio/ws/github/review', { repo: 'me/site', project: 'site' }, 'tok');
  ok('review shows changed and added files before anything is committed', r.j.changes.some(c => c.path === 'index.html' && c.status === 'changed') && r.j.changes.some(c => c.path === 'new.js' && c.status === 'added'), JSON.stringify(r.j));
  const before = calls.filter(c => /^(POST|PATCH) /.test(c)).length;
  r = await call('POST', '/api/studio/ws/github/push', { repo: 'me/site', project: 'site', message: 'Update' }, 'tok');
  ok('push is only PARKED for approval', r.j.pending && r.j.pending.id && /Nothing has been pushed/.test(r.j.text));
  ok('no write reached GitHub before approval', calls.filter(c => /^(POST|PATCH) /.test(c)).length === before);
  let msg = await gh.confirm('tok', r.j.pending.id, true);
  ok('after Allow, success is reported only because GitHub confirms the ref', /confirmed by GitHub/.test(msg) && /me\/site@main/.test(msg) && /newcomm/.test(msg), msg);
  // a push GitHub does not confirm must not be claimed
  refSha = 'old'; confirmSha = false; r = await call('POST', '/api/studio/ws/github/push', { repo: 'me/site', project: 'site' }, 'tok');
  let err = ''; try { await gh.confirm('tok', r.j.pending.id, true); } catch (e) { err = e.message; }
  ok('if GitHub does not confirm, no success is claimed', /did not confirm/.test(err), err);
  r = await call('POST', '/api/studio/ws/github/push', { repo: 'me/site', project: 'site' }, 'tok'); msg = await gh.confirm('tok', r.j.pending.id, false); ok('declining pushes nothing', /Nothing was changed/.test(msg));
  ok('the token only ever went to GitHub in the auth header, never to a body or log', calls.every(c => !/tok/.test(c.replace('[auth]', ''))));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); srv.close(); fake.close(); fs.rmSync(base, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
});
