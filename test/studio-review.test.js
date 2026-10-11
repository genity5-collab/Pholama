// The Studio engine against REAL project files (in a temp folder), with a scripted model standing in for the AI.
const fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-'));
process.env.PHOLAMA_STUDIO = path.join(base, 'studio'); process.env.PHOLAMA_STUDIO_HISTORY = path.join(base, 'hist'); process.env.PHOLAMA_STUDIO_RUNS = path.join(base, 'runs');
const stu = require('../server/studio'), runs = require('../server/studiorun'), eng = require('../server/studioengine'), ws = require('../server/studioworkspace'), agent = require('../server/agent');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const tool = (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>';
const mkDeps = script => { let i = 0; return { callModel: async () => { const r = script[Math.min(i++, script.length - 1)]; return typeof r === 'function' ? r() : r; }, runTool: async (n, a) => stu.run(n, a), parseTool: (t, n) => agent.parseTool(t, null), toolNames: [] }; };
const rv = require('../server/studioreview');
(async () => {
  stu.createProject('rv'); stu.writeFile('rv', 'index.html', '<!doctype html><html><body><h1>Old</h1><script src="app.js"></script></body></html>\n');
  stu.writeFile('rv', 'keep.txt', 'original\n');
  let r = runs.create({ project: 'rv', prompt: 'add app script and new heading', mode: 'build' });
  const out = await eng.execute(r.id, mkDeps(['["Add script","New heading"]',
    tool('studio_write', { file: 'app.js', content: 'console.log("hi");\n' }),
    tool('studio_patch', { file: 'index.html', find: '<h1>Old</h1>', replace: '<h1>New</h1>' }),
    tool('studio_write', { file: 'keep.txt', content: 'changed\n' }), 'Done.']));
  let list = rv.list(out);
  ok('every changed file is listed for review', list.files.length === 3 && ['app.js', 'index.html', 'keep.txt'].every(f => list.files.some(x => x.file === f)), JSON.stringify(list.files.map(f => f.file)));
  ok('each starts as pending', list.files.every(f => f.decision === 'pending'));
  ok('the list carries line counts for the diff view', list.files.every(f => typeof f.added === 'number' && typeof f.removed === 'number'));
  ok('each change carries the text from before the run (for the red/green view)', list.files.find(f => f.file === 'keep.txt').before === 'original\n' && list.files.find(f => f.file === 'app.js').before === '', JSON.stringify(list.files.map(f => [f.file, f.before])));
  rv.accept(out, 'index.html');
  ok('accept keeps the AI version on disk', stu.readFile('rv', 'index.html').includes('<h1>New</h1>'));
  ok('accept is recorded', rv.list(out).files.find(f => f.file === 'index.html').decision === 'accepted');
  rv.reject(out, 'keep.txt');
  ok('reject puts an edited file back as it was', stu.readFile('rv', 'keep.txt') === 'original\n', stu.readFile('rv', 'keep.txt'));
  rv.reject(out, 'app.js');
  ok('reject removes a file the run created', !stu.snapshot('rv').some(f => f.name === 'app.js'));
  ok('rejected files no longer show a change', !rv.list(out).files.some(f => f.file === 'keep.txt' || f.file === 'app.js'), JSON.stringify(rv.list(out).files.map(f => f.file)));
  let threw = ''; try { rv.accept(out, 'nope.txt'); } catch (e) { threw = e.message; }
  ok('accepting a file with no change is refused', /no change/.test(threw), threw);
  threw = ''; try { rv.reject(out, '../etc/passwd'); } catch (e) { threw = e.message; }
  ok('a path outside the project is refused', !!threw, threw);
  // reject-all / accept-all on a fresh run
  stu.createProject('rv2'); stu.writeFile('rv2', 'a.txt', 'one\n'); stu.writeFile('rv2', 'b.txt', 'two\n');
  let r2 = runs.create({ project: 'rv2', prompt: 'edit both', mode: 'build' });
  const o2 = await eng.execute(r2.id, mkDeps(['["Edit a","Edit b"]', tool('studio_write', { file: 'a.txt', content: 'ONE\n' }), tool('studio_write', { file: 'b.txt', content: 'TWO\n' }), 'Done.']));
  const ra = rv.rejectAll(o2);
  ok('reject all puts every file back', ra.count === 2 && stu.readFile('rv2', 'a.txt') === 'one\n' && stu.readFile('rv2', 'b.txt') === 'two\n', JSON.stringify(ra));
  stu.createProject('rv3'); stu.writeFile('rv3', 'a.txt', 'one\n');
  let r3 = runs.create({ project: 'rv3', prompt: 'edit', mode: 'build' });
  const o3 = await eng.execute(r3.id, mkDeps(['["Edit a"]', tool('studio_write', { file: 'a.txt', content: 'ONE\n' }), 'Done.']));
  const aa = rv.acceptAll(o3);
  ok('accept all keeps everything and counts it', aa.count === 1 && stu.readFile('rv3', 'a.txt') === 'ONE\n', JSON.stringify(aa));
  ok('accept all leaves nothing pending', rv.list(o3).files.every(f => f.decision === 'accepted'));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
