-- ============================================================
-- Property data library, Phase 1B: shared data files that belong to a
-- property (drill collars, surveys, assays and lithology CSVs, claims and
-- targets as GeoJSON/KML/zipped SHP, geophysics, documents), each with a
-- numbered history of versions. 3D figures reference a library file and
-- version instead of keeping a private copy, so a new version can reach every
-- figure that uses it. Files are stored as uploaded; nothing is parsed into
-- tables here (the drill database is Phase 2).
--
-- ROLES (as in 20261023100000_workspaces_properties.sql)
--   viewer  list and download
--   editor  add files and upload new versions
--   admin   + soft-delete (and restore) a file
--
-- WRITES
--   A file and each new version are recorded by add_property_file_version(),
--   after the browser has uploaded the bytes to the private bucket
--   property-files at <org>/<property>/<file>/v<version>/<filename>. The RPC
--   numbers versions, checks the object is there and skips an upload whose
--   SHA-256 matches the current version. Versions and their objects are never
--   changed or removed from the browser. Ownership (org_id, property_id) and
--   the version counter never change through a plain UPDATE: only name, kind,
--   role and deleted_at are writable, and deleted_at only by admins.
--
-- Idempotent: guarded blocks; no statement starts with DROP/TRUNCATE/DELETE.
-- Depends on: 20261023100000_workspaces_properties.sql.
-- ============================================================

-- ── 1. Tables ────────────────────────────────────────────────────────────
create table if not exists public.property_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  kind text not null default 'other' check (kind in ('drill', 'claims', 'layer', 'geophysics', 'document', 'other')),
  -- A hint for what the file holds within its kind: collars, surveys, assays, lith, ...
  role text check (role is null or role ~ '^[a-z][a-z0-9_]{0,29}$'),
  current_version integer not null default 0 check (current_version >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists property_files_property_idx on public.property_files (property_id, name) where deleted_at is null;
create index if not exists property_files_org_idx on public.property_files (org_id);

create table if not exists public.property_file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.property_files(id) on delete cascade,
  version integer not null check (version >= 1),
  storage_path text not null check (char_length(storage_path) <= 400),
  bytes bigint not null check (bytes between 0 and 104857600),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500),
  constraint property_file_versions_file_version_key unique (file_id, version)
);

