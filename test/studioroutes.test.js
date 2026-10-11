// The Studio workspace routes over real HTTP: local-only, validation, a streamed run, search, problems, diffs and revert.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'));
process.env.PHOLAMA_STUDIO = path.join(base, 's'); process.env.PHOLAMA_STUDIO_HISTORY = path.join(base, 'h'); process.env.PHOLAMA_STUDIO_RUNS = path.join(base, 'r');
const sr = require('../server/studioroutes'), stu = require('../server/studio'), agent = require('../server/agent');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const tool = (n, a) => '<tool_call>' + JSON.stringify({ name: n, arguments: a }) + '</tool_call>';
let who = 'local', script = [];
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const deps = { json, body, models: [{ id: 'm1', name: 'm1', tools: true }], terminal: false, toolNames: [], parseTool: (t) => agent.parseTool(t, null),
  callModel: () => async () => script.length > 1 ? script.shift() : script[0], runTool: async (n, a) => stu.run(n, a) };
const srv = http.createServer((req, res) => { req.who = who; sr.handle(req, res, new URL(req.url, 'http://x'), deps); });
const call = (m, p, b) => new Promise(r => { const q = http.request({ port: srv.address().port, path: p, method: m, headers: { 'content-type': 'application/json' } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ code: res.statusCode, j: (() => { try { return JSON.parse(d); } catch { return d; } })() })); }); if (b) q.write(JSON.stringify(b)); q.end(); });
srv.listen(0, '127.0.0.1', async () => {
  who = 'remote'; let r = await call('POST', '/api/studio/ws/runs', { prompt: 'do it', model: 'm1' }); ok('a remote caller (the public website) is refused', r.code === 403);
  who = 'local';
  r = await call('GET', '/api/studio/ws/capabilities'); ok('capabilities say what is really connected', r.j.modes.length === 4 && r.j.terminal.available === false && /No execution environment/.test(r.j.terminal.note) && r.j.models[0].id === 'm1', JSON.stringify(r.j).slice(0, 200));
  ok('every mode is listed with its limits', ['fast', 'build', 'think', 'repair'].every(m => r.j.modes.find(x => x.id === m)));
  r = await call('POST', '/api/studio/ws/runs', { prompt: 'hi', model: 'm1' }); ok('a too-short prompt is refused', r.code === 400);
  r = await call('POST', '/api/studio/ws/runs', { prompt: 'fix the page', project: 'nope', model: 'm1' }); ok('an unknown project is refused (404)', r.code === 404);
  r = await call('POST', '/api/studio/ws/runs', { prompt: 'fix the page', project: '../../etc' , model: 'm1' }); ok('a path-like project is refused', r.code === 400 || r.code === 404);
  r = await call('POST', '/api/studio/ws/runs', { prompt: 'fix the page', project: 'x' }); ok('a run without a model is refused', r.code === 400);
  stu.createProject('site'); stu.writeFile('site', 'index.html', '<!doctype html><html><body><h1>Old</h1><script src="gone.js"></script></body></html>\n');
  r = await call('GET', '/api/studio/ws/dashboard'); ok('the dashboard lists the real project', r.j.projects.some(p => p.name === 'site' && p.files >= 1), JSON.stringify(r.j));
  r = await call('POST', '/api/studio/ws/resolve', { text: 'open my site project' }); ok('"open my site" resolves to the real project', r.j.status === 'found' && r.j.project === 'site');
  stu.createProject('blog'); r = await call('POST', '/api/studio/ws/resolve', { text: 'start editing my older projects' }); ok('an unclear target asks which project', r.j.status === 'ask' && r.j.projects.includes('blog') && r.j.projects.includes('site'));
  script = ['["Add the script","New title"]', tool('studio_write', { file: 'gone.js', content: 'var a=1;\n' }), tool('studio_patch', { file: 'index.html', find: '<h1>Old</h1>', replace: '<h1>New</h1>' }), 'Done.'];
  r = await call('POST', '/api/studio/ws/runs', { prompt: 'fix the build and improve the heading', project: 'site', model: 'm1', mode: 'build' });
  ok('starting a run answers at once with an id', r.code === 202 && /^r/.test(r.j.id), JSON.stringify(r.j)); const id = r.j.id;
  let run; for (let i = 0; i < 80; i++) { await new Promise(x => setTimeout(x, 100)); run = (await call('GET', '/api/studio/ws/runs/' + id)).j.run; if (['completed', 'failed', 'cancelled'].includes(run.status)) break; }
  ok('the run finishes completed with verification', run.status === 'completed', JSON.stringify({ s: run.status, e: run.error }));
  ok('the saved run lists real steps', run.steps.length >= 4 && run.steps.every(s => s.status !== 'running'));
  r = await call('GET', '/api/studio/ws/runs?project=site'); ok('the run history lists it', r.j.runs.some(x => x.id === id && x.status === 'completed'));
  r = await call('GET', '/api/studio/ws/runs/' + id + '/diff'); ok('the diff shows both changed files', r.j.available && r.j.changes.length === 2, JSON.stringify(r.j).slice(0, 200));
  r = await call('GET', '/api/studio/ws/search?project=site&q=New'); ok('search finds text with file and line', r.j.hits.some(h => h.file === 'index.html' && h.line >= 1));
  r = await call('GET', '/api/studio/ws/problems?project=site'); ok('problems are empty after the fix', r.j.problems.length === 0, JSON.stringify(r.j));
  r = await call('POST', '/api/studio/ws/build', { project: 'site' }); ok('build reports a real pass', r.j.ok === true && r.j.code === 0);
  r = await call('POST', '/api/studio/ws/tests', { project: 'site' }); ok('tests say plainly that there are none (not a fake pass)', r.j.available === false && /no test files/.test(r.j.output));
  r = await call('POST', '/api/studio/ws/runs/' + id + '/revert', { file: 'gone.js' }); ok('rejecting one file works', r.j.ok && !fs.existsSync(path.join(process.env.PHOLAMA_STUDIO, 'site', 'gone.js')));
  r = await call('POST', '/api/studio/ws/build', { project: 'site' }); ok('build now fails again because the script is gone', r.j.ok === false && /gone\.js/.test(r.j.output));
  r = await call('PUT', '/api/studio/ws/runs/' + id + '/plan', { tasks: ['x'] }); ok('a finished run cannot have its plan edited', r.code === 400);
  r = await call('GET', '/api/studio/ws/runs/rzzzzzzzzzzz'); ok('an unknown run is a clean error', r.code === 400 && /no such run/.test(JSON.stringify(r.j)));
  r = await call('DELETE', '/api/studio/ws/runs/' + id); ok('a finished run can be deleted', r.j.ok);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); srv.close(); fs.rmSync(base, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
});
