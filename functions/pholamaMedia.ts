// Pholama Codebase generators (cloud): image 45, music 45, 3D 90, speech 25 credits. One file, no imports (a deploy is a single code string).
// POST { action:'start', kind, prompt, image_url?, seconds? }  -> { url } | { queued, job, token } | { error, code }
// POST { action:'poll',  kind, job, token, gaveUp? }           -> { done:false } | { done:true, url } | { done:true, failed:true, error }
// The Free.ai key stays here. Credits are taken first (database-checked) and given back on any failure, exactly once per job (signed token).
// Secrets: FREE_AI_API_KEY, PHOLAMA_SUPABASE_SERVICE_KEY, PHOLAMA_SEAL_KEY (signs job tokens).
const SB = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

const COST: Record<string, number> = { image: 45, music: 45, '3d': 90, speech: 25 };
const MODEL: Record<string, string> = { image: 'flux2-klein', music: 'ace-step', '3d': 'triposr', speech: 'kokoro' };
const PATH: Record<string, string> = { image: '/v1/image/generate/', music: '/v1/music/generate/', '3d': '/v1/3d/generate/', speech: '/v1/tts/' };
const PLAIN = {
  kind: 'That kind of file cannot be made.',
  empty: 'Describe what to make first.',
  busy: 'The generator is busy right now. You were not charged. Try again in a moment.',
  failed: 'It could not be made. You were not charged.',
  timeout: 'It took too long, so it was stopped. You were not charged.',
  limit: 'Not enough credits for this. They come back by themselves as the week moves on.',
  input: 'The 3D model needs a picture first.',
  login: 'Sign in to Pholama first.',
  setup: 'Generators are not set up yet.',
};
const API = 'https://api.free.ai';
const HOST = /^https:\/\/(api\.)?free\.ai\//;
const FAIL = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired']);
const PROMPT_MAX = 1000, TOKEN_MINUTES = 15;
const clean = (s: unknown) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, PROMPT_MAX);
const own = (k: string) => Object.prototype.hasOwnProperty.call(COST, k);

// ---- signed job token: proves THIS user started THIS job of THIS kind recently, so a refund cannot be invented or repeated for someone else ----
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function sign(seal: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(seal), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)));
}
const same = (a: string, b: string) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
async function makeToken(seal: string, user: string, kind: string, job: string, now: number) { const exp = now + TOKEN_MINUTES * 60000; return exp + '.' + await sign(seal, [user, kind, job, exp].join('|')); }
async function checkToken(seal: string, token: string, user: string, kind: string, job: string, now: number): Promise<boolean> {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(String(token || '')); if (!m) return false;
  if (Number(m[1]) < now) return false;
  return same(m[2], await sign(seal, [user, kind, job, m[1]].join('|')));
}
const refunded = new Set<string>();   // each job is refunded once per running copy of the function; the signed token and its short life bound the rest

type Deps = { fetchFn: typeof fetch; key: string; seal: string; user: string; spend: (c: number) => Promise<boolean>; refund: (c: number) => Promise<void>; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void; now?: () => number };
type Res = { status: number; body: Record<string, unknown> };
const res = (status: number, body: Record<string, unknown>): Res => ({ status, body });

