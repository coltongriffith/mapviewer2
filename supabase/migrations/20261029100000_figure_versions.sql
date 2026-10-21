-- ============================================================
-- Published figure versions, Phase 5A: an audit trail of what was released.
--
-- "Publish version" freezes a saved 3D figure (or a saved 2D map) as it is in
-- the database at that moment: its full settings and file list (a map: its
-- payload), a label and release date ("News release 2026-10-21"), who
-- published it, when, and a SHA-256 of the snapshot. A version never changes
-- afterwards, whatever happens to the figure: later edits, a move to another
-- property, a soft or hard delete. Release packs (Phase 5B) will point at
-- these rows.
--
-- THE SNAPSHOT IS COPIED BY THE SERVER
--   publish_figure_version copies the CURRENT saved row; the browser only
--   names the figure, the label and the date, so it cannot forge what was
--   released. p_expected_updated_at (the save the browser has on screen)
--   refuses a publish when the saved row has moved on since (VERSION_STALE).
--   snapshot (figure): { kind, id, name, settings, file_paths, files, saved_at }
--     settings and file_paths verbatim from three_d_projects, so the figure
--     opens with the design version it was saved with (design-version.js);
--     files: [{ path, size, etag }] from storage.objects at publish time.
--   snapshot (map):    { kind, id, name, payload, revision, saved_at }
--   content_hash = sha256 of the snapshot's jsonb text (canonical: jsonb keeps
--   one key order), computed in the same statement.
--
-- 3D DATA FILES
--   The raw CSV/OBJ text stays in the three-d-files bucket, where every save
--   already writes a folder of its own and never overwrites a file. A
--   version lists the objects it uses (file_names); two RESTRICTIVE policies
--   on storage.objects then refuse to delete or replace any of them, so the
--   browser's best-effort clean-up after a save or a move simply leaves them.
--   Only files inside the figure's own folder can be frozen
--   (VERSION_FILES_UNEXPECTED), so nobody can pin someone else's files.
--
-- WHO SEES A VERSION
--   Whoever could read the figure when it was published, recorded on the row:
--   a personal figure's owner (owner_id), or the members of its company
--   (org_id, any role). That is also who can read its files, which stay in
--   the folder they were published from. A figure moved later keeps its
--   earlier versions where they were published.
--   Publishing: a personal figure's owner; an editor or above for a company
--   figure (logged in org_activity as 'published').
--
-- IMMUTABLE
--   No insert, update or delete for the API roles (select only); inserts come
--   from the RPC alone. A trigger refuses every UPDATE except the foreign
--   keys' own "set null" (published_by, property_id) and every DELETE except
--   the cascade when the version's home is gone (its organization, or the
--   account of a personal version).
--
-- LIMITS
--   8 MB a snapshot (as save_cloud_project), 300 KB thumbnail (as
--   three_d_projects), 200 data files, 200 versions a figure, 60 publishes
--   per user per hour.
--
-- Additive and idempotent: guarded blocks; no statement starts with
-- DROP/TRUNCATE/DELETE. Existing figures, maps, shares and their RPCs are
-- untouched.
-- Depends on: 20261022100000_three_d_projects.sql,
-- 20261023100000_workspaces_properties.sql (has_org_role, log_org_activity,
-- ws_figure_root, ws_user_email), 20261027100000_drill_database.sql (the
-- org_activity action list this extends).
-- Rollback (nothing depends on these yet):
--   drop policy "Published version files are kept" on storage.objects;
--   drop policy "Published version files are not replaced" on storage.objects;
--   drop function public.publish_figure_version(text, uuid, text, date, timestamptz),
--     public.list_figure_versions(text, uuid), public.figure_version_file(text, text),
--     public.figure_versions_immutable();
--   drop table public.figure_versions;
--   re-run the org_activity action constraint from 20261027100000_drill_database.sql.
-- ============================================================

-- Fail fast rather than queue behind a long read of org_activity.
set local lock_timeout = '5s';

