// Studio "AI is editing" animation: the pure logic (which lines changed, how they group, what the status says) plus wiring checks.
const fs = require('fs'), path = require('path');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) bad++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  const { changedLines, runs, toolStatus } = await import(path.join(__dirname, '..', 'web', 'studiofx.js'));
  const t = l => l.join('\n');
  // which lines lit up
  ok('identical text lights nothing', eq(changedLines('a\nb\nc', 'a\nb\nc'), []));
  ok('one changed line lights only that line', eq(changedLines(t(['a', 'b', 'c']), t(['a', 'B', 'c'])), [1]));
  ok('a line added at the TOP does not light up the whole file', eq(changedLines(t(['a', 'b', 'c', 'd']), t(['new', 'a', 'b', 'c', 'd'])), [0]));
  ok('a line added in the middle lights only it', eq(changedLines(t(['a', 'b', 'c']), t(['a', 'x', 'b', 'c'])), [1]));
  ok('a removed line lights nothing (it is gone)', eq(changedLines(t(['a', 'b', 'c']), t(['a', 'c'])), []));
  ok('two separate edits light two lines', eq(changedLines(t(['a', 'b', 'c', 'd', 'e']), t(['a', 'B', 'c', 'D', 'e'])), [1, 3]));
  ok('a brand new file lights every line', eq(changedLines('', t(['a', 'b'])), [0, 1]));
  ok('an emptied file lights nothing useful', changedLines(t(['a', 'b']), '').length <= 1);
  ok('null and undefined are safe', eq(changedLines(null, undefined), []) || changedLines(null, undefined).length <= 1);
  ok('repeated identical lines are matched in order', eq(changedLines(t(['x', 'x', 'x']), t(['x', 'x', 'x', 'x'])), [3]));
  ok('Windows line endings do not light up every line', changedLines('a\r\nb\r\nc', 'a\r\nb\r\nc').length === 0);
  { const big = Array.from({ length: 3000 }, (_, i) => 'line ' + i); const b2 = big.slice(); b2[1500] = 'changed'; const t0 = Date.now(); const r = changedLines(t(big), t(b2));
    ok('a 3000-line file with one edit finds just that line, quickly', eq(r, [1500]) && Date.now() - t0 < 2000, r.length + ' lines, ' + (Date.now() - t0) + ' ms'); }
  { const big = Array.from({ length: 6000 }, (_, i) => 'line ' + i); const t0 = Date.now(); const r = changedLines(t(big), t(big.map((x, i) => i === 10 ? 'z' : x)));
    ok('a huge file never freezes the page (cheap path)', Date.now() - t0 < 2000 && r.includes(10), (Date.now() - t0) + ' ms'); }
  // grouping
  ok('consecutive lines become one bar', eq(runs([2, 3, 4, 9]), [{ from: 2, to: 4 }, { from: 9, to: 9 }]));
  ok('no lines, no bars', eq(runs([]), []));
  ok('a single line is one bar', eq(runs([7]), [{ from: 7, to: 7 }]));
  // status text
  ok('writing a file says Editing + name', eq(toolStatus({ name: 'studio_write', args: { file: 'a.js' } }), { kind: 'edit', file: 'a.js', text: 'Editing a.js' }));
  ok('patching says Editing', toolStatus({ name: 'studio_patch', args: { file: 'a.js' } }).text === 'Editing a.js');
  ok('creating says Creating', toolStatus({ name: 'studio_create', args: { file: 'b.js' } }).text === 'Creating b.js');
  ok('deleting says Removing', toolStatus({ name: 'studio_delete', args: { file: 'c.css' } }).text === 'Removing c.css');
  ok('reading is "look", not "edit"', toolStatus({ name: 'studio_read_numbered', args: { file: 'c.html' } }).kind === 'look');
  ok('check and run are "test"', toolStatus({ name: 'studio_check' }).kind === 'test' && toolStatus({ name: 'studio_run_js' }).kind === 'test');
  ok('an unknown tool still gets a calm label', toolStatus({ name: 'web_search' }).text === 'Working');
  ok('no file name is fine', toolStatus({ name: 'studio_write' }).text === 'Editing your project');
  ok('a very long file name is cut, not overflowing', toolStatus({ name: 'studio_write', args: { file: 'x'.repeat(300) } }).text.length < 80);
  ok('missing input never throws', (() => { try { toolStatus(); toolStatus(null); toolStatus({}); return true; } catch { return false; } })());
  // wiring
  const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8'), st = R('web/studio.js'), srv = R('server/server.js'), css = R('web/style.css');
  ok('Studio loads the effects module', /from '\.\/studiofx\.js'/.test(st));
  ok('Studio has a direct script creation control', /id="stNewScript"/.test(st) && /el\.stNewScript\.onclick/.test(st));
  ok('new files are labelled for review in tabs', /S\.newFiles\.add\(f\.name\)/.test(st) && /'  NEW'/.test(st));
  ok('new JavaScript files are attached to the live preview when possible', /<script src="' \+ src \+ '"><\/script>/.test(st));
  ok('companion position is saved and restored', /pholama_studio_companion_pos/.test(st) && /placeCompanion\(companionPos\.x, companionPos\.y, true\)/.test(st));
  ok('companion has selectable reactions', /data-reaction="👋 Wave"/.test(st) && /data-reaction="💃 Dance"/.test(st));
  ok('Studio starts the strip on toolStart and ends it on the finished tool line', /j\.toolStart\) \{ fxOpen\+\+; fx\.working/.test(st) && /fxOpen > 0\) \{ fxOpen--; fx\.idle\(\)/.test(st));
  ok('the strip is always cleared when a run ends (error, Stop, done)', /finally \{ while \(fxOpen > 0\) \{ fxOpen--; fx\.idle\(\); \}/.test(st));
  ok('the LAST change of a run still flashes (flag stays on through the final refresh)', /fxShow = true; try \{ await refreshFromServer\(\); \} finally \{ fxShow = false; \}/.test(st));
  ok('a tab pulse survives the tab bar being repainted', /paintTabs\(\); fx\.restoreTabs\(\)/.test(st));
  ok('the server announces a tool BEFORE running it (all 4 places)', (srv.match(/line\(\{ toolStart:/g) || []).length === 4, (srv.match(/line\(\{ toolStart:/g) || []).length);
  ok('an older server without toolStart just shows no strip (no crash)', /else if \(j\.toolStart\)/.test(st) && /else if \(j\.tool\)/.test(st));
  ok('the overlay never blocks the mouse', /\.stfx\{[^}]*pointer-events:none/.test(css) && /\.stfx-strip\{[^}]*pointer-events:none/.test(css));
  ok('motion is switched off for people who asked for less', /prefers-reduced-motion:reduce\)\{[^}]*\.stfx-scan/.test(css));
  ok('animation colours come from the theme (no fixed hex)', !/\.stfx[^{]*\{[^}]*#[0-9a-fA-F]{3,6}\b/.test(css));
  ok('the effects file is in the website-free PC folder only', fs.existsSync(path.join(__dirname, '..', 'web', 'studiofx.js')) && !fs.existsSync(path.join(__dirname, '..', 'docs', 'studiofx.js')));
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
