-- ============================================================
-- Workspace and share-limit races (docs/state-machines.md, WS-1, WS-4, WS-6).
--
-- WS-1: create_shared_map and create_agent_share counted recent shares and
--   then inserted with nothing in between, so parallel calls all passed the
--   cap. A per-caller advisory lock now serializes the count and the insert.
-- WS-4: release_pack_figures picked a figure's latest version from any home.
--   For a figure moved in from a personal account or another company, the
--   members could not read that version, so every approval but the original
--   owner's failed with APPROVAL_STALE. It now uses versions published in the
--   pack's company only.
-- WS-6: set_member_role and remove_member re-check the caller's admin role
--   after waiting on the owner-row lock, so a just-demoted admin cannot finish
--   one last action. create_org_invite takes a per-person lock for its
--   cross-workspace daily limit, and re-checks membership after revoking the
--   earlier invite, so it no longer leaves a pending invite for a new member.
--
-- Rollback: re-apply the previous definitions from
--   20261027174653_company_share_allowance.sql (create_shared_map),
--   20260918223000_agent_api_foundation.sql (create_agent_share),
--   20261103120000_release_packs.sql (release_pack_figures),
--   20261023100000_workspaces_properties.sql (set_member_role, remove_member,
--   create_org_invite).
-- ============================================================

create or replace function public.create_shared_map(p_state jsonb, p_creator_key text default null::text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_id text;
  v_recent int;
  v_bytes int;
  v_features int;
  v_limit int;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'SHARE_INVALID: share payload must be an object' using errcode = 'P0001';
  end if;

  v_bytes := pg_column_size(p_state);
  if v_bytes > 2 * 1024 * 1024 then
    raise exception 'SHARE_TOO_LARGE: share payload is % KB, limit is 2048 KB', v_bytes / 1024
      using errcode = 'P0001';
  end if;

  if not (p_state ? 'layers' or p_state ? 'layout') then
    raise exception 'SHARE_INVALID: share payload is not a project' using errcode = 'P0001';
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(l->'geojson'->'features', '[]'::jsonb))), 0)
    into v_features
  from jsonb_array_elements(coalesce(p_state->'layers', '[]'::jsonb)) l
  where jsonb_typeof(coalesce(l->'geojson'->'features', '[]'::jsonb)) = 'array';
  if v_features > 50000 then
    raise exception 'SHARE_TOO_COMPLEX: % features exceeds the 50000 feature share limit', v_features
      using errcode = 'P0001';
  end if;

  -- Serialize this caller's shares: without the lock, parallel calls all
  -- counted the same total and all inserted past the cap (WS-1).
  perform pg_advisory_xact_lock(hashtextextended('share-cap:' || coalesce(v_user::text, 'key:' || coalesce(p_creator_key, '')), 0));

  if v_user is not null then
    select case when up.plan in ('pro', 'company') then 200 else 30 end into v_limit
      from public.user_plans up where up.user_id = v_user;
    select count(*) into v_recent from public.shared_maps
      where user_id = v_user and created_at > now() - interval '1 hour';
    if v_recent >= coalesce(v_limit, 30) then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
  else
    if p_creator_key is null or length(p_creator_key) < 8 or length(p_creator_key) > 100 then
      raise exception 'SHARE_INVALID: missing creator key' using errcode = 'P0001';
    end if;
    select count(*) into v_recent from public.shared_maps
      where creator_key = p_creator_key and created_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
  end if;

  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into public.shared_maps (id, state, user_id, creator_key, expires_at)
  values (
    v_id, p_state, v_user,
    case when v_user is null then p_creator_key else null end,
    case when v_user is null then now() + interval '30 days' else null end
  );

  return v_id;
end;
$function$;

