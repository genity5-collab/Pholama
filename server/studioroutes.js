// HTTP routes for the Studio workspace. server.js hands every /api/studio/ws/ request here.
// Local only: the public website may chat with this PC, but it can never start runs, edit files or revert changes by itself.
'use strict';
const runs = require('./studiorun'), eng = require('./studioengine'), ws = require('./studioworkspace'), stu = require('./studio');

const clients = new Map();   // runId -> Set(res)  (live streams)
function emit(id, ev) { for (const res of clients.get(id) || []) { try { res.write('data: ' + JSON.stringify(ev) + '\n\n'); } catch {} } }

// Capabilities are reported from what is really connected, so the screen never advertises something that cannot run.
function capabilities({ models, terminal }) {
  const list = (models || []).map(m => ({ id: m.id || m.name, name: m.name || m.id, tools: m.tools !== false, coding: m.coding !== false, reasoning: !!m.reasoning }));
  return {
    modes: Object.entries(runs.MODES).map(([id, m]) => ({ id, label: m.label, note: m.note, maxSteps: m.maxSteps, maxRepairs: m.maxRepairs })),
    models: list,
    toolCalling: list.some(m => m.tools),
    terminal: { available: !!terminal, note: terminal ? 'Commands need your Allow before they run.' : 'No execution environment is connected on this PC, so the Terminal tab stays empty.' },
    build: { available: true, note: 'Studio projects are static web files. The build is a real parse and link check.' },
    tests: { available: true, note: 'Runs the project\'s own *.test.js files with node --test in a clean copy.' }
  };
}

