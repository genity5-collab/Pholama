-- =====================================================================
-- Pholama Platform: profiles, communities, posts, reactions, reports,
-- moderation, recent local AIs.
-- Run ONCE in Supabase: SQL Editor > New query > paste all > Run.
-- Safe to run again. It does not delete your data.
-- (Also run supabase/github_bonus.sql once if you have not yet.)
-- =====================================================================

-- ---------- helpers ----------
create table if not exists public.pholama_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.pholama_moderators enable row level security;
drop policy if exists "mods read self" on public.pholama_moderators;
create policy "mods read self" on public.pholama_moderators for select using (auth.uid() = user_id);
-- Nobody can add themselves. You add moderators from the SQL editor:
--   insert into public.pholama_moderators (user_id) values ('<their user id>');

create or replace function public.pholama_is_mod() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pholama_moderators where user_id = auth.uid());
$$;
revoke all on function public.pholama_is_mod() from public;
grant execute on function public.pholama_is_mod() to authenticated;

-- ---------- profiles: platform name, picture, bio ----------
create table if not exists public.pholama_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  platform_name text not null check (char_length(platform_name) between 2 and 30),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/avatar\.(png|jpg|webp)$'),
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Names are unique ignoring case and spaces at the ends.
create unique index if not exists pholama_profiles_name_uq on public.pholama_profiles (lower(btrim(platform_name)));
alter table public.pholama_profiles enable row level security;
drop policy if exists "profiles read" on public.pholama_profiles;
drop policy if exists "profiles insert own" on public.pholama_profiles;
drop policy if exists "profiles update own" on public.pholama_profiles;
create policy "profiles read" on public.pholama_profiles for select using (true);
create policy "profiles insert own" on public.pholama_profiles for insert with check (auth.uid() = user_id and banned = false);
-- People can edit their name/bio/picture but can never un-ban themselves.
create policy "profiles update own" on public.pholama_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.pholama_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.platform_name := btrim(new.platform_name);
  new.updated_at := now();
  if tg_op = 'UPDATE' and not public.pholama_is_mod() then new.banned := old.banned; end if;  -- only moderators change bans
  return new;
end $$;
drop trigger if exists pholama_profile_guard on public.pholama_profiles;
create trigger pholama_profile_guard before insert or update on public.pholama_profiles for each row execute function public.pholama_profile_guard();

-- ---------- communities ----------
create table if not exists public.pholama_communities (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,24}$'),
  title text not null check (char_length(title) between 2 and 40),
  about text not null default '' check (char_length(about) <= 200)
);
alter table public.pholama_communities enable row level security;
drop policy if exists "communities read" on public.pholama_communities;
create policy "communities read" on public.pholama_communities for select using (true);
insert into public.pholama_communities (slug, title, about) values
  ('general',  'General',       'Anything about Pholama.'),
  ('models',   'Models',        'Which models work well on which PC.'),
  ('games',    'Games and API', 'Using Pholama in Roblox and other games.'),
  ('help',     'Help',          'Stuck? Ask here.'),
  ('showcase', 'Showcase',      'Show what you built.')
on conflict (slug) do nothing;

-- ---------- posts: every post disappears after 3 hours ----------
create table if not exists public.pholama_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  community text not null references public.pholama_communities(slug),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 hours'),
  hidden boolean not null default false
);
create index if not exists pholama_posts_feed on public.pholama_posts (community, created_at desc);
create index if not exists pholama_posts_exp on public.pholama_posts (expires_at);
alter table public.pholama_posts enable row level security;
drop policy if exists "posts read live" on public.pholama_posts;
drop policy if exists "posts insert own" on public.pholama_posts;
drop policy if exists "posts delete own" on public.pholama_posts;
drop policy if exists "posts mod update" on public.pholama_posts;
-- The database hides expired or removed posts. A changed web page cannot bring them back.
create policy "posts read live" on public.pholama_posts for select using (
  (expires_at > now() and (hidden = false or user_id = auth.uid()))   -- live posts; you can still see your own hidden one
  or public.pholama_is_mod());
create policy "posts insert own" on public.pholama_posts for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.pholama_profiles p where p.user_id = auth.uid() and p.banned = false));
create policy "posts delete own" on public.pholama_posts for delete using (auth.uid() = user_id or public.pholama_is_mod());
create policy "posts mod update" on public.pholama_posts for update using (public.pholama_is_mod()) with check (public.pholama_is_mod());

-- Filter + rate limit + fixed lifetime, enforced on the database.
create or replace function public.pholama_post_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int; t text;
begin
  new.body := btrim(new.body);
  new.created_at := now();
  new.expires_at := now() + interval '3 hours';   -- a page cannot ask for longer
  new.hidden := false;
  t := lower(new.body);
  if t ~ '(https?://|www\.|discord\.gg|\.(com|net|org|ru|xyz|io)/)' then raise exception 'Links are not allowed in posts.'; end if;
  if t ~ '(gho_|ghp_|github_pat_|sk-[a-z0-9]{10}|phk_[a-z0-9]{6}|eyj[a-z0-9_-]{20})' then raise exception 'That looks like a secret key. Posts are public, so it was blocked.'; end if;
  if t ~ '(nigger|faggot|kill yourself|kys\b)' then raise exception 'That message breaks the community rules.'; end if;
  select count(*) into recent from public.pholama_posts where user_id = new.user_id and created_at > now() - interval '1 minute';
  if recent >= 3 then raise exception 'Slow down. Try again in a minute.'; end if;
  select count(*) into recent from public.pholama_posts where user_id = new.user_id and created_at > now() - interval '3 hours';
  if recent >= 20 then raise exception 'You have reached the limit of 20 live posts.'; end if;
  return new;
