-- ============================================================
-- Drill database, Phase 2A: a property's collars, downhole surveys, assays
-- and lithology as rows, loaded in versioned import batches that can be
-- rolled back. The data library (20261025100000) keeps the files as uploaded;
-- this keeps what is in them, so later phases (3D figures, intercepts,
-- release tables) read one set of numbers.
--
-- ROLES (as in 20261023100000_workspaces_properties.sql)
--   viewer  read every row, batch and template of the property's workspace
--   editor  import, roll back an import, save and delete column templates
--   Rows and batches are never written from the browser directly: only
--   drill_import_batch and drill_rollback_batch change them, so every change
--   belongs to a batch and is logged.
--
-- VERSIONING
--   Every row records the batch that wrote it (batch_id). A row is current
--   while superseded_by_batch is null. An import that changes a row (same
--   hole and interval, different values) marks the old row superseded by the
--   new batch and inserts the new one; nothing is deleted. Rows are keyed by
--     collars    hole_id
--     surveys    hole_id, depth_m
--     assays     hole_id, from_m, to_m
--     lithology  hole_id, from_m, to_m
--   An import is a merge: holes and intervals missing from the file are left
--   as they are.
--   Rolling back batch B marks B's own rows superseded by B (a version that
--   lived only inside B) and makes the rows B superseded current again. A
--   later live import that replaced some of B's rows must be rolled back
--   first (drill_import_batches.replaces records which batches an import
--   replaced rows of). Rolled-back batches stay listed, with their rows.
--
-- LIMITS
--   50,000 rows and 32 MB per import, 2,000,000 rows written per property
--   (all batches, history included), and no import while the database is past
--   70% of an 8 GB disk (the ceiling scripts/lib/importHeadroom.mjs uses for
--   the registry imports, after the 2026-10-20 disk-full outage).
--
-- Idempotent: guarded blocks; no statement starts with DROP/TRUNCATE/DELETE.
-- Depends on: 20261023100000_workspaces_properties.sql,
-- 20261025100000_property_files.sql (ws_property_has_content, org_activity
-- constraints).
-- Rollback (nothing else depends on these yet):
--   drop function public.drill_import_batch, public.drill_rollback_batch,
--     public.drill_property_summary, public.drill_save_template and the
--     drill_* helpers; drop table public.drill_lithology, public.drill_assays,
--     public.drill_surveys, public.drill_collars, public.drill_import_batches,
--     public.drill_column_templates; re-run ws_property_has_content and the
--     org_activity constraints from 20261025100000_property_files.sql.
-- ============================================================

-- Fail fast rather than queue behind a long read of org_activity.
set local lock_timeout = '5s';

-- ── 1. Tables ────────────────────────────────────────────────────────────
create table if not exists public.drill_import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('collars', 'surveys', 'assays', 'lithology')),
  filename text check (filename is null or char_length(filename) <= 200),
  -- Source column per field, elements and units, BDL handling, CRS: what the
  -- importer chose, kept so the batch can be explained and repeated.
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  row_count integer not null check (row_count between 1 and 50000),
  rows_written integer not null default 0 check (rows_written >= 0),
  -- The diff as committed: new, changed, unchanged, holes, new_holes, ...
  summary jsonb not null default '{}'::jsonb,
  -- Batches whose rows this one superseded (they cannot be rolled back while
  -- this one stands).
  replaces uuid[] not null default '{}',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete set null
);

create index if not exists drill_import_batches_property_idx on public.drill_import_batches (property_id, created_at desc);
create index if not exists drill_import_batches_org_idx on public.drill_import_batches (org_id);
create index if not exists drill_import_batches_created_by_idx on public.drill_import_batches (created_by);
create index if not exists drill_import_batches_rolled_back_by_idx on public.drill_import_batches (rolled_back_by);

create table if not exists public.drill_collars (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  batch_id uuid not null references public.drill_import_batches(id) on delete cascade,
  superseded_by_batch uuid references public.drill_import_batches(id),
  hole_id text not null check (char_length(hole_id) between 1 and 60),
  x double precision not null,
  y double precision not null,
  z double precision,
  crs text check (crs is null or crs ~ '^EPSG:[0-9]{4,6}$'),
  azimuth double precision check (azimuth is null or azimuth between 0 and 360),
  dip double precision check (dip is null or dip between -90 and 90),
  depth double precision check (depth is null or depth >= 0),
  status text check (status is null or char_length(status) <= 40),
  planned boolean not null default false
);

create table if not exists public.drill_surveys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  batch_id uuid not null references public.drill_import_batches(id) on delete cascade,
  superseded_by_batch uuid references public.drill_import_batches(id),
  hole_id text not null check (char_length(hole_id) between 1 and 60),
  depth_m double precision not null check (depth_m >= 0),
  azimuth double precision check (azimuth is null or azimuth between 0 and 360),
  dip double precision check (dip is null or dip between -90 and 90),
  check (azimuth is not null or dip is not null)
);

-- values: element → number (as stored after BDL handling); bdl: element →
-- the detection limit (or true when the lab gave none) for each value that was
-- below it; units: element → unit (%, ppm, g/t, ppb, ...).
create table if not exists public.drill_assays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  batch_id uuid not null references public.drill_import_batches(id) on delete cascade,
  superseded_by_batch uuid references public.drill_import_batches(id),
  hole_id text not null check (char_length(hole_id) between 1 and 60),
  from_m double precision not null check (from_m >= 0),
  to_m double precision not null,
  sample_id text check (sample_id is null or char_length(sample_id) <= 60),
  "values" jsonb not null default '{}'::jsonb check (jsonb_typeof("values") = 'object'),
  bdl jsonb not null default '{}'::jsonb check (jsonb_typeof(bdl) = 'object'),
  units jsonb not null default '{}'::jsonb check (jsonb_typeof(units) = 'object'),
  check (to_m > from_m)
);

