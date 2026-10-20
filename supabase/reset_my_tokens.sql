-- Reset one account's Pholama allowances after replacing the account UUID below.
-- Run this in Supabase SQL Editor as an owner. It does not touch passwords, sessions,
-- projects, messages, or integration credentials.
--
-- 1) Find the UUID (do not paste an access token here):
-- select id, email from auth.users order by created_at desc;
-- 2) Replace the UUID in both statements, then run the transaction.

begin;

-- Cloud Agent Max: restore the current Monday UTC week to zero used / 1,000 left.
delete from public.pholama_cloud_weekly_usage
where user_id = '00000000-0000-0000-0000-000000000000'::uuid
  and week_start = ((now() at time zone 'utc')::date
    - extract(isodow from (now() at time zone 'utc'))::int + 1);

-- Optional integration allowance used by local-PC tools and agents.
-- Uncomment only if that is the balance you meant to reset.
-- update public.pholama_credits
-- set balance = 12,
--     period_start = (now() at time zone 'utc')::date,
--     refill_on = (now() at time zone 'utc')::date + 1,
--     updated_at = now()
-- where user_id = '00000000-0000-0000-0000-000000000000'::uuid;

commit;

-- Verify the cloud row is gone (zero used is represented by no row):
-- select * from public.pholama_cloud_weekly_usage
-- where user_id = '00000000-0000-0000-0000-000000000000'::uuid;
