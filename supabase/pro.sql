-- Pholama Pro: a 30-day plan bought with a Roblox subscription (100 Robux a month).
-- Run this once in the Supabase SQL editor (after platform.sql and social.sql). It is safe to run again.
-- The database decides who is Pro and what Pro allows. A page cannot give itself Pro: only the server
-- (the cloud function, holding the service key) can write to pholama_pro or redeem a code.

-- ---------- the limits, in ONE place so the page, the cloud function and the database agree ----------
create or replace function public.pholama_limits(p_pro boolean) returns jsonb
language sql immutable as $$
  select case when p_pro then
    jsonb_build_object('max_day', 15, 'max_month', 35, 'projects', 10, 'friends', 10, 'max_dms', 10, 'memories_web', 15, 'memories_pc', 45, 'integration_tokens', 10000)
  else
    jsonb_build_object('max_day', 10, 'max_month', 30, 'projects', 5, 'friends', 5, 'max_dms', 5, 'memories_web', 5, 'memories_pc', 15, 'integration_tokens', 5000)
  end
$$;

-- ---------- who is Pro, and until when ----------
create table if not exists public.pholama_pro (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  until      timestamptz not null,
  roblox_id  bigint,
  updated_at timestamptz not null default now()
);
alter table public.pholama_pro enable row level security;
drop policy if exists "pro read own" on public.pholama_pro;
create policy "pro read own" on public.pholama_pro for select using (auth.uid() = user_id);   -- no insert/update/delete policy: pages cannot write
revoke insert, update, delete on public.pholama_pro from anon, authenticated;

-- One Roblox account can only hold Pro on ONE Pholama account at a time (stops one subscription being shared out).
create unique index if not exists pholama_pro_roblox on public.pholama_pro (roblox_id) where roblox_id is not null;

create or replace function public.pholama_is_pro(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pholama_pro where user_id = p_user and until > now())
$$;
revoke all on function public.pholama_is_pro(uuid) from public, anon, authenticated;
grant execute on function public.pholama_is_pro(uuid) to service_role;        -- server only: a member must not be able to ask whether a named person paid (they read their OWN plan with pholama_my_plan)

-- What the signed-in person's plan is right now (the page uses this for Settings > Plans).
create or replace function public.pholama_my_plan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pro boolean; u timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select until into u from public.pholama_pro where user_id = auth.uid();
  pro := coalesce(u > now(), false);
  return jsonb_build_object('pro', pro, 'until', case when pro then u else null end, 'limits', public.pholama_limits(pro));
end $$;
revoke all on function public.pholama_my_plan() from public, anon;
grant execute on function public.pholama_my_plan() to authenticated;

-- ---------- one-time codes ----------
-- The person asks for a code in Settings > Plans, then types it inside the Roblox game.
-- Only a hash is stored. A code works once, for 15 minutes, for the account that asked for it.
create table if not exists public.pholama_pro_codes (
  code_hash  text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.pholama_pro_codes enable row level security;
revoke all on public.pholama_pro_codes from anon, authenticated;      -- no policies at all: pages cannot read or write it

create or replace function public.pholama_pro_code_new() returns text
language plpgsql security definer set search_path = public as $$
declare c text; recent int;
begin
  if auth.uid() is null then raise exception 'Log in first.'; end if;
  select count(*) into recent from public.pholama_pro_codes where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'Too many codes. Try again in a while.'; end if;
  update public.pholama_pro_codes set expires_at = now() where user_id = auth.uid() and used_at is null and expires_at > now();   -- a new code cancels the old one
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));                                                                  -- 8 characters, 4 billion possibilities
  insert into public.pholama_pro_codes (code_hash, user_id, expires_at) values (encode(sha256(convert_to(c, 'UTF8')), 'hex'), auth.uid(), now() + interval '15 minutes');
  return c;
end $$;
revoke all on function public.pholama_pro_code_new() from public, anon;
grant execute on function public.pholama_pro_code_new() to authenticated;

-- Called ONLY by the cloud function (service key) after the Roblox game proved the subscription.
-- Adds 30 days from now (or from the current end, so renewing early never loses days). Burns the code.
create or replace function public.pholama_pro_redeem(p_code text, p_roblox bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.pholama_pro_codes; cur timestamptz; nu timestamptz; owner uuid;
begin
  if p_roblox is null or p_roblox <= 0 then return jsonb_build_object('ok', false, 'reason', 'roblox'); end if;
  update public.pholama_pro_codes set used_at = now()
   where code_hash = encode(sha256(convert_to(upper(trim(coalesce(p_code, ''))), 'UTF8')), 'hex') and used_at is null and expires_at > now()
   returning * into r;
  if not found then return jsonb_build_object('ok', false, 'reason', 'code'); end if;                                           -- wrong, used, or expired
  select user_id into owner from public.pholama_pro where roblox_id = p_roblox;
  if owner is not null and owner <> r.user_id and exists (select 1 from public.pholama_pro where user_id = owner and until > now()) then
    update public.pholama_pro_codes set used_at = null where code_hash = r.code_hash;                                         -- give the code back
    return jsonb_build_object('ok', false, 'reason', 'roblox-used');                                                          -- that Roblox account already powers another Pholama account
  end if;
  select until into cur from public.pholama_pro where user_id = r.user_id;
  nu := greatest(coalesce(cur, now()), now()) + interval '30 days';
  nu := least(nu, now() + interval '35 days');  -- never stack more than one renewal ahead
  if owner is not null and owner <> r.user_id then delete from public.pholama_pro where user_id = owner; end if;              -- old account's lapsed row
  insert into public.pholama_pro (user_id, until, roblox_id, updated_at) values (r.user_id, nu, p_roblox, now())
    on conflict (user_id) do update set until = excluded.until, roblox_id = excluded.roblox_id, updated_at = now();
  return jsonb_build_object('ok', true, 'until', nu);
end $$;
revoke all on function public.pholama_pro_redeem(text, bigint) from public, anon, authenticated;
grant execute on function public.pholama_pro_redeem(text, bigint) to service_role;

-- Renewal without a code: the game knows the Roblox id is still subscribed, so it extends whoever that id belongs to.
create or replace function public.pholama_pro_renew(p_roblox bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; cur timestamptz; nu timestamptz;
begin
  select user_id, until into u, cur from public.pholama_pro where roblox_id = p_roblox;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if cur > now() + interval '3 days' then return jsonb_build_object('ok', true, 'until', cur, 'extended', false); end if;      -- plenty left: do nothing (stops the game login loop stacking days)
  nu := greatest(cur, now()) + interval '30 days';
  update public.pholama_pro set until = nu, updated_at = now() where user_id = u;
  return jsonb_build_object('ok', true, 'until', nu, 'extended', true);
end $$;
revoke all on function public.pholama_pro_renew(bigint) from public, anon, authenticated;
grant execute on function public.pholama_pro_renew(bigint) to service_role;
