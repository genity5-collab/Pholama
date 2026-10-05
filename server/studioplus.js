// Studio extras: folders, images, a project map for research, more tools, and the publish check.
// Kept apart from studio.js so the proven file layer stays untouched. Everything stays inside ~/.pholama/studio/<project>/.
'use strict';
const fs = require('fs'), path = require('path');
const stu = require('./studio');

const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE = 1024 * 1024;          // one picture: 1 MB
const MAX_IMAGES = 20;                   // per project
const MAX_DIRS = 30;                     // folders per project
const MAX_DEPTH = 4;
const isImageName = n => Object.prototype.hasOwnProperty.call(IMG_EXT, path.extname(String(n || '')).toLowerCase());

// A picture must really be one: the first bytes decide, not the file name. A text file renamed .png is refused.
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
function imageSize(buf) {   // width and height straight from the header, no library
  try {
    const t = sniffImage(buf);
    if (t === 'image/png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (t === 'image/gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (t === 'image/jpeg') { let i = 2; while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); } }
    if (t === 'image/webp') { const k = buf.slice(12, 16).toString('latin1'); if (k === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }; if (k === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }; if (k === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; } }
  } catch {}
  return null;
}

// Paths inside a project: letters, numbers, dash, underscore, dot, space. No dot-folders, no "..", bounded depth.
function relPath(f) {
  f = String(f == null ? '' : f).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!f || f.length > 100 || f.includes('\0') || f.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw new Error('bad path: ' + String(f).slice(0, 40));
  if (!/^[A-Za-z0-9_\-./ ]+$/.test(f)) throw new Error('names may use letters, numbers, dash, underscore, dot');
  if (f.split('/').length > MAX_DEPTH + 1) throw new Error('folders can go at most ' + MAX_DEPTH + ' deep');
  return f;
}
const projDir = p => { const d = path.join(stu.ROOT, stu.projName(p)); if (path.relative(stu.ROOT, d).startsWith('..')) throw new Error('bad project'); return d; };
const inside = (p, f) => { const d = projDir(p), full = path.join(d, relPath(f)); if (path.relative(d, full).startsWith('..') || full === d) throw new Error('bad path'); return full; };

function walkAll(d, base = d, out = { files: [], dirs: [] }) {   // files and folders, never following links
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const f = path.join(d, e.name), rel = path.relative(base, f).split(path.sep).join('/');
    if (e.isDirectory()) { out.dirs.push(rel); walkAll(f, base, out); } else out.files.push({ name: rel, size: fs.statSync(f).size, image: isImageName(rel) });
  }
  return out;
}

// ---------- folders ----------
function mkdir(p, dir) {
  const full = inside(p, dir); if (fs.existsSync(full)) return { name: relPath(dir), existed: true };
  if (walkAll(projDir(p)).dirs.length >= MAX_DIRS) throw new Error('too many folders (max ' + MAX_DIRS + ')');
  fs.mkdirSync(full, { recursive: true }); return { name: relPath(dir), existed: false };
}
function rmdir(p, dir) {
  const full = inside(p, dir); if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new Error('no such folder: ' + dir);
  const n = walkAll(full).files.length; fs.rmSync(full, { recursive: true, force: true }); return 'Deleted folder ' + relPath(dir) + (n ? ' and its ' + n + ' file' + (n > 1 ? 's' : '') : '');
}
// Move or rename a file or a whole folder. Never overwrites: the target must not exist.
function move(p, from, to) {
  const a = inside(p, from), b = inside(p, to);
  if (!fs.existsSync(a)) throw new Error('nothing at ' + from);
  if (fs.existsSync(b)) throw new Error(relPath(to) + ' already exists');
  if (b.startsWith(a + path.sep)) throw new Error('cannot move a folder into itself');
  if (!fs.statSync(a).isDirectory()) { const ext = path.extname(relPath(to)).toLowerCase(); if (!isImageName(to) && !stu.fileName(to)) throw new Error('bad target'); if (path.extname(relPath(from)).toLowerCase() !== ext) throw new Error('keep the same file type (' + path.extname(from) + ')'); }
  fs.mkdirSync(path.dirname(b), { recursive: true }); fs.renameSync(a, b); return 'Moved ' + relPath(from) + ' to ' + relPath(to);
}
function copy(p, from, to) {
  const a = inside(p, from), b = inside(p, to);
  if (!fs.existsSync(a) || fs.statSync(a).isDirectory()) throw new Error('copy works on one file: ' + from);
  if (fs.existsSync(b)) throw new Error(relPath(to) + ' already exists');
  if (path.extname(relPath(from)).toLowerCase() !== path.extname(relPath(to)).toLowerCase()) throw new Error('keep the same file type');
  if (walkAll(projDir(p)).files.length >= stu.LIMITS.MAX_FILES + MAX_IMAGES) throw new Error('too many files');
  fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); return 'Copied ' + relPath(from) + ' to ' + relPath(to);
}

