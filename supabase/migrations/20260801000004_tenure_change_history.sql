-- ============================================================
-- TENURE MONITOR — change history, and the stale-boundary check.
--
-- tenure_change_events and tenure_snapshots deliberately carry NO client
-- grants (migration 20260801000001): they are operational history, and
-- exposing the table directly would let anyone enumerate every change to every
-- title in the province in one request. But a customer plainly needs to see
-- what changed on the claims THEY monitor, so the access is through definer
-- functions scoped to that.
--
-- The scoping is on membership, not on the tenure. Someone who monitors tenure
-- 1044501 may read its change history; nobody may read the history of a title
-- they have never added.
--
-- Also here: the check that lets a saved project map notice its claim outlines
-- are older than the current tenure dataset. Presenting last quarter's
-- boundaries as today's in an investor deck is exactly the kind of quiet error
-- this product exists to prevent.
--
-- Depends on: 20260801000001, 20260801000002.
--
-- Rollback:
--   drop function if exists public.tenure_boundaries_changed_since(text[], timestamptz);
--   drop function if exists public.tenure_portfolio_changes(uuid, integer, integer);
--   drop function if exists public.tenure_change_history(uuid, integer);
-- ============================================================

-- ── One title's history ────────────────────────────────────────────────────
create or replace function public.tenure_change_history(
  p_tenure_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  tenure_id uuid,
  event_type text,
  previous_value text,
  current_value text,
  severity text,
  detected_at timestamptz,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Membership is the gate. Same answer for "no such tenure" and "you do not
  -- monitor it", so this cannot be used to probe which titles exist.
  if not exists (
    select 1
    from public.monitored_portfolio_tenures mpt
    join public.monitored_portfolios p on p.id = mpt.portfolio_id
    where mpt.tenure_id = p_tenure_id
      and mpt.removed_at is null
      and p.user_id = auth.uid()
  ) then
    raise exception 'tenure not found' using errcode = '42501';
  end if;

  return query
  select ce.id, ce.tenure_id, ce.event_type, ce.previous_value, ce.current_value,
         ce.severity, ce.detected_at, ce.metadata
  from public.tenure_change_events ce
  where ce.tenure_id = p_tenure_id
  order by ce.detected_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

revoke all on function public.tenure_change_history(uuid, integer) from public;
grant execute on function public.tenure_change_history(uuid, integer) to authenticated;

-- ── A portfolio's change feed ──────────────────────────────────────────────
-- Powers the "changed recently" count, the table's last-change column, and the
-- map's change colouring, in one round trip.
create or replace function public.tenure_portfolio_changes(
  p_portfolio_id uuid,
  p_days integer default 90,
  p_limit integer default 100
)
returns table (
  id uuid,
  tenure_id uuid,
  tenure_number text,
  tenure_name text,
  event_type text,
  previous_value text,
  current_value text,
  severity text,
  detected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.owns_portfolio(p_portfolio_id) then
    raise exception 'portfolio not found' using errcode = '42501';
  end if;

  return query
  select ce.id, ce.tenure_id, t.tenure_number, t.tenure_name, ce.event_type,
         ce.previous_value, ce.current_value, ce.severity, ce.detected_at
  from public.tenure_change_events ce
  join public.tenures t on t.id = ce.tenure_id
  join public.monitored_portfolio_tenures mpt
    on mpt.tenure_id = ce.tenure_id and mpt.portfolio_id = p_portfolio_id
  where mpt.removed_at is null
    and ce.detected_at > now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 3650))
  order by ce.detected_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.tenure_portfolio_changes(uuid, integer, integer) from public;
grant execute on function public.tenure_portfolio_changes(uuid, integer, integer) to authenticated;

-- ── Stale-boundary check for saved project maps ────────────────────────────
--
-- A map saved in March carries the claim outlines that were current in March.
-- When the province redraws a boundary, that saved map quietly becomes wrong —
-- and it is exactly the artefact that ends up in an investor deck or a
-- technical report, long after anybody remembers when it was made.
--
-- Given the tenure numbers a project's claim layer was built from and the
-- moment it was built, this returns the ones whose boundary or area has moved
-- since. Public, because the layer it protects is drawn from public data and a
-- signed-out visitor viewing a shared map deserves the same warning.
create or replace function public.tenure_boundaries_changed_since(
  p_tenure_numbers text[],
  p_since timestamptz
)
returns table (
  tenure_number text,
  event_type text,
  detected_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.tenure_number, ce.event_type, ce.detected_at
  from public.tenure_change_events ce
  join public.tenures t on t.id = ce.tenure_id
  where t.tenure_number = any(p_tenure_numbers)
    and ce.detected_at > p_since
    and ce.event_type in ('GEOMETRY_CHANGED', 'AREA_CHANGED', 'TENURE_TERMINATED')
  order by ce.detected_at desc
  limit 200;
$$;

revoke all on function public.tenure_boundaries_changed_since(text[], timestamptz) from public;
grant execute on function public.tenure_boundaries_changed_since(text[], timestamptz)
  to anon, authenticated, service_role;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   -- as a user who monitors nothing:
--   select public.tenure_change_history('<any tenure id>');   -- expect not found
--   -- as the owner of a portfolio containing it:
--   select * from public.tenure_portfolio_changes('<portfolio id>');
--   -- as another user, against someone else's portfolio:
--   select * from public.tenure_portfolio_changes('<their portfolio id>'); -- expect not found
--   -- boundary drift is public:
--   select * from public.tenure_boundaries_changed_since(array['1044501'], now() - interval '90 days');
