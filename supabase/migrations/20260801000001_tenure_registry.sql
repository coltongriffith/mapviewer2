-- ============================================================
-- TENURE MONITOR — part 1 of 3: the government-data mirror.
--
-- Stores Exploration Maps' copy of the B.C. mineral tenure registry, plus the
-- history and provenance needed to answer "what did we believe about this
-- title, and when did we start believing it?".
--
-- SOURCE
--   DataBC WFS  https://openmaps.gov.bc.ca/geo/pub/wfs
--   Layer       pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW
--   Licence     Open Government Licence – British Columbia (attribution
--               required; see docs/tenure-monitor.md)
--   Loader      scripts/tenure-sync/  (GitHub Actions, service-role writes)
--
-- WHAT THIS SCHEMA REFUSES TO ASSUME
--   The B.C. layer's exact field list is verified at run time, not hard-coded
--   (see scripts/tenure-sync/resolveFields.mjs). Government client number,
--   ownership percentage, owner count and termination date are NOT confirmed
--   to exist on the layer, so every one of those columns is nullable and the
--   UI renders "Not published in the B.C. source" rather than a blank or a
--   zero. If a later discovery run finds them, rows start carrying them with
--   no migration.
--
-- DATE HANDLING
--   good_to_date / issue_date / termination_date are `date`, never
--   `timestamptz`. The province publishes a calendar date with no time, and
--   inventing a government deadline instant would be fabricating a fact about
--   somebody's mineral rights. All deadline arithmetic happens in
--   America/Vancouver in src/utils/tenureDates.js.
--
-- SAFETY POSTURE
--   Nothing here ever deletes a tenure. A title that stops appearing in the
--   source has missing_run_count incremented; the importer decides (after two
--   consecutive CLEAN runs) whether that is worth telling a user about. A
--   failed or partial government response must never be able to empty a
--   customer's portfolio.
--
-- Depends on: 00000000000000_baseline_schema.sql, 20260710000005 (is_admin).
-- Requires extensions postgis + pg_trgm, both already used by qc_claims.
--
-- Rollback:
--   drop function if exists public.tenure_geom_from_geojson(jsonb);
--   drop function if exists public.tenure_reconcile_run(uuid, timestamptz, text, text);
--   drop function if exists public.tenures_in_bbox(double precision, double precision, double precision, double precision, integer);
--   drop function if exists public.tenure_last_sync();
--   drop table if exists public.tenure_import_staging cascade;
--   drop table if exists public.tenure_change_events cascade;
--   drop table if exists public.tenure_snapshots cascade;
--   drop table if exists public.tenure_owners cascade;
--   drop table if exists public.tenures cascade;
--   drop table if exists public.tenure_import_runs cascade;
-- ============================================================

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ── Import runs ────────────────────────────────────────────────────────────
-- Written first (tenures reference it), and the audit trail for every sync.
-- `alerts_safe` is the flag the alert engine reads: false means this run may
-- have produced an incomplete picture, so change/not-observed notices derived
-- from it must be withheld.
create table if not exists public.tenure_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'bc-wfs-mta-acquired-tenure-svw',
  jurisdiction text not null default 'BC',
  mode text not null default 'full'
    check (mode in ('full', 'targeted', 'discover')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'aborted', 'failed')),
  records_received integer not null default 0,
  records_processed integer not null default 0,
  records_rejected integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  material_changes_detected integer not null default 0,
  -- Stable hash of the resolved field list, so drift is detectable by
  -- comparing runs rather than by re-reading the whole layer.
  schema_fingerprint text,
  resolved_fields jsonb,
  -- false whenever the run aborted, failed, or tripped a guardrail. The alert
  -- engine will not raise change/missing notices off an unsafe run.
  alerts_safe boolean not null default false,
  error_summary text,
  guardrail_report jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenure_import_runs_started_idx
  on public.tenure_import_runs (started_at desc);
create index if not exists tenure_import_runs_status_idx
  on public.tenure_import_runs (status, started_at desc);

