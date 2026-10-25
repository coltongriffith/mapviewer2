-- P2-3: downhole structural point measurements (kind 'structure'); no 3D orientation rendering.
-- Additive, after 20261101120000_drill_alteration.sql: the functions below are its latest
-- definitions with a 'structure' branch added and nothing else changed. Not applied to production.
-- Key is property + hole + depth_m, as for surveys.

create table if not exists public.drill_structure (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  batch_id uuid not null references public.drill_import_batches(id) on delete cascade,
  superseded_by_batch uuid references public.drill_import_batches(id),
  source_row integer not null check (source_row between 1 and 20000),
  hole_id text not null check (char_length(btrim(hole_id)) between 1 and 60),
  depth_m double precision not null check (depth_m >= 0 and depth_m < 1e12),
  type text check (type is null or char_length(btrim(type)) between 1 and 60),
  alpha double precision check (alpha between 0 and 90),
  beta double precision check (beta between 0 and 360),
  dip double precision check (dip between 0 and 90),
  dip_direction double precision check (dip_direction between 0 and 360),
  description text check (description is null or char_length(btrim(description)) between 1 and 500),
  check (beta is null or alpha is not null),
  check (dip_direction is null or dip is not null),
  check (alpha is not null or dip is not null or description is not null)
);
comment on column public.drill_structure.type is 'Source text (fault, vein, foliation, bedding, contact, joint, shear, other or as logged), not an enum.';
comment on column public.drill_structure.alpha is 'Core-axis angle in degrees, 0 to 90; beta (0 to 360) is measured from the orientation line.';
comment on column public.drill_structure.source_row is 'Position in the submitted import array, not worksheet line or chronology; retained with each written version.';
create unique index if not exists drill_structure_current_key on public.drill_structure (property_id, hole_id, depth_m) where superseded_by_batch is null;
create index if not exists drill_structure_batch_idx on public.drill_structure (batch_id);
create index if not exists drill_structure_superseded_idx on public.drill_structure (superseded_by_batch) where superseded_by_batch is not null;
create index if not exists drill_structure_org_idx on public.drill_structure (org_id);
alter table public.drill_structure enable row level security;
revoke all on table public.drill_structure from public, anon, authenticated;
grant select on table public.drill_structure to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drill_structure' and policyname = 'Members read drill_structure') then
    create policy "Members read drill_structure" on public.drill_structure for select to authenticated
      using (org_id in (select m.org_id from public.organization_members m where m.user_id = (select auth.uid())));
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.drill_import_batches'::regclass and conname = 'drill_import_batches_kind_check') then
    alter table public.drill_import_batches drop constraint drill_import_batches_kind_check;
  end if;
  alter table public.drill_import_batches add constraint drill_import_batches_kind_check check (kind in ('collars', 'surveys', 'assays', 'lithology', 'alteration', 'structure'));
  if exists (select 1 from pg_constraint where conrelid = 'public.drill_column_templates'::regclass and conname = 'drill_column_templates_kind_check') then
    alter table public.drill_column_templates drop constraint drill_column_templates_kind_check;
  end if;
  alter table public.drill_column_templates add constraint drill_column_templates_kind_check check (kind in ('collars', 'surveys', 'assays', 'lithology', 'alteration', 'structure'));
end $$;


