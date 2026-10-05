// Pholama Studio: projects of small web files (HTML / CSS / JS / text) that the AI and the user edit together.
// Everything lives in ~/.pholama/studio/<project>/. Nothing leaves the PC unless the user approves a publish.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');

const ROOT = process.env.PHOLAMA_STUDIO || path.join(os.homedir(), '.pholama', 'studio');
const MAX_FILE = 400 * 1024;        // one file
const MAX_FILES = 60;               // per project
const MAX_PROJECTS = 100;
const MAX_TOTAL = 4 * 1024 * 1024;  // whole project
const OK_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg', '.csv']);

const projName = s => { s = String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60); if (!s) throw new Error('give the project a name (letters, numbers, dashes)'); return s; };
function fileName(f) {
  f = String(f == null ? '' : f).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!f || f.length > 100 || f.includes('\0') || f.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw new Error('bad file name: ' + String(f).slice(0, 40));
  if (!/^[A-Za-z0-9_\-./ ]+$/.test(f)) throw new Error('file names may use letters, numbers, dash, underscore, dot');
  if (!OK_EXT.has(path.extname(f).toLowerCase())) throw new Error('only ' + [...OK_EXT].join(' ') + ' files are allowed');
  return f;
}
const dirOf = p => { const d = path.join(ROOT, projName(p)); if (path.relative(ROOT, d).startsWith('..')) throw new Error('bad project'); return d; };
const fileOf = (p, f) => { const d = dirOf(p), full = path.join(d, fileName(f)); if (path.relative(d, full).startsWith('..')) throw new Error('bad path'); return full; };

function walk(d, base = d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;                       // never follow links out of the project
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, base, out); else out.push({ name: path.relative(base, f).split(path.sep).join('/'), size: fs.statSync(f).size });
  }
  return out;
}

function listProjects() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => {
    const files = walk(path.join(ROOT, e.name)); let m = 0; try { m = fs.statSync(path.join(ROOT, e.name)).mtimeMs; } catch {}
    return { name: e.name, files: files.length, updated: m };
  }).sort((a, b) => b.updated - a.updated);
}
function createProject(name, template) {
  const n = projName(name), d = dirOf(n);
  if (fs.existsSync(d)) return { name: n, existed: true };
  if (listProjects().length >= MAX_PROJECTS) throw new Error('too many projects (max ' + MAX_PROJECTS + '). Delete one first.');
  fs.mkdirSync(d, { recursive: true });
  if (template !== 'empty') {
    writeFile(n, 'index.html', `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${n}</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>${n}</h1>\n<script src="script.js"></script>\n</body>\n</html>\n`);
    writeFile(n, 'style.css', 'body { font-family: system-ui, sans-serif; margin: 2rem; }\n');
    writeFile(n, 'script.js', `console.log('${n} is running');\n`);
  }
  return { name: n, existed: false };
}
function deleteProject(name) { const d = dirOf(name); if (!fs.existsSync(d)) throw new Error('no such project'); fs.rmSync(d, { recursive: true, force: true }); return 'Deleted project ' + projName(name); }

function readFile(p, f) {
  const full = fileOf(p, f); if (!fs.existsSync(full)) throw new Error('no such file: ' + f);
  return fs.readFileSync(full, 'utf8');
}
function writeFile(p, f, content) {
  const full = fileOf(p, f), d = dirOf(p);
  content = String(content == null ? '' : content);
  if (Buffer.byteLength(content) > MAX_FILE) throw new Error('file too big (max ' + (MAX_FILE / 1024) + ' KB). Split it into smaller files.');
  const files = walk(d).filter(x => !/\.(png|jpe?g|gif|webp)$/i.test(x.name)), has = files.some(x => x.name === fileName(f));   // pictures have their own limits
  if (!has && files.length >= MAX_FILES) throw new Error('too many files (max ' + MAX_FILES + ')');
  const total = files.filter(x => x.name !== fileName(f)).reduce((n, x) => n + x.size, 0) + Buffer.byteLength(content);
  if (total > MAX_TOTAL) throw new Error('project too big (max ' + (MAX_TOTAL / 1048576) + ' MB)');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = full + '.tmp' + process.pid; fs.writeFileSync(tmp, content); fs.renameSync(tmp, full);   // atomic: a crash never leaves half a file
  return { name: fileName(f), size: Buffer.byteLength(content), created: !has };
}
function deleteFile(p, f) { const full = fileOf(p, f); if (!fs.existsSync(full)) throw new Error('no such file: ' + f); fs.unlinkSync(full); return 'Deleted ' + f; }

