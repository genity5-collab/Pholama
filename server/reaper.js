// Pholama reaper: a tiny watcher that makes sure closing Pholama ALWAYS frees the memory.
// Normal close, Ctrl+C, closing the window and shutting down are already handled by the server. The one case they cannot
// cover is Pholama being killed hard (Task Manager "End task", a crash, a power cut of the app). Then nobody is left to stop
// the AI engine, and it would sit in RAM. The reaper is a separate little process: when it sees Pholama is gone, it stops the engines.
//
// Run by the server as:  node reaper.js <parentPid> <pidfile> [<pidfile> ...]
// It only ever kills a pid that is STILL a llama-server (a pid number can be reused by an unrelated program after a reboot).
const fs = require('fs');
const { execSync } = require('child_process');

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function processName(pid, platform = process.platform) {
  try {
    if (platform === 'linux') {
      const comm = fs.readFileSync('/proc/' + pid + '/comm', 'utf8').trim();
      let cmd = ''; try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0')[0]; } catch {}
      return comm + ' ' + cmd;   // the name, plus the program path it was started from
    }
    if (platform === 'win32') return String(execSync('tasklist /FI "PID eq ' + pid + '" /FO CSV /NH', { encoding: 'utf8', timeout: 4000, windowsHide: true }));
    return String(execSync('ps -p ' + pid + ' -o command=', { encoding: 'utf8', timeout: 4000 })).split(' ')[0];
  } catch { return ''; }
}
const isEngine = name => /llama-server/i.test(String(name || ''));

// Stops every engine named in the pid files. Returns how many it stopped.
function reapEngines(pidfiles, { kill = (pid) => process.kill(pid, 'SIGKILL'), nameOf = processName, exists = alive } = {}) {
  let n = 0;
  for (const f of pidfiles) {
    let pid = 0; try { pid = +fs.readFileSync(f, 'utf8').trim(); } catch { continue; }
    try { fs.unlinkSync(f); } catch {}
    if (!pid || !exists(pid)) continue;
    if (!isEngine(nameOf(pid))) continue;   // reused by something else: leave it alone
    try { kill(pid); n++; } catch {}
  }
  return n;
}

// Remembers the engines that belong to ITS parent while the parent is alive, and only ever stops those.
// (A restarted Pholama writes new pid files; reading them after the old one died would kill the NEW engine.)
function watch(parentPid, pidfiles, { everyMs = 2000, exit = () => process.exit(0), exists = alive, kill = (pid) => process.kill(pid, 'SIGKILL'), nameOf = processName, readPid = f => { try { return +fs.readFileSync(f, 'utf8').trim() || 0; } catch { return 0; } } } = {}) {
  const mine = new Set();
  const t = setInterval(() => {
    if (exists(parentPid)) { for (const f of pidfiles) { const pid = readPid(f); if (pid) mine.add(pid); } return; }
    clearInterval(t);
    let n = 0;
    for (const pid of mine) { if (!exists(pid) || !isEngine(nameOf(pid))) continue; try { kill(pid); n++; } catch {} }
    for (const f of pidfiles) { try { const cur = readPid(f); if (cur && mine.has(cur)) fs.unlinkSync(f); } catch {} }
    exit(n);
  }, everyMs);
  return t;
}
module.exports = { reapEngines, watch, isEngine, processName };

if (require.main === module) {
  const [ppid, ...files] = process.argv.slice(2);
  if (!+ppid || !files.length) process.exit(1);
  watch(+ppid, files);
}