-- ── 2. Row-level security ────────────────────────────────────────────────
-- Members read live files (admins also deleted ones, to restore them);
-- versions are visible exactly when their file is.
alter table public.property_files enable row level security;
alter table public.property_file_versions enable row level security;
revoke all on table public.property_files, public.property_file_versions from anon, authenticated;
grant select on table public.property_files, public.property_file_versions to authenticated;
grant update (name, kind, role, deleted_at) on table public.property_files to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'property_files'
                 and policyname = 'Members read property files') then
    create policy "Members read property files" on public.property_files for select to authenticated
      using (public.has_org_role(org_id, 'viewer') and (deleted_at is null or public.has_org_role(org_id, 'admin')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'property_files'
                 and policyname = 'Editors update property files') then
    create policy "Editors update property files" on public.property_files for update to authenticated
      using (public.has_org_role(org_id, 'editor') and (deleted_at is null or public.has_org_role(org_id, 'admin')))
      with check (public.has_org_role(org_id, 'editor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'property_file_versions'
                 and policyname = 'Members read property file versions') then
    create policy "Members read property file versions" on public.property_file_versions for select to authenticated
      using (exists (select 1 from public.property_files f where f.id = file_id));
  end if;
end $$;

-- Deleting (or restoring) a file is an admin decision, as for properties.
-- Runs as the caller so current_user tells a browser UPDATE from the RPC.
create or replace function public.property_files_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and new.deleted_at is distinct from old.deleted_at
     and not public.has_org_role(old.org_id, 'admin') then
    raise exception 'forbidden: only an owner or admin can delete a data file' using errcode = '42501';
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'property_files_guard' and tgrelid = 'public.property_files'::regclass) then
    create trigger property_files_guard before update on public.property_files
      for each row execute function public.property_files_guard();
  end if;
end $$;

-- A property with live data files is not empty (blocks its soft delete, as
-- for maps, figures and portfolios). Same function, one more kind of content.
create or replace function public.ws_property_has_content(p_property uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_org_role((select p.org_id from public.properties p where p.id = p_property), 'viewer') and (
         exists (select 1 from public.projects where property_id = p_property and deleted_at is null)
      or exists (select 1 from public.three_d_projects where property_id = p_property and deleted_at is null)
      or exists (select 1 from public.monitored_portfolios where property_id = p_property)
      or exists (select 1 from public.property_files where property_id = p_property and deleted_at is null))
$$;

-- ── 3. Storage ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('property-files', 'property-files', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Organization of an object named <org>/<property>/<file>/v<n>/<filename>
-- whose property is a live property of that organization the caller belongs
-- to; null for any other name, including "." / ".." segments.
create or replace function public.ws_library_org(p_name text)
returns uuid language sql stable set search_path = '' as $$
  select case
    when p_name is null or p_name ~ '(^|/)\.\.?(/|$)' or p_name like '%\\%'
      or p_name !~ '^[^/]+/[^/]+/[^/]+/v[1-9][0-9]{0,5}/[^/]{1,200}$'
      or public.ws_uuid(split_part(p_name, '/', 3)) is null then null
    when public.ws_property_org(public.ws_uuid(split_part(p_name, '/', 2))) = public.ws_uuid(split_part(p_name, '/', 1))
      then public.ws_uuid(split_part(p_name, '/', 1))
  end
$$;

-- Read by members, written once by editors. No update or delete: a version's
-- bytes never change, and an upload the RPC did not record is harmless.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Members read property files') then
    create policy "Members read property files" on storage.objects for select to authenticated
      using (bucket_id = 'property-files' and public.has_org_role(public.ws_library_org(name), 'viewer'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Editors upload property files') then
    create policy "Editors upload property files" on storage.objects for insert to authenticated
      with check (bucket_id = 'property-files' and public.has_org_role(public.ws_library_org(name), 'editor'));
  end if;
end $$;

-- ── 4. Writes and reads ──────────────────────────────────────────────────
-- Records a new file (p_file not seen before) or a new version of one, once
-- its bytes are in storage at <org>/<property>/<file>/v<next>/<filename>.
-- p_name, p_kind and p_role apply to a new file only. The same SHA-256 as
-- the current version returns { unchanged: true } and records nothing.
create or replace function public.add_property_file_version(
  p_property uuid, p_file uuid, p_name text, p_kind text, p_role text,
  p_path text, p_bytes bigint, p_sha256 text, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  f public.property_files;
  v_version integer;
  v_prefix text;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := public.ws_property_org(p_property);
  if v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, 'editor') then
    raise exception 'ORG_READ_ONLY: viewers cannot upload data files' using errcode = '42501';
  end if;
  if p_file is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_bytes is null or p_bytes < 0 or p_bytes > 104857600 then
    raise exception 'invalid file' using errcode = '22023';
  end if;

  select * into f from public.property_files where id = p_file for update;
  if f.id is not null then
    if f.property_id <> p_property or f.deleted_at is not null then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.property_file_versions v
               where v.file_id = f.id and v.version = f.current_version and v.sha256 = p_sha256) then
      return jsonb_build_object('file_id', f.id, 'version', f.current_version, 'unchanged', true);
    end if;
    v_version := f.current_version + 1;
  else
    v_version := 1;
  end if;

  v_prefix := v_org::text || '/' || p_property::text || '/' || p_file::text || '/v';
  if p_path is null or left(p_path, length(v_prefix)) <> v_prefix or public.ws_library_org(p_path) is distinct from v_org then
    raise exception 'FILE_PATH_UNEXPECTED: the upload is outside this file''s folder' using errcode = 'P0001';
  end if;
  if split_part(p_path, '/', 4) <> 'v' || v_version then
    raise exception 'VERSION_CONFLICT: someone else uploaded a version of this file just now' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'property-files' and o.name = p_path) then
    raise exception 'FILE_NOT_UPLOADED: % is not in storage yet', p_path using errcode = 'P0001';
  end if;

  if f.id is null then
    insert into public.property_files (id, org_id, property_id, name, kind, role, current_version, created_by)
    values (p_file, v_org, p_property, btrim(coalesce(p_name, '')), coalesce(p_kind, 'other'),
            nullif(btrim(coalesce(p_role, '')), ''), 0, v_user);
  end if;
  insert into public.property_file_versions (file_id, version, storage_path, bytes, sha256, uploaded_by, note)
  values (p_file, v_version, p_path, p_bytes, p_sha256, v_user, nullif(btrim(coalesce(p_note, '')), ''));
  update public.property_files set current_version = v_version where id = p_file;
  return jsonb_build_object('file_id', p_file, 'version', v_version, 'unchanged', false);
end;
$$;

-- A property's live files with their current version and who uploaded it.
create or replace function public.list_property_files(p_property uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := public.ws_property_org(p_property);
begin
  if v_org is null or not public.has_org_role(v_org, 'viewer') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'kind', f.kind, 'role', f.role, 'version', f.current_version,
      'created_at', f.created_at, 'updated_at', f.updated_at,
      'path', v.storage_path, 'bytes', v.bytes, 'sha256', v.sha256, 'note', v.note,
      'uploaded_at', v.created_at, 'uploaded_by_email', public.ws_user_email(v.uploaded_by)
    ) order by lower(f.name), f.id)
    from public.property_files f
    join public.property_file_versions v on v.file_id = f.id and v.version = f.current_version
    where f.property_id = p_property and f.org_id = v_org and f.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

-- ── 5. Activity ──────────────────────────────────────────────────────────
-- A new version is 'uploaded', so it is never folded into the ten-minute
-- debounce log_org_activity applies to 'updated'.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'org_activity_action_check'
             and conrelid = 'public.org_activity'::regclass and pg_get_constraintdef(oid) not like '%uploaded%') then
    alter table public.org_activity drop constraint org_activity_action_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_activity_action_check'
                 and conrelid = 'public.org_activity'::regclass) then
    alter table public.org_activity add constraint org_activity_action_check
      check (action in ('created', 'updated', 'deleted', 'moved', 'role_changed', 'invited', 'joined', 'removed', 'uploaded'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'org_activity_entity_type_check'
             and conrelid = 'public.org_activity'::regclass and pg_get_constraintdef(oid) not like '%''file''%') then
    alter table public.org_activity drop constraint org_activity_entity_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_activity_entity_type_check'
                 and conrelid = 'public.org_activity'::regclass) then
    alter table public.org_activity add constraint org_activity_entity_type_check
      check (entity_type in ('organization', 'property', 'map', 'figure', 'portfolio', 'member', 'invite', 'file'));
  end if;
