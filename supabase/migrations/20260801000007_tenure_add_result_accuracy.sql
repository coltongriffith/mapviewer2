-- ============================================================
-- TENURE MONITOR — stop reporting an unknown tenure id as a plan limit.
--
-- WHY THIS EXISTS
--   add_portfolio_tenures (20260801000003) derives its skipped count by
--   subtraction: requested − added − already_present. Anything the loop passed
--   over for any reason therefore lands in `skipped_over_limit`, including the
--   ids it dropped because no such tenure exists.
--
--   The consequence is not a data problem, it is a truthfulness problem. The
--   caller in TenureMonitorPage renders that number as "N could not be added —
--   your plan monitors M claims", offers an upgrade, and fires a
--   tenure_upgrade_viewed analytics event. A user who hit no limit at all is
--   told they hit one and shown a paywall for it. In a product whose entire
--   premise is not misleading people about their titles, an upgrade prompt
--   raised on a false pretext is the wrong kind of mistake to leave in.
--
--   The two outcomes are now counted separately and the UI states each.
--   `skipped_over_limit` keeps its meaning, so an existing caller reading only
--   that field gets a smaller, correct number rather than a changed contract.
--
-- Depends on: 20260801000003.
--
-- Rollback: re-apply the definition from 20260801000003.
-- ============================================================

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

  v_limits := public.tenure_plan_limits();
  v_max := nullif(v_limits->>'max_monitored_tenures', '')::int;

  -- Lock the user's live memberships so two tabs cannot both see room for one.
  perform 1
  from public.monitored_portfolio_tenures mpt
  join public.monitored_portfolios p on p.id = mpt.portfolio_id
  where p.user_id = v_user and mpt.removed_at is null
  for update of mpt;

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
--   -- two ids that do not exist, against a portfolio with room:
--   select public.add_portfolio_tenures('<portfolio id>',
--            array[gen_random_uuid(), gen_random_uuid()]);
--   -- expect skipped_unknown: 2, skipped_over_limit: 0
