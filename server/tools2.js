// Real tools a capable local AI can use. All file tools stay inside ONE folder (~/.pholama/workspace), nothing outside it can be read or changed.
// Zero dependencies. These are local and free (no credits).
const fs = require('fs'), os = require('os'), path = require('path');

const ROOT = process.env.PHOLAMA_WORKSPACE || path.join(os.homedir(), '.pholama', 'workspace');
const MAX_READ = 24000, MAX_WRITE = 200000, MAX_FILES = 400;

function ensure() { fs.mkdirSync(ROOT, { recursive: true }); return ROOT; }
// Resolve a name inside the workspace. Rejects .., absolute paths, drive letters and links that lead outside.
function safe(rel) {
  const r = String(rel == null ? '' : rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (r.includes('\0') || r.split('/').some(p => p === '..')) throw new Error('that path is not allowed');
  if (/^[a-zA-Z]:/.test(r)) throw new Error('use a path inside the workspace, not a drive letter');
  const base = ensure(), full = path.resolve(base, r);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('that path is outside the workspace');
  try { const real = fs.realpathSync(fs.existsSync(full) ? full : path.dirname(full)); const rb = fs.realpathSync(base); if (real !== rb && !real.startsWith(rb + path.sep)) throw new Error('that path leads outside the workspace'); } catch (e) { if (/outside/.test(e.message)) throw e; }
  return full;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/') || '.';
function walk(dir, out, depth = 0) {
  if (out.length >= MAX_FILES || depth > 6) return;
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.push({ p, dir: true }); walk(p, out, depth + 1); } else if (e.isFile()) out.push({ p, dir: false });
    if (out.length >= MAX_FILES) return;
  }
}
const isText = buf => { const n = Math.min(buf.length, 2000); for (let i = 0; i < n; i++) if (buf[i] === 0) return false; return true; };

