// Run code in many languages, inside the workspace folder only.
// Pholama does NOT ship compilers. You install the ones you want (Python, g++, Rust ...) and Pholama finds them on your PC.
// If a language is missing, the answer says exactly what to install, so the AI (and you) are never left guessing.
// No shell is ever used: the program and its arguments are passed as a list, so a file name cannot inject a command.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');

const WIN = process.platform === 'win32';
const EXE = n => n + (WIN ? '.exe' : '');

// id: how we recognise it. ext: file endings. probe: the command that proves it is installed.
// compile(src, out) -> [cmd, args] builds a program (compiled languages). run(src, out) -> [cmd, args] starts it.
// The small Python that Pholama Setup installs (Windows). Looked up each time, so installing it takes effect without a restart.
function ownPython() { try { const e = require('./setup').pythonExe(); return require('fs').existsSync(e) ? [[e, ['--version']]] : []; } catch { return []; } }
const LANGS = {
  python: { name: 'Python', ext: ['.py'], get probe() { return [...ownPython(), ['python3', ['--version']], ['python', ['--version']], ['py', ['--version']]]; }, run: (s, o, c) => [c, [s]], install: 'Open Studio > Setup and press Install Python (about 11 MB), or install it from https://www.python.org/downloads/ (tick "Add to PATH" on Windows).' },
  node: { name: 'JavaScript (Node.js)', ext: ['.js', '.mjs', '.cjs'], probe: [['node', ['--version']]], run: (s, o, c) => [c, [s]], install: 'Install Node.js from https://nodejs.org/.' },
  typescript: { name: 'TypeScript', ext: ['.ts'], probe: [['tsx', ['--version']], ['ts-node', ['--version']], ['deno', ['--version']]], run: (s, o, c) => c === 'deno' ? [c, ['run', s]] : [c, [s]], install: 'Install Node.js, then run: npm install -g tsx   (or install Deno from https://deno.com/).' },
  cpp: { name: 'C++', ext: ['.cpp', '.cc', '.cxx'], probe: [['g++', ['--version']], ['clang++', ['--version']]], compile: (s, o, c) => [c, ['-std=c++17', '-O2', s, '-o', o]], run: (s, o) => [o, []], install: 'Install a C++ compiler: on Windows get MSYS2/MinGW-w64 (g++) or LLVM (clang++); on Mac run "xcode-select --install"; on Linux install "g++" with your package manager.' },
  c: { name: 'C', ext: ['.c'], probe: [['gcc', ['--version']], ['clang', ['--version']]], compile: (s, o, c) => [c, ['-O2', s, '-o', o]], run: (s, o) => [o, []], install: 'Install a C compiler: MSYS2/MinGW-w64 (gcc) on Windows, "xcode-select --install" on Mac, or "gcc" on Linux.' },
  rust: { name: 'Rust', ext: ['.rs'], probe: [['rustc', ['--version']]], compile: (s, o, c) => [c, ['-O', s, '-o', o]], run: (s, o) => [o, []], install: 'Install Rust from https://rustup.rs/ (it gives you rustc and cargo).' },
  go: { name: 'Go', ext: ['.go'], probe: [['go', ['version']]], run: (s, o, c) => [c, ['run', s]], install: 'Install Go from https://go.dev/dl/.' },
  java: { name: 'Java', ext: ['.java'], probe: [['java', ['--version']]], run: (s, o, c) => [c, [s]], install: 'Install a JDK (Java 11 or newer) from https://adoptium.net/. Single-file programs run directly.' },
  csharp: { name: 'C# (.NET)', ext: ['.cs'], probe: [['dotnet', ['--version']]], run: (s, o, c) => [c, ['run', s]], install: 'Install the .NET SDK (10 or newer runs single .cs files) from https://dotnet.microsoft.com/download.' },
  ruby: { name: 'Ruby', ext: ['.rb'], probe: [['ruby', ['--version']]], run: (s, o, c) => [c, [s]], install: 'Install Ruby from https://www.ruby-lang.org/en/downloads/.' },
  php: { name: 'PHP', ext: ['.php'], probe: [['php', ['--version']]], run: (s, o, c) => [c, [s]], install: 'Install PHP from https://www.php.net/downloads.' },
  lua: { name: 'Lua', ext: ['.lua'], probe: [['lua', ['-v']], ['luajit', ['-v']], ['lua5.4', ['-v']]], run: (s, o, c) => [c, [s]], install: 'Install Lua from https://www.lua.org/download.html.' },
  bash: { name: 'Shell (bash)', ext: ['.sh'], probe: [['bash', ['--version']]], run: (s, o, c) => [c, [s]], install: 'Install bash (Git for Windows includes it, or use WSL).' },
  powershell: { name: 'PowerShell', ext: ['.ps1'], probe: [['pwsh', ['-v']], ['powershell', ['-Help']]], run: (s, o, c) => [c, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', s]], install: 'Install PowerShell 7 from https://aka.ms/powershell.' },
  kotlin: { name: 'Kotlin', ext: ['.kts'], probe: [['kotlin', ['-version']]], run: (s, o, c) => [c, [s]], install: 'Install Kotlin from https://kotlinlang.org/docs/command-line.html.' },
  swift: { name: 'Swift', ext: ['.swift'], probe: [['swift', ['--version']]], run: (s, o, c) => [c, [s]], install: 'Install Swift from https://www.swift.org/install/.' },
  dart: { name: 'Dart', ext: ['.dart'], probe: [['dart', ['--version']]], run: (s, o, c) => [c, ['run', s]], install: 'Install the Dart SDK from https://dart.dev/get-dart.' },
  r: { name: 'R', ext: ['.r', '.R'], probe: [['Rscript', ['--version']]], run: (s, o, c) => [c, [s]], install: 'Install R from https://cran.r-project.org/.' },
  zig: { name: 'Zig', ext: ['.zig'], probe: [['zig', ['version']]], run: (s, o, c) => [c, ['run', s]], install: 'Install Zig from https://ziglang.org/download/.' },
};

const MAX_OUT = 8000, DEFAULT_SEC = 20, MAX_SEC = 120;
const probeCache = new Map();   // language -> { cmd, version } | null ; remembered for one minute so a reply is not slowed down
function sh(cmd, args, opt) { return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, shell: false, ...opt }); }

