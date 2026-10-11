// Website Studio engine: the same seven stages as the PC Studio (understand, inspect, plan, execute, verify, repair, report).
// Everything outside this file is injected: the AI (callModel), tool parsing, tools, saving. So the whole loop is tested offline with a scripted AI.
// Honest by construction: verification is real text checks (never the model), a "completed" run needs evidence, and a fix that makes things worse is undone.
import * as R from './siteStudioRun.ts';
import { type Ctx, check, createProject, deleteFile, editLines, patchFile, projName, readFile, readNumbered, writeFile, fileName } from './siteStudioCore.ts';

// ---------- line diff (port of the PC one) ----------
export function diffLines(a: string, b: string) {
  const A = a.split('\n'), B = b.split('\n');
  if (A.length * B.length > 4e6) return { added: B.length, removed: A.length, hunks: [{ type: 'too-big' }] as any[] };
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops: [string, string, number | null, number | null][] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { ops.push([' ', A[i], i + 1, j + 1]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i], i + 1, null]); i++; } else { ops.push(['+', B[j], null, j + 1]); j++; } }
  while (i < n) { ops.push(['-', A[i], i + 1, null]); i++; } while (j < m) { ops.push(['+', B[j], null, j + 1]); j++; }
  let added = 0, removed = 0; for (const o of ops) { if (o[0] === '+') added++; else if (o[0] === '-') removed++; }
  const keep = new Array(ops.length).fill(false); ops.forEach((o, k) => { if (o[0] !== ' ') for (let x = Math.max(0, k - 2); x <= Math.min(ops.length - 1, k + 2); x++) keep[x] = true; });
  const hunks: any[] = []; let cur: any = null;
  ops.forEach((o, k) => { if (!keep[k]) { cur = null; return; } if (!cur) { cur = { oldStart: o[2] || 0, newStart: o[3] || 0, lines: [] }; hunks.push(cur); } cur.lines.push({ t: o[0], s: o[1].slice(0, 300) }); });
  return { added, removed, hunks: hunks.slice(0, 60) };
}
export function compareFiles(before: Record<string, string>, after: Record<string, string>) {
  const out: any[] = [];
  for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = before[name], b = after[name];
    if (a === undefined) out.push({ file: name, status: 'added', ...diffLines('', String(b)) }); else if (b === undefined) out.push({ file: name, status: 'removed', ...diffLines(String(a), '') }); else if (a !== b) out.push({ file: name, status: 'changed', ...diffLines(String(a), String(b)) });
  }
  return out;
}

// ---------- problems / build / search (pure text, so they run in the cloud) ----------
export async function problems(c: Ctx, p: string) {
  const files = await c.store.allFiles(p), out: any[] = [];
  for (const [name, text] of Object.entries(files)) {
    if (/\.m?js$/i.test(name)) { try { new Function(text); } catch (e) { const m = String((e as Error).message); if (!/import|export|await|module/.test(m)) out.push({ file: name, line: null, severity: 'error', message: m.slice(0, 300), source: 'parse' }); } }
    if (/\.json$/i.test(name)) { try { JSON.parse(text); } catch (e) { out.push({ file: name, line: null, severity: 'error', message: 'Invalid JSON: ' + String((e as Error).message).slice(0, 200), source: 'parse' }); } }
  }
  const seen = new Set(out.map(x => x.file + '|' + x.message));
  for (const msg of await check(c, p)) {
    if (/^script error/.test(msg.split(': ').slice(1).join(': ')) ) continue;   // already reported above as a parse problem
    const file = Object.keys(files).find(n => msg.startsWith(n + ':') || msg.startsWith(n + ' ')) || ''; const key = file + '|' + msg; if (seen.has(key)) continue; seen.add(key);
    out.push({ file, line: null, severity: /is used more than once/.test(msg) ? 'warning' : 'error', message: msg.slice(0, 300), source: 'check' });
  }
  return out.slice(0, 100);
}
export async function build(c: Ctx, p: string) {
  const t0 = Date.now(), list = await problems(c, p), errors = list.filter(x => x.severity === 'error'), names = Object.keys(await c.store.allFiles(p));
  const out = [`Checked ${names.length} file(s): ${names.join(', ').slice(0, 300) || '(none)'}`, errors.length ? `${errors.length} error(s), ${list.length - errors.length} warning(s).` : `No errors${list.length ? ', ' + list.length + ' warning(s)' : ''}.`, ...list.slice(0, 20).map(x => `${x.severity}: ${x.file}${x.line ? ':' + x.line : ''} ${x.message}`)];
  return { ok: errors.length === 0, cmd: 'studio build check (static)', code: errors.length ? 1 : 0, ms: Date.now() - t0, output: out.join('\n'), problems: list, note: 'Website Studio projects are static web files, so the build is a real parse and link check, not a bundler.' };
}
// The cloud has no process to run a test file in. It says so plainly instead of pretending.
export const tests = (_p?: string) => ({ available: false, ok: null as boolean | null, cmd: '', output: 'Tests run in the PC Studio. The website Studio checks your files (scripts, JSON, links, ids) instead.', passed: null, failed: null, ms: 0 });
export async function search(c: Ctx, p: string, q: string, limit = 60) {
  const needle = String(q || '').trim().toLowerCase(); if (!needle) return []; const max = Math.max(1, Math.min(100, +limit || 60)), hits: any[] = [];
  for (const [file, text] of Object.entries(await c.store.allFiles(p))) { const lines = text.split(/\r?\n/); for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(needle)) { hits.push({ file, line: i + 1, text: lines[i].trim().slice(0, 220) }); if (hits.length >= max) return hits; } }
  return hits;
}

