// Studio workspace helpers: project dashboard, project-wide search, problems with file and line, a fixed test runner, and per-run diffs.
// Every answer comes from the real project files. If something cannot run here, the result says so plainly.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), cp = require('child_process');
const stu = require('./studio'), hist = require('./studiohistory'), runs = require('./studiorun');

const MAX_HITS = 100;

// ---------- dashboard: every real project, with its recent runs and changes ----------
function dashboard() {
  const all = runs.list();
  return stu.listProjects().map(p => {
    const mine = all.filter(r => r.project === p.name);
    let checkpoints = []; try { checkpoints = hist.list(stu, p.name); } catch {}
    return { name: p.name, files: p.files, updated: p.updated, runs: mine.length, lastRun: mine[0] || null, checkpoints: checkpoints.length, lastChange: checkpoints[0] ? { label: checkpoints[0].label, at: checkpoints[0].at, by: checkpoints[0].by } : null };
  });
}

// "Start editing my older projects": a real list, and a clear answer when the target is not obvious.
function resolveProject(text) {
  const list = stu.listProjects(), q = String(text || '').toLowerCase();
  if (!list.length) return { status: 'none', message: 'There are no Studio projects on this PC yet. Create one first.', projects: [] };
  const named = list.filter(p => new RegExp('(^|[^a-z0-9])' + p.name.replace(/[^a-z0-9]/g, '[-_ ]?') + '($|[^a-z0-9])', 'i').test(q));
  if (named.length === 1) return { status: 'found', project: named[0].name, projects: list.map(p => p.name) };
  if (list.length === 1) return { status: 'found', project: list[0].name, projects: [list[0].name] };
  return { status: 'ask', message: 'Which project should I open?', projects: list.map(p => p.name) };
}

// ---------- search ----------
function search(project, query, limit = 60) {
  const q = String(query || '').trim().toLowerCase(); if (!q) return [];
  const max = Math.max(1, Math.min(MAX_HITS, +limit || 60)), hits = [];
  for (const f of stu.snapshot(project)) {
    const lines = f.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(q)) { hits.push({ file: f.name, line: i + 1, text: lines[i].trim().slice(0, 220) }); if (hits.length >= max) return hits; }
  }
  return hits;
}

// ---------- problems: the static check, plus real script parse errors with line numbers ----------
function problems(project) {
  const out = [], files = stu.snapshot(project);
  for (const f of files) {
    if (/\.m?js$/i.test(f.name)) {
      try { new vm.Script(f.content, { filename: f.name }); }
      catch (e) {
        if (/import|export|await/.test(e.message)) continue;   // module syntax cannot be parsed as a plain script: not a real error
        const m = /:(\d+)/.exec(String(e.stack || '').split('\n')[0]) || /:(\d+)/.exec(String(e.stack || ''));
        out.push({ file: f.name, line: m ? +m[1] : null, severity: 'error', message: String(e.message).slice(0, 300), source: 'parse' });
      }
    }
    if (/\.json$/i.test(f.name)) { try { JSON.parse(f.content); } catch (e) { out.push({ file: f.name, line: null, severity: 'error', message: 'Invalid JSON: ' + String(e.message).slice(0, 200), source: 'parse' }); } }
  }
  const seen = new Set(out.map(p => p.file + '|' + p.message));
  for (const msg of stu.check(project)) {
    if (msg === 'No problems found.') continue;
    const file = (files.find(f => msg.startsWith(f.name + ' ') || msg.startsWith(f.name + ':')) || {}).name || '';
    const key = file + '|' + msg; if (seen.has(key)) continue; seen.add(key);
    out.push({ file, line: null, severity: /uses the element|repeats id/.test(msg) ? 'warning' : 'error', message: msg.slice(0, 300), source: 'check' });
  }
  return out.slice(0, 100);
}

