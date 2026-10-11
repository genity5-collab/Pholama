// Supabase-backed storage for the website Studio. Every query is scoped to ONE user id; there is no code path that reads another member's rows.
// `fetch` is injected, so the whole adapter is tested offline against a fake PostgREST.
import type { Store, SecretVault } from './siteStudioCore.ts';
import { LIMITS, cleanSecretName, maskValue } from './siteStudioCore.ts';
import type { CheckpointStore } from './siteStudioEngine.ts';
import type { RunStore } from './siteStudioRun.ts';
import { type Doc, emptyDoc } from './siteStudioDb.ts';

export type Rest = (path: string, init?: RequestInit) => Promise<any>;

// PostgREST helper. `url` and `key` come from the caller; `f` is fetch (or a test double).
export function makeRest(url: string, key: string, f: typeof fetch = fetch): Rest {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return async (path, init = {}) => {
    const r = await f(url + '/rest/v1/' + path, { ...init, headers: { ...H, ...((init.headers as Record<string, string>) || {}) } });
    const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* not json */ }
    if (!r.ok) throw new Error('database ' + r.status);        // the real body is never passed on to a user
    return j;
  };
}
const q = (s: string) => encodeURIComponent(s);
const bytes = (s: string) => new TextEncoder().encode(s).length;

export function makeStore(rest: Rest, uid: string): Store {
  const U = 'user_id=eq.' + q(uid);
  return {
    async hasProject(p) { const r = await rest('pholama_site_projects?select=name&' + U + '&name=eq.' + q(p) + '&limit=1'); return !!r?.length; },
    async listProjects() { const r = await rest('pholama_site_projects?select=name,updated_at&' + U + '&order=updated_at.desc&limit=50'); return (r || []).map((x: any) => ({ name: x.name, updated: Date.parse(x.updated_at) || 0 })); },
    async createProject(p) { await rest('pholama_site_projects', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, name: p }) }); },
    async deleteProject(p) { await rest('pholama_site_projects?' + U + '&name=eq.' + q(p), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); },
    async listFiles(p) { const r = await rest('pholama_site_files?select=path,content&' + U + '&project=eq.' + q(p) + '&limit=200'); return (r || []).map((x: any) => ({ name: x.path, size: bytes(x.content || '') })); },
    async getFile(p, f) { const r = await rest('pholama_site_files?select=content&' + U + '&project=eq.' + q(p) + '&path=eq.' + q(f) + '&limit=1'); return r?.length ? String(r[0].content ?? '') : null; },
    async putFile(p, f, content) {
      await rest('pholama_site_files?on_conflict=user_id,project,path', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: uid, project: p, path: f, content, updated_at: new Date().toISOString() }) });
      await rest('pholama_site_projects?' + U + '&name=eq.' + q(p), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ updated_at: new Date().toISOString() }) });
    },
    async delFile(p, f) { await rest('pholama_site_files?' + U + '&project=eq.' + q(p) + '&path=eq.' + q(f), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); },
    async allFiles(p) { const r = await rest('pholama_site_files?select=path,content&' + U + '&project=eq.' + q(p) + '&limit=200'); return Object.fromEntries((r || []).map((x: any) => [x.path, String(x.content ?? '')])); },
    async replaceFiles(p, files) {
      const have = await rest('pholama_site_files?select=path&' + U + '&project=eq.' + q(p) + '&limit=200');
      const gone = (have || []).map((x: any) => x.path).filter((n: string) => !(n in files));
      for (const n of gone) await rest('pholama_site_files?' + U + '&project=eq.' + q(p) + '&path=eq.' + q(n), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      const rows = Object.entries(files).map(([path, content]) => ({ user_id: uid, project: p, path, content, updated_at: new Date().toISOString() }));
      if (rows.length) await rest('pholama_site_files?on_conflict=user_id,project,path', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    },
  };
}

// ---------- sealing: AES-GCM with a key derived from a server secret + the owner + the project, so a copied row is useless anywhere else ----------
async function sealKey(master: string, uid: string, project: string) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(master), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('pholama-site-secrets-v1'), info: new TextEncoder().encode(uid + '|' + project) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)), unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function seal(master: string, uid: string, project: string, value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(master, uid, project), new TextEncoder().encode(value))); return b64(iv) + '.' + b64(ct); }
export async function unseal(master: string, uid: string, project: string, sealed: string) { const [iv, ct] = sealed.split('.'); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await sealKey(master, uid, project), unb64(ct))); }