async function call(d: Deps, path: string, payload: unknown): Promise<{ http: number; j: any }> {
  const r = await d.fetchFn(API + path, { method: 'POST', signal: AbortSignal.timeout(50000), headers: { Authorization: 'Bearer ' + d.key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let j: any = {}; try { j = await r.json(); } catch { /* not json */ }
  return { http: r.status, j };
}
function bodyFor(kind: string, prompt: string, extra: Record<string, unknown>) {
  if (kind === 'image') return { model: MODEL.image, prompt, width: 768, height: 768 };
  if (kind === 'speech') return { model: MODEL.speech, text: prompt, voice: 'af_heart' };
  if (kind === 'music') return { model: MODEL.music, prompt, duration: Math.min(30, Math.max(5, Math.floor(Number(extra.seconds)) || 15)) };
  return { model: MODEL['3d'], image_url: String(extra.image_url || '') };
}
function finished(j: any): string {
  const url = String(j?.url || j?.output_url || j?.image_url || j?.audio_url || j?.model_url || '');
  if (!HOST.test(url)) return '';
  const src = j?.free_ai_usage?.source; if (src && src !== 'self_hosted') return '';
  return url;
}

async function start(kind: string, input: Record<string, unknown>, d: Deps): Promise<Res> {
  if (!own(kind)) return res(400, { error: PLAIN.kind, code: 'kind' });
  const prompt = clean(input.prompt);
  if (kind !== '3d' && !prompt) return res(400, { error: PLAIN.empty, code: 'empty' });
  const image_url = String(input.image_url || '');
  if (kind === '3d' && !HOST.test(image_url)) return res(400, { error: PLAIN.input, code: 'input' });
  const cost = COST[kind];
  let took = false; try { took = await d.spend(cost); } catch { took = false; }
  if (!took) return res(429, { error: PLAIN.limit, code: 'limit-month', cost });
  const give = async () => { try { await d.refund(cost); } catch (e) { d.log?.('media refund failed: ' + String(e).slice(0, 80)); } };
  try {
    let last = { http: 0, j: {} as any };
    for (let i = 0; i < 4; i++) {
      last = await call(d, PATH[kind], bodyFor(kind, prompt, { ...input, image_url }));
      if (last.http !== 503 && last.http !== 429) break;
      await (d.sleep || ((ms) => new Promise(r => setTimeout(r, ms))))(3000 * (i + 1));
    }
    const { http, j } = last;
    if (http === 503 || http === 429) { d.log?.('media busy ' + http); await give(); return res(503, { error: PLAIN.busy, code: 'busy' }); }
    if (http < 200 || http >= 300) { d.log?.('media http ' + http + ' ' + String(j?.error?.code || j?.error || '').slice(0, 80)); await give(); return res(502, { error: PLAIN.failed, code: 'failed' }); }
    if (j?.queued === true && j?.job_id) {
      const job = String(j.job_id);
      return res(202, { queued: true, job, kind, cost, position: Number(j.position_in_queue) || 0, token: await makeToken(d.seal, d.user, kind, job, (d.now || Date.now)()) });
    }
    const url = finished(j);
    if (!url) { d.log?.('media empty/foreign result'); await give(); return res(502, { error: PLAIN.failed, code: 'failed' }); }
    return res(200, { url, kind, cost });
  } catch (e) {
    d.log?.('media error ' + String(e).slice(0, 100)); await give();
    return res(502, { error: PLAIN.failed, code: 'failed' });
  }
}

async function poll(kind: string, job: string, token: string, d: Deps, gaveUp = false): Promise<Res> {
  if (!own(kind)) return res(400, { error: PLAIN.kind, code: 'kind' });
  if (!/^[0-9a-f-]{20,64}$/i.test(String(job))) return res(400, { error: PLAIN.failed, code: 'job' });
  const now = (d.now || Date.now)();
  if (!(await checkToken(d.seal, token, d.user, kind, job, now))) return res(400, { error: PLAIN.failed, code: 'token' });   // not started by this person, or too old
  const cost = COST[kind];
  const give = async () => { if (refunded.has(job)) return; refunded.add(job); if (refunded.size > 5000) refunded.clear(); try { await d.refund(cost); } catch (e) { d.log?.('media refund failed: ' + String(e).slice(0, 80)); } };
  if (gaveUp) {
    // The generator offers no cancel for an API key (checked: its cancel route needs a website login), so the job is simply abandoned: it finishes or expires on its side, and the credits go back here.
    await give(); return res(200, { done: true, failed: true, error: PLAIN.timeout, code: 'timeout' });
  }
  try {
    const r = await d.fetchFn('https://free.ai/api/v1/jobs/' + job + '/', { signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + d.key } });
    if (!r.ok) { d.log?.('media poll http ' + r.status); return res(200, { done: false }); }
    const j: any = (await r.json().catch(() => ({})))?.job || {};
    const status = String(j.status || '').toLowerCase();
    if (FAIL.has(status)) { await give(); return res(200, { done: true, failed: true, error: PLAIN.failed, code: 'failed' }); }
    const url = finished({ url: j.output_url, free_ai_usage: j.free_ai_usage });
    if (url && !j.output_expired) return res(200, { done: true, url, kind, cost });
    return res(200, { done: false, status: status === 'running' || status === 'processing' ? 'working' : 'queued', position: Number(j.position_in_queue) || 0, wait: Number(j.estimated_wait_seconds) || 0 });
  } catch (e) {
    d.log?.('media poll error ' + String(e).slice(0, 80));
    return res(200, { done: false });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Use POST.', code: 'method' }, 405);
  const service = Deno.env.get('PHOLAMA_SUPABASE_SERVICE_KEY') || '', aiKey = Deno.env.get('FREE_AI_API_KEY') || '', seal = Deno.env.get('PHOLAMA_SEAL_KEY') || '';
  if (!service || !aiKey || seal.length < 16) return out({ error: PLAIN.setup, code: 'setup' }, 503);
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok) return out({ error: PLAIN.login, code: 'login' }, 401);
  let user = '';
  try {
    const who = await fetch(SB + '/auth/v1/user', { headers: { apikey: service, Authorization: 'Bearer ' + tok } });
    if (!who.ok) return out({ error: PLAIN.login, code: 'login' }, 401);
    user = String((await who.json())?.id || '');
  } catch { return out({ error: PLAIN.login, code: 'login' }, 401); }
  if (!/^[0-9a-f-]{36}$/i.test(user)) return out({ error: PLAIN.login, code: 'login' }, 401);
  const body: any = await req.json().catch(() => ({}));
  const rpc = (fn: string, b: unknown) => fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const d: Deps = {
    fetchFn: fetch, key: aiKey, seal, user, log: (s) => console.log('Media:', s),
    spend: async (c) => { const r = await rpc('pholama_cloud_weekly_spend', { p_user: user, p_cost: c }); if (!r.ok) return false; const raw = await r.json(); const row = Array.isArray(raw) ? (raw[0] || {}) : (raw || {}); return row.ok === true; },   // the database says no with ok:false, not with an HTTP error
    refund: async (c) => { await rpc('pholama_cloud_weekly_refund', { p_user: user, p_cost: c }); },
  };
  const kind = String(body.kind || '');
  const r = body.action === 'poll'
    ? await poll(kind, String(body.job || ''), String(body.token || ''), d, body.gaveUp === true)
    : await start(kind, body, d);
  return out(r.body, r.status);
});
