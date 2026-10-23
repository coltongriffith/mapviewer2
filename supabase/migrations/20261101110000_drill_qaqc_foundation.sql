-- QA/QC register foundation; NOT APPLIED. Independent of production assay intervals.
-- Created with Supabase CLI then ordered after the repository's Oct 31 migrations.
-- Samples are identified by property + lab_id + lab_batch_id + sample_id.
-- CRM definitions are immutable per property + crm_id + revision + element + unit.
-- Only these RPCs write; RLS exposes read-only rows to workspace members.
set local lock_timeout = '5s';

create table if not exists public.drill_qaqc_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('samples', 'crms')),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  request_hash text not null,
  row_count integer not null check (row_count between 1 and 5000),
  rows_written integer not null check (rows_written > 0),
  summary jsonb not null,
  depends_on uuid[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete set null
);
create table if not exists public.drill_crm_values (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  batch_id uuid not null references public.drill_qaqc_batches(id),
  superseded_by_batch uuid references public.drill_qaqc_batches(id),
  source_row integer not null check (source_row between 1 and 5000),
  record_key text not null,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  crm_id text generated always as (record->>'crm_id') stored,
  revision text generated always as (record->>'revision') stored,
  element text generated always as (record->>'element') stored,
  unit text generated always as (record->>'unit') stored
);
create table if not exists public.drill_qaqc_samples (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  batch_id uuid not null references public.drill_qaqc_batches(id),
  superseded_by_batch uuid references public.drill_qaqc_batches(id),
  source_row integer not null check (source_row between 1 and 5000),
  record_key text not null,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  lab_id text generated always as (record->>'lab_id') stored,
  lab_batch_id text generated always as (record->>'lab_batch_id') stored,
  sample_id text generated always as (record->>'sample_id') stored,
  sample_type text generated always as (record->>'sample_type') stored,
  -- Snapshots of exact versions, never a join to whichever parent/CRM is latest.
  parent_version_id uuid references public.drill_qaqc_samples(id),
  crm_version_ids uuid[] not null default '{}'
);

