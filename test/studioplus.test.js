// Studio extras: folders, pictures, project map, search, to-do, publish check. Uses a temp folder, never real projects.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.PHOLAMA_STUDIO = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sp-'));
const stu = require('../server/studio'), sp = require('../server/studioplus');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
const throws = (f) => { try { f(); return null; } catch (e) { return e.message; } };

// tiny real pictures
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');   // 1x1
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');   // 1x1
const b64 = b => b.toString('base64');

stu.createProject('demo');
ok('a new project has the three starter files', stu.snapshot('demo').length === 3);

// ---- folders
ok('make a folder', sp.mkdir('demo', 'img').existed === false);
ok('making it again is harmless', sp.mkdir('demo', 'img').existed === true);
ok('nested folders work', sp.mkdir('demo', 'js/lib').name === 'js/lib');
ok('an empty folder shows in the tree', /img\//.test(sp.tree('demo')) && /js\/lib\//.test(sp.tree('demo')), sp.tree('demo'));
ok('a file can be written into a folder with the old writer', stu.writeFile('demo', 'js/lib/util.js', 'function add(a,b){return a+b}\n').created === true);
ok('.. is refused', /bad path/.test(throws(() => sp.mkdir('demo', '../evil')) || ''));
ok('a leading .. deep in the path is refused', /bad path/.test(throws(() => sp.mkdir('demo', 'a/../../evil')) || ''));
ok('an absolute path is kept inside the project', sp.mkdir('demo', '/abs').name === 'abs' && fs.existsSync(path.join(stu.ROOT, 'demo', 'abs')));
ok('hidden folders are refused', /bad path/.test(throws(() => sp.mkdir('demo', '.git')) || ''));
ok('odd characters are refused', /names may use/.test(throws(() => sp.mkdir('demo', 'a;b')) || ''));
ok('too deep is refused', /deep/.test(throws(() => sp.mkdir('demo', 'a/b/c/d/e/f')) || ''));
ok('nothing was created outside the studio root', !fs.existsSync(path.join(stu.ROOT, '..', 'evil')) && !fs.existsSync(path.join(stu.ROOT, 'evil')));
for (let i = 0; i < 40; i++) throws(() => sp.mkdir('demo', 'f' + i));
ok('the folder limit holds (30)', sp.walkAll(path.join(stu.ROOT, 'demo')).dirs.length <= 30, sp.walkAll(path.join(stu.ROOT, 'demo')).dirs.length);
for (let i = 0; i < 40; i++) throws(() => sp.rmdir('demo', 'f' + i));
ok('delete a folder with its files', /Deleted folder js\/lib and its 1 file/.test(sp.rmdir('demo', 'js/lib')));
ok('deleting a missing folder is an error', /no such folder/.test(throws(() => sp.rmdir('demo', 'nope')) || ''));
ok('rmdir on a FILE is refused and the file survives', /no such folder/.test(throws(() => sp.rmdir('demo', 'index.html')) || '') && fs.existsSync(path.join(stu.ROOT, 'demo', 'index.html')));

// ---- move / copy
ok('rename a file', /Moved style.css to css\/main.css/.test(sp.move('demo', 'style.css', 'css/main.css')) && fs.existsSync(path.join(stu.ROOT, 'demo', 'css', 'main.css')));
ok('the old name is gone', !fs.existsSync(path.join(stu.ROOT, 'demo', 'style.css')));
ok('move never overwrites', /already exists/.test(throws(() => sp.move('demo', 'script.js', 'index.html')) || ''));
ok('changing the file type on move is refused', /same file type/.test(throws(() => sp.move('demo', 'script.js', 'script.txt')) || ''));
ok('move a whole folder', (sp.mkdir('demo', 'old'), stu.writeFile('demo', 'old/a.txt', 'x'), /Moved old to newer/.test(sp.move('demo', 'old', 'newer'))) && fs.existsSync(path.join(stu.ROOT, 'demo', 'newer', 'a.txt')));
ok('a folder cannot move into itself', /into itself/.test(throws(() => sp.move('demo', 'newer', 'newer/deeper')) || ''));
ok('move out of the project is refused', /bad path/.test(throws(() => sp.move('demo', 'script.js', '../stolen.js')) || ''));
ok('move from outside the project is refused', /bad path/.test(throws(() => sp.move('demo', '../../etc/passwd', 'x.txt')) || ''));
ok('copy a file', /Copied script.js to copy.js/.test(sp.copy('demo', 'script.js', 'copy.js')) && fs.readFileSync(path.join(stu.ROOT, 'demo', 'copy.js'), 'utf8') === fs.readFileSync(path.join(stu.ROOT, 'demo', 'script.js'), 'utf8'));
ok('copy never overwrites', /already exists/.test(throws(() => sp.copy('demo', 'script.js', 'copy.js')) || ''));
ok('copy of a folder is refused', /one file/.test(throws(() => sp.copy('demo', 'newer', 'newer2')) || ''));

// ---- pictures
const r = sp.saveImage('demo', 'img/dot.png', b64(PNG));
ok('save a real PNG', r.created && r.type === 'image/png' && r.w === 1 && r.h === 1, JSON.stringify(r));
ok('a data: URL prefix is accepted', sp.saveImage('demo', 'img/dot2.png', 'data:image/png;base64,' + b64(PNG)).created);
ok('save a real GIF with its size', (x => x.type === 'image/gif' && x.w === 1 && x.h === 1)(sp.saveImage('demo', 'g.gif', b64(GIF))));
ok('saving again replaces (not "created")', sp.saveImage('demo', 'img/dot.png', b64(PNG)).created === false);
ok('a text file renamed .png is refused', /not a real picture/.test(throws(() => sp.saveImage('demo', 'fake.png', Buffer.from('<script>alert(1)</script> hello world').toString('base64'))) || ''));
ok('an HTML file disguised as .jpg is refused', /not a real picture/.test(throws(() => sp.saveImage('demo', 'fake.jpg', Buffer.from('<html><body>hi there friend</body></html>').toString('base64'))) || ''));
ok('a PNG named .jpg is refused (name and content must match)', /the name says jpeg but the picture is png/.test(throws(() => sp.saveImage('demo', 'lie.jpg', b64(PNG))) || ''));
ok('.svg is NOT a picture upload (it can carry scripts)', /pictures must be/.test(throws(() => sp.saveImage('demo', 'x.svg', b64(PNG))) || ''));
ok('.exe is refused', /pictures must be/.test(throws(() => sp.saveImage('demo', 'x.exe', b64(PNG))) || ''));
ok('garbage base64 is refused', /not picture data/.test(throws(() => sp.saveImage('demo', 'bad.png', '%%%not base64%%%')) || ''));
ok('empty data is refused', /not picture data/.test(throws(() => sp.saveImage('demo', 'e.png', '')) || ''));
ok('a 2 MB picture is refused', /too big/.test(throws(() => sp.saveImage('demo', 'huge.png', b64(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])))) || ''));
ok('a picture cannot escape the project', /bad path/.test(throws(() => sp.saveImage('demo', '../out.png', b64(PNG))) || '') && !fs.existsSync(path.join(stu.ROOT, 'out.png')));
ok('read a picture back byte for byte', (x => Buffer.from(x.data, 'base64').equals(PNG) && x.type === 'image/png')(sp.readImage('demo', 'img/dot.png')));
ok('image info', /img\/dot.png: png, 1x1 px, \d+ bytes/.test(sp.imageInfo('demo', 'img/dot.png')));
ok('reading a non-picture as a picture is refused', /not a picture/.test(throws(() => sp.readImage('demo', 'index.html')) || ''));
ok('a damaged picture file is caught', (fs.writeFileSync(path.join(stu.ROOT, 'demo', 'broken.png'), 'this is not a png at all, just text'), /damaged/.test(throws(() => sp.readImage('demo', 'broken.png')) || '')));
fs.unlinkSync(path.join(stu.ROOT, 'demo', 'broken.png'));
for (let i = 0; i < 25; i++) throws(() => sp.saveImage('demo', 'many' + i + '.png', b64(PNG)));
ok('the picture limit holds (20)', sp.walkAll(path.join(stu.ROOT, 'demo')).files.filter(f => f.image).length <= 20, sp.walkAll(path.join(stu.ROOT, 'demo')).files.filter(f => f.image).length);
for (const f of sp.walkAll(path.join(stu.ROOT, 'demo')).files.filter(f => /many/.test(f.name))) fs.unlinkSync(path.join(stu.ROOT, 'demo', f.name));
ok('pictures are left out of the text files (so they are never read or saved as garbled text)', sp.textFiles('demo').every(f => !sp.isImageName(f.name)));
ok('the tree marks pictures', /dot\.png\s+\[picture\]/.test(sp.tree('demo')), sp.tree('demo'));

