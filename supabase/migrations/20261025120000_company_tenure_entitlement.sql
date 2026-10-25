-- Enable explicit Company assignments without changing anyone else's
-- grandfathered/admin Pro entitlement. Company remains an internal tier.
-- This function is the server-enforced quota source used by tenure RPCs.
create or replace function public.tenure_plan_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_source text;
  v_effective text;
begin
  if v_user is null then
    -- Anonymous callers get the free shape so the UI can render limits on a
    -- signed-out landing view without inventing numbers.
    return jsonb_build_object(
      'plan', 'anonymous',
      'max_monitored_tenures', 0,
      'max_portfolios', 0,
      'max_alert_recipients', 0,
      'alert_offsets', jsonb_build_array()
    );
  end if;

  select plan, source into v_plan, v_source
  from public.user_plans where user_id = v_user;

  -- Fail CLOSED on an unresolved plan: a missing row is a free account, not a
  -- free upgrade. (useAuth applies a bounded grace window client-side for a
  -- CONFIRMED Pro user during an outage; that is a UI affordance, and it
  -- deliberately does not extend to server-enforced quota.)
  if v_plan = 'company' then
    -- Explicitly assigned internal Company tier overrides grandfathered Pro.
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
      'alert_offsets', jsonb_build_array(90, 30, 7)
    );
  end if;

  return jsonb_build_object(
    'plan', 'free',
    'max_monitored_tenures', 10,
    'max_portfolios', 1,
    'max_alert_recipients', 1,
    'alert_offsets', jsonb_build_array(90, 30)
  );
end;
$$;


revoke all on function public.tenure_plan_limits() from public;
grant execute on function public.tenure_plan_limits() to authenticated, service_role;
