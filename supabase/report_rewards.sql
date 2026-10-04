-- =====================================================================
-- Pholama: report a bad post, it gets removed, you earn 100 integration credits.
-- Run AFTER platform.sql and platform2.sql. Safe to run again.
-- Supabase > SQL Editor > New query > paste all of it > Run.
--
-- The rules (all decided here in the database, so a page cannot fake them):
--   * Only a MODERATOR removing or taking down a post pays. Three people reporting (automatic hide) does NOT pay by itself.
--   * You are paid once per post, ever (primary key below), and only if you reported BEFORE it was removed.
--   * You never earn from your own post.
--   * A ban sweep (banning someone deletes their posts) does not pay. Only a moderator judging a reported post does.
--   * At most 500 credits can be earned per account per day, so report-spam cannot farm credits.
-- The credits are added on YOUR PC (or the site) when you open Pholama: it asks for what is waiting, adds it, and marks it claimed.
-- =====================================================================

create table if not exists public.pholama_rewards (
  post_id    uuid        not null,                                   -- no foreign key on purpose: the post is deleted when a mod removes it
  reporter   uuid        not null references auth.users(id) on delete cascade,
  credits    int         not null default 100 check (credits between 1 and 100),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  primary key (post_id, reporter)                                    -- one reward per person per post, ever
);
alter table public.pholama_rewards enable row level security;
drop policy if exists "rewards read own" on public.pholama_rewards;
create policy "rewards read own" on public.pholama_rewards for select using (auth.uid() = reporter);
-- nobody can insert, update or delete directly. Only the functions below can.

-- Pays everyone who reported this post BEFORE now. Called by the two moderator actions, before the post can disappear.
create or replace function public.pholama_pay_reporters(p_post uuid) returns int
language plpgsql security definer set search_path = public as $$
declare author uuid; n int := 0; r record; today_total int;
begin
  select user_id into author from public.pholama_posts where id = p_post;
  if author is null then return 0; end if;
  for r in select reporter from public.pholama_reports where post_id = p_post and reporter <> author loop
    select coalesce(sum(credits), 0) into today_total from public.pholama_rewards where reporter = r.reporter and created_at > now() - interval '1 day';
    continue when today_total + 100 > 500;                           -- daily cap per account
    insert into public.pholama_rewards (post_id, reporter, credits) values (p_post, r.reporter, 100) on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.pholama_pay_reporters(uuid) from public;   -- not callable from a page

-- Delete: pay first (the delete would erase the reports), then remove.
create or replace function public.pholama_mod_remove(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; paid int;
begin
  perform public.pholama_need_mod();
  select user_id into u from public.pholama_posts where id = p_post;
  paid := public.pholama_pay_reporters(p_post);
  delete from public.pholama_posts where id = p_post;
  perform public.pholama_log('delete', u, p_post, case when paid > 0 then paid || ' reporter(s) rewarded' else null end);
end $$;

-- Take down (hide): pays when hiding. Restoring never pays, and never takes a reward back.
create or replace function public.pholama_mod_hide(p_post uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
declare paid int := 0;
begin
  perform public.pholama_need_mod();
  if p_hidden then paid := public.pholama_pay_reporters(p_post); end if;
  update public.pholama_posts set hidden = p_hidden where id = p_post;
  perform public.pholama_log(case when p_hidden then 'takedown' else 'restore' end, (select user_id from public.pholama_posts where id = p_post), p_post, case when paid > 0 then paid || ' reporter(s) rewarded' else null end);
end $$;

-- What is waiting for me? (credits earned and not yet added to my Pholama)
create or replace function public.pholama_my_rewards() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(credits), 0)::int from public.pholama_rewards where reporter = auth.uid() and claimed_at is null;
$$;
revoke all on function public.pholama_my_rewards() from public;
grant execute on function public.pholama_my_rewards() to authenticated;

-- Mark them claimed. Returns how many credits were just claimed, so two devices cannot both add the same reward.
create or replace function public.pholama_claim_rewards() returns int
language plpgsql security definer set search_path = public as $$
declare total int;
begin
  with c as (update public.pholama_rewards set claimed_at = now() where reporter = auth.uid() and claimed_at is null returning credits)
  select coalesce(sum(credits), 0)::int into total from c;
  return total;
end $$;
revoke all on function public.pholama_claim_rewards() from public;
grant execute on function public.pholama_claim_rewards() to authenticated;