export function makeVault(rest: Rest, uid: string, master: string): SecretVault {
  if (!master || master.length < 16) throw new Error('secret sealing is not configured');
  const U = 'user_id=eq.' + q(uid);
  const rows = async (p: string) => (await rest('pholama_site_secrets?select=name,sealed,preview,source&' + U + '&project=eq.' + q(p) + '&order=created_at.asc&limit=20')) || [];
  const vault: SecretVault = {
    async list(p) { return (await rows(p)).map((r: any) => ({ name: r.name, preview: r.preview, source: r.source })); },
    async set(p, name, value, source) {
      const n = cleanSecretName(name), v = String(value ?? ''); if (!v.trim()) throw new Error('The value is empty.'); if (/[\r\n\0]/.test(v)) throw new Error('A secret value must be on one line.'); if (v.length > 4000) throw new Error('That value is too long.');
      const have = await rows(p), has = have.some((r: any) => r.name === n);
      if (!has && have.length >= LIMITS.MAX_SECRETS) throw new Error('A project can hold ' + LIMITS.MAX_SECRETS + ' secrets. Delete one first.');
      const sealed = await seal(master, uid, p, v), preview = maskValue(v);
      await rest('pholama_site_secrets?on_conflict=user_id,project,name', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: uid, project: p, name: n, sealed, preview, source }) });
      return { name: n, preview, replaced: has };
    },
    async remove(p, name) { const n = cleanSecretName(name), had = (await rows(p)).some((r: any) => r.name === n); if (had) await rest('pholama_site_secrets?' + U + '&project=eq.' + q(p) + '&name=eq.' + q(n), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); return had; },
    async values(p) { const out: Record<string, string> = {}; for (const r of await rows(p)) { try { out[r.name] = await unseal(master, uid, p, r.sealed); } catch { /* an unreadable row is skipped, never guessed */ } } return out; },
    async scrub(p, text) { let t = String(text ?? ''); for (const [k, v] of Object.entries(await vault.values(p))) if (v.length >= 8) t = t.split(v).join('{{secret:' + k + '}}'); return t; },
  };
  return vault;
}

const rid = () => { const b = new Uint8Array(6); crypto.getRandomValues(b); return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); };
export function makeCheckpoints(rest: Rest, uid: string): CheckpointStore {
  const U = 'user_id=eq.' + q(uid);
  return {
    async save(p, label, files) {
      const id = 'c' + Date.now().toString(36) + rid();
      await rest('pholama_site_checkpoints', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id, user_id: uid, project: p, label: String(label).slice(0, 120), files }) });
      const old = await rest('pholama_site_checkpoints?select=id&' + U + '&project=eq.' + q(p) + '&order=created_at.desc&offset=30&limit=50');   // keep the newest 30
      for (const o of old || []) await rest('pholama_site_checkpoints?' + U + '&id=eq.' + q(o.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return id;
    },
    async load(p, id) { const r = await rest('pholama_site_checkpoints?select=label,files&' + U + '&project=eq.' + q(p) + '&id=eq.' + q(id) + '&limit=1'); return r?.length ? { label: r[0].label, files: r[0].files || {} } : null; },
    async list(p) { const r = await rest('pholama_site_checkpoints?select=id,label,created_at&' + U + '&project=eq.' + q(p) + '&order=created_at.desc&limit=30'); return (r || []).map((x: any) => ({ id: x.id, label: x.label, createdAt: Date.parse(x.created_at) || 0 })); },
  };
}

export function makeRuns(rest: Rest, uid: string): RunStore & { remove(id: string): Promise<void>; lease(id: string, ms: number): Promise<boolean> } {
  const U = 'user_id=eq.' + q(uid);
  return {
    async save(run) { await rest('pholama_site_runs?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: run.id, user_id: uid, project: run.project, status: run.status, data: run, updated_at: new Date().toISOString() }) }); },
    async load(id) { const r = await rest('pholama_site_runs?select=data&' + U + '&id=eq.' + q(id) + '&limit=1'); return r?.length ? r[0].data : null; },
    async list(project) { const r = await rest('pholama_site_runs?select=data&' + U + (project ? '&project=eq.' + q(project) : '') + '&order=created_at.desc&limit=100'); return (r || []).map((x: any) => x.data); },
    async remove(id) { await rest('pholama_site_runs?' + U + '&id=eq.' + q(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); },
    // Only one request may advance a run at a time: a lease stored on the run itself, compare-and-set on the update time.
    async lease(id, ms) {
      const r = await rest('pholama_site_runs?select=data,updated_at&' + U + '&id=eq.' + q(id) + '&limit=1'); if (!r?.length) return false;
      const d = r[0].data || {}, until = Number(d.leaseUntil || 0); if (until > Date.now()) return false;
      const upd = await rest('pholama_site_runs?' + U + '&id=eq.' + q(id) + '&updated_at=eq.' + q(r[0].updated_at), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data: { ...d, leaseUntil: Date.now() + ms }, updated_at: new Date().toISOString() }) });
      return Array.isArray(upd) && upd.length === 1;
    },
  };
}

export function makeDbStore(rest: Rest, uid: string) {
  const U = 'user_id=eq.' + q(uid);
  return {
    async load(p: string): Promise<Doc> { const r = await rest('pholama_site_db?select=data&' + U + '&project=eq.' + q(p) + '&limit=1'); return r?.length ? Object.assign(emptyDoc(), r[0].data) : emptyDoc(); },
    async save(p: string, d: Doc) { await rest('pholama_site_db?on_conflict=user_id,project', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: uid, project: p, data: d, updated_at: new Date().toISOString() }) }); },
  };
}
