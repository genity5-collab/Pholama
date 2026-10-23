// Helper for LIVE tests: calls the real Free.ai self-hosted model. Needs FREE_AI_API_KEY in the environment.
module.exports = function makeLiveModel(model = 'qwen-coder', maxTokens = 1800) {
  const key = process.env.FREE_AI_API_KEY; if (!key) return null;
  return async function callModel(msgs) {
    const r = await fetch('https://api.free.ai/v1/chat/', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens, temperature: 0.2 }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('model ' + r.status);
    if (j?.free_ai_usage?.source && j.free_ai_usage.source !== 'self_hosted') throw new Error('model not free');
    return String(j?.choices?.[0]?.message?.content || '');
  };
};
