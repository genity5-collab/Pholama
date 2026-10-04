// Pholama core checks. Run: node test/core.test.js   (no model needed, no network)
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-')); process.env.HOME = tmp; process.env.USERPROFILE = tmp;
process.env.PHOLAMA_WORKSPACE = path.join(tmp, 'ws'); process.env.PHOLAMA_STUDIO = path.join(tmp, 'studio');
let P = 0, F = 0; const ok = (n, c, x) => { if (c) P++; else { F++; console.log('FAIL', n, x === undefined ? '' : String(x).slice(0, 160)); } };
const thr = (n, f) => { try { f(); F++; console.log('FAIL (should refuse)', n); } catch { P++; } };
const root = path.join(__dirname, '..');
const cat = JSON.parse(fs.readFileSync(path.join(root, 'models.pc.json'), 'utf8'));

// ---- model tiers ----
ok('catalog size', cat.length >= 50);
ok('every model has a tier', cat.every(m => ['good', 'basic', 'none'].includes(m.toolTier)));
ok('tools tag only on good', cat.every(m => (m.caps.includes('tools')) === (m.toolTier === 'good')));
ok('Tool running list = good', cat.every(m => m.categories.includes('tools') === (m.toolTier === 'good')));
ok('no model under 3B is "good"', cat.filter(m => m.toolTier === 'good').every(m => m.sizeGB >= 1.8));
ok('tiny models are not good', cat.filter(m => m.sizeGB < 1.5).every(m => m.toolTier !== 'good'));
ok('known tool models are good', ['qwen2.5-7b', 'qwen3-8b', 'llama3.1-8b', 'hermes3-8b'].every(id => cat.find(m => m.id === id).toolTier === 'good'));
ok('known weak models have no tools', ['smollm2-135m', 'tinyllama-1.1b', 'gemma3-1b'].every(id => cat.find(m => m.id === id).toolTier === 'none'));
ok('ids unique', new Set(cat.map(m => m.id)).size === cat.length);
ok('files unique', new Set(cat.map(m => m.file)).size === cat.length);

// ---- parsing ----
const a = require('../server/agent.js');
const freshBuild = a.planGuidedBuild('Build a small memory game', '', [], 'fresh-project');
ok('fresh local Studio builds request linked HTML, CSS and JavaScript files', freshBuild && freshBuild.fresh && freshBuild.files.join() === 'index.html,style.css,script.js' && /just before <\/body>/.test(freshBuild.prompt));
const existingBuild = a.planGuidedBuild('Build a small memory game', '', [{ name: 'index.html', size: 1800 }], 'existing-project');
ok('guided builds leave existing nonstarter projects to the safe editing tools', existingBuild && !existingBuild.fresh);
const ownScript = a.planGuidedBuild('Write a JavaScript script to format a date', '', [], 'script-project');
ok('plain script requests remain single-file JavaScript', ownScript && ownScript.files.join() === 'script.js');
let t = a.parseTool('<tool>{"name":"calculator","args":{"expression":"2+2"}}</tool>'); ok('own tag', t && t.name === 'calculator' && t.args.expression === '2+2');
t = a.parseTool('<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>'); ok('hermes tag', t && t.name === 'read_file' && t.args.path === 'a.txt', JSON.stringify(t));
t = a.parseTool('<tool_call>{"name":"read_file","arguments":"{\\"path\\":\\"b.txt\\"}"}</tool_call>'); ok('arguments as string', t && t.args.path === 'b.txt', JSON.stringify(t));
t = a.parseTool('<tool_call>\n{"name": "current_time", "arguments": {}}'); ok('unclosed tag', t && t.name === 'current_time', JSON.stringify(t));
ok('plain text is not a tool', !a.parseTool('Hello there, how can I help?'));
ok('bad json is not a tool', !a.parseTool('<tool>{nope</tool>'));

// ---- workspace tools: works and cannot escape ----
const w = require('../server/tools2.js'); const out = path.join(tmp, 'outside'); fs.mkdirSync(out); fs.writeFileSync(path.join(out, 's.txt'), 'SECRET');
ok('write', /Created/.test(w.run('write_file', { path: 'n/a.txt', content: 'one\ntwo\none' })));
ok('read', /1: one/.test(w.run('read_file', { path: 'n/a.txt' })));
thr('edit ambiguous', () => w.run('edit_file', { path: 'n/a.txt', find: 'one', replace: 'x' }));
ok('edit', /Edited/.test(w.run('edit_file', { path: 'n/a.txt', find: 'two', replace: '2' })) && /2/.test(w.run('read_file', { path: 'n/a.txt' })));
ok('search', /a.txt:2/.test(w.run('search_files', { query: '2' })));
for (const bad of ['../outside/s.txt', 'n/../../outside/s.txt', out + '/s.txt', 'C:/Windows/win.ini', '..\\outside\\s.txt']) thr('escape ' + bad, () => w.run('read_file', { path: bad }));
thr('write outside', () => w.run('write_file', { path: '../outside/x.txt', content: 'x' }));
thr('exe blocked', () => w.run('write_file', { path: 'a.exe', content: 'x' }));
thr('bat blocked', () => w.run('write_file', { path: 'a.bat', content: 'x' }));
thr('too big', () => w.run('write_file', { path: 'big.txt', content: 'x'.repeat(300000) }));
try { fs.symlinkSync(out, path.join(process.env.PHOLAMA_WORKSPACE, 'link')); thr('symlink read', () => w.run('read_file', { path: 'link/s.txt' })); thr('symlink write', () => w.run('write_file', { path: 'link/n.txt', content: 'x' })); ok('symlink no leak', !fs.existsSync(path.join(out, 'n.txt'))); } catch {}
ok('units', w.run('convert_units', { value: 100, from: 'c', to: 'f' }) === '212 f');
ok('json path', w.run('json_tool', { text: '{"a":[{"c":5}]}', path: 'a.0.c' }) === '5');