create or replace function public.create_agent_share(
  p_user_id uuid,
  p_state jsonb,
  p_api_key_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text;
  v_bytes integer;
  v_features integer;
  v_recent integer;
begin
  if not exists (
    select 1 from public.agent_api_keys k
    where k.id = p_api_key_id
      and k.user_id = p_user_id
      and k.revoked_at is null
      and (k.expires_at is null or k.expires_at > now())
  ) then
    raise exception 'AGENT_KEY_INVALID' using errcode = '42501';
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'SHARE_INVALID: share payload must be an object' using errcode = 'P0001';
  end if;

  v_bytes := pg_column_size(p_state);
  if v_bytes > 2 * 1024 * 1024 then
    raise exception 'SHARE_TOO_LARGE: share payload exceeds 2048 KB' using errcode = 'P0001';
  end if;

  if not (p_state ? 'layers' and p_state ? 'layout') then
    raise exception 'SHARE_INVALID: share payload is not a project' using errcode = 'P0001';
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(l->'geojson'->'features', '[]'::jsonb))), 0)
  into v_features
  from jsonb_array_elements(coalesce(p_state->'layers', '[]'::jsonb)) l
  where jsonb_typeof(coalesce(l->'geojson'->'features', '[]'::jsonb)) = 'array';

  if v_features > 50000 then
    raise exception 'SHARE_TOO_COMPLEX: feature limit exceeded' using errcode = 'P0001';
  end if;

  -- The same per-user lock as create_shared_map, so agent and editor shares
  -- cannot race each other's counts either (WS-1).
  perform pg_advisory_xact_lock(hashtextextended('share-cap:' || p_user_id::text, 0));
  select count(*) into v_recent
  from public.shared_maps
  where user_id = p_user_id
    and created_at > now() - interval '1 hour';

  if v_recent >= 60 then
    raise exception 'SHARE_RATE_LIMIT: too many agent shares created recently' using errcode = 'P0001';
  end if;

  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into public.shared_maps (id, state, user_id, creator_key, expires_at)
  values (v_id, p_state, p_user_id, null, null);

  return v_id;
end;
$$;

create or replace function public.release_pack_figures(p_property uuid, p_items jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(f order by i), '[]'::jsonb) from (
    select jsonb_build_object('item', e.i - 1, 'kind', 'map', 'id', m.id, 'name', m.name, 'revision', m.revision,
             'saved_at', m.updated_at, 'version_id', null, 'version', null, 'label', null) f, e.i
    from jsonb_array_elements(p_items) with ordinality e(v, i)
    join public.projects m on m.id = public.ws_uuid(e.v->>'ref') and m.property_id = p_property and m.deleted_at is null
    where e.v->>'kind' in ('drill_plan', 'location_map')
    union all
    select jsonb_build_object('item', e.i - 1, 'kind', 'figure', 'id', t.id, 'name', t.name, 'revision', null,
             'saved_at', t.updated_at, 'version_id', v.id, 'version', v.version, 'label', v.label), e.i
    from jsonb_array_elements(p_items) with ordinality e(v, i)
    join public.three_d_projects t on t.id = public.ws_uuid(e.v->>'ref') and t.property_id = p_property and t.deleted_at is null
    left join lateral (select x.id, x.version, x.label from public.figure_versions x
                       where x.figure_kind = 'figure' and x.figure_id = t.id
                         -- Only versions published in this company: a figure moved in
                         -- from elsewhere keeps versions its members cannot read (WS-4).
                         and x.org_id = (select pr.org_id from public.properties pr where pr.id = p_property)
                       order by x.version desc limit 1) v on true
    where e.v->>'kind' = 'figure_3d'
  ) z(f, i)