// ---------- "build": what a static web project can really verify ----------
function build(project) {
  const t0 = Date.now(), list = problems(project), errors = list.filter(p => p.severity === 'error');
  const files = stu.snapshot(project);
  const out = [`Checked ${files.length} file(s): ${files.map(f => f.name).join(', ').slice(0, 300) || '(none)'}`, errors.length ? `${errors.length} error(s), ${list.length - errors.length} warning(s).` : `No errors${list.length ? ', ' + list.length + ' warning(s)' : ''}.`, ...list.slice(0, 20).map(p => `${p.severity.toUpperCase()} ${p.file}${p.line ? ':' + p.line : ''} ${p.message}`)];
  return { ok: errors.length === 0, cmd: 'studio build check (static)', code: errors.length ? 1 : 0, ms: Date.now() - t0, output: out.join('\n'), problems: list, note: 'Studio projects are static web files, so the build is a real parse and link check, not a bundler.' };
}

// ---------- tests: a fixed runner over the project's own *.test.js files, in a throwaway copy with a clean environment ----------
function tests(project) {
  const files = stu.snapshot(project), names = files.filter(f => /\.(test|spec)\.(c|m)?js$/.test(f.name) || /^test_.*\.js$/.test(path.basename(f.name))).map(f => f.name);
  if (!names.length) return { available: false, ok: null, cmd: '', output: 'This project has no test files. Add one named like app.test.js, then run the tests again.', passed: null, failed: null, ms: 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pholama-t-'));
  try {
    for (const f of files) { const full = path.join(tmp, f.name); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, f.content); }
    const env = { PATH: process.env.PATH || '', HOME: tmp, USERPROFILE: tmp, SystemRoot: process.env.SystemRoot || '', TEMP: tmp, TMPDIR: tmp, CI: '1', NO_COLOR: '1' };   // no tokens or keys from the PC reach test code
    const t0 = Date.now(), r = cp.spawnSync(process.execPath, ['--test', ...names], { cwd: tmp, env, timeout: 30000, maxBuffer: 2000000, encoding: 'utf8', windowsHide: true, shell: false });
    const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '').trim(), ms = Date.now() - t0;
    if (r.error && r.error.code === 'ETIMEDOUT') return { available: true, ok: false, cmd: 'node --test', code: null, ms, passed: null, failed: null, output: 'The tests were stopped after 30 seconds.\n' + out.slice(-1500) };
    if (r.error) return { available: false, ok: null, cmd: 'node --test', output: 'Could not start the test runner (' + (r.error.code || r.error.message) + ').', ms };
    const num = re => { const m = re.exec(out); return m ? +m[1] : null; };
    return { available: true, ok: r.status === 0, cmd: 'node --test', code: r.status, ms, passed: num(/^# pass (\d+)/m), failed: num(/^# fail (\d+)/m), output: out.length > 6000 ? '...' + out.slice(-6000) : out };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

// ---------- per-run diff: compare the run's checkpoint with the project now ----------
function runDiff(run) {
  if (!run.checkpoint) return { available: false, changes: [], note: 'No checkpoint was saved for this run, so there is nothing to compare with.' };
  try { return { available: true, changes: hist.compare(stu, run.project, run.checkpoint) }; }
  catch (e) { return { available: false, changes: [], note: 'The checkpoint is gone (' + e.message + ').' }; }
}
// Undo a whole run: restore its checkpoint. The current state is saved first, so this can be undone too.
function revertRun(run) {
  if (!run.checkpoint) throw new Error('This run has no checkpoint to go back to.');
  return hist.restore(stu, run.project, run.checkpoint);
}
// Reject one file's change: put that file back the way the checkpoint had it (or remove it if it is new).
function revertFile(run, file) {
  if (!run.checkpoint) throw new Error('This run has no checkpoint.');
  const cp0 = hist.load(stu, run.project, run.checkpoint), name = stu.fileName(file);
  hist.save(stu, run.project, 'Before reverting ' + name, { by: 'restore', force: true });
  if (Object.prototype.hasOwnProperty.call(cp0.files, name)) { stu.writeFile(run.project, name, String(cp0.files[name])); return { ok: true, text: 'Put back ' + name }; }
  stu.deleteFile(run.project, name); return { ok: true, text: 'Removed ' + name + ' (it did not exist before this run)' };
}

module.exports = { dashboard, resolveProject, search, problems, build, tests, runDiff, revertRun, revertFile };
