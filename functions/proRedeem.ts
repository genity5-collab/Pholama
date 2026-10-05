// Pholama Pro: the Roblox game calls this AFTER it has checked the player's subscription with Roblox.
// POST { secret, code, robloxId }                 -> { ok:true, until } or { ok:false, reason }        (first time: needs the code from Settings > Plans)
// POST { secret, robloxId, renew:true }           -> { ok:true, until, extended } or { ok:false }       (later logins: no code, extends only when under 3 days are left)
// The secret is PHOLAMA_PRO_SECRET (a function secret, never in the repo). If it is not set, this refuses everything.
// The game must only call this when MarketplaceService:GetUserSubscriptionStatusAsync(player, 'EXP-6721075596832670281').IsSubscribed is true.

const SB = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

// Same answer, same time, whether the first letter or the last one is wrong (no guessing the secret letter by letter).
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

// Slow down anyone guessing: at most 20 tries a minute from one place (per running copy of the function; the database limits the rest).
const tries = new Map<string, number[]>();
function tooMany(ip: string): boolean {
  const now = Date.now(), list = (tries.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); tries.set(ip, list);
  if (tries.size > 2000) tries.clear();
  return list.length > 20;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return out({ ok: false, reason: 'method' }, 405);
  const key = Deno.env.get('PHOLAMA_SUPABASE_SERVICE_KEY') || '';
  const secret = Deno.env.get('PHOLAMA_PRO_SECRET') || '';
  if (!key || secret.length < 8) return out({ ok: false, reason: 'setup' }, 503);          // no secret set = closed, never open
  const ip = (req.headers.get('x-forwarded-for') || 'x').split(',')[0].trim();
  if (tooMany(ip)) return out({ ok: false, reason: 'slow-down' }, 429);
  const body = await req.json().catch(() => ({}));
  if (!same(String(body.secret || ''), secret)) return out({ ok: false, reason: 'secret' }, 401);

  const robloxId = Number(body.robloxId);
  if (!Number.isSafeInteger(robloxId) || robloxId <= 0) return out({ ok: false, reason: 'roblox' }, 400);
  const rpc = (fn: string, args: unknown) => fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  try {
    let r: Response;
    if (body.renew === true) r = await rpc('pholama_pro_renew', { p_roblox: robloxId });
    else {
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[0-9A-F]{8}$/.test(code)) return out({ ok: false, reason: 'code' }, 400);
      r = await rpc('pholama_pro_redeem', { p_code: code, p_roblox: robloxId });
    }
    if (!r.ok) return out({ ok: false, reason: 'server' }, 502);
    return out(await r.json());
  } catch {
    return out({ ok: false, reason: 'server' }, 502);
  }
});