create or replace function public.drill_table(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case p_kind when 'collars' then 'drill_collars' when 'surveys' then 'drill_surveys'
    when 'assays' then 'drill_assays' when 'lithology' then 'drill_lithology' when 'alteration' then 'drill_alteration'
    when 'structure' then 'drill_structure' end
$$;

create or replace function public.drill_incoming(p_kind text, p_rows jsonb)
returns table (ord bigint, hole_id text, k1 double precision, k2 double precision, rec jsonb)
language sql immutable set search_path = '' as $$
  select e.ord, btrim(e.r->>'hole_id'),
    case p_kind when 'surveys' then public.drill_num(e.r->'depth_m')
                when 'assays' then public.drill_num(e.r->'from_m')
                when 'lithology' then public.drill_num(e.r->'from_m')
                when 'alteration' then public.drill_num(e.r->'from_m')
                when 'structure' then public.drill_num(e.r->'depth_m') end,
    case when p_kind in ('assays', 'lithology', 'alteration') then public.drill_num(e.r->'to_m') end,
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
      when 'alteration' then jsonb_strip_nulls(jsonb_build_object(
        'code', nullif(btrim(e.r->>'code'), ''), 'description', nullif(btrim(e.r->>'description'), ''),
        'intensity', nullif(btrim(e.r->>'intensity'), '')))
      when 'structure' then jsonb_strip_nulls(jsonb_build_object(
        'type', nullif(btrim(e.r->>'type'), ''), 'alpha', public.drill_num(e.r->'alpha'), 'beta', public.drill_num(e.r->'beta'),
        'dip', public.drill_num(e.r->'dip'), 'dip_direction', public.drill_num(e.r->'dip_direction'),
        'description', nullif(btrim(e.r->>'description'), '')))
    end
  from jsonb_array_elements(p_rows) with ordinality as e(r, ord)
$$;

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
  union all
  select a.id, a.hole_id, a.from_m, a.to_m, jsonb_strip_nulls(jsonb_build_object(
    'code', a.code, 'description', a.description, 'intensity', a.intensity))
    from public.drill_alteration a
    where p_kind = 'alteration' and a.property_id = p_property and a.superseded_by_batch is null
  union all
  select s.id, s.hole_id, s.depth_m, null, jsonb_strip_nulls(jsonb_build_object(
    'type', s.type, 'alpha', s.alpha, 'beta', s.beta, 'dip', s.dip, 'dip_direction', s.dip_direction, 'description', s.description))
    from public.drill_structure s
    where p_kind = 'structure' and s.property_id = p_property and s.superseded_by_batch is null
$$;

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
      case when p_kind = 'structure' then public.drill_num(e.r->'alpha') end as alpha,
      case when p_kind = 'structure' then public.drill_num(e.r->'beta') end as beta,
      case when p_kind = 'structure' then public.drill_num(e.r->'dip') end as sdip,
      case when p_kind = 'structure' then public.drill_num(e.r->'dip_direction') end as sdd,
      case when p_kind in ('surveys', 'structure') then public.drill_num(e.r->'depth_m')
           when p_kind in ('assays', 'lithology', 'alteration') then public.drill_num(e.r->'from_m') end as k1,
      case when p_kind in ('assays', 'lithology', 'alteration') then public.drill_num(e.r->'to_m') end as k2
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
      case when p_kind in ('surveys', 'structure') and n.k1 is null then 'depth must be a number' end,
      case when p_kind in ('assays', 'lithology', 'alteration') and n.k1 is null then 'from must be a number' end,
      case when p_kind in ('assays', 'lithology', 'alteration') and n.k2 is null then 'to must be a number' end,
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
      -- Alteration retains textual categories/intensity, including numeric-looking labels.
      case when p_kind = 'alteration' and jsonb_typeof(n.r->'hole_id') <> 'string' then 'hole ID must be text' end,
      case when p_kind = 'alteration' and coalesce(btrim(n.r->>'code'), '') = '' and coalesce(btrim(n.r->>'description'), '') = ''
           then 'an alteration interval needs a code or a description' end,
      case when p_kind = 'alteration' and jsonb_typeof(n.r->'code') not in ('string', 'null') then 'code must be text' end,
      case when p_kind = 'alteration' and jsonb_typeof(n.r->'description') not in ('string', 'null') then 'description must be text' end,
      case when p_kind = 'alteration' and jsonb_typeof(n.r->'intensity') not in ('string', 'null') then 'intensity must be text' end,
      case when p_kind = 'alteration' and char_length(btrim(n.r->>'code')) > 60 then 'code longer than 60 characters' end,
      case when p_kind = 'alteration' and char_length(btrim(n.r->>'description')) > 500 then 'description longer than 500 characters' end,
      case when p_kind = 'alteration' and char_length(btrim(n.r->>'intensity')) > 60 then 'intensity longer than 60 characters' end,
      -- Structure: point measurements; type and description stay source text.
      case when p_kind = 'structure' and jsonb_typeof(n.r->'hole_id') <> 'string' then 'hole ID must be text' end,
      case when p_kind = 'structure' and (
             (jsonb_typeof(n.r->'alpha') <> 'null' and n.alpha is null) or (jsonb_typeof(n.r->'beta') <> 'null' and n.beta is null)
             or (jsonb_typeof(n.r->'dip') <> 'null' and n.sdip is null) or (jsonb_typeof(n.r->'dip_direction') <> 'null' and n.sdd is null))
           then 'alpha, beta, dip and dip direction must be numbers' end,
      case when n.alpha not between 0 and 90 then 'alpha outside 0 to 90' end,
      case when n.beta not between 0 and 360 then 'beta outside 0 to 360' end,
      case when n.sdip not between 0 and 90 then 'dip outside 0 to 90' end,
      case when n.sdd not between 0 and 360 then 'dip direction outside 0 to 360' end,
      case when p_kind = 'structure' and n.beta is not null and n.alpha is null then 'beta needs an alpha' end,
      case when p_kind = 'structure' and n.sdd is not null and n.sdip is null then 'dip direction needs a dip' end,
      case when p_kind = 'structure' and coalesce(jsonb_typeof(n.r->'alpha'), 'null') = 'null' and coalesce(jsonb_typeof(n.r->'dip'), 'null') = 'null'
             and coalesce(btrim(n.r->>'description'), '') = ''
           then 'a structure needs an alpha, a dip or a description' end,
      case when p_kind = 'structure' and jsonb_typeof(n.r->'type') not in ('string', 'null') then 'type must be text' end,
      case when p_kind = 'structure' and jsonb_typeof(n.r->'description') not in ('string', 'null') then 'description must be text' end,
      case when p_kind = 'structure' and char_length(btrim(n.r->>'type')) > 60 then 'type longer than 60 characters' end,
      case when p_kind = 'structure' and char_length(btrim(n.r->>'description')) > 500 then 'description longer than 500 characters' end,
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
    select n.ord, 'the same ' || case when p_kind = 'collars' then 'hole' when p_kind in ('surveys', 'structure') then 'hole and depth' else 'hole and interval' end
             || ' appears more than once (first on row ' || min(n.ord) over w || ')' as message,
           row_number() over w as k
    from n
    where n.hole <> '' and (p_kind = 'collars' or n.k1 is not null) and (p_kind not in ('assays', 'lithology', 'alteration') or n.k2 is not null)
    window w as (partition by n.hole, n.k1, n.k2 order by n.ord)
  )
  select ord, message from bad
  union all
  select ord, message from dup where k > 1
