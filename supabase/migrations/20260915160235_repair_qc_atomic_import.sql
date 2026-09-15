-- Compact, service-only staging. Large JSON batches use PostgreSQL TOAST compression.
-- The public qc_claims table and its indexes/RLS remain intact across publication.
create table public.qc_import_state (
  singleton boolean primary key default true check (singleton),
  run_id uuid, expected_rows integer, started_at timestamptz, baseline_rows integer
);
insert into public.qc_import_state(singleton) values(true);
create table public.qc_import_batches (
  run_id uuid not null, batch_no integer not null check(batch_no >= 0),
  rows jsonb not null check(jsonb_typeof(rows) = 'array'),
  primary key(run_id,batch_no)
);
alter table public.qc_import_state enable row level security;
alter table public.qc_import_batches enable row level security;
revoke all on public.qc_import_state, public.qc_import_batches from public,anon,authenticated;
grant all on public.qc_import_state, public.qc_import_batches to service_role;

create function public.begin_qc_import(p_expected_rows integer) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.qc_import_state; v_run uuid := gen_random_uuid();
begin
  select * into s from public.qc_import_state where singleton for update;
  if p_expected_rows not between 100000 and 400000 then raise exception 'Unexpected active-title count'; end if;
  if s.run_id is not null and s.started_at > now()-interval '2 hours' then raise exception 'Quebec import already running'; end if;
  if s.baseline_rows is not null and (p_expected_rows < s.baseline_rows*0.8 or p_expected_rows > s.baseline_rows*1.2) then raise exception 'Active-title count changed by more than 20 percent'; end if;
  truncate public.qc_import_batches;
  update public.qc_import_state set run_id=v_run,expected_rows=p_expected_rows,started_at=now() where singleton;
  return v_run;
end $$;

create function public.stage_qc_import_batch(p_run_id uuid,p_batch_no integer,p_rows jsonb) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.qc_import_state; n integer;
begin
  select * into s from public.qc_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then raise exception 'Stale import'; end if;
  n:=jsonb_array_length(p_rows);
  if p_batch_no < 0 or p_batch_no >= ceil(s.expected_rows/1000.0) or n <> least(1000,s.expected_rows-p_batch_no*1000) then raise exception 'Invalid batch size or number'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where coalesce(r->>'status','') not in ('Active','Actif','Suspended','Suspendu','Renewal Pending','En attente de renouvellement') or coalesce(r->>'tag_number','')='' or coalesce(r->'geometry'->>'type','') not in ('Polygon','MultiPolygon')) then raise exception 'Invalid or non-active title'; end if;
  insert into public.qc_import_batches values(p_run_id,p_batch_no,p_rows)
    on conflict(run_id,batch_no) do update set rows=excluded.rows;
  return n;
end $$;

create function public.publish_qc_import(p_run_id uuid) returns integer
language plpgsql security invoker set search_path=public,pg_temp set lock_timeout='5s' as $$
declare s public.qc_import_state; n integer; batches integer;
begin
  select * into s from public.qc_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then raise exception 'Stale import'; end if;
  select coalesce(sum(jsonb_array_length(rows)),0),count(*) into n,batches from public.qc_import_batches where run_id=p_run_id;
  if n<>s.expected_rows or batches<>ceil(s.expected_rows/1000.0) then raise exception 'Incomplete staged import'; end if;
  -- TRUNCATE + INSERT is one transaction. Any failure rolls both back.
  truncate public.qc_claims restart identity;
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

create function public.abort_qc_import(p_run_id uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.qc_import_state;
begin
  select * into s from public.qc_import_state where singleton for update;
  if p_run_id is null or s.run_id is distinct from p_run_id then return false; end if;
  truncate public.qc_import_batches;
  update public.qc_import_state set run_id=null,expected_rows=null,started_at=null where singleton;
  return true;
end $$;
revoke all on function public.begin_qc_import(integer),public.stage_qc_import_batch(uuid,integer,jsonb),public.publish_qc_import(uuid),public.abort_qc_import(uuid) from public,anon,authenticated;
grant execute on function public.begin_qc_import(integer),public.stage_qc_import_batch(uuid,integer,jsonb),public.publish_qc_import(uuid),public.abort_qc_import(uuid) to service_role;
revoke execute on function public.truncate_qc_claims() from public,anon,authenticated;
notify pgrst,'reload schema';
