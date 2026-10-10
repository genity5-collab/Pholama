-- Pholama Studio: private project records and weekly AI usage.
-- Run after the core Platform schema. Provider secrets never go in this database.
create table if not exists public.pholama_cloud_projects (
  project_id text primary key check (project_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '' check (char_length(label) <= 80),
  prompt text not null default '' check (char_length(prompt) <= 12000),
  output text not null default '',
  status text not null default 'building' check (status in ('building','ready','error')),
  last_error text not null default '' check (char_length(last_error) <= 500),
  tokens_used integer not null default 0 check (tokens_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pholama_cloud_projects add column if not exists prompt text not null default '';
alter table public.pholama_cloud_projects add column if not exists output text not null default '';
alter table public.pholama_cloud_projects add column if not exists status text not null default 'building';
alter table public.pholama_cloud_projects add column if not exists last_error text not null default '';
alter table public.pholama_cloud_projects add column if not exists tokens_used integer not null default 0;
alter table public.pholama_cloud_projects add column if not exists updated_at timestamptz not null default now();
create index if not exists pholama_cloud_projects_user on public.pholama_cloud_projects (user_id, updated_at desc);
alter table public.pholama_cloud_projects enable row level security;
drop policy if exists "cloud projects read own" on public.pholama_cloud_projects;
create policy "cloud projects read own" on public.pholama_cloud_projects for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pholama_cloud_projects from anon, authenticated;

create table if not exists public.pholama_cloud_weekly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  used integer not null default 0 check (used >= 0 and used <= 1000),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.pholama_cloud_weekly_usage enable row level security;
revoke all on public.pholama_cloud_weekly_usage from anon, authenticated;

create or replace function public.pholama_cloud_weekly_spend(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date - extract(isodow from (now() at time zone 'utc'))::int + 1; n int; c int := greatest(0, least(coalesce(p_cost, 0), 1000));
begin
  insert into public.pholama_cloud_weekly_usage(user_id, week_start, used) values (p_user, d, c)
    on conflict (user_id, week_start) do update set used = public.pholama_cloud_weekly_usage.used + c, updated_at = now()
    where public.pholama_cloud_weekly_usage.used + c <= 1000 returning used into n;
  if n is null then select used into n from public.pholama_cloud_weekly_usage where user_id = p_user and week_start = d; return jsonb_build_object('ok', false, 'used', coalesce(n, 1000), 'cap', 1000); end if;
  return jsonb_build_object('ok', true, 'used', n, 'cap', 1000);
end $$;
revoke all on function public.pholama_cloud_weekly_spend(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_cloud_weekly_spend(uuid, integer) to service_role;
