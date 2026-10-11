// A fixed battery of checks that runs INSIDE the deployed function. It exists so the code that is live can be proved identical in behaviour to the code that was tested:
// the same vectors run offline and on the host, and their fingerprints must match. It touches no data and needs no login or secret.
import * as Core from './siteStudioCore.ts';
import * as D from './siteStudioDb.ts';
import * as R from './siteStudioRun.ts';
import * as E from './siteStudioEngine.ts';
import { seal, unseal } from './siteStudioSupabase.ts';

const hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');
const t = async (fn: () => unknown) => { try { return await fn(); } catch (e) { return 'ERR:' + String((e as Error).message).slice(0, 80); } };

export async function selfcheck() {
  const out: Record<string, unknown> = {};
  // file names
  out.names = await Promise.all(['index.html', '../x', '.env', 'a/b.js', 'x.exe', 'a b.css', 'a//b.js', 'sub/dir/ok.json', 'A.TXT'].map(n => t(() => Core.fileName(n))));
  out.proj = await Promise.all(['Shop', ' My Site! ', '', '...', 'a'.repeat(80)].map(n => t(() => Core.projName(n))));
  // secret scanner
  const cases = ['API_KEY=abcd1234efgh5678\nSECRET_KEY=zyxw9876vuts5432\nDEBUG=true', '{"apiKey": "abcd1234efgh5678ijkl", "password": "correct-horse-battery"}', 'curl -H "Authorization: Bearer ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8" x', 'my password is hunter2hunter2 ok', 'export OPENAI_API_KEY="sk-proj-Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7"', 'TOKEN=process.env.TOKEN', 'const token = getToken();', 'API_KEY=your_api_key_here', 'AUTH=true', 'I love api keys'];
  out.scan = cases.map(c => { const r = Core.scanSecrets(c); return r.redacted + '|' + r.found.map(f => f.name).join(','); });
  // boundaries: one character under and exactly at each minimum length, so a changed {n,m} range changes the fingerprint
  const rep = (ch: string, n: number) => ch.repeat(n);
  out.edge = [['ghp_', 29], ['ghp_', 30], ['gsk_', 39], ['gsk_', 40], ['sk-ant-', 29], ['sk-ant-', 30], ['re_', 19], ['re_', 20], ['sk_live_', 19], ['sk_live_', 20], ['AKIA', 15], ['AKIA', 16], ['xoxb-', 19], ['xoxb-', 20], ['sb_secret_', 19], ['sb_secret_', 20], ['sk-', 31], ['sk-', 32]].map(([pre, n]) => { const r = Core.scanSecrets('x ' + pre + rep(pre === 'AKIA' ? 'A' : 'a', n as number) + ' y'); return pre + n + ':' + r.found.map(f => f.name).join(','); }).concat(['PASSWORD=1234567', 'PASSWORD=12345678', 'password: abcdefghijk', 'password: abcdefghijkl', 'SECRET=true1234', 'TOKEN=a.b.c.d.e1'].map(c => c + ':' + Core.scanSecrets(c).found.length));
  out.limits = JSON.stringify(Core.LIMITS) + JSON.stringify(D.DB_LIMITS);
  out.secretName = await Promise.all(['openai key', '9lives', 'PATH', 'ok_name', 'x'.repeat(60)].map(n => t(() => Core.cleanSecretName(n))));
  out.mask = [Core.maskValue('abcdefghij'), Core.maskValue('short')];
  // edits
  const files: Record<string, string> = { 'e.js': 'function go() {\n    let x = 1;\n    return x;\n}\n', 'dup.js': 'a();\na();\n' };
  const store: any = { async hasProject() { return true; }, async listProjects() { return []; }, async createProject() {}, async deleteProject() {}, async listFiles() { return Object.entries(files).map(([name, c]) => ({ name, size: c.length })); }, async getFile(_p: string, f: string) { return f in files ? files[f] : null; }, async putFile(_p: string, f: string, c: string) { files[f] = c; }, async delFile(_p: string, f: string) { delete files[f]; }, async allFiles() { return { ...files }; }, async replaceFiles() {} };
  const c: any = { store, secrets: { async scrub(_p: string, s: string) { return s; }, async values() { return {}; }, async list() { return []; }, async set() { return { name: '', preview: '', replaced: false }; }, async remove() { return false; } } };
  out.edit = [await t(() => Core.patchFile(c, 'p', 'e.js', 'let x = 1;', 'let x = 2;')), await t(() => Core.patchFile(c, 'p', 'e.js', 'return x;   ', 'return x * 2;')), await t(() => Core.patchFile(c, 'p', 'dup.js', 'a();', 'b();')), await t(() => Core.patchFile(c, 'p', 'dup.js', 'a();', 'b();', true)), await t(() => Core.patchFile(c, 'p', 'e.js', 'return x * 2;', 'return x * ;')), files['e.js']];
  out.problems = await t(async () => { files['index.html'] = '<a href="nope.html">x</a><div id="a"></div><div id="a"></div>'; return (await Core.check(c, 'p')).join('|'); });
  // database rules (fixed clock)
  const T0 = Date.UTC(2026, 9, 11, 9, 0, 0), H = 3600000; const doc = D.emptyDoc(); D.enable(doc, 'ai'); await D.signUp(doc, 'kim@example.com', 'passw0rd-ok');
  const seen: string[] = []; for (let i = 0; i < 11; i++) { try { const r = await D.signIn(doc, 'kim@example.com', 'passw0rd-ok', T0 + i * 60000); seen.push(r.good ? 'ok' + (r.account as any).left : 'no'); } catch (e) { seen.push((e as D.DbError).code); } }
  out.signins = seen.join(','); out.after4h = await t(async () => (await D.signIn(doc, 'kim@example.com', 'passw0rd-ok', T0 + 4 * H + 11 * 60000)).good);
  // the stored hash format is part of the contract: a known password + fixed salt must give exactly these bytes (a changed round count fails here)
  out.hash = await t(async () => { const d3 = D.emptyDoc(); D.enable(d3, 'ai'); await D.signUp(d3, 'a@b.co', 'known-password-1'); d3.accounts[0].salt = btoa(String.fromCharCode(...new Uint8Array(16).fill(7))); const salt = new Uint8Array(16).fill(7); const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('known-password-1'), 'PBKDF2', false, ['deriveBits']); const want = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, k, 256)))); d3.accounts[0].hash = want; return (await D.signIn(d3, 'a@b.co', 'known-password-1', Date.now())).good; });
  out.aiOnly = await t(() => D.enable(D.emptyDoc(), 'user')); out.dbTypes = await t(() => { const d2 = D.emptyDoc(); D.enable(d2, 'ai'); D.createTable(d2, 'notes', [{ name: 'title' }, { name: 'n', type: 'number' }], 'ai'); return JSON.stringify(D.insert(d2, 'notes', { title: 'x', n: '3' })); });
  // sealing: a value comes back only with the same key, owner and project
  const s1 = await seal('master-key-for-selfcheck-0123456789', 'u1', 'shop', 'sk-live-secret-value-123');
  out.seal = [await t(() => unseal('master-key-for-selfcheck-0123456789', 'u1', 'shop', s1)), await t(() => unseal('master-key-for-selfcheck-0123456789', 'u2', 'shop', s1)), await t(() => unseal('master-key-for-selfcheck-0123456789', 'u1', 'other', s1)), await t(() => unseal('another-master-key-for-selfcheck-99', 'u1', 'shop', s1)), s1.includes('secret-value')].map(x => typeof x === 'string' && x.startsWith('ERR') ? 'ERR' : x);
  // run record + report + parser + diff
  const run = R.create({ project: 'shop', prompt: 'a ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', mode: 'build', model: 'm' }); R.setPlan(run, ['one', { title: 'two', dependsOn: ['t1'] }]); const st = R.openStep(run, { title: 'x', tool: 'studio_read', input: { f: 1 } }); R.closeStep(run, st, { ok: false, error: 'bad' }); R.noteFiles(run, [{ file: 'a.js', status: 'changed', added: 2, removed: 1 }]); R.addBuild(run, { ok: true, code: 0, output: 'fine' });
  out.run = JSON.stringify({ prompt: run.prompt, stages: run.stages.map(s => s.id), plan: run.plan.map(p => p.id + p.title + p.dependsOn.join()), report: R.buildReport(run) });
  out.parse = [E.parseTool('<tool_call>{"name":"studio_read","arguments":{"file":"a"}}</tool_call>'), E.parseTool('<tool_call>{"name":"studio_read","args":{"file":"a",}}'), E.parseTool('<function=studio_read>{"file":"a"}</function>'), E.parseTool('<tool_call>{"name":"rm","arguments":{}}</tool_call>', ['studio_read']), E.parseTool('all done')].map(x => x ? x.name + ':' + JSON.stringify(x.args) : null);
  out.diff = JSON.stringify(E.diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne'));
  out.modes = JSON.stringify(R.MODES);
  const json = JSON.stringify(out); return { fingerprint: await hex(json), parts: Object.fromEntries(await Promise.all(Object.entries(out).map(async ([k, v]) => [k, (await hex(JSON.stringify(v))).slice(0, 12)]))), size: json.length };
}
