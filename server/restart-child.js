'use strict';
// Detached child used by /api/restart. The old server must exit before the new one binds;
// starting both at once caused EADDRINUSE and left the desktop app offline.
const net = require('net'), { spawn } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function busy(port) {
  return new Promise(resolve => {
    const s = net.createConnection({ host: '127.0.0.1', port });
    s.setTimeout(600);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(true); });
    s.once('error', e => resolve(e.code !== 'ECONNREFUSED' && e.code !== 'ECONNRESET'));
  });
}
async function relaunch(port, serverPath, { tries = 180, interval = 250, spawnProcess = spawn, env = process.env } = {}) {
  for (let i = 0; i < tries; i++) {
    if (!(await busy(port))) {
      let child; try { child = spawnProcess(process.execPath, [serverPath], { detached: true, stdio: 'ignore', windowsHide: true, cwd: require('path').resolve(require('path').dirname(serverPath), '..'), env }); } catch { return false; }
      if (child && typeof child.once === 'function') {
        const spawned = await new Promise(resolve => { child.once('spawn', () => resolve(true)); child.once('error', () => resolve(false)); });
        if (!spawned) return false;
      }
      if (child && typeof child.unref === 'function') child.unref();
      return true;
    }
    await sleep(interval);
  }
  return false;
}
if (require.main === module) {
  const port = Number(process.argv[2]), serverPath = process.argv[3];
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !serverPath) process.exit(2);
  relaunch(port, serverPath).then(ok => process.exit(ok ? 0 : 1), () => process.exit(1));
}
module.exports = { busy, relaunch };
