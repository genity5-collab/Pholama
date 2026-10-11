'use strict';
// Review-first for Studio runs. The AI works and is verified on the real files (so the build check is honest);
// every changed file then waits for YOU. Accept keeps it, Reject puts the file back the way it was before the run.
// A file only counts as "accepted" when you press Accept; nothing is final until then.
const ws = require('./studioworkspace');

const pendingOf = (run) => {
  const d = ws.runDiff(run), done = run.review || {};
  return { available: d.available, note: d.note || null, files: (d.changes || []).map(c => Object.assign({}, c, { decision: done[c.file] || 'pending' })) };
};
const list = (run) => pendingOf(run);
function mark(run, file, decision) { run.review = Object.assign({}, run.review, { [file]: decision }); return run; }

// Accept one file: it stays as the AI wrote it.
function accept(run, file) {
  const f = pendingOf(run).files.find(x => x.file === file);
  if (!f) throw new Error('That file has no change to accept.');
  mark(run, file, 'accepted'); return { ok: true, text: 'Kept ' + file };
}
// Reject one file: it goes back to how it was before the run (or is removed if the run created it).
function reject(run, file) {
  const f = pendingOf(run).files.find(x => x.file === file);
  if (!f) throw new Error('That file has no change to reject.');
  const r = ws.revertFile(run, file); mark(run, file, 'rejected'); return r;
}
function acceptAll(run) { const p = pendingOf(run).files.filter(x => x.decision === 'pending'); for (const f of p) mark(run, f.file, 'accepted'); return { ok: true, count: p.length, text: 'Kept ' + p.length + ' file(s)' }; }
function rejectAll(run) { const p = pendingOf(run).files.filter(x => x.decision === 'pending'); for (const f of p) { ws.revertFile(run, f.file); mark(run, f.file, 'rejected'); } return { ok: true, count: p.length, text: 'Put back ' + p.length + ' file(s)' }; }

module.exports = { list, accept, reject, acceptAll, rejectAll };