create table if not exists public.drill_lithology (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  batch_id uuid not null references public.drill_import_batches(id) on delete cascade,
  superseded_by_batch uuid references public.drill_import_batches(id),
  hole_id text not null check (char_length(hole_id) between 1 and 60),
  from_m double precision not null check (from_m >= 0),
  to_m double precision not null,
  code text check (code is null or char_length(code) <= 60),
  description text check (description is null or char_length(description) <= 500),
  check (to_m > from_m),
  check (code is not null or description is not null)
);

-- One current row per key; history is unconstrained.
create unique index if not exists drill_collars_current_key on public.drill_collars (property_id, hole_id) where superseded_by_batch is null;
create unique index if not exists drill_surveys_current_key on public.drill_surveys (property_id, hole_id, depth_m) where superseded_by_batch is null;
create unique index if not exists drill_assays_current_key on public.drill_assays (property_id, hole_id, from_m, to_m) where superseded_by_batch is null;
create unique index if not exists drill_lithology_current_key on public.drill_lithology (property_id, hole_id, from_m, to_m) where superseded_by_batch is null;
-- Rollback finds a batch's rows and the rows it superseded; foreign keys get
-- their index (as 20261026100000 did for the rest of the schema).
create index if not exists drill_collars_batch_idx on public.drill_collars (batch_id);
create index if not exists drill_surveys_batch_idx on public.drill_surveys (batch_id);
create index if not exists drill_assays_batch_idx on public.drill_assays (batch_id);
create index if not exists drill_lithology_batch_idx on public.drill_lithology (batch_id);
create index if not exists drill_collars_superseded_idx on public.drill_collars (superseded_by_batch) where superseded_by_batch is not null;
create index if not exists drill_surveys_superseded_idx on public.drill_surveys (superseded_by_batch) where superseded_by_batch is not null;
create index if not exists drill_assays_superseded_idx on public.drill_assays (superseded_by_batch) where superseded_by_batch is not null;
create index if not exists drill_lithology_superseded_idx on public.drill_lithology (superseded_by_batch) where superseded_by_batch is not null;
create index if not exists drill_collars_org_idx on public.drill_collars (org_id);
create index if not exists drill_surveys_org_idx on public.drill_surveys (org_id);
create index if not exists drill_assays_org_idx on public.drill_assays (org_id);
create index if not exists drill_lithology_org_idx on public.drill_lithology (org_id);

-- Saved column mappings, per workspace and kind ("ALS assay export").
create table if not exists public.drill_column_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('collars', 'surveys', 'assays', 'lithology')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) <= 16384),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drill_column_templates_name_key unique (org_id, kind, name)
);

create index if not exists drill_column_templates_created_by_idx on public.drill_column_templates (created_by);

-- ── 2. Row-level security ────────────────────────────────────────────────
-- Members of the workspace read; the membership list is read once per
-- statement ((select auth.uid()) as an initplan, as in 20261026100000), not
-- once per row, because these tables hold hundreds of thousands of rows.
alter table public.drill_import_batches enable row level security;
alter table public.drill_collars enable row level security;
alter table public.drill_surveys enable row level security;
alter table public.drill_assays enable row level security;
alter table public.drill_lithology enable row level security;
alter table public.drill_column_templates enable row level security;
revoke all on table public.drill_import_batches, public.drill_collars, public.drill_surveys,
  public.drill_assays, public.drill_lithology, public.drill_column_templates from anon, authenticated;
grant select on table public.drill_import_batches, public.drill_collars, public.drill_surveys,
  public.drill_assays, public.drill_lithology, public.drill_column_templates to authenticated;
-- Templates are saved through drill_save_template; editors delete them directly.
grant delete on table public.drill_column_templates to authenticated;

