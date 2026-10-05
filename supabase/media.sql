-- Pholama Platform: pictures and videos in posts, builds, tickets and private messages.
-- Run this once in the Supabase SQL editor, AFTER social.sql. It is safe to run again.
-- Links stay blocked everywhere. A picture or video is a FILE the person uploads here, never a web address.
--
-- Rules the database enforces (a changed page cannot get around them):
--  * only PNG, JPG, WebP, GIF pictures and MP4, WebM videos (no SVG, it can carry scripts)
--  * pictures up to 5 MB, videos up to 25 MB (the bucket refuses anything bigger)
--  * a file lives in its owner's own folder, and a post/build/ticket/message may only point at the sender's own files
--  * private-message files can be opened only by the two people in that conversation
--  * ticket files can be opened only by the ticket owner and moderators

-- ---------- buckets ----------
-- Public: posts and builds (anyone can see posts and builds anyway).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pholama-media', 'pholama-media', true, 26214400, array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public = true, file_size_limit = 26214400, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'];
-- Private: private messages and tickets. Nobody can open these by guessing a web address.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pholama-private', 'pholama-private', false, 26214400, array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'];

-- ---------- attachments on each thing ----------
alter table public.pholama_posts add column if not exists media_path text;
alter table public.pholama_post_replies add column if not exists media_path text;
alter table public.pholama_projects add column if not exists video_path text;
alter table public.pholama_dms add column if not exists media_path text;
alter table public.pholama_ticket_messages add column if not exists media_path text;

-- ---------- what a stored file path must look like ----------
-- <owner id>/<kind>/<random id>.<ext>   kind = post | build | ticket | dm
create or replace function public.pholama_media_path_ok(p_path text, p_owner uuid, p_kind text) returns boolean
language sql immutable as $$
  select p_path ~ ('^' || p_owner::text || '/' || p_kind || '/[0-9a-f-]{8,40}\.(png|jpg|jpeg|webp|gif|mp4|webm)$');
$$;
-- Is this path a video? (the page uses it to pick <video> or <img>)
create or replace function public.pholama_media_is_video(p_path text) returns boolean
language sql immutable as $$ select p_path ~ '\.(mp4|webm)$'; $$;

-- ---------- public bucket: anyone can look, only the owner can add or remove, only in their own folder ----------
drop policy if exists "media read" on storage.objects;
drop policy if exists "media insert own" on storage.objects;
drop policy if exists "media delete own" on storage.objects;
create policy "media read" on storage.objects for select using (bucket_id = 'pholama-media');
create policy "media insert own" on storage.objects for insert with check (
  bucket_id = 'pholama-media' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] in ('post', 'build')
  and not public.pholama_is_banned(auth.uid()));
