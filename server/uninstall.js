// Removes Pholama from this PC: the app folder, models, private Node, llama.cpp, the pholama command and the shortcuts.
// Safe by design: it only deletes paths it can prove belong to Pholama, shows the list first and asks for a typed confirmation.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), readline = require('readline');
const { spawn, execSync } = require('child_process');

const home = () => os.homedir();
const dataDir = () => path.join(home(), '.pholama');

// A folder is "the Pholama app" only if it really holds Pholama's own files.
function isPholamaApp(dir) {
  try { return fs.existsSync(path.join(dir, 'server', 'cli.js')) && fs.existsSync(path.join(dir, 'server', 'server.js')) && fs.existsSync(path.join(dir, 'models.pc.json')); } catch { return false; }
}
function isPholamaData(dir) { return path.basename(dir) === '.pholama' && path.dirname(dir) === home(); }

function sizeOf(p) {
  let total = 0;
  const walk = q => { let st; try { st = fs.lstatSync(q); } catch { return; } if (st.isSymbolicLink()) return; if (st.isDirectory()) { let k = []; try { k = fs.readdirSync(q); } catch {} for (const n of k) walk(path.join(q, n)); } else total += st.size; };
  walk(p); return total;
}
const human = b => b >= 2 ** 30 ? (b / 2 ** 30).toFixed(2) + ' GB' : b >= 2 ** 20 ? (b / 2 ** 20).toFixed(0) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

// Everything Pholama may have put on this PC. Each item: { label, path, kind }
function plan(appRoot) {
  const H = home(), items = [];
  const add = (label, p, kind) => { if (p && fs.existsSync(p)) items.push({ label, path: p, kind }); };
  const apps = new Set([appRoot, path.join(H, 'Pholama')].filter(d => d && isPholamaApp(d)));
  for (const d of apps) add('Pholama app folder', d, 'dir');
  if (isPholamaData(dataDir())) add('Models, private Node.js, llama.cpp and settings', dataDir(), 'dir');
  if (process.platform === 'win32') {
    const sh = (n) => { try { return execSync(`powershell -NoProfile -Command "[Environment]::GetFolderPath('${n}')"`, { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim(); } catch { return ''; } };
    for (const [n, where] of [['Desktop', 'Desktop'], ['Programs', 'Start Menu']]) { const d = sh(n); if (d) add('Pholama icon on ' + where, path.join(d, 'Pholama.lnk'), 'file'); }
  } else {
    add('pholama command', path.join(H, '.local', 'bin', 'pholama'), 'file');
    add('phollama command', path.join(H, '.local', 'bin', 'phollama'), 'file');
    add('Pholama launcher entry', path.join(H, '.local', 'share', 'applications', 'pholama.desktop'), 'file');
    add('Pholama icon on Desktop', path.join(H, 'Desktop', 'Pholama.desktop'), 'file');
    add('Pholama icon on Desktop', path.join(H, 'Desktop', 'Pholama.command'), 'file');
  }
  return items;
}

function removeNow(it) {
  try { fs.rmSync(it.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); return !fs.existsSync(it.path); } catch { return false; }
}

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(String(a).trim()); }));
}

// deps: { log, color:{red,green,dim,yellow,bold}, stopServer(): Promise, appRoot }
async function run(args, deps) {
  const { log, color: C, appRoot } = deps;
  const yes = args.includes('--yes') || args.includes('-y'), dry = args.includes('--dry-run');
  const items = plan(appRoot);
  if (!items.length) { log(C.green('Nothing to remove. Pholama is not installed here.')); return 0; }

  log('\n' + C.bold('This will remove Pholama from this PC:') + '\n');
  let total = 0;
  for (const it of items) { const sz = it.kind === 'dir' ? sizeOf(it.path) : 0; total += sz; log('  ' + it.label.padEnd(48) + C.dim(it.path + (sz ? '  (' + human(sz) + ')' : ''))); }
  if (process.platform === 'win32') log('  ' + 'The pholama command'.padEnd(48) + C.dim('removed from your user PATH'));
  log('\n  Frees about ' + C.bold(human(total)) + '. Your chats in the browser are not touched. Other programs are not touched.');
  log('  ' + C.yellow('Downloaded models are deleted too. You would have to download them again.') + '\n');
  if (dry) { log(C.dim('Dry run: nothing was deleted.')); return 0; }

  if (!yes) {
    if (!process.stdin.isTTY) { log(C.red('Not deleting: no keyboard to confirm. Run it in a terminal, or add --yes.')); return 1; }
    const a = await ask('Type ' + C.bold('remove') + ' to delete all of this, or press Enter to cancel: ');
    if (a.toLowerCase() !== 'remove') { log(C.green('Cancelled. Nothing was deleted.')); return 0; }
  }

  log('\nStopping Pholama and every local AI...');
  try { await deps.stopServer(); } catch {}
  await new Promise(r => setTimeout(r, 1200));

  const later = [];   // things Windows will not let us delete while this program is still running
  for (const it of items) {
    if (process.platform === 'win32' && it.kind === 'dir' && (process.argv[1] || '').toLowerCase().startsWith(it.path.toLowerCase())) { later.push(it); continue; }
    const ok = removeNow(it);
    log('  ' + (ok ? C.green('removed ') : C.red('could not remove ')) + it.path);
    if (!ok) later.push(it);
  }
  if (process.platform === 'win32') {
    try {   // take pholama out of the user PATH
      const ps = "$b=Join-Path $env:USERPROFILE '.pholama\\cmd'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if($p){ $n=(($p -split ';') | Where-Object { $_ -and $_ -ne $b }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$n,'User') }";
      execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 10000, windowsHide: true, stdio: 'ignore' });
      log('  ' + C.green('removed ') + 'pholama from your PATH');
    } catch { log('  ' + C.yellow('Could not edit PATH. It is harmless: the folder is gone.')); }
  }
  if (later.length) {   // delete after this process has exited
    if (process.platform === 'win32') {
      const bat = path.join(os.tmpdir(), 'pholama_cleanup_' + Date.now() + '.cmd');
      fs.writeFileSync(bat, `@echo off\r\nping 127.0.0.1 -n 3 >nul\r\n${later.map(i => `rmdir /s /q "${i.path}"`).join('\r\n')}\r\ndel "%~f0"\r\n`);
      spawn('cmd', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      log('\n' + C.green('Pholama is removed.') + ' The last folder is deleted a moment after this window closes.');
    } else {
      spawn('sh', ['-c', 'sleep 1; exec rm -rf -- "$@"', 'sh', ...later.map(i => i.path)], { detached: true, stdio: 'ignore' }).unref();   // paths are arguments, never spliced into a shell string
      log('\n' + C.green('Pholama is removed.'));
    }
  } else log('\n' + C.green('Pholama is removed.') + ' Thanks for trying it.');
  return 0;
}

module.exports = { run, plan, isPholamaApp, isPholamaData, human };