do $$
declare t text;
begin
  foreach t in array array['drill_import_batches', 'drill_collars', 'drill_surveys', 'drill_assays', 'drill_lithology', 'drill_column_templates'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Members read ' || t) then
      execute format('create policy %I on public.%I for select to authenticated using '
        || '(org_id in (select m.org_id from public.organization_members m where m.user_id = (select auth.uid())))',
        'Members read ' || t, t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drill_column_templates'
                 and policyname = 'Editors delete drill_column_templates') then
    create policy "Editors delete drill_column_templates" on public.drill_column_templates for delete to authenticated
      using (org_id in (select m.org_id from public.organization_members m
                        where m.user_id = (select auth.uid()) and m.role in ('editor', 'admin', 'owner')));
  end if;
end $$;

-- ── 3. Helpers ───────────────────────────────────────────────────────────
-- A JSON number as a double, or null (not a number, or too large to be a
-- coordinate, depth or grade).
create or replace function public.drill_num(p jsonb)
returns double precision language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'number' and abs(p::numeric) < 1e12 then p::numeric::double precision end
$$;

create or replace function public.drill_table(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case p_kind when 'collars' then 'drill_collars' when 'surveys' then 'drill_surveys'
    when 'assays' then 'drill_assays' when 'lithology' then 'drill_lithology' end
$$;

-- The rows of an import in one shape for every kind: the key (hole_id, k1,
-- k2) and everything else as a canonical jsonb (rec), comparable with
-- drill_current's rec for the same kind.
create or replace function public.drill_incoming(p_kind text, p_rows jsonb)
returns table (ord bigint, hole_id text, k1 double precision, k2 double precision, rec jsonb)
language sql immutable set search_path = '' as $$
  select e.ord, btrim(e.r->>'hole_id'),
    case p_kind when 'surveys' then public.drill_num(e.r->'depth_m')
                when 'assays' then public.drill_num(e.r->'from_m')
                when 'lithology' then public.drill_num(e.r->'from_m') end,
    case when p_kind in ('assays', 'lithology') then public.drill_num(e.r->'to_m') end,
    case p_kind
      when 'collars' then jsonb_strip_nulls(jsonb_build_object(
        'x', public.drill_num(e.r->'x'), 'y', public.drill_num(e.r->'y'), 'z', public.drill_num(e.r->'z'),
        'crs', nullif(btrim(e.r->>'crs'), ''), 'azimuth', public.drill_num(e.r->'azimuth'),
        'dip', public.drill_num(e.r->'dip'), 'depth', public.drill_num(e.r->'depth'),
        'status', nullif(btrim(e.r->>'status'), ''),
        'planned', coalesce(jsonb_typeof(e.r->'planned') = 'boolean' and (e.r->>'planned')::boolean, false)))
      when 'surveys' then jsonb_strip_nulls(jsonb_build_object(
        'azimuth', public.drill_num(e.r->'azimuth'), 'dip', public.drill_num(e.r->'dip')))
      when 'assays' then jsonb_build_object(
        'sample_id', nullif(btrim(e.r->>'sample_id'), ''),
        'values', jsonb_strip_nulls(coalesce(case when jsonb_typeof(e.r->'values') = 'object' then e.r->'values' end, '{}'::jsonb)),
        'bdl', jsonb_strip_nulls(coalesce(case when jsonb_typeof(e.r->'bdl') = 'object' then e.r->'bdl' end, '{}'::jsonb)),
        'units', jsonb_strip_nulls(coalesce(case when jsonb_typeof(e.r->'units') = 'object' then e.r->'units' end, '{}'::jsonb)))
      when 'lithology' then jsonb_strip_nulls(jsonb_build_object(
        'code', nullif(btrim(e.r->>'code'), ''), 'description', nullif(btrim(e.r->>'description'), '')))
    end
  from jsonb_array_elements(p_rows) with ordinality as e(r, ord)
$$;

-- The property's current rows of one kind, in drill_incoming's shape.
create or replace function public.drill_current(p_kind text, p_property uuid)
returns table (id uuid, hole_id text, k1 double precision, k2 double precision, rec jsonb)
language sql stable set search_path = '' as $$
  select c.id, c.hole_id, null::double precision, null::double precision, jsonb_strip_nulls(jsonb_build_object(
      'x', c.x, 'y', c.y, 'z', c.z, 'crs', c.crs, 'azimuth', c.azimuth, 'dip', c.dip, 'depth', c.depth,
      'status', c.status, 'planned', c.planned))
    from public.drill_collars c
    where p_kind = 'collars' and c.property_id = p_property and c.superseded_by_batch is null
  union all
  select s.id, s.hole_id, s.depth_m, null, jsonb_strip_nulls(jsonb_build_object('azimuth', s.azimuth, 'dip', s.dip))
    from public.drill_surveys s
    where p_kind = 'surveys' and s.property_id = p_property and s.superseded_by_batch is null
  union all
  select a.id, a.hole_id, a.from_m, a.to_m, jsonb_build_object('sample_id', a.sample_id, 'values', a."values", 'bdl', a.bdl, 'units', a.units)
    from public.drill_assays a
    where p_kind = 'assays' and a.property_id = p_property and a.superseded_by_batch is null
  union all
  select l.id, l.hole_id, l.from_m, l.to_m, jsonb_strip_nulls(jsonb_build_object('code', l.code, 'description', l.description))
    from public.drill_lithology l
    where p_kind = 'lithology' and l.property_id = p_property and l.superseded_by_batch is null
$$;

-- What is wrong with each row (1-based ord), as the database will refuse it.
-- The browser runs the same checks first (src/utils/drillDb.js) with friendlier
-- wording and the file's own line numbers; these are the guarantee.
create or replace function public.drill_row_errors(p_kind text, p_rows jsonb)
returns table (ord bigint, message text)
language sql immutable set search_path = '' as $$
  -- Each row's numbers read once (null: missing, not a number or out of range).
  with n as (
    select e.ord, e.r, btrim(e.r->>'hole_id') as hole,
      case when p_kind = 'collars' then public.drill_num(e.r->'x') end as x,
      case when p_kind = 'collars' then public.drill_num(e.r->'y') end as y,
      case when p_kind in ('collars', 'surveys') then public.drill_num(e.r->'azimuth') end as az,
      case when p_kind in ('collars', 'surveys') then public.drill_num(e.r->'dip') end as dip,
      case when p_kind = 'collars' then public.drill_num(e.r->'depth') end as depth,
      case when p_kind = 'surveys' then public.drill_num(e.r->'depth_m')
           when p_kind in ('assays', 'lithology') then public.drill_num(e.r->'from_m') end as k1,
      case when p_kind in ('assays', 'lithology') then public.drill_num(e.r->'to_m') end as k2
    from jsonb_array_elements(p_rows) with ordinality as e(r, ord)
  ),
  -- A present value that is not a JSON number (or null) in range.
  bad as (
    select n.ord, m.message
    from n, unnest(array_remove(array[
      case when jsonb_typeof(n.r) <> 'object' then 'not an object' end,
      case when coalesce(n.hole, '') = '' then 'missing hole ID'
           when char_length(n.hole) > 60 then 'hole ID longer than 60 characters' end,
      -- Required numbers.
      case when p_kind = 'collars' and n.x is null then 'x (easting) must be a number' end,
      case when p_kind = 'collars' and n.y is null then 'y (northing) must be a number' end,
      case when p_kind = 'surveys' and n.k1 is null then 'depth must be a number' end,
      case when p_kind in ('assays', 'lithology') and n.k1 is null then 'from must be a number' end,
      case when p_kind in ('assays', 'lithology') and n.k2 is null then 'to must be a number' end,
      -- Optional numbers, when given.
      case when p_kind in ('collars', 'surveys') and (
             (jsonb_typeof(n.r->'azimuth') <> 'null' and n.az is null) or (jsonb_typeof(n.r->'dip') <> 'null' and n.dip is null)
             or (p_kind = 'collars' and ((jsonb_typeof(n.r->'z') <> 'null' and public.drill_num(n.r->'z') is null)
                                         or (jsonb_typeof(n.r->'depth') <> 'null' and n.depth is null))))
           then 'z, azimuth, dip and depth must be numbers' end,
      -- Ranges.
      case when n.az not between 0 and 360 then 'azimuth outside 0 to 360' end,
      case when n.dip not between -90 and 90 then 'dip outside -90 to 90' end,
      case when n.depth < 0 or n.k1 < 0 then 'negative depth' end,
      case when p_kind = 'surveys' and n.az is null and n.dip is null then 'a survey needs an azimuth or a dip' end,
      case when n.k2 <= n.k1 then 'to must be greater than from' end,
      -- Text.
      case when p_kind = 'collars' and jsonb_typeof(n.r->'crs') <> 'null'
             and coalesce(n.r->>'crs', '') !~ '^EPSG:[0-9]{4,6}$' then 'coordinate system must be EPSG:<code>' end,
      case when p_kind = 'collars' and char_length(n.r->>'status') > 40 then 'status longer than 40 characters' end,
      case when p_kind = 'collars' and jsonb_typeof(n.r->'planned') not in ('boolean', 'null') then 'planned must be true or false' end,
      case when p_kind = 'assays' and char_length(n.r->>'sample_id') > 60 then 'sample ID longer than 60 characters' end,
      case when p_kind = 'lithology' and coalesce(btrim(n.r->>'code'), '') = '' and coalesce(btrim(n.r->>'description'), '') = ''
           then 'a lithology interval needs a code or a description' end,
      case when p_kind = 'lithology' and char_length(n.r->>'code') > 60 then 'code longer than 60 characters' end,
      case when p_kind = 'lithology' and char_length(n.r->>'description') > 500 then 'description longer than 500 characters' end,
      -- Assay values: element → number; bdl: element → detection limit or true; units: element → text.
      -- jsonpath, one call per object rather than a subquery per row.
      case when p_kind = 'assays' and jsonb_typeof(n.r->'values') not in ('object', 'null') then 'values must be an object' end,
      case when p_kind = 'assays' and jsonb_typeof(n.r->'values') = 'object' and (
             pg_column_size(n.r->'values') > 8192
             or jsonb_path_exists(n.r->'values', '$.* ? ((@.type() != "number" && @.type() != "null") || (@.type() == "number" && @.abs() >= 1000000000000))')
             or jsonb_path_exists(n.r->'values', '$.keyvalue() ? (@.key == "" || @.key like_regex "^.{41}")'))
           then 'assay values must be numbers (element names up to 40 characters)' end,
      case when p_kind = 'assays' and jsonb_typeof(n.r->'bdl') <> 'null' and (jsonb_typeof(n.r->'bdl') <> 'object'
             or jsonb_path_exists(n.r->'bdl', '$.* ? (@.type() != "number" && @.type() != "boolean" && @.type() != "null")'))
           then 'bdl must map elements to a detection limit' end,
      case when p_kind = 'assays' and jsonb_typeof(n.r->'units') <> 'null' and (jsonb_typeof(n.r->'units') <> 'object'
             or jsonb_path_exists(n.r->'units', '$.* ? ((@.type() != "string" && @.type() != "null") || (@.type() == "string" && @ like_regex "^.{21}"))'))
           then 'units must map elements to a unit' end
    ], null)) as m(message)
  ),
  dup as (
    select n.ord, 'the same ' || case when p_kind = 'collars' then 'hole' when p_kind = 'surveys' then 'hole and depth' else 'hole and interval' end
             || ' appears more than once (first on row ' || min(n.ord) over w || ')' as message,
           row_number() over w as k
    from n
    where n.hole <> '' and (p_kind = 'collars' or n.k1 is not null) and (p_kind not in ('assays', 'lithology') or n.k2 is not null)
    window w as (partition by n.hole, n.k1, n.k2 order by n.ord)
  )
  select ord, message from bad
  union all
  select ord, message from dup where k > 1
$$;

-- ── 4. Import ────────────────────────────────────────────────────────────
-- p_rows: canonical rows (the browser has mapped the columns and handled BDL
-- values), e.g. for assays
--   [{ "hole_id": "R-1", "from_m": 0, "to_m": 1.5, "sample_id": "A001",
--      "values": { "Cu": 0.42, "Au": 0.0025 }, "bdl": { "Au": 0.005 },
--      "units": { "Cu": "%", "Au": "g/t" } }]
-- p_dry_run (default): validate and return the diff; nothing is written.
-- Otherwise commit atomically and return the same diff with the batch id. An
-- import that changes nothing writes nothing ({ nothing_to_do: true }).
-- p_batch: an id chosen by the browser for this commit; sending it again
-- (a retry after a dropped connection) returns the recorded batch instead of
-- importing twice.
create or replace function public.drill_import_batch(
  p_property uuid, p_kind text, p_rows jsonb, p_mapping jsonb default '{}'::jsonb,
  p_filename text default null, p_dry_run boolean default true, p_batch uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  c_max_rows constant integer := 50000;
  c_max_bytes constant bigint := 33554432;
  c_max_property_rows constant bigint := 2000000;
  c_db_ceiling constant bigint := 6012954214; -- 70% of 8 GiB
  v_user uuid := auth.uid();
  v_org uuid;
  v_n integer;
  v_errors jsonb;
  v_error_count integer;
  v_diff jsonb;
  v_changed uuid[];
  v_new integer;
  v_written integer;
  v_replaces uuid[];
  v_batch uuid;
  v_filename text := nullif(left(btrim(coalesce(p_filename, '')), 200), '');
  b public.drill_import_batches;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := public.ws_property_org(p_property);
  if v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, 'editor') then
    raise exception 'ORG_READ_ONLY: viewers cannot import drill data' using errcode = '42501';
  end if;
  if public.drill_table(p_kind) is null then raise exception 'INVALID_KIND: %', p_kind using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID_ROWS: rows must be an array' using errcode = '22023'; end if;
  if p_mapping is not null and (jsonb_typeof(p_mapping) <> 'object' or pg_column_size(p_mapping) > 65536) then
    raise exception 'INVALID_MAPPING' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then raise exception 'EMPTY_IMPORT: the file has no rows' using errcode = '22023'; end if;
  if v_n > c_max_rows then
    raise exception 'BATCH_TOO_LARGE: % rows; one import takes at most 50,000', v_n using errcode = '54000';
  end if;
  if octet_length(p_rows::text) > c_max_bytes then
    raise exception 'BATCH_TOO_LARGE: more than 32 MB of data in one import' using errcode = '54000';
  end if;

  -- A retried commit returns what it recorded the first time.
  if p_batch is not null and not coalesce(p_dry_run, true) then
    select * into b from public.drill_import_batches where id = p_batch;
    if b.id is not null then
      if b.property_id <> p_property then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
      return b.summary || jsonb_build_object('dry_run', false, 'committed', true, 'replayed', true,
        'batch_id', b.id, 'rolled_back', b.rolled_back_at is not null);
    end if;
  end if;

  -- One import or rollback per property at a time, so the diff a commit
  -- reports is the change it makes.
  perform pg_advisory_xact_lock(hashtextextended('drill:' || p_property::text, 0));

  select coalesce(jsonb_agg(jsonb_build_object('row', x.ord, 'message', x.message) order by x.ord, x.message) filter (where x.n <= 50), '[]'::jsonb),
         count(*)
    into v_errors, v_error_count
    from (select r.ord, r.message, row_number() over (order by r.ord, r.message) as n from public.drill_row_errors(p_kind, p_rows) r) x;
  if v_error_count > 0 then
    if coalesce(p_dry_run, true) then
      return jsonb_build_object('ok', false, 'dry_run', true, 'kind', p_kind, 'rows', v_n,
        'errors', v_errors, 'error_count', v_error_count, 'limit', c_max_rows);
    end if;
    raise exception 'INVALID_ROWS: % problems in the rows; check the file first', v_error_count using errcode = '22023';
  end if;

  with i as materialized (select * from public.drill_incoming(p_kind, p_rows)),
  c as materialized (select * from public.drill_current(p_kind, p_property)),
  d as (
    select i.hole_id, i.k1, i.k2, i.rec, c.id as cur_id, c.rec as cur_rec,
           case when c.id is null then 'new' when c.rec = i.rec then 'unchanged' else 'changed' end as status
    from i left join c on c.hole_id = i.hole_id and coalesce(c.k1, -1) = coalesce(i.k1, -1) and coalesce(c.k2, -1) = coalesce(i.k2, -1)
  ),
  holes as (select distinct hole_id from i),
  had as (select distinct hole_id from c),
  collars as materialized (select hole_id from public.drill_current('collars', p_property) where p_kind <> 'collars'),
  no_collar as (select h.hole_id from holes h where p_kind <> 'collars' and not exists (select 1 from collars k where k.hole_id = h.hole_id)),
  -- Intervals in the file that overlap a current interval they do not replace.
  overlap as (
    select distinct i.hole_id from i join c on c.hole_id = i.hole_id
    where p_kind in ('assays', 'lithology') and c.k1 < i.k2 and c.k2 > i.k1 and not (c.k1 = i.k1 and c.k2 = i.k2)
      and not exists (select 1 from i j where j.hole_id = c.hole_id and j.k1 = c.k1 and j.k2 = c.k2)
  )
  select jsonb_build_object(
      'ok', true, 'kind', p_kind, 'rows', v_n, 'limit', c_max_rows, 'errors', '[]'::jsonb, 'error_count', 0,
      'new', (select count(*) from d where status = 'new'),
      'changed', (select count(*) from d where status = 'changed'),
      'unchanged', (select count(*) from d where status = 'unchanged'),
      'holes', (select count(*) from holes),
      'new_holes', (select count(*) from holes h where not exists (select 1 from had x where x.hole_id = h.hole_id)),
      'missing_collars', (select count(*) from no_collar),
      'missing_collar_holes', coalesce((select jsonb_agg(hole_id order by hole_id) from (select hole_id from no_collar order by hole_id limit 10) z), '[]'::jsonb),
      'overlaps_existing', (select count(*) from overlap),
      'overlap_holes', coalesce((select jsonb_agg(hole_id order by hole_id) from (select hole_id from overlap order by hole_id limit 10) z), '[]'::jsonb),
      'changed_sample', coalesce((select jsonb_agg(jsonb_build_object('hole_id', hole_id, 'k1', k1, 'k2', k2, 'before', cur_rec, 'after', rec) order by hole_id, k1, k2)
                                  from (select * from d where status = 'changed' order by hole_id, k1, k2 limit 20) z), '[]'::jsonb)
    ),
    coalesce((select array_agg(cur_id) from d where status = 'changed'), '{}')
    into v_diff, v_changed;

  if coalesce(p_dry_run, true) then
    return v_diff || jsonb_build_object('dry_run', true);
  end if;
  v_new := (v_diff->>'new')::integer + (v_diff->>'changed')::integer;
  if v_new = 0 then
    return v_diff || jsonb_build_object('dry_run', false, 'committed', false, 'nothing_to_do', true);
  end if;

  if (select coalesce(sum(rows_written), 0) from public.drill_import_batches where property_id = p_property) + v_new > c_max_property_rows then
    raise exception 'DRILL_PROPERTY_FULL: this property already holds close to 2,000,000 drill rows' using errcode = '54000';
  end if;
  if pg_database_size(current_database()) > c_db_ceiling then
    raise exception 'DB_HEADROOM: the database is too full to import right now; try again later' using errcode = '53100';
  end if;

  insert into public.drill_import_batches (id, org_id, property_id, kind, filename, mapping, row_count, summary, created_by)
  values (coalesce(p_batch, gen_random_uuid()), v_org, p_property, p_kind, v_filename, coalesce(p_mapping, '{}'::jsonb), v_n, v_diff, v_user)
  returning id into v_batch;

  -- Supersede the rows this import changes, then add every row that is not
  -- already current as it is.
  execute format('select coalesce(array_agg(distinct batch_id), ''{}'') from public.%I where id = any($1)', public.drill_table(p_kind))
    into v_replaces using v_changed;
  execute format('update public.%I set superseded_by_batch = $1 where id = any($2)', public.drill_table(p_kind))
    using v_batch, v_changed;

  if p_kind = 'collars' then
    insert into public.drill_collars (org_id, property_id, batch_id, hole_id, x, y, z, crs, azimuth, dip, depth, status, planned)
    select v_org, p_property, v_batch, i.hole_id, (i.rec->>'x')::double precision, (i.rec->>'y')::double precision,
           (i.rec->>'z')::double precision, i.rec->>'crs', (i.rec->>'azimuth')::double precision, (i.rec->>'dip')::double precision,
           (i.rec->>'depth')::double precision, i.rec->>'status', (i.rec->>'planned')::boolean
    from public.drill_incoming(p_kind, p_rows) i
    where not exists (select 1 from public.drill_collars t where t.property_id = p_property and t.superseded_by_batch is null and t.hole_id = i.hole_id);
  elsif p_kind = 'surveys' then
    insert into public.drill_surveys (org_id, property_id, batch_id, hole_id, depth_m, azimuth, dip)
    select v_org, p_property, v_batch, i.hole_id, i.k1, (i.rec->>'azimuth')::double precision, (i.rec->>'dip')::double precision
    from public.drill_incoming(p_kind, p_rows) i
    where not exists (select 1 from public.drill_surveys t where t.property_id = p_property and t.superseded_by_batch is null
                        and t.hole_id = i.hole_id and t.depth_m = i.k1);
  elsif p_kind = 'assays' then
    insert into public.drill_assays (org_id, property_id, batch_id, hole_id, from_m, to_m, sample_id, "values", bdl, units)
    select v_org, p_property, v_batch, i.hole_id, i.k1, i.k2, i.rec->>'sample_id', i.rec->'values', i.rec->'bdl', i.rec->'units'
    from public.drill_incoming(p_kind, p_rows) i
    where not exists (select 1 from public.drill_assays t where t.property_id = p_property and t.superseded_by_batch is null
                        and t.hole_id = i.hole_id and t.from_m = i.k1 and t.to_m = i.k2);
  else
    insert into public.drill_lithology (org_id, property_id, batch_id, hole_id, from_m, to_m, code, description)
    select v_org, p_property, v_batch, i.hole_id, i.k1, i.k2, i.rec->>'code', i.rec->>'description'
    from public.drill_incoming(p_kind, p_rows) i
    where not exists (select 1 from public.drill_lithology t where t.property_id = p_property and t.superseded_by_batch is null
                        and t.hole_id = i.hole_id and t.from_m = i.k1 and t.to_m = i.k2);
  end if;
  get diagnostics v_written = row_count;

  update public.drill_import_batches set rows_written = v_written, replaces = v_replaces where id = v_batch;

  perform public.log_org_activity(v_org, p_property, 'imported', 'drill_batch', v_batch,
    'Imported ' || to_char(v_n, 'FM999,999,990') || ' ' || public.drill_kind_noun(p_kind, v_n)
      || coalesce(' from "' || left(v_filename, 120) || '"', '')
      || ' (' || to_char((v_diff->>'new')::integer, 'FM999,999,990') || ' new, '
      || to_char((v_diff->>'changed')::integer, 'FM999,999,990') || ' changed'
      || case when (v_diff->>'new_holes')::integer > 0 and p_kind <> 'collars'
              then '; ' || to_char((v_diff->>'new_holes')::integer, 'FM999,999,990') || ' new holes' else '' end || ')',
    jsonb_build_object('kind', p_kind, 'rows', v_n, 'new', v_diff->'new', 'changed', v_diff->'changed', 'new_holes', v_diff->'new_holes'));

  return v_diff || jsonb_build_object('dry_run', false, 'committed', true, 'batch_id', v_batch, 'rows_written', v_written);
end;
$$;

create or replace function public.drill_kind_noun(p_kind text, p_n integer)
returns text language sql immutable set search_path = '' as $$
  select case p_kind
    when 'collars' then case when p_n = 1 then 'collar' else 'collars' end
    when 'surveys' then case when p_n = 1 then 'survey station' else 'survey stations' end
    when 'assays' then case when p_n = 1 then 'assay interval' else 'assay intervals' end
    else case when p_n = 1 then 'lithology interval' else 'lithology intervals' end end
$$;

-- ── 5. Rollback ──────────────────────────────────────────────────────────
-- Withdraws an import: its rows stop being current and the rows it replaced
-- are current again. Nothing is deleted; rolling back twice is a no-op.
create or replace function public.drill_rollback_batch(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_user uuid := auth.uid();
  b public.drill_import_batches;
  v_later public.drill_import_batches;
  v_withdrawn integer;
  v_restored integer;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into b from public.drill_import_batches where id = p_batch;
  if b.id is null or public.ws_property_org(b.property_id) is distinct from b.org_id then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.has_org_role(b.org_id, 'editor') then
    raise exception 'ORG_READ_ONLY: viewers cannot roll back an import' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drill:' || b.property_id::text, 0));
  select * into b from public.drill_import_batches where id = p_batch for update;
  if b.rolled_back_at is not null then
    return jsonb_build_object('batch_id', b.id, 'rolled_back', true, 'already', true, 'withdrawn', 0, 'restored', 0);
  end if;

  select * into v_later from public.drill_import_batches l
  where l.property_id = b.property_id and l.rolled_back_at is null and l.id <> b.id and b.id = any(l.replaces)
  order by l.created_at desc limit 1;
  if v_later.id is not null then
    raise exception 'BATCH_SUPERSEDED: a later import (%, %) changed rows from this one; roll that back first',
      coalesce(v_later.filename, v_later.kind), to_char(v_later.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
      using errcode = 'P0001';
  end if;

  execute format('update public.%I set superseded_by_batch = $1 where batch_id = $1 and superseded_by_batch is null', public.drill_table(b.kind))
    using b.id;
  get diagnostics v_withdrawn = row_count;
  execute format('update public.%I set superseded_by_batch = null where superseded_by_batch = $1 and batch_id <> $1', public.drill_table(b.kind))
    using b.id;
  get diagnostics v_restored = row_count;

  update public.drill_import_batches set rolled_back_at = now(), rolled_back_by = v_user where id = b.id;

  perform public.log_org_activity(b.org_id, b.property_id, 'rolled_back', 'drill_batch', b.id,
    'Rolled back the ' || public.drill_kind_noun(b.kind, 2) || ' import' || coalesce(' of "' || left(b.filename, 120) || '"', '')
      || ' (' || to_char(v_withdrawn, 'FM999,999,990') || ' rows withdrawn, ' || to_char(v_restored, 'FM999,999,990') || ' restored)',
    jsonb_build_object('kind', b.kind, 'withdrawn', v_withdrawn, 'restored', v_restored));

  return jsonb_build_object('batch_id', b.id, 'rolled_back', true, 'already', false, 'withdrawn', v_withdrawn, 'restored', v_restored);
end;
$$;

-- ── 6. Summary ───────────────────────────────────────────────────────────
-- Current counts and the latest 50 imports (with who made them and whether a
-- later import stands in the way of rolling one back).
create or replace function public.drill_property_summary(p_property uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := public.ws_property_org(p_property);
begin
  if auth.uid() is null or v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'collars', (select count(*) from public.drill_collars where property_id = p_property and superseded_by_batch is null),
    'planned', (select count(*) from public.drill_collars where property_id = p_property and superseded_by_batch is null and planned),
    'metres', (select coalesce(round(sum(depth)::numeric, 1), 0) from public.drill_collars
               where property_id = p_property and superseded_by_batch is null and not planned),
    'surveys', (select count(*) from public.drill_surveys where property_id = p_property and superseded_by_batch is null),
    'assays', (select count(*) from public.drill_assays where property_id = p_property and superseded_by_batch is null),
    'lithology', (select count(*) from public.drill_lithology where property_id = p_property and superseded_by_batch is null),
    'holes', (select count(*) from (
        select hole_id from public.drill_collars where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_surveys where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_assays where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_lithology where property_id = p_property and superseded_by_batch is null) h),
    'elements', coalesce((select jsonb_agg(k order by lower(k)) from (
        select distinct k from public.drill_assays a, jsonb_object_keys(a."values") k
        where a.property_id = p_property and a.superseded_by_batch is null) e), '[]'::jsonb),
    'limit', 50000,
    'batches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'filename', b.filename, 'rows', b.row_count, 'rows_written', b.rows_written,
        'summary', b.summary - 'changed_sample', 'mapping', b.mapping, 'created_at', b.created_at,
        'created_by_email', public.ws_user_email(b.created_by),
        'rolled_back_at', b.rolled_back_at, 'rolled_back_by_email', public.ws_user_email(b.rolled_back_by),
        'blocked_by', (select l.id from public.drill_import_batches l where l.property_id = b.property_id
                       and l.rolled_back_at is null and l.id <> b.id and b.id = any(l.replaces) order by l.created_at desc limit 1)
      ) order by b.created_at desc, b.id)
      from (select * from public.drill_import_batches where property_id = p_property order by created_at desc, id limit 50) b), '[]'::jsonb)
  );
