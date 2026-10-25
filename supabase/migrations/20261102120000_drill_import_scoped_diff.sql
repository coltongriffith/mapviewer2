-- P2-9 follow-up: drill_import_batch's diff no longer materializes every
-- current row of the property. At about 1,000,000 current assays a 20,000-row
-- import spent more than the 8 s statement timeout building drill_current for
-- the whole property (docs/drill-scale-test.md on claude/p2-scale-test).
--
-- drill_current_for_holes is drill_current (latest: 20261102110000_drill_structure.sql)
-- limited to a list of holes, so each kind is read through its current-key
-- partial index (property_id, hole_id, ...) where superseded_by_batch is null.
-- drill_import_batch is 20261102110000_drill_structure.sql's definition with
-- only its diff CTEs changed: the current rows and the collar lookup cover the
-- file's holes. Its result fields and what a commit writes are unchanged.
-- drill_current stays as it was for anything else that reads it.
--
-- Idempotent (create or replace only). Not applied to production.
-- Depends on: 20261102100000_drill_collar_source_coords.sql, 20261102110000_drill_structure.sql.

create or replace function public.drill_current_for_holes(p_kind text, p_property uuid, p_holes text[])
returns table (id uuid, hole_id text, k1 double precision, k2 double precision, rec jsonb)
language sql stable set search_path = '' as $$
  select c.id, c.hole_id, null::double precision, null::double precision, jsonb_strip_nulls(jsonb_build_object(
      'x', c.x, 'y', c.y, 'z', c.z, 'crs', c.crs, 'azimuth', c.azimuth, 'dip', c.dip, 'depth', c.depth,
      'status', c.status, 'planned', c.planned, 'x_src', c.x_src, 'y_src', c.y_src, 'crs_src', c.crs_src, 'transform', c.transform))
    from public.drill_collars c
    where p_kind = 'collars' and c.property_id = p_property and c.superseded_by_batch is null and c.hole_id = any(p_holes)
  union all
  select s.id, s.hole_id, s.depth_m, null, jsonb_strip_nulls(jsonb_build_object('azimuth', s.azimuth, 'dip', s.dip))
    from public.drill_surveys s
    where p_kind = 'surveys' and s.property_id = p_property and s.superseded_by_batch is null and s.hole_id = any(p_holes)
  union all
  select a.id, a.hole_id, a.from_m, a.to_m, jsonb_build_object('sample_id', a.sample_id, 'values', a."values", 'bdl', a.bdl, 'units', a.units)
    from public.drill_assays a
    where p_kind = 'assays' and a.property_id = p_property and a.superseded_by_batch is null and a.hole_id = any(p_holes)
  union all
  select l.id, l.hole_id, l.from_m, l.to_m, jsonb_strip_nulls(jsonb_build_object('code', l.code, 'description', l.description))
    from public.drill_lithology l
    where p_kind = 'lithology' and l.property_id = p_property and l.superseded_by_batch is null and l.hole_id = any(p_holes)
  union all
  select a.id, a.hole_id, a.from_m, a.to_m, jsonb_strip_nulls(jsonb_build_object(
    'code', a.code, 'description', a.description, 'intensity', a.intensity))
    from public.drill_alteration a
    where p_kind = 'alteration' and a.property_id = p_property and a.superseded_by_batch is null and a.hole_id = any(p_holes)
  union all
  select s.id, s.hole_id, s.depth_m, null, jsonb_strip_nulls(jsonb_build_object(
    'type', s.type, 'alpha', s.alpha, 'beta', s.beta, 'dip', s.dip, 'dip_direction', s.dip_direction, 'description', s.description))
    from public.drill_structure s
    where p_kind = 'structure' and s.property_id = p_property and s.superseded_by_batch is null and s.hole_id = any(p_holes)
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

  -- The diff reads only the current rows of the holes in the file (one
  -- current-key index range per hole), not every current row of the property.
  -- Rows of other holes cannot match, overlap or make a hole "had", so every
  -- count and sample below is the same as against the whole property.
  with i as materialized (select * from public.drill_incoming(p_kind, p_rows)),
  holes as materialized (select distinct hole_id from i),
  c as materialized (select * from public.drill_current_for_holes(p_kind, p_property, (select array_agg(hole_id) from holes))),
  d as (
    select i.hole_id, i.k1, i.k2, i.rec, c.id as cur_id, c.rec as cur_rec,
           case when c.id is null then 'new' when c.rec - 'transform' = i.rec - 'transform' then 'unchanged' else 'changed' end as status
    from i left join c on c.hole_id = i.hole_id and coalesce(c.k1, -1) = coalesce(i.k1, -1) and coalesce(c.k2, -1) = coalesce(i.k2, -1)
  ),
  had as (select distinct hole_id from c),
  -- Current collars looked up by key for the file's holes only.
  no_collar as (select h.hole_id from holes h where p_kind <> 'collars' and not exists (
    select 1 from public.drill_collars k where k.property_id = p_property and k.superseded_by_batch is null and k.hole_id = h.hole_id)),
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
      -- Also tells the importer this database stores source coordinates.
      'source_coordinates', (select count(*) from i where i.rec ? 'x_src'),
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
    insert into public.drill_collars (org_id, property_id, batch_id, hole_id, x, y, z, crs, azimuth, dip, depth, status, planned, x_src, y_src, crs_src, transform)
    select v_org, p_property, v_batch, i.hole_id, (i.rec->>'x')::double precision, (i.rec->>'y')::double precision,
           (i.rec->>'z')::double precision, i.rec->>'crs', (i.rec->>'azimuth')::double precision, (i.rec->>'dip')::double precision,
           (i.rec->>'depth')::double precision, i.rec->>'status', (i.rec->>'planned')::boolean,
           (i.rec->>'x_src')::double precision, (i.rec->>'y_src')::double precision, i.rec->>'crs_src', i.rec->'transform'
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

revoke all on function public.drill_current_for_holes(text,uuid,text[]) from public, anon, authenticated;
revoke all on function public.drill_import_batch(uuid,text,jsonb,jsonb,text,boolean,uuid) from public, anon, authenticated;
grant execute on function public.drill_import_batch(uuid,text,jsonb,jsonb,text,boolean,uuid) to authenticated;

-- Rollback: re-run 20261102110000_drill_structure.sql's drill_import_batch definition;
-- drill_current_for_holes is then unused and harmless.
notify pgrst, 'reload schema';
