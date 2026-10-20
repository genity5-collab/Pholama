-- Final Studio/account reset helper.
-- Run in Supabase SQL Editor as an owner.
-- Replace every 0000... UUID with the id from:
-- select id, email from auth.users order by created_at desc;
-- This only resets usage counters. It does not delete projects, files, secrets or sessions.

begin;

-- Cloud Agent Max: Monday-to-Sunday UTC allowance (1,000 credits).
delete from public.pholama_cloud_weekly_usage
where user_id = '00000000-0000-0000-0000-000000000000'::uuid
  and week_start = ((now() at time zone 'utc')::date
    - extract(isodow from (now() at time zone 'utc'))::int + 1);

-- Website Code Studio run allowance (the current daily row).
delete from public.pholama_site_usage
where user_id = '00000000-0000-0000-0000-000000000000'::uuid
  and day = (now() at time zone 'utc')::date;

commit;

-- Optional PC integration allowance reset (run separately only if needed):
-- update public.pholama_credits
-- set balance = 12, period_start = (now() at time zone 'utc')::date,
--     refill_on = (now() at time zone 'utc')::date + 1, updated_at = now()
-- where user_id = '00000000-0000-0000-0000-000000000000'::uuid;
