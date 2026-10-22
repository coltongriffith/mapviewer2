-- ============================================================
-- U.S. federal mining claims mirror (BLM MLRS "Active Mining Claims").
--
-- WHY
--   US claim searches proxy BLM's national ArcGIS layer live. In October 2026
--   that layer moved without notice (every US search failed for days), and it
--   is slow: a claim-name scan costs BLM 13-20 s, offset paging ~35 s per 500
--   rows. A weekly copy here, loaded by scripts/update-us-claims.mjs, makes US
--   searches independent of BLM's uptime and fast; /api/claims reads it when it
--   is populated and fresh, and falls back to live BLM otherwise.
--
-- WHAT THIS ADDS (additive only — new objects, nothing existing is altered
-- except import_headroom(), which gains two keys and keeps every old one):
--   public.us_claims                 one row per active claim, public read
--   public.us_claims_in_bbox(...)    envelope lookup for the nearby-claims tool
--   public.us_import_state/_batches  service-only staging, as qc_import_*
--   public.begin/stage/publish/abort_us_import, us_discard_import_batches
--                                    the same atomic swap as the Quebec import
--                                    (20260915160235 / 20261020160000)
--
-- SIZE (estimated Oct 2026, see PR): ~594k claims on the layer, ~560k in the
--   eleven states served. Geometry is simplified at ~1 m by the loader. At the
--   qc_claims rate (~740 B/row incl. indexes) that is ~420 MB; staging holds a
--   second (jsonb) copy only while an import runs.
--
-- STATES are stored as an array: a claim straddling a state line belongs to
--   both. state_source says how the state was known (shared/usClaimStates.js):
--   geo_state | legal_description (geographic) | serial_prefix (administering
--   office; the API declares it degraded) | none (an Oregon/Washington-office
--   claim with no location: kept for completeness, never returned for a state).
--
-- Rollback:
--   drop function if exists public.us_claims_in_bbox(double precision, double precision, double precision, double precision, text, integer);
--   drop function if exists public.publish_us_import(uuid), public.abort_us_import(uuid),
--     public.stage_us_import_batch(uuid, integer, jsonb), public.begin_us_import(integer),
--     public.us_discard_import_batches();
--   drop table if exists public.us_import_batches, public.us_import_state, public.us_claims;
--   drop function if exists public.us_geom_from_geojson(jsonb);
--   re-run import_headroom() from 20261020160000_import_disk_guard.sql.
-- ============================================================

create extension if not exists pg_trgm;
create extension if not exists postgis;

-- Immutable, error-tolerant GeoJSON -> geometry (as qc_geom_from_geojson): one
-- malformed geometry yields NULL and fails publication validation, rather than
-- failing the INSERT with an opaque error halfway through.
create or replace function public.us_geom_from_geojson(g jsonb)
returns geometry
language plpgsql
immutable
set search_path = public, pg_temp
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

create table if not exists public.us_claims (
  id                bigint generated always as identity primary key,
  serial            text not null,          -- MLRS case serial (CSE_NR), e.g. NV105222372
  legacy_serial     text,                   -- LR2000 serial (LEG_CSE_NR), e.g. NMC112112
  claim_name        text,                   -- CSE_NAME, as BLM spells it
  states            text[] not null default '{}',
  state_source      text not null check (state_source in ('geo_state', 'legal_description', 'serial_prefix', 'none')),
  admin_office      text,                   -- serial-prefix office (OR = Oregon/Washington)
  claim_type        text,                   -- BLM_PROD, e.g. "Lode Claim"
  disposition       text,                   -- CSE_DISP, e.g. "Active", "Filed"
  case_type_nr      text,                   -- CSE_TYPE_NR
  acres             numeric,                -- RCRD_ACRS
  location_date     date,                   -- LOC_DT
  geometry          jsonb not null,         -- GeoJSON, WGS84, simplified ~1 m
  source_updated_at date not null,          -- retrieval date of the load
  geom              geometry(Geometry, 4326) generated always as (public.us_geom_from_geojson(geometry)) stored
);

-- Serial lookups: equality AND prefix (LIKE 'NV1052%') from one index —
-- text_pattern_ops serves both, independent of the database collation.
create index if not exists us_claims_serial_idx on public.us_claims (serial text_pattern_ops);
create index if not exists us_claims_legacy_serial_idx on public.us_claims (legacy_serial text_pattern_ops)
  where legacy_serial is not null;
-- Claim-name search: ILIKE '%term%' via trigrams (case-insensitive by design).
create index if not exists us_claims_name_trgm on public.us_claims using gin (claim_name gin_trgm_ops);
-- State scope: states @> '{NV}'.
create index if not exists us_claims_states_gin on public.us_claims using gin (states);
-- Nearby-claims envelope.
create index if not exists us_claims_geom_gist on public.us_claims using gist (geom);

