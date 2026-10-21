-- ============================================================
-- DB hardening: RLS initplan rewrite, legacy duplicate policies, duplicate
-- indexes, indexes for unindexed foreign keys.
--
-- Everything here was checked against production (pg_policies, pg_indexes,
-- pg_constraint, table grants, and the Supabase performance and security
-- advisors) on 2026-10-21. No table, column or row is dropped.
--
-- 1. auth_rls_initplan (21 policies). A bare auth.uid() in a policy is
--    re-evaluated for every row; (select auth.uid()) is evaluated once per
--    statement as an initplan. auth.uid() is STABLE, so the value is the same
--    either way: each policy is recreated under its own name with the same
--    table, PERMISSIVE flag, command, roles and USING / WITH CHECK logic, and
--    only the auth.uid() call wrapped.
--
-- 2. multiple_permissive_policies on projects and templates. Production has a
--    legacy FOR ALL policy on each that no migration creates:
--      "own projects"   to public, using/check (auth.uid() = user_id and org_id is null)
--      "own templates"  to public, using (auth.uid() = user_id)  (check defaults to using)
--    Each is the union of four per-command policies that stay ("users
--    select/insert/update/delete own projects|templates", to authenticated,
--    same expressions). The only role that differs is "public" vs
--    "authenticated", and nothing else reaches these policies: anon holds no
--    privilege on either table, and the only other roles with privileges
--    (postgres, service_role, supabase_admin, supabase_etl_admin,
--    supabase_read_only_user) bypass RLS. The legacy policy also could never
--    pass for anon: auth.uid() is null without a signed-in user. The drop is
--    guarded so it only happens when all four survivors exist.
--    The org policies ("Org members read org maps" etc.) are different
--    predicates and stay; they still show in that advisor, by design.
--
-- 3. duplicate_index. Two identical index pairs; the hand-made copy goes and
--    the one a migration creates stays (as 20261021120000 did for qc_claims):
--      page_views:     drop page_views_created_idx (0 scans),
--                      keep idx_page_views_created (20260713000001)
--      tenure_owners:  drop tenure_owners_norm_trgm_idx,
--                      keep tenure_owners_name_trgm (20260801000001)
--    Each drop is guarded: it only happens while the kept index exists with
--    the same definition.
--
-- 4. unindexed_foreign_keys (31). A plain btree index on each FK column, so
--    deletes from the referenced table (mostly auth.users, ON DELETE SET NULL
--    or CASCADE) do not scan the referencing table. All tables are small (the
--    largest, tenures, has ~46k rows), so a plain CREATE INDEX is quick.
--
-- Transaction: do not add BEGIN/COMMIT. The Apply migration workflow runs
-- psql --single-transaction, so this file and its schema_migrations row commit
-- together; an inner COMMIT would end that transaction early. Pasted into the
-- SQL editor it also runs as one implicit transaction. Either way no policy
-- is ever missing between its drop and its re-create.
--
-- Idempotent: safe to run more than once.
-- Rollback: recreate the old policies with bare auth.uid() (definitions in
-- the header above and in 00000000000000_baseline_schema.sql), and
--   create index if not exists page_views_created_idx on public.page_views (created_at);
--   create index if not exists tenure_owners_norm_trgm_idx
--     on public.tenure_owners using gin (normalized_owner_name gin_trgm_ops);
-- ============================================================

-- Fail fast rather than queue behind a long read and block the table.
set local lock_timeout = '5s';

-- ── 1. RLS: (select auth.uid()) ─────────────────────────────────────────────

-- account_settings
drop policy if exists "users select own settings" on public.account_settings;
create policy "users select own settings" on public.account_settings
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users insert own settings" on public.account_settings;
create policy "users insert own settings" on public.account_settings
  as permissive for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "users update own settings" on public.account_settings;
create policy "users update own settings" on public.account_settings
  as permissive for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- custom_invoices
drop policy if exists "custom_invoices_select_own" on public.custom_invoices;
create policy "custom_invoices_select_own" on public.custom_invoices
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

-- export_events
drop policy if exists "users insert own export events" on public.export_events;
create policy "users insert own export events" on public.export_events
  as permissive for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- monitored_portfolios
