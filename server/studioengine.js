// Studio engine: Understand -> Inspect -> Plan -> Execute -> Verify -> Repair -> Report.
// The model is called through `callModel`, tools run through `runTool`. Both are injected so the real adapters are used in
// production and a scripted model in tests. The files, checkpoints, checks and tests are ALWAYS the real ones.
// A task is never marked complete because a model answered: it is complete only when the verification evidence says so.
'use strict';
const runs = require('./studiorun'), ws = require('./studioworkspace'), stu = require('./studio'), hist = require('./studiohistory');

const READ_TOOLS = new Set(['studio_projects', 'studio_files', 'studio_read', 'studio_read_numbered', 'studio_check', 'studio_diagnose', 'studio_map', 'studio_tree', 'studio_outline', 'studio_search']);
const EDIT_TOOLS = new Set(['studio_write', 'studio_patch', 'studio_lines', 'studio_delete']);
const active = new Map();   // runId -> { cancelled, abort }

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const titleFor = (tool, a) => {
  a = a || {}; const f = a.file ? ' "' + clip(a.file, 60) + '"' : '';
  return ({ studio_read: 'Reading' + f, studio_read_numbered: 'Reading' + f, studio_files: 'Inspecting project files', studio_tree: 'Inspecting project files', studio_map: 'Mapping the project', studio_outline: 'Reading outline' + f, studio_search: 'Searching the project',
    studio_check: 'Checking the project', studio_diagnose: 'Diagnosing the project', studio_patch: 'Applying a patch to' + f, studio_lines: 'Editing lines in' + f, studio_write: 'Writing' + f, studio_delete: 'Deleting' + f })[tool] || ('Running ' + tool);
};
const kindFor = tool => EDIT_TOOLS.has(tool) ? 'edit' : READ_TOOLS.has(tool) ? 'read' : 'tool';

function cancel(id) { const a = active.get(id); if (!a) return false; a.cancelled = true; try { a.abort && a.abort.abort(); } catch {} return true; }
const isActive = id => active.has(id);

