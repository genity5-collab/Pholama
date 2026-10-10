// Pholama Studio AI backend. Uses the owner's Free.ai key, never the browser.
// Required secrets: PHOLAMA_API_KEY and PHOLAMA_SUPABASE_SERVICE_KEY.
const SB = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const FREE_AI = 'https://api.free.ai/v1/chat/';
const MODEL = 'qwen/qwen-2.5-coder-32b-instruct';
const WEEKLY_CAP = 1000;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Content-Type': 'application/json' };
const out = (data: unknown, status = 200) => new Response(JSON.stringify({ errors: status >= 400 ? { errorCode: 'STUDIO_ERROR', errorMessage: String(data) } : null, data: status >= 400 ? null : data }), { status, headers: cors });
const bad = (s: string, status = 400) => out(s, status);
const idOk = (s: unknown) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(String(s || ''));
const week = () => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return bad('Method not allowed.', 405);
  const aiKey = Deno.env.get('PHOLAMA_API_KEY') || '';
  const service = Deno.env.get('PHOLAMA_SUPABASE_SERVICE_KEY') || '';
  if (!aiKey || !service) return bad('Pholama Studio AI is not configured yet.', 503);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return bad('Log in to use Pholama Studio.', 401);
  const who = await fetch(SB + '/auth/v1/user', { headers: { apikey: service, Authorization: 'Bearer ' + token } });
  if (!who.ok) return bad('Your login expired. Log in again.', 401);
  const user = await who.json(); if (!user?.id) return bad('Log in to use Pholama Studio.', 401);
  const body = await req.json().catch(() => ({})); const action = String(body.action || '');
  const headers = { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' };
  const rest = async (path: string, init: RequestInit = {}) => { const r = await fetch(SB + '/rest/v1/' + path, { ...init, headers: { ...headers, ...(init.headers || {}) } }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error('Studio data request failed.'); return j; };
  const own = async (pid: string) => { const rows = await rest('pholama_cloud_projects?select=*&project_id=eq.' + encodeURIComponent(pid) + '&user_id=eq.' + encodeURIComponent(user.id) + '&limit=1'); return rows[0] || null; };
  const legacyUsage = async () => { const rows = await rest('pholama_cloud_usage?select=units&user_id=eq.' + encodeURIComponent(user.id) + '&day=eq.' + week() + '&limit=1'); return Number(rows[0]?.units || 0); };
  const usage = async () => { try { const rows = await rest('pholama_cloud_weekly_usage?select=used&user_id=eq.' + encodeURIComponent(user.id) + '&week_start=eq.' + week() + '&limit=1'); return Number(rows[0]?.used || 0); } catch { return legacyUsage(); } };
  const legacySpend = async (n: number) => { const cost = Math.max(0, Math.ceil(n)); const day = week(); const rows = await rest('pholama_cloud_usage?select=user_id,day,units,msgs&user_id=eq.' + encodeURIComponent(user.id) + '&day=eq.' + day + '&limit=1'); const row = rows[0]; const used = Number(row?.units || 0); if (used + cost > WEEKLY_CAP) return { ok: false, used, cap: WEEKLY_CAP }; if (row) { await rest('pholama_cloud_usage?user_id=eq.' + encodeURIComponent(user.id) + '&day=eq.' + day, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ units: used + cost, msgs: Number(row.msgs || 0) + 1 }) }); } else { await rest('pholama_cloud_usage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: user.id, day, units: cost, msgs: 1 }) }); } return { ok: true, used: used + cost, cap: WEEKLY_CAP }; };
  const spend = async (n: number) => { const r = await fetch(SB + '/rest/v1/rpc/pholama_cloud_weekly_spend', { method: 'POST', headers, body: JSON.stringify({ p_user: user.id, p_cost: Math.max(0, Math.ceil(n)) }) }); if (r.ok) return await r.json(); return legacySpend(n); };
  const generate = async (prompt: string, previous = '') => {
    const started = Date.now();
    const reserve = await spend(50); if (!reserve?.ok) throw new Error('Your Pholama Studio weekly allowance is used up.');
    const system = 'You are Pholama Studio, a careful website-building AI. Return a complete, self-contained HTML document when the user asks for a website. Use inline CSS and JavaScript only. Do not claim to deploy or access files. Keep the result practical and editable. If the user asks for a change, return the complete updated document.';
    const messages = [{ role: 'system', content: system }, ...(previous ? [{ role: 'user', content: 'Existing project output:\n' + previous.slice(0, 30000) }] : []), { role: 'user', content: prompt.slice(0, 12000) }];
    const r = await fetch(FREE_AI, { method: 'POST', headers: { Authorization: 'Bearer ' + aiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 12000 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Studio AI could not answer.');
    const text = String(j?.choices?.[0]?.message?.content || '').trim(); if (!text) throw new Error('Studio AI returned an empty result.');
    const seconds = (Date.now() - started) / 1000;
    const cost = seconds <= 20 ? 50 : Math.max(200, Math.ceil(seconds / 60) * 200);
    if (cost > 50) await spend(cost - 50).catch(() => {});
    return { text, cost, seconds: Math.round(seconds), used: await usage() };
  };
  try {
    if (action === 'usage') return out({ used: await usage(), cap: WEEKLY_CAP, week_start: week() });
    if (action === 'projects') return out(await rest('pholama_cloud_projects?select=*&user_id=eq.' + encodeURIComponent(user.id) + '&order=updated_at.desc'));
    if (action === 'launch') {
      const pid = String(body.projectId || '').trim(), prompt = String(body.prompt || '').trim(), label = String(body.label || pid).slice(0, 80);
      if (!idOk(pid) || !prompt || prompt.length > 12000) return bad('Add a valid project name and a prompt under 12,000 characters.');
      const existing = await own(pid);
      if (existing && existing.status !== 'error') return bad('That project name is already in use.', 409);
      if (existing) await rest('pholama_cloud_projects?project_id=eq.' + encodeURIComponent(pid) + '&user_id=eq.' + encodeURIComponent(user.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ label, prompt, status: 'building', last_error: '', updated_at: new Date().toISOString() }) });
      else await rest('pholama_cloud_projects', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ project_id: pid, user_id: user.id, label, prompt, status: 'building' }) });
      try { const result = await generate(prompt); await rest('pholama_cloud_projects?project_id=eq.' + encodeURIComponent(pid) + '&user_id=eq.' + encodeURIComponent(user.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'ready', output: result.text, tokens_used: result.cost, updated_at: new Date().toISOString() }) }); return out({ projectId: pid, label, status: 'ready', output: result.text, usage: { used: result.used, cap: WEEKLY_CAP } }); }
      catch (e) { await rest('pholama_cloud_projects?project_id=eq.' + encodeURIComponent(pid) + '&user_id=eq.' + encodeURIComponent(user.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'error', last_error: e instanceof Error ? e.message : 'Studio AI failed', updated_at: new Date().toISOString() }) }).catch(() => {}); throw e; }
    }
    if (!idOk(body.projectId)) return bad('Invalid project name.');
    const pid = String(body.projectId), project = await own(pid); if (!project) return bad('Project not found.', 404);
    if (action === 'project') return out(project);
    if (action === 'prompt') { const prompt = String(body.prompt || '').trim(); if (!prompt || prompt.length > 12000) return bad('Add a prompt under 12,000 characters.'); const result = await generate(prompt, project.output || ''); await rest('pholama_cloud_projects?project_id=eq.' + encodeURIComponent(pid) + '&user_id=eq.' + encodeURIComponent(user.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ prompt, status: 'ready', output: result.text, tokens_used: Number(project.tokens_used || 0) + result.cost, updated_at: new Date().toISOString() }) }); return out({ projectId: pid, status: 'ready', output: result.text, usage: { used: result.used, cap: WEEKLY_CAP } }); }
    if (action === 'deploy') return bad('Publishing is not connected yet. Your generated Studio project is saved and previewable here.');
    return bad('Unknown Pholama Studio action.');
  } catch (e) { return bad(e instanceof Error ? e.message : 'Pholama Studio failed.', 502); }
});
