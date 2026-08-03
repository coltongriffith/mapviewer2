-- ============================================================
-- TENURE MONITOR — two ways the quota was still only mostly enforced.
--
-- ── 1. A lock that locks nothing ───────────────────────────────────────────
--
-- add_portfolio_tenures and create_monitored_portfolio each take a row lock
-- before counting, so that two tabs at the limit serialize instead of both
-- seeing room. That works for every user who already has rows. It does exactly
-- nothing for the user who has none: `for update` over an empty result set
-- locks no rows, acquires nothing, and blocks nobody.
--
-- So the first-ever add is the one case the lock does not cover — two
-- concurrent requests both count zero and both insert a full plan allowance.
-- The same hole sits in front of the first-ever portfolio.
--
-- A transaction-scoped advisory lock keyed on the user fixes both, because it
-- does not depend on a row existing to have something to lock. The key is
-- namespaced by a string prefix so it cannot collide with any other advisory
-- lock this database might grow later.
--
-- ── 2. Reminder tiers were enforced only at creation ───────────────────────
--
-- create_monitored_portfolio intersects the requested offsets with what the
-- plan allows. Nothing re-checked them afterwards, and part 2 grants
-- authenticated an unrestricted UPDATE on its own policy row — which the
-- settings screen uses. A free account could therefore set expiry_offsets to
-- [180, 7, 1] with one supabase-js call, and the scheduler would read those
-- back and act on them, because the scheduler trusts the stored policy.
--
-- That is the same shape of mistake as the recipient limit (20260801000003):
-- a limit evaluated once, on one path, in a product whose own migration header
-- says a limit that lives outside the database is a suggestion.
--
-- The trigger intersects rather than rejects, matching what creation already
-- does. Asking for a 7-day reminder on the free plan gets you 90/30 and an
-- upgrade prompt in the UI, not an error dialog — the user's other settings on
-- that form still save.
--
-- Depends on: 20260801000002, 20260801000003, 20260801000007.
--
-- Rollback:
--   drop trigger if exists tenure_policy_offsets_guard on public.tenure_alert_policies;
--   drop function if exists public.tenure_policy_offsets_guard();
--   -- and re-apply add_portfolio_tenures / create_monitored_portfolio from
--   -- 20260801000007 and 20260801000003 respectively.
-- ============================================================

-- ── Allowed-offset intersection, on every write ────────────────────────────
create or replace function public.tenure_policy_offsets_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed jsonb;
  v_offsets integer[];
begin
  -- Service-role callers (the alert engine, migrations, the importer) are not
  -- subject to a customer plan limit, and auth.uid() is null for them.
  if auth.uid() is null then
    return new;
  end if;

  -- Nothing to police if the offsets did not move.
  if tg_op = 'UPDATE' and new.expiry_offsets is not distinct from old.expiry_offsets then
    return new;
  end if;

  v_allowed := public.tenure_plan_limits()->'alert_offsets';

  select array_agg(distinct o order by o desc) into v_offsets
  from unnest(coalesce(new.expiry_offsets, array[]::integer[])) as o
  where o::text in (select value from jsonb_array_elements_text(v_allowed) as value);

  -- An empty intersection means every requested offset was above the plan.
  -- Fall back to the full allowed ladder rather than leaving a policy with no
  -- reminders at all — silence is the worst outcome this feature can produce.
  if v_offsets is null or array_length(v_offsets, 1) is null then
    select array_agg(value::int order by value::int desc) into v_offsets
    from jsonb_array_elements_text(v_allowed) as value;
  end if;

  new.expiry_offsets := coalesce(v_offsets, array[90, 30]);
  return new;
end;
$$;

revoke execute on function public.tenure_policy_offsets_guard() from public, anon, authenticated;

drop trigger if exists tenure_policy_offsets_guard on public.tenure_alert_policies;
create trigger tenure_policy_offsets_guard
  before insert or update on public.tenure_alert_policies
  for each row execute function public.tenure_policy_offsets_guard();

-- ── Serialize the quota check on something that always exists ──────────────

