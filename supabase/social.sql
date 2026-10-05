-- Pholama Platform: friends, private chat, calls and notifications.
-- Run this once in the Supabase SQL editor (after platform.sql and platform2.sql). It is safe to run again.
-- The database, not the web page, decides who can see or do what: a changed page cannot read someone else's
-- messages, ring someone who turned calls off, or get around a block.

-- ---------- each person's switches ----------
-- Everything starts ON except nothing is forced: people can turn any of it off in Settings.
create table if not exists public.pholama_social_prefs (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  allow_requests boolean not null default true,     -- others may send me a friend request
  allow_dms      boolean not null default true,     -- friends may message me
  allow_calls    boolean not null default true,     -- friends may call me
  notify         boolean not null default true,     -- make notifications for me at all
  updated_at     timestamptz not null default now()
);
alter table public.pholama_social_prefs enable row level security;
drop policy if exists "prefs read own" on public.pholama_social_prefs;
drop policy if exists "prefs write own" on public.pholama_social_prefs;
drop policy if exists "prefs update own" on public.pholama_social_prefs;
create policy "prefs read own" on public.pholama_social_prefs for select using (auth.uid() = user_id);
create policy "prefs write own" on public.pholama_social_prefs for insert with check (auth.uid() = user_id);
create policy "prefs update own" on public.pholama_social_prefs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- What a person's switches are right now (defaults when they never saved any). Used by every rule below.
create or replace function public.pholama_pref_raw(p_user uuid, p_what text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.pholama_social_prefs;
begin
  select * into r from public.pholama_social_prefs where user_id = p_user;
  if not found then return true; end if;
  return case p_what when 'requests' then r.allow_requests when 'dms' then r.allow_dms when 'calls' then r.allow_calls when 'notify' then r.notify else true end;
end $$;
-- The version a page could reach. It only tells you about YOURSELF, or a FRIEND's "messages" and "calls" switches
-- (that is how the Call button knows to grey out). Everyone else, and the notification/requests switches of others, get null.
create or replace function public.pholama_pref(p_user uuid, p_what text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if p_user = auth.uid() then return public.pholama_pref_raw(p_user, p_what); end if;
  if p_what in ('dms', 'calls') and exists (select 1 from public.pholama_friends f where f.status = 'accepted' and ((f.a = auth.uid() and f.b = p_user) or (f.a = p_user and f.b = auth.uid()))) then
    return public.pholama_pref_raw(p_user, p_what);
  end if;
  return null;
end $$;

-- ---------- friends ----------
-- One row per pair. a = who asked, b = who was asked. status: pending | accepted | blocked (a blocked b).
create table if not exists public.pholama_friends (
  id         bigint generated always as identity primary key,
  a          uuid not null references auth.users(id) on delete cascade,
  b          uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  check (a <> b)
);
-- A pair can only exist once, whichever way round it was created.
create unique index if not exists pholama_friends_pair on public.pholama_friends (least(a, b), greatest(a, b));
create index if not exists pholama_friends_a on public.pholama_friends (a);
create index if not exists pholama_friends_b on public.pholama_friends (b);
alter table public.pholama_friends enable row level security;
drop policy if exists "friends read mine" on public.pholama_friends;
create policy "friends read mine" on public.pholama_friends for select using (auth.uid() = a or auth.uid() = b);
-- All changes go through the functions below, so the table itself is read-only to the page.

create or replace function public.pholama_need_user() returns uuid
language plpgsql stable as $$
begin if auth.uid() is null then raise exception 'Log in first.'; end if; return auth.uid(); end $$;

-- Are these two people accepted friends (and nobody blocked)?
create or replace function public.pholama_are_friends(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() in (x, y)
     and exists (select 1 from public.pholama_friends f where f.status = 'accepted' and ((f.a = x and f.b = y) or (f.a = y and f.b = x)));
$$;
-- Has either of them blocked the other?
create or replace function public.pholama_blocked(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() in (x, y)
     and exists (select 1 from public.pholama_friends f where f.status = 'blocked' and ((f.a = x and f.b = y) or (f.a = y and f.b = x)));
$$;

-- ---------- notifications ----------
-- Made only by the database (triggers / functions below). A page can read and tidy its own, never invent one.
create table if not exists public.pholama_notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('friend_request', 'friend_accepted', 'message', 'missed_call')),
  from_user  uuid references auth.users(id) on delete cascade,
  info       text not null default '' check (char_length(info) <= 120),
  seen       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pholama_notifications_user on public.pholama_notifications (user_id, id desc);
alter table public.pholama_notifications enable row level security;
drop policy if exists "notes read own" on public.pholama_notifications;
drop policy if exists "notes update own" on public.pholama_notifications;
drop policy if exists "notes delete own" on public.pholama_notifications;
create policy "notes read own" on public.pholama_notifications for select using (auth.uid() = user_id);
create policy "notes update own" on public.pholama_notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes delete own" on public.pholama_notifications for delete using (auth.uid() = user_id);

-- Make a notification, unless the person turned notifications off. Keeps at most 100 per person.
create or replace function public.pholama_notify(p_user uuid, p_kind text, p_from uuid, p_info text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pholama_pref_raw(p_user, 'notify') then return; end if;
  -- One unread "message" line per sender instead of a flood: refresh it.
  if p_kind = 'message' then
    update public.pholama_notifications set info = left(coalesce(p_info, ''), 120), created_at = now()
      where user_id = p_user and kind = 'message' and from_user = p_from and seen = false;
    if found then return; end if;
  end if;
  insert into public.pholama_notifications (user_id, kind, from_user, info) values (p_user, p_kind, p_from, left(coalesce(p_info, ''), 120));
  delete from public.pholama_notifications where user_id = p_user and id not in
    (select id from public.pholama_notifications where user_id = p_user order by id desc limit 100);
end $$;

-- ---------- friend actions ----------
create or replace function public.pholama_friend_request(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); them uuid; ex public.pholama_friends; myname text;
begin
  if public.pholama_is_banned(me) then raise exception 'You cannot do that right now.'; end if;
  if not exists (select 1 from public.pholama_profiles where user_id = me) then raise exception 'Pick a Platform name first.'; end if;
  select user_id into them from public.pholama_profiles where lower(btrim(platform_name)) = lower(btrim(coalesce(p_name, ''))) limit 1;
  -- The same message for "no such person" and "they turned requests off", so names cannot be probed.
  if them is null or them = me then raise exception 'No one can be added with that name.'; end if;
  select * into ex from public.pholama_friends f where (f.a = me and f.b = them) or (f.a = them and f.b = me);
  if found then
    if ex.status = 'blocked' then raise exception 'No one can be added with that name.'; end if;
    if ex.status = 'accepted' then return 'already'; end if;
    if ex.a = me then return 'pending'; end if;
    -- They had already asked me: asking back means yes.
    update public.pholama_friends set status = 'accepted' where id = ex.id;
    select platform_name into myname from public.pholama_profiles where user_id = me;
    perform public.pholama_notify(them, 'friend_accepted', me, myname);
    return 'accepted';
  end if;
  if not public.pholama_pref_raw(them, 'requests') then raise exception 'No one can be added with that name.'; end if;
  if (select count(*) from public.pholama_friends where a = me and status = 'pending' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of requests today. Try again tomorrow.'; end if;
  insert into public.pholama_friends (a, b) values (me, them);
  select platform_name into myname from public.pholama_profiles where user_id = me;
  perform public.pholama_notify(them, 'friend_request', me, myname);
  return 'sent';
end $$;

create or replace function public.pholama_friend_answer(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); f public.pholama_friends; myname text;
begin
  select * into f from public.pholama_friends where id = p_id and b = me and status = 'pending';
  if not found then raise exception 'That request is no longer there.'; end if;
  if p_accept then
    update public.pholama_friends set status = 'accepted' where id = p_id;
    select platform_name into myname from public.pholama_profiles where user_id = me;
    perform public.pholama_notify(f.a, 'friend_accepted', me, myname);
  else
    delete from public.pholama_friends where id = p_id;    -- declining is silent
  end if;
end $$;

-- Remove a friend, or withdraw/cancel a request I sent.
create or replace function public.pholama_friend_remove(p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user();
begin
  delete from public.pholama_friends where status in ('pending', 'accepted') and ((a = me and b = p_other) or (a = p_other and b = me));
end $$;

-- Block: ends the friendship and stops every message, call and request. Only the person who blocked can undo it.
create or replace function public.pholama_block(p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user();
begin
  if p_other = me then raise exception 'You cannot block yourself.'; end if;
  delete from public.pholama_friends where (a = me and b = p_other) or (a = p_other and b = me);
  insert into public.pholama_friends (a, b, status) values (me, p_other, 'blocked');
end $$;
create or replace function public.pholama_unblock(p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user();
begin delete from public.pholama_friends where a = me and b = p_other and status = 'blocked'; end $$;

-- ---------- private messages ----------
create table if not exists public.pholama_dms (
  id         bigint generated always as identity primary key,
  sender     uuid not null references auth.users(id) on delete cascade,
  receiver   uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  check (sender <> receiver)
);
create index if not exists pholama_dms_pair on public.pholama_dms (least(sender, receiver), greatest(sender, receiver), id desc);
create index if not exists pholama_dms_receiver on public.pholama_dms (receiver, read_at);
alter table public.pholama_dms enable row level security;
drop policy if exists "dms read mine" on public.pholama_dms;
drop policy if exists "dms insert friend" on public.pholama_dms;
drop policy if exists "dms delete mine" on public.pholama_dms;
-- Only the two people in a conversation can ever read it. Moderators cannot, on purpose: it is private.
create policy "dms read mine" on public.pholama_dms for select using (auth.uid() = sender or auth.uid() = receiver);
create policy "dms insert friend" on public.pholama_dms for insert with check (
  auth.uid() = sender
  and public.pholama_are_friends(sender, receiver)
  and not public.pholama_blocked(sender, receiver)
  and public.pholama_pref(receiver, 'dms') is true          -- a friend's switch is visible to the friend; anyone else gets null, which is not true
  and not public.pholama_is_banned(auth.uid()));
-- Either person can delete a message from the conversation (it goes for both).
create policy "dms delete mine" on public.pholama_dms for delete using (auth.uid() = sender or auth.uid() = receiver);

create or replace function public.pholama_dm_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int; t text; nm text;
begin
  new.body := btrim(new.body);
  new.created_at := now();
  new.read_at := null;
  t := lower(new.body);
  if t ~ '(https?://|www\.|discord\.gg|\.(com|net|org|ru|xyz|io)/)' then raise exception 'Links are not allowed in messages.'; end if;
  if t ~ '(gho_|ghp_|github_pat_|sk-[a-z0-9]{10}|phk_[a-z0-9]{6}|eyj[a-z0-9_-]{20})' then raise exception 'That looks like a secret key, so it was blocked.'; end if;
  if t ~ '(nigger|faggot|kill yourself|\ykys\y)' then raise exception 'That message breaks the community rules.'; end if;
  select count(*) into recent from public.pholama_dms where sender = new.sender and created_at > now() - interval '1 minute';
  if recent >= 20 then raise exception 'Slow down. Try again in a minute.'; end if;
  return new;
end $$;
drop trigger if exists pholama_dm_guard on public.pholama_dms;
create trigger pholama_dm_guard before insert on public.pholama_dms for each row execute function public.pholama_dm_guard();

create or replace function public.pholama_dm_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select platform_name into nm from public.pholama_profiles where user_id = new.sender;
  perform public.pholama_notify(new.receiver, 'message', new.sender, coalesce(nm, 'Someone'));
  return new;
end $$;
drop trigger if exists pholama_dm_after on public.pholama_dms;
create trigger pholama_dm_after after insert on public.pholama_dms for each row execute function public.pholama_dm_after();

-- Mark everything a friend sent me as read, and clear the matching notification.
create or replace function public.pholama_dm_read(p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user();
begin
  update public.pholama_dms set read_at = now() where receiver = me and sender = p_other and read_at is null;
  update public.pholama_notifications set seen = true where user_id = me and kind = 'message' and from_user = p_other and seen = false;
end $$;

-- ---------- calls ----------
-- This table only carries the "ringing" and the connection details between the two browsers. The sound itself goes
-- straight between them. A ring lasts 60 seconds.
create table if not exists public.pholama_calls (
  id         uuid primary key default gen_random_uuid(),
  caller     uuid not null references auth.users(id) on delete cascade,
  callee     uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'ringing' check (status in ('ringing', 'answered', 'declined', 'missed', 'ended', 'cancelled')),
  offer      text,                                -- the caller's connection details (SDP)
  answer     text,                                -- the callee's connection details (SDP)
  ice_caller text[] not null default '{}',        -- network routes each side found
  ice_callee text[] not null default '{}',
  created_at timestamptz not null default now(),
  ended_at   timestamptz,
  check (caller <> callee),
  check (char_length(coalesce(offer, '')) <= 20000 and char_length(coalesce(answer, '')) <= 20000)
);
create index if not exists pholama_calls_callee on public.pholama_calls (callee, created_at desc);
create index if not exists pholama_calls_caller on public.pholama_calls (caller, created_at desc);
alter table public.pholama_calls enable row level security;
drop policy if exists "calls read mine" on public.pholama_calls;
create policy "calls read mine" on public.pholama_calls for select using (auth.uid() = caller or auth.uid() = callee);
-- Changes only through the functions below.

create or replace function public.pholama_call_start(p_callee uuid, p_offer text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); cid uuid; nm text;
begin
  if public.pholama_is_banned(me) then raise exception 'You cannot do that right now.'; end if;
  if not public.pholama_are_friends(me, p_callee) or public.pholama_blocked(me, p_callee) then raise exception 'You can only call your friends.'; end if;
  if not public.pholama_pref_raw(p_callee, 'calls') then raise exception 'This friend has calls turned off.'; end if;
  if coalesce(p_offer, '') = '' or char_length(p_offer) > 20000 then raise exception 'The call could not start.'; end if;
  -- Old rings never block a new call.
  update public.pholama_calls set status = 'missed', ended_at = now() where status = 'ringing' and created_at < now() - interval '60 seconds';
  if exists (select 1 from public.pholama_calls where callee = p_callee and status in ('ringing', 'answered') and created_at > now() - interval '2 hours' and (status = 'answered' or created_at > now() - interval '60 seconds')) then
    raise exception 'Your friend is on another call.'; end if;
  if (select count(*) from public.pholama_calls where caller = me and created_at > now() - interval '1 minute') >= 5 then raise exception 'Slow down. Try again in a minute.'; end if;
  insert into public.pholama_calls (caller, callee, offer) values (me, p_callee, p_offer) returning id into cid;
  return cid;
end $$;

create or replace function public.pholama_call_answer(p_call uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user();
begin
  if coalesce(p_answer, '') = '' or char_length(p_answer) > 20000 then raise exception 'The call could not connect.'; end if;
  update public.pholama_calls set status = 'answered', answer = p_answer
    where id = p_call and callee = me and status = 'ringing' and created_at > now() - interval '60 seconds';
  if not found then raise exception 'That call is over.'; end if;
end $$;

-- Add one network route. Either person in the call may add theirs.
create or replace function public.pholama_call_ice(p_call uuid, p_ice text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); c public.pholama_calls;
begin
  if char_length(coalesce(p_ice, '')) > 2000 then return; end if;
  select * into c from public.pholama_calls where id = p_call and (caller = me or callee = me) and status in ('ringing', 'answered');
  if not found then return; end if;
  if c.caller = me then
    if coalesce(array_length(c.ice_caller, 1), 0) < 60 then update public.pholama_calls set ice_caller = array_append(ice_caller, p_ice) where id = p_call; end if;
  else
    if coalesce(array_length(c.ice_callee, 1), 0) < 60 then update public.pholama_calls set ice_callee = array_append(ice_callee, p_ice) where id = p_call; end if;
  end if;
end $$;

-- End it: decline (callee, while ringing), cancel (caller, while ringing) or hang up (either, once answered).
-- A call nobody picked up becomes a "missed call" for the callee.
create or replace function public.pholama_call_end(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); c public.pholama_calls; nm text; st text;
begin
  select * into c from public.pholama_calls where id = p_call and (caller = me or callee = me) and status in ('ringing', 'answered');
  if not found then return; end if;
  if c.status = 'answered' then st := 'ended';
  elsif c.callee = me then st := 'declined';
  else st := 'cancelled'; end if;
  update public.pholama_calls set status = st, ended_at = now() where id = p_call;
  if st = 'cancelled' then
    select platform_name into nm from public.pholama_profiles where user_id = c.caller;
    perform public.pholama_notify(c.callee, 'missed_call', c.caller, coalesce(nm, 'Someone'));
  end if;
end $$;

-- A ring nobody answered in 60 seconds: mark it missed and tell the callee. Called by the page that is ringing.
create or replace function public.pholama_call_timeout(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); c public.pholama_calls; nm text;
begin
  select * into c from public.pholama_calls where id = p_call and (caller = me or callee = me) and status = 'ringing' and created_at <= now() - interval '55 seconds';
  if not found then return; end if;
  update public.pholama_calls set status = 'missed', ended_at = now() where id = p_call;
  select platform_name into nm from public.pholama_profiles where user_id = c.caller;
  perform public.pholama_notify(c.callee, 'missed_call', c.caller, coalesce(nm, 'Someone'));
end $$;

-- ---------- what the page reads ----------
-- My friends with their names, pictures and whether a chat has unread messages. One call instead of many.
create or replace function public.pholama_my_social() returns table (
  other uuid, friend_id bigint, status text, i_asked boolean, name text, avatar_path text, unread bigint, last_body text, last_at timestamptz, allow_calls boolean
) language sql stable security definer set search_path = public as $$
  select o.other, f.id, f.status, (f.a = auth.uid()) as i_asked, pr.platform_name, pr.avatar_path,
         (select count(*) from public.pholama_dms d where d.sender = o.other and d.receiver = auth.uid() and d.read_at is null) as unread,
         (select d.body from public.pholama_dms d where (d.sender = o.other and d.receiver = auth.uid()) or (d.sender = auth.uid() and d.receiver = o.other) order by d.id desc limit 1),
         (select d.created_at from public.pholama_dms d where (d.sender = o.other and d.receiver = auth.uid()) or (d.sender = auth.uid() and d.receiver = o.other) order by d.id desc limit 1),
         case when f.status = 'accepted' then public.pholama_pref_raw(o.other, 'calls') else false end
  from public.pholama_friends f
  cross join lateral (select case when f.a = auth.uid() then f.b else f.a end as other) o
  join public.pholama_profiles pr on pr.user_id = o.other
  where (f.a = auth.uid() or f.b = auth.uid())
    -- A block is only shown to the person who did it; the other side simply sees nothing.
    and (f.status <> 'blocked' or f.a = auth.uid());
$$;

-- Old private messages are cleared after 30 days so the table stays small.
create or replace function public.pholama_dm_sweep() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pholama_dms where created_at < now() - interval '30 days';
  delete from public.pholama_calls where created_at < now() - interval '2 days';
  delete from public.pholama_notifications where created_at < now() - interval '30 days';
end $$;

-- Live updates: tell the page the moment a message, call or notification arrives (Supabase Realtime).
-- Row-level security still applies, so a page only ever hears about its own rows.
do $$ begin
  begin alter publication supabase_realtime add table public.pholama_dms; exception when others then null; end;
  begin alter publication supabase_realtime add table public.pholama_calls; exception when others then null; end;
  begin alter publication supabase_realtime add table public.pholama_notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table public.pholama_friends; exception when others then null; end;
end $$;

-- Who may run which function: logged-in people only. The tables are closed to direct writes.
revoke all on function public.pholama_friend_request(text), public.pholama_friend_answer(bigint, boolean), public.pholama_friend_remove(uuid),
  public.pholama_block(uuid), public.pholama_unblock(uuid), public.pholama_dm_read(uuid), public.pholama_call_start(uuid, text),
  public.pholama_call_answer(uuid, text), public.pholama_call_ice(uuid, text), public.pholama_call_end(uuid), public.pholama_call_timeout(uuid),
  public.pholama_my_social(), public.pholama_dm_sweep() from public, anon;
grant execute on function public.pholama_friend_request(text), public.pholama_friend_answer(bigint, boolean), public.pholama_friend_remove(uuid),
  public.pholama_block(uuid), public.pholama_unblock(uuid), public.pholama_dm_read(uuid), public.pholama_call_start(uuid, text),
  public.pholama_call_answer(uuid, text), public.pholama_call_ice(uuid, text), public.pholama_call_end(uuid), public.pholama_call_timeout(uuid),
  public.pholama_my_social(), public.pholama_dm_sweep() to authenticated;
-- Helpers used inside the rules must not be callable to probe other people's settings.
revoke all on function public.pholama_pref_raw(uuid, text), public.pholama_pref(uuid, text), public.pholama_are_friends(uuid, uuid), public.pholama_blocked(uuid, uuid),
  public.pholama_notify(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.pholama_pref(uuid, text), public.pholama_are_friends(uuid, uuid), public.pholama_blocked(uuid, uuid) to authenticated;
