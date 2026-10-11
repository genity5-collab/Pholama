// Review-first on the WEBSITE backend: same contract as the PC. Real cloud routes over a fake database; only the AI is scripted.
const load = require('./helpers/sitecore'), fakePg = require('./helpers/fakepg');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
const tc = (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>';
(async () => {
  const Routes = await load('siteStudioRoutes.ts'), S = await load('siteStudioSupabase.ts');
  const pg = fakePg(), rest = S.makeRest('https://x.supabase.co', 'svc', pg.fetch), A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', MASTER = 'a-long-server-secret-key-1234567890';
  let script = [], si = 0;
  const mk = uid => ({ uid, rest, master: MASTER, callModel: async () => script[Math.min(si++, script.length - 1)], spend: async () => true });
  const call = async (uid, method, url, body) => { const u = new URL('http://x/' + url); return Routes.handle({ method, path: u.pathname.split('/').filter(Boolean).map(decodeURIComponent), query: u.searchParams, body }, mk(uid)); };
  const drive = async (uid, id, max = 80) => { let r; for (let i = 0; i < max; i++) { r = await call(uid, 'GET', 'runs/' + id); if (!r.body.active) break; } return r.body.run; };
  const store = S.makeStore(rest, A), text = f => store.getFile('shop', f);
  const startRun = async (prompt) => {
    script = ['["Change the heading and add a script"]', tc('studio_write', { file: 'app.js', content: 'var ready = 1;\n' }), tc('studio_patch', { file: 'index.html', find: '<h1>shop</h1>', replace: '<h1>Welcome</h1>' }), 'Done.']; si = 0;
    const r = await call(A, 'POST', 'runs', { project: 'shop', prompt, mode: 'build', model: 'qwen-coder' }); const run = await drive(A, r.body.id); return { id: r.body.id, run };
  };
  await call(A, 'POST', 'projects', { name: 'Shop' });
  let { id, run } = await startRun('say welcome'); ok('the run completes and really changed the files', run.status === 'completed' && (await text('index.html')).includes('Welcome') && (await text('app.js')) != null, run.status + ' ' + run.error);
  let r = await call(A, 'GET', 'runs/' + id + '/review');
  ok('every changed file is listed, all pending', r.status === 200 && r.body.available && r.body.files.length === 2 && r.body.files.every(f => f.decision === 'pending'), JSON.stringify(r.body).slice(0, 300));
  ok('each change carries the text from before the run (for the red/green view)', r.body.files.find(f => f.file === 'index.html').before.includes('<h1>shop</h1>') && r.body.files.find(f => f.file === 'app.js').before === '');
  r = await call(B, 'GET', 'runs/' + id + '/review'); ok('another member cannot read my review', r.status === 404);
  r = await call(B, 'POST', 'runs/' + id + '/review', { action: 'reject-all' }); ok('...nor reject my files', r.status === 404 && (await text('index.html')).includes('Welcome'));
  r = await call(A, 'POST', 'runs/' + id + '/review', { action: 'explode' }); ok('an unknown action is refused', r.status === 400 && /Choose accept/.test(r.body.error), JSON.stringify(r.body));
  r = await call(A, 'POST', 'runs/' + id + '/review', { action: 'accept', file: 'nope.txt' }); ok('a file with no change cannot be accepted', r.status === 400, JSON.stringify(r.body));
  r = await call(A, 'POST', 'runs/' + id + '/review', { action: 'accept', file: 'index.html' });
  ok('Accept keeps the AI version and marks it accepted', r.status === 200 && r.body.ok && (await text('index.html')).includes('Welcome') && r.body.review.files.find(f => f.file === 'index.html').decision === 'accepted', JSON.stringify(r.body).slice(0, 300));
  r = await call(A, 'POST', 'runs/' + id + '/review', { action: 'reject', file: 'app.js' });
  ok('Reject removes a file the run created', r.status === 200 && /Removed/.test(r.body.text) && (await text('app.js')) == null, JSON.stringify(r.body).slice(0, 300));
  ok('...a rejected file no longer shows a change (same as the PC)', !(await call(A, 'GET', 'runs/' + id + '/review')).body.files.some(f => f.file === 'app.js'));
  r = await call(A, 'POST', 'runs/' + id + '/review', { action: 'accept-all' }); ok('Accept all has nothing left once everything is decided', r.body.ok && r.body.count === 0, JSON.stringify(r.body));
  // second run: Reject all puts an edited file back and removes the new one
  ({ id, run } = await startRun('say welcome again'));
  ok('second run: a changed file again waits for review', run.status === 'completed' || run.status === 'failed', run.status);
  r = await call(A, 'GET', 'runs/' + id + '/review'); const pend = r.body.files.filter(f => f.decision === 'pending').length;
  r = await call(A, 'POST', 'runs/' + id + '/review', { action: 'reject-all' });
  ok('Reject all puts every pending file back (the new file is removed)', r.status === 200 && r.body.count === pend && r.body.count >= 1 && (await text('app.js')) == null, JSON.stringify(r.body).slice(0, 300));
  ok('...and an earlier ACCEPTED change is left alone', (await text('index.html')).includes('<h1>Welcome</h1>'));
  ok('...and nothing is left waiting', (await call(A, 'GET', 'runs/' + id + '/review')).body.files.filter(f => f.decision === 'pending').length === 0);
  // a run that is still going cannot be reviewed yet
  script = ['["slow"]', tc('studio_read', { file: 'index.html' })]; si = 0;
  const live = await call(A, 'POST', 'runs', { project: 'shop', prompt: 'slow one', mode: 'build', model: 'qwen-coder' });
  r = await call(A, 'POST', 'runs/' + live.body.id + '/review', { action: 'accept-all' }); ok('review is refused while a run is still working', r.status === 409 && /finish/.test(r.body.error), r.status + ' ' + JSON.stringify(r.body));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