// ---- website / PC app stay in step (the newest models and version must match everywhere) ----
{
  const rel = JSON.parse(fs.readFileSync(path.join(root, 'releases.json'), 'utf8')), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  ok('releases latest = package version', rel.latest === pkg.version, rel.latest + ' vs ' + pkg.version);
  ok('newest release is first', rel.releases[0].version === rel.latest);
  ok('every release has notes', rel.releases.every(r => r.version && r.date && r.title && r.notes && r.notes.length));
  for (const dir of ['docs', 'web']) {
    const site = JSON.parse(fs.readFileSync(path.join(root, dir, 'models.json'), 'utf8'));
    ok(dir + ' lists every PC model', JSON.stringify(site.local) === JSON.stringify(cat), (site.local || []).length + ' vs ' + cat.length);
    ok(dir + ' has the version history', JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, dir, 'releases.json'), 'utf8'))) === JSON.stringify(rel));
    ok(dir + ' has the dashboard', fs.existsSync(path.join(root, dir, 'dashboard.js')) && /id="dash"/.test(fs.readFileSync(path.join(root, dir, 'index.html'), 'utf8')));
    const sw = fs.readFileSync(path.join(root, dir, 'sw.js'), 'utf8'); ok(dir + ' offline cache has dashboard files', /dashboard\.js/.test(sw) && /releases\.json/.test(sw));
  }
  ok('dashboard.js identical in docs and web', fs.readFileSync(path.join(root, 'docs/dashboard.js'), 'utf8') === fs.readFileSync(path.join(root, 'web/dashboard.js'), 'utf8'));
  ok('every model has an added date', cat.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.added || '')));
  ok('release months are valid', cat.every(m => !m.released || /^\d{4}-(0[1-9]|1[0-2])$/.test(m.released)));
}