end;
$$;

-- ── 7. Column templates ──────────────────────────────────────────────────
-- Saves (or replaces, by name) a column mapping for the workspace.
create or replace function public.drill_save_template(p_org uuid, p_kind text, p_name text, p_mapping jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  t public.drill_column_templates;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, 'viewer') then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.has_org_role(p_org, 'editor') then
    raise exception 'ORG_READ_ONLY: viewers cannot save column templates' using errcode = '42501';
  end if;
  if public.drill_table(p_kind) is null or char_length(v_name) not between 1 and 80
     or p_mapping is null or jsonb_typeof(p_mapping) <> 'object' or pg_column_size(p_mapping) > 16384 then
    raise exception 'INVALID_TEMPLATE' using errcode = '22023';
  end if;
  if (select count(*) from public.drill_column_templates where org_id = p_org) >= 100
     and not exists (select 1 from public.drill_column_templates where org_id = p_org and kind = p_kind and name = v_name) then
    raise exception 'TOO_MANY_TEMPLATES: a workspace keeps at most 100 column templates' using errcode = '54000';
  end if;
  insert into public.drill_column_templates (org_id, kind, name, mapping, created_by)
  values (p_org, p_kind, v_name, p_mapping, auth.uid())
  on conflict (org_id, kind, name) do update set mapping = excluded.mapping, updated_at = now()
  returning * into t;
  return jsonb_build_object('id', t.id, 'org_id', t.org_id, 'kind', t.kind, 'name', t.name, 'mapping', t.mapping, 'updated_at', t.updated_at);