-- ── 1. Table ─────────────────────────────────────────────────────────────
create table if not exists public.figure_versions (
  id uuid primary key default gen_random_uuid(),
  figure_kind text not null check (figure_kind in ('figure', 'map')),
  -- three_d_projects.id or projects.id. No foreign key: a version outlives
  -- its figure, even a hard delete.
  figure_id uuid not null,
  version integer not null check (version between 1 and 10000),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  release_date date check (release_date is null or release_date between date '1900-01-01' and date '2200-12-31'),
  name text not null check (char_length(name) <= 200),
  -- Where the version lives (who reads it): a company, or one person.
  org_id uuid references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  owner_id uuid references auth.users(id) on delete cascade,
  published_by uuid references auth.users(id) on delete set null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  -- storage.objects names (three-d-files) the version uses; kept by the
  -- restrictive storage policies below.
  file_names text[] not null default '{}' check (cardinality(file_names) <= 200),
  thumbnail text check (thumbnail is null or char_length(thumbnail) <= 300000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint figure_versions_home check ((org_id is null) = (owner_id is not null)),
  constraint figure_versions_number_key unique (figure_kind, figure_id, version)
);

create index if not exists figure_versions_org_idx on public.figure_versions (org_id) where org_id is not null;
create index if not exists figure_versions_owner_idx on public.figure_versions (owner_id) where owner_id is not null;
create index if not exists figure_versions_property_idx on public.figure_versions (property_id) where property_id is not null;
create index if not exists figure_versions_publisher_idx on public.figure_versions (published_by, created_at desc);
create index if not exists figure_versions_files_idx on public.figure_versions using gin (file_names);

alter table public.figure_versions enable row level security;
revoke all on table public.figure_versions from public, anon, authenticated;
grant select on table public.figure_versions to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'figure_versions'
                 and policyname = 'Readers see published versions') then
    create policy "Readers see published versions" on public.figure_versions for select to authenticated
      using ((org_id is null and owner_id = (select auth.uid()))
             or (org_id is not null and public.has_org_role(org_id, 'viewer')));
  end if;
end $$;

-- ── 2. Immutable ─────────────────────────────────────────────────────────
-- The same rule as org_activity: the foreign keys' own actions are the only
-- changes, for every role (the service role included).
create or replace function public.figure_versions_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if (old.org_id is not null and exists (select 1 from public.organizations o where o.id = old.org_id))
       or (old.owner_id is not null and exists (select 1 from auth.users u where u.id = old.owner_id)) then
      raise exception 'VERSION_IMMUTABLE: a published version cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - 'published_by' - 'property_id') = (to_jsonb(old) - 'published_by' - 'property_id')
     and (new.published_by is not distinct from old.published_by or new.published_by is null)
     and (new.property_id is not distinct from old.property_id or new.property_id is null) then
    return new;
  end if;
  raise exception 'VERSION_IMMUTABLE: a published version cannot be changed' using errcode = '42501';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'figure_versions_immutable'
                 and tgrelid = 'public.figure_versions'::regclass) then
    create trigger figure_versions_immutable before update or delete on public.figure_versions
      for each row execute function public.figure_versions_immutable();
  end if;
end $$;