function detect(id, fresh) {
  const L = LANGS[id]; if (!L) return null;
  const hit = probeCache.get(id); if (!fresh && hit && Date.now() - hit.at < 60000) return hit.v;
  let found = null;
  for (const [cmd, args] of L.probe) {
    const r = sh(cmd, args, { timeout: 5000 });
    if (!r.error && r.status === 0) { found = { cmd, version: String((r.stdout || r.stderr || '').split('\n')[0]).trim().slice(0, 80) }; break; }
  }
  probeCache.set(id, { at: Date.now(), v: found }); return found;
}
const forget = () => probeCache.clear();

// Which language is this file? By ending; or by name when the AI says "python" / "c++" / "rs".
const ALIAS = { py: 'python', python3: 'python', js: 'node', javascript: 'node', nodejs: 'node', ts: 'typescript', 'c++': 'cpp', cc: 'cpp', rs: 'rust', golang: 'go', cs: 'csharp', 'c#': 'csharp', rb: 'ruby', sh: 'bash', shell: 'bash', ps1: 'powershell', kt: 'kotlin' };
function langOf(file, hint) {
  const h = String(hint || '').toLowerCase().trim();
  if (h) { const id = LANGS[h] ? h : ALIAS[h]; if (id) return id; throw new Error('unknown language "' + hint + '". Supported: ' + Object.keys(LANGS).join(', ')); }
  const ext = path.extname(String(file || '')).toLowerCase();
  const id = Object.keys(LANGS).find(k => LANGS[k].ext.some(e => e.toLowerCase() === ext));
  if (!id) throw new Error('cannot tell the language of "' + file + '". Use a known file ending (' + Object.values(LANGS).flatMap(l => l.ext).slice(0, 14).join(' ') + ' ...) or pass "language".');
  return id;
}

