-- ============================================================================
-- Quebec mining claims store  (run once, in the Supabase SQL editor)
-- ============================================================================
-- Quebec has no live, queryable public claims API (GESTIM is login-gated and
-- SIGEOM only serves map images). Instead we download Quebec's free public
-- claims shapefile once a week (it is refreshed every Monday) and load it into
-- this table. The /api/claims serverless function then reads from here, exactly
-- like the other provinces read from their live registries.
--
-- Copy this whole file into the Supabase SQL editor and click "Run".
-- It is safe to re-run: every statement is idempotent.
-- ============================================================================

-- Trigram index support so company (holder) name ILIKE searches stay fast.
create extension if not exists pg_trgm;

create table if not exists public.qc_claims (
  id              bigint generated always as identity primary key,
  tag_number      text,          -- claim / title number (NO_TITRE)
  owner_name      text,          -- titleholder (TITULAIRE)
  status          text,          -- title status (STATUT) e.g. "Actif"
  good_to_date    date,          -- expiry / good-to date (DATE_EXPIR)
  area_hectares   numeric,       -- SUPERFICIE
  title_type      text,          -- TYPE_TITRE (e.g. "Claim")
  geometry        jsonb,         -- GeoJSON geometry, already reprojected to WGS84
  source_updated_at date         -- date the source file was published
);

-- Fast holder-name substring search (company mode).
create index if not exists qc_claims_owner_trgm
  on public.qc_claims using gin (owner_name gin_trgm_ops);

-- Fast exact claim-number lookup (number mode).
create index if not exists qc_claims_tag
  on public.qc_claims (tag_number);

-- ── Row level security ──────────────────────────────────────────────────────
-- Public read-only: the claims data is already public, and the search proxy
-- reads it with the anon key. The weekly loader writes with the service-role
-- key, which bypasses RLS, so no write policy is needed.
alter table public.qc_claims enable row level security;

drop policy if exists "qc_claims public read" on public.qc_claims;
create policy "qc_claims public read"
  on public.qc_claims for select
  using (true);

-- ── Fast table reset for the weekly loader ──────────────────────────────────
-- The loader replaces the whole table each run. Deleting ~268k rows one by one
-- updates the GIN trigram index per row and exceeds the API statement timeout, so
-- the loader calls this helper instead: TRUNCATE is a metadata operation (instant)
-- and "restart identity" keeps the id sequence from growing across reloads.
create or replace function public.truncate_qc_claims()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.qc_claims restart identity;
end;
$$;

grant execute on function public.truncate_qc_claims() to service_role;

-- Quick sanity check after the first weekly load runs:
--   select count(*), max(source_updated_at) from public.qc_claims;
