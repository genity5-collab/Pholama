-- =====================================================================
-- Pholama Platform part 2: moderator tools, warnings, audit log, rules,
-- Projects (advertise with images) and Daily posts.
-- Run AFTER github_bonus.sql and platform.sql. Safe to run again.
-- =====================================================================

-- ---------- bans can now have a reason and an end date ----------
alter table public.pholama_profiles add column if not exists ban_reason text check (ban_reason is null or char_length(ban_reason) <= 200);
alter table public.pholama_profiles add column if not exists banned_until timestamptz;   -- null + banned = permanent
alter table public.pholama_posts    add column if not exists edited_by_mod boolean not null default false;

-- A ban that has run out no longer counts. Everything checks this one function.
create or replace function public.pholama_is_banned(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banned and (banned_until is null or banned_until > now()) from public.pholama_profiles where user_id = p_user), false);
$$;
revoke all on function public.pholama_is_banned(uuid) from public;
grant execute on function public.pholama_is_banned(uuid) to authenticated;

-- posting / reacting / projects use the time-aware check (replaces the old "banned = false" tests)
drop policy if exists "posts insert own" on public.pholama_posts;
create policy "posts insert own" on public.pholama_posts for insert with check (
  auth.uid() = user_id and exists (select 1 from public.pholama_profiles p where p.user_id = auth.uid()) and not public.pholama_is_banned(auth.uid()));
drop policy if exists "reactions add own" on public.pholama_reactions;
create policy "reactions add own" on public.pholama_reactions for insert with check (
  auth.uid() = user_id and not public.pholama_is_banned(auth.uid())
  and exists (select 1 from public.pholama_posts p where p.id = post_id and p.expires_at > now() and p.hidden = false));

-- people cannot change moderator-owned ban fields on themselves
create or replace function public.pholama_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.platform_name := btrim(new.platform_name);
  new.updated_at := now();
  if tg_op = 'UPDATE' and not public.pholama_is_mod() then
    new.banned := old.banned; new.ban_reason := old.ban_reason; new.banned_until := old.banned_until;
  end if;
  return new;
end $$;

-- ---------- rules (everyone can read, only you edit them here) ----------
create table if not exists public.pholama_rules (
  n int primary key check (n between 1 and 30),
  title text not null check (char_length(title) <= 60),
  body text not null check (char_length(body) <= 240)
);
alter table public.pholama_rules enable row level security;
drop policy if exists "rules read" on public.pholama_rules;
create policy "rules read" on public.pholama_rules for select using (true);
insert into public.pholama_rules (n, title, body) values
 (1,'Be kind','No insults, hate, or harassment. Disagree with the idea, not the person.'),
 (2,'No links or secret keys','Never post API keys, tokens or passwords. Links are blocked in posts.'),
 (3,'Stay on topic','Keep posts about Pholama, local AI, your projects and games.'),
 (4,'No spam','Do not repeat the same post or advertise outside the Projects tab.'),
 (5,'Keep it safe','No adult, violent, illegal or dangerous content. Images in Projects must be safe for everyone.'),
 (6,'Respect moderators','Moderators can warn, edit, remove posts and ban. Repeated breaking of the rules means a ban.')
on conflict (n) do nothing;

-- ---------- warnings and the audit log ----------
create table if not exists public.pholama_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now(),
  seen boolean not null default false
);
alter table public.pholama_warnings enable row level security;
drop policy if exists "warnings read own" on public.pholama_warnings;
drop policy if exists "warnings mark seen" on public.pholama_warnings;
create policy "warnings read own" on public.pholama_warnings for select using (auth.uid() = user_id or public.pholama_is_mod());
create policy "warnings mark seen" on public.pholama_warnings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create or replace function public.pholama_warning_lock() returns trigger language plpgsql as $$
begin if new.user_id <> old.user_id or new.reason <> old.reason or new.created_at <> old.created_at then raise exception 'Only "seen" can change.'; end if; return new; end $$;
drop trigger if exists pholama_warning_lock on public.pholama_warnings;
create trigger pholama_warning_lock before update on public.pholama_warnings for each row execute function public.pholama_warning_lock();

