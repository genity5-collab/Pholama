-- Pholama Studio (website): real projects, files, AI runs, secrets and the optional built-in database, all stored in YOUR Supabase.
-- Run once in the Supabase SQL editor. Safe to run again. Only the server (service key) can write these tables;
-- members can only read their own rows, and secrets / database contents are never readable from the browser at all.

-- ---------- projects ----------
create table if not exists public.pholama_site_projects (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);
alter table public.pholama_site_projects enable row level security;
drop policy if exists "site projects read own" on public.pholama_site_projects;
create policy "site projects read own" on public.pholama_site_projects for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pholama_site_projects from anon, authenticated;

-- ---------- files (small web files; limits are enforced by the server and again here) ----------
create table if not exists public.pholama_site_files (
  user_id uuid not null,
  project text not null,
  path text not null check (char_length(path) between 1 and 100),
  content text not null default '' check (octet_length(content) <= 409600),
  updated_at timestamptz not null default now(),
  primary key (user_id, project, path),
  foreign key (user_id, project) references public.pholama_site_projects(user_id, name) on delete cascade
);
alter table public.pholama_site_files enable row level security;
drop policy if exists "site files read own" on public.pholama_site_files;
create policy "site files read own" on public.pholama_site_files for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pholama_site_files from anon, authenticated;

-- ---------- AI runs (the timeline: stages, steps, plan, report) ----------
create table if not exists public.pholama_site_runs (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  user_id uuid not null,
  project text not null,
  status text not null default 'queued',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, project) references public.pholama_site_projects(user_id, name) on delete cascade
);
create index if not exists pholama_site_runs_proj on public.pholama_site_runs (user_id, project, created_at desc);
alter table public.pholama_site_runs enable row level security;
drop policy if exists "site runs read own" on public.pholama_site_runs;
create policy "site runs read own" on public.pholama_site_runs for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pholama_site_runs from anon, authenticated;

-- ---------- checkpoints (the file set before each run, so a run can be reverted) ----------
create table if not exists public.pholama_site_checkpoints (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  user_id uuid not null,
  project text not null,
  label text not null default '' check (char_length(label) <= 120),
  files jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (user_id, project) references public.pholama_site_projects(user_id, name) on delete cascade
);
create index if not exists pholama_site_cp_proj on public.pholama_site_checkpoints (user_id, project, created_at desc);
alter table public.pholama_site_checkpoints enable row level security;
revoke all on public.pholama_site_checkpoints from anon, authenticated;     -- server only

-- ---------- Pholama Secrets: max 10 per project, sealed by the server. NEVER readable from the browser. ----------
create table if not exists public.pholama_site_secrets (
  user_id uuid not null,
  project text not null,
  name text not null check (name ~ '^[A-Z][A-Z0-9_]{0,47}$'),
  sealed text not null,
  preview text not null default '',
  source text not null default 'manual' check (source in ('manual','detected')),
  created_at timestamptz not null default now(),
  primary key (user_id, project, name),
  foreign key (user_id, project) references public.pholama_site_projects(user_id, name) on delete cascade
);
alter table public.pholama_site_secrets enable row level security;
revoke all on public.pholama_site_secrets from anon, authenticated;         -- no policy on purpose: the browser can never read this table

-- ---------- Pholama Database: optional, under 0.01 GB per project, set up by the AI only ----------
create table if not exists public.pholama_site_db (
  user_id uuid not null,
  project text not null,
  data jsonb not null default '{"v":1,"enabled":false,"tables":{},"accounts":[],"seq":1,"signins":[]}'::jsonb check (pg_column_size(data) <= 10485760),
  updated_at timestamptz not null default now(),
  primary key (user_id, project),
  foreign key (user_id, project) references public.pholama_site_projects(user_id, name) on delete cascade
);
alter table public.pholama_site_db enable row level security;
revoke all on public.pholama_site_db from anon, authenticated;              -- server only: it holds password hashes

-- ---------- AI usage: a small weekly allowance, counted by the server ----------
create table if not exists public.pholama_site_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, day)
);
alter table public.pholama_site_usage enable row level security;
drop policy if exists "site usage read own" on public.pholama_site_usage;
create policy "site usage read own" on public.pholama_site_usage for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pholama_site_usage from anon, authenticated;

-- Atomically takes `n` from today's allowance. Returns the new total, or -1 if that would pass `cap`. Two requests cannot both take the last one.
create or replace function public.pholama_site_spend(p_user uuid, p_n integer, p_cap integer) returns integer
language plpgsql security definer set search_path = public as $$
declare cur integer;
begin
  insert into public.pholama_site_usage(user_id, day, used) values (p_user, (now() at time zone 'utc')::date, 0) on conflict do nothing;
  update public.pholama_site_usage set used = used + p_n where user_id = p_user and day = (now() at time zone 'utc')::date and used + p_n <= p_cap returning used into cur;
  return coalesce(cur, -1);
end $$;
revoke all on function public.pholama_site_spend(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.pholama_site_spend(uuid, integer, integer) to service_role;