-- ── 3. Frozen data files ─────────────────────────────────────────────────
-- Is this object used by a published version? SECURITY DEFINER: the storage
-- policies ask it as the caller, who may not read every version.
create or replace function public.figure_version_file(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_bucket = 'three-d-files'
     and exists (select 1 from public.figure_versions v where v.file_names @> array[p_name])
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Published version files are kept') then
    create policy "Published version files are kept" on storage.objects as restrictive for delete to authenticated
      using (bucket_id <> 'three-d-files' or not public.figure_version_file(bucket_id, name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Published version files are not replaced') then
    create policy "Published version files are not replaced" on storage.objects as restrictive for update to authenticated
      using (bucket_id <> 'three-d-files' or not public.figure_version_file(bucket_id, name));
  end if;
end $$;

-- ── 4. Activity ──────────────────────────────────────────────────────────
-- 'published' is never folded into log_org_activity's ten-minute debounce,
-- which applies to 'updated' only.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'org_activity_action_check'
             and conrelid = 'public.org_activity'::regclass and pg_get_constraintdef(oid) not like '%published%') then
    alter table public.org_activity drop constraint org_activity_action_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_activity_action_check'
                 and conrelid = 'public.org_activity'::regclass) then
    alter table public.org_activity add constraint org_activity_action_check
      check (action in ('created', 'updated', 'deleted', 'moved', 'role_changed', 'invited', 'joined', 'removed', 'uploaded',
                        'imported', 'rolled_back', 'published'));
  end if;
end $$;

-- ── 5. Publish ───────────────────────────────────────────────────────────
create or replace function public.publish_figure_version(
  p_kind text, p_figure_id uuid, p_label text, p_release_date date default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_org uuid;
  v_property uuid;
  v_owner uuid;
  v_name text;
  v_updated timestamptz;
  v_thumb text;
  v_snapshot jsonb;
  v_names text[] := '{}';
  v_files jsonb := '[]'::jsonb;
  v_root text;
  v_path text;
  v_meta jsonb;
  e jsonb;
  t record;
  v_count int;
  v_version int;
  v_hash text;
  v_row public.figure_versions%rowtype;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('figure', 'map') then
    raise exception 'VERSION_INVALID: kind must be figure or map' using errcode = '22023';
  end if;
  if char_length(v_label) not between 1 and 200 then
    raise exception 'VERSION_INVALID: give the version a label of up to 200 characters' using errcode = '22023';
  end if;
  if p_release_date is not null and p_release_date not between date '1900-01-01' and date '2200-12-31' then
    raise exception 'VERSION_INVALID: the release date is out of range' using errcode = '22023';
  end if;

  -- The saved row, locked so two publishes of one figure number in turn.
  if p_kind = 'figure' then
    select f.org_id, f.property_id, f.user_id, f.name, f.updated_at, f.thumbnail, f.settings, f.file_paths
      into t from public.three_d_projects f
     where f.id = p_figure_id and f.deleted_at is null for update;
  else
    select p.org_id, p.property_id, p.user_id, p.name, p.updated_at, p.thumbnail, p.payload, p.revision
      into t from public.projects p
     where p.id = p_figure_id and p.deleted_at is null for update;
  end if;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_org := t.org_id; v_property := t.property_id; v_name := t.name; v_updated := t.updated_at;
  if v_org is null then
    if t.user_id is distinct from v_user then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_owner := t.user_id; v_property := null;
  else
    if not public.has_org_role(v_org, 'viewer') then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if not public.has_org_role(v_org, 'editor') then
      raise exception 'VERSION_READ_ONLY: editors and up can publish a company figure' using errcode = '42501';
    end if;
  end if;
  if p_expected_updated_at is not null and v_updated is distinct from p_expected_updated_at then
    raise exception 'VERSION_STALE: the figure was saved again since this copy was opened' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.figure_versions v where v.figure_kind = p_kind and v.figure_id = p_figure_id;
  if v_count >= 200 then
    raise exception 'VERSION_LIMIT: a figure keeps at most 200 published versions' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.figure_versions v
   where v.published_by = v_user and v.created_at > now() - interval '1 hour';
  if v_count >= 60 then
    raise exception 'VERSION_RATE_LIMIT: too many versions published in the last hour' using errcode = 'P0001';
  end if;

  if p_kind = 'figure' then
    -- Every data file must be in storage, inside the figure's own folder.
    v_root := public.ws_figure_root(v_org, t.user_id, p_figure_id);
    if jsonb_typeof(t.file_paths) is distinct from 'array' or jsonb_array_length(t.file_paths) > 200 then
      raise exception 'VERSION_INVALID: a published figure can carry at most 200 files' using errcode = 'P0001';
    end if;
    for e in select value from jsonb_array_elements(t.file_paths) loop
      v_path := e ->> 'path';
      if v_path is null or left(v_path, length(v_root)) <> v_root or v_path ~ '(^|/)\.\.?(/|$)' then
        raise exception 'VERSION_FILES_UNEXPECTED: a file of this figure is outside its folder' using errcode = 'P0001';
      end if;
      select o.metadata into v_meta from storage.objects o where o.bucket_id = 'three-d-files' and o.name = v_path;
      if not found then
        raise exception 'VERSION_FILES_MISSING: % is not in storage; save the figure again', v_path using errcode = 'P0001';
      end if;
      v_names := v_names || v_path;
      v_files := v_files || jsonb_build_array(jsonb_build_object('path', v_path,
        'size', coalesce(v_meta -> 'size', v_meta -> 'contentLength'), 'etag', v_meta -> 'eTag'));
    end loop;
    v_snapshot := jsonb_build_object('kind', 'figure', 'id', p_figure_id, 'name', v_name, 'settings', t.settings,
      'file_paths', t.file_paths, 'files', v_files, 'saved_at', v_updated);
  else
    v_snapshot := jsonb_build_object('kind', 'map', 'id', p_figure_id, 'name', v_name, 'payload', t.payload,
      'revision', t.revision, 'saved_at', v_updated);
  end if;
  if pg_column_size(v_snapshot) > 8 * 1024 * 1024 then
    raise exception 'VERSION_TOO_LARGE: the figure is % KB, the limit is 8192 KB', pg_column_size(v_snapshot) / 1024 using errcode = 'P0001';
  end if;
  v_thumb := case when t.thumbnail is not null and char_length(t.thumbnail) <= 300000 then t.thumbnail end;
  v_hash := encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex');

  select coalesce(max(v.version), 0) + 1 into v_version from public.figure_versions v
   where v.figure_kind = p_kind and v.figure_id = p_figure_id;

  insert into public.figure_versions (figure_kind, figure_id, version, label, release_date, name, org_id, property_id,
                                      owner_id, published_by, snapshot, file_names, thumbnail, content_hash)
  values (p_kind, p_figure_id, v_version, v_label, p_release_date, left(v_name, 200), v_org, v_property,
          v_owner, v_user, v_snapshot, v_names, v_thumb, v_hash)
  returning * into v_row;

  if v_org is not null then
    perform public.log_org_activity(v_org, v_property, 'published', p_kind, p_figure_id,
      'Published version ' || v_version || ' of ' || case p_kind when 'map' then 'map' else '3D figure' end
        || ' "' || left(v_name, 120) || '" · ' || left(v_label, 120),
      jsonb_build_object('version_id', v_row.id, 'version', v_version, 'label', v_label,
                         'release_date', p_release_date, 'content_hash', v_hash));
  end if;

  return jsonb_build_object('id', v_row.id, 'kind', p_kind, 'figure_id', p_figure_id, 'version', v_version,
    'label', v_label, 'release_date', p_release_date, 'name', v_row.name, 'content_hash', v_hash,
    'created_at', v_row.created_at);
end;
$$;

-- ── 6. List ──────────────────────────────────────────────────────────────
-- A figure's versions the caller can read, newest first, with who published
-- each (as the activity log shows it). The snapshot itself is read from the
-- table, under its policy.
create or replace function public.list_figure_versions(p_kind text, p_figure_id uuid)
returns table (id uuid, version integer, label text, release_date date, name text, content_hash text,
               published_by_email text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.version, v.label, v.release_date, v.name, v.content_hash,
         public.ws_user_email(v.published_by), v.created_at
  from public.figure_versions v
  where v.figure_kind = p_kind and v.figure_id = p_figure_id
    and ((v.org_id is null and v.owner_id = (select auth.uid()))
         or (v.org_id is not null and public.has_org_role(v.org_id, 'viewer')))
  order by v.version desc
  limit 200
$$;

-- ── 7. Grants ────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Start from nothing, then grant the two RPCs the browser calls and
-- figure_version_file, which the storage policies evaluate as the caller.
do $$
declare f text;
begin
  foreach f in array array[
    'public.figure_versions_immutable()', 'public.figure_version_file(text, text)',
    'public.publish_figure_version(text, uuid, text, date, timestamptz)', 'public.list_figure_versions(text, uuid)'
  ] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.figure_version_file(text, text)',
    'public.publish_figure_version(text, uuid, text, date, timestamptz)', 'public.list_figure_versions(text, uuid)'
  ] loop
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Post-migration verification (run manually, signed in as a figure's owner):
--   select public.publish_figure_version('figure', '<id>', 'News release 2026-10-21', '2026-10-21');
--   select * from public.list_figure_versions('figure', '<id>');
--   update public.figure_versions set label = 'x';   -- VERSION_IMMUTABLE (as the service role too)
-- ============================================================