$$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_current text;
  v_owners int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  -- Lock the organization's owner rows so two demotions cannot both pass.
  perform 1 from public.organization_members where org_id = p_org and role = 'owner' for update;
  -- Re-check after waiting on the lock: a demotion of the caller that held
  -- it has committed by now, and this statement sees it (WS-6).
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can change roles' using errcode = '42501';
  end if;
  select role into v_current from public.organization_members where org_id = p_org and user_id = p_user for update;
  if v_current is null then
    raise exception 'NOT_A_MEMBER' using errcode = 'P0002';
  end if;
  if (v_current = 'owner' or p_role = 'owner') and not public.has_org_role(p_org, 'owner') then
    raise exception 'forbidden: only an owner can change an owner or make someone an owner' using errcode = '42501';
  end if;
  if v_current = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners from public.organization_members where org_id = p_org and role = 'owner';
    if v_owners <= 1 then
      raise exception 'LAST_OWNER: a workspace needs at least one owner' using errcode = 'P0001';
    end if;
  end if;
  if v_current <> p_role then
    update public.organization_members set role = p_role where org_id = p_org and user_id = p_user;
  end if;
  return jsonb_build_object('user_id', p_user, 'role', p_role);
end;
$$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text;
  v_owners int;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_user is distinct from v_me and not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can remove members' using errcode = '42501';
  end if;
  perform 1 from public.organization_members where org_id = p_org and role = 'owner' for update;
  -- Re-check after waiting on the lock (see set_member_role, WS-6).
  if p_user is distinct from v_me and not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can remove members' using errcode = '42501';
  end if;
  select role into v_role from public.organization_members where org_id = p_org and user_id = p_user for update;
  if v_role is null then
    if p_user is distinct from v_me and not public.has_org_role(p_org, 'viewer') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'NOT_A_MEMBER' using errcode = 'P0002';
  end if;
  if v_role = 'owner' then
    if p_user is distinct from v_me and not public.has_org_role(p_org, 'owner') then
      raise exception 'forbidden: only an owner can remove an owner' using errcode = '42501';
    end if;
    select count(*) into v_owners from public.organization_members where org_id = p_org and role = 'owner';
    if v_owners <= 1 then
      raise exception 'LAST_OWNER: make someone else an owner first' using errcode = 'P0001';
    end if;
  end if;
  delete from public.organization_members where org_id = p_org and user_id = p_user;
  return true;
end;
$$;

create or replace function public.create_org_invite(p_org uuid, p_email text, p_role text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
  v_count int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'forbidden: only an owner or admin can invite' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if p_role = 'owner' and not public.has_org_role(p_org, 'owner') then
    raise exception 'forbidden: only an owner can invite another owner' using errcode = '42501';
  end if;
  if char_length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;

  -- Serialize per organization so the rate limit cannot be raced.
  perform 1 from public.organizations where id = p_org for update;
  -- The per-person limit spans workspaces, so it needs its own lock (WS-6).
  perform pg_advisory_xact_lock(hashtextextended('invites-by:' || v_user::text, 0));
  select count(*) into v_count from public.org_invites where org_id = p_org and created_at > now() - interval '1 day';
  if v_count >= 50 then
    raise exception 'INVITE_RATE_LIMIT: this workspace has sent 50 invites today' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.org_invites where invited_by = v_user and created_at > now() - interval '1 day';
  if v_count >= 100 then
    raise exception 'INVITE_RATE_LIMIT: you have sent 100 invites today' using errcode = 'P0001';
  end if;

  -- Only within this organization, which the admin can already see.
  if exists (select 1 from public.organization_members m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email::text) = v_email) then
    raise exception 'ALREADY_MEMBER: that person is already in this workspace' using errcode = 'P0001';
  end if;

  -- Inviting again replaces the earlier link.
  update public.org_invites set revoked_at = now()
   where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null;

  -- Re-check after the update: an accept that held this row's lock may have
  -- just made the person a member (WS-6).
  if exists (select 1 from public.organization_members m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email::text) = v_email) then
    raise exception 'ALREADY_MEMBER: that person is already in this workspace' using errcode = 'P0001';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.org_invites (org_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_user)
  returning id, expires_at into v_id, v_expires;

  begin
    perform public.send_org_invite_email(v_id, v_token);
  exception when others then
    null;
  end;

  return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role, 'expires_at', v_expires,
    'token', v_token, 'link', 'https://www.explorationmaps.com/invite?token=' || v_token);
end;
$$;
