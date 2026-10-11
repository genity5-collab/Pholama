// Loads the TypeScript cloud core under Node for tests (types are stripped; the logic is plain web-standard JavaScript, same as Deno runs).
const esbuild = require('esbuild'), path = require('path'), fs = require('fs'), os = require('os');
const cache = new Map();
module.exports = async function load(file) {
  const src = path.join(__dirname, '..', '..', 'functions', file);
  if (!cache.has(src)) {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), path.basename(file, '.ts') + '.mjs');
    esbuild.buildSync({ entryPoints: [src], outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent' });
    cache.set(src, import(require('url').pathToFileURL(out).href));
  }
  return cache.get(src);
};
// An in-memory Store + SecretVault that follows the same contract as the Supabase adapter.
module.exports.memory = function memory(core) {
  const projects = new Map(), sec = new Map();
  const store = {
    async hasProject(p) { return projects.has(p); },
    async listProjects() { return [...projects].map(([name, v]) => ({ name, updated: v.updated })); },
    async createProject(p) { projects.set(p, { files: new Map(), updated: Date.now() }); },
    async deleteProject(p) { projects.delete(p); sec.delete(p); },
    async listFiles(p) { const pr = projects.get(p); if (!pr) throw new Error('no such project'); return [...pr.files].map(([name, c]) => ({ name, size: new TextEncoder().encode(c).length })); },
    async getFile(p, f) { const pr = projects.get(p); if (!pr) throw new Error('no such project'); return pr.files.has(f) ? pr.files.get(f) : null; },
    async putFile(p, f, c) { const pr = projects.get(p); if (!pr) throw new Error('no such project'); pr.files.set(f, c); pr.updated = Date.now(); },
    async delFile(p, f) { projects.get(p).files.delete(f); },
    async allFiles(p) { const pr = projects.get(p); if (!pr) throw new Error('no such project'); return Object.fromEntries(pr.files); },
    async replaceFiles(p, files) { const pr = projects.get(p); pr.files = new Map(Object.entries(files)); },
  };
  const secrets = {
    async list(p) { return [...(sec.get(p) || new Map())].map(([name, s]) => ({ name, preview: s.preview, source: s.source })); },
    async set(p, name, value, source) { const n = core.cleanSecretName(name); if (!String(value).trim()) throw new Error('The value is empty.'); if (/[\r\n\0]/.test(value)) throw new Error('A secret value must be on one line.'); if (!sec.has(p)) sec.set(p, new Map()); const m = sec.get(p), has = m.has(n); if (!has && m.size >= core.LIMITS.MAX_SECRETS) throw new Error('A project can hold ' + core.LIMITS.MAX_SECRETS + ' secrets. Delete one first.'); m.set(n, { value, preview: core.maskValue(value), source }); return { name: n, preview: core.maskValue(value), replaced: has }; },
    async remove(p, name) { const m = sec.get(p); return !!m && m.delete(core.cleanSecretName(name)); },
    async values(p) { return Object.fromEntries([...(sec.get(p) || new Map())].map(([k, s]) => [k, s.value])); },
    async scrub(p, text) { let t = String(text ?? ''); for (const [k, v] of Object.entries(await this.values(p))) if (v.length >= 8) t = t.split(v).join('{{secret:' + k + '}}'); return t; },
  };
  return { store, secrets, ctx: { store, secrets } };
};