// ---------- images ----------
function saveImage(p, name, dataBase64) {
  name = relPath(name); if (!isImageName(name)) throw new Error('pictures must be .png .jpg .jpeg .gif or .webp');
  const b64 = String(dataBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length < 16) throw new Error('that is not picture data');
  if (b64.length > MAX_IMAGE * 1.4) throw new Error('picture too big (max ' + (MAX_IMAGE / 1048576) + ' MB). Shrink it first.');
  const buf = Buffer.from(b64, 'base64'); if (buf.length > MAX_IMAGE) throw new Error('picture too big (max ' + (MAX_IMAGE / 1048576) + ' MB). Shrink it first.');
  const real = sniffImage(buf); if (!real) throw new Error('that file is not a real picture (png, jpg, gif or webp)');
  const want = IMG_EXT[path.extname(name).toLowerCase()]; if (real !== want) throw new Error('the name says ' + want.split('/')[1] + ' but the picture is ' + real.split('/')[1] + '. Rename it to match.');
  const d = projDir(p); if (!fs.existsSync(d)) throw new Error('no such project');
  const all = walkAll(d), full = inside(p, name), had = fs.existsSync(full);
  if (!had && all.files.filter(f => f.image).length >= MAX_IMAGES) throw new Error('too many pictures (max ' + MAX_IMAGES + ')');
  const total = all.files.filter(f => f.name !== name).reduce((n, f) => n + f.size, 0) + buf.length;
  if (total > stu.LIMITS.MAX_TOTAL + MAX_IMAGES * MAX_IMAGE) throw new Error('project too big');
  fs.mkdirSync(path.dirname(full), { recursive: true }); const tmp = full + '.tmp' + process.pid; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, full);
  return { name, size: buf.length, type: real, created: !had, ...(imageSize(buf) || {}) };
}
function readImage(p, name) {
  name = relPath(name); if (!isImageName(name)) throw new Error('not a picture');
  const full = inside(p, name); if (!fs.existsSync(full)) throw new Error('no such picture: ' + name);
  const buf = fs.readFileSync(full), type = sniffImage(buf); if (!type) throw new Error('damaged picture');
  return { name, type, size: buf.length, data: buf.toString('base64'), ...(imageSize(buf) || {}) };
}
function imageInfo(p, name) { const r = readImage(p, name); return `${r.name}: ${r.type.split('/')[1]}, ${r.w || '?'}x${r.h || '?'} px, ${r.size} bytes`; }

