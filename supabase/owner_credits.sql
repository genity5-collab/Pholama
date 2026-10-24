-- Pholama: per-account credit allowance + the Codebase monthly pool, in ONE file. Safe to run again.
-- Run it in the Supabase SQL editor BEFORE the new pholamaCloud function is deployed.
-- (It includes everything from codebase_pool.sql, so you do not need to run that one separately.)

-- 1) A per-account extra allowance (credits on top of the normal 1,500 a week). Only the server can read or change it.
create table if not exists public.pholama_credit_bonus (
  user_id uuid primary key references auth.users(id) on delete cascade,
  extra integer not null default 0 check (extra >= 0 and extra <= 1000000),
  note text,
  updated_at timestamptz not null default now()
);
alter table public.pholama_credit_bonus enable row level security;
revoke all on public.pholama_credit_bonus from anon, authenticated;

create or replace function public.pholama_credit_extra(p_user uuid) returns integer
language sql security definer set search_path = public stable as $$
  select coalesce((select extra from public.pholama_credit_bonus where user_id = p_user), 0)
$$;
revoke all on function public.pholama_credit_extra(uuid) from public, anon, authenticated;
grant execute on function public.pholama_credit_extra(uuid) to service_role;

-- 2) The weekly counter may now go past 1,500 for accounts that have an allowance (the cap per account = 1,500 + extra).
alter table public.pholama_cloud_weekly_usage drop constraint if exists pholama_cloud_weekly_usage_used_check;
alter table public.pholama_cloud_weekly_usage add constraint pholama_cloud_weekly_usage_used_check check (used >= 0 and used <= 1001500);

create or replace function public.pholama_cloud_weekly_spend(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date - extract(isodow from (now() at time zone 'utc'))::int + 1;
        n int; cap int := 1500 + public.pholama_credit_extra(p_user); c int := greatest(0, least(coalesce(p_cost, 0), 1500));
begin
  insert into public.pholama_cloud_weekly_usage(user_id, week_start, used) values (p_user, d, c)
    on conflict (user_id, week_start) do update set used = public.pholama_cloud_weekly_usage.used + c, updated_at = now()
    where public.pholama_cloud_weekly_usage.used + c <= cap returning used into n;
  if n is null then select used into n from public.pholama_cloud_weekly_usage where user_id = p_user and week_start = d; return jsonb_build_object('ok', false, 'used', coalesce(n, cap), 'cap', cap); end if;
  return jsonb_build_object('ok', true, 'used', n, 'cap', cap);
end $$;
revoke all on function public.pholama_cloud_weekly_spend(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_cloud_weekly_spend(uuid, integer) to service_role;

-- 3) The Codebase monthly pool (15,000 a month, plus the same per-account allowance).
create table if not exists public.pholama_codebase_monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null,
  used integer not null default 0 check (used >= 0 and used <= 1015000),
  updated_at timestamptz not null default now(),
  primary key (user_id, month_start)
);
alter table public.pholama_codebase_monthly_usage drop constraint if exists pholama_codebase_monthly_usage_used_check;
alter table public.pholama_codebase_monthly_usage add constraint pholama_codebase_monthly_usage_used_check check (used >= 0 and used <= 1015000);
alter table public.pholama_codebase_monthly_usage enable row level security;
revoke all on public.pholama_codebase_monthly_usage from anon, authenticated;

create or replace function public.pholama_codebase_spend(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := date_trunc('month', now() at time zone 'utc')::date; n int; cap int := 15000 + public.pholama_credit_extra(p_user); c int := greatest(0, least(coalesce(p_cost, 0), 15000));
begin
  insert into public.pholama_codebase_monthly_usage(user_id, month_start, used) values (p_user, d, c)
    on conflict (user_id, month_start) do update set used = public.pholama_codebase_monthly_usage.used + c, updated_at = now()
    where public.pholama_codebase_monthly_usage.used + c <= cap returning used into n;
  if n is null then
    select used into n from public.pholama_codebase_monthly_usage where user_id = p_user and month_start = d;
    return jsonb_build_object('ok', false, 'used', coalesce(n, cap), 'cap', cap);
  end if;
  return jsonb_build_object('ok', true, 'used', n, 'cap', cap);
end $$;
revoke all on function public.pholama_codebase_spend(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_codebase_spend(uuid, integer) to service_role;

create or replace function public.pholama_codebase_refund(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := date_trunc('month', now() at time zone 'utc')::date; n int; c int := greatest(0, least(coalesce(p_cost, 0), 15000));
begin
  update public.pholama_codebase_monthly_usage set used = greatest(0, used - c), updated_at = now() where user_id = p_user and month_start = d returning used into n;
  return jsonb_build_object('ok', n is not null, 'used', coalesce(n, 0), 'cap', 15000 + public.pholama_credit_extra(p_user));
end $$;
revoke all on function public.pholama_codebase_refund(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_codebase_refund(uuid, integer) to service_role;

-- 4) The owner (_sbian_) gets 10,000 credits in total: 1,500 normal + 8,500 extra. Change the number here any time and run again.
insert into public.pholama_credit_bonus(user_id, extra, note)
values ('d0c8bb82-1501-4eae-b7be-bae1cd1acba1', 8500, 'owner: 10,000 credits a week in total')
on conflict (user_id) do update set extra = excluded.extra, note = excluded.note, updated_at = now();
