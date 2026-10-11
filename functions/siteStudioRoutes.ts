// Website Studio HTTP routes: the same URLs the shared workspace screen already calls on the PC.
// A pure function of (request, deps), so every route, limit and error is tested offline. Deno.serve is only a thin shell around it.
import * as Core from './siteStudioCore.ts';
import * as R from './siteStudioRun.ts';
import * as E from './siteStudioEngine.ts';
import * as D from './siteStudioDb.ts';
import type { Rest } from './siteStudioSupabase.ts';
import * as S from './siteStudioSupabase.ts';

export const DAILY_RUNS = 12;                 // AI runs per member per day (the free GPUs are shared)
export const SLICE_MS = 40000;                // one request advances a run for at most this long
export const MODEL = 'qwen-coder';            // Free.ai self-hosted (free). Premium models are never called.

export interface Deps {
  uid: string; rest: Rest; master: string;
  callModel(msgs: { role: string; content: string }[], o?: { signal?: AbortSignal }): Promise<string>;
  spend(uid: string, n: number): Promise<boolean>;          // takes from today's allowance; false = used up
  now?: () => number;
}
export type Req = { method: string; path: string[]; query: URLSearchParams; body: any };
export type Res = { status: number; body: any };
const ok = (body: unknown, status = 200): Res => ({ status, body });
const err = (m: string, status = 400, code?: string): Res => ({ status, body: code ? { error: m, code } : { error: m } });
// A message safe to show: our own validation messages pass, anything from the platform, the database or a provider is replaced.
const show = (e: unknown) => { const m = String((e as Error)?.message || ''); return /^(database|fetch|TypeError|ReferenceError|Syntax|Unexpected|Failed|network|ECONN|HTTP|Deno)/i.test(m) || /supabase|postgres|relation|free\.ai|sql|stack|at\s+\S+\s+\(/i.test(m) ? 'Something went wrong. Try again in a moment.' : m || 'Something went wrong.'; };

export function capabilities() {
  return {
    modes: Object.entries(R.MODES).map(([id, m]) => ({ id, label: m.label, note: m.note, maxSteps: m.maxSteps, maxRepairs: m.maxRepairs })),
    models: [{ id: MODEL, name: 'Pholama cloud agent', tools: true, coding: true, reasoning: false }], toolCalling: true,
    terminal: { available: false, note: 'The website Studio has no terminal. The PC Studio does.' },
    build: { available: true, note: 'Website Studio projects are static web files. The build is a real parse and link check.' },
    tests: { available: false, note: 'Test files run in the PC Studio. The website checks scripts, JSON, links and ids instead.' },
    limits: { projects: Core.LIMITS.MAX_PROJECTS, files: Core.LIMITS.MAX_FILES, secrets: Core.LIMITS.MAX_SECRETS, runsPerDay: DAILY_RUNS },
    site: true, noStream: true,
  };
}

// What the AI may do with the database. A person can only look; turning it on and changing tables is done here, by the AI, and nowhere else.
function dbTools(project: string, dbs: ReturnType<typeof S.makeDbStore>) {
  const withDoc = async (fn: (doc: D.Doc) => unknown) => { const doc = await dbs.load(project); const out = await fn(doc); D.fits(doc); await dbs.save(project, doc); return out; };
  const j = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v);
  return {
    studio_db_status: async () => { const s = D.status(await dbs.load(project)); return j({ ...s, note: D.promptNote(await dbs.load(project)) }); },
    studio_db_enable: (_a: any) => withDoc(doc => { D.enable(doc, 'ai'); return 'The database is on (free, under 0.01 GB). Accounts are built in. Rule to respect: each account can sign in 10 times a week, then takes a 4 hour break, so never build auto-login or retry loops. Create tables with studio_db_create_table.'; }),
    studio_db_create_table: (a: any) => withDoc(doc => j(D.createTable(doc, a?.name, a?.columns, 'ai'))),
    studio_db_insert: (a: any) => withDoc(doc => j(D.insert(doc, a?.table, a?.row))),
    studio_db_select: async (a: any) => j(D.select(await dbs.load(project), a?.table, { where: a?.where, limit: a?.limit })),
  } as Record<string, (a: any) => Promise<string> | string>;
}