const TOOLS = {
  list_files: { desc: 'List files and folders in the workspace folder. args: {"path": string (optional folder, default the top)}', run(a) {
    const d = safe(a.path || ''); if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new Error('folder not found');
    const out = []; walk(d, out); if (!out.length) return 'The folder is empty. The workspace is ' + ROOT;
    return out.map(x => rel(x.p) + (x.dir ? '/' : ' (' + fs.statSync(x.p).size + ' bytes)')).join('\n') + (out.length >= MAX_FILES ? '\n(list cut at ' + MAX_FILES + ')' : '');
  } },
  read_file: { desc: 'Read a text file from the workspace. args: {"path": string, "start": number (optional first line), "end": number (optional last line)}', run(a) {
    const f = safe(a.path); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('file not found: ' + a.path);
    const buf = fs.readFileSync(f); if (!isText(buf)) throw new Error('that is not a text file');
    let lines = buf.toString('utf8').split('\n'); const total = lines.length;
    const s = Math.max(1, +a.start || 1), e = Math.min(total, +a.end || total);
    let t = lines.slice(s - 1, e).map((l, i) => (s + i) + ': ' + l).join('\n');
    if (t.length > MAX_READ) t = t.slice(0, MAX_READ) + '\n(cut: ask for a smaller line range)';
    return t + '\n(' + total + ' lines in ' + rel(f) + ')';
  } },
  write_file: { desc: 'Create or replace a text file in the workspace (folders are created). args: {"path": string, "content": string}', run(a) {
    const f = safe(a.path), c = String(a.content == null ? '' : a.content);
    if (Buffer.byteLength(c) > MAX_WRITE) throw new Error('file too big (max ' + MAX_WRITE + ' bytes)');
    if (/\.(exe|bat|cmd|com|scr|msi|dll|vbs|hta|ps1|lnk)$/i.test(f)) throw new Error('that file type is not allowed');
    fs.mkdirSync(path.dirname(f), { recursive: true }); const had = fs.existsSync(f); fs.writeFileSync(f, c);
    return (had ? 'Replaced ' : 'Created ') + rel(f) + ' (' + Buffer.byteLength(c) + ' bytes)';
  } },
  append_file: { desc: 'Add text to the end of a workspace file (created if missing). args: {"path": string, "content": string}', run(a) {
    const f = safe(a.path), c = String(a.content == null ? '' : a.content);
    if (/\.(exe|bat|cmd|com|scr|msi|dll|vbs|hta|ps1|lnk)$/i.test(f)) throw new Error('that file type is not allowed');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size + Buffer.byteLength(c) > MAX_WRITE) throw new Error('file would get too big');
    fs.appendFileSync(f, c); return 'Added ' + Buffer.byteLength(c) + ' bytes to ' + rel(f);
  } },
  edit_file: { desc: 'Replace exact text in a workspace file. args: {"path": string, "find": string, "replace": string}. "find" must appear exactly once.', run(a) {
    const f = safe(a.path); if (!fs.existsSync(f)) throw new Error('file not found: ' + a.path);
    const t = fs.readFileSync(f, 'utf8'), find = String(a.find == null ? '' : a.find); if (!find) throw new Error('"find" is empty');
    const n = t.split(find).length - 1; if (n === 0) throw new Error('text not found. Use read_file and copy the exact text.'); if (n > 1) throw new Error('text appears ' + n + ' times. Add more surrounding text so it is unique.');
    fs.writeFileSync(f, t.replace(find, () => String(a.replace == null ? '' : a.replace))); return 'Edited ' + rel(f);
  } },
  search_files: { desc: 'Find text inside workspace files. args: {"query": string, "path": string (optional folder)}', run(a) {
    const q = String(a.query || '').toLowerCase(); if (!q) throw new Error('"query" is empty');
    const out = []; walk(safe(a.path || ''), out); const hits = [];
    for (const x of out) { if (x.dir) continue; let b; try { if (fs.statSync(x.p).size > 400000) continue; b = fs.readFileSync(x.p); } catch { continue; } if (!isText(b)) continue;
      b.toString('utf8').split('\n').forEach((l, i) => { if (hits.length < 40 && l.toLowerCase().includes(q)) hits.push(rel(x.p) + ':' + (i + 1) + ': ' + l.trim().slice(0, 160)); }); }
    return hits.length ? hits.join('\n') : 'No matches.';
  } },
  make_folder: { desc: 'Create a folder in the workspace. args: {"path": string}', run(a) { const f = safe(a.path); fs.mkdirSync(f, { recursive: true }); return 'Folder ready: ' + rel(f); } },
  delete_file: { desc: 'Delete ONE file from the workspace (not folders). args: {"path": string}', run(a) {
    const f = safe(a.path); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('file not found'); fs.unlinkSync(f); return 'Deleted ' + rel(f);
  } },
  json_tool: { desc: 'Check and pretty-print JSON, or read one value from it. args: {"text": string, "path": string (optional, like "a.b.0.c")}', run(a) {
    let j; try { j = JSON.parse(String(a.text || '')); } catch (e) { throw new Error('not valid JSON: ' + e.message); }
    if (a.path) { let v = j; for (const k of String(a.path).split('.').filter(Boolean)) { if (v == null) break; v = v[k]; } return v === undefined ? 'not found' : JSON.stringify(v, null, 2); }
    return JSON.stringify(j, null, 2).slice(0, 6000);
  } },
  text_stats: { desc: 'Count words, lines and characters, and list the most common words. args: {"text": string}', run(a) {
    const t = String(a.text || ''), w = t.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [], c = {};
    for (const x of w) if (x.length > 3) c[x] = (c[x] || 0) + 1;
    return `${w.length} words, ${t.split('\n').length} lines, ${t.length} characters. Common: ` + (Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => k + '(' + v + ')').join(', ') || 'none');
  } },
  convert_units: { desc: 'Convert a number between units (length, weight, temperature, data size, time). args: {"value": number, "from": string, "to": string}', run(a) {
    const v = +a.value, f = String(a.from || '').toLowerCase(), t = String(a.to || '').toLowerCase(); if (!isFinite(v)) throw new Error('"value" must be a number');
    const T = { c: x => x, celsius: x => x, f: x => (x - 32) * 5 / 9, fahrenheit: x => (x - 32) * 5 / 9, k: x => x - 273.15, kelvin: x => x - 273.15 };
    const Tb = { c: x => x, celsius: x => x, f: x => x * 9 / 5 + 32, fahrenheit: x => x * 9 / 5 + 32, k: x => x + 273.15, kelvin: x => x + 273.15 };
    if (T[f] && Tb[t]) return (+Tb[t](T[f](v)).toFixed(4)) + ' ' + t;
    const U = { mm: ['l', .001], cm: ['l', .01], m: ['l', 1], km: ['l', 1000], in: ['l', .0254], ft: ['l', .3048], yd: ['l', .9144], mi: ['l', 1609.344], mg: ['w', 1e-6], g: ['w', .001], kg: ['w', 1], lb: ['w', .45359237], oz: ['w', .028349523], b: ['d', 1], kb: ['d', 1024], mb: ['d', 1048576], gb: ['d', 1073741824], tb: ['d', 1099511627776], s: ['t', 1], min: ['t', 60], h: ['t', 3600], day: ['t', 86400], week: ['t', 604800] };
    if (!U[f] || !U[t] || U[f][0] !== U[t][0]) throw new Error('cannot convert ' + f + ' to ' + t); return (+(v * U[f][1] / U[t][1]).toFixed(6)) + ' ' + t;
  } },
  hash_text: { desc: 'Get a SHA-256 hash of some text. args: {"text": string}', run(a) { return require('crypto').createHash('sha256').update(String(a.text || '')).digest('hex'); } },
  random_number: { desc: 'Pick random whole numbers. args: {"min": number, "max": number, "count": number (optional, default 1)}', run(a) {
    const lo = Math.ceil(+a.min || 1), hi = Math.floor(+a.max || 100), n = Math.min(Math.max(+a.count || 1, 1), 50); if (hi < lo) throw new Error('"max" must be at least "min"');
    return Array.from({ length: n }, () => lo + Math.floor(Math.random() * (hi - lo + 1))).join(', ');
  } },
  system_info: { desc: 'Show this PC\'s basic facts: system, memory, processor count, free disk is not shown. args: {}', run() {
    return `System: ${os.type()} ${os.release()} (${os.arch()}). Memory: ${(os.totalmem() / 1073741824).toFixed(1)} GB total, ${(os.freemem() / 1073741824).toFixed(1)} GB free. Processors: ${os.cpus().length}. Workspace folder: ${ROOT}`;
  } }
};
const NAMES = Object.keys(TOOLS);
const isTool2 = n => Object.prototype.hasOwnProperty.call(TOOLS, n);
const tools = () => NAMES.map(name => ({ name, desc: TOOLS[name].desc, kind: 'local' }));
function run(name, args) { if (!isTool2(name)) throw new Error('unknown tool ' + name); const a = args && typeof args === 'object' ? args : {}; return String(TOOLS[name].run(a)); }

module.exports = { ROOT, NAMES, isTool2, tools, run, safe };
