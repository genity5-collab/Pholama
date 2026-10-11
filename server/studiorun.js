// Studio runs: one record per task, with the seven stages and a timeline built ONLY from real events.
// A step is added when a real tool starts, and closed with its real result. Nothing here invents progress.
// Runs live in ~/.pholama/studio-runs/<id>.json, outside the project folder, so they never show up in a publish.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const STAGES = ['understand', 'inspect', 'plan', 'execute', 'verify', 'repair', 'report'];
const MODES = {
  fast:   { label: 'Fast',   note: 'Small, targeted changes.',                         maxSteps: 8,  maxRepairs: 1, plan: false },
  build:  { label: 'Build',  note: 'Complete implementation workflow.',               maxSteps: 24, maxRepairs: 2, plan: true },
  think:  { label: 'Think',  note: 'More planning and reasoning before editing.',     maxSteps: 24, maxRepairs: 2, plan: true, planFirst: true },
  repair: { label: 'Repair', note: 'Inspect logs, find bugs, patch, then verify.',    maxSteps: 16, maxRepairs: 3, plan: true, startAt: 'verify' }
};
const STEP_STATUS = new Set(['running', 'completed', 'failed', 'cancelled', 'waiting']);
const RUN_STATUS = new Set(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']);
const MAX_RUNS = 200, MAX_STEPS = 400, MAX_TEXT = 4000, ID_RE = /^r[a-z0-9]{6,20}$/;

const root = () => process.env.PHOLAMA_STUDIO_RUNS || path.join(os.homedir(), '.pholama', 'studio-runs');
const clip = (v, n = MAX_TEXT) => { const s = typeof v === 'string' ? v : v == null ? '' : (() => { try { return JSON.stringify(v); } catch { return String(v); } })(); return s.length > n ? s.slice(0, n) + '\n[cut: ' + (s.length - n) + ' more characters]' : s; };
const idOk = id => { if (!ID_RE.test(String(id))) throw new Error('bad run id'); return String(id); };
const file = id => path.join(root(), idOk(id) + '.json');

// Never let a secret reach a stored run or a screen.
const SECRET = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|tlm_sk_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,})/gi;
// Exact values the owner saved as secrets are hidden too, whatever their shape (a pattern can never know every key format).
// `extraSecrets` is set by the services layer; it returns the values of every project's saved secrets.
let extraSecrets = () => [];
const setSecretSource = fn => { extraSecrets = typeof fn === 'function' ? fn : () => []; };
const scrub = s => {
  let t = String(s == null ? '' : s);
  try { for (const v of extraSecrets()) if (v && v.length >= 8 && t.includes(v)) t = t.split(v).join('[hidden]'); } catch {}
  const keep = []; t = t.replace(/\{\{secret:[A-Z0-9_]+\}\}/g, m => { keep.push(m); return '\u0001' + (keep.length - 1) + '\u0002'; });   // a reference is not a secret
  t = t.replace(SECRET, '[hidden]');
  return t.replace(/\u0001(\d+)\u0002/g, (_, i) => keep[+i]);
};
const safe = v => scrub(clip(v));