// Edit ONE spot instead of rewriting the whole file: faster, far less for a small model to get wrong, and no lag.
// Safety net for edits made by the AI: if a script parsed fine before and would not parse after, refuse the edit and keep the file as it was.
function jsBroken(name, text) {
  if (!/\.m?js$/i.test(name)) return '';
  try { new vm.Script(String(text), { filename: name }); return ''; } catch (e) { return /import|export|await/.test(e.message) ? '' : e.message; }
}
function guardedWrite(p, f, before, after) {
  const was = jsBroken(f, before), now = was ? '' : jsBroken(f, after);
  if (now) throw new Error('That change would break ' + f + ' (' + now + '), so I did not save it and the file is unchanged. Change fewer lines, or copy the exact lines with studio_read_numbered and try again.');
  writeFile(p, f, after);
}

// Editing a script that already exists. Small models rarely copy text perfectly, so matching forgives the usual slips:
// Windows line endings, trailing spaces, and different indentation. The file keeps its own line-ending style afterwards.
function patchFile(p, f, find, replace, all) {
  find = String(find == null ? '' : find); if (!find.trim()) throw new Error('"find" text is required');
  const raw = readFile(p, f), crlf = raw.includes('\r\n'), src = raw.replace(/\r\n/g, '\n');
  const rep = String(replace == null ? '' : replace).replace(/\r\n/g, '\n'), fnd = find.replace(/\r\n/g, '\n');
  const out = (t) => crlf ? t.replace(/\n/g, '\r\n') : t;
  let i = src.indexOf(fnd), n = 0;
  if (i >= 0) { let k = -1; while ((k = src.indexOf(fnd, k + 1)) >= 0) n++; }
  if (n > 1 && !all) throw new Error('that text appears ' + n + ' times in ' + f + '. Include more surrounding text so it is unique, or set "all" to true to change every one.');
  if (n >= 1) { guardedWrite(p, f, raw, out(all ? src.split(fnd).join(rep) : src.slice(0, i) + rep + src.slice(i + fnd.length))); return 'Edited ' + f + (all && n > 1 ? ' (' + n + ' places)' : ''); }
  // Forgiving match: compare line by line ignoring indentation and trailing spaces.
  const sl = src.split('\n'), fl = fnd.split('\n').map(x => x.trim()); while (fl.length && !fl[0]) fl.shift(); while (fl.length && !fl[fl.length - 1]) fl.pop();
  const hits = [];
  if (fl.length) for (let a = 0; a + fl.length <= sl.length; a++) { let ok = true; for (let b = 0; b < fl.length; b++) if (sl[a + b].trim() !== fl[b]) { ok = false; break; } if (ok) hits.push(a); }
  if (!hits.length) throw new Error('the text to replace was not found in ' + f + '. Read the file again (studio_read) and copy the exact lines, or use studio_lines to replace by line number.');
  if (hits.length > 1 && !all) throw new Error('that text appears ' + hits.length + ' times in ' + f + '. Include more surrounding lines so it is unique, or set "all" to true.');
  // Give each new line the indentation of the old line it replaces (same position). Extra lines copy the last old line's indent.
  const mk = (at) => { const ind = k => (sl[at + Math.min(k, fl.length - 1)].match(/^\s*/) || [''])[0]; return rep.split('\n').map((x, k) => x.trim() ? ind(k) + x.replace(/^\s+/, '') : x); };
  for (const a of (all ? hits.slice().reverse() : [hits[0]])) sl.splice(a, fl.length, ...mk(a));
  guardedWrite(p, f, raw, out(sl.join('\n'))); return 'Edited ' + f + ' (matched ignoring spacing)' + (all && hits.length > 1 ? ', ' + hits.length + ' places' : '');
}

// Edit by line number: replace lines from..to with new text, insert before a line (to omitted), or delete lines (text empty). Lines start at 1.
function editLines(p, f, from, to, text) {
  const raw = readFile(p, f), crlf = raw.includes('\r\n'), lines = raw.replace(/\r\n/g, '\n').split('\n');
  const a = Math.floor(+from); if (!(a >= 1 && a <= lines.length + 1)) throw new Error('"from" must be a line number between 1 and ' + (lines.length + 1) + ' (the file has ' + lines.length + ' lines)');
  const insert = to == null || to === '', b = insert ? a - 1 : Math.floor(+to);
  if (!insert && !(b >= a && b <= lines.length)) throw new Error('"to" must be a line number from ' + a + ' to ' + lines.length);
  const add = text == null || String(text) === '' ? [] : String(text).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  lines.splice(a - 1, insert ? 0 : b - a + 1, ...add);
  const res = lines.join('\n'); guardedWrite(p, f, raw, crlf ? res.replace(/\n/g, '\r\n') : res);
  return (insert ? 'Inserted ' + add.length + ' line(s) before line ' + a : add.length ? 'Replaced lines ' + a + '-' + b + ' with ' + add.length + ' line(s)' : 'Deleted lines ' + a + '-' + b) + ' in ' + f;
}

