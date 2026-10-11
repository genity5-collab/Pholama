// Pholama Studio (website). A real workspace on your own stack: projects, files, AI runs, secrets and the optional database all live in YOUR Supabase,
// and the AI is Free.ai's free self-hosted model. No third-party builder. Keys stay here, never in the browser.
// Secrets needed: PHOLAMA_SUPABASE_SERVICE_KEY (verifies the login and stores data), FREE_AI_API_KEY (the AI), PHOLAMA_SEAL_KEY (seals saved secrets; 32+ random characters).
import { handle, MODEL, DAILY_RUNS } from './siteStudioRoutes.ts';
import { isSelfHosted } from './agentsCore.ts';
import { makeRest } from './siteStudioSupabase.ts';

const SB = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const FREE_AI = 'https://api.free.ai/v1/chat/';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Content-Type': 'application/json' };
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  // Proves the code that is live behaves exactly like the code that was tested. No login, no data, no secrets.
  const service = Deno.env.get('PHOLAMA_SUPABASE_SERVICE_KEY') || '', aiKey = Deno.env.get('FREE_AI_API_KEY') || '', seal = Deno.env.get('PHOLAMA_SEAL_KEY') || '';
  if (!service || !aiKey || seal.length < 32) return send(503, { error: 'Pholama Studio is not configured yet.' });
  if (!isSelfHosted(MODEL)) return send(500, { error: 'Pholama Studio is not available right now.' });      // a premium model can never be called
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(401, { error: 'Log in to use Pholama Studio.' });
  const who = await fetch(SB + '/auth/v1/user', { headers: { apikey: service, Authorization: 'Bearer ' + token } });
  if (!who.ok) return send(401, { error: 'Your login expired. Log in again.' });
  const user = await who.json().catch(() => null); if (!user?.id) return send(401, { error: 'Log in to use Pholama Studio.' });
  const uid = String(user.id);

  // The path after the function name is the route the workspace screen asked for, e.g. .../pholamaSiteStudio/runs/r123
  const url = new URL(req.url), after = url.pathname.split('/pholamaSiteStudio')[1] || '';
  const path = after.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  let body: any = {}; if (req.method !== 'GET' && req.method !== 'DELETE') body = await req.json().catch(() => ({})); else if (req.method === 'DELETE') body = await req.json().catch(() => ({}));
  const rest = makeRest(SB, service);

  const callModel = async (msgs: { role: string; content: string }[], o?: { signal?: AbortSignal }) => {
    const r = await fetch(FREE_AI, { method: 'POST', headers: { Authorization: 'Bearer ' + aiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages: msgs, max_tokens: 1800, temperature: 0.2 }), signal: o?.signal ?? AbortSignal.timeout(38000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('model ' + r.status);      // the provider's own message is never passed on
    if (j?.free_ai_usage?.source && j.free_ai_usage.source !== 'self_hosted') throw new Error('model not free');   // never silently spend premium tokens
    return String(j?.choices?.[0]?.message?.content || '');
  };
  // Atomic: two requests cannot both take the last run of the day.
  const spend = async (u: string, n: number) => {
    const r = await fetch(SB + '/rest/v1/rpc/pholama_site_spend', { method: 'POST', headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_user: u, p_n: n, p_cap: DAILY_RUNS }) });
    if (!r.ok) throw new Error('allowance unavailable'); const v = await r.json().catch(() => -1); return Number(v) >= 0;
  };

  try {
    const res = await handle({ method: req.method, path, query: url.searchParams, body }, { uid, rest, master: seal, callModel, spend });
    return send(res.status, res.body);
  } catch { return send(500, { error: 'Something went wrong. Try again in a moment.' }); }
});
