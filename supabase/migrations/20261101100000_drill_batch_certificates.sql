-- Generated with `supabase migration new drill_batch_certificates`, then moved
-- after the repository's existing future-dated migrations (through 20261031).
-- Additive only. Apply separately after review; no production application implied.
-- Immutable PDF provenance for assay import batches. Rollback retains these links.
create table if not exists public.drill_batch_files (
  batch_id uuid not null references public.drill_import_batches(id) on delete cascade,
  file_id uuid not null,
  version integer not null,
  name text not null,
  sha256 text not null,
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  retracted_at timestamptz,
  retracted_by uuid references auth.users(id) on delete set null,
  retraction_reason text check (retraction_reason is null or char_length(btrim(retraction_reason)) between 1 and 500),
  primary key (batch_id, file_id, version),
  foreign key (file_id, version) references public.property_file_versions(file_id, version)
);
create index if not exists drill_batch_files_version_idx on public.drill_batch_files(file_id, version);
create index if not exists drill_batch_files_linked_by_idx on public.drill_batch_files(linked_by);
create index if not exists drill_batch_files_retracted_by_idx on public.drill_batch_files(retracted_by);
alter table public.drill_batch_files enable row level security;
revoke all on public.drill_batch_files from public, anon, authenticated;
grant select on public.drill_batch_files to authenticated;
grant insert (batch_id, file_id, version) on public.drill_batch_files to authenticated;
grant update (retraction_reason) on public.drill_batch_files to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='drill_batch_files' and policyname='Members read batch certificates') then
    create policy "Members read batch certificates" on public.drill_batch_files for select to authenticated
      using (exists (select 1 from public.drill_import_batches b where b.id = batch_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='drill_batch_files' and policyname='Editors retract batch certificates') then
    create policy "Editors retract batch certificates" on public.drill_batch_files for update to authenticated
      using (exists (select 1 from public.drill_import_batches b where b.id = batch_id and public.has_org_role(b.org_id, 'editor') and public.ws_property_org(b.property_id) = b.org_id))
      with check (exists (select 1 from public.drill_import_batches b where b.id = batch_id and public.has_org_role(b.org_id, 'editor') and public.ws_property_org(b.property_id) = b.org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='drill_batch_files' and policyname='Editors link batch certificates') then
    create policy "Editors link batch certificates" on public.drill_batch_files for insert to authenticated
      with check (linked_by = (select auth.uid()) and exists (
        select 1 from public.drill_import_batches b join public.property_files f on f.property_id = b.property_id and f.org_id = b.org_id
        where b.id = batch_id and f.id = file_id and b.kind = 'assays' and b.rolled_back_at is null
          and f.deleted_at is null and public.ws_property_org(b.property_id) = b.org_id
          and public.has_org_role(b.org_id, 'editor')));
  end if;
end $$;

-- Invoker: all referenced metadata remains subject to the caller's RLS.
-- Only these three input columns are writable. Snapshot fields come from the DB.
create or replace function public.drill_batch_file_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare b public.drill_import_batches; f public.property_files; v public.property_file_versions;
begin
  -- Allow internal foreign-key ON DELETE SET NULL when an account is removed.
  if tg_op = 'UPDATE' and current_user not in ('authenticated', 'anon') then return new; end if;
  if auth.uid() is null then raise exception 'CERTIFICATE_NOT_FOUND' using errcode='42501'; end if;
  select * into b from public.drill_import_batches where id = new.batch_id;
  if b.id is null or not public.has_org_role(b.org_id, 'editor') then
    raise exception 'CERTIFICATE_NOT_FOUND' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drill:' || b.property_id::text, 0));
  select * into b from public.drill_import_batches where id = new.batch_id;
  if tg_op = 'UPDATE' then
    if old.retracted_at is not null or new.retraction_reason is null or char_length(btrim(new.retraction_reason)) not between 1 and 500 then
      raise exception 'CERTIFICATE_RETRACTION_INVALID' using errcode='22023';
    end if;
    new.retraction_reason := btrim(new.retraction_reason);
    new.retracted_at := now();
    new.retracted_by := auth.uid();
    return new;
  end if;
  select * into f from public.property_files where id = new.file_id for share;
  select * into v from public.property_file_versions where file_id = new.file_id and version = new.version;
  if b.kind <> 'assays' or b.rolled_back_at is not null or public.ws_property_org(b.property_id) is distinct from b.org_id
     or f.id is null or f.property_id <> b.property_id or f.org_id <> b.org_id or f.deleted_at is not null
     or v.id is null or v.storage_path !~* '\.pdf$' then
    raise exception 'CERTIFICATE_NOT_FOUND' using errcode='42501';
  end if;
  new.name := f.name;
  new.sha256 := v.sha256;
  new.linked_by := auth.uid();
  new.linked_at := now();
  return new;
end $$;
revoke all on function public.drill_batch_file_guard() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='drill_batch_file_guard' and tgrelid='public.drill_batch_files'::regclass) then
    create trigger drill_batch_file_guard before insert or update on public.drill_batch_files
      for each row execute function public.drill_batch_file_guard();
  end if;
end $$;

-- Never returns a path for a deleted file, even to admins. Historical name/hash
-- stay readable to the batch's members. Existing Storage policies are unchanged.
create or replace function public.drill_batch_certificates(p_batch uuid)
returns table(file_id uuid, version integer, name text, sha256 text, linked_at timestamptz, storage_path text, retracted_at timestamptz, retraction_reason text)
language sql stable security invoker set search_path = '' as $$
  select l.file_id, l.version, l.name, l.sha256, l.linked_at,
    case when f.deleted_at is null and f.id is not null then v.storage_path else null end,
    l.retracted_at, l.retraction_reason
  from public.drill_batch_files l
  left join public.property_files f on f.id = l.file_id
  left join public.property_file_versions v on v.file_id = f.id and v.version = l.version
  where l.batch_id = p_batch order by l.linked_at, l.file_id, l.version
$$;
revoke all on function public.drill_batch_certificates(uuid) from public, anon, authenticated;
grant execute on function public.drill_batch_certificates(uuid) to authenticated;
notify pgrst, 'reload schema';

-- Application rollback: revert the certificate UI/client while retaining this
-- additive table and its audit history. Existing imports do not depend on it.
-- Any eventual schema removal requires a separate reviewed archival plan;
-- do not delete immutable provenance as part of an application rollback.
