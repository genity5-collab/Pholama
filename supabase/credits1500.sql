-- Weekly cloud credits: 1,000 -> 1,500 for everyone. Run this in the Supabase SQL editor. Safe to run again.
-- Run it BEFORE the new site and cloud function go out, otherwise a spend past 1,000 is refused by the database.
alter table public.pholama_cloud_weekly_usage drop constraint if exists pholama_cloud_weekly_usage_used_check;
alter table public.pholama_cloud_weekly_usage add constraint pholama_cloud_weekly_usage_used_check check (used >= 0 and used <= 1500);

create or replace function public.pholama_cloud_weekly_spend(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date - extract(isodow from (now() at time zone 'utc'))::int + 1; n int; c int := greatest(0, least(coalesce(p_cost, 0), 1500));
begin
  insert into public.pholama_cloud_weekly_usage(user_id, week_start, used) values (p_user, d, c)
    on conflict (user_id, week_start) do update set used = public.pholama_cloud_weekly_usage.used + c, updated_at = now()
    where public.pholama_cloud_weekly_usage.used + c <= 1500 returning used into n;
  if n is null then select used into n from public.pholama_cloud_weekly_usage where user_id = p_user and week_start = d; return jsonb_build_object('ok', false, 'used', coalesce(n, 1500), 'cap', 1500); end if;
  return jsonb_build_object('ok', true, 'used', n, 'cap', 1500);
end $$;
revoke all on function public.pholama_cloud_weekly_spend(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_cloud_weekly_spend(uuid, integer) to service_role;

create or replace function public.pholama_cloud_weekly_refund(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date - extract(isodow from (now() at time zone 'utc'))::int + 1; n int; c int := greatest(0, least(coalesce(p_cost, 0), 1500));
begin
  update public.pholama_cloud_weekly_usage set used = greatest(0, used - c), updated_at = now() where user_id = p_user and week_start = d returning used into n;
  return jsonb_build_object('ok', n is not null, 'used', coalesce(n, 0), 'cap', 1500);
end $$;
revoke all on function public.pholama_cloud_weekly_refund(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_cloud_weekly_refund(uuid, integer) to service_role;

-- everyone starts the week fresh at 0 used (so 1,500 available)
update public.pholama_cloud_weekly_usage set used = 0, updated_at = now() where used > 0;
