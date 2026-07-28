-- ============================================================
-- Bounded share creation + owner revocation and expiry.
--
-- Before this migration any anonymous client holding the public anon key
-- could insert unlimited shared_maps rows, each carrying an entire project
-- payload, with no size limit, no rate limit, and no expiry — an unmetered
-- write API against our database (audit P0-07). Owners also had no way to
-- revoke a published link, so a copied URL was a permanent disclosure
-- (P0-08): UPDATE/DELETE were never granted to users.
--
-- This migration:
--   1. adds expires_at / revoked_at and a per-creator rate window,
--   2. moves creation into a validating security-definer RPC and revokes
--      direct INSERT,
--   3. adds an owner-scoped revoke RPC and an owner listing RPC,
--   4. teaches get_shared_map to refuse revoked/expired shares.
--
-- Retention: anonymous shares expire after 30 days by default; shares owned
-- by a signed-in account default to no expiry but can be revoked at will.
--
-- Rollback:
--   drop function if exists public.create_shared_map(jsonb, uuid);
--   drop function if exists public.revoke_shared_map(text);
--   drop function if exists public.list_my_shared_maps();
--   grant insert on public.shared_maps to anon, authenticated;
-- ============================================================

alter table public.shared_maps
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists creator_key text;

create index if not exists shared_maps_creator_idx on public.shared_maps (creator_key, created_at desc);
create index if not exists shared_maps_user_idx on public.shared_maps (user_id, created_at desc);

-- ── Creation ────────────────────────────────────────────────────────────────
-- p_creator_key is an opaque per-browser identifier used only to rate-limit
-- anonymous creation. It is not an identity and is never returned to readers.
create or replace function public.create_shared_map(p_state jsonb, p_creator_key text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id text;
  v_recent int;
  v_bytes int;
  v_features int;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'SHARE_INVALID: share payload must be an object' using errcode = 'P0001';
  end if;

  -- Size cap. A share is public and rendered by anyone with the link, so it
  -- is the most expensive row an unauthenticated caller can create.
  v_bytes := pg_column_size(p_state);
  if v_bytes > 2 * 1024 * 1024 then
    raise exception 'SHARE_TOO_LARGE: share payload is % KB, limit is 2048 KB', v_bytes / 1024
      using errcode = 'P0001';
  end if;

  -- Shape check: must look like a project, not arbitrary JSON.
  if not (p_state ? 'layers' or p_state ? 'layout') then
    raise exception 'SHARE_INVALID: share payload is not a project' using errcode = 'P0001';
  end if;

  -- Feature-count guard against payloads that are small compressed but
  -- ruinous to render.
  select coalesce(sum(jsonb_array_length(coalesce(l->'geojson'->'features', '[]'::jsonb))), 0)
    into v_features
  from jsonb_array_elements(coalesce(p_state->'layers', '[]'::jsonb)) l
  where jsonb_typeof(coalesce(l->'geojson'->'features', '[]'::jsonb)) = 'array';
  if v_features > 50000 then
    raise exception 'SHARE_TOO_COMPLEX: % features exceeds the 50000 feature share limit', v_features
      using errcode = 'P0001';
  end if;

  -- Rate limit: 10 shares/hour per signed-in user, 3/hour per anonymous
  -- browser key. Prevents an automated client from filling the table.
  if v_user is not null then
    select count(*) into v_recent from public.shared_maps
      where user_id = v_user and created_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
  else
    if p_creator_key is null or length(p_creator_key) < 8 or length(p_creator_key) > 100 then
      raise exception 'SHARE_INVALID: missing creator key' using errcode = 'P0001';
    end if;
    select count(*) into v_recent from public.shared_maps
      where creator_key = p_creator_key and created_at > now() - interval '1 hour';
    if v_recent >= 3 then
      raise exception 'SHARE_RATE_LIMIT: too many shares created recently' using errcode = 'P0001';
    end if;
  end if;

  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into public.shared_maps (id, state, user_id, creator_key, expires_at)
  values (
    v_id, p_state, v_user,
    case when v_user is null then p_creator_key else null end,
    -- Anonymous shares always expire; owned shares persist until revoked.
    case when v_user is null then now() + interval '30 days' else null end
  );

  return v_id;
end;
$$;

revoke all on function public.create_shared_map(jsonb, text) from public;
grant execute on function public.create_shared_map(jsonb, text) to anon, authenticated;

-- Creation must go through the RPC above.
revoke insert on public.shared_maps from anon, authenticated;
drop policy if exists "anon create unowned shared map" on public.shared_maps;
drop policy if exists "auth create own shared map" on public.shared_maps;

-- ── Owner revocation + listing (P0-08) ─────────────────────────────────────
create or replace function public.revoke_shared_map(p_id text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Clear the payload as well as flagging it: revocation should remove the
  -- disclosed data, not merely hide it.
  update public.shared_maps
     set revoked_at = now(), state = '{}'::jsonb
   where id = p_id and user_id = v_user and revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.revoke_shared_map(text) from public;
grant execute on function public.revoke_shared_map(text) to authenticated;

create or replace function public.list_my_shared_maps()
returns table (id text, created_at timestamptz, expires_at timestamptz,
               revoked_at timestamptz, view_count int, title text)
language sql security definer set search_path = public, pg_temp stable
as $$
  select s.id, s.created_at, s.expires_at, s.revoked_at, s.view_count,
         nullif(s.state->'layout'->>'title', '')
  from public.shared_maps s
  where s.user_id = auth.uid()
  order by s.created_at desc
  limit 200;
$$;

revoke all on function public.list_my_shared_maps() from public;
grant execute on function public.list_my_shared_maps() to authenticated;

-- ── Reads must respect revocation and expiry ───────────────────────────────
create or replace function public.get_shared_map(share_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
begin
  select state into v_state
  from public.shared_maps
  where id = share_id
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if v_state is null then
    return null;
  end if;

  update public.shared_maps set view_count = coalesce(view_count, 0) + 1
  where id = share_id;

  return v_state;
end;
$$;

revoke all on function public.get_shared_map(text) from public;
grant execute on function public.get_shared_map(text) to anon, authenticated;

-- Post-migration verification (run manually):
--   select public.create_shared_map('{"layout":{}}'::jsonb, 'browserkey123');
--   select public.get_shared_map('<id>');       -- returns state
--   select public.revoke_shared_map('<id>');    -- true, as the owner
--   select public.get_shared_map('<id>');       -- now null

-- ── Grant hygiene ───────────────────────────────────────────────────────────
-- Supabase's default privileges grant EXECUTE on new public functions to both
-- anon and authenticated; `revoke ... from public` does not remove those
-- explicit role grants. Only genuinely public functions keep anon.
revoke execute on function public.revoke_shared_map(text) from anon;
revoke execute on function public.list_my_shared_maps() from anon;