create table if not exists public.pholama_mod_log (
  id bigint generated always as identity primary key,
  mod_id uuid not null,
  action text not null,
  target_user uuid,
  target_post uuid,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.pholama_mod_log enable row level security;
drop policy if exists "modlog mods read" on public.pholama_mod_log;
create policy "modlog mods read" on public.pholama_mod_log for select using (public.pholama_is_mod());   -- nobody can write directly; only the functions below

-- ---------- Projects: advertise what you made (no 3 hour limit) ----------
create table if not exists public.pholama_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 60),
  blurb text not null check (char_length(btrim(blurb)) between 10 and 400),
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 4),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pholama_projects_new on public.pholama_projects (created_at desc);
alter table public.pholama_projects enable row level security;
drop policy if exists "projects read" on public.pholama_projects;
drop policy if exists "projects add own" on public.pholama_projects;
drop policy if exists "projects edit own" on public.pholama_projects;
drop policy if exists "projects delete own" on public.pholama_projects;
drop policy if exists "projects mod" on public.pholama_projects;
create policy "projects read" on public.pholama_projects for select using (hidden = false or user_id = auth.uid() or public.pholama_is_mod());
create policy "projects add own" on public.pholama_projects for insert with check (auth.uid() = user_id and exists (select 1 from public.pholama_profiles p where p.user_id = auth.uid()) and not public.pholama_is_banned(auth.uid()));
create policy "projects edit own" on public.pholama_projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects delete own" on public.pholama_projects for delete using (auth.uid() = user_id or public.pholama_is_mod());
create policy "projects mod" on public.pholama_projects for update using (public.pholama_is_mod()) with check (public.pholama_is_mod());

create or replace function public.pholama_project_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text; t text; n int;
begin
  new.title := btrim(new.title); new.blurb := btrim(new.blurb);
  if tg_op = 'INSERT' then new.created_at := now(); new.hidden := false; else new.created_at := old.created_at; new.user_id := old.user_id; if not public.pholama_is_mod() then new.hidden := old.hidden; end if; end if;
  t := lower(new.title || ' ' || new.blurb);
  if t ~ '(gho_|ghp_|github_pat_|sk-[a-z0-9]{10}|phk_[a-z0-9]{6}|eyj[a-z0-9_-]{20})' then raise exception 'That looks like a secret key. Projects are public, so it was blocked.'; end if;
  if t ~ '(nigger|faggot|kill yourself|kys\b)' then raise exception 'That message breaks the community rules.'; end if;
  -- images must be uploaded by the project owner into their own folder (no outside links, no tracking pixels)
  foreach p in array new.image_paths loop
    if p !~ ('^' || new.user_id::text || '/projects/[0-9a-f-]{8,40}\.(png|jpg|webp)$') then raise exception 'Project images must be uploaded here as PNG, JPG or WebP.'; end if;
  end loop;
  if tg_op = 'INSERT' then
    select count(*) into n from public.pholama_projects where user_id = new.user_id and created_at > now() - interval '1 day';
    if n >= 3 then raise exception 'You can add 3 projects a day.'; end if;
    select count(*) into n from public.pholama_projects where user_id = new.user_id;
    if n >= 12 then raise exception 'You have reached 12 projects. Delete one first.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists pholama_project_guard on public.pholama_projects;
create trigger pholama_project_guard before insert or update on public.pholama_projects for each row execute function public.pholama_project_guard();

-- project images go in the same public bucket, under <your id>/projects/ (256 KB each, enforced by the bucket)

-- ---------- Daily post: one pinned post per day, picked by moderators ----------
create table if not exists public.pholama_daily (
  day date primary key default current_date,
  title text not null check (char_length(title) between 3 and 80),
  body text not null check (char_length(body) between 3 and 500),
  by_mod uuid not null
);
alter table public.pholama_daily enable row level security;
drop policy if exists "daily read" on public.pholama_daily;
create policy "daily read" on public.pholama_daily for select using (true);   -- written only by pholama_mod_cmd 'daily'

