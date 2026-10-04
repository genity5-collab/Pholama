// Low-memory behaviour. Pure decisions (no process, no files) so they are tested on their own; server.js does the acting.
//
//   free RAM >= 3 GB   normal   full speed, normal settings
//   free RAM <  3 GB   low      gentler: smaller chat memory, compressed cache, fewer threads, a short rest between replies
//   free RAM <  1.5 GB critical unload the model to give its memory back, and say why (it loads again on the next message)
//
// "free" means memory the computer could hand out right now (not total RAM), so a busy PC counts as low even if it has 16 GB.
const GB = 1024 ** 3;
const LOW_GB = 3, CRITICAL_GB = 1.5;
const IDLE_NORMAL_MS = 60 * 60 * 1000;        // unload after an hour unused
const IDLE_LOW_MS = 10 * 60 * 1000;           // unload after 10 minutes unused when memory is short
const REST_LOW_MS = 400;                      // rest between replies when low

// freeBytes: what the OS reports as available. Returns 'normal' | 'low' | 'critical'. Anything unreadable counts as normal (never block chat on a guess).
function levelFor(freeBytes) {
  const b = Number(freeBytes);
  if (!Number.isFinite(b) || b <= 0) return 'normal';
  if (b < CRITICAL_GB * GB) return 'critical';
  if (b < LOW_GB * GB) return 'low';
  return 'normal';
}

// The engine settings to use for a level. `ctx` is what the model would normally get, `cpus` the number of CPU cores.
function settingsFor(level, ctx, cpus) {
  const c = Math.max(512, Math.floor(+ctx || 4096)), n = Math.max(1, Math.floor(+cpus || 2));
  if (level === 'critical' || level === 'low') {
    return {
      ctx: Math.max(1024, Math.min(c, level === 'critical' ? 1024 : 2048)),       // less chat memory
      cacheType: 'q8_0',                                                           // the chat memory itself takes about half the space
      threads: Math.max(1, Math.min(n - 1, 4)),                                    // leave a core for the rest of the computer
      restMs: REST_LOW_MS,
    };
  }
  return { ctx: c, cacheType: null, threads: null, restMs: 0 };
}

// Extra command line words for the engine. Nothing is added at the normal level, so normal behaviour is exactly as before.
function engineArgs(s) {
  const a = [];
  if (s.cacheType) a.push('--cache-type-k', s.cacheType, '--cache-type-v', s.cacheType);
  if (s.threads) a.push('--threads', String(s.threads));
  return a;
}

// Should the loaded model be unloaded now? lastUsedMs = when it last answered (ms since 1970), busy = a reply is being written.
function shouldUnload(level, lastUsedMs, nowMs, busy) {
  if (busy) return false;                                   // never cut off a reply
  if (level === 'critical') return true;
  const idle = nowMs - lastUsedMs;
  return idle >= (level === 'low' ? IDLE_LOW_MS : IDLE_NORMAL_MS);
}

// One plain sentence for the chat log / status, or '' when there is nothing to say.
function describe(level, freeBytes) {
  const g = (freeBytes / GB).toFixed(1);
  if (level === 'critical') return `Only ${g} GB of memory is free. Pholama unloaded the AI to give it back. It loads again on your next message. A smaller model will help.`;
  if (level === 'low') return `Memory is low (${g} GB free). Pholama is running gently: shorter chat memory, a compressed cache and short rests between replies.`;
  return '';
}

module.exports = { GB, LOW_GB, CRITICAL_GB, IDLE_NORMAL_MS, IDLE_LOW_MS, REST_LOW_MS, levelFor, settingsFor, engineArgs, shouldUnload, describe };