export async function handle(req: Req, d: Deps): Promise<Res> {
  const { method, path: seg, query, body } = req;
  const store = S.makeStore(d.rest, d.uid), vault = S.makeVault(d.rest, d.uid, d.master), c: Core.Ctx = { store, secrets: vault };
  const runs = S.makeRuns(d.rest, d.uid), cps = S.makeCheckpoints(d.rest, d.uid), dbs = S.makeDbStore(d.rest, d.uid);
  const now = d.now || Date.now;
  const own = async (p: unknown) => { const n = Core.projName(p); if (!(await store.hasProject(n))) throw new Error('There is no project named "' + n + '".'); return n; };
  try {
    // ------------------------------- screen data -------------------------------
    if (seg[0] === 'capabilities' || !seg.length) return ok(capabilities());
    if (seg[0] === 'dashboard' && method === 'GET') {
      const list = await store.listProjects(), out = [];
      for (const p of list) { const files = await store.listFiles(p.name); const rs = await runs.list(p.name); const last = rs[0]; out.push({ name: p.name, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), updated: p.updated, lastRun: last ? { id: last.id, status: last.status, prompt: String(last.prompt).slice(0, 80), at: last.createdAt } : null, running: rs.some(r => !E.isDone(r)) }); }
      return ok({ projects: out });
    }
    if (seg[0] === 'resolve' && method === 'POST') { const t = String(body?.text || '').toLowerCase(), list = await store.listProjects(); const hit = list.filter(p => t.includes(p.name)); return ok(hit.length === 1 ? { status: 'found', project: hit[0].name } : hit.length > 1 ? { status: 'ambiguous', candidates: hit.map(h => h.name), message: 'Which project do you mean?' } : { status: 'none', message: list.length ? 'I could not tell which project you mean. Pick one.' : 'You have no projects yet. Describe what to build and I will create one.' }); }

    // ------------------------------- projects & files -------------------------------
    if (seg[0] === 'projects') {
      if (!seg[1] && method === 'GET') return ok({ projects: await store.listProjects() });
      if (!seg[1] && method === 'POST') return ok(await Core.createProject(c, body?.name));
      const name = await own(seg[1]);
      if (!seg[2] && method === 'GET') { const all = await store.allFiles(name); return ok({ name, files: Object.entries(all).sort(([a], [b]) => a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)).map(([n, content]) => ({ name: n, size: new TextEncoder().encode(content).length, content })) }); }
      if (!seg[2] && method === 'DELETE') { await store.deleteProject(name); return ok({ ok: true, text: 'Deleted ' + name }); }
      if (seg[2] === 'tree' && method === 'GET') { const fs = await store.listFiles(name); const dirs = new Set<string>(); for (const f of fs) { const parts = f.name.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); } return ok({ files: fs, dirs: [...dirs].sort() }); }
      if (seg[2] === 'file' && method === 'PUT') return ok(await Core.writeFile(c, name, body?.file, body?.content));
      if (seg[2] === 'file' && method === 'DELETE') return ok({ ok: true, text: await Core.deleteFile(c, name, body?.file) });
      if (seg[2] === 'folder' && method === 'POST') return ok({ ok: true, text: 'Folders appear when a file is saved inside them.' });
      if (seg[2] === 'preview' && method === 'GET') return ok({ files: await store.allFiles(name) });
    }

    // ------------------------------- secrets: a person can add, list, delete. Values are NEVER sent back. -------------------------------
    if (seg[0] === 'secrets' && seg[1]) {
      const name = await own(seg[1]);
      if (method === 'GET' && !seg[2]) return ok({ secrets: await vault.list(name), max: Core.LIMITS.MAX_SECRETS });
      if (method === 'POST' && !seg[2]) return ok(Object.assign({ ok: true }, await vault.set(name, body?.name, body?.value, 'manual')));
      if (method === 'DELETE' && seg[2]) return ok({ removed: await vault.remove(name, seg[2]) });
    }
    // ------------------------------- database: a person can LOOK and manage their app's users. Turning it on and changing tables is the AI's job. -------------------------------
    if (seg[0] === 'db' && seg[1]) {
      const name = await own(seg[1]); const doc = await dbs.load(name);
      if (method === 'GET' && !seg[2]) return ok(D.status(doc));
      if (method === 'GET' && seg[2] === 'rows' && seg[3]) return ok({ rows: D.select(doc, seg[3], { limit: +(query.get('limit') || 50) }) });
      if (method === 'DELETE' && seg[2] === 'account' && seg[3]) { const r = D.deleteAccount(doc, seg[3]); await dbs.save(name, doc); return ok(r); }
      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') return err('Only the AI sets up the database. Ask it in the chat.', 403, 'ai-only');
    }

    // ------------------------------- runs -------------------------------
    if (seg[0] === 'runs' && !seg[1] && method === 'GET') return ok({ runs: (await runs.list(query.get('project') || '')).map(R.summary) });
    if (seg[0] === 'runs' && !seg[1] && method === 'POST') {
      let prompt = String(body?.prompt || '').trim();
      if (prompt.length < 3) return err('Describe the task first.'); if (prompt.length > 4000) return err('That prompt is too long (max 4000 characters).');
      const mode = R.MODES[body?.mode] ? body.mode : 'build'; let project = String(body?.project || '').trim();
      if (body?.newProject) project = (await Core.createProject(c, String(body.newProject))).name;
      if (!project) return err('Pick a project, or name a new one.');
      // The shared screen sends just a name for a new project (the PC makes it on the spot), so make it here too. createProject enforces the name rules and the project cap.
      if (!(await store.hasProject(Core.projName(project)))) project = (await Core.createProject(c, project)).name;
      project = await own(project);
      const active = (await runs.list(project)).find(r => !E.isDone(r) && now() - (r.updatedAt || 0) < 5 * 60000); if (active) return err('This project already has a run working. Wait for it to finish or stop it.', 409);
      if (!(await d.spend(d.uid, 1))) return err('You used all ' + DAILY_RUNS + ' AI runs for today. They come back tomorrow.', 429, 'limit');
      // Keys pasted in the message are saved for this project and removed BEFORE the run is stored or any model sees the text.
      const prot = await Core.protectMessage(vault, project, prompt); prompt = prot.text;
      const run = R.create({ project, prompt, mode, model: MODEL, files: body?.attachments }); if (prot.notice) run.notice = prot.notice;
      await runs.save(run); return ok({ id: run.id, status: 'queued' }, 202);
    }
    if (seg[0] === 'runs' && seg[1]) {
      const id = seg[1]; if (!/^r[a-z0-9]{6,20}$/.test(id)) return err('No such run.', 404);
      const run = await runs.load(id); if (!run) return err('No such run.', 404);
      if (!seg[2] && method === 'GET') {
        // Reading a run that is still going also moves it forward by one slice. One request at a time holds the lease; the rest just read.
        if (!E.isDone(run) && run.status !== 'waiting' && (await runs.lease(id, SLICE_MS + 15000))) {
          const fresh = (await runs.load(id)) || run; const deadline = now() + SLICE_MS;
          const deps: E.EngineDeps = { c, checkpoints: cps, runs: { save: r => runs.save(r) }, callModel: d.callModel, tools: E.makeTools({ c, extra: dbTools(fresh.project, dbs) }), deadline, notes: async () => D.promptNote(await dbs.load(fresh.project)), cancelled: async () => !!(await runs.load(id))?.cancelRequested };
          const out = await E.advance(fresh, deps); (out as any).leaseUntil = 0;
          const latest = await runs.load(id); if (latest && (latest as any).cancelRequested) (out as any).cancelRequested = true;   // a stop pressed while this slice ran must survive the save
          await runs.save(out); return ok({ run: out, active: !E.isDone(out) });
        }
        return ok({ run, active: !E.isDone(run) });
      }
      if (!seg[2] && method === 'DELETE') { if (!E.isDone(run)) return err('Stop the run first.', 409); await runs.remove(id); return ok({ ok: true }); }
      if (seg[2] === 'cancel' && method === 'POST') { if (E.isDone(run)) return ok({ ok: false }); (run as any).cancelRequested = true; await runs.save(run); return ok({ ok: true }); }
      if (seg[2] === 'plan' && method === 'PUT') { if (!E.isDone(run) && run.status === 'running') return err('The plan is locked while the run is working.', 409); R.editPlan(run, body?.tasks || []); await runs.save(run); return ok({ run }); }
      if (seg[2] === 'diff' && method === 'GET') return ok(await E.runDiff(c, cps, run));
      if (seg[2] === 'revert' && method === 'POST') { if (!E.isDone(run)) return err('Stop the run first.', 409); return ok(body?.file ? await E.revertFile(c, cps, run, body.file) : await E.revertRun(c, cps, run)); }
    }

    // ------------------------------- project views -------------------------------
    const project = query.get('project') || '';
    if (seg[0] === 'search' && method === 'GET') return ok({ hits: await E.search(c, await own(project), query.get('q') || '', +(query.get('limit') || 60)) });
    if (seg[0] === 'problems' && method === 'GET') return ok({ problems: await E.problems(c, await own(project)) });
    if (seg[0] === 'build' && method === 'POST') return ok(await E.build(c, await own(body?.project)));
    if (seg[0] === 'tests' && method === 'POST') { await own(body?.project); return ok(E.tests()); }
    return err('Not found.', 404);
  } catch (e) { return err(show(e), /no project named|no such/i.test(String((e as Error)?.message)) ? 404 : 400); }
}