$$;

create or replace function public.drill_import_batch(
  p_property uuid, p_kind text, p_rows jsonb, p_mapping jsonb default '{}'::jsonb,
  p_filename text default null, p_dry_run boolean default true, p_batch uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  c_max_rows constant integer := 20000;
  c_max_bytes constant bigint := 13631488; -- 13 MB
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
    raise exception 'BATCH_TOO_LARGE: % rows; one import takes at most 20,000. Split files over 20,000 rows', v_n using errcode = '54000';
  end if;
  if octet_length(p_rows::text) > c_max_bytes then
    raise exception 'BATCH_TOO_LARGE: more than 13 MB of data in one import. Split the file' using errcode = '54000';
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
    where p_kind in ('assays', 'lithology', 'alteration') and c.k1 < i.k2 and c.k2 > i.k1 and not (c.k1 = i.k1 and c.k2 = i.k2)
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
  elsif p_kind = 'lithology' then
    insert into public.drill_lithology (org_id, property_id, batch_id, hole_id, from_m, to_m, code, description)
    select v_org, p_property, v_batch, i.hole_id, i.k1, i.k2, i.rec->>'code', i.rec->>'description'
    from public.drill_incoming(p_kind, p_rows) i
    where not exists (select 1 from public.drill_lithology t where t.property_id = p_property and t.superseded_by_batch is null
                        and t.hole_id = i.hole_id and t.from_m = i.k1 and t.to_m = i.k2);
  elsif p_kind = 'alteration' then
    insert into public.drill_alteration (org_id, property_id, batch_id, source_row, hole_id, from_m, to_m, code, description, intensity)
    select v_org, p_property, v_batch, i.ord, i.hole_id, i.k1, i.k2, i.rec->>'code', i.rec->>'description', i.rec->>'intensity'
    from public.drill_incoming(p_kind, p_rows) i
    where not exists (select 1 from public.drill_alteration t where t.property_id = p_property and t.superseded_by_batch is null
                        and t.hole_id = i.hole_id and t.from_m = i.k1 and t.to_m = i.k2);
  elsif p_kind = 'structure' then
    insert into public.drill_structure (org_id, property_id, batch_id, source_row, hole_id, depth_m, type, alpha, beta, dip, dip_direction, description)
    select v_org, p_property, v_batch, i.ord, i.hole_id, i.k1, i.rec->>'type', (i.rec->>'alpha')::double precision, (i.rec->>'beta')::double precision,
           (i.rec->>'dip')::double precision, (i.rec->>'dip_direction')::double precision, i.rec->>'description'
    from public.drill_incoming(p_kind, p_rows) i
    where not exists (select 1 from public.drill_structure t where t.property_id = p_property and t.superseded_by_batch is null
                        and t.hole_id = i.hole_id and t.depth_m = i.k1);
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
    when 'lithology' then case when p_n = 1 then 'lithology interval' else 'lithology intervals' end
    when 'alteration' then case when p_n = 1 then 'alteration interval' else 'alteration intervals' end
    when 'structure' then case when p_n = 1 then 'structure measurement' else 'structure measurements' end end
$$;

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
    'alteration', (select count(*) from public.drill_alteration where property_id = p_property and superseded_by_batch is null),
    'structure', (select count(*) from public.drill_structure where property_id = p_property and superseded_by_batch is null),
    'holes', (select count(*) from (
        select hole_id from public.drill_collars where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_surveys where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_assays where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_lithology where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_alteration where property_id = p_property and superseded_by_batch is null
        union select hole_id from public.drill_structure where property_id = p_property and superseded_by_batch is null) h),
    'elements', coalesce((select jsonb_agg(k order by lower(k)) from (
        select distinct k from public.drill_assays a, jsonb_object_keys(a."values") k
        where a.property_id = p_property and a.superseded_by_batch is null) e), '[]'::jsonb),
    'limit', 20000,
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



-- drill_rollback_batch and drill_save_template use drill_table's allowlist and are unchanged.
-- ws_property_has_content (QA migration) is untouched: live drill batches already protect structure data.
revoke all on function public.drill_table(text), public.drill_incoming(text,jsonb), public.drill_current(text,uuid),
  public.drill_row_errors(text,jsonb), public.drill_kind_noun(text,integer) from public, anon, authenticated;
revoke all on function public.drill_import_batch(uuid,text,jsonb,jsonb,text,boolean,uuid), public.drill_property_summary(uuid) from public, anon, authenticated;
grant execute on function public.drill_import_batch(uuid,text,jsonb,jsonb,text,boolean,uuid), public.drill_property_summary(uuid) to authenticated;

-- Rollback: hide the structure importer and keep this additive schema, batches and history.
-- Reverse a data import with drill_rollback_batch, newest dependent batch first. Do not drop
-- a populated table or restore the old kind checks/functions while structure batches/templates exist.
notify pgrst, 'reload schema';