end;
$$;

-- ── 8. Property content and activity ─────────────────────────────────────
-- A property with live drill imports is not empty (blocks its soft delete,
-- as for maps, figures, portfolios and data files).
create or replace function public.ws_property_has_content(p_property uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_org_role((select p.org_id from public.properties p where p.id = p_property), 'viewer') and (
         exists (select 1 from public.projects where property_id = p_property and deleted_at is null)
      or exists (select 1 from public.three_d_projects where property_id = p_property and deleted_at is null)
      or exists (select 1 from public.monitored_portfolios where property_id = p_property)
      or exists (select 1 from public.property_files where property_id = p_property and deleted_at is null)
      or exists (select 1 from public.drill_import_batches where property_id = p_property and rolled_back_at is null))
$$;

-- 'imported' and 'rolled_back' are never folded into log_org_activity's
-- ten-minute debounce, which applies to 'updated' only.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'org_activity_action_check'
             and conrelid = 'public.org_activity'::regclass and pg_get_constraintdef(oid) not like '%rolled_back%') then
    alter table public.org_activity drop constraint org_activity_action_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_activity_action_check'
                 and conrelid = 'public.org_activity'::regclass) then
    alter table public.org_activity add constraint org_activity_action_check
      check (action in ('created', 'updated', 'deleted', 'moved', 'role_changed', 'invited', 'joined', 'removed', 'uploaded',
                        'imported', 'rolled_back'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'org_activity_entity_type_check'
             and conrelid = 'public.org_activity'::regclass and pg_get_constraintdef(oid) not like '%drill_batch%') then
    alter table public.org_activity drop constraint org_activity_entity_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_activity_entity_type_check'
                 and conrelid = 'public.org_activity'::regclass) then
    alter table public.org_activity add constraint org_activity_entity_type_check
      check (entity_type in ('organization', 'property', 'map', 'figure', 'portfolio', 'member', 'invite', 'file', 'drill_batch'));
  end if;