// Same as studio_read but with line numbers in front, so an edit by line number is easy to get right.
function readNumbered(p, f) { const l = readFile(p, f).replace(/\r\n/g, '\n').split('\n'); const w = String(l.length).length; return l.map((x, k) => String(k + 1).padStart(w) + ' | ' + x).join('\n'); }

function snapshot(p) {
  const d = dirOf(p); if (!fs.existsSync(d)) throw new Error('no such project');
  // Pictures are binary. Reading them as text would corrupt them (and anything that saves a snapshot back, like an undo, would destroy them), so they are left out.
  const files = walk(d).filter(x => !/\.(png|jpe?g|gif|webp)$/i.test(x.name)).sort((a, b) => (a.name === 'index.html' ? -1 : b.name === 'index.html' ? 1 : a.name.localeCompare(b.name)));
  return files.map(x => ({ name: x.name, size: x.size, content: fs.readFileSync(path.join(d, x.name), 'utf8') }));
}

// Run plain JavaScript (no browser, no files, no network, no require) with a hard time limit. Returns what it printed.
function runJs(code, ms = 1500) {
  code = String(code == null ? '' : code); if (code.length > 50000) throw new Error('code too long for a quick run');
  const out = []; const fmt = v => { try { return typeof v === 'string' ? v : JSON.stringify(v, (k, x) => typeof x === 'function' ? '[function]' : typeof x === 'bigint' ? String(x) : x); } catch { return String(v); } };
  const push = (...a) => { if (out.join('\n').length < 20000) out.push(a.map(fmt).join(' ')); };
  const sandbox = Object.create(null); sandbox.console = { log: push, info: push, warn: push, error: push }; sandbox.Math = Math; sandbox.JSON = JSON; sandbox.Date = Date;
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  try { const r = new vm.Script(code, { filename: 'studio.js' }).runInContext(ctx, { timeout: ms }); if (r !== undefined) push('=>', r); return { ok: true, output: out.join('\n') || '(no output)' }; }
  catch (e) { return { ok: false, output: out.join('\n'), error: /timed out/i.test(e.message) ? 'stopped: the code ran longer than ' + ms + ' ms (endless loop?)' : String(e && e.message || e).slice(0, 300) }; }
}

