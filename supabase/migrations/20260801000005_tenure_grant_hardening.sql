-- ============================================================
-- TENURE MONITOR — close the anon EXECUTE gap left by default privileges.
--
-- WHY THIS EXISTS
--   Migrations 3 and 4 each wrote `revoke all on function ... from public`
--   followed by `grant execute ... to authenticated`, and that reads like it
--   restricts the function to signed-in callers. It does not.
--
--   This Supabase project carries a bootstrap default-privilege grant
--   (`alter default privileges in schema public grant execute on functions to
--   anon, authenticated, service_role`), so every function is created with an
--   EXPLICIT anon grant already in its ACL. Revoking from PUBLIC removes the
--   pseudo-role entry and leaves `anon=X` untouched — which is why the Supabase
--   security advisor reports every one of these as anon-executable.
--
--   Nothing leaked: each function gates on is_admin(), owns_portfolio() or a
--   null auth.uid() before it touches a row, so an anonymous call gets an
--   exception rather than data. This migration makes the ACL say what the
--   previous two migrations meant, so the gate is not the only thing standing
--   between an anonymous caller and a customer's portfolio.
--
--   Deliberately still anon-callable, because they serve signed-out views of
--   public government data:
--     tenure_boundaries_changed_since  — the stale-outline warning on a shared map
--     tenure_last_sync                 — dataset freshness
--     tenures_in_bbox                  — public tenure geometry, same posture as qc_claims
--
--   Also here: tenure_geom_from_geojson gets a pinned search_path. It is not
--   SECURITY DEFINER, but it is the expression behind a generated column and it
--   resolves PostGIS functions by name, so leaving the path mutable leaves that
--   resolution up to whoever calls it.
--
-- Depends on: 20260801000001, 20260801000003, 20260801000004.
--
-- Rollback: re-grant execute to anon on the functions below. There is no reason
-- to; the grant was never intended.
-- ============================================================

-- ── Portfolio and alert operations: signed-in callers only ─────────────────
revoke execute on function public.create_monitored_portfolio(text, integer[]) from anon;
revoke execute on function public.add_portfolio_tenures(uuid, uuid[]) from anon;
revoke execute on function public.remove_portfolio_tenure(uuid, uuid) from anon;
revoke execute on function public.acknowledge_tenure_alert(uuid) from anon;
revoke execute on function public.tenure_portfolio_summary(uuid) from anon;
revoke execute on function public.tenure_change_history(uuid, integer) from anon;
revoke execute on function public.tenure_portfolio_changes(uuid, integer, integer) from anon;
revoke execute on function public.tenure_plan_limits() from anon;
revoke execute on function public.owns_portfolio(uuid) from anon;

-- ── Admin operations: signed-in callers only, still gated on is_admin() ────
revoke execute on function public.admin_get_tenure_ops() from anon;
revoke execute on function public.admin_set_tenure_alert_pause(uuid, boolean, text) from anon;
revoke execute on function public.admin_set_tenure_notice(text, text, boolean) from anon;
revoke execute on function public.admin_retry_tenure_alert(uuid) from anon;

-- ── Importer internals: service role only ──────────────────────────────────
-- tenure_reconcile_run rewrites missing_run_count across the whole province.
-- It has no business being reachable from a browser session at all.
revoke execute on function public.tenure_reconcile_run(uuid, timestamptz, text, text)
  from anon, authenticated;

-- ── Trigger functions: not an API ──────────────────────────────────────────
-- These return `trigger`, so a PostgREST call cannot do anything useful, but a
-- function that only ever runs from a trigger should not carry a client grant.
revoke execute on function public.tenure_recipient_guard() from public, anon, authenticated;
revoke execute on function public.tenure_membership_audit() from public, anon, authenticated;

-- ── Pin the geometry helper's search_path ──────────────────────────────────
alter function public.tenure_geom_from_geojson(jsonb) set search_path = public, pg_temp;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   -- no tenure function should list anon except the three named above:
--   select p.proname, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'tenure%'
--     and array_to_string(p.proacl::text[], ',') like '%anon=X%';
--   -- the generated column still resolves:
--   select public.tenure_geom_from_geojson('{"type":"Point","coordinates":[-123,49]}'::jsonb) is not null;
