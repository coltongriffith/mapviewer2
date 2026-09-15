create or replace function public.publish_qc_import(p_run_id uuid) returns integer
language plpgsql security invoker set search_path=public,pg_temp set lock_timeout='5s' as $$
declare s public.qc_import_state; n integer; batches integer;
begin
  select * into s from public.qc_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then raise exception 'Stale import'; end if;
  select coalesce(sum(jsonb_array_length(rows)),0),count(*) into n,batches from public.qc_import_batches where run_id=p_run_id;
  if n<>s.expected_rows or batches<>ceil(s.expected_rows/1000.0) then raise exception 'Incomplete staged import'; end if;
  -- TRUNCATE + INSERT is one transaction. Any failure rolls both back.
  -- Continue the sequence: service_role may insert/truncate but does not own it.
  truncate public.qc_claims continue identity;
  insert into public.qc_claims(tag_number,owner_name,status,good_to_date,area_hectares,title_type,geometry,source_updated_at)
    select r.tag_number,r.owner_name,r.status,r.good_to_date,r.area_hectares,r.title_type,r.geometry,r.source_updated_at
    from public.qc_import_batches b cross join lateral jsonb_to_recordset(b.rows) as r(tag_number text,owner_name text,status text,good_to_date date,area_hectares numeric,title_type text,geometry jsonb,source_updated_at date)
    where b.run_id=p_run_id;
  get diagnostics n=row_count;
  if n<>s.expected_rows or exists(select 1 from public.qc_claims where geom is null or not st_coveredby(geom,st_makeenvelope(-81,43,-56,64,4326))) then raise exception 'Publication validation failed'; end if;
  truncate public.qc_import_batches;
  update public.qc_import_state set run_id=null,expected_rows=null,started_at=null,baseline_rows=n where singleton;
  return n;
end $$;
