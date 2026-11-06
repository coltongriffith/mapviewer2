-- ============================================================
-- One plan answer everywhere (docs/state-machines.md, BILL-4 and BILL-5).
--
-- BILL-5: plan = 'company' on an unprotected source (signup or stripe) was
-- Company for tenures, shares and the UI, but Free for cloud maps, brand kits
-- and live maps, because those checks only recognised plan = 'pro' or a
-- protected source. Those users saw "unlimited" and then hit PROJECT_LIMIT,
-- BRAND_KIT_LIMIT or LIVE_MAP_PLAN.
--
-- BILL-4: limits were only evaluated when a row was created, so after a
-- downgrade the alert scheduler kept sending everything stored (50 tenures,
-- several portfolios and recipients, the Pro-only reminders). The scheduler
-- runs as the service role, where auth.uid() is null, so it needs the limits
-- for a given user: tenure_plan_limits_for(user). tenure_plan_limits() keeps
-- its signature and answers for the caller.
--
-- Rollback: re-apply 20261028120000_company_tenure_entitlement.sql (limits),
-- 20261023100000_workspaces_properties.sql (ws_personal_map_limit) and
-- 20260728000003_brand_kit_quota.sql (check_brand_kit_quota); then
--   drop function if exists public.tenure_plan_limits_for(uuid);
-- ============================================================

create or replace function public.tenure_plan_limits_for(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_source text;
  v_effective text;
begin
  if p_user is null then
    return jsonb_build_object(
      'plan', 'anonymous',
      'max_monitored_tenures', 0,
      'max_portfolios', 0,
      'max_alert_recipients', 0,
      'alert_offsets', jsonb_build_array()
    );
  end if;

  select plan, source into v_plan, v_source
  from public.user_plans where user_id = p_user;

  -- Fail closed on an unresolved plan: a missing row is a free account.
  if v_plan = 'company' then
    v_effective := 'company';
  elsif coalesce(v_source, '') in ('grandfathered', 'admin') then
    v_effective := 'pro';
  else
    v_effective := coalesce(v_plan, 'free');
  end if;

  if v_effective = 'company' then
    return jsonb_build_object(
      'plan', 'company',
      'max_monitored_tenures', 500,
      'max_portfolios', null,
      'max_alert_recipients', 10,
      'alert_offsets', jsonb_build_array(180, 120, 90, 60, 30, 14, 7, 3, 1)
    );
  elsif v_effective = 'pro' then
    return jsonb_build_object(
      'plan', 'pro',
      'max_monitored_tenures', 50,
      'max_portfolios', null,
      'max_alert_recipients', 2,
      'alert_offsets', jsonb_build_array(90, 30, 7, 1)
    );
  end if;

  return jsonb_build_object(
    'plan', 'free',
    'max_monitored_tenures', 10,
    'max_portfolios', 1,
    'max_alert_recipients', 1,
    'alert_offsets', jsonb_build_array(90, 30, 1)
  );
end;
$$;

revoke all on function public.tenure_plan_limits_for(uuid) from public, anon, authenticated;
grant execute on function public.tenure_plan_limits_for(uuid) to service_role;

create or replace function public.tenure_plan_limits()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select public.tenure_plan_limits_for(auth.uid()) $$;

revoke all on function public.tenure_plan_limits() from public;
grant execute on function public.tenure_plan_limits() to authenticated, service_role;

-- Personal cloud-map limit: Pro, Company and protected sources are unlimited.
create or replace function public.ws_personal_map_limit(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select case when coalesce(max(up.plan), 'free') in ('pro', 'company')
                or coalesce(max(up.source), '') in ('grandfathered', 'admin')
              then null else 2 end
  from public.user_plans up where up.user_id = p_user
$$;
revoke all on function public.ws_personal_map_limit(uuid) from public, anon, authenticated;

-- Brand kits: the same rule.
create or replace function public.check_brand_kit_quota()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_source text;
begin
  select plan, source into v_plan, v_source
  from public.user_plans where user_id = new.user_id;

  if coalesce(v_plan, 'free') in ('pro', 'company') or coalesce(v_source, '') in ('grandfathered', 'admin') then
    return new;
  end if;

  raise exception 'BRAND_KIT_LIMIT: saving reusable brand kits requires Pro'
    using errcode = 'P0001';
end;
$$;
revoke all on function public.check_brand_kit_quota() from public, anon, authenticated;
