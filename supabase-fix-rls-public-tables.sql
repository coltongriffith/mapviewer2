-- ============================================================
-- Exploration Maps -- Fix: RLS disabled on `projects`, `templates`,
-- `shared_maps` (Supabase security advisory `rls_disabled_in_public`,
-- flagged 2026-06-28).
--
-- These three tables are used by src/utils/cloudStorage.js but were
-- never created via a tracked setup script in this repo (unlike
-- export_events/leads/page_views/etc. in supabase-admin-setup.sql,
-- or account_settings/qc_claims in their own setup scripts) -- they
-- were created directly in the Supabase dashboard table editor, which
-- leaves Row-Level Security OFF by default. With RLS off, the anon
-- API key (public, shipped in the client bundle) can read, insert,
-- update, and delete every row in these tables directly, bypassing
-- every `.eq('user_id', user.id)` filter the app code applies --
-- those filters only narrow *intended* queries, they don't restrict
-- what a client can actually do with the table.
--
-- This script does NOT create these tables (they already exist and
-- this script doesn't know their exact column definitions) -- it only
-- enables RLS and adds policies matching how the app already queries
-- them. Safe to re-run: policies are exception-guarded, enabling RLS
-- on an already-RLS-enabled table is a no-op.
--
-- Run this in Supabase Dashboard -> SQL Editor -> Run.
-- ============================================================

-- ── projects ────────────────────────────────────────────────────────────────
-- Always queried (and always written) scoped to `user_id = auth.uid()` in
-- cloudStorage.js, and only ever from an authenticated client (currentUser()
-- throws otherwise) -- so this is strict owner-only access, no anon role.

alter table projects enable row level security;
grant select, insert, update, delete on table projects to authenticated;

do $$ begin
  create policy "users select own projects"
    on projects for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users insert own projects"
    on projects for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users update own projects"
    on projects for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users delete own projects"
    on projects for delete to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ── templates (brand kits) ──────────────────────────────────────────────────
-- Same access shape as projects: owner-only, authenticated-only.

alter table templates enable row level security;
grant select, insert, update, delete on table templates to authenticated;

do $$ begin
  create policy "users select own templates"
    on templates for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users insert own templates"
    on templates for insert to authenticated with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users update own templates"
    on templates for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users delete own templates"
    on templates for delete to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ── shared_maps ──────────────────────────────────────────────────────────────
-- Intentionally public-readable by id (that's the whole point of a share
-- link -- the id is an unguessable 32-char token, not a sequential key) and
-- insertable by signed-out users too (shareMap() is called with
-- `user_id: user?.id ?? null`, i.e. sharing doesn't require login). The bug
-- RLS-off actually introduced is that it also let anyone UPDATE or DELETE
-- *any* shared map, not just read one by its token -- this script grants
-- select+insert only, so existing shares keep working but nobody can
-- tamper with or delete another user's shared map. The view-count
-- increment goes through `increment_shared_map_view`, a SECURITY DEFINER
-- function, which bypasses RLS -- it does not need its own policy.

alter table shared_maps enable row level security;
grant select, insert on table shared_maps to anon, authenticated;

do $$ begin
  create policy "anyone read shared map by id"
    on shared_maps for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "anyone create a shared map"
    on shared_maps for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1) Confirms RLS is now ON for all three tables:
select tablename, rowsecurity
  from pg_tables
  where schemaname = 'public' and tablename in ('projects', 'templates', 'shared_maps');

-- 2) Confirms the expected policies exist:
select tablename, policyname, cmd, roles
  from pg_policies
  where schemaname = 'public' and tablename in ('projects', 'templates', 'shared_maps')
  order by tablename, cmd;

-- 3) Proves the anon role can no longer read another user's projects/templates
-- (should return 0 rows -- if it returns rows, RLS isn't applied correctly):
set role anon;
select count(*) as should_be_zero from projects;
select count(*) as should_be_zero from templates;
reset role;
