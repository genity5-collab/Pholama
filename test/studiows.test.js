// The Studio workspace: every script and model in one place, live edit, explorer tree, save/load. Uses the REAL preview.
import { simulateLuau } from '../docs/retrostudio.js';
import * as W from '../docs/studioworkspace-model.js';
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 200))); if (!c) bad++; };
const SRC = n => `local part = Instance.new("Part", workspace)\npart.Size = Vector3.new(${n}, 1, 4)\npart.Position = Vector3.new(${n}, 3, 0)\npart.Anchored = true\n`;
const parts = src => simulateLuau(src).parts;

const ws = W.newWorkspace();
const a = W.addScript(ws, 'Door', SRC(2)), b = W.addScript(ws, 'Platform', SRC(6));
ok('scripts are listed', W.scripts(ws).length === 2 && ws.active === a.id);
ok('names stay unique', W.addScript(ws, 'Door', '').name === 'Door 2');
ok('names are cleaned', W.addScript(ws, '  <b>Evil</b>/..  ', '').name === 'bEvilb ..' || !/[<>/]/.test(W.scripts(ws).pop().name));

// run -> model
const m1 = W.syncModel(ws, a.id, parts(a.source));
ok('running a script makes a model with its parts', m1 && m1.parts.length === 1 && m1.fromScript === a.id && m1.name.startsWith('Door'));
W.syncModel(ws, b.id, parts(b.source));
ok('every model is listed', W.models(ws).length === 2);
ok('the viewport gets parts from ALL models', W.allParts(ws).length === 2 && new Set(W.allParts(ws).map(p => p.model)).size === 2);
ok('a script with no parts makes no model', W.syncModel(ws, W.scripts(ws)[2].id, []) === null);

// live edit
const before = W.find(ws, m1.id).parts[0].size[0];
W.editScript(ws, a.id, SRC(9)); W.syncModel(ws, a.id, parts(W.find(ws, a.id).source));
ok('live edit rebuilds the same model (no duplicate)', W.models(ws).length === 2 && W.find(ws, m1.id).parts[0].size[0] === 9 && before === 2, W.find(ws, m1.id).parts[0].size);
ok('editing a model id is refused', W.editScript(ws, m1.id, 'x') === false);
const rev = ws.rev; W.editScript(ws, a.id, SRC(9)); ok('saving identical text changes nothing', ws.rev === rev);

W.editScript(ws, W.scripts(ws)[1].id, 'print("nothing")'); const gone = W.syncModel(ws, W.scripts(ws)[1].id, []);
ok('a script that stops building parts loses its model', gone === null && W.models(ws).length === 1, W.models(ws).length);
W.editScript(ws, W.scripts(ws)[1].id, SRC(6)); W.syncModel(ws, W.scripts(ws)[1].id, parts(SRC(6)));

// explorer tree
const t = W.tree(ws);
ok('tree has Workspace and Scripts like Roblox', t[0].label === 'Workspace' && t[1].label === 'Scripts' && t[0].children.length === 2 && t[1].children.length >= 2);
ok('tree marks the active item', t.flatMap(x => x.children).filter(c => c.active).length === 1);
W.activate(ws, b.id); ok('activate switches the active item', W.active(ws).id === b.id);
ok('activate refuses an unknown id', W.activate(ws, 'nope') === false && W.active(ws).id === b.id);

// rename / remove
W.rename(ws, b.id, 'Door'); ok('rename keeps names unique', W.find(ws, b.id).name !== 'Door' && /^Door/.test(W.find(ws, b.id).name));
const mid = W.models(ws).find(m => m.fromScript === b.id).id;
W.remove(ws, b.id);
ok('deleting a script keeps its model but unlinks it', W.find(ws, mid) && W.find(ws, mid).fromScript === null);
ok('deleting the active item moves active to a neighbour', W.active(ws) !== null && W.find(ws, ws.active));
ok('removing an unknown id is harmless', W.remove(ws, 'nope') === false);

// save / load
const back = W.load(W.save(ws));
ok('save and load round-trips everything', back.items.length === ws.items.length && W.models(back).length === W.models(ws).length && back.active === ws.active);
ok('loaded parts are still drawable', W.allParts(back).length === W.allParts(ws).length);
for (const junk of ['', 'not json', '{}', '{"v":2}', '{"v":1,"items":5}', 'null', '[]']) ok('bad saved data is ignored: ' + JSON.stringify(junk), W.load(junk).items.length === 0);
const huge = JSON.stringify({ v: 1, items: Array.from({ length: 500 }, (_, i) => ({ kind: 'script', name: 'S' + i, source: 'x'.repeat(200000) })) });
const hl = W.load(huge); ok('a huge save is capped (200 items, 100k chars each)', hl.items.length === 200 && hl.items.every(i => i.source.length <= 100000));
ok('a saved item of an unknown kind is dropped', W.load(JSON.stringify({ v: 1, items: [{ kind: 'evil', name: 'x' }, { kind: 'script', name: 'ok', source: '' }] })).items.length === 1);

console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