create policy "media delete own" on storage.objects for delete using (bucket_id = 'pholama-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- private bucket ----------
drop policy if exists "private insert own" on storage.objects;
drop policy if exists "private delete own" on storage.objects;
drop policy if exists "private read" on storage.objects;
create policy "private insert own" on storage.objects for insert with check (
  bucket_id = 'pholama-private' and (storage.foldername(name))[1] = auth.uid()::text and (storage.foldername(name))[2] in ('dm', 'ticket')
  and not public.pholama_is_banned(auth.uid()));
create policy "private delete own" on storage.objects for delete using (bucket_id = 'pholama-private' and (storage.foldername(name))[1] = auth.uid()::text);

-- Who may open a private file: the uploader; for a private message, the person it was sent to; for a ticket, the owner of the ticket and moderators.
create or replace function public.pholama_private_can_read(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    split_part(p_path, '/', 1) = auth.uid()::text
    or exists (select 1 from public.pholama_dms d where d.media_path = p_path and (d.sender = auth.uid() or d.receiver = auth.uid()))
    or exists (select 1 from public.pholama_ticket_messages m join public.pholama_tickets t on t.id = m.ticket_id
               where m.media_path = p_path and (t.user_id = auth.uid() or public.pholama_is_mod()))
  );
$$;
-- Safe for visitors who are not logged in too: with nobody logged in it just answers no.
revoke all on function public.pholama_private_can_read(text) from public;
grant execute on function public.pholama_private_can_read(text) to anon, authenticated;
create policy "private read" on storage.objects for select using (bucket_id = 'pholama-private' and public.pholama_private_can_read(name));

-- A message may be only a picture/video with no words.
alter table public.pholama_dms drop constraint if exists pholama_dms_body_check;
alter table public.pholama_dms add constraint pholama_dms_body_check check (char_length(btrim(body)) <= 500 and (char_length(btrim(body)) >= 1 or media_path is not null));
alter table public.pholama_posts drop constraint if exists pholama_posts_body_check;
alter table public.pholama_posts add constraint pholama_posts_body_check check (char_length(btrim(body)) <= 500 and (char_length(btrim(body)) >= 1 or media_path is not null));
alter table public.pholama_ticket_messages drop constraint if exists pholama_ticket_messages_body_check;
alter table public.pholama_ticket_messages add constraint pholama_ticket_messages_body_check check (char_length(btrim(body)) <= 1000 and (char_length(btrim(body)) >= 1 or media_path is not null));

-- ---------- the database checks the attachment on every save ----------
-- Posts: the file must be the author's own, in their post folder.
create or replace function public.pholama_post_media_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.media_path is not null and not public.pholama_media_path_ok(new.media_path, new.user_id, 'post') then
    raise exception 'Attach a picture or video by uploading it here, not with a link.'; end if;
  return new;
end $$;
drop trigger if exists pholama_post_media_guard on public.pholama_posts;
create trigger pholama_post_media_guard before insert on public.pholama_posts for each row execute function public.pholama_post_media_guard();
drop trigger if exists pholama_reply_media_guard on public.pholama_post_replies;
create trigger pholama_reply_media_guard before insert on public.pholama_post_replies for each row execute function public.pholama_post_media_guard();

-- Builds (projects): pictures were already checked; a build may now also carry one video, and the pictures may be GIF too.
create or replace function public.pholama_project_media_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  if new.video_path is not null and not (public.pholama_media_path_ok(new.video_path, new.user_id, 'build') and public.pholama_media_is_video(new.video_path)) then
    raise exception 'A build video must be uploaded here as MP4 or WebM, not a link.'; end if;
  return new;
end $$;
drop trigger if exists pholama_project_media_guard on public.pholama_projects;
create trigger pholama_project_media_guard before insert or update on public.pholama_projects for each row execute function public.pholama_project_media_guard();

-- Private messages: the file must be the sender's own.
create or replace function public.pholama_dm_media_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.media_path is not null and not public.pholama_media_path_ok(new.media_path, new.sender, 'dm') then
    raise exception 'Send a picture or video by uploading it here, not with a link.'; end if;
  return new;
end $$;
drop trigger if exists pholama_dm_media_guard on public.pholama_dms;
create trigger pholama_dm_media_guard before insert on public.pholama_dms for each row execute function public.pholama_dm_media_guard();

-- Tickets: the file must belong to whoever is writing (the ticket owner, or a moderator replying).
create or replace function public.pholama_ticket_media_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.media_path is not null and not public.pholama_media_path_ok(new.media_path, new.author, 'ticket') then
    raise exception 'Attach a picture or video by uploading it here, not with a link.'; end if;
  return new;
end $$;
drop trigger if exists pholama_ticket_media_guard on public.pholama_ticket_messages;
create trigger pholama_ticket_media_guard before insert on public.pholama_ticket_messages for each row execute function public.pholama_ticket_media_guard();

-- One account can keep only so much: 200 files, so storage cannot be filled by one person.
create or replace function public.pholama_media_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.bucket_id in ('pholama-media', 'pholama-private') then
    select count(*) into n from storage.objects where bucket_id = new.bucket_id and (storage.foldername(name))[1] = (storage.foldername(new.name))[1];
    if n >= 200 then raise exception 'You have reached the limit of 200 files. Delete some first.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists pholama_media_quota on storage.objects;
create trigger pholama_media_quota before insert on storage.objects for each row execute function public.pholama_media_quota();

-- ---------- tickets with a picture or video ----------
-- Same functions as before plus an optional file. Old calls (no file) keep working.
drop function if exists public.pholama_ticket_open(text, text, text);
create or replace function public.pholama_ticket_open(p_subject text, p_category text, p_body text, p_media text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if public.pholama_is_banned(auth.uid()) and p_category <> 'ban' then raise exception 'You are banned. You can still open a "ban" ticket to appeal.'; end if;
  perform public.pholama_ticket_text_ok(coalesce(p_subject, '') || ' ' || coalesce(p_body, ''));
  select count(*) into n from public.pholama_tickets where user_id = auth.uid() and status <> 'closed';
  if n >= 3 then raise exception 'You already have 3 open tickets. Wait for an answer or ask for one to be closed.'; end if;
  if (select count(*) from public.pholama_tickets where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 5 then raise exception 'Slow down. Try again in a while.'; end if;
  insert into public.pholama_tickets (user_id, subject, category) values (auth.uid(), btrim(p_subject), coalesce(nullif(p_category, ''), 'other')) returning id into t;
  insert into public.pholama_ticket_messages (ticket_id, author, from_mod, body, media_path) values (t, auth.uid(), false, btrim(coalesce(p_body, '')), p_media);
  return t;
end $$;

drop function if exists public.pholama_ticket_say(uuid, text);
create or replace function public.pholama_ticket_say(p_ticket uuid, p_body text, p_media text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.pholama_tickets; m boolean := public.pholama_is_mod();
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into t from public.pholama_tickets where id = p_ticket;
  if t.id is null then raise exception 'No such ticket.'; end if;
  if not m and t.user_id <> auth.uid() then raise exception 'That is not your ticket.'; end if;
  if t.status = 'closed' then raise exception 'This ticket is closed.'; end if;
  perform public.pholama_ticket_text_ok(coalesce(p_body, ''));
  insert into public.pholama_ticket_messages (ticket_id, author, from_mod, body, media_path) values (p_ticket, auth.uid(), m, btrim(coalesce(p_body, '')), p_media);
  update public.pholama_tickets set status = case when m then 'answered' else 'open' end, updated_at = now() where id = p_ticket;
end $$;

-- Tickets had no link or secret-key filter. Now they do, the same as everywhere else.
create or replace function public.pholama_ticket_text_ok(p_text text) returns void
language plpgsql immutable as $$
declare t text := lower(coalesce(p_text, ''));
begin
  if t ~ '(https?://|www\.|discord\.gg|\.(com|net|org|ru|xyz|io)/)' then raise exception 'Links are not allowed in tickets. Attach a picture or video instead.'; end if;
  if t ~ '(gho_|ghp_|github_pat_|sk-[a-z0-9]{10}|phk_[a-z0-9]{6}|eyj[a-z0-9_-]{20})' then raise exception 'That looks like a secret key, so it was blocked.'; end if;
end $$;
revoke all on function public.pholama_ticket_open(text, text, text, text), public.pholama_ticket_say(uuid, text, text), public.pholama_ticket_text_ok(text) from public, anon;
grant execute on function public.pholama_ticket_open(text, text, text, text), public.pholama_ticket_say(uuid, text, text), public.pholama_ticket_text_ok(text) to authenticated;
