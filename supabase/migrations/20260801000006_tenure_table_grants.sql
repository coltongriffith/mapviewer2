-- ============================================================
-- TENURE MONITOR — reduce the public mirror tables to SELECT.
--
-- WHY THIS EXISTS
--   Migration 20260801000001 granted SELECT on `tenures` and `tenure_owners`
--   to anon and authenticated, which is the intended posture: this is public
--   government data, the same footing as qc_claims. What it did not do is
--   revoke anything first, and this project's bootstrap default privileges
--   (`alter default privileges in schema public grant all on tables to anon,
--   authenticated, service_role`) had already granted ALL at CREATE TABLE
--   time. The `grant select` was therefore a no-op on top of a full grant.
--
--   qc_claims does not have this problem — supabase-fix-rls-public-tables.sql
--   revokes before granting — so this is a gap in the new migration rather
--   than the project baseline.
--
-- WHAT IT ACTUALLY EXPOSED
--   Not as much as the grant list suggests, but not nothing. RLS is enabled on
--   both tables with a SELECT-only policy, so INSERT, UPDATE and DELETE from an
--   anon or authenticated PostgREST call are refused by the policy check.
--
--   TRUNCATE is the one that matters: it is a table-level privilege that row
--   level security does not govern at all, so no policy was standing in its
--   way. PostgREST never emits TRUNCATE, which is what kept this theoretical —
--   but "the API client happens not to have a verb for it" is not an access
--   control, and the province-wide mirror is the table every portfolio, every
--   alert and every saved boundary hangs off.
--
--   REFERENCES and TRIGGER are the same shape of mistake, one step further
--   from exploitable.
--
-- Depends on: 20260801000001.
--
-- Rollback:
--   grant all on table public.tenures to anon, authenticated;
--   grant all on table public.tenure_owners to anon, authenticated;
--   (There is no reason to. The write privileges were never intended — the
--   importer holds the service role.)
-- ============================================================

revoke all on table public.tenures from anon, authenticated;
revoke all on table public.tenure_owners from anon, authenticated;

-- Public read is the point of the mirror: /api/tenure-search serves anonymous
-- callers with the anon key, and a shared map draws claim outlines for a
-- signed-out visitor.
grant select on table public.tenures to anon, authenticated;
grant select on table public.tenure_owners to anon, authenticated;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon', 'authenticated')
--     and table_name in ('tenures', 'tenure_owners')
--   group by table_name, grantee;
--   -- expect SELECT and nothing else, for both roles, on both tables.
