// Website Studio runs: the same run record as the PC Studio (7 stages, a timeline of real steps, plan, verification, honest report).
// The record is built ONLY from real events. Persistence is injected (Supabase in production, memory in tests).
// Kept identical to server/studiorun.js on purpose; test/sitestudio-parity.test.js fails if the two ever drift apart.

export const STAGES = ['understand', 'inspect', 'plan', 'execute', 'verify', 'repair', 'report'];
export const MODES: Record<string, { label: string; note: string; maxSteps: number; maxRepairs: number; plan: boolean; planFirst?: boolean; startAt?: string }> = {
  fast:   { label: 'Fast',   note: 'Small, targeted changes.',                      maxSteps: 8,  maxRepairs: 1, plan: false },
  build:  { label: 'Build',  note: 'Complete implementation workflow.',            maxSteps: 24, maxRepairs: 2, plan: true },
  think:  { label: 'Think',  note: 'More planning and reasoning before editing.',  maxSteps: 24, maxRepairs: 2, plan: true, planFirst: true },
  repair: { label: 'Repair', note: 'Inspect logs, find bugs, patch, then verify.', maxSteps: 16, maxRepairs: 3, plan: true, startAt: 'verify' },
};
const STEP_STATUS = new Set(['running', 'completed', 'failed', 'cancelled', 'waiting']);
const RUN_STATUS = new Set(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']);
export const MAX_STEPS = 400; const MAX_TEXT = 4000;

export interface RunStore { save(run: any): Promise<void>; load(id: string): Promise<any | null>; list(project: string): Promise<any[]>; }

const clip = (v: unknown, n = MAX_TEXT) => { const s = typeof v === 'string' ? v : v == null ? '' : (() => { try { return JSON.stringify(v); } catch { return String(v); } })(); return s.length > n ? s.slice(0, n) + '\n[cut: ' + (s.length - n) + ' more characters]' : s; };

// Never let a secret reach a stored run or a screen: known shapes, plus the exact values this project saved.
const SECRET = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|tlm_sk_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,})/gi;
let known: string[] = [];
export const setKnownSecrets = (values: string[]) => { known = (values || []).filter(v => v && v.length >= 8); };
export function scrub(s: unknown): string {
  let t = String(s ?? ''); for (const v of known) if (t.includes(v)) t = t.split(v).join('[hidden]');
  const keep: string[] = []; t = t.replace(/\{\{secret:[A-Z0-9_]+\}\}/g, m => { keep.push(m); return '\u0001' + (keep.length - 1) + '\u0002'; });   // a reference is not a secret
  t = t.replace(SECRET, '[hidden]'); return t.replace(/\u0001(\d+)\u0002/g, (_, i) => keep[+i]);
}
const safe = (v: unknown) => scrub(clip(v));
const rid = () => { const b = new Uint8Array(3); crypto.getRandomValues(b); return 'r' + Date.now().toString(36) + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); };

export function create({ project, prompt, mode, model, files }: { project: string; prompt: string; mode?: string; model?: string; files?: unknown[] }) {
  const m = MODES[mode || ''] ? mode! : 'build';
  return {
    id: rid(), project: String(project || '').slice(0, 60), prompt: safe(prompt).slice(0, 4000), mode: m, model: String(model || '').slice(0, 80),
    attachments: Array.isArray(files) ? files.slice(0, 10).map(x => String(x).slice(0, 100)) : [],
    status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), finishedAt: null as number | null,
    stage: 'understand', stages: STAGES.map(s => ({ id: s, status: 'pending', startedAt: null as number | null, endedAt: null as number | null, note: '' })),
    plan: [] as any[], steps: [] as any[], checkpoint: null as string | null, files: {} as Record<string, any>, verify: { builds: [] as any[], tests: [] as any[], problems: [] as any[] }, repairs: 0, report: null as any, error: null as string | null, notice: undefined as string | undefined,
  };
}
export type Run = ReturnType<typeof create>;

