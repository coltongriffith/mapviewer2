-- ============================================================
-- CANONICAL BASELINE (audit P0-05)
--
-- Captures the tables, constraints, indexes, RLS state, and policies that the
-- application depends on but that NO tracked migration ever created. Before
-- this file, `projects`, `templates`, `shared_maps`, `account_settings`, the
-- analytics tables, and the organization tables existed only because they had
-- been made by hand in the Supabase dashboard — so a fresh database could not
-- be rebuilt from the repository, staging could not be trusted to match
-- production, and disaster recovery had no starting point.
--
-- Generated from the live production schema on 2026-07-28.
--
-- ORDERING: this file is named 00000000000000 so it runs FIRST, before the
-- dated migrations that alter these tables (billing plans, custom invoices,
-- project quota/revisions, shared-map bounds, event ledger).
--
-- IDEMPOTENT: every statement is guarded, so applying it to the existing
-- production database is a no-op. Verify with the queries at the end.
--
-- NOT INCLUDED: auth.* (managed by Supabase), storage.*, extensions, and the
-- large registry tables qc_claims / us_claim_claimants, which have their own
-- setup scripts at the repository root.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Organizations (present but not yet surfaced in the product) ────────────
create table if not exists public.organizations (
  id uuid not null default gen_random_uuid(),
  name text not null,
  owner_id uuid not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.organization_members (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  role text not null default 'member'::text,
  joined_at timestamp with time zone default now()
);

-- ── Core user data ─────────────────────────────────────────────────────────
create table if not exists public.templates (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  org_id uuid,
  name text not null,
  is_default boolean default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.projects (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  org_id uuid,
  name text not null default 'Untitled map'::text,
  payload jsonb not null default '{}'::jsonb,
  template_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone default now(),
  thumbnail text
  -- revision / deleted_at are added by 20260728000006.
);

create table if not exists public.shared_maps (
  id text not null,
  state jsonb not null,
  created_at timestamp with time zone default now(),
  user_id uuid,
  view_count integer default 0
  -- expires_at / revoked_at / creator_key are added by 20260728000004.
);

create table if not exists public.account_settings (
  user_id uuid not null,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);

-- ── Admin + analytics ──────────────────────────────────────────────────────
create table if not exists public.admin_users (
  user_id uuid not null,
  note text,
  added_at timestamp with time zone default now()
);

create table if not exists public.export_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  format text not null,
  project_name text,
  "noWatermark" boolean default false,
  created_at timestamp with time zone default now(),
  session_id text
  -- output_branding / entitlement_plan are added by the telemetry migration.
);

create table if not exists public.product_events (
  id uuid not null default gen_random_uuid(),
  session_id text not null,
  user_id uuid,
  event text not null,
  props jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.page_views (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  path text default '/'::text,
  visited_at timestamp with time zone default now(),
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device text default 'desktop'::text,
  created_at timestamp with time zone default now(),
  lat double precision,
  lng double precision,
  city text,
  country text,
  session_id text
);

create table if not exists public.search_events (
  id uuid not null default gen_random_uuid(),
  kind text default 'registry'::text,
  province text,
  mode text,
  query_len integer,
  result_count integer,
  created_at timestamp with time zone default now(),
  session_id text,
  user_id uuid
);

create table if not exists public.landing_clicks (
  id uuid not null default gen_random_uuid(),
  x_pct numeric not null,
  y_pct numeric not null,
  element text,
  created_at timestamp with time zone default now(),
  viewport_w integer,
  page_h integer,
  session_id text
);

create table if not exists public.live_pings (
  session_id text not null,
  lat double precision,
  lng double precision,
  city text,
  country text,
  created_at timestamp with time zone default now(),
  region text
);

create table if not exists public.leads (
  id uuid not null default gen_random_uuid(),
  email text not null,
  project_title text,
  captured_at timestamp with time zone default now(),
  session_id text,
  welcomed_at timestamp with time zone
);

-- ── Constraints (idempotent via catalog guard) ─────────────────────────────
do $$
declare
  s text;
begin
  foreach s in array array[
    'alter table public.organizations add constraint organizations_pkey primary key (id)',
    'alter table public.organizations add constraint organizations_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade',
    'alter table public.organization_members add constraint organization_members_pkey primary key (id)',
    'alter table public.organization_members add constraint organization_members_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade',
    'alter table public.organization_members add constraint organization_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade',
    'alter table public.organization_members add constraint organization_members_org_id_user_id_key unique (org_id, user_id)',
    'alter table public.organization_members add constraint organization_members_role_check check (role = any (array[''owner''::text, ''admin''::text, ''member''::text]))',
    'alter table public.templates add constraint templates_pkey primary key (id)',
    'alter table public.templates add constraint templates_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade',
    'alter table public.templates add constraint templates_org_id_fkey foreign key (org_id) references public.organizations(id) on delete set null',
    'alter table public.projects add constraint projects_pkey primary key (id)',
    'alter table public.projects add constraint projects_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade',
    'alter table public.projects add constraint projects_org_id_fkey foreign key (org_id) references public.organizations(id) on delete set null',
    'alter table public.projects add constraint projects_template_id_fkey foreign key (template_id) references public.templates(id) on delete set null',
    'alter table public.shared_maps add constraint shared_maps_pkey primary key (id)',
    'alter table public.shared_maps add constraint shared_maps_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null',
    'alter table public.account_settings add constraint account_settings_pkey primary key (user_id)',
    'alter table public.account_settings add constraint account_settings_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade',
    'alter table public.admin_users add constraint admin_users_pkey primary key (user_id)',
    'alter table public.admin_users add constraint admin_users_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade',
    'alter table public.export_events add constraint export_events_pkey primary key (id)',
    'alter table public.export_events add constraint export_events_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null',
    'alter table public.product_events add constraint product_events_pkey primary key (id)',
    'alter table public.product_events add constraint product_events_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null',
    'alter table public.page_views add constraint page_views_pkey primary key (id)',
    'alter table public.page_views add constraint page_views_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null',
    'alter table public.search_events add constraint search_events_pkey primary key (id)',
    'alter table public.landing_clicks add constraint landing_clicks_pkey primary key (id)',
    'alter table public.live_pings add constraint live_pings_pkey primary key (session_id)',
    'alter table public.leads add constraint leads_pkey primary key (id)'
  ] loop
    begin
      execute s;
    exception
      when duplicate_table or duplicate_object or invalid_table_definition then null;
    end;
  end loop;
end $$;

create index if not exists idx_projects_created on public.projects using btree (created_at);

-- ── Row level security ─────────────────────────────────────────────────────
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.templates            enable row level security;
alter table public.projects             enable row level security;
alter table public.shared_maps          enable row level security;
alter table public.account_settings     enable row level security;
alter table public.admin_users          enable row level security;
alter table public.export_events        enable row level security;
alter table public.product_events       enable row level security;
alter table public.page_views           enable row level security;
alter table public.search_events        enable row level security;
alter table public.landing_clicks       enable row level security;
alter table public.live_pings           enable row level security;
alter table public.leads                enable row level security;

-- Owner-scoped access. Every policy compares auth.uid() to the row's owner —
-- a caller can never read or write another account's rows.
drop policy if exists "own orgs" on public.organizations;
create policy "own orgs" on public.organizations for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "own memberships" on public.organization_members;
create policy "own memberships" on public.organization_members for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users select own projects" on public.projects;
create policy "users select own projects" on public.projects for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "users update own projects" on public.projects;
create policy "users update own projects" on public.projects for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users delete own projects" on public.projects;
create policy "users delete own projects" on public.projects for delete to authenticated
  using (auth.uid() = user_id);
-- NOTE: INSERT is deliberately NOT granted here. Project creation goes through
-- create_cloud_project() so the plan quota is enforced transactionally
-- (20260728000002).

drop policy if exists "users select own templates" on public.templates;
create policy "users select own templates" on public.templates for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "users insert own templates" on public.templates;
create policy "users insert own templates" on public.templates for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "users update own templates" on public.templates;
create policy "users update own templates" on public.templates for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users delete own templates" on public.templates;
create policy "users delete own templates" on public.templates for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users select own settings" on public.account_settings;
create policy "users select own settings" on public.account_settings for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "users insert own settings" on public.account_settings;
create policy "users insert own settings" on public.account_settings for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "users update own settings" on public.account_settings;
create policy "users update own settings" on public.account_settings for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Analytics ingest is append-only from the browser; nothing may read it back.
drop policy if exists "anon insert export events" on public.export_events;
create policy "anon insert export events" on public.export_events for insert to anon
  with check (user_id is null);
drop policy if exists "users insert own export events" on public.export_events;
create policy "users insert own export events" on public.export_events for insert to authenticated
  with check (auth.uid() = user_id);

-- shared_maps has NO table policies: reads and writes go exclusively through
-- get_shared_map() / create_shared_map() / revoke_shared_map(), and the
-- table-level grants are revoked (20260710000002, 20260728000004).

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Least privilege: start from nothing, then grant only what a browser client
-- genuinely uses. RLS already blocks the leftovers Supabase's default
-- privileges hand out, but relying on RLS alone means one dropped policy is
-- an immediate data leak.
revoke all on table public.export_events, public.product_events, public.page_views,
                    public.search_events, public.landing_clicks, public.live_pings,
                    public.leads
  from anon, authenticated;

-- export_events is the ONLY analytics table the browser writes directly
-- (src/App.jsx after an export). product_events, page_views, search_events,
-- landing_clicks, live_pings and leads are written by /api/track using the
-- service role, so clients need no privileges on them at all.
grant insert on table public.export_events to anon, authenticated;

-- Owner-scoped tables.
revoke all on table public.projects, public.templates, public.account_settings,
                    public.organizations, public.organization_members
  from anon, authenticated;
-- projects: NO insert — create_cloud_project() enforces the plan quota.
grant select, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.templates to authenticated;
grant select, insert, update on table public.account_settings to authenticated;
grant select, insert, update, delete on table public.organizations, public.organization_members to authenticated;

-- shared_maps and admin_users: service role / RPC only.
revoke all on table public.shared_maps, public.admin_users from anon, authenticated;

-- ============================================================
-- Verification (run manually against a freshly migrated database):
--
--   -- every expected table exists
--   select table_name from information_schema.tables
--    where table_schema='public' order by table_name;
--
--   -- RLS is on everywhere it must be
--   select relname, relrowsecurity from pg_class c
--     join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relkind='r' and not relrowsecurity;
--   -- expect: no rows (other than spatial_ref_sys)
--
--   -- anon holds no read access to user data
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and grantee='anon'
--      and table_name in ('projects','templates','account_settings','shared_maps','user_plans');
--   -- expect: no rows
-- ============================================================

-- ── Reference data + views: read-only for clients ──────────────────────────
-- SECURITY: RLS does NOT apply to TRUNCATE — it is a table-level privilege.
-- Supabase's default grants gave anon TRUNCATE on the registry tables, so
-- anyone with the public anon key could have wiped them even though the only
-- RLS policies were SELECT-only.
revoke all on table public.qc_claims from anon, authenticated;
revoke all on table public.us_claim_claimants from anon, authenticated;
grant select on table public.qc_claims to anon, authenticated;
grant select on table public.us_claim_claimants to anon, authenticated;

-- leads_conversion exposes lead emails joined to auth.users.
revoke all on table public.leads_conversion from anon, authenticated;

-- KNOWN LIMITATION: public.spatial_ref_sys and public.geometry_columns still
-- grant write privileges to anon/authenticated. They are owned by
-- supabase_admin and the grants were issued by supabase_admin, so the postgres
-- role cannot revoke them. Platform default; no customer data involved.