// ---- the project map (research)
stu.writeFile('demo', 'index.html', '<!doctype html><html><head><title>My Game</title><link rel="stylesheet" href="css/main.css"></head><body><canvas id="board"></canvas><button id="go">Go</button><script src="script.js"></script></body></html>');
stu.writeFile('demo', 'script.js', 'function start(){ document.getElementById("go").addEventListener("click", draw); }\nconst draw = () => { document.getElementById("board"); };\nstart();\n');
const map = sp.projectMap('demo');
ok('the map lists the project', /PROJECT "demo"/.test(map), map);
ok('the map shows the html title and ids', /title: My Game/.test(map) && /#board/.test(map) && /#go/.test(map), map);
ok('the map shows js functions and events', /functions: start, draw/.test(map) && /events: click/.test(map), map);
ok('the map shows what the js reads', /reads: #go #board/.test(map), map);
ok('the map shows css rules', /rules: body/.test(map), map);
ok('the map says there are no problems when clean', /No known problems|KNOWN PROBLEMS/.test(map));
ok('the map stays short', map.length <= 2600, map.length);
stu.writeFile('demo', 'big.js', Array.from({ length: 400 }, (_, i) => 'function f' + i + '(){}').join('\n'));
ok('a huge project still gives a short map', sp.projectMap('demo').length <= 2600);
fs.unlinkSync(path.join(stu.ROOT, 'demo', 'big.js'));
stu.writeFile('demo', 'index.html', '<!doctype html><html><body><script src="missing.js"></script></body></html>');
ok('the map reports a known problem', /KNOWN PROBLEMS[\s\S]*missing.js/.test(sp.projectMap('demo')));
ok('outline of one file', /functions: start, draw/.test(sp.outlineOne('demo', 'script.js')));
ok('outline of a picture gives its size', /png, 1x1/.test(sp.outlineOne('demo', 'img/dot.png')));
ok('outline of a missing file is an error', /no such file/.test(throws(() => sp.outlineOne('demo', 'nope.js')) || ''));

// ---- search
ok('search finds text with file and line', /script\.js:1: function start/.test(sp.searchText('demo', 'function start')), sp.searchText('demo', 'function start'));
ok('search ignores case', /script\.js/.test(sp.searchText('demo', 'GETELEMENTBYID')));
ok('search says when nothing matches', /No matches/.test(sp.searchText('demo', 'zzzqqq')));
ok('search needs 2 characters', /at least 2/.test(throws(() => sp.searchText('demo', 'a')) || ''));
ok('search does not read pictures (the PNG header text is not found)', /^No matches/.test(sp.searchText('demo', 'IHDR')) && !/dot\.png:\d/.test(sp.searchText('demo', 'IHDR')));

// ---- to-do
ok('save a to-do list', sp.todoWrite('demo', ['add a score', 'add sound']).name === 'TODO.md');
ok('the list is readable text', /- \[ \] add a score/.test(sp.todoRead('demo')) && /- \[ \] add sound/.test(sp.todoRead('demo')));
ok('ticked items are kept ticked', (sp.todoWrite('demo', ['- [x] done thing', 'next']), /- \[x\] done thing/.test(sp.todoRead('demo'))));
ok('an empty list is refused', /at least one task/.test(throws(() => sp.todoWrite('demo', [])) || ''));

// ---- publish check
stu.createProject('good');
let v = sp.verify('good');
ok('a fresh project passes the check', v.pass && v.fail === 0, JSON.stringify(v.steps.filter(s => s.status !== 'ok')));
ok('every step has a title, a status and a detail', v.steps.every(s => s.id && s.title && ['ok', 'warn', 'fail'].includes(s.status) && s.detail));
ok('there are several real steps', v.steps.length >= 8, v.steps.length);
v = sp.verify('demo');
ok('a missing linked file fails the check', !v.pass && v.steps.find(s => s.id === 'links').status === 'fail' && /missing\.js/.test(v.steps.find(s => s.id === 'links').detail), JSON.stringify(v.steps.find(s => s.id === 'links')));
stu.createProject('nosyntax'); stu.writeFile('nosyntax', 'script.js', 'function (((');
ok('a broken script fails the check', sp.verify('nosyntax').steps.find(s => s.id === 'scripts').status === 'fail');
stu.createProject('secrets'); stu.writeFile('secrets', 'script.js', 'const k = "gsk_abcdefghijklmnop1234567890";');
ok('a secret key fails the check', sp.verify('secrets').steps.find(s => s.id === 'secrets').status === 'fail' && !sp.verify('secrets').pass);
ok('the check names the file, never prints the key', !JSON.stringify(sp.verify('secrets')).includes('gsk_abcdefghijklmnop'));
stu.createProject('noindex', 'empty'); stu.writeFile('noindex', 'a.txt', 'hi');
ok('no index.html fails the check', sp.verify('noindex').steps.find(s => s.id === 'entry').status === 'fail');
stu.createProject('empty1', 'empty');
ok('an empty project fails the check', sp.verify('empty1').steps.find(s => s.id === 'files').status === 'fail');
stu.createProject('alt'); stu.writeFile('alt', 'index.html', '<!doctype html><html><body><img src="a.png"></body></html>'); sp.saveImage('alt', 'a.png', b64(PNG));
ok('an image with no alt text is a warning, not a failure', sp.verify('alt').steps.find(s => s.id === 'access').status === 'warn' && sp.verify('alt').pass);
stu.createProject('lonely'); sp.saveImage('lonely', 'unused.png', b64(PNG));
ok('an unused picture is a warning', sp.verify('lonely').steps.find(s => s.id === 'pictures').status === 'warn');
ok('the summary says what to do', /problem.*fix|Ready|passed/.test(sp.verify('demo').summary), sp.verify('demo').summary);

// ---- pictures and the old file layer must agree (regression: a linked picture was reported as a missing file)
stu.createProject('pics'); stu.writeFile('pics', 'index.html', '<!doctype html><html><body><img src="art/cat.png" alt="cat"></body></html>'); sp.saveImage('pics', 'art/cat.png', b64(PNG));
ok('a page linking to a real picture has NO missing-file problem', !stu.check('pics').some(x => /does not exist/.test(x)), stu.check('pics'));
ok('a page linking to a picture that is not there still reports it', (stu.writeFile('pics', 'index.html', '<!doctype html><html><body><img src="art/none.png" alt="x"></body></html>'), stu.check('pics').some(x => /art\/none\.png which does not exist/.test(x))));
ok('the editor snapshot never contains picture bytes', !stu.snapshot('pics').some(f => sp.isImageName(f.name)));
const before = fs.readFileSync(path.join(stu.ROOT, 'pics', 'art', 'cat.png'));
for (const f of stu.snapshot('pics')) stu.writeFile('pics', f.name, f.content);   // what an undo / backup restore does
ok('a snapshot restore leaves the picture byte for byte intact', fs.readFileSync(path.join(stu.ROOT, 'pics', 'art', 'cat.png')).equals(before));
stu.createProject('quota'); for (let i = 0; i < 20; i++) sp.saveImage('quota', 'p' + i + '.png', b64(PNG));
let nt = 0; try { for (let i = 0; i < 60; i++) { stu.writeFile('quota', 'f' + i + '.txt', 'x'); nt++; } } catch {}
ok('20 pictures do not use up the text-file quota', nt >= 56, nt);

// ---- the tools the AI calls
const names = sp.tools().map(t => t.name);
for (const n of ['studio_map', 'studio_tree', 'studio_outline', 'studio_search', 'studio_mkdir', 'studio_rmdir', 'studio_move', 'studio_copy', 'studio_image_info', 'studio_todo', 'studio_verify']) ok('tool exists: ' + n, names.includes(n));
ok('tools have usable descriptions', sp.tools().every(t => t.desc.length > 20 && /args:/.test(t.desc)));
ok('a tool runs through run()', /PROJECT "good"/.test(sp.run('studio_map', { project: 'good' })));
ok('studio_verify output is readable', /OK .*index.html/.test(sp.run('studio_verify', { project: 'good' })) && /Ready|passed/.test(sp.run('studio_verify', { project: 'good' })));
ok('studio_mkdir / studio_move via run()', /Made folder zz/.test(sp.run('studio_mkdir', { project: 'good', folder: 'zz' })) && /Moved script.js to zz\/script.js/.test(sp.run('studio_move', { project: 'good', from: 'script.js', to: 'zz/script.js' })));
ok('an unknown tool is refused', /unknown studio tool/.test(throws(() => sp.run('studio_hack', {})) || ''));
ok('bad args do not crash', /./.test(throws(() => sp.run('studio_map', null)) || 'threw'));
ok('a path with a null byte is refused', /bad path/.test(throws(() => sp.mkdir('demo', 'a\0b')) || ''));
ok('a huge name is refused', /bad path/.test(throws(() => sp.mkdir('demo', 'x'.repeat(200))) || ''));
ok('a project name cannot escape', /./.test(throws(() => sp.tree('../../etc')) || 'threw') && !fs.existsSync('/etc/ph-test'));

fs.rmSync(process.env.PHOLAMA_STUDIO, { recursive: true, force: true });
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