end $$;

create or replace function public.ws_activity_files()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  f public.property_files;
begin
  if tg_table_name = 'property_file_versions' then
    select * into f from public.property_files where id = new.file_id;
    if new.version = 1 then
      perform public.log_org_activity(f.org_id, f.property_id, 'created', 'file', f.id,
        'Added data file "' || left(f.name, 120) || '"', jsonb_build_object('version', 1, 'bytes', new.bytes));
    else
      perform public.log_org_activity(f.org_id, f.property_id, 'uploaded', 'file', f.id,
        'Uploaded version ' || new.version || ' of "' || left(f.name, 120) || '"',
        jsonb_build_object('version', new.version, 'bytes', new.bytes));
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    perform public.log_org_activity(new.org_id, new.property_id, 'deleted', 'file', new.id,
      'Deleted data file "' || left(new.name, 120) || '"');
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform public.log_org_activity(new.org_id, new.property_id, 'updated', 'file', new.id,
      'Restored data file "' || left(new.name, 120) || '"', jsonb_build_object('restored', true));
  elsif new.name is distinct from old.name then
    perform public.log_org_activity(new.org_id, new.property_id, 'updated', 'file', new.id,
      'Renamed data file "' || left(old.name, 120) || '" to "' || left(new.name, 120) || '"');
  end if;
  return null;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.property_file_versions'::regclass) then
    create trigger ws_activity after insert on public.property_file_versions
      for each row execute function public.ws_activity_files();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ws_activity' and tgrelid = 'public.property_files'::regclass) then
    create trigger ws_activity after update on public.property_files
      for each row execute function public.ws_activity_files();
  end if;
end $$;

-- ── 6. Grants ────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Start from nothing, then grant what the browser calls and what
-- the storage policies evaluate as the caller (ws_library_org).
do $$
declare f text;
begin
  foreach f in array array[
    'public.property_files_guard()', 'public.ws_property_has_content(uuid)', 'public.ws_library_org(text)',
    'public.add_property_file_version(uuid, uuid, text, text, text, text, bigint, text, text)',
    'public.list_property_files(uuid)', 'public.ws_activity_files()'
  ] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.ws_property_has_content(uuid)', 'public.ws_library_org(text)',
    'public.add_property_file_version(uuid, uuid, text, text, text, text, bigint, text, text)',
    'public.list_property_files(uuid)'
  ] loop
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

-- ============================================================
-- Verification (run manually after applying):
--   select policyname, cmd from pg_policies where tablename in ('property_files', 'property_file_versions')
--     or (schemaname = 'storage' and policyname like '%property files%');
--   select id, public, file_size_limit from storage.buckets where id = 'property-files'; -- false, 104857600
--   select has_function_privilege('anon', 'public.list_property_files(uuid)', 'execute'); -- false
-- ============================================================
