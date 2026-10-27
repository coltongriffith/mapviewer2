-- ============================================================
-- Live investor web maps (Phase 5): one share link per saved 2D map that the
-- owner republishes in place, so every website embedding
-- /embed/map/<id> shows the latest published state on its next load.
--
--   publish_live_map(p_project, p_state)  create the map's live link, or
--     replace the state behind it. Only ever on an explicit publish: edits
--     are never pushed. Callers who can edit the map: its personal owner, an
--     editor of its company. Pro (or grandfathered/admin), or a map in a paid
--     company workspace (LIVE_MAP_PLAN otherwise). Same size, shape and
--     feature limits as create_shared_map; at most one publish per map every
--     10 seconds (SHARE_RATE_LIMIT).
--   get_live_map(p_project)  the live link of a map the caller can read:
--     id, created/updated time and view_count (link and embed loads, through
--     get_shared_map's throttled counter). Null when there is none.
--
--   revoke_live_map(p_project)  stop the map's live link: the same callers as
--     publish_live_map (the map's current owner or editors, not whoever first
--     published it). True when a link was revoked.
--
-- The live link is a shared_maps row read by get_shared_map. Both revocation
-- paths and legacy account listing use the project's current edit permissions;
-- ordinary snapshot shares retain publisher ownership. The next publish after
-- revocation makes a new link.
--
-- Additive and idempotent: new nullable columns, a partial unique index and
-- three new functions. Legacy revoke/list RPCs retain snapshot semantics and
-- recognize current project permissions for live links.
-- Depends on: 20260728000004_shared_maps_bounds.sql,
-- 20261023100000_workspaces_properties.sql (has_org_role,
-- ws_personal_map_limit).
--
-- Rollback:
--   Restore revoke_shared_map/list_my_shared_maps from 20260728000004 before
--   dropping the project_id column they reference below.
--   drop function if exists public.publish_live_map(uuid, jsonb);
--   drop function if exists public.get_live_map(uuid);
--   drop function if exists public.revoke_live_map(uuid);
--   drop index if exists public.shared_maps_live_project_idx;
--   alter table public.shared_maps drop column if exists project_id, drop column if exists updated_at;
-- ============================================================

alter table public.shared_maps
  add column if not exists project_id uuid,
  add column if not exists updated_at timestamptz;

create unique index if not exists shared_maps_live_project_idx
  on public.shared_maps (project_id) where project_id is not null and revoked_at is null;

create or replace function public.publish_live_map(p_project uuid, p_state jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_owner uuid;
  v_id text;
  v_updated timestamptz;
  v_features int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select p.org_id, p.user_id into v_org, v_owner from public.projects p
    where p.id = p_project and p.deleted_at is null;
  if not found or (v_org is null and v_owner is distinct from v_user)
     or (v_org is not null and not public.has_org_role(v_org, 'editor')) then
    raise exception 'NOT_FOUND: no map of yours with that id' using errcode = 'P0002';
  end if;
  if public.ws_personal_map_limit(v_user) is not null
     and coalesce((select o.plan from public.organizations o where o.id = v_org), 'free') = 'free' then
    raise exception 'LIVE_MAP_PLAN: live web maps are part of Pro' using errcode = 'P0001';
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' or not (p_state ? 'layers' or p_state ? 'layout') then
    raise exception 'SHARE_INVALID: share payload is not a project' using errcode = 'P0001';
  end if;
  if pg_column_size(p_state) > 2 * 1024 * 1024 then
    raise exception 'SHARE_TOO_LARGE: share payload is % KB, limit is 2048 KB', pg_column_size(p_state) / 1024 using errcode = 'P0001';
  end if;
  select coalesce(sum(jsonb_array_length(l->'geojson'->'features')), 0) into v_features
    from jsonb_array_elements(case when jsonb_typeof(p_state->'layers') = 'array' then p_state->'layers' else '[]'::jsonb end) l
    where jsonb_typeof(l->'geojson'->'features') = 'array';
  if v_features > 50000 then
    raise exception 'SHARE_TOO_COMPLEX: % features exceeds the 50000 feature share limit', v_features using errcode = 'P0001';
  end if;

  select s.id, s.updated_at into v_id, v_updated from public.shared_maps s
    where s.project_id = p_project and s.revoked_at is null for update;
  if v_id is not null then
    if v_updated > now() - interval '10 seconds' then
      raise exception 'SHARE_RATE_LIMIT: this map was published moments ago' using errcode = 'P0001';
    end if;
    update public.shared_maps s set state = p_state, updated_at = now() where s.id = v_id;
    return v_id;
  end if;

  v_id := replace(gen_random_uuid()::text, '-', '');
  insert into public.shared_maps (id, state, user_id, project_id, updated_at)
    values (v_id, p_state, v_user, p_project, now());
  return v_id;
end;
$$;

create or replace function public.get_live_map(p_project uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', s.id, 'created_at', s.created_at, 'updated_at', coalesce(s.updated_at, s.created_at),
                            'view_count', coalesce(s.view_count, 0))
  from public.shared_maps s
  join public.projects p on p.id = s.project_id and p.deleted_at is null
  where s.project_id = p_project and s.revoked_at is null
    and ((p.org_id is null and p.user_id = auth.uid()) or (p.org_id is not null and public.has_org_role(p.org_id, 'viewer')))
$$;

create or replace function public.revoke_live_map(p_project uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select p.org_id, p.user_id into v_org, v_owner from public.projects p
    where p.id = p_project and p.deleted_at is null;
  if not found or (v_org is null and v_owner is distinct from auth.uid())
     or (v_org is not null and not public.has_org_role(v_org, 'editor')) then
    raise exception 'NOT_FOUND: no map of yours with that id' using errcode = 'P0002';
  end if;
  update public.shared_maps s set revoked_at = now(), state = '{}'::jsonb where s.project_id = p_project and s.revoked_at is null;
  return found;
end;
$$;

-- AccountPage still calls these older RPCs. A separate project-aware revoke
-- function cannot revoke a removed publisher's access through the old one.
create or replace function public.revoke_shared_map(p_id text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.shared_maps s set revoked_at = now(), state = '{}'::jsonb
  where s.id = p_id and s.revoked_at is null and (
    (s.project_id is null and s.user_id = v_user)
    or exists (
      select 1 from public.projects p where p.id = s.project_id
        and ((p.org_id is null and p.user_id = v_user)
          or (p.org_id is not null and public.has_org_role(p.org_id, 'editor')))
    )
  );
  return found;
end;
$$;

create or replace function public.list_my_shared_maps()
returns table (id text, created_at timestamptz, expires_at timestamptz,
               revoked_at timestamptz, view_count int, title text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.created_at, s.expires_at, s.revoked_at, s.view_count,
         nullif(s.state->'layout'->>'title', '')
  from public.shared_maps s
  where (s.project_id is null and s.user_id = auth.uid())
    or exists (
      -- A trashed map may still be public. Keep its current owner/editor able
      -- to find and stop that publication from the account's share controls.
      select 1 from public.projects p where p.id = s.project_id
        and ((p.org_id is null and p.user_id = auth.uid())
          or (p.org_id is not null and public.has_org_role(p.org_id, 'editor')))
    )
  order by s.created_at desc
  limit 200;
$$;

revoke all on function public.publish_live_map(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_live_map(uuid) from public, anon, authenticated;
revoke all on function public.revoke_live_map(uuid) from public, anon, authenticated;
revoke all on function public.revoke_shared_map(text) from public, anon, authenticated;
revoke all on function public.list_my_shared_maps() from public, anon, authenticated;
grant execute on function public.publish_live_map(uuid, jsonb) to authenticated;
grant execute on function public.get_live_map(uuid) to authenticated;
grant execute on function public.revoke_live_map(uuid) to authenticated;
grant execute on function public.revoke_shared_map(text) to authenticated;
grant execute on function public.list_my_shared_maps() to authenticated;