drop policy if exists "portfolios_select_own" on public.monitored_portfolios;
create policy "portfolios_select_own" on public.monitored_portfolios
  as permissive for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "portfolios_update_own" on public.monitored_portfolios;
create policy "portfolios_update_own" on public.monitored_portfolios
  as permissive for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "portfolios_delete_own" on public.monitored_portfolios;
create policy "portfolios_delete_own" on public.monitored_portfolios
  as permissive for delete to authenticated
  using (user_id = (select auth.uid()));

-- projects (personal maps only; org maps have their own policies)
drop policy if exists "users select own projects" on public.projects;
create policy "users select own projects" on public.projects
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id and org_id is null);

drop policy if exists "users insert own projects" on public.projects;
create policy "users insert own projects" on public.projects
  as permissive for insert to authenticated
  with check ((select auth.uid()) = user_id and org_id is null);

drop policy if exists "users update own projects" on public.projects;
create policy "users update own projects" on public.projects
  as permissive for update to authenticated
  using ((select auth.uid()) = user_id and org_id is null)
  with check ((select auth.uid()) = user_id and org_id is null);

drop policy if exists "users delete own projects" on public.projects;
create policy "users delete own projects" on public.projects
  as permissive for delete to authenticated
  using ((select auth.uid()) = user_id and org_id is null);

-- templates
drop policy if exists "users select own templates" on public.templates;
create policy "users select own templates" on public.templates
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users insert own templates" on public.templates;
create policy "users insert own templates" on public.templates
  as permissive for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "users update own templates" on public.templates;
create policy "users update own templates" on public.templates
  as permissive for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "users delete own templates" on public.templates;
create policy "users delete own templates" on public.templates
  as permissive for delete to authenticated
  using ((select auth.uid()) = user_id);

-- tenure_alert_policies
drop policy if exists "alert_policies_own" on public.tenure_alert_policies;
create policy "alert_policies_own" on public.tenure_alert_policies
  as permissive for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- tenure_alert_recipients
drop policy if exists "alert_recipients_own" on public.tenure_alert_recipients;
create policy "alert_recipients_own" on public.tenure_alert_recipients
  as permissive for all to authenticated
  using (exists (select 1 from public.tenure_alert_policies p
                 where p.id = tenure_alert_recipients.policy_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.tenure_alert_policies p
                      where p.id = tenure_alert_recipients.policy_id and p.user_id = (select auth.uid())));

-- user_plans
drop policy if exists "user_plans_select_own" on public.user_plans;
create policy "user_plans_select_own" on public.user_plans
  as permissive for select to authenticated
  using ((select auth.uid()) = user_id);

-- ── 2. Legacy FOR ALL duplicates on projects and templates ──────────────────
-- legacy-duplicate: "own projects"  on public.projects  covered-by: users select|insert|update|delete own projects
-- legacy-duplicate: "own templates" on public.templates covered-by: users select|insert|update|delete own templates
do $$
declare
  t text;
  legacy text;
  survivors text[];
begin
  foreach t in array array['projects', 'templates'] loop
    legacy := 'own ' || t;
    survivors := array['users select own ' || t, 'users insert own ' || t,
                       'users update own ' || t, 'users delete own ' || t];
    if (select count(*) from pg_policies
        where schemaname = 'public' and tablename = t and policyname = any (survivors)
          and roles = '{authenticated}' and permissive = 'PERMISSIVE') = 4 then
      execute format('drop policy if exists %I on public.%I', legacy, t);
    else
      raise notice 'kept %.%: its per-command replacements are not all present', t, legacy;
    end if;
  end loop;
end $$;

-- ── 3. Duplicate indexes ────────────────────────────────────────────────────
do $$
declare
  pair text[];
  keep_def text;
  drop_def text;
