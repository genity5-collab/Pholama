// Secrets + Database inside the PC Studio, end to end over the REAL routes and the REAL engine (only the AI's replies are scripted).
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')); Object.assign(process.env, { PHOLAMA_STUDIO: base + '/s', PHOLAMA_STUDIO_HISTORY: base + '/h', PHOLAMA_STUDIO_RUNS: base + '/r', PHOLAMA_PRIVATE: base + '/p' });
const sr = require('../server/studioroutes'), stu = require('../server/studio'), agent = require('../server/agent'), sec = require('../server/studiosecrets'), db = require('../server/studiodb'), svc = require('../server/studioservices');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const KEY = 'sk-proj-' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7', GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const tool = (n, a) => '<tool_call>' + JSON.stringify({ name: n, arguments: a }) + '</tool_call>';
let script = [], seen = [];
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const deps = { json, body, models: [{ id: 'm', name: 'm', tools: true }], terminal: false, toolNames: [], parseTool: t => agent.parseTool(t, null),
  callModel: () => async msgs => { seen.push(JSON.stringify(msgs)); return script.length > 1 ? script.shift() : script[0]; }, runTool: async (n, a) => stu.run(n, a) };
const srv = http.createServer((req, res) => { req.who = 'local'; sr.handle(req, res, new URL(req.url, 'http://x'), deps); }).listen(0, '127.0.0.1');
const call = async (m, p, b) => { const r = await fetch('http://127.0.0.1:' + srv.address().port + '/api/studio/ws/' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const waitRun = async id => { for (let i = 0; i < 80; i++) { const r = (await call('GET', 'runs/' + id)).j; const run = r.run || r; if (['completed', 'failed', 'cancelled', 'done'].includes(run.status)) return run; await new Promise(r => setTimeout(r, 150)); } return (await call('GET', 'runs/' + id)).j; };
(async () => {
  await new Promise(r => srv.on('listening', r)); stu.createProject('app');
  // --- a pasted key never reaches the model, the run record, or the files
  script = ['["Wire up the AI"]', tool('studio_write', { project: 'app', file: 'server.js', content: 'const key = "' + KEY + '";\nconsole.log(key);\n' }), 'Done.'];
  let r = await call('POST', 'runs', { project: 'app', prompt: 'Build a bot. My key is OPENAI_API_KEY=' + KEY + ' and a github token ' + GH, model: 'm', mode: 'build' });
  ok('the run starts', r.s === 202 && r.j.id, JSON.stringify(r.j).slice(0, 200)); const id = r.j.id; const run = await waitRun(id);
  ok('both keys were saved for the project', sec.count('app') === 2 && sec.values('app').OPENAI_API_KEY === KEY && sec.values('app').GITHUB_TOKEN === GH);
  ok('the run record the screen shows has NO key', !JSON.stringify(run).includes(KEY) && !JSON.stringify(run).includes(GH), JSON.stringify(run).slice(0, 200));
  ok('the saved prompt shows the safe reference instead', /\{\{secret:OPENAI_API_KEY\}\}/.test(run.prompt || ''), run.prompt);
  ok('the user is told what was saved (names, not values)', /OPENAI_API_KEY/.test(run.notice || '') && !(run.notice || '').includes(KEY), run.notice);
  { const hit = seen.map((m, i) => [i, m]).filter(([, m]) => m.includes(KEY) || m.includes(GH)); if (hit.length) { const [i, m] = hit[0]; const at = m.indexOf(KEY) >= 0 ? m.indexOf(KEY) : m.indexOf(GH); console.log('DEBUG request #' + i + ' of ' + seen.length + ' holds a key near: ...' + m.slice(Math.max(0, at - 160), at + 60).replace(/\\n/g, ' ')); } }
  ok('the MODEL never received a key (not in any request it got)', seen.length > 0 && seen.every(m => !m.includes(KEY) && !m.includes(GH)), seen.find(m => m.includes(KEY)) && 'LEAKED');
  ok('the model WAS told the secret names and how to use them', seen.some(m => /OPENAI_API_KEY/.test(m) && /process\.env/.test(m)));
  const written = fs.readFileSync(path.join(base, 's', 'app', 'server.js'), 'utf8');
  ok('even when the AI tried to write the key into a file, it was swapped for a reference', !written.includes(KEY) && /\{\{secret:OPENAI_API_KEY\}\}/.test(written), written);
  ok('the run history on disk has no key anywhere', !fs.readdirSync(path.join(base, 'r')).some(f => fs.readFileSync(path.join(base, 'r', f), 'utf8').includes(KEY)));
  const allFiles = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? w(path.join(d, e.name)) : allFiles.push(path.join(d, e.name)); })(base);
  const holders = allFiles.filter(f => !f.includes(path.join(base, 'p')) && fs.readFileSync(f, 'utf8').includes(KEY)); ok('nowhere on disk outside the private store holds the key', holders.length === 0, holders.join(', '));
  // --- manual secrets over HTTP
  let m = await call('POST', 'secrets/app', { name: 'stripe key', value: 'sk_live_' + 'abcdefghijklmnopqrstuv1234' }); ok('a secret can be added by hand', m.s === 200 && m.j.name === 'STRIPE_KEY' && m.j.source === 'manual', JSON.stringify(m.j));
  m = await call('GET', 'secrets/app'); ok('the list shows names and previews, never values', m.j.secrets.length === 3 && m.j.max === 10 && !JSON.stringify(m.j).includes(KEY) && !JSON.stringify(m.j).includes('abcdefghijklmnopqrstuv1234'));
  for (let i = 0; i < 7; i++) await call('POST', 'secrets/app', { name: 'extra' + i, value: 'value-' + i + '-abcdefgh' }); m = await call('POST', 'secrets/app', { name: 'one more', value: 'value-zzzzzzzz' }); ok('the 11th is refused with a clear message', m.s === 400 && /10 secrets/.test(m.j.error), JSON.stringify(m.j));
  m = await call('DELETE', 'secrets/app/STRIPE_KEY'); ok('a secret can be deleted', m.j.removed === true && sec.count('app') === 9);
  m = await call('POST', 'secrets/..%2Fx', { name: 'a', value: 'bbbbbbbbbb' }); ok('a secret for a project that does not exist is refused', m.s === 404 || m.s === 400, m.s); m = await call('POST', 'secrets/nosuchproject', { name: 'a', value: 'bbbbbbbbbb' }); ok('...and nothing was created for it', m.s === 404 && sec.count('nosuchproject') === 0, m.s);
  // --- database: the AI sets it up, a person cannot
  ok('a person cannot turn it on over HTTP', (await call('POST', 'db/app', { enable: true })).s === 403 && db.status('app').enabled === false);
  ok('...or create a table', (await call('PUT', 'db/app/tables/x', { columns: [] })).s === 403);
  ok('...or drop one', (await call('DELETE', 'db/app/tables/x')).s === 403);
  ok('a person can see the status (off)', (await call('GET', 'db/app')).j.enabled === false);
  script = ['["Add accounts"]', tool('studio_db_status', { project: 'app' }), tool('studio_db_enable', { project: 'app' }), tool('studio_db_create_table', { project: 'app', table: 'scores', columns: [{ name: 'player' }, { name: 'points', type: 'number' }] }), tool('studio_db_status', { project: 'app' }), 'Done.'];
  seen = []; r = await call('POST', 'runs', { project: 'app', prompt: 'add a leaderboard with accounts', model: 'm', mode: 'build' }); await waitRun(r.j.id);
  ok('the AI turned it on through its tool', db.status('app').enabled === true);
  ok('the AI created the table through its tool', db.status('app').tables.some(t => t.name === 'scores' && t.columns.points === 'number'));
  m = await call('GET', 'db/app'); ok('a person sees status, tables, size and the sign-in rule', m.j.enabled && m.j.tables[0].name === 'scores' && m.j.limitBytes === 10485760 && m.j.rules.signInsPerWeek === 10 && m.j.rules.breakHours === 4, JSON.stringify(m.j).slice(0, 250));
  await db.insert('app', 'scores', { player: 'ana', points: 7 }); m = await call('GET', 'db/app/rows/scores'); ok('a person can read the rows', m.j.rows.length === 1 && m.j.rows[0].player === 'ana');
  await db.signUp('app', 'ana@example.com', 'passw0rd-ok'); m = await call('GET', 'db/app'); ok('status counts accounts but shows no emails or hashes', m.j.accounts === 1 && !JSON.stringify(m.j).includes('ana@example.com') && !/hash|salt/.test(JSON.stringify(m.j)));
  m = await call('DELETE', 'db/app/account/ana@example.com'); ok('a person can remove one of their app\'s users', m.j.removed === 1);
  ok('the model was told the database rules the moment it turned it on', seen.some(x => /10 times a week/.test(x) && /4 hour break/.test(x)));
  // --- the write guard also covers patch edits
  stu.writeFile('app', 'a.js', 'const k = process.env.OPENAI_API_KEY;\n'); stu.patchFile('app', 'a.js', 'process.env.OPENAI_API_KEY', '"' + KEY + '"'); ok('a patch cannot sneak a saved key into a file', !fs.readFileSync(path.join(base, 's', 'app', 'a.js'), 'utf8').includes(KEY));
  ok('the AI\'s secret tool returns names only', !(await svc.runTool('studio_secret_names', { project: 'app' })).includes(KEY) && /OPENAI_API_KEY/.test(await svc.runTool('studio_secret_names', { project: 'app' })));
  ok('the AI cannot read or print a value through any tool', !Object.keys(svc.TOOLS).some(n => /value|reveal|get_secret|read_secret/.test(n)));
  ok('a person who is not local is refused', await new Promise(res => { http.get; const s2 = http.createServer((q, p) => { q.who = 'remote'; sr.handle(q, p, new URL(q.url, 'http://x'), deps); }).listen(0, '127.0.0.1', async () => { const x = await fetch('http://127.0.0.1:' + s2.address().port + '/api/studio/ws/secrets/app'); res(x.status === 403); s2.close(); }); }));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); srv.close(); if (!process.env.KEEP) fs.rmSync(base, { recursive: true, force: true }); else console.log('kept', base); process.exit(bad ? 1 : 0);
})();