// ---------- checkpoints ----------
export interface CheckpointStore { save(p: string, label: string, files: Record<string, string>): Promise<string>; load(p: string, id: string): Promise<{ label: string; files: Record<string, string> } | null>; list(p: string): Promise<{ id: string; label: string; createdAt: number }[]>; }
export async function runDiff(c: Ctx, cps: CheckpointStore, run: R.Run) {
  if (!run.checkpoint) return { available: false, changes: [] as any[], note: 'No checkpoint was saved for this run, so there is nothing to compare with.' };
  const cp = await cps.load(run.project, run.checkpoint); if (!cp) return { available: false, changes: [] as any[], note: 'The checkpoint is gone.' };
  return { available: true, changes: compareFiles(cp.files, await c.store.allFiles(run.project)) };
}
export async function revertRun(c: Ctx, cps: CheckpointStore, run: R.Run) {
  if (!run.checkpoint) throw new Error('This run has no checkpoint to go back to.'); const cp = await cps.load(run.project, run.checkpoint); if (!cp) throw new Error('The checkpoint is gone.');
  await cps.save(run.project, 'Before restoring "' + cp.label + '"', await c.store.allFiles(run.project));   // so the revert can be undone too
  await c.store.replaceFiles(run.project, cp.files); return { ok: true, files: Object.keys(cp.files).length };
}
export async function revertFile(c: Ctx, cps: CheckpointStore, run: R.Run, file: string) {
  if (!run.checkpoint) throw new Error('This run has no checkpoint.'); const cp = await cps.load(run.project, run.checkpoint); if (!cp) throw new Error('The checkpoint is gone.'); const name = fileName(file);
  await cps.save(run.project, 'Before reverting ' + name, await c.store.allFiles(run.project));
  if (Object.prototype.hasOwnProperty.call(cp.files, name)) { await c.store.putFile(run.project, name, String(cp.files[name])); return { ok: true, text: 'Put back ' + name }; }
  await c.store.delFile(run.project, name); return { ok: true, text: 'Removed ' + name + ' (it did not exist before this run)' };
}