// ---- attachments: what a model accepts and how files reach it ----
(async () => {
  const a = await import(path.join(root, 'web/attach.js'));
  const F = (name, type, size = 100) => ({ name, type, size });
  const txtModel = { name: 'Text Model', caps: ['chat'] }, visModel = { name: 'Vision Model', caps: ['chat', 'vision'], accepts: ['text', 'image'] };
  ok('text model does not accept images', a.accepts(txtModel).image === false && a.accepts(txtModel).file === true);
  ok('vision model accepts images', a.accepts(visModel).image === true);
  ok('accepts: model with the vision cap only', a.accepts({ caps: ['vision'] }).image === true);
  ok('accepts: null model is safe', a.accepts(null).image === false);
  ok('kind: png is an image', a.kindOf(F('a.png', 'image/png')) === 'image');
  ok('kind: lua file is text even with no type', a.kindOf(F('script.lua', '')) === 'text');
  ok('kind: upper case extension', a.kindOf(F('NOTES.TXT', '')) === 'text');
  ok('kind: exe is unsupported', a.kindOf(F('x.exe', 'application/x-msdownload')) === 'unsupported');
  ok('kind: pdf is unsupported', a.kindOf(F('a.pdf', 'application/pdf')) === 'unsupported');
  ok('kind: svg is unsupported (could hold scripts)', a.kindOf(F('a.svg', 'image/svg+xml')) === 'unsupported');
  ok('check: text file to text model ok', a.checkFiles([F('a.txt', 'text/plain')], txtModel).ok === true);
  ok('check: image to text model is refused with a reason', (() => { const r = a.checkFiles([F('a.png', 'image/png')], txtModel); return !r.ok && /cannot read images/.test(r.problems[0]); })());
  ok('check: image to vision model ok', a.checkFiles([F('a.jpg', 'image/jpeg')], visModel).ok === true);
  ok('check: image over the limit is refused', !a.checkFiles([F('big.png', 'image/png', 9 * 1048576)], visModel).ok);
  ok('check: too many files is reported', a.checkFiles([1, 2, 3, 4, 5].map(i => F(i + '.txt', 'text/plain')), txtModel).problems.some(p => /Up to 4/.test(p)));
  ok('check: nothing picked is not ok', a.checkFiles([], txtModel).ok === false && a.checkFiles(null, txtModel).ok === false);
  ok('check: one bad file blocks the batch but names it', (() => { const r = a.checkFiles([F('a.txt', 'text/plain'), F('b.exe', '')], txtModel); return !r.ok && r.problems[0].startsWith('b.exe'); })());
  ok('textBlock: short file is whole', a.textBlock('a.txt', 'hello') === '[File: a.txt]\nhello\n[End of file]');
  ok('textBlock: long file is cut and says so', (() => { const t = a.textBlock('a.txt', 'x'.repeat(a.MAX_TEXT_CHARS + 500)); return /first 6000 of 6500 characters/.test(t) && t.length < a.MAX_TEXT_CHARS + 120; })());
  ok('textBlock: strips null bytes and handles null', !/\u0000/.test(a.textBlock('a', 'a\u0000b')) && a.textBlock('a', null).includes('[File: a]'));
  ok('message: question + text file', (() => { const m = a.buildMessage('What is this?', [{ kind: 'text', name: 'a.txt', text: 'hi' }]); return m.content.endsWith('What is this?') && m.content.includes('[File: a.txt]') && m.images.length === 0; })());
  ok('message: image with no question gets a default', (() => { const m = a.buildMessage('', [{ kind: 'image', name: 'a.png', dataUrl: 'data:image/png;base64,AA' }]); return m.content === 'Describe this image.' && m.images.length === 1; })());
  ok('message: text file with no question gets a default', a.buildMessage('  ', [{ kind: 'text', name: 'a.txt', text: 'x' }]).content.endsWith('Read the file and summarize it.'));
  ok('message: no attachments is just the text', a.buildMessage('hello', []).content === 'hello' && a.buildMessage('hello').images.length === 0);
  ok('fitSize: big image shrinks, ratio kept', (() => { const s = a.fitSize(2000, 1000, 512); return s.w === 512 && s.h === 256; })());
  ok('fitSize: small image is not enlarged', (() => { const s = a.fitSize(200, 100, 512); return s.w === 200 && s.h === 100; })());
  ok('fitSize: bad size is safe', a.fitSize(0, 10).w === 0 && a.fitSize(NaN, NaN).h === 0);
  ok('pair: total size is small (reader + brain under 1 GB)', a.PAIR_MB === 690 && a.PAIR_MB < 1024);
  ok('pair: picture goes in <picture> tags with a system line', (() => { const m = a.withPicture([], 'Solve it.', ['17+25=?']); return m[0].role === 'system' && /<picture>17\+25=\?<\/picture>\nSolve it\./.test(m.at(-1).content); })());
  ok('pair: earlier chat is kept, old system lines are not doubled', (() => { const m = a.withPicture([{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], 'what now', ['a']); return m.filter(x => x.role === 'system').length === 1 && m.length === 4; })());
  ok('pair: two pictures are numbered', /Picture 1: a\nPicture 2: b/.test(a.withPicture([], 'q', ['a', 'b']).at(-1).content));
  ok('pair: nothing read is said plainly, not left empty', /nothing could be read/.test(a.withPicture([], 'q', ['', '  ']).at(-1).content) && /nothing could be read/.test(a.withPicture([], 'q', null).at(-1).content));
  ok('pair: empty question gets a default', /Describe it\./.test(a.withPicture([], '', ['x']).at(-1).content));
  ok('fmtBytes', a.fmtBytes(500) === '1 KB' && a.fmtBytes(2048) === '2 KB' && a.fmtBytes(3 * 1048576) === '3.0 MB');
})();


// ---- duo: two local AIs working together ----
{
  const duo = require(path.join(root, 'server/duo.js'));
  const by = id => cat.find(m => m.id === id);
  const have = ['smollm2-360m', 'qwen2.5-0.5b', 'qwen2.5-1.5b', 'qwen2.5-7b', 'qwen2.5-coder-1.5b', 'deepseek-r1-1.5b', 'llama3.2-3b'].map(by);
  const main7 = by('qwen2.5-7b'), main1 = by('qwen2.5-1.5b');
  const ids = a => a.map(x => x.id).sort().join(',');
  ok('duo: helper is never the main model', !duo.helperCandidates(main7, have).some(h => h.id === main7.id));
  ok('duo: helper must be well under the main size (60%)', duo.helperCandidates(main7, have).every(h => h.sizeGB <= main7.sizeGB * 0.6));
  ok('duo: code and reasoning specialists are not helpers', !duo.helperCandidates(main7, have).some(h => h.id === 'qwen2.5-coder-1.5b' || h.id === 'deepseek-r1-1.5b'));
  ok('duo: 7B main gets the strongest eligible helper (3B)', duo.pickHelper(main7, have).id === 'llama3.2-3b', duo.pickHelper(main7, have) && duo.pickHelper(main7, have).id);
  ok('duo: 1.5B main gets a tiny helper, not a bigger model', (() => { const h = duo.pickHelper(main1, have); return h && h.sizeGB <= main1.sizeGB * 0.6; })());
  ok('duo: smallest main has no helper', duo.pickHelper(by('smollm2-360m'), have) === null);
  ok('duo: only one model downloaded means no duo', duo.pickHelper(main7, [main7]) === null && duo.pickHelper(main7, []) === null && duo.pickHelper(main7, null) === null);
  ok('duo: the user\'s own valid choice wins', duo.pickHelper(main7, have, 'qwen2.5-0.5b').id === 'qwen2.5-0.5b');
  ok('duo: an invalid choice (too big) is ignored, not obeyed', duo.pickHelper(main1, have, 'qwen2.5-7b').id !== 'qwen2.5-7b');
  ok('duo: null main is safe', duo.helperCandidates(null, have).length === 0 && duo.planDuo({ enabled: true, main: null, downloaded: have }).on === false);
  ok('duo: off switch means off', duo.planDuo({ enabled: false, main: main7, downloaded: have }).on === false);
  ok('duo: on with a helper available', (() => { const p = duo.planDuo({ enabled: true, main: main7, downloaded: have, freeGB: 16 }); return p.on && p.helper && /answers/.test(p.why); })());
  ok('duo: low memory refuses, says why', (() => { const p = duo.planDuo({ enabled: true, main: main7, downloaded: have, freeGB: 2 }); return !p.on && /Not enough free memory/.test(p.why); })());
  ok('duo: unknown memory does not block', duo.planDuo({ enabled: true, main: main7, downloaded: have }).on === true);
  ok('duo: no second model explains itself', /second, smaller chat model/.test(duo.planDuo({ enabled: true, main: main7, downloaded: [main7] }).why));
  ok('notes: normal notes pass', duo.cleanNotes('- asked: add numbers\n- 17+25=42') === '- asked: add numbers\n- 17+25=42');
  ok('notes: a one-line direct answer is dropped (it could be wrong)', duo.cleanNotes('There are 4 rows of 6 apples left.') === '' && duo.cleanNotes('The capital of France is Paris.') === '');
  ok('notes: think tags and nulls are removed', duo.cleanNotes('<think>asked: add the numbers\nstep: 17+25\u0000</think>') === 'asked: add the numbers\nstep: 17+25');
  ok('notes: too short is dropped', duo.cleanNotes('ok') === '' && duo.cleanNotes(null) === '' && duo.cleanNotes(undefined) === '');
  ok('notes: a refusal is not notes', duo.cleanNotes('Sorry, I cannot help with that request.') === '' && duo.cleanNotes("I can't do that for you, sorry") === '');
  ok('notes: long notes are cut on a word', (() => { const n = duo.cleanNotes(('word '.repeat(30) + '\n').repeat(20), 100); return n.length <= 104 && n.endsWith(' ...'); })());
  ok('withNotes: appends the notes to the user text', (() => { const t = duo.withNotes('What is 17+25?', 'asked: add two numbers\nadd the two numbers: 42'); return t.startsWith('What is 17+25?') && t.includes('add the two numbers: 42') && /final answer/.test(t) && /may be wrong/.test(t); })());
  ok('withNotes: bad notes leave the question untouched', duo.withNotes('hello', 'sorry, I cannot') === 'hello' && duo.withNotes('hello', '') === 'hello' && duo.withNotes(null, 'x') === '');
  ok('helper prompt forbids the final answer', /Never greet, never write the final answer/.test(duo.HELPER_SYSTEM));
}


// ---- memory limits: site 5, PC app 15 ----
(async () => {
  const m = await import(path.join(root, 'web/memlimit.js'));
  ok('memory: site limit is 5, PC limit is 15', m.limitFor(false) === 5 && m.limitFor(true) === 15);
  ok('memory: site saves up to 5', m.canSave(0, false).ok && m.canSave(4, false).ok && m.canSave(4, false).left === 0);
  ok('memory: site is full at 5 and says how to free space', (() => { const r = m.canSave(5, false); return !r.ok && /full \(5 of 5\)/.test(r.message) && /Forget one in Account/.test(r.message) && /PC app keeps up to 15/.test(r.message); })());
  ok('memory: PC saves up to 15, full at 15', m.canSave(14, true).ok && !m.canSave(15, true).ok && !/PC app keeps/.test(m.canSave(15, true).message));
  ok('memory: over the limit stays refused (old accounts with more)', !m.canSave(40, false).ok && !m.canSave(99, true).ok);
  ok('memory: bad counts are safe', m.canSave(undefined, false).ok && m.canSave(-3, true).ok && m.canSave('x', false).ok);
  ok('memory: usage text', m.usedText(3, false) === '3 of 5 memories used' && m.usedText(15, true) === '15 of 15 memories used');
})();


// ---- duo in the browser (site + PC page) ----
(async () => {
  const d = await import(path.join(root, 'web/duo.js'));
  const M = (id, size, caps = ['chat']) => ({ id, name: id, size, caps });
  const big = M('big', '~1.0 GB'), mid = M('mid', '~0.5 GB'), tiny = M('tiny', '~0.3 GB'), coder = M('coder', '~0.2 GB', ['chat', 'code']);
  ok('bduo: sizes read from catalog text', d.sizeMB(M('a', '~0.4 GB')) === 410 && d.sizeMB(M('a', '~190 MB')) === 190 && d.sizeMB(M('a', 'huge')) === 0 && d.sizeMB(null) === 0);
  ok('bduo: never the same model, never above 60%', (() => { const h = d.helpers(big, [big, mid, tiny, M('close', '~0.7 GB')]); return !h.includes(big) && h.includes(mid) && h.includes(tiny) && !h.some(x => x.id === 'close'); })());
  ok('bduo: code models are not helpers', !d.helpers(big, [tiny, coder]).includes(coder));
  ok('bduo: picks the strongest allowed, honours a valid choice', d.pickHelper(big, [tiny, M('t2', '~0.1 GB')]).id === 'tiny' && d.pickHelper(big, [tiny, M('t2', '~0.1 GB')], 't2').id === 't2');
  ok('bduo: nothing downloaded is safe', d.pickHelper(big, []) === null && d.pickHelper(big, null) === null && d.pickHelper(null, [tiny]) === null);
  ok('bduo: off means off', d.plan({ enabled: false, main: big, downloaded: [tiny] }).on === false);
  ok('bduo: on with a helper', (() => { const p = d.plan({ enabled: true, main: big, downloaded: [tiny], deviceGB: 8 }); return p.on && p.helper.id === 'tiny'; })());
  ok('bduo: refuses when device memory is too low, says why', (() => { const p = d.plan({ enabled: true, main: big, downloaded: [tiny], deviceGB: 2 }); return !p.on && /too little/.test(p.why); })());
  ok('bduo: unknown device memory does not block', d.plan({ enabled: true, main: big, downloaded: [tiny] }).on === true);
  ok('bduo: no helper explains itself', /second, smaller/.test(d.plan({ enabled: true, main: big, downloaded: [big] }).why));
  ok('bduo: one-line answers and refusals are not hints', d.cleanNotes('It is 19.') === '' && d.cleanNotes('Sorry, I cannot') === '' && d.cleanNotes('a: b\nc: d') !== '');
  ok('bduo: hints are marked as possibly wrong', /may be wrong/.test(d.withNotes('q?', 'asked: x\nstep: y')) && d.withNotes('q?', 'bad') === 'q?');
})();

// ---- dashboard logic ----
(async () => {
  const d = await import(path.join(root, 'web/dashboard.js'));
  const n = d.newestModels(cat, 6); ok('newest: 6 shown, newest first', n.length === 6 && n.every((m, i) => !i || n[i - 1].released >= m.released));
  ok('newest: never shows a model with no release month', d.newestModels(cat, 100).every(m => m.released));
  ok('stats add up', (() => { const x = d.stats(cat); return x.total === cat.length && x.tools + x.basic + x.chat === x.total; })());
  ok('pick for 8 GB is a tool model that fits', (() => { const m = d.pickForRam(cat, 8); return m && m.toolTier === 'good' && m.minRamGB <= 8; })());
  ok('pick for 2 GB is nothing (no tool model fits)', d.pickForRam(cat, 2) === null);
  ok('pick for 64 GB is a tool model', (d.pickForRam(cat, 64) || {}).toolTier === 'good');
  ok('version compare', d.compareVersions('0.5.4', '0.6.0') === -1 && d.compareVersions('0.6.0', '0.6.0') === 0 && d.compareVersions('0.10.0', '0.9.9') === 1 && d.compareVersions('1.0', '0.9.9') === 1);
  ok('empty data does not crash', d.newestModels(null).length === 0 && d.stats(undefined).total === 0 && d.pickForRam(undefined, 8) === null);
})().then(() => { if (!global.__done) setTimeout(() => {}, 0); });

// ---- agent wiring ----
(async () => {
  const r = await a.buildTools({ search: true, tools: true, terminal: true });
  const names = r.tools.map(x => x.name);
  ok('agent has 19 tools', names.length === 19, names.length);
  ok('agent has file tools', ['read_file', 'write_file', 'edit_file', 'list_files'].every(n => names.includes(n)));
  const off = await a.buildTools({ search: false, tools: false, terminal: false }); ok('switches off = no tools', off.tools.length === 0, off.tools.length);
  ok('agent runs a file tool', /Created/.test(await a.runTool(r.tools, 'write_file', { path: 'z.txt', content: 'hi' }, {})));
  a.setTier('good'); const pg = a.systemPrompt(r.tools, false, [], 'normal'); ok('good model gets tool_call guide', /<tool_call>/.test(pg) && /look first/i.test(pg));
  a.setTier('basic'); const pb = a.systemPrompt(r.tools, false, [], 'normal'); ok('basic model keeps the short prompt', !/<tool_call>/.test(pb));
  // ---- API docs ----
  const d = require('../server/apidocs.js').page(11435); ok('docs page', /v1\/chat\/completions/.test(d) && /Roblox/.test(d) && /localhost:11435/.test(d) && /<\/html>$/.test(d));
  // ---- GitHub sign-in + the 250 "GitHub on both" bonus ----
  {
    const { parseAuthHash, oauthUrl } = await import('../web/account.js');
    ok('github: sign-in result keeps the GitHub token', parseAuthHash('#access_token=A&provider_token=gho_X').provider_token === 'gho_X');
    ok('github: discord sign-in has no GitHub token', parseAuthHash('#access_token=A').provider_token === undefined);
    const gu = oauthUrl('https://x.supabase.co', 'https://a.b/p/', 'github');
    ok('github: url asks for the right provider and the repo scope', /provider=github/.test(gu) && /scopes=.*repo/.test(gu));
    ok('github: discord url is unchanged', !/scopes=/.test(oauthUrl('https://x.supabase.co', 'https://a.b/')) && /provider=discord/.test(oauthUrl('https://x.supabase.co', 'https://a.b/')));
    ok('github: an unknown provider falls back to discord', /provider=discord/.test(oauthUrl('https://x.supabase.co', 'https://a.b/', 'evil&x=1')));
    const http = require('http'); const UID = '11111111-2222-3333-4444-555555555555'; let both = false, dbCalls = 0;
    const fake = http.createServer((rq, rs) => { rs.setHeader('Content-Type', 'application/json');
      if (rq.url === '/auth/v1/user') { if (rq.headers.authorization !== 'Bearer good') { rs.statusCode = 401; return rs.end('{}'); } return rs.end(JSON.stringify({ id: UID })); }
      if (rq.url === '/rest/v1/rpc/pholama_github_both') { dbCalls++; return rs.end(JSON.stringify(both)); } rs.statusCode = 404; rs.end('{}'); });
    await new Promise(r => fake.listen(0, r)); const port = fake.address().port;
    const realFetch = global.fetch; global.fetch = (u, o) => realFetch(String(u).replace('https://nyswblzzvqzheaxvrqtq.supabase.co', 'http://127.0.0.1:' + port), o);
    try {
      const pw = require('../server/power.js'); const before = pw.bonusTotal();
      ok('bonus 250: one surface only gives nothing', (await pw.claimGithubBonus('good')).granted === false && pw.bonusTotal() === before);
      both = true; const g = await pw.claimGithubBonus('good');
      ok('bonus 250: both surfaces give exactly 250', g.granted === true && pw.bonusTotal() === before + 250, pw.bonusTotal());
      const calls = dbCalls; const again = await pw.claimGithubBonus('good');
      ok('bonus 250: only once per account', again.granted === false && pw.bonusTotal() === before + 250);
      ok('bonus 250: a repeat does not even ask the database', dbCalls === calls);
      ok('bonus 250: forged token rejected', await pw.claimGithubBonus('forged').then(() => false, () => true));
      ok('bonus 250: empty token rejected', await pw.claimGithubBonus('').then(() => false, () => true));
    } finally { global.fetch = realFetch; fake.close(); }
    const info = await import('../docs/info.js');
    ok('info: date formatting', info.fmtDate('2026-10-04') === '4 Oct 2026' && info.fmtDate('nonsense') === 'nonsense');
    ok('info: guides cover start, github, api and remote', ['start', 'github', 'api', 'remote'].every(id => info.GUIDES.some(g => g.id === id)));
    ok('info: never asks for a secret key', !info.KEY_FACTS.some(([, v]) => /enter your (api )?key here/i.test(v)) && info.KEY_FACTS.some(([, v]) => /never asks for or stores your keys/.test(v)));
    const idx = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8'), pcIdx = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
    ok('site: warns the AI might stop working', /id="aiwarn"/.test(idx) && /might stop working/.test(idx));
    ok('pc app: has no site warning', !/id="aiwarn"/.test(pcIdx));
    ok('both: GitHub button present', /id="a_github"/.test(idx) && /id="a_github"/.test(pcIdx));
    ok('sql: table is protected by row-level security', /enable row level security/.test(fs.readFileSync(path.join(root, 'supabase', 'github_bonus.sql'), 'utf8')));
  }
  // ---- Pholama Platform ----
  {
    const PL = await import('../docs/platform.js');
    const platUi = fs.readFileSync(path.join(root, 'docs', 'platformui.js'), 'utf8'), platJs = fs.readFileSync(path.join(root, 'docs', 'platform.js'), 'utf8'), infoJs = fs.readFileSync(path.join(root, 'docs', 'info.js'), 'utf8');
    const sql = fs.readFileSync(path.join(root, 'supabase', 'platform.sql'), 'utf8');
    ok('platform: text from other people is never put into HTML', ![platUi, platJs, infoJs].some(t => /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write\(/.test(t)));
    ok('platform: profile picture only loads from https', /\^https:\\\/\\\//.test(platUi));
    ok('platform: name cleaning strips tags and caps length', !/[<>]/.test(PL.cleanPlatformName('<script>x</script>')) && PL.cleanPlatformName('x'.repeat(99)).length === 30);
    ok('platform: name and post checks', !!PL.nameProblem('a') && !PL.nameProblem('ab') && !!PL.postProblem(' ') && !!PL.postProblem('x'.repeat(501)) && !PL.postProblem('hi'));
    ok('platform: posts last 3 hours', PL.LIFETIME_MS === 10800000 && PL.timeLeft('2026-10-04T12:05:00Z', Date.parse('2026-10-04T10:00:00Z')) === '2h 5m left' && PL.timeLeft('2020-01-01T00:00:00Z') === 'expired');
    ok('platform: expired and hidden posts are not live', !PL.isLive({ expires_at: '2020-01-01T00:00:00Z', hidden: false }) && !PL.isLive({ expires_at: '2999-01-01T00:00:00Z', hidden: true }) && PL.isLive({ expires_at: '2999-01-01T00:00:00Z', hidden: false }));
    const tl = PL.tally([{ kind: 'like', user_id: 'a' }, { kind: 'like', user_id: 'b' }, { kind: 'nope', user_id: 'a' }], 'a');
    ok('platform: reactions are counted and mine is marked', tl.like.n === 2 && tl.like.mine && !tl.fire.mine && !('nope' in tl));
    ok('platform: 5 reactions', PL.REACTIONS.length === 5);
    ok('platform: picture rules', !!PL.avatarProblem({ type: 'image/gif', size: 1 }) && !!PL.avatarProblem({ type: 'image/png', size: 300000 }) && !PL.avatarProblem({ type: 'image/webp', size: 1000 }) && PL.avatarPathFor('u', 'image/jpeg') === 'u/avatar.jpg');
    ok('platform: site keeps ONE small assistant', PL.assistantRule([], 'a') === '' && PL.assistantRule(['a'], 'a') === '' && !!PL.assistantRule(['a'], 'b'));
    ok('platform: site is named Pholama Platform', /<title>Pholama Platform<\/title>/.test(fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8')) && /Pholama Platform/.test(fs.readFileSync(path.join(root, 'docs', 'manifest.webmanifest'), 'utf8')));
    ok('platform: header shows who is logged in', /id="whoami"/.test(fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8')) && /Logged in as/.test(fs.readFileSync(path.join(root, 'docs', 'app.js'), 'utf8')));
    ok('platform: PC app shares only model names, when idle', /requestIdleCallback/.test(fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8')) && /slice\(0, 12\)/.test(fs.readFileSync(path.join(root, 'web', 'account.js'), 'utf8')));
    const tables = (sql.match(/create table if not exists public\.(\w+)/g) || []).map(x => x.split('.')[1]);
    ok('sql: every table has row-level security', tables.length === 7 && tables.every(t => new RegExp('alter table public\\.' + t + ' enable row level security').test(sql)), tables.join());
    ok('sql: posts live exactly 3 hours and the database sets it', /interval '3 hours'/.test(sql) && /new\.expires_at := now\(\) \+ interval '3 hours'/.test(sql));
    ok('sql: expired posts are hidden by the read rule and swept', /expires_at > now\(\)/.test(sql) && /pholama_sweep/.test(sql));
    ok('sql: moderators only, and 3 reports hide a post', (sql.match(/if not public\.pholama_is_mod\(\)/g) || []).length >= 2 && /\) >= 3 then/.test(sql) && /update public\.pholama_posts set hidden = true/.test(sql));
    ok('sql: people cannot lift their own ban', /new\.banned := old\.banned/.test(sql));
    ok('sql: blocks links and secret keys in posts', /Links are not allowed/.test(sql) && /secret key/.test(sql));
    ok('sql: pictures limited to 256 KB and the owner folder', /file_size_limit[^;]*262144/.test(sql) && /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/.test(sql));
  }
  // ---- Platform part 2: moderators, rules, projects, daily ----
  {
    const PL = await import('../docs/platform.js'); const sql2 = fs.readFileSync(path.join(root, 'supabase', 'platform2.sql'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'docs', 'platformui.js'), 'utf8');
    const tb2 = (sql2.match(/create table if not exists public\.(\w+)/g) || []).map(x => x.split('.')[1]);
    ok('sql2: every new table has row-level security', tb2.length === 5 && tb2.every(t => new RegExp('alter table public\\.' + t + ' enable row level security').test(sql2)), tb2.join());
    const fns = ['pholama_mod_warn', 'pholama_mod_edit', 'pholama_mod_hide', 'pholama_mod_remove', 'pholama_mod_ban', 'pholama_mod_project', 'pholama_mod_cmd', 'pholama_find_user'];
    ok('sql2: every moderator function exists', fns.every(f => new RegExp('function public\\.' + f + '\\(').test(sql2)));
    ok('sql2: every moderator function checks for a moderator', fns.every(f => { const i = sql2.indexOf('function public.' + f + '('); const body = sql2.slice(i, i + 900); return /pholama_need_mod\(\)/.test(body); }));
    ok('sql2: moderators cannot ban themselves or other moderators', /cannot ban yourself/.test(sql2) && /Remove their moderator role first/.test(sql2));
    ok('sql2: every moderator action is logged', (sql2.match(/pholama_log\(/g) || []).length >= 9);
    ok('sql2: audit log cannot be written directly', !/create policy "modlog[^;]*for (insert|update|delete)/.test(sql2));
    ok('sql2: people cannot change their own ban', /new\.banned := old\.banned; new\.ban_reason := old\.ban_reason; new\.banned_until := old\.banned_until/.test(sql2));
    ok('sql2: timed bans expire', /banned_until is null or banned_until > now\(\)/.test(sql2));
    ok('sql2: project images must be your own uploads', /\/projects\/\[0-9a-f-\]\{8,40\}/.test(sql2) && /cardinality\(image_paths\) <= 4/.test(sql2));
    ok('sql2: project limits (3 a day, 12 total) and secret-key block', /n >= 3/.test(sql2) && /n >= 12/.test(sql2) && /secret key/.test(sql2));
    ok('sql2: rules are readable by everyone and there are 6', /create policy "rules read"/.test(sql2) && (sql2.match(/^ \(\d,'/gm) || []).length === 6);
    ok('sql2: warnings can only be marked seen', /Only "seen" can change/.test(sql2));
    ok('sql2: daily post needs a moderator command', /c = 'daily'/.test(sql2) && !/create policy "daily[^;]*for (insert|update)/.test(sql2));
    ok('ui: dashboard tabs + moderator tab only for moderators', /\['home', 'Home'/.test(ui) && /if \(mod\) defs\.push\(\['mod'/.test(ui));
    ok('ui: project images only from https', /\/\^https:\\\/\\\//.test(ui));
    const pj = PL.projectImagePath('u', 'image/png', 'abc12345'); ok('projects: image path is inside your folder', pj === 'u/projects/abc12345.png' && PL.projectImagePath('u', 'image/gif', 'abc12345') === '');
    ok('projects: title and description checks', !!PL.projectProblem('ab', 'long enough text') && !!PL.projectProblem('Title', 'short') && !PL.projectProblem('Title', 'long enough text'));
    ok('bans: permanent, timed and expired text', /permanently/.test(PL.banText({ banned: true })) && /until/.test(PL.banText({ banned: true, banned_until: '2999-01-01T00:00:00Z' })) && PL.banText({ banned: true, banned_until: '2000-01-01T00:00:00Z' }) === '');
    ok('console: only known words are sent', PL.modCommandProblem('ban Zed 24 spam') === '' && !!PL.modCommandProblem('drop table x') && !!PL.modCommandProblem('') && PL.modCommandProblem('HELP') === '');
  }
  // ---- the website is a dashboard: no chat, one model. The PC app keeps everything. ----
  {
    const siteM = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'models.json'), 'utf8')), pcM = JSON.parse(fs.readFileSync(path.join(root, 'web', 'models.json'), 'utf8'));
    const css = fs.readFileSync(path.join(root, 'docs', 'style.css'), 'utf8'), js = fs.readFileSync(path.join(root, 'docs', 'app.js'), 'utf8'), webJs = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
    ok('website is a dashboard: the model list has exactly ONE model', siteM.browser.length === 1, String(siteM.browser.length));
    ok('website: that one model is small and chat only', !(siteM.browser[0].caps || []).includes('tools') && /0\.5B/.test(siteM.browser[0].name));
    ok('PC app keeps its full model list', pcM.browser.length > 1 && (pcM.local || []).length > 10);
    ok('website: chat, composer, model picker and Chat tab are removed', /body\.site-only #chat,body\.site-only footer,body\.site-only #vChat,body\.site-only #model/.test(css));
    ok('website: Models button is hidden (one model, nothing to pick)', /body\.site-only #mgr/.test(css));
    ok('website: the Models manager cannot be opened', /onclick = \(\) => \{ if \(siteOnly\(\)\) return; render\(\); dlg\.showModal/.test(js));
    ok('website: the chat view can never be opened', /if \(siteOnly\(\) && name === 'chat'\) name = 'plat'/.test(js) && /const siteOnly = \(\) => !server/.test(js));
    ok('website: Platform is the home screen', /showView\(siteOnly\(\) \? 'plat' : 'dash'\)/.test(js));
    ok('website: connecting to a PC brings chat back', /markSite\(\);\s*await refreshSelect\(\); render\(\);/.test(js));
    ok('PC app has no site-only switch', !/site-only/.test(webJs) && !/site-only/.test(fs.readFileSync(path.join(root, 'web', 'style.css'), 'utf8')));
  }
  // ---- broken tool calls are retried, never shown ----
  {
    const ag = require('../server/agent.js');
    ok('retry: plain words are not a tool attempt', !ag.looksLikeToolAttempt('Sure, saved. I can use tools like list_files.'));
    ok('retry: bad json, unclosed tag and bare json ARE attempts', ag.looksLikeToolAttempt('<tool_call>{oops}</tool_call>') && ag.looksLikeToolAttempt('go <tool_call>{"name":"x"') && ag.looksLikeToolAttempt('{"name": "a", "arguments": {}}'));
    ok('retry: tool text is stripped, words are kept', ag.stripToolText('Ok. <tool_call>{"name":"x"}</tool_call>') === 'Ok.' && ag.stripToolText('<tool_call>{bad') === '');
    ok('retry: a half-written tag is held back from the screen', ag.safeShowLength('Sure <tool_c') === 5 && ag.safeShowLength('Sure <tool_call>{') === 5 && ag.safeShowLength('a < b and <b>x</b>') === 18);
    ok('retry: tool failure gets a retry, then a stop', /call the tool again/.test(ag.toolFailNotice('x', 'Tool error: bad', 0)) && /failed twice/.test(ag.toolFailNotice('x', 'Tool error: bad', 2)));
    ok('retry: a good call still parses', ag.parseTool('<tool_call>{"name":"list_files","arguments":{}}</tool_call>').name === 'list_files');
    const { spawnSync } = require('child_process'); const e2e = spawnSync(process.execPath, [path.join(root, 'test', 'retry.e2e.js')], { encoding: 'utf8', timeout: 240000 });
    ok('retry: all 12 end-to-end scenarios pass against the real server', e2e.status === 0 && /all passed/.test(e2e.stdout || ''), (e2e.stdout || '').split('\n').filter(l => /FAIL/.test(l)).join(' | ') || e2e.stderr);
  }
  // ---- same account on a PC: the browser never downloads a model ----
  {
    const pl = await import(require('url').pathToFileURL(path.join(root, 'web', 'pclink.js')).href);
    ok('pclink: signed in + a PC on the account = browser download blocked', pl.downloadDecision({ signedIn: true, hasPc: true, value: 'web:Llama-3.2-1B' }).block === true);
    ok('pclink: same for CPU models', pl.downloadDecision({ signedIn: true, hasPc: true, value: 'cpu:HuggingFaceTB/SmolLM2-135M-Instruct' }).block === true);
    ok('pclink: not signed in = downloads work as before', pl.downloadDecision({ signedIn: false, hasPc: true, value: 'web:x' }).block === false);
    ok('pclink: signed in but no PC on the account = downloads work', pl.downloadDecision({ signedIn: true, hasPc: false, value: 'web:x' }).block === false);
    ok('pclink: offline / unknown never blocks chat', pl.downloadDecision({ signedIn: true, hasPc: null, value: 'web:x' }).block === false);
    ok('pclink: PC and cloud models are never a browser download', pl.downloadDecision({ signedIn: true, hasPc: true, value: 'gguf:x' }).block === false && pl.downloadDecision({ signedIn: true, hasPc: true, value: 'cloud:x' }).block === false);
    ok('pclink: the message tells the person what to do instead', /PC/.test(pl.downloadDecision({ signedIn: true, hasPc: true, value: 'web:x' }).why));
    const mem = {}; const st = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
    pl.writeCached(st, 'u1', true, 1000);
    ok('pclink: answer is remembered for the same user', pl.readCached(st, 'u1', 2000) === true);
    ok('pclink: another account never reuses it', pl.readCached(st, 'u2', 2000) === null);
    ok('pclink: the remembered answer expires', pl.readCached(st, 'u1', 1000 + 11 * 60 * 1000) === null);
    ok('pclink: an unknown answer is never stored as false', (pl.writeCached(st, 'u3', null, 1000), pl.readCached(st, 'u3', 1500) === null));
  }
  // ---- one day idle: every local AI shuts down until `pholama awake` ----
  {
    const sl = require('../server/sleep'); let t = 1000, loaded = true, stopped = 0;
    const s = sl.create({ now: () => t, limitMs: sl.DAY_MS, isLoaded: () => loaded, stopAll: async () => { stopped++; loaded = false; } });
    ok('sleep: a chat or API call counts as use', sl.usesAi('POST', '/api/chat') && sl.usesAi('POST', '/v1/chat/completions') && sl.usesAi('POST', '/v1/embeddings') && sl.usesAi('POST', '/api/generate'));
    ok('sleep: dashboard polling and lists do not count', !sl.usesAi('GET', '/api/hardware') && !sl.usesAi('GET', '/api/tags') && !sl.usesAi('GET', '/api/pull/status') && !sl.usesAi('GET', '/api/chat'));
    t += sl.DAY_MS - 1000; ok('sleep: just under a day stays awake', (await s.check()) === false && !s.isAsleep());
    s.touch('GET', '/api/hardware'); t += 2000;
    ok('sleep: after a day it sleeps and stops every AI, even with a tab polling', (await s.check()) === true && s.isAsleep() && stopped === 1);
    ok('sleep: asleep refuses AI work but allows passive calls', s.touch('POST', '/api/chat') === false && s.touch('GET', '/api/version') === true);
    ok('sleep: wake works once', s.wake() === true && s.wake() === false && s.touch('POST', '/api/chat') === true);
    loaded = true; t += 1000; s.touch('POST', '/api/chat'); t += sl.DAY_MS - 5;
    ok('sleep: using it resets the clock', (await s.check()) === false);
    loaded = false; t += sl.DAY_MS * 3; ok('sleep: nothing loaded means nothing to shut down', (await s.check()) === false && !s.isAsleep());
  }
  // ---- the watcher that frees RAM after a hard kill ----
  {
    const rp = require('../server/reaper'); const killed = []; const files = [];
    const mk = (n, v) => { const f = path.join(require('os').tmpdir(), 'reap-' + process.pid + '-' + n); fs.writeFileSync(f, String(v)); files.push(f); return f; };
    const n1 = rp.reapEngines([mk(1, 4242)], { exists: () => true, nameOf: () => 'llama-server', kill: p => killed.push(p) });
    ok('reaper: stops an engine that is still a llama-server', n1 === 1 && killed[0] === 4242);
    const n2 = rp.reapEngines([mk(2, 999)], { exists: () => true, nameOf: () => 'firefox', kill: p => killed.push(p) });
    ok('reaper: never touches an unrelated program that reused the pid', n2 === 0 && !killed.includes(999));
    ok('reaper: ignores a missing pid file', rp.reapEngines(['/nonexistent/x.pid'], { exists: () => true, nameOf: () => 'llama-server', kill: p => killed.push(p) }) === 0);
    ok('reaper: recognises the engine name on every platform', rp.isEngine('llama-server') && rp.isEngine('"llama-server.exe","12","Console"') && rp.isEngine('x /home/u/.pholama/bin/llama-server') && !rp.isEngine('node'));
    for (const f of files) { try { fs.unlinkSync(f); } catch {} }
  }
  // ---- syntax of every file ----
  for (const f of fs.readdirSync(path.join(root, 'server'))) if (f.endsWith('.js')) { try { new (require('vm').Script)(fs.readFileSync(path.join(root, 'server', f), 'utf8').replace(/^#!.*/, '')); P++; } catch (e) { F++; console.log('FAIL syntax', f, e.message); } }
  await new Promise(r => setTimeout(r, 300)); console.log(`${P} passed, ${F} failed`); process.exit(F ? 1 : 0);
})();
