-- Pholama: records which app (site or PC) each GitHub account has signed in on.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.pholama_logins (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  surface    text        not null check (surface in ('site', 'pc')),
  provider   text        not null check (provider in ('github', 'discord')),
  first_at   timestamptz not null default now(),
  primary key (user_id, surface)
);

alter table public.pholama_logins enable row level security;

-- A person can only see and add their OWN rows. They cannot edit or delete them,
-- so a record of "signed in on the PC" cannot be rewritten later.
drop policy if exists "own logins read"   on public.pholama_logins;
drop policy if exists "own logins insert" on public.pholama_logins;
create policy "own logins read"   on public.pholama_logins for select using (auth.uid() = user_id);
create policy "own logins insert" on public.pholama_logins for insert with check (auth.uid() = user_id);

-- Once per account: did this account use GitHub on BOTH the site and the PC app?
-- Returns true only when both rows exist and both were made with GitHub.
create or replace function public.pholama_github_both()
returns boolean
language sql
security definer
set search_path = public
as $$
  select count(*) = 2
  from public.pholama_logins
  where user_id = auth.uid() and provider = 'github' and surface in ('site', 'pc');
$$;

revoke all on function public.pholama_github_both() from public;
grant execute on function public.pholama_github_both() to authenticated;