// ---------- tools the AI may use (a fixed list; the project is forced to be THIS one) ----------
export const EDIT_TOOLS = new Set(['studio_write', 'studio_patch', 'studio_lines', 'studio_delete']);
export const READ_TOOLS = new Set(['studio_files', 'studio_read', 'studio_read_numbered', 'studio_check', 'studio_diagnose', 'studio_search']);
export const TOOL_DOCS: Record<string, string> = {
  studio_files: 'List the files in the project. args: {}',
  studio_read: 'Read one file. args: {"file": string}',
  studio_read_numbered: 'Read a file with line numbers, to edit it by line. args: {"file": string}',
  studio_write: 'Create or replace a whole file (use for new files). args: {"file": string, "content": string}',
  studio_patch: 'Change a spot in an existing file (preferred for edits). Spacing differences are forgiven. args: {"file": string, "find": string, "replace": string, "all": boolean}',
  studio_lines: 'Edit by line number. args: {"file": string, "from": number, "to": number, "text": string}',
  studio_delete: 'Delete one file. args: {"file": string}',
  studio_check: 'Check the project for broken links, duplicate ids and script errors. args: {}',
  studio_search: 'Search every file for some text. args: {"query": string}',
  studio_db_status: 'See whether the Pholama Database is on, its tables, size and rules. args: {}',
  studio_db_enable: 'Turn the Pholama Database ON for this project (free, under 0.01 GB, built-in accounts). Only when the app really needs accounts or saved data. args: {}',
  studio_db_create_table: 'Create a table. Column types: text, number, boolean, date. args: {"name": string, "columns": [{"name": string, "type": string}]}',
  studio_db_insert: 'Add a row. args: {"table": string, "row": object}',
  studio_db_select: 'Read rows. args: {"table": string, "where": object, "limit": number}',
};
export interface ToolDeps { c: Ctx; extra?: Record<string, (a: any) => Promise<string> | string> }
export function makeTools({ c, extra = {} }: ToolDeps) {
  const T: Record<string, (p: string, a: any) => Promise<string> | string> = {
    studio_files: async p => (await c.store.listFiles(p)).map(f => `${f.name} (${f.size} bytes)`).join('\n') || '(empty)',
    studio_read: (p, a) => readFile(c, p, a.file), studio_read_numbered: (p, a) => readNumbered(c, p, a.file),
    studio_write: async (p, a) => { const r = await writeFile(c, p, a.file, a.content); return (r.created ? 'Created ' : 'Saved ') + r.name + ' (' + r.size + ' bytes)'; },
    studio_patch: (p, a) => patchFile(c, p, a.file, a.find, a.replace, !!a.all), studio_lines: (p, a) => editLines(c, p, a.file, a.from, a.to, a.text), studio_delete: (p, a) => deleteFile(c, p, a.file),
    studio_check: async p => { const l = await check(c, p); return l.length ? l.join('\n') : 'No problems found.'; },
    studio_diagnose: async p => { const names = (await c.store.listFiles(p)).map(f => f.name), pr = await problems(c, p); return names.length + ' file(s): ' + names.join(', ') + '\n' + (pr.length ? pr.map(x => x.severity + ': ' + x.file + ' ' + x.message).join('\n') : 'No problems found.'); },
    studio_search: async (p, a) => (await search(c, p, a.query, 30)).map(h => `${h.file}:${h.line} ${h.text}`).join('\n') || 'No matches.',
  };
  for (const [name, fn] of Object.entries(extra)) T[name] = (_p, a) => fn(a);
  return { has: (n: string) => Object.prototype.hasOwnProperty.call(T, n), names: () => Object.keys(T), run: async (n: string, p: string, a: any) => { if (!Object.prototype.hasOwnProperty.call(T, n)) throw new Error('unknown tool ' + n); try { return String(await T[n](p, a || {})); } catch (e) { return 'Tool error: ' + ((e as Error)?.message || e); } } };
}

