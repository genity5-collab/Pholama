// Reply shield: a local AI must never answer with silence.
// Wraps one model turn. If the reply is empty, or the engine dies before saying anything, it recovers and tries again.
// It NEVER retries once words were already shown (that would repeat text), and never after the user pressed Stop.

const FRIENDLY = 'The AI did not manage to answer this time. It was restarted, so please send your message again. If it keeps happening, start a new chat or pick a smaller model.';

// "Empty" also means only whitespace or an empty thinking block, which the user would see as a blank bubble.
function isEmptyReply(text) {
  // closed thinking blocks, then a thinking block that never closed (the model ran out of room while thinking), then stray tags
  const t = String(text == null ? '' : text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').replace(/<\/?think>/gi, '').trim();
  return t.length === 0;
}

// Errors that mean "the engine itself went away", so a restart plus retry can help. Anything else (bad model, user error) is shown as is.
function isEngineDrop(err) {
  const m = String((err && (err.message || err)) || '').toLowerCase();
  return /terminated|econnreset|socket hang up|other side closed|fetch failed|econnrefused|aborted|stream|premature|engine (stopped|did not)|could not answer/.test(m) && !/user aborted|the operation was aborted due to/.test(m);
}

// run(): one attempt, resolves to the text. onToken is called with streamed text.
// opts: { tries, signal, restart, onRetry }
async function shieldedTurn(run, opts = {}) {
  const tries = opts.tries || 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let shown = 0;                                   // characters already handed to the user during this attempt
    try {
      const text = await run(t => { shown += String(t).length; }, attempt);
      if (!isEmptyReply(text)) return { text, attempts: attempt, recovered: attempt > 1 };
      lastErr = new Error('empty reply');
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw e;             // the user pressed Stop: respect it
      if (shown > 0) throw e;                                       // words were already shown: a retry would repeat them
      if (!isEngineDrop(e) && !/empty reply/.test(String(e.message))) throw e;
      lastErr = e;
    }
    if (opts.signal && opts.signal.aborted) throw lastErr;
    if (attempt < tries) {
      if (opts.onRetry) { try { opts.onRetry(attempt, lastErr); } catch {} }
      if (opts.restart) { try { await opts.restart(attempt); } catch {} }   // bring the engine back before the next try
    }
  }
  return { text: '', attempts: tries, recovered: false, failed: true, error: lastErr };
}

module.exports = { shieldedTurn, isEmptyReply, isEngineDrop, FRIENDLY };
