// Pholama Studio (website) core. Pure logic: no network, no database. Storage and the AI are injected, so every rule is tested offline.
// Same rules as the PC Studio: small web files, forgiving edits, a broken script is never saved, secrets never reach a file or a model,
// and the optional Pholama Database is set up by the AI only (under 0.01 GB, 10 sign-ins a week then a 4 hour break).

// =============================== files ===============================
export const LIMITS = { MAX_FILE: 400 * 1024, MAX_FILES: 60, MAX_TOTAL: 4 * 1024 * 1024, MAX_PROJECTS: 5, MAX_SECRETS: 10, MAX_DB_BYTES: 10 * 1024 * 1024 };
const OK_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg', '.csv']);
const bytes = (s: string) => new TextEncoder().encode(s).length;

export function projName(s: unknown): string {
  const n = String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  if (!n) throw new Error('give the project a name (letters, numbers, dashes)'); return n;
}
export function fileName(f: unknown): string {
  const s = String(f ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.length > 100 || s.includes('\0') || s.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw new Error('bad file name: ' + s.slice(0, 40));
  if (!/^[A-Za-z0-9_\-./ ]+$/.test(s)) throw new Error('file names may use letters, numbers, dash, underscore, dot');
  const ext = s.includes('.') ? s.slice(s.lastIndexOf('.')).toLowerCase() : '';
  if (!OK_EXT.has(ext)) throw new Error('only ' + [...OK_EXT].join(' ') + ' files are allowed');
  return s;
}

// Storage the core needs. The Supabase adapter and the in-memory test double both implement it.
export interface Store {
  hasProject(p: string): Promise<boolean>;
  listProjects(): Promise<{ name: string; updated: number }[]>;
  createProject(p: string): Promise<void>;
  deleteProject(p: string): Promise<void>;
  listFiles(p: string): Promise<{ name: string; size: number }[]>;
  getFile(p: string, f: string): Promise<string | null>;
  putFile(p: string, f: string, content: string): Promise<void>;
  delFile(p: string, f: string): Promise<void>;
  allFiles(p: string): Promise<Record<string, string>>;
  replaceFiles(p: string, files: Record<string, string>): Promise<void>;
}
export interface Ctx { store: Store; secrets: SecretVault; guard?: (project: string, content: string) => string }

// Does a script parse? Done with the platform's own parser (Function), never run. ESM syntax is not checked (same as the PC).
function jsBroken(name: string, text: string): string {
  if (!/\.m?js$/i.test(name)) return '';
  try { new Function(String(text)); return ''; } catch (e) { const m = String((e as Error).message); return /import|export|await|module/.test(m) ? '' : m; }
}

export async function writeFile(c: Ctx, p: string, f: string, content: string) {
  const name = fileName(f); content = String(content ?? '');
  content = await c.secrets.scrub(p, content);                      // a saved secret can never be written into a project file
  if (bytes(content) > LIMITS.MAX_FILE) throw new Error('file too big (max ' + LIMITS.MAX_FILE / 1024 + ' KB). Split it into smaller files.');
  const files = await c.store.listFiles(p), has = files.some(x => x.name === name);
  if (!has && files.length >= LIMITS.MAX_FILES) throw new Error('too many files (max ' + LIMITS.MAX_FILES + ')');
  const total = files.filter(x => x.name !== name).reduce((n, x) => n + x.size, 0) + bytes(content);
  if (total > LIMITS.MAX_TOTAL) throw new Error('project too big (max ' + LIMITS.MAX_TOTAL / 1048576 + ' MB)');
  await c.store.putFile(p, name, content); return { name, size: bytes(content), created: !has };
}
export async function readFile(c: Ctx, p: string, f: string) { const t = await c.store.getFile(p, fileName(f)); if (t == null) throw new Error('no such file: ' + f); return t; }
export async function deleteFile(c: Ctx, p: string, f: string) { const n = fileName(f); if ((await c.store.getFile(p, n)) == null) throw new Error('no such file: ' + f); await c.store.delFile(p, n); return 'Deleted ' + f; }

async function guardedWrite(c: Ctx, p: string, f: string, before: string, after: string) {
  const was = jsBroken(f, before), now = was ? '' : jsBroken(f, after);
  if (now) throw new Error('That change would break ' + f + ' (' + now + '), so I did not save it and the file is unchanged. Change fewer lines, or copy the exact lines with studio_read_numbered and try again.');
  await writeFile(c, p, f, after);
}

export async function patchFile(c: Ctx, p: string, f: string, find: string, replace: string, all?: boolean) {
  find = String(find ?? ''); if (!find.trim()) throw new Error('"find" text is required');
  const raw = await readFile(c, p, f), crlf = raw.includes('\r\n'), src = raw.replace(/\r\n/g, '\n');
  const rep = String(replace ?? '').replace(/\r\n/g, '\n'), fnd = find.replace(/\r\n/g, '\n'), out = (t: string) => crlf ? t.replace(/\n/g, '\r\n') : t;
  let n = 0; const i = src.indexOf(fnd); if (i >= 0) { let k = -1; while ((k = src.indexOf(fnd, k + 1)) >= 0) n++; }
  if (n > 1 && !all) throw new Error('that text appears ' + n + ' times in ' + f + '. Include more surrounding text so it is unique, or set "all" to true to change every one.');
  if (n >= 1) { await guardedWrite(c, p, f, raw, out(all ? src.split(fnd).join(rep) : src.slice(0, i) + rep + src.slice(i + fnd.length))); return 'Edited ' + f + (all && n > 1 ? ' (' + n + ' places)' : ''); }
  const sl = src.split('\n'), fl = fnd.split('\n').map(x => x.trim()); while (fl.length && !fl[0]) fl.shift(); while (fl.length && !fl[fl.length - 1]) fl.pop();
  const hits: number[] = [];
  if (fl.length) for (let a = 0; a + fl.length <= sl.length; a++) { let ok = true; for (let b = 0; b < fl.length; b++) if (sl[a + b].trim() !== fl[b]) { ok = false; break; } if (ok) hits.push(a); }
  if (!hits.length) throw new Error('the text to replace was not found in ' + f + '. Read the file again (studio_read) and copy the exact lines, or use studio_lines to replace by line number.');
  if (hits.length > 1 && !all) throw new Error('that text appears ' + hits.length + ' times in ' + f + '. Include more surrounding lines so it is unique, or set "all" to true.');
  const mk = (at: number) => { const ind = (k: number) => (sl[at + Math.min(k, fl.length - 1)].match(/^\s*/) || [''])[0]; return rep.split('\n').map((x, k) => x.trim() ? ind(k) + x.replace(/^\s+/, '') : x); };
  for (const a of (all ? hits.slice().reverse() : [hits[0]])) sl.splice(a, fl.length, ...mk(a));
  await guardedWrite(c, p, f, raw, out(sl.join('\n'))); return 'Edited ' + f + ' (matched ignoring spacing)' + (all && hits.length > 1 ? ', ' + hits.length + ' places' : '');
}

export async function editLines(c: Ctx, p: string, f: string, from: unknown, to: unknown, text: unknown) {
  const raw = await readFile(c, p, f), crlf = raw.includes('\r\n'), lines = raw.replace(/\r\n/g, '\n').split('\n');
  const a = Math.floor(+(from as number)); if (!(a >= 1 && a <= lines.length + 1)) throw new Error('"from" must be a line number between 1 and ' + (lines.length + 1) + ' (the file has ' + lines.length + ' lines)');
  const insert = to == null || to === '', b = insert ? a - 1 : Math.floor(+(to as number));
  if (!insert && !(b >= a && b <= lines.length)) throw new Error('"to" must be a line number from ' + a + ' to ' + lines.length);
  const add = text == null || String(text) === '' ? [] : String(text).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  lines.splice(a - 1, insert ? 0 : b - a + 1, ...add);
  const res = lines.join('\n'); await guardedWrite(c, p, f, raw, crlf ? res.replace(/\n/g, '\r\n') : res);
  return (insert ? 'Inserted ' + add.length + ' line(s) before line ' + a : add.length ? 'Replaced lines ' + a + '-' + b + ' with ' + add.length + ' line(s)' : 'Deleted lines ' + a + '-' + b) + ' in ' + f;
}
export async function readNumbered(c: Ctx, p: string, f: string) { const l = (await readFile(c, p, f)).replace(/\r\n/g, '\n').split('\n'), w = String(l.length).length; return l.map((x, k) => String(k + 1).padStart(w) + ' | ' + x).join('\n'); }

export async function createProject(c: Ctx, name: string) {
  const n = projName(name); if (await c.store.hasProject(n)) return { name: n, existed: true };
  if ((await c.store.listProjects()).length >= LIMITS.MAX_PROJECTS) throw new Error('You can have ' + LIMITS.MAX_PROJECTS + ' website projects. Delete one first.');
  await c.store.createProject(n);
  await c.store.putFile(n, 'index.html', `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${n}</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>${n}</h1>\n<script src="script.js"></script>\n</body>\n</html>\n`);
  await c.store.putFile(n, 'style.css', 'body { font-family: system-ui, sans-serif; margin: 2rem; }\n');
  await c.store.putFile(n, 'script.js', `console.log('${n} is running');\n`);
  return { name: n, existed: false };
}

// A project check: broken links, duplicate ids, scripts that do not parse. Pure text work, so it runs anywhere.
export async function check(c: Ctx, p: string): Promise<string[]> {
  const files = await c.store.allFiles(p), names = Object.keys(files), out: string[] = [];
  if (!names.length) return ['The project has no files.'];
  if (!files['index.html']) out.push('There is no index.html, so the preview has nothing to open.');
  for (const [n, t] of Object.entries(files)) {
    const s = jsBroken(n, t); if (s) out.push(n + ': script error: ' + s);
    if (/\.html?$/i.test(n)) {
      const ids = [...t.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]), seen = new Set<string>(); for (const id of ids) { if (seen.has(id)) out.push(n + ': the id "' + id + '" is used more than once.'); seen.add(id); }
      for (const m of t.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)) { const u = m[1]; if (/^(https?:|data:|mailto:|\/\/)/i.test(u)) continue; const base = n.includes('/') ? n.slice(0, n.lastIndexOf('/') + 1) : ''; const target = (u.startsWith('/') ? u.slice(1) : base + u).replace(/^\.\//, ''); if (!names.includes(target)) out.push(n + ': links to "' + u + '" but that file does not exist.'); }
    }
  }
  return out;
}

// =============================== secrets ===============================
// The vault hides the storage: the Supabase adapter seals values; the test double keeps them in memory. The core only needs these.
export interface SecretVault {
  list(p: string): Promise<{ name: string; preview: string; source: string }[]>;
  set(p: string, name: string, value: string, source: 'manual' | 'detected'): Promise<{ name: string; preview: string; replaced: boolean }>;
  remove(p: string, name: string): Promise<boolean>;
  values(p: string): Promise<Record<string, string>>;
  scrub(p: string, text: string): Promise<string>;
}
export const cleanSecretName = (n: unknown) => {
  const s = String(n ?? '').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  if (!s || s.length > 48 || /^[0-9]/.test(s)) throw new Error('A secret name uses letters, numbers and underscores, and starts with a letter (like OPENAI_API_KEY).');
  if (/^(PATH|HOME|USER|SHELL|PWD|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|PORT)$/.test(s)) throw new Error('That name is used by the system. Pick another.'); return s;
};
const KNOWN: { name: string; re: RegExp }[] = [
  { name: 'GITHUB_TOKEN', re: /\b(gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g },
  { name: 'ANTHROPIC_API_KEY', re: /\bsk-ant-[A-Za-z0-9_\-]{30,200}\b/g },
  { name: 'OPENAI_API_KEY', re: /\bsk-(?:proj-|live-)?[A-Za-z0-9_\-]{32,200}\b/g },
  { name: 'GROQ_API_KEY', re: /\bgsk_[A-Za-z0-9]{40,100}\b/g },
  { name: 'RESEND_API_KEY', re: /\bre_[A-Za-z0-9_]{20,100}\b/g },
  { name: 'STRIPE_SECRET_KEY', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,120}\b/g },
  { name: 'GOOGLE_API_KEY', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: 'AWS_ACCESS_KEY_ID', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'SLACK_TOKEN', re: /\bxox[abprs]-[A-Za-z0-9-]{20,200}\b/g },
  { name: 'DISCORD_BOT_TOKEN', re: /\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/g },
  { name: 'SUPABASE_SERVICE_KEY', re: /\bsb_secret_[A-Za-z0-9_\-]{20,120}\b/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];
const WORD = '(?:API[_-]?KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|CLIENT[_-]?SECRET|CREDENTIAL)';
const NAMED = () => new RegExp('(^|[\\s;,{(\\[])["\'`]?([A-Za-z][A-Za-z0-9_-]*?' + WORD + '[A-Za-z0-9_-]*|' + WORD + '[A-Za-z0-9_-]*)["\'`]?\\s*(?:=|:)\\s*["\'`]?([^\\s"\'`<>,;]{8,})', 'gim');
const SAID = () => new RegExp('\\b((?:my|the|our)\\s+(?:[a-z]+\\s+)?(?:password|passcode|api\\s?key|token|secret(?:\\s?key)?))\\s+(?:is|=|:)\\s+["\'`]?([^\\s"\'`<>,;]{8,})', 'gi');
const PLACEHOLDER = /^(your[_-]?|xxx+|\*+|<|\{\{|\$\{|process\.env|example|changeme|todo|placeholder|insert|none|null|undefined|true|false)/i;
const CODEISH = (v: string) => /[()\[\]]/.test(v) || /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(v) || /^(get|set|fetch|read|load|create|make|new)[A-Z]/.test(v);
export const maskValue = (v: string) => v.length <= 8 ? '••••' : v.slice(0, 3) + '••••' + v.slice(-2);

export function scanSecrets(text: string) {
  const src = String(text ?? ''), found: { at: number; end: number; value: string; name: string }[] = [], taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  for (const k of KNOWN) { const re = new RegExp(k.re.source, 'g'); let m: RegExpExecArray | null; while ((m = re.exec(src))) { const a = m.index, b = a + m[0].length; if (free(a, b)) { taken.push([a, b]); found.push({ at: a, end: b, value: m[0], name: k.name }); } } }
  const take = (m: RegExpExecArray, value: string, rawName: string) => {
    if (PLACEHOLDER.test(value) || CODEISH(value) || (/^[A-Za-z]+$/.test(value) && value.length < 12)) return;
    const a = m.index + m[0].lastIndexOf(value), b = a + value.length; if (!free(a, b)) return;
    let nm: string; try { nm = cleanSecretName(String(rawName).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\s+/g, '_')); } catch { return; }
    taken.push([a, b]); found.push({ at: a, end: b, value, name: nm });
  };
  let m: RegExpExecArray | null; const n = NAMED(); while ((m = n.exec(src))) take(m, m[3], m[2]);
  const s = SAID(); while ((m = s.exec(src))) take(m, m[2], m[1].replace(/^(my|the|our)\s+/i, ''));
  found.sort((x, y) => x.at - y.at);
  const used = new Map<string, string>(); let out = '', last = 0;
  for (const f of found) { let nm = f.name, i = 2; while (used.has(nm) && used.get(nm) !== f.value) nm = f.name + '_' + i++; used.set(nm, f.value); f.name = nm; out += src.slice(last, f.at) + '{{secret:' + nm + '}}'; last = f.end; }
  return { found: found.map(f => ({ name: f.name, value: f.value })), redacted: out + src.slice(last) };
}
// A pasted message is saved and cleaned BEFORE it is stored or sent to a model. Past the limit nothing is left in the open.
export async function protectMessage(vault: SecretVault, project: string, text: string) {
  const s = scanSecrets(text); if (!s.found.length) return { text: String(text ?? ''), saved: [] as { name: string; preview: string }[], dropped: [] as { name: string; why: string }[], notice: '' };
  const saved: { name: string; preview: string }[] = [], dropped: { name: string; why: string }[] = []; let out = s.redacted;
  for (const f of s.found) { try { const r = await vault.set(project, f.name, f.value, 'detected'); saved.push({ name: r.name, preview: r.preview }); } catch (e) { dropped.push({ name: f.name, why: String((e as Error).message) }); out = out.split('{{secret:' + f.name + '}}').join('[secret removed: ' + f.name + ']'); } }
  const notice = [saved.length ? 'Saved ' + saved.length + ' secret' + (saved.length > 1 ? 's' : '') + ' for this project (' + saved.map(x => x.name).join(', ') + '). The value was removed from your message and is never shown to the AI.' : '', dropped.length ? dropped.length + ' more could not be saved (' + dropped.map(x => x.why).join('; ') + '), and was removed from your message.' : ''].filter(Boolean).join(' ');
  return { text: out, saved, dropped, notice };
}