// A small tolerant parser for the tool-call formats the free models actually produce.
export function parseTool(text: string, names?: string[]): { name: string; args: any } | null {
  const t = String(text || ''); const okName = (n: string) => !names || names.includes(n);
  const tryJson = (raw: string) => { try { return JSON.parse(raw); } catch { try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch { return null; } } };
  const fn = /<function\s*=\s*([a-z_][a-z0-9_]*)>\s*([\s\S]*?)(?:<\/function>|$)/i.exec(t);
  if (fn && okName(fn[1])) { const a = tryJson(fn[2].trim()); if (a && typeof a === 'object' && !Array.isArray(a)) return { name: fn[1], args: a }; }
  const m = /<tool(?:_call)?>([\s\S]*?)(?:<\/tool(?:_call)?>|$)/i.exec(t) || /```(?:json)?\s*(\{[\s\S]*?"name"[\s\S]*?\})\s*```/.exec(t);
  if (!m) return null; const j = tryJson(m[1].trim()); if (!j || typeof j.name !== 'string' || !okName(j.name)) return null;
  let a = j.args ?? j.arguments ?? {}; if (typeof a === 'string') a = tryJson(a) || {}; if (typeof a !== 'object' || Array.isArray(a)) return null; return { name: j.name, args: a };
}
const titleFor = (tool: string, a: any) => { const f = a?.file ? ' ' + a.file : ''; return ({ studio_files: 'Listing the files', studio_read: 'Reading' + f, studio_read_numbered: 'Reading' + f + ' with line numbers', studio_check: 'Checking the project', studio_diagnose: 'Diagnosing the project', studio_patch: 'Applying a patch to' + f, studio_lines: 'Editing lines in' + f, studio_write: 'Writing' + f, studio_delete: 'Deleting' + f, studio_search: 'Searching for "' + String(a?.query || '').slice(0, 40) + '"' } as Record<string, string>)[tool] || ('Running ' + tool); };
const kindFor = (tool: string) => EDIT_TOOLS.has(tool) ? 'edit' : READ_TOOLS.has(tool) ? 'read' : 'tool';
const clip = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s;

// ---------- running one request ----------
export interface EngineDeps {
  c: Ctx; checkpoints: CheckpointStore; runs: { save(run: R.Run): Promise<void> };
  callModel(msgs: { role: string; content: string }[], o?: { signal?: AbortSignal }): Promise<string>;
  tools: ReturnType<typeof makeTools>; notes?: () => Promise<string> | string;
  cancelled?: () => Promise<boolean> | boolean;      // checked between steps (a function can be asked to stop)
  deadline?: number;                                  // ms epoch: stop cleanly before the host kills the function
}
// A run is advanced in short slices so each one finishes inside a single request. Everything needed to continue lives on the run itself
// (run.cursor), so a slice can end anywhere and the next call picks up exactly where it stopped.
type Cursor = { phase: 'start' | 'plan' | 'execute' | 'verify' | 'repair' | 'report' | 'done'; digest: string; msgs: { role: string; content: string }[]; steps: number; finishedByModel: boolean; repairNo: number; errorsBefore: number; backup: Record<string, string> | null; fixSteps: number };
const blank = (): Cursor => ({ phase: 'start', digest: '', msgs: [], steps: 0, finishedByModel: false, repairNo: 0, errorsBefore: 0, backup: null, fixSteps: 0 });
export const isDone = (r: R.Run) => ['completed', 'failed', 'cancelled'].includes(r.status);

export async function execute(run: R.Run, d: EngineDeps): Promise<R.Run> {
  // Runs to the end in one go (used by tests and by short runs). The website calls advance() in slices.
  for (let i = 0; i < 400 && !isDone(run); i++) await advance(run, d);
  return run;
}