do $$
declare t text;
begin
  foreach t in array array['drill_qaqc_batches', 'drill_qaqc_samples', 'drill_crm_values'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_idx', t);
    execute format('create index if not exists %I on public.%I (property_id)', t || '_property_idx', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Members read ' || t) then
      execute format('create policy %I on public.%I for select to authenticated using '
        || '(org_id in (select m.org_id from public.organization_members m where m.user_id = (select auth.uid())))', 'Members read ' || t, t);
    end if;
    if t <> 'drill_qaqc_batches' then
      execute format('create unique index if not exists %I on public.%I (property_id, record_key) where superseded_by_batch is null', t || '_current_key', t);
      execute format('create index if not exists %I on public.%I (batch_id)', t || '_batch_idx', t);
      execute format('create index if not exists %I on public.%I (superseded_by_batch)', t || '_superseded_idx', t);
    end if;
  end loop;
end $$;
create index if not exists drill_qaqc_batches_created_by_idx on public.drill_qaqc_batches(created_by);
create index if not exists drill_qaqc_batches_rolled_back_by_idx on public.drill_qaqc_batches(rolled_back_by);
create index if not exists drill_qaqc_samples_parent_idx on public.drill_qaqc_samples(parent_version_id);

-- Strict validation is server-side, including direct RPC callers. No unit conversion,
-- BDL substitution, guessed sample types, or fabricated intervals.
create or replace function public.drill_qaqc_validate(p_kind text, r jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; allowed text[]; required text[];
begin
  if jsonb_typeof(r) is distinct from 'object' then return 'row must be an object'; end if;
  if p_kind = 'crms' then
    required := array['crm_id','revision','element','unit','source'];
    allowed := required || array['expected','sd'];
  elsif p_kind = 'samples' then
    required := array['lab_id','lab_batch_id','sample_id','sample_type'];
    allowed := required || array['parent_sample_id','crm_id','crm_revision','hole_id','from_m','to_m','values','units','bdl','raw_values'];
  else return 'invalid kind'; end if;
  if exists (select 1 from jsonb_object_keys(r) x where not (x = any(allowed))) then return 'unknown field'; end if;
  foreach k in array required loop
    if jsonb_typeof(r->k) is distinct from 'string' or length(btrim(r->>k)) = 0 or length(r->>k) > (case when k = 'source' then 1000 else 120 end) then
      return k || ' must be nonempty text within its length limit';
    end if;
  end loop;
  if p_kind = 'crms' then
    if public.drill_num(r->'expected') is null or public.drill_num(r->'expected') < 0 then return 'expected must be a nonnegative number'; end if;
    if public.drill_num(r->'sd') is null or public.drill_num(r->'sd') <= 0 then return 'sd must be a positive number'; end if;
    return null;
  end if;
  if r->>'sample_type' not in ('routine','standard','blank','field_dup','coarse_dup','pulp_dup') then return 'invalid sample_type'; end if;
  foreach k in array array['parent_sample_id','crm_id','crm_revision','hole_id'] loop
    if r ? k and (jsonb_typeof(r->k) is distinct from 'string' or length(btrim(r->>k)) = 0 or length(r->>k) > 120) then return k || ' must be nonempty text'; end if;
  end loop;
  if r->>'sample_type' in ('field_dup','coarse_dup','pulp_dup') then
    if not (r ? 'parent_sample_id') or r->>'parent_sample_id' = r->>'sample_id' then return 'duplicate requires a different parent_sample_id'; end if;
  elsif r ? 'parent_sample_id' then return 'only duplicates have parent_sample_id'; end if;
  if r->>'sample_type' = 'standard' then
    if not (r ? 'crm_id' and r ? 'crm_revision') then return 'standard requires crm_id and crm_revision'; end if;
  elsif r ? 'crm_id' or r ? 'crm_revision' then return 'only standards have a CRM'; end if;
  if r ? 'from_m' or r ? 'to_m' then
    if not (r ? 'hole_id') or public.drill_num(r->'from_m') is null or public.drill_num(r->'to_m') is null
      or public.drill_num(r->'from_m') < 0 or public.drill_num(r->'to_m') <= public.drill_num(r->'from_m') then return 'interval requires hole_id and valid from_m/to_m'; end if;
  end if;
  foreach k in array array['values','units','bdl','raw_values'] loop
    if jsonb_typeof(r->k) is distinct from 'object' then return k || ' must be an object'; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(r->'values')) not between 1 and 64 then return 'values requires 1 to 64 elements'; end if;
  for k, v in select * from jsonb_each(r->'values') loop
    if length(btrim(k)) = 0 or length(k) > 30 then return 'invalid element'; end if;
    if v <> 'null'::jsonb and (public.drill_num(v) is null or public.drill_num(v) < 0) then return 'values must be nonnegative numbers or null'; end if;
    if jsonb_typeof(r->'units'->k) is distinct from 'string' or length(btrim(r->'units'->>k)) not between 1 and 30 then return 'every value requires a unit'; end if;
    if jsonb_typeof(r->'raw_values'->k) is distinct from 'string' or length(r->'raw_values'->>k) not between 1 and 100 then return 'every value requires its raw lab text'; end if;
    if v = 'null'::jsonb and not (r->'bdl' ? k) then return 'null value requires a BDL flag'; end if;
  end loop;
  if exists (select 1 from jsonb_object_keys((r->'units') || (r->'raw_values') || (r->'bdl')) x where not (r->'values' ? x)) then return 'metadata contains an unknown element'; end if;
  for k, v in select * from jsonb_each(r->'bdl') loop
    if v <> 'true'::jsonb and (public.drill_num(v) is null or public.drill_num(v) <= 0) then return 'BDL must be true or a positive detection limit'; end if;
  end loop;
  return null;
end $$;

create or replace function public.drill_qaqc_key(p_kind text, r jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when p_kind = 'samples' then jsonb_build_array(r->>'lab_id',r->>'lab_batch_id',r->>'sample_id')::text
    else jsonb_build_array(r->>'crm_id',r->>'revision',r->>'element',r->>'unit')::text end
$$;

-- SECURITY DEFINER is intentional: clients cannot bypass versioning by writing
-- tables directly. Each RPC checks identity/property/editor membership, pins its
-- search_path, and has PUBLIC/anon execution revoked below.
create or replace function public.drill_qaqc_import(p_property uuid, p_kind text, p_rows jsonb,
  p_provenance jsonb default '{}', p_dry_run boolean default true, p_batch uuid default null)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  org uuid; tab text; r jsonb; k text; msg text; n integer; seq integer := 0;
  fresh integer := 0; changed integer := 0; unchanged integer := 0;
  old_record jsonb; old_id uuid; old_batch uuid; bid uuid; parent_id uuid; refs uuid[];
  dependencies uuid[] := '{}'; result jsonb; fingerprint text; b public.drill_qaqc_batches;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  org := public.ws_property_org(p_property);
  if org is null or not public.has_org_role(org, 'viewer') then raise exception 'PROPERTY_NOT_FOUND'; end if;
  if not public.has_org_role(org, 'editor') then raise exception 'ORG_READ_ONLY' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('samples','crms') then raise exception 'INVALID_KIND'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'INVALID_ROWS'; end if;
  n := jsonb_array_length(p_rows);
  if n not between 1 and 5000 or octet_length(p_rows::text) > 4000000 then raise exception 'BATCH_TOO_LARGE_OR_EMPTY'; end if;
  if jsonb_typeof(p_provenance) is distinct from 'object' or octet_length(p_provenance::text) > 16384 then raise exception 'INVALID_PROVENANCE'; end if;
  -- Same property lock as existing drill imports; no race with other batch changes.
  perform pg_advisory_xact_lock(hashtextextended('drill:' || p_property::text, 0));
  fingerprint := md5(jsonb_build_object('kind',p_kind,'rows',p_rows,'provenance',p_provenance)::text);
  if p_batch is not null and not coalesce(p_dry_run,true) then
    select * into b from public.drill_qaqc_batches where id = p_batch;
    if b.id is not null then
      if b.property_id <> p_property then raise exception 'BATCH_NOT_FOUND'; end if;
      if b.request_hash <> fingerprint then raise exception 'BATCH_ID_REUSED'; end if;
      return b.summary || jsonb_build_object('batch_id',b.id,'committed',true,'replayed',true,'rolled_back',b.rolled_back_at is not null);
    end if;
  end if;
  tab := case p_kind when 'samples' then 'drill_qaqc_samples' else 'drill_crm_values' end;
  for r in select value from jsonb_array_elements(p_rows) loop
    seq := seq + 1;
    msg := public.drill_qaqc_validate(p_kind,r);
    if msg is not null then raise exception 'INVALID_ROW %: %', seq,msg; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_rows) x group by public.drill_qaqc_key(p_kind,x) having count(*) > 1) then raise exception 'DUPLICATE_KEY'; end if;
  -- Validate/diff first; no permanent writes before every row passes.
  for r in select value from jsonb_array_elements(p_rows) loop
    k := public.drill_qaqc_key(p_kind,r);
    execute format('select record,id,batch_id from public.%I where property_id=$1 and record_key=$2 and superseded_by_batch is null',tab)
      into old_record,old_id,old_batch using p_property,k;
    if p_kind = 'crms' and exists (select 1 from public.drill_crm_values c where c.property_id=p_property and c.record_key=k and c.record <> r) then
      raise exception 'CRM_REVISION_IMMUTABLE: use a new revision';
    end if;
    if old_id is null then fresh := fresh+1;
    elsif old_record = r then
      unchanged := unchanged+1;
      -- No row is written, so this batch must not acquire its dependencies.
      -- Existing parent/CRM version references and their original batch remain
      -- authoritative, even if a newer parent is now current.
      continue;
    else changed := changed+1; dependencies := array_append(dependencies,old_batch); end if;
    if p_kind = 'samples' and r ? 'parent_sample_id' then
      -- Parent must already be imported; no order-dependent/circular pairing.
      select s.id,s.batch_id into parent_id,old_batch from public.drill_qaqc_samples s
        where s.property_id=p_property and s.lab_id=r->>'lab_id' and s.lab_batch_id=r->>'lab_batch_id'
          and s.sample_id=r->>'parent_sample_id' and s.sample_type='routine' and s.superseded_by_batch is null;
      if parent_id is null then raise exception 'PARENT_NOT_FOUND: import routine parent first in the same lab batch'; end if;
      if exists(select 1 from jsonb_array_elements(p_rows) x where x->>'sample_id'=r->>'parent_sample_id'
        and x->>'lab_id'=r->>'lab_id' and x->>'lab_batch_id'=r->>'lab_batch_id') then raise exception 'PARENT_IN_SAME_IMPORT: import parents separately'; end if;
      dependencies := array_append(dependencies,old_batch);
    end if;
    if p_kind = 'samples' and r->>'sample_type' = 'standard' then
      for k in select jsonb_object_keys(r->'values') loop
        select c.batch_id into old_batch from public.drill_crm_values c where c.property_id=p_property and c.superseded_by_batch is null
          and c.crm_id=r->>'crm_id' and c.revision=r->>'crm_revision' and c.element=k and c.unit=r->'units'->>k;
        if old_batch is null then raise exception 'CRM_NOT_FOUND: exact revision, element and unit required'; end if;
        dependencies := array_append(dependencies,old_batch);
      end loop;
    end if;
  end loop;
  result := jsonb_build_object('ok',true,'kind',p_kind,'rows',n,'new',fresh,'changed',changed,'unchanged',unchanged,'dry_run',coalesce(p_dry_run,true));
  if coalesce(p_dry_run,true) then return result; end if;
  if fresh+changed=0 then return result || jsonb_build_object('committed',false,'nothing_to_do',true); end if;
  if (select coalesce(sum(rows_written),0) from public.drill_qaqc_batches where property_id=p_property)+fresh+changed > 200000 then raise exception 'QAQC_PROPERTY_FULL'; end if;
  if pg_database_size(current_database()) > 6012954214 then raise exception 'DB_HEADROOM'; end if;
  bid := coalesce(p_batch,gen_random_uuid());
  insert into public.drill_qaqc_batches(id,org_id,property_id,kind,provenance,request_hash,row_count,rows_written,summary,depends_on,created_by)
    values(bid,org,p_property,p_kind,p_provenance,fingerprint,n,fresh+changed,result,
      array(select distinct d from unnest(dependencies) d where d is not null),auth.uid());
  seq := 0;
  for r in select value from jsonb_array_elements(p_rows) loop
    seq := seq+1;
    k := public.drill_qaqc_key(p_kind,r);
    execute format('select record,id from public.%I where property_id=$1 and record_key=$2 and superseded_by_batch is null',tab)
      into old_record,old_id using p_property,k;
    if old_id is not null and old_record = r then continue; end if;
    execute format('update public.%I set superseded_by_batch=$1 where id=$2',tab) using bid,old_id;
    if p_kind = 'crms' then
      insert into public.drill_crm_values(org_id,property_id,batch_id,source_row,record_key,record) values(org,p_property,bid,seq,k,r);
    else
      select s.id into parent_id from public.drill_qaqc_samples s where s.property_id=p_property and s.lab_id=r->>'lab_id'
        and s.lab_batch_id=r->>'lab_batch_id' and s.sample_id=r->>'parent_sample_id' and s.superseded_by_batch is null;
      select coalesce(array_agg(c.id order by c.element),'{}') into refs from public.drill_crm_values c where c.property_id=p_property
        and c.crm_id=r->>'crm_id' and c.revision=r->>'crm_revision' and c.superseded_by_batch is null
        and r->'values' ? c.element and c.unit=r->'units'->>c.element;
      insert into public.drill_qaqc_samples(org_id,property_id,batch_id,source_row,record_key,record,parent_version_id,crm_version_ids)
        values(org,p_property,bid,seq,k,r,parent_id,refs);
    end if;
  end loop;
  perform public.log_org_activity(org,p_property,'imported','drill_batch',bid,'Imported QA/QC ' || p_kind,
    jsonb_build_object('register','qaqc','kind',p_kind,'rows_written',fresh+changed));
  return result || jsonb_build_object('committed',true,'batch_id',bid,'rows_written',fresh+changed);
end $$;

create or replace function public.drill_qaqc_rollback(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare b public.drill_qaqc_batches; tab text; withdrawn integer; restored integer;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode='42501'; end if;
  select * into b from public.drill_qaqc_batches where id=p_batch;
  if b.id is null or public.ws_property_org(b.property_id) is distinct from b.org_id or not public.has_org_role(b.org_id,'viewer') then raise exception 'BATCH_NOT_FOUND'; end if;
  if not public.has_org_role(b.org_id,'editor') then raise exception 'ORG_READ_ONLY' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('drill:' || b.property_id::text,0));
  select * into b from public.drill_qaqc_batches where id=p_batch for update;
  if b.rolled_back_at is not null then return jsonb_build_object('rolled_back',true,'already',true); end if;
  if exists(select 1 from public.drill_qaqc_batches where property_id=b.property_id and rolled_back_at is null and b.id=any(depends_on)) then
    raise exception 'BATCH_DEPENDENCY: roll back dependent imports first';
  end if;
  tab := case b.kind when 'samples' then 'drill_qaqc_samples' else 'drill_crm_values' end;
  execute format('update public.%I set superseded_by_batch=$1 where batch_id=$1 and superseded_by_batch is null',tab) using b.id;
  get diagnostics withdrawn=row_count;
  execute format('update public.%I set superseded_by_batch=null where superseded_by_batch=$1 and batch_id<>$1',tab) using b.id;
  get diagnostics restored=row_count;
  update public.drill_qaqc_batches set rolled_back_at=now(),rolled_back_by=auth.uid() where id=b.id;
  perform public.log_org_activity(b.org_id,b.property_id,'rolled_back','drill_batch',b.id,'Rolled back QA/QC ' || b.kind,
    jsonb_build_object('register','qaqc','withdrawn',withdrawn,'restored',restored));
  return jsonb_build_object('rolled_back',true,'already',false,'withdrawn',withdrawn,'restored',restored);
end $$;

-- Preserve the existing property-deletion guard, adding live QA/QC imports.
create or replace function public.ws_property_has_content(p_property uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_org_role((select p.org_id from public.properties p where p.id=p_property),'viewer') and (
    exists(select 1 from public.projects where property_id=p_property and deleted_at is null)
    or exists(select 1 from public.three_d_projects where property_id=p_property and deleted_at is null)
    or exists(select 1 from public.monitored_portfolios where property_id=p_property)
    or exists(select 1 from public.property_files where property_id=p_property and deleted_at is null)
    or exists(select 1 from public.drill_import_batches where property_id=p_property and rolled_back_at is null)
    or exists(select 1 from public.drill_qaqc_batches where property_id=p_property and rolled_back_at is null))
$$;
revoke all on function public.drill_qaqc_validate(text,jsonb), public.drill_qaqc_key(text,jsonb),
  public.drill_qaqc_import(uuid,text,jsonb,jsonb,boolean,uuid), public.drill_qaqc_rollback(uuid) from public,anon,authenticated;
grant execute on function public.drill_qaqc_import(uuid,text,jsonb,jsonb,boolean,uuid), public.drill_qaqc_rollback(uuid) to authenticated;

-- Schema rollback: before any imports, remove the QA/QC RPCs/helpers and then
-- the samples, CRM values and batch tables in dependency order; restore
-- ws_property_has_content from 20261027100000_drill_database.sql, preserving
-- its existing grants. After any imports, preserve/export all register data
-- and version history and use an owner-reviewed forward fix instead of dropping
-- tables. drill_qaqc_rollback withdraws batches while retaining their history;
-- it is not a schema rollback. See docs/drill-qaqc-foundation.md.
notify pgrst, 'reload schema';