const clip = (t, n = MAX_OUT) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n) + '\n...[cut: ' + (t.length - n) + ' more characters]' : t; };

// Full list for the user and the AI: what is installed, what is not and how to get it.
function status(fresh) {
  return Object.entries(LANGS).map(([id, L]) => { const f = detect(id, fresh); return { id, name: L.name, installed: !!f, version: f ? f.version : '', howToInstall: f ? '' : L.install }; });
}
function statusText(fresh) {
  const s = status(fresh), yes = s.filter(x => x.installed), no = s.filter(x => !x.installed);
  return (yes.length ? 'INSTALLED (ready to run):\n' + yes.map(x => '- ' + x.name + (x.version ? ' (' + x.version + ')' : '')).join('\n') : 'No programming language is installed yet.')
    + (no.length ? '\n\nNOT INSTALLED (install it yourself, then it works right away):\n' + no.map(x => '- ' + x.name + ': ' + x.howToInstall).join('\n') : '');
}

// run(fileInsideWorkspace, {language, args, stdin, seconds}, {resolve, cwd})
// resolve(rel) must return a safe absolute path inside the workspace (tools2.safe). Nothing outside it is ever run.
function runFile(rel, o, env) {
  o = o || {};
  const id = langOf(rel, o.language), L = LANGS[id];
  const src = env.resolve(rel);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new Error('file not found: ' + rel);
  const f = detect(id);
  if (!f) return { ok: false, missing: id, text: L.name + ' is not installed on this PC, so "' + rel + '" cannot run.\n' + L.install + '\nAfter installing, try again (no restart needed).' };
  const args = Array.isArray(o.args) ? o.args.map(x => String(x).slice(0, 500)).slice(0, 20) : [];
  const sec = Math.max(1, Math.min(MAX_SEC, +o.seconds || DEFAULT_SEC));
  const cwd = env.cwd || path.dirname(src);
  let out = path.join(os.tmpdir(), 'pholama-build-' + process.pid + '-' + Date.now().toString(36));
  const start = Date.now(); let log = '';
  try {
    if (L.compile) {
      const [c, a] = L.compile(src, EXE(out), f.cmd);
      const b = sh(c, a, { cwd, timeout: sec * 1000, maxBuffer: 4e6 });
      if (b.error) return { ok: false, text: 'Could not start the ' + L.name + ' compiler: ' + b.error.message };
      if (b.status !== 0) return { ok: false, text: 'BUILD FAILED (' + L.name + ')\n' + clip((b.stderr || '') + (b.stdout || '')) };
      if (b.stderr) log += 'build notes:\n' + clip(b.stderr, 1500) + '\n';
    }
    const [c2, a2] = L.run(src, L.compile ? EXE(out) : out, f.cmd);
    const left = Math.max(1000, sec * 1000 - (Date.now() - start));
    const r = sh(c2, a2.concat(args), { cwd, timeout: left, maxBuffer: 4e6, input: o.stdin == null ? undefined : String(o.stdin).slice(0, 20000), env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
    const ms = Date.now() - start;
    if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, text: log + 'STOPPED: it ran longer than ' + sec + ' seconds, so Pholama ended it.\n' + clip(r.stdout) + clip(r.stderr) };
    if (r.error) return { ok: false, text: log + 'Could not start it: ' + r.error.message };
    const body = (r.stdout ? 'OUTPUT:\n' + clip(r.stdout) : 'OUTPUT: (nothing printed)') + (r.stderr ? '\nERRORS:\n' + clip(r.stderr) : '');
    return { ok: r.status === 0, text: log + L.name + ' finished in ' + ms + ' ms with exit code ' + r.status + '.\n' + body };
  } finally { for (const p of [EXE(out), out, out + '.exe', out + '.pdb']) { try { fs.rmSync(p, { force: true }); } catch {} } }
}

module.exports = { LANGS, ALIAS, langOf, detect, forget, status, statusText, runFile, clip };
