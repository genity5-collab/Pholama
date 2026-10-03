// Pholama lag guard. Watches the PC while a LOCAL model is loaded and stops local models if the PC is really struggling.
// It only ever stops local AIs (the llama-server child and Ollama models). Cloud Agent Max, the website and browser models are untouched.
// Rule: never act on one bad reading. Lag must be SUSTAINED (several checks in a row), and never during a model's start-up.
const fs = require('fs');
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

const CFG = {
  every: +process.env.PHOLAMA_GUARD_EVERY_MS || 3000,      // how often to look
  bad: +process.env.PHOLAMA_GUARD_BAD_CHECKS || 4,          // this many bad looks in a row = lag (about 12 s)
  grace: +process.env.PHOLAMA_GUARD_GRACE_MS || 45000,      // after a model starts, loading is allowed to be heavy
  minFreeMB: +process.env.PHOLAMA_GUARD_MIN_FREE_MB || 400, // free RAM below this is critical
  minFreePct: 0.04,                                         // ...or below 4% of all RAM
  loopMs: +process.env.PHOLAMA_GUARD_LOOP_MS || 1500,       // Pholama itself frozen for this long = the PC is overloaded
  cpuPct: +process.env.PHOLAMA_GUARD_CPU_PCT || 97,         // whole-PC CPU at this level...
  cpuChecks: 8,                                             // ...for this many checks (about 24 s) counts as lag
};

// Available memory in MB. Linux: MemAvailable (free RAM alone would cry wolf because of the file cache).
function freeMemMB() {
  if (process.platform === 'linux') {
    try { const m = /MemAvailable:\s+(\d+)\s*kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) return Math.round(+m[1] / 1024); } catch {}
  }
  return Math.round(os.freemem() / 1048576);
}

// CPU use of the whole PC since the last call, 0..100.
function makeCpuMeter() {
  let prev = os.cpus();
  return () => {
    const cur = os.cpus(); let idle = 0, total = 0;
    cur.forEach((c, i) => { const p = prev[i] || c; for (const k of Object.keys(c.times)) { const d = c.times[k] - (p.times[k] || 0); total += d; if (k === 'idle') idle += d; } });
    prev = cur; return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
  };
}

// readings: { freeMB, totalMB, cpu, loopMs }. Returns the reason the PC is struggling, or null.
function judge(r, cfg = CFG) {
  if (r.freeMB != null && r.totalMB && (r.freeMB < cfg.minFreeMB || r.freeMB < r.totalMB * cfg.minFreePct)) return `the PC is almost out of memory (${r.freeMB} MB free)`;
  if (r.loopMs != null && r.loopMs > cfg.loopMs) return `the PC is freezing up (Pholama stalled for ${(r.loopMs / 1000).toFixed(1)} s)`;
  return null;
}

// deps (all replaceable for tests): isLoaded(), startedAt(), stopLocal(reason), read(), onStop(reason)
function createGuard(deps, cfg = CFG) {
  let timer = null, badRun = 0, cpuRun = 0, stopped = false, last = null;
  const meter = makeCpuMeter();
  const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
  const read = deps.read || (() => ({ freeMB: freeMemMB(), totalMB: Math.round(os.totalmem() / 1048576), cpu: meter(), loopMs: loop.max / 1e6 }));
  async function check() {
    const r = read(); loop.reset(); last = r;
    if (!deps.isLoaded()) { badRun = 0; cpuRun = 0; return null; }                       // nothing local is running: nothing to protect
    if (Date.now() - (deps.startedAt() || 0) < cfg.grace) { badRun = 0; cpuRun = 0; return null; }   // model is still loading: heavy use is normal
    let why = judge(r, cfg);
    cpuRun = r.cpu >= cfg.cpuPct ? cpuRun + 1 : 0;
    if (!why && cpuRun >= cfg.cpuChecks) why = `the CPU has been maxed out for ${Math.round(cpuRun * cfg.every / 1000)} s`;
    badRun = why ? badRun + 1 : 0;
    if (why && badRun >= cfg.bad) {
      badRun = 0; cpuRun = 0; stopped = true;
      try { await deps.stopLocal(why); } catch (e) { /* keep watching even if a stop failed */ }
      if (deps.onStop) deps.onStop(why);
      return why;
    }
    return null;
  }
  return {
    start() { if (!timer) { timer = setInterval(() => { check().catch(() => {}); }, cfg.every); if (timer.unref) timer.unref(); } },
    stop() { if (timer) clearInterval(timer); timer = null; loop.disable(); },
    check, status: () => ({ running: !!timer, lastStopped: stopped, last }),
  };
}

module.exports = { createGuard, judge, freeMemMB, CFG };
