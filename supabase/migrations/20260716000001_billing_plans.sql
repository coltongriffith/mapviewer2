-- ============================================================
-- Billing plans (Stripe) — user_plans table, grandfathering, RLS.
-- Additive & idempotent. Apply after 20260710000005 (admin_users).
--
-- Every account that exists WHEN THIS MIGRATION RUNS is seeded as
-- plan='pro', source='grandfathered' — full Pro access, free forever,
-- never downgraded by any webhook or job. Accounts created afterwards
-- get a 'free' row via the signup trigger and upgrade through Stripe.
--
-- Rollback:
--   drop trigger if exists on_auth_user_created_plan on auth.users;
--   drop function if exists public.handle_new_user_plan();
--   drop function if exists public.get_my_plan();
--   drop table if exists public.user_plans;
-- ============================================================

-- 1. Plan table — one row per user. Stripe columns are nullable (only set
--    once the user actually goes through Checkout).
create table if not exists public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  -- Subscription lifecycle from Stripe. 'active' for grandfathered rows.
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  -- Where the plan came from. 'grandfathered' rows are NEVER downgraded.
  source text not null default 'signup'
    check (source in ('signup', 'grandfathered', 'stripe', 'admin')),
  stripe_customer_id text unique,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;
revoke all on table public.user_plans from anon, authenticated;

-- Users may read their OWN plan row (client shows plan state / gates UI);
-- all writes go through the service role (Stripe webhook + endpoints).
drop policy if exists user_plans_select_own on public.user_plans;
create policy user_plans_select_own on public.user_plans
  for select to authenticated using (auth.uid() = user_id);
grant select on table public.user_plans to authenticated;

create index if not exists user_plans_stripe_customer_idx
  on public.user_plans (stripe_customer_id);

-- 2. GRANDFATHER every existing account: full Pro, free, forever. If a row
--    somehow exists already, upgrade it (never the other way around).
insert into public.user_plans (user_id, plan, status, source)
select id, 'pro', 'active', 'grandfathered' from auth.users
on conflict (user_id) do update
  set plan = 'pro', status = 'active', source = 'grandfathered', updated_at = now()
  where public.user_plans.plan <> 'pro';

-- 3. New signups get a free-plan row automatically.
create or replace function public.handle_new_user_plan()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.user_plans (user_id, plan, status, source)
  values (new.id, 'free', 'active', 'signup')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_plan on auth.users;
create trigger on_auth_user_created_plan
  after insert on auth.users
  for each row execute function public.handle_new_user_plan();

-- 4. Convenience RPC — the client's plan lookup (RLS-safe; returns at most
--    the caller's own row even without the policy, but the policy + grant
--    above already allow a direct select; this exists for callers that
--    prefer an RPC shape).
create or replace function public.get_my_plan()
returns table (plan text, status text, source text, current_period_end timestamptz)
language sql security definer set search_path = public, pg_temp stable
as $$
  select plan, status, source, current_period_end
  from public.user_plans where user_id = auth.uid();
$$;

revoke all on function public.get_my_plan() from public;
grant execute on function public.get_my_plan() to authenticated;

-- Post-migration verification (run manually):
--   select count(*) from public.user_plans where source = 'grandfathered';
--     -- should equal select count(*) from auth.users (at migration time)
--   select plan, status, source from public.user_plans limit 5;
--   -- as an authenticated user: select * from public.user_plans;
--     -- returns ONLY the caller's own row
