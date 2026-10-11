// Pure helpers of the PC Studio workspace (no DOM).
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
(async () => {
  const W = await import('../web/studioworkspace.js');
  ok('fmtMs formats ms and seconds', W.fmtMs(250) === '250ms' && W.fmtMs(1500) === '1.5s' && W.fmtMs(null) === '0ms' && W.fmtMs('x') === '0ms');
  ok('status classes map every state', W.stepStatusClass('running') === 'ws-status-running' && W.stepStatusClass('failed') === 'ws-status-failed' && W.stepStatusClass('waiting') === 'ws-status-waiting' && W.stepStatusClass('cancelled') === 'ws-status-cancelled' && W.stepStatusClass('completed') === 'ws-status-completed' && W.stepStatusClass('zzz') === 'ws-status-pending');
  const run = { stage: 'verify', stages: [{ id: 'understand', status: 'completed' }, { id: 'inspect', status: 'completed' }, { id: 'plan', status: 'completed' }, { id: 'execute', status: 'completed' }, { id: 'verify', status: 'running' }, { id: 'repair', status: 'pending' }, { id: 'report', status: 'pending' }] };
  const s = W.stageSummary(run); ok('stage summary counts and finds the current stage', s.total === 7 && s.completed === 4 && s.running === 1 && s.pending === 2 && s.current === 'verify', JSON.stringify(s));
  ok('stage summary survives a missing run', W.stageSummary(null).total === 0 && W.stageSummary({}).total === 0);
  const items = [{ title: 'Writing app.js', status: 'completed', output: 'Saved' }, { title: 'Build check', status: 'failed', error: 'gone.js missing' }, { title: 'Reading', status: 'completed', input: 'index.html' }];
  ok('search is case-insensitive over title, input and output', W.filterEntries(items, { q: 'APP.JS' }).length === 1 && W.filterEntries(items, { q: 'index' }).length === 1 && W.filterEntries(items, { q: 'saved' }).length === 1);
  ok('"failed only" keeps only real failures', W.filterEntries(items, { failedOnly: true }).length === 1 && W.filterEntries(items, { failedOnly: true })[0].title === 'Build check');
  ok('filters combine and tolerate junk', W.filterEntries(items, { q: 'gone', failedOnly: true }).length === 1 && W.filterEntries(null).length === 0 && W.filterEntries([null, undefined]).length === 0 && W.filterEntries([{}], { failedOnly: true }).length === 0 && W.filterEntries([{}], { q: 'x' }).length === 0);
  const t = W.buildTree([{ name: 'index.html', size: 3 }, { name: 'css/a.css', size: 1 }, { name: 'js/lib/b.js', size: 2 }], ['assets']);
  const kids = n => Array.isArray(n) ? n : (n && n.children) || [];
  const find = (n, p) => kids(n).find(c => c.path === p);
  ok('the tree nests folders and files', find(t, 'css') && find(find(t, 'css'), 'css/a.css') && find(find(t, 'js'), 'js/lib') && find(find(find(t, 'js'), 'js/lib'), 'js/lib/b.js'), JSON.stringify(t).slice(0, 200));
  ok('empty folders from the server are shown too', !!find(t, 'assets'));
  ok('the tree has no duplicates and tolerates junk', kids(W.buildTree([{ name: 'a.js' }, { name: 'a.js' }, null, {}], null)).length === 1);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
