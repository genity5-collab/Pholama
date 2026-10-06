// The AI edit path makes ONE checkpoint (with the old content) before it changes a project, and a history problem never stops an edit.
const fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pholama-hai-'));
process.env.PHOLAMA_STUDIO = path.join(base, 'studio'); process.env.PHOLAMA_STUDIO_HISTORY = path.join(base, 'hist'); process.env.PHOLAMA_HOME = path.join(base, 'home');
const stu = require('../server/studio.js'), H = require('../server/studiohistory.js'), agent = require('../server/agent.js');
let bad = 0, n = 0; const ok = (name, c, x) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + name + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
const obj = p => Object.fromEntries(stu.snapshot(p).map(f => [f.name, f.content]));

stu.createProject('p1', 'blank'); stu.writeFile('p1', 'index.html', 'ORIGINAL\n');
agent.loggedStudio('write', 'p1', 'index.html', 'AI VERSION 1\n');
let cps = H.list(stu, 'p1');
ok('the first AI edit made exactly one checkpoint', cps.length === 1 && cps[0].by === 'ai' && /Before AI edit/.test(cps[0].label), JSON.stringify(cps));
ok('that checkpoint holds the content from BEFORE the AI wrote', H.load(stu, 'p1', cps[0].id).files['index.html'] === 'ORIGINAL\n');
agent.loggedStudio('write', 'p1', 'index.html', 'AI VERSION 2\n'); agent.loggedStudio('write', 'p1', 'b.html', 'second file\n');
ok('more AI edits in the same turn do not pile up checkpoints', H.list(stu, 'p1').length === 1, H.list(stu, 'p1').length);
ok('the AI edit itself still happened', obj('p1')['index.html'] === 'AI VERSION 2\n' && obj('p1')['b.html'] === 'second file\n');
ok('the user can restore the pre-AI state', (H.restore(stu, 'p1', cps[0].id), obj('p1')['index.html'] === 'ORIGINAL\n' && !('b.html' in obj('p1'))));
// the tool-call path
stu.createProject('p2', 'blank'); stu.writeFile('p2', 'index.html', 'BEFORE\n');
agent.runTool(require('../server/studio.js').tools ? stu.tools() : [], 'studio_write', { project: 'p2', file: 'index.html', content: 'AFTER\n' }, { toolCalls: 0, userId: 't' }).then(out => {
  ok('a studio_write tool call also makes a checkpoint of the old content', H.list(stu, 'p2').length === 1 && H.load(stu, 'p2', H.list(stu, 'p2')[0].id).files['index.html'] === 'BEFORE\n', out);
  ok('and the tool call wrote the new content', obj('p2')['index.html'] === 'AFTER\n');
  // a broken history folder must not block an edit
  process.env.PHOLAMA_STUDIO_HISTORY = '/proc/nope/never'; stu.createProject('p3', 'blank');
  let threw = null; try { agent.loggedStudio('write', 'p3', 'index.html', 'STILL WRITES\n'); } catch (e) { threw = e.message; }
  ok('if history cannot be saved, the edit still goes through', !threw && obj('p3')['index.html'] === 'STILL WRITES\n', threw);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED (' + n + ')'); process.exit(bad ? 1 : 0);
}).catch(e => { console.log('FAIL crashed -> ' + e.message); process.exit(1); });
