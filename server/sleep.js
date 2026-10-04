// Pholama sleep. After one day with nobody using an AI, every local AI is shut down so nothing sits in RAM for days.
// Pholama itself stays on (the page, your downloads and settings are fine). It wakes when you run:  pholama awake
// "Using" means a request that would START or USE an AI. Passive calls (status, lists, dashboard refreshes, an open tab
// polling in the background) never count, otherwise one forgotten browser tab would keep it awake forever.
const DAY_MS = 24 * 60 * 60 * 1000;

// Routes that run an AI. Everything else is passive.
const USES_AI = [
  /^\/api\/chat$/, /^\/api\/generate$/, /^\/api\/serve$/, /^\/api\/embed(dings)?$/,
  /^\/v1\/(chat\/completions|completions|embeddings)$/,
];
function usesAi(method, pathname) { return String(method).toUpperCase() === 'POST' && USES_AI.some(r => r.test(pathname)); }

function create({ now = () => Date.now(), limitMs = +process.env.PHOLAMA_SLEEP_MS || DAY_MS, isLoaded, stopAll, onSleep, onWake } = {}) {
  let last = now(), asleep = false, timer = null;
  return {
    // Call for every request. Returns true when the request may go on, false when Pholama is asleep and it would start an AI.
    touch(method, pathname) {
      if (!usesAi(method, pathname)) return true;
      if (asleep) return false;
      last = now(); return true;
    },
    // Called by a timer. Sleeps when idle for the limit. Idle time only counts while an AI is actually loaded.
    async check() {
      if (asleep) return false;
      if (!isLoaded()) { last = Math.max(last, now() - 0); return false; }   // nothing in RAM: nothing to shut down
      if (now() - last < limitMs) return false;
      asleep = true; try { await stopAll(); } catch {} if (onSleep) onSleep(now() - last); return true;
    },
    wake() { if (!asleep) return false; asleep = false; last = now(); if (onWake) onWake(); return true; },
    isAsleep: () => asleep,
    idleMs: () => now() - last,
    limitMs,
    start(everyMs = 60000) { if (timer) return; timer = setInterval(() => { this.check(); }, everyMs); if (timer.unref) timer.unref(); },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
}
module.exports = { create, usesAi, DAY_MS };
