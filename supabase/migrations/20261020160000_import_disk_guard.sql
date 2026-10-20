-- ============================================================
-- Keep the scheduled registry imports from filling the database disk.
--
-- WHAT HAPPENED (2026-10-20)
--   GitHub delivered the Quebec refresh (scripts/update-qc-claims.js) and the
--   B.C. full tenure sync (scripts/tenure-sync/) late and in the same second.
--   Quebec staged a full jsonb copy of qc_claims and started publishing a new
--   one while B.C. rewrote every tenure row. The disk filled at 15:38 UTC, the
--   database crash-looped, and the aborted runs left their staging behind.
--
-- WHAT THIS ADDS
--   1. public.import_headroom() — one read the importers make before they
--      write, and again before their largest write. It reports the database
--      size, the size of the tables each import rewrites, and whether the
--      OTHER import is mid-run. The decision is made in
--      scripts/lib/importHeadroom.mjs, where it is unit-tested.
--      SECURITY DEFINER only so the answer does not depend on which grants
--      service_role happens to hold on the tables it summarises; it takes no
--      input and returns sizes and timestamps, never rows.
--
--   2. public.qc_discard_import_batches() — empties Quebec staging without
--      being able to hang. TRUNCATE needs an ACCESS EXCLUSIVE lock and waits
--      behind anything holding the table, however briefly; on 2026-10-20 a
--      TRUNCATE of tenure staging sat for over a minute with no visible
--      blocker while a plain DELETE went straight through. So: TRUNCATE with a
--      5s lock_timeout (frees the disk at once), and DELETE if the lock is not
--      granted (frees it at the next vacuum). Staging is ~254 rows of ~1000
--      titles each, so the DELETE is small however large the payload.
--
--   3. begin_qc_import / abort_qc_import call (2) instead of a bare TRUNCATE.
--      Bodies otherwise identical to 20260915160235. publish_qc_import is left
--      alone: its TRUNCATE is part of the atomic swap and already carries
--      lock_timeout = 5s.
--
-- Rollback:
--   drop function if exists public.import_headroom();
--   re-run the begin_qc_import / abort_qc_import definitions from
--   20260915160235_repair_qc_atomic_import.sql, then
--   drop function if exists public.qc_discard_import_batches();
-- ============================================================

create or replace function public.import_headroom()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'checked_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'qc_claims_bytes', coalesce(pg_total_relation_size(to_regclass('public.qc_claims')), 0),
    'tenure_bytes', coalesce(pg_total_relation_size(to_regclass('public.tenures')), 0)
                  + coalesce(pg_total_relation_size(to_regclass('public.tenure_owners')), 0),
    -- Set by begin_qc_import, cleared by publish/abort.
    'qc_import_started_at', (select started_at from public.qc_import_state
                             where singleton and run_id is not null),
    -- Full runs only: a targeted refresh writes a few dozen rows. A job killed
    -- mid-run leaves its row 'running' for ever, so the importer bounds this
    -- by age rather than trusting the status alone.
    'tenure_full_run_started_at', (select max(started_at) from public.tenure_import_runs
                                   where status = 'running' and mode = 'full')
  );
$$;

create or replace function public.qc_discard_import_batches()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
begin
  truncate public.qc_import_batches;
exception when lock_not_available then
  delete from public.qc_import_batches;
end $$;

create or replace function public.begin_qc_import(p_expected_rows integer) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.qc_import_state; v_run uuid := gen_random_uuid();
begin
  select * into s from public.qc_import_state where singleton for update;
  if p_expected_rows not between 100000 and 400000 then raise exception 'Unexpected active-title count'; end if;
  if s.run_id is not null and s.started_at > now()-interval '2 hours' then raise exception 'Quebec import already running'; end if;
  if s.baseline_rows is not null and (p_expected_rows < s.baseline_rows*0.8 or p_expected_rows > s.baseline_rows*1.2) then raise exception 'Active-title count changed by more than 20 percent'; end if;
  perform public.qc_discard_import_batches();
  update public.qc_import_state set run_id=v_run,expected_rows=p_expected_rows,started_at=now() where singleton;
  return v_run;
end $$;

create or replace function public.abort_qc_import(p_run_id uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.qc_import_state;
begin
  select * into s from public.qc_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then return false; end if;
  perform public.qc_discard_import_batches();
  update public.qc_import_state set run_id=null,expected_rows=null,started_at=null where singleton;
  return true;
end $$;

-- This project's default privileges grant EXECUTE on new functions to anon and
-- authenticated (see 20260806000001), so take that back explicitly.
revoke all on function public.import_headroom(), public.qc_discard_import_batches()
  from public, anon, authenticated;
grant execute on function public.import_headroom(), public.qc_discard_import_batches()
  to service_role;

notify pgrst, 'reload schema';

-- ── Post-migration verification (run manually) ─────────────────────────────
--   set role service_role; select public.import_headroom(); reset role;
--   select p.proname, p.proacl from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('import_headroom', 'qc_discard_import_batches',
--                       'begin_qc_import', 'abort_qc_import');
--   -- expect service_role (plus the owner) only. No anon=X, no authenticated=X.
