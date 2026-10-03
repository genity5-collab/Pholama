// Makes a conversation fit the model's context window.
// Without this, a long chat is rejected by the engine ("request exceeds the available context size") and the AI just goes quiet.
// Oldest turns are dropped first. The system prompt and the newest message are always kept.

// Cheap token estimate. Deliberately on the high side (3 characters per token) so we trim a little early instead of overflowing.
const tokensOf = (text) => Math.ceil(String(text == null ? '' : text).length / 3) + 4;
const msgTokens = (m) => tokensOf(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) ;

// messages: [{role, content}], ctx: the window in tokens, reply: tokens to leave free for the answer.
// Returns { messages, dropped, trimmedLast } and never mutates the input.
function fitToContext(messages, ctx, reply) {
  const list = (messages || []).map(m => ({ ...m }));
  const room = Math.max(256, (ctx || 4096) - (reply == null ? Math.min(1024, Math.floor((ctx || 4096) / 4)) : reply));
  const sys = list.filter(m => m.role === 'system');
  let rest = list.filter(m => m.role !== 'system');
  const sysCost = sys.reduce((n, m) => n + msgTokens(m), 0);
  let dropped = 0, trimmedLast = false;

  // a system prompt that alone eats the window would leave no room for the conversation: shorten it
  let sysMsgs = sys;
  if (sysCost > room * 0.6) {
    const keep = Math.floor(room * 0.6 * 3);
    sysMsgs = sys.map((m, i) => i === 0 ? { ...m, content: String(m.content).slice(0, keep) } : m);
  }
  const budget = room - sysMsgs.reduce((n, m) => n + msgTokens(m), 0);

  const cost = (arr) => arr.reduce((n, m) => n + msgTokens(m), 0);
  // drop the oldest turns until it fits (always keep at least the newest message)
  while (rest.length > 1 && cost(rest) > budget) { rest.shift(); dropped++; }
  // the history must start with a user turn, otherwise some chat templates reject it
  while (rest.length > 1 && rest[0].role !== 'user') { rest.shift(); dropped++; }
  // last resort: the newest message alone is too big, cut its start (the end is usually the actual question)
  if (rest.length === 1 && cost(rest) > budget) {
    const chars = Math.max(60, (budget - 8) * 3);
    const c = typeof rest[0].content === 'string' ? rest[0].content : JSON.stringify(rest[0].content);
    rest = [{ ...rest[0], content: '[...earlier part cut to fit...]\n' + c.slice(-chars) }]; trimmedLast = true;
  }
  return { messages: [...sysMsgs, ...rest], dropped, trimmedLast };
}

// Context size to run the engine with: the model's own limit, lowered on PCs with little RAM (a bigger window needs more memory).
function chooseContext(modelCtx, ramGB) {
  const want = modelCtx || 4096;
  const cap = !ramGB ? 4096 : ramGB < 6 ? 4096 : ramGB < 10 ? 8192 : 16384;
  return Math.max(2048, Math.min(want, cap));
}

module.exports = { fitToContext, chooseContext, tokensOf };
