-- Pholama Studio cloud project ownership.
-- Run after the core Platform schema. Values are project IDs only, never Totalum secrets.
create table if not exists public.pholama_cloud_projects (
  project_id text primary key check (project_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '' check (char_length(label) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists pholama_cloud_projects_user on public.pholama_cloud_projects (user_id, created_at desc);
alter table public.pholama_cloud_projects enable row level security;
drop policy if exists "cloud projects read own" on public.pholama_cloud_projects;
create policy "cloud projects read own" on public.pholama_cloud_projects for select using (auth.uid() = user_id);
-- Writes happen through the secure proxy after the Totalum request succeeds.
revoke insert, update, delete on public.pholama_cloud_projects from anon, authenticated;