-- ── Import staging ─────────────────────────────────────────────────────────
--
-- THE MECHANISM THAT MAKES "ABORT WITHOUT WRITING" REAL.
--
-- The guardrails in scripts/tenure-sync/guardrails.mjs are run-level: they need
-- the whole result set before they can say whether it is trustworthy. That
-- creates an obvious tension — you cannot judge the run until it has finished,
-- but you must not write it until you have judged it.
--
-- Buffering a province-wide pull in the importer's memory is the other obvious
-- answer, and it is the reason the Quebec loader needs a 12 GB heap. So each
-- page lands here instead: memory stays flat, and this table is by definition
-- untrusted, so an aborted run is cleaned up with a DELETE that touches
-- nothing a customer's portfolio depends on.
--
-- Rows live only for the duration of one run and are removed on both the
-- success and the abort path.
create table if not exists public.tenure_import_staging (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.tenure_import_runs(id) on delete cascade,
  source_record_id text not null,
  payload jsonb not null,        -- { tenure: {...}, owners: [...] }
  created_at timestamptz not null default now()
);

create index if not exists tenure_import_staging_run_idx
  on public.tenure_import_staging (import_run_id, id);

alter table public.tenure_import_staging enable row level security;
revoke all on table public.tenure_import_staging from anon, authenticated;

-- ── Error-tolerant GeoJSON → geometry ──────────────────────────────────────
-- Same approach as qc_geom_from_geojson: one malformed polygon yields NULL and
-- is skipped, instead of failing an entire province-wide reload.
create or replace function public.tenure_geom_from_geojson(g jsonb)
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

-- ── Tenures: the latest known government record ────────────────────────────
create table if not exists public.tenures (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'BC',
  source text not null default 'bc-wfs-mta-acquired-tenure-svw',
  -- The registry's own stable identifier for the record. For B.C. this is
  -- TENURE_NUMBER_ID. Kept distinct from tenure_number because a jurisdiction
  -- added later may key on something else entirely.
  source_record_id text not null,

  tenure_number text,
  tenure_name text,                -- CLAIM_NAME
  tenure_type text,                -- TENURE_TYPE_DESCRIPTION / TITLE_TYPE_DESCRIPTION
  tenure_subtype text,             -- TENURE_SUBTYPE_DESCRIPTION
  status text,                     -- government status string, stored verbatim

  issue_date date,
  good_to_date date,               -- THE monitored deadline
  termination_date date,           -- may not be published; nullable on purpose

  area_hectares numeric,
  map_unit text,                   -- MAP_UNIT_NO, used for map-sheet search

  -- Counts the province may or may not publish. Null = not published.
  owner_count integer,
  work_event_count integer,
  transfer_event_count integer,

  geometry jsonb,                  -- GeoJSON geometry, WGS84, 6 dp
  geom geometry(Geometry, 4326)
    generated always as (public.tenure_geom_from_geojson(geometry)) stored,
  -- Fingerprint of the stored polygon (FNV-1a, see normalize.mjs#geometryHash).
  -- Exists so the nightly importer can answer "did this boundary move?" by
  -- reading one short string per tenure instead of pulling the province's
  -- geometry back out of the database on every run.
  geometry_hash text,

  source_updated_at timestamptz,   -- the registry's own record timestamp
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),

  -- Consecutive CLEAN runs in which this tenure was expected but absent.
  -- Never triggers a delete; drives the cautious "not present in the latest
  -- successful dataset" message only after it reaches 2.
  missing_run_count integer not null default 0,

  -- Everything the source sent, kept verbatim for debugging and for schema
  -- changes we have not modelled yet.
  raw_source_data jsonb,
  last_import_run_id uuid references public.tenure_import_runs(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tenures_source_record_unique unique (jurisdiction, source, source_record_id)
);

create index if not exists tenures_tenure_number_idx
  on public.tenures (jurisdiction, tenure_number);
create index if not exists tenures_good_to_date_idx
  on public.tenures (good_to_date) where good_to_date is not null;
create index if not exists tenures_status_idx on public.tenures (status);
create index if not exists tenures_map_unit_idx on public.tenures (map_unit);
create index if not exists tenures_geom_gist on public.tenures using gist (geom);
create index if not exists tenures_missing_idx
  on public.tenures (missing_run_count) where missing_run_count > 0;

-- ── Owners: one row per owner, per tenure ──────────────────────────────────
-- Modelled one-to-many from day one even though the current B.C. layer
-- publishes a single flattened OWNER_NAME. ownership_representation records
-- which of those two worlds a row came from, so the UI can say "the source
-- publishes one combined owner field" instead of implying a sole owner.
create table if not exists public.tenure_owners (
  id uuid primary key default gen_random_uuid(),
  tenure_id uuid not null references public.tenures(id) on delete cascade,
  government_client_number text,   -- not confirmed present on the layer
  owner_name text not null,
  normalized_owner_name text not null,  -- src/utils/tenureOwners.js
  ownership_percentage numeric,    -- not confirmed present on the layer
  is_primary_owner boolean not null default false,
  ownership_representation text not null default 'single_field'
    check (ownership_representation in ('single_field', 'multi_field')),
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenure_owners_unique unique (tenure_id, normalized_owner_name)
);

create index if not exists tenure_owners_tenure_idx on public.tenure_owners (tenure_id);
create index if not exists tenure_owners_client_idx
  on public.tenure_owners (government_client_number)
  where government_client_number is not null;
-- Trigram index so owner-name substring search stays fast across the province.
create index if not exists tenure_owners_name_trgm
  on public.tenure_owners using gin (normalized_owner_name gin_trgm_ops);

-- ── Snapshots: what we believed, and when ──────────────────────────────────
-- Written ONLY when something material changed, so this table is a history of
-- the title rather than a log of how often the cron ran. Retaining geometry
-- here is also what makes a future Released Claim Radar possible without a
-- schema rebuild.
create table if not exists public.tenure_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenure_id uuid not null references public.tenures(id) on delete cascade,
  snapshot_data jsonb not null,
  geometry jsonb,
  source_updated_at timestamptz,
  observed_at timestamptz not null default now(),
  import_run_id uuid references public.tenure_import_runs(id) on delete set null
);

