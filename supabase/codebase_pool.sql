-- Pholama Codebase gets its OWN monthly credit pool (15,000 a month), separate from the 1,500 weekly credits used by chat and Studio.
-- Run this in the Supabase SQL editor BEFORE the new pholamaCloud function is deployed. Safe to run again.
create table if not exists public.pholama_codebase_monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null,
  used integer not null default 0 check (used >= 0 and used <= 15000),
  updated_at timestamptz not null default now(),
  primary key (user_id, month_start)
);
alter table public.pholama_codebase_monthly_usage enable row level security;
revoke all on public.pholama_codebase_monthly_usage from anon, authenticated;

-- Charge the pool. Refuses (ok=false) when the charge would go past 15,000. A single charge is capped at 15,000.
create or replace function public.pholama_codebase_spend(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := date_trunc('month', now() at time zone 'utc')::date; n int; c int := greatest(0, least(coalesce(p_cost, 0), 15000));
begin
  insert into public.pholama_codebase_monthly_usage(user_id, month_start, used) values (p_user, d, c)
    on conflict (user_id, month_start) do update set used = public.pholama_codebase_monthly_usage.used + c, updated_at = now()
    where public.pholama_codebase_monthly_usage.used + c <= 15000 returning used into n;
  if n is null then
    select used into n from public.pholama_codebase_monthly_usage where user_id = p_user and month_start = d;
    return jsonb_build_object('ok', false, 'used', coalesce(n, 15000), 'cap', 15000);
  end if;
  return jsonb_build_object('ok', true, 'used', n, 'cap', 15000);
end $$;
revoke all on function public.pholama_codebase_spend(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_codebase_spend(uuid, integer) to service_role;

-- Give credits back (a failed answer is never paid for).
create or replace function public.pholama_codebase_refund(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := date_trunc('month', now() at time zone 'utc')::date; n int; c int := greatest(0, least(coalesce(p_cost, 0), 15000));
begin
  update public.pholama_codebase_monthly_usage set used = greatest(0, used - c), updated_at = now() where user_id = p_user and month_start = d returning used into n;
  return jsonb_build_object('ok', n is not null, 'used', coalesce(n, 0), 'cap', 15000);
end $$;
revoke all on function public.pholama_codebase_refund(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_codebase_refund(uuid, integer) to service_role;