end $$;
drop trigger if exists pholama_post_guard on public.pholama_posts;
create trigger pholama_post_guard before insert on public.pholama_posts for each row execute function public.pholama_post_guard();

-- Physically delete expired posts. Called by the page whenever it loads, and by pg_cron if you have it.
create or replace function public.pholama_sweep() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.pholama_posts where expires_at <= now();
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.pholama_sweep() from public;
grant execute on function public.pholama_sweep() to authenticated, anon;

-- ---------- reactions: one of each kind per person per post ----------
create table if not exists public.pholama_reactions (
  post_id uuid not null references public.pholama_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('like','love','laugh','wow','fire')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);
alter table public.pholama_reactions enable row level security;
drop policy if exists "reactions read" on public.pholama_reactions;
drop policy if exists "reactions add own" on public.pholama_reactions;
drop policy if exists "reactions remove own" on public.pholama_reactions;
create policy "reactions read" on public.pholama_reactions for select using (
  exists (select 1 from public.pholama_posts p where p.id = post_id));   -- follows the post's own visibility
create policy "reactions add own" on public.pholama_reactions for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.pholama_posts p where p.id = post_id and p.expires_at > now() and p.hidden = false)
  and exists (select 1 from public.pholama_profiles pr where pr.user_id = auth.uid() and pr.banned = false));
create policy "reactions remove own" on public.pholama_reactions for delete using (auth.uid() = user_id);

-- ---------- reports and moderation ----------
create table if not exists public.pholama_reports (
  post_id uuid not null references public.pholama_posts(id) on delete cascade,
  reporter uuid not null references auth.users(id) on delete cascade,
  reason text not null default 'other' check (reason in ('spam','abuse','unsafe','other')),
  created_at timestamptz not null default now(),
  primary key (post_id, reporter)
);
alter table public.pholama_reports enable row level security;
drop policy if exists "reports add own" on public.pholama_reports;
drop policy if exists "reports mod read" on public.pholama_reports;
create policy "reports add own" on public.pholama_reports for insert with check (auth.uid() = reporter);
create policy "reports mod read" on public.pholama_reports for select using (public.pholama_is_mod());

-- 3 different people reporting a post hides it until a moderator looks.
create or replace function public.pholama_report_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.pholama_reports where post_id = new.post_id) >= 3 then
    update public.pholama_posts set hidden = true where id = new.post_id;
  end if;
  return new;
end $$;
drop trigger if exists pholama_report_guard on public.pholama_reports;
create trigger pholama_report_guard after insert on public.pholama_reports for each row execute function public.pholama_report_guard();

-- Moderator actions. Each one checks that YOU are a moderator inside the database.
create or replace function public.pholama_mod_hide(p_post uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pholama_is_mod() then raise exception 'Moderators only.'; end if;
  update public.pholama_posts set hidden = p_hidden where id = p_post;
end $$;
create or replace function public.pholama_mod_ban(p_user uuid, p_banned boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pholama_is_mod() then raise exception 'Moderators only.'; end if;
  update public.pholama_profiles set banned = p_banned where user_id = p_user;
  if p_banned then delete from public.pholama_posts where user_id = p_user; end if;
end $$;
revoke all on function public.pholama_mod_hide(uuid, boolean), public.pholama_mod_ban(uuid, boolean) from public;
grant execute on function public.pholama_mod_hide(uuid, boolean), public.pholama_mod_ban(uuid, boolean) to authenticated;

-- ---------- recent local AIs (names only, no files, no chats) ----------
create table if not exists public.pholama_recent_ais (
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null check (char_length(model) between 1 and 80),
  seen_at timestamptz not null default now(),
  primary key (user_id, model)
);
alter table public.pholama_recent_ais enable row level security;
drop policy if exists "recent own read" on public.pholama_recent_ais;
drop policy if exists "recent own write" on public.pholama_recent_ais;
drop policy if exists "recent own update" on public.pholama_recent_ais;
drop policy if exists "recent own delete" on public.pholama_recent_ais;
create policy "recent own read"   on public.pholama_recent_ais for select using (auth.uid() = user_id);
create policy "recent own write"  on public.pholama_recent_ais for insert with check (auth.uid() = user_id);
create policy "recent own update" on public.pholama_recent_ais for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "recent own delete" on public.pholama_recent_ais for delete using (auth.uid() = user_id);

-- ---------- profile pictures (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pholama-avatars', 'pholama-avatars', true, 262144, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set file_size_limit = 262144, allowed_mime_types = array['image/png','image/jpeg','image/webp'];
drop policy if exists "avatars read" on storage.objects;
drop policy if exists "avatars insert own" on storage.objects;
drop policy if exists "avatars update own" on storage.objects;
drop policy if exists "avatars delete own" on storage.objects;
-- Each person can only touch the folder named with their own user id.
create policy "avatars read" on storage.objects for select using (bucket_id = 'pholama-avatars');
create policy "avatars insert own" on storage.objects for insert with check (bucket_id = 'pholama-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update own" on storage.objects for update using (bucket_id = 'pholama-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars delete own" on storage.objects for delete using (bucket_id = 'pholama-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