// Quick sanity check of a project so the AI (and user) can see mistakes without a browser.
function check(p) {
  const files = snapshot(p), issues = [];
  // Pictures are not in the text snapshot, but a page may link to them: they exist, so they must count as existing files.
  const names = new Set([...files.map(f => f.name), ...walk(dirOf(p)).map(f => f.name)]);
  const htmlIds = new Map();
  for (const f of files) {
    if (/\.html?$/i.test(f.name)) {
      for (const m of f.content.matchAll(/<(?:script|link|img)[^>]+(?:src|href)=["']([^"':#?]+)["']/gi)) if (!names.has(m[1].replace(/^\.\//, ''))) issues.push(`${f.name} points to ${m[1]} which does not exist`);
      if (!/<html|<body|<!doctype/i.test(f.content)) issues.push(f.name + ' has no <html> or <body>');
      for (const m of f.content.matchAll(/\bid=["']([^"']+)["']/gi)) { const id = m[1]; if (!htmlIds.has(id)) htmlIds.set(id, f.name); else issues.push(`${f.name} repeats id=\"${id}\" (already in ${htmlIds.get(id)})`); }
    }
    if (/\.m?js$/.test(f.name)) { try { new vm.Script(f.content, { filename: f.name }); } catch (e) { if (!/import|export|await/.test(e.message)) issues.push(`${f.name}: ${e.message}`); } }
  }
  // A script that looks up an id/class the page does not have is the commonest reason a small model's app does nothing.
  const html = files.filter(f => /\.html?$/i.test(f.name)).map(f => f.content).join('\n');
  if (html) {
    const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(m => m[1]));
    for (const f of files.filter(f => /\.m?js$/.test(f.name))) {
      const seen = new Set();
      for (const m of f.content.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)|querySelector\(\s*["']#([\w-]+)["']\s*\)/g)) {
        const id = m[1] || m[2]; if (seen.has(id)) continue; seen.add(id);
        if (!ids.has(id) && !new RegExp("(?:createElement|innerHTML|insertAdjacentHTML)[^]*" + id.replace(/[^\w-]/g, '')).test(f.content)) issues.push(`${f.name} uses the element "#${id}" but no HTML file has id="${id}". Add it to index.html with studio_patch.`);
      }
    }
  }
  return issues.length ? issues : ['No problems found.'];
}
function diagnose(p) {
  const files = snapshot(p), issues = check(p).filter(x => x !== 'No problems found.');
  const html = files.filter(f => /\.html?$/i.test(f.name)).length;
  const js = files.filter(f => /\.m?js$/i.test(f.name)).length;
  const css = files.filter(f => /\.css$/i.test(f.name)).length;
  const total = files.reduce((n, f) => n + f.size, 0);
  const out = [`Project: ${projName(p)}`, `Files: ${files.length} (${html} HTML, ${css} CSS, ${js} JS)`, `Size: ${total} bytes`];
  if (!files.some(f => /^index\.html?$/i.test(f.name))) out.push('Advice: add an index.html entry page so Preview opens predictably.');
  if (issues.length) out.push('Problems found:', ...issues.slice(0, 20).map(x => '- ' + x));
  else out.push('No static problems found. Use the Preview Output panel for runtime errors, then ask Pholama to fix the exact error.');
  return out.join('\n');
}

// ---------- tools the AI can call (all local and free) ----------
const TOOLS = {
  studio_projects: { desc: 'List the user\'s Studio projects. args: {}', run: () => { const l = listProjects(); return l.length ? l.map(x => `${x.name} (${x.files} files)`).join('\n') : 'No projects yet.'; } },
  studio_create: { desc: 'Create a new web project with index.html, style.css and script.js. args: {"project": string}', run: a => { const r = createProject(a.project); return r.existed ? 'Project already exists: ' + r.name : 'Created project ' + r.name + ' with index.html, style.css, script.js'; } },
  studio_files: { desc: 'List the files in a project. args: {"project": string}', run: a => snapshot(a.project).map(f => `${f.name} (${f.size} bytes)`).join('\n') || '(empty)' },
  studio_read: { desc: 'Read one file. args: {"project": string, "file": string}', run: a => readFile(a.project, a.file) },
  studio_write: { desc: 'Create or replace a whole file (use for new files). args: {"project": string, "file": string, "content": string}', run: a => { const r = writeFile(a.project, a.file, a.content); return (r.created ? 'Created ' : 'Saved ') + r.name + ' (' + r.size + ' bytes)'; } },
  studio_patch: { desc: 'Change a spot in an existing file (preferred for edits). Spacing differences are forgiven. args: {"project": string, "file": string, "find": old text, "replace": new text, "all": true to change every match (optional)}', run: a => patchFile(a.project, a.file, a.find, a.replace, a.all === true || a.all === 'true') },
  studio_read_numbered: { desc: 'Read a file with line numbers, to edit it by line. args: {"project": string, "file": string}', run: a => readNumbered(a.project, a.file) },
  studio_lines: { desc: 'Edit an existing file by line number. Replace lines from..to with text, or insert before a line (leave "to" out), or delete lines (leave "text" empty). args: {"project": string, "file": string, "from": number, "to": number, "text": string}', run: a => editLines(a.project, a.file, a.from, a.to, a.text) },
  studio_delete: { desc: 'Delete one file. args: {"project": string, "file": string}', run: a => deleteFile(a.project, a.file) },
  studio_check: { desc: 'Check a project for broken links, duplicate HTML ids and script errors. args: {"project": string}', run: a => check(a.project).join('\n') },
  studio_diagnose: { desc: 'Diagnose a Studio project and return its file summary, problems and practical next step. args: {"project": string}', run: a => diagnose(a.project) },
  studio_run_js: { desc: 'Run a short piece of plain JavaScript and get its printed output (no page, no network). args: {"code": string}', run: a => { const r = runJs(a.code); return r.ok ? r.output : (r.output ? r.output + '\n' : '') + 'ERROR: ' + r.error; } },
};
// The extra tools (map, tree, folders, pictures, verify...) live in studioplus.js. It needs this file, so it is loaded lazily to avoid a loop.
const plus = () => require('./studioplus');
// Tools that only LOOK (never change anything): the host does not re-check the project after these.
const READ_ONLY = new Set(['studio_projects', 'studio_files', 'studio_read', 'studio_read_numbered', 'studio_check', 'studio_diagnose', 'studio_run_js', 'studio_map', 'studio_tree', 'studio_outline', 'studio_search', 'studio_image_info', 'studio_verify']);
const tools = () => [...Object.entries(TOOLS).map(([name, t]) => ({ name, desc: t.desc, kind: 'studio' })), ...plus().tools()];
const isStudio = n => Object.prototype.hasOwnProperty.call(TOOLS, n) || plus().isPlus(n);
const isReadOnly = n => READ_ONLY.has(n);
const run = (name, args) => { if (!isStudio(name)) throw new Error('unknown studio tool'); const a = args && typeof args === 'object' ? args : {}; return Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name].run(a) : plus().run(name, a); };

module.exports = { tools, isStudio, isReadOnly, run, listProjects, createProject, deleteProject, readFile, writeFile, deleteFile, patchFile, snapshot, runJs, check, diagnose, projName, fileName, ROOT, LIMITS: { MAX_FILE, MAX_FILES, MAX_TOTAL } };
