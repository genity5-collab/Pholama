// The Supabase adapters, offline: members are isolated, secrets are sealed (and unreadable without the key), runs can be leased by one request at a time.
const load = require('./helpers/sitecore'), fakePg = require('./helpers/fakepg');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const fails = async fn => { try { await fn(); return null; } catch (e) { return e; } };
(async () => {
  const core = await load('siteStudioCore.ts'), S = await load('siteStudioSupabase.ts'), Eng = await load('siteStudioEngine.ts'), D = await load('siteStudioDb.ts');
  const pg = fakePg(), rest = S.makeRest('https://x.supabase.co', 'service', pg.fetch), A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', MASTER = 'a-long-server-secret-key-1234567890';
  const ctx = uid => ({ store: S.makeStore(rest, uid), secrets: S.makeVault(rest, uid, MASTER) });
  const a = ctx(A), b = ctx(B);
  await core.createProject(a, 'shop'); await core.createProject(b, 'shop');
  await core.writeFile(a, 'shop', 'index.html', '<h1>A</h1>'); await core.writeFile(b, 'shop', 'index.html', '<h1>B</h1>');
  ok('each member has their own project of the same name', (await a.store.getFile('shop', 'index.html')) === '<h1>A</h1>' && (await b.store.getFile('shop', 'index.html')) === '<h1>B</h1>');
  ok('listing only shows my own projects', (await a.store.listProjects()).length === 1 && (await a.store.listFiles('shop')).length === 3);
  await core.createProject(a, 'private-a'); ok('a member cannot see a project that is only the other\'s', !(await b.store.hasProject('private-a')) && (await b.store.getFile('private-a', 'index.html')) === null);
  ok('allFiles is scoped too', Object.keys(await b.store.allFiles('private-a')).length === 0);
  await b.store.deleteProject('private-a'); ok('deleting another member\'s project does nothing', await a.store.hasProject('private-a'));
  await a.store.replaceFiles('shop', { 'index.html': 'new', 'x.js': 'let x;' }); ok('replaceFiles removes files that are not in the set and adds the rest', JSON.stringify(Object.keys(await a.store.allFiles('shop')).sort()) === '["index.html","x.js"]' && (await b.store.getFile('shop', 'index.html')) === '<h1>B</h1>');
  // every query the adapter sends names the member
  ok('every query is filtered by the member\'s id', pg.log.filter(l => /^(GET|DELETE|PATCH) pholama_site_(files|projects|secrets|checkpoints)/.test(l)).every(l => /user_id=eq\./.test(l)), pg.log.find(l => /^(GET|DELETE|PATCH) pholama_site_(files|projects)/.test(l) && !/user_id=eq\./.test(l)));
  // secrets
  await a.secrets.set('shop', 'OPENAI_API_KEY', 'sk-live-realvalue-1234567890', 'manual');
  const raw = JSON.stringify(pg.tables.pholama_site_secrets); ok('the stored secret is sealed, never plain', !raw.includes('realvalue') && /"sealed":"[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+"/.test(raw));
  ok('the owner can unseal it', (await a.secrets.values('shop')).OPENAI_API_KEY === 'sk-live-realvalue-1234567890');
  ok('listing shows only a preview', JSON.stringify(await a.secrets.list('shop')).includes('sk-') && !JSON.stringify(await a.secrets.list('shop')).includes('realvalue'));
  ok('the other member sees none of it', (await b.secrets.list('shop')).length === 0 && Object.keys(await b.secrets.values('shop')).length === 0);
  const stolen = pg.tables.pholama_site_secrets[0].sealed; pg.tables.pholama_site_secrets.push({ user_id: B, project: 'shop', name: 'COPIED', sealed: stolen, preview: 'x', source: 'manual', created_at: new Date().toISOString() });
  ok('a row copied to another member or project cannot be opened (the key is bound to owner + project)', Object.keys(await b.secrets.values('shop')).length === 0);
  const wrongMaster = S.makeVault(rest, A, 'a-different-server-secret-9999999'); ok('a different server key cannot open it', Object.keys(await wrongMaster.values('shop')).length === 0);
  ok('a missing or short server key is refused outright', !!(await fails(() => S.makeVault(rest, A, ''))) && !!(await fails(() => S.makeVault(rest, A, 'short'))));
  ok('scrub swaps a saved value for its reference', (await a.secrets.scrub('shop', 'key=sk-live-realvalue-1234567890!')) === 'key={{secret:OPENAI_API_KEY}}!');
  for (let i = 0; i < 9; i++) await a.secrets.set('shop', 'KEY_' + i, 'value-number-' + i + '-xxxx', 'manual'); const e11 = await fails(() => a.secrets.set('shop', 'ELEVENTH', 'value-eleven-xxxx', 'manual')); ok('the 11th secret is refused', !!e11 && /10 secrets/.test(e11.message));
  ok('replacing an existing one is fine at the limit', (await a.secrets.set('shop', 'KEY_1', 'value-changed-xxxx', 'manual')).replaced === true);
  ok('removing frees a slot', (await a.secrets.remove('shop', 'KEY_1')) === true && (await a.secrets.remove('shop', 'KEY_1')) === false);
  ok('a secret never lands in a file even through the real write path', !(await (async () => { await core.writeFile(a, 'shop', 'k.js', 'const k = "sk-live-realvalue-1234567890";'); return a.store.getFile('shop', 'k.js'); })()).includes('realvalue'));
  // a database error never exposes the real response
  const boom = S.makeRest('https://x.supabase.co', 'service', async () => ({ ok: false, status: 500, text: async () => 'ERROR: relation "pholama_site_secrets" key (user_id)=(aaaa) leaked detail' })); const eb = await fails(() => boom('anything')); ok('a database failure gives no table or row detail', eb && !/relation|leaked|aaaa/.test(eb.message), eb && eb.message);
  // checkpoints + runs
  const cps = S.makeCheckpoints(rest, A), id1 = await cps.save('shop', 'Before run', { 'index.html': 'old' }); ok('a checkpoint can be saved and loaded', (await cps.load('shop', id1)).files['index.html'] === 'old');
  ok('another member cannot load it', (await S.makeCheckpoints(rest, B).load('shop', id1)) === null);
  for (let i = 0; i < 33; i++) await cps.save('shop', 'n' + i, {}); ok('only the newest 30 checkpoints are kept', (await cps.list('shop')).length === 30);
  const runs = S.makeRuns(rest, A), RUN = await load('siteStudioRun.ts'); const run = RUN.create({ project: 'shop', prompt: 'hi', mode: 'build', model: 'm' }); await runs.save(run);
  ok('a run is saved and loaded back whole', (await runs.load(run.id)).prompt === 'hi' && (await runs.list('shop')).length === 1); ok('another member cannot load my run', (await S.makeRuns(rest, B).load(run.id)) === null && (await S.makeRuns(rest, B).list('shop')).length === 0);
  const l1 = await runs.lease(run.id, 30000), l2 = await runs.lease(run.id, 30000); ok('only ONE request may advance a run at a time', l1 === true && l2 === false);
  const row = pg.tables.pholama_site_runs[0]; row.data.leaseUntil = Date.now() - 1; ok('...and an expired lease can be taken again (a crashed request never jams a run)', (await runs.lease(run.id, 30000)) === true);
  // database doc
  const dbs = S.makeDbStore(rest, A); let doc = await dbs.load('shop'); ok('a new project starts with the database off', doc.enabled === false); D.enable(doc, 'ai'); await dbs.save('shop', doc); ok('the database document round-trips', (await dbs.load('shop')).enabled === true && (await S.makeDbStore(rest, B).load('shop')).enabled === false);
  // the full engine on the real adapters
  await core.createProject(a, 'live'); const sc = ctx(A); const cp2 = S.makeCheckpoints(rest, A); const rr = S.makeRuns(rest, A); const rn = RUN.create({ project: 'live', prompt: 'say hi', mode: 'build', model: 'm' }); const script = ['["Greet"]', '<tool_call>{"name":"studio_patch","arguments":{"file":"index.html","find":"<h1>live</h1>","replace":"<h1>Hi</h1>"}}</tool_call>', 'Done.']; let i = 0;
  await Eng.execute(rn, { c: sc, checkpoints: cp2, runs: rr, callModel: async () => script[Math.min(i++, script.length - 1)], tools: Eng.makeTools({ c: sc }) });
  ok('the whole engine runs on the Supabase adapters', rn.status === 'completed' && (await sc.store.getFile('live', 'index.html')).includes('<h1>Hi</h1>') && (await rr.load(rn.id)).status === 'completed', rn.status + ' ' + rn.error);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
