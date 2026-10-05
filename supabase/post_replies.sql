-- Pholama Platform: replies under a post, so people can chat inside a post (opened in the big window).
-- Run this once in the Supabase SQL editor. It is safe to run again.
-- A reply lives exactly as long as its post (it is deleted with the post), follows the same safety rules as posts,
-- and the database, not the web page, decides who may read or write.

create table if not exists public.pholama_post_replies (
  id         bigint      generated always as identity primary key,
  post_id    uuid        not null references public.pholama_posts(id) on delete cascade,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now(),
  hidden     boolean     not null default false
);
create index if not exists pholama_post_replies_post on public.pholama_post_replies (post_id, id);

alter table public.pholama_post_replies enable row level security;
drop policy if exists "replies read live" on public.pholama_post_replies;
drop policy if exists "replies insert own" on public.pholama_post_replies;
drop policy if exists "replies delete own" on public.pholama_post_replies;
drop policy if exists "replies mod update" on public.pholama_post_replies;

-- You can read a reply when you can read its post (RLS on pholama_posts applies inside the subquery). Hidden replies: only the author and moderators.
create policy "replies read live" on public.pholama_post_replies for select using (
  exists (select 1 from public.pholama_posts p where p.id = post_id)
  and (hidden = false or user_id = auth.uid() or public.pholama_is_mod()));
create policy "replies insert own" on public.pholama_post_replies for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.pholama_posts p where p.id = post_id and p.expires_at > now() and p.hidden = false)
  and exists (select 1 from public.pholama_profiles pr where pr.user_id = auth.uid() and pr.banned = false));
create policy "replies delete own" on public.pholama_post_replies for delete using (auth.uid() = user_id or public.pholama_is_mod());
create policy "replies mod update" on public.pholama_post_replies for update using (public.pholama_is_mod()) with check (public.pholama_is_mod());

-- Same filter and rate limit as posts, enforced on the database.
create or replace function public.pholama_reply_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent int; t text;
begin
  new.body := btrim(new.body);
  new.created_at := now();
  new.hidden := false;
  t := lower(new.body);
  if t ~ '(https?://|www\.|discord\.gg|\.(com|net|org|ru|xyz|io)/)' then raise exception 'Links are not allowed in replies.'; end if;
  if t ~ '(gho_|ghp_|github_pat_|sk-[a-z0-9]{10}|phk_[a-z0-9]{6}|eyj[a-z0-9_-]{20})' then raise exception 'That looks like a secret key. Replies are public, so it was blocked.'; end if;
  if t ~ '(nigger|faggot|kill yourself|kys\b)' then raise exception 'That message breaks the community rules.'; end if;
  select count(*) into recent from public.pholama_post_replies where user_id = new.user_id and created_at > now() - interval '1 minute';
  if recent >= 6 then raise exception 'Slow down. Try again in a minute.'; end if;
  select count(*) into recent from public.pholama_post_replies where post_id = new.post_id;
  if recent >= 200 then raise exception 'This post is full. Start a new post.'; end if;
  return new;
end $$;
drop trigger if exists pholama_reply_guard on public.pholama_post_replies;
create trigger pholama_reply_guard before insert on public.pholama_post_replies for each row execute function public.pholama_reply_guard();
