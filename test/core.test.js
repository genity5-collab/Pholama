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
  // ---- syntax of every file ----
  for (const f of fs.readdirSync(path.join(root, 'server'))) if (f.endsWith('.js')) { try { new (require('vm').Script)(fs.readFileSync(path.join(root, 'server', f), 'utf8').replace(/^#!.*/, '')); P++; } catch (e) { F++; console.log('FAIL syntax', f, e.message); } }
  await new Promise(r => setTimeout(r, 300)); console.log(`${P} passed, ${F} failed`); process.exit(F ? 1 : 0);
})();