export async function advance(run: R.Run, d: EngineDeps): Promise<R.Run> {
  if (isDone(run)) return run;
  const mode = R.MODES[run.mode] || R.MODES.build, { c, tools } = d;
  const cur: Cursor = (run as any).cursor || ((run as any).cursor = blank());
  const persist = () => d.runs.save(run);
  const secretsClean = (t: string) => c.secrets.scrub(run.project, t);
  const callModel = async (msgs: { role: string; content: string }[], o?: { signal?: AbortSignal }) => d.callModel(await Promise.all(msgs.map(async m => ({ ...m, content: await secretsClean(m.content) }))), o);   // the model only ever sees {{secret:NAME}}
  const runTool = async (n: string, p: string, a: any) => secretsClean(await tools.run(n, p, a));
  const cancelled = async () => !!(await d.cancelled?.());
  const outOfTime = () => !!d.deadline && Date.now() > d.deadline;     // a slice ends here and the NEXT call continues; the run is not cancelled
  R.setKnownSecrets(Object.values(await c.secrets.values(run.project)));
  const finishWith = async (status: string, error?: string | null) => {
    const rep = R.buildReport(run);
    if (status === 'completed' && (rep.verified.build === 'failed' || rep.verified.tests === 'failed' || rep.verified.problems > 0)) { status = 'failed'; error = error || 'The work finished, but verification still reports problems.'; }   // honesty gate
    R.finish(run, status, rep, error); for (const s of run.stages) if (s.status === 'running') R.setStage(run, s.id, status === 'cancelled' ? 'skipped' : 'failed'); cur.phase = 'done'; cur.msgs = []; cur.backup = null; await persist(); return run;
  };
  const snapshot = () => c.store.allFiles(run.project);
  const change = async () => { try { return (await runDiff(c, d.checkpoints, run)).changes; } catch { return []; } };
  const names = tools.names();
  const verify = async () => {
    const b = R.openStep(run, { kind: 'verify', title: 'Running the build check', tool: 'studio.build', input: { project: run.project } }); await persist();
    const br = await build(c, run.project); R.addBuild(run, br); R.setProblems(run, br.problems); R.closeStep(run, b, { ok: br.ok, output: br.output, error: br.ok ? null : 'Build check found errors' } as any);
    const t = R.openStep(run, { kind: 'verify', title: 'Running tests', tool: 'studio.tests', input: { project: run.project } }); const tr = tests(run.project); R.closeStep(run, t, { ok: true, output: tr.output, status: 'completed' }); await persist(); return br;
  };
  try {
    if (await cancelled()) return finishWith('cancelled');
    if (run.status === 'queued' || cur.phase === 'start') run.status = 'running';

    // ---------------- start: understand + checkpoint + inspect ----------------
    if (cur.phase === 'start') {
      R.setStage(run, 'understand', 'running'); await persist();
      if (!run.project) { R.setStage(run, 'understand', 'failed', 'Pick a project first.'); return finishWith('failed', 'Pick a project first.'); }
      try { projName(run.project); if (!(await c.store.hasProject(run.project))) throw new Error('There is no project named "' + run.project + '".'); } catch (e) { R.setStage(run, 'understand', 'failed', (e as Error).message); return finishWith('failed', (e as Error).message); }
      R.setStage(run, 'understand', 'completed', 'Target project: ' + run.project + '. Mode: ' + mode.label + '.'); await persist();
      try { run.checkpoint = await d.checkpoints.save(run.project, 'Before run: ' + clip(run.prompt, 60), await snapshot()); } catch { run.checkpoint = null; }   // recoverable BEFORE any change
      R.setStage(run, 'inspect', 'running'); await persist();
      for (const [tool, args] of [['studio_files', {}], ['studio_diagnose', {}]] as [string, any][]) {
        const st = R.openStep(run, { kind: 'read', title: titleFor(tool, args), tool, input: args }); await persist();
        try { const out = await runTool(tool, run.project, args); R.closeStep(run, st, { ok: true, output: out }); cur.digest += '\n## ' + tool + '\n' + out.slice(0, 2500); } catch (e) { R.closeStep(run, st, { ok: false, error: 'Could not read that.', output: 'Could not read that.' }); }
      }
      R.setStage(run, 'inspect', 'completed', 'Read the project files and its diagnostics.'); cur.phase = 'plan'; await persist(); return run;
    }

    // ---------------- plan ----------------
    if (cur.phase === 'plan') {
      R.setStage(run, 'plan', 'running'); await persist();
      if (mode.plan) {
        const st = R.openStep(run, { kind: 'model', title: 'Planning the changes', tool: 'model.plan', input: run.prompt }); await persist(); let text = '';
        try { text = await callModel([{ role: 'system', content: 'You plan work on a small web project. Reply with ONLY a JSON array of 2 to 8 short task titles, for example ["Fix the broken script link","Improve the dashboard layout"]. No other text.' }, { role: 'user', content: 'Request: ' + run.prompt + '\nProject facts:' + cur.digest }]); }
        catch { R.closeStep(run, st, { ok: false, error: 'The AI could not answer. Try again in a moment.' }); await persist(); return finishWith('failed', 'The AI could not plan this. Try again in a moment.'); }
        let tasks: any[] = []; try { const m = /\[[\s\S]*\]/.exec(text); tasks = JSON.parse(m ? m[0] : text); } catch { /* falls back below */ }
        tasks = (Array.isArray(tasks) ? tasks : []).map(t => typeof t === 'string' ? { title: t } : t).filter(t => t && t.title);
        const fallback = !tasks.length; if (fallback) tasks = [{ title: clip(run.prompt, 120) }];
        R.setPlan(run, tasks.map((t, i) => ({ title: t.title, dependsOn: i ? ['t' + i] : [] })));
        R.closeStep(run, st, { ok: true, output: fallback ? 'The model did not return a readable plan, so the request itself is the single task.' : run.plan.map(t => t.id + ' ' + t.title).join('\n') });
      } else R.setPlan(run, [{ title: clip(run.prompt, 120) }]);
      R.setStage(run, 'plan', 'completed', run.plan.length + ' task(s).');
      const system = 'You are Pholama Studio, editing the project "' + run.project + '". Tools: ' + names.map(n => n + ' ' + (TOOL_DOCS[n] || '')).join(' | ') + '\nCall ONE tool at a time as <tool_call>{"name":"studio_patch","arguments":{"file":"index.html","find":"...","replace":"..."}}</tool_call>. Read a file before you edit it. When every task is done, reply in plain words with no tool call.\n' + ((await d.notes?.()) || '') + '\nTasks:\n' + run.plan.map(t => '- ' + t.id + ' ' + t.title).join('\n');
      cur.msgs = [{ role: 'system', content: system }, { role: 'user', content: run.prompt + '\n\nProject facts:' + cur.digest }]; cur.phase = 'execute';
      R.setStage(run, 'execute', 'running'); await persist(); return run;
    }

    // ---------------- execute: a few tool calls per slice ----------------
    if (cur.phase === 'execute') {
      while (cur.steps < mode.maxSteps) {
        if (await cancelled()) return finishWith('cancelled'); if (outOfTime()) { await persist(); return run; }
        let reply: string; try { reply = await callModel(cur.msgs); } catch { return finishWith('failed', 'The AI stopped answering. Try again in a moment.'); }
        const call = parseTool(reply, names); if (!call) { cur.finishedByModel = true; cur.msgs.push({ role: 'assistant', content: reply }); break; }
        cur.steps++; const args = Object.assign({}, call.args || {});
        const st = R.openStep(run, { kind: kindFor(call.name), title: titleFor(call.name, args), tool: call.name, input: args, files: args.file ? [String(args.file)] : [] }); await persist();
        let out: string, ok = true; try { out = await runTool(call.name, run.project, args); if (/^(Tool error|error|could not|no such|not found|nothing)/i.test(out) || /did not save it/i.test(out)) ok = false; } catch (e) { out = (e as Error).message; ok = false; }
        R.closeStep(run, st, { ok, output: out, error: ok ? null : out } as any);
        cur.msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: '[' + call.name + (ok ? ' ok' : ' failed') + ']\n' + out.slice(0, 2000) + '\n[end]' }); await persist();
      }
      const ch = await change(); R.noteFiles(run, ch.map(x => ({ file: x.file, status: x.status, added: x.added, removed: x.removed }))); for (const t of run.plan) R.markTask(run, t.id, ch.length ? 'done' : 'pending');
      R.setStage(run, 'execute', ch.length ? 'completed' : 'failed', ch.length ? ch.length + ' file(s) changed.' : (cur.finishedByModel ? 'The model finished without changing any file.' : 'Reached the step limit without changing a file.'));
      R.setStage(run, 'verify', 'running'); cur.phase = 'verify'; await persist(); return run;
    }

    // ---------------- verify: real checks, never the model ----------------
    if (cur.phase === 'verify') {
      const v = await verify();
      R.setStage(run, 'verify', v.ok ? 'completed' : 'failed', v.ok ? 'Build check passed.' : v.problems.filter((p: any) => p.severity === 'error').length + ' error(s) found.');
      if (!v.ok && cur.repairNo < mode.maxRepairs) { cur.phase = 'repair'; cur.fixSteps = 0; cur.backup = null; } else cur.phase = 'report';
      await persist(); return run;
    }

    // ---------------- repair: only real errors, a fixed number of tries, rolled back if it makes things worse ----------------
    if (cur.phase === 'repair') {
      if (!cur.backup) {   // begin an attempt
        cur.repairNo++; run.repairs = cur.repairNo; R.setStage(run, 'repair', 'running', 'Attempt ' + cur.repairNo + ' of ' + mode.maxRepairs);
        const last = run.verify.builds[run.verify.builds.length - 1];
        cur.errorsBefore = run.verify.problems.filter(p => p.severity === 'error').length; cur.backup = await snapshot(); cur.fixSteps = 0;
        const st = R.openStep(run, { kind: 'repair', title: 'Investigating errors (attempt ' + cur.repairNo + ')', tool: 'model.repair', input: String(last?.output || '').slice(0, 800) });
        cur.msgs.push({ role: 'user', content: '[verification found real problems]\n' + String(last?.output || '').slice(0, 1500) + '\n[end]\nFix these exact problems with tools. Read the file first.' }); R.closeStep(run, st, { ok: true, output: 'Sent the real error output to the model.' }); await persist(); return run;
      }
      let more = true;
      while (cur.fixSteps < Math.min(6, mode.maxSteps)) {
        if (await cancelled()) return finishWith('cancelled'); if (outOfTime()) { await persist(); return run; }
        let reply: string; try { reply = await callModel(cur.msgs); } catch { more = false; break; } const call = parseTool(reply, names); if (!call) { cur.msgs.push({ role: 'assistant', content: reply }); more = false; break; }
        cur.fixSteps++; const args = Object.assign({}, call.args || {}); const s2 = R.openStep(run, { kind: kindFor(call.name), title: (EDIT_TOOLS.has(call.name) ? 'Fixing: ' : '') + titleFor(call.name, args), tool: call.name, input: args, files: args.file ? [String(args.file)] : [] }); await persist();
        let out: string, ok = true; try { out = await runTool(call.name, run.project, args); if (/^(Tool error|error|could not|no such|not found)/i.test(out) || /did not save it/i.test(out)) ok = false; } catch (e) { out = (e as Error).message; ok = false; }
        R.closeStep(run, s2, { ok, output: out, error: ok ? null : out } as any); cur.msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: '[' + call.name + (ok ? ' ok' : ' failed') + ']\n' + out.slice(0, 1500) + '\n[end]' }); await persist();
      }
      void more;
      let v = await verify(); const errorsAfter = v.problems.filter((p: any) => p.severity === 'error').length;
      if (errorsAfter > cur.errorsBefore && cur.backup) {   // worse than before: put it back
        await c.store.replaceFiles(run.project, cur.backup); const rb = R.openStep(run, { kind: 'repair', title: 'Undid a fix that made things worse', tool: 'rollback', input: { attempt: cur.repairNo } }); R.closeStep(run, rb, { ok: true, output: 'Errors went from ' + cur.errorsBefore + ' to ' + errorsAfter + ', so the project was put back.' }); v = await verify();
      }
      cur.backup = null;
      if (!v.ok && cur.repairNo < mode.maxRepairs) { /* another attempt next slice */ } else cur.phase = 'report';
      await persist(); return run;
    }

    // ---------------- report: built from the record, so it cannot claim more than happened ----------------
    if (cur.phase === 'report') {
      const lastOk = run.verify.builds.length ? run.verify.builds[run.verify.builds.length - 1].ok : false;
      if (run.repairs) R.setStage(run, 'repair', lastOk ? 'completed' : 'failed', (lastOk ? 'Fixed after ' : 'Still failing after ') + run.repairs + ' attempt(s).'); else R.setStage(run, 'repair', 'skipped', 'Nothing needed repairing.');
      const ch = await change(); R.noteFiles(run, ch.map(x => ({ file: x.file, status: x.status, added: x.added, removed: x.removed }))); R.setStage(run, 'report', 'running');
      const clean = lastOk && ch.length > 0; R.setStage(run, 'report', 'completed', clean ? 'Verified.' : ch.length ? 'Finished with open problems.' : 'No files were changed.');
      return finishWith(clean ? 'completed' : 'failed', clean ? null : (ch.length ? 'Verification still reports problems.' : 'The run ended without changing any file.'));
    }
    return run;
  } catch { try { return await finishWith((await cancelled()) ? 'cancelled' : 'failed', 'Something went wrong while running this.'); } catch { return run; } }
}
export { createProject };