-- ── Row level security: public read-only, like qc_claims ────────────────────
-- The data is public BLM data and the search proxy reads it with the anon key.
-- The weekly loader writes with the service-role key (bypasses RLS).
alter table public.us_claims enable row level security;

drop policy if exists "us_claims public read" on public.us_claims;
create policy "us_claims public read"
  on public.us_claims for select
  using (true);

revoke all on table public.us_claims from public, anon, authenticated;
grant select on table public.us_claims to anon, authenticated;
grant all on table public.us_claims to service_role;
grant usage, select on sequence public.us_claims_id_seq to service_role;

-- Envelope lookup for the nearby-claims tool (and US bbox searches). Security
-- invoker: the caller's own SELECT grant and the public-read policy apply.
-- p_state narrows to claims located in that state; NULL means any state.
create or replace function public.us_claims_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  p_state text default null,
  p_limit integer default 10000
)
returns table (
  id            bigint,
  serial        text,
  legacy_serial text,
  claim_name    text,
  states        text[],
  state_source  text,
  claim_type    text,
  disposition   text,
  case_type_nr  text,
  acres         numeric,
  location_date date,
  geometry      jsonb,
  source_updated_at date
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.id, c.serial, c.legacy_serial, c.claim_name, c.states, c.state_source,
         c.claim_type, c.disposition, c.case_type_nr, c.acres, c.location_date,
         c.geometry, c.source_updated_at
  from public.us_claims c
  where c.geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    and (p_state is null or c.states @> array[upper(p_state)])
  order by c.id
  limit least(greatest(coalesce(p_limit, 10000), 1), 10000);
$$;

revoke all on function public.us_claims_in_bbox(double precision, double precision, double precision, double precision, text, integer) from public;
grant execute on function public.us_claims_in_bbox(double precision, double precision, double precision, double precision, text, integer)
  to anon, authenticated, service_role;

-- ── Atomic weekly import (the Quebec pattern) ──────────────────────────────
-- Compact, service-only staging. Rows arrive as jsonb batches of 1000; publish
-- swaps them into us_claims in one transaction (TRUNCATE + INSERT), so readers
-- see the old copy or the new one, never a half-loaded table, and a claim that
-- is no longer active simply is not in the new copy.
create table if not exists public.us_import_state (
  singleton boolean primary key default true check (singleton),
  run_id uuid, expected_rows integer, started_at timestamptz, baseline_rows integer
);
insert into public.us_import_state(singleton) values (true) on conflict do nothing;

create table if not exists public.us_import_batches (
  run_id uuid not null,
  batch_no integer not null check (batch_no >= 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  primary key (run_id, batch_no)
);

alter table public.us_import_state enable row level security;
alter table public.us_import_batches enable row level security;
revoke all on public.us_import_state, public.us_import_batches from public, anon, authenticated;
grant all on public.us_import_state, public.us_import_batches to service_role;

-- Empty staging without being able to hang (see 20261020160000): TRUNCATE with
-- a short lock timeout, DELETE when the lock is not granted.
create or replace function public.us_discard_import_batches()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
begin
  truncate public.us_import_batches;
exception when lock_not_available then
  delete from public.us_import_batches;
end $$;

create or replace function public.begin_us_import(p_expected_rows integer) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.us_import_state; v_run uuid := gen_random_uuid();
begin
  select * into s from public.us_import_state where singleton for update;
  if p_expected_rows not between 300000 and 1200000 then raise exception 'Unexpected active-claim count'; end if;
  if s.run_id is not null and s.started_at > now() - interval '2 hours' then raise exception 'US claims import already running'; end if;
  if s.baseline_rows is not null and (p_expected_rows < s.baseline_rows * 0.8 or p_expected_rows > s.baseline_rows * 1.2) then
    raise exception 'Active-claim count changed by more than 20 percent';
  end if;
  perform public.us_discard_import_batches();
  update public.us_import_state set run_id = v_run, expected_rows = p_expected_rows, started_at = now() where singleton;
  return v_run;
end $$;

create or replace function public.stage_us_import_batch(p_run_id uuid, p_batch_no integer, p_rows jsonb) returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.us_import_state; n integer;
begin
  select * into s from public.us_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then raise exception 'Stale import'; end if;
  n := jsonb_array_length(p_rows);
  if p_batch_no < 0 or p_batch_no >= ceil(s.expected_rows / 1000.0) or n <> least(1000, s.expected_rows - p_batch_no * 1000) then
    raise exception 'Invalid batch size or number';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where coalesce(r->>'serial', '') = ''
       or coalesce(r->'geometry'->>'type', '') not in ('Polygon', 'MultiPolygon')
       or coalesce(r->>'state_source', '') not in ('geo_state', 'legal_description', 'serial_prefix', 'none')
       or jsonb_typeof(r->'states') is distinct from 'array'
  ) then
    raise exception 'Invalid or unidentified claim';
  end if;
  insert into public.us_import_batches values (p_run_id, p_batch_no, p_rows)
    on conflict (run_id, batch_no) do update set rows = excluded.rows;
  return n;
end $$;

create or replace function public.publish_us_import(p_run_id uuid) returns integer
language plpgsql security invoker set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare s public.us_import_state; n integer; batches integer;
begin
  select * into s from public.us_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then raise exception 'Stale import'; end if;
  select coalesce(sum(jsonb_array_length(rows)), 0), count(*) into n, batches from public.us_import_batches where run_id = p_run_id;
  if n <> s.expected_rows or batches <> ceil(s.expected_rows / 1000.0) then raise exception 'Incomplete staged import'; end if;
  -- TRUNCATE + INSERT is one transaction. Any failure rolls both back.
  -- Continue the sequence: service_role may insert/truncate but does not own it.
  truncate public.us_claims continue identity;
  insert into public.us_claims (serial, legacy_serial, claim_name, states, state_source, admin_office, claim_type,
                                disposition, case_type_nr, acres, location_date, geometry, source_updated_at)
    select r.serial, nullif(r.legacy_serial, ''), r.claim_name,
           coalesce(array(select jsonb_array_elements_text(r.states)), '{}'), r.state_source, r.admin_office,
           r.claim_type, r.disposition, r.case_type_nr, r.acres, r.location_date, r.geometry, r.source_updated_at
    from public.us_import_batches b
    cross join lateral jsonb_to_recordset(b.rows) as r(
      serial text, legacy_serial text, claim_name text, states jsonb, state_source text, admin_office text,
      claim_type text, disposition text, case_type_nr text, acres numeric, location_date date,
      geometry jsonb, source_updated_at date)
    where b.run_id = p_run_id;
  get diagnostics n = row_count;
  -- Every geometry parsed, and every claim sits in the western U.S.
  if n <> s.expected_rows or exists (
    select 1 from public.us_claims
    where geom is null or not st_coveredby(geom, st_makeenvelope(-126, 30, -100, 50, 4326))
  ) then
    raise exception 'Publication validation failed';
  end if;
  perform public.us_discard_import_batches();
  update public.us_import_state set run_id = null, expected_rows = null, started_at = null, baseline_rows = n where singleton;
  return n;
end $$;

create or replace function public.abort_us_import(p_run_id uuid) returns boolean
language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.us_import_state;
begin
  select * into s from public.us_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then return false; end if;
  perform public.us_discard_import_batches();
  update public.us_import_state set run_id = null, expected_rows = null, started_at = null where singleton;
  return true;
end $$;

-- This project's default privileges grant EXECUTE on new functions to anon and
-- authenticated (see 20260806000001), so take that back explicitly.
revoke all on function public.us_geom_from_geojson(jsonb), public.us_discard_import_batches(),
  public.begin_us_import(integer), public.stage_us_import_batch(uuid, integer, jsonb),
  public.publish_us_import(uuid), public.abort_us_import(uuid)
  from public, anon, authenticated;
grant execute on function public.us_discard_import_batches(), public.begin_us_import(integer),
  public.stage_us_import_batch(uuid, integer, jsonb), public.publish_us_import(uuid), public.abort_us_import(uuid)
  to service_role;
-- The generated column evaluates us_geom_from_geojson as the inserting role.
grant execute on function public.us_geom_from_geojson(jsonb) to service_role;

-- ── Disk guard: the US import is a third bulk import ───────────────────────
-- Same body as 20261020160000, plus us_claims_bytes and us_import_started_at,
-- so scripts/lib/importHeadroom.mjs can size this import and keep all three
-- from writing at once.
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
    'us_claims_bytes', coalesce(pg_total_relation_size(to_regclass('public.us_claims')), 0),
    'qc_import_started_at', (select started_at from public.qc_import_state
                             where singleton and run_id is not null),
    'tenure_full_run_started_at', (select max(started_at) from public.tenure_import_runs
                                   where status = 'running' and mode = 'full'),
    'us_import_started_at', (select started_at from public.us_import_state
                             where singleton and run_id is not null)
  );
$$;

revoke all on function public.import_headroom() from public, anon, authenticated;
grant execute on function public.import_headroom() to service_role;

notify pgrst, 'reload schema';

-- ── Post-migration verification (run manually) ─────────────────────────────
--   select count(*) from public.us_claims;                       -- 0 until the first load
--   select relrowsecurity from pg_class where oid = 'public.us_claims'::regclass;   -- t
--   select has_table_privilege('anon', 'public.us_claims', 'select'),            -- t
--          has_table_privilege('anon', 'public.us_claims', 'insert'),            -- f
--          has_function_privilege('anon', 'public.publish_us_import(uuid)', 'execute');  -- f
--   set role service_role; select public.import_headroom(); reset role;
