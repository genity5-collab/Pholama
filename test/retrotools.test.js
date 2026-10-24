// RetroStudio connector tools: templates, importing script files, exporting everything as one bundle.
import * as T from '../docs/retrotools.js';
import { simulateLuau } from '../docs/retrostudio.js';
import { encodeBest } from '../docs/retroencode.js';
import fs from 'fs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + '  -> ' + d); } };

ok('there are ready-made templates with unique ids and names', T.TEMPLATES.length >= 5 && new Set(T.TEMPLATES.map(t => t.id)).size === T.TEMPLATES.length && T.TEMPLATES.every(t => t.name && t.source.trim()));
ok('findTemplate finds by id and returns null otherwise', T.findTemplate('car').name === 'Car' && T.findTemplate('nope') === null);
for (const t of T.TEMPLATES) {
  const sim = simulateLuau(t.source);
  const enc = await encodeBest(t.source, sim.flat);
  ok('template "' + t.name + '" encodes with nothing skipped', enc.blocks > 0 && (enc.skipped || []).length === 0, 'blocks ' + enc.blocks + ' skipped ' + (enc.skipped || []).length);
  ok('template "' + t.name + '" writes one statement per line', t.source.split('\n').every(l => !/;\s*\S/.test(l)));
}
{ const sim = simulateLuau(T.findTemplate('car').source), sh = sim.parts.map(p => p.shape || p.type);
  ok('the car template previews four cylinder wheels and two ball lights', sh.filter(x => x === 'Cylinder').length === 4 && sh.filter(x => x === 'Ball').length === 2, JSON.stringify(sh));
  const wheels = sim.parts.filter(p => /Wheel/.test(p.name)); ok('the car wheels touch the ground (centre height equals radius)', wheels.length === 4 && wheels.every(w => Math.abs(w.position[2] - 1) < 0.01), JSON.stringify(wheels.map(w => w.position))); }
{ const sim = simulateLuau(T.findTemplate('snowman').source), b = sim.parts.filter(p => p.shape === 'Ball');
  ok('the snowman is three balls, each resting on the one below', b.length === 3 && Math.abs((b[1].position[2] - b[1].trueSize[2] / 2) - (b[0].position[2] + b[0].trueSize[2] / 2)) < 0.01 && Math.abs((b[2].position[2] - b[2].trueSize[2] / 2) - (b[1].position[2] + b[1].trueSize[2] / 2)) < 0.01, JSON.stringify(b.map(x => x.position))); }

ok('nameFromFile strips the folder and extension', T.nameFromFile('C:\\maps\\my car.v2.lua') === 'my car v2' && T.nameFromFile('/a/b/Door.luau') === 'Door');
ok('nameFromFile never returns an empty name', T.nameFromFile('.lua') === 'Script' && T.nameFromFile('') === 'Script' && T.nameFromFile('x'.repeat(100) + '.lua').length <= 40);
ok('readImport accepts .lua/.luau/.txt and normalises line endings', ['a.lua', 'a.LUAU', 'a.txt'].every(n => T.readImport(n, 'print(1)\r\nprint(2)\r').ok) && T.readImport('a.lua', 'a\r\nb').source === 'a\nb');
ok('readImport refuses other file types', !T.readImport('pic.png', 'x').ok && !T.readImport('a.js', 'x').ok && /not a/.test(T.readImport('a.exe', 'x').why));
ok('readImport refuses empty, binary and oversized files', !T.readImport('a.lua', '   \n').ok && !T.readImport('a.lua', 'ab\u0000cd').ok && !T.readImport('a.lua', 'x'.repeat(200 * 1024 + 1)).ok);
const two = [{ name: 'One', source: 'print(1)\n' }, { name: 'Two', source: 'print(2)\nprint(3)\n\n' }, { name: 'Empty', source: '  ' }];
const b = T.bundle(two);
ok('bundle labels each script and skips empty ones', /===== One =====/.test(b) && /===== Two =====/.test(b) && !/Empty/.test(b));
const back = T.unbundle(b);
ok('a bundle round-trips back into the same scripts', back.length === 2 && back[0].name === 'One' && back[0].source.trim() === 'print(1)' && back[1].source.trim() === 'print(2)\nprint(3)', JSON.stringify(back));
ok('a plain file with no headers is one script named after the file', T.unbundle('print(1)', 'Door').length === 1 && T.unbundle('print(1)', 'Door')[0].name === 'Door' && T.unbundle('   ').length === 0);
ok('all templates survive an export then import', T.unbundle(T.bundle(T.TEMPLATES)).length === T.TEMPLATES.length);

// the page wiring
const app = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8'), html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8'), css = fs.readFileSync(new URL('../docs/style.css', import.meta.url), 'utf8');
ok('the explorer has Templates, Import and Export all buttons and a hidden file input', ['wsTemplates', 'wsImport', 'wsExportAll', 'wsFile', 'wsTplMenu'].every(id => html.includes('id="' + id + '"')) && /id="wsFile"[^>]*accept="\.lua,\.luau,\.txt"/.test(html));
ok('app.js wires the buttons, drag-and-drop and the shared helpers', /import \* as RT from '\.\/retrotools\.js'/.test(app) && /wireRetroTools\(\)/.test(app) && /addEventListener\('drop'/.test(app) && /RT\.bundle/.test(app) && /RT\.readImport/.test(app));
ok('the menu and drop styles exist', /\.ws-tplmenu/.test(css) && /\.retro-grid\.drop/.test(css));

import * as CN from '../docs/studioconnectors.js';
{ const rs = CN.findConnector('retrostudio'), gh = CN.findConnector('github');
  ok('the RetroStudio connector is labelled as disabled on 1 January', rs.endsOn === '2027-01-01' && /Disabled on 1 January/.test(rs.endsLabel));
  ok('only RetroStudio carries the end label', CN.allConnectors().filter(c => c.endsOn).map(c => c.id).join() === 'retrostudio');
  ok('the notice shows before the date and flips to over on it', CN.endNotice(rs, new Date('2026-12-31T23:59:59')).over === false && CN.endNotice(rs, new Date('2027-01-01T00:00:00')).over === true && CN.endNotice(gh) === null);
  ok('it is a label only: the card still connects like before', CN.cardState(rs, { member: 'member' }).action === 'connect');
  ok('the card, the footer and the RetroStudio panel all say it', /endNotice\(c\)/.test(fs.readFileSync(new URL('../docs/studioconnectors.js', import.meta.url), 'utf8')) && /disabled on 1 January/.test(app) && /Disabled on 1 January<\/span>/.test(html)); }
ok('the module is cached for offline use', fs.readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8').includes('retrotools.js'));
console.log(fail ? 'FAILED ' + fail : 'ALL PASSED ' + pass);
process.exit(fail ? 1 : 0);