end $$;

-- ── 9. Grants ────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Start from nothing, then grant the four RPCs the browser calls and
-- ws_property_has_content, which properties_guard evaluates as the caller.
do $$
declare f text;
begin
  foreach f in array array[
    'public.drill_num(jsonb)', 'public.drill_table(text)', 'public.drill_incoming(text, jsonb)',
    'public.drill_current(text, uuid)', 'public.drill_row_errors(text, jsonb)', 'public.drill_kind_noun(text, integer)',
    'public.drill_import_batch(uuid, text, jsonb, jsonb, text, boolean, uuid)', 'public.drill_rollback_batch(uuid)',
    'public.drill_property_summary(uuid)', 'public.drill_save_template(uuid, text, text, jsonb)',
    'public.ws_property_has_content(uuid)'
  ] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.drill_import_batch(uuid, text, jsonb, jsonb, text, boolean, uuid)', 'public.drill_rollback_batch(uuid)',
    'public.drill_property_summary(uuid)', 'public.drill_save_template(uuid, text, text, jsonb)',
    'public.ws_property_has_content(uuid)'
  ] loop
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- Verification (run manually after applying):
--   select tablename, policyname, cmd from pg_policies where tablename like 'drill\_%' order by 1, 2;
--   select has_function_privilege('anon', 'public.drill_property_summary(uuid)', 'execute'); -- false
--   select has_function_privilege('authenticated', 'public.drill_incoming(text, jsonb)', 'execute'); -- false
--   select pg_get_constraintdef(oid) from pg_constraint where conname in
--     ('org_activity_action_check', 'org_activity_entity_type_check'); -- include rolled_back, drill_batch
-- ============================================================
