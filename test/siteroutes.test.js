// Every route the workspace screen calls, on the website backend, over a fake database. Two members, a scripted AI.
const load = require('./helpers/sitecore'), fakePg = require('./helpers/fakepg');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
const tc = (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>';
(async () => {
  const Routes = await load('siteStudioRoutes.ts'), S = await load('siteStudioSupabase.ts');
  const pg = fakePg(), rest = S.makeRest('https://x.supabase.co', 'svc', pg.fetch), A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', MASTER = 'a-long-server-secret-key-1234567890';
  const used = new Map(); let script = [], si = 0, seen = [], boom = false;
  const mk = uid => ({ uid, rest, master: MASTER, callModel: async msgs => { seen.push(JSON.stringify(msgs)); if (boom) throw new Error('503 https://api.free.ai exploded'); return script[Math.min(si++, script.length - 1)]; }, spend: async (u, n) => { const t = (used.get(u) || 0) + n; if (t > Routes.DAILY_RUNS) return false; used.set(u, t); return true; } });
  const call = async (uid, method, url, body) => { const u = new URL('http://x/' + url); return Routes.handle({ method, path: u.pathname.split('/').filter(Boolean).map(decodeURIComponent), query: u.searchParams, body }, mk(uid)); };
  const drive = async (uid, id, max = 60) => { let r; for (let i = 0; i < max; i++) { r = await call(uid, 'GET', 'runs/' + id); if (!r.body.active) break; } return r.body.run; };
  // capabilities + projects
  let r = await call(A, 'GET', 'capabilities'); ok('capabilities: honest about the website (no terminal, no test runner, no stream)', r.status === 200 && r.body.terminal.available === false && r.body.tests.available === false && r.body.noStream === true && r.body.models[0].id === 'qwen-coder' && Object.keys(r.body.modes).length === 4 || r.body.modes.length === 4, JSON.stringify(r.body).slice(0, 200));
  r = await call(A, 'POST', 'projects', { name: 'Shop' }); ok('create a project', r.status === 200 && r.body.name === 'shop');
  r = await call(A, 'GET', 'projects/shop'); ok('open a project: files WITH content, index.html first', r.body.files[0].name === 'index.html' && typeof r.body.files[0].content === 'string' && r.body.files.length === 3);
  r = await call(A, 'GET', 'projects/shop/tree'); ok('tree', r.body.files.length === 3 && Array.isArray(r.body.dirs));
  r = await call(A, 'PUT', 'projects/shop/file', { file: 'js/app.js', content: 'let a = 1;' }); ok('save a file in a folder', r.status === 200 && r.body.created === true); r = await call(A, 'GET', 'projects/shop/tree'); ok('...and the folder shows in the tree', r.body.dirs.includes('js'));
  r = await call(A, 'PUT', 'projects/shop/file', { file: '../../etc/passwd', content: 'x' }); ok('a path trick is refused', r.status === 400);
  r = await call(A, 'PUT', 'projects/shop/file', { file: 'run.exe', content: 'x' }); ok('a bad file type is refused', r.status === 400);
  r = await call(A, 'POST', 'projects/shop/folder', { folder: 'assets' }); ok('folder is accepted', r.status === 200);
  r = await call(A, 'DELETE', 'projects/shop/file', { file: 'js/app.js' }); ok('delete a file', r.status === 200);
  r = await call(A, 'GET', 'projects/nope'); ok('a missing project is a clean 404', r.status === 404 && /no project named/.test(r.body.error));
  r = await call(B, 'GET', 'projects/shop'); ok('another member cannot open my project', r.status === 404); r = await call(B, 'GET', 'projects'); ok('...nor see it listed', r.body.projects.length === 0);
  r = await call(B, 'PUT', 'projects/shop/file', { file: 'index.html', content: 'hacked' }); ok('...nor write into it', r.status === 404 && /<h1>shop/.test(await S.makeStore(rest, A).getFile('shop', 'index.html')));
  r = await call(B, 'POST', 'secrets/shop', { name: 'X', value: 'abcdefgh1234' }); ok('...nor add secrets to it', r.status === 404);
  for (let i = 0; i < 4; i++) await call(A, 'POST', 'projects', { name: 'p' + i }); r = await call(A, 'POST', 'projects', { name: 'sixth' }); ok('at most 5 projects', r.status === 400 && /5 website projects/.test(r.body.error));
  for (let i = 0; i < 4; i++) await call(A, 'DELETE', 'projects/p' + i);
  // a full run through the screen's own flow
  script = ['["Greet the visitor"]', tc('studio_read', { file: 'index.html' }), tc('studio_patch', { file: 'index.html', find: '<h1>shop</h1>', replace: '<h1>Welcome</h1>' }), 'Done.']; si = 0;
  r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'say welcome', mode: 'build', model: 'qwen-coder' }); ok('start a run: 202 + id', r.status === 202 && /^r[a-z0-9]+$/.test(r.body.id), JSON.stringify(r.body)); const id = r.body.id;
  r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'another', mode: 'build' }); ok('a second run on a busy project is refused', r.status === 409);
  const run = await drive(A, id); ok('polling the run drives it to completion, slice by slice', run.status === 'completed', run.status + ' ' + run.error);
  ok('the file really changed', (await S.makeStore(rest, A).getFile('shop', 'index.html')).includes('<h1>Welcome</h1>'));
  r = await call(A, 'GET', 'runs/' + id + '/diff'); ok('diff shows the change', r.body.available && r.body.changes[0].file === 'index.html');
  r = await call(A, 'GET', 'runs?project=shop'); ok('the run list has a summary', r.body.runs.length === 1 && r.body.runs[0].changed === 1);
  r = await call(B, 'GET', 'runs/' + id); ok('another member cannot read my run', r.status === 404); r = await call(B, 'GET', 'runs'); ok('...nor list it', r.body.runs.length === 0);
  r = await call(B, 'POST', 'runs/' + id + '/revert', {}); ok('...nor revert it', r.status === 404);
  r = await call(A, 'POST', 'runs/' + id + '/revert', { file: 'index.html' }); ok('reject one file\'s change', r.body.ok && /Put back/.test(r.body.text) && (await S.makeStore(rest, A).getFile('shop', 'index.html')).includes('<h1>shop</h1>'));
  r = await call(A, 'POST', 'runs/' + id + '/revert', {}); ok('revert the whole run', r.body.ok === true);
  r = await call(A, 'DELETE', 'runs/' + id); ok('a finished run can be deleted', r.status === 200); r = await call(A, 'GET', 'runs/' + id); ok('...and is gone', r.status === 404);
  r = await call(A, 'GET', 'runs/not-an-id'); ok('a malformed run id is a 404', r.status === 404);
  // validation
  r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'hi' }); ok('a too-short prompt is refused', r.status === 400); r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'x'.repeat(4001) }); ok('a too-long prompt is refused', r.status === 400);
  r = await call(A, 'POST', 'runs', { prompt: 'build something nice' }); ok('no project is refused', r.status === 400); r = await call(A, 'POST', 'runs', { project: 'ghost', prompt: 'build something nice' }); ok('a run on a new name makes that project (the screen sends only a name)', r.status === 202); r = await call(A, 'GET', 'projects/never-made'); ok('opening an unknown project is still a 404', r.status === 404);
  script = ['["x"]', 'Done.']; si = 0; r = await call(A, 'POST', 'runs', { newProject: 'Fresh Site', prompt: 'make a landing page', mode: 'fast' }); ok('a new project can be created by the run itself', r.status === 202 && (await call(A, 'GET', 'projects/fresh-site')).status === 200);
  await drive(A, r.body.id);
  // secrets pasted into the prompt
  const GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'; script = ['["x"]', 'Done.']; si = 0; seen = [];
  r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'deploy with token ' + GH + ' please', mode: 'fast' }); const gid = r.body.id; await drive(A, gid);
  const stored = await S.makeRuns(rest, A).load(gid); ok('a pasted key is saved, removed from the stored run, and the user is told', !JSON.stringify(stored).includes(GH) && /GITHUB_TOKEN/.test(stored.notice) && !stored.notice.includes(GH) && /\{\{secret:GITHUB_TOKEN\}\}/.test(stored.prompt));
  ok('...and the AI never received it', seen.length > 0 && seen.every(x => !x.includes(GH)));
  ok('...and nothing in the database holds the plain key', !JSON.stringify(pg.tables).includes(GH));
  r = await call(A, 'GET', 'secrets/shop'); ok('secrets list shows name + preview only', r.body.secrets.length === 1 && r.body.secrets[0].name === 'GITHUB_TOKEN' && !JSON.stringify(r.body).includes(GH) && r.body.max === 10);
  r = await call(A, 'POST', 'secrets/shop', { name: 'my api key', value: 'abcd1234efgh5678' }); ok('add one by hand (name is cleaned)', r.body.ok && r.body.name === 'MY_API_KEY' && !JSON.stringify(r.body).includes('abcd1234'));
  r = await call(A, 'DELETE', 'secrets/shop/MY_API_KEY'); ok('delete one', r.body.removed === true);
  // database: look, never set up
  for (const [m, u] of [['POST', 'db/shop'], ['PUT', 'db/shop/x'], ['PATCH', 'db/shop/x'], ['DELETE', 'db/shop/table']]) { r = await call(A, m, u, { enabled: true }); ok('a person cannot set up the database: ' + m + ' ' + u, r.status === 403 && r.body.code === 'ai-only'); }
  r = await call(A, 'GET', 'db/shop'); ok('db status: off, with the rules', r.body.enabled === false && r.body.rules.signInsPerWeek === 10);
  // the AI turns it on during a run
  script = ['["Add a db"]', tc('studio_db_enable', {}), tc('studio_db_create_table', { name: 'notes', columns: [{ name: 'title' }] }), tc('studio_write', { file: 'a.js', content: 'let a = 1;' }), 'Done.']; si = 0;
  const E = await load('siteStudioEngine.ts'); r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'add notes with a database', mode: 'build' });
  const dbRun = await drive(A, r.body.id); r = await call(A, 'GET', 'db/shop'); ok('the AI can turn the database on and make a table through its tools', dbRun.steps.some(s => s.tool === 'studio_db_enable' && s.status === 'completed') && r.body.enabled === true && r.body.tables.some(t => t.name === 'notes'), dbRun.steps.map(s => s.tool + ':' + s.status).join());
  // allowance
  used.set(A, Routes.DAILY_RUNS); r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'one more please' }); ok('past the daily allowance is refused with a friendly message', r.status === 429 && r.body.code === 'limit' && /come back tomorrow/.test(r.body.error)); used.set(A, 0);
  // cancel
  script = ['["a"]', tc('studio_read', { file: 'index.html' }), tc('studio_read', { file: 'index.html' }), 'Done.']; si = 0; r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'look around the project', mode: 'build' }); const cid = r.body.id;
  r = await call(A, 'POST', 'runs/' + cid + '/cancel'); ok('stop a run that has not finished', r.body.ok === true); const cr = await drive(A, cid); ok('...and it ends as cancelled', cr.status === 'cancelled', cr.status);
  r = await call(A, 'POST', 'runs/' + cid + '/cancel'); ok('stopping a finished run says no', r.body.ok === false);
  // provider failure never reaches the user
  boom = true; script = []; r = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'make it purple please' }); const fr = await drive(A, r.body.id); boom = false;
  ok('a dead AI ends the run failed and shows NO provider detail anywhere', fr.status === 'failed' && !/free\.ai|503|exploded/i.test(JSON.stringify(fr)), JSON.stringify(fr).slice(0, 200));
  // search / problems / build / tests
  r = await call(A, 'GET', 'search?project=shop&q=welcome'); ok('search', Array.isArray(r.body.hits)); r = await call(A, 'PUT', 'projects/shop/file', { file: 'bad.js', content: 'let = ;' }); r = await call(A, 'GET', 'problems?project=shop'); ok('problems finds the broken script', r.body.problems.some(p => p.file === 'bad.js'));
  r = await call(A, 'POST', 'build', { project: 'shop' }); ok('build check reports the error', r.body.ok === false && r.body.problems.length > 0); r = await call(A, 'POST', 'tests', { project: 'shop' }); ok('tests: honestly unavailable', r.body.available === false && /PC Studio/.test(r.body.output));
  r = await call(A, 'GET', 'search?project=nope&q=x'); ok('search in a missing project is a 404', r.status === 404);
  r = await call(A, 'GET', 'projects/shop/preview'); ok('preview returns every file', Object.keys(r.body.files).includes('index.html'));
  r = await call(A, 'GET', 'dashboard'); ok('dashboard lists projects with file counts and the last run', r.body.projects.length >= 2 && r.body.projects.find(p => p.name === 'shop').lastRun);
  r = await call(A, 'POST', 'resolve', { text: 'fix the header in shop' }); ok('resolve finds a project named in the text', r.body.status === 'found' && r.body.project === 'shop');
  r = await call(A, 'GET', 'nothing/here'); ok('an unknown route is a clean 404', r.status === 404);
  // The shared screen sends only a NAME for a new project (the PC makes it on the spot). The website must too, within the same rules.
  script = ['["x"]', 'Done.']; si = 0;
  r = await call(A, 'POST', 'runs', { project: 'Brand New Cafe', prompt: 'make a menu page', mode: 'fast' }); ok('a run on a project name that does not exist yet creates it', r.status === 202 && (await call(A, 'GET', 'projects')).body.projects.some(p => p.name === 'brand-new-cafe'), JSON.stringify(r.body));
  r = await call(B, 'GET', 'projects/brand-new-cafe'); ok('...and it belongs to that member only', r.status === 404);
  r = await call(A, 'POST', 'runs', { project: '../../etc', prompt: 'make a menu page' }); ok('an unsafe name cannot make a project', !(await call(A, 'GET', 'projects')).body.projects.some(p => /\.\.|etc\//.test(p.name)), JSON.stringify(r.body));
  for (const n of ['p1', 'p2', 'p3', 'p4']) await call(A, 'POST', 'projects', { name: n });
  const before = (await call(A, 'GET', 'projects')).body.projects.length; r = await call(A, 'POST', 'runs', { project: 'one-too-many', prompt: 'make a menu page' }); ok('the project cap still holds when a run names a new project', r.status >= 400 && !(await call(A, 'GET', 'projects')).body.projects.some(p => p.name === 'one-too-many') && /website projects/.test(r.body.error || ''), before + ' ' + JSON.stringify(r.body));
  r = await call(A, 'POST', 'runs', { project: '   ', prompt: 'make a menu page' }); ok('a blank project name is refused politely', r.status === 400 && /project/i.test(r.body.error), JSON.stringify(r.body));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