-- ---------- moderator functions. Each one checks you are a moderator INSIDE the database ----------
create or replace function public.pholama_log(p_action text, p_user uuid, p_post uuid, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into public.pholama_mod_log (mod_id, action, target_user, target_post, detail) values (auth.uid(), p_action, p_user, p_post, left(p_detail, 300));
$$;
revoke all on function public.pholama_log(text, uuid, uuid, text) from public;

create or replace function public.pholama_need_mod() returns void
language plpgsql security definer set search_path = public as $$
begin if not public.pholama_is_mod() then raise exception 'Moderators only.'; end if; end $$;

create or replace function public.pholama_find_user(p_who text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  perform public.pholama_need_mod();
  if p_who ~ '^[0-9a-f-]{36}$' then return p_who::uuid; end if;
  select user_id into u from public.pholama_profiles where lower(platform_name) = lower(btrim(p_who));
  if u is null then raise exception 'No one has the Platform name "%".', p_who; end if;
  return u;
end $$;

create or replace function public.pholama_mod_warn(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pholama_need_mod();
  insert into public.pholama_warnings (user_id, reason) values (p_user, left(btrim(p_reason), 200));
  perform public.pholama_log('warn', p_user, null, p_reason);
end $$;

create or replace function public.pholama_mod_edit(p_post uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pholama_need_mod();
  if char_length(btrim(p_body)) not between 1 and 500 then raise exception 'Posts are 1 to 500 characters.'; end if;
  update public.pholama_posts set body = btrim(p_body), edited_by_mod = true where id = p_post;
  perform public.pholama_log('edit', (select user_id from public.pholama_posts where id = p_post), p_post, p_body);
end $$;

create or replace function public.pholama_mod_hide(p_post uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pholama_need_mod();
  update public.pholama_posts set hidden = p_hidden where id = p_post;
  perform public.pholama_log(case when p_hidden then 'takedown' else 'restore' end, (select user_id from public.pholama_posts where id = p_post), p_post, null);
end $$;

create or replace function public.pholama_mod_remove(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  perform public.pholama_need_mod();
  select user_id into u from public.pholama_posts where id = p_post;
  delete from public.pholama_posts where id = p_post;
  perform public.pholama_log('delete', u, p_post, null);
end $$;

-- ban for p_hours hours (null = permanent). Old 2-argument version is replaced.
drop function if exists public.pholama_mod_ban(uuid, boolean);
create or replace function public.pholama_mod_ban(p_user uuid, p_banned boolean, p_reason text default null, p_hours int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pholama_need_mod();
  if p_user = auth.uid() then raise exception 'You cannot ban yourself.'; end if;
  if exists (select 1 from public.pholama_moderators where user_id = p_user) then raise exception 'Remove their moderator role first.'; end if;
  update public.pholama_profiles set banned = p_banned, ban_reason = case when p_banned then left(p_reason, 200) end,
    banned_until = case when p_banned and p_hours is not null then now() + make_interval(hours => p_hours) end where user_id = p_user;
  if p_banned then delete from public.pholama_posts where user_id = p_user; update public.pholama_projects set hidden = true where user_id = p_user; end if;
  perform public.pholama_log(case when p_banned then 'ban' else 'unban' end, p_user, null, coalesce(p_reason, '') || coalesce(' ' || p_hours || 'h', ' permanent'));
end $$;

create or replace function public.pholama_mod_project(p_project uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pholama_need_mod();
  update public.pholama_projects set hidden = p_hidden where id = p_project;
  perform public.pholama_log(case when p_hidden then 'project_takedown' else 'project_restore' end, (select user_id from public.pholama_projects where id = p_project), null, p_project::text);
end $$;

-- ONE command line for moderators. Works from the SQL editor too:
--   select public.pholama_mod_cmd('help');
--   select public.pholama_mod_cmd('ban Zed 24 spamming');       -- 24 hours
--   select public.pholama_mod_cmd('ban Zed perm being rude');     -- permanent
--   select public.pholama_mod_cmd('unban Zed');
--   select public.pholama_mod_cmd('warn Zed please keep it on topic');
--   select public.pholama_mod_cmd('takedown <post id>');  restore / delete / edit <post id> <new text>
--   select public.pholama_mod_cmd('project hide <project id>');  project show <project id>
--   select public.pholama_mod_cmd('daily Title | text of the daily post');
--   select public.pholama_mod_cmd('whois Zed');                   -- shows the user id, warnings, ban
create or replace function public.pholama_mod_cmd(p_line text) returns text
language plpgsql security definer set search_path = public as $$
declare w text[]; c text; u uuid; rest text; pr public.pholama_profiles; nw int; hrs int; d text[];
begin
  perform public.pholama_need_mod();
  w := regexp_split_to_array(btrim(p_line), '\s+'); c := lower(w[1]);
  if c is null or c = '' or c = 'help' then
    return E'Commands:\nwhois <name|id>\nwarn <name|id> <reason>\nban <name|id> <hours|perm> <reason>\nunban <name|id>\ntakedown|restore|delete <post id>\nedit <post id> <new text>\nproject hide|show <project id>\ndaily <title> | <text>';
  elsif c = 'whois' then
    u := public.pholama_find_user(w[2]); select * into pr from public.pholama_profiles where user_id = u; select count(*) into nw from public.pholama_warnings where user_id = u;
    return format('%s | id %s | warnings %s | %s', coalesce(pr.platform_name, '(no profile)'), u, nw, case when public.pholama_is_banned(u) then 'BANNED: ' || coalesce(pr.ban_reason, '') || coalesce(' until ' || pr.banned_until, ' permanently') else 'not banned' end);
  elsif c = 'warn' then
    u := public.pholama_find_user(w[2]); rest := btrim(regexp_replace(p_line, '^\s*\S+\s+\S+\s*', ''));
    if rest = '' then raise exception 'Give a reason: warn <name> <reason>'; end if;
    perform public.pholama_mod_warn(u, rest); return 'Warned.';
  elsif c = 'ban' then
    u := public.pholama_find_user(w[2]); hrs := case when lower(w[3]) in ('perm','permanent') then null else w[3]::int end;
    rest := btrim(regexp_replace(p_line, '^\s*\S+\s+\S+\s+\S+\s*', ''));
    perform public.pholama_mod_ban(u, true, nullif(rest, ''), hrs); return 'Banned.';
  elsif c = 'unban' then u := public.pholama_find_user(w[2]); perform public.pholama_mod_ban(u, false, null, null); return 'Unbanned.';
  elsif c = 'takedown' then perform public.pholama_mod_hide(w[2]::uuid, true); return 'Post hidden.';
  elsif c = 'restore' then perform public.pholama_mod_hide(w[2]::uuid, false); return 'Post restored.';
  elsif c = 'delete' then perform public.pholama_mod_remove(w[2]::uuid); return 'Post deleted.';
  elsif c = 'edit' then perform public.pholama_mod_edit(w[2]::uuid, btrim(regexp_replace(p_line, '^\s*\S+\s+\S+\s*', ''))); return 'Post edited.';
  elsif c = 'project' then perform public.pholama_mod_project(w[3]::uuid, lower(w[2]) = 'hide'); return 'Project updated.';
  elsif c = 'daily' then
    rest := btrim(regexp_replace(p_line, '^\s*\S+\s*', '')); d := regexp_split_to_array(rest, '\s*\|\s*');
    if array_length(d, 1) < 2 then raise exception 'Use: daily Title | text'; end if;
    insert into public.pholama_daily (day, title, body, by_mod) values (current_date, left(d[1], 80), left(d[2], 500), auth.uid())
      on conflict (day) do update set title = excluded.title, body = excluded.body, by_mod = excluded.by_mod;
    perform public.pholama_log('daily', null, null, d[1]); return 'Daily post set.';
  end if;
  raise exception 'Unknown command "%". Try: help', c;
end $$;

revoke all on function public.pholama_need_mod(), public.pholama_find_user(text), public.pholama_mod_warn(uuid, text), public.pholama_mod_edit(uuid, text),
  public.pholama_mod_hide(uuid, boolean), public.pholama_mod_remove(uuid), public.pholama_mod_ban(uuid, boolean, text, int), public.pholama_mod_project(uuid, boolean), public.pholama_mod_cmd(text) from public;
grant execute on function public.pholama_mod_warn(uuid, text), public.pholama_mod_edit(uuid, text), public.pholama_mod_hide(uuid, boolean), public.pholama_mod_remove(uuid),
  public.pholama_mod_ban(uuid, boolean, text, int), public.pholama_mod_project(uuid, boolean), public.pholama_mod_cmd(text) to authenticated;
