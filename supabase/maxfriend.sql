-- Agent Max as a built-in friend.
-- Run once in the Supabase SQL editor AFTER pro.sql. It is safe to run again.
--
-- Agent Max is NOT a row in pholama_friends and not a user. The page shows it at the top of the friend list.
-- That is on purpose: it means it cannot be removed, blocked, reported, called, or counted against the friend limit,
-- because none of those rules ever touch it.
--
-- A member can send Agent Max 5 messages a day (10 with Pholama Pro). The database counts them, so a changed page cannot skip the limit.
-- The reply is written by the cloud function (service key), never by the page.

create table if not exists public.pholama_max_chat (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'max')),
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists pholama_max_chat_user on public.pholama_max_chat (user_id, id desc);
alter table public.pholama_max_chat enable row level security;
drop policy if exists "maxchat read mine" on public.pholama_max_chat;
drop policy if exists "maxchat delete mine" on public.pholama_max_chat;
-- A member reads and clears only their own chat. There is NO insert or update policy, so with row security on a page can never
-- write or edit a row: only the functions below (which run with the owner's rights) can. Grants alone are not trusted, because
-- Supabase hands new tables to the logged-in role by default; the missing policy is what keeps the door shut.
create policy "maxchat read mine" on public.pholama_max_chat for select using (auth.uid() = user_id);
create policy "maxchat delete mine" on public.pholama_max_chat for delete using (auth.uid() = user_id);
revoke insert, update on public.pholama_max_chat from anon, authenticated;
alter table public.pholama_max_chat force row level security;

-- One row per member per UTC day: how many messages they have sent Agent Max.
create table if not exists public.pholama_max_chat_day (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  used    int  not null default 0,
  primary key (user_id, day)
);
alter table public.pholama_max_chat_day enable row level security;
alter table public.pholama_max_chat_day force row level security;
-- No policy at all = no page can read or change the counter. (The functions below use the owner's rights to count.)
revoke all on public.pholama_max_chat_day from anon, authenticated;

-- The member sends a message. Counts it FIRST (atomically), then stores it. Returns how many are left today.
create or replace function public.pholama_max_chat_send(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); cap int; n int; t text := btrim(coalesce(p_body, '')); d date := (now() at time zone 'utc')::date;
begin
  if public.pholama_is_banned(me) then raise exception 'You cannot do that right now.'; end if;
  if char_length(t) < 1 then raise exception 'Type a message first.'; end if;
  if char_length(t) > 500 then raise exception 'Keep it under 500 characters.'; end if;
  if lower(t) ~ '(gho_|ghp_|github_pat_|sk-[a-z0-9]{10}|phk_[a-z0-9]{6}|eyj[a-z0-9_-]{20})' then raise exception 'That looks like a secret key, so it was blocked.'; end if;
  cap := (public.pholama_limits(public.pholama_is_pro(me)) ->> 'max_dms')::int;
  insert into public.pholama_max_chat_day (user_id, day, used) values (me, d, 1)
    on conflict (user_id, day) do update set used = public.pholama_max_chat_day.used + 1
    where public.pholama_max_chat_day.used < cap
    returning used into n;
  if n is null then return jsonb_build_object('ok', false, 'reason', 'day', 'cap', cap, 'used', cap, 'left', 0); end if;
  insert into public.pholama_max_chat (user_id, role, body) values (me, 'user', t);
  return jsonb_build_object('ok', true, 'cap', cap, 'used', n, 'left', cap - n);
end $$;

-- Gives today's message back if Agent Max could not answer (called by the cloud function only).
create or replace function public.pholama_max_chat_refund(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.pholama_max_chat_day set used = greatest(0, used - 1) where user_id = p_user and day = (now() at time zone 'utc')::date;
$$;

-- The cloud function stores Agent Max's reply (service key only).
create or replace function public.pholama_max_chat_reply(p_user uuid, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.pholama_max_chat (user_id, role, body) values (p_user, 'max', left(btrim(coalesce(p_body, '')), 2000))
$$;

-- How many messages are left today, for the chat screen.
create or replace function public.pholama_max_chat_left() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.pholama_need_user(); cap int; n int;
begin
  cap := (public.pholama_limits(public.pholama_is_pro(me)) ->> 'max_dms')::int;
  select coalesce(max(used), 0) into n from public.pholama_max_chat_day where user_id = me and day = (now() at time zone 'utc')::date;
  return jsonb_build_object('cap', cap, 'used', n, 'left', greatest(0, cap - n));
end $$;

-- Chats are kept for 30 days, then cleared.
create or replace function public.pholama_max_chat_sweep() returns void
language sql security definer set search_path = public as $$
  delete from public.pholama_max_chat where created_at < now() - interval '30 days';
  delete from public.pholama_max_chat_day where day < (now() at time zone 'utc')::date - 2;
$$;

revoke all on function public.pholama_max_chat_send(text), public.pholama_max_chat_refund(uuid), public.pholama_max_chat_reply(uuid, text),
  public.pholama_max_chat_left(), public.pholama_max_chat_sweep() from public, anon, authenticated;
grant execute on function public.pholama_max_chat_send(text), public.pholama_max_chat_left() to authenticated;
grant execute on function public.pholama_max_chat_refund(uuid), public.pholama_max_chat_reply(uuid, text), public.pholama_max_chat_sweep() to service_role;
