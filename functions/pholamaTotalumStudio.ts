// Pholama Studio on Totalum. The Totalum key stays here, never in the browser.
// Required secrets: TOTALUM_API_KEY and PHOLAMA_SUPABASE_SERVICE_KEY (used only to verify the login).
const SB = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const TOTALUM = 'https://api-accounts.totalum.app/api/v1/vcaas';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Content-Type': 'application/json' };
const out = (data: unknown, status = 200) => new Response(JSON.stringify({ errors: status >= 400 ? { errorCode: 'STUDIO_ERROR', errorMessage: String(data) } : null, data: status >= 400 ? null : data }), { status, headers: cors });
const bad = (s: string, status = 400) => out(s, status);
const PER_USER_PROJECTS = 3;
const MAX_PROMPT = 8000;

// Short, stable owner tag from the user id. Every project this user makes starts with it.
async function tag(userId: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pholama-studio:' + userId)));
  return 'u' + Array.from(d).slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
}
const slug = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18).replace(/-+$/g, '');
const preview = (p: any) => (p?.developmentUrlFieldToUse === 'cachedDevelopmentUrl' ? p.cachedDevelopmentUrl : (p?.temporalDevelopmentProjectUrl || p?.cachedDevelopmentUrl)) || '';
const cleanErr = (j: any, fallback: string) => {
  const c = j?.errors?.errorCode;
  if (c === 'INSUFFICIENT_CREDITS') return 'Pholama Studio is out of build credits right now.';
  if (c === 'AGENT_RUNNING') return 'The builder is still working on this project. Wait for it to finish.';
  if (c === 'RATE_LIMIT_EXCEEDED') return 'Too many builds at once. Try again in a minute.';
  if (c === 'PROMPT_SECURITY_VIOLATION') return 'That prompt was refused by the safety check.';
  if (c === 'INVALID_PROJECT_NAME' || c === 'INVALID_PROJECT_NAME_LENGTH') return 'Pick a different project name (letters and numbers, up to 18 characters).';
  if (c === 'PROJECT_ALREADY_EXISTS') return 'That project name is taken. Try another.';
  if (c === 'PROJECT_CREDIT_LIMIT_REACHED') return 'This project reached its build limit for the month.';
  return fallback;
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return bad('Method not allowed.', 405);
  const key = Deno.env.get('TOTALUM_API_KEY') || '';
  const service = Deno.env.get('PHOLAMA_SUPABASE_SERVICE_KEY') || '';
  if (!key || !service) return bad('Pholama Studio is not configured yet.', 503);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return bad('Log in to use Pholama Studio.', 401);
  const who = await fetch(SB + '/auth/v1/user', { headers: { apikey: service, Authorization: 'Bearer ' + token } });
  if (!who.ok) return bad('Your login expired. Log in again.', 401);
  const user = await who.json(); if (!user?.id) return bad('Log in to use Pholama Studio.', 401);
  const owner = await tag(String(user.id));
  const body = await req.json().catch(() => ({})); const action = String(body.action || '');

  const tl = async (method: string, path: string, payload?: unknown) => {
    const r = await fetch(TOTALUM + path, { method, headers: { 'api-key': key, 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && !j?.errors, status: r.status, j };
  };
  const mine = (id: unknown) => typeof id === 'string' && id.startsWith(owner + '-') && /^[a-z][a-z0-9-]{3,34}$/.test(id);
  const ownedList = async () => { const r = await tl('GET', '/projects'); if (!r.ok) throw new Error(cleanErr(r.j, 'Could not load your projects.')); return (Array.isArray(r.j.data) ? r.j.data : []).filter((p: any) => mine(p.projectId)); };

  try {
    if (action === 'credits') {
      const r = await tl('GET', '/account'); if (!r.ok) throw new Error('Could not read the build balance.');
      return out({ credits: Number(r.j.data?.credits || 0) });
    }
    if (action === 'projects') {
      const list = await ownedList();
      return out(list.map((p: any) => ({ projectId: p.projectId, label: p.label || p.projectId, status: p.agentProcessStatus || 'idle', createdAt: p.createdAt, previewImageUrl: p.previewImageUrl || '' })));
    }
    if (action === 'launch') {
      const label = String(body.label || '').trim().slice(0, 80), prompt = String(body.prompt || '').trim();
      const base = slug(body.projectId || label);
      if (!base || base.length < 2) return bad('Give the project a name with letters or numbers.');
      if (!prompt || prompt.length > MAX_PROMPT) return bad('Add a build prompt under ' + MAX_PROMPT + ' characters.');
      if ((await ownedList()).length >= PER_USER_PROJECTS) return bad('You can have ' + PER_USER_PROJECTS + ' Studio projects. Open one of them instead.', 403);
      const r = await tl('POST', '/projects/launch', { projectId: owner + '-' + base, label: label || base, prompt });
      if (!r.ok) return bad(cleanErr(r.j, 'The builder could not start this project.'), r.status === 402 ? 402 : r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403 ? 400 : 502);
      const d = r.j.data || {};
      return out({ projectId: d.projectId, label: d.label || label, started: !!d.agent?.started, expectedMinutes: d.agent?.expectedMinutes || null, warnings: (d.warnings || []).length });
    }

    if (!mine(body.projectId)) return bad('Project not found.', 404);
    const pid = String(body.projectId);

    if (action === 'status') {
      const [s, p] = await Promise.all([tl('GET', `/projects/${pid}/agent/status`), tl('GET', `/projects/${pid}`)]);
      if (!s.ok || !p.ok) return bad('Project not found.', 404);
      const msgs = (s.j.data?.realtimeConversation || []).filter((m: any) => m.author === 'agent').slice(-12).map((m: any) => ({ text: String(m.message || '').slice(0, 600), type: m.messageType, at: m.createdAt }));
      const pd = p.j.data || {};
      return out({ projectId: pid, label: pd.label || pid, status: s.j.data?.status || 'idle', done: s.j.data?.status === 'done', creditsSpent: s.j.data?.creditsSpent ?? null, expectedMinutes: s.j.data?.expectedMinutes ?? null, messages: msgs, previewUrl: preview(pd), productionUrl: pd.productionProjectUrl || '', deployment: pd.deployment?.status || null });
    }
    if (action === 'prompt') {
      const prompt = String(body.prompt || '').trim();
      if (!prompt || prompt.length > MAX_PROMPT) return bad('Add a prompt under ' + MAX_PROMPT + ' characters.');
      const r = await tl('POST', `/projects/${pid}/agent/start`, { prompt });
      if (!r.ok) return bad(cleanErr(r.j, 'The builder could not take that change.'), r.status === 409 ? 409 : r.status === 402 ? 402 : 502);
      return out({ projectId: pid, status: 'init' });
    }
    if (action === 'stop') {
      const r = await tl('POST', `/projects/${pid}/agent/stop`);
      if (!r.ok) return bad(cleanErr(r.j, 'Nothing is running to stop.'), 400);
      return out({ projectId: pid, stopped: true });
    }
    if (action === 'versions') {
      const r = await tl('GET', `/projects/${pid}/versions?limit=15`);
      if (!r.ok) return bad('Could not load versions.', 502);
      return out((r.j.data?.versions || []).map((v: any) => ({ id: v._id, name: v.name || 'Version', createdAt: v.createdAt })));
    }
    if (action === 'recover') {
      const vid = String(body.versionId || ''); if (!/^[A-Za-z0-9_-]{6,64}$/.test(vid)) return bad('Pick a version.');
      const r = await tl('POST', `/projects/${pid}/versions/${vid}/recover`);
      if (!r.ok) return bad(cleanErr(r.j, 'Could not restore that version.'), 502);
      return out({ projectId: pid, recovering: true });
    }
    if (action === 'deploy') {
      const r = await tl('POST', `/projects/${pid}/deployments/deploy`);
      if (!r.ok) return bad(r.j?.errors?.errorCode === 'SERVER_NOT_READY' ? 'The project server is waking up. Try again in a minute.' : cleanErr(r.j, 'Could not start the deployment.'), r.status === 409 ? 409 : 502);
      return out({ projectId: pid, status: 'deploying' });
    }
    if (action === 'deploystatus') {
      const [d, p] = await Promise.all([tl('GET', `/projects/${pid}/deployments/status`), tl('GET', `/projects/${pid}`)]);
      return out({ status: d.j?.data?.status || null, url: p.j?.data?.productionProjectUrl || '' });
    }
    return bad('Unknown Pholama Studio action.');
  } catch (e) { const m = e instanceof Error ? e.message : 'Pholama Studio failed.'; return bad(m, /out of build credits/.test(m) ? 402 : 502); }
});