function save(run) {
  fs.mkdirSync(root(), { recursive: true });
  const f = file(run.id), tmp = f + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(run)); fs.renameSync(tmp, f);   // atomic: a crash never leaves half a record
  prune();
  return run;
}
function prune() {
  try {
    const all = fs.readdirSync(root()).filter(n => /^r[a-z0-9]+\.json$/.test(n)).map(n => ({ n, t: fs.statSync(path.join(root(), n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const o of all.slice(MAX_RUNS)) { try { fs.unlinkSync(path.join(root(), o.n)); } catch {} }
  } catch {}
}
function load(id) {
  const f = file(id); if (!fs.existsSync(f)) throw new Error('no such run');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function create({ project, prompt, mode, model, files }) {
  const m = MODES[mode] ? mode : 'build';
  const run = {
    id: 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    project: String(project || '').slice(0, 60), prompt: safe(prompt).slice(0, 4000), mode: m, model: String(model || '').slice(0, 80),
    attachments: Array.isArray(files) ? files.slice(0, 10).map(x => String(x).slice(0, 100)) : [],
    status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), finishedAt: null,
    stage: 'understand', stages: STAGES.map(s => ({ id: s, status: 'pending', startedAt: null, endedAt: null, note: '' })),
    plan: [], steps: [], checkpoint: null, files: {}, verify: { builds: [], tests: [], problems: [] }, repairs: 0, report: null, error: null
  };
  return save(run);
}

// ---- stages ----
function setStage(run, id, status, note) {
  if (!STAGES.includes(id)) throw new Error('unknown stage');
  const s = run.stages.find(x => x.id === id), now = Date.now();
  if (status === 'running' && !s.startedAt) s.startedAt = now;
  if ((status === 'completed' || status === 'failed' || status === 'skipped') && !s.endedAt) s.endedAt = now;
  s.status = status; if (note != null) s.note = safe(note).slice(0, 300);
  if (status === 'running') run.stage = id;
  run.updatedAt = now; return run;
}

// ---- plan: editable by the user while it is still waiting ----
function setPlan(run, tasks) {
  run.plan = (Array.isArray(tasks) ? tasks : []).slice(0, 30).map((t, i) => ({
    id: 't' + (i + 1), title: scrub(String(t.title || t || '')).slice(0, 200), dependsOn: (Array.isArray(t.dependsOn) ? t.dependsOn : []).filter(d => /^t\d+$/.test(d)).slice(0, 8),
    status: 'pending'
  })).filter(t => t.title);
  run.updatedAt = Date.now(); return run;
}
function editPlan(run, tasks) {
  if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') throw new Error('this run has finished, so its plan cannot change');
  const done = new Map(run.plan.map(t => [t.title, t.status]));
  setPlan(run, tasks); for (const t of run.plan) if (done.get(t.title) === 'done') t.status = 'done';
  return run;
}
function markTask(run, id, status) { const t = run.plan.find(x => x.id === id); if (t) t.status = status; run.updatedAt = Date.now(); return run; }

// ---- steps: opened by a real tool start, closed by the real result ----
function openStep(run, { kind, title, tool, input, files }) {
  if (run.steps.length >= MAX_STEPS) throw new Error('this run reached the step limit (' + MAX_STEPS + ')');
  const st = { id: 's' + (run.steps.length + 1), stage: run.stage, kind: String(kind || 'tool').slice(0, 20), title: scrub(title).slice(0, 160), tool: String(tool || '').slice(0, 60),
    input: safe(input), output: '', status: 'running', startedAt: Date.now(), endedAt: null, ms: null, files: (files || []).map(x => String(x).slice(0, 120)).slice(0, 10), error: null };
  run.steps.push(st); run.updatedAt = st.startedAt; return st;
}
function closeStep(run, step, { ok, output, error, files, status }) {
  const st = typeof step === 'string' ? run.steps.find(x => x.id === step) : step; if (!st) throw new Error('no such step');
  const now = Date.now(); st.endedAt = now; st.ms = now - st.startedAt;
  st.status = STEP_STATUS.has(status) ? status : ok === false ? 'failed' : 'completed';
  st.output = safe(output); if (error) st.error = safe(error).slice(0, 600);
  if (Array.isArray(files)) st.files = [...new Set([...st.files, ...files.map(x => String(x).slice(0, 120))])].slice(0, 10);
  run.updatedAt = now; return st;
}
// A command or tool that is waiting for the user's Allow must show as waiting, never as done.
function waitStep(run, step, why) { const st = typeof step === 'string' ? run.steps.find(x => x.id === step) : step; st.status = 'waiting'; st.output = safe(why); run.status = 'waiting'; run.updatedAt = Date.now(); return st; }

// ---- verification evidence ----
function addBuild(run, r) { run.verify.builds.push({ at: Date.now(), cmd: String(r.cmd || '').slice(0, 200), code: r.code == null ? null : r.code, ok: !!r.ok, ms: r.ms || 0, output: safe(r.output) }); run.verify.builds = run.verify.builds.slice(-10); return run; }
function addTest(run, r) { run.verify.tests.push({ at: Date.now(), cmd: String(r.cmd || '').slice(0, 200), ok: !!r.ok, passed: r.passed == null ? null : r.passed, failed: r.failed == null ? null : r.failed, ms: r.ms || 0, output: safe(r.output) }); run.verify.tests = run.verify.tests.slice(-10); return run; }
function setProblems(run, list) {
  run.verify.problems = (list || []).slice(0, 100).map(p => ({ file: String(p.file || '').slice(0, 120), line: p.line == null ? null : +p.line || null, severity: p.severity === 'warning' ? 'warning' : 'error', message: scrub(p.message).slice(0, 300) }));
  return run;
}

// ---- finish ----
function noteFiles(run, changes) { for (const c of changes || []) run.files[String(c.file).slice(0, 120)] = { status: c.status, added: c.added || 0, removed: c.removed || 0 }; return run; }
function finish(run, status, report, error) {
  if (!RUN_STATUS.has(status)) throw new Error('bad status');
  const now = Date.now(); run.status = status; run.finishedAt = now; run.updatedAt = now;
  for (const st of run.steps) if (st.status === 'running') { st.status = status === 'cancelled' ? 'cancelled' : 'failed'; st.endedAt = now; st.ms = now - st.startedAt; if (!st.error) st.error = 'stopped before it finished'; }
  if (report) run.report = report; if (error) run.error = safe(error).slice(0, 600);
  return run;
}
// The report is built from the record itself, so it can only say what really happened.
function buildReport(run) {
  const files = Object.entries(run.files).map(([file, v]) => ({ file, ...v }));
  const failedSteps = run.steps.filter(s => s.status === 'failed');
  const lastBuild = run.verify.builds[run.verify.builds.length - 1], lastTest = run.verify.tests[run.verify.tests.length - 1];
  const errors = run.verify.problems.filter(p => p.severity === 'error');
  const unresolved = [
    ...errors.slice(0, 10).map(p => `${p.file}${p.line ? ':' + p.line : ''} ${p.message}`),
    ...(lastBuild && !lastBuild.ok ? ['The last build failed (exit ' + lastBuild.code + ').'] : []),
    ...(lastTest && !lastTest.ok ? ['The last test run failed.'] : [])
  ];
  return {
    changed: files.length, files,
    steps: { total: run.steps.length, failed: failedSteps.length },
    verified: { build: lastBuild ? (lastBuild.ok ? 'passed' : 'failed') : 'not run', tests: lastTest ? (lastTest.ok ? 'passed' : 'failed') : 'not run', problems: errors.length },
    repairs: run.repairs, unresolved
  };
}

function list(project) {
  if (!fs.existsSync(root())) return [];
  const out = [];
  for (const n of fs.readdirSync(root())) {
    if (!/^r[a-z0-9]+\.json$/.test(n)) continue;
    try { const r = JSON.parse(fs.readFileSync(path.join(root(), n), 'utf8')); if (project && r.project !== project) continue; out.push({ id: r.id, project: r.project, prompt: String(r.prompt).slice(0, 140), mode: r.mode, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, steps: r.steps.length, changed: Object.keys(r.files || {}).length }); } catch {}
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

// Anything still "running" after a restart is not really running any more.
function recover() {
  if (!fs.existsSync(root())) return 0; let n = 0;
  for (const x of list()) if (x.status === 'running' || x.status === 'queued') { try { const r = load(x.id); finish(r, 'failed', null, 'Pholama restarted before this run finished.'); save(r); n++; } catch {} }
  return n;
}
function remove(id) { const f = file(id); if (!fs.existsSync(f)) throw new Error('no such run'); fs.unlinkSync(f); return { ok: true }; }

module.exports = { setSecretSource,  STAGES, MODES, create, load, save, list, remove, recover, setStage, setPlan, editPlan, markTask, openStep, closeStep, waitStep, addBuild, addTest, setProblems, noteFiles, finish, buildReport, scrub, MAX_STEPS };
