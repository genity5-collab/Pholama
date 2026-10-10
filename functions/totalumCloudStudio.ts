// Secure Totalum proxy for the website's Pholama Studio.
// TOTALUM_API_KEY never reaches the browser. This function is intentionally closed until the secret is configured.
const SB = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Content-Type': 'application/json' };
const out = (data: unknown, status = 200) => new Response(JSON.stringify({ errors: status >= 400 ? { errorCode: 'CLOUD_STUDIO_ERROR', errorMessage: String(data) } : null, data: status >= 400 ? null : data }), { status, headers: cors });
const bad = (s: string, status = 400) => out(s, status);
const idOk = (s: unknown) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(String(s || ''));

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return bad('Method not allowed.', 405);
  const totalum = Deno.env.get('TOTALUM_API_KEY') || '';
  const service = Deno.env.get('PHOLAMA_SUPABASE_SERVICE_KEY') || '';
  if (!totalum || !service) return bad('Pholama Studio is not connected yet. The secure backend key is missing.', 503);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return bad('Log in to use Pholama Studio.', 401);
  const who = await fetch(SB + '/auth/v1/user', { headers: { apikey: service, Authorization: 'Bearer ' + token } });
  if (!who.ok) return bad('Your login expired. Log in again.', 401);
  const user = await who.json(); if (!user?.id) return bad('Log in to use Pholama Studio.', 401);
  const body = await req.json().catch(() => ({})); const action = String(body.action || '');
  const t = async (path: string, init: RequestInit = {}) => { const r = await fetch('https://api-accounts.totalum.app/api/v1/vcaas' + path, { ...init, headers: { 'api-key': totalum, 'Content-Type': 'application/json', ...(init.headers || {}) } }); const j = await r.json().catch(() => ({})); if (!r.ok || j.errors) throw new Error(j.errors?.errorMessage || 'Cloud Studio request failed.'); return j.data; };
  const own = async (pid: string) => { const rows = await fetch(SB + '/rest/v1/pholama_cloud_projects?select=project_id,label&project_id=eq.' + encodeURIComponent(pid) + '&user_id=eq.' + encodeURIComponent(user.id) + '&limit=1', { headers: { apikey: service, Authorization: 'Bearer ' + service } }).then(r => r.json()); return rows[0] || null; };
  try {
    if (action === 'account') return out(await t('/account'));
    if (action === 'projects') {
      const rows = await fetch(SB + '/rest/v1/pholama_cloud_projects?select=project_id,label,created_at&user_id=eq.' + encodeURIComponent(user.id) + '&order=created_at.desc', { headers: { apikey: service, Authorization: 'Bearer ' + service } }).then(r => r.json());
      const full = await Promise.all((rows || []).map(async (r: any) => { try { const p = await t('/projects/' + encodeURIComponent(r.project_id)); return { ...p, projectId: r.project_id, label: r.label || p.label }; } catch { return { projectId: r.project_id, label: r.label, status: 'unavailable' }; } }));
      return full;
    }
    if (action === 'launch') {
      const projectId = String(body.projectId || '').trim(), prompt = String(body.prompt || '').trim();
      if (!idOk(projectId) || !prompt || prompt.length > 12000) return bad('Add a valid project name and a prompt under 12,000 characters.');
      const created = await t('/projects/launch', { method: 'POST', body: JSON.stringify({ projectId, prompt, label: String(body.label || projectId).slice(0, 80) }) });
      const actual = String(created.projectId || projectId);
      const r = await fetch(SB + '/rest/v1/pholama_cloud_projects', { method: 'POST', headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ project_id: actual, user_id: user.id, label: String(created.label || body.label || projectId).slice(0, 80) }) });
      if (!r.ok) throw new Error('Project was created but ownership could not be recorded.');
      return out(created);
    }
    if (!idOk(body.projectId)) return bad('Invalid project id.');
    const pid = String(body.projectId), owned = await own(pid); if (!owned) return bad('Project not found.', 404);
    if (action === 'project') return out(await t('/projects/' + encodeURIComponent(pid)));
    if (action === 'status') return out(await t('/projects/' + encodeURIComponent(pid) + '/agent/status'));
    if (action === 'prompt') { const prompt = String(body.prompt || '').trim(); if (!prompt || prompt.length > 12000) return bad('Add a prompt under 12,000 characters.'); return out(await t('/projects/' + encodeURIComponent(pid) + '/agent/start', { method: 'POST', body: JSON.stringify({ prompt }) })); }
    if (action === 'deploy') return out(await t('/projects/' + encodeURIComponent(pid) + '/deployments/deploy', { method: 'POST', body: JSON.stringify({}) }));
    return bad('Unknown Cloud Studio action.');
  } catch (e) { return bad(e instanceof Error ? e.message : 'Cloud Studio request failed.', 502); }
});
