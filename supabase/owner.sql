-- Pholama: an OWNER moderator, and a help that lists every command.
-- Run AFTER platform.sql, platform2.sql, report_rewards.sql and support.sql. Safe to run twice.
--
-- What this changes
--   * One or more moderators can be marked as OWNER. An owner can give credits to anyone, including themselves,
--     with no 500 limit and no daily cap. Normal moderators keep their limits and still cannot give to themselves.
--   * Every gift is still written to the moderator log, so it is never silent.
--   * `help` now lists EVERY command (the old help text did not know about give, unwarn, tickets, reply, close, reopen).
--   * New commands:  mods            (list moderators, owners marked)
--                    owner <name>    (owners only: make someone else an owner)
--                    me              (shows who you are and whether you are an owner)
--
-- After running this, make yourself the owner ONCE (use your user id from Authentication > Users):
--   update public.pholama_moderators set is_owner = true where user_id = '<YOUR USER ID>';
-- If you are not in the moderators table yet:
--   insert into public.pholama_moderators (user_id, is_owner) values ('<YOUR USER ID>', true)
--   on conflict (user_id) do update set is_owner = true;

alter table public.pholama_moderators add column if not exists is_owner boolean not null default false;

-- The table itself only allowed 1 to 500 per gift. The function still holds normal moderators to 500; owners may go higher.
do $$ declare k text; begin
  for k in select conname from pg_constraint where conrelid = 'public.pholama_credit_grants'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%credits%' and pg_get_constraintdef(oid) ilike '%500%'
  loop execute format('alter table public.pholama_credit_grants drop constraint %I', k); end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.pholama_credit_grants'::regclass and conname = 'pholama_credit_grants_amount') then
    alter table public.pholama_credit_grants add constraint pholama_credit_grants_amount check (credits between 1 and 1000000);
  end if;
end $$;

create or replace function public.pholama_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pholama_moderators where user_id = auth.uid() and is_owner);
$$;

-- Credits: owners are unlimited and may give to themselves; everyone else keeps the old rules.
create or replace function public.pholama_mod_credits(p_user uuid, p_credits int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare own boolean;
begin
  perform public.pholama_need_mod();
  own := public.pholama_is_owner();
  if p_user is null then raise exception 'Who should get the credits? Use a name or user id.'; end if;
  if p_credits is null or p_credits < 1 then raise exception 'Give at least 1 credit.'; end if;
  if not own then
    if p_credits > 500 then raise exception 'Give between 1 and 500 credits.'; end if;
    if p_user = auth.uid() then raise exception 'You cannot give credits to yourself. Ask an owner.'; end if;
    if (select coalesce(sum(credits), 0) from public.pholama_credit_grants where by_mod = auth.uid() and created_at > now() - interval '1 day') + p_credits > 2000 then
      raise exception 'Daily limit reached: a moderator can give at most 2000 credits a day.'; end if;
  elsif p_credits > 1000000 then raise exception 'That is more than 1,000,000. Pick a smaller number.'; end if;
  insert into public.pholama_credit_grants (user_id, credits, reason, by_mod)
    values (p_user, p_credits, left(coalesce(nullif(btrim(p_reason), ''), case when own then 'owner grant' else 'moderator grant' end), 120), auth.uid());
  perform public.pholama_log('credits', p_user, null, (case when own then '[owner] ' else '' end) || p_credits || ' credits: ' || left(coalesce(p_reason, ''), 80));
end $$;

-- A second wrapper around the command box: help, mods, owner, me. Everything else goes to the previous version.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'pholama_mod_cmd' and pronamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_proc where proname = 'pholama_mod_cmd_v2' and pronamespace = 'public'::regnamespace) then
    alter function public.pholama_mod_cmd(text) rename to pholama_mod_cmd_v2;
  end if;
end $$;

create or replace function public.pholama_mod_cmd(p_line text) returns text
language plpgsql security definer set search_path = public as $$
declare w text[]; c text; r text; u uuid; own boolean;
begin
  perform public.pholama_need_mod();
  w := regexp_split_to_array(btrim(coalesce(p_line, '')), '\s+'); c := lower(coalesce(w[1], ''));
  own := public.pholama_is_owner();
  if c = '' or c = 'help' then
    return E'PEOPLE\n  whois <name|id>                 who they are, warnings, ban\n  warn <name|id> <reason>         send a warning\n  unwarn <name|id> [all]          remove the newest warning (or all)\n  ban <name|id> <hours|perm> <reason>\n  unban <name|id>\n'
      || E'POSTS\n  takedown <post id>              hide a post\n  restore <post id>               show it again\n  delete <post id>                remove it for good\n  edit <post id> <new text>\n  project hide|show <project id>\n  daily <title> | <text>          set the daily post\n'
      || E'CREDITS\n  give <name|id> <amount> [reason]      integration credits (moderators: 1-500, max 2000 a day, not yourself)\n  credits <name|id> <amount> [reason]   same as give\n'
      || case when own then E'  (you are an OWNER: any amount, any person, including yourself)\n' else '' end
      || E'TICKETS\n  tickets                         open tickets, newest first\n  reply <ticket id> <text>\n  close <ticket id>\n  reopen <ticket id>\n'
      || E'OTHER\n  me                              who you are\n  mods                            list moderators\n' || case when own then E'  owner <name|id>                make someone an owner\n' else '' end
      || E'  help                            this list\nNames are the Platform names. A ticket id can be the first 8 characters.';
  elsif c = 'me' then
    select format('You are %s | id %s | %s', coalesce(p.platform_name, '(no profile name)'), auth.uid(), case when own then 'OWNER' else 'moderator' end) into r
      from (select 1) x left join public.pholama_profiles p on p.user_id = auth.uid();
    return r;
  elsif c = 'mods' then
    select coalesce(string_agg(format('%s%s  %s', coalesce(p.platform_name, '(no profile)'), case when m.is_owner then ' [owner]' else '' end, left(m.user_id::text, 8)), E'\n' order by m.is_owner desc, m.added_at), 'No moderators.') into r
      from public.pholama_moderators m left join public.pholama_profiles p on p.user_id = m.user_id;
    return r;
  elsif c = 'owner' then
    if not own then raise exception 'Only an owner can make another owner.'; end if;
    u := public.pholama_find_user(w[2]);
    insert into public.pholama_moderators (user_id, is_owner) values (u, true) on conflict (user_id) do update set is_owner = true;
    perform public.pholama_log('owner', u, null, 'made owner'); return 'Done. They are now a moderator and an owner.';
  end if;
  return public.pholama_mod_cmd_v2(p_line);
end $$;

-- Only a moderator may list the moderators' rows through the command box; the table itself stays private.
revoke all on function public.pholama_mod_cmd_v2(text) from public;
revoke all on function public.pholama_is_owner() from public;
grant execute on function public.pholama_is_owner() to authenticated;
grant execute on function public.pholama_mod_cmd(text) to authenticated;