// ---------- the project map: what the AI reads FIRST so even Max (which cannot see the files) works from the real project ----------
function outlineOf(name, text) {
  const out = [], t = String(text || '');
  if (/\.html?$/i.test(name)) {
    const title = /<title[^>]*>([^<]*)/i.exec(t); if (title && title[1].trim()) out.push('title: ' + title[1].trim().slice(0, 60));
    const ids = [...t.matchAll(/\bid=["']([^"']+)["']/gi)].map(m => '#' + m[1]); if (ids.length) out.push('ids: ' + ids.slice(0, 14).join(' ') + (ids.length > 14 ? ' …+' + (ids.length - 14) : ''));
    const links = [...t.matchAll(/(?:src|href)=["']([^"':#?][^"']*)["']/gi)].map(m => m[1]); if (links.length) out.push('uses: ' + [...new Set(links)].slice(0, 8).join(', '));
  } else if (/\.css$/i.test(name)) {
    const sel = [...t.matchAll(/(^|\})\s*([.#]?[A-Za-z][\w\-.#:\s>,+~]*?)\s*\{/g)].map(m => m[2].trim().replace(/\s+/g, ' ')).filter(Boolean); if (sel.length) out.push('rules: ' + sel.slice(0, 12).join(' | ') + (sel.length > 12 ? ' …+' + (sel.length - 12) : ''));
  } else if (/\.m?js$/i.test(name)) {
    const fn = [...t.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)].map(m => m[1] || m[2]); if (fn.length) out.push('functions: ' + [...new Set(fn)].slice(0, 16).join(', '));
    const ev = [...t.matchAll(/addEventListener\(\s*["'](\w+)["']/g)].map(m => m[1]); if (ev.length) out.push('events: ' + [...new Set(ev)].join(', '));
    const ids = [...t.matchAll(/getElementById\(\s*["']([^"']+)["']/g)].map(m => '#' + m[1]); if (ids.length) out.push('reads: ' + [...new Set(ids)].slice(0, 10).join(' '));
  } else if (/\.json$/i.test(name)) { try { const j = JSON.parse(t); out.push('json ' + (Array.isArray(j) ? 'list of ' + j.length : 'keys: ' + Object.keys(j).slice(0, 10).join(', '))); } catch { out.push('json (does not parse)'); } }
  else if (/\.(md|txt|csv)$/i.test(name)) out.push(t.split(/\r?\n/).find(l => l.trim())?.slice(0, 80) || '(empty)');
  return out;
}
function textFiles(p) {   // every text file with its content (pictures are left out: they are not text)
  const d = projDir(p); if (!fs.existsSync(d)) throw new Error('no such project');
  return walkAll(d).files.filter(f => !f.image).map(f => { let c = ''; try { c = fs.readFileSync(path.join(d, f.name), 'utf8'); } catch {} return { name: f.name, size: f.size, content: c }; });
}
function tree(p) {
  const d = projDir(p); if (!fs.existsSync(d)) throw new Error('no such project');
  const all = walkAll(d), lines = [], byDir = new Map();
  for (const f of all.files) { const dir = path.posix.dirname(f.name); (byDir.get(dir === '.' ? '' : dir) || byDir.set(dir === '.' ? '' : dir, []).get(dir === '.' ? '' : dir)).push(f); }
  for (const dd of all.dirs) if (!byDir.has(dd)) byDir.set(dd, []);
  const dirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b));
  for (const dir of dirs) { if (dir) lines.push(dir + '/'); for (const f of byDir.get(dir).sort((a, b) => a.name.localeCompare(b.name))) lines.push((dir ? '  ' : '') + path.posix.basename(f.name) + (f.image ? '  [picture]' : '') + '  (' + f.size + ' B)'); }
  return lines.join('\n') || '(empty project)';
}
// The map the AI reads before it acts. Short on purpose: a small model's context is tiny and Max is charged per message.
function projectMap(p, maxChars = 2600) {
  const files = textFiles(p), all = walkAll(projDir(p)), lines = [`PROJECT "${stu.projName(p)}": ${all.files.length} files, ${all.dirs.length} folders`];
  lines.push(tree(p).split('\n').slice(0, 40).join('\n'));
  for (const f of files) { const o = outlineOf(f.name, f.content); if (o.length) lines.push('• ' + f.name + ' — ' + o.join('; ')); }
  const issues = stu.check(p).filter(x => x !== 'No problems found.'); lines.push(issues.length ? 'KNOWN PROBLEMS:\n' + issues.slice(0, 6).map(x => '- ' + x).join('\n') : 'No known problems.');
  let s = lines.join('\n'); if (s.length > maxChars) s = s.slice(0, maxChars - 20) + '\n…(map shortened)'; return s;
}
function searchText(p, query, limit = 30) {
  const q = String(query || '').trim().toLowerCase(); if (q.length < 2) throw new Error('search for at least 2 characters');
  const hits = [];
  for (const f of textFiles(p)) { const ls = f.content.split(/\r?\n/); for (let i = 0; i < ls.length && hits.length < limit; i++) if (ls[i].toLowerCase().includes(q)) hits.push(`${f.name}:${i + 1}: ${ls[i].trim().slice(0, 160)}`); if (hits.length >= limit) break; }
  return hits.length ? hits.join('\n') : 'No matches for "' + query + '".';
}
function outlineOne(p, file) { const full = inside(p, file); if (!fs.existsSync(full)) throw new Error('no such file: ' + file); if (isImageName(file)) return imageInfo(p, file); const o = outlineOf(file, fs.readFileSync(full, 'utf8')); return o.length ? o.join('\n') : '(nothing to outline in ' + file + ')'; }

// A to-do list the AI keeps for a project (so a long job survives across messages). Stored as a plain text file the user can read too.
const TODO = 'TODO.md';
function todoRead(p) { const full = path.join(projDir(p), TODO); return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : ''; }
function todoWrite(p, items) {
  const list = (Array.isArray(items) ? items : String(items || '').split('\n')).map(x => String(x).trim()).filter(Boolean).slice(0, 30);
  if (!list.length) throw new Error('give at least one task');
  const text = '# To do\n\n' + list.map(x => /^- \[[ x]\]/.test(x) ? x : '- [ ] ' + x).join('\n') + '\n';
  return stu.writeFile(p, TODO, text);
}

// ---------- publish check: small honest steps, each one is really computed (nothing is faked) ----------
function verify(p) {
  const steps = [], files = textFiles(p), names = new Set(files.map(f => f.name));
  const add = (id, title, status, detail) => steps.push({ id, title, status, detail });   // status: ok | warn | fail
  add('files', 'Project has files', files.length ? 'ok' : 'fail', files.length ? files.length + ' text file' + (files.length > 1 ? 's' : '') : 'The project is empty');
  const entry = files.find(f => /^index\.html?$/i.test(f.name));
  add('entry', 'Has an index.html start page', entry ? 'ok' : 'fail', entry ? 'index.html found' : 'Add an index.html so visitors see something');
  const issues = files.length ? stu.check(p).filter(x => x !== 'No problems found.') : [];
  const broken = issues.filter(x => /does not exist/.test(x));
  add('links', 'Every linked file exists', broken.length ? 'fail' : 'ok', broken.length ? broken.slice(0, 3).join('; ') : 'All links and scripts resolve');
  const js = issues.filter(x => /^[^ ]+\.m?js: /.test(x));
  add('scripts', 'Scripts have no syntax errors', js.length ? 'fail' : 'ok', js.length ? js.slice(0, 3).join('; ') : 'Every script parses');
  const other = issues.filter(x => !broken.includes(x) && !js.includes(x));
  add('page', 'Page structure looks right', other.length ? 'warn' : 'ok', other.length ? other.slice(0, 3).join('; ') : 'No duplicate ids, scripts find their elements');
  const html = files.filter(f => /\.html?$/i.test(f.name)).map(f => f.content).join('\n');
  const lonely = []; for (const i of walkAll(projDir(p)).files.filter(f => f.image)) if (!files.some(f => f.content.includes(path.posix.basename(i.name)))) lonely.push(i.name);
  add('pictures', 'Pictures are used', lonely.length ? 'warn' : 'ok', lonely.length ? 'Not used anywhere: ' + lonely.slice(0, 3).join(', ') : 'Every picture is referenced (or there are none)');
  const secret = []; for (const f of files) if (/\b(sk-or-v1-|gsk_|sbp_|ghp_|github_pat_|AKIA)[A-Za-z0-9_\-]{8,}/.test(f.content)) secret.push(f.name);
  add('secrets', 'No secret keys inside the files', secret.length ? 'fail' : 'ok', secret.length ? 'Looks like a key in: ' + secret.join(', ') + '. Remove it before publishing' : 'No API keys or tokens found');
  const big = files.filter(f => f.size > 200 * 1024).map(f => f.name); add('size', 'Files are a sensible size', big.length ? 'warn' : 'ok', big.length ? 'Large: ' + big.join(', ') : 'All files are small');
  const alt = /<img\b(?![^>]*\balt=)[^>]*>/i.test(html); add('access', 'Pictures have alt text', alt ? 'warn' : 'ok', alt ? 'Some <img> tags have no alt text' : 'Good');
  const fail = steps.filter(s => s.status === 'fail').length, warn = steps.filter(s => s.status === 'warn').length;
  return { project: stu.projName(p), steps, fail, warn, pass: fail === 0, summary: fail ? fail + ' problem' + (fail > 1 ? 's' : '') + ' to fix before publishing' : warn ? 'Ready, with ' + warn + ' thing' + (warn > 1 ? 's' : '') + ' worth a look' : 'All checks passed. Ready to publish' };
}

// ---------- tools the AI can call ----------
const TOOLS = {
  studio_map: { desc: 'READ THIS FIRST. A short map of the project: folders, files, what each file contains (functions, ids, rules) and known problems. args: {"project": string}', run: a => projectMap(a.project) },
  studio_tree: { desc: 'Show the folders and files of a project as a tree. args: {"project": string}', run: a => tree(a.project) },
  studio_outline: { desc: 'What one file contains (functions, ids, css rules) without reading all of it. args: {"project": string, "file": string}', run: a => outlineOne(a.project, a.file) },
  studio_search: { desc: 'Find text in every file of the project, with file and line. args: {"project": string, "query": string}', run: a => searchText(a.project, a.query) },
  studio_mkdir: { desc: 'Make a folder. args: {"project": string, "folder": string}', run: a => { const r = mkdir(a.project, a.folder); return (r.existed ? 'Folder already exists: ' : 'Made folder ') + r.name; } },
  studio_rmdir: { desc: 'Delete a folder and everything in it. args: {"project": string, "folder": string}', run: a => rmdir(a.project, a.folder) },
  studio_move: { desc: 'Move or rename a file or folder (never overwrites). args: {"project": string, "from": string, "to": string}', run: a => move(a.project, a.from, a.to) },
  studio_copy: { desc: 'Copy one file to a new name (never overwrites). args: {"project": string, "from": string, "to": string}', run: a => copy(a.project, a.from, a.to) },
  studio_image_info: { desc: 'Size and type of a picture in the project. args: {"project": string, "file": string}', run: a => imageInfo(a.project, a.file) },
  studio_todo: { desc: 'Save a to-do list for a long job (kept in TODO.md). args: {"project": string, "tasks": [string, ...]}', run: a => { const r = todoWrite(a.project, a.tasks); return 'Saved ' + r.name; } },
  studio_verify: { desc: 'Run the pre-publish check and list what passes and what to fix. args: {"project": string}', run: a => { const v = verify(a.project); return v.steps.map(s => (s.status === 'ok' ? 'OK   ' : s.status === 'warn' ? 'WARN ' : 'FAIL ') + s.title + ' - ' + s.detail).join('\n') + '\n' + v.summary; } },
};
const tools = () => Object.entries(TOOLS).map(([name, t]) => ({ name, desc: t.desc, kind: 'studio' }));
const isPlus = n => Object.prototype.hasOwnProperty.call(TOOLS, n);
const run = (name, args) => { if (!isPlus(name)) throw new Error('unknown studio tool'); return TOOLS[name].run(args && typeof args === 'object' ? args : {}); };

module.exports = { tools, isPlus, run, mkdir, rmdir, move, copy, saveImage, readImage, imageInfo, sniffImage, imageSize, isImageName, relPath, walkAll, tree, projectMap, outlineOf, outlineOne, searchText, textFiles, todoRead, todoWrite, verify, LIMITS: { MAX_IMAGE, MAX_IMAGES, MAX_DIRS, MAX_DEPTH } };
