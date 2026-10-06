// Studio version history: a checkpoint of the whole project before the AI (or a restore) changes it, a list, a line diff, and a restore.
// Checkpoints live in ~/.pholama/studio-history/<project>/<id>.json, OUTSIDE the project folder, so they never appear in the file list or in a publish.
// Zero dependencies. A restore first saves the current state, so a restore can be undone too.
'use strict';
const fs = require('fs'), path = require('path');

const MAX_CHECKPOINTS = 40;          // per project; the oldest are dropped
const MAX_BYTES = 6 * 1024 * 1024;   // one checkpoint
const ID_RE = /^\d{13}-[a-z0-9]{4}$/;

// stu.snapshot() is a list of {name,size,content}; a checkpoint keeps it as { name: content }. Pictures are not in a snapshot, so a restore never touches them.
const files = (stu, project) => Object.fromEntries(stu.snapshot(project).map(f => [f.name, f.content]));

function histRoot(stu) { return process.env.PHOLAMA_STUDIO_HISTORY || path.join(path.dirname(stu.ROOT), 'studio-history'); }
function dirOf(stu, project) { const name = stu.projName(project), d = path.join(histRoot(stu), name); if (path.relative(histRoot(stu), d).startsWith('..')) throw new Error('bad project'); return d; }
const idOk = id => { if (!ID_RE.test(String(id))) throw new Error('bad checkpoint id'); return String(id); };

// Save the project as it is now. Returns the checkpoint (without the file contents), or null if nothing changed since the last one.
function save(stu, project, label, opts = {}) {
  const fl = files(stu, project), json = JSON.stringify({ files: fl });
  if (Buffer.byteLength(json) > MAX_BYTES) throw new Error('the project is too big to checkpoint');
  const d = dirOf(stu, project); fs.mkdirSync(d, { recursive: true });
  const last = list(stu, project)[0];
  if (!opts.force && last) { try { const prev = JSON.parse(fs.readFileSync(path.join(d, last.id + '.json'), 'utf8')); if (JSON.stringify({ files: prev.files }) === json) return null; } catch {} }
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const meta = { id, at: Date.now(), label: String(label || 'Checkpoint').replace(/\s+/g, ' ').trim().slice(0, 100), by: opts.by === 'user' ? 'user' : opts.by === 'restore' ? 'restore' : 'ai', fileCount: Object.keys(fl).length, bytes: Buffer.byteLength(json) };
  fs.writeFileSync(path.join(d, id + '.json'), JSON.stringify({ ...meta, files: fl }));
  for (const old of list(stu, project).slice(MAX_CHECKPOINTS)) { try { fs.unlinkSync(path.join(d, old.id + '.json')); } catch {} }
  return meta;
}

// Newest first. Never returns the file contents (they can be large).
function list(stu, project) {
  const d = dirOf(stu, project); if (!fs.existsSync(d)) return [];
  const out = [];
  for (const n of fs.readdirSync(d)) {
    if (!n.endsWith('.json') || !ID_RE.test(n.slice(0, -5))) continue;
    try { const j = JSON.parse(fs.readFileSync(path.join(d, n), 'utf8')); out.push({ id: j.id, at: j.at, label: j.label, by: j.by, fileCount: j.fileCount, bytes: j.bytes }); } catch {}
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

function load(stu, project, id) {
  const f = path.join(dirOf(stu, project), idOk(id) + '.json');
  if (!fs.existsSync(f)) throw new Error('that checkpoint no longer exists');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// Line diff (longest common subsequence). Big files fall back to "changed" so a huge file can never freeze the server.
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  if (A.length * B.length > 4e6) return { added: B.length, removed: A.length, hunks: [{ type: 'too-big' }] };
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { ops.push([' ', A[i], i + 1, j + 1]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i], i + 1, null]); i++; } else { ops.push(['+', B[j], null, j + 1]); j++; } }
  while (i < n) ops.push(['-', A[i], ++i, null]);
  while (j < m) ops.push(['+', B[j], null, ++j]);
  let added = 0, removed = 0; for (const o of ops) { if (o[0] === '+') added++; else if (o[0] === '-') removed++; }
  // keep 2 lines of context around each change
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let x = Math.max(0, k - 2); x <= Math.min(ops.length - 1, k + 2); x++) keep[x] = true; });
  const hunks = []; let cur = null;
  ops.forEach((o, k) => { if (!keep[k]) { cur = null; return; } if (!cur) { cur = { oldStart: o[2] || 0, newStart: o[3] || 0, lines: [] }; hunks.push(cur); } cur.lines.push({ t: o[0], s: o[1].slice(0, 300) }); });
  return { added, removed, hunks: hunks.slice(0, 60) };
}

// Compare a checkpoint with the project as it is now (or with another checkpoint). Result: one entry per file that is added, removed or changed.
function compare(stu, project, id, otherId) {
  const before = load(stu, project, id).files, after = otherId ? load(stu, project, otherId).files : files(stu, project), out = [];
  for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = before[name], b = after[name];
    if (a === undefined) out.push({ file: name, status: 'added', ...diffLines('', String(b)) });
    else if (b === undefined) out.push({ file: name, status: 'removed', ...diffLines(String(a), '') });
    else if (a !== b) out.push({ file: name, status: 'changed', ...diffLines(String(a), String(b)) });
  }
  return out;
}

// Put the project back the way a checkpoint was. The current state is saved first, so this can be undone.
function restore(stu, project, id) {
  const cp = load(stu, project, id), want = cp.files;
  const undo = save(stu, project, 'Before restoring "' + cp.label + '"', { by: 'restore', force: true });
  const now = files(stu, project);
  for (const name of Object.keys(now)) if (!(name in want)) { try { stu.deleteFile(project, name); } catch {} }
  for (const [name, content] of Object.entries(want)) stu.writeFile(project, name, String(content));
  return { ok: true, restored: cp.label, files: Object.keys(want).length, undo: undo && undo.id };
}

function remove(stu, project, id) { const f = path.join(dirOf(stu, project), idOk(id) + '.json'); if (!fs.existsSync(f)) throw new Error('that checkpoint no longer exists'); fs.unlinkSync(f); return { ok: true }; }

module.exports = { save, list, load, compare, restore, remove, diffLines, MAX_CHECKPOINTS };