create or replace function public.create_monitored_portfolio(
  p_name text,
  p_offsets integer[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_limits jsonb;
  v_max_portfolios int;
  v_count int;
  v_allowed jsonb;
  v_offsets integer[];
  v_policy uuid;
  v_portfolio uuid;
  v_email text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 120 then
    raise exception 'invalid portfolio name' using errcode = '22023';
  end if;

  -- Held until this transaction ends. Unlike `for update` on the user's
  -- portfolio rows, this still serializes when there are no rows yet — which
  -- is precisely the case the portfolio limit has to survive.
  perform pg_advisory_xact_lock(hashtextextended('tenure_quota:' || v_user::text, 0));

  v_limits := public.tenure_plan_limits();
  v_max_portfolios := nullif(v_limits->>'max_portfolios', '')::int;

  if v_max_portfolios is not null then
    select count(*) into v_count from public.monitored_portfolios where user_id = v_user;
    if v_count >= v_max_portfolios then
      raise exception 'PORTFOLIO_LIMIT: this plan allows % portfolio(s)', v_max_portfolios
        using errcode = 'P0001';
    end if;
  end if;

  -- Requested offsets are intersected with what the plan permits, rather than
  -- rejected. tenure_policy_offsets_guard now enforces the same rule on every
  -- later write; this stays so the seeded policy is right the first time.
  v_allowed := v_limits->'alert_offsets';
  if p_offsets is null then
    select array_agg(value::int order by value::int desc)
      into v_offsets from jsonb_array_elements_text(v_allowed) as value;
  else
    select array_agg(distinct o order by o desc) into v_offsets
    from unnest(p_offsets) as o
    where o::text in (select value from jsonb_array_elements_text(v_allowed) as value);
    if v_offsets is null or array_length(v_offsets, 1) is null then
      select array_agg(value::int order by value::int desc)
        into v_offsets from jsonb_array_elements_text(v_allowed) as value;
    end if;
  end if;

  insert into public.tenure_alert_policies (user_id, name, expiry_offsets)
  values (v_user, 'Default alert policy', coalesce(v_offsets, array[90, 30]))
  returning id into v_policy;

  insert into public.monitored_portfolios (user_id, name, alert_policy_id)
  values (v_user, btrim(p_name), v_policy)
  returning id into v_portfolio;

  select email into v_email from auth.users where id = v_user;
  if v_email is not null then
    insert into public.tenure_alert_recipients (policy_id, user_id, email, role, receives_failure_alerts)
    values (v_policy, v_user, v_email, 'owner', true)
    on conflict (policy_id, email) do nothing;
  end if;

  insert into public.tenure_audit_log (user_id, portfolio_id, entity, entity_id, action, new_value)
  values (v_user, v_portfolio, 'portfolio', v_portfolio, 'portfolio_created', btrim(p_name));

  return v_portfolio;
end;
$$;

revoke all on function public.create_monitored_portfolio(text, integer[]) from public;
revoke execute on function public.create_monitored_portfolio(text, integer[]) from anon;
grant execute on function public.create_monitored_portfolio(text, integer[]) to authenticated;

create or replace function public.add_portfolio_tenures(
  p_portfolio_id uuid,
  p_tenure_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_limits jsonb;
  v_max int;
  v_current int;
  v_room int;
  v_added int := 0;
  v_already int := 0;
  v_unknown int := 0;
  v_requested int;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.owns_portfolio(p_portfolio_id) then
    raise exception 'portfolio not found' using errcode = '42501';
  end if;
  if p_tenure_ids is null or array_length(p_tenure_ids, 1) is null then
    return jsonb_build_object(
      'added', 0, 'already_present', 0, 'skipped_over_limit', 0, 'skipped_unknown', 0);
  end if;

  v_requested := array_length(p_tenure_ids, 1);
  -- Bound the batch so one request cannot be used to hammer the quota check.
  if v_requested > 1000 then
    raise exception 'too many tenures in one request' using errcode = '22023';
  end if;

  -- Same key as create_monitored_portfolio, so a create and an add for one
  -- user also serialize against each other. `for update` on the user's
  -- memberships used to stand here and silently did nothing on the first add,
  -- which is the one add most likely to arrive twice at once.
  perform pg_advisory_xact_lock(hashtextextended('tenure_quota:' || v_user::text, 0));

  v_limits := public.tenure_plan_limits();
  v_max := nullif(v_limits->>'max_monitored_tenures', '')::int;

  select count(*) into v_current
  from public.monitored_portfolio_tenures mpt
  join public.monitored_portfolios p on p.id = mpt.portfolio_id
  where p.user_id = v_user and mpt.removed_at is null;

  if v_max is null then
    v_room := v_requested;
  else
    v_room := greatest(v_max - v_current, 0);
  end if;

  -- Re-adding a previously removed title revives that membership instead of
  -- creating a second row, so its notes and decision history survive.
  for v_id in
    select unnest(p_tenure_ids)
  loop
    if exists (
      select 1 from public.monitored_portfolio_tenures
      where portfolio_id = p_portfolio_id and tenure_id = v_id and removed_at is null
    ) then
      v_already := v_already + 1;
      continue;
    end if;

    exit when v_room <= 0;

    -- Only real tenures. A client passing an unknown uuid gets it dropped
    -- rather than creating a dangling membership — and counted as unknown, not
    -- as a plan limit it never hit.
    if not exists (select 1 from public.tenures where id = v_id) then
      v_unknown := v_unknown + 1;
      continue;
    end if;

    update public.monitored_portfolio_tenures
       set removed_at = null, updated_at = now(), monitoring_enabled = true
     where portfolio_id = p_portfolio_id and tenure_id = v_id and removed_at is not null;

    if not found then
      insert into public.monitored_portfolio_tenures (portfolio_id, tenure_id, added_by_user_id)
      values (p_portfolio_id, v_id, v_user);
    end if;

    v_added := v_added + 1;
    v_room := v_room - 1;
  end loop;

  if v_added > 0 then
    insert into public.tenure_audit_log (user_id, portfolio_id, entity, entity_id, action, new_value)
    values (v_user, p_portfolio_id, 'portfolio_tenure', p_portfolio_id, 'tenures_added', v_added::text);
  end if;

  return jsonb_build_object(
    'added', v_added,
    'already_present', v_already,
    'skipped_unknown', v_unknown,
    'skipped_over_limit', greatest(v_requested - v_added - v_already - v_unknown, 0),
    'max_monitored_tenures', v_max,
    'current_total', v_current + v_added
  );
end;
$$;

revoke all on function public.add_portfolio_tenures(uuid, uuid[]) from public;
revoke execute on function public.add_portfolio_tenures(uuid, uuid[]) from anon;
grant execute on function public.add_portfolio_tenures(uuid, uuid[]) to authenticated;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   -- as a free user, try to buy the paid reminder ladder directly:
--   update public.tenure_alert_policies set expiry_offsets = array[180, 7, 1]
--     where user_id = auth.uid();
--   select expiry_offsets from public.tenure_alert_policies where user_id = auth.uid();
--   -- expect {90,30} — the intersection, not what was asked for.
--
--   -- the lock is held on a user with no rows at all: open two sessions, run
--   -- `begin; select public.create_monitored_portfolio('a');` in each without
--   -- committing. The second must block until the first commits, then raise
--   -- PORTFOLIO_LIMIT rather than succeed.
