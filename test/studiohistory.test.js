// Studio version history: checkpoint, list, diff, restore (and undo the restore), limits, and bad input.
const fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pholama-hist-'));
process.env.PHOLAMA_STUDIO = path.join(base, 'studio'); process.env.PHOLAMA_STUDIO_HISTORY = path.join(base, 'hist');
const stu = require('../server/studio.js'), H = require('../server/studiohistory.js');
const snapObj = p => Object.fromEntries(stu.snapshot(p).map(f => [f.name, f.content]));
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
const throws = f => { try { f(); return false; } catch (e) { return e.message; } };

stu.createProject('demo', 'blank'); stu.writeFile('demo', 'index.html', '<h1>Hello</h1>\n<p>one</p>\n'); stu.writeFile('demo', 'style.css', 'h1{color:red}\n');
const c1 = H.save(stu, 'demo', 'First version', { by: 'user' });
ok('save returns a checkpoint with id, label, who, file count', c1 && /^\d{13}-[a-z0-9]{4}$/.test(c1.id) && c1.label === 'First version' && c1.by === 'user' && c1.fileCount >= 2, JSON.stringify(c1));
ok('saving again with nothing changed makes no duplicate', H.save(stu, 'demo', 'again') === null && H.list(stu, 'demo').length === 1);
ok('force saves even when nothing changed', H.save(stu, 'demo', 'forced', { force: true }) !== null && H.list(stu, 'demo').length === 2);
ok('the list never contains file contents', !JSON.stringify(H.list(stu, 'demo')).includes('Hello'));
ok('checkpoints are stored outside the project (not in its file list)', !Object.keys(snapObj('demo')).some(f => /history|\.json$/.test(f)) && fs.existsSync(path.join(base, 'hist', 'demo')));

stu.writeFile('demo', 'index.html', '<h1>Hello world</h1>\n<p>one</p>\n<p>two</p>\n'); stu.deleteFile('demo', 'style.css'); stu.writeFile('demo', 'app.js', 'console.log(1)\n');
const d = H.compare(stu, 'demo', c1.id), by = Object.fromEntries(d.map(x => [x.file, x]));
ok('diff finds a changed file', by['index.html'] && by['index.html'].status === 'changed', JSON.stringify(d.map(x => x.file + ':' + x.status)));
ok('diff counts added and removed lines correctly', by['index.html'].added === 2 && by['index.html'].removed === 1, JSON.stringify([by['index.html'].added, by['index.html'].removed]));
ok('diff finds a removed file', by['style.css'] && by['style.css'].status === 'removed' && by['style.css'].removed === 1);
ok('diff finds an added file', by['app.js'] && by['app.js'].status === 'added' && by['app.js'].added >= 1);
ok('diff hunks show +/- lines with the text', by['index.html'].hunks[0].lines.some(l => l.t === '+' && l.s.includes('two')) && by['index.html'].hunks[0].lines.some(l => l.t === '-' && l.s.includes('Hello</h1>')));
ok('an unchanged file is not in the diff', !('x.txt' in by) && d.every(x => x.status !== 'same'));
ok('comparing two checkpoints works', (() => { const c2 = H.save(stu, 'demo', 'Second', { by: 'ai' }); return H.compare(stu, 'demo', c1.id, c2.id).length === 3; })());

const before = H.list(stu, 'demo').length, r = H.restore(stu, 'demo', c1.id), snap = snapObj('demo');
ok('restore brings back the old content', snap['index.html'] === '<h1>Hello</h1>\n<p>one</p>\n' && snap['style.css'] === 'h1{color:red}\n', JSON.stringify(snap));
ok('restore removes files that did not exist then', !('app.js' in snap));
ok('restore saved the current state first (so it can be undone)', r.undo && H.list(stu, 'demo').length === before + 1 && H.list(stu, 'demo')[0].by === 'restore');
H.restore(stu, 'demo', r.undo);
ok('undoing the restore puts the later work back', snapObj('demo')['app.js'] === 'console.log(1)\n' && snapObj('demo')['index.html'].includes('two'));

ok('a bad checkpoint id is refused', /bad checkpoint id/.test(throws(() => H.load(stu, 'demo', '../../etc/passwd'))) && /bad checkpoint id/.test(throws(() => H.restore(stu, 'demo', 'abc'))));
ok('a path-like checkpoint id cannot read other files', /bad checkpoint id/.test(throws(() => H.load(stu, 'demo', '1234567890123-abcd/../../x'))));
ok('an unknown checkpoint gives a clear message', /no longer exists/.test(throws(() => H.load(stu, 'demo', '1234567890123-zzzz'))));
ok('a bad project name cannot escape the history folder', (() => { const m = throws(() => H.list(stu, '../../etc')); return true; })() && !fs.existsSync(path.join(base, 'etc')));
ok('a project with no history lists as empty', H.list(stu, 'demo2-none').length === 0);

for (let i = 0; i < H.MAX_CHECKPOINTS + 8; i++) { stu.writeFile('demo', 'n.txt', 'v' + i); H.save(stu, 'demo', 'v' + i); }
ok('only the newest ' + H.MAX_CHECKPOINTS + ' checkpoints are kept', H.list(stu, 'demo').length === H.MAX_CHECKPOINTS);
ok('the newest checkpoint survives the cleanup', H.list(stu, 'demo')[0].label === 'v' + (H.MAX_CHECKPOINTS + 7));
ok('delete removes one checkpoint', (() => { const id = H.list(stu, 'demo')[0].id, c = H.list(stu, 'demo').length; H.remove(stu, 'demo', id); return H.list(stu, 'demo').length === c - 1; })());

const big = Array.from({ length: 3000 }, (_, i) => 'line ' + i).join('\n'), big2 = Array.from({ length: 3000 }, (_, i) => 'LINE ' + i).join('\n');
const t0 = Date.now(), bd = H.diffLines(big, big2);
ok('a huge diff finishes fast and does not freeze', Date.now() - t0 < 2000 && bd.hunks[0].type === 'too-big', Date.now() - t0);
ok('identical text has an empty diff', (() => { const x = H.diffLines('a\nb\n', 'a\nb\n'); return x.added === 0 && x.removed === 0 && x.hunks.length === 0; })());
ok('windows line endings do not break the diff', H.diffLines('a\r\nb', 'a\r\nc').added === 1);

fs.rmSync(base, { recursive: true, force: true });
console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
