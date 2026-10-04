// The helper engine: a SECOND llama-server, only used in duo mode, on its own port.
// It is kept apart from the main engine so none of the main engine's start/stop fixes are disturbed.
// Rules it keeps: never more than one helper; always killed when Pholama closes, when the lag guard fires, or when duo is turned off;
// its process id is saved so a crash cannot leave it running forever.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const HELPER_PORT = 11437;
const PIDFILE = path.join(process.env.PHOLAMA_HOME || path.join(os.homedir(), '.pholama'), 'helper.pid');

function create({ findBin, modelsDir, get, log = () => {} }) {
  let proc = null, file = null, ready = false, chain = Promise.resolve();

  // Kill a helper left over from a crashed run (only if that pid is STILL a llama-server).
  function cleanupStale() {
    try {
      const pid = +fs.readFileSync(PIDFILE, 'utf8').trim(); fs.unlinkSync(PIDFILE);
      if (!pid) return;
      let name = '';
      try { name = process.platform === 'win32' ? require('child_process').execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true }).toString() : fs.readFileSync(`/proc/${pid}/comm`, 'utf8'); } catch {}
      if (/llama-server/i.test(name)) { process.kill(pid, 'SIGKILL'); log('Stopped a leftover helper AI from a previous run.'); }
    } catch {}
  }

  async function stop() {
    if (!proc) return false;
    const p = proc; proc = null; file = null; ready = false;
    try { p.kill(); } catch {}
    await new Promise(r => { p.once('exit', r); setTimeout(r, 2500); });
    try { fs.unlinkSync(PIDFILE); } catch {}
    return true;
  }
  function killNow() {   // when the process is going away and cannot await
    try { if (proc) proc.kill('SIGKILL'); } catch {}
    proc = null; file = null; ready = false; try { fs.unlinkSync(PIDFILE); } catch {}
  }

  async function startNow(modelFile, ctx) {
    if (proc && ready && file === modelFile) {
      try { if ((await get(`http://127.0.0.1:${HELPER_PORT}/health`)).status === 200) return; } catch {}
    }
    await stop();
    const bin = findBin(); if (!bin) throw new Error('The AI engine is not installed yet.');
    const full = path.join(modelsDir, modelFile);
    if (!fs.existsSync(full)) throw new Error('Helper model is not downloaded.');
    // CPU-friendly and small: the helper only writes a few short lines
    const args = ['-m', full, '--port', String(HELPER_PORT), '-c', String(ctx || 2048), '-ngl', '99'];
    const me = spawn(bin, args, { stdio: 'ignore', windowsHide: true });
    proc = me; file = modelFile; ready = false;
    try { fs.mkdirSync(path.dirname(PIDFILE), { recursive: true }); fs.writeFileSync(PIDFILE, String(me.pid)); } catch {}
    me.on('exit', () => { if (proc === me) { proc = null; file = null; ready = false; try { fs.unlinkSync(PIDFILE); } catch {} } });
    for (let i = 0; i < 90; i++) {
      try { if ((await get(`http://127.0.0.1:${HELPER_PORT}/health`)).status === 200) { ready = true; return; } } catch {}
      if (proc !== me) break;
      await new Promise(r => setTimeout(r, i < 10 ? 300 : 1000));
    }
    await stop();
    throw new Error('The helper AI did not start in time.');
  }

  // One start at a time, so two messages arriving together cannot launch two helpers.
  function start(modelFile, ctx) { const run = chain.then(() => startNow(modelFile, ctx)); chain = run.catch(() => {}); return run; }

  return { start, stop, killNow, cleanupStale, isUp: () => !!proc && ready, model: () => file, port: HELPER_PORT, PIDFILE };
}

module.exports = { create, HELPER_PORT };
