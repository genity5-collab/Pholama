-- =====================================================================
-- Pholama: support tickets, moderator credit grants, unwarn.
-- Run AFTER platform.sql, platform2.sql and report_rewards.sql. Safe to run again.
-- Supabase > SQL Editor > New query > paste all of it > Run.
--
-- Tickets:
--   * Anyone signed in (and not banned) can open a ticket. At most 3 open at once.
--   * Only you and moderators can read your ticket.
--   * ONLY MODERATORS can reply. You can add follow-up notes while it is open, and you cannot write as a moderator.
--   * Moderators can close, reopen, grant integration credits (max 500 per grant), unban and unwarn.
-- Credits:
--   * Moderator grants and report rewards both end up in pholama_credit_grants and are claimed the same way.
-- =====================================================================

-- ---------- tickets ----------
create table if not exists public.pholama_tickets (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  subject    text        not null check (char_length(btrim(subject)) between 3 and 80),
  category   text        not null default 'other' check (category in ('account','ban','credits','bug','other')),
  status     text        not null default 'open' check (status in ('open','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_by  uuid
);
create index if not exists pholama_tickets_user on public.pholama_tickets (user_id, updated_at desc);
create index if not exists pholama_tickets_open on public.pholama_tickets (status, updated_at desc);

create table if not exists public.pholama_ticket_messages (
  id         bigint      generated always as identity primary key,
  ticket_id  uuid        not null references public.pholama_tickets(id) on delete cascade,
  author     uuid        not null,
  from_mod   boolean     not null default false,
  body       text        not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists pholama_ticket_messages_t on public.pholama_ticket_messages (ticket_id, id);

alter table public.pholama_tickets enable row level security;
alter table public.pholama_ticket_messages enable row level security;
drop policy if exists "tickets read own or mod" on public.pholama_tickets;
drop policy if exists "ticket msgs read own or mod" on public.pholama_ticket_messages;
create policy "tickets read own or mod" on public.pholama_tickets for select using (auth.uid() = user_id or public.pholama_is_mod());
create policy "ticket msgs read own or mod" on public.pholama_ticket_messages for select using (
  public.pholama_is_mod() or exists (select 1 from public.pholama_tickets t where t.id = ticket_id and t.user_id = auth.uid()));
-- No insert/update/delete policies on purpose: everything goes through the functions below, which check who you are.

-- open a ticket
create or replace function public.pholama_ticket_open(p_subject text, p_category text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if public.pholama_is_banned(auth.uid()) and p_category <> 'ban' then raise exception 'You are banned. You can still open a "ban" ticket to appeal.'; end if;
  select count(*) into n from public.pholama_tickets where user_id = auth.uid() and status <> 'closed';
  if n >= 3 then raise exception 'You already have 3 open tickets. Wait for an answer or ask for one to be closed.'; end if;
  if (select count(*) from public.pholama_tickets where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 5 then raise exception 'Slow down. Try again in a while.'; end if;
  insert into public.pholama_tickets (user_id, subject, category) values (auth.uid(), btrim(p_subject), coalesce(nullif(p_category, ''), 'other')) returning id into t;
  insert into public.pholama_ticket_messages (ticket_id, author, from_mod, body) values (t, auth.uid(), false, btrim(p_body));
  return t;
end $$;

-- add a message. A moderator's message is marked from_mod and sets the ticket to "answered".
-- A normal person can only write on their OWN ticket while it is not closed, and it goes back to "open".
create or replace function public.pholama_ticket_say(p_ticket uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.pholama_tickets; m boolean := public.pholama_is_mod();
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into t from public.pholama_tickets where id = p_ticket;
  if t.id is null then raise exception 'No such ticket.'; end if;
  if not m and t.user_id <> auth.uid() then raise exception 'That is not your ticket.'; end if;
  if t.status = 'closed' then raise exception 'This ticket is closed.'; end if;
  insert into public.pholama_ticket_messages (ticket_id, author, from_mod, body) values (p_ticket, auth.uid(), m, btrim(p_body));
  update public.pholama_tickets set status = case when m then 'answered' else 'open' end, updated_at = now() where id = p_ticket;
end $$;

-- close / reopen (moderators only)
create or replace function public.pholama_ticket_close(p_ticket uuid, p_closed boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  perform public.pholama_need_mod();
  update public.pholama_tickets set status = case when p_closed then 'closed' else 'open' end, closed_by = case when p_closed then auth.uid() else null end, updated_at = now()
    where id = p_ticket returning user_id into u;
  if u is null then raise exception 'No such ticket.'; end if;
  perform public.pholama_log(case when p_closed then 'ticket close' else 'ticket reopen' end, u, null, p_ticket::text);
end $$;

-- ---------- one ledger for credits: moderator grants + report rewards ----------
create table if not exists public.pholama_credit_grants (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  credits    int         not null check (credits between 1 and 500),
  reason     text        not null check (char_length(reason) <= 120),
  by_mod     uuid,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists pholama_credit_grants_u on public.pholama_credit_grants (user_id, claimed_at);
alter table public.pholama_credit_grants enable row level security;
drop policy if exists "grants read own" on public.pholama_credit_grants;
create policy "grants read own" on public.pholama_credit_grants for select using (auth.uid() = user_id or public.pholama_is_mod());

-- A moderator gives integration credits. Max 500 each, max 2000 per moderator per day, and never to yourself.
create or replace function public.pholama_mod_credits(p_user uuid, p_credits int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.pholama_need_mod();
  if p_credits is null or p_credits < 1 or p_credits > 500 then raise exception 'Give between 1 and 500 credits.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot give credits to yourself.'; end if;
  if (select coalesce(sum(credits), 0) from public.pholama_credit_grants where by_mod = auth.uid() and created_at > now() - interval '1 day') + p_credits > 2000 then
    raise exception 'Daily limit reached: a moderator can give at most 2000 credits a day.'; end if;
  insert into public.pholama_credit_grants (user_id, credits, reason, by_mod) values (p_user, p_credits, left(coalesce(nullif(btrim(p_reason), ''), 'moderator grant'), 120), auth.uid());
  perform public.pholama_log('credits', p_user, null, p_credits || ' credits: ' || left(coalesce(p_reason, ''), 80));
end $$;

-- Remove a warning (moderators only). Warnings are never silently gone: the log keeps a line.
create or replace function public.pholama_mod_unwarn(p_user uuid, p_all boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.pholama_need_mod();
  if p_all then delete from public.pholama_warnings where user_id = p_user;
  else delete from public.pholama_warnings where id = (select id from public.pholama_warnings where user_id = p_user order by created_at desc limit 1); end if;
  get diagnostics n = row_count;
  perform public.pholama_log('unwarn', p_user, null, n || ' removed');
  return n;
end $$;

-- What is waiting for me (report rewards + moderator grants), and claim it exactly once.
create or replace function public.pholama_my_rewards() returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(credits) from public.pholama_rewards where reporter = auth.uid() and claimed_at is null), 0)
        + coalesce((select sum(credits) from public.pholama_credit_grants where user_id = auth.uid() and claimed_at is null), 0))::int;
$$;
create or replace function public.pholama_claim_rewards() returns int
language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  with c as (update public.pholama_rewards set claimed_at = now() where reporter = auth.uid() and claimed_at is null returning credits) select coalesce(sum(credits), 0)::int into a from c;
  with c as (update public.pholama_credit_grants set claimed_at = now() where user_id = auth.uid() and claimed_at is null returning credits) select coalesce(sum(credits), 0)::int into b from c;
  return a + b;
end $$;

-- Terminal commands: the old command box gets the new ones too. It replaces pholama_mod_cmd and keeps every old command.
-- First run only: keep the original command list under a new name (if it is already renamed, this does nothing).
do $$ begin
  if exists (select 1 from pg_proc where proname = 'pholama_mod_cmd' and pronamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_proc where proname = 'pholama_mod_cmd_base' and pronamespace = 'public'::regnamespace) then
    alter function public.pholama_mod_cmd(text) rename to pholama_mod_cmd_base;
  end if;
end $$;
create or replace function public.pholama_mod_cmd(p_line text) returns text
language plpgsql security definer set search_path = public as $$
declare w text[]; c text; u uuid; rest text; pr public.pholama_profiles; nw int; hrs int; d text[]; n int; r text;
begin
  perform public.pholama_need_mod();
  w := regexp_split_to_array(btrim(p_line), '\s+'); c := lower(w[1]);
  if c = 'unwarn' then
    u := public.pholama_find_user(w[2]); n := public.pholama_mod_unwarn(u, lower(coalesce(w[3], '')) = 'all');
    return case when n = 0 then 'No warnings to remove.' else n || ' warning(s) removed.' end;
  elsif c = 'credits' or c = 'give' then
    u := public.pholama_find_user(w[2]); rest := btrim(regexp_replace(p_line, '^\s*\S+\s+\S+\s+\S+\s*', ''));
    perform public.pholama_mod_credits(u, w[3]::int, rest); return w[3] || ' credits given. They are added the next time the person opens Pholama.';
  elsif c = 'tickets' then
    select coalesce(string_agg(format('%s | %s | %s | %s', left(t.id::text, 8), t.status, coalesce(p.platform_name, '?'), t.subject), E'\n' order by t.updated_at desc), 'No open tickets.') into r
      from (select * from public.pholama_tickets where status <> 'closed' order by updated_at desc limit 15) t left join public.pholama_profiles p on p.user_id = t.user_id;
    return r;
  elsif c = 'reply' then
    rest := btrim(regexp_replace(p_line, '^\s*\S+\s+\S+\s*', ''));
    perform public.pholama_ticket_say((select id from public.pholama_tickets where id::text like w[2] || '%' limit 1), rest); return 'Replied.';
  elsif c = 'close' then perform public.pholama_ticket_close((select id from public.pholama_tickets where id::text like w[2] || '%' limit 1), true); return 'Ticket closed.';
  elsif c = 'reopen' then perform public.pholama_ticket_close((select id from public.pholama_tickets where id::text like w[2] || '%' limit 1), false); return 'Ticket reopened.';
  end if;
  -- everything else is handled by the original command list
  return public.pholama_mod_cmd_base(p_line);
end $$;

revoke all on function public.pholama_mod_cmd_base(text) from public;
revoke all on function public.pholama_mod_credits(uuid, int, text), public.pholama_mod_unwarn(uuid, boolean), public.pholama_ticket_close(uuid, boolean) from public;
grant execute on function public.pholama_mod_credits(uuid, int, text), public.pholama_mod_unwarn(uuid, boolean), public.pholama_ticket_close(uuid, boolean) to authenticated;
revoke all on function public.pholama_ticket_open(text, text, text), public.pholama_ticket_say(uuid, text), public.pholama_my_rewards(), public.pholama_claim_rewards() from public;
grant execute on function public.pholama_ticket_open(text, text, text), public.pholama_ticket_say(uuid, text), public.pholama_my_rewards(), public.pholama_claim_rewards() to authenticated;
