// Improving a project that already has real files: which messages count, what the model is shown, and when its answer is refused.
const im = require('../server/improve.js');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 220))); if (!c) bad++; };
const big = [{ name: 'index.html', size: 2400 }, { name: 'style.css', size: 900 }, { name: 'script.js', size: 1800 }];
const PREV = "Improve the chatbot's UI with modern color schemes, accessibility features, and responsive design.";

// ---- which messages are an improve request
for (const t of ['improve the chatbot UI', 'redesign the page', 'make it look better', 'make it look modern', 'add a dark mode', 'add a cooldown timer to it', 'restyle the buttons', 'polish the layout', 'make it responsive', 'change the colors to blue', 'add animations', 'make the chat nicer', 'upgrade the design', 'Could you please improve the layout?'])
  ok('improve: ' + t, im.wantsImprove(t, '', big), t);
// the exact nudges from the transcript continue the request before them
for (const t of ['ok start', 'start adding bro', 'start', 'go on', 'continue', 'do it', 'keep going', 'ok proceed', 'yes do it', 'go ahead'])
  ok('nudge continues an improve request: ' + t, im.wantsImprove(t, PREV, big), t);
ok('a nudge with NOTHING before it is not a request', !im.wantsImprove('ok start', '', big));
ok('a nudge after an unrelated question is not an improve', !im.wantsImprove('ok start', 'what is the capital of France', big));
// questions and chat are never improve requests
for (const t of ['what does this page do', 'how do I add a timer?', 'explain the script', 'describe my project', 'is this responsive?', 'thanks', 'hello', 'why is it blue', 'tell me about the layout', 'what is a cooldown', ''])
  ok('not improve: ' + JSON.stringify(t), !im.wantsImprove(t, PREV, big), t);
ok('an EMPTY project is not an improve (it is a fresh build)', !im.wantsImprove('improve the UI', '', [{ name: 'index.html', size: 30 }]) && !im.wantsImprove('improve the UI', '', []) && !im.wantsImprove('improve the UI', '', null));
ok('a very long message is not treated as a nudge', !im.wantsImprove('x'.repeat(900), PREV, big));
ok('askOf joins a nudge to the request before it', /Improve the chatbot/.test(im.askOf('start adding bro', PREV)) && /start adding bro/.test(im.askOf('start adding bro', PREV)));
ok('askOf keeps a real request as it is', im.askOf('add a dark mode', PREV) === 'add a dark mode');
ok('askOf with a nudge and no earlier message keeps the nudge', im.askOf('ok start', '') === 'ok start');

// ---- what the model is shown
const F = [{ name: 'script.js', content: 'let a=1;' }, { name: 'logo.png', content: 'x' }, { name: 'style.css', content: 'body{}' }, { name: 'index.html', content: '<h1>hi</h1>' }, { name: 'notes.md', content: 'n' }, { name: 'huge.js', content: 'x'.repeat(20000) }, { name: 'nocontent.js' }];
const pk = im.pickFiles(F).map(f => f.name);
ok('the page comes first, then css, then js', pk[0] === 'index.html' && pk.indexOf('style.css') < pk.indexOf('script.js'), pk);
ok('pictures, oversized files and files with no text are left out', !pk.includes('logo.png') && !pk.includes('huge.js') && !pk.includes('nocontent.js'), pk);
ok('the total shown stays under the budget', (() => { const many = Array.from({ length: 10 }, (_, i) => ({ name: 'f' + i + '.js', content: 'y'.repeat(9000) })); return im.pickFiles(many).reduce((s, f) => s + f.content.length, 0) <= im.MAX_TOTAL; })());
const pr = im.prompt('add a dark mode', im.pickFiles(F));
ok('the prompt shows every file in FILE: format with its real code', /FILE: index\.html\n```html\n<h1>hi<\/h1>/.test(pr) && /FILE: script\.js\n```js\nlet a=1;/.test(pr), pr.slice(0, 200));
ok('the prompt contains the task and the keep-it-working rules', /Task: add a dark mode/.test(pr) && /Do not remove features/.test(pr) && /complete contents/.test(pr));
ok('the prompt has NO example file name a small model could copy', !/\bbro\b|counts clicks|Clicks: /.test(pr));

// ---- when the answer is refused
const OLD_JS = "const a=document.getElementById('a');const b=document.getElementById('b');const c=document.getElementById('c');const d=document.getElementById('d');\n" + 'x();\n'.repeat(120);
ok('a good rewrite is accepted', im.sanity(OLD_JS, OLD_JS + '\nfunction extra(){return 1;}', 'script.js') === '');
ok('an empty file is refused', /empty/.test(im.sanity('abc', '   ', 'a.js')));
ok('less than half the size is refused', /half/.test(im.sanity('x'.repeat(1000), 'x'.repeat(300), 'a.js')));
ok('a small file may shrink (nothing to protect)', im.sanity('x'.repeat(200), 'x'.repeat(50), 'a.js') === '');
ok('"rest of the code" placeholders are refused', /placeholder/.test(im.sanity('x'.repeat(100), '// ... rest of the code ...\nlet a;', 'a.js')) && /placeholder/.test(im.sanity('x'.repeat(100), '<p>same as above</p> unchanged', 'a.html')));
ok('a placeholder phrase that was already in the original is fine', im.sanity('// the existing code is below\n' + 'x'.repeat(100), '// the existing code is below\n' + 'x'.repeat(100) + 'y', 'a.js') === '');
ok('a page that lost its html structure is refused', /structure/.test(im.sanity('<!doctype html><html><body>' + 'p'.repeat(100) + '</body></html>', '<div>' + 'p'.repeat(100) + '</div>', 'index.html')));
ok('a script that dropped most of its elements is refused', /dropped most/.test(im.sanity(OLD_JS, 'x();\n'.repeat(130), 'script.js')));
ok('a script that kept its elements is accepted', im.sanity(OLD_JS, OLD_JS.replace('x();', 'y();'), 'script.js') === '');
ok('an element that moved into the page as an id is not counted as lost', im.sanity("const a=document.getElementById('a');const b=document.getElementById('b');const c=document.getElementById('c');" + 'x();\n'.repeat(130), 'x();\n'.repeat(130) + '<div id="a"></div><div id="b"></div><div id="c"></div>', 'script.js') === '');

// ---- every id the script uses must exist in the page
ok('no missing ids when all match', im.missingIds({ 'index.html': '<div id="a"></div><p id=\'b\'></p>', 'script.js': "getElementById('a');getElementById(\"b\")" }).length === 0);
ok('a missing id is reported', im.missingIds({ 'index.html': '<div id="a"></div>', 'script.js': "getElementById('a');getElementById('zzz')" }).join() === 'zzz');
ok('an id the script creates itself is not missing', im.missingIds({ 'index.html': '<div></div>', 'script.js': "el.id='made';getElementById('made')" }).length === 0);
ok('with no script or no page nothing is reported', im.missingIds({ 'index.html': '<div></div>' }).length === 0 && im.missingIds({ 'script.js': "getElementById('q')" }).length === 0 && im.missingIds({}).length === 0);
ok('bad input never throws', (() => { try { im.wantsImprove(null, null, null); im.askOf(undefined); im.pickFiles(null); im.sanity(null, null, null); im.missingIds({}); return true; } catch (e) { return false; } })());
console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