create index if not exists tenure_snapshots_tenure_idx
  on public.tenure_snapshots (tenure_id, observed_at desc);

-- ── Change events ──────────────────────────────────────────────────────────
create table if not exists public.tenure_change_events (
  id uuid primary key default gen_random_uuid(),
  tenure_id uuid not null references public.tenures(id) on delete cascade,
  event_type text not null check (event_type in (
    'GOOD_TO_DATE_CHANGED',
    'OWNER_ADDED',
    'OWNER_REMOVED',
    'OWNERSHIP_PERCENTAGE_CHANGED',
    'STATUS_CHANGED',
    'CLAIM_NAME_CHANGED',
    'AREA_CHANGED',
    'GEOMETRY_CHANGED',
    'TENURE_TERMINATED',
    'TENURE_NO_LONGER_OBSERVED',
    'TENURE_REAPPEARED',
    'SOURCE_DATA_DISCREPANCY'
  )),
  previous_value text,
  current_value text,
  detected_at timestamptz not null default now(),
  import_run_id uuid references public.tenure_import_runs(id) on delete set null,
  severity text not null default 'info' check (severity in ('info', 'notable', 'critical')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenure_change_events_tenure_idx
  on public.tenure_change_events (tenure_id, detected_at desc);
create index if not exists tenure_change_events_recent_idx
  on public.tenure_change_events (detected_at desc);
create index if not exists tenure_change_events_type_idx
  on public.tenure_change_events (event_type, detected_at desc);

-- ── Row level security ─────────────────────────────────────────────────────
--
-- tenures + tenure_owners: PUBLIC READ. This is public government data, the
-- same posture qc_claims already has, and it is what lets the search endpoint
-- and (later) an anonymous claim checker read the mirror with the anon key.
-- Writes are service-role only, which bypasses RLS, so no write policy exists.
--
-- Snapshots, change events and import runs: NO client grants at all. They are
-- internal operational history; the admin dashboard reads them through a
-- SECURITY DEFINER RPC in migration 3.

alter table public.tenures enable row level security;
drop policy if exists "tenures public read" on public.tenures;
create policy "tenures public read" on public.tenures for select using (true);
grant select on table public.tenures to anon, authenticated;

alter table public.tenure_owners enable row level security;
drop policy if exists "tenure_owners public read" on public.tenure_owners;
create policy "tenure_owners public read" on public.tenure_owners for select using (true);
grant select on table public.tenure_owners to anon, authenticated;

alter table public.tenure_snapshots enable row level security;
revoke all on table public.tenure_snapshots from anon, authenticated;

alter table public.tenure_change_events enable row level security;
revoke all on table public.tenure_change_events from anon, authenticated;

alter table public.tenure_import_runs enable row level security;
revoke all on table public.tenure_import_runs from anon, authenticated;

-- ── Public read helpers ────────────────────────────────────────────────────

-- Last successful sync, surfaced on every portfolio view. Callable by anyone,
-- because "how fresh is this data?" must never be hidden behind auth — a user
-- looking at a deadline needs to know when we last heard from the province.
create or replace function public.tenure_last_sync()
returns table (
  completed_at timestamptz,
  records_processed integer,
  mode text,
  alerts_safe boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select completed_at, records_processed, mode, alerts_safe
  from public.tenure_import_runs
  where status = 'succeeded' and completed_at is not null
  order by completed_at desc
  limit 1;
$$;

revoke all on function public.tenure_last_sync() from public;
grant execute on function public.tenure_last_sync() to anon, authenticated, service_role;

-- Envelope search for the "claims in the current map extent" path. Bounded
-- server-side so a wide bbox cannot be turned into a full-table export.
create or replace function public.tenures_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  p_limit integer default 500
)
returns table (
  id uuid,
  tenure_number text,
  tenure_name text,
  tenure_type text,
  status text,
  good_to_date date,
  area_hectares numeric,
  geometry jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.tenure_number, t.tenure_name, t.tenure_type, t.status,
         t.good_to_date, t.area_hectares, t.geometry
  from public.tenures t
  where t.geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  order by t.tenure_number
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function public.tenures_in_bbox(double precision, double precision, double precision, double precision, integer) from public;
grant execute on function public.tenures_in_bbox(double precision, double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- ── Reconciliation ─────────────────────────────────────────────────────────
--
-- Called by the importer at the end of a CLEAN, COMPLETE, province-wide run —
-- and only then (see scripts/tenure-sync/guardrails.mjs#mayReconcile). Any
-- tenure the run did not touch has its miss counter incremented; anything the
-- run did touch has the counter reset.
--
-- NOTHING IS EVER DELETED HERE. A title absent from the source is a question
-- ("why didn't we see this?"), not an answer ("it lapsed"), and the difference
-- matters because the answer would be emailed to somebody as a fact about
-- their mineral rights. The importer waits for two consecutive clean misses
-- before it will even say "not present in the latest successful dataset".
--
-- service_role only: this runs from the GitHub Actions job, never from a
-- browser.
create or replace function public.tenure_reconcile_run(
  p_run_id uuid,
  p_run_started timestamptz,
  p_jurisdiction text default 'BC',
  p_source text default 'bc-wfs-mta-acquired-tenure-svw'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missed int;
  v_returned int;
  v_newly_missing jsonb;
  v_reappeared jsonb;
begin
  -- Tenures that were previously missing and were seen again in this run.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'tenure_number', tenure_number, 'previous_misses', missing_run_count)), '[]'::jsonb)
    into v_reappeared
  from public.tenures
  where jurisdiction = p_jurisdiction and source = p_source
    and missing_run_count > 0 and last_synced_at >= p_run_started;

  update public.tenures
     set missing_run_count = 0, updated_at = now()
   where jurisdiction = p_jurisdiction and source = p_source
     and missing_run_count > 0 and last_synced_at >= p_run_started;
  get diagnostics v_returned = row_count;

  update public.tenures
     set missing_run_count = missing_run_count + 1,
         last_import_run_id = p_run_id,
         updated_at = now()
   where jurisdiction = p_jurisdiction and source = p_source
     and last_synced_at < p_run_started;
  get diagnostics v_missed = row_count;

  -- Exactly at the threshold, so each tenure produces one notice rather than
  -- one per run for the rest of its life.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'tenure_number', tenure_number, 'misses', missing_run_count)), '[]'::jsonb)
    into v_newly_missing
  from public.tenures
  where jurisdiction = p_jurisdiction and source = p_source
    and missing_run_count = 2;

  return jsonb_build_object(
    'missing_total', v_missed,
    'reobserved_total', v_returned,
    'newly_missing', v_newly_missing,
    'reappeared', v_reappeared
  );
end;
$$;

revoke all on function public.tenure_reconcile_run(uuid, timestamptz, text, text) from public;
grant execute on function public.tenure_reconcile_run(uuid, timestamptz, text, text) to service_role;

-- ── Post-migration verification (run manually) ─────────────────────────────
--   select count(*) from public.tenures;
--   select count(*) from public.tenures where geom is not null;
--   select * from public.tenure_last_sync();
--   -- RLS is on and anon cannot read internal history:
--   select relname, relrowsecurity from pg_class
--    where relname in ('tenures','tenure_owners','tenure_snapshots',
--                      'tenure_change_events','tenure_import_runs');
--   -- expect a permission error as anon:
--   select count(*) from public.tenure_import_runs;
