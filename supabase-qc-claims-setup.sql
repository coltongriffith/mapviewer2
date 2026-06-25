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

-- ── Nearby-radius (spatial) search support ──────────────────────────────────
-- The "Nearby Claims" map tool sends a bounding box (envelope). Quebec has no
-- live ArcGIS service, so the spatial query runs here in PostGIS. We derive a
-- real geometry column from the stored GeoJSON so it can be GIST-indexed and
-- queried fast. Safe to run on the already-loaded table — it backfills in place.
create extension if not exists postgis;

-- Immutable, error-tolerant GeoJSON -> geometry. A single malformed geometry
-- yields NULL (and is simply skipped) instead of failing a whole weekly reload.
create or replace function public.qc_geom_from_geojson(g jsonb)
returns geometry
language plpgsql
immutable
as $$
begin
  if g is null then
    return null;
  end if;
  return st_setsrid(st_geomfromgeojson(g::text), 4326);
exception when others then
  return null;
end;
$$;

-- Generated column: auto-populated on every insert (the weekly loader needs no
-- change) and backfilled for existing rows the moment this runs on a populated
-- table.
alter table public.qc_claims
  add column if not exists geom geometry(Geometry, 4326)
  generated always as (public.qc_geom_from_geojson(geometry)) stored;

create index if not exists qc_claims_geom_gist
  on public.qc_claims using gist (geom);

-- Envelope-intersection lookup for the nearby-radius tool. security definer so
-- the public anon key can call it under the existing read-only policy. Returns
-- the same columns the /api/claims proxy maps to BC-style property names.
create or replace function public.qc_claims_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision
)
returns table (
  tag_number    text,
  owner_name    text,
  status        text,
  good_to_date  date,
  area_hectares numeric,
  title_type    text,
  geometry      jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select tag_number, owner_name, status, good_to_date, area_hectares, title_type, geometry
  from public.qc_claims
  where geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  limit 2000;
$$;

grant execute on function public.qc_claims_in_bbox(double precision, double precision, double precision, double precision)
  to anon, service_role;

-- Quick sanity check after the first weekly load runs:
--   select count(*), max(source_updated_at) from public.qc_claims;
--   select count(*) from public.qc_claims where geom is not null;
