// The PC run module and the website run module must produce the SAME run records, because one UI reads both.
const load = require('./helpers/sitecore'), fs = require('fs'), os = require('os'), path = require('path');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'par-')); process.env.PHOLAMA_STUDIO_RUNS = base + '/r';
const pc = require('../server/studiorun');
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 400))); if (!c) bad++; };
// times and ids differ every run, so they are replaced by their shape before comparing
const norm = o => JSON.parse(JSON.stringify(o, (k, v) => (/^(id|createdAt|updatedAt|finishedAt|startedAt|endedAt|at|ms)$/.test(k) && (typeof v === 'number' || typeof v === 'string')) ? (typeof v === 'string' && /^[rst]\d/.test(v) && k === 'id' ? v.replace(/[a-z0-9]{8,}/, 'ID') : typeof v) : v));
function drive(m) {
  const run = m.create({ project: 'shop', prompt: 'make a button. KEY=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', mode: 'build', model: 'm' });
  m.setStage(run, 'understand', 'running'); m.setStage(run, 'understand', 'completed', 'Target project: shop.');
  m.setStage(run, 'plan', 'running'); m.setPlan(run, [{ title: 'Add the button' }, { title: 'Style it', dependsOn: ['t1'] }, 'Test it']); m.setStage(run, 'plan', 'completed');
  m.setStage(run, 'execute', 'running');
  const s1 = m.openStep(run, { kind: 'edit', title: 'Edit index.html', tool: 'studio_patch', input: { file: 'index.html', find: 'a', replace: 'b' }, files: ['index.html'] }); m.closeStep(run, s1, { ok: true, output: 'Edited index.html', files: ['index.html'] });
  const s2 = m.openStep(run, { kind: 'edit', title: 'Edit style.css', tool: 'studio_patch', input: 'x' }); m.closeStep(run, s2, { ok: false, output: 'not found', error: 'the text was not found' });
  m.markTask(run, 't1', 'done'); m.noteFiles(run, [{ file: 'index.html', status: 'modified', added: 3, removed: 1 }]);
  m.addBuild(run, { cmd: 'check', code: 0, ok: true, ms: 5, output: 'fine' }); m.addTest(run, { cmd: 'tests', ok: false, passed: 2, failed: 1, ms: 9, output: '1 failed' });
  m.setProblems(run, [{ file: 'a.js', line: 4, severity: 'error', message: 'Unexpected token' }, { file: 'b.css', severity: 'warning', message: 'meh' }]);
  m.editPlan(run, [{ title: 'Add the button' }, { title: 'Style it better' }]);
  const open = m.openStep(run, { kind: 'tool', title: 'still going', tool: 'studio_read', input: {} });
  const rep = m.buildReport(run); m.finish(run, 'failed', rep, 'verification still reports problems'); return { run, rep, open };
}
(async () => {
  const cloud = await load('siteStudioRun.ts'); const a = drive(pc), b = drive(cloud);
  ok('the two modules agree on the stages, plan, steps, files and verification', JSON.stringify(norm(a.run)) === JSON.stringify(norm(b.run)), '\nPC   ' + JSON.stringify(norm(a.run)).slice(0, 500) + '\nSITE ' + JSON.stringify(norm(b.run)).slice(0, 500));
  ok('...and on the final report', JSON.stringify(a.rep) === JSON.stringify(b.rep), JSON.stringify(b.rep));
  ok('a step still running when the run ends is marked failed on both', a.open.status === 'failed' && b.open.status === 'failed' && a.open.error === b.open.error);
  ok('both have the same modes and stages', JSON.stringify(Object.keys(pc.MODES)) === JSON.stringify(Object.keys(cloud.MODES)) && JSON.stringify(pc.STAGES) === JSON.stringify(cloud.STAGES) && pc.MODES.repair.maxRepairs === cloud.MODES.repair.maxRepairs && pc.MODES.fast.maxSteps === cloud.MODES.fast.maxSteps);
  ok('neither stores the pasted key', !JSON.stringify(a.run).includes('ghp_aaaa') && !JSON.stringify(b.run).includes('ghp_aaaa'));
  // exact saved values are hidden too, whatever shape they have
  cloud.setKnownSecrets(['plain-weird-shaped-value-77']); pc.setSecretSource(() => ['plain-weird-shaped-value-77']);
  ok('an exact saved value is hidden on both', cloud.scrub('x plain-weird-shaped-value-77 y') === pc.scrub('x plain-weird-shaped-value-77 y') && !cloud.scrub('plain-weird-shaped-value-77').includes('weird'));
  ok('a {{secret:NAME}} reference survives on both', cloud.scrub('use {{secret:API_KEY}}') === 'use {{secret:API_KEY}}' && pc.scrub('use {{secret:API_KEY}}') === 'use {{secret:API_KEY}}');
  let e1, e2; try { cloud.editPlan(b.run, []); } catch (x) { e1 = x.message; } try { pc.editPlan(a.run, []); } catch (x) { e2 = x.message; } ok('a finished run cannot have its plan edited, same message', e1 && e1 === e2, e1 + ' / ' + e2);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); fs.rmSync(base, { recursive: true, force: true }); process.exit(bad ? 1 : 0);
})();