// deps: { json, body, callModel(model)->fn, runTool, parseTool, models, terminal, github }
async function handle(req, res, u, deps) {
  const p = u.pathname.replace(/^\/api\/studio\/ws\/?/, ''), seg = p.split('/').filter(Boolean).map(decodeURIComponent), { json, body } = deps;
  const guard = () => req.who === 'local';
  if (!guard()) return json(res, 403, { error: 'The Studio workspace can only be used on the PC itself.' });
  try {
    if (!seg.length || seg[0] === 'capabilities') return json(res, 200, capabilities(deps));
    if (seg[0] === 'dashboard' && req.method === 'GET') return json(res, 200, { projects: ws.dashboard() });
    if (seg[0] === 'resolve' && req.method === 'POST') { const b = await body(req); return json(res, 200, ws.resolveProject(b.text)); }

    // ---- secrets (a person can add, list and delete; values are never sent back) ----
    if (seg[0] === 'secrets' && seg[1]) {
      const sec = require('./studiosecrets'), project = seg[1];
      try { stu.projName(project); } catch (e) { return json(res, 400, { error: e.message }); }
      if (!stu.listProjects().some(x => x.name === stu.projName(project))) return json(res, 404, { error: 'There is no project named "' + project + '".' });
      if (req.method === 'GET' && !seg[2]) return json(res, 200, { secrets: sec.list(project), max: sec.MAX_SECRETS });
      if (req.method === 'POST' && !seg[2]) { const b = await body(req); try { return json(res, 200, Object.assign({ ok: true }, sec.set(project, b.name, b.value, 'manual'))); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'DELETE' && seg[2]) { try { return json(res, 200, { removed: sec.remove(project, seg[2]) }); } catch (e) { return json(res, 400, { error: e.message }); } }
    }
    // ---- database: a person can LOOK and manage their app's users. Turning it on and changing tables is the AI's job only. ----
    if (seg[0] === 'db' && seg[1]) {
      const db = require('./studiodb'), project = seg[1];
      try { stu.projName(project); } catch (e) { return json(res, 400, { error: e.message }); }
      if (!stu.listProjects().some(x => x.name === stu.projName(project))) return json(res, 404, { error: 'There is no project named "' + project + '".' });
      if (req.method === 'GET' && !seg[2]) return json(res, 200, db.status(project));
      if (req.method === 'GET' && seg[2] === 'rows' && seg[3]) { try { return json(res, 200, { rows: db.select(project, seg[3], { limit: +u.searchParams.get('limit') || 50 }) }); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'DELETE' && seg[2] === 'account' && seg[3]) { try { return json(res, 200, await db.deleteAccount(project, seg[3])); } catch (e) { return json(res, 400, { error: e.message }); } }
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || (req.method === 'DELETE' && seg[2] !== 'account')) return json(res, 403, { error: 'Only the AI sets up the database. Ask it in the chat.', code: 'ai-only' });
    }

    // ---- runs ----
    if (seg[0] === 'runs' && !seg[1] && req.method === 'GET') return json(res, 200, { runs: runs.list(u.searchParams.get('project') || '') });
    if (seg[0] === 'runs' && !seg[1] && req.method === 'POST') {
      const b = await body(req); let prompt = String(b.prompt || '').trim();
      if (prompt.length < 3) return json(res, 400, { error: 'Describe the task first.' });
      if (prompt.length > 4000) return json(res, 400, { error: 'That prompt is too long (max 4000 characters).' });
      if (!b.model) return json(res, 400, { error: 'Pick a model first.' });
      const mode = runs.MODES[b.mode] ? b.mode : 'build';
      let project = String(b.project || '').trim();
      if (b.newProject) { const n = stu.createProject(String(b.newProject)); project = n.name; }
      if (project) { try { stu.projName(project); } catch (e) { return json(res, 400, { error: e.message }); } if (!stu.listProjects().some(x => x.name === project)) return json(res, 404, { error: 'There is no project named "' + project + '".' }); }
      // Keys pasted in the message are saved for this project and removed BEFORE the run is stored or any model sees the text.
      const prot = require('./studioservices').protectMessage(project || 'default', prompt); prompt = prot.text;
      const run = runs.create({ project, prompt, mode, model: b.model, files: b.attachments }); if (prot.notice) { run.notice = prot.notice; runs.save(run); }
      const callModel = deps.callModel(String(b.model));
      // start in the background and answer straight away: the screen follows along through the stream
      setImmediate(async () => {
        const relay = setInterval(() => { try { emit(run.id, { type: 'run', run: runs.load(run.id) }); } catch {} }, 700);
        try { await eng.execute(run.id, { callModel, runTool: deps.runTool, parseTool: deps.parseTool, toolNames: deps.toolNames }); }
        catch (e) { try { const r = runs.load(run.id); runs.finish(r, 'failed', null, e.message); runs.save(r); } catch {} }
        finally { clearInterval(relay); try { emit(run.id, { type: 'run', run: runs.load(run.id), final: true }); } catch {} }
      });
      return json(res, 202, { id: run.id, status: 'queued' });
    }
    if (seg[0] === 'runs' && seg[1] && !seg[2] && req.method === 'GET') return json(res, 200, { run: runs.load(seg[1]), active: eng.isActive(seg[1]) });
    if (seg[0] === 'runs' && seg[1] && !seg[2] && req.method === 'DELETE') { if (eng.isActive(seg[1])) return json(res, 409, { error: 'Stop the run first.' }); return json(res, 200, runs.remove(seg[1])); }
    if (seg[0] === 'runs' && seg[1] && seg[2] === 'stream' && req.method === 'GET') {
      runs.load(seg[1]);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      if (!clients.has(seg[1])) clients.set(seg[1], new Set()); const set = clients.get(seg[1]); if (set.size >= 5) { res.end(); return; } set.add(res);
      res.write('data: ' + JSON.stringify({ type: 'run', run: runs.load(seg[1]) }) + '\n\n');
      const beat = setInterval(() => { try { res.write(': \n\n'); } catch {} }, 20000);
      const done = () => { clearInterval(beat); set.delete(res); if (!set.size) clients.delete(seg[1]); }; req.on('close', done); res.on('error', done); return;
    }
    if (seg[0] === 'runs' && seg[1] && seg[2] === 'cancel' && req.method === 'POST') return json(res, 200, { ok: eng.cancel(seg[1]) });
    if (seg[0] === 'runs' && seg[1] && seg[2] === 'plan' && req.method === 'PUT') { const b = await body(req); const r = runs.load(seg[1]); if (eng.isActive(seg[1])) return json(res, 409, { error: 'The plan is locked while the run is working.' }); runs.editPlan(r, b.tasks); return json(res, 200, { run: runs.save(r) }); }
    if (seg[0] === 'runs' && seg[1] && seg[2] === 'diff' && req.method === 'GET') return json(res, 200, ws.runDiff(runs.load(seg[1])));
    if (seg[0] === 'runs' && seg[1] && seg[2] === 'revert' && req.method === 'POST') { const b = await body(req), r = runs.load(seg[1]); if (eng.isActive(seg[1])) return json(res, 409, { error: 'Stop the run first.' }); return json(res, 200, b.file ? ws.revertFile(r, String(b.file)) : ws.revertRun(r)); }

    // ---- review first: the changes of a run wait for you; accept keeps a file, reject puts it back ----
    if (seg[0] === 'runs' && seg[1] && seg[2] === 'review') {
      const r = runs.load(seg[1]); const rv = require('./studioreview');
      if (req.method === 'GET') return json(res, 200, rv.list(r));
      if (req.method === 'POST') {
        if (eng.isActive(seg[1])) return json(res, 409, { error: 'Wait for the run to finish, or stop it first.' });
        const b = await body(req), act = String(b.action || ''); let out;
        if (act === 'accept') out = rv.accept(r, String(b.file || ''));
        else if (act === 'reject') out = rv.reject(r, String(b.file || ''));
        else if (act === 'accept-all') out = rv.acceptAll(r);
        else if (act === 'reject-all') out = rv.rejectAll(r);
        else return json(res, 400, { error: 'Choose accept, reject, accept-all or reject-all.' });
        runs.save(r); return json(res, 200, Object.assign({}, out, { review: rv.list(r) }));
      }
    }

    // ---- project views ----
    const project = u.searchParams.get('project') || '';
    if (seg[0] === 'search' && req.method === 'GET') return json(res, 200, { hits: ws.search(project, u.searchParams.get('q'), +u.searchParams.get('limit') || 60) });
    if (seg[0] === 'problems' && req.method === 'GET') return json(res, 200, { problems: ws.problems(project) });
    if (seg[0] === 'build' && req.method === 'POST') { const b = await body(req); const r = ws.build(String(b.project || '')); return json(res, 200, r); }
    if (seg[0] === 'tests' && req.method === 'POST') { const b = await body(req); return json(res, 200, ws.tests(String(b.project || ''))); }
    // ---- GitHub: import, branches, review, push (the token comes from this PC's request header and is never stored or logged) ----
    if (seg[0] === 'github') {
      const gh = deps.github || require('./github'), token = String(req.headers['x-github-token'] || '');
      if (seg[1] === 'status') return json(res, 200, { connected: !!token, note: token ? 'GitHub is connected on this PC.' : 'Connect GitHub in Tools to import or push.' });
      if (!token && seg[1] !== 'branches') return json(res, 401, { error: 'Connect GitHub in Tools first.' });
      if (seg[1] === 'branches' && req.method === 'POST') { const b = await body(req); return json(res, 200, { text: await gh.READ_BRANCHES(token, b.repo) }); }
      if (seg[1] === 'import' && req.method === 'POST') {
        const b = await body(req), name = stu.projName(b.project || String(b.repo || '').split('/')[1]);
        const got = await gh.importRepo(token, b.repo, b.branch);
        if (!got.files.length) return json(res, 422, { error: 'No supported text files were found in ' + got.repo + '@' + got.branch + '.', skipped: got.skipped });
        stu.createProject(name, 'empty'); try { require('./studiohistory').save(stu, name, 'Before importing ' + got.repo, { by: 'ai', force: true }); } catch {}
        const written = [], failed = [];
        for (const f of got.files) { try { stu.writeFile(name, f.path, f.content); written.push(f.path); } catch (e) { failed.push(f.path + ': ' + e.message); } }
        return json(res, 200, { project: name, repo: got.repo, branch: got.branch, imported: written.length, written, failed, skipped: got.skipped });
      }
      if (seg[1] === 'review' && req.method === 'POST') { const b = await body(req); return json(res, 200, await gh.reviewDiff(token, b.repo, b.branch, stu.snapshot(b.project).map(f => ({ path: f.name, content: f.content })))); }
      if (seg[1] === 'push' && req.method === 'POST') {   // never pushes: it PARKS the push for the user's Allow, exactly like the chat tools
        const b = await body(req), files = stu.snapshot(b.project).map(f => ({ path: f.name, content: f.content }));
        const r = await gh.run(token, 'github_publish_project', { repo: b.repo, branch: b.branch, message: b.message || 'Update from Pholama Studio', files });
        return json(res, 200, { pending: r.pending, text: 'Waiting for your approval. Nothing has been pushed yet.' });
      }
    }
    return json(res, 404, { error: 'unknown workspace route' });
  } catch (e) { return json(res, 400, { error: e.message }); }
}

module.exports = { handle, capabilities, emit };
