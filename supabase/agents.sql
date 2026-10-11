-- Pholama cloud agents: each member's agent name and configuration, and a credits balance.
-- Run once in the Supabase SQL editor. Safe to run again. Only the server (service key) can write these tables.

-- ---------- profile: the agent's name (chosen or random), configuration, the two picked agents, subagents on/off ----------
create table if not exists public.pholama_agent_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  agent_name text check (agent_name is null or char_length(agent_name) between 2 and 24),
  config text not null default 'one' check (config in ('one','two')),
  picked text[] not null default '{chat}' check (cardinality(picked) between 1 and 2),
  subagents boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.pholama_agent_profile enable row level security;
drop policy if exists "agent profile read own" on public.pholama_agent_profile;
create policy "agent profile read own" on public.pholama_agent_profile for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pholama_agent_profile from anon, authenticated;

-- ---------- credits: one balance per member, spent atomically so two requests cannot both spend the last credits ----------
create table if not exists public.pholama_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 60 check (balance >= 0),
  refill_on date not null default ((date_trunc('month', now() at time zone 'utc') + interval '1 month')::date),
  updated_at timestamptz not null default now()
);
alter table public.pholama_credits enable row level security;
drop policy if exists "credits read own" on public.pholama_credits;
create policy "credits read own" on public.pholama_credits for select using (auth.uid() = user_id);
revoke insert, update, delete on public.pholama_credits from anon, authenticated;

-- Spend n credits. Refills at the start of a new month. Returns {ok, balance, refill_on}. Never goes below zero.
create or replace function public.pholama_credits_spend(p_user uuid, p_cost integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c int := greatest(0, least(coalesce(p_cost, 0), 200)); r public.pholama_credits; monthly int := 60;
begin
  insert into public.pholama_credits(user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.pholama_credits where user_id = p_user for update;
  if r.refill_on <= (now() at time zone 'utc')::date then
    update public.pholama_credits set balance = monthly, refill_on = ((date_trunc('month', now() at time zone 'utc') + interval '1 month')::date), updated_at = now() where user_id = p_user returning * into r;
  end if;
  if r.balance < c then return jsonb_build_object('ok', false, 'balance', r.balance, 'refill_on', r.refill_on); end if;
  update public.pholama_credits set balance = balance - c, updated_at = now() where user_id = p_user returning * into r;
  return jsonb_build_object('ok', true, 'balance', r.balance, 'refill_on', r.refill_on);
end $$;
revoke all on function public.pholama_credits_spend(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_credits_spend(uuid, integer) to service_role;

-- Give credits back when a call fails after being charged.
create or replace function public.pholama_credits_refund(p_user uuid, p_amount integer) returns void
language sql security definer set search_path = public as $$
  update public.pholama_credits set balance = least(500, balance + greatest(0, least(coalesce(p_amount, 0), 200))), updated_at = now() where user_id = p_user
$$;
revoke all on function public.pholama_credits_refund(uuid, integer) from public, anon, authenticated;
grant execute on function public.pholama_credits_refund(uuid, integer) to service_role;
