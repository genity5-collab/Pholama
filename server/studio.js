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
  const files = walk(d), has = files.some(x => x.name === fileName(f));
  if (!has && files.length >= MAX_FILES) throw new Error('too many files (max ' + MAX_FILES + ')');
  const total = files.filter(x => x.name !== fileName(f)).reduce((n, x) => n + x.size, 0) + Buffer.byteLength(content);
  if (total > MAX_TOTAL) throw new Error('project too big (max ' + (MAX_TOTAL / 1048576) + ' MB)');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = full + '.tmp' + process.pid; fs.writeFileSync(tmp, content); fs.renameSync(tmp, full);   // atomic: a crash never leaves half a file
  return { name: fileName(f), size: Buffer.byteLength(content), created: !has };
}
function deleteFile(p, f) { const full = fileOf(p, f); if (!fs.existsSync(full)) throw new Error('no such file: ' + f); fs.unlinkSync(full); return 'Deleted ' + f; }

// Edit ONE spot instead of rewriting the whole file: faster, far less for a small model to get wrong, and no lag.
function patchFile(p, f, find, replace) {
  find = String(find == null ? '' : find); if (!find) throw new Error('"find" text is required');
  const src = readFile(p, f), i = src.indexOf(find);
  if (i < 0) throw new Error('the text to replace was not found in ' + f + '. Read the file again and copy the exact text.');
  if (src.indexOf(find, i + find.length) >= 0) throw new Error('that text appears more than once in ' + f + '. Include more surrounding text so it is unique.');
  writeFile(p, f, src.slice(0, i) + String(replace == null ? '' : replace) + src.slice(i + find.length));
  return 'Edited ' + f;
}

function snapshot(p) {
  const d = dirOf(p); if (!fs.existsSync(d)) throw new Error('no such project');
  const files = walk(d).sort((a, b) => (a.name === 'index.html' ? -1 : b.name === 'index.html' ? 1 : a.name.localeCompare(b.name)));
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
  const files = snapshot(p), names = new Set(files.map(f => f.name)), issues = [];
  for (const f of files) {
    if (/\.html?$/i.test(f.name)) {
      for (const m of f.content.matchAll(/<(?:script|link|img)[^>]+(?:src|href)=["']([^"':#?]+)["']/gi)) if (!names.has(m[1].replace(/^\.\//, ''))) issues.push(`${f.name} points to ${m[1]} which does not exist`);
      if (!/<html|<body|<!doctype/i.test(f.content)) issues.push(f.name + ' has no <html> or <body>');
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

// ---------- tools the AI can call (all local and free) ----------
const TOOLS = {
  studio_projects: { desc: 'List the user\'s Studio projects. args: {}', run: () => { const l = listProjects(); return l.length ? l.map(x => `${x.name} (${x.files} files)`).join('\n') : 'No projects yet.'; } },
  studio_create: { desc: 'Create a new web project with index.html, style.css and script.js. args: {"project": string}', run: a => { const r = createProject(a.project); return r.existed ? 'Project already exists: ' + r.name : 'Created project ' + r.name + ' with index.html, style.css, script.js'; } },
  studio_files: { desc: 'List the files in a project. args: {"project": string}', run: a => snapshot(a.project).map(f => `${f.name} (${f.size} bytes)`).join('\n') || '(empty)' },
  studio_read: { desc: 'Read one file. args: {"project": string, "file": string}', run: a => readFile(a.project, a.file) },
  studio_write: { desc: 'Create or replace a whole file (use for new files). args: {"project": string, "file": string, "content": string}', run: a => { const r = writeFile(a.project, a.file, a.content); return (r.created ? 'Created ' : 'Saved ') + r.name + ' (' + r.size + ' bytes)'; } },
  studio_patch: { desc: 'Change ONE spot in an existing file (preferred for edits). args: {"project": string, "file": string, "find": exact old text, "replace": new text}', run: a => patchFile(a.project, a.file, a.find, a.replace) },
  studio_delete: { desc: 'Delete one file. args: {"project": string, "file": string}', run: a => deleteFile(a.project, a.file) },
  studio_check: { desc: 'Check a project for broken links and script errors. args: {"project": string}', run: a => check(a.project).join('\n') },
  studio_run_js: { desc: 'Run a short piece of plain JavaScript and get its printed output (no page, no network). args: {"code": string}', run: a => { const r = runJs(a.code); return r.ok ? r.output : (r.output ? r.output + '\n' : '') + 'ERROR: ' + r.error; } },
};
const tools = () => Object.entries(TOOLS).map(([name, t]) => ({ name, desc: t.desc, kind: 'studio' }));
const isStudio = n => Object.prototype.hasOwnProperty.call(TOOLS, n);
const run = (name, args) => { if (!isStudio(name)) throw new Error('unknown studio tool'); return TOOLS[name].run(args && typeof args === 'object' ? args : {}); };

module.exports = { tools, isStudio, run, listProjects, createProject, deleteProject, readFile, writeFile, deleteFile, patchFile, snapshot, runJs, check, projName, fileName, ROOT, LIMITS: { MAX_FILE, MAX_FILES, MAX_TOTAL } };