begin
  foreach pair slice 1 in array array[
    array['page_views_created_idx', 'idx_page_views_created'],
    array['tenure_owners_norm_trgm_idx', 'tenure_owners_name_trgm']
  ] loop
    select indexdef into drop_def from pg_indexes where schemaname = 'public' and indexname = pair[1];
    select indexdef into keep_def from pg_indexes where schemaname = 'public' and indexname = pair[2];
    if drop_def is null then
      continue;  -- already gone
    elsif keep_def is not null
      and replace(drop_def, ' ' || pair[1] || ' ', ' ') = replace(keep_def, ' ' || pair[2] || ' ', ' ') then
      execute format('drop index if exists public.%I', pair[1]);
    else
      raise notice 'kept %: % is missing or differs', pair[1], pair[2];
    end if;
  end loop;
end $$;

-- ── 4. Indexes for unindexed foreign keys ───────────────────────────────────
create index if not exists agent_runs_share_id_idx on public.agent_runs (share_id);
create index if not exists error_events_user_id_idx on public.error_events (user_id);
create index if not exists export_events_user_id_idx on public.export_events (user_id);
create index if not exists feedback_user_id_idx on public.feedback (user_id);
create index if not exists monitored_portfolio_tenures_added_by_user_id_idx on public.monitored_portfolio_tenures (added_by_user_id);
create index if not exists monitored_portfolio_tenures_assigned_user_id_idx on public.monitored_portfolio_tenures (assigned_user_id);
create index if not exists monitored_portfolio_tenures_notes_updated_by_idx on public.monitored_portfolio_tenures (notes_updated_by);
create index if not exists monitored_portfolios_alert_policy_id_idx on public.monitored_portfolios (alert_policy_id);
create index if not exists monitored_portfolios_org_id_idx on public.monitored_portfolios (org_id);
create index if not exists org_activity_actor_idx on public.org_activity (actor);
create index if not exists org_invites_accepted_by_idx on public.org_invites (accepted_by);
create index if not exists organizations_owner_id_idx on public.organizations (owner_id);
create index if not exists page_views_user_id_idx on public.page_views (user_id);
create index if not exists projects_property_id_idx on public.projects (property_id);
create index if not exists projects_template_id_idx on public.projects (template_id);
create index if not exists properties_created_by_idx on public.properties (created_by);
create index if not exists property_file_versions_uploaded_by_idx on public.property_file_versions (uploaded_by);
create index if not exists property_files_created_by_idx on public.property_files (created_by);
create index if not exists templates_org_id_idx on public.templates (org_id);
create index if not exists templates_user_id_idx on public.templates (user_id);
create index if not exists tenure_alert_instances_acknowledged_by_user_id_idx on public.tenure_alert_instances (acknowledged_by_user_id);
create index if not exists tenure_alert_instances_change_event_id_idx on public.tenure_alert_instances (change_event_id);
create index if not exists tenure_alert_instances_recipient_id_idx on public.tenure_alert_instances (recipient_id);
create index if not exists tenure_alert_recipients_user_id_idx on public.tenure_alert_recipients (user_id);
create index if not exists tenure_audit_log_user_id_idx on public.tenure_audit_log (user_id);
create index if not exists tenure_change_events_import_run_id_idx on public.tenure_change_events (import_run_id);
create index if not exists tenure_snapshots_import_run_id_idx on public.tenure_snapshots (import_run_id);
create index if not exists tenure_system_notices_created_by_idx on public.tenure_system_notices (created_by);
create index if not exists tenures_last_import_run_id_idx on public.tenures (last_import_run_id);
create index if not exists three_d_projects_property_id_idx on public.three_d_projects (property_id);
create index if not exists three_d_shares_project_id_idx on public.three_d_shares (project_id);

-- ── Post-migration verification (run manually) ─────────────────────────────
--   select tablename, policyname, roles, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and (qual ~ 'auth\.uid\(\)' or with_check ~ 'auth\.uid\(\)')
--   order by 1, 2;   -- every auth.uid() reads "( SELECT auth.uid() AS uid)"
--   select policyname from pg_policies where schemaname = 'public'
--     and policyname in ('own projects', 'own templates');   -- expect no rows
--   select indexname from pg_indexes where schemaname = 'public'
--     and indexname in ('page_views_created_idx', 'tenure_owners_norm_trgm_idx');  -- expect no rows
-- Then re-run the performance advisor: auth_rls_initplan, duplicate_index and
-- unindexed_foreign_keys should be clear.