// Steps the model can take. Reading and planning use the model; verification and checkpoints never do.
async function execute(runId, deps) {
  const { toolNames } = deps;
  const run = runs.load(runId), mode = runs.MODES[run.mode] || runs.MODES.build;
  // Whatever goes to the model or comes back from a tool is checked against this project's saved secrets first, so a value can never be
  // sent on, even if a model repeats one or a tool returns one. The model only ever sees {{secret:NAME}}.
  const sec = (() => { try { return require('./studiosecrets'); } catch { return null; } })();
  const clean = t => { try { return sec ? sec.scrub(run.project || 'default', t) : t; } catch { return t; } };
  const callModel = (msgs, o) => deps.callModel(Array.isArray(msgs) ? msgs.map(m => (m && typeof m.content === 'string') ? Object.assign({}, m, { content: clean(m.content) }) : m) : msgs, o);
  const runTool = async (name, args) => clean(String(await deps.runTool(name, args)));
  const ctl = { cancelled: false, abort: new AbortController() }; active.set(runId, ctl);
  const persist = () => runs.save(run);
  const stopped = () => ctl.cancelled;
  const finishWith = (status, error) => {
    const rep = runs.buildReport(run);
    // Honesty gate: "completed" needs real evidence. A build that failed, or errors that remain, can never be called complete.
    if (status === 'completed' && (rep.verified.build === 'failed' || rep.verified.tests === 'failed' || rep.verified.problems > 0)) status = 'failed', error = error || 'The work finished, but verification still reports problems.';
    runs.finish(run, status, rep, error); for (const s of run.stages) if (s.status === 'running') runs.setStage(run, s.id, status === 'cancelled' ? 'skipped' : 'failed'); persist(); active.delete(runId); return run;
  };
  try {
    run.status = 'running'; persist();

    // ---- 1. Understand ----
    runs.setStage(run, 'understand', 'running'); persist();
    const target = ws.resolveProject(run.project ? run.project : run.prompt);
    if (!run.project) {
      if (target.status === 'found') run.project = target.project;
      else { runs.setStage(run, 'understand', 'failed', target.message); const st = runs.openStep(run, { kind: 'tool', title: 'Finding the project', tool: 'resolve_project', input: run.prompt }); runs.closeStep(run, st, { ok: false, output: target.message + (target.projects.length ? ' Projects: ' + target.projects.join(', ') : ''), status: 'waiting' }); run.status = 'waiting'; run.error = target.message; run.report = null; persist(); active.delete(runId); return run; }
    }
    try { stu.projName(run.project); if (!stu.listProjects().some(p => p.name === run.project)) throw new Error('There is no project named "' + run.project + '".'); }
    catch (e) { runs.setStage(run, 'understand', 'failed', e.message); return finishWith('failed', e.message); }
    runs.setStage(run, 'understand', 'completed', 'Target project: ' + run.project + '. Mode: ' + mode.label + '.'); persist();
    if (stopped()) return finishWith('cancelled');

    // Recoverable checkpoint BEFORE any change.
    try { const cp = hist.save(stu, run.project, 'Before run: ' + clip(run.prompt, 60), { by: 'ai', force: true }); run.checkpoint = cp ? cp.id : null; } catch (e) { run.checkpoint = null; }
    persist();

    // ---- 2. Inspect (real reads of the real project) ----
    runs.setStage(run, 'inspect', 'running'); persist();
    const inspectCalls = [['studio_files', { project: run.project }], ['studio_diagnose', { project: run.project }]];
    let digest = '';
    for (const [tool, args] of inspectCalls) {
      if (stopped()) return finishWith('cancelled');
      const st = runs.openStep(run, { kind: 'read', title: titleFor(tool, args), tool, input: args }); persist();
      try { const out = String(await runTool(tool, args)); runs.closeStep(run, st, { ok: true, output: out }); digest += '\n## ' + tool + '\n' + out.slice(0, 2500); }
      catch (e) { runs.closeStep(run, st, { ok: false, error: e.message, output: e.message }); }
      persist();
    }
    runs.setStage(run, 'inspect', 'completed', 'Read the project tree and its diagnostics.'); persist();

    // ---- 3. Plan ----
    runs.setStage(run, 'plan', 'running'); persist();
    if (mode.plan) {
      const st = runs.openStep(run, { kind: 'model', title: 'Planning the changes', tool: 'model.plan', input: run.prompt }); persist();
      let text = '';
      try { text = await callModel([{ role: 'system', content: 'You plan work on a small web project. Reply with ONLY a JSON array of 2 to 8 short task titles, for example ["Fix the broken script link","Improve the dashboard layout"]. No other text.' }, { role: 'user', content: 'Request: ' + run.prompt + '\nProject facts:' + digest }], { signal: ctl.abort.signal }); }
      catch (e) { runs.closeStep(run, st, { ok: false, error: e.message }); persist(); if (stopped()) return finishWith('cancelled'); return finishWith('failed', 'The model could not plan: ' + e.message); }
      let tasks = []; try { const m = /\[[\s\S]*\]/.exec(text); tasks = JSON.parse(m ? m[0] : text); } catch {}
      tasks = (Array.isArray(tasks) ? tasks : []).map(t => typeof t === 'string' ? { title: t } : t).filter(t => t && t.title);
      if (!tasks.length) tasks = [{ title: clip(run.prompt, 120) }];   // an unreadable plan falls back to the request itself, and says so
      const fallback = !/\[/.test(text);
      runs.setPlan(run, tasks.map((t, i) => ({ title: t.title, dependsOn: i ? ['t' + i] : [] })));
      runs.closeStep(run, st, { ok: true, output: fallback ? 'The model did not return a readable plan, so the request itself is the single task.' : run.plan.map(t => t.id + ' ' + t.title).join('\n') });
    } else { runs.setPlan(run, [{ title: clip(run.prompt, 120) }]); }
    runs.setStage(run, 'plan', 'completed', run.plan.length + ' task(s).'); persist();
    if (stopped()) return finishWith('cancelled');

    // ---- 4. Execute: a bounded tool loop ----
    runs.setStage(run, 'execute', 'running'); persist();
    const names = toolNames || [];
    const system = 'You are Pholama Studio, editing the project "' + run.project + '". Use tools to make changes: studio_read_numbered, studio_patch, studio_lines, studio_write, studio_check. ' +
      'Call ONE tool at a time as <tool_call>{"name":"studio_patch","arguments":{"project":"' + run.project + '","file":"index.html","find":"...","replace":"..."}}</tool_call>. ' +
      'Read a file before you edit it. When every task is done, reply in plain words with no tool call.\n' + (() => { try { return require('./studioservices').notes(run.project); } catch { return ''; } })() + '\nTasks:\n' + run.plan.map(t => '- ' + t.id + ' ' + t.title).join('\n');
    const msgs = [{ role: 'system', content: system }, { role: 'user', content: run.prompt + '\n\nProject facts:' + digest }];
    let steps = 0, finishedByModel = false;
    while (steps < mode.maxSteps) {
      if (stopped()) return finishWith('cancelled');
      let reply; try { reply = await callModel(msgs, { signal: ctl.abort.signal }); } catch (e) { if (stopped()) return finishWith('cancelled'); return finishWith('failed', 'The model stopped answering: ' + e.message); }
      const call = deps.parseTool(reply, names);
      if (!call) { finishedByModel = true; msgs.push({ role: 'assistant', content: reply }); break; }
      steps++;
      const args = Object.assign({}, call.args || {}); if (/^studio_/.test(call.name) && call.name !== 'studio_projects') args.project = run.project;   // the model can only touch THIS project
      const st = runs.openStep(run, { kind: kindFor(call.name), title: titleFor(call.name, args), tool: call.name, input: args, files: args.file ? [args.file] : [] }); persist();
      let out, ok = true;
      try { out = String(await runTool(call.name, args)); if (/^(Tool error|error|could not|no such|not found|nothing)/i.test(out) || /did not save it/i.test(out)) ok = false; }
      catch (e) { out = e.message; ok = false; }
      const waiting = /waiting for the user to click Allow|NOT run/i.test(out);
      if (waiting) { runs.waitStep(run, st, out); persist(); }
      else runs.closeStep(run, st, { ok, output: out, error: ok ? null : out });
      persist();
      msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: '[' + call.name + (ok ? ' ok' : ' failed') + ']\n' + out.slice(0, 2000) + '\n[end]' });
      if (waiting) { run.status = 'waiting'; persist(); break; }   // an approval gate is real: stop here and say so
    }
    const change = (() => { try { return ws.runDiff(run).changes; } catch { return []; } })();
    runs.noteFiles(run, change.map(c => ({ file: c.file, status: c.status, added: c.added, removed: c.removed })));
    for (const t of run.plan) runs.markTask(run, t.id, change.length ? 'done' : 'pending');
    if (run.status === 'waiting') { runs.setStage(run, 'execute', 'completed', 'Paused: waiting for your approval.'); persist(); active.delete(runId); return run; }
    runs.setStage(run, 'execute', change.length ? 'completed' : 'failed', change.length ? change.length + ' file(s) changed.' : (finishedByModel ? 'The model finished without changing any file.' : 'Reached the step limit without changing a file.')); persist();

    // ---- 5. Verify (never the model: real checks) ----
    runs.setStage(run, 'verify', 'running'); persist();
    const verify = async () => {
      const b = runs.openStep(run, { kind: 'verify', title: 'Running the build check', tool: 'studio.build', input: { project: run.project } }); persist();
      const br = ws.build(run.project); runs.addBuild(run, br); runs.setProblems(run, br.problems);
      runs.closeStep(run, b, { ok: br.ok, output: br.output, error: br.ok ? null : 'Build check found errors' }); persist();
      const t = runs.openStep(run, { kind: 'verify', title: 'Running tests', tool: 'studio.tests', input: { project: run.project } }); persist();
      const tr = ws.tests(run.project);
      if (!tr.available) { runs.closeStep(run, t, { ok: true, output: tr.output, status: 'completed' }); }
      else { runs.addTest(run, tr); runs.closeStep(run, t, { ok: tr.ok, output: tr.output, error: tr.ok ? null : 'Tests failed' }); }
      persist(); return { build: br, tests: tr };
    };
    let v = await verify();
    runs.setStage(run, 'verify', (v.build.ok && (v.tests.ok !== false)) ? 'completed' : 'failed', v.build.ok ? 'Build check passed.' : v.build.problems.filter(p => p.severity === 'error').length + ' error(s) found.'); persist();

    // ---- 6. Repair: only real errors, a fixed number of tries, and a rollback if it makes things worse ----
    let repairNo = 0;
    while ((!v.build.ok || v.tests.ok === false) && repairNo < mode.maxRepairs && !stopped()) {
      repairNo++; run.repairs = repairNo; runs.setStage(run, 'repair', 'running', 'Attempt ' + repairNo + ' of ' + mode.maxRepairs); persist();
      const errorsBefore = v.build.problems.filter(p => p.severity === 'error').length, failedBefore = v.tests.failed || 0, backup = stu.snapshot(run.project);
      const st = runs.openStep(run, { kind: 'repair', title: 'Investigating errors (attempt ' + repairNo + ')', tool: 'model.repair', input: v.build.output.slice(0, 800) }); persist();
      msgs.push({ role: 'user', content: '[verification found real problems]\n' + v.build.output.slice(0, 1500) + (v.tests.ok === false ? '\n' + v.tests.output.slice(-800) : '') + '\n[end]\nFix these exact problems with tools. Read the file first.' });
      runs.closeStep(run, st, { ok: true, output: 'Sent the real error output to the model.' }); persist();
      let n = 0;
      while (n < Math.min(6, mode.maxSteps) && !stopped()) {
        let reply; try { reply = await callModel(msgs, { signal: ctl.abort.signal }); } catch (e) { break; }
        const call = deps.parseTool(reply, names); if (!call) { msgs.push({ role: 'assistant', content: reply }); break; }
        n++; const args = Object.assign({}, call.args || {}); if (/^studio_/.test(call.name) && call.name !== 'studio_projects') args.project = run.project;
        const s2 = runs.openStep(run, { kind: kindFor(call.name), title: (EDIT_TOOLS.has(call.name) ? 'Fixing: ' : '') + titleFor(call.name, args), tool: call.name, input: args, files: args.file ? [args.file] : [] }); persist();
        let out, ok = true; try { out = String(await runTool(call.name, args)); if (/^(Tool error|error|could not|no such|not found)/i.test(out) || /did not save it/i.test(out)) ok = false; } catch (e) { out = e.message; ok = false; }
        runs.closeStep(run, s2, { ok, output: out, error: ok ? null : out }); persist();
        msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: '[' + call.name + (ok ? ' ok' : ' failed') + ']\n' + out.slice(0, 1500) + '\n[end]' });
      }
      v = await verify();
      const errorsAfter = v.build.problems.filter(p => p.severity === 'error').length;
      if (errorsAfter > errorsBefore || (v.tests.failed || 0) > failedBefore) {   // worse than before: put it back
        for (const f of backup) { try { stu.writeFile(run.project, f.name, f.content); } catch {} }
        const rb = runs.openStep(run, { kind: 'repair', title: 'Undid a fix that made things worse', tool: 'rollback', input: { attempt: repairNo } }); runs.closeStep(run, rb, { ok: true, output: 'Errors went from ' + errorsBefore + ' to ' + errorsAfter + ', so the project was put back.' });
        v = await verify();
      }
      persist();
    }
    if (run.repairs) runs.setStage(run, 'repair', (v.build.ok && v.tests.ok !== false) ? 'completed' : 'failed', (v.build.ok ? 'Fixed after ' : 'Still failing after ') + run.repairs + ' attempt(s).');
    else runs.setStage(run, 'repair', 'skipped', 'Nothing needed repairing.');
    const after = (() => { try { return ws.runDiff(run).changes; } catch { return []; } })();
    runs.noteFiles(run, after.map(c => ({ file: c.file, status: c.status, added: c.added, removed: c.removed }))); persist();

    // ---- 7. Report (built from the record, so it cannot claim more than happened) ----
    runs.setStage(run, 'report', 'running'); persist();
    if (stopped()) return finishWith('cancelled');
    const clean = v.build.ok && v.tests.ok !== false && after.length > 0;
    runs.setStage(run, 'report', 'completed', clean ? 'Verified.' : after.length ? 'Finished with open problems.' : 'No files were changed.');
    return finishWith(clean ? 'completed' : 'failed', clean ? null : (after.length ? 'Verification still reports problems.' : 'The run ended without changing any file.'));
  } catch (e) {
    try { return finishWith(stopped() ? 'cancelled' : 'failed', e.message); } catch { active.delete(runId); throw e; }
  }
}

module.exports = { execute, cancel, isActive, titleFor, kindFor };