export function setStage(run: Run, id: string, status: string, note?: string) {
  if (!STAGES.includes(id)) throw new Error('unknown stage');
  const s = run.stages.find(x => x.id === id)!, now = Date.now();
  if (status === 'running' && !s.startedAt) s.startedAt = now;
  if ((status === 'completed' || status === 'failed' || status === 'skipped') && !s.endedAt) s.endedAt = now;
  s.status = status; if (note != null) s.note = safe(note).slice(0, 300);
  if (status === 'running') run.stage = id; run.updatedAt = now; return run;
}
export function setPlan(run: Run, tasks: any[]) {
  run.plan = (Array.isArray(tasks) ? tasks : []).slice(0, 30).map((t, i) => ({ id: 't' + (i + 1), title: scrub(String(t?.title || t || '')).slice(0, 200), dependsOn: (Array.isArray(t?.dependsOn) ? t.dependsOn : []).filter((d: string) => /^t\d+$/.test(d)).slice(0, 8), status: 'pending' })).filter(t => t.title);
  run.updatedAt = Date.now(); return run;
}
export function editPlan(run: Run, tasks: any[]) {
  if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') throw new Error('this run has finished, so its plan cannot change');
  const done = new Map(run.plan.map(t => [t.title, t.status])); setPlan(run, tasks); for (const t of run.plan) if (done.get(t.title) === 'done') t.status = 'done'; return run;
}
export function markTask(run: Run, id: string, status: string) { const t = run.plan.find(x => x.id === id); if (t) t.status = status; run.updatedAt = Date.now(); return run; }
export function openStep(run: Run, { kind, title, tool, input, files }: { kind?: string; title: string; tool?: string; input?: unknown; files?: string[] }) {
  if (run.steps.length >= MAX_STEPS) throw new Error('this run reached the step limit (' + MAX_STEPS + ')');
  const st = { id: 's' + (run.steps.length + 1), stage: run.stage, kind: String(kind || 'tool').slice(0, 20), title: scrub(title).slice(0, 160), tool: String(tool || '').slice(0, 60), input: safe(input), output: '', status: 'running', startedAt: Date.now(), endedAt: null as number | null, ms: null as number | null, files: (files || []).map(x => String(x).slice(0, 120)).slice(0, 10), error: null as string | null };
  run.steps.push(st); run.updatedAt = st.startedAt; return st;
}
export function closeStep(run: Run, step: any, { ok, output, error, files, status }: { ok?: boolean; output?: unknown; error?: string; files?: string[]; status?: string }) {
  const st = typeof step === 'string' ? run.steps.find(x => x.id === step) : step; if (!st) throw new Error('no such step');
  const now = Date.now(); st.endedAt = now; st.ms = now - st.startedAt; st.status = status && STEP_STATUS.has(status) ? status : ok === false ? 'failed' : 'completed';
  st.output = safe(output); if (error) st.error = safe(error).slice(0, 600);
  if (Array.isArray(files)) st.files = [...new Set([...st.files, ...files.map(x => String(x).slice(0, 120))])].slice(0, 10); run.updatedAt = now; return st;
}
export function addBuild(run: Run, r: any) { run.verify.builds.push({ at: Date.now(), cmd: String(r.cmd || '').slice(0, 200), code: r.code == null ? null : r.code, ok: !!r.ok, ms: r.ms || 0, output: safe(r.output) }); run.verify.builds = run.verify.builds.slice(-10); return run; }
export function addTest(run: Run, r: any) { run.verify.tests.push({ at: Date.now(), cmd: String(r.cmd || '').slice(0, 200), ok: !!r.ok, passed: r.passed ?? null, failed: r.failed ?? null, ms: r.ms || 0, output: safe(r.output) }); run.verify.tests = run.verify.tests.slice(-10); return run; }
export function setProblems(run: Run, list: any[]) { run.verify.problems = (list || []).slice(0, 100).map(p => ({ file: String(p.file || '').slice(0, 120), line: p.line == null ? null : +p.line || null, severity: p.severity === 'warning' ? 'warning' : 'error', message: scrub(p.message).slice(0, 300) })); return run; }
export function noteFiles(run: Run, changes: any[]) { for (const c of changes || []) run.files[String(c.file).slice(0, 120)] = { status: c.status, added: c.added || 0, removed: c.removed || 0 }; return run; }
export function finish(run: Run, status: string, report: any, error?: string | null) {
  if (!RUN_STATUS.has(status)) throw new Error('bad status');
  const now = Date.now(); run.status = status; run.finishedAt = now; run.updatedAt = now;
  for (const st of run.steps) if (st.status === 'running') { st.status = status === 'cancelled' ? 'cancelled' : 'failed'; st.endedAt = now; st.ms = now - st.startedAt; if (!st.error) st.error = 'stopped before it finished'; }
  if (report) run.report = report; if (error) run.error = safe(error).slice(0, 600); return run;
}
// The report is built from the record itself, so it can only say what really happened.
export function buildReport(run: Run) {
  const files = Object.entries(run.files).map(([file, v]) => ({ file, ...v })), failedSteps = run.steps.filter(s => s.status === 'failed');
  const lastBuild = run.verify.builds[run.verify.builds.length - 1], lastTest = run.verify.tests[run.verify.tests.length - 1], errors = run.verify.problems.filter(p => p.severity === 'error');
  const unresolved = [...errors.slice(0, 10).map(p => `${p.file}${p.line ? ':' + p.line : ''} ${p.message}`), ...(lastBuild && !lastBuild.ok ? ['The last build failed (exit ' + lastBuild.code + ').'] : []), ...(lastTest && !lastTest.ok ? ['The last test run failed.'] : [])];
  return { changed: files.length, files, steps: { total: run.steps.length, failed: failedSteps.length }, verified: { build: lastBuild ? (lastBuild.ok ? 'passed' : 'failed') : 'not run', tests: lastTest ? (lastTest.ok ? 'passed' : 'failed') : 'not run', problems: errors.length }, repairs: run.repairs, unresolved };
}
export const summary = (r: any) => ({ id: r.id, project: r.project, prompt: String(r.prompt).slice(0, 140), mode: r.mode, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, steps: (r.steps || []).length, changed: Object.keys(r.files || {}).length });
